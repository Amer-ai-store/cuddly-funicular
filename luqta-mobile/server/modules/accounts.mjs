// Accounts: profile, privacy and notification preferences, signed-in devices, data export and merchant (vendor) accounts.
export const name = 'accounts';

const OUTFITS = ['none', 'scarf', 'cape', 'bowtie', 'hoodie'];
const ACCESSORIES = ['none', 'cap', 'crown', 'glasses', 'headphones', 'flower'];
const MOTIONS = ['wave', 'walk', 'jump', 'come', 'stop', 'dance'];
export const PREFERENCE_DEFAULTS = {
  locale: 'ar',
  displayCurrency: null,
  weeklyBudget: null,
  interests: [],
  onboarded: false,
  notifications: { orders: true, offers: true, support: true, priceAlerts: true, pantry: true, robot: true },
  privacy: { personalizedRecommendations: true, shareLocationWithDriver: true, saveSearchHistory: true, analytics: false, marketingEmails: false },
  // The companion is the mockups' character: black vest (color), red trousers, black boots, a beard.
  robot: { name: 'لُقطي', color: '#141414', outfit: 'none', accessory: 'none', size: 1, reduceMotion: false, voice: true, motion: 'wave', faceConsent: false,
    skin: '#E0A27C', hair: '#3F281B', pants: '#C4161B', boots: '#101010', beard: true, use3d: true },
};

function deviceName(req, body) {
  if (typeof body?.device === 'string' && body.device.trim()) return body.device.trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 80);
  const agent = String(req?.headers?.['user-agent'] || '');
  const system = /Android/i.test(agent) ? 'Android' : /iPhone|iPad/i.test(agent) ? 'iOS' : /Windows/i.test(agent) ? 'Windows' : /Mac OS/i.test(agent) ? 'macOS' : /Linux/i.test(agent) ? 'Linux' : /okhttp|Expo|ReactNative/i.test(agent) ? 'تطبيق الجوال' : 'جهاز غير معروف';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : '';
  return browser ? `${system} · ${browser}` : system;
}

