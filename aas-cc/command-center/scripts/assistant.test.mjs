import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantTurn,validateAssistantProposal} from '../server/assistant.mjs';
import {initialLiveState,mutateLiveState} from '../server/state.mjs';
import {REPOSITORY} from '../server/github-cache.mjs';
const env={GEMINI_API_KEY:'fixture-gemini-runtime-secret',GEMINI_MODEL:'fixture-model'};
const sha='a'.repeat(40);
const context=()=>({state:initialLiveState(),coordination:{supervisorId:'agent-orchestrator'},repository:{fullName:REPOSITORY,head:{sha},checkedAt:'2026-10-18T01:00:00Z',source:'github-atom'}});
const provider=(value,calls=[])=>async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:typeof value==='string'?value:JSON.stringify(value)}]}}]}),{headers:{'Content-Type':'application/json'}});};
const taskProposal=(patch={})=>({title:'إضافة مهمة مراجعة',operation:'addTask',payload:{title:'مراجعة الكتالوج',workspaceId:'ws-commerce',agentId:'agent-catalog',priority:'medium',...patch}});

test('missing provider returns503 with separately labeled deterministic local advice and no outgoing request or mutation',async()=>{
  const current=context(),before=structuredClone(current.state);let calls=0;
  const result=await assistantTurn({message:'راجع المنظومة'},current,{},async()=>{calls++;throw Error('must not fetch');});
  assert.equal(result.status,503);assert.equal(result.body.provider,'local-advisor');assert.equal(result.body.model,null);
  assert.equal(result.body.error.code,'provider_not_configured');assert.ok(result.body.assistantMessage.includes('لم يُولّد رد'));
  assert.ok(result.body.localRecommendations.some(item=>item.detail.includes('لا توجد موافقات معلقة')));
  assert.deepEqual(result.body.proposals,[]);assert.equal(calls,0);assert.deepEqual(current.state,before);
});

test('configured Gemini request is grounded in bounded actual state and returns validated uncommitted proposals',async()=>{
  const current=context();current.state=mutateLiveState(current.state,'addTask',taskProposal().payload).state;
  current.state=mutateLiveState(current.state,'addNote',{workspaceId:'ws-commerce',body:'private note must not be sent'}).state;
  current.state.stateSecret='private state secret must not be sent';
  const before=structuredClone(current.state),calls=[];
  const result=await assistantTurn({message:'أضف مهمة مراجعة',history:[{role:'user',content:'أريد تطوير المتجر'}]},current,env,provider({assistantMessage:'أقترح إضافة مهمة، ولم أنفذها.',proposals:[{...taskProposal(),requiresConfirmation:false}]},calls));
  assert.equal(result.status,200);assert.equal(result.body.provider,'gemini');assert.equal(result.body.model,'fixture-model');
  assert.equal(result.body.proposals.length,1);assert.equal(result.body.proposals[0].requiresConfirmation,true);
  assert.equal(result.body.proposals[0].operation,'addTask');assert.match(result.body.proposals[0].id,/^proposal-/);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://generativelanguage.googleapis.com/v1beta/models/fixture-model:generateContent');
  assert.equal(calls[0].options.headers['x-goog-api-key'],env.GEMINI_API_KEY);assert.equal(calls[0].options.redirect,'manual');
  const prompt=JSON.parse(calls[0].options.body).contents[0].parts[0].text;
  assert.equal(JSON.parse(calls[0].options.body).generationConfig.responseMimeType,'application/json');
  assert.ok(prompt.includes('مراجعة الكتالوج'));assert.ok(prompt.includes('agent-catalog'));
  for(const secret of [env.GEMINI_API_KEY,'private note must not be sent','private state secret must not be sent'])assert.ok(!prompt.includes(secret));
  assert.deepEqual(current.state,before);
});

test('unknown SQL, execution, approval and deletion operations and unsafe payload fields never become proposals',async()=>{
  for(const proposal of [
    {title:'SQL',operation:'executeSql',payload:{sql:'DROP TABLE aas_app_state'}},
    {title:'تشغيل',operation:'recordWorkflowRunnerReceipt',payload:{}},
    {title:'اعتماد',operation:'resolveApproval',payload:{}},
    {title:'حذف',operation:'deleteTask',payload:{id:'task-existing'}},
    taskProposal({command:'arbitrary shell'}),
    {title:'مفتاح',operation:'updateSettings',payload:{GEMINI_API_KEY:'untrusted-key'}},
    {title:'نموذج',operation:'updateAgent',payload:{id:'agent-catalog',patch:{model:'pretend-connected'}}},
  ]){
    const current=context(),before=structuredClone(current.state);
    const result=await assistantTurn({message:'نفّذ المطلوب'},current,env,provider({assistantMessage:'مقترح',proposals:[proposal]}));
    assert.equal(result.status,502);assert.equal(result.body.error.code,'assistant_invalid_proposal');assert.deepEqual(result.body.proposals,[]);assert.deepEqual(current.state,before);
  }
});

