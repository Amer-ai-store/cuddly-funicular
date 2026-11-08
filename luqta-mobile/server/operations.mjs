// G18 — Master Report v4 work packages that can be built and tested in this codebase.
// Clean-room implementations; every computed result is labelled for what it is
// (simulation, forecast, recommendation) and nothing here acts on money or stock without
// an explicit admin/customer action.
//   WP-04  inventory import preview (dry-run) + idempotent commit with stale-data guard
//   #4     price fairness passport (unit price, history, source, sync time)
//   #5     offer truth engine (a "was" price must be backed by recorded history)
//   #13    waste rescue (expiry markdown suggestions; expired items cannot be sold)
//   #14    demand swarm (low stock, reorder and branch-transfer suggestions)
//   WP-20  anomaly investigator (consistency findings with evidence, never accusations)
//   WP-19  offer laboratory (margin simulation with a minimum-margin guard)
//   #18    order evidence passport (hash-chained event trail)
//   WP-12  backups + restore drill
//   NX-20  consents (personalization / household memory / marketing)
//   NX-02  predictive household basket, NX-04 budget forecast
//   WP-13  shopping intent compiler (Arabic list → real SKUs, unknown items flagged)
//   WP-22  bounded negotiation (only rule-engine offers)
//   WP-24  agent-commerce readiness (machine-readable feed + OpenAPI; not a UCP/ACP claim)
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { normalizeQuery } from './commerceExtras.mjs';

const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const DAY = 86_400_000;
export const UNIT_BASE = { kg: ['kg', 1], g: ['kg', 0.001], l: ['l', 1], ml: ['l', 0.001], piece: ['piece', 1] };
/** Price per base unit (kg / l / piece) for products that declare unit + size. */
export function unitPrice(price, unit, size) {
  const u = UNIT_BASE[unit]; if (!u || !(size > 0)) return null;
  return { value: Math.round((price / (size * u[1])) * 1000) / 1000, per: u[0] };
}
/** Expiry markdown rule (suggestion only). */
export function markdownFor(daysLeft) {
  if (daysLeft < 0) return { action: 'remove', percent: 0 };
  if (daysLeft <= 1) return { action: 'markdown', percent: 50 };
  if (daysLeft <= 3) return { action: 'markdown', percent: 30 };
  if (daysLeft <= 7) return { action: 'markdown', percent: 15 };
  return { action: 'none', percent: 0 };
}
/** "Was" price is truthful only if the product actually sold at >= that price in the window. */
export function offerTruth(oldPrice, history, windowDays = 30, nowMs = Date.now()) {
  if (oldPrice == null) return { claim: false, verdict: 'no_claim' };
  const recent = history.filter((h) => nowMs - Date.parse(h.at) <= windowDays * DAY);
  const backed = recent.some((h) => h.price >= oldPrice - 0.0005);
  return { claim: true, verdict: backed ? 'verified' : 'unverified', windowDays, observations: recent.length };
}
/** Offer lab: simple constant-elasticity simulation with an explicit uncertainty band. */
export function simulateOffer({ price, cost, baseUnits, discountPercent, elasticity = 1.5, minMarginPercent = 10 }) {
  const newPrice = Math.round(price * (1 - discountPercent / 100) * 1000) / 1000;
  const lift = Math.pow(price / newPrice, elasticity);
  const units = baseUnits * lift, low = baseUnits * Math.pow(price / newPrice, elasticity * 0.5), high = baseUnits * Math.pow(price / newPrice, elasticity * 1.5);
  const margin = cost == null ? null : Math.round(((newPrice - cost) / newPrice) * 1000) / 10;
  const profit = (u) => (cost == null ? null : Math.round((newPrice - cost) * u * 1000) / 1000);
  const baseProfit = cost == null ? null : Math.round((price - cost) * baseUnits * 1000) / 1000;
  const allowed = margin == null ? false : margin >= minMarginPercent;
  return { kind: 'simulation', newPrice, marginPercent: margin, minMarginPercent, allowed, reason: margin == null ? 'cost_unknown' : allowed ? 'ok' : 'below_min_margin', units: { expected: Math.round(units * 10) / 10, low: Math.round(low * 10) / 10, high: Math.round(high * 10) / 10 }, profit: { baseline: baseProfit, expected: profit(units), low: profit(low), high: profit(high) } };
}

