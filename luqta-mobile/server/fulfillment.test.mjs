// Express delivery from the nearest branch, pickup at a branch, and a courier tip (Issue #121), on the branches table
// and its per-branch stock. Fees and times come from the server; the order keeps the shopper's choice.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommerceServer } from './commerce.mjs';

test('delivery options, express, pickup and tips are priced by the server and saved with the order', async (t) => {
  const app = await createCommerceServer({ dbPath: ':memory:' });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const shopper = await request('POST', '/auth/register', { name: 'متسوقة', email: 'fulfil@example.test', password: 'fulfilment-pass-123' });
  assert.equal(shopper.status, 201, JSON.stringify(shopper.body));
  const token = shopper.body.token;
  const items = [{ productId: 'milk', quantity: 1 }, { productId: 'headphones', quantity: 1 }];
  const irbid = { latitude: 32.55, longitude: 35.85 };
  const address = { name: 'متسوقة', phone: '0790000000', city: 'إربد', street: 'شارع الجامعة', ...irbid };

  // Without a location: no express, both branches offer pickup.
  const blind = await request('POST', '/delivery/options', { items });
  assert.equal(blind.status, 200);
  assert.equal(blind.body.express.available, false);
  assert.deepEqual(blind.body.tips, [0, 0.5, 1, 2]);
  assert.deepEqual(blind.body.pickup.map((b) => [b.branchId, b.available]).sort(), [['br_amman', true], ['br_irbid', true]]);

  // In Irbid: express from the University Street branch, about 1 km away.
  const near = await request('POST', '/delivery/options', { items, ...irbid });
  assert.equal(near.body.express.available, true, JSON.stringify(near.body.express));
  assert.equal(near.body.express.branch.id, 'br_irbid');
  assert.equal(near.body.express.fee, 2);
  assert.ok(near.body.express.etaMinutes >= 25 && near.body.express.etaMinutes < 35);
  // Amman is beyond the express radius from Irbid.
  const far = await request('POST', '/delivery/options', { items: [{ productId: 'milk', quantity: 1 }], latitude: 32.1, longitude: 36.1 });
  assert.equal(far.body.express.available, false);
  // A quantity no branch holds rules every option out.
  const tooMany = await request('POST', '/delivery/options', { items: [{ productId: 'milk', quantity: 999 }], ...irbid });
  assert.equal(tooMany.body.express.available, false);
  assert.ok(tooMany.body.pickup.every((b) => b.available === false));

  // The quote adds the express fee and the tip to the total.
  const standard = await request('POST', '/checkout/quote', { items, address }, token);
  const express = await request('POST', '/checkout/quote', { items, address, deliveryMode: 'express', tip: 1 }, token);
  assert.equal(express.status, 200, JSON.stringify(express.body));
  assert.equal(express.body.deliveryMode, 'express');
  assert.equal(express.body.shipping, Math.round((standard.body.shipping + 2) * 100) / 100);
  assert.equal(express.body.tip, 1);
  assert.equal(express.body.total, Math.round((standard.body.total + 2 + 1) * 100) / 100);
  assert.equal(express.body.fulfillment.branchName, 'فرع شارع الجامعة');
  const pickupQuote = await request('POST', '/checkout/quote', { items, address, deliveryMode: 'pickup', pickupBranchId: 'br_amman', tip: 2 }, token);
  assert.equal(pickupQuote.body.shipping, 0);
  assert.equal(pickupQuote.body.tip, 0, 'no courier, no tip');

  // Invalid choices are refused.
  assert.equal((await request('POST', '/checkout/quote', { items, address, tip: 0.7 }, token)).status, 400);
  assert.equal((await request('POST', '/checkout/quote', { items, address, deliveryMode: 'pickup', pickupBranchId: 'nope' }, token)).status, 400);
  assert.equal((await request('POST', '/checkout/quote', { items, address: { ...address, latitude: undefined, longitude: undefined }, deliveryMode: 'express' }, token)).status, 409);

  // A pickup order: no delivery fee, the branch's stock moves, the choice is kept with the order.
  const before = (await request('GET', '/branches/br_amman/stock')).body.stock.find((s) => s.productId === 'milk').quantity;
  const order = await request('POST', '/orders', { items, address, paymentMethod: 'cod', idempotencyKey: 'pickup-order-1', deliveryMode: 'pickup', pickupBranchId: 'br_amman' }, token);
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.order.shipping, 0);
  assert.equal(order.body.order.extras.fulfillment.mode, 'pickup');
  assert.equal(order.body.order.extras.fulfillment.branchName, 'فرع عبدون');
  assert.equal(order.body.order.extras.branchId, 'br_amman');
  assert.equal((await request('GET', '/branches/br_amman/stock')).body.stock.find((s) => s.productId === 'milk').quantity, before - 1);
  // An express order with a tip: the total carries both, the order remembers the branch and the time.
  const fast = await request('POST', '/orders', { items, address, paymentMethod: 'cod', idempotencyKey: 'express-order-1', deliveryMode: 'express', tip: 0.5 }, token);
  assert.equal(fast.status, 201, JSON.stringify(fast.body));
  assert.equal(fast.body.order.extras.fulfillment.mode, 'express');
  assert.equal(fast.body.order.extras.fulfillment.tip, 0.5);
  assert.equal(fast.body.order.extras.fulfillment.fee, 2);
  assert.ok(fast.body.order.extras.fulfillment.etaMinutes >= 25);
  assert.equal(fast.body.order.total, Math.round((fast.body.order.subtotal - fast.body.order.discount + fast.body.order.shipping + 0.5) * 100) / 100);
});
