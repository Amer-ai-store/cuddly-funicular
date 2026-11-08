import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './testkit.mjs';

test('L101 L111 KPIs and sales reports summarise real orders', async (t) => {
  const { request, register, order, deliver, admin } = await fixture(t);
  const customer = await register();
  assert.equal((await request('GET', '/admin/kpis', undefined, customer.token)).status, 403);
  const one = await order(customer, [{ productId: 'rice', quantity: 2 }]);
  await order(customer, [{ productId: 'milk', quantity: 3 }]);
  await deliver(customer, one.id);
  await request('POST', `/orders/${one.id}/rating`, { rating: 5, driverRating: 4 }, customer.token);
  const kpis = (await request('GET', '/admin/kpis', undefined, admin.token)).body.kpis;
  assert.equal(kpis.orders, 2); assert.equal(kpis.salesToday, 15.5 + 5.95); assert.equal(kpis.activeOrders, 1); assert.ok(kpis.categories >= 10);
  const report = (await request('GET', '/admin/reports?days=7', undefined, admin.token)).body;
  assert.equal(report.totals.orders, 2); assert.equal(report.totals.itemsSold, 5); assert.equal(report.topProducts[0].productId, 'rice');
  assert.equal(report.byCategory[0].category, 'pantry'); assert.equal(report.ratings.average, 5); assert.equal(report.ratings.driverAverage, 4);
  assert.equal(report.byDay.length, 1); assert.equal(report.payments.cod, 21.45);
});

test('L102 L103 products and categories are managed with validation and audit', async (t) => {
  const { request, admin } = await fixture(t);
  const created = await request('POST', '/admin/products', { id: 'dates-box', name: 'تمر مجدول', price: 4.5, stock: 20, category: 'pantry', barcode: '6250000009999', expiryDays: 120, model3d: { shape: 'box', color: '#6D4C41' } }, admin.token);
  assert.equal(created.status, 201); assert.equal(created.body.product.model3d.shape, 'box');
  assert.equal((await request('POST', '/admin/products', { id: 'bad-shape', name: 'شكل', price: 1, model3d: { shape: 'pyramid' } }, admin.token)).status, 400);
  assert.equal((await request('PATCH', '/admin/categories/pantry', { name: 'المؤونة', sort: 1 }, admin.token)).body.category.name, 'المؤونة');
  const audit = (await request('GET', '/admin/audit', undefined, admin.token)).body.events.map((e) => e.action);
  assert.ok(audit.includes('product.create') && audit.includes('category.update'));
});

test('L104 L105 import preview shows the difference before applying and the import can be undone', async (t) => {
  const { request, admin } = await fixture(t);
  const csv = 'id,name,price,stock,category\nmilk,حليب طازج كامل الدسم,1.25,40,dairy\nnew-honey,عسل سدر,9.5,12,pantry\nbad,,abc,1,pantry\n';
  const preview = (await request('POST', '/admin/inventory-preview', { csv }, admin.token)).body.preview;
  assert.deepEqual(preview.summary, { total: 3, new: 1, changed: 1, unchanged: 0, invalid: 1 });
  assert.deepEqual(preview.rows[0].changes.price, [1.15, 1.25]); assert.deepEqual(preview.rows[0].changes.stock, [80, 40]);
  assert.equal((await request('GET', '/products/new-honey')).status, 404, 'preview writes nothing');
  const imported = await request('POST', '/admin/inventory/import', { csv: csv.split('\n').slice(0, 3).join('\n') }, admin.token);
  assert.equal(imported.body.created, 1);
  assert.equal((await request('POST', '/admin/inventory/undo', { importId: imported.body.importId }, admin.token)).body.removed, 1);
  assert.equal((await request('GET', '/products/milk')).body.product.price, 1.15);
});

