// Catalog: categories, branches with per-branch stock, Arabic search with suggestions and history, barcode and
// image search, product questions, price/stock alerts, automatic summaries and substitutes.
import { normalize, matchScore, publicName } from './text.mjs';
import { decodePng, dominantColor, hexToRgb, rgbToHex, colorDistance, colorName } from './png.mjs';

export const name = 'catalog';

const DEFAULT_CATEGORIES = [
  ['fresh', 'خضار وفواكه', 'Fresh produce', 'apple', '#4CAF50'],
  ['dairy', 'ألبان وأجبان', 'Dairy', 'milk', '#F4B400'],
  ['bakery', 'مخبوزات', 'Bakery', 'croissant', '#C98B4E'],
  ['meat', 'لحوم ودواجن', 'Meat & poultry', 'drumstick', '#D84343'],
  ['pantry', 'مواد تموينية', 'Pantry', 'wheat', '#FF9800'],
  ['drinks', 'مشروبات', 'Drinks', 'cup-soda', '#29B6F6'],
  ['electronics', 'إلكترونيات', 'Electronics', 'headphones', '#7C5CFF'],
  ['home', 'المنزل', 'Home', 'sofa', '#FF7A59'],
  ['fashion', 'الأزياء', 'Fashion', 'shirt', '#EC6FA4'],
  ['care', 'العناية', 'Personal care', 'sparkles', '#26A69A'],
];
const SHAPES = ['box', 'cylinder', 'sphere', 'bottle', 'mug', 'headphones', 'lamp', 'bag'];
const httpsUrl = (value, field) => { if (typeof value !== 'string' || value.length > 1000 || !/^https:\/\/[^\s]+$/.test(value)) throw Object.assign(new Error(`رابط ${field} يجب أن يستخدم HTTPS`), { status: 400, code: 'invalid_request' }); return value; };

