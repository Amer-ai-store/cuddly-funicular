/** Owner-managed Gemini credentials. No plaintext provider key is persisted or returned. */
import {ControlRepository} from './control.mjs';
const RECORD_ID='provider-gemini';
const DISCOVERY_ID='provider-gemini-discovery',DISCOVERY_TTL=10*60*1000;
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const KEY=/^[-A-Za-z0-9_.]{20,256}$/;
const MAX_RESPONSE=128*1024,TIMEOUT=10000;
const encoder=new TextEncoder();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export class ProviderSettingsError extends Error{
  constructor(status,code,message){super(message);Object.assign(this,{status,code});}
}
const fail=(status,code,message)=>{throw new ProviderSettingsError(status,code,message);};
const unreadable=()=>new ProviderSettingsError(503,'provider_secret_unreadable','تعذرت قراءة إعداد Gemini المشفر. راجع مفتاح تشفير الخادم أو أعد حفظ إعداد المزود.');
const storageError=()=>new ProviderSettingsError(503,'provider_storage_unavailable','تعذر الوصول إلى إعداد المزود المحفوظ على الخادم.');
const timeoutError=()=>new ProviderSettingsError(504,'provider_test_timeout','انتهت مهلة التحقق من مفتاح Gemini والنموذج. لم يُحفظ تغيير.');
const invalidResponse=()=>new ProviderSettingsError(502,'provider_test_invalid_response','لم يُرجع Gemini بيانات نموذج صالحة. لم يُحفظ تغيير.');
function keyValue(value){
  let key=typeof value==='string'?value.trim():'';
  // Accept common clipboard wrappers without accepting commands or arbitrary JSON.
  const assignment=key.match(/^(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*(["']?)([-A-Za-z0-9_.]{20,256})\1\s*;?$/);
  if(assignment)key=assignment[2];
  else if(/^(["'])([-A-Za-z0-9_.]{20,256})\1$/.test(key))key=key.slice(1,-1);
  if(!KEY.test(key))fail(422,'provider_key_invalid','الصق قيمة مفتاح API الفعلية من زر نسخ المفتاح في Google AI Studio، وليس اسم المفتاح أو رقم المشروع.');
  return key;
}
function modelValue(value){
  if(typeof value!=='string'||!MODEL.test(value.trim()))fail(422,'provider_model_invalid','أدخل اسم نموذج Gemini فقط، دون رابط أو بادئة models/.');
  const model=value.trim();
  if(/^\d+$/.test(model))fail(422,'provider_model_project_number','هذا رقم مشروع وليس اسم نموذج. أدخل اسم نموذج Gemini المتاح لحسابك كما يظهر في Google AI Studio؛ لم يُحفظ تغيير.');
  return model;
}
async function encryptionKey(env){
  if(typeof env?.AAS_SECRET_ENCRYPTION_KEY!=='string'||!/^[a-f0-9]{64}$/i.test(env.AAS_SECRET_ENCRYPTION_KEY))fail(503,'provider_encryption_unavailable','مفتاح تشفير إعدادات المزود غير مهيّأ على الخادم.');
  const bytes=Uint8Array.from(env.AAS_SECRET_ENCRYPTION_KEY.match(/../g),part=>parseInt(part,16));
  try{return await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);}
  catch{throw unreadable();}
}
const aad=model=>encoder.encode('AAS-CC|'+RECORD_ID+'|v1|'+model);
const base64=bytes=>btoa(String.fromCharCode(...bytes));
function unbase64(value,max){
  if(typeof value!=='string'||!value||value.length>max||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw unreadable();
  try{const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(base64(bytes)!==value)throw unreadable();return bytes;}catch{throw unreadable();}
}
function storedConfig(data){
  if(!object(data))throw unreadable();
  if(Object.keys(data).length===0)return null;
  if(data.version!==1||data.provider!=='gemini'||typeof data.model!=='string'||!MODEL.test(data.model)||!object(data.encryptedKey)||data.encryptedKey.algorithm!=='AES-GCM'||typeof data.lastTestedAt!=='string'||!Number.isFinite(Date.parse(data.lastTestedAt)))throw unreadable();
  return data;
}
async function readConfig(env,db){
  const selected=db??env?.DB;if(!selected)throw storageError();
  try{const repo=new ControlRepository(selected);return {repo,config:storedConfig((await repo.load(RECORD_ID,{})).data)};}
  catch(error){if(error instanceof ProviderSettingsError)throw error;throw storageError();}
}
async function decryptConfig(config,env){
  const key=await encryptionKey(env),iv=unbase64(config.encryptedKey.iv,32),ciphertext=unbase64(config.encryptedKey.ciphertext,1024);
  if(iv.length!==12||ciphertext.length<36||ciphertext.length>272)throw unreadable();
  try{
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(config.model),tagLength:128},key,ciphertext);
    const value=new TextDecoder('utf-8',{fatal:true}).decode(plain);
    if(!KEY.test(value))throw unreadable();
    return value;
  }catch{throw unreadable();}
}
function runtimeCapabilities(env){
  const key=typeof env?.GEMINI_API_KEY==='string'&&env.GEMINI_API_KEY.trim()&&!/[\r\n]/.test(env.GEMINI_API_KEY);
  const configured=env?.GEMINI_MODEL;
  let valid=true,model=null,entries=[];
  if(configured!=null&&configured!==''){
    if(typeof configured!=='string'||!MODEL.test(configured.trim()))valid=false;
    else model=configured.trim();
  }
  try{entries=typeof env?.GEMINI_ALLOWED_MODELS==='string'&&env.GEMINI_ALLOWED_MODELS!==''?JSON.parse(env.GEMINI_ALLOWED_MODELS):env?.GEMINI_ALLOWED_MODELS||[];}
  catch{valid=false;}
  if(!Array.isArray(entries)||entries.length>50||entries.some(item=>typeof item!=='string'||!MODEL.test(item))){valid=false;entries=[];}
  const availableModels=valid?[...new Set([...(model?[model]:[]),...entries])]:[];
  return {configured:Boolean(valid&&key&&availableModels.length),provider:'gemini',model:valid?model:null,availableModels,storage:'runtime',lastTestedAt:null};
}
function capabilities(config){return {configured:true,provider:'gemini',model:config.model,availableModels:[config.model],storage:'encrypted-server',lastTestedAt:new Date(config.lastTestedAt).toISOString()};}

export async function getProviderCapabilities(env,db){
  const {config}=await readConfig(env,db);
  if(!config)return runtimeCapabilities(env);
  await decryptConfig(config,env);
  return capabilities(config);
}

/** Server-only: never send this returned environment object to a browser. */
export async function loadAssistantEnvironment(env,db){
  const {config}=await readConfig(env,db);
  if(!config)return env;
  const apiKey=await decryptConfig(config,env);
  return {...env,GEMINI_API_KEY:apiKey,GEMINI_MODEL:config.model,GEMINI_ALLOWED_MODELS:JSON.stringify([config.model])};
}
async function responseJson(response,signal){
  if(response.status!==200){
    response.body?.cancel().catch(()=>{});
    if(response.status===404)fail(422,'provider_model_not_found','لم يعثر Gemini على النموذج المحدد عبر واجهة v1beta. تحقق من اسم النموذج وتوفّره لحسابك؛ لم يُحفظ تغيير.');
    if([400,401].includes(response.status))fail(422,'provider_key_rejected','رفض Gemini التحقق بالمفتاح المُدخل. تحقق من صلاحية مفتاح Gemini وأنه منسوخ كاملًا من Google AI Studio؛ لم يُحفظ تغيير.');
    if(response.status===403)fail(422,'provider_access_denied','رفض Gemini صلاحية الوصول إلى النموذج. راجع تفعيل الخدمة وصلاحيات المشروع وقيود مفتاح API؛ لم يُحفظ تغيير.');
    fail(503,'provider_test_unavailable','تعذر التحقق من نموذج Gemini الآن. لم يُحفظ تغيير.');
  }
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')||'')){response.body?.cancel().catch(()=>{});throw invalidResponse();}
  if(Number(response.headers.get('Content-Length'))>MAX_RESPONSE){response.body?.cancel().catch(()=>{});throw invalidResponse();}
  const reader=response.body?.getReader();if(!reader)throw invalidResponse();
  const cancel=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  const chunks=[];let size=0;
  try{for(;;){if(signal.aborted)throw timeoutError();const {value,done}=await reader.read();if(signal.aborted)throw timeoutError();if(done)break;size+=value.length;if(size>MAX_RESPONSE){cancel();throw invalidResponse();}chunks.push(value);}}
  finally{signal.removeEventListener('abort',cancel);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw invalidResponse();}
}
async function verifyModel(apiKey,model,fetchImpl){
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(timeoutError());},TIMEOUT);});
  try{
    const verification=(async()=>{
      const response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model),{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json','x-goog-api-key':apiKey}});
      const data=await responseJson(response,controller.signal);
      if(!object(data)||data.name!=='models/'+model||!Array.isArray(data.supportedGenerationMethods)||data.supportedGenerationMethods.length>100||data.supportedGenerationMethods.some(item=>typeof item!=='string'||item.length>100))throw invalidResponse();
      if(!data.supportedGenerationMethods.includes('generateContent'))fail(422,'provider_model_unsupported','النموذج المحدد لا يعلن دعم generateContent. اختر نموذج توليد مدعومًا؛ لم يُحفظ تغيير.');
    })();
    await Promise.race([verification,deadline]);
  }catch(error){if(error instanceof ProviderSettingsError)throw error;if(controller.signal.aborted||error?.name==='AbortError')throw timeoutError();fail(503,'provider_test_unavailable','تعذر الاتصال بخدمة نماذج Gemini. لم يُحفظ تغيير.');}
  finally{clearTimeout(timer);}
}

export async function configureProvider(input,env,db,fetchImpl=fetch){
  if(object(input)&&Object.hasOwn(input,'discoveryId')){
    if(Object.keys(input).some(key=>!['discoveryId','model'].includes(key))||typeof input.discoveryId!=='string'||!/^[-a-f0-9]{36}$/i.test(input.discoveryId))fail(422,'provider_discovery_invalid','أعد جلب النماذج قبل الحفظ.');
    const model=modelValue(input.model),selected=db??env?.DB;if(!selected)throw storageError();
    let draft;try{draft=(await new ControlRepository(selected).load(DISCOVERY_ID,{})).data;}catch{throw storageError();}
    if(draft.discoveryId!==input.discoveryId||!Number.isFinite(Date.parse(draft.expiresAt))||Date.parse(draft.expiresAt)<=Date.now())fail(409,'provider_discovery_expired','انتهت جلسة فحص المفتاح أو استُبدلت. أعد جلب النماذج بالمفتاح.');
    if(!Array.isArray(draft.models)||!draft.models.some(item=>item.id===model))fail(422,'provider_model_not_discovered','اختر نموذجًا من القائمة التي وصلت من Google لهذا المفتاح.');
    const credential=storedConfig(draft.credential);if(!credential)throw unreadable();
    const apiKey=await decryptConfig(credential,env);
    return configureProvider({apiKey,model},env,selected,fetchImpl);
  }
  if(!object(input)||Object.keys(input).some(key=>!['apiKey','model'].includes(key)))fail(422,'provider_input_invalid','أرسل مفتاح Gemini واسم النموذج فقط.');
  const apiKey=keyValue(input.apiKey),model=modelValue(input.model),key=await encryptionKey(env);
  const selected=db??env?.DB;if(!selected)throw storageError();
  await verifyModel(apiKey,model,fetchImpl);
  const iv=crypto.getRandomValues(new Uint8Array(12));let ciphertext;
  try{ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(model),tagLength:128},key,encoder.encode(apiKey)));}catch{throw unreadable();}
  const config={version:1,provider:'gemini',model,lastTestedAt:new Date().toISOString(),encryptedKey:{algorithm:'AES-GCM',iv:base64(iv),ciphertext:base64(ciphertext)}};
  try{await new ControlRepository(selected).update(RECORD_ID,{},()=>config);}catch{throw storageError();}
  return capabilities(config);
}

