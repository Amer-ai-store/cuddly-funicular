'use strict';
/*
 * Public-only central migration audit. Source presence and exact asset SHA-256
 * are NOT equivalent to operational agent, database or private API acceptance.
 * This module performs same-origin, read-only GET requests. No credentials,
 * production SQL, backend writes, or secrets are handled here.
 */
const host=document.getElementById('central-transfer-audit-root');
if(host){
  const e=(tag,value,cls)=>{
    const node=document.createElement(tag);
    if(value!==undefined)node.textContent=String(value);
    if(cls)node.className=cls;
    return node;
  };
  const heading=e('h2','التحقق من اكتمال نقل اللوحات والوكلاء والارتباطات');
  const intro=e('p','مطابقة الملفات المنشورة بالمصدر، مع فصل حالة الكود عن اتصال الخوادم والبيانات ووكلاء الذكاء الاصطناعي.','muted');
  const summary=e('div',undefined,'toolbar');
  const message=e('p','جارٍ قراءة بيان المطابقة العام...','muted');
  message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const table=e('div',undefined,'table-wrap');
  const actions=e('div',undefined,'toolbar');
  const check=e('button','إعادة فحص البصمات على الموقع المنشور');
  check.type='button';
  const roster=e('a','دليل وتسجيل الوكلاء');roster.href='./aas-roster.html';roster.className='btn';
  const aas=e('a','مساحات AAS');aas.href='#aas-agents';aas.className='btn';
  const trust=e('a','واجهة TrustSoft');trust.href='#jawafa-trustsoft';trust.className='btn';
  const issue=e('a','متطلبات مراجعة النشر');issue.href='https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/149';issue.target='_blank';issue.rel='noopener noreferrer';
  actions.append(check,roster,aas,trust,issue);
  host.append(heading,intro,summary,message,table,actions);
  const base='https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/blob/main/';
  const statuses={
    verified:'مثبت: ملفات ومصدر منشور',
    present:'موجود في الكود',
    unverified:'لم يثبت التشغيل الفعلي',
    pending:'قيد التطوير وغير مدمج',
    blocked:'محجوب ببوابة قبول'
  };
  let audit=null,busy=false;
  function clear(node){node.replaceChildren()}
  function indicator(title,value){const box=e('span',title+': '+value,'pill');summary.append(box)}
  function render(report){
    clear(summary);clear(table);
    indicator('شاشات الواجهة',report.public_inventory.main_native_views);
    indicator('مسارات التنقل',report.public_inventory.main_navigation_destinations);
    indicator('AAS',report.public_inventory.aas_routes+' قسمًا');
    indicator('الملفات المفحوصة',report.public_inventory.aas_files_hash_verified+'/'+report.public_inventory.aas_manifest_files);
    indicator('وكلاء رسميون',report.public_inventory.official_agent_definitions);
    indicator('ملفات الوكلاء التنظيمية',report.public_inventory.organizational_agent_profiles);
    indicator('شاشات جوافة',report.public_inventory.jawafa_existing_panes);
    indicator('TrustSoft العام',report.public_inventory.trustsoft_published_sections+' قسمًا');
    const grid=e('table'),thead=e('thead'),tr=e('tr'),tbody=e('tbody');
    for(const h of ['المنظومة','حالة النقل','حالة التشغيل','التغطية','ما لم يثبت','الدليل'])tr.append(e('th',h));
    thead.append(tr);grid.append(thead);
    for(const row of report.sections){
      const r=e('tr');
      r.append(e('td',row.title),e('td',statuses[row.source_status]),
        e('td',statuses[row.runtime_status]),e('td',row.count),e('td',row.note));
      const td=e('td'),link=e('a','مصدر GitHub');
      link.href=base+row.evidence.split('/').map(encodeURIComponent).join('/');
      link.target='_blank';link.rel='noopener noreferrer';
      td.append(link);r.append(td);tbody.append(r);
    }
    grid.append(tbody);table.append(grid);
    const note=e('p',report.limitations,'muted');
    const date=e('p','تقييم المصدر: '+report.verified_date+' • نسخة المصدر: '+report.checked_source_commit.slice(0,12)+' • المعلومات عامة فقط.','muted small');
    table.append(date,note);
    if(Array.isArray(report.legacy_source_gaps)){
      table.append(e('h3','وظائف سابقة تحتاج نقلًا وتحققًا وظيفيًا'));
      const legacyTable=e('table'),head=e('thead'),header=e('tr'),body=e('tbody');
      for(const x of ['الوظيفة القديمة','المصدر السابق','الوظائف الموجودة سابقًا','نتيجة مطابقة النقل','المخاطر'])header.append(e('th',x));
      head.append(header);legacyTable.append(head);
      for(const gap of report.legacy_source_gaps){
        const tr=e('tr');
        tr.append(e('td',gap.title),e('td',gap.source_app),
          e('td',gap.source_features.join('، ')),
          e('td','لم يثبت انتقال الوظيفة والبيانات إلى اللوحة المركزية'),
          e('td',gap.risk));
        body.append(tr);
      }
      legacyTable.append(body);table.append(legacyTable);
    }
    const negative=report.private_connection_checks;
    if(negative){
      table.append(e('p','فحص الاتصال الخاص بدون تسجيل الدخول: HTTP '+
        negative.private_aas_state_http_status+
        '. نجاح الرفض لا يثبت اتصال المالك ولا مزامنة مهام D1 أو تشغيل وكلاء AI.','muted'));
    }
    message.textContent='المصفوفة قائمة على أدلة عامة. لا تعتبر «موجود في الكود» اعتمادًا لتنفيذ مهمة أو اتصال نموذج AI.';
  }
  async function getJson(url,signal){
    const response=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',
      headers:{Accept:'application/json'},signal});
    if(!response.ok)throw Error('HTTP '+response.status+' — '+url);
    return response.json();
  }
  async function load(){
    try{
      const response=await getJson('./data/central-transfer-audit.json');
      const allowed=new Set(Object.keys(statuses));
      if(response?.schema!=='aas.central.transfer.audit.v1'||
         response.scope!=='PUBLIC_METADATA_ONLY_NO_PRIVATE_DB_ROWS_NO_SECRETS'||
         !Array.isArray(response.sections)||response.sections.length!==8||
         !response.sections.every(x=>allowed.has(x.source_status)&&allowed.has(x.runtime_status)&&
           typeof x.evidence==='string'&&/^dashboard\/[a-zA-Z0-9_./-]+$/.test(x.evidence)&&
           !x.evidence.includes('..'))||
         response.public_inventory?.aas_manifest_files!==17||
         !Array.isArray(response.legacy_source_gaps)||response.legacy_source_gaps.length!==2||
         !response.legacy_source_gaps.every(x=>Array.isArray(x.source_features)&&x.source_features.length>0&&
           typeof x.risk==='string'&&typeof x.title==='string')||
         response.private_connection_checks?.owner_authenticated_read_verified!==false)
        throw Error('بيان المطابقة لا يطابق عقد النشر الآمن.');
      audit=response;render(response);
    }catch(err){
      message.textContent='لم يمكن التحقق من بيان المطابقة: '+String(err.message||err).slice(0,160);
      check.disabled=true;
    }
  }
  const sha=async bytes=>{
    if(!globalThis.crypto?.subtle)throw Error('متصفحك لا يدعم فحص SHA-256؛ لا يمكن إثبات التطابق.');
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  async function inspectFile(file,signal){
    if(typeof file?.path!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(file.path)||
       file.path.includes('..')||!Number.isSafeInteger(file.bytes)||file.bytes<0||
       !/^[a-f0-9]{64}$/i.test(file.sha256))throw Error('اسم الملف أو بصمته غير صالح.');
    const response=await fetch('./aas/'+file.path+'?transfer-audit=1',{
      cache:'no-store',credentials:'omit',redirect:'error',signal
    });
    if(!response.ok)throw Error('HTTP '+response.status+' '+file.path);
    const body=await response.arrayBuffer();
    if(body.byteLength!==file.bytes)return {path:file.path,status:'MISMATCH'};
    const actual=await sha(body);
    return {path:file.path,status:actual===file.sha256.toLowerCase()?'MATCH':'MISMATCH'};
  }
  async function verifyAssets(){
    if(busy||!audit)return;
    busy=true;check.disabled=true;
    message.textContent='فحص مباشر لبصمات الملفات المنشورة؛ لا تُمثّل النتيجة تحققًا من بيانات D1 أو صلاحيات SQL...';
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),90000);
    try{
      const manifest=await getJson('./aas/integration-manifest.json?transfer-audit=1',abort.signal);
      if(manifest?.format!=='aas-cc-integrated-client-v1'||
         !Array.isArray(manifest.files)||manifest.files.length!==17||
         !Array.isArray(manifest.routes)||manifest.routes.length!==14||
         manifest.productionDataCopied!==false||manifest.credentialsCopied!==false)
        throw Error('فشل فحص بيان دمج AAS الرسمي.');
      const results=[];
      // Three workers keep the check small and predictable on mobile devices.
      let index=0;
      async function worker(){
        while(index<manifest.files.length){
          const file=manifest.files[index++];
          try{results.push(await inspectFile(file,abort.signal));}
          catch(err){results.push({path:String(file.path||'غير معروف'),status:'FAILED',reason:String(err.message||err).slice(0,100)});}
          message.textContent='تم فحص '+results.length+' من '+manifest.files.length+' ملفًا...';
        }
      }
      await Promise.all([worker(),worker(),worker()]);
      const ok=results.filter(x=>x.status==='MATCH').length;
      const fail=results.filter(x=>x.status!=='MATCH');
      message.textContent=fail.length===0?
        'تم إثبات تطابق '+ok+'/'+results.length+' ملفًا منشورًا ببصمة SHA-256 الحالية؛ الربط التشغيلي للوكلاء والمهام لا يزال بحاجة إلى اعتماد منفصل.':
        'فحص الملفات غير مكتمل: تطابق '+ok+'/'+results.length+'؛ فشل أو اختلاف '+fail.length+
        ' ('+fail.slice(0,3).map(x=>x.path).join('، ')+'). لا يُعتمد النقل.';
    }catch(err){
      message.textContent='تعذّر إثبات تطابق النسخة المنشورة: '+String(err.message||err).slice(0,180);
    }finally{clearTimeout(timeout);busy=false;check.disabled=false;}
  }
  check.addEventListener('click',verifyAssets);
  load();
}
