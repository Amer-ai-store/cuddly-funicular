// Engagement: daily check-in, badges, referrals, loyalty tiers, flash deals, campaigns, weekly budget,
// personal and shared family lists, and the home pantry (expiry tracking and carbon savings).
import { randomInt } from 'node:crypto';
import { publicName } from './text.mjs';

export const name = 'engagement';

export const TIERS = [
  { id: 'bronze', name: 'برونزي', minPoints: 0, shippingMultiplier: 1, benefits: ['نقطة لكل دينار', 'عروض الأعضاء'] },
  { id: 'silver', name: 'فضي', minPoints: 500, shippingMultiplier: 0.5, benefits: ['خصم 50% على التوصيل', 'نقطة لكل دينار'] },
  { id: 'gold', name: 'ذهبي', minPoints: 1500, shippingMultiplier: 0, benefits: ['توصيل مجاني دائمًا', 'وصول مبكر للعروض الخاطفة'] },
  { id: 'platinum', name: 'بلاتيني', minPoints: 5000, shippingMultiplier: 0, benefits: ['توصيل مجاني دائمًا', 'دعم بأولوية', 'هدايا المناسبات'] },
];
const CARBON_BY_CATEGORY = { fresh: 0.5, dairy: 1.2, bakery: 0.6, drinks: 0.3 };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (length) => Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

