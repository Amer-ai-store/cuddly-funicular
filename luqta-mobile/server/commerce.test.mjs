import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';

const password = 'a-test-only-password-123';
const address = { name: 'عميل تجريبي', phone: '+962790123456', city: 'عمان', street: 'شارع الاختبار 12', latitude: 31.95, longitude: 35.91 };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-commerce-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'commerce.sqlite'), bootstrapAdmin: { name: 'مدير الاختبار', email: 'admin@example.test', password }, ...options });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token, extra = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); return { status: response.status, body: result, headers: response.headers };
  };
  const register = async (name = 'عميل', suffix = Math.random().toString(36).slice(2)) => {
    const result = await request('POST', '/auth/register', { name, email: `${suffix}@example.test`, password });
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
  };
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, directory, base, request, register, admin };
}

test('auth sessions are real, expire on logout, and never grant public admin privileges', async (t) => {
  const { request, register, admin, db } = await fixture(t);
  assert.equal((await request('GET', '/health')).body.currency, 'JOD');
  assert.equal((await request('GET', '/settings')).body.settings.country, 'JO');
  assert.equal((await request('POST', '/auth/register', { name: 'مهاجم', email: 'evil@example.test', password, role: 'admin' })).status, 403);
  assert.equal((await request('POST', '/auth/register', { name: 'عميل', email: 'bad', password: 'short' })).status, 400);
  const customer = await register();
  assert.equal(customer.user.role, 'customer'); assert.equal(customer.user.password_hash, undefined);
  assert.notEqual(db.prepare('SELECT password_hash FROM users WHERE id=?').get(customer.user.id).password_hash, password);
  assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get(customer.user.id).token_hash.includes(customer.token), false);
  assert.equal((await request('GET', '/auth/me', undefined, customer.token)).body.user.id, customer.user.id);
  assert.equal((await request('GET', '/admin/overview', undefined, customer.token)).status, 403);
  assert.equal((await request('GET', '/admin/overview', undefined, admin.token)).status, 200);
  assert.equal((await request('POST', '/auth/login', { email: customer.user.email, password: 'wrong' })).status, 401);
  assert.equal((await request('POST', '/auth/logout', {}, customer.token)).status, 200);
  assert.equal((await request('GET', '/auth/me', undefined, customer.token)).status, 401);
});

test('address ownership, defaults, nullable map pins, wishlist and notification read state persist', async (t) => {
  const { request, register } = await fixture(t), one = await register(), two = await register();
  const created = await request('POST', '/addresses', { ...address, isDefault: true }, one.token);
  assert.equal(created.status, 201);
  assert.equal((await request('PATCH', `/addresses/${created.body.address.id}`, { city: 'إربد' }, two.token)).status, 404);
  const changed = await request('PATCH', `/addresses/${created.body.address.id}`, { latitude: null, longitude: null }, one.token);
  assert.equal(changed.status, 200); assert.equal(changed.body.address.latitude, undefined);
  await request('POST', '/addresses', { ...address, label: 'العمل', isDefault: true }, one.token);
  const saved = (await request('GET', '/addresses', undefined, one.token)).body.addresses;
  assert.equal(saved.filter((a) => a.isDefault).length, 1);
  assert.equal((await request('PUT', '/wishlist', { productIds: ['mug', 'lamp', 'mug'] }, one.token)).status, 200);
  assert.deepEqual((await request('GET', '/wishlist', undefined, one.token)).body.productIds, ['mug', 'lamp']);
  const notifications = (await request('GET', '/notifications', undefined, one.token)).body.notifications;
  assert.ok(notifications.length); assert.equal(notifications[0].read, false);
  assert.equal((await request('PATCH', `/notifications/${notifications[0].id}`, { read: true }, two.token)).status, 404);
  await request('POST', '/notifications/read-all', {}, one.token);
  assert.equal((await request('GET', '/notifications', undefined, one.token)).body.notifications.every((n) => n.read), true);
});

