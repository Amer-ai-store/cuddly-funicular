export class ConnectorError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function allowedOrigins(env) {
  let origins;
  try { origins = JSON.parse(env.AAS_ALLOWED_SERVER_ORIGINS || '[]'); }
  catch { throw new ConnectorError('invalid_server_policy', 'إعداد مصادر الخوادم المسموح بها غير صالح.', 503); }
  if (!Array.isArray(origins) || origins.some(v => typeof v !== 'string')) throw new ConnectorError('invalid_server_policy', 'إعداد مصادر الخوادم المسموح بها غير صالح.', 503);
  return origins;
}

export function healthTarget(server, env) {
  const base = new URL(server.baseUrl);
  if (!server.enabled) throw new ConnectorError('server_disabled', 'هذا الخادم معطّل. فعّله قبل فحص الاتصال.', 409);
  if (base.protocol !== 'https:' || base.username || base.password || !allowedOrigins(env).includes(base.origin)) {
    throw new ConnectorError('origin_not_allowed', 'أضف مصدر هذا الخادم إلى AAS_ALLOWED_SERVER_ORIGINS في إعدادات الخادم أولًا.', 403);
  }
  const url = new URL(server.healthPath, base);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) throw new ConnectorError('invalid_health_path', 'مسار الفحص غير صالح.');
  const headers = { Accept: 'application/json' };
  if (server.tokenEnv) {
    const token = env[server.tokenEnv];
    if (!token || typeof token !== 'string') throw new ConnectorError('server_token_missing', 'متغير مصادقة الخادم غير مهيّأ في إعدادات الاستضافة.', 503);
    headers.Authorization = 'Bearer ' + token;
  }
  return { url: url.href, headers };
}

export async function checkServerHealth(server, env, outgoingFetch = fetch) {
  const target = healthTarget(server, env);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let status = 'offline', lastHttpStatus = null, lastError = null;
  try {
    const response = await outgoingFetch(target.url, { method: 'GET', headers: target.headers, redirect: 'manual', signal: controller.signal });
    lastHttpStatus = response.status;
    status = response.ok ? 'online' : 'offline';
    if (!response.ok) lastError = response.status >= 300 && response.status < 400 ? 'الخادم أعاد توجيهًا؛ إعادة التوجيه غير مسموح بها.' : 'استجاب الخادم بحالة HTTP ' + response.status;
    await response.body?.cancel();
  } catch (error) {
    lastError = error.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم.' : 'تعذر الوصول إلى الخادم. راجع عنوانه ومصادقته.';
  } finally { clearTimeout(timer); }
  return { id: server.id, status, lastCheckedAt: new Date().toISOString(), lastHttpStatus, latencyMs: Date.now() - started, lastError };
}
