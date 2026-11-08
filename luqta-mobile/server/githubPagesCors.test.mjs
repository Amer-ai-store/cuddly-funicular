import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommerceServer } from './commerce.mjs';

for (const origin of ['https://amer-ai-store.github.io', 'https://amer-ai-command-center.eagerlark64.chatgpt.site']) test(`the dashboard at ${origin} can call the commerce API with Bearer auth`, async (t) => {
  const app = await createCommerceServer({ dbPath: ':memory:' });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;

  const preflight = await fetch(`${base}/agent/capabilities`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/i);
  assert.match(preflight.headers.get('vary'), /Origin/i);

  const health = await fetch(`${base}/health`, { headers: { Origin: origin, Authorization: 'Bearer invalid-token' } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), origin);
  assert.equal((await health.json()).service, 'luqta-commerce');

  const unauthorized = await fetch(`${base}/agent/capabilities`, { headers: { Origin: origin, Authorization: 'Bearer invalid-token' } });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), origin);

  const attacker = await fetch(`${base}/health`, { headers: { Origin: `${origin}.attacker.example` } });
  assert.equal(attacker.status, 403);
  assert.notEqual(attacker.headers.get('access-control-allow-origin'), `${origin}.attacker.example`);
});
