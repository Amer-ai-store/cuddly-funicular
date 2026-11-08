/* Jawafa central dashboard UI adapter. No secrets or SQL access. Existing navigation and login preserved. */
(()=>{
"use strict";
const BASE="/api/jawafa/v1";
const PAGES={
"jawafa":{group:"القيادة",source:"dashboard",buttons:[["CHECK_SERVER","فحص اتصال الخادم"],["CHECK_LATEST_BACKUP","فحص آخر نسخة مكتملة"],["REVERIFY_G15","إعادة اختبار GATE-15"]]},
"jawafa-tasks":{group:"المهام",source:"tasks",buttons:[["CHECK_TASKS","تحديث سجل المهام"]]},
"jawafa-gate15":{group:"التحقق",source:"gates/15",buttons:[["REVERIFY_G15","إعادة الفحص الفني للجداول"],["REVIEW_DIFFERENCES","عرض الفروق غير المحسومة"]]},
"jawafa-backups":{group:"النسخ",source:"backups",buttons:[["CHECK_LATEST_BACKUP","التحقق من النسخة المكتملة"],["CHECK_EXPORTS","فحص التصدير"],["REVIEW_RESTORE_TESTS","عرض نتائج RESTORE"]]},
"jawafa-monitor":{group:"المراقبة",source:"dashboard",buttons:[["CHECK_SERVER","فحص JAWAFFASVR"],["CHECK_DATABASE","فحص Jawafa_DB قراءة فقط"],["CHECK_SESSIONS","طلب أحداث الأجهزة والمستخدمين"]]},
"jawafa-export":{group:"المراقبة",source:"export-status",buttons:[["CHECK_EXPORTS","فحص التصدير"]]},
"jawafa-accounting":{group:"الحسابات",source:"dashboard",buttons:[["REVIEW_JOURNALS","طلب فحص القيود"]]},
"jawafa-checks":{group:"الشيكات",source:"dashboard",buttons:[["REVIEW_CHEQUEBOOK","طلب جرد 50 ورقة"],["RECONCILE_BANK","بدء مطابقة مشروطة"]]},
"jawafa-purchases":{group:"المشتريات",source:"dashboard",buttons:[["REVIEW_PURCHASES","تحليل المشتريات"]]},
"jawafa-receiving":{group:"الاستلام",source:"dashboard",buttons:[["REVIEW_RECEIVING","مراجعة سندات الاستلام"]]},
"jawafa-people":{group:"الموظفون",source:"dashboard",buttons:[["REVIEW_ACCESS_LOGS","فحص الصلاحيات والسجلات"]]},
"jawafa-investigations":{group:"التحقيقات",source:"evidence",buttons:[["INVESTIGATION_REQUEST","طلب تحقيق جديد"]]},
"jawafa-agents":{group:"الوكلاء",source:"dashboard",buttons:[["CFO_REVIEW","طلب تقييم مالي"],["CPO_REVIEW","طلب تقييم مشتريات"],["GM_SYNTHESIS","طلب مراجعة المدير العام"]]},
"jawafa-commands":{group:"الأوامر",source:"tasks",buttons:[["CHECK_COMMANDS","استعلام سجل التنفيذ"]]},
"jawafa-evidence":{group:"الأدلة",source:"evidence",buttons:[["CHECK_EVIDENCE","تحديث سجل الأدلة"]]},
"jawafa-reports":{group:"التقارير",source:"dashboard",buttons:[["REVIEW_REPORTS","عرض حالة التقارير"]]},
"jawafa-errors":{group:"الأخطاء",source:"tasks",buttons:[["CHECK_ERRORS","مراجعة الأخطاء والمعالجات"]]}
};
const TITLES={
"jawafa":"القيادة المركزية — جوافة","jawafa-tasks":"الخطة التنفيذية الموحدة",
"jawafa-gate15":"بوابة قبول الجداول الخمسة عشر","jawafa-backups":"حماية النسخ والاستعادة",
"jawafa-monitor":"مراقبة الخادم والسجلات","jawafa-export":"مراقبة التصدير المباشر","jawafa-accounting":"المحاسبة والقيود والسندات",
"jawafa-checks":"الشيكات والدفاتر والبنوك","jawafa-purchases":"المشتريات والموردون",
"jawafa-receiving":"الاستلام والمخزون","jawafa-people":"الموظفون والأجهزة",
"jawafa-investigations":"التحقيقات المالية والقضائية","jawafa-agents":"مجلس الوكلاء الثلاثة",
"jawafa-commands":"سجل الأوامر والرسائل","jawafa-evidence":"سلسلة حفظ الأدلة",
"jawafa-reports":"التقارير المالية والقوائم","jawafa-errors":"سجل الأخطاء والمعالجات"};
const B={gate:"NOT ACCEPTED",export_verified:15,export_total:15,technical_verified:15,
  historical_causality:"INCOMPLETE",restore_historical_passed:7,restore_historical_total:7,
  daily_latest_accepted:false,live_sql:false,source:"عقد التكامل 28/10/2026 — مرجع تاريخي فقط"};
let snapshot=null,connected=false,identity=null,searchTimer=null;
let connectionRevision=0,lastError="NOT_CONNECTED";
let publicSnapshot=null, publicSnapshotError="";
async function loadPublicSnapshot(){
  if(publicSnapshot)return publicSnapshot;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),7000);
  try{
    const r=await fetch("./data/jawafa-status.json",{cache:"no-store",signal:controller.signal});
    if(!r.ok)throw Error("PUBLIC_SNAPSHOT_HTTP_"+r.status);
    const value=await r.json();
    if(value?.schema!=="jawafa-ops-snapshot-v1" || value?.classification!=="PUBLIC_OPERATIONAL_METADATA_ONLY")
      throw Error("PUBLIC_SNAPSHOT_SCHEMA_MISMATCH");
    publicSnapshot=value;publicSnapshotError="";return value;
  }catch(e){publicSnapshotError=String(e?.message||"SNAPSHOT_UNAVAILABLE");return null}
  finally{clearTimeout(timer)}
}
function historical(p,key){
  const s=publicSnapshot;if(!s)return;
  message(p,"لقطة تشغيلية تاريخية بتاريخ "+(s.source_timestamp_utc||"غير مثبت")+" — ليست حالة مباشرة؛ قد يختلف توقيت ساعة الخادم. لا بيانات مالية منشورة.", "info");
  if(key==="jawafa"){
    details(p,[["الخادم آخر فحص",s.server?.status==="responded"?"استجاب وقت اللقطة":"غير مثبت"],
      ["فحوص API السابقة",String(s.server?.api_check?.passed??0)+"/"+String(s.server?.api_check?.tested??0)],
      ["ملفات التصدير",String(s.export?.file_count??"—")],["بوابة GATE-15",s.audit?.gate15==="not_accepted"?"غير مقبولة":"غير مثبتة"],
      ["قناة البيانات المباشرة",s.cloud_bridge?.status==="blocked"?"معطلة":"غير مثبتة"],["القيود المالية المنشورة",String(s.audit?.financial_records_in_public_page??0)]]);
    message(p,"لا تساوي استجابة الخادم السابقة وجود اتصال حالي. عمليات الإرسال والتعديل متوقفة إلى حين توثيق HTTPS والمصادقة وفحص E2E.");
  }
  if(key==="jawafa-monitor"){
    details(p,[["اسم الخادم",s.server?.name||"—"],["القاعدة المعنية",s.server?.database||"—"],
      ["استجابة سابقة",s.server?.status||"—"],["فحوص سابقة ناجحة",String(s.server?.api_check?.passed??0)+"/"+String(s.server?.api_check?.tested??0)],
      ["آخر لقطة",s.source_timestamp_utc||"—"],["كتابة المحاسبة",s.server?.accounting_writes===false?"لم تنفذ في هذا الفحص":"غير مثبت"]]);
    table(p,[["وكيل المراقبة","display"],["حالة جدولة Windows","state"],["آخر تشغيل بحسب ساعة الخادم","last_run_server"]],s.monitored_tasks||[]);
    message(p,"الحالة Ready تعني جدولة المهمة ولا تثبت تنفيذها الآن. لا تُعرض أسماء دخول أو عناوين أو بيانات محاسبية على الصفحة العامة.");
  }
  if(key==="jawafa-export"){
    const e=s.export||{};
    details(p,[["اللقطة",e.snapshot||"—"],["عدد الملفات السابقة",String(e.file_count??"—")],["الحجم السابق",exportSize(e.bytes)],
      ["ملفات صفرية",String(e.zero_byte_files??"—")],["أحدث ملف بحسب ساعة الخادم",e.newest_file_server_local||"—"],
      ["اكتمال GATE-15","غير مثبت"]]);
    message(p,"تحقق عددي من الملفات فقط؛ لا يثبت تطابق محتوى الجداول أو تجزئة الملفات أو اكتمال الاستيراد. لا يوجد بث تصدير حي.");
  }
  if(key==="jawafa-backups"){
    details(p,[["آخر نسخة يومية معتمدة","غير مثبتة"],["اختبار استعادة حديث","غير مثبت"],["أرشيف التصدير السابق",s.export?.snapshot||"—"]]);
    message(p,"ملفات التصدير ليست بالضرورة نسخ استعادة صالحة. يلزم إثبات سلامة الملفات واختبار RESTORE على بيئة مستقلة.");
  }
  if(key==="jawafa-tasks"){
    details(p,[["مهام المراقبة المرصودة سابقًا",String((s.monitored_tasks||[]).length)],
      ["المهام الجارية الآن","غير متاح دون جسر خاص"],["الإنجاز المثبت","حسب سجل دليل القبول، لا افتراضًا"]]);
    table(p,[["المهمة","display"],["الجدولة","state"],["آخر دورة مؤرخة","last_run_server"]],s.monitored_tasks||[]);
  }
  if(key==="jawafa-gate15"){
    details(p,[["الحالة",s.audit?.gate15==="not_accepted"?"غير مقبولة":"غير مثبتة"],
      ["أصل الجداول 15","يتطلب مطابقة المستخرج مع المصدر"],["دليل قبول مستقل","غير موجود في اللقطة العامة"]]);
    message(p,"لا يجوز اعتماد أسباب فروق عدد السجلات أو إتمام المطابقات المالية قبل الأدلة الفنية المستقلة.","error");
  }
  if(key==="jawafa-errors"){
    details(p,[["قناة CLOUD BRIDGE",s.cloud_bridge?.status||"—"],["آخر خطأ موثق",s.cloud_bridge?.latest_error||"—"],["آخر سجل بحسب الخادم",s.cloud_bridge?.last_logged_server_utc||"—"]]);
    message(p,"هذه نتيجة سابقة؛ استجابة HTTP_402 لا تعني وجود قناة مزامنة حية أو إمكانية إصلاحها من صفحة GitHub Pages.");
  }
  if(key==="jawafa-commands" || key==="jawafa-agents")
    message(p,"الوكلاء والأوامر تحتاج سجل إرسال واستلام ACK ونتيجة VERIFIED من بوابة خاصة. لا يمكن تأكيد تشغيلها من الموقع العام.");
  if(["jawafa-accounting","jawafa-checks","jawafa-purchases","jawafa-receiving","jawafa-people","jawafa-investigations","jawafa-evidence","jawafa-reports"].includes(key))
    message(p,"هذه الشاشة ضمن القيادة المركزية، لكن السجلات التفصيلية محمية ولا تُنشر في GitHub Pages. التحويل البنيوي لا يعني نقل بيانات القضية إلى موقع عام.");
}

