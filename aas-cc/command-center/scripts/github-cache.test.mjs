import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { getRepositoryStatus, REPOSITORY } from '../server/github-cache.mjs';

const root = resolve(import.meta.dirname, '..');
const base = Date.parse('2026-10-16T12:00:00.000Z');
const sha = 'c'.repeat(40);
const publicUrl = 'https://github.com/' + REPOSITORY;
const json = (value, init = {}) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });

// Injected fixtures test the cache contract; they are never live build evidence.
function fixtureFetch(counter) {
  return async (url) => {
    counter.calls++;
    const path = new URL(url).pathname;
    if (path.endsWith('/commits')) return json([{ sha, html_url: publicUrl + '/commit/' + sha, commit: { message: 'Cache fixture commit', author: { name: 'Fixture Author', date: '2026-10-15T01:00:00Z' }, committer: { date: '2026-10-15T01:00:00Z' } } }]);
    if (path.endsWith('/branches')) return json([{ name: 'main', commit: { sha }, protected: false }]);
    if (path.endsWith('/actions/runs')) return json({ workflow_runs: [] });
    return json({ full_name: REPOSITORY, html_url: publicUrl, default_branch: 'main', description: 'Repository cache fixture', private: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-15T01:00:00Z', pushed_at: '2026-10-15T01:00:00Z' });
  };
}

async function database(context, { persist, initialize = true } = {}) {
  const mf = new Miniflare({
    script: 'export default { fetch() { return new Response("Cache test fixture"); } };',
    modules: true, compatibilityDate: '2025-05-01',
    d1Databases: { DB: '9c744f58-4b5e-42ed-9a31-9b1b998c1974' },
    ...(persist ? { d1Persist: persist } : {}),
  });
  let disposed = false;
  const close = async () => { if (!disposed) { disposed = true; await mf.dispose(); } };
  context.after(close);
  const db = await mf.getD1Database('DB');
  if (initialize) {
    for (const name of (await readdir(resolve(root, 'drizzle'))).filter((value) => value.endsWith('.sql')).sort()) {
      const sql = await readFile(resolve(root, 'drizzle', name), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await db.prepare('INSERT INTO aas_app_state (id, revision, document, updated_at) VALUES (?, ?, ?, ?)').bind('organization', 73, '{"fixture":"organization-state"}', new Date(base).toISOString()).run();
  }
  return { db, env: { DB: db }, close };
}

test('repository observations honor five-minute TTL and sixty-second manual cooldown without editing organization state', async (context) => {
  const { db, env } = await database(context);
  const before = await db.prepare('SELECT * FROM aas_app_state WHERE id = ?').bind('organization').first();
  const counter = { calls: 0 }, fetchImpl = fixtureFetch(counter);
  const first = await getRepositoryStatus(env, { now: base, fetchImpl });
  assert.equal(first.status, 200);
  assert.equal(first.body.cached, false);
  assert.equal(first.body.repository.checkedAt, new Date(base).toISOString());
  assert.equal(first.body.stale, false);
  assert.equal(first.body.nextRefreshAt, new Date(base + 60_000).toISOString());
  assert.equal(counter.calls, 4);

  const fresh = await getRepositoryStatus(env, { now: base + 299_999, fetchImpl });
  assert.equal(fresh.body.cached, true);
  assert.equal(counter.calls, 4);
  const expired = await getRepositoryStatus(env, { now: base + 300_000, fetchImpl });
  assert.equal(expired.body.cached, false);
  assert.equal(expired.body.repository.checkedAt, new Date(base + 300_000).toISOString());
  assert.equal(counter.calls, 8);
  const cooldown = await getRepositoryStatus(env, { force: true, now: base + 359_999, fetchImpl });
  assert.equal(cooldown.body.cached, true);
  assert.equal(counter.calls, 8);
  const allowed = await getRepositoryStatus(env, { force: true, now: base + 360_000, fetchImpl });
  assert.equal(allowed.body.cached, false);
  assert.equal(counter.calls, 12);
  assert.equal(allowed.body.nextRefreshAt, new Date(base + 420_000).toISOString());
  assert.deepEqual(await db.prepare('SELECT * FROM aas_app_state WHERE id = ?').bind('organization').first(), before);
});

test('concurrent refreshes acquire one D1 lease and issue one set of GitHub reads', async (context) => {
  const { env } = await database(context);
  const counter = { calls: 0 }, fixtures = fixtureFetch(counter);
  let release, markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  context.after(() => release());
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === '/repos/' + REPOSITORY) {
      const response = await fixtures(url, options);
      markStarted();
      await gate;
      return response;
    }
    return fixtures(url, options);
  };
  const pending = [getRepositoryStatus(env, { force: true, now: base, fetchImpl }), getRepositoryStatus(env, { force: true, now: base, fetchImpl })];
  await started;
  const losingRequest = await Promise.race(pending);
  assert.equal(counter.calls, 1);
  assert.equal(losingRequest.body.cached, true);
  assert.equal(losingRequest.body.repository, null);
  assert.equal(losingRequest.status, 503);
  release();
  const responses = await Promise.all(pending);
  assert.equal(counter.calls, 4);
  assert.equal(responses.filter((response) => response.body.cached === false).length, 1);
  assert.equal(responses.find((response) => response.status === 200).body.repository.head.sha, sha);
  const cached = await getRepositoryStatus(env, { now: base + 1, fetchImpl });
  assert.equal(cached.status, 200);
  assert.equal(cached.body.repository.head.sha, sha);
  assert.equal(counter.calls, 4);
});

test('upstream failures preserve the last snapshot and honor the refresh cooldown', async (context) => {
  const { env, db } = await database(context);
  const counter = { calls: 0 }, fixtures = fixtureFetch(counter);
  const first = await getRepositoryStatus(env, { now: base, fetchImpl: fixtures });
  const previousRow = await db.prepare('SELECT document, checked_at FROM aas_repository_cache WHERE id = ?').bind(REPOSITORY).first();
  const limitedFetch = async () => {
    counter.calls++;
    return json({ message: 'private upstream text must not be retained' }, { status: 503 });
  };
  const failed = await getRepositoryStatus(env, { force: true, now: base + 60_000, fetchImpl: limitedFetch });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.cached, true);
  assert.equal(failed.body.stale, true);
  assert.deepEqual(failed.body.repository, first.body.repository);
  assert.equal(failed.body.error.code, 'github_unavailable');
  assert.equal(failed.body.nextRefreshAt, new Date(base + 120_000).toISOString());
  assert.ok(!JSON.stringify(failed.body).includes('private upstream text'));
  assert.deepEqual(await db.prepare('SELECT document, checked_at FROM aas_repository_cache WHERE id = ?').bind(REPOSITORY).first(), previousRow);
  assert.equal(counter.calls, 5);

  for (const force of [false, true]) {
    const blocked = await getRepositoryStatus(env, { force, now: base + 119_999, fetchImpl: fixtures });
    assert.equal(blocked.body.cached, true);
    assert.equal(blocked.body.error.code, 'github_unavailable');
    assert.equal(counter.calls, 5);
  }
  const recovered = await getRepositoryStatus(env, { force: true, now: base + 120_000, fetchImpl: fixtures });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.cached, false);
  assert.equal(recovered.body.stale, false);
  assert.ok(!Object.hasOwn(recovered.body, 'error'));
  assert.equal(counter.calls, 9);
});

