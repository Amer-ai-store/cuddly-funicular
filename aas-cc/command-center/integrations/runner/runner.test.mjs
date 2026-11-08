import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRunner, loadConfiguration, execute, connectionEnvironment } from './runner.mjs';
import { initialLiveState, mutateLiveState } from '../../server/state.mjs';

const env = { ...process.env, AAS_BASE_URL: 'https://aas.example.com', AAS_RUNNER_KEY: 'dedicated-runner-secret', AAS_SITES_AUTHORIZATION: 'private-site-secret', GITHUB_TOKEN: 'not-for-tests' };
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function fixture(t, { mode = 'change', commands, patch = true, twoSteps = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aas-runner-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); await mkdir(repo);
  git(repo, ['init', '-q']); git(repo, ['config', 'user.name', 'Fixture']); git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(join(repo, 'message.txt'), 'before\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-qm', 'Fixture source']);
  const sourceRevision = git(repo, ['rev-parse', 'HEAD']);
  let state = mutateLiveState(initialLiveState(), 'startWorkflow', { title: 'Real runner fixture', repository: 'fixture/source', sourceRevision, mode, steps: [{ title: 'First step' }, ...(twoSteps ? [{ title: 'Second step' }] : [])] }).state;
  const workflowId = state.workflows[0].id;
  let revision = 1;
  const requests = []; let failPhase;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    assert.equal(new URL(url).origin, env.AAS_BASE_URL);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['X-AAS-Runner-Key'], env.AAS_RUNNER_KEY);
    assert.equal(options.headers['OAI-Sites-Authorization'], env.AAS_SITES_AUTHORIZATION);
    assert.equal(options.headers['X-AAS-API-Key'], undefined);
    const data = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, data });
    const workflow = state.workflows[0];
    if (path.endsWith('/context')) return Response.json({ revision, workflow, currentStep: workflow.steps[workflow.currentStepIndex] });
    if (data.expectedRevision !== revision || (failPhase && failPhase === data.receipt?.phase)) return Response.json({ error: { code: 'revision_conflict' } }, { status: 409 });
    const op = path.endsWith('/advance') ? 'advanceWorkflowRunner' : 'recordWorkflowRunnerReceipt';
    state = mutateLiveState(state, op, data.receipt ?? data).state;
    revision++;
    return Response.json({ revision });
  };
  const checks = commands ?? [{ name: 'Actual changed source and isolated environment', argv: ['node', '-e', "const fs=require('node:fs'); if(fs.readFileSync('message.txt','utf8')!=='after\\n')process.exit(2); if(process.env.AAS_RUNNER_KEY||process.env.AAS_SITES_AUTHORIZATION||process.env.GITHUB_TOKEN)process.exit(3); console.log('actual-test-output')"] }];
  const configuration = { version: 1, repository: 'fixture/source', steps: [{ stepIndex: 0, ...(patch ? { patch: 'change.patch' } : {}), commands: checks }, ...(twoSteps ? [{ stepIndex: 1, commands: checks }] : [])] };
  await writeFile(join(repo, 'runner.json'), JSON.stringify(configuration));
  if (patch) await writeFile(join(repo, 'change.patch'), 'diff --git a/message.txt b/message.txt\nindex 90be1f3..294186e 100644\n--- a/message.txt\n+++ b/message.txt\n@@ -1 +1 @@\n-before\n+after\n');
  const options = { repo, config: 'runner.json', workflowId, sourceRevision, workDir: join(root, 'work'), runnerId: 'fixture-runner' };
  return { root, repo, options, configuration, fetchImpl, requests, getState: () => structuredClone(state), fail: phase => { failPhase = phase; } };
}

