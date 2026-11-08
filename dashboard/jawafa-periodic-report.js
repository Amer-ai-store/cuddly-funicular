/* Jawafa periodic operational report: public metadata only, historical unless timestamped source updates. */
(()=>{"use strict";
const $=id=>document.getElementById(id);
if(!$("jawafa-periodic-report"))return;
const source="./data/jawafa-status.json";
const date=value=>{
 if(!value)return "غير مثبت";
 const d=new Date(value);
 return Number.isFinite(d.getTime())?d.toLocaleString("ar-JO",{timeZone:"Asia/Amman",dateStyle:"medium",timeStyle:"short"}):"توقيت غير صالح";
};
const put=(id,value)=>{const n=$(id);if(n)n.textContent=String(value??"—")};
const setState=(value,warning=true)=>{const n=$("jpr-state");if(!n)return;n.textContent=value;n.className=warning?"pill warn":"pill info"};
let inFlight=false;
async function refresh(){
 if(inFlight)return;inFlight=true;
 const btn=$("jpr-refresh");if(btn)btn.disabled=true;
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  let response;
  try{response=await fetch(source+"?updated="+Date.now(),{cache:"no-store",credentials:"omit",signal:controller.signal})}finally{clearTimeout(timer)}
  if(!response.ok)throw Error("HTTP_"+response.status);
  const data=await response.json();
  if(data.schema!=="jawafa-ops-snapshot-v1"||data.classification!=="PUBLIC_OPERATIONAL_METADATA_ONLY")
   throw Error("SCHEMA_MISMATCH");
  const ts=Date.parse(data.source_timestamp_utc||"");
  const age=Number.isFinite(ts)?Date.now()-ts:null;
  put("jpr-last",date(data.source_timestamp_utc));
  put("jpr-age",age!==null&&age>=0?Math.floor(age/3600000)+" ساعة "+Math.floor((age%3600000)/60000)+" دقيقة":"فرق الساعة غير موثوق");
  put("jpr-remote",data.server?.status==="responded"?"استجاب وقت اللقطة":"غير مثبت");
  const api=data.server?.api_check;
  put("jpr-bridge",Number.isFinite(api?.passed)&&Number.isFinite(api?.tested)?api.passed+"/"+api.tested+" اختبارات تاريخية":"غير مثبت");
  put("jpr-cloud",data.cloud_bridge?.status==="blocked"?"قناة معطّلة في اللقطة":"غير مثبت");
  put("jpr-gate",data.audit?.gate15==="not_accepted"?"GATE-15 غير مقبول":"غير مثبت");
  const tbody=$("jpr-tasks");tbody.replaceChildren();
  for(const task of Array.isArray(data.monitored_tasks)?data.monitored_tasks:[]){
   const tr=document.createElement("tr");
   const fields=[task.display||"—",task.state||"غير مثبت",date(task.last_run_server),task.state==="Ready"?"مجدولة فقط؛ لا تثبت التنفيذ الآن":"تحتاج تحققًا"];
   for(const v of fields){const td=document.createElement("td");td.textContent=v;tr.append(td)}
   tbody.append(tr);
  }
  if(!tbody.children.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.textContent="لا توجد مهام مؤرخة في المصدر";tr.append(td);tbody.append(tr)}
  setState(age===null||age>7200000?"لقطة قديمة — الاتصال الحالي غير مثبت":"لقطة تاريخية — ليست حالة مباشرة");
  put("jpr-msg","إعادة القراءة لا تُجري فحصًا جديدًا على الخادم. وقت اللقطة حسب ساعة المصدر وقد يختلف عن UTC؛ لا يعرض الموقع بيانات مالية أو كلمة مرور أو منفذ SQL.");
 }catch(err){
  setState("المصدر غير متاح — لا تفترض سلامة الاتصال");
  put("jpr-msg","تعذر استرجاع التقرير ("+String(err.message||"UNKNOWN").slice(0,45)+"). لا توجد نتيجة حية من TRUSTSOFT.");
  ["jpr-last","jpr-age","jpr-remote","jpr-bridge","jpr-cloud","jpr-gate"].forEach(id=>put(id,"غير مثبت"));
  $("jpr-tasks").replaceChildren();
 }finally{inFlight=false;if(btn)btn.disabled=false}
}
$("jpr-refresh")?.addEventListener("click",refresh);
refresh();
setInterval(()=>{if(!document.hidden)refresh()},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
})();