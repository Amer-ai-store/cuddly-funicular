import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CCA999_AGENT_HEALTH,evaluateAgentHealth} from '../cca999-api-health.mjs';
const html=readFileSync('dashboard/index.html','utf8');
const edge=readFileSync('supabase/functions/cca999-message-agent/index.ts','utf8');
test('agent is integrated into the existing task dashboard without a parallel panel',()=>{
 assert.match(html,/id="cca999-agent-api-status"/);
 assert.match(html,/src="cca999-api-health.mjs"/);
 assert.match(html,/data-view="cca999-task-flow"/);
});
test('external GET health cannot manufacture successful delivery',()=>{
 assert.match(CCA999_AGENT_HEALTH,/\/functions\/v1\/cca999-message-agent\/health$/);
 assert.equal(evaluateAgentHealth({ok:true,database_reachable:true,service:'cca999-message-agent'},true).status,'BACKEND_REACHABLE');
 assert.equal(evaluateAgentHealth({ok:false,database_reachable:false,service:'cca999-message-agent'},false).status,'NOT_VERIFIED');
 assert.equal(evaluateAgentHealth({ok:true,database_reachable:false,service:'cca999-message-agent'},true).status,'NOT_VERIFIED');
});
test('sensitive API operations authenticate and enforce ChatGPT-independent scope',()=>{
 assert.match(edge,/c\.auth\.getUser\(token\)/);
 assert.match(edge,/app_metadata\?\.cca999_chat_keys/);
 assert.match(edge,/CHAT_MEMBERSHIP_NOT_PROVISIONED/);
 assert.match(edge,/SOURCE_NOT_AUTHORIZED/);
 assert.match(edge,/RECIPIENT_NOT_AUTHORIZED/);
 assert.match(edge,/AUTHENTICATED_API_CLIENT_NOT_CHATGPT_UI/);
 assert.match(edge,/chatgpt_ui_delivery_verified:false/);
});
test('API supports replies and distinct actual receipts but never writes financial database',()=>{
 for(const op of ['send','inbox','received','read','ack','reply','status'])assert.ok(edge.includes('"'+op+'"'));
 assert.match(edge,/orchestrator_bus_messages/);
 assert.match(edge,/orchestrator_bus_events/);
 assert.doesNotMatch(edge,/(?:Jawafa_DB|DROP TABLE|TRUNCATE TABLE|ALTER TABLE)/);
});
