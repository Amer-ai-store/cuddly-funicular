import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyWorkspace, LEGACY_STORAGE_KEY } from '../dist/legacy-migration.js';
import { seedState } from '../dist/store.js';
import { initialLiveState, normalizeLiveState, mutateLiveState } from '../server/state.mjs';

const clone = value => structuredClone(value);
const at = '2026-10-16T10:00:00.000Z';
function oldProject() {
  const state = seedState(at);
  state.workspaces.push({ id: 'workspace-manual', name: 'مساحتي الفعلية', description: 'مشروع أنشأه المستخدم', agentIds: ['agent-catalog'], status: 'active', color: '#123abc', notes: [{ id: 'note-custom', body: 'ملاحظة خاصة بالعمل', createdAt: at }] });
  state.workspaces[0].notes.push({ id: 'note-default-manual', body: 'ملاحظة على مساحة المتجر', createdAt: at });
  state.tasks.push({ id: 'task-manual', title: 'مهمة المستخدم', description: 'عمل يدوي محفوظ', agentId: 'agent-catalog', workspaceId: 'workspace-manual', status: 'queued', priority: 'high', createdAt: at });
  state.settings.storeName = 'متجري الفعلي';
  return state;
}
function storageFor(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const reads = [];
  const writes = [];
  return { reads, writes, raw, getItem(key) { reads.push(key); assert.equal(key, LEGACY_STORAGE_KEY); return raw; }, setItem(...args) { writes.push(args); }, removeItem() { assert.fail('The legacy backup must never be removed'); } };
}
function liveStore({ state = initialLiveState(), revision = 0, validateError, importError, afterValidate } = {}) {
  let current = clone(state);
  let currentRevision = revision;
  const calls = [];
  return {
    calls,
    getState: () => clone(current),
    getRevision: () => currentRevision,
    async validateImport(candidate) {
      calls.push({ method: 'validateImport', candidate: clone(candidate) });
      if (validateError) throw validateError;
      normalizeLiveState(candidate); // The production server validator is authoritative.
      if (afterValidate) ({ state: current, revision: currentRevision } = afterValidate(clone(current)));
      return { valid: true };
    },
    async importData(candidate) {
      calls.push({ method: 'importData', candidate: clone(candidate), expectedRevision: currentRevision });
      assert.equal(currentRevision, 0, 'automatic migration only writes with revision-zero CAS');
      if (importError) throw importError;
      current = mutateLiveState(current, 'importData', { data: candidate }).state;
      currentRevision++;
      return { state: clone(current), revision: currentRevision };
    },
  };
}

test('manual work persists through live server validation/import while the v1 backup stays intact', async () => {
  const legacy = oldProject();
  // Unrelated old fields never become server definitions, runs, or credentials.
  legacy.servers = [{ id: 'old-untrusted-server' }];
  legacy.secret = 'ignored-unrelated-field';
  const storage = storageFor(legacy);
  const api = liveStore();
  const result = await migrateLegacyWorkspace(api, { storage });
  assert.deepEqual(result, { migrated: true, counts: { workspaces: 1, tasks: 1, notes: 2, approvals: 0 } });
  assert.deepEqual(api.calls.map(call => call.method), ['validateImport', 'importData']);
  assert.equal(api.calls[1].expectedRevision, 0);
  const saved = normalizeLiveState(api.getState());
  assert.equal(saved.tasks[0].id, 'task-manual');
  assert.equal(saved.workspaces.find(workspace => workspace.id === 'workspace-manual').notes[0].body, 'ملاحظة خاصة بالعمل');
  assert.equal(saved.settings.storeName, 'متجري الفعلي');
  assert.equal(saved.activity.length, 1);
  assert.equal(saved.activity[0].title, 'استيراد بيانات المشروع');
  assert.deepEqual(saved.servers, []);
  assert.deepEqual(saved.runs, []);
  assert.equal(saved.secret, undefined);
  assert.equal(storage.raw, JSON.stringify(legacy));
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(storage.reads, [LEGACY_STORAGE_KEY]);
  const callsBefore = api.calls.length;
  assert.deepEqual(await migrateLegacyWorkspace(api, { storage }), { migrated: false });
  assert.equal(api.calls.length, callsBefore);
  assert.equal(storage.reads.length, 1);
});

