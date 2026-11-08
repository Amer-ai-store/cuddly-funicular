'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('standalone export monitor and central integration are wired',()=>{
  const page=read('dashboard/jawafa-export-monitor.html');
  const index=read('dashboard/index.html');
  const integration=read('dashboard/jawafa-integration.js');
  const bridge=read('jawafa-command-bridge/server.cjs');
  assert.match(page,/\/api\/jawafa\/v1\/export-status/);
  assert.match(page,/jawafa\.export\.monitor\.v1/);
  assert.match(index,/data-view="jawafa-export"/);
  assert.match(index,/\["jawafa-export","مراقبة التصدير"\]/);
  assert.match(integration,/"jawafa-export"/);
  assert.match(integration,/export-status/);
  assert.match(bridge,/\/api\/jawafa\/v1\/export-status/);
  assert.match(bridge,/jawafa\.export\.monitor\.v1/);
});