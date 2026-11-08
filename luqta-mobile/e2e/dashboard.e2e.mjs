// End-to-end checks of every dashboard feature: the central dashboard (dashboard/index.html, #luqta/<section>) is
// served as static files, the store admin signs in to the real commerce server, and each section is driven in Chromium
// the way a merchant would use it. Results are confirmed through the server API. Titles cite the feature ids.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStack, until, noErrors, password, ORIGIN, DASHBOARD } from './harness.mjs';
import { pngDataUrl } from '../server/testkit.mjs';

const ARTIFACTS = fileURLToPath(new URL('./artifacts/', import.meta.url));
let stack, board;
const api = (...args) => stack.api(...args);
const asAdmin = (method, path, body) => api(method, path, body, stack.admin.token);
const products = async () => Object.fromEntries((await asAdmin('GET', '/admin/products')).products.map((p) => [p.id, p]));

// One signed-in dashboard page for the whole file (the session lives only in that page's memory).
async function signIn(page) {
  await page.goto(`${DASHBOARD}/#luqta`, { waitUntil: 'domcontentloaded' });
  const root = page.locator('#luqta-root');
  await root.locator('input[name="url"]').fill(ORIGIN);
  await root.locator('input[name="email"]').fill('admin@e2e.test');
  await root.locator('input[name="password"]').fill(password);
  await root.getByRole('button', { name: 'دخول وفحص الاتصال' }).click();
  await root.getByText(`متصل: ${ORIGIN}`).waitFor();
}
before(async () => {
  stack = await startStack();
  board = await stack.newPage({ locale: 'ar-JO' });
  await board.setViewportSize({ width: 1280, height: 900 });
  board.setDefaultTimeout(20_000);
  board.dialogs = [];
  board.on('dialog', (dialog) => { board.dialogs.push(dialog.message()); void dialog.accept(dialog.type() === 'prompt' ? 'رد فريق الدعم: تم التحقق' : undefined); });
  await signIn(board);
});
after(async () => { await stack?.close(); });

const root = () => board.locator('#luqta-root');
const status = () => root().locator(':scope > p.small').last();
// Opens a section through its deep link (or refreshes it when it is already open) and waits for its own content.
const section = async (name, ready) => {
  const target = name === 'overview' ? '#luqta' : `#luqta/${name}`;
  if ((await board.evaluate(() => location.hash)) === target) {
    await click('تحديث');
    await until(async () => /اكتملت العملية/.test(await status().innerText()), 15000, `section ${name} refreshed`);
  } else await board.evaluate((hash) => { location.hash = hash; }, target);
  if (ready) await root().getByText(ready, { exact: false }).first().waitFor();
  await until(async () => { const t = await status().innerText(); return !!t && !t.startsWith('جارٍ'); }, 15000, `section ${name} loaded`);
};
// Actions clear the status line first, so waiting for a confirmation never matches the previous one.
const clearStatus = () => status().evaluate((el) => { el.textContent = ''; }).catch(() => {});
const click = async (name, scope = root()) => { await clearStatus(); await scope.getByRole('button', { name, exact: true }).first().click(); };
const done = async (pattern) => until(async () => { const t = await status().innerText(); if (/تعذر|غير صالح|فشل|خطأ/.test(t) && !pattern.test(t)) throw new Error(t); return pattern.test(t); }, 15000, `status ${pattern}`);
const formByTitle = (title) => root().locator('form').filter({ has: board.getByRole('heading', { name: title, exact: true }) }).first();
const fillForm = async (title, values) => { const f = formByTitle(title); for (const [name, v] of Object.entries(values)) { const input = f.locator(`[name="${name}"]`).first(); if ((await input.evaluate((e) => e.tagName)) === 'SELECT') await input.selectOption(v); else await input.fill(String(v)); } return f; };
// Clicks a button that runs a server action, then waits until that action and the re-render it causes are finished.
const press = async (scope, name) => {
  await clearStatus();
  await scope.getByRole('button', { name, exact: true }).first().click();
  await until(async () => { const t = await status().innerText(); if (/تعذر|غير صالح|فشل/.test(t)) throw new Error(t); return !!t && !t.startsWith('جارٍ'); }, 15000, `${name} finished`);
};
const submit = async (title, label) => { await clearStatus(); await formByTitle(title).getByRole('button', { name: label, exact: true }).click(); };
const row = (text) => root().locator('tr').filter({ hasText: text }).first();
// The row whose own id cell is exactly this id (a variant row also mentions its parent id).
const rowById = (rowId) => root().locator('tr').filter({ has: board.locator('td', { hasText: new RegExp(`^${rowId}$`) }) }).first();

const e2e = (title, fn) => test(title, { timeout: 180_000 }, async () => {
  try {
    await fn();
    noErrors(board);
  } catch (error) {
    mkdirSync(ARTIFACTS, { recursive: true });
    await board.screenshot({ path: `${ARTIFACTS}dashboard-${title.slice(0, 40).replace(/[^\w]+/g, '_')}.png`, fullPage: true }).catch(() => {});
    throw error;
  }
});

