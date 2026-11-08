// End-to-end harness: the real commerce server serving the exported web app (dist-e2e, built with
// EXPO_PUBLIC_API_URL=http://127.0.0.1:8799), a stand-in AAS Command Center, the central dashboard as static
// files, and Chromium with a fake camera, granted geolocation and stubbed speech/share APIs.
import http from 'node:http';
import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createCommerceServer } from '../server/commerce.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// CommonJS resolution so a globally provided Playwright (NODE_PATH) works as well as a local devDependency.
const { chromium } = createRequire(import.meta.url)('playwright');
export const PORT = 8799, AAS_PORT = 8798, DASH_PORT = 8797;
export const ORIGIN = `http://127.0.0.1:${PORT}`, DASHBOARD = `http://127.0.0.1:${DASH_PORT}`;
export const password = 'e2e-only-password-123';
const listen = (server, port) => new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
const closeServer = (server) => new Promise((done) => server.close(() => done()));

function commandCenter() {
  const calls = [];
  const operations = [{ id: 'op-e2e-1', action: 'update', table: 'products', key: { id: 'water' }, values: { stock: 77 } }, { id: 'op-e2e-2', action: 'update', table: 'users', key: { id: 'x' }, values: { role: 'admin' } }];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://x'); calls.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null });
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/api/v1/app/sync') return send(200, { ok: true, revision: 3 });
    if (url.pathname === '/api/v1/bridge/snapshot' || url.pathname === '/api/v1/bridge/receipts') return send(200, { ok: true });
    if (url.pathname === '/api/v1/bridge/context') return send(200, { operations });
    if (url.pathname === '/api/v1/state') return send(200, { products: [{ id: 'milk', name: 'حليب طازج كامل الدسم', retailPrice: 1.2, stockQuantity: 66, category: 'dairy' }, { id: 'cc-dates', name: 'تمر من لوحة القيادة', retailPrice: 4.75, stockQuantity: 12, category: 'pantry' }, { id: 'bad-row', name: '', retailPrice: -2 }] });
    send(404, { error: 'not found' });
  });
  return { server, calls };
}
function staticServer(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  return http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(dir, `.${path}`);
    if (file !== dir && !file.startsWith(dir + sep)) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res);
  });
}

// Browser-side stubs: share sheet, speech recognition (says window.__voiceText) and speech synthesis are recorded.
const STUBS = `(() => {
  window.__shared = []; window.__spoken = [];
  navigator.share = (data) => { window.__shared.push(data); return Promise.resolve(); };
  class FakeRecognition { constructor(){ this.lang=''; } start(){ setTimeout(() => { this.onresult && this.onresult({ results: [[{ transcript: window.__voiceText || 'حليب' }]] }); this.onend && this.onend(); }, 150); } stop(){ this.onend && this.onend(); } abort(){} }
  window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
  if (window.speechSynthesis) { const original = window.speechSynthesis.speak.bind(window.speechSynthesis); window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); try { u.onend && setTimeout(() => u.onend(new Event('end')), 50); } catch {} }; window.__originalSpeak = original; }
})();`;

