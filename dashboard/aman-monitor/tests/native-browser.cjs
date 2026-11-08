'use strict';
// Synthetic UI checks. Uses installed Playwright and a loopback static fixture.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const READ='synthetic_read_credential_123456789',ADMIN='synthetic_admin_credential_123456789';
const freshToken='aman_'+'A'.repeat(43);
const fixture=`<!doctype html><html dir="rtl" lang="ar"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="toast">HOST_TOAST_UNCHANGED</div><nav class="nav">HOST_NAV_UNCHANGED</nav><section class="view" data-view="jawafa-monitor"><div id="aman-access-native"></div></section><section class="view" data-view="home" hidden>HOST_HOME</section><script>window.authCallbacks=[];window.testUser={uid:'synthetic-owner',getIdToken:async()=> 'synthetic.firebase.jwt'};window.firebase={apps:[{}],auth:()=>({currentUser:window.testUser,onAuthStateChanged:fn=>{window.authCallbacks.push(fn);return ()=>window.authCallbacks=window.authCallbacks.filter(x=>x!==fn)}})};</script><script src="/aman-monitor/host-integration.js" defer></script></body></html>`;
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'text/plain');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.stack));
  let stage=1,geoCalls=0,eventCalls=0,keyActive=false,ownerHold=null;
  const record=(id,actor='synthetic-user',type='login_success')=>({id,source_id:'synthetic-server',occurred_at:new Date(Date.now()-1000).toISOString(),type,actor,ip:'8.8.8.8',session_id:'session-1',action:'Synthetic audit event',metadata:{service:'test'}});
  await page.route(/https:\/\/(monitor\.example\.test|zvedrouuboxgbanzdnio\.supabase\.co)\//,async route=>{
    const req=route.request(),url=new URL(req.url());const auth=req.headers().authorization;
    const send=async(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type'},body:JSON.stringify(data)});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST'}});
    if(url.pathname.endsWith('/events')){eventCalls++;if(url.hostname.includes('supabase')){if(ownerHold)await new Promise(resolve=>ownerHold.resolve=resolve);}else assert.equal(auth,'Bearer '+READ);return send({events:stage===1?[record('one')]:[record('one'),record('two','new-synthetic','login_failed')],sources:[{source_id:'synthetic-server',last_seen:new Date().toISOString()}]});}
    if(url.pathname.endsWith('/geo')){assert.equal(auth,'Bearer '+READ);geoCalls++;return send({approximate:true,city:'Synthetic city',latitude:25,longitude:45});}
    assert.equal(auth,'Bearer '+ADMIN);
    if(url.pathname.endsWith('/collector-key/status'))return send({active:keyActive});
    if(url.pathname.endsWith('/collector-key/revoke')){keyActive=false;return send({active:false,ok:true});}
    if(url.pathname.endsWith('/collector-key')){keyActive=true;return send({active:true,token:freshToken});}
    return send({error:'Unknown route'},404);
  });
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture#jawafa-monitor`);
    const component=page.locator('aman-monitor');await component.locator('#connectForm').waitFor({state:'attached'});
    assert.equal(await page.locator('body > #toast').textContent(),'HOST_TOAST_UNCHANGED');
    await component.locator('[data-view="activity"]').click();assert.equal(new URL(page.url()).hash,'#jawafa-monitor');
    await component.locator('#demoToggle').click();assert.equal(await component.locator('#eventRows tr').count(),6);
    await component.locator('#eventRows button').first().click();assert.equal(await component.locator('.geo-box button').isDisabled(),true);await component.locator('#closeDrawer').click();
    const imported={events:[record('imported','=1+1')]};await component.locator('#importFile').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
    await component.locator('#importNotice').waitFor();assert.equal(await component.locator('#eventRows tr').count(),1);
    const downloadEvent=page.waitForEvent('download');await component.locator('#exportButton').click();const download=await downloadEvent;const csv=fs.readFileSync(await download.path(),'utf8');assert(csv.includes("'=1+1"));
    await component.locator('.connection-panel summary').click();await component.locator('#apiBase').fill('https://monitor.example.test/security');await component.locator('#readToken').fill(READ);await component.locator('#connectButton').click();await component.locator('#dataMode').filter({hasText:'بيانات من'}).waitFor();
    assert.equal(await component.locator('#readToken').inputValue(),'');assert.equal(geoCalls,0);
    stage=2;await component.locator('#refreshButton').click();await component.locator('#toast').filter({hasText:'حدث جديد'}).waitFor();assert.equal(await component.locator('#eventRows tr').count(),2);
    await component.locator('#adminToken').fill(ADMIN);await component.locator('#keyCheck').click();await component.locator('#keyRotate:not(:disabled)').waitFor();await component.locator('#keyRotate').click();await component.locator('#keyResult').waitFor();assert.equal(await component.locator('#generatedToken').getAttribute('type'),'password');assert.equal(await component.locator('#generatedToken').inputValue(),freshToken);await component.locator('#keyReveal').click();assert.equal(await component.locator('#generatedToken').getAttribute('type'),'text');
    await component.locator('#eventRows button').first().click();await component.locator('.geo-box button').click();await component.locator('.geo-result a').waitFor();assert.equal(geoCalls,1);assert.equal(await component.locator('.geo-result a').getAttribute('href'),'https://www.google.com/maps/search/?api=1&query=25%2C45');await component.locator('#closeDrawer').click();
    await component.locator('#keyRevoke').click();await component.locator('#keyStatus').filter({hasText:'لا يوجد'}).waitFor();assert.equal(await component.locator('#generatedToken').inputValue(),'');
    await component.locator('[data-view="overview"]').click();await component.locator('#pauseButton').click();const before=eventCalls;await page.waitForTimeout(3300);assert.equal(eventCalls,before);
    await page.evaluate(()=>document.querySelector('[data-view="jawafa-monitor"]').hidden=true);await component.waitFor({state:'detached'});assert.equal(await page.locator('body > #toast').textContent(),'HOST_TOAST_UNCHANGED');assert.equal(await page.evaluate(()=>window.authCallbacks.length),0);
    await page.evaluate(()=>document.querySelector('[data-view="jawafa-monitor"]').hidden=false);await component.locator('#connectForm').waitFor({state:'attached'});assert.equal(await component.locator('#eventRows tr').count(),0);assert.equal(await component.locator('#adminToken').inputValue(),'');
    // A slow owner response cannot resurrect a signed-out monitor.
    ownerHold={};await component.locator('#ownerConnect').click();await page.waitForFunction(()=>document.querySelector('aman-monitor').shadowRoot.querySelector('#dataMode').textContent.includes('جارٍ'));await page.evaluate(()=>{window.testUser=null;window.authCallbacks.forEach(fn=>fn(null));});ownerHold.resolve?.();ownerHold=null;await page.waitForTimeout(100);assert.equal(await component.locator('#eventRows tr').count(),0);
    await page.setViewportSize({width:390,height:844});await component.locator('#demoToggle').click();await page.waitForTimeout(100);await page.screenshot({path:'/tmp/aman-native-mobile.png',fullPage:true});const bounds=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,host:document.querySelector('aman-monitor').getBoundingClientRect().toJSON(),wide:[...document.querySelector('aman-monitor').shadowRoot.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().width>innerWidth).slice(0,10).map(n=>({tag:n.tagName,id:n.id,cls:n.className,width:n.getBoundingClientRect().width}))}));assert.equal(bounds.scroll<=bounds.viewport,true,JSON.stringify(bounds));await component.locator('[data-view="overview"]').click();await page.screenshot({path:'/tmp/aman-native-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);console.log('PASS: native integration, navigation isolation, demo/import/export, live polling, event toast, owner logout, manual keys, GeoIP, teardown, mobile layout');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
