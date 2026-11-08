/* CCA999 task handoff monitor. Public metadata only; no private records. */
export const ISSUE_API='https://api.github.com/repos/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/168/comments';
export const TASK_PREFIX='CCA999-PLAN-20261108-';
const PROJECT_KIND='PROJECT_CHAT_MESSAGE';
const safe=(value)=>String(value??'').trim();
export function parseMessage(row){
 const match=safe(row?.body).match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
 if(!match)return null;
 let item;try{item=JSON.parse(match[1])}catch{return null}
 if(!item||item.kind!==PROJECT_KIND||item.schema!=='1.0'||!safe(item.id))return null;
 if(!safe(item.subject)||!safe(item.to_chat)||!safe(item.from_chat))return null;
 return {...item,comment_id:row.id,comment_url:row.html_url||'https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/168',created_at:row.created_at||null,github_author:row.user?.login||null};
}
export function analyzeHandoffs(rows){
 const messages=(Array.isArray(rows)?rows:[]).map(parseMessage).filter(Boolean);
 const tasks=messages.filter(m=>m.id.startsWith(TASK_PREFIX)&&/^[1-4]$/.test(m.id.slice(TASK_PREFIX.length)));
 const latest=new Map();
 for(const task of tasks){
  const previous=latest.get(task.id);
  if(!previous||String(previous.created_at||'')<String(task.created_at||''))latest.set(task.id,task);
 }
 return [...latest.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(task=>{
  const responses=messages.filter(m=>m.reply_to===task.id&&m.id!==task.id);
  const last=responses.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null;
  return {id:task.id,to_chat:task.to_chat,subject:task.subject,sent_at:task.created_at,proof_url:task.comment_url,comment_id:task.comment_id,reply_count:responses.length,last_reply_at:last?.created_at||null,last_reply_url:last?.comment_url||null,
   state:last?'RESPONSE_IN_HUB_UNVERIFIED':'SENT_ONLY',delivered_verified:false,read_verified:false,ack_verified:false,execution_verified:false};
 });
}
export const JOURNEY_STAGES=Object.freeze([
 {id:'SENT',label:'الإرسال'},
 {id:'DELIVERED',label:'الاستلام'},
 {id:'ACKNOWLEDGED',label:'الإقرار'},
 {id:'EXECUTING',label:'التنفيذ'},
 {id:'EVIDENCE',label:'إرفاق الإثبات'},
 {id:'REVIEWED',label:'الاعتماد'}
]);
export function buildTaskJourney(task){
 return JOURNEY_STAGES.map(stage=>{
  const verified=stage.id==='SENT'&&Number.isSafeInteger(task?.comment_id)&&!!task?.proof_url;
  return {id:stage.id,label:stage.label,status:verified?'VERIFIED':'UNVERIFIED',verified_at:verified?(task.sent_at||null):null,proof_url:verified?task.proof_url:null};
 });
}
export function validatePage(rows){return Array.isArray(rows)&&rows.length<=100}
export async function fetchHandoffs(fetcher=fetch,{maxPages=5}={}){
 const all=[];
 for(let page=1;page<=maxPages;page++){
  const response=await fetcher(ISSUE_API+'?per_page=100&page='+page,{cache:'no-store',headers:{Accept:'application/vnd.github+json'},credentials:'omit'});
  if(!response.ok)throw Error('GITHUB_HTTP_'+response.status);
  const rows=await response.json();
  if(!validatePage(rows))throw Error('GITHUB_SCHEMA_MISMATCH');
  all.push(...rows);
  if(rows.length<100)break;
 }
 return analyzeHandoffs(all);
}
const node=(tag,value,className)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;if(className)e.className=className;return e};
export function initMonitor(){
 const root=document.querySelector('[data-view="cca999-task-flow"]');if(!root)return;
 const status=root.querySelector('#cca999-flow-status'),summary=root.querySelector('#cca999-flow-summary'),target=root.querySelector('#cca999-flow-table'),journeys=root.querySelector('#cca999-flow-journeys'),button=root.querySelector('#cca999-flow-refresh');
 async function refresh(){
  button.disabled=true;status.textContent='جارٍ جلب التعليقات من GitHub (قراءة عامة فقط)...';
  summary.replaceChildren();target.replaceChildren();journeys.replaceChildren();
  try{
   const tasks=await fetchHandoffs();
   summary.append(node('span','المهام ذات إرسال مثبت: '+tasks.length,'pill'));
   summary.append(node('span','ردود مسجلة بالقناة: '+tasks.filter(t=>t.reply_count).length,'pill'));
   summary.append(node('span','تسليم داخل ChatGPT مثبت: 0 — غير قابل للتحقق من سجل GitHub','pill'));
   const table=node('table');const head=node('thead'),header=node('tr'),body=node('tbody');
   ['المهمة / الجهة','إثبات الإرسال','الاستجابة داخل القناة','الاستلام والقراءة والتنفيذ'].forEach(h=>header.append(node('th',h)));
   head.append(header);table.append(head);
   for(const t of tasks){
    const tr=node('tr'),name=node('td'),evidence=node('td'),reply=node('td');
    name.append(node('strong',t.to_chat),node('div',t.subject,'small'));
    const link=node('a','تعليق #'+t.comment_id);link.href=t.proof_url;link.target='_blank';link.rel='noopener noreferrer';evidence.append(link,node('div',t.sent_at||'لا وقت مسجل','small muted'));
    reply.append(node('span',t.reply_count?'رُصد رد بالقناة دون إثبات هوية الدردشة':'لم يرصد رد مرتبط بمعرّف المهمة'));
    if(t.last_reply_url){const l=node('a',' · عرض الرد');l.href=t.last_reply_url;l.target='_blank';l.rel='noopener noreferrer';reply.append(l)}
    tr.append(name,evidence,reply,node('td','DELIVERED / READ / ACK / EXECUTION: غير مثبتة'));body.append(tr);
   }
   table.append(body);target.append(table);
   for(const t of tasks){
    const card=node('article',undefined,'cca999-journey-card');
    const caption=node('h3',t.to_chat+' — '+t.subject);
    const detail=node('p','معرّف المهمة: '+t.id,'small muted');
    const path=node('ol',undefined,'cca999-journey-stages');
    for(const stage of buildTaskJourney(t)){
     const step=node('li',undefined,'cca999-stage '+(stage.status==='VERIFIED'?'cca999-stage-verified':'cca999-stage-unverified'));
     step.append(node('strong',stage.label),node('span',stage.status==='VERIFIED'?'مثبت':'لم يثبت','small'));
     if(stage.proof_url){
      const proof=node('a','عرض إثبات الإرسال');
      proof.href=stage.proof_url;proof.target='_blank';proof.rel='noopener noreferrer';
      step.append(proof);
     }
     path.append(step);
    }
    card.append(caption,detail,path);
    if(t.reply_count){
     const response=node('p','رُصد '+t.reply_count+' رد مرتبط في سجل GitHub؛ مصدر الرد لا يثبت استلام محادثة ChatGPT أو تنفيذ المهمة.','small muted');
     if(t.last_reply_url){const l=node('a','فتح آخر رد');l.href=t.last_reply_url;l.target='_blank';l.rel='noopener noreferrer';response.append(' ',l);}
     card.append(response);
    }
    journeys.append(card);
   }
   if(!tasks.length)target.append(node('p','لم يُعثر على رسائل مهام مطابقة. لا يدل ذلك على عدم إنجاز المهام خارج هذه القناة.','muted'));
   status.textContent='قراءة مباشرة لمعلومات عامة من GitHub. الرسائل المرسلة لا تعني تسليمًا إلى محادثة ChatGPT. لا توجد مصادقة تربط اسم الكاتب بهوية مستلم الدردشة.';
  }catch(error){
   status.textContent='تعذر تحديث البيانات من GitHub: '+safe(error.message)+'. الحالة الحالية غير متحققة؛ لا تُعرض نتائج قديمة باعتبارها حية.';
  }finally{button.disabled=false}
 }
 button.addEventListener('click',refresh);
 refresh();
}
if(typeof document!=='undefined')initMonitor();
