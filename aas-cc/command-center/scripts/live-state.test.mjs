import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, normalizeLiveState, mutateLiveState, normalizeServerBaseUrl, normalizeServerPath } from '../server/state.mjs';

const taskInput = (patch = {}) => ({ title: 'مراجعة منتج حقيقي', description: 'سياق المهمة', agentId: 'agent-catalog', workspaceId: 'ws-commerce', ...patch });
const transition = (state, operation, payload) => mutateLiveState(state, operation, payload);

test('live initialization includes organizational profiles without simulated work or connections', () => {
  const state = initialLiveState();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.demoMode, false);
  for (const name of ['tasks', 'approvals', 'activity', 'servers', 'runs']) assert.deepEqual(state[name], []);
  assert.ok(state.workspaces.every((workspace) => workspace.notes.length === 0));
  assert.ok(state.agents.every((agent) => agent.model === 'غير متصل'));
  assert.deepEqual(state.commerce, { deviceId: null, appVersion: null, products: [], orders: [], receivedAt: null });
  assert.deepEqual(normalizeLiveState(state), state);
  state.agents[0].name = 'تغيير منفصل';
  assert.notEqual(initialLiveState().agents[0].name, state.agents[0].name);
});

test('tasks require workspace membership and failed edits leave input snapshots unchanged', () => {
  const state = initialLiveState();
  const before = JSON.stringify(state);
  assert.throws(() => transition(state, 'addTask', taskInput({ agentId: 'agent-marketing' })), /فريق مساحة/);
  assert.equal(JSON.stringify(state), before);
  const added = transition(state, 'addTask', taskInput({ title: '  عنوان جديد  ' }));
  assert.equal(added.result.title, 'عنوان جديد');
  assert.equal(added.result.status, 'queued');
  assert.equal(state.tasks.length, 0);
  const saved = JSON.stringify(added.state);
  assert.throws(() => transition(added.state, 'updateTask', { id: added.result.id, patch: { workspaceId: 'ws-growth' } }), /فريق مساحة/);
  assert.throws(() => transition(added.state, 'updateWorkspace', { id: 'ws-commerce', patch: { agentIds: ['agent-orchestrator'] } }), /فريق مساحة/);
  assert.throws(() => transition(added.state, 'deleteWorkspace', { id: 'ws-commerce' }), /انقل مهام/);
  assert.equal(JSON.stringify(added.state), saved);
});

test('review generates one pending request and prevents task edits or deletion before the decision', () => {
  const created = transition(initialLiveState(), 'addTask', taskInput({ status: 'review' }));
  assert.equal(created.state.approvals.length, 1);
  const request = created.state.approvals[0];
  assert.equal(request.taskId, created.result.id);
  assert.equal(request.status, 'pending');
  const before = JSON.stringify(created.state);
  assert.throws(() => transition(created.state, 'updateTask', { id: created.result.id, patch: { status: 'done' } }), /الموافقة المعلقة/);
  assert.throws(() => transition(created.state, 'updateTask', { id: created.result.id, patch: { description: 'changed input' } }), /الموافقة المعلقة/);
  assert.throws(() => transition(created.state, 'deleteTask', { id: created.result.id }), /الموافقة المعلقة/);
  assert.equal(JSON.stringify(created.state), before);
  const approved = transition(created.state, 'resolveApproval', { id: request.id, decision: 'approved' });
  assert.equal(approved.state.tasks[0].status, 'queued');
  assert.equal(approved.result.status, 'approved');
  assert.ok(approved.result.decidedAt);
  assert.equal(approved.state.runs.length, 0);
  assert.throws(() => transition(approved.state, 'resolveApproval', { id: request.id, decision: 'rejected' }), /مسبقًا/);
  const completed = transition(approved.state, 'updateTask', { id: created.result.id, patch: { status: 'done' } });
  assert.equal(completed.state.tasks[0].status, 'done');
});

