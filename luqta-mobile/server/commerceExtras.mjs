// G16 — delivery-app parity features from the requirements / gap backlog, implemented
// independently (clean room, no third-party code or assets): search suggestions &
// popular searches, vendor discovery, curated collections, stamp-card loyalty with
// personal vouchers, quick commerce (express) + click-and-collect, delivery
// instructions / contactless / courier tip, order feedback, feature-flag governance
// and privacy-preserving aggregated analytics.

const DAY = 86400_000;
export const EVENT_NAMES = ['view_product', 'add_to_cart', 'begin_checkout', 'search', 'open_tool', 'share'];
export const FLAG_DEFAULTS = { reels: true, game: true, merchant: true, ai: true, express: true, pickup: true, studio: true, stampCard: true, lists: true, analytics: true };
export const FLAG_LABELS = { reels: 'فيديوهات وقصص التسوق', game: 'العب واربح', merchant: 'بوابة التاجر', ai: 'ميزات الذكاء الاصطناعي', express: 'التوصيل السريع', pickup: 'الاستلام من الفرع', studio: 'الاستوديو الإبداعي', stampCard: 'بطاقة الأختام', lists: 'القوائم العائلية', analytics: 'التحليلات المجمّعة' };
export const TIP_CHOICES = [0, 0.5, 1, 2];

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const normalizeQuery = (q) => String(q || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

export function installCommerceExtras(ctx) {
  const { db, get, all, run, transaction, id, now, money, fail, text, number, integer, json, parse, requireUser, admin, identity, notify, product, setting, rate, audit, flagOn, orderExtras, saveOrderExtras } = ctx;
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_queries(query TEXT PRIMARY KEY,count INTEGER NOT NULL,last_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stamp_cards(user_id TEXT PRIMARY KEY REFERENCES users(id),stamps INTEGER NOT NULL,completed INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stamp_awards(order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_feedback(order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),tags TEXT NOT NULL,comment TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analytics_daily(day TEXT NOT NULL,name TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,name));
  `);
  try { db.exec('ALTER TABLE coupons ADD COLUMN user_id TEXT'); } catch { /* exists */ }
  const day = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const stampCfg = () => ({ enabled: true, stamps: 5, rewardType: 'percent', rewardValue: 10, minSubtotal: 0, validDays: 30, ...(setting('stampCard', {}) || {}) });
  /** WP-06 service zones: distance tiers from the nearest located branch → standard fee; beyond the last tier = outside service area. */
  const zonesCfg = () => (setting('deliveryZones', []) || []).slice().sort((a, b) => a.maxKm - b.maxKm);
  function zoneFor(latitude, longitude) {
    const zones = zonesCfg(); if (!zones.length) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { needsLocation: true };
    const located = branchesList().filter((b) => Number.isFinite(b.latitude) && Number.isFinite(b.longitude)); if (!located.length) return null;
    const near = located.map((b) => ({ b, km: haversineKm({ latitude, longitude }, b) })).sort((a, b) => a.km - b.km)[0];
    const zone = zones.find((z) => near.km <= z.maxKm);
    return zone ? { inService: true, zone: zone.name, fee: money(zone.fee), distanceKm: Math.round(near.km * 10) / 10, branchId: near.b.id } : { inService: false, distanceKm: Math.round(near.km * 10) / 10, maxKm: zones.at(-1).maxKm };
  }
  const expressCfg = () => ({ fee: 2, maxKm: 6, baseMinutes: 25, perKmMinutes: 4, ...(setting('express', {}) || {}) });
  const flags = () => ({ ...FLAG_DEFAULTS, ...(setting('flags', {}) || {}) });
  const requireFlag = (k) => { if (!flagOn(k)) fail(403, 'هذه الميزة متوقفة مؤقتًا من إدارة المتجر', 'feature_disabled'); };
  const branchesList = () => setting('branches', []) || [];
  const lineInfo = (items) => (Array.isArray(items) ? items : []).slice(0, 100).map((l) => {
    const r = get('SELECT * FROM products WHERE id=? AND active=1', String(l.productId || '')); if (!r) return null;
    const d = parse(r.data, {}); return { productId: r.id, name: d.name, quantity: Math.max(1, Math.min(1000, Number(l.quantity) || 1)), stock: r.stock, branchStock: d.branchStock || null };
  }).filter(Boolean);
  const branchHas = (b, lines) => lines.every((l) => (l.branchStock ? (l.branchStock[b.id] ?? 0) : l.stock) >= l.quantity);

  /** Delivery options for a cart and a destination. Fees/ETAs are computed on the server. */
  function deliveryOptions({ items, latitude, longitude }) {
    const lines = lineInfo(items), standardFee = setting('shippingFee'), threshold = setting('freeShippingThreshold');
    const subtotal = money(lines.reduce((a, l) => a + (parse(get('SELECT data FROM products WHERE id=?', l.productId).data, {}).price || 0) * l.quantity, 0));
    const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude);
    const located = branchesList().filter((b) => Number.isFinite(b.latitude) && Number.isFinite(b.longitude));
    const cfg = expressCfg();
    let express = { available: false, reason: !flagOn('express') ? 'التوصيل السريع متوقف حاليًا' : !hasPoint ? 'حدد موقع التوصيل على الخريطة لمعرفة التوصيل السريع' : !located.length ? 'لم تُحدَّد مواقع الفروع بعد' : '' };
    if (flagOn('express') && hasPoint && located.length) {
      const near = located.map((b) => ({ b, km: haversineKm({ latitude, longitude }, b) })).filter((x) => branchHas(x.b, lines)).sort((a, b) => a.km - b.km)[0];
      if (!near) express = { available: false, reason: 'لا يوجد فرع قريب يتوفر فيه كل أصناف السلة' };
      else if (near.km > cfg.maxKm) express = { available: false, reason: `أقرب فرع يبعد ${near.km.toFixed(1)} كم (الحد ${cfg.maxKm} كم)`, distanceKm: Math.round(near.km * 10) / 10 };
      else express = { available: true, fee: money(cfg.fee), etaMinutes: Math.round(cfg.baseMinutes + cfg.perKmMinutes * near.km), branch: { id: near.b.id, name: near.b.name }, distanceKm: Math.round(near.km * 10) / 10 };
    }
    const pickup = flagOn('pickup') ? branchesList().map((b) => ({ branchId: b.id, name: b.name, city: b.city || '', available: branchHas(b, lines), readyInMinutes: 30, ...(hasPoint && Number.isFinite(b.latitude) ? { distanceKm: Math.round(haversineKm({ latitude, longitude }, b) * 10) / 10 } : {}) })) : [];
    const zone = zoneFor(latitude, longitude);
    const zoneFee = zone && zone.inService ? zone.fee : standardFee;
    return { subtotal, standard: { fee: subtotal >= threshold ? 0 : zoneFee, eta: 'خلال الفترة المختارة', ...(zone ? { zone } : {}), ...(zone && zone.inService === false ? { available: false, reason: `العنوان خارج منطقة التوصيل (${zone.distanceKm} كم، الحد ${zone.maxKm} كم)` } : {}) }, express, pickup, tips: TIP_CHOICES };
  }

  /** Called inside order creation: returns shipping, tip and extras to persist. */
  function checkout(body, lines, subtotal, baseShipping, address) {
    const mode = ['standard', 'express', 'pickup'].includes(body.deliveryMode) ? body.deliveryMode : 'standard';
    const tip = body.tip == null ? 0 : money(number(body.tip, 'إكرامية السائق', 0, 50));
    if (tip && !TIP_CHOICES.includes(tip) && tip > 10) fail(400, 'قيمة الإكرامية غير صالحة');
    const instructions = body.instructions ? text(body.instructions, 'تعليمات التوصيل', 1, 300) : null;
    const extras = { mode, tip: mode === 'pickup' ? 0 : tip, instructions, contactless: body.contactless === true && mode !== 'pickup' };
    let shipping = baseShipping;
    if (mode !== 'pickup') {
      const zone = zoneFor(address.latitude, address.longitude);
      if (zone && zone.inService === false) fail(409, `العنوان خارج منطقة التوصيل (${zone.distanceKm} كم)`, 'outside_service_area');
      if (zone && zone.inService && baseShipping > 0) { shipping = zone.fee; Object.assign(extras, { zone: zone.zone, distanceKm: zone.distanceKm }); }
    }
    if (mode === 'express') {
      const opt = deliveryOptions({ items: lines, latitude: address.latitude, longitude: address.longitude }).express;
      if (!opt.available) fail(409, opt.reason || 'التوصيل السريع غير متاح لهذا العنوان', 'express_unavailable');
      shipping = money(shipping + opt.fee); Object.assign(extras, { etaMinutes: opt.etaMinutes, branchId: opt.branch.id });
    } else if (mode === 'pickup') {
      requireFlag('pickup');
      const b = branchesList().find((x) => x.id === body.pickupBranchId); if (!b) fail(400, 'اختر فرع الاستلام', 'unknown_branch');
      if (!branchHas(b, lineInfo(lines))) fail(409, `بعض الأصناف غير متوفرة في ${b.name}`, 'out_of_stock');
      shipping = 0; Object.assign(extras, { branchId: b.id, branchName: b.name });
    }
    return { shipping, tip: extras.tip, extras, subtotal };
  }

  /** pickup orders go preparing → delivered (collected) without a courier. */
  const canSkipToDelivered = (o, status) => status === 'delivered' && o.status === 'preparing' && orderExtras(o.id)?.mode === 'pickup';

  /** Stamp card: one stamp per delivered order; a full card issues a personal voucher. */
  function onDelivered(o) {
    const cfg = stampCfg();
    if (!cfg.enabled || !flagOn('stampCard') || o.subtotal - o.discount < cfg.minSubtotal || get('SELECT 1 AS x FROM stamp_awards WHERE order_id=?', o.id)) return;
    run('INSERT INTO stamp_awards VALUES(?,?,?)', o.id, o.user_id, now());
    const card = get('SELECT * FROM stamp_cards WHERE user_id=?', o.user_id) || { stamps: 0, completed: 0 };
    const stamps = card.stamps + 1;
    if (stamps >= cfg.stamps) {
      const code = `STAMP-${id('x').slice(-8).toUpperCase()}`;
      run('INSERT INTO coupons(id,code,type,value,min_subtotal,max_uses,uses,expires_at,active,public,title,user_id) VALUES(?,?,?,?,?,1,0,?,1,0,?,?)', id('cpn'), code, cfg.rewardType, cfg.rewardValue, 0, new Date(Date.now() + cfg.validDays * DAY).toISOString(), 'مكافأة بطاقة الأختام', o.user_id);
      run('INSERT INTO stamp_cards VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stamps=0,completed=completed+1,updated_at=excluded.updated_at', o.user_id, 0, 1, now());
      notify(o.user_id, 'اكتملت بطاقة الأختام 🎉', `حصلت على قسيمة ${cfg.rewardType === 'percent' ? `${cfg.rewardValue}%` : cfg.rewardValue} برمز ${code}`);
    } else run('INSERT INTO stamp_cards VALUES(?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET stamps=excluded.stamps,updated_at=excluded.updated_at', o.user_id, stamps, now());
  }

  const validateCollections = (v) => {
    if (!Array.isArray(v) || v.length > 30) fail(400, 'المجموعات يجب أن تكون مصفوفة حتى 30');
    return v.map((c, i) => ({ id: text(c.id || `col-${i + 1}`, 'معرّف المجموعة', 1, 60).replace(/[^\w-]/g, '-'), title: text(c.title, 'عنوان المجموعة', 2, 80), subtitle: c.subtitle ? text(c.subtitle, 'وصف المجموعة', 2, 160) : null, productIds: (Array.isArray(c.productIds) ? c.productIds : []).filter((x) => typeof x === 'string').slice(0, 40), active: c.active !== false }));
  };
  const validateSettings = (body, updates) => {
    if (body.collections !== undefined) updates.collections = validateCollections(body.collections);
    if (body.flags !== undefined) {
      if (!body.flags || typeof body.flags !== 'object' || Array.isArray(body.flags)) fail(400, 'مفاتيح الميزات غير صالحة');
      const f = { ...(setting('flags', {}) || {}) }; for (const [k, v] of Object.entries(body.flags)) { if (!(k in FLAG_DEFAULTS)) fail(400, `مفتاح غير معروف: ${k}`); if (typeof v !== 'boolean') fail(400, 'قيمة المفتاح يجب أن تكون true/false'); f[k] = v; }
      updates.flags = f;
    }
    if (body.stampCard !== undefined) { const s = body.stampCard || {}; updates.stampCard = { enabled: s.enabled !== false, stamps: integer(s.stamps ?? 5, 'عدد الأختام', 2, 20), rewardType: s.rewardType === 'fixed' ? 'fixed' : 'percent', rewardValue: number(s.rewardValue ?? 10, 'قيمة المكافأة', 0.1, s.rewardType === 'fixed' ? 1000 : 50), minSubtotal: number(s.minSubtotal ?? 0, 'الحد الأدنى للطلب', 0, 1e5), validDays: integer(s.validDays ?? 30, 'مدة الصلاحية', 1, 365) }; }
    if (body.deliveryZones !== undefined) {
      if (!Array.isArray(body.deliveryZones) || body.deliveryZones.length > 10) fail(400, 'مناطق التوصيل يجب أن تكون قائمة حتى 10 مناطق');
      updates.deliveryZones = body.deliveryZones.map((z, i) => ({ name: text(z.name || `منطقة ${i + 1}`, 'اسم المنطقة', 1, 60), maxKm: number(z.maxKm, 'نصف قطر المنطقة', 0.5, 200), fee: number(z.fee, 'رسوم المنطقة', 0, 100) })).sort((a, b) => a.maxKm - b.maxKm);
      if (new Set(updates.deliveryZones.map((z) => z.maxKm)).size !== updates.deliveryZones.length) fail(400, 'لا تكرر نصف القطر نفسه لمنطقتين');
    }
    if (body.express !== undefined) { const e = body.express || {}; updates.express = { fee: number(e.fee ?? 2, 'رسوم التوصيل السريع', 0, 100), maxKm: number(e.maxKm ?? 6, 'أقصى مسافة', 0.5, 50), baseMinutes: integer(e.baseMinutes ?? 25, 'الزمن الأساسي', 5, 240), perKmMinutes: number(e.perKmMinutes ?? 4, 'دقائق لكل كم', 0, 60) }; }
  };

  async function handle(method, path, body, req, url) {
    let m;
    // ---- feature flags (governance) ----
    if (method === 'GET' && path === '/api/flags') return { status: 200, body: { flags: flags(), labels: FLAG_LABELS } };
    // ---- search suggestions / popular ----
    if (method === 'GET' && path === '/api/search/suggest') {
      const q = normalizeQuery(url.searchParams.get('q')); if (q.length < 1) return { status: 200, body: { products: [], queries: [] } };
      const rows = all("SELECT * FROM products WHERE active=1 AND json_extract(data,'$.variantOf') IS NULL").map(product);
      const scored = rows.map((p) => { const n = normalizeQuery(`${p.name} ${p.brand || ''} ${(p.tags || []).join(' ')}`); const name = normalizeQuery(p.name); return { p, s: name.startsWith(q) ? 3 : name.split(' ').some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 1 : 0 }; }).filter((x) => x.s).sort((a, b) => b.s - a.s || b.p.rating - a.p.rating).slice(0, 6);
      const queries = all('SELECT query,count FROM search_queries WHERE query LIKE ? AND count>=2 ORDER BY count DESC LIMIT 5', `${q}%`).map((x) => x.query);
      return { status: 200, body: { products: scored.map((x) => ({ id: x.p.id, name: x.p.name, price: x.p.price, image: x.p.image, category: x.p.category })), queries } };
    }
    if (method === 'POST' && path === '/api/search/log') {
      rate(req, 'search-log', 120, 60_000);
      const q = normalizeQuery(body.q);
      if (q.length < 2 || q.length > 60 || /\d{6,}/.test(q) || /@/.test(String(body.q))) return { status: 200, body: { ok: true, stored: false } };
      run('INSERT INTO search_queries VALUES(?,1,?) ON CONFLICT(query) DO UPDATE SET count=count+1,last_at=excluded.last_at', q, now());
      return { status: 200, body: { ok: true, stored: true } };
    }
    if (method === 'GET' && path === '/api/search/popular') return { status: 200, body: { queries: all('SELECT query,count FROM search_queries WHERE count>=2 AND last_at>=? ORDER BY count DESC LIMIT 10', new Date(Date.now() - 30 * DAY).toISOString()) } };
    // ---- vendor discovery ----
    if (method === 'GET' && (path === '/api/vendors' || (m = /^\/api\/vendors\/([\w-]+)$/.exec(path)))) {
      const all_ = all("SELECT * FROM products WHERE active=1 AND json_extract(data,'$.variantOf') IS NULL").map(product);
      const vendorOf = (p) => p.merchantId || 'luqta';
      const merchants = all("SELECT m.*,u.name FROM merchants m JOIN users u ON u.id=m.user_id WHERE m.status='approved'");
      const vendors = [{ id: 'luqta', name: setting('storeName') || 'لُقطة', official: true }, ...merchants.map((x) => ({ id: x.user_id, name: x.store_name, official: false }))].map((v) => {
        const items = all_.filter((p) => vendorOf(p) === v.id), rated = items.filter((p) => p.reviews);
        return { ...v, products: items.length, categories: [...new Set(items.map((p) => p.category))].slice(0, 6), rating: rated.length ? Math.round((rated.reduce((a, p) => a + p.rating * p.reviews, 0) / rated.reduce((a, p) => a + p.reviews, 0)) * 10) / 10 : 0, offers: items.filter((p) => p.oldPrice && p.oldPrice > p.price).length, items };
      }).filter((v) => v.products > 0 || v.official);
      if (m) { const v = vendors.find((x) => x.id === m[1]); if (!v) fail(404, 'المتجر غير موجود', 'not_found'); return { status: 200, body: { vendor: { ...v, items: undefined }, products: v.items } }; }
      return { status: 200, body: { vendors: vendors.map((v) => ({ ...v, items: undefined })) } };
    }
    // ---- curated collections ----
    if (method === 'GET' && (path === '/api/collections' || (m = /^\/api\/collections\/([\w-]+)$/.exec(path)))) {
      const resolve = (c) => ({ ...c, products: c.productIds.map((pid) => get('SELECT * FROM products WHERE id=? AND active=1', pid)).filter(Boolean).map(product) });
      const list = (setting('collections', []) || []).filter((c) => c.active !== false).map(resolve).filter((c) => c.products.length);
      if (m) { const c = list.find((x) => x.id === m[1]); if (!c) fail(404, 'المجموعة غير موجودة', 'not_found'); return { status: 200, body: { collection: c } }; }
      return { status: 200, body: { collections: list } };
    }
    // ---- loyalty: stamp card + personal vouchers ----
    if (method === 'GET' && path === '/api/loyalty/stamps') {
      const actor = requireUser(req), cfg = stampCfg(), card = get('SELECT * FROM stamp_cards WHERE user_id=?', actor.id);
      const vouchers = all('SELECT * FROM coupons WHERE user_id=? AND active=1 AND uses<COALESCE(max_uses,1) AND (expires_at IS NULL OR expires_at>?) ORDER BY expires_at', actor.id, now()).map((c) => ({ code: c.code, title: c.title, type: c.type, value: c.value, expiresAt: c.expires_at }));
      return { status: 200, body: { enabled: cfg.enabled && flagOn('stampCard'), stamps: card?.stamps || 0, required: cfg.stamps, completed: card?.completed || 0, reward: { type: cfg.rewardType, value: cfg.rewardValue }, minSubtotal: cfg.minSubtotal, vouchers } };
    }
    // ---- quick commerce / pickup options ----
    if (method === 'POST' && path === '/api/delivery/options') {
      rate(req, 'delivery-options', 120, 60_000);
      const lat = body.latitude == null ? NaN : number(body.latitude, 'خط العرض', -90, 90), lng = body.longitude == null ? NaN : number(body.longitude, 'خط الطول', -180, 180);
      return { status: 200, body: deliveryOptions({ items: body.items, latitude: lat, longitude: lng }) };
    }
    // ---- order feedback ----
    if (method === 'GET' && path === '/api/orders/feedback/pending') {
      const actor = requireUser(req);
      const o = get("SELECT o.* FROM orders o WHERE o.user_id=? AND o.status='delivered' AND o.updated_at>=? AND NOT EXISTS (SELECT 1 FROM order_feedback f WHERE f.order_id=o.id) ORDER BY o.updated_at DESC LIMIT 1", actor.id, new Date(Date.now() - 14 * DAY).toISOString());
      return { status: 200, body: { order: o ? { id: o.id, total: o.total, date: o.updated_at, items: parse(o.items, []).length } : null } };
    }
    if (method === 'POST' && (m = /^\/api\/orders\/([\w-]+)\/feedback$/.exec(path))) {
      const actor = requireUser(req), o = get('SELECT * FROM orders WHERE id=? AND user_id=?', m[1], actor.id);
      if (!o) fail(404, 'الطلب غير موجود', 'not_found'); if (o.status !== 'delivered') fail(409, 'يمكن تقييم الطلب بعد التسليم فقط');
      if (get('SELECT 1 AS x FROM order_feedback WHERE order_id=?', o.id)) fail(409, 'قيّمت هذا الطلب مسبقًا', 'already_rated');
      const allowed = ['سريع', 'مغلّف جيدًا', 'سائق لطيف', 'منتجات طازجة', 'تأخر', 'صنف ناقص', 'تغليف سيئ'];
      const tags = (Array.isArray(body.tags) ? body.tags : []).filter((x) => allowed.includes(x)).slice(0, 7);
      run('INSERT INTO order_feedback VALUES(?,?,?,?,?,?)', o.id, actor.id, integer(body.rating, 'التقييم', 1, 5), json(tags), body.comment ? text(body.comment, 'الملاحظة', 1, 500) : null, now());
      if (Number(body.rating) <= 2) for (const a of all("SELECT id FROM users WHERE role='admin'")) notify(a.id, 'تقييم منخفض لطلب', `الطلب ${o.id}: ${body.rating}/5`, o.id);
      return { status: 201, body: { ok: true, tags } };
    }
    if (method === 'GET' && path === '/api/admin/feedback') {
      admin(req, 'orders:write');
      const rows = all('SELECT * FROM order_feedback ORDER BY created_at DESC LIMIT 200');
      const tagCounts = {}; for (const r of rows) for (const t of parse(r.tags, [])) tagCounts[t] = (tagCounts[t] || 0) + 1;
      return { status: 200, body: { count: rows.length, average: rows.length ? Math.round((rows.reduce((a, r) => a + r.rating, 0) / rows.length) * 10) / 10 : 0, tags: tagCounts, recent: rows.slice(0, 20).map((r) => ({ orderId: r.order_id, rating: r.rating, tags: parse(r.tags, []), comment: r.comment, createdAt: r.created_at })) } };
    }
    // ---- privacy-preserving analytics (aggregated daily counts, no user id, no IP stored) ----
    if (method === 'POST' && path === '/api/analytics/event') {
      rate(req, 'analytics', 300, 60_000);
      if (!flagOn('analytics')) return { status: 200, body: { ok: true, stored: false } };
      if (!EVENT_NAMES.includes(body.name)) fail(400, 'اسم الحدث غير معروف', 'unknown_event');
      run('INSERT INTO analytics_daily VALUES(?,?,1) ON CONFLICT(day,name) DO UPDATE SET count=count+1', day(), body.name);
      return { status: 200, body: { ok: true, stored: true } };
    }
    if (method === 'GET' && path === '/api/admin/analytics') {
      admin(req);
      const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 14));
      const from = new Date(Date.now() + 3 * 3600_000 - (days - 1) * DAY).toISOString().slice(0, 10);
      const rows = all('SELECT * FROM analytics_daily WHERE day>=? ORDER BY day', from);
      const orders = all("SELECT substr(created_at,1,10) AS day,COUNT(*) AS n,SUM(total) AS revenue FROM orders WHERE created_at>=? AND status!='cancelled' GROUP BY substr(created_at,1,10)", `${from}T00:00:00Z`);
      const totals = Object.fromEntries(EVENT_NAMES.map((n) => [n, rows.filter((r) => r.name === n).reduce((a, r) => a + r.count, 0)]));
      const placed = orders.reduce((a, o) => a + o.n, 0);
      const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
      return { status: 200, body: { days, from, totals: { ...totals, order_placed: placed, revenue: money(orders.reduce((a, o) => a + (o.revenue || 0), 0)) }, funnel: [{ step: 'view_product', count: totals.view_product }, { step: 'add_to_cart', count: totals.add_to_cart, rate: pct(totals.add_to_cart, totals.view_product) }, { step: 'begin_checkout', count: totals.begin_checkout, rate: pct(totals.begin_checkout, totals.add_to_cart) }, { step: 'order_placed', count: placed, rate: pct(placed, totals.begin_checkout) }], daily: rows, orders } };
    }
    return undefined;
  }

  return { handle, checkout, canSkipToDelivered, onDelivered, validateSettings, deliveryOptions, flags, requireFlag };
}
