// Phone OTP + Google sign-in (F-G15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';
import { normalizePhone } from './authProviders.mjs';

const password = 'auth-providers-password-123';
async function fixture(t, authEnv = {}, extra = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-auth-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'c.sqlite'), bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password }, authEnv: { NODE_ENV: 'test', BIRD_ACCESS_KEY: '', TWILIO_ACCOUNT_SID: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '', AUTH_OTP_DEV: '', ...authEnv }, ...extra });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => { const r = await fetch(base + path, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); const txt = await r.text(); let json = {}; try { json = JSON.parse(txt); } catch { /* redirect */ } return { status: r.status, body: json, location: r.headers.get('location') }; };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, request };
}

test('F-G15-01 تطبيع أرقام الهاتف الأردنية والدولية', () => {
  assert.equal(normalizePhone('0791234567'), '+962791234567');
  assert.equal(normalizePhone('٠٧٩١٢٣٤٥٦٧'), '+962791234567');
  assert.equal(normalizePhone('00962 78 123 4567'), '+962781234567');
  assert.equal(normalizePhone('+966501234567'), '+966501234567');
  assert.equal(normalizePhone('0761234567'), null, 'not a Jordanian mobile prefix');
  assert.equal(normalizePhone('12'), null);
});

test('F-G15-02 الدخول بالهاتف: رمز لمرة واحدة، إنشاء حساب ثم دخول لنفس الحساب، قفل بعد 5 محاولات', async (t) => {
  const { request, db } = await fixture(t, { AUTH_OTP_DEV: '1' });
  assert.deepEqual((await request('GET', '/auth/providers')).body.phone, { enabled: true, provider: 'dev', demo: true });
  assert.equal((await request('POST', '/auth/phone/start', { phone: '123' })).status, 400);
  const s1 = await request('POST', '/auth/phone/start', { phone: '0791234567' });
  assert.equal(s1.status, 200); assert.match(s1.body.devCode, /^\d{6}$/);
  assert.notEqual(db.prepare('SELECT code_hash FROM otp_codes').get().code_hash, s1.body.devCode, 'stored hashed');
  assert.equal((await request('POST', '/auth/phone/verify', { phone: '0791234567', code: '000000' === s1.body.devCode ? '111111' : '000000' })).body.code, 'otp_invalid');
  const v1 = await request('POST', '/auth/phone/verify', { phone: '+962791234567', code: s1.body.devCode, name: 'محمد' });
  assert.equal(v1.status, 200, JSON.stringify(v1.body)); assert.equal(v1.body.isNew, true); assert.ok(v1.body.token); assert.ok(v1.body.recoveryCode);
  assert.equal(v1.body.user.name, 'محمد');
  assert.equal((await request('POST', '/auth/phone/verify', { phone: '0791234567', code: s1.body.devCode })).body.code, 'otp_expired', 'code is single-use');
  const s2 = await request('POST', '/auth/phone/start', { phone: '0791234567' });
  const v2 = await request('POST', '/auth/phone/verify', { phone: '0791234567', code: s2.body.devCode });
  assert.equal(v2.body.isNew, false); assert.equal(v2.body.user.id, v1.body.user.id);
  await request('POST', '/auth/phone/start', { phone: '0781111111' });
  for (let i = 0; i < 5; i++) await request('POST', '/auth/phone/verify', { phone: '0781111111', code: '999999' });
  assert.equal((await request('POST', '/auth/phone/verify', { phone: '0781111111', code: '999999' })).body.code, 'otp_locked');
  for (let i = 0; i < 4; i++) assert.equal((await request('POST', '/auth/phone/start', { phone: '0781111111' })).status, 200);
  assert.equal((await request('POST', '/auth/phone/start', { phone: '0781111111' })).status, 429, 'max 5 codes per phone per hour');
});

test('F-G15-03 بدون مزود SMS = 503 واضح، ووضع التطوير معطّل في الإنتاج', async (t) => {
  const a = await fixture(t);
  assert.equal((await a.request('POST', '/auth/phone/start', { phone: '0791234567' })).body.code, 'sms_not_configured');
  const b = await fixture(t, { AUTH_OTP_DEV: '1', NODE_ENV: 'production' });
  assert.equal((await b.request('GET', '/auth/providers')).body.phone.enabled, false);
});

test('F-G15-04 مزود Bird يرسل الرسالة من الخادم دون إرجاع الرمز', async (t) => {
  const sent = [];
  const authFetch = async (url, init) => { sent.push({ url, init }); return new Response('{}', { status: 202 }); };
  const { request } = await fixture(t, { BIRD_ACCESS_KEY: 'k', BIRD_WORKSPACE_ID: 'ws', BIRD_SMS_CHANNEL_ID: 'ch' }, { authFetch });
  const r = await request('POST', '/auth/phone/start', { phone: '0791234567' });
  assert.equal(r.status, 200); assert.equal(r.body.devCode, undefined);
  assert.match(sent[0].url, /api\.bird\.com\/workspaces\/ws\/channels\/ch\/messages/);
  assert.equal(sent[0].init.headers.Authorization, 'AccessKey k');
  assert.match(JSON.parse(sent[0].init.body).body.text.text, /رمز الدخول إلى لُقطة: \d{6}/);
});

