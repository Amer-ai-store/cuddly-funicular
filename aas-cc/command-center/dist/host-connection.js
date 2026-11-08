import {BRIDGE_CHANNEL,PRIVATE_ORIGIN,MAX_BRIDGE_BYTES} from './bridge-protocol.js';
if(document.documentElement.dataset.aasHost==='approved'){
  const nativeFetch=globalThis.fetch.bind(globalThis),pending=new Map();
  let popup=null,session='',connected=false,connecting=false,connectionTimer,watcher;
  const bar=document.createElement('aside');bar.className='host-connection';bar.setAttribute('aria-label','اتصال الخادم الخاص');
  const text=document.createElement('span');text.setAttribute('role','status');text.textContent='الواجهة ضمن اللوحة المعتمدة. اتصل بجلسة المالك لقراءة العمل وحفظه.';
  const button=document.createElement('button');button.type='button';button.className='button primary small';button.textContent='اتصال بالخادم الخاص';
  bar.append(text,button);document.body.prepend(bar);
  function disconnect(message){connected=false;connecting=false;clearTimeout(connectionTimer);clearInterval(watcher);button.disabled=false;button.textContent='إعادة الاتصال بالخادم';text.textContent=message;for(const job of pending.values())job.reject(Error(message));pending.clear();}
  function connect(){
    if(connected&&popup&&!popup.closed){popup.focus();return;}
    if(connecting)return;disconnect('جارٍ فتح جلسة المالك…');connecting=true;button.disabled=true;
    session=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
    popup=window.open(PRIVATE_ORIGIN+'/host-bridge.html#'+session,'aas-cc-owner-connection-'+session.slice(0,12),'popup,width=640,height=760');
    if(!popup){disconnect('المتصفح منع نافذة الاتصال. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجددًا.');return;}
    connectionTimer=setTimeout(()=>disconnect('لم يكتمل الاتصال خلال 15 ثانية. أكمل تسجيل الدخول في النافذة ثم اضغط إعادة الاتصال.'),15000);
    watcher=setInterval(()=>{if(!popup||popup.closed)disconnect('أُغلقت نافذة جلسة المالك. أعد الاتصال لمتابعة الحفظ.');},700);
  }
  button.addEventListener('click',connect);
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.origin!==PRIVATE_ORIGIN||event.source!==popup||message?.channel!==BRIDGE_CHANNEL||message.session!==session)return;
    if(message.type==='ready'&&connecting){clearTimeout(connectionTimer);connected=true;connecting=false;button.disabled=false;button.textContent='فتح نافذة الاتصال';text.textContent='متصل بالخادم الخاص · أبقِ نافذة جلسة المالك مفتوحة.';window.dispatchEvent(new Event('aas-host-connected'));return;}
    if(message.type==='disconnected'||message.type==='connection-error'){disconnect('توقفت جلسة المالك. أعد تسجيل الدخول ثم افتح الاتصال مجددًا.');return;}
    if(message.type!=='response'||!connected)return;
    const job=pending.get(message.id);if(!job)return;pending.delete(message.id);
    if(message.error){job.reject(Error(message.error));return;}
    try{if(!Number.isInteger(message.status)||message.status<200||message.status>599||typeof message.body!=='string'||new TextEncoder().encode(message.body).length>MAX_BRIDGE_BYTES)throw Error();job.resolve(new Response([204,205,304].includes(message.status)?null:message.body,{status:message.status,headers:message.headers}));}
    catch{job.reject(Error('رد قناة الاتصال غير صالح.'));}
  });
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/v1/'))return nativeFetch(input,options);
    if(!connected||!popup||popup.closed)return new Response(JSON.stringify({error:{code:'owner_connection_required',message:'اضغط «اتصال بالخادم الخاص» وأكمل تسجيل دخول المالك.'}}),{status:503,headers:{'Content-Type':'application/json'}});
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const id=crypto.randomUUID(),headers=[...new Headers(options.headers)],body=options.body??null;
    if(body!==null&&(typeof body!=='string'||new TextEncoder().encode(body).length>MAX_BRIDGE_BYTES))throw Error('حجم الطلب أو نوعه غير مدعوم في قناة الاتصال.');
    let abort,timer;
    try{return await new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});
      abort=()=>{if(!pending.delete(id))return;popup?.postMessage({channel:BRIDGE_CHANNEL,session,type:'cancel',id},PRIVATE_ORIGIN);reject(new DOMException('Aborted','AbortError'));};
      options.signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,60000);
      popup.postMessage({channel:BRIDGE_CHANNEL,session,type:'request',id,path:url.pathname+url.search,method:(options.method||'GET').toUpperCase(),headers,body},PRIVATE_ORIGIN);
    });}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);pending.delete(id);}
  };
  // No credentials, messages or connection state are persisted in browser storage.
  window.addEventListener('pagehide',()=>disconnect('انتهت جلسة هذه الصفحة.'));
  window.AASOwnerConnection={connect,isConnected:()=>connected};
}
