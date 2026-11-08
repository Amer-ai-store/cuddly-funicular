import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';

const password = 'inventory-test-password-123';

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-undo-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'store.sqlite'), bootstrapAdmin: { name: 'مدير المخزون', email: 'admin@example.test', password } });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  const customer = (await request('POST', '/auth/register', { name: 'عميل', email: 'customer@example.test', password })).body;
  return { ...app, request, admin, customer };
}

test('undo restores existing product exactly, removes new product, and is single use', async (t) => {
  const { db, request, admin, customer } = await fixture(t);
  const before = db.prepare('SELECT * FROM products WHERE id=?').get('mug');
  const imported = await request('POST', '/admin/inventory/import', { csv: 'id,name,price,stock,category\nmug,كوب جديد,9,3,home\nundo-new,منتج جديد,12,5,home' }, admin.token);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.created, 1);
  const latest = await request('GET', '/admin/inventory/undo', undefined, admin.token);
  assert.equal(latest.status, 200);
  assert.equal(latest.body.undo.id, imported.body.importId);
  assert.equal(latest.body.undo.count, 2);
  assert.equal((await request('GET', '/admin/inventory/undo', undefined, customer.token)).status, 403);
  assert.equal((await request('POST', '/admin/inventory/undo', { importId: 'not-current' }, admin.token)).status, 409);
  assert.equal((await request('PUT', '/wishlist', { productIds: ['undo-new'] }, customer.token)).status, 200);
  assert.equal((await request('POST', '/admin/inventory/undo', { importId: imported.body.importId }, admin.token)).body.code, 'inventory_referenced');
  assert.equal((await request('PUT', '/wishlist', { productIds: [] }, customer.token)).status, 200);
  const undone = await request('POST', '/admin/inventory/undo', { importId: imported.body.importId }, admin.token);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.restored, 1);
  assert.equal(undone.body.removed, 1);
  assert.deepEqual(db.prepare('SELECT * FROM products WHERE id=?').get('mug'), before);
  assert.equal((await request('GET', '/products/undo-new')).status, 404);
  assert.equal((await request('GET', '/admin/inventory/undo', undefined, admin.token)).body.undo, null);
  assert.equal((await request('POST', '/admin/inventory/undo', { importId: imported.body.importId }, admin.token)).status, 409);
  const audit = (await request('GET', '/admin/audit', undefined, admin.token)).body.events;
  assert.equal(audit.filter((item) => item.action === 'inventory.undo' && item.entityId === imported.body.importId).length, 1);
});

test('undo refuses to overwrite a purchase or a later product edit', async (t) => {
  const { db, request, admin, customer } = await fixture(t);
  const first = await request('POST', '/admin/inventory/import', { items: [{ id: 'mug', stock: 8 }], mode: 'replace' }, admin.token);
  assert.equal(first.status, 200);
  const purchased = await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address: { name: 'عميل', phone: '+962790123456', city: 'عمّان', street: 'شارع الاختبار' }, paymentMethod: 'cod', idempotencyKey: 'undo-purchase' }, customer.token);
  assert.equal(purchased.status, 201, JSON.stringify(purchased.body));
  assert.equal((await request('POST', '/admin/inventory/undo', { importId: first.body.importId }, admin.token)).body.code, 'inventory_changed');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get('mug').stock, 7);
  const second = await request('POST', '/admin/inventory/import', { items: [{ id: 'mug', stock: 12 }], mode: 'replace' }, admin.token);
  assert.equal(second.status, 200);
  assert.equal((await request('PATCH', '/admin/products/mug', { stock: 13 }, admin.token)).status, 200);
  assert.equal((await request('POST', '/admin/inventory/undo', { importId: second.body.importId }, admin.token)).body.code, 'inventory_changed');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get('mug').stock, 13);
});
