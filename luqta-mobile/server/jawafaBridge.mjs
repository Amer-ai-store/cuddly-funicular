/**
 * Live Jawafa_DB visibility through the *local* forensic read-only bridge.
 * No direct SQL, no database credentials, no public tunnel and no customer data.
 */
const DEFAULT_BRIDGE = 'http://127.0.0.1:3456';
const TABLES = ['Items', 'AA_ActQty', 'Inv_Items_Insert_Stock', 'MPOSSales', 'MPOSPriceOffer', 'Offers'];
function bridgeOrigin(input) {
  const url = new URL(String(input || DEFAULT_BRIDGE));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw Error('يُسمح فقط بجسر محلي 127.0.0.1 للقراءة');
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('منفذ جسر جوافة غير صالح');
  return url.origin;
}
async function getJson(base, path, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(base + path, { method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!response.ok) throw Error('جسر جوافة لم يستجب بنجاح');
    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > 2_000_000) throw Error('استجابة جوافة تتجاوز الحد المسموح');
    const raw = await response.text();
    if (raw.length > 2_000_000) throw Error('استجابة جوافة كبيرة جدًا');
    return JSON.parse(raw);
  } finally { clearTimeout(timer); }
}
export function createJawafaBridge({ url = DEFAULT_BRIDGE, fetchImpl = fetch } = {}) {
  const base = bridgeOrigin(url);
  async function checkHealth() {
    const health = await getJson(base, '/api/health', fetchImpl);
    if (health?.ok !== true || health.mode !== 'FORENSIC-READ-ONLY' || health.database !== 'Jawafa_DB') throw Error('لم يتم التحقق من جسر قراءة جوافة المعتمد');
    return true;
  }
  return {
    async status() {
      await checkHealth();
      const data = await getJson(base, '/api/tables', fetchImpl);
      if (!Array.isArray(data.tables) || data.ok !== true) throw Error('فهرس جداول جوافة غير صالح');
      const names = new Set(data.tables.map(row => row.TABLE_NAME));
      return { connected: true, database: 'Jawafa_DB', mode: 'FORENSIC-READ-ONLY', tableCount: data.tables.length,
        catalog: names.has('Items'), quantityCandidates: ['AA_ActQty', 'Inv_Items_Insert_Stock', 'MPOSSales'].filter(name => names.has(name)),
        offersCandidates: ['Offers', 'MPOSPriceOffer'].filter(name => names.has(name)),
        quantityMappingVerified: false, saleableImportEnabled: false };
    },
    async catalogPreview() {
      await checkHealth();
      const data = await getJson(base, '/api/query/Items?limit=20', fetchImpl);
      if (data?.ok !== true || !Array.isArray(data.data)) throw Error('فشل جسر جوافة في قراءة أصناف المعاينة');
      return { source: 'Jawafa_DB.dbo.Items', readOnly: true, previewOnly: true, count: data.data.length,
        items: data.data.slice(0,20).map(row => ({
          code: String(row.ItemCode ?? '').slice(0,80),
          itemSeq: String(row.ItemcodeSeq ?? '').slice(0,80),
          name: String(row.Description ?? '').slice(0,160),
          family: String(row.FamCode ?? '').slice(0,80)
        })) };
    }
  };
}