// ---- WP-13 intent compiler ----
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const WORD_NUM = { واحد: 1, وحده: 1, واحده: 1, اثنين: 2, اثنتين: 2, ثنتين: 2, تنين: 2, ثلاث: 3, ثلاثه: 3, تلات: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, نص: 0.5 };
const UNITS = { كيلو: 'kg', كغ: 'kg', كيلوغرام: 'kg', كيلوجرام: 'kg', غرام: 'g', جرام: 'g', غم: 'g', لتر: 'l', ليتر: 'l', مل: 'ml', حبه: 'piece', حبات: 'piece', قطعه: 'piece', علبه: 'pack', علب: 'pack', كرتونه: 'pack', باكيت: 'pack', ربطه: 'pack', كيس: 'pack' };
const STOP = new Set(['بدي', 'ابغى', 'اريد', 'جيب', 'هات', 'لي', 'من', 'و', 'مع', 'كمان', 'شوي', 'بس', 'please', 'اضف']);
export function splitList(text) {
  return String(text || '').replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).split(/[\n،,;؛]+|\s+و(?=\s*[\p{L}\d])/u).map((s) => s.trim()).filter(Boolean).slice(0, 60);
}
export function parseLine(line) {
  const n = normalizeQuery(line);
  let quantity = null, unit = null; const words = [];
  for (const w of n.split(' ')) {
    if (/^\d+(\.\d+)?$/.test(w)) { quantity = Number(w); continue; }
    if (w in WORD_NUM && quantity === null) { quantity = WORD_NUM[w]; continue; }
    const bare = w.replace(/^ال/, '');
    if (UNITS[w] || UNITS[bare]) { unit = UNITS[w] || UNITS[bare]; continue; }
    if (!STOP.has(w)) words.push(w);
  }
  return { raw: line, query: words.join(' '), quantity, unit };
}
export function budgetFrom(text) {
  const m = String(text || '').replace(/[٠-٩]/g, (d) => AR_DIGITS[d]).match(/(?:تحت|اقل من|أقل من|ب|بـ|ميزانيه|ميزانية)\s*(\d+(?:\.\d+)?)\s*(?:دينار|د\.ا|jod)?/i);
  return m ? Number(m[1]) : null;
}
function scoreProduct(query, p) {
  const q = normalizeQuery(query); if (!q) return 0;
  const name = normalizeQuery(p.name), hay = normalizeQuery([p.name, p.category, ...(p.tags || [])].join(' '));
  if (p.barcode && q.replace(/\s/g, '') === String(p.barcode)) return 1;
  if (name === q) return 0.98;
  const tokens = q.split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  const hit = tokens.filter((t) => hay.includes(t) || hay.includes(t.replace(/^ال/, ''))).length;
  return Math.round((hit / tokens.length) * (name.includes(tokens[0]) || name.includes(tokens[0].replace(/^ال/, '')) ? 0.9 : 0.7) * 100) / 100;
}

