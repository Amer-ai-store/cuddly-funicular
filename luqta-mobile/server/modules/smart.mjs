// Smart shopping tools, discovery, phone/Google sign-in and admin two-step verification, brought over from the
// "Luqta 2.0 design 3d" branch (PR #115). Those features were written as self-contained installers
// (features.mjs, commerceExtras.mjs, operations.mjs, mfa.mjs, authProviders.mjs); this module mounts them on the
// module system and exposes only the routes that do not duplicate a feature the store already has. Shopping lists,
// campaigns, daily check-in, merchant accounts, receipts, order rating, payments and checkout changes stay with the
// existing modules, so each feature keeps a single implementation and a single set of tables.
import { installFeatures } from '../features.mjs';
import { installCommerceExtras, FLAG_DEFAULTS } from '../commerceExtras.mjs';
import { installOperations, unitPrice } from '../operations.mjs';
import { installMfa } from '../mfa.mjs';
import { installAuthProviders } from '../authProviders.mjs';

export const name = 'smart';

const FEATURE_ROUTES = [
  ['GET', '/products/:id/price-history'], ['GET', '/products/:id/compare'], ['GET', '/products/:id/together'], ['POST', '/products/:id/event'],
  ['GET', '/market/pulse'], ['GET', '/trending'], ['GET', '/me/insights'], ['GET', '/bundles'], ['POST', '/basket/optimize'],
  ['GET', '/watchlist'], ['POST', '/watchlist'], ['DELETE', '/watchlist/:id'], ['PUT', '/admin/competitor-prices'],
  ['GET', '/coupons/public'], ['PATCH', '/admin/coupon-visibility/:id'],
  ['GET', '/media'], ['POST', '/media/:id/like'], ['POST', '/media/:id/view'], ['GET', '/admin/media'], ['POST', '/admin/media'], ['PATCH', '/admin/media/:id'], ['DELETE', '/admin/media/:id'],
  ['GET', '/rewards/profile'], ['POST', '/rewards/game'], ['GET', '/ai/status'],
];
const EXTRA_ROUTES = [
  ['GET', '/flags'], ['GET', '/collections'], ['GET', '/collections/:id'],
  ['GET', '/loyalty/stamps'], ['POST', '/analytics/event'], ['GET', '/admin/analytics'],
];
const OPERATION_ROUTES = [
  ['GET', '/me/budget-forecast'], ['GET', '/me/predicted-basket'], ['GET', '/me/consents'], ['PUT', '/me/consents'], ['GET', '/products/:id/passport'],
  ['POST', '/ops/import/preview'], ['POST', '/ops/import/commit'], ['GET', '/ops/anomalies'], ['GET', '/ops/costs'], ['PUT', '/ops/costs'], ['GET', '/ops/expiry'], ['POST', '/ops/expiry/apply'],
  ['GET', '/ops/offer-audit'], ['POST', '/ops/offer-lab'], ['GET', '/ops/stock-insights'], ['GET', '/ops/backups'], ['POST', '/ops/backups'], ['POST', '/ops/backups/:id/drill'],
];
const MFA_ROUTES = [['GET', '/auth/mfa/status'], ['POST', '/auth/mfa/setup'], ['POST', '/auth/mfa/enable'], ['POST', '/auth/mfa/verify'], ['POST', '/auth/mfa/disable']];
const AUTH_ROUTES = [
  ['GET', '/auth/providers'], ['POST', '/auth/phone/start'], ['POST', '/auth/phone/verify'], ['POST', '/auth/google/start'], ['GET', '/auth/google/callback'],
  ['POST', '/auth/google/id-token'], ['POST', '/auth/exchange'], ['GET', '/auth/identities'],
];

export async function install(c, api) {
  const flagOn = (key) => ({ ...FLAG_DEFAULTS, ...(c.setting('flags', {}) || {}) })[key] !== false;
  const identityOptional = (req) => { try { return req.headers.authorization ? c.identity(req) : null; } catch { return null; } };
  const features = installFeatures({ ...c, flagOn });
  const extras = installCommerceExtras({ ...c, flagOn, orderExtras: features.orderExtras, saveOrderExtras: features.saveOrderExtras });
  const operations = installOperations({ ...c, bundleFor: features.bundleFor });
  const mfa = installMfa(c);
  const authProviders = installAuthProviders({ ...c, identityOptional });

  // Each installer answers { status, body } (or { redirect }) for the paths it owns, or null for any other path.
  const mount = (routes, call) => {
    for (const [method, pattern] of routes) {
      api.route(method, pattern, async ({ req, body, path, url }) => {
        const result = await call(method, path, body, req, url);
        if (!result) c.fail(404, 'المسار غير موجود', 'not_found');
        if (result.redirect) return { redirect: result.redirect };
        return [result.status, result.body];
      });
    }
  };
  mount(FEATURE_ROUTES, (method, path, body, req) => features.handle(method, path, path.slice(4).split('/').filter(Boolean), body, req));
  mount(EXTRA_ROUTES, (method, path, body, req, url) => extras.handle(method, path, body, req, url));
  mount(OPERATION_ROUTES, (method, path, body, req, url) => operations.handle(method, path, body, req, url));
  mount(MFA_ROUTES, (method, path, body, req) => mfa.handle(method, path, body, req));
  mount(AUTH_ROUTES, (method, path, body, req, url) => authProviders.handle(method, path, body, req, url));

  // Feature switches, home collections and the stamp card are saved with the store settings. Delivery zones,
  // branches and express delivery stay with the checkout module's own settings.
  api.provide('validateSettingsExtras', (body, updates) => extras.validateSettings({ collections: body.collections, flags: body.flags, stampCard: body.stampCard }, updates));
  const earlierPublic = api.current('publicSettings');
  api.provide('publicSettings', () => ({ ...earlierPublic(), flags: { ...FLAG_DEFAULTS, ...(c.setting('flags', {}) || {}) }, collections: c.setting('collections', []) || [], stampCard: c.setting('stampCard', null) }));
  // Stock past its best-before date is never sold, and products sold by weight or volume show a price per kg / litre.
  api.provide('checkSellable', (p) => { if (operations.isExpired(p)) c.fail(409, `انتهت صلاحية المنتج ${p.name} ولا يمكن بيعه`, 'expired'); });
  api.decorate((item) => (item.measureUnit ? { ...item, unitPrice: unitPrice(item.basePrice ?? item.price, item.measureUnit, item.measureSize) } : item));
  // Admin sessions of an account with two-step verification wait for the code before any admin action.
  api.provide('mfaRequired', (actor) => mfa.gate(actor));
  // Stamp card: a stamp per delivered order, and a personal voucher when the card is full.
  api.on('orderStatus', (o, status) => { if (status === 'delivered') { extras.onDelivered(o); features.onDelivered(o); } });
  // Account deletion removes what these features stored about the shopper.
  api.on('deleteUser', (userId) => {
    for (const sql of ['DELETE FROM price_watches WHERE user_id=?', 'DELETE FROM media_likes WHERE user_id=?', 'DELETE FROM stamp_cards WHERE user_id=?',
      'DELETE FROM stamp_awards WHERE user_id=?', 'DELETE FROM user_identities WHERE user_id=?', 'DELETE FROM game_awards WHERE user_id=?']) {
      try { c.run(sql, userId); } catch { /* the table may not exist in an older database */ }
    }
    operations.deleteUser(userId);
    mfa.deleteUser(userId);
  });
}
