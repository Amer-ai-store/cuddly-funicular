/** Explicit owner-triggered generation probe. No user context or provider output is stored. */
import {generateAi,AiProxyError} from './ai.mjs';
import {ControlRepository} from './control.mjs';
import {getProviderCapabilities,loadAssistantEnvironment,ProviderSettingsError} from './provider-settings.mjs';
const RECORD='provider-gemini-health',COOLDOWN=30000,FRESHNESS=24*60*60*1000;
const fail=(status,code,message)=>{throw new ProviderSettingsError(status,code,message);};
async function configuration(env,db){
  const capability=await getProviderCapabilities(env,db),runtime=await loadAssistantEnvironment(env,db);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([runtime.GEMINI_API_KEY??'',runtime.GEMINI_MODEL??'',runtime.GEMINI_ALLOWED_MODELS??''])));
  const fingerprint=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  return {capability,runtime,fingerprint};
}
function publicHealth(config,data,now=Date.now()){
  const base={configured:config.capability.configured,model:config.capability.model,status:'untested',checkedAt:null,latencyMs:null,error:null};
  if(!base.configured)return {...base,status:'not_configured'};
  if(data.fingerprint!==config.fingerprint)return base;
  if(data.phase==='testing')return {...base,status:now-Date.parse(data.lastAttemptAt)<25000?'testing':'untested'};
  if(!data.result)return base;
  const result=data.result;
  return {...base,...result,status:result.status==='passed'&&now-Date.parse(result.checkedAt)>FRESHNESS?'stale':result.status};
}
export async function readProviderHealth(env,db){
  const config=await configuration(env,db),record=await new ControlRepository(db).load(RECORD,{});
  return publicHealth(config,record.data);
}
export async function testProviderGeneration(input,env,db,fetchImpl=fetch){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)fail(422,'provider_probe_invalid_input','فحص الاتصال لا يقبل مفتاحًا أو رسالة؛ يستخدم الإعداد المحفوظ فقط.');
  const config=await configuration(env,db);
  if(!config.capability.configured)fail(503,'provider_not_configured','احفظ مفتاح Gemini ونموذجًا قبل طلب فحص التوليد.');
  const repo=new ControlRepository(db),record=await repo.load(RECORD,{}),now=Date.now();
  if(now-Date.parse(record.data.lastAttemptAt)<COOLDOWN)fail(429,'provider_probe_cooldown','انتظر 30 ثانية بين فحوص التوليد؛ لن يُرسل طلب إضافي الآن.');
  const attemptId=crypto.randomUUID(),pending={fingerprint:config.fingerprint,attemptId,lastAttemptAt:new Date(now).toISOString(),phase:'testing'};
  if(!await repo.save(record,pending))fail(409,'provider_probe_in_progress','بدأ فحص آخر بالتزامن. حدّث حالة الفحص دون إعادة إرساله.');
  let status=200,result;
  try{
    const generated=await generateAi({prompt:'Return only this JSON object: {"status":"ok"}. This is a short API connectivity test.'},config.runtime,fetchImpl,{responseJson:true});
    let parsed;try{parsed=JSON.parse(generated.content);}catch{}
    if(!parsed||parsed.status!=='ok')throw new AiProxyError(502,'provider_probe_invalid_response','استجاب المزوّد، لكن الرد لم يجتز فحص JSON. اختر نموذج محادثة يدعم الرد المنظم.');
    result={status:'passed',error:null};
  }catch(error){
    if(!(error instanceof AiProxyError))throw error;
    status=error.status;result={status:'failed',error:{code:error.code,message:error.message}};
  }
  result={...result,checkedAt:new Date().toISOString(),latencyMs:Math.max(0,Date.now()-now)};
  if(!await repo.save({...record,revision:record.revision+1},{...pending,phase:'completed',result}))fail(409,'provider_probe_conflict','تغيّر سجل الفحص؛ حدّث حالته قبل المحاولة.');
  const current=await configuration(env,db);
  if(current.fingerprint!==config.fingerprint)fail(409,'provider_configuration_changed','تغيّر إعداد Gemini أثناء الفحص؛ النتيجة لا تعتمد الإعداد الجديد.');
  const providerHealth=publicHealth(current,{...pending,phase:'completed',result});
  return {status,body:{providerHealth,...(result.error?{error:result.error}:{})}};
}
