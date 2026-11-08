// Store management: KPIs, sales reports, CSV/JSON exports, reorder suggestions, import previews (diff before
// applying), display-currency rates, the 125-feature catalog with test evidence, and the development log.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'management';
const HERE = dirname(fileURLToPath(import.meta.url));
export const FEATURES_PATH = resolve(HERE, '../features.json');
export const FEATURE_STATUS_PATH = resolve(HERE, '../feature-status.json');

const csvCell = (value) => { const v = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v; };
export const toCsv = (rows, columns) => `\uFEFF${columns.join(',')}\n${rows.map((row) => columns.map((key) => csvCell(row[key])).join(',')).join('\n')}\n`;

export function install(c, api) {
  const { db, get, all, run, fail, text, integer, number, id, now, json, parse, money, admin, audit, setting, setSetting, csvRows } = c;
  db.exec(`CREATE TABLE IF NOT EXISTS dev_log(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('release','feature','fix','test','note')),title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',version TEXT NOT NULL DEFAULT '',author_id TEXT,created_at TEXT NOT NULL);`);
  if (!get('SELECT id FROM dev_log LIMIT 1')) run('INSERT INTO dev_log VALUES(?,?,?,?,?,NULL,?)', 'dev_merge', 'release', 'دمج لُقطة مع Amer AI Store', 'دمج تطبيق لُقطة مع تطبيق المتجر، وتصميم جديد بوضعين نهاري وليلي، وروبوت متحرك، و125 ميزة مرتبطة باختبارات آلية.', '2.0.0', now());
  if (setting('displayCurrencies') === null) setSetting('displayCurrencies', { USD: 1.41, EUR: 1.3, SAR: 5.29, AED: 5.18 });

  // ---- KPIs and reports ----
  const paidRevenue = (from) => money(get("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status<>'cancelled' AND created_at>=?", from).n);
  api.route('GET', '/admin/kpis', ({ req }) => {
    admin(req);
    const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString(), weekStart = new Date(Date.now() - 7 * 86400_000).toISOString();
    const orders = get("SELECT COUNT(*) AS n,COALESCE(AVG(total),0) AS avg FROM orders WHERE status<>'cancelled'");
    const lastSync = get('SELECT * FROM sync_receipts ORDER BY created_at DESC LIMIT 1');
    return { kpis: {
      salesToday: paidRevenue(dayStart), salesWeek: paidRevenue(weekStart), orders: orders.n, averageOrderValue: money(orders.avg),
      activeOrders: get("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','confirmed','preparing','out_for_delivery')").n,
      categories: get('SELECT COUNT(*) AS n FROM categories WHERE active=1').n, vendors: get("SELECT COUNT(*) AS n FROM vendors WHERE status='active'").n,
      lowStock: get('SELECT COUNT(*) AS n FROM products WHERE active=1 AND stock<=5').n, openChats: get("SELECT COUNT(*) AS n FROM chat_threads WHERE status='human'").n,
      pendingReturns: get("SELECT COUNT(*) AS n FROM returns WHERE status='requested'").n,
      sync: lastSync ? { id: lastSync.id, kind: lastSync.kind, status: lastSync.status, at: lastSync.created_at } : null,
    }, currency: setting('currency') };
  });
  api.route('GET', '/admin/reports', ({ req, query }) => {
    admin(req);
    const days = Math.min(365, Math.max(1, Number(query.get('days')) || 30)), from = new Date(Date.now() - days * 86400_000).toISOString();
    const orders = all('SELECT * FROM orders WHERE created_at>=? ORDER BY created_at', from), live = orders.filter((o) => o.status !== 'cancelled');
    const byDay = new Map(), products = new Map(), categories = new Map(), payments = {};
    for (const o of live) {
      const day = o.created_at.slice(0, 10), d = byDay.get(day) || { date: day, revenue: 0, orders: 0 }; d.revenue = money(d.revenue + o.total); d.orders++; byDay.set(day, d);
      payments[o.payment_method] = money((payments[o.payment_method] || 0) + o.total);
      for (const line of parse(o.items, [])) {
        const p = products.get(line.productId) || { productId: line.productId, name: line.name, quantity: 0, revenue: 0 }; p.quantity += line.quantity; p.revenue = money(p.revenue + line.price * line.quantity); products.set(line.productId, p);
        const category = parse(get('SELECT data FROM products WHERE id=?', line.productId)?.data, {}).category || 'other';
        categories.set(category, money((categories.get(category) || 0) + line.price * line.quantity));
      }
    }
    const revenue = money(live.reduce((s, o) => s + o.total, 0)), ratings = get('SELECT COUNT(*) AS n,COALESCE(AVG(rating),0) AS avg,COALESCE(AVG(driver_rating),0) AS driver FROM order_ratings WHERE created_at>=?', from);
    const returns = get('SELECT COUNT(*) AS n FROM returns WHERE created_at>=?', from).n;
    return { range: { days, from, to: now() }, currency: setting('currency'),
      totals: { revenue, orders: live.length, cancelled: orders.length - live.length, averageOrderValue: live.length ? money(revenue / live.length) : 0, itemsSold: [...products.values()].reduce((s, p) => s + p.quantity, 0), newCustomers: get("SELECT COUNT(*) AS n FROM users WHERE role='customer' AND created_at>=?", from).n, returnsRate: live.length ? Math.round(returns / live.length * 1000) / 10 : 0, cancelRate: orders.length ? Math.round((orders.length - live.length) / orders.length * 1000) / 10 : 0 },
      byDay: [...byDay.values()], topProducts: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10), byCategory: [...categories.entries()].map(([category, value]) => ({ category, revenue: value })).sort((a, b) => b.revenue - a.revenue),
      payments, ratings: { count: ratings.n, average: money(ratings.avg), driverAverage: money(ratings.driver) } };
  });

  // ---- exports ----
  const exporters = {
    products: { columns: ['id', 'sku', 'barcode', 'name', 'category', 'price', 'oldPrice', 'stock', 'active', 'vendorId', 'updatedAt'], rows: () => all('SELECT * FROM products ORDER BY id').map(c.product).map((p) => ({ ...p, price: p.basePrice ?? p.price })) },
    inventory: { columns: ['id', 'sku', 'name', 'stock', 'price'], rows: () => all('SELECT * FROM products WHERE active=1 ORDER BY id').map(c.product).map((p) => ({ id: p.id, sku: p.sku, name: p.name, stock: p.baseStock ?? p.stock, price: p.basePrice ?? p.price })) },
    orders: { columns: ['id', 'createdAt', 'status', 'paymentMethod', 'paymentStatus', 'subtotal', 'discount', 'shipping', 'total', 'currency', 'city', 'items'], rows: () => all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 20000').map(c.order).map((o) => ({ ...o, city: o.address.city || '', items: o.items.map((l) => `${l.productId}x${l.quantity}`).join(' ') })) },
    customers: { columns: ['id', 'name', 'createdAt', 'orders', 'spent', 'walletBalance', 'points'], rows: () => all("SELECT * FROM users WHERE role='customer' AND email NOT LIKE 'deleted+%' ORDER BY created_at DESC").map((u) => ({ id: u.id, name: u.name, createdAt: u.created_at, orders: get("SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status<>'cancelled'", u.id).n, spent: money(get("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE user_id=? AND status<>'cancelled'", u.id).n), walletBalance: c.balance(u.id), points: c.rewardBalance(u.id) })) },
    'branch-stock': { columns: ['branchId', 'productId', 'quantity', 'version', 'updatedAt'], rows: () => all('SELECT branch_id AS branchId,product_id AS productId,quantity,version,updated_at AS updatedAt FROM branch_stock ORDER BY branch_id,product_id') },
  };
  api.route('GET', '/admin/export/:entity', ({ req, params, query }) => {
    const actor = admin(req), exporter = exporters[params.entity]; if (!exporter) fail(404, 'نوع التصدير غير معروف', 'not_found');
    const rows = exporter.rows(), format = query.get('format') === 'json' ? 'json' : 'csv', stamp = now().slice(0, 10);
    audit(actor, 'export', params.entity, { rows: rows.length, format });
    if (format === 'json') return { raw: { type: 'application/json; charset=utf-8', content: JSON.stringify({ entity: params.entity, exportedAt: now(), rows }, null, 2), filename: `luqta-${params.entity}-${stamp}.json` } };
    return { raw: { type: 'text/csv; charset=utf-8', content: toCsv(rows, exporter.columns), filename: `luqta-${params.entity}-${stamp}.csv` } };
  });

  // ---- reorder suggestions (sales velocity over the last 30 days) ----
  api.route('GET', '/admin/reorder', ({ req, query }) => {
    admin(req);
    const coverDays = Math.min(90, Math.max(3, Number(query.get('cover')) || 14)), since = new Date(Date.now() - 30 * 86400_000).toISOString(), sold = new Map();
    for (const o of all("SELECT items FROM orders WHERE status<>'cancelled' AND created_at>=?", since)) for (const line of parse(o.items, [])) sold.set(line.productId, (sold.get(line.productId) || 0) + line.quantity);
    const suggestions = all('SELECT * FROM products WHERE active=1').map(c.product).filter((p) => !p.hasVariants).map((p) => {
      const perDay = (sold.get(p.id) || 0) / 30, stock = p.baseStock ?? p.stock, daysLeft = perDay ? Math.floor(stock / perDay) : null;
      const target = Math.ceil(perDay * coverDays) + 5, quantity = Math.max(0, target - stock);
      return { productId: p.id, name: p.name, sku: p.sku, stock, soldLast30: sold.get(p.id) || 0, perDay: Math.round(perDay * 100) / 100, daysLeft, suggestedQuantity: quantity, urgency: stock === 0 ? 'out' : daysLeft !== null && daysLeft <= 3 || stock <= 5 ? 'high' : quantity > 0 ? 'medium' : 'ok' };
    }).filter((s) => s.suggestedQuantity > 0 || s.urgency !== 'ok').sort((a, b) => ({ out: 0, high: 1, medium: 2, ok: 3 })[a.urgency] - ({ out: 0, high: 1, medium: 2, ok: 3 })[b.urgency] || b.perDay - a.perDay);
    return { coverDays, suggestions };
  });

  // ---- import preview: validate every row and show the difference before anything is written ----
  const previewImport = (body) => {
    const rows = body.csv !== undefined ? csvRows(body.csv) : body.items || body.products;
    if (!Array.isArray(rows) || !rows.length || rows.length > 2000) fail(400, 'قائمة المخزون يجب أن تحتوي على 1 إلى 2000 صنف');
    const mode = body.mode || 'replace', seen = new Set(), results = [];
    rows.forEach((row, index) => {
      try {
        const productId = text(String(row.id || row.productId || row.sku || ''), 'معرّف الصنف أو SKU', 1, 100);
        if (seen.has(productId)) fail(400, 'صنف مكرر في الملف'); seen.add(productId);
        const old = get('SELECT * FROM products WHERE id=?', productId), before = old ? parse(old.data, {}) : null;
        const stock = integer(row.stock ?? row.quantity, 'المخزون', 0, 1e7), data = c.validateProduct({ ...row, id: productId }, before || {});
        const finalStock = mode === 'add' && old ? old.stock + stock : stock;
        const changes = {};
        if (!old) Object.assign(changes, { name: [null, data.name], price: [null, data.price], stock: [null, finalStock] });
        else {
          for (const key of ['name', 'price', 'category', 'oldPrice']) if (JSON.stringify(before[key] ?? null) !== JSON.stringify(data[key] ?? null)) changes[key] = [before[key] ?? null, data[key] ?? null];
          if (old.stock !== finalStock) changes.stock = [old.stock, finalStock];
        }
        results.push({ row: index + 1, id: productId, name: data.name, status: !old ? 'new' : Object.keys(changes).length ? 'changed' : 'unchanged', changes });
      } catch (error) { if (!error.status) throw error; results.push({ row: index + 1, id: String(row.id || row.sku || ''), status: 'invalid', error: error.message }); }
    });
    const count = (status) => results.filter((r) => r.status === status).length;
    return { mode, summary: { total: results.length, new: count('new'), changed: count('changed'), unchanged: count('unchanged'), invalid: count('invalid') }, rows: results };
  };
  api.provide('previewImport', previewImport);
  api.route('POST', '/admin/inventory-preview', ({ req, body }) => { admin(req); return { preview: previewImport(body), applied: false }; });

  // ---- display currencies (prices are always charged in the store currency) ----
  api.route('PUT', '/admin/currency-rates', ({ req, body }) => {
    const actor = admin(req);
    if (!body.rates || typeof body.rates !== 'object' || Array.isArray(body.rates) || Object.keys(body.rates).length > 20) fail(400, 'أسعار الصرف غير صالحة');
    const rates = {};
    for (const [code, rate] of Object.entries(body.rates)) { if (!/^[A-Z]{3}$/.test(code) || code === setting('currency')) fail(400, `رمز العملة ${code} غير صالح`); rates[code] = Math.round(number(rate, `سعر ${code}`, 0.0001, 100000) * 10000) / 10000; }
    setSetting('displayCurrencies', rates); audit(actor, 'currency.rates', '', rates);
    return { displayCurrencies: rates, base: setting('currency') };
  });

  // ---- feature catalog (125 features) with automated test evidence, and the development log ----
  const featureStatus = () => existsSync(FEATURE_STATUS_PATH) ? parse(readFileSync(FEATURE_STATUS_PATH, 'utf8'), null) : null;
  api.route('GET', '/admin/features', ({ req }) => {
    admin(req);
    const catalog = JSON.parse(readFileSync(FEATURES_PATH, 'utf8')), status = featureStatus();
    // Verified means passing tests on every surface the feature lists (server, app, dashboard) and no failing test.
    const features = catalog.features.map((f) => {
      const evidence = status?.features?.[f.id];
      const surfaces = Object.fromEntries(f.surfaces.map((s) => [s, { passed: evidence?.surfaces?.[s]?.passed || 0, failed: evidence?.surfaces?.[s]?.failed || 0 }]));
      const failing = !!evidence?.failed || Object.values(surfaces).some((x) => x.failed);
      const complete = Object.values(surfaces).every((x) => x.passed > 0);
      return { ...f, tests: evidence?.tests || [], evidence: surfaces, status: failing ? 'failing' : complete ? 'verified' : 'implemented' };
    });
    const verified = features.filter((f) => f.status === 'verified').length;
    return { total: features.length, verified, failing: features.filter((f) => f.status === 'failing').length, testedAt: status?.generatedAt || null, areas: catalog.areas, features };
  });
  api.route('GET', '/admin/test-log', ({ req }) => { admin(req); const status = featureStatus(); return { testedAt: status?.generatedAt || null, summary: status?.summary || null, tests: status?.tests || [] }; });
  api.route('GET', '/admin/devlog', ({ req }) => { admin(req); return { entries: all('SELECT d.*,u.name AS author FROM dev_log d LEFT JOIN users u ON u.id=d.author_id ORDER BY d.created_at DESC LIMIT 200').map((d) => ({ id: d.id, kind: d.kind, title: d.title, body: d.body, version: d.version, author: d.author || 'النظام', createdAt: d.created_at })) }; });
  api.route('POST', '/admin/devlog', ({ req, body }) => {
    const actor = admin(req), kind = body.kind || 'note'; if (!['release', 'feature', 'fix', 'test', 'note'].includes(kind)) fail(400, 'نوع السجل غير صالح');
    const entryId = id('dev'); run('INSERT INTO dev_log VALUES(?,?,?,?,?,?,?)', entryId, kind, text(body.title, 'العنوان', 3, 200), body.body ? text(body.body, 'التفاصيل', 1, 5000) : '', body.version ? text(body.version, 'الإصدار', 1, 30) : '', actor.id, now());
    audit(actor, 'devlog.create', entryId);
    return [201, { entry: get('SELECT * FROM dev_log WHERE id=?', entryId) }];
  });
}
