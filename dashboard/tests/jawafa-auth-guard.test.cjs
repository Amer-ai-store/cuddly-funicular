"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../jawafa-integration.js"),"utf8");
function harness(){
 const pending=[];
 const auth={currentUser:{emailVerified:true,getIdToken:async()=>"test-firebase-jwt"}};
 const window={firebase:{auth:()=>auth,apps:[{}]},addEventListener(){}};
 const context={window,document:{querySelector:()=>null},AbortController,crypto:{randomUUID:()=>"UUID-12345"},fetch:(url)=>url==="./data/jawafa-status.json"?Promise.resolve({ok:false,status:404,json:async()=>({})}):new Promise(resolve=>pending.push(resolve)),setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{}};
 vm.runInNewContext(source,context,{timeout:3000});
 const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve()};
 const result=(data)=>({ok:true,status:200,json:async()=>data});
 const baseline={schema_version:"jawafa.command.v1",source_system:"TEST_ONLY_NOT_SQL",snapshot_id:"fake",agent_channel:{connected:true},dashboard:{private_https_verified:false,e2e_verified:false},gate:{status:"NOT ACCEPTED"},tasks:[]};
 return {window,auth,pending,flush,result,baseline};
}
test("logout cannot be undone by an older successful API response",async()=>{
 const h=harness();await h.flush();assert.equal(h.pending.length,1);
 h.auth.currentUser=null;
 const signedOut=h.window.JawafaUI.refresh();await signedOut;
 h.pending[0](h.result(h.baseline));await h.flush();
 assert.equal(h.window.JawafaUI.connected(),false);
 assert.equal(h.window.JawafaUI.canDispatch("CHECK_SERVER"),false);
});
test("signed worker heartbeat alone is not private gateway or E2E acceptance",async()=>{
 const h=harness();await h.flush();h.pending[0](h.result(h.baseline));await h.flush();
 assert.equal(h.window.JawafaUI.connected(),true);
 assert.equal(h.window.JawafaUI.canDispatch("CHECK_SERVER"),false);
 assert.equal(h.window.JawafaUI.canDispatch("RECONCILE_BANK"),false);
});
test("accepted HTTPS and E2E never bypass NOT ACCEPTED GATE-15 for reconciliation",async()=>{
 const h=harness();await h.flush();
 h.pending[0](h.result({...h.baseline,dashboard:{private_https_verified:true,e2e_verified:true}}));await h.flush();
 assert.equal(h.window.JawafaUI.canDispatch("CHECK_SERVER"),true);
 assert.equal(h.window.JawafaUI.canDispatch("RECONCILE_BANK"),false);
});
test("no authorized worker heartbeat, no command even with gateway flags",async()=>{
 const h=harness();await h.flush();
 h.pending[0](h.result({...h.baseline,agent_channel:{connected:false},dashboard:{private_https_verified:true,e2e_verified:true}}));await h.flush();
 assert.equal(h.window.JawafaUI.canDispatch("CHECK_SERVER"),false);
});
test("invalid schema and unauthenticated refresh fail closed",async()=>{
 const h=harness();await h.flush();
 h.pending[0](h.result({status:"CONNECTED"}));await h.flush();
 assert.equal(h.window.JawafaUI.connected(),false);
 h.auth.currentUser=null;await h.window.JawafaUI.refresh();
 assert.equal(h.window.JawafaUI.canDispatch("CHECK_SERVER"),false);
});
