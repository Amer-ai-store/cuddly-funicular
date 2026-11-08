// Checkout and orders: delivery zones and time slots with capacity, sandbox card payments, gift wrapping, gift cards,
// delivery codes (proof of delivery), invoices, order ratings and returns of selected items with a photo.
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { normalize } from './text.mjs';

export const name = 'checkout';

const WINDOWS = { morning: { label: 'صباحًا', from: 9, to: 12 }, afternoon: { label: 'بعد الظهر', from: 12, to: 17 }, evening: { label: 'مساءً', from: 17, to: 21 } };
// Sandbox payments accept only published test cards, so a real card number is never processed or stored.
const TEST_CARDS = {
  '4242424242424242': { brand: 'visa', outcome: 'approve' },
  '5555555555554444': { brand: 'mastercard', outcome: 'approve' },
  '4000000000000002': { brand: 'visa', outcome: 'decline', reason: 'card_declined' },
  '4000000000009995': { brand: 'visa', outcome: 'decline', reason: 'insufficient_funds' },
};
const DECLINES = { card_declined: 'رفض البنك البطاقة (بطاقة اختبار للرفض)', insufficient_funds: 'الرصيد غير كافٍ (بطاقة اختبار)' };
const luhn = (digits) => { let sum = 0; for (let i = 0; i < digits.length; i++) { let d = Number(digits[digits.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const haversineKm = (a, b) => { const r = (v) => v * Math.PI / 180, dLat = r(b.latitude - a.latitude), dLng = r(b.longitude - a.longitude); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };

export function install(c, api) {
  const { db, get, all, run, transaction, fail, text, integer, number, id, now, hash, json, parse, money, requireUser, optionalUser, admin, audit, notify, rate, setting, setSetting, ownOrder, encrypt, decrypt, ledger, balance } = c;
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_zones(id TEXT PRIMARY KEY,name TEXT NOT NULL,cities TEXT NOT NULL,fee REAL NOT NULL,free_over REAL,min_order REAL NOT NULL DEFAULT 0,eta_minutes INTEGER NOT NULL DEFAULT 120,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS delivery_slots(date TEXT NOT NULL,window TEXT NOT NULL,capacity INTEGER NOT NULL,booked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(date,window));
    CREATE TABLE IF NOT EXISTS order_extras(order_id TEXT PRIMARY KEY REFERENCES orders(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),brand TEXT NOT NULL,last4 TEXT NOT NULL,exp_month INTEGER NOT NULL,exp_year INTEGER NOT NULL,outcome TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,order_id TEXT);
    CREATE TABLE IF NOT EXISTS gift_cards(id TEXT PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,last4 TEXT NOT NULL,amount REAL NOT NULL,balance REAL NOT NULL,note TEXT NOT NULL DEFAULT '',issued_by TEXT NOT NULL,redeemed_by TEXT,redeemed_at TEXT,expires_at TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS delivery_codes(order_id TEXT PRIMARY KEY REFERENCES orders(id),code TEXT NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,verified_at TEXT);
    CREATE TABLE IF NOT EXISTS order_ratings(order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),driver_rating INTEGER CHECK(driver_rating BETWEEN 1 AND 5),comment TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS return_details(return_id TEXT PRIMARY KEY REFERENCES returns(id),items TEXT NOT NULL,photo_id TEXT,refund REAL NOT NULL);
  `);
  if (!get('SELECT id FROM delivery_zones LIMIT 1')) {
    run('INSERT INTO delivery_zones VALUES(?,?,?,?,?,?,?,1)', 'zone_amman', 'عمّان', json(['عمان', 'amman']), 2.5, 30, 0, 120);
    run('INSERT INTO delivery_zones VALUES(?,?,?,?,?,?,?,1)', 'zone_zarqa', 'الزرقاء', json(['الزرقاء', 'زرقاء', 'zarqa']), 3, 40, 10, 180);
    run('INSERT INTO delivery_zones VALUES(?,?,?,?,?,?,?,1)', 'zone_irbid', 'إربد', json(['اربد', 'irbid']), 3.5, 45, 10, 240);
  }
  for (const [key, value] of [['giftWrapFee', 1.5], ['slotCapacity', 20], ['timezoneOffsetMinutes', 180], ['deliveryOtp', true], ['requireTerms', false], ['sandboxPayments', true]]) if (setting(key) === null) setSetting(key, value);

  const zoneItem = (z) => ({ id: z.id, name: z.name, cities: parse(z.cities, []), fee: z.fee, freeOver: z.free_over, minOrder: z.min_order, etaMinutes: z.eta_minutes, active: !!z.active });
  const zoneFor = (city) => { const key = normalize(city); if (!key) return null; return all('SELECT * FROM delivery_zones WHERE active=1').find((z) => parse(z.cities, []).some((name) => normalize(name) === key)) || null; };
  const shippingFor = (actor, city, subtotal) => {
    const zone = zoneFor(city);
    if (zone && zone.min_order && subtotal < zone.min_order) fail(400, `الحد الأدنى للطلب في ${zone.name} هو ${zone.min_order}`, 'zone_minimum');
    const base = zone ? (zone.free_over !== null && subtotal >= zone.free_over ? 0 : zone.fee) : subtotal >= setting('freeShippingThreshold') ? 0 : setting('shippingFee');
    const tier = actor ? api.use('tierFor')(actor.id) : null;
    const fee = tier ? money(base * tier.shippingMultiplier) : base;
    return { fee: money(fee), base: money(base), zone: zone ? zoneItem(zone) : null, tier: tier?.id || null, freeOver: zone ? zone.free_over : setting('freeShippingThreshold') };
  };
  api.provide('shippingFor', shippingFor);
  api.route('GET', '/delivery/zones', () => ({ zones: all('SELECT * FROM delivery_zones WHERE active=1 ORDER BY fee').map(zoneItem) }));
  api.route('GET', '/delivery/nearest', ({ query }) => {
    const point = { latitude: number(Number(query.get('lat')), 'خط العرض', -90, 90), longitude: number(Number(query.get('lng')), 'خط الطول', -180, 180) };
    const branches = all('SELECT * FROM branches WHERE active=1 AND latitude IS NOT NULL').map((b) => ({ id: b.id, name: b.name, city: b.city, distanceKm: Math.round(haversineKm(point, b) * 10) / 10 })).sort((a, b) => a.distanceKm - b.distanceKm);
    return { nearest: branches[0] || null, branches };
  });
  api.route('GET', '/admin/zones', ({ req }) => { admin(req, 'settings:write'); return { zones: all('SELECT * FROM delivery_zones ORDER BY name').map(zoneItem) }; });
  const zoneInput = (body, old = {}) => {
    const cities = body.cities !== undefined ? body.cities : parse(old.cities, []);
    if (!Array.isArray(cities) || !cities.length || cities.length > 30 || cities.some((v) => typeof v !== 'string' || !v.trim())) fail(400, 'قائمة مدن المنطقة غير صالحة');
    return { name: body.name !== undefined ? text(body.name, 'اسم المنطقة', 2, 80) : old.name, cities: cities.map((v) => v.trim().slice(0, 80)), fee: body.fee !== undefined ? money(number(body.fee, 'رسوم التوصيل', 0, 1000)) : old.fee, freeOver: body.freeOver !== undefined ? (body.freeOver === null ? null : money(number(body.freeOver, 'حد التوصيل المجاني', 0, 1e6))) : old.free_over ?? null, minOrder: body.minOrder !== undefined ? money(number(body.minOrder, 'الحد الأدنى للطلب', 0, 1e6)) : old.min_order ?? 0, eta: body.etaMinutes !== undefined ? integer(body.etaMinutes, 'مدة التوصيل', 10, 10080) : old.eta_minutes ?? 120, active: body.active !== undefined ? (body.active ? 1 : 0) : old.active ?? 1 };
  };
  api.route('POST', '/admin/zones', ({ req, body }) => {
    const actor = admin(req, 'settings:write'), v = zoneInput(body), zoneId = id('zone');
    if (v.fee === undefined) fail(400, 'رسوم التوصيل مطلوبة');
    run('INSERT INTO delivery_zones VALUES(?,?,?,?,?,?,?,?)', zoneId, v.name, json(v.cities), v.fee, v.freeOver, v.minOrder, v.eta, v.active);
    audit(actor, 'zone.create', zoneId);
    return [201, { zone: zoneItem(get('SELECT * FROM delivery_zones WHERE id=?', zoneId)) }];
  });
  api.route('PATCH', '/admin/zones/:zoneId', ({ req, body, params }) => {
    const actor = admin(req, 'settings:write'), old = get('SELECT * FROM delivery_zones WHERE id=?', params.zoneId); if (!old) fail(404, 'المنطقة غير موجودة', 'not_found');
    const v = zoneInput(body, old);
    run('UPDATE delivery_zones SET name=?,cities=?,fee=?,free_over=?,min_order=?,eta_minutes=?,active=? WHERE id=?', v.name, json(v.cities), v.fee, v.freeOver, v.minOrder, v.eta, v.active, old.id);
    audit(actor, 'zone.update', old.id);
    return { zone: zoneItem(get('SELECT * FROM delivery_zones WHERE id=?', old.id)) };
  });

  // ---- delivery time slots ----
  const localNow = () => new Date(Date.now() + setting('timezoneOffsetMinutes') * 60_000);
  const localDate = (offsetDays = 0) => new Date(localNow().getTime() + offsetDays * 86400_000).toISOString().slice(0, 10);
  const slotState = (date, window) => {
    const row = get('SELECT * FROM delivery_slots WHERE date=? AND window=?', date, window);
    const capacity = row ? row.capacity : setting('slotCapacity'), booked = row ? row.booked : 0;
    const today = date === localDate(), current = localNow();
    const startsAt = WINDOWS[window].from * 60, minutesNow = current.getUTCHours() * 60 + current.getUTCMinutes();
    const open = date > localDate() || today && minutesNow <= startsAt - 30;
    return { date, window, label: WINDOWS[window].label, from: `${WINDOWS[window].from}:00`, to: `${WINDOWS[window].to}:00`, capacity, booked, remaining: Math.max(0, capacity - booked), available: open && booked < capacity };
  };
  const slots = (days) => Array.from({ length: days }, (_, d) => localDate(d)).flatMap((date) => Object.keys(WINDOWS).map((window) => slotState(date, window)));
  api.route('GET', '/delivery/slots', ({ query }) => ({ timezoneOffsetMinutes: setting('timezoneOffsetMinutes'), slots: slots(Math.min(7, Math.max(1, Number(query.get('days')) || 3))) }));
  api.route('GET', '/admin/slots', ({ req, query }) => { admin(req, 'orders:write'); return { slots: slots(Math.min(14, Math.max(1, Number(query.get('days')) || 7))) }; });
  api.route('PUT', '/admin/slots', ({ req, body }) => {
    const actor = admin(req, 'orders:write');
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !WINDOWS[body.window]) fail(400, 'الموعد غير صالح');
    const capacity = integer(body.capacity, 'السعة', 0, 10000), booked = get('SELECT booked FROM delivery_slots WHERE date=? AND window=?', body.date, body.window)?.booked || 0;
    if (capacity < booked) fail(409, `يوجد ${booked} طلب محجوز في هذا الموعد؛ لا يمكن تقليل السعة عن ذلك`, 'capacity_below_booked');
    run('INSERT INTO delivery_slots VALUES(?,?,?,0) ON CONFLICT(date,window) DO UPDATE SET capacity=excluded.capacity', body.date, body.window, capacity);
    audit(actor, 'slot.capacity', `${body.date}:${body.window}`, { capacity });
    return { slot: slotState(body.date, body.window) };
  });
  const parseSlot = (value) => {
    if (value === undefined || value === null) return null;
    if (!value || typeof value !== 'object' || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !WINDOWS[value.window]) fail(400, 'موعد التوصيل غير صالح');
    const state = slotState(value.date, value.window);
    if (value.date < localDate() || value.date > localDate(13)) fail(400, 'اختر موعدًا خلال الأسبوعين القادمين');
    if (!state.available) fail(409, state.remaining ? 'انتهى وقت حجز هذا الموعد' : 'هذا الموعد ممتلئ؛ اختر موعدًا آخر', 'slot_unavailable');
    return { date: value.date, window: value.window, label: `${WINDOWS[value.window].label} (${state.from}–${state.to})` };
  };

  // ---- sandbox card payments ----
  api.route('POST', '/payments/card/tokenize', ({ req, body }) => {
    const actor = requireUser(req); rate(req, 'card', 20);
    if (!setting('sandboxPayments')) fail(503, 'الدفع بالبطاقة غير مفعّل على هذا المتجر', 'not_configured');
    const digits = String(body.number ?? '').replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(digits) || !luhn(digits)) fail(400, 'رقم البطاقة غير صالح', 'invalid_card');
    const card = TEST_CARDS[digits];
    if (!card) fail(422, 'وضع تجريبي: استخدم إحدى بطاقات الاختبار، لا تُدخل بطاقة حقيقية', 'sandbox_only');
    const month = integer(Number(body.expMonth), 'شهر الانتهاء', 1, 12), rawYear = integer(Number(body.expYear), 'سنة الانتهاء', 0, 2100), year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (new Date(Date.UTC(year, month, 1)) <= new Date()) fail(400, 'البطاقة منتهية الصلاحية', 'expired_card');
    if (typeof body.cvc !== 'string' || !/^\d{3,4}$/.test(body.cvc)) fail(400, 'رمز التحقق غير صالح', 'invalid_cvc');
    text(body.name, 'اسم حامل البطاقة', 2, 80);
    const token = `ptok_${randomBytes(16).toString('hex')}`;
    run('INSERT INTO payment_tokens VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL)', token, actor.id, card.brand, digits.slice(-4), month, year, card.outcome, card.reason || null, now(), new Date(Date.now() + 15 * 60_000).toISOString());
    return [201, { token, brand: card.brand, last4: digits.slice(-4), expMonth: month, expYear: year, sandbox: true }];
  });

  // ---- checkout ----
  const giftInput = (gift) => {
    if (gift === undefined || gift === null) return null;
    if (typeof gift !== 'object' || Array.isArray(gift)) fail(400, 'خيارات الهدية غير صالحة');
    const wrap = gift.wrap === true, message = gift.message ? text(gift.message, 'رسالة الهدية', 1, 200) : '', recipient = gift.recipient ? text(gift.recipient, 'اسم المُهدى إليه', 2, 80) : '';
    if (!wrap && !message) return null;
    return { wrap, message, recipient, fee: wrap ? money(setting('giftWrapFee')) : 0 };
  };
  // ---- how the order reaches the shopper: standard delivery, express from the nearest branch, or pickup at a branch,
  // plus an optional tip for the courier. Built on the branches table and its per-branch stock, so the options match
  // the branches the app shows. Prices and times come from the server only.
  const TIPS = [0, 0.5, 1, 2];
  const PICKUP_READY_MINUTES = 30;
  const expressConfig = () => ({ fee: 2, maxKm: 8, baseMinutes: 25, perKmMinutes: 3, ...(setting('express', {}) || {}) });
  const kmBetween = (a, b) => {
    const rad = (d) => (d * Math.PI) / 180, dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const cartItems = (items) => (Array.isArray(items) ? items : []).slice(0, 200).map((l) => ({ productId: String(l?.productId || ''), quantity: Math.max(1, Math.min(1000, Math.floor(Number(l?.quantity) || 1))) })).filter((l) => l.productId);
  const branchHasAll = (branchId, items) => items.length > 0 && items.every((l) => (get('SELECT quantity FROM branch_stock WHERE branch_id=? AND product_id=?', branchId, l.productId)?.quantity ?? 0) >= l.quantity);
  const point = (lat, lng) => { const latitude = Number(lat), longitude = Number(lng); return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0) ? { latitude, longitude } : null; };
  function deliveryChoices(items, destination) {
    const cart = cartItems(items), branches = all('SELECT * FROM branches WHERE active=1 ORDER BY name'), cfg = expressConfig();
    const pickup = branches.map((b) => ({ branchId: b.id, name: b.name, city: b.city, address: b.address, hours: b.hours, readyInMinutes: PICKUP_READY_MINUTES, available: branchHasAll(b.id, cart),
      ...(destination && Number.isFinite(b.latitude) && Number.isFinite(b.longitude) ? { distanceKm: Math.round(kmBetween(destination, b) * 10) / 10 } : {}) }));
    let express;
    if (!destination) express = { available: false, reason: 'حدّد موقع التوصيل على الخريطة لمعرفة التوصيل السريع' };
    else {
      const near = branches.filter((b) => Number.isFinite(b.latitude) && Number.isFinite(b.longitude) && branchHasAll(b.id, cart)).map((b) => ({ b, km: kmBetween(destination, b) })).sort((x, y) => x.km - y.km)[0];
      if (!near) express = { available: false, reason: 'لا يوجد فرع قريب يتوفر فيه كل ما في السلة' };
      else if (near.km > cfg.maxKm) express = { available: false, reason: `أقرب فرع يبعد ${near.km.toFixed(1)} كم، والتوصيل السريع حتى ${cfg.maxKm} كم`, distanceKm: Math.round(near.km * 10) / 10 };
      else express = { available: true, fee: money(cfg.fee), etaMinutes: Math.round(cfg.baseMinutes + cfg.perKmMinutes * near.km), branch: { id: near.b.id, name: near.b.name }, distanceKm: Math.round(near.km * 10) / 10 };
    }
    return { express, pickup, tips: TIPS };
  }
  /** The shopper's choice, checked against what the server offers now. */
  function fulfillmentFor(body, destination) {
    const mode = ['standard', 'express', 'pickup'].includes(body.deliveryMode) ? body.deliveryMode : 'standard';
    let tip = 0;
    if (body.tip !== undefined && body.tip !== null && body.tip !== 0) {
      tip = money(number(body.tip, 'إكرامية السائق', 0, 10));
      if (!TIPS.includes(tip)) fail(400, 'اختر الإكرامية من القيم المعروضة', 'invalid_tip');
    }
    if (mode === 'standard') return { mode, tip, extraFee: 0, branchId: null };
    const choices = deliveryChoices(body.items, destination);
    if (mode === 'express') {
      if (!choices.express.available) fail(409, choices.express.reason || 'التوصيل السريع غير متاح لهذا العنوان', 'express_unavailable');
      return { mode, tip, extraFee: choices.express.fee, branchId: choices.express.branch.id, branchName: choices.express.branch.name, etaMinutes: choices.express.etaMinutes };
    }
    const branch = choices.pickup.find((b) => b.branchId === body.pickupBranchId);
    if (!branch) fail(400, 'اختر فرع الاستلام', 'unknown_branch');
    if (!branch.available) fail(409, `بعض الأصناف غير متوفرة في ${branch.name}`, 'out_of_stock_branch');
    return { mode, tip: 0, extraFee: 0, branchId: branch.branchId, branchName: branch.name, readyInMinutes: branch.readyInMinutes };
  }
  api.route('POST', '/delivery/options', ({ req, body }) => {
    rate(req, 'delivery-options', 120, 60_000);
    return deliveryChoices(body.items, point(body.latitude, body.longitude));
  });

  api.provide('prepareCheckout', (body, actor, address, paymentMethod) => {
    const slot = parseSlot(body.deliverySlot), gift = giftInput(body.gift);
    const notes = body.deliveryNotes ? text(body.deliveryNotes, 'ملاحظات التوصيل', 1, 300) : '';
    if (setting('requireTerms') && body.acceptTerms !== true) fail(400, 'يجب الموافقة على الشروط والأحكام قبل تأكيد الطلب', 'terms_required');
    const fulfillment = fulfillmentFor(body, point(address.latitude, address.longitude));
    const branchId = fulfillment.branchId || (body.branchId ? text(body.branchId, 'الفرع', 1, 100) : null);
    const cardToken = paymentMethod === 'card' ? body.cardToken : null;
    if (paymentMethod === 'card' && (typeof cardToken !== 'string' || !/^ptok_[a-f0-9]{32}$/.test(cardToken))) fail(400, 'أدخل بيانات البطاقة أولًا', 'card_token_required');
    let shippingInfo = null;
    return {
      branchId,
      fees: money((gift?.fee || 0) + fulfillment.tip),
      shipping(subtotal) {
        if (fulfillment.mode === 'pickup') return 0;
        shippingInfo = shippingFor(actor, address.city, subtotal);
        return money(shippingInfo.fee + fulfillment.extraFee);
      },
      chargeCard(total, orderId) {
        const t = get('SELECT * FROM payment_tokens WHERE id=? AND user_id=?', cardToken, actor.id);
        if (!t || t.used_at || t.expires_at <= now()) fail(409, 'انتهت صلاحية بيانات البطاقة؛ أدخلها مجددًا', 'card_token_expired');
        if (t.outcome === 'decline') fail(402, DECLINES[t.reason] || 'رُفضت البطاقة', t.reason || 'card_declined');
        run('UPDATE payment_tokens SET used_at=?,order_id=? WHERE id=?', now(), orderId, t.id);
        return { provider: 'sandbox', brand: t.brand, last4: t.last4, reference: `pay_${randomBytes(8).toString('hex')}`, amount: total, sandbox: true };
      },
      commit(orderId, lines, payment) {
        if (slot) {
          run('INSERT INTO delivery_slots VALUES(?,?,?,1) ON CONFLICT(date,window) DO UPDATE SET booked=booked+1', slot.date, slot.window, setting('slotCapacity'));
          const row = get('SELECT * FROM delivery_slots WHERE date=? AND window=?', slot.date, slot.window);
          if (row.booked > row.capacity) fail(409, 'امتلأ موعد التوصيل للتو؛ اختر موعدًا آخر', 'slot_unavailable');
        }
        if (branchId) api.use('moveBranchStock')(branchId, lines, -1);
        const { extraFee, ...chosen } = fulfillment;
        const data = { branchId, slot, deliveryNotes: notes, gift, fulfillment: { ...chosen, fee: extraFee }, termsAcceptedAt: body.acceptTerms === true ? now() : null, payment: payment ? { provider: payment.provider, brand: payment.brand, last4: payment.last4, reference: payment.reference, sandbox: true } : null, zone: shippingInfo?.zone ? { id: shippingInfo.zone.id, name: shippingInfo.zone.name, etaMinutes: shippingInfo.zone.etaMinutes } : null, tier: shippingInfo?.tier || null };
        run('INSERT INTO order_extras VALUES(?,?)', orderId, json(data));
        api.emit('orderPlaced', orderId, lines, actor);
      },
    };
  });
  const extrasFor = (orderId) => parse(get('SELECT data FROM order_extras WHERE order_id=?', orderId)?.data, null);
  api.provide('orderExtras', (o) => {
    const data = extrasFor(o.id), rating = get('SELECT rating,driver_rating AS driverRating,comment FROM order_ratings WHERE order_id=?', o.id);
    return data || rating ? { ...(data || {}), rating: rating || null } : null;
  });
  api.on('orderCancelled', (o) => {
    const data = extrasFor(o.id);
    if (data?.slot) run('UPDATE delivery_slots SET booked=MAX(0,booked-1) WHERE date=? AND window=?', data.slot.date, data.slot.window);
    if (data?.branchId) api.use('moveBranchStock')(data.branchId, parse(o.items, []), 1);
  });
  api.route('POST', '/checkout/quote', ({ req, body }) => {
    const actor = optionalUser(req);
    const { lines, subtotal } = c.quote(body.items, { branchId: body.branchId || null });
    let discount = 0, couponError = null;
    if (body.couponCode) { try { discount = c.discountFor(body.couponCode, subtotal, actor?.id ?? null).discount; } catch (error) { if (!error.status) throw error; couponError = error.message; } }
    const fulfillment = fulfillmentFor(body, point(body.address?.latitude, body.address?.longitude));
    const shipping = shippingFor(actor, body.address?.city || '', subtotal), gift = giftInput(body.gift), slot = body.deliverySlot ? slotState(body.deliverySlot.date, body.deliverySlot.window) : null;
    const delivery = fulfillment.mode === 'pickup' ? 0 : money(shipping.fee + fulfillment.extraFee);
    const total = money(subtotal - discount + delivery + (gift?.fee || 0) + fulfillment.tip);
    const budget = actor ? api.use('budgetStatus')(actor.id) : null;
    return { lines, subtotal, discount, couponError, shipping: delivery, shippingBeforeBenefits: shipping.base, deliveryMode: fulfillment.mode, expressFee: fulfillment.extraFee, tip: fulfillment.tip,
      fulfillment: { mode: fulfillment.mode, branchName: fulfillment.branchName || null, etaMinutes: fulfillment.etaMinutes || null, readyInMinutes: fulfillment.readyInMinutes || null }, zone: shipping.zone, tier: shipping.tier, giftWrapFee: gift?.fee || 0, total, currency: setting('currency'),
      freeShippingRemaining: shipping.freeOver !== null && shipping.base > 0 ? money(Math.max(0, shipping.freeOver - subtotal)) : 0,
      slot, budget: budget ? { ...budget, exceeds: budget.weeklyBudget !== null && total > budget.remaining } : null, requireTerms: !!setting('requireTerms') };
  });
  api.provide('publicSettings', () => ({ giftWrapFee: setting('giftWrapFee'), deliveryOtp: setting('deliveryOtp') !== false, requireTerms: !!setting('requireTerms'), sandboxPayments: !!setting('sandboxPayments'), timezoneOffsetMinutes: setting('timezoneOffsetMinutes'), displayCurrencies: setting('displayCurrencies', {}) }));

  // ---- gift cards ----
  const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const giftItem = (g) => ({ id: g.id, last4: g.last4, amount: g.amount, balance: g.balance, note: g.note, redeemed: !!g.redeemed_at, redeemedAt: g.redeemed_at, expiresAt: g.expires_at, active: !!g.active, createdAt: g.created_at });
  api.route('GET', '/admin/gift-cards', ({ req }) => { admin(req); return { giftCards: all('SELECT * FROM gift_cards ORDER BY created_at DESC LIMIT 500').map(giftItem) }; });
  api.route('POST', '/admin/gift-cards', ({ req, body }) => {
    const actor = admin(req), amount = money(number(body.amount, 'قيمة البطاقة', 1, 10000));
    const expiresAt = body.expiresAt ? c.date(body.expiresAt, 'تاريخ الانتهاء') : null; if (expiresAt && expiresAt <= now()) fail(400, 'تاريخ الانتهاء يجب أن يكون في المستقبل');
    const raw = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const code = `LQ-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`, cardId = id('gft');
    run('INSERT INTO gift_cards VALUES(?,?,?,?,?,?,?,NULL,NULL,?,1,?)', cardId, hash(normalizeCode(code)), raw.slice(-4), amount, amount, body.note ? text(body.note, 'ملاحظة', 1, 200) : '', actor.id, expiresAt, now());
    if (body.email) { const user = get('SELECT id FROM users WHERE email=?', c.email(body.email)); if (user) notify(user.id, 'وصلتك بطاقة هدية 🎁', `رمز بطاقتك: ${code} — اشحنها من «المحفظة».`); }
    audit(actor, 'giftcard.issue', cardId, { amount });
    return [201, { giftCard: giftItem(get('SELECT * FROM gift_cards WHERE id=?', cardId)), code }];
  });
  api.route('DELETE', '/admin/gift-cards/:cardId', ({ req, params }) => { const actor = admin(req); if (!run('UPDATE gift_cards SET active=0 WHERE id=?', params.cardId).changes) fail(404, 'البطاقة غير موجودة', 'not_found'); audit(actor, 'giftcard.disable', params.cardId); return { ok: true }; });
  api.route('POST', '/gift-cards/redeem', ({ req, body }) => {
    const actor = requireUser(req); rate(req, 'gift-card', 10);
    const code = normalizeCode(body.code); if (!/^LQ[A-Z0-9]{12}$/.test(code)) fail(400, 'رمز البطاقة غير صالح', 'invalid_gift_card');
    return transaction(() => {
      const g = get('SELECT * FROM gift_cards WHERE code_hash=?', hash(code));
      if (!g || !g.active) fail(404, 'رمز البطاقة غير صحيح', 'invalid_gift_card');
      if (g.redeemed_at || g.balance <= 0) fail(409, 'استُخدمت هذه البطاقة مسبقًا', 'gift_card_used');
      if (g.expires_at && g.expires_at <= now()) fail(409, 'انتهت صلاحية البطاقة', 'gift_card_expired');
      const entry = ledger(actor.id, g.balance, 'gift_card', `شحن بطاقة هدية تنتهي بـ ${g.last4}`);
      run('UPDATE gift_cards SET balance=0,redeemed_by=?,redeemed_at=? WHERE id=?', actor.id, now(), g.id);
      notify(actor.id, 'شُحنت محفظتك', `أضيف ${g.balance} ${setting('currency')} من بطاقة الهدية`);
      return { amount: g.balance, walletBalance: balance(actor.id), transaction: entry, currency: setting('currency') };
    });
  });

  // ---- delivery code (proof of delivery) ----
  api.on('orderStatus', (o, status) => {
    if (status !== 'out_for_delivery' || setting('deliveryOtp') === false || get('SELECT order_id FROM delivery_codes WHERE order_id=?', o.id)) return;
    const code = String(randomInt(1000, 10000));
    run('INSERT INTO delivery_codes VALUES(?,?,?,0,?,NULL)', o.id, encrypt(code), hash(`${o.id}:${code}`), now());
    notify(o.user_id, 'طلبك في الطريق 🚚', `رمز التسليم ${code} — أعطه للسائق عند الاستلام فقط.`, o.id);
  });
  api.route('GET', '/orders/:orderId/delivery-code', ({ req, params }) => {
    const actor = requireUser(req), o = ownOrder(actor, params.orderId);
    if (o.user_id !== actor.id) fail(403, 'رمز التسليم يظهر لصاحب الطلب فقط', 'forbidden');
    const row = get('SELECT * FROM delivery_codes WHERE order_id=?', o.id);
    return { orderId: o.id, code: row && !row.verified_at ? decrypt(row.code) : null, verified: !!row?.verified_at, status: o.status };
  });
  api.provide('verifyDeliveryCode', (o, otp) => {
    const row = get('SELECT * FROM delivery_codes WHERE order_id=?', o.id);
    if (!row || setting('deliveryOtp') === false) return;
    if (row.attempts >= 5) fail(429, 'محاولات كثيرة؛ تواصل مع الدعم لتأكيد التسليم', 'delivery_code_locked');
    const valid = typeof otp === 'string' && /^\d{4}$/.test(otp) && timingSafeEqual(Buffer.from(hash(`${o.id}:${otp}`), 'hex'), Buffer.from(row.code_hash, 'hex'));
    if (!valid) { run('UPDATE delivery_codes SET attempts=attempts+1 WHERE order_id=?', o.id); fail(403, 'رمز التسليم غير صحيح؛ اطلبه من العميل', 'invalid_delivery_code'); }
    run('UPDATE delivery_codes SET verified_at=? WHERE order_id=?', now(), o.id);
  });

  // ---- invoice ----
  const PAYMENT_LABELS = { cod: 'الدفع عند الاستلام', wallet: 'رصيد المحفظة', card: 'بطاقة (وضع تجريبي)' };
  api.route('GET', '/orders/:orderId/invoice', ({ req, params }) => {
    const actor = requireUser(req), o = c.order(ownOrder(actor, params.orderId)), customer = get('SELECT name,email FROM users WHERE id=?', o.userId), store = setting('storeName');
    const extras = o.extras || {}, giftFee = extras.gift?.fee || 0;
    const invoice = { number: `INV-${o.id.slice(3, 11).toUpperCase()}`, orderId: o.id, issuedAt: now(), orderDate: o.createdAt, store, customer: customer?.name || '', city: o.address.city || '', street: o.address.street || '', items: o.items.map((line) => ({ ...line, lineTotal: money(line.price * line.quantity) })), subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, giftWrapFee: giftFee, total: o.total, currency: o.currency, payment: PAYMENT_LABELS[o.paymentMethod] + (extras.payment?.last4 ? ` •••• ${extras.payment.last4}` : ''), paymentStatus: o.paymentStatus, status: o.status };
    const row = (label, value) => `<tr><td>${escapeHtml(label)}</td><td class="n">${escapeHtml(value)} ${escapeHtml(o.currency)}</td></tr>`;
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(invoice.number)}</title><style>body{font-family:Tajawal,Arial,sans-serif;margin:24px;color:#241B4B}h1{margin:0;font-size:22px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #E4DEF7;padding:8px;text-align:right}.n{text-align:left;direction:ltr}.total td{font-weight:800;font-size:17px}.muted{color:#6E6890;font-size:13px}</style></head><body><h1>${escapeHtml(store)} — فاتورة</h1><p class="muted">رقم الفاتورة ${escapeHtml(invoice.number)} · الطلب ${escapeHtml(o.id)} · ${escapeHtml(o.createdAt.slice(0, 10))}</p><p>العميل: ${escapeHtml(invoice.customer)} — ${escapeHtml(invoice.city)}</p><table><thead><tr><th>المنتج</th><th>الكمية</th><th class="n">السعر</th><th class="n">المجموع</th></tr></thead><tbody>${invoice.items.map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>${line.quantity}</td><td class="n">${line.price}</td><td class="n">${line.lineTotal}</td></tr>`).join('')}</tbody></table><table>${row('المجموع الفرعي', o.subtotal)}${o.discount ? row('الخصم', `-${o.discount}`) : ''}${row('التوصيل', o.shipping)}${giftFee ? row('تغليف الهدية', giftFee) : ''}<tr class="total"><td>الإجمالي</td><td class="n">${o.total} ${escapeHtml(o.currency)}</td></tr></table><p class="muted">طريقة الدفع: ${escapeHtml(invoice.payment)} · حالة الدفع: ${escapeHtml(o.paymentStatus)}</p></body></html>`;
    return { invoice, html };
  });

  // ---- order rating ----
  api.route('GET', '/orders/:orderId/rating', ({ req, params }) => { const o = ownOrder(requireUser(req), params.orderId); return { rating: get('SELECT rating,driver_rating AS driverRating,comment,created_at AS createdAt FROM order_ratings WHERE order_id=?', o.id) || null }; });
  api.route('POST', '/orders/:orderId/rating', ({ req, body, params }) => {
    const actor = requireUser(req), o = ownOrder(actor, params.orderId);
    if (o.user_id !== actor.id) fail(403, 'يقيّم الطلبَ صاحبُه فقط', 'forbidden');
    if (o.status !== 'delivered') fail(409, 'يمكن تقييم الطلب بعد استلامه');
    if (get('SELECT order_id FROM order_ratings WHERE order_id=?', o.id)) fail(409, 'قيّمت هذا الطلب مسبقًا');
    run('INSERT INTO order_ratings VALUES(?,?,?,?,?,?)', o.id, actor.id, integer(body.rating, 'التقييم', 1, 5), body.driverRating == null ? null : integer(body.driverRating, 'تقييم السائق', 1, 5), body.comment ? text(body.comment, 'التعليق', 1, 1000) : '', now());
    return [201, { rating: get('SELECT rating,driver_rating AS driverRating,comment,created_at AS createdAt FROM order_ratings WHERE order_id=?', o.id) }];
  });

  // ---- returns of selected items with a photo ----
  api.route('POST', '/orders/:orderId/return-request', ({ req, body, params }) => {
    const actor = requireUser(req), o = ownOrder(actor, params.orderId), reason = text(body.reason, 'سبب الإرجاع', 5, 2000);
    if (o.user_id !== actor.id) fail(403, 'يطلب الإرجاعَ صاحبُ الطلب فقط', 'forbidden');
    if (o.status !== 'delivered') fail(409, 'يمكن إرجاع الطلب بعد استلامه فقط');
    const delivered = get("SELECT created_at FROM order_events WHERE order_id=? AND status='delivered' ORDER BY created_at DESC LIMIT 1", o.id);
    if (!delivered || Date.now() - Date.parse(delivered.created_at) > setting('returnsDays') * 86400_000) fail(409, 'انتهت مهلة الإرجاع');
    if (get('SELECT id FROM returns WHERE order_id=?', o.id)) fail(409, 'يوجد طلب إرجاع لهذا الطلب');
    const ordered = parse(o.items, []);
    if (!Array.isArray(body.items) || !body.items.length) fail(400, 'اختر المنتجات التي تريد إرجاعها');
    const seen = new Set();
    const items = body.items.map((item) => {
      const line = ordered.find((x) => x.productId === item?.productId); if (!line) fail(400, 'أحد المنتجات ليس ضمن الطلب');
      if (seen.has(line.productId)) fail(400, 'لا تكرر المنتج'); seen.add(line.productId);
      return { productId: line.productId, name: line.name, price: line.price, quantity: integer(item.quantity, 'الكمية', 1, line.quantity) };
    });
    const whole = items.length === ordered.length && items.every((item) => item.quantity === ordered.find((x) => x.productId === item.productId).quantity);
    const value = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const refund = whole ? o.total : money(value * (o.subtotal > 0 ? 1 - o.discount / o.subtotal : 1));
    const result = transaction(() => {
      const photoId = body.photo ? api.use('saveUpload')(actor.id, body.photo, 'return') : null;
      const returnId = id('ret'), time = now();
      run('INSERT INTO returns VALUES(?,?,?,?,?,?,?,?)', returnId, o.id, actor.id, reason, 'requested', '', time, time);
      if (!whole || photoId) run('INSERT INTO return_details VALUES(?,?,?,?)', returnId, json(whole ? ordered.map(({ productId, name, price, quantity }) => ({ productId, name, price, quantity })) : items), photoId, refund);
      notify(actor.id, 'طلب إرجاع جديد', `سجّلنا إرجاع ${items.length} منتج للمراجعة. المبلغ المتوقع ${refund} ${o.currency}.`, o.id);
      return { id: returnId, orderId: o.id, status: 'requested', items, refund, photoId, partial: !whole };
    });
    return [201, { returnRequest: result }];
  });
  api.provide('returnPlan', (r, o) => {
    const details = get('SELECT * FROM return_details WHERE return_id=?', r.id);
    if (!details) return null;
    const items = parse(details.items, []), ordered = parse(o.items, []);
    const whole = items.length === ordered.length && items.every((item) => ordered.find((x) => x.productId === item.productId)?.quantity === item.quantity);
    return whole ? null : { lines: items.map(({ productId, quantity }) => ({ productId, quantity })), refund: details.refund };
  });
  const returnWithDetails = (r) => { const d = get('SELECT * FROM return_details WHERE return_id=?', r.id); return { id: r.id, orderId: r.order_id, reason: r.reason, status: r.status, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at, items: d ? parse(d.items, []) : null, photoId: d?.photo_id || null, refund: d ? d.refund : get('SELECT total FROM orders WHERE id=?', r.order_id)?.total ?? null }; };
  api.route('GET', '/me/returns', ({ req }) => ({ returns: all('SELECT * FROM returns WHERE user_id=? ORDER BY created_at DESC', requireUser(req).id).map(returnWithDetails) }));
  api.route('GET', '/admin/return-details/:returnId', ({ req, params }) => { admin(req); const r = get('SELECT * FROM returns WHERE id=?', params.returnId); if (!r) fail(404, 'طلب الإرجاع غير موجود', 'not_found'); return { returnRequest: returnWithDetails(r) }; });
  api.on('deleteUser', (userId) => {
    // Retain transaction metadata and gift-wrap fees, but not delivery instructions or recipient PII.
    for (const row of all('SELECT x.order_id,x.data FROM order_extras x JOIN orders o ON o.id=x.order_id WHERE o.user_id=?', userId)) {
      const data = parse(row.data, {});
      const gift = data.gift ? { wrap: !!data.gift.wrap, fee: data.gift.fee ?? 0 } : null;
      run('UPDATE order_extras SET data=? WHERE order_id=?', json({ ...data, deliveryNotes: '', gift }), row.order_id);
    }
    run('DELETE FROM payment_tokens WHERE user_id=?', userId);
    run("UPDATE order_ratings SET comment='' WHERE user_id=?", userId);
  });
  api.use('registerExport')('orderRatings', (userId) => all('SELECT order_id AS orderId,rating,driver_rating AS driverRating,comment FROM order_ratings WHERE user_id=?', userId));
}
