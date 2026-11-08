import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommerceServer } from './commerce.mjs';

test('admin discount prices persist and can be cleared without invalid offers', async (t) => {
  const app = await createCommerceServer({ dbPath: ':memory:', bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password: 'offers-password-123' } });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const login = await request('POST', '/auth/login', { email: 'admin@example.test', password: 'offers-password-123' });
  const token = login.body.token;
  assert.equal(login.status, 200);
  const created = await request('POST', '/admin/products', { id: 'discount-bag', name: 'حقيبة مخفضة', price: 10, oldPrice: 15, stock: 2, category: 'fashion' }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await request('GET', '/products/discount-bag')).body.product.oldPrice, 15);
  assert.equal((await request('PATCH', '/admin/products/discount-bag', { oldPrice: 9 }, token)).status, 400);
  assert.equal((await request('PATCH', '/admin/products/discount-bag', { oldPrice: '20' }, token)).status, 400);
  assert.equal((await request('GET', '/products/discount-bag')).body.product.oldPrice, 15);
  const cleared = await request('PATCH', '/admin/products/discount-bag', { oldPrice: null }, token);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.product.oldPrice, undefined);
  assert.equal((await request('GET', '/products/discount-bag')).body.product.oldPrice, undefined);
});
