import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the browser ES module without requiring a Node package.json.
const source = await readFile(new URL('../dist/store.js', import.meta.url), 'utf8');
const { createStore, seedState, STORAGE_KEY } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('snapshots and mutation results cannot alter persisted project state', () => {
  const storage = memoryStorage();
  const store = createStore({ storage });
  const snapshot = store.getState();
  snapshot.tasks[0].title = 'unexpected mutation';
  assert.notEqual(store.getState().tasks[0].title, 'unexpected mutation');
  const task = store.addTask({ title: '  مهمة اختبار  ', agentId: snapshot.agents[0].id, workspaceId: snapshot.workspaces[0].id });
  assert.equal(task.title, 'مهمة اختبار');
  task.title = 'unexpected result mutation';
  const reopened = createStore({ storage });
  assert.equal(reopened.getState().tasks.find((item) => item.id === task.id).title, 'مهمة اختبار');
  assert.equal(reopened.getState().tasks.find((item) => item.id === task.id).status, 'queued');
});

test('approval decisions change the linked local task and cannot be repeated', () => {
  const store = createStore({ storage: memoryStorage() });
  store.resolveApproval('approval-1', 'approved');
  assert.equal(store.getState().tasks.find((task) => task.id === 'task-2').status, 'queued');
  assert.equal(store.getState().approvals[0].status, 'approved');
  assert.equal(store.getState().activity[0].type, 'approval');
  const before = store.exportData();
  assert.throws(() => store.resolveApproval('approval-1', 'rejected'));
  assert.equal(store.exportData(), before);
  store.resolveApproval('approval-2', 'rejected');
  assert.equal(store.getState().tasks.find((task) => task.id === 'task-6').status, 'review');
});

test('export/import preserves work and validates references before replacing state', () => {
  const store = createStore({ storage: memoryStorage() });
  const workspace = store.addWorkspace({ name: 'مساحة اختبار', agentIds: ['agent-catalog'] });
  store.addNote(workspace.id, 'ملاحظة محفوظة');
  store.addTask({ title: 'عمل محفوظ', workspaceId: workspace.id, agentId: 'agent-catalog', priority: 'high' });
  const exported = store.exportData();
  const restored = createStore({ storage: memoryStorage() });
  restored.importData(exported);
  assert.deepEqual(restored.getState().tasks, store.getState().tasks);
  assert.deepEqual(restored.getState().workspaces, store.getState().workspaces);
  const before = restored.exportData();
  const invalid = JSON.parse(exported);
  invalid.tasks[0].workspaceId = 'missing-workspace';
  assert.throws(() => restored.importData(invalid));
  assert.throws(() => restored.importData('{broken json'));
  assert.throws(() => restored.importData({ ...JSON.parse(exported), schemaVersion: 999 }));
  assert.equal(restored.exportData(), before);
});

test('import cannot claim live AI connections and rejects duplicate records', () => {
  const store = createStore({ storage: memoryStorage() });
  const incoming = seedState();
  incoming.demoMode = false;
  incoming.agents[0].model = 'connected-api';
  store.importData(incoming);
  assert.equal(store.getState().demoMode, true);
  assert.equal(store.getState().agents[0].model, 'غير متصل');
  incoming.tasks.push({ ...incoming.tasks[0] });
  assert.throws(() => store.importData(incoming));
});

test('invalid edits are atomic and valid subscribers receive detached updates', () => {
  const store = createStore({ storage: memoryStorage() });
  const before = store.exportData();
  assert.throws(() => store.addTask({ title: '', workspaceId: 'ws-commerce', agentId: 'agent-catalog' }));
  assert.throws(() => store.updateTask('task-1', { agentId: 'missing-agent' }));
  assert.throws(() => store.updateWorkspace('ws-growth', { agentIds: ['missing-agent'] }));
  assert.throws(() => store.updateSettings({ timezone: 'Invalid/Timezone' }));
  assert.equal(store.exportData(), before);
  let updates = 0;
  store.subscribe(() => { throw new Error('faulty view'); });
  const unsubscribe = store.subscribe((state) => { updates++; state.settings.storeName = 'mutated'; });
  store.updateSettings({ storeName: 'متجر الاختبار', notifications: false });
  assert.equal(store.getState().settings.storeName, 'متجر الاختبار');
  assert.equal(store.getState().settings.notifications, false);
  assert.equal(updates, 1);
  unsubscribe();
  store.addNote('ws-commerce', 'ملاحظة اختبار');
  assert.equal(updates, 1);
});

test('corrupt or denied storage recovers to a usable demo and reset removes local additions', () => {
  const corrupt = memoryStorage({ [STORAGE_KEY]: '{invalid json' });
  const recovered = createStore({ storage: corrupt });
  assert.equal(recovered.getState().agents.length, 6);
  assert.equal(JSON.parse(corrupt.getItem(STORAGE_KEY)).schemaVersion, 1);
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const ephemeral = createStore({ storage: denied });
  const added = ephemeral.addWorkspace({ name: 'مساحة مؤقتة' });
  assert.ok(ephemeral.getState().workspaces.some((item) => item.id === added.id));
  ephemeral.reset();
  assert.equal(ephemeral.getState().workspaces.length, 4);
  assert.ok(!ephemeral.getState().workspaces.some((item) => item.id === added.id));
});
