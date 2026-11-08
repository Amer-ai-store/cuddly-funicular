import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { analyzeRepositorySource } from '../server/source-analysis.mjs';
import { REPOSITORY } from '../server/github-cache.mjs';

const sha='a'.repeat(40),checkedAt='2026-10-17T01:00:00.000Z';
const prefix=REPOSITORY.split('/')[1]+'-'+sha+'/';
function archive(files={}){return zipSync(Object.fromEntries(Object.entries(files).map(([name,content])=>[prefix+name,typeof content==='string'?strToU8(content):content])),{level:6});}
function response(bytes){return new Response(bytes,{headers:{'Content-Type':'application/zip'}});}
const analyze=(bytes,patch={})=>analyzeRepositorySource({sourceRevision:sha,now:checkedAt,fetchImpl:async()=>response(bytes),...patch});
const fixture={
  'README.md':'# Android fixture\nRead only.\n',
  'app/build.gradle.kts':'android {\n buildTypes {\n release {\n isMinifyEnabled = false\n }\n }\n}\n',
  'app/src/main/AndroidManifest.xml':'<manifest><uses-permission android:name="android.permission.READ_CONTACTS"/><application android:usesCleartextTraffic="true"/></manifest>',
  'app/src/main/java/ModelService.kt':'object ModelService {\n fun generate(): String {\n val apiKey = BuildConfig.GEMINI_API_KEY\n val url = "https://provider.example/generateContent?key=$apiKey"\n return getOfflineMockResponse("prompt")\n }\n}\n',
  'src/future/Extra.kt':'package source\nfun newerFile() = true\n',
  'package-lock.json':'{"fixture":"excluded lock"}',
  'assets/image.png':new Uint8Array([0,255,20,0]),
  '.env':'DO_NOT_RETURN_THIS_CREDENTIAL=fixture-private-value',
};

test('complete SHA-pinned archive covers every eligible text file and records actual static findings without execution',async()=>{
  let observed;
  const result=await analyze(archive(fixture),{fetchImpl:async(url,options)=>{observed={url,options};return response(archive(fixture));}});
  assert.equal(observed.url,'https://codeload.github.com/'+REPOSITORY+'/zip/'+sha);
  assert.equal(observed.options.redirect,'manual');assert.equal(observed.options.method,'GET');
  assert.ok(!Object.hasOwn(observed.options.headers,'Authorization'));
  assert.equal(result.sourceRevision,sha);assert.equal(result.outcome,'passed');
  assert.equal(result.report.execution,false);assert.equal(result.report.modification,false);
  assert.equal(result.report.checkedAt,checkedAt);assert.equal(result.report.coverage.complete,true);
  assert.equal(result.report.coverage.analyzedFiles,5);assert.equal(result.report.coverage.excludedFiles,3);
  assert.ok(result.report.files.some(file=>file.path==='src/future/Extra.kt'));
  assert.ok(result.report.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)&&file.url.includes('/blob/'+sha+'/')));
  assert.deepEqual(new Set(result.report.findings.map(item=>item.id)),new Set(['ai-mock-fallback','client-provider-key','provider-key-query','release-minification-off','sensitive-android-permissions','cleartext-traffic-enabled']));
  const provider=result.report.findings.find(item=>item.id==='client-provider-key');
  assert.equal(provider.evidence[0].line,3);assert.ok(provider.evidence[0].url.endsWith('#L3'));
  assert.ok(result.evidence.length<=10);assert.ok(result.evidence.filter(item=>item.content).every(item=>item.content.length<=8000));
  for(const item of result.evidence.filter(item=>item.content)){
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',strToU8(item.content)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    assert.equal(item.sha256,digest);
  }
  assert.ok(!JSON.stringify(result).includes('fixture-private-value'));
  assert.ok(!JSON.stringify(result).includes('https://provider.example'));
});

