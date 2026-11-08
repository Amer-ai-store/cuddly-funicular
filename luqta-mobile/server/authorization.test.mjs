// Access-control evidence (the app never talks to the database directly; the server enforces
// row-level ownership like RLS would): customers only see their own rows, roles are enforced,
// agent keys are scoped and revocable, an agent's order change is what the customer sees,
// critical calls answer in < 2 s and errors never leak internals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceServer } from './commerce.mjs';

const password = 'authorization-password-123';
const address = { name: 'عميل', phone: '+962790123456', city: 'عمان', street: 'شارع الاختبار 12' };
test('RLS-equivalent ownership, roles, scoped agent keys, agent→customer sync, latency and error hygiene', async (t) => {
  const app = await createCommerceServer({ dbPath: ':memory:', bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const slow = [];
  const req = async (method, path, body, token) => {
    const t0 = performance.now();
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const ms = performance.now() - t0; if (ms > 2000) slow.push(`${method} ${path} ${Math.round(ms)}ms`);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const admin = (await req('POST', '/auth/login', { email: 'admin@example.test', password })).body.token;
  const a = (await req('POST', '/auth/register', { name: 'العميل أ', email: 'a@example.test', password })).body.token;
  const b = (await req('POST', '/auth/register', { name: 'العميل ب', email: 'b@example.test', password })).body.token;
  // unauthenticated
  assert.equal((await req('GET', '/orders')).status, 401);
  assert.equal((await req('GET', '/admin/orders')).status, 401);
  // customer A data
  const order = (await req('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, paymentMethod: 'cod', idempotencyKey: 'authz-order-a-1' }, a)).body.order;
  const addr = (await req('POST', '/addresses', address, a)).body.address;
  assert.ok(order?.id && addr?.id);
  // customer B cannot read or change A's rows
  for (const [m, p] of [['GET', `/orders/${order.id}`], ['GET', `/orders/${order.id}/tracking`], ['GET', `/orders/${order.id}/evidence`], ['POST', `/orders/${order.id}/cancel`], ['POST', `/orders/${order.id}/returns`]]) {
    const r = await req(m, p, m === 'GET' ? undefined : { reason: 'محاولة' }, b);
    assert.ok([403, 404].includes(r.status), `${m} ${p} by another customer → ${r.status}`);
  }
  assert.ok([403, 404].includes((await req('PATCH', `/addresses/${addr.id}`, { ...address, street: 'تغيير' }, b)).status));
  assert.ok([403, 404].includes((await req('DELETE', `/addresses/${addr.id}`, undefined, b)).status));
  assert.equal((await req('GET', '/orders', undefined, b)).body.orders.length, 0, 'B sees none of A\'s orders');
  assert.equal((await req('GET', '/addresses', undefined, b)).body.addresses.length, 0);
  // customers cannot use admin or agent endpoints
  assert.equal((await req('GET', '/admin/orders', undefined, a)).status, 403);
  assert.equal((await req('PATCH', `/admin/orders/${order.id}`, { status: 'confirmed' }, a)).status, 403);
  assert.equal((await req('GET', '/ops/anomalies', undefined, a)).status, 403);
  // scoped agent keys (AAS-AW style operator)
  const catalogKey = (await req('POST', '/admin/agent-keys', { name: 'وكيل الكتالوج', scopes: ['catalog:write'] }, admin)).body;
  const ordersKey = (await req('POST', '/admin/agent-keys', { name: 'وكيل الطلبات', scopes: ['orders:write'] }, admin)).body;
  assert.equal((await req('PATCH', `/admin/orders/${order.id}`, { status: 'confirmed' }, catalogKey.token)).status, 403, 'wrong scope refused');
  assert.equal((await req('PATCH', `/admin/orders/${order.id}`, { status: 'confirmed' }, ordersKey.token)).status, 200);
  const seen = await req('GET', `/orders/${order.id}`, undefined, a);
  assert.equal(seen.body.order.status, 'confirmed', 'agent change is immediately what the customer sees');
  await req('DELETE', `/admin/agent-keys/${ordersKey.key.id}`, undefined, admin);
  assert.equal((await req('PATCH', `/admin/orders/${order.id}`, { status: 'preparing' }, ordersKey.token)).status, 401, 'revoked key stops working');
  // error hygiene: no stack traces or internals in error bodies
  const nf = await req('GET', '/does-not-exist', undefined, a);
  assert.equal(nf.status, 404); assert.deepEqual(Object.keys(nf.body).sort(), ['code', 'error']);
  const bad = await req('POST', '/orders', { items: 'x' }, a);
  assert.ok(bad.status >= 400 && bad.status < 500); assert.doesNotMatch(JSON.stringify(bad.body), /at \w+ \(|node:|\.mjs/);
  assert.deepEqual(slow, [], `slow critical calls: ${slow.join(', ')}`);
});

test('readiness probe reflects the database for real', async (t) => {
  const app = await createCommerceServer({ dbPath: ':memory:' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const ok = await (await fetch(base + '/ready')).json();
  assert.equal(ok.ok, true); assert.equal(ok.database, 'connected'); assert.ok(ok.products > 0);
  app.db.close();
  const down = await fetch(base + '/health');
  assert.equal(down.status, 503); assert.equal((await down.json()).database, 'error');
  await new Promise((r) => app.server.close(r));
});