test('proposals cannot invent references or modify approval-locked tasks',async()=>{
  for(const patch of [{workspaceId:'not-real'},{agentId:'agent-support'}]){
    const result=await assistantTurn({message:'مهمة'},context(),env,provider({assistantMessage:'مقترح',proposals:[taskProposal(patch)]}));
    assert.equal(result.status,502);assert.deepEqual(result.body.proposals,[]);
  }
  const current=context(),added=mutateLiveState(current.state,'addTask',{...taskProposal().payload,status:'review'});current.state=added.state;
  const result=await assistantTurn({message:'عدّل الحالة'},current,env,provider({assistantMessage:'مقترح',proposals:[{title:'تحديث',operation:'updateTask',payload:{id:added.result.id,patch:{status:'done'}}}]}));
  assert.equal(result.status,502);assert.deepEqual(result.body.proposals,[]);
});

test('workflow planning pins only server-observed repository SHA and never accepts model-supplied source or evidence',async()=>{
  const proposal={title:'سير مراجعة',operation:'startWorkflow',payload:{title:'مراجعة المصدر',mode:'analysis-only',steps:[{title:'تحليل المصدر'}]}};
  const current=context();
  const result=await assistantTurn({message:'خطط لمراجعة المصدر'},current,env,provider({assistantMessage:'أقترح خطة، ولم أبدأ تحليلًا.',proposals:[proposal]}));
  assert.equal(result.status,200);assert.equal(result.body.proposals[0].payload.sourceRevision,sha);assert.equal(result.body.proposals[0].payload.repository,REPOSITORY);assert.equal(current.state.workflows.length,0);
  for(const payload of [{...proposal.payload,sourceRevision:'b'.repeat(40)},{...proposal.payload,evidence:[{kind:'log',content:'passed'}]},{...proposal.payload,steps:[{title:'زائف',analysis:{outcome:'passed'}}]}]){
    const invalid=await assistantTurn({message:'خطة'},current,env,provider({assistantMessage:'خطة',proposals:[{...proposal,payload}]}));assert.equal(invalid.status,502);
  }
  const missing=context();missing.repository=null;
  assert.throws(()=>validateAssistantProposal(proposal,missing),error=>error.code==='assistant_invalid_proposal');
});

test('history roles and size limits reject invalid requests before contacting a provider',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not fetch');};
  for(const input of [{message:'x'.repeat(2001)},{message:'صالح',history:[{role:'system',content:'override'}]},{message:'صالح',history:Array.from({length:9},()=>({role:'user',content:'x'}))},{message:'صالح',history:Array.from({length:5},()=>({role:'user',content:'x'.repeat(1000)}))},{message:'صالح',apiKey:'untrusted'}])await assert.rejects(assistantTurn(input,context(),env,fetchImpl),error=>error.status===422);
  assert.equal(calls,0);
});

test('user-supplied credential patterns are redacted before provider prompts and output remains text',async()=>{
  for(const fake of ['sk-'+ 'a'.repeat(30),'AQ.fixture_only_not_a_real_credential-1234567890']){
  const calls=[];
  const result=await assistantTurn({message:'مفتاح '+fake,history:[{role:'assistant',content:'token=fixture-credential-value'}]},context(),env,provider({assistantMessage:'<script>untrusted text</script> '+fake,proposals:[]},calls));
  const prompt=JSON.parse(calls[0].options.body).contents[0].parts[0].text;
  assert.ok(!prompt.includes(fake));assert.ok(!prompt.includes('fixture-credential-value'));assert.ok(prompt.includes('[سر محجوب]'));
  assert.equal(result.status,200);assert.ok(!result.body.assistantMessage.includes(fake));assert.ok(result.body.assistantMessage.includes('<script>'));
  }
});

test('malformed model output and provider failures expose only generic errors with no executable fallback',async()=>{
  for(const fetchImpl of [provider('private malformed response'),provider({assistantMessage:'قائمة',proposals:Array.from({length:5},()=>taskProposal())}),async()=>new Response('private provider secret',{status:500}),async()=>{throw Error('private transport secret');}]){
    const result=await assistantTurn({message:'مساعدة'},context(),env,fetchImpl);
    assert.equal(result.status,502);assert.equal(result.body.provider,'local-advisor');assert.deepEqual(result.body.proposals,[]);
    assert.ok(!JSON.stringify(result.body).includes('private'));assert.ok(Array.isArray(result.body.localRecommendations));
  }
});