/** Read the provider's actual catalog; the browser receives a short-lived reference, never the key. */
export async function discoverProviderModels(input,env,db,fetchImpl=fetch){
  if(!object(input)||Object.keys(input).some(key=>!['apiKey','useSavedKey'].includes(key))||
    (input.useSavedKey!==undefined&&input.useSavedKey!==true)||
    (input.useSavedKey===true&&Object.hasOwn(input,'apiKey')))
    fail(422,'provider_input_invalid','أرسل المفتاح أو اختر استخدام المفتاح المحفوظ.');
  const apiKey=input.useSavedKey===true?keyValue((await loadAssistantEnvironment(env,db)).GEMINI_API_KEY):keyValue(input.apiKey);
  const selected=db??env?.DB;if(!selected)throw storageError();
  const key=await encryptionKey(env),controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(timeoutError());},TIMEOUT);});
  let catalog;
  try{
    catalog=await Promise.race([(async()=>{
      const models=new Map(),seen=new Set();let pageToken='',truncated=false;
      for(let page=0;page<5;page++){
        const url=new URL('https://generativelanguage.googleapis.com/v1beta/models');url.searchParams.set('pageSize','50');
        if(pageToken)url.searchParams.set('pageToken',pageToken);
        const response=await fetchImpl(url.href,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json','x-goog-api-key':apiKey}});
        const data=await responseJson(response,controller.signal);
        if(!object(data)||!Array.isArray(data.models)||data.models.length>100)throw invalidResponse();
        for(const item of data.models){
          if(!object(item)||typeof item.name!=='string'||!item.name.startsWith('models/'))throw invalidResponse();
          const id=item.name.slice(7);
          if(!MODEL.test(id)||/^\d+$/.test(id)||id.includes(apiKey))throw invalidResponse();
          if(!Array.isArray(item.supportedGenerationMethods)||!item.supportedGenerationMethods.every(method=>typeof method==='string'))throw invalidResponse();
          if(!item.supportedGenerationMethods.includes('generateContent'))continue;
          const label=(typeof item.displayName==='string'?item.displayName:id).replaceAll(apiKey,'[محجوب]').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120)||id;
          models.set(id,{id,label});
        }
        const next=data.nextPageToken;
        if(next===undefined||next===''){pageToken='';break;}
        if(typeof next!=='string'||next.length>2048||/[\u0000-\u0020\u007f]/.test(next)||next.includes(apiKey)||seen.has(next))throw invalidResponse();
        seen.add(next);pageToken=next;truncated=page===4;
      }
      if(!models.size)fail(422,'provider_no_generation_models','لم يعرض Google نماذج محادثة لهذا المفتاح. راجع تفعيل Gemini API وصلاحيات المشروع.');
      if(models.size>250)throw invalidResponse();
      return {models:[...models.values()].sort((a,b)=>a.id.localeCompare(b.id)),truncated};
    })(),deadline]);
  }catch(error){if(error instanceof ProviderSettingsError)throw error;if(controller.signal.aborted||error?.name==='AbortError')throw timeoutError();fail(503,'provider_test_unavailable','تعذر جلب نماذج Google الآن. لم يتغير إعداد المزوّد.');}
  finally{clearTimeout(timer);}
  const discoveryId=crypto.randomUUID(),model='discovery-'+discoveryId,iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(model),tagLength:128},key,encoder.encode(apiKey)));
  const lastTestedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+DISCOVERY_TTL).toISOString();
  const credential={version:1,provider:'gemini',model,lastTestedAt,encryptedKey:{algorithm:'AES-GCM',iv:base64(iv),ciphertext:base64(ciphertext)}};
  try{await new ControlRepository(selected).update(DISCOVERY_ID,{},()=>({discoveryId,expiresAt,credential,models:catalog.models}));}catch{throw storageError();}
  return {provider:'gemini',discoveryId,expiresAt,models:catalog.models,truncated:catalog.truncated,activeConfigurationChanged:false};
}
