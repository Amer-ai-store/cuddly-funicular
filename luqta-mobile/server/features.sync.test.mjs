import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './testkit.mjs';
import { initialLiveState, mutateLiveState } from '../../aas-cc/command-center/server/state.mjs';

const SERVICE_KEY = 'service-key-for-tests-only-0123456789';
// A stand-in for the AAS Command Center that records every call.
function commandCenter({ failExport = 0, badReceipt = false, realState = false } = {}) {
  const calls = [];
  let exportFailures = failExport;
  let lastExport = null;
  const operations = [
    { id: 'op1', action: 'update', table: 'products', key: { id: 'milk' }, values: { price: 1.2, stock: 90 } },
    { id: 'op2', action: 'insert', table: 'products', values: { id: 'aas-honey', name: 'عسل جبلي', price: 8, stock: 5, category: 'pantry' } },
    { id: 'op3', action: 'update', table: 'users', key: { id: 'usr_x' }, values: { role: 'admin' } },
    { id: 'op4', action: 'update', table: 'products', key: { id: 'milk' }, values: { password: 'x' } },
    { id: 'op1', action: 'update', table: 'products', key: { id: 'milk' }, values: { price: 1.2 } },
  ];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers, body });
    if (u.pathname === '/api/v1/app/sync') {
      if (exportFailures-- > 0) return json(500, { error: 'temporary' });
      if (body.expectedRevision !== 7) return json(409, { error: 'revision', revision: 7 });
      // Validate the actual AAS contract, not just the mock route path.
      try {
        const validated = mutateLiveState(initialLiveState(), 'recordAppSnapshot', body);
        lastExport = validated.result;
        return json(200, { revision: 8, receivedAt: validated.result.receivedAt,
          productsAccepted: validated.result.products.length - (badReceipt ? 1 : 0), ordersAccepted: validated.result.orders.length });
      } catch (error) {
        return json(422, { error: { code: 'validation_error', message: error.message } });
      }
    }
    if (u.pathname === '/api/v1/bridge/snapshot') return json(200, { ok: true });
    if (u.pathname === '/api/v1/bridge/context') return json(200, { operations });
    if (u.pathname === '/api/v1/bridge/receipts') return json(200, { ok: true });
    if (u.pathname === '/api/v1/state' && realState) return json(200, { revision: 8, state: { commerce: lastExport || { products: [], orders: [] } } });
    if (u.pathname === '/api/v1/state') return json(200, { revision: 8, products: [
      { id: 'milk', name: 'حليب طازج كامل الدسم', retailPrice: 1.3, stockQuantity: 70, category: 'dairy' },
      { id: 'aas-dates', name: 'تمر مجدول', retailPrice: 5, stockQuantity: 10, category: 'pantry' },
      { id: 'broken', name: '', retailPrice: -1, stockQuantity: 1 },
    ] });
    return json(404, { error: 'not found' });
  };
  return { calls, fetchImpl };
}
const aas = (center, extra = {}) => ({ aas: { baseUrl: 'https://command-center.example', apiKey: 'api-key-1234567890', runnerKey: 'runner-key-1234567890', bridgeId: 'bridge_luqta', serviceKey: SERVICE_KEY, fetchImpl: center.fetchImpl, ...extra } });