// =====================================================================================================
e2e('L001 L101 the admin signs in to the dashboard, sees live KPIs and the latest orders, signs out and back in', async () => {
  const shopper = await stack.register('عميل اللوحة');
  const order = await stack.order(shopper, [{ productId: 'milk', quantity: 2 }]);
  await section('overview', 'مبيعات اليوم');
  const { kpis } = await asAdmin('GET', '/admin/kpis');
  const tile = (label) => root().locator('.kpi').filter({ has: board.locator('.label', { hasText: label }) }).locator('.value').first();
  assert.equal(await tile('طلبات نشطة').innerText(), kpis.activeOrders.toLocaleString('ar-JO'));
  await row(order.id).waitFor();
  await click('تسجيل الخروج');
  await root().getByRole('button', { name: 'دخول وفحص الاتصال' }).waitFor();
  // A wrong password is refused and nothing is stored in the browser.
  await root().locator('input[name="url"]').fill(ORIGIN);
  await root().locator('input[name="email"]').fill('admin@e2e.test');
  await root().locator('input[name="password"]').fill('wrong-password-000');
  await click('دخول وفحص الاتصال');
  await until(async () => /غير صحيحة|غير صالحة|تعذر/.test(await root().innerText()), 10000, 'login refused');
  assert.equal(await board.evaluate(() => JSON.stringify(localStorage).includes('wrong-password') || JSON.stringify(sessionStorage).includes('admin@e2e.test')), false);
  await signIn(board);
});

e2e('L013 L018 L019 L020 L102 products: create one with a gallery, video, specifications and barcode, add a size variant, edit and archive', async () => {
  await section('products', 'إنشاء أو تعديل صنف');
  const title = 'إنشاء أو تعديل صنف';
  assert.equal(await root().getByText(/^الأصناف: /).first().innerText(), `الأصناف: ${Object.keys(await products()).length.toLocaleString('ar-JO')}`);
  await fillForm(title, { id: 'dash-scarf', name: 'وشاح صوف', price: '12.5', stock: '9', category: 'fashion', brand: 'لُقطة', images: 'https://cdn.example.com/scarf-1.jpg\nhttps://cdn.example.com/scarf-2.jpg', video: 'https://cdn.example.com/scarf.mp4', specs: 'الخامة: صوف ميرينو\nالطول: 180 سم', barcode: '6250000009991' });
  await submit(title, 'حفظ الصنف');
  await done(/حُفظ الصنف/);
  await until(async () => (await rowById('dash-scarf').count()) > 0, 10000, 'listed');
  assert.match(await rowById('dash-scarf').innerText(), /٢ صور/);
  assert.match(await rowById('dash-scarf').innerText(), /فيديو/);
  assert.match(await rowById('dash-scarf').innerText(), /٢ مواصفات/);
  let scarf = (await products())['dash-scarf'];
  assert.deepEqual(scarf.images, ['https://cdn.example.com/scarf-1.jpg', 'https://cdn.example.com/scarf-2.jpg']);
  assert.equal(scarf.video, 'https://cdn.example.com/scarf.mp4');
  assert.deepEqual(scarf.specs, [{ label: 'الخامة', value: 'صوف ميرينو' }, { label: 'الطول', value: '180 سم' }]);
  assert.equal(scarf.barcode, '6250000009991');
  assert.equal((await api('GET', '/products/barcode/6250000009991')).product.id, 'dash-scarf');
  // A colour variant with its own stock.
  await fillForm(title, { id: 'dash-scarf-red', name: 'وشاح صوف', price: '12.5', stock: '3', category: 'fashion', variantOf: 'dash-scarf', variantLabel: 'أحمر' });
  await submit(title, 'حفظ الصنف');
  await done(/حُفظ الصنف/);
  await until(async () => /متغير من dash-scarf/.test(await rowById('dash-scarf-red').innerText()), 10000, 'variant listed');
  const parent = (await api('GET', '/products/dash-scarf')).product;
  assert.equal(parent.hasVariants, true);
  // Edit keeps the gallery and changes the price.
  await rowById('dash-scarf').getByRole('button', { name: 'تعديل', exact: true }).click();
  assert.equal(await formByTitle(title).locator('[name="images"]').inputValue(), 'https://cdn.example.com/scarf-1.jpg\nhttps://cdn.example.com/scarf-2.jpg');
  assert.equal(await formByTitle(title).locator('[name="price"]').inputValue(), '12.5');
  assert.equal(await formByTitle(title).locator('[name="stock"]').inputValue(), '9', 'own stock, not the sum with its sizes');
  await formByTitle(title).locator('[name="price"]').fill('11');
  await submit(title, 'حفظ الصنف');
  await done(/حُفظ الصنف/);
  scarf = (await products())['dash-scarf'];
  assert.equal(scarf.basePrice, 11, 'the product price changed');
  assert.equal(scarf.baseStock, 9, 'its own stock is kept, not the sum of its sizes');
  assert.equal(scarf.price, 12.5, 'shoppers buy a size, so the listed price is the cheapest size');
  assert.equal(scarf.images.length, 2);
  await rowById('dash-scarf-red').getByRole('button', { name: 'أرشفة', exact: true }).click();
  await until(async () => (await products())['dash-scarf-red'].active === false, 10000, 'archived');
});

