import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, pngDataUrl } from './testkit.mjs';

test('L013 L017 catalog comes from the database with managed categories', async (t) => {
  const { request, admin } = await fixture(t);
  const products = (await request('GET', '/products')).body.products;
  assert.ok(products.length >= 39); assert.ok(products.some((p) => p.id === 'tomato' && p.category === 'fresh'));
  const categories = (await request('GET', '/categories')).body.categories;
  assert.ok(categories.find((c) => c.id === 'fresh').productCount >= 8);
  assert.equal((await request('POST', '/admin/categories', { id: 'frozen', name: 'مجمدات', color: '#90CAF9', icon: 'snowflake' }, admin.token)).status, 201);
  assert.equal((await request('POST', '/admin/categories', { id: 'Bad Id', name: 'x' }, admin.token)).status, 400);
  assert.equal((await request('DELETE', '/admin/categories/fresh', undefined, admin.token)).status, 409, 'categories in use cannot be deleted');
  assert.equal((await request('PATCH', '/admin/categories/frozen', { active: false }, admin.token)).status, 200);
  assert.equal((await request('GET', '/categories')).body.categories.some((c) => c.id === 'frozen'), false);
});

test('L014 Arabic search ignores diacritics, hamza and articles and tolerates typos', async (t) => {
  const { request } = await fixture(t);
  const names = async (q) => (await request('GET', `/search?q=${encodeURIComponent(q)}`)).body.results.map((p) => p.id);
  assert.equal((await names('الطَّماطم'))[0], 'tomato');
  assert.equal((await names('بالحليب'))[0], 'milk');
  assert.equal((await names('أرز'))[0], 'rice');
  assert.ok((await names('سماعت')).includes('headphones'), 'one-letter typo still matches');
  assert.ok((await names('Basmati')).includes('rice'), 'English names are searchable');
  const none = (await request('GET', '/search?q=زززززز')).body;
  assert.equal(none.total, 0);
});

test('L015 L016 filters by price, rating and availability and sorts results', async (t) => {
  const { request, admin } = await fixture(t);
  const cheap = (await request('GET', '/search?category=fresh&maxPrice=1&sort=price-asc')).body.results;
  assert.ok(cheap.length >= 3); assert.ok(cheap.every((p) => p.price <= 1 && p.category === 'fresh'));
  assert.deepEqual(cheap.map((p) => p.price), [...cheap.map((p) => p.price)].sort((a, b) => a - b));
  const desc = (await request('GET', '/search?category=dairy&sort=price-desc')).body.results.map((p) => p.price);
  assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
  await request('PATCH', '/admin/products/lettuce', { stock: 0 }, admin.token);
  assert.equal((await request('GET', '/search?category=fresh&inStock=1')).body.results.some((p) => p.id === 'lettuce'), false);
  await request('PATCH', '/admin/products/croissant', { name: 'كرواسون زبدة فاخر' }, admin.token);
  assert.equal((await request('GET', '/search?category=bakery&sort=newest')).body.results[0].id, 'croissant');
  assert.equal((await request('GET', '/search?minRating=4.9')).body.total, 0);
});

