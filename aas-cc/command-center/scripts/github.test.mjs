import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRepositorySnapshot, fetchRepositoryAtomSnapshot } from '../server/github.mjs';

// These are injected API contract fixtures, never live repository/build evidence.
const name = 'ExampleOwner/ExampleRepo';
const sha = 'a'.repeat(40), previousSha = 'b'.repeat(40);
const checkedAt = '2026-10-16T15:00:00.000Z';
const metadata = () => ({ full_name: name, html_url: 'https://github.com/' + name, default_branch: 'main', description: 'Fixture repository', private: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-15T01:00:00Z', pushed_at: '2026-10-15T01:00:00Z' });
const commit = (hash = sha) => ({ sha: hash, html_url: `https://github.com/${name}/commit/${hash}`, commit: { message: 'Fixture commit\n\nFixture details', author: { name: 'Fixture Author', date: '2026-10-14T01:00:00Z' }, committer: { name: 'Fixture Committer', date: '2026-10-15T01:00:00Z' } } });
const branches = () => [{ name: 'main', commit: { sha }, protected: true }, { name: 'feature/fixture', commit: { sha: previousSha }, protected: false }];
const workflows = () => ({ workflow_runs: [{ id: 123, name: 'Fixture Android Build', status: 'completed', conclusion: 'failure', html_url: `https://github.com/${name}/actions/runs/123`, head_sha: sha, created_at: '2026-10-15T01:00:00Z', updated_at: '2026-10-15T01:02:00Z' }] });
const json = (value, init) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });
function fixtureFetch(overrides = {}, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    const route = path.endsWith('/actions/runs') ? 'workflows' : path.endsWith('/commits') ? 'commits' : path.endsWith('/branches') ? 'branches' : 'metadata';
    if (Object.hasOwn(overrides, route)) return typeof overrides[route] === 'function' ? overrides[route](url, options) : overrides[route];
    return json({ metadata: metadata(), commits: [commit(), commit(previousSha)], branches: branches(), workflows: workflows() }[route]);
  };
}
const snapshot = (fetchImpl, patch = {}) => fetchRepositorySnapshot({ repoFullName: name, fetchImpl, now: checkedAt, ...patch });

test('GitHub snapshot reads canonical repository, commits, branches and actual workflow state', async () => {
  const calls = [];
  const result = await snapshot(fixtureFetch({}, calls), { repoFullName: name.toLowerCase() });
  assert.equal(result.fullName, name);
  assert.equal(result.source, 'github-api');
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.defaultBranch, 'main');
  assert.equal(result.private, false);
  assert.equal(result.head.sha, sha);
  assert.equal(result.head.authorName, 'Fixture Author');
  assert.equal(result.head.committedAt, '2026-10-15T01:00:00.000Z');
  assert.equal(result.commits.length, 2);
  assert.deepEqual(result.branches, [{ name: 'main', sha, protected: true }, { name: 'feature/fixture', sha: previousSha, protected: false }]);
  assert.equal(result.workflowAccess, 'available');
  assert.equal(result.workflowRuns[0].status, 'completed');
  assert.equal(result.workflowRuns[0].conclusion, 'failure');
  assert.equal(result.workflowRuns[0].headSha, sha);
  assert.ok(!Object.hasOwn(result, 'partialErrors'));
  assert.deepEqual(calls.map((call) => call.url), [
    `https://api.github.com/repos/${name.toLowerCase()}`,
    `https://api.github.com/repos/${name.toLowerCase()}/commits?per_page=6`,
    `https://api.github.com/repos/${name.toLowerCase()}/branches?per_page=20`,
    `https://api.github.com/repos/${name.toLowerCase()}/actions/runs?per_page=5`,
  ]);
});

test('optional runtime token appears only in authorization headers and redirects are disabled', async () => {
  const calls = [];
  const token = 'fixture-runtime-secret';
  const result = await snapshot(fixtureFetch({}, calls), { token });
  assert.ok(calls.every(({ url, options }) => !url.includes(token) && options.headers.Authorization === 'Bearer ' + token));
  assert.ok(calls.every(({ options }) => options.redirect === 'manual' && options.headers.Accept === 'application/vnd.github+json' && options.headers['X-GitHub-Api-Version'] === '2022-11-28' && options.headers['User-Agent'] === 'AAS-CC'));
  assert.ok(!JSON.stringify(result).includes(token));
  const publicCalls = [];
  await snapshot(fixtureFetch({}, publicCalls));
  assert.ok(publicCalls.every(({ options }) => !Object.hasOwn(options.headers, 'Authorization')));
});

