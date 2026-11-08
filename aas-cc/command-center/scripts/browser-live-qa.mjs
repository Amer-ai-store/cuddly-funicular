import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Browser tooling can live outside the shipped application dependencies.
const { chromium }=await import(pathToFileURL(process.env.AAS_PLAYWRIGHT_MODULE||'/tmp/aas-qa/node_modules/playwright/index.mjs').href);
const base=process.env.AAS_QA_URL||'http://127.0.0.1:3001';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('This mutation QA is restricted to the local development workspace.');
const stamp=Date.now().toString(36);
const report={startedAt:new Date().toISOString(),base,checks:[],browserErrors:[]};
const browser=await chromium.launch({executablePath:process.env.AAS_CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const first=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const second=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await first.newPage(),peer=await second.newPage();
for(const target of [page,peer])target.on('pageerror',error=>report.browserErrors.push(error.message));
const getState=async()=>{const response=await first.request.get(base+'/api/v1/state');assert.equal(response.status(),200);return response.json();};
let initial;
let taskId,workspaceId,serverId;
async function check(name,fn){try{await fn();report.checks.push({name,ok:true});console.log('PASS '+name);}catch(error){report.checks.push({name,ok:false,error:error.message});console.log('FAIL '+name+': '+error.message);}}
const waitIdle=async(target=page)=>{await target.waitForFunction(()=>document.querySelector('#connection-status')?.textContent==='متصل بالخادم');};
async function go(route,target=page){await target.goto(base+'/#'+route);await target.locator('#content h1').waitFor();await waitIdle(target);}
async function submit(form){await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/v1/actions')&&response.request().method()==='POST'),page.locator(form+' button[type=submit]').click()]);await waitIdle();}
try {
  await go('overview');await go('overview',peer);initial=(await getState()).state;
  await check('live bootstrap, empty runs, and unauthenticated service rejection',async()=>{
    assert.equal(await page.locator('#connection-status').textContent(),'متصل بالخادم');
    assert.equal(initial.demoMode,false);assert.equal(initial.schemaVersion,2);assert.equal(initial.runs.length,0);
    const unauth=await fetch('http://127.0.0.1:3000/api/v1/state');assert.equal(unauth.status,401);
  });
  await check('create review task, automatic approval and locked edits',async()=>{
    await page.locator('[data-action=new-task]').first().click();
    await page.locator('#task-title').fill('QA مراجعة '+stamp);await page.locator('#task-description').fill('مهمة تحقق متصفح');await page.locator('#task-status').selectOption('review');
    await submit('#task-form');await page.waitForFunction(()=>!document.querySelector('#modal').open);
    const current=await getState();const task=current.state.tasks.find(task=>task.title==='QA مراجعة '+stamp);assert.ok(task);taskId=task.id;
    const approval=current.state.approvals.find(approval=>approval.taskId===taskId);assert.equal(approval.status,'pending');
    await go('tasks');await page.locator('[data-action=task-detail][data-id="'+taskId+'"]').first().click();
    assert.equal(await page.locator('#detail-status').isDisabled(),true);assert.equal(await page.locator('#detail-title').getAttribute('readonly'),'');
    assert.equal(await page.locator('#task-status-form button[type=submit]').count(),0);
    const blocked=await first.request.post(base+'/api/v1/actions',{data:{operation:'updateTask',payload:{id:taskId,patch:{status:'done'}},expectedRevision:current.revision}});assert.equal(blocked.status(),422);
    await page.locator('[data-action=close-modal]').first().click();
  });
  await check('approve task, edit persisted content and status',async()=>{
    assert.ok(taskId);const current=await getState();const approval=current.state.approvals.find(approval=>approval.taskId===taskId);
    await go('approvals');await page.locator('[data-action=approve][data-id="'+approval.id+'"]').click();await waitIdle();
    assert.equal((await getState()).state.tasks.find(task=>task.id===taskId).status,'queued');
    await go('tasks');await page.locator('[data-action=task-detail][data-id="'+taskId+'"]').first().click();await page.locator('#detail-title').fill('QA معدّلة '+stamp);await page.locator('#detail-description').fill('تفاصيل محفوظة');await page.locator('#detail-status').selectOption('done');
    await submit('#task-status-form');const task=(await getState()).state.tasks.find(task=>task.id===taskId);assert.equal(task.title,'QA معدّلة '+stamp);assert.equal(task.description,'تفاصيل محفوظة');assert.equal(task.status,'done');
  });
  await check('create and edit workspace, add server-backed team note',async()=>{
    await go('workspaces');await page.locator('[data-action=new-workspace]').first().click();await page.locator('#workspace-name').fill('QA مساحة '+stamp);await page.locator('input[name=agentIds]').first().check();await submit('#workspace-form');
    const workspace=(await getState()).state.workspaces.find(workspace=>workspace.name==='QA مساحة '+stamp);assert.ok(workspace);workspaceId=workspace.id;
    await go('workspaces/'+workspaceId);await page.locator('[data-action=edit-workspace]').first().click();await page.locator('#workspace-name').fill('QA مساحة معدّلة '+stamp);await page.locator('#workspace-description').fill('فريق متصفح حي');await submit('#workspace-form');
    await page.locator('#note-form textarea').fill('ملاحظة فعلية '+stamp);await submit('#note-form');
    const persisted=(await getState()).state.workspaces.find(workspace=>workspace.id===workspaceId);assert.equal(persisted.description,'فريق متصفح حي');assert.equal(persisted.notes[0].body,'ملاحظة فعلية '+stamp);assert.equal(await page.locator('#note-form textarea').inputValue(),'');
    await peer.goto(base+'/#workspaces/'+workspaceId);await peer.locator('.note-item').filter({hasText:'ملاحظة فعلية '+stamp}).waitFor();
    await page.locator('#note-form textarea').fill('ملاحظة ثانية '+stamp);await page.locator('#note-form button[type=submit]').click();
    await page.locator('.note-item').filter({hasText:'ملاحظة ثانية '+stamp}).waitFor({timeout:5000});
    assert.equal((await getState()).state.workspaces.find(workspace=>workspace.id===workspaceId).notes.length,2);
  });
  await check('edit organizational agent without claiming inference',async()=>{
    await go('agents');const agent=initial.agents[0];await page.locator('[data-action=agent-detail][data-id="'+agent.id+'"]').first().click();await page.locator('[data-action=edit-agent]').click();await page.locator('#agent-form input[name=name]').fill('QA وكيل '+stamp);await page.locator('#agent-form input[name=role]').fill('مراجعة أعمال المتجر');await page.locator('#agent-form select[name=status]').selectOption('paused');await submit('#agent-form');
    const persisted=(await getState()).state.agents.find(record=>record.id===agent.id);assert.equal(persisted.name,'QA وكيل '+stamp);assert.equal(persisted.status,'paused');assert.equal(persisted.model,'غير متصل');assert.equal((await getState()).state.runs.length,0);
  });
  await check('two independent sessions sync revisions while preserving settings draft',async()=>{
    await go('settings',peer);await peer.locator('#owner-name').fill('مسودة محفوظة '+stamp);
    await go('settings');await page.locator('#store-name').fill('QA متجر '+stamp);await submit('#settings-form');
    const expected=(await getState()).revision;await peer.waitForFunction(revision=>document.querySelector('#sync-time')?.textContent.length>0,expected);await peer.waitForTimeout(3500);
    assert.equal(await peer.locator('#owner-name').inputValue(),'مسودة محفوظة '+stamp);
    await peer.locator('#settings-form button[type=submit]').click();await peer.locator('.toast.error').filter({hasText:'تغيّرت بيانات المؤسسة'}).waitFor({timeout:5000});
    assert.equal((await getState()).state.settings.storeName,'QA متجر '+stamp);
    assert.notEqual((await getState()).state.settings.ownerName,'مسودة محفوظة '+stamp);
    await page.locator('#owner-name').fill('QA مدير '+stamp);await page.locator('#settings-form button[type=submit]').click();
    await page.waitForFunction(name=>document.querySelector('.user-card strong')?.textContent===name,'QA مدير '+stamp,{timeout:5000});
    assert.equal((await getState()).state.settings.ownerName,'QA مدير '+stamp);
    await peer.goto(base+'/#overview');await peer.locator('.workspace-switch strong').filter({hasText:'QA متجر '+stamp}).waitFor();
  });
  await check('server API configuration edits and honest policy-blocked health check',async()=>{
    await go('integrations');await page.locator('[data-action=new-server]').first().click();await page.locator('#server-form input[name=name]').fill('QA خادم '+stamp);await page.locator('#server-form input[name=baseUrl]').fill('https://shop-qa.example/');await page.locator('#server-form input[name=apiPrefix]').fill('/api/v2');await submit('#server-form');
    const server=(await getState()).state.servers.find(server=>server.name==='QA خادم '+stamp);assert.ok(server);serverId=server.id;assert.equal(server.status,'unverified');
    await page.locator('[data-action=edit-server][data-id="'+serverId+'"]').click();await page.locator('#server-form input[name=apiPrefix]').fill('/api/v3');await submit('#server-form');assert.equal((await getState()).state.servers.find(server=>server.id===serverId).apiPrefix,'/api/v3');
    const responsePromise=page.waitForResponse(response=>response.url().includes('/servers/'+serverId+'/check'));await page.locator('[data-action=check-server][data-id="'+serverId+'"]').click();const response=await responsePromise;assert.equal(response.status(),403);await page.locator('.toast.error').filter({hasText:'AAS_ALLOWED_SERVER_ORIGINS'}).waitFor();await waitIdle();
    assert.equal((await getState()).state.servers.find(server=>server.id===serverId).status,'unverified');assert.equal(await page.locator('[data-action=new-server]').first().isEnabled(),true);
  });
  await check('JSON export downloads live schema and import validates on server',async()=>{
    await go('settings');const downloadPromise=page.waitForEvent('download');await page.locator('[data-action=export]').first().click();const download=await downloadPromise;const content=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(content.schemaVersion,2);assert.equal(content.demoMode,false);assert.ok(content.tasks.some(task=>task.id===taskId));
    await page.locator('#import-file').setInputFiles({name:'aas-qa-live.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(content))});await page.locator('[data-action=confirm-import]').waitFor();const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/v1/actions')&&response.request().method()==='POST');await page.locator('[data-action=confirm-import]').click();const response=await responsePromise;assert.equal(response.status(),200);await waitIdle();assert.equal((await getState()).state.demoMode,false);
  });
  await check('offline locks mutations, keeps last state, then reconnects',async()=>{
    await go('tasks');await first.setOffline(true);await page.waitForFunction(()=>document.querySelector('#connection-status')?.classList.contains('offline'),{},{timeout:12000});assert.equal(await page.locator('[data-action=new-task]').first().isDisabled(),true);assert.equal(await page.locator('#connection-banner').isVisible(),true);assert.ok(await page.locator('button.task-title').count());
    await first.setOffline(false);await page.locator('[data-action=retry-connection]').click();await waitIdle();assert.equal(await page.locator('[data-action=new-task]').first().isEnabled(),true);
  });
  await check('delete UI removes task, empty workspace and server with confirmation',async()=>{
    await go('tasks');await page.locator('[data-action=task-detail][data-id="'+taskId+'"]').first().click();await page.locator('[data-action=delete-task]').click();await page.locator('[data-action=confirm-delete]').click();await waitIdle();assert.ok(!(await getState()).state.tasks.some(task=>task.id===taskId));
    await go('workspaces/'+workspaceId);await page.locator('[data-action=edit-workspace]').first().click();await page.locator('[data-action=delete-workspace]').click();await page.locator('[data-action=confirm-delete]').click();await waitIdle();assert.ok(!(await getState()).state.workspaces.some(workspace=>workspace.id===workspaceId));
    await go('integrations');await page.locator('[data-action=delete-server][data-id="'+serverId+'"]').click();await page.locator('[data-action=confirm-delete]').click();await waitIdle();assert.ok(!(await getState()).state.servers.some(server=>server.id===serverId));
  });
  await check('390px RTL: all navigation screens fit viewport',async()=>{
    await page.setViewportSize({width:390,height:844});
    for(const route of ['overview','workspaces','tasks','agents','approvals','activity','commerce','integrations','settings']){await go(route);await page.evaluate(()=>document.fonts.ready);const metrics=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,dir:document.documentElement.dir}));assert.equal(metrics.dir,'rtl');assert.ok(metrics.scroll<=metrics.client+1,route+' scroll '+metrics.scroll+' > '+metrics.client);}
  });
  await check('no browser runtime errors',async()=>assert.deepEqual(report.browserErrors,[]));
} finally {
  // Restore the local test baseline; production sites are explicitly rejected above.
  if(initial){try{const current=await getState();const response=await first.request.post(base+'/api/v1/actions',{data:{operation:'importData',payload:{data:initial},expectedRevision:current.revision}});report.cleanup={ok:response.ok(),status:response.status()};}catch(error){report.cleanup={ok:false,error:error.message};}}
  report.finishedAt=new Date().toISOString();await writeFile('/tmp/aas-browser-live-report.json',JSON.stringify(report,null,2));await browser.close();
}
if(report.checks.some(check=>!check.ok)||!report.cleanup?.ok)process.exitCode=1;
