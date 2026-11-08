// Operational views consume server observations; they never simulate workers or receipts.
export function createControlCenter({getStore,getState,helpers,openModal,closeModal,toast,navigate,openTask,openAgent,newTask,downloadConnection}) {
  const {esc,icon,badge,date,titleBlock}=helpers;
  const ownRoutes=new Set(['orchestration','advisor','database']);
  const cache={coordination:null,database:null,history:null,assistantCapabilities:null,providerHealth:null};
  const loading={coordination:false,database:false,history:false,assistantCapabilities:false,providerHealth:false};
  const errors={coordination:null,database:null,history:null,assistantCapabilities:null,providerHealth:null};
  let currentRoute='',disposed=false,lastRevision=null,selectedAgent='',selectedNode='',taskStatus='all',taskQuery='',selectedBridge='',selectedTable='';
  let chatDraft='',chatSending=false,chatReply=null,pendingReview=null,pendingDatabase=null,observer,providerTesting=false;
  const savedViews=new Map();
  let orgCentered=false,providerHealthVersion=0;
  const labels={queued:'في الانتظار',running:'قيد العمل يدويًا',review:'بانتظار المراجعة',done:'مكتملة',active:'نشط',pending:'بانتظار المنفّذ',applied:'نُفّذت بإيصال',rejected:'مرفوضة',failed:'فشلت',blocked:'متوقفة بسبب عائق',complete:'مكتمل',ready:'جاهز للإعداد',paused:'متوقف',online:'وصلت ملاحظة حديثة',offline:'لا يوجد اتصال حديث',stale:'الملاحظة قديمة · لا اتصال حديث',waiting:'بانتظار أول اتصال',unverified:'بانتظار أول اتصال',high:'عالية',medium:'متوسطة',low:'منخفضة',analysis:'تحليل',implementation:'تعديل أو إضافة',verification:'تحقق'};
  const label=value=>labels[value]||value||'غير متاح';
  const pill=(value,text)=>`<span class="status-badge ${esc(['applied','complete'].includes(value)?'done':['failed','rejected','blocked'].includes(value)?'rejected':value==='running'?'running':'queued')} ${['high','medium','low'].includes(value)?'priority-'+value:''}">${esc(text||label(value))}</span>`;
  const json=value=>esc(JSON.stringify(value,null,2));
  const button=(action,text,attrs='',cls='secondary')=>`<button class="button ${cls} small" data-action="cc-${action}" ${attrs}>${text}</button>`;
  const empty=(title,text)=>`<div class="empty-state">${icon('layers')}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  function notice(key) {
    if(errors[key])return `<div class="info-banner compact" role="status">${icon('info')}<p>${esc(errors[key])}${cache[key]?' المعروض آخر قراءة ناجحة؛ قد تكون تغيّرت.':''}</p>${button('refresh','إعادة المحاولة',`data-key="${key}"`)}</div>`;
    return !cache[key]?`<div class="info-banner compact" role="status">${icon('clock')}<p>جارٍ قراءة البيانات من الخادم…</p></div>`:'';
  }
  function viewSnapshot() {
    const active=document.activeElement;
    return {focus:active?.id,start:active?.selectionStart,end:active?.selectionEnd,details:[...document.querySelectorAll('#control-center-stage details')].map(el=>el.open),scroll:[...document.querySelectorAll('[data-cc-scroll]')].map(el=>({key:el.dataset.ccScroll,left:el.scrollLeft,top:el.scrollTop}))};
  }
  function restore(view) {
    if(!view)return;document.querySelectorAll('#control-center-stage details').forEach((el,index)=>{if(view.details?.[index]!==undefined)el.open=view.details[index];});
    for(const item of view.scroll){const el=[...document.querySelectorAll('[data-cc-scroll]')].find(el=>el.dataset.ccScroll===item.key);if(el){el.scrollLeft=item.left;el.scrollTop=item.top;}}
    const el=view.focus&&document.getElementById(view.focus);if(el){el.focus({preventScroll:true});if(typeof view.start==='number'&&typeof el.setSelectionRange==='function')el.setSelectionRange(view.start,view.end);}
  }
  function updateStage() {
    if(disposed)return;
    const stage=document.querySelector('#control-center-stage');
    if(stage&&ownRoutes.has(currentRoute)){const view=viewSnapshot();stage.innerHTML=stagePage(currentRoute);restore(view);observeGraph();}
    const overview=document.querySelector('#overview-coordination');if(overview)overview.innerHTML=overviewBody();
  }
  async function load(key,{quiet=false}={}) {
    const store=getStore();if(!Object.hasOwn(cache,key)||!store||loading[key])return;
    const previous=cache[key],previousError=errors[key],healthVersion=providerHealthVersion;let changed=!previous;
    loading[key]=true;if(!quiet&&!previous)updateStage();
    try {
      let value;
      if(key==='coordination')value=await store.getCoordination();
      if(key==='database')value=await store.getDatabase();
      if(key==='history')value=await store.getAssistantHistory();
      if(key==='assistantCapabilities')value=await store.getAssistantCapabilities();
      if(key==='providerHealth')value=await store.getProviderHealth();
      if(disposed||(key==='providerHealth'&&healthVersion!==providerHealthVersion))return;
      if(key==='coordination'&&(!value?.organization||!Array.isArray(value.queue)||!value.graph))throw new Error('استجابة خريطة العمل غير متوافقة.');
      if(key==='database'&&!Array.isArray(value?.bridges))throw new Error('استجابة قاعدة البيانات غير متوافقة.');
      if(key==='history'&&!Array.isArray(value?.messages))throw new Error('استجابة سجل المحادثة غير متوافقة.');
      if(key==='coordination'&&cache[key]?.revision>value.revision)return;
      const comparable=input=>key==='coordination'&&input?{...input,checkedAt:undefined,generatedAt:undefined}:input;
      changed=JSON.stringify(comparable(previous))!==JSON.stringify(comparable(value));
      cache[key]=value;errors[key]=null;
    }catch(error){if(!disposed&&(key!=='providerHealth'||healthVersion===providerHealthVersion))errors[key]=error.message||'تعذّرت قراءة هذه الخدمة.';}
    finally{loading[key]=false;if(changed||previousError!==errors[key])updateStage();if(!disposed&&key==='providerHealth'&&healthVersion!==providerHealthVersion)load('providerHealth',{quiet:true});}
  }
  function overviewBody(){
    const c=cache.coordination;
    return `<section class="panel advisor-panel"><div class="panel-header"><div><h2>توزيع العمل والمستشار</h2><p class="panel-subtitle">${c?'قراءة قواعد التنسيق: '+esc(date(c.checkedAt||c.generatedAt,true)):'تُقرأ خريطة الفريق من حالة المؤسسة'}</p></div><button class="link-button" data-route="orchestration">الخريطة الحية ${icon('arrow')}</button></div><div class="panel-body">${c?`<div class="data-actions"><span>${c.organization.agents.length} ملفات تنظيمية</span><span>${c.queue.filter(task=>task.status==='queued'&&task.dispatchable).length} مهام انتظار جاهزة</span><span>${c.queue.filter(task=>task.blockers.length&&task.status!=='done').length} مهام لها عوائق</span><span>${c.advisors.length} توصيات من الحالة</span></div>`:'<p class="muted">لا يُفترض تشغيل أي نموذج أو منفّذ قبل استلام دليل فعلي.</p>'}<div class="data-actions"><button class="button secondary small" data-route="advisor">المستشار والمحادثة</button><button class="button secondary small" data-route="database">قاعدة البيانات المحلية</button></div></div></section>`;
  }
  function organization(c){
    const agents=c.organization.agents,byId=new Map(agents.map(agent=>[agent.id,agent])),levels=[];
    function depth(agent,seen=new Set()){if(!agent.managerAgentId||!byId.has(agent.managerAgentId)||seen.has(agent.id))return 0;return 1+depth(byId.get(agent.managerAgentId),new Set([...seen,agent.id]));}
    for(const agent of agents){const level=Math.min(depth(agent),agents.length);(levels[level]??=[]).push(agent);}
    return `<section class="panel organization-panel"><div class="panel-header"><div><h2>الهيكل التنظيمي <span class="title-count">${agents.length}</span></h2><p class="panel-subtitle">اختر وكيلًا لإبراز مهامه على الخريطة</p></div>${button('agent-clear','كل الوكلاء',selectedAgent?'':'disabled')}</div><div class="org-chart-wrap" data-cc-scroll="organization"><div class="org-chart"><svg class="org-chart-edges" aria-hidden="true"></svg>${levels.filter(Boolean).map(level=>`<div class="org-level">${level.map(agent=>`<button class="org-node ${agent.id===c.organization.managerAgentId?'leader':''} ${selectedAgent===agent.id?'selected':''}" data-action="cc-agent" data-id="${esc(agent.id)}" data-org-node="${esc(agent.id)}" aria-pressed="${selectedAgent===agent.id}"><span class="org-node-head"><strong>${esc(agent.name)}</strong>${pill(agent.status)}</span><span class="org-role">${esc(agent.role)}</span><span class="org-node-meta">يتبع: ${esc(byId.get(agent.managerAgentId)?.name||'الإدارة المركزية')}<br>${agent.workload.total} مهام · ${agent.workload.running} معلّمة قيد العمل<br>النموذج: ${esc(agent.model||'غير متصل')}</span></button>`).join('')}</div>`).join('')}</div></div><p class="org-chart-note">هذه ملفات تنظيمية؛ عددها لا يعني تشغيل نماذج ذكاء اصطناعي. حالات المهام يحدّدها الفريق، وتنفيذ الكود يحتاج إيصال المنفّذ.</p></section>`;
  }
  function visibleNode(node,queue){
    if(node.type==='agent')return false;
    if(node.type!=='task')return !selectedAgent&&taskStatus==='all'&&!taskQuery;
    const task=queue.get(node.entityId);if(!task)return false;
    return (!selectedAgent||task.agentId===selectedAgent)&&(taskStatus==='all'||task.status===taskStatus)&&(!taskQuery||[task.title,...task.resourceKeys].join(' ').toLowerCase().includes(taskQuery.toLowerCase()));
  }
  function graph(c){
    const queue=new Map((getState()?.tasks||[]).map(task=>[task.id,{...task,taskId:task.id,dependencies:task.dependencies||[],resourceKeys:task.resourceKeys||[],blockers:[],dispatchable:false}]));for(const task of c.queue)queue.set(task.taskId,task);const nodes=c.graph.nodes.filter(node=>visibleNode(node,queue)),byId=new Map(nodes.map(node=>[node.id,node])),assigned=new Set();
    function nodeHtml(node){assigned.add(node.id);const task=queue.get(node.entityId),blocked=task?.blockers.length;return `<button class="task-graph-node ${selectedNode===node.id?'selected':''} ${blocked?'marked':''}" data-action="cc-node" data-id="${esc(node.id)}" data-priority="${esc(node.priority||'')}" data-graph-node="${esc(node.id)}" aria-pressed="${selectedNode===node.id}"><span class="task-node-type">${esc({task:'مهمة',workflow:'مسار تنفيذ',step:'خطوة','workflow-step':'خطوة'}[node.type]||node.type)}</span><strong>${esc(node.label)}</strong><span>${pill(node.status)}${node.priority?pill(node.priority,'الأولوية: '+label(node.priority)):''}</span>${node.phase?`<small>${esc(label(node.phase))}</small>`:''}${task?`<small>${task.dispatchable&&task.status==='queued'?'جاهزة للتكليف اليدوي':blocked?task.blockers.length+' عوائق مسجّلة':'حالة محفوظة على الخادم'}</small>`:''}</button>`;}
    const lanes=c.lanes.map(lane=>{
      const laneNodes=lane.kind==='workflow'?nodes.filter(node=>node.workflowId===lane.workflowId||node.id==='workflow:'+lane.workflowId):lane.taskIds.map(id=>byId.get('task:'+id)).filter(Boolean);
      if(!laneNodes.length)return '';
      return `<section class="task-lane"><header class="task-lane-head"><strong>${esc(lane.title)}</strong><small>${esc(lane.kind==='workflow'?'مسار مرتب':'مساحة عمل')} · ${laneNodes.length} عناصر</small></header>${laneNodes.map(nodeHtml).join('')}</section>`;
    });
    const rest=nodes.filter(node=>!assigned.has(node.id));if(rest.length)lanes.push(`<section class="task-lane"><header class="task-lane-head"><strong>عناصر أخرى من الحالة</strong></header>${rest.map(nodeHtml).join('')}</section>`);
    return `<section class="panel task-graph-panel"><div class="panel-header"><div><h2>خريطة تدفق العمل</h2><p class="panel-subtitle">الأسهم تعكس الاعتماد وترتيب الخطوات وانتظار الموارد المسجّلة</p></div>${button('refresh','تحديث', 'data-key="coordination"')}</div><div class="task-graph-toolbar"><label class="field">الحالة<select id="cc-task-status">${['all','queued','running','review','done'].map(status=>`<option value="${status}" ${taskStatus===status?'selected':''}>${status==='all'?'جميع الحالات':esc(label(status))}</option>`).join('')}</select></label><label class="field">بحث<input id="cc-task-query" type="search" value="${esc(taskQuery)}" placeholder="عنوان المهمة أو موردها"></label><div class="task-graph-legend"><span>اعتماد ←</span><span>ترتيب خطوات ←</span><span>انتظار مورد ←</span></div></div>${nodes.length?`<div class="task-graph-scroll" data-cc-scroll="graph"><div class="task-graph-canvas"><svg class="task-graph-edges" aria-hidden="true"></svg><div class="task-graph-lanes">${lanes.join('')}</div></div></div>`:empty('لا توجد عناصر مطابقة','أنشئ مهمة فعلية أو غيّر مرشحات العرض.')}<div class="task-graph-selection">${inspector(c)}</div></section>`;
  }
  function inspector(c){
    const node=c.graph.nodes.find(node=>node.id===selectedNode);if(!node)return '<p class="muted">اختر عنصرًا لعرض اعتماده وموارده؛ حرّك الخريطة أفقيًا لاستكشاف المسارات.</p>';
    const observed=c.queue.find(task=>task.taskId===node.entityId),record=getState()?.tasks.find(task=>task.id===node.entityId);const task=observed||(record?{...record,dependencies:record.dependencies||[],resourceKeys:record.resourceKeys||[],blockers:[]}:null);
    return `<div><strong>${esc(node.label)}</strong><p class="muted">${esc({task:'مهمة مسجلة',workflow:'مسار تنفيذ',step:'خطوة مسار','workflow-step':'خطوة مسار'}[node.type]||node.type)} · ${esc(label(node.status))}</p>${task?`<p>المتطلبات: ${task.dependencies.length?task.dependencies.map(id=>esc(c.queue.find(t=>t.taskId===id)?.title||id)).join('، '):'لا يوجد اعتماد مسجّل'}</p><p>الموارد: ${task.resourceKeys.length?task.resourceKeys.map(esc).join('، '):'لا توجد موارد محجوزة مسجّلة'}</p>${task.blockers.length?`<ul>${task.blockers.map(blocker=>`<li>${esc(blocker.message)}</li>`).join('')}</ul>`:'<p class="muted">لا توجد عوائق محسوبة لهذه المهمة في القراءة الحالية.</p>'}`:''}</div>${button('inspect',node.type==='task'?'عرض المهمة وتعديلها':'فتح مسار التنفيذ',`data-type="${esc(node.type)}" data-id="${esc(node.type==='task'?node.entityId:node.workflowId||node.entityId)}"`)}`;
  }
  function queuePanel(c){
    const agents=new Map(c.organization.agents.map(agent=>[agent.id,agent.name]));
    return `<section class="panel"><div class="panel-header"><div><h2>طابور المهام الفعلي</h2><p class="panel-subtitle">مرتّب حسب الأولوية ثم وقت الإنشاء؛ لا يُشغّل المهام تلقائيًا</p></div><span class="title-count">${c.queue.length}</span></div>${c.queue.length?`<div class="table-wrap"><table><thead><tr><th>المهمة</th><th>المسؤول</th><th>الأولوية</th><th>الحالة</th><th>الجاهزية</th></tr></thead><tbody>${c.queue.map(task=>`<tr><td><button class="link-button" data-action="cc-inspect" data-type="task" data-id="${esc(task.taskId)}">${esc(task.title)}</button></td><td>${esc(agents.get(task.agentId)||task.agentId)}</td><td>${pill(task.priority)}</td><td>${pill(task.status)}</td><td>${task.dispatchable?'جاهزة للتكليف اليدوي':task.blockers.length?esc(task.blockers.map(blocker=>blocker.message).join(' · ')):'حالة محفوظة'}</td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد مهام في الطابور','تظهر المهام غير المكتملة بعد إنشائها فعليًا.')}</section>`;
  }
  function orchestrationPage(){
    const c=cache.coordination;return notice('coordination')+(c?`${organization(c)}${graph(c)}${queuePanel(c)}<section class="panel"><div class="panel-header"><h2>الموارد المحجوزة بالحالة الحالية</h2><span class="title-count">${c.resourceLocks.length}</span></div><div class="panel-body">${c.resourceLocks.length?`<ul>${c.resourceLocks.map(lock=>`<li><code dir="ltr">${esc(lock.key)}</code> · ${esc(c.queue.find(task=>task.taskId===lock.taskId)?.title||lock.taskId)}</li>`).join('')}</ul>`:'<p class="muted">لا توجد موارد محجوزة لمهام معلّمة قيد العمل.</p>'}<p class="muted">تُراجع هذه القراءة كل 3 ثوانٍ أثناء ظهور الشاشة. جاهزية المهمة لا تبدأ تنفيذها تلقائيًا.</p></div></section>`:'');
  }
  function recommendations(){
    const c=cache.coordination;if(!c)return notice('coordination');
    return notice('coordination')+`<section class="panel advisor-panel"><div class="panel-header"><div><h2>توصيات من حالة العمل</h2><p class="panel-subtitle">قواعد واضحة من المهام والعوائق والموارد؛ لا تحتاج نموذجًا لغويًا</p></div>${button('refresh','تحديث','data-key="coordination"')}</div><div class="panel-body"><div class="advisor-grid">${c.advisors.length?c.advisors.map(rec=>`<article class="advisor-card ${esc(rec.severity)}"><span class="advisor-category">${esc({freshness:'حداثة المتابعة',ownership:'توزيع المسؤولية',dependencies:'الاعتماديات',resources:'الموارد المشتركة',verification:'بوابات التحقق',connections:'الاتصالات',capabilities:'قدرات النظام',data:'البيانات',parallelism:'المسارات المستقلة'}[rec.category]||rec.category)}</span><h3>${esc(rec.title)}</h3><p>${esc(rec.description)}</p><details><summary>أساس التوصية</summary><pre class="database-json">${json(rec.basis)}</pre></details><div class="advisor-actions">${rec.actions.map((action,index)=>button('recommendation',esc(action.label),`data-id="${esc(rec.id)}" data-index="${index}"`)).join('')}</div></article>`).join(''):empty('لا توجد توصيات إضافية في القراءة الحالية','تظهر الاقتراحات عند وجود عمل أو عائق يمكن الاستدلال عليه من الحالة.')}</div><div class="data-actions">${button('new-task','إنشاء مهمة فعلية','','primary')}<button class="button secondary small" data-route="orchestration">فحص خريطة العمل</button></div></div></section>`;
  }
  function proposalHtml(proposal){
    const status=proposal.status||'pending',revision=getStore()?.getRevision();
    const stale=Number.isInteger(proposal.baseRevision)&&proposal.baseRevision!==revision;
    return `<article class="chat-proposal"><strong>${esc(proposal.title)}</strong><p>${esc(proposal.impact)}</p><details><summary>التغيير المقترح للمراجعة</summary><pre class="database-json">${json({operation:proposal.operation,payload:proposal.payload})}</pre></details><div class="chat-proposal-actions">${status==='applied'?pill('applied'):status==='expired'||stale?pill('blocked','انتهت صلاحية الاقتراح بعد تغيّر الحالة'):button('proposal','مراجعة وتأكيد الإجراء',`data-id="${esc(proposal.id)}"`,'primary')}</div></article>`;
  }
  function chatMessages(){
    const messages=cache.history?.messages||[];
    let html=messages.map(message=>`<article class="chat-message ${message.role==='user'?'user':'assistant'}"><div class="chat-message-meta"><strong>${message.role==='user'?'أنت':message.provider==='gemini'?'Gemini · '+esc(message.model||'نموذج مهيّأ'):'مستشار محلي بالقواعد'}</strong><time>${esc(date(message.createdAt,true))}</time></div><div class="chat-message-content">${esc(message.content).replace(/\n/g,'<br>')}</div>${(message.proposals||[]).map(proposalHtml).join('')}</article>`).join('');
    if(chatReply&&!messages.some(message=>message.id===chatReply.messageId))html+=`<article class="chat-message assistant"><div class="chat-message-meta"><strong>${chatReply.provider==='gemini'?'Gemini · '+esc(chatReply.model||'نموذج مهيّأ'):'مستشار محلي بالقواعد'}</strong></div><div class="chat-message-content">${esc(chatReply.assistantMessage||'').replace(/\n/g,'<br>')}</div>${(chatReply.proposals||[]).map(proposalHtml).join('')}</article>`;
    const recommendations=chatReply?.localRecommendations;
    if(recommendations?.length)html+=`<article class="chat-message system"><strong>إرشادات محلية محسوبة · دون نموذج لغوي</strong><ul>${recommendations.map(rec=>`<li><strong>${esc(rec.title)}</strong><p>${esc(rec.detail)}</p></li>`).join('')}</ul></article>`;
    if(chatReply?.limitations?.length)html+=`<article class="chat-message system"><strong>حدود الاستجابة</strong><p>${esc(Array.isArray(chatReply.limitations)?chatReply.limitations.join(' · '):chatReply.limitations)}</p></article>`;
    return html||'<p class="muted">اسأل عن توزيع المهام أو عوائق التنفيذ. يوضح كل رد مصدره؛ لا تُنفّذ المقترحات دون تأكيدك.</p>';
  }
  function providerPanel(){
    const capability=cache.assistantCapabilities,health=cache.providerHealth;
    const states={passed:'نجح آخر فحص توليد',failed:'فشل آخر فحص توليد',stale:'نجاح سابق يحتاج تحديثًا',testing:'جارٍ فحص التوليد',untested:'محفوظ · التوليد غير مفحوص',not_configured:'بانتظار الإعداد'};
    const status=providerTesting?'testing':health?.status||'untested';
    return `<details class="panel"><summary class="panel-header"><h2>ربط مزوّد الذكاء الاصطناعي</h2>${pill(status==='passed'?'complete':status==='failed'?'failed':'unverified',capability?.configured?states[status]:'بانتظار الإعداد')}</summary><div class="panel-body">${notice('assistantCapabilities')}<p class="muted">${capability?.configured?'المزوّد: Gemini · النموذج: '+esc(capability.model||'غير محدد'):'المحادثة اللغوية تحتاج مفتاح مزوّد صالحًا. تبقى توصيات الحالة المحلية متاحة.'}</p><p class="muted">يُحفظ المفتاح مشفّرًا على الخادم. حفظ الإعداد وجلب النماذج لا يثبتان نجاح التوليد.</p><div id="cc-provider-health" role="status" aria-live="polite">${notice('providerHealth')}${health?.checkedAt?'<p class="muted">وقت آخر فحص: '+esc(date(health.checkedAt,true))+' · '+esc(health.latencyMs)+' ms</p>':''}${health?.error?'<p class="provider-form-error">'+esc(health.error.message)+'</p>':''}</div><p class="muted">فحص الرد الفعلي يرسل طلب توليد قصيرًا واحدًا إلى Google ويستهلك من حصة حسابك، دون إرسال بيانات المشروع.</p><div class="form-actions">${button('provider','فحص وربط Gemini','','primary')}${button('provider-test',providerTesting?'جارٍ فحص الرد…':'فحص رد فعلي',`${!capability?.configured||providerTesting?'disabled':''} aria-busy="${providerTesting}"`)}${button('refresh','تحديث حالة الفحص','data-key="providerHealth"')}</div></div></details>`;
  }
  function providerForm(){
    const capability=cache.assistantCapabilities;
    openModal('ربط Gemini بخطوتين',`<form id="cc-provider-form" autocomplete="off"><div id="cc-provider-error" class="provider-form-error" role="alert" tabindex="-1" hidden><strong>تعذّر إكمال الربط</strong><p data-provider-error-message></p><p data-provider-error-note></p></div><p class="muted">أدخل قيمة المفتاح، ثم اختر نموذجًا من القائمة التي يعيدها Google. لا تحتاج إلى كتابة اسم نموذج أو رقم مشروع.</p><div id="cc-provider-key-section"><div class="field"><label for="cc-provider-key">١ · الصق قيمة مفتاح Gemini</label><input id="cc-provider-key" name="apiKey" type="password" autocomplete="new-password" required maxlength="512" aria-describedby="cc-provider-key-help"><small id="cc-provider-key-help" class="muted">استخدم زر نسخ مفتاح API نفسه؛ اسم المفتاح ورقم المشروع لا يصلحان للربط. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">افتح صفحة مفاتيح Gemini</a></small></div>${capability?.configured?'<label class="checkbox-field"><input type="checkbox" name="useSavedKey" id="cc-provider-saved-key">استخدام المفتاح المحفوظ بدل إدخال مفتاح جديد</label>':''}</div><div id="cc-provider-model-section" hidden><div class="field"><label for="cc-provider-model">٢ · اختر نموذج المحادثة</label><select id="cc-provider-model" name="model" required disabled aria-describedby="cc-provider-model-help"><option value="">اختر نموذجًا من Google</option></select><small id="cc-provider-model-help" class="muted">تضم القائمة النماذج التي أعلن Google دعمها للمحادثة. يتحقق الخادم من اختيارك قبل حفظ الربط.</small></div><p id="cc-provider-catalog-note" class="muted"></p></div><p class="muted">يُفرغ حقل المفتاح بعد إرساله. يبقى المفتاح مشفرًا مؤقتًا لإتمام الاختيار دون إدخاله مرتين؛ جلب القائمة وحده لا يغيّر إعداد المساعد.</p><p id="cc-provider-status" class="provider-form-status" role="status" aria-live="polite" hidden></p><div class="form-actions"><button class="button primary" type="submit">جلب النماذج من مفتاحي</button><button class="button secondary" type="button" data-action="cc-provider-restart" id="cc-provider-restart" hidden>استخدام مفتاح آخر</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
  }
  function chat(){
    return `<section class="panel chat-panel"><div class="panel-header"><div><h2>محادثة مساعد القيادة</h2><p class="panel-subtitle">توصية قابلة للمراجعة، ثم إجراء صريح عند التأكيد</p></div>${button('refresh','قراءة السجل','data-key="history"')}</div>${notice('history')}<div class="chat-messages" data-cc-scroll="chat" aria-live="polite">${chatMessages()}</div><div class="chat-composer"><form id="cc-chat-form" class="chat-form"><label class="sr-only" for="cc-chat-message">رسالتك إلى المساعد</label><textarea id="cc-chat-message" name="message" rows="3" required maxlength="2000" placeholder="ما الذي يعيق العمل؟ وكيف أوزع المهام؟">${esc(chatDraft)}</textarea><button class="button primary" type="submit" ${chatSending?'disabled':''} aria-busy="${chatSending}">${chatSending?'جارٍ الطلب…':'إرسال'}</button></form><p class="muted">الردود والتوصيات ليست دليلًا على تعديل كود أو تنفيذ اختبارات.</p></div></section>`;
  }
  function advisorPage(){return `${providerPanel()}<div class="chat-layout"><div>${chat()}</div><div>${recommendations()}</div></div>`;}
  function currentDatabase(){const bridges=cache.database?.bridges||[];return bridges.find(bridge=>bridge.id===selectedBridge)||bridges[0];}
  function databasePage(){
    const body=cache.database;if(!body)return notice('database');
    const bridge=currentDatabase(),snapshot=bridge?.snapshot;
    if(bridge)selectedBridge=bridge.id;
    const schema=snapshot?.schema||[],writable=snapshot?.writableTables||[],table=schema.find(table=>table.name===selectedTable)||schema[0];
    if(table)selectedTable=table.name;
    const rows=snapshot?.tables?.find(item=>item.name===table?.name);
    return notice('database')+`<div class="info-banner compact">${icon('shield')}<p>اتصال صادر من جهازك المحلي؛ لا يمكن تأكيد الوصول إلى 192.168.1.99 من إعداد اللوحة وحده. تصل الجداول والإيصالات بعد تشغيل الجسر الفعلي. القراءة الافتراضية للهيكل فقط، والكتابة تتطلب سماحًا محليًا صريحًا.</p></div><section class="panel database-panel"><div class="panel-header"><h2>جسور قاعدة البيانات</h2><div class="data-actions">${button('database-create','إضافة جسر','','primary')}${button('refresh','تحديث','data-key="database"')}</div></div><div class="panel-body"><div class="field"><label for="cc-bridge">الجسر</label><select id="cc-bridge">${body.bridges.map(item=>`<option value="${esc(item.id)}" ${item.id===bridge?.id?'selected':''}>${esc(item.name)}</option>`).join('')||'<option>لم يُنشأ جسر بعد</option>'}</select></div>${bridge?`<div class="database-summary"><div><h3>${esc(bridge.name)}</h3><p><code dir="ltr">${esc(bridge.id)}</code> · SQLite · ${bridge.enabled?'مفعّل إداريًا':'متوقف إداريًا'}</p></div>${pill(bridge.status)}<p>آخر اتصال فعلي: ${bridge.lastSeenAt?esc(date(bridge.lastSeenAt,true)):'لم يصل اتصال بعد'}</p></div><div class="data-actions">${button('database-connection','تنزيل إعدادات الاتصال الخاصة')}<a class="button secondary small" href="./downloads/aas-database-bridge.zip" download>حزمة تثبيت جسر قاعدة البيانات</a><p class="muted">الملف حساس. التنزيل لا يثبت تثبيت الجسر أو اتصاله.</p></div>`:empty('لا توجد جسور مسجّلة','أنشئ تعريف جسر، ثم ثبّت المنفّذ المحلي وأرسل ملاحظة فعلية.')}<details><summary>قدرات خدمة الجسر</summary><pre class="database-json">${json(body.capabilities||{})}</pre></details></div></section>${bridge?`<div class="database-stats"><div class="database-stat"><strong>${schema.length}</strong><span>جداول في آخر ملاحظة</span></div><div class="database-stat"><strong>${writable.length}</strong><span>جداول تسمح بالكتابة محليًا</span></div><div class="database-stat"><strong>${bridge.operations.filter(op=>op.status==='pending').length}</strong><span>طلبات بانتظار إيصال</span></div><div class="database-stat"><strong>${bridge.operations.filter(op=>op.status==='applied').length}</strong><span>طلبات لها إيصال تنفيذ</span></div></div><div class="database-layout"><section class="panel database-table-panel"><div class="panel-header"><h2>الهيكل والصفوف المسموح بعرضها</h2><span class="muted">${snapshot?esc(date(snapshot.observedAt,true)):'لا توجد ملاحظة فعلية'}</span></div><div class="panel-body">${table?`<div class="database-table-list">${schema.map(item=>`<button class="database-table-button ${table.name===item.name?'selected':''}" data-action="cc-database-table" data-id="${esc(item.name)}"><span>${esc(item.name)}</span><span>${item.rowCount??'—'}${item.rowCountCapped?'+':''} صف</span></button>`).join('')}</div><h3>${esc(table.name)}</h3><div class="table-wrap"><table><thead><tr><th>العمود</th><th>النوع</th><th>المفتاح</th></tr></thead><tbody>${table.columns.map(column=>`<tr><td>${esc(column.name)}</td><td>${esc(column.type)}</td><td>${column.primaryKey?'أساسي':column.nullable?'يقبل null':'مطلوب'}</td></tr>`).join('')}</tbody></table></div>${rows?`<details><summary>الصفوف التي سمح بها الجسر (${rows.rows.length}${rows.truncated?'، مقتطعة':''})</summary><pre class="database-json">${json(rows.rows)}</pre></details>`:'<p class="muted">لم يسمح الجسر بعرض صفوف هذا الجدول. لا تُعرض بيانات بديلة.</p>'}`:empty('بانتظار ملاحظة قاعدة البيانات','لا تُعرض جداول أو أعداد قبل استلامها من الجسر.')}<div class="data-actions">${button('database-operation','طلب تغيير بيانات',`data-id="${esc(bridge.id)}" ${writable.length&&bridge.enabled&&bridge.status==='online'?'':'disabled'}`,'primary')}<p class="muted">الطلبات منظّمة حسب الجدول والأعمدة المسموحة؛ لا توجد واجهة SQL.</p></div></div></section><section class="panel"><div class="panel-header"><h2>طلبات التغيير وإيصالاتها</h2></div><div class="panel-body"><ol class="database-queue">${bridge.operations.length?bridge.operations.map(operation=>`<li class="database-operation ${esc(operation.status)}"><header><strong>${esc({insert:'إضافة',update:'تعديل',delete:'حذف'}[operation.action]||operation.action)} · ${esc(operation.table)}</strong>${pill(operation.status)}</header><time>${esc(date(operation.createdAt,true))}</time>${operation.receipt?`<p>${esc(operation.receipt.summary||'وصل إيصال من الجسر.')}</p><small>وقت الملاحظة: ${esc(date(operation.receipt.observedAt,true))} · تغييرات: ${esc(operation.receipt.changes??'—')} · نسخة احتياطية: ${operation.receipt.backupCreated?'أُنشئت':'لم يذكر الإيصال إنشاءها'}</small>`:'<p>حُفظ الطلب فقط؛ لم يصل إيصال تنفيذ.</p>'}<details><summary>تفاصيل الطلب</summary><pre class="database-json">${json({id:operation.id,values:operation.values,key:operation.key})}</pre></details></li>`).join(''):'<li class="muted">لا توجد طلبات تغيير مسجّلة.</li>'}</ol></div></section></div>`:''}`;
  }
  function stagePage(route){return route==='orchestration'?orchestrationPage():route==='advisor'?advisorPage():databasePage();}
  function page(route){const titles={orchestration:['الهيكل وخريطة العمل','ترابط الوكلاء والمهام والموارد من حالة المؤسسة الفعلية.','AAS / LIVE COORDINATION'],advisor:['المستشار والمحادثة','توصيات مستندة إلى البيانات، وإجراءات تحتاج مراجعة صريحة.','AAS / ADVISOR'],database:['قاعدة البيانات المحلية','هيكل قاعدة البيانات والطلبات وإيصالات الجسر الصادر.','AAS / DATABASE BRIDGE']};return titleBlock(...titles[route])+`<div id="control-center-stage">${stagePage(route)}</div>`;}
  function drawEdges(){
    const c=cache.coordination;if(!c)return;
    function draw(canvasSelector,svgSelector,nodeAttribute,edges,cls){
      const canvas=document.querySelector(canvasSelector),svg=canvas?.querySelector(svgSelector);if(!svg)return;
      const rect=canvas.getBoundingClientRect(),elements=new Map([...canvas.querySelectorAll(`[${nodeAttribute}]`)].map(el=>[el.getAttribute(nodeAttribute),el]));
      svg.setAttribute('width',String(canvas.scrollWidth));svg.setAttribute('height',String(canvas.scrollHeight));svg.setAttribute('viewBox',`0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);
      const paths=edges.map(edge=>{const from=elements.get(edge.from),to=elements.get(edge.to);if(!from||!to)return '';const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();const x1=a.left+a.width/2-rect.left,y1=a.bottom-rect.top,x2=b.left+b.width/2-rect.left,y2=b.top-rect.top;return `<path class="${cls} ${edge.from===selectedNode||edge.to===selectedNode?'marked':''}" d="M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}" data-edge-type="${esc(edge.type||'manager')}" marker-end="url(#${cls}-arrow)"/>`;}).join('');
      svg.innerHTML=`<defs><marker id="${cls}-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7" fill="currentColor"/></marker></defs>${paths}`;
    }
    draw('.org-chart','.org-chart-edges','data-org-node',c.organization.agents.filter(agent=>agent.managerAgentId).map(agent=>({from:agent.managerAgentId,to:agent.id})),'org-chart-edge');
    draw('.task-graph-canvas','.task-graph-edges','data-graph-node',c.graph.edges.filter(edge=>edge.type!=='ownership'),'task-graph-edge');
  }
  function observeGraph(){observer?.disconnect();requestAnimationFrame(()=>{drawEdges();const wrap=document.querySelector('.org-chart-wrap'),leader=wrap?.querySelector('.org-node.leader');if(!orgCentered&&wrap&&leader){const a=wrap.getBoundingClientRect(),b=leader.getBoundingClientRect();wrap.scrollBy({left:b.left+b.width/2-a.left-a.width/2});orgCentered=true;}});if(typeof ResizeObserver==='function'){observer=new ResizeObserver(drawEdges);document.querySelectorAll('.org-chart,.task-graph-canvas').forEach(el=>observer.observe(el));}}
  function afterRender(route){currentRoute=route;restore(savedViews.get(route));if(!ownRoutes.has(route))observer?.disconnect();if(['overview','orchestration','advisor'].includes(route)&&(!cache.coordination||lastRevision!==getStore().getRevision())){lastRevision=getStore().getRevision();load('coordination',{quiet:true});}if(route==='database'&&!cache.database)load('database');if(route==='advisor'&&!cache.history)load('history');if(route==='advisor'&&!cache.assistantCapabilities)load('assistantCapabilities');if(route==='advisor'&&!cache.providerHealth)load('providerHealth');if(route==='orchestration')observeGraph();}
  function reviewRecommendation(rec,action){
    pendingReview={recId:rec.id,action,revision:cache.coordination.revision??getStore().getRevision()};
    openModal('مراجعة إجراء المستشار',`<form id="cc-recommendation-form"><h3>${esc(rec.title)}</h3><p>${esc(rec.description)}</p><p>الإجراء: ${esc(action.label)}</p><pre class="database-json">${json(action.type==='update-task'?{taskId:action.taskId,patch:action.patch}:{serverId:action.serverId})}</pre><p class="muted">يُنفّذ هذا الإجراء عند التأكيد فقط، ويسجّل الخادم نتيجته.</p><div class="form-actions"><button class="button primary" type="submit">تأكيد الإجراء</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
  }
  function findProposal(id){return [...(cache.history?.messages||[]).flatMap(message=>message.proposals||[]),...(chatReply?.proposals||[])].find(proposal=>proposal.id===id);}
  function databaseForm(bridgeId){
    const bridge=cache.database?.bridges.find(bridge=>bridge.id===bridgeId),tables=bridge?.snapshot?.writableTables||[];if(!bridge||!tables.length||bridge.status!=='online')throw new Error('طلب الكتابة يحتاج اتصالًا حديثًا من الجسر وجدولًا مسموحًا.');
    openModal('طلب تغيير قاعدة البيانات',`<form id="cc-database-operation-form" data-id="${esc(bridge.id)}"><div class="form-grid"><label class="field">الجدول<select id="cc-operation-table" name="table">${tables.map(table=>`<option value="${esc(table.name)}">${esc(table.name)}</option>`).join('')}</select></label><label class="field">نوع الطلب<select id="cc-operation-action" name="action"><option value="insert">إضافة صف</option><option value="update">تعديل صف بالمفتاح</option><option value="delete">حذف صف بالمفتاح</option></select></label></div><div id="cc-operation-fields"></div><p class="muted">لا يُنفّذ الطلب من المتصفح. يراجعه الجسر وفق السماح المحلي، وينشر إيصال النتيجة بعد تطبيقه.</p><div class="form-actions"><button class="button primary" type="submit">مراجعة الطلب</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);databaseFields();
  }
  function scalarFields(columns,prefix){return columns.map((column,index)=>`<div class="database-operation"><label class="checkbox-field"><input type="checkbox" name="${prefix}Include" value="${esc(column)}" ${prefix==='key'?'checked disabled':''}><span>${esc(column)}</span></label><div class="form-grid"><label class="field">القيمة<input name="${prefix}Value${index}" ${prefix==='key'?'required':''} maxlength="2000"></label><label class="field">النوع<select name="${prefix}Type${index}"><option value="string">نص</option><option value="number">رقم</option><option value="boolean">منطقي: true أو false</option><option value="null">null</option></select></label></div></div>`).join('');}
  function databaseFields(){
    const form=document.getElementById('cc-database-operation-form');if(!form)return;
    const bridge=cache.database.bridges.find(bridge=>bridge.id===form.dataset.id),table=bridge.snapshot.writableTables.find(table=>table.name===form.elements.table.value),action=form.elements.action.value;
    form.dataset.tableSignature=JSON.stringify(table);
    form.querySelector('#cc-operation-fields').innerHTML=(action==='insert'?'':`<h3>المفتاح الأساسي للصف المحدد</h3>${table.primaryKey.length?scalarFields(table.primaryKey,'key'):'<p class="muted">لا يسمح هذا الجدول بتحديد صف بمفتاح أساسي؛ التعديل والحذف مغلقان.</p>'}`)+(action==='delete'?'':`<h3>الأعمدة المراد إرسالها</h3>${scalarFields(table.columns,'value')}`);
    form.querySelector('[type="submit"]').disabled=action!=='insert'&&!table.primaryKey.length;
  }
  function parseScalar(data,prefix,index){const value=String(data.get(prefix+'Value'+index)||''),type=data.get(prefix+'Type'+index);if(type==='null')return null;if(type==='number'){if(!value.trim()||!Number.isFinite(Number(value)))throw new Error('أدخل رقمًا صحيحًا لحقل النوع الرقمي.');return Number(value);}if(type==='boolean'){if(!['true','false'].includes(value))throw new Error('القيمة المنطقية يجب أن تكون true أو false.');return value==='true';}return value;}
  async function handleAction(action,el){
    if(!action?.startsWith('cc-'))return false;
    const id=el.dataset.id;
    try{
      switch(action){
        case 'cc-refresh':if(el.dataset.key==='providerHealth')await load('assistantCapabilities',{quiet:true});await load(el.dataset.key);break;
        case 'cc-provider':if(!cache.assistantCapabilities)await load('assistantCapabilities');providerForm();break;
        case 'cc-provider-test':{
          if(providerTesting)break;providerTesting=true;providerHealthVersion++;updateStage();
          try{const result=await getStore().testAssistantProvider();providerHealthVersion++;cache.providerHealth=result.providerHealth;errors.providerHealth=null;await load('assistantCapabilities',{quiet:true});toast(result.providerHealth?.status==='passed'?'نجح توليد رد فعلي من Gemini.':result.error?.message||'لم ينجح فحص الرد.',result.providerHealth?.status!=='passed');}
          catch(error){await load('providerHealth',{quiet:true});throw error;}
          finally{providerTesting=false;updateStage();}
          break;
        }
        case 'cc-agent':selectedAgent=selectedAgent===id?'':id;selectedNode='';updateStage();break;
        case 'cc-agent-clear':selectedAgent='';updateStage();break;
        case 'cc-node':selectedNode=id;updateStage();break;
        case 'cc-inspect':if(el.dataset.type==='task')openTask(id);else navigate('execution',id);break;
        case 'cc-new-task':newTask();break;
        case 'cc-recommendation':{const rec=cache.coordination?.advisors.find(rec=>rec.id===id),item=rec?.actions[Number(el.dataset.index)];if(!item)throw new Error('تغيّرت التوصية. حدّث القراءة وأعد المحاولة.');if(item.type==='navigate'){if(item.route==='tasks'&&item.id)openTask(item.id);else if(item.route==='agents'&&item.id)openAgent(item.id);else navigate(item.route,item.id);}else reviewRecommendation(rec,item);break;}
        case 'cc-proposal':{const proposal=findProposal(id);if(!proposal)throw new Error('الاقتراح غير متاح. أعد قراءة سجل المحادثة.');if(proposal.status&&proposal.status!=='pending')throw new Error('هذا الاقتراح لم يعد معلّقًا.');pendingReview={proposalId:id,revision:proposal.baseRevision??getStore().getRevision()};openModal('مراجعة اقتراح المساعد',`<form id="cc-proposal-form"><h3>${esc(proposal.title)}</h3><p>${esc(proposal.impact)}</p><pre class="database-json">${json({operation:proposal.operation,payload:proposal.payload})}</pre><p class="muted">التأكيد يرسل معرّف الاقتراح المحفوظ إلى الخادم. يرفض الخادم المقترحات التي تغيّرت حالتها.</p><div class="form-actions"><button class="button primary" type="submit">تأكيد تطبيق الاقتراح</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);break;}
        case 'cc-provider-restart':closeModal();providerForm();break;
        case 'cc-database-create':openModal('تعريف جسر قاعدة البيانات','<form id="cc-database-create-form"><div class="field"><label for="cc-bridge-name">اسم الجسر</label><input id="cc-bridge-name" name="name" required maxlength="160" placeholder="قاعدة المتجر المحلية"></div><p class="muted">ينشئ هذا تعريفًا فقط؛ لا يصل إلى قاعدة بيانات قبل تشغيل الجسر الصادر محليًا.</p><div class="form-actions"><button class="button primary" type="submit">إنشاء تعريف الجسر</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>');break;
        case 'cc-database-connection':await downloadConnection();toast('نُزّل ملف اتصال خاص. ثبّت الجسر محليًا وحدّد معرّفه؛ لم يُثبت الاتصال بعد.');break;
        case 'cc-database-table':selectedTable=id;updateStage();break;
        case 'cc-database-operation':databaseForm(id);break;
      }
    }catch(error){toast(error.message||'تعذّر إتمام الإجراء.',true);}
    return true;
  }
  function providerError(form,message,{note='صحّح البيانات وأعد المحاولة.'}={}){
    const error=form.querySelector('#cc-provider-error');
    error.querySelector('[data-provider-error-message]').textContent=message;
    error.querySelector('[data-provider-error-note]').textContent=note;
    error.hidden=false;error.focus({preventScroll:true});error.scrollIntoView({block:'nearest',behavior:'auto'});
  }
  async function saveProvider(form){
    const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;
    const modelField=form.elements.model,keyField=form.elements.apiKey,status=form.querySelector('#cc-provider-status');
    const selecting=Boolean(form.dataset.discoveryId),model=modelField.value;
    if(!form.reportValidity())return;
    if(getStore().getConnection().status!=='online'){providerError(form,'الاتصال بالخادم متوقف. أعد الاتصال ثم حاول مجددًا.');return;}
    const active=()=>form.isConnected&&form.closest('dialog')?.open;
    const usingSaved=form.elements.useSavedKey?.checked===true;
    const input=selecting?{discoveryId:form.dataset.discoveryId,model}:usingSaved?{useSavedKey:true}:{apiKey:keyField.value};
    form.querySelector('#cc-provider-error').hidden=true;
    submit.disabled=true;submit.setAttribute('aria-busy','true');submit.textContent=selecting?'جارٍ فحص الاختيار وحفظه…':'جارٍ جلب النماذج من Google…';
    keyField.readOnly=true;modelField.disabled=true;
    status.hidden=false;status.dataset.state='pending';status.textContent=selecting?'يتحقق الخادم من النموذج قبل اعتماد الربط.':'جارٍ فحص المفتاح وجلب النماذج؛ إعداد المساعد الحالي محفوظ.';
    let succeeded=false;
    try{
      const request=selecting?getStore().configureAssistantProvider(input):getStore().discoverAssistantModels(input);
      keyField.value='';delete input.apiKey;
      const result=await request;
      if(selecting){
        if(result?.configured!==true||result.model!==model)throw new Error('لم يصل تأكيد حفظ النموذج. أعد قراءة حالة الإعداد.');
        cache.assistantCapabilities=result;errors.assistantCapabilities=null;succeeded=true;
        providerHealthVersion++;cache.providerHealth=null;if(active())closeModal();updateStage();await load('providerHealth',{quiet:true});toast('حُفظ الإعداد. اضغط «فحص رد فعلي» للتحقق من التوليد بالنموذج '+result.model+'.');
      }else{
        if(typeof result?.discoveryId!=='string'||!Array.isArray(result.models)||!result.models.length)throw new Error('لم تصل قائمة نماذج صالحة. أعد جلبها.');
        if(!active())return;
        form.dataset.discoveryId=result.discoveryId;
        modelField.innerHTML='<option value="">اختر نموذجًا من Google</option>'+result.models.map(item=>`<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.id)}</option>`).join('');
        if(result.models.some(item=>item.id===cache.assistantCapabilities?.model))modelField.value=cache.assistantCapabilities.model;
        keyField.required=false;keyField.disabled=true;
        form.querySelector('#cc-provider-key-section').hidden=true;form.querySelector('#cc-provider-model-section').hidden=false;
        form.querySelector('#cc-provider-restart').hidden=false;
        form.querySelector('#cc-provider-catalog-note').textContent=result.truncated?'عُرض جزء من قائمة Google. اختر أحد النماذج المعروضة.':'وصلت '+result.models.length+' نماذج من Google. اختر منها ثم احفظ الربط.';
        status.dataset.state='success';status.textContent='المفتاح أتاح جلب النماذج. لم يُغيّر إعداد المساعد بعد؛ اختر النموذج وأكمل الحفظ دون إعادة إدخال المفتاح.';
        modelField.disabled=false;modelField.focus();
      }
    }catch(error){
      if(!active())return;
      status.dataset.state='error';status.textContent='لم يُعتمد ربط جديد. يمكنك تصحيح الخطأ والمحاولة مجددًا.';
      if(error.code==='provider_discovery_expired'||error.code==='provider_discovery_invalid'){
        form.querySelector('#cc-provider-restart').hidden=false;submit.hidden=true;
      }
      providerError(form,error.message||'تعذّر إكمال ربط Gemini.',{note:selecting?'يمكن إعادة محاولة الحفظ أو اختيار مفتاح آخر؛ الإعداد السابق لم يُستبدل دون تأكيد.':'أعد نسخ قيمة المفتاح الفعلية من Google AI Studio. لا تستخدم اسم المفتاح أو رقم المشروع. أُفرغ الحقل بعد الإرسال.'});
    }finally{
      keyField.readOnly=false;
      if(submit.isConnected){submit.disabled=false;submit.removeAttribute('aria-busy');submit.textContent=succeeded?'تم الربط':form.dataset.discoveryId?'حفظ النموذج وربط المساعد':'جلب النماذج من مفتاحي';modelField.disabled=!form.dataset.discoveryId;}
    }
  }
  async function handleSubmit(form){
    if(!form.id?.startsWith('cc-'))return false;
    if(form.id==='cc-provider-form'){await saveProvider(form);return true;}
    const submit=form.querySelector('[type="submit"]');if(submit?.disabled)return true;
    const data=new FormData(form);if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true');}
    try{
      if(form.id==='cc-chat-form'){
        if(chatSending)return true;chatSending=true;chatDraft=String(data.get('message')||'').trim();if(!chatDraft)throw new Error('اكتب رسالة قبل الإرسال.');
        const history=(cache.history?.messages||[]).filter(message=>['user','assistant'].includes(message.role)).slice(-4).map(message=>({role:message.role,content:message.content.slice(0,1000)}));
        chatReply=await getStore().assistantTurn({message:chatDraft,history});chatDraft='';await load('history',{quiet:true});
      }
      if(['cc-proposal-form','cc-recommendation-form'].includes(form.id)){
        if(!pendingReview||pendingReview.revision!==getStore().getRevision())throw new Error('تغيّرت حالة المؤسسة منذ عرض الإجراء. أغلق المراجعة واطلب توصية أو اقتراحًا جديدًا.');
        if(form.id==='cc-proposal-form'){await getStore().applyAssistantProposal({proposalId:pendingReview.proposalId});toast('اعتمد الخادم الإجراء المقترح.');await load('history',{quiet:true});}
        else{const action=pendingReview.action;if(action.type==='update-task')await getStore().updateTask(action.taskId,action.patch);else if(action.type==='check-server')await getStore().checkServer(action.serverId);toast('حُفظت نتيجة الإجراء على الخادم.');}
        pendingReview=null;closeModal();await load('coordination',{quiet:true});
      }
      if(form.id==='cc-database-create-form'){const response=await getStore().createDatabaseBridge({name:String(data.get('name')).trim()});if(Array.isArray(response?.bridges)){const known=new Set((cache.database?.bridges||[]).map(bridge=>bridge.id));selectedBridge=response.bridges.find(bridge=>!known.has(bridge.id))?.id||selectedBridge;cache.database=response;}await load('database',{quiet:true});closeModal();toast('حُفظ تعريف الجسر؛ بانتظار اتصال الجهاز المحلي.');}
      if(form.id==='cc-database-operation-form'){
        const bridge=cache.database?.bridges.find(bridge=>bridge.id===form.dataset.id),table=bridge?.snapshot?.writableTables?.find(table=>table.name===data.get('table'));
        if(bridge?.status!=='online')throw new Error('لم يعد للجسر اتصال حديث. انتظر ملاحظة فعلية ثم راجع الطلب.');
        if(!table||JSON.stringify(table)!==form.dataset.tableSignature)throw new Error('تغيّر السماح المحلي للجدول. أعد فتح نموذج الطلب.');
        const action=data.get('action'),operation={action,table:table.name};
        if(action!=='delete'){const included=new Set(data.getAll('valueInclude'));operation.values=Object.fromEntries(table.columns.map((column,index)=>[column,index]).filter(([column])=>included.has(column)).map(([column,index])=>[column,parseScalar(data,'value',index)]));if(!Object.keys(operation.values).length)throw new Error('اختر عمودًا واحدًا على الأقل لإرساله.');}
        if(action!=='insert'){if(!table.primaryKey.length)throw new Error('التعديل والحذف يحتاجان مفتاحًا أساسيًا معروفًا.');operation.key=Object.fromEntries(table.primaryKey.map((column,index)=>[column,parseScalar(data,'key',index)]));}
        pendingDatabase={bridgeId:bridge.id,operation,requestId:crypto.randomUUID()};closeModal();openModal('تأكيد طلب تغيير البيانات',`<form id="cc-database-confirm-form"><p>الجسر: <strong>${esc(bridge.name)}</strong></p><pre class="database-json">${json(operation)}</pre><p class="muted">سيُحفظ طلب معلّق. لا يُعد منفّذًا حتى يصل إيصال فعلي من الجسر.${action==='delete'?' يتضمن الطلب حذف صف محدد بالمفتاح.':''}</p><div class="form-actions"><button class="button ${action==='delete'?'danger':'primary'}" type="submit">تأكيد إرسال الطلب</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
      }
      if(form.id==='cc-database-confirm-form'){if(!pendingDatabase)throw new Error('انتهت مراجعة الطلب.');const response=await getStore().queueDatabaseOperation(pendingDatabase);pendingDatabase=null;if(Array.isArray(response?.bridges))cache.database=response;closeModal();await load('database',{quiet:true});toast('حُفظ الطلب بانتظار إيصال المنفّذ المحلي.');}
    }catch(error){toast(error.message||'تعذّر إتمام الطلب.',true);}
    finally{chatSending=false;if(submit?.isConnected){submit.disabled=false;submit.removeAttribute('aria-busy');}updateStage();}
    return true;
  }
  function handleInput(target){if(target.id==='cc-chat-message')chatDraft=target.value;if(target.id==='cc-task-query'){taskQuery=target.value;updateStage();}}
  function handleChange(target){if(target.id==='cc-provider-saved-key'){const field=target.form.elements.apiKey;field.value='';field.disabled=target.checked;field.required=!target.checked;}if(target.id==='cc-task-status'){taskStatus=target.value;updateStage();}if(target.id==='cc-bridge'){selectedBridge=target.value;selectedTable='';updateStage();}if(['cc-operation-table','cc-operation-action'].includes(target.id))databaseFields();}
  const timer=setInterval(()=>{if(disposed||document.hidden)return;if(['orchestration','advisor'].includes(currentRoute))load('coordination',{quiet:true});if(currentRoute==='database')load('database',{quiet:true});},3000);
  const onVisible=()=>{if(document.hidden)return;if(['orchestration','advisor'].includes(currentRoute))load('coordination',{quiet:true});if(currentRoute==='database')load('database',{quiet:true});};
  document.addEventListener('visibilitychange',onVisible);
  document.fonts?.ready.then(()=>{if(!disposed)drawEdges();});
  return {page,clearSensitiveInputs(){const field=document.querySelector('#cc-provider-key');if(field)field.value='';const form=document.querySelector('#cc-provider-form');if(form)delete form.dataset.discoveryId;},beforeRender(){if(ownRoutes.has(currentRoute))savedViews.set(currentRoute,viewSnapshot());},overview:()=>`<div id="overview-coordination">${overviewBody()}</div>`,afterRender,handleAction,handleSubmit,handleInput,handleChange,dispose(){disposed=true;clearInterval(timer);observer?.disconnect();document.removeEventListener('visibilitychange',onVisible);}};
}
