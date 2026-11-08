// Central dashboard sync with the AAS Command Center (see the aas-middleware guide):
//   export  → POST /api/v1/app/sync         (X-AAS-API-Key)    products/orders, price→retailPrice, stock→stockQuantity
//   snapshot→ POST /api/v1/bridge/snapshot  (X-AAS-Runner-Key) schema + sample rows, never sensitive columns
//   runner  → GET  /api/v1/bridge/context   (X-AAS-Runner-Key) pending operations, applied with a backup, then
//             POST /api/v1/bridge/receipts  one receipt per operation
//   import  ← GET  /api/v1/state            (X-AAS-API-Key)    catalog pulled from the command center, diffed first
// Every run is recorded as a receipt (SYNC-YYYYMMDD-NNN) that can be downloaded or retried. External schedulers use
// /api/bridge/* and /api/runner/* with X-Service-Key (INTERNAL_SERVICE_KEY), compared in constant time.
import { createHash, timingSafeEqual } from 'node:crypto';
import { toCsv } from './management.mjs';

export const name = 'sync';

const SENSITIVE = /(password|token|secret|email|phone|card|credential|address|idempotency|hash)/i;
const SNAPSHOT_TABLES = ['categories', 'branches', 'branch_stock', 'orders', 'order_events', 'delivery_zones', 'flash_deals', 'campaigns', 'reviews', 'coupons'];
const LIMITS = { schemaTables: 100, sampleTables: 20, rows: 500, bytes: 220_000 };
const WRITABLE = { name: 'products', columns: ['id', 'name', 'price', 'stock', 'category'], primaryKey: ['id'] };
// Use the same stable mapping as src/lib/commandCenter.ts; never expose local string IDs as numeric AAS IDs.
export const productNumber = (id) => {
  let hash = 2166136261;
  const raw = String(id);
  for (let index = 0; index < raw.length; index++) hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
  return ((hash >>> 0) % 2147483647) + 1;
};
const digest = (value) => createHash('sha256').update(String(value)).digest();

export function buildSnapshot({ all, get, product }) {
  const products = all('SELECT * FROM products ORDER BY updated_at DESC').map(product);
  const schema = [{ name: 'products', type: 'table', columns: [['id', 'TEXT', 1, false], ['name', 'TEXT', 0, false], ['price', 'REAL', 0, false], ['stock', 'INTEGER', 0, false], ['category', 'TEXT', 0, true], ['active', 'INTEGER', 0, false], ['updated_at', 'TEXT', 0, false]].map(([name, type, primaryKey, nullable]) => ({ name, type, primaryKey, nullable })), rowCount: Math.min(products.length, LIMITS.rows), rowCountCapped: products.length >= LIMITS.rows }];
  for (const table of SNAPSHOT_TABLES.slice(0, LIMITS.schemaTables - 1)) {
    const columns = all(`PRAGMA table_info(${table})`);
    if (!columns.length) continue;
    const rowCount = get(`SELECT COUNT(*) AS n FROM ${table}`).n;
    schema.push({ name: table, type: 'table', columns: columns.filter((col) => !SENSITIVE.test(col.name)).map((col) => ({ name: col.name, type: col.type, primaryKey: col.pk ? 1 : 0, nullable: !col.notnull })), rowCount: Math.min(rowCount, LIMITS.rows), rowCountCapped: rowCount >= LIMITS.rows });
  }
  let budget = LIMITS.rows;
  const sample = (name, columns, rows) => { const take = rows.slice(0, Math.min(100, budget)); budget -= take.length; return { name, columns, rows: take, truncated: rows.length > take.length }; };
  const tables = [
    sample('products', ['id', 'name', 'price', 'stock', 'category'], products.map((p) => ({ id: String(p.id), name: p.name, price: p.basePrice ?? p.price, stock: p.baseStock ?? p.stock ?? 0, category: p.category ?? null }))),
    sample('categories', ['id', 'name', 'active'], all('SELECT id,name,active FROM categories ORDER BY sort')),
    sample('branches', ['id', 'name', 'city', 'active'], all('SELECT id,name,city,active FROM branches')),
    sample('branch_stock', ['branch_id', 'product_id', 'quantity', 'version'], all('SELECT branch_id,product_id,quantity,version FROM branch_stock ORDER BY branch_id,product_id')),
  ].slice(0, LIMITS.sampleTables);
  const snapshot = { adapter: 'sqlite', observedAt: new Date().toISOString(), schema, tables, writableTables: [WRITABLE] };
  while (Buffer.byteLength(JSON.stringify(snapshot)) > LIMITS.bytes) {
    const largest = snapshot.tables.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
    if (!largest.rows.length) break;
    largest.rows = largest.rows.slice(0, Math.floor(largest.rows.length * 0.8)); largest.truncated = true;
  }
  return snapshot;
}

