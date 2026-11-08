import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

const read=f=>readFileSync('dashboard/'+f,'utf8');
const index=read('index.html'),js=read('jawafa-forensic-workspace.js');
const data=JSON.parse(read('data/jawafa-forensic-workspace-public.json'));

test('workbench lives inside the one canonical central dashboard and navigates correctly',()=>{
  assert.match(index,/\["jawafa-forensic-workspace","التحقيق الموسع والأدلة"\]/);
  assert.match(index,/data-view="jawafa-forensic-workspace"/);
  assert.match(index,/id="jawafa-forensic-workspace-root"/);
  assert.match(index,/<script src="jawafa-forensic-workspace\.js" defer><\/script>/);
  new Script(js,{filename:'jawafa-forensic-workspace.js'});
});

test('all 26 investigation topics are public metadata, not finance or allegations',()=>{
  assert.equal(data.schema,'jawafa.public.forensic-workspace.v1');
  assert.equal(data.classification,'PUBLIC_TOPIC_METADATA_NO_PERSONAL_OR_FINANCIAL_RECORDS');
  assert.equal(data.cases.length,26);
  assert.equal(data.cases.filter(x=>x.priority==='P0').length,14);
  assert.equal(data.cases.filter(x=>x.priority==='P1').length,12);
  assert.equal(new Set(data.cases.map(x=>x.id)).size,26);
  assert.ok(data.cases.every(x=>x.status==='NEEDS_INDEPENDENT_VERIFICATION'));
  assert.equal(data.source_connection.central_gitHub_pages_live_financial_data_verified,false);
  assert.equal(data.source_connection.full_live_sql_financial_e2e_verified,false);
  assert.equal(data.delivery.state,'SENT_TO_GITHUB_MAILBOX_ONLY');
  assert.equal(data.delivery.manager_ack_verified,false);
  assert.doesNotMatch(JSON.stringify(data),/https:\/\/(?:drive|docs)\.google\.com\/|(?:PRIVATE_KEY|SQL_PASSWORD|sk-proj-|Bearer )/);
  assert.doesNotMatch(JSON.stringify(data),/مها الدعجة|أحمد محسن|خالد الجواميس|ر.?\s*ق.?\s*م.?\s*الشيك\s*\d+/);
});

test('workspace renders rows, filters by priority, and rejects nonprivate URLs',async()=>{
  class Node{
    constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.textContent='';this.disabled=false;}
    append(...x){this.children.push(...x)}
    replaceChildren(...x){this.children=x}
    setAttribute(k,v){this[k]=v}
    addEventListener(type,cb){this.listeners[type]=cb}
  }
  const root=new Node('section'),opened=[];
  const document={
    getElementById(id){return id==='jawafa-forensic-workspace-root'?root:null},
    createElement(tag){return new Node(tag)}
  };
  const fetch=async(url,options)=>{assert.equal(url,'./data/jawafa-forensic-workspace-public.json');assert.equal(options.credentials,'omit');return {ok:true,json:async()=>data}};
  runInNewContext(js,{document,fetch,AbortController,clearTimeout,setTimeout,URL,window:{open:url=>{opened.push(url);return {}}}});
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(root.children.length,8);
  const badge=root.children[2],toolbar=root.children[3],area=root.children[4];
  assert.match(badge.textContent,/26/);
  assert.equal(area.children[0].tagName,'table');
  assert.equal(area.children[0].children[1].children.length,26);
  const select=toolbar.children[1];select.value='P0';select.listeners.change();
  assert.equal(area.children[0].children[1].children.length,14);
  select.value='P1';select.listeners.change();
  assert.equal(area.children[0].children[1].children.length,12);
  const input=toolbar.children[0];input.value='foobar-nonexisting';input.listeners.input();
  assert.equal(area.children[0].tagName,'p');
  const integration=root.children[7],bar=integration.children[2],privateUrl=bar.children[0],open=bar.children[1];
  privateUrl.value='http://example.com/';
  open.onclick();
  assert.equal(opened.length,0);
  assert.match(bar.children[2].textContent,/HTTPS/);
});