test('actual patch, isolated local commit and configured test produce accepted runner receipts', async t => {
  const f = await fixture(t);
  const result = await runRunner({ ...f.options, apply: true }, { env, fetchImpl: f.fetchImpl });
  assert.equal(await readFile(join(f.repo, 'message.txt'), 'utf8'), 'before\n');
  assert.equal(git(f.repo, ['rev-parse', 'HEAD']), f.options.sourceRevision);
  assert.equal(result.pushed, false);
  assert.equal(result.repositoryUpdated, false);
  assert.equal(result.steps[0].outcome, 'passed');
  assert.notEqual(result.steps[0].sourceRevision, f.options.sourceRevision);
  assert.equal(git(result.checkout, ['rev-parse', 'HEAD']), result.steps[0].sourceRevision);
  assert.match(git(f.repo, ['bundle', 'list-heads', join(result.workDir, 'local-changes.bundle')]), new RegExp(result.steps[0].sourceRevision));
  const receipts = f.requests.filter(request => request.path.endsWith('/receipts')).map(request => request.data);
  assert.deepEqual(receipts.map(item => item.receipt.phase), ['analysis', 'implementation', 'verification']);
  assert.deepEqual(receipts.map(item => item.expectedRevision), [1, 2, 3]);
  assert.deepEqual(receipts.map(item => item.receipt.stepRevision), [0, 1, 2]);
  assert.ok(receipts[0].receipt.evidence[0].content.includes('manifestSha256'));
  assert.match(receipts[1].receipt.evidence[0].content, /-before\n\+after/);
  assert.match(receipts[2].receipt.evidence[0].content, /actual-test-output/);
  assert.equal(f.getState().workflows[0].steps[0].verification.provenance, 'runner');
  assert.equal(f.getState().workflows[0].status, 'active');
});

test('without --apply the runner analyzes source and reports a blocked change without committing', async t => {
  const f = await fixture(t);
  const result = await runRunner(f.options, { env, fetchImpl: f.fetchImpl });
  assert.equal(result.steps[0].outcome, 'blocked');
  assert.equal(git(result.checkout, ['rev-parse', 'HEAD']), f.options.sourceRevision);
  assert.equal(await readFile(join(result.checkout, 'message.txt'), 'utf8'), 'before\n');
  assert.deepEqual(f.requests.filter(request => request.data?.receipt).map(request => request.data.receipt.phase), ['analysis', 'implementation']);
  assert.equal(f.getState().workflows[0].steps[0].change.outcome, 'blocked');
});

test('real failing commands keep the gate failed and never call advance', async t => {
  const f = await fixture(t, { commands: [{ name: 'Actual failing test', argv: ['node', '-e', "console.error('actual failure');process.exit(7)"] }] });
  const result = await runRunner({ ...f.options, apply: true, advance: true }, { env, fetchImpl: f.fetchImpl });
  assert.equal(result.steps[0].checks[0].exitCode, 7);
  assert.equal(result.steps[0].outcome, 'failed');
  assert.equal(f.getState().workflows[0].steps[0].verification.outcome, 'failed');
  assert.ok(!f.requests.some(request => request.path.endsWith('/advance')));
});

test('verification cannot pass if a configured test silently changes source', async t => {
  const f = await fixture(t, { mode: 'analysis-only', patch: false, commands: [{ name: 'Mutating test', argv: ['node', '-e', "require('node:fs').writeFileSync('message.txt','mutated')"] }] });
  const result = await runRunner(f.options, { env, fetchImpl: f.fetchImpl });
  assert.equal(result.steps[0].outcome, 'failed');
  assert.equal(result.steps[0].checks.at(-1).exitCode, 1);
  assert.equal(f.getState().workflows[0].steps[0].verification.outcome, 'failed');
});

test('explicit advance can process two real analysis-only gates without inventing changes', async t => {
  const f = await fixture(t, { mode: 'analysis-only', patch: false, twoSteps: true, commands: [{ name: 'Actual zero exit', argv: ['node', '-e', "console.log('checked actual process')"] }] });
  const result = await runRunner({ ...f.options, advance: true, all: true }, { env, fetchImpl: f.fetchImpl });
  assert.equal(result.steps.length, 2);
  assert.equal(f.getState().workflows[0].status, 'complete');
  assert.equal(f.requests.filter(request => request.path.endsWith('/advance')).length, 2);
  assert.ok(f.getState().workflows[0].steps.every(step => step.change === null && step.verification.outcome === 'passed'));
});

test('stale receipt conflicts are never replayed and do not run subsequent checks', async t => {
  const f = await fixture(t); f.fail('analysis');
  await assert.rejects(runRunner({ ...f.options, apply: true }, { env, fetchImpl: f.fetchImpl }), /409/);
  assert.equal(f.requests.filter(request => request.path.endsWith('/receipts')).length, 1);
  assert.equal(f.getState().workflows[0].steps[0].analysis, null);
  assert.equal(git(join(f.options.workDir, 'checkout'), ['rev-parse', 'HEAD']), f.options.sourceRevision);
});

