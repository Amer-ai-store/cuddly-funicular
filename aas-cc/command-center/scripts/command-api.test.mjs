import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { applyOperation, readSnapshot } from '../integrations/database-bridge/bridge.mjs';

const root = resolve(import.meta.dirname, '..');
const site = 'https://command-api-fixture.example';
const appKey = 'isolated-command-app-service-fixture';
const runnerKey = 'isolated-command-runner-fixture';
const providerKey = 'isolated_Gemini_fixture_key_12345678901234567890';
const encryptionKey = '41'.repeat(32);
const model = 'fixture-command-model';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

async function fixture(t) {
  const outgoing = [], defaultFetches = [];
  let generated = 0;
  // Every provider/GitHub response is an isolated service-binding fixture.
  // A default fetch is blocked locally so these tests cannot contact external services.
  const fixtureHttp = async request => {
    const url = new URL(request.url);
    outgoing.push({ host: url.hostname, path: url.pathname, method: request.method });
    if (url.hostname === 'generativelanguage.googleapis.com') {
      assert.equal(request.headers.get('x-goog-api-key'), providerKey);
      assert.equal(request.headers.has('Authorization'), false);
      if (request.method === 'GET') {
        if(url.pathname==='/v1beta/models')return json({models:[{name:'models/'+model,displayName:'Catalog fixture',supportedGenerationMethods:['generateContent']}]});
        assert.equal(url.pathname, '/v1beta/models/' + model);
        return json({ name: 'models/' + model, supportedGenerationMethods: ['generateContent'] });
      }
      assert.equal(request.method, 'POST');
      assert.equal(url.pathname, '/v1beta/models/' + model + ':generateContent');
      const input = await request.json();
      assert.ok(!JSON.stringify(input).includes(providerKey), 'A provider credential must not enter its model prompt');
      generated++;
      return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        assistantMessage: 'مقترح fixture غير منفذ. يجب حجب قيمة الإرجاع: ' + providerKey,
        proposals: [{ title: 'اقتراح مهمة fixture ' + generated, operation: 'addTask', payload: {
          title: 'API fixture proposed task ' + generated, workspaceId: 'ws-commerce', agentId: 'agent-catalog', priority: 'medium',
        } }],
      }) }] } }] });
    }
    assert.ok(['api.github.com', 'github.com'].includes(url.hostname), 'Unexpected outgoing service requested by the Worker');
    return json({ message: 'Isolated GitHub fixture unavailable' }, 503);
  };
  const mf = new Miniflare({
    scriptPath: resolve(root, 'dist/server/index.js'), modules: true, compatibilityDate: '2025-05-01',
    d1Databases: ['DB'],
    bindings: { AAS_API_TOKEN: appKey, AAS_RUNNER_TOKEN: runnerKey, AAS_SECRET_ENCRYPTION_KEY: encryptionKey,
      AAS_PRIVATE_SITE_BEARER: 'isolated-command-private-gateway-fixture', AAS_PUBLIC_ORIGIN: site },
    serviceBindings: { GITHUB_API_HTTP: fixtureHttp },
    outboundService: async request => { defaultFetches.push(new URL(request.url).hostname); return json({ message: 'External network blocked by test' }, 503); },
  });
  const directory = await mkdtemp(join(tmpdir(), 'aas-command-api-'));
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const db = await mf.getD1Database('DB');
  const migrations = (await readdir(resolve(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length >= 3, 'The Worker tests must include the independent control-record migration');
  for (const name of migrations) {
    for (const statement of (await readFile(resolve(root, 'drizzle', name), 'utf8')).split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  async function request(path, { method = 'GET', data, identity = 'owner', headers = {} } = {}) {
    const actor = identity === 'owner' ? { 'oai-authenticated-user-id': 'isolated-command-owner' }
      : identity === 'service' ? { 'X-AAS-API-Key': appKey }
        : identity === 'runner' ? { 'X-AAS-Runner-Key': runnerKey } : {};
    const response = await mf.dispatchFetch(site + '/api/v1' + path, {
      method, headers: { ...actor, ...(data !== undefined ? { 'Content-Type': 'application/json', Origin: site } : {}), ...headers },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    return { response, body: await response.json() };
  }
  const org = () => db.prepare('SELECT revision,document,updated_at FROM aas_app_state WHERE id=?').bind('organization').first();
  const controlRow = id => db.prepare('SELECT revision,document,updated_at FROM aas_control_records WHERE id=?').bind(id).first();
  const assertNoPlainSecrets = async () => {
    const saved = JSON.stringify((await db.prepare('SELECT id,document FROM aas_control_records').all()).results);
    for (const secret of [providerKey, encryptionKey, appKey, runnerKey]) assert.ok(!saved.includes(secret), 'A runtime credential was stored as plaintext');
  };
  const state = async () => (await request('/state')).body;
  const chat = (requestId, message = 'أضف مهمة مراجعة للكتالوج') => request('/assistant/chat', { method: 'POST', data: { requestId, message } });
  const initial = await state();
  return { mf, db, directory, request, state, chat, org, controlRow, assertNoPlainSecrets, initial, outgoing, defaultFetches,
    get generated() { return generated; } };
}

test('owner-private command API persists real provider/chat/proposal/database records with narrow credentials and atomic writes', async t => {
  const f = await fixture(t);
  const initialOrganization = await f.org();
  let proposal, appliedState;

  await t.test('assistant/provider/history/database APIs deny app, runner, and anonymous credentials', async () => {
    const routes = [
      ['/assistant/capabilities', 'GET'], ['/assistant/history', 'GET'], ['/assistant/provider/health', 'GET'], ['/database', 'GET'],
      ['/assistant/provider', 'POST'], ['/assistant/provider/models', 'POST'], ['/assistant/provider/test', 'POST'], ['/assistant/chat', 'POST'], ['/assistant/apply', 'POST'],
      ['/database/bridges', 'POST'], ['/database/operations', 'POST'],
    ];
    for (const identity of ['service', 'runner', 'anonymous']) {
      for (const [path, method] of routes) {
        const result = await f.request(path, { identity, method, ...(method === 'POST' ? { data: {} } : {}) });
        assert.equal(result.response.status, identity === 'service' ? 403 : 401, `${identity} must not reach ${path}`);
        assert.ok(!Object.hasOwn(result.body, 'state'));
        assert.ok(!Object.hasOwn(result.body, 'messages'));
        assert.ok(!JSON.stringify(result.body).includes(providerKey));
      }
    }
    for (const path of ['/assistant/provider', '/assistant/provider/models', '/assistant/provider/test', '/assistant/chat', '/database/bridges']) {
      const rejected = await f.request(path, { method: 'POST', data: {}, headers: { Origin: 'https://cross-site-fixture.example' } });
      assert.equal(rejected.response.status, 403);
      assert.equal(rejected.body.error.code, 'cross_site_request');
    }
    assert.equal(f.outgoing.length, 0);
    assert.deepEqual(await f.org(), initialOrganization);
  });

  await t.test('missing provider saves a labeled local-advisor history without creating an LLM run or organization write', async () => {
    const capabilities = await f.request('/assistant/capabilities');
    assert.equal(capabilities.response.status, 200);
    assert.equal(capabilities.body.configured, false);
    const result = await f.chat('missing-provider-message');
    assert.equal(result.response.status, 503);
    assert.equal(result.body.provider, 'local-advisor');
    assert.equal(result.body.model, null);
    assert.equal(result.body.error.code, 'provider_not_configured');
    assert.deepEqual(result.body.proposals, []);
    assert.equal(result.body.contextSummary.counts.agents, 9);
    const history = await f.request('/assistant/history');
    assert.equal(history.body.messages.length, 2);
    assert.equal(history.body.messages[1].provider, 'local-advisor');
    assert.equal(history.body.messages[1].model, null);
    assert.equal((await f.chat('missing-provider-message')).body.messageId, result.body.messageId);
    assert.equal((await f.request('/assistant/history')).body.messages.length, 2);
    const conflict = await f.chat('missing-provider-message', 'رسالة مختلفة للمعرّف نفسه');
    assert.equal(conflict.response.status, 409);
    const current = await f.state();
    assert.equal(current.state.agents.length, 9);
    assert.ok(current.state.agents.every(agent => agent.model === 'غير متصل'));
    assert.deepEqual(current.state.runs, []);
    assert.equal(f.outgoing.length, 0);
    assert.deepEqual(await f.org(), initialOrganization);
  });

  await t.test('owner provider verification uses the real HTTP contract and stores only AES-GCM ciphertext', async () => {
    const result = await f.request('/assistant/provider', { method: 'POST', data: { apiKey: providerKey, model } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.configured, true);
    assert.equal(result.body.storage, 'encrypted-server');
    assert.equal(result.body.model, model);
    assert.deepEqual(result.body.availableModels, [model]);
    assert.ok(Number.isFinite(Date.parse(result.body.lastTestedAt)));
    assert.ok(!JSON.stringify(result.body).includes(providerKey));
    assert.ok(!JSON.stringify(result.body).includes(encryptionKey));
    const stored = JSON.parse((await f.controlRow('provider-gemini')).document);
    assert.equal(stored.encryptedKey.algorithm, 'AES-GCM');
    assert.ok(stored.encryptedKey.iv && stored.encryptedKey.ciphertext);
    assert.notEqual(stored.encryptedKey.ciphertext, providerKey);
    const reread = await f.request('/assistant/capabilities');
    assert.equal(reread.body.configured, true);
    assert.ok(!Object.hasOwn(reread.body, 'apiKey'));
    assert.ok(!Object.hasOwn(reread.body, 'encryptedKey'));
    assert.ok(!JSON.stringify(reread.body).includes(providerKey));
    assert.equal(f.outgoing.filter(call => call.host === 'generativelanguage.googleapis.com' && call.method === 'GET').length, 1);
    await f.assertNoPlainSecrets();
    assert.deepEqual(await f.org(), initialOrganization);
  });

  await t.test('configured generation saves redacted history and a pending proposal without applying it', async () => {
    const result = await f.chat('one-pending-proposal', 'أضف مهمة مراجعة، واحجب المفتاح المرفق ' + providerKey);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.provider, 'gemini');
    assert.equal(result.body.model, model);
    assert.equal(result.body.contextSummary.counts.agents, 9);
    assert.ok(!JSON.stringify(result.body).includes(providerKey));
    assert.match(result.body.assistantMessage, /سر محجوب/);
    assert.equal(result.body.proposals.length, 1);
    proposal = result.body.proposals[0];
    assert.equal(proposal.operation, 'addTask');
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.requiresConfirmation, true);
    assert.equal(proposal.baseRevision, f.initial.revision);
    assert.equal(JSON.parse((await f.controlRow('assistant-proposal:' + proposal.id)).document).status, 'pending');
    assert.deepEqual((await f.state()).state.tasks, []);
    const repeated = await f.chat('one-pending-proposal', 'أضف مهمة مراجعة، واحجب المفتاح المرفق ' + providerKey);
    assert.equal(repeated.body.messageId, result.body.messageId);
    assert.equal(f.generated, 1);
    const history = (await f.request('/assistant/history')).body.messages;
    assert.equal(history.length, 4);
    assert.equal(history.at(-1).provider, 'gemini');
    assert.equal(history.at(-1).proposals[0].status, 'pending');
    assert.ok(!JSON.stringify(history).includes(providerKey));
    await f.assertNoPlainSecrets();
    assert.deepEqual(await f.org(), initialOrganization);
  });

  await t.test('two concurrent owner apply requests commit exactly one task and one durable application receipt', async () => {
    assert.ok(proposal?.id, 'The prior subtest must have produced a valid pending proposal');
    const data = { proposalId: proposal.id, expectedRevision: proposal.baseRevision };
    const outcomes = await Promise.all([
      f.request('/assistant/apply', { method: 'POST', data }),
      f.request('/assistant/apply', { method: 'POST', data }),
    ]);
    assert.ok(outcomes.every(result => result.response.status === 200));
    assert.equal(outcomes.filter(result => result.body.alreadyApplied === false).length, 1);
    assert.equal(outcomes.filter(result => result.body.alreadyApplied === true).length, 1);
    appliedState = await f.state();
    assert.equal(appliedState.revision, proposal.baseRevision + 1);
    assert.equal(appliedState.state.tasks.length, 1);
    assert.equal(appliedState.state.tasks[0].title, proposal.payload.title);
    assert.equal(appliedState.state.tasks[0].status, 'queued');
    const storedPlan = JSON.parse((await f.controlRow('assistant-proposal:' + proposal.id)).document);
    assert.equal(storedPlan.status, 'applied');
    assert.equal(storedPlan.appliedRevision, appliedState.revision);
    assert.equal(JSON.parse((await f.controlRow('assistant-applied:' + proposal.id)).document).status, 'applied');
    const applications = await f.db.prepare('SELECT COUNT(*) AS total FROM aas_control_records WHERE id LIKE ?').bind('assistant-applied:%').first();
    assert.equal(applications.total, 1);
    assert.equal((await f.request('/assistant/history')).body.messages.at(-1).proposals[0].status, 'applied');
    const again = await f.request('/assistant/apply', { method: 'POST', data });
    assert.equal(again.response.status, 200);
    assert.equal(again.body.alreadyApplied, true);
    assert.equal((await f.state()).revision, appliedState.revision);
  });

  await t.test('a plan whose organization base changed returns409 without an action or partial receipt', async () => {
    const proposed = await f.chat('stale-proposal-message');
    assert.equal(proposed.response.status, 200);
    const stale = proposed.body.proposals[0];
    const action = await f.request('/actions', { method: 'POST', data: {
      expectedRevision: appliedState.revision, operation: 'updateSettings', payload: { ownerName: 'Changed after the proposal was prepared' },
    } });
    assert.equal(action.response.status, 200);
    const before = await f.org();
    const result = await f.request('/assistant/apply', { method: 'POST', data: { proposalId: stale.id, expectedRevision: action.body.revision } });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'assistant_proposal_stale');
    assert.deepEqual(await f.org(), before);
    assert.equal((await f.state()).state.tasks.length, 1);
    assert.equal(await f.controlRow('assistant-applied:' + stale.id), null);
    assert.equal(JSON.parse((await f.controlRow('assistant-proposal:' + stale.id)).document).status, 'pending');
  });

  await t.test('database bridge routes are runner-only and cannot expose organization or assistant state', async () => {
    for (const [path, method] of [['/bridge/context?bridgeId=bridge-missing', 'GET'], ['/bridge/snapshot', 'POST'], ['/bridge/receipts', 'POST']]) {
      for (const identity of ['owner', 'service', 'anonymous']) {
        const denied = await f.request(path, { identity, method, ...(method === 'POST' ? { data: {} } : {}) });
        assert.equal(denied.response.status, 401);
        assert.equal(denied.body.error.code, 'runner_authentication_required');
        assert.ok(!Object.hasOwn(denied.body, 'state'));
      }
    }
    const missing = await f.request('/bridge/context?bridgeId=bridge-missing', { identity: 'runner' });
    assert.equal(missing.response.status, 404);
    assert.ok(!Object.hasOwn(missing.body, 'state'));
    assert.ok(!Object.hasOwn(missing.body, 'messages'));
    assert.ok(!JSON.stringify(missing.body).includes(providerKey));
    assert.equal((await f.request('/state', { identity: 'runner' })).response.status, 401);
  });

  await t.test('bridge metadata starts waiting, schema-only denies writes, and queue202 waits for an actual SQLite receipt', async () => {
    const before = await f.org();
    const created = await f.request('/database/bridges', { method: 'POST', data: { name: 'HTTP fixture inventory bridge' } });
    assert.equal(created.response.status, 201);
    let bridge = created.body.bridges[0];
    assert.equal(bridge.status, 'waiting');
    assert.equal(bridge.snapshot, null);
    assert.equal(bridge.lastSeenAt, null);
    assert.deepEqual(bridge.operations, []);
    assert.equal(created.body.capabilities.arbitrarySql, false);
    const databasePath = join(f.directory, 'http-inventory.sqlite');
    const local = new DatabaseSync(databasePath);
    local.exec("CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0)); INSERT INTO products VALUES(1,'HTTP observed product',8); CREATE TABLE customers(id INTEGER PRIMARY KEY,email TEXT); INSERT INTO customers VALUES(1,'private-http-fixture@example.invalid');");
    local.close();
    let config = { version: 1, adapter: 'sqlite', bridgeId: bridge.id, databasePath, backupDirectory: join(f.directory, 'backups'), readTables: [], writableTables: [] };
    const contextPath = '/bridge/context?bridgeId=' + encodeURIComponent(bridge.id);
    const initialContext = await f.request(contextPath, { identity: 'runner' });
    assert.equal(initialContext.response.status, 200);
    assert.deepEqual(Object.keys(initialContext.body).sort(), ['bridge', 'operations', 'revision']);
    assert.deepEqual(initialContext.body.operations, []);
    assert.deepEqual(Object.keys(initialContext.body.bridge).sort(), ['adapter', 'enabled', 'id']);
    const upload = snapshot => f.request('/bridge/snapshot', { identity: 'runner', method: 'POST', data: { bridgeId: bridge.id, snapshot } });
    assert.equal((await upload(readSnapshot(config))).response.status, 200);
    bridge = (await f.request('/database')).body.bridges[0];
    assert.equal(bridge.status, 'online');
    assert.equal(bridge.snapshot.schema.find(table => table.name === 'products').rowCount, 1);
    assert.deepEqual(bridge.snapshot.tables, []);
    const operation = { action: 'update', table: 'products', key: { id: 1 }, values: { stock: 7 } };
    const queue = (requestId, value) => f.request('/database/operations', { method: 'POST', data: { bridgeId: bridge.id, requestId, operation: value } });
    assert.equal((await queue('schema-only-denied', operation)).response.status, 403);
    const sql = 'DROP TABLE aas_app_state; -- isolated injection fixture';
    assert.equal((await queue('raw-sql-denied', { action: 'sql', sql })).response.status, 422);

    config = { ...config, readTables: [{ name: 'products', columns: ['id', 'name', 'stock'], limit: 10 }], writableTables: [{ name: 'products', columns: ['name', 'stock'], primaryKey: ['id'] }] };
    assert.equal((await upload(readSnapshot(config))).response.status, 200);
    const queued = await queue('http-stock-change', operation);
    assert.equal(queued.response.status, 202);
    bridge = queued.body.bridges[0];
    assert.equal(bridge.operations.length, 1);
    assert.equal(bridge.operations[0].status, 'pending');
    assert.equal(bridge.operations[0].receipt, undefined);
    assert.equal(bridge.snapshot.tables[0].rows[0].stock, 8);
    assert.ok(!JSON.stringify(bridge).includes(sql));
    assert.ok(!JSON.stringify(bridge).includes('private-http-fixture@example.invalid'));
    const scoped = await f.request(contextPath, { identity: 'runner' });
    assert.equal(scoped.body.operations.length, 1);
    assert.ok(!Object.hasOwn(scoped.body, 'state'));
    assert.ok(!JSON.stringify(scoped.body).includes(providerKey));
    const applied = await applyOperation(config, scoped.body.operations[0], { apply: true });
    assert.equal(applied.receipt.status, 'applied');
    assert.equal(applied.receipt.changes, 1);
    assert.equal((await f.request('/database')).body.bridges[0].operations[0].status, 'pending');
    const receipt = await f.request('/bridge/receipts', { identity: 'runner', method: 'POST', data: { bridgeId: bridge.id, receipt: applied.receipt } });
    assert.equal(receipt.response.status, 200);
    assert.deepEqual(Object.keys(receipt.body).sort(), ['accepted', 'operationId', 'status']);
    assert.equal(receipt.body.status, 'applied');
    assert.equal((await f.request(contextPath, { identity: 'runner' })).body.operations.length, 0);
    const persisted = (await f.request('/database')).body.bridges[0].operations[0];
    assert.deepEqual(persisted.receipt, applied.receipt);
    assert.equal((await f.request('/bridge/receipts', { identity: 'runner', method: 'POST', data: { bridgeId: bridge.id, receipt: applied.receipt } })).response.status, 200);
    assert.equal((await upload(readSnapshot(config))).response.status, 200);
    assert.equal((await f.request('/database')).body.bridges[0].snapshot.tables[0].rows[0].stock, 7);
    assert.equal((await readdir(config.backupDirectory)).length, 1);
    assert.deepEqual(await f.org(), before, 'Database control traffic must not advance the organization revision');
    await f.assertNoPlainSecrets();
  });

  await t.test('owner discovers actual provider models and configures from a ticket without sending the key twice',async()=>{
    const org=await f.org(),before=await f.controlRow('provider-gemini');
    const discovered=await f.request('/assistant/provider/models',{method:'POST',data:{useSavedKey:true}});
    assert.equal(discovered.response.status,200);assert.equal(discovered.body.models[0].id,model);
    assert.ok(!JSON.stringify(discovered.body).includes(providerKey));assert.deepEqual(await f.controlRow('provider-gemini'),before);
    const saved=await f.request('/assistant/provider',{method:'POST',data:{discoveryId:discovered.body.discoveryId,model}});
    assert.equal(saved.response.status,200);assert.equal(saved.body.configured,true);assert.equal(saved.body.model,model);
    assert.deepEqual(await f.org(),org);await f.assertNoPlainSecrets();
  });
  await t.test('the authenticated application AI endpoint uses the same encrypted provider without returning its key',async()=>{
    const result=await f.request('/ai/generate',{identity:'service',method:'POST',data:{prompt:'Analyze the configured project source without changing it.'}});
    assert.equal(result.response.status,200);
    assert.equal(result.body.model,model);
    assert.ok(typeof result.body.content==='string'&&result.body.content.length>0);
    assert.ok(!JSON.stringify(result.body).includes(providerKey));
    await f.assertNoPlainSecrets();
  });
  assert.deepEqual(f.defaultFetches, [], 'Every outgoing call must use the isolated service-binding fixture');
});
