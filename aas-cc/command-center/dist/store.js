/**
 * AAS-CC / AAS-AW local demo store. This module never executes an AI agent.
 * All returned objects are detached snapshots. Mutations validate their input,
 * persist when browser storage is available, and then notify subscribers.
 */
export const STORAGE_KEY = 'aas-command-center.state.v1';
export const SCHEMA_VERSION = 1;

export const statuses = Object.freeze({
  task: Object.freeze({ queued: 'في الانتظار', running: 'قيد العمل', review: 'للمراجعة', done: 'مكتملة' }),
  workspace: Object.freeze({ active: 'نشطة', paused: 'متوقفة مؤقتًا' }),
  agent: Object.freeze({ ready: 'جاهز للإعداد', paused: 'متوقف مؤقتًا' }),
  approval: Object.freeze({ pending: 'بانتظار القرار', approved: 'معتمدة', rejected: 'مرفوضة' }),
  priority: Object.freeze({ high: 'عالية', medium: 'متوسطة', low: 'منخفضة' }),
});

const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const stamp = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

function textField(value, label, { optional = false, limit = 3000 } = {}) {
  if (optional && value == null) return '';
  if (typeof value !== 'string') fail(`${label} يجب أن يكون نصًا.`);
  const result = value.trim();
  if (!optional && !result) fail(`يرجى إدخال ${label}.`);
  if (result.length > limit) fail(`${label} أطول من الحد المسموح (${limit} حرفًا).`);
  return result;
}

function enumField(value, options, label) {
  if (!Object.hasOwn(options, value)) fail(`${label} غير صالحة.`);
  return value;
}

function idField(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('معرّف السجل غير صالح.');
  return value;
}

function dateField(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('تاريخ السجل غير صالح.');
  return new Date(value).toISOString();
}

function colorField(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('يرجى اختيار لون صالح للمساحة.');
  return value;
}