test('configuration rejects remote patches, escaping symlinks and shell-string commands', async t => {
  const f = await fixture(t);
  await writeFile(join(f.repo, 'runner.json'), JSON.stringify({ ...f.configuration, steps: [{ ...f.configuration.steps[0], commands: ['node --test'] }] }));
  await assert.rejects(loadConfiguration(f.repo, 'runner.json'), /name|argv/);
  await writeFile(join(f.repo, 'runner.json'), JSON.stringify({ ...f.configuration, steps: [{ ...f.configuration.steps[0], patch: 'https://example.com/change.patch' }] }));
  await assert.rejects(loadConfiguration(f.repo, 'runner.json'));
  await writeFile(join(f.root, 'outside.json'), JSON.stringify(f.configuration));
  await symlink(join(f.root, 'outside.json'), join(f.repo, 'outside-link.json'));
  await assert.rejects(loadConfiguration(f.repo, 'outside-link.json'), /outside/);
  assert.deepEqual(f.requests, []);
});

test('argv metacharacters stay literal, timeout reports an actual nonzero exit, and captured secrets redact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aas-argv-')); t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'injected');
  const literal = `$(touch ${marker}); echo malicious`;
  const actual = await execute(['node', '-e', 'console.log(process.argv[1])', literal], { cwd: root, env: { PATH: process.env.PATH } });
  assert.match(actual.log, /\$\(touch/);
  await assert.rejects(readFile(marker));
  const stopped = await execute(['node', '-e', 'setTimeout(()=>{},30000)'], { cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 100 });
  assert.equal(stopped.timedOut, true);
  assert.notEqual(stopped.exitCode, 0);
  const redacted = await execute(['node', '-e', "console.log('sensitive')"], { cwd: root, env: { PATH: process.env.PATH }, redact: value => value.replaceAll('sensitive', '[REDACTED]') });
  assert.equal(redacted.log.trim(), '[REDACTED]');
});

test('private connection JSON maps only three keys and environment overrides stay in control', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aas-connection-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'connection.json');
  await writeFile(file, JSON.stringify({ baseUrl: env.AAS_BASE_URL, runnerToken: 'file-runner', siteAccessToken: 'file-site', arbitrary: 'ignored' }), { mode: 0o600 });
  const mapped = await connectionEnvironment(file, { AAS_RUNNER_KEY: 'environment-runner' });
  assert.deepEqual(mapped, { AAS_BASE_URL: env.AAS_BASE_URL, AAS_RUNNER_KEY: 'environment-runner', AAS_SITES_AUTHORIZATION: 'file-site' });
  await writeFile(file, '{bad');
  await assert.rejects(connectionEnvironment(file, {}), /JSON/);
});

test('trusted tooling config and local patches can be separate from an older pinned source checkout', async t => {
  const f = await fixture(t);
  const tooling = join(f.root, 'trusted-tooling'); await mkdir(tooling);
  for (const file of ['runner.json', 'change.patch']) {
    await writeFile(join(tooling, file), await readFile(join(f.repo, file)));
    await rm(join(f.repo, file));
  }
  const result = await runRunner({ ...f.options, configRoot: tooling, apply: true }, { env, fetchImpl: f.fetchImpl });
  assert.equal(result.steps[0].outcome, 'passed');
  assert.equal(await readFile(join(f.repo, 'message.txt'), 'utf8'), 'before\n');
  assert.equal(git(f.repo, ['rev-parse', 'HEAD']), f.options.sourceRevision);
});

test('known environment and overridden file token values redact from command display and persisted evidence', async t => {
  const values = [env.AAS_RUNNER_KEY, env.AAS_SITES_AUTHORIZATION, 'file-runner-value', 'file-site-value'];
  const f = await fixture(t, { commands: [{ name: 'Known token redaction', argv: ['node', '-e', 'console.log(process.argv[1])', values.join(' ')] }] });
  const file = join(f.root, 'private-connection.json');
  await writeFile(file, JSON.stringify({ baseUrl: env.AAS_BASE_URL, runnerToken: values[2], siteAccessToken: values[3] }), { mode: 0o600 });
  const result = await runRunner({ ...f.options, apply: true, connectionConfig: file }, { env, fetchImpl: f.fetchImpl });
  assert.equal(result.steps[0].outcome, 'passed');
  const allEvidence = JSON.stringify(f.requests) + JSON.stringify(result) + await readFile(join(result.workDir, 'artifacts', result.steps[0].stepId + '-check-1.log'), 'utf8');
  for (const value of values) assert.ok(!allEvidence.includes(value));
  assert.match(allEvidence, /REDACTED/);
});
