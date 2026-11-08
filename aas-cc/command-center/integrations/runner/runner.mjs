#!/usr/bin/env node
// Trusted operator configuration only. No command, patch URL, or secret is accepted from HTTP.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, realpath, lstat, readlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname, basename, sep } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const inside = (root, path) => { const child = relative(root, path); return child !== '' && !child.startsWith('..' + sep) && child !== '..' && !isAbsolute(child); };
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const connectionSecrets = Symbol('connectionSecrets');

export async function connectionEnvironment(path, env) {
  if (!path) return env;
  const info = await lstat(resolve(path));
  requireThat(info.isFile() && info.size <= 16384, 'Connection configuration must be a bounded regular JSON file.');
  let input; try { input = JSON.parse(await readFile(resolve(path), 'utf8')); } catch { throw new Error('Invalid private connection configuration JSON.'); }
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Invalid private connection configuration.');
  const result = { ...env };
  for (const [field, key] of [['baseUrl', 'AAS_BASE_URL'], ['runnerToken', 'AAS_RUNNER_KEY'], ['siteAccessToken', 'AAS_SITES_AUTHORIZATION']]) {
    requireThat(typeof input[field] === 'string' && input[field].trim(), 'Private connection configuration is incomplete.');
    if (!result[key]) result[key] = input[field];
  }
  Object.defineProperty(result, connectionSecrets, { value: [input.runnerToken, input.siteAccessToken] });
  return result;
}

function childEnvironment(env, home) {
  const result = { HOME: home, USERPROFILE: home, CI: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT']) if (typeof env[key] === 'string') result[key] = env[key];
  return result;
}

/** shell:false is intentional. Secret-bearing runner environment is never inherited. */
export async function execute(argv, { cwd, env, timeoutMs = 120000, redact = value => value } = {}) {
  requireThat(Array.isArray(argv) && argv.length > 0 && argv.every(value => typeof value === 'string' && !value.includes('\0')), 'An explicit argv array is required.');
  return new Promise(resolveResult => {
    const startedAt = new Date().toISOString();
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let bytes = 0; let totalBytes = 0; let timedOut = false; let spawnError = null; let killer;
    const fullDigest = createHash('sha256');
    const collect = chunk => {
      fullDigest.update(chunk); totalBytes += chunk.length;
      if (bytes < MAX_LOG_BYTES) { const kept = chunk.subarray(0, MAX_LOG_BYTES - bytes); chunks.push(kept); bytes += kept.length; }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => { spawnError = 'The configured executable could not be started.'; });
    const kill = signal => { try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); killer = setTimeout(() => kill('SIGKILL'), 1000); }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const log = redact((spawnError ? spawnError + '\n' : '') + raw);
      resolveResult({ exitCode: Number.isInteger(code) && code >= 0 && code <= 255 ? code : -1, signal: signal ?? null, timedOut, startedAt, finishedAt: new Date().toISOString(), totalBytes, truncated: totalBytes > bytes, outputSha256: fullDigest.digest('hex'), log, logSha256: digest(log) });
    });
  });
}

