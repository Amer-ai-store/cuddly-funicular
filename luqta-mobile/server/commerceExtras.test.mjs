// G16 — delivery-app parity (requirements.md / feature_gap_backlog.md), clean-room implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';
import { haversineKm, normalizeQuery } from './commerceExtras.mjs';

const password = 'extras-test-password-123';
const address = { name: 'عميل', phone: '+962790123456', city: 'عمان', street: 'شارع الاختبار 12', latitude: 31.955, longitude: 35.91 };
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-extras-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'c.sqlite'), bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password }, geminiApiKey: '' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  const register = async (name = 'عميل') => (await request('POST', '/auth/register', { name, email: `${Math.random().toString(36).slice(2)}@example.test`, password })).body;
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  const driver = await register('سائق'); await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token);
  const deliver = async (id, pickup = false) => {
    for (const status of ['confirmed', 'preparing']) assert.equal((await request('PATCH', `/admin/orders/${id}`, { status }, admin.token)).status, 200);
    if (!pickup) assert.equal((await request('PATCH', `/admin/orders/${id}`, { status: 'out_for_delivery', driverId: driver.user.id }, admin.token)).status, 200);
    const d = await request('PATCH', `/admin/orders/${id}`, { status: 'delivered' }, admin.token); assert.equal(d.status, 200, JSON.stringify(d.body));
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, request, register, admin, deliver };
}
const branches = [{ id: 'hashmi', name: 'فرع الهاشمي', city: 'عمان', latitude: 31.96, longitude: 35.92 }, { id: 'zarqa', name: 'فرع الزرقاء', city: 'الزرقاء', latitude: 32.07, longitude: 36.09 }];

test('F-G16-03 المجموعات المنسّقة من الإدارة', async (t) => {
  const { request, admin } = await fixture(t);
  assert.equal((await request('PATCH', '/admin/settings', { collections: [{ id: 'morning', title: 'روتين الصباح', productIds: ['mug', 'serum', 'ghost'] }] }, admin.token)).status, 200);
  const c = await request('GET', '/collections');
  assert.equal(c.body.collections[0].products.length, 2, 'unknown/inactive products are skipped');
  assert.equal((await request('GET', '/collections/morning')).body.collection.title, 'روتين الصباح');
});

test('F-G16-04 بطاقة الأختام تُصدر قسيمة شخصية لا يستخدمها غير صاحبها', async (t) => {
  const { request, register, admin, deliver } = await fixture(t);
  await request('PATCH', '/admin/settings', { stampCard: { stamps: 2, rewardType: 'fixed', rewardValue: 3, validDays: 10 } }, admin.token);
  const u = await register(), other = await register();
  for (const k of ['s1', 's2']) { const o = await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: `stamp-${k}` }, u.token); await deliver(o.body.order.id); }
  const st = await request('GET', '/loyalty/stamps', undefined, u.token);
  assert.equal(st.body.stamps, 0); assert.equal(st.body.completed, 1); assert.equal(st.body.vouchers.length, 1);
  const code = st.body.vouchers[0].code; assert.match(code, /^STAMP-/);
  assert.equal((await request('POST', '/coupons/validate', { code, items: [{ productId: 'mug', quantity: 1 }] }, other.token)).body.code, 'invalid_coupon');
  const ok = await request('POST', '/coupons/validate', { code, items: [{ productId: 'mug', quantity: 1 }] }, u.token);
  assert.equal(ok.status, 200); assert.equal(ok.body.discount, 3);
  assert.equal((await request('GET', '/coupons/public')).body.coupons.some((c) => c.code === code), false, 'personal vouchers are not public');
});

test('F-G16-08 حوكمة مفاتيح الميزات: إيقاف فوري ومُدقق من الإدارة فقط', async (t) => {
  const { request, register, admin, db } = await fixture(t);
  const u = await register();
  assert.equal((await request('GET', '/flags')).body.flags.game, true);
  assert.equal((await request('PATCH', '/admin/settings', { flags: { game: false } }, u.token)).status, 403);
  assert.equal((await request('PATCH', '/admin/settings', { flags: { nope: false } }, admin.token)).status, 400);
  assert.equal((await request('PATCH', '/admin/settings', { flags: { game: false, reels: false, merchant: false } }, admin.token)).status, 200);
  assert.equal((await request('GET', '/flags')).body.flags.game, false);
  assert.equal((await request('POST', '/rewards/game', { moves: 12, seconds: 40 }, u.token)).body.code, 'feature_disabled');
  assert.equal((await request('GET', '/media?kind=video')).body.disabled, true);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='settings.update'").get().n >= 1, 'flag changes are audited');
});

test('F-G16-09 تحليلات مجمّعة يومية بلا هوية مستخدم وقمع التحويل للإدارة', async (t) => {
  const { request, register, admin, db } = await fixture(t);
  for (const name of ['view_product', 'view_product', 'view_product', 'view_product', 'add_to_cart', 'add_to_cart', 'begin_checkout']) await request('POST', '/analytics/event', { name });
  assert.equal((await request('POST', '/analytics/event', { name: 'user_email', email: 'x@y.z' })).status, 400);
  const cols = db.prepare('PRAGMA table_info(analytics_daily)').all().map((c) => c.name);
  assert.deepEqual(cols, ['day', 'name', 'count'], 'no user, ip or device columns');
  const u = await register(); await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: 'analytics-order-1' }, u.token);
  assert.equal((await request('GET', '/admin/analytics', undefined, u.token)).status, 403);
  const a = await request('GET', '/admin/analytics?days=7', undefined, admin.token);
  assert.equal(a.body.totals.view_product, 4); assert.equal(a.body.funnel[1].rate, 50); assert.equal(a.body.funnel[3].count, 1); assert.equal(a.body.funnel[3].rate, 100);
  await request('PATCH', '/admin/settings', { flags: { analytics: false } }, admin.token);
  assert.equal((await request('POST', '/analytics/event', { name: 'search' })).body.stored, false);
});
