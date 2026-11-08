#!/usr/bin/env node
// Outbound-only SQLite adapter. Cloud input cannot select paths or supply SQL.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, realpath, lstat, mkdir } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { connectionEnvironment } from '../runner/runner.mjs';

const LEDGER = '_aas_bridge_operations';
const MAX_SNAPSHOT_BYTES = 190 * 1024;
const sensitive = /password|passwd|token|secret|credit|card|cvv|email|phone|address|customer|api.?key|credential|session|auth|user/i;
const identifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value) && !value.startsWith('_aas_bridge_') && !value.startsWith('sqlite_');
const operationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

function columns(value, label, max = 32) {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= max && value.every(identifier) && new Set(value).size === value.length, `${label} must be an explicit list of valid, unique column names.`);
  return value;
}

export async function loadConfiguration(path) {
  const info = await lstat(resolve(path));
  requireThat(info.isFile() && info.size <= 65536, 'Bridge configuration must be a bounded local JSON file.');
  let input; try { input = JSON.parse(await readFile(resolve(path), 'utf8')); } catch { throw new Error('Bridge configuration is not valid JSON.'); }
  requireThat(input?.version === 1 && input.adapter === 'sqlite' && operationId(input.bridgeId), 'Configure version:1, adapter:sqlite and a valid bridgeId.');
  requireThat(typeof input.databasePath === 'string' && isAbsolute(input.databasePath), 'databasePath must be an absolute operator-selected local file path.');
  const databasePath = await realpath(input.databasePath);
  const dbInfo = await lstat(databasePath);
  requireThat(dbInfo.isFile() && dbInfo.size <= 1024 * 1024 * 1024, 'The existing SQLite file must be at most 1 GiB. Missing databases are never created.');
  const readTables = input.readTables ?? [];
  const writableTables = input.writableTables ?? [];
  requireThat(Array.isArray(readTables) && readTables.length <= 20 && Array.isArray(writableTables) && writableTables.length <= 20, 'Table allowlists must contain at most 20 entries.');
  for (const table of [...readTables, ...writableTables]) {
    requireThat(object(table) && identifier(table.name), 'Table names must be explicit local identifiers.');
    columns(table.columns, 'Allowed columns');
    requireThat(!sensitive.test(table.name) && table.columns.every(column => !sensitive.test(column)), 'Customer, payment and credential fields are not supported by this inventory adapter.');
  }
  for (const table of readTables) requireThat(table.limit === undefined || (Number.isInteger(table.limit) && table.limit >= 1 && table.limit <= 100), 'Sample row limit must be 1–100.');
  for (const table of writableTables) columns(table.primaryKey, 'Primary key', 8);
  for (const list of [readTables, writableTables]) requireThat(new Set(list.map(table => table.name)).size === list.length, 'Table allowlists must be unique.');
  if (writableTables.length) requireThat(typeof input.backupDirectory === 'string' && isAbsolute(input.backupDirectory), 'Writable tables require an absolute local backupDirectory.');
  return { version: 1, adapter: 'sqlite', bridgeId: input.bridgeId, databasePath, ...(input.backupDirectory ? { backupDirectory: resolve(input.backupDirectory) } : {}), readTables, writableTables };
}

function open(config, write = false) {
  const db = new DatabaseSync(config.databasePath, { readOnly: !write, allowExtension: false });
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
  return db;
}
function tableMetadata(db) {
  const tables = db.prepare("SELECT name,type FROM sqlite_schema WHERE type='table' ORDER BY name").all().filter(table => !table.name.startsWith('sqlite_') && !table.name.startsWith('_aas_bridge_'));
  requireThat(tables.length <= 100, 'Schema exceeds the 100-table bridge limit.');
  return tables.map(table => {
    requireThat(table.name.length <= 128, 'A schema identifier exceeds the metadata limit.');
    const raw = db.prepare('SELECT name,type,"notnull" AS required,pk FROM pragma_table_info(?) ORDER BY cid').all(table.name);
    requireThat(raw.length <= 100 && raw.every(column => column.name.length <= 128 && column.type.length <= 128), 'Table metadata exceeds the bridge limit.');
    return { name: table.name, type: table.type, columns: raw.map(column => ({ name: column.name, type: column.type, primaryKey: Number(column.pk), nullable: !column.required })), primaryKey: raw.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name) };
  });
}
function validateAllowlist(schema, configured, write = false) {
  for (const table of configured) {
    const actual = schema.find(record => record.name === table.name);
    requireThat(actual && table.columns.every(column => actual.columns.some(record => record.name === column)), 'An allowed table or column does not exist in the actual SQLite schema.');
    if (write) requireThat(JSON.stringify(actual.primaryKey) === JSON.stringify(table.primaryKey), 'Configured primary key must exactly match the actual SQLite primary key.');
  }
}
function safeCell(value) {
  if (value === null) return null;
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 256);
  return '[binary omitted]';
}

