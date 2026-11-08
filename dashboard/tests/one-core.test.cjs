const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../one/core.js');

test('CORE-01 roles: owner from ownerUid only, unknown role values grant nothing', () => {
  const c = { ownerUid: 'o', memberIds: ['o', 'a', 'b', 'x'], roles: { a: 'accountant', b: 'auditor', x: 'owner' } };
  assert.equal(C.roleOf(c, 'o'), 'owner');
  assert.equal(C.roleOf(c, 'a'), 'accountant');
  assert.equal(C.roleOf(c, 'x'), null);
  assert.equal(C.roleOf(c, 'stranger'), null);
  assert.ok(C.can('accountant', 'write')); assert.ok(!C.can('auditor', 'write')); assert.ok(!C.can('employee', 'write'));
  assert.ok(C.can('employee', 'tasks')); assert.ok(!C.can('auditor', 'tasks'));
  assert.ok(C.can('general_manager', 'manage')); assert.ok(!C.can('branch_manager', 'manage'));
  assert.deepEqual(Object.keys(C.ROLES), ['owner', 'chairman', 'general_manager', 'procurement_manager', 'branch_manager', 'accountant', 'auditor', 'employee']);
});

test('CORE-02 invite ids and email/social validation', () => {
  assert.equal(C.inviteId('A', ' Ali@Example.COM '), 'A__ali@example.com');
  assert.ok(C.isEmail('a@b.co')); assert.ok(!C.isEmail('nope'));
  assert.ok(C.validateSocial('facebook', 'https://www.facebook.com/jawafa').ok);
  assert.ok(!C.validateSocial('facebook', 'http://facebook.com/jawafa').ok);
  assert.ok(!C.validateSocial('instagram', 'https://evil.example/instagram.com/x').ok);
  assert.ok(C.validateSocial('tiktok', 'https://www.tiktok.com/@jawafa').ok);
  assert.ok(C.validateSocial('tiktok', '').ok);
});

test('CORE-03 router: dedupe, forward-only states, receipts required from a recipient', () => {
  const r = C.createRouter();
  const a = r.send({ id: 'm1', from: 'agent-999', to: ['agent-777', 'agent-666', 'agent-777'], body: 'تقرير' });
  assert.equal(a.message.status, 'QUEUED'); assert.deepEqual(a.message.to, ['agent-777', 'agent-666']);
  assert.equal(r.send({ id: 'm1', from: 'agent-999', to: ['x'], body: 'again' }).duplicate, true);
  assert.throws(() => r.advance('m1', 'DELIVERED'), /receipt/);
  assert.throws(() => r.advance('m1', 'DELIVERED', { by: 'agent-111' }), /receipt/);
  assert.throws(() => r.advance('m1', 'READ', { by: 'agent-777' }), /illegal/);
  r.advance('m1', 'DELIVERED', { by: 'agent-777' });
  r.advance('m1', 'READ', { by: 'agent-777' });
  r.advance('m1', 'ACKNOWLEDGED', { by: 'agent-777' });
  assert.throws(() => r.advance('m1', 'FAILED', {}), /illegal/);
  assert.equal(r.inbox('agent-666').length, 1); assert.equal(r.outbox('agent-999').length, 1);
  r.send({ id: 'm2', from: 'agent-777', to: 'agent-999', body: 'x' });
  assert.equal(r.advance('m2', 'FAILED', { reason: 'no channel' }).status, 'FAILED');
});

test('CORE-04 anomaly engine finds seeded cases and never marks DEMO data as proven', () => {
  const d = C.demoDataset();
  assert.equal(d.source, 'DEMO');
  const f = C.detectAnomalies(d);
  const types = new Set(f.map(x => x.type));
  for (const t of ['duplicate_invoice', 'off_hours_change', 'high_discount', 'negative_stock', 'cash_variance', 'unmatched_cheque']) assert.ok(types.has(t), 'missing ' + t);
  assert.ok(f.every(x => x.classification === 'verify' || x.classification === 'hypothesis'));
  assert.ok(f.every(x => x.source === 'DEMO'));
  assert.equal(C.classify('LIVE', 0.95, true), 'proven');
  assert.equal(C.classify('LIVE', 0.95, false), 'verify');
});

test('CORE-05 aggregates are derived from the dataset, not hard coded', () => {
  const d = C.demoDataset();
  const k = C.kpis(d);
  const manual = d.invoices.filter(i => i.status !== 'void').reduce((t, i) => t + i.total, 0);
  assert.equal(k.sales, +manual.toFixed(2));
  assert.equal(C.dailySales(d, 7).length, 7);
  assert.ok(k.chequesDue7 >= 1);
  assert.equal(k.branches, 4);
});

test('CORE-06 browser module app.js parses as an ES module', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
  const { join } = require('node:path'); const { execFileSync } = require('node:child_process'); const os = require('node:os');
  const dir = mkdtempSync(join(os.tmpdir(), 'one-'));
  const f = join(dir, 'app.mjs'); writeFileSync(f, readFileSync(join(__dirname, '../one/app.js')));
  execFileSync(process.execPath, ['--check', f]);
  execFileSync(process.execPath, ['--check', join(__dirname, '../one/sw.js')]);
});