test('L118 exporting to the command center maps fields, uses the API key and retries revision conflicts', async (t) => {
  const center = commandCenter();
  const { request, admin } = await fixture(t, aas(center, { siteAccessToken: 'gateway-token-for-tests-only' }));
  const status = (await request('GET', '/admin/sync/status', undefined, admin.token)).body;
  assert.deepEqual([status.config.apiKeyConfigured, status.config.runnerKeyConfigured, status.config.bridgeId], [true, true, 'bridge_luqta']);
  assert.equal(JSON.stringify(status).includes('api-key-1234567890'), false, 'keys are never returned');
  assert.equal(status.config.siteAccessTokenConfigured, true);
  assert.equal(JSON.stringify(status).includes('gateway-token-for-tests-only'), false, 'gateway token is private');
  const receipt = (await request('POST', '/admin/sync/export', {}, admin.token)).body.receipt;
  assert.equal(receipt.status, 'success'); assert.match(receipt.id, /^SYNC-\d{8}-001$/);
  const syncs = center.calls.filter((c) => c.path === '/api/v1/app/sync');
  assert.equal(syncs.length, 2, 'retried once after 409'); assert.equal(syncs[1].body.expectedRevision, 7);
  assert.equal(syncs[0].headers['X-AAS-API-Key'], 'api-key-1234567890'); assert.equal(syncs[0].headers['X-AAS-Runner-Key'], undefined);
  assert.equal(syncs[0].headers['OAI-Sites-Authorization'], 'Bearer gateway-token-for-tests-only');
  const body = syncs[1].body;
  assert.equal(body.deviceId, 'bridge_luqta');
  assert.equal(typeof body.appVersion, 'string');
  assert.ok(Number.isFinite(Date.parse(body.receivedAt)));
  const milk = body.products.find((p) => p.name === 'حليب طازج كامل الدسم');
  assert.ok(Number.isSafeInteger(milk.id) && milk.id > 0);
  assert.deepEqual({ category: milk.category, retailPrice: milk.retailPrice, stockQuantity: milk.stockQuantity,
    wholesalePrice: milk.wholesalePrice, merchantName: milk.merchantName },
  { category: 'dairy', retailPrice: 1.15, stockQuantity: 80, wholesalePrice: 0, merchantName: 'لُقطة' });
  const checked = mutateLiveState(initialLiveState(), 'recordAppSnapshot', body).state.commerce;
  assert.equal(checked.products.length, body.products.length);
  assert.equal(checked.orders.length, body.orders.length);
});


test('L118 AAS accepts exported order lines with stable numeric product IDs and no customer PII', async (t) => {
  const center = commandCenter();
  const { request, register, admin, order } = await fixture(t, aas(center));
  const customer = await register('زبون', 'aas-export-privacy');
  await order(customer, [{ productId: 'milk', quantity: 2 }, { productId: 'bread', quantity: 1 }]);
  const result = (await request('POST', '/admin/sync/export', {}, admin.token)).body.receipt;
  assert.equal(result.status, 'success', JSON.stringify(result));
  const payload = center.calls.filter((item) => item.path === '/api/v1/app/sync').at(-1).body;
  const checked = mutateLiveState(initialLiveState(), 'recordAppSnapshot', payload).state.commerce;
  assert.equal(checked.orders.length, 2);
  assert.ok(checked.orders.every((line) => Number.isSafeInteger(line.productId)));
  assert.equal(checked.orders[0].quantity, 2);
  assert.equal(checked.orders[0].totalPrice, 2.3);
  assert.ok(checked.products.some((item) => item.id === checked.orders[0].productId));
  assert.equal(JSON.stringify(payload).includes('aas-export-privacy'), false, 'no customer email or identity sent');
  assert.equal(JSON.stringify(payload).includes('+962'), false, 'no phone or address sent');
});


test('L118 rejects incomplete AAS receipts rather than reporting a false successful export', async (t) => {
  const center = commandCenter({ badReceipt: true });
  const { request, admin } = await fixture(t, aas(center));
  const receipt = (await request('POST', '/admin/sync/export', {}, admin.token)).body.receipt;
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.summary, /إيصال المركز/);
});

test('L121 resolves actual AAS numeric catalog IDs for preview without inserting duplicates', async (t) => {
  const center = commandCenter({ realState: true });
  const { request, admin } = await fixture(t, aas(center));
  assert.equal((await request('POST', '/admin/sync/export', {}, admin.token)).body.receipt.status, 'success');
  const preview = await request('POST', '/admin/sync/pull', {}, admin.token);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.applied, false);
  assert.equal(preview.body.preview.summary.new, 0);
});

