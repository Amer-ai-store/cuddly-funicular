/* Authenticated Luqta operations inside Amer AI Store's central dashboard. */
(() => {
  "use strict";
  const root = document.getElementById("luqta-root");
  if (!root || !window.LuqtaAPI) return;
  const client = window.LuqtaAPI.createClient();
  const tabs = [
    ["overview", "الملخص"], ["products", "الأصناف"], ["inventory", "المخزون"],
    ["offers", "العروض"], ["appearance", "التصميم والشاشات"], ["workspace", "استوديو بيئة التطبيق"],
    ["orders", "الطلبات والتتبع"], ["users", "العملاء والمحفظة"],
    ["coupons", "الخصومات"], ["returns", "المرتجعات"], ["tickets", "الدعم"],
    ["settings", "الإعدادات"], ["agents", "الوكلاء"], ["audit", "السجل"],
    ["reports", "التقارير"], ["categories", "الأقسام"], ["flash", "العروض الخاطفة"], ["campaigns", "الحملات"], ["questions", "أسئلة المنتجات"],
    ["giftcards", "بطاقات الهدايا"], ["chats", "محادثات الدعم"], ["faqs", "مركز المساعدة"], ["branches", "الفروع ومخزونها"], ["zones", "مناطق ومواعيد التوصيل"],
    ["vendors", "البائعون"], ["features", "إدارة المشروع (125 ميزة)"], ["reorder", "إعادة الطلب"], ["exports", "التصدير"], ["sync", "المزامنة المركزية"],
  ];
  const deepLinkTab = () => {
    const parts = location.hash.replace(/^#/, "").split("/");
    const candidate = parts[0] === "luqta" ? parts[1] || "overview" : "overview";
    return tabs.some(([id]) => id === candidate) ? candidate : "overview";
  };
  let tab = deepLinkTab();
  const TAB_GROUPS = [
    ["نظرة عامة", ["overview","reports","features"]],
    ["الكتالوج والتصميم", ["products","categories","inventory","offers","flash","campaigns","questions","appearance","workspace"]],
    ["الطلبات والعملاء", ["orders","users","coupons","giftcards","returns","tickets","chats","faqs"]],
    ["الفروع والتوصيل والتجار", ["branches","zones","vendors","reorder"]],
    ["المزامنة والتصدير", ["sync","exports"]],
    ["الإدارة والرقابة", ["settings","agents","audit"]]
  ];
  window.addEventListener("luqta:navigate", event => {
    const requested = event.detail?.tab;
    if (!tabs.some(([id]) => id === requested) || tab === requested) return;
    tab = requested;
    draw();
  });
  let status;
  let body;
  let lastAgentToken = "";
  let bridgeHealthVerified = false;
  let jawafaSourceVerified = false;
  let bridgeCheckAt = 0;
  const reportBridge = (reason) => {
    window.dispatchEvent(new CustomEvent("luqta:bridge-state", {detail:{
      connected: client.connected, healthVerified: client.connected && bridgeHealthVerified,
      jawafaVerified: client.connected && jawafaSourceVerified,
      checkedAt: bridgeCheckAt || null, reason: reason || undefined
    }}));
  };
  async function checkLiveBridge() {
    if (!client.connected) { bridgeHealthVerified = false; jawafaSourceVerified = false; reportBridge(); return false; }
    try {
      const result = await client.request("GET", "/health");
      if (result?.ok !== true || result.service !== "luqta-commerce") throw Error("لم يجتز خادم لُقطة فحص الصحة");
      bridgeHealthVerified = true; bridgeCheckAt = Date.now();
      reportBridge();
      return true;
    } catch (error) {
      bridgeHealthVerified = false; jawafaSourceVerified = false;
      reportBridge("خادم المتجر لم يجتز فحص الاتصال (" + String(error.message || "تعذر الطلب").slice(0,90) + ").");
      return false;
    }
  }
  const node = (tag, value, className) => {
    const result = document.createElement(tag);
    if (value !== undefined && value !== null) result.textContent = String(value);
    if (className) result.className = className;
    return result;
  };
  const text = (parent, value, tag = "p", className = "") => {
    const result = node(tag, value, className); parent.append(result); return result;
  };
  const button = (label, handler, className = "tiny") => {
    const result = node("button", label, className); result.type = "button";
    result.addEventListener("click", handler); return result;
  };
  const cell = (row, value) => { const td = node("td", value); row.append(td); return td; };
  const table = (parent, headers, rows) => {
    const wrap = node("div", undefined, "table-wrap"); const tbl = node("table");
    const thead = node("thead"), tr = node("tr"); headers.forEach(h => tr.append(node("th", h))); thead.append(tr); tbl.append(thead);
    const tbody = node("tbody"); rows.forEach(row => tbody.append(row));
    if (!rows.length) { const empty = node("tr"), td = cell(empty, "لا توجد سجلات."); td.colSpan = headers.length; tbody.append(empty); }
    tbl.append(tbody); wrap.append(tbl); parent.append(wrap); return tbl;
  };
  const field = (form, label, key, type = "text", required = false, value = "") => {
    const wrapper = node("label", undefined, "field"); wrapper.append(node("span", label));
    const input = node(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") input.type = type;
    // Prices, fees, rates and coordinates need decimals; the browser's default step of 1 would reject 3.25 or 32.07.
    if (type === "number") input.step = "any";
    input.name = key; input.required = required; input.value = String(value ?? "");
    wrapper.append(input); form.append(wrapper); return input;
  };
  const select = (form, label, key, options, value = "") => {
    const wrapper = node("label", undefined, "field"); wrapper.append(node("span", label));
    const input = node("select"); input.name = key;
    options.forEach(([id, name]) => { const option = node("option", name); option.value = id; input.append(option); });
    input.value = value; wrapper.append(input); form.append(wrapper); return input;
  };
  const form = (parent, title, submitLabel, submit) => {
    const panel = node("form", undefined, "panel"); panel.style.marginTop = ".7rem";
    panel.append(node("h3", title));
    panel.addEventListener("submit", event => { event.preventDefault(); void run(() => submit(panel)); });
    const action = node("button", submitLabel, "primary"); action.type = "submit"; panel.append(action);
    parent.append(panel); return panel;
  };
  const value = (form, key) => form.elements.namedItem(key)?.value?.trim() || "";
  const count = (value) => Number(value || 0).toLocaleString("ar-JO");
  const money = (value) => `${Number(value || 0).toFixed(3)} د.أ`;
  const safeId = (id) => { const v = String(id); if (!/^[A-Za-z0-9_-]{1,100}$/.test(v)) throw Error("معرّف السجل غير صالح."); return v; };
  const message = (value, failed = false) => { if (status) { status.textContent = value; status.style.color = failed ? "var(--coral)" : "var(--ok)"; } };
  async function run(work, refresh = true) {
    message("جارٍ تنفيذ الطلب...");
    try {
      const result = await work();
      if (!client.connected) { bridgeHealthVerified = false; jawafaSourceVerified = false; draw(); return; }
      const outcome = typeof result === "string" ? result : "اكتملت العملية وتأكد رد الخادم.";
      // Only confirm after the refreshed section has finished rendering. Reporting success
      // earlier lets the user (and e2e tests) type into a form that load() then replaces.
      if (refresh) await load();
      message(outcome);
    } catch (error) {
      if (!client.connected) { bridgeHealthVerified = false; jawafaSourceVerified = false; draw(); }
      message(error.message || "تعذر تنفيذ العملية.", true);
    }
  }
  function draw() {
    root.replaceChildren();
    if (!client.connected) {
      reportBridge();
      text(root, "يرتبط هذا القسم بخادم لُقطة فقط بعد إدخال عنوان HTTPS وتسجيل دخول مدير المتجر. لا تحفظ الصفحة كلمة المرور أو رمز الجلسة في المتصفح.");
      const login = form(root, "اتصال المدير", "دخول وفحص الاتصال", async (f) => {
        const result = await client.login(value(f, "url"), value(f, "email"), value(f, "password"));
        bridgeHealthVerified = true; bridgeCheckAt = Date.now(); jawafaSourceVerified = false;
        reportBridge(); f.reset(); draw(); return `متصل بالخادم ${result.origin} بحساب ${result.user.name || result.user.email}.`;
      });
      const hostInput = field(login, "عنوان خادم لُقطة", "url", "url", true, "https://");
      field(login, "بريد المدير", "email", "email", true);
      field(login, "كلمة المرور", "password", "password", true);
      text(root, "الاتصال التجريبي لا يصبح خدمة إنتاجية إلا بعد الحصول على عنوان HTTPS مُسمّى ودائم ونسخ احتياطي مؤكد. لم تُنشر بيانات تسجيل الدخول.", "p", "small muted");
      const endpointHealth = node("p", "جارٍ التحقق من إعداد الاتصال التجريبي...", "small muted");
      root.append(endpointHealth);
      status = node("p", "بانتظار تسجيل دخول مدير المتجر.", "small"); root.append(status);
      // Runtime endpoint is public configuration only, not a secret or authentication token.
      void fetch("./luqta-runtime.json", { cache:"no-store", credentials:"omit", redirect:"error" })
        .then(async res => { if (!res.ok) throw Error("لا يوجد إعداد استضافة تجريبية."); return res.json(); })
        .then(async config => {
          const origin = window.LuqtaAPI.validateOrigin(config.origin);
          if (!root.contains(hostInput)) return;
          hostInput.value = origin;
          endpointHealth.textContent = "فحص اتصال تجريبي ("+String(config.mode || "غير معروف")+")...";
          const check = await fetch(origin + "/api/health", { credentials:"omit",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8500) });
          const info = await check.json();
          if (!check.ok || info?.service !== "luqta-commerce" || info?.ok !== true) throw Error("لا يعمل خادم لُقطة على عنوان HTTPS التجريبي.");
          if (root.contains(endpointHealth)) endpointHealth.textContent = "خادم لُقطة التجريبي متاح الآن عبر HTTPS. يلزم تسجيل دخول المدير؛ عنوان النفق مؤقت وقد يتغير.";
        }).catch(() => { if (root.contains(endpointHealth)) endpointHealth.textContent = "الرابط التجريبي غير متاح أو يحتاج تحديثًا. تأكد من تشغيل الخادم والنفق أو أدخل عنوان HTTPS آخر."; });
      return;
    }
    const header = node("div", undefined, "toolbar");
    header.append(node("span", `متصل: ${client.origin} · ${client.user.name || client.user.email}`, "pill ok"));
    reportBridge();
    header.append(button("تحديث", () => void run(async () => { await checkLiveBridge(); await load(); }, false)));
    header.append(button("تسجيل الخروج", () => void run(async () => { await client.logout(); bridgeHealthVerified = false; jawafaSourceVerified = false; lastAgentToken = ""; draw(); return "انتهت الجلسة."; }, false)));
    root.append(header);
    const nav = node("div", undefined, "luqta-nav-categories");
    nav.style.display = "grid"; nav.style.gridTemplateColumns = "repeat(auto-fit,minmax(min(100%,210px),1fr))";
    nav.style.gap = ".55rem"; nav.style.marginTop = ".9rem";
    TAB_GROUPS.forEach(([title, names]) => {
      const subgroup = node("details", undefined, "luqta-subgroup");
      subgroup.open = names.includes(tab);
      subgroup.style.border = "1px solid var(--line)"; subgroup.style.borderRadius = "10px";
      subgroup.style.background = "var(--surface-2)"; subgroup.style.padding = ".55rem";
      const heading = node("summary", title + " · " + names.length);
      heading.style.fontWeight = "700"; heading.style.cursor = "pointer"; heading.style.fontSize = ".82rem";
      heading.style.marginBottom = ".4rem"; subgroup.append(heading);
      const links = node("div", undefined, "toolbar"); links.style.gap = ".35rem";
      for (const id of names) {
        const label = tabs.find(([tabId]) => tabId === id)?.[1] || id;
        links.append(button(label, () => {
          tab = id;
          const target = "#luqta/" + id;
          if (location.hash !== target) location.hash = target;
          else draw();
        }, id === tab ? "tiny primary" : "tiny"));
      }
      subgroup.append(links); nav.append(subgroup);
    });
    root.append(nav);
    status = node("p", "", "small"); root.append(status);
    body = node("div"); body.style.display = "grid"; body.style.gap = ".65rem"; root.append(body);
    void run(() => load(), false);
  }
  async function load() {
    if (!client.connected || !body) return;
    const current = tab; let result;
    // `current` comes from the page address, so sections are looked up in Maps, never as object properties.
    const loader = loaderTable.get(current);
    if (current === "inventory") {
      const [undo, connector] = await Promise.all([client.request("GET", "/admin/inventory/undo"), client.request("GET", "/admin/inventory/connector")]);
      result = { ...undo, ...connector };
    } else if (current === "appearance") {
      result = await client.request("GET", "/admin/settings");
    } else if (current === "workspace") {
      const [settings, jobs] = await Promise.all([client.request("GET", "/admin/settings"),client.request("GET", "/admin/agent-jobs")]);
      result = { ...settings, ...jobs };
    } else if (current === "agents") {
      const [keys, jobs] = await Promise.all([client.request("GET", "/admin/agent-keys"), client.request("GET", "/admin/agent-jobs")]);
      result = { ...keys, ...jobs };
    } else if (current === "orders") {
      const [orders, users] = await Promise.all([client.request("GET", "/admin/orders"), client.request("GET", "/admin/users")]);
      result = { ...orders, ...users };
    } else if (typeof loader === "function") {
      result = await loader();
    } else result = await client.request("GET", "/admin/" + current);
    if (tab !== current) return;
    body.replaceChildren();
    const render = rendererTable.get(current);
    if (typeof render === "function") render(result || {});
    message(`آخر تحديث: ${new Date().toLocaleString("ar-JO")}`);
  }
  function renderOverview(data) {
    const stats = data.stats || {};
    const tiles = node("div", undefined, "kpis");
    [["الأصناف", stats.products], ["المخزون المنخفض", stats.lowStock], ["الطلبات", stats.orders],
      ["طلبات معلقة", stats.pendingOrders], ["العملاء", stats.customers], ["الإيراد المحصل", money(stats.revenue)]].forEach(([label, n]) => {
      const tile = node("div", undefined, "kpi"); text(tile, label, "span", "label"); text(tile, typeof n === "string" ? n : count(n), "span", "value"); tiles.append(tile);
    });
    body.append(tiles); text(body, "أحدث الطلبات", "h3");
    table(body, ["المعرّف", "الحالة", "القيمة"], (data.recentOrders || []).map(o => { const tr = node("tr"); cell(tr, o.id); cell(tr, o.status); cell(tr, money(o.total)); return tr; }));
    text(body, "أصناف منخفضة المخزون", "h3");
    table(body, ["الصنف", "الكمية"], (data.lowStockProducts || []).map(p => { const tr = node("tr"); cell(tr, p.name); cell(tr, count(p.stock)); return tr; }));
  }
  function renderProducts(data) {
    let editing = "";
    const editor = form(body, "إنشاء أو تعديل صنف", "حفظ الصنف", async f => {
      const payload = { name: value(f, "name"), price: Number(value(f, "price")), stock: Number(value(f, "stock")),
        category: value(f, "category"), description: value(f, "description"), brand: value(f, "brand"), active: f.elements.namedItem("active").checked };
      if (value(f, "oldPrice")) payload.oldPrice = Number(value(f, "oldPrice"));
      else if (editing) payload.oldPrice = null;
      for (const key of ["variantOf", "variantLabel"]) if (value(f, key)) payload[key] = value(f, key);
      // Gallery, video, specifications table and barcode (checked again by the server: HTTPS only, at most 10 images).
      const lines = (key) => value(f, key).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines("images").length || editing) payload.images = lines("images");
      if (value(f, "video")) payload.video = value(f, "video"); else if (editing) payload.video = null;
      if (lines("specs").length || editing) payload.specs = lines("specs").map(line => { const at = line.indexOf(":"); if (at < 1) throw Error(`اكتب المواصفة بصيغة الاسم: القيمة («${line}»).`); return { label: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }; });
      if (value(f, "barcode")) payload.barcode = value(f, "barcode");
      if (!editing) { if (value(f, "id")) payload.id = value(f, "id"); await client.request("POST", "/admin/products", payload); }
      else await client.request("PATCH", "/admin/products/" + safeId(editing), payload);
      editing = ""; f.reset(); return "حُفظ الصنف في قاعدة بيانات المتجر.";
    });
    const inputs = {};
    for (const [label, key, type, required] of [["معرّف اختياري", "id", "text", false], ["الاسم", "name", "text", true], ["السعر بالدينار", "price", "number", true], ["السعر السابق للعرض (اختياري)", "oldPrice", "number", false], ["الكمية", "stock", "number", true], ["الفئة", "category", "text", false], ["العلامة", "brand", "text", false], ["الوصف", "description", "textarea", false], ["معرّف الصنف الأب", "variantOf", "text", false], ["المقاس/اللون", "variantLabel", "text", false], ["روابط صور المعرض (HTTPS، سطر لكل صورة)", "images", "textarea", false], ["رابط فيديو المنتج (HTTPS، اختياري)", "video", "url", false], ["جدول المواصفات (سطر لكل مواصفة: الاسم: القيمة)", "specs", "textarea", false], ["الباركود", "barcode", "text", false]]) inputs[key] = field(editor, label, key, type, required);
    inputs.price.step = "0.001"; inputs.price.min = "0.001"; inputs.oldPrice.step = "0.001"; inputs.oldPrice.min = "0.001"; inputs.stock.step = "1"; inputs.stock.min = "0";
    const activeLabel = node("label", "منشور "); const active = node("input"); active.type = "checkbox"; active.name = "active"; active.checked = true; activeLabel.append(active); editor.append(activeLabel);
    editor.append(button("نموذج جديد", () => { editing = ""; editor.reset(); inputs.id.disabled = false; active.checked = true; }));
    text(body, `الأصناف: ${count(data.products?.length)}`, "h3");
    table(body, ["الصنف والعائلة", "المعرّف", "السعر", "السعر السابق", "المخزون", "الوسائط والمواصفات", "الحالة", "إجراء"], (data.products || []).map(p => {
      const tr = node("tr"); tr.dataset.product = p.id; cell(tr, p.name + (p.variantLabel ? " — " + p.variantLabel : "") + " · " + (p.familyName || p.category || "—")); cell(tr, p.id); cell(tr, money(p.price)); cell(tr, p.oldPrice == null ? "—" : money(p.oldPrice)); cell(tr, count(p.stock));
      cell(tr, [`${count((p.images || []).length)} صور`, p.video ? "فيديو" : "", (p.specs || []).length ? `${count(p.specs.length)} مواصفات` : "", p.variantOf ? `متغير من ${p.variantOf}` : ""].filter(Boolean).join(" · ")); cell(tr, p.active ? "منشور" : "مؤرشف");
      const actions = cell(tr, ""); actions.append(button("تعديل", () => {
        editing = p.id; for (const key of Object.keys(inputs)) inputs[key].value = p[key] ?? "";
        // A product with sizes lists its cheapest size; edit the product's own price and stock, not the derived ones.
        inputs.price.value = p.basePrice ?? p.price; inputs.stock.value = p.baseStock ?? p.stock;
        inputs.images.value = (p.images || []).join("\n"); inputs.specs.value = (p.specs || []).map(s => `${s.label}: ${s.value}`).join("\n"); inputs.video.value = p.video || ""; inputs.barcode.value = p.barcode || "";
        inputs.id.value = p.id; inputs.id.disabled = true; active.checked = p.active !== false; editor.scrollIntoView({ behavior: "smooth" });
      }));
      if (p.active) actions.append(button("أرشفة", () => { if (confirm(`أرشفة ${p.name}؟`)) void run(() => client.request("DELETE", "/admin/products/" + safeId(p.id))); }, "tiny danger"));
      return tr;
    }));
  }
  function renderInventory(data) {
    const jawafaPanel = node("div", undefined, "panel");
    jawafaPanel.append(node("h3", "اتصال جوافة الحقيقي — قراءة فقط"));
    text(jawafaPanel, "فحص حي من خادم لُقطة إلى جسر TrustSoft المحلي؛ لا تُستورد أي كمية إلى المتجر قبل مطابقة جدول الكمية الفعلية.", "p", "small muted");
    const statusText = node("p", "لم يتم فحص اتصال جوافة بعد.", "small");
    jawafaPanel.append(statusText);
    const listing = node("pre", "", "small"); listing.style.whiteSpace = "pre-wrap"; listing.style.maxHeight = "320px"; listing.style.overflow = "auto";
    jawafaPanel.append(button("فحص اتصال Jawafa_DB", () => void run(async () => {
      const result = await client.request("GET", "/admin/jawafa/source");
      jawafaSourceVerified = result.connected === true && result.mode === "FORENSIC-READ-ONLY";
      reportBridge();
      statusText.textContent = `الاتصال: ${result.connected ? "نشط" : "متوقف"} · ${result.database} · ${result.mode} · جداول: ${result.tableCount} · خريطة الكمية: ${result.quantityMappingVerified ? "معتمدة" : "تحتاج مطابقة"}`;
      return "تأكد اتصال القراءة من خادم المتجر إلى قاعدة جوافة.";
    }, false), "primary"));
    jawafaPanel.append(button("معاينة أسماء الأصناف والعائلات من جوافة", () => void run(async () => {
      const result = await client.request("GET", "/admin/jawafa/catalog-preview");
      listing.textContent = (result.items || []).map(p => [p.itemSeq, p.code, p.name, p.family].join(" · ")).join("\n") || "لا توجد بيانات للمعاينة";
      return `تمت معاينة ${result.count} سجلًا دون كتابة.`;
    }, false)));
    jawafaPanel.append(listing);
    body.append(jawafaPanel);
    const connector = data.connector || {};
    text(body, data.undo ? `آخر استيراد قابل للتراجع: ${data.undo.id} · ${count(data.undo.count)} صنف` : "لا توجد عملية استيراد قابلة للتراجع.");
    if (data.undo) body.append(button("التراجع عن آخر استيراد", () => { if (confirm("هل تريد التراجع عن آخر استيراد؟ سيرفض الخادم التراجع إذا تغيرت الأصناف بعده.")) void run(() => client.request("POST", "/admin/inventory/undo", { importId: data.undo.id })); }, "danger"));
    const importer = form(body, "استيراد CSV إلى قاعدة بيانات المتجر", "استيراد الأصناف", async f => {
      const csv = value(f, "csv"); if (!csv) throw Error("ألصق بيانات CSV أولًا.");
      const result = await client.request("POST", "/admin/inventory/import", { csv, mode: value(f, "mode") });
      return `استُورد ${count(result.imported)} صنفًا (${count(result.created)} جديد).`;
    });
    field(importer, "CSV: id,name,price,stock,category", "csv", "textarea", true);
    select(importer, "طريقة تحديث الكمية", "mode", [["replace", "استبدال"], ["add", "إضافة"]]);
    // Preview first: the server compares every row with the catalog and changes nothing.
    const previewBox = node("div", undefined, "import-preview");
    importer.append(button("معاينة الفروقات قبل الاستيراد", () => void run(async () => {
      const csv = value(importer, "csv"); if (!csv) throw Error("ألصق بيانات CSV أولًا.");
      const { preview } = await client.request("POST", "/admin/inventory-preview", { csv });
      const s = preview.summary || {};
      previewBox.replaceChildren(node("p", `المعاينة: ${count(s.total)} صف · جديد ${count(s.new)} · متغيّر ${count(s.changed)} · بلا تغيير ${count(s.unchanged)} · مرفوض ${count(s.invalid)}`, "small"));
      table(previewBox, ["الصف", "المعرّف", "الحالة", "التغييرات"], (preview.rows || []).slice(0, 50).map(r => {
        const tr = node("tr"); cell(tr, r.row); cell(tr, r.id || "—"); cell(tr, r.status);
        cell(tr, r.error || Object.entries(r.changes || {}).map(([k, [a, b]]) => `${k}: ${a ?? "—"} ← ${b}`).join("، ") || "—"); return tr;
      }));
      return "اكتملت المعاينة دون أي تعديل على المتجر.";
    }, false)));
    importer.append(previewBox);
    const connectorForm = form(body, "تطبيق المخزون الخارجي", "حفظ رابط التطبيق", async f => {
      await client.request("PUT", "/admin/inventory/connector", { url: value(f, "url"), ...(value(f, "token") ? { token: value(f, "token") } : {}) });
      f.elements.namedItem("token").value = ""; return "حُفظ الربط على الخادم.";
    });
    field(connectorForm, "عنوان HTTPS لملف JSON", "url", "url", true, connector.url || "");
    field(connectorForm, "رمز API اختياري (لا يُعرض لاحقًا)", "token", "password");
    text(body, connector.lastSyncAt ? `آخر مزامنة: ${connector.lastSyncAt}` : "لم تحدث مزامنة بعد.", "p", "small muted");
    body.append(button("استيراد الكميات بضغطة زر", () => void run(async () => {
      const result = await client.request("POST", "/admin/inventory/sync", {});
      return `أعاد الخادم نتيجة الاستيراد: ${count(result.imported)} صنف.`;
    }), "primary"));
    const jawafa = node("div", undefined, "panel");
    jawafa.append(node("h3", "مطابقة مخزون جوافة — الكمية الفعلية"));
    text(jawafa, "استيراد لقطة JSON معتمدة من جسر قراءة فقط. الكمية الفعلية = الجاهزة − مبيعات غير مرحلة. أي تعارض أو لقطة قديمة يوقف العملية. لا تُعدّل قاعدة Jawafa_DB.", "p", "small muted");
    const source = node("textarea"); source.placeholder = '{"schema":"jawafa-inventory-v1","snapshotAt":"2026-10-30T18:00:00.000Z","items":[{"id":"SKU_1","name":"صنف","price":1,"readyQuantity":12,"unpostedSalesQuantity":4,"actualQuantity":8}]}';
    source.rows = 5; source.style.width = "100%"; jawafa.append(source);
    const preview = node("pre", "لم تُجرَ معاينة.", "small"); preview.style.whiteSpace = "pre-wrap";
    jawafa.append(button("معاينة دون تعديل", () => void run(async () => {
      const snapshot = JSON.parse(source.value);
      const result = await client.request("POST", "/admin/inventory/jawafa-preview", snapshot);
      preview.textContent = `عدد الأصناف: ${result.count} · وقت اللقطة: ${result.snapshotAt}\n` + JSON.stringify(result.preview, null, 2);
      return "تمت المعاينة دون كتابة.";
    }, false), "tiny"));
    jawafa.append(button("اعتماد نقل الكمية الفعلية إلى المتجر", () => {
      if (!confirm("هل تحققت من مطابقة الأصناف والكميات؟ سيتم تغيير قاعدة المتجر فقط، وليس Jawafa_DB.")) return;
      void run(async () => {
        const snapshot = JSON.parse(source.value);
        const result = await client.request("POST", "/admin/inventory/jawafa-import", { ...snapshot, confirm: true });
        return `تم استيراد ${result.imported} صنفًا إلى قاعدة المتجر.`;
      });
    }, "primary"));
    jawafa.append(preview); body.append(jawafa);
  }
  function renderOffers(data) {
    text(body, "العروض النشطة", "h3");
    table(body, ["الصنف", "السعر السابق", "سعر العرض", "الكمية"], (data.offers || []).map(p => {
      const tr = node("tr"); cell(tr, p.name); cell(tr, money(p.oldPrice)); cell(tr, money(p.price)); cell(tr, count(p.stock)); return tr;
    }));
    const editor = form(body, "استيراد العروض إلى قاعدة المتجر", "معاينة وتأكيد العروض", async f => {
      const items = JSON.parse(value(f, "offers"));
      if (!Array.isArray(items) || !items.length) throw Error("أدخل قائمة عروض JSON صحيحة.");
      if (!confirm(`تحديث أسعار ${items.length} صنفًا في قاعدة المتجر فقط؟`)) return "أُلغي الاستيراد.";
      const result = await client.request("POST", "/admin/offers/import", { items, confirm: true });
      return `حُفظت ${result.imported} عروض في قاعدة المتجر.`;
    });
    const source = field(editor, "JSON: [{id,price,oldPrice}]. لا تنسخ أسعارًا غير معتمدة.", "offers", "textarea", true);
    source.placeholder = '[{"id":"SKU_1","price":1.25,"oldPrice":1.75}]';
  }
  function renderAppearance(data) {
    const design = data.settings?.storefront || {};
    const editor = form(body, "تحرير تصميم واجهة المتجر", "حفظ التصميم في قاعدة المتجر", async f => {
      const storefront = { accentColor: value(f, "accentColor"), heroTitle: value(f, "heroTitle"),
        heroSubtitle: value(f, "heroSubtitle"), showAssistant: f.elements.namedItem("showAssistant").checked };
      await client.request("PATCH", "/admin/settings", { storefront });
      return "تم اعتماد تصميم واجهة المتجر. سيظهر للتطبيق المرتبط عند تحديث بياناته.";
    });
    const accent = field(editor, "لون الهوية (HEX)", "accentColor", "color", true, design.accentColor || "#B94721");
    accent.style.maxWidth = "160px";
    field(editor, "عنوان الواجهة الرئيسية", "heroTitle", "text", true, design.heroTitle || "لُقطات تستحق أن تكون لك");
    field(editor, "الوصف أسفل العنوان", "heroSubtitle", "textarea", true, design.heroSubtitle || "اكتشف منتجات تُشبه ذوقك");
    const label = node("label", "إظهار قسم المساعد في الرئيسية");
    const toggle = node("input"); toggle.type = "checkbox"; toggle.name = "showAssistant"; toggle.checked = design.showAssistant !== false; label.prepend(toggle); editor.append(label);
    text(body, "التعديلات المعتمدة هنا: الهوية البصرية والنصوص وإظهار المساعد. تغيير بنية الشاشات أو إضافة مكونات جديدة يتطلب تعديل الشفرة واختبار إصدار التطبيق؛ لا يوجد محرر شيفرة إنتاجي مفتوح من المتصفح.", "p", "small muted");
  }
  function renderWorkspace(data) {
    const workspace = node("div", undefined, "command-workspace");
    text(workspace,"بيئة العمل المشتركة — لُقطة","h2");
    text(workspace,"تستخدم هذه المساحة نفس جلسة المدير ونفس قاعدة المتجر الخاصة؛ لا تُحفظ بيانات الاعتماد في GitHub Pages. الاتصال يبقى ضمن هذه الصفحة فقط ويحتاج إعادة تسجيل دخول عند تحديثها.", "p","small muted");
    const links = node("div",undefined,"toolbar");
    for(const [label,href] of [
      ["إدارة الأصناف","#luqta/products"],["معاينة المخزون","#luqta/inventory"],
      ["استيراد العروض","#luqta/offers"],["تعديل الشاشات الظاهرية","#luqta/appearance"],
      ["مهام الوكلاء","#luqta/agents"],["سجل التعديلات","#luqta/audit"]
    ]){const link = node("a",label,"btn");link.href=href;links.append(link)}
    workspace.append(links);
    body.append(workspace);
    const bridge = node("section",undefined,"panel");
    bridge.append(node("h3","التحقق من الجسر المتصل ببيئة العمل"));
    const display = node("p",bridgeHealthVerified ? "جلسة الإدارة متصلة بخادم المتجر." : "يلزم التحقق من الخادم.","small muted");
    bridge.append(display);
    bridge.append(button("اختبار اتصال خادم التطبيق",()=>void run(async()=>{
      const ok = await checkLiveBridge();
      if(!ok)throw Error("فشل اتصال خادم التطبيق.");
      display.textContent = "تم فحص /api/health بنجاح. " + new Date(bridgeCheckAt).toLocaleString("ar-JO");
      return "جسر لوحة التحكم ↔ خادم التطبيق يعمل في الجلسة الحالية.";
    },false),"primary"));
    const source = node("p","لم يُفحص مصدر جوافة في هذه الجلسة.","small muted");
    bridge.append(button("فحص جسر TrustSoft بالقراءة فقط",()=>void run(async()=>{
      const result = await client.request("GET","/admin/jawafa/source");
      jawafaSourceVerified = result.connected === true && result.mode === "FORENSIC-READ-ONLY";
      reportBridge();
      source.textContent = "جداول المصدر: " + count(result.tableCount) + " · المصدر: "
        + String(result.database || "—") + " · الكمية الفعلية: "
        + (result.quantityMappingVerified === true ? "معتمدة" : "غير معتمدة بعد");
      return "تم اختبار استجابة جسر القراءة دون تعديل بيانات جوافة.";
    },false)));
    bridge.append(source);body.append(bridge);
    const screens = node("section",undefined,"panel");
    screens.append(node("h3","الملفات والشاشات القابلة للتطوير"));
    text(screens,"يمكنك تعديل إعدادات العرض أدناه مباشرة؛ تغيير ترتيب الشاشات أو الكود يحتاج طلب تطوير ومراجعة واختبارات وإصدارًا جديدًا.", "p","small muted");
    const repo = "https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/";
    const screenLinks = [
      ["الرئيسية","luqta-mobile/src/app/index.tsx"],
      ["شاشة المدير","luqta-mobile/src/app/admin.tsx"],
      ["عروض المتجر","luqta-mobile/src/app/offers.tsx"],
      ["مكوّنات الواجهة","luqta-mobile/src/components"],
      ["خادم التجارة","luqta-mobile/server/commerce.mjs"]
    ];
    const sourceList=node("div",undefined,"command-source-links");
    sourceList.style.display="flex";sourceList.style.flexWrap="wrap";sourceList.style.gap=".45rem";
    for(const [name,path] of screenLinks){
      const link=node("a","كود "+name,"btn");link.href=repo+"tree/main/"+path;link.rel="noopener noreferrer";link.target="_blank";
      sourceList.append(link);
    }
    screens.append(sourceList);body.append(screens);
    renderAppearance({settings:data.settings || {}});
    const tasks = form(body,"طلب تعديل شاشة أو إضافة في بيئة التطبيق","تسجيل مهمة التطوير",async formNode=>{
      const target = value(formNode,"screen");
      const title = value(formNode,"title");
      const specification = value(formNode,"description");
      const acceptance = value(formNode,"acceptance");
      if(specification.length < 12 || acceptance.length < 10)throw Error("أضف وصف التعديل ومعيار قبول قابل للفحص.");
      const result = await client.request("POST","/admin/agent-jobs",{
        title:"تطوير "+target+": "+title,
        type:"development",
        description:"الشاشة: "+target+"\nالمطلوب: "+specification+"\nدليل القبول: "+acceptance+"\nشرط: لا تغيير Jawafa_DB ولا نشر إنتاجي دون اختبارات."
      });
      if(!result.job?.id)throw Error("لم يُعِد الخادم معرّفًا للمهمة.");
      formNode.reset();
      return "حُفظ طلب التطوير في خادم المتجر بالمعرّف: "+result.job.id+". لا يعني ذلك أن الكود تغير أو نُشر.";
    });
    select(tasks,"الشاشة/المجال","screen",[
      ["الرئيسية","الرئيسية"],["الأصناف والمخزون","الأصناف والمخزون"],["العروض","العروض"],
      ["الدفع والطلبات","الدفع والطلبات"],["لوحة المدير","لوحة المدير"],["شاشة جديدة","شاشة جديدة"]
    ]);
    field(tasks,"عنوان التعديل","title","text",true);
    field(tasks,"وصف التغيير المطلوب","description","textarea",true);
    field(tasks,"كيف نختبر نجاح التغيير؟","acceptance","textarea",true);
    text(body,"تُحفظ هذه الطلبات في طابور وكيل التطوير على خادم المتجر. التنفيذ الآلي للكود يحتاج وكيلًا خارجيًا متصلًا بـGitHub وصلاحية مناسبة، ولا نعتبر الطلب نسخة منشورة.", "p","small muted");
    text(body,"أحدث طلبات التطوير","h3");
    table(body,["المهمة","الحالة","التوثيق"],(data.jobs||[]).filter(j=>j.type==="development").slice(0,12).map(j=>{
      const row=node("tr");cell(row,j.title);cell(row,j.status);cell(row,j.testEvidence || "بانتظار دليل تنفيذ");return row;
    }));
  }
  function renderOrders(data) {
    const drivers = (data.users || []).filter(u => u.role === "driver");
    const next = { pending: "confirmed", confirmed: "preparing", preparing: "out_for_delivery", out_for_delivery: "delivered" };
    table(body, ["الطلب", "التاريخ", "العميل", "المبلغ", "الحالة", "السائق", "إجراءات"], (data.orders || []).map(o => {
      const tr = node("tr"); cell(tr, o.id); cell(tr, o.date || ""); cell(tr, o.userId); cell(tr, money(o.total)); cell(tr, o.status); cell(tr, o.driverId || "—");
      const actions = cell(tr, ""); const driver = node("select");
      [["", "اختر سائقًا"], ...drivers.map(d => [d.id, d.name || d.email])].forEach(([id, name]) => { const option = node("option", name); option.value = id; driver.append(option); });
      driver.value = o.driverId || ""; actions.append(driver);
      actions.append(button("تعيين السائق", () => void run(() => client.request("PATCH", "/admin/orders/" + safeId(o.id), { driverId: driver.value || null }))));
      if (next[o.status]) actions.append(button("إلى " + next[o.status], () => void run(() => client.request("PATCH", "/admin/orders/" + safeId(o.id), { status: next[o.status], ...(driver.value ? { driverId: driver.value } : {}) }))));
      if (["pending", "confirmed"].includes(o.status)) actions.append(button("إلغاء", () => { if (confirm("إلغاء الطلب وإعادة مخزونه؟")) void run(() => client.request("PATCH", "/admin/orders/" + safeId(o.id), { status: "cancelled" })); }, "tiny danger"));
      actions.append(button("الفاتورة", () => void run(async () => {
        const { invoice, html } = await client.request("GET", "/orders/" + safeId(o.id) + "/invoice");
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        const link = document.createElement("a"); link.href = url; link.download = `${invoice.number}.html`; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `نُزّلت الفاتورة ${invoice.number}.`;
      }, false)));
      actions.append(button("تتبع", () => void run(async () => {
        const tracking = await client.request("GET", "/orders/" + safeId(o.id) + "/tracking");
        const point = tracking.location;
        if (point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
          const url = `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=15/${point.latitude}/${point.longitude}`;
          const link = node("a", `موقع السائق (${point.updatedAt || ""})`); link.href = url; link.target = "_blank"; link.rel = "noopener"; actions.append(link);
          return "موقع السائق الفعلي متاح على الخريطة.";
        }
        return "لم يشارك السائق موقعه بعد.";
      }, false)));
      return tr;
    }));
  }
  function renderUsers(data) {
    const walletForm = form(body, "تعديل رصيد المحفظة بإجراء مدقق", "إضافة الحركة", async f => {
      const result = await client.request("POST", "/admin/wallet/adjust", { userId: value(f, "userId"), amount: Number(value(f, "amount")), note: value(f, "note") });
      f.reset(); return `الرصيد الجديد: ${money(result.balance)}.`;
    });
    const userInput = field(walletForm, "معرّف العميل", "userId", "text", true);
    const amount = field(walletForm, "المبلغ (+ أو -)", "amount", "number", true); amount.step = "0.001";
    field(walletForm, "سبب التعديل", "note", "text", true);
    table(body, ["المستخدم", "الاسم", "البريد", "الدور", "رصيد المحفظة", "الإجراء"], (data.users || []).map(u => {
      const tr = node("tr"); tr.dataset.user = u.id; cell(tr, u.id); cell(tr, u.name || "—"); cell(tr, u.email); cell(tr, u.role); cell(tr, money(u.walletBalance)); const actions = cell(tr, "");
      actions.append(button("للمحفظة", () => { userInput.value = u.id; walletForm.scrollIntoView({ behavior: "smooth" }); }));
      const roles = node("select"); [["customer", "عميل"], ["driver", "سائق"], ["admin", "مدير"]].forEach(([id, name]) => { const opt = node("option", name); opt.value = id; roles.append(opt); }); roles.value = u.role; actions.append(roles);
      actions.append(button("تغيير الدور", () => { if (confirm(`تغيير دور ${u.email} إلى ${roles.value}؟`)) void run(() => client.request("PATCH", "/admin/users/" + safeId(u.id), { role: roles.value })); }));
      return tr;
    }));
  }
  function renderCoupons(data) {
    let editing = "";
    const editor = form(body, "إنشاء أو تعديل قسيمة", "حفظ القسيمة", async f => {
      const payload = { code: value(f, "code"), type: value(f, "type"), value: Number(value(f, "value")), minSubtotal: Number(value(f, "minSubtotal") || 0), active: true };
      if (value(f, "maxUses")) payload.maxUses = Number(value(f, "maxUses"));
      if (value(f, "expiresAt")) payload.expiresAt = new Date(value(f, "expiresAt")).toISOString();
      await client.request(editing ? "PATCH" : "POST", "/admin/coupons" + (editing ? "/" + safeId(editing) : ""), payload);
      editing = ""; f.reset(); return "حُفظت القسيمة.";
    });
    const inputs = { code: field(editor, "رمز الخصم", "code", "text", true), type: select(editor, "النوع", "type", [["percent", "نسبة مئوية"], ["fixed", "مبلغ ثابت"]]), value: field(editor, "القيمة", "value", "number", true), minSubtotal: field(editor, "الحد الأدنى للسلة", "minSubtotal", "number", false, "0"), maxUses: field(editor, "الحد الأقصى للاستخدام", "maxUses", "number"), expiresAt: field(editor, "تاريخ الانتهاء", "expiresAt", "datetime-local") };
    inputs.value.step = "0.001"; inputs.minSubtotal.step = "0.001";
    editor.append(button("قسيمة جديدة", () => { editing = ""; editor.reset(); }));
    table(body, ["الرمز", "النوع", "القيمة", "استخدامات", "نشط", "إجراءات"], (data.coupons || []).map(c => {
      const tr = node("tr"); cell(tr, c.code); cell(tr, c.type); cell(tr, c.value); cell(tr, `${c.uses}/${c.maxUses || "∞"}`); cell(tr, c.active ? "نعم" : "لا");
      const actions = cell(tr, ""); actions.append(button("تعديل", () => { editing = c.id; for (const key of ["code", "type", "value", "minSubtotal", "maxUses"]) inputs[key].value = c[key] ?? ""; inputs.expiresAt.value = c.expiresAt ? String(c.expiresAt).slice(0, 16) : ""; editor.scrollIntoView({ behavior: "smooth" }); }));
      if (c.active) actions.append(button("تعطيل", () => { if (confirm("تعطيل القسيمة؟")) void run(() => client.request("DELETE", "/admin/coupons/" + safeId(c.id))); }, "tiny danger"));
      return tr;
    }));
  }
  function renderReturns(data) {
    const details = node("div");
    table(body, ["الطلب", "العميل", "السبب", "الحالة", "إجراء"], (data.returns || []).map(r => {
      const tr = node("tr"); tr.dataset.return = r.id; cell(tr, r.orderId); cell(tr, r.userId); cell(tr, r.reason); cell(tr, r.status);
      const actions = cell(tr, "");
      // The selected items, the expected wallet refund and the shopper's photo, before deciding.
      actions.append(button("التفاصيل", () => void run(async () => {
        const { returnRequest: x } = await client.request("GET", "/admin/return-details/" + safeId(r.id));
        const panel = node("div", undefined, "panel"); panel.dataset.returnDetails = r.id;
        panel.append(node("h3", `مرتجع ${x.orderId} · ${x.status}`));
        text(panel, x.items ? x.items.map(i => `${i.name || i.productId} × ${count(i.quantity)}`).join("، ") : "الطلب كاملًا");
        text(panel, `المبلغ المسترد إلى المحفظة: ${money(x.refund)}`, "p", "small");
        if (x.photoId) { const { upload } = await client.request("GET", "/uploads/" + safeId(x.photoId)); const img = node("img"); img.src = upload.dataUrl; img.alt = "صورة المنتج المرتجع"; img.style.maxWidth = "220px"; img.style.borderRadius = "10px"; panel.append(img); }
        else text(panel, "لم يُرفق العميل صورة.", "p", "small muted");
        details.replaceChildren(panel); return "عُرضت تفاصيل المرتجع.";
      }, false)));
      if (r.status === "requested") for (const [state, label] of [["approved", "قبول ورد المحفظة"], ["rejected", "رفض"]]) actions.append(button(label, () => {
        const note = prompt("ملاحظة القرار (اختيارية):", ""); if (note === null) return;
        if (confirm(`${label} طلب الإرجاع؟`)) void run(() => client.request("PATCH", "/admin/returns/" + safeId(r.id), { status: state, note }));
      }, state === "rejected" ? "tiny danger" : "tiny")); return tr;
    }));
    body.append(details);
  }
  function renderTickets(data) {
    table(body, ["الموضوع", "رسالة العميل", "الحالة", "ردود", "إجراء"], (data.tickets || []).map(t => {
      const tr = node("tr"); cell(tr, t.subject); cell(tr, t.message); cell(tr, t.status); cell(tr, count(t.replies?.length));
      const actions = cell(tr, ""); actions.append(button("رد", () => { const reply = prompt("اكتب رد الدعم:"); if (reply) void run(() => client.request("POST", "/admin/tickets/" + safeId(t.id) + "/replies", { message: reply })); }));
      if (t.status !== "resolved") actions.append(button("إغلاق", () => void run(() => client.request("PATCH", "/admin/tickets/" + safeId(t.id), { status: "resolved" }))));
      return tr;
    }));
  }
  function renderSettings(data) {
    const s = data.settings || {};
    const editor = form(body, "إعدادات المتجر الحية", "حفظ الإعدادات", async f => {
      await client.request("PATCH", "/admin/settings", { storeName: value(f, "storeName"), currency: value(f, "currency"), country: value(f, "country"), shippingFee: Number(value(f, "shippingFee")), freeShippingThreshold: Number(value(f, "freeShippingThreshold")), returnsDays: Number(value(f, "returnsDays")) });
      return "حُفظت إعدادات المتجر.";
    });
    field(editor, "اسم المتجر", "storeName", "text", true, s.storeName);
    field(editor, "العملة", "currency", "text", true, s.currency || "JOD");
    field(editor, "الدولة", "country", "text", true, s.country || "JO");
    for (const [label, key] of [["رسوم التوصيل", "shippingFee"], ["حد التوصيل المجاني", "freeShippingThreshold"], ["أيام الإرجاع", "returnsDays"]]) { const input = field(editor, label, key, "number", true, s[key]); input.min = "0"; input.step = key === "returnsDays" ? "1" : "0.001"; }
  }
  function renderAgents(data) {
    const jobForm = form(body, "مهمة للوكيل", "إضافة المهمة", async f => {
      await client.request("POST", "/admin/agent-jobs", { title: value(f, "title"), description: value(f, "description"), type: value(f, "type") });
      f.reset(); return "أُضيفت المهمة إلى قائمة الوكلاء.";
    });
    field(jobForm, "العنوان", "title", "text", true); field(jobForm, "الوصف", "description", "textarea", true);
    select(jobForm, "النوع", "type", [["audit", "تدقيق"], ["repair", "إصلاح"], ["development", "تطوير"]]);
    text(body, "المهام", "h3");
    table(body, ["المهمة", "النوع", "الحالة", "دليل الاختبار"], (data.jobs || []).map(j => { const tr = node("tr"); cell(tr, j.title); cell(tr, j.type); cell(tr, j.status); cell(tr, j.testEvidence || "—"); return tr; }));
    const keyForm = form(body, "إصدار مفتاح محدود الصلاحيات لوكيل خارجي", "إصدار المفتاح", async f => {
      const scopes = [...f.querySelectorAll('input[name="scope"]:checked')].map(input => input.value);
      if (!scopes.length) throw Error("اختر صلاحية واحدة على الأقل.");
      const result = await client.request("POST", "/admin/agent-keys", { name: value(f, "name"), scopes });
      lastAgentToken = result.token;
      f.reset(); return "أُصدر مفتاح جديد. انسخه الآن؛ لن يظهر بعد مغادرة هذه الجلسة.";
    });
    field(keyForm, "اسم الوكيل", "name", "text", true);
    for (const [id, label] of [["catalog:write", "الكتالوج"], ["inventory:write", "المخزون"], ["orders:write", "الطلبات"], ["settings:write", "الإعدادات"], ["jobs:write", "المهام"]]) {
      const wrapper = node("label", label + " "); const input = node("input"); input.type = "checkbox"; input.name = "scope"; input.value = id; wrapper.append(input); keyForm.append(wrapper);
    }
    if (lastAgentToken) { text(body, "المفتاح الصادر لمرة واحدة:", "h3"); text(body, lastAgentToken, "pre", "code"); }
    text(body, "المفاتيح", "h3");
    table(body, ["الاسم", "الصلاحيات", "آخر استخدام", "الحالة", "إجراء"], (data.keys || []).map(k => {
      const tr = node("tr"); cell(tr, k.name); cell(tr, (k.scopes || []).join("، ")); cell(tr, k.lastUsedAt || "—"); cell(tr, k.revoked ? "ملغى" : "نشط");
      const actions = cell(tr, ""); if (!k.revoked) actions.append(button("إلغاء المفتاح", () => { if (confirm("إبطال وصول هذا الوكيل؟")) void run(() => client.request("DELETE", "/admin/agent-keys/" + safeId(k.id))); }, "tiny danger")); return tr;
    }));
  }
  function renderAudit(data) {
    table(body, ["الوقت", "الفاعل", "الإجراء", "المعرّف", "تفاصيل"], (data.events || []).map(e => { const tr = node("tr"); cell(tr, e.createdAt); cell(tr, e.actorId); cell(tr, e.action); cell(tr, e.entityId); cell(tr, JSON.stringify(e.detail || {})); return tr; }));
  }
  // ---- Sections for the 125-feature catalog (accounts, catalog, delivery, loyalty, support, merchants, central sync). ----
  const downloadText = async (path, query, filename, type) => {
    let content = await client.download(path, query);
    // response.text() drops the byte-order mark; put it back so Excel opens Arabic CSV as UTF-8.
    if (type === "text/csv" && !content.startsWith("\uFEFF")) content = "\uFEFF" + content;
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `نُزّل الملف ${filename}.`;
  };
  const isoIn = (days) => new Date(Date.now() + Number(days || 0) * 86400000).toISOString();
  const statusPill = (value, okValues = ["success", "active", "verified", "approved"]) => node("span", value, "pill" + (okValues.includes(value) ? " ok" : ""));
  const loaders = {
    overview: async () => ({ ...(await client.request("GET", "/admin/overview")), ...(await client.request("GET", "/admin/kpis")) }),
    reports: () => client.request("GET", "/admin/reports", undefined, { days: reportDays }),
    categories: () => client.request("GET", "/admin/categories"),
    flash: async () => ({ ...(await client.request("GET", "/admin/flash-deals")), ...(await client.request("GET", "/admin/products")) }),
    campaigns: () => client.request("GET", "/admin/campaigns"),
    questions: () => client.request("GET", "/admin/questions"),
    giftcards: () => client.request("GET", "/admin/gift-cards"),
    chats: () => client.request("GET", "/admin/chats"),
    faqs: () => client.request("GET", "/admin/faqs"),
    branches: async () => ({ ...(await client.request("GET", "/admin/branches")), ...(await client.request("GET", "/admin/branch-stock", undefined, stockBranch ? { branch: stockBranch } : undefined)) }),
    zones: async () => ({ ...(await client.request("GET", "/admin/zones")), ...(await client.request("GET", "/admin/slots", undefined, { days: 7 })) }),
    vendors: () => client.request("GET", "/admin/vendors"),
    features: async () => ({ ...(await client.request("GET", "/admin/features")), log: await client.request("GET", "/admin/test-log"), ...(await client.request("GET", "/admin/devlog")) }),
    reorder: () => client.request("GET", "/admin/reorder"),
    exports: async () => ({}),
    sync: async () => ({ ...(await client.request("GET", "/admin/sync/status")), ...(await client.request("GET", "/admin/sync/receipts")) }),
  };
  const loaderTable = new Map(Object.entries(loaders));
  let reportDays = 30, stockBranch = "", openChat = "";
  function renderKpis(data) {
    const k = data.kpis || {};
    const tiles = node("div", undefined, "kpis");
    [["مبيعات اليوم", money(k.salesToday)], ["مبيعات الأسبوع", money(k.salesWeek)], ["متوسط الطلب", money(k.averageOrderValue)], ["طلبات نشطة", count(k.activeOrders)],
      ["الأقسام", count(k.categories)], ["البائعون", count(k.vendors)], ["محادثات بانتظار موظف", count(k.openChats)], ["مرتجعات للمراجعة", count(k.pendingReturns)],
      ["آخر مزامنة", k.sync ? `${k.sync.id} · ${k.sync.status}` : "لم تُشغّل"]].forEach(([label, v]) => { const tile = node("div", undefined, "kpi"); text(tile, label, "span", "label"); text(tile, v, "span", "value"); tiles.append(tile); });
    body.append(tiles);
    renderOverview(data);
  }
  function renderReports(data) {
    const bar = node("div", undefined, "toolbar");
    [7, 30, 90].forEach(d => bar.append(button(`${d} يوم`, () => { reportDays = d; void run(() => load(), false); }, d === reportDays ? "tiny primary" : "tiny")));
    body.append(bar);
    const t = data.totals || {};
    const tiles = node("div", undefined, "kpis");
    [["الإيراد", money(t.revenue)], ["الطلبات", count(t.orders)], ["متوسط الطلب", money(t.averageOrderValue)], ["القطع المباعة", count(t.itemsSold)], ["عملاء جدد", count(t.newCustomers)], ["نسبة المرتجعات", `${t.returnsRate ?? 0}%`], ["نسبة الإلغاء", `${t.cancelRate ?? 0}%`], ["تقييم الطلبات", `${data.ratings?.average || "—"} (${count(data.ratings?.count)})`], ["تقييم السائقين", String(data.ratings?.driverAverage || "—")]].forEach(([label, v]) => { const tile = node("div", undefined, "kpi"); text(tile, label, "span", "label"); text(tile, v, "span", "value"); tiles.append(tile); });
    body.append(tiles);
    text(body, "المبيعات اليومية", "h3");
    const max = Math.max(1, ...(data.byDay || []).map(d => d.revenue));
    const chart = node("div"); chart.style.cssText = "display:flex;align-items:flex-end;gap:4px;height:120px;border-bottom:1px solid var(--line)";
    (data.byDay || []).forEach(d => { const b = node("div"); b.title = `${d.date}: ${money(d.revenue)} · ${d.orders}`; b.style.cssText = `flex:1;background:var(--accent,#7C5CFF);border-radius:6px 6px 0 0;height:${Math.max(4, d.revenue / max * 116)}px`; chart.append(b); });
    body.append(chart);
    text(body, "الأكثر مبيعًا", "h3");
    table(body, ["المنتج", "الكمية", "الإيراد"], (data.topProducts || []).map(p => { const tr = node("tr"); cell(tr, p.name); cell(tr, count(p.quantity)); cell(tr, money(p.revenue)); return tr; }));
    text(body, "حسب القسم", "h3");
    table(body, ["القسم", "الإيراد"], (data.byCategory || []).map(c => { const tr = node("tr"); cell(tr, c.category); cell(tr, money(c.revenue)); return tr; }));
  }
  function renderCategories(data) {
    const f = form(body, "قسم جديد", "إضافة القسم", async x => { await client.request("POST", "/admin/categories", { id: value(x, "id"), name: value(x, "name"), nameEn: value(x, "nameEn"), icon: value(x, "icon") || "tag", color: value(x, "color") || "#7C5CFF" }); x.reset(); return "أُضيف القسم ويظهر في التطبيق."; });
    field(f, "المعرّف (أحرف إنجليزية صغيرة)", "id", "text", true); field(f, "الاسم", "name", "text", true); field(f, "الاسم بالإنجليزية", "nameEn"); field(f, "الأيقونة", "icon", "text", false, "tag"); field(f, "اللون HEX", "color", "text", false, "#7C5CFF");
    table(body, ["الترتيب", "القسم", "المنتجات", "الحالة", "إجراء"], (data.categories || []).map(c => {
      const tr = node("tr"); cell(tr, c.sort); cell(tr, `${c.name} · ${c.id}`); cell(tr, count(c.productCount)); cell(tr, c.active ? "ظاهر" : "مخفي");
      const a = cell(tr, ""); a.append(button(c.active ? "إخفاء" : "إظهار", () => void run(() => client.request("PATCH", "/admin/categories/" + safeId(c.id), { active: !c.active }))));
      a.append(button("حذف", () => { if (confirm(`حذف ${c.name}؟`)) void run(() => client.request("DELETE", "/admin/categories/" + safeId(c.id))); }, "tiny danger"));
      return tr;
    }));
  }
  function renderFlash(data) {
    const f = form(body, "عرض خاطف جديد", "إطلاق العرض", async x => { await client.request("POST", "/admin/flash-deals", { productId: value(x, "productId"), price: Number(value(x, "price")), endsAt: isoIn(Number(value(x, "hours")) / 24), limit: value(x, "limit") ? Number(value(x, "limit")) : undefined }); x.reset(); return "انطلق العرض الخاطف بعدّاد في التطبيق."; });
    select(f, "المنتج", "productId", (data.products || []).filter(p => p.active && !p.hasVariants).map(p => [p.id, `${p.name} — ${money(p.basePrice ?? p.price)}`]));
    const price = field(f, "سعر العرض", "price", "number", true); price.step = "0.001";
    field(f, "المدة بالساعات", "hours", "number", true, "24"); field(f, "كمية محدودة (اختياري)", "limit", "number");
    table(body, ["المنتج", "السعر", "ينتهي", "المباع", "الحالة", "إجراء"], (data.deals || []).map(d => {
      const tr = node("tr"); cell(tr, d.product?.name || d.productId); cell(tr, `${money(d.price)} بدل ${money(d.originalPrice)}`); cell(tr, new Date(d.endsAt).toLocaleString("ar-JO")); cell(tr, d.limit ? `${d.sold}/${d.limit}` : count(d.sold)); cell(tr, d.active ? "نشط" : "متوقف");
      const a = cell(tr, ""); if (d.active) a.append(button("إيقاف", () => void run(() => client.request("DELETE", "/admin/flash-deals/" + safeId(d.id))), "tiny danger")); return tr;
    }));
  }
  function renderCampaigns(data) {
    const f = form(body, "حملة جديدة", "نشر الحملة", async x => { await client.request("POST", "/admin/campaigns", { title: value(x, "title"), subtitle: value(x, "subtitle"), link: value(x, "link") || "/offers", color: value(x, "color") || "#FF6B4A", cta: value(x, "cta") || undefined, endsAt: isoIn(value(x, "days") || 7) }); x.reset(); return "نُشرت الحملة في الصفحة الرئيسية للتطبيق."; });
    field(f, "العنوان", "title", "text", true); field(f, "الوصف", "subtitle"); field(f, "الرابط داخل التطبيق", "link", "text", false, "/offers"); field(f, "نص الزر", "cta"); field(f, "اللون HEX", "color", "text", false, "#FF6B4A"); field(f, "المدة بالأيام", "days", "number", false, "7");
    table(body, ["الحملة", "الرابط", "حتى", "الحالة", "إجراء"], (data.campaigns || []).map(c => {
      const tr = node("tr"); cell(tr, `${c.title} — ${c.subtitle || ""}`); cell(tr, c.link); cell(tr, c.endsAt.slice(0, 10)); cell(tr, c.active ? "نشطة" : "متوقفة");
      cell(tr, "").append(button(c.active ? "إيقاف" : "تفعيل", () => void run(() => client.request("PATCH", "/admin/campaigns/" + safeId(c.id), { active: !c.active })))); return tr;
    }));
  }
  function renderQuestions(data) {
    text(body, "أسئلة العملاء بانتظار رد رسمي", "h3");
    (data.questions || []).forEach(q => {
      const f = form(body, `${q.productName || q.productId}: ${q.question}`, "إرسال الرد الرسمي", async x => { await client.request("POST", "/questions/" + safeId(q.id) + "/answers", { answer: value(x, "answer") }); return "نُشر الرد الرسمي وأُشعر السائل."; });
      text(f, `سأل ${q.askedBy} · ${q.answers.length} إجابات من العملاء`, "p", "small muted"); field(f, "الرد", "answer", "textarea", true);
    });
    if (!(data.questions || []).length) text(body, "لا توجد أسئلة معلقة.", "p", "muted");
  }
  function renderGiftcards(data) {
    let issued = "";
    const f = form(body, "إصدار بطاقة هدية", "إصدار", async x => { const r = await client.request("POST", "/admin/gift-cards", { amount: Number(value(x, "amount")), note: value(x, "note") || undefined, email: value(x, "email") || undefined, expiresAt: value(x, "days") ? isoIn(value(x, "days")) : undefined }); issued = r.code; x.reset(); return `أُصدرت البطاقة ${r.code} — تظهر مرة واحدة فقط، انسخها الآن.`; });
    field(f, "القيمة بالدينار", "amount", "number", true); field(f, "ملاحظة", "note"); field(f, "بريد العميل (اختياري، يصله إشعار بالرمز)", "email", "email"); field(f, "الصلاحية بالأيام (اختياري)", "days", "number");
    if (issued) text(body, issued, "p", "pill ok");
    table(body, ["البطاقة", "القيمة", "الرصيد", "الحالة", "إجراء"], (data.giftCards || []).map(g => {
      const tr = node("tr"); cell(tr, `•••• ${g.last4} ${g.note ? "· " + g.note : ""}`); cell(tr, money(g.amount)); cell(tr, money(g.balance)); cell(tr, g.redeemed ? "مستخدمة" : g.active ? "فعالة" : "ملغاة");
      const a = cell(tr, ""); if (g.active && !g.redeemed) a.append(button("إلغاء", () => void run(() => client.request("DELETE", "/admin/gift-cards/" + safeId(g.id))), "tiny danger")); return tr;
    }));
  }
  function renderChats(data) {
    table(body, ["العميل", "الموضوع", "الطلب", "الحالة", "آخر رسالة", "إجراء"], (data.chats || []).map(c => {
      const tr = node("tr"); cell(tr, c.customer); cell(tr, c.subject); cell(tr, c.orderId || "—"); cell(tr, c.status === "human" ? "بانتظار موظف" : c.status === "bot" ? "يرد لُقطي" : "مغلقة"); cell(tr, c.lastMessage?.body || "");
      cell(tr, "").append(button("فتح", () => { openChat = c.id; void run(() => load(), false); })); return tr;
    }));
    if (!openChat) return;
    void client.request("GET", "/admin/chats/" + safeId(openChat)).then(({ chat }) => {
      const panel = node("div", undefined, "panel"); panel.append(node("h3", `${chat.subject} — ${chat.customer}`));
      chat.messages.forEach(m => text(panel, `${m.sender === "user" ? "العميل" : m.sender === "bot" ? "لُقطي" : "الدعم"}: ${m.body}${m.uploadId ? " 📷" : ""}`, "p", m.sender === "user" ? "" : "small muted"));
      const f = form(panel, "رد الموظف", "إرسال", async x => { await client.request("POST", "/admin/chats/" + safeId(chat.id) + "/messages", { message: value(x, "message") }); x.reset(); return "أُرسل الرد وأُشعر العميل."; });
      field(f, "الرسالة", "message", "textarea", true);
      panel.append(button("إغلاق المحادثة", () => void run(() => client.request("PATCH", "/admin/chats/" + safeId(chat.id), { status: "resolved" }))));
      body.append(panel);
    }).catch(error => message(error.message, true));
  }
  function renderFaqs(data) {
    const f = form(body, "سؤال شائع جديد", "إضافة", async x => { await client.request("POST", "/admin/faqs", { category: value(x, "category") || "general", question: value(x, "question"), answer: value(x, "answer"), keywords: value(x, "keywords") }); x.reset(); return "أُضيف إلى مركز المساعدة ويستخدمه لُقطي في الردود."; });
    select(f, "التصنيف", "category", [["delivery", "التوصيل"], ["returns", "الإرجاع"], ["payment", "الدفع"], ["orders", "الطلبات"], ["rewards", "النقاط"], ["account", "الحساب"], ["privacy", "الخصوصية"], ["wallet", "المحفظة"], ["general", "عام"]], "general");
    field(f, "السؤال", "question", "text", true); field(f, "الإجابة", "answer", "textarea", true); field(f, "كلمات مفتاحية", "keywords");
    table(body, ["السؤال", "التصنيف", "مفيد", "الحالة", "إجراء"], (data.faqs || []).map(q => {
      const tr = node("tr"); cell(tr, q.question); cell(tr, q.category); cell(tr, count(q.helpful)); cell(tr, q.active ? "منشور" : "مخفي");
      cell(tr, "").append(button(q.active ? "إخفاء" : "نشر", () => void run(() => client.request("PATCH", "/admin/faqs/" + safeId(q.id), { active: !q.active })))); return tr;
    }));
  }
  function renderBranches(data) {
    const f = form(body, "فرع جديد", "إضافة الفرع", async x => { await client.request("POST", "/admin/branches", { name: value(x, "name"), city: value(x, "city"), address: value(x, "address"), phone: value(x, "phone"), hours: value(x, "hours"), latitude: value(x, "lat") ? Number(value(x, "lat")) : undefined, longitude: value(x, "lng") ? Number(value(x, "lng")) : undefined }); x.reset(); return "أُضيف الفرع."; });
    field(f, "اسم الفرع", "name", "text", true); field(f, "المدينة", "city", "text", true); field(f, "العنوان", "address"); field(f, "الهاتف", "phone"); field(f, "ساعات العمل", "hours"); field(f, "خط العرض", "lat", "number"); field(f, "خط الطول", "lng", "number");
    table(body, ["الفرع", "المدينة", "الأصناف", "القطع", "الحالة", "إجراء"], (data.branches || []).map(b => {
      const tr = node("tr"); cell(tr, b.name); cell(tr, b.city); cell(tr, count(b.skus)); cell(tr, count(b.units)); cell(tr, b.active ? "يعمل" : "مغلق");
      const a = cell(tr, ""); a.append(button("مخزونه", () => { stockBranch = b.id; void run(() => load(), false); })); a.append(button(b.active ? "إغلاق" : "فتح", () => void run(() => client.request("PATCH", "/admin/branches/" + safeId(b.id), { active: !b.active })))); return tr;
    }));
    text(body, stockBranch ? `مخزون الفرع ${stockBranch}` : "مخزون كل الفروع", "h3");
    table(body, ["المنتج", "SKU", "الفرع", "الكمية", "الإصدار", "تعديل"], (data.stock || []).slice(0, 300).map(r => {
      const tr = node("tr"); cell(tr, r.name); cell(tr, r.sku); cell(tr, r.branch); cell(tr, count(r.quantity)); cell(tr, "v" + r.version);
      const input = node("input"); input.type = "number"; input.min = "0"; input.value = r.quantity; input.style.width = "5rem"; input.setAttribute("aria-label", "كمية " + r.name);
      const c = cell(tr, ""); c.append(input, button("حفظ", () => void run(() => client.request("PUT", "/admin/branches/" + safeId(r.branchId) + "/stock", { items: [{ productId: r.productId, quantity: Number(input.value), expectedVersion: r.version }] })))); return tr;
    }));
  }
  function renderZones(data) {
    const f = form(body, "منطقة توصيل جديدة", "إضافة المنطقة", async x => { await client.request("POST", "/admin/zones", { name: value(x, "name"), cities: value(x, "cities").split(/[،,]/).map(s => s.trim()).filter(Boolean), fee: Number(value(x, "fee")), freeOver: value(x, "freeOver") ? Number(value(x, "freeOver")) : null, minOrder: Number(value(x, "minOrder") || 0), etaMinutes: Number(value(x, "eta") || 120) }); x.reset(); return "أُضيفت المنطقة وتُطبق رسومها على الطلبات."; });
    field(f, "اسم المنطقة", "name", "text", true); field(f, "المدن (مفصولة بفاصلة)", "cities", "text", true); field(f, "رسوم التوصيل", "fee", "number", true); field(f, "توصيل مجاني فوق", "freeOver", "number"); field(f, "الحد الأدنى للطلب", "minOrder", "number"); field(f, "المدة بالدقائق", "eta", "number", false, "120");
    table(body, ["المنطقة", "المدن", "الرسوم", "مجاني فوق", "الحد الأدنى", "المدة", "إجراء"], (data.zones || []).map(z => {
      const tr = node("tr"); cell(tr, z.name); cell(tr, z.cities.join("، ")); cell(tr, money(z.fee)); cell(tr, z.freeOver == null ? "—" : money(z.freeOver)); cell(tr, money(z.minOrder)); cell(tr, `${z.etaMinutes} د`);
      const fee = node("input"); fee.type = "number"; fee.step = "0.001"; fee.value = z.fee; fee.style.width = "5rem"; fee.setAttribute("aria-label", "رسوم " + z.name);
      cell(tr, "").append(fee, button("حفظ", () => void run(() => client.request("PATCH", "/admin/zones/" + safeId(z.id), { fee: Number(fee.value) })))); return tr;
    }));
    text(body, "سعة مواعيد التوصيل (7 أيام)", "h3");
    table(body, ["اليوم", "الفترة", "محجوز", "السعة", "تعديل"], (data.slots || []).map(s => {
      const tr = node("tr"); cell(tr, s.date); cell(tr, `${s.label} ${s.from}–${s.to}`); cell(tr, count(s.booked)); cell(tr, count(s.capacity));
      const cap = node("input"); cap.type = "number"; cap.min = String(s.booked); cap.value = s.capacity; cap.style.width = "4.5rem"; cap.setAttribute("aria-label", `سعة ${s.date} ${s.window}`);
      cell(tr, "").append(cap, button("حفظ", () => void run(() => client.request("PUT", "/admin/slots", { date: s.date, window: s.window, capacity: Number(cap.value) })))); return tr;
    }));
  }
  function renderVendors(data) {
    const f = form(body, "بائع (تاجر) جديد", "إضافة", async x => { const r = await client.request("POST", "/admin/vendors", { name: value(x, "name"), commission: Number(value(x, "commission") || 0), description: value(x, "description") || undefined }); if (value(x, "email")) await client.request("POST", "/admin/vendors/" + safeId(r.vendor.id) + "/members", { email: value(x, "email"), role: "owner" }); x.reset(); return "أُضيف البائع ويمكنه إدارة منتجاته من «لوحة التاجر» في التطبيق."; });
    field(f, "الاسم", "name", "text", true); field(f, "العمولة %", "commission", "number", false, "10"); field(f, "الوصف", "description"); field(f, "بريد صاحب المتجر (حساب موجود)", "email", "email");
    table(body, ["البائع", "العمولة", "المنتجات", "الأعضاء", "الحالة", "إجراء"], (data.vendors || []).map(v => {
      const tr = node("tr"); cell(tr, v.name); cell(tr, v.commission + "%"); cell(tr, count(v.products)); cell(tr, v.members.map(m => `${m.name} (${m.role === "owner" ? "مالك" : "موظف"})`).join("، ") || "—"); cell(tr, v.status === "active" ? "نشط" : "موقوف");
      const a = cell(tr, ""); a.append(button(v.status === "active" ? "إيقاف" : "تفعيل", () => void run(() => client.request("PATCH", "/admin/vendors/" + safeId(v.id), { status: v.status === "active" ? "suspended" : "active" }))));
      const email = node("input"); email.type = "email"; email.placeholder = "بريد عضو"; email.style.width = "9rem"; a.append(email, button("إضافة عضو", () => void run(() => client.request("POST", "/admin/vendors/" + safeId(v.id) + "/members", { email: email.value.trim(), role: "staff" })))); return tr;
    }));
  }
  function renderFeatures(data) {
    const tiles = node("div", undefined, "kpis");
    [["الميزات المخططة", count(data.total)], ["مُتحقق بالاختبارات", count(data.verified)], ["اختبارات فاشلة", count(data.failing)], ["آخر تشغيل", data.testedAt ? new Date(data.testedAt).toLocaleString("ar-JO") : "—"]].forEach(([label, v]) => { const tile = node("div", undefined, "kpi"); text(tile, label, "span", "label"); text(tile, v, "span", "value"); tiles.append(tile); });
    body.append(tiles);
    const areas = Object.fromEntries((data.areas || []).map(a => [a.id, a.title]));
    table(body, ["#", "الميزة", "المجال", "الواجهات", "الحالة", "الأدلة"], (data.features || []).map(f => {
      const tr = node("tr"); cell(tr, f.id); cell(tr, f.title); cell(tr, areas[f.area] || f.area);
      // Each surface (server, app, dashboard) shows whether its own tests passed (✓), failed (✕) or are still missing (…).
      cell(tr, f.surfaces.map(s => `${s} ${f.evidence?.[s]?.failed ? "✕" : f.evidence?.[s]?.passed ? "✓" : "…"}`).join(" · "));
      cell(tr, "").append(statusPill(f.status === "verified" ? "verified" : f.status, ["verified"])); cell(tr, f.tests.length ? f.tests.join(" | ") : "—"); return tr;
    }));
    const log = data.log || {};
    text(body, `سجل الاختبارات ${log.summary ? `(${log.summary.passed}/${log.summary.total})` : ""}`, "h3");
    table(body, ["الاختبار", "الملف", "النتيجة"], (log.tests || []).map(x => { const tr = node("tr"); cell(tr, x.name); cell(tr, x.file); cell(tr, x.passed ? "نجح" : "فشل"); return tr; }));
    const f = form(body, "إضافة إلى سجل التطوير", "إضافة", async x => { await client.request("POST", "/admin/devlog", { kind: value(x, "kind") || "note", title: value(x, "title"), body: value(x, "body") || undefined, version: value(x, "version") || undefined }); x.reset(); return "أُضيف إلى سجل التطوير."; });
    select(f, "النوع", "kind", [["feature", "ميزة"], ["fix", "إصلاح"], ["release", "إصدار"], ["test", "اختبار"], ["note", "ملاحظة"]], "feature");
    field(f, "العنوان", "title", "text", true); field(f, "التفاصيل", "body", "textarea"); field(f, "الإصدار", "version");
    table(body, ["التاريخ", "النوع", "العنوان", "بواسطة"], (data.entries || []).map(e => { const tr = node("tr"); cell(tr, e.createdAt.slice(0, 10)); cell(tr, e.kind); cell(tr, `${e.title}${e.version ? " · " + e.version : ""}`); cell(tr, e.author); return tr; }));
  }
  function renderReorder(data) {
    table(body, ["الأولوية", "المنتج", "المخزون", "البيع اليومي", "يكفي (يوم)", "اطلب"], (data.suggestions || []).map(s => {
      const tr = node("tr"); cell(tr, { out: "نفد", high: "عاجل", medium: "قريبًا", ok: "كافٍ" }[s.urgency]); cell(tr, s.name); cell(tr, count(s.stock)); cell(tr, String(s.perDay)); cell(tr, s.daysLeft == null ? "—" : count(s.daysLeft)); cell(tr, count(s.suggestedQuantity)); return tr;
    }));
  }
  function renderExports() {
    text(body, "تنزيل بيانات المتجر بصيغة CSV (تفتح في Excel بالعربية) أو JSON.", "p", "muted");
    const bar = node("div", undefined, "toolbar");
    [["products", "المنتجات"], ["inventory", "المخزون"], ["orders", "الطلبات"], ["customers", "العملاء"], ["branch-stock", "مخزون الفروع"]].forEach(([entity, label]) => {
      bar.append(button(`${label} CSV`, () => void run(() => downloadText("/admin/export/" + entity, { format: "csv" }, `luqta-${entity}.csv`, "text/csv"), false)));
      bar.append(button(`${label} JSON`, () => void run(() => downloadText("/admin/export/" + entity, { format: "json" }, `luqta-${entity}.json`, "application/json"), false)));
    });
    body.append(bar);
  }
  function renderSync(data) {
    const c = data.config || {};
    const tiles = node("div", undefined, "kpis");
    [["لوحة القيادة", c.baseUrl || "غير معدّة"], ["مفتاح API", c.apiKeyConfigured ? "معدّ" : "غير معدّ"], ["مفتاح المشغّل", c.runnerKeyConfigured ? "معدّ" : "غير معدّ"], ["الجسر", c.bridgeId || "—"], ["آخر إيصال", data.lastReceipt ? `${data.lastReceipt.id} · ${data.lastReceipt.status}` : "—"]].forEach(([label, v]) => { const tile = node("div", undefined, "kpi"); text(tile, label, "span", "label"); text(tile, v, "span", "value"); tiles.append(tile); });
    body.append(tiles);
    const bar = node("div", undefined, "toolbar");
    [["تصدير إلى لوحة القيادة", "/admin/sync/export"], ["إرسال لقطة قاعدة البيانات", "/admin/sync/snapshot"], ["تنفيذ العمليات المعلّقة", "/admin/sync/run"]].forEach(([label, path]) => bar.append(button(label, () => void run(async () => { const r = (await client.request("POST", path, {})).receipt; return `${r.id}: ${r.summary}`; }), "tiny primary")));
    bar.append(button("معاينة الاستيراد من لوحة القيادة", () => void run(async () => {
      const r = await client.request("POST", "/admin/sync/pull", {});
      const panel = node("div", undefined, "panel"); panel.append(node("h3", `الفروقات: جديد ${r.preview.summary.new} · تغيّر ${r.preview.summary.changed} · مرفوض ${r.preview.summary.invalid}`));
      table(panel, ["#", "الصنف", "الحالة", "التغييرات"], r.preview.rows.map(row => { const tr = node("tr"); cell(tr, row.row); cell(tr, row.id); cell(tr, row.status); cell(tr, row.error || Object.entries(row.changes || {}).map(([k, [a, b]]) => `${k}: ${a ?? "—"} → ${b}`).join("، ")); return tr; }));
      panel.append(button("تطبيق المقبول", () => void run(async () => { const x = (await client.request("POST", "/admin/sync/pull", { apply: true })).receipt; return `${x.id}: ${x.summary}`; }), "tiny primary"));
      body.prepend(panel); return "راجع الفروقات قبل التطبيق.";
    }, false)));
    body.append(bar);
    if (["env", "options"].includes(c.source)) text(body, "إعداد الاتصال مقفل: يأتي من متغيرات بيئة الخادم (‎.env)، ويُعدّل هناك فقط. المفاتيح لا تُعرض هنا.", "p", "small muted");
    else { const cfg = form(body, "إعداد الاتصال بلوحة القيادة المركزية", "حفظ", async x => { await client.request("PUT", "/admin/sync/config", { baseUrl: value(x, "baseUrl"), apiKey: value(x, "apiKey") || undefined, runnerKey: value(x, "runnerKey") || undefined, bridgeId: value(x, "bridgeId") || undefined }); x.reset(); return "حُفظ الاتصال؛ المفاتيح مشفرة على الخادم."; });
    field(cfg, "العنوان HTTPS", "baseUrl", "url", true, c.baseUrl || "https://amer-ai-command-center.eagerlark64.chatgpt.site"); field(cfg, "X-AAS-API-Key", "apiKey", "password"); field(cfg, "X-AAS-Runner-Key", "runnerKey", "password"); field(cfg, "معرّف الجسر", "bridgeId", "text", false, c.bridgeId || ""); }
    const imp = form(body, "استيراد ملف من النظام المركزي (JSON)", "معاينة واستيراد", async x => {
      let items; try { items = JSON.parse(value(x, "items")); } catch { throw Error("الملف ليس JSON صالحًا: مصفوفة أصناف [{id,name,price|retailPrice,stock|stockQuantity}]"); }
      const r = (await client.request("POST", "/admin/sync/import", { source: value(x, "source") || "ملف خارجي", items: Array.isArray(items) ? items : items.products || items.items })).receipt;
      x.reset(); return `${r.id}: قُبل ${r.imported} ورُفض ${r.rejected}`;
    });
    field(imp, "المصدر", "source", "text", false, "لوحة القيادة المركزية"); field(imp, "الأصناف JSON", "items", "textarea", true);
    text(body, "إيصالات المزامنة", "h3");
    table(body, ["الإيصال", "النوع", "الحالة", "مقبول", "مرفوض", "الملخص", "إجراء"], (data.receipts || []).map(r => {
      const tr = node("tr"); cell(tr, r.id); cell(tr, r.kind); cell(tr, "").append(statusPill(r.status)); cell(tr, count(r.imported)); cell(tr, count(r.rejected)); cell(tr, r.summary);
      const a = cell(tr, ""); a.append(button("تنزيل السجل", () => void run(() => downloadText("/admin/sync/receipts/" + encodeURIComponent(r.id) + "/log", { format: "csv" }, `${r.id}.csv`, "text/csv"), false)));
      if (r.status !== "success" && r.retryable) a.append(button("إعادة المحاولة", () => void run(async () => { const x = (await client.request("POST", "/admin/sync/receipts/" + encodeURIComponent(r.id) + "/retry", {})).receipt; return `${x.id}: ${x.summary}`; }), "tiny primary"));
      return tr;
    }));
  }
  function renderCurrencyRates(data) {
    const rates = data.settings?.displayCurrencies || {};
    const f = form(body, "أسعار عملات العرض (مقابل 1 من عملة المتجر)", "حفظ الأسعار", async x => {
      const next = {}; for (const line of value(x, "rates").split(/\n/)) { const [code, rate] = line.split(/[=:]/).map(s => s.trim()); if (code && rate) next[code.toUpperCase()] = Number(rate); }
      await client.request("PUT", "/admin/currency-rates", { rates: next }); return "حُفظت الأسعار وتظهر للعملاء في التطبيق.";
    });
    field(f, "سطر لكل عملة: USD=1.41", "rates", "textarea", true, Object.entries(rates).map(([k, v]) => `${k}=${v}`).join("\n"));
  }
  const renderers = { overview: renderKpis, products: renderProducts, inventory: renderInventory, offers: renderOffers, appearance: renderAppearance, workspace: renderWorkspace, orders: renderOrders,
    users: renderUsers, coupons: renderCoupons, returns: renderReturns, tickets: renderTickets, settings: (data) => { renderSettings(data); renderCurrencyRates(data); },
    agents: renderAgents, audit: renderAudit, reports: renderReports, categories: renderCategories, flash: renderFlash, campaigns: renderCampaigns, questions: renderQuestions,
    giftcards: renderGiftcards, chats: renderChats, faqs: renderFaqs, branches: renderBranches, zones: renderZones, vendors: renderVendors, features: renderFeatures,
    reorder: renderReorder, exports: renderExports, sync: renderSync };
  const rendererTable = new Map(Object.entries(renderers));
  window.setInterval(() => {
    if (client.connected && document.visibilityState === "visible") void checkLiveBridge();
  }, 90_000);
  draw();
})();
