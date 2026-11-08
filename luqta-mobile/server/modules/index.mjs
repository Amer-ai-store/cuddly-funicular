// Feature modules for the commerce server. Each module creates its own tables and registers routes and hooks;
// the core server calls the hooks at fixed points (checkout, order status, catalog changes, sessions, account deletion).
import * as accounts from './accounts.mjs';
import * as catalog from './catalog.mjs';
import * as checkout from './checkout.mjs';
import * as engagement from './engagement.mjs';
import * as intelligence from './intelligence.mjs';
import * as support from './support.mjs';
import * as management from './management.mjs';
import * as sync from './sync.mjs';
import * as smart from './smart.mjs';

const MODULES = [accounts, catalog, checkout, engagement, intelligence, support, management, sync, smart];

export async function installModules(ctx) {
  const routes = [], hooks = new Map(), decorators = [];
  const provided = {
    decorateProduct: (item, row) => decorators.reduce((value, fn) => fn(value, row), item),
    unitPrice: (row, data) => data.price,
    validateProductExtras: () => ({}),
    orderExtras: () => null,
    publicSettings: () => ({}),
    checkBranchStock: () => {},
    verifyDeliveryCode: () => {},
    returnPlan: () => null,
    mfaRequired: () => false,
    checkSellable: () => {},
    validateSettingsExtras: () => {},
  };
  const api = {
    route(method, pattern, handler) {
      const keys = [];
      const source = pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
      routes.push({ method, regex: new RegExp(`^/api${source}$`), keys, handler });
    },
    on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); },
    decorate(fn) { decorators.push(fn); },
    provide(name, fn) { provided[name] = fn; },
    use: (name) => (...args) => provided[name](...args),
    /** The provider registered so far, for a module that extends it rather than replacing it. */
    current: (name) => provided[name],
    emit: (name, ...args) => { for (const fn of hooks.get(name) || []) fn(...args); },
  };
  for (const mod of MODULES) await mod.install(ctx, api);
  const ext = {
    names: MODULES.map((mod) => mod.name),
    ...provided,
    emit: api.emit,
    async handle(request) {
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.regex.exec(request.path);
        if (!match) continue;
        let params;
        try { params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])); } catch { ctx.fail(400, 'مسار غير صالح'); }
        const result = await route.handler({ ...request, params, query: request.url.searchParams });
        if (result && result.redirect) {
          request.res.writeHead(302, { Location: result.redirect, 'Cache-Control': 'no-store' });
          request.res.end();
        } else if (result && result.raw) {
          const { status = 200, type, content, filename } = result.raw;
          request.res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(filename ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}) });
          request.res.end(content);
        } else if (Array.isArray(result)) request.send(result[0], result[1]);
        else request.send(200, result);
        return true;
      }
      return false;
    },
  };
  return ext;
}
