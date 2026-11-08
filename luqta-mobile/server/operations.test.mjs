// G18 — Master Report v4 work packages (operations.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';
import { unitPrice, markdownFor, offerTruth, simulateOffer, splitList, parseLine, budgetFrom } from './operations.mjs';

const password = 'operations-test-password-1';
const address = { name: 'عميل', phone: '+962790123456', city: 'عمان', street: 'شارع الاختبار 12' };
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-ops-'));
  const app = await createCommerceServer({ dbPath: resolve(directory, 'c.sqlite'), bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const admin = (await request('POST', '/auth/login', { email: 'admin@example.test', password })).body;
  const user = (await request('POST', '/auth/register', { name: 'عميل', email: `${Math.random().toString(36).slice(2)}@example.test`, password })).body;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...app, request, admin, user };
}
const grocery = [
  { id: 'rice-5kg', name: 'أرز بسمتي 5 كيلو', price: 6.5, stock: 40, category: 'grocery', measureUnit: 'kg', measureSize: 5, barcode: '6251000000011', tags: ['رز', 'ارز'] },
  { id: 'milk-1l', name: 'حليب طازج 1 لتر', price: 1.1, stock: 60, category: 'dairy', measureUnit: 'l', measureSize: 1, barcode: '6251000000028', tags: ['حليب'] },
  { id: 'sugar-2kg', name: 'سكر أبيض 2 كيلو', price: 1.9, stock: 0, category: 'grocery', measureUnit: 'kg', measureSize: 2, tags: ['سكر'] },
];

test('G18 pure rules: unit price, expiry markdown, offer truth, offer simulation, list parsing', () => {
  assert.deepEqual(unitPrice(6.5, 'kg', 5), { value: 1.3, per: 'kg' });
  assert.deepEqual(unitPrice(0.9, 'ml', 500), { value: 1.8, per: 'l' });
  assert.equal(unitPrice(1, undefined, 1), null);
  assert.equal(markdownFor(-1).action, 'remove'); assert.equal(markdownFor(1).percent, 50); assert.equal(markdownFor(3).percent, 30); assert.equal(markdownFor(10).action, 'none');
  const now = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(offerTruth(10, [{ price: 10, at: '2026-10-20T00:00:00Z' }], 30, now).verdict, 'verified');
  assert.equal(offerTruth(12, [{ price: 10, at: '2026-10-20T00:00:00Z' }], 30, now).verdict, 'unverified', 'fake was-price is flagged');
  assert.equal(offerTruth(10, [{ price: 10, at: '2026-08-01T00:00:00Z' }], 30, now).verdict, 'unverified', 'too old to back the claim');
  const sim = simulateOffer({ price: 10, cost: 8, baseUnits: 100, discountPercent: 15, minMarginPercent: 10 });
  assert.equal(sim.kind, 'simulation'); assert.equal(sim.newPrice, 8.5); assert.equal(sim.allowed, false); assert.equal(sim.reason, 'below_min_margin');
  assert.ok(sim.units.low < sim.units.expected && sim.units.expected < sim.units.high);
  assert.equal(simulateOffer({ price: 10, cost: null, baseUnits: 5, discountPercent: 10 }).reason, 'cost_unknown');
  assert.deepEqual(splitList('٢ كيلو رز، حليب\nسكر و زيت'), ['2 كيلو رز', 'حليب', 'سكر', 'زيت']);
  assert.deepEqual(parseLine('بدي ثلاث علب حليب'), { raw: 'بدي ثلاث علب حليب', query: 'حليب', quantity: 3, unit: 'pack' });
  assert.equal(budgetFrom('سلة فطور تحت 20 دينار'), 20);
});

