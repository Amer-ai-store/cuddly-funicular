// No live credentials in the luqta-mobile source tree (keys live only in server env / CI secrets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('secret scan: no credentials committed under luqta-mobile', () => {
  const root = new URL('..', import.meta.url).pathname;
  const out = execFileSync(process.execPath, [root + 'tools/secret-scan.mjs'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /0 finding\(s\)/);
});
