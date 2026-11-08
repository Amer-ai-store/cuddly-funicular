/* Public health only. Never place JWTs or service-role keys in static assets. */
export const CCA999_AGENT_HEALTH='https://zvedrouuboxgbanzdnio.supabase.co/functions/v1/cca999-message-agent/health';
export function evaluateAgentHealth(payload,ok){
 if(ok===true&&payload?.ok===true&&payload?.database_reachable===true&&payload?.service==='cca999-message-agent')
  return {status:'BACKEND_REACHABLE',label:'الخادم وقاعدة الرسائل يستجيبان · تسليم المحادثات غير مثبت'};
 return {status:'NOT_VERIFIED',label:'لم يثبت اتصال API بقاعدة الرسائل'};
}
export function initApiAgentHealth(){
 const root=document.querySelector('[data-view="cca999-task-flow"]');
 if(!root)return;
 const status=root.querySelector('#cca999-agent-api-status'),button=root.querySelector('#cca999-agent-api-refresh');
 if(!status||!button)return;
 async function check(){
  button.disabled=true;status.textContent='جارٍ فحص خدمة API وقاعدة الرسائل دون إرسال بيانات...';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch(CCA999_AGENT_HEALTH,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
   const data=await response.json();
   const verdict=evaluateAgentHealth(data,response.ok);
   status.textContent=verdict.label+' · '+new Date().toLocaleString('ar-JO')+
    '. إثبات DELIVERED / READ / ACK / REPLY يتطلب مصادقة المستلم وحدثاً مسجلاً منفصلاً.';
  }catch{
   status.textContent='تعذر الاتصال بخدمة API الآن. لا توجد شهادة تشغيل حي ولا استلام مثبت.';
  }finally{clearTimeout(timer);button.disabled=false}
 }
 button.addEventListener('click',check);
 check();
}
if(typeof document!=='undefined')initApiAgentHealth();