test('examples and settings alone never produce an import or server activity', async () => {
  const source = seedState(at);
  source.settings.storeName = 'تغيير إعداد منفرد';
  const api = liveStore();
  assert.deepEqual(await migrateLegacyWorkspace(api, { storage: storageFor(source) }), { migrated: false });
  assert.deepEqual(api.calls, []);
  assert.deepEqual(api.getState(), initialLiveState());
});

test('sample task/approval/note IDs are excluded and note IDs merge once in custom and default spaces', async () => {
  const source = oldProject();
  source.workspaces.at(-1).notes.push(clone(source.workspaces.at(-1).notes[0]), { id: 'note-commerce-1', body: 'مثال منسوخ', createdAt: at });
  source.workspaces[0].notes.push(clone(source.workspaces[0].notes.at(-1)));
  const api = liveStore();
  const result = await migrateLegacyWorkspace(api, { storage: storageFor(source) });
  assert.equal(result.migrated, true);
  assert.equal(result.counts.notes, 2);
  const saved = api.getState();
  assert.deepEqual(saved.tasks.map(task => task.id), ['task-manual']);
  assert.deepEqual(saved.approvals, []);
  assert.deepEqual(saved.workspaces.flatMap(workspace => workspace.notes).map(note => note.id).sort(), ['note-custom', 'note-default-manual']);
  assert.ok(!saved.activity.some(event => /^activity-[1-4]$/.test(event.id)));
});

test('membership failures preserve every manual record and skip the entire migration', async () => {
  const source = oldProject();
  source.tasks.push({ ...source.tasks.at(-1), id: 'task-second-manual', workspaceId: 'ws-customer', agentId: 'agent-catalog' });
  const storage = storageFor(source);
  const api = liveStore();
  const result = await migrateLegacyWorkspace(api, { storage });
  assert.equal(result.migrated, false);
  assert.match(result.warning, /فريق مساحتها/);
  assert.deepEqual(api.calls, []);
  assert.equal(api.getState().tasks.length, 0);
  assert.equal(storage.raw, JSON.stringify(source));
  assert.deepEqual(storage.writes, []);
});

test('invalid, oversized, malformed, or inaccessible backups never reach an API mutation', async () => {
  const broken = oldProject(); broken.tasks[0].createdAt = 'invalid';
  const unknownVersion = { ...oldProject(), schemaVersion: 8 };
  const tooMany = oldProject(); tooMany.workspaces = Array(501).fill(tooMany.workspaces[0]);
  for (const source of ['{invalid-json', 'ا'.repeat(1024 * 1024 + 1), broken, unknownVersion, tooMany]) {
    const api = liveStore();
    const result = await migrateLegacyWorkspace(api, { storage: storageFor(source) });
    assert.equal(result.migrated, false);
    assert.ok(result.warning);
    assert.deepEqual(api.calls, []);
  }
  const api = liveStore();
  assert.ok((await migrateLegacyWorkspace(api, { storage: { getItem() { throw new Error('storage denied'); } } })).warning);
  assert.deepEqual(api.calls, []);
});

test('used live projects are left untouched without even reading the old backup', async () => {
  const withNote = initialLiveState(); withNote.workspaces[0].notes.push({ id: 'live-note', body: 'عمل موجود', createdAt: at });
  const withTask = initialLiveState(); withTask.tasks.push(oldProject().tasks.at(-1));
  const withWorkspace = initialLiveState(); withWorkspace.workspaces.push(oldProject().workspaces.at(-1));
  const withRun = initialLiveState(); withRun.runs.push({ id: 'live-run' });
  for (const setup of [{ revision: 1 }, { state: withNote }, { state: withTask }, { state: withWorkspace }, { state: withRun }]) {
    const api = liveStore(setup);
    const storage = { getItem() { assert.fail('An existing live project must not read the old backup'); } };
    assert.deepEqual(await migrateLegacyWorkspace(api, { storage }), { migrated: false });
    assert.deepEqual(api.calls, []);
  }
});

