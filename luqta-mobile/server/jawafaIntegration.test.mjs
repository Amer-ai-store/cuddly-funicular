import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';

test('Jawafa actual stock, offers, appearance and permissions work only in Luqta commerce', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'luqta-jawafa-bridge-'));
  const app = await createCommerceServer({
    dbPath: resolve(directory, 'commerce.sqlite'),
    bootstrapAdmin: { name: 'مدير', email: 'admin@example.test', password: 'integration-password-123' },
  });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  async function request(method, path, body, token) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const auth = await request('POST','/auth/login',{email:'admin@example.test',password:'integration-password-123'});
  assert.equal(auth.status, 200);
  const token = auth.body.token;
  const customer = await request('POST','/auth/register',{name:'عميل',email:'customer@example.test',password:'customer-password-123'});
  assert.equal(customer.status, 201);
  const snapshot = { schema:'jawafa-inventory-v1', snapshotAt:new Date().toISOString(),
    items:[{id:'jawafa_101',name:'مادة جوافة',price:2.5,category:'groceries',readyQuantity:40,unpostedSalesQuantity:13,actualQuantity:27}] };
  assert.equal((await request('POST','/admin/inventory/jawafa-preview',snapshot,customer.body.token)).status,403);
  const preview = await request('POST','/admin/inventory/jawafa-preview',snapshot,token);
  assert.equal(preview.status,200,JSON.stringify(preview.body));
  assert.equal(preview.body.preview[0].actualQuantity,27);
  assert.equal(preview.body.preview[0].readyQuantity,40);
  assert.equal(preview.body.preview[0].unpostedSalesQuantity,13);
  assert.equal(preview.body.applied,false);
  assert.equal((await request('GET','/products/jawafa_101')).status,404);
  const bad = JSON.parse(JSON.stringify(snapshot)); bad.items[0].actualQuantity = 40;
  assert.equal((await request('POST','/admin/inventory/jawafa-import',{...bad,confirm:true},token)).status,422);
  assert.equal((await request('POST','/admin/inventory/jawafa-import',snapshot,token)).status,409);
  const imported = await request('POST','/admin/inventory/jawafa-import',{...snapshot,confirm:true},token);
  assert.equal(imported.status,200,JSON.stringify(imported.body));
  assert.equal((await request('GET','/products/jawafa_101')).body.product.stock,27);
  assert.equal((await request('POST','/admin/offers/import',{confirm:true,items:[{id:'jawafa_101',price:1.75,oldPrice:2.5}]},customer.body.token)).status,403);
  assert.equal((await request('POST','/admin/offers/import',{items:[{id:'jawafa_101',price:1.75,oldPrice:2.5}]},token)).status,409);
  const offer = await request('POST','/admin/offers/import',{confirm:true,items:[{id:'jawafa_101',price:1.75,oldPrice:2.5}]},token);
  assert.equal(offer.status,200,JSON.stringify(offer.body));
  const catalog = await request('GET','/products/jawafa_101');
  assert.equal(catalog.body.product.price,1.75);
  assert.equal(catalog.body.product.stock,27);
  assert.equal((await request('GET','/admin/offers',undefined,token)).body.offers.some(p=>p.id==='jawafa_101'),true);
  const updated = await request('PATCH','/admin/settings',{storefront:{heroTitle:'عروض جوافة',heroSubtitle:'تسوق الكميات المتاحة',accentColor:'#125588',showAssistant:false}},token);
  assert.equal(updated.status,200,JSON.stringify(updated.body));
  const settings = await request('GET','/settings');
  assert.equal(settings.body.settings.storefront.heroTitle,'عروض جوافة');
  assert.equal(settings.body.settings.storefront.showAssistant,false);
  assert.equal((await request('PATCH','/admin/settings',{storefront:{accentColor:'bad'}},token)).status,400);
  // The store's Instagram and Facebook pages: official hosts over HTTPS only, saved without query strings.
  const social = await request('PATCH','/admin/settings',{storefront:{instagram:'https://www.instagram.com/luqta.store/?utm=x',facebook:'https://facebook.com/LuqtaStore'}},token);
  assert.equal(social.status,200,JSON.stringify(social.body));
  const shown = (await request('GET','/settings')).body.settings.storefront;
  assert.equal(shown.instagram,'https://www.instagram.com/luqta.store');
  assert.equal(shown.facebook,'https://facebook.com/LuqtaStore');
  assert.equal(shown.heroTitle,'عروض جوافة','other storefront settings are kept');
  for (const bad of ['http://instagram.com/x','https://instagram.com.evil.example/x','https://evil.example/instagram.com','javascript:alert(1)','https://user:pw@instagram.com/x','https://instagram.com/']) assert.equal((await request('PATCH','/admin/settings',{storefront:{instagram:bad}},token)).status,400,bad);
  assert.equal((await request('PATCH','/admin/settings',{storefront:{facebook:'https://facebook.com/x" onmouseover="y'}},token)).status,400);
  assert.equal((await request('PATCH','/admin/settings',{storefront:{instagram:''}},token)).status,200);
  assert.equal((await request('GET','/settings')).body.settings.storefront.instagram,undefined);
});