function arrayField(value, label, max = 5000) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} غير صالحة أو تتجاوز الحد المسموح.`);
  return value;
}

function assertUnique(items, label) {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail(`توجد معرّفات مكررة في ${label}.`);
}

function settingsFields(input, base = defaultSettings()) {
  if (!object(input)) fail('إعدادات المشروع غير صالحة.');
  const result = { ...base };
  for (const key of ['storeName', 'ownerName', 'timezone']) {
    if (Object.hasOwn(input, key)) result[key] = textField(input[key], { storeName: 'اسم المتجر', ownerName: 'اسم المسؤول', timezone: 'المنطقة الزمنية' }[key], { limit: 100 });
  }
  if (Object.hasOwn(input, 'timezone')) {
    try { new Intl.DateTimeFormat('ar', { timeZone: result.timezone }); } catch { fail('المنطقة الزمنية غير صالحة.'); }
  }
  if (Object.hasOwn(input, 'language')) result.language = enumField(input.language, { ar: true, en: true }, 'اللغة');
  for (const key of ['notifications', 'reviewHighImpact']) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'boolean') fail('قيمة الإعداد يجب أن تكون نعم أو لا.');
      result[key] = input[key];
    }
  }
  return result;
}

function defaultSettings() {
  return { storeName: 'Amer AI Store', ownerName: 'Amer', language: 'ar', timezone: 'Asia/Riyadh', notifications: true, reviewHighImpact: true };
}

/** Returns a fresh example project; dates are relative to the supplied date. */
export function seedState(now = new Date()) {
  const reference = new Date(now).getTime();
  if (!Number.isFinite(reference)) fail('تاريخ بدء المشروع غير صالح.');
  const ago = (minutes) => new Date(reference - minutes * 60000).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    demoMode: true,
    agents: [
      { id: 'agent-orchestrator', name: 'عامر · المنسّق', role: 'تنسيق العمل', initials: 'AM', color: '#6d5dfc', status: 'ready', model: 'غير متصل', description: 'تنظيم المهام وتوزيعها بين مساحات العمل ومتابعة القرارات.' },
      { id: 'agent-catalog', name: 'وكيل المنتجات', role: 'الكتالوج والمحتوى', initials: 'PR', color: '#2fb98e', status: 'ready', model: 'غير متصل', description: 'إعداد أوصاف المنتجات وتنظيم الكتالوج ومراجعة جودة المحتوى.' },
      { id: 'agent-marketing', name: 'وكيل التسويق', role: 'النمو والحملات', initials: 'MK', color: '#f29b4b', status: 'ready', model: 'غير متصل', description: 'تخطيط الحملات وصياغة المحتوى ومتابعة فرص النمو.' },
      { id: 'agent-support', name: 'وكيل خدمة العملاء', role: 'تجربة العميل', initials: 'CS', color: '#4e9fe8', status: 'ready', model: 'غير متصل', description: 'تنظيم طلبات العملاء وإعداد مسودات الردود ومراجعة الأسئلة المتكررة.' },
      { id: 'agent-analytics', name: 'وكيل التحليلات', role: 'البيانات والتقارير', initials: 'DA', color: '#b882ef', status: 'ready', model: 'غير متصل', description: 'تجهيز التقارير وتعريف المؤشرات وتحليل بيانات المتجر عند توصيلها.' },
      { id: 'agent-operations', name: 'وكيل العمليات', role: 'الطلبات والتشغيل', initials: 'OP', color: '#dd789d', status: 'paused', model: 'غير متصل', description: 'تنظيم إجراءات الطلبات والمخزون وتوثيق خطوات التشغيل.' },
    ],
    workspaces: [
      { id: 'ws-commerce', name: 'إدارة المتجر', description: 'كتالوج المنتجات والطلبات وإجراءات التشغيل اليومية.', agentIds: ['agent-catalog', 'agent-operations', 'agent-orchestrator'], status: 'active', color: '#2fb98e', notes: [{ id: 'note-commerce-1', body: 'ابدأ بمراجعة وصف المنتجات الأكثر زيارة، ثم جهّز التغييرات للاعتماد.', createdAt: ago(180) }] },
      { id: 'ws-growth', name: 'النمو والتسويق', description: 'التخطيط للحملات والمحتوى وفرص نمو المتجر.', agentIds: ['agent-marketing', 'agent-analytics', 'agent-orchestrator'], status: 'active', color: '#f29b4b', notes: [{ id: 'note-growth-1', body: 'الأولوية هذا الأسبوع: تجهيز حملة المنتجات الجديدة ومراجعة الرسائل قبل النشر.', createdAt: ago(120) }] },
      { id: 'ws-customer', name: 'تجربة العملاء', description: 'مسودات الردود والمعرفة وتحسين رحلة العميل.', agentIds: ['agent-support', 'agent-orchestrator'], status: 'active', color: '#4e9fe8', notes: [] },
      { id: 'ws-intelligence', name: 'البيانات والاستراتيجية', description: 'المؤشرات والتقارير وتوثيق القرارات.', agentIds: ['agent-analytics', 'agent-orchestrator'], status: 'paused', color: '#b882ef', notes: [] },
    ],
    tasks: [
      { id: 'task-1', title: 'مراجعة أوصاف المنتجات الجديدة', description: 'راجع وضوح الفوائد والمواصفات وجهّز مسودات تحسين المحتوى.', agentId: 'agent-catalog', workspaceId: 'ws-commerce', status: 'running', priority: 'high', createdAt: ago(260) },
      { id: 'task-2', title: 'إعداد خطة حملة نهاية الأسبوع', description: 'رتّب أهداف الحملة والجمهور والمحتوى المقترح للمراجعة.', agentId: 'agent-marketing', workspaceId: 'ws-growth', status: 'review', priority: 'high', createdAt: ago(240) },
      { id: 'task-3', title: 'تحديث دليل الأسئلة المتكررة', description: 'أضف إجابات واضحة عن الشحن والاستبدال وتتبع الطلبات.', agentId: 'agent-support', workspaceId: 'ws-customer', status: 'running', priority: 'medium', createdAt: ago(200) },
      { id: 'task-4', title: 'تجهيز تقرير أداء المنتجات', description: 'مسودة مثال لتقرير يقارن زيارات المنتجات وطلباتها بعد توصيل البيانات.', agentId: 'agent-analytics', workspaceId: 'ws-intelligence', status: 'queued', priority: 'medium', createdAt: ago(160) },
      { id: 'task-5', title: 'مراجعة تنظيم تصنيفات المتجر', description: 'اقترح تصنيفات تسهّل الوصول إلى المنتجات.', agentId: 'agent-catalog', workspaceId: 'ws-commerce', status: 'queued', priority: 'low', createdAt: ago(140) },
      { id: 'task-6', title: 'اعتماد مسودة رسالة الترحيب', description: 'راجع نبرة رسالة الترحيب المقترحة قبل استخدامها.', agentId: 'agent-support', workspaceId: 'ws-customer', status: 'review', priority: 'medium', createdAt: ago(100) },
      { id: 'task-7', title: 'توثيق سير عمل تجهيز الطلب', description: 'كتابة خطوات مراجعة الطلب والتجهيز والتسليم.', agentId: 'agent-operations', workspaceId: 'ws-commerce', status: 'done', priority: 'medium', createdAt: ago(360) },
      { id: 'task-8', title: 'إعداد تقويم محتوى أسبوعي', description: 'مسودة توزيع موضوعات المحتوى على أيام الأسبوع.', agentId: 'agent-marketing', workspaceId: 'ws-growth', status: 'done', priority: 'low', createdAt: ago(320) },
      { id: 'task-9', title: 'ترتيب أولويات الفريق', description: 'مراجعة قائمة المهام وتحديد المسؤول عن كل خطوة.', agentId: 'agent-orchestrator', workspaceId: 'ws-commerce', status: 'done', priority: 'high', createdAt: ago(300) },
      { id: 'task-10', title: 'تحديد مؤشرات تجربة العميل', description: 'تعريف زمن الاستجابة وجودة الرد ورضا العميل كمؤشرات مقترحة.', agentId: 'agent-analytics', workspaceId: 'ws-intelligence', status: 'queued', priority: 'medium', createdAt: ago(60) },
    ],
    approvals: [
      { id: 'approval-1', taskId: 'task-2', title: 'خطة حملة نهاية الأسبوع', description: 'مراجعة واعتماد الخطة داخل المشروع. النشر يحتاج تكاملًا منفصلًا.', impact: 'عالية', status: 'pending' },
      { id: 'approval-2', taskId: 'task-6', title: 'رسالة الترحيب الجديدة', description: 'اعتماد مسودة الرد قبل إضافتها إلى دليل الفريق.', impact: 'متوسطة', status: 'pending' },
      { id: 'approval-3', taskId: 'task-8', title: 'تقويم المحتوى الأسبوعي', description: 'تم اعتماد المثال التجريبي لتقويم المحتوى.', impact: 'منخفضة', status: 'approved' },
    ],
    activity: [
      { id: 'activity-1', title: 'مسودة جديدة للمراجعة', description: 'أُضيفت خطة الحملة إلى قائمة الاعتمادات التجريبية.', message: 'أُضيفت خطة الحملة إلى قائمة الاعتمادات التجريبية.', type: 'approval', createdAt: ago(12) },
      { id: 'activity-2', title: 'اكتملت مهمة في المثال', description: 'تم توثيق سير عمل تجهيز الطلب ضمن بيانات العرض.', message: 'تم توثيق سير عمل تجهيز الطلب ضمن بيانات العرض.', type: 'task', createdAt: ago(35) },
      { id: 'activity-3', title: 'تحديث مساحة النمو', description: 'أُضيفت ملاحظة عن أولويات المحتوى لهذا الأسبوع.', message: 'أُضيفت ملاحظة عن أولويات المحتوى لهذا الأسبوع.', type: 'note', createdAt: ago(120) },
      { id: 'activity-4', title: 'بيئة المشروع جاهزة', description: 'تم تجهيز أربع مساحات وستة وكلاء ببيانات تجريبية. لا توجد اتصالات خارجية.', message: 'تم تجهيز أربع مساحات وستة وكلاء ببيانات تجريبية. لا توجد اتصالات خارجية.', type: 'system', createdAt: ago(400) },
    ],
    settings: defaultSettings(),
  };
}

function normalizeState(input) {
  if (!object(input) || input.schemaVersion !== SCHEMA_VERSION) fail('ملف المشروع غير صالح أو يستخدم إصدارًا غير مدعوم.');
  const agents = arrayField(input.agents, 'قائمة الوكلاء', 100).map((agent) => {
    if (!object(agent)) fail('بيانات أحد الوكلاء غير صالحة.');
    return { id: idField(agent.id), name: textField(agent.name, 'اسم الوكيل', { limit: 160 }), role: textField(agent.role, 'دور الوكيل', { limit: 160 }), initials: textField(agent.initials, 'اختصار الوكيل', { limit: 8 }), color: colorField(agent.color), status: enumField(agent.status, statuses.agent, 'حالة الوكيل'), model: 'غير متصل', description: textField(agent.description, 'وصف الوكيل', { optional: true }) };
  });
  if (!agents.length) fail('يجب أن يحتوي المشروع على وكيل واحد على الأقل.');
  assertUnique(agents, 'الوكلاء');
  const agentIds = new Set(agents.map((agent) => agent.id));
  const workspaces = arrayField(input.workspaces, 'قائمة المساحات', 500).map((workspace) => {
    if (!object(workspace)) fail('بيانات إحدى المساحات غير صالحة.');
    const ids = arrayField(workspace.agentIds, 'وكلاء المساحة', 100).map(idField);
    if (ids.some((id) => !agentIds.has(id)) || new Set(ids).size !== ids.length) fail('قائمة وكلاء المساحة تحتوي على معرّفات غير صالحة.');
    const notes = arrayField(workspace.notes, 'ملاحظات المساحة', 1000).map((note) => {
      if (!object(note)) fail('بيانات إحدى الملاحظات غير صالحة.');
      return { id: idField(note.id), body: textField(note.body, 'الملاحظة', { limit: 4000 }), createdAt: dateField(note.createdAt) };
    });
    assertUnique(notes, 'ملاحظات المساحة');
    return { id: idField(workspace.id), name: textField(workspace.name, 'اسم المساحة', { limit: 160 }), description: textField(workspace.description, 'وصف المساحة', { optional: true }), agentIds: ids, status: enumField(workspace.status, statuses.workspace, 'حالة المساحة'), color: colorField(workspace.color), notes };
  });
  assertUnique(workspaces, 'المساحات');
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const tasks = arrayField(input.tasks, 'قائمة المهام').map((task) => {
    if (!object(task) || !agentIds.has(task.agentId) || !workspaceIds.has(task.workspaceId)) fail('إحدى المهام مرتبطة بوكيل أو مساحة غير موجودة.');
    return { id: idField(task.id), title: textField(task.title, 'عنوان المهمة', { limit: 160 }), description: textField(task.description, 'وصف المهمة', { optional: true }), agentId: task.agentId, workspaceId: task.workspaceId, status: enumField(task.status, statuses.task, 'حالة المهمة'), priority: enumField(task.priority, statuses.priority, 'أولوية المهمة'), createdAt: dateField(task.createdAt) };
  });
  assertUnique(tasks, 'المهام');
  const taskIds = new Set(tasks.map((task) => task.id));
  const approvals = arrayField(input.approvals, 'قائمة الاعتمادات').map((approval) => {
    if (!object(approval) || !taskIds.has(approval.taskId)) fail('أحد الاعتمادات مرتبط بمهمة غير موجودة.');
    return { id: idField(approval.id), taskId: approval.taskId, title: textField(approval.title, 'عنوان الاعتماد', { limit: 160 }), description: textField(approval.description, 'وصف الاعتماد', { optional: true }), impact: textField(approval.impact, 'أثر الاعتماد', { limit: 100 }), status: enumField(approval.status, statuses.approval, 'حالة الاعتماد') };
  });
  assertUnique(approvals, 'الاعتمادات');
  const activity = arrayField(input.activity, 'سجل النشاط', 2000).map((entry) => {
    if (!object(entry)) fail('بيانات أحد الأنشطة غير صالحة.');
    const description = textField(entry.description ?? entry.message, 'تفاصيل النشاط', { optional: true });
    return { id: idField(entry.id), title: textField(entry.title, 'عنوان النشاط', { limit: 160 }), description, message: description, type: textField(entry.type, 'نوع النشاط', { limit: 40 }), createdAt: dateField(entry.createdAt) };
  });
  assertUnique(activity, 'سجل النشاط');
  return { schemaVersion: SCHEMA_VERSION, demoMode: true, agents, workspaces, tasks, approvals, activity, settings: settingsFields(input.settings) };
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/**
 * createStore({ storage?, storageKey? })
 * getState(), subscribe(listener), addTask(input), updateTask(id, patch),
 * addWorkspace(input), updateWorkspace(id, patch), resolveApproval(id, decision),
 * addNote(workspaceId, body), updateSettings(patch), exportData(), importData(data), reset().
 * subscribe fires after mutations; it returns an unsubscribe function.
 * exportData returns JSON. importData accepts JSON or an object and replaces state
 * atomically after validation. Invalid mutations throw an Arabic Error.
 * Storage errors do not interrupt editing; the state remains usable in memory.
 */
export function createStore(options = {}) {
  const storage = Object.hasOwn(options, 'storage') ? options.storage : browserStorage();
  const key = options.storageKey ?? STORAGE_KEY;
  const listeners = new Set();
  let state;
  try {
    const saved = storage?.getItem(key);
    state = saved ? normalizeState(JSON.parse(saved)) : seedState();
  } catch { state = seedState(); }

  const persist = () => { try { storage?.setItem(key, JSON.stringify(state)); } catch { /* Keep local editing available when storage is denied or full. */ } };
  persist();

  const notify = () => {
    for (const listener of listeners) {
      try { listener(copy(state)); } catch { /* A faulty view subscriber must not prevent other views from updating. */ }
    }
  };
  const log = (next, title, description, type) => {
    next.activity.unshift({ id: makeId('activity'), title, description, message: description, type, createdAt: stamp() });
    next.activity = next.activity.slice(0, 500);
  };
  const commit = (change) => {
    const next = copy(state);
    const result = change(next);
    state = normalizeState(next);
    persist();
    notify();
    // Return the validated entity, including normalized whitespace and defaults.
    if (result === next.settings) return copy(state.settings);
    if (result?.id) {
      const records = [...state.tasks, ...state.workspaces, ...state.approvals, ...state.workspaces.flatMap((workspace) => workspace.notes)];
      return copy(records.find((record) => record.id === result.id) ?? result);
    }
    return copy(result ?? state);
  };
  const workspaceById = (next, id) => next.workspaces.find((workspace) => workspace.id === id) ?? fail('مساحة العمل غير موجودة.');
  const taskById = (next, id) => next.tasks.find((task) => task.id === id) ?? fail('المهمة غير موجودة.');

  return {
    getState: () => copy(state),
    subscribe(listener) {
      if (typeof listener !== 'function') fail('مستمع التحديثات يجب أن يكون دالة.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addTask(input) {
      if (!object(input)) fail('بيانات المهمة غير صالحة.');
      return commit((next) => {
        if (next.tasks.length >= 5000) fail('وصلت إلى الحد الأقصى لعدد المهام.');
        const task = { id: makeId('task'), title: input.title, description: input.description ?? '', agentId: input.agentId, workspaceId: input.workspaceId, priority: input.priority ?? 'medium', status: input.status ?? 'queued', createdAt: stamp() };
        next.tasks.push(task);
        log(next, 'مهمة محلية جديدة', `أُضيفت مهمة «${textField(input.title, 'عنوان المهمة', { limit: 160 })}» إلى قائمة العمل.`, 'task');
        return task;
      });
    },
    updateTask(id, patch) {
      if (!object(patch)) fail('تحديث المهمة غير صالح.');
      return commit((next) => {
        const task = taskById(next, id);
        for (const key of ['title', 'description', 'agentId', 'workspaceId', 'priority', 'status']) if (Object.hasOwn(patch, key)) task[key] = patch[key];
        log(next, 'تحديث مهمة', `تم تحديث مهمة «${textField(task.title, 'عنوان المهمة', { limit: 160 })}» محليًا.`, 'task');
        return task;
      });
    },
    addWorkspace(input) {
      if (!object(input)) fail('بيانات المساحة غير صالحة.');
      return commit((next) => {
        if (next.workspaces.length >= 500) fail('وصلت إلى الحد الأقصى لعدد المساحات.');
        const workspace = { id: makeId('workspace'), name: input.name, description: input.description ?? '', agentIds: input.agentIds ?? [], status: input.status ?? 'active', color: input.color ?? '#6d5dfc', notes: [] };
        next.workspaces.push(workspace);
        log(next, 'مساحة عمل جديدة', `أُنشئت مساحة «${textField(input.name, 'اسم المساحة', { limit: 160 })}».`, 'workspace');
        return workspace;
      });
    },
    updateWorkspace(id, patch) {
      if (!object(patch)) fail('تحديث المساحة غير صالح.');
      return commit((next) => {
        const workspace = workspaceById(next, id);
        for (const key of ['name', 'description', 'agentIds', 'status', 'color']) if (Object.hasOwn(patch, key)) workspace[key] = patch[key];
        log(next, 'تحديث مساحة عمل', `تم تحديث مساحة «${textField(workspace.name, 'اسم المساحة', { limit: 160 })}».`, 'workspace');
        return workspace;
      });
    },
    resolveApproval(id, decision) {
      if (!['approved', 'rejected'].includes(decision)) fail('قرار الاعتماد غير صالح.');
      return commit((next) => {
        const approval = next.approvals.find((item) => item.id === id) ?? fail('طلب الاعتماد غير موجود.');
        if (approval.status !== 'pending') fail('تم حسم هذا الاعتماد مسبقًا.');
        approval.status = decision;
        taskById(next, approval.taskId).status = decision === 'approved' ? 'queued' : 'review';
        log(next, decision === 'approved' ? 'اعتماد مسودة' : 'إعادة المسودة للمراجعة', `${decision === 'approved' ? 'تم اعتماد' : 'تم رفض'} «${approval.title}» وتحديث حالة المهمة محليًا.`, 'approval');
        return approval;
      });
    },
    addNote(workspaceId, body) {
      return commit((next) => {
        const workspace = workspaceById(next, workspaceId);
        if (workspace.notes.length >= 1000) fail('وصلت إلى الحد الأقصى لملاحظات المساحة.');
        const note = { id: makeId('note'), body: textField(body, 'الملاحظة', { limit: 4000 }), createdAt: stamp() };
        workspace.notes.unshift(note);
        log(next, 'ملاحظة جديدة', `أُضيفت ملاحظة إلى مساحة «${workspace.name}».`, 'note');
        return note;
      });
    },
    updateSettings(patch) {
      return commit((next) => {
        next.settings = settingsFields(patch, next.settings);
        log(next, 'حفظ الإعدادات', 'تم تحديث إعدادات المشروع على هذا المتصفح.', 'settings');
        return next.settings;
      });
    },
    exportData: () => JSON.stringify(state, null, 2),
    importData(data) {
      let incoming;
      try { incoming = typeof data === 'string' ? JSON.parse(data) : copy(data); } catch { fail('تعذّر قراءة الملف. يرجى اختيار ملف JSON صالح.'); }
      const next = normalizeState(incoming);
      log(next, 'استيراد المشروع', 'تم استيراد نسخة المشروع وحفظها محليًا.', 'system');
      state = next;
      persist();
      notify();
      return copy(state);
    },
    reset() {
      state = seedState();
      persist();
      notify();
      return copy(state);
    },
  };
}
