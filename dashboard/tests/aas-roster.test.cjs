'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const folder=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(folder,'aas-roster.html'),'utf8');
const host=fs.readFileSync(path.join(folder,'index.html'),'utf8');
test('29 historical source-backed profiles and advisor in unified directory',()=>{
  assert.equal((page.match(/<article class="card"/g)||[]).length,29);
  assert.equal((page.match(/data-source="official"/g)||[]).length,19);
  assert.equal((page.match(/data-source="org"/g)||[]).length,9);
  assert.equal((page.match(/data-source="advisor"/g)||[]).length,1);
  assert.ok(page.includes('NOT RUNTIME-VERIFIED'));
});
test('central dashboard preserves source directory and AAS agent routes',()=>{
  // The source-backed roster is not a claim of live runtime verification.
  // Match the actual navigation IDs and labels; allow harmless whitespace changes.
  assert.match(host,/\["agent-directory"\s*,\s*"دليل الوكلاء"\]/);
  assert.ok(host.includes('data-view="agent-directory"'));
  assert.ok(host.includes('src="./aas-roster.html"'));
  assert.match(host,/\["aas-agents"\s*,\s*"وكلاء AAS"\]/);
});
