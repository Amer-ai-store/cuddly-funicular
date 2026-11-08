// Guards the 125-feature catalog: every feature must be cited by tests on each surface it lists, its app screen must
// exist, and its dashboard section must be reachable. Passing evidence itself is checked by scripts/verify-evidence.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../scripts/features-catalog.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const catalog = buildCatalog();
const titles = (dir, pattern, call) => readdirSync(join(ROOT, dir)).filter((f) => pattern.test(f)).flatMap((f) => [...read(join(dir, f)).matchAll(new RegExp(`\\b${call}\\(\\s*(['"\`])((?:(?!\\1).)*)\\1`, 'g'))].map((m) => m[2]));
const cited = (list) => new Set(list.flatMap((t) => t.match(/L\d{3}/g) || []));
const missing = (surface, ids) => catalog.features.filter((f) => f.surfaces.includes(surface) && !ids.has(f.id)).map((f) => `${f.id} ${f.titleEn}`);

test('the published catalog matches its source and lists 125 features', () => {
  assert.deepEqual(JSON.parse(read('server/features.json')), catalog);
  assert.equal(catalog.features.length, 125);
  assert.deepEqual(catalog.features.map((f) => f.id), Array.from({ length: 125 }, (_, i) => `L${String(i + 1).padStart(3, '0')}`));
});

test('every server-side feature is cited by a server test', () => {
  const ids = cited([...titles('server', /\.test\.mjs$/, 'test'), ...titles('src/lib', /\.test\.mjs$/, 'test')]);
  assert.deepEqual(missing('server', ids), []);
});

test('every app feature is driven by an end-to-end browser test', () => {
  assert.deepEqual(missing('app', cited(titles('e2e', /^app.*\.e2e\.mjs$/, 'e2e'))), []);
});

test('every dashboard feature is driven by an end-to-end dashboard test', () => {
  assert.deepEqual(missing('dashboard', cited(titles('e2e', /^dashboard.*\.e2e\.mjs$/, 'e2e'))), []);
});

test('every app feature points at a screen that exists', () => {
  const screen = (route) => { const base = route === '/' ? 'index' : route.slice(1); return [`src/app/${base}.tsx`, `src/app/${base}/index.tsx`].some((p) => existsSync(join(ROOT, p))); };
  assert.deepEqual(catalog.features.filter((f) => f.app && !screen(f.app)).map((f) => `${f.id} ${f.app}`), []);
});

test('every dashboard feature points at a section the dashboard can draw and deep-link to', () => {
  const integration = readFileSync(join(ROOT, '../dashboard/luqta-integration.js'), 'utf8');
  const index = readFileSync(join(ROOT, '../dashboard/index.html'), 'utf8');
  const tabs = new Set([...integration.match(/const tabs = \[([\s\S]*?)\];/)[1].matchAll(/\["([a-z]+)",/g)].map((m) => m[1]));
  const renderers = integration.match(/const renderers = \{([\s\S]*?)\};/)[1];
  const problems = [];
  for (const f of catalog.features.filter((x) => x.dashboard)) {
    if (!tabs.has(f.dashboard)) problems.push(`${f.id}: no "${f.dashboard}" tab`);
    if (!new RegExp(`\\b${f.dashboard}:`).test(renderers)) problems.push(`${f.id}: no renderer for "${f.dashboard}"`);
    if (f.dashboard !== 'overview' && !index.includes(`["luqta/${f.dashboard}",`)) problems.push(`${f.id}: no deep link #luqta/${f.dashboard}`);
  }
  assert.deepEqual(problems, []);
});
