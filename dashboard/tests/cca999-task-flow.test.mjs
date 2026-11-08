import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMessage,analyzeHandoffs,fetchHandoffs,buildTaskJourney} from '../cca999-task-flow.mjs';
const html=readFileSync('dashboard/index.html','utf8');
const mk=(id,reply_to=null,n=1)=>({
 id:n,html_url:'https://github.com/example/issues/168#issuecomment-'+n,created_at:'2026-11-08T23:00:00Z',
 body:'```json\n'+JSON.stringify({kind:'PROJECT_CHAT_MESSAGE',schema:'1.0',id,from_project:'gpt',from_chat:'999 CCA N1',to_project:'gpt',to_chat:'المدير التنفيذي 777',subject:'طلب مهمة',body:'مراسلة تنسيقية',reply_to})+'\n```'
});
test('central navigation includes physical CCA999 section and module',()=>{
 assert.match(html,/data-view="cca999-task-flow"/);
 assert.match(html,/\["cca999-task-flow","انتقال المهام والاستجابة"\]/);
 assert.match(html,/src="cca999-task-flow.mjs"/);
});
test('GitHub message alone cannot certify delivered/acknowledged/executed',()=>{
 const tasks=analyzeHandoffs([mk('CCA999-PLAN-20261108-1')]);
 assert.equal(tasks.length,1);
 assert.equal(tasks[0].state,'SENT_ONLY');
 assert.equal(tasks[0].read_verified,false);
 assert.equal(tasks[0].execution_verified,false);
});
test('linked comment only proves response recorded in public hub',()=>{
 const tasks=analyzeHandoffs([mk('CCA999-PLAN-20261108-1'),mk('REPLY-1','CCA999-PLAN-20261108-1',2)]);
 assert.equal(tasks[0].state,'RESPONSE_IN_HUB_UNVERIFIED');
 assert.equal(tasks[0].reply_count,1);
 assert.equal(tasks[0].ack_verified,false);
});
test('ignore unstructured or unrelated comments',()=>{
 assert.equal(parseMessage({body:'hello'}),null);
 assert.equal(analyzeHandoffs([mk('unrelated-task')]).length,0);
});
test('network failures fail closed',async()=>{
 await assert.rejects(fetchHandoffs(async()=>({ok:false,status:403})),/GITHUB_HTTP_403/);
});

test('visual timeline is integrated into the published central view',()=>{
 assert.match(html,/id="cca999-flow-journeys"/);
 assert.ok(html.includes('.cca999-journey-stages'));
});
test('only real GitHub sending proof is verified on journey',()=>{
 const task=analyzeHandoffs([mk('CCA999-PLAN-20261108-1')])[0];
 const steps=buildTaskJourney(task);
 assert.deepEqual(steps.map(x=>x.id),['SENT','DELIVERED','ACKNOWLEDGED','EXECUTING','EVIDENCE','REVIEWED']);
 assert.equal(steps[0].status,'VERIFIED');
 assert.ok(steps[0].proof_url);
 assert.ok(steps.slice(1).every(x=>x.status==='UNVERIFIED'&&!x.proof_url));
});
test('GitHub reply is not accepted as execution evidence',()=>{
 const task=analyzeHandoffs([mk('CCA999-PLAN-20261108-1'),mk('REPLY-1','CCA999-PLAN-20261108-1',2)])[0];
 assert.equal(task.reply_count,1);
 assert.ok(buildTaskJourney(task).slice(1).every(x=>x.status==='UNVERIFIED'));
});
test('missing send proof fails closed even if task is supplied',()=>{
 const stages=buildTaskJourney({comment_id:null,proof_url:null});
 assert.ok(stages.every(x=>x.status==='UNVERIFIED'));
});
