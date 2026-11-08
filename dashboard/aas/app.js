import './host-connection.js';
import { createApiStore } from './api-store.js';
import { migrateLegacyWorkspace } from './legacy-migration.js';
import { theme } from './theme.js';
import { createControlCenter } from './control-center.js';

let store;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const routes = ['overview', 'orchestration', 'advisor', 'database', 'execution', 'workspaces', 'tasks', 'agents', 'approvals', 'activity', 'commerce', 'repository', 'integrations', 'settings'];
const labels = { overview: 'مركز القيادة', orchestration: 'الهيكل وخريطة العمل', advisor: 'المستشار والمحادثة', database: 'قاعدة البيانات المحلية', execution: 'مراحل التنفيذ', workspaces: 'مساحات العمل', tasks: 'المهام', agents: 'الوكلاء', approvals: 'الموافقات', activity: 'سجل النشاط', commerce: 'بيانات التطبيق', repository: 'مستودع GitHub', integrations: 'الخوادم والربط', settings: 'الإعدادات' };
const statusLabels = { active: 'نشطة', paused: 'متوقفة', running: 'قيد العمل يدويًا', queued: 'في الانتظار', review: 'للمراجعة', done: 'مكتملة', pending: 'بانتظار القرار', approved: 'معتمدة', rejected: 'مرفوضة', ready: 'جاهز للإعداد', offline: 'غير متصل', online: 'متصل', unverified: 'لم يُفحص', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
let state;
const controlCenter=createControlCenter({getStore:()=>store,getState:()=>state,helpers:{esc,icon,badge,date,titleBlock},openModal,closeModal,toast,navigate,openTask:taskDetail,openAgent:agentDetail,newTask:taskForm,downloadConnection:downloadRunnerConnection});
let bootstrapError = null;
const dirtyForms = new Set();
const mutatingActions = new Set(['new-task','new-workspace','edit-workspace','toggle-workspace','delete-workspace','edit-agent','delete-task','approve','reject','confirm-import','new-server','edit-server','delete-server','check-server','app-connection','reset','import','confirm-reset','confirm-delete','new-workflow','workflow-add-step','workflow-analysis','workflow-change','workflow-verification','workflow-advance','workflow-analyze','runner-connection']);
let route = location.hash.slice(1).split('/')[0] || 'overview';
let workspaceId = location.hash.slice(1).split('/')[1];
let taskFilter = 'all';
let taskQuery = '';
let taskView = 'table';
let agentFilter = 'all';
let approvalFilter = 'pending';
let chartPeriod = 'week';
let notificationOpen = false;
let mobileOpen = false;
let lastFocus;
const github = { repository: null, loading: false, error: null, stale: false, cached: false, nextRefreshAt: null, lastAttemptAt: 0 };
const executionCapabilities = { value: null, loading: false, error: null, attempted: false };
const executionPendingAnalysis = new Set();
let runnerConfigPending = false;
const executionPhases = { analysis:'تحليل المصدر', implementation:'التعديل أو الإضافة', verification:'التحقق من النتيجة', complete:'اكتملت الخطوة' };
const executionStatuses = { pending:'بانتظار الدليل', active:'قيد المتابعة', blocked:'متوقّف بسبب عائق', failed:'يحتاج إلى تصحيح', complete:'مكتمل' };
let githubController;
let lastRenderedRoute;
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 9 1 1 2-2m2 1h3m-8 6 1 1 2-2m2 1h3"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M2 12h2m16 0h2M8 16h8"/><circle cx="8.5" cy="11.5" r=".6"/><circle cx="15.5" cy="11.5" r=".6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trend: '<path d="m3 17 6-6 4 4 8-10m-6 0h6v6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  chart: '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8v-6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>',
  link: '<path d="m10 14 4-4m-6 3-2 2a4 4 0 0 0 6 6l3-3m-4-7 2-2a4 4 0 0 1 6 6l-3 3"/>',
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  store: '<path d="M4 10v10h16V10M3 10l2-7h14l2 7M9 20v-6h6v6"/><path d="M3 10c2 2 4 2 6 0 2 2 4 2 6 0 2 2 4 2 6 0"/>'
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.bot}</svg>`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function num(value) { return new Intl.NumberFormat('en-US').format(value); }
function date(value, full = false) { const d = new Date(value); return isNaN(d) ? '—' : new Intl.DateTimeFormat('ar', { ...(full ? { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' } : { day:'numeric', month:'short' }), timeZone:state.settings.timezone || 'UTC' }).format(d); }
function repositoryDate(value) {
  if (!value) return '—';
  const parsed=new Date(value);
  return isNaN(parsed)?'—':new Intl.DateTimeFormat('ar',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:state.settings.timezone||'Asia/Amman'}).format(parsed);
}
function githubLink(url,label,cls='repository-link') {
  try {
    const target=new URL(url);
    if(target.protocol!=='https:'||target.hostname!=='github.com'||target.port||target.username||target.password)throw new Error();
    return `<a class="${esc(cls)}" href="${esc(target.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  } catch { return `<span class="${esc(cls)}">${esc(label)}</span>`; }
}
function commitSummary(message) { return String(message||'بدون رسالة مراجعة').split(/\r?\n/,1)[0]; }
function repositorySource(repo) { return repo.source==='github-atom'?'خلاصة مراجعات GitHub · Atom':'واجهة GitHub · REST'; }
function repositoryPartialNotice(repo) {
  const errors=Array.isArray(repo.partialErrors)?repo.partialErrors:[];
  const labels={metadata:'بيانات المستودع',branches:'الفروع',workflowRuns:'عمليات البناء'};
  const sourceNotice=repo.source==='github-atom'?`<div class="info-banner compact">${icon('info')}<p>وصلت المراجعات مباشرة من خلاصة GitHub العامة. تفاصيل المستودع والفروع وعمليات البناء غير متاحة من هذه الخلاصة.${repo.restRetryAt?' تُتاح إعادة محاولة واجهة REST بعد '+repositoryDate(repo.restRetryAt)+'.':''}</p></div>`:'';
  return sourceNotice+(errors.length?`<details class="panel repository-section"><summary class="panel-header"><h2>تفاصيل البيانات غير المتاحة</h2><span class="title-count">${errors.length}</span></summary><div class="panel-body"><ul class="repository-list">${errors.map(error=>`<li class="repository-branch"><div><strong>${esc(labels[error.resource]||'قراءة GitHub')}</strong><p class="repository-meta">${esc(error.message||'تعذّرت قراءة هذا الجزء من بيانات المستودع.')}</p>${error.retryAt?`<p class="repository-meta">موعد إعادة المحاولة: ${repositoryDate(error.retryAt)}</p>`:''}</div></li>`).join('')}</ul></div></details>`:'');
}
function badge(status) { return `<span class="status-badge ${esc(status)}"><i></i>${esc(statusLabels[status] || status)}</span>`; }
function agent(id) { return state.agents.find(a => a.id === id); }
function workspace(id) { return state.workspaces.find(w => w.id === id); }
function avatar(a, small = false) { return `<span class="${small ? 'avatar-mini' : 'agent-avatar'}" style="--agent-color:${esc(a?.color || '#4a806a')}">${esc(a?.initials || 'AI')}</span>`; }
function empty(title, body, action = '') { return `<div class="empty-state">${icon('layers')}<h3>${title}</h3><p>${body}</p>${action}</div>`; }
function logo() { return '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m7 30 13-23 13 23h-9l-4-8-4 8z" fill="currentColor"/><path d="m17 19 3-6 3 6" fill="#123c31"/></svg>'; }
function navigate(next, id) {
  notificationOpen = false; mobileOpen = false;
  const hash = next + (id ? '/' + encodeURIComponent(id) : '');
  if (location.hash.slice(1) === hash) { route = next; workspaceId = id; render(); }
  else location.hash = hash;
}
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : '');
  el.innerHTML = icon(error ? 'info' : 'check') + '<span>' + esc(message) + '</span>';
  document.querySelector('#toast-region').append(el); setTimeout(() => el.remove(), 4500);
}
async function run(action, message) { try { await action(); if (message) toast(message); return true; } catch (e) { toast(e.message || 'تعذر حفظ التغيير', true); return false; } }
function titleBlock(title, description, code, buttons = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${code}</div><div class="heading-main"><h1>${title}</h1><p>${description}</p></div></div><div class="heading-actions">${buttons}</div></div>`;
}
function newTaskButton() { return `<button class="button primary" data-action="new-task">${icon('plus')}<span>مهمة جديدة</span></button>`; }
function themeControl(id='theme-preference') {
  const current=theme.get().preference;
  return `<label class="sr-only" for="${id}">مظهر الواجهة</label><select id="${id}" class="theme-preference" aria-label="مظهر الواجهة">${[['system','حسب النظام'],['light','فاتح'],['dark','داكن']].map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join('')}</select>`;
}
function updateThemeControls() { const current=theme.get();document.querySelectorAll('#theme-preference,#settings-theme-preference').forEach(select=>{select.value=current.preference;});const resolved=document.querySelector('#theme-resolved-state');if(resolved)resolved.textContent=current.resolved==='dark'?'المظهر الحالي: داكن':'المظهر الحالي: فاتح'; }
function executionRecords() { return Array.isArray(state?.workflows)?state.workflows:[]; }
function executionWorkflow(id) { return executionRecords().find(workflow=>workflow.id===id); }
function executionStep(workflow,id) { return workflow?.steps.find(step=>step.id===id); }
function executionProvenance(value) { return value==='server-analysis'?'تحليل مصدري من الخادم':value==='runner'?'دليل وارد من منفّذ خارجي':'توثيق يدوي من المراجع'; }
function executionBadge(value) { const cls={complete:'done',active:'running',pending:'queued',blocked:'pending',failed:'rejected'}[value]||'queued';return `<span class="status-badge ${cls}">${esc(executionStatuses[value]||value)}</span>`; }
function executionAdvanceAllowed(workflow,step) {
  const record=step?.verification;
  return Boolean(workflow&&step&&workflow.status!=='complete'&&workflow.steps[workflow.currentStepIndex]?.id===step.id&&step.phase==='verification'&&step.analysis?.outcome==='passed'&&(workflow.mode==='analysis-only'||step.change?.outcome==='passed')&&record?.outcome==='passed'&&record.sourceRevision===step.sourceRevision&&record.stepRevision===step.revision&&record.evidence?.length&&record.checks?.length&&record.checks.every(check=>check.exitCode===0));
}
function executionCapabilitiesContent() {
  const {value,loading,error}=executionCapabilities;
  if(loading||!executionCapabilities.attempted)return `<span class="execution-runner-note">${icon('clock')}جارٍ التحقق من خدمات التحليل والتنفيذ.</span>`;
  if(error)return `<span class="execution-runner-note">${icon('info')}${esc(error)} <button class="link-button" data-action="execution-capabilities">إعادة المحاولة</button></span>`;
  return `<div class="execution-runner-note">${icon('info')}<div><strong>${value?.sourceAnalysis?'تحليل المصدر متاح':'التحليل المصدري غير مهيّأ'}</strong><p>${value?.sourceAnalysis?'يفحص الخادم ملفات النسخة المحددة ويُرفق نطاق الفحص ونتيجته. ':''}التعديل الآلي وتشغيل الاختبارات يحتاجان إلى منفّذ خارجي. ${value?.runnerReceiptConfigured?'استقبال الأدلة الموثّقة مهيّأ؛ لا يثبت ذلك اتصال منفّذ أو تشغيله.':'استقبال أدلة المنفّذ الخارجي غير مهيّأ حاليًا.'}</p>${value?.privateRunnerAddress?`<p>الخادم الخاص المحدد: <code dir="ltr">${esc(value.privateRunnerAddress)}</code>. يلزم تثبيت المنفّذ عليه ليبدأ الاتصال الصادر إلى اللوحة.</p>`:''}${value?.githubActions==='setup-required'?'<p>GitHub Actions بحاجة إلى إعداد المستودع والصلاحيات قبل التشغيل.</p>':''}<p>الأدلة اليدوية تحفظ ما يبلّغ عنه المراجع؛ لا تُشغّل أمرًا أو تعدّل ملفًا من هذه اللوحة.</p><button class="button secondary small" data-action="runner-connection">${icon('download')}تنزيل إعدادات المنفّذ الخاصة</button> <a class="button secondary small" href="./downloads/aas-execution-kit.zip" download>حزمة تثبيت المنفّذ</a><p class="muted">ملف خاص بإعداد المنفّذ؛ يُحفظ خارج المستودع ولا يُعرض محتواه في اللوحة.</p></div></div>`;
}
async function loadExecutionCapabilities() {
  if(!store||executionCapabilities.loading)return;
  executionCapabilities.loading=true;executionCapabilities.attempted=true;updateExecutionCapabilityViews();
  try {executionCapabilities.value=await store.getExecutionCapabilities();executionCapabilities.error=null;}
  catch(error){executionCapabilities.error=error.name==='TypeError'?'تعذّر التحقق من خدمات التنفيذ.':error.message||'تعذّر التحقق من خدمات التنفيذ.';}
  finally {executionCapabilities.loading=false;updateExecutionCapabilityViews();}
}
function updateExecutionCapabilityViews() { document.querySelectorAll('[data-execution-capabilities]').forEach(node=>{node.innerHTML=executionCapabilitiesContent();});updateExecutionControls(); }
function updateExecutionControls() {
  if(!store)return;
  const locked=store.getConnection().status!=='online'||store.getConnection().busy;
  document.querySelectorAll('[data-action="workflow-analyze"]').forEach(button=>{const pending=executionPendingAnalysis.has(button.dataset.id)||(store.getConnection().pendingOperations||[]).includes('analysis:'+button.dataset.id);button.disabled=locked||pending||executionCapabilities.value?.sourceAnalysis!==true;button.setAttribute('aria-busy',String(pending));});
  document.querySelectorAll('[data-action="workflow-advance"]').forEach(button=>{const workflow=executionWorkflow(button.dataset.id);button.disabled=locked||!executionAdvanceAllowed(workflow,executionStep(workflow,button.dataset.step));});
  document.querySelectorAll('[data-action="runner-connection"]').forEach(button=>{button.disabled=locked||runnerConfigPending;button.setAttribute('aria-busy',String(runnerConfigPending));});
  document.querySelectorAll('[data-execution-operation]').forEach(node=>{node.className=executionPendingAnalysis.size?'info-banner compact':'';node.textContent=executionPendingAnalysis.size?'جارٍ تحليل '+executionPendingAnalysis.size+' مسارات محددة على الخادم. تبقى المسارات المستقلة متاحة؛ تُحفظ نتيجة كل تحليل على نسخته المرتبطة.':'';});
}
async function loadRepository({manual=false}={}) {
  if(github.loading||!store)return;
  github.loading=true;github.lastAttemptAt=Date.now();githubController=new AbortController();
  const requestController=githubController;
  const timeout=setTimeout(()=>requestController.abort(),20000);
  updateRepositoryViews();
  try {
    const response=await fetch('/api/v1/github'+(manual?'/refresh':''),{method:manual?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(manual?{'Content-Type':'application/json'}:{})},body:manual?'{}':undefined,signal:requestController.signal});
    let body;
    try {body=await response.json();}catch{throw new Error('لم يُرجع خادم المستودع استجابة صالحة. أعد المحاولة.');}
    const snapshot=body?.repository;
    if(snapshot&&typeof snapshot.fullName==='string'&&typeof snapshot.checkedAt==='string'&&Number.isFinite(Date.parse(snapshot.checkedAt))&&Array.isArray(snapshot.commits)&&Array.isArray(snapshot.branches)&&Array.isArray(snapshot.workflowRuns)) {
      github.repository=structuredClone(snapshot);
      github.cached=Boolean(body.cached);github.stale=Boolean(body.stale);github.nextRefreshAt=body.nextRefreshAt||null;
    } else if(response.ok&&!body?.error) {throw new Error('بيانات المستودع غير متوافقة مع لوحة القيادة.');}
    github.error=body?.error?.message||(!response.ok?'تعذّر جلب بيانات المستودع من GitHub.':null);
    if(github.error&&github.repository)github.stale=true;
    if(!github.repository&&!github.error)throw new Error('لم تصل بيانات المستودع من الخادم.');
    if(manual&&!github.error&&!github.stale)toast(github.cached?'آخر فحص متاح معروض. وقت الفحص وموعد التحديث موضّحان في الصفحة.':github.repository.source==='github-atom'?'تم تحديث المراجعات من خلاصة GitHub العامة':'تم تحديث بيانات المستودع من GitHub');
  } catch(error) {
    github.error=error.name==='AbortError'?'انتهت مهلة الاتصال بخدمة المستودع. أعد المحاولة.':error.message||'تعذّر الاتصال بخدمة المستودع.';
    if(github.repository)github.stale=true;
  } finally {
    clearTimeout(timeout);if(githubController===requestController)githubController=null;
    github.loading=false;updateRepositoryViews();
  }
}
function updateRepositoryViews() {
  const content=document.querySelector('#repository-content');
  if(content)content.innerHTML=repositoryContent();
  const overview=document.querySelector('#overview-repository');
  if(overview)overview.innerHTML=repositoryOverview();
  document.querySelectorAll('[data-action="refresh-repository"],[data-action="retry-repository"]').forEach(button=>{button.disabled=github.loading;button.setAttribute('aria-busy',String(github.loading));});
}
function syncRepositoryRoute() {
  const entered=lastRenderedRoute!==route;lastRenderedRoute=route;
  if((route==='repository'&&entered)||(route==='overview'&&!github.lastAttemptAt))loadRepository();
}
function renderBootstrap() {
  app.innerHTML = `<main class="boot-screen"><span class="brand-mark">${logo()}</span><span class="eyebrow" dir="ltr">AAS-CC / LIVE WORKSPACE</span><h1>${bootstrapError ? 'تعذّر الاتصال بلوحة القيادة' : 'جارٍ الاتصال بلوحة القيادة'}</h1><p>${bootstrapError ? esc(bootstrapError) : 'نحمّل بيانات مساحة العمل من الخادم.'}</p>${bootstrapError ? '<button class="button primary" data-action="retry-bootstrap">إعادة الاتصال</button>' : '<span class="connection-status connecting">جارٍ الاتصال…</span>'}</main>`;
}
function updateConnectionUi() {
  if (!store) return;
  const connection = store.getConnection();
  const text = connection.status === 'online' ? (connection.busy ? 'جارٍ الحفظ…' : 'متصل بالخادم') : connection.status === 'connecting' ? 'جارٍ الاتصال…' : 'الاتصال متوقف';
  const status = document.querySelector('#connection-status');
  if (status) { status.className='connection-status '+connection.status+(connection.busy?' busy':''); status.textContent=text; status.title=connection.lastSyncAt?'آخر مزامنة: '+date(connection.lastSyncAt,true):text; }
  const banner = document.querySelector('#connection-banner');
  if (banner) { banner.hidden=connection.status!=='offline'; banner.innerHTML=`<span>${icon('info')}${esc(connection.error||'تعذّر الاتصال بالخادم. البيانات المعروضة هي آخر نسخة تمت مزامنتها.')}</span><button class="button secondary small" data-action="retry-connection">إعادة الاتصال</button>`; }
  const sync = document.querySelector('#sync-time'); if(sync)sync.textContent=connection.lastSyncAt?'· '+date(connection.lastSyncAt,true):'';
  const locked=connection.status!=='online'||connection.busy;
  document.querySelectorAll('[data-action]').forEach(button=>{
    if(!mutatingActions.has(button.dataset.action))return;
    if(locked&&!button.disabled){button.disabled=true;button.dataset.apiDisabled='true';}
    else if(!locked&&button.dataset.apiDisabled){button.disabled=false;delete button.dataset.apiDisabled;}
  });
  document.querySelectorAll('form button[type="submit"]').forEach(button=>{
    if(locked&&!button.disabled){button.disabled=true;button.dataset.apiDisabled='true';}
    else if(!locked&&button.dataset.apiDisabled){button.disabled=false;delete button.dataset.apiDisabled;}
    button.setAttribute('aria-busy',String(connection.busy));
  });
  updateExecutionControls();
}
function render() {
  controlCenter.beforeRender();
  if (!store) { renderBootstrap(); return; }
  const drafts = [...dirtyForms].map(id => document.getElementById(id)).filter(Boolean).map(form => {
    const ordinals=new Map();
    return {id:form.id,key:form.dataset.id||form.dataset.workspace||'',baseRevision:form.dataset.baseRevision,values:[...form.elements].map(field=>{const ordinal=ordinals.get(field.name)||0;ordinals.set(field.name,ordinal+1);return {name:field.name,value:field.value,checked:field.checked,type:field.type,ordinal};})};
  });
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = typeof focused?.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
  state = store.getState();
  if (!routes.includes(route)) route = 'overview';
  const pending = state.approvals.filter(a => a.status === 'pending').length;
  app.innerHTML = `
    <div class="app-shell">
      <aside id="sidebar" class="sidebar ${mobileOpen ? 'open' : ''}" aria-label="التنقل الرئيسي">
        <a class="brand" href="#overview"><span class="brand-mark">${logo()}</span><span><strong class="brand-name" dir="ltr">Amer AI<span> Store</span></strong><span class="brand-caption">منظومة العمل الذكية</span></span></a>
        <button class="workspace-switch" data-route="workspaces"><span class="switch-icon">${icon('store')}</span><span><strong>${esc(state.settings.storeName || 'Amer AI Store')}</strong><small>مساحة المؤسسة</small></span>${icon('down')}</button>
        <div class="nav-label">إدارة المنظومة</div>
        <nav class="nav-items">
          ${[['overview','grid'],['orchestration','layers'],['advisor','spark'],['database','folder'],['execution','shield'],['workspaces','layers'],['tasks','tasks'],['agents','bot'],['approvals','shield'],['activity','activity'],['commerce','store'],['repository','code'],['integrations','link']].map(([r,i]) => `<a href="#${r}" class="nav-item ${route === r ? 'active' : ''}" ${route === r ? 'aria-current="page"' : ''}>${icon(i)}<span>${labels[r]}</span>${r === 'approvals' && pending ? `<span class="nav-count">${pending}</span>` : r === 'workspaces' ? '<span class="nav-count subtle">AW</span>' : ''}</a>`).join('')}
        </nav>
        <div class="sidebar-bottom"><div class="workspace-help"><span class="help-icon">${icon('spark')}</span><strong>كل فريق. مساحة واحدة.</strong><p>نظّم الوكلاء والمهام، وابقَ على اطّلاع بكل التفاصيل.</p><button data-route="workspaces">استكشف مساحات العمل ${icon('arrow')}</button></div>
        <a href="#settings" class="nav-item ${route === 'settings' ? 'active' : ''}">${icon('settings')}<span>الإعدادات والتكاملات</span></a>
        <div class="system-status"><span class="status-light"></span><span>تنفيذ الوكلاء غير مهيّأ</span><span class="mono">AAS</span></div>
        <button class="user-card" data-route="settings"><span class="avatar">A</span><span><strong>${esc(state.settings.ownerName || 'Amer')}</strong><small>مدير المنظومة</small></span>${icon('dots')}</button></div>
      </aside>
      ${mobileOpen ? '<div class="mobile-overlay" data-action="close-menu"></div>' : ''}
      <main class="main-shell">
        <header class="topbar"><div class="topbar-start"><button class="icon-button mobile-menu" data-action="menu" aria-label="فتح القائمة">${icon('menu')}</button><span class="topbar-title">مساحة المؤسسة <span>/</span> <strong>${labels[route]}</strong></span></div>
        <div class="topbar-actions"><div class="theme-control topbar-theme-control">${themeControl()}</div><button class="search-button" data-action="search">${icon('search')}<span>البحث في المنظومة...</span><kbd dir="ltr">⌘ K</kbd></button><span id="connection-status" class="connection-status" role="status"></span><div class="notification-anchor"><button class="icon-button notification-button" data-action="notifications" aria-label="الإشعارات" aria-expanded="${notificationOpen}">${icon('bell')}${pending && state.settings.notifications ? '<i class="notification-dot"></i>' : ''}</button>${notificationOpen ? notificationPanel() : ''}</div><button class="avatar topbar-avatar" data-route="settings" aria-label="حساب المدير">A</button></div></header>
        <div id="connection-banner" class="connection-banner" role="status" hidden></div>
        <div id="content" class="page-content">${page()}</div>
        <footer class="main-footer"><span dir="ltr">AMER AI STORE</span><span>AAS-CC / AAS-AW <i>·</i> مساحة موحّدة، رؤية أوضح.</span><span>حفظ مشترك على الخادم · D1 <span id="sync-time"></span></span></footer>
      </main>
    </div>`;
  for (const draft of drafts) {
    const form = document.getElementById(draft.id);
    if (!form || (form.dataset.id || form.dataset.workspace || '') !== draft.key) continue;
    if(draft.baseRevision)form.dataset.baseRevision=draft.baseRevision;
    for (const value of draft.values) {
      const fields = [...form.elements].filter(field => field.name && field.name === value.name);
      for (const [index,field] of fields.entries()) {
        if (value.type === 'checkbox' || value.type === 'radio') { if (field.value === value.value) field.checked = value.checked; }
        else if(index===value.ordinal)field.value = value.value;
      }
    }
  }
  if (focusId && document.getElementById(focusId)) { const field=document.getElementById(focusId); field.focus({preventScroll:true}); if(selection && ['text','search','textarea'].includes(field.type))field.setSelectionRange(...selection); }
  updateConnectionUi();
  syncRepositoryRoute();
  controlCenter.afterRender(route);
  if(['overview','execution'].includes(route)&&!executionCapabilities.attempted)loadExecutionCapabilities();
}
function page() {
  if(['orchestration','advisor','database'].includes(route))return controlCenter.page(route);
  return ({overview:overviewPage,workspaces:workspacesPage,tasks:tasksPage,agents:agentsPage,approvals:approvalsPage,activity:activityPage,execution:executionPage,commerce:commercePage,repository:repositoryPage,integrations:integrationsPage,settings:settingsPage}[route])();
}
function overviewPage() {
  const done = state.tasks.filter(t => t.status === 'done').length;
  const running = state.tasks.filter(t => t.status === 'running').length;
  const pending = state.approvals.filter(a => a.status === 'pending').length;
  const active = state.workspaces.filter(w => w.status === 'active').length;
  return titleBlock('مركز القيادة', 'الرقابة على مراحل العمل والأدلة والقرارات من موقع واحد.', 'AAS-CC / COMMAND CENTER', `<button class="button secondary" data-action="export">${icon('download')}تصدير البيانات</button>${newTaskButton()}`) + `
    <section class="welcome-banner"><div class="welcome-content"><span class="welcome-label"><span class="status-light"></span>AAS-CC · الرقابة التشغيلية</span><h2>مركز القيادة والتحكّم</h2><p>تابع مراحل التنفيذ وأدلتها، وراجع العوائق قبل اعتماد الخطوة التالية.</p><div class="welcome-meta"><span>${icon('shield')}<strong>${pending}</strong> قرارات بانتظار مراجعتك</span><span>${icon('layers')}<strong>${active}</strong> مساحات عمل نشطة</span></div></div><div class="welcome-graphic" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="welcome-logo">${logo()}</div><span class="orbit-point point-one"></span><span class="orbit-point point-two"></span><span class="graphic-code">CONNECTED BY DESIGN</span></div></section>
    ${executionOverview()}
    ${controlCenter.overview()}
    <section class="stats-grid" aria-label="مؤشرات المشروع">
      ${statCard('إجمالي المهام',state.tasks.length,'tasks','مهام موزّعة على فرقك','جميع المساحات')}
      ${statCard('مساحات العمل',state.workspaces.length,'layers',active + ' مساحات نشطة','AAS-AW')}
      ${statCard('المهام المكتملة',done,'check',Math.round(done / (state.tasks.length || 1) * 100) + '% من إجمالي المهام','إنجاز الفريق')}
      ${statCard('بانتظار موافقتك',pending,'shield','قرارات تتطلب مراجعة بشرية','تحتاج انتباهك',true)}
    </section>
    <div id="overview-repository">${repositoryOverview()}</div>
    <div class="dashboard-grid"><section class="panel chart-panel"><div class="panel-header"><div><h2>نبض العمل</h2><p class="panel-subtitle">توزيع المهام حسب الحالة في مساحة المؤسسة</p></div><select class="chart-period" id="chart-period" aria-label="عرض الرسم"><option value="week" ${chartPeriod === 'week' ? 'selected' : ''}>حسب الحالة</option><option value="workspace" ${chartPeriod === 'workspace' ? 'selected' : ''}>حسب المساحة</option></select></div><div class="panel-body chart-body">${workChart()}<div class="chart-legend"><span><i class="legend-dot green"></i>مكتملة</span><span><i class="legend-dot light"></i>باقي المهام</span><span class="chart-note">من البيانات المحفوظة على الخادم</span></div></div></section>
    <section class="mission-panel"><span class="mission-kicker" dir="ltr">YOUR NEXT MOVE</span><div class="mission-icon">${icon('layers')}</div><h2>فكرة واحدة.<br>فريق كامل لتنفيذها.</h2><p>امنح كل فريق مساحة عمل يجتمع فيها الوكلاء والمهام وملاحظات المشروع.</p><div class="mission-stats"><div class="mission-stat"><strong>${num(state.agents.length)}</strong><span>وكلاء متخصصون</span></div><div class="mission-stat"><strong>${num(running)}</strong><span>مهام قيد العمل</span></div></div><button class="button" data-action="new-workspace">إنشاء مساحة عمل ${icon('arrow')}</button></section></div>
    <div class="section-heading"><div><h2>فريق الوكلاء</h2><p>تخصصات مختلفة، هدف واحد.</p></div><button class="link-button" data-route="agents">عرض كل الوكلاء ${icon('arrow')}</button></div><div class="agents-grid overview-agents">${state.agents.slice(0,3).map(agentCard).join('')}</div>
    <section class="panel tasks-panel"><div class="panel-header"><div><h2>المهام الأخيرة <span class="title-count">${state.tasks.length}</span></h2><p class="panel-subtitle">تابع تقدم العمل عبر كل المساحات</p></div><button class="link-button" data-route="tasks">كل المهام ${icon('arrow')}</button></div>${taskTable([...state.tasks].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5))}</section>
    <div class="bottom-grid"><section class="panel"><div class="panel-header"><h2>صندوق الموافقات <span class="title-count">${pending}</span></h2>${icon('shield')}</div><div class="panel-body">${approvalList(state.approvals.filter(a=>a.status==='pending').slice(0,2))}</div><div class="panel-footer"><button class="link-button" data-route="approvals">فتح صندوق الموافقات ${icon('arrow')}</button></div></section><section class="panel"><div class="panel-header"><h2>آخر النشاطات</h2><button class="link-button" data-route="activity">عرض الكل</button></div><div class="panel-body">${activityList(state.activity.slice(0,4))}</div></section></div>`;
}
function statCard(label, value, type, footer, tag, attention = false) {
  return `<div class="stat-card ${attention ? 'attention' : ''}"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon(type)}</span></div><div class="stat-value" dir="ltr">${num(value)}<span class="stat-tag">${tag}</span></div><div class="stat-footer">${icon(attention ? 'clock' : 'trend')}<span>${footer}</span></div></div>`;
}
function workChart() {
  let groups;
  if (chartPeriod === 'workspace') groups = state.workspaces.map(w => ({label:w.name,done:state.tasks.filter(t=>t.workspaceId===w.id&&t.status==='done').length,total:state.tasks.filter(t=>t.workspaceId===w.id).length}));
  else groups = ['queued','running','review','done'].map(s => ({label:statusLabels[s],done:s==='done'?state.tasks.filter(t=>t.status===s).length:0,total:state.tasks.filter(t=>t.status===s).length}));
  const max = Math.max(4,...groups.map(g=>g.total));
  const width = 640, height = 205, bottom = 164, spacing = 540 / Math.max(1,groups.length);
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(groups.map(g=>g.label+': '+g.total).join('، '))}" style="direction:ltr">${[0,1,2,3,4].map(i=>`<line x1="48" y1="${bottom-i*34}" x2="618" y2="${bottom-i*34}" stroke="#e8eeeb" stroke-dasharray="4 5"/><text x="23" y="${bottom-i*34+4}" fill="#8a9992" font-size="11" text-anchor="middle">${Math.round(max*i/4)}</text>`).join('')}${groups.map((g,i)=>{const x=65+i*spacing;const h=g.total/max*126;const dh=g.done/max*126;return `<rect x="${x}" y="${bottom-h}" width="${Math.min(68,spacing*.48)}" height="${Math.max(h,2)}" rx="6" fill="#dcebe4"/>${dh?`<rect x="${x}" y="${bottom-dh}" width="${Math.min(68,spacing*.48)}" height="${dh}" rx="6" fill="#2a8065"/>`:''}<text x="${x+Math.min(68,spacing*.48)/2}" y="${bottom-h-10}" fill="#365e4d" font-size="13" text-anchor="middle">${g.total}</text><text x="${x+Math.min(68,spacing*.48)/2}" y="195" fill="#73857b" font-size="12" text-anchor="middle">${esc(g.label.length>17?g.label.slice(0,17)+'…':g.label)}</text>`}).join('')}</svg></div>`;
}
function agentCard(a) {
  const tasks = state.tasks.filter(t=>t.agentId===a.id), done = tasks.filter(t=>t.status==='done').length;
  return `<article class="agent-card"><div class="agent-head">${avatar(a)}<span class="agent-type">AGENT PROFILE</span><button class="icon-button" data-action="agent-detail" data-id="${esc(a.id)}" aria-label="تفاصيل ${esc(a.name)}">${icon('dots')}</button></div><div class="agent-body"><h3>${esc(a.name)}</h3><p>${esc(a.role)}</p></div><div class="agent-meta"><span>${icon('tasks')}${tasks.length} مهام</span><span class="agent-model">${badge(a.status)}</span></div><div class="agent-footer"><div class="agent-workload"><span>تقدم المهام المسندة</span><strong>${Math.round(done/(tasks.length||1)*100)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${done/(tasks.length||1)*100}%;--agent-color:${esc(a.color)}"></div></div><button class="agent-link" data-action="agent-detail" data-id="${esc(a.id)}">مساحة الوكيل ${icon('arrow')}</button></div></article>`;
}
function taskTable(tasks) {
  if (!tasks.length) return empty('لا توجد مهام هنا', 'أنشئ مهمة جديدة أو غيّر خيارات التصفية.',newTaskButton());
  return `<div class="table-wrap"><table><thead><tr><th>المهمة</th><th>الوكيل المسؤول</th><th>مساحة العمل</th><th>الحالة</th><th>الأولوية</th><th><span class="sr-only">تفاصيل</span></th></tr></thead><tbody>${tasks.map(t=>{const a=agent(t.agentId),w=workspace(t.workspaceId);return `<tr><td><button class="task-title" data-action="task-detail" data-id="${esc(t.id)}">${esc(t.title)}</button><span class="task-subtitle mono">${esc(t.id.slice(-8).toUpperCase())} <span>· ${date(t.createdAt)}</span></span></td><td><span class="table-agent">${avatar(a,true)}${esc(a?.name || 'غير محدد')}</span></td><td><button class="table-workspace" data-route="workspaces" data-id="${esc(w?.id || '')}">${esc(w?.name || 'غير محددة')}</button></td><td>${badge(t.status)}</td><td><span class="priority ${esc(t.priority)}"><i></i>${statusLabels[t.priority] || 'متوسطة'}</span></td><td><button class="icon-button table-action" data-action="task-detail" data-id="${esc(t.id)}" aria-label="عرض المهمة">${icon('chevron')}</button></td></tr>`}).join('')}</tbody></table></div>`;
}
function workspacesPage() {
  if (workspaceId && workspace(decodeURIComponent(workspaceId))) return workspaceDetail(workspace(decodeURIComponent(workspaceId)));
  return titleBlock('مساحات العمل','مكان مستقل لكل فريق. سياق واضح، مهام منظمة، ووكلاء متخصصون.','AAS-AW / AGENT WORKSPACES',`<button class="button primary" data-action="new-workspace">${icon('plus')}مساحة جديدة</button>`) +
    `<div class="workspace-intro"><span>${icon('layers')}</span><div><strong>مساحة لكل مهمة كبيرة</strong><p>اجمع أعضاء الفريق ومهامه وملاحظاته في سياق واحد.</p></div><span class="mono">AAS-AW</span></div><div class="workspaces-grid">${state.workspaces.map(w=>{const ts=state.tasks.filter(t=>t.workspaceId===w.id),done=ts.filter(t=>t.status==='done').length;return `<article class="workspace-card"><div class="workspace-card-top"><span class="workspace-icon" style="--agent-color:${esc(w.color)}">${icon('folder')}</span>${badge(w.status)}</div><div class="workspace-code mono">AAS-AW / ${esc(w.id.slice(-6).toUpperCase())}</div><h2>${esc(w.name)}</h2><p class="workspace-description">${esc(w.description)}</p><div class="workspace-people">${w.agentIds.map(id=>avatar(agent(id),true)).join('')}<span>${w.agentIds.length} وكلاء في الفريق</span></div><div class="workspace-metrics"><span>${ts.length} مهام</span><span>${done} مكتملة</span><strong>${Math.round(done/(ts.length||1)*100)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${done/(ts.length||1)*100}%;--agent-color:${esc(w.color)}"></div></div><div class="workspace-bottom"><span>${icon('clock')}مساحة عمل مشتركة</span><button class="link-button" data-route="workspaces" data-id="${esc(w.id)}">فتح المساحة ${icon('arrow')}</button></div></article>`}).join('')}<button class="new-workspace-card" data-action="new-workspace"><span>${icon('plus')}</span><h3>مساحة جديدة، إمكانات جديدة</h3><p>نظّم فريقك القادم في مساحة مستقلة.</p></button></div>`;
}
function workspaceDetail(w) {
  const tasks = state.tasks.filter(t=>t.workspaceId===w.id);
  return `<button class="link-button back-link" data-route="workspaces">${icon('chevron')}كل مساحات العمل</button>` + titleBlock(esc(w.name),esc(w.description),'AAS-AW / '+esc(w.id.slice(-6).toUpperCase()),`<button class="button secondary" data-action="edit-workspace" data-id="${esc(w.id)}">${icon('settings')}تعديل المساحة</button><button class="button secondary" data-action="toggle-workspace" data-id="${esc(w.id)}">${icon(w.status==='active'?'pause':'play')}${w.status==='active'?'إيقاف المساحة':'تفعيل المساحة'}</button><button class="button primary" data-action="new-task" data-workspace="${esc(w.id)}">${icon('plus')}إضافة مهمة</button>`) + `
  <div class="detail-grid"><div class="detail-main"><section class="panel"><div class="panel-header"><h2>مهام المساحة</h2>${badge(w.status)}</div>${taskTable(tasks)}</section><section class="panel"><div class="panel-header"><h2>دفتر الفريق</h2><span class="panel-subtitle">ملاحظات وسياق مشترك</span></div><div class="panel-body"><form class="note-form" id="note-form" data-workspace="${esc(w.id)}"><textarea name="body" placeholder="أضف فكرة، قرارًا، أو معلومة يحتاجها فريقك..." required maxlength="4000" aria-label="ملاحظة الفريق"></textarea><button class="button primary small" type="submit">${icon('plus')}إضافة ملاحظة</button></form><div class="note-list">${w.notes?.length?w.notes.map(n=>`<article class="note-item"><div><span class="avatar-mini">A</span><strong>${esc(state.settings.ownerName)}</strong><time>${date(n.createdAt,true)}</time></div><p>${esc(n.body)}</p></article>`).join(''):empty('دفتر الفريق جاهز','أضف أول ملاحظة لتحتفظ بسياق العمل.')}</div></div></section></div><aside class="detail-side"><section class="panel"><div class="panel-header"><h2>فريق المساحة</h2><button class="link-button" data-action="edit-workspace" data-id="${esc(w.id)}">تعديل الفريق</button></div><div class="panel-body team-list">${w.agentIds.map(id=>{const a=agent(id);return `<button class="team-member" data-action="agent-detail" data-id="${esc(id)}">${avatar(a,true)}<span><strong>${esc(a?.name)}</strong><small>${esc(a?.role)}</small></span>${icon('chevron')}</button>`}).join('')}</div></section><div class="info-banner">${icon('info')}<p>المهام والملاحظات محفوظة على الخادم ومشتركة بين جلسات اللوحة. تشغيل الوكلاء يحتاج ربط خدمة تنفيذ.</p></div></aside></div>`;
}
function filteredTasks() { return state.tasks.filter(t=>(taskFilter==='all'||t.status===taskFilter)&&(!taskQuery||[t.title,t.description,agent(t.agentId)?.name,workspace(t.workspaceId)?.name].some(v=>String(v||'').toLowerCase().includes(taskQuery.toLowerCase())))); }
function tasksPage() {
  return titleBlock('المهام','حوّل الخطط إلى خطوات واضحة، وتابعها حتى الإنجاز.','AAS / TASK MANAGEMENT',newTaskButton()) + `
  <section class="panel"><div class="filter-bar"><div class="filter-tabs">${['all','queued','running','review','done'].map(s=>`<button class="filter-tab ${taskFilter===s?'active':''}" data-action="task-filter" data-id="${s}">${s==='all'?'كل المهام':statusLabels[s]}<span>${state.tasks.filter(t=>s==='all'||t.status===s).length}</span></button>`).join('')}</div><div class="view-switch"><button class="icon-button ${taskView==='table'?'selected':''}" data-action="task-view" data-id="table" aria-label="عرض الجدول">${icon('tasks')}</button><button class="icon-button ${taskView==='board'?'selected':''}" data-action="task-view" data-id="board" aria-label="عرض اللوحة">${icon('grid')}</button></div></div><div class="task-search-row"><label class="search-field">${icon('search')}<input id="task-search" type="search" placeholder="ابحث عن مهمة أو وكيل..." value="${esc(taskQuery)}" aria-label="بحث المهام"></label><span class="muted">الحالات يحدّثها الفريق وتُزامن تلقائيًا</span></div><div id="task-results">${taskResults()}</div></section>`;
}
function taskResults() {
  if(taskView==='table') return taskTable(filteredTasks());
  const tasks=filteredTasks();
  return `<div class="kanban-grid">${['queued','running','review','done'].map(s=>`<section class="kanban-column"><div class="kanban-heading">${badge(s)}<span>${tasks.filter(t=>t.status===s).length}</span></div>${tasks.filter(t=>t.status===s).map(t=>`<button class="task-card" data-action="task-detail" data-id="${esc(t.id)}"><span class="priority ${t.priority}">${statusLabels[t.priority]}</span><h3>${esc(t.title)}</h3><p>${esc(workspace(t.workspaceId)?.name)}</p><div>${avatar(agent(t.agentId),true)}<span>${esc(agent(t.agentId)?.name)}</span></div></button>`).join('')||'<p class="kanban-empty">لا توجد مهام</p>'}</section>`).join('')}</div>`;
}
function agentsPage() {
  return titleBlock('فريق الوكلاء','خبرات متخصصة تعمل ضمن منظومة واحدة. اختر الوكيل المناسب لكل مهمة.','AAS / AGENT DIRECTORY',newTaskButton())+`<div class="info-banner compact">${icon('info')}<p>الوكلاء معرّفون تنظيميًا. ربط النماذج والتنفيذ الآلي لم يُفعّلا بعد.</p><span class="mono">${state.agents.length} SPECIALTIES</span></div><div class="agents-grid full-agents">${state.agents.map(agentCard).join('')}</div>`;
}
function approvalList(items) {
  return items.length?`<div class="approval-list">${items.map(a=>`<article class="approval-item"><span class="approval-icon">${icon('shield')}</span><div class="approval-copy"><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p><div class="approval-meta">${badge(a.status)}<span>${esc(a.impact)}</span></div>${a.status==='pending'?`<div class="approval-actions"><button class="button primary small" data-action="approve" data-id="${esc(a.id)}">${icon('check')}اعتماد</button><button class="button secondary small" data-action="reject" data-id="${esc(a.id)}">رفض</button><button class="link-button" data-action="approval-detail" data-id="${esc(a.id)}">مراجعة التفاصيل</button></div>`:''}</div></article>`).join('')}</div>`:empty('لا توجد موافقات معلّقة','ستظهر القرارات التي تحتاج مراجعتك هنا.');
}
function approvalsPage() {
  return titleBlock('صندوق الموافقات','القرار لك. راجع الإجراءات قبل انتقالها إلى المرحلة التالية.','AAS / HUMAN IN THE LOOP')+`<div class="info-banner compact">${icon('shield')}<p>كل قرار يُحفظ على الخادم ويُسجل في النشاط. يُعاد العمل المعتمد إلى قائمة الانتظار.</p></div><section class="panel"><div class="filter-bar"><div class="filter-tabs">${['pending','approved','rejected','all'].map(s=>`<button class="filter-tab ${approvalFilter===s?'active':''}" data-action="approval-filter" data-id="${s}">${s==='all'?'جميع القرارات':statusLabels[s]}<span>${state.approvals.filter(a=>s==='all'||a.status===s).length}</span></button>`).join('')}</div></div><div class="panel-body">${approvalList(state.approvals.filter(a=>approvalFilter==='all'||a.status===approvalFilter))}</div></section>`;
}
function activityList(items) {
  return items.length?`<div class="activity-list">${items.map(a=>`<article class="activity-item"><span class="activity-dot">${icon(a.type?.includes('approval')?'shield':a.type?.includes('workspace')?'layers':'tasks')}</span><div class="activity-copy"><h3>${esc(a.title || a.message)}</h3><p>${esc(a.description || '')}</p><time class="activity-time">${date(a.createdAt,true)}</time></div></article>`).join('')}</div>`:empty('لا يوجد نشاط بعد','ابدأ بإضافة مهمة أو مساحة عمل.');
}
function executionGate(label,record,{skipped=false}={}) {
  const outcome=skipped?'skipped':record?.outcome||'pending';
  const detail=skipped?'غير مطلوبة':outcome==='passed'?'دليل مقبول':outcome==='failed'?'فشل موثّق':outcome==='blocked'?'عائق موثّق':'بانتظار الدليل';
  return `<span class="execution-gate ${esc(outcome)}"><strong>${label}</strong><small>${detail}</small></span>`;
}
function executionEvents(items,limit=20) {
  if(!items.length)return empty('لا توجد أحداث تنفيذ بعد','تظهر هنا العمليات والانتقالات المحفوظة على الخادم بعد إنشاء مسار عمل.');
  return `<ol class="execution-events">${items.slice(0,limit).map(event=>`<li class="execution-event"><span>${icon(event.type?.includes('verification')?'shield':event.type?.includes('analysis')?'search':'activity')}</span><div>${event.workflowTitle?`<strong>${esc(event.workflowTitle)}</strong>`:''}<p>${esc(event.message)}</p><small>${esc(executionProvenance(event.provenance))}</small><time>${repositoryDate(event.createdAt)}</time></div></li>`).join('')}</ol>`;
}
function executionOverview() {
  const workflows=executionRecords();
  const active=workflows.filter(workflow=>workflow.status==='active').length;
  const stopped=workflows.filter(workflow=>['blocked','failed'].includes(workflow.status)).length;
  const completed=workflows.filter(workflow=>workflow.status==='complete').length;
  const events=workflows.flatMap(workflow=>workflow.events.map(event=>({...event,workflowTitle:workflow.title}))).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const current=workflows.find(workflow=>workflow.status!=='complete');
  const step=current?.steps[current.currentStepIndex];
  return `<section class="panel execution-command"><div class="panel-header"><div><span class="eyebrow command-center-code">AAS-CC / EXECUTION CONTROL</span><h2>إدارة مراحل التنفيذ</h2></div><button class="button primary" data-route="execution">فتح مراحل التنفيذ ${icon('arrow')}</button></div><div class="panel-body"><div class="execution-stats"><div><strong>${active}</strong><span>مسارات قيد المتابعة</span></div><div><strong>${stopped}</strong><span>تحتاج معالجة عائق أو فشل</span></div><div><strong>${completed}</strong><span>مسارات مكتملة الأدلة</span></div></div>${current?`<div class="execution-step-head"><div><strong>${esc(current.title)}</strong><p>${esc(step?.title||'')} · ${esc(executionPhases[step?.phase]||'')}</p></div>${executionBadge(current.status)}</div><div class="execution-gates">${executionGate('التحليل',step?.analysis)}${executionGate('التغيير',step?.change,{skipped:current.mode==='analysis-only'})}${executionGate('التحقق',step?.verification)}</div>`:'<p class="muted">ابدأ بمسار يتضمن خطوات مرتبة. يبقى الانتقال مغلقًا حتى استيفاء أدلة كل خطوة.</p>'}<div data-execution-capabilities>${executionCapabilitiesContent()}</div><h3 class="dialog-section-title">آخر أحداث التنفيذ</h3>${executionEvents(events,4)}</div></section>`;
}
function executionWorkflowCard(workflow,selected) {
  const step=workflow.steps[workflow.currentStepIndex];
  const done=workflow.steps.filter(item=>item.phase==='complete').length;
  return `<article class="execution-card ${selected?'selected':''}"><div class="execution-card-head"><div><h2>${esc(workflow.title)}</h2><p>${esc(workflow.description||'')}</p></div>${executionBadge(workflow.status)}</div><div class="execution-meta"><span>${done} / ${workflow.steps.length} خطوات مكتملة</span><span>${workflow.mode==='analysis-only'?'تحليل وتحقق':'تحليل، تغيير، تحقق'}</span>${workflow.repository?`<span dir="ltr">${esc(workflow.repository)}</span>`:''}<span>${workflow.status==='complete'?'أُغلق المسار بعد اعتماد الأدلة':esc(executionPhases[step?.phase]||'بانتظار التحليل')}</span></div><button class="link-button" data-route="execution" data-id="${esc(workflow.id)}">${selected?'المسار المعروض':'تفاصيل المسار'} ${icon('arrow')}</button></article>`;
}
function executionPage() {
  const workflows=executionRecords();
  let requested;try{requested=workspaceId?decodeURIComponent(workspaceId):null;}catch{requested=null;}
  const selected=executionWorkflow(requested)||workflows.find(workflow=>workflow.status!=='complete')||workflows[0];
  const events=(selected?.events||[]).slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return titleBlock('مراحل التنفيذ','خطوات مرتبة بأدلة واضحة. لا تنتقل الخطوة إلى التالية قبل اجتياز التحليل والتغيير والتحقق.','AAS-CC / EXECUTION GATES',`<button class="button primary" data-action="new-workflow">${icon('plus')}مسار تنفيذ جديد</button>`)+`<section class="panel"><div class="panel-body" data-execution-capabilities>${executionCapabilitiesContent()}</div></section><div data-execution-operation role="status"></div>${!workflows.length?empty('لم تُنشأ مسارات تنفيذ بعد','حدّد المستودع ونسخة المصدر، ثم رتّب الخطوات. يحفظ الخادم الأدلة ويفرض ترتيب الانتقال.',`<button class="button primary" data-action="new-workflow">${icon('plus')}إنشاء أول مسار</button>`):`<div class="execution-layout"><div><div class="execution-list">${workflows.map(workflow=>executionWorkflowCard(workflow,workflow.id===selected?.id)).join('')}</div>${selected?executionDetail(selected):''}</div><aside class="panel"><div class="panel-header"><h2>سجل انتقالات المسار</h2><span class="title-count">${events.length}</span></div><div class="panel-body">${executionEvents(events)}</div></aside></div>`}`;
}
function executionDetail(workflow) {
  const current=workflow.steps[workflow.currentStepIndex];
  return `<section class="panel"><div class="panel-header"><h2>خطوات ${esc(workflow.title)}</h2><button class="link-button" data-action="workflow-add-step" data-id="${esc(workflow.id)}" ${workflow.steps.length>=30?'disabled':''}>${icon('plus')}إضافة خطوة</button></div><div class="panel-body"><p class="execution-meta">نسخة المصدر الحالية: <span class="mono" dir="ltr">${esc(workflow.sourceRevision)}</span></p><ol class="execution-steps">${workflow.steps.map((step,index)=>{const locked=index>workflow.currentStepIndex;const isCurrent=index===workflow.currentStepIndex&&workflow.status!=='complete';return `<li class="execution-step ${locked?'locked':step.phase==='complete'?'completed':isCurrent?'current':''}"><div class="execution-step-head"><div><span class="eyebrow">الخطوة ${index+1}${locked?' · مغلقة حتى اجتياز السابقة':''}</span><h3>${esc(step.title)}</h3><p>${esc(step.description||'')}</p></div>${executionBadge(step.status)}</div><div class="execution-gates">${executionGate('التحليل',step.analysis)}${executionGate('التغيير',step.change,{skipped:workflow.mode==='analysis-only'})}${executionGate('التحقق',step.verification)}</div><p class="execution-meta">${esc(executionPhases[step.phase])} · نسخة الخطوة ${step.revision} · <span class="mono" dir="ltr">${esc(step.sourceRevision.slice(0,12))}</span></p>${isCurrent?executionStepActions(workflow,step):step.phase==='complete'?`<button class="link-button" data-action="workflow-analysis" data-id="${esc(workflow.id)}" data-step="${esc(step.id)}">إعادة فتح التحليل لهذه الخطوة</button>`:''}${[step.analysis,step.change,step.verification].some(Boolean)?`<details class="execution-evidence"><summary>عرض أدلة الخطوة</summary>${executionRecord('دليل التحليل',step.analysis)}${executionRecord('دليل التغيير',step.change)}${executionRecord('دليل التحقق',step.verification)}</details>`:''}</li>`;}).join('')}</ol>${workflow.status==='complete'?'<div class="info-banner">'+icon('check')+'<p>اعتمد الخادم انتقالات جميع الخطوات بعد استيفاء أدلتها. مصدر كل دليل موضّح في السجل.</p></div>':`<div class="info-banner">${icon('shield')}<p>الخطوة الحالية: ${esc(current?.title)}. يرفض الخادم الانتقال إذا غاب دليل مطلوب، أو اختلفت نسخة المصدر، أو لم تنجح جميع الفحوص.</p></div>`}</div></section>`;
}
function executionStepActions(workflow,step) {
  const attrs=`data-id="${esc(workflow.id)}" data-step="${esc(step.id)}"`;
  return `<div class="execution-actions">${step.phase==='analysis'?`<button class="button primary" data-action="workflow-analyze" ${attrs} ${executionCapabilities.value?.sourceAnalysis?'':'disabled'}>${icon('search')}تحليل ملفات المصدر</button><button class="button secondary" data-action="workflow-analysis" ${attrs}>توثيق تحليل يدوي</button>`:''}${workflow.mode!=='analysis-only'&&step.analysis?.outcome==='passed'&&['implementation','verification'].includes(step.phase)?`<button class="button ${step.phase==='implementation'?'primary':'secondary'}" data-action="workflow-change" ${attrs}>${icon('code')}${step.change?'تحديث التغيير وإبطال التحقق السابق':'توثيق التعديل أو الإضافة'}</button>`:''}${step.phase==='verification'?`<button class="button secondary" data-action="workflow-verification" ${attrs}>${icon('shield')}توثيق نتيجة التحقق</button><button class="button primary" data-action="workflow-advance" ${attrs} ${executionAdvanceAllowed(workflow,step)?'':'disabled'}>${icon('arrow')}${workflow.currentStepIndex===workflow.steps.length-1?'اعتماد وإكمال المسار':'اعتماد والانتقال للخطوة التالية'}</button>`:''}</div>`;
}
function executionRecord(label,record) {
  if(!record)return '';
  const result={passed:'دليل مقبول',failed:'فشل موثّق',blocked:'عائق موثّق'}[record.outcome]||record.outcome;
  return `<article><h4>${label} · ${esc(result)}</h4><p>${esc(record.summary)}</p><p class="execution-meta">${esc(executionProvenance(record.provenance))} · ${repositoryDate(record.recordedAt)} · نسخة الخطوة ${record.stepRevision}</p><p class="execution-meta mono" dir="ltr">${esc(record.sourceRevision)}</p>${record.checks?.length?`<ul>${record.checks.map(check=>`<li><strong>${esc(check.name)}</strong> · <code>${esc(check.command)}</code> · ${check.exitCode===null?'لم يبلّغ عن تنفيذ':`رمز الخروج: ${check.exitCode}`}</li>`).join('')}</ul>`:''}${record.evidence.map(item=>`<details><summary>${esc(item.label)}</summary>${item.content?`<pre>${esc(item.content)}</pre>`:''}${item.url?executionEvidenceLink(item.url):''}${item.sha256?`<p class="execution-meta mono" dir="ltr">SHA-256: ${esc(item.sha256)}</p>`:''}</details>`).join('')}</article>`;
}
function executionEvidenceLink(value) { try {const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error();return `<a class="repository-link" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">فتح مرجع الدليل</a>`;}catch{return '<span class="muted">مرجع الدليل غير صالح للفتح.</span>';} }
function activityPage() { return titleBlock('سجل النشاط','كل تغيير في مكانه. سجل واضح لما يحدث داخل بيئتك.','AAS / ACTIVITY LOG',`<button class="button secondary" data-action="export">${icon('download')}تصدير السجل</button>`)+`<section class="panel"><div class="panel-header"><h2>نشاط المنظومة</h2><span class="muted">${state.activity.length} أحداث محفوظة</span></div><div class="panel-body full-activity">${activityList(state.activity)}</div></section>`; }
function repositoryOverview() {
  const repo=github.repository;
  const label=repo?(github.stale?'آخر نسخة محفوظة من GitHub':repo.source==='github-atom'?'مراجعات GitHub متصلة عبر Atom':'مستودع الكود مرتبط'):(github.loading?'جارٍ التحقق من GitHub':github.error?'تعذّر قراءة المستودع':'بانتظار قراءة المستودع');
  return `<section class="panel repository-overview"><div class="panel-header"><h2>مستودع المشروع</h2><button class="link-button" data-route="repository">تفاصيل GitHub ${icon('arrow')}</button></div><div class="panel-body"><div class="repository-overview-main"><span class="integration-icon">${icon('code')}</span><div><strong class="repository-name" dir="ltr">${repo?githubLink(repo.htmlUrl,repo.fullName):'GitHub'}</strong><p class="repository-meta">${esc(label)}</p></div><span class="status-badge ${repo&&!github.stale?'approved':github.error?'offline':'pending'}">${repo&&!github.stale?'تم التحقق':github.loading?'جارٍ التحميل':repo?'بيانات سابقة':'غير متاح'}</span></div>${repo?`<div class="repository-overview-facts"><span>${repo.pushedAt?'آخر رفع:':repo.head?.committedAt?'أحدث مراجعة:':'تاريخ آخر رفع غير متاح'} <time>${repositoryDate(repo.pushedAt||repo.head?.committedAt)}</time></span><span>المراجعة: <span class="repository-sha" dir="ltr">${esc(repo.head?.sha?.slice(0,8)||'—')}</span></span><span>وقت الفحص: ${repositoryDate(repo.checkedAt)}</span><span>المصدر: ${esc(repositorySource(repo))}</span></div>`:''}${github.error?`<p class="repository-meta">${esc(github.error)}</p>${!repo?'<button class="link-button" data-action="retry-repository">إعادة المحاولة</button>':''}`:''}<p class="repository-note">${state.commerce?.receivedAt?'آخر استلام لبيانات التطبيق: '+repositoryDate(state.commerce.receivedAt):'لم تصل بيانات تشغيل من التطبيق بعد.'} <button class="link-button" data-route="commerce">بيانات التطبيق ${icon('arrow')}</button></p></div></section>`;
}
function repositoryPage() {
  return titleBlock('مستودع GitHub','تابع مصدر الكود والفروع والمراجعات ونتائج البناء من GitHub.','AAS / SOURCE REPOSITORY',`<button class="button secondary" data-action="refresh-repository" ${github.loading?'disabled':''} aria-busy="${github.loading}">${icon('activity')}${github.loading?'جارٍ التحديث…':'تحديث من GitHub'}</button>`)+`<div id="repository-content">${repositoryContent()}</div>`;
}
function repositoryContent() {
  const repo=github.repository;
  if(!repo) return `<section class="panel"><div class="panel-body">${github.loading||!github.lastAttemptAt?empty('جارٍ قراءة المستودع','نطلب بيانات GitHub الفعلية عبر الخادم المركزي.'):empty('تعذّر تحميل المستودع',esc(github.error||'لم تصل بيانات من GitHub.'),'<button class="button primary" data-action="retry-repository">إعادة المحاولة</button>')}</div></section>`;
  const zone=state.settings.timezone||'Asia/Amman';
  const atom=repo.source==='github-atom';
  const metadataUnavailable=repo.metadataAccess==='unavailable';
  const branchesUnavailable=repo.branchAccess==='unavailable';
  const unknown=metadataUnavailable?'غير متاح من المصدر الحالي':'—';
  const visibility=repo.private===true?'مستودع خاص':repo.private===false?'مستودع عام':'حالة ظهور المستودع غير متاحة';
  const status=github.stale?'بيانات محفوظة؛ التحديث متعذّر':github.loading?'جارٍ التحديث من الخادم':github.cached?(atom?'آخر قراءة محفوظة لخلاصة المراجعات':'آخر فحص محفوظ على الخادم'):(atom?'تمت قراءة خلاصة المراجعات العامة':'تم التحقق من GitHub');
  return `${github.error?`<div class="repository-alert" role="status">${icon('info')}<div><strong>تعذّر تحديث المستودع</strong><p>${esc(github.error)}</p><p>تعرض الصفحة آخر بيانات وصلتنا، ووقت فحصها الأصلي موضّح أدناه.</p></div><button class="button secondary small" data-action="retry-repository">إعادة المحاولة</button></div>`:''}
    <section class="panel repository-hero"><div class="panel-body"><div class="repository-identity"><span class="integration-icon">${icon('code')}</span><div><span class="eyebrow">${esc(visibility)} · ${esc(repositorySource(repo))}</span><h2 class="repository-name" dir="ltr">${githubLink(repo.htmlUrl,repo.fullName)}</h2><p>${esc(metadataUnavailable&&repo.description==null?'وصف المستودع غير متاح من مصدر المراجعات الحالي.':repo.description||'لا يوجد وصف للمستودع على GitHub.')}</p></div><span class="status-badge ${github.stale?'pending':'approved'}">${github.stale?'نسخة سابقة':atom?'المراجعات متصلة':'مصدر الكود مرتبط'}</span></div><div class="repository-status"><span>${icon('clock')}${esc(status)}</span><span>وقت الفحص: <time>${repositoryDate(repo.checkedAt)}</time></span></div><dl class="repository-facts"><div><dt>الفرع الافتراضي</dt><dd class="mono" dir="ltr">${esc(repo.defaultBranch||'غير متاح من المصدر الحالي')}</dd></div><div><dt>${atom?'أحدث مراجعة في الخلاصة':'آخر مراجعة على الفرع'}</dt><dd>${repo.head?githubLink(repo.head.htmlUrl,String(repo.head.sha||'').slice(0,12),'repository-link repository-sha'):'لا توجد مراجعات'}</dd></div><div><dt>تاريخ أحدث مراجعة</dt><dd><time>${repositoryDate(repo.head?.committedAt)}</time></dd></div><div><dt>آخر رفع إلى المستودع</dt><dd><time>${repo.pushedAt?repositoryDate(repo.pushedAt):unknown}</time></dd></div><div><dt>آخر تحديث لبيانات المستودع</dt><dd><time>${repo.updatedAt?repositoryDate(repo.updatedAt):unknown}</time></dd></div><div><dt>تاريخ الإنشاء</dt><dd><time>${repo.createdAt?repositoryDate(repo.createdAt):unknown}</time></dd></div><div><dt>المنطقة الزمنية المعروضة</dt><dd class="mono" dir="ltr">${esc(zone)}</dd></div></dl>${repo.head?`<p class="repository-note">آخر رسالة مراجعة: ${esc(commitSummary(repo.head.message))}</p>`:''}${github.nextRefreshAt?`<p class="repository-meta">موعد إتاحة طلب تحديث جديد: ${repositoryDate(github.nextRefreshAt)}</p>`:''}</div></section>
    ${repositoryPartialNotice(repo)}<div class="info-banner compact">${icon('info')}<p>تعرض هذه الصفحة النسخة المنشورة على GitHub. التغييرات غير المنشورة في جلسة تطوير أخرى لن تظهر فيها. ${state.commerce?.receivedAt?'وصلت بيانات من التطبيق في '+repositoryDate(state.commerce.receivedAt)+'.':'لم تصل بيانات تشغيل من التطبيق المثبّت بعد.'} يمكنك متابعة الاستلام في شاشة بيانات التطبيق.</p><button class="link-button" data-route="commerce">بيانات التطبيق ${icon('arrow')}</button></div>
    <div class="repository-grid"><section class="panel repository-section"><div class="panel-header"><h2>المراجعات الأخيرة</h2><span class="title-count">${repo.commits.length}</span></div><div class="panel-body">${repo.commits.length?`<ol class="repository-list">${repo.commits.map(commit=>`<li class="repository-commit"><span class="repository-sha" dir="ltr">${githubLink(commit.htmlUrl,String(commit.sha||'').slice(0,8))}</span><div><h3>${githubLink(commit.htmlUrl,commitSummary(commit.message))}</h3><p class="repository-meta">${esc(commit.authorName||'اسم الكاتب غير متاح')} · <time>${repositoryDate(commit.committedAt)}</time></p></div></li>`).join('')}</ol>`:empty('لا توجد مراجعات','لم يُرجع GitHub مراجعات لهذا المستودع.')}</div></section>
    <section class="panel repository-section"><div class="panel-header"><h2>الفروع</h2>${branchesUnavailable?'<span class="status-badge queued">بيانات غير متاحة</span>':`<span class="title-count">${repo.branches.length}</span>`}</div><div class="panel-body">${branchesUnavailable?empty('بيانات الفروع غير متاحة','مصدر المراجعات الحالي لا يوفّر قائمة الفروع. لا تعني هذه الحالة أن المستودع بلا فروع.'):repo.branches.length?`<ul class="repository-list">${repo.branches.map(branch=>`<li class="repository-branch"><div><strong class="mono" dir="ltr">${esc(branch.name)}</strong><p class="repository-meta repository-sha" dir="ltr">${esc(String(branch.sha||'').slice(0,12))}</p></div><span class="status-badge ${branch.protected?'approved':'queued'}">${branch.protected?'فرع محمي':'دون حماية فرع'}</span></li>`).join('')}</ul>`:empty('لا توجد فروع','لم يُرجع GitHub فروعًا لهذا المستودع.')}</div></section></div>
    <section class="panel repository-section"><div class="panel-header"><h2>عمليات البناء على GitHub</h2><span class="panel-subtitle">GitHub Actions</span></div><div class="panel-body">${repo.workflowAccess==='unavailable'?empty('بيانات البناء غير متاحة','تعذّرت قراءة GitHub Actions. لا تعني هذه الحالة نجاح البناء أو فشله.'):repo.workflowRuns.length?`<ul class="repository-list">${repo.workflowRuns.map(workflow=>`<li class="repository-workflow"><div><h3>${githubLink(workflow.htmlUrl,workflow.name||'GitHub Actions')}</h3><p class="repository-meta">بدأت: <time>${repositoryDate(workflow.createdAt)}</time> · آخر تحديث: <time>${repositoryDate(workflow.updatedAt)}</time></p><p class="repository-meta repository-sha" dir="ltr">${esc(String(workflow.headSha||'').slice(0,12))}</p></div>${workflowBadge(workflow)}</li>`).join('')}</ul>`:empty('لا توجد عمليات بناء مسجّلة','لم يُرجع GitHub تشغيلات Actions لهذا المستودع.')}</div></section>`;
}
function workflowBadge(workflow) {
  const statuses={queued:'في الانتظار',in_progress:'جارٍ البناء',completed:'اكتملت العملية',waiting:'بانتظار المتابعة',requested:'طُلب التشغيل',pending:'قيد الانتظار'};
  const conclusions={success:'نجح البناء',failure:'فشل البناء',cancelled:'أُلغي البناء',timed_out:'انتهت المهلة',action_required:'يلزم إجراء',neutral:'نتيجة محايدة',skipped:'تم التخطي',stale:'تشغيل سابق',startup_failure:'تعذّر بدء البناء'};
  const result=workflow.conclusion;
  const label=result?(conclusions[result]||result):(statuses[workflow.status]||workflow.status||'حالة غير متاحة');
  return `<span class="status-badge ${result==='success'?'approved':['failure','timed_out','startup_failure'].includes(result)?'rejected':'queued'}">${esc(label)}</span>`;
}
function settingsPage() {
  const s=state.settings;
  return titleBlock('الإعدادات','إعدادات المؤسسة ونسخ بيانات العمل المشتركة.','AAS / WORKSPACE SETTINGS')+`
  <div class="settings-grid"><section class="panel theme-settings"><div class="panel-header"><h2>مظهر الواجهة</h2></div><div class="panel-body"><p class="muted">اختيار خاص بهذا الجهاز؛ يطبّق فورًا دون تغيير إعدادات الفريق.</p><div class="theme-control">${themeControl('settings-theme-preference')}</div><p id="theme-resolved-state" class="muted">${theme.get().resolved==='dark'?'المظهر الحالي: داكن':'المظهر الحالي: فاتح'}</p></div></section><section class="panel form-panel"><div class="panel-header"><h2>مساحة المؤسسة</h2>${icon('store')}</div><form id="settings-form" class="panel-body"><div class="form-grid"><div class="field"><label for="store-name">اسم المؤسسة</label><input id="store-name" name="storeName" value="${esc(s.storeName)}" required maxlength="80"></div><div class="field"><label for="owner-name">اسم المدير</label><input id="owner-name" name="ownerName" value="${esc(s.ownerName)}" required maxlength="80"></div><div class="field"><label for="language">لغة الواجهة</label><select id="language"><option>العربية</option></select></div><div class="field"><label for="timezone">المنطقة الزمنية</label><select name="timezone" id="timezone">${['Asia/Amman','UTC','Asia/Riyadh','Asia/Dubai','Africa/Cairo'].map(z=>`<option value="${z}" ${s.timezone===z?'selected':''}>${z}</option>`).join('')}</select></div></div><label class="checkbox-field"><input type="checkbox" name="notifications" ${s.notifications?'checked':''}><span><strong>إشعارات الموافقات داخل التطبيق</strong><small>إظهار تنبيه عند وجود قرارات معلّقة</small></span></label><div class="divider"></div><button class="button primary" type="submit">${icon('check')}حفظ التغييرات</button></form></section>
  <section class="panel"><div class="panel-header"><h2>الخدمات</h2>${icon('link')}</div><div class="panel-body integration-list"><div class="integration-item"><span class="integration-icon">${icon('layers')}</span><div><strong>قاعدة بيانات مساحة العمل</strong><small>حفظ دائم ومزامنة بين الجلسات كل 3 ثوانٍ</small></div>${badge(store.getConnection().status)}</div><div class="integration-item"><span class="integration-icon">${icon('store')}</span><div><strong>خوادم تطبيق المتجر</strong><small>${state.servers.length} خوادم مهيّأة</small></div><button class="link-button" data-route="integrations">إدارة الربط ${icon('arrow')}</button></div><div class="integration-item"><span class="integration-icon">${icon('bot')}</span><div><strong>تنفيذ وكلاء الذكاء الاصطناعي</strong><small>يحتاج خدمة تنفيذ مرتبطة بتطبيق المتجر</small></div><span class="status-badge offline">غير مهيّأ</span></div></div></section>
  <section class="panel data-settings"><div class="panel-header"><h2>بيانات مساحة العمل</h2>${icon('folder')}</div><div class="panel-body"><p class="muted">التغييرات محفوظة على الخادم. الاستيراد يستبدل بيانات العمل المشتركة لجميع جلسات هذه اللوحة، بعد التحقق من الملف على الخادم.</p><div class="data-actions"><button class="button secondary" data-action="export">${icon('download')}تصدير JSON</button><button class="button secondary" data-action="import">${icon('upload')}استيراد نسخة</button><button class="button danger" data-action="reset">مسح بيانات العمل</button></div><input type="file" id="import-file" accept=".json,application/json" hidden></div></section></div>`;
}
function commercePage(){
  const c=state.commerce||{products:[],orders:[],receivedAt:null};
  const intro=titleBlock('بيانات التطبيق','المنتجات والطلبات الواردة من تطبيق أندرويد عبر اتصال خدمة موثّق.','AAS / APP DATA');
  if(!c.receivedAt)return intro+empty('لم يستقبل الخادم مزامنة من التطبيق بعد','تظهر البيانات هنا بعد إعداد اتصال مركز القيادة في تطبيق أندرويد وإرسال المزامنة. لا تُعرض منتجات أو طلبات افتراضية.',`<button class="button primary" data-route="integrations">${icon('link')}إعدادات الربط</button>`);
  return intro+`<div class="info-banner compact">${icon('check')}<p>آخر استلام: ${date(c.receivedAt,true)} · الجهاز ${esc(c.deviceId)} · الإصدار ${esc(c.appVersion)}. هذه بيانات يبلّغ عنها التطبيق؛ استلامها لا يثبت تحصيل دفعات.</p></div><div class="stats-grid">${statCard('المنتجات المتزامنة',c.products.length,'store','سجلات واردة من التطبيق','الكتالوج')}${statCard('الطلبات المتزامنة',c.orders.length,'tasks','سجلات واردة من التطبيق','الطلبات')}</div><section class="panel"><div class="panel-header"><h2>كتالوج التطبيق</h2></div><div class="table-wrap"><table><thead><tr><th>المنتج</th><th>التصنيف</th><th>التاجر</th><th>السعر</th><th>الكمية</th></tr></thead><tbody>${c.products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${esc(p.merchantName)}</td><td>${num(p.retailPrice)}</td><td>${num(p.stockQuantity)}</td></tr>`).join('')}</tbody></table></div></section><section class="panel" style="margin-top:20px"><div class="panel-header"><h2>الطلبات الواردة</h2></div><div class="table-wrap"><table><thead><tr><th>معرّف الطلب</th><th>المنتج</th><th>الكمية</th><th>القيمة المسجّلة</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${c.orders.map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(o.productName)}</td><td>${num(o.quantity)}</td><td>${num(o.totalPrice)}</td><td>${esc(o.status)}</td><td>${date(o.createdAt,true)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
async function downloadAppConnection(){
  const response=await fetch('/api/v1/app/connection-config',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
  const config=await response.json();
  if(!response.ok)throw new Error(config.error?.message||'تعذر تنزيل إعدادات الاتصال');
  const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='aas-app-connection.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadRunnerConnection() {
  if(runnerConfigPending)return;
  runnerConfigPending=true;updateExecutionControls();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch('/api/v1/runner/connection-config',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json'},body:'{}',signal:controller.signal});
    const config=await response.json();if(!response.ok)throw new Error(config?.error?.message||'تعذّر تنزيل إعدادات المنفّذ.');
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='aas-runner-connection.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } finally {clearTimeout(timeout);runnerConfigPending=false;updateExecutionControls();}
}
function integrationsPage() {
  const servers=state.servers;
  return titleBlock('الخوادم والربط','اضبط عنوان API لكل خادم وافحص الاتصال من الخادم المركزي.','AAS / SERVER INTEGRATIONS',`<button class="button secondary" data-action="app-connection">${icon('download')}إعدادات ربط التطبيق</button><button class="button primary" data-action="new-server">${icon('plus')}إضافة خادم</button>`)+`
    <div class="info-banner compact connection-unconfigured">${icon('info')}<p>المستودع المعتمد: Amer-ai-store/Mohammad-Ahmed-Ghannam. تابع نسخته المنشورة في شاشة مستودع GitHub. إذا كانت نسخة التطبيق لديك تتضمن إعدادات مركز القيادة، فاستورد إعدادات الربط الخاصة ثم أرسل المزامنة. تظهر بيانات التطبيق بعد استلامها فعليًا.</p></div>
    <div class="integration-summary"><section class="panel"><div class="panel-header"><h2>API لوحة القيادة</h2>${badge(store.getConnection().status)}</div><div class="panel-body"><p>المهام والمساحات والموافقات والملاحظات والإعدادات محفوظة فعليًا في قاعدة بيانات الخادم.</p><p class="mono" dir="ltr">GET /api/v1/state · POST /api/v1/actions</p><p class="muted">تعديل بيانات اللوحة يزامن جميع الجلسات. فحص خادم المتجر يتحقق من مسار الصحة فقط.</p></div></section><section class="panel"><div class="panel-header"><h2>تكامل المتجر</h2><span class="status-badge unverified">غير مرتبط</span></div><div class="panel-body"><p>المنتجات والطلبات والعملاء وتشغيل الوكلاء تحتاج API التطبيق الفعلي.</p><p class="muted">إعداد عنوان الخادم وفحصه متاحان الآن. لا يدل نجاح فحص الصحة على ربط عمليات المتجر تلقائيًا.</p></div></section></div>
    <div class="section-heading"><div><h2>خوادم المشروع</h2><p>${servers.length} خوادم · ${servers.filter(server=>server.status==='online').length} اجتازت آخر فحص</p></div></div>
    <div class="server-list">${servers.length?servers.map(serverCard).join(''):empty('لم تُضف خوادم بعد','أضف عنوان HTTPS لخادم التطبيق، وحدد مسار API ومسار فحص الصحة.',`<button class="button primary" data-action="new-server">${icon('plus')}إضافة أول خادم</button>`)}</div>
    <div class="info-banner">${icon('shield')}<p>البيانات السرية تُحفظ على الخادم. حقل المصادقة يقبل اسم متغير بيئة فقط، مثل AAS_STORE_TOKEN.</p></div>`;
}
function serverCard(server) {
  return `<article class="server-card"><div class="server-card-head"><span class="integration-icon">${icon('globe')}</span><div><h3>${esc(server.name)}</h3><p class="mono" dir="ltr">${esc(server.baseUrl)}</p></div>${badge(server.status)}</div><dl class="server-meta"><div><dt>مسار API</dt><dd class="mono" dir="ltr">${esc(server.apiPrefix)}</dd></div><div><dt>فحص الصحة</dt><dd class="mono" dir="ltr">${esc(server.healthPath)}</dd></div><div><dt>آخر فحص</dt><dd>${server.lastCheckedAt?date(server.lastCheckedAt,true):'لم يُفحص بعد'}</dd></div><div><dt>استجابة الخادم</dt><dd>${server.lastHttpStatus?'HTTP '+num(server.lastHttpStatus):'—'}${server.latencyMs!==null&&server.latencyMs!==undefined?' · '+num(server.latencyMs)+' ms':''}</dd></div><div><dt>متغير المصادقة</dt><dd class="mono" dir="ltr">${esc(server.tokenEnv||'—')}</dd></div><div><dt>الحالة الإدارية</dt><dd>${server.enabled?'مفعّل':'متوقف'}</dd></div></dl>${server.lastError?`<p class="server-error">${esc(server.lastError)}</p>`:''}<div class="server-actions"><button class="button primary small" data-action="check-server" data-id="${esc(server.id)}" ${server.enabled?'':'disabled'}>${icon('activity')}فحص الاتصال</button><button class="button secondary small" data-action="edit-server" data-id="${esc(server.id)}">تعديل API</button><button class="button danger small" data-action="delete-server" data-id="${esc(server.id)}">حذف الخادم</button></div></article>`;
}
function confirmDelete(action,id){
  const kind=action.replace('delete-','');
  openModal('تأكيد حذف السجل','<p class="detail-description">سيتم حذف هذا السجل من بيانات المؤسسة المشتركة. يحتفظ الخادم بسجل هذا الإجراء، ويرفض حذف سجلات ما زالت مرتبطة بعمل قائم.</p>',`<button class="button danger" data-action="confirm-delete" data-kind="${esc(kind)}" data-id="${esc(id)}">حذف السجل</button><button class="button secondary" data-action="close-modal">إلغاء</button>`);
}
function agentForm(id){
  const a=agent(id);if(!a)return;
  openModal('تعديل ملف الوكيل',`<form id="agent-form" data-id="${esc(id)}"><div class="field"><label>اسم الوكيل<input name="name" value="${esc(a.name)}" required maxlength="160"></label></div><div class="field"><label>التخصص<input name="role" value="${esc(a.role)}" required maxlength="160"></label></div><div class="field"><label>الوصف<textarea name="description" maxlength="3000">${esc(a.description)}</textarea></label></div><div class="field"><label>الحالة التنظيمية<select name="status"><option value="ready" ${a.status==='ready'?'selected':''}>جاهز للإعداد</option><option value="paused" ${a.status==='paused'?'selected':''}>متوقف</option></select></label></div><p class="muted">هذا الإعداد يحدّث ملف الوكيل. تشغيل النموذج يحتاج ربط خدمة تنفيذ فعلية.</p><div class="form-actions"><button class="button primary" type="submit">حفظ ملف الوكيل</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}
function serverForm(id){
  const s=state.servers.find(v=>v.id===id);
  openModal(s?'تعديل الخادم':'إضافة خادم',`<form id="server-form" ${s?`data-id="${esc(id)}"`:''}><div class="field"><label>اسم الخادم<input name="name" value="${esc(s?.name||'')}" required maxlength="160"></label></div><div class="field"><label>عنوان الخادم HTTPS<input dir="ltr" name="baseUrl" type="url" value="${esc(s?.baseUrl||'')}" placeholder="https://api.your-store.com/" required></label></div><div class="form-grid"><div class="field"><label>مسار فحص الصحة<input dir="ltr" name="healthPath" value="${esc(s?.healthPath||'/health')}" required></label></div><div class="field"><label>بادئة API<input dir="ltr" name="apiPrefix" value="${esc(s?.apiPrefix||'/api/v1')}" required></label></div></div><div class="field"><label>اسم متغير المصادقة على الخادم<input dir="ltr" name="tokenEnv" value="${esc(s?.tokenEnv||'')}" pattern="AAS_[A-Z0-9_]+" placeholder="AAS_STORE_TOKEN"></label><small class="muted">اسم المتغير فقط؛ تُحفظ قيمته السرية في إعدادات الاستضافة.</small></div><label class="checkbox-field"><input type="checkbox" name="enabled" ${s?.enabled===false?'':'checked'}><span>تفعيل الاتصال</span></label><div class="info-banner">${icon('info')}<p>فحص الخادم يرسل طلب HTTP حقيقيًا. يجب السماح بمصدره في AAS_ALLOWED_SERVER_ORIGINS على الخادم.</p></div><div class="form-actions"><button class="button primary" type="submit">حفظ الخادم</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}
function notificationPanel() {
  const pending=state.approvals.filter(a=>a.status==='pending');
  return `<div class="notification-popover"><div class="panel-header"><h2>الإشعارات</h2><span class="title-count">${pending.length}</span></div><div class="panel-body">${state.settings.notifications ? (pending.length ? pending.slice(0,3).map(a=>`<button class="notification-item" data-route="approvals">${icon('shield')}<span><strong>${esc(a.title)}</strong><small>بانتظار مراجعتك</small></span>${icon('chevron')}</button>`).join(''):'<p class="muted">أنت مطّلع على كل القرارات.</p>'):'<p class="muted">الإشعارات معطّلة من الإعدادات.</p>'}</div></div>`;
}
function openModal(title, body, footer='', cls='') {
  lastFocus=document.activeElement; modal.className='modal '+cls;
  modal.innerHTML=`<div class="modal-header"><div><span class="eyebrow">AMER AI STORE</span><h2 id="modal-title">${title}</h2></div><button class="icon-button" data-action="close-modal" aria-label="إغلاق">${icon('close')}</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}`;
  modal.showModal();
  for(const form of modal.querySelectorAll('form'))form.dataset.baseRevision=String(store.getRevision());
  updateConnectionUi();
}
function closeModal() { controlCenter.clearSensitiveInputs(); modal.querySelectorAll('form').forEach(form=>dirtyForms.delete(form.id)); modal.close(); lastFocus?.focus(); }
function workflowForm() {
  const repo=github.repository;
  openModal('مسار تنفيذ جديد',`<form id="workflow-form"><div class="field"><label for="workflow-title">اسم المسار</label><input id="workflow-title" name="title" required maxlength="160" autofocus placeholder="مثل: تحسين مسار إنشاء الطلب"></div><div class="field"><label for="workflow-description">الهدف والنتيجة المطلوبة</label><textarea id="workflow-description" name="description" maxlength="3000"></textarea></div><div class="form-grid"><div class="field"><label for="workflow-repository">مستودع المشروع</label><input id="workflow-repository" name="repository" dir="ltr" value="${esc(repo?.fullName||'Amer-ai-store/Mohammad-Ahmed-Ghannam')}" required maxlength="201" placeholder="owner/repository"></div><div class="field"><label for="workflow-mode">نوع المسار</label><select id="workflow-mode" name="mode"><option value="change">تحليل، تعديل أو إضافة، ثم تحقق</option><option value="analysis-only">تحليل وتحقق فقط</option></select></div></div><div class="field"><label for="workflow-source">مراجعة المصدر المستهدفة</label><input id="workflow-source" name="sourceRevision" class="mono" dir="ltr" value="${esc(repo?.head?.sha||'')}" required pattern="[a-fA-F0-9]{40}|[a-fA-F0-9]{64}" maxlength="64" placeholder="SHA كامل من 40 أو 64 حرفًا"><small class="muted">تُربط الأدلة بهذه النسخة المحددة؛ لا يُفترض أنها أحدث نسخة من التطبيق المثبّت.</small></div><div class="field"><label for="workflow-steps">الخطوات بالترتيب</label><textarea id="workflow-steps" name="steps" required maxlength="5000" rows="5" placeholder="عنوان الخطوة الأولى&#10;عنوان الخطوة الثانية&#10;عنوان الخطوة الثالثة"></textarea><small class="muted">كل سطر خطوة مستقلة، بحد أقصى 30 خطوة. تبدأ الخطوة التالية بعد اعتماد أدلة السابقة.</small></div><div class="info-banner">${icon('shield')}<p>إنشاء المسار يحفظ الخطة على الخادم. لا يبدأ تعديل الكود أو تشغيل اختبارات تلقائيًا.</p></div><div class="form-actions"><button class="button primary" type="submit">${icon('plus')}إنشاء المسار</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}
function workflowStepForm(id) {
  const workflow=executionWorkflow(id);if(!workflow)return;
  openModal('إضافة خطوة مرتّبة',`<form id="workflow-step-form" data-id="${esc(id)}"><p class="muted">تُضاف الخطوة إلى نهاية مسار «${esc(workflow.title)}».</p><div class="field"><label for="workflow-step-title">عنوان الخطوة</label><input id="workflow-step-title" name="title" required maxlength="160" autofocus></div><div class="field"><label for="workflow-step-description">وصف الخطوة</label><textarea id="workflow-step-description" name="description" maxlength="3000"></textarea></div><div class="form-actions"><button class="button primary" type="submit">إضافة الخطوة</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}
function workflowEvidenceForm(workflowId,stepId,kind) {
  const workflow=executionWorkflow(workflowId),step=executionStep(workflow,stepId);if(!workflow||!step)return;
  const names={analysis:'توثيق التحليل اليدوي',change:'توثيق التعديل أو الإضافة',verification:'توثيق نتيجة التحقق'};
  const defaults={analysis:{kind:'report',label:'تقرير التحليل'},change:{kind:'diff',label:'دليل التغيير'},verification:{kind:'log',label:'سجل التحقق'}}[kind];
  const options=kind==='change'?[['diff','فرق التغيير · diff'],['file','ملف مع بصمة SHA-256']]:[['report','تقرير'],['log','سجل'],['file','ملف'],['url','مرجع ويب']];
  const reopening=workflow.steps.findIndex(item=>item.id===step.id)<workflow.currentStepIndex||step.phase==='complete';
  const evidenceSource=kind==='analysis'?workflow.sourceRevision:step.sourceRevision;
  openModal(names[kind],`<form id="workflow-evidence-form" data-id="${esc(workflowId+':'+stepId+':'+kind)}" data-workflow="${esc(workflowId)}" data-step="${esc(stepId)}" data-kind="${kind}"><div class="info-banner">${icon('info')}<p>هذا توثيق يدوي لما أُنجز خارج اللوحة. ${reopening?'إعادة التحليل تُعيد فتح هذه الخطوة وتبطل أدلة الخطوات اللاحقة مع الاحتفاظ بسجلها.':kind==='change'?'قبول تغيير جديد يبطل نتيجة التحقق السابقة وأدلة الخطوات اللاحقة.':'يحفظ الخادم مصدر الدليل ووقته ونسخة الكود المرتبطة به.'}</p></div><p class="muted">الخطوة: ${esc(step.title)} · نسخة الخطوة ${step.revision}</p><input type="hidden" name="stepRevision" value="${step.revision}"><div class="field"><label for="workflow-evidence-source">مراجعة المصدر المرتبطة بالدليل</label><input id="workflow-evidence-source" name="sourceRevision" class="mono" dir="ltr" value="${esc(evidenceSource)}" ${kind==='change'?'':'readonly'} required pattern="[a-fA-F0-9]{40}|[a-fA-F0-9]{64}" maxlength="64">${kind==='change'?'<small class="muted">للتغيير المقبول، أدخل مراجعة جديدة تختلف عن السابقة وتطابق التعديل الفعلي.</small>':''}</div>${kind==='change'?'<div class="field"><label for="workflow-change-type">نوع التغيير</label><select id="workflow-change-type" name="changeType"><option value="modification">تعديل ملفات قائمة</option><option value="addition">إضافة ملفات أو وظيفة</option><option value="both">تعديل وإضافة</option></select></div>':''}<div class="field"><label for="workflow-evidence-outcome">نتيجة المرحلة بحسب الدليل</label><select id="workflow-evidence-outcome" name="outcome"><option value="passed">الدليل يدعم الاجتياز</option><option value="failed">نتيجة فاشلة تحتاج تصحيحًا</option><option value="blocked">تعذّر إتمام المرحلة</option></select></div><div class="field"><label for="workflow-evidence-summary">ملخص النتيجة ونطاقها</label><textarea id="workflow-evidence-summary" name="summary" required maxlength="4000" rows="3" placeholder="ما الذي فُحص أو تغير؟ وما النتيجة الفعلية؟"></textarea></div><div class="form-grid"><div class="field"><label for="workflow-evidence-kind">نوع الدليل</label><select id="workflow-evidence-kind" name="evidenceKind">${options.map(([value,label])=>`<option value="${value}" ${value===defaults.kind?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="workflow-evidence-label">عنوان الدليل</label><input id="workflow-evidence-label" name="evidenceLabel" required maxlength="160" value="${defaults.label}"></div></div><div class="field"><label for="workflow-evidence-content">محتوى الدليل</label><textarea id="workflow-evidence-content" name="evidenceContent" maxlength="8000" rows="5" dir="auto" placeholder="${kind==='change'?'ألصق diff الفعلي أو وصف الملف وبصمته.':'ألصق التقرير أو سجل المخرجات الفعلي.'}"></textarea></div><div class="field"><label for="workflow-evidence-url">رابط الدليل · اختياري عند إرفاق المحتوى</label><input id="workflow-evidence-url" name="evidenceUrl" type="url" dir="ltr" maxlength="2000" placeholder="https://..."></div><div class="field"><label for="workflow-evidence-hash">بصمة ملف الدليل · SHA-256</label><input id="workflow-evidence-hash" name="evidenceSha256" dir="ltr" maxlength="64" pattern="[a-fA-F0-9]{64}"><small class="muted">${kind==='change'?'مطلوبة لقبول دليل من نوع «ملف». أما diff فيحتاج محتوى فرق فعليًا أو رابطًا إليه.':'اختيارية، إذا كانت متوفرة للملف المرفق.'}</small></div>${kind==='verification'?`<h3 class="dialog-section-title">الفحوص المنفّذة</h3><p class="muted">سجّل أمر الفحص ونتيجته من الدليل أعلاه. رمز الخروج 0 يعني نجاح الأمر؛ اتركه فارغًا إذا لم يُنفّذ بسبب عائق.</p><div id="execution-checks">${workflowCheckRow()}</div><button class="button secondary small" type="button" data-action="workflow-add-check">${icon('plus')}إضافة فحص</button>`:''}<div class="form-actions"><button class="button primary" type="submit">حفظ الدليل وتحديث المرحلة</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}
function workflowCheckRow() { return `<div class="execution-check-row"><div class="field"><label>اسم الفحص<input name="checkName" required maxlength="160" placeholder="مثل: اختبارات المشروع"></label></div><div class="field"><label>الأمر أو إجراء الفحص<input name="checkCommand" required maxlength="500" dir="auto" placeholder="npm test"></label></div><div class="field"><label>رمز الخروج<input name="checkExitCode" type="number" step="1" min="-2147483648" max="2147483647" placeholder="0"></label></div><button class="icon-button" type="button" data-action="workflow-remove-check" aria-label="حذف الفحص">${icon('close')}</button></div>`; }
function workflowEvidence(data) {
  const content=String(data.get('evidenceContent')||'').trim(),url=String(data.get('evidenceUrl')||'').trim(),sha256=String(data.get('evidenceSha256')||'').trim();
  if(!content&&!url)throw new Error('أرفق محتوى فعليًا للدليل أو رابط HTTPS إليه.');
  return [{kind:data.get('evidenceKind'),label:data.get('evidenceLabel'),...(content?{content}:{}),...(url?{url}:{}),...(sha256?{sha256:sha256.toLowerCase()}:{})}];
}
async function analyzeWorkflowSource(id) {
  const workflow=executionWorkflow(id),step=workflow?.steps[workflow.currentStepIndex];if(!step)return;
  if(executionPendingAnalysis.has(id))return;executionPendingAnalysis.add(id);updateExecutionControls();
  try {await store.analyzeWorkflow(id);const updated=store.getState().workflows.find(item=>item.id===id)?.steps.find(item=>item.id===step.id);const analysis=updated?.analysis;toast(analysis?.outcome==='passed'?'اكتمل تحليل ملفات المصدر؛ نطاق الفحص ودليله محفوظان في الخطوة.':analysis?.summary||'تعذّر إتمام تحليل المصدر. بقيت الخطوة متوقفة حتى معالجة السبب.',analysis?.outcome!=='passed');}
  catch(error){toast(error.message||'تعذّر تحليل المصدر.',true);}
  finally {executionPendingAnalysis.delete(id);updateExecutionControls();}
}
function taskForm(prefWorkspace='',prefAgent='') {
  const w=workspace(prefWorkspace);
  openModal('مهمة جديدة',`<form id="task-form"><div class="field"><label for="task-title">عنوان المهمة</label><input id="task-title" name="title" placeholder="ما الذي تريد إنجازه؟" required maxlength="140" autofocus></div><div class="field"><label for="task-description">تفاصيل المهمة</label><textarea id="task-description" name="description" placeholder="أضف السياق والنتيجة المطلوبة..." maxlength="3000"></textarea></div><div class="form-grid"><div class="field"><label for="task-workspace">مساحة العمل</label><select id="task-workspace" name="workspaceId" required>${state.workspaces.map(a=>`<option value="${esc(a.id)}" ${a.id===prefWorkspace?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div class="field"><label for="task-agent">الوكيل المسؤول</label><select id="task-agent" name="agentId" required>${state.agents.map(a=>`<option value="${esc(a.id)}" ${a.id===prefAgent?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div class="field"><label for="task-priority">الأولوية</label><select id="task-priority" name="priority"><option value="medium">متوسطة</option><option value="high">عالية</option><option value="low">منخفضة</option></select></div><div class="field"><label for="task-status">الحالة الأولية</label><select id="task-status" name="status"><option value="queued">في الانتظار</option><option value="running">قيد العمل يدويًا</option><option value="review">للمراجعة</option></select></div></div>${taskCoordinationFields()}<div class="info-banner">${icon('info')}<p>تُحفظ المهمة على الخادم وتُزامن مع الفريق. اختيار «للمراجعة» ينشئ طلب موافقة. حالة «قيد العمل» يحددها الفريق ولا تُشغّل وكيلًا تلقائيًا.</p></div><div class="form-actions"><button class="button primary" type="submit">${icon('plus')}إنشاء المهمة</button><button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
  syncTaskAgents(prefAgent);
}
function taskCoordinationFields(task={},locked=false){
  return `<details><summary>اعتماد المهمة والموارد المشتركة</summary><div class="field"><label>المهام التي يجب إكمالها أولًا</label><div class="agent-checklist">${state.tasks.filter(item=>item.id!==task.id).map(item=>`<label class="agent-checkbox"><input type="checkbox" name="dependencies" value="${esc(item.id)}" ${(task.dependencies||[]).includes(item.id)?'checked':''} ${locked?'disabled':''}><span>${esc(item.title)}</span></label>`).join('')||'<p class="muted">لا توجد مهام أخرى للاعتماد عليها.</p>'}</div></div><div class="field"><label for="task-resource-keys">الموارد المشتركة، مورد في كل سطر</label><textarea id="task-resource-keys" name="resourceKeys" rows="3" maxlength="4000" dir="ltr" ${locked?'readonly':''} placeholder="repo:owner/repository/app/Main.kt">${esc((task.resourceKeys||[]).join('\n'))}</textarea><small class="muted">تمنع الموارد المتداخلة تكليف مهام متعارضة بحالة قيد العمل. لا يبدأ التنفيذ تلقائيًا.</small></div></details>`;
}
function taskCoordinationPayload(data){return {dependencies:data.getAll('dependencies'),resourceKeys:String(data.get('resourceKeys')||'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean)};}
function syncTaskAgents(preferred) {
  const ws = workspace(modal.querySelector('#task-workspace')?.value);
  const select=modal.querySelector('#task-agent'); if(!select||!ws)return;
  const old=preferred||select.value;const available=state.agents.filter(a=>ws.agentIds.includes(a.id));
  select.innerHTML=available.length?available.map(a=>`<option value="${esc(a.id)}" ${a.id===old?'selected':''}>${esc(a.name)}</option>`).join(''):'<option value="">أضف وكيلًا إلى المساحة أولًا</option>';
}
function workspaceForm(id) {
  const w=workspace(id);
  openModal(w?'تعديل مساحة العمل':'مساحة عمل جديدة',`<form id="workspace-form" ${w?`data-id="${esc(w.id)}"`:''}><div class="field"><label for="workspace-name">اسم المساحة</label><input id="workspace-name" name="name" value="${esc(w?.name||'')}" placeholder="مثل: تطوير متجر Amer" required maxlength="80" autofocus></div><div class="field"><label for="workspace-description">هدف المساحة</label><textarea id="workspace-description" name="description" placeholder="ما الذي سيعمل عليه الفريق؟" maxlength="1000">${esc(w?.description||'')}</textarea></div><div class="field"><label>اختر فريق الوكلاء</label><div class="agent-checklist">${state.agents.map(a=>`<label class="agent-checkbox"><input type="checkbox" name="agentIds" value="${esc(a.id)}" ${w?.agentIds.includes(a.id)?'checked':''}>${avatar(a,true)}<span>${esc(a.name)}</span></label>`).join('')}</div><small class="muted">اختر وكيلًا واحدًا على الأقل. احتفظ بالوكلاء الذين لديهم مهام مرتبطة بالمساحة.</small></div><div class="form-actions"><button class="button primary" type="submit">${icon('check')}${w?'حفظ المساحة':'إنشاء المساحة'}</button>${w?`<button class="button danger" type="button" data-action="delete-workspace" data-id="${esc(w.id)}">حذف المساحة</button>`:''}<button class="button secondary" type="button" data-action="close-modal">إلغاء</button></div></form>`);
}
function taskDetail(id) {
  const t=state.tasks.find(t=>t.id===id);if(!t)return;
  const pending=state.approvals.some(a=>a.taskId===id&&a.status==='pending');
  openModal('تفاصيل المهمة',`<span class="mono muted">${esc(t.id)}</span><div class="detail-facts"><div><span>الوكيل المسؤول</span><strong>${esc(agent(t.agentId)?.name)}</strong></div><div><span>مساحة العمل</span><strong>${esc(workspace(t.workspaceId)?.name)}</strong></div><div><span>تاريخ الإنشاء</span><strong>${date(t.createdAt,true)}</strong></div><div><span>الحالة الحالية</span>${badge(t.status)}</div></div><form id="task-status-form" data-id="${esc(id)}"><div class="field"><label for="detail-title">عنوان المهمة</label><input id="detail-title" name="title" value="${esc(t.title)}" required maxlength="140" ${pending?'readonly':''}></div><div class="field"><label for="detail-description">تفاصيل المهمة</label><textarea id="detail-description" name="description" maxlength="3000" ${pending?'readonly':''}>${esc(t.description)}</textarea></div><div class="form-grid"><div class="field"><label for="detail-status">حالة المهمة</label><select id="detail-status" name="status" ${pending?'disabled':''}>${['queued','running','review','done'].map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${statusLabels[s]}</option>`).join('')}</select></div><div class="field"><label for="detail-priority">الأولوية</label><select id="detail-priority" name="priority" ${pending?'disabled':''}>${['high','medium','low'].map(priority=>`<option value="${priority}" ${t.priority===priority?'selected':''}>${statusLabels[priority]}</option>`).join('')}</select></div></div>${taskCoordinationFields(t,pending)}${pending?`<div class="info-banner">${icon('shield')}<p>لهذه المهمة موافقة معلّقة. يحمي الخادم المهمة من التعديل حتى مراجعة القرار.</p></div>`:'<p class="muted">نقل المهمة إلى المراجعة ينشئ طلب موافقة. تحديث الحالات إجراء يدوي محفوظ على الخادم.</p>'}<div class="form-actions">${pending?'<button type="button" class="button primary" data-action="go-approvals">صندوق الموافقات</button>':`<button class="button primary" type="submit">حفظ المهمة</button><button class="button danger" type="button" data-action="delete-task" data-id="${esc(id)}">حذف المهمة</button>`}<button class="button secondary" type="button" data-action="close-modal">إغلاق</button></div></form>`);
}
function agentDetail(id) {
  const a=agent(id);if(!a)return;
  const tasks=state.tasks.filter(t=>t.agentId===id),ws=state.workspaces.filter(w=>w.agentIds.includes(id));
  openModal(esc(a.name),`<div class="agent-detail-intro">${avatar(a)}<div><h3>${esc(a.role)}</h3><p>${esc(a.description)}</p></div></div><div class="detail-facts"><div><span>النموذج</span><strong>غير متصل</strong></div><div><span>المهام المسندة</span><strong>${tasks.length}</strong></div><div><span>مساحات العمل</span><strong>${ws.length}</strong></div><div><span>المكتملة</span><strong>${tasks.filter(t=>t.status==='done').length}</strong></div></div><h3 class="dialog-section-title">مساحات الوكيل</h3><div class="agent-workspace-links">${ws.map(w=>`<button class="button secondary" data-action="open-agent-workspace" data-id="${esc(w.id)}">${icon('folder')}${esc(w.name)}</button>`).join('')||'<p class="muted">لم يُسند إلى مساحة بعد.</p>'}</div><div class="info-banner">${icon('info')}<p>هذا ملف تنظيمي للوكيل. يتطلب التشغيل ربط مزوّد نماذج وخدمة تنفيذ على الخادم.</p></div>`,`<button class="button primary" data-action="agent-new-task" data-id="${esc(id)}" ${!ws.length?'disabled':''}>${icon('plus')}إسناد مهمة</button><button class="button secondary" data-action="edit-agent" data-id="${esc(id)}">تعديل الوكيل</button><button class="button secondary" data-action="close-modal">إغلاق</button>`);
}
function approvalDetail(id) {
  const a=state.approvals.find(a=>a.id===id);if(!a)return;
  const t=state.tasks.find(t=>t.id===a.taskId);
  openModal('مراجعة القرار',`<div class="approval-detail-head">${badge(a.status)}<h3>${esc(a.title)}</h3></div><p class="detail-description">${esc(a.description)}</p><div class="detail-facts"><div><span>المهمة المرتبطة</span><strong>${esc(t?.title||'غير محددة')}</strong></div><div><span>نطاق التأثير</span><strong>${esc(a.impact)}</strong></div></div><div class="info-banner">${icon('shield')}<p>اعتماد القرار يعيد المهمة إلى قائمة الانتظار. لا توجد خدمات خارجية متصلة بهذه البيئة.</p></div>`,a.status==='pending'?`<button class="button primary" data-action="approve" data-id="${esc(id)}">${icon('check')}اعتماد القرار</button><button class="button danger" data-action="reject" data-id="${esc(id)}">رفض القرار</button>`:'<button class="button secondary" data-action="close-modal">إغلاق</button>');
}
function searchModal() {
  openModal('البحث السريع',`<label class="search-field command-search">${icon('search')}<input id="global-search" type="search" placeholder="ابحث عن مهمة، وكيل، أو مساحة عمل..." autocomplete="off" autofocus aria-label="البحث في المنظومة"></label><div class="command-results" id="command-results">${searchResults('')}</div>`,'','command-modal');
}
function searchResults(query) {
  const q=query.trim().toLowerCase();
  const results=[
    ...routes.filter(r=>!q||labels[r].includes(q)).map(r=>({type:'route',id:r,title:labels[r],sub:'انتقل إلى الصفحة',icon:'grid'})),
    ...state.workspaces.filter(w=>q&&[w.name,w.description].join(' ').toLowerCase().includes(q)).map(w=>({type:'workspace',id:w.id,title:w.name,sub:'مساحة عمل · AAS-AW',icon:'layers'})),
    ...state.tasks.filter(t=>q&&[t.title,t.description].join(' ').toLowerCase().includes(q)).map(t=>({type:'task',id:t.id,title:t.title,sub:'مهمة · '+statusLabels[t.status],icon:'tasks'})),
    ...state.agents.filter(a=>q&&[a.name,a.role].join(' ').toLowerCase().includes(q)).map(a=>({type:'agent',id:a.id,title:a.name,sub:a.role,icon:'bot'}))
  ].slice(0,15);
  return results.length?results.map(r=>`<button class="command-result" data-action="search-result" data-type="${r.type}" data-id="${esc(r.id)}">${icon(r.icon)}<span><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></span>${icon('chevron')}</button>`).join(''):empty('لا توجد نتائج','جرّب اسمًا أو كلمة مختلفة.');
}
function exportData() {
  const blob=new Blob([store.exportData()],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='amer-ai-workspace-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('تم تصدير نسخة من بيانات مساحة العمل');
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action],[data-route]');if(!el)return;
  const id=el.dataset.id,action=el.dataset.action;
  if(action==='retry-bootstrap'){await bootstrap();return;}
  if(!store)return;
  if(action==='retry-connection'){await run(()=>store.refresh({force:true}));return;}
  if(action==='refresh-repository'){await loadRepository({manual:true});return;}
  if(action==='retry-repository'){await loadRepository();return;}
  if(mutatingActions.has(action)&&(store.getConnection().busy||store.getConnection().status!=='online'))return;
  if(await controlCenter.handleAction(action,el))return;
  if(el.dataset.route){navigate(el.dataset.route,id);return;}
  switch(action){
    case 'new-workflow':workflowForm();break;
    case 'workflow-add-step':workflowStepForm(id);break;
    case 'workflow-analysis':workflowEvidenceForm(id,el.dataset.step,'analysis');break;
    case 'workflow-change':workflowEvidenceForm(id,el.dataset.step,'change');break;
    case 'workflow-verification':workflowEvidenceForm(id,el.dataset.step,'verification');break;
    case 'workflow-analyze':await analyzeWorkflowSource(id);break;
    case 'workflow-advance':await run(()=>store.advanceWorkflow({workflowId:id,stepId:el.dataset.step}),'اعتمد الخادم الانتقال بعد التحقق من أدلة الخطوة.');break;
    case 'workflow-add-check':{const container=modal.querySelector('#execution-checks');if(container&&container.children.length<30)container.insertAdjacentHTML('beforeend',workflowCheckRow());else toast('الحد الأقصى 30 فحصًا.',true);break;}
    case 'workflow-remove-check':el.closest('.execution-check-row')?.remove();break;
    case 'execution-capabilities':await loadExecutionCapabilities();break;
    case 'runner-connection':await run(()=>downloadRunnerConnection(),'تم تنزيل ملف إعدادات المنفّذ الخاص. لم يبدأ تشغيل الخادم بمجرد التنزيل.');break;
    case 'new-task': taskForm(el.dataset.workspace);break;
    case 'new-workspace':workspaceForm();break;
    case 'edit-workspace':workspaceForm(id);break;
    case 'edit-agent':agentForm(id);break;
    case 'new-server':serverForm();break;
    case 'app-connection':run(()=>downloadAppConnection(),'تم تنزيل إعدادات اتصال تطبيق المالك. استوردها داخل التطبيق؛ تحتوي بيانات اتصال خاصة.');break;
    case 'edit-server':serverForm(id);break;
    case 'check-server':run(()=>store.checkServer(id),'تم تسجيل نتيجة فحص الاتصال');break;
    case 'delete-task':case 'delete-workspace':case 'delete-server':confirmDelete(action,id);break;
    case 'confirm-delete':run(async()=>{const fn={task:'deleteTask',workspace:'deleteWorkspace',server:'deleteServer'}[el.dataset.kind];await store[fn](id);closeModal();},'تم حذف السجل');break;
    case 'task-detail':taskDetail(id);break;
    case 'agent-detail':agentDetail(id);break;
    case 'approval-detail':approvalDetail(id);break;
    case 'close-modal':closeModal();break;
    case 'go-approvals':closeModal();navigate('approvals');break;
    case 'agent-new-task':{const ws=state.workspaces.find(w=>w.agentIds.includes(id));closeModal();taskForm(ws?.id,id);break;}
    case 'open-agent-workspace':closeModal();navigate('workspaces',id);break;
    case 'approve':case 'reject':run(async()=>{await store.resolveApproval(id,action==='approve'?'approved':'rejected');if(modal.open)closeModal();},action==='approve'?'تم اعتماد القرار وإعادة المهمة إلى الانتظار':'تم تسجيل رفض القرار');break;
    case 'task-filter':taskFilter=id;render();break;
    case 'task-view':taskView=id;render();break;
    case 'approval-filter':approvalFilter=id;render();break;
    case 'toggle-workspace':{const w=workspace(id);run(()=>store.updateWorkspace(id,{status:w.status==='active'?'paused':'active'}),'تم تحديث حالة المساحة');break;}
    case 'notifications':notificationOpen=!notificationOpen;render();break;
    case 'search':searchModal();break;
    case 'search-result':{closeModal();if(el.dataset.type==='route')navigate(id);if(el.dataset.type==='workspace')navigate('workspaces',id);if(el.dataset.type==='task')taskDetail(id);if(el.dataset.type==='agent')agentDetail(id);break;}
    case 'menu':mobileOpen=!mobileOpen;render();break;
    case 'close-menu':mobileOpen=false;render();break;
    case 'export':exportData();break;
    case 'import':document.querySelector('#import-file').click();break;
    case 'reset':openModal('مسح بيانات العمل','<p class="detail-description">سيتم حذف مهام وملاحظات مساحة العمل المشتركة. يحتفظ الخادم بسجل النشاط وتعريفات الخوادم. صدّر نسخة للاحتفاظ بالعمل قبل المتابعة.</p>','<button class="button danger" data-action="confirm-reset">مسح بيانات العمل</button><button class="button secondary" data-action="close-modal">إلغاء</button>');break;
    case 'confirm-reset':run(async()=>{await store.reset();closeModal();},'تم مسح بيانات العمل');break;
    case 'confirm-import':run(async()=>{await store.importData(importBuffer);importBuffer=null;closeModal();},'تم استيراد مساحة العمل');break;
  }
});
let importBuffer=null;
document.addEventListener('input',e=>{
  controlCenter.handleInput(e.target);
  if(e.target.id==='task-search'){taskQuery=e.target.value;document.querySelector('#task-results').innerHTML=taskResults();}
  if(e.target.id==='global-search')document.querySelector('#command-results').innerHTML=searchResults(e.target.value);
});
document.addEventListener('change',async e=>{
  controlCenter.handleChange(e.target);
  if(['theme-preference','settings-theme-preference'].includes(e.target.id)){theme.set(e.target.value);updateThemeControls();return;}
  if(e.target.id==='chart-period'){chartPeriod=e.target.value;render();}
  if(e.target.id==='task-workspace')syncTaskAgents();
  if(e.target.id==='import-file'){
    const file=e.target.files[0];if(!file)return;
    if(file.size>2*1024*1024){toast('الملف أكبر من الحد المسموح (2 ميجابايت)',true);e.target.value='';return;}
    try{
      const raw=await file.text();const parsed=JSON.parse(raw);
      // Validate in an isolated in-memory store before the user confirms replacement.
      await store.validateImport(parsed);importBuffer=raw;
      openModal('استيراد مساحة العمل',`<p class="detail-description">تم التحقق من الملف <strong>${esc(file.name)}</strong>. سيستبدل الاستيراد البيانات الحالية بـ ${parsed.tasks.length} مهام و${parsed.workspaces.length} مساحات. احتفظ بنسخة من بياناتك الحالية قبل المتابعة.</p>`,'<button class="button primary" data-action="confirm-import">استيراد واستبدال البيانات</button><button class="button secondary" data-action="close-modal">إلغاء</button>');
    }catch(err){toast(err.message||'ملف غير صالح',true);}e.target.value='';
  }
});
document.addEventListener('submit',async e=>{
  const form=e.target;if(form.id?.startsWith('cc-')){e.preventDefault();await controlCenter.handleSubmit(form);return;}if(!['task-form','workspace-form','task-status-form','note-form','settings-form','agent-form','server-form','workflow-form','workflow-step-form','workflow-evidence-form'].includes(form.id))return;e.preventDefault();
  const data=new FormData(form);
  if(form.dataset.baseRevision!==undefined&&Number(form.dataset.baseRevision)!==store.getRevision()){toast('تغيّرت بيانات المؤسسة أثناء التحرير. أغلق النموذج وافتحه مجددًا لمراجعة النسخة الحالية.',true);return;}
  await run(async()=>{
    if(form.id==='workflow-form'){
      const steps=String(data.get('steps')||'').split(/\r?\n/).map(title=>title.trim()).filter(Boolean).map(title=>({title}));
      if(!steps.length||steps.length>30)throw new Error('أدخل من خطوة واحدة إلى 30 خطوة، كل خطوة في سطر.');
      const response=await store.startWorkflow({title:data.get('title'),description:data.get('description'),repository:String(data.get('repository')||'').trim(),sourceRevision:String(data.get('sourceRevision')).trim().toLowerCase(),mode:data.get('mode'),steps});
      closeModal();navigate('execution',response.result?.id);toast('حُفظ مسار التنفيذ. يبدأ العمل بمرحلة التحليل.');
    }
    if(form.id==='workflow-step-form'){await store.addWorkflowStep({workflowId:form.dataset.id,title:data.get('title'),description:data.get('description')});closeModal();toast('أُضيفت الخطوة إلى ترتيب المسار.');}
    if(form.id==='workflow-evidence-form'){
      const kind=form.dataset.kind,evidence=workflowEvidence(data),outcome=data.get('outcome');
      const payload={workflowId:form.dataset.workflow,stepId:form.dataset.step,sourceRevision:String(data.get('sourceRevision')||'').trim().toLowerCase(),summary:data.get('summary'),evidence,outcome};
      if(kind==='change'){
        payload.changeType=data.get('changeType');
        if(outcome==='passed'&&evidence[0].kind==='file'&&!evidence[0].sha256)throw new Error('قبول دليل ملف يحتاج بصمة SHA-256 للملف.');
        await store.recordWorkflowChange(payload);
      }else if(kind==='analysis')await store.recordWorkflowAnalysis(payload);
      else{
        const names=data.getAll('checkName'),commands=data.getAll('checkCommand'),codes=data.getAll('checkExitCode');
        payload.stepRevision=Number(data.get('stepRevision'));
        payload.checks=names.map((name,index)=>({name,command:commands[index],exitCode:String(codes[index]||'').trim()===''?null:Number(codes[index]),evidenceIndex:0}));
        if(outcome==='passed'&&(!payload.checks.length||payload.checks.some(check=>check.exitCode!==0)))throw new Error('اجتياز التحقق يحتاج فحصًا واحدًا على الأقل، وجميع رموز الخروج تساوي 0 مع دليلها.');
        await store.recordWorkflowVerification(payload);
      }
      closeModal();toast(outcome==='passed'?'حُفظ الدليل وحدّث الخادم مرحلة الخطوة.':'حُفظ سبب الفشل أو العائق؛ يبقى الانتقال مغلقًا.');
    }
    if(form.id==='task-form'){await store.addTask({...Object.fromEntries(data),...taskCoordinationPayload(data)});closeModal();toast('أُضيفت المهمة إلى مساحة العمل');}
    if(form.id==='workspace-form'){const agentIds=data.getAll('agentIds');if(!agentIds.length)throw new Error('اختر وكيلًا واحدًا على الأقل');const payload={name:data.get('name'),description:data.get('description'),agentIds,color:'#39856c'};if(form.dataset.id)await store.updateWorkspace(form.dataset.id,payload);else await store.addWorkspace(payload);closeModal();toast('مساحة العمل الجديدة جاهزة');}
    if(form.id==='task-status-form'){await store.updateTask(form.dataset.id,{status:data.get('status'),title:data.get('title'),description:data.get('description'),priority:data.get('priority'),...taskCoordinationPayload(data)});closeModal();toast('تم تحديث حالة المهمة');}
    if(form.id==='note-form'){await store.addNote(form.dataset.workspace,data.get('body'));dirtyForms.delete(form.id);document.querySelector('#note-form')?.reset();if(document.querySelector('#note-form'))delete document.querySelector('#note-form').dataset.baseRevision;toast('أُضيفت الملاحظة إلى دفتر الفريق');}
    if(form.id==='agent-form'){await store.updateAgent(form.dataset.id,Object.fromEntries(data));closeModal();toast('تم تحديث ملف الوكيل');}
    if(form.id==='server-form'){const payload=Object.fromEntries(data);payload.enabled=data.has('enabled');payload.tokenEnv=payload.tokenEnv||null;if(form.dataset.id)await store.updateServer(form.dataset.id,payload);else await store.addServer(payload);closeModal();toast('تم حفظ إعدادات الخادم');}
    if(form.id==='settings-form'){await store.updateSettings({storeName:data.get('storeName'),ownerName:data.get('ownerName'),timezone:data.get('timezone'),notifications:data.has('notifications')});dirtyForms.delete(form.id);if(document.querySelector('#settings-form'))delete document.querySelector('#settings-form').dataset.baseRevision;toast('تم حفظ إعدادات المؤسسة');}
  });
});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!modal.open)searchModal();}});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
modal.addEventListener('close',()=>{if(modal.open)return;controlCenter.clearSensitiveInputs();importBuffer=null;lastFocus?.focus();});
window.addEventListener('hashchange',()=>{const parts=location.hash.slice(1).split('/');route=parts[0]||'overview';workspaceId=parts[1];mobileOpen=false;render();window.scrollTo({top:0});});
async function bootstrap(){bootstrapError=null;renderBootstrap();try{store?.dispose();store=await createApiStore();const migration=await migrateLegacyWorkspace(store);state=store.getState();store.subscribe(change=>{if(change.stateChanged)render();else updateConnectionUi();});render();if(migration.migrated)toast(`تم نقل ${migration.counts.workspaces} مساحات و${migration.counts.tasks} مهام و${migration.counts.notes} ملاحظات و${migration.counts.approvals} موافقات إلى الخادم.`);else if(migration.warning)toast(migration.warning,true);}catch(error){store=null;bootstrapError=error.message;renderBootstrap();}}
document.addEventListener('input',e=>{const form=e.target.closest('form');if(form&&!form.id.startsWith('cc-')){if(form.dataset.baseRevision===undefined)form.dataset.baseRevision=String(store.getRevision());dirtyForms.add(form.id);}});
const repositoryPoll=setInterval(()=>{if(route==='repository'&&!document.hidden&&store)loadRepository();},60000);
function repositoryVisible(){if(route==='repository'&&!document.hidden&&Date.now()-github.lastAttemptAt>=60000)loadRepository();}
document.addEventListener('visibilitychange',repositoryVisible);
window.addEventListener('pagehide',event=>{githubController?.abort();if(!event.persisted){clearInterval(repositoryPoll);controlCenter.dispose();document.removeEventListener('visibilitychange',repositoryVisible);}});
window.addEventListener('pageshow',event=>{if(event.persisted&&route==='repository')loadRepository();});
window.addEventListener('aas-host-connected',()=>bootstrap());
theme.subscribe(updateThemeControls);
bootstrap();
