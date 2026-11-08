// node:test reporter: prints a compact spec-style log and records, per feature id (L001–L125) cited in test titles,
// which tests passed or failed and on which surface. The surface comes from the test file: e2e/app*.e2e.mjs drives the
// app, e2e/dashboard*.e2e.mjs drives the central dashboard, everything else exercises the server. Each run replaces the
// suites it ran inside server/feature-status.json, which /api/admin/features and both dashboards read as evidence.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../server/feature-status.json', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SURFACE_OF_SUITE = { server: 'server', 'app-e2e': 'app', 'dashboard-e2e': 'dashboard' };
export const suiteOf = (file) => (/(^|\/)e2e\/app[^/]*\.e2e\.mjs$/.test(file) ? 'app-e2e' : /(^|\/)e2e\/dashboard[^/]*\.e2e\.mjs$/.test(file) ? 'dashboard-e2e' : 'server');

export function summarize(suites) {
  const all = Object.values(suites).flatMap((s) => s.tests);
  const features = {};
  for (const [suite, { tests }] of Object.entries(suites)) for (const t of tests) for (const id of t.features) {
    const entry = features[id] || (features[id] = { tests: [], failed: false, surfaces: {} });
    const surface = entry.surfaces[SURFACE_OF_SUITE[suite]] || (entry.surfaces[SURFACE_OF_SUITE[suite]] = { passed: 0, failed: 0 });
    entry.tests.push(t.name);
    if (t.passed) surface.passed++; else { surface.failed++; entry.failed = true; }
  }
  const passed = all.filter((t) => t.passed).length;
  return { summary: { total: all.length, passed, failed: all.length - passed }, tests: all, features };
}

export default async function* featureReporter(source) {
  const tests = [];
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') { if (event.type === 'test:diagnostic' && /^(tests|pass|fail|duration_ms) /.test(event.data.message)) yield `# ${event.data.message}\n`; continue; }
    const { name, nesting, file, details } = event.data;
    if (nesting !== 0 || details?.type === 'suite') continue;
    const passed = event.type === 'test:pass' && !event.data.skip;
    const path = file ? relative(ROOT, file.startsWith('file:') ? fileURLToPath(file) : file) : '';
    tests.push({ name, passed, features: [...new Set(name.match(/L\d{3}/g) || [])], file: path, suite: suiteOf(path) });
    yield `${passed ? 'ok' : 'not ok'} - ${name}\n`;
    if (!passed && details?.error) yield `  ${String(details.error.message || details.error).split('\n').slice(0, 6).join('\n  ')}\n`;
  }
  if (!tests.length) return;
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const suites = { ...(previous.suites || {}) };
  const generatedAt = new Date().toISOString();
  for (const suite of new Set(tests.map((t) => t.suite))) suites[suite] = { generatedAt, tests: tests.filter((t) => t.suite === suite) };
  const result = summarize(suites);
  writeFileSync(OUT, `${JSON.stringify({ generatedAt, summary: result.summary, suites, tests: result.tests, features: result.features }, null, 1)}\n`);
  yield `# feature evidence: ${Object.keys(result.features).length} features cited, ${result.summary.passed}/${result.summary.total} tests passed → server/feature-status.json\n`;
}
