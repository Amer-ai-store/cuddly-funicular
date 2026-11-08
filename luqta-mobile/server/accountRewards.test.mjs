import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';

const password = 'strong-test-password-123';
const address = { name: 'عميل تجريبي', phone: '+962790123456', city: 'عمّان', street: 'شارع الاختبار 12' };

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-account-rewards-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'commerce.sqlite'), bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password } });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => {
    const response = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  let sequence = 0;
  const register = async (name = 'عميل') => {
    const result = await request('POST', '/auth/register', { name, email: `person${++sequence}@example.test`, password });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  return { ...app, request, register, admin };
}

test('one-time recovery codes reset passwords and revoke every prior session', async (t) => {
  const { request, register } = await fixture(t);
  const account = await register();
  assert.match(account.recoveryCode, /^[A-Za-z0-9_-]{32}$/);
  const otherSession = (await request('POST', '/auth/login', { email: account.user.email, password })).body.token;
  const invalid = await request('POST', '/auth/recover', { email: account.user.email, recoveryCode: 'a'.repeat(32), newPassword: 'new-password-1234' });
  assert.equal(invalid.status, 401);
  assert.equal((await request('POST', '/auth/recover', { email: 'missing@example.test', recoveryCode: 'a'.repeat(32), newPassword: 'new-password-1234' })).body.code, invalid.body.code);
  assert.equal((await request('POST', '/auth/recover', { email: account.user.email, recoveryCode: account.recoveryCode, newPassword: 'new-password-1234' })).status, 200);
  assert.equal((await request('GET', '/auth/me', undefined, account.token)).status, 401);
  assert.equal((await request('GET', '/auth/me', undefined, otherSession)).status, 401);
  assert.equal((await request('POST', '/auth/login', { email: account.user.email, password })).status, 401);
  assert.equal((await request('POST', '/auth/recover', { email: account.user.email, recoveryCode: account.recoveryCode, newPassword: password })).status, 401);
  const fresh = await request('POST', '/auth/login', { email: account.user.email, password: 'new-password-1234' });
  assert.equal(fresh.status, 200);
  assert.equal((await request('POST', '/auth/recovery-code', { password: 'wrong' }, fresh.body.token)).status, 401);
  const rotated = await request('POST', '/auth/recovery-code', { password: 'new-password-1234' }, fresh.body.token);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.recoveryCode, account.recoveryCode);
});

test('deletion blocks obligations, anonymizes private data and invalidates sessions', async (t) => {
  const { request, register, admin, db } = await fixture(t);
  const account = await register('ليلى الخاصة');
  const otherSession = (await request('POST', '/auth/login', { email: account.user.email, password })).body.token;
  assert.equal((await request('DELETE', '/auth/me', { password, confirm: 'wrong' }, account.token)).status, 400);
  assert.equal((await request('DELETE', '/auth/me', { password: 'wrong', confirm: 'حذف حسابي' }, account.token)).status, 401);
  assert.equal((await request('POST', '/addresses', address, account.token)).status, 201);
  assert.equal((await request('PUT', '/wishlist', { productIds: ['mug'] }, account.token)).status, 200);
  const created = await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: 'delete-account-order', paymentMethod: 'cod' }, account.token);
  assert.equal(created.status, 201);
  assert.equal((await request('DELETE', '/auth/me', { password, confirm: 'حذف حسابي' }, account.token)).body.code, 'active_orders');
  assert.equal((await request('POST', `/orders/${created.body.order.id}/cancel`, {}, account.token)).status, 200);
  assert.equal((await request('POST', '/admin/wallet/adjust', { userId: account.user.id, amount: 3, note: 'اختبار الرصيد' }, admin.token)).status, 200);
  assert.equal((await request('DELETE', '/auth/me', { password, confirm: 'حذف حسابي' }, account.token)).body.code, 'wallet_balance');
  assert.equal((await request('POST', '/admin/wallet/adjust', { userId: account.user.id, amount: -3, note: 'تسوية الرصيد' }, admin.token)).status, 200);
  const removed = await request('DELETE', '/auth/me', { password, confirm: 'حذف حسابي' }, account.token);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((await request('GET', '/auth/me', undefined, account.token)).status, 401);
  assert.equal((await request('GET', '/auth/me', undefined, otherSession)).status, 401);
  assert.equal((await request('POST', '/auth/login', { email: account.user.email, password })).status, 401);
  assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get(account.user.id).name, 'حساب محذوف');
  assert.deepEqual(JSON.parse(db.prepare('SELECT address FROM orders WHERE id=?').get(created.body.order.id).address), {});
  for (const table of ['addresses', 'wishlists', 'notifications', 'recovery_codes', 'reward_ledger']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).get(account.user.id).n, 0, table);
  }
  assert.equal((await request('POST', '/auth/register', { name: 'عميلة جديدة', email: account.user.email, password })).status, 201);
});

