/** Deterministic observations of organizational records, never an AI execution.
 * Task locks concern declared paths in tracked work. Runner isolation and real
 * external execution remain separate authenticated capabilities.
 */
import { normalizeLiveState, createTaskResourceIndex, getTaskBlockers } from './state.mjs';

const priorityOrder = { high: 0, medium: 1, low: 2 };
const activeStatuses = new Set(['queued', 'running', 'review']);
const countWork = (tasks) => ({ queued: tasks.filter((task) => task.status === 'queued').length, running: tasks.filter((task) => task.status === 'running').length, review: tasks.filter((task) => task.status === 'review').length, done: tasks.filter((task) => task.status === 'done').length, total: tasks.length });
const taskSort = (left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id, 'en');
const targets = (patch = {}) => ({ taskIds: [], workflowIds: [], agentIds: [], serverIds: [], ...patch });
const navigate = (route, id, label) => ({ type: 'navigate', route, ...(id ? { id } : {}), label });

export function deriveCoordination(input, { now = Date.now(), capabilities = {} } = {}) {
  const state = normalizeLiveState(input);
  const observation = new Date(typeof now === 'function' ? now() : now);
  if (!Number.isFinite(observation.getTime())) { const error = new Error('توقيت لوحة التنسيق غير صالح.'); error.status = 422; error.code = 'INVALID_STATE'; throw error; }
  const generatedAt = observation.toISOString();
  const resources = createTaskResourceIndex(state.tasks);
  const queue = state.tasks.filter((task) => task.status !== 'done').sort(taskSort).map((task) => {
    const blockers = getTaskBlockers(state, task, resources);
    return { taskId: task.id, title: task.title, agentId: task.agentId, workspaceId: task.workspaceId, priority: task.priority, status: task.status, dependencies: [...task.dependencies], resourceKeys: [...task.resourceKeys], createdAt: task.createdAt, updatedAt: task.updatedAt, dispatchable: task.status === 'queued' && blockers.length === 0, blockers };
  });
  const queueById = new Map(queue.map((task) => [task.taskId, task]));
  const manager = state.agents.find((agent) => agent.id === 'agent-orchestrator')?.id ?? null;
  const agents = state.agents.map((agent) => {
    const workspaceIds = state.workspaces.filter((workspace) => workspace.agentIds.includes(agent.id)).map((workspace) => workspace.id);
    return { id: agent.id, name: agent.name, role: agent.role, status: agent.status, model: agent.model, initials: agent.initials, color: agent.color, managerAgentId: agent.id === manager ? null : manager, workspaceIds, teamIds: workspaceIds, workload: countWork(state.tasks.filter((task) => task.agentId === agent.id)) };
  });
  const organization = { id: 'amer-ai-store', name: state.settings.storeName, managerAgentId: manager, agents, teams: state.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, status: workspace.status, memberAgentIds: [...workspace.agentIds] })) };
  const lanes = state.workspaces.map((workspace) => {
    const tasks = state.tasks.filter((task) => task.workspaceId === workspace.id);
    return { id: 'workspace:' + workspace.id, kind: 'workspace', title: workspace.name, status: workspace.status, workspaceId: workspace.id, taskIds: tasks.map((task) => task.id), readyTaskIds: tasks.filter((task) => queueById.get(task.id)?.dispatchable).sort(taskSort).map((task) => task.id), blockedTaskIds: tasks.filter((task) => task.status !== 'done' && queueById.get(task.id)?.blockers.length).map((task) => task.id), runningTaskIds: tasks.filter((task) => task.status === 'running').map((task) => task.id) };
  });
  for (const workflow of state.workflows) {
    const step = workflow.steps[workflow.currentStepIndex];
    lanes.push({ id: 'workflow:' + workflow.id, kind: 'workflow', title: workflow.title, status: workflow.status, workflowId: workflow.id, taskIds: [], readyTaskIds: [], blockedTaskIds: [], runningTaskIds: [], currentStepId: step.id, phase: step.phase, gate: { stepIndex: workflow.currentStepIndex, stepCount: workflow.steps.length, status: step.status, provenance: step.verification?.provenance ?? step.change?.provenance ?? step.analysis?.provenance ?? null } });
  }
  const nodes = agents.map((agent) => ({ id: 'agent:' + agent.id, type: 'agent', entityId: agent.id, label: agent.name, status: agent.status }));
  const edges = [];
  const edgeIds = new Set();
  const addEdge = (from, to, type) => { const id = type + ':' + from + '->' + to; if (!edgeIds.has(id)) { edgeIds.add(id); edges.push({ id, from, to, type }); } };
  for (const task of state.tasks) {
    const observed = queueById.get(task.id);
    nodes.push({ id: 'task:' + task.id, type: 'task', entityId: task.id, label: task.title, status: task.status, priority: task.priority, agentId: task.agentId, workspaceId: task.workspaceId, dispatchable: observed?.dispatchable ?? false, blockerCodes: observed?.blockers.map((blocker) => blocker.code) ?? [] });
    addEdge('agent:' + task.agentId, 'task:' + task.id, 'ownership');
    for (const dependency of task.dependencies) addEdge('task:' + dependency, 'task:' + task.id, 'dependency');
    for (const blocker of observed?.blockers ?? []) if (blocker.code === 'resource_busy') for (const holder of blocker.taskIds) addEdge('task:' + holder, 'task:' + task.id, 'resource-wait');
  }
  for (const workflow of state.workflows) {
    nodes.push({ id: 'workflow:' + workflow.id, type: 'workflow', entityId: workflow.id, label: workflow.title, status: workflow.status });
    workflow.steps.forEach((step, index) => {
      nodes.push({ id: 'step:' + step.id, type: 'workflow-step', entityId: step.id, label: step.title, status: step.status, phase: step.phase, workflowId: workflow.id });
      addEdge('workflow:' + workflow.id, 'step:' + step.id, 'contains');
      if (index > 0) addEdge('step:' + workflow.steps[index - 1].id, 'step:' + step.id, 'workflow-order');
    });
  }

  const advisors = [];
  const add = (id, category, severity, title, description, scope, actions, basis) => advisors.push({ id, category, severity, title, description, targets: targets(scope), actions, basis });
  const stale = state.tasks.filter((task) => activeStatuses.has(task.status) && observation.getTime() - Date.parse(task.updatedAt) >= 48 * 60 * 60 * 1000).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.id.localeCompare(b.id, 'en'));
  if (stale.length) {
    const oldest = stale[0];
    const pending = state.approvals.some((approval) => approval.taskId === oldest.id && approval.status === 'pending');
    const actions = [navigate('tasks', oldest.id, 'مراجعة المهمة الأقدم')];
    if (oldest.status === 'queued' && oldest.priority !== 'high' && !pending) actions.push({ type: 'update-task', taskId: oldest.id, patch: { priority: 'high' }, label: 'اقتراح رفع الأولوية' });
    add('stale-tasks', 'freshness', 'warning', 'مهام لم تُحدّث منذ يومين', `توجد ${stale.length} مهام غير مكتملة بلا تحديث مسجل منذ 48 ساعة أو أكثر. راجع سياقها قبل تغيير أولويتها.`, { taskIds: stale.map((task) => task.id) }, actions, { count: stale.length, oldestUpdatedAt: oldest.updatedAt, thresholdHours: 48 });
  }
  for (const agent of agents) {
    const unfinished = agent.workload.queued + agent.workload.running + agent.workload.review;
    if (unfinished >= 4 || agent.workload.running >= 2) add('owner-load:' + agent.id, 'ownership', 'warning', 'راجع توزيع العمل على ' + agent.name, `هذا الملف مسؤول عن ${unfinished} مهام غير مكتملة، منها ${agent.workload.running} قيد العمل. هذا توزيع مهام مسجل، وليس قياسًا لاستهلاك نموذج.`, { agentIds: [agent.id], taskIds: state.tasks.filter((task) => task.agentId === agent.id && task.status !== 'done').map((task) => task.id) }, [navigate('agents', agent.id, 'مراجعة ملف المسؤول')], { unfinished, running: agent.workload.running, threshold: 4 });
  }
  const dependencyWait = queue.filter((task) => task.blockers.some((blocker) => blocker.code === 'dependency_not_done'));
  if (dependencyWait.length) add('waiting-dependencies', 'dependencies', 'info', 'اعتماديات محددة تنتظر الإنجاز', `${dependencyWait.length} مهام تنتظر إنجاز اعتمادياتها المحددة؛ بقية المهام المستقلة لا تتوقف بسببها.`, { taskIds: dependencyWait.map((task) => task.taskId) }, [navigate('orchestration', null, 'عرض الاعتماديات')], { count: dependencyWait.length });
  const resourceWait = queue.filter((task) => task.blockers.some((blocker) => blocker.code === 'resource_busy'));
  if (resourceWait.length) add('resource-contention', 'resources', 'warning', 'تنسيق الوصول إلى موارد مشتركة', `${resourceWait.length} مهام تنتظر مسارات مستخدمة حاليًا. حرر المورد بعد انتهاء العمل أو ضيّق نطاق المسار؛ لا يلزم إيقاف جميع المسارات.`, { taskIds: resourceWait.map((task) => task.taskId) }, [navigate('orchestration', null, 'عرض ملكية الموارد')], { count: resourceWait.length, locks: resources.locks.length });
  const gated = state.workflows.filter((workflow) => ['blocked', 'failed'].includes(workflow.status));
  if (gated.length) add('workflow-gates', 'verification', 'critical', 'بوابات تحتاج معالجة في مساراتها', `${gated.length} مسارات تنفيذ لها مرحلة متوقفة أو فاشلة. تبقى بواباتها مقفلة، وتستمر المسارات الأخرى المستقلة.`, { workflowIds: gated.map((workflow) => workflow.id) }, [navigate('execution', gated[0].id, 'مراجعة البوابة المتوقفة')], { count: gated.length, states: gated.map((workflow) => ({ id: workflow.id, status: workflow.status, phase: workflow.steps[workflow.currentStepIndex].phase })) });
  const offline = state.servers.filter((server) => server.enabled && server.status === 'offline');
  for (const server of offline) add('server-offline:' + server.id, 'connections', 'warning', 'تعذر آخر فحص للخادم ' + server.name, 'آخر فحص مسجل غير ناجح. أعد الفحص بعد مراجعة الاتصال والمصادقة؛ لا يُعد ذلك توقفًا لجميع المسارات.', { serverIds: [server.id] }, [{ type: 'check-server', serverId: server.id, label: 'إعادة فحص الخادم' }], { status: server.status, lastCheckedAt: server.lastCheckedAt, lastHttpStatus: server.lastHttpStatus });
  const unverified = state.servers.filter((server) => server.enabled && server.status === 'unverified');
  if (unverified.length) add('servers-unverified', 'connections', 'info', 'خوادم تحتاج فحص الاتصال الأول', 'إعداد عنوان API لا يثبت نجاح الاتصال. افحص الخوادم المضافة قبل الاعتماد على بياناتها.', { serverIds: unverified.map((server) => server.id) }, [{ type: 'check-server', serverId: unverified[0].id, label: 'فحص الخادم' }], { count: unverified.length });
  if (capabilities.aiConfigured === false) add('model-provider-missing', 'capabilities', 'info', 'مزود المساعد الذكي غير مهيّأ', 'المساعد القائم على نموذج يحتاج إعداد مزود فعلي على الخادم. هذه التوصيات محسوبة من السجلات ولا تدّعي استجابة نموذج.', {}, [navigate('settings', null, 'مراجعة التكاملات')], { aiConfigured: false });
  if (capabilities.runnerReceiptConfigured === false) add('runner-not-configured', 'capabilities', 'info', 'استقبال إيصالات منفذ الشيفرة غير مهيّأ', 'ملفات الوكلاء التسعة تنظيمية؛ لا تثبت تشغيل تسعة نماذج أو تنفيذ تعديلات وفحوص آلية.', {}, [navigate('execution', null, 'مراجعة إعداد المنفّذ')], { runnerReceiptConfigured: false });
  if (!state.commerce.receivedAt) add('app-snapshot-missing', 'data', 'info', 'لم تصل لقطة من التطبيق بعد', 'لا توجد منتجات أو طلبات متزامنة مثبتة بالاستلام. صِل التطبيق أو جسر قاعدة البيانات ثم تحقق من وقت الاستلام.', {}, [navigate('settings', null, 'إعداد اتصال البيانات')], { receivedAt: null, products: state.commerce.products.length, orders: state.commerce.orders.length });
  const readyLanes = lanes.filter((lane) => lane.readyTaskIds.length);
  if (readyLanes.length > 1) add('multi-lane-ready', 'resources', 'info', 'مهام جاهزة حاليًا في أكثر من مسار', `${readyLanes.length} مسارات لها مهام جاهزة كلٌّ على حدة وفق الحالة الحالية. قد تتنافس المهام المنتظرة على مورد واحد؛ تُفحص الملكية مجددًا عند بدء كل مهمة، دون توقف عام.`, { taskIds: readyLanes.flatMap((lane) => lane.readyTaskIds) }, [navigate('orchestration', null, 'عرض المهام الجاهزة')], { lanes: readyLanes.map((lane) => lane.id), ready: queue.filter((task) => task.dispatchable).length, reservation: 'on-task-start' });
  const severity = { critical: 0, warning: 1, info: 2 };
  advisors.sort((a, b) => severity[a.severity] - severity[b.severity] || a.id.localeCompare(b.id, 'en'));
  return {
    generatedAt, source: 'state-rules', automaticExecution: false, organization, lanes, queue,
    resourceLocks: resources.locks.sort((a, b) => a.key.localeCompare(b.key, 'en') || a.taskId.localeCompare(b.taskId, 'en')),
    graph: { nodes, edges }, advisors, recentActivity: state.activity.slice(0, 20),
    counts: { agents: agents.length, teams: organization.teams.length, tasks: state.tasks.length, queued: queue.filter((task) => task.status === 'queued').length, running: queue.filter((task) => task.status === 'running').length, ready: queue.filter((task) => task.dispatchable).length, waiting: queue.filter((task) => task.status === 'queued' && task.blockers.length).length, workflows: state.workflows.length, blockedWorkflows: gated.length, resourceLocks: resources.locks.length },
  };
}
