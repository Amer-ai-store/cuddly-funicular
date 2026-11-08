/** Server-owned records for the owner-private AAS command center.
 * Task statuses describe tracked work. They never prove an AI run took place.
 * No execution adapter is configured, so model identities remain disconnected
 * and run histories must be empty. All mutations return detached snapshots.
 */
export const LIVE_SCHEMA_VERSION = 2;
export const COORDINATION_VERSION = 1;

const newOrganizationalAgents = () => [
  { id: 'agent-engineering', name: 'وكيل هندسة البرمجيات', role: 'التطوير والتكامل', initials: 'SE', color: '#5279dc', status: 'ready', model: 'غير متصل', description: 'تنظيم تطوير التطبيق والتكاملات ومراجعة تغييرات المصدر وفق بوابات التنفيذ.' },
  { id: 'agent-quality', name: 'وكيل الجودة والأمان', role: 'الاختبار والأمان', initials: 'QA', color: '#be6b55', status: 'ready', model: 'غير متصل', description: 'تنظيم فحوص الجودة والأمان وتوثيق نتائج التحقق دون تجاوز البوابات.' },
  { id: 'agent-automation', name: 'وكيل المعرفة والأتمتة', role: 'المعرفة وسير العمل', initials: 'KA', color: '#8a6bcc', status: 'ready', model: 'غير متصل', description: 'تنظيم المعرفة وإجراءات الأتمتة وربط الأدلة وسجل العمل بين الفرق.' },
];
const platformWorkspace = () => ({ id: 'ws-platform', name: 'تطوير المنصة والأتمتة', description: 'تطوير التطبيق والتكاملات والجودة والمعرفة ضمن مسار تقني واضح.', agentIds: ['agent-engineering', 'agent-quality', 'agent-automation', 'agent-orchestrator'], status: 'active', color: '#5279dc', notes: [] });

const copy = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const taskStatuses = ['queued', 'running', 'review', 'done'];
const priorities = ['high', 'medium', 'low'];
const approvalStatuses = ['pending', 'approved', 'rejected'];