test('comments do not create findings and unchanged source hashes are independent of the observation time',async()=>{
  const files={'app/Quiet.kt':'// return getOfflineMockResponse("x")\n/* nested /* harmless */ BuildConfig.GEMINI_API_KEY */\nval explanation = "BuildConfig.GEMINI_API_KEY"\nval example = """return getOfflineMockResponse("sample")"""\nfun ordinary() = "safe"\n','README.md':'BuildConfig.GEMINI_API_KEY is discussed in documentation.'};
  const bytes=archive(files),first=await analyze(bytes),second=await analyze(bytes,{now:'2026-10-17T02:00:00Z'});
  assert.equal(first.report.findings.length,0);assert.notEqual(first.report.checkedAt,second.report.checkedAt);
  assert.equal(first.report.archiveSha256,second.report.archiveSha256);
  assert.equal(first.report.manifestSha256,second.report.manifestSha256);
  assert.deepEqual(first.report.files,second.report.files);
});

test('invalid revisions, redirects and non-ZIP upstream errors fail before a completed audit',async()=>{
  let calls=0;
  for(const sourceRevision of ['main','../main',sha+'/../x','https://other.example/file',null,'a'.repeat(39)]){
    await assert.rejects(analyzeRepositorySource({sourceRevision,fetchImpl:async()=>{calls++;return response(archive(fixture));}}),error=>error.code==='source_revision_invalid');
  }
  assert.equal(calls,0);
  for(const upstream of [new Response(null,{status:302,headers:{Location:'https://other.example/private'}}),new Response('private upstream failure',{status:500}),new Response('private upstream HTML',{headers:{'Content-Type':'text/html'}})]){
    await assert.rejects(analyze(archive(fixture),{fetchImpl:async()=>upstream}),error=>error.code==='source_unavailable'&&!error.message.includes('private upstream'));
  }
});

test('truncated ZIPs, traversal, duplicate-root mismatches and invalid UTF-8 cannot claim complete source coverage',async()=>{
  const bytes=archive({'app/Valid.kt':'fun valid() = true'});
  const corrupt=new Uint8Array(bytes);corrupt[0]=0;
  for(const bad of [bytes.subarray(0,bytes.length-1),corrupt,archive({'../escape.kt':'unsafe'}),zipSync({'OtherRepo-main/app/Valid.kt':strToU8('unsafe')}),archive({'app/Bad.kt':new Uint8Array([0xc0,0x80])}),archive({'app/Nul.kt':new Uint8Array([1,0,2])})]){
    await assert.rejects(analyze(bad),error=>error.code==='source_archive_invalid');
  }
});

test('compressed, total decoded, individual text-file and entry-count limits fail closed',async()=>{
  const many=Object.fromEntries(Array.from({length:513},(_,i)=>['app/F'+i+'.kt','fun test() = true']));
  const tooLargeTotal=Object.fromEntries(Array.from({length:97},(_,i)=>['app/F'+i+'.kt','x'.repeat(128*1024)]));
  for(const bytes of [archive({'app/Large.kt':'x'.repeat(1024*1024+1)}),archive(many),archive(tooLargeTotal)])await assert.rejects(analyze(bytes),error=>error.code==='source_analysis_limit');
  await assert.rejects(analyze(archive(fixture),{fetchImpl:async()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'Content-Type':'application/zip'}})}),error=>error.code==='source_analysis_limit');
  await assert.rejects(analyze(archive(fixture),{fetchImpl:async()=>new Response('x',{headers:{'Content-Type':'application/zip','Content-Length':String(5*1024*1024+1)}})}),error=>error.code==='source_analysis_limit');
});

test('CRC mismatch cannot be turned into successful source evidence',async()=>{
  const bytes=zipSync({[prefix+'app/Valid.kt']:strToU8('fun valid() = true')},{level:0});
  // Stored file bytes begin after the local ZIP header and filename.
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const offset=30+view.getUint16(26,true)+view.getUint16(28,true);bytes[offset]^=1;
  await assert.rejects(analyze(bytes),error=>error.code==='source_archive_invalid');
});

test('whole-operation deadline aborts a stalled archive download without exposing transport errors',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});let signal,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const pending=analyzeRepositorySource({sourceRevision:sha,fetchImpl:async(_url,options)=>{signal=options.signal;started();return new Promise(()=>{});}});
  await ready;context.mock.timers.tick(19999);assert.equal(signal.aborted,false);context.mock.timers.tick(1);
  await assert.rejects(pending,error=>error.code==='source_analysis_timeout'&&error.status===504);assert.equal(signal.aborted,true);
});