test('rejected review can be revised and resubmitted without reusing the decided request', () => {
  const created = transition(initialLiveState(), 'addTask', taskInput({ status: 'review' }));
  const rejected = transition(created.state, 'resolveApproval', { id: created.state.approvals[0].id, decision: 'rejected' });
  assert.equal(rejected.state.tasks[0].status, 'review');
  const resubmitted = transition(rejected.state, 'updateTask', { id: created.result.id, patch: { description: 'مسودة مصححة', status: 'review' } });
  assert.equal(resubmitted.state.approvals.length, 2);
  assert.equal(resubmitted.state.approvals.filter((a) => a.status === 'pending').length, 1);
  assert.equal(resubmitted.state.approvals[0].description, 'مسودة مصححة');
  assert.notEqual(resubmitted.state.approvals[0].id, created.state.approvals[0].id);
  const duplicate = structuredClone(resubmitted.state);
  duplicate.approvals.push({ ...duplicate.approvals[0], id: 'approval-duplicate' });
  assert.throws(() => normalizeLiveState(duplicate), /واحدة فقط/);
});

test('API definitions reject unsafe targets and never accept health status supplied through CRUD', () => {
  for (const url of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://2130706433', 'https://service.local', 'https://x.internal', 'https://user:secret@example.com', 'https://example.com?token=secret']) {
    assert.throws(() => normalizeServerBaseUrl(url), undefined, url);
  }
  for (const path of ['https://example.com', '//other.example', '/api/../secret', '/%2e%2e/secret', '/health?key=secret', '/health#fragment']) assert.throws(() => normalizeServerPath(path));
  assert.equal(normalizeServerBaseUrl('https://api.example.com/api/'), 'https://api.example.com/api');
  const registered = transition(initialLiveState(), 'addServer', { name: 'خادم المتجر', baseUrl: 'https://store.example.com', tokenEnv: 'AAS_STORE_TOKEN', status: 'online', lastCheckedAt: new Date().toISOString(), lastError: 'forged' });
  assert.equal(registered.result.status, 'unverified');
  assert.equal(registered.result.lastCheckedAt, null);
  assert.equal(registered.result.lastError, null);
  assert.throws(() => transition(initialLiveState(), 'addServer', { name: 'خادم', baseUrl: 'https://example.com', tokenEnv: 'sk-secret-key' }), /مرجع السر/);
  const checked = transition(registered.state, 'recordServerHealth', { id: registered.result.id, status: 'online', lastCheckedAt: new Date().toISOString(), lastHttpStatus: 200, latencyMs: 48 });
  assert.equal(checked.result.status, 'online');
  assert.equal(checked.result.lastHttpStatus, 200);
  const updated = transition(checked.state, 'updateServer', { id: registered.result.id, patch: { healthPath: '/api/health', status: 'online' } });
  assert.equal(updated.result.status, 'unverified');
  assert.equal(updated.result.lastHttpStatus, null);
});

test('import keeps server audit history, invalidates imported health and cannot forge automated runs', () => {
  const saved = transition(initialLiveState(), 'addTask', taskInput());
  const configured = transition(initialLiveState(), 'addServer', { name: 'خادم', baseUrl: 'https://store.example.com' });
  const online = transition(configured.state, 'recordServerHealth', { id: configured.result.id, status: 'online', lastCheckedAt: new Date().toISOString(), lastHttpStatus: 200, latencyMs: 3 });
  const incoming = structuredClone(online.state);
  incoming.agents[0].model = 'pretend-connected-model';
  incoming.activity = [{ id: 'activity-forged', title: 'forged event', description: '', type: 'system', createdAt: new Date().toISOString() }];
  const restored = transition(saved.state, 'importData', { data: JSON.stringify(incoming) });
  assert.equal(restored.state.servers[0].status, 'unverified');
  assert.equal(restored.state.servers[0].lastCheckedAt, null);
  assert.equal(restored.state.agents[0].model, 'غير متصل');
  assert.ok(restored.state.activity.some((event) => event.id === saved.state.activity[0].id));
  assert.ok(!restored.state.activity.some((event) => event.id === 'activity-forged'));
  incoming.runs = [{ id: 'run-forged', status: 'done' }];
  assert.throws(() => transition(saved.state, 'importData', { data: incoming }), /خدمة تنفيذ فعلية/);
  assert.throws(() => transition(saved.state, 'importData', { data: { ...initialLiveState(), schemaVersion: 1, demoMode: true } }), /التجريبي/);
});

