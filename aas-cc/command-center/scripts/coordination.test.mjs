import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, normalizeLiveState, mutateLiveState, createTaskResourceIndex } from '../server/state.mjs';
import { deriveCoordination } from '../server/coordination.mjs';

const observedAt = '2026-10-18T12:00:00.000Z';
const oldDate = '2026-10-15T12:00:00.000Z';
const newIds = ['agent-engineering', 'agent-quality', 'agent-automation'];
const transition = (state, operation, payload) => mutateLiveState(state, operation, payload);
const task = (id, patch = {}) => ({ id, title: 'مهمة fixture ' + id, description: 'سجل اختبار معزول، وليس مهمة إنتاج.', agentId: 'agent-catalog', workspaceId: 'ws-commerce', status: 'queued', priority: 'medium', dependencies: [], resourceKeys: [], createdAt: oldDate, updatedAt: oldDate, ...patch });
const stateWith = (...tasks) => normalizeLiveState({ ...initialLiveState(), tasks });

test('nine organizational profiles upgrade older projects once without replacing edits or manufacturing work', () => {
  const initial = initialLiveState();
  assert.equal(initial.agents.length, 9);
  assert.equal(initial.workspaces.length, 5);
  assert.equal(initial.coordinationVersion, 1);
  assert.deepEqual(initial.activity, []);
  assert.deepEqual(initial.tasks, []);
  assert.deepEqual(initial.runs, []);
  assert.ok(initial.agents.every((agent) => agent.model === 'غير متصل'));
  const older = structuredClone(initial);
  delete older.coordinationVersion;
  older.agents = older.agents.filter((agent) => !newIds.includes(agent.id));
  older.workspaces = older.workspaces.filter((workspace) => workspace.id !== 'ws-platform');
  older.agents.find((agent) => agent.id === 'agent-catalog').name = 'مسؤول المنتجات الذي سمّاه المستخدم';
  older.workspaces[0].notes.push({ id: 'preserved-note', body: 'ملاحظة فعلية محفوظة', createdAt: oldDate });
  older.agents.push({ ...older.agents[0], id: 'custom-profile', name: 'ملف مخصص' });
  older.workspaces.push({ ...older.workspaces[0], id: 'custom-team', name: 'فريق مخصص', agentIds: ['custom-profile'], notes: [] });
  older.tasks.push(task('preserved-task', { agentId: 'custom-profile', workspaceId: 'custom-team' }));
  delete older.tasks[0].updatedAt; delete older.tasks[0].dependencies; delete older.tasks[0].resourceKeys;
  const before = JSON.stringify(older);
  const upgraded = normalizeLiveState(older);
  assert.equal(JSON.stringify(older), before);
  assert.equal(upgraded.agents.length, 10);
  assert.equal(upgraded.workspaces.length, 6);
  assert.equal(upgraded.agents.find((agent) => agent.id === 'agent-catalog').name, 'مسؤول المنتجات الذي سمّاه المستخدم');
  assert.equal(upgraded.workspaces[0].notes[0].id, 'preserved-note');
  assert.equal(upgraded.tasks[0].agentId, 'custom-profile');
  assert.equal(upgraded.tasks[0].updatedAt, oldDate);
  assert.deepEqual(upgraded.tasks[0].dependencies, []);
  assert.deepEqual(upgraded.tasks[0].resourceKeys, []);
  assert.deepEqual(upgraded.activity, []);
  const deleted = transition(upgraded, 'deleteWorkspace', { id: 'ws-platform' }).state;
  assert.ok(!normalizeLiveState(deleted).workspaces.some((workspace) => workspace.id === 'ws-platform'));
});