test('L018 L019 L020 gallery, video, variants and specifications are validated and served', async (t) => {
  const { request, admin } = await fixture(t);
  const diffuser = (await request('GET', '/products/diffuser')).body.product;
  assert.match(diffuser.video, /^https:\/\//); assert.ok(diffuser.images.length >= 1); assert.ok(diffuser.specs.length >= 3);
  assert.equal((await request('PATCH', '/admin/products/mug', { images: ['http://insecure.example/a.jpg'] }, admin.token)).status, 400);
  assert.equal((await request('PATCH', '/admin/products/mug', { specs: [{ label: '', value: 'x' }] }, admin.token)).status, 400);
  const saved = await request('PATCH', '/admin/products/mug', { images: ['https://img.example/a.jpg', 'https://img.example/b.jpg'], specs: [{ label: 'السعة', value: '400 مل' }] }, admin.token);
  assert.equal(saved.status, 200); assert.equal(saved.body.product.images.length, 2); assert.equal(saved.body.product.specs[0].value, '400 مل');
  assert.equal((await request('POST', '/admin/products', { id: 'sneakers-42', variantOf: 'sneakers', variantLabel: 'مقاس 42', name: 'حذاء ستريت', price: 219, stock: 4, category: 'fashion' }, admin.token)).status, 201);
  const parent = (await request('GET', '/products/sneakers')).body.product;
  assert.equal(parent.hasVariants, true); assert.equal(parent.stock, 4);
});

test('L021 per-branch stock limits orders, follows them and detects version conflicts', async (t) => {
  const { request, register, admin, order } = await fixture(t);
  const branches = (await request('GET', '/branches')).body.branches;
  assert.deepEqual(branches.map((b) => b.id).sort(), ['br_amman', 'br_irbid']);
  const irbid = (await request('GET', '/branches/br_irbid/stock')).body.stock.find((s) => s.productId === 'milk');
  const customer = await register();
  const tooMany = await request('POST', '/orders', { items: [{ productId: 'milk', quantity: irbid.quantity + 1 }], address: { name: 'عميل', phone: '+962790000000', city: 'إربد', street: 'شارع الجامعة' }, branchId: 'br_irbid', idempotencyKey: 'branch-too-many' }, customer.token);
  assert.equal(tooMany.status, 409); assert.equal(tooMany.body.code, 'out_of_stock_branch');
  const placed = await order(customer, [{ productId: 'milk', quantity: 2 }], { branchId: 'br_irbid' });
  assert.equal(placed.extras.branchId, 'br_irbid');
  const after = (await request('GET', '/branches/br_irbid/stock')).body.stock.find((s) => s.productId === 'milk');
  assert.equal(after.quantity, irbid.quantity - 2); assert.equal(after.version, irbid.version + 1);
  await request('POST', `/orders/${placed.id}/cancel`, {}, customer.token);
  assert.equal((await request('GET', '/branches/br_irbid/stock')).body.stock.find((s) => s.productId === 'milk').quantity, irbid.quantity);
  const stale = await request('PUT', '/admin/branches/br_irbid/stock', { items: [{ productId: 'milk', quantity: 5, expectedVersion: 1 }] }, admin.token);
  assert.equal(stale.status, 409); assert.equal(stale.body.details.conflicts[0].productId, 'milk');
  const current = (await request('GET', '/admin/branch-stock?branch=br_irbid', undefined, admin.token)).body.stock.find((s) => s.productId === 'milk');
  assert.equal((await request('PUT', '/admin/branches/br_irbid/stock', { items: [{ productId: 'milk', quantity: 5, expectedVersion: current.version }] }, admin.token)).status, 200);
  const inStock = (await request('GET', '/search?branch=br_irbid&inStock=1&category=dairy')).body.results;
  assert.ok(inStock.every((p) => p.branchStock > 0));
});

test('L022 search history is personal and suggestions mix products, categories and trends', async (t) => {
  const { request, register } = await fixture(t);
  const one = await register(), two = await register();
  for (const q of ['حليب', 'طماطم', 'حليب']) await request('GET', `/search?q=${encodeURIComponent(q)}`, undefined, one.token);
  const history = (await request('GET', '/me/search-history', undefined, one.token)).body.history;
  assert.deepEqual(history.map((h) => h.query), ['حليب', 'طماطم'], 'deduplicated, newest first');
  assert.equal((await request('GET', '/me/search-history', undefined, two.token)).body.history.length, 0);
  const suggest = (await request('GET', `/search/suggest?q=${encodeURIComponent('حل')}`)).body.suggestions;
  assert.ok(suggest.some((s) => s.type === 'product' && s.id === 'milk'));
  // A typo with no prefix match still suggests the right product.
  assert.ok((await request('GET', `/search/suggest?q=${encodeURIComponent('حلييب')}`)).body.suggestions.some((s) => s.id === 'milk'));
  assert.ok((await request('GET', `/search/suggest?q=${encodeURIComponent('ألبان')}`)).body.suggestions.some((s) => s.type === 'category' && s.id === 'dairy'));
  assert.ok((await request('GET', '/search/suggest?q=', undefined, one.token)).body.recent.includes('حليب'));
  assert.equal((await request('DELETE', '/me/search-history', undefined, one.token)).status, 200);
  assert.equal((await request('GET', '/me/search-history', undefined, one.token)).body.history.length, 0);
});

test('L024 barcode lookup finds products by EAN, SKU or id', async (t) => {
  const { request } = await fixture(t);
  const tomato = (await request('GET', '/products/tomato')).body.product;
  assert.match(tomato.barcode, /^625\d{10}$/);
  assert.equal((await request('GET', `/products/barcode/${tomato.barcode}`)).body.product.id, 'tomato');
  assert.equal((await request('GET', '/products/barcode/rice')).body.product.id, 'rice');
  assert.equal((await request('GET', '/products/barcode/0000000000000')).status, 404);
  assert.equal((await request('GET', `/products/barcode/${encodeURIComponent('<script>')}`)).status, 400);
});

test('L025 image search decodes a PNG, finds its dominant colour and matches products', async (t) => {
  const { request } = await fixture(t);
  const red = await request('POST', '/search/image', { image: pngDataUrl([229, 57, 53]) });
  assert.equal(red.status, 200); assert.equal(red.body.colorName, 'أحمر');
  assert.ok(['tomato', 'apple'].includes(red.body.results[0].id), red.body.results[0].id);
  const green = await request('POST', '/search/image', { image: pngDataUrl([67, 160, 71]) });
  assert.ok(['cucumber', 'lettuce'].includes(green.body.results[0].id));
  assert.equal((await request('POST', '/search/image', { image: 'data:image/png;base64,bm90LWEtcG5n' })).status, 422);
  assert.equal((await request('POST', '/search/image', { image: 'not base64 at all!' })).status, 400);
  assert.equal((await request('POST', '/search/image', {})).status, 400);
});

test('L028 reviews are accepted only after the product was delivered', async (t) => {
  const { request, register, order, deliver } = await fixture(t);
  const customer = await register();
  assert.equal((await request('POST', '/products/cheese/reviews', { rating: 5, body: 'جبنة ممتازة' }, customer.token)).status, 403);
  const placed = await order(customer, [{ productId: 'cheese', quantity: 1 }]);
  await deliver(customer, placed.id);
  assert.equal((await request('POST', '/products/cheese/reviews', { rating: 5, body: 'جبنة ممتازة وطازجة' }, customer.token)).status, 201);
  assert.equal((await request('GET', '/products/cheese')).body.product.rating, 5);
});

test('L029 product questions get answers and store answers are marked official', async (t) => {
  const { request, register, admin } = await fixture(t);
  const asker = await register('منى'), neighbour = await register('علي');
  assert.equal((await request('POST', '/products/rice/questions', { question: 'هل الأرز مناسب للكبسة؟' })).status, 401);
  const q = (await request('POST', '/products/rice/questions', { question: 'هل الأرز مناسب للكبسة؟' }, asker.token)).body.question;
  assert.equal(q.askedBy, 'منى');
  assert.equal((await request('GET', '/admin/questions', undefined, admin.token)).body.questions[0].id, q.id);
  await request('POST', `/questions/${q.id}/answers`, { answer: 'نعم ممتاز' }, neighbour.token);
  const answered = (await request('POST', `/questions/${q.id}/answers`, { answer: 'نعم، حبة طويلة مناسبة للكبسة' }, admin.token)).body.question;
  assert.equal(answered.answers[0].official, true); assert.equal(answered.answers[0].by, 'فريق لُقطة');
  assert.equal((await request('GET', '/admin/questions', undefined, admin.token)).body.questions.length, 0);
  assert.ok((await request('GET', '/notifications', undefined, asker.token)).body.notifications.some((n) => n.title.includes('إجابة')));
});

test('L030 price-drop and back-in-stock alerts notify once when the condition is met', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  assert.equal((await request('POST', '/products/apple/alerts', { type: 'price', targetPrice: 9 }, customer.token)).status, 400, 'target must be below price');
  assert.equal((await request('POST', '/products/apple/alerts', { type: 'price', targetPrice: 1.2 }, customer.token)).status, 201);
  await request('PATCH', '/admin/products/strawberry', { stock: 0 }, admin.token);
  assert.equal((await request('POST', '/products/strawberry/alerts', { type: 'stock' }, customer.token)).status, 201);
  await request('PATCH', '/admin/products/apple', { price: 1.4 }, admin.token);
  let alerts = (await request('GET', '/me/alerts', undefined, customer.token)).body.alerts;
  assert.equal(alerts.find((a) => a.productId === 'apple').triggeredAt, null, 'not yet below target');
  await request('PATCH', '/admin/products/apple', { price: 1.1 }, admin.token);
  await request('PATCH', '/admin/products/strawberry', { stock: 12 }, admin.token);
  alerts = (await request('GET', '/me/alerts', undefined, customer.token)).body.alerts;
  assert.ok(alerts.every((a) => a.triggeredAt));
  const titles = (await request('GET', '/notifications', undefined, customer.token)).body.notifications.map((n) => n.title);
  assert.equal(titles.filter((x) => x === 'انخفض السعر!').length, 1); assert.equal(titles.filter((x) => x === 'عاد المنتج إلى المخزون').length, 1);
});

test('L074 L075 smart summary and in-stock substitutes for a sold-out product', async (t) => {
  const { request, admin } = await fixture(t);
  await request('PATCH', '/admin/products/apple', { stock: 0 }, admin.token);
  const summary = (await request('GET', '/products/apple/summary')).body;
  assert.equal(summary.generated, true); assert.match(summary.summary, /غير متوفر حاليًا/);
  const subs = (await request('GET', '/products/apple/substitutes')).body;
  assert.equal(subs.outOfStock, true); assert.ok(subs.substitutes.length >= 2);
  assert.ok(subs.substitutes.every((p) => p.category === 'fresh' && p.stock > 0 && p.id !== 'apple'));
});