const publicFeedFixture = () => `<feed xmlns="http://www.w3.org/2005/Atom"><id>tag:github.com,2008:/${REPOSITORY}/commits/main</id><link rel="self" href="${publicUrl}/commits/main.atom"/><entry><id>tag:github.com,2008:Grit::Commit/${sha}</id><link rel="alternate" href="${publicUrl}/commit/${sha}"/><title>Fixture feed commit</title><updated>2026-07-10T10:55:49Z</updated><author><name>Fixture Author</name></author></entry></feed>`;
const publicFeedResponse = () => new Response(publicFeedFixture(), { headers: { 'Content-Type': 'application/atom+xml' } });

test('persisted REST rate limit without a document immediately uses public Atom and never calls REST before retryAt', async (context) => {
  const { env, db } = await database(context);
  const retryAt = new Date(base + 3_600_000).toISOString();
  await db.prepare('INSERT INTO aas_repository_cache (id, document, checked_at, attempted_at, error) VALUES (?, NULL, 0, ?, ?)').bind(REPOSITORY, base - 60_000, JSON.stringify({ code: 'github_rate_limited', message: 'Fixture REST backoff', retryAt })).run();
  const counter = { calls: 0 };
  let feedCalls = 0;
  const fetchImpl = async (url, options) => {
    if (new URL(url).hostname === 'github.com') { feedCalls++; assert.ok(!Object.hasOwn(options.headers, 'Authorization')); return publicFeedResponse(); }
    assert.ok(false, 'REST must remain untouched while its retryAt is in the future');
  };
  const initial = await getRepositoryStatus(env, { now: base, fetchImpl });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.cached, false);
  assert.equal(initial.body.stale, false);
  assert.equal(initial.body.repository.source, 'github-atom');
  assert.equal(initial.body.repository.restRetryAt, retryAt);
  assert.equal(initial.body.repository.pushedAt, null);
  assert.equal(initial.body.repository.workflowAccess, 'unavailable');
  assert.equal(initial.body.nextRefreshAt, new Date(base + 60_000).toISOString());
  assert.equal(feedCalls, 1);
  assert.equal((await getRepositoryStatus(env, { force: true, now: base + 59_999, fetchImpl })).body.cached, true);
  assert.equal(feedCalls, 1);
  await getRepositoryStatus(env, { force: true, now: base + 60_000, fetchImpl });
  assert.equal(feedCalls, 2);
  await getRepositoryStatus(env, { now: base + 359_999, fetchImpl });
  assert.equal(feedCalls, 2);
  await getRepositoryStatus(env, { now: base + 360_000, fetchImpl });
  assert.equal(feedCalls, 3);
  const restored = await getRepositoryStatus(env, { force: true, now: base + 3_600_000, fetchImpl: fixtureFetch(counter) });
  assert.equal(restored.body.repository.source, 'github-api');
  assert.equal(restored.body.repository.metadataAccess, 'available');
  assert.equal(counter.calls, 4);
});

