// G14 — features merged from the "أسواق جوافة / Aura" app, rebuilt on real store data.
// Everything here is computed from the commerce database (no invented prices or
// discounts): price history is captured by SQLite triggers on every price change,
// alerts are raised by a trigger, bundles are owner-defined rules applied at checkout,
// and AI-backed features only run when a provider key is configured on the server.

const DAY = 86400_000;
const LEVELS = [
  { id: 'bronze', name: 'برونزي', min: 0 },
  { id: 'silver', name: 'فضي', min: 500 },
  { id: 'gold', name: 'ذهبي', min: 1500 },
  { id: 'platinum', name: 'بلاتيني', min: 4000 },
];
export const levelFor = (lifetime) => {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (lifetime >= LEVELS[i].min) index = i;
  const level = LEVELS[index], next = LEVELS[index + 1] || null;
  return { ...level, next, progress: next ? Math.min(1, (lifetime - level.min) / (next.min - level.min)) : 1 };
};
/** Amman calendar day (UTC+3, no DST since 2022) so "once a day" matches the customer's day. */
export const ammanDay = (ms = Date.now()) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);
const CHECKIN_BASE = 5, CHECKIN_STREAK_BONUS = 2, CHECKIN_MAX = 20, GAME_POINTS = 10;
export const checkinPoints = (streak) => Math.min(CHECKIN_MAX, CHECKIN_BASE + CHECKIN_STREAK_BONUS * (Math.max(1, streak) - 1));
/** Rough last-mile emission per separate delivery trip (kg CO₂), used for the eco-delivery estimate. */
export const CO2_PER_TRIP_KG = 0.9;

/** Least-squares slope of price over days → "best time to buy" hint. */
export function priceStats(points, current) {
  if (!points.length) return { min: current, max: current, avg: current, changePct: 0, trend: 'flat', advice: 'لا توجد تغييرات سعر مسجلة بعد لهذا المنتج.' };
  const prices = points.map((p) => p.price), first = prices[0];
  const min = Math.min(...prices, current), max = Math.max(...prices, current);
  const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 1000) / 1000;
  const changePct = first ? Math.round(((current - first) / first) * 1000) / 10 : 0;
  const t0 = Date.parse(points[0].at);
  const xs = points.map((p) => (Date.parse(p.at) - t0) / DAY), n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = prices.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = den ? xs.reduce((a, x, i) => a + (x - mx) * (prices[i] - my), 0) / den : 0;
  const rel = my ? slope / my : 0;
  const trend = rel < -0.002 ? 'down' : rel > 0.002 ? 'up' : 'flat';
  let advice;
  if (current <= min) advice = 'السعر الحالي هو الأدنى خلال الفترة — وقت مناسب للشراء.';
  else if (trend === 'down') advice = 'السعر يتجه للانخفاض؛ يمكنك متابعة السعر وتفعيل تنبيه عند الهدف.';
  else if (trend === 'up') advice = 'السعر يتجه للارتفاع؛ الشراء الآن قد يوفر عليك.';
  else advice = 'السعر مستقر تقريبًا خلال الفترة.';
  return { min, max, avg, changePct, trend, advice };
}

/** Owner-defined bundle rules → the single best discount for these cart lines. */
export function bestBundle(bundles, lines) {
  let best = null;
  for (const b of bundles || []) {
    if (!b || b.active === false) continue;
    const matched = lines.filter((l) => (b.productIds?.length && b.productIds.includes(l.productId)) || (b.categories?.length && b.categories.includes(l.category)));
    const distinct = new Set(matched.map((l) => l.productId)).size;
    if (distinct < (b.minItems || 2)) continue;
    const base = matched.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const discount = Math.round(base * (b.percent / 100) * 1000) / 1000;
    if (!best || discount > best.discount) best = { id: b.id, name: b.name, percent: b.percent, productIds: matched.map((l) => l.productId), base: Math.round(base * 1000) / 1000, discount };
  }
  return best;
}

export function validateBundles(value, text, number, integer, fail) {
  if (!Array.isArray(value) || value.length > 30) fail(400, 'قائمة الحزم يجب أن تكون مصفوفة حتى 30 حزمة');
  return value.map((b, i) => {
    if (!b || typeof b !== 'object') fail(400, `الحزمة ${i + 1} غير صالحة`);
    const productIds = Array.isArray(b.productIds) ? b.productIds.filter((x) => typeof x === 'string').slice(0, 50) : [];
    const categories = Array.isArray(b.categories) ? b.categories.filter((x) => typeof x === 'string').slice(0, 20) : [];
    if (!productIds.length && !categories.length) fail(400, `حدد منتجات أو أقسامًا للحزمة ${i + 1}`);
    return { id: text(b.id || `bundle-${i + 1}`, 'معرّف الحزمة', 1, 60), name: text(b.name, 'اسم الحزمة', 2, 80), percent: number(b.percent, 'نسبة الخصم', 1, 50), minItems: integer(b.minItems ?? 2, 'أقل عدد أصناف', 2, 20), productIds, categories, active: b.active !== false };
  });
}

/** Gemini REST provider (server-side key only). Returns parsed JSON text from the model. */
async function geminiJson({ key, model, fetcher, parts, timeoutMs = 25_000 }) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error('ai_upstream'); e.status = 502; e.code = 'ai_upstream'; throw e; }
    const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    try { return JSON.parse(txt); } catch { return {}; }
  } finally { clearTimeout(timer); }
}
const DATA_URL = /^data:(image\/(?:png|jpeg|webp)|audio\/(?:webm|ogg|mp4|mpeg|wav|aac));base64,([A-Za-z0-9+/=]+)$/;