test('F-G15-05 ربط رقم الهاتف بحساب قائم', async (t) => {
  const { request } = await fixture(t, { AUTH_OTP_DEV: '1' });
  const reg = await request('POST', '/auth/register', { name: 'سارة', email: 's@example.test', password });
  const s = await request('POST', '/auth/phone/start', { phone: '0771234567' });
  const link = await request('POST', '/auth/phone/verify', { phone: '0771234567', code: s.body.devCode }, reg.body.token);
  assert.equal(link.body.linked, true);
  const s2 = await request('POST', '/auth/phone/start', { phone: '0771234567' });
  assert.equal((await request('POST', '/auth/phone/verify', { phone: '0771234567', code: s2.body.devCode })).body.user.id, reg.body.user.id);
  assert.equal((await request('GET', '/auth/identities', undefined, reg.body.token)).body.identities[0].provider, 'phone');
});

test('F-G15-06 Google: رابط OAuth ← رجوع ← رمز لمرة واحدة للتطبيق ← جلسة، وربط بالبريد الموثّق', async (t) => {
  const authFetch = async (url) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token?') || String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ id_token: 'tok-1' }), { status: 200 });
    if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) return new Response(JSON.stringify({ aud: 'gid', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), sub: 'g-123', email: 'S@Example.test', email_verified: 'true', name: 'Sara G' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const { request } = await fixture(t, { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_CALLBACK_URL: 'https://shop.example/api/auth/google/callback' }, { authFetch });
  const existing = await request('POST', '/auth/register', { name: 'سارة', email: 's@example.test', password });
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'javascript:alert(1)' })).status, 400);
  // The callback issues a bearer-like one-time code in returnUrl: arbitrary sites must never receive it.
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://evil.example/auth' })).status, 400);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://shop.example.evil.example/auth' })).status, 400);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://shop.example/auth?next=evil' })).status, 400);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://shop.example/auth' })).status, 200, 'the trusted callback origin is allowed');
  const start = await request('POST', '/auth/google/start', { returnUrl: 'luqta://auth' });
  const u = new URL(start.body.url);
  assert.equal(u.hostname, 'accounts.google.com'); assert.equal(u.searchParams.get('client_id'), 'gid'); assert.ok(!start.body.url.includes('gsecret'));
  assert.equal((await request('GET', `/auth/google/callback?state=forged&code=x`)).status, 400);
  const cb = await request('GET', `/auth/google/callback?state=${encodeURIComponent(u.searchParams.get('state'))}&code=abc`);
  assert.equal(cb.status, 302); assert.match(cb.location, /^luqta:\/\/auth\?code=/);
  const appCode = new URL(cb.location).searchParams.get('code');
  const ex = await request('POST', '/auth/exchange', { code: appCode });
  assert.equal(ex.status, 200); assert.equal(ex.body.user.id, existing.body.user.id, 'linked by verified email');
  assert.equal((await request('POST', '/auth/exchange', { code: appCode })).status, 400, 'one-time code');
  const native = await request('POST', '/auth/google/id-token', { idToken: 'native-token-abcdefghijklmnop' });
  assert.equal(native.body.user.id, existing.body.user.id);
});

test('F-G15-07 حذف الحساب يزيل الهويات المرتبطة فيُسمح بالتسجيل مجددًا بالرقم', async (t) => {
  const { request } = await fixture(t, { AUTH_OTP_DEV: '1' });
  const s = await request('POST', '/auth/phone/start', { phone: '0791112222' });
  const v = await request('POST', '/auth/phone/verify', { phone: '0791112222', code: s.body.devCode });
  assert.equal((await request('DELETE', '/auth/me', { confirm: 'حذف حسابي', recoveryCode: 'wrong-code-wrong-code-wrong' }, v.body.token)).status, 401);
  const del = await request('DELETE', '/auth/me', { confirm: 'حذف حسابي', recoveryCode: v.body.recoveryCode }, v.body.token);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const s2 = await request('POST', '/auth/phone/start', { phone: '0791112222' });
  assert.equal((await request('POST', '/auth/phone/verify', { phone: '0791112222', code: s2.body.devCode })).body.isNew, true);
});


test('F-G15-08 Google redirect explicitly allowlists external storefront origins', async (t) => {
  const { request } = await fixture(t, {
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    GOOGLE_CALLBACK_URL: 'https://shop.example/api/auth/google/callback',
    GOOGLE_ALLOWED_RETURN_ORIGINS: 'https://global.example, https://bad.example/unsafe'
  });
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://global.example/auth' })).status, 200);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://bad.example/auth' })).status, 400, 'invalid configured origin paths must fail closed');
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://global.example.evil.com/auth' })).status, 400);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://global.example/evil' })).status, 400);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'https://global.example/auth#code' })).status, 400);
  assert.equal((await request('POST', '/auth/google/start', { returnUrl: 'http://127.0.0.1:19006/auth' })).status, 200, 'local Expo web dev only');
  const prod = await fixture(t, {
    NODE_ENV: 'production',
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    GOOGLE_CALLBACK_URL: 'https://shop.example/api/auth/google/callback',
    GOOGLE_ALLOWED_RETURN_ORIGINS: 'https://global.example'
  });
  assert.equal((await prod.request('POST', '/auth/google/start', { returnUrl: 'http://127.0.0.1:19006/auth' })).status, 400);
  assert.equal((await prod.request('POST', '/auth/google/start', { returnUrl: 'exp+luqta://auth' })).status, 400, 'development scheme disabled in production');
});
