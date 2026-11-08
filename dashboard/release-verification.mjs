
export const REPO='Amer-ai-store/Mohammad-Ahmed-Ghannam';
export const API='https://api.github.com/repos/'+REPO+'/';
export function escape(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function classify(checks=[]){if(!checks.length)return 'غير مثبت';if(checks.some(x=>['failure','error','timed_out'].includes(x.conclusion||x.state)))return 'يفشل';if(checks.every(x=>(x.conclusion||x.state)==='success'))return 'مثبت';return 'يحتاج تحققًا إضافيًا';}
export function difference(old,now){if(!old)return 'لا توجد لقطة سابقة';return (old.conclusion||old.state||old.sha||'غير متوفر')+' ← '+(now.conclusion||now.state||now.sha||'غير متوفر');}
export async function read(path,transport=fetch){if(!/^(pulls|issues|actions|contents|commits|environments|deployments)(\/|\?)/.test(path)||path.includes('..')||path.includes('://'))throw Error('مسار قراءة غير مسموح');const r=await transport(API+path,{method:'GET',credentials:'omit',headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('GitHub HTTP '+r.status+' — لم يكتمل التحقق');return r.json();}
export async function all(path,key,transport=fetch){let out=[];for(let p=1;p<=100;p++){const r=await read(path+(path.includes('?')?'&':'?')+'per_page=100&page='+p,transport),a=key?r[key]:r;if(!Array.isArray(a))throw Error('صيغة غير متوقعة');out.push(...a);if(a.length<100)return out;}throw Error('الفهرس أكبر من حد القراءة؛ لم يُعتمد كاملًا');}
if(typeof document!=='undefined'){
const root=document.getElementById('release-verification-root');
if(root){
const e=escape,$=id=>document.getElementById('rv-'+id);
const stamp=t=>t?new Date(t).toLocaleString('ar-JO',{timeZone:'Asia/Amman'}):'غير متوفر';
const safeLink=(u,label)=>{try{const url=new URL(u);return url.protocol==='https:'&&['github.com','api.github.com','vercel.com'].includes(url.hostname)?'<a target="_blank" rel="noopener noreferrer" href="'+e(u)+'">'+e(label||'المصدر')+' ↗</a>':'';}catch{return '';}};
let state={schema:1,repo:REPO,at:null,prs:[],runs:[],workflows:[],issues:[],details:{},totalRuns:0},previous=null,tab='prs',busy=false,runPage=1;
const project=x=>/luqta|لُقطة|لقطة/i.test((x.title||'')+' '+(x.name||''))?'لقطة':/jawafa|جوافة|trustsoft|aman/i.test((x.title||'')+' '+(x.name||''))?'جوافة':'عامر';
const env=x=>/pages/i.test(x.name||x.path||'')?'GitHub Pages':/vercel/i.test(x.name||'')?'Vercel':/cloudflare/i.test(x.name||'')?'Cloudflare':x.head_sha?'CI':'غير محددة';
const status=x=>x.head_sha?classify([{conclusion:x.conclusion}]):x.head?classify(state.details[x.number]?.checks||[]):'يحتاج تحققًا إضافيًا';
const gates=[
['PR #125','فحص HEAD الحالي وملفاته ومراجعاته وحالات DCO وVercel.','125'],
['Issue #102','مراجعة توجيه النشر ومتطلبات القبول؛ فتح القضية أو إغلاقها لا يثبت تنفيذ الضوابط.','102'],
['GATE-15','يتطلب نتائج المعايير وربطها بالنسخة والبيئة ومراجعة مستقلة.','102'],
['HTTPS والمصادقة','شهادة صالحة، رفض المجهول، نجاح المالك ورفض غير المخول.','102'],
['التصدير والاستعادة','بصمات وأعداد ثم استعادة مستقلة في بيئة معزولة. لا تعديل إنتاجي.','57'],
['المطابقة المالية','نسخ معتمدة ومطابقة البنك والشيكات وتفسير الفروق ومراجعة محاسب مستقل.','57'],
['التسليمات النهائية','فهرس Exec / Detail / Excel / PDF / PPTX مع الإصدارات واختبارات الفتح واعتماد المستلم.','57'],
['البيئات ومسارات النشر','ملف workflow ليس إثباتًا لحماية البيئة. تحقق من إعدادات GitHub Pages وVercel وCloudflare.','102']];
root.innerHTML='<div class="panel"><p class="pill">قراءة وتحليل فقط · بيانات GitHub العامة</p><p>هذا العرض لا يدمج ولا ينشر ولا يشغّل Actions ولا يتصل بـJawafa_DB. نجاح فحص لا يثبت قبول الإنتاج. يُحمّل الفهرس عند فتح الشاشة أو الضغط على التحديث.</p><div class="toolbar"><button id="rv-refresh" type="button">تحديث الفهرس</button><button id="rv-export" type="button">تصدير لقطة</button><label>استيراد لقطة سابقة <input id="rv-import" type="file" accept=".json"></label></div><p id="rv-message" role="status" aria-live="polite"></p><p id="rv-coverage" class="muted small"></p><div class="toolbar" id="rv-tabs">'+[['prs','طلبات السحب'],['runs','عمليات Actions'],['workflows','Workflows'],['issues','القضايا'],['gates','بوابات القبول'],['plan','الخطوات الآمنة']].map(([k,v])=>'<button type="button" data-tab="'+k+'">'+v+'</button>').join('')+'</div><div class="toolbar"><input id="rv-query" aria-label="البحث برقم أو عنوان" placeholder="رقم PR / Issue أو عنوان أو SHA"><select id="rv-project" aria-label="المشروع"><option value="">كل المشاريع</option><option>جوافة</option><option>عامر</option><option>لقطة</option></select><select id="rv-status" aria-label="حالة الدليل"><option value="">كل الحالات</option><option>مثبت</option><option>يفشل</option><option>غير مثبت</option><option>يحتاج تحققًا إضافيًا</option></select><select id="rv-env" aria-label="البيئة"><option value="">كل البيئات</option><option>CI</option><option>GitHub Pages</option><option>Vercel</option><option>Cloudflare</option><option>غير محددة</option></select></div><div id="rv-list"></div><button id="rv-more" type="button" hidden>تحميل عمليات أقدم</button><div id="rv-detail" class="panel" hidden></div></div>';
function render(){
$('coverage').textContent='آخر فهرس مكتمل: '+stamp(state.at)+' · '+state.prs.length+' PR · '+state.workflows.length+' Workflow · عمليات '+state.runs.length+' من '+state.totalRuns+'؛ بقية التفاصيل عند الطلب. المشاريع مصنفة تقديريًا داخل هذا المستودع فقط.';
$('more').hidden=tab!=='runs';
root.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
if(tab==='gates'){$('list').innerHTML=gates.map(([name,desc,n])=>'<article class="panel"><h3>'+e(name)+'</h3><span class="pill warn">يحتاج تحققًا إضافيًا</span><p>'+e(desc)+'</p>'+safeLink('https://github.com/'+REPO+'/'+(n==='125'?'pull/':'issues/')+n,'المرجع')+'</article>').join('')+'<button type="button" id="rv-environments">قراءة إعدادات البيئات والنشر</button>';return;}
if(tab==='plan'){$('list').innerHTML='<p>تأشير مراجعة محلي فقط؛ ليس إثبات تنفيذ ولا يُحفظ في GitHub.</p>'+['تثبيت PR / SHA ووقت القراءة ومقارنة اللقطة السابقة.','قراءة سجل أول فحص فاشل؛ لا يُستنتج السبب من اسم الفحص.','اقتراح أصغر تصحيح للملف أو الإعداد الذي يثبته السجل. DCO: مراجعة sign-off؛ Vercel: قراءة سجل المزود أولًا.','اختبارات القبول: الفحص الفاشل نفسه ثم الانحدار والتنقل والمصادقة والمنع الآمن. لا تُنفذ من هذه الشاشة.','توثيق حماية كل مسار نشر وقبول GATE-15 وHTTPS والاستعادة والمطابقة والتسليمات.','مراجعة مستقلة ثم قرار المالك في مسار منفصل.'].map((v,i)=>'<p><label><input type="checkbox" class="rv-step" data-step="'+i+'"> '+(i+1)+'. '+e(v)+'</label></p>').join('');return;}
const q=$('query').value.trim().toLowerCase(),p=$('project').value,s=$('status').value,en=$('env').value;
const rows=(state[tab]||[]).filter(x=>(!q||(/^#?\d+$/.test(q)?String(x.number||x.id)===q.replace('#',''):JSON.stringify(x).toLowerCase().includes(q)))&&(!p||project(x)===p)&&(!s||status(x)===s)&&(!en||env(x)===en));
$('list').innerHTML='<p>'+rows.length+' نتيجة · «مثبت» يصف نتيجة الفحص فقط. حالات PR غير المقروءة غير مثبتة.</p><div style="overflow:auto"><table style="width:100%;min-width:650px"><thead><tr><th>العنصر</th><th>المشروع / البيئة</th><th>الدليل</th><th>السابق ← الحالي</th><th>التفاصيل</th></tr></thead><tbody>'+rows.map(x=>{const id=x.number||x.id||x.name,old=previous?.[tab]?.find(o=>(o.number||o.id||o.name)===id);return '<tr><td>'+e((x.number?'#'+x.number+' ':'')+(x.title||x.name))+'<p class="small">'+e(x.head?.sha||x.head_sha||x.path||'')+'</p></td><td>'+e(project(x))+' / '+e(env(x))+'</td><td>'+status(x)+'<p class="small">'+e(x.conclusion||x.state||'')+'</p></td><td>'+e(difference(old,x))+'</td><td><button type="button" data-detail="'+e(id)+'">عرض الأدلة</button></td></tr>';}).join('')+'</tbody></table></div>';
}
const block=(name,v)=>'<details><summary>'+e(name)+'</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;text-align:start">'+e(typeof v==='string'?v:JSON.stringify(v,null,2))+'</pre></details>';
async function details(id){
const kind=tab,x=state[kind]?.find(x=>String(x.number||x.id||x.name)===id);if(!x)return;
const out=$('detail');out.hidden=false;out.textContent='قراءة الأدلة…';out.scrollIntoView({block:'start'});
try{
let body=block('الهوية والتوقيت',x);
if(kind==='prs'){
const pr=await read('pulls/'+x.number);
const [files,comments,reviews,checks,statuses]=await Promise.all([all('pulls/'+x.number+'/files'),all('issues/'+x.number+'/comments'),all('pulls/'+x.number+'/reviews'),all('commits/'+pr.head.sha+'/check-runs','check_runs'),all('commits/'+pr.head.sha+'/statuses')]);
const d={sha:pr.head.sha,at:new Date().toISOString(),checks:[...checks,...statuses]};state.details[x.number]=d;Object.assign(x,pr);
body='<p>SHA: '+e(d.sha)+' · '+stamp(d.at)+' · '+classify(d.checks)+'</p>'+block('الوصف',pr.body)+block('الملفات المتأثرة',files)+block('الفحوص',checks)+block('حالات المزودين',statuses)+block('المراجعات — أقوال المراجعين',reviews)+block('التعليقات ومعرّفاتها',comments)+block('السجل الزمني',[{event:'created',at:pr.created_at},{event:'updated',at:pr.updated_at},{event:'merged',at:pr.merged_at},...reviews.map(r=>({event:r.state,at:r.submitted_at,id:r.id,url:r.html_url})),...comments.map(c=>({event:'comment',at:c.created_at,id:c.id,url:c.html_url}))].filter(e=>e.at).sort((a,b)=>a.at.localeCompare(b.at)))+'<p>أصغر تصحيح آمن يُحدد بعد قراءة رسالة الفشل؛ اختبار القبول هو إعادة نفس الفحص على SHA الجديد مع فحص الانحدار. لم يُنفذ تصحيح من هذه الشاشة.</p>';
}else if(kind==='runs'){body+=block('الوظائف والخطوات',await all('actions/runs/'+x.id+'/jobs','jobs'))+safeLink(x.html_url,'سجل التشغيل الكامل');}
else if(kind==='issues'){body+=block('التعليقات',await all('issues/'+x.number+'/comments'));}
else if(kind==='workflows'){const f=await read('contents/'+x.path);body+=block('ملف Workflow — لا يثبت حماية البيئة',new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\s/g,'')),c=>c.charCodeAt(0))))+block('عمليات Workflow',await read('actions/workflows/'+x.id+'/runs?per_page=30'));}
out.innerHTML='<button id="rv-close" type="button">إغلاق التفاصيل</button><h3>'+e(x.title||x.name)+'</h3>'+safeLink(x.html_url)+body;render();
}catch(err){out.textContent='لم يكتمل التحقق: '+err.message;}
}
async function task(f){if(busy)return;busy=true;$('refresh').disabled=true;$('message').textContent='جاري القراءة من GitHub…';try{await f();$('message').textContent='اكتملت القراءة؛ لم تُنفذ أي عملية كتابة.';}catch(err){$('message').textContent=err.message+'؛ احتُفظ بالبيانات السابقة دون ادعاء تحديث.';}finally{busy=false;$('refresh').disabled=false;render();}}
async function refresh(){await task(async()=>{const [prs,runs,workflows,issues]=await Promise.all([all('pulls?state=all'),read('actions/runs?per_page=30'),all('actions/workflows?','workflows'),Promise.all([read('issues/102'),read('issues/57')])]);previous=state.at?structuredClone(state):previous;state={schema:1,repo:REPO,at:new Date().toISOString(),prs,runs:runs.workflow_runs,workflows,issues,details:{},totalRuns:runs.total_count};runPage=1;});}
$('refresh').onclick=refresh;
$('more').onclick=()=>task(async()=>{const r=await read('actions/runs?per_page=30&page='+(runPage+1)),seen=new Set(state.runs.map(x=>x.id));state.runs.push(...r.workflow_runs.filter(x=>!seen.has(x.id)));runPage++;});
$('tabs').onclick=ev=>{if(ev.target.dataset.tab){tab=ev.target.dataset.tab;render();}};
for(const name of ['query','project','status','env'])$(name).addEventListener('input',render);
root.addEventListener('click',ev=>{if(ev.target.dataset.detail)details(ev.target.dataset.detail);if(ev.target.id==='rv-close')$('detail').hidden=true;if(ev.target.id==='rv-environments')task(async()=>{const results=await Promise.allSettled([read('environments?per_page=100'),all('deployments?')]);$('detail').hidden=false;$('detail').innerHTML=results.map((r,i)=>block(i?'سجل النشر':'البيئات',r.status==='fulfilled'?r.value:'غير مثبت: '+r.reason.message)).join('');});});
root.addEventListener('change',ev=>{if(ev.target.matches('.rv-step')){const a=[...root.querySelectorAll('.rv-step')],i=a.indexOf(ev.target);if(ev.target.checked&&a.slice(0,i).some(c=>!c.checked)){ev.target.checked=false;$('message').textContent='راجع الخطوات السابقة أولًا.';}if(!ev.target.checked)a.slice(i+1).forEach(c=>c.checked=false);}});
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='amer-verification.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async ev=>{try{const f=ev.target.files[0];if(!f)return;if(f.size>20000000)throw Error('حد الملف 20MB');const p=JSON.parse(await f.text());if(p.schema!==1||p.repo!==REPO||!['prs','runs','workflows','issues'].every(k=>Array.isArray(p[k])))throw Error('لقطة غير مطابقة');previous=p;$('message').textContent='لقطة مستوردة للمقارنة فقط؛ ليست دليلًا معتمدًا.';render();}catch(err){$('message').textContent=err.message;}ev.target.value='';};
render();let attempted=false;function enter(){if(location.hash==='#release-verification'&&!attempted){attempted=true;refresh();}}window.addEventListener('hashchange',enter);enter();
}
}