/** Real, read-only schema/count observation. Row data is opt-in and bounded. */
export function readSnapshot(config) {
  const db = open(config);
  try {
    db.exec('BEGIN');
    const metadata = tableMetadata(db);
    validateAllowlist(metadata, config.readTables);
    validateAllowlist(metadata, config.writableTables, true);
    const schema = metadata.map(table => {
      const rowCount = Number(db.prepare(`SELECT COUNT(*) AS total FROM (SELECT 1 FROM ${quote(table.name)} LIMIT 100001)`).get().total);
      return { name: table.name, type: table.type, columns: table.columns, rowCount, rowCountCapped: rowCount === 100001 };
    });
    const snapshot = { adapter: 'sqlite', observedAt: now(), schema, tables: [], writableTables: config.writableTables.map(table => ({ name: table.name, columns: [...table.columns], primaryKey: [...table.primaryKey] })) };
    requireThat(Buffer.byteLength(JSON.stringify(snapshot)) <= MAX_SNAPSHOT_BYTES, 'Schema metadata exceeds the 190 KiB outbound limit.');
    let totalRows = 0;
    for (const table of config.readTables) {
      const limit = Math.min(table.limit ?? 25, 100, 500 - totalRows);
      if (limit <= 0) break;
      const statement = db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)} LIMIT ?`); statement.setReadBigInts(true);
      const actual = statement.all(limit + 1);
      const selected = { name: table.name, columns: [...table.columns], rows: [], truncated: actual.length > limit };
      snapshot.tables.push(selected);
      for (const row of actual.slice(0, limit)) {
        selected.rows.push(Object.fromEntries(table.columns.map(column => [column, safeCell(row[column])])));
        if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) { selected.rows.pop(); selected.truncated = true; break; }
        totalRows++;
      }
    }
    return snapshot;
  } finally { try { db.exec('ROLLBACK'); } finally { db.close(); } }
}

const canonical = input => JSON.stringify({ id: input.id, action: input.action, table: input.table, key: Object.fromEntries(Object.entries(input.key ?? {}).sort(([a], [b]) => a.localeCompare(b))), values: Object.fromEntries(Object.entries(input.values ?? {}).sort(([a], [b]) => a.localeCompare(b))) });
function value(input, key = false) {
  requireThat(input === null || typeof input === 'string' || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input)), 'Only JSON scalar values are accepted.');
  requireThat(!(key && input === null) && (typeof input !== 'string' || input.length <= 4000), 'Primary keys cannot be null and text values must be bounded.');
  return typeof input === 'boolean' ? Number(input) : input;
}
function validateOperation(schema, config, input) {
  requireThat(object(input) && operationId(input.id) && ['insert', 'update', 'delete'].includes(input.action), 'Operation must use a valid id and structured insert/update/delete action.');
  requireThat(!['sql', 'query', 'databasePath', 'path', 'command'].some(key => Object.hasOwn(input, key)), 'SQL, file paths and commands are never accepted from the cloud.');
  const table = config.writableTables.find(table => table.name === input.table);
  requireThat(table, 'The table is not locally authorized for writes.');
  validateAllowlist(schema, [table], true);
  const fields = Object.keys(input.values ?? {});
  if (input.action === 'insert' || input.action === 'update') {
    requireThat(object(input.values) && fields.length > 0 && fields.length <= 32 && fields.every(field => table.columns.includes(field)), 'Write values must use only locally allowed columns.');
    for (const field of fields) value(input.values[field]);
  } else requireThat(input.values === undefined, 'Delete operations cannot contain replacement values.');
  if (input.action !== 'insert') {
    requireThat(object(input.key) && Object.keys(input.key).length === table.primaryKey.length && table.primaryKey.every(column => Object.hasOwn(input.key, column)), 'Update/delete require the entire configured primary key.');
    for (const column of table.primaryKey) value(input.key[column], true);
    requireThat(input.action !== 'update' || fields.every(field => !table.primaryKey.includes(field)), 'Primary keys cannot be changed.');
  } else requireThat(input.key === undefined, 'Insert keys must be explicit allowed values or SQLite-generated values.');
  return { table, fields };
}
function ledgerExists(db) { return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(LEDGER)); }
function stored(db, bridgeId, id) { return ledgerExists(db) ? db.prepare(`SELECT digest,receipt FROM ${quote(LEDGER)} WHERE bridge_id=? AND operation_id=?`).get(bridgeId, id) : undefined; }
function createLedger(db) { db.exec(`CREATE TABLE IF NOT EXISTS ${quote(LEDGER)} (bridge_id TEXT NOT NULL,operation_id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(bridge_id,operation_id)) STRICT`); }
function recordReceipt(db, bridgeId, id, digest, receipt) { db.prepare(`INSERT INTO ${quote(LEDGER)}(bridge_id,operation_id,digest,receipt) VALUES(?,?,?,?)`).run(bridgeId, id, digest, JSON.stringify(receipt)); }
const receipt = (id, status, summary, extra = {}) => ({ operationId: id, status, observedAt: now(), changes: 0, backupCreated: false, summary, ...extra });

/** Data mutation and receipt ledger commit together in the SAME SQLite transaction. */
export async function applyOperation(config, input, { apply = false } = {}) {
  requireThat(apply === true, 'Local --apply authorization is required before any SQLite write.');
  requireThat(object(input) && operationId(input.id), 'Operation id is invalid.');
  const digest = hash(canonical(input));
  const db = open(config, true);
  try {
    const prior = stored(db, config.bridgeId, input.id);
    if (prior) {
      if (prior.digest !== digest) return { receipt: receipt(input.id, 'rejected', 'Operation id was reused with different values; no write was attempted.', { operationDigest: digest }), replayed: false };
      return { receipt: JSON.parse(prior.receipt), replayed: true };
    }
    let selected;
    try { selected = validateOperation(tableMetadata(db), config, input); }
    catch { return { receipt: receipt(input.id, 'rejected', 'Operation does not match the local table, column, value or primary-key allowlist.', { operationDigest: digest }), replayed: false }; }
    await mkdir(config.backupDirectory, { recursive: true, mode: 0o700 });
    const backupFile = join(config.backupDirectory, `${Date.now()}-${input.id}-${randomUUID()}.sqlite`);
    await writeFile(backupFile, new Uint8Array(), { flag: 'wx', mode: 0o600 });
    await backup(db, backupFile);
    createLedger(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      const concurrent = stored(db, config.bridgeId, input.id);
      if (concurrent) { db.exec('ROLLBACK'); requireThat(concurrent.digest === digest, 'Concurrent operation id mismatch.'); return { receipt: JSON.parse(concurrent.receipt), replayed: true }; }
      const { table, fields } = selected;
      let statement; let parameters;
      if (input.action === 'insert') {
        statement = db.prepare(`INSERT INTO ${quote(table.name)} (${fields.map(quote).join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
        parameters = fields.map(field => value(input.values[field]));
      } else {
        const where = table.primaryKey.map(column => `${quote(column)}=?`).join(' AND ');
        statement = db.prepare(input.action === 'delete' ? `DELETE FROM ${quote(table.name)} WHERE ${where}` : `UPDATE ${quote(table.name)} SET ${fields.map(field => `${quote(field)}=?`).join(',')} WHERE ${where}`);
        parameters = [...(input.action === 'update' ? fields.map(field => value(input.values[field])) : []), ...table.primaryKey.map(column => value(input.key[column], true))];
      }
      statement.setReadBigInts(true);
      const result = statement.run(...parameters);
      const changes = Number(result.changes);
      requireThat(changes === 1, 'Operation did not affect exactly one row.');
      const completed = receipt(input.id, 'applied', 'One row changed in a committed SQLite transaction; the local backup and operation ledger were retained.', { changes, backupCreated: true, operationDigest: digest, ...(input.action === 'insert' ? { lastInsertRowid: String(result.lastInsertRowid) } : {}) });
      recordReceipt(db, config.bridgeId, input.id, digest, completed);
      db.exec('COMMIT');
      return { receipt: completed, replayed: false };
    } catch {
      db.exec('ROLLBACK');
      const failed = receipt(input.id, 'failed', 'SQLite rejected the operation or it did not affect exactly one row; the data transaction was rolled back.', { backupCreated: true, operationDigest: digest });
      db.exec('BEGIN IMMEDIATE');
      try { recordReceipt(db, config.bridgeId, input.id, digest, failed); db.exec('COMMIT'); } catch { db.exec('ROLLBACK'); throw new Error('Could not retain the failed operation receipt; no data write was committed.'); }
      return { receipt: failed, replayed: false };
    }
  } finally { db.close(); }
}

