// Only the same-origin v1 project backup is read. It is never overwritten or removed.
export const LEGACY_STORAGE_KEY = 'aas-command-center.state.v1';
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const DEFAULT_WORKSPACES = new Set(['ws-commerce', 'ws-growth', 'ws-customer', 'ws-intelligence']);
const LIVE_DEFAULT_WORKSPACES = new Set([...DEFAULT_WORKSPACES, 'ws-platform']);
const SAMPLE_TASK = /^task-(?:[1-9]|10)$/;
const SAMPLE_APPROVAL = /^approval-[1-3]$/;
const SAMPLE_NOTES = new Set(['note-commerce-1', 'note-growth-1']);
const clone = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = message => { throw new MigrationError(message); };
class MigrationError extends Error {}

function list(value, limit) {
  if (!Array.isArray(value) || value.length > limit) refuse('صيغة النسخة المحلية أو عدد سجلاتها غير صالح.');
  return value;
}
function record(value) {
  if (!isObject(value)) refuse('تحتوي النسخة المحلية على سجل غير صالح.');
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) refuse('تحتوي النسخة المحلية على معرّف غير صالح.');
  return value;
}
function text(value, limit, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > limit) refuse('تحتوي النسخة المحلية على نص غير صالح.');
  return value.trim();
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) refuse('تحتوي النسخة المحلية على تاريخ غير صالح.');
  return new Date(value).toISOString();
}
function choice(value, values) {
  if (!values.includes(value)) refuse('تحتوي النسخة المحلية على حالة غير صالحة.');
  return value;
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) refuse('تحتوي النسخة المحلية على لون غير صالح.');
  return value;
}
function unique(records) {
  if (new Set(records.map(item => item.id)).size !== records.length) refuse('تحتوي النسخة المحلية على معرّفات مكررة.');
}

function safeSettings(value, current) {
  record(value);
  const result = { ...current };
  for (const key of ['storeName', 'ownerName', 'timezone']) {
    if (Object.hasOwn(value, key)) result[key] = text(value[key], 100);
  }
  if (Object.hasOwn(value, 'language')) result.language = choice(value.language, ['ar', 'en']);
  for (const key of ['notifications', 'reviewHighImpact']) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'boolean') refuse('إعدادات النسخة المحلية غير صالحة.');
      result[key] = value[key];
    }
  }
  // Timezone and all other final constraints remain authoritative on the server.
  return result;
}

function readLegacy(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) refuse('حجم النسخة المحلية يتجاوز حد النقل التلقائي البالغ ٢ ميغابايت.');
  let source;
  try { source = JSON.parse(raw); } catch { refuse('تعذّر قراءة JSON في النسخة المحلية القديمة.'); }
  if (!isObject(source) || source.schemaVersion !== 1 || source.demoMode !== true) refuse('إصدار النسخة المحلية القديمة غير متوافق.');
  const agents = list(source.agents, 100).map(input => {
    const agent = record(input);
    identifier(agent.id); text(agent.name, 160); text(agent.role, 160); text(agent.initials, 8); color(agent.color);
    choice(agent.status, ['ready', 'paused']); text(agent.description, 3000, true);
    return agent;
  });
  if (!agents.length) refuse('لا تحتوي النسخة المحلية على ملفات وكلاء صالحة.');
  unique(agents);
  const agentIds = new Set(agents.map(agent => agent.id));
  const workspaces = list(source.workspaces, 500).map(input => {
    const workspace = record(input);
    identifier(workspace.id); text(workspace.name, 160); text(workspace.description, 3000, true);
    choice(workspace.status, ['active', 'paused']); color(workspace.color);
    const ids = list(workspace.agentIds, 100).map(identifier);
    if (new Set(ids).size !== ids.length || ids.some(id => !agentIds.has(id))) refuse('تحتوي النسخة المحلية على فريق مساحة غير صالح.');
    list(workspace.notes, 1000).forEach(input => { const note = record(input); identifier(note.id); text(note.body, 4000); timestamp(note.createdAt); });
    return workspace;
  });
  unique(workspaces);
  const workspaceIds = new Set(workspaces.map(workspace => workspace.id));
  const tasks = list(source.tasks, 5000).map(input => {
    const task = record(input);
    identifier(task.id); text(task.title, 160); text(task.description, 3000, true); timestamp(task.createdAt);
    choice(task.status, ['queued', 'running', 'review', 'done']); choice(task.priority, ['high', 'medium', 'low']);
    if (!agentIds.has(task.agentId) || !workspaceIds.has(task.workspaceId)) refuse('تحتوي النسخة المحلية على مهمة مرتبطة بسجل غير موجود.');
    return task;
  });
  unique(tasks);
  const taskIds = new Set(tasks.map(task => task.id));
  const approvals = list(source.approvals, 5000).map(input => {
    const approval = record(input);
    identifier(approval.id); text(approval.title, 160); text(approval.description, 3000, true); text(approval.impact, 100);
    choice(approval.status, ['pending', 'approved', 'rejected']);
    if (!taskIds.has(approval.taskId)) refuse('تحتوي النسخة المحلية على موافقة مرتبطة بمهمة غير موجودة.');
    if (approval.createdAt != null) timestamp(approval.createdAt);
    if (approval.decidedAt != null) timestamp(approval.decidedAt);
    return approval;
  });
  unique(approvals);
  // The old timeline is bounded but never copied: it includes example events.
  list(source.activity, 2000);
  record(source.settings);
  return { workspaces, tasks, approvals, settings: source.settings };
}