test('dependencies form a DAG and prevent only related premature starts or dangling references', () => {
  const state = stateWith(task('first'), task('second', { dependencies: ['first'] }), task('third', { dependencies: ['second'] }), task('independent', { agentId: 'agent-marketing', workspaceId: 'ws-growth' }));
  const before = JSON.stringify(state);
  assert.throws(() => transition(state, 'updateTask', { id: 'first', patch: { dependencies: ['third'] } }), /دورة/);
  assert.throws(() => transition(state, 'updateTask', { id: 'second', patch: { dependencies: ['second'] } }), /المهمة نفسها/);
  assert.throws(() => transition(state, 'updateTask', { id: 'second', patch: { dependencies: ['missing'] } }), /غير موجود/);
  assert.throws(() => transition(state, 'updateTask', { id: 'second', patch: { dependencies: ['first', 'first'] } }), /لا تكرر/);
  assert.throws(() => transition(state, 'updateTask', { id: 'second', patch: { status: 'running' } }), /اعتماديات/);
  assert.throws(() => transition(state, 'updateTask', { id: 'second', patch: { status: 'done' } }), /الاعتماديات/);
  assert.throws(() => transition(state, 'deleteTask', { id: 'first' }), /غير موجود/);
  assert.equal(JSON.stringify(state), before);
  const other = transition(state, 'updateTask', { id: 'independent', patch: { status: 'running' } }).state;
  assert.equal(other.tasks.find((item) => item.id === 'independent').status, 'running');
  const completed = transition(other, 'updateTask', { id: 'first', patch: { status: 'done' } }).state;
  const started = transition(completed, 'updateTask', { id: 'second', patch: { status: 'running' } }).state;
  assert.equal(started.tasks.find((item) => item.id === 'second').status, 'running');
  assert.throws(() => transition(started, 'updateTask', { id: 'first', patch: { status: 'queued' } }), /الاعتماديات/);
});

test('resource paths have exclusive tracked ownership while unrelated paths and teams continue', () => {
  const state = stateWith(
    task('holder', { status: 'running', priority: 'high', resourceKeys: ['repo:owner/repo/app'] }),
    task('waiting', { agentId: 'agent-engineering', workspaceId: 'ws-platform', resourceKeys: ['repo:owner/repo/app/Main.kt'] }),
    task('independent', { agentId: 'agent-marketing', workspaceId: 'ws-growth', priority: 'low', resourceKeys: ['repo:owner/repo/marketing'] }),
    task('prefix-lookalike', { resourceKeys: ['repo:owner/repo/app2'] }),
  );
  const observed = deriveCoordination(state, { now: observedAt });
  assert.equal(observed.queue.find((item) => item.taskId === 'waiting').dispatchable, false);
  assert.deepEqual(observed.queue.find((item) => item.taskId === 'waiting').blockers[0].taskIds, ['holder']);
  assert.equal(observed.queue.find((item) => item.taskId === 'independent').dispatchable, true);
  assert.equal(observed.queue.find((item) => item.taskId === 'prefix-lookalike').dispatchable, true);
  assert.equal(observed.resourceLocks[0].taskId, 'holder');
  assert.throws(() => transition(state, 'updateTask', { id: 'waiting', patch: { status: 'running' } }), /مورد مشترك/);
  const parallel = transition(state, 'updateTask', { id: 'independent', patch: { status: 'running' } }).state;
  assert.equal(parallel.tasks.filter((item) => item.status === 'running').length, 2);
  const released = transition(parallel, 'updateTask', { id: 'holder', patch: { status: 'done' } }).state;
  assert.equal(transition(released, 'updateTask', { id: 'waiting', patch: { status: 'running' } }).state.tasks.find((item) => item.id === 'waiting').status, 'running');
  const index = createTaskResourceIndex([task('nested-holder', { status: 'running', resourceKeys: ['repo:owner/repo/app/Main.kt'] })]);
  assert.equal(index.conflicts(['repo:owner/repo/app'], 'other')[0].taskId, 'nested-holder');
  assert.deepEqual(index.conflicts(['repo:owner/repository/app'], 'other'), []);
});

