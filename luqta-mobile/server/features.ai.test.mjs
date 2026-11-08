import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './testkit.mjs';

test('L071 conversational shopping answers with products, store info or actions', async (t) => {
  const { request } = await fixture(t);
  const chat = async (message) => (await request('POST', '/ai/chat', { message })).body;
  const products = await chat('أبحث عن سماعات لاسلكية للمكتب');
  assert.equal(products.intent, 'recommendations'); assert.equal(products.products[0].id, 'headphones');
  const info = await chat('كيف أرجع منتجًا؟');
  assert.equal(info.intent, 'store_info'); assert.match(info.reply, /محفظتك/);
  const action = await chat('افتح السلة');
  assert.equal(action.intent, 'navigate'); assert.equal(action.action.path, '/cart');
});

test('L072 budget basket stays within the budget and favours useful staples', async (t) => {
  const { request } = await fixture(t);
  const chat = (await request('POST', '/ai/chat', { message: 'جهز لي سلة بـ ٢٠ دينار' })).body;
  assert.equal(chat.intent, 'budget_basket');
  const basket = chat.basket;
  assert.equal(basket.budget, 20); assert.ok(basket.total <= 20); assert.ok(basket.usedPercent >= 70, `uses the budget (${basket.usedPercent}%)`);
  assert.ok(basket.items.length >= 4);
  assert.ok(basket.items.every((i) => ['fresh', 'dairy', 'bakery', 'drinks'].includes(i.product.category)));
  const direct = (await request('POST', '/ai/basket', { budget: 5, prompt: 'فطور' })).body.basket;
  assert.ok(direct.total <= 5 && direct.items.length >= 2);
  assert.equal((await request('POST', '/ai/basket', { prompt: 'سلة' })).status, 400, 'needs a budget');
});

test('L073 weekly budget planner tracks this week’s spending', async (t) => {
  const { request, register, order } = await fixture(t);
  const customer = await register();
  assert.equal((await request('GET', '/me/budget', undefined, customer.token)).body.budget.weeklyBudget, null);
  await request('PATCH', '/me/preferences', { weeklyBudget: 18 }, customer.token);
  await order(customer, [{ productId: 'rice', quantity: 2 }]);
  const budget = (await request('GET', '/me/budget', undefined, customer.token)).body.budget;
  assert.equal(budget.spent, 15.5); assert.equal(budget.remaining, 2.5); assert.equal(budget.percent, 86); assert.match(budget.warning, /اقتربت/);
  assert.equal(budget.byCategory.pantry, 13);
  const quote = (await request('POST', '/checkout/quote', { items: [{ productId: 'olive-oil', quantity: 1 }], address: { city: 'عمان' } }, customer.token)).body;
  assert.equal(quote.budget.exceeds, true);
});

test('L076 voice and text commands become structured actions', async (t) => {
  const { request } = await fixture(t);
  const command = async (text) => (await request('POST', '/ai/command', { text })).body.command;
  assert.deepEqual(await command('أضف ٢ حليب للسلة'), { intent: 'add_to_cart', productId: 'milk', name: 'حليب طازج كامل الدسم', quantity: 2, reply: 'أضفت 2 × حليب طازج كامل الدسم إلى السلة' });
  assert.equal((await command('احذف الخبز من السلة')).productId, 'bread');
  assert.equal((await command('افتح طلباتي')).path, '/orders');
  assert.equal((await command('وين طلبي؟')).intent, 'track_order');
  assert.equal((await command('يا لقطي اقفز')).motion, 'jump');
  assert.equal((await command('ابحث عن قهوة')).query, 'قهوه');
  assert.equal((await command('وصفة كبسة')).recipeId, 'kabsa');
});

test('L077 recipes become a costed shopping list scaled to the number of people', async (t) => {
  const { request } = await fixture(t);
  const kabsa = (await request('POST', '/ai/recipe', { text: 'كبسة دجاج', servings: 8 })).body.recipe;
  assert.equal(kabsa.id, 'kabsa'); assert.equal(kabsa.missing.length, 0);
  assert.deepEqual(kabsa.ingredients.map((i) => i.product.id), ['rice', 'chicken', 'onion', 'tomato', 'olive-oil']);
  assert.ok(kabsa.ingredients.every((i) => i.quantity === 2));
  assert.equal(kabsa.total, 36.9);
  assert.equal((await request('POST', '/ai/recipe', { text: 'سوشي' })).body.code, 'recipe_not_found');
  assert.ok((await request('GET', '/ai/recipes')).body.recipes.length >= 8);
});

test('L078 pasted receipts or notes are matched to products with quantities', async (t) => {
  const { request } = await fixture(t);
  const parsed = (await request('POST', '/ai/parse-list', { text: '2 حليب\nخبز عربي x3\nثلاث علب تونة\nطماطم ١' })).body;
  const byName = Object.fromEntries(parsed.items.map((i) => [i.name, i]));
  assert.equal(byName['حليب'].product.id, 'milk'); assert.equal(byName['حليب'].quantity, 2);
  assert.equal(byName['خبز عربي'].quantity, 3); assert.equal(byName['طماطم'].product.id, 'tomato');
  assert.deepEqual(parsed.unmatched, ['تونه']);
  assert.equal(parsed.total, 4.2);
});

test('L079 recommendations use interests and history unless personalisation is switched off', async (t) => {
  const { request, register, order } = await fixture(t);
  const customer = await register();
  await request('PATCH', '/me/preferences', { interests: ['bakery'], onboarded: true }, customer.token);
  const personal = (await request('GET', '/recommendations?limit=4', undefined, customer.token)).body;
  assert.equal(personal.personalized, true); assert.ok(personal.products.slice(0, 2).every((p) => p.category === 'bakery'));
  assert.equal(personal.products[0].reason, 'من اهتماماتك');
  await order(customer, [{ productId: 'headphones', quantity: 1 }]);
  const afterOrder = (await request('GET', '/recommendations?limit=20', undefined, customer.token)).body.products;
  assert.equal(afterOrder.some((p) => p.id === 'headphones'), false, 'does not push what was just bought');
  await request('PATCH', '/me/preferences', { privacy: { personalizedRecommendations: false } }, customer.token);
  const generic = (await request('GET', '/recommendations?limit=4', undefined, customer.token)).body;
  assert.equal(generic.personalized, false); assert.ok(generic.products.every((p) => p.reason !== 'من اهتماماتك'));
});
