import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const code = readFileSync(resolve(root, 'live-execution.js'), 'utf8');
const css = readFileSync(resolve(root, 'live-execution.css'), 'utf8');

class Node {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.disabled = false;
    this.events = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, fn) { this.events[type] = fn; }
  querySelector() { return null; }
}
function launch(fetchFn) {
  const ids = [
    'execution-evidence-state', 'execution-evidence-checked', 'execution-evidence-rows',
    'execution-evidence-refresh', 'execution-evidence-active', 'execution-evidence-pending',
    'execution-evidence-failed', 'execution-evidence-checked-runs'
  ];
  const lookup = Object.fromEntries(ids.map(id => [id, new Node()]));
  const container = new Node();
  container.querySelector = selector => lookup[selector.slice(1)] || null;
  const events = {};
  const document = {
    hidden:false, createElement: tag => new Node(tag),
    getElementById: id => id === 'execution-evidence' ? container : null,
    addEventListener: (event, listener) => { events[event] = listener; }
  };
  const window = {
    setTimeout:()=>1, clearTimeout:()=>{}, setInterval:(fn)=>{events.poll=fn;return 1;}
  };
  let called = 0;
  runInNewContext(code, {
    document, window,
    fetch: (...args)=>{called++; return fetchFn(...args);},
    Date, Intl, AbortController,
  });
  return {document, window, lookup, events, called:()=>called};
}
const tick = () => new Promise(resolve=>setTimeout(resolve,20));
function run(status, conclusion, idx, updated=new Date().toISOString()) {
  return {id:idx, run_number:idx, status, conclusion, name:'Test workflow '+idx,
    updated_at:updated, head_branch:'main',
    html_url:'https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/actions/runs/'+idx };
}
test('homepage has the evidence panel and direct source links',()=>{
  assert.match(html,/id="execution-evidence"/);
  assert.match(html,/id="execution-evidence-state"/);
  assert.match(html,/src="live-execution\.js" defer/);
  assert.match(html,/href="\.\/live-execution\.css"/);
  assert.match(html,/لا تستطيع مراقبة تفكير ChatGPT/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('success and failure are shown only from actual GitHub API runs',async()=>{
  const v=launch(async()=>({ok:true,json:async()=>({workflow_runs:[
    run('in_progress',null,101),
    run('completed','failure',102),
    run('queued',null,103),
  ]})}));
  await tick();
  assert.equal(v.called(),1);
  assert.equal(v.lookup['execution-evidence-active'].textContent,'1');
  assert.equal(v.lookup['execution-evidence-pending'].textContent,'1');
  assert.equal(v.lookup['execution-evidence-failed'].textContent,'1');
  assert.equal(v.lookup['execution-evidence-state'].dataset.state,'active');
  assert.equal(v.lookup['execution-evidence-rows'].children.length,3);
  const row=v.lookup['execution-evidence-rows'].children[0];
  assert.equal(row.children[2].href,'https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/actions/runs/101');
});
test('completed workflows never masquerade as running',async()=>{
  const v=launch(async()=>({ok:true,json:async()=>({workflow_runs:[run('completed','success',201)]})}));
  await tick();
  assert.equal(v.lookup['execution-evidence-active'].textContent,'0');
  assert.equal(v.lookup['execution-evidence-state'].dataset.state,'idle');
  assert.match(v.lookup['execution-evidence-state'].textContent,/لا توجد عملية نشطة/);
});
test('stale in_progress runs cannot receive a green running indicator',async()=>{
  const old=new Date(Date.now()-65*60*1000).toISOString();
  const v=launch(async()=>({ok:true,json:async()=>({workflow_runs:[run('in_progress',null,302,old)]})}));
  await tick();
  assert.equal(v.lookup['execution-evidence-active'].textContent,'0');
  assert.equal(v.lookup['execution-evidence-state'].dataset.state,'stale');
});
test('failed source never keeps a prior successful result',async()=>{
  let fail=false;
  const v=launch(async()=>fail ? {ok:false,status:403} :
    {ok:true,json:async()=>({workflow_runs:[run('in_progress',null,401)]})});
  await tick();
  assert.equal(v.lookup['execution-evidence-active'].textContent,'1');
  fail=true;
  v.lookup['execution-evidence-refresh'].events.click();
  await tick();
  assert.equal(v.lookup['execution-evidence-state'].dataset.state,'error');
  assert.equal(v.lookup['execution-evidence-active'].textContent,'—');
  assert.match(v.lookup['execution-evidence-checked'].textContent,/فشل الاتصال/);
});
test('no SQL or fake ChatGPT progress API',()=>{
  assert.doesNotMatch(code,/127\.0\.0\.1|password|api\/tables|think(?:ing)?-status/);
  assert.match(code,/https:\/\/api\.github\.com\/repos/);
  assert.match(code,/document\.hidden/);
});
