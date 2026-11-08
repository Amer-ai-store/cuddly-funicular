import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, password, address } from './testkit.mjs';

test('L001 L002 L012 register, sign in, hashed session, sign out and sign-in rate limit', async (t) => {
  const { request, register, db } = await fixture(t);
  const customer = await register('سارة', 'sara');
  assert.equal(customer.user.role, 'customer');
  const login = await request('POST', '/auth/login', { email: 'sara@example.test', password, device: 'Android · لُقطة' });
  assert.equal(login.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash=?').get(login.body.token).n, 0, 'tokens are stored hashed');
  assert.equal((await request('GET', '/auth/me', undefined, login.body.token)).body.user.email, 'sara@example.test');
  assert.equal((await request('POST', '/auth/logout', {}, login.body.token)).status, 200);
  assert.equal((await request('GET', '/auth/me', undefined, login.body.token)).status, 401);
  let limited = 0;
  for (let i = 0; i < 32; i++) if ((await request('POST', '/auth/login', { email: 'sara@example.test', password: 'wrong-password-1' })).status === 429) limited++;
  assert.ok(limited > 0, 'repeated failed sign-ins are rate limited');
});

test('L003 L004 recovery code resets the password and change-password signs out other devices', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register('ليلى', 'layla');
  const other = (await request('POST', '/auth/login', { email: 'layla@example.test', password })).body;
  const changed = await request('POST', '/auth/change-password', { currentPassword: password, newPassword: 'a-brand-new-password-1' }, customer.token);
  assert.equal(changed.status, 200);
  assert.equal((await request('GET', '/auth/me', undefined, other.token)).status, 401, 'other sessions end');
  assert.equal((await request('GET', '/auth/me', undefined, customer.token)).status, 200, 'current session stays');
  const recovered = await request('POST', '/auth/recover', { email: 'layla@example.test', recoveryCode: customer.recoveryCode, newPassword: 'recovered-password-22' });
  assert.equal(recovered.status, 200);
  assert.equal((await request('POST', '/auth/login', { email: 'layla@example.test', password: 'recovered-password-22' })).status, 200);
  assert.equal((await request('POST', '/auth/recover', { email: 'layla@example.test', recoveryCode: customer.recoveryCode, newPassword: 'again-password-333' })).status, 401, 'codes are single use');
});

test('L005 L006 data export covers module data and account deletion removes it', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register('هند');
  await request('PATCH', '/me/profile', { phone: '+962791112233' }, customer.token);
  await request('POST', '/lists', { name: 'مشتريات الأسبوع' }, customer.token);
  await request('GET', '/search?q=حليب', undefined, customer.token);
  const exported = await request('GET', '/me/export', undefined, customer.token);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.export.format, 'luqta-account-export-v1');
  assert.equal(exported.body.export.account.phone, '+962791112233');
  assert.equal(exported.body.export.lists[0].name, 'مشتريات الأسبوع');
  assert.equal(exported.body.export.searchHistory[0].query, 'حليب');
  assert.match(exported.body.filename, /^luqta-data-\d{4}-\d{2}-\d{2}\.json$/);
  const deleted = await request('DELETE', '/auth/me', { confirm: 'حذف حسابي', password }, customer.token);
  assert.equal(deleted.status, 200); assert.equal(deleted.body.financialRecordsRetained, true);
  assert.equal((await request('GET', '/me/export', undefined, customer.token)).status, 401);
});

test('L007 signed-in devices are listed with names and other sessions can be ended', async (t) => {
  const { request, register } = await fixture(t);
  const phone = await register('رامي', 'rami');
  const laptop = (await request('POST', '/auth/login', { email: 'rami@example.test', password, device: 'Windows · Chrome' })).body;
  const list = await request('GET', '/me/sessions', undefined, phone.token);
  assert.equal(list.body.sessions.length, 2);
  const current = list.body.sessions.find((s) => s.current), remote = list.body.sessions.find((s) => !s.current);
  assert.ok(current && remote); assert.equal(remote.device, 'Windows · Chrome');
  assert.equal((await request('DELETE', `/me/sessions/${current.id}`, undefined, phone.token)).status, 409, 'current session needs sign out');
  assert.equal((await request('DELETE', `/me/sessions/${remote.id}`, undefined, phone.token)).status, 200);
  assert.equal((await request('GET', '/auth/me', undefined, laptop.token)).status, 401);
  await request('POST', '/auth/login', { email: 'rami@example.test', password });
  assert.equal((await request('POST', '/me/sessions/revoke-others', {}, phone.token)).body.removed, 1);
});