test('queue ordering is deterministic and a blocked high priority cannot globally halt lower independent work', () => {
  const state = stateWith(
    task('dependency', { priority: 'low' }),
    task('high-blocked', { priority: 'high', dependencies: ['dependency'] }),
    task('high-ready', { priority: 'high' }),
    task('low-ready', { priority: 'low', agentId: 'agent-marketing', workspaceId: 'ws-growth' }),
  );
  const before = JSON.stringify(state);
  const result = deriveCoordination(state, { now: observedAt });
  assert.deepEqual(result.queue.map((item) => item.taskId), ['high-blocked', 'high-ready', 'dependency', 'low-ready']);
  assert.equal(result.queue.find((item) => item.taskId === 'low-ready').dispatchable, true);
  assert.equal(result.counts.ready, 3);
  assert.deepEqual(deriveCoordination(state, { now: observedAt }), result);
  assert.equal(JSON.stringify(state), before);
  assert.ok(result.graph.edges.some((edge) => edge.type === 'dependency' && edge.from === 'task:dependency' && edge.to === 'task:high-blocked'));
  assert.ok(result.graph.edges.some((edge) => edge.type === 'ownership' && edge.from === 'agent:agent-marketing' && edge.to === 'task:low-ready'));
  assert.equal(result.source, 'state-rules');
  assert.equal(result.automaticExecution, false);
});

test('paused profiles and workspaces affect only their lanes and never stop unrelated starts', () => {
  let state = stateWith(task('paused-owner', { agentId: 'agent-engineering', workspaceId: 'ws-platform' }), task('paused-team'), task('other-team', { agentId: 'agent-marketing', workspaceId: 'ws-growth' }));
  state = transition(state, 'updateAgent', { id: 'agent-engineering', patch: { status: 'paused' } }).state;
  state = transition(state, 'updateWorkspace', { id: 'ws-commerce', patch: { status: 'paused' } }).state;
  assert.throws(() => transition(state, 'updateTask', { id: 'paused-owner', patch: { status: 'running' } }), /الوكيل المسؤول/);
  assert.throws(() => transition(state, 'updateTask', { id: 'paused-team', patch: { status: 'running' } }), /مساحة هذه المهمة/);
  const continued = transition(state, 'updateTask', { id: 'other-team', patch: { status: 'running' } }).state;
  assert.equal(continued.tasks.find((item) => item.id === 'other-team').status, 'running');
  assert.equal(continued.tasks.find((item) => item.id === 'paused-team').status, 'queued');
});

test('individual readiness does not promise parallel access to a resource that has no current holder', () => {
  const state = stateWith(task('first-candidate', { resourceKeys: ['repo:owner/repo/shared'] }), task('second-candidate', { agentId: 'agent-engineering', workspaceId: 'ws-platform', resourceKeys: ['repo:owner/repo/shared/file.ts'] }));
  const before = deriveCoordination(state, { now: observedAt });
  assert.equal(before.counts.ready, 2);
  assert.deepEqual(before.resourceLocks, []);
  assert.equal(before.advisors.find((advisor) => advisor.id === 'multi-lane-ready').basis.reservation, 'on-task-start');
  assert.ok(!before.advisors.some((advisor) => advisor.id === 'independent-lanes-ready'));
  const started = transition(state, 'updateTask', { id: 'first-candidate', patch: { status: 'running' } }).state;
  const after = deriveCoordination(started, { now: observedAt });
  assert.equal(after.queue.find((item) => item.taskId === 'second-candidate').dispatchable, false);
  assert.throws(() => transition(started, 'updateTask', { id: 'second-candidate', patch: { status: 'running' } }), /مورد مشترك/);
});

