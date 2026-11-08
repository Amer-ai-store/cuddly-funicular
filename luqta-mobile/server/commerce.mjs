import http from 'node:http';
import { createJawafaBridge } from './jawafaBridge.mjs';
import { prepareJawafaSnapshot } from './jawafaInventory.mjs';
import { installModules } from './modules/index.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync, createReadStream } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const scrypt = promisify(scryptCallback);
const HERE = dirname(fileURLToPath(import.meta.url));
const SCOPES = ['catalog:write', 'inventory:write', 'orders:write', 'settings:write', 'jobs:write'];
const STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const id = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value);
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
const fail = (status, message, code = 'invalid_request') => { const error = new Error(message); error.status = status; error.code = code; throw error; };
const text = (value, field, min = 1, max = 500) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `قيمة ${field} غير صالحة`);
  return value.trim();
};
const number = (value, field, min = 0, max = 1e8) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, `قيمة ${field} غير صالحة`);
  return value;
};
const integer = (value, field, min = 0, max = 1e8) => { const n = number(value, field, min, max); if (!Number.isInteger(n)) fail(400, `قيمة ${field} يجب أن تكون عددًا صحيحًا`); return n; };
const email = (value) => { const v = text(value, 'البريد الإلكتروني', 3, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400, 'البريد الإلكتروني غير صالح'); return v; };
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.created_at });
const date = (value, field) => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, `قيمة ${field} غير صالحة`); return new Date(value).toISOString(); };
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) fail(400, 'كلمة المرور يجب أن تتكون من 10 أحرف على الأقل');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function passwordValid(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [, salt, expected] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return actual.length === Buffer.from(expected, 'hex').length && timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function validateAddress(body) {
  const address = { name: text(body.name, 'اسم المستلم', 2, 100), phone: text(body.phone, 'الهاتف', 6, 30), city: text(body.city, 'المدينة', 2, 100), street: text(body.street, 'العنوان', 4, 500) };
  if (!/^[+\d\s()\-٠-٩۰-۹]+$/.test(address.phone)) fail(400, 'رقم الهاتف غير صالح');
  if (body.latitude != null || body.longitude != null) {
    address.latitude = number(body.latitude, 'خط العرض', -90, 90);
    address.longitude = number(body.longitude, 'خط الطول', -180, 180);
  }
  if (body.label !== undefined) address.label = text(body.label, 'اسم العنوان', 1, 80);
  for (const [key, label, max] of [['district', 'الحي', 100], ['building', 'رقم المبنى', 60], ['details', 'تفاصيل العنوان', 300]]) if (body[key] != null && body[key] !== '') address[key] = text(body[key], label, 1, max);
  address.isDefault = body.isDefault === true;
  return address;
}
function csvRows(source) {
  if (typeof source !== 'string' || source.length > 1_500_000) fail(400, 'ملف CSV غير صالح أو كبير جدًا');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && source[i + 1] === '\n') i++; row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) fail(400, 'علامات الاقتباس في CSV غير مكتملة');
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  const headers = rows.shift()?.map((v) => v.trim().replace(/^\uFEFF/, ''));
  if (!headers?.length || new Set(headers).size !== headers.length) fail(400, 'عناوين أعمدة CSV غير صالحة');
  return rows.map((r) => {
    if (r.length !== headers.length) fail(400, 'عدد أعمدة CSV غير متطابق');
    const item = Object.fromEntries(headers.map((h, i) => [h, r[i].trim()]));
    for (const key of ['price', 'stock', 'quantity']) if (item[key] !== undefined && item[key] !== '') item[key] = Number(item[key]);
    return item;
  });
}
function privateAddress(address) {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('::ffff:');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224 || a === 192 && b === 0 || a === 198 && (b === 18 || b === 19);
}
async function externalUrl(value) {
  let url; try { url = new URL(value); } catch { fail(400, 'عنوان خادم المخزون غير صالح'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || url.hash) fail(400, 'يجب استخدام رابط HTTPS عام دون بيانات دخول في الرابط');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) fail(400, 'لا يسمح بعناوين الشبكة الداخلية');
  let addresses;
  try { addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }); } catch { fail(400, 'تعذر الوصول إلى اسم خادم المخزون'); }
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) fail(400, 'لا يسمح بعناوين الشبكة الداخلية');
  return url;
}