export function pendingReceipts(config) {
  const db = open(config);
  try { return ledgerExists(db) ? db.prepare(`SELECT receipt FROM ${quote(LEDGER)} WHERE bridge_id=? AND acknowledged=0 ORDER BY rowid LIMIT 100`).all(config.bridgeId).map(row => JSON.parse(row.receipt)) : []; }
  finally { db.close(); }
}
function markAcknowledged(config, id) {
  const db = open(config, true);
  try { db.prepare(`UPDATE ${quote(LEDGER)} SET acknowledged=1 WHERE bridge_id=? AND operation_id=?`).run(config.bridgeId, id); }
  finally { db.close(); }
}

function apiClient(env, fetchImpl) {
  let base; try { base = new URL(env.AAS_BASE_URL); } catch { throw new Error('AAS_BASE_URL must be the private HTTPS site origin.'); }
  requireThat(base.protocol === 'https:' && base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash, 'AAS_BASE_URL must be an HTTPS origin.');
  for (const key of ['AAS_RUNNER_KEY', 'AAS_SITES_AUTHORIZATION']) requireThat(typeof env[key] === 'string' && env[key].trim() && !/[\r\n]/.test(env[key]), 'Private bridge connection credentials are missing or invalid.');
  return async (path, payload) => {
    let response;
    try { response = await fetchImpl(new URL(path, base), { method: payload ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'X-AAS-Runner-Key': env.AAS_RUNNER_KEY, 'OAI-Sites-Authorization': env.AAS_SITES_AUTHORIZATION, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) }); }
    catch { throw new Error('Private bridge HTTPS connection failed; no operation was replayed.'); }
    requireThat(response.ok, `Bridge API rejected the request (HTTP ${response.status}); local receipts remain available.`);
    const chunks = []; let total = 0;
    if (response.body) for await (const chunk of response.body) { total += chunk.length; requireThat(total <= 256 * 1024, 'Bridge context exceeds the response limit.'); chunks.push(Buffer.from(chunk)); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Bridge API returned invalid JSON.'); }
  };
}

