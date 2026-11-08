import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash, webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import {runInNewContext,Script} from 'node:vm';
import {OFFICIAL_AGENTS} from '../aas/official-agent-roster.mjs';

const root=resolve('dashboard');
const txt=(path)=>readFileSync(resolve(root,path),'utf8');
const index=txt('index.html'),manifest=JSON.parse(txt('aas/integration-manifest.json'));
const report=JSON.parse(txt('data/central-transfer-audit.json'));
const roster=txt('aas-roster.html'),jawafa=txt('jawafa-integration.js'),trust=txt('trustsoft/app.js');
const source=txt('central-transfer-audit.mjs');
const navMatch=index.match(/  const NAV = (\[[\s\S]*?\n  \]);\n  const VIEWS/);
assert.ok(navMatch,'native menu source is available');
const nav=runInNewContext('('+navMatch[1]+')');
const navRoutes=nav.flatMap(([,items])=>items.map(([route])=>route));
const viewSet=new Set([...index.matchAll(/data-view="([^"]+)"/g)].map(x=>x[1]));
const jawafaBlock=jawafa.match(/const PAGES=(\{[\s\S]*?\});\nconst TITLES/);
assert.ok(jawafaBlock,'Jawafa integration routes exist');
const jawafaRoutes=[...jawafaBlock[1].matchAll(/^"([^"]+)":\{/gm)].map(x=>x[1]);

test('canonical dashboard routes all 14 AAS screens and 17 Jawafa panes',()=>{
  assert.equal(nav.length,report.public_inventory.main_groups);
  // Snapshot inventory describes the previously published dashboard. Count
  // proposed views only for structural CI; do not claim them as published.
  const proposedViews=['project-messages','cca999-task-flow']
    .filter(id=>navRoutes.includes(id)&&viewSet.has(id)).length;
  assert.equal(viewSet.size,report.public_inventory.main_native_views+proposedViews);
  assert.equal(navRoutes.length,report.public_inventory.main_navigation_destinations+proposedViews);
  assert.equal(manifest.routes.length,14);
  assert.equal(new Set(manifest.routes).size,14);
  assert.ok(manifest.routes.every(x=>navRoutes.includes('aas-'+x)),'all AAS routes must be navigable');
  assert.ok(index.includes('id="aas-live-frame"'));
  assert.ok(jawafaRoutes.every(x=>navRoutes.includes(x)&&viewSet.has(x)),'Jawafa pages must be rooted in real screens');
  assert.equal(jawafaRoutes.length,report.public_inventory.jawafa_existing_panes);
  assert.ok(index.includes('id="trustsoft-frame"'));
  assert.ok(index.includes('trustsoft/host-integration.js'));
  assert.ok(index.includes('aas-integration.js'));
});

test('AAS manifest includes every declared local asset without falsely importing private data',()=>{
  assert.equal(manifest.format,'aas-cc-integrated-client-v1');
  assert.equal(manifest.productionDataCopied,false);
  assert.equal(manifest.credentialsCopied,false);
  assert.equal(manifest.files.length,report.public_inventory.aas_manifest_files);
  assert.equal(manifest.files.length,17);
  assert.equal(new Set(manifest.files.map(f=>f.path)).size,17);
  for(const f of manifest.files){
    assert.match(f.path,/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/);
    assert.ok(!f.path.includes('..'));
    assert.ok(existsSync(resolve(root,'aas',f.path)), 'Missing AAS asset '+f.path);
    assert.match(f.sha256,/^[a-f0-9]{64}$/i);
  }
});

test('official and organizational agents exist in source and NEVER claim an active LLM by name alone',()=>{
  assert.equal(OFFICIAL_AGENTS.length,report.public_inventory.official_agent_definitions);
  assert.equal(new Set(OFFICIAL_AGENTS.map(a=>a.id)).size,19);
  assert.ok(OFFICIAL_AGENTS.every(a=>a.model==='غير متصل'));
  assert.equal([...roster.matchAll(/data-source="official"/g)].length,19);
  assert.equal([...roster.matchAll(/data-source="org"/g)].length,9);
  assert.equal([...roster.matchAll(/data-source="advisor"/g)].length,1);
  assert.equal(report.public_inventory.organizational_agent_profiles,9);
  assert.ok(roster.includes('aas-roster-sync.js'));
  assert.ok(report.sections.find(x=>x.id==='agents').runtime_status==='unverified');
});

test('TrustSoft static release does not pretend PR #148 accounting expansion was merged',()=>{
  const labels=trust.match(/const labels=\{([^\n]+)\};/);
  assert.ok(labels);
  const tabs=[...labels[1].matchAll(/(\w+):'/g)].map(x=>x[1]);
  assert.equal(tabs.length,report.public_inventory.trustsoft_published_sections);
  assert.ok(!tabs.includes('audit15'),'Audit15 not published in this older static TrustSoft version');
  assert.equal(report.sections.find(x=>x.id==='trustsoft').runtime_status,'pending');
  assert.equal(report.sections.find(x=>x.id==='audit15').runtime_status,'blocked');
});

test('migration audit is public status only and never exposes private evidence or bypasses acceptance',()=>{
  assert.equal(report.schema,'aas.central.transfer.audit.v1');
  assert.equal(report.scope,'PUBLIC_METADATA_ONLY_NO_PRIVATE_DB_ROWS_NO_SECRETS');
  assert.equal(report.sections.length,8);
  assert.equal(report.legacy_source_gaps.length,2);
  assert.ok(report.legacy_source_gaps.some(x=>x.source_modules.includes('src/DocumentReader.tsx')));
  assert.ok(report.legacy_source_gaps.some(x=>x.source_modules.includes('src/LiveConnection.tsx')));
  assert.ok(report.legacy_source_gaps.every(x=>x.migration_status!=='VERIFIED_MIGRATED'&&x.migration_status!=='ACCEPTED'));
  assert.equal(report.private_connection_checks.private_aas_state_http_status,401);
  assert.equal(report.private_connection_checks.owner_authenticated_read_verified,false);
  assert.equal(report.private_connection_checks.agent_runtime_verified,false);
  assert.ok(report.sections.every(x=>['verified','present','pending','blocked','unverified'].includes(x.source_status)));
  assert.ok(report.sections.every(x=>x.runtime_status!=='verified'));
  assert.ok(report.sections.every(x=>x.evidence.startsWith('dashboard/')&&!x.evidence.includes('..')));
  const literal=JSON.stringify(report);
  assert.doesNotMatch(literal,/https:\/\/(?:drive|docs)\.google\.com\//);
  assert.doesNotMatch(literal,/tail819184|C:\\\\|SQLPassword|sk-proj-|AIza[0-9a-zA-Z_-]{15}/);
  assert.match(literal,/PR #148|PR #148|#148/);
  assert.match(literal,/GATE-15/);
  assert.match(source,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(source,/credentials:'omit'/);
  assert.doesNotMatch(source,/method:\s*['"]POST['"]/);
  assert.ok(index.includes('id="central-transfer-audit-root"'));
  assert.ok(index.indexOf('id="central-transfer-audit-root"')<index.indexOf('id="release-verification-root"'),'transfer matrix is visible before the long Actions list');
  assert.ok(index.includes('central-transfer-audit.mjs'));
  new Script(source.replace(/^'use strict';/,'').replace(/^\s*\/\*[\s\S]*?\*\//,''),{filename:'transfer-coverage-inline.js'});
});

test('interactive full-public-file SHA audit button actually runs 17 same-origin GET verifications',async()=>{
  class FakeNode {
    constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.listeners={};this.disabled=false;}
    append(...values){this.children.push(...values);}
    replaceChildren(...values){this.children=values;}
    setAttribute(){}
    addEventListener(type,callback){this.listeners[type]=callback;}
  }
  const rootNode=new FakeNode('section'),calls=[];
  const bytes=new TextEncoder().encode('safe public asset test');
  const syntheticManifest={
    ...manifest,
    routes:manifest.routes,
    files:Array.from({length:17},(_,i)=>({
      path:'asset_'+i+'.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')
    }))
  };
  const response=(obj)=>({ok:true,status:200,json:async()=>obj});
  const fetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',credentials:options.credentials});
    if(String(url).includes('central-transfer-audit.json'))return response(report);
    if(String(url).includes('integration-manifest.json'))return response(syntheticManifest);
    if(String(url).includes('./aas/asset_'))return {
      ok:true,status:200,arrayBuffer:async()=>bytes.slice().buffer
    };
    throw Error('Unexpected external request '+url);
  };
  const doc={
    getElementById:id=>id==='central-transfer-audit-root'?rootNode:null,
    createElement:tag=>new FakeNode(tag)
  };
  runInNewContext(source,{document:doc,fetch,crypto:webcrypto,AbortController,setTimeout,clearTimeout,console});
  // The source performs one asynchronous status-only GET on initialization.
  await new Promise(ok=>setTimeout(ok,10));
  assert.equal(rootNode.children.length,6);
  const button=rootNode.children[5].children[0],liveMessage=rootNode.children[3];
  assert.equal(button.tag,'button');
  assert.equal(typeof button.listeners.click,'function');
  await button.listeners.click();
  assert.match(liveMessage.textContent,/17\/17/);
  assert.equal(calls.filter(x=>String(x.url).includes('./aas/asset_')).length,17);
  assert.ok(calls.every(x=>x.method==='GET'&&x.credentials==='omit'));
});