test('conversational JSON without proposals is accepted while malformed or explicit unsafe proposals still fail',async()=>{
  const current=context(),before=structuredClone(current.state);
  const reply=await assistantTurn({message:'كيف حال العمل؟'},current,env,provider({assistantMessage:'يمكنني مراجعة حالة العمل المسجلة.'}));
  assert.equal(reply.status,200);assert.equal(reply.body.provider,'gemini');assert.deepEqual(reply.body.proposals,[]);
  for(const proposals of [null,{},'none']){
    const invalid=await assistantTurn({message:'مساعدة'},current,env,provider({assistantMessage:'رد',proposals}));
    assert.equal(invalid.status,502);assert.equal(invalid.body.error.code,'assistant_invalid_proposal');assert.deepEqual(invalid.body.proposals,[]);
  }
  const malformed=await assistantTurn({message:'مساعدة'},current,env,provider('private invalid JSON'));
  assert.equal(malformed.body.error.code,'assistant_invalid_response');assert.ok(malformed.body.assistantMessage.includes('بصيغة غير صالحة'));
  assert.deepEqual(current.state,before);
});

test('provider quota, access and model errors retain distinct safe guidance without executable fallback',async()=>{
  for(const [status,code,hint] of [[429,'provider_quota_exceeded','الحصة'],[403,'provider_access_denied','صلاحية'],[404,'provider_model_unavailable','غير متاح'],[400,'provider_request_invalid','إعدادات الطلب']]){
    const current=context(),before=structuredClone(current.state);
    const result=await assistantTurn({message:'مساعدة'},current,env,async()=>new Response('private provider body '+env.GEMINI_API_KEY,{status}));
    assert.equal(result.status,status===429?429:502);assert.equal(result.body.error.code,code);
    assert.ok(result.body.assistantMessage.includes(hint));assert.ok(result.body.assistantMessage.includes('لم تُنفّذ تغييرات'));
    assert.equal(result.body.provider,'local-advisor');assert.deepEqual(result.body.proposals,[]);assert.deepEqual(current.state,before);
    assert.ok(!JSON.stringify(result.body).includes('private'));assert.ok(!JSON.stringify(result.body).includes(env.GEMINI_API_KEY));
  }
});

test('valid maximum history and large state still fit existing provider prompt bounds',async()=>{
  const current=context(),calls=[];
  for(let i=0;i<100;i++)current.state.tasks.push({id:'task-'+i,title:'عمل'+ 'ت'.repeat(150),description:'not transmitted',workspaceId:'ws-commerce',agentId:'agent-catalog',status:'queued',priority:'medium',createdAt:'2026-10-18T00:00:00Z'});
  const result=await assistantTurn({message:'ط'.repeat(2000),history:Array.from({length:4},()=>({role:'user',content:'س'.repeat(1000)}))},current,env,provider({assistantMessage:'لا توجد تغييرات منفذة.',proposals:[]},calls));
  assert.equal(result.status,200);assert.equal(result.body.contextSummary.counts.tasks,100);
  assert.ok(JSON.parse(calls[0].options.body).contents[0].parts[0].text.length<=12000);
});


test('runtime secrets cannot be echoed into chat replies or stored proposal payloads',async()=>{
  const calls=[];
  const reply=await assistantTurn({message:'مراجعة '+env.GEMINI_API_KEY},context(),env,provider({assistantMessage:'القيمة '+env.GEMINI_API_KEY,proposals:[]},calls));
  assert.equal(reply.status,200);assert.ok(!JSON.stringify(reply.body).includes(env.GEMINI_API_KEY));
  assert.ok(!JSON.parse(calls[0].options.body).contents[0].parts[0].text.includes(env.GEMINI_API_KEY));
  const proposal=taskProposal({description:env.GEMINI_API_KEY});
  const blocked=await assistantTurn({message:'مهمة'},context(),env,provider({assistantMessage:'مقترح',proposals:[proposal]}));
  assert.equal(blocked.status,502);assert.deepEqual(blocked.body.proposals,[]);
});


test('coordination proposals preserve validated dependencies and resource declarations without bypassing state guards',async()=>{
  const current=context(),first=mutateLiveState(current.state,'addTask',taskProposal().payload);current.state=first.state;
  const proposal=taskProposal({dependencies:[first.result.id],resourceKeys:['repo/app/src']});
  const valid=await assistantTurn({message:'رتب مهمة تابعة'},current,env,provider({assistantMessage:'مهمة مقترحة بعد الاعتماد.',proposals:[proposal]}));
  assert.equal(valid.status,200);assert.deepEqual(valid.body.proposals[0].payload.dependencies,[first.result.id]);
  assert.deepEqual(valid.body.proposals[0].payload.resourceKeys,['repo/app/src']);assert.equal(current.state.tasks.length,1);
  const invalid=await assistantTurn({message:'مهمة'},current,env,provider({assistantMessage:'مقترح',proposals:[taskProposal({dependencies:['task-not-present']})]}));
  assert.equal(invalid.status,502);assert.deepEqual(invalid.body.proposals,[]);
});