e2e('L017 L103 categories: add, hide and delete a catalog section', async () => {
  await section('categories', 'قسم جديد');
  await fillForm('قسم جديد', { id: 'organic', name: 'منتجات عضوية', nameEn: 'Organic', icon: 'leaf', color: '#2E7D32' });
  await submit('قسم جديد', 'إضافة القسم');
  await done(/أُضيف القسم/);
  await row('organic').waitFor();
  assert.ok((await api('GET', '/categories')).categories.some((c) => c.id === 'organic'));
  await press(row('organic'), 'إخفاء');
  await until(async () => !(await api('GET', '/categories')).categories.some((c) => c.id === 'organic'), 10000, 'hidden from the app');
  await press(row('organic'), 'حذف');
  await until(async () => !(await asAdmin('GET', '/admin/categories')).categories.some((c) => c.id === 'organic'), 10000, 'deleted');
});

e2e('L104 L105 inventory: preview the differences, import, then undo the import', async () => {
  await section('inventory', 'استيراد CSV إلى قاعدة بيانات المتجر');
  const importer = formByTitle('استيراد CSV إلى قاعدة بيانات المتجر');
  const before = await products();
  await importer.locator('[name="csv"]').fill('id,name,price,stock,category\nwater,مياه معدنية,1.5,70,drinks\ndash-new,صنف جديد,3,10,pantry\n,بلا معرف,1,1,drinks');
  await click('معاينة الفروقات قبل الاستيراد', importer);
  await done(/اكتملت المعاينة/);
  const preview = importer.locator('.import-preview');
  await until(async () => /جديد ١ · متغيّر ١ .* مرفوض ١/.test(await preview.innerText()), 10000, 'diff summary');
  assert.match(await preview.innerText(), /stock: 80 ← 70|stock: 80 → 70|80/);
  const unchanged = await products();
  assert.equal(unchanged.water.stock, before.water.stock, 'preview changes nothing');
  assert.equal(unchanged['dash-new'], undefined);
  await importer.locator('[name="csv"]').fill('id,name,price,stock,category\nwater,مياه معدنية,1.5,70,drinks\ndash-new,صنف جديد,3,10,pantry');
  await importer.getByRole('button', { name: 'استيراد الأصناف', exact: true }).click();
  await done(/استُورد/);
  const imported = await products();
  assert.equal(imported.water.stock, 70);
  assert.ok(imported['dash-new']);
  await until(async () => (await root().getByRole('button', { name: 'التراجع عن آخر استيراد' }).count()) > 0, 10000, 'undo offered');
  await click('التراجع عن آخر استيراد');
  await until(async () => (await products()).water.stock === before.water.stock, 10000, 'stock restored');
  const restored = await products();
  assert.ok(!restored['dash-new'] || restored['dash-new'].active === false, 'the new item is removed again');
});

e2e('L021 L113 branches: open a branch and change its stock with version checks', async () => {
  await section('branches', 'فرع جديد');
  await fillForm('فرع جديد', { name: 'فرع الزرقاء الجديدة', city: 'الزرقاء', address: 'شارع الملك عبدالله', phone: '+96253900000', hours: '9:00–21:00', lat: '32.07', lng: '36.09' });
  await submit('فرع جديد', 'إضافة الفرع');
  await done(/أُ/);
  await row('فرع الزرقاء الجديدة').waitFor();
  assert.ok((await api('GET', '/branches')).branches.some((b) => b.name === 'فرع الزرقاء الجديدة'));
  await row('br_amman').count();
  const amman = (await asAdmin('GET', '/admin/branches')).branches.find((b) => b.id === 'br_amman');
  await row(amman.name).getByRole('button', { name: 'مخزونه', exact: true }).click();
  await root().getByText('مخزون الفرع br_amman').waitFor();
  const before = (await asAdmin('GET', '/admin/branch-stock?branch=br_amman')).stock.find((r) => r.productId === 'milk');
  const milkRow = root().locator('tr').filter({ has: board.locator('input[aria-label="كمية حليب طازج كامل الدسم"]') }).first();
  await milkRow.locator('input').fill('41');
  await press(milkRow, 'حفظ');
  await done(/اكتملت العملية/);
  const after = (await asAdmin('GET', '/admin/branch-stock?branch=br_amman')).stock.find((r) => r.productId === 'milk');
  assert.equal(after.quantity, 41);
  assert.equal(after.version, before.version + 1);
});

e2e('L040 L041 L094 delivery zones, fees and the capacity of time slots', async () => {
  await section('zones', 'منطقة توصيل جديدة');
  await fillForm('منطقة توصيل جديدة', { name: 'السلط', cities: 'السلط، الفحيص', fee: '3.25', freeOver: '50', minOrder: '10', eta: '150' });
  await submit('منطقة توصيل جديدة', 'إضافة المنطقة');
  await done(/أُ/);
  await row('السلط').waitFor();
  const quote = await api('POST', '/checkout/quote', { items: [{ productId: 'rice', quantity: 2 }], address: { city: 'الفحيص' } });
  assert.equal(quote.zone.name, 'السلط');
  assert.equal(quote.shipping, 3.25);
  const zoneRow = row('السلط');
  await zoneRow.locator('input').fill('2.75');
  await press(zoneRow, 'حفظ');
  await until(async () => (await api('POST', '/checkout/quote', { items: [{ productId: 'rice', quantity: 2 }], address: { city: 'السلط' } })).shipping === 2.75, 10000, 'fee updated');
  const { slots } = await asAdmin('GET', '/admin/slots?days=7');
  const slotInput = board.locator(`input[aria-label="سعة ${slots[0].date} ${slots[0].window}"]`);
  await slotInput.fill(String(slots[0].capacity + 7));
  await press(root().locator('tr').filter({ has: slotInput }), 'حفظ');
  await until(async () => (await asAdmin('GET', '/admin/slots?days=7')).slots[0].capacity === slots[0].capacity + 7, 10000, 'capacity saved');
  assert.equal((await api('GET', '/delivery/slots?days=7')).slots.find((s) => s.date === slots[0].date && s.window === slots[0].window).remaining, slots[0].capacity + 7 - slots[0].booked);
});

e2e('L067 L068 L069 offers, a flash deal with a quantity limit, and a home-screen campaign', async () => {
  await section('offers', 'العروض النشطة');
  await row('سماعات هدوء لاسلكية').waitFor();
  await fillForm('استيراد العروض إلى قاعدة المتجر', { offers: JSON.stringify([{ id: 'mug', price: 49, oldPrice: 59 }]) });
  await submit('استيراد العروض إلى قاعدة المتجر', 'معاينة وتأكيد العروض');
  await until(async () => (await products()).mug.price === 49, 10000, 'offer applied');
  assert.equal((await products()).mug.oldPrice, 59);
  await section('flash', 'عرض خاطف جديد');
  await fillForm('عرض خاطف جديد', { productId: 'banana', price: '0.75', hours: '6', limit: '15' });
  await submit('عرض خاطف جديد', 'إطلاق العرض');
  await done(/انطلق العرض/);
  const deal = (await api('GET', '/flash-deals')).deals.find((d) => d.productId === 'banana');
  assert.equal(deal.price, 0.75);
  assert.equal(deal.limit, 15);
  await press(row('موز'), 'إيقاف');
  await until(async () => !(await api('GET', '/flash-deals')).deals.some((d) => d.productId === 'banana'), 10000, 'deal stopped');
  await section('campaigns', 'حملة جديدة');
  await fillForm('حملة جديدة', { title: 'أسبوع القهوة', subtitle: 'خصم على القهوة العربية', link: '/explore?category=drinks', cta: 'اكتشف', color: '#6D4C41', days: '5' });
  await submit('حملة جديدة', 'نشر الحملة');
  await done(/نُشرت الحملة/);
  const campaign = (await api('GET', '/campaigns')).campaigns.find((c) => c.title === 'أسبوع القهوة');
  assert.equal(campaign.link, '/explore?category=drinks');
  await press(row('أسبوع القهوة'), 'إيقاف');
  await until(async () => !(await api('GET', '/campaigns')).campaigns.some((c) => c.title === 'أسبوع القهوة'), 10000, 'campaign paused');
});

e2e('L029 answer a customer question officially from the dashboard', async () => {
  const shopper = await stack.register('سائل اللوحة');
  await api('POST', '/products/olive-oil/questions', { question: 'هل الزيت من عصرة أولى؟' }, shopper.token);
  await section('questions', 'أسئلة العملاء بانتظار رد رسمي');
  const title = 'زيت زيتون بكر: هل الزيت من عصرة أولى؟';
  await fillForm(title, { answer: 'نعم، عصرة أولى على البارد من شمال الأردن.' });
  await submit(title, 'إرسال الرد الرسمي');
  await done(/نُشر الرد الرسمي/);
  const { questions } = await api('GET', '/products/olive-oil/questions');
  const answer = questions.find((q) => q.question === 'هل الزيت من عصرة أولى؟').answers[0];
  assert.equal(answer.official, true);
  assert.match(answer.answer, /عصرة أولى/);
});

e2e('L039 L109 coupons: create a fixed discount, see it applied in checkout, then disable it', async () => {
  await section('coupons', 'إنشاء أو تعديل قسيمة');
  await fillForm('إنشاء أو تعديل قسيمة', { code: 'DASH5', type: 'fixed', value: '5', minSubtotal: '20' });
  await submit('إنشاء أو تعديل قسيمة', 'حفظ القسيمة');
  await done(/حُفظت القسيمة/);
  await row('DASH5').waitFor();
  const items = [{ productId: 'olive-oil', quantity: 4 }];
  assert.equal((await api('POST', '/checkout/quote', { items, couponCode: 'DASH5', address: { city: 'عمان' } })).discount, 5);
  await press(row('DASH5'), 'تعطيل');
  await until(async () => (await api('POST', '/checkout/quote', { items, couponCode: 'DASH5', address: { city: 'عمان' } })).discount === 0, 10000, 'coupon disabled');
});

e2e('L048 issue a gift card that a customer redeems into the wallet', async () => {
  const shopper = await stack.register('مستلم بطاقة');
  await section('giftcards', 'إصدار بطاقة هدية');
  await fillForm('إصدار بطاقة هدية', { amount: '12', note: 'عيد ميلاد', email: shopper.user.email, days: '30' });
  await submit('إصدار بطاقة هدية', 'إصدار');
  await done(/أُصدرت البطاقة LQ-/);
  const code = (await status().innerText()).match(/LQ-[A-Z0-9-]+/)[0];
  assert.ok((await api('GET', '/notifications', undefined, shopper.token)).notifications.some((n) => n.body.includes(code)), 'the customer is notified with the code');
  await api('POST', '/gift-cards/redeem', { code }, shopper.token);
  assert.equal((await api('GET', '/wallet', undefined, shopper.token)).balance, 12);
  await click('تحديث');
  await until(async () => /مستخدمة/.test(await row('عيد ميلاد').innerText()), 10000, 'card shown as used');
});

e2e('L058 L091 L107 orders: assign a driver, advance the status, download the invoice and check tracking', async () => {
  const shopper = await stack.register('عميل الطلبات');
  const order = await stack.order(shopper, [{ productId: 'eggs', quantity: 1 }]);
  const driver = await stack.ensureDriver();
  await section('orders', order.id);
  const orderRow = () => row(order.id);
  await orderRow().locator('select').selectOption(driver.user.id);
  await press(orderRow(), 'تعيين السائق');
  await until(async () => (await asAdmin('GET', '/admin/orders')).orders.find((o) => o.id === order.id).driverId === driver.user.id, 10000, 'driver assigned');
  await press(orderRow(), 'إلى confirmed');
  await until(async () => (await asAdmin('GET', '/admin/orders')).orders.find((o) => o.id === order.id).status === 'confirmed', 10000, 'confirmed');
  await press(orderRow(), 'إلى preparing');
  await until(async () => (await asAdmin('GET', '/admin/orders')).orders.find((o) => o.id === order.id).status === 'preparing', 10000, 'preparing');
  assert.ok((await api('GET', '/driver/orders', undefined, driver.token)).orders.some((o) => o.id === order.id), 'the driver sees the assignment');
  const [download] = await Promise.all([board.waitForEvent('download'), orderRow().getByRole('button', { name: 'الفاتورة', exact: true }).click()]);
  assert.match(download.suggestedFilename(), /^INV-.*\.html$/);
  const html = readFileSync(await download.path(), 'utf8');
  assert.ok(html.includes(order.id) && html.includes('بيض بلدي'));
  await orderRow().getByRole('button', { name: 'تتبع', exact: true }).click();
  await done(/لم يشارك السائق موقعه بعد|موقع السائق الفعلي/);
});

e2e('L056 L057 L108 returns: see the chosen items and photo, approve and refund to the wallet', async () => {
  const shopper = await stack.register('مُرجِع اللوحة');
  const order = await stack.order(shopper, [{ productId: 'milk', quantity: 3 }, { productId: 'rice', quantity: 1 }]);
  await stack.deliver(shopper, order.id);
  const { returnRequest } = await api('POST', `/orders/${order.id}/return-request`, { reason: 'تالف — العبوة مثقوبة', items: [{ productId: 'milk', quantity: 1 }], photo: pngDataUrl([210, 40, 40]) }, shopper.token);
  await section('returns', order.id);
  await row(order.id).getByRole('button', { name: 'التفاصيل', exact: true }).click();
  const details = root().locator(`[data-return-details="${returnRequest.id}"]`);
  await details.waitFor();
  assert.match(await details.innerText(), /حليب طازج كامل الدسم × ١/);
  await details.getByRole('img', { name: 'صورة المنتج المرتجع' }).waitFor();
  assert.ok(await details.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0));
  await press(row(order.id), 'قبول ورد المحفظة');
  await until(async () => (await asAdmin('GET', '/admin/returns')).returns.find((r) => r.id === returnRequest.id).status === 'approved', 10000, 'approved');
  assert.equal((await api('GET', '/wallet', undefined, shopper.token)).balance, returnRequest.refund);
  assert.ok(board.dialogs.some((m) => m.includes('ملاحظة القرار')) && board.dialogs.some((m) => m.includes('قبول ورد المحفظة')), 'note prompt and confirmation shown');
});

e2e('L001 L110 customers and wallet: balances, an audited wallet adjustment and a role change', async () => {
  const shopper = await stack.register('عميل المحفظة');
  await section('users', 'تعديل رصيد المحفظة بإجراء مدقق');
  await row(shopper.user.email).waitFor();
  assert.match(await row(shopper.user.email).innerText(), /عميل المحفظة/);
  await row(shopper.user.email).getByRole('button', { name: 'للمحفظة', exact: true }).click();
  assert.equal(await formByTitle('تعديل رصيد المحفظة بإجراء مدقق').locator('[name="userId"]').inputValue(), shopper.user.id);
  await fillForm('تعديل رصيد المحفظة بإجراء مدقق', { amount: '7.5', note: 'تعويض عن تأخير التوصيل' });
  await submit('تعديل رصيد المحفظة بإجراء مدقق', 'إضافة الحركة');
  await done(/الرصيد الجديد/);
  assert.equal((await api('GET', '/wallet', undefined, shopper.token)).balance, 7.5);
  await until(async () => (await row(shopper.user.email).innerText()).includes('7.500 د.أ'), 10000, 'balance column');
  await row(shopper.user.email).locator('select').selectOption('driver');
  await press(row(shopper.user.email), 'تغيير الدور');
  await until(async () => (await asAdmin('GET', '/admin/users')).users.find((u) => u.id === shopper.user.id).role === 'driver', 10000, 'role changed');
});

e2e('L096 support tickets: reply and close', async () => {
  const shopper = await stack.register('صاحب تذكرة');
  const { ticket } = await api('POST', '/tickets', { subject: 'فاتورة ضريبية', message: 'أحتاج فاتورة باسم الشركة' }, shopper.token);
  await section('tickets', 'فاتورة ضريبية');
  await press(row('فاتورة ضريبية'), 'رد');
  await until(async () => (await api('GET', '/tickets', undefined, shopper.token)).tickets.find((t) => t.id === ticket.id).replies.length === 1, 10000, 'reply saved');
  await press(row('فاتورة ضريبية'), 'إغلاق');
  await until(async () => (await api('GET', '/tickets', undefined, shopper.token)).tickets.find((t) => t.id === ticket.id).status === 'resolved', 10000, 'resolved');
});

e2e('L097 L098 support chats: an order-linked chat handed to a human, answered by staff and closed', async () => {
  const shopper = await stack.register('صاحب محادثة');
  const order = await stack.order(shopper, [{ productId: 'flour', quantity: 1 }]);
  const { chat } = await api('POST', '/support/chats', { orderId: order.id, message: 'الطحين ناقص' }, shopper.token);
  await api('POST', `/support/chats/${chat.id}/escalate`, {}, shopper.token);
  await section('chats', order.id);
  assert.match(await row(order.id).innerText(), /بانتظار موظف/);
  await row(order.id).getByRole('button', { name: 'فتح', exact: true }).click();
  await root().getByText('العميل: الطحين ناقص').waitFor();
  await fillForm('رد الموظف', { message: 'نعتذر، سنرسل الكيس الناقص اليوم.' });
  await submit('رد الموظف', 'إرسال');
  await done(/أُرسل الرد/);
  const messages = (await api('GET', `/support/chats/${chat.id}`, undefined, shopper.token)).chat.messages;
  assert.ok(messages.some((m) => m.sender === 'agent' && m.body.includes('الكيس الناقص')));
  await row(order.id).getByRole('button', { name: 'فتح', exact: true }).click();
  await click('إغلاق المحادثة');
  await until(async () => (await api('GET', `/support/chats/${chat.id}`, undefined, shopper.token)).chat.status === 'resolved', 10000, 'chat closed');
});

e2e('L100 the help centre: add a FAQ the app and the bot can use, then hide it', async () => {
  await section('faqs', 'سؤال شائع جديد');
  await fillForm('سؤال شائع جديد', { category: 'delivery', question: 'هل توصلون إلى العقبة؟', answer: 'نعم، خلال يومين عمل عبر شركة شحن.', keywords: 'العقبة شحن' });
  await submit('سؤال شائع جديد', 'إضافة');
  await done(/أُضيف إلى مركز المساعدة/);
  assert.ok((await api('GET', `/faqs?q=${encodeURIComponent('العقبة')}`)).faqs.some((f) => f.question === 'هل توصلون إلى العقبة؟'));
  await press(row('هل توصلون إلى العقبة؟'), 'إخفاء');
  await until(async () => !(await api('GET', `/faqs?q=${encodeURIComponent('العقبة')}`)).faqs.some((f) => f.question === 'هل توصلون إلى العقبة؟'), 10000, 'hidden');
});

e2e('L059 L111 reports: revenue, best sellers and the order and driver ratings for 7, 30 and 90 days', async () => {
  const shopper = await stack.register('مقيّم الطلب');
  const order = await stack.order(shopper, [{ productId: 'arabic-coffee', quantity: 2 }]);
  await stack.deliver(shopper, order.id);
  await api('POST', `/orders/${order.id}/rating`, { rating: 5, driverRating: 4, comment: 'ممتاز' }, shopper.token);
  await section('reports', 'المبيعات اليومية');
  const report = await asAdmin('GET', '/admin/reports?days=30');
  const tile = (label) => root().locator('.kpi').filter({ has: board.locator('.label', { hasText: label }) }).locator('.value').first();
  assert.equal(await tile('الطلبات').innerText(), report.totals.orders.toLocaleString('ar-JO'));
  assert.match(await tile('تقييم الطلبات').innerText(), new RegExp(String(report.ratings.average)));
  assert.equal(await tile('تقييم السائقين').innerText(), String(report.ratings.driverAverage));
  await row('قهوة عربية بالهيل').waitFor();
  await click('7 يوم');
  await until(async () => (await root().getByRole('button', { name: '7 يوم', exact: true }).getAttribute('class')).includes('primary'), 10000, '7 days selected');
});