async function localFile(repo, path, maxBytes) {
  requireThat(typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\0'), 'Configuration and patches must use repository-relative local paths.');
  const file = await realpath(resolve(repo, path));
  requireThat(inside(repo, file), 'Local input resolves outside the repository.');
  const stat = await lstat(file);
  requireThat(stat.isFile() && stat.size <= maxBytes, 'Local input must be a bounded regular file.');
  return { file, data: await readFile(file) };
}

export async function loadConfiguration(repo, path) {
  const { data } = await localFile(repo, path, 1024 * 1024);
  let config; try { config = JSON.parse(data.toString('utf8')); } catch { throw new Error('Runner configuration must be valid JSON.'); }
  requireThat(config?.version === 1 && typeof config.repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository), 'Configuration requires version:1 and owner/repository.');
  requireThat(Array.isArray(config.steps) && config.steps.length > 0 && config.steps.length <= 30, 'Configure between 1 and 30 steps.');
  for (const step of config.steps) {
    requireThat((id(step.stepId) && step.stepIndex === undefined) || (Number.isInteger(step.stepIndex) && step.stepIndex >= 0 && step.stepIndex < 30 && step.stepId === undefined), 'Each configured step needs exactly one stepId or stepIndex.');
    requireThat(Array.isArray(step.commands) && step.commands.length > 0 && step.commands.length <= 8, 'Each step requires 1–8 explicit test commands.');
    for (const command of step.commands) {
      requireThat(typeof command.name === 'string' && command.name.trim() && command.name.length <= 160, 'Each command needs a short name.');
      requireThat(Array.isArray(command.argv) && command.argv.length > 0 && command.argv.length <= 64 && command.argv.every(arg => typeof arg === 'string' && !arg.includes('\0') && arg.length <= 4096), 'Commands must be explicit bounded argv arrays, never shell strings.');
      requireThat(JSON.stringify(command.argv).length <= 1000, 'Command display exceeds the receipt limit.');
      requireThat(command.timeoutMs === undefined || (Number.isInteger(command.timeoutMs) && command.timeoutMs >= 100 && command.timeoutMs <= 1800000), 'Command timeout must be 100–1800000 ms.');
      requireThat(command.cwd === undefined || (typeof command.cwd === 'string' && !isAbsolute(command.cwd)), 'Command cwd must be repository-relative.');
    }
    if (step.patch !== undefined) await localFile(repo, step.patch, 8 * 1024 * 1024);
  }
  const keys = config.steps.map(step => step.stepId ?? `index-${step.stepIndex}`);
  requireThat(new Set(keys).size === keys.length, 'Configured step selectors must be unique.');
  return config;
}

function apiClient(env, fetchImpl) {
  let base; try { base = new URL(env.AAS_BASE_URL); } catch { throw new Error('Set AAS_BASE_URL to the private HTTPS site origin.'); }
  requireThat(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'AAS_BASE_URL must be an HTTPS origin without credentials or a path.');
  for (const key of ['AAS_RUNNER_KEY', 'AAS_SITES_AUTHORIZATION']) requireThat(typeof env[key] === 'string' && env[key].trim() && !/[\r\n]/.test(env[key]), `Set ${key} in the runner environment.`);
  return async (path, payload) => {
    let response;
    try { response = await fetchImpl(new URL(path, base), { method: payload ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'X-AAS-Runner-Key': env.AAS_RUNNER_KEY, 'OAI-Sites-Authorization': env.AAS_SITES_AUTHORIZATION, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) }); }
    catch { throw new Error('Runner API transport failed or timed out; no write will be replayed.'); }
    requireThat(response.ok, `Runner API rejected the request (HTTP ${response.status}); no write will be replayed.`);
    let bytes = 0; const chunks = [];
    if (response.body) for await (const chunk of response.body) { bytes += chunk.length; requireThat(bytes <= 2 * 1024 * 1024, 'Runner API response exceeds the size limit.'); chunks.push(Buffer.from(chunk)); }
    const raw = Buffer.concat(chunks).toString('utf8');
    try { return JSON.parse(raw); } catch { throw new Error('Runner API returned an invalid JSON response.'); }
  };
}

async function analyze(checkout, git, sourceRevision) {
  const listing = await git(['ls-files', '-z']);
  const files = listing.split('\0').filter(Boolean);
  requireThat(files.length <= 20000, 'Tracked file count exceeds the analysis bound.');
  let totalBytes = 0; let textFiles = 0; let todoMarkers = 0; const manifest = [];
  for (const path of files) {
    const file = resolve(checkout, path);
    requireThat(inside(checkout, file), 'Tracked file path escaped the checkout.');
    const stat = await lstat(file);
    if (stat.isDirectory()) { manifest.push({ path, kind: 'submodule', initialized: false }); continue; }
    requireThat(stat.isFile() || stat.isSymbolicLink(), 'Unsupported tracked file type.');
    requireThat(stat.size <= 16 * 1024 * 1024, 'A tracked file exceeds the 16 MiB analysis bound.');
    const data = stat.isSymbolicLink() ? Buffer.from(await readlink(file)) : await readFile(file);
    totalBytes += data.length;
    requireThat(totalBytes <= 128 * 1024 * 1024, 'Source analysis exceeds 128 MiB.');
    if (!stat.isSymbolicLink() && data.length <= 1024 * 1024 && !data.includes(0)) { textFiles++; todoMarkers += (data.toString('utf8').match(/\b(?:TODO|FIXME)\b/g) ?? []).length; }
    manifest.push({ path, kind: stat.isSymbolicLink() ? 'symlink-target' : 'file', bytes: data.length, sha256: digest(data) });
  }
  const gitStatus = await git(['status', '--porcelain=v1', '--untracked-files=all']);
  requireThat(!gitStatus.trim(), 'Analysis requires a clean isolated checkout.');
  return { sourceRevision, fileCount: files.length, textFiles, totalBytes, todoMarkers, manifestSha256: digest(JSON.stringify(manifest)), manifest, gitStatus, scope: 'Tracked file bytes and symlink targets; uninitialized submodules are listed, not analyzed. TODO/FIXME is a count, not semantic or AI review.' };
}