export function install(c, api) {
  const { db, get, all, run, transaction, fail, text, integer, number, id, now, hash, json, parse, money, requireUser, admin, audit, notify, publicUser } = c;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),phone TEXT,avatar TEXT,birthday TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS session_meta(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),public_id TEXT UNIQUE NOT NULL,device TEXT NOT NULL,created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vendors(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('active','suspended')),commission REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vendor_members(vendor_id TEXT NOT NULL REFERENCES vendors(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','staff')),created_at TEXT NOT NULL,PRIMARY KEY(vendor_id,user_id));
  `);

  // ---- preferences ----
  const preferences = (userId) => {
    const saved = parse(get('SELECT data FROM user_preferences WHERE user_id=?', userId)?.data, {});
    return { ...PREFERENCE_DEFAULTS, ...saved, notifications: { ...PREFERENCE_DEFAULTS.notifications, ...saved.notifications }, privacy: { ...PREFERENCE_DEFAULTS.privacy, ...saved.privacy }, robot: { ...PREFERENCE_DEFAULTS.robot, ...saved.robot } };
  };
  api.provide('preferences', preferences);
  const bools = (input, defaults, field) => {
    if (input === undefined) return {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, `إعدادات ${field} غير صالحة`);
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (!(key in defaults)) fail(400, `إعداد غير معروف: ${key}`);
      if (typeof value !== 'boolean') fail(400, `قيمة ${key} يجب أن تكون نعم أو لا`);
      out[key] = value;
    }
    return out;
  };
  const validatePreferences = (body, current) => {
    const next = { ...current };
    if (body.locale !== undefined) { if (!['ar', 'en'].includes(body.locale)) fail(400, 'اللغة غير مدعومة'); next.locale = body.locale; }
    if (body.displayCurrency !== undefined) { if (body.displayCurrency !== null && !/^[A-Z]{3}$/.test(body.displayCurrency)) fail(400, 'رمز العملة غير صالح'); next.displayCurrency = body.displayCurrency; }
    if (body.weeklyBudget !== undefined) next.weeklyBudget = body.weeklyBudget === null ? null : money(number(body.weeklyBudget, 'الميزانية الأسبوعية', 1, 100000));
    if (body.interests !== undefined) {
      if (!Array.isArray(body.interests) || body.interests.length > 12 || body.interests.some((v) => typeof v !== 'string' || !/^[\w-]{1,40}$/.test(v))) fail(400, 'قائمة الاهتمامات غير صالحة');
      next.interests = [...new Set(body.interests)];
    }
    if (body.onboarded !== undefined) { if (typeof body.onboarded !== 'boolean') fail(400, 'قيمة الإعداد غير صالحة'); next.onboarded = body.onboarded; }
    next.notifications = { ...current.notifications, ...bools(body.notifications, PREFERENCE_DEFAULTS.notifications, 'الإشعارات') };
    next.privacy = { ...current.privacy, ...bools(body.privacy, PREFERENCE_DEFAULTS.privacy, 'الخصوصية') };
    if (body.robot !== undefined) {
      const r = body.robot;
      if (!r || typeof r !== 'object' || Array.isArray(r)) fail(400, 'إعدادات الشخصية غير صالحة');
      const robot = { ...current.robot };
      if (r.name !== undefined) robot.name = text(r.name, 'اسم الشخصية', 1, 20);
      for (const key of ['color', 'skin', 'hair', 'pants', 'boots']) if (r[key] !== undefined) { if (typeof r[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r[key])) fail(400, 'لون الشخصية يجب أن يكون HEX'); robot[key] = r[key]; }
      for (const [key, options] of [['outfit', OUTFITS], ['accessory', ACCESSORIES], ['motion', MOTIONS]]) if (r[key] !== undefined) { if (!options.includes(r[key])) fail(400, `اختيار ${key} غير متاح`); robot[key] = r[key]; }
      if (r.size !== undefined) robot.size = Math.round(number(r.size, 'حجم الشخصية', 0.6, 1.4) * 100) / 100;
      for (const key of ['reduceMotion', 'voice', 'faceConsent', 'beard', 'use3d']) if (r[key] !== undefined) { if (typeof r[key] !== 'boolean') fail(400, `قيمة ${key} غير صالحة`); robot[key] = r[key]; }
      next.robot = robot;
    }
    return next;
  };
  api.route('GET', '/me/preferences', ({ req }) => ({ preferences: preferences(requireUser(req).id) }));
  api.route('PATCH', '/me/preferences', ({ req, body }) => {
    const actor = requireUser(req), next = validatePreferences(body, preferences(actor.id));
    run('INSERT INTO user_preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', actor.id, json(next), now());
    return { preferences: next };
  });

  // ---- profile ----
  const profile = (user) => {
    const row = get('SELECT * FROM user_profiles WHERE user_id=?', user.id) || {};
    return { ...publicUser(user), phone: row.phone || '', avatar: row.avatar || '', birthday: row.birthday || '' };
  };
  api.route('GET', '/me/profile', ({ req }) => ({ profile: profile(requireUser(req)) }));
  api.route('PATCH', '/me/profile', ({ req, body }) => {
    const actor = requireUser(req), old = get('SELECT * FROM user_profiles WHERE user_id=?', actor.id) || {};
    let phone = old.phone || '', avatar = old.avatar || '', birthday = old.birthday || '';
    if (body.phone !== undefined) { phone = body.phone ? text(body.phone, 'الهاتف', 6, 30) : ''; if (phone && !/^[+\d\s()\-٠-٩۰-۹]+$/.test(phone)) fail(400, 'رقم الهاتف غير صالح'); }
    if (body.avatar !== undefined) { avatar = body.avatar ? text(body.avatar, 'الصورة الرمزية', 1, 40) : ''; if (avatar && !/^(emoji:.{1,8}|color:#[0-9a-fA-F]{6})$/u.test(avatar)) fail(400, 'الصورة الرمزية غير صالحة'); }
    if (body.birthday !== undefined) { birthday = body.birthday || ''; if (birthday && (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Date.parse(birthday) > Date.now())) fail(400, 'تاريخ الميلاد غير صالح'); }
    transaction(() => {
      if (body.name !== undefined) run('UPDATE users SET name=? WHERE id=?', text(body.name, 'الاسم', 2, 100), actor.id);
      run('INSERT INTO user_profiles VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,avatar=excluded.avatar,birthday=excluded.birthday,updated_at=excluded.updated_at', actor.id, phone, avatar, birthday, now());
    });
    return { profile: profile(get('SELECT * FROM users WHERE id=?', actor.id)) };
  });

  // ---- signed-in devices ----
  api.on('session', (tokenHash, user, req, body) => {
    run('DELETE FROM session_meta WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=?)', user.id, user.id);
    run('INSERT OR REPLACE INTO session_meta VALUES(?,?,?,?,?,?)', tokenHash, user.id, hash(`device:${tokenHash}`).slice(0, 24), deviceName(req, body), now(), now());
  });
  api.on('sessionSeen', (tokenHash) => {
    const fiveMinutesAgo = new Date(Date.now() - 300_000).toISOString();
    run('UPDATE session_meta SET last_seen_at=? WHERE token_hash=? AND last_seen_at<?', now(), tokenHash, fiveMinutesAgo);
  });
  api.route('GET', '/me/sessions', ({ req }) => {
    const actor = requireUser(req);
    const rows = all('SELECT s.token_hash,s.expires_at,m.public_id,m.device,m.created_at,m.last_seen_at FROM sessions s LEFT JOIN session_meta m ON m.token_hash=s.token_hash WHERE s.user_id=? AND s.expires_at>? ORDER BY COALESCE(m.last_seen_at,\'\') DESC', actor.id, now());
    return { sessions: rows.map((r) => ({ id: r.public_id || hash(`device:${r.token_hash}`).slice(0, 24), device: r.device || 'جلسة سابقة', createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at, current: r.token_hash === actor.tokenHash })) };
  });
  const sessionByPublicId = (userId, publicId) => all('SELECT token_hash FROM sessions WHERE user_id=?', userId).find((s) => hash(`device:${s.token_hash}`).slice(0, 24) === publicId);
  api.route('DELETE', '/me/sessions/:sessionId', ({ req, params }) => {
    const actor = requireUser(req), target = sessionByPublicId(actor.id, params.sessionId);
    if (!target) fail(404, 'الجلسة غير موجودة', 'not_found');
    if (target.token_hash === actor.tokenHash) fail(409, 'استخدم «تسجيل الخروج» لإنهاء الجلسة الحالية');
    transaction(() => { run('DELETE FROM sessions WHERE token_hash=?', target.token_hash); run('DELETE FROM session_meta WHERE token_hash=?', target.token_hash); });
    return { ok: true };
  });
  api.route('POST', '/me/sessions/revoke-others', ({ req }) => {
    const actor = requireUser(req);
    const removed = transaction(() => { const n = run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', actor.id, actor.tokenHash).changes; run('DELETE FROM session_meta WHERE user_id=? AND token_hash<>?', actor.id, actor.tokenHash); return n; });
    return { ok: true, removed };
  });

  // ---- export my data ----
  const exporters = [];
  api.provide('registerExport', (key, fn) => exporters.push([key, fn]));
  api.route('GET', '/me/export', ({ req }) => {
    const actor = requireUser(req); c.rate(req, 'export', 10);
    const data = {
      exportedAt: now(), format: 'luqta-account-export-v1',
      account: profile(actor), preferences: preferences(actor.id),
      addresses: all('SELECT id,data FROM addresses WHERE user_id=?', actor.id).map((r) => ({ id: r.id, ...parse(r.data, {}) })),
      orders: all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC', actor.id).map(c.order),
      returns: all('SELECT id,order_id AS orderId,reason,status,note,created_at AS createdAt FROM returns WHERE user_id=?', actor.id),
      wallet: all('SELECT id,amount,type,note,order_id AS orderId,created_at AS date FROM wallet WHERE user_id=? ORDER BY created_at', actor.id),
      rewards: all('SELECT id,points,type,note,order_id AS orderId,created_at AS date FROM reward_ledger WHERE user_id=? ORDER BY created_at', actor.id),
      wishlist: parse(get('SELECT product_ids FROM wishlists WHERE user_id=?', actor.id)?.product_ids, []),
      reviews: all('SELECT product_id AS productId,rating,title,body,created_at AS createdAt FROM reviews WHERE user_id=?', actor.id),
      tickets: all('SELECT id,subject,message,status,created_at AS createdAt FROM tickets WHERE user_id=?', actor.id),
      notifications: all('SELECT title,body,is_read AS read,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC', actor.id),
      devices: all('SELECT device,created_at AS createdAt,last_seen_at AS lastSeenAt FROM session_meta WHERE user_id=?', actor.id),
    };
    for (const [key, fn] of exporters) data[key] = fn(actor.id);
    return { export: data, filename: `luqta-data-${now().slice(0, 10)}.json` };
  });
  api.on('deleteUser', (userId) => {
    run('DELETE FROM user_profiles WHERE user_id=?', userId);
    run('DELETE FROM user_preferences WHERE user_id=?', userId);
    run('DELETE FROM session_meta WHERE user_id=?', userId);
    run('DELETE FROM vendor_members WHERE user_id=?', userId);
  });

  // ---- merchants (vendors) ----
  const vendorItem = (v) => ({ id: v.id, name: v.name, description: v.description, status: v.status, commission: v.commission, createdAt: v.created_at,
    members: all('SELECT m.user_id AS userId,m.role,u.name,u.email FROM vendor_members m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=? ORDER BY m.created_at', v.id),
    products: get("SELECT COUNT(*) AS n FROM products WHERE json_extract(data,'$.vendorId')=?", v.id).n });
  const membership = (req, vendorId) => {
    const actor = requireUser(req);
    const member = get('SELECT m.role,v.status FROM vendor_members m JOIN vendors v ON v.id=m.vendor_id WHERE m.vendor_id=? AND m.user_id=?', vendorId, actor.id);
    if (!member && actor.role !== 'admin') fail(403, 'هذا الحساب ليس عضوًا في هذا المتجر', 'forbidden');
    if (member && member.status !== 'active' && actor.role !== 'admin') fail(403, 'حساب التاجر موقوف مؤقتًا', 'vendor_suspended');
    return { actor, role: member?.role || 'admin' };
  };
  api.provide('vendorOf', (productData) => productData?.vendorId || null);
  api.route('GET', '/admin/vendors', ({ req }) => { admin(req); return { vendors: all('SELECT * FROM vendors ORDER BY created_at DESC').map(vendorItem) }; });
  api.route('POST', '/admin/vendors', ({ req, body }) => {
    const actor = admin(req), vendorId = id('vnd');
    run('INSERT INTO vendors VALUES(?,?,?,?,?,?)', vendorId, text(body.name, 'اسم التاجر', 2, 120), body.description ? text(body.description, 'وصف التاجر', 1, 1000) : '', 'active', body.commission == null ? 0 : number(body.commission, 'نسبة العمولة', 0, 50), now());
    audit(actor, 'vendor.create', vendorId);
    return [201, { vendor: vendorItem(get('SELECT * FROM vendors WHERE id=?', vendorId)) }];
  });
  api.route('PATCH', '/admin/vendors/:vendorId', ({ req, body, params }) => {
    const actor = admin(req), v = get('SELECT * FROM vendors WHERE id=?', params.vendorId); if (!v) fail(404, 'التاجر غير موجود', 'not_found');
    if (body.status !== undefined && !['active', 'suspended'].includes(body.status)) fail(400, 'حالة التاجر غير صالحة');
    run('UPDATE vendors SET name=?,description=?,status=?,commission=? WHERE id=?', body.name !== undefined ? text(body.name, 'اسم التاجر', 2, 120) : v.name, body.description !== undefined ? String(body.description).slice(0, 1000) : v.description, body.status ?? v.status, body.commission !== undefined ? number(body.commission, 'نسبة العمولة', 0, 50) : v.commission, v.id);
    audit(actor, 'vendor.update', v.id, { status: body.status });
    return { vendor: vendorItem(get('SELECT * FROM vendors WHERE id=?', v.id)) };
  });
  api.route('POST', '/admin/vendors/:vendorId/members', ({ req, body, params }) => {
    const actor = admin(req), v = get('SELECT * FROM vendors WHERE id=?', params.vendorId); if (!v) fail(404, 'التاجر غير موجود', 'not_found');
    const user = get('SELECT * FROM users WHERE email=?', c.email(body.email)); if (!user) fail(404, 'لا يوجد حساب بهذا البريد؛ اطلب من التاجر التسجيل أولًا', 'not_found');
    const role = body.role || 'staff'; if (!['owner', 'staff'].includes(role)) fail(400, 'دور العضو غير صالح');
    run('INSERT INTO vendor_members VALUES(?,?,?,?) ON CONFLICT(vendor_id,user_id) DO UPDATE SET role=excluded.role', v.id, user.id, role, now());
    notify(user.id, 'أصبحت تاجرًا في لُقطة', `أُضيف حسابك إلى متجر ${v.name}. افتح «لوحة التاجر» لإدارة منتجاتك.`);
    audit(actor, 'vendor.member', v.id, { userId: user.id, role });
    return [201, { vendor: vendorItem(get('SELECT * FROM vendors WHERE id=?', v.id)) }];
  });
  api.route('DELETE', '/admin/vendors/:vendorId/members/:userId', ({ req, params }) => {
    const actor = admin(req);
    if (!run('DELETE FROM vendor_members WHERE vendor_id=? AND user_id=?', params.vendorId, params.userId).changes) fail(404, 'العضو غير موجود', 'not_found');
    audit(actor, 'vendor.member.remove', params.vendorId, { userId: params.userId });
    return { ok: true };
  });
  api.route('GET', '/vendor/me', ({ req }) => {
    const actor = requireUser(req);
    return { vendors: all('SELECT v.*,m.role AS member_role FROM vendor_members m JOIN vendors v ON v.id=m.vendor_id WHERE m.user_id=? ORDER BY v.name', actor.id).map((v) => ({ id: v.id, name: v.name, status: v.status, role: v.member_role })) };
  });
  const vendorProducts = (vendorId) => all("SELECT * FROM products WHERE json_extract(data,'$.vendorId')=? ORDER BY updated_at DESC", vendorId);
  api.route('GET', '/vendor/:vendorId/products', ({ req, params }) => { membership(req, params.vendorId); return { products: vendorProducts(params.vendorId).map(c.product) }; });
  api.route('POST', '/vendor/:vendorId/products', ({ req, body, params }) => {
    const { actor } = membership(req, params.vendorId);
    const productId = body.id ? text(body.id, 'معرّف المنتج', 1, 100) : id('prd');
    if (!/^[\w-]+$/.test(productId)) fail(400, 'معرّف المنتج يقبل الأحرف الإنجليزية والأرقام والشرطة');
    if (get('SELECT id FROM products WHERE id=?', productId)) fail(409, 'معرّف المنتج مستخدم');
    const data = { ...c.validateProduct({ ...body, id: productId, variantOf: undefined }), vendorId: params.vendorId };
    run('INSERT INTO products VALUES(?,?,?,?,?)', productId, json(data), integer(body.stock ?? 0, 'المخزون', 0, 1e7), body.active === false ? 0 : 1, now());
    audit(actor, 'vendor.product.create', productId, { vendorId: params.vendorId });
    return [201, { product: c.product(get('SELECT * FROM products WHERE id=?', productId)) }];
  });
  api.route('PATCH', '/vendor/:vendorId/products/:productId', ({ req, body, params }) => {
    const { actor } = membership(req, params.vendorId), old = get('SELECT * FROM products WHERE id=?', params.productId);
    if (!old || parse(old.data, {}).vendorId !== params.vendorId) fail(404, 'المنتج لا يتبع هذا المتجر', 'not_found');
    // Enforce parent ownership before validating variant fields: a foreign parent is forbidden
    // even if the client omits variantLabel or supplies otherwise malformed variant details.
    const proposedParent = body.variantOf !== undefined ? body.variantOf : parse(old.data, {}).variantOf;
    if (typeof proposedParent === 'string' && proposedParent.trim()) {
      const parent = get('SELECT data,active FROM products WHERE id=?', proposedParent.trim());
      if (!parent || !parent.active || parse(parent.data, {}).vendorId !== params.vendorId) fail(403, 'لا يمكن ربط متغير بمنتج لا يتبع هذا المتجر', 'vendor_parent_forbidden');
    }
    const data = { ...c.validateProduct({ ...body, id: old.id }, parse(old.data)), vendorId: params.vendorId };
    run('UPDATE products SET data=?,stock=?,active=?,updated_at=? WHERE id=?', json(data), body.stock !== undefined ? integer(body.stock, 'المخزون', 0, 1e7) : old.stock, body.active !== undefined ? body.active ? 1 : 0 : old.active, now(), old.id);
    audit(actor, 'product.update', old.id, { vendorId: params.vendorId });
    api.emit('productsChanged', [old.id]);
    return { product: c.product(get('SELECT * FROM products WHERE id=?', old.id)) };
  });
  api.route('GET', '/vendor/:vendorId/orders', ({ req, params }) => {
    membership(req, params.vendorId);
    const ids = new Set(vendorProducts(params.vendorId).map((p) => p.id));
    const orders = all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1000').map((o) => ({ o, lines: parse(o.items, []).filter((line) => ids.has(line.productId)) })).filter((x) => x.lines.length);
    return { orders: orders.map(({ o, lines }) => ({ id: o.id, status: o.status, createdAt: o.created_at, city: parse(o.address, {}).city || '', lines, total: money(lines.reduce((sum, line) => sum + line.price * line.quantity, 0)) })) };
  });
  api.route('GET', '/vendor/:vendorId/summary', ({ req, params }) => {
    membership(req, params.vendorId);
    const v = get('SELECT * FROM vendors WHERE id=?', params.vendorId); if (!v) fail(404, 'التاجر غير موجود', 'not_found');
    const products = vendorProducts(v.id), ids = new Set(products.map((p) => p.id));
    let sales = 0, units = 0, orders = 0;
    for (const o of all("SELECT items FROM orders WHERE status<>'cancelled'")) {
      const lines = parse(o.items, []).filter((line) => ids.has(line.productId));
      if (lines.length) orders++;
      for (const line of lines) { sales += line.price * line.quantity; units += line.quantity; }
    }
    return { vendor: { id: v.id, name: v.name, status: v.status }, summary: { products: products.length, lowStock: products.filter((p) => p.active && p.stock <= 5).length, orders, units, sales: money(sales), commission: money(sales * v.commission / 100), payout: money(sales * (1 - v.commission / 100)) } };
  });
}
