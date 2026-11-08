import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {getProviderCapabilities,loadAssistantEnvironment,configureProvider,discoverProviderModels} from '../server/provider-settings.mjs';
const env={AAS_SECRET_ENCRYPTION_KEY:'ab'.repeat(32)};
const input={apiKey:'fixture-gemini-key-for-test-only',model:'fixture-model'};
const metadata=(patch={})=>new Response(JSON.stringify({name:'models/'+input.model,supportedGenerationMethods:['generateContent','countTokens'],...patch}),{headers:{'Content-Type':'application/json'}});
async function database(context){
  const mf=new Miniflare({script:'export default {fetch(){return new Response("test fixture")}};',modules:true,compatibilityDate:'2025-05-01',d1Databases:['DB']});
  context.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  const sql=await readFile(new URL('../drizzle/0002_abandoned_black_crow.sql',import.meta.url),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean))await db.prepare(statement).run();
  return db;
}
async function saved(db){return db.prepare('SELECT * FROM aas_control_records WHERE id=?').bind('provider-gemini').first();}

test('real D1 stores only AES-GCM ciphertext; validated model setup never issues generation or returns the key',async context=>{
  const db=await database(context);let request;
  const result=await configureProvider(input,env,db,async(url,options)=>{request={url,options};return metadata();});
  assert.equal(request.url,'https://generativelanguage.googleapis.com/v1beta/models/fixture-model');
  assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'manual');assert.equal(request.options.headers['x-goog-api-key'],input.apiKey);
  assert.ok(!request.url.includes(input.apiKey));assert.equal(request.options.body,undefined);
  assert.deepEqual({...result,lastTestedAt:null},{configured:true,provider:'gemini',model:input.model,availableModels:[input.model],storage:'encrypted-server',lastTestedAt:null});
  assert.ok(Number.isFinite(Date.parse(result.lastTestedAt)));assert.ok(!JSON.stringify(result).includes(input.apiKey));
  const row=await saved(db);assert.ok(!row.document.includes(input.apiKey));assert.ok(!row.document.includes(env.AAS_SECRET_ENCRYPTION_KEY));
  const record=JSON.parse(row.document);assert.equal(record.encryptedKey.algorithm,'AES-GCM');assert.equal(Buffer.from(record.encryptedKey.iv,'base64').length,12);
  assert.ok(record.encryptedKey.ciphertext);assert.ok(!Object.hasOwn(record,'apiKey'));
  const loaded=await loadAssistantEnvironment({...env,GEMINI_API_KEY:'runtime-secret-must-be-overridden',GEMINI_MODEL:'runtime-model'},db);
  assert.equal(loaded.GEMINI_API_KEY,input.apiKey);assert.equal(loaded.GEMINI_MODEL,input.model);assert.equal(loaded.GEMINI_ALLOWED_MODELS,JSON.stringify([input.model]));
  assert.deepEqual(await getProviderCapabilities(env,db),result);
  await configureProvider(input,env,db,async()=>metadata());
  const repeated=JSON.parse((await saved(db)).document);assert.notEqual(record.encryptedKey.iv,repeated.encryptedKey.iv);assert.notEqual(record.encryptedKey.ciphertext,repeated.encryptedKey.ciphertext);
});

test('missing encryption setup, invalid names and malformed keys fail before any outgoing verification',async context=>{
  const db=await database(context);let calls=0;const fetchImpl=async()=>{calls++;return metadata();};
  await assert.rejects(configureProvider(input,{},db,fetchImpl),error=>error.status===503&&error.code==='provider_encryption_unavailable');
  for(const value of [{...input,apiKey:'short'},{...input,apiKey:'valid-key-with\ninjected-header'},{...input,model:'https://other.example/secret'},{...input,model:'../fixture'},{...input,model:'models/fixture-model'},{...input,unexpected:'field'}])await assert.rejects(configureProvider(value,env,db,fetchImpl),error=>error.status===422);
  assert.equal(calls,0);assert.equal(await saved(db),null);
});

test('numeric project IDs fail locally with model-name guidance and preserve any saved provider',async context=>{
  const db=await database(context);let calls=0;
  const fetchImpl=async()=>{calls++;return metadata();};
  const rejectsProjectNumber=value=>assert.rejects(configureProvider({...input,model:value},env,db,fetchImpl),error=>{
    assert.equal(error.status,422);assert.equal(error.code,'provider_model_project_number');
    assert.match(error.message,/رقم مشروع/);assert.match(error.message,/اسم نموذج/);
    assert.ok(!error.message.includes(input.apiKey));assert.ok(!error.message.includes(value.trim()));
    return true;
  });
  for(const model of ['350618456564',' 0012345 ','0'])await rejectsProjectNumber(model);
  assert.equal(calls,0);assert.equal(await saved(db),null);
  await configureProvider(input,env,db,async()=>metadata());const before=await saved(db);
  await rejectsProjectNumber('350618456564');
  assert.equal(calls,0);assert.deepEqual(await saved(db),before);
  assert.equal((await loadAssistantEnvironment(env,db)).GEMINI_API_KEY,input.apiKey);
});

