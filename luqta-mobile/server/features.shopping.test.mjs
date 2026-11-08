import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, address } from './testkit.mjs';

const tomorrow = (offsetMinutes = 180) => new Date(Date.now() + offsetMinutes * 60_000 + 86400_000).toISOString().slice(0, 10);

test('L031 favourites sync with the account across devices', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register('هبة', 'hiba');
  await request('PUT', '/wishlist', { productIds: ['milk', 'rice'] }, customer.token);
  const other = (await request('POST', '/auth/login', { email: 'hiba@example.test', password: 'a-test-only-password-123' })).body;
  assert.deepEqual((await request('GET', '/wishlist', undefined, other.token)).body.productIds, ['milk', 'rice']);
  assert.equal((await request('PUT', '/wishlist', { productIds: ['no-such-product'] }, other.token)).status, 400);
});

test('L033 L034 personal lists and a shared family list with join codes and notifications', async (t) => {
  const { request, register } = await fixture(t);
  const mum = await register('أم أحمد'), son = await register('أحمد'), outsider = await register();
  const list = (await request('POST', '/lists', { name: 'بيت العائلة' }, mum.token)).body.list;
  await request('POST', `/lists/${list.id}/items`, { productId: 'milk', quantity: 2 }, mum.token);
  await request('POST', `/lists/${list.id}/items`, { productId: 'milk', quantity: 1 }, mum.token);
  const withText = (await request('POST', `/lists/${list.id}/items`, { title: 'مناديل', quantity: 3 }, mum.token)).body.list;
  assert.equal(withText.items.find((i) => i.productId === 'milk').quantity, 3, 'same product merges');
  assert.equal(withText.estimatedTotal, 3.45);
  assert.equal((await request('GET', `/lists/${list.id}`, undefined, outsider.token)).status, 404);
  const { code } = (await request('POST', `/lists/${list.id}/share`, {}, mum.token)).body;
  assert.match(code, /^[A-Z0-9]{8}$/);
  const joined = (await request('POST', '/lists/join', { code: code.toLowerCase() }, son.token)).body.list;
  assert.equal(joined.kind, 'family'); assert.equal(joined.members.length, 2); assert.equal(joined.shareCode, null, 'only the owner sees the code');
  await request('POST', `/lists/${list.id}/items`, { productId: 'bread' }, son.token);
  assert.ok((await request('GET', '/notifications', undefined, mum.token)).body.notifications.some((n) => n.title.includes('بيت العائلة')));
  const item = joined.items.find((i) => i.title === 'مناديل');
  assert.equal((await request('PATCH', `/lists/${list.id}/items/${item.id}`, { checked: true }, son.token)).body.list.checkedCount, 1);
  assert.equal((await request('DELETE', `/lists/${list.id}`, undefined, son.token)).status, 403);
  await request('DELETE', `/lists/${list.id}/share`, undefined, mum.token);
  assert.equal((await request('POST', '/lists/join', { code }, outsider.token)).status, 404, 'stopped sharing');
  assert.equal((await request('DELETE', `/lists/${list.id}/members/${son.user.id}`, undefined, son.token)).status, 200, 'members can leave');
});

test('L038 L039 L040 server-side quote with coupons and delivery fees by zone', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  await request('POST', '/admin/coupons', { code: 'FRESH10', type: 'percent', value: 10 }, admin.token);
  const items = [{ productId: 'rice', quantity: 2, price: 0.01 }];
  const amman = (await request('POST', '/checkout/quote', { items, couponCode: 'FRESH10', address: { city: 'عمّان' } }, customer.token)).body;
  assert.equal(amman.subtotal, 13, 'client prices are ignored'); assert.equal(amman.discount, 1.3); assert.equal(amman.shipping, 2.5); assert.equal(amman.zone.id, 'zone_amman');
  const irbid = (await request('POST', '/checkout/quote', { items, address: { city: 'إربد' } }, customer.token)).body;
  assert.equal(irbid.shipping, 3.5); assert.equal(irbid.freeShippingRemaining, 32);
  const bad = (await request('POST', '/checkout/quote', { items, couponCode: 'NOPE', address: { city: 'عمان' } })).body;
  assert.equal(bad.discount, 0); assert.match(bad.couponError, /غير صالح/);
  const zone = await request('POST', '/admin/zones', { name: 'العقبة', cities: ['العقبة', 'aqaba'], fee: 5, freeOver: 60, minOrder: 15, etaMinutes: 480 }, admin.token);
  assert.equal(zone.status, 201);
  assert.equal((await request('POST', '/checkout/quote', { items: [{ productId: 'milk', quantity: 1 }], address: { city: 'العقبة' } }, customer.token)).body.code, 'zone_minimum');
  const placed = await request('POST', '/orders', { items: [{ productId: 'rice', quantity: 3 }], address: { ...address, city: 'العقبة' }, idempotencyKey: 'aqaba-order' }, customer.token);
  assert.equal(placed.body.order.shipping, 5); assert.equal(placed.body.order.extras.zone.name, 'العقبة');
});

