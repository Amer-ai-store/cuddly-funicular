import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { ControlRepository } from '../server/control.mjs';
import { DatabaseControl, normalizeDatabaseSnapshot } from '../server/database.mjs';
import { D1Repository } from '../server/repository.mjs';
import { applyOperation, loadConfiguration, readSnapshot } from '../integrations/database-bridge/bridge.mjs';

const root = resolve(import.meta.dirname, '..');
const iso = () => new Date().toISOString();
const rejection = status => error => error.status === status;

async function fixture(t, { writable = true } = {}) {
  const mf = new Miniflare({
    script: 'export default { fetch() { return new Response("isolated control-record fixture"); } };',
    modules: true, compatibilityDate: '2025-05-01', d1Databases: ['DB'],
  });
  const directory = await mkdtemp(join(tmpdir(), 'aas-control-records-'));
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir(resolve(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(resolve(root, 'drizzle', name), 'utf8')).split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  const organization = new D1Repository(db);
  const loaded = await organization.load();
  loaded.state.settings.storeName = 'Organization untouched by database control';
  await organization.compareAndSet(loaded.revision, loaded.state);
  const organizationRow = () => db.prepare('SELECT revision,document,updated_at FROM aas_app_state WHERE id=?').bind('organization').first();
  const organizationBefore = await organizationRow();
  const control = new DatabaseControl(db);
  const created = await control.create({ name: 'Actual local inventory fixture' });
  const bridgeId = created.bridges[0].id;
  const databasePath = join(directory, 'inventory.sqlite');
  const local = new DatabaseSync(databasePath);
  local.exec("CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,stock INTEGER NOT NULL CHECK(stock>=0),price REAL NOT NULL CHECK(price>=0)); INSERT INTO products(name,stock,price) VALUES('Observed local product',8,12.5); CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,email TEXT); INSERT INTO customers VALUES(1,'Private fixture customer','private-fixture@example.invalid');");
  local.close();
  const configPath = join(directory, 'bridge.json');
  await writeFile(configPath, JSON.stringify({
    version: 1, adapter: 'sqlite', bridgeId, databasePath,
    backupDirectory: join(directory, 'backups'),
    readTables: [{ name: 'products', columns: ['id', 'name', 'stock', 'price'], limit: 25 }],
    writableTables: writable ? [{ name: 'products', columns: ['name', 'stock', 'price'], primaryKey: ['id'] }] : [],
  }));
  const config = await loadConfiguration(configPath);
  const snapshot = () => control.snapshot({ bridgeId, snapshot: readSnapshot(config) });
  const queue = (requestId, operation) => control.queue({ bridgeId, requestId, operation });
  const bridge = async () => (await control.read()).bridges.find(record => record.id === bridgeId);
  const row = (id = 1) => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try { const result = database.prepare('SELECT * FROM products WHERE id=?').get(id); return result ? { ...result } : null; }
    finally { database.close(); }
  };
  return { mf, db, control, bridgeId, config, directory, snapshot, queue, bridge, row, organizationRow, organizationBefore };
}