test('L008 privacy preferences are validated and turning off search history stops recording', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register();
  const defaults = (await request('GET', '/me/preferences', undefined, customer.token)).body.preferences;
  assert.equal(defaults.privacy.saveSearchHistory, true); assert.equal(defaults.privacy.analytics, false);
  assert.equal((await request('PATCH', '/me/preferences', { privacy: { unknownFlag: true } }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/preferences', { privacy: { saveSearchHistory: 'no' } }, customer.token)).status, 400);
  const saved = await request('PATCH', '/me/preferences', { privacy: { saveSearchHistory: false, personalizedRecommendations: false } }, customer.token);
  assert.equal(saved.body.preferences.privacy.saveSearchHistory, false);
  await request('GET', '/search?q=طماطم', undefined, customer.token);
  assert.equal((await request('GET', '/me/search-history', undefined, customer.token)).body.history.length, 0);
});

test('L009 profile keeps phone, avatar and birthday and rejects invalid values', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register('عمر');
  const updated = await request('PATCH', '/me/profile', { name: 'عمر خالد', phone: '+962 79 555 0101', avatar: 'emoji:🦊', birthday: '1995-04-12' }, customer.token);
  assert.equal(updated.status, 200);
  assert.deepEqual([updated.body.profile.name, updated.body.profile.phone, updated.body.profile.avatar], ['عمر خالد', '+962 79 555 0101', 'emoji:🦊']);
  assert.equal((await request('PATCH', '/me/profile', { phone: 'call-me' }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/profile', { avatar: 'https://evil.example/x.png' }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/profile', { birthday: '2999-01-01' }, customer.token)).status, 400);
  assert.equal((await request('GET', '/me/profile', undefined, customer.token)).body.profile.birthday, '1995-04-12');
});

test('L010 multiple addresses keep district, building, details and map pin', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register();
  const home = await request('POST', '/addresses', { ...address, label: 'البيت', district: 'خلدا', building: '14', details: 'الطابق الثاني', isDefault: true }, customer.token);
  assert.equal(home.status, 201);
  assert.deepEqual([home.body.address.district, home.body.address.building, home.body.address.details], ['خلدا', '14', 'الطابق الثاني']);
  await request('POST', '/addresses', { ...address, label: 'العمل', city: 'إربد', latitude: 32.55, longitude: 35.85 }, customer.token);
  const all = (await request('GET', '/addresses', undefined, customer.token)).body.addresses;
  assert.equal(all.length, 2); assert.equal(all.find((a) => a.label === 'العمل').latitude, 32.55);
});

test('L011 merchant accounts manage only their own products, orders and payouts', async (t) => {
  const { request, register, admin, order } = await fixture(t);
  const merchant = await register('تاجر', 'merchant'), stranger = await register(), buyer = await register();
  const vendor = (await request('POST', '/admin/vendors', { name: 'مخبز الحارة', commission: 10 }, admin.token)).body.vendor;
  assert.equal((await request('POST', `/admin/vendors/${vendor.id}/members`, { email: 'merchant@example.test', role: 'owner' }, admin.token)).status, 201);
  assert.equal((await request('GET', '/vendor/me', undefined, merchant.token)).body.vendors[0].id, vendor.id);
  const created = await request('POST', `/vendor/${vendor.id}/products`, { id: 'zaatar-manakish', name: 'مناقيش زعتر', price: 2, category: 'bakery', stock: 10 }, merchant.token);
  assert.equal(created.status, 201); assert.equal(created.body.product.vendorId, vendor.id);
  assert.equal((await request('POST', `/vendor/${vendor.id}/products`, { name: 'دخيل', price: 1 }, stranger.token)).status, 403);
  assert.equal((await request('PATCH', `/vendor/${vendor.id}/products/mug`, { price: 1 }, merchant.token)).status, 404, 'cannot edit store products');
  await order(buyer, [{ productId: 'zaatar-manakish', quantity: 3 }]);
  const orders = (await request('GET', `/vendor/${vendor.id}/orders`, undefined, merchant.token)).body.orders;
  assert.equal(orders.length, 1); assert.equal(orders[0].lines[0].quantity, 3); assert.equal(orders[0].address, undefined);
  const summary = (await request('GET', `/vendor/${vendor.id}/summary`, undefined, merchant.token)).body.summary;
  assert.deepEqual([summary.sales, summary.commission, summary.payout], [6, 0.6, 5.4]);
  await request('PATCH', `/admin/vendors/${vendor.id}`, { status: 'suspended' }, admin.token);
  assert.equal((await request('GET', `/vendor/${vendor.id}/products`, undefined, merchant.token)).status, 403);
});
