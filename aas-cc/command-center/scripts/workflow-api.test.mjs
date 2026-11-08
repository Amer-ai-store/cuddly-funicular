import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { zipSync, strToU8 } from 'fflate';
import { REPOSITORY } from '../server/github-cache.mjs';

const root = resolve(import.meta.dirname, '..');
const site = 'https://workflow-fixture.example';
const source = 'a'.repeat(40), modified = 'b'.repeat(40);
const runnerKey = 'isolated-workflow-runner-fixture-key';
const serviceKey = 'isolated-app-service-fixture-key';
const json = (value, init = {}) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });

test('real Worker workflow gates persist evidence and enforce distinct owner, app and runner boundaries', async (context) => {
  // Service-bound responses are isolated fixtures, not external source/build evidence.
  const prefix = REPOSITORY.split('/')[1] + '-' + source + '/';
  const archive = zipSync({
    [prefix + 'app/src/main/java/example/Main.kt']: strToU8('package example\nfun main() = println("fixture")\n'),
    [prefix + 'app/src/main/AndroidManifest.xml']: strToU8('<manifest package="example"><application /></manifest>'),
    [prefix + 'README.md']: strToU8('Isolated source-analysis integration fixture. No code is executed.'),
  });
  let archiveAvailable = true;
  const outgoing = [];
  const publicUrl = 'https://github.com/' + REPOSITORY;
  const fixtureHttp = async (request) => {
    const url = new URL(request.url);
    outgoing.push({ hostname: url.hostname, pathname: url.pathname, authorization: request.headers.has('Authorization') });
    if (url.hostname === 'codeload.github.com') {
      assert.equal(url.pathname, '/' + REPOSITORY + '/zip/' + source);
      assert.equal(request.headers.has('Authorization'), false);
      return archiveAvailable ? new Response(archive, { headers: { 'Content-Type': 'application/zip' } }) : json({ message: 'private upstream fixture failure' }, { status: 503 });
    }
    assert.equal(url.hostname, 'api.github.com');
    if (url.pathname.endsWith('/commits')) return json([{ sha: source, html_url: publicUrl + '/commit/' + source, commit: { message: 'Pinned fixture commit', author: { name: 'Fixture Author', date: '2026-10-16T01:00:00Z' }, committer: { date: '2026-10-16T01:00:00Z' } } }]);
    if (url.pathname.endsWith('/branches')) return json([{ name: 'main', commit: { sha: source }, protected: false }]);
    if (url.pathname.endsWith('/actions/runs')) return json({ workflow_runs: [] });
    return json({ full_name: REPOSITORY, html_url: publicUrl, default_branch: 'main', description: 'Workflow fixture source', private: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-16T01:00:00Z', pushed_at: '2026-10-16T01:00:00Z' });
  };
  const mf = new Miniflare({ scriptPath: resolve(root, 'dist/server/index.js'), modules: true, compatibilityDate: '2025-05-01', d1Databases: ['DB'], bindings: { AAS_RUNNER_TOKEN: runnerKey, AAS_API_TOKEN: serviceKey, AAS_PRIVATE_SITE_BEARER: 'isolated-private-site-fixture-access', AAS_PUBLIC_ORIGIN: site }, serviceBindings: { GITHUB_API_HTTP: fixtureHttp } });
  context.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir(resolve(root, 'drizzle'))).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(resolve(root, 'drizzle', name), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  async function request(path, { method = 'GET', data, identity = 'owner', headers = {} } = {}) {
    const identityHeaders = identity === 'owner' ? { 'oai-authenticated-user-id': 'isolated-owner-fixture' } : identity === 'runner' ? { 'X-AAS-Runner-Key': runnerKey } : identity === 'service' ? { 'X-AAS-API-Key': serviceKey } : {};
    const response = await mf.dispatchFetch(site + '/api/v1' + path, { method, headers: { ...identityHeaders, ...(data ? { 'Content-Type': 'application/json', Origin: site } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
    return { response, body: await response.json() };
  }
  let current = (await request('/state')).body;
  async function action(operation, payload, revision = current.revision) {
    const result = await request('/actions', { method: 'POST', data: { expectedRevision: revision, operation, payload } });
    if (result.response.ok) current = result.body;
    return result;
  }
  const create = async (title, count = 2) => {
    const result = await action('startWorkflow', { title, repository: REPOSITORY, sourceRevision: source, mode: 'change', steps: Array.from({ length: count }, (_, index) => ({ title: 'خطوة fixture ' + (index + 1) })) });
    assert.equal(result.response.status, 200);
    return result.body.result;
  };
  let workflow;

  await context.test('owner creation requires CAS and every unproven phase remains locked', async () => {
    assert.deepEqual(current.state.workflows, []);
    const initialRevision = current.revision;
    workflow = await create('تكامل بوابات fixture');
    assert.equal(workflow.status, 'active');
    assert.equal(workflow.steps[0].phase, 'analysis');
    assert.equal(workflow.steps[1].status, 'pending');
    assert.equal((await action('advanceWorkflow', { workflowId: workflow.id, stepId: workflow.steps[0].id })).response.status, 422);
    assert.equal((await action('recordWorkflowChange', { workflowId: workflow.id, stepId: workflow.steps[0].id, sourceRevision: modified, changeType: 'modification', summary: 'تخطي التحليل', evidence: [{ kind: 'diff', label: 'fixture', content: '--- a/a\n+++ b/a\n-old\n+new' }] })).response.status, 422);
    assert.equal((await action('startWorkflow', { title: 'طلب قديم' }, initialRevision)).response.status, 409);
    for (const operation of ['recordWorkflowAnalysisResult', 'recordWorkflowRunnerReceipt', 'advanceWorkflowRunner']) assert.equal((await action(operation, {})).response.status, 400);
    const restored = (await request('/workflows/' + workflow.id)).body;
    assert.equal(restored.data.steps[0].analysis, null);
    assert.equal(restored.revision, current.revision);
  });

  await context.test('runner credentials are narrow and only owner sessions may download connection secrets', async () => {
    const route = '/runner/context?workflowId=' + workflow.id;
    for (const identity of ['owner', 'service', 'anonymous']) assert.equal((await request(route, { identity })).response.status, 401);
    const scoped = await request(route, { identity: 'runner' });
    assert.equal(scoped.response.status, 200);
    assert.equal(scoped.body.workflow.id, workflow.id);
    assert.equal(scoped.body.currentStep.id, workflow.steps[0].id);
    assert.equal(Object.hasOwn(scoped.body, 'state'), false);
    assert.equal((await request('/state', { identity: 'runner' })).response.status, 401);
    const health = await request('/runner/health', { identity: 'runner' });
    assert.equal(health.response.status, 200);
    assert.equal(health.body.storage, 'D1');
    assert.equal(health.body.automaticCodeChanges, false);
    for (const identity of ['owner', 'service']) assert.equal((await request('/runner/receipts', { identity, method: 'POST', data: { expectedRevision: current.revision, receipt: {} } })).response.status, 401);
    const denied = await request('/runner/connection-config', { identity: 'service', method: 'POST', data: {} });
    assert.equal(denied.response.status, 403);
    assert.ok(!JSON.stringify(denied.body).includes(runnerKey));
    const ownerDownload = await request('/runner/connection-config', { method: 'POST', data: {} });
    assert.equal(ownerDownload.response.status, 200);
    assert.equal(ownerDownload.body.runnerToken, runnerKey);
    assert.match(ownerDownload.response.headers.get('Content-Disposition'), /attachment/);
    assert.equal((await request('/runner/connection-config', { method: 'POST', data: {}, headers: { Origin: 'https://other.fixture' } })).response.status, 403);
  });

  await context.test('server analysis reads and hashes a pinned source ZIP rather than trusting client reports', async () => {
    const result = await request('/workflows/' + workflow.id + '/analyze', { method: 'POST', data: { expectedRevision: current.revision, sourceRevision: modified, summary: 'ادعاء عميل يجب تجاهله', provenance: 'runner' } });
    assert.equal(result.response.status, 200);
    current = result.body;
    workflow = result.body.result;
    const step = workflow.steps[0];
    assert.equal(step.phase, 'implementation');
    assert.equal(step.analysis.provenance, 'server-analysis');
    assert.equal(step.analysis.sourceRevision, source);
    assert.equal(step.analysis.outcome, 'passed');
    assert.ok(!step.analysis.summary.includes('ادعاء عميل'));
    assert.ok(step.analysis.evidence.some((artifact) => artifact.kind === 'file' && artifact.sha256));
    const report = JSON.parse(step.analysis.evidence.find((artifact) => artifact.kind === 'report').content);
    assert.equal(report.coverage.complete, true);
    assert.equal(report.coverage.analyzedFiles, 3);
    assert.ok(outgoing.some((call) => call.hostname === 'codeload.github.com' && call.pathname.endsWith('/' + source)));
    assert.equal(step.change, null);
    assert.equal(step.verification, null);
    assert.deepEqual(current.state.runs, []);
  });

  await context.test('runner receipts require current versions, failures stop advance and successful replies never expose organization state', async () => {
    let scoped = (await request('/runner/context?workflowId=' + workflow.id, { identity: 'runner' })).body;
    const receipt = (phase, patch = {}) => ({ workflowId: workflow.id, stepId: scoped.currentStep.id, phase, runnerId: 'fixture-runner', receiptId: 'fixture-' + phase, stepRevision: scoped.currentStep.revision, sourceRevision: scoped.currentStep.sourceRevision, summary: 'إيصال اختبار تكامل معزول.', evidence: [{ kind: 'log', label: 'fixture log', content: 'Isolated runner fixture command output, not a production execution.' }], ...patch });
    const send = (value, revision = scoped.revision) => request('/runner/receipts', { identity: 'runner', method: 'POST', data: { expectedRevision: revision, receipt: value } });
    const missingRevision = await request('/runner/receipts', { identity: 'runner', method: 'POST', data: { receipt: receipt('implementation') } });
    assert.equal(missingRevision.response.status, 428);
    const changed = await send(receipt('implementation', { sourceRevision: modified, changeType: 'modification', evidence: [{ kind: 'diff', label: 'fixture patch', content: 'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after' }] }));
    assert.equal(changed.response.status, 200);
    assert.equal(Object.hasOwn(changed.body, 'state'), false);
    assert.equal(Object.hasOwn(changed.body, 'result'), false);
    assert.equal(changed.body.currentStep.change.provenance, 'runner');
    assert.equal(changed.body.currentStep.sourceRevision, modified);
    scoped = changed.body;
    const verification = receipt('verification', { receiptId: 'fixture-verification-failed', outcome: 'failed', checks: [{ name: 'fixture test', command: 'node fixture-check.mjs', exitCode: 1, evidenceIndex: 0 }] });
    const failed = await send(verification);
    assert.equal(failed.response.status, 200);
    assert.equal(failed.body.workflow.status, 'failed');
    const stale = await send({ ...verification, receiptId: 'fixture-stale-verification' }, scoped.revision);
    assert.equal(stale.response.status, 409);
    assert.equal(Object.hasOwn(stale.body, 'state'), false);
    assert.equal(stale.body.workflow.status, 'failed');
    scoped = failed.body;
    const advance = (verificationReceiptId, extra = {}) => request('/runner/advance', { identity: 'runner', method: 'POST', data: { expectedRevision: scoped.revision, workflowId: workflow.id, stepId: scoped.currentStep.id, runnerId: 'fixture-runner', verificationReceiptId, ...extra } });
    assert.equal((await advance('fixture-verification-failed')).response.status, 422);
    const passed = await send(receipt('verification', { receiptId: 'fixture-verification-passed', outcome: 'passed', checks: [{ name: 'fixture test', command: 'node fixture-check.mjs', exitCode: 0, evidenceIndex: 0 }] }));
    assert.equal(passed.response.status, 200);
    scoped = passed.body;
    assert.equal((await advance('wrong-receipt')).response.status, 422);
    const moved = await advance('fixture-verification-passed');
    assert.equal(moved.response.status, 200);
    assert.equal(Object.hasOwn(moved.body, 'state'), false);
    assert.equal(moved.body.workflow.steps[0].status, 'complete');
    assert.equal(moved.body.currentStep.phase, 'analysis');
    assert.equal(moved.body.workflow.currentStepIndex, 1);
    assert.equal(moved.body.workflow.events[0].provenance, 'runner');
    current = (await request('/state')).body;
    const stored = await db.prepare('SELECT revision, document FROM aas_app_state WHERE id = ?').bind('organization').first();
    assert.equal(stored.revision, moved.body.revision);
    assert.equal(JSON.parse(stored.document).workflows.find((item) => item.id === workflow.id).steps[0].verification.receiptId, 'fixture-verification-passed');
  });

  await context.test('incomplete archive analysis records a blocking reason and does not open modification or later steps', async () => {
    const blocked = await create('تحليل غير مكتمل fixture', 1);
    archiveAvailable = false;
    const result = await request('/workflows/' + blocked.id + '/analyze', { method: 'POST', data: { expectedRevision: current.revision } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.result.status, 'blocked');
    assert.equal(result.body.result.steps[0].phase, 'analysis');
    assert.equal(result.body.result.steps[0].analysis.provenance, 'server-analysis');
    assert.equal(result.body.result.steps[0].analysis.outcome, 'blocked');
    assert.equal(result.body.result.steps[0].change, null);
    assert.equal(result.body.result.steps[0].verification, null);
    assert.ok(!JSON.stringify(result.body.result).includes('private upstream fixture failure'));
    current = result.body;
    assert.equal((await action('advanceWorkflow', { workflowId: blocked.id, stepId: blocked.steps[0].id })).response.status, 422);
  });
});
