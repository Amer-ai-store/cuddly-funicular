import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { createApiStore } from '../dist/api-store.js';

const root=resolve(import.meta.dirname,'..');
const site='https://aas-test.example';

test('real Worker API persists state in D1, rejects stale writes and enforces auth', async t=>{
  const mf=new Miniflare({scriptPath:resolve(root,'dist/server/index.js'),modules:true,compatibilityDate:'2025-05-01',d1Databases:['DB'],bindings:{AAS_API_TOKEN:'isolated-test-service-token',AAS_PRIVATE_SITE_BEARER:'isolated-test-site-token',AAS_PUBLIC_ORIGIN:site,AAS_ALLOWED_SERVER_ORIGINS:'[]'}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir(resolve(root,'drizzle'))).filter(name=>name.endsWith('.sql')).sort()){
    const sql=await readFile(resolve(root,'drizzle',name),'utf8');
    for(const statement of sql.split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  async function request(path, {method='GET', data, headers={}}={}) {
    const response=await mf.dispatchFetch(site+'/api/v1'+path,{method,headers:{'oai-authenticated-user-id':'isolated-test-owner',...(data?{'Content-Type':'application/json','Origin':site}:{}),...headers},body:data?JSON.stringify(data):undefined});
    return {response,body:response.status===304?null:await response.json()};
  }
  let current=(await request('/state')).body;
  const action=async(operation,payload={},expectedRevision=current.revision)=>{
    const result=await request('/actions',{method:'POST',data:{operation,payload,expectedRevision}});
    if(result.response.ok)current=result.body;
    return result;
  };

  await t.test('empty live state and conditional reads',async()=>{
    assert.equal(current.state.schemaVersion,2);
    assert.equal(current.state.demoMode,false);
    assert.equal(current.connection.storage,'D1');
    assert.equal(current.state.tasks.length,0);
    assert.equal(current.state.approvals.length,0);
    assert.equal(current.state.runs.length,0);
    const cached=await request('/state',{headers:{'If-None-Match':'"'+current.revision+'"'}});
    assert.equal(cached.response.status,304);
  });

  await t.test('email-only Sites visitor can read state and download owner connection config',async()=>{
    // Matches the production gateway header shape: email and display metadata,
    // with no oai-authenticated-user-id header.
    const visitorHeaders={
      'oai-authenticated-user-email':'isolated-owner@example.com',
      'oai-authenticated-user-full-name':'Isolated%20Owner',
      'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8',
    };
    const loaded=await mf.dispatchFetch(site+'/api/v1/state',{headers:visitorHeaders});
    assert.equal(loaded.status,200);
    assert.equal((await loaded.json()).revision,current.revision);
    const config=await mf.dispatchFetch(site+'/api/v1/app/connection-config',{
      method:'POST',headers:{...visitorHeaders,'Content-Type':'application/json',Origin:site},body:'{}',
    });
    assert.equal(config.status,200);
    assert.equal(config.headers.get('Cache-Control'),'private, no-store');
    assert.match(config.headers.get('Content-Disposition'),/^attachment; filename="aas-app-connection\.json"$/);
    assert.deepEqual(await config.json(),{baseUrl:site+'/',apiToken:'isolated-test-service-token',siteAccessToken:'isolated-test-site-token',automaticSync:false});
    assert.equal((await request('/state')).body.revision,current.revision);
  });

  await t.test('email fallback retains CSRF and credential-download restrictions',async()=>{
    const endpoint=site+'/api/v1/app/connection-config';
    const post=(headers)=>mf.dispatchFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:site,...headers},body:'{}'});
    const crossOrigin=await post({'oai-authenticated-user-email':'isolated-owner@example.com',Origin:'https://other.example'});
    assert.equal(crossOrigin.status,403);
    assert.equal((await crossOrigin.json()).error.code,'cross_site_request');
    const crossSite=await post({'oai-authenticated-user-email':'isolated-owner@example.com','Sec-Fetch-Site':'cross-site'});
    assert.equal(crossSite.status,403);
    assert.equal((await crossSite.json()).error.code,'cross_site_request');
    const serviceOnly=await post({'X-AAS-API-Key':'isolated-test-service-token'});
    assert.equal(serviceOnly.status,403);
    assert.equal((await serviceOnly.json()).error.code,'owner_session_required');
    for(const headers of [{},{'oai-authenticated-user-full-name':'Owner','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'},{'oai-authenticated-user-email':'   ','oai-authenticated-user-id':'   '}]){
      const loaded=await mf.dispatchFetch(site+'/api/v1/state',{headers});
      assert.equal(loaded.status,401);
      assert.equal((await loaded.json()).error.code,'authentication_required');
      const config=await post(headers);
      assert.equal(config.status,401);
      assert.equal((await config.json()).error.code,'authentication_required');
    }
  });

  await t.test('revision conflicts preserve the winning write',async()=>{
    const revision=current.revision;
    const won=await action('updateSettings',{storeName:'متجر API الفعلي'},revision);
    assert.equal(won.response.status,200);
    const stale=await action('updateSettings',{storeName:'تغيير قديم'},revision);
    assert.equal(stale.response.status,409);
    assert.equal(stale.body.state.settings.storeName,'متجر API الفعلي');
    assert.equal(stale.body.revision,current.revision);
    const row=await db.prepare('SELECT revision, document FROM aas_app_state WHERE id = ?').bind('organization').first();
    assert.equal(JSON.parse(row.document).settings.storeName,'متجر API الفعلي');
    assert.equal(row.revision,current.revision);
  });

  await t.test('review task creates approval; pending task is locked; decision persists',async()=>{
    const workspace=current.state.workspaces[0];
    const added=await action('addTask',{title:'اختبار موافقة API',description:'التحقق من التنفيذ',workspaceId:workspace.id,agentId:workspace.agentIds[0],status:'review',priority:'high'});
    assert.equal(added.response.status,200);
    const task=added.body.result;
    const approval=current.state.approvals.find(record=>record.taskId===task.id);
    assert.equal(approval.status,'pending');
    assert.equal((await action('updateTask',{id:task.id,patch:{status:'done'}})).response.status,422);
    assert.equal((await action('deleteTask',{id:task.id})).response.status,422);
    assert.equal((await action('resolveApproval',{id:approval.id,decision:'approved'})).response.status,200);
    assert.equal(current.state.tasks.find(record=>record.id===task.id).status,'queued');
    assert.equal((await action('resolveApproval',{id:approval.id,decision:'approved'})).response.status,422);
    assert.equal((await action('updateTask',{id:task.id,patch:{title:'مهمة تم تعديلها',status:'done'}})).response.status,200);
    assert.equal((await action('deleteTask',{id:task.id})).response.status,200);
    assert.ok(!current.state.tasks.some(record=>record.id===task.id));
  });

  await t.test('workspaces, notes and agent profiles persist through resource API reads',async()=>{
    const added=await action('addWorkspace',{name:'مساحة اختبار API',description:'سياق مشترك',agentIds:[current.state.agents[0].id]});
    const workspace=added.body.result;
    assert.equal(added.response.status,200);
    assert.equal((await action('updateWorkspace',{id:workspace.id,patch:{name:'مساحة معدلة'}})).response.status,200);
    assert.equal((await action('addNote',{workspaceId:workspace.id,body:'ملاحظة محفوظة في D1'})).response.status,200);
    const loaded=(await request('/workspaces/'+workspace.id)).body.data;
    assert.equal(loaded.name,'مساحة معدلة');
    assert.equal(loaded.notes[0].body,'ملاحظة محفوظة في D1');
    const agent=current.state.agents[0];
    assert.equal((await action('updateAgent',{id:agent.id,patch:{name:'وكيل معدّل',role:'تنسيق اختبار',description:'ملف تنظيمي فعلي',status:'paused'}})).response.status,200);
    assert.equal(current.state.agents[0].status,'paused');
    assert.equal(current.state.agents[0].model,'غير متصل');
    assert.equal(current.state.runs.length,0);
  });

  await t.test('server configuration does not bypass origin policy or forge health',async()=>{
    const added=await action('addServer',{name:'خادم اختبار',baseUrl:'https://shop-test.example',apiPrefix:'/api/v2',healthPath:'/health',enabled:true,tokenEnv:null});
    const server=added.body.result;
    assert.equal(added.response.status,200);
    assert.equal(server.status,'unverified');
    assert.equal((await action('updateServer',{id:server.id,patch:{apiPrefix:'/api/v3'}})).response.status,200);
    const before=current.revision;
    const checked=await request('/servers/'+server.id+'/check',{method:'POST',data:{expectedRevision:current.revision}});
    assert.equal(checked.response.status,403);
    assert.equal(checked.body.error.code,'origin_not_allowed');
    assert.equal((await request('/state')).body.revision,before);
    assert.equal((await action('recordServerHealth',{id:server.id,status:'online'})).response.status,400);
    assert.equal((await action('addServer',{name:'خادم داخلي',baseUrl:'http://127.0.0.1',apiPrefix:'/api',healthPath:'/health',enabled:true})).response.status,422);
    assert.equal((await action('deleteServer',{id:server.id})).response.status,200);
  });

  await t.test('JSON validation and import require live schema and revalidate server health',async()=>{
    const snapshot=structuredClone(current.state);
    assert.equal((await request('/import/validate',{method:'POST',data:{data:snapshot}})).response.status,200);
    assert.equal((await request('/import/validate',{method:'POST',data:{data:{...snapshot,schemaVersion:1,demoMode:true}}})).response.status,422);
    const imported=await action('importData',{data:JSON.stringify(snapshot)});
    assert.equal(imported.response.status,200);
    assert.equal(imported.body.state.schemaVersion,2);
    assert.equal(imported.body.state.demoMode,false);
    assert.equal(imported.body.state.runs.length,0);
    assert.ok(imported.body.state.activity.some(record=>record.title.includes('استيراد')));
  });

  await t.test('unauthenticated, cross-site, missing-revision and private operations are rejected',async()=>{
    const anonymous=await mf.dispatchFetch(site+'/api/v1/state');
    assert.equal(anonymous.status,401);
    const service=await mf.dispatchFetch(site+'/api/v1/state',{headers:{'X-AAS-API-Key':'isolated-test-service-token'}});
    assert.equal(service.status,200);
    assert.equal((await request('/actions',{method:'POST',data:{operation:'updateSettings',payload:{ownerName:'مرفوض'},expectedRevision:current.revision},headers:{Origin:'https://other.example'}})).response.status,403);
    assert.equal((await request('/actions',{method:'POST',data:{operation:'updateSettings',payload:{ownerName:'مرفوض'}}})).response.status,428);
    assert.equal((await action('inventedOperation',{})).response.status,400);
    assert.equal((await request('/missing')).response.status,405);
    const raw=await mf.dispatchFetch(site+'/api/v1/actions',{method:'POST',headers:{'oai-authenticated-user-id':'isolated-test-owner','Content-Type':'text/plain'},body:'bad'});
    assert.equal(raw.status,415);
    const client=(await request('/state')).body;
    assert.notEqual(client.state.settings.ownerName,'مرفوض');
  });

  await t.test('API browser store does not replay conflicting mutations',async()=>{
    let mutations=0;
    const fetchImpl=async(path,options)=>{
      if(path.endsWith('/actions'))mutations++;
      return mf.dispatchFetch(site+path,{...options,headers:{...options.headers,'oai-authenticated-user-id':'isolated-test-owner'}});
    };
    const client=await createApiStore({fetchImpl,pollMs:100000});
    try {
      await action('updateSettings',{ownerName:'مستخدم آخر'});
      await assert.rejects(client.updateSettings({ownerName:'طلب متعارض'}),error=>error.status===409);
      assert.equal(mutations,1);
      assert.equal(client.getState().settings.ownerName,'مستخدم آخر');
      assert.equal(client.getConnection().status,'online');
      assert.equal(client.getConnection().busy,false);
    } finally { client.dispose(); }
  });

  await t.test('application sync requires service authentication and exposes only received catalog data',async()=>{
    const snapshot={deviceId:'isolated-android-test',appVersion:'test-2.0',products:[{id:7,name:'منتج اختبار متكامل',category:'إلكترونيات',retailPrice:50,wholesalePrice:30,stockQuantity:4,merchantName:'متجر الاختبار',imageUrl:''}],orders:[{id:9,productId:7,productName:'منتج اختبار متكامل',quantity:2,totalPrice:100,status:'pending',createdAt:Date.now(),customerName:'لا يُحفظ',customerPhone:'لا يُحفظ',shippingAddress:'لا يُحفظ'}]};
    const browserWrite=await request('/app/sync',{method:'POST',data:snapshot});
    assert.equal(browserWrite.response.status,401);
    assert.equal((await action('recordAppSnapshot',snapshot)).response.status,400);
    const synced=await request('/app/sync',{method:'POST',data:snapshot,headers:{'X-AAS-API-Key':'isolated-test-service-token'}});
    assert.equal(synced.response.status,200);
    assert.equal(synced.body.productsAccepted,1);
    assert.equal(synced.body.ordersAccepted,1);
    current=(await request('/state')).body;
    assert.equal(current.state.commerce.deviceId,snapshot.deviceId);
    assert.ok(current.state.commerce.receivedAt);
    assert.equal(current.state.commerce.orders[0].id,'9');
    assert.equal(current.state.commerce.orders[0].customerName,undefined);
    assert.equal(current.state.commerce.orders[0].customerPhone,undefined);
    assert.equal(current.state.commerce.orders[0].shippingAddress,undefined);
    const found=(await request('/products/search?q='+encodeURIComponent('منتج'))).body;
    assert.equal(found.length,1);
    assert.equal(found[0].id,7);
    const comparison=(await request('/products/7/compare')).body;
    assert.equal(comparison.source,'app_catalog');
    assert.equal(comparison.externalComparison,false);
    assert.equal(comparison.prices.length,1);
    assert.equal(comparison.prices[0].isBestDeal,false);
    assert.equal((await request('/radar')).response.status,503);
    assert.equal((await request('/social')).response.status,503);
    const preserved=structuredClone(current.state.commerce);
    await action('importData',{data:{...current.state,commerce:{deviceId:null,appVersion:null,products:[],orders:[],receivedAt:null}}});
    assert.deepEqual(current.state.commerce,preserved);
  });

  await t.test('delayed polling response cannot replace a newer saved revision',async()=>{
    let readCount=0;
    let release;
    let announceRead;
    const heldRead=new Promise(resolve=>{announceRead=resolve;});
    const fetchImpl=async(path,options)=>{
      const response=await mf.dispatchFetch(site+path,{...options,headers:{...options.headers,'oai-authenticated-user-id':'isolated-test-owner'}});
      if(path.endsWith('/state')&&++readCount===2){
        const data=await response.text();
        const result=new Promise(resolve=>{release=()=>resolve(new Response(data,{status:response.status,headers:response.headers}));});
        announceRead();
        return result;
      }
      return response;
    };
    const client=await createApiStore({fetchImpl,pollMs:100000});
    try {
      const polling=client.refresh({force:true});
      await heldRead;
      await client.updateSettings({ownerName:'تغيير محفوظ أثناء المزامنة'});
      const savedRevision=client.getRevision();
      release();await polling;
      assert.equal(client.getRevision(),savedRevision);
      assert.equal(client.getState().settings.ownerName,'تغيير محفوظ أثناء المزامنة');
      current=(await request('/state')).body;
    } finally { client.dispose(); }
  });
});
