import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, address } from './testkit.mjs';

test('L061 L062 points are earned on delivery and redeemed for wallet credit', async (t) => {
  const { request, register, order, deliver } = await fixture(t);
  const customer = await register();
  const placed = await order(customer, [{ productId: 'headphones', quantity: 1 }]);
  assert.equal((await request('GET', '/rewards', undefined, customer.token)).body.points, 0, 'nothing before delivery');
  await deliver(customer, placed.id);
  const rewards = (await request('GET', '/rewards', undefined, customer.token)).body;
  assert.equal(rewards.points, 249); assert.equal(rewards.redeemablePoints, 200);
  const redeemed = await request('POST', '/rewards/redeem', { points: 200, requestKey: 'redeem-once-key' }, customer.token);
  assert.equal(redeemed.body.walletBalance, 2); assert.equal(redeemed.body.points, 49);
});

test('L063 daily check-in awards once per day and tracks the streak', async (t) => {
  const { request, register, db } = await fixture(t);
  const customer = await register();
  const yesterday = new Date(Date.now() + 180 * 60_000 - 86400_000).toISOString().slice(0, 10);
  db.prepare("INSERT INTO reward_ledger VALUES('rwd_seed',?,5,'earned','حضور سابق',NULL,NULL,?,?)").run(customer.user.id, `checkin:${yesterday}`, new Date().toISOString());
  const before = (await request('GET', '/rewards/check-in', undefined, customer.token)).body;
  assert.equal(before.checkedInToday, false); assert.equal(before.streak, 1);
  const first = (await request('POST', '/rewards/check-in', {}, customer.token)).body;
  assert.equal(first.awarded, 5); assert.equal(first.streak, 2); assert.equal(first.points, 10);
  const again = (await request('POST', '/rewards/check-in', {}, customer.token)).body;
  assert.equal(again.alreadyCheckedIn, true); assert.equal(again.awarded, 0); assert.equal(again.points, 10);
});

test('L064 L065 badges reflect activity and referrals reward both friends after the first delivery', async (t) => {
  const { request, register, order, deliver } = await fixture(t);
  const inviter = await register('داعي'), friend = await register('صديق');
  const { code } = (await request('GET', '/referrals', undefined, inviter.token)).body;
  assert.match(code, /^LQ[A-Z0-9]{6}$/);
  assert.equal((await request('POST', '/referrals/apply', { code }, inviter.token)).body.code, 'self_referral');
  const applied = await request('POST', '/referrals/apply', { code: code.toLowerCase() }, friend.token);
  assert.equal(applied.status, 200); assert.equal(applied.body.awarded, 20);
  assert.equal((await request('POST', '/referrals/apply', { code }, friend.token)).body.code, 'referral_used');
  const placed = await order(friend, [{ productId: 'milk', quantity: 1 }]);
  await deliver(friend, placed.id);
  assert.equal((await request('GET', '/rewards', undefined, inviter.token)).body.points, 50);
  const referrals = (await request('GET', '/referrals', undefined, inviter.token)).body;
  assert.equal(referrals.invited, 1); assert.equal(referrals.rewarded, 1);
  const badges = (await request('GET', '/me/badges', undefined, inviter.token)).body.badges;
  assert.equal(badges.find((b) => b.id === 'ambassador').earned, true); assert.equal(badges.find((b) => b.id === 'first_order').earned, false);
  const friendBadges = (await request('GET', '/me/badges', undefined, friend.token)).body.badges;
  assert.equal(friendBadges.find((b) => b.id === 'first_order').earned, true); assert.equal(friendBadges.find((b) => b.id === 'loyal_5').progress, 1);
});

