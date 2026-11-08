const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, validateOrigin } = require('../luqta-api.js');

test('only exact HTTPS server origins are accepted', () => {
  assert.equal(validateOrigin('https://store.example.com/'), 'https://store.example.com');
  assert.equal(validateOrigin('http://localhost:8787'), 'http://localhost:8787');
  for (const value of ['http://store.example.com', 'https://store.example.com/path',
    'https://user:pass@store.example.com', 'https://store.example.com/?token=secret',
    'https://store.example.com/#x', 'javascript:alert(1)']) assert.throws(() => validateOrigin(value));
});

test('admin login verifies service and role before storing an in-memory session', async () => {
  const calls = [];
  const client = createClient(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, service: 'luqta-commerce', currency: 'JOD' }));
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 'session-secret', user: { id: 'admin', role: 'admin' } }));
    if (url.endsWith('/admin/overview')) return new Response(JSON.stringify({ stats: {} }));
    if (url.endsWith('/auth/logout')) return new Response(JSON.stringify({ ok: true }));
    return new Response(JSON.stringify({ error: 'missing' }), { status: 404 });
  });
  await client.login('https://store.example.com', 'admin@example.com', 'password1234');
  assert.equal(client.connected, true);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer session-secret');
  assert.equal(calls[2].options.credentials, 'omit');
  assert.equal(calls[2].options.redirect, 'error');
  await client.logout();
  assert.equal(client.connected, false);
  assert.equal(client.origin, '');
});

test('customer role is rejected and expired admin session is cleared', async () => {
  let role = 'customer';
  const client = createClient(async (url) => {
    if (url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, service: 'luqta-commerce' }));
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 'secret', user: { role } }));
    if (url.endsWith('/admin/overview')) return new Response(JSON.stringify({ stats: {} }));
    return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
  });
  await assert.rejects(client.login('https://store.example.com', 'a', 'b'), /مدير/);
  assert.equal(client.connected, false);
  role = 'admin';
  await client.login('https://store.example.com', 'a', 'b');
  await assert.rejects(client.request('GET', '/admin/products'), /expired/);
  assert.equal(client.connected, false);
});
