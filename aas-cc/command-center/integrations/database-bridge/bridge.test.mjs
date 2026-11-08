import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfiguration, readSnapshot, applyOperation, pendingReceipts, runBridge } from './bridge.mjs';

const env = { AAS_BASE_URL: 'https://aas.example.com', AAS_RUNNER_KEY: 'runner-private', AAS_SITES_AUTHORIZATION: 'site-private' };
async function fixture(t, { read = false, write = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aas-sqlite-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, 'store.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,price REAL CHECK(price>=0),stock INTEGER CHECK(stock>=0)); INSERT INTO products(name,price,stock) VALUES('Actual product',12.5,8); CREATE TABLE customers(id INTEGER PRIMARY KEY,email TEXT); INSERT INTO customers VALUES(1,'private@example.invalid');"); db.close();
  const input = { version: 1, adapter: 'sqlite', bridgeId: 'bridge-fixture', databasePath, backupDirectory: join(root, 'backups'), readTables: read ? [{ name: 'products', columns: ['id', 'name', 'price', 'stock'], limit: 2 }] : [], writableTables: write ? [{ name: 'products', columns: ['name', 'price', 'stock'], primaryKey: ['id'] }] : [] };
  const path = join(root, 'config.json'); await writeFile(path, JSON.stringify(input));
  const config = await loadConfiguration(path);
  return { root, config, path, input };
}
function row(config, id = 1) { const db = new DatabaseSync(config.databasePath, { readOnly: true }); try { return { ...db.prepare('SELECT * FROM products WHERE id=?').get(id) }; } finally { db.close(); } }
function count(config) { const db = new DatabaseSync(config.databasePath, { readOnly: true }); try { return db.prepare('SELECT count(*) AS total FROM products').get().total; } finally { db.close(); } }
function hasLedger(config) { const db = new DatabaseSync(config.databasePath, { readOnly: true }); try { return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='_aas_bridge_operations'").get()); } finally { db.close(); } }

test('default observation reads actual schema/counts with zero row upload or database writes', async t => {
  const f = await fixture(t);
  const before = await readFile(f.config.databasePath);
  const snapshot = readSnapshot(f.config);
  assert.equal(snapshot.schema.find(table => table.name === 'products').rowCount, 1);
  assert.equal(snapshot.schema.find(table => table.name === 'customers').rowCount, 1);
  assert.deepEqual(snapshot.tables, []);
  assert.deepEqual(snapshot.writableTables, []);
  assert.ok(!JSON.stringify(snapshot).includes('private@example.invalid'));
  assert.ok(!JSON.stringify(snapshot).includes(f.config.databasePath));
  assert.deepEqual(await readFile(f.config.databasePath), before);
  assert.equal(hasLedger(f.config), false);
});

test('explicit product sampling is bounded, sanitized, and does not select customer rows', async t => {
  const f = await fixture(t, { read: true });
  const db = new DatabaseSync(f.config.databasePath);
  db.prepare('INSERT INTO products(name,price,stock) VALUES(?,1,1)').run('Safe\u0000name');
  db.prepare('INSERT INTO products(name,price,stock) VALUES(?,1,1)').run('Third product'); db.close();
  const snapshot = readSnapshot(f.config);
  assert.equal(snapshot.tables.length, 1);
  assert.equal(snapshot.tables[0].rows.length, 2);
  assert.equal(snapshot.tables[0].truncated, true);
  assert.equal(snapshot.tables[0].rows[1].name, 'Safename');
  assert.ok(!JSON.stringify(snapshot.tables).includes('private@example.invalid'));
});

test('a real parameterized insert retains SQL-looking text literally and idempotently', async t => {
  const f = await fixture(t, { write: true });
  const operation = { id: 'operation-insert', action: 'insert', table: 'products', values: { name: "x'); DROP TABLE products; --", price: 3, stock: 4 } };
  const first = await applyOperation(f.config, operation, { apply: true });
  assert.equal(first.receipt.status, 'applied'); assert.equal(first.receipt.changes, 1); assert.equal(first.receipt.backupCreated, true);
  assert.equal(row(f.config, 2).name, operation.values.name);
  assert.equal(count(f.config), 2);
  assert.equal(pendingReceipts(f.config)[0].operationId, operation.id);
  const replay = await applyOperation(f.config, operation, { apply: true });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(count(f.config), 2);
  const changed = await applyOperation(f.config, { ...operation, values: { ...operation.values, stock: 40 } }, { apply: true });
  assert.equal(changed.receipt.status, 'rejected');
  assert.equal(count(f.config), 2);
  assert.equal((await readdir(f.config.backupDirectory)).length, 1);
});

test('actual keyed update/delete each create a consistent pre-write backup and exact receipts', async t => {
  const f = await fixture(t, { write: true });
  const update = await applyOperation(f.config, { id: 'operation-update', action: 'update', table: 'products', key: { id: 1 }, values: { stock: 6 } }, { apply: true });
  assert.equal(update.receipt.changes, 1); assert.equal(row(f.config).stock, 6);
  const firstBackup = join(f.config.backupDirectory, (await readdir(f.config.backupDirectory))[0]);
  const backupDb = new DatabaseSync(firstBackup, { readOnly: true }); assert.equal(backupDb.prepare('SELECT stock FROM products WHERE id=1').get().stock, 8); backupDb.close();
  const deleted = await applyOperation(f.config, { id: 'operation-delete', action: 'delete', table: 'products', key: { id: 1 } }, { apply: true });
  assert.equal(deleted.receipt.status, 'applied'); assert.equal(deleted.receipt.changes, 1); assert.equal(count(f.config), 0);
  assert.equal((await readdir(f.config.backupDirectory)).length, 2);
  assert.ok(!readSnapshot(f.config).schema.some(table => table.name.startsWith('_aas_bridge_')));
});

test('local column/PK/table authorization blocks SQL injection, path input and unkeyed mass writes', async t => {
  const f = await fixture(t, { write: true });
  const base = { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 100 } };
  const inputs = [{ ...base, table: 'products;DROP TABLE customers' }, { ...base, values: { 'stock=0 WHERE 1=1 --': 1 } }, { ...base, key: {} }, { ...base, values: { id: 77 } }, { ...base, sql: 'DELETE FROM customers' }, { ...base, databasePath: '/tmp/other.sqlite' }, { ...base, values: { stock: { sql: 'bad' } } }];
  for (let index = 0; index < inputs.length; index++) {
    const result = await applyOperation(f.config, { id: `invalid-${index}`, ...inputs[index] }, { apply: true });
    assert.equal(result.receipt.status, 'rejected'); assert.equal(result.receipt.changes, 0); assert.equal(result.receipt.backupCreated, false);
  }
  assert.equal(row(f.config).stock, 8);
  assert.equal(hasLedger(f.config), false);
  await assert.rejects(applyOperation(f.config, { id: 'no-local-apply', ...base }), /authorization/);
});

test('failed constraints and missing PK rows roll back and keep durable non-success receipts', async t => {
  const f = await fixture(t, { write: true });
  const operation = { id: 'constraint-failure', action: 'update', table: 'products', key: { id: 1 }, values: { stock: -1 } };
  const result = await applyOperation(f.config, operation, { apply: true });
  assert.equal(result.receipt.status, 'failed'); assert.equal(result.receipt.changes, 0); assert.equal(row(f.config).stock, 8);
  assert.equal((await applyOperation(f.config, operation, { apply: true })).replayed, true);
  const missing = await applyOperation(f.config, { ...operation, id: 'missing-key', key: { id: '1 OR 1=1' }, values: { stock: 99 } }, { apply: true });
  assert.equal(missing.receipt.status, 'failed'); assert.equal(row(f.config).stock, 8);
});

test('configured sensitive rows, non-SQLite adapters and mismatched primary keys fail closed', async t => {
  const f = await fixture(t, { write: true });
  for (const input of [{ ...f.input, adapter: 'mysql' }, { ...f.input, readTables: [{ name: 'customers', columns: ['email'] }] }, { ...f.input, readTables: [{ name: 'products', columns: ['access_token'] }] }]) {
    await writeFile(f.path, JSON.stringify(input)); await assert.rejects(loadConfiguration(f.path));
  }
  await writeFile(f.path, JSON.stringify({ ...f.input, writableTables: [{ ...f.input.writableTables[0], primaryKey: ['name'] }] }));
  assert.throws(() => readSnapshot({ ...f.config, writableTables: [{ ...f.config.writableTables[0], primaryKey: ['name'] }] }), /primary key/);
  assert.equal(hasLedger(f.config), false);
});

test('table counts report a real lower bound after the bounded 100001-row scan', async t => {
  const f = await fixture(t);
  const db = new DatabaseSync(f.config.databasePath);
  db.exec('CREATE TABLE many(id INTEGER); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100002) INSERT INTO many SELECT i FROM n;'); db.close();
  const table = readSnapshot(f.config).schema.find(table => table.name === 'many');
  assert.equal(table.rowCount, 100001); assert.equal(table.rowCountCapped, true);
});

function server(operations, { receiptFails = false } = {}) {
  const requests = []; let pending = structuredClone(operations); let failReceipt = receiptFails;
  return { requests, clearReceiptFailure() { failReceipt = false; }, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, env.AAS_BASE_URL); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['X-AAS-Runner-Key'], env.AAS_RUNNER_KEY); assert.equal(options.headers['OAI-Sites-Authorization'], env.AAS_SITES_AUTHORIZATION);
    const path = new URL(url).pathname; const data = options.body ? JSON.parse(options.body) : null; requests.push({ path, data });
    if (path.endsWith('/context')) return Response.json({ revision: 0, bridge: { id: 'bridge-fixture', enabled: true, adapter: 'sqlite' }, operations: pending });
    if (path.endsWith('/receipts')) { if (failReceipt) throw new Error('private transport details'); pending = pending.filter(operation => operation.id !== data.receipt.operationId); }
    return Response.json({ ok: true });
  } };
}