function canDispatch(operation){
  return connected===true &&
    snapshot?.agent_channel?.connected===true &&
    snapshot?.dashboard?.private_https_verified===true &&
    snapshot?.dashboard?.e2e_verified===true &&
    (operation!=="RECONCILE_BANK" || snapshot?.gate?.status==="ACCEPTED");
}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
const id=x=>document.getElementById(x);
const add=(parent,...nodes)=>{for(const n of nodes)parent.append(n);return parent};
function message(p,text,tone="warn"){const n=el("div","banner "+(tone==="error"?"error":tone==="info"?"info":""),text);p.append(n);return n}
function details(p,rows){const box=el("div","grid2");for(const [label,value] of rows){const card=el("div","kpi");add(card,el("span","label",label),el("strong","value small",value));box.append(card)}p.append(box)}
function table(p,columns,rows){const wrap=el("div","table-wrap"),t=el("table"),head=el("thead"),hrow=el("tr");columns.forEach(x=>hrow.append(el("th",null,x[0])));head.append(hrow);t.append(head);const body=el("tbody");if(!rows?.length){const tr=el("tr"),td=el("td",null,"لا توجد بيانات مؤيدة من مصدر معتمد");td.colSpan=columns.length;tr.append(td);body.append(tr)}else rows.slice(0,100).forEach(r=>{const tr=el("tr");columns.forEach(x=>tr.append(el("td",null,r?.[x[1]]??"—")));body.append(tr)});t.append(body);wrap.append(t);p.append(wrap)}
function status(name,value,src,when){const s=document.querySelector('[data-jawafa-status="'+name+'"]');if(s){s.textContent=value;s.className="pill "+(value==="CONNECTED"?"ok":value==="NOT_ACCEPTED"||value==="BLOCKED"?"bad":"warn")}const so=document.querySelector('[data-jawafa-source="'+name+'"]');if(so)so.textContent=src||B.source;const u=document.querySelector('[data-jawafa-updated="'+name+'"]');if(u)u.textContent=when||"غير مُثبت"}
async function token(){if(!window.firebase||typeof window.firebase.auth!=="function")return null;try{const auth=window.firebase.auth();const user=auth.currentUser;if(!user||!user.emailVerified)return null;return await user.getIdToken()}catch{return null}}
async function call(route,{method="GET",body}={}){const jwt=await token();if(!jwt)throw Error("NOT_AUTHENTICATED — سجّل الدخول بحساب المالك في النظام");
const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);
try{const r=await fetch(BASE+"/"+route,{method,headers:{"Accept":"application/json","Authorization":"Bearer "+jwt,...(body?{"Content-Type":"application/json"}:{})},cache:"no-store",credentials:"same-origin",signal:c.signal,...(body?{body:JSON.stringify(body)}:{})});let o={};try{o=await r.json()}catch{}
if(!r.ok)throw Error((o.error||"HTTP_"+r.status)+" ("+r.status+")");return o}
finally{clearTimeout(timer)}}
async function connect(){
  const revision=++connectionRevision;
  try{
    const data=await call("dashboard");
    if(revision!==connectionRevision)return false;
    if(data?.schema_version!=="jawafa.command.v1" || !data.source_system)throw Error("SCHEMA_MISMATCH");
    snapshot=data;connected=true;identity={verified:true};lastError="";
    for(const key of Object.keys(PAGES))status(key,"BRIDGE_CONNECTED",data.source_system,data.verified_at||"غير مثبت");
    status("jawafa-monitor",data.monitor?.server_status==="ONLINE_VERIFIED"?"CONNECTED":"NOT_CONNECTED",data.source_system,data.verified_at);
    if(data.gate?.status!=="ACCEPTED"){
      status("jawafa-gate15","NOT_ACCEPTED",data.source_system,data.report_generated_at);
      status("jawafa-checks","BLOCKED",data.source_system,data.report_generated_at);
    }
    render();return true;
  }catch(e){
    if(revision!==connectionRevision)return false;
    snapshot=null;connected=false;identity=null;
    lastError=String(e?.message||"NOT_CONNECTED").slice(0,120);
    const history=await loadPublicSnapshot();
    if(revision!==connectionRevision)return false;
    for(const key of Object.keys(PAGES))status(key,history?"HISTORICAL":"NOT_CONNECTED",
      history?"لقطة تشغيلية تاريخية — ليست اتصالاً مباشراً":B.source,history?.source_timestamp_utc);
    if(history?.audit?.gate15==="not_accepted")status("jawafa-gate15","NOT_ACCEPTED","لقطة تاريخية",history.source_timestamp_utc);
    render();return false;
  }
}
function pendingButton(parent,op,label){const b=el("button","tiny",label);b.type="button";b.disabled=!canDispatch(op);b.title=canDispatch(op)?"قناة تشغيل معتمدة؛ الإرسال لا يثبت التنفيذ":op==="RECONCILE_BANK"?"BLOCKED_BY_G15 — مطابقة البنك غير مصرح بها":"NOT_CONNECTED / GATE_NOT_VERIFIED — لا توجد قناة تشغيل معتمدة";
b.addEventListener("click",async()=>{if(!canDispatch(op)){message(parent,"BLOCKED — الأوامر معطلة حتى اعتماد قناة HTTPS، واختبار E2E، والوكيل الموقّع، وبوابة GATE-15 للمطابقات.");return;}b.disabled=true;const request_id=crypto.randomUUID(),task_id="JAWAFA-"+op;
try{const result=await call("commands",{method:"POST",body:{request_id,task_id,operation:op,params:{},source_version:snapshot?.snapshot_id||null}});
message(parent,"رقم الطلب: "+result.request_id+" — الحالة: "+result.status+"؛ لا يعني ذلك استلام الوكيل أو التنفيذ.","info");
await loadCommand(result.request_id,parent)}catch(e){message(parent,"تعذر تنفيذ الطلب: "+e.message,"error")}finally{b.disabled=!canDispatch(op)}});
parent.append(b)}
function exportSize(n){const u=["B","KB","MB","GB","TB"];let i=0,v=Number(n||0);while(v>=1024&&i<u.length-1){v/=1024;i++}return v.toFixed(i?2:0)+" "+u[i]}
async function renderExportMonitor(p){
  p.replaceChildren();
  const head=el("div","panel-head");add(head,el("h3",null,TITLES["jawafa-export"]));const refresh=el("button","tiny","تحديث الآن");refresh.addEventListener("click",()=>renderExportMonitor(p));head.append(refresh);p.append(head);
  if(!connected){message(p,"NOT_CONNECTED — لا يوجد مصدر تصدير حي معتمد. يعرض أدناه آخر فحص تاريخي متاح.");
    historical(p,"jawafa-export");return;}
  const loading=el("div","empty","جارٍ قراءة حالة Export v5...");p.append(loading);
  try{const s=await call("export-status");if(s?.schema!=="jawafa.export.monitor.v1"||s?.readOnly!==true)throw Error("EXPORT_STATUS_SCHEMA_MISMATCH");p.replaceChildren(head);
    const pct=Number(s.progressPercent||0);details(p,[["الحالة",s.mode||"UNKNOWN"],["التقدم",pct+"%"],["الجداول",String(s.processedTables??0)+" / "+String(s.totalTables??0)],["المتبقي",String(s.remainingTables??0)],["Workers",String(s.workerCount??0)],["الأخطاء",String(s.failedTables??0)]]);
    const box=el("div","panel");const bar=el("div","progress"),fill=el("span");fill.style.width=Math.max(0,Math.min(100,pct))+"%";bar.append(fill);add(box,el("div","row",null),bar);const meta=el("div","small muted","Baseline "+(s.baselineComplete??0)+" + v5 "+(s.currentRunCompleted??0)+" · الحجم "+exportSize(s.bytesCurrentRun));box.append(meta);p.append(box);
    details(p,[["الملف الحالي",s.currentFile||"—"],["آخر كتابة",s.lastWriteAt?new Date(s.lastWriteAt).toLocaleString("ar-JO"):"—"],["الدورة",s.runName||"—"],["Forensic Watch",s.forensicWatch?.enabled?"كل "+s.forensicWatch.intervalMinutes+" دقيقة":"غير مثبت"]]);
    message(p,"READ ONLY — هذه الشاشة تقرأ حالة التصدير ولا تنفذ أي كتابة على Jawafa_DB.","info");status("jawafa-export",s.mode==="RUNNING"||s.mode==="COMPLETED"?"CONNECTED":"NOT_CONNECTED","Jawafa Export Monitor",s.generatedAt);
  }catch(e){p.replaceChildren(head);message(p,"تعذر قراءة حالة التصدير: "+e.message,"error");status("jawafa-export","NOT_CONNECTED","Jawafa Export Monitor");}
}
async function loadCommand(request_id,parent){const b=el("button","tiny","تحديث حالة "+request_id.slice(0,8));parent.append(b);b.addEventListener("click",async()=>{try{const r=await call("commands/"+encodeURIComponent(request_id));message(parent,"الحالة: "+r.status+" · الوكيل: "+(r.agent_id||"لم يستلم")+" · الدليل: "+(r.evidence_ref||"لم يصل"),"info")}catch(e){message(parent,e.message,"error")}})}
function render(){for(const [key,config] of Object.entries(PAGES)){const p=document.querySelector('[data-jawafa-pane="'+key+'"]');if(!p)continue;if(key==="jawafa-export"){renderExportMonitor(p);continue;}p.replaceChildren();p.append(el("h3",null,TITLES[key]));if(!connected){message(p,"NOT_CONNECTED — القناة الخاصة غير متصلة: "+lastError+". "+(publicSnapshot?"تُعرض أدناه بيانات مرجعية بتاريخها.":"اللقطة العامة غير متاحة: "+publicSnapshotError));historical(p,key);}
else if(!snapshot?.agent_channel?.connected)message(p,"الجسر مصادق عليه، لكن الوكيل التنفيذي غير متصل؛ أوامر التنفيذ معطلة.");
else if(snapshot?.dashboard?.private_https_verified!==true || snapshot?.dashboard?.e2e_verified!==true)message(p,"GATE_NOT_VERIFIED — لم يُثبت اعتماد HTTPS الخاص واختبار الطرف إلى الطرف. الأزرار التنفيذية معطّلة.");const tools=el("div","toolbar");const refresh=el("button","tiny","تحديث المصدر الموثوق");refresh.disabled=false;refresh.addEventListener("click",()=>connect());tools.append(refresh);for(const [op,label] of config.buttons)pendingButton(tools,op,label);p.append(tools);
if(key==="jawafa"||key==="jawafa-gate15"){details(p,[["GATE-15",snapshot?.gate?.status||B.gate],["الاستخراج المعاد",String(snapshot?.gate?.technical_export_tables??15)+"/15"],["الاختبارات الفنية",String(snapshot?.gate?.technical_verified_tables??15)+"/15"],["سبب الفروق التاريخية","غير مكتمل"]]);message(p,"الاجتياز الفني لا يساوي قبول GATE-15؛ F01–F14 محجوبة. لا تعتمد النتائج المالية قبل التحقيق في الفروق.","error")}
if(key==="jawafa-backups"){details(p,[["اختبارات RESTORE التاريخية","7/7"],["اعتماد أحدث نسخة يومية","غير مثبت"],["النسخة المعتمدة للقراءة","آخر نسخة مكتملة ومتحققة فقط"]]);message(p,"لا تقرأ من نسخة جارية الإنشاء أو ملف جزئي. لا يوجد اختبار حديث مثبت لهذه الجلسة.")}
if(key==="jawafa-tasks"){details(p,[["مرجع AppDeploy التاريخي",connected?(String(snapshot?.tasks?.length||0)+" سجل مرجعي داخل الجسر — دون اعتماد"):("97 مهمة تاريخية — لم تصل من جسر مصادق عليه")],["المطابقات المالية F01–F14","14 مهمة BLOCKED_BY_G15"],["مصدر المهام الرسمي","الجسر التشغيلي عند الاتصال"]]);const tasks=snapshot?.tasks||Array.from({length:14},(_,i)=>({task_id:"F"+String(i+1).padStart(2,"0"),status:"BLOCKED_BY_G15",source:"مرجع عقد التكامل"}));table(p,[["رمز المهمة","task_id"],["الحالة","status"],["مرجع الدليل","evidence_ref"],["آخر اختبار","checked_at"]],tasks)}
if(key==="jawafa-monitor"){details(p,[["JAWAFFASVR",snapshot?.monitor?.server_status||"NOT_CONNECTED"],["Jawafa_DB",snapshot?.monitor?.database_status||"NOT_CONNECTED"],["آخر نسخة مصدر",snapshot?.snapshot_id||"غير متاح"],["آخر تحديث",snapshot?.verified_at||"غير مثبت"]]);table(p,[["الجهاز","device"],["Windows","windowsUser"],["TrustSoft","trustsoftUser"],["الوقت","time"],["العملية","operation"],["السند","voucher"],["الدليل","evidenceId"]],snapshot?.monitor?.trustsoftEvents||[])}
if(key==="jawafa-checks")message(p,"مراقبة الدفاتر والشيكات (50 ورقة) والمطابقات البنكية: الفحص التحضيري مسموح؛ مطابقة الحسابات F01–F14 محجوبة حتى قبول GATE-15.","error");
if(key==="jawafa-accounting"||key==="jawafa-checks"||key==="jawafa-purchases"||key==="jawafa-receiving"||key==="jawafa-people")table(p,[["المصدر","source"],["رقم المرجع","reference"],["الحالة","status"],["تاريخ القطع","cutoff_at"],["مرجع الدليل","evidence_ref"]],snapshot?.modules?.[key]||[]);
if(key==="jawafa-agents"){details(p,[["CFO","تقرير تحليلي + دليل"],["CPO","توصية توريد + دليل"],["GM","قرار معلل → موافقة بشرية"]]);message(p,"الأزرار تطلب مهمة؛ لا تعتبر الوكلاء متصلين أو منفذين دون ACK وVERIFIED مسجّلين.")}
if(key==="jawafa-commands"){table(p,[["رقم الطلب","request_id"],["العملية","operation"],["الحالة","status"],["الوكيل","agent_id"],["الدليل","evidence_ref"]],snapshot?.recent_commands||[])}
if(key==="jawafa-evidence"){table(p,[["معرف الدليل","evidence_ref"],["SHA-256","sha256"],["المصدر","source_system"],["الحالة","verification_status"]],snapshot?.evidence_refs||[])}
if(key==="jawafa-errors")message(p,"تُعرض الأخطاء والتحقق والمعالجات من سجل التشغيل فقط. لا تُحذف المهمة المتعثرة ولا يُعطى إنجاز غير مثبت.");
if(key==="jawafa-reports")message(p,"التقارير المعتمدة تحفظ إلى مجلد Google Drive الخاص. أزرار الرفع المباشر معطّلة حتى تفعيل مسار آمن مع تأكيد البصمة والحجم والصلاحيات.");
if(key==="jawafa-investigations")message(p,"تمييز الوقائع المثبتة عن القرائن والإفادات والادعاءات. عدم نسبة الفعل إلى مستخدم مشترك دون الجهاز وWindows وTrustSoft والوقت.");
}}
let authListenerAttached=false;let checks=0;const authWatch=setInterval(()=>{checks++;try{if(!authListenerAttached&&window.firebase?.apps?.length&&typeof window.firebase.auth==="function"){authListenerAttached=true;clearInterval(authWatch);window.firebase.auth().onAuthStateChanged(()=>connect())}}catch{}if(checks>40)clearInterval(authWatch)},500);window.addEventListener("focus",()=>{if(!connected)connect()});
render();connect();setInterval(()=>{const s=document.querySelector('[data-view="jawafa-export"]');const p=document.querySelector('[data-jawafa-pane="jawafa-export"]');if(connected&&s&&p&&!s.hidden)renderExportMonitor(p)},30000);window.JawafaUI={refresh:connect,connected:()=>connected,canDispatch:(operation)=>canDispatch(operation)}; 
})();