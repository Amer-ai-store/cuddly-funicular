// End-to-end checks of every app feature (L001–L125 with an app surface) in Chromium against the real server.
// Each test drives the exported web build like a shopper, driver, merchant or store admin would, then confirms the
// result on the server. Test titles cite the feature ids; scripts/feature-reporter.mjs turns them into evidence.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStack, go, id, see, tap, fill, field, until, noErrors, password, button } from './harness.mjs';
import { productNumber } from '../server/modules/sync.mjs';
import { solidPng } from '../server/testkit.mjs';
import { staffStrings } from '../scripts/staff-strings.mjs';
import { isStrictPath } from '../src/lib/svgPath.ts';

const ARTIFACTS = fileURLToPath(new URL('./artifacts/', import.meta.url));
let stack;
before(async () => {
  stack = await startStack();
  await stack.api('POST', '/admin/coupons', { code: 'E2E10', type: 'percent', value: 10, minSubtotal: 0 }, stack.admin.token);
});
after(async () => { await stack?.close(); });

const api = (...args) => stack.api(...args);
const asAdmin = (method, path, body) => api(method, path, body, stack.admin.token);
const e2e = (title, fn) => test(title, { timeout: 240_000 }, async () => {
  const pages = [];
  const open = async (user, path, options = {}) => {
    const page = await stack.newPage({ token: user?.token, ...options });
    page.setDefaultTimeout(20_000);
    pages.push(page);
    if (path) await go(page, path);
    return page;
  };
  try {
    await fn({ open });
    for (const page of pages) noErrors(page);
  } catch (error) {
    mkdirSync(ARTIFACTS, { recursive: true });
    let n = 0;
    for (const page of pages) await page.screenshot({ path: `${ARTIFACTS}${title.slice(0, 48).replace(/[^\w]+/g, '_')}-${n++}.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    for (const page of pages) await page.context().close().catch(() => {});
  }
});

// ---- small helpers ----
const amman = { name: 'متسوق الاختبار', phone: '+962790000001', city: 'عمان', street: 'شارع الرينبو 5', district: 'جبل عمّان', building: '12', latitude: 31.95, longitude: 35.9 };
const withAddress = async (user, address = amman) => (await api('POST', '/addresses', { label: 'البيت', ...address, isDefault: true }, user.token)).address;
const delivered = async (user, items) => { const order = await stack.order(user, items); await stack.deliver(user, order.id); return order; };
const value = (page, testId) => field(page, testId).inputValue();
const textOf = async (page, testId) => (await id(page, testId).innerText()).trim();
const cartCount = async (page) => Number(((await id(page, 'tab-cart').getAttribute('aria-label')) || '').match(/(\d+)\s*$/)?.[1] || 0);
const selected = async (page, testId) => (await id(page, testId).getAttribute('aria-selected')) === 'true' || (await id(page, testId).getAttribute('aria-checked')) === 'true';
const disabled = async (locator) => (await locator.getAttribute('aria-disabled')) === 'true';
const products = async () => Object.fromEntries((await api('GET', '/products')).products.map((p) => [p.id, p]));
const shownIds = async (page) => (await page.locator('[data-testid^="product-card-"]').evaluateAll((els) => els.filter((e) => e.checkVisibility()).map((e) => e.getAttribute('data-testid').slice('product-card-'.length))));
const transforms = (page, scope) => page.locator(scope).filter({ visible: true }).first().locator('*').evaluateAll((els) => els.map((e) => e.style.transform || '').join('|'));
// The companion is a 3D character running in a sandboxed frame; tests read its engine directly (joint angles, probe).
const engineFrame = async (page, scope) => {
  await page.locator(`${scope} [data-mode="3d"]`).filter({ visible: true }).first().waitFor({ timeout: 20000 });
  return (await page.locator(`${scope} iframe`).filter({ visible: true }).first().elementHandle()).contentFrame();
};
const joints = (frame) => frame.evaluate(() => JSON.stringify(window.LuqtaAvatar.skeleton.bones.map((b) => [b.rotation.x, b.rotation.y, b.rotation.z].map((v) => v.toFixed(4)))));
const probe = (frame) => frame.evaluate(() => { window.LuqtaAvatar.command({ type: 'probe', id: 'e2e' }); return window.__luqtaLast; });
const pickFile = async (page, testId, file) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tap(page, testId)]);
  await chooser.setFiles(file);
};
const png = (rgb, size = 48) => ({ name: 'photo.png', mimeType: 'image/png', buffer: solidPng(size, size, rgb) });
const tab = (page, name) => page.getByRole('tab', { name, exact: true }).filter({ visible: true }).first();
const toast = (page, text) => page.locator('[data-testid="toast"]').filter({ hasText: text, visible: true }).first().waitFor();

// PR #161: a guest's device-local passport (display name, region, interests) shapes the home screen without an account.
e2e('guest passport keeps local choices and remains usable without a commerce login', async ({ open }) => {
  const page = await open(null, '/passport');
  await id(page, 'local-passport').waitFor();
  await id(page, 'passport-name').fill('Orbit Shopper');
  await tap(page, 'passport-region-GB');
  await page.locator('[data-testid^="passport-interest-"]').first().click();
  await tap(page, 'passport-save');
  await id(page, 'passport-notice').getByText('حُفظت اختياراتك على جهازك.', { exact: false }).waitFor();
  await go(page, '/');
  await id(page, 'home-passport').waitFor();
  await see(page, 'أهلًا Orbit');
  await go(page, '/passport');
  // The saved preferences load after the screen first renders; wait for the stored value.
  await until(async () => (await id(page, 'passport-name').inputValue()) === 'Orbit Shopper', 10000, 'passport saved name restored');
  await page.reload();
  await until(async () => (await id(page, 'passport-name').inputValue()) === 'Orbit Shopper', 10000, 'passport survives a full browser reload');
});

// =====================================================================================================
// Accounts and privacy
// =====================================================================================================
e2e('L001 L002 register in the app, keep the session across reloads, sign out and sign in again', async ({ open }) => {
  const page = await open(null, '/register');
  const email = `ui-${Date.now()}@e2e.test`;
  await page.getByLabel('الاسم الكامل').fill('ليلى المتسوقة');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await page.getByLabel('تأكيد كلمة المرور').fill(password);
  await button(page, 'إنشاء حسابي').click();
  await see(page, 'احتفظ برمز استرداد حسابك');
  await button(page, 'حفظت الرمز، متابعة إلى حسابي').click();
  await id(page, 'profile-card').waitFor();
  await see(page, 'ليلى المتسوقة');
  // The session survives a reload, lives in sessionStorage (cleared with the tab), and never stores the password.
  await page.reload();
  await id(page, 'profile-card').waitFor();
  const stored = await page.evaluate(() => ({ session: sessionStorage.getItem('luqta-commerce-session-v1'), local: Object.keys(localStorage).filter((k) => /session|token|password/i.test(k)) }));
  const token = JSON.parse(stored.session).token;
  assert.ok(token.length >= 32);
  assert.deepEqual(stored.local, []);
  assert.ok(!stored.session.includes(password));
  assert.equal((await api('GET', '/auth/me', undefined, token)).user.email, email);
  await tap(page, 'logout');
  await button(page, 'إنشاء حساب').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('luqta-commerce-session-v1')), null);
  await assert.rejects(api('GET', '/auth/me', undefined, token), /401/);
  await go(page, '/login');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await button(page, 'تسجيل الدخول').click();
  await id(page, 'profile-card').waitFor();
  await see(page, 'ليلى المتسوقة');
});

e2e('L003 reset a forgotten password with the account recovery code', async ({ open }) => {
  const user = await stack.register('صاحب رمز الاسترداد');
  assert.ok(user.recoveryCode, 'registration returns a one-time recovery code');
  const page = await open(null, '/recover-account');
  const next = 'new-e2e-password-456';
  await page.getByLabel('البريد الإلكتروني').fill(user.user.email);
  await page.getByLabel('رمز الاسترداد').fill(user.recoveryCode);
  await page.getByLabel('كلمة المرور الجديدة', { exact: true }).fill(next);
  await page.getByLabel('تأكيد كلمة المرور الجديدة').fill(next);
  await button(page, 'إعادة تعيين كلمة المرور').click();
  await see(page, 'تغيّرت كلمة المرور وأُبطلت الجلسات السابقة');
  await assert.rejects(api('GET', '/auth/me', undefined, user.token), /401/);
  await assert.rejects(api('POST', '/auth/login', { email: user.user.email, password }), /401/);
  assert.ok((await api('POST', '/auth/login', { email: user.user.email, password: next })).token);
});

e2e('L004 L007 see signed-in devices, end one, end the others, then change the password', async ({ open }) => {
  const user = await stack.register('مالك الأجهزة');
  const second = await api('POST', '/auth/login', { email: user.user.email, password });
  const page = await open(user, '/privacy');
  await id(page, 'devices').waitFor();
  const revoke = page.locator('[data-testid^="revoke-"]').filter({ hasNot: page.locator('[data-testid="revoke-others"]') });
  await until(async () => (await page.locator('[data-testid^="revoke-ses"], [data-testid^="revoke-"]:not([data-testid="revoke-others"])').count()) >= 1, 15000, 'other device listed');
  await see(page, 'هذا الجهاز');
  await page.locator('[data-testid^="revoke-"]:not([data-testid="revoke-others"])').first().click();
  await see(page, 'أُنهيت الجلسة');
  await assert.rejects(api('GET', '/auth/me', undefined, second.token), /401/);
  const third = await api('POST', '/auth/login', { email: user.user.email, password });
  const fourth = await api('POST', '/auth/login', { email: user.user.email, password });
  await page.reload();
  await tap(page, 'revoke-others');
  await see(page, 'أُنهيت 2 جلسات');
  for (const s of [third, fourth]) await assert.rejects(api('GET', '/auth/me', undefined, s.token), /401/);
  assert.ok(revoke);
  const next = 'changed-e2e-password-789';
  await fill(page, 'current-password', password);
  await fill(page, 'new-password', next);
  await fill(page, 'confirm-password', next);
  await tap(page, 'submit-password');
  await see(page, 'غُيّرت كلمة المرور');
  await assert.rejects(api('POST', '/auth/login', { email: user.user.email, password }), /401/);
  assert.ok((await api('POST', '/auth/login', { email: user.user.email, password: next })).token);
});

e2e('L006 L008 change privacy preferences and download a copy of my data', async ({ open }) => {
  const user = await stack.register('مهتم بالخصوصية');
  const page = await open(user, '/privacy');
  await id(page, 'privacy-saveSearchHistory').waitFor();
  assert.equal(await selected(page, 'privacy-saveSearchHistory'), true);
  await tap(page, 'privacy-saveSearchHistory');
  await until(async () => !(await selected(page, 'privacy-saveSearchHistory')));
  await tap(page, 'privacy-marketingEmails');
  await until(async () => (await api('GET', '/me/preferences', undefined, user.token)).preferences.privacy.marketingEmails === true);
  assert.equal((await api('GET', '/me/preferences', undefined, user.token)).preferences.privacy.saveSearchHistory, false);
  const [download] = await Promise.all([page.waitForEvent('download'), tap(page, 'export-button')]);
  const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.match(download.suggestedFilename(), /\.json$/);
  assert.equal(JSON.stringify(data).includes(user.user.email), true);
  assert.equal(data.preferences?.privacy?.saveSearchHistory ?? data.account?.preferences?.privacy?.saveSearchHistory, false);
  await see(page, 'جُهّز ملف بياناتك');
});

e2e('L009 L010 L095 edit the profile, then add an address with "use my location", the map pin and the nearest branch', async ({ open }) => {
  const user = await stack.register('صاحب العناوين');
  const page = await open(user, '/account');
  await tap(page, 'avatar-🦊');
  await fill(page, 'profile-phone', '+962790001122');
  await tap(page, 'save-profile');
  await see(page, 'حُفظت بياناتك');
  const { profile } = await api('GET', '/me/profile', undefined, user.token);
  assert.equal(profile.phone, '+962790001122');
  assert.equal(profile.avatar, 'emoji:🦊');
  await tap(page, 'add-address');
  await tap(page, 'use-location');
  await id(page, 'map-pin').waitFor();
  const { nearest } = await api('GET', '/delivery/nearest?lat=32.55&lng=35.85');
  await see(page, `أقرب فرع لك: ${nearest.name}`);
  await fill(page, 'address-name', 'صاحب العناوين');
  await fill(page, 'address-phone', '+962790001122');
  await fill(page, 'address-city', 'إربد');
  await fill(page, 'address-district', 'الحصن');
  await fill(page, 'address-street', 'شارع الجامعة 12');
  await fill(page, 'address-building', '7');
  await fill(page, 'address-details', 'الطابق الثاني');
  await tap(page, 'save-address');
  await see(page, 'حُفظ العنوان');
  const { addresses } = await api('GET', '/addresses', undefined, user.token);
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].district, 'الحصن');
  assert.equal(addresses[0].building, '7');
  assert.ok(Math.abs(addresses[0].latitude - 32.55) < 0.001 && Math.abs(addresses[0].longitude - 35.85) < 0.001);
  await id(page, `address-${addresses[0].id}`).waitFor();
  await see(page, 'الحصن');
  // A second address from the same screen, typed by hand.
  await tap(page, 'add-address');
  await fill(page, 'address-name', 'العمل');
  await fill(page, 'address-phone', '+962790001133');
  await fill(page, 'address-city', 'عمان');
  await fill(page, 'address-street', 'شارع الملكة رانيا 100');
  await tap(page, 'save-address');
  await until(async () => (await api('GET', '/addresses', undefined, user.token)).addresses.length === 2, 10000, 'second address saved');
});

e2e('L005 delete the account while the delivered order stays in the financial records', async ({ open }) => {
  const user = await stack.register('حساب للحذف');
  const order = await delivered(user, [{ productId: 'bread', quantity: 1 }]);
  const page = await open(user, '/delete-account');
  await page.getByLabel('كلمة المرور الحالية').fill(password);
  await page.getByLabel('اكتب: حذف حسابي').fill('حذف حسابي');
  await button(page, 'حذف حسابي نهائيًا').click();
  await see(page, 'حُذف الحساب');
  await assert.rejects(api('POST', '/auth/login', { email: user.user.email, password }), /401/);
  const { orders } = await asAdmin('GET', '/admin/orders');
  const kept = orders.find((o) => o.id === order.id);
  assert.ok(kept, 'the order is kept');
  assert.notEqual(kept.address?.name, 'متسوق', 'personal details are anonymised');
});

e2e('L011 a merchant account sees its sales and adds a product from the vendor screen', async ({ open }) => {
  const merchant = await stack.register('تاجر الحي');
  const { vendor } = await asAdmin('POST', '/admin/vendors', { name: 'مخبز الحي', commission: 8 });
  await asAdmin('POST', `/admin/vendors/${vendor.id}/members`, { email: merchant.user.email, role: 'owner' });
  const page = await open(merchant, '/vendor');
  await id(page, 'vendor-summary').waitFor();
  await see(page, 'مخبز الحي');
  await fill(page, 'vendor-product-name', 'كعك بالسمسم');
  await fill(page, 'vendor-product-price', '2.5');
  await tap(page, 'vendor-add-product');
  await see(page, 'كعك بالسمسم');
  const mine = await api('GET', `/vendor/${vendor.id}/products`, undefined, merchant.token);
  const created = mine.products.find((p) => p.name === 'كعك بالسمسم');
  assert.ok(created);
  assert.ok((await products())[created.id], 'the vendor product is in the public catalog');
});

// =====================================================================================================
// Catalog and search
// =====================================================================================================
e2e('L013 L017 L069 L079 L081 L027 the home screen shows server categories, campaigns, an animated 3D character, onboarding and recently viewed', async ({ open }) => {
  const user = await stack.register('سارة');
  const page = await open(user, '/');
  await id(page, 'home').waitFor();
  await see(page, 'لُقطة · متصل بخادم المتجر');
  assert.equal(await page.locator('[data-testid="catalog-banner"]').count(), 0);
  const { categories } = await api('GET', '/categories');
  await id(page, `category-${categories[0].id}`).waitFor();
  // The brand logo and the mockups' four departments on the home row, each drawn with its illustration from the designs.
  await id(page, 'brand-logo').waitFor();
  for (const dept of ['fresh', 'electronics', 'fashion', 'home']) await id(page, `category-art-${dept}`).waitFor();
  await until(() => id(page, 'category-art-fresh').evaluate((el) => [...el.querySelectorAll('img')].some((img) => img.complete && img.naturalWidth > 0)), 10000, 'the basket illustration loaded');
  const { campaigns } = await api('GET', '/campaigns');
  assert.ok(campaigns.length >= 1);
  await id(page, `campaign-${campaigns[0].id}`).waitFor();
  await see(page, campaigns[0].title);
  // L081: the companion is the mockups' 3D character, and it moves (its joint angles change between two samples).
  const homeCharacter = await engineFrame(page, '[data-testid="mascot"]');
  const a = await joints(homeCharacter);
  await page.waitForTimeout(700);
  assert.notEqual(a, await joints(homeCharacter), 'the character animates');
  // L079: onboarding interests drive the recommendations.
  await id(page, 'onboarding').waitFor();
  await tap(page, 'interest-dairy');
  await tap(page, 'save-interests');
  await until(async () => (await page.locator('[data-testid="onboarding"]').count()) === 0, 10000, 'onboarding closes');
  const prefs = (await api('GET', '/me/preferences', undefined, user.token)).preferences;
  assert.deepEqual(prefs.interests, ['dairy']);
  assert.equal(prefs.onboarded, true);
  const recs = await api('GET', '/recommendations?limit=8', undefined, user.token);
  assert.equal(recs.personalized, true);
  await see(page, 'حسب اهتماماتك ومشترياتك');
  // L017: a category tile opens the explore screen on that category.
  await tap(page, `category-${categories[0].id}`);
  await id(page, 'explore').waitFor();
  await until(async () => selected(page, `chip-${categories[0].id}`));
  const catalog = await products();
  await until(async () => { const ids = await shownIds(page); return ids.length > 0 && ids.every((pid) => catalog[pid]?.category === categories[0].id); }, 15000, 'only that category is shown');
  // L027: recently viewed products come back on the home screen.
  await go(page, '/product/labneh');
  await id(page, 'product').waitFor();
  await go(page, '/');
  await id(page, 'recently-viewed').waitFor();
  assert.ok(await id(page, 'recently-viewed').locator('[data-testid="product-card-labneh"]').count());
  // L069: tapping a campaign follows its link.
  await tap(page, `campaign-${campaigns[0].id}`);
  const link = new URL(campaigns[0].link, 'http://app');
  await until(async () => new URL(page.url()).pathname === link.pathname, 10000, 'campaign link opened');
  if (link.searchParams.get('category')) await until(() => selected(page, `chip-${link.searchParams.get('category')}`), 10000, 'campaign category applied');
});

e2e('L014 L015 L016 L022 Arabic search with typos, filters, sorting and the search history', async ({ open }) => {
  // A delivered purchase and a 5-star review give one product a rating for the rating filter.
  const reviewer = await stack.register('مقيّم');
  await delivered(reviewer, [{ productId: 'lamp', quantity: 1 }]);
  await api('POST', '/products/lamp/reviews', { rating: 5, title: 'رائع', body: 'إضاءة دافئة وجميلة' }, reviewer.token);
  const user = await stack.register('باحث');
  const page = await open(user, '/explore');
  await fill(page, 'search-input', 'حلييب');
  await id(page, 'suggestions').waitFor();
  await page.locator('[data-testid="search-input"]').press('Enter');
  await until(async () => (await shownIds(page)).includes('milk'), 15000, 'typo still finds milk');
  await until(async () => (await api('GET', '/me/search-history', undefined, user.token)).history.some((h) => h.query === 'حلييب'), 10000, 'search saved');
  // Clearing the query and focusing shows the recent searches.
  await page.getByRole('button', { name: 'مسح البحث' }).click();
  await page.locator('[data-testid="search-input"]').click();
  await see(page, 'عمليات بحثك الأخيرة');
  await page.getByRole('button', { name: 'حلييب', exact: true }).first().waitFor();
  await page.locator('[data-testid="explore"]').getByText('اكتشف عالمك').click();
  const catalog = await products();
  await tap(page, 'filters-toggle');
  await tap(page, 'sort-price-asc');
  await until(async () => { const ids = await shownIds(page); const prices = ids.map((pid) => catalog[pid].price); return ids.length > 10 && prices.every((p, i) => !i || p >= prices[i - 1]); }, 15000, 'sorted by price ascending');
  await tap(page, 'sort-price-desc');
  await until(async () => { const prices = (await shownIds(page)).map((pid) => catalog[pid].price); return prices.length > 10 && prices.every((p, i) => !i || p <= prices[i - 1]); }, 15000, 'sorted by price descending');
  await tap(page, 'price-0-1');
  await until(async () => { const ids = await shownIds(page); return ids.length > 0 && ids.every((pid) => catalog[pid].price <= 1); }, 15000, 'price filter');
  await tap(page, 'price-any');
  await tap(page, 'filter-rating');
  await until(async () => { const ids = await shownIds(page); return ids.includes('lamp') && ids.every((pid) => ((catalog[pid].rating) || 5) >= 4); }, 15000, 'rating filter');
  await tap(page, 'filter-rating');
  await tap(page, 'filter-sale');
  await until(async () => { const ids = await shownIds(page); return ids.length > 0 && ids.every((pid) => catalog[pid].oldPrice > catalog[pid].price); }, 15000, 'discount filter');
  await tap(page, 'filter-sale');
  await tap(page, 'sort-popular');
  await tap(page, 'sort-newest');
  await tap(page, 'filter-stock');
  await until(async () => (await shownIds(page)).length > 10, 15000, 'in-stock filter');
});

e2e('L021 pick a branch and see its own stock on the product cards', async ({ open }) => {
  const user = await stack.register('مشتري إربد');
  const page = await open(user, '/explore');
  await tap(page, 'branch-br_irbid');
  await see(page, 'تعرض الكميات المتوفرة في');
  const { stock } = await api('GET', '/branches/br_irbid/stock');
  const quantity = Array.isArray(stock) ? stock.find((s) => s.productId === 'milk')?.quantity : stock.milk;
  assert.ok(Number.isInteger(quantity));
  await until(async () => (await id(page, 'product-card-milk').innerText()).includes(`متوفر في الفرع: ${quantity}`) || (quantity === 0 && (await id(page, 'product-card-milk').innerText()).includes('غير متوفر في هذا الفرع')), 15000, 'branch quantity shown');
});

e2e('L023 search by voice', async ({ open }) => {
  const page = await open(null, '/explore');
  await page.evaluate(() => { window.__voiceText = 'خبز'; });
  await tap(page, 'voice-search');
  await until(async () => (await value(page, 'search-input')) === 'خبز', 10000, 'voice text in the box');
  await until(async () => (await shownIds(page)).includes('bread'), 15000, 'bread found');
});

e2e('L024 search by barcode', async ({ open }) => {
  const page = await open(null, '/explore');
  await tap(page, 'barcode-search');
  await id(page, 'barcode-sheet').waitFor();
  await fill(page, 'barcode-input', '6250000000225');
  await tap(page, 'barcode-submit');
  await until(async () => new URL(page.url()).pathname === '/product/milk', 10000, 'product opened');
  await see(page, 'حليب طازج كامل الدسم');
});

e2e('L025 search by photo: the dominant colour finds matching products', async ({ open }) => {
  const page = await open(null, '/explore');
  await pickFile(page, 'image-search', png([220, 30, 30]));
  await see(page, 'منتجات بلون');
  await see(page, 'أحمر');
  const ids = await shownIds(page);
  assert.ok(ids.some((pid) => ['tomato', 'apple', 'strawberry'].includes(pid)), `red products expected, got ${ids}`);
});

e2e('L018 L019 L020 L026 product gallery with video, sizes with their own stock, the specifications table and sharing', async ({ open }) => {
  await asAdmin('POST', '/admin/products', { id: 'sneakers-42', name: 'حذاء ستريت اليومي', price: 219, stock: 4, category: 'fashion', variantOf: 'sneakers', variantLabel: 'مقاس 42' });
  await asAdmin('POST', '/admin/products', { id: 'sneakers-43', name: 'حذاء ستريت اليومي', price: 219, stock: 2, category: 'fashion', variantOf: 'sneakers', variantLabel: 'مقاس 43' });
  const page = await open(null, '/product/diffuser');
  await id(page, 'gallery').waitFor();
  await tap(page, 'video-thumb');
  await page.locator('video[data-testid="product-video"]').waitFor();
  await tab(page, 'المواصفات').click();
  await id(page, 'specs').waitFor();
  await see(page, '6250000000126');
  await tap(page, 'share');
  const shared = await until(() => page.evaluate(() => window.__shared[0]), 10000, 'share sheet opened');
  assert.match(`${shared.title} ${shared.text}`, /فواحة سكون/);
  assert.match(`${shared.text} ${shared.url || ''}`, /luqta:\/\/product\/diffuser/);
  await go(page, '/product/sneakers');
  await id(page, 'variant-sneakers-42').waitFor();
  assert.equal(await disabled(id(page, 'add-to-cart')), true, 'a size must be chosen first');
  await tap(page, 'variant-sneakers-43');
  await see(page, 'المتوفر: 2');
  await tap(page, 'add-to-cart');
  await toast(page, 'أُضيف المنتج إلى سلتك');
  await go(page, '/cart');
  await id(page, 'cart-line-sneakers-43').waitFor();
  // The mockups show two more views of the headphones: the gallery adds them after the catalog photo, and they load
  // from the app itself (the mockup's video thumbnail, with a play icon drawn on it, is not one of them).
  await go(page, '/product/headphones');
  const views = id(page, 'gallery').getByRole('button', { name: /^صورة \d+$/ });
  await until(async () => (await views.count()) === 3, 15000, 'the catalog photo and two mockup views');
  await views.nth(2).click();
  await until(() => id(page, 'gallery').evaluate((el) => [...el.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth > 0).length >= 3), 10000, 'all three views loaded');
});

e2e('L028 only buyers who received the product can publish a review', async ({ open }) => {
  const buyer = await stack.register('مشترٍ موثّق');
  await delivered(buyer, [{ productId: 'mug', quantity: 1 }]);
  const page = await open(buyer, '/product/mug');
  await tab(page, 'التقييمات').click();
  await button(page, 'تقييم 5 من 5').click();
  await page.getByLabel('نص التقييم').fill('كوب جميل ويحافظ على حرارة القهوة');
  await button(page, 'نشر التقييم').click();
  await see(page, 'حُفظ تقييمك على الخادم');
  await see(page, 'كوب جميل ويحافظ على حرارة القهوة');
  const stranger = await stack.register('زائر');
  const other = await open(stranger, '/product/mug');
  await tab(other, 'التقييمات').click();
  await button(other, 'تقييم 4 من 5').click();
  await other.getByLabel('نص التقييم').fill('لم أشترِ هذا المنتج');
  await button(other, 'نشر التقييم').click();
  await other.locator('[role="alert"]').filter({ hasNotText: 'حُفظ' }).first().waitFor();
  const { reviews } = await api('GET', '/products/mug/reviews');
  assert.equal(reviews.length, 1);
});

e2e('L029 ask about a product and see the official answer', async ({ open }) => {
  const user = await stack.register('سائل');
  const page = await open(user, '/product/rice');
  await tab(page, 'أسئلة').click();
  await fill(page, 'question-input', 'هل هذا الأرز مناسب للكبسة؟');
  await tap(page, 'ask-question');
  await toast(page, 'أُرسل سؤالك');
  await see(page, 'هل هذا الأرز مناسب للكبسة؟');
  const { questions } = await api('GET', '/products/rice/questions');
  await asAdmin('POST', `/questions/${questions[0].id}/answers`, { answer: 'نعم، حبته طويلة ومثالية للكبسة' });
  await page.reload();
  await tab(page, 'أسئلة').click();
  await see(page, 'نعم، حبته طويلة ومثالية للكبسة');
  await see(page, 'رد رسمي');
});

e2e('L030 L070 price-drop and back-in-stock alerts reach the notification inbox, with notification settings', async ({ open }) => {
  const user = await stack.register('صياد العروض');
  await asAdmin('PATCH', '/admin/products/tahini', { stock: 0 });
  const page = await open(user, '/product/olive-oil');
  await page.locator('[data-testid="alert-target"]').fill('6');
  await tap(page, 'alert-price');
  await toast(page, 'سننبهك عند انخفاض السعر');
  await go(page, '/product/tahini');
  await tap(page, 'alert-stock');
  await toast(page, 'سننبهك عند عودة المنتج');
  await go(page, '/notifications');
  await tab(page, 'تنبيهاتي').click();
  await until(async () => (await page.locator('[data-testid^="alert-"]').count()) === 2, 10000, 'two alerts listed');
  await asAdmin('PATCH', '/admin/products/olive-oil', { price: 5.9 });
  await asAdmin('PATCH', '/admin/products/tahini', { stock: 25 });
  await until(async () => (await api('GET', '/notifications', undefined, user.token)).notifications.length >= 2, 10000, 'alert notifications created');
  await page.reload();
  await until(async () => /\d/.test(await id(page, 'bell').innerText()), 10000, 'unread badge on the bell');
  await tab(page, 'الوارد').click();
  await see(page, 'زيت زيتون بكر');
  await tap(page, 'read-all');
  await until(async () => !/\d/.test(await id(page, 'bell').innerText()), 10000, 'badge cleared');
  await tab(page, 'الإعدادات').click();
  await tap(page, 'notify-offers');
  await until(async () => (await api('GET', '/me/preferences', undefined, user.token)).preferences.notifications.offers === false, 10000, 'setting saved');
  await asAdmin('PATCH', '/admin/products/olive-oil', { price: 6.9 });
});

// =====================================================================================================
// Shopping and checkout
// =====================================================================================================
e2e('L031 L032 favourites sync with the account, and products are compared side by side', async ({ open }) => {
  const user = await stack.register('محب المفضلة');
  const page = await open(user, '/explore');
  await tap(page, 'favorite-milk');
  await tap(page, 'favorite-bread');
  await until(async () => { const { productIds } = await api('GET', '/wishlist', undefined, user.token); return productIds.includes('milk') && productIds.includes('bread'); }, 10000, 'wishlist synced');
  // The same account on another device sees the same favourites.
  const other = await open(user, '/favorites');
  await id(other, 'favorite-row-milk').waitFor();
  await id(other, 'favorite-row-bread').waitFor();
  await tap(other, 'pick-milk');
  await tap(other, 'pick-bread');
  await tap(other, 'add-picked');
  await until(async () => (await cartCount(other)) === 2, 10000, 'both added to the cart');
  await go(page, '/product/headphones');
  await tab(page, 'مقارنة').click();
  await tap(page, 'toggle-compare');
  await go(page, '/product/speaker');
  await tab(page, 'مقارنة').click();
  await tap(page, 'toggle-compare');
  await button(page, 'عرض جدول المقارنة').click();
  await id(page, 'compare-table').waitFor();
  await see(page, 'سماعات هدوء لاسلكية');
  await see(page, 'مكبر صوت ميني');
});

e2e('L033 L034 L078 a family list shared with a code, filled from pasted receipt text, then sent to the cart', async ({ open }) => {
  const owner = await stack.register('ربة البيت');
  const member = await stack.register('الابن');
  const page = await open(owner, '/lists');
  await fill(page, 'list-name', 'مشتريات العائلة');
  await tap(page, 'kind-family');
  await tap(page, 'create-list');
  await id(page, 'list-detail').waitFor();
  await fill(page, 'list-item-input', 'حليب');
  await tap(page, 'list-suggest-milk');
  await see(page, 'حليب طازج كامل الدسم');
  await fill(page, 'paste-input', '2 خبز عربي\nطماطم ١\nشيء غير موجود');
  await tap(page, 'paste-parse');
  await see(page, 'مطابق');
  await tap(page, 'paste-import');
  const listId = (await api('GET', '/lists', undefined, owner.token)).lists[0].id;
  const list = await until(async () => { const l = (await api('GET', `/lists/${listId}`, undefined, owner.token)).list; return l.items.length === 4 && l; }, 10000, 'four items imported');
  await until(async () => (await textOf(page, 'list-items')).includes('شيء غير موجود'), 10000, 'text item listed');
  assert.equal(list.items.find((i) => i.productId === 'bread')?.quantity, 2);
  assert.ok(list.items.some((i) => !i.productId && i.title.includes('شيء غير موجود')));
  await tap(page, 'share-list');
  const code = (await textOf(page, 'share-code')).replace(/\s/g, '');
  assert.equal(code.length, 8);
  const shared = await until(() => page.evaluate(() => window.__shared[0]), 10000, 'share sheet');
  assert.ok(shared.text.includes(code));
  const joined = await open(member, '/lists');
  await fill(joined, 'join-code', code);
  await tap(joined, 'join-submit');
  await id(joined, 'list-detail').waitFor();
  await see(joined, 'مشتريات العائلة');
  await tap(joined, 'list-to-cart');
  await id(joined, 'cart').waitFor();
  for (const pid of ['milk', 'bread', 'tomato']) await id(joined, `cart-line-${pid}`).waitFor();
  await page.reload();
  await see(page, 'الابن');
});

e2e('L035 L037 L039 L086 the cart: quantities, save for later, a discount code and the character reacting', async ({ open }) => {
  const user = await stack.register('صاحب السلة');
  const page = await open(user, '/');
  await page.locator('[data-testid^="add-"]').first().waitFor();
  const first = (await page.locator('[data-testid^="product-card-"]').first().getAttribute('data-testid')).slice('product-card-'.length);
  await tap(page, `add-${first}`);
  // L086: the character on the home screen pushes a shopping cart and says it added the product.
  await see(page, 'أضفتها للسلة! 🎉');
  await until(async () => /يدفع عربة التسوق/.test((await page.locator('[data-testid="mascot"] [aria-label]').first().getAttribute('aria-label')) || ''), 5000, 'the character pushes a cart');
  await go(page, '/explore');
  await tap(page, 'add-milk');
  await go(page, '/cart');
  await id(page, `cart-line-${first}`).waitFor();
  await id(page, 'stepper-milk').getByRole('button', { name: /زيادة/ }).click();
  await until(async () => (await id(page, 'stepper-milk').innerText()).includes('2'), 5000, 'quantity 2');
  await tap(page, `save-later-${first}`);
  await id(page, 'saved-for-later').waitFor();
  assert.equal(await page.locator(`[data-testid="cart-line-${first}"]`).count(), 0);
  await tap(page, `move-to-cart-${first}`);
  await id(page, `cart-line-${first}`).waitFor();
  await fill(page, 'coupon-input', 'E2E10');
  await tap(page, 'apply-coupon');
  await see(page, 'تم تطبيق E2E10');
  const quote = await api('POST', '/checkout/quote', { items: [{ productId: first, quantity: 1 }, { productId: 'milk', quantity: 2 }], couponCode: 'E2E10', address: { city: 'عمان' } }, user.token);
  assert.ok(quote.discount > 0);
  const shown = await page.evaluate((n) => new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD', maximumFractionDigits: 3 }).format(n), quote.total);
  await until(async () => (await textOf(page, 'cart-total')).includes(shown), 10000, `cart total ${shown}`);
  await fill(page, 'coupon-input', 'NOPE99');
  await tap(page, 'apply-coupon');
  await page.locator('text=/غير صالح|غير موجود|منتهي/').first().waitFor();
});

e2e('L038 L040 L041 L042 L043 L044 L047 L049 checkout: saved address, zone fee, a time slot, notes, gift wrap, terms and cash on delivery — placed once', async ({ open }) => {
  const user = await stack.register('مشتري الدفع عند الاستلام');
  await withAddress(user);
  const page = await open(user, '/explore');
  await tap(page, 'add-milk');
  await tap(page, 'add-bread');
  await go(page, '/cart');
  await tap(page, 'checkout');
  await id(page, 'checkout-screen').waitFor();
  await until(async () => (await value(page, 'address-street')) === amman.street, 10000, 'saved address prefilled');
  const { slots } = await api('GET', '/delivery/slots?days=3');
  const slot = slots.find((s) => s.available);
  await tap(page, `slot-${slot.date}-${slot.window}`);
  await fill(page, 'delivery-notes', 'اتصل قبل الوصول');
  await tap(page, 'gift-wrap');
  await fill(page, 'gift-message', 'كل عام وأنت بخير');
  await tap(page, 'to-payment');
  await tap(page, 'pay-cod');
  await tap(page, 'to-review');
  await id(page, 'review-summary').waitFor();
  await see(page, slot.label);
  await see(page, 'اتصل قبل الوصول');
  await see(page, 'تغليف الهدية');
  const quote = await api('POST', '/checkout/quote', { items: [{ productId: 'milk', quantity: 1 }, { productId: 'bread', quantity: 1 }], address: { city: 'عمان' }, deliverySlot: { date: slot.date, window: slot.window }, gift: { wrap: true } }, user.token);
  assert.equal(quote.zone.name.length > 0, true);
  await see(page, `التوصيل (${quote.zone.name})`);
  const shown = await page.evaluate((n) => new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD', maximumFractionDigits: 3 }).format(n), quote.total);
  await until(async () => (await textOf(page, 'review-total')).includes(shown), 10000, 'server total');
  assert.equal(await disabled(id(page, 'confirm-order')), true, 'terms must be accepted first');
  await tap(page, 'accept-terms');
  await id(page, 'confirm-order').dblclick();
  await id(page, 'order-placed').waitFor();
  const { orders } = await api('GET', '/orders', undefined, user.token);
  assert.equal(orders.length, 1, 'a double tap still places a single order');
  const [order] = orders;
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.total, quote.total);
  assert.equal(order.extras.deliveryNotes, 'اتصل قبل الوصول');
  assert.equal(order.extras.gift.message, 'كل عام وأنت بخير');
  assert.equal(order.extras.slot.window, slot.window);
  const after = (await api('GET', '/delivery/slots?days=3')).slots.find((s) => s.date === slot.date && s.window === slot.window);
  assert.equal(after.remaining, slot.remaining - 1, 'the slot capacity is used');
  await see(page, 'كل عام وأنت بخير');
});

// Issue #121: express delivery from the nearest branch with a courier tip, then pickup at a branch with no delivery fee.
e2e('L038 L047 express delivery with a tip, and pickup at a branch, priced by the server', async ({ open }) => {
  const user = await stack.register('مشتري سريع');
  await withAddress(user);
  const page = await open(user, '/explore');
  await tap(page, 'add-headphones');
  await go(page, '/cart');
  await tap(page, 'checkout');
  await until(async () => (await value(page, 'address-street')) === amman.street, 10000, 'saved address prefilled');
  // The test address is about 1.6 km from the Abdoun branch, inside the express radius.
  await until(async () => (await id(page, 'mode-express').getAttribute('aria-disabled')) !== 'true', 10000, 'express offered');
  await tap(page, 'mode-express');
  await tap(page, 'tip-1');
  await tap(page, 'to-payment');
  await tap(page, 'pay-cod');
  await tap(page, 'to-review');
  await until(async () => (await textOf(page, 'review-delivery')).includes('توصيل سريع'), 10000, 'express in the summary');
  await id(page, 'review-tip').waitFor();
  const quote = await api('POST', '/checkout/quote', { items: [{ productId: 'headphones', quantity: 1 }], address: { city: amman.city, latitude: amman.latitude, longitude: amman.longitude }, deliveryMode: 'express', tip: 1 }, user.token);
  const shown = await page.evaluate((n) => new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD', maximumFractionDigits: 3 }).format(n), quote.total);
  await until(async () => (await textOf(page, 'review-total')).includes(shown), 10000, 'server total with the express fee and the tip');
  await tap(page, 'accept-terms');
  await tap(page, 'confirm-order');
  await id(page, 'order-placed').waitFor();
  let [order] = (await api('GET', '/orders', undefined, user.token)).orders;
  assert.equal(order.extras.fulfillment.mode, 'express');
  assert.equal(order.extras.fulfillment.tip, 1);
  assert.equal(order.extras.fulfillment.branchId, 'br_amman');
  assert.equal(order.total, quote.total);
  // Pickup in Irbid: no delivery fee and no tip.
  await go(page, '/explore');
  await tap(page, 'add-headphones');
  await go(page, '/cart');
  await tap(page, 'checkout');
  await until(async () => (await value(page, 'address-street')) === amman.street, 10000, 'saved address prefilled');
  await tap(page, 'mode-pickup');
  await tap(page, 'pickup-br_irbid');
  await tap(page, 'to-payment');
  await tap(page, 'pay-cod');
  await tap(page, 'to-review');
  await until(async () => (await textOf(page, 'review-delivery')).includes('فرع شارع الجامعة'), 10000, 'pickup branch in the summary');
  await tap(page, 'accept-terms');
  await tap(page, 'confirm-order');
  await id(page, 'order-placed').waitFor();
  [order] = (await api('GET', '/orders', undefined, user.token)).orders;
  assert.equal(order.extras.fulfillment.mode, 'pickup');
  assert.equal(order.extras.fulfillment.branchName, 'فرع شارع الجامعة');
  assert.equal(order.shipping, 0);
});

e2e('L045 pay with the wallet balance', async ({ open }) => {
  const user = await stack.register('دافع بالمحفظة');
  await withAddress(user);
  await asAdmin('POST', '/admin/wallet/adjust', { userId: user.user.id, amount: 30, note: 'رصيد اختبار المحفظة' });
  const page = await open(user, '/explore');
  await tap(page, 'add-cheese');
  await go(page, '/cart');
  await tap(page, 'checkout');
  await until(async () => (await value(page, 'address-street')) === amman.street);
  await tap(page, 'to-payment');
  await tap(page, 'pay-wallet');
  await tap(page, 'to-review');
  await tap(page, 'accept-terms');
  await tap(page, 'confirm-order');
  await id(page, 'order-placed').waitFor();
  const [order] = (await api('GET', '/orders', undefined, user.token)).orders;
  assert.equal(order.paymentMethod, 'wallet');
  const wallet = await api('GET', '/wallet', undefined, user.token);
  assert.equal(Math.round((30 - order.total) * 1000) / 1000, wallet.balance);
});

e2e('L046 pay by card in the sandbox: a declined test card is refused, the 4242 card is charged', async ({ open }) => {
  const user = await stack.register('دافع بالبطاقة');
  await withAddress(user);
  const page = await open(user, '/explore');
  await tap(page, 'add-rice');
  await go(page, '/cart');
  await tap(page, 'checkout');
  await until(async () => (await value(page, 'address-street')) === amman.street);
  await tap(page, 'to-payment');
  await tap(page, 'pay-card');
  await fill(page, 'card-number', '4000 0000 0000 0002');
  await fill(page, 'card-name', 'Test Shopper');
  await fill(page, 'card-expiry', '12/30');
  await fill(page, 'card-cvc', '123');
  await tap(page, 'to-review');
  await tap(page, 'accept-terms');
  await tap(page, 'confirm-order');
  await page.locator('text=/رُفضت|رفض/').first().waitFor();
  assert.equal((await api('GET', '/orders', undefined, user.token)).orders.length, 0);
  await tab(page, '٢ الدفع').click();
  await fill(page, 'card-number', '4242 4242 4242 4242');
  await fill(page, 'card-name', 'Test Shopper');
  await fill(page, 'card-expiry', '12/30');
  await fill(page, 'card-cvc', '123');
  await tap(page, 'to-review');
  await see(page, '•••• 4242');
  await tap(page, 'confirm-order');
  await id(page, 'order-placed').waitFor();
  const [order] = (await api('GET', '/orders', undefined, user.token)).orders;
  assert.equal(order.paymentMethod, 'card');
  assert.equal(order.extras.payment.last4, '4242');
  assert.equal(JSON.stringify(order).includes('4242424242424242'), false, 'the card number is never stored');
  await see(page, '•••• 4242');
});

e2e('L048 redeem a gift card into the wallet', async ({ open }) => {
  const user = await stack.register('صاحب بطاقة الهدية');
  const { code } = await asAdmin('POST', '/admin/gift-cards', { amount: 15, note: 'هدية اختبار' });
  const page = await open(user, '/wallet');
  await fill(page, 'gift-code', code);
  await tap(page, 'redeem-gift');
  await see(page, 'أُضيف');
  assert.equal((await api('GET', '/wallet', undefined, user.token)).balance, 15);
  await until(async () => (await textOf(page, 'wallet-transactions')).includes('بطاقة هدية'), 10000, 'transaction listed');
  await fill(page, 'gift-code', code);
  await tap(page, 'redeem-gift');
  await page.locator('text=/مستخدمة|استُخدمت|غير صالح/').first().waitFor();
});

e2e('L050 buy now checks out one product without touching the cart', async ({ open }) => {
  const user = await stack.register('مستعجل');
  await withAddress(user);
  const page = await open(user, '/explore');
  await tap(page, 'add-bread');
  await go(page, '/product/eggs');
  await tap(page, 'buy-now');
  await see(page, 'شراء مباشر');
  await until(async () => (await value(page, 'address-street')) === amman.street);
  await tap(page, 'to-payment');
  await tap(page, 'to-review');
  await see(page, 'بيض بلدي × 1');
  assert.equal(await id(page, 'review-summary').getByText('خبز عربي').count(), 0);
  await tap(page, 'accept-terms');
  await tap(page, 'confirm-order');
  await id(page, 'order-placed').waitFor();
  const [order] = (await api('GET', '/orders', undefined, user.token)).orders;
  assert.deepEqual(order.items.map((i) => i.productId), ['eggs']);
  await go(page, '/cart');
  await id(page, 'cart-line-bread').waitFor();
});

e2e('L036 reorder a previous order with one tap', async ({ open }) => {
  const user = await stack.register('معيد الطلب');
  const order = await delivered(user, [{ productId: 'milk', quantity: 2 }, { productId: 'bread', quantity: 1 }]);
  const page = await open(user, '/orders');
  await tab(page, 'السابقة').click();
  await tap(page, `reorder-${order.id}`);
  await id(page, 'cart').waitFor();
  await until(async () => (await id(page, 'stepper-milk').innerText()).includes('2'), 10000, 'same quantity');
  await id(page, 'cart-line-bread').waitFor();
});

// =====================================================================================================
// Orders, delivery and returns
// =====================================================================================================
e2e('L051 L052 L053 L055 order history tabs, the order timeline and cancelling an order', async ({ open }) => {
  const user = await stack.register('متابع الطلبات');
  const done = await delivered(user, [{ productId: 'water', quantity: 1 }]);
  const pending = await stack.order(user, [{ productId: 'sugar', quantity: 1 }]);
  const page = await open(user, '/orders');
  await id(page, `order-${pending.id}`).waitFor();
  assert.equal(await page.locator(`[data-testid="order-${done.id}"]`).count(), 0);
  await tab(page, 'السابقة').click();
  await id(page, `order-${done.id}`).waitFor();
  await tab(page, 'الحالية').click();
  await tap(page, `track-${pending.id}`);
  await id(page, 'tracking').waitFor();
  await id(page, 'order-steps').waitFor();
  await see(page, 'سجل مراحل الطلب');
  await see(page, 'بانتظار التأكيد');
  await tap(page, 'cancel-order');
  await until(async () => (await api('GET', `/orders/${pending.id}`, undefined, user.token)).order.status === 'cancelled', 10000, 'cancelled on the server');
  await see(page, 'ملغي');
  await go(page, '/orders');
  await tab(page, 'السابقة').click();
  await id(page, `order-${pending.id}`).waitFor();
  await tab(page, 'المرتجعات').click();
  await see(page, 'لا توجد مرتجعات');
});

e2e('L091 L092 L054 L093 L060 the driver shares location, the shopper sees the live map, the driving ETA and the delivery code', async ({ open }) => {
  const user = await stack.register('ينتظر التوصيل');
  const order = await stack.order(user, [{ productId: 'apple', quantity: 2 }]);
  const driver = await stack.ensureDriver();
  await asAdmin('PATCH', `/admin/orders/${order.id}`, { status: 'confirmed', driverId: driver.user.id });
  await asAdmin('PATCH', `/admin/orders/${order.id}`, { status: 'preparing' });
  const road = await open(driver, '/driver', { geolocation: { latitude: 31.962, longitude: 35.91 } });
  await button(road, `اختيار التوصيلة ${order.id}`).click();
  await see(road, 'تبدأ مشاركة الموقع بعد تأكيد خروج الطلب للتوصيل');
  await button(road, 'تأكيد الخروج للتوصيل وإبلاغ العميل').click();
  await until(async () => (await api('GET', `/orders/${order.id}`, undefined, user.token)).order.status === 'out_for_delivery', 10000, 'out for delivery');
  await button(road, 'السماح بالموقع وبدء المشاركة').click();
  await see(road, 'وصل تحديث الموقع إلى خادم المتجر.');
  const tracking = await api('GET', `/orders/${order.id}/tracking`, undefined, user.token);
  assert.ok(Math.abs(tracking.location.latitude - 31.962) < 0.0005);
  const shopper = await open(user);
  await shopper.route('https://router.project-osrm.org/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 'Ok', routes: [{ distance: 4200, duration: 540, geometry: { type: 'LineString', coordinates: [[35.91, 31.962], [35.905, 31.955], [35.9, 31.95]] } }] }) }));
  await go(shopper, `/tracking/${order.id}`);
  await see(shopper, 'في الطريق إليك');
  await see(shopper, 'موقع حديث منشور من جهاز السائق.');
  await shopper.locator('iframe[title="خريطة تتبع التوصيل"]').waitFor();
  await see(shopper, 'مسافة القيادة التقريبية');
  await see(shopper, 'دقيقة قيادة');
  const code = (await textOf(shopper, 'delivery-code')).match(/\d{4}/)[0];
  const { code: serverCode } = await api('GET', `/orders/${order.id}/delivery-code`, undefined, user.token);
  assert.equal(code, serverCode);
  await road.locator('[data-testid="driver-otp"]').fill(code === '0000' ? '1111' : '0000');
  await button(road, 'تأكيد تسليم الطلب للعميل').click();
  await road.locator('[role="alert"]').first().waitFor();
  assert.equal((await api('GET', `/orders/${order.id}`, undefined, user.token)).order.status, 'out_for_delivery');
  await road.locator('[data-testid="driver-otp"]').fill(code);
  await button(road, 'تأكيد تسليم الطلب للعميل').click();
  await until(async () => (await api('GET', `/orders/${order.id}`, undefined, user.token)).order.status === 'delivered', 10000, 'delivered with the right code');
});

e2e('L056 L057 L058 L059 invoice, rating the order and driver, and returning one item with a photo refunded to the wallet', async ({ open }) => {
  const user = await stack.register('مُرجِع');
  const order = await delivered(user, [{ productId: 'milk', quantity: 2 }, { productId: 'rice', quantity: 1 }]);
  const page = await open(user, `/invoice/${order.id}`);
  await id(page, 'invoice-summary').waitFor();
  await see(page, 'INV-');
  await page.frameLocator('iframe[title="الفاتورة"]').getByText(order.id).first().waitFor();
  await go(page, `/order/${order.id}`);
  await tap(page, 'order-star-5');
  await tap(page, 'driver-star-4');
  await fill(page, 'rating-comment', 'توصيل سريع ومرتب');
  await tap(page, 'submit-rating');
  await see(page, 'تقييمك');
  const rated = (await api('GET', `/orders/${order.id}`, undefined, user.token)).order.extras.rating;
  assert.equal(rated.rating, 5);
  assert.equal(rated.driverRating, 4);
  await go(page, `/returns?orderId=${order.id}`);
  await tap(page, 'return-item-milk');
  await page.getByRole('button', { name: 'المنتج تالف أو مكسور' }).click();
  await fill(page, 'return-details', 'العبوة مكسورة');
  await pickFile(page, 'return-photo', png([200, 200, 200], 64));
  await page.getByRole('img', { name: 'الصورة المرفقة' }).waitFor();
  await tap(page, 'submit-return');
  await id(page, 'return-done').waitFor();
  const [request] = (await api('GET', '/me/returns', undefined, user.token)).returns;
  assert.deepEqual(request.items.map((i) => [i.productId, i.quantity]), [['milk', 1]]);
  assert.ok(request.photoId, 'the photo is attached');
  await asAdmin('PATCH', `/admin/returns/${request.id}`, { status: 'approved', note: 'تمت الموافقة' });
  await go(page, '/wallet');
  await until(async () => (await textOf(page, 'wallet-transactions')).includes('استرداد مرتجع'), 10000, 'refund in the wallet');
  const wallet = await api('GET', '/wallet', undefined, user.token);
  assert.equal(wallet.balance, request.refund);
  await go(page, '/orders');
  await tab(page, 'المرتجعات').click();
  await see(page, 'مقبول — رُدّ المبلغ');
});

// =====================================================================================================
// Loyalty and offers
// =====================================================================================================
e2e('L061 L062 L063 L064 L065 L066 points after delivery, daily check-in, badges, tiers, referrals and redeeming points', async ({ open }) => {
  const user = await stack.register('جامع النقاط');
  await delivered(user, [{ productId: 'headphones', quantity: 1 }]);
  const before = (await api('GET', '/rewards', undefined, user.token)).points;
  assert.ok(before >= 249, 'points earned after delivery');
  const page = await open(user, '/rewards');
  await until(async () => Number(await textOf(page, 'points-balance')) === before, 10000, 'balance shown');
  await tap(page, 'checkin-button');
  await see(page, 'سلسلة 1 أيام');
  const checkin = await api('GET', '/rewards/check-in', undefined, user.token);
  assert.equal(checkin.checkedInToday, true);
  const tier = await api('GET', '/rewards/tier', undefined, user.token);
  await id(page, 'tier').waitFor();
  await see(page, `مستوى ${tier.tier.name}`);
  if (tier.next) await see(page, `باقي ${tier.next.pointsNeeded} نقطة`);
  const { badges } = await api('GET', '/me/badges', undefined, user.token);
  for (const b of badges) await id(page, `badge-${b.id}`).waitFor();
  assert.ok(badges.some((b) => b.earned));
  const { code } = await api('GET', '/referrals', undefined, user.token);
  assert.equal(await textOf(page, 'referral-code'), code);
  // A friend signs up in the app with the code.
  const friendPage = await open(null, '/register');
  const email = `friend-${Date.now()}@e2e.test`;
  await friendPage.getByLabel('الاسم الكامل').fill('صديق مدعو');
  await friendPage.getByLabel('البريد الإلكتروني').fill(email);
  await friendPage.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await friendPage.getByLabel('تأكيد كلمة المرور').fill(password);
  await friendPage.getByLabel('رمز دعوة صديق (اختياري)').fill(code);
  await button(friendPage, 'إنشاء حسابي').click();
  await see(friendPage, 'أُضيفت 20 نقطة ترحيب');
  const friend = await api('POST', '/auth/login', { email, password });
  assert.equal((await api('GET', '/rewards', undefined, friend.token)).points, 20);
  await delivered(friend, [{ productId: 'bread', quantity: 1 }]);
  const afterReferral = (await api('GET', '/rewards', undefined, user.token)).points;
  assert.equal(afterReferral - before - checkin.nextReward >= 50 || afterReferral >= before + 50, true, 'referrer rewarded after the friend’s first delivery');
  await page.reload();
  await tap(page, 'redeem');
  await see(page, 'استبدلت');
  const wallet = await api('GET', '/wallet', undefined, user.token);
  assert.ok(wallet.balance >= 2, 'points became wallet credit');
});

e2e('L067 L068 the offers screen: flash deals with a live countdown and discounted products', async ({ open }) => {
  await asAdmin('POST', '/admin/flash-deals', { productId: 'apple', price: 1, endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(), limit: 20 });
  const page = await open(null, '/offers');
  await id(page, 'flash-section').waitFor();
  await id(page, 'deal-apple').waitFor();
  const first = await id(page, 'deal-apple').locator('[data-testid="countdown"]').innerText();
  await page.waitForTimeout(1300);
  assert.notEqual(await id(page, 'deal-apple').locator('[data-testid="countdown"]').innerText(), first, 'countdown ticks');
  await id(page, 'product-card-headphones').waitFor();
  assert.match(await id(page, 'product-card-headphones').innerText(), /-\d+%/);
  await go(page, '/');
  await id(page, 'flash-deals').waitFor();
  await id(page, 'flash-deals').locator('[data-testid="product-card-apple"]').waitFor();
});

// =====================================================================================================
// Smart assistant
// =====================================================================================================
e2e('L071 L072 L076 L077 L085 conversational shopping: a budget basket, a recipe, text and voice commands, with the character speaking', async ({ open }) => {
  const user = await stack.register('متسوق بالمحادثة');
  const page = await open(user, '/assistant');
  const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/ai/chat')), tap(page, 'starter-جهز لي سلة بـ ٢٠ دينار')]);
  const reply = await response.json();
  assert.equal(reply.intent, 'budget_basket');
  assert.ok(reply.basket.items.length > 0 && reply.basket.total <= 20);
  await id(page, 'basket').waitFor();
  await tap(page, 'add-basket');
  const units = reply.basket.items.reduce((s, i) => s + i.quantity, 0);
  await until(async () => (await cartCount(page)) === units, 10000, 'basket in the cart');
  await until(() => page.evaluate(() => window.__spoken.length > 0), 10000, 'the robot reads the reply aloud');
  await fill(page, 'assistant-input', 'وصفة كبسة لـ 6 أشخاص');
  await tap(page, 'assistant-send');
  await id(page, 'recipe').waitFor();
  await tap(page, 'add-recipe');
  const beforeCommand = await cartCount(page);
  await fill(page, 'assistant-input', 'أضف ٢ حليب للسلة');
  await tap(page, 'assistant-send');
  await until(async () => (await cartCount(page)) === beforeCommand + 2, 10000, 'command added two milk');
  await page.evaluate(() => { window.__voiceText = 'يا لقطي ارقص'; });
  await tap(page, 'assistant-mic');
  await page.locator('[data-testid="bubble-user"]').filter({ hasText: 'يا لقطي ارقص' }).waitFor();
  await until(async () => /يرقص/.test(await page.locator('[data-testid="mascot"] [aria-label]').first().getAttribute('aria-label')), 8000, 'robot dances on command');
});

e2e('L073 the weekly budget planner tracks spending and warns before going over', async ({ open }) => {
  const user = await stack.register('صاحب الميزانية');
  const page = await open(user, '/budget');
  await fill(page, 'budget-input', '18');
  await tap(page, 'save-budget');
  await id(page, 'budget-remaining').waitFor();
  assert.equal((await api('GET', '/me/preferences', undefined, user.token)).preferences.weeklyBudget, 18);
  await stack.order(user, [{ productId: 'milk', quantity: 13 }]);
  await page.reload();
  await id(page, 'budget-categories').waitFor();
  const { budget } = await api('GET', '/me/budget', undefined, user.token);
  assert.ok(budget.warning, 'the server warns at 80%');
  await see(page, budget.warning);
});

e2e('L074 L075 a smart product summary, and substitutes when a product is out of stock', async ({ open }) => {
  await asAdmin('PATCH', '/admin/products/labneh', { stock: 0 });
  const page = await open(null, '/product/milk');
  await id(page, 'smart-summary').waitFor();
  const { summary } = await api('GET', '/products/milk/summary');
  await see(page, summary.slice(0, 30));
  await go(page, '/product/labneh');
  await see(page, 'نفد المخزون');
  await id(page, 'substitutes').waitFor();
  const { substitutes } = await api('GET', '/products/labneh/substitutes');
  assert.ok(substitutes.length > 0);
  await id(page, 'substitutes').locator(`[data-testid="product-card-${substitutes[0].id}"]`).waitFor();
  await asAdmin('PATCH', '/admin/products/labneh', { stock: 50 });
});

// =====================================================================================================
// Support
// =====================================================================================================
e2e('L080 L096 L097 L098 L099 an order-linked chat with bot replies, a photo, a human hand-off and a support ticket', async ({ open }) => {
  const user = await stack.register('يحتاج مساعدة');
  const order = await stack.order(user, [{ productId: 'flour', quantity: 1 }]);
  const page = await open(user, `/support?orderId=${order.id}`);
  await fill(page, 'chat-first-message', 'وين طلبي؟');
  await tap(page, 'start-chat');
  await id(page, 'chat').waitFor();
  await see(page, `مرتبطة بالطلب ${order.id}`);
  await page.locator('[data-testid="message-bot"]').first().waitFor();
  await pickFile(page, 'chat-attach', png([40, 90, 200]));
  await fill(page, 'chat-input', 'هذه صورة الفاتورة');
  await tap(page, 'chat-send');
  await page.getByRole('img', { name: 'صورة مرفقة' }).waitFor();
  await tap(page, 'escalate');
  await see(page, 'مع موظف دعم');
  const { chats } = await api('GET', '/support/chats', undefined, user.token);
  assert.equal(chats[0].status, 'human');
  assert.equal(chats[0].orderId, order.id);
  await go(page, '/support');
  await tab(page, 'التذاكر').click();
  await fill(page, 'ticket-subject', 'استفسار عن الفاتورة');
  await fill(page, 'ticket-message', 'أريد نسخة ضريبية من الفاتورة');
  await tap(page, 'submit-ticket');
  await see(page, 'أريد نسخة ضريبية من الفاتورة');
  assert.equal((await api('GET', '/tickets', undefined, user.token)).tickets.length, 1);
});

e2e('L100 the help centre searches the FAQ and records helpful answers', async ({ open }) => {
  const page = await open(null, '/help');
  await page.locator('[data-testid^="faq-"]:not([data-testid^="faq-category-"]):not([data-testid="faq-search"])').first().waitFor();
  await fill(page, 'faq-search', 'إرجاع');
  const { faqs } = await api('GET', `/faqs?q=${encodeURIComponent('إرجاع')}`);
  assert.ok(faqs.length > 0);
  await until(async () => (await page.locator('[data-testid^="faq-faq"], [data-testid^="faq-"]:not([data-testid^="faq-category-"]):not([data-testid="faq-search"])').count()) === faqs.length, 10000, 'filtered');
  await page.getByRole('button', { name: faqs[0].question }).click();
  await see(page, faqs[0].answer.slice(0, 25));
  await page.getByRole('button', { name: 'أفادتني الإجابة' }).click();
  await see(page, 'شكرًا لتقييمك');
});

// =====================================================================================================
// The robot
// =====================================================================================================
e2e('L082 L083 L084 L085 commands, size, reduced motion, colours, outfits, accessories and voice are saved to the account', async ({ open }) => {
  const user = await stack.register('مصمم الشخصية');
  const page = await open(user, '/robot');
  const preview = '[data-testid="robot-preview"]';
  const label = () => page.locator(`${preview} [aria-label]`).first().getAttribute('aria-label');
  for (const [motion, words] of [['walk', 'يمشي'], ['jump', 'يقفز'], ['come', 'يقترب منك'], ['stop', 'متوقف']]) {
    await tap(page, `motion-${motion}`);
    await until(async () => (await label()).includes(words), 5000, `character ${motion}`);
  }
  await tap(page, 'motion-dance');
  const character = page.locator(`${preview} [data-mode]`).first();
  const box = await character.boundingBox();
  await tap(page, 'size-up');
  await tap(page, 'size-up');
  assert.equal(await textOf(page, 'size-value'), '120%');
  await until(async () => (await character.boundingBox()).height > box.height * 1.1, 5000, 'character grows');
  const engine = await engineFrame(page, preview);
  const moving = await joints(engine);
  await page.waitForTimeout(600);
  assert.notEqual(moving, await joints(engine), 'animated before reduce motion');
  await tap(page, 'reduce-motion');
  await page.waitForTimeout(1500);
  const still = await joints(engine);
  await page.waitForTimeout(800);
  assert.equal(still, await joints(engine), 'no animation with reduced motion');
  await tab(page, 'ملابس').click();
  const plain = await page.locator(preview).innerHTML();
  await tap(page, 'accessory-glasses');
  await tap(page, 'pants-1F2A44');
  await tap(page, 'color-22B07D');
  assert.notEqual(plain, await page.locator(preview).innerHTML(), 'clothes and accessory applied');
  await until(async () => (await page.locator(preview).innerHTML()).toLowerCase().includes('22b07d'), 5000, 'new colour applied');
  await until(async () => (await probe(engine))?.accessory === 'glasses', 5000, 'the 3D character wears the glasses');
  await tab(page, 'مظهر').click();
  await tap(page, 'skin-8D5524');
  await tap(page, 'beard');
  await fill(page, 'robot-name', 'روبي');
  await tap(page, 'save-robot');
  await see(page, 'حفظت شخصيتك');
  const { robot } = (await api('GET', '/me/preferences', undefined, user.token)).preferences;
  assert.deepEqual({ accessory: robot.accessory, color: robot.color, pants: robot.pants, skin: robot.skin, beard: robot.beard, size: robot.size, reduceMotion: robot.reduceMotion, name: robot.name, motion: robot.motion },
    { accessory: 'glasses', color: '#22B07D', pants: '#1F2A44', skin: '#8D5524', beard: false, size: 1.2, reduceMotion: true, name: 'روبي', motion: 'dance' });
  await tab(page, 'صوت').click();
  await tap(page, 'voice-test');
  await until(() => page.evaluate(() => window.__spoken.some((t) => t.includes('روبي'))), 5000, 'the character speaks');
  await tap(page, 'robot-voice');
  await tap(page, 'save-robot');
  await until(async () => (await api('GET', '/me/preferences', undefined, user.token)).preferences.robot.voice === false, 10000, 'voice off saved');
  // The saved character follows the shopper to another device.
  const other = await open(user, '/');
  await until(async () => (await other.locator('[data-testid="mascot"]').innerHTML()).toLowerCase().includes('22b07d'), 10000, 'same character elsewhere');
});

// L084: small spots (here the header on a phone) show a still picture of the shopper's own look, drawn once by the 3D
// engine and kept on the device, instead of the mockups' default pose.
e2e('L084 the still character in small spots shows the shopper\'s own colours', async ({ open }) => {
  const user = await stack.register('صاحب الشخصية الخضراء');
  const { preferences } = await api('GET', '/me/preferences', undefined, user.token);
  await api('PATCH', '/me/preferences', { robot: { ...preferences.robot, color: '#22B07D', pants: '#1F2A44' } }, user.token);
  const page = await open(user, '/rewards');
  const character = page.locator('[data-testid="mascot-character"]').filter({ visible: true }).first();
  await character.waitFor();
  await until(async () => (await character.getAttribute('data-poster')) === 'snapshot', 30000, 'the still picture of the own look');
  // The picture is drawn with the saved green vest: count clearly green, opaque pixels in it.
  const green = async () => character.evaluate(async (element) => {
    const src = element.querySelector('img')?.getAttribute('src') || '';
    if (!src.startsWith('data:image/png;base64,')) return -1;
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 200 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 15) count++;
    return count;
  });
  const first = await green();
  assert.ok(first > 300, `green vest pixels in the still picture: ${first}`);
  // The hidden drawing view closes once the picture exists, so it keeps no WebGL context open.
  await until(async () => (await page.locator('iframe[title="character-snapshot"]').count()) === 0, 10000, 'the drawing view closed');
  // Kept on the device: after a reload the same picture comes from the cache, with no drawing view at all.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(async () => (await character.getAttribute('data-poster')) === 'snapshot', 10000, 'the cached picture after a reload');
  assert.equal(await page.locator('iframe[title="character-snapshot"]').count(), 0, 'nothing redrawn after a reload');
  assert.ok((await green()) > 300, 'the cached picture is the green one');
});

e2e('L087 put my photo on the character\'s face with consent, kept on the device only, and delete it', async ({ open }) => {
  const user = await stack.register('صاحب الصورة');
  const page = await open(user, '/robot-create');
  const uploads = [];
  page.on('request', (r) => { if (/\/api\/uploads/.test(r.url())) uploads.push(r.url()); });
  assert.equal(await disabled(id(page, 'face-gallery')), true, 'consent first');
  await tap(page, 'face-consent');
  await pickFile(page, 'face-gallery', png([250, 200, 160]));
  await tap(page, 'face-confirm');
  await see(page, 'ممتاز! كمّل تخصيص لونه وملابسه وحركاته.');
  const engine = await engineFrame(page, '[data-testid="robot-create"]');
  await until(async () => (await probe(engine))?.photoFace === true, 10000, "the photo is the 3D character's face");
  assert.ok(await page.evaluate(() => (localStorage.getItem('luqta-robot-face-v1') || '').startsWith('data:image/')));
  assert.equal((await api('GET', '/me/preferences', undefined, user.token)).preferences.robot.faceConsent, true);
  assert.deepEqual(uploads, [], 'the photo is never uploaded');
  // The small header character is drawn with the photo too, and that picture stays on the device.
  const cache = () => page.evaluate(() => JSON.parse(localStorage.getItem('luqta-character-snapshots-v1') || 'null'));
  const header = page.locator('[data-testid="mascot-character"]').filter({ visible: true }).first();
  await go(page, '/rewards');
  await until(async () => (await header.getAttribute('data-poster')) === 'snapshot', 30000, 'a still picture drawn with the photo');
  assert.equal((await cache())?.withFace, true);
  assert.deepEqual(uploads, [], 'the drawn picture is never uploaded either');
  await go(page, '/robot-create');
  const again = await engineFrame(page, '[data-testid="robot-create"]');
  await until(async () => (await probe(again))?.photoFace === true, 10000, 'the photo is back after reopening');
  await tap(page, 'face-delete');
  await until(async () => (await probe(again))?.photoFace === false, 5000, 'photo removed from the character');
  assert.equal(await page.evaluate(() => localStorage.getItem('luqta-robot-face-v1')), null);
  // Deleting the photo also deletes the pictures drawn with it; the header is redrawn without the face.
  assert.equal(await cache(), null, 'no stored picture keeps the face');
  await go(page, '/rewards');
  await until(async () => (await header.getAttribute('data-poster')) === 'snapshot' && (await cache())?.withFace === false, 30000, 'a new picture without the face');
  await until(async () => (await api('GET', '/me/preferences', undefined, user.token)).preferences.robot.faceConsent === false, 5000, 'consent withdrawn');
});

// =====================================================================================================
// 3D, AR and freshness
// =====================================================================================================
e2e('L088 L089 a 3D viewer that rotates and zooms, and "try it in my room" over the camera', async ({ open }) => {
  const page = await open(null, '/product/headphones');
  await tap(page, 'open-3d');
  await id(page, 'try').waitFor();
  await id(page, 'viewer-3d').locator('canvas').waitFor();
  await until(async () => (await textOf(page, 'viewer-status')).includes('التكبير 1.0×'), 15000, 'viewer ready');
  const canvas = id(page, 'viewer-3d').locator('canvas');
  const before = await canvas.screenshot();
  await tap(page, 'zoom-in');
  await tap(page, 'zoom-in');
  await until(async () => !(await textOf(page, 'viewer-status')).includes('التكبير 1.0×'), 5000, 'zoomed');
  await tap(page, 'rotate-left');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.notDeepEqual(await canvas.screenshot(), before, 'the model was redrawn');
  await tap(page, 'reset-view');
  await until(async () => (await textOf(page, 'viewer-status')).includes('التكبير 1.0×'), 5000, 'reset');
  await tab(page, 'في غرفتي').click();
  await until(async () => (await textOf(page, 'viewer-status')).includes('الكاميرا تعمل'), 15000, 'camera on');
  await id(page, 'viewer-3d').locator('video').waitFor({ state: 'attached' });
  assert.ok(await id(page, 'viewer-3d').locator('video').evaluate((v) => !!v.srcObject));
  await tab(page, 'ثلاثي الأبعاد').click();
  await until(async () => (await textOf(page, 'viewer-status')).includes('عرض ثلاثي الأبعاد'), 10000, 'camera off');
});

e2e('L090 the home pantry: fresh items arrive after delivery, consuming saves carbon, manual items and waste history', async ({ open }) => {
  const user = await stack.register('مدبرة المخزن');
  await delivered(user, [{ productId: 'milk', quantity: 2 }]);
  const page = await open(user, '/pantry');
  await see(page, 'حليب طازج كامل الدسم × 2');
  const { items } = await api('GET', '/pantry', undefined, user.token);
  const milk = items.find((i) => i.name.includes('حليب'));
  await tap(page, `consume-${milk.id}`);
  await until(async () => Number((await textOf(page, 'carbon')).match(/[\d.]+/)?.[0] || 0) > 0, 10000, 'carbon saved');
  await fill(page, 'pantry-name', 'لبنة بيتية');
  await fill(page, 'pantry-date', new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10));
  await tap(page, 'pantry-submit');
  await see(page, 'لبنة بيتية × 1');
  await see(page, 'قريب الانتهاء');
  const manual = (await api('GET', '/pantry', undefined, user.token)).items.find((i) => i.name === 'لبنة بيتية');
  await tap(page, `waste-${manual.id}`);
  await tab(page, 'السجل').click();
  await see(page, 'لبنة بيتية');
  const { stats } = await api('GET', '/pantry', undefined, user.token);
  assert.equal(stats.wasted, 1);
  assert.equal(stats.consumed, 1);
});

// =====================================================================================================
// Store admin and merchant tools inside the app
// =====================================================================================================
e2e('L101 L102 L107 L111 L114 L094 in-app admin: KPIs, reports, reorder suggestions, slot capacity, products and order management', async ({ open }) => {
  const shopper = await stack.register('عميل للإدارة');
  const order = await stack.order(shopper, [{ productId: 'chickpeas', quantity: 2 }]);
  await asAdmin('PATCH', '/admin/products/croissant', { stock: 1 });
  const driver = await stack.ensureDriver();
  const page = await open(stack.admin, '/admin');
  await id(page, 'admin-overview').waitFor();
  const { kpis } = await asAdmin('GET', '/admin/kpis');
  await until(async () => (await textOf(page, 'kpi-orders')).includes(String(kpis.orders)), 10000, 'KPI orders');
  await tap(page, 'report-30');
  await until(async () => selected(page, 'report-30'));
  await see(page, 'آخر 30 يوم');
  await until(async () => (await textOf(page, 'reorder')).includes('كرواسون زبدة'), 10000, 'low stock suggestion');
  const { slots } = await asAdmin('GET', '/admin/slots?days=3');
  await tap(page, `slot-plus-${slots[0].date}-${slots[0].window}`);
  await until(async () => (await asAdmin('GET', '/admin/slots?days=3')).slots[0].capacity === slots[0].capacity + 5, 10000, 'capacity +5');
  await tab(page, 'المنتجات').click();
  await page.getByLabel('معرّف الصنف أو SKU').fill('e2e-dates');
  await page.getByLabel('اسم الصنف').fill('تمر مجدول فاخر');
  await page.getByLabel('السعر الحالي').fill('4.5');
  await page.getByLabel('الكمية المتاحة').fill('30');
  await button(page, 'إنشاء الصنف').click();
  await see(page, 'حُفظ الصنف في قاعدة البيانات.');
  assert.equal((await products())['e2e-dates'].name, 'تمر مجدول فاخر');
  await tab(page, 'الطلبات').click();
  await button(page, `إدارة الطلب ${order.id}`).click();
  await button(page, 'حالة الطلب: مؤكد').click();
  await button(page, `سائق التوصيل: ${driver.user.name}`).click();
  await button(page, `حفظ حالة وتعيين سائق ${order.id}`).click();
  await see(page, 'حُدّث الطلب');
  const saved = (await asAdmin('GET', '/admin/orders')).orders.find((o) => o.id === order.id);
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.driverId, driver.user.id);
});

e2e('L112 L117 project management: the 125-feature list with evidence, vendors, campaigns and the development log', async ({ open }) => {
  const owner = await stack.register('صاحب متجر جديد');
  const page = await open(stack.admin, '/admin/project');
  await id(page, 'features-summary').waitFor();
  await see(page, '125 ميزة مخططة');
  await id(page, 'feature-L001').click();
  await see(page, '📱 /login');
  await tab(page, 'البائعون').click();
  await fill(page, 'vendor-name', 'متجر الحارة');
  await fill(page, 'vendor-email', owner.user.email);
  await tap(page, 'create-vendor');
  await see(page, 'أُضيف متجر الحارة');
  const vendor = (await asAdmin('GET', '/admin/vendors')).vendors.find((v) => v.name === 'متجر الحارة');
  assert.equal(vendor.members[0].email, owner.user.email);
  await tab(page, 'الحملات').click();
  await fill(page, 'campaign-title', 'حملة الاختبار الشامل');
  await tap(page, 'create-campaign');
  await see(page, 'أُنشئت الحملة');
  const campaign = (await api('GET', '/campaigns')).campaigns.find((c) => c.title === 'حملة الاختبار الشامل');
  assert.ok(campaign);
  await tab(page, 'الأدلة').click();
  await id(page, 'test-log').waitFor();
  await fill(page, 'devlog-title', 'تحقق الاختبارات الشاملة');
  await tap(page, 'devlog-add');
  await see(page, 'تحقق الاختبارات الشاملة');
  const home = await open(null, '/');
  await id(home, `campaign-${campaign.id}`).waitFor();
});

e2e('L118 L119 L120 L121 L122 L113 L104 central sync from the app: refresh now, receipts with retry and log download, diff before import, branch stock and CSV preview', async ({ open }) => {
  const page = await open(stack.admin, '/admin/sync');
  await see(page, 'متصل بلوحة القيادة المركزية');
  const calls = stack.center.calls.length;
  await tap(page, 'sync-refresh');
  await until(async () => (await page.locator('[data-testid^="receipt-SYNC-"]').count()) >= 3, 20000, 'three receipts');
  const sent = stack.center.calls.slice(calls);
  const appSync = sent.find((c) => c.path === '/api/v1/app/sync');
  // The central schema takes numeric product IDs: each local ID is sent through the same stable mapping the server uses.
  assert.ok(appSync && appSync.body.products.some((p) => p.id === productNumber('milk') && typeof p.retailPrice === 'number' && typeof p.stockQuantity === 'number'), 'app/sync used retailPrice and stockQuantity');
  assert.ok(sent.some((c) => c.path === '/api/v1/bridge/snapshot'), 'snapshot sent');
  const snapshot = sent.find((c) => c.path === '/api/v1/bridge/snapshot').body;
  assert.doesNotMatch(JSON.stringify(snapshot), /password|token_hash|"email"/i, 'no sensitive columns in the snapshot');
  assert.ok(sent.some((c) => c.path === '/api/v1/bridge/receipts'), 'operation receipts sent');
  const { receipts } = await asAdmin('GET', '/admin/sync/receipts');
  const partial = receipts.find((r) => r.kind === 'runner' && r.status !== 'success');
  assert.ok(partial, 'the rejected operation makes the run partial');
  await tap(page, `retry-${partial.id}`);
  await until(async () => (await asAdmin('GET', '/admin/sync/receipts')).receipts.some((r) => r.retryOf === partial.id), 15000, 'retry receipt');
  const [download] = await Promise.all([page.waitForEvent('download'), tap(page, `download-${partial.id}`)]);
  assert.equal(download.suggestedFilename(), `${partial.id}.csv`);
  assert.match(readFileSync(await download.path(), 'utf8'), /op-e2e-2/);
  // External import: diff first, then apply only the valid rows.
  await tap(page, 'sync-pull');
  await id(page, 'sync-preview').waitFor();
  await see(page, 'جديد 1');
  await see(page, 'مرفوض 1');
  await see(page, 'price: 1.15 → 1.2');
  await tap(page, 'sync-apply');
  await until(async () => (await products()).milk.price === 1.2 && !!(await products())['cc-dates'], 15000, 'import applied');
  // Branch stock with optimistic versions.
  await tap(page, 'stock-branch-br_amman');
  const row = (await asAdmin('GET', '/admin/branch-stock?branch=br_amman')).stock.find((r) => r.productId === 'water');
  await page.locator('[data-testid="qty-br_amman-water"]').fill('33');
  await tap(page, 'save-stock');
  await see(page, 'حُفظت كمية مياه معدنية');
  const saved = (await asAdmin('GET', '/admin/branch-stock?branch=br_amman')).stock.find((r) => r.productId === 'water');
  assert.equal(saved.quantity, 33);
  assert.equal(saved.version, row.version + 1);
  // CSV preview before import.
  await page.locator('[data-testid="csv-input"]').fill('id,name,price,stock,category\nwater,مياه معدنية,1.6,90,drinks\n,بلا معرف,1,1,drinks');
  await tap(page, 'csv-preview');
  await see(page, 'تغيّر 1');
  await see(page, 'مرفوض 1');
  assert.equal((await products()).water.price, 1.5, 'preview changes nothing');
  await tap(page, 'sync-apply');
  await until(async () => (await products()).water.price === 1.6, 10000, 'CSV applied');
});

// =====================================================================================================
// Platform: themes, languages, currencies
// =====================================================================================================
e2e('L123 L124 L125 day and night modes, English with the page direction flipped, and prices in a second currency', async ({ open }) => {
  await asAdmin('PUT', '/admin/currency-rates', { rates: { USD: 1.41, EUR: 1.3 } });
  const user = await stack.register('محب المظهر');
  const page = await open(user, '/appearance');
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="appearance"]')).backgroundColor);
  await page.getByRole('radio', { name: 'الوضع الليلي' }).click();
  await see(page, 'المظهر الحالي: ليلي');
  assert.equal(await background(), 'rgb(16, 12, 34)');
  await page.getByRole('radio', { name: 'الوضع النهاري' }).click();
  await see(page, 'المظهر الحالي: نهاري');
  assert.equal(await background(), 'rgb(245, 242, 255)');
  // "System" follows the device.
  await page.getByRole('radio', { name: 'حسب إعداد الجهاز' }).click();
  const night = await open(user, '/appearance', { colorScheme: 'dark' });
  await see(night, 'المظهر الحالي: ليلي');
  // L125: an approximate second currency next to store prices.
  await tap(page, 'currency-USD');
  await until(async () => (await textOf(page, 'currency-example')).includes('≈'), 5000, 'approximate price');
  assert.equal((await api('GET', '/me/preferences', undefined, user.token)).preferences.displayCurrency, 'USD');
  // L124: English text and the layout mirrors (Home tab moves from the right edge to the left edge).
  const homeX = async () => (await id(page, 'tab-home').boundingBox()).x;
  assert.ok((await homeX()) > 200, 'Arabic: Home on the right');
  await page.getByRole('radio', { name: 'English' }).click();
  await see(page, 'Language & appearance');
  await until(async () => (await homeX()) < 120, 5000, 'English: Home on the left');
  assert.equal((await api('GET', '/me/preferences', undefined, user.token)).preferences.locale, 'en');
  await go(page, '/product/headphones');
  await until(async () => (await textOf(page, 'product')).includes('≈'), 10000, 'approx price on the product page');
  await go(page, '/appearance');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await see(page, 'اللغة والمظهر');
});

// The Rafiq design lives next to the classic one: the shopper picks it, and the classic home keeps its own look with
// a "near you" section. Location is read only with permission (granted here, at Irbid), branches come from the server
// with real coordinates, and the map page carries them. External map tiles are blocked in tests, so the map shows its
// offline notice; its data is checked in the page source.
e2e('L123 L081 the Rafiq design: user-chosen, companions, floating market, intents, the branches map near the shopper, Instagram and Facebook links', async ({ open }) => {
  await asAdmin('PATCH', '/admin/settings', { storefront: { instagram: 'https://instagram.com/luqta.store', facebook: 'https://facebook.com/LuqtaStore' } });
  const user = await stack.register('محب رفيق');
  // Classic stays the default: its header, the invitation to try Rafiq, and the branches near the shopper.
  const page = await open(user, '/');
  await id(page, 'home').waitFor();
  await id(page, 'design-hint').waitFor();
  assert.equal(await page.locator('[data-testid="rafiq-hero"]').count(), 0, 'classic home by default');
  await id(page, 'nearby-branch-br_irbid').waitFor();
  await until(async () => (await textOf(page, 'nearby')).includes('الأقرب'), 15000, 'branches sorted by distance from the shopper');
  assert.ok((await textOf(page, 'nearby')).indexOf('فرع شارع الجامعة') < (await textOf(page, 'nearby')).indexOf('فرع عبدون'), 'Irbid first for a shopper in Irbid');
  const directions = await id(page, 'directions-br_irbid').getAttribute('aria-label');
  assert.match(directions, /خرائط Google/);
  await id(page, 'nearby-products').waitFor();
  await id(page, 'social-instagram').waitFor();
  await id(page, 'social-facebook').waitFor();
  await tap(page, 'show-map');
  const classicMap = await id(page, 'stores-map').locator('iframe').getAttribute('srcdoc');
  assert.ok(classicMap.includes('فرع شارع الجامعة') && classicMap.includes('32.5415') && classicMap.includes('"me":{"lat":32.55'), 'the map carries the branches and the shopper');
  // The shopper chooses Rafiq in Language & appearance.
  await go(page, '/appearance');
  await page.getByRole('radio', { name: 'تصميم رفيق' }).click();
  await page.getByRole('radio', { name: 'الوضع الليلي' }).click();
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="appearance"]')).backgroundColor);
  await until(async () => (await background()) === 'rgb(7, 10, 18)', 5000, 'the Rafiq night palette');
  await go(page, '/');
  await id(page, 'rafiq-hero').waitFor();
  await id(page, 'brand-logo').waitFor();
  assert.equal(await page.locator('[data-testid="design-hint"]').count(), 0);
  // The floating market: the store's departments as pavilions, the shopper's animated character in the middle.
  const { categories } = await api('GET', '/categories');
  await id(page, 'floating-market').waitFor();
  for (const dept of ['fresh', 'electronics', 'fashion', 'home']) await id(page, `market-store-${dept}`).waitFor();
  const character = await engineFrame(page, '[data-testid="floating-market"] [data-testid="mascot"]');
  const a = await joints(character);
  await page.waitForTimeout(700);
  assert.notEqual(a, await joints(character), 'the character animates on the island');
  // Phones are narrower than this test page. On a 320-360 dp screen an awning path once came out as "h--0.19", which
  // the Android SVG parser rejects by closing the app. Every path must be plain path data at phone widths too.
  for (const width of [320, 360, 412]) {
    await page.setViewportSize({ width, height: 860 });
    await page.waitForTimeout(400);
    const paths = await page.locator('[data-testid="floating-market"] path').evaluateAll((els) => els.map((el) => el.getAttribute('d')));
    assert.ok(paths.length > 10, `paths drawn at ${width}px`);
    for (const d of paths) assert.ok(isStrictPath(d), `${width}px: ${d}`);
  }
  // Companions: the choice changes the voice and is remembered.
  await see(page, 'أنا نيرا');
  await tap(page, 'companion-orion');
  await until(async () => (await textOf(page, 'concierge-text')).includes('أوريون'), 5000, 'Orion speaks');
  // An intent gathers real products; adding one goes to the cart on the server's catalog.
  await tap(page, 'intent-dinner');
  await id(page, 'concierge-pasta').waitFor();
  await id(page, 'concierge-tomato-sauce').waitFor();
  await tap(page, 'concierge-add-pasta');
  await until(async () => (await textOf(page, 'concierge-text')).includes('سُجّلت'), 5000, 'the companion confirms');
  await until(async () => /1/.test((await id(page, 'tab-cart').getAttribute('aria-label')) || ''), 5000, 'one item in the cart');
  // A typed request in the shopper's own words.
  await fill(page, 'concierge-ask', 'بدي هدية لأمي');
  await tap(page, 'concierge-send');
  await id(page, 'concierge-fragrance').waitFor();
  await page.reload();
  await id(page, 'rafiq-hero').waitFor();
  await until(async () => (await id(page, 'companion-orion').getAttribute('aria-checked')) === 'true', 10000, 'the companion is remembered');
  // A pavilion opens its department.
  await tap(page, `market-store-${categories.find((c) => c.id === 'electronics').id}`);
  await id(page, 'explore').waitFor();
  await until(async () => selected(page, 'chip-electronics'));
  // From my location: the real branches map, nearest first, choosing a branch sets it for the order.
  await go(page, '/');
  await tap(page, 'mode-location');
  await until(async () => (await textOf(page, 'concierge-text')).includes('أقربها فرع شارع الجامعة'), 15000, 'the nearest branch is named');
  const map = await id(page, 'stores-map').locator('iframe').getAttribute('srcdoc');
  assert.ok(map.includes('فرع عبدون') && map.includes('31.9454') && map.includes('filter:invert(1)'), 'night map with both branches');
  await tap(page, 'nearby-branch-br_amman');
  await until(async () => (await textOf(page, 'concierge-text')).includes('فرع عبدون') && (await textOf(page, 'concierge-text')).includes('التوصيل لمنزلك'), 5000, 'the companion heads to Abdoun');
  assert.equal(await id(page, 'nearby-branch-br_amman').getAttribute('aria-checked'), 'true');
  await id(page, 'social-instagram').waitFor();
  // Back to the classic design: everything returns as it was.
  await go(page, '/appearance');
  await page.getByRole('radio', { name: 'التصميم الكلاسيكي' }).click();
  await page.getByRole('radio', { name: 'الوضع النهاري' }).click();
  await until(async () => (await background()) === 'rgb(245, 242, 255)', 5000, 'the classic day palette');
  await go(page, '/');
  await id(page, 'home').waitFor();
  assert.equal(await page.locator('[data-testid="rafiq-hero"]').count(), 0);
});

// Screens added with the Rafiq work, usable in both designs: nearby stores on a full map, a branch's own page, and a
// full conversation with the companion.
e2e('L123 nearby stores, a branch page with directions and its stock, and the companion chat', async ({ open }) => {
  const user = await stack.register('مستكشف الفروع');
  const page = await open(user, '/nearby');
  await id(page, 'nearby-screen').waitFor();
  await until(async () => (await textOf(page, 'stat-branches')).includes('2'), 10000, 'two branches on the map');
  await until(async () => /م|كم/.test(await textOf(page, 'stat-distance')), 15000, 'distance to the nearest branch');
  await id(page, 'stores-map').waitFor();
  // A branch's own page: distance from the shopper in Irbid, a phone to call, make it the order branch, its stock.
  await tap(page, 'branch-details-br_amman');
  await id(page, 'branch-screen').waitFor();
  await see(page, 'فرع عبدون');
  await until(async () => (await textOf(page, 'branch-distance')).includes('كم'), 15000, 'distance from Irbid to Abdoun');
  await id(page, 'branch-call').waitFor();
  await id(page, 'branch-directions').waitFor();
  await tap(page, 'make-my-branch');
  await until(async () => (await id(page, 'make-my-branch').getAttribute('aria-disabled')) === 'true', 5000, 'Abdoun is the order branch');
  await fill(page, 'branch-search', 'سماعات');
  await id(page, 'product-card-headphones').waitFor();
  // The companion chat: an intent answers with real products; anything else goes to the full assistant.
  await go(page, '/companion');
  await id(page, 'companion-screen').waitFor();
  await see(page, 'أنا نيرا');
  await tap(page, 'chat-intent-breakfast');
  await id(page, 'chat-2-labneh').waitFor();
  await fill(page, 'companion-input', 'كم سعر الدولار اليوم');
  await tap(page, 'companion-send');
  await tap(page, 'handoff-4');
  await until(async () => new URL(page.url()).pathname === '/assistant', 10000, 'handed to the assistant');
});

// L124 for the staff screens: with English chosen, the admin dashboard (every section), project management, sync,
// the merchant dashboard and the driver screen show no staff text left in Arabic. Data such as product and customer
// names stays as it was entered.
e2e('L124 the staff screens in English: admin dashboard, project, sync, merchant and driver', async ({ open }) => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const source = readFileSync(`${root}src/lib/i18n-en.ts`, 'utf8');
  const EN = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1).replace(/,\s*}$/, '}'));
  // Phrases of 8+ letters without placeholders, compared with whole pieces of the page's text (lines, and the parts
  // between "·" separators): data such as the imported product «تمر من لوحة القيادة» may contain a phrase.
  const phrases = [...staffStrings(root).strings.keys()].filter((k) => k.length >= 8 && !k.includes('{') && !k.includes('\n'));
  const pieces = async (page) => new Set((await page.evaluate(() => document.body.innerText)).split('\n').flatMap((line) => line.split(' · ')).map((piece) => piece.trim()).filter(Boolean));
  const english = async (user, path) => {
    const page = await open(user);
    await page.context().addInitScript(() => { try { window.localStorage.setItem('luqta-language-v1', 'en'); } catch {} });
    await go(page, path);
    return page;
  };
  const stillArabic = async (page, where) => {
    const shown = await pieces(page);
    assert.deepEqual(phrases.filter((phrase) => shown.has(phrase)), [], `${where}: staff text still in Arabic`);
  };

  // Control: in Arabic, the same check does find the staff text, so a pass in English means it was translated.
  const arabic = await open(stack.admin, '/admin');
  await id(arabic, 'admin-overview').waitFor();
  await see(arabic, 'مبيعات اليوم');
  const shown = await pieces(arabic);
  assert.ok(phrases.filter((phrase) => shown.has(phrase)).length >= 3, 'the check finds Arabic staff text when Arabic is chosen');

  const admin = await english(stack.admin, '/admin');
  await see(admin, 'Sales, orders, inventory and sync in one place');
  await id(admin, 'admin-overview').waitFor();
  await see(admin, EN['مبيعات اليوم']);
  await stillArabic(admin, 'admin overview');
  await tab(admin, 'Products').click();
  await see(admin, EN['إضافة صنف']);
  await stillArabic(admin, 'admin products');
  await tab(admin, 'Orders').click();
  await see(admin, EN['ملاحظة قرار الإرجاع']);
  await stillArabic(admin, 'admin orders');
  await tab(admin, 'More').click();
  for (const label of ['المخزون والاستيراد', 'استيراد العروض', 'تصميم المتجر', 'المرتجعات', 'العروض', 'المستخدمون والمحفظة', 'دعم العملاء', 'قناة الوكلاء', 'الإعدادات', 'سجل العمليات']) {
    await button(admin, EN[label]).click();
    await until(async () => (await button(admin, EN[label]).getAttribute('aria-selected')) === 'true', 5000, `${EN[label]} selected`);
    await admin.waitForTimeout(400);
    await stillArabic(admin, `admin: ${EN[label]}`);
  }
  // A typing mistake in a number field is explained in English too.
  await button(admin, EN['العروض']).click();
  await admin.getByLabel(EN['قيمة الخصم']).fill('abc');
  await button(admin, EN['حفظ رمز الخصم']).click();
  await see(admin, `Enter a valid number for ${EN['قيمة الخصم']}.`);

  for (const [path, title] of [['/admin/project', 'إدارة المشروع'], ['/admin/sync', 'المخزون والمزامنة']]) {
    await go(admin, path);
    await see(admin, EN[title]);
    await admin.waitForTimeout(400);
    await stillArabic(admin, path);
  }

  const merchant = await stack.register('تاجر إنجليزي');
  const { vendor } = await asAdmin('POST', '/admin/vendors', { name: 'Corner Bakery', commission: 8 });
  await asAdmin('POST', `/admin/vendors/${vendor.id}/members`, { email: merchant.user.email, role: 'owner' });
  const shop = await english(merchant, '/vendor');
  await id(shop, 'vendor-summary').waitFor();
  await see(shop, EN['ملخص المبيعات']);
  await stillArabic(shop, 'merchant dashboard');

  const road = await english(await stack.ensureDriver(), '/driver');
  await see(road, EN['طلبات التوصيل المعيّنة']);
  await stillArabic(road, 'driver screen');
});