export function install(c, api) {
  const { db, get, all, run, transaction, fail, text, integer, number, id, now, json, parse, money, admin, audit, setting, setSetting, encrypt, decrypt, options } = c;
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_receipts(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('export','snapshot','runner','import')),status TEXT NOT NULL CHECK(status IN ('success','partial','failed')),imported INTEGER NOT NULL DEFAULT 0,rejected INTEGER NOT NULL DEFAULT 0,summary TEXT NOT NULL,log TEXT NOT NULL,payload TEXT,retry_of TEXT,actor_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_backups(operation_id TEXT PRIMARY KEY,table_name TEXT NOT NULL,row_id TEXT NOT NULL,action TEXT NOT NULL,before TEXT,receipt_id TEXT NOT NULL,applied_at TEXT NOT NULL);
  `);
  const config = () => {
    const saved = setting('aasSync', {}) || {}, o = options.aas || {};
    return { baseUrl: o.baseUrl || process.env.AAS_BASE_URL || saved.baseUrl || '', apiKey: o.apiKey || process.env.AAS_API_KEY || (saved.apiKey ? decrypt(saved.apiKey) : ''), runnerKey: o.runnerKey || process.env.AAS_RUNNER_KEY || (saved.runnerKey ? decrypt(saved.runnerKey) : ''), siteAccessToken: o.siteAccessToken || process.env.AAS_SITE_ACCESS_TOKEN || '', bridgeId: o.bridgeId || process.env.AAS_BRIDGE_ID || saved.bridgeId || '', serviceKey: o.serviceKey || process.env.INTERNAL_SERVICE_KEY || '', fetch: o.fetchImpl || fetch, source: o.baseUrl ? 'options' : process.env.AAS_BASE_URL ? 'env' : saved.baseUrl ? 'settings' : 'none' };
  };
  const publicConfig = () => { const cfg = config(); return { baseUrl: cfg.baseUrl, apiKeyConfigured: !!cfg.apiKey, runnerKeyConfigured: !!cfg.runnerKey, siteAccessTokenConfigured: !!cfg.siteAccessToken, bridgeId: cfg.bridgeId, serviceKeyConfigured: !!cfg.serviceKey, source: cfg.source }; };
  const requireConfig = (cfg, needs) => {
    if (!cfg.baseUrl) fail(409, 'أعدّ عنوان لوحة القيادة المركزية أولًا (AAS_BASE_URL)', 'not_configured');
    if (needs === 'api' && !cfg.apiKey) fail(409, 'مفتاح X-AAS-API-Key غير معدّ', 'not_configured');
    if (needs === 'runner' && (!cfg.runnerKey || !cfg.bridgeId)) fail(409, 'مفتاح X-AAS-Runner-Key أو معرّف الجسر غير معدّ', 'not_configured');
  };
  const call = async (cfg, method, path, { key, body, query } = {}) => {
    const url = new URL(`/api/v1${path}`, cfg.baseUrl);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await cfg.fetch(url, { method, redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(key === 'api' ? { 'X-AAS-API-Key': cfg.apiKey } : { 'X-AAS-Runner-Key': cfg.runnerKey }), ...(cfg.siteAccessToken ? { 'OAI-Sites-Authorization': `Bearer ${cfg.siteAccessToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let data = null; try { data = await response.json(); } catch { data = null; }
      if (!response.ok) { const error = new Error(`رفضت لوحة القيادة الطلب (${response.status})`); error.upstreamStatus = response.status; error.upstream = data; throw error; }
      return data;
    } catch (error) {
      if (error.upstreamStatus) throw error;
      const wrapped = new Error('تعذر الاتصال بلوحة القيادة المركزية أو انتهت المهلة'); wrapped.upstreamStatus = 0; throw wrapped;
    } finally { clearTimeout(timer); }
  };
  // Revision conflicts (409) are retried with the revision the command center reports.
  const writeWithRetry = async (fn, maxRetries = 3) => {
    let revision;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try { return await fn(revision); } catch (error) {
        if (error.upstreamStatus === 409 && error.upstream?.revision !== undefined && attempt < maxRetries - 1) { revision = error.upstream.revision; continue; }
        throw error;
      }
    }
  };
  const receiptId = () => { const day = now().slice(0, 10).replace(/-/g, ''); const n = get('SELECT COUNT(*) AS n FROM sync_receipts WHERE id LIKE ?', `SYNC-${day}-%`).n + 1; return `SYNC-${day}-${String(n).padStart(3, '0')}`; };
  const record = (actor, kind, { status, imported = 0, rejected = 0, summary, log = [], payload = null, retryOf = null }) => {
    const receipt = receiptId();
    run('INSERT INTO sync_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)', receipt, kind, status, imported, rejected, summary, json(log), payload ? json(payload) : null, retryOf, actor.id, now());
    audit(actor, `sync.${kind}`, receipt, { status, imported, rejected });
    return receiptItem(get('SELECT * FROM sync_receipts WHERE id=?', receipt));
  };
  const receiptItem = (r) => ({ id: r.id, kind: r.kind, status: r.status, imported: r.imported, rejected: r.rejected, summary: r.summary, retryOf: r.retry_of, createdAt: r.created_at, retryable: r.kind !== 'import' || !!r.payload });
  const failure = (actor, kind, error, payload = null, retryOf = null) => record(actor, kind, { status: 'failed', summary: error.message, log: [{ at: now(), level: 'error', message: error.message, upstreamStatus: error.upstreamStatus ?? null }], payload, retryOf });

  // ---- operations ----
  const exportToCenter = async (actor, retryOf = null) => {
    const cfg = config(); requireConfig(cfg, 'api');
    try {
      const storeName = setting('storeName') || 'لُقطة';
      const sourceProducts = all('SELECT * FROM products ORDER BY id').map(c.product);
      // Refuse collisions even for archived IDs: old order lines must keep their stable numeric references.
      const usedIds = new Set();
      for (const source of sourceProducts) {
        const numericId = productNumber(source.id);
        if (usedIds.has(numericId)) throw new Error('تعارض معرفات المنتجات في لوحة القيادة؛ أُلغيت المزامنة حفاظًا على سلامة البيانات');
        usedIds.add(numericId);
      }
      const exportedProducts = sourceProducts.filter((p) => p.active && !p.hasVariants);
      if (exportedProducts.length > 1000) throw new Error('تجاوز عدد المنتجات حد لوحة القيادة (1000)');
      let wholesaleUnknown = 0;
      const products = exportedProducts.map((p) => {
        const base = p.basePrice ?? p.price, stock = p.baseStock ?? p.stock ?? 0;
        if (!Number.isFinite(base) || base < 0 || !Number.isInteger(stock) || stock < 0) throw new Error('بيانات سعر أو مخزون منتج غير صالحة للمزامنة');
        const knownWholesale = typeof p.wholesalePrice === 'number' && Number.isFinite(p.wholesalePrice) && p.wholesalePrice >= 0;
        if (!knownWholesale) wholesaleUnknown++;
        const merchant = p.vendorId ? get('SELECT name FROM vendors WHERE id=?', p.vendorId)?.name : null;
        return { id: productNumber(p.id), name: p.name.slice(0, 160),
          category: (p.category || 'عام').slice(0, 160), retailPrice: base,
          // The current AAS schema mandates a number; 0 here is an UNKNOWN placeholder, NOT observed procurement cost.
          wholesalePrice: knownWholesale ? p.wholesalePrice : 0,
          imageUrl: typeof p.image === 'string' && p.image.startsWith('https://') ? p.image : '',
          stockQuantity: stock, merchantName: String(merchant || storeName).slice(0, 160) };
      });
      const orders = all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').flatMap((o) =>
        parse(o.items, []).map((line, index) => {
          const candidateId = `${o.id}_${index + 1}`;
          const lineId = /^[A-Za-z0-9_-]{1,100}$/.test(candidateId) ? candidateId : `line_${productNumber(candidateId)}`;
          if (!Number.isInteger(line.quantity) || line.quantity < 1 || !Number.isFinite(line.price) || line.price < 0) throw new Error('بيانات أحد أسطر الطلبات غير صالحة');
          return { id: lineId, productId: productNumber(line.productId), productName: String(line.name || 'منتج').slice(0, 160),
            quantity: line.quantity, totalPrice: money(line.price * line.quantity), status: String(o.status).slice(0, 80), createdAt: o.created_at };
        }));
      if (orders.length > 1000 || new Set(orders.map((o) => o.id)).size !== orders.length) throw new Error('تجاوزت أسطر الطلبات الحد أو تعارضت معرّفاتها؛ أُلغيت المزامنة');
      const payload = { deviceId: cfg.bridgeId || 'luqta-store', appVersion: process.env.AAS_APP_VERSION || 'luqta-mobile-1.2.0',
        products, orders, receivedAt: now() };
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(payload.deviceId) || !payload.appVersion || payload.appVersion.length > 80) throw new Error('إعداد معرّف مصدر المزامنة أو إصدار التطبيق غير صالح');
      if (Buffer.byteLength(JSON.stringify(payload)) > 1_500_000) throw new Error('لقطة المزامنة أكبر من حد الاستقبال');
      const response = await writeWithRetry((expectedRevision) => call(cfg, 'POST', '/app/sync', { key: 'api', body: { ...payload, ...(expectedRevision !== undefined ? { expectedRevision } : {}) } }));
      if (!Number.isInteger(response?.revision) || response?.productsAccepted !== products.length || response?.ordersAccepted !== orders.length || typeof response?.receivedAt !== 'string') {
        throw new Error('إيصال المركز لا يثبت قبول جميع المنتجات والطلبات؛ لم تُعتمد المزامنة');
      }
      return record(actor, 'export', { status: 'success', imported: products.length, summary: `قُبل ${products.length} صنف و${orders.length} سطر طلب من لوحة القيادة`,
        log: [{ at: now(), level: 'info', message: 'POST /api/v1/app/sync', products: products.length, orderLines: orders.length,
          wholesaleUnknown, revision: response.revision }], retryOf });
    } catch (error) { return failure(actor, 'export', error, null, retryOf); }
  };
  const sendSnapshot = async (actor, retryOf = null) => {
    const cfg = config(); requireConfig(cfg, 'runner');
    const snapshot = buildSnapshot(c);
    try {
      await call(cfg, 'POST', '/bridge/snapshot', { key: 'runner', body: { bridgeId: cfg.bridgeId, snapshot } });
      const rows = snapshot.tables.reduce((s, t) => s + t.rows.length, 0);
      return record(actor, 'snapshot', { status: 'success', imported: rows, summary: `أُرسلت لقطة بـ ${snapshot.schema.length} جدول و${rows} صف عيّنة`, log: [{ at: now(), level: 'info', message: 'POST /api/v1/bridge/snapshot', tables: snapshot.schema.length, rows, bytes: Buffer.byteLength(JSON.stringify(snapshot)) }], retryOf });
    } catch (error) { return failure(actor, 'snapshot', error, null, retryOf); }
  };
  const applyOperation = (op, receipt) => {
    const opId = typeof op?.id === 'string' && op.id.length <= 120 ? op.id : null;
    if (!opId) return { status: 'rejected', changes: 0, summary: 'عملية دون معرّف' };
    if (get('SELECT operation_id FROM sync_backups WHERE operation_id=?', opId)) return { status: 'applied', changes: 0, summary: 'سبق تطبيق هذه العملية' };
    if (op.table !== WRITABLE.name) return { status: 'rejected', changes: 0, summary: `الجدول ${op.table} غير قابل للكتابة` };
    if (!['insert', 'update', 'delete'].includes(op.action)) return { status: 'rejected', changes: 0, summary: `الإجراء ${op.action} غير مدعوم` };
    const values = op.values && typeof op.values === 'object' ? op.values : {};
    const unknown = Object.keys(values).filter((k) => !WRITABLE.columns.includes(k) && !(op.action === 'insert' && k === 'id'));
    if (unknown.length) return { status: 'rejected', changes: 0, summary: `أعمدة غير مسموحة: ${unknown.join(', ')}` };
    const rowId = String(op.key?.id ?? values.id ?? '');
    if (!/^[\w-]{1,100}$/.test(rowId)) return { status: 'rejected', changes: 0, summary: 'معرّف الصف غير صالح' };
    try {
      return transaction(() => {
        const old = get('SELECT * FROM products WHERE id=?', rowId);
        if (op.action === 'insert') {
          if (old) fail(409, 'الصنف موجود مسبقًا');
          const data = c.validateProduct({ ...values, id: rowId, sku: rowId });
          run('INSERT INTO products VALUES(?,?,?,1,?)', rowId, json(data), integer(values.stock ?? 0, 'المخزون', 0, 1e7), now());
        } else {
          if (!old) fail(404, 'الصنف غير موجود');
          if (op.action === 'update') {
            const { stock, ...rest } = values, data = c.validateProduct({ ...rest, id: rowId }, parse(old.data, {}));
            run('UPDATE products SET data=?,stock=?,updated_at=? WHERE id=?', json(data), stock !== undefined ? integer(stock, 'المخزون', 0, 1e7) : old.stock, now(), rowId);
          } else run('UPDATE products SET active=0,updated_at=? WHERE id=?', now(), rowId);
        }
        run('INSERT INTO sync_backups VALUES(?,?,?,?,?,?,?)', opId, WRITABLE.name, rowId, op.action, old ? json(old) : null, receipt, now());
        api.emit('productsChanged', [rowId]);
        return { status: 'applied', changes: 1, summary: `نُفّذت عملية ${op.action} على products/${rowId}` };
      });
    } catch (error) { if (!error.status) throw error; return { status: 'failed', changes: 0, summary: error.message }; }
  };
  const runOperations = async (actor, retryOf = null) => {
    const cfg = config(); requireConfig(cfg, 'runner');
    const receipt = id('run');
    try {
      const context = await call(cfg, 'GET', '/bridge/context', { key: 'runner', query: { bridgeId: cfg.bridgeId } });
      const operations = Array.isArray(context?.operations) ? context.operations.slice(0, 200) : [];
      const log = [];
      for (const op of operations) {
        const result = applyOperation(op, receipt);
        log.push({ at: now(), operationId: op?.id ?? null, action: op?.action ?? null, table: op?.table ?? null, ...result });
        try { await call(cfg, 'POST', '/bridge/receipts', { key: 'runner', body: { bridgeId: cfg.bridgeId, receipt: { operationId: op?.id, status: result.status, observedAt: now(), changes: result.changes, backupCreated: result.status === 'applied' && result.changes > 0, summary: result.summary } } }); }
        catch (error) { log.push({ at: now(), level: 'error', operationId: op?.id ?? null, message: `تعذر إرسال إيصال العملية: ${error.message}` }); }
      }
      const applied = log.filter((l) => l.status === 'applied').length, rejected = log.filter((l) => l.status === 'rejected' || l.status === 'failed').length;
      const saved = record(actor, 'runner', { status: !rejected ? 'success' : applied ? 'partial' : 'failed', imported: applied, rejected, summary: operations.length ? `طُبّقت ${applied} من ${operations.length} عملية` : 'لا توجد عمليات معلّقة', log, retryOf });
      run('UPDATE sync_backups SET receipt_id=? WHERE receipt_id=?', saved.id, receipt);
      return saved;
    } catch (error) { return failure(actor, 'runner', error, null, retryOf); }
  };
  const fromCenter = (item) => {
    // AAS uses numeric IDs. Resolve only those known to this store; never create silent duplicates or overwrite foreign products.
    let localId = item?.id;
    if (typeof localId === 'number') {
      const matches = all('SELECT id FROM products').filter((row) => productNumber(row.id) === localId);
      if (matches.length !== 1) fail(409, 'معرّف المنتج المركزي غير معروف محليًا؛ يلزم اعتماد ربط صريح قبل الاستيراد', 'unknown_product_mapping');
      localId = matches[0].id;
    }
    return { ...item, id: localId, price: item?.price ?? item?.retailPrice, stock: item?.stock ?? item?.stockQuantity };
  };
  const importItems = (actor, items, source, retryOf = null) => {
    if (!Array.isArray(items) || !items.length || items.length > 2000) fail(400, 'قائمة الاستيراد يجب أن تحتوي على 1 إلى 2000 صنف');
    const normalized = items.map(fromCenter), preview = api.use('previewImport')({ items: normalized, mode: 'replace' });
    const valid = normalized.filter((_, i) => preview.rows[i].status !== 'invalid'), invalid = preview.rows.filter((r) => r.status === 'invalid');
    let imported = 0;
    if (valid.length) imported = c.importInventory({ items: valid, mode: 'replace' }, actor).imported;
    return record(actor, 'import', { status: !invalid.length ? 'success' : imported ? 'partial' : 'failed', imported, rejected: invalid.length, summary: `استيراد من ${source}: قُبل ${imported} ورُفض ${invalid.length}`, log: preview.rows.map((r) => ({ row: r.row, id: r.id, status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.changes && Object.keys(r.changes).length ? { changes: r.changes } : {}) })), payload: invalid.length ? { source, items: items.filter((_, i) => preview.rows[i].status === 'invalid') } : null, retryOf });
  };
  const pullState = async () => { const cfg = config(); requireConfig(cfg, 'api'); const state = await call(cfg, 'GET', '/state', { key: 'api' }); const items = state?.state?.commerce?.products ?? state?.products ?? state?.state?.products; if (!Array.isArray(items)) fail(502, 'حالة لوحة القيادة لا تحتوي قائمة منتجات صالحة', 'upstream_error'); return items; };

  // ---- admin routes (dashboard and app) ----
  api.route('GET', '/admin/sync/status', ({ req }) => { admin(req); const last = get('SELECT * FROM sync_receipts ORDER BY created_at DESC,rowid DESC LIMIT 1'); return { config: publicConfig(), lastReceipt: last ? receiptItem(last) : null, receipts: get('SELECT COUNT(*) AS n FROM sync_receipts').n, writableTables: [WRITABLE], limits: LIMITS }; });
  api.route('PUT', '/admin/sync/config', ({ req, body }) => {
    const actor = admin(req, 'settings:write'), previous = setting('aasSync', {}) || {};
    // A connection provided by the server environment (.env) or start-up options wins; saving here would be silently ignored.
    if (['env', 'options'].includes(config().source)) fail(409, 'الربط مضبوط من متغيرات بيئة الخادم (AAS_BASE_URL وما معه)؛ عدّلها في ملف ‎.env على الخادم.', 'config_locked');
    const baseUrl = text(body.baseUrl, 'عنوان لوحة القيادة', 8, 300);
    let parsed; try { parsed = new URL(baseUrl); } catch { fail(400, 'عنوان لوحة القيادة غير صالح'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(400, 'استخدم رابط HTTPS دون بيانات دخول');
    const secret = (value, old) => value === undefined ? old : value ? encrypt(text(value, 'المفتاح', 8, 500)) : null;
    setSetting('aasSync', { baseUrl: parsed.origin, apiKey: secret(body.apiKey, previous.apiKey), runnerKey: secret(body.runnerKey, previous.runnerKey), bridgeId: body.bridgeId !== undefined ? String(body.bridgeId).slice(0, 120) : previous.bridgeId || '' });
    audit(actor, 'sync.config', '', { baseUrl: parsed.origin });
    return { config: publicConfig() };
  });
  api.route('GET', '/admin/sync/snapshot-preview', ({ req }) => { admin(req); const snapshot = buildSnapshot(c); return { snapshot, bytes: Buffer.byteLength(JSON.stringify(snapshot)) }; });
  api.route('POST', '/admin/sync/export', async ({ req }) => ({ receipt: await exportToCenter(admin(req)) }));
  api.route('POST', '/admin/sync/snapshot', async ({ req }) => ({ receipt: await sendSnapshot(admin(req)) }));
  api.route('POST', '/admin/sync/run', async ({ req }) => ({ receipt: await runOperations(admin(req)) }));
  api.route('POST', '/admin/sync/diff', ({ req, body }) => { admin(req); return { preview: api.use('previewImport')({ items: (body.items || []).map(fromCenter), mode: 'replace' }) }; });
  api.route('POST', '/admin/sync/import', ({ req, body }) => ({ receipt: importItems(admin(req, 'inventory:write'), body.items, body.source ? text(body.source, 'المصدر', 2, 80) : 'ملف خارجي') }));
  api.route('POST', '/admin/sync/pull', async ({ req, body }) => {
    const actor = admin(req, 'inventory:write');
    let items; try { items = await pullState(); } catch (error) { if (error.status) throw error; return [502, { error: error.message, code: 'upstream_error', receipt: failure(actor, 'import', error) }]; }
    if (body.apply !== true) return { preview: api.use('previewImport')({ items: items.map(fromCenter), mode: 'replace' }), applied: false };
    return { receipt: importItems(actor, items, 'لوحة القيادة المركزية'), applied: true };
  });
  api.route('GET', '/admin/sync/receipts', ({ req }) => { admin(req); return { receipts: all('SELECT * FROM sync_receipts ORDER BY created_at DESC,rowid DESC LIMIT 200').map(receiptItem) }; });
  const findReceipt = (receiptKey) => { const r = get('SELECT * FROM sync_receipts WHERE id=?', receiptKey); if (!r) fail(404, 'الإيصال غير موجود', 'not_found'); return r; };
  api.route('GET', '/admin/sync/receipts/:receiptId', ({ req, params }) => { admin(req); const r = findReceipt(params.receiptId); return { receipt: { ...receiptItem(r), log: parse(r.log, []) } }; });
  api.route('GET', '/admin/sync/receipts/:receiptId/log', ({ req, params, query }) => {
    admin(req); const r = findReceipt(params.receiptId), log = parse(r.log, []);
    if (query.get('format') === 'csv') return { raw: { type: 'text/csv; charset=utf-8', content: toCsv(log.map((l) => ({ ...l, changes: l.changes && typeof l.changes === 'object' ? JSON.stringify(l.changes) : l.changes })), ['at', 'row', 'id', 'operationId', 'action', 'status', 'summary', 'error', 'message', 'changes']), filename: `${r.id}.csv` } };
    return { raw: { type: 'application/json; charset=utf-8', content: JSON.stringify({ receipt: receiptItem(r), log }, null, 2), filename: `${r.id}.json` } };
  });
  api.route('POST', '/admin/sync/receipts/:receiptId/retry', async ({ req, params }) => {
    const actor = admin(req), r = findReceipt(params.receiptId);
    if (r.kind === 'export') return { receipt: await exportToCenter(actor, r.id) };
    if (r.kind === 'snapshot') return { receipt: await sendSnapshot(actor, r.id) };
    if (r.kind === 'runner') return { receipt: await runOperations(actor, r.id) };
    const payload = parse(r.payload, null); if (!payload?.items?.length) fail(409, 'لا توجد صفوف مرفوضة لإعادة محاولتها', 'nothing_to_retry');
    return { receipt: importItems(actor, payload.items, payload.source, r.id) };
  });

  // ---- service-key routes for external schedulers (aas-middleware guide, section 6) ----
  const service = (req) => {
    const cfg = config(), key = req.headers['x-service-key'];
    if (!cfg.serviceKey) fail(503, 'INTERNAL_SERVICE_KEY غير معدّ على الخادم', 'not_configured');
    if (typeof key !== 'string' || !key) fail(401, 'مطلوب x-service-key', 'unauthorized');
    if (!timingSafeEqual(digest(key), digest(cfg.serviceKey))) fail(403, 'مفتاح الخدمة غير صحيح', 'forbidden');
    return { id: 'service:aas-middleware', kind: 'service' };
  };
  api.route('GET', '/bridge/status', ({ req }) => { service(req); return { config: publicConfig(), lastReceipt: (() => { const r = get('SELECT * FROM sync_receipts ORDER BY created_at DESC,rowid DESC LIMIT 1'); return r ? receiptItem(r) : null; })() }; });
  api.route('POST', '/bridge/snapshot', async ({ req }) => ({ receipt: await sendSnapshot(service(req)) }));
  api.route('POST', '/bridge/sync', async ({ req }) => ({ receipt: await exportToCenter(service(req)) }));
  api.route('POST', '/runner/process', async ({ req }) => ({ receipt: await runOperations(service(req)) }));
}
