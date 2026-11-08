import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, pngDataUrl } from './testkit.mjs';

test('L080 L097 order-linked chat is answered by the bot using the order and the FAQ', async (t) => {
  const { request, register, order } = await fixture(t);
  const customer = await register('سلمى');
  const placed = await order(customer, [{ productId: 'milk', quantity: 1 }]);
  const chat = (await request('POST', '/support/chats', { orderId: placed.id, message: 'وين طلبي؟' }, customer.token)).body.chat;
  assert.equal(chat.orderId, placed.id); assert.equal(chat.status, 'bot');
  assert.match(chat.messages[0].body, /سلمى/); assert.match(chat.messages.at(-1).body, /بانتظار التأكيد/);
  const cancel = (await request('POST', `/support/chats/${chat.id}/messages`, { message: 'أبي ألغي الطلب' }, customer.token)).body.chat;
  assert.match(cancel.messages.at(-1).body, /إلغاء هذا الطلب الآن/);
  const faq = (await request('POST', `/support/chats/${chat.id}/messages`, { message: 'ما طرق الدفع؟' }, customer.token)).body.chat;
  assert.match(faq.messages.at(-1).body, /الدفع عند الاستلام/);
  const lost = (await request('POST', `/support/chats/${chat.id}/messages`, { message: 'قطط فضائية' }, customer.token)).body.chat;
  assert.match(lost.messages.at(-1).body, /طلب موظف/);
  assert.equal((await request('POST', '/support/chats', { orderId: placed.id, message: 'x' }, (await register()).token)).status, 403, 'only the order owner');
});

test('L098 L099 asking for a human hands over the chat, notifies staff and keeps image attachments', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  const chat = (await request('POST', '/support/chats', { message: 'المنتج وصل مكسورًا', image: pngDataUrl([90, 90, 90]) }, customer.token)).body.chat;
  const photo = chat.messages.find((m) => m.uploadId);
  assert.ok(photo); assert.match((await request('GET', `/uploads/${photo.uploadId}`, undefined, admin.token)).body.upload.dataUrl, /^data:image\/png/);
  assert.equal((await request('POST', '/uploads', { image: 'data:image/png;base64,' + Buffer.from('fake').toString('base64') }, customer.token)).body.code, 'invalid_upload', 'content must match its type');
  const handed = (await request('POST', `/support/chats/${chat.id}/messages`, { message: 'أريد التحدث مع موظف' }, customer.token)).body.chat;
  assert.equal(handed.status, 'human');
  assert.ok((await request('GET', '/notifications', undefined, admin.token)).body.notifications.some((n) => n.title === 'طلب دعم بشري'));
  const queue = (await request('GET', '/admin/chats?status=human', undefined, admin.token)).body.chats;
  assert.equal(queue[0].id, chat.id);
  const replied = (await request('POST', `/admin/chats/${chat.id}/messages`, { message: 'نعتذر! سنرسل بديلًا اليوم' }, admin.token)).body.chat;
  assert.equal(replied.messages.at(-1).sender, 'agent');
  const quiet = (await request('POST', `/support/chats/${chat.id}/messages`, { message: 'شكرًا' }, customer.token)).body.chat;
  assert.equal(quiet.messages.at(-1).sender, 'user', 'the bot stays quiet while a human handles the chat');
  assert.equal((await request('PATCH', `/admin/chats/${chat.id}`, { status: 'resolved' }, admin.token)).body.chat.status, 'resolved');
});

test('L096 L100 tickets and the searchable help center', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  const ticket = await request('POST', '/tickets', { subject: 'استفسار فاتورة', message: 'أحتاج فاتورة ضريبية للطلب' }, customer.token);
  assert.equal(ticket.status, 201);
  assert.equal((await request('POST', `/admin/tickets/${ticket.body.ticket.id}/replies`, { message: 'أرسلناها إلى بريدك' }, admin.token)).status, 201);
  const faqs = (await request('GET', '/faqs')).body;
  assert.ok(faqs.faqs.length >= 10); assert.ok(faqs.categories.includes('delivery'));
  assert.equal((await request('GET', `/faqs?q=${encodeURIComponent('نسيت كلمة السر')}`)).body.faqs[0].category, 'account');
  const created = await request('POST', '/admin/faqs', { category: 'delivery', question: 'هل توصلون يوم الجمعة؟', answer: 'نعم، من 2 ظهرًا حتى 10 مساءً.', keywords: 'جمعه عطله' }, admin.token);
  assert.equal(created.status, 201);
  assert.equal((await request('GET', `/faqs?q=${encodeURIComponent('الجمعة')}`)).body.faqs[0].id, created.body.faq.id);
  assert.equal((await request('POST', `/faqs/${created.body.faq.id}/helpful`, {})).status, 200);
});