function fail(message) {
  const error = new Error(message);
  error.status = 422;
  error.code = 'INVALID_STATE';
  throw error;
}
function text(value, label, limit = 3000, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string') fail(`${label} يجب أن يكون نصًا.`);
  const result = value.trim();
  if (!optional && !result) fail(`يرجى إدخال ${label}.`);
  if (result.length > limit) fail(`${label} يتجاوز ${limit} حرفًا.`);
  return result;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('معرّف السجل غير صالح.');
  return value;
}
function choice(value, choices, label) {
  if (!choices.includes(value)) fail(`${label} غير صالحة.`);
  return value;
}
function timestamp(value, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('تاريخ السجل غير صالح.');
  return new Date(value).toISOString();
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('لون السجل غير صالح.');
  return value;
}
function list(value, label, max = 5000) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} غير صالحة أو تتجاوز الحد المسموح.`);
  return value;
}
function unique(records, label) {
  if (new Set(records.map((record) => record.id)).size !== records.length) fail(`توجد معرّفات مكررة في ${label}.`);
}
function bool(value, label) {
  if (typeof value !== 'boolean') fail(`${label} يجب أن تكون نعم أو لا.`);
  return value;
}
function nonnegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${label} يجب أن يكون رقمًا غير سالب.`);
  return value;
}
function androidInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > 2147483647) fail(`${label} يجب أن يكون عددًا صحيحًا صالحًا.`);
  return value;
}
function imageUrl(value) {
  if (value == null || value === '') return '';
  const raw = text(value, 'رابط صورة المنتج', 2000);
  let url;
  try { url = new URL(raw); } catch { fail('رابط صورة المنتج غير صالح.'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('رابط صورة المنتج يجب أن يستخدم HTTPS بلا بيانات دخول.');
  return url.toString();
}
function orderDate(value) {
  if (typeof value !== 'number') return timestamp(value);
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) fail('تاريخ الطلب غير صالح.');
  return new Date(value).toISOString();
}
function emptyCommerce() {
  return { deviceId: null, appVersion: null, products: [], orders: [], receivedAt: null };
}
function commerceRecord(input) {
  if (!object(input)) fail('بيانات مزامنة التطبيق غير صالحة.');
  const products = list(input.products, 'منتجات التطبيق', 1000).map((product) => {
    if (!object(product)) fail('بيانات أحد منتجات التطبيق غير صالحة.');
    return {
      id: androidInteger(product.id, 'معرّف المنتج', 1), name: text(product.name, 'اسم المنتج', 160),
      category: text(product.category, 'تصنيف المنتج', 160), retailPrice: nonnegativeNumber(product.retailPrice, 'سعر التجزئة'),
      wholesalePrice: nonnegativeNumber(product.wholesalePrice, 'سعر الجملة'), imageUrl: imageUrl(product.imageUrl),
      stockQuantity: androidInteger(product.stockQuantity, 'كمية المخزون'), merchantName: text(product.merchantName, 'اسم التاجر', 160),
    };
  });
  unique(products, 'منتجات التطبيق');
  const orders = list(input.orders, 'طلبات التطبيق', 1000).map((order) => {
    if (!object(order)) fail('بيانات أحد طلبات التطبيق غير صالحة.');
    const id = typeof order.id === 'number' ? String(androidInteger(order.id, 'معرّف الطلب', 1)) : identifier(order.id);
    return {
      id, productId: androidInteger(order.productId, 'معرّف منتج الطلب', 1), productName: text(order.productName, 'اسم منتج الطلب', 160),
      quantity: androidInteger(order.quantity, 'كمية الطلب', 1), totalPrice: nonnegativeNumber(order.totalPrice, 'إجمالي الطلب'),
      status: text(order.status, 'حالة الطلب', 80), createdAt: orderDate(order.createdAt),
    };
  });
  unique(orders, 'طلبات التطبيق');
  return {
    deviceId: input.deviceId == null ? null : identifier(input.deviceId),
    appVersion: input.appVersion == null ? null : text(input.appVersion, 'إصدار التطبيق', 80),
    products, orders, receivedAt: timestamp(input.receivedAt, true),
  };
}
function settings(input, base = { storeName: 'Amer AI Store', ownerName: 'Amer', language: 'ar', timezone: 'Asia/Amman', notifications: true, reviewHighImpact: true }) {
  if (!object(input)) fail('إعدادات المشروع غير صالحة.');
  const result = { ...base };
  for (const key of ['storeName', 'ownerName', 'timezone']) {
    if (Object.hasOwn(input, key)) result[key] = text(input[key], { storeName: 'اسم المتجر', ownerName: 'اسم المسؤول', timezone: 'المنطقة الزمنية' }[key], 100);
  }
  try { new Intl.DateTimeFormat('ar', { timeZone: result.timezone }); } catch { fail('المنطقة الزمنية غير صالحة.'); }
  if (Object.hasOwn(input, 'language')) result.language = choice(input.language, ['ar', 'en'], 'اللغة');
  for (const key of ['notifications', 'reviewHighImpact']) if (Object.hasOwn(input, key)) result[key] = bool(input[key], 'قيمة الإعداد');
  return result;
}

/** Configurable outbound API origins are HTTPS DNS names only. */
export function normalizeServerBaseUrl(value) {
  const raw = text(value, 'عنوان الخادم', 2000);
  let url;
  try { url = new URL(raw); } catch { fail('عنوان الخادم ليس رابطًا صالحًا.'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('استخدم عنوان HTTPS بلا بيانات دخول أو معاملات أو أجزاء إضافية.');
  if (!hostname.includes('.') || hostname.includes(':') || /^[\d.]+$/.test(hostname) || !/^[a-z0-9.-]+$/.test(hostname)
    || ['localhost', 'local', 'internal', 'test', 'invalid'].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    fail('عنوان الخادم يجب أن يستخدم اسم نطاق HTTPS عامًا؛ العناوين المحلية وعناوين IP غير مسموحة.');
  }
  url.hostname = hostname;
  return url.toString().replace(/\/+$/, '');
}
export function normalizeServerPath(value, label = 'مسار API') {
  const path = text(value, label, 500);
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { fail(`${label} غير صالح.`); }
  if (!/^\/[a-zA-Z0-9_\-/]*$/.test(path) || path.startsWith('//') || decoded.includes('..') || decoded.includes('\\') || decoded.includes('//')) fail(`${label} يجب أن يكون مسارًا يبدأ بشرطة مائلة بدون رابط أو معاملات.`);
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}
function serverRecord(input) {
  if (!object(input)) fail('بيانات الخادم غير صالحة.');
  let tokenEnv = input.tokenEnv ?? null;
  if (tokenEnv === '') tokenEnv = null;
  if (tokenEnv !== null && (typeof tokenEnv !== 'string' || !/^AAS_[A-Z0-9_]{1,96}$/.test(tokenEnv))) fail('مرجع السر يجب أن يكون اسم متغير خادم يبدأ بـ AAS_، وليس قيمة مفتاح.');
  const httpStatus = input.lastHttpStatus ?? null;
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) fail('حالة HTTP غير صالحة.');
  const latency = input.latencyMs ?? null;
  if (latency !== null && (!Number.isFinite(latency) || latency < 0 || latency > 120000)) fail('زمن استجابة الخادم غير صالح.');
  return {
    id: identifier(input.id), name: text(input.name, 'اسم الخادم', 160), baseUrl: normalizeServerBaseUrl(input.baseUrl),
    healthPath: normalizeServerPath(input.healthPath ?? '/health', 'مسار فحص الصحة'), apiPrefix: normalizeServerPath(input.apiPrefix ?? '/api/v1'),
    enabled: bool(input.enabled ?? true, 'حالة تفعيل الخادم'), status: choice(input.status ?? 'unverified', ['unverified', 'online', 'offline'], 'حالة الخادم'),
    lastCheckedAt: timestamp(input.lastCheckedAt, true), lastHttpStatus: httpStatus, latencyMs: latency,
    lastError: input.lastError == null ? null : text(input.lastError, 'خطأ الاتصال', 500, true), tokenEnv,
  };
}

function dependencyIds(value) {
  const ids = list(value ?? [], 'اعتماديات المهمة', 30).map(identifier);
  if (new Set(ids).size !== ids.length) fail('لا تكرر اعتماد المهمة نفسها.');
  return ids;
}
function taskResourceKeys(value) {
  const keys = list(value ?? [], 'موارد المهمة', 10).map((input) => {
    const key = text(input, 'معرّف المورد', 200).replace(/\/+$/, '');
    if (!key || /[\x00-\x1f\x7f\\?#]/.test(key) || key.includes('//') || key.split('/').some((part) => part === '.' || part === '..')) fail('استخدم مسار مورد واضحًا بلا تنقل إلى المجلد الأب أو رابط خارجي.');
    return key;
  });
  if (new Set(keys).size !== keys.length) fail('لا تكرر المورد نفسه في المهمة.');
  return keys;
}

/** In-memory path index. A declared directory includes its descendants; other
 * resources and lanes remain independent. It performs no external locking. */
export function createTaskResourceIndex(tasks) {
  const root = { holders: [], children: new Map() };
  const locks = [];
  for (const task of tasks) {
    if (task.status !== 'running') continue;
    for (const key of task.resourceKeys ?? []) {
      const lock = { key, taskId: task.id, agentId: task.agentId, workspaceId: task.workspaceId };
      locks.push(lock);
      let node = root;
      for (const segment of key.split('/')) {
        if (!node.children.has(segment)) node.children.set(segment, { holders: [], children: new Map() });
        node = node.children.get(segment);
      }
      node.holders.push(lock);
    }
  }
  return {
    locks,
    tasksById: new Map(tasks.map((task) => [task.id, task])),
    conflicts(keys, excludeTaskId) {
      const found = new Map();
      const take = (node) => { for (const lock of node.holders) if (lock.taskId !== excludeTaskId) found.set(lock.taskId + '\0' + lock.key, lock); };
      for (const key of keys ?? []) {
        let node = root;
        const segments = key.split('/');
        for (let index = 0; index < segments.length; index++) {
          take(node);
          node = node.children.get(segments[index]);
          if (!node) break;
          if (index === segments.length - 1) {
            const pending = [node];
            while (pending.length) { const current = pending.pop(); take(current); pending.push(...current.children.values()); }
          }
        }
      }
      return [...found.values()].sort((a, b) => a.key.localeCompare(b.key, 'en') || a.taskId.localeCompare(b.taskId, 'en'));
    },
  };
}

/** Reasons apply only to this task's explicit dependencies, owner and paths. */
export function getTaskBlockers(state, task, resourceIndex = createTaskResourceIndex(state.tasks)) {
  const blockers = [];
  const tasks = resourceIndex.tasksById ?? new Map(state.tasks.map((item) => [item.id, item]));
  const unfinished = (task.dependencies ?? []).filter((id) => tasks.get(id)?.status !== 'done');
  if (unfinished.length) blockers.push({ code: 'dependency_not_done', message: 'تنتظر المهمة اكتمال اعتمادياتها المحددة فقط.', taskIds: unfinished });
  const conflicts = resourceIndex.conflicts(task.resourceKeys, task.id);
  if (conflicts.length) blockers.push({ code: 'resource_busy', message: 'مورد مشترك محجوز لمهمة جارية؛ تبقى الموارد الأخرى متاحة.', taskIds: [...new Set(conflicts.map((lock) => lock.taskId))], resourceKeys: [...new Set(conflicts.map((lock) => lock.key))] });
  if (state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.status === 'paused') blockers.push({ code: 'workspace_paused', message: 'مساحة هذه المهمة متوقفة مؤقتًا.', workspaceId: task.workspaceId });
  if (state.agents.find((agent) => agent.id === task.agentId)?.status === 'paused') blockers.push({ code: 'agent_paused', message: 'ملف الوكيل المسؤول متوقف مؤقتًا.', agentId: task.agentId });
  return blockers;
}

function validateTaskCoordination(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const dependents = new Map(tasks.map((task) => [task.id, []]));
  for (const task of tasks) {
    for (const id of task.dependencies) {
      if (!byId.has(id) || id === task.id) fail('اعتماد المهمة يشير إلى سجل غير موجود أو إلى المهمة نفسها.');
      indegree.set(task.id, indegree.get(task.id) + 1);
      dependents.get(id).push(task.id);
    }
    if (['running', 'done'].includes(task.status) && task.dependencies.some((id) => byId.get(id)?.status !== 'done')) fail('أكمل الاعتماديات المحددة قبل تشغيل المهمة أو إعلان اكتمالها.');
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    visited++;
    for (const id of dependents.get(ready[index])) { indegree.set(id, indegree.get(id) - 1); if (!indegree.get(id)) ready.push(id); }
  }
  if (visited !== tasks.length) fail('اعتماديات المهام تحتوي على دورة؛ افصل الاعتماد الدائري قبل الحفظ.');
  const resources = createTaskResourceIndex(tasks);
  for (const task of tasks) if (task.status === 'running' && resources.conflicts(task.resourceKeys, task.id).length) fail('لا يمكن تشغيل مهمتين على المورد نفسه أو على مسارات متداخلة في الوقت نفسه.');
}

const workflowPhases = ['analysis', 'implementation', 'verification', 'complete'];
const workflowOutcomes = ['passed', 'failed', 'blocked'];
const provenanceValues = ['manual', 'runner', 'server-analysis'];
function sourceRevision(value) {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) fail('يلزم معرّف مصدر SHA من 40 أو 64 خانة لربط الدليل بالمصدر.');
  return value.toLowerCase();
}
function workflowCounter(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) fail('مراجعة خطوة التنفيذ غير صالحة.');
  return value;
}
function evidenceRecords(input) {
  const evidence = list(input, 'أدلة المرحلة', 10).map((item) => {
    if (!object(item)) fail('الدليل يجب أن يكون سجلًا قابلًا للمراجعة، وليس تأكيدًا منطقيًا.');
    let url = null;
    if (item.url != null && item.url !== '') {
      const raw = text(item.url, 'رابط الدليل', 2000);
      let parsed;
      try { parsed = new URL(raw); } catch { fail('رابط الدليل غير صالح.'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('رابط الدليل يجب أن يستخدم HTTPS بلا بيانات دخول.');
      url = parsed.href;
    }
    const content = text(item.content, 'محتوى الدليل', 8000, true);
    if (!content && !url) fail('أرفق محتوى الدليل أو رابطًا فعليًا يمكن مراجعته؛ علامة نجاح وحدها لا تكفي.');
    let digest = null;
    if (item.sha256 != null && item.sha256 !== '') {
      if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)) fail('بصمة ملف الدليل SHA-256 غير صالحة.');
      digest = item.sha256.toLowerCase();
    }
    return { kind: choice(item.kind, ['log', 'diff', 'report', 'file', 'url'], 'نوع الدليل'), label: text(item.label, 'عنوان الدليل', 160), content, url, sha256: digest };
  });
  if (!evidence.length) fail('يلزم دليل واحد على الأقل قبل اجتياز المرحلة.');
  return evidence;
}
function verificationChecks(input, evidence, outcome) {
  const checks = list(input, 'فحوص التحقق', 30).map((check) => {
    if (!object(check)) fail('سجل الفحص غير صالح.');
    const exitCode = check.exitCode == null ? null : check.exitCode;
    if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < -1 || exitCode > 255)) fail('نتيجة أمر التحقق يجب أن تكون رمز خروج صالحًا.');
    if (!Number.isInteger(check.evidenceIndex) || !evidence[check.evidenceIndex]) fail('يجب ربط كل فحص بدليل موجود في سجل التحقق.');
    const artifact = evidence[check.evidenceIndex];
    if (!['log', 'report', 'file', 'url'].includes(artifact.kind)) fail('اربط الفحص بمخرجات أو تقرير تحقق؛ فرق الشيفرة وحده ليس اختبارًا.');
    return { name: text(check.name, 'اسم الفحص', 160), command: text(check.command, 'أمر أو إجراء التحقق', 1000), exitCode, evidenceIndex: check.evidenceIndex };
  });
  if (outcome === 'passed' && (!checks.length || checks.some((check) => check.exitCode !== 0))) fail('اجتياز التحقق يتطلب فحوصًا موثقة نجحت كلها برمز خروج 0.');
  if (outcome === 'failed' && checks.length && checks.every((check) => check.exitCode === 0)) fail('نتيجة الفشل يجب أن توضح الفحص الذي لم ينجح.');
  return checks;
}
function phaseRecord(input, phase) {
  if (!object(input)) fail('سجل مرحلة التنفيذ غير صالح.');
  const evidence = evidenceRecords(input.evidence);
  const outcome = choice(input.outcome, workflowOutcomes, 'نتيجة المرحلة');
  const provenance = choice(input.provenance, provenanceValues, 'مصدر الدليل');
  if (provenance === 'server-analysis' && phase !== 'analysis') fail('تحليل الخادم لا يثبت إجراء تعديل أو تشغيل فحوص.');
  const record = {
    id: identifier(input.id), summary: text(input.summary, 'ملخص المرحلة', 4000), evidence, provenance,
    recordedAt: timestamp(input.recordedAt), sourceRevision: sourceRevision(input.sourceRevision), stepRevision: workflowCounter(input.stepRevision), outcome,
    runnerId: input.runnerId == null ? null : identifier(input.runnerId), receiptId: input.receiptId == null ? null : identifier(input.receiptId),
  };
  if (provenance === 'runner') {
    if (!record.runnerId || !record.receiptId) fail('إيصال منفّذ الخدمة يجب أن يتضمن معرّف المنفّذ والإيصال.');
  } else if (record.runnerId || record.receiptId) fail('السجل اليدوي أو التحليل الثابت ليس إيصال تشغيل آلي.');
  if (phase === 'implementation') {
    record.changeType = choice(input.changeType, ['modification', 'addition', 'both'], 'نوع التغيير');
    if (outcome === 'passed' && !evidence.some((artifact) => artifact.kind === 'diff' && (artifact.url || /^(?:diff --git |--- |\+\+\+ |@@)/m.test(artifact.content)) || artifact.kind === 'file' && artifact.sha256)) fail('وثّق التغيير بفرق شيفرة فعلي أو ملف ذي بصمة؛ ملخص النية وحده لا يثبت تعديلًا.');
  }
  if (phase === 'verification') record.checks = verificationChecks(input.checks ?? [], evidence, outcome);
  return record;
}
function workflowRecord(input) {
  if (!object(input)) fail('بيانات سير التنفيذ غير صالحة.');
  const mode = choice(input.mode, ['change', 'analysis-only'], 'نمط التنفيذ');
  const steps = list(input.steps, 'خطوات التنفيذ', 30).map((step) => {
    if (!object(step)) fail('بيانات خطوة التنفيذ غير صالحة.');
    const revision = workflowCounter(step.revision);
    const result = {
      id: identifier(step.id), title: text(step.title, 'عنوان الخطوة', 160), description: text(step.description, 'وصف الخطوة', 3000, true),
      phase: choice(step.phase, workflowPhases, 'مرحلة الخطوة'), status: choice(step.status, ['pending', 'active', 'blocked', 'failed', 'complete'], 'حالة الخطوة'),
      revision, sourceRevision: sourceRevision(step.sourceRevision), analysis: step.analysis == null ? null : phaseRecord(step.analysis, 'analysis'),
      change: step.change == null ? null : phaseRecord(step.change, 'implementation'), verification: step.verification == null ? null : phaseRecord(step.verification, 'verification'), completedAt: timestamp(step.completedAt, true),
    };
    for (const record of [result.analysis, result.change, result.verification]) if (record && record.stepRevision > revision) fail('الدليل مرتبط بمراجعة مستقبلية للخطوة.');
    if (result.phase !== 'analysis' && result.analysis?.outcome !== 'passed') fail('لا تنتقل الخطوة قبل اكتمال تحليل موثق.');
    if (result.phase === 'implementation' && mode !== 'change') fail('نمط التحليل وحده لا يتضمن تعديل الشيفرة.');
    if (mode === 'analysis-only' && result.change) fail('سير التحليل وحده لا يقبل سجلات تغيير.');
    if (['verification', 'complete'].includes(result.phase) && mode === 'change' && result.change?.outcome !== 'passed') fail('لا يبدأ التحقق قبل تسجيل التعديل أو الإضافة ودليلها.');
    if (result.verification && (result.verification.stepRevision !== revision || result.verification.sourceRevision !== result.sourceRevision)) fail('نتيجة التحقق قديمة ولا تطابق مراجعة المصدر الحالية.');
    if (result.phase === 'complete' && (result.status !== 'complete' || !result.completedAt || result.verification?.outcome !== 'passed')) fail('اكتمال الخطوة يتطلب اجتياز بوابة التحقق الحالية.');
    if (result.phase !== 'complete' && (result.status === 'complete' || result.completedAt)) fail('لا يمكن إعلان اكتمال الخطوة قبل بوابة التحقق.');
    if (result.status === 'pending' && (result.phase !== 'analysis' || result.analysis || result.change || result.verification)) fail('الخطوة المستقبلية تبقى بلا نتائج حتى اجتياز ما قبلها.');
    return result;
  });
  if (!steps.length) fail('يلزم تعريف خطوة واحدة على الأقل في سير التنفيذ.');
  unique(steps, 'خطوات التنفيذ');
  const currentStepIndex = workflowCounter(input.currentStepIndex);
  if (!steps[currentStepIndex]) fail('مؤشر خطوة التنفيذ الحالية غير صالح.');
  const status = choice(input.status, ['active', 'blocked', 'failed', 'complete'], 'حالة سير التنفيذ');
  if (steps.slice(0, currentStepIndex).some((step) => step.phase !== 'complete') || steps.slice(currentStepIndex + 1).some((step) => step.status !== 'pending')) fail('لا يمكن تخطي خطوة لم تجتز التحقق.');
  if (status === 'complete' ? currentStepIndex !== steps.length - 1 || steps.some((step) => step.phase !== 'complete') : steps[currentStepIndex].phase === 'complete' || steps[currentStepIndex].status !== status) fail('حالة سير التنفيذ لا تطابق بوابته الحالية.');
  let repository = input.repository ?? null;
  if (repository !== null && (typeof repository !== 'string' || repository.length > 201 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.includes('..'))) fail('اسم مستودع سير التنفيذ غير صالح.');
  const events = list(input.events, 'سجل مراحل التنفيذ', 200).map((event) => {
    if (!object(event)) fail('حدث سير التنفيذ غير صالح.');
    const type = choice(event.type, ['created', 'step-added', 'analysis-recorded', 'change-recorded', 'verification-recorded', 'step-advanced', 'invalidated'], 'نوع حدث التنفيذ');
    const phase = { 'analysis-recorded': 'analysis', 'change-recorded': 'implementation', 'verification-recorded': 'verification' }[type];
    return { id: identifier(event.id), stepId: event.stepId == null ? null : identifier(event.stepId), type, message: text(event.message, 'وصف حدث التنفيذ', 1000), provenance: choice(event.provenance, provenanceValues, 'مصدر الحدث'), createdAt: timestamp(event.createdAt), ...(event.record == null ? {} : { record: phaseRecord(event.record, phase ?? 'analysis') }) };
  });
  unique(events, 'أحداث التنفيذ');
  const receiptIds = list(input.receiptIds ?? [], 'إيصالات منفّذ الخدمة', 1000).map(identifier);
  if (new Set(receiptIds).size !== receiptIds.length) fail('إيصال تشغيل الخدمة لا يُستخدم أكثر من مرة.');
  return { id: identifier(input.id), title: text(input.title, 'عنوان سير التنفيذ', 160), description: text(input.description, 'وصف سير التنفيذ', 3000, true), repository, sourceRevision: sourceRevision(input.sourceRevision), mode, status, currentStepIndex, createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt), steps, events, receiptIds };
}
function workflowEvent(workflow, type, stepId, message, provenance = 'manual', record) {
  workflow.events.unshift({ id: makeId('workflow-event'), type, stepId, message, provenance, createdAt: now(), ...(record ? { record: copy(record) } : {}) });
  workflow.events = workflow.events.slice(0, 200);
  workflow.updatedAt = now();
}
function newWorkflowStep(input, revision, active = false) {
  if (!object(input)) fail('تعريف خطوة التنفيذ غير صالح.');
  return { id: makeId('workflow-step'), title: input.title, description: input.description ?? '', phase: 'analysis', status: active ? 'active' : 'pending', revision: 0, sourceRevision: revision, analysis: null, change: null, verification: null, completedAt: null };
}
function workflowTarget(state, payload) {
  const workflow = find(state.workflows, payload.workflowId, 'سير التنفيذ');
  const step = find(workflow.steps, payload.stepId, 'خطوة التنفيذ');
  const index = workflow.steps.indexOf(step);
  if (index > workflow.currentStepIndex) fail('الخطوة مقفلة؛ يجب اجتياز جميع البوابات السابقة أولًا.');
  return { workflow, step, index };
}
function invalidateWorkflow(workflow, index, provenance) {
  const targets = workflow.steps.slice(index);
  for (const step of targets) {
    step.revision++;
    step.phase = 'analysis'; step.status = 'pending'; step.analysis = null; step.change = null; step.verification = null; step.completedAt = null;
    step.sourceRevision = workflow.sourceRevision;
  }
  workflow.currentStepIndex = index;
  workflow.status = 'active';
  targets[0].status = 'active';
  workflowEvent(workflow, 'invalidated', targets[0].id, 'أُبطلت نتائج الخطوة وما بعدها بسبب تغيير السياق أو المصدر. تبقى السجلات السابقة في سجل الأحداث.', provenance);
}
function recordWorkflowPhase(state, payload, phase, provenance) {
  const { workflow, step, index } = workflowTarget(state, payload);
  if (payload.stepRevision != null && workflowCounter(payload.stepRevision) !== step.revision) fail('وصل دليل لمراجعة قديمة من الخطوة؛ أعد التحقق على السياق الحالي.');
  const runner = provenance === 'runner';
  let runnerId = null, receiptId = null;
  if (runner) {
    workflowCounter(payload.stepRevision);
    runnerId = identifier(payload.runnerId); receiptId = identifier(payload.receiptId);
    if (state.workflows.some((item) => item.receiptIds.includes(receiptId))) fail('إيصال منفّذ الخدمة مسجل مسبقًا ولا يمكن إعادة استخدامه.');
    if (workflow.receiptIds.length >= 1000) fail('وصل سير التنفيذ إلى الحد الأقصى لإيصالات الخدمة.');
  }
  const targetRevision = sourceRevision(payload.sourceRevision);
  const outcome = choice(payload.outcome ?? 'passed', workflowOutcomes, 'نتيجة المرحلة');
  if (phase === 'analysis') {
    if (targetRevision !== workflow.sourceRevision) fail('التحليل يجب أن يرتبط بمعرّف المصدر الحالي لسير التنفيذ.');
    invalidateWorkflow(workflow, index, provenance);
  } else if (phase === 'implementation') {
    if (workflow.mode !== 'change') fail('سير التحليل وحده لا يسمح بتسجيل تعديل أو إضافة.');
    if (step.analysis?.outcome !== 'passed' || step.phase === 'analysis') fail('أكمل التحليل الموثق قبل تسجيل التعديل أو الإضافة.');
    if (outcome === 'passed' && targetRevision === workflow.sourceRevision) fail('التعديل المكتمل يحتاج معرّف مصدر جديدًا؛ لا تعلن تغييرًا على النسخة نفسها.');
    const analysis = copy(step.analysis);
    workflow.sourceRevision = targetRevision;
    invalidateWorkflow(workflow, index, provenance);
    step.analysis = analysis;
  } else {
    if (index !== workflow.currentStepIndex || step.phase !== 'verification') fail('يبدأ التحقق بعد اجتياز التحليل والتعديل المطلوبين للخطوة الحالية.');
    if (targetRevision !== step.sourceRevision || targetRevision !== workflow.sourceRevision) fail('التحقق لا يطابق نسخة المصدر الحالية؛ لا يمكن اعتماد نتيجة قديمة.');
    if (payload.stepRevision == null) fail('يلزم تحديد مراجعة الخطوة التي نُفذت عليها فحوص التحقق.');
  }
  const record = phaseRecord({
    id: makeId('workflow-record'), summary: payload.summary, evidence: payload.evidence, provenance, recordedAt: now(),
    sourceRevision: targetRevision, stepRevision: step.revision, outcome, runnerId, receiptId,
    changeType: payload.changeType, checks: payload.checks,
  }, phase);
  if (runner) workflow.receiptIds.push(receiptId);
  if (phase === 'analysis') {
    step.analysis = record;
    step.phase = outcome === 'passed' ? workflow.mode === 'change' ? 'implementation' : 'verification' : 'analysis';
  } else if (phase === 'implementation') {
    step.change = record;
    step.phase = outcome === 'passed' ? 'verification' : 'implementation';
  } else step.verification = record;
  step.status = outcome === 'passed' ? 'active' : outcome;
  workflow.status = step.status;
  const type = { analysis: 'analysis-recorded', implementation: 'change-recorded', verification: 'verification-recorded' }[phase];
  workflowEvent(workflow, type, step.id, `${{ analysis: 'تحليل', implementation: 'تعديل أو إضافة', verification: 'تحقق' }[phase]} موثق: ${outcome === 'passed' ? 'اجتاز المرحلة' : outcome === 'blocked' ? 'متوقف بسبب عائق' : 'لم يجتز المرحلة'}. مصدر الدليل: ${provenance}.`, provenance, record);
  log(state, 'تحديث بوابة التنفيذ', `سير «${workflow.title}» · خطوة «${step.title}» · ${type}.`, 'workflow');
  return workflow;
}

