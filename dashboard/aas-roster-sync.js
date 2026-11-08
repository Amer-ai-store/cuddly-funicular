import './aas/host-connection.js';
import {OFFICIAL_AGENTS,prepareOfficialRoster} from './aas/official-agent-roster.mjs';

const button=document.querySelector('#roster-sync'),status=document.querySelector('#roster-result');
let pending=false;
const show=message=>{status.textContent=message;};
async function req(path,options={}){
  const response=await fetch('/api/v1/'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  let body=null;try{body=await response.json();}catch{}
  if(!response.ok){const message=body?.error?.message||'رد خادم غير ناجح: '+response.status;const error=new Error(message);error.status=response.status;throw error;}
  return body;
}
async function sync(){
  if(pending)return;
  if(!window.AASOwnerConnection?.isConnected()){show('يلزم اتصال المالك بالخادم الخاص أولًا.');window.AASOwnerConnection?.connect();return;}
  pending=true;button.disabled=true;show('يُفحص سجل الوكلاء الخاص وصلاحيات المالك...');
  try{
    const snapshot=await req('state');
    if(!Number.isSafeInteger(snapshot?.revision)||!snapshot?.state)throw Error('تعذر إثبات نسخة الحالة الحالية، أُلغي الاستيراد.');
    const plan=prepareOfficialRoster(snapshot.state);
    if(!plan.summary.changed){show('تأكد وجود تعريفات الوكلاء الـ19 في الحالة الخاصة. التشغيل الآلي والنماذج غير متصلين حتى فحصهما مستقلاً.');return;}
    show('تم تحديد '+plan.summary.added+' وكلاء جدد و'+plan.summary.createdWorkspaces+' مساحات؛ جارٍ التحقق من صحة البيانات دون تغيير المصدر.');
    const validation=await req('import/validate',{method:'POST',body:JSON.stringify({data:plan.candidate})});
    if(validation?.valid!==true)throw Error('لم يعتمد الخادم خطة الترحيل؛ أُلغي النقل.');
    show('اجتازت الخطة التحقق؛ يجري تسجيلها مع قفل مراجعة الحالة الحالية...');
    await req('actions',{method:'POST',body:JSON.stringify({expectedRevision:snapshot.revision,operation:'importData',payload:{data:plan.candidate}})});
    const latest=await req('state');
    const ids=new Set(latest?.state?.agents?.map(a=>a.id));
    const allPresent=OFFICIAL_AGENTS.every(a=>ids.has(a.id));
    const protectedFields=['tasks','approvals','commerce','workflows','settings'];
    const preserved=protectedFields.every(key=>JSON.stringify(snapshot.state[key])===JSON.stringify(latest.state[key]));
    if(!allPresent||!preserved)throw Error('الاستيراد أُرسل لكن فشل أحد اختبارات القراءة اللاحقة؛ لا تعِد الإرسال حتى مراجعة السجل.');
    show('تم التحقق من تسجيل '+OFFICIAL_AGENTS.length+' تعريفًا رسميًا لدى المالك. أُضيف '+plan.summary.added+' وكيلًا و'+plan.summary.createdWorkspaces+' مساحات، وحُفظت المهام والموافقات والبيانات المحمية. حالة تشغيل النماذج: غير متصل.');
  }catch(e){show((e.status===409?'تعارضت مراجعة البيانات مع جلسة أخرى؛ لم يُعَد إرسال أي تغيير. ':'')+'توقف التسجيل: '+(e.message||'خطأ اتصال')+'. لا يعني ذلك تشغيل أي وكيل.');}
  finally{pending=false;button.disabled=false;}
}
button.addEventListener('click',sync);
window.addEventListener('aas-host-connected',sync);