e2e('L114 low stock and reorder suggestions', async () => {
  await asAdmin('PATCH', '/admin/products/croissant', { stock: 0 });
  await section('reorder', 'الأولوية');
  const { suggestions } = await asAdmin('GET', '/admin/reorder');
  const croissant = suggestions.find((s) => s.productId === 'croissant');
  assert.equal(croissant.urgency, 'out');
  assert.match(await row('كرواسون زبدة').innerText(), /نفد/);
  await asAdmin('PATCH', '/admin/products/croissant', { stock: 40 });
});

e2e('L011 L112 vendors: add a merchant with an owner, add staff and suspend', async () => {
  const owner = await stack.register('مالك المتجر الجديد');
  const staff = await stack.register('موظف المتجر');
  await section('vendors', 'بائع (تاجر) جديد');
  await fillForm('بائع (تاجر) جديد', { name: 'حلويات السلطان', commission: '12', description: 'حلويات شرقية', email: owner.user.email });
  await submit('بائع (تاجر) جديد', 'إضافة');
  await until(async () => (await row('حلويات السلطان').count()) > 0, 10000, 'vendor listed');
  const vendorRow = () => row('حلويات السلطان');
  await vendorRow().locator('input[type="email"]').fill(staff.user.email);
  await press(vendorRow(), 'إضافة عضو');
  await until(async () => (await asAdmin('GET', '/admin/vendors')).vendors.find((v) => v.name === 'حلويات السلطان').members.length === 2, 10000, 'staff added');
  assert.ok((await api('GET', '/vendor/me', undefined, owner.token)).vendors.some((v) => v.name === 'حلويات السلطان'), 'the owner has a merchant account');
  await press(vendorRow(), 'إيقاف');
  await until(async () => (await asAdmin('GET', '/admin/vendors')).vendors.find((v) => v.name === 'حلويات السلطان').status === 'suspended', 10000, 'suspended');
});

e2e('L106 export products, orders, customers and stock as CSV for Excel and as JSON', async () => {
  await section('exports', 'تنزيل بيانات المتجر');
  const [csv] = await Promise.all([board.waitForEvent('download'), click('المنتجات CSV')]);
  assert.equal(csv.suggestedFilename(), 'luqta-products.csv');
  const bytes = readFileSync(await csv.path());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  assert.match(bytes.toString('utf8'), /حليب طازج كامل الدسم/);
  const [json] = await Promise.all([board.waitForEvent('download'), click('الطلبات JSON')]);
  const orders = JSON.parse(readFileSync(await json.path(), 'utf8'));
  assert.ok(Array.isArray(orders.rows || orders.orders || orders));
  const [customers] = await Promise.all([board.waitForEvent('download'), click('العملاء CSV')]);
  assert.doesNotMatch(readFileSync(await customers.path(), 'utf8'), /password|token/i);
  const [stock] = await Promise.all([board.waitForEvent('download'), click('مخزون الفروع CSV')]);
  assert.match(readFileSync(await stock.path(), 'utf8'), /br_amman/);
});

e2e('L115 the audit log records dashboard changes', async () => {
  await section('audit', 'الإجراء');
  await until(async () => (await root().locator('tr').filter({ hasText: 'product.create' }).count()) > 0, 10000, 'product.create logged');
  assert.ok(await root().locator('tr').filter({ hasText: 'coupon.save' }).count());
  assert.ok(await root().locator('tr').filter({ hasText: 'giftcard.issue' }).count());
});

e2e('L116 agent keys with limited scopes and agent jobs', async () => {
  await section('agents', 'مهمة للوكيل');
  await fillForm('مهمة للوكيل', { title: 'تحديث صور المنتجات', description: 'أضف صورتين لكل منتج طازج' });
  await submit('مهمة للوكيل', 'إضافة المهمة');
  await until(async () => (await row('تحديث صور المنتجات').count()) > 0, 10000, 'job listed');
  const keyForm = formByTitle('إصدار مفتاح محدود الصلاحيات لوكيل خارجي');
  await keyForm.locator('[name="name"]').fill('وكيل الكتالوج');
  await keyForm.locator('input[value="catalog:write"]').check();
  await keyForm.getByRole('button', { name: 'إصدار المفتاح', exact: true }).click();
  await root().getByText('المفتاح الصادر لمرة واحدة:').waitFor();
  const token = (await root().locator('pre.code').innerText()).trim();
  await api('PATCH', '/admin/products/sugar', { price: 1.35 }, token);
  assert.equal((await products()).sugar.price, 1.35);
  await assert.rejects(api('PATCH', '/admin/users/x', { role: 'admin' }, token), /403|401/);
  await press(row('وكيل الكتالوج'), 'إلغاء المفتاح');
  await until(async () => { try { await api('PATCH', '/admin/products/sugar', { price: 1.3 }, token); return false; } catch { return true; } }, 10000, 'revoked key refused');
});

