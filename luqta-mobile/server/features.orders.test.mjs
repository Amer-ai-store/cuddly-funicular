import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, pngDataUrl } from './testkit.mjs';

test('L051 L053 L054 L055 history, timeline with live tracking and cancellation', async (t) => {
  const { request, register, order } = await fixture(t);
  const customer = await register();
  const first = await order(customer, [{ productId: 'milk', quantity: 1 }]), second = await order(customer, [{ productId: 'bread', quantity: 2 }]);
  const history = (await request('GET', '/orders', undefined, customer.token)).body.orders;
  assert.deepEqual(history.map((o) => o.id).sort(), [first.id, second.id].sort());
  const tracking = (await request('GET', `/orders/${first.id}/tracking`, undefined, customer.token)).body;
  assert.equal(tracking.events[0].status, 'pending'); assert.equal(tracking.destination.latitude, 31.95);
  const cancelled = await request('POST', `/orders/${second.id}/cancel`, {}, customer.token);
  assert.equal(cancelled.body.order.status, 'cancelled');
  assert.deepEqual(cancelled.body.order.events.map((e) => e.status), ['pending', 'cancelled']);
});

test('L060 L091 L092 drivers are assigned, share location and need the customer code to deliver', async (t) => {
  const { request, register, admin, order } = await fixture(t);
  const customer = await register(), driver = await register('سائق');
  await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token);
  const placed = await order(customer);
  await request('PATCH', `/admin/orders/${placed.id}`, { status: 'confirmed', driverId: driver.user.id }, admin.token);
  await request('PATCH', `/admin/orders/${placed.id}`, { status: 'preparing' }, admin.token);
  assert.equal((await request('GET', '/driver/orders', undefined, driver.token)).body.orders[0].id, placed.id);
  assert.equal((await request('GET', `/orders/${placed.id}/delivery-code`, undefined, customer.token)).body.code, null, 'no code before dispatch');
  await request('PATCH', `/driver/orders/${placed.id}`, { status: 'out_for_delivery' }, driver.token);
  assert.equal((await request('POST', `/driver/orders/${placed.id}/location`, { latitude: 31.96, longitude: 35.9 }, driver.token)).status, 200);
  const { code } = (await request('GET', `/orders/${placed.id}/delivery-code`, undefined, customer.token)).body;
  assert.ok((await request('GET', '/notifications', undefined, customer.token)).body.notifications.some((n) => n.body.includes(code)));
  const driverView = (await request('GET', '/driver/orders', undefined, driver.token)).body.orders[0];
  assert.equal(JSON.stringify(driverView).includes(code), false, 'the driver never sees the code');
  const wrong = code === '1234' ? '4321' : '1234';
  assert.equal((await request('PATCH', `/driver/orders/${placed.id}`, { status: 'delivered', otp: wrong }, driver.token)).body.code, 'invalid_delivery_code');
  assert.equal((await request('PATCH', `/driver/orders/${placed.id}`, { status: 'delivered', otp: code }, driver.token)).body.order.status, 'delivered');
  assert.equal((await request('GET', `/orders/${placed.id}/delivery-code`, undefined, customer.token)).body.verified, true);
});

test('L060 five wrong delivery codes lock the confirmation', async (t) => {
  const { request, register, admin, order } = await fixture(t);
  const customer = await register(), driver = await register('سائق');
  await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token);
  const placed = await order(customer);
  await request('PATCH', `/admin/orders/${placed.id}`, { status: 'confirmed', driverId: driver.user.id }, admin.token);
  await request('PATCH', `/admin/orders/${placed.id}`, { status: 'preparing' }, admin.token);
  await request('PATCH', `/driver/orders/${placed.id}`, { status: 'out_for_delivery' }, driver.token);
  const { code } = (await request('GET', `/orders/${placed.id}/delivery-code`, undefined, customer.token)).body;
  const wrong = code === '9999' ? '1111' : '9999';
  for (let i = 0; i < 5; i++) await request('PATCH', `/driver/orders/${placed.id}`, { status: 'delivered', otp: wrong }, driver.token);
  assert.equal((await request('PATCH', `/driver/orders/${placed.id}`, { status: 'delivered', otp: code }, driver.token)).status, 429);
});