/** Run actual work in a fresh clone. Never modifies the input repository or pushes. */
export async function runRunner(options, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  env = await connectionEnvironment(options.connectionConfig, env);
  requireThat(id(options.workflowId), 'Provide --workflow with a valid workflow id.');
  requireThat(!options.stepId || id(options.stepId), 'Invalid step id.');
  requireThat(!options.sourceRevision || sha(options.sourceRevision), 'Source revision must be a full commit SHA.');
  requireThat(!options.all || options.advance, '--all requires explicit --advance.');
  const repo = await realpath(resolve(options.repo ?? '.'));
  const configRoot = await realpath(resolve(options.configRoot ?? repo));
  const config = await loadConfiguration(configRoot, options.config);
  const api = apiClient(env, fetchImpl);
  const secretValues = [...(env[connectionSecrets] ?? []), env.AAS_RUNNER_KEY, env.AAS_SITES_AUTHORIZATION].filter(Boolean);
  const redact = value => secretValues.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value));
  const redactObject = value => typeof value === 'string' ? redact(value) : Array.isArray(value) ? value.map(redactObject) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObject(item)])) : value;
  let workDir;
  if (options.workDir) { workDir = join(await realpath(dirname(resolve(options.workDir))), basename(options.workDir)); requireThat(workDir !== repo && !inside(repo, workDir) && workDir !== configRoot && !inside(configRoot, workDir), 'Work directory must be outside the source and configuration repositories.'); await mkdir(workDir); }
  else workDir = await mkdtemp(join(tmpdir(), 'aas-runner-'));
  await mkdir(join(workDir, 'home')); await mkdir(join(workDir, 'artifacts'));
  const commandEnv = childEnvironment(env, join(workDir, 'home'));
  const checkout = join(workDir, 'checkout');
  const runGit = async (args, cwd = checkout) => {
    const result = await execute(['git', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: commandEnv, timeoutMs: 120000, redact });
    requireThat(result.exitCode === 0, `Git operation failed: ${args[0]} (details withheld; local artifacts remain in ${workDir}).`);
    requireThat(!result.truncated, 'Git output exceeded the 4 MiB bound; refusing incomplete evidence.');
    return result.log;
  };
  const context = async () => {
    const value = await api(`/api/v1/runner/context?workflowId=${encodeURIComponent(options.workflowId)}`);
    requireThat(Number.isSafeInteger(value.revision) && value.revision >= 0 && value.workflow?.id === options.workflowId && value.currentStep?.id === value.workflow.steps?.[value.workflow.currentStepIndex]?.id, 'Runner context is inconsistent.');
    requireThat(value.workflow.repository === config.repository && sha(value.workflow.sourceRevision), 'Workflow repository or source does not match runner configuration.');
    return value;
  };
  let current = await context();
  requireThat(current.workflow.status !== 'complete', 'Workflow is already complete.');
  requireThat(!options.stepId || current.currentStep.id === options.stepId, 'Requested step is not the current unlocked step.');
  requireThat(!options.sourceRevision || current.workflow.sourceRevision === options.sourceRevision.toLowerCase(), 'Pinned SHA does not match current workflow source.');
  const initialRevision = current.workflow.sourceRevision;
  await runGit(['clone', '--no-local', '--no-checkout', '--no-hardlinks', '--', repo, checkout], workDir);
  await runGit(['checkout', '--detach', initialRevision]);
  requireThat((await runGit(['rev-parse', 'HEAD'])).trim() === initialRevision, 'Checkout did not resolve to the pinned SHA.');
  const runnerId = options.runnerId ?? `runner-${hostname().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 70)}`;
  requireThat(id(runnerId), 'Invalid runner id.');
  const post = async (phase, payload) => {
    const receiptId = `receipt-${randomUUID()}`;
    await api('/api/v1/runner/receipts', { expectedRevision: current.revision, receipt: redactObject({ workflowId: options.workflowId, stepId: current.currentStep.id, stepRevision: current.currentStep.revision, runnerId, receiptId, phase, ...payload }) });
    current = await context();
    return receiptId;
  };
  const result = { workDir, checkout, repositoryUpdated: false, pushed: false, steps: [] };
  for (let count = 0; count < 30; count++) {
    const stepId = current.currentStep.id;
    const selected = config.steps.find(step => step.stepId === stepId || step.stepIndex === current.workflow.currentStepIndex);
    requireThat(selected, 'No operator-approved configuration exists for the current step.');
    const prefix = join(workDir, 'artifacts', stepId);
    const sourceRevision = (await runGit(['rev-parse', 'HEAD'])).trim();
    requireThat(sourceRevision === current.workflow.sourceRevision, 'Local checkout no longer matches workflow source.');
    const analysis = await analyze(checkout, args => runGit(args), sourceRevision);
    await writeFile(prefix + '-analysis.json', JSON.stringify(analysis, null, 2));
    const { manifest, ...summary } = analysis;
    await post('analysis', { sourceRevision, outcome: 'passed', summary: `Read ${analysis.fileCount} tracked entries at pinned ${sourceRevision}. Static inventory only; no semantic AI claims.`, evidence: [{ kind: 'report', label: 'Actual source inventory and git status', content: JSON.stringify(summary, null, 2), sha256: digest(JSON.stringify(analysis, null, 2)) }] });
    if (current.workflow.mode === 'change') {
      if (!options.apply || !selected.patch) {
        await post('implementation', { sourceRevision, outcome: 'blocked', changeType: 'modification', summary: 'No code change was made: provide an approved local patch and explicitly enable --apply.', evidence: [{ kind: 'report', label: 'Local change authorization', content: 'Patch application and local commit require both a configured repository-relative patch and --apply. No remote write exists in this runner.' }] });
        result.steps.push({ stepId, sourceRevision, outcome: 'blocked' });
        return result;
      }
      const patch = await localFile(configRoot, selected.patch, 8 * 1024 * 1024);
      const copiedPatch = join(workDir, 'operator.patch'); await writeFile(copiedPatch, patch.data);
      await runGit(['apply', '--check', '--', copiedPatch]);
      await runGit(['apply', '--index', '--', copiedPatch]);
      const diff = await runGit(['diff', '--cached', '--binary', '--no-ext-diff']);
      requireThat(diff.trim(), 'Approved patch did not create a staged change.');
      await writeFile(prefix + '-change.patch', diff);
      const changeStatus = await runGit(['diff', '--cached', '--name-status']);
      const added = changeStatus.split('\n').some(line => /^A\t/.test(line));
      const modified = changeStatus.split('\n').some(line => /^[^A]\t/.test(line));
      await runGit(['-c', 'user.name=AAS Local Runner', '-c', 'user.email=aas-runner@localhost', '-c', 'commit.gpgSign=false', 'commit', '-m', `AAS local change ${stepId}`]);
      const changedRevision = (await runGit(['rev-parse', 'HEAD'])).trim();
      await runGit(['bundle', 'create', join(workDir, 'local-changes.bundle'), `${initialRevision}..HEAD`]);
      await post('implementation', { sourceRevision: changedRevision, outcome: 'passed', changeType: added && modified ? 'both' : added ? 'addition' : 'modification', summary: `Applied the operator patch and created local commit ${changedRevision} in an isolated checkout. Nothing was pushed; GitHub is unchanged.`, evidence: [{ kind: 'diff', label: 'Actual local staged change (excerpt)', content: redact(diff).slice(0, 7800), sha256: digest(diff) }, { kind: 'report', label: 'Patch and local commit identity', content: JSON.stringify({ inputPatchSha256: digest(patch.data), localCommit: changedRevision, originalCommit: sourceRevision, gitHubUpdated: false, pushed: false }) }] });
    }
    const verificationSha = (await runGit(['rev-parse', 'HEAD'])).trim();
    const checks = []; const evidence = []; let failed = false;
    for (let index = 0; index < selected.commands.length; index++) {
      const command = selected.commands[index];
      const cwd = command.cwd ? await realpath(resolve(checkout, command.cwd)) : checkout;
      requireThat(cwd === checkout || inside(checkout, cwd), 'Configured command directory escaped the isolated checkout.');
      const output = await execute(command.argv, { cwd, env: commandEnv, timeoutMs: command.timeoutMs ?? 120000, redact });
      await writeFile(`${prefix}-check-${index + 1}.log`, output.log);
      const { log, ...metadata } = output;
      await writeFile(`${prefix}-check-${index + 1}.json`, JSON.stringify(metadata, null, 2));
      checks.push({ name: redact(command.name), command: redact(JSON.stringify(command.argv)), exitCode: output.exitCode, evidenceIndex: evidence.length });
      evidence.push({ kind: 'log', label: command.name, content: JSON.stringify(metadata) + '\n--- actual output excerpt ---\n' + (log || '(no stdout/stderr)').slice(0, 6800), sha256: output.logSha256 });
      failed ||= output.exitCode !== 0;
    }
    const afterTestsSha = (await runGit(['rev-parse', 'HEAD'])).trim();
    const dirty = await runGit(['status', '--porcelain=v1', '--untracked-files=all']);
    if (afterTestsSha !== verificationSha || dirty.trim()) {
      failed = true; checks.push({ name: 'Checkout remained pinned and clean', command: 'git rev-parse HEAD; git status --porcelain=v1', exitCode: 1, evidenceIndex: evidence.length });
      evidence.push({ kind: 'report', label: 'Verification changed source', content: JSON.stringify({ expectedCommit: verificationSha, observedCommit: afterTestsSha, gitStatus: dirty.slice(0, 6000) }), sha256: digest(dirty) });
    }
    const verificationReceiptId = await post('verification', { sourceRevision: verificationSha, outcome: failed ? 'failed' : 'passed', summary: failed ? 'Configured checks failed or changed the pinned checkout. The gate remains closed.' : 'All configured argv checks exited 0 and the checkout remained pinned and clean.', checks, evidence });
    result.steps.push({ stepId, sourceRevision: verificationSha, outcome: failed ? 'failed' : 'passed', checks });
    if (failed || !options.advance) return result;
    await api('/api/v1/runner/advance', { expectedRevision: current.revision, workflowId: options.workflowId, stepId, runnerId, verificationReceiptId });
    current = await context();
    if (!options.all || current.workflow.status === 'complete') return result;
  }
  throw new Error('Maximum configured workflow length exceeded.');
}

function cliOptions(argv) {
  const options = {}; const names = { '--repo': 'repo', '--config': 'config', '--config-root': 'configRoot', '--workflow': 'workflowId', '--step': 'stepId', '--source-revision': 'sourceRevision', '--work-dir': 'workDir', '--runner-id': 'runnerId', '--connection-config': 'connectionConfig' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--apply', '--advance', '--all'].includes(arg)) options[arg.slice(2)] = true;
    else if (names[arg]) { requireThat(argv[index + 1] && !argv[index + 1].startsWith('--'), `Missing value for ${arg}.`); options[names[arg]] = argv[++index]; }
    else throw new Error(`Unknown runner option: ${arg}`);
  }
  requireThat(options.config, 'Provide --config with an operator-reviewed repository-relative JSON file.');
  return options;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runRunner(cliOptions(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    if (result.steps.some(step => step.outcome !== 'passed')) process.exitCode = 1;
  } catch (error) { console.error(`AAS runner stopped: ${error.message}`); process.exitCode = 1; }
}
