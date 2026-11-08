import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { zipSync, strToU8 } from 'fflate';
import { createApiStore } from '../dist/api-store.js';
import { REPOSITORY } from '../server/github-cache.mjs';

const root = resolve(import.meta.dirname, '..');
const site = 'https://parallel-lanes-fixture.example';
const source = 'a'.repeat(40);
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

async function beforeRelease(operation) {
  let timeout;
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('An unrelated operation waited for the held source-analysis lane.')), 3000); })]);
  } finally { clearTimeout(timeout); }
}

async function fixture(context) {
  // These held HTTP responses are isolated contract fixtures; no repository code
  // is executed and no production analysis or network success is represented.
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  const prefix = REPOSITORY.split('/')[1] + '-' + source + '/';
  const archive = zipSync({
    [prefix + 'README.md']: strToU8('Pinned parallel-lane fixture. Not a production source archive.'),
    [prefix + 'app/src/main/java/example/Main.kt']: strToU8('package example\nfun main() = println("isolated fixture")\n'),
  });
  const outgoing = [];
  let archiveRequests = 0;
  const publicUrl = 'https://github.com/' + REPOSITORY;
  const fixtureHttp = async (request) => {
    const url = new URL(request.url);
    outgoing.push(url.hostname + url.pathname);
    if (url.hostname === 'codeload.github.com') {
      assert.equal(url.pathname, '/' + REPOSITORY + '/zip/' + source);
      assert.equal(request.headers.has('Authorization'), false);
      archiveRequests++;
      entered.resolve();
      await released.promise;
      return new Response(archive, { headers: { 'Content-Type': 'application/zip' } });
    }
    assert.equal(url.hostname, 'api.github.com');
    if (url.pathname.endsWith('/commits')) return json([{ sha: source, html_url: publicUrl + '/commit/' + source, commit: { message: 'Pinned integration fixture', author: { name: 'Fixture', date: '2026-10-16T01:00:00Z' }, committer: { date: '2026-10-16T01:00:00Z' } } }]);
    if (url.pathname.endsWith('/branches')) return json([{ name: 'main', commit: { sha: source }, protected: false }]);
    if (url.pathname.endsWith('/actions/runs')) return json({ workflow_runs: [] });
    assert.equal(url.pathname, '/repos/' + REPOSITORY);
    return json({ full_name: REPOSITORY, html_url: publicUrl, default_branch: 'main', description: 'Isolated concurrency fixture', private: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-16T01:00:00Z', pushed_at: '2026-10-16T01:00:00Z' });
  };
  const mf = new Miniflare({ scriptPath: resolve(root, 'dist/server/index.js'), modules: true, compatibilityDate: '2025-05-01', d1Databases: ['DB'], serviceBindings: { GITHUB_API_HTTP: fixtureHttp } });
  context.after(async () => { released.resolve(); await mf.dispose(); });
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir(resolve(root, 'drizzle'))).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of (await readFile(resolve(root, 'drizzle', name), 'utf8')).split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const dispatch = (path, options = {}) => mf.dispatchFetch(site + path, { ...options, headers: { ...options.headers, 'oai-authenticated-user-id': 'isolated-owner-fixture', ...(options.body ? { Origin: site } : {}) } });
  async function request(path, { method = 'GET', data } = {}) {
    const response = await dispatch('/api/v1' + path, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    return { response, body: await response.json() };
  }
  const read = async () => (await request('/state')).body;
  const action = (operation, payload, expectedRevision) => request('/actions', { method: 'POST', data: { expectedRevision, operation, payload } });
  const initial = await read();
  const created = await action('startWorkflow', { title: 'سير اختبار التزامن المعزول', repository: REPOSITORY, sourceRevision: source, steps: [{ title: 'تحليل fixture ثم تنفيذ موثق' }] }, initial.revision);
  assert.equal(created.response.status, 200);
  return { db, dispatch, request, read, action, revision: created.body.revision, workflow: created.body.result, archiveEntered: entered.promise, releaseArchive: () => released.resolve(), archiveRequests: () => archiveRequests, outgoing };
}

const taskInput = (title) => ({ title, agentId: 'agent-catalog', workspaceId: 'ws-commerce', priority: 'medium', status: 'queued' });

test('a held archive analysis rebases its one result over unrelated D1 task and note writes without refetching', { timeout: 15000 }, async (context) => {
  const server = await fixture(context);
  const analysis = server.request('/workflows/' + server.workflow.id + '/analyze', { method: 'POST', data: { expectedRevision: server.revision } });
  await beforeRelease(server.archiveEntered);
  const callsAtHold = [...server.outgoing];
  const added = await beforeRelease(server.action('addTask', taskInput('مهمة مستقلة أثناء التحليل'), server.revision));
  assert.equal(added.response.status, 200);
  const changed = await beforeRelease(server.action('updateTask', { id: added.body.result.id, patch: { priority: 'high' } }, added.body.revision));
  assert.equal(changed.response.status, 200);
  const noted = await beforeRelease(server.action('addNote', { workspaceId: 'ws-growth', body: 'ملاحظة مستقلة محفوظة أثناء انتظار المصدر.' }, changed.body.revision));
  assert.equal(noted.response.status, 200);
  assert.equal(server.archiveRequests(), 1);
  server.releaseArchive();
  const result = await analysis;
  assert.equal(result.response.status, 200);
  assert.equal(result.body.revision, noted.body.revision + 1);
  assert.equal(result.body.result.steps[0].analysis.provenance, 'server-analysis');
  assert.equal(result.body.result.steps[0].analysis.outcome, 'passed');
  assert.equal(result.body.result.steps[0].phase, 'implementation');
  assert.equal(result.body.state.tasks.find((task) => task.id === added.body.result.id).priority, 'high');
  assert.equal(result.body.state.workspaces.find((workspace) => workspace.id === 'ws-growth').notes[0].body, 'ملاحظة مستقلة محفوظة أثناء انتظار المصدر.');
  assert.deepEqual(server.outgoing, callsAtHold);
  const stored = await server.db.prepare('SELECT revision, document FROM aas_app_state WHERE id = ?').bind('organization').first();
  const workflow = JSON.parse(stored.document).workflows.find((item) => item.id === server.workflow.id);
  assert.equal(stored.revision, result.body.revision);
  assert.equal(workflow.events.filter((event) => event.type === 'analysis-recorded' && event.provenance === 'server-analysis').length, 1);
});

test('changing the same workflow gate while its archive is pending rejects the old analysis result', { timeout: 15000 }, async (context) => {
  const server = await fixture(context);
  const step = server.workflow.steps[0];
  const analysis = server.request('/workflows/' + server.workflow.id + '/analyze', { method: 'POST', data: { expectedRevision: server.revision } });
  await beforeRelease(server.archiveEntered);
  const manual = await beforeRelease(server.action('recordWorkflowAnalysis', { workflowId: server.workflow.id, stepId: step.id, sourceRevision: source, outcome: 'blocked', summary: 'أوقف المالك هذه الخطوة أثناء التحليل المعزول.', evidence: [{ kind: 'log', label: 'سبب الإيقاف fixture', content: 'Owner fixture recorded a blocker; no code was modified or executed.' }] }, server.revision));
  assert.equal(manual.response.status, 200);
  const before = await server.read();
  server.releaseArchive();
  const result = await analysis;
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, 'revision_conflict');
  assert.equal(result.body.revision, manual.body.revision);
  const after = await server.read();
  assert.deepEqual(after.state, before.state);
  assert.equal(after.state.workflows[0].steps[0].analysis.provenance, 'manual');
  assert.equal(after.state.workflows[0].steps[0].analysis.outcome, 'blocked');
  assert.equal(after.state.workflows[0].steps[0].phase, 'analysis');
  assert.equal(server.archiveRequests(), 1);
});

test('browser analysis uses a workflow pending scope while task writes proceed and stale mutations are never replayed', { timeout: 15000 }, async (context) => {
  const server = await fixture(context);
  const sent = [];
  const client = await createApiStore({ pollMs: 100000, fetchImpl: (path, options) => { sent.push({ path, method: options.method || 'GET', payload: options.body ? JSON.parse(options.body) : null }); return server.dispatch(path, options); } });
  context.after(() => client.dispose());
  const analysis = client.analyzeWorkflow(server.workflow.id);
  await beforeRelease(server.archiveEntered);
  assert.equal(client.getConnection().busy, false);
  assert.deepEqual(client.getConnection().pendingOperations, ['analysis:' + server.workflow.id]);
  await assert.rejects(client.analyzeWorkflow(server.workflow.id), (error) => error.code === 'BUSY');
  const added = await beforeRelease(client.addTask(taskInput('مهمة المتصفح أثناء التحليل')));
  assert.ok(client.getState().tasks.some((task) => task.id === added.result.id));
  assert.equal(client.getConnection().busy, false);
  const noted = await beforeRelease(server.action('addNote', { workspaceId: 'ws-growth', body: 'تحديث من جلسة ثانية، لا يعاد تشغيل أي تعديل تلقائيًا.' }, client.getRevision()));
  assert.equal(noted.response.status, 200);
  await assert.rejects(client.updateTask(added.result.id, { priority: 'high' }), (error) => error.status === 409);
  assert.equal(sent.filter((item) => item.payload?.operation === 'updateTask').length, 1);
  assert.equal(sent.filter((item) => item.path.endsWith('/analyze')).length, 1);
  assert.equal(client.getState().tasks.find((task) => task.id === added.result.id).priority, 'medium');
  assert.deepEqual(client.getConnection().pendingOperations, ['analysis:' + server.workflow.id]);
  server.releaseArchive();
  const completed = await analysis;
  assert.equal(completed.result.steps[0].phase, 'implementation');
  assert.equal(client.getRevision(), noted.body.revision + 1);
  assert.equal(client.getConnection().busy, false);
  assert.deepEqual(client.getConnection().pendingOperations, []);
  assert.equal(client.getConnection().status, 'online');
  assert.equal(server.archiveRequests(), 1);
  assert.equal(client.getState().tasks.find((task) => task.id === added.result.id).priority, 'medium');
});