test('repository inputs and token injection fail before any outgoing request', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return json(metadata()); };
  for (const repoFullName of ['https://github.com/owner/repo', '../repo', 'owner/..', 'owner/repo/extra', 'owner/repo?token=secret', 'owner%2frepo/x', 'owner/repo#x', 'owner/repo\\x', '', 'o/.' ]) {
    await assert.rejects(snapshot(fetchImpl, { repoFullName }), (error) => error.code === 'github_invalid_repository');
  }
  await assert.rejects(snapshot(fetchImpl, { token: 'secret\r\ninjected:value' }), (error) => error.status === 503 && !error.message.includes('secret'));
  assert.equal(called, false);
});

test('repository and commit failures are redacted; main endpoint redirects are never followed', async () => {
  const secret = 'fixture-private-token-and-upstream-error';
  for (const route of ['metadata', 'commits', 'branches']) {
    await assert.rejects(snapshot(fixtureFetch({ [route]: json({ message: secret }, { status: 404 }) })), (error) => error.code === 'github_unavailable' && error.status === 502 && !error.message.includes(secret));
  }
  const calls = [];
  await assert.rejects(snapshot(fixtureFetch({ metadata: new Response(null, { status: 302, headers: { Location: 'https://other.example/secret' } }) }, calls)), (error) => error.code === 'github_unavailable');
  assert.equal(calls.length, 1);
  await assert.rejects(snapshot(fixtureFetch({ commits: () => { throw new Error(secret); } })), (error) => error.code === 'github_unavailable' && !error.message.includes(secret));
});

test('rate limits expose only bounded retry metadata and workflows can be unavailable independently', async () => {
  await assert.rejects(snapshot(fixtureFetch({ metadata: json({ message: 'private provider text' }, { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Date.parse('2026-10-16T16:00:00Z') / 1000) } }) })), (error) => error.code === 'github_rate_limited' && error.status === 503 && error.retryAt === '2026-10-16T16:00:00.000Z' && !error.message.includes('private'));
  for (const status of [403, 404, 500]) {
    const result = await snapshot(fixtureFetch({ workflows: json({ message: 'private workflow error' }, { status }) }));
    assert.equal(result.workflowAccess, 'unavailable');
    assert.deepEqual(result.workflowRuns, []);
    assert.equal(result.head.sha, sha);
    assert.equal(result.partialErrors[0].resource, 'workflowRuns');
    assert.ok(!JSON.stringify(result.partialErrors).includes('private workflow error'));
  }
  const limited = await snapshot(fixtureFetch({ workflows: json({}, { status: 403, headers: { 'Retry-After': '60' } }) }));
  assert.equal(limited.partialErrors[0].code, 'github_rate_limited');
  assert.equal(limited.partialErrors[0].retryAt, '2026-10-16T15:01:00.000Z');
});

test('untrusted GitHub URLs, unexpected repositories and malformed records are rejected', async () => {
  const unsafeRepository = metadata(); unsafeRepository.html_url = 'https://other.example/repository';
  const wrongRepository = metadata(); wrongRepository.full_name = 'OtherOwner/OtherRepo';
  const unsafeCommit = commit(); unsafeCommit.html_url = `https://user:secret@github.com/${name}/commit/${sha}`;
  const unsafeWorkflow = workflows(); unsafeWorkflow.workflow_runs[0].html_url = 'https://github.com/OtherOwner/OtherRepo/actions/runs/123';
  await assert.rejects(snapshot(fixtureFetch({ metadata: json(unsafeRepository) })), (error) => error.code === 'github_unavailable');
  await assert.rejects(snapshot(fixtureFetch({ metadata: json(wrongRepository) })), (error) => error.code === 'github_unavailable');
  await assert.rejects(snapshot(fixtureFetch({ commits: json([unsafeCommit]) })), (error) => error.code === 'github_unavailable');
  const unavailableWorkflow = await snapshot(fixtureFetch({ workflows: json(unsafeWorkflow) }));
  assert.equal(unavailableWorkflow.workflowAccess, 'unavailable');
  assert.equal(unavailableWorkflow.workflowRuns.length, 0);
});

test('empty API lists remain empty and do not invent builds or a repository head', async () => {
  const result = await snapshot(fixtureFetch({ commits: json([]), branches: json([]), workflows: json({ workflow_runs: [] }) }));
  assert.equal(result.head, null);
  assert.deepEqual(result.commits, []);
  assert.deepEqual(result.branches, []);
  assert.deepEqual(result.workflowRuns, []);
  assert.equal(result.workflowAccess, 'available');
});

test('JSON size and parsing limits fail safely without exposing upstream content', async () => {
  for (const response of [new Response('private-invalid-json'), new Response('{}', { headers: { 'Content-Length': String(512 * 1024 + 1) } }), new Response('x'.repeat(512 * 1024 + 1))]) {
    await assert.rejects(snapshot(fixtureFetch({ metadata: response })), (error) => error.code === 'github_unavailable' && !error.message.includes('private-invalid-json'));
  }
});

