// E2E for dashboard/one against Firebase Auth + Firestore emulators.
// Run: firebase emulators:exec --only auth,firestore "node tests/e2e/jawafa-one.e2e.mjs"
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('dashboard');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const b = await readFile(p.endsWith('/') ? p + 'index.html' : p); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }).end(b); }
  catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}/one/index.html?emulator=1`;
const out = process.env.EVIDENCE_DIR || 'docs/jawafa-one/evidence';
const results = [];
const check = (id, ok, detail) => { results.push({ id, result: ok ? 'PASS' : 'FAIL', detail }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' — ' + detail); };

const browser = await chromium.launch();
async function open(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
  // The sandbox proxy blocks cdn.jsdelivr.net; serve the same firebase@10.14.1 compat build from
  // a local install when FIREBASE_COMPAT_DIR is set. Production keeps loading the CDN.
  if (process.env.FIREBASE_COMPAT_DIR) await ctx.route(/cdn\.jsdelivr\.net\/npm\/firebase@10\.14\.1\/(firebase-[a-z]+-compat\.js)$/, async (route) => {
    const file = route.request().url().split('/').pop();
    route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(join(process.env.FIREBASE_COMPAT_DIR, file)) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*fonts/.test(m.text())) errors.push({ at: Date.now(), text: m.text(), url: m.location()?.url || '' }); });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__jawafaState && window.__jawafaState.cloud !== 'loading', null, { timeout: 30000 });
  return { ctx, page, errors, loadMs: Date.now() - t0 };
}
const signIn = async (page, email, uid) => {
  const r = await page.evaluate(([e, u]) => window.__jawafaTestSignIn(e, u).then(c => 'ok:' + c.user.uid, err => 'err:' + (err.code || err.message)), [email, uid]);
  if (!r.startsWith('ok')) throw new Error('test sign-in failed: ' + r);
};
// Steps that deliberately make Firestore reject a request. The SDK may then reset its stream and the
// browser logs a generic "Failed to load resource: 400" for the emulator; only those, inside these
// windows, are expected. Any other console error still fails E2E-18.
const denialWindows = [];
async function expectDenial(fn) { const start = Date.now(); try { return await fn(); } finally { denialWindows.push([start, Date.now() + 2000]); } }
const isExpectedDenialNoise = (e) => /Failed to load resource: the server responded with a status of 400/.test(e.text)
  && /^http:\/\/127\.0\.0\.1:8080\//.test(e.url) && denialWindows.some(([a, b]) => e.at >= a && e.at <= b);
const nav = async (page, v) => { await page.evaluate((v) => { location.hash = '#' + v; }, v); await page.waitForFunction((v) => !document.querySelector(`section.view[data-view="${v}"]`).hidden, v); };
const waitState = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });

try {
  // 1. Signed-out preview: every view navigable, demo data clearly labelled.
  const a = await open();
  check('E2E-01', (await a.page.evaluate(() => window.__jawafaState.cloud)) === 'ready', 'Firebase SDK loaded and emulator connected');
  const views = ['home', 'sales', 'inventory', 'finance', 'investigations', 'maps', 'assistant', 'agents', 'connections', 'company', 'branches', 'members', 'audit', 'plans'];
  const bad = [];
  for (const v of views) {
    await nav(a.page, v); await a.page.waitForTimeout(150);
    const ok = await a.page.evaluate((v) => { const s = document.querySelector(`section.view[data-view="${v}"]`); return s && !s.hidden && s.textContent.trim().length > 20; }, v);
    if (!ok) bad.push(v);
  }
  check('E2E-02', bad.length === 0, `${views.length} views render after navigation` + (bad.length ? ' — failed: ' + bad.join(',') : ''));
  await nav(a.page, 'home'); await a.page.waitForTimeout(300);
  const demoBadges = await a.page.locator('.badge.demo').count();
  check('E2E-03', demoBadges >= 5, `demo figures carry DEMO badges (${demoBadges} badges on home)`);
  await a.page.screenshot({ path: `${out}/01-home-desktop-signed-out.png` });
  await nav(a.page, 'company'); await a.page.waitForTimeout(200);
  check('E2E-04', await a.page.locator('section.view:not([hidden])').getByText(/سجّل الدخول للمتابعة/).isVisible(), 'company screen requires sign-in');
  await nav(a.page, 'assistant'); await a.page.waitForTimeout(200);
  await a.page.getByRole('button', { name: 'اعرض الشيكات المستحقة خلال 7 أيام' }).first().click(); await a.page.waitForTimeout(200);
  const ans = await a.page.locator('.msg.bot').last().textContent();
  check('E2E-05', /CH-7781/.test(ans) && /DEMO/.test(ans), 'assistant answers from dataset and cites DEMO source');
  await a.page.screenshot({ path: `${out}/02-assistant.png` });

  // Search, English, light theme, CSV, no-data mode (signed out).
  await a.page.locator('#q').fill('المخزون'); await a.page.keyboard.press('Enter');
  await a.page.waitForFunction(() => !document.querySelector('section.view[data-view="inventory"]').hidden, null, { timeout: 5000 }).then(() => true, () => false)
    .then(ok => check('E2E-19', ok, 'global search: typing «المخزون» + Enter opens the inventory screen'));
  await a.page.locator('#lang-btn').click(); await a.page.waitForTimeout(300);
  const en = await a.page.evaluate(() => ({ dir: document.documentElement.dir, nav: document.getElementById('nav').textContent, head: document.querySelector('section.view:not([hidden]) h1')?.textContent }));
  check('E2E-20', en.dir === 'ltr' && /Inventory/.test(en.nav) && /Inventory/.test(en.head || ''), 'English mode: dir=ltr, navigation and headings in English (' + en.head + ')');
  await a.page.screenshot({ path: `${out}/06-inventory-english.png` });
  await a.page.locator('#lang-btn').click(); await a.page.waitForTimeout(200);
  await a.page.locator('#theme-btn').click(); await a.page.waitForTimeout(200);
  const theme = await a.page.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color }));
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (Math.max(lum(theme.bg), lum(theme.fg)) + 0.05) / (Math.min(lum(theme.bg), lum(theme.fg)) + 0.05);
  check('E2E-21', theme.t === 'light' && ratio >= 7, `light theme applied; body text contrast ${ratio.toFixed(1)}:1 (≥ 7 required)`);
  await nav(a.page, 'home'); await a.page.screenshot({ path: `${out}/07-home-light.png` });
  await a.page.locator('#theme-btn').click();
  const csv = await a.page.evaluate(() => window.__jawafaToCsv('DEMO', ['a', 'b'], [['=1+1', -140], ['x,y', 'ok']]));
  check('E2E-22', csv.startsWith('\ufeff') && csv.split('\r\n')[0].includes('DEMO') && csv.includes(`"'=1+1"`) && csv.includes(',-140') && csv.includes('"x,y"'), 'CSV export: BOM, source line, formula injection neutralised, numbers kept');
  await nav(a.page, 'home');
  await a.page.getByRole('button', { name: 'إخفاء البيانات التجريبية' }).first().click(); await a.page.waitForTimeout(300);
  const nodata = await a.page.evaluate(() => ({ kpis: document.querySelectorAll('.kpi').length, blocked: /LIVE: BLOCKED/.test(document.querySelector('section.view[data-view="home"]').textContent), status: document.getElementById('status-data').textContent }));
  check('E2E-23', nodata.kpis === 0 && nodata.blocked && /LIVE/.test(nodata.status), 'demo hidden → no figures shown, "LIVE: BLOCKED" panel instead');
  await a.page.getByRole('button', { name: 'عرض بيانات تجريبية' }).first().click(); await a.page.waitForTimeout(200);

  // 2. Owner signs in, creates company A, sets social links, invites an auditor.
  await signIn(a.page, 'owner.a@example.com', 'ownerA');
  await waitState(a.page, () => window.__jawafaState.user && window.__jawafaState.user.email === 'owner.a@example.com');
  await nav(a.page, 'company'); await a.page.waitForTimeout(300);
  await a.page.locator('input[name="cname"]').fill('أسواق جوافة التجريبية');
  await a.page.getByRole('button', { name: 'إنشاء الشركة' }).click();
  await waitState(a.page, () => window.__jawafaState.companies.length === 1 && window.__jawafaState.companyId);
  check('E2E-06', true, 'owner created company A (Firestore write accepted by rules)');
  await nav(a.page, 'company'); await a.page.waitForTimeout(400);
  await a.page.locator('input[name="facebook"]').fill('http://facebook.com/bad');
  await a.page.getByRole('button', { name: 'حفظ' }).click();
  await a.page.waitForFunction(() => /facebook:/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
  const t1 = await a.page.locator('#toast').textContent();
  check('E2E-07', /https/.test(t1), 'invalid (http) Facebook URL rejected client-side: ' + t1.trim().slice(0, 60));
  await a.page.locator('input[name="facebook"]').fill('https://www.facebook.com/jawafa');
  await a.page.locator('input[name="tiktok"]').fill('https://www.tiktok.com/@jawafa');
  await a.page.getByRole('button', { name: 'حفظ' }).click();
  await waitState(a.page, () => window.__jawafaState.companies[0]?.social?.tiktok === 'https://www.tiktok.com/@jawafa');
  check('E2E-08', true, 'valid social links saved to company profile');
  await nav(a.page, 'members'); await a.page.waitForTimeout(300);
  await a.page.locator('input[name="email"]').fill('Auditor.A@Example.com');
  await a.page.locator('select[name="role"]').selectOption('auditor');
  await a.page.getByRole('button', { name: 'إرسال الدعوة' }).click();
  await waitState(a.page, () => window.__jawafaState.companies[0]?.pendingInvites?.['auditor.a@example.com'] === 'auditor');
  check('E2E-09', true, 'owner invited auditor.a@example.com as auditor (email normalised)');
  await nav(a.page, 'branches'); await a.page.waitForTimeout(200);
  await a.page.locator('input[name="bname"]').fill('أسواق جوافة — الزرقاء');
  await a.page.locator('select[name="kind"]').selectOption('market');
  await a.page.locator('input[name="city"]').fill('الزرقاء');
  await a.page.locator('input[name="lat"]').fill('32.0608'); await a.page.locator('input[name="lng"]').fill('36.0942');
  await a.page.getByRole('button', { name: 'إضافة' }).click();
  await waitState(a.page, () => window.__jawafaState.branches.length === 1);
  // State updates first; the table is redrawn on the next animation frame, so wait for the DOM.
  const branchLink = await a.page.waitForFunction(() => document.querySelectorAll('section.view[data-view="branches"] td a[href*="32.0608,36.0942"]').length === 1, null, { timeout: 5000 }).then(() => true, () => false);
  check('E2E-24', branchLink, 'branch saved to Firestore and listed with a Google Maps link');
  await a.page.screenshot({ path: `${out}/08-branches.png` });
  await nav(a.page, 'audit');
  await waitState(a.page, () => ['company.create', 'member.invite', 'branch.create'].every(x => window.__jawafaState.audit.some(e => e.action === x)));
  const auditRows = await a.page.waitForFunction(() => { const t = document.querySelector('section.view[data-view="audit"] tbody')?.textContent || ''; return ['company.create', 'member.invite', 'branch.create'].every(x => t.includes(x)); }, null, { timeout: 5000 }).then(() => true, () => false);
  check('E2E-25', auditRows, 'audit viewer lists company.create, member.invite and branch.create');
  await a.page.screenshot({ path: `${out}/09-audit.png` });
  const prof = await a.page.evaluate(async () => { const d = await window.firebase.app().firestore().collection('profiles').doc(window.__jawafaState.user.uid).get(); return d.exists ? d.data().lastCompanyId === window.__jawafaState.companyId : false; });
  check('E2E-26', prof, 'user profile stores the last selected company in Firestore');
  await nav(a.page, 'agents'); await a.page.waitForTimeout(300);
  await a.page.locator('#msg-from').selectOption('agent-999');
  await a.page.locator('#msg-to').selectOption(['agent-777', 'agent-666']);
  await a.page.locator('#msg-body').fill('اختبار توجيه متعدد');
  await a.page.getByRole('button', { name: 'إرسال' }).click();
  await waitState(a.page, () => window.__jawafaState.messages.length === 1);
  const st = await a.page.evaluate(() => window.__jawafaState.messages[0].status);
  check('E2E-10', st === 'QUEUED', 'agent message persisted in Firestore with status ' + st + ' (no delivery channel → not advanced)');
  await a.page.screenshot({ path: `${out}/03-agents-signed-in.png` });

  // 3. Auditor accepts the invite and is read-only.
  const b = await open();
  await signIn(b.page, 'auditor.a@example.com', 'audA');
  await waitState(b.page, () => window.__jawafaState.invites.length === 1);
  await nav(b.page, 'company'); await b.page.waitForTimeout(300);
  await b.page.getByRole('button', { name: 'قبول' }).click();
  await waitState(b.page, () => window.__jawafaState.companies.length === 1);
  const r = await b.page.evaluate(() => window.JawafaCore.roleOf(window.__jawafaState.companies[0], window.__jawafaState.user.uid));
  check('E2E-11', r === 'auditor', 'invitee accepted and joined with role ' + r);
  await nav(b.page, 'company'); await b.page.waitForTimeout(300);
  check('E2E-12', await b.page.locator('input[name="name"]').isDisabled(), 'auditor sees company profile read-only');
  const denied = await expectDenial(() => b.page.evaluate(async () => {
    const fs = window.firebase.app().firestore(); const id = window.__jawafaState.companyId;
    try { await fs.collection('companies').doc(id).collection('workspaces').add({ name: 'x' }); return 'allowed'; } catch (e) { return e.code; }
  }));
  check('E2E-13', denied === 'permission-denied', 'auditor direct API write rejected by server: ' + denied);
  await nav(b.page, 'branches');
  await b.page.waitForFunction(() => document.querySelectorAll('section.view[data-view="branches"] tbody tr td a').length === 1, null, { timeout: 5000 }).catch(() => {});
  const ro = await b.page.evaluate(() => ({ form: !!document.querySelector('section.view[data-view="branches"] input[name="bname"]'), rows: document.querySelectorAll('section.view[data-view="branches"] tbody tr').length }));
  check('E2E-27', !ro.form && ro.rows === 1, 'auditor sees the company branch but no add form');

  // 4. A stranger cannot read company A, even by id through the API.
  const c = await open({ width: 390, height: 844 });
  await signIn(c.page, 'stranger@example.com', 'strangerX');
  await waitState(c.page, () => window.__jawafaState.user);
  const companyA = await a.page.evaluate(() => window.__jawafaState.companyId);
  const res = await expectDenial(() => c.page.evaluate(async (id) => {
    const fs = window.firebase.app().firestore(); const out = {};
    try { await fs.collection('companies').doc(id).get(); out.doc = 'allowed'; } catch (e) { out.doc = e.code; }
    try { await fs.collection('companies').doc(id).collection('agentMessages').get(); out.msgs = 'allowed'; } catch (e) { out.msgs = e.code; }
    try { await fs.collection('companies').doc(id).update({ plan: 'premium_plus' }); out.plan = 'allowed'; } catch (e) { out.plan = e.code; }
    return out;
  }, companyA));
  check('E2E-14', res.doc === 'permission-denied' && res.msgs === 'permission-denied' && res.plan === 'permission-denied', 'stranger API access to company A denied: ' + JSON.stringify(res));
  const planOwner = await expectDenial(() => a.page.evaluate(async () => { try { await window.firebase.app().firestore().collection('companies').doc(window.__jawafaState.companyId).update({ plan: 'premium_plus' }); return 'allowed'; } catch (e) { return e.code; } }));
  check('E2E-15', planOwner === 'permission-denied', 'owner cannot self-upgrade to Premium Plus: ' + planOwner);

  // 5. Mobile layout.
  await nav(c.page, 'home'); await c.page.waitForTimeout(400);
  const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('E2E-16', overflow <= 0, `no horizontal scroll at 390px (overflow ${overflow}px)`);
  check('E2E-17', await c.page.locator('#bottom-nav').isVisible(), 'mobile bottom navigation visible');
  await c.page.screenshot({ path: `${out}/04-home-mobile-390.png`, fullPage: false });
  await nav(c.page, 'company'); await c.page.waitForTimeout(400);
  await c.page.screenshot({ path: `${out}/05-company-mobile-stranger.png` });

  const all = [...a.errors, ...b.errors, ...c.errors].map(e => typeof e === 'string' ? { at: 0, text: e, url: '' } : e);
  const errs = all.filter(e => !/permission-denied|PERMISSION_DENIED|Missing or insufficient permissions/.test(e.text) && !isExpectedDenialNoise(e));
  const ignored = all.length - errs.length;
  check('E2E-18', errs.length === 0, 'no unexpected page/console errors' + (ignored ? ` (${ignored} expected denial log(s) ignored)` : '') + (errs.length ? ': ' + errs.slice(0, 3).map(e => e.text + ' @ ' + e.url).join(' | ') : ''));
  check('PERF-01', a.loadMs < 8000 && c.loadMs < 8000, `time to ready (load + Firebase SDK + emulator): desktop ${a.loadMs} ms, mobile ${c.loadMs} ms`);
} catch (e) {
  try { for (const [i, pg] of browser.contexts().flatMap(c => c.pages()).entries()) await pg.screenshot({ path: `${out}/fatal-${i}.png` }); } catch {}
  check('E2E-FATAL', false, String(e && e.stack || e).slice(0, 1500));
} finally {
  await browser.close(); server.close();
  await writeFile(`${out}/e2e-results.json`, JSON.stringify({ ranAt: new Date().toISOString(), environment: 'Firebase Auth + Firestore emulators, Chromium (Playwright), local static server', results }, null, 2));
  const failed = results.filter(r => r.result !== 'PASS').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
