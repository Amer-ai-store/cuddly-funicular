import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, address, password } from './testkit.mjs';

test('P1: vendor cannot attach a variant to store-owned or foreign vendor products', async (t) => {
  const { request, register, admin } = await fixture(t);
  const seller = await register('تاجر', 'seller-pr135');
  const vendor = (await request('POST', '/admin/vendors', { name: 'متجر الفحص', commission: 10 }, admin.token)).body.vendor;
  assert.equal((await request('POST', `/admin/vendors/${vendor.id}/members`, { email: 'seller-pr135@example.test', role: 'owner' }, admin.token)).status, 201);
  assert.equal((await request('POST', `/vendor/${vendor.id}/products`, { id: 'vendor-pr135-item', name: 'قطعة اختبار', price: 2, category: 'home', stock: 5 }, seller.token)).status, 201);
  const forbidden = await request('PATCH', `/vendor/${vendor.id}/products/vendor-pr135-item`, { variantOf: 'mug', variantLabel: 'مقاس صغير', price: 1 }, seller.token);
  assert.equal(forbidden.status, 403);
  assert.equal((await request('GET', '/products/mug')).body.product.hasVariants, false);
});

test('P2: a flash deal rejects an order exceeding the remaining allocation', async (t) => {
  const { request, register, admin, order, db } = await fixture(t);
  const customer = await register();
  const end = new Date(Date.now() + 3600_000).toISOString();
  const deal = await request('POST', '/admin/flash-deals', { productId: 'milk', price: 0.5, endsAt: end, limit: 1 }, admin.token);
  assert.equal(deal.status, 201, JSON.stringify(deal.body));
  const excess = await request('POST', '/orders', { items: [{ productId: 'milk', quantity: 5 }], address, idempotencyKey: 'flash-overrun' }, customer.token);
  assert.equal(excess.status, 409);
  assert.equal(excess.body.code, 'flash_deal_limit_exceeded');
  const placed = await order(customer, [{ productId: 'milk', quantity: 1 }]);
  assert.equal(placed.items[0].price, 0.5);
  assert.equal(db.prepare('SELECT sold FROM flash_deals WHERE id=?').get(deal.body.deal.id).sold, 1);
});

test('P2: approved partial return restores the originating branch stock', async (t) => {
  const { request, register, admin, order, deliver, db } = await fixture(t);
  const customer = await register();
  const initial = db.prepare("SELECT quantity FROM branch_stock WHERE branch_id='br_amman' AND product_id='mug'").get().quantity;
  const placed = await order(customer, [{ productId: 'mug', quantity: 2 }], { branchId: 'br_amman' });
  assert.equal(db.prepare("SELECT quantity FROM branch_stock WHERE branch_id='br_amman' AND product_id='mug'").get().quantity, initial - 2);
  await deliver(customer, placed.id);
  const requested = await request('POST', `/orders/${placed.id}/return-request`, { reason: 'قطعة تالفة', items: [{ productId: 'mug', quantity: 1 }] }, customer.token);
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal((await request('PATCH', `/admin/returns/${requested.body.returnRequest.id}`, { status: 'approved' }, admin.token)).status, 200);
  assert.equal(db.prepare("SELECT quantity FROM branch_stock WHERE branch_id='br_amman' AND product_id='mug'").get().quantity, initial - 1);
});

test('P2: deleting an account removes delivery notes and gift recipient data', async (t) => {
  const { request, register, db } = await fixture(t);
  const customer = await register('عميلة', 'privacy-pr135');
  const created = await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, deliveryNotes: 'الرمز 4321 والهاتف 0799999999', gift: { wrap: true, message: 'رسالة شخصية', recipient: 'شخص خاص' }, idempotencyKey: 'privacy-pr135' }, customer.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.order.id;
  assert.equal((await request('POST', `/orders/${orderId}/cancel`, {}, customer.token)).status, 200);
  assert.equal((await request('DELETE', '/auth/me', { confirm: 'حذف حسابي', password }, customer.token)).status, 200);
  const extra = JSON.parse(db.prepare('SELECT data FROM order_extras WHERE order_id=?').get(orderId).data);
  assert.equal(extra.deliveryNotes, '');
  assert.deepEqual(extra.gift, { wrap: true, fee: 1.5 });
  assert.equal(JSON.stringify(extra).includes('4321'), false);
  assert.equal(JSON.stringify(extra).includes('شخص خاص'), false);
});