export function installFeatures(ctx) {
  const { flagOn = () => true } = ctx;
  const featureOff = (k) => { if (!flagOn(k)) fail(403, 'هذه الميزة متوقفة مؤقتًا من إدارة المتجر', 'feature_disabled'); };
  const { db, get, all, run, transaction, id, now, money, fail, text, number, integer, json, parse, requireUser, admin, identity, notify, rewardLedger, rewardBalance, product, setting, setSetting, rate, audit, options } = ctx;
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id TEXT NOT NULL,price REAL NOT NULL,old_price REAL,at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS price_history_product ON price_history(product_id,at);
    CREATE TABLE IF NOT EXISTS price_watches(user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL,target REAL NOT NULL,created_at TEXT NOT NULL,notified_at TEXT,PRIMARY KEY(user_id,product_id));
    CREATE TABLE IF NOT EXISTS competitor_prices(product_id TEXT NOT NULL,source TEXT NOT NULL,price REAL NOT NULL,shipping REAL NOT NULL DEFAULT 0,url TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(product_id,source));
    CREATE TABLE IF NOT EXISTS product_stats(product_id TEXT NOT NULL,day TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,shares INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(product_id,day));
    CREATE TABLE IF NOT EXISTS lists(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,budget REAL,share_code TEXT UNIQUE,family INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS list_members(list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,joined_at TEXT NOT NULL,PRIMARY KEY(list_id,user_id));
    CREATE TABLE IF NOT EXISTS list_items(id TEXT PRIMARY KEY,list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,product_id TEXT,title TEXT NOT NULL,quantity INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,added_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkins(user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,streak INTEGER NOT NULL,points INTEGER NOT NULL,PRIMARY KEY(user_id,day));
    CREATE TABLE IF NOT EXISTS game_awards(user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,moves INTEGER NOT NULL,seconds INTEGER NOT NULL,PRIMARY KEY(user_id,day));
    CREATE TABLE IF NOT EXISTS media_posts(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('video','story')),title TEXT NOT NULL,media_url TEXT NOT NULL,poster_url TEXT,product_id TEXT,active INTEGER NOT NULL DEFAULT 1,views INTEGER NOT NULL DEFAULT 0,likes INTEGER NOT NULL DEFAULT 0,expires_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media_likes(post_id TEXT NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(post_id,user_id));
    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),store TEXT,total REAL NOT NULL,items TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_extras(order_id TEXT PRIMARY KEY REFERENCES orders(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS merchants(user_id TEXT PRIMARY KEY REFERENCES users(id),store_name TEXT NOT NULL,phone TEXT,status TEXT NOT NULL CHECK(status IN ('pending','approved','suspended')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,title TEXT NOT NULL,subtitle TEXT,image TEXT,product_id TEXT,category TEXT,starts_at TEXT,ends_at TEXT,active INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS luqta_price_insert AFTER INSERT ON products BEGIN
      INSERT INTO price_history(product_id,price,old_price,at) VALUES(new.id,json_extract(new.data,'$.price'),json_extract(new.data,'$.oldPrice'),new.updated_at);
    END;
    CREATE TRIGGER IF NOT EXISTS luqta_price_update AFTER UPDATE OF data ON products
      WHEN json_extract(new.data,'$.price') IS NOT json_extract(old.data,'$.price') BEGIN
      INSERT INTO price_history(product_id,price,old_price,at) VALUES(new.id,json_extract(new.data,'$.price'),json_extract(new.data,'$.oldPrice'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    END;
    CREATE TRIGGER IF NOT EXISTS luqta_price_alert AFTER INSERT ON price_history BEGIN
      INSERT INTO notifications SELECT 'ntf_'||lower(hex(randomblob(16))),w.user_id,'انخفض السعر إلى هدفك',
        'أصبح سعر '||COALESCE(json_extract(p.data,'$.name'),'منتج')||' '||new.price||' (هدفك '||w.target||')',0,NULL,new.at
        FROM price_watches w JOIN products p ON p.id=w.product_id WHERE w.product_id=new.product_id AND new.price<=w.target AND w.notified_at IS NULL;
      UPDATE price_watches SET notified_at=new.at WHERE product_id=new.product_id AND new.price<=target AND notified_at IS NULL;
    END;
  `);
  for (const sql of ['ALTER TABLE coupons ADD COLUMN public INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE coupons ADD COLUMN title TEXT']) { try { db.exec(sql); } catch { /* column exists */ } }
  // seed history for products created before this feature existed
  run(`INSERT INTO price_history(product_id,price,old_price,at) SELECT id,json_extract(data,'$.price'),json_extract(data,'$.oldPrice'),updated_at FROM products p WHERE NOT EXISTS (SELECT 1 FROM price_history h WHERE h.product_id=p.id)`);

  const aiKey = options.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '';
  const aiModel = options.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const aiFetch = options.aiFetch || fetch;
  const requireAi = () => { if (!aiKey) fail(503, 'خدمة الذكاء الاصطناعي غير مفعّلة على الخادم بعد', 'ai_not_configured'); };
  const dataUrl = (value, field, maxBytes) => {
    const m = typeof value === 'string' ? DATA_URL.exec(value) : null;
    if (!m) fail(400, `${field} غير صالح`, 'invalid_media');
    if (m[2].length * 0.75 > maxBytes) fail(413, `${field} أكبر من الحد المسموح`, 'media_too_large');
    return { mimeType: m[1], data: m[2] };
  };
  const productRow = (pid) => { const r = get('SELECT * FROM products WHERE id=? AND active=1', pid); if (!r) fail(404, 'المنتج غير موجود', 'not_found'); return r; };
  const catalogLite = () => all("SELECT * FROM products WHERE active=1 AND json_extract(data,'$.variantOf') IS NULL").map(product);
  const optionalUser = (req) => { try { return req.headers.authorization ? identity(req) : null; } catch { return null; } };
  const lineInfo = (items) => (Array.isArray(items) ? items : []).slice(0, 100).map((l) => {
    const r = get('SELECT * FROM products WHERE id=? AND active=1', String(l.productId || ''));
    if (!r) return null; const d = parse(r.data, {});
    return { productId: r.id, name: d.name, price: d.price, category: d.category, quantity: Math.max(1, Math.min(1000, Number(l.quantity) || 1)), stock: r.stock, branchStock: d.branchStock || null };
  }).filter(Boolean);
  const bundleFor = (lines) => bestBundle(setting('bundles', []) || [], lines.map((l) => ({ ...l, category: l.category ?? parse(get('SELECT data FROM products WHERE id=?', l.productId)?.data, {}).category })));
  const listAccess = (actor, listId, owner = false) => {
    const l = get('SELECT * FROM lists WHERE id=?', listId); if (!l) fail(404, 'القائمة غير موجودة', 'not_found');
    const member = get('SELECT role FROM list_members WHERE list_id=? AND user_id=?', listId, actor.id);
    if (!member || (owner && member.role !== 'owner')) fail(403, 'لا يمكنك الوصول إلى هذه القائمة', 'forbidden');
    return l;
  };
  const listView = (l) => ({
    id: l.id, name: l.name, budget: l.budget, family: !!l.family, shareCode: l.share_code, ownerId: l.owner_id, createdAt: l.created_at, updatedAt: l.updated_at,
    members: all('SELECT m.user_id AS id,u.name,m.role FROM list_members m JOIN users u ON u.id=m.user_id WHERE m.list_id=? ORDER BY m.joined_at', l.id),
    items: all('SELECT i.*,u.name AS by_name FROM list_items i JOIN users u ON u.id=i.added_by WHERE i.list_id=? ORDER BY i.done,i.created_at', l.id).map((i) => {
      const r = i.product_id ? get('SELECT * FROM products WHERE id=?', i.product_id) : null;
      const price = r ? parse(r.data, {}).price : null;
      return { id: i.id, productId: i.product_id, title: i.title, quantity: i.quantity, done: !!i.done, addedBy: i.by_name, price, lineTotal: price != null ? money(price * i.quantity) : null };
    }),
  });
  const shareCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (const b of require32()) c += a[b % a.length]; return c; };
  const require32 = () => { const bytes = new Uint8Array(8); globalThis.crypto.getRandomValues(bytes); return bytes; };
  const mediaView = (m, userId) => ({ id: m.id, kind: m.kind, title: m.title, mediaUrl: m.media_url, posterUrl: m.poster_url, productId: m.product_id, views: m.views, likes: m.likes, liked: userId ? !!get('SELECT 1 AS x FROM media_likes WHERE post_id=? AND user_id=?', m.id, userId) : false, expiresAt: m.expires_at, createdAt: m.created_at, active: !!m.active });
  const campaignView = (c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, image: c.image, productId: c.product_id, category: c.category, startsAt: c.starts_at, endsAt: c.ends_at, active: !!c.active });
  const httpsUrl = (v, field, required = true) => { if (v == null || v === '') { if (required) fail(400, `${field} مطلوب`); return null; } if (typeof v !== 'string' || v.length > 2000 || !/^https:\/\/\S+$/.test(v)) fail(400, `${field} يجب أن يكون رابط HTTPS`); return v; };
  const isoOrNull = (v, field) => { if (v == null || v === '') return null; const t = Date.parse(v); if (!Number.isFinite(t)) fail(400, `${field} غير صالح`); return new Date(t).toISOString(); };
  const merchantOf = (actor) => get('SELECT * FROM merchants WHERE user_id=?', actor.id);
  const lifetimePoints = (userId) => get("SELECT COALESCE(SUM(points),0) AS n FROM reward_ledger WHERE user_id=? AND points>0 AND type='earned'", userId).n;

  const rewardsProfile = (actor) => {
    const today = ammanDay(), yesterday = ammanDay(Date.now() - DAY);
    const last = get('SELECT * FROM checkins WHERE user_id=? ORDER BY day DESC LIMIT 1', actor.id);
    const streak = last && (last.day === today || last.day === yesterday) ? last.streak : 0;
    const orders = get("SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status='delivered'", actor.id).n;
    const reviews = get('SELECT COUNT(*) AS n FROM reviews WHERE user_id=?', actor.id).n;
    const lists = get('SELECT COUNT(*) AS n FROM list_members WHERE user_id=?', actor.id).n;
    const eco = get("SELECT COUNT(*) AS n FROM order_extras x JOIN orders o ON o.id=x.order_id WHERE o.user_id=? AND json_extract(x.data,'$.eco')=1", actor.id).n;
    const watches = get('SELECT COUNT(*) AS n FROM price_watches WHERE user_id=?', actor.id).n;
    const maxStreak = get('SELECT COALESCE(MAX(streak),0) AS n FROM checkins WHERE user_id=?', actor.id).n;
    const lifetime = lifetimePoints(actor.id);
    const badges = [
      { id: 'first-order', title: 'أول لُقطة', detail: 'أول طلب تم تسليمه', earned: orders >= 1 },
      { id: 'regular', title: 'متسوق دائم', detail: '5 طلبات مُسلّمة', earned: orders >= 5 },
      { id: 'reviewer', title: 'صوت الزبائن', detail: 'كتابة تقييم لمنتج', earned: reviews >= 1 },
      { id: 'streak-7', title: 'أسبوع متواصل', detail: 'تسجيل يومي 7 أيام متتالية', earned: maxStreak >= 7 },
      { id: 'family', title: 'تسوق عائلي', detail: 'المشاركة في قائمة عائلية', earned: lists >= 1 },
      { id: 'eco', title: 'صديق البيئة', detail: 'اختيار توصيل مجمّع صديق للبيئة', earned: eco >= 1 },
      { id: 'savvy', title: 'صياد الأسعار', detail: 'متابعة سعر منتج', earned: watches >= 1 },
    ];
    return { points: rewardBalance(actor.id), lifetime, level: levelFor(lifetime), levels: LEVELS, streak, checkedInToday: last?.day === today, nextCheckinPoints: checkinPoints(last?.day === today ? streak + 1 : streak + 1), gamePlayedToday: !!get('SELECT 1 AS x FROM game_awards WHERE user_id=? AND day=?', actor.id, today), badges };
  };

  async function handle(method, path, p, body, req) {
    let m;
    // ---- price history / trend / prediction (F-G14-01) ----
    if (method === 'GET' && (m = /^\/api\/products\/([\w-]+)\/price-history$/.exec(path))) {
      const r = productRow(m[1]), current = parse(r.data, {}).price;
      const url = new URL(req.url, 'http://x'); const days = Math.max(7, Math.min(180, Number(url.searchParams.get('days')) || 30));
      const since = new Date(Date.now() - days * DAY).toISOString();
      const before = get('SELECT price,at FROM price_history WHERE product_id=? AND at<? ORDER BY at DESC LIMIT 1', r.id, since);
      const rows = all('SELECT price,old_price AS oldPrice,at FROM price_history WHERE product_id=? AND at>=? ORDER BY at', r.id, since);
      const points = [...(before ? [{ price: before.price, at: since }] : []), ...rows];
      if (!points.length || points.at(-1).price !== current) points.push({ price: current, at: now() });
      return { status: 200, body: { productId: r.id, days, points, stats: priceStats(points, current) } };
    }
    // ---- market pulse (F-G14-02) ----
    if (method === 'GET' && path === '/api/market/pulse') {
      const since = new Date(Date.now() - 30 * DAY).toISOString(), list = catalogLite(), byCat = new Map();
      const movers = [];
      for (const pr of list) {
        const first = get('SELECT price FROM price_history WHERE product_id=? AND at<=? ORDER BY at DESC LIMIT 1', pr.id, since) || get('SELECT price FROM price_history WHERE product_id=? ORDER BY at LIMIT 1', pr.id);
        const base = first?.price ?? pr.price, change = base ? (pr.price - base) / base : 0;
        if (Math.abs(change) >= 0.001) movers.push({ productId: pr.id, name: pr.name, image: pr.image, from: base, to: pr.price, changePct: Math.round(change * 1000) / 10 });
        const c = byCat.get(pr.category) || { category: pr.category, products: 0, sum: 0, changeSum: 0, offers: 0, stock: 0 };
        c.products++; c.sum += pr.price; c.changeSum += change; if (pr.oldPrice && pr.oldPrice > pr.price) c.offers++; c.stock += pr.stock || 0; byCat.set(pr.category, c);
      }
      const categories = [...byCat.values()].map((c) => ({ category: c.category, products: c.products, avgPrice: money(c.sum / c.products), changePct: Math.round((c.changeSum / c.products) * 1000) / 10, offers: c.offers, stock: c.stock })).sort((a, b) => b.products - a.products);
      const dayFrom = ammanDay(Date.now() - 7 * DAY);
      const views = all('SELECT product_id,SUM(views) AS v FROM product_stats WHERE day>=? GROUP BY product_id ORDER BY v DESC LIMIT 5', dayFrom);
      const timeline = all("SELECT substr(at,1,10) AS day,COUNT(*) AS changes,AVG(price) AS avg FROM price_history WHERE at>=? GROUP BY substr(at,1,10) ORDER BY day", since).map((d) => ({ day: d.day, changes: d.changes, avg: money(d.avg) }));
      return { status: 200, body: { generatedAt: now(), totals: { products: list.length, offers: categories.reduce((a, c) => a + c.offers, 0), priceChanges30d: get('SELECT COUNT(*) AS n FROM price_history WHERE at>=?', since).n }, categories, drops: movers.filter((x) => x.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 8), rises: movers.filter((x) => x.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 8), mostViewed: views.map((v) => ({ productId: v.product_id, views: v.v })), timeline } };
    }
    // ---- price watches / alerts (F-G14-03) ----
    if (path === '/api/watchlist') {
      const actor = requireUser(req);
      if (method === 'GET') return { status: 200, body: { watches: all('SELECT * FROM price_watches WHERE user_id=? ORDER BY created_at DESC', actor.id).map((w) => { const r = get('SELECT * FROM products WHERE id=?', w.product_id); const d = r ? parse(r.data, {}) : {}; return { productId: w.product_id, name: d.name || 'منتج محذوف', image: d.image || null, price: d.price ?? null, target: w.target, reached: d.price != null && d.price <= w.target, notifiedAt: w.notified_at, createdAt: w.created_at }; }) } };
      if (method === 'POST') {
        const r = productRow(text(body.productId, 'المنتج', 1, 100)), price = parse(r.data, {}).price;
        const target = money(number(body.target, 'السعر المستهدف', 0.001, 1e7));
        if (get('SELECT COUNT(*) AS n FROM price_watches WHERE user_id=?', actor.id).n >= 100 && !get('SELECT 1 AS x FROM price_watches WHERE user_id=? AND product_id=?', actor.id, r.id)) fail(400, 'وصلت للحد الأقصى من المتابعات (100)');
        run('INSERT INTO price_watches VALUES(?,?,?,?,NULL) ON CONFLICT(user_id,product_id) DO UPDATE SET target=excluded.target,notified_at=NULL', actor.id, r.id, target, now());
        if (price <= target) { notify(actor.id, 'السعر عند هدفك الآن', `سعر ${parse(r.data, {}).name} الحالي ${price} وهو ضمن هدفك ${target}`); run('UPDATE price_watches SET notified_at=? WHERE user_id=? AND product_id=?', now(), actor.id, r.id); }
        return { status: 201, body: { ok: true, productId: r.id, target, reached: price <= target } };
      }
    }
    if (method === 'DELETE' && (m = /^\/api\/watchlist\/([\w-]+)$/.exec(path))) { const actor = requireUser(req); run('DELETE FROM price_watches WHERE user_id=? AND product_id=?', actor.id, m[1]); return { status: 200, body: { ok: true } }; }
    // ---- price radar: our branches + imported competitor prices (F-G14-04) ----
    if (method === 'GET' && (m = /^\/api\/products\/([\w-]+)\/compare$/.exec(path))) {
      const r = productRow(m[1]), d = parse(r.data, {}), branches = setting('branches', []) || [];
      const ourShipping = d.price >= setting('freeShippingThreshold') ? 0 : setting('shippingFee');
      const rates = [{ source: setting('storeName') || 'لُقطة', ours: true, price: d.price, shipping: ourShipping, total: money(d.price + ourShipping), url: null, updatedAt: r.updated_at, inStock: r.stock > 0 },
        ...all('SELECT * FROM competitor_prices WHERE product_id=? ORDER BY price', r.id).map((c) => ({ source: c.source, ours: false, price: c.price, shipping: c.shipping, total: money(c.price + c.shipping), url: c.url, updatedAt: c.updated_at, inStock: true }))];
      const lowest = rates.reduce((a, b) => (b.total < a.total ? b : a), rates[0]);
      const highest = rates.reduce((a, b) => (b.total > a.total ? b : a), rates[0]);
      return { status: 200, body: { productId: r.id, name: d.name, rates: rates.map((x) => ({ ...x, lowest: x === lowest })), spread: money(highest.total - lowest.total), savingVsHighest: money(highest.total - rates[0].total), branches: branches.map((b) => ({ id: b.id, name: b.name, stock: d.branchStock ? d.branchStock[b.id] ?? 0 : null })) } };
    }
    if (method === 'PUT' && path === '/api/admin/competitor-prices') {
      const actor = admin(req, 'inventory:write');
      const rows = body.rows; if (!Array.isArray(rows) || !rows.length || rows.length > 2000) fail(400, 'قائمة الأسعار يجب أن تحتوي 1 إلى 2000 صف');
      const clean = rows.map((x, i) => { const pid = text(x.productId, `المنتج في الصف ${i + 1}`, 1, 100); if (!get('SELECT id FROM products WHERE id=?', pid)) fail(400, `المنتج ${pid} غير موجود`); return { pid, source: text(x.source, 'اسم المتجر المنافس', 2, 80), price: money(number(x.price, 'السعر', 0.001, 1e7)), shipping: money(number(x.shipping ?? 0, 'الشحن', 0, 1e5)), url: httpsUrl(x.url, 'رابط المصدر', false) }; });
      transaction(() => { for (const c of clean) run('INSERT INTO competitor_prices VALUES(?,?,?,?,?,?) ON CONFLICT(product_id,source) DO UPDATE SET price=excluded.price,shipping=excluded.shipping,url=excluded.url,updated_at=excluded.updated_at', c.pid, c.source, c.price, c.shipping, c.url, now()); audit(actor, 'competitor_prices.import', '', { rows: clean.length }); });
      return { status: 200, body: { ok: true, imported: clean.length } };
    }
    // ---- basket optimizer (F-G14-05) + bundles (F-G14-06) ----
    if (method === 'POST' && path === '/api/basket/optimize') {
      rate(req, 'basket-optimize', 60, 60_000);
      const lines = lineInfo(body.items); if (!lines.length) fail(400, 'السلة فارغة');
      const objective = ['cheapest', 'single-branch', 'fastest'].includes(body.objective) ? body.objective : 'cheapest';
      const subtotal = money(lines.reduce((a, l) => a + l.price * l.quantity, 0));
      const branches = (setting('branches', []) || []).map((b) => { const missing = lines.filter((l) => l.branchStock ? (l.branchStock[b.id] ?? 0) < l.quantity : l.stock < l.quantity).map((l) => l.name); return { id: b.id, name: b.name, city: b.city, canFulfill: missing.length === 0, missing }; });
      const catalog = catalogLite(), inCart = new Set(lines.map((l) => l.productId));
      const alternatives = objective === 'fastest' ? [] : lines.map((l) => {
        const options = catalog.filter((c) => c.category === l.category && !inCart.has(c.id) && c.stock >= l.quantity && c.price <= l.price * 0.95).sort((a, b) => a.price - b.price || b.rating - a.rating);
        const alt = options[0]; if (!alt) return null;
        return { productId: l.productId, name: l.name, price: l.price, replaceWith: { id: alt.id, name: alt.name, price: alt.price, image: alt.image, rating: alt.rating }, quantity: l.quantity, saving: money((l.price - alt.price) * l.quantity) };
      }).filter(Boolean);
      const bundle = bundleFor(lines), threshold = setting('freeShippingThreshold'), fee = setting('shippingFee');
      const altSaving = money(alternatives.reduce((a, x) => a + x.saving, 0));
      const optimizedSubtotal = money(subtotal - altSaving);
      const best = branches.find((b) => b.canFulfill) || null;
      const tips = [];
      if (optimizedSubtotal < threshold) tips.push(`أضف ${money(threshold - optimizedSubtotal)} للحصول على توصيل مجاني (توفير ${fee}).`);
      if (bundle) tips.push(`حزمة «${bundle.name}» تُطبّق تلقائيًا عند الدفع: خصم ${bundle.percent}%.`);
      if (objective !== 'cheapest' && !best) tips.push('لا يوجد فرع واحد يوفر كل الأصناف؛ قد يُجهّز الطلب من أكثر من فرع.');
      return { status: 200, body: { objective, subtotal, alternatives, alternativesSaving: altSaving, bundle, branches, recommendedBranch: best, freeShipping: { threshold, fee, remaining: Math.max(0, money(threshold - optimizedSubtotal)) }, optimizedSubtotal, estimatedTotal: money(optimizedSubtotal - (bundle?.discount || 0) + (optimizedSubtotal >= threshold ? 0 : fee)), tips } };
    }
    if (method === 'GET' && path === '/api/bundles') return { status: 200, body: { bundles: (setting('bundles', []) || []).filter((b) => b.active !== false) } };
    // ---- frequently bought together (F-G14-07) ----
    if (method === 'GET' && (m = /^\/api\/products\/([\w-]+)\/together$/.exec(path))) {
      const r = productRow(m[1]), d = parse(r.data, {}), counts = new Map();
      for (const o of all("SELECT items FROM orders WHERE status!='cancelled' AND items LIKE ? ORDER BY created_at DESC LIMIT 500", `%${r.id}%`)) { const ids = parse(o.items, []).map((x) => x.productId); if (!ids.includes(r.id)) continue; for (const x of ids) if (x !== r.id) counts.set(x, (counts.get(x) || 0) + 1); }
      let items = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([pid, n]) => { const pr = get('SELECT * FROM products WHERE id=? AND active=1', pid); return pr && pr.stock > 0 ? { ...product(pr), together: n } : null; }).filter(Boolean).slice(0, 6);
      const source = items.length ? 'orders' : 'category';
      if (!items.length) items = catalogLite().filter((c) => c.id !== r.id && c.category !== d.category && c.stock > 0).sort((a, b) => b.rating - a.rating || b.reviews - a.reviews).slice(0, 6);
      return { status: 200, body: { productId: r.id, source, products: items } };
    }
    // ---- spending insights (F-G14-08) + green summary (F-G14-30) ----
    if (method === 'GET' && path === '/api/me/insights') {
      const actor = requireUser(req), orders = all("SELECT * FROM orders WHERE user_id=? AND status!='cancelled' ORDER BY created_at", actor.id);
      const months = new Map(), cats = new Map(); let saved = 0, spent = 0;
      for (const o of orders) {
        const k = o.created_at.slice(0, 7); months.set(k, money((months.get(k) || 0) + o.total)); spent += o.total; saved += o.discount;
        for (const l of parse(o.items, [])) { const pr = get('SELECT data FROM products WHERE id=?', l.productId); const c = pr ? parse(pr.data, {}).category : 'other'; cats.set(c, money((cats.get(c) || 0) + l.price * l.quantity)); const old = pr ? parse(pr.data, {}).oldPrice : null; if (old && old > l.price) saved += (old - l.price) * l.quantity; }
      }
      const monthly = [...months.entries()].slice(-6).map(([month, total]) => ({ month, total }));
      const byCategory = [...cats.entries()].map(([category, total]) => ({ category, total, share: spent ? Math.round((total / spent) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total);
      const avgBasket = orders.length ? money(spent / orders.length) : 0, fee = setting('shippingFee');
      const paidShipping = orders.filter((o) => o.shipping > 0).length, tips = [];
      if (paidShipping) tips.push(`دفعت رسوم توصيل في ${paidShipping} طلب؛ جمع الطلبات فوق ${setting('freeShippingThreshold')} يوفر ${money(paidShipping * fee)}.`);
      if (byCategory[0]) tips.push(`أكثر إنفاقك على قسم «${byCategory[0].category}» (${byCategory[0].share}%) — فعّل تنبيه السعر لأصنافه المتكررة.`);
      if (monthly.length >= 2) { const [a, b] = monthly.slice(-2); const d = b.total - a.total; tips.push(d > 0 ? `إنفاق هذا الشهر أعلى بـ ${money(d)} من الشهر السابق.` : `أحسنت! وفّرت ${money(-d)} مقارنة بالشهر السابق.`); }
      if (!get('SELECT 1 AS x FROM price_watches WHERE user_id=?', actor.id)) tips.push('جرّب «تابع السعر» على منتج تشتريه باستمرار لتصلك رسالة عند انخفاضه.');
      const ecoOrders = get("SELECT COUNT(*) AS n FROM order_extras x JOIN orders o ON o.id=x.order_id WHERE o.user_id=? AND json_extract(x.data,'$.eco')=1", actor.id).n;
      return { status: 200, body: { orders: orders.length, spent: money(spent), saved: money(saved), avgBasket, monthly, byCategory, tips, green: { ecoOrders, co2SavedKg: Math.round(ecoOrders * CO2_PER_TRIP_KG * 10) / 10 } } };
    }
    // ---- trending / views / shares (F-G14-20, F-G14-22) ----
    if (method === 'POST' && (m = /^\/api\/products\/([\w-]+)\/event$/.exec(path))) {
      rate(req, 'product-event', 240, 60_000); productRow(m[1]);
      const kind = body.kind === 'share' ? 'shares' : 'views';
      run(`INSERT INTO product_stats(product_id,day,${kind}) VALUES(?,?,1) ON CONFLICT(product_id,day) DO UPDATE SET ${kind}=${kind}+1`, m[1], ammanDay());
      return { status: 200, body: { ok: true } };
    }
    if (method === 'GET' && path === '/api/trending') {
      const dayFrom = ammanDay(Date.now() - 7 * DAY), since = new Date(Date.now() - 7 * DAY).toISOString(), score = new Map();
      for (const v of all('SELECT product_id,SUM(views) AS v,SUM(shares) AS s FROM product_stats WHERE day>=? GROUP BY product_id', dayFrom)) score.set(v.product_id, { views: v.v, shares: v.s, ordered: 0 });
      for (const o of all("SELECT items FROM orders WHERE created_at>=? AND status!='cancelled'", since)) for (const l of parse(o.items, [])) { const s = score.get(l.productId) || { views: 0, shares: 0, ordered: 0 }; s.ordered += l.quantity; score.set(l.productId, s); }
      const ranked = [...score.entries()].map(([pid, s]) => ({ pid, s, score: s.views + s.shares * 5 + s.ordered * 10 })).sort((a, b) => b.score - a.score).slice(0, 20)
        .map(({ pid, s, score: sc }) => { const r = get('SELECT * FROM products WHERE id=? AND active=1', pid); return r ? { ...product(r), trend: { ...s, score: sc } } : null; }).filter(Boolean);
      return { status: 200, body: { since, products: ranked } };
    }
    // ---- smart lists + family mode (F-G14-10, F-G14-11) ----
    if (path === '/api/lists') {
      const actor = requireUser(req);
      if (method === 'GET') return { status: 200, body: { lists: all('SELECT l.* FROM lists l JOIN list_members m ON m.list_id=l.id WHERE m.user_id=? ORDER BY l.updated_at DESC', actor.id).map(listView) } };
      if (method === 'POST') {
        featureOff('lists');
        if (get('SELECT COUNT(*) AS n FROM lists WHERE owner_id=?', actor.id).n >= 30) fail(400, 'الحد الأقصى 30 قائمة');
        const lid = id('lst'), t = now(), family = body.family === true;
        transaction(() => { run('INSERT INTO lists VALUES(?,?,?,?,?,?,?,?)', lid, actor.id, text(body.name, 'اسم القائمة', 1, 60), body.budget == null || body.budget === '' ? null : money(number(body.budget, 'الميزانية', 0, 1e6)), family ? shareCode() : null, family ? 1 : 0, t, t); run('INSERT INTO list_members VALUES(?,?,?,?)', lid, actor.id, 'owner', t); });
        return { status: 201, body: { list: listView(get('SELECT * FROM lists WHERE id=?', lid)) } };
      }
    }
    if (method === 'POST' && path === '/api/lists/join') {
      const actor = requireUser(req); rate(req, 'list-join', 20);
      const l = get('SELECT * FROM lists WHERE share_code=? AND family=1', text(body.code, 'رمز المشاركة', 4, 20).toUpperCase().replace(/\s/g, ''));
      if (!l) fail(404, 'رمز المشاركة غير صحيح', 'not_found');
      if (get('SELECT COUNT(*) AS n FROM list_members WHERE list_id=?', l.id).n >= 12) fail(409, 'اكتمل عدد أفراد هذه القائمة (12)');
      run('INSERT INTO list_members VALUES(?,?,?,?) ON CONFLICT DO NOTHING', l.id, actor.id, 'member', now());
      if (l.owner_id !== actor.id) notify(l.owner_id, 'انضم فرد جديد للقائمة العائلية', `انضم ${actor.name} إلى «${l.name}»`);
      return { status: 200, body: { list: listView(l) } };
    }
    if ((m = /^\/api\/lists\/([\w-]+)$/.exec(path))) {
      const actor = requireUser(req);
      if (method === 'GET') return { status: 200, body: { list: listView(listAccess(actor, m[1])) } };
      if (method === 'PATCH') {
        const l = listAccess(actor, m[1], true);
        const name = body.name !== undefined ? text(body.name, 'اسم القائمة', 1, 60) : l.name;
        const budget = body.budget !== undefined ? (body.budget === null || body.budget === '' ? null : money(number(body.budget, 'الميزانية', 0, 1e6))) : l.budget;
        const family = body.family !== undefined ? (body.family ? 1 : 0) : l.family;
        run('UPDATE lists SET name=?,budget=?,family=?,share_code=?,updated_at=? WHERE id=?', name, budget, family, family ? l.share_code || shareCode() : null, now(), l.id);
        return { status: 200, body: { list: listView(get('SELECT * FROM lists WHERE id=?', l.id)) } };
      }
      if (method === 'DELETE') { const l = listAccess(actor, m[1]); if (l.owner_id === actor.id) run('DELETE FROM lists WHERE id=?', l.id); else run('DELETE FROM list_members WHERE list_id=? AND user_id=?', l.id, actor.id); return { status: 200, body: { ok: true } }; }
    }
    if (method === 'POST' && (m = /^\/api\/lists\/([\w-]+)\/items$/.exec(path))) {
      const actor = requireUser(req), l = listAccess(actor, m[1]);
      if (get('SELECT COUNT(*) AS n FROM list_items WHERE list_id=?', l.id).n >= 200) fail(400, 'الحد الأقصى 200 صنف في القائمة');
      let productId = null, title;
      if (body.productId) { const r = productRow(text(body.productId, 'المنتج', 1, 100)); productId = r.id; title = parse(r.data, {}).name; } else title = text(body.title, 'اسم الصنف', 1, 120);
      const iid = id('itm'); run('INSERT INTO list_items VALUES(?,?,?,?,?,0,?,?)', iid, l.id, productId, title, integer(body.quantity ?? 1, 'الكمية', 1, 999), actor.id, now()); run('UPDATE lists SET updated_at=? WHERE id=?', now(), l.id);
      return { status: 201, body: { list: listView(get('SELECT * FROM lists WHERE id=?', l.id)) } };
    }
    if ((m = /^\/api\/lists\/([\w-]+)\/items\/([\w-]+)$/.exec(path))) {
      const actor = requireUser(req), l = listAccess(actor, m[1]), item = get('SELECT * FROM list_items WHERE id=? AND list_id=?', m[2], l.id); if (!item) fail(404, 'الصنف غير موجود', 'not_found');
      if (method === 'PATCH') run('UPDATE list_items SET done=?,quantity=? WHERE id=?', body.done !== undefined ? (body.done ? 1 : 0) : item.done, body.quantity !== undefined ? integer(body.quantity, 'الكمية', 1, 999) : item.quantity, item.id);
      else if (method === 'DELETE') run('DELETE FROM list_items WHERE id=?', item.id); else fail(405, 'العملية غير مدعومة');
      run('UPDATE lists SET updated_at=? WHERE id=?', now(), l.id);
      return { status: 200, body: { list: listView(get('SELECT * FROM lists WHERE id=?', l.id)) } };
    }
    // ---- rewards: levels, badges, daily check-in, game (F-G14-23..25) ----
    if (method === 'GET' && path === '/api/rewards/profile') return { status: 200, body: rewardsProfile(requireUser(req)) };
    if (method === 'POST' && path === '/api/rewards/checkin') {
      const actor = requireUser(req), today = ammanDay(), yesterday = ammanDay(Date.now() - DAY);
      const result = transaction(() => {
        if (get('SELECT 1 AS x FROM checkins WHERE user_id=? AND day=?', actor.id, today)) fail(409, 'سجّلت حضورك اليوم بالفعل — عد غدًا', 'already_checked_in');
        const prev = get('SELECT streak FROM checkins WHERE user_id=? AND day=?', actor.id, yesterday);
        const streak = prev ? prev.streak + 1 : 1, points = checkinPoints(streak);
        run('INSERT INTO checkins VALUES(?,?,?,?)', actor.id, today, streak, points);
        rewardLedger(actor.id, points, 'earned', `تسجيل يومي — اليوم ${streak} على التوالي`, null, null, `checkin:${actor.id}:${today}`);
        return { streak, points };
      });
      return { status: 200, body: { ...result, profile: rewardsProfile(actor) } };
    }
    if (method === 'POST' && path === '/api/rewards/game') {
      featureOff('game');
      const actor = requireUser(req), today = ammanDay();
      const moves = integer(body.moves, 'عدد المحاولات', 1, 500), seconds = integer(body.seconds, 'المدة', 1, 3600), pairs = integer(body.pairs ?? 6, 'عدد الأزواج', 6, 6);
      if (moves < pairs || seconds < 8) fail(400, 'نتيجة اللعبة غير منطقية', 'implausible_result');
      const result = transaction(() => {
        if (get('SELECT 1 AS x FROM game_awards WHERE user_id=? AND day=?', actor.id, today)) fail(409, 'حصلت على جائزة اللعبة اليوم — يمكنك اللعب للمتعة', 'already_awarded');
        run('INSERT INTO game_awards VALUES(?,?,?,?)', actor.id, today, moves, seconds);
        rewardLedger(actor.id, GAME_POINTS, 'earned', 'الفوز في لعبة الذاكرة', null, null, `game:${actor.id}:${today}`);
        return { points: GAME_POINTS };
      });
      return { status: 200, body: { ...result, profile: rewardsProfile(actor) } };
    }
    // ---- coupon wallet: public coupons (F-G14-26) ----
    if (method === 'GET' && path === '/api/coupons/public') return { status: 200, body: { coupons: all("SELECT * FROM coupons WHERE active=1 AND public=1 AND (expires_at IS NULL OR expires_at>?) AND (max_uses IS NULL OR uses<max_uses) ORDER BY expires_at IS NULL, expires_at", now()).map((c) => ({ code: c.code, title: c.title, type: c.type, value: c.value, minSubtotal: c.min_subtotal, expiresAt: c.expires_at })) } };
    if (method === 'PATCH' && (m = /^\/api\/admin\/coupon-visibility\/([\w-]+)$/.exec(path))) { const actor = admin(req, 'catalog:write'); const c = get('SELECT * FROM coupons WHERE id=?', m[1]); if (!c) fail(404, 'الكوبون غير موجود', 'not_found'); run('UPDATE coupons SET public=?,title=? WHERE id=?', body.public ? 1 : 0, body.title == null ? c.title : text(body.title, 'عنوان الكوبون', 2, 80), c.id); audit(actor, 'coupon.public', c.id, { public: !!body.public }); return { status: 200, body: { ok: true } }; }
    // ---- shoppable videos + stories (F-G14-18, F-G14-19) ----
    if (method === 'GET' && path === '/api/media') {
      if (!flagOn('reels')) return { status: 200, body: { posts: [], disabled: true } };
      const url = new URL(req.url, 'http://x'), kind = url.searchParams.get('kind') === 'story' ? 'story' : 'video', user = optionalUser(req);
      return { status: 200, body: { posts: all('SELECT * FROM media_posts WHERE kind=? AND active=1 AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 50', kind, now()).map((x) => mediaView(x, user?.id)) } };
    }
    if (method === 'POST' && (m = /^\/api\/media\/([\w-]+)\/(like|view)$/.exec(path))) {
      const post = get('SELECT * FROM media_posts WHERE id=? AND active=1', m[1]); if (!post) fail(404, 'المنشور غير موجود', 'not_found');
      if (m[2] === 'view') { rate(req, 'media-view', 300, 60_000); run('UPDATE media_posts SET views=views+1 WHERE id=?', post.id); return { status: 200, body: { ok: true } }; }
      const actor = requireUser(req);
      transaction(() => { if (get('SELECT 1 AS x FROM media_likes WHERE post_id=? AND user_id=?', post.id, actor.id)) { run('DELETE FROM media_likes WHERE post_id=? AND user_id=?', post.id, actor.id); run('UPDATE media_posts SET likes=MAX(0,likes-1) WHERE id=?', post.id); } else { run('INSERT INTO media_likes VALUES(?,?)', post.id, actor.id); run('UPDATE media_posts SET likes=likes+1 WHERE id=?', post.id); } });
      return { status: 200, body: { post: mediaView(get('SELECT * FROM media_posts WHERE id=?', post.id), actor.id) } };
    }
    if (path === '/api/admin/media' || (m = /^\/api\/admin\/media\/([\w-]+)$/.exec(path))) {
      const actor = admin(req, 'catalog:write');
      if (method === 'GET' && path === '/api/admin/media') return { status: 200, body: { posts: all('SELECT * FROM media_posts ORDER BY created_at DESC LIMIT 200').map((x) => mediaView(x)) } };
      if (method === 'POST' && path === '/api/admin/media') {
        const pid = body.productId ? productRow(text(body.productId, 'المنتج', 1, 100)).id : null, mid = id('med');
        const kind = body.kind === 'story' ? 'story' : 'video';
        const mediaUrl = httpsUrl(body.mediaUrl, 'رابط الوسائط');
        if (kind === 'video' && !/\.(mp4|webm|m3u8)(\?|$)/i.test(mediaUrl)) fail(400, 'رابط الفيديو يجب أن يكون ملف mp4 أو webm أو m3u8');
        run('INSERT INTO media_posts VALUES(?,?,?,?,?,?,1,0,0,?,?)', mid, kind, text(body.title, 'العنوان', 2, 120), mediaUrl, httpsUrl(body.posterUrl, 'صورة الغلاف', false), pid, isoOrNull(body.expiresAt, 'تاريخ الانتهاء') || (kind === 'story' ? new Date(Date.now() + DAY).toISOString() : null), now());
        audit(actor, 'media.create', mid); return { status: 201, body: { post: mediaView(get('SELECT * FROM media_posts WHERE id=?', mid)) } };
      }
      if (m) { const post = get('SELECT * FROM media_posts WHERE id=?', m[1]); if (!post) fail(404, 'المنشور غير موجود', 'not_found');
        if (method === 'PATCH') { run('UPDATE media_posts SET active=?,title=? WHERE id=?', body.active === undefined ? post.active : body.active ? 1 : 0, body.title === undefined ? post.title : text(body.title, 'العنوان', 2, 120), post.id); audit(actor, 'media.update', post.id); return { status: 200, body: { post: mediaView(get('SELECT * FROM media_posts WHERE id=?', post.id)) } }; }
        if (method === 'DELETE') { run('DELETE FROM media_posts WHERE id=?', post.id); audit(actor, 'media.delete', post.id); return { status: 200, body: { ok: true } }; } }
    }
    // ---- campaigns / promo banners (F-G14-35) ----
    if (method === 'GET' && path === '/api/campaigns') return { status: 200, body: { campaigns: all('SELECT * FROM campaigns WHERE active=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) ORDER BY created_at DESC LIMIT 10', now(), now()).map(campaignView) } };
    if (path === '/api/campaigns/manage' || (m = /^\/api\/campaigns\/manage\/([\w-]+)$/.exec(path))) {
      const actor = identity(req), merchant = actor.kind === 'user' ? merchantOf(actor) : null;
      const isAdmin = actor.kind === 'user' && actor.role === 'admin' || actor.kind === 'agent' && actor.scopes.includes('catalog:write');
      if (!isAdmin && merchant?.status !== 'approved') fail(403, 'ليس لديك الإذن لهذه العملية', 'forbidden');
      if (method === 'GET' && path === '/api/campaigns/manage') return { status: 200, body: { campaigns: all(isAdmin ? 'SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 200' : 'SELECT * FROM campaigns WHERE created_by=? ORDER BY created_at DESC', ...(isAdmin ? [] : [actor.id])).map(campaignView) } };
      if (method === 'POST' && path === '/api/campaigns/manage') {
        const pidIn = body.productId ? text(body.productId, 'المنتج', 1, 100) : null, prow = pidIn ? get('SELECT * FROM products WHERE id=?', pidIn) : null;
        if (pidIn && !prow) fail(404, 'المنتج غير موجود', 'not_found');
        const pid = prow?.id || null;
        if (pid && !isAdmin && parse(get('SELECT data FROM products WHERE id=?', pid).data, {}).merchantId !== actor.id) fail(403, 'يمكن للتاجر الترويج لمنتجاته فقط', 'forbidden');
        const cid = id('cmp'); run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?,?)', cid, text(body.title, 'عنوان الحملة', 2, 80), body.subtitle ? text(body.subtitle, 'وصف الحملة', 2, 160) : null, httpsUrl(body.image, 'صورة الحملة', false), pid, body.category ? text(body.category, 'القسم', 1, 80) : null, isoOrNull(body.startsAt, 'بداية الحملة'), isoOrNull(body.endsAt, 'نهاية الحملة'), isAdmin ? 1 : 0, actor.id, now());
        audit(actor, 'campaign.create', cid); return { status: 201, body: { campaign: campaignView(get('SELECT * FROM campaigns WHERE id=?', cid)), pendingApproval: !isAdmin } };
      }
      if (m) { const c = get('SELECT * FROM campaigns WHERE id=?', m[1]); if (!c || (!isAdmin && c.created_by !== actor.id)) fail(404, 'الحملة غير موجودة', 'not_found');
        if (method === 'PATCH') { if (body.active !== undefined && !isAdmin) fail(403, 'تفعيل الحملات من صلاحية الإدارة', 'forbidden'); run('UPDATE campaigns SET active=?,ends_at=? WHERE id=?', body.active === undefined ? c.active : body.active ? 1 : 0, body.endsAt === undefined ? c.ends_at : isoOrNull(body.endsAt, 'نهاية الحملة'), c.id); audit(actor, 'campaign.update', c.id); return { status: 200, body: { campaign: campaignView(get('SELECT * FROM campaigns WHERE id=?', c.id)) } }; }
        if (method === 'DELETE') { run('DELETE FROM campaigns WHERE id=?', c.id); audit(actor, 'campaign.delete', c.id); return { status: 200, body: { ok: true } }; } }
    }
    // ---- receipts (F-G14-14) ----
    if (path === '/api/receipts') {
      const actor = requireUser(req);
      if (method === 'GET') return { status: 200, body: { receipts: all('SELECT * FROM receipts WHERE user_id=? ORDER BY created_at DESC LIMIT 100', actor.id).map((r) => ({ id: r.id, store: r.store, total: r.total, items: parse(r.items, []), createdAt: r.created_at })) } };
      if (method === 'POST') {
        const items = Array.isArray(body.items) ? body.items.slice(0, 150).map((x, i) => ({ name: text(x.name, `اسم الصنف ${i + 1}`, 1, 120), price: money(number(x.price, `سعر الصنف ${i + 1}`, 0, 1e6)), quantity: integer(x.quantity ?? 1, 'الكمية', 1, 999) })) : [];
        if (!items.length) fail(400, 'لا توجد أصناف في الفاتورة');
        const total = body.total != null ? money(number(body.total, 'الإجمالي', 0, 1e7)) : money(items.reduce((a, x) => a + x.price * x.quantity, 0));
        const rid = id('rcp'); run('INSERT INTO receipts VALUES(?,?,?,?,?,?)', rid, actor.id, body.store ? text(body.store, 'اسم المتجر', 1, 80) : null, total, json(items), now());
        const catalog = catalogLite();
        const matches = items.map((x) => { const words = x.name.split(/\s+/).filter((w) => w.length > 2); const hit = catalog.find((c) => words.some((w) => c.name.includes(w))); return hit ? { name: x.name, theirPrice: x.price, ourProductId: hit.id, ourName: hit.name, ourPrice: hit.price, saving: money(x.price - hit.price) } : null; }).filter(Boolean);
        return { status: 201, body: { id: rid, total, items, matches } };
      }
    }
    if (method === 'DELETE' && (m = /^\/api\/receipts\/([\w-]+)$/.exec(path))) { const actor = requireUser(req); run('DELETE FROM receipts WHERE id=? AND user_id=?', m[1], actor.id); return { status: 200, body: { ok: true } }; }
    // ---- AI (vision search, receipt OCR, nutrition, voice) — server-side key only (F-G14-12/14/15/16) ----
    if (method === 'GET' && path === '/api/ai/status') return { status: 200, body: { enabled: flagOn('ai'), configured: !!aiKey, provider: aiKey ? 'gemini' : null, model: aiKey ? aiModel : null } };
    if (method === 'POST' && path === '/api/ai/vision') {
      featureOff('ai'); requireUser(req); rate(req, 'ai-vision', 30); requireAi();
      const task = ['products', 'receipt', 'nutrition'].includes(body.task) ? body.task : 'products', img = dataUrl(body.image, 'الصورة', 4_000_000);
      const prompts = {
        products: 'Identify the main purchasable product(s) in this photo. Reply JSON {"labels":[short Arabic product names],"keywords":[Arabic and English search keywords],"category":string}.',
        receipt: 'Read this shop receipt. Reply JSON {"store":string|null,"items":[{"name":string,"price":number,"quantity":number}],"total":number|null}. Prices as numbers, no currency.',
        nutrition: 'Estimate nutrition for the food in this photo per typical serving. Reply JSON {"food":Arabic name,"serving":string,"calories":number,"protein":number,"carbs":number,"fat":number,"sugar":number,"confidence":0..1}.',
      };
      const out = await geminiJson({ key: aiKey, model: aiModel, fetcher: aiFetch, parts: [{ text: prompts[task] }, { inline_data: { mime_type: img.mimeType, data: img.data } }] });
      if (task === 'products') {
        const words = [...(out.labels || []), ...(out.keywords || [])].filter((w) => typeof w === 'string').slice(0, 12);
        const catalog = catalogLite(), hits = catalog.map((c) => ({ c, score: words.reduce((s, w) => s + (c.name.includes(w) || (c.tags || []).some((t) => t.includes(w)) ? 2 : 0) + (c.category === out.category ? 1 : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map((x) => x.c);
        return { status: 200, body: { task, labels: out.labels || [], keywords: words, products: hits } };
      }
      return { status: 200, body: { task, result: out } };
    }
    if (method === 'POST' && path === '/api/ai/transcribe') {
      featureOff('ai'); requireUser(req); rate(req, 'ai-voice', 40); requireAi();
      const audio = dataUrl(body.audio, 'التسجيل الصوتي', 2_000_000);
      const out = await geminiJson({ key: aiKey, model: aiModel, fetcher: aiFetch, parts: [{ text: 'Transcribe this short shopping voice query (Arabic or English). Reply JSON {"text":string}.' }, { inline_data: { mime_type: audio.mimeType, data: audio.data } }] });
      return { status: 200, body: { text: typeof out.text === 'string' ? out.text.slice(0, 200) : '' } };
    }
    if (method === 'POST' && path === '/api/ai/campaign-copy') {
      const actor = identity(req); if (!(actor.kind === 'user' && (actor.role === 'admin' || merchantOf(actor)?.status === 'approved'))) fail(403, 'ليس لديك الإذن لهذه العملية', 'forbidden');
      rate(req, 'ai-copy', 30); requireAi();
      const out = await geminiJson({ key: aiKey, model: aiModel, fetcher: aiFetch, parts: [{ text: `اكتب عنوانًا تسويقيًا قصيرًا ووصفًا من جملة واحدة لحملة متجر لُقطة عن: ${text(body.brief, 'فكرة الحملة', 3, 300)}. أجب JSON {"title":string,"subtitle":string}` }] });
      return { status: 200, body: { title: String(out.title || '').slice(0, 80), subtitle: String(out.subtitle || '').slice(0, 160) } };
    }
    // ---- merchant portal (F-G14-33) ----
    if (method === 'POST' && path === '/api/merchant/apply') {
      featureOff('merchant'); const actor = requireUser(req); if (merchantOf(actor)) fail(409, 'لديك طلب تاجر مسجل بالفعل');
      run('INSERT INTO merchants VALUES(?,?,?,?,?,?)', actor.id, text(body.storeName, 'اسم المتجر', 2, 80), body.phone ? text(body.phone, 'الهاتف', 7, 20) : null, 'pending', now(), now());
      for (const a of all("SELECT id FROM users WHERE role='admin'")) notify(a.id, 'طلب تاجر جديد', `طلب ${actor.name} الانضمام كتاجر`);
      return { status: 201, body: { merchant: { status: 'pending' } } };
    }
    if (method === 'GET' && path === '/api/merchant/me') {
      const actor = requireUser(req), mer = merchantOf(actor);
      if (!mer) return { status: 200, body: { merchant: null } };
      const mine = all("SELECT * FROM products WHERE json_extract(data,'$.merchantId')=? ORDER BY updated_at DESC", actor.id).map(product), ids = new Set(mine.map((x) => x.id));
      let revenue = 0, units = 0; for (const o of all("SELECT items FROM orders WHERE status='delivered'")) for (const l of parse(o.items, [])) if (ids.has(l.productId)) { revenue += l.price * l.quantity; units += l.quantity; }
      return { status: 200, body: { merchant: { storeName: mer.store_name, status: mer.status, createdAt: mer.created_at }, products: mine, sales: { revenue: money(revenue), units } } };
    }
    if ((path === '/api/merchant/products' && method === 'POST') || ((m = /^\/api\/merchant\/products\/([\w-]+)$/.exec(path)) && method === 'PATCH')) {
      const actor = requireUser(req), mer = merchantOf(actor); if (mer?.status !== 'approved') fail(403, 'حساب التاجر غير مفعّل بعد', 'forbidden');
      const allowed = ['name', 'price', 'oldPrice', 'description', 'category', 'image', 'images', 'barcode', 'offerEndsAt', 'nutrition', 'expiresAt', 'unit'];
      const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
      if (path === '/api/merchant/products') {
        const pid = id('prd'), data = ctx.validateProduct({ ...patch, id: pid, merchantId: actor.id, brand: mer.store_name });
        run('INSERT INTO products VALUES(?,?,?,0,?)', pid, json(data), integer(body.stock ?? 0, 'المخزون', 0, 1e6), now());
        for (const a of all("SELECT id FROM users WHERE role='admin'")) notify(a.id, 'منتج تاجر بانتظار المراجعة', `${mer.store_name}: ${data.name}`);
        audit(actor, 'merchant.product.create', pid); return { status: 201, body: { product: product(get('SELECT * FROM products WHERE id=?', pid)), pendingReview: true } };
      }
      const old = get('SELECT * FROM products WHERE id=?', m[1]); if (!old || parse(old.data, {}).merchantId !== actor.id) fail(404, 'المنتج غير موجود', 'not_found');
      const data = ctx.validateProduct({ ...patch, id: old.id }, parse(old.data, {}));
      run('UPDATE products SET data=?,stock=?,updated_at=? WHERE id=?', json(data), body.stock !== undefined ? integer(body.stock, 'المخزون', 0, 1e6) : old.stock, now(), old.id);
      audit(actor, 'merchant.product.update', old.id); return { status: 200, body: { product: product(get('SELECT * FROM products WHERE id=?', old.id)) } };
    }
    if (method === 'GET' && path === '/api/admin/merchants') { admin(req); return { status: 200, body: { merchants: all('SELECT m.*,u.name,u.email FROM merchants m JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC').map((x) => ({ userId: x.user_id, name: x.name, email: x.email, storeName: x.store_name, phone: x.phone, status: x.status, createdAt: x.created_at, products: get("SELECT COUNT(*) AS n FROM products WHERE json_extract(data,'$.merchantId')=?", x.user_id).n })) } }; }
    if (method === 'PATCH' && (m = /^\/api\/admin\/merchants\/([\w-]+)$/.exec(path))) {
      const actor = admin(req); const status = ['pending', 'approved', 'suspended'].includes(body.status) ? body.status : fail(400, 'حالة التاجر غير صالحة');
      const mer = get('SELECT * FROM merchants WHERE user_id=?', m[1]); if (!mer) fail(404, 'التاجر غير موجود', 'not_found');
      transaction(() => { run('UPDATE merchants SET status=?,updated_at=? WHERE user_id=?', status, now(), mer.user_id); if (status === 'suspended') run("UPDATE products SET active=0,updated_at=? WHERE json_extract(data,'$.merchantId')=?", now(), mer.user_id); notify(mer.user_id, 'تحديث حساب التاجر', status === 'approved' ? 'تمت الموافقة على حسابك كتاجر في لُقطة' : status === 'suspended' ? 'تم إيقاف حساب التاجر مؤقتًا' : 'طلبك قيد المراجعة'); audit(actor, 'merchant.status', mer.user_id, { status }); });
      return { status: 200, body: { ok: true, status } };
    }
    return undefined;
  }

  /** Extra checkout data (bundle applied, eco delivery). */
  const saveOrderExtras = (orderId, data) => run('INSERT INTO order_extras VALUES(?,?) ON CONFLICT(order_id) DO UPDATE SET data=excluded.data', orderId, json(data));
  const orderExtras = (orderId) => parse(get('SELECT data FROM order_extras WHERE order_id=?', orderId)?.data, null);
  /** +10 points for choosing consolidated (eco) delivery, granted once on delivery. */
  const onDelivered = (o) => {
    const x = orderExtras(o.id);
    if (x?.eco && !get('SELECT 1 AS x FROM reward_ledger WHERE request_key=?', `eco:${o.id}`)) rewardLedger(o.user_id, 10, 'earned', `مكافأة التوصيل الصديق للبيئة ${o.id}`, null, null, `eco:${o.id}`);
  };
  return { handle, bundleFor, saveOrderExtras, orderExtras, onDelivered, validateBundles: (v) => validateBundles(v, text, number, integer, fail) };
}