test('L041 L042 L043 delivery slots with capacity, delivery notes and terms acceptance', async (t) => {
  const { request, register, admin, order } = await fixture(t);
  const one = await register(), two = await register();
  const date = tomorrow();
  const slots = (await request('GET', '/delivery/slots?days=2')).body.slots;
  assert.equal(slots.length, 6); assert.ok(slots.filter((s) => s.date === date).every((s) => s.available));
  assert.equal((await request('PUT', '/admin/slots', { date, window: 'evening', capacity: 1 }, admin.token)).status, 200);
  const first = await order(one, [{ productId: 'milk', quantity: 1 }], { deliverySlot: { date, window: 'evening' }, deliveryNotes: 'اتصل قبل الوصول', acceptTerms: true });
  assert.equal(first.extras.slot.window, 'evening'); assert.equal(first.extras.deliveryNotes, 'اتصل قبل الوصول'); assert.ok(first.extras.termsAcceptedAt);
  const full = await request('POST', '/orders', { items: [{ productId: 'milk', quantity: 1 }], address, deliverySlot: { date, window: 'evening' }, idempotencyKey: 'slot-full' }, two.token);
  assert.equal(full.status, 409); assert.equal(full.body.code, 'slot_unavailable');
  assert.equal((await request('PUT', '/admin/slots', { date, window: 'evening', capacity: 0 }, admin.token)).status, 409, 'cannot shrink below bookings');
  await request('POST', `/orders/${first.id}/cancel`, {}, one.token);
  assert.equal((await request('GET', '/delivery/slots?days=2')).body.slots.find((s) => s.date === date && s.window === 'evening').booked, 0, 'cancel releases the slot');
});

test('L043 stores can require accepting the terms before an order is placed', async (t) => {
  const { request, register, db } = await fixture(t);
  db.prepare("UPDATE settings SET value='true' WHERE key='requireTerms'").run();
  const customer = await register();
  const refused = await request('POST', '/orders', { items: [{ productId: 'bread', quantity: 1 }], address, idempotencyKey: 'no-terms' }, customer.token);
  assert.equal(refused.status, 400); assert.equal(refused.body.code, 'terms_required');
  const accepted = await request('POST', '/orders', { items: [{ productId: 'bread', quantity: 1 }], address, acceptTerms: true, idempotencyKey: 'with-terms' }, customer.token);
  assert.equal(accepted.status, 201);
});

test('L044 L045 L049 cash on delivery, wallet payment and duplicate-order protection', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  const payload = { items: [{ productId: 'eggs', quantity: 1 }], address, paymentMethod: 'cod', idempotencyKey: 'same-tap-twice' };
  const first = await request('POST', '/orders', payload, customer.token), again = await request('POST', '/orders', payload, customer.token);
  assert.equal(first.body.order.paymentStatus, 'pending'); assert.equal(again.body.reused, true); assert.equal(again.body.order.id, first.body.order.id);
  assert.equal((await request('POST', '/orders', { ...payload, paymentMethod: 'wallet', idempotencyKey: 'no-money' }, customer.token)).body.code, 'insufficient_balance');
  await request('POST', '/admin/wallet/adjust', { userId: customer.user.id, amount: 20, note: 'رصيد تجريبي للاختبار' }, admin.token);
  const paid = await request('POST', '/orders', { ...payload, paymentMethod: 'wallet', idempotencyKey: 'wallet-pay' }, customer.token);
  assert.equal(paid.body.order.paymentStatus, 'paid');
  assert.equal((await request('GET', '/wallet', undefined, customer.token)).body.balance, 20 - paid.body.order.total);
});