test('offline context cannot create a ledger, backup or database mutation', async t => {
  const f = await fixture(t, { write: true }); const before = await readFile(f.config.databasePath);
  await assert.rejects(runBridge({ config: f.path, apply: true }, { env, fetchImpl: async () => { throw new Error('network down'); } }), /connection failed/);
  assert.deepEqual(await readFile(f.config.databasePath), before); assert.equal(hasLedger(f.config), false);
  await assert.rejects(readdir(f.config.backupDirectory));
});

test('read-only outbound cycle never applies an actual queued operation', async t => {
  const f = await fixture(t, { read: true, write: true });
  const api = server([{ id: 'queued-write', action: 'update', table: 'products', key: { id: 1 }, values: { stock: 2 } }]);
  const result = await runBridge({ config: f.path }, { env, fetchImpl: api.fetchImpl });
  assert.equal(result.writeEnabled, false); assert.equal(result.pendingOperations, 1); assert.equal(row(f.config).stock, 8); assert.equal(hasLedger(f.config), false);
  assert.ok(api.requests.some(request => request.path.endsWith('/snapshot'))); assert.ok(!api.requests.some(request => request.path.endsWith('/receipts')));
});

test('lost receipt acknowledgment recovers from local atomic ledger without applying a second insert', async t => {
  const f = await fixture(t, { read: true, write: true });
  const api = server([{ id: 'once-only-insert', action: 'insert', table: 'products', values: { name: 'Added once', price: 5, stock: 1 } }], { receiptFails: true });
  await assert.rejects(runBridge({ config: f.path, apply: true }, { env, fetchImpl: api.fetchImpl }), /connection failed/);
  assert.equal(count(f.config), 2); assert.equal(pendingReceipts(f.config).length, 1);
  api.clearReceiptFailure();
  const result = await runBridge({ config: f.path, apply: true }, { env, fetchImpl: api.fetchImpl });
  assert.equal(result.recoveredReceipts, 1); assert.equal(result.applied, 0); assert.equal(count(f.config), 2); assert.deepEqual(pendingReceipts(f.config), []);
  assert.equal((await readdir(f.config.backupDirectory)).length, 1);
  const latest = api.requests.filter(request => request.path.endsWith('/snapshot')).at(-1).data.snapshot;
  assert.equal(latest.schema.find(table => table.name === 'products').rowCount, 2);
});