test('server-priced checkout is transactional and idempotent; cancellation restores inventory once', async (t) => {
  const { request, register, admin } = await fixture(t), customer = await register(), other = await register();
  const product = (await request('GET', '/products/mug')).body.product;
  assert.equal(product.rating, 0); assert.equal(product.reviews, 0);
  const payload = { items: [{ productId: 'mug', quantity: 2, price: 0.001 }], address, paymentMethod: 'cod', total: 0.001, idempotencyKey: 'checkout-one-key' };
  const created = await request('POST', '/orders', payload, customer.token);
  assert.equal(created.status, 201, JSON.stringify(created.body)); const order = created.body.order;
  assert.equal(order.subtotal, product.price * 2); assert.equal(order.total, product.price * 2); assert.equal(order.currency, 'JOD');
  assert.equal((await request('GET', '/products/mug')).body.product.stock, product.stock - 2);
  const repeated = await request('POST', '/orders', payload, customer.token);
  assert.equal(repeated.status, 200); assert.equal(repeated.body.order.id, order.id);
  assert.equal((await request('GET', '/products/mug')).body.product.stock, product.stock - 2);
  assert.equal((await request('GET', `/orders/${order.id}`, undefined, other.token)).status, 403);
  assert.equal((await request('POST', `/orders/${order.id}/cancel`, {}, other.token)).status, 403);
  assert.equal((await request('POST', `/orders/${order.id}/cancel`, {}, customer.token)).status, 200);
  assert.equal((await request('POST', `/orders/${order.id}/cancel`, {}, customer.token)).status, 409);
  assert.equal((await request('GET', '/products/mug')).body.product.stock, product.stock);
  await request('PATCH', '/admin/products/mug', { stock: 1 }, admin.token);
  const stockout = await request('POST', '/orders', { ...payload, idempotencyKey: 'checkout-two-key' }, customer.token);
  assert.equal(stockout.status, 409); assert.equal(stockout.body.code, 'out_of_stock');
  assert.equal((await request('GET', '/orders', undefined, customer.token)).body.orders.length, 1);
});