test('manual review tasks get real pending records; custom decisions remain decisions without execution', async () => {
  const source = oldProject();
  source.tasks.at(-1).status = 'review';
  const api = liveStore();
  const migrated = await migrateLegacyWorkspace(api, { storage: storageFor(source) });
  assert.equal(migrated.counts.approvals, 1);
  const pending = api.getState().approvals[0];
  assert.equal(pending.taskId, 'task-manual');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.decidedAt, null);
  assert.equal(api.getState().runs.length, 0);
  source.approvals.push({ id: 'approval-manual', taskId: 'task-manual', title: 'قرار المستخدم المحلي', description: '', impact: 'عالية', status: 'rejected' });
  const decidedApi = liveStore();
  await migrateLegacyWorkspace(decidedApi, { storage: storageFor(source) });
  assert.deepEqual(decidedApi.getState().approvals.map(approval => ({ id: approval.id, status: approval.status, decidedAt: approval.decidedAt })), [{ id: 'approval-manual', status: 'rejected', decidedAt: null }]);
});

test('server validation failure or changed revision cannot cause a partial or retried import', async () => {
  const invalidSettings = oldProject(); invalidSettings.settings.timezone = 'Invalid/Timezone';
  const invalidApi = liveStore();
  assert.ok((await migrateLegacyWorkspace(invalidApi, { storage: storageFor(invalidSettings) })).warning);
  assert.deepEqual(invalidApi.calls.map(call => call.method), ['validateImport']);
  assert.equal(invalidApi.getState().tasks.length, 0);
  const changedApi = liveStore({ afterValidate: state => ({ state, revision: 1 }) });
  const result = await migrateLegacyWorkspace(changedApi, { storage: storageFor(oldProject()) });
  assert.equal(result.migrated, false);
  assert.match(result.warning, /جلسة أخرى/);
  assert.deepEqual(changedApi.calls.map(call => call.method), ['validateImport']);
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  const casApi = liveStore({ importError: conflict });
  const casStorage = storageFor(oldProject());
  assert.ok((await migrateLegacyWorkspace(casApi, { storage: casStorage })).warning);
  assert.deepEqual(casApi.calls.map(call => call.method), ['validateImport', 'importData']);
  assert.equal(casApi.getRevision(), 0);
  assert.deepEqual(casStorage.writes, []);
});

test('the candidate retains live agents, activity, commerce, server records, and empty runs', async () => {
  const state = initialLiveState();
  state.agents[0].description = 'تعريف الخادم الحالي';
  state.activity.push({ id: 'activity-live', title: 'حدث فعلي', description: 'سجل الخادم', message: 'سجل الخادم', type: 'system', createdAt: at });
  state.servers.push({ id: 'server-live', name: 'خادم موجود', baseUrl: 'https://store.example.com', healthPath: '/health', apiPrefix: '/api/v1', enabled: true, status: 'unverified', tokenEnv: null, lastCheckedAt: null, lastHttpStatus: null, latencyMs: null, lastError: null });
  state.commerce = { deviceId: 'android-live', appVersion: '1.0.0', products: [], orders: [], receivedAt: at };
  const api = liveStore({ state });
  assert.equal((await migrateLegacyWorkspace(api, { storage: storageFor(oldProject()) })).migrated, true);
  const candidate = api.calls[0].candidate;
  for (const key of ['agents', 'activity', 'servers', 'runs', 'commerce']) assert.deepEqual(candidate[key], state[key]);
  assert.deepEqual(api.getState().commerce, state.commerce);
});
