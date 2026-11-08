// Renders the real avatar HTML (same builder the app uses) in Chromium/WebGL,
// drives every action, samples bone rotations over time and saves screenshots,
// a contact sheet and a JSON evidence file. Usage:
//   node tools/avatar-evidence.mjs <outDir> [faceImage.png]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { avatarHtml, viewerHtml, AVATAR_ACTIONS } from '../src/components/character/characterHtml.ts';

const out = process.argv[2] || 'evidence/avatar';
const faceImage = process.argv[3];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 220, height: 352 }, deviceScaleFactor: 2 });
const log = [];
page.on('console', (m) => log.push(m.text()));
page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
await page.setContent(avatarHtml({ action: 'idle' }), { waitUntil: 'load' });
await page.waitForFunction(() => window.__luqtaLast && (window.__luqtaLast.type === 'ready' || window.__luqtaLast.type === 'actionChanged' || window.__luqtaLast.type === 'error'), null, { timeout: 30000 });
const ready = await page.evaluate(() => ({ actions: window.LuqtaAvatar && window.LuqtaAvatar.actions, bones: window.LuqtaAvatar && window.LuqtaAvatar.skeleton.bones.length, webgl: !!document.querySelector('canvas').getContext }));
const cmd = (m) => page.evaluate((x) => window.LuqtaAvatar.command(x), m);
const probe = async () => { await cmd({ type: 'probe', id: 'p' }); return page.evaluate(() => window.__luqtaLast); };
const results = {};
const only = (process.env.ACTIONS || '').split(',').filter(Boolean);
for (const action of AVATAR_ACTIONS.filter((a) => !only.length || only.includes(a))) {
  await cmd({ type: 'action', action });
  const vp = action === 'sleep' ? { width: 400, height: 170 } : { width: 220, height: 352 };
  await page.setViewportSize(vp);
  await page.waitForTimeout(action === 'wake' ? 2600 : 900);
  const samples = [];
  for (let i = 0; i < 8; i++) { samples.push(await probe()); await page.waitForTimeout(110); }
  await page.screenshot({ path: join(out, `pose-${action}.png`), omitBackground: true });
  const range = {};
  for (const j of Object.keys(samples[0].joints)) {
    const xs = samples.map((s) => s.joints[j][0]), zs = samples.map((s) => s.joints[j][2]);
    range[j] = { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
  }
  results[action] = { last: samples.at(-1), range, rootY: [Math.min(...samples.map((s) => s.rootY)), Math.max(...samples.map((s) => s.rootY))] };
}
// photo personalisation path
let face = null;
if (faceImage) {
  const dataUrl = 'data:image/png;base64,' + readFileSync(faceImage).toString('base64');
  await cmd({ type: 'action', action: 'crossed' });
  await page.setViewportSize({ width: 220, height: 352 });
  await cmd({ type: 'processFace', dataUrl, id: 'f1' });
  await page.waitForFunction(() => (window.__luqtaLog || []).some((m) => m.type === 'faceProcessed' || (m.type === 'error' && m.id === 'f1')), null, { timeout: 60000 });
  face = await page.evaluate(() => window.__luqtaLog.filter((m) => m.type === 'faceProcessed' || m.id === 'f1').pop());
  await cmd({ type: 'profile', profile: { faceDataUrl: face.dataUrl, skin: face.skin, hair: face.hair } });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, 'pose-photo-face.png'), omitBackground: true });
  results.photoFace = await probe();
  face = { skin: face.skin, hair: face.hair, bytes: face.dataUrl.length };
}
// short walk video frames for motion proof
await cmd({ type: 'profile', profile: {} });
await cmd({ type: 'action', action: 'walk' });
mkdirSync(join(out, 'frames'), { recursive: true });
for (let i = 0; i < 24; i++) { await page.screenshot({ path: join(out, 'frames', `walk-${String(i).padStart(3, '0')}.png`) }); await page.waitForTimeout(42); }
// product viewer smoke test
const v = await browser.newPage({ viewport: { width: 360, height: 320 } });
await v.setContent(viewerHtml({ model: 'chair', dimensions: { w: 0.78, d: 0.8, h: 0.82 } }), { waitUntil: 'load' });
await v.waitForFunction(() => window.__luqtaLast && window.__luqtaLast.type === 'mode', null, { timeout: 30000 });
await v.waitForTimeout(500); await v.screenshot({ path: join(out, 'viewer-chair-3d.png') });
await v.evaluate(() => window.LuqtaViewer.command({ type: 'zoomIn' }));
await v.evaluate(() => window.LuqtaViewer.command({ type: 'mode', value: 'room' }));
await v.waitForTimeout(500); await v.screenshot({ path: join(out, 'viewer-chair-room.png') });
await v.evaluate(() => window.LuqtaViewer.command({ type: 'probe', id: 'v' }));
const viewerProbe = await v.evaluate(() => window.__luqtaLast);
await browser.close();
const evidence = { generatedAt: new Date().toISOString(), ready, results, face, viewerProbe, console: log.slice(0, 50) };
writeFileSync(join(out, 'avatar-evidence.json'), JSON.stringify(evidence, null, 1));
console.log(JSON.stringify({ bones: ready.bones, actions: ready.actions?.length, errors: log.filter((l) => /error/i.test(l)).length, viewer: viewerProbe && viewerProbe.mode }));
