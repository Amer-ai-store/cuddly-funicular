import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../../dashboard');
const read=name=>readFileSync(resolve(dir,name),'utf8');
const html=read('index.html'),home=read('command-home.js'),css=read('command-home.css'),integration=read('luqta-integration.js');

test('unified homepage contains six functional zones without discarding existing operational screens',()=>{
  const zoneNames=['workbench','commerce','inventory','investigation','operations','development'];
  for(const name of zoneNames)assert.match(html,new RegExp('data-zone="'+name+'"'));
  assert.equal((html.match(/class="command-zone" data-zone=/g)||[]).length,6);
  for(const id of ['jawafa','jawafa-monitor','jawafa-backups','jawafa-export','luqta','aas-overview','tasks'])
    assert.ok(html.includes('["'+id+'",'),id+' navigation missing');
  assert.match(html,/id="nav-group-cards"/);
  assert.match(html,/id="home-priority"/);
  assert.match(html,/id="home-stages"/);
});
test('application bridge links to actual same-page Luqta workbench route',()=>{
  assert.match(html,/\["luqta\/workspace","استوديو بيئة التطبيق"\]/);
  assert.match(html,/href="#luqta\/workspace"/);
  assert.match(integration,/\["workspace", "استوديو بيئة التطبيق"\]/);
  assert.match(integration,/workspace: renderWorkspace/);
  assert.match(integration,/window\.dispatchEvent\(new CustomEvent\("luqta:bridge-state"/);
  assert.match(home,/window\.addEventListener\("luqta:bridge-state"/);
});
test('workbench has authenticated real APIs, code review links and an explicit nondeployment warning',()=>{
  assert.match(integration,/client\.request\("POST","\/admin\/agent-jobs"/);
  assert.match(integration,/client\.request\("GET","\/admin\/jawafa\/source"/);
  assert.match(integration,/client\.request\("GET", "\/health"\)/);
  assert.match(integration,/renderAppearance\(\{settings:data\.settings/);
  assert.match(integration,/لا يعني ذلك أن الكود تغير أو نُشر/);
  assert.match(integration,/https:\/\/github\.com\/Amer-ai-store\/Mohammad-Ahmed-Ghannam/);
  assert.ok(!integration.includes('localStorage.setItem("luqta-token"'));
});
test('custom home preferences cannot modify authenticated backend',()=>{
  assert.match(home,/jawafa-command-home-layout-v1/);
  assert.match(home,/data-zone-move/);
  assert.ok(!home.includes('fetch('));
  assert.ok(!home.includes('/admin/'));
  assert.match(html,/id="home-layout-reset"/);
  assert.match(html,/id="home-density"/);
  assert.match(css,/@media \(max-width:680px\)/);
});
test('home scripts are correctly loaded before authenticated client scripts',()=>{
  const order=['command-home.js','luqta-api.js','luqta-integration.js'].map(name=>html.indexOf('src="'+name+'"'));
  assert.ok(order.every(index=>index>=0));
  assert.ok(order[0]<order[1]&&order[1]<order[2]);
  assert.match(html,/href="\.\/command-home\.css"/);
});