test('L046 sandbox card payments accept only test cards, never store card numbers, and handle declines', async (t) => {
  const { request, register, db } = await fixture(t);
  const customer = await register();
  const card = { expMonth: 12, expYear: new Date().getFullYear() + 2, cvc: '123', name: 'Test Buyer' };
  assert.equal((await request('POST', '/payments/card/tokenize', { ...card, number: '4111111111111112' }, customer.token)).body.code, 'invalid_card', 'Luhn check');
  assert.equal((await request('POST', '/payments/card/tokenize', { ...card, number: '4111111111111111' }, customer.token)).body.code, 'sandbox_only', 'real-looking cards are refused');
  assert.equal((await request('POST', '/payments/card/tokenize', { ...card, number: '4242424242424242', expYear: 2020 }, customer.token)).body.code, 'expired_card');
  const token = (await request('POST', '/payments/card/tokenize', { ...card, number: '4242 4242 4242 4242' }, customer.token)).body;
  assert.equal(token.last4, '4242'); assert.equal(token.sandbox, true);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM payment_tokens').all()).includes('4242424242424242'), false, 'full number is never stored');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM payment_tokens').all()).includes('"123"'), false, 'CVC is never stored');
  const order = await request('POST', '/orders', { items: [{ productId: 'cheese', quantity: 1 }], address, paymentMethod: 'card', cardToken: token.token, idempotencyKey: 'card-payment-ok' }, customer.token);
  assert.equal(order.status, 201); assert.equal(order.body.order.paymentStatus, 'paid'); assert.equal(order.body.order.extras.payment.last4, '4242');
  assert.equal((await request('POST', '/orders', { items: [{ productId: 'cheese', quantity: 1 }], address, paymentMethod: 'card', cardToken: token.token, idempotencyKey: 'card-reuse' }, customer.token)).body.code, 'card_token_expired', 'tokens are single use');
  const declined = (await request('POST', '/payments/card/tokenize', { ...card, number: '4000000000000002' }, customer.token)).body;
  const refused = await request('POST', '/orders', { items: [{ productId: 'cheese', quantity: 1 }], address, paymentMethod: 'card', cardToken: declined.token, idempotencyKey: 'card-declined' }, customer.token);
  assert.equal(refused.status, 402); assert.equal(refused.body.code, 'card_declined');
  const cancelled = await request('POST', `/orders/${order.body.order.id}/cancel`, {}, customer.token);
  assert.equal(cancelled.body.order.paymentStatus, 'refunded');
});

test('L047 gift wrapping adds its fee and keeps the message on the order', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register();
  const quote = (await request('POST', '/checkout/quote', { items: [{ productId: 'mug', quantity: 1 }], address: { city: 'عمان' }, gift: { wrap: true, message: 'كل عام وأنت بخير' } }, customer.token)).body;
  assert.equal(quote.giftWrapFee, 1.5); assert.equal(quote.total, 59 + 1.5);
  const order = (await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, gift: { wrap: true, message: 'كل عام وأنت بخير', recipient: 'سلمى' }, idempotencyKey: 'gift-order' }, customer.token)).body.order;
  assert.equal(order.total, 60.5); assert.deepEqual([order.extras.gift.message, order.extras.gift.recipient, order.extras.gift.fee], ['كل عام وأنت بخير', 'سلمى', 1.5]);
  assert.equal((await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, gift: { wrap: true, message: 'x'.repeat(201) }, idempotencyKey: 'gift-long' }, customer.token)).status, 400);
});

test('L048 gift cards are issued once, redeemed into the wallet and cannot be reused', async (t) => {
  const { request, register, admin, db } = await fixture(t);
  const customer = await register('ريم', 'reem'), other = await register();
  const issued = await request('POST', '/admin/gift-cards', { amount: 25, note: 'هدية عيد', email: 'reem@example.test' }, admin.token);
  assert.equal(issued.status, 201); assert.match(issued.body.code, /^LQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM gift_cards').all()).includes(issued.body.code.replace(/-/g, '')), false, 'codes are stored hashed');
  assert.ok((await request('GET', '/notifications', undefined, customer.token)).body.notifications.some((n) => n.body.includes(issued.body.code)));
  const redeemed = await request('POST', '/gift-cards/redeem', { code: issued.body.code.toLowerCase() }, customer.token);
  assert.equal(redeemed.status, 200); assert.equal(redeemed.body.walletBalance, 25);
  assert.equal((await request('POST', '/gift-cards/redeem', { code: issued.body.code }, other.token)).body.code, 'gift_card_used');
  assert.equal((await request('POST', '/gift-cards/redeem', { code: 'LQ-AAAA-BBBB-CCCC' }, other.token)).status, 404);
  assert.equal((await request('GET', '/admin/gift-cards', undefined, admin.token)).body.giftCards[0].redeemed, true);
});