test('concurrent final-stock checkout cannot oversell and decimal wallet/coupon totals are exact', async (t) => {
  const { request, register, admin } = await fixture(t), one = await register(), two = await register();
  await request('PATCH', '/admin/products/mug', { price: 1.115, stock: 1 }, admin.token);
  const payload = { items: [{ productId: 'mug', quantity: 1 }], address, paymentMethod: 'cod' };
  const results = await Promise.all([request('POST', '/orders', { ...payload, idempotencyKey: 'concurrent-order-one' }, one.token), request('POST', '/orders', { ...payload, idempotencyKey: 'concurrent-order-two' }, two.token)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  await request('PATCH', '/admin/products/mug', { stock: 20 }, admin.token);
  const coupon = await request('POST', '/admin/coupons', { code: 'WELCOME', type: 'percent', value: 10, maxUses: 1 }, admin.token); assert.equal(coupon.status, 201);
  await request('POST', '/admin/wallet/adjust', { userId: one.user.id, amount: 20, note: 'إيداع اختباري مسجل' }, admin.token);
  const bought = await request('POST', '/orders', { ...payload, couponCode: 'WELCOME', paymentMethod: 'wallet', idempotencyKey: 'decimal-wallet-purchase' }, one.token);
  assert.equal(bought.status, 201, JSON.stringify(bought.body)); assert.equal(bought.body.order.discount, 0.112); assert.equal(bought.body.order.total, 3.503);
  assert.equal((await request('GET', '/wallet', undefined, one.token)).body.balance, 16.497);
  assert.equal((await request('POST', '/coupons/validate', { code: 'WELCOME', items: payload.items }, two.token)).status, 400);
  await request('POST', `/orders/${bought.body.order.id}/cancel`, {}, one.token);
  assert.equal((await request('GET', '/wallet', undefined, one.token)).body.balance, 20);
  assert.equal((await request('POST', '/coupons/validate', { code: 'WELCOME', items: payload.items }, two.token)).status, 200);
  assert.equal((await request('POST', '/wallet/top-up', { amount: 100000 }, one.token)).status, 404);
});

test('admin inventory CSV/JSON imports validate all rows before commit; scoped agents are revocable and audited', async (t) => {
  const { request, admin } = await fixture(t);
  const imported = await request('POST', '/admin/inventory/import', { csv: 'id,name,price,stock,category\nnew-sku,"صنف, جديد",2.345,7,sports\nmug,كوب محدث,4.5,9,home', mode: 'replace' }, admin.token);
  assert.equal(imported.status, 200, JSON.stringify(imported.body)); assert.equal(imported.body.created, 1); assert.equal(imported.body.updated, 1);
  assert.equal((await request('GET', '/products/new-sku')).body.product.category, 'sports');
  const bad = await request('POST', '/admin/inventory/import', { items: [{ id: 'mug', stock: 12 }, { id: 'new-invalid', name: 'منتج', price: 3, stock: -1 }] }, admin.token);
  assert.equal(bad.status, 400); assert.equal((await request('GET', '/products/mug')).body.product.stock, 9);
  assert.equal((await request('PUT', '/admin/inventory/connector', { url: 'https://127.0.0.1/stock' }, admin.token)).status, 400);
  assert.equal((await request('PUT', '/admin/inventory/connector', { url: 'http://example.com/stock' }, admin.token)).status, 400);
  const key = (await request('POST', '/admin/agent-keys', { name: 'وكيل المخزون', scopes: ['inventory:write'] }, admin.token)).body;
  assert.ok(key.token.startsWith('lq_agent_'));
  assert.equal((await request('GET', '/admin/agent-keys', undefined, key.token)).status, 403);
  assert.equal((await request('PATCH', '/admin/settings', { shippingFee: 999 }, key.token)).status, 403);
  const write = await request('POST', '/admin/inventory/import', { items: [{ id: 'mug', stock: 4 }], mode: 'add' }, key.token);
  assert.equal(write.status, 200); assert.equal((await request('GET', '/products/mug')).body.product.stock, 13);
  const audit = (await request('GET', '/admin/audit', undefined, admin.token)).body.events;
  assert.ok(audit.some((e) => e.actorId === key.key.id && e.action === 'inventory.import'));
  const keys = (await request('GET', '/admin/agent-keys', undefined, admin.token)).body.keys;
  assert.equal(keys[0].token, undefined); assert.equal(keys[0].token_hash, undefined);
  await request('DELETE', `/admin/agent-keys/${key.key.id}`, {}, admin.token);
  assert.equal((await request('POST', '/admin/inventory/import', { items: [{ id: 'mug', stock: 2 }] }, key.token)).status, 401);
});

test('actual driver assignment/GPS, delivery, verified review and return refund work together', async (t) => {
  const { request, register, admin } = await fixture(t), customer = await register(), driver = await register('سائق'), stranger = await register();
  await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token);
  const placed = (await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: 'delivery-complete-key' }, customer.token)).body.order;
  assert.equal((await request('POST', '/products/mug/reviews', { rating: 5, body: 'منتج رائع' }, customer.token)).status, 403);
  assert.equal((await request('GET', `/orders/${placed.id}/tracking`, undefined, stranger.token)).status, 403);
  await request('PATCH', `/admin/orders/${placed.id}`, { status: 'confirmed', driverId: driver.user.id }, admin.token);
  await request('PATCH', `/admin/orders/${placed.id}`, { status: 'preparing' }, admin.token);
  assert.equal((await request('POST', `/driver/orders/${placed.id}/location`, { latitude: 31.9, longitude: 35.9 }, driver.token)).status, 409);
  assert.equal((await request('PATCH', `/driver/orders/${placed.id}`, { status: 'out_for_delivery' }, driver.token)).status, 200);
  const location = await request('POST', `/driver/orders/${placed.id}/location`, { latitude: 31.955, longitude: 35.914, accuracy: 12 }, driver.token); assert.equal(location.status, 200);
  const tracking = (await request('GET', `/orders/${placed.id}/tracking`, undefined, customer.token)).body;
  assert.equal(tracking.location.latitude, 31.955); assert.equal(tracking.driver.id, driver.user.id); assert.equal(tracking.destination.latitude, address.latitude);
  assert.equal((await request('POST', `/driver/orders/${placed.id}/location`, { latitude: 999, longitude: 0 }, driver.token)).status, 400);
  assert.equal((await request('PATCH', `/driver/orders/${placed.id}`, { status: 'delivered' }, driver.token)).status, 403);
  const { code } = (await request('GET', `/orders/${placed.id}/delivery-code`, undefined, customer.token)).body;
  assert.match(code, /^\d{4}$/);
  assert.equal((await request('GET', `/orders/${placed.id}/delivery-code`, undefined, driver.token)).status, 403);
  assert.equal((await request('PATCH', `/driver/orders/${placed.id}`, { status: 'delivered', otp: code }, driver.token)).status, 200);
  const review = await request('POST', '/products/mug/reviews', { rating: 5, title: 'جيد', body: 'منتج رائع بعد التجربة' }, customer.token); assert.equal(review.status, 201);
  assert.equal((await request('GET', '/products/mug/reviews')).body.rating, 5);
  assert.equal((await request('POST', '/products/mug/reviews', { rating: 4, body: 'مكرر' }, customer.token)).status, 409);
  const requested = await request('POST', `/orders/${placed.id}/returns`, { reason: 'المنتج لا يناسب احتياجاتي' }, customer.token); assert.equal(requested.status, 201);
  const approved = await request('PATCH', `/admin/returns/${requested.body.returnRequest.id}`, { status: 'approved', note: 'تم التحقق من المرتجع' }, admin.token); assert.equal(approved.status, 200);
  assert.equal((await request('GET', '/wallet', undefined, customer.token)).body.balance, placed.total);
  assert.equal((await request('PATCH', `/admin/returns/${requested.body.returnRequest.id}`, { status: 'approved' }, admin.token)).status, 409);
  assert.equal((await request('GET', '/products/mug')).body.product.stock, 25);
});

