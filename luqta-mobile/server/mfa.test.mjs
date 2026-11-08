// WP-02 TOTP two-step verification for administrators.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceServer } from './commerce.mjs';
import { totp, base32, unbase32 } from './mfa.mjs';

const password = 'mfa-test-password-12345';
test('WP-02 TOTP matches RFC 6238 test vector and base32 round-trips', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp(secret, 59_000), '287082'); assert.equal(totp(secret, 1_111_111_109_000), '081804');
  assert.deepEqual(unbase32(secret), Buffer.from('12345678901234567890'));
});
test('WP-02 admin two-step: setup, enable, every admin call needs a verified session, no replay, disable', async (t) => {
  const app = await createCommerceServer({ dbPath: ':memory:', bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const req = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const login = async () => (await req('POST', '/auth/login', { email: 'admin@example.test', password })).body.token;
  const a1 = await login();
  assert.equal((await req('GET', '/admin/orders', undefined, a1)).status, 200, 'no MFA → admin works as before');
  const setup = await req('POST', '/auth/mfa/setup', {}, a1);
  assert.equal(setup.status, 201); assert.match(setup.body.otpauth, /^otpauth:\/\/totp\//);
  assert.equal(app.db.prepare('SELECT secret FROM admin_mfa').get().secret.includes(setup.body.secret), false, 'secret encrypted at rest');
  assert.equal((await req('POST', '/auth/mfa/enable', { code: '000000' }, a1)).body.code, 'invalid_code');
  const code = totp(setup.body.secret);
  assert.equal((await req('POST', '/auth/mfa/enable', { code }, a1)).body.enabled, true);
  assert.equal((await req('GET', '/admin/orders', undefined, a1)).status, 200, 'enabling session is verified');
  const a2 = await login();
  const blocked = await req('GET', '/admin/orders', undefined, a2);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'mfa_required');
  assert.deepEqual((await req('GET', '/auth/mfa/status', undefined, a2)).body, { available: true, enabled: true, verified: false, required: true });
  assert.equal((await req('POST', '/auth/mfa/verify', { code }, a2)).body.code, 'invalid_code', 'a used code cannot be replayed');
  const next = totp(setup.body.secret, Date.now() + 30_000);
  assert.equal((await req('POST', '/auth/mfa/verify', { code: next }, a2)).body.verified, true);
  assert.equal((await req('GET', '/admin/orders', undefined, a2)).status, 200);
  const user = (await req('POST', '/auth/register', { name: 'عميل', email: 'c@example.test', password })).body.token;
  assert.equal((await req('POST', '/auth/mfa/setup', {}, user)).status, 403);
  assert.equal((await req('GET', '/products', undefined, a2)).status, 200);
  app.db.prepare('UPDATE admin_mfa SET last_counter=NULL').run(); // simulate the next 30-second window
  const later = totp(setup.body.secret);
  assert.equal((await req('POST', '/auth/mfa/disable', { code: later }, a2)).body.enabled, false);
  assert.equal((await req('GET', '/admin/orders', undefined, await login())).status, 200);
});
