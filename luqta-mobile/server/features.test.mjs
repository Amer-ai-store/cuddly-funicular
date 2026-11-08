// G14 — features merged from the attached "أسواق جوافة / Aura" app, each as its own test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';
import { priceStats, bestBundle, levelFor } from './features.mjs';

const password = 'features-test-password-123';
const address = { name: 'عميل تجريبي', phone: '+962790123456', city: 'عمان', street: 'شارع الاختبار 12', latitude: 31.95, longitude: 35.91 };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-features-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'commerce.sqlite'), bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password }, geminiApiKey: '', ...options });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => {
    const response = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const register = async (name = 'عميل') => { const r = await request('POST', '/auth/register', { name, email: `${Math.random().toString(36).slice(2)}@example.test`, password }); assert.equal(r.status, 201); return r.body; };
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  const deliver = async (orderId, driver) => {
    for (const status of ['confirmed', 'preparing']) assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status }, admin.token)).status, 200);
    assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status: 'out_for_delivery', driverId: driver.user.id }, admin.token)).status, 200);
    assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status: 'delivered' }, admin.token)).status, 200);
  };
  const makeDriver = async () => { const d = await register('سائق'); await request('PATCH', `/admin/users/${d.user.id}`, { role: 'driver' }, admin.token); return d; };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, request, register, admin, deliver, makeDriver };
}

test('F-G14-01 سجل الأسعار 30 يومًا مع اتجاه ونصيحة شراء', async (t) => {
  const { request, admin } = await fixture(t);
  assert.equal((await request('PATCH', '/admin/products/mug', { price: 55 }, admin.token)).status, 200);
  assert.equal((await request('PATCH', '/admin/products/mug', { price: 49 }, admin.token)).status, 200);
  const h = await request('GET', '/products/mug/price-history?days=30');
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.points.map((p) => p.price), [59, 55, 49]);
  assert.equal(h.body.stats.min, 49); assert.equal(h.body.stats.trend, 'down');
  assert.match(h.body.stats.advice, /الأدنى/);
  const s = priceStats([{ price: 10, at: '2026-01-01T00:00:00Z' }, { price: 12, at: '2026-01-10T00:00:00Z' }], 12);
  assert.equal(s.trend, 'up'); assert.equal(s.changePct, 20);
});

test('F-G14-02 لوحة نبض السوق من بيانات المتجر الحقيقية', async (t) => {
  const { request, admin } = await fixture(t);
  await request('PATCH', '/admin/products/lamp', { price: 99, oldPrice: 129 }, admin.token);
  const r = await request('GET', '/market/pulse');
  assert.equal(r.status, 200);
  assert.ok(r.body.totals.products >= 12, 'every active catalog product counts');
  assert.ok(r.body.categories.find((c) => c.category === 'home').offers >= 1);
  assert.equal(r.body.drops[0].productId, 'lamp');
  assert.ok(r.body.timeline.length >= 1);
});

test('F-G14-03 متابعة السعر وتنبيه تلقائي عند الوصول للهدف (Trigger)', async (t) => {
  const { request, admin, register, db } = await fixture(t);
  const u = await register();
  assert.equal((await request('POST', '/watchlist', { productId: 'speaker', target: 150 }, u.token)).status, 201);
  assert.equal((await request('GET', '/watchlist', undefined, u.token)).body.watches[0].reached, false);
  await request('PATCH', '/admin/products/speaker', { price: 160 }, admin.token);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND title LIKE 'انخفض السعر%'").get(u.user.id).n, 0);
  await request('PATCH', '/admin/products/speaker', { price: 149 }, admin.token);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND title LIKE 'انخفض السعر%'").get(u.user.id).n, 1);
  await request('PATCH', '/admin/products/speaker', { price: 140 }, admin.token);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND title LIKE 'انخفض السعر%'").get(u.user.id).n, 1, 'alert fires once per target');
  const w = (await request('GET', '/watchlist', undefined, u.token)).body.watches[0];
  assert.equal(w.reached, true); assert.ok(w.notifiedAt);
  assert.equal((await request('DELETE', '/watchlist/speaker', undefined, u.token)).status, 200);
  assert.equal((await request('GET', '/watchlist')).status, 401);
});

test('F-G14-04 رادار الأسعار: فروعنا وأسعار المنافسين المستوردة', async (t) => {
  const { request, admin, register } = await fixture(t);
  const u = await register();
  assert.equal((await request('PUT', '/admin/competitor-prices', { rows: [{ productId: 'watch', source: 'متجر أ', price: 300, shipping: 2 }] }, u.token)).status, 403);
  assert.equal((await request('PUT', '/admin/competitor-prices', { rows: [{ productId: 'watch', source: 'متجر أ', price: 300, shipping: 2, url: 'http://insecure' }] }, admin.token)).status, 400);
  assert.equal((await request('PUT', '/admin/competitor-prices', { rows: [{ productId: 'watch', source: 'متجر أ', price: 300, shipping: 2 }, { productId: 'watch', source: 'متجر ب', price: 270, shipping: 0, url: 'https://b.example/watch' }] }, admin.token)).status, 200);
  const c = await request('GET', '/products/watch/compare');
  assert.equal(c.status, 200);
  assert.equal(c.body.rates.length, 3);
  assert.equal(c.body.rates.find((x) => x.lowest).source, 'متجر ب');
  assert.equal(c.body.rates[0].ours, true);
  assert.equal(c.body.spread, 32);
});

