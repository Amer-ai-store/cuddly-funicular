import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {testProviderGeneration,readProviderHealth} from '../server/provider-health.mjs';
import {configureProvider} from '../server/provider-settings.mjs';
const env={GEMINI_API_KEY:'fixture-health-secret-not-real-123456',GEMINI_MODEL:'fixture-health-model',AAS_SECRET_ENCRYPTION_KEY:'cb'.repeat(32)};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const generated=text=>json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
async function database(t){
  const mf=new Miniflare({script:'export default {fetch(){return new Response("test fixture")}}',modules:true,compatibilityDate:'2025-05-01',d1Databases:['DB']});t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const sql of(await readFile(new URL('../drizzle/0002_abandoned_black_crow.sql',import.meta.url),'utf8')).split('--> statement-breakpoint').map(v=>v.trim()).filter(Boolean))await db.prepare(sql).run();
  return db;
}
async function expireCooldown(db){
  const row=await db.prepare('SELECT document FROM aas_control_records WHERE id=?').bind('provider-gemini-health').first();
  const data=JSON.parse(row.document);data.lastAttemptAt=new Date(Date.now()-31000).toISOString();
  await db.prepare('UPDATE aas_control_records SET document=? WHERE id=?').bind(JSON.stringify(data),'provider-gemini-health').run();
}
test('probe sends one fixed JSON request without context, persists only safe evidence and reads do not call provider',async t=>{
  const db=await database(t);let calls=0;
  assert.equal((await readProviderHealth(env,db)).status,'untested');
  const result=await testProviderGeneration({},env,db,async(url,options)=>{
    calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/fixture-health-model:generateContent');
    const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');
    assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY);assert.ok(!options.body.includes(env.GEMINI_API_KEY));
    assert.ok(!options.body.includes('السياق'));assert.ok(options.body.length<400);
    return generated('{"status":"ok","ignored":"private generated text"}');
  });
  assert.equal(result.status,200);assert.equal(result.body.providerHealth.status,'passed');assert.equal(calls,1);
  assert.equal((await readProviderHealth(env,db)).status,'passed');
  const records=JSON.stringify((await db.prepare('SELECT id,document FROM aas_control_records').all()).results);
  assert.ok(!records.includes(env.GEMINI_API_KEY));assert.ok(!records.includes('private generated text'));assert.ok(!records.includes('assistant-history'));
  assert.equal(calls,1);
});
test('missing configuration and arbitrary probe payload cannot issue generation',async t=>{
  const db=await database(t);let calls=0;const outgoing=async()=>{calls++;return generated('{"status":"ok"}');};
  assert.equal((await readProviderHealth({},db)).status,'not_configured');
  await assert.rejects(testProviderGeneration({}, {},db,outgoing),e=>e.status===503&&e.code==='provider_not_configured');
  for(const input of [{prompt:'arbitrary message'},{apiKey:env.GEMINI_API_KEY},[],null])await assert.rejects(testProviderGeneration(input,env,db,outgoing),e=>e.status===422);
  assert.equal(calls,0);
});
test('simultaneous probes and immediate retries issue exactly one provider call',async t=>{
  const db=await database(t);let calls=0,release;
  const outgoing=async()=>{calls++;return new Promise(resolve=>{release=()=>resolve(generated('{"status":"ok"}'));});};
  const first=testProviderGeneration({},env,db,outgoing);
  while(!release)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await readProviderHealth(env,db)).status,'testing');
  await assert.rejects(testProviderGeneration({},env,db,outgoing),e=>e.status===429||e.status===409);
  release();await first;
  await assert.rejects(testProviderGeneration({},env,db,outgoing),e=>e.code==='provider_probe_cooldown');assert.equal(calls,1);
});
test('quota, access, malformed and partial responses never create a passing probe or expose upstream output',async t=>{
  const db=await database(t);
  const cases=[
    [async()=>new Response('private body '+env.GEMINI_API_KEY,{status:429}),429,'provider_quota_exceeded'],
    [async()=>new Response('private body',{status:403}),502,'provider_access_denied'],
    [async()=>generated('private malformed body'),502,'provider_probe_invalid_response'],
    [async()=>json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"status":"ok"}'}]}}]}),502,'model_no_result'],
  ];
  for(const [outgoing,status,code] of cases){
    const result=await testProviderGeneration({},env,db,outgoing);assert.equal(result.status,status);assert.equal(result.body.providerHealth.status,'failed');assert.equal(result.body.error.code,code);
    assert.equal((await readProviderHealth(env,db)).status,'failed');assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
    await expireCooldown(db);
  }
});
test('changing credentials or model invalidates old success and a day-old success is visibly stale',async t=>{
  const db=await database(t);
  await testProviderGeneration({},env,db,async()=>generated('{"status":"ok"}'));
  assert.equal((await readProviderHealth({...env,GEMINI_API_KEY:'other-fixture-secret-1234567890'},db)).status,'untested');
  assert.equal((await readProviderHealth({...env,GEMINI_MODEL:'other-model'},db)).status,'untested');
  const row=await db.prepare('SELECT document FROM aas_control_records WHERE id=?').bind('provider-gemini-health').first();
  const data=JSON.parse(row.document);data.result.checkedAt=new Date(Date.now()-25*3600000).toISOString();
  await db.prepare('UPDATE aas_control_records SET document=? WHERE id=?').bind(JSON.stringify(data),'provider-gemini-health').run();
  assert.equal((await readProviderHealth(env,db)).status,'stale');
});
test('encrypted saved credentials are used and changing configuration during a probe cannot verify the replacement',async t=>{
  const db=await database(t),savedKey='saved-health-fixture-key-1234567890';
  const metadata=model=>json({name:'models/'+model,supportedGenerationMethods:['generateContent']});
  await configureProvider({apiKey:savedKey,model:'saved-health-model'},env,db,async()=>metadata('saved-health-model'));
  const pending=testProviderGeneration({},env,db,async(url,options)=>{
    assert.equal(options.headers['x-goog-api-key'],savedKey);assert.ok(url.includes('/saved-health-model:'));
    await configureProvider({apiKey:savedKey,model:'replacement-model'},env,db,async()=>metadata('replacement-model'));
    return generated('{"status":"ok"}');
  });
  await assert.rejects(pending,e=>e.status===409&&e.code==='provider_configuration_changed');
  const current=await readProviderHealth(env,db);assert.equal(current.model,'replacement-model');assert.equal(current.status,'untested');
});