test('L106 exports products, orders, customers, inventory and branch stock as CSV or JSON', async (t) => {
  const { request, raw, register, order, admin } = await fixture(t);
  const customer = await register('=HYPERLINK("x")');
  await order(customer, [{ productId: 'bread', quantity: 2 }]);
  const csv = await request('GET', '/admin/export/products', undefined, admin.token);
  assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /luqta-products-\d{4}-\d{2}-\d{2}\.csv/);
  assert.ok(csv.body.startsWith('id,sku,barcode,name')); assert.ok(csv.body.includes('tomato,tomato,625'));
  const bytes = new Uint8Array(await (await raw('GET', '/admin/export/products', undefined, admin.token)).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel shows Arabic correctly');
  const customers = await request('GET', '/admin/export/customers', undefined, admin.token);
  assert.ok(customers.body.includes('"\'=HYPERLINK(""x"")"'), 'spreadsheet formulas are neutralised');
  const orders = await request('GET', '/admin/export/orders?format=json', undefined, admin.token);
  assert.equal(orders.body.rows[0].items, 'breadx2'); assert.match(orders.headers.get('content-disposition'), /\.json/);
  assert.equal((await request('GET', '/admin/export/branch-stock', undefined, admin.token)).status, 200);
  assert.equal((await request('GET', '/admin/export/passwords', undefined, admin.token)).status, 404);
  assert.equal((await request('GET', '/admin/export/products', undefined, customer.token)).status, 403);
});

test('L107 L108 L109 L110 orders with drivers, returns, coupons and customer wallets', async (t) => {
  const { request, register, order, deliver, admin } = await fixture(t);
  const customer = await register();
  const coupon = await request('POST', '/admin/coupons', { code: 'WELCOME5', type: 'fixed', value: 5, minSubtotal: 20, maxUses: 1 }, admin.token);
  assert.equal(coupon.status, 201);
  const placed = await order(customer, [{ productId: 'olive-oil', quantity: 3 }], { couponCode: 'WELCOME5' });
  assert.equal(placed.discount, 5);
  assert.equal((await request('POST', '/orders', { items: [{ productId: 'olive-oil', quantity: 3 }], address: placed.address, couponCode: 'WELCOME5', idempotencyKey: 'coupon-second-use' }, customer.token)).body.code, 'invalid_coupon');
  await deliver(customer, placed.id);
  assert.equal((await request('GET', '/admin/orders', undefined, admin.token)).body.orders[0].driverId !== null, true);
  const ret = await request('POST', `/orders/${placed.id}/returns`, { reason: 'لم يعجبني الطعم' }, customer.token);
  assert.equal((await request('GET', '/admin/returns', undefined, admin.token)).body.returns[0].id, ret.body.returnRequest.id);
  await request('PATCH', `/admin/returns/${ret.body.returnRequest.id}`, { status: 'rejected', note: 'المنتج مفتوح' }, admin.token);
  const adjusted = await request('POST', '/admin/wallet/adjust', { userId: customer.user.id, amount: 3, note: 'تعويض عن التأخير' }, admin.token);
  assert.equal(adjusted.body.balance, 3);
  assert.ok((await request('GET', '/admin/users', undefined, admin.token)).body.users.some((u) => u.id === customer.user.id));
});