export function installOperations(ctx) {
  const { db, get, all, run, transaction, id, now, money, fail, text, number, integer, json, parse, requireUser, admin, identity, product, setting, audit, importInventory, rate, dbPath, bundleFor } = ctx;
  const hasTable = (name) => !!get("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?", name);
  // A paid card order is backed by the checkout's payment record (order_extras.payment) or, with a live gateway, a paid attempt.
  const cardPaymentRecorded = (orderId) => !!get("SELECT 1 AS x FROM order_extras WHERE order_id=? AND json_extract(data,'$.payment.reference') IS NOT NULL", orderId)
    || (hasTable('payment_attempts') && !!get("SELECT 1 AS x FROM payment_attempts WHERE order_id=? AND status='paid'", orderId));
  db.exec(`CREATE TABLE IF NOT EXISTS import_batches(key TEXT PRIMARY KEY,actor_id TEXT NOT NULL,import_id TEXT,before_hash TEXT NOT NULL,after_hash TEXT,result TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_costs(product_id TEXT PRIMARY KEY,cost REAL NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_consents(user_id TEXT NOT NULL,purpose TEXT NOT NULL,granted INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,purpose));
    CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,file TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,counts TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,verified_at TEXT);`);
  const PURPOSES = ['personalization', 'household_memory', 'marketing'];
  const consent = (userId, purpose) => !!get('SELECT granted FROM user_consents WHERE user_id=? AND purpose=?', userId, purpose)?.granted;
  const activeProducts = () => all('SELECT * FROM products WHERE active=1').map(product);
  const catalogHash = (ids) => sha((ids ? all(`SELECT id,data,stock FROM products WHERE id IN (${ids.map(() => '?').join(',') || "''"}) ORDER BY id`, ...ids) : all('SELECT id,data,stock FROM products ORDER BY id')).map((r) => [r.id, r.stock, parse(r.data, {}).price]));
  const history = (productId, days = 90) => all('SELECT price,old_price AS oldPrice,at FROM price_history WHERE product_id=? AND at>=? ORDER BY at', productId, new Date(Date.now() - days * DAY).toISOString());

  // ---------- WP-04 import preview / commit ----------
  function rowsFrom(body) {
    if (body.csv !== undefined) {
      const lines = String(body.csv).split(/\r?\n/).filter((l) => l.trim()); if (lines.length < 2) fail(400, 'ملف CSV فارغ');
      const head = lines[0].split(',').map((h) => h.trim());
      return lines.slice(1).map((l) => { const cells = l.split(','); return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()])); });
    }
    const rows = body.items || body.products; if (!Array.isArray(rows)) fail(400, 'أرسل csv أو items'); return rows;
  }
  function preview(body) {
    const rows = rowsFrom(body); if (!rows.length || rows.length > 2000) fail(400, 'قائمة المخزون يجب أن تحتوي على 1 إلى 2000 صنف');
    const byId = new Map(), byBarcode = new Map(), out = { create: [], update: [], unchanged: [], invalid: [], duplicates: [], priceChanges: [], unitConflicts: [] };
    const existingBarcodes = new Map(all('SELECT id,data FROM products').map((r) => [parse(r.data, {}).barcode, r.id]).filter(([b]) => b));
    rows.forEach((row, i) => {
      const line = i + 2, pid = String(row.id || row.productId || row.sku || '').trim();
      if (!pid) { out.invalid.push({ line, reason: 'missing_id' }); return; }
      if (byId.has(pid)) { out.duplicates.push({ line, id: pid, firstLine: byId.get(pid), kind: 'id' }); return; }
      byId.set(pid, line);
      const barcode = row.barcode ? String(row.barcode).replace(/\s+/g, '') : '';
      if (barcode) {
        if (byBarcode.has(barcode)) { out.duplicates.push({ line, id: pid, barcode, firstLine: byBarcode.get(barcode), kind: 'barcode' }); return; }
        byBarcode.set(barcode, line);
        const owner = existingBarcodes.get(barcode); if (owner && owner !== pid) { out.duplicates.push({ line, id: pid, barcode, existingProduct: owner, kind: 'barcode_in_catalog' }); return; }
      }
      const stock = Number(row.stock ?? row.quantity), price = row.price === undefined || row.price === '' ? null : Number(row.price);
      if (!Number.isInteger(stock) || stock < 0) { out.invalid.push({ line, id: pid, reason: 'invalid_stock' }); return; }
      if (price !== null && !(price > 0)) { out.invalid.push({ line, id: pid, reason: 'invalid_price' }); return; }
      const old = get('SELECT * FROM products WHERE id=?', pid), data = old ? parse(old.data, {}) : null;
      if (!old && (price === null || !row.name)) { out.invalid.push({ line, id: pid, reason: 'new_product_needs_name_and_price' }); return; }
      if (row.measureUnit && data?.measureUnit && row.measureUnit !== data.measureUnit) out.unitConflicts.push({ line, id: pid, from: data.measureUnit, to: row.measureUnit });
      if (!old) { out.create.push({ line, id: pid, name: row.name, price, stock }); return; }
      const newStock = body.mode === 'add' ? old.stock + stock : stock;
      const changed = newStock !== old.stock || (price !== null && money(price) !== data.price) || (row.name && row.name !== data.name);
      if (price !== null && money(price) !== data.price) out.priceChanges.push({ id: pid, from: data.price, to: money(price), changePercent: Math.round(((price - data.price) / data.price) * 1000) / 10 });
      (changed ? out.update : out.unchanged).push({ line, id: pid, stockFrom: old.stock, stockTo: newStock });
    });
    const touched = [...byId.keys()];
    const blocking = out.invalid.length + out.duplicates.length + out.unitConflicts.length;
    return { kind: 'dry_run', rows: rows.length, ...out, summary: { create: out.create.length, update: out.update.length, unchanged: out.unchanged.length, invalid: out.invalid.length, duplicates: out.duplicates.length, unitConflicts: out.unitConflicts.length }, canCommit: blocking === 0, beforeHash: catalogHash(touched), fileHash: sha(rows), largePriceChanges: out.priceChanges.filter((c) => Math.abs(c.changePercent) >= 30) };
  }

  // ---------- passport / offer truth ----------
  function passport(productId) {
    const row = get('SELECT * FROM products WHERE id=? AND active=1', productId); if (!row) fail(404, 'المنتج غير موجود', 'not_found');
    const p = product(row), h = history(productId), prices = h.map((x) => x.price);
    const lastImport = get("SELECT id,created_at FROM inventory_imports WHERE snapshot LIKE ? ORDER BY rowid DESC LIMIT 1", `%"id":"${productId.replace(/[%_"]/g, '')}"%`);
    return { productId, price: p.price, currency: setting('currency'), unitPrice: unitPrice(p.price, p.measureUnit, p.measureSize), updatedAt: row.updated_at, source: lastImport ? { kind: 'inventory_import', id: lastImport.id, at: lastImport.created_at } : { kind: 'catalog', at: row.updated_at }, history: h.slice(-30), low90: prices.length ? Math.min(...prices) : p.price, high90: prices.length ? Math.max(...prices) : p.price, changes90: Math.max(0, h.length - 1), offer: offerTruth(p.oldPrice ?? null, h) };
  }

  // ---------- stock insights ----------
  function velocity(days = 14) {
    const since = new Date(Date.now() - days * DAY).toISOString(), v = new Map();
    for (const o of all("SELECT items FROM orders WHERE status!='cancelled' AND created_at>=?", since)) for (const it of parse(o.items, [])) v.set(it.productId, (v.get(it.productId) || 0) + Number(it.quantity || 0));
    return { perDay: new Map([...v].map(([k, n]) => [k, n / days])), days };
  }
  function stockInsights(coverDays = 7) {
    const { perDay, days } = velocity(), branches = (setting('branches', []) || []).map((b) => b.id);
    const low = [], transfers = [];
    for (const row of all('SELECT * FROM products WHERE active=1')) {
      const p = parse(row.data, {}), daily = perDay.get(row.id) || 0, need = Math.ceil(daily * coverDays);
      const threshold = Math.max(5, need);
      if (row.stock <= threshold) low.push({ productId: row.id, name: p.name, stock: row.stock, dailySales: Math.round(daily * 100) / 100, coverDays: daily ? Math.round((row.stock / daily) * 10) / 10 : null, suggestedReorder: Math.max(0, need * 2 - row.stock) || 5 });
      if (p.branchStock && branches.length > 1) {
        const target = Math.max(2, Math.ceil(need / branches.length));
        const deficits = branches.filter((b) => (p.branchStock[b] ?? 0) < target), surplus = branches.filter((b) => (p.branchStock[b] ?? 0) > target * 2);
        for (const to of deficits) {
          const from = surplus.sort((a, b) => (p.branchStock[b] ?? 0) - (p.branchStock[a] ?? 0))[0]; if (!from) break;
          const qty = Math.min(target - (p.branchStock[to] ?? 0), (p.branchStock[from] ?? 0) - target);
          if (qty > 0) { transfers.push({ productId: row.id, name: p.name, from, to, quantity: qty }); p.branchStock[from] -= qty; p.branchStock[to] = (p.branchStock[to] ?? 0) + qty; }
        }
      }
    }
    return { kind: 'recommendation', windowDays: days, coverDays, lowStock: low.sort((a, b) => a.stock - b.stock), transfers };
  }
  function expiryReport(withinDays = 7) {
    const items = [];
    for (const row of all('SELECT * FROM products WHERE active=1')) {
      const p = parse(row.data, {}); if (!p.expiresAt) continue;
      const daysLeft = Math.floor((Date.parse(p.expiresAt) - Date.now()) / DAY); if (daysLeft > withinDays) continue;
      const rule = markdownFor(daysLeft);
      items.push({ productId: row.id, name: p.name, stock: row.stock, expiresAt: p.expiresAt, daysLeft, price: p.price, suggestion: rule, suggestedPrice: rule.action === 'markdown' ? money(p.price * (1 - rule.percent / 100)) : null, saleBlocked: daysLeft < 0 });
    }
    return { kind: 'recommendation', withinDays, items: items.sort((a, b) => a.daysLeft - b.daysLeft) };
  }

  // ---------- anomalies ----------
  function anomalies() {
    const f = [];
    const add = (code, severity, entity, evidence) => f.push({ code, severity, entity, evidence });
    for (const o of all('SELECT * FROM orders')) {
      const items = parse(o.items, []), sum = money(items.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0));
      if (Math.abs(sum - o.subtotal) > 0.01) add('order_subtotal_mismatch', 'high', o.id, { itemsSum: sum, subtotal: o.subtotal });
      const tip = Number(parse(get('SELECT data FROM order_extras WHERE order_id=?', o.id)?.data, {})?.tip || 0);
      if (Math.abs(money(o.subtotal - o.discount + o.shipping + tip) - o.total) > 0.01) add('order_total_mismatch', 'high', o.id, { subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, tip, total: o.total });
      if (o.payment_method === 'card' && o.payment_status === 'paid' && !cardPaymentRecorded(o.id)) add('paid_without_gateway_record', 'high', o.id, { paymentStatus: o.payment_status });
      if (o.payment_status === 'refund_due') add('refund_outstanding', 'medium', o.id, { total: o.total, since: o.updated_at });
      if (o.payment_method === 'card' && o.payment_status === 'awaiting_payment' && Date.now() - Date.parse(o.created_at) > DAY && o.status !== 'cancelled') add('stale_unpaid_card_order', 'low', o.id, { createdAt: o.created_at });
    }
    for (const a of hasTable('payment_attempts') ? all("SELECT a.order_id,o.payment_status FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE a.status='paid' AND o.payment_status NOT IN ('paid','refund_due','refunded')") : []) add('gateway_paid_order_unpaid', 'high', a.order_id, { paymentStatus: a.payment_status });
    for (const c of all('SELECT * FROM coupons WHERE max_uses IS NOT NULL AND uses>max_uses')) add('coupon_overused', 'medium', c.code, { uses: c.uses, maxUses: c.max_uses });
    for (const w of all('SELECT user_id,ROUND(SUM(amount),3) AS balance FROM wallet GROUP BY user_id HAVING balance<0')) add('negative_wallet', 'high', w.user_id, { balance: w.balance });
    for (const r of all('SELECT * FROM products WHERE active=1')) {
      const p = parse(r.data, {});
      if (p.branchStock) { const s = Object.values(p.branchStock).reduce((a, b) => a + Number(b || 0), 0); if (s > r.stock) add('branch_stock_exceeds_total', 'medium', r.id, { total: r.stock, branches: s }); }
      if (p.oldPrice != null && offerTruth(p.oldPrice, history(r.id)).verdict === 'unverified') add('unverified_was_price', 'medium', r.id, { oldPrice: p.oldPrice, price: p.price });
      if (p.expiresAt && Date.parse(p.expiresAt) < Date.now() && r.stock > 0) add('expired_stock_on_shelf', 'medium', r.id, { expiresAt: p.expiresAt, stock: r.stock });
    }
    return { kind: 'investigation_leads', note: 'نتائج للتحقق البشري وليست اتهامًا لأي شخص', checkedAt: now(), count: f.length, findings: f };
  }

  // ---------- evidence passport ----------
  function evidence(o) {
    const events = all('SELECT status,note,created_at AS at FROM order_events WHERE order_id=? ORDER BY created_at,id', o.id);
    let prev = sha({ id: o.id, items: parse(o.items, []), subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, createdAt: o.created_at });
    const chain = [{ step: 'order_created', at: o.created_at, hash: prev }];
    for (const e of events) { prev = sha(prev + JSON.stringify(e)); chain.push({ step: e.status, note: e.note, at: e.at, hash: prev }); }
    const attempts = hasTable('payment_attempts') ? all('SELECT provider,status,result_code AS resultCode,created_at AS at,updated_at AS updatedAt FROM payment_attempts WHERE order_id=? ORDER BY created_at', o.id) : [];
    return { orderId: o.id, priceSnapshot: parse(o.items, []).map((i) => ({ productId: i.productId, name: i.name, price: i.price, quantity: i.quantity })), totals: { subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, currency: o.currency }, coupon: o.coupon_id ? get('SELECT code FROM coupons WHERE id=?', o.coupon_id)?.code ?? null : null, payment: { method: o.payment_method, status: o.payment_status, attempts }, chain, head: prev };
  }

  // ---------- backups ----------
  const backupDir = dbPath && dbPath !== ':memory:' ? join(dirname(dbPath), 'backups') : null;
  function counts(database) { const c = {}; for (const t of ['users', 'products', 'orders', 'order_events', 'wallet', 'coupons']) c[t] = database.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; return c; }
  function backup(actor) {
    if (!backupDir) fail(409, 'النسخ الاحتياطي يتطلب قاعدة بيانات على القرص', 'backup_unavailable');
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const bid = id('bak'), file = join(backupDir, `${bid}.sqlite`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const bytes = statSync(file).size, digest = sha(readFileSync(file).toString('base64')), c = counts(db);
    run('INSERT INTO backups VALUES(?,?,?,?,?,?,?,NULL)', bid, basename(file), digest, bytes, json(c), actor.id, now());
    audit(actor, 'backup.create', bid, { bytes });
    return { id: bid, file: basename(file), bytes, sha256: digest, counts: c };
  }
  function restoreDrill(bid) {
    const b = get('SELECT * FROM backups WHERE id=?', bid); if (!b || !backupDir) fail(404, 'النسخة غير موجودة', 'not_found');
    const file = join(backupDir, b.file), digest = sha(readFileSync(file).toString('base64'));
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      const integrity = copy.prepare('PRAGMA integrity_check').get(), restored = counts(copy), expected = parse(b.counts, {});
      const ok = digest === b.sha256 && Object.values(integrity)[0] === 'ok' && JSON.stringify(restored) === JSON.stringify(expected);
      if (ok) run('UPDATE backups SET verified_at=? WHERE id=?', now(), bid);
      return { id: bid, ok, checksumMatches: digest === b.sha256, integrity: Object.values(integrity)[0], expected, restored };
    } finally { copy.close(); }
  }

  // ---------- household prediction ----------
  function predicted(userId, budget = null) {
    const orders = all("SELECT items,created_at FROM orders WHERE user_id=? AND status!='cancelled' ORDER BY created_at", userId);
    const seen = new Map();
    for (const o of orders) for (const it of parse(o.items, [])) { const s = seen.get(it.productId) || { times: [], qty: [] }; s.times.push(Date.parse(o.created_at)); s.qty.push(Number(it.quantity)); seen.set(it.productId, s); }
    const items = [];
    for (const [pid, s] of seen) {
      if (s.times.length < 2) continue;
      const gaps = s.times.slice(1).map((t, i) => (t - s.times[i]) / DAY).filter((g) => g > 0.5); if (!gaps.length) continue;
      const interval = gaps.reduce((a, b) => a + b, 0) / gaps.length, due = s.times.at(-1) + interval * DAY;
      const row = get('SELECT * FROM products WHERE id=? AND active=1', pid); if (!row) continue;
      const p = product(row), qty = [...s.qty].sort((a, b) => a - b)[Math.floor(s.qty.length / 2)];
      items.push({ productId: pid, name: p.name, price: p.price, quantity: Math.min(qty, p.stock), available: p.stock, intervalDays: Math.round(interval * 10) / 10, dueAt: new Date(due).toISOString(), due: due <= Date.now() + 3 * DAY, purchases: s.times.length });
    }
    let basket = items.filter((i) => i.due && i.quantity > 0).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    if (budget) { let total = 0; basket = basket.filter((i) => { const c = i.price * i.quantity; if (total + c > budget) return false; total += c; return true; }); }
    return { kind: 'suggestion_needs_confirmation', items, basket, total: money(basket.reduce((s, i) => s + i.price * i.quantity, 0)), currency: setting('currency') };
  }
  function forecast(userId) {
    const { items } = predicted(userId);
    let mid = 0, low = 0, high = 0;
    const lines = items.map((i) => {
      const perMonth = (30 / i.intervalDays) * i.quantity, h = history(i.productId).map((x) => x.price);
      const lo = h.length ? Math.min(...h) : i.price, hi = h.length ? Math.max(...h) : i.price;
      mid += perMonth * i.price; low += perMonth * lo; high += perMonth * hi;
      return { productId: i.productId, name: i.name, perMonth: Math.round(perMonth * 10) / 10, cost: money(perMonth * i.price) };
    });
    return { kind: 'forecast', note: 'تقدير مبني على مشترياتك وأسعار آخر 90 يومًا؛ ليس ضمانًا', monthly: money(mid), range: { low: money(low), high: money(high) }, lines, currency: setting('currency') };
  }

  // ---------- intent compiler ----------
  function compileIntent(input) {
    const lines = splitList(input), catalog = activeProducts(), budget = budgetFrom(input);
    const items = lines.map(parseLine).filter((l) => l.query || l.quantity !== null).map((l) => {
      const scored = catalog.map((p) => ({ p, s: scoreProduct(l.query, p) })).filter((x) => x.s >= 0.45).sort((a, b) => b.s - a.s);
      const best = scored[0];
      if (!best) return { ...l, status: 'not_found', confidence: 0, alternatives: [] };
      const qty = l.unit === 'kg' || l.unit === 'g' || l.unit === 'l' || l.unit === 'ml' ? 1 : Math.max(1, Math.round(l.quantity || 1));
      const status = best.p.stock < 1 ? 'out_of_stock' : best.s >= 0.85 ? 'matched' : 'ambiguous';
      return { ...l, status, confidence: best.s, productId: best.p.id, name: best.p.name, price: best.p.price, available: best.p.stock, quantity: Math.min(qty, Math.max(best.p.stock, 0)) || qty, unitNote: l.unit && !best.p.measureUnit ? `طلبت ${l.quantity ?? ''} ${l.unit}؛ المنتج يباع بالقطعة — راجع الكمية` : null, alternatives: scored.slice(1, 4).map((x) => ({ productId: x.p.id, name: x.p.name, price: x.p.price, confidence: x.s })) };
    });
    const sure = items.filter((i) => i.status === 'matched');
    const total = money(sure.reduce((s, i) => s + i.price * i.quantity, 0));
    return { kind: 'intent', budget, withinBudget: budget == null ? null : total <= budget, total, currency: setting('currency'), items, note: 'لا يُضاف أي صنف للسلة قبل مراجعتك؛ الأصناف غير الموجودة لا تُخترع' };
  }

  // ---------- negotiation ----------
  function negotiate(body, userId) {
    const lines = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((l) => { const row = get('SELECT * FROM products WHERE id=? AND active=1', String(l.productId)); return row ? { productId: row.id, quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)), price: parse(row.data).price, category: parse(row.data).category } : null; }).filter(Boolean);
    const subtotal = money(lines.reduce((s, l) => s + l.price * l.quantity, 0)), ask = Math.max(0, Math.min(100, Number(body.askPercent) || 0));
    const offers = [];
    const bundle = lines.length ? bundleFor(lines) : null; if (bundle) offers.push({ kind: 'bundle', title: bundle.title || bundle.name || 'حزمة توفير', discount: money(Math.min(subtotal, bundle.discount)) });
    for (const c of all("SELECT * FROM coupons WHERE active=1 AND public=1 AND (expires_at IS NULL OR expires_at>?) AND (max_uses IS NULL OR uses<max_uses) AND min_subtotal<=? AND (user_id IS NULL OR user_id=?)", now(), subtotal, userId || '')) offers.push({ kind: 'coupon', code: c.code, discount: money(c.type === 'percent' ? subtotal * c.value / 100 : Math.min(subtotal, c.value)) });
    const threshold = setting('freeShippingThreshold'); if (subtotal < threshold) offers.push({ kind: 'free_shipping_hint', addToQualify: money(threshold - subtotal), discount: 0 });
    offers.sort((a, b) => b.discount - a.discount);
    const best = offers[0]?.discount || 0, askAmount = money(subtotal * ask / 100);
    return { subtotal, askPercent: ask, accepted: ask > 0 && askAmount <= best, bestAvailable: offers[0] || null, offers, message: ask > 0 && askAmount > best ? 'لا أستطيع إنشاء خصم خارج العروض المعتمدة؛ هذه أفضل العروض المتاحة لسلتك' : 'هذه العروض المعتمدة المتاحة لسلتك', rule: 'offers come only from the store rule engine (bundles, published coupons)' };
  }

  // ---------- agent commerce ----------
  function feed(base) {
    return { '@context': 'https://schema.org', '@type': 'DataFeed', name: 'Luqta catalog', dateModified: get('SELECT MAX(updated_at) AS t FROM products').t, currency: setting('currency'), conformance: 'Luqta feed v1 — designed to map onto agent-commerce protocols later; not certified for UCP or ACP', dataFeedElement: activeProducts().filter((p) => !p.variantOf).map((p) => ({ '@type': 'Product', sku: p.sku || p.id, productID: p.id, name: p.name, category: p.category, description: (p.description || '').slice(0, 500), image: p.image || undefined, gtin: p.barcode || undefined, offers: { '@type': 'Offer', price: p.price, priceCurrency: setting('currency'), availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', priceValidUntil: p.offerEndsAt || undefined }, unitPrice: unitPrice(p.price, p.measureUnit, p.measureSize) || undefined, url: base ? `${base}/product/${encodeURIComponent(p.id)}` : undefined, dateModified: p.updatedAt })) };
  }
  const openapi = () => ({ openapi: '3.1.0', info: { title: 'Luqta commerce API (agent readiness)', version: '1.0.0', description: 'Catalog, cart validation and order creation for authorized clients. Orders require a signed-in customer token and an explicit confirmation by that customer; no autonomous payment.' }, paths: {
    '/api/agent-commerce/feed': { get: { summary: 'Machine-readable catalog feed', responses: { 200: { description: 'schema.org DataFeed' } } } },
    '/api/products': { get: { summary: 'List products', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] } },
    '/api/orders/check': { post: { summary: 'Validate cart prices and stock server-side', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, quantity: { type: 'integer' }, price: { type: 'number' } } } } } } } } } } },
    '/api/intent/parse': { post: { summary: 'Compile a shopping list into real SKUs (unknown items flagged, never invented)' } },
    '/api/orders': { post: { summary: 'Create order (customer bearer token, idempotencyKey required)', security: [{ bearer: [] }] } },
    '/api/orders/{id}/evidence': { get: { summary: 'Hash-chained order evidence passport', security: [{ bearer: [] }] } },
  }, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } });

  async function handle(method, path, body, req, url) {
    let m;
    // public
    if (method === 'GET' && (m = /^\/api\/products\/([\w.-]+)\/passport$/.exec(path))) return { status: 200, body: passport(m[1]) };
    if (method === 'GET' && path === '/api/agent-commerce/feed') return { status: 200, body: feed((process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')) };
    if (method === 'GET' && path === '/api/agent-commerce/openapi.json') return { status: 200, body: openapi() };
    if (method === 'POST' && path === '/api/intent/parse') { rate(req, 'intent', 60, 600_000); return { status: 200, body: compileIntent(text(body.text, 'القائمة', 2, 4000)) }; }
    if (method === 'POST' && path === '/api/offers/negotiate') { rate(req, 'negotiate', 60, 600_000); let uid = null; try { const a = identity(req); if (a.kind === 'user') uid = a.id; } catch { /* guest */ } return { status: 200, body: negotiate(body, uid) }; }
    // customer
    if (path === '/api/me/consents') {
      const actor = requireUser(req);
      if (method === 'PUT') { for (const k of PURPOSES) if (typeof body[k] === 'boolean') run('INSERT INTO user_consents VALUES(?,?,?,?) ON CONFLICT(user_id,purpose) DO UPDATE SET granted=excluded.granted,updated_at=excluded.updated_at', actor.id, k, body[k] ? 1 : 0, now()); audit(actor, 'consent.update', actor.id, Object.fromEntries(PURPOSES.filter((k) => typeof body[k] === 'boolean').map((k) => [k, body[k]]))); }
      if (method === 'GET' || method === 'PUT') return { status: 200, body: { consents: Object.fromEntries(PURPOSES.map((k) => [k, consent(actor.id, k)])), updatedAt: get('SELECT MAX(updated_at) AS t FROM user_consents WHERE user_id=?', actor.id).t } };
    }
    if (method === 'GET' && (path === '/api/me/predicted-basket' || path === '/api/me/budget-forecast')) {
      const actor = requireUser(req);
      if (!consent(actor.id, 'household_memory')) fail(403, 'فعّل «ذاكرة المنزل» من إعدادات الخصوصية لاستخدام هذه الميزة', 'consent_required');
      return { status: 200, body: path.endsWith('forecast') ? forecast(actor.id) : predicted(actor.id, url.searchParams.get('budget') ? number(Number(url.searchParams.get('budget')), 'الميزانية', 1, 100000) : null) };
    }
    if (method === 'GET' && (m = /^\/api\/orders\/([\w-]+)\/evidence$/.exec(path))) {
      const actor = identity(req); const o = get('SELECT * FROM orders WHERE id=?', m[1]);
      if (!o || !(actor.kind === 'user' && (actor.id === o.user_id || actor.role === 'admin'))) fail(404, 'الطلب غير موجود', 'not_found');
      return { status: 200, body: evidence(o) };
    }
    // admin operations
    if (!path.startsWith('/api/ops/')) return undefined;
    if (method === 'POST' && path === '/api/ops/import/preview') { admin(req, 'inventory:write'); return { status: 200, body: preview(body) }; }
    if (method === 'POST' && path === '/api/ops/import/commit') {
      const actor = admin(req, 'inventory:write'), key = text(body.idempotencyKey, 'مفتاح الدفعة', 8, 120);
      const prior = get('SELECT * FROM import_batches WHERE key=?', key); if (prior) return { status: 200, body: { ...parse(prior.result), replayed: true } };
      const pre = preview(body);
      if (!pre.canCommit) fail(422, 'الملف يحتوي أخطاء أو تكرارات؛ راجع المعاينة', 'import_blocked');
      if (body.expectedBeforeHash && body.expectedBeforeHash !== pre.beforeHash) fail(409, 'تغيّر المخزون منذ المعاينة؛ أعد المعاينة قبل الاعتماد', 'stale_preview');
      const result = importInventory({ ...body, mode: body.mode || 'replace' }, actor);
      const touched = [...pre.create, ...pre.update, ...pre.unchanged].map((r) => r.id), afterHash = catalogHash(touched);
      const summary = { importId: result.importId, batchKey: key, imported: result.imported, created: result.created, updated: result.updated, beforeHash: pre.beforeHash, afterHash, fileHash: pre.fileHash };
      run('INSERT INTO import_batches VALUES(?,?,?,?,?,?,?)', key, actor.id, result.importId, pre.beforeHash, afterHash, json(summary), now());
      return { status: 201, body: summary };
    }
    if (method === 'GET' && path === '/api/ops/stock-insights') { admin(req, 'inventory:write'); return { status: 200, body: stockInsights(Number(url.searchParams.get('cover')) || 7) }; }
    if (method === 'GET' && path === '/api/ops/expiry') { admin(req, 'inventory:write'); return { status: 200, body: expiryReport(Number(url.searchParams.get('days')) || 7) }; }
    if (method === 'POST' && path === '/api/ops/expiry/apply') {
      const actor = admin(req, 'catalog:write'); if (body.confirm !== true) fail(400, 'يتطلب تأكيدًا صريحًا', 'confirmation_required');
      const row = get('SELECT * FROM products WHERE id=?', text(body.productId, 'المنتج', 1, 100)); if (!row) fail(404, 'المنتج غير موجود', 'not_found');
      const p = parse(row.data), percent = number(body.percent, 'نسبة التخفيض', 1, 70); if (!p.expiresAt) fail(409, 'لا يوجد تاريخ صلاحية لهذا المنتج');
      if (Date.parse(p.expiresAt) < Date.now()) fail(409, 'المنتج منتهي الصلاحية ولا يجوز بيعه', 'expired');
      const data = { ...p, oldPrice: p.oldPrice ?? p.price, price: money(p.price * (1 - percent / 100)), wasteRescue: true };
      run('UPDATE products SET data=?,updated_at=? WHERE id=?', json(data), now(), row.id); audit(actor, 'waste.markdown', row.id, { percent, from: p.price, to: data.price });
      return { status: 200, body: { productId: row.id, price: data.price, oldPrice: data.oldPrice } };
    }
    if (method === 'GET' && path === '/api/ops/anomalies') { admin(req); return { status: 200, body: anomalies() }; }
    if (method === 'GET' && path === '/api/ops/offer-audit') { admin(req); return { status: 200, body: { items: all('SELECT id FROM products WHERE active=1').map((r) => ({ productId: r.id, ...passport(r.id).offer })).filter((x) => x.claim) } }; }
    if (method === 'PUT' && path === '/api/ops/costs') {
      const actor = admin(req, 'catalog:write'); const list = Array.isArray(body.costs) ? body.costs.slice(0, 2000) : fail(400, 'أرسل costs');
      transaction(() => { for (const c of list) { const pid = text(c.productId, 'المنتج', 1, 100); if (!get('SELECT 1 FROM products WHERE id=?', pid)) fail(404, `المنتج ${pid} غير موجود`); run('INSERT INTO product_costs VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET cost=excluded.cost,updated_at=excluded.updated_at', pid, money(number(c.cost, 'التكلفة', 0, 1e7)), now()); } });
      audit(actor, 'costs.update', '', { count: list.length }); return { status: 200, body: { updated: list.length } };
    }
    if (method === 'POST' && path === '/api/ops/offer-lab') {
      admin(req); const row = get('SELECT * FROM products WHERE id=?', text(body.productId, 'المنتج', 1, 100)); if (!row) fail(404, 'المنتج غير موجود', 'not_found');
      const p = parse(row.data), cost = get('SELECT cost FROM product_costs WHERE product_id=?', row.id)?.cost ?? null;
      const base = Math.max(1, (velocity(28).perDay.get(row.id) || 0) * 7);
      return { status: 200, body: { productId: row.id, price: p.price, cost, baseWeeklyUnits: Math.round(base * 10) / 10, ...simulateOffer({ price: p.price, cost, baseUnits: base, discountPercent: number(body.discountPercent, 'نسبة الخصم', 1, 90), elasticity: body.elasticity == null ? 1.5 : number(body.elasticity, 'المرونة', 0.1, 5), minMarginPercent: setting('minMarginPercent', 10) }), note: 'محاكاة تقديرية؛ لا تُطبّق أي خصم تلقائيًا' } };
    }
    if (method === 'POST' && path === '/api/ops/backups') { const actor = admin(req, 'settings:write'); return { status: 201, body: backup(actor) }; }
    if (method === 'GET' && path === '/api/ops/backups') { admin(req, 'settings:write'); return { status: 200, body: { backups: all('SELECT id,file,sha256,bytes,counts,created_at AS createdAt,verified_at AS verifiedAt FROM backups ORDER BY created_at DESC LIMIT 30').map((b) => ({ ...b, counts: parse(b.counts, {}) })), directory: backupDir ? 'backups/' : null, files: backupDir ? (() => { try { return readdirSync(backupDir).length; } catch { return 0; } })() : 0 } }; }
    if (method === 'POST' && (m = /^\/api\/ops\/backups\/([\w-]+)\/drill$/.exec(path))) { const actor = admin(req, 'settings:write'); const r = restoreDrill(m[1]); audit(actor, 'backup.drill', m[1], { ok: r.ok }); return { status: 200, body: r }; }
    return undefined;
  }
  const isExpired = (data) => !!data?.expiresAt && Date.parse(data.expiresAt) < Date.now();
  const deleteUser = (userId) => run('DELETE FROM user_consents WHERE user_id=?', userId);
  const exportUser = (userId) => ({ consents: all('SELECT purpose,granted,updated_at FROM user_consents WHERE user_id=?', userId) });
  return { handle, isExpired, deleteUser, exportUser };
}
