import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommerceServer } from './commerce.mjs';

test('real API protects Jawafa source, returns only read-only metadata, and starts with no fake sales catalog', async(t)=>{
  const folder=await mkdtemp(resolve(tmpdir(),'luqta-real-jawafa-'));
  const fetchCalls=[];
  const jawafaFetchImpl=async(url, options)=>{
    fetchCalls.push({url:String(url),method:options.method,redirect:options.redirect});
    const response=String(url).endsWith('/api/health')?{ok:true,mode:'FORENSIC-READ-ONLY',database:'Jawafa_DB',passwordSource:'CONFIDENTIAL'}:
      String(url).endsWith('/api/tables')?{ok:true,tables:[{TABLE_NAME:'Items'},{TABLE_NAME:'AA_ActQty'},{TABLE_NAME:'Offers'}]}:
      {ok:true,data:[{ItemCode:'1001',ItemcodeSeq:1001,Description:'أرز',FamCode:'01',Cost:1000,BankAccount:'HIDDEN'}]};
    return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const app=await createCommerceServer({dbPath:resolve(folder,'commerce.sqlite'),seedDemoProducts:false,
    bootstrapAdmin:{name:'مدير',email:'admin@example.test',password:'test-password-secure-123'},
    jawafaFetchImpl});
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
  t.after(async()=>{await app.close();await rm(folder,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port+'/api';
  const req=async(method,path,body,token)=>{const response=await fetch(base+path,{method,
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
    body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};};
  const login=await req('POST','/auth/login',{email:'admin@example.test',password:'test-password-secure-123'});
  assert.equal(login.status,200);
  const admin=login.data.token;
  const customer=(await req('POST','/auth/register',{name:'زبون',email:'customer@example.test',password:'test-customer-secure-123'})).data.token;
  const catalog=await req('GET','/products');
  assert.equal(catalog.data.products.length,0,'production catalog must not have 25 fake sample items');
  assert.equal((await req('GET','/admin/jawafa/source')).status,401);
  assert.equal((await req('GET','/admin/jawafa/source',undefined,customer)).status,403);
  const source=await req('GET','/admin/jawafa/source',undefined,admin);
  assert.equal(source.status,200);
  assert.equal(source.data.connected,true);
  assert.equal(source.data.tableCount,3);
  assert.equal(source.data.quantityMappingVerified,false);
  assert.equal(source.data.saleableImportEnabled,false);
  assert.equal(JSON.stringify(source.data).includes('CONFIDENTIAL'),false);
  const preview=await req('GET','/admin/jawafa/catalog-preview',undefined,admin);
  assert.equal(preview.status,200);
  assert.equal(preview.data.items[0].name,'أرز');
  assert.equal(JSON.stringify(preview.data).includes('HIDDEN'),false);
  assert.equal((await req('POST','/admin/jawafa/source',{},admin)).status,405);
  assert.ok(fetchCalls.length>=3);
  assert.ok(fetchCalls.every(c=>c.method==='GET'&&c.url.startsWith('http://127.0.0.1:3456/api/')));
});