test('a failed workflow remains gated while independent tasks and other flow lanes remain ready', () => {
  let state = stateWith(task('independent-work'));
  const started = transition(state, 'startWorkflow', { title: 'سير fixture متوقف', sourceRevision: 'a'.repeat(40), steps: [{ title: 'خطوة أولى' }, { title: 'خطوة ثانية' }] });
  const workflow = started.result;
  state = transition(started.state, 'recordWorkflowAnalysis', { workflowId: workflow.id, stepId: workflow.steps[0].id, sourceRevision: workflow.sourceRevision, outcome: 'blocked', summary: 'دليل المصدر غير متاح في هذا الاختبار.', evidence: [{ kind: 'log', label: 'عائق fixture', content: 'No source was available; no change or test was executed.' }] }).state;
  const observed = deriveCoordination(state, { now: observedAt });
  assert.equal(observed.lanes.find((lane) => lane.workflowId === workflow.id).status, 'blocked');
  assert.equal(observed.queue.find((item) => item.taskId === 'independent-work').dispatchable, true);
  assert.equal(observed.counts.blockedWorkflows, 1);
  assert.ok(observed.advisors.some((advisor) => advisor.id === 'workflow-gates' && advisor.targets.workflowIds[0] === workflow.id));
  assert.ok(observed.graph.edges.some((edge) => edge.type === 'workflow-order' && edge.from === 'step:' + workflow.steps[0].id && edge.to === 'step:' + workflow.steps[1].id));
  assert.equal(state.workflows[0].steps[1].status, 'pending');
  assert.deepEqual(state.runs, []);
});

test('advisors cite actual age, workload, connectivity and explicit capability metadata without claiming AI output', () => {
  let state = stateWith(...Array.from({ length: 4 }, (_, index) => task('owner-task-' + index)));
  const configured = transition(state, 'addServer', { name: 'خادم fixture', baseUrl: 'https://store.example.com' });
  state = transition(configured.state, 'recordServerHealth', { id: configured.result.id, status: 'offline', lastCheckedAt: oldDate, lastHttpStatus: 503, latencyMs: 12, lastError: 'Fixture offline receipt' }).state;
  const observed = deriveCoordination(state, { now: observedAt, capabilities: { aiConfigured: false, runnerReceiptConfigured: false } });
  assert.equal(observed.advisors.find((advisor) => advisor.id === 'stale-tasks').basis.count, 4);
  assert.equal(observed.advisors.find((advisor) => advisor.id === 'owner-load:agent-catalog').basis.unfinished, 4);
  assert.ok(observed.advisors.some((advisor) => advisor.id === 'model-provider-missing'));
  assert.ok(observed.advisors.some((advisor) => advisor.id === 'runner-not-configured'));
  assert.equal(observed.advisors.find((advisor) => advisor.id === 'server-offline:' + configured.result.id).basis.lastHttpStatus, 503);
  const action = observed.advisors.find((advisor) => advisor.id === 'stale-tasks').actions.find((action) => action.type === 'update-task');
  const applied = transition(state, 'updateTask', { id: action.taskId, patch: action.patch }).state;
  assert.equal(applied.tasks.find((item) => item.id === action.taskId).priority, 'high');
  const unknown = deriveCoordination(state, { now: observedAt });
  assert.ok(!unknown.advisors.some((advisor) => advisor.id === 'model-provider-missing'));
  const present = deriveCoordination(state, { now: observedAt, capabilities: { aiConfigured: true, runnerReceiptConfigured: true } });
  assert.ok(!present.advisors.some((advisor) => ['model-provider-missing', 'runner-not-configured'].includes(advisor.id)));
  assert.ok(present.organization.agents.every((agent) => agent.model === 'غير متصل'));
});

test('import cannot bypass dependency cycles or overlapping running resources', () => {
  const state = stateWith(task('a'), task('b'));
  const cyclic = structuredClone(state); cyclic.tasks[0].dependencies = ['b']; cyclic.tasks[1].dependencies = ['a'];
  assert.throws(() => transition(state, 'importData', { data: cyclic }), /دورة/);
  const collision = structuredClone(state);
  collision.tasks.forEach((item) => { item.status = 'running'; item.resourceKeys = ['db:inventory/products']; });
  assert.throws(() => transition(state, 'importData', { data: collision }), /المورد نفسه/);
  assert.throws(() => transition(state, 'updateTask', { id: 'a', patch: { resourceKeys: ['repo:owner/repo/../secret'] } }), /المجلد الأب/);
  assert.deepEqual(state.tasks.map((item) => item.status), ['queued', 'queued']);
});
