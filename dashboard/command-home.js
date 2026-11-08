/* Home layout preferences are UI-only and remain local to this browser.
   Live integration is established exclusively through the authenticated Luqta client. */
(() => {
  "use strict";
  const home = document.querySelector('section[data-view="home"].command-home');
  const zoneGrid = document.getElementById("command-zones");
  if (!home || !zoneGrid) return;
  const storageKey = "jawafa-command-home-layout-v1";
  const firstOrder = Array.from(zoneGrid.querySelectorAll("[data-zone]")).map(item => item.dataset.zone);
  const density = document.getElementById("home-density");
  const edit = document.getElementById("home-layout-edit");
  const reset = document.getElementById("home-layout-reset");
  const note = document.getElementById("home-layout-message");
  const state = document.getElementById("home-luqta-bridge-state");
  const detail = document.getElementById("home-luqta-bridge-detail");

  function readPreference() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (!parsed || typeof parsed !== "object") return {};
      return parsed;
    } catch { return {}; }
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        order: Array.from(zoneGrid.querySelectorAll("[data-zone]")).map(zone => zone.dataset.zone),
        density: home.dataset.density
      }));
      note.textContent = "حُفظ ترتيب العرض على هذا المتصفح فقط. إعدادات التطبيق تحفظ في خادمه المصادق عليه.";
    } catch {
      note.textContent = "لم يمكن حفظ تفضيلات العرض محليًا. لا يؤثر ذلك على بيانات التطبيق.";
    }
  }
  function buttons() {
    const cards = Array.from(zoneGrid.children).filter(child => child.hasAttribute("data-zone"));
    cards.forEach((card, index) => {
      const up = card.querySelector('[data-zone-move="up"]');
      const down = card.querySelector('[data-zone-move="down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === cards.length - 1;
    });
  }
  function setOrder(order) {
    const names = Array.isArray(order) ? order.filter(x => typeof x === "string") : [];
    const map = new Map(Array.from(zoneGrid.querySelectorAll("[data-zone]")).map(card => [card.dataset.zone, card]));
    for (const key of [...new Set([...names, ...firstOrder])]) {
      const card = map.get(key);
      if (card) zoneGrid.append(card);
    }
    buttons();
  }
  const prefs = readPreference();
  setOrder(prefs.order);
  home.dataset.density = prefs.density === "compact" ? "compact" : "comfortable";
  density.value = home.dataset.density;
  density.addEventListener("change", () => {
    home.dataset.density = density.value === "compact" ? "compact" : "comfortable";
    persist();
  });
  edit.addEventListener("click", () => {
    const enabled = home.dataset.editLayout !== "true";
    home.dataset.editLayout = String(enabled);
    edit.setAttribute("aria-pressed", String(enabled));
    edit.textContent = enabled ? "إنهاء ترتيب الأقسام" : "إعادة ترتيب الأقسام";
    note.textContent = enabled ? "استخدم السهمين في كل بطاقة لتحريكها؛ ترتيب الصفحة فقط يتغير." : "أُغلق وضع ترتيب البطاقات.";
    buttons();
  });
  reset.addEventListener("click", () => {
    setOrder(firstOrder);
    home.dataset.density = "comfortable";
    density.value = "comfortable";
    persist();
  });
  zoneGrid.addEventListener("click", event => {
    const move = event.target.closest("button[data-zone-move]");
    if (!move || home.dataset.editLayout !== "true") return;
    const card = move.closest("[data-zone]");
    if (!card) return;
    if (move.dataset.zoneMove === "up" && card.previousElementSibling) {
      zoneGrid.insertBefore(card, card.previousElementSibling);
    } else if (move.dataset.zoneMove === "down" && card.nextElementSibling) {
      zoneGrid.insertBefore(card.nextElementSibling, card);
    }
    buttons();
    persist();
    card.querySelector('[data-zone-move="' + move.dataset.zoneMove + '"]')?.focus();
  });

  // The control board does not infer reachability from stored metadata or published HTML.
  window.addEventListener("luqta:bridge-state", event => {
    const result = event.detail || {};
    if (result.connected === true && result.healthVerified === true) {
      state.dataset.state = "connected";
      state.textContent = "اتصال API مؤكد في هذه الجلسة";
      const checked = result.checkedAt ? new Date(result.checkedAt).toLocaleTimeString("ar-JO") : "الآن";
      detail.textContent = "خادم لُقطة استجاب لفحص الصحة عند " + checked
        + ". جسر قاعدة جوافة: " + (result.jawafaVerified === true ? "قراءة موثقة" : "لم يُتحقق منه في هذه الجلسة")
        + ". لا يعني الاتصال اعتماد الكميات الفعلية.";
    } else {
      state.dataset.state = "disconnected";
      state.textContent = result.connected === true ? "جلسة المدير موجودة؛ فحص API غير مكتمل" : "بحاجة إلى اتصال المدير";
      detail.textContent = String(result.reason || "يتطلب الربط تسجيل دخول المدير إلى خادم لُقطة عبر HTTPS. لا تُخزن بيانات الدخول على هذه الصفحة.").slice(0,240);
    }
  });
})();