test('#4/#5/#13 price passport with unit price, offer truth, expiry markdown suggestion and expired items blocked', async (t) => {
  const { request, admin, user, db } = await fixture(t);
  await request('POST', '/ops/import/commit', { items: grocery, idempotencyKey: 'batch-passport-1' }, admin.token);
  const pass = await request('GET', '/products/rice-5kg/passport');
  assert.equal(pass.status, 200); assert.deepEqual(pass.body.unitPrice, { value: 1.3, per: 'kg' }); assert.equal(pass.body.source.kind, 'inventory_import'); assert.equal(pass.body.offer.verdict, 'no_claim');
  assert.deepEqual((await request('GET', '/products/rice-5kg')).body.product.unitPrice, { value: 1.3, per: 'kg' });
  // fake "was" price: never sold at 9.9
  await request('POST', '/ops/import/commit', { items: [{ ...grocery[1], oldPrice: 9.9 }], idempotencyKey: 'batch-passport-2' }, admin.token);
  assert.equal((await request('GET', '/products/milk-1l/passport')).body.offer.verdict, 'unverified');
  // real markdown: sold at 6.5, now 5.5 with was 6.5
  await request('POST', '/ops/import/commit', { items: [{ ...grocery[0], price: 5.5, oldPrice: 6.5 }], idempotencyKey: 'batch-passport-3' }, admin.token);
  assert.equal((await request('GET', '/products/rice-5kg/passport')).body.offer.verdict, 'verified');
  const audit = await request('GET', '/ops/offer-audit', undefined, admin.token);
  // the seeded catalog has offers of its own; the two imported items carry the verdicts under test
  assert.deepEqual(audit.body.items.filter((i) => ['milk-1l', 'rice-5kg'].includes(i.productId)).map((i) => [i.productId, i.verdict]).sort(), [['milk-1l', 'unverified'], ['rice-5kg', 'verified']]);
  // expiry
  const soon = new Date(Date.now() + 2.5 * 86400000).toISOString(), past = new Date(Date.now() - 86400000).toISOString();
  await request('POST', '/ops/import/commit', { items: [{ ...grocery[1], expiresAt: soon }, { id: 'yogurt', name: 'لبن', price: 0.8, stock: 5, category: 'dairy', expiresAt: past }], idempotencyKey: 'batch-expiry-01' }, admin.token);
  const exp = await request('GET', '/ops/expiry', undefined, admin.token);
  const milk = exp.body.items.find((i) => i.productId === 'milk-1l'), yog = exp.body.items.find((i) => i.productId === 'yogurt');
  assert.equal(milk.suggestion.percent, 30); assert.equal(yog.saleBlocked, true); assert.equal(exp.body.kind, 'recommendation');
  assert.equal((await request('POST', '/ops/expiry/apply', { productId: 'milk-1l', percent: 30 }, admin.token)).body.code, 'confirmation_required');
  const applied = await request('POST', '/ops/expiry/apply', { productId: 'milk-1l', percent: 30, confirm: true }, admin.token);
  assert.equal(applied.body.price, 0.77); assert.equal(applied.body.oldPrice, 9.9);
  assert.equal((await request('POST', '/ops/expiry/apply', { productId: 'yogurt', percent: 30, confirm: true }, admin.token)).body.code, 'expired');
  assert.equal((await request('POST', '/orders', { items: [{ productId: 'yogurt', quantity: 1 }], address, paymentMethod: 'cod', idempotencyKey: 'order-expired-1' }, user.token)).body.code, 'expired');
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='waste.markdown'").get().n === 1);
});