test('new REST rate limit falls back once to live public feed and saves separate REST retry metadata', async (context) => {
  const { env } = await database(context);
  let restCalls = 0, feedCalls = 0;
  const fetchImpl = async (url) => {
    if (new URL(url).hostname === 'github.com') { feedCalls++; return publicFeedResponse(); }
    restCalls++;
    return json({ message: 'private rate limit details' }, { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '3600' } });
  };
  const initial = await getRepositoryStatus(env, { now: base, fetchImpl });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.repository.source, 'github-atom');
  assert.equal(initial.body.repository.head.sha, sha);
  assert.equal(initial.body.repository.restRetryAt, new Date(base + 3_600_000).toISOString());
  assert.equal(initial.body.stale, false);
  assert.ok(!Object.hasOwn(initial.body, 'error'));
  assert.equal(restCalls, 1);
  assert.equal(feedCalls, 1);
  await getRepositoryStatus(env, { force: true, now: base + 60_000, fetchImpl });
  assert.equal(restCalls, 1);
  assert.equal(feedCalls, 2);
});

test('repository cache survives D1 process restart independently of application revisions', async (context) => {
  const persist = await mkdtemp(resolve(tmpdir(), 'aas-github-cache-test-'));
  let reopened;
  context.after(async () => { await reopened?.close(); await rm(persist, { recursive: true, force: true }); });
  const original = await database(context, { persist });
  const initialCounter = { calls: 0 };
  await getRepositoryStatus(original.env, { now: base, fetchImpl: fixtureFetch(initialCounter) });
  assert.equal(initialCounter.calls, 4);
  await original.close();
  reopened = await database(context, { persist, initialize: false });
  const restartCounter = { calls: 0 };
  const restored = await getRepositoryStatus(reopened.env, { now: base + 30_000, fetchImpl: fixtureFetch(restartCounter) });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.cached, true);
  assert.equal(restored.body.repository.head.sha, sha);
  assert.equal(restored.body.repository.checkedAt, new Date(base).toISOString());
  assert.equal(restartCounter.calls, 0);
  const organization = await reopened.db.prepare('SELECT revision, document FROM aas_app_state WHERE id = ?').bind('organization').first();
  assert.equal(organization.revision, 73);
  assert.equal(organization.document, '{"fixture":"organization-state"}');
});