test('whole-operation deadline includes stalled subordinate requests', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, started;
  const subordinateStarted = new Promise((resolve) => { started = resolve; });
  const pending = snapshot(fixtureFetch({ commits: (_, options) => { signal = options.signal; started(); return new Promise(() => {}); } }));
  await subordinateStarted;
  context.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await assert.rejects(pending, (error) => error.code === 'github_unavailable' && error.status === 503);
  assert.equal(signal.aborted, true);
});

const atomFixture = () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>tag:github.com,2008:/${name}/commits/main</id>
<link rel="self" href="https://github.com/${name}/commits/main.atom"/>
<updated>2026-07-10T10:55:49Z</updated>
<entry><id>tag:github.com,2008:Grit::Commit/${sha}</id>
<link href="https://github.com/${name}/commit/${sha}" rel="alternate"/>
<title>Fix &#x26; improve &lt;content&gt;</title><updated>2026-07-10T10:55:49Z</updated>
<author><name>Fixture &amp; Author</name></author><content type="html">Ignored &lt;pre&gt;content&lt;/pre&gt;</content></entry>
</feed>`;
const atomResponse = (xml = atomFixture()) => new Response(xml, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } });

test('public Atom observations retain actual commit dates while metadata and build access stay unavailable', async () => {
  let request;
  const result = await fetchRepositoryAtomSnapshot({ repoFullName: name, now: checkedAt, restRetryAt: '2026-10-16T16:00:00Z', fetchImpl: async (url, options) => { request = { url, options }; return atomResponse(); } });
  assert.equal(request.url, 'https://github.com/' + name + '/commits.atom');
  assert.equal(request.options.redirect, 'manual');
  assert.equal(request.options.headers.Accept, 'application/atom+xml');
  assert.ok(!Object.hasOwn(request.options.headers, 'Authorization'));
  assert.equal(result.source, 'github-atom');
  assert.equal(result.defaultBranch, 'main');
  assert.equal(result.head.sha, sha);
  assert.equal(result.head.message, 'Fix & improve <content>');
  assert.equal(result.head.authorName, 'Fixture & Author');
  assert.equal(result.head.committedAt, '2026-07-10T10:55:49.000Z');
  assert.equal(result.checkedAt, checkedAt);
  for (const key of ['description', 'private', 'createdAt', 'updatedAt', 'pushedAt']) assert.equal(result[key], null);
  for (const key of ['metadataAccess', 'branchAccess', 'workflowAccess']) assert.equal(result[key], 'unavailable');
  assert.deepEqual(result.branches, []);
  assert.deepEqual(result.workflowRuns, []);
  assert.equal(result.partialErrors.length, 3);
  assert.equal(result.restRetryAt, '2026-10-16T16:00:00.000Z');
});

test('Atom fallback does not guess a branch or accept unsafe feed identities, links, entities or dates', async () => {
  const unknownBranch = atomFixture().replace('/commits/main</id>', '/commits</id>').replace(/<link rel="self"[^>]*\/>/, '');
  const result = await fetchRepositoryAtomSnapshot({ repoFullName: name, now: checkedAt, fetchImpl: async () => atomResponse(unknownBranch) });
  assert.equal(result.defaultBranch, null);
  const invalid = [
    atomFixture().replace('<feed ', '<!DOCTYPE feed [<!ENTITY external SYSTEM "https://other.example/private">]><feed '),
    atomFixture().replace(`/${name}/commits/main</id>`, '/OtherOwner/OtherRepo/commits/main</id>'),
    atomFixture().replace(`https://github.com/${name}/commit/${sha}`, 'https://other.example/commit/' + sha),
    atomFixture().replace('Fix &#x26;', 'Fix &unrecognized;'),
    atomFixture().replace('<updated>2026-07-10T10:55:49Z</updated>\n<author>', '<updated>not-a-date</updated>\n<author>'),
  ];
  for (const xml of invalid) await assert.rejects(fetchRepositoryAtomSnapshot({ repoFullName: name, fetchImpl: async () => atomResponse(xml) }), (error) => error.code === 'github_unavailable');
});

test('Atom requests reject redirects, non-XML pages and oversized feeds without exposing upstream details', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: 'https://other.example/private' } }),
    new Response('private upstream HTML'),
    atomResponse('x'.repeat(512 * 1024 + 1)),
  ]) await assert.rejects(fetchRepositoryAtomSnapshot({ repoFullName: name, fetchImpl: async () => response }), (error) => error.code === 'github_unavailable' && !error.message.includes('private upstream'));
});
