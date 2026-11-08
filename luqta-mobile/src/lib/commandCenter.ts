export const COMMAND_CENTER_ORIGIN = 'https://amer-ai-command-center.eagerlark64.chatgpt.site';

export type CommandCenterConfig = {
  baseUrl: string;
  apiToken: string;
  siteAccessToken: string;
  automaticSync: false;
};

type Product = { id: string; name: string; category?: string; price: number; stock: number; image?: string; brand?: string };
type Order = { id: string; createdAt?: string; date?: string; status: string; items: { productId: string; name: string; price: number; quantity: number }[] };

export function parseCommandCenterConfig(raw: string): CommandCenterConfig {
  if (raw.length > 16_384) throw new Error('ملف الاتصال أكبر من المتوقع.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('ملف الاتصال ليس JSON صالحًا.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('صيغة ملف الاتصال غير صالحة.');
  const value = parsed as Record<string, unknown>;
  let origin: string;
  try { origin = new URL(String(value.baseUrl)).origin; } catch { throw new Error('عنوان لوحة القيادة غير صالح.'); }
  if (origin !== COMMAND_CENTER_ORIGIN || ![COMMAND_CENTER_ORIGIN, `${COMMAND_CENTER_ORIGIN}/`].includes(value.baseUrl as string)) {
    throw new Error('ملف الاتصال ليس للوحة القيادة المعتمدة لهذا التطبيق.');
  }
  if (typeof value.apiToken !== 'string' || value.apiToken.length < 12 || typeof value.siteAccessToken !== 'string' || value.siteAccessToken.length < 12 || /[\r\n]/.test(value.apiToken + value.siteAccessToken)) {
    throw new Error('بيانات المصادقة في الملف غير مكتملة.');
  }
  if (value.automaticSync !== false) throw new Error('المزامنة التلقائية يجب أن تكون معطلة في ملف الاتصال.');
  return { baseUrl: `${origin}/`, apiToken: value.apiToken, siteAccessToken: value.siteAccessToken, automaticSync: false };
}

function productNumber(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return ((hash >>> 0) % 2147483647) + 1;
}

export function buildCommandCenterSnapshot(products: Product[], orders: Order[], deviceId: string, appVersion: string, storeName = 'لُقطة') {
  if (products.length > 1000) throw new Error('تجاوز عدد الأصناف حد المزامنة (1000).');
  const ids = new Set<number>();
  const outputProducts = products.map((product) => {
    const id = productNumber(product.id);
    if (ids.has(id)) throw new Error('تعارض معرفات الأصناف في مركز القيادة؛ تعذرت المزامنة بأمان.');
    ids.add(id);
    if (!Number.isFinite(product.price) || product.price < 0 || !Number.isInteger(product.stock) || product.stock < 0) throw new Error('أحد الأصناف يملك سعرًا أو كمية غير صالحة.');
    return {
      id, name: product.name.slice(0, 160), category: (product.category || 'عام').slice(0, 160),
      retailPrice: product.price, wholesalePrice: 0,
      imageUrl: typeof product.image === 'string' && product.image.startsWith('https://') ? product.image : '',
      stockQuantity: product.stock, merchantName: (product.brand || storeName).slice(0, 160),
    };
  });
  const outputOrders = orders.flatMap((order) => order.items.map((item, index) => {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(item.price) || item.price < 0) throw new Error('أحد أسطر الطلبات غير صالح.');
    const candidateId = `${order.id}_${index + 1}`;
    const id = /^[A-Za-z0-9_-]{1,100}$/.test(candidateId) ? candidateId : `line_${productNumber(candidateId)}`;
    return { id, productId: productNumber(item.productId), productName: item.name.slice(0, 160), quantity,
      totalPrice: Math.round(item.price * quantity * 1000) / 1000, status: order.status.slice(0, 80),
      createdAt: order.createdAt || order.date || new Date().toISOString() };
  }));
  if (outputOrders.length > 1000 || new Set(outputOrders.map((order) => order.id)).size !== outputOrders.length) {
    throw new Error('تجاوزت الطلبات حد المزامنة أو تكرر معرف أحدها.');
  }
  const snapshot = { deviceId, appVersion, products: outputProducts, orders: outputOrders };
  if (JSON.stringify(snapshot).length > 1_500_000) throw new Error('حجم اللقطة أكبر من حد الخادم.');
  return snapshot;
}

async function commandRequest(config: CommandCenterConfig, path: string, body?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${COMMAND_CENTER_ORIGIN}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { Accept: 'application/json', 'X-AAS-API-Key': config.apiToken,
        'OAI-Sites-Authorization': `Bearer ${config.siteAccessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'رفضت لوحة القيادة بيانات الوصول؛ نزّل ملف اتصال جديدًا من حساب المالك.'
      : `لوحة القيادة أعادت حالة ${response.status}.`);
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('انتهت مهلة الاتصال بلوحة القيادة.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function testCommandCenter(config: CommandCenterConfig) {
  const result = await commandRequest(config, '/health');
  if (result.status !== 'ok' || result.storage !== 'D1') throw new Error('استجابة لوحة القيادة لا تطابق العقد المتوقع.');
  return result;
}

export async function syncCommandCenter(config: CommandCenterConfig, snapshot: ReturnType<typeof buildCommandCenterSnapshot>) {
  const result = await commandRequest(config, '/app/sync', snapshot);
  if (typeof result.receivedAt !== 'string' || result.productsAccepted !== snapshot.products.length || result.ordersAccepted !== snapshot.orders.length || !Number.isInteger(result.revision)) {
    throw new Error('لم تُعد لوحة القيادة إيصال مزامنة مطابقًا.');
  }
  return result as { revision: number; receivedAt: string; productsAccepted: number; ordersAccepted: number };
}
