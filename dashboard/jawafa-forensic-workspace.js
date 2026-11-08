/* Public forensic workflow / source-status; not a financial records viewer.
 * No private links, JWTs, financial values, person names, SQL queries or credentials.
 */
'use strict';
(()=>{
  const root=document.getElementById('jawafa-forensic-workspace-root');
  if(!root)return;
  const make=(tag,text,cls)=>{
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=String(text);
    if(cls)e.className=cls;
    return e;
  };
  const heading=make('h2','دفتر التحقيق الموسع — الأدلة والقرائن');
  const note=make('p','البيانات هنا فهرس محاور عام فقط. تفاصيل المستندات والتوقيعات والقيود والشيكات محفوظة للمالك في مخزن خاص، ولا يثبت أي محور تورط شخص.','muted');
  const badge=make('p','لم يتم تحميل سجل أولويات التحقيق.','muted');
  badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');
  const controls=make('div',undefined,'toolbar');
  const q=make('input');q.type='search';q.placeholder='بحث بمحور التحقيق';q.maxLength=90;q.setAttribute('aria-label','البحث في محاور التحقيق');
  const pri=make('select');pri.setAttribute('aria-label','تصفية حسب الأولوية');
  for(const [value,label] of [['all','كل الأولويات'],['P0','P0 — عاجل'],['P1','P1 — متابعة']]){
    const option=make('option',label);option.value=value;pri.append(option);
  }
  pri.value='all';
  const reload=make('button','تحديث بيانات الفهرس');reload.type='button';
  controls.append(q,pri,reload);
  const source=make('section',undefined,'panel'),rows=make('div',undefined,'table-wrap');
  const send=make('section',undefined,'panel');
  const integration=make('section',undefined,'panel');
  root.replaceChildren(heading,note,badge,controls,rows,source,send,integration);
  const allowed=new Set(['P0','P1']);
  let model=null,busy=false;
  function text(container,message){
    container.replaceChildren(make('p',message,'muted'));
  }
  function table(data){
    rows.replaceChildren();
    if(!data.length){rows.append(make('p','لا توجد محاور مطابقة.','muted'));return;}
    const tbl=make('table'),head=make('thead'),th=make('tr'),body=make('tbody');
    const columns=[['id','الرمز'],['priority','الأولوية'],['title','المحور'],['basis','نوع المصدر'],['next','شرط التحقق'],['status','الاعتماد']];
    columns.forEach(([,label])=>th.append(make('th',label)));head.append(th);tbl.append(head);
    for(const caseItem of data){
      const tr=make('tr');
      for(const [key] of columns){
        const value=key==='status'?'مراجعة مستقلة مطلوبة':caseItem[key];
        tr.append(make('td',value));
      }
      body.append(tr);
    }
    tbl.append(body);rows.append(tbl);
  }
  function render(){
    if(!model)return;
    const query=q.value.trim().toLowerCase(),priority=pri.value;
    const filtered=model.cases.filter(c=>
      (priority==='all'||c.priority===priority)&&
      (!query||(c.id+' '+c.title+' '+c.basis+' '+c.next).toLowerCase().includes(query)));
    badge.textContent='محاور التحقيق: '+model.cases.length+' — المعروض: '+filtered.length+
      ' — P0: '+model.cases.filter(c=>c.priority==='P0').length+
      ' / P1: '+model.cases.filter(c=>c.priority==='P1').length;
    table(filtered);
    source.replaceChildren(make('h3','سلسلة المصدر: ما هو مثبت وما لم يثبت'));
    const sc=model.source_connection;
    const status=make('p','فحص سابق للخدمة المحلية على JAWAFFASVR: '+
      sc.local_schema_tables_observed+' جدولًا و'+sc.local_declared_fk_observed+
      ' علاقة معلنة عند '+sc.last_local_bridge_probe_utc+'.','muted');
    const limitation=make('p','لا يعرض GitHub Pages سجلات SQL مباشرة. فحص المخطط المحلي لا يثبت مصادقة المالك من الإنترنت ولا وصول التقارير المالية الحية. آخر تصدير معروف '+sc.new_tables_exported+'/'+sc.total_tables+
      ' (مرجع سابق غير معاد تصديره).','muted');
    source.append(status,limitation);
    send.replaceChildren(make('h3','الإحالة إلى الإدارة'));
    send.append(make('p','الوجهة: المدير التنفيذي 777 عبر موزع المهام 2. المرجع الخاص: '+model.report_ref+'.','muted'));
    send.append(make('p','حالة التسليم: '+model.delivery.state+
      '. لا يوجد دليل مستقل على وصول مدير أو قراءة أو إقرار ACK بعد.','muted'));
    const mailbox=make('a','الاطلاع على إثبات رسالة التنسيق');mailbox.href='https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/168#issuecomment-'+model.delivery.github_comment_id;
    mailbox.target='_blank';mailbox.rel='noopener noreferrer';send.append(mailbox);
    integration.replaceChildren(make('h3','مدخل المصدر الخاص — لا يُظهر بيانات مالية للعامة'));
    const info=make('p','تستخدم الشاشة الخاصة HTTPS داخل شبكة المالك، ومصادقة الهوية قبل أي قراءة؛ لا تربط الواجهة العامة مباشرة بخادم SQL.','muted');
    const wrap=make('div',undefined,'toolbar');
    const url=make('input');url.type='url';url.placeholder='https://your-private-node.ts.net:8448';url.setAttribute('aria-label','عنوان HTTPS الخاص من Tailscale');url.autocomplete='off';url.spellcheck=false;
    const open=make('button','فتح شاشة التحقيق الخاصة');open.type='button';
    const result=make('span','يتطلب إدخال عنوان الخدمة الخاصة من جهاز مصرح له.','muted');
    wrap.append(url,open,result);integration.append(info,wrap);
    open.onclick=()=>{
      try{
        const u=new URL(url.value);
        if(u.protocol!=='https:'||u.username||u.password||!u.hostname.endsWith('.ts.net')||
           !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(u.hostname)||
           !['8448','443'].includes(u.port)||u.search||u.hash||u.pathname!=='/')
          throw Error('INVALID_PRIVATE_ENDPOINT');
        u.pathname='/audit15.html';
        // No credentials or document IDs are attached. Private backend re-authenticates.
        const tab=window.open(u.href,'_blank','noopener,noreferrer');
        result.textContent=tab===null?'إن كان المتصفح منع النافذة، اسمح بفتح الرابط على شبكة Tailscale.':'فُتح عنوان الواجهة الخاصة؛ حالة الاتصال الفعلي لا تتأكد إلا بعد دخول المالك.';
      }catch{
        result.textContent='العنوان غير مقبول: يلزم HTTPS من نطاق Tailscale المصرح به، دون بيانات اعتماد.';
      }
    };
    const trust=make('p','يمكن أيضًا فتح واجهة TrustSoft الحالية من قسمها، لكن لا تعتمد اتصال SQL دون تسجيل الدخول والتحقق من استجابة حديثة.','muted');
    integration.append(trust);
  }
  async function load(){
    if(busy)return;busy=true;reload.disabled=true;
    try{
      const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),9000);
      let response;
      try{response=await fetch('./data/jawafa-forensic-workspace-public.json',{
        credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal:ctrl.signal});
      }finally{clearTimeout(timeout)}
      if(!response.ok)throw Error('HTTP '+response.status);
      const obj=await response.json();
      if(obj?.schema!=='jawafa.public.forensic-workspace.v1'||
         obj?.classification!=='PUBLIC_TOPIC_METADATA_NO_PERSONAL_OR_FINANCIAL_RECORDS'||
         !Array.isArray(obj.cases)||obj.cases.length!==26||
         obj.cases.some(x=>!allowed.has(x.priority)||!/^P[01]-\d\d$/.test(x.id)||typeof x.title!=='string')||
         obj.source_connection?.full_live_sql_financial_e2e_verified!==false||
         obj.delivery?.manager_ack_verified!==false)
         throw Error('PUBLIC_CASE_SCHEMA_INVALID');
      model=obj;render();
    }catch(err){model=null;badge.textContent='تعذر قراءة فهرس التحقيق؛ لا تُعرض بيانات افتراضية.';text(rows,String(err.message||err).slice(0,130))}
    finally{busy=false;reload.disabled=false}
  }
  q.addEventListener('input',render);pri.addEventListener('change',render);
  reload.addEventListener('click',load);load();
})();