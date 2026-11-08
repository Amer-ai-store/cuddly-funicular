/* Verified public GitHub Actions activity. This cannot observe ChatGPT reasoning, private agents, or SQL activity. */
(() => {
  "use strict";
  const ROOT = document.getElementById("execution-evidence");
  if (!ROOT) return;
  const repository = "Amer-ai-store/Mohammad-Ahmed-Ghannam";
  const endpoint = "https://api.github.com/repos/" + repository + "/actions/runs?per_page=25";
  const pollMilliseconds = 5 * 60 * 1000;
  const staleMilliseconds = 30 * 60 * 1000;
  const staleCheckMilliseconds = 15 * 60 * 1000;
  const state = ROOT.querySelector("#execution-evidence-state");
  const checked = ROOT.querySelector("#execution-evidence-checked");
  const list = ROOT.querySelector("#execution-evidence-rows");
  const refresh = ROOT.querySelector("#execution-evidence-refresh");
  const stat = id => ROOT.querySelector("#" + id);
  if (!state || !checked || !list || !refresh) return;
  let fetching = false;
  let lastFetchedAt = 0;
  let lastAttemptAt = 0;

  const dateFormatter = new Intl.DateTimeFormat("ar-JO", {
    timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short"
  });
  function timestamp(raw) {
    const time = Date.parse(String(raw || ""));
    return Number.isFinite(time) ? time : 0;
  }
  function clock(ms) {
    return ms ? dateFormatter.format(new Date(ms)) : "غير متوفر";
  }
  function classify(run, now = Date.now()) {
    const age = now - timestamp(run.updated_at || run.run_started_at || run.created_at);
    if (run.status === "in_progress") return age > staleMilliseconds || age < -300000 ? "stale" : "active";
    if (["queued", "waiting", "requested", "pending"].includes(run.status)) {
      return age > staleMilliseconds || age < -300000 ? "stale" : "pending";
    }
    if (run.status === "completed") {
      if (run.conclusion === "success") return "success";
      if (run.conclusion === "failure" || run.conclusion === "timed_out" ||
          run.conclusion === "action_required") return "failed";
      return "ended";
    }
    return "unknown";
  }
  function make(tag, label, className = "") {
    const element = document.createElement(tag);
    if (label !== undefined && label !== null) element.textContent = String(label);
    if (className) element.className = className;
    return element;
  }
  function mark(kind, label) {
    state.dataset.state = kind;
    state.textContent = label;
  }
  const captions = {
    active:"قيد التشغيل", pending:"بانتظار التشغيل", stale:"مبلّغ عنه كنشط لكن آخر تحديث قديم",
    success:"نجح", failed:"فشل", ended:"انتهى دون نجاح مثبت", unknown:"حالة غير معروفة"
  };
  function safeRunUrl(run) {
    const url = String(run.html_url || "");
    const prefix = "https://github.com/" + repository + "/actions/runs/";
    return url.startsWith(prefix) && /^\d+(?:\/attempts\/\d+)?$/.test(url.slice(prefix.length)) ? url : null;
  }
  function render(runs) {
    const now = Date.now();
    const kinds = runs.map(run => classify(run, now));
    const active = kinds.filter(x => x === "active").length;
    const pending = kinds.filter(x => x === "pending").length;
    const failed = kinds.filter(x => x === "failed").length;
    const uncertain = kinds.filter(x => x === "stale").length;
    stat("execution-evidence-active").textContent = String(active);
    stat("execution-evidence-pending").textContent = String(pending);
    stat("execution-evidence-failed").textContent = String(failed);
    stat("execution-evidence-checked-runs").textContent = String(runs.length);
    if (active > 0) mark("active", "أثبت GitHub وجود " + active + " عملية قيد التشغيل");
    else if (pending > 0) mark("loading", "توجد " + pending + " عملية تنتظر التشغيل في GitHub");
    else if (uncertain > 0) mark("stale", uncertain + " عملية مبلغ عنها كنشطة لكن آخر تحديثها قديم؛ تحتاج تحققًا");
    else mark("idle", "لا توجد عملية نشطة مثبتة في آخر " + runs.length + " تشغيلًا على GitHub");
    list.replaceChildren();
    const recent = runs.slice(0,10);
    if (!recent.length) {
      list.append(make("p", "لا يحتوي المصدر على تشغيلات يمكن التحقق منها.", "small muted"));
      return;
    }
    recent.forEach((run, index) => {
      const row = make("div", null, "execution-evidence__row");
      const first = make("div");
      first.append(make("strong", String(run.name || "تدفق عمل غير مسمى").slice(0,140)));
      first.append(make("small", "الفرع: " + String(run.head_branch || "غير محدد").slice(0,80) +
        " · آخر تحديث: " + clock(timestamp(run.updated_at))));
      const label = make("span", captions[kinds[index]] || captions.unknown,"execution-evidence__tag");
      label.dataset.state = kinds[index];
      const destination = safeRunUrl(run);
      const evidence = destination ? make("a","فتح دليل التنفيذ #" + String(run.run_number || run.id).slice(0,35)) :
        make("small", "لا يوجد رابط دليل معتمد");
      if (destination) {
        evidence.href = destination;
        evidence.target = "_blank";
        evidence.rel = "noopener noreferrer";
      }
      row.append(first,label,evidence);
      list.append(row);
    });
  }
  function clearNumbers() {
    for (const id of ["execution-evidence-active","execution-evidence-pending",
      "execution-evidence-failed","execution-evidence-checked-runs"]) stat(id).textContent = "—";
    list.replaceChildren();
  }
  async function update(force = false) {
    if (fetching || document.hidden) return;
    if (!force && Date.now() - lastAttemptAt < pollMilliseconds) return;
    fetching = true;
    lastAttemptAt = Date.now();
    refresh.disabled = true;
    if (!lastFetchedAt) mark("loading", "جارٍ جلب دليل التشغيل الفعلي من GitHub…");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, {
        method:"GET", headers:{Accept:"application/vnd.github+json"},
        cache:"no-store", redirect:"error", signal:controller.signal
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid GitHub response");
      lastFetchedAt = Date.now();
      checked.textContent = "مصدر الدليل: GitHub Actions · آخر جلب مؤكد " + clock(lastFetchedAt) + " بتوقيت الأردن";
      render(data.workflow_runs.slice(0,25));
    } catch {
      lastFetchedAt = 0;
      mark("error", "تعذر التحقق من التشغيل؛ الحالة غير معروفة");
      checked.textContent = "فشل الاتصال بالمصدر. لا نحتفظ بحالة سابقة باعتبارها حية.";
      clearNumbers();
      list.append(make("p","أعد فحص GitHub يدويًا. عدم الوصول للمصدر ليس دليلًا على توقف العمل أو استمراره.","small muted"));
    } finally {
      window.clearTimeout(timeout);
      fetching = false;
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", () => { void update(true); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (lastFetchedAt && Date.now() - lastFetchedAt > staleCheckMilliseconds)
        mark("stale","تجاوز آخر دليل التشغيل 15 دقيقة؛ يلزم تحديثه");
      void update(true);
    }
  });
  window.setInterval(() => {
    if (document.hidden) return;
    if (lastFetchedAt && Date.now() - lastFetchedAt > staleCheckMilliseconds)
      mark("stale","تجاوز آخر دليل التشغيل 15 دقيقة؛ يلزم تحديثه");
    void update();
  }, pollMilliseconds);
  void update(true);
})();