test('model, key and access failures have distinct redacted guidance and never replace saved credentials',async context=>{
  const db=await database(context);await configureProvider(input,env,db,async()=>metadata());const before=await saved(db);
  const cases=[
    {status:404,code:'provider_model_not_found',guidance:/اسم النموذج/},
    {status:400,code:'provider_key_rejected',guidance:/صلاحية مفتاح Gemini/},
    {status:401,code:'provider_key_rejected',guidance:/صلاحية مفتاح Gemini/},
    {status:403,code:'provider_access_denied',guidance:/صلاحيات المشروع/},
  ];
  for(const {status,code,guidance} of cases){
    let canceled=false;
    const response=new Response(new ReadableStream({cancel(){canceled=true;}}),{status});
    const upstreamSecret='private upstream detail '+input.apiKey;
    // A provider error body is deliberately never read, including malformed or
    // potentially sensitive upstream output. Only its HTTP status is trusted.
    response.text=async()=>{throw new Error(upstreamSecret);};
    response.json=async()=>{throw new Error(upstreamSecret);};
    await assert.rejects(configureProvider({...input,apiKey:'fixture-replacement-key-not-to-be-saved'},env,db,async()=>response),error=>{
      assert.equal(error.status,422);assert.equal(error.code,code);assert.match(error.message,guidance);
      assert.ok(!error.message.includes('private'));assert.ok(!error.message.includes(input.apiKey));
      assert.ok(!error.message.includes('fixture-replacement-key-not-to-be-saved'));
      return true;
    });
    assert.equal(canceled,true);assert.deepEqual(await saved(db),before);
    assert.equal((await loadAssistantEnvironment(env,db)).GEMINI_API_KEY,input.apiKey);
  }
});

test('rejected, mismatched, unsupported or malformed models cannot overwrite the encrypted configuration',async context=>{
  const db=await database(context);await configureProvider(input,env,db,async()=>metadata());const before=await saved(db);
  const responses=[
    new Response('private provider body '+input.apiKey,{status:403}),
    new Response(null,{status:302,headers:{Location:'https://other.example/private'}}),
    metadata({name:'models/unexpected-model'}),
    metadata({supportedGenerationMethods:['embedContent']}),
    new Response('private malformed JSON '+input.apiKey,{headers:{'Content-Type':'application/json'}}),
    new Response('private HTML response',{headers:{'Content-Type':'text/html'}}),
  ];
  for(const response of responses){
    await assert.rejects(configureProvider(input,env,db,async()=>response),error=>error.status>=400&&!error.message.includes('private')&&!error.message.includes(input.apiKey));
    assert.deepEqual(await saved(db),before);
  }
  assert.equal((await loadAssistantEnvironment(env,db)).GEMINI_API_KEY,input.apiKey);
});

test('runtime settings are used only when no encrypted record exists and invalid runtime policies are not advertised as configured',async context=>{
  const db=await database(context),runtime={...env,GEMINI_API_KEY:'runtime-configured-key',GEMINI_MODEL:'runtime-model',GEMINI_ALLOWED_MODELS:'["other-model"]'};
  assert.equal(await loadAssistantEnvironment(runtime,db),runtime);
  assert.deepEqual(await getProviderCapabilities(runtime,db),{configured:true,provider:'gemini',model:'runtime-model',availableModels:['runtime-model','other-model'],storage:'runtime',lastTestedAt:null});
  assert.ok(!(await saved(db)).document.includes(runtime.GEMINI_API_KEY));
  assert.equal((await getProviderCapabilities({...runtime,GEMINI_ALLOWED_MODELS:'broken-json'},db)).configured,false);
  assert.equal((await getProviderCapabilities({...runtime,GEMINI_MODEL:'unsafe/model'},db)).configured,false);
  assert.equal((await getProviderCapabilities({},db)).configured,false);
});

