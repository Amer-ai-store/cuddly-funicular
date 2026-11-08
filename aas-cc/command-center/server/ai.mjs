/** Real Gemini text and image analysis. Provider secrets remain on this server. */
const MAX_PROMPT = 12000;
const MAX_IMAGE_BASE64 = 512 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const INPUT_FIELDS = new Set(['prompt', 'model', 'imageBase64', 'mimeType']);

export class AiProxyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function invalid(code, message) { throw new AiProxyError(422, code, message); }
function unavailable() {
  throw new AiProxyError(503, 'provider_not_configured', 'مزود الذكاء الاصطناعي غير مهيّأ. يلزم ضبط مفتاح Gemini والنموذج المسموح على الخادم.');
}
function timedOut() { return new AiProxyError(504, 'provider_timeout', 'انتهت مهلة مزود الذكاء الاصطناعي. لم يُستلم رد مكتمل.'); }
function invalidResponse() { return new AiProxyError(502, 'provider_invalid_response', 'تعذّر قراءة رد صالح من مزود الذكاء الاصطناعي.'); }
function noResult() { return new AiProxyError(502, 'model_no_result', 'لم يُرجع النموذج نتيجة نصية مكتملة ومسموحًا بعرضها.'); }
function providerFailure(status) {
  if (status === 429) return new AiProxyError(429, 'provider_quota_exceeded', 'بلغ الطلب حد المعدل أو الحصة لدى Gemini. راجع حصة المشروع والفوترة، ثم أعد المحاولة لاحقًا.');
  if (status === 401 || status === 403) return new AiProxyError(502, 'provider_access_denied', 'رفض Gemini صلاحية الوصول. راجع صلاحيات المفتاح وقيوده وإتاحة الخدمة للمشروع.');
  if (status === 404) return new AiProxyError(502, 'provider_model_unavailable', 'النموذج المحدد غير متاح لهذا الطلب. أعد جلب النماذج من المفتاح المحفوظ واختر نموذج محادثة متاحًا.');
  if (status === 400) return new AiProxyError(502, 'provider_request_invalid', 'رفض Gemini إعدادات الطلب. راجع صلاحية المفتاح ودعم النموذج المحدد للرد بصيغة JSON.');
  return new AiProxyError(502, 'provider_request_failed', 'رفض مزود الذكاء الاصطناعي الطلب. راجع حالة الخدمة وإعدادات المفتاح والنموذج.');
}

function requestParts(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid('invalid_request', 'بيانات طلب الذكاء الاصطناعي غير صالحة.');
  if (Object.keys(payload).some((key) => !INPUT_FIELDS.has(key))) invalid('unsupported_options', 'يتضمن الطلب خيارات غير مدعومة في خدمة التحليل الحالية.');
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > MAX_PROMPT) invalid('invalid_prompt', 'أدخل طلبًا نصيًا غير فارغ، بحد أقصى 12000 حرف.');
  const parts = [{ text: payload.prompt.trim() }];
  if (payload.imageBase64 != null) {
    const encoded = payload.imageBase64;
    if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_IMAGE_BASE64 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalid('invalid_image', 'الصورة يجب أن تكون Base64 صالحًا، بحد أقصى 512 كيلوبايت للنص المشفّر.');
    try {
      if (btoa(atob(encoded)) !== encoded) invalid('invalid_image', 'ترميز الصورة غير صالح.');
    } catch (error) {
      if (error instanceof AiProxyError) throw error;
      invalid('invalid_image', 'ترميز الصورة غير صالح.');
    }
    if (!MIME_TYPES.has(payload.mimeType)) invalid('invalid_image_type', 'تحليل الصور يدعم JPEG وPNG وWebP فقط.');
    parts.push({ inlineData: { mimeType: payload.mimeType, data: encoded } });
  } else if (payload.mimeType != null) invalid('invalid_image', 'نوع الصورة يحتاج إلى بيانات صورة في الطلب.');
  return parts;
}

function providerConfiguration(payload, env) {
  const key = env?.GEMINI_API_KEY;
  if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) unavailable();
  const configured = env.GEMINI_MODEL;
  let defaultModel;
  if (configured != null && configured !== '') {
    if (typeof configured !== 'string' || !MODEL_NAME.test(configured.trim())) unavailable();
    defaultModel = configured.trim();
  }
  let entries = [];
  if (env.GEMINI_ALLOWED_MODELS != null && env.GEMINI_ALLOWED_MODELS !== '') {
    try {
      entries = typeof env.GEMINI_ALLOWED_MODELS === 'string' ? JSON.parse(env.GEMINI_ALLOWED_MODELS) : env.GEMINI_ALLOWED_MODELS;
    } catch { unavailable(); }
    if (!Array.isArray(entries) || entries.length > 50 || entries.some((entry) => typeof entry !== 'string' || !MODEL_NAME.test(entry))) unavailable();
  }
  const allowed = new Set(defaultModel ? [...entries, defaultModel] : entries);
  if (!allowed.size) unavailable();
  let model = defaultModel;
  if (payload.model != null) {
    if (typeof payload.model !== 'string' || !MODEL_NAME.test(payload.model)) invalid('invalid_model', 'اسم النموذج المطلوب غير صالح.');
    if (!allowed.has(payload.model)) invalid('model_not_allowed', 'النموذج المطلوب غير مهيّأ أو غير مسموح على هذا الخادم.');
    model = payload.model;
  }
  if (!model) invalid('model_required', 'حدّد نموذجًا من القائمة المسموح بها، أو اضبط النموذج الافتراضي على الخادم.');
  return { key: key.trim(), model };
}

async function providerJson(response, signal) {
  const declared = response.headers.get('Content-Length');
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
    response.body?.cancel().catch(() => {});
    throw invalidResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const chunks = [];
  let size = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw timedOut();
      const { value, done } = await reader.read();
      if (signal.aborted) throw timedOut();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { cancel(); throw invalidResponse(); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', cancel); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalidResponse(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidResponse();
  return data;
}

function resultContent(data) {
  if (data.promptFeedback?.blockReason) throw noResult();
  if (!Array.isArray(data.candidates)) throw noResult();
  const candidate = data.candidates?.[0];
  if (!candidate || (candidate.finishReason != null && candidate.finishReason !== 'STOP')) throw noResult();
  if (Array.isArray(candidate.safetyRatings) && candidate.safetyRatings.some((rating) => rating?.blocked === true)) throw noResult();
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts)) throw noResult();
  const content = parts.filter((part) => part && part.thought !== true && typeof part.text === 'string').map((part) => part.text.trim()).filter(Boolean).join('\n');
  if (!content) throw noResult();
  return content;
}

export async function generateAi(payload, env, outgoingFetch = fetch, { responseJson = false } = {}) {
  const parts = requestParts(payload);
  const { key, model } = providerConfiguration(payload, env);
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(timedOut()); }, TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      const response = await outgoingFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 4096, ...(responseJson ? { responseMimeType: 'application/json' } : {}) } }),
      });
      if (!response.ok) {
        response.body?.cancel().catch(() => {});
        throw providerFailure(response.status);
      }
      const data = await providerJson(response, controller.signal);
      return { content: resultContent(data), model };
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (error instanceof AiProxyError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') throw timedOut();
    throw new AiProxyError(502, 'provider_unavailable', 'تعذّر الاتصال بمزود الذكاء الاصطناعي. لم تُولّد نتيجة.');
  } finally { clearTimeout(timeout); }
}