test('database control waits for actual observation, queues intent, and retains an actual committed runner receipt', async t => {
  const f = await fixture(t);
  let bridge = await f.bridge();
  assert.equal(bridge.status, 'waiting');
  assert.equal(bridge.lastSeenAt, null);
  assert.equal(bridge.snapshot, null);
  assert.deepEqual(bridge.operations, []);
  assert.equal((await f.control.read()).capabilities.arbitrarySql, false);
  assert.deepEqual((await f.control.context(f.bridgeId)).operations, []);

  await f.snapshot();
  bridge = await f.bridge();
  assert.equal(bridge.status, 'online');
  assert.equal(bridge.snapshot.schema.find(table => table.name === 'products').rowCount, 1);
  assert.equal(bridge.snapshot.tables[0].rows[0].stock, 8);
  assert.ok(!JSON.stringify(bridge.snapshot).includes('private-fixture@example.invalid'));
  assert.ok(!JSON.stringify(bridge.snapshot).includes(f.config.databasePath));

  await f.queue('owner-stock-change', { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 6 } });
  bridge = await f.bridge();
  assert.equal(bridge.operations[0].status, 'pending');
  assert.equal(bridge.operations[0].receipt, undefined);
  assert.equal(f.row().stock, 8, 'Queuing a cloud intent must not claim or cause a local write');
  assert.equal(bridge.snapshot.tables[0].rows[0].stock, 8);

  const dispatched = (await f.control.context(f.bridgeId)).operations[0];
  assert.deepEqual(Object.keys(dispatched).sort(), ['action', 'id', 'key', 'table', 'values']);
  const applied = await applyOperation(f.config, dispatched, { apply: true });
  assert.equal(applied.receipt.status, 'applied');
  assert.equal(applied.receipt.changes, 1);
  assert.equal(f.row().stock, 6);
  assert.equal((await f.bridge()).operations[0].status, 'pending', 'The server must await the runner receipt');

  const accepted = await f.control.receipt({ bridgeId: f.bridgeId, receipt: applied.receipt });
  assert.equal(accepted.status, 'applied');
  const persisted = (await new DatabaseControl(f.db).read()).bridges.find(record => record.id === f.bridgeId);
  assert.equal(persisted.operations[0].status, 'applied');
  assert.deepEqual(persisted.operations[0].receipt, applied.receipt);
  assert.deepEqual((await f.control.context(f.bridgeId)).operations, []);
  assert.equal(persisted.snapshot.tables[0].rows[0].stock, 8, 'A receipt must not invent an unobserved replacement snapshot');
  await f.snapshot();
  assert.equal((await f.bridge()).snapshot.tables[0].rows[0].stock, 6);
  assert.deepEqual(await f.organizationRow(), f.organizationBefore);
});

test('actual insert and receipt replay are idempotent and terminal receipts cannot be replaced', async t => {
  const f = await fixture(t);
  await f.snapshot();
  const operation = { action: 'insert', table: 'products', values: { name: "Literal value'); DROP TABLE aas_app_state; --", stock: 3, price: 4.5 } };
  await Promise.all([f.queue('same-owner-request', operation), f.queue('same-owner-request', operation)]);
  assert.equal((await f.bridge()).operations.length, 1);
  const dispatched = (await f.control.context(f.bridgeId)).operations[0];
  const first = await applyOperation(f.config, dispatched, { apply: true });
  await f.control.receipt({ bridgeId: f.bridgeId, receipt: first.receipt });
  const before = structuredClone((await f.bridge()).operations[0]);
  const localReplay = await applyOperation(f.config, dispatched, { apply: true });
  assert.equal(localReplay.replayed, true);
  await f.control.receipt({ bridgeId: f.bridgeId, receipt: localReplay.receipt });
  assert.deepEqual((await f.bridge()).operations[0], before);
  assert.equal(f.row(2).name, operation.values.name);
  assert.equal(f.row(3), null);
  assert.equal((await readdir(f.config.backupDirectory)).length, 1);
  await assert.rejects(f.control.receipt({ bridgeId: f.bridgeId, receipt: { ...first.receipt, status: 'failed', changes: 0 } }), rejection(409));
  await assert.rejects(f.control.receipt({ bridgeId: f.bridgeId, receipt: { ...first.receipt, operationDigest: 'f'.repeat(64) } }), rejection(409));
  assert.deepEqual((await f.bridge()).operations[0], before);
  await f.queue('same-owner-request', operation);
  assert.equal((await f.bridge()).operations.length, 1, 'Retry after completion must not create a new write');
  await assert.rejects(f.queue('same-owner-request', { ...operation, values: { ...operation.values, stock: 99 } }), rejection(409));
  assert.deepEqual(await f.organizationRow(), f.organizationBefore);
});