test('F-G14-07 يُشترى معًا من الطلبات الفعلية', async (t) => {
  const { request, register } = await fixture(t);
  const before = await request('GET', '/products/mug/together');
  assert.equal(before.body.source, 'category');
  const u = await register();
  await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }, { productId: 'diffuser', quantity: 1 }], address, paymentMethod: 'cod', idempotencyKey: 'together-1' }, u.token);
  const after = await request('GET', '/products/mug/together');
  assert.equal(after.body.source, 'orders'); assert.equal(after.body.products[0].id, 'diffuser');
});

test('F-G14-08/30 رؤى الإنفاق ونصائح التوفير وملخص التوصيل الأخضر', async (t) => {
  const { request, register } = await fixture(t);
  const u = await register();
  await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 2 }], address, paymentMethod: 'cod', idempotencyKey: 'insight-1', eco: true }, u.token);
  const r = await request('GET', '/me/insights', undefined, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.orders, 1); assert.equal(r.body.byCategory[0].category, 'home');
  assert.ok(r.body.tips.length >= 2);
});

test('F-G14-20/22 الرائج من المشاهدات والمشاركات والطلبات', async (t) => {
  const { request } = await fixture(t);
  for (let i = 0; i < 3; i++) await request('POST', '/products/bag/event', { kind: 'view' });
  await request('POST', '/products/watch/event', { kind: 'share' });
  const r = await request('GET', '/trending');
  assert.deepEqual(r.body.products.slice(0, 2).map((p) => p.id), ['watch', 'bag']);
  assert.equal((await request('POST', '/products/nope/event', { kind: 'view' })).status, 404);
});

test('F-G14-23/25 المستويات والشارات ولعبة الذاكرة (مرة يوميًا)', async (t) => {
  const { request, register, db } = await fixture(t);
  const u = await register();
  const p0 = (await request('GET', '/rewards/profile', undefined, u.token)).body;
  assert.equal(p0.level.id, 'bronze'); assert.equal(p0.badges.length, 7);
  assert.equal((await request('POST', '/rewards/game', { moves: 3, seconds: 20 }, u.token)).status, 400, 'impossible: fewer moves than pairs');
  assert.equal((await request('POST', '/rewards/game', { moves: 12, seconds: 3 }, u.token)).status, 400, 'impossible: too fast');
  const g = await request('POST', '/rewards/game', { moves: 12, seconds: 40 }, u.token);
  assert.equal(g.status, 200); assert.equal(g.body.points, 10);
  assert.equal((await request('POST', '/rewards/game', { moves: 12, seconds: 40 }, u.token)).status, 409);
  assert.equal(levelFor(600).id, 'silver'); assert.equal(levelFor(5000).next, null);
});

test('F-G14-26 محفظة الكوبونات العامة', async (t) => {
  const { request, admin } = await fixture(t);
  const c = await request('POST', '/admin/coupons', { code: 'FAMILY30', type: 'percent', value: 30, minSubtotal: 50 }, admin.token);
  assert.equal(c.status, 201);
  assert.equal((await request('GET', '/coupons/public')).body.coupons.length, 0);
  assert.equal((await request('PATCH', `/admin/coupon-visibility/${c.body.coupon.id}`, { public: true, title: 'خصم العائلة' }, admin.token)).status, 200);
  const list = (await request('GET', '/coupons/public')).body.coupons;
  assert.equal(list[0].code, 'FAMILY30'); assert.equal(list[0].title, 'خصم العائلة');
});

test('F-G14-18/19 فيديوهات التسوق والقصص مع الإعجاب والمشاهدة', async (t) => {
  const { request, admin, register } = await fixture(t);
  assert.equal((await request('POST', '/admin/media', { kind: 'video', title: 'تجربة', mediaUrl: 'https://cdn.example/v.exe' }, admin.token)).status, 400);
  const v = await request('POST', '/admin/media', { kind: 'video', title: 'سماعات بلا ضجيج', mediaUrl: 'https://cdn.example/v.mp4', productId: 'headphones' }, admin.token);
  assert.equal(v.status, 201);
  const s = await request('POST', '/admin/media', { kind: 'story', title: 'عرض اليوم', mediaUrl: 'https://cdn.example/s.jpg' }, admin.token);
  assert.ok(s.body.post.expiresAt, 'stories expire after a day');
  const u = await register();
  assert.equal((await request('POST', `/media/${v.body.post.id}/like`, undefined, u.token)).body.post.likes, 1);
  assert.equal((await request('POST', `/media/${v.body.post.id}/like`, undefined, u.token)).body.post.likes, 0);
  await request('POST', `/media/${v.body.post.id}/view`);
  assert.equal((await request('GET', '/media?kind=video')).body.posts[0].views, 1);
  assert.equal((await request('GET', '/media?kind=story')).body.posts.length, 1);
});

test('bestBundle picks the largest discount and ignores inactive rules', () => {
  const lines = [{ productId: 'a', category: 'x', price: 10, quantity: 2 }, { productId: 'b', category: 'x', price: 5, quantity: 1 }];
  assert.equal(bestBundle([{ id: '1', name: 'n', percent: 10, minItems: 2, categories: ['x'] }, { id: '2', name: 'm', percent: 20, minItems: 2, productIds: ['a', 'b'], active: false }], lines).discount, 2.5);
  assert.equal(bestBundle([{ id: '1', name: 'n', percent: 10, minItems: 3, categories: ['x'] }], lines), null);
});
