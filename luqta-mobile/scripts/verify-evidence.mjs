// Fails unless every one of the 125 features has passing tests, and no failing ones, on each surface it lists
// (server, app, dashboard), according to server/feature-status.json written by scripts/feature-reporter.mjs.
// Run it after the server tests and both end-to-end suites: `npm run verify:features`.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../server/features.json', import.meta.url)), 'utf8'));
const statusPath = fileURLToPath(new URL('../server/feature-status.json', import.meta.url));
if (!existsSync(statusPath)) { console.error('server/feature-status.json is missing: run the tests with the feature reporter first.'); process.exit(1); }
const status = JSON.parse(readFileSync(statusPath, 'utf8'));
const gaps = [];
for (const feature of catalog.features) for (const surface of feature.surfaces) {
  const evidence = status.features?.[feature.id]?.surfaces?.[surface];
  if (!evidence?.passed) gaps.push(`${feature.id} ${surface}: no passing test — ${feature.titleEn}`);
  else if (evidence.failed) gaps.push(`${feature.id} ${surface}: ${evidence.failed} failing test(s) — ${feature.titleEn}`);
}
const checks = catalog.features.reduce((n, f) => n + f.surfaces.length, 0);
if (gaps.length) { console.error(`${gaps.length} of ${checks} feature surfaces lack evidence:\n${gaps.join('\n')}`); process.exit(1); }
console.log(`All ${catalog.total} features verified on all ${checks} surfaces (${status.summary.passed}/${status.summary.total} tests passed).`);