export function initialLiveState() {
  return {
    schemaVersion: LIVE_SCHEMA_VERSION, demoMode: false, coordinationVersion: COORDINATION_VERSION,
    agents: [
      { id: 'agent-orchestrator', name: 'عامر · المنسّق', role: 'تنسيق العمل', initials: 'AM', color: '#6d5dfc', status: 'ready', model: 'غير متصل', description: 'تنظيم المهام وتوزيعها بين مساحات العمل ومتابعة القرارات.' },
      { id: 'agent-catalog', name: 'وكيل المنتجات', role: 'الكتالوج والمحتوى', initials: 'PR', color: '#2fb98e', status: 'ready', model: 'غير متصل', description: 'إعداد أوصاف المنتجات وتنظيم الكتالوج ومراجعة جودة المحتوى.' },
      { id: 'agent-marketing', name: 'وكيل التسويق', role: 'النمو والحملات', initials: 'MK', color: '#f29b4b', status: 'ready', model: 'غير متصل', description: 'تخطيط الحملات وصياغة المحتوى ومتابعة فرص النمو.' },
      { id: 'agent-support', name: 'وكيل خدمة العملاء', role: 'تجربة العميل', initials: 'CS', color: '#4e9fe8', status: 'ready', model: 'غير متصل', description: 'تنظيم طلبات العملاء وإعداد مسودات الردود ومراجعة الأسئلة المتكررة.' },
      { id: 'agent-analytics', name: 'وكيل التحليلات', role: 'البيانات والتقارير', initials: 'DA', color: '#b882ef', status: 'ready', model: 'غير متصل', description: 'تجهيز التقارير وتعريف المؤشرات وتحليل بيانات المتجر عند توصيلها.' },
      { id: 'agent-operations', name: 'وكيل العمليات', role: 'الطلبات والتشغيل', initials: 'OP', color: '#dd789d', status: 'paused', model: 'غير متصل', description: 'تنظيم إجراءات الطلبات والمخزون وتوثيق خطوات التشغيل.' },
      ...newOrganizationalAgents(),
    ],
    workspaces: [
      { id: 'ws-commerce', name: 'إدارة المتجر', description: 'كتالوج المنتجات والطلبات وإجراءات التشغيل اليومية.', agentIds: ['agent-catalog', 'agent-operations', 'agent-orchestrator'], status: 'active', color: '#2fb98e', notes: [] },
      { id: 'ws-growth', name: 'النمو والتسويق', description: 'التخطيط للحملات والمحتوى وفرص نمو المتجر.', agentIds: ['agent-marketing', 'agent-analytics', 'agent-orchestrator'], status: 'active', color: '#f29b4b', notes: [] },
      { id: 'ws-customer', name: 'تجربة العملاء', description: 'مسودات الردود والمعرفة وتحسين رحلة العميل.', agentIds: ['agent-support', 'agent-orchestrator'], status: 'active', color: '#4e9fe8', notes: [] },
      { id: 'ws-intelligence', name: 'البيانات والاستراتيجية', description: 'المؤشرات والتقارير وتوثيق القرارات.', agentIds: ['agent-analytics', 'agent-orchestrator'], status: 'paused', color: '#b882ef', notes: [] },
      platformWorkspace(),
    ],
    tasks: [], approvals: [], activity: [], servers: [], runs: [], workflows: [], commerce: emptyCommerce(), settings: settings({}),
  };
}