test('notes, settings, agent profiles and delete operations are validated and durable snapshots stay detached', () => {
  let state = initialLiveState();
  const workspace = transition(state, 'addWorkspace', { name: 'تطوير التطبيق', agentIds: ['agent-catalog'] });
  state = workspace.state;
  state = transition(state, 'addNote', { workspaceId: workspace.result.id, body: '  ملاحظة مشتركة  ' }).state;
  assert.equal(state.workspaces.find((w) => w.id === workspace.result.id).notes[0].body, 'ملاحظة مشتركة');
  const old = JSON.stringify(state);
  assert.throws(() => transition(state, 'updateSettings', { timezone: 'Incorrect/Zone' }));
  assert.throws(() => transition(state, 'updateAgent', { id: 'agent-catalog', patch: { status: 'running' } }));
  assert.equal(JSON.stringify(state), old);
  const changed = transition(state, 'updateAgent', { id: 'agent-catalog', patch: { name: 'مسؤول المنتجات', model: 'forged-connected' } });
  assert.equal(changed.result.model, 'غير متصل');
  changed.result.name = 'mutated outside';
  assert.equal(changed.state.agents.find((a) => a.id === 'agent-catalog').name, 'مسؤول المنتجات');
  const deleted = transition(state, 'deleteWorkspace', { id: workspace.result.id });
  assert.ok(!deleted.state.workspaces.some((w) => w.id === workspace.result.id));
  assert.equal(deleted.result.deleted, true);
});

test('reset removes live records without adding examples or removing server definitions and audit', () => {
  const task = transition(initialLiveState(), 'addTask', taskInput());
  const server = transition(task.state, 'addServer', { name: 'API', baseUrl: 'https://store.example.com' });
  const reset = transition(server.state, 'reset');
  assert.deepEqual(reset.state.tasks, []);
  assert.deepEqual(reset.state.approvals, []);
  assert.deepEqual(reset.state.runs, []);
  assert.equal(reset.state.servers[0].id, server.result.id);
  assert.ok(reset.state.activity.some((a) => a.id === task.state.activity[0].id));
});

// These fixtures are submitted only by tests; initial live records remain empty.
const appSnapshotFixture = () => ({
  deviceId: 'test-installation-01', appVersion: '1.2.3-test', receivedAt: '2026-10-12T12:34:56.000Z',
  products: [{ id: 41, name: 'منتج الاختبار', category: 'اختبارات', retailPrice: 19.5, wholesalePrice: 12, imageUrl: 'https://images.example.com/test-product.png', stockQuantity: 8, merchantName: 'تاجر الاختبار', description: 'extra field', paymentToken: 'must-not-be-retained' }],
  orders: [{ id: 72, productId: 41, productName: 'منتج الاختبار', quantity: 2, totalPrice: 39, status: 'Pending', createdAt: 1791806400000, customerId: 7, customerName: 'must-not-be-retained', cardNumber: 'must-not-be-retained', routeAddress: 'must-not-be-retained' }],
});

