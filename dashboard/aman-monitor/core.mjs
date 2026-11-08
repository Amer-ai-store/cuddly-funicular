export const EVENT_LIMIT = 150;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_JSON_BYTES = 1024 * 1024;
const EVENT_TYPES = new Set(['login_success', 'login_failed', 'logout', 'http_request', 'process']);

export function validateBaseUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/u.test(value.trim()) || /[?#]/u.test(value)) throw new Error('أدخل عنوانًا كاملاً دون معاملات أو جزء بعد # أو مسافات.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('عنوان الخدمة غير صالح. مثال: https://monitor.example.org/security'); }
  if (url.username || url.password) throw new Error('لا تُضمّن بيانات الدخول في عنوان الخدمة.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase()))) throw new Error('يلزم HTTPS. يُقبل HTTP فقط على localhost أو 127.0.0.1 للتطوير المحلي.');
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
  return {base: url.href.replace(/\/$/u, ''), loopback};
}

export function endpointUrl(base, route, ip) {
  if (!['events', 'geo', 'collector-key', 'collector-key/status', 'collector-key/revoke'].includes(route)) throw new Error('Unknown API route');
  const validated = validateBaseUrl(base);
  const url = new URL(validated.base);
  url.pathname = url.pathname.replace(/\/+$/u, '') + '/api/' + route;
  if (route === 'geo') url.searchParams.set('ip', ip);
  return url.href;
}

export function validateReadToken(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{8,4096}$/u.test(value)) throw new Error('رمز القراءة مطلوب، ويجب ألا يحتوي مسافات أو أسطرًا جديدة.');
  return value;
}

function text(value, name, max, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('حقل غير صالح في السجلات: ' + name);
  return value.trim();
}

function timestamp(value, name, now) {
  const raw = text(value, name, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(raw);
  if (!match) throw new Error('يلزم وقت ISO مع منطقة زمنية في ' + name);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || (match[8] !== 'Z' && (Number(match[10]) > 23 || Number(match[11]) > 59))) throw new Error('تاريخ أو وقت غير موجود في ' + name);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60 * 1000) throw new Error('وقت غير صالح أو مستقبلي في ' + name);
  return new Date(parsed).toISOString();
}

function ipAddress(value) {
  if (value === null || value === undefined || value === '') return null;
  const ip = text(value, 'ip', 45);
  if (/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/u.test(ip) && ip.split('.').every(part => Number(part) <= 255)) return ip;
  if (/^[a-f\d:.]+$/iu.test(ip) && ip.includes(':')) {
    try { return new URL('http://[' + ip + ']/').hostname.slice(1, -1); } catch { /* Reject below. */ }
  }
  throw new Error('عنوان IP غير صالح في الملف أو استجابة الخدمة.');
}

export function normalizeSnapshot(value, {imported = false, now = Date.now()} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.events) || value.events.length > 2000) throw new Error('توقّع كائن JSON يحتوي events بحد أقصى ٢٠٠٠ حدث.');
  if ((!imported || value.sources !== undefined) && (!Array.isArray(value.sources) || value.sources.length > 100)) throw new Error('يلزم مصفوفة sources بحد أقصى ١٠٠ مصدر.');
  const cutoff = now - RETENTION_MS;
  let expired = 0;
  const ids = new Set();
  const events = value.events.map(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event) || !EVENT_TYPES.has(event.type)) throw new Error('نوع الحدث غير صالح.');
    const id = text(event.id, 'id', 120);
    const source_id = text(event.source_id, 'source_id', 100);
    const occurred_at = timestamp(event.occurred_at, 'occurred_at', now);
    const actor = text(event.actor, 'actor', 128, true);
    const session_id = text(event.session_id, 'session_id', 160, true);
    const action = text(event.action, 'action', 500, true);
    if (event.metadata !== undefined && (event.metadata === null || typeof event.metadata !== 'object' || Array.isArray(event.metadata))) throw new Error('metadata يجب أن يكون كائنًا.');
    const service = text(event.metadata?.service, 'metadata.service', 40, true);
    const metadata = service ? {service} : {};
    if (event.metadata?.source_occurred_at !== undefined) metadata.source_occurred_at = timestamp(event.metadata.source_occurred_at, 'metadata.source_occurred_at', Infinity);
    if (event.metadata?.received_at !== undefined) metadata.received_at = timestamp(event.metadata.received_at, 'metadata.received_at', now);
    if (event.metadata?.source_record_id !== undefined) metadata.source_record_id = text(event.metadata.source_record_id, 'metadata.source_record_id', 32);
    if (event.metadata?.clock_offset_seconds !== undefined) {
      const offset = event.metadata.clock_offset_seconds;
      if (typeof offset !== 'number' || !Number.isFinite(offset) || Math.abs(offset) > 86400) throw new Error('تصحيح ساعة المصدر خارج المجال المسموح.');
      metadata.clock_offset_seconds = offset;
    }
    const ip = ipAddress(event.ip);
    if (Date.parse(occurred_at) < cutoff) { expired++; return null; }
    const key = source_id + '\u0000' + id;
    if (ids.has(key)) return null;
    ids.add(key);
    return {id, source_id, occurred_at, type: event.type, actor, session_id, action, ip, metadata};
  }).filter(Boolean).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  let sources;
  if (value.sources !== undefined) {
    const sourceIds = new Set();
    sources = value.sources.map(source => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('المصدر غير صالح.');
      const source_id = text(source.source_id, 'source_id', 100);
      const last_seen = timestamp(source.last_seen, 'last_seen', now);
      if (Date.parse(last_seen) < cutoff || sourceIds.has(source_id)) return null;
      sourceIds.add(source_id);
      return {source_id, last_seen};
    }).filter(Boolean);
  } else {
    const bySource = new Map();
    events.forEach(event => { if (!bySource.has(event.source_id)) bySource.set(event.source_id, {source_id: event.source_id, last_seen: event.occurred_at}); });
    sources = [...bySource.values()].slice(0, 100);
  }
  return {events: events.slice(0, EVENT_LIMIT), sources, expired, truncated: events.length > EVENT_LIMIT || value.truncated === true};
}

export function sessionEvents(events, selected) {
  return (selected.session_id ? events.filter(event => event.source_id === selected.source_id && event.session_id === selected.session_id) : [selected])
    .slice().sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
}

export async function readLimitedJson(response) {
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_JSON_BYTES) throw new Error('استجابة الخدمة أكبر من الحد المسموح.');
  if (!response.body) throw new Error('استجابة الخدمة فارغة.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('استجابة الخدمة أكبر من الحد المسموح.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new Error('الخدمة لم تُرجع JSON صالحًا. راجع عنوانها وإعداد CORS.'); }
}