function pristineLiveState(state) {
  return isObject(state) && state.schemaVersion === 2 && state.demoMode === false
    && Array.isArray(state.tasks) && state.tasks.length === 0
    && Array.isArray(state.approvals) && state.approvals.length === 0
    && Array.isArray(state.runs) && state.runs.length === 0
    && Array.isArray(state.workspaces) && [DEFAULT_WORKSPACES.size,LIVE_DEFAULT_WORKSPACES.size].includes(state.workspaces.length)
    && new Set(state.workspaces.map(workspace => workspace.id)).size === state.workspaces.length
    && [...DEFAULT_WORKSPACES].every(id=>state.workspaces.some(workspace=>workspace.id===id))
    && state.workspaces.every(workspace => LIVE_DEFAULT_WORKSPACES.has(workspace.id) && Array.isArray(workspace.notes) && workspace.notes.length === 0);
}

function candidateFrom(current, legacy) {
  const candidate = clone(current);
  const counts = { workspaces: 0, tasks: 0, notes: 0, approvals: 0 };
  const knownAgents = new Set(candidate.agents.map(agent => agent.id));
  const workspaceMap = new Map(candidate.workspaces.map(workspace => [workspace.id, workspace]));
  for (const workspace of legacy.workspaces) {
    if (DEFAULT_WORKSPACES.has(workspace.id)) continue;
    if (workspace.agentIds.some(id => !knownAgents.has(id))) refuse('أحد فرق المساحات المحلية يحتاج إلى مراجعة ملف الوكيل قبل النقل.');
    const added = { id: workspace.id, name: workspace.name, description: workspace.description ?? '', agentIds: [...workspace.agentIds], status: workspace.status, color: workspace.color, notes: [] };
    candidate.workspaces.push(added);
    workspaceMap.set(added.id, added);
    counts.workspaces++;
  }
  for (const workspace of legacy.workspaces) {
    const target = workspaceMap.get(workspace.id);
    if (!target) refuse('إحدى المساحات المحلية غير موجودة في المشروع المستهدف.');
    const noteIds = new Map(target.notes.map(note => [note.id, note]));
    for (const input of workspace.notes) {
      if (SAMPLE_NOTES.has(input.id)) continue;
      const note = { id: input.id, body: text(input.body, 4000), createdAt: timestamp(input.createdAt) };
      if (noteIds.has(note.id)) {
        if (JSON.stringify(noteIds.get(note.id)) !== JSON.stringify(note)) refuse('توجد ملاحظتان مختلفتان بالمعرّف نفسه؛ تحتاج النسخة المحلية إلى المراجعة.');
        continue;
      }
      target.notes.push(note);
      noteIds.set(note.id, note);
      counts.notes++;
    }
  }
  for (const input of legacy.tasks) {
    if (SAMPLE_TASK.test(input.id)) continue;
    const workspace = workspaceMap.get(input.workspaceId);
    if (!knownAgents.has(input.agentId) || !workspace) refuse('إحدى المهام المحلية تحتاج إلى مراجعة ارتباطها بالوكيل أو المساحة قبل النقل.');
    if (!workspace.agentIds.includes(input.agentId)) refuse('الوكيل المسؤول عن إحدى المهام المحلية ليس ضمن فريق مساحتها؛ راجع العضوية قبل النقل.');
    candidate.tasks.push({ id: input.id, title: input.title, description: input.description ?? '', agentId: input.agentId, workspaceId: input.workspaceId, status: input.status, priority: input.priority, createdAt: input.createdAt });
    counts.tasks++;
  }
  if (!counts.workspaces && !counts.tasks && !counts.notes) return { candidate, counts };
  const manualTasks = new Map(candidate.tasks.map(task => [task.id, task]));
  const migrationTime = new Date().toISOString();
  for (const input of legacy.approvals) {
    // Decisions tied to example tasks cannot promote those tasks into real work.
    if (SAMPLE_APPROVAL.test(input.id) || !manualTasks.has(input.taskId)) continue;
    candidate.approvals.push({ id: input.id, taskId: input.taskId, title: input.title, description: input.description ?? '', impact: input.impact, status: input.status, createdAt: input.createdAt ?? migrationTime, decidedAt: input.decidedAt ?? null });
    counts.approvals++;
  }
  for (const task of candidate.tasks) {
    if (task.status !== 'review' || candidate.approvals.some(approval => approval.taskId === task.id)) continue;
    // This is a new pending review request, never an invented approval or execution.
    candidate.approvals.push({ id: `approval-${globalThis.crypto.randomUUID()}`, taskId: task.id, title: task.title, description: task.description, impact: { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' }[task.priority], status: 'pending', createdAt: migrationTime, decidedAt: null });
    counts.approvals++;
  }
  candidate.settings = safeSettings(legacy.settings, candidate.settings);
  return { candidate, counts };
}

/**
 * Move only manual v1 work into an unused live v2 project. Source storage is read
 * once and stays intact on success and failure. Server validation precedes one
 * revision-0 CAS import; revision conflicts are never replayed by this helper.
 * Result: { migrated, counts?: { workspaces, tasks, notes, approvals }, warning? }.
 */
export async function migrateLegacyWorkspace(apiStore, { storage } = {}) {
  try {
    if (apiStore.getRevision() !== 0) return { migrated: false };
    const current = apiStore.getState();
    if (!pristineLiveState(current)) return { migrated: false };
    if (storage === undefined) storage = globalThis.localStorage;
    const raw = storage?.getItem(LEGACY_STORAGE_KEY);
    if (raw == null) return { migrated: false };
    const legacy = readLegacy(raw);
    const { candidate, counts } = candidateFrom(current, legacy);
    if (!counts.workspaces && !counts.tasks && !counts.notes) return { migrated: false };
    const checked = await apiStore.validateImport(candidate);
    if (checked?.valid !== true) refuse('لم يقبل الخادم صيغة البيانات المحلية.');
    // validateImport is read-only. An overlapping refresh may nevertheless have
    // observed new work; do not let importData adopt a later revision for this move.
    if (apiStore.getRevision() !== 0 || !pristineLiveState(apiStore.getState())) refuse('تغيّرت بيانات المشروع من جلسة أخرى أثناء تجهيز النقل.');
    await apiStore.importData(candidate);
    return { migrated: true, counts };
  } catch (error) {
    const reason = error instanceof MigrationError ? error.message : error?.status === 409 || error?.code === 'revision_conflict'
      ? 'تغيّرت بيانات المشروع من جلسة أخرى أثناء الحفظ.'
      : 'تعذّر التحقق من البيانات المحلية أو حفظها في الخادم.';
    return { migrated: false, warning: `${reason} بقيت النسخة المحلية القديمة محفوظة دون تغيير، ولم يُعد النقل تلقائيًا.` };
  }
}