/** One outbound cycle. API failure before context/snapshot means zero local writes. */
export async function runBridge(options, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = await loadConfiguration(options.config);
  env = await connectionEnvironment(options.connectionConfig, env);
  const api = apiClient(env, fetchImpl);
  const getContext = async () => {
    const context = await api(`/api/v1/bridge/context?bridgeId=${encodeURIComponent(config.bridgeId)}`);
    requireThat(context.bridge?.id === config.bridgeId && context.bridge.adapter === 'sqlite' && typeof context.bridge.enabled === 'boolean' && Array.isArray(context.operations) && context.operations.length <= 20, 'Bridge context is inconsistent or unsupported.');
    return context;
  };
  let context = await getContext();
  const result = { bridgeId: config.bridgeId, enabled: context.bridge.enabled, writeEnabled: Boolean(options.apply), applied: 0, failed: 0, rejected: 0, replayed: 0, recoveredReceipts: 0 };
  if (!context.bridge.enabled) return result;
  if (options.apply) {
    for (const saved of pendingReceipts(config)) { await api('/api/v1/bridge/receipts', { bridgeId: config.bridgeId, receipt: saved }); markAcknowledged(config, saved.operationId); result.recoveredReceipts++; }
    if (result.recoveredReceipts) context = await getContext();
  }
  const snapshot = readSnapshot(config);
  await api('/api/v1/bridge/snapshot', { bridgeId: config.bridgeId, snapshot });
  result.observedTables = snapshot.schema.length;
  result.uploadedRows = snapshot.tables.reduce((total, table) => total + table.rows.length, 0);
  if (!options.apply) { result.pendingOperations = context.operations.length; return result; }
  for (const input of context.operations) {
    const outcome = await applyOperation(config, input, { apply: true });
    await api('/api/v1/bridge/receipts', { bridgeId: config.bridgeId, receipt: outcome.receipt });
    if (outcome.receipt.status !== 'rejected') markAcknowledged(config, input.id);
    if (outcome.replayed) result.replayed++;
    else result[outcome.receipt.status]++;
  }
  if (result.applied || result.replayed) await api('/api/v1/bridge/snapshot', { bridgeId: config.bridgeId, snapshot: readSnapshot(config) });
  return result;
}

function argumentsFor(argv) {
  const options = { interval: 60 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--watch') options[arg.slice(2)] = true;
    else if (['--config', '--connection-config', '--interval'].includes(arg)) { requireThat(argv[index + 1] && !argv[index + 1].startsWith('--'), `Missing value for ${arg}.`); options[{ '--config': 'config', '--connection-config': 'connectionConfig', '--interval': 'interval' }[arg]] = argv[++index]; }
    else throw new Error('Unknown database bridge option.');
  }
  requireThat(options.config && Number.isInteger(Number(options.interval)) && Number(options.interval) >= 10 && Number(options.interval) <= 3600, 'Provide --config; polling interval must be 10–3600 seconds.');
  return options;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFor(process.argv.slice(2));
    do {
      try { console.log(JSON.stringify(await runBridge(options))); }
      catch (error) { console.error(`Database bridge stopped this cycle: ${error.message}`); if (!options.watch) { process.exitCode = 1; break; } }
      if (options.watch) await delay(Number(options.interval) * 1000);
    } while (options.watch);
  } catch { console.error('Invalid database bridge configuration or arguments. No database operation was performed.'); process.exitCode = 1; }
}