export function install(c, api) {
  const { db, get, all, run, transaction, fail, text, integer, number, id, now, json, parse, money, requireUser, admin, audit, notify, rate, setting, options, rewardBalance, rewardLedger } = c;
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_codes(user_id TEXT PRIMARY KEY REFERENCES users(id),code TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS referrals(referee_id TEXT PRIMARY KEY REFERENCES users(id),referrer_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,rewarded_at TEXT);
    CREATE TABLE IF NOT EXISTS flash_deals(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),price REAL NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,quantity_limit INTEGER,sold INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,title TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT '#7C5CFF',link TEXT NOT NULL DEFAULT '/offers',cta TEXT NOT NULL DEFAULT 'تسوّق الآن',starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,sort INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lists(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('personal','family')),share_code TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS list_members(list_id TEXT NOT NULL REFERENCES lists(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','member')),joined_at TEXT NOT NULL,PRIMARY KEY(list_id,user_id));
    CREATE TABLE IF NOT EXISTS list_items(id TEXT PRIMARY KEY,list_id TEXT NOT NULL REFERENCES lists(id),product_id TEXT REFERENCES products(id),title TEXT NOT NULL,quantity INTEGER NOT NULL,checked INTEGER NOT NULL DEFAULT 0,added_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pantry_items(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT,name TEXT NOT NULL,category TEXT NOT NULL,quantity INTEGER NOT NULL,expires_on TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','consumed','wasted')),carbon_kg REAL NOT NULL,order_id TEXT,notified_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  `);
  const localNow = () => new Date(Date.now() + (setting('timezoneOffsetMinutes') ?? 180) * 60_000);
  const today = () => localNow().toISOString().slice(0, 10);
  const dayShift = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400_000).toISOString().slice(0, 10);

  // ---- daily check-in ----
  const checkins = (userId) => new Set(all("SELECT request_key FROM reward_ledger WHERE user_id=? AND request_key LIKE 'checkin:%'", userId).map((r) => r.request_key.slice(8)));
  const streak = (days, from) => { let n = 0, day = from; while (days.has(day)) { n++; day = dayShift(day, -1); } return n; };
  const checkinState = (userId) => {
    const days = checkins(userId), day = today(), checkedInToday = days.has(day);
    const current = streak(days, checkedInToday ? day : dayShift(day, -1));
    return { checkedInToday, streak: current, nextReward: (current + 1) % 7 === 0 ? 25 : 5, days: [...days].sort().slice(-14) };
  };
  api.route('GET', '/rewards/check-in', ({ req }) => checkinState(requireUser(req).id));
  api.route('POST', '/rewards/check-in', ({ req }) => {
    const actor = requireUser(req); rate(req, 'check-in', 30);
    return transaction(() => {
      const state = checkinState(actor.id);
      if (state.checkedInToday) return { ...state, awarded: 0, alreadyCheckedIn: true, points: rewardBalance(actor.id) };
      const points = state.nextReward;
      rewardLedger(actor.id, points, 'earned', `تسجيل الحضور اليومي (اليوم ${state.streak + 1})`, null, null, `checkin:${today()}`);
      return { ...checkinState(actor.id), awarded: points, alreadyCheckedIn: false, points: rewardBalance(actor.id) };
    });
  });

  // ---- tiers ----
  const lifetimePoints = (userId) => get("SELECT COALESCE(SUM(points),0) AS n FROM reward_ledger WHERE user_id=? AND type='earned' AND points>0", userId).n;
  const tierFor = (userId) => { const points = lifetimePoints(userId); return [...TIERS].reverse().find((t) => points >= t.minPoints); };
  api.provide('tierFor', tierFor);
  api.route('GET', '/rewards/tier', ({ req }) => {
    const actor = requireUser(req), points = lifetimePoints(actor.id), tier = tierFor(actor.id), next = TIERS[TIERS.indexOf(tier) + 1] || null;
    return { tier, lifetimePoints: points, next: next ? { ...next, pointsNeeded: next.minPoints - points } : null, progress: next ? Math.round((points - tier.minPoints) / (next.minPoints - tier.minPoints) * 100) : 100, tiers: TIERS };
  });

  // ---- referrals ----
  const referralCode = (userId) => {
    const saved = get('SELECT code FROM referral_codes WHERE user_id=?', userId); if (saved) return saved.code;
    for (let i = 0; i < 5; i++) { const value = `LQ${code(6)}`; if (!get('SELECT user_id FROM referral_codes WHERE code=?', value)) { run('INSERT INTO referral_codes VALUES(?,?,?)', userId, value, now()); return value; } }
    fail(500, 'تعذر إنشاء رمز الدعوة');
  };
  api.route('GET', '/referrals', ({ req }) => {
    const actor = requireUser(req);
    return { code: referralCode(actor.id), invited: get('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id=?', actor.id).n, rewarded: get('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id=? AND rewarded_at IS NOT NULL', actor.id).n, referrerReward: 50, friendReward: 20, appliedCode: !!get('SELECT referee_id FROM referrals WHERE referee_id=?', actor.id) };
  });
  api.route('POST', '/referrals/apply', ({ req, body }) => {
    const actor = requireUser(req); rate(req, 'referral', 10);
    const value = String(body.code ?? '').toUpperCase().replace(/\s/g, ''); if (!/^LQ[A-Z0-9]{6}$/.test(value)) fail(400, 'رمز الدعوة غير صالح', 'invalid_referral');
    const owner = get('SELECT user_id FROM referral_codes WHERE code=?', value); if (!owner) fail(404, 'رمز الدعوة غير موجود', 'invalid_referral');
    if (owner.user_id === actor.id) fail(400, 'لا يمكنك استخدام رمزك الخاص', 'self_referral');
    if (get('SELECT referee_id FROM referrals WHERE referee_id=?', actor.id)) fail(409, 'استخدمت رمز دعوة مسبقًا', 'referral_used');
    if (get('SELECT id FROM orders WHERE user_id=? LIMIT 1', actor.id) || Date.now() - Date.parse(actor.created_at) > 14 * 86400_000) fail(409, 'رموز الدعوة للحسابات الجديدة قبل أول طلب فقط', 'referral_not_eligible');
    return transaction(() => {
      run('INSERT INTO referrals VALUES(?,?,?,NULL)', actor.id, owner.user_id, now());
      rewardLedger(actor.id, 20, 'earned', 'مكافأة الانضمام بدعوة صديق', null, null, 'referral-welcome');
      notify(owner.user_id, 'انضم صديقك إلى لُقطة', 'ستحصل على 50 نقطة عند استلام أول طلب له.');
      return { ok: true, awarded: 20, points: rewardBalance(actor.id) };
    });
  });

  // ---- flash deals ----
  const activeDeal = (productId) => get('SELECT * FROM flash_deals WHERE product_id=? AND active=1 AND starts_at<=? AND ends_at>? AND (quantity_limit IS NULL OR sold<quantity_limit) ORDER BY price LIMIT 1', productId, now(), now());
  api.provide('unitPrice', (row, data, requestedQuantity = 1) => {
    const deal = activeDeal(row.id);
    if (deal && deal.price < data.price && deal.quantity_limit !== null && requestedQuantity > deal.quantity_limit - deal.sold) {
      fail(409, 'الكمية المطلوبة تتجاوز الكمية المتبقية من العرض الخاطف', 'flash_deal_limit_exceeded');
    }
    return deal ? Math.min(deal.price, data.price) : data.price;
  });
  api.decorate((item) => {
    if (item.hasVariants) return item;
    const deal = activeDeal(item.id); if (!deal || deal.price >= item.price) return item;
    return { ...item, price: deal.price, oldPrice: Math.max(item.oldPrice ?? 0, item.price), flash: { id: deal.id, endsAt: deal.ends_at, remaining: deal.quantity_limit === null ? null : deal.quantity_limit - deal.sold, limit: deal.quantity_limit } };
  });
  api.on('orderPlaced', (orderId, lines) => { for (const line of lines) { const deal = activeDeal(line.productId); if (deal && deal.price === line.price) run('UPDATE flash_deals SET sold=sold+? WHERE id=?', line.quantity, deal.id); } });
  const dealItem = (d) => { const row = get('SELECT * FROM products WHERE id=?', d.product_id), p = row ? c.product(row) : null; return { id: d.id, productId: d.product_id, product: p, price: d.price, originalPrice: p?.basePrice ?? null, startsAt: d.starts_at, endsAt: d.ends_at, limit: d.quantity_limit, sold: d.sold, remaining: d.quantity_limit === null ? null : Math.max(0, d.quantity_limit - d.sold), active: !!d.active }; };
  api.route('GET', '/flash-deals', () => ({ serverTime: now(), deals: all('SELECT * FROM flash_deals WHERE active=1 AND starts_at<=? AND ends_at>? AND (quantity_limit IS NULL OR sold<quantity_limit) ORDER BY ends_at', now(), now()).map(dealItem).filter((d) => d.product?.active) }));
  api.route('GET', '/admin/flash-deals', ({ req }) => { admin(req, 'catalog:write'); return { deals: all('SELECT * FROM flash_deals ORDER BY created_at DESC LIMIT 200').map(dealItem) }; });
  api.route('POST', '/admin/flash-deals', ({ req, body }) => {
    const actor = admin(req, 'catalog:write'), row = get('SELECT * FROM products WHERE id=? AND active=1', text(body.productId, 'المنتج', 1, 100)); if (!row) fail(404, 'المنتج غير موجود', 'not_found');
    if (get("SELECT 1 FROM products WHERE active=1 AND json_extract(data,'$.variantOf')=? LIMIT 1", row.id)) fail(400, 'أنشئ العرض على مقاس أو لون محدد');
    const base = parse(row.data).price, price = money(number(body.price, 'سعر العرض', 0.001, base - 0.001));
    const startsAt = body.startsAt ? c.date(body.startsAt, 'بداية العرض') : now(), endsAt = c.date(body.endsAt, 'نهاية العرض');
    if (endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > 14 * 86400_000) fail(400, 'مدة العرض الخاطف من دقيقة إلى 14 يومًا');
    const dealId = id('flash');
    run('INSERT INTO flash_deals VALUES(?,?,?,?,?,?,0,1,?)', dealId, row.id, price, startsAt, endsAt, body.limit == null ? null : integer(body.limit, 'الكمية المحدودة', 1, 100000), now());
    audit(actor, 'flash.create', dealId, { productId: row.id, price });
    api.emit('productsChanged', [row.id]);
    return [201, { deal: dealItem(get('SELECT * FROM flash_deals WHERE id=?', dealId)) }];
  });
  api.route('DELETE', '/admin/flash-deals/:dealId', ({ req, params }) => { const actor = admin(req, 'catalog:write'); if (!run('UPDATE flash_deals SET active=0 WHERE id=?', params.dealId).changes) fail(404, 'العرض غير موجود', 'not_found'); audit(actor, 'flash.stop', params.dealId); return { ok: true }; });

  // ---- campaigns and banners ----
  const campaignItem = (r) => ({ id: r.id, title: r.title, subtitle: r.subtitle, image: r.image, color: r.color, link: r.link, cta: r.cta, startsAt: r.starts_at, endsAt: r.ends_at, active: !!r.active, sort: r.sort });
  const campaignInput = (body, old = {}) => {
    const v = { title: body.title !== undefined ? text(body.title, 'عنوان الحملة', 2, 80) : old.title, subtitle: body.subtitle !== undefined ? String(body.subtitle).slice(0, 160) : old.subtitle || '', image: body.image !== undefined ? String(body.image) : old.image || '', color: body.color ?? old.color ?? '#7C5CFF', link: body.link ?? old.link ?? '/offers', cta: body.cta !== undefined ? text(body.cta, 'نص الزر', 2, 30) : old.cta || 'تسوّق الآن', startsAt: body.startsAt !== undefined ? c.date(body.startsAt, 'بداية الحملة') : old.starts_at || now(), endsAt: body.endsAt !== undefined ? c.date(body.endsAt, 'نهاية الحملة') : old.ends_at, active: body.active !== undefined ? (body.active ? 1 : 0) : old.active ?? 1, sort: body.sort !== undefined ? integer(body.sort, 'الترتيب', 0, 1000) : old.sort ?? 0 };
    if (!v.title || !v.endsAt) fail(400, 'عنوان الحملة وتاريخ نهايتها مطلوبان');
    if (v.endsAt <= v.startsAt) fail(400, 'نهاية الحملة يجب أن تكون بعد بدايتها');
    if (v.image && !/^https:\/\/\S+$/.test(v.image)) fail(400, 'صورة الحملة يجب أن تستخدم HTTPS');
    if (!/^#[0-9a-fA-F]{6}$/.test(v.color)) fail(400, 'لون الحملة يجب أن يكون HEX');
    if (typeof v.link !== 'string' || !/^(\/[\w\-/?=&.]*|https:\/\/\S+)$/.test(v.link) || v.link.length > 300) fail(400, 'رابط الحملة يجب أن يكون صفحة داخلية أو HTTPS');
    return v;
  };
  if (options.seedDemoProducts !== false && process.env.NODE_ENV !== 'production' && !get('SELECT id FROM campaigns LIMIT 1')) {
    const end = new Date(Date.now() + 30 * 86400_000).toISOString();
    run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,1,0,?)', 'cmp_fresh', 'أسبوع الطازج', 'خصومات على الخضار والفواكه والألبان', '', '#4CAF50', '/explore?category=fresh', 'تسوّق الطازج', now(), end, now());
    run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,1,1,?)', 'cmp_robot', 'لُقطي يجهّز سلتك', 'قل له ميزانيتك ويختار لك الأنسب', '', '#7C5CFF', '/assistant', 'جرّب الآن', now(), end, now());
  }
  api.route('GET', '/campaigns', () => ({ campaigns: all('SELECT * FROM campaigns WHERE active=1 AND starts_at<=? AND ends_at>? ORDER BY sort,created_at', now(), now()).map(campaignItem) }));
  api.route('GET', '/admin/campaigns', ({ req }) => { admin(req, 'catalog:write'); return { campaigns: all('SELECT * FROM campaigns ORDER BY sort,created_at DESC').map(campaignItem) }; });
  api.route('POST', '/admin/campaigns', ({ req, body }) => {
    const actor = admin(req, 'catalog:write'), v = campaignInput(body), campaignId = id('cmp');
    run('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', campaignId, v.title, v.subtitle, v.image, v.color, v.link, v.cta, v.startsAt, v.endsAt, v.active, v.sort, now());
    audit(actor, 'campaign.create', campaignId);
    return [201, { campaign: campaignItem(get('SELECT * FROM campaigns WHERE id=?', campaignId)) }];
  });
  api.route('PATCH', '/admin/campaigns/:campaignId', ({ req, body, params }) => {
    const actor = admin(req, 'catalog:write'), old = get('SELECT * FROM campaigns WHERE id=?', params.campaignId); if (!old) fail(404, 'الحملة غير موجودة', 'not_found');
    const v = campaignInput(body, old);
    run('UPDATE campaigns SET title=?,subtitle=?,image=?,color=?,link=?,cta=?,starts_at=?,ends_at=?,active=?,sort=? WHERE id=?', v.title, v.subtitle, v.image, v.color, v.link, v.cta, v.startsAt, v.endsAt, v.active, v.sort, old.id);
    audit(actor, 'campaign.update', old.id);
    return { campaign: campaignItem(get('SELECT * FROM campaigns WHERE id=?', old.id)) };
  });

  // ---- weekly budget ----
  const budgetStatus = (userId) => {
    const prefs = api.use('preferences')(userId), local = localNow(), offset = (local.getUTCDay() + 1) % 7; // weeks start on Saturday
    const weekStartLocal = dayShift(local.toISOString().slice(0, 10), -offset);
    const weekStart = new Date(Date.parse(`${weekStartLocal}T00:00:00Z`) - (setting('timezoneOffsetMinutes') ?? 180) * 60_000).toISOString();
    const orders = all("SELECT items,total FROM orders WHERE user_id=? AND status<>'cancelled' AND created_at>=?", userId, weekStart);
    const byCategory = {};
    for (const o of orders) for (const line of parse(o.items, [])) { const category = parse(get('SELECT data FROM products WHERE id=?', line.productId)?.data, {}).category || 'other'; byCategory[category] = money((byCategory[category] || 0) + line.price * line.quantity); }
    const spent = money(orders.reduce((sum, o) => sum + o.total, 0)), weeklyBudget = prefs.weeklyBudget;
    return { weeklyBudget, spent, remaining: weeklyBudget === null ? null : money(Math.max(0, weeklyBudget - spent)), percent: weeklyBudget ? Math.min(100, Math.round(spent / weeklyBudget * 100)) : null, weekStartsAt: weekStart, orders: orders.length, byCategory, warning: weeklyBudget !== null && spent >= weeklyBudget * 0.8 ? (spent >= weeklyBudget ? 'تجاوزت ميزانيتك الأسبوعية' : 'اقتربت من حد ميزانيتك الأسبوعية') : null };
  };
  api.provide('budgetStatus', budgetStatus);
  api.route('GET', '/me/budget', ({ req }) => ({ budget: budgetStatus(requireUser(req).id), currency: setting('currency') }));

  // ---- lists and family lists ----
  const member = (listId, userId) => get('SELECT l.*,m.role FROM lists l JOIN list_members m ON m.list_id=l.id WHERE l.id=? AND m.user_id=?', listId, userId);
  const requireMember = (listId, actor) => { const l = member(listId, actor.id); if (!l) fail(404, 'القائمة غير موجودة', 'not_found'); return l; };
  const listItem = (l, actor, withItems = false) => {
    const items = all('SELECT i.*,u.name AS added_name FROM list_items i JOIN users u ON u.id=i.added_by WHERE i.list_id=? ORDER BY i.checked,i.created_at', l.id).map((i) => { const row = i.product_id ? get('SELECT * FROM products WHERE id=?', i.product_id) : null, p = row ? c.product(row) : null; return { id: i.id, productId: i.product_id, title: i.title, quantity: i.quantity, checked: !!i.checked, addedBy: publicName(i.added_name), createdAt: i.created_at, product: p ? { id: p.id, name: p.name, price: p.price, image: p.image || '', stock: p.stock } : null }; });
    const members = all('SELECT m.user_id,m.role,u.name FROM list_members m JOIN users u ON u.id=m.user_id WHERE m.list_id=? ORDER BY m.joined_at', l.id).map((m) => ({ userId: m.user_id, name: publicName(m.name), role: m.role }));
    return { id: l.id, name: l.name, kind: l.kind, role: l.role, shareCode: l.role === 'owner' ? l.share_code : null, members, itemCount: items.length, checkedCount: items.filter((i) => i.checked).length, estimatedTotal: money(items.filter((i) => !i.checked && i.product).reduce((sum, i) => sum + i.product.price * i.quantity, 0)), updatedAt: l.updated_at, ...(withItems ? { items } : {}) };
  };
  const touch = (listId) => run('UPDATE lists SET updated_at=? WHERE id=?', now(), listId);
  api.route('GET', '/lists', ({ req }) => { const actor = requireUser(req); return { lists: all('SELECT l.*,m.role FROM lists l JOIN list_members m ON m.list_id=l.id WHERE m.user_id=? ORDER BY l.updated_at DESC', actor.id).map((l) => listItem(l, actor)) }; });
  api.route('POST', '/lists', ({ req, body }) => {
    const actor = requireUser(req), kind = body.kind || 'personal'; if (!['personal', 'family'].includes(kind)) fail(400, 'نوع القائمة غير صالح');
    if (get('SELECT COUNT(*) AS n FROM lists WHERE owner_id=?', actor.id).n >= 50) fail(409, 'الحد الأقصى 50 قائمة');
    const listId = id('lst'), time = now();
    transaction(() => { run('INSERT INTO lists VALUES(?,?,?,?,NULL,?,?)', listId, actor.id, text(body.name, 'اسم القائمة', 1, 60), kind, time, time); run('INSERT INTO list_members VALUES(?,?,?,?)', listId, actor.id, 'owner', time); });
    return [201, { list: listItem(member(listId, actor.id), actor, true) }];
  });
  api.route('GET', '/lists/:listId', ({ req, params }) => { const actor = requireUser(req); return { list: listItem(requireMember(params.listId, actor), actor, true) }; });
  api.route('PATCH', '/lists/:listId', ({ req, body, params }) => { const actor = requireUser(req), l = requireMember(params.listId, actor); run('UPDATE lists SET name=?,updated_at=? WHERE id=?', text(body.name, 'اسم القائمة', 1, 60), now(), l.id); return { list: listItem(member(l.id, actor.id), actor, true) }; });
  api.route('DELETE', '/lists/:listId', ({ req, params }) => {
    const actor = requireUser(req), l = requireMember(params.listId, actor); if (l.role !== 'owner') fail(403, 'يحذف القائمةَ مالكُها فقط', 'forbidden');
    transaction(() => { run('DELETE FROM list_items WHERE list_id=?', l.id); run('DELETE FROM list_members WHERE list_id=?', l.id); run('DELETE FROM lists WHERE id=?', l.id); });
    return { ok: true };
  });
  api.route('POST', '/lists/:listId/items', ({ req, body, params }) => {
    const actor = requireUser(req), l = requireMember(params.listId, actor);
    if (get('SELECT COUNT(*) AS n FROM list_items WHERE list_id=?', l.id).n >= 200) fail(409, 'الحد الأقصى 200 عنصر في القائمة');
    const row = body.productId ? get('SELECT * FROM products WHERE id=? AND active=1', text(body.productId, 'المنتج', 1, 100)) : null;
    if (body.productId && !row) fail(404, 'المنتج غير موجود', 'not_found');
    const title = row ? parse(row.data).name : text(body.title, 'اسم العنصر', 1, 120), quantity = integer(body.quantity ?? 1, 'الكمية', 1, 99);
    const existing = row ? get('SELECT * FROM list_items WHERE list_id=? AND product_id=? AND checked=0', l.id, row.id) : null;
    transaction(() => {
      if (existing) run('UPDATE list_items SET quantity=MIN(99,quantity+?) WHERE id=?', quantity, existing.id);
      else run('INSERT INTO list_items VALUES(?,?,?,?,?,0,?,?)', id('itm'), l.id, row?.id || null, title, quantity, actor.id, now());
      touch(l.id);
      if (l.kind === 'family') for (const m of all('SELECT user_id FROM list_members WHERE list_id=? AND user_id<>?', l.id, actor.id)) notify(m.user_id, `تحديث على «${l.name}»`, `${publicName(actor.name)} أضاف ${title}`);
    });
    return [201, { list: listItem(l, actor, true) }];
  });
  api.route('PATCH', '/lists/:listId/items/:itemId', ({ req, body, params }) => {
    const actor = requireUser(req), l = requireMember(params.listId, actor), item = get('SELECT * FROM list_items WHERE id=? AND list_id=?', params.itemId, l.id); if (!item) fail(404, 'العنصر غير موجود', 'not_found');
    if (body.checked !== undefined && typeof body.checked !== 'boolean') fail(400, 'قيمة الإنجاز غير صالحة');
    run('UPDATE list_items SET checked=?,quantity=? WHERE id=?', body.checked === undefined ? item.checked : body.checked ? 1 : 0, body.quantity === undefined ? item.quantity : integer(body.quantity, 'الكمية', 1, 99), item.id); touch(l.id);
    return { list: listItem(l, actor, true) };
  });
  api.route('DELETE', '/lists/:listId/items/:itemId', ({ req, params }) => { const actor = requireUser(req), l = requireMember(params.listId, actor); if (!run('DELETE FROM list_items WHERE id=? AND list_id=?', params.itemId, l.id).changes) fail(404, 'العنصر غير موجود', 'not_found'); touch(l.id); return { list: listItem(l, actor, true) }; });
  api.route('POST', '/lists/:listId/share', ({ req, params }) => {
    const actor = requireUser(req), l = requireMember(params.listId, actor); if (l.role !== 'owner') fail(403, 'يشارك القائمةَ مالكُها فقط', 'forbidden');
    let value = l.share_code;
    if (!value) { do value = code(8); while (get('SELECT id FROM lists WHERE share_code=?', value)); run("UPDATE lists SET share_code=?,kind='family',updated_at=? WHERE id=?", value, now(), l.id); }
    return { code: value, list: listItem(member(l.id, actor.id), actor) };
  });
  api.route('DELETE', '/lists/:listId/share', ({ req, params }) => { const actor = requireUser(req), l = requireMember(params.listId, actor); if (l.role !== 'owner') fail(403, 'يوقف المشاركةَ مالكُ القائمة فقط', 'forbidden'); run('UPDATE lists SET share_code=NULL WHERE id=?', l.id); return { ok: true }; });
  api.route('POST', '/lists/join', ({ req, body }) => {
    const actor = requireUser(req); rate(req, 'list-join', 20);
    const value = String(body.code ?? '').toUpperCase().replace(/\s/g, ''); if (!/^[A-Z0-9]{8}$/.test(value)) fail(400, 'رمز المشاركة غير صالح');
    const l = get('SELECT * FROM lists WHERE share_code=?', value); if (!l) fail(404, 'رمز المشاركة غير صحيح أو أوقفه المالك', 'not_found');
    if (!member(l.id, actor.id)) {
      if (get('SELECT COUNT(*) AS n FROM list_members WHERE list_id=?', l.id).n >= 20) fail(409, 'اكتمل عدد أعضاء القائمة (20)');
      run('INSERT INTO list_members VALUES(?,?,?,?)', l.id, actor.id, 'member', now());
      notify(l.owner_id, 'انضم فرد جديد', `${publicName(actor.name)} انضم إلى «${l.name}»`);
    }
    return { list: listItem(member(l.id, actor.id), actor, true) };
  });
  api.route('DELETE', '/lists/:listId/members/:userId', ({ req, params }) => {
    const actor = requireUser(req), l = requireMember(params.listId, actor);
    if (params.userId === l.owner_id) fail(409, 'لا يمكن إزالة مالك القائمة');
    if (l.role !== 'owner' && params.userId !== actor.id) fail(403, 'يمكنك مغادرة القائمة فقط', 'forbidden');
    if (!run('DELETE FROM list_members WHERE list_id=? AND user_id=?', l.id, params.userId).changes) fail(404, 'العضو غير موجود', 'not_found');
    return { ok: true };
  });

  // ---- pantry: expiry tracking and carbon savings ----
  const daysLeft = (expiresOn) => Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400_000);
  const pantryItem = (r) => { const left = daysLeft(r.expires_on); return { id: r.id, productId: r.product_id, name: r.name, category: r.category, quantity: r.quantity, expiresOn: r.expires_on, status: r.status, carbonKg: r.carbon_kg, orderId: r.order_id, daysLeft: left, freshness: r.status !== 'active' ? r.status : left < 0 ? 'expired' : left <= 2 ? 'soon' : 'fresh', createdAt: r.created_at }; };
  const carbonFor = (category, data = {}) => data.carbonKg ?? CARBON_BY_CATEGORY[category] ?? 0.4;
  const pantryStats = (userId) => {
    const rows = all('SELECT * FROM pantry_items WHERE user_id=?', userId).map(pantryItem);
    const consumed = rows.filter((r) => r.status === 'consumed'), wasted = rows.filter((r) => r.status === 'wasted');
    return { active: rows.filter((r) => r.status === 'active').length, expiringSoon: rows.filter((r) => r.freshness === 'soon').length, expired: rows.filter((r) => r.freshness === 'expired').length, consumed: consumed.length, wasted: wasted.length, carbonSavedKg: Math.round(consumed.reduce((s, r) => s + r.carbonKg * r.quantity, 0) * 100) / 100, wasteRate: consumed.length + wasted.length ? Math.round(wasted.length / (consumed.length + wasted.length) * 100) : 0 };
  };
  api.provide('pantryStats', pantryStats);
  api.route('GET', '/pantry', ({ req }) => {
    const actor = requireUser(req), rows = all("SELECT * FROM pantry_items WHERE user_id=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,expires_on", actor.id);
    const due = rows.filter((r) => r.status === 'active' && !r.notified_at && daysLeft(r.expires_on) <= 2);
    if (due.length && api.use('preferences')(actor.id).notifications.pantry) {
      notify(actor.id, 'منتجات تقترب من انتهاء صلاحيتها', `${due.map((r) => r.name).slice(0, 3).join('، ')} — استخدمها قريبًا لتقليل الهدر.`);
      for (const r of due) run('UPDATE pantry_items SET notified_at=? WHERE id=?', now(), r.id);
    }
    return { items: rows.map(pantryItem), stats: pantryStats(actor.id) };
  });
  api.route('POST', '/pantry', ({ req, body }) => {
    const actor = requireUser(req);
    if (get("SELECT COUNT(*) AS n FROM pantry_items WHERE user_id=? AND status='active'", actor.id).n >= 300) fail(409, 'الحد الأقصى 300 منتج في المخزن');
    const row = body.productId ? get('SELECT * FROM products WHERE id=?', text(body.productId, 'المنتج', 1, 100)) : null, data = row ? parse(row.data, {}) : {};
    if (!isDate(body.expiresOn)) fail(400, 'تاريخ الانتهاء يجب أن يكون بصيغة YYYY-MM-DD');
    const category = row ? data.category : body.category ? text(body.category, 'القسم', 1, 40) : 'other', itemId = id('pan');
    run('INSERT INTO pantry_items VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)', itemId, actor.id, row?.id || null, row ? data.name : text(body.name, 'اسم المنتج', 1, 120), category, integer(body.quantity ?? 1, 'الكمية', 1, 999), body.expiresOn, 'active', carbonFor(category, data), now(), now());
    return [201, { item: pantryItem(get('SELECT * FROM pantry_items WHERE id=?', itemId)), stats: pantryStats(actor.id) }];
  });
  api.route('PATCH', '/pantry/:itemId', ({ req, body, params }) => {
    const actor = requireUser(req), r = get('SELECT * FROM pantry_items WHERE id=? AND user_id=?', params.itemId, actor.id); if (!r) fail(404, 'المنتج غير موجود في المخزن', 'not_found');
    if (body.status !== undefined && !['active', 'consumed', 'wasted'].includes(body.status)) fail(400, 'الحالة غير صالحة');
    if (body.expiresOn !== undefined && !isDate(body.expiresOn)) fail(400, 'تاريخ الانتهاء غير صالح');
    run('UPDATE pantry_items SET status=?,quantity=?,expires_on=?,updated_at=? WHERE id=?', body.status ?? r.status, body.quantity !== undefined ? integer(body.quantity, 'الكمية', 1, 999) : r.quantity, body.expiresOn ?? r.expires_on, now(), r.id);
    return { item: pantryItem(get('SELECT * FROM pantry_items WHERE id=?', r.id)), stats: pantryStats(actor.id) };
  });
  api.route('DELETE', '/pantry/:itemId', ({ req, params }) => { if (!run('DELETE FROM pantry_items WHERE id=? AND user_id=?', params.itemId, requireUser(req).id).changes) fail(404, 'المنتج غير موجود في المخزن', 'not_found'); return { ok: true }; });
  api.on('orderStatus', (o, status) => {
    if (status !== 'delivered') return;
    const referral = get('SELECT * FROM referrals WHERE referee_id=? AND rewarded_at IS NULL', o.user_id);
    if (referral && !get('SELECT id FROM reward_ledger WHERE user_id=? AND request_key=?', referral.referrer_id, `referral:${o.user_id}`)) {
      rewardLedger(referral.referrer_id, 50, 'earned', 'مكافأة دعوة صديق', null, null, `referral:${o.user_id}`);
      run('UPDATE referrals SET rewarded_at=? WHERE referee_id=?', now(), o.user_id);
      notify(referral.referrer_id, 'حصلت على 50 نقطة 🎉', 'استلم صديقك أول طلب له.');
    }
    const day = today();
    for (const line of parse(o.items, [])) {
      const data = parse(get('SELECT data FROM products WHERE id=?', line.productId)?.data, {});
      if (!data.expiryDays || get('SELECT id FROM pantry_items WHERE order_id=? AND product_id=?', o.id, line.productId)) continue;
      run('INSERT INTO pantry_items VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?)', id('pan'), o.user_id, line.productId, data.name || line.name, data.category || 'other', line.quantity, dayShift(day, data.expiryDays), 'active', carbonFor(data.category, data), o.id, now(), now());
    }
  });

  // ---- badges ----
  api.route('GET', '/me/badges', ({ req }) => {
    const actor = requireUser(req), u = actor.id;
    const delivered = get("SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status='delivered'", u).n;
    const progress = [
      ['first_order', 'أول لُقطة', 'استلمت أول طلب', delivered, 1],
      ['loyal_5', 'زبون وفيّ', 'استلمت 5 طلبات', delivered, 5],
      ['reviewer', 'صوت المجتمع', 'كتبت تقييمًا موثقًا', get('SELECT COUNT(*) AS n FROM reviews WHERE user_id=?', u).n, 1],
      ['streak_7', 'حاضر دائمًا', 'سجّلت حضورك 7 أيام متتالية', Math.max(checkinState(u).streak, 0), 7],
      ['family', 'روح العائلة', 'شاركت قائمة عائلية', get("SELECT COUNT(*) AS n FROM list_members m JOIN lists l ON l.id=m.list_id WHERE m.user_id=? AND l.kind='family'", u).n, 1],
      ['eco', 'صديق البيئة', 'وفّرت 1 كغ من الانبعاثات', Math.floor(pantryStats(u).carbonSavedKg), 1],
      ['saver', 'صائد العروض', 'استخدمت رمز خصم', get('SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND coupon_id IS NOT NULL', u).n, 1],
      ['ambassador', 'سفير لُقطة', 'دعوت صديقًا استلم طلبه', get('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id=? AND rewarded_at IS NOT NULL', u).n, 1],
    ];
    return { badges: progress.map(([key, title, detail, value, goal]) => ({ id: key, title, detail, earned: value >= goal, progress: Math.min(goal, value), goal })) };
  });

  api.on('deleteUser', (userId) => {
    run('DELETE FROM referral_codes WHERE user_id=?', userId);
    run('DELETE FROM pantry_items WHERE user_id=?', userId);
    for (const l of all('SELECT id FROM lists WHERE owner_id=?', userId)) { run('DELETE FROM list_items WHERE list_id=?', l.id); run('DELETE FROM list_members WHERE list_id=?', l.id); run('DELETE FROM lists WHERE id=?', l.id); }
    run('DELETE FROM list_members WHERE user_id=?', userId);
  });
  api.use('registerExport')('lists', (userId) => all('SELECT l.id,l.name,l.kind FROM lists l JOIN list_members m ON m.list_id=l.id WHERE m.user_id=?', userId).map((l) => ({ ...l, items: all('SELECT title,quantity,checked FROM list_items WHERE list_id=?', l.id) })));
  api.use('registerExport')('pantry', (userId) => all('SELECT name,quantity,expires_on AS expiresOn,status FROM pantry_items WHERE user_id=?', userId));
}
