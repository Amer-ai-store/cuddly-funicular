import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';

test('a configured inventory connector imports remote quantities without exposing its token', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-inventory-connector-'));
  const calls = [];
  const app = await createCommerceServer({
    dbPath: resolve(directory, 'store.sqlite'),
    bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password: 'connector-password-123' },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), authorization: options.headers.Authorization, redirect: options.redirect });
      return new Response(JSON.stringify({ items: [{ id: 'mug', stock: 14 }, { id: 'remote-bag', name: 'حقيبة', category: 'fashion', price: 22, stock: 7 }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const login = await request('POST', '/auth/login', { email: 'admin@example.test', password: 'connector-password-123' });
  assert.equal(login.status, 200);
  const adminToken = login.body.token;
  const customer = await request('POST', '/auth/register', { name: 'عميل', email: 'customer@example.test', password: 'customer-password-123' });
  assert.equal(customer.status, 201);
  assert.equal((await request('PUT', '/admin/inventory/connector', { url: 'https://93.184.215.14/inventory.json', token: 'private-inventory-token' }, customer.body.token)).status, 403);

  const configured = await request('PUT', '/admin/inventory/connector', { url: 'https://93.184.215.14/inventory.json', token: 'private-inventory-token' }, adminToken);
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.equal(configured.body.connector.tokenConfigured, true);
  assert.ok(!JSON.stringify(configured.body).includes('private-inventory-token'));
  const synced = await request('POST', '/admin/inventory/sync', {}, adminToken);
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.imported, 2);
  assert.equal(synced.body.created, 1);
  assert.equal(synced.body.updated, 1);
  assert.deepEqual(calls, [{ url: 'https://93.184.215.14/inventory.json', authorization: 'Bearer private-inventory-token', redirect: 'error' }]);
  assert.ok(!JSON.stringify(synced.body).includes('private-inventory-token'));
  assert.ok(synced.body.connector.lastSyncAt);
  assert.deepEqual(synced.body.connector.lastResult, { imported: 2, created: 1, updated: 1 });
  assert.equal((await request('GET', '/products/mug')).body.product.stock, 14);
  assert.equal((await request('GET', '/products/remote-bag')).body.product.stock, 7);
  assert.equal((await request('POST', '/admin/inventory/sync', {}, customer.body.token)).status, 403);
});