export function normalizeLiveState(input) {
  if (!object(input) || input.schemaVersion !== LIVE_SCHEMA_VERSION || input.demoMode !== false) fail('ملف المشروع لا يطابق إصدار البيانات الحية. لا يمكن استيراد بيانات العرض التجريبي.');
  const upgradeCoordination = input.coordinationVersion == null;
  if (!upgradeCoordination && input.coordinationVersion !== COORDINATION_VERSION) fail('إصدار تنظيم الفرق غير مدعوم.');
  const rawAgents = [...list(input.agents, 'الوكلاء', 120)];
  if (upgradeCoordination) for (const agent of newOrganizationalAgents()) if (!rawAgents.some((item) => item?.id === agent.id)) rawAgents.push(agent);
  const agents = list(rawAgents, 'الوكلاء', 120).map((a) => {
    if (!object(a)) fail('بيانات أحد الوكلاء غير صالحة.');
    return { id: identifier(a.id), name: text(a.name, 'اسم الوكيل', 160), role: text(a.role, 'دور الوكيل', 160), initials: text(a.initials, 'اختصار الوكيل', 8), color: color(a.color), status: choice(a.status, ['ready', 'paused'], 'حالة الوكيل'), model: 'غير متصل', description: text(a.description, 'وصف الوكيل', 3000, true) };
  });
  if (!agents.length) fail('يجب أن يحتوي المشروع على وكيل واحد على الأقل.');
  unique(agents, 'الوكلاء');
  const agentIds = new Set(agents.map((a) => a.id));
  const rawWorkspaces = [...list(input.workspaces, 'مساحات العمل', 510)];
  if (upgradeCoordination && !rawWorkspaces.some((workspace) => workspace?.id === 'ws-platform')) {
    const technical = platformWorkspace();
    technical.agentIds = technical.agentIds.filter((id) => agentIds.has(id));
    rawWorkspaces.push(technical);
  }
  const workspaces = list(rawWorkspaces, 'مساحات العمل', 510).map((w) => {
    if (!object(w)) fail('بيانات إحدى المساحات غير صالحة.');
    const ids = list(w.agentIds, 'وكلاء المساحة', 100).map(identifier);
    if (new Set(ids).size !== ids.length || ids.some((id) => !agentIds.has(id))) fail('قائمة وكلاء المساحة غير صالحة.');
    const notes = list(w.notes, 'ملاحظات المساحة', 1000).map((n) => {
      if (!object(n)) fail('الملاحظة غير صالحة.');
      return { id: identifier(n.id), body: text(n.body, 'الملاحظة', 4000), createdAt: timestamp(n.createdAt) };
    });
    unique(notes, 'ملاحظات المساحة');
    return { id: identifier(w.id), name: text(w.name, 'اسم المساحة', 160), description: text(w.description, 'وصف المساحة', 3000, true), agentIds: ids, status: choice(w.status, ['active', 'paused'], 'حالة المساحة'), color: color(w.color), notes };
  });
  unique(workspaces, 'مساحات العمل');
  const workspaceMap = new Map(workspaces.map((w) => [w.id, w]));
  const tasks = list(input.tasks, 'المهام').map((t) => {
    if (!object(t) || !agentIds.has(t.agentId) || !workspaceMap.has(t.workspaceId)) fail('المهمة مرتبطة بوكيل أو مساحة غير موجودة.');
    if (!workspaceMap.get(t.workspaceId).agentIds.includes(t.agentId)) fail('الوكيل المسؤول يجب أن يكون ضمن فريق مساحة المهمة.');
    return { id: identifier(t.id), title: text(t.title, 'عنوان المهمة', 160), description: text(t.description, 'وصف المهمة', 3000, true), agentId: t.agentId, workspaceId: t.workspaceId, status: choice(t.status, taskStatuses, 'حالة المهمة'), priority: choice(t.priority, priorities, 'أولوية المهمة'), dependencies: dependencyIds(t.dependencies), resourceKeys: taskResourceKeys(t.resourceKeys), createdAt: timestamp(t.createdAt), updatedAt: timestamp(t.updatedAt ?? t.createdAt) };
  });
  unique(tasks, 'المهام');
  validateTaskCoordination(tasks);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const pendingTasks = new Set();
  const approvals = list(input.approvals, 'الموافقات').map((a) => {
    if (!object(a) || !taskMap.has(a.taskId)) fail('الموافقة مرتبطة بمهمة غير موجودة.');
    const status = choice(a.status, approvalStatuses, 'حالة الموافقة');
    if (status === 'pending') {
      if (pendingTasks.has(a.taskId) || taskMap.get(a.taskId).status !== 'review') fail('لكل مهمة مراجعة معلقة واحدة فقط، وتبقى المهمة للمراجعة حتى القرار.');
      pendingTasks.add(a.taskId);
    }
    return { id: identifier(a.id), taskId: a.taskId, title: text(a.title, 'عنوان الموافقة', 160), description: text(a.description, 'وصف الموافقة', 3000, true), impact: text(a.impact, 'أثر الموافقة', 100), status, createdAt: timestamp(a.createdAt), decidedAt: timestamp(a.decidedAt, true) };
  });
  unique(approvals, 'الموافقات');
  const activity = list(input.activity, 'سجل النشاط', 2000).map((a) => {
    if (!object(a)) fail('سجل النشاط غير صالح.');
    const description = text(a.description ?? a.message, 'تفاصيل النشاط', 3000, true);
    return { id: identifier(a.id), title: text(a.title, 'عنوان النشاط', 160), description, message: description, type: text(a.type, 'نوع النشاط', 40), createdAt: timestamp(a.createdAt) };
  });
  unique(activity, 'سجل النشاط');
  const servers = list(input.servers, 'الخوادم', 100).map(serverRecord);
  unique(servers, 'الخوادم');
  const workflows = list(input.workflows ?? [], 'سير التنفيذ', 50).map(workflowRecord);
  unique(workflows, 'سير التنفيذ');
  if (list(input.runs, 'التشغيلات').length) fail('لا يمكن إنشاء سجل تشغيل آلي قبل توصيل خدمة تنفيذ فعلية.');
  return { schemaVersion: LIVE_SCHEMA_VERSION, demoMode: false, coordinationVersion: COORDINATION_VERSION, agents, workspaces, tasks, approvals, activity, servers, runs: [], workflows, commerce: commerceRecord(input.commerce ?? emptyCommerce()), settings: settings(input.settings) };
}