test('wrong encryption keys, changed model metadata and tampered ciphertext fail closed without runtime fallback',async context=>{
  const db=await database(context);await configureProvider(input,env,db,async()=>metadata());const before=await saved(db);
  const runtime={...env,GEMINI_API_KEY:'do-not-fallback-runtime-key',GEMINI_MODEL:'runtime-model'};
  for(const load of [loadAssistantEnvironment,getProviderCapabilities])await assert.rejects(load({...runtime,AAS_SECRET_ENCRYPTION_KEY:'cd'.repeat(32)},db),error=>error.status===503&&error.code==='provider_secret_unreadable');
  const record=JSON.parse(before.document);record.model='tampered-model';
  await db.prepare('UPDATE aas_control_records SET document=? WHERE id=?').bind(JSON.stringify(record),'provider-gemini').run();
  await assert.rejects(loadAssistantEnvironment(runtime,db),error=>error.code==='provider_secret_unreadable');
  record.model=input.model;const bytes=Buffer.from(record.encryptedKey.ciphertext,'base64');bytes[0]^=1;record.encryptedKey.ciphertext=bytes.toString('base64');
  await db.prepare('UPDATE aas_control_records SET document=? WHERE id=?').bind(JSON.stringify(record),'provider-gemini').run();
  await assert.rejects(loadAssistantEnvironment(runtime,db),error=>error.code==='provider_secret_unreadable');
});

test('model response streaming and declared size limits do not save partial settings',async context=>{
  const db=await database(context);
  for(const response of [new Response('x'.repeat(128*1024+1),{headers:{'Content-Type':'application/json'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(128*1024+1)}})])await assert.rejects(configureProvider(input,env,db,async()=>response),error=>error.code==='provider_test_invalid_response');
  assert.equal(await saved(db),null);
});

test('ten second deadline aborts a stalled metadata request and never creates a credential record',async context=>{
  const db=await database(context);context.mock.timers.enable({apis:['setTimeout']});let signal,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const pending=configureProvider(input,env,db,async(_url,options)=>{signal=options.signal;started();return new Promise(()=>{});});
  await ready;context.mock.timers.tick(9999);assert.equal(signal.aborted,false);context.mock.timers.tick(1);
  await assert.rejects(pending,error=>error.status===504&&error.code==='provider_test_timeout');assert.equal(signal.aborted,true);assert.equal(await saved(db),null);
});

const catalog=items=>new Response(JSON.stringify(items),{headers:{'Content-Type':'application/json'}});
const modelItem=(id,methods=['generateContent'],displayName=id)=>({name:'models/'+id,displayName,supportedGenerationMethods:methods});
test('dotted credentials remain byte-exact through discovery, encryption, selection and saved-key reuse',async context=>{
  const db=await database(context),key='AQ.fixture_only_not_a_real_credential-1234567890';
  const fetchImpl=async(url,options)=>{
    assert.equal(options.headers['x-goog-api-key'],key);assert.ok(!url.includes(key));
    return new URL(url).pathname==='/v1beta/models'?catalog({models:[modelItem(input.model)]}):metadata();
  };
  for(const value of [key,'"'+key+'"','export GEMINI_API_KEY="'+key+'"']){
    const found=await discoverProviderModels({apiKey:value},env,db,fetchImpl);
    await configureProvider({discoveryId:found.discoveryId,model:input.model},env,db,fetchImpl);
    assert.equal((await loadAssistantEnvironment(env,db)).GEMINI_API_KEY,key);
    assert.equal((await getProviderCapabilities(env,db)).configured,true);
    const again=await discoverProviderModels({useSavedKey:true},env,db,fetchImpl);assert.equal(again.models[0].id,input.model);
    const rows=(await db.prepare('SELECT document FROM aas_control_records').all()).results;
    assert.ok(rows.every(row=>!row.document.includes(key)));
  }
});
test('actual paginated catalog produces an encrypted expiring selection; active settings change only after verified save',async context=>{
  const db=await database(context),calls=[];
  const fetchImpl=async(url,options)=>{
    const target=new URL(url);calls.push(target);
    assert.equal(target.origin,'https://generativelanguage.googleapis.com');assert.equal(options.redirect,'manual');
    assert.equal(options.headers['x-goog-api-key'],input.apiKey);assert.ok(!url.includes(input.apiKey));
    if(target.pathname==='/v1beta/models')return target.searchParams.has('pageToken')?
      catalog({models:[modelItem('fixture-second',['generateContent'],input.apiKey)],nextPageToken:''}):
      catalog({models:[modelItem(input.model),modelItem('fixture-embedding',['embedContent'])],nextPageToken:'next-fixture-page'});
    assert.equal(target.pathname,'/v1beta/models/'+input.model);return metadata();
  };
  const choice=await discoverProviderModels({apiKey:'export GEMINI_API_KEY="'+input.apiKey+'"'},env,db,fetchImpl);
  assert.equal(choice.activeConfigurationChanged,false);assert.equal(calls.length,2);
  assert.equal(calls[1].searchParams.get('pageToken'),'next-fixture-page');
  assert.deepEqual(choice.models.map(item=>item.id),[input.model,'fixture-second']);
  assert.ok(!JSON.stringify(choice).includes(input.apiKey));assert.ok(Date.parse(choice.expiresAt)>Date.now());
  const draft=await db.prepare('SELECT document FROM aas_control_records WHERE id=?').bind('provider-gemini-discovery').first();
  assert.ok(!draft.document.includes(input.apiKey));assert.equal(await saved(db),null);
  await assert.rejects(configureProvider({discoveryId:choice.discoveryId,model:'not-observed'},env,db,fetchImpl),error=>error.code==='provider_model_not_discovered');
  assert.equal(calls.length,2);assert.equal(await saved(db),null);
  const confirmed=await configureProvider({discoveryId:choice.discoveryId,model:input.model},env,db,fetchImpl);
  assert.equal(confirmed.configured,true);assert.equal(calls.length,3);
  assert.equal((await loadAssistantEnvironment(env,db)).GEMINI_API_KEY,input.apiKey);
  const before=await saved(db);
  const fromSaved=await discoverProviderModels({useSavedKey:true},env,db,fetchImpl);
  assert.ok(fromSaved.models.length);assert.deepEqual(await saved(db),before);
});