test('L066 tiers follow lifetime points and change the delivery fee', async (t) => {
  const { request, register, db } = await fixture(t);
  const customer = await register();
  const quote = async () => (await request('POST', '/checkout/quote', { items: [{ productId: 'milk', quantity: 1 }], address: { city: 'عمان' } }, customer.token)).body;
  assert.equal((await request('GET', '/rewards/tier', undefined, customer.token)).body.tier.id, 'bronze');
  assert.equal((await quote()).shipping, 2.5);
  db.prepare("INSERT INTO reward_ledger VALUES('rwd_silver',?,600,'earned','نقاط سابقة',NULL,NULL,'seed-silver',?)").run(customer.user.id, new Date().toISOString());
  const silver = (await request('GET', '/rewards/tier', undefined, customer.token)).body;
  assert.equal(silver.tier.id, 'silver'); assert.equal(silver.next.id, 'gold'); assert.equal(silver.next.pointsNeeded, 900);
  assert.equal((await quote()).shipping, 1.25);
  db.prepare("INSERT INTO reward_ledger VALUES('rwd_gold',?,1000,'earned','نقاط سابقة',NULL,NULL,'seed-gold',?)").run(customer.user.id, new Date().toISOString());
  assert.equal((await quote()).shipping, 0);
  const placed = await request('POST', '/orders', { items: [{ productId: 'milk', quantity: 1 }], address, idempotencyKey: 'gold-member-order' }, customer.token);
  assert.equal(placed.body.order.shipping, 0); assert.equal(placed.body.order.extras.tier, 'gold');
});

test('L067 L068 offers and flash deals price orders until they end or sell out', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  assert.ok((await request('GET', '/admin/offers', undefined, admin.token)).body.offers.some((p) => p.id === 'headphones'), 'catalog offers are listed');
  const endsAt = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await request('POST', '/admin/flash-deals', { productId: 'olive-oil', price: 7.5, endsAt }, admin.token)).status, 400, 'deal must be cheaper');
  const deal = (await request('POST', '/admin/flash-deals', { productId: 'olive-oil', price: 4.9, endsAt, limit: 2 }, admin.token)).body.deal;
  const listed = (await request('GET', '/flash-deals')).body;
  assert.ok(listed.serverTime); assert.equal(listed.deals[0].id, deal.id);
  const product = (await request('GET', '/products/olive-oil')).body.product;
  assert.deepEqual([product.price, product.oldPrice, product.flash.remaining], [4.9, 6.9, 2]);
  const bought = await request('POST', '/orders', { items: [{ productId: 'olive-oil', quantity: 2 }], address, idempotencyKey: 'flash-buy-two' }, customer.token);
  assert.equal(bought.body.order.items[0].price, 4.9);
  assert.equal((await request('GET', '/products/olive-oil')).body.product.price, 6.9, 'sold out deals stop');
  assert.equal((await request('GET', '/flash-deals')).body.deals.length, 0);
});

test('L069 campaigns are shown only while active and validate their links', async (t) => {
  const { request, admin } = await fixture(t);
  const demo = (await request('GET', '/campaigns')).body.campaigns;
  assert.ok(demo.some((c) => c.id === 'cmp_fresh'));
  const future = new Date(Date.now() + 86400_000).toISOString(), later = new Date(Date.now() + 2 * 86400_000).toISOString();
  assert.equal((await request('POST', '/admin/campaigns', { title: 'حملة', endsAt: later, link: 'javascript:alert(1)' }, admin.token)).status, 400);
  const created = (await request('POST', '/admin/campaigns', { title: 'عرض نهاية الأسبوع', startsAt: future, endsAt: later, link: '/offers', color: '#FF6B4A' }, admin.token)).body.campaign;
  assert.equal((await request('GET', '/campaigns')).body.campaigns.some((c) => c.id === created.id), false, 'not before it starts');
  await request('PATCH', `/admin/campaigns/${created.id}`, { startsAt: new Date(Date.now() - 1000).toISOString() }, admin.token);
  assert.equal((await request('GET', '/campaigns')).body.campaigns.some((c) => c.id === created.id), true);
});

test('L070 notifications can be read and their categories switched off', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  await request('PATCH', '/admin/products/banana', { stock: 0 }, admin.token);
  await request('POST', '/products/banana/alerts', { type: 'stock' }, customer.token);
  await request('PATCH', '/me/preferences', { notifications: { priceAlerts: false } }, customer.token);
  await request('PATCH', '/admin/products/banana', { stock: 30 }, admin.token);
  const notifications = (await request('GET', '/notifications', undefined, customer.token)).body.notifications;
  assert.equal(notifications.some((n) => n.title === 'عاد المنتج إلى المخزون'), false, 'muted category is not sent');
  assert.equal((await request('POST', '/notifications/read-all', {}, customer.token)).status, 200);
  assert.ok((await request('GET', '/notifications', undefined, customer.token)).body.notifications.every((n) => n.read));
});
