import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {escape,classify,difference,read,all,API} from '../release-verification.mjs';
test('failure and incomplete evidence never become production success',()=>{
assert.equal(classify([]),'غير مثبت');
assert.equal(classify([{conclusion:'success'},{state:'failure'}]),'يفشل');
assert.equal(classify([{conclusion:'action_required'}]),'يحتاج تحققًا إضافيًا');
assert.equal(classify([{conclusion:'skipped'}]),'يحتاج تحققًا إضافيًا');
assert.equal(classify([{conclusion:'success'}]),'مثبت');
});
test('untrusted descriptions escape markup',()=>assert.equal(escape('<img src=x onerror="x">&'), '&lt;img src=x onerror=&quot;x&quot;&gt;&amp;'));
test('missing baseline never invents a previous state',()=>assert.equal(difference(null,{state:'open'}),'لا توجد لقطة سابقة'));
test('all requests are fixed-repository credential-free GET',async()=>{
await read('pulls/125',async(url,opts)=>{assert.equal(url,API+'pulls/125');assert.equal(opts.method,'GET');assert.equal(opts.credentials,'omit');assert.equal(opts.headers.Authorization,undefined);return {ok:true,json:async()=>({})};});
await assert.rejects(read('https://example.com',()=>{throw Error('must not call');}),/غير مسموح/);
await assert.rejects(read('../secrets',()=>{throw Error('must not call');}),/غير مسموح/);
await assert.rejects(read('pulls/125',async()=>({ok:false,status:403})),/HTTP 403/);
});
test('pagination reads beyond the first hundred and fails on partial error',async()=>{
let calls=0;
const items=await all('pulls?state=all',null,async()=>({ok:true,json:async()=>++calls===1?Array.from({length:100},(_,i)=>({id:i})):[{id:100}]}));
assert.equal(items.length,101);assert.equal(calls,2);
let n=0;await assert.rejects(all('pulls?state=all',null,async()=>++n===1?{ok:true,json:async()=>Array(100).fill({})}:{ok:false,status:429}),/429/);
});
test('native integration has a physical view, navigation and agents shortcut',()=>{
const html=readFileSync('dashboard/index.html','utf8');
assert.match(html,/\["release-verification","التحقق والإصدارات"\]/);
assert.match(html,/data-view="release-verification"/);
assert.match(html,/href="#release-verification"/);
assert.match(html,/type="module" src="release-verification.mjs"/);
const js=readFileSync('dashboard/release-verification.mjs','utf8');
assert.doesNotMatch(js,/localStorage|sessionStorage|method:\s*['"](?:POST|PUT|DELETE|PATCH)/);
assert.match(js,/GATE-15/);
assert.match(js,/issues\/102/);
});