test('waiting, stale, disabled, and locally read-only bridges cannot accept write intents', async t => {
  const f = await fixture(t);
  const update = { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 2 } };
  await assert.rejects(f.queue('before-observation', update), rejection(409));
  await f.snapshot();
  const records = new ControlRepository(f.db);
  await records.update('database', { bridges: [] }, state => { state.bridges[0].lastSeenAt = new Date(Date.now() - 120_000).toISOString(); return state; });
  assert.equal((await f.bridge()).status, 'stale');
  await assert.rejects(f.queue('stale-bridge', update), rejection(409));
  await f.snapshot();
  await records.update('database', { bridges: [] }, state => { state.bridges[0].enabled = false; return state; });
  await assert.rejects(f.queue('disabled-bridge', update), rejection(409));
  assert.deepEqual((await f.control.context(f.bridgeId)).operations, []);
  await records.update('database', { bridges: [] }, state => { state.bridges[0].enabled = true; return state; });
  const readOnly = readSnapshot({ ...f.config, writableTables: [] });
  await f.control.snapshot({ bridgeId: f.bridgeId, snapshot: readOnly });
  await assert.rejects(f.queue('local-readonly', update), rejection(403));
  assert.equal(f.row().stock, 8);
  assert.deepEqual((await f.bridge()).operations, []);
  assert.deepEqual(await f.organizationRow(), f.organizationBefore);
});

test('snapshot permissions reject sensitive row tables and credential columns while retaining schema-only metadata', async t => {
  const f = await fixture(t);
  const observed = readSnapshot(f.config);
  const safe = normalizeDatabaseSnapshot(observed);
  assert.ok(safe.schema.some(table => table.name === 'customers'));
  assert.ok(!JSON.stringify(safe.tables).includes('Private fixture customer'));
  for (const column of ['email', 'access_token', 'password', 'card_number', 'cvv', 'api_key', 'credential']) {
    const input = structuredClone(observed);
    input.schema.find(table => table.name === 'products').columns.push({ name: column, type: 'TEXT', primaryKey: false, nullable: true });
    input.tables[0].columns.push(column);
    input.tables[0].rows[0][column] = 'private fixture value';
    assert.throws(() => normalizeDatabaseSnapshot(input), rejection(422), `Sensitive column ${column} must not enter cloud row samples`);
  }
  const customerRows = structuredClone(observed);
  customerRows.tables.push({ name: 'customers', columns: ['id', 'name'], rows: [{ id: 1, name: 'Private fixture customer' }], truncated: false });
  assert.throws(() => normalizeDatabaseSnapshot(customerRows), rejection(422));
  const customerWrites = structuredClone(observed);
  customerWrites.writableTables.push({ name: 'customers', columns: ['name'], primaryKey: ['id'] });
  assert.throws(() => normalizeDatabaseSnapshot(customerWrites), rejection(422));
  assert.deepEqual((await f.bridge()).snapshot, null);
});

test('structured queue validation blocks arbitrary SQL, unauthorized columns, missing keys, and prototype payloads', async t => {
  const f = await fixture(t);
  await f.snapshot();
  const base = { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 1 } };
  const malformed = [
    { action: 'sql', sql: 'DROP TABLE aas_app_state' },
    { ...base, table: 'products; DROP TABLE aas_app_state; --' },
    { ...base, values: { email: 'fixture@example.invalid' } },
    { ...base, values: { unknown_column: 1 } },
    { ...base, values: { stock: { sql: 'DELETE FROM products' } } },
    { ...base, values: { stock: Number.NaN } },
    { ...base, values: { stock: 'x'.repeat(4001) } },
    { ...base, values: {} },
    { ...base, key: {} },
    { ...base, key: { id: null } },
    { ...base, key: { id: 1, unknown: 2 } },
    { ...base, values: JSON.parse('{"__proto__":"prototype write"}') },
  ];
  for (let index = 0; index < malformed.length; index++) {
    await assert.rejects(f.queue('invalid-' + index, malformed[index]), error => [403, 422].includes(error.status));
  }
  assert.deepEqual((await f.bridge()).operations, []);
  assert.equal(f.row().stock, 8);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(await f.organizationRow(), f.organizationBefore, 'SQL-looking inputs cannot execute SQL against the control database');
});