test('last administrator and a driver with an active delivery cannot delete their accounts', async (t) => {
  const { request, register, admin } = await fixture(t);
  assert.equal((await request('DELETE', '/auth/me', { password, confirm: 'حذف حسابي' }, admin.token)).body.code, 'last_admin');
  const driver = await register('السائق'), customer = await register('المشتري');
  assert.equal((await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token)).status, 200);
  const created = await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: 'driver-active-order' }, customer.token);
  assert.equal(created.status, 201);
  assert.equal((await request('PATCH', `/admin/orders/${created.body.order.id}`, { status: 'confirmed', driverId: driver.user.id }, admin.token)).status, 200);
  assert.equal((await request('DELETE', '/auth/me', { password, confirm: 'حذف حسابي' }, driver.token)).body.code, 'active_deliveries');
});

test('delivery rewards redeem atomically and returns claw back redeemed value once', async (t) => {
  const { request, register, admin, db } = await fixture(t);
  const customer = await register(), driver = await register('سائق'), other = await register('آخر');
  assert.equal((await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token)).status, 200);
  assert.equal((await request('PATCH', '/admin/products/mug', { price: 100, stock: 3 }, admin.token)).status, 200);
  const deliver = async (key) => {
    const created = await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 1 }], address, idempotencyKey: key }, customer.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.order.id;
    assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status: 'confirmed', driverId: driver.user.id }, admin.token)).status, 200);
    assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status: 'preparing' }, admin.token)).status, 200);
    assert.equal((await request('PATCH', `/driver/orders/${orderId}`, { status: 'out_for_delivery' }, driver.token)).status, 200);
    const { code } = (await request('GET', `/orders/${orderId}/delivery-code`, undefined, customer.token)).body;
    assert.equal((await request('PATCH', `/driver/orders/${orderId}`, { status: 'delivered', otp: code }, driver.token)).status, 200);
    return orderId;
  };
  assert.equal((await request('GET', '/rewards', undefined, customer.token)).body.points, 0);
  const first = await deliver('reward-one');
  assert.equal((await request('GET', '/rewards', undefined, customer.token)).body.points, 100);
  assert.equal((await request('POST', '/rewards/redeem', { points: 200, requestKey: 'insufficient' }, customer.token)).status, 409);
  const second = await deliver('reward-two');
  const redeemed = await request('POST', '/rewards/redeem', { points: 200, requestKey: 'redeem-two-orders' }, customer.token);
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
  assert.equal(redeemed.body.walletBalance, 2);
  assert.equal((await request('POST', '/rewards/redeem', { points: 200, requestKey: 'redeem-two-orders' }, customer.token)).body.reused, true);
  assert.equal((await request('POST', '/rewards/redeem', { points: 100, requestKey: 'redeem-two-orders' }, customer.token)).status, 409);
  assert.equal((await request('GET', '/rewards', undefined, other.token)).body.points, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE user_id=? AND type='redeemed'").get(customer.user.id).n, 1);
  const returned = await request('POST', `/orders/${first}/returns`, { reason: 'غير مناسب بعد الاستلام' }, customer.token);
  assert.equal(returned.status, 201);
  assert.equal((await request('PATCH', `/admin/returns/${returned.body.returnRequest.id}`, { status: 'approved' }, admin.token)).status, 200);
  assert.equal((await request('GET', '/wallet', undefined, customer.token)).body.balance, 101);
  assert.equal((await request('GET', '/rewards', undefined, customer.token)).body.points, 0);
  assert.equal((await request('PATCH', `/admin/returns/${returned.body.returnRequest.id}`, { status: 'approved' }, admin.token)).status, 409);
  const secondReturn = await request('POST', `/orders/${second}/returns`, { reason: 'لا أحتاج هذا المنتج' }, customer.token);
  assert.equal((await request('PATCH', `/admin/returns/${secondReturn.body.returnRequest.id}`, { status: 'approved' }, admin.token)).status, 200);
  assert.equal((await request('GET', '/wallet', undefined, customer.token)).body.balance, 200);
  assert.equal((await request('GET', '/rewards', undefined, customer.token)).body.points, 0);
});
