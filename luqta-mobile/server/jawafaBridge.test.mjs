import assert from 'node:assert/strict';
import test from 'node:test';
import { createJawafaBridge } from './jawafaBridge.mjs';

function mockFetch(path) {
  const response = path.endsWith('/api/health') ? { ok: true, mode: 'FORENSIC-READ-ONLY', database: 'Jawafa_DB', passwordSource: 'SECRET' }
    : path.endsWith('/api/tables') ? { ok: true, tables: [{ TABLE_NAME:'Items'}, { TABLE_NAME:'AA_ActQty' }, {TABLE_NAME:'MPOSPriceOffer'}] }
    : { ok:true, data:[{ItemCode:123,ItemcodeSeq:123,Description:'بند مختبر',FamCode:'FOOD',Cost:9999,Password:'private'}] };
  return Promise.resolve({ok:true,headers:{get:()=>null},text:()=>Promise.resolve(JSON.stringify(response))});
}
test('only loopback forensic source is allowed',()=> {
  assert.throws(()=>createJawafaBridge({url:'https://public.example.net'}),/127.0.0.1/);
  assert.throws(()=>createJawafaBridge({url:'http://192.168.1.99:3456'}),/127.0.0.1/);
});
test('live local bridge status is redacted and stock remains unverified',async()=> {
  const bridge=createJawafaBridge({fetchImpl:mockFetch});
  const status=await bridge.status();
  assert.equal(status.connected,true);
  assert.equal(status.quantityMappingVerified,false);
  assert.equal(status.saleableImportEnabled,false);
  assert.equal(JSON.stringify(status).includes('SECRET'),false);
});
test('catalog preview omits costs and unrelated private fields',async()=> {
  const data=await createJawafaBridge({fetchImpl:mockFetch}).catalogPreview();
  assert.equal(data.items[0].code,'123');
  assert.equal(data.items[0].name,'بند مختبر');
  assert.equal(JSON.stringify(data).includes('9999'),false);
  assert.equal(JSON.stringify(data).includes('private'),false);
});
test('incorrect bridge mode is refused',async()=>{
  const fetchImpl=async()=>({ok:true,headers:{get:()=>null},text:()=>Promise.resolve(JSON.stringify({ok:true,mode:'READ-WRITE',database:'Jawafa_DB'}))});
  await assert.rejects(()=>createJawafaBridge({fetchImpl}).status(),/المعتمد/);
});