test('an applied receipt requires exactly one changed row and a real boolean backup confirmation', async t => {
  const f = await fixture(t);
  await f.snapshot();
  await f.queue('receipt-validation', { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 7 } });
  const id = (await f.bridge()).operations[0].id;
  const valid = { operationId: id, status: 'applied', changes: 1, backupCreated: true, observedAt: iso(), summary: 'Actual bridge receipt fixture', operationDigest: 'a'.repeat(64) };
  for (const bad of [
    { ...valid, backupCreated: false },
    { ...valid, backupCreated: 'false' },
    { ...valid, changes: 0 },
    { ...valid, changes: 2 },
    { ...valid, status: 'failed', changes: 1 },
    { ...valid, status: 'rejected', changes: 1 },
    { ...valid, operationDigest: 'not-a-sha256' },
    { ...valid, observedAt: 'not-a-date' },
  ]) await assert.rejects(f.control.receipt({ bridgeId: f.bridgeId, receipt: bad }), rejection(422));
  assert.equal((await f.bridge()).operations[0].status, 'pending');
  await assert.rejects(f.control.receipt({ bridgeId: f.bridgeId, receipt: { ...valid, operationId: 'missing-operation' } }), rejection(404));
  assert.equal(f.row().stock, 8);
});

test('D1 compare-and-set rejects stale documents and retries a real snapshot/queue/receipt race without losing records', async t => {
  const f = await fixture(t);
  const records = new ControlRepository(f.db);
  const first = await records.load('race-proof', { entries: [] });
  const stale = await records.load('race-proof', { entries: [] });
  assert.equal(await records.save(first, { entries: ['first committed write'] }), true);
  assert.equal(await records.save(stale, { entries: ['stale overwrite'] }), false);
  assert.deepEqual((await records.load('race-proof')).data.entries, ['first committed write']);

  await f.snapshot();
  await f.queue('first-race-operation', { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 5 } });
  const pending = (await f.control.context(f.bridgeId)).operations[0];
  const actual = await applyOperation(f.config, pending, { apply: true });
  const before = await f.organizationRow();
  const afterLocalWrite = readSnapshot(f.config);
  const outcomes = await Promise.allSettled([
    new DatabaseControl(f.db).snapshot({ bridgeId: f.bridgeId, snapshot: afterLocalWrite }),
    new DatabaseControl(f.db).queue({ bridgeId: f.bridgeId, requestId: 'second-race-operation', operation: { action: 'insert', table: 'products', values: { name: 'Queued during receipt', stock: 1, price: 3 } } }),
    new DatabaseControl(f.db).receipt({ bridgeId: f.bridgeId, receipt: actual.receipt }),
    records.update('assistant-isolated', { messages: [] }, data => { data.messages.push({ role: 'user', content: 'An independent persisted conversation' }); return data; }),
  ]);
  assert.ok(outcomes.every(result => result.status === 'fulfilled'), 'Independent D1 writers should resolve their CAS retries');
  const current = await f.bridge();
  assert.equal(current.operations.length, 2);
  assert.equal(current.operations.find(item => item.id === pending.id).status, 'applied');
  assert.equal(current.operations.find(item => item.requestId === 'second-race-operation').status, 'pending');
  assert.equal(current.snapshot.tables[0].rows[0].stock, 5);
  assert.equal((await f.control.context(f.bridgeId)).operations.length, 1);
  assert.equal((await records.load('assistant-isolated')).data.messages.length, 1);
  assert.deepEqual(await f.organizationRow(), before);
  assert.deepEqual(before, f.organizationBefore);
});