test('#14/WP-19/WP-20 stock insights, offer lab with margin guard, anomaly leads', async (t) => {
  const { request, admin, user, db } = await fixture(t);
  await request('POST', '/ops/import/commit', { items: [{ ...grocery[0], stock: 4 }, grocery[1]], idempotencyKey: 'batch-insight-1' }, admin.token);
  for (let i = 0; i < 3; i++) assert.equal((await request('POST', '/orders', { items: [{ productId: 'milk-1l', quantity: 5 }], address, paymentMethod: 'cod', idempotencyKey: `order-velocity-${i}` }, user.token)).status, 201);
  const ins = await request('GET', '/ops/stock-insights', undefined, admin.token);
  assert.equal(ins.body.kind, 'recommendation'); assert.ok(ins.body.lowStock.some((l) => l.productId === 'rice-5kg'));
  const lab0 = await request('POST', '/ops/offer-lab', { productId: 'milk-1l', discountPercent: 10 }, admin.token);
  assert.equal(lab0.body.reason, 'cost_unknown'); assert.equal(lab0.body.allowed, false);
  assert.equal((await request('PUT', '/ops/costs', { costs: [{ productId: 'milk-1l', cost: 0.8 }] }, admin.token)).body.updated, 1);
  assert.equal((await request('GET', '/products/milk-1l')).body.product.cost, undefined, 'cost price never leaks to customers');
  const ok = await request('POST', '/ops/offer-lab', { productId: 'milk-1l', discountPercent: 5 }, admin.token);
  const blocked = await request('POST', '/ops/offer-lab', { productId: 'milk-1l', discountPercent: 25 }, admin.token);
  assert.equal(ok.body.allowed, true); assert.equal(blocked.body.allowed, false); assert.equal(blocked.body.reason, 'below_min_margin');
  assert.equal(db.prepare("SELECT json_extract(data,'$.price') AS p FROM products WHERE id='milk-1l'").get().p, 1.1, 'simulation changes nothing');
  // planted inconsistencies
  const oid = db.prepare('SELECT id FROM orders LIMIT 1').get().id;
  db.prepare('UPDATE orders SET total=total+5 WHERE id=?').run(oid);
  db.prepare("UPDATE orders SET payment_method='card',payment_status='paid' WHERE id=(SELECT id FROM orders WHERE id<>? LIMIT 1)").run(oid);
  const leads = await request('GET', '/ops/anomalies', undefined, admin.token);
  const codes = leads.body.findings.map((f) => f.code);
  assert.ok(codes.includes('order_total_mismatch')); assert.ok(codes.includes('paid_without_gateway_record'));
  assert.match(leads.body.note, /ليست اتهامًا/);
  assert.equal((await request('GET', '/ops/anomalies', undefined, user.token)).status, 403);
});

test('NX-20/NX-02/NX-04 consent-gated household memory: predicted basket and budget forecast', async (t) => {
  const { request, user, db } = await fixture(t);
  assert.equal((await request('GET', '/me/predicted-basket', undefined, user.token)).body.code, 'consent_required');
  assert.deepEqual((await request('GET', '/me/consents', undefined, user.token)).body.consents, { personalization: false, household_memory: false, marketing: false });
  assert.equal((await request('PUT', '/me/consents', { household_memory: true }, user.token)).body.consents.household_memory, true);
  for (let i = 0; i < 3; i++) await request('POST', '/orders', { items: [{ productId: 'mug', quantity: 2 }], address, paymentMethod: 'cod', idempotencyKey: `order-habit-${i}` }, user.token);
  const ids = db.prepare('SELECT id FROM orders ORDER BY created_at').all().map((r) => r.id);
  ids.forEach((oid, i) => db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(new Date(Date.now() - (21 - i * 7) * 86400000).toISOString(), oid));
  const basket = await request('GET', '/me/predicted-basket', undefined, user.token);
  assert.equal(basket.body.kind, 'suggestion_needs_confirmation');
  const mug = basket.body.items.find((i) => i.productId === 'mug');
  assert.equal(mug.intervalDays, 7); assert.equal(mug.quantity, 2); assert.equal(mug.due, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 3, 'prediction never places orders');
  const fc = await request('GET', '/me/budget-forecast', undefined, user.token);
  assert.equal(fc.body.kind, 'forecast'); assert.ok(fc.body.monthly > 0); assert.ok(fc.body.range.low <= fc.body.monthly && fc.body.monthly <= fc.body.range.high);
  await request('PUT', '/me/consents', { household_memory: false }, user.token);
  assert.equal((await request('GET', '/me/budget-forecast', undefined, user.token)).body.code, 'consent_required', 'withdrawing consent stops it');
});
