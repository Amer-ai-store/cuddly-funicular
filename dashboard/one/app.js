// JAWAFA ONE AI — multi-company command center (GitHub Pages / PWA).
// Data rules: nothing here invents operational numbers. Figures come from a dataset that carries
// its source label; the only dataset in this build is the DEMO generator in core.js, and every
// screen that shows it says so. Company, membership, tasks and agent messages are real Firestore
// records protected by firestore.rules (tested in tests/firestore).
import { OFFICIAL_AGENTS } from "../aas/official-agent-roster.mjs";

const C = window.JawafaCore;
const FIREBASE_VERSION = "10.14.1";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const EMULATOR = params.has("emulator") && ["localhost", "127.0.0.1"].includes(location.hostname);

// ---------- helpers ----------
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
const S = (v, max = 300) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let toastTimer;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3800); }
const lang = () => (document.documentElement.lang === "en" ? "en" : "ar");
const T = (ar, en) => (lang() === "en" ? en : ar);
const money = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + T("د.أ", "JOD");
const num = (v) => Number(v || 0).toLocaleString("en-US");
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(lang() === "en" ? "en-GB" : "ar", { dateStyle: "medium", timeStyle: "short" }) : "—");
const badge = (kind, text) => el("span", { class: "badge " + kind }, text);
const SOURCE_BADGE = { DEMO: () => badge("demo", T("بيانات تجريبية DEMO", "DEMO data")), LIVE: () => badge("live", "LIVE"), UNVERIFIED: () => badge("demo", "UNVERIFIED") };
const STATUS_BADGE = {
  VERIFIED: () => badge("verified", "VERIFIED"), TEST_PASSED: () => badge("live", "TEST_PASSED"),
  BUILT: () => badge("built", "BUILT_NOT_TESTED"), BLOCKED: () => badge("blocked", "BLOCKED"),
  NOT_STARTED: () => badge("", "NOT_STARTED"), DEMO: () => badge("demo", "DEMO"),
};

// ---------- navigation ----------
const NAV = [
  ["home", "⌂", "الرئيسية", "Home"],
  ["sales", "🛒", "المبيعات", "Sales"],
  ["inventory", "📦", "المخزون", "Inventory"],
  ["finance", "🏦", "المالية والشيكات", "Finance & cheques"],
  ["investigations", "🛡", "التحقيقات", "Investigations"],
  ["maps", "📍", "الخرائط", "Maps"],
  ["assistant", "✦", "المساعد الذكي", "AI assistant"],
  ["agents", "⚇", "الوكلاء", "Agents"],
  ["sep", "", "الإدارة", "Administration"],
  ["connections", "🔗", "الربط والتكاملات", "Integrations"],
  ["company", "🏢", "الشركة", "Company"],
  ["branches", "🏬", "الفروع والمستودعات", "Branches & warehouses"],
  ["members", "👥", "المستخدمون والصلاحيات", "Users & roles"],
  ["audit", "🧾", "سجل التدقيق", "Audit log"],
  ["plans", "★", "الخطط · Premium Plus", "Plans · Premium Plus"],
];
const BOTTOM = ["home", "agents", "inventory", "sales", "company"];
let current = "home";

function buildNav() {
  $("nav").replaceChildren(...NAV.map(([id, ico, ar, en]) => id === "sep"
    ? el("div", { class: "sep" }, T(ar, en))
    : el("a", { href: "#" + id, "data-nav": id }, el("span", { class: "ico", "aria-hidden": "true" }, ico), T(ar, en))));
  $("bottom-nav").replaceChildren(...BOTTOM.map(id => { const n = NAV.find(x => x[0] === id); return el("a", { href: "#" + id, "data-nav": id }, el("span", { class: "ico", "aria-hidden": "true" }, n[1]), T(n[2], n[3])); }));
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const k = node.dataset.i18n; const d = I18N[k]; if (d) node.textContent = T(d[0], d[1]);
  }
  $("lang-btn").textContent = lang() === "en" ? "عربي" : "EN";
  $("q").placeholder = T("بحث في النظام...", "Search...");
}
const I18N = {
  brand: ["جوافة", "JAWAFA"], saasTitle: ["مجانية لكل صاحب مصلحة", "Free for every business"],
  saasBody: ["بلا رسوم ولا عمولة. كل شركة معزولة ببياناتها. الاشتراك الوحيد اختياري: Premium Plus.", "No fees, no commission. Every company is isolated. The only subscription is the optional Premium Plus."],
  legacy: ["مركز القيادة السابق (جميع الوحدات الحالية)", "Previous command center (all existing modules)"],
};

function show(view) {
  view = (view || "home").replace(/^#/, "");
  if (!NAV.some(n => n[0] === view && view !== "sep")) view = "home";
  current = view;
  for (const s of document.querySelectorAll("section.view")) s.hidden = s.dataset.view !== view;
  for (const a of document.querySelectorAll("[data-nav]")) { if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  $("side").classList.remove("open"); $("menu-btn").setAttribute("aria-expanded", "false");
  render();
  window.scrollTo(0, 0);
}

// ---------- state ----------
const state = {
  cloud: "loading", // loading | ready | unconfigured | failed
  user: null, profile: null, companies: [], companyId: null, invites: [], messages: [], tasks: [], branches: [], audit: [],
  demo: store.get("jawafa-one-demo", "1") === "1",
  localRouter: C.createRouter(),
};
const company = () => state.companies.find(c => c.id === state.companyId) || null;
const role = () => (state.user ? C.roleOf(company(), state.user.uid) : null);
const dataset = (() => { let cache; return () => (state.demo ? (cache ||= C.demoDataset()) : null); })();

// ---------- Firebase ----------
let fb, auth, fs;
const unsubs = { companies: null, invites: null, messages: null, tasks: null, branches: null, audit: null };
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.append(s); }); }

async function initCloud() {
  const cfg = window.AMER_FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || !cfg.projectId) { state.cloud = "unconfigured"; render(); return; }
  try {
    if (!window.firebase?.firestore) for (const m of ["app", "auth", "firestore"]) await loadScript(`https://cdn.jsdelivr.net/npm/firebase@${FIREBASE_VERSION}/firebase-${m}-compat.js`);
  } catch { state.cloud = "failed"; render(); return; }
  fb = window.firebase;
  const app = fb.apps.length ? fb.app() : fb.initializeApp(EMULATOR ? { ...cfg, projectId: "demo-jawafa-one" } : cfg);
  auth = app.auth(); fs = app.firestore();
  if (EMULATOR) {
    auth.useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
    fs.useEmulator("127.0.0.1", 8080);
    // Test-only sign in: the Auth emulator accepts an unsigned credential. Never active in production.
    window.__jawafaTestSignIn = (email, sub) => auth.signInWithCredential(fb.auth.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: email.split("@")[0] })));
  }
  state.cloud = "ready";
  auth.onAuthStateChanged(onUser);
}

async function signIn() {
  if (!auth) { toast(T("تسجيل الدخول غير متاح الآن.", "Sign-in unavailable.")); return; }
  const provider = new fb.auth.GoogleAuthProvider();
  try { await auth.signInWithPopup(provider); }
  catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) await auth.signInWithRedirect(provider);
    else if (e && e.code === "auth/unauthorized-domain") toast(T("هذا النطاق غير مضاف إلى Firebase Authentication › Authorized domains.", "Add this domain to Firebase Authentication authorized domains."));
    else if (e && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast(T("تعذّر تسجيل الدخول: ", "Sign-in failed: ") + S(e.code || e.message, 100));
  }
}

function stopAll() { for (const k of Object.keys(unsubs)) { if (unsubs[k]) unsubs[k](); unsubs[k] = null; } }

function onUser(user) {
  stopAll();
  state.user = user && !user.isAnonymous ? { uid: user.uid, email: C.normalizeEmail(user.email), name: user.displayName || "", photo: user.photoURL || "" } : null;
  state.companies = []; state.invites = []; state.messages = []; state.tasks = []; state.branches = []; state.audit = []; state.companyId = null; state.profile = null;
  if (!state.user) { render(); return; }
  // The profile remembers the last company across devices; localStorage is only a fallback.
  const me = state.user;
  fs.collection("profiles").doc(me.uid).get().then(d => { if (state.user === me) { state.profile = d.exists ? d.data() : {}; if (!state.companyId && state.profile.lastCompanyId && state.companies.some(c => c.id === state.profile.lastCompanyId)) selectCompany(state.profile.lastCompanyId); } }).catch(() => { state.profile = {}; });
  unsubs.companies = fs.collection("companies").where("memberIds", "array-contains", state.user.uid).onSnapshot(snap => {
    state.companies = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => S(a.name).localeCompare(S(b.name)));
    if (!state.companies.some(c => c.id === state.companyId)) {
      const saved = (state.profile && state.profile.lastCompanyId) || store.get("jawafa-one-company:" + state.user.uid, "");
      selectCompany(state.companies.some(c => c.id === saved) ? saved : state.companies[0]?.id || null);
    } else render();
  }, err => { toast(T("تعذّر قراءة الشركات: ", "Could not read companies: ") + S(err.code, 60)); });
  if (state.user.email) unsubs.invites = fs.collection("invites").where("email", "==", state.user.email).onSnapshot(snap => {
    state.invites = snap.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }, () => {});
}