test('support conversations enforce ownership and admin replies create real notifications', async (t) => {
  const { request, register, admin } = await fixture(t), customer = await register(), other = await register();
  const created = await request('POST', '/tickets', { subject: 'استفسار عن الطلب', message: 'أحتاج مساعدة في عنوان التوصيل' }, customer.token); assert.equal(created.status, 201);
  const ticketId = created.body.ticket.id;
  assert.equal((await request('POST', `/tickets/${ticketId}/replies`, { message: 'رد غير مصرح' }, other.token)).status, 404);
  const reply = await request('POST', `/admin/tickets/${ticketId}/replies`, { message: 'سنساعدك في تعديل العنوان قبل الشحن' }, admin.token); assert.equal(reply.status, 201);
  assert.equal((await request('GET', '/tickets', undefined, customer.token)).body.tickets[0].replies.length, 1);
  await request('PATCH', `/admin/tickets/${ticketId}`, { status: 'resolved' }, admin.token);
  assert.equal((await request('POST', `/tickets/${ticketId}/replies`, { message: 'رد بعد الإغلاق' }, customer.token)).status, 409);
});

test('agent maintenance jobs require evidence and optional Facebook explicitly fails without credentials', async (t) => {
  const { request, register, admin } = await fixture(t), customer = await register();
  const key = (await request('POST', '/admin/agent-keys', { name: 'وكيل التطوير', scopes: ['jobs:write'] }, admin.token)).body;
  const job = (await request('POST', '/admin/agent-jobs', { title: 'إصلاح نموذج', description: 'تحقق من الحقول وأصلح المشكلة', type: 'repair' }, admin.token)).body.job;
  assert.equal(job.status, 'queued');
  assert.equal((await request('PATCH', `/agent/jobs/${job.id}`, { status: 'completed', result: 'تم' }, key.token)).status, 400);
  assert.equal((await request('PATCH', `/agent/jobs/${job.id}`, { status: 'running' }, key.token)).status, 200);
  assert.equal((await request('PATCH', `/agent/jobs/${job.id}`, { status: 'completed', result: 'تم الإصلاح والتحقق', testEvidence: 'اختبار HTTP: نجح التحقق من الحقول' }, key.token)).status, 200);
  assert.equal((await request('GET', '/agent/capabilities', undefined, key.token)).body.arbitraryCodeExecution, false);
  assert.equal((await request('GET', '/auth/facebook/status', undefined, customer.token)).body.configured, false);
  assert.equal((await request('POST', '/auth/facebook/start', { redirectUri: 'luqta://social' }, customer.token)).status, 503);
  assert.equal((await request('GET', '/auth/facebook/callback?state=invalid&code=invalid')).status, 503);
});

test('CORS rejects unapproved browser origins; static SPA fallback and persistence restart work', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-static-'));
  await writeFile(resolve(directory, 'index.html'), '<!doctype html><title>Luqta</title>');
  const { request, base, db } = await fixture(t, { staticDir: directory });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal((await request('GET', '/health', undefined, undefined, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('GET', '/health', undefined, undefined, { Origin: 'http://localhost:8082' })).status, 200);
  const response = await fetch(base.replace('/api', '/orders/some-real-id'));
  assert.equal(response.status, 200); assert.ok((await response.text()).includes('Luqta'));
  assert.ok(db.prepare("SELECT value FROM settings WHERE key='currency'").get());
});

test('SQLite survives server restart with order history and session identity intact', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-persist-')), dbPath = resolve(directory, 'shop.sqlite');
  const start = async () => { const app = await createCommerceServer({ dbPath }); await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); return { ...app, url: `http://127.0.0.1:${app.server.address().port}/api` }; };
  let app = await start();
  const registered = await (await fetch(app.url + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'حساب دائم', email: 'persist@example.test', password }) })).json();
  const orderResponse = await fetch(app.url + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${registered.token}` }, body: JSON.stringify({ items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: 'persist-order-key' }) }); assert.equal(orderResponse.status, 201);
  await app.close(); app = await start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const response = await fetch(app.url + '/orders', { headers: { Authorization: `Bearer ${registered.token}` } });
  assert.equal(response.status, 200); assert.equal((await response.json()).orders.length, 1);
  const catalog = await (await fetch(app.url + '/products/mug')).json(); assert.equal(catalog.product.stock, 24);
});