export async function createCommerceServer(options = {}) {
  const dbPath = options.dbPath || process.env.COMMERCE_DB || resolve(HERE, 'data/commerce.sqlite');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','driver')),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,data TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0),active INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_imports(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,mode TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,undone_at TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS addresses(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coupons(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,type TEXT NOT NULL,value REAL NOT NULL,min_subtotal REAL NOT NULL,max_uses INTEGER,uses INTEGER NOT NULL DEFAULT 0,expires_at TEXT,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),items TEXT NOT NULL,address TEXT NOT NULL,subtotal REAL NOT NULL,discount REAL NOT NULL,shipping REAL NOT NULL,total REAL NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,payment_method TEXT NOT NULL,payment_status TEXT NOT NULL,driver_id TEXT REFERENCES users(id),coupon_id TEXT REFERENCES coupons(id),idempotency_key TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS order_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS locations(order_id TEXT PRIMARY KEY REFERENCES orders(id),latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy REAL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),amount REAL NOT NULL,type TEXT NOT NULL,note TEXT NOT NULL,order_id TEXT REFERENCES orders(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reward_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),points INTEGER NOT NULL CHECK(points<>0),type TEXT NOT NULL CHECK(type IN ('earned','redeemed','reversed','settled')),note TEXT NOT NULL,order_id TEXT REFERENCES orders(id),wallet_entry_id TEXT REFERENCES wallet(id),request_key TEXT,created_at TEXT NOT NULL,UNIQUE(order_id,type),UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT PRIMARY KEY REFERENCES users(id),code_hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS returns(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,order_id TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,product_id));
    CREATE TABLE IF NOT EXISTS wishlists(user_id TEXT PRIMARY KEY REFERENCES users(id),product_ids TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_keys(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,scopes TEXT NOT NULL,expires_at TEXT,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,last_used_at TEXT);
    CREATE TABLE IF NOT EXISTS agent_jobs(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL DEFAULT '',test_evidence TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,return_url TEXT);
    CREATE TABLE IF NOT EXISTS facebook_links(user_id TEXT PRIMARY KEY REFERENCES users(id),facebook_id TEXT NOT NULL,name TEXT NOT NULL,token TEXT NOT NULL,permissions TEXT NOT NULL,linked_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ticket_replies(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),user_id TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
  if (dbPath !== ':memory:') { try { chmodSync(dbPath, 0o600); } catch {} }
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const setting = (key, fallback = null) => parse(get('SELECT value FROM settings WHERE key=?', key)?.value, fallback);
  const setSetting = (key, value) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, json(value));
  const defaults = { storeName: 'لُقطة', currency: process.env.STORE_CURRENCY || 'JOD', country: process.env.STORE_COUNTRY || 'JO', shippingFee: 2.5, freeShippingThreshold: 30, returnsDays: 14, storefront: { accentColor: '#FF6B4A', heroTitle: 'لُقطات تستحق أن تكون لك', heroSubtitle: 'اكتشف منتجات تُشبه ذوقك', showAssistant: true }, ...options.config };
  for (const [key, value] of Object.entries(defaults)) if (!get('SELECT key FROM settings WHERE key=?', key)) setSetting(key, value);
  const publicSettings = () => ({ ...Object.fromEntries(['storeName', 'currency', 'country', 'shippingFee', 'freeShippingThreshold', 'returnsDays', 'storefront'].map((key) => [key, setting(key)])), ...(ext ? ext.publicSettings() : {}) });
  let encryptionKey;
  const secretPath = options.secretPath || (dbPath === ':memory:' ? null : resolve(dirname(dbPath), 'encryption.key'));
  if (secretPath) {
    if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    encryptionKey = readFileSync(secretPath);
    if (encryptionKey.length !== 32) throw new Error('Invalid commerce encryption key');
  } else encryptionKey = randomBytes(32);
  const encrypt = (value) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); return [iv.toString('hex'), Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex'), cipher.getAuthTag().toString('hex')].join(':'); };
  const decrypt = (value) => { const [iv, data, tag] = value.split(':'); const cipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'hex')); cipher.setAuthTag(Buffer.from(tag, 'hex')); return Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString(); };
  if (options.seedDemoProducts !== false && process.env.NODE_ENV !== 'production' && !get('SELECT id FROM products LIMIT 1')) {
    const catalog = JSON.parse(readFileSync(resolve(HERE, 'catalog.json'), 'utf8'));
    transaction(() => { for (const { stock, ...p } of catalog) run('INSERT INTO products(id,data,stock,active,updated_at) VALUES(?,?,?,1,?)', p.id, json({ sku: p.id, subtitle: '', brand: 'لُقطة', features: [], colors: [], ...p }), Number.isInteger(stock) ? stock : 25, now()); });
  }
  const bootstrap = options.bootstrapAdmin || (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD ? { name: process.env.ADMIN_NAME || 'مدير المتجر', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } : null);
  if (bootstrap && !get("SELECT id FROM users WHERE role='admin' LIMIT 1")) {
    const em = email(bootstrap.email);
    if (get('SELECT id FROM users WHERE email=?', em)) throw new Error('Bootstrap administrator email belongs to an existing user; refusing to elevate it');
    run('INSERT INTO users VALUES(?,?,?,?,?,?)', id('usr'), text(bootstrap.name || 'مدير المتجر', 'الاسم', 2, 100), em, await passwordHash(bootstrap.password), 'admin', now());
  }
  let ext = null;
  const audit = (actor, action, entityId, detail = {}) => run('INSERT INTO audit VALUES(?,?,?,?,?,?)', id('aud'), actor.id, action, entityId || '', json(detail), now());
  const notify = (userId, title, body, orderId = null) => run('INSERT INTO notifications VALUES(?,?,?,?,0,?,?)', id('ntf'), userId, title, body, orderId, now());
  const balance = (userId) => money(get('SELECT COALESCE(SUM(amount),0) AS balance FROM wallet WHERE user_id=?', userId).balance);
  const ledger = (userId, amount, type, note, orderId = null) => { const entry = { id: id('txn'), userId, amount: money(amount), type, note, orderId, date: now() }; run('INSERT INTO wallet VALUES(?,?,?,?,?,?,?)', entry.id, userId, entry.amount, type, note, orderId, entry.date); return entry; };
  const rewardBalance = (userId) => get('SELECT COALESCE(SUM(points),0) AS balance FROM reward_ledger WHERE user_id=?', userId).balance;
  const rewardLedger = (userId, points, type, note, orderId = null, walletEntryId = null, requestKey = null) => {
    if (!Number.isInteger(points) || points === 0) throw new Error('Reward points must be a nonzero integer');
    const entry = { id: id('rwd'), userId, points, type, note, orderId, walletEntryId, requestKey, date: now() };
    run('INSERT INTO reward_ledger VALUES(?,?,?,?,?,?,?,?,?)', entry.id, userId, points, type, note, orderId, walletEntryId, requestKey, entry.date);
    return entry;
  };
  const earnOrderReward = (o) => {
    const points = Math.floor(Math.max(0, money(o.subtotal - o.discount)));
    if (!points || get("SELECT id FROM reward_ledger WHERE order_id=? AND type='earned'", o.id)) return;
    rewardLedger(o.user_id, points, 'earned', `مكافأة طلب ${o.id}`, o.id);
    notify(o.user_id, 'نقاط مكافآت جديدة', `أضيفت ${points} نقطة بعد التسليم`, o.id);
  };
  const issueRecoveryCode = (userId) => {
    const code = randomBytes(24).toString('base64url');
    run('INSERT INTO recovery_codes VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=excluded.created_at', userId, hash(code), now());
    return code;
  };
  transaction(() => {
    for (const delivered of all("SELECT o.* FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='delivered' AND u.email NOT LIKE 'deleted+%@invalid.local' AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id=o.id AND r.status='approved')")) earnOrderReward(delivered);
  });
  const activeVariants = (parentId) => all("SELECT * FROM products WHERE active=1 AND json_extract(data,'$.variantOf')=? ORDER BY id", parentId);
  const product = (p) => {
    const aggregate = get('SELECT AVG(rating) AS rating,COUNT(*) AS count FROM reviews WHERE product_id=?', p.id);
    const data = parse(p.data, {});
    const variants = data.variantOf ? [] : activeVariants(p.id);
    const item = { ...data, id: p.id, price: variants.length ? Math.min(...variants.map((item) => parse(item.data).price)) : data.price,
      stock: variants.length ? variants.reduce((sum, item) => sum + item.stock, 0) : p.stock,
      basePrice: data.price, baseStock: p.stock, hasVariants: variants.length > 0,
      active: !!p.active, rating: aggregate.count ? money(aggregate.rating) : 0, reviews: aggregate.count, updatedAt: p.updated_at };
    return ext ? ext.decorateProduct(item, p) : item;
  };
  const order = (o) => ({ id: o.id, userId: o.user_id, date: o.created_at, createdAt: o.created_at, updatedAt: o.updated_at, status: o.status, items: parse(o.items, []), address: parse(o.address, {}), subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, currency: o.currency, paymentMethod: o.payment_method, paymentStatus: o.payment_status, driverId: o.driver_id, events: all('SELECT status,note,created_at AS at FROM order_events WHERE order_id=? ORDER BY created_at,id', o.id), extras: ext ? ext.orderExtras(o) : null });
  const coupon = (c) => ({ id: c.id, code: c.code, type: c.type, value: c.value, minSubtotal: c.min_subtotal, maxUses: c.max_uses, uses: c.uses, expiresAt: c.expires_at, active: !!c.active });
  const returnItem = (r) => ({ id: r.id, orderId: r.order_id, userId: r.user_id, reason: r.reason, status: r.status, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at });
  const ticketItem = (t) => ({ id: t.id, userId: t.user_id, subject: t.subject, message: t.message, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at, replies: all('SELECT r.id,r.user_id AS userId,u.name,r.message,r.created_at AS createdAt FROM ticket_replies r JOIN users u ON u.id=r.user_id WHERE r.ticket_id=? ORDER BY r.created_at,r.id', t.id) });
  const jobItem = (j) => ({ id: j.id, title: j.title, description: j.description, type: j.type, status: j.status, result: j.result, testEvidence: j.test_evidence, createdAt: j.created_at, updatedAt: j.updated_at });
  const session = (user, req = null, body = {}) => { const token = randomBytes(32).toString('base64url'); run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, new Date(Date.now() + 30 * 86400_000).toISOString()); ext?.emit('session', hash(token), user, req, body); return { token, user: publicUser(user) }; };
  const identity = (req) => {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length > 1000) fail(401, 'يرجى تسجيل الدخول', 'unauthorized');
    const token = authorization.slice(7);
    const user = get('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?', hash(token), now());
    if (user) { ext?.emit('sessionSeen', hash(token)); return { ...user, kind: 'user', tokenHash: hash(token) }; }
    const key = get('SELECT * FROM agent_keys WHERE token_hash=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?)', hash(token), now());
    if (key) { run('UPDATE agent_keys SET last_used_at=? WHERE id=?', now(), key.id); return { id: key.id, name: key.name, kind: 'agent', scopes: parse(key.scopes, []) }; }
    fail(401, 'انتهت الجلسة أو رمز الوصول غير صالح', 'unauthorized');
  };
  const requireUser = (req) => { const actor = identity(req); if (actor.kind !== 'user') fail(403, 'هذه العملية تتطلب حساب مستخدم', 'forbidden'); return actor; };
  const admin = (req, scope = null) => {
    const actor = identity(req);
    if (actor.kind === 'user' && actor.role === 'admin') { if (ext && ext.mfaRequired(actor)) fail(403, 'أدخل رمز التحقق بخطوتين لإكمال عمليات الإدارة', 'mfa_required'); return actor; }
    if (actor.kind === 'agent' && scope && actor.scopes.includes(scope)) return actor;
    fail(403, 'ليس لديك الإذن لهذه العملية', 'forbidden');
  };
  const ownOrder = (actor, orderId, allowDriver = false) => { const o = get('SELECT * FROM orders WHERE id=?', orderId); if (!o) fail(404, 'الطلب غير موجود', 'not_found'); if (o.user_id !== actor.id && actor.role !== 'admin' && !(allowDriver && o.driver_id === actor.id)) fail(403, 'لا يمكنك الوصول إلى هذا الطلب', 'forbidden'); return o; };
  const rateBuckets = new Map();
  // rateLimitScale > 1 only widens the per-address limits for automated end-to-end runs; production keeps 1.
  const rateScale = Number.isFinite(options.rateLimitScale) && options.rateLimitScale >= 1 ? options.rateLimitScale : 1;
  const rate = (req, category, limit = 20, interval = 900_000) => {
    limit *= rateScale;
    const key = `${req.socket.remoteAddress}:${category}`, current = rateBuckets.get(key);
    const bucket = !current || current.until <= Date.now() ? { count: 0, until: Date.now() + interval } : current;
    bucket.count++; rateBuckets.set(key, bucket);
    if (rateBuckets.size > 10000) for (const [k, v] of rateBuckets) if (v.until <= Date.now()) rateBuckets.delete(k);
    if (bucket.count > limit) fail(429, 'محاولات كثيرة؛ حاول لاحقًا', 'rate_limited');
  };
  const quote = (items, options = {}) => {
    if (!Array.isArray(items) || !items.length || items.length > 100) fail(400, 'السلة فارغة أو غير صالحة');
    const ids = new Set(); let subtotal = 0;
    const lines = items.map((line) => {
      const productId = text(line.productId, 'معرّف المنتج', 1, 100), quantity = integer(line.quantity, 'الكمية', 1, 1000);
      if (ids.has(productId)) fail(400, 'لا تكرر المنتج في السلة'); ids.add(productId);
      const row = get('SELECT * FROM products WHERE id=? AND active=1', productId);
      if (!row) fail(409, 'أحد المنتجات لم يعد متاحًا', 'product_unavailable');
      if (activeVariants(productId).length) fail(409, 'اختر المقاس أو اللون قبل إضافة هذا المنتج', 'variant_required');
      if (row.stock < quantity) fail(409, `الكمية المطلوبة غير متاحة للمنتج ${parse(row.data).name}`, 'out_of_stock');
      if (options.branchId) ext.checkBranchStock(options.branchId, productId, quantity);
      const p = parse(row.data);
      if (ext) ext.checkSellable(p);
      const price = ext ? ext.unitPrice(row, p, quantity) : p.price; subtotal = money(subtotal + price * quantity);
      return { productId, name: p.variantLabel ? `${p.name} — ${p.variantLabel}` : p.name, price, quantity };
    });
    return { lines, subtotal };
  };
  // userId: personal vouchers (a stamp-card reward) carry user_id and only work for that shopper.
  const discountFor = (code, subtotal, userId = null) => {
    if (!code) return { discount: 0, row: null };
    const normalized = text(code, 'رمز الخصم', 1, 40).toUpperCase(), row = get('SELECT * FROM coupons WHERE code=? AND active=1', normalized);
    if (!row || row.expires_at && row.expires_at <= now() || row.max_uses !== null && row.uses >= row.max_uses) fail(400, 'رمز الخصم غير صالح أو انتهى', 'invalid_coupon');
    if (row.user_id && row.user_id !== userId) fail(400, 'رمز الخصم غير صالح أو انتهى', 'invalid_coupon');
    if (subtotal < row.min_subtotal) fail(400, `الحد الأدنى لاستخدام الرمز ${row.min_subtotal}`, 'coupon_minimum');
    return { row, discount: money(Math.min(subtotal, row.type === 'percent' ? subtotal * row.value / 100 : row.value)) };
  };
  const event = (o, status, note = '') => run('INSERT INTO order_events VALUES(?,?,?,?,?)', id('evt'), o.id, status, note, now());
  const cancel = (o, actor) => {
    if (!['pending', 'confirmed'].includes(o.status)) fail(409, 'لا يمكن إلغاء الطلب في مرحلته الحالية');
    for (const line of parse(o.items)) run('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?', line.quantity, now(), line.productId);
    if (o.payment_method === 'wallet' && o.payment_status === 'paid') ledger(o.user_id, o.total, 'refund', 'استرداد طلب ملغى', o.id);
    if (o.coupon_id) run('UPDATE coupons SET uses=MAX(0,uses-1) WHERE id=?', o.coupon_id);
    run("UPDATE orders SET status='cancelled',payment_status=?,updated_at=? WHERE id=?", o.payment_method === 'wallet' || o.payment_method === 'card' && o.payment_status === 'paid' ? 'refunded' : 'cancelled', now(), o.id);
    ext?.emit('orderCancelled', o); ext?.emit('productsChanged', parse(o.items).map((line) => line.productId));
    event(o, 'cancelled', 'تم إلغاء الطلب'); notify(o.user_id, 'تم إلغاء الطلب', `أُلغي الطلب ${o.id}`, o.id); audit(actor, 'order.cancel', o.id);
    return order(get('SELECT * FROM orders WHERE id=?', o.id));
  };
  const transition = (o, status, actor, driverId) => {
    if (status && !STATUSES.includes(status)) fail(400, 'حالة الطلب غير صالحة');
    if (driverId !== undefined && driverId !== null && !get("SELECT id FROM users WHERE id=? AND role='driver'", driverId)) fail(400, 'حساب سائق التوصيل غير صالح');
    if (status === 'cancelled') return cancel(o, actor);
    if (status && status !== o.status) {
      if (STATUSES.indexOf(status) !== STATUSES.indexOf(o.status) + 1 || o.status === 'cancelled') fail(409, 'انتقال حالة الطلب غير مسموح');
      if (status === 'out_for_delivery' && !(driverId || o.driver_id)) fail(409, 'عيّن سائقًا قبل خروج الطلب للتوصيل');
      run('UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=?', status, status === 'delivered' && o.payment_method === 'cod' ? 'collected' : o.payment_status, now(), o.id);
      event(o, status); notify(o.user_id, 'تحديث حالة الطلب', `أصبحت حالة طلبك: ${status}`, o.id);
      if (status === 'delivered') earnOrderReward(o);
      ext?.emit('orderStatus', get('SELECT * FROM orders WHERE id=?', o.id), status, actor);
    }
    if (driverId !== undefined) run('UPDATE orders SET driver_id=?,updated_at=? WHERE id=?', driverId, now(), o.id);
    audit(actor, 'order.update', o.id, { status, driverId });
    return order(get('SELECT * FROM orders WHERE id=?', o.id));
  };
  const validateProduct = (body, old = {}) => {
    const p = { ...old, ...body };
    p.name = text(p.name, 'اسم المنتج', 2, 200); p.price = money(number(p.price, 'السعر', 0.001, 1e7));
    if (p.oldPrice == null) delete p.oldPrice;
    else p.oldPrice = money(number(p.oldPrice, 'السعر قبل الخصم', p.price, 1e7));
    p.category = text(p.category || 'other', 'القسم', 1, 80); p.description = typeof p.description === 'string' ? p.description.slice(0, 5000) : '';
    p.sku = text(p.sku || p.id || id('sku'), 'رمز الصنف', 1, 100);
    p.tags = Array.isArray(p.tags) ? p.tags.filter((v) => typeof v === 'string').slice(0, 50).map((v) => v.slice(0, 80)) : [];
    p.features = Array.isArray(p.features) ? p.features.filter((v) => typeof v === 'string').slice(0, 30) : [];
    p.colors = Array.isArray(p.colors) ? p.colors.filter((v) => typeof v === 'string').slice(0, 30) : [];
    if (ext) Object.assign(p, ext.validateProductExtras(p));
    if (p.variantOf) {
      p.variantOf = text(p.variantOf, 'معرّف المنتج الأب', 1, 100);
      if (p.variantOf === p.id || activeVariants(p.id).length) fail(400, 'لا يمكن إنشاء متغير تابع لنفسه أو لمتغيرات أخرى');
      const parent = get('SELECT * FROM products WHERE id=? AND active=1', p.variantOf);
      if (!parent || parse(parent.data, {}).variantOf) fail(400, 'المنتج الأب يجب أن يكون صنفًا منشورًا ومستقلًا');
      p.variantLabel = text(p.variantLabel, 'وصف المقاس أو اللون', 2, 80);
    } else { delete p.variantOf; delete p.variantLabel; }
    for (const key of ['stock', 'active', 'updatedAt', 'rating', 'reviews']) delete p[key];
    if (p.image === '') { if (old.image) p.image = old.image; else delete p.image; }
    if (typeof p.image === 'string' && !/^https:\/\//.test(p.image)) fail(400, 'رابط صورة المنتج يجب أن يستخدم HTTPS');
    return p;
  };
  const importInventory = (body, actor) => {
    const rows = body.csv !== undefined ? csvRows(body.csv) : body.items || body.products;
    if (!Array.isArray(rows) || !rows.length || rows.length > 2000) fail(400, 'قائمة المخزون يجب أن تحتوي على 1 إلى 2000 صنف');
    const mode = body.mode || 'replace'; if (!['replace', 'add'].includes(mode)) fail(400, 'طريقة الاستيراد غير صالحة');
    const seen = new Set();
    const validated = rows.map((row) => {
      const productId = text(row.id || row.productId || row.sku, 'معرّف الصنف أو SKU', 1, 100);
      if (seen.has(productId)) fail(400, 'يوجد صنف مكرر في ملف الاستيراد'); seen.add(productId);
      const old = get('SELECT * FROM products WHERE id=?', productId);
      const stock = integer(row.stock ?? row.quantity, 'المخزون', 0, 1e7);
      const data = validateProduct({ ...row, id: productId }, old ? parse(old.data) : {});
      const finalStock = mode === 'add' && old ? integer(old.stock + stock, 'المخزون', 0, 1e7) : stock;
      return { id: productId, data, stock: finalStock, active: old?.active ?? 1, before: old || null, existed: !!old };
    });
    return transaction(() => {
      const snapshot = [];
      for (const row of validated) {
        run('INSERT INTO products(id,data,stock,active,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,stock=excluded.stock,updated_at=excluded.updated_at', row.id, json(row.data), row.stock, row.active, now());
        snapshot.push({ id: row.id, before: row.before, after: get('SELECT * FROM products WHERE id=?', row.id) });
      }
      const importId = id('imp');
      run('INSERT INTO inventory_imports VALUES(?,?,?,?,?,NULL)', importId, actor.id, mode, json(snapshot), now());
      audit(actor, 'inventory.import', importId, { count: validated.length, mode }); ext?.emit('productsChanged', validated.map((r) => r.id));
      return { importId, imported: validated.length, created: validated.filter((r) => !r.existed).length, updated: validated.filter((r) => r.existed).length, products: validated.map((r) => product(get('SELECT * FROM products WHERE id=?', r.id))) };
    });
  };
  const latestInventoryImport = () => get('SELECT id,actor_id,mode,snapshot,created_at,undone_at FROM inventory_imports WHERE undone_at IS NULL ORDER BY rowid DESC LIMIT 1');
  const inventoryUndoSummary = () => {
    const entry = latestInventoryImport();
    return entry ? { id: entry.id, mode: entry.mode, count: parse(entry.snapshot, []).length, createdAt: entry.created_at } : null;
  };
  const undoInventory = (importId, actor) => transaction(() => {
    const entry = latestInventoryImport();
    if (!entry || entry.id !== importId) fail(409, 'لم يعد الاستيراد المحدد أحدث عملية قابلة للتراجع', 'undo_not_available');
    const snapshot = parse(entry.snapshot, []);
    if (!Array.isArray(snapshot) || snapshot.length < 1) fail(409, 'سجل الاستيراد غير صالح', 'undo_not_available');
    const purchasedSinceImport = new Set(all('SELECT items FROM orders WHERE created_at>=?', entry.created_at)
      .flatMap((orderRow) => parse(orderRow.items, []).map((line) => line.productId)));
    const editedSinceImport = new Set(all("SELECT entity_id FROM audit WHERE action IN ('product.update','product.archive') AND created_at>=?", entry.created_at)
      .map((event) => event.entity_id));
    const favorited = new Set(all('SELECT product_ids FROM wishlists')
      .flatMap((wishlist) => parse(wishlist.product_ids, [])));
    for (const item of snapshot) {
      const current = get('SELECT * FROM products WHERE id=?', item.id), after = item.after;
      if (!current || !after || current.data !== after.data || current.stock !== after.stock || current.active !== after.active || current.updated_at !== after.updated_at) {
        fail(409, 'تغير صنف بعد الاستيراد؛ راجع المخزون يدويًا ولا تستبدل تغييرات الشراء أو الإدارة', 'inventory_changed');
      }
      if (purchasedSinceImport.has(item.id)) fail(409, 'استُخدم صنف في طلب بعد الاستيراد؛ لا يمكن التراجع بأمان', 'inventory_changed');
      if (editedSinceImport.has(item.id)) fail(409, 'عُدّل صنف بعد الاستيراد؛ لا يمكن التراجع بأمان', 'inventory_changed');
      if (!item.before) {
        if (get('SELECT id FROM reviews WHERE product_id=? LIMIT 1', item.id)
          || favorited.has(item.id)) {
          fail(409, 'يوجد طلب أو تقييم أو مفضلة تشير إلى صنف جديد؛ لا يمكن حذفه بأمان', 'inventory_referenced');
        }
      }
    }
    for (const item of snapshot) {
      if (item.before) run('UPDATE products SET data=?,stock=?,active=?,updated_at=? WHERE id=?', item.before.data, item.before.stock, item.before.active, item.before.updated_at, item.id);
      else run('DELETE FROM products WHERE id=?', item.id);
    }
    const undoneAt = now();
    run('UPDATE inventory_imports SET undone_at=? WHERE id=? AND undone_at IS NULL', undoneAt, entry.id);
    audit(actor, 'inventory.undo', entry.id, { count: snapshot.length });
    return { importId: entry.id, undoneAt, restored: snapshot.filter((item) => !!item.before).length, removed: snapshot.filter((item) => !item.before).length };
  });
  const jawafaSnapshot = (payload) => { try { return prepareJawafaSnapshot(payload); } catch (error) { fail(422, error.message || 'لقطة المخزون غير صالحة', 'invalid_jawafa_snapshot'); } };
  const connectorPublic = () => { const c = setting('inventoryConnector', {}); return { url: c.url || '', tokenConfigured: !!c.token, lastSyncAt: c.lastSyncAt || null, lastResult: c.lastResult || null }; };
  const oauthConfig = { appId: process.env.FACEBOOK_APP_ID, appSecret: process.env.FACEBOOK_APP_SECRET, callback: process.env.FACEBOOK_CALLBACK_URL, version: process.env.FACEBOOK_GRAPH_VERSION || 'v24.0', ...options.facebook };
  const facebookConfigured = !!(oauthConfig.appId && oauthConfig.appSecret && oauthConfig.callback);
  const optionalUser = (req) => { if (!req.headers.authorization) return null; try { const actor = identity(req); return actor.kind === 'user' ? actor : null; } catch { return null; } };
  ext = await installModules({ session, issueRecoveryCode, db, get, all, run, transaction, setting, setSetting, publicSettings, audit, notify, balance, ledger, rewardBalance, rewardLedger, product, order, identity, requireUser, optionalUser, admin, ownOrder, rate, quote, discountFor, event, cancel, transition, validateProduct, validateAddress, importInventory, encrypt, decrypt, passwordHash, passwordValid, publicUser, options, dbPath, id, now, hash, json, parse, money, fail, text, number, integer, email, date, csvRows, STATUSES, SCOPES });
  async function readBody(req) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return {};
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) fail(413, 'حجم الطلب أكبر من الحد المسموح', 'body_too_large'); chunks.push(chunk); }
    if (!size) return {};
    if (!req.headers['content-type']?.includes('application/json')) fail(415, 'استخدم application/json');
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'JSON غير صالح'); }
    if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'محتوى الطلب غير صالح');
    return body;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { if (res.headersSent) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(json(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const allowedOrigins = (options.corsOrigins || process.env.CORS_ORIGINS || 'http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082,http://localhost:8787,http://127.0.0.1:8787,https://amer-ai-store.github.io,https://amer-ai-command-center.eagerlark64.chatgpt.site').split(',').map((v) => v.trim());
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) { send(403, { error: 'مصدر الاتصال غير مسموح', code: 'origin_forbidden' }); return; }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin || allowedOrigins[0]);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Service-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/\/$/, '') || '/', method = req.method;
      if (!path.startsWith('/api/')) {
        if (options.staticDir && method === 'GET') {
          const staticRoot = resolve(options.staticDir); let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { fail(400, 'مسار غير صالح'); }
          const candidate = resolve(staticRoot, `.${decoded}`);
          if (candidate !== staticRoot && !candidate.startsWith(staticRoot + sep)) fail(403, 'مسار غير مسموح');
          let target = candidate;
          try { if (!statSync(target).isFile()) target = resolve(staticRoot, 'index.html'); } catch { target = resolve(staticRoot, 'index.html'); }
          if (!existsSync(target)) fail(404, 'ملفات الواجهة غير مبنية');
          const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
          res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' }); createReadStream(target).pipe(res); return;
        }
        fail(404, 'المسار غير موجود', 'not_found');
      }
      const body = await readBody(req), p = path.slice(4).split('/').filter(Boolean);
      let match;
      if (method === 'GET' && (path === '/api/health' || path === '/api/ready')) {
        // A real readiness probe: the database must answer a query and the catalog must be readable.
        let database = 'error', products = null;
        try { if (get('SELECT 1 AS ok').ok === 1) { database = 'connected'; products = get('SELECT COUNT(*) AS n FROM products').n; } } catch { database = 'error'; }
        const ready = database === 'connected';
        return send(ready ? 200 : 503, { ok: ready, service: 'luqta-commerce', currency: ready ? setting('currency') : null, facebookConfigured, database, products, uptimeSeconds: Math.round(process.uptime()) });
      }
      if (method === 'GET' && path === '/api/settings') return send(200, { settings: publicSettings() });
      if (method === 'POST' && path === '/api/auth/register') {
        rate(req, 'register', 15); if (body.role && body.role !== 'customer') fail(403, 'لا يمكن إنشاء صلاحيات إدارية من التسجيل العام', 'forbidden');
        const em = email(body.email), name = text(body.name, 'الاسم', 2, 100), pw = await passwordHash(body.password);
        if (get('SELECT id FROM users WHERE email=?', em)) fail(409, 'البريد الإلكتروني مستخدم بالفعل', 'email_exists');
        const result = transaction(() => {
          const userId = id('usr'); run('INSERT INTO users VALUES(?,?,?,?,?,?)', userId, name, em, pw, 'customer', now());
          const recoveryCode = issueRecoveryCode(userId);
          notify(userId, 'مرحبًا بك في لُقطة', 'أصبح حسابك جاهزًا لحفظ العناوين والطلبات. احفظ رمز الاسترداد الذي يظهر بعد التسجيل في مكان آمن.');
          return { ...session(get('SELECT * FROM users WHERE id=?', userId), req, body), recoveryCode };
        });
        return send(201, result);
      }
      if (method === 'POST' && path === '/api/auth/login') {
        rate(req, 'login', 30); const em = email(body.email), user = get('SELECT * FROM users WHERE email=?', em);
        const dummy = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
        const valid = await passwordValid(body.password, user?.password_hash || dummy);
        if (!valid || !user) fail(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 'invalid_credentials');
        return send(200, session(user, req, body));
      }
      if (path === '/api/auth/me') {
        const actor = requireUser(req);
        if (method === 'GET') return send(200, { user: publicUser(actor) });
        if (method === 'PATCH') { const name = text(body.name, 'الاسم', 2, 100); run('UPDATE users SET name=? WHERE id=?', name, actor.id); return send(200, { user: publicUser(get('SELECT * FROM users WHERE id=?', actor.id)) }); }
        if (method === 'DELETE') {
          rate(req, 'delete-account', 5);
          if (body.confirm !== 'حذف حسابي') fail(400, 'اكتب «حذف حسابي» لتأكيد حذف الحساب', 'confirmation_required');
          // Phone and Google accounts have no password the shopper knows: the recovery code issued at sign-up confirms deletion.
          const viaRecovery = typeof body.recoveryCode === 'string' && body.recoveryCode.length >= 20 && !!get('SELECT 1 AS x FROM recovery_codes WHERE user_id=? AND code_hash=?', actor.id, hash(body.recoveryCode));
          if (!viaRecovery && !await passwordValid(body.password, actor.password_hash)) fail(401, 'كلمة المرور أو رمز الاسترداد غير صحيح', 'invalid_credentials');
          if (actor.role === 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n <= 1) fail(409, 'لا يمكن حذف حساب آخر مدير للمتجر', 'last_admin');
          if (get("SELECT id FROM orders WHERE user_id=? AND status NOT IN ('delivered','cancelled') LIMIT 1", actor.id)) fail(409, 'أكمل أو ألغِ طلباتك النشطة قبل حذف الحساب', 'active_orders');
          if (get("SELECT id FROM orders WHERE driver_id=? AND status NOT IN ('delivered','cancelled') LIMIT 1", actor.id)) fail(409, 'أكمل عمليات التوصيل المسندة قبل حذف الحساب', 'active_deliveries');
          if (get("SELECT id FROM returns WHERE user_id=? AND status='requested' LIMIT 1", actor.id)) fail(409, 'انتظر معالجة طلب الإرجاع المفتوح قبل حذف الحساب', 'active_returns');
          if (balance(actor.id) !== 0) fail(409, 'يجب تسوية رصيد المحفظة قبل حذف الحساب', 'wallet_balance');
          const deletedEmail = `deleted+${randomUUID()}@invalid.local`;
          const disabledPassword = await passwordHash(randomBytes(48).toString('base64url'));
          transaction(() => {
            run('DELETE FROM sessions WHERE user_id=?', actor.id);
            run('DELETE FROM recovery_codes WHERE user_id=?', actor.id);
            run('DELETE FROM addresses WHERE user_id=?', actor.id);
            run('DELETE FROM wishlists WHERE user_id=?', actor.id);
            run('DELETE FROM notifications WHERE user_id=?', actor.id);
            run('DELETE FROM reviews WHERE user_id=?', actor.id);
            run('DELETE FROM oauth_states WHERE user_id=?', actor.id);
            run('DELETE FROM facebook_links WHERE user_id=?', actor.id);
            run('DELETE FROM ticket_replies WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id=?)', actor.id);
            run('DELETE FROM tickets WHERE user_id=?', actor.id);
            run("UPDATE ticket_replies SET message='تم حذف بيانات المرسل' WHERE user_id=?", actor.id);
            run('DELETE FROM reward_ledger WHERE user_id=?', actor.id);
            ext.emit('deleteUser', actor.id);
            run('DELETE FROM locations WHERE order_id IN (SELECT id FROM orders WHERE user_id=? OR driver_id=?)', actor.id, actor.id);
            run("UPDATE orders SET address='{}',idempotency_key=? || id WHERE user_id=?", `deleted_${randomUUID()}_`, actor.id);
            run('UPDATE orders SET driver_id=NULL WHERE driver_id=?', actor.id);
            run("UPDATE returns SET reason='تم حذف بيانات العميل',note='' WHERE user_id=?", actor.id);
            run("UPDATE wallet SET note='سجل مالي لحساب محذوف' WHERE user_id=?", actor.id);
            run("UPDATE order_events SET note='تم حذف البيانات الشخصية' WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)", actor.id);
            run("UPDATE audit SET detail='{}' WHERE actor_id=? OR entity_id=?", actor.id, actor.id);
            run("UPDATE users SET name='حساب محذوف',email=?,password_hash=?,role='customer' WHERE id=?", deletedEmail, disabledPassword, actor.id);
          });
          return send(200, { ok: true, personalDataRemoved: true, financialRecordsRetained: true });
        }
      }
      if (method === 'POST' && path === '/api/auth/recovery-code') {
        const actor = requireUser(req); rate(req, 'recovery-code', 6);
        if (!await passwordValid(body.password, actor.password_hash)) fail(401, 'كلمة المرور غير صحيحة', 'invalid_credentials');
        return send(200, { recoveryCode: transaction(() => issueRecoveryCode(actor.id)) });
      }
      if (method === 'POST' && path === '/api/auth/recover') {
        rate(req, 'recover', 8, 3600_000);
        const em = email(body.email), code = body.recoveryCode;
        if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(code)) fail(401, 'بيانات الاسترداد غير صحيحة', 'invalid_recovery');
        const user = get('SELECT * FROM users WHERE email=?', em);
        const saved = user && get('SELECT code_hash FROM recovery_codes WHERE user_id=?', user.id);
        const expected = Buffer.from(saved?.code_hash || '00'.repeat(32), 'hex');
        const valid = timingSafeEqual(Buffer.from(hash(code), 'hex'), expected);
        if (!user || !saved || !valid) fail(401, 'بيانات الاسترداد غير صحيحة', 'invalid_recovery');
        const pw = await passwordHash(body.newPassword);
        transaction(() => {
          run('UPDATE users SET password_hash=? WHERE id=?', pw, user.id);
          run('DELETE FROM sessions WHERE user_id=?', user.id);
          run('DELETE FROM recovery_codes WHERE user_id=?', user.id);
        });
        return send(200, { ok: true });
      }
      if (method === 'POST' && path === '/api/auth/logout') { const actor = requireUser(req); run('DELETE FROM sessions WHERE token_hash=?', actor.tokenHash); return send(200, { ok: true }); }
      if (method === 'POST' && path === '/api/auth/change-password') {
        const actor = requireUser(req); rate(req, 'password', 10);
        if (!await passwordValid(body.currentPassword, actor.password_hash)) fail(401, 'كلمة المرور الحالية غير صحيحة');
        const pw = await passwordHash(body.newPassword); transaction(() => { run('UPDATE users SET password_hash=? WHERE id=?', pw, actor.id); run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', actor.id, actor.tokenHash); }); return send(200, { ok: true });
      }
      if (method === 'GET' && path === '/api/products') {
        let rows = all('SELECT * FROM products WHERE active=1').map(product);
        const q = url.searchParams.get('q')?.toLowerCase(), category = url.searchParams.get('category');
        if (q) rows = rows.filter((v) => `${v.name} ${v.description} ${v.tags.join(' ')}`.toLowerCase().includes(q));
        if (category) rows = rows.filter((v) => v.category === category);
        if (url.searchParams.has('minPrice')) rows = rows.filter((v) => v.price >= Number(url.searchParams.get('minPrice')));
        if (url.searchParams.has('maxPrice')) rows = rows.filter((v) => v.price <= Number(url.searchParams.get('maxPrice')));
        const sort = url.searchParams.get('sort'); if (sort === 'price-asc') rows.sort((a, b) => a.price - b.price); if (sort === 'price-desc') rows.sort((a, b) => b.price - a.price); if (sort === 'rating') rows.sort((a, b) => b.rating - a.rating);
        return send(200, { products: rows });
      }
      if (method === 'GET' && (match = path.match(/^\/api\/products\/([^/]+)$/))) { const row = get('SELECT * FROM products WHERE id=? AND active=1', match[1]); if (!row) fail(404, 'المنتج غير موجود', 'not_found'); return send(200, { product: product(row) }); }
      if (match = path.match(/^\/api\/products\/([^/]+)\/reviews$/)) {
        const productId = match[1]; if (!get('SELECT id FROM products WHERE id=?', productId)) fail(404, 'المنتج غير موجود', 'not_found');
        if (method === 'GET') { const reviews = all('SELECT r.id,r.user_id AS userId,u.name,r.rating,r.title,r.body,r.created_at AS createdAt FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.created_at DESC LIMIT 200', productId); return send(200, { reviews, rating: reviews.length ? money(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : 0, count: reviews.length }); }
        if (method === 'POST') { const actor = requireUser(req), rating = integer(body.rating, 'التقييم', 1, 5), content = text(body.body, 'المراجعة', 3, 2000), title = body.title ? text(body.title, 'عنوان المراجعة', 1, 150) : '';
          const purchased = all("SELECT items FROM orders WHERE user_id=? AND status='delivered'", actor.id).some((o) => parse(o.items).some((line) => {
            if (line.productId === productId) return true;
            const bought = get('SELECT data FROM products WHERE id=?', line.productId);
            return bought && parse(bought.data, {}).variantOf === productId;
          }));
          if (!purchased) fail(403, 'يمكن تقييم المنتجات بعد استلامها فقط', 'purchase_required'); if (get('SELECT id FROM reviews WHERE user_id=? AND product_id=?', actor.id, productId)) fail(409, 'سبق أن قيّمت هذا المنتج');
          const reviewId = id('rev'); run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)', reviewId, actor.id, productId, rating, title, content, now()); return send(201, { review: get('SELECT id,rating,title,body,created_at AS createdAt FROM reviews WHERE id=?', reviewId) }); }
      }
      if (method === 'PATCH' && (match = path.match(/^\/api\/reviews\/([^/]+)$/))) { const actor = requireUser(req), r = get('SELECT * FROM reviews WHERE id=? AND user_id=?', match[1], actor.id); if (!r) fail(404, 'المراجعة غير موجودة', 'not_found'); run('UPDATE reviews SET rating=?,title=?,body=? WHERE id=?', body.rating !== undefined ? integer(body.rating, 'التقييم', 1, 5) : r.rating, body.title !== undefined ? text(body.title, 'العنوان', 0, 150) : r.title, body.body !== undefined ? text(body.body, 'المراجعة', 3, 2000) : r.body, r.id); return send(200, { review: get('SELECT id,rating,title,body FROM reviews WHERE id=?', r.id) }); }
      if (path === '/api/addresses') {
        const actor = requireUser(req);
        if (method === 'GET') return send(200, { addresses: all('SELECT * FROM addresses WHERE user_id=?', actor.id).map((r) => ({ ...parse(r.data), id: r.id })) });
        if (method === 'POST') { const address = validateAddress(body), addressId = id('adr'); if (get('SELECT COUNT(*) AS n FROM addresses WHERE user_id=?', actor.id).n >= 30) fail(400, 'الحد الأقصى 30 عنوانًا'); transaction(() => { if (address.isDefault) for (const a of all('SELECT * FROM addresses WHERE user_id=?', actor.id)) run('UPDATE addresses SET data=? WHERE id=?', json({ ...parse(a.data), isDefault: false }), a.id); run('INSERT INTO addresses VALUES(?,?,?)', addressId, actor.id, json(address)); }); return send(201, { address: { ...address, id: addressId } }); }
      }
      if (match = path.match(/^\/api\/addresses\/([^/]+)$/)) {
        const actor = requireUser(req), row = get('SELECT * FROM addresses WHERE id=? AND user_id=?', match[1], actor.id); if (!row) fail(404, 'العنوان غير موجود', 'not_found');
        if (method === 'DELETE') { run('DELETE FROM addresses WHERE id=?', row.id); return send(200, { ok: true }); }
        if (method === 'PATCH') { const address = validateAddress({ ...parse(row.data), ...body }); transaction(() => { if (address.isDefault) for (const a of all('SELECT * FROM addresses WHERE user_id=?', actor.id)) run('UPDATE addresses SET data=? WHERE id=?', json({ ...parse(a.data), isDefault: false }), a.id); run('UPDATE addresses SET data=? WHERE id=?', json(address), row.id); }); return send(200, { address: { ...address, id: row.id } }); }
      }
      if (path === '/api/wishlist') { const actor = requireUser(req); if (method === 'GET') return send(200, { productIds: parse(get('SELECT product_ids FROM wishlists WHERE user_id=?', actor.id)?.product_ids, []) }); if (method === 'PUT') { if (!Array.isArray(body.productIds) || body.productIds.length > 500 || body.productIds.some((v) => typeof v !== 'string' || !get('SELECT id FROM products WHERE id=?', v))) fail(400, 'قائمة المفضلة غير صالحة'); const productIds = [...new Set(body.productIds)]; run('INSERT INTO wishlists VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET product_ids=excluded.product_ids', actor.id, json(productIds)); return send(200, { productIds }); } }
      if (method === 'POST' && path === '/api/coupons/validate') { const couponActor = requireUser(req); const code = text(body.code, 'رمز الخصم', 1, 40), { subtotal } = quote(body.items), { row, discount } = discountFor(code, subtotal, couponActor.id); return send(200, { code: row.code, discount, subtotal, currency: setting('currency') }); }
      if (path === '/api/orders') {
        const actor = requireUser(req);
        if (method === 'GET') return send(200, { orders: all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 200', actor.id).map(order) });
        if (method === 'POST') {
          const key = text(body.idempotencyKey, 'مفتاح عدم تكرار الطلب', 8, 200), existing = get('SELECT * FROM orders WHERE user_id=? AND idempotency_key=?', actor.id, key);
          if (existing) return send(200, { order: order(existing), reused: true });
          const address = validateAddress(body.address || {}), paymentMethod = body.paymentMethod || 'cod'; if (!['cod', 'wallet', 'card'].includes(paymentMethod)) fail(400, 'طريقة الدفع غير مدعومة');
          const checkout = ext.prepareCheckout(body, actor, address, paymentMethod);
          const created = transaction(() => {
            const { lines, subtotal } = quote(body.items, { branchId: checkout.branchId }), { row: couponRow, discount } = discountFor(body.couponCode, subtotal, actor.id), shipping = checkout.shipping(subtotal, discount), total = money(subtotal - discount + shipping + checkout.fees);
            if (paymentMethod === 'wallet' && balance(actor.id) < total) fail(409, 'رصيد المحفظة غير كافٍ', 'insufficient_balance');
            const orderId = id('LQ'), createdAt = now(), payment = paymentMethod === 'card' ? checkout.chargeCard(total, orderId) : null;
            run('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', orderId, actor.id, json(lines), json(address), subtotal, discount, shipping, total, setting('currency'), 'pending', paymentMethod, paymentMethod === 'wallet' || payment ? 'paid' : 'pending', null, couponRow?.id || null, key, createdAt, createdAt);
            for (const line of lines) run('UPDATE products SET stock=stock-?,updated_at=? WHERE id=?', line.quantity, createdAt, line.productId);
            if (couponRow) run('UPDATE coupons SET uses=uses+1 WHERE id=?', couponRow.id);
            if (paymentMethod === 'wallet') ledger(actor.id, -total, 'purchase', 'دفع طلب من المحفظة', orderId);
            checkout.commit(orderId, lines, payment);
            const o = get('SELECT * FROM orders WHERE id=?', orderId); event(o, 'pending', 'تم إنشاء الطلب'); notify(actor.id, 'تم استلام طلبك', `رقم طلبك ${orderId}`, orderId); audit(actor, 'order.create', orderId, { total, paymentMethod }); return order(o);
          });
          return send(201, { order: created });
        }
      }
      if (method === 'GET' && (match = path.match(/^\/api\/orders\/([^/]+)$/))) return send(200, { order: order(ownOrder(requireUser(req), match[1])) });
      if (method === 'POST' && (match = path.match(/^\/api\/orders\/([^/]+)\/cancel$/))) { const actor = requireUser(req); return send(200, { order: transaction(() => cancel(ownOrder(actor, match[1]), actor)) }); }
      if (method === 'POST' && (match = path.match(/^\/api\/orders\/([^/]+)\/returns$/))) {
        const actor = requireUser(req), o = ownOrder(actor, match[1]), reason = text(body.reason, 'سبب الإرجاع', 5, 2000);
        if (o.status !== 'delivered') fail(409, 'يمكن إرجاع الطلب بعد استلامه فقط');
        const delivered = get("SELECT created_at FROM order_events WHERE order_id=? AND status='delivered' ORDER BY created_at DESC LIMIT 1", o.id);
        if (!delivered || Date.now() - Date.parse(delivered.created_at) > setting('returnsDays') * 86400_000) fail(409, 'انتهت مهلة الإرجاع');
        if (get('SELECT id FROM returns WHERE order_id=?', o.id)) fail(409, 'يوجد طلب إرجاع لهذا الطلب');
        const returnId = id('ret'), time = now(); run('INSERT INTO returns VALUES(?,?,?,?,?,?,?,?)', returnId, o.id, actor.id, reason, 'requested', '', time, time); notify(actor.id, 'طلب إرجاع جديد', 'تم تسجيل طلب الإرجاع للمراجعة', o.id); return send(201, { returnRequest: returnItem(get('SELECT * FROM returns WHERE id=?', returnId)) });
      }
      if (method === 'GET' && path === '/api/returns') { const actor = requireUser(req); return send(200, { returns: all('SELECT * FROM returns WHERE user_id=? ORDER BY created_at DESC', actor.id).map(returnItem) }); }
      if (method === 'GET' && (match = path.match(/^\/api\/orders\/([^/]+)\/tracking$/))) {
        const actor = requireUser(req), o = ownOrder(actor, match[1], true), location = get('SELECT latitude,longitude,accuracy,updated_at AS updatedAt FROM locations WHERE order_id=?', o.id);
        const driver = o.driver_id ? get('SELECT id,name FROM users WHERE id=?', o.driver_id) : null;
        return send(200, { orderId: o.id, status: o.status, driver: driver || null, location: location || null, destination: parse(o.address), events: order(o).events, updatedAt: o.updated_at });
      }
      if (method === 'GET' && path === '/api/wallet') { const actor = requireUser(req); return send(200, { balance: balance(actor.id), currency: setting('currency'), transactions: all('SELECT id,amount,type,note,order_id AS orderId,created_at AS date FROM wallet WHERE user_id=? ORDER BY created_at DESC,id LIMIT 500', actor.id) }); }
      if (method === 'GET' && path === '/api/rewards') {
        const actor = requireUser(req), points = rewardBalance(actor.id);
        return send(200, { points, redeemablePoints: Math.floor(Math.max(0, points) / 100) * 100, pointsPerCurrencyUnit: 100, minimumRedemptionPoints: 100, currency: setting('currency'), transactions: all('SELECT id,points,type,note,order_id AS orderId,created_at AS date FROM reward_ledger WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 500', actor.id) });
      }
      if (method === 'POST' && path === '/api/rewards/redeem') {
        const actor = requireUser(req); rate(req, 'rewards', 30);
        const points = integer(body.points, 'النقاط', 100, 1_000_000), requestKey = text(body.requestKey, 'مفتاح العملية', 8, 200);
        if (points % 100 !== 0) fail(400, 'استبدل النقاط بمضاعفات 100');
        const result = transaction(() => {
          const previous = get('SELECT * FROM reward_ledger WHERE user_id=? AND request_key=?', actor.id, requestKey);
          if (previous) {
            if (previous.type !== 'redeemed' || previous.points !== -points) fail(409, 'مفتاح العملية مستخدم لاستبدال مختلف');
            return { points: rewardBalance(actor.id), walletBalance: balance(actor.id), currency: setting('currency'), reused: true, transactionId: previous.wallet_entry_id };
          }
          if (rewardBalance(actor.id) < points) fail(409, 'رصيد النقاط غير كافٍ', 'insufficient_points');
          const credit = money(points / 100);
          const walletEntry = ledger(actor.id, credit, 'reward_redemption', `استبدال ${points} نقطة مكافآت`);
          rewardLedger(actor.id, -points, 'redeemed', `استبدال ${points} نقطة برصيد محفظة`, null, walletEntry.id, requestKey);
          notify(actor.id, 'استبدال نقاط المكافآت', `أضيف ${credit} ${setting('currency')} إلى محفظتك`);
          return { points: rewardBalance(actor.id), walletBalance: balance(actor.id), currency: setting('currency'), reused: false, transactionId: walletEntry.id };
        });
        return send(200, result);
      }
      if (path === '/api/tickets') { const actor = requireUser(req); if (method === 'GET') return send(200, { tickets: all('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 200', actor.id).map(ticketItem) }); if (method === 'POST') { const ticketId = id('tkt'), time = now(); run('INSERT INTO tickets VALUES(?,?,?,?,?,?,?)', ticketId, actor.id, text(body.subject, 'موضوع التذكرة', 3, 200), text(body.message, 'الرسالة', 5, 5000), 'open', time, time); return send(201, { ticket: ticketItem(get('SELECT * FROM tickets WHERE id=?', ticketId)) }); } }
      if (method === 'POST' && (match = path.match(/^\/api\/tickets\/([^/]+)\/replies$/))) { const actor = requireUser(req), ticket = get('SELECT * FROM tickets WHERE id=? AND user_id=?', match[1], actor.id); if (!ticket) fail(404, 'التذكرة غير موجودة', 'not_found'); if (ticket.status === 'resolved') fail(409, 'التذكرة مغلقة؛ أنشئ تذكرة جديدة'); const replyId = id('rpl'), time = now(); run('INSERT INTO ticket_replies VALUES(?,?,?,?,?)', replyId, ticket.id, actor.id, text(body.message, 'الرسالة', 2, 5000), time); run('UPDATE tickets SET updated_at=? WHERE id=?', time, ticket.id); return send(201, { ticket: ticketItem(get('SELECT * FROM tickets WHERE id=?', ticket.id)) }); }
      if (method === 'GET' && path === '/api/notifications') { const actor = requireUser(req); return send(200, { notifications: all('SELECT id,title,body,is_read AS read,order_id AS orderId,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200', actor.id).map((r) => ({ ...r, read: !!r.read })) }); }
      if (method === 'POST' && path === '/api/notifications/read-all') { const actor = requireUser(req); run('UPDATE notifications SET is_read=1 WHERE user_id=?', actor.id); return send(200, { ok: true }); }
      if (method === 'PATCH' && (match = path.match(/^\/api\/notifications\/([^/]+)$/))) { const actor = requireUser(req); if (!get('SELECT id FROM notifications WHERE id=? AND user_id=?', match[1], actor.id)) fail(404, 'الإشعار غير موجود', 'not_found'); run('UPDATE notifications SET is_read=? WHERE id=?', body.read === false ? 0 : 1, match[1]); return send(200, { ok: true }); }
      if (method === 'GET' && path === '/api/driver/orders') { const actor = requireUser(req); if (!['driver', 'admin'].includes(actor.role)) fail(403, 'هذه الصفحة مخصصة للسائق', 'forbidden'); return send(200, { orders: all("SELECT * FROM orders WHERE driver_id=? AND status<>'cancelled' ORDER BY created_at DESC LIMIT 200", actor.id).map(order) }); }
      if (match = path.match(/^\/api\/driver\/orders\/([^/]+)(\/location)?$/)) {
        const actor = requireUser(req); if (actor.role !== 'driver') fail(403, 'هذه العملية مخصصة للسائق', 'forbidden'); const o = ownOrder(actor, match[1], true); if (o.driver_id !== actor.id) fail(403, 'الطلب غير مسند إليك', 'forbidden');
        if (method === 'POST' && match[2]) { if (o.status !== 'out_for_delivery') fail(409, 'يبدأ تتبع الموقع بعد خروج الطلب للتوصيل'); const latitude = number(body.latitude, 'خط العرض', -90, 90), longitude = number(body.longitude, 'خط الطول', -180, 180), accuracy = body.accuracy == null ? null : number(body.accuracy, 'دقة الموقع', 0, 100000), updatedAt = now(); run('INSERT INTO locations VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,updated_at=excluded.updated_at', o.id, latitude, longitude, accuracy, updatedAt); return send(200, { location: { latitude, longitude, accuracy, updatedAt } }); }
        if (method === 'PATCH' && !match[2]) { if (!['out_for_delivery', 'delivered'].includes(body.status)) fail(403, 'هذه الحالة غير متاحة للسائق'); if (body.status === 'delivered') ext.verifyDeliveryCode(o, body.otp); return send(200, { order: transaction(() => transition(o, body.status, actor)) }); }
      }
      if (path.startsWith('/api/admin/')) {
        const section = p[1];
        const scope = section === 'products' || section === 'offers' ? 'catalog:write' : section === 'inventory' ? 'inventory:write' : section === 'orders' ? 'orders:write' : section === 'settings' ? 'settings:write' : section === 'agent-jobs' ? 'jobs:write' : null;
        const actor = admin(req, scope);
        if (method === 'GET' && section === 'overview') {
          return send(200, { stats: { products: get('SELECT COUNT(*) AS n FROM products WHERE active=1').n, lowStock: get('SELECT COUNT(*) AS n FROM products WHERE active=1 AND stock<=5').n, orders: get('SELECT COUNT(*) AS n FROM orders').n, customers: get("SELECT COUNT(*) AS n FROM users WHERE role='customer'").n, revenue: money(get("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status='delivered' AND payment_status IN ('paid','collected')").n), pendingOrders: get("SELECT COUNT(*) AS n FROM orders WHERE status='pending'").n }, recentOrders: all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 10').map(order), lowStockProducts: all('SELECT * FROM products WHERE active=1 AND stock<=5 ORDER BY stock LIMIT 20').map(product) });
        }
        if (section === 'jawafa') {
          if (method !== 'GET') fail(405, 'مصدر جوافة هنا للقراءة فقط');
          const bridge = createJawafaBridge({ url: options.jawafaBridgeUrl || process.env.JAWAFA_BRIDGE_URL || 'http://127.0.0.1:3456', fetchImpl: options.jawafaFetchImpl || fetch });
          try {
            if (p[2] === 'source') return send(200, await bridge.status());
            if (p[2] === 'catalog-preview') return send(200, await bridge.catalogPreview());
          } catch {
            fail(503, 'جسر جوافة غير متصل أو لم يجتز تحقق القراءة', 'jawafa_bridge_unavailable');
          }
        }
        if (section === 'products') {
          if (method === 'GET') return send(200, { products: all('SELECT * FROM products ORDER BY updated_at DESC').map(product) });
          if (method === 'POST' && !p[2]) { const productId = body.id ? text(body.id, 'معرّف المنتج', 1, 100) : id('prd'); if (!/^[\w-]+$/.test(productId)) fail(400, 'معرّف المنتج يقبل الأحرف الإنجليزية والأرقام والشرطة'); if (get('SELECT id FROM products WHERE id=?', productId)) fail(409, 'معرّف المنتج مستخدم'); const data = validateProduct({ ...body, id: productId }); run('INSERT INTO products VALUES(?,?,?,?,?)', productId, json(data), integer(body.stock ?? 0, 'المخزون', 0, 1e7), body.active === false ? 0 : 1, now()); audit(actor, 'product.create', productId); return send(201, { product: product(get('SELECT * FROM products WHERE id=?', productId)) }); }
          const old = get('SELECT * FROM products WHERE id=?', p[2]); if (!old) fail(404, 'المنتج غير موجود', 'not_found');
          if (method === 'PATCH') { const data = validateProduct({ ...body, id: old.id }, parse(old.data)); run('UPDATE products SET data=?,stock=?,active=?,updated_at=? WHERE id=?', json(data), body.stock !== undefined ? integer(body.stock, 'المخزون', 0, 1e7) : old.stock, body.active !== undefined ? body.active ? 1 : 0 : old.active, now(), old.id); audit(actor, 'product.update', old.id); ext.emit('productsChanged', [old.id]); return send(200, { product: product(get('SELECT * FROM products WHERE id=?', old.id)) }); }
          if (method === 'DELETE') { transaction(() => { run("UPDATE products SET active=0,updated_at=? WHERE json_extract(data,'$.variantOf')=?", now(), old.id); run('UPDATE products SET active=0,updated_at=? WHERE id=?', now(), old.id); audit(actor, 'product.archive', old.id); }); return send(200, { ok: true }); }
        }
        if (section === 'offers') {
          if (method === 'GET') return send(200, { offers: all('SELECT * FROM products WHERE active=1 ORDER BY updated_at DESC').map(product).filter((row) => row.oldPrice != null && row.oldPrice > row.price) });
          if (method === 'POST' && p[2] === 'import') {
            if (body.confirm !== true) fail(409, 'مطلوب تأكيد استيراد العروض إلى قاعدة المتجر فقط');
            if (!Array.isArray(body.items) || !body.items.length || body.items.length > 1000) fail(400, 'قائمة العروض غير صالحة');
            const seen = new Set();
            const checked = body.items.map((item) => {
              const productId = text(item.id, 'رمز الصنف', 1, 100);
              if (seen.has(productId)) fail(400, 'صنف مكرر في العروض'); seen.add(productId);
              const original = get('SELECT * FROM products WHERE id=? AND active=1', productId);
              if (!original) fail(404, 'العرض يشير إلى صنف غير موجود أو غير منشور');
              const price = money(number(item.price, 'سعر العرض', 0.001, 1e7));
              const oldPrice = money(number(item.oldPrice, 'السعر السابق', price, 1e7));
              return { id: productId, original, price, oldPrice };
            });
            transaction(() => {
              for (const item of checked) {
                const data = parse(item.original.data, {});
                run('UPDATE products SET data=?,updated_at=? WHERE id=?', json({ ...data, price: item.price, oldPrice: item.oldPrice }), now(), item.id);
              }
              audit(actor, 'offers.import', '', { count: checked.length }); ext.emit('productsChanged', checked.map((item) => item.id));
            });
            return send(200, { imported: checked.length, commerceOnly: true });
          }
        }
        if (section === 'inventory') {
          if (method === 'POST' && p[2] === 'jawafa-preview') {
            const prepared = jawafaSnapshot(body);
            return send(200, { snapshotAt: prepared.snapshotAt, count: prepared.count, preview: prepared.details.slice(0, 25), source: prepared.source, applied: false });
          }
          if (method === 'POST' && p[2] === 'jawafa-import') {
            if (body.confirm !== true) fail(409, 'يلزم تأكيد نقل الكميات إلى قاعدة المتجر فقط');
            const prepared = jawafaSnapshot(body);
            return send(200, { ...importInventory({ items: prepared.items, mode: 'replace' }, actor), source: prepared.source, snapshotAt: prepared.snapshotAt });
          }
          if (method === 'POST' && p[2] === 'import') return send(200, importInventory(body, actor));
          if (p[2] === 'undo') {
            if (method === 'GET') return send(200, { undo: inventoryUndoSummary() });
            if (method === 'POST') return send(200, undoInventory(text(body.importId, 'معرّف الاستيراد', 1, 100), actor));
          }
          if (p[2] === 'connector') {
            if (method === 'GET') return send(200, { connector: connectorPublic() });
            if (method === 'PUT') { const url = await externalUrl(text(body.url, 'عنوان خادم المخزون', 8, 2000)), previous = setting('inventoryConnector', {}); const token = body.token !== undefined ? body.token ? encrypt(text(body.token, 'رمز الاتصال', 1, 4000)) : null : previous.token; setSetting('inventoryConnector', { url: url.toString(), token, lastSyncAt: null, lastResult: null }); audit(actor, 'inventory.connector', '', { url: url.origin }); return send(200, { connector: connectorPublic() }); }
          }
          if (method === 'POST' && p[2] === 'sync') {
            const connector = setting('inventoryConnector', {}); if (!connector.url) fail(409, 'أعدّ عنوان تطبيق المخزون أولًا', 'not_configured');
            const url = await externalUrl(connector.url), controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
            try { const response = await (options.fetchImpl || fetch)(url, { headers: connector.token ? { Authorization: `Bearer ${decrypt(connector.token)}` } : {}, redirect: 'error', signal: controller.signal }); if (!response.ok) fail(502, 'رفض خادم المخزون طلب المزامنة', 'upstream_error');
              let size = 0; const chunks = []; for await (const chunk of response.body) { size += chunk.length; if (size > 2_000_000) { controller.abort(); fail(502, 'بيانات المخزون أكبر من الحد المسموح'); } chunks.push(chunk); }
              let payload; try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(502, 'استجابة تطبيق المخزون ليست JSON صالحًا'); }
              const snapshot = payload?.schema === 'jawafa-inventory-v1' ? jawafaSnapshot(payload) : null;
               const result = importInventory({ items: snapshot ? snapshot.items : Array.isArray(payload) ? payload : payload.items || payload.products, mode: 'replace' }, actor);
              setSetting('inventoryConnector', { ...connector, lastSyncAt: now(), lastResult: { imported: result.imported, created: result.created, updated: result.updated } }); return send(200, { ...result, connector: connectorPublic() });
            } catch (error) { if (error.status) throw error; fail(502, 'تعذر الاتصال بخادم المخزون أو انتهت المهلة', 'upstream_error'); } finally { clearTimeout(timeout); }
          }
        }
        if (section === 'orders') {
          if (method === 'GET') return send(200, { orders: all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1000').map(order) });
          if (method === 'PATCH' && p[2]) { const o = get('SELECT * FROM orders WHERE id=?', p[2]); if (!o) fail(404, 'الطلب غير موجود', 'not_found'); return send(200, { order: transaction(() => transition(o, body.status, actor, body.driverId)) }); }
        }
        if (section === 'users') {
          if (method === 'GET') return send(200, { users: all('SELECT * FROM users ORDER BY created_at DESC LIMIT 1000').map((u) => ({ ...publicUser(u), walletBalance: balance(u.id) })) });
          if (method === 'PATCH' && p[2]) { if (!['customer', 'driver', 'admin'].includes(body.role)) fail(400, 'الدور غير صالح'); const user = get('SELECT * FROM users WHERE id=?', p[2]); if (!user) fail(404, 'المستخدم غير موجود', 'not_found'); if (user.role === 'admin' && body.role !== 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role='admin'").n <= 1) fail(409, 'لا يمكن إزالة آخر مدير'); run('UPDATE users SET role=? WHERE id=?', body.role, user.id); audit(actor, 'user.role', user.id, { role: body.role }); return send(200, { user: publicUser(get('SELECT * FROM users WHERE id=?', user.id)) }); }
        }
        if (section === 'tickets') {
          if (method === 'GET') return send(200, { tickets: all('SELECT * FROM tickets ORDER BY updated_at DESC LIMIT 500').map(ticketItem) });
          const ticket = get('SELECT * FROM tickets WHERE id=?', p[2]); if (!ticket) fail(404, 'التذكرة غير موجودة', 'not_found');
          if (method === 'PATCH' && !p[3]) { if (!['open', 'resolved'].includes(body.status)) fail(400, 'حالة التذكرة غير صالحة'); run('UPDATE tickets SET status=?,updated_at=? WHERE id=?', body.status, now(), ticket.id); audit(actor, 'ticket.status', ticket.id, { status: body.status }); return send(200, { ticket: ticketItem(get('SELECT * FROM tickets WHERE id=?', ticket.id)) }); }
          if (method === 'POST' && p[3] === 'replies') { const time = now(); run('INSERT INTO ticket_replies VALUES(?,?,?,?,?)', id('rpl'), ticket.id, actor.id, text(body.message, 'الرد', 2, 5000), time); run('UPDATE tickets SET updated_at=?,status=\'open\' WHERE id=?', time, ticket.id); notify(ticket.user_id, 'رد من دعم لُقطة', 'يوجد رد جديد على تذكرتك'); audit(actor, 'ticket.reply', ticket.id); return send(201, { ticket: ticketItem(get('SELECT * FROM tickets WHERE id=?', ticket.id)) }); }
        }
        if (section === 'coupons') {
          if (method === 'GET') return send(200, { coupons: all('SELECT * FROM coupons ORDER BY code').map(coupon) });
          const old = p[2] ? get('SELECT * FROM coupons WHERE id=?', p[2]) : null;
          if (p[2] && !old) fail(404, 'رمز الخصم غير موجود', 'not_found');
          if (method === 'DELETE') { run('UPDATE coupons SET active=0 WHERE id=?', old.id); audit(actor, 'coupon.disable', old.id); return send(200, { ok: true }); }
          if (method === 'POST' || method === 'PATCH') {
            const input = { ...(old ? coupon(old) : {}), ...body }, code = text(input.code, 'رمز الخصم', 2, 40).toUpperCase(); if (!/^[A-Z0-9_-]+$/.test(code)) fail(400, 'رمز الخصم يقبل أحرفًا إنجليزية وأرقامًا'); if (!['percent', 'fixed'].includes(input.type)) fail(400, 'نوع الخصم غير صالح'); const value = number(input.value, 'قيمة الخصم', 0.001, input.type === 'percent' ? 100 : 1e7), minimum = number(input.minSubtotal ?? 0, 'الحد الأدنى', 0, 1e7), maxUses = input.maxUses == null ? null : integer(input.maxUses, 'حد الاستخدام', 1, 1e7), expiresAt = input.expiresAt ? date(input.expiresAt, 'تاريخ الانتهاء') : null;
            const duplicate = get('SELECT id FROM coupons WHERE code=?', code); if (duplicate && duplicate.id !== old?.id) fail(409, 'رمز الخصم مستخدم'); const couponId = old?.id || id('cpn');
            run('INSERT INTO coupons(id,code,type,value,min_subtotal,max_uses,uses,expires_at,active) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,type=excluded.type,value=excluded.value,min_subtotal=excluded.min_subtotal,max_uses=excluded.max_uses,expires_at=excluded.expires_at,active=excluded.active', couponId, code, input.type, value, minimum, maxUses, old?.uses || 0, expiresAt, input.active === false ? 0 : 1); audit(actor, 'coupon.save', couponId); return send(old ? 200 : 201, { coupon: coupon(get('SELECT * FROM coupons WHERE id=?', couponId)) });
          }
        }
        if (method === 'POST' && section === 'wallet' && p[2] === 'adjust') {
          const userId = text(body.userId, 'المستخدم', 1, 100), amount = money(number(body.amount, 'المبلغ', -1e7, 1e7)), note = text(body.note, 'سبب التعديل', 5, 1000); if (!amount) fail(400, 'المبلغ لا يمكن أن يكون صفرًا'); if (!get('SELECT id FROM users WHERE id=?', userId)) fail(404, 'المستخدم غير موجود', 'not_found'); const result = transaction(() => { if (balance(userId) + amount < 0) fail(409, 'لا يمكن جعل الرصيد سالبًا'); const entry = ledger(userId, amount, 'adjustment', note); audit(actor, 'wallet.adjust', userId, { amount, note }); notify(userId, 'تحديث رصيد المحفظة', `تم تعديل الرصيد بمقدار ${amount} ${setting('currency')}`); return { balance: balance(userId), transaction: entry }; }); return send(200, result);
        }
        if (section === 'returns') {
          if (method === 'GET') return send(200, { returns: all('SELECT * FROM returns ORDER BY created_at DESC LIMIT 1000').map(returnItem) });
          if (method === 'PATCH' && p[2]) {
            const r = get('SELECT * FROM returns WHERE id=?', p[2]);
            if (!r) fail(404, 'طلب الإرجاع غير موجود', 'not_found');
            if (!['approved', 'rejected'].includes(body.status)) fail(400, 'حالة الإرجاع غير صالحة');
            if (r.status !== 'requested') fail(409, 'تمت معالجة طلب الإرجاع مسبقًا');
            const note = body.note ? text(body.note, 'ملاحظة', 1, 1000) : '';
            transaction(() => {
              if (body.status === 'approved') {
                const o = get('SELECT * FROM orders WHERE id=?', r.order_id), plan = ext.returnPlan(r, o);
                const returnedLines = plan ? plan.lines : parse(o.items);
                for (const line of returnedLines) run('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?', line.quantity, now(), line.productId);
                const branchId = parse(get('SELECT data FROM order_extras WHERE order_id=?', o.id)?.data, {}).branchId;
                if (branchId) ext.moveBranchStock(branchId, returnedLines, 1);
                let refund = plan ? plan.refund : o.total;
                const earned = get("SELECT points FROM reward_ledger WHERE order_id=? AND type='earned'", o.id);
                const reversed = earned ? plan ? Math.min(earned.points, Math.round(earned.points * plan.refund / Math.max(o.total, 0.001))) : earned.points : 0;
                if (reversed > 0) {
                  const shortfall = Math.max(0, reversed - Math.max(0, rewardBalance(o.user_id)));
                  rewardLedger(o.user_id, -reversed, 'reversed', `عكس نقاط طلب مرتجع ${o.id}`, o.id);
                  if (shortfall) {
                    refund = money(refund - shortfall / 100);
                    rewardLedger(o.user_id, shortfall, 'settled', `تسوية نقاط مستبدلة من استرداد ${o.id}`, o.id);
                  }
                }
                ledger(o.user_id, refund, 'return_refund', 'استرداد طلب مرتجع إلى المحفظة الداخلية', o.id);
                run('UPDATE orders SET payment_status=?,updated_at=? WHERE id=?', plan ? 'partially_refunded' : 'refunded', now(), o.id);
                ext.emit('productsChanged', (plan ? plan.lines : parse(o.items)).map((line) => line.productId));
              }
              run('UPDATE returns SET status=?,note=?,updated_at=? WHERE id=?', body.status, note, now(), r.id);
              audit(actor, 'return.resolve', r.id, { status: body.status });
              notify(r.user_id, 'تحديث طلب الإرجاع', body.status === 'approved' ? 'تم قبول الإرجاع وإضافة المبلغ إلى محفظتك الداخلية' : 'تم رفض طلب الإرجاع', r.order_id);
            });
            return send(200, { returnRequest: returnItem(get('SELECT * FROM returns WHERE id=?', r.id)) });
          }
        }
        if (section === 'settings') {
          if (method === 'GET') return send(200, { settings: publicSettings() });
          if (method === 'PATCH') { const updates = {}; if (body.storeName !== undefined) updates.storeName = text(body.storeName, 'اسم المتجر', 2, 100); if (body.currency !== undefined) { if (!/^[A-Z]{3}$/.test(body.currency)) fail(400, 'رمز العملة غير صالح'); if (body.currency !== setting('currency') && (get('SELECT id FROM orders LIMIT 1') || get('SELECT id FROM wallet LIMIT 1'))) fail(409, 'لا يمكن تغيير العملة بعد تسجيل معاملات مالية'); updates.currency = body.currency; } if (body.country !== undefined) { if (!/^[A-Z]{2}$/.test(body.country)) fail(400, 'رمز الدولة غير صالح'); updates.country = body.country; } for (const key of ['shippingFee', 'freeShippingThreshold']) if (body[key] !== undefined) updates[key] = money(number(body[key], key, 0, 1e7)); if (body.returnsDays !== undefined) updates.returnsDays = integer(body.returnsDays, 'مهلة الإرجاع', 1, 365);
             if (body.storefront !== undefined) {
               if (!body.storefront || typeof body.storefront !== 'object' || Array.isArray(body.storefront)) fail(400, 'إعداد تصميم المتجر غير صالح');
               const prior = setting('storefront', {});
               const design = { ...prior };
               if (body.storefront.accentColor !== undefined) {
                 if (typeof body.storefront.accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.storefront.accentColor)) fail(400, 'اللون يجب أن يكون بصيغة HEX');
                 design.accentColor = body.storefront.accentColor;
               }
               for (const key of ['heroTitle', 'heroSubtitle']) if (body.storefront[key] !== undefined) design[key] = text(body.storefront[key], key, 1, key === 'heroTitle' ? 120 : 300);
               if (body.storefront.showAssistant !== undefined) {
                 if (typeof body.storefront.showAssistant !== 'boolean') fail(400, 'حالة المساعد غير صالحة');
                 design.showAssistant = body.storefront.showAssistant;
               }
               // The store's Instagram and Facebook pages, shown to shoppers as "follow us". Only the official hosts over
               // HTTPS are accepted, saved without query or fragment; an empty value removes the link.
               for (const [key, hosts, message] of [['instagram', ['instagram.com', 'www.instagram.com'], 'رابط إنستغرام يجب أن يبدأ بـ https://instagram.com/'], ['facebook', ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'], 'رابط فيسبوك يجب أن يبدأ بـ https://facebook.com/']]) {
                 const raw = body.storefront[key];
                 if (raw === undefined) continue;
                 if (raw === '' || raw === null) { delete design[key]; continue; }
                 let link = null; try { link = typeof raw === 'string' && raw.length <= 300 ? new URL(raw.trim()) : null; } catch { link = null; }
                 if (!link || link.protocol !== 'https:' || !hosts.includes(link.hostname.toLowerCase()) || link.username || link.password || link.port || !/^\/[A-Za-z0-9._\-\/]{1,120}$/.test(link.pathname)) fail(400, message);
                 design[key] = `https://${link.hostname.toLowerCase()}${link.pathname.replace(/\/+$/, '')}`;
               }
               updates.storefront = design;
             }
             if (ext) ext.validateSettingsExtras(body, updates);
             transaction(() => { for (const [key, value] of Object.entries(updates)) setSetting(key, value); audit(actor, 'settings.update', '', updates); }); return send(200, { settings: publicSettings() }); }
        }
        if (method === 'GET' && section === 'audit') return send(200, { events: all('SELECT id,actor_id AS actorId,action,entity_id AS entityId,detail,created_at AS createdAt FROM audit ORDER BY created_at DESC,id DESC LIMIT 500').map((r) => ({ ...r, detail: parse(r.detail, {}) })) });
        if (section === 'agent-keys') {
          if (method === 'GET') return send(200, { keys: all('SELECT id,name,scopes,expires_at AS expiresAt,revoked,created_at AS createdAt,last_used_at AS lastUsedAt FROM agent_keys ORDER BY created_at DESC').map((r) => ({ ...r, scopes: parse(r.scopes), revoked: !!r.revoked })) });
          if (method === 'POST' && !p[2]) { const name = text(body.name, 'اسم الوكيل', 2, 100); if (!Array.isArray(body.scopes) || !body.scopes.length || body.scopes.some((s) => !SCOPES.includes(s))) fail(400, 'صلاحيات الوكيل غير صالحة'); const scopes = [...new Set(body.scopes)], expiresAt = body.expiresAt ? date(body.expiresAt, 'انتهاء المفتاح') : null; if (expiresAt && expiresAt <= now()) fail(400, 'تاريخ الانتهاء يجب أن يكون في المستقبل'); const keyId = id('agent'), token = `lq_agent_${randomBytes(32).toString('base64url')}`, createdAt = now(); run('INSERT INTO agent_keys VALUES(?,?,?,?,?,0,?,NULL)', keyId, name, hash(token), json(scopes), expiresAt, createdAt); audit(actor, 'agent.key.create', keyId, { name, scopes }); return send(201, { key: { id: keyId, name, scopes, expiresAt, revoked: false, createdAt }, token }); }
          if (method === 'DELETE' && p[2]) { if (!get('SELECT id FROM agent_keys WHERE id=?', p[2])) fail(404, 'المفتاح غير موجود'); run('UPDATE agent_keys SET revoked=1 WHERE id=?', p[2]); audit(actor, 'agent.key.revoke', p[2]); return send(200, { ok: true }); }
        }
        if (section === 'agent-jobs') {
          if (method === 'GET') return send(200, { jobs: all('SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT 200').map(jobItem) });
          if (method === 'POST') { const title = text(body.title, 'عنوان المهمة', 3, 200), description = text(body.description, 'وصف المهمة', 5, 10000), type = body.type || 'audit'; if (!['repair', 'development', 'audit'].includes(type)) fail(400, 'نوع المهمة غير صالح'); const jobId = id('job'), time = now(); run('INSERT INTO agent_jobs VALUES(?,?,?,?,?,?,?,?,?)', jobId, title, description, type, 'queued', '', '', time, time); audit(actor, 'agent.job.create', jobId); return send(201, { job: jobItem(get('SELECT * FROM agent_jobs WHERE id=?', jobId)) }); }
        }
      }
      if (method === 'GET' && path === '/api/agent/capabilities') { const actor = identity(req); if (actor.kind !== 'agent' && actor.role !== 'admin') fail(403, 'غير مصرح'); return send(200, { scopes: actor.kind === 'agent' ? actor.scopes : SCOPES, operations: ['products CRUD', 'inventory import/sync', 'order status/assignment', 'store settings', 'maintenance jobs'], arbitraryCodeExecution: false, developmentRequiresExternalAgent: true }); }
      if (method === 'PATCH' && (match = path.match(/^\/api\/agent\/jobs\/([^/]+)$/))) { const actor = admin(req, 'jobs:write'), job = get('SELECT * FROM agent_jobs WHERE id=?', match[1]); if (!job) fail(404, 'المهمة غير موجودة', 'not_found'); if (!['running', 'completed', 'failed'].includes(body.status)) fail(400, 'حالة المهمة غير صالحة'); if (['completed', 'failed'].includes(job.status)) fail(409, 'المهمة منتهية'); const result = body.result ? text(body.result, 'النتيجة', 1, 20000) : '', evidence = body.testEvidence ? text(typeof body.testEvidence === 'string' ? body.testEvidence : json(body.testEvidence), 'دليل الاختبار', 5, 20000) : ''; if (body.status === 'completed' && !evidence) fail(400, 'لا يمكن إكمال المهمة دون دليل اختبار', 'test_evidence_required'); run('UPDATE agent_jobs SET status=?,result=?,test_evidence=?,updated_at=? WHERE id=?', body.status, result, evidence, now(), job.id); audit(actor, 'agent.job.update', job.id, { status: body.status }); return send(200, { job: jobItem(get('SELECT * FROM agent_jobs WHERE id=?', job.id)) }); }
      if (method === 'GET' && path === '/api/auth/facebook/status') { const actor = requireUser(req), link = get('SELECT * FROM facebook_links WHERE user_id=?', actor.id); return send(200, { configured: facebookConfigured, linked: !!link, connected: !!link, profile: link ? { id: link.facebook_id, name: link.name } : null, permissions: link ? parse(link.permissions, []) : [] }); }
      if (method === 'POST' && path === '/api/auth/facebook/start') {
        const actor = requireUser(req); if (!facebookConfigured) fail(503, 'ربط فيسبوك يحتاج إعداد تطبيق Meta ومعرّف التطبيق وسرّه وعنوان العودة على الخادم', 'not_configured');
        let returnUrl = body.returnUrl || body.redirectUri || null;
        if (returnUrl) { let parsed; try { parsed = new URL(returnUrl); } catch { fail(400, 'عنوان العودة غير صالح'); } const origins = (process.env.FACEBOOK_RETURN_ORIGINS || '').split(','); if (parsed.protocol !== 'luqta:' && !origins.includes(parsed.origin)) fail(400, 'عنوان العودة غير مسموح'); }
        const state = randomBytes(32).toString('base64url'); run('INSERT INTO oauth_states VALUES(?,?,?,?)', hash(state), actor.id, new Date(Date.now() + 10 * 60_000).toISOString(), returnUrl);
        const auth = new URL(`https://www.facebook.com/${oauthConfig.version}/dialog/oauth`); auth.searchParams.set('client_id', oauthConfig.appId); auth.searchParams.set('redirect_uri', oauthConfig.callback); auth.searchParams.set('state', state); auth.searchParams.set('scope', 'public_profile'); auth.searchParams.set('response_type', 'code'); return send(200, { url: auth.toString() });
      }
      if (method === 'GET' && path === '/api/auth/facebook/callback') {
        if (!facebookConfigured) fail(503, 'ربط فيسبوك غير معدّ', 'not_configured'); const state = url.searchParams.get('state'), code = url.searchParams.get('code'); if (!state || !code) fail(400, 'لم تكتمل موافقة فيسبوك'); const saved = get('SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?', hash(state), now()); if (!saved) fail(400, 'انتهت محاولة الربط أو حالة العودة غير صالحة'); run('DELETE FROM oauth_states WHERE state_hash=?', hash(state));
        const tokenUrl = new URL(`https://graph.facebook.com/${oauthConfig.version}/oauth/access_token`); tokenUrl.searchParams.set('client_id', oauthConfig.appId); tokenUrl.searchParams.set('client_secret', oauthConfig.appSecret); tokenUrl.searchParams.set('redirect_uri', oauthConfig.callback); tokenUrl.searchParams.set('code', code);
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
        try { const tokenResponse = await (options.facebookFetch || fetch)(tokenUrl, { signal: controller.signal }); const tokens = await tokenResponse.json(); if (!tokenResponse.ok || !tokens.access_token) fail(502, 'لم يتمكن فيسبوك من منح رمز الوصول'); const profileUrl = new URL(`https://graph.facebook.com/${oauthConfig.version}/me`); profileUrl.searchParams.set('fields', 'id,name'); const profileResponse = await (options.facebookFetch || fetch)(profileUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: controller.signal }); const profile = await profileResponse.json(); if (!profileResponse.ok || !profile.id) fail(502, 'تعذر قراءة الملف الشخصي المصرّح به'); run('INSERT INTO facebook_links VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET facebook_id=excluded.facebook_id,name=excluded.name,token=excluded.token,permissions=excluded.permissions,linked_at=excluded.linked_at', saved.user_id, String(profile.id), String(profile.name || ''), encrypt(tokens.access_token), json(['public_profile']), now()); notify(saved.user_id, 'تم ربط فيسبوك', 'تم ربط الملف الشخصي بعد موافقتك. لم تُمنح صلاحيات إدارة الصفحات أو الحساب الإعلاني.'); if (saved.return_url) { const target = new URL(saved.return_url); target.searchParams.set('facebook', 'connected'); res.writeHead(302, { Location: target.toString() }); res.end(); return; } return send(200, { ok: true, connected: true });
        } catch (error) { if (error.status) throw error; fail(502, 'فشل الاتصال بفيسبوك أو انتهت المهلة'); } finally { clearTimeout(timer); }
      }
      if (method === 'DELETE' && path === '/api/auth/facebook' || method === 'POST' && path === '/api/auth/facebook/disconnect') { const actor = requireUser(req); run('DELETE FROM facebook_links WHERE user_id=?', actor.id); return send(200, { ok: true }); }
      if (await ext.handle({ req, res, url, path, method, body, send })) return;
      fail(404, 'المسار غير موجود', 'not_found');
    } catch (error) {
      if (!error.status) console.error('Commerce request failed:', error.message);
      send(error.status || 500, { error: error.status ? error.message : 'حدث خطأ في الخادم؛ حاول مجددًا', code: error.code || 'server_error', ...(error.status && error.details ? { details: error.details } : {}) });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  return { server, db, close: () => new Promise((resolveClose, reject) => server.close((error) => { try { db.close(); } catch {} if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolveClose(); })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await createCommerceServer({ staticDir: process.env.STATIC_DIR });
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 8787);
  app.server.listen(port, host, () => console.log(`Luqta commerce listening on http://${host}:${port}/api`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