test('L112 L113 vendors and branches are created and administered', async (t) => {
  const { request, admin, register } = await fixture(t);
  const owner = await register('صاحب متجر', 'owner');
  const vendor = (await request('POST', '/admin/vendors', { name: 'ألبان الوادي', commission: 8 }, admin.token)).body.vendor;
  await request('POST', `/admin/vendors/${vendor.id}/members`, { email: 'owner@example.test', role: 'owner' }, admin.token);
  const listed = (await request('GET', '/admin/vendors', undefined, admin.token)).body.vendors[0];
  assert.equal(listed.members[0].userId, owner.user.id); assert.equal(listed.commission, 8);
  assert.equal((await request('DELETE', `/admin/vendors/${vendor.id}/members/${owner.user.id}`, undefined, admin.token)).status, 200);
  const branch = await request('POST', '/admin/branches', { name: 'فرع الزرقاء', city: 'الزرقاء', latitude: 32.07, longitude: 36.09 }, admin.token);
  assert.equal(branch.status, 201);
  await request('PUT', `/admin/branches/${branch.body.branch.id}/stock`, { items: [{ productId: 'water', quantity: 50 }] }, admin.token);
  const branches = (await request('GET', '/admin/branches', undefined, admin.token)).body.branches;
  assert.equal(branches.find((b) => b.id === branch.body.branch.id).units, 50);
  assert.equal((await request('PATCH', `/admin/branches/${branch.body.branch.id}`, { active: false }, admin.token)).body.branch.active, false);
  assert.equal((await request('GET', '/branches')).body.branches.some((b) => b.id === branch.body.branch.id), false);
});

test('L114 reorder suggestions use the last 30 days of sales', async (t) => {
  const { request, register, order, admin } = await fixture(t);
  const customer = await register();
  await request('PATCH', '/admin/products/chicken', { stock: 6 }, admin.token);
  await order(customer, [{ productId: 'chicken', quantity: 6 }]);
  const suggestions = (await request('GET', '/admin/reorder?cover=14', undefined, admin.token)).body.suggestions;
  const chicken = suggestions.find((s) => s.productId === 'chicken');
  assert.equal(chicken.stock, 0); assert.equal(chicken.urgency, 'out'); assert.equal(chicken.soldLast30, 6); assert.equal(chicken.suggestedQuantity, 8);
  assert.equal(suggestions[0].urgency, 'out');
});

test('L115 L116 audit log and agent keys with scoped jobs', async (t) => {
  const { request, admin } = await fixture(t);
  const key = (await request('POST', '/admin/agent-keys', { name: 'وكيل المخزون', scopes: ['inventory:write'] }, admin.token)).body;
  assert.match(key.token, /^lq_agent_/);
  assert.equal((await request('GET', '/admin/branches', undefined, key.token)).status, 403, 'new admin areas need a full administrator');
  assert.equal((await request('POST', '/admin/inventory/import', { items: [{ id: 'milk', stock: 33 }] }, key.token)).status, 200);
  const job = await request('POST', '/admin/agent-jobs', { title: 'فحص المخزون', description: 'مراجعة الأصناف المنخفضة', type: 'audit' }, admin.token);
  assert.equal(job.status, 201);
  const events = (await request('GET', '/admin/audit', undefined, admin.token)).body.events.map((e) => e.action);
  assert.ok(events.includes('agent.key.create') && events.includes('inventory.import') && events.includes('agent.job.create'));
});

test('L117 project management lists all 125 features with evidence and keeps a development log', async (t) => {
  const { request, admin, register } = await fixture(t);
  const features = (await request('GET', '/admin/features', undefined, admin.token)).body;
  assert.equal(features.total, 125); assert.equal(features.features[0].id, 'L001'); assert.equal(features.features.at(-1).id, 'L125');
  assert.ok(features.areas.length >= 13);
  assert.ok(features.features.every((f) => ['verified', 'implemented', 'failing'].includes(f.status)));
  const log = (await request('GET', '/admin/devlog', undefined, admin.token)).body.entries;
  assert.equal(log[0].kind, 'release');
  assert.equal((await request('POST', '/admin/devlog', { kind: 'feature', title: 'إطلاق البحث بالصورة', version: '2.0.0' }, admin.token)).status, 201);
  assert.equal((await request('GET', '/admin/devlog', undefined, admin.token)).body.entries[0].title, 'إطلاق البحث بالصورة');
  assert.equal((await request('GET', '/admin/test-log', undefined, admin.token)).status, 200);
  assert.equal((await request('GET', '/admin/features', undefined, (await register()).token)).status, 403);
});