test('trusted app snapshots retain real receipt metadata and only bounded commerce fields', () => {
  const before = initialLiveState();
  const snapshot = appSnapshotFixture();
  const received = transition(before, 'recordAppSnapshot', snapshot);
  assert.equal(before.commerce.receivedAt, null);
  assert.equal(received.result.receivedAt, snapshot.receivedAt);
  assert.equal(received.state.commerce.deviceId, snapshot.deviceId);
  assert.equal(received.state.commerce.appVersion, snapshot.appVersion);
  assert.equal(received.state.commerce.orders[0].id, '72');
  assert.equal(received.state.commerce.orders[0].createdAt, new Date(snapshot.orders[0].createdAt).toISOString());
  assert.deepEqual(Object.keys(received.state.commerce.products[0]), ['id', 'name', 'category', 'retailPrice', 'wholesalePrice', 'imageUrl', 'stockQuantity', 'merchantName']);
  assert.deepEqual(Object.keys(received.state.commerce.orders[0]), ['id', 'productId', 'productName', 'quantity', 'totalPrice', 'status', 'createdAt']);
  assert.ok(!JSON.stringify(received.state).includes('must-not-be-retained'));
  assert.equal(received.state.activity[0].type, 'app-sync');
  assert.equal(received.state.runs.length, 0);
  received.result.products[0].name = 'outside mutation';
  assert.equal(received.state.commerce.products[0].name, 'منتج الاختبار');
  const withIsoDates = appSnapshotFixture();
  withIsoDates.orders[0].id = 'order-test-72';
  withIsoDates.orders[0].createdAt = '2026-10-12T12:00:00+03:00';
  withIsoDates.products[0].imageUrl = null;
  const normalized = transition(before, 'recordAppSnapshot', withIsoDates).state.commerce;
  assert.equal(normalized.orders[0].id, 'order-test-72');
  assert.equal(normalized.orders[0].createdAt, '2026-10-12T09:00:00.000Z');
  assert.equal(normalized.products[0].imageUrl, '');
});

test('invalid or oversized app snapshots cannot partially replace saved commerce', () => {
  const valid = transition(initialLiveState(), 'recordAppSnapshot', appSnapshotFixture()).state;
  const unchanged = JSON.stringify(valid);
  const invalidCases = [
    (s) => { s.deviceId = ''; },
    (s) => { s.receivedAt = 'not-a-date'; },
    (s) => { s.products[0].id = 0; },
    (s) => { s.products[0].id = 2147483648; },
    (s) => { s.products[0].stockQuantity = 1.5; },
    (s) => { s.products[0].retailPrice = Infinity; },
    (s) => { s.products[0].wholesalePrice = -1; },
    (s) => { s.products[0].imageUrl = 'http://images.example.com/product.png'; },
    (s) => { s.orders[0].quantity = 0; },
    (s) => { s.orders[0].totalPrice = -1; },
    (s) => { s.orders[0].createdAt = 1.5; },
    (s) => { s.products.push({ ...s.products[0] }); },
    (s) => { s.orders.push({ ...s.orders[0], id: String(s.orders[0].id) }); },
    (s) => { s.products = Array.from({ length: 1001 }, (_, i) => ({ ...s.products[0], id: i + 1 })); },
    (s) => { s.orders = Array.from({ length: 1001 }, (_, i) => ({ ...s.orders[0], id: i + 1 })); },
  ];
  for (const invalidate of invalidCases) {
    const invalid = appSnapshotFixture();
    invalidate(invalid);
    assert.throws(() => transition(valid, 'recordAppSnapshot', invalid));
    assert.equal(JSON.stringify(valid), unchanged);
  }
});

test('import and reset preserve actual app receipts and older v2 state gains empty commerce', () => {
  const olderState = initialLiveState();
  delete olderState.commerce;
  assert.deepEqual(normalizeLiveState(olderState).commerce, initialLiveState().commerce);
  const received = transition(olderState, 'recordAppSnapshot', appSnapshotFixture());
  const incoming = initialLiveState();
  incoming.commerce = { ...received.state.commerce, deviceId: 'forged-installation', appVersion: 'forged-version', receivedAt: '2030-01-01T00:00:00.000Z' };
  const restored = transition(received.state, 'importData', { data: incoming });
  assert.deepEqual(restored.state.commerce, received.state.commerce);
  assert.ok(restored.state.activity.some((event) => event.id === received.state.activity[0].id));
  const reset = transition(restored.state, 'reset');
  assert.deepEqual(reset.state.commerce, received.state.commerce);
  assert.equal(reset.state.tasks.length, 0);
  assert.equal(reset.state.runs.length, 0);
});
