import {BRIDGE_CHANNEL,APPROVED_ORIGIN,validateBridgeRequest,boundedBridgeText} from './bridge-protocol.js';
const status=document.getElementById('bridge-status'),source=window.opener,session=location.hash.slice(1),active=new Map();
const validSession=/^[a-f0-9]{64}$/.test(session);
const send=message=>source?.postMessage({channel:BRIDGE_CHANNEL,session,...message},APPROVED_ORIGIN);
let authorized=false;
document.getElementById('bridge-close').addEventListener('click',()=>{send({type:'disconnected'});window.close();});
window.addEventListener('message',async event=>{
  if(!authorized||event.origin!==APPROVED_ORIGIN||event.source!==source||event.data?.channel!==BRIDGE_CHANNEL||event.data.session!==session)return;
  const message=event.data;
  if(message.type==='cancel'){active.get(message.id)?.abort();return;}
  if(message.type!=='request')return;
  const request=validateBridgeRequest(message);
  if(!request||active.has(request.id)||active.size>=16){send({type:'response',id:message.id,error:'رُفض طلب اتصال غير صالح أو متكرر.'});return;}
  const controller=new AbortController();active.set(request.id,controller);const timer=setTimeout(()=>controller.abort(),60000);
  try{
    const response=await fetch(request.path,{method:request.method,headers:request.headers,body:request.body,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    const body=await boundedBridgeText(response),headers=[...response.headers].filter(([key])=>['content-type','etag','content-disposition'].includes(key));
    send({type:'response',id:request.id,status:response.status,headers,body});
  }catch{send({type:'response',id:request.id,error:'تعذر إكمال الطلب عبر جلسة المالك. راجع الاتصال والحالة قبل إعادة أي تعديل.'});}
  finally{clearTimeout(timer);active.delete(request.id);}
});
window.addEventListener('pagehide',()=>{for(const controller of active.values())controller.abort();send({type:'disconnected'});});
if(!source||!validSession)status.textContent='افتح الاتصال من زر «اتصال بالخادم الخاص» داخل اللوحة المعتمدة. إذا انتهى تسجيل الدخول، اضغط الزر هناك مرة أخرى.';
else{
  try{
    const response=await fetch('/api/v1/assistant/capabilities',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();await response.json();authorized=true;
    status.textContent='اتصلت جلسة المالك. يمكنك استخدام جميع شاشات AAS في اللوحة المعتمدة.';send({type:'ready'});
  }catch{status.textContent='لم تُثبت جلسة المالك. أعد فتح الاتصال من اللوحة بعد تسجيل الدخول إلى الموقع الخاص.';send({type:'connection-error'});}
}