function selectCompany(id) {
  for (const k of ["messages", "tasks", "branches", "audit"]) { if (unsubs[k]) unsubs[k](); unsubs[k] = null; }
  state.companyId = id; state.messages = []; state.tasks = []; state.branches = []; state.audit = [];
  if (id && state.user) {
    store.set("jawafa-one-company:" + state.user.uid, id);
    if (!state.profile || state.profile.lastCompanyId !== id) {
      state.profile = { ...(state.profile || {}), lastCompanyId: id };
      fs.collection("profiles").doc(state.user.uid).set({ email: state.user.email, name: S(state.user.name, 80), lastCompanyId: id, updatedAt: Date.now() }, { merge: true }).catch(() => {});
    }
    const ref = fs.collection("companies").doc(id);
    unsubs.branches = ref.collection("branches").orderBy("name").onSnapshot(s => { state.branches = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {});
    unsubs.audit = ref.collection("audit").orderBy("at", "desc").limit(100).onSnapshot(s => { state.audit = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {});
    unsubs.messages = ref.collection("agentMessages").orderBy("at", "desc").limit(50).onSnapshot(s => { state.messages = s.docs.map(d => d.data()); render(); }, () => {});
    unsubs.tasks = ref.collection("tasks").orderBy("at", "desc").limit(50).onSnapshot(s => { state.tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {});
  }
  render();
}

async function audit(action, detail) {
  if (!fs || !state.user || !state.companyId) return;
  try { await fs.collection("companies").doc(state.companyId).collection("audit").add({ by: state.user.uid, email: state.user.email, action, detail: S(detail, 300), at: Date.now() }); } catch {}
}
function fail(e) { toast(e && e.code === "permission-denied" ? T("ليست لديك صلاحية لهذا الإجراء.", "You do not have permission for this action.") : T("تعذّر الحفظ: ", "Save failed: ") + S(e && (e.code || e.message), 80)); }

// ---------- company actions ----------
async function createCompany(name) {
  if (!C.validCompanyName(name)) { toast(T("اكتب اسم شركة (1–80 حرفًا).", "Enter a company name (1–80 chars).")); return; }
  const u = state.user;
  try {
    const ref = fs.collection("companies").doc();
    await ref.set({ name: name.trim(), ownerUid: u.uid, memberIds: [u.uid], roles: {}, members: { [u.uid]: { email: u.email, name: S(u.name, 80) } }, pendingInvites: {}, social: {}, plan: "free", createdAt: Date.now() });
    selectCompany(ref.id);
    toast(T("أُنشئت الشركة. أنت مالكها.", "Company created. You are the owner."));
    audit("company.create", name);
  } catch (e) { fail(e); }
}
async function invite(email, r) {
  email = C.normalizeEmail(email);
  if (!C.isEmail(email)) { toast(T("بريد غير صالح.", "Invalid email.")); return; }
  if (!C.INVITABLE_ROLES.includes(r)) return;
  const c = company();
  try {
    await fs.collection("invites").doc(C.inviteId(c.id, email)).set({ companyId: c.id, companyName: c.name, email, role: r, invitedBy: state.user.uid, at: Date.now() });
    await fs.collection("companies").doc(c.id).update(new fb.firestore.FieldPath("pendingInvites", email), r);
    await audit("member.invite", email + " → " + r);
    toast(T("أُرسلت الدعوة. يقبلها المدعو بعد الدخول بحساب Google لهذا البريد.", "Invitation saved. The invitee accepts it after signing in with that Google account."));
  } catch (e) { fail(e); }
}
async function revoke(email) {
  const c = company();
  try {
    await fs.collection("invites").doc(C.inviteId(c.id, email)).delete();
    await fs.collection("companies").doc(c.id).update(new fb.firestore.FieldPath("pendingInvites", email), fb.firestore.FieldValue.delete());
    await audit("member.revoke", email);
  } catch (e) { fail(e); }
}
async function acceptInvite(inv) {
  const u = state.user, FP = fb.firestore.FieldPath, FV = fb.firestore.FieldValue;
  try {
    await fs.collection("companies").doc(inv.companyId).update("memberIds", FV.arrayUnion(u.uid), new FP("roles", u.uid), inv.role,
      new FP("members", u.uid), { email: u.email, name: S(u.name, 80) }, new FP("pendingInvites", u.email), FV.delete());
    await fs.collection("invites").doc(inv.id).delete();
    state.companyId = inv.companyId; store.set("jawafa-one-company:" + u.uid, inv.companyId);
    toast(T("انضممت إلى ", "Joined ") + S(inv.companyName, 80));
  } catch (e) { fail(e); }
}
async function declineInvite(inv) { try { await fs.collection("invites").doc(inv.id).delete(); } catch (e) { fail(e); } }
async function setRole(uid, r) {
  try { await fs.collection("companies").doc(state.companyId).update(new fb.firestore.FieldPath("roles", uid), r); await audit("member.role", uid + " → " + r); toast(T("حُدّث الدور.", "Role updated.")); } catch (e) { fail(e); }
}
async function removeMember(uid, self) {
  const FP = fb.firestore.FieldPath, FV = fb.firestore.FieldValue;
  if (!confirm(self ? T("مغادرة هذه الشركة؟", "Leave this company?") : T("إزالة هذا العضو من الشركة؟", "Remove this member?"))) return;
  try {
    if (!self) await audit("member.remove", uid);
    await fs.collection("companies").doc(state.companyId).update("memberIds", FV.arrayRemove(uid), new FP("roles", uid), FV.delete(), new FP("members", uid), FV.delete());
  } catch (e) { fail(e); }
}
async function saveCompany(form) {
  const name = form.name.value.trim();
  const social = {};
  for (const p of ["facebook", "instagram", "tiktok"]) {
    const v = C.validateSocial(p, form[p].value);
    if (!v.ok) { toast(p + ": " + v.error); form[p].focus(); return; }
    if (v.value) social[p] = v.value;
  }
  if (!C.validCompanyName(name)) { toast(T("اسم الشركة مطلوب.", "Company name required.")); return; }
  try { await fs.collection("companies").doc(state.companyId).update({ name, social }); await audit("company.update", name); toast(T("حُفظ ملف الشركة.", "Company profile saved.")); } catch (e) { fail(e); }
}

// ---------- agents ----------
const hierarchy = () => [
  { id: "agent-999", code: "999", name: T("المشرف العام", "Central supervisor") },
  { id: "agent-777", code: "777", name: T("الإدارة والوكلاء", "Management & agents") },
  { id: "agent-666", code: "666", name: T("الوكلاء", "Agents") },
  { id: "dispatcher-1", code: "D1", name: T("موزع المهام 1", "Task dispatcher 1") },
  { id: "dispatcher-2", code: "D2", name: T("موزع المهام 2", "Task dispatcher 2") },
];
const BLOCK_REASON = () => T("لا يوجد تعريف أو قناة اتصال لهذا الوكيل في مصادر المستودع. روابط محادثات ChatGPT ليست قناة API؛ يلزم endpoint مصرّح به.", "No definition or channel for this agent in the repository. ChatGPT conversation links are not an API channel; an authorised endpoint is required.");
const allAgents = () => [...hierarchy().map(a => ({ ...a, group: "HIERARCHY" })), ...OFFICIAL_AGENTS.map(a => ({ id: a.id, code: a.initials, name: a.name, group: a.group, description: a.description }))];

async function sendMessage(from, to, body) {
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  if (state.user && state.companyId) {
    try {
      await fs.collection("companies").doc(state.companyId).collection("agentMessages").doc(id).set({ id, from, to, body, status: "QUEUED", sentBy: state.user.uid, history: [{ status: "QUEUED", at: Date.now() }], at: Date.now() });
      toast(T("حُفظت الرسالة بحالة QUEUED. لا تتقدم الحالة دون إيصال من الوكيل المستلم.", "Message saved as QUEUED. Status advances only with a receipt from the recipient."));
    } catch (e) { fail(e); }
  } else {
    try { state.localRouter.send({ id, from, to, body, at: Date.now() }); toast(T("رسالة محلية (معاينة) بحالة QUEUED — سجّل الدخول لحفظها.", "Local preview message (QUEUED) — sign in to persist.")); render(); }
    catch (e) { toast(S(e.message, 120)); }
  }
}

// ---------- assistant (local, cites its source; Gemini itself is BLOCKED) ----------
function answer(q) {
  const d = dataset();
  if (!d) return { text: T("لا يوجد مصدر بيانات متصل. فعّل البيانات التجريبية للمعاينة أو اربط مصدرًا حقيقيًا من مركز الربط.", "No data source connected. Enable demo data or connect a real source."), src: "—" };
  const src = T("المصدر: بيانات تجريبية DEMO (core.js) — ليست بيانات شركتك", "Source: DEMO dataset (core.js) — not your company data");
  const s = q.replace(/\s+/g, " ");
  if (/(أمس|yesterday)/i.test(s) && /(مبيعات|sales)/i.test(s)) {
    const days = C.dailySales(d, 8); const y = days[6], week = days.slice(0, 7);
    const avg = week.reduce((t, x) => t + x.total, 0) / 7;
    const pct = avg ? ((y.total - avg) / avg) * 100 : 0;
    return { text: T(`مبيعات أمس (${y.day}): ${money(y.total)}.\nمتوسط آخر 7 أيام: ${money(avg)}.\nالفرق: ${pct.toFixed(1)}%.`, `Yesterday (${y.day}): ${money(y.total)}.\n7-day average: ${money(avg)}.\nDifference: ${pct.toFixed(1)}%.`), src: src + " · dailySales()" };
  }
  if (/(شيك|cheque|check)/i.test(s)) {
    const due = d.cheques.filter(c => c.status === "pending" && c.due - d.generatedAt <= 7 * 864e5);
    return { text: due.length ? due.map(c => `${c.no} · ${c.party} · ${money(c.amount)} · ${fmtTime(c.due)}`).join("\n") : T("لا شيكات مستحقة خلال 7 أيام.", "No cheques due within 7 days."), src: src + " · cheques" };
  }
  if (/(تنفد|نفاد|low stock|run out|ينفد)/i.test(s)) {
    const low = d.stock.filter(x => x.qty < x.reorder).sort((a, b) => a.qty - b.qty).slice(0, 10);
    const bn = (id) => d.branches.find(b => b.id === id)?.name || id;
    return { text: low.map(x => `${x.name} — ${bn(x.branch)}: ${num(x.qty)} (${T("حد الطلب", "reorder")} ${x.reorder})`).join("\n"), src: src + " · stock < reorder" };
  }
  if (/(سيولة|liquidity|cash)/i.test(s)) {
    const v = d.cash.filter(c => Math.abs(c.counted - c.expected) >= 50);
    const due = d.cheques.filter(c => c.status === "pending").reduce((t, c) => t + c.amount, 0);
    return { text: T(`لا أستطيع تحديد أسباب السيولة دون بيانات محاسبية حقيقية. المؤشرات المتاحة:\n• شيكات صادرة معلقة: ${money(due)}\n• فروقات صناديق ≥ 50: ${v.length}\nهذه مؤشرات للتحقق وليست استنتاجًا.`, `I can't determine liquidity causes without real accounting data. Available indicators:\n• Pending cheques: ${money(due)}\n• Cash variances ≥ 50: ${v.length}\nThese are leads, not conclusions.`), src: src + " · cash, cheques" };
  }
  return { text: T("هذا السؤال يحتاج نموذج Gemini عبر خادم آمن، وهو غير متصل في هذا الإصدار (BLOCKED). الأسئلة المدعومة محليًا: مبيعات أمس، الشيكات المستحقة، الأصناف التي قد تنفد، مؤشرات السيولة.", "This needs Gemini via a secure backend, not connected in this build (BLOCKED). Supported locally: yesterday's sales, cheques due, low stock, liquidity indicators."), src: T("لم تُستخدم أي بيانات", "No data used") };
}
const chat = [];

// ---------- CSV export ----------
// Excel-friendly (UTF-8 BOM). The first line states the data source so a DEMO export can never be
// mistaken for real figures.
function csvCell(v) { if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""; const t = v == null ? "" : String(v); return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? '"' + (/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""') + '"' : t; }
function toCsv(source, headers, rows) {
  return "\ufeff" + [[T("مصدر البيانات", "Data source"), source], headers, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
}
function downloadCsv(name, source, headers, rows) {
  const blob = new Blob([toCsv(source, headers, rows)], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${name}-${source}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
window.__jawafaToCsv = toCsv;
const csvBtn = (fn) => el("button", { class: "ghost", onclick: fn }, "⬇ CSV");

// ---------- branches ----------
const BRANCH_KINDS = { market: ["سوق", "Market"], restaurant: ["مطعم", "Restaurant"], bakery: ["فرن", "Bakery"], warehouse: ["مستودع", "Warehouse"], office: ["إدارة", "Office"] };
async function addBranch(f) {
  const name = f.bname.value.trim(), kind = f.kind.value, city = f.city.value.trim();
  const lat = f.lat.value === "" ? null : Number(f.lat.value), lng = f.lng.value === "" ? null : Number(f.lng.value);
  if (!name || name.length > 80) { toast(T("اسم الفرع مطلوب (حتى 80 حرفًا).", "Branch name required (≤80).")); return false; }
  if (!BRANCH_KINDS[kind]) return false;
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180)) || ((lat === null) !== (lng === null))) { toast(T("الإحداثيات غير صحيحة.", "Invalid coordinates.")); return false; }
  try {
    await fs.collection("companies").doc(state.companyId).collection("branches").add({ name, kind, city: S(city, 80), lat, lng, by: state.user.uid, at: Date.now() });
    audit("branch.create", name); toast(T("أُضيف الفرع.", "Branch added.")); return true;
  } catch (e) { fail(e); return false; }
}
async function deleteBranch(b) {
  if (!confirm(T("حذف الفرع «" + b.name + "»؟", "Delete branch \"" + b.name + "\"?"))) return;
  try { await fs.collection("companies").doc(state.companyId).collection("branches").doc(b.id).delete(); audit("branch.delete", b.name); } catch (e) { fail(e); }
}
function renderBranches(v) {
  if (!state.user) return needSignIn(v, T("الفروع والمستودعات", "Branches & warehouses"));
  if (!company()) { v.replaceChildren(sectionHead(T("الفروع والمستودعات", "Branches & warehouses")), el("p", null, el("a", { href: "#company" }, T("أنشئ شركة أو اقبل دعوة أولًا.", "Create a company or accept an invitation first.")))); return; }
  const w = C.can(role(), "write");
  const form = w ? el("form", { class: "panel", onsubmit: async (e) => { e.preventDefault(); if (await addBranch(e.target)) e.target.reset(); } },
    el("h3", null, T("إضافة فرع أو مستودع", "Add branch or warehouse")),
    el("div", { class: "cols-2" },
      el("label", { class: "small" }, T("الاسم", "Name"), el("input", { name: "bname", maxlength: "80", required: true })),
      el("label", { class: "small" }, T("النوع", "Type"), el("select", { name: "kind" }, ...Object.entries(BRANCH_KINDS).map(([k, l]) => el("option", { value: k }, T(l[0], l[1]))))),
      el("label", { class: "small" }, T("المدينة", "City"), el("input", { name: "city", maxlength: "80" })),
      el("div", { class: "cols-2" },
        el("label", { class: "small" }, T("خط العرض", "Latitude"), el("input", { name: "lat", type: "number", step: "any", class: "ltr" })),
        el("label", { class: "small" }, T("خط الطول", "Longitude"), el("input", { name: "lng", type: "number", step: "any", class: "ltr" })))),
    el("button", { class: "primary", type: "submit" }, T("إضافة", "Add"))) : el("div", { class: "panel muted small" }, T("دورك للقراءة فقط.", "Your role is read only."));
  const rows = state.branches.map(b => el("tr", null, el("td", null, S(b.name, 80)), el("td", null, T(...(BRANCH_KINDS[b.kind] || [b.kind, b.kind]))), el("td", null, S(b.city, 80)),
    el("td", { class: "ltr" }, b.lat != null ? `${b.lat}, ${b.lng}` : "—"),
    el("td", null, b.lat != null ? el("a", { href: `https://www.google.com/maps?q=${b.lat},${b.lng}`, target: "_blank", rel: "noopener noreferrer" }, "Google Maps") : ""),
    el("td", null, w ? el("button", { class: "ghost", onclick: () => deleteBranch(b) }, T("حذف", "Delete")) : "")));
  v.replaceChildren(sectionHead(T("الفروع والمستودعات", "Branches & warehouses"), badge("demo", "UNVERIFIED"), csvBtn(() => downloadCsv("branches", "UNVERIFIED", [T("الاسم", "Name"), T("النوع", "Type"), T("المدينة", "City"), "lat", "lng"], state.branches.map(b => [b.name, b.kind, b.city, b.lat, b.lng])))),
    el("div", { class: "banner info" }, T("بيانات الفروع يدخلها أعضاء الشركة وتُحفظ في Firestore الخاص بشركتك. وسمها UNVERIFIED لأنها غير مطابقة مع مصدر رسمي. صلاحيات على مستوى الفرع: لم تُنفّذ بعد.", "Branch data is entered by company members and stored in your company's Firestore. Labelled UNVERIFIED because it is not matched against an official source. Branch-level permissions: not implemented yet.")),
    form, el("div", { style: "margin-top:1rem" }, table([T("الاسم", "Name"), T("النوع", "Type"), T("المدينة", "City"), T("الإحداثيات", "Coordinates"), "", ""], rows)));
}

// ---------- audit log viewer ----------
function renderAudit(v) {
  if (!state.user) return needSignIn(v, T("سجل التدقيق", "Audit log"));
  if (!company()) { v.replaceChildren(sectionHead(T("سجل التدقيق", "Audit log")), el("p", null, el("a", { href: "#company" }, T("أنشئ شركة أو اقبل دعوة أولًا.", "Create a company or accept an invitation first.")))); return; }
  const q = (v.querySelector("#audit-q")?.value || "").trim().toLowerCase();
  const list = state.audit.filter(a => !q || [a.action, a.detail, a.email].join(" ").toLowerCase().includes(q));
  const input = el("input", { id: "audit-q", type: "search", value: q, placeholder: T("تصفية...", "Filter..."), style: "width:auto", oninput: () => renderAudit(v) });
  v.replaceChildren(sectionHead(T("سجل التدقيق", "Audit log"), badge("live", T("إلحاق فقط", "append-only")), input,
      csvBtn(() => downloadCsv("audit", "FIRESTORE", [T("الوقت", "Time"), T("المستخدم", "User"), T("الإجراء", "Action"), T("التفاصيل", "Detail")], list.map(a => [new Date(a.at).toISOString(), a.email, a.action, a.detail])))),
    el("div", { class: "banner info" }, T("لا يمكن لأي عضو تعديل أو حذف سجل — مفروض في قواعد Firestore. يعرض آخر 100 حدث.", "No member can edit or delete an entry — enforced by Firestore rules. Shows the latest 100 events.")),
    table([T("الوقت", "Time"), T("المستخدم", "User"), T("الإجراء", "Action"), T("التفاصيل", "Detail")],
      list.map(a => el("tr", null, el("td", null, fmtTime(a.at)), el("td", { class: "ltr" }, S(a.email, 120)), el("td", { class: "ltr" }, S(a.action, 60)), el("td", null, S(a.detail, 200))))));
  const n = v.querySelector("#audit-q"); if (q && n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
}

// ---------- rendering ----------
function sectionHead(title, ...extra) { return el("div", { class: "toolbar", style: "justify-content:space-between" }, el("h1", { style: "margin:0;font-size:1.4rem" }, title), el("div", { class: "toolbar", style: "margin:0" }, ...extra)); }
function demoToggle() {
  return el("button", { class: state.demo ? "" : "gold", onclick: () => { state.demo = !state.demo; store.set("jawafa-one-demo", state.demo ? "1" : "0"); render(); } },
    state.demo ? T("إخفاء البيانات التجريبية", "Hide demo data") : T("عرض بيانات تجريبية", "Show demo data"));
}
function noData() {
  return el("div", { class: "panel" }, el("h3", null, T("لا يوجد مصدر بيانات متصل", "No data source connected"), badge("blocked", "LIVE: BLOCKED")),
    el("p", { class: "muted" }, T("لا تُعرض أرقام تشغيلية دون اتصال حقيقي. اربط قاعدة بيانات عبر خادم آمن للقراءة فقط من مركز الربط، أو اعرض بيانات تجريبية موسومة للمعاينة.", "No operational figures are shown without a real connection. Connect a database through a secure read-only backend, or preview labelled demo data.")),
    el("div", { class: "toolbar" }, demoToggle(), el("a", { href: "#connections" }, T("مركز الربط", "Integrations"))));
}

function lineChart(points) {
  const W = 600, H = 220, P = 34, L = 58;
  const max = Math.max(1, ...points.map(p => p.total));
  const x = (i) => L + (i * (W - L - P)) / Math.max(1, points.length - 1);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", T("مبيعات يومية: ", "Daily sales: ") + points.map(p => p.day + " " + p.total).join("، "));
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
  const defs = document.createElementNS(ns, "defs"); defs.innerHTML = '<linearGradient id="g-em" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22c55e" stop-opacity=".45"/><stop offset="1" stop-color="#22c55e" stop-opacity="0"/></linearGradient>'; svg.append(defs);
  for (let i = 0; i <= 4; i++) { const yy = P + (i * (H - 2 * P)) / 4; mk("line", { x1: L, x2: W - P, y1: yy, y2: yy, class: "grid-line" }); const t = mk("text", { x: L - 8, y: yy + 4, "text-anchor": "end" }); t.textContent = num(Math.round(max - (i * max) / 4)); }
  const d = points.map((p, i) => (i ? "L" : "M") + x(i) + " " + y(p.total)).join(" ");
  mk("path", { d: d + ` L${x(points.length - 1)} ${H - P} L${x(0)} ${H - P} Z`, class: "area" });
  mk("path", { d, class: "line" });
  points.forEach((p, i) => { mk("circle", { cx: x(i), cy: y(p.total), r: 4, class: "dot" }); const t = mk("text", { x: x(i), y: H - 10, "text-anchor": "middle" }); t.textContent = p.day.slice(5); });
  return el("div", { class: "chart" }, svg);
}

function table(headers, rows) {
  return el("div", { class: "table-wrap" }, el("table", null, el("thead", null, el("tr", null, ...headers.map(h => el("th", { scope: "col" }, h)))),
    el("tbody", null, ...(rows.length ? rows : [el("tr", null, el("td", { colspan: String(headers.length), class: "muted" }, T("لا توجد بيانات.", "No data.")))]))));
}

function kpiCards(d) {
  const k = C.kpis(d);
  const card = (label, value, sub, accent, alert) => el("div", { class: "kpi" + (alert ? " alert" : ""), style: accent ? `--accent:${accent}` : null },
    el("div", { class: "label" }, el("span", null, label), badge(d.source === "LIVE" ? "live" : "demo", d.source)), el("div", { class: "value" }, value), el("div", { class: "small muted" }, sub));
  const findings = C.detectAnomalies(d);
  return el("div", { class: "kpis" },
    card(T("تنبيهات تحتاج مراجعة", "Alerts to review"), num(findings.length), T("نتائج للتحقق — ليست اتهامات", "Leads, not accusations"), "#ef4444", true),
    card(T("إجمالي المبيعات (14 يومًا)", "Sales (14 days)"), money(k.sales), num(k.invoices) + T(" فاتورة", " invoices"), "#22c55e"),
    card(T("قيمة المخزون", "Stock value"), money(k.stockValue), num(k.lowStock) + T(" صنف تحت حد الطلب", " items below reorder"), "#a78bfa"),
    card(T("شيكات مستحقة خلال 7 أيام", "Cheques due in 7 days"), num(k.chequesDue7), money(k.chequesDue7Amount), "#d9b45a"),
    card(T("الموظفون", "Employees"), num(k.employees), num(k.branches) + T(" فروع ومستودعات", " branches & warehouses"), "#38bdf8"));
}

function renderHome(v) {
  const d = dataset(), c = company();
  const hero = el("div", { class: "hero" },
    el("div", { class: "small", style: "color:var(--gold-2);letter-spacing:.08em" }, "JAWAFA ONE AI · UNIFIED ENTERPRISE COMMAND"),
    el("h1", null, T("مرحبًا بك في مركز القيادة الذكي", "Welcome to the smart command center")),
    el("p", null, T("منصة موحدة لإدارة الأسواق والمطاعم والأفران والمستودعات — مجانية لكل صاحب مصلحة، بلا رسوم ولا عمولة.", "One platform for markets, restaurants, bakeries and warehouses — free for every business, no fees, no commission.")),
    el("div", { class: "toolbar" },
      c ? el("span", { class: "badge verified" }, "🏢 " + S(c.name, 60) + " · " + T(C.ROLES[role()]?.ar || "", C.ROLES[role()]?.en || ""))
        : state.user ? el("button", { class: "gold", onclick: () => { location.hash = "#company"; } }, T("أنشئ شركتك مجانًا", "Create your company — free"))
        : el("button", { class: "google-btn", onclick: signIn, disabled: state.cloud !== "ready" }, googleG(), T("الدخول عبر Google", "Sign in with Google")),
      demoToggle()));
  const network = el("div", { class: "panel" }, el("h3", null, T("شبكة الوكلاء والترابط", "Agent network"), el("a", { class: "small", href: "#agents" }, T("فتح", "Open"))),
    el("div", { class: "network" }, ...[hierarchy()[2], hierarchy()[0], hierarchy()[1]].map(a => el("div", { class: "node" + (a.code === "999" ? " main" : "") },
      el("div", { class: "ring" }, a.code), el("b", { class: "small" }, a.name), badge("blocked", "BLOCKED")))),
    el("p", { class: "small muted" }, BLOCK_REASON()));
  const hub = el("div", { class: "panel" }, el("h3", null, T("مركز الربط والتكاملات", "Integrations hub"), el("a", { class: "small", href: "#connections" }, T("التفاصيل", "Details"))),
    el("div", { class: "hub" }, ...integrations().slice(0, 8).map(i => el("a", { class: "tile", href: "#connections" }, el("b", null, i.name), STATUS_BADGE[i.status]()))));
  const assistant = el("div", { class: "panel" }, el("h3", null, T("مساعد جوافة الذكي", "Jawafa assistant"), badge("blocked", "Gemini: BLOCKED")),
    el("div", { class: "chips" }, ...quickQuestions().map(q => el("button", { onclick: () => { location.hash = "#assistant"; ask(q); } }, q))));
  v.replaceChildren(hero,
    d ? kpiCards(d) : noData(),
    el("div", { class: "cols-3" },
      el("div", { class: "panel" }, el("h3", null, T("تحليل المبيعات — آخر 7 أيام", "Sales — last 7 days"), d ? SOURCE_BADGE[d.source]() : null), d ? lineChart(C.dailySales(d, 7)) : el("p", { class: "muted" }, "—")),
      network,
      el("div", { class: "panel" }, el("h3", null, T("الخرائط والتشغيل الميداني", "Maps & field ops"), el("a", { class: "small", href: "#maps" }, T("فتح", "Open"))), d ? branchMap(d, 200) : el("p", { class: "muted" }, "—"))),
    el("div", { class: "cols-2", style: "margin-top:1rem" }, assistant, hub));
}
function googleG() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 48 48"); s.setAttribute("width", "20"); s.setAttribute("height", "20"); s.setAttribute("aria-hidden", "true"); s.innerHTML = '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/>'; return s; }

function renderSales(v) {
  const d = dataset();
  if (!d) { v.replaceChildren(sectionHead(T("المبيعات", "Sales")), noData()); return; }
  const branch = v.querySelector("#sales-branch")?.value || "";
  const bn = (id) => d.branches.find(b => b.id === id)?.name || id;
  const inv = d.invoices.filter(i => !branch || i.branch === branch).sort((a, b) => b.at - a.at).slice(0, 60);
  const sel = el("select", { id: "sales-branch", style: "width:auto", onchange: () => renderSales(v) }, el("option", { value: "" }, T("كل الفروع", "All branches")),
    ...d.branches.filter(b => b.kind !== "warehouse").map(b => el("option", { value: b.id, selected: b.id === branch }, b.name)));
  v.replaceChildren(sectionHead(T("المبيعات", "Sales"), SOURCE_BADGE[d.source](), sel, csvBtn(() => downloadCsv("sales", d.source, ["no", "branch", "total", "discountPct", "user", "status", "time"], d.invoices.filter(i => !branch || i.branch === branch).map(i => [i.no, bn(i.branch), i.total, i.discountPct, i.user, i.status, new Date(i.at).toISOString()]))), demoToggle()),
    el("div", { class: "panel" }, el("h3", null, T("المبيعات اليومية — 14 يومًا", "Daily sales — 14 days")), lineChart(C.dailySales({ ...d, invoices: d.invoices.filter(i => !branch || i.branch === branch) }, 14))),
    el("div", { class: "panel", style: "margin-top:1rem" }, el("h3", null, T("أحدث الفواتير", "Latest invoices")),
      table([T("رقم", "No."), T("الفرع", "Branch"), T("المجموع", "Total"), T("الخصم", "Discount"), T("المستخدم", "User"), T("الحالة", "Status"), T("الوقت", "Time")],
        inv.map(i => el("tr", null, el("td", { class: "ltr" }, i.no), el("td", null, bn(i.branch)), el("td", { class: "num" }, money(i.total)), el("td", { class: "num" }, i.discountPct + "%"), el("td", { class: "ltr" }, i.user), el("td", null, i.status === "void" ? badge("blocked", T("ملغاة", "void")) : badge("", T("سليمة", "ok"))), el("td", null, fmtTime(i.at)))))));
}

function renderInventory(v) {
  const d = dataset();
  if (!d) { v.replaceChildren(sectionHead(T("المخزون والمستودعات", "Inventory & warehouses")), noData()); return; }
  const onlyLow = v.querySelector("#inv-low")?.checked || false;
  const bn = (id) => d.branches.find(b => b.id === id)?.name || id;
  const rows = d.stock.filter(s => !onlyLow || s.qty < s.reorder).sort((a, b) => a.qty - b.qty);
  v.replaceChildren(sectionHead(T("المخزون والمستودعات", "Inventory & warehouses"), SOURCE_BADGE[d.source](),
      el("label", { class: "small" }, el("input", { id: "inv-low", type: "checkbox", style: "width:auto;min-height:auto", checked: onlyLow, onchange: () => renderInventory(v) }), " ", T("تحت حد الطلب فقط", "Below reorder only")),
      csvBtn(() => downloadCsv("inventory", d.source, ["sku", "item", "location", "qty", "reorder"], rows.map(s => [s.sku, s.name, bn(s.branch), s.qty, s.reorder]))), demoToggle()),
    table([T("الصنف", "Item"), "SKU", T("الموقع", "Location"), T("الرصيد", "Qty"), T("حد الطلب", "Reorder"), T("الحالة", "State")],
      rows.map(s => el("tr", null, el("td", null, s.name), el("td", { class: "ltr" }, s.sku), el("td", null, bn(s.branch)), el("td", { class: "num" }, num(s.qty)), el("td", { class: "num" }, num(s.reorder)),
        el("td", null, s.qty < 0 ? badge("blocked", T("رصيد سالب", "negative")) : s.qty < s.reorder ? badge("demo", T("منخفض", "low")) : badge("live", T("كافٍ", "ok")))))));
}

function renderFinance(v) {
  const d = dataset();
  if (!d) { v.replaceChildren(sectionHead(T("المالية والشيكات", "Finance & cheques")), noData()); return; }
  const bank = new Set(d.bank.map(b => b.chequeNo));
  const bn = (id) => d.branches.find(b => b.id === id)?.name || id;
  v.replaceChildren(sectionHead(T("المالية والشيكات والصناديق", "Finance, cheques & cash"), SOURCE_BADGE[d.source](), demoToggle()),
    el("div", { class: "banner" }, T("قراءة فقط. لا يكتب هذا التطبيق إلى Jawafa_DB أو أي سجل محاسبي، ولا يوجد اتصال مالي حي في هذا الإصدار.", "Read only. This app never writes to Jawafa_DB or any accounting record; no live financial connection exists in this build.")),
    el("div", { class: "cols-2" },
      el("div", { class: "panel" }, el("h3", null, T("الشيكات", "Cheques")),
        table([T("رقم", "No."), T("الجهة", "Party"), T("المبلغ", "Amount"), T("الاستحقاق", "Due"), T("المطابقة البنكية", "Bank match")],
          d.cheques.map(c => el("tr", null, el("td", { class: "ltr" }, c.no), el("td", null, c.party), el("td", { class: "num" }, money(c.amount)), el("td", null, fmtTime(c.due)),
            el("td", null, c.status === "pending" ? badge("", T("معلق", "pending")) : bank.has(c.no) ? badge("live", T("مطابق", "matched")) : badge("blocked", T("غير مطابق", "unmatched"))))))),
      el("div", { class: "panel" }, el("h3", null, T("فروقات الصناديق", "Cash variances")),
        table([T("الفرع", "Branch"), T("اليوم", "Day"), T("المتوقع", "Expected"), T("المعدود", "Counted"), T("الفرق", "Diff")],
          d.cash.map(c => { const diff = c.counted - c.expected; return el("tr", null, el("td", null, bn(c.branch)), el("td", { class: "ltr" }, c.day), el("td", { class: "num" }, money(c.expected)), el("td", { class: "num" }, money(c.counted)), el("td", { class: "num", style: Math.abs(diff) >= 50 ? "color:var(--red)" : null }, money(diff))); })))));
}

function renderInvestigations(v) {
  const d = dataset();
  if (!d) { v.replaceChildren(sectionHead(T("التحقيقات وكشف التلاعب", "Investigations & anomaly detection")), noData()); return; }
  const f = C.detectAnomalies(d);
  v.replaceChildren(sectionHead(T("التحقيقات وكشف التلاعب", "Investigations & anomaly detection"), SOURCE_BADGE[d.source](),
      csvBtn(() => downloadCsv("findings", d.source, ["type", "title", "ref", "confidence", "classification", "detail"], f.map(x => [x.type, x.title, x.ref, x.confidence, C.FINDING_CLASS[x.classification], x.detail]))), demoToggle()),
    el("div", { class: "banner info" }, T("كل نتيجة مؤشر للتحقق وليست اتهامًا لأي شخص. على البيانات التجريبية لا تُصنَّف أي نتيجة «مثبتة»؛ الإثبات يتطلب بيانات LIVE وأدلة مرفقة.", "Each result is a lead, never an accusation. On demo data nothing is classified as proven; proof needs LIVE data and attached evidence.")),
    el("div", { class: "list" }, ...f.map(x => el("div", { class: "item" },
      el("div", { class: "row" }, el("b", null, x.title), el("span", { class: "toolbar", style: "margin:0" }, badge(x.classification === "proven" ? "live" : "demo", C.FINDING_CLASS[x.classification]), SOURCE_BADGE[x.source]())),
      el("div", { class: "small muted" }, el("span", { class: "ltr" }, x.ref), " · ", x.detail, " · ", T("الثقة ", "confidence ") + Math.round(x.confidence * 100) + "%"),
      el("div", { class: "small muted" }, T("الأدلة: لا توجد مستندات مرفقة (مصدر تجريبي).", "Evidence: none attached (demo source)."))))));
}

function branchMap(d, h) {
  const W = 600, H = h || 320, P = (h || 320) < 260 ? 90 : 70;
  const lats = d.branches.map(b => b.lat), lngs = d.branches.map(b => b.lng);
  const [a0, a1, o0, o1] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", T("مخطط مواقع الفروع", "Branch location sketch"));
  svg.style.cssText = "width:100%;height:auto;background:var(--bg-2);border-radius:12px;border:1px solid var(--line)";
  const color = { market: "#22c55e", restaurant: "#f59e0b", bakery: "#d9b45a", warehouse: "#38bdf8" };
  for (const b of d.branches) {
    const x = P + ((b.lng - o0) / (o1 - o0 || 1)) * (W - 2 * P), y = H - P - ((b.lat - a0) / (a1 - a0 || 1)) * (H - 2 * P);
    const c = document.createElementNS(ns, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", H < 260 ? 14 : 10); c.setAttribute("fill", color[b.kind]); svg.append(c);
    const t = document.createElementNS(ns, "text"); t.setAttribute("x", x); t.setAttribute("y", y - (H < 260 ? 22 : 16)); t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", "currentColor"); t.setAttribute("font-size", H < 260 ? "24" : "15"); t.textContent = b.name.split("—")[0].trim(); svg.append(t);
  }
  return svg;
}
function renderMaps(v) {
  const d = dataset();
  if (!d) { v.replaceChildren(sectionHead(T("الخرائط والخدمات اللوجستية", "Maps & logistics")), noData()); return; }
  v.replaceChildren(sectionHead(T("الخرائط والخدمات اللوجستية", "Maps & logistics"), SOURCE_BADGE[d.source](), badge("blocked", "Google Maps API: BLOCKED")),
    el("div", { class: "banner info" }, T("خريطة Google التفاعلية تحتاج مفتاح Maps JavaScript API مقيّدًا بالنطاق. حتى توفره يُعرض مخطط نسبي للمواقع مع روابط فتحها في Google Maps.", "The interactive Google map needs a domain-restricted Maps JavaScript API key. Until then, a relative sketch with Google Maps links is shown.")),
    el("div", { class: "panel" }, branchMap(d, 340)),
    el("div", { class: "panel", style: "margin-top:1rem" }, table([T("الموقع", "Site"), T("النوع", "Type"), T("الإحداثيات", "Coordinates"), ""],
      d.branches.map(b => el("tr", null, el("td", null, b.name), el("td", null, b.kind), el("td", { class: "ltr" }, b.lat + ", " + b.lng),
        el("td", null, el("a", { href: `https://www.google.com/maps?q=${b.lat},${b.lng}`, target: "_blank", rel: "noopener noreferrer" }, T("فتح في Google Maps", "Open in Google Maps"))))))));
}

const quickQuestions = () => [T("قارن مبيعات أمس مع الأسبوع الماضي", "Compare yesterday's sales with last week"), T("اعرض الشيكات المستحقة خلال 7 أيام", "Show cheques due in 7 days"), T("أي الأصناف قد تنفد قريبًا؟", "Which items may run out soon?"), T("ما أسباب انخفاض السيولة؟", "Why is liquidity down?")];
function ask(q) { q = S(q, 500).trim(); if (!q) return; chat.push({ role: "user", text: q }); const a = answer(q); chat.push({ role: "bot", text: a.text, src: a.src }); render(); }
function renderAssistant(v) {
  const log = el("div", { class: "chat", "aria-live": "polite" }, ...(chat.length ? chat.map(m => el("div", { class: "msg " + m.role }, m.text, m.src ? el("span", { class: "src" }, m.src) : null)) : [el("p", { class: "muted" }, T("اسأل عن المبيعات أو المخزون أو الشيكات.", "Ask about sales, stock or cheques."))]));
  const input = el("input", { id: "ask-input", placeholder: T("اسأل عن مبيعات، مخزون، أو أي تحليل إداري...", "Ask about sales, stock..."), maxlength: "500" });
  v.replaceChildren(sectionHead(T("المساعد الذكي", "AI assistant"), badge("blocked", "Gemini: BLOCKED"), badge("blocked", "OpenAI: BLOCKED")),
    el("div", { class: "banner info" }, T("يجيب المساعد حاليًا بمحرك محلي محدد يذكر مصدر كل رقم ولا يخترع نتائج. ربط Gemini أو OpenAI يتطلب خادمًا آمنًا يحفظ المفتاح ويطبق صلاحيات الشركة — غير متوفر في هذا الإصدار.", "The assistant currently uses a deterministic local engine that cites its source and never invents results. Gemini/OpenAI need a secure backend holding the key and enforcing company permissions — not available in this build.")),
    el("div", { class: "panel" }, log,
      el("form", { class: "toolbar", onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, el("label", { class: "sr", for: "ask-input" }, T("سؤال", "Question")), input, el("button", { class: "primary", type: "submit" }, T("إرسال", "Send"))),
      el("div", { class: "chips" }, ...quickQuestions().map(q => el("button", { onclick: () => ask(q) }, q)))));
  log.scrollTop = log.scrollHeight;
}

function renderAgents(v) {
  const agents = allAgents();
  const msgs = state.user && state.companyId ? state.messages : [...state.localRouter.store.values()].reverse();
  const opt = (a) => el("option", { value: a.id }, a.code + " · " + a.name);
  const from = el("select", { id: "msg-from" }, ...agents.map(opt));
  const to = el("select", { id: "msg-to", multiple: true, size: "5" }, ...agents.map(opt));
  const body = el("textarea", { id: "msg-body", rows: "3", maxlength: "4000" });
  v.replaceChildren(sectionHead(T("مركز الوكلاء والتراسل", "Agent command & messaging"), badge("built", T("السجل والموجّه: مُنفّذ", "Registry & router: built"))),
    el("div", { class: "banner" }, T("لا يُعرض أي وكيل كمتصل دون دليل تسليم. الرسائل تُحفظ QUEUED، ولا تتقدم إلى DELIVERED/READ/ACKNOWLEDGED إلا بإيصال من الوجهة. لا توجد في هذا الإصدار قناة تسليم مصرح بها لأي وكيل.", "No agent is shown as connected without delivery evidence. Messages are saved QUEUED and only advance with a receipt from the destination. This build has no authorised delivery channel for any agent.")),
    el("div", { class: "cols-2" },
      el("div", { class: "panel" }, el("h3", null, T("سجل الوكلاء", "Agent registry"), badge("", num(agents.length))),
        el("div", { class: "list" }, ...agents.map(a => el("div", { class: "item" }, el("div", { class: "row" }, el("b", null, a.code + " · " + a.name), a.group === "HIERARCHY" ? badge("blocked", "BLOCKED") : badge("built", T("تعريف فقط", "definition only"))),
          el("div", { class: "small muted" }, a.group === "HIERARCHY" ? BLOCK_REASON() : S(a.description, 200)))))),
      el("div", { class: "panel" }, el("h3", null, T("إرسال رسالة (Many-to-Many)", "Send message (many-to-many)")),
        el("form", { class: "list", onsubmit: (e) => { e.preventDefault(); const t = [...to.selectedOptions].map(o => o.value); if (!t.length || !body.value.trim()) { toast(T("اختر مستلمًا واكتب الرسالة.", "Pick recipients and write a message.")); return; } sendMessage(from.value, t, body.value.trim()); body.value = ""; } },
          el("label", { class: "small" }, T("من", "From"), from), el("label", { class: "small" }, T("إلى (يمكن اختيار أكثر من وكيل)", "To (multi-select)"), to), el("label", { class: "small" }, T("النص", "Body"), body),
          el("button", { class: "primary", type: "submit" }, T("إرسال", "Send"))),
        el("h3", { style: "margin-top:1rem" }, T("الرسائل", "Messages"), state.user && state.companyId ? badge("live", "Firestore") : badge("demo", T("معاينة محلية", "local preview"))),
        el("div", { class: "list" }, ...(msgs.length ? msgs.map(m => el("div", { class: "item" }, el("div", { class: "row" }, el("b", { class: "ltr" }, m.from + " → " + m.to.join(", ")), badge(m.status === "FAILED" ? "blocked" : m.status === "QUEUED" ? "demo" : "live", m.status)),
          el("div", { class: "small" }, S(m.body, 400)), el("div", { class: "small muted ltr" }, m.id))) : [el("p", { class: "muted small" }, T("لا رسائل.", "No messages."))])))));
}

function integrations() {
  return [
    { name: "Google Sign-In", status: "BUILT", note: T("مُنفّذ عبر Firebase Auth. يحتاج إضافة النطاق إلى Authorized domains والتحقق على النسخة المنشورة.", "Implemented with Firebase Auth. Needs the domain in Authorized domains and verification on the deployed site.") },
    { name: T("الشركات والصلاحيات (Firestore)", "Companies & RBAC (Firestore)"), status: "TEST_PASSED", note: T("15 اختبار قواعد على Firestore Emulator: عزل الشركات عبر API، الأدوار، الدعوات، الخطط.", "15 rules tests on the Firestore emulator: API-level isolation, roles, invites, plans.") },
    { name: "SQL Server · Jawafa_DB", status: "BLOCKED", note: T("يحتاج خادم Backend آمن وحساب قراءة فقط محدود الجداول. لا اتصال من المتصفح أو الهاتف.", "Needs a secure backend and a least-privilege read-only account. No browser/phone connection.") },
    { name: "PostgreSQL / MySQL / REST", status: "NOT_STARTED", note: T("موصلات مستقبلية خلف الخادم نفسه.", "Future connectors behind the same backend.") },
    { name: "Gemini", status: "BLOCKED", note: T("يوجد وكيل Gemini في AAS-CC (Cloudflare Worker) ولم يُربط بهذه المنصة متعددة الشركات بعد.", "A Gemini proxy exists in AAS-CC (Cloudflare Worker), not yet wired to this multi-company app.") },
    { name: "OpenAI / ChatGPT", status: "BLOCKED", note: T("يحتاج مفتاح API على الخادم. روابط محادثات ChatGPT ليست قناة API.", "Needs a server-side API key. ChatGPT conversation links are not an API.") },
    { name: T("المتجر / POS (لُقطة)", "Store / POS (Luqta)"), status: "BLOCKED", note: T("عميل لُقطة موجود في اللوحة السابقة؛ يحتاج خادمًا منشورًا بعنوان HTTPS دائم.", "Luqta client exists in the previous dashboard; needs a deployed HTTPS server.") },
    { name: "Google Maps", status: "BLOCKED", note: T("يحتاج مفتاح API مقيدًا بالنطاق.", "Needs a domain-restricted API key.") },
    { name: "Facebook / Instagram / TikTok", status: "BUILT", note: T("روابط الصفحات محفوظة ومتحقق من صيغتها في ملف الشركة. النشر والإحصاءات تحتاج APIs رسمية وتفويضًا.", "Profile links stored and validated in the company profile. Posting/insights need official APIs and authorisation.") },
    { name: T("كاميرات TrustSoft", "TrustSoft cameras"), status: "BLOCKED", note: T("وحدة TrustSoft موجودة في اللوحة السابقة (قراءة فقط)، دون بث كاميرات مصرح به.", "TrustSoft module exists in the previous dashboard (read only), no authorised camera feed.") },
    { name: T("مدفوعات Premium Plus", "Premium Plus billing"), status: "NOT_STARTED", note: T("لا يوجد مزود دفع. الخطة لا يغيّرها إلا خادم الفوترة.", "No payment provider. Only a billing backend may change the plan.") },
  ];
}
function renderConnections(v) {
  v.replaceChildren(sectionHead(T("مركز الربط والتكاملات", "Integrations hub")),
    el("div", { class: "banner info" }, T("الحالات من أدلة فعلية في المستودع (انظر INTEGRATION_STATUS.md). لا يوصف أي تكامل بأنه LIVE دون اختبار موثق في البيئة المقصودة.", "Statuses come from evidence in the repository (see INTEGRATION_STATUS.md). Nothing is LIVE without a documented test in the target environment.")),
    el("div", { class: "list" }, ...integrations().map(i => el("div", { class: "item" }, el("div", { class: "row" }, el("b", null, i.name), STATUS_BADGE[i.status]()), el("div", { class: "small muted" }, i.note)))));
}

function needSignIn(v, title) {
  v.replaceChildren(sectionHead(title), el("div", { class: "panel login-card" },
    el("h2", { style: "justify-content:center" }, T("سجّل الدخول للمتابعة", "Sign in to continue")),
    el("p", { class: "muted" }, state.cloud === "unconfigured" ? T("لم تُضبط إعدادات Firebase.", "Firebase is not configured.") : state.cloud === "failed" ? T("تعذّر تحميل Firebase. تحقق من الاتصال.", "Could not load Firebase.") : T("كل شركة معزولة: لا يرى أحد بياناتها إلا أعضاؤها.", "Every company is isolated: only its members can see its data.")),
    el("button", { class: "google-btn", onclick: signIn, disabled: state.cloud !== "ready" }, googleG(), T("الدخول عبر Google", "Sign in with Google"))));
}

function renderCompany(v) {
  if (!state.user) return needSignIn(v, T("الشركة", "Company"));
  const c = company(), r = role();
  const invites = state.invites.length ? el("div", { class: "panel", style: "margin-bottom:1rem" }, el("h3", null, T("دعوات بانتظارك", "Pending invitations")),
    el("div", { class: "list" }, ...state.invites.map(i => el("div", { class: "item" }, el("div", { class: "row" }, el("b", null, S(i.companyName, 80)), badge("verified", T(C.ROLES[i.role]?.ar, C.ROLES[i.role]?.en))),
      el("div", { class: "toolbar" }, el("button", { class: "primary", onclick: () => acceptInvite(i) }, T("قبول", "Accept")), el("button", { onclick: () => declineInvite(i) }, T("رفض", "Decline"))))))) : null;
  const createForm = el("form", { class: "panel", onsubmit: (e) => { e.preventDefault(); createCompany(e.target.cname.value); } },
    el("h3", null, T("تسجيل شركة جديدة — مجانًا", "Register a new company — free")),
    el("label", { class: "small" }, T("اسم الشركة", "Company name"), el("input", { name: "cname", maxlength: "80", required: true })),
    el("p", { class: "small muted" }, T("ستكون المالك. بيانات الشركة معزولة عن أي شركة أخرى. بلا رسوم ولا عمولة.", "You will be the owner. Company data is isolated from every other company. No fees, no commission.")),
    el("button", { class: "gold", type: "submit" }, T("إنشاء الشركة", "Create company")));
  if (!c) { v.replaceChildren(sectionHead(T("الشركة", "Company")), invites || "", createForm); return; }
  const manage = C.can(r, "manage");
  const f = el("form", { class: "panel", onsubmit: (e) => { e.preventDefault(); saveCompany(e.target); } },
    el("h3", null, T("ملف الشركة", "Company profile"), badge(c.plan === "premium_plus" ? "verified" : "live", c.plan === "premium_plus" ? "Premium Plus" : T("مجاني", "Free"))),
    el("label", { class: "small" }, T("الاسم", "Name"), el("input", { name: "name", value: S(c.name, 80), maxlength: "80", disabled: !manage })),
    ...["facebook", "instagram", "tiktok"].map(p => el("label", { class: "small" }, { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" }[p],
      el("input", { name: p, class: "ltr", type: "url", value: S(c.social?.[p], 300), placeholder: { facebook: "https://www.facebook.com/…", instagram: "https://www.instagram.com/…", tiktok: "https://www.tiktok.com/@…" }[p], disabled: !manage }))),
    manage ? el("button", { class: "primary", type: "submit" }, T("حفظ", "Save")) : el("p", { class: "small muted" }, T("التعديل للمالك ورئيس المجلس والمدير العام.", "Editing is for owner, chairman and general manager.")));
  const links = Object.entries(c.social || {}).filter(([, u]) => u);
  v.replaceChildren(sectionHead(T("الشركة", "Company"), el("span", { class: "small muted" }, T("دورك: ", "Your role: ") + T(C.ROLES[r]?.ar, C.ROLES[r]?.en))),
    invites || "",
    el("div", { class: "cols-2" }, f,
      el("div", { class: "grid" },
        el("div", { class: "panel" }, el("h3", null, T("الحضور على الشبكات", "Social presence")),
          links.length ? el("div", { class: "list" }, ...links.map(([p, u]) => el("a", { class: "tile", href: u, target: "_blank", rel: "noopener noreferrer" }, el("b", null, p), el("span", { class: "small ltr" }, u)))) : el("p", { class: "muted small" }, T("لا روابط بعد.", "No links yet."))),
        el("div", { class: "panel" }, el("h3", null, T("المهام", "Tasks"), badge("live", "Firestore")),
          C.can(r, "tasks") ? el("form", { class: "toolbar", onsubmit: async (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; try { await fs.collection("companies").doc(c.id).collection("tasks").add({ title: S(t, 200), status: "todo", by: state.user.uid, at: Date.now() }); e.target.reset(); } catch (err) { fail(err); } } },
            el("input", { name: "t", maxlength: "200", placeholder: T("مهمة جديدة...", "New task...") }), el("button", { type: "submit" }, T("إضافة", "Add"))) : el("p", { class: "small muted" }, T("دورك للقراءة فقط.", "Your role is read only.")),
          el("div", { class: "list" }, ...state.tasks.map(t => el("div", { class: "item small" }, S(t.title, 200))))),
        createForm)));
}

function renderMembers(v) {
  if (!state.user) return needSignIn(v, T("المستخدمون والصلاحيات", "Users & roles"));
  const c = company();
  if (!c) { v.replaceChildren(sectionHead(T("المستخدمون والصلاحيات", "Users & roles")), el("p", null, el("a", { href: "#company" }, T("أنشئ شركة أو اقبل دعوة أولًا.", "Create a company or accept an invitation first.")))); return; }
  const manage = C.can(role(), "manage");
  const roleSelect = (uid, current) => el("select", { style: "width:auto", disabled: !manage, "aria-label": T("الدور", "Role"), onchange: (e) => setRole(uid, e.target.value) },
    ...C.INVITABLE_ROLES.map(rr => el("option", { value: rr, selected: rr === current }, T(C.ROLES[rr].ar, C.ROLES[rr].en))));
  const rows = (c.memberIds || []).map(uid => {
    const m = c.members?.[uid] || {}; const r = C.roleOf(c, uid);
    return el("tr", null, el("td", { class: "ltr" }, S(m.email || uid, 120)), el("td", null, S(m.name, 80)),
      el("td", null, uid === c.ownerUid ? badge("verified", T("المالك", "Owner")) : roleSelect(uid, r)),
      el("td", null, uid === c.ownerUid ? "" : uid === state.user.uid ? el("button", { onclick: () => removeMember(uid, true) }, T("مغادرة", "Leave")) : manage ? el("button", { onclick: () => removeMember(uid, false) }, T("إزالة", "Remove")) : ""));
  });
  const pending = Object.entries(c.pendingInvites || {});
  v.replaceChildren(sectionHead(T("المستخدمون والصلاحيات", "Users & roles"), badge("live", T("محمي بقواعد Firestore", "Enforced by Firestore rules"))),
    el("div", { class: "banner info" }, T("الصلاحيات تُفرض في قواعد Firestore على الخادم، وليست بإخفاء الأزرار فقط. المالك/رئيس المجلس/المدير العام: إدارة الأعضاء. مدير المشتريات/مدير الفرع/المحاسب: كتابة البيانات التشغيلية. المدقق: قراءة فقط. الموظف: قراءة + مهام ورسائل.", "Permissions are enforced by server-side Firestore rules, not by hiding buttons.")),
    table([T("البريد", "Email"), T("الاسم", "Name"), T("الدور", "Role"), ""], rows),
    el("div", { class: "cols-2", style: "margin-top:1rem" },
      manage ? el("form", { class: "panel", onsubmit: (e) => { e.preventDefault(); invite(e.target.email.value, e.target.role.value); e.target.reset(); } },
        el("h3", null, T("دعوة عضو", "Invite member")),
        el("label", { class: "small" }, T("البريد (حساب Google)", "Email (Google account)"), el("input", { name: "email", type: "email", class: "ltr", required: true })),
        el("label", { class: "small" }, T("الدور", "Role"), el("select", { name: "role" }, ...C.INVITABLE_ROLES.map(rr => el("option", { value: rr, selected: rr === "employee" }, T(C.ROLES[rr].ar, C.ROLES[rr].en))))),
        el("button", { class: "primary", type: "submit" }, T("إرسال الدعوة", "Send invite"))) : el("div", { class: "panel muted small" }, T("دعوة الأعضاء للمالك ورئيس المجلس والمدير العام.", "Only owner, chairman and general manager can invite.")),
      el("div", { class: "panel" }, el("h3", null, T("دعوات معلقة", "Pending invites")),
        pending.length ? el("div", { class: "list" }, ...pending.map(([email, r]) => el("div", { class: "item row" }, el("span", { class: "ltr" }, email), badge("", T(C.ROLES[r]?.ar, C.ROLES[r]?.en)), manage ? el("button", { onclick: () => revoke(email) }, T("إلغاء", "Revoke")) : ""))) : el("p", { class: "muted small" }, T("لا يوجد.", "None.")))));
}

function renderPlans(v) {
  const c = company();
  v.replaceChildren(sectionHead(T("الخطط", "Plans")),
    el("div", { class: "plans" },
      el("div", { class: "plan" + (c?.plan !== "premium_plus" ? " current" : "") }, el("h3", null, T("المجانية — لكل صاحب مصلحة", "Free — for every business")), el("div", { class: "price" }, T("0 · بلا رسوم ولا عمولة", "0 · no fees, no commission")),
        el("ul", null, ...[T("شركات وفروع ومستخدمون بأدوار", "Companies, branches, users with roles"), T("عزل كامل لبيانات كل شركة", "Full isolation per company"), T("المهام والوكلاء والتراسل", "Tasks, agents & messaging"), T("المبيعات والمخزون والتحقيقات (عند ربط مصدرك)", "Sales, stock & investigations (once your source is connected)"), T("لا عمولة على أي عملية بيع", "No commission on any sale")].map(x => el("li", null, x))),
        c ? badge(c.plan === "premium_plus" ? "" : "live", c.plan === "premium_plus" ? "" : T("خطتك الحالية", "Your current plan")) : null),
      el("div", { class: "plan plus" }, el("h3", null, "Premium Plus ★"), el("div", { class: "price" }, T("اشتراك اختياري", "Optional subscription")),
        el("ul", null, ...[T("المساعد الذكي Gemini/OpenAI عبر الخادم", "Gemini/OpenAI assistant via backend"), T("موصلات قواعد البيانات المؤسسية (SQL Server وغيرها)", "Enterprise database connectors"), T("تقارير متقدمة وتصدير", "Advanced reports & export"), T("دعم أولوية", "Priority support")].map(x => el("li", null, x))),
        el("button", { class: "gold", disabled: true, title: T("لا يوجد مزود دفع بعد", "No payment provider yet") }, T("الاشتراك — قريبًا", "Subscribe — coming soon")),
        el("p", { class: "small muted" }, T("الدفع غير مفعّل (NOT_STARTED). الخطة يغيّرها خادم الفوترة فقط — قواعد Firestore تمنع أي عميل من ترقية نفسه.", "Billing not enabled. Only the billing backend can change the plan — Firestore rules stop clients upgrading themselves.")))));
}

function renderUser() {
  const box = $("user-box");
  if (!state.user) { box.replaceChildren(el("button", { class: "primary", onclick: signIn, disabled: state.cloud !== "ready" }, T("دخول", "Sign in"))); }
  else {
    const initials = (state.user.name || state.user.email).slice(0, 1).toUpperCase();
    box.replaceChildren(el("div", { class: "avatar", title: state.user.email }, state.user.photo ? el("img", { src: state.user.photo, alt: "", referrerpolicy: "no-referrer" }) : initials),
      el("div", { class: "hide-m small" }, el("b", null, S(state.user.name || state.user.email, 40)), el("div", { class: "muted" }, role() ? T(C.ROLES[role()].ar, C.ROLES[role()].en) : "")),
      el("button", { class: "ghost small", onclick: () => auth.signOut() }, T("خروج", "Sign out")));
  }
  const pill = $("company-pill"), sel = $("company-select");
  pill.hidden = !state.user || state.companies.length === 0;
  sel.replaceChildren(...state.companies.map(c => el("option", { value: c.id, selected: c.id === state.companyId }, S(c.name, 60))));
  const conn = state.cloud === "ready" ? (state.user ? T("حالة الاتصال: Firebase متصل · ", "Connection: Firebase connected · ") + (company() ? S(company().name, 40) : T("بلا شركة", "no company")) : T("حالة الاتصال: Firebase جاهز · غير مسجل", "Connection: Firebase ready · signed out"))
    : state.cloud === "loading" ? T("حالة الاتصال: جارٍ التحميل", "Connection: loading") : T("حالة الاتصال: Firebase غير متاح", "Connection: Firebase unavailable");
  $("status-conn").textContent = conn + (EMULATOR ? " (EMULATOR)" : "");
  $("status-data").textContent = state.demo ? T("البيانات المعروضة: تجريبية DEMO — ليست بيانات حقيقية", "Shown data: DEMO — not real") : T("البيانات التشغيلية: لا يوجد مصدر LIVE", "Operational data: no LIVE source");
}

const RENDER = { home: renderHome, sales: renderSales, inventory: renderInventory, finance: renderFinance, investigations: renderInvestigations, maps: renderMaps, assistant: renderAssistant, agents: renderAgents, connections: renderConnections, company: renderCompany, members: renderMembers, plans: renderPlans, branches: renderBranches, audit: renderAudit };
let rq = false;
function render() {
  if (rq) return; rq = true;
  requestAnimationFrame(() => {
    rq = false;
    renderUser();
    const v = document.querySelector(`section.view[data-view="${current}"]`);
    // Keep focus inside forms when a live snapshot arrives.
    if (v && !(v.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.id !== "sales-branch" && document.activeElement.id !== "inv-low") && Object.hasOwn(RENDER, current)) RENDER[current](v);
    $("banner").replaceChildren(...(state.demo && ["home", "sales", "inventory", "finance", "investigations", "maps"].includes(current)
      ? [el("div", { class: "banner" }, el("b", null, T("بيانات تجريبية: ", "Demo data: ")), T("الأرقام في هذه الشاشة مولّدة للمعاينة فقط، وليست من قاعدة جوافة أو أي شركة.", "Figures on this screen are generated for preview only, not from Jawafa or any company."))] : []));
  });
}

// ---------- search ----------
function setupSearch() {
  const q = $("q"), box = $("q-results");
  const items = () => NAV.filter(n => n[0] !== "sep").map(n => ({ id: n[0], label: T(n[2], n[3]) }));
  let idx = 0;
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const list = s ? items().filter(i => i.label.toLowerCase().includes(s) || i.id.includes(s)) : [];
    box.hidden = !list.length; idx = Math.min(idx, Math.max(0, list.length - 1));
    box.replaceChildren(...list.map((i, k) => el("a", { href: "#" + i.id, class: k === idx ? "on" : null, onclick: () => { q.value = ""; box.hidden = true; } }, i.label)));
    return list;
  };
  q.addEventListener("input", () => { idx = 0; draw(); });
  q.addEventListener("keydown", (e) => {
    const list = draw();
    if (e.key === "ArrowDown") { idx = Math.min(idx + 1, list.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { idx = Math.max(idx - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && list[idx]) { location.hash = "#" + list[idx].id; q.value = ""; box.hidden = true; }
    else if (e.key === "Escape") { q.value = ""; box.hidden = true; }
  });
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); q.focus(); } });
  q.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 150));
}

// ---------- boot ----------
$("menu-btn").addEventListener("click", () => { const open = $("side").classList.toggle("open"); $("menu-btn").setAttribute("aria-expanded", String(open)); });
$("theme-btn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "light";
  document.documentElement.dataset.theme = dark ? "light" : "dark"; store.set("jawafa-one-theme", document.documentElement.dataset.theme); themeIcon();
});
function themeIcon() { const light = document.documentElement.dataset.theme === "light"; $("theme-btn").textContent = light ? "☾" : "☀"; $("theme-btn").setAttribute("aria-label", light ? T("الوضع الليلي", "Dark mode") : T("الوضع النهاري", "Light mode")); }
themeIcon();
$("lang-btn").addEventListener("click", () => {
  const en = lang() !== "en";
  document.documentElement.lang = en ? "en" : "ar"; document.documentElement.dir = en ? "ltr" : "rtl";
  store.set("jawafa-one-lang", en ? "en" : "ar"); buildNav(); show(current);
});
$("company-select").addEventListener("change", (e) => selectCompany(e.target.value));
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
buildNav(); setupSearch(); show(location.hash.slice(1));
initCloud();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.__jawafaState = state; // read-only inspection for tests