test('L083 L084 L124 character and language preferences are saved and validated', async (t) => {
  const { request, register } = await fixture(t);
  const customer = await register();
  // The companion is the mockups' character: its look (skin, hair, clothes, beard, accessory) is part of the preference.
  const robot = { name: 'بيبو', color: '#FF6B4A', outfit: 'cape', accessory: 'glasses', size: 1.2, reduceMotion: true, voice: false, motion: 'dance',
    skin: '#8D5524', hair: '#111111', pants: '#1F2A44', boots: '#5A3A22', beard: false, use3d: false };
  const saved = (await request('PATCH', '/me/preferences', { robot, locale: 'en' }, customer.token)).body.preferences;
  assert.deepEqual(saved.robot, { ...robot, faceConsent: false }); assert.equal(saved.locale, 'en');
  assert.equal((await request('PATCH', '/me/preferences', { robot: { skin: 'brown' } }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/preferences', { robot: { beard: 'yes' } }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/preferences', { robot: { size: 3 } }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/preferences', { robot: { outfit: 'tuxedo' } }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/preferences', { robot: { color: 'red' } }, customer.token)).status, 400);
  assert.equal((await request('PATCH', '/me/preferences', { locale: 'fr' }, customer.token)).status, 400);
  assert.equal((await request('GET', '/me/preferences', undefined, customer.token)).body.preferences.robot.outfit, 'cape');
});

test('L090 pantry tracks expiry from delivered groceries, warns once and counts carbon savings', async (t) => {
  const { request, register, order, deliver } = await fixture(t);
  const customer = await register();
  const placed = await order(customer, [{ productId: 'milk', quantity: 1 }, { productId: 'headphones', quantity: 1 }]);
  await deliver(customer, placed.id);
  let pantry = (await request('GET', '/pantry', undefined, customer.token)).body;
  assert.equal(pantry.items.length, 1, 'only perishable products are added'); assert.equal(pantry.items[0].productId, 'milk'); assert.equal(pantry.items[0].daysLeft, 7);
  const soon = new Date(Date.now() + 180 * 60_000 + 86400_000).toISOString().slice(0, 10);
  const yogurt = (await request('POST', '/pantry', { name: 'لبن منزلي', category: 'dairy', expiresOn: soon, quantity: 2 }, customer.token)).body.item;
  assert.equal(yogurt.freshness, 'soon');
  pantry = (await request('GET', '/pantry', undefined, customer.token)).body;
  await request('GET', '/pantry', undefined, customer.token);
  assert.equal((await request('GET', '/notifications', undefined, customer.token)).body.notifications.filter((n) => n.title === 'منتجات تقترب من انتهاء صلاحيتها').length, 1, 'warns once');
  const consumed = (await request('PATCH', `/pantry/${yogurt.id}`, { status: 'consumed' }, customer.token)).body;
  assert.equal(consumed.stats.carbonSavedKg, 2.4); assert.equal(consumed.stats.consumed, 1);
  const wasted = (await request('PATCH', `/pantry/${pantry.items.find((i) => i.productId === 'milk').id}`, { status: 'wasted' }, customer.token)).body;
  assert.equal(wasted.stats.wasteRate, 50);
  assert.equal((await request('POST', '/pantry', { name: 'x', expiresOn: '31/12/2026' }, customer.token)).status, 400);
});

test('L125 display currency rates are managed by staff and published with the settings', async (t) => {
  const { request, register, admin } = await fixture(t);
  const customer = await register();
  assert.equal((await request('GET', '/settings')).body.settings.displayCurrencies.USD, 1.41);
  assert.equal((await request('PUT', '/admin/currency-rates', { rates: { USD: 1.4 } }, customer.token)).status, 403);
  assert.equal((await request('PUT', '/admin/currency-rates', { rates: { JOD: 1 } }, admin.token)).status, 400, 'the store currency is the base');
  assert.equal((await request('PUT', '/admin/currency-rates', { rates: { usd: 1 } }, admin.token)).status, 400);
  const saved = (await request('PUT', '/admin/currency-rates', { rates: { USD: 1.41, EUR: 1.29, SAR: 5.3 } }, admin.token)).body;
  assert.equal(saved.base, 'JOD');
  assert.deepEqual((await request('GET', '/settings')).body.settings.displayCurrencies, { USD: 1.41, EUR: 1.29, SAR: 5.3 });
  await request('PATCH', '/me/preferences', { displayCurrency: 'EUR' }, customer.token);
  assert.equal((await request('GET', '/me/preferences', undefined, customer.token)).body.preferences.displayCurrency, 'EUR');
});
