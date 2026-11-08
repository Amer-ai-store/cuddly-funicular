/* JAWAFA ONE AI — pure logic shared by the browser app and Node tests.
 * No network, no DOM, no secrets. Every dataset carries a source label:
 *   LIVE        — read from a verified connection (none exists yet in this build)
 *   DEMO        — generated sample, for interface development only
 *   UNVERIFIED  — imported or typed in, not checked against the source
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JawafaCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- roles (must match firestore.rules) ----------
  const ROLES = {
    owner:               { ar: "المالك",            en: "Owner",               manage: true,  write: true,  tasks: true },
    chairman:            { ar: "رئيس مجلس الإدارة", en: "Chairman",            manage: true,  write: true,  tasks: true },
    general_manager:     { ar: "المدير العام",      en: "General Manager",     manage: true,  write: true,  tasks: true },
    procurement_manager: { ar: "مدير المشتريات",    en: "Procurement Manager", manage: false, write: true,  tasks: true },
    branch_manager:      { ar: "مدير الفرع",        en: "Branch Manager",      manage: false, write: true,  tasks: true },
    accountant:          { ar: "محاسب",             en: "Accountant",          manage: false, write: true,  tasks: true },
    auditor:             { ar: "مدقق",              en: "Auditor",             manage: false, write: false, tasks: false },
    employee:            { ar: "موظف",              en: "Employee",            manage: false, write: false, tasks: true },
  };
  const INVITABLE_ROLES = Object.keys(ROLES).filter(r => r !== "owner");

  function roleOf(company, uid) {
    if (!company || !uid) return null;
    if (company.ownerUid === uid) return "owner";
    if (!Array.isArray(company.memberIds) || !company.memberIds.includes(uid)) return null;
    const r = company.roles && company.roles[uid];
    return INVITABLE_ROLES.includes(r) ? r : null;
  }
  const can = (role, what) => !!(role && ROLES[role] && ROLES[role][what]);

  // ---------- identifiers & validation ----------
  const normalizeEmail = (e) => String(e || "").trim().toLowerCase();
  const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(e)) && normalizeEmail(e).length <= 200;
  const inviteId = (companyId, email) => companyId + "__" + normalizeEmail(email);
  function validCompanyName(n) { const s = String(n || "").trim(); return s.length > 0 && s.length <= 80; }

  const SOCIAL = {
    facebook: /^https:\/\/(www\.)?(facebook\.com|fb\.com)\/.+/,
    instagram: /^https:\/\/(www\.)?instagram\.com\/.+/,
    tiktok: /^https:\/\/(www\.)?tiktok\.com\/.+/,
  };
  function validateSocial(platform, url) {
    const u = String(url || "").trim();
    if (!u) return { ok: true, value: "" };
    if (!SOCIAL[platform]) return { ok: false, error: "منصة غير مدعومة" };
    if (u.length > 300) return { ok: false, error: "الرابط طويل جدًا" };
    if (!SOCIAL[platform].test(u)) return { ok: false, error: "يجب أن يبدأ الرابط بـ https:// ونطاق المنصة الصحيح" };
    return { ok: true, value: u };
  }

  // ---------- agent message router ----------
  const MSG_STATES = ["QUEUED", "DELIVERED", "READ", "ACKNOWLEDGED", "FAILED"];
  const NEXT = { QUEUED: ["DELIVERED", "FAILED"], DELIVERED: ["READ", "FAILED"], READ: ["ACKNOWLEDGED"], ACKNOWLEDGED: [], FAILED: [] };
  const canTransition = (from, to) => (NEXT[from] || []).includes(to);

  /** Creates a router over a message store. A message only advances with evidence from the
   * destination (a receipt object); without a reachable channel it stays QUEUED. */
  function createRouter(store) {
    store = store || new Map();
    return {
      store,
      send({ id, from, to, body, sentBy, at }) {
        if (!id) throw new Error("id required");
        if (store.has(id)) return { duplicate: true, message: store.get(id) };
        const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
        if (!from || recipients.length === 0) throw new Error("from and to required");
        if (recipients.length > 20) throw new Error("too many recipients");
        const text = String(body || "");
        if (!text.trim() || text.length > 4000) throw new Error("body must be 1..4000 chars");
        const m = { id, from, to: recipients, body: text, sentBy: sentBy || null, status: "QUEUED", history: [{ status: "QUEUED", at: at || Date.now() }] };
        store.set(id, m);
        return { duplicate: false, message: m };
      },
      advance(id, to, receipt) {
        const m = store.get(id);
        if (!m) throw new Error("unknown message " + id);
        if (!canTransition(m.status, to)) throw new Error(`illegal transition ${m.status} -> ${to}`);
        if (to !== "FAILED" && !(receipt && receipt.by && m.to.includes(receipt.by)))
          throw new Error("status " + to + " needs a receipt from a recipient");
        m.status = to;
        m.history.push({ status: to, at: (receipt && receipt.at) || Date.now(), by: receipt && receipt.by || null, reason: receipt && receipt.reason || null });
        return m;
      },
      inbox(agentId) { return [...store.values()].filter(m => m.to.includes(agentId)); },
      outbox(agentId) { return [...store.values()].filter(m => m.from === agentId); },
    };
  }

  // ---------- anomaly engine ----------
  // Every finding is a lead, not an accusation. Classification on DEMO / UNVERIFIED data is never
  // stronger than "needs verification"; "proven" requires LIVE data plus attached evidence.
  const FINDING_CLASS = { proven: "مثبت", unproven: "غير مثبت", verify: "يحتاج تحققًا", hypothesis: "فرضية" };

  function classify(source, confidence, hasEvidence) {
    if (source !== "LIVE") return confidence >= 0.6 ? "verify" : "hypothesis";
    if (hasEvidence && confidence >= 0.9) return "proven";
    return confidence >= 0.6 ? "verify" : "unproven";
  }

  function detectAnomalies(data, opts) {
    opts = opts || {};
    const source = data && data.source || "UNVERIFIED";
    const startHour = opts.startHour ?? 7, endHour = opts.endHour ?? 23;
    const out = [];
    const push = (type, title, ref, confidence, detail) => out.push({
      id: type + ":" + ref, type, title, ref, confidence, detail, source,
      classification: classify(source, confidence, false), evidence: [],
    });
    const invoices = (data && data.invoices) || [];
    // Duplicate invoices: same branch, amount, customer and items within 10 minutes.
    const seen = new Map();
    for (const inv of invoices) {
      const key = [inv.branch, inv.total, inv.customer || "", (inv.items || []).map(i => i.sku + "x" + i.qty).sort().join(",")].join("|");
      const prev = seen.get(key);
      if (prev && Math.abs(inv.at - prev.at) <= 10 * 60 * 1000 && prev.no !== inv.no)
        push("duplicate_invoice", "فاتورة مكررة محتملة", inv.no, 0.7, `مطابقة للفاتورة ${prev.no} خلال ${Math.round(Math.abs(inv.at - prev.at) / 60000)} دقيقة`);
      seen.set(key, inv);
      if (inv.status === "void" || inv.status === "edited") {
        const h = new Date(inv.modifiedAt || inv.at).getHours();
        if (h < startHour || h >= endHour)
          push("off_hours_change", inv.status === "void" ? "إلغاء خارج أوقات العمل" : "تعديل خارج أوقات العمل", inv.no, 0.55, `الساعة ${h}:00 بواسطة ${inv.user || "غير معروف"}`);
      }
      if (N(inv.discountPct) >= (opts.maxDiscount ?? 25))
        push("high_discount", "خصم مرتفع", inv.no, 0.5, `خصم ${inv.discountPct}% بواسطة ${inv.user || "غير معروف"}`);
    }
    // Sales without stock.
    const stock = new Map(((data && data.stock) || []).map(s => [s.branch + "|" + s.sku, N(s.qty)]));
    for (const inv of invoices) for (const it of inv.items || []) {
      const k = inv.branch + "|" + it.sku;
      if (stock.has(k) && stock.get(k) < 0) { push("negative_stock", "بيع دون رصيد مخزني", inv.no + "/" + it.sku, 0.6, `الرصيد ${stock.get(k)} للصنف ${it.sku}`); stock.set(k, 0); }
    }
    // Cash variances.
    for (const c of (data && data.cash) || []) {
      const diff = N(c.counted) - N(c.expected);
      if (Math.abs(diff) >= (opts.cashTolerance ?? 50))
        push("cash_variance", diff < 0 ? "عجز صندوق" : "زيادة صندوق", c.branch + "/" + c.day, Math.min(0.9, 0.5 + Math.abs(diff) / 2000), `الفرق ${diff.toFixed(2)}`);
    }
    // Unmatched cheques.
    const bank = new Set(((data && data.bank) || []).map(b => b.chequeNo + "|" + N(b.amount).toFixed(2)));
    for (const ch of (data && data.cheques) || []) {
      if (ch.status === "cleared" && !bank.has(ch.no + "|" + N(ch.amount).toFixed(2)))
        push("unmatched_cheque", "شيك غير مطابق لكشف البنك", ch.no, 0.65, `المبلغ ${N(ch.amount).toFixed(2)}`);
    }
    return out.sort((a, b) => b.confidence - a.confidence);
  }

  // ---------- demo dataset (clearly labelled, deterministic) ----------
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function N(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  function demoDataset(now) {
    const r = rng(20261106);
    now = now || Date.UTC(2026, 10, 6, 12);
    const day = 86400000;
    const branches = [
      { id: "B1", name: "أسواق جوافة — الفرع الرئيسي", kind: "market", lat: 31.955, lng: 35.91 },
      { id: "B2", name: "مطعم جوافة", kind: "restaurant", lat: 31.97, lng: 35.88 },
      { id: "B3", name: "أفران جوافة", kind: "bakery", lat: 31.94, lng: 35.93 },
      { id: "W1", name: "مستودع جوافة", kind: "warehouse", lat: 31.99, lng: 35.95 },
    ];
    const skus = [["S-100", "أرز 5 كغ", 6.5], ["S-101", "زيت زيتون 1 لتر", 7.9], ["S-102", "خبز عربي", 0.5], ["S-103", "معكرونة", 0.9], ["S-104", "حليب 1 لتر", 1.1], ["S-105", "سكر 2 كغ", 1.6]];
    const users = ["cashier.1", "cashier.2", "supervisor.1"];
    const invoices = [];
    let no = 5000;
    for (let d = 13; d >= 0; d--) {
      const count = 6 + Math.floor(r() * 6);
      for (let i = 0; i < count; i++) {
        const b = branches[Math.floor(r() * 3)];
        const items = [];
        for (let k = 0; k < 1 + Math.floor(r() * 3); k++) { const s = skus[Math.floor(r() * skus.length)]; items.push({ sku: s[0], qty: 1 + Math.floor(r() * 4), price: s[2] }); }
        const total = +items.reduce((t, it) => t + it.qty * it.price, 0).toFixed(2);
        const at = now - d * day - Math.floor(r() * 10) * 3600000;
        invoices.push({ no: "INV-" + (no++), branch: b.id, total, items, at, user: users[Math.floor(r() * users.length)], status: "ok", discountPct: Math.floor(r() * 10) });
      }
    }
    // Seed a few situations for the anomaly engine to find.
    const dup = { ...invoices[invoices.length - 3], no: "INV-" + (no++), at: invoices[invoices.length - 3].at + 4 * 60000 };
    invoices.push(dup);
    invoices.push({ no: "INV-" + (no++), branch: "B1", total: 42, items: [{ sku: "S-101", qty: 5, price: 8.4 }], at: now - 2 * day, modifiedAt: Date.UTC(2026, 10, 4, 1, 20), user: "cashier.2", status: "void", discountPct: 0 });
    invoices.push({ no: "INV-" + (no++), branch: "B2", total: 30, items: [{ sku: "S-104", qty: 20, price: 1.5 }], at: now - day, user: "supervisor.1", status: "ok", discountPct: 35 });
    const stock = [];
    for (const b of branches) for (const s of skus) stock.push({ branch: b.id, sku: s[0], name: s[1], qty: Math.floor(r() * 120) - (b.id === "B3" && s[0] === "S-102" ? 140 : 0), reorder: 25 });
    const cash = branches.slice(0, 3).map((b, i) => ({ branch: b.id, day: "2026-11-05", expected: 1200 + i * 300, counted: 1200 + i * 300 + (i === 1 ? -180 : 4) }));
    const cheques = [
      { no: "CH-7781", party: "مورد الحبوب", amount: 2400, due: now + 3 * day, status: "pending" },
      { no: "CH-7782", party: "مورد الألبان", amount: 980, due: now + 6 * day, status: "pending" },
      { no: "CH-7760", party: "مورد الزيوت", amount: 1500, due: now - 4 * day, status: "cleared" },
      { no: "CH-7761", party: "مورد التغليف", amount: 620, due: now - 6 * day, status: "cleared" },
    ];
    const bank = [{ chequeNo: "CH-7760", amount: 1500 }];
    const employees = 12 + Math.floor(r() * 8);
    return { source: "DEMO", generatedAt: now, branches, skus: skus.map(([sku, name, price]) => ({ sku, name, price })), invoices, stock, cash, cheques, bank, employees };
  }

  // ---------- aggregates ----------
  function dailySales(data, days, now) {
    now = now || data.generatedAt || Date.now();
    const out = [];
    const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
    for (let d = days - 1; d >= 0; d--) {
      const from = start.getTime() - d * 86400000, to = from + 86400000;
      const total = data.invoices.filter(i => i.status !== "void" && i.at >= from && i.at < to).reduce((t, i) => t + i.total, 0);
      out.push({ day: new Date(from).toISOString().slice(0, 10), total: +total.toFixed(2) });
    }
    return out;
  }
  function kpis(data) {
    const valid = data.invoices.filter(i => i.status !== "void");
    const price = new Map(data.skus.map(s => [s.sku, s.price]));
    const stockValue = data.stock.reduce((t, s) => t + Math.max(0, s.qty) * (price.get(s.sku) || 0), 0);
    const low = data.stock.filter(s => s.qty < s.reorder);
    const due7 = data.cheques.filter(c => c.status === "pending" && c.due - (data.generatedAt || Date.now()) <= 7 * 86400000);
    return {
      sales: +valid.reduce((t, i) => t + i.total, 0).toFixed(2),
      invoices: valid.length,
      stockValue: +stockValue.toFixed(2),
      lowStock: low.length,
      chequesDue7: due7.length,
      chequesDue7Amount: due7.reduce((t, c) => t + c.amount, 0),
      employees: data.employees,
      branches: data.branches.length,
    };
  }

  return { ROLES, INVITABLE_ROLES, roleOf, can, normalizeEmail, isEmail, inviteId, validCompanyName, validateSocial,
    MSG_STATES, canTransition, createRouter, FINDING_CLASS, classify, detectAnomalies, demoDataset, dailySales, kpis };
});