test('L056 L057 returning selected items with a photo refunds only their share to the wallet', async (t) => {
  const { request, register, admin, order, deliver } = await fixture(t);
  const customer = await register();
  const placed = await order(customer, [{ productId: 'rice', quantity: 2 }, { productId: 'olive-oil', quantity: 1 }]);
  await deliver(customer, placed.id);
  const stockBefore = (await request('GET', '/products/rice')).body.product.stock;
  assert.equal((await request('POST', `/orders/${placed.id}/return-request`, { reason: 'الكيس ممزق عند الاستلام', items: [{ productId: 'rice', quantity: 3 }] }, customer.token)).status, 400, 'cannot return more than bought');
  const requested = await request('POST', `/orders/${placed.id}/return-request`, { reason: 'الكيس ممزق عند الاستلام', items: [{ productId: 'rice', quantity: 1 }], photo: pngDataUrl([200, 180, 150]) }, customer.token);
  assert.equal(requested.status, 201); assert.equal(requested.body.returnRequest.partial, true); assert.equal(requested.body.returnRequest.refund, 6.5); assert.ok(requested.body.returnRequest.photoId);
  const mine = (await request('GET', '/me/returns', undefined, customer.token)).body.returns[0];
  assert.equal(mine.items[0].quantity, 1);
  assert.match((await request('GET', `/uploads/${mine.photoId}`, undefined, customer.token)).body.upload.dataUrl, /^data:image\/png;base64,/);
  assert.equal((await request('GET', `/uploads/${mine.photoId}`, undefined, (await register()).token)).status, 404, 'photos are private');
  const approved = await request('PATCH', `/admin/returns/${mine.id}`, { status: 'approved' }, admin.token);
  assert.equal(approved.status, 200);
  const wallet = (await request('GET', '/wallet', undefined, customer.token)).body;
  assert.equal(wallet.balance, 6.5); assert.equal(wallet.transactions[0].type, 'return_refund');
  assert.equal((await request('GET', '/products/rice')).body.product.stock, stockBefore + 1, 'only the returned unit is restocked');
  assert.equal((await request('GET', `/orders/${placed.id}`, undefined, customer.token)).body.order.paymentStatus, 'partially_refunded');
});

test('L058 L059 invoice and a single rating per delivered order', async (t) => {
  const { request, register, order, deliver } = await fixture(t);
  const customer = await register('نور'), stranger = await register();
  const placed = await order(customer, [{ productId: 'eggs', quantity: 1 }], { gift: { wrap: true, message: 'مبروك' } });
  const invoice = (await request('GET', `/orders/${placed.id}/invoice`, undefined, customer.token)).body;
  assert.match(invoice.invoice.number, /^INV-/); assert.equal(invoice.invoice.giftWrapFee, 1.5); assert.equal(invoice.invoice.total, placed.total);
  assert.match(invoice.html, /<html lang="ar" dir="rtl">/); assert.ok(invoice.html.includes('بيض بلدي'));
  assert.equal((await request('GET', `/orders/${placed.id}/invoice`, undefined, stranger.token)).status, 403);
  assert.equal((await request('POST', `/orders/${placed.id}/rating`, { rating: 5 }, customer.token)).status, 409, 'rate after delivery');
  await deliver(customer, placed.id);
  const rated = await request('POST', `/orders/${placed.id}/rating`, { rating: 4, driverRating: 5, comment: 'وصل بسرعة' }, customer.token);
  assert.equal(rated.status, 201);
  assert.equal((await request('POST', `/orders/${placed.id}/rating`, { rating: 1 }, customer.token)).status, 409);
  assert.equal((await request('GET', `/orders/${placed.id}`, undefined, customer.token)).body.order.extras.rating.driverRating, 5);
});

test('L094 L095 slot capacity is managed by staff and the nearest branch is found from a map pin', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  const date = new Date(Date.now() + 3 * 3600_000 + 2 * 86400_000).toISOString().slice(0, 10);
  assert.equal((await request('PUT', '/admin/slots', { date, window: 'morning', capacity: 35 }, customer.token)).status, 403);
  assert.equal((await request('PUT', '/admin/slots', { date, window: 'brunch', capacity: 35 }, admin.token)).status, 400);
  assert.equal((await request('PUT', '/admin/slots', { date, window: 'morning', capacity: 35 }, admin.token)).body.slot.capacity, 35);
  assert.equal((await request('GET', '/admin/slots?days=4', undefined, admin.token)).body.slots.find((s) => s.date === date && s.window === 'morning').capacity, 35);
  const nearIrbid = (await request('GET', '/delivery/nearest?lat=32.55&lng=35.85')).body;
  assert.equal(nearIrbid.nearest.id, 'br_irbid'); assert.ok(nearIrbid.nearest.distanceKm < 5);
  assert.equal((await request('GET', '/delivery/nearest?lat=31.95&lng=35.9')).body.nearest.id, 'br_amman');
  assert.equal((await request('GET', '/delivery/nearest?lat=999&lng=0')).status, 400);
});
