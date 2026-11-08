import { D1Repository } from './repository.mjs';
import { mutateLiveState, normalizeLiveState } from './state.mjs';
import { checkServerHealth } from './connectors.mjs';
import { generateAi } from './ai.mjs';
import { getRepositoryStatus, REPOSITORY } from './github-cache.mjs';
import { analyzeRepositorySource } from './source-analysis.mjs';
import { deriveCoordination } from './coordination.mjs';
import { AssistantControl } from './assistant-state.mjs';
import { sanitizeAssistantText } from './assistant.mjs';
import { DatabaseControl } from './database.mjs';
import { getProviderCapabilities, loadAssistantEnvironment, configureProvider, discoverProviderModels } from './provider-settings.mjs';
import { readProviderHealth, testProviderGeneration } from './provider-health.mjs';
import assets from './assets.generated.mjs';

const PUBLIC_OPERATIONS = new Set(['addTask','updateTask','deleteTask','addWorkspace','updateWorkspace','deleteWorkspace','resolveApproval','addNote','updateSettings','updateAgent','importData','reset','addServer','updateServer','deleteServer','startWorkflow','addWorkflowStep','recordWorkflowAnalysis','recordWorkflowChange','recordWorkflowVerification','advanceWorkflow']);
const RESOURCES = new Set(['tasks','workspaces','agents','approvals','activity','settings','servers','workflows']);
const MAX_BODY = 2 * 1024 * 1024;
class HttpError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, {status,code}); }
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}
});
function envelope(record) {
  return {...record,connection:{status:'online',storage:'D1',lastSyncAt:new Date().toISOString()},server:{version:'2.0.0',automaticExecution:false}};
}
function runnerEnvelope(record,workflowId,error) {
  const workflow=(record.state.workflows||[]).find(item=>item.id===workflowId)||null;
  return {revision:record.revision,workflow,currentStep:workflow?.steps[workflow.currentStepIndex]||null,...(error?{error}:{})};
}
async function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(received)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
  const av=new Uint8Array(a),bv=new Uint8Array(b); let diff=0;
  for(let i=0;i<av.length;i++) diff |= av[i]^bv[i];
  return diff===0;
}
function hasAuthenticatedVisitor(request) {
  // The owner-private Sites gateway supplies visitor identity. Some gateway
  // sessions include email without an id; display-name headers are not identity.
  return ['oai-authenticated-user-id','oai-authenticated-user-email']
    .some(name => Boolean(request.headers.get(name)?.trim()));
}
async function authorize(request, env) {
  const runnerPath=new URL(request.url).pathname;
  if ((runnerPath === '/api/v1/runner/receipts' && request.method === 'POST') || (['/api/v1/runner/context','/api/v1/runner/health','/api/v1/bridge/context'].includes(runnerPath) && request.method === 'GET') || (['/api/v1/runner/advance','/api/v1/bridge/snapshot','/api/v1/bridge/receipts'].includes(runnerPath) && request.method === 'POST')) {
    if (!env.AAS_RUNNER_TOKEN) throw new HttpError(503,'runner_not_configured','منفّذ الكود غير موصول. لم تُنفَّذ تعديلات أو اختبارات آلية.');
    if (!await tokenMatches(request.headers.get('X-AAS-Runner-Key'),env.AAS_RUNNER_TOKEN)) throw new HttpError(401,'runner_authentication_required','يلزم مفتاح منفّذ الكود المخصص لإرسال نتائج التنفيذ.');
    return {service:false,visitor:false,runner:true};
  }
  const service = await tokenMatches(request.headers.get('X-AAS-API-Key'), env.AAS_API_TOKEN);
  const visitor = hasAuthenticatedVisitor(request);
  if (!service && !visitor) throw new HttpError(401,'authentication_required','يلزم تسجيل الدخول أو مصادقة خدمة الخادم.');
  if (!service && !['GET','HEAD'].includes(request.method)) {
    const origin=request.headers.get('Origin');
    if ((origin && origin!==new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site')==='cross-site') throw new HttpError(403,'cross_site_request','الطلب لا ينتمي إلى موقع لوحة القيادة.');
  }
  return {service,visitor};
}
async function body(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new HttpError(415,'json_required','يجب إرسال بيانات JSON.');
  if(Number(request.headers.get('Content-Length'))>MAX_BODY) throw new HttpError(413,'body_too_large','الطلب أكبر من الحد المسموح.');
  const reader=request.body?.getReader(); if(!reader) throw new HttpError(400,'invalid_json','الطلب فارغ.');
  const chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new HttpError(413,'body_too_large','الطلب أكبر من الحد المسموح.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}
  catch {throw new HttpError(400,'invalid_json','بيانات JSON غير صالحة.');}
}
function expectedRevision(request, input) {
  const header=request.headers.get('If-Match');
  const value=input.expectedRevision ?? (header ? Number(header.replaceAll('"','')) : undefined);
  if(!Number.isSafeInteger(value)||value<0) throw new HttpError(428,'revision_required','يلزم إرسال expectedRevision أو If-Match لمنع تعارض التغييرات.');
  return value;
}
function actionFor(method, parts, input) {
  const [resource,id,sub]=parts;
  if(resource==='actions'&&method==='POST') return {operation:input.operation,payload:input.payload||{}};
  if(method==='POST'&&!id&&resource==='tasks')return {operation:'addTask',payload:input};
  if(method==='POST'&&!id&&resource==='workspaces')return {operation:'addWorkspace',payload:input};
  if(method==='POST'&&!id&&resource==='servers')return {operation:'addServer',payload:input};
  if(method==='PATCH'&&!id&&resource==='settings')return {operation:'updateSettings',payload:input};
  if(method==='POST'&&resource==='workspaces'&&sub==='notes')return {operation:'addNote',payload:{workspaceId:id,body:input.body}};
  if(method==='POST'&&resource==='approvals'&&sub==='decision')return {operation:'resolveApproval',payload:{id,decision:input.decision}};
  const update={tasks:'updateTask',workspaces:'updateWorkspace',agents:'updateAgent',servers:'updateServer'};
  const remove={tasks:'deleteTask',workspaces:'deleteWorkspace',servers:'deleteServer'};
  if(method==='PATCH'&&id&&update[resource])return {operation:update[resource],payload:{id,patch:input.patch||input}};
  if(method==='DELETE'&&id&&remove[resource])return {operation:remove[resource],payload:{id}};
  throw new HttpError(404,'route_not_found','مسار API غير موجود.');
}
async function api(request, env) {
  const auth=await authorize(request,env);
  if(!env.DB)throw new HttpError(503,'database_unavailable','قاعدة البيانات غير مهيّأة.');
  const repo=new D1Repository(env.DB), record=await repo.load();
  const url=new URL(request.url),parts=url.pathname.replace(/^\/api\/v1\/?/,'').split('/').filter(Boolean);
  const etag='"'+record.revision+'"';
  const externalFetch=env.GITHUB_API_HTTP?(url,init)=>env.GITHUB_API_HTTP.fetch(new Request(url,init)):fetch;
  if(parts[0]==='coordination'&&parts.length===1&&request.method==='GET'){
    const provider=await getProviderCapabilities(env,env.DB).catch(()=>({configured:false}));
    return json({revision:record.revision,checkedAt:new Date().toISOString(),...deriveCoordination(record.state,{capabilities:{aiConfigured:provider.configured,runnerReceiptConfigured:Boolean(env.AAS_RUNNER_TOKEN)}})});
  }
  if(parts[0]==='assistant'){
    if(!auth.visitor)throw new HttpError(403,'owner_session_required','المحادثة وإعداد مزوّدها يتطلبان جلسة المالك.');
    const assistant=new AssistantControl(env.DB);
    if(parts[1]==='capabilities'&&request.method==='GET')return json(await getProviderCapabilities(env,env.DB));
    if(parts[1]==='provider'&&parts[2]==='health'&&parts.length===3&&request.method==='GET')return json(await readProviderHealth(env,env.DB));
    if(parts[1]==='provider'&&parts[2]==='test'&&parts.length===3&&request.method==='POST'){
      const result=await testProviderGeneration(await body(request),env,env.DB,externalFetch);
      return json(result.body,result.status);
    }
    if(parts[1]==='history'&&request.method==='GET')return json(await assistant.history());
    if(parts[1]==='provider'&&parts[2]==='models'&&parts.length===3&&request.method==='POST')return json(await discoverProviderModels(await body(request),env,env.DB,externalFetch));
    if(parts[1]==='provider'&&parts.length===2&&request.method==='POST')return json(await configureProvider(await body(request),env,env.DB,externalFetch));
    if(parts[1]==='chat'&&request.method==='POST'){
      const input=await body(request),runtime=await loadAssistantEnvironment(env,env.DB);
      const provider=await getProviderCapabilities(env,env.DB);
      const observed=provider.configured?await getRepositoryStatus(env):null;
      const result=await assistant.turn(input,{revision:record.revision,state:record.state,coordination:deriveCoordination(record.state),repository:observed?.body?.repository||null},runtime,externalFetch);
      return json(result.body,result.status);
    }
    if(parts[1]==='apply'&&request.method==='POST'){
      const input=await body(request),expected=expectedRevision(request,input);
      try{const applied=await assistant.apply(input.proposalId,record,repo,expected);return json({...envelope(applied.record),result:applied.result,alreadyApplied:applied.alreadyApplied});}
      catch(error){if(error.status===409){const current=await repo.load();return json({...envelope(current),error:{code:error.code,message:error.message}},409);}throw error;}
    }
  }
  if(parts[0]==='database'){
    if(!auth.visitor)throw new HttpError(403,'owner_session_required','إدارة قاعدة البيانات المحلية تتطلب جلسة المالك.');
    const database=new DatabaseControl(env.DB);
    if(parts.length===1&&request.method==='GET')return json(await database.read());
    if(parts[1]==='bridges'&&request.method==='POST')return json(await database.create(await body(request)),201);
    if(parts[1]==='operations'&&request.method==='POST')return json(await database.queue(await body(request)),202);
  }
  if(parts[0]==='bridge'){
    if(!auth.runner)throw new HttpError(403,'runner_authentication_required','هذه المسارات مخصصة لجسر قاعدة البيانات.');
    const database=new DatabaseControl(env.DB);
    if(parts[1]==='context'&&request.method==='GET')return json(await database.context(url.searchParams.get('bridgeId')));
    if(parts[1]==='snapshot'&&request.method==='POST')return json(await database.snapshot(await body(request)));
    if(parts[1]==='receipts'&&request.method==='POST')return json(await database.receipt(await body(request)));
  }
  if(parts[0]==='execution'&&parts[1]==='capabilities'&&parts.length===2&&request.method==='GET'){
    return json({sourceAnalysis:true,runnerReceiptConfigured:Boolean(env.AAS_RUNNER_TOKEN),automaticCodeChanges:false,repository:REPOSITORY,analysisCoverage:'bounded-text-source-archive',analysisExcludes:['binary','assets','lockfiles'],privateRunnerAddress:env.AAS_PRIVATE_RUNNER_LABEL||null,privateRunnerMode:'outbound',githubActions:'setup-required'});
  }
  if(parts[0]==='runner'&&parts[1]==='health'&&parts.length===2&&request.method==='GET'){
    return json({status:'ok',storage:'D1',sourceRevision:__AAS_SOURCE_REVISION__,receiptReceiverConfigured:true,automaticCodeChanges:false,revision:record.revision,checkedAt:new Date().toISOString()});
  }
  if(parts[0]==='runner'&&parts[1]==='context'&&parts.length===2&&request.method==='GET'){
    const workflow=(record.state.workflows||[]).find(item=>item.id===url.searchParams.get('workflowId'));
    if(!workflow)throw new HttpError(404,'workflow_not_found','خطة التنفيذ غير موجودة.');
    return json({revision:record.revision,workflow,currentStep:workflow.steps[workflow.currentStepIndex]||null});
  }
  if(parts[0]==='runner'&&parts[1]==='connection-config'&&parts.length===2&&request.method==='POST'){
    if(!auth.visitor)throw new HttpError(403,'owner_session_required','تنزيل إعدادات المنفّذ يتطلب جلسة المالك.');
    await body(request);
    if(!env.AAS_RUNNER_TOKEN||!env.AAS_PRIVATE_SITE_BEARER||!env.AAS_PUBLIC_ORIGIN)throw new HttpError(503,'runner_not_configured','إعدادات وصول المنفّذ غير مكتملة.');
    return json({baseUrl:env.AAS_PUBLIC_ORIGIN.replace(/\/$/,'')+'/',runnerToken:env.AAS_RUNNER_TOKEN,siteAccessToken:env.AAS_PRIVATE_SITE_BEARER},200,{'Content-Disposition':'attachment; filename="aas-runner-connection.json"'});
  }
  if(parts[0]==='github'&&parts.length===1&&request.method==='GET'){
    const result=await getRepositoryStatus(env);
    return json(result.body,result.status);
  }
  if(parts[0]==='github'&&parts[1]==='refresh'&&request.method==='POST'){
    await body(request);
    const result=await getRepositoryStatus(env,{force:true});
    return json(result.body,result.status);
  }
  if(request.method==='POST'&&parts[0]==='ai'&&parts[1]==='generate'){
    const input=await body(request);
    const runtime=await loadAssistantEnvironment(env,env.DB);
    const result=await generateAi(input,runtime,externalFetch);
    return json({...result,content:sanitizeAssistantText(result.content,runtime)});
  }
  if(request.method==='POST'&&parts[0]==='app'&&parts[1]==='connection-config'){
    if(!auth.visitor)throw new HttpError(403,'owner_session_required','تنزيل إعدادات التطبيق يتطلب جلسة المالك في لوحة القيادة.');
    await body(request);
    if(!env.AAS_API_TOKEN||!env.AAS_PRIVATE_SITE_BEARER||!env.AAS_PUBLIC_ORIGIN)throw new HttpError(503,'connection_config_missing','إعدادات اتصال التطبيق غير مكتملة على الخادم.');
    return json({baseUrl:env.AAS_PUBLIC_ORIGIN.replace(/\/$/,'')+'/',apiToken:env.AAS_API_TOKEN,siteAccessToken:env.AAS_PRIVATE_SITE_BEARER,automaticSync:false},200,{'Content-Disposition':'attachment; filename="aas-app-connection.json"'});
  }
  if(request.method==='POST'&&parts[0]==='app'&&parts[1]==='sync'){
    if(!auth.service)throw new HttpError(401,'application_credential_required','مزامنة التطبيق تتطلب بيانات مصادقة الخدمة، وليست تحديثًا يدويًا من اللوحة.');
    const input=await body(request);
    let current=record;
    for(let attempt=0;attempt<3;attempt++){
      const receivedAt=new Date().toISOString();
      const change=mutateLiveState(current.state,'recordAppSnapshot',{...input,receivedAt});
      const saved=await repo.compareAndSet(current.revision,change.state);
      if(saved)return json({revision:saved.revision,receivedAt,productsAccepted:saved.state.commerce.products.length,ordersAccepted:saved.state.commerce.orders.length});
      current=await repo.load();
    }
    throw new HttpError(409,'sync_conflict','تغيّرت البيانات أثناء المزامنة. أعد المحاولة.');
  }
  if(request.method==='GET'&&parts[0]==='products'&&parts[1]==='search'){
    const query=(url.searchParams.get('q')||'').trim().toLowerCase();
    const products=record.state.commerce?.products||[];
    return json(products.filter(p=>!query||(p.name+' '+p.category).toLowerCase().includes(query)).map(p=>({id:p.id,name:p.name,category:p.category,price:p.retailPrice,wholesalePrice:p.wholesalePrice,retailer:p.merchantName,imageUrl:p.imageUrl,description:''})));
  }
  if(request.method==='GET'&&parts[0]==='products'&&parts[2]==='compare'){
    const p=record.state.commerce?.products.find(p=>String(p.id)===parts[1]);
    if(!p)throw new HttpError(404,'product_not_found','هذا المنتج غير موجود في البيانات المتزامنة من التطبيق.');
    // This endpoint reports the store's observed price. No competitor quote is fabricated.
    return json({productId:p.id,productName:p.name,lowestPrice:p.retailPrice,averagePrice:p.retailPrice,priceSpread:0,prices:[{retailerName:p.merchantName,price:p.retailPrice,isBestDeal:false,productUrl:''}],source:'app_catalog',externalComparison:false});
  }
  if(request.method==='GET'&&['radar','social'].includes(parts[0]))throw new HttpError(503,'integration_not_configured','مزود بيانات المقارنة أو الشبكات الاجتماعية غير مهيّأ. لا توجد نتائج فعلية لهذه الخدمة.');
  if(request.method==='GET'&&parts[0]==='health')return json({status:'ok',storage:'D1',version:'2.0.0',sourceRevision:__AAS_SOURCE_REVISION__,revision:record.revision,checkedAt:new Date().toISOString(),automaticExecution:false});
  if(request.method==='GET'&&parts[0]==='state'){
    if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'private, no-store'}});
    return json(envelope(record),200,{ETag:etag});
  }
  if(request.method==='GET'&&RESOURCES.has(parts[0])){
    const data=record.state[parts[0]];
    const result=parts[1]&&Array.isArray(data)?data.find(v=>v.id===parts[1]):data;
    if(result===undefined)throw new HttpError(404,'not_found','السجل غير موجود.');
    return json({data:result,revision:record.revision},200,{ETag:etag});
  }
  if(!['POST','PATCH','DELETE'].includes(request.method))throw new HttpError(405,'method_not_allowed','طريقة الطلب غير مدعومة.');
  const input=await body(request);
  if(parts[0]==='import'&&parts[1]==='validate'){
    const candidate=typeof input.data==='string'?JSON.parse(input.data):input.data;
    const checked=normalizeLiveState(candidate);
    return json({valid:true,summary:{tasks:checked.tasks.length,workspaces:checked.workspaces.length}});
  }
  const expected=expectedRevision(request,input);
  const receiptWorkflowId=input.receipt?.workflowId||input.workflowId;
  if(expected!==record.revision){const error={code:'revision_conflict',message:'تغيّرت البيانات من جلسة أخرى. حدّث اللوحة قبل حفظ التغيير.'};return json(auth.runner?runnerEnvelope(record,receiptWorkflowId,error):{...envelope(record),error},409,{ETag:etag});}
  let operation,payload;
  if(parts[0]==='runner'&&parts[1]==='receipts'&&parts.length===2&&request.method==='POST'){
    if(!auth.runner)throw new HttpError(403,'runner_authentication_required','هذا المسار مخصص لنتائج منفّذ الكود.');
    operation='recordWorkflowRunnerReceipt';payload=input.receipt||input;
  }else if(parts[0]==='runner'&&parts[1]==='advance'&&parts.length===2&&request.method==='POST'){
    if(!auth.runner)throw new HttpError(403,'runner_authentication_required','هذا المسار مخصص لمنفّذ الكود.');
    operation='advanceWorkflowRunner';payload=input;
  }else if(parts[0]==='workflows'&&parts[2]==='analyze'&&parts.length===3&&request.method==='POST'){
    const workflow=(record.state.workflows||[]).find(item=>item.id===parts[1]);
    if(!workflow)throw new HttpError(404,'workflow_not_found','خطة التنفيذ غير موجودة.');
    if(workflow.repository?.toLowerCase()!==REPOSITORY.toLowerCase())throw new HttpError(422,'analysis_repository_mismatch','التحليل المباشر متاح للمستودع المرتبط بالمشروع.');
    const step=workflow.steps[workflow.currentStepIndex];
    if(!step||workflow.status==='complete')throw new HttpError(422,'workflow_complete','خطة التنفيذ مكتملة.');
    operation='recordWorkflowAnalysisResult';
    payload={workflowId:workflow.id,stepId:step.id,sourceRevision:step.sourceRevision};
    try{
      const observed=await getRepositoryStatus(env,{force:true});
      const head=observed.body.repository?.head?.sha;
      if(!head||observed.body.stale)throw new HttpError(503,'source_observation_unavailable','تعذر التحقق من أحدث نسخة للمصدر. أعد المحاولة قبل تحليل الكود.');
      if(head!==step.sourceRevision)throw new HttpError(409,'workflow_source_changed','نسخة الخطة تختلف عن أحدث مصدر منشور. ابدأ خطة مرتبطة بالنسخة الحالية.');
      const fetchImpl=env.GITHUB_API_HTTP?(url,init)=>env.GITHUB_API_HTTP.fetch(new Request(url,init)):undefined;
      const analysis=await analyzeRepositorySource({sourceRevision:head,...(fetchImpl?{fetchImpl}:{})});
      payload={...payload,summary:analysis.summary,evidence:analysis.evidence,outcome:'passed'};
    }catch(error){
      payload={...payload,outcome:'blocked',summary:'توقّف تحليل المصدر قبل الاكتمال.',evidence:[{kind:'log',label:'سبب توقف التحليل',content:String(error.message||'تعذر قراءة المصدر.').slice(0,2000)}]};
    }
  }else if(parts[0]==='servers'&&parts[2]==='check'&&request.method==='POST'){
    const server=record.state.servers.find(s=>s.id===parts[1]);
    if(!server)throw new HttpError(404,'server_not_found','الخادم غير موجود.');
    operation='recordServerHealth';payload=await checkServerHealth(server,env);
  }else{
    ({operation,payload}=actionFor(request.method,parts,input));
    if(!PUBLIC_OPERATIONS.has(operation))throw new HttpError(400,'operation_not_allowed','هذا الإجراء غير متاح عبر API.');
  }
  let changed=mutateLiveState(record.state,operation,payload);
  let saved=await repo.compareAndSet(expected,changed.state);
  // Source analysis has no external write to replay. Merge its one result after
  // unrelated task updates only while the exact workflow/step revision survives.
  if(!saved&&operation==='recordWorkflowAnalysisResult'){
    const original=record.state.workflows.find(flow=>flow.id===payload.workflowId);
    const originalStep=original?.steps.find(step=>step.id===payload.stepId);
    for(let attempt=0;attempt<3&&!saved;attempt++){
      const current=await repo.load(),flow=current.state.workflows.find(item=>item.id===payload.workflowId),step=flow?.steps.find(item=>item.id===payload.stepId);
      if(!flow||!step||flow.sourceRevision!==original.sourceRevision||flow.currentStepIndex!==original.currentStepIndex||step.revision!==originalStep.revision)break;
      changed=mutateLiveState(current.state,operation,payload);saved=await repo.compareAndSet(current.revision,changed.state);
    }
  }
  if(!saved){const latest=await repo.load();const error={code:'revision_conflict',message:'تغيّرت البيانات أثناء حفظ الطلب. راجع الحالة الحالية.'};return json(auth.runner?runnerEnvelope(latest,receiptWorkflowId,error):{...envelope(latest),error},409,{ETag:'"'+latest.revision+'"'});}
  return json(auth.runner?runnerEnvelope(saved,receiptWorkflowId):{...envelope(saved),result:changed.result},200,{ETag:'"'+saved.revision+'"'});
}
function staticAsset(request) {
  const path=new URL(request.url).pathname;
  const file=assets[path==='/'?'/index.html':path];
  if(!file)return new Response('Not found',{status:404});
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
  const bytes=Uint8Array.from(atob(file.body),c=>c.charCodeAt(0));
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':file.type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
}
export default {
  async fetch(request,env) {
    try{return new URL(request.url).pathname.startsWith('/api/')?await api(request,env):staticAsset(request);}
    catch(error){
      const status=error.status||400;
      if(/D1|SQLITE|no such table|database/i.test(error.message)&&!error.status)return json({error:{code:'database_failure',message:'تعذر الوصول إلى قاعدة البيانات. راجع نشر الترحيلات.'}},503);
      return json({error:{code:error.code||'validation_error',message:error.status||status===400?error.message:'تعذر إتمام الطلب.'}},status);
    }
  }
};
