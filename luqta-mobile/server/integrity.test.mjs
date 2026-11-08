// Audit gates: (1) no dead in-app links and no app→server call to a non-existent endpoint;
// (2) every server route answers a garbage/empty request with a handled 2xx/3xx/4xx — never 500 (503 «not configured» for an unlinked provider is an intentional, explained answer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createCommerceServer } from './commerce.mjs';

const here = new URL('.', import.meta.url).pathname;
test('integrity: every navigation target and API call in the app is real', () => {
  const out = execFileSync(process.execPath, [new URL('../tools/integrity-check.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.match(out, /dead: 0/); assert.match(out, /unknown: 0/);
});

test('integrity: every server route handles empty/invalid input without a 500', async (t) => {
  const src = readdirSync(here).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => readFileSync(here + f, 'utf8')).join('\n');
  const routes = new Map();
  for (const m of src.matchAll(/method === '(GET|POST|PUT|PATCH|DELETE)' && path === '(\/api\/[^']+)'/g)) routes.set(`${m[1]} ${m[2]}`, [m[1], m[2]]);
  for (const m of src.matchAll(/method === '(GET|POST|PUT|PATCH|DELETE)' && \(\w+ = (?:path\.match\()?\/\^\\\/api\\\/(.+?)\$\//g)) {
    const sample = '/api/' + m[2].replace(/\\\//g, '/').replace(/\([^)]*\)/g, 'zz-missing-1');
    routes.set(`${m[1]} ${sample}`, [m[1], sample]);
  }
  for (const m of src.matchAll(/path === '(\/api\/[^']+)'/g)) for (const meth of ['GET', 'POST']) if (![...routes.values()].some(([, p]) => p === m[1])) routes.set(`${meth} ${m[1]}`, [meth, m[1]]);
  for (const m of src.matchAll(/p\[2\] === '([\w-]+)'/g)) for (const meth of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) { routes.set(`${meth} /api/admin/${m[1]}`, [meth, `/api/admin/${m[1]}`]); routes.set(`${meth} /api/admin/${m[1]}/zz-missing-1`, [meth, `/api/admin/${m[1]}/zz-missing-1`]); }
  assert.ok(routes.size > 120, `route inventory too small: ${routes.size}`); t.diagnostic(`routes fuzzed: ${routes.size} × anon/admin`);
  const app = await createCommerceServer({ dbPath: ':memory:', bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password: 'integrity-password-123' } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const admin = (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'integrity-password-123' }) })).json()).token;
  const failures = [];
  for (const [method, path] of routes.values()) {
    if (/\/api\/auth\/(google|facebook)\/(start|callback)/.test(path)) continue; // redirects to external providers
    for (const token of [null, admin]) {
      const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.' + (failures.length % 200), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(method === 'GET' ? {} : { body: '{}' }) });
      if (r.status >= 500) { const txt = await r.text(); if (r.status === 500 || !/_not_configured|gateway/.test(txt)) failures.push(`${method} ${path} ${token ? 'admin' : 'anon'} → ${r.status} ${txt.slice(0, 120)}`); }
    }
  }
  assert.deepEqual(failures, [], `server errors:\n${failures.join('\n')}`);
});
