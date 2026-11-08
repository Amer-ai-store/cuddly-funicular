/* Luqta commerce API client. Admin credentials and session token remain in memory. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LuqtaAPI = api;
})(typeof window === "object" ? window : undefined, function () {
  "use strict";

  function validateOrigin(value) {
    let url;
    try { url = new URL(String(value || "").trim()); }
    catch { throw new Error("أدخل عنوان خادم المتجر كاملًا."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("الخادم العام يجب أن يستخدم HTTPS.");
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("أدخل أصل الخادم فقط، دون مسار أو بيانات دخول.");
    return url.origin;
  }

  function createClient(fetchImpl) {
    const fetcher = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!fetcher) throw new Error("المتصفح لا يدعم الاتصال بالخادم.");
    let origin = "";
    let token = "";
    let user = null;

    async function request(method, path, body, options) {
      if (!origin) throw new Error("اتصل بخادم المتجر أولًا.");
      if (!/^\/[a-z0-9/_-]+$/i.test(path) || path.includes("//")) throw new Error("مسار API غير صالح.");
      const query = options && options.query ? new URLSearchParams(Object.entries(options.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString() : "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetcher(origin + "/api" + path + (query ? "?" + query : ""), {
          method, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
          headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...((options && options.bearer) || token ? { Authorization: "Bearer " + ((options && options.bearer) || token) } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (options && options.raw) {
          const textBody = await response.text();
          if (!response.ok) { let reason = textBody; try { reason = JSON.parse(textBody).error || textBody; } catch { /* plain text */ } throw new Error(reason || "فشل طلب الخادم (" + response.status + ")."); }
          return textBody;
        }
        let result;
        try { result = await response.json(); }
        catch { throw new Error("استجابة الخادم ليست JSON صالحًا."); }
        if (!response.ok) {
          if (response.status === 401 && !(options && options.ignoreAuthFailure)) { token = ""; user = null; }
          throw new Error(result.error || result.message || "فشل طلب الخادم (" + response.status + ").");
        }
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new Error("انتهت مهلة الاتصال بالخادم.");
        throw error;
      } finally { clearTimeout(timeout); }
    }

    async function login(serverUrl, email, password) {
      token = ""; user = null;
      origin = validateOrigin(serverUrl);
      const health = await request("GET", "/health");
      if (!health || health.ok !== true || health.service !== "luqta-commerce") throw new Error("العنوان لا يخص خادم متجر لُقطة.");
      const result = await request("POST", "/auth/login", { email, password });
      if (!result || !result.token || result.user?.role !== "admin") throw new Error("يلزم حساب مدير متجر لُقطة.");
      await request("GET", "/admin/overview", undefined, { bearer: result.token });
      token = result.token;
      user = result.user;
      return { origin, user, currency: health.currency };
    }

    async function logout() {
      try { if (token) await request("POST", "/auth/logout"); }
      finally { token = ""; user = null; origin = ""; }
    }

    return {
      login, logout,
      request: (method, path, body, query) => request(method, path, body, query ? { query } : undefined),
      download: (path, query) => request("GET", path, undefined, { raw: true, query }),
      get connected() { return !!token && !!user; },
      get user() { return user; },
      get origin() { return origin; },
    };
  }
  return { validateOrigin, createClient };
});