test('L119 the bridge snapshot respects limits and never contains sensitive columns', async (t) => {
  const center = commandCenter();
  const { request, register, order, admin } = await fixture(t, aas(center));
  const customer = await register('عميل', 'private-person');
  await order(customer);
  const receipt = (await request('POST', '/admin/sync/snapshot', {}, admin.token)).body.receipt;
  assert.equal(receipt.status, 'success');
  const sent = center.calls.find((c) => c.path === '/api/v1/bridge/snapshot');
  assert.equal(sent.headers['X-AAS-Runner-Key'], 'runner-key-1234567890'); assert.equal(sent.body.bridgeId, 'bridge_luqta');
  const text = JSON.stringify(sent.body.snapshot);
  const columns = sent.body.snapshot.schema.flatMap((table) => table.columns.map((c) => c.name));
  assert.equal(columns.filter((c) => /password|token|secret|email|phone|card|credential|idempotency/i.test(c)).length, 0, 'no sensitive columns');
  for (const value of ['private-person', '+962', 'a-test-only-password', 'scrypt:']) assert.equal(text.includes(value), false, `snapshot leaks ${value}`);
  assert.equal(sent.body.snapshot.schema.find((s) => s.name === 'orders').columns.some((c) => c.name === 'address'), false);
  const rows = sent.body.snapshot.tables.reduce((n, table) => n + table.rows.length, 0);
  assert.ok(rows <= 500); assert.ok(Buffer.byteLength(text) <= 220_000); assert.ok(sent.body.snapshot.schema.length <= 100); assert.ok(sent.body.snapshot.tables.length <= 20);
  assert.deepEqual(sent.body.snapshot.writableTables, [{ name: 'products', columns: ['id', 'name', 'price', 'stock', 'category'], primaryKey: ['id'] }]);
});

test('L120 pending operations are applied with backups, unsafe ones rejected, and each gets a receipt', async (t) => {
  const center = commandCenter();
  const { request, admin, db } = await fixture(t, aas(center));
  const receipt = (await request('POST', '/admin/sync/run', {}, admin.token)).body.receipt;
  assert.equal(receipt.status, 'partial'); assert.equal(receipt.imported, 3); assert.equal(receipt.rejected, 2);
  const milk = (await request('GET', '/products/milk')).body.product;
  assert.deepEqual([milk.price, milk.stock], [1.2, 90]);
  assert.equal((await request('GET', '/products/aas-honey')).body.product.name, 'عسل جبلي');
  const sentReceipts = center.calls.filter((c) => c.path === '/api/v1/bridge/receipts').map((c) => c.body.receipt);
  assert.deepEqual(sentReceipts.map((r) => r.status), ['applied', 'applied', 'rejected', 'rejected', 'applied']);
  assert.deepEqual(sentReceipts.map((r) => r.backupCreated), [true, true, false, false, false]);
  assert.match(sentReceipts[2].summary, /users غير قابل للكتابة/);
  const backup = db.prepare("SELECT * FROM sync_backups WHERE operation_id='op1'").get();
  assert.equal(JSON.parse(backup.before).stock, 80); assert.equal(backup.receipt_id, receipt.id);
  assert.equal(db.prepare("SELECT role FROM users WHERE role='admin'").all().length, 1, 'no privilege change');
});

test('L121 importing from the command center shows the diff first and rejects invalid rows', async (t) => {
  const center = commandCenter();
  const { request, admin } = await fixture(t, aas(center));
  const preview = (await request('POST', '/admin/sync/pull', {}, admin.token)).body;
  assert.equal(preview.applied, false); assert.deepEqual(preview.preview.summary, { total: 3, new: 1, changed: 1, unchanged: 0, invalid: 1 });
  assert.deepEqual(preview.preview.rows[0].changes.price, [1.15, 1.3]);
  assert.equal((await request('GET', '/products/aas-dates')).status, 404, 'preview only');
  const applied = (await request('POST', '/admin/sync/pull', { apply: true }, admin.token)).body.receipt;
  assert.deepEqual([applied.status, applied.imported, applied.rejected], ['partial', 2, 1]);
  assert.equal((await request('GET', '/products/milk')).body.product.price, 1.3);
  const diff = (await request('POST', '/admin/sync/diff', { items: [{ id: 'milk', name: 'حليب طازج كامل الدسم', retailPrice: 1.3, stockQuantity: 70, category: 'dairy' }] }, admin.token)).body.preview;
  assert.equal(diff.rows[0].status, 'unchanged');
});