export function install(c, api) {
  const { db, get, all, run, transaction, fail, text, integer, number, id, now, json, parse, money, requireUser, optionalUser, admin, audit, notify, rate, options } = c;
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_en TEXT NOT NULL DEFAULT '',icon TEXT NOT NULL DEFAULT 'tag',color TEXT NOT NULL DEFAULT '#7C5CFF',sort INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS branches(id TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',latitude REAL,longitude REAL,phone TEXT NOT NULL DEFAULT '',hours TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS branch_stock(branch_id TEXT NOT NULL REFERENCES branches(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>=0),version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,PRIMARY KEY(branch_id,product_id));
    CREATE TABLE IF NOT EXISTS search_history(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),query TEXT NOT NULL,normalized TEXT NOT NULL,results INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_questions(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),user_id TEXT NOT NULL REFERENCES users(id),question TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_answers(id TEXT PRIMARY KEY,question_id TEXT NOT NULL REFERENCES product_questions(id),user_id TEXT NOT NULL REFERENCES users(id),answer TEXT NOT NULL,official INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_alerts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),type TEXT NOT NULL CHECK(type IN ('price','stock')),target_price REAL,created_at TEXT NOT NULL,triggered_at TEXT,UNIQUE(user_id,product_id,type));
  `);
  if (!get('SELECT id FROM categories LIMIT 1')) DEFAULT_CATEGORIES.forEach(([key, label, en, icon, color], i) => run('INSERT INTO categories VALUES(?,?,?,?,?,?,1)', key, label, en, icon, color, i));
  const demo = options.seedDemoProducts !== false && process.env.NODE_ENV !== 'production';
  if (demo && !get('SELECT id FROM branches LIMIT 1')) transaction(() => {
    run('INSERT INTO branches VALUES(?,?,?,?,?,?,?,?,1,?)', 'br_amman', 'فرع عبدون', 'عمّان', 'شارع عبدون، مجمع لُقطة', 31.9454, 35.8836, '+96265500100', '9:00–23:00', now());
    run('INSERT INTO branches VALUES(?,?,?,?,?,?,?,?,1,?)', 'br_irbid', 'فرع شارع الجامعة', 'إربد', 'شارع الجامعة، قرب الدوار الأول', 32.5415, 35.8510, '+96227200100', '9:00–22:00', now());
    for (const p of all('SELECT id,stock FROM products')) {
      run('INSERT INTO branch_stock VALUES(?,?,?,1,?)', 'br_amman', p.id, p.stock, now());
      run('INSERT INTO branch_stock VALUES(?,?,?,1,?)', 'br_irbid', p.id, Math.floor(p.stock / 2), now());
    }
  });

  // ---- product data extensions: gallery, video, specs, barcode, 3D model, freshness ----
  api.provide('validateProductExtras', (p) => {
    const out = {};
    if (p.images !== undefined) { if (!Array.isArray(p.images) || p.images.length > 10) fail(400, 'معرض الصور يقبل 10 صور كحد أقصى'); out.images = p.images.map((v) => httpsUrl(v, 'الصورة')); }
    if (p.video !== undefined) { if (p.video === '' || p.video === null) out.video = undefined; else out.video = httpsUrl(p.video, 'الفيديو'); }
    if (p.specs !== undefined) {
      if (!Array.isArray(p.specs) || p.specs.length > 30) fail(400, 'جدول المواصفات غير صالح');
      out.specs = p.specs.map((s) => ({ label: text(s?.label, 'اسم المواصفة', 1, 60), value: text(s?.value, 'قيمة المواصفة', 1, 200) }));
    }
    if (p.barcode !== undefined && p.barcode !== '') { if (typeof p.barcode !== 'string' || !/^[0-9A-Za-z-]{4,32}$/.test(p.barcode)) fail(400, 'الباركود غير صالح'); out.barcode = p.barcode; }
    if (p.model3d !== undefined && p.model3d !== null) {
      const m = p.model3d; if (!m || typeof m !== 'object' || !SHAPES.includes(m.shape)) fail(400, 'شكل النموذج ثلاثي الأبعاد غير مدعوم');
      if (m.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(m.color)) fail(400, 'لون النموذج يجب أن يكون HEX');
      out.model3d = { shape: m.shape, color: m.color || '#7C5CFF', scale: m.scale === undefined ? 1 : number(m.scale, 'حجم النموذج', 0.3, 3) };
    }
    if (p.expiryDays !== undefined && p.expiryDays !== null) out.expiryDays = integer(p.expiryDays, 'مدة الصلاحية', 1, 3650);
    if (p.carbonKg !== undefined && p.carbonKg !== null) out.carbonKg = number(p.carbonKg, 'الأثر الكربوني', 0, 100);
    if (p.unit !== undefined && p.unit !== '') out.unit = text(p.unit, 'الوحدة', 1, 30);
    if (p.nameEn !== undefined && p.nameEn !== '') out.nameEn = text(p.nameEn, 'الاسم بالإنجليزية', 1, 200);
    if (Array.isArray(p.colors) && p.colors.some((v) => /^#/.test(v) && !/^#[0-9a-fA-F]{6}$/.test(v))) fail(400, 'ألوان المنتج يجب أن تكون HEX');
    return out;
  });

  // ---- categories ----
  const categoryItem = (r) => ({ id: r.id, name: r.name, nameEn: r.name_en, icon: r.icon, color: r.color, sort: r.sort, active: !!r.active, productCount: get("SELECT COUNT(*) AS n FROM products WHERE active=1 AND json_extract(data,'$.category')=? AND json_extract(data,'$.variantOf') IS NULL", r.id).n });
  const categoryLabels = () => Object.fromEntries(all('SELECT id,name,name_en FROM categories').map((r) => [r.id, `${r.name} ${r.name_en}`]));
  api.route('GET', '/categories', () => ({ categories: all('SELECT * FROM categories WHERE active=1 ORDER BY sort,name').map(categoryItem) }));
  api.route('GET', '/admin/categories', ({ req }) => { admin(req, 'catalog:write'); return { categories: all('SELECT * FROM categories ORDER BY sort,name').map(categoryItem) }; });
  const saveCategory = (body, old = {}) => {
    const icon = body.icon !== undefined ? text(body.icon, 'الأيقونة', 1, 40) : old.icon || 'tag';
    const color = body.color !== undefined ? body.color : old.color || '#7C5CFF';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(400, 'لون القسم يجب أن يكون HEX');
    return { name: body.name !== undefined ? text(body.name, 'اسم القسم', 2, 60) : old.name, nameEn: body.nameEn !== undefined ? String(body.nameEn).slice(0, 60) : old.name_en || '', icon, color, sort: body.sort !== undefined ? integer(body.sort, 'الترتيب', 0, 1000) : old.sort ?? 0, active: body.active !== undefined ? (body.active ? 1 : 0) : old.active ?? 1 };
  };
  api.route('POST', '/admin/categories', ({ req, body }) => {
    const actor = admin(req, 'catalog:write'), key = text(body.id, 'معرّف القسم', 2, 40);
    if (!/^[a-z0-9-]+$/.test(key)) fail(400, 'معرّف القسم يقبل أحرفًا إنجليزية صغيرة وأرقامًا');
    if (get('SELECT id FROM categories WHERE id=?', key)) fail(409, 'القسم موجود');
    const v = saveCategory(body); if (!v.name) fail(400, 'اسم القسم مطلوب');
    run('INSERT INTO categories VALUES(?,?,?,?,?,?,?)', key, v.name, v.nameEn, v.icon, v.color, v.sort, v.active);
    audit(actor, 'category.create', key);
    return [201, { category: categoryItem(get('SELECT * FROM categories WHERE id=?', key)) }];
  });
  api.route('PATCH', '/admin/categories/:categoryId', ({ req, body, params }) => {
    const actor = admin(req, 'catalog:write'), old = get('SELECT * FROM categories WHERE id=?', params.categoryId); if (!old) fail(404, 'القسم غير موجود', 'not_found');
    const v = saveCategory(body, old);
    run('UPDATE categories SET name=?,name_en=?,icon=?,color=?,sort=?,active=? WHERE id=?', v.name, v.nameEn, v.icon, v.color, v.sort, v.active, old.id);
    audit(actor, 'category.update', old.id);
    return { category: categoryItem(get('SELECT * FROM categories WHERE id=?', old.id)) };
  });
  api.route('DELETE', '/admin/categories/:categoryId', ({ req, params }) => {
    const actor = admin(req, 'catalog:write'), old = get('SELECT * FROM categories WHERE id=?', params.categoryId); if (!old) fail(404, 'القسم غير موجود', 'not_found');
    if (categoryItem(old).productCount) fail(409, 'انقل منتجات القسم أو أرشفها قبل حذفه', 'category_in_use');
    run('DELETE FROM categories WHERE id=?', old.id); audit(actor, 'category.delete', old.id);
    return { ok: true };
  });

  // ---- branches and per-branch stock ----
  const branchItem = (b) => ({ id: b.id, name: b.name, city: b.city, address: b.address, latitude: b.latitude, longitude: b.longitude, phone: b.phone, hours: b.hours, active: !!b.active, createdAt: b.created_at });
  const activeBranch = (branchId) => { const b = get('SELECT * FROM branches WHERE id=? AND active=1', branchId); if (!b) fail(400, 'الفرع غير متاح', 'branch_unavailable'); return b; };
  api.provide('checkBranchStock', (branchId, productId, quantity) => {
    const b = activeBranch(branchId), row = get('SELECT quantity FROM branch_stock WHERE branch_id=? AND product_id=?', b.id, productId);
    if (!row || row.quantity < quantity) fail(409, `الكمية غير متاحة في ${b.name}`, 'out_of_stock_branch');
  });
  api.provide('moveBranchStock', (branchId, lines, direction) => {
    for (const line of lines) run('UPDATE branch_stock SET quantity=MAX(0,quantity+?),version=version+1,updated_at=? WHERE branch_id=? AND product_id=?', direction * line.quantity, now(), branchId, line.productId);
  });
  api.route('GET', '/branches', () => ({ branches: all('SELECT * FROM branches WHERE active=1 ORDER BY name').map(branchItem) }));
  api.route('GET', '/branches/:branchId/stock', ({ params }) => {
    const b = activeBranch(params.branchId);
    return { branch: branchItem(b), stock: all('SELECT product_id AS productId,quantity,version,updated_at AS updatedAt FROM branch_stock WHERE branch_id=?', b.id) };
  });
  api.route('GET', '/admin/branches', ({ req }) => { admin(req, 'inventory:write'); return { branches: all('SELECT * FROM branches ORDER BY created_at').map((b) => ({ ...branchItem(b), skus: get('SELECT COUNT(*) AS n FROM branch_stock WHERE branch_id=?', b.id).n, units: get('SELECT COALESCE(SUM(quantity),0) AS n FROM branch_stock WHERE branch_id=?', b.id).n })) }; });
  const branchInput = (body, old = {}) => {
    const v = { name: body.name !== undefined ? text(body.name, 'اسم الفرع', 2, 100) : old.name, city: body.city !== undefined ? text(body.city, 'المدينة', 2, 80) : old.city, address: body.address !== undefined ? String(body.address).slice(0, 300) : old.address || '', phone: body.phone !== undefined ? String(body.phone).slice(0, 30) : old.phone || '', hours: body.hours !== undefined ? String(body.hours).slice(0, 60) : old.hours || '', latitude: old.latitude ?? null, longitude: old.longitude ?? null, active: body.active !== undefined ? (body.active ? 1 : 0) : old.active ?? 1 };
    if (body.latitude !== undefined || body.longitude !== undefined) { v.latitude = body.latitude === null ? null : number(body.latitude, 'خط العرض', -90, 90); v.longitude = body.longitude === null ? null : number(body.longitude, 'خط الطول', -180, 180); }
    if (!v.name || !v.city) fail(400, 'اسم الفرع والمدينة مطلوبان');
    return v;
  };
  api.route('POST', '/admin/branches', ({ req, body }) => {
    const actor = admin(req, 'inventory:write'), v = branchInput(body), branchId = id('br');
    run('INSERT INTO branches VALUES(?,?,?,?,?,?,?,?,?,?)', branchId, v.name, v.city, v.address, v.latitude, v.longitude, v.phone, v.hours, v.active, now());
    audit(actor, 'branch.create', branchId);
    return [201, { branch: branchItem(get('SELECT * FROM branches WHERE id=?', branchId)) }];
  });
  api.route('PATCH', '/admin/branches/:branchId', ({ req, body, params }) => {
    const actor = admin(req, 'inventory:write'), old = get('SELECT * FROM branches WHERE id=?', params.branchId); if (!old) fail(404, 'الفرع غير موجود', 'not_found');
    const v = branchInput(body, old);
    run('UPDATE branches SET name=?,city=?,address=?,latitude=?,longitude=?,phone=?,hours=?,active=? WHERE id=?', v.name, v.city, v.address, v.latitude, v.longitude, v.phone, v.hours, v.active, old.id);
    audit(actor, 'branch.update', old.id);
    return { branch: branchItem(get('SELECT * FROM branches WHERE id=?', old.id)) };
  });
  api.route('GET', '/admin/branch-stock', ({ req, query }) => {
    admin(req, 'inventory:write');
    const branchId = query.get('branch');
    const rows = all(`SELECT s.*,b.name AS branch_name,p.data FROM branch_stock s JOIN branches b ON b.id=s.branch_id JOIN products p ON p.id=s.product_id ${branchId ? 'WHERE s.branch_id=?' : ''} ORDER BY b.name,p.id LIMIT 5000`, ...(branchId ? [branchId] : []));
    return { stock: rows.map((r) => { const d = parse(r.data, {}); return { branchId: r.branch_id, branch: r.branch_name, productId: r.product_id, name: d.name, sku: d.sku || r.product_id, quantity: r.quantity, version: r.version, updatedAt: r.updated_at }; }) };
  });
  api.route('PUT', '/admin/branches/:branchId/stock', ({ req, body, params }) => {
    const actor = admin(req, 'inventory:write'), b = get('SELECT * FROM branches WHERE id=?', params.branchId); if (!b) fail(404, 'الفرع غير موجود', 'not_found');
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 2000) fail(400, 'قائمة كميات الفرع غير صالحة');
    const result = transaction(() => {
      const conflicts = [], saved = [];
      for (const item of body.items) {
        const productId = text(item.productId, 'معرّف المنتج', 1, 100), quantity = integer(item.quantity, 'الكمية', 0, 1e7);
        if (!get('SELECT id FROM products WHERE id=?', productId)) fail(404, `المنتج ${productId} غير موجود`, 'not_found');
        const current = get('SELECT * FROM branch_stock WHERE branch_id=? AND product_id=?', b.id, productId);
        if (item.expectedVersion !== undefined && (current?.version ?? 0) !== item.expectedVersion) { conflicts.push({ productId, expectedVersion: item.expectedVersion, currentVersion: current?.version ?? 0, quantity: current?.quantity ?? 0 }); continue; }
        run('INSERT INTO branch_stock VALUES(?,?,?,1,?) ON CONFLICT(branch_id,product_id) DO UPDATE SET quantity=excluded.quantity,version=branch_stock.version+1,updated_at=excluded.updated_at', b.id, productId, quantity, now());
        saved.push(get('SELECT product_id AS productId,quantity,version FROM branch_stock WHERE branch_id=? AND product_id=?', b.id, productId));
      }
      if (conflicts.length) { const error = new Error('تغيّرت كميات بعض الأصناف منذ آخر قراءة؛ حدّث الجدول وأعد المحاولة'); error.status = 409; error.code = 'version_conflict'; error.details = { conflicts }; throw error; }
      audit(actor, 'branch.stock', b.id, { count: saved.length });
      return saved;
    });
    return { branchId: b.id, saved: result };
  });

  // ---- search, suggestions and history ----
  const sales = () => { const counts = new Map(); for (const o of all("SELECT items FROM orders WHERE status<>'cancelled'")) for (const line of parse(o.items, [])) counts.set(line.productId, (counts.get(line.productId) || 0) + line.quantity); return counts; };
  const searchable = () => all("SELECT * FROM products WHERE active=1 AND json_extract(data,'$.variantOf') IS NULL").map(c.product);
  const productText = (p, labels) => [p.description, (p.tags || []).join(' '), (p.features || []).join(' '), labels[p.category] || p.category, p.brand, p.barcode || '', p.sku || '', p.subtitle || ''].join(' ');
  const rank = (q, products) => { const labels = categoryLabels(); return products.map((p) => ({ p, score: matchScore(q, `${p.name} ${p.nameEn || ''}`, productText(p, labels)) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score); };
  api.provide('searchProducts', (q, limit = 10) => rank(q, searchable()).slice(0, limit).map((x) => x.p));
  api.provide('rankProducts', rank);
  api.provide('salesCounts', sales);
  const remember = (actor, q, results) => {
    const prefs = api.use('preferences')(actor.id);
    if (!prefs.privacy.saveSearchHistory) return;
    const key = normalize(q); if (!key) return;
    run('DELETE FROM search_history WHERE user_id=? AND normalized=?', actor.id, key);
    run('INSERT INTO search_history VALUES(?,?,?,?,?,?)', id('srch'), actor.id, q.slice(0, 120), key, results, now());
    run('DELETE FROM search_history WHERE user_id=? AND id NOT IN (SELECT id FROM search_history WHERE user_id=? ORDER BY created_at DESC LIMIT 30)', actor.id, actor.id);
  };
  api.route('GET', '/search', ({ req, query }) => {
    const q = (query.get('q') || '').slice(0, 120).trim(), category = query.get('category'), branchId = query.get('branch'), sort = query.get('sort') || (q ? 'relevance' : 'featured');
    let rows = q ? rank(q, searchable()).map((x) => ({ ...x.p, score: Math.round(x.score * 100) / 100 })) : searchable();
    if (category) rows = rows.filter((p) => p.category === category);
    if (query.has('minPrice')) rows = rows.filter((p) => p.price >= Number(query.get('minPrice')));
    if (query.has('maxPrice')) rows = rows.filter((p) => p.price <= Number(query.get('maxPrice')));
    if (query.has('minRating')) rows = rows.filter((p) => p.rating >= Number(query.get('minRating')));
    if (branchId) {
      const branch = activeBranch(branchId), stock = new Map(all('SELECT product_id,quantity FROM branch_stock WHERE branch_id=?', branch.id).map((r) => [r.product_id, r.quantity]));
      rows = rows.map((p) => ({ ...p, branchStock: stock.get(p.id) ?? 0 }));
      if (query.get('inStock') === '1') rows = rows.filter((p) => p.branchStock > 0);
    } else if (query.get('inStock') === '1') rows = rows.filter((p) => p.stock > 0);
    if (query.get('onSale') === '1') rows = rows.filter((p) => p.oldPrice && p.oldPrice > p.price);
    const popular = sort === 'popular' ? sales() : null;
    if (sort === 'price-asc') rows.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') rows.sort((a, b) => b.price - a.price);
    else if (sort === 'rating') rows.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
    else if (sort === 'newest') rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    else if (sort === 'popular') rows.sort((a, b) => (popular.get(b.id) || 0) - (popular.get(a.id) || 0));
    const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 60));
    const actor = optionalUser(req);
    if (actor && q) remember(actor, q, rows.length);
    let didYouMean = null;
    if (q && !rows.length) {
      const names = searchable().map((p) => p.name);
      didYouMean = names.map((n) => ({ n, s: matchScore(n, q) + matchScore(q.slice(0, -1), n) })).sort((a, b) => b.s - a.s).find((x) => x.s > 0)?.n || null;
    }
    return { query: q, sort, total: rows.length, results: rows.slice(0, limit), didYouMean };
  });
  api.route('GET', '/search/suggest', ({ req, query }) => {
    const q = normalize((query.get('q') || '').slice(0, 80));
    const trending = all('SELECT query,normalized,COUNT(*) AS n FROM search_history WHERE created_at>? GROUP BY normalized ORDER BY n DESC LIMIT 20', new Date(Date.now() - 30 * 86400_000).toISOString());
    const actor = optionalUser(req);
    if (!q) return { suggestions: [], trending: trending.slice(0, 6).map((t) => t.query), recent: actor ? all('SELECT query FROM search_history WHERE user_id=? ORDER BY created_at DESC LIMIT 8', actor.id).map((r) => r.query) : [] };
    let matches = searchable().filter((p) => normalize(`${p.name} ${p.nameEn || ''}`).split(' ').some((w) => w.startsWith(q) || w.startsWith(q.replace(/^ال/, ''))) || normalize(p.name).includes(q));
    // Nothing starts with what was typed (a typo such as «حلييب»): fall back to the typo-tolerant search ranking.
    if (!matches.length && q.length >= 3) matches = rank(q, searchable()).map((x) => x.p);
    const products = matches.slice(0, 5).map((p) => ({ type: 'product', id: p.id, label: p.name, price: p.price }));
    const categories = all('SELECT * FROM categories WHERE active=1').filter((r) => normalize(`${r.name} ${r.name_en}`).includes(q)).slice(0, 2).map((r) => ({ type: 'category', id: r.id, label: r.name }));
    const queries = trending.filter((t) => t.normalized.startsWith(q) && t.normalized !== q).slice(0, 3).map((t) => ({ type: 'query', label: t.query }));
    return { suggestions: [...products, ...categories, ...queries].slice(0, 8) };
  });
  api.route('GET', '/me/search-history', ({ req }) => ({ history: all('SELECT query,results,created_at AS createdAt FROM search_history WHERE user_id=? ORDER BY created_at DESC LIMIT 20', requireUser(req).id) }));
  api.route('DELETE', '/me/search-history', ({ req }) => { run('DELETE FROM search_history WHERE user_id=?', requireUser(req).id); return { ok: true }; });
  api.route('GET', '/products/barcode/:code', ({ params }) => {
    const code = params.code.trim(); if (!/^[0-9A-Za-z-]{4,32}$/.test(code)) fail(400, 'الباركود غير صالح');
    const row = get("SELECT * FROM products WHERE active=1 AND (json_extract(data,'$.barcode')=? OR json_extract(data,'$.sku')=? OR id=?) LIMIT 1", code, code, code);
    if (!row) fail(404, 'لم نجد منتجًا بهذا الباركود', 'not_found');
    return { product: c.product(row) };
  });
  api.route('POST', '/search/image', ({ req, body }) => {
    rate(req, 'image-search', 40);
    const source = typeof body.image === 'string' ? body.image.replace(/^data:image\/png;base64,/, '') : '';
    if (!source || source.length > 2_000_000 || !/^[A-Za-z0-9+/=\s]+$/.test(source)) fail(400, 'أرسل صورة PNG مصغّرة بترميز base64');
    let rgb;
    try { rgb = dominantColor(decodePng(Buffer.from(source, 'base64'), 250_000)); } catch (error) { fail(422, error.message || 'تعذرت قراءة الصورة', 'invalid_image'); }
    if (!rgb) fail(422, 'لم نتمكن من تمييز لون واضح في الصورة', 'invalid_image');
    const matches = searchable().map((p) => {
      const colors = [...(p.colors || []), p.model3d?.color].map(hexToRgb).filter(Boolean);
      return { p, distance: colors.length ? Math.min(...colors.map((value) => colorDistance(rgb, value))) : Infinity };
    }).filter((m) => Number.isFinite(m.distance)).sort((a, b) => a.distance - b.distance).slice(0, 8);
    return { color: rgbToHex(rgb), colorName: colorName(rgb), results: matches.map((m) => ({ ...m.p, match: Math.max(0, Math.round(100 - m.distance)) })) };
  });

  // ---- questions and answers ----
  const questionItem = (q) => ({ id: q.id, productId: q.product_id, question: q.question, askedBy: publicName(get('SELECT name FROM users WHERE id=?', q.user_id)?.name), createdAt: q.created_at,
    answers: all('SELECT a.id,a.answer,a.official,a.created_at AS createdAt,u.name FROM product_answers a JOIN users u ON u.id=a.user_id WHERE a.question_id=? ORDER BY a.official DESC,a.created_at', q.id).map((a) => ({ id: a.id, answer: a.answer, official: !!a.official, by: a.official ? 'فريق لُقطة' : publicName(a.name), createdAt: a.createdAt })) });
  const activeProduct = (productId) => { const row = get('SELECT * FROM products WHERE id=? AND active=1', productId); if (!row) fail(404, 'المنتج غير موجود', 'not_found'); return row; };
  api.route('GET', '/products/:productId/questions', ({ params }) => { activeProduct(params.productId); return { questions: all('SELECT * FROM product_questions WHERE product_id=? ORDER BY created_at DESC LIMIT 100', params.productId).map(questionItem) }; });
  api.route('POST', '/products/:productId/questions', ({ req, body, params }) => {
    const actor = requireUser(req); rate(req, 'questions', 20); activeProduct(params.productId);
    const questionId = id('qst'); run('INSERT INTO product_questions VALUES(?,?,?,?,?)', questionId, params.productId, actor.id, text(body.question, 'السؤال', 5, 500), now());
    return [201, { question: questionItem(get('SELECT * FROM product_questions WHERE id=?', questionId)) }];
  });
  api.route('POST', '/questions/:questionId/answers', ({ req, body, params }) => {
    const actor = requireUser(req); rate(req, 'answers', 30);
    const q = get('SELECT * FROM product_questions WHERE id=?', params.questionId); if (!q) fail(404, 'السؤال غير موجود', 'not_found');
    const vendorId = parse(get('SELECT data FROM products WHERE id=?', q.product_id)?.data, {}).vendorId;
    const official = actor.role === 'admin' || !!(vendorId && get('SELECT 1 FROM vendor_members WHERE vendor_id=? AND user_id=?', vendorId, actor.id));
    run('INSERT INTO product_answers VALUES(?,?,?,?,?,?)', id('ans'), q.id, actor.id, text(body.answer, 'الإجابة', 2, 1000), official ? 1 : 0, now());
    if (q.user_id !== actor.id) notify(q.user_id, 'وصلت إجابة على سؤالك', `أُجيب عن سؤالك: ${q.question.slice(0, 60)}`);
    return [201, { question: questionItem(q) }];
  });
  api.route('GET', '/admin/questions', ({ req }) => {
    admin(req, 'catalog:write');
    return { questions: all('SELECT q.* FROM product_questions q WHERE NOT EXISTS (SELECT 1 FROM product_answers a WHERE a.question_id=q.id AND a.official=1) ORDER BY q.created_at DESC LIMIT 200').map((q) => ({ ...questionItem(q), productName: parse(get('SELECT data FROM products WHERE id=?', q.product_id)?.data, {}).name })) };
  });

  // ---- price drop / back in stock alerts ----
  const alertItem = (a) => { const row = get('SELECT * FROM products WHERE id=?', a.product_id); const p = row ? c.product(row) : null; return { id: a.id, productId: a.product_id, name: p?.name || '', type: a.type, targetPrice: a.target_price, currentPrice: p?.price ?? null, stock: p?.stock ?? 0, createdAt: a.created_at, triggeredAt: a.triggered_at }; };
  api.route('GET', '/me/alerts', ({ req }) => ({ alerts: all('SELECT * FROM product_alerts WHERE user_id=? ORDER BY created_at DESC', requireUser(req).id).map(alertItem) }));
  api.route('POST', '/products/:productId/alerts', ({ req, body, params }) => {
    const actor = requireUser(req), row = activeProduct(params.productId), p = c.product(row);
    if (!['price', 'stock'].includes(body.type)) fail(400, 'نوع التنبيه غير صالح');
    if (body.type === 'stock' && p.stock > 0) fail(409, 'المنتج متوفر الآن؛ أضفه إلى السلة مباشرة', 'in_stock');
    const target = body.type === 'price' ? money(number(body.targetPrice ?? p.price * 0.9, 'السعر المستهدف', 0.001, 1e7)) : null;
    if (target !== null && target >= p.price) fail(400, 'اختر سعرًا أقل من السعر الحالي');
    if (get('SELECT COUNT(*) AS n FROM product_alerts WHERE user_id=? AND triggered_at IS NULL', actor.id).n >= 50) fail(409, 'الحد الأقصى 50 تنبيهًا فعالًا');
    run('INSERT INTO product_alerts VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(user_id,product_id,type) DO UPDATE SET target_price=excluded.target_price,created_at=excluded.created_at,triggered_at=NULL', id('alr'), actor.id, row.id, body.type, target, now());
    return [201, { alert: alertItem(get('SELECT * FROM product_alerts WHERE user_id=? AND product_id=? AND type=?', actor.id, row.id, body.type)) }];
  });
  api.route('DELETE', '/me/alerts/:alertId', ({ req, params }) => { if (!run('DELETE FROM product_alerts WHERE id=? AND user_id=?', params.alertId, requireUser(req).id).changes) fail(404, 'التنبيه غير موجود', 'not_found'); return { ok: true }; });
  api.on('productsChanged', (ids) => {
    for (const productId of new Set(ids)) {
      const row = get('SELECT * FROM products WHERE id=? AND active=1', productId); if (!row) continue;
      const p = c.product(row);
      for (const a of all('SELECT * FROM product_alerts WHERE product_id=? AND triggered_at IS NULL', productId)) {
        const hit = a.type === 'price' ? p.price <= a.target_price : p.stock > 0;
        if (!hit) continue;
        run('UPDATE product_alerts SET triggered_at=? WHERE id=?', now(), a.id);
        if (api.use('preferences')(a.user_id).notifications.priceAlerts) notify(a.user_id, a.type === 'price' ? 'انخفض السعر!' : 'عاد المنتج إلى المخزون', a.type === 'price' ? `${p.name} أصبح بـ ${p.price} بدل السعر الذي تابعته` : `${p.name} متوفر الآن، اطلبه قبل نفاده`);
      }
    }
  });

  // ---- automatic summary and substitutes ----
  api.route('GET', '/products/:productId/summary', ({ params }) => {
    const p = c.product(activeProduct(params.productId));
    const firstSentence = String(p.description || '').split(/[.!؟\n]/).map((s) => s.trim()).find(Boolean) || p.subtitle || p.name;
    const reviews = all('SELECT rating,body FROM reviews WHERE product_id=?', p.id);
    const highlights = [...(p.features || []).slice(0, 3), ...(p.specs || []).slice(0, 2).map((s) => `${s.label}: ${s.value}`)];
    const verdict = !reviews.length ? 'لا توجد تقييمات بعد؛ كن أول من يجرّبه.' : p.rating >= 4.5 ? `محبوب جدًا: ${p.rating} من 5 من ${reviews.length} تقييم موثق.` : p.rating >= 3.5 ? `رأي المشترين إيجابي غالبًا (${p.rating} من 5).` : `آراء متباينة (${p.rating} من 5)؛ اطّلع على التقييمات قبل الشراء.`;
    const value = p.oldPrice && p.oldPrice > p.price ? `وفّر ${money(p.oldPrice - p.price)} الآن.` : '';
    const stock = p.stock === 0 ? 'غير متوفر حاليًا — جرّب البدائل المقترحة.' : p.stock <= 5 ? `تبقّى ${p.stock} فقط.` : 'متوفر للتوصيل.';
    return { productId: p.id, generated: true, summary: [firstSentence, verdict, value, stock].filter(Boolean).join(' '), highlights };
  });
  api.route('GET', '/products/:productId/substitutes', ({ params }) => {
    const p = c.product(activeProduct(params.productId));
    const tags = new Set((p.tags || []).map(normalize));
    const candidates = searchable().filter((x) => x.id !== p.id && x.stock > 0 && x.category === p.category).map((x) => {
      const overlap = (x.tags || []).filter((t) => tags.has(normalize(t))).length;
      const priceGap = Math.abs(x.price - p.price) / Math.max(p.price, 1);
      return { x, score: overlap * 2 + (1 - Math.min(1, priceGap)) * 3 + x.rating / 5 };
    }).sort((a, b) => b.score - a.score).slice(0, 4);
    return { productId: p.id, outOfStock: p.stock === 0, substitutes: candidates.map(({ x }) => ({ ...x, priceDifference: money(x.price - p.price) })) };
  });

  api.on('deleteUser', (userId) => {
    run('DELETE FROM search_history WHERE user_id=?', userId);
    run('DELETE FROM product_alerts WHERE user_id=?', userId);
    run('DELETE FROM product_answers WHERE user_id=?', userId);
    run('DELETE FROM product_answers WHERE question_id IN (SELECT id FROM product_questions WHERE user_id=?)', userId);
    run('DELETE FROM product_questions WHERE user_id=?', userId);
  });
  api.use('registerExport')('searchHistory', (userId) => all('SELECT query,created_at AS createdAt FROM search_history WHERE user_id=?', userId));
  api.use('registerExport')('alerts', (userId) => all('SELECT product_id AS productId,type,target_price AS targetPrice,created_at AS createdAt FROM product_alerts WHERE user_id=?', userId));
  api.use('registerExport')('questions', (userId) => all('SELECT product_id AS productId,question,created_at AS createdAt FROM product_questions WHERE user_id=?', userId));
}
