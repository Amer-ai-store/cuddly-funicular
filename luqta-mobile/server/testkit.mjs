// Shared fixture for the feature tests: a real commerce server on a temporary SQLite database.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createCommerceServer } from './commerce.mjs';

export const password = 'a-test-only-password-123';
export const address = { name: 'عميل تجريبي', phone: '+962790123456', city: 'عمان', street: 'شارع الاختبار 12', latitude: 31.95, longitude: 35.91 };

export async function fixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-feature-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'commerce.sqlite'), bootstrapAdmin: { name: 'مدير الاختبار', email: 'admin@example.test', password }, ...options });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const raw = (method, path, body, token, extra = {}) => fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const request = async (method, path, body, token, extra = {}) => {
    const response = await raw(method, path, body, token, extra);
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: result, headers: response.headers };
  };
  const register = async (name = 'عميل', suffix = Math.random().toString(36).slice(2), extra = {}) => {
    const result = await request('POST', '/auth/register', { name, email: `${suffix}@example.test`, password, ...extra });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  const order = async (customer, items = [{ productId: 'mug', quantity: 1 }], extra = {}) => {
    const created = await request('POST', '/orders', { items, address, paymentMethod: 'cod', idempotencyKey: `key-${Math.random().toString(36).slice(2)}`, ...extra }, customer.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.order;
  };
  let driver = null;
  const deliver = async (customer, orderId) => {
    if (!driver) { driver = await register('سائق التوصيل'); await request('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token); }
    assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status: 'confirmed', driverId: driver.user.id }, admin.token)).status, 200);
    assert.equal((await request('PATCH', `/admin/orders/${orderId}`, { status: 'preparing' }, admin.token)).status, 200);
    assert.equal((await request('PATCH', `/driver/orders/${orderId}`, { status: 'out_for_delivery' }, driver.token)).status, 200);
    const { code } = (await request('GET', `/orders/${orderId}/delivery-code`, undefined, customer.token)).body;
    const done = await request('PATCH', `/driver/orders/${orderId}`, { status: 'delivered', otp: code }, driver.token);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    return done.body.order;
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, directory, base, raw, request, register, admin, order, deliver, driver: () => driver };
}

// Builds a solid-colour RGB PNG (8-bit, filter 0) for image-search tests.
export function solidPng(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 3 + 1) + 1 + x * 3; rows[i] = r; rows[i + 1] = g; rows[i + 2] = b; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
export const pngDataUrl = (rgb) => `data:image/png;base64,${solidPng(8, 8, rgb).toString('base64')}`;