test('failed discovery never overwrites saved credentials or a previously usable encrypted selection',async context=>{
  const db=await database(context);await configureProvider(input,env,db,async()=>metadata());const active=await saved(db);
  await discoverProviderModels({apiKey:input.apiKey},env,db,async()=>catalog({models:[modelItem(input.model)]}));
  const before=await db.prepare('SELECT * FROM aas_control_records WHERE id=?').bind('provider-gemini-discovery').first();
  const responses=[new Response('private '+input.apiKey,{status:401}),new Response(null,{status:302}),
    catalog({models:[modelItem('embedding-only',['embedContent'])]}),catalog({models:[modelItem('../unsafe')]}),
    catalog({models:[]}),catalog({models:'wrong'}),catalog({models:[modelItem(input.model)],nextPageToken:input.apiKey}),
    new Response('x'.repeat(128*1024+1),{headers:{'Content-Type':'application/json'}})];
  for(const response of responses){
    await assert.rejects(discoverProviderModels({apiKey:input.apiKey},env,db,async()=>response),error=>error.status>=400&&!error.message.includes(input.apiKey));
    assert.deepEqual(await saved(db),active);
    assert.deepEqual(await db.prepare('SELECT * FROM aas_control_records WHERE id=?').bind('provider-gemini-discovery').first(),before);
  }
});

test('selection expiry and replacement reject old tickets; catalog pagination has a shared deadline and bounded pages',async context=>{
  const db=await database(context),list=async()=>catalog({models:[modelItem(input.model)]});
  const first=await discoverProviderModels({apiKey:input.apiKey},env,db,list);
  const second=await discoverProviderModels({apiKey:input.apiKey},env,db,list);
  await assert.rejects(configureProvider({discoveryId:first.discoveryId,model:input.model},env,db),error=>error.code==='provider_discovery_expired');
  let row=await db.prepare('SELECT document FROM aas_control_records WHERE id=?').bind('provider-gemini-discovery').first();
  const data=JSON.parse(row.document);data.expiresAt=new Date(Date.now()-1000).toISOString();
  await db.prepare('UPDATE aas_control_records SET document=? WHERE id=?').bind(JSON.stringify(data),'provider-gemini-discovery').run();
  await assert.rejects(configureProvider({discoveryId:second.discoveryId,model:input.model},env,db),error=>error.code==='provider_discovery_expired');
  assert.equal(await saved(db),null);
  let calls=0;
  const bounded=await discoverProviderModels({apiKey:input.apiKey},env,db,async()=>catalog({models:[modelItem('fixture-'+(++calls))],nextPageToken:'next-'+calls}));
  assert.equal(calls,5);assert.equal(bounded.truncated,true);assert.equal(bounded.models.length,5);
  calls=0;await assert.rejects(discoverProviderModels({apiKey:input.apiKey},env,db,async()=>{calls++;return catalog({models:[modelItem(input.model)],nextPageToken:'repeat'});}),error=>error.code==='provider_test_invalid_response');assert.equal(calls,2);
  context.mock.timers.enable({apis:['setTimeout']});let started,signal;const ready=new Promise(resolve=>{started=resolve;});
  const pending=discoverProviderModels({apiKey:input.apiKey},env,db,async(_url,options)=>{signal=options.signal;started();return new Promise(()=>{});});
  await ready;context.mock.timers.tick(10000);await assert.rejects(pending,error=>error.code==='provider_test_timeout');assert.equal(signal.aborted,true);
});