export async function startStack() {
  const dist = resolve(HERE, '../dist-e2e');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Build the web app first: npm run e2e:build');
  const directory = await mkdtemp(join(tmpdir(), 'luqta-e2e-'));
  const center = commandCenter();
  await listen(center.server, AAS_PORT);
  const app = await createCommerceServer({
    dbPath: join(directory, 'commerce.sqlite'), staticDir: dist,
    bootstrapAdmin: { name: 'مدير المتجر', email: 'admin@e2e.test', password },
    corsOrigins: [ORIGIN, DASHBOARD].join(','), rateLimitScale: 40,
    aas: { baseUrl: `http://127.0.0.1:${AAS_PORT}`, apiKey: 'e2e-api-key-1234567890', runnerKey: 'e2e-runner-key-1234567890', bridgeId: 'bridge_e2e', serviceKey: 'e2e-service-key-0123456789', fetchImpl: fetch },
  });
  await listen(app.server, PORT);
  const dashboard = staticServer(resolve(HERE, '../../dashboard'));
  await listen(dashboard, DASH_PORT);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });
  const api = async (method, path, body, token) => {
    const response = await fetch(`${ORIGIN}/api${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  };
  const admin = await api('POST', '/auth/login', { email: 'admin@e2e.test', password });
  let counter = 0;
  const register = async (name = 'متسوق تجريبي') => api('POST', '/auth/register', { name, email: `shopper${Date.now()}${counter++}@e2e.test`, password });
  let driver = null;
  const ensureDriver = async () => { if (!driver) { driver = await register('سائق لُقطة'); await api('PATCH', `/admin/users/${driver.user.id}`, { role: 'driver' }, admin.token); } return driver; };
  const order = async (customer, items = [{ productId: 'milk', quantity: 1 }], extra = {}) => (await api('POST', '/orders', { items, address: { name: 'متسوق', phone: '+962790000001', city: 'عمان', street: 'شارع الرينبو 5', latitude: 31.95, longitude: 35.9 }, idempotencyKey: `e2e-${Date.now()}-${counter++}`, ...extra }, customer.token)).order;
  const dispatch = async (customer, orderId) => {
    const d = await ensureDriver();
    await api('PATCH', `/admin/orders/${orderId}`, { status: 'confirmed', driverId: d.user.id }, admin.token);
    await api('PATCH', `/admin/orders/${orderId}`, { status: 'preparing' }, admin.token);
    await api('PATCH', `/driver/orders/${orderId}`, { status: 'out_for_delivery' }, d.token);
    return d;
  };
  const deliver = async (customer, orderId) => {
    const d = await dispatch(customer, orderId);
    const { code } = await api('GET', `/orders/${orderId}/delivery-code`, undefined, customer.token);
    await api('PATCH', `/driver/orders/${orderId}`, { status: 'delivered', otp: code }, d.token);
  };
  const contexts = [];
  const newPage = async ({ token, colorScheme = 'light', locale = 'ar-JO', geolocation = { latitude: 32.55, longitude: 35.85 } } = {}) => {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme, locale, permissions: ['geolocation', 'camera', 'microphone'], geolocation, acceptDownloads: true });
    contexts.push(context);
    // Only the local stack is reachable; fonts, CDNs and map tiles are refused so runs are offline and repeatable.
    await context.route((url) => !url.href.startsWith(`${ORIGIN}/`) && !url.href.startsWith(`${DASHBOARD}/`), (route) => route.abort('blockedbyclient'));
    await context.addInitScript(STUBS);
    if (token) await context.addInitScript(([key, value]) => { try { window.sessionStorage.setItem(key, value); } catch {} }, ['luqta-commerce-session-v1', JSON.stringify({ token, origin: ORIGIN })]);
    const page = await context.newPage();
    page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
    return page;
  };
  return {
    app, api, admin, register, order, dispatch, deliver, ensureDriver, newPage, center, browser,
    async close() { for (const c of contexts) await c.close().catch(() => {}); await browser.close(); await app.close(); await closeServer(center.server); await closeServer(dashboard); await rm(directory, { recursive: true, force: true }); },
  };
}

// Small helpers shared by the e2e files. Screens left behind in the navigation stack stay mounted but hidden, so every
// lookup targets visible elements only.
export const go = async (page, path) => { await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' }); };
export const id = (page, testId) => page.getByTestId(testId).filter({ visible: true }).first();
export const see = async (page, text, timeout = 15000) => { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); };
export const tap = async (page, testId) => { const target = id(page, testId); await target.waitFor({ state: 'visible', timeout: 15000 }); await target.click(); };
export const field = (page, testId) => page.locator(`[data-testid="${testId}"] input, [data-testid="${testId}"] textarea, input[data-testid="${testId}"], textarea[data-testid="${testId}"]`).filter({ visible: true }).first();
export const fill = async (page, testId, value) => { const target = field(page, testId); await target.waitFor({ state: 'visible', timeout: 15000 }); await target.fill(value); };
export const button = (page, name, exact = true) => page.getByRole('button', { name, exact }).filter({ visible: true }).first();
export const press = async (page, name) => { const target = button(page, name); await target.waitFor({ state: 'visible', timeout: 15000 }); await target.click(); };
export const until = async (fn, timeout = 15000, message = 'condition not met') => { const end = Date.now() + timeout; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (error) { last = error; } await new Promise((r) => setTimeout(r, 200)); } assert.fail(`${message}${last instanceof Error ? `: ${last.message}` : ''}`); };
export const noErrors = (page) => assert.deepEqual(page.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|AbortError/.test(e)), []);