e2e('L117 project management: the 125 features with test evidence and the development log', async () => {
  await section('features', 'الميزات المخططة');
  const tile = (label) => root().locator('.kpi').filter({ has: board.locator('.label', { hasText: label }) }).locator('.value').first();
  assert.equal(await tile('الميزات المخططة').innerText(), (125).toLocaleString('ar-JO'));
  for (const fid of ['L001', 'L088', 'L125']) await root().locator('tr').filter({ has: board.locator('td', { hasText: new RegExp(`^${fid}$`) }) }).first().waitFor();
  await fillForm('إضافة إلى سجل التطوير', { kind: 'test', title: 'تشغيل اختبارات اللوحة', body: 'كل أقسام اللوحة', version: '2.1.0' });
  await submit('إضافة إلى سجل التطوير', 'إضافة');
  await done(/أُضيف إلى سجل التطوير/);
  assert.ok((await asAdmin('GET', '/admin/devlog')).entries.some((e) => e.title === 'تشغيل اختبارات اللوحة' && e.version === '2.1.0'));
});

e2e('L118 L119 L120 L121 L122 central sync: export, snapshot, operations with receipts and retry, diff before import, JSON import and log download', async () => {
  await section('sync', 'إيصالات المزامنة');
  const calls = stack.center.calls.length;
  await click('تصدير إلى لوحة القيادة');
  await done(/SYNC-\d{8}-\d{3}/);
  await click('إرسال لقطة قاعدة البيانات');
  await done(/SYNC-\d{8}-\d{3}/);
  await click('تنفيذ العمليات المعلّقة');
  await done(/SYNC-\d{8}-\d{3}/);
  const sent = stack.center.calls.slice(calls);
  assert.ok(sent.some((c) => c.path === '/api/v1/app/sync'));
  assert.ok(sent.some((c) => c.path === '/api/v1/bridge/snapshot'));
  assert.equal(sent.filter((c) => c.path === '/api/v1/bridge/receipts').length >= 2, true, 'a receipt per operation');
  assert.equal((await products()).water.stock, 77, 'the approved operation was applied');
  const { receipts } = await asAdmin('GET', '/admin/sync/receipts');
  const partial = receipts.find((r) => r.kind === 'runner' && r.status !== 'success');
  await press(row(partial.id), 'إعادة المحاولة');
  await until(async () => (await asAdmin('GET', '/admin/sync/receipts')).receipts.some((r) => r.retryOf === partial.id), 10000, 'retried');
  const [log] = await Promise.all([board.waitForEvent('download'), row(partial.id).getByRole('button', { name: 'تنزيل السجل', exact: true }).click()]);
  assert.match(readFileSync(await log.path(), 'utf8'), /op-e2e-2/);
  await click('معاينة الاستيراد من لوحة القيادة');
  await root().getByText('الفروقات: جديد 1 · تغيّر 1 · مرفوض 1').waitFor();
  assert.equal((await products()).milk.price, 1.15, 'nothing changes before applying');
  await click('تطبيق المقبول');
  // A server-side update can complete before the dashboard's post-action refresh.
  // Wait for the import receipt before editing another form, or that refresh can replace the textarea mid-input.
  await done(/SYNC-\d{8}-\d{3}: استيراد من لوحة القيادة المركزية/);
  await until(async () => (await products()).milk.price === 1.2 && !!(await products())['cc-dates'], 10000, 'applied');
  await fillForm('استيراد ملف من النظام المركزي (JSON)', { source: 'ملف تجريبي', items: JSON.stringify([{ id: 'tahini', name: 'طحينة', retailPrice: 2.4, stockQuantity: 33 }, { id: '', name: 'سطر خاطئ' }]) });
  await submit('استيراد ملف من النظام المركزي (JSON)', 'معاينة واستيراد');
  await done(/قُبل 1 ورُفض 1/);
  assert.equal((await products()).tahini.stock, 33);
  // The connection comes from the server's start-up configuration, so the dashboard shows it as locked.
  await root().getByText('إعداد الاتصال مقفل').waitFor();
  assert.equal(await formByTitle('إعداد الاتصال بلوحة القيادة المركزية').count(), 0);
  await assert.rejects(asAdmin('PUT', '/admin/sync/config', { baseUrl: 'https://command-center.example.com' }), /409/);
  const { config } = await asAdmin('GET', '/admin/sync/status');
  assert.deepEqual([config.baseUrl, config.bridgeId, config.apiKeyConfigured, config.runnerKeyConfigured], ['http://127.0.0.1:8798', 'bridge_e2e', true, true]);
  assert.equal(JSON.stringify(config).includes('e2e-api-key'), false, 'keys are never sent back');
});

e2e('L125 display currencies: set exchange rates the app shows next to store prices', async () => {
  await section('settings', 'أسعار عملات العرض');
  await fillForm('أسعار عملات العرض (مقابل 1 من عملة المتجر)', { rates: 'USD=1.41\nEUR=1.3\nSAR=5.29' });
  await submit('أسعار عملات العرض (مقابل 1 من عملة المتجر)', 'حفظ الأسعار');
  await done(/حُفظت الأسعار/);
  assert.deepEqual((await api('GET', '/settings')).settings.displayCurrencies, { USD: 1.41, EUR: 1.3, SAR: 5.29 });
});