function log(state, title, description, type) {
  state.activity.unshift({ id: makeId('activity'), title, description, message: description, type, createdAt: now() });
  state.activity = state.activity.slice(0, 2000);
}
function find(records, id, label) { return records.find((record) => record.id === identifier(id)) ?? fail(`${label} غير موجودة.`); }
function applyPatch(target, patch, allowed) {
  if (!object(patch)) fail('حقول التحديث غير صالحة.');
  for (const key of allowed) if (Object.hasOwn(patch, key)) target[key] = patch[key];
}
function ensureReview(state, task) {
  if (task.status !== 'review' || state.approvals.some((a) => a.taskId === task.id && a.status === 'pending')) return;
  state.approvals.unshift({ id: makeId('approval'), taskId: task.id, title: task.title, description: task.description, impact: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' }[task.priority], status: 'pending', createdAt: now(), decidedAt: null });
  log(state, 'طلب مراجعة جديد', `أُرسلت مهمة «${task.title}» إلى صندوق الموافقات.`, 'approval');
}

/** Atomic transition. Health, app snapshots, server analysis and runner receipts
 * must be restricted to their own authenticated server routes. */
export function mutateLiveState(input, operation, payload = {}) {
  if (!object(payload)) fail('بيانات الطلب غير صالحة.');
  let next = normalizeLiveState(input);
  let result;
  switch (operation) {
    case 'startWorkflow': {
      if (next.workflows.length >= 50) fail('وصلت إلى الحد الأقصى لعدد مسارات التنفيذ.');
      const revision = sourceRevision(payload.sourceRevision);
      const definitions = list(payload.steps, 'خطوات التنفيذ', 30);
      if (!definitions.length) fail('أضف خطوة واحدة على الأقل قبل بدء سير التنفيذ.');
      const startedAt = now();
      result = { id: makeId('workflow'), title: payload.title, description: payload.description ?? '', repository: payload.repository ?? null, sourceRevision: revision, mode: payload.mode ?? 'change', status: 'active', currentStepIndex: 0, createdAt: startedAt, updatedAt: startedAt, steps: definitions.map((definition, index) => newWorkflowStep(definition, revision, index === 0)), events: [], receiptIds: [] };
      workflowEvent(result, 'created', result.steps[0].id, 'بدأ سير تنفيذ ببوابات متتابعة؛ لم يُنفذ تحليل أو تعديل أو تحقق بعد.');
      next.workflows.unshift(result);
      log(next, 'سير تنفيذ جديد', `أُنشئ سير «${text(payload.title, 'عنوان سير التنفيذ', 160)}» بواقع ${definitions.length} خطوات.`, 'workflow');
      break;
    }
    case 'addWorkflowStep': {
      result = find(next.workflows, payload.workflowId, 'سير التنفيذ');
      if (result.steps.length >= 30) fail('وصل سير التنفيذ إلى الحد الأقصى لعدد الخطوات.');
      const active = result.status === 'complete';
      const step = newWorkflowStep(payload, result.sourceRevision, active);
      result.steps.push(step);
      if (active) { result.currentStepIndex = result.steps.length - 1; result.status = 'active'; }
      workflowEvent(result, 'step-added', step.id, `أُضيفت خطوة «${text(step.title, 'عنوان الخطوة', 160)}» دون تخطي البوابات السابقة.`);
      log(next, 'إضافة خطوة تنفيذ', `أُضيفت خطوة إلى سير «${result.title}».`, 'workflow');
      break;
    }
    case 'recordWorkflowAnalysis': result = recordWorkflowPhase(next, payload, 'analysis', 'manual'); break;
    case 'recordWorkflowChange': result = recordWorkflowPhase(next, payload, 'implementation', 'manual'); break;
    case 'recordWorkflowVerification': result = recordWorkflowPhase(next, payload, 'verification', 'manual'); break;
    case 'recordWorkflowAnalysisResult': result = recordWorkflowPhase(next, payload, 'analysis', 'server-analysis'); break;
    case 'recordWorkflowRunnerReceipt': {
      const phase = choice(payload.phase, ['analysis', 'implementation', 'verification'], 'مرحلة إيصال المنفّذ');
      result = recordWorkflowPhase(next, payload, phase, 'runner');
      break;
    }
    case 'advanceWorkflow':
    case 'advanceWorkflowRunner': {
      const { workflow, step, index } = workflowTarget(next, payload);
      if (index !== workflow.currentStepIndex || step.phase !== 'verification' || step.verification?.outcome !== 'passed' || step.verification.stepRevision !== step.revision || step.verification.sourceRevision !== workflow.sourceRevision || !step.verification.checks.length || step.verification.checks.some((check) => check.exitCode !== 0)) fail('البوابة مقفلة: يلزم تحقق ناجح موثق على مراجعة الخطوة والمصدر الحاليين قبل الانتقال.');
      const provenance = operation === 'advanceWorkflowRunner' ? 'runner' : 'manual';
      if (provenance === 'runner' && (step.verification.provenance !== 'runner' || identifier(payload.runnerId) !== step.verification.runnerId || identifier(payload.verificationReceiptId) !== step.verification.receiptId)) fail('الانتقال الآلي يتطلب إيصال تحقق ناجحًا للمنفّذ نفسه؛ الدليل اليدوي ليس تشغيل خدمة.');
      step.phase = 'complete'; step.status = 'complete'; step.completedAt = now();
      if (workflow.steps[index + 1]) {
        workflow.currentStepIndex = index + 1;
        workflow.steps[index + 1].status = 'active';
        workflow.steps[index + 1].sourceRevision = workflow.sourceRevision;
        workflow.status = 'active';
      } else workflow.status = 'complete';
      workflowEvent(workflow, 'step-advanced', step.id, workflow.status === 'complete' ? 'اجتازت الخطوة بوابتها واكتمل سير التنفيذ بحسب الأدلة المسجلة.' : 'اجتازت الخطوة بوابتها وفُتح تحليل الخطوة التالية.', provenance);
      log(next, 'اجتياز بوابة تنفيذ', `اجتازت خطوة «${step.title}» بوابة سير «${workflow.title}».`, 'workflow');
      result = workflow;
      break;
    }
    case 'addTask': {
      if (next.tasks.length >= 5000) fail('وصلت إلى الحد الأقصى لعدد المهام.');
      const createdAt = now();
      result = { id: makeId('task'), title: payload.title, description: payload.description ?? '', agentId: payload.agentId, workspaceId: payload.workspaceId, status: payload.status ?? 'queued', priority: payload.priority ?? 'medium', dependencies: dependencyIds(payload.dependencies), resourceKeys: taskResourceKeys(payload.resourceKeys), createdAt, updatedAt: createdAt };
      next.tasks.unshift(result);
      if (result.status === 'running') { const blockers = getTaskBlockers(next, result); if (blockers.length) fail(blockers[0].message); }
      log(next, 'مهمة جديدة', `أُضيفت مهمة «${text(result.title, 'عنوان المهمة', 160)}».`, 'task');
      ensureReview(next, result);
      break;
    }
    case 'updateTask': {
      result = find(next.tasks, payload.id, 'المهمة');
      if (next.approvals.some((a) => a.taskId === result.id && a.status === 'pending')) fail('راجع الموافقة المعلقة أولًا؛ لا يمكن تعديل المهمة قبل القرار.');
      const previousStatus = result.status;
      applyPatch(result, payload.patch, ['title', 'description', 'agentId', 'workspaceId', 'status', 'priority', 'dependencies', 'resourceKeys']);
      result.dependencies = dependencyIds(result.dependencies);
      result.resourceKeys = taskResourceKeys(result.resourceKeys);
      if (result.status === 'running' && (previousStatus !== 'running' || ['agentId', 'workspaceId', 'dependencies', 'resourceKeys'].some((key) => Object.hasOwn(payload.patch, key)))) {
        const blockers = getTaskBlockers(next, result); if (blockers.length) fail(blockers[0].message);
      }
      result.updatedAt = now();
      log(next, 'تحديث مهمة', `تم تحديث مهمة «${text(result.title, 'عنوان المهمة', 160)}».`, 'task');
      ensureReview(next, result);
      break;
    }
    case 'deleteTask': {
      const task = find(next.tasks, payload.id, 'المهمة');
      if (next.approvals.some((a) => a.taskId === task.id && a.status === 'pending')) fail('احسم الموافقة المعلقة قبل حذف المهمة.');
      next.tasks = next.tasks.filter((t) => t.id !== task.id);
      next.approvals = next.approvals.filter((a) => a.taskId !== task.id);
      result = { id: task.id, deleted: true };
      log(next, 'حذف مهمة', `حُذفت مهمة «${task.title}» وطلبات مراجعتها المرتبطة.`, 'task');
      break;
    }
    case 'addWorkspace': {
      if (next.workspaces.length >= 500) fail('وصلت إلى الحد الأقصى لعدد المساحات.');
      result = { id: makeId('workspace'), name: payload.name, description: payload.description ?? '', agentIds: payload.agentIds ?? [], status: payload.status ?? 'active', color: payload.color ?? '#6d5dfc', notes: [] };
      next.workspaces.push(result);
      log(next, 'مساحة عمل جديدة', `أُنشئت مساحة «${text(result.name, 'اسم المساحة', 160)}».`, 'workspace');
      break;
    }
    case 'updateWorkspace': {
      result = find(next.workspaces, payload.id, 'المساحة');
      applyPatch(result, payload.patch, ['name', 'description', 'agentIds', 'status', 'color']);
      log(next, 'تحديث مساحة عمل', `تم تحديث مساحة «${text(result.name, 'اسم المساحة', 160)}».`, 'workspace');
      break;
    }
    case 'deleteWorkspace': {
      const workspace = find(next.workspaces, payload.id, 'المساحة');
      if (next.tasks.some((t) => t.workspaceId === workspace.id)) fail('انقل مهام المساحة أو احذفها قبل حذف المساحة.');
      next.workspaces = next.workspaces.filter((w) => w.id !== workspace.id);
      result = { id: workspace.id, deleted: true };
      log(next, 'حذف مساحة عمل', `حُذفت مساحة «${workspace.name}» وملاحظاتها.`, 'workspace');
      break;
    }
    case 'resolveApproval': {
      result = find(next.approvals, payload.id, 'الموافقة');
      const decision = choice(payload.decision, ['approved', 'rejected'], 'قرار الموافقة');
      if (result.status !== 'pending') fail('تم حسم هذه الموافقة مسبقًا.');
      result.status = decision;
      result.decidedAt = now();
      const task = find(next.tasks, result.taskId, 'المهمة');
      task.status = decision === 'approved' ? 'queued' : 'review'; task.updatedAt = now();
      log(next, decision === 'approved' ? 'اعتماد المهمة' : 'رفض المهمة', `تم ${decision === 'approved' ? 'اعتماد' : 'رفض'} «${result.title}». القرار محفوظ ولا ينفّذ إجراءً خارجيًا.`, 'approval');
      break;
    }
    case 'addNote': {
      const workspace = find(next.workspaces, payload.workspaceId, 'المساحة');
      if (workspace.notes.length >= 1000) fail('وصلت إلى الحد الأقصى لملاحظات المساحة.');
      result = { id: makeId('note'), body: text(payload.body, 'الملاحظة', 4000), createdAt: now() };
      workspace.notes.unshift(result);
      log(next, 'ملاحظة جديدة', `أُضيفت ملاحظة إلى مساحة «${workspace.name}».`, 'note');
      break;
    }
    case 'updateSettings': {
      next.settings = settings(payload, next.settings);
      result = next.settings;
      log(next, 'حفظ الإعدادات', 'تم حفظ إعدادات المشروع في قاعدة البيانات.', 'settings');
      break;
    }
    case 'updateAgent': {
      result = find(next.agents, payload.id, 'بيانات الوكيل');
      applyPatch(result, payload.patch, ['name', 'role', 'description', 'status']);
      log(next, 'تحديث ملف الوكيل', `تم تحديث الملف التنظيمي للوكيل «${text(result.name, 'اسم الوكيل', 160)}».`, 'agent');
      break;
    }
    case 'addServer': {
      if (next.servers.length >= 100) fail('وصلت إلى الحد الأقصى لعدد الخوادم.');
      result = serverRecord({ ...payload, id: makeId('server'), status: 'unverified', lastCheckedAt: null, lastHttpStatus: null, latencyMs: null, lastError: null });
      next.servers.push(result);
      log(next, 'إضافة خادم', `أُضيف إعداد API للخادم «${result.name}». الاتصال لم يُفحص بعد.`, 'server');
      break;
    }
    case 'updateServer': {
      result = find(next.servers, payload.id, 'بيانات الخادم');
      applyPatch(result, payload.patch, ['name', 'baseUrl', 'healthPath', 'apiPrefix', 'enabled', 'tokenEnv']);
      Object.assign(result, { status: 'unverified', lastCheckedAt: null, lastHttpStatus: null, latencyMs: null, lastError: null });
      log(next, 'تحديث API الخادم', `تم حفظ إعداد API للخادم «${text(result.name, 'اسم الخادم', 160)}»؛ يحتاج إلى فحص اتصال جديد.`, 'server');
      break;
    }
    case 'deleteServer': {
      const server = find(next.servers, payload.id, 'بيانات الخادم');
      next.servers = next.servers.filter((s) => s.id !== server.id);
      result = { id: server.id, deleted: true };
      log(next, 'حذف إعداد خادم', `حُذف إعداد API للخادم «${server.name}».`, 'server');
      break;
    }
    case 'recordServerHealth': {
      result = find(next.servers, payload.id, 'بيانات الخادم');
      result.status = choice(payload.status, ['online', 'offline'], 'نتيجة فحص الخادم');
      result.lastCheckedAt = timestamp(payload.lastCheckedAt);
      for (const key of ['lastHttpStatus', 'latencyMs', 'lastError']) result[key] = payload[key] ?? null;
      log(next, 'فحص اتصال الخادم', `الخادم «${result.name}»: ${result.status === 'online' ? 'نجح فحص الاتصال' : 'تعذر الاتصال'}.`, 'server');
      break;
    }
    case 'recordAppSnapshot': {
      next.commerce = commerceRecord({
        deviceId: identifier(payload.deviceId), appVersion: text(payload.appVersion, 'إصدار التطبيق', 80),
        products: payload.products, orders: payload.orders, receivedAt: timestamp(payload.receivedAt),
      });
      result = next.commerce;
      log(next, 'استلام بيانات التطبيق', `استُلمت ${next.commerce.products.length} منتجات و${next.commerce.orders.length} طلبات من التطبيق، الإصدار ${next.commerce.appVersion}.`, 'app-sync');
      break;
    }
    case 'importData': {
      let imported;
      try { imported = typeof payload.data === 'string' ? JSON.parse(payload.data) : copy(payload.data); } catch { fail('تعذّر قراءة ملف JSON.'); }
      // An imported JSON cannot certify gates, erase a failure, forge a runner,
      // or manufacture server analysis. Existing server workflow records win.
      next = normalizeLiveState({ ...imported, workflows: copy(next.workflows) });
      next.activity = copy(input.activity);
      next.commerce = commerceRecord(input.commerce ?? emptyCommerce());
      for (const server of next.servers) Object.assign(server, { status: 'unverified', lastCheckedAt: null, lastHttpStatus: null, latencyMs: null, lastError: null });
      log(next, 'استيراد بيانات المشروع', `استُوردت ${next.tasks.length} مهام و${next.workspaces.length} مساحات. سجل النشاط السابق محفوظ، واتصالات الخوادم تحتاج إلى فحص جديد.`, 'system');
      result = next;
      break;
    }
    case 'reset': {
      const previous = next;
      next = initialLiveState();
      next.servers = previous.servers;
      next.activity = previous.activity;
      next.commerce = previous.commerce;
      next.workflows = previous.workflows;
      log(next, 'إعادة ضبط سجلات المشروع', 'أُعيدت ملفات الوكلاء والمساحات إلى تعريفاتها الأولى، وأُزيلت المهام والملاحظات والموافقات. إعدادات الخوادم وبيانات التطبيق وسير التنفيذ وسجل النشاط محفوظة.', 'system');
      result = next;
      break;
    }
    default: fail('عملية API غير معروفة.');
  }
  next = normalizeLiveState(next);
  if (result && Object.hasOwn(result, 'schemaVersion')) result = next;
  else if (result?.id && !result.deleted) result = [...next.tasks, ...next.workspaces, ...next.approvals, ...next.agents, ...next.servers, ...next.workflows, ...next.workspaces.flatMap((w) => w.notes)].find((record) => record.id === result.id) ?? result;
  return { state: copy(next), result: copy(result ?? next) };
}