test('L122 receipts are listed, logs download as CSV or JSON and failed runs can be retried', async (t) => {
  const center = commandCenter({ failExport: 1 });
  const { request, raw, admin } = await fixture(t, aas(center));
  const failed = (await request('POST', '/admin/sync/export', {}, admin.token)).body.receipt;
  assert.equal(failed.status, 'failed'); assert.match(failed.summary, /500/);
  const retried = (await request('POST', `/admin/sync/receipts/${failed.id}/retry`, {}, admin.token)).body.receipt;
  assert.equal(retried.status, 'success'); assert.equal(retried.retryOf, failed.id);
  const imported = (await request('POST', '/admin/sync/import', { source: 'ملف المورد', items: [{ id: 'bread', name: 'خبز عربي', price: 0.4, stock: 90 }, { id: 'x', name: '', price: 'free' }] }, admin.token)).body.receipt;
  assert.deepEqual([imported.status, imported.imported, imported.rejected], ['partial', 1, 1]);
  const list = (await request('GET', '/admin/sync/receipts', undefined, admin.token)).body.receipts;
  assert.deepEqual(list.map((r) => r.kind), ['import', 'export', 'export']);
  const detail = (await request('GET', `/admin/sync/receipts/${imported.id}`, undefined, admin.token)).body.receipt;
  assert.equal(detail.log.find((l) => l.status === 'invalid').id, 'x');
  const csv = await raw('GET', `/admin/sync/receipts/${imported.id}/log?format=csv`, undefined, admin.token);
  assert.match(csv.headers.get('content-disposition'), new RegExp(`${imported.id}\\.csv`)); assert.match(await csv.text(), /invalid/);
  const json = await request('GET', `/admin/sync/receipts/${imported.id}/log`, undefined, admin.token);
  assert.equal(json.body.receipt.id, imported.id);
  const again = (await request('POST', `/admin/sync/receipts/${imported.id}/retry`, {}, admin.token)).body.receipt;
  assert.equal(again.retryOf, imported.id); assert.equal(again.status, 'failed', 'the invalid row is still invalid');
  assert.equal((await request('POST', `/admin/sync/receipts/${retried.id}/retry`, {}, admin.token)).body.receipt.status, 'success');
});

test('L118 L120 service-key routes for external schedulers compare keys in constant time', async (t) => {
  const center = commandCenter();
  const { request } = await fixture(t, aas(center));
  assert.equal((await request('GET', '/bridge/status')).status, 401);
  assert.equal((await request('GET', '/bridge/status', undefined, undefined, { 'X-Service-Key': 'wrong' })).status, 403);
  assert.equal((await request('GET', '/bridge/status', undefined, undefined, { 'X-Service-Key': SERVICE_KEY })).status, 200);
  assert.equal((await request('POST', '/runner/process', {}, undefined, { 'X-Service-Key': SERVICE_KEY })).body.receipt.kind, 'runner');
  assert.equal((await request('POST', '/bridge/sync', {}, undefined, { 'X-Service-Key': SERVICE_KEY })).body.receipt.kind, 'export');
});

test('L118 sync explains what is missing when the command center is not configured', async (t) => {
  const { request, admin } = await fixture(t);
  assert.equal((await request('POST', '/admin/sync/export', {}, admin.token)).body.code, 'not_configured');
  assert.equal((await request('GET', '/bridge/status', undefined, undefined, { 'X-Service-Key': 'anything' })).status, 503);
  assert.equal((await request('PUT', '/admin/sync/config', { baseUrl: 'http://insecure.example' }, admin.token)).status, 400);
  const saved = (await request('PUT', '/admin/sync/config', { baseUrl: 'https://cc.example/path', apiKey: 'a-key-1234567890', bridgeId: 'b1' }, admin.token)).body.config;
  assert.deepEqual([saved.baseUrl, saved.apiKeyConfigured, saved.runnerKeyConfigured, saved.source], ['https://cc.example', true, false, 'settings']);
});

test('L118 a connection set by the server environment cannot be overwritten from the dashboard', async (t) => {
  const { request, admin } = await fixture(t, { aas: { baseUrl: 'https://cc.example', apiKey: 'a-key-1234567890', fetchImpl: async () => new Response('{}') } });
  const locked = await request('PUT', '/admin/sync/config', { baseUrl: 'https://other.example' }, admin.token);
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, 'config_locked');
  const { config } = (await request('GET', '/admin/sync/status', undefined, admin.token)).body;
  assert.deepEqual([config.baseUrl, config.source], ['https://cc.example', 'options']);
});
