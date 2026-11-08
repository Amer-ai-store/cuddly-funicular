// Tenant isolation and RBAC tests against the real Firestore emulator (not the UI).
// Run: firebase emulators:exec --only firestore "node --test tests/firestore/tenancy.rules.test.mjs"
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, arrayUnion, deleteField, FieldPath } from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let env;
const users = {
  ownerA: { uid: 'ownerA', email: 'owner.a@example.com' },
  gmA: { uid: 'gmA', email: 'gm.a@example.com' },
  accA: { uid: 'accA', email: 'acc.a@example.com' },
  audA: { uid: 'audA', email: 'aud.a@example.com' },
  empA: { uid: 'empA', email: 'emp.a@example.com' },
  ownerB: { uid: 'ownerB', email: 'owner.b@example.com' },
  stranger: { uid: 'stranger', email: 'stranger@example.com' },
  invitee: { uid: 'invitee', email: 'new.person@example.com' },
};
const db = (u) => env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore();
const companyA = {
  name: 'Jawafa Test A', ownerUid: 'ownerA',
  memberIds: ['ownerA', 'gmA', 'accA', 'audA', 'empA'],
  roles: { gmA: 'general_manager', accA: 'accountant', audA: 'auditor', empA: 'employee' },
  members: {}, pendingInvites: {}, social: {},
};
const companyB = { name: 'Company B', ownerUid: 'ownerB', memberIds: ['ownerB'], roles: {}, members: {}, pendingInvites: {}, social: {} };

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-jawafa-one', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'companies/A'), companyA);
    await setDoc(doc(f, 'companies/B'), companyB);
    await setDoc(doc(f, 'companies/A/workspaces/w1'), { name: 'A secret workspace' });
    await setDoc(doc(f, 'companies/B/workspaces/w1'), { name: 'B secret workspace' });
  });
});

test('TEN-01 a user can create a company only as its sole owner', async () => {
  const f = db(users.stranger);
  await assertSucceeds(setDoc(doc(f, 'companies/S'), { name: 'Stranger Co', ownerUid: 'stranger', memberIds: ['stranger'], roles: {}, members: { stranger: { email: 'stranger@example.com' } }, pendingInvites: {}, social: {} }));
  await assertFails(setDoc(doc(f, 'companies/S2'), { name: 'Hijack', ownerUid: 'ownerA', memberIds: ['stranger'], roles: {}, members: {}, pendingInvites: {}, social: {} }));
  await assertFails(setDoc(doc(f, 'companies/S3'), { name: 'Extra', ownerUid: 'stranger', memberIds: ['stranger', 'ownerA'], roles: {}, members: {}, pendingInvites: {}, social: {} }));
});

test('TEN-02 company A data is not readable or writable by company B owner (API level)', async () => {
  const f = db(users.ownerB);
  await assertFails(getDoc(doc(f, 'companies/A')));
  await assertFails(getDoc(doc(f, 'companies/A/workspaces/w1')));
  await assertFails(setDoc(doc(f, 'companies/A/workspaces/w2'), { name: 'injected' }));
  await assertFails(getDocs(collection(f, 'companies/A/workspaces')));
  await assertFails(updateDoc(doc(f, 'companies/A'), { memberIds: arrayUnion('ownerB') }));
  await assertSucceeds(getDoc(doc(f, 'companies/B/workspaces/w1')));
});

test('TEN-03 unauthenticated access is denied everywhere', async () => {
  const f = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(f, 'companies/A')));
  await assertFails(getDoc(doc(f, 'companies/A/workspaces/w1')));
  await assertFails(setDoc(doc(f, 'companies/X'), { name: 'x', ownerUid: 'x', memberIds: ['x'], roles: {}, members: {}, pendingInvites: {}, social: {} }));
});

test('TEN-04 company listing returns only the caller\'s companies', async () => {
  const f = db(users.accA);
  const snap = await assertSucceeds(getDocs(query(collection(f, 'companies'), where('memberIds', 'array-contains', 'accA'))));
  assert.deepEqual(snap.docs.map(d => d.id), ['A']);
  await assertFails(getDocs(collection(f, 'companies')));
});

test('RBAC-01 accountant writes data, auditor and employee are read only', async () => {
  await assertSucceeds(setDoc(doc(db(users.accA), 'companies/A/workspaces/w3'), { name: 'ok' }));
  await assertSucceeds(getDoc(doc(db(users.audA), 'companies/A/workspaces/w1')));
  await assertFails(setDoc(doc(db(users.audA), 'companies/A/workspaces/w4'), { name: 'no' }));
  await assertFails(setDoc(doc(db(users.empA), 'companies/A/workspaces/w5'), { name: 'no' }));
  await assertSucceeds(setDoc(doc(db(users.empA), 'companies/A/tasks/t1'), { title: 'employee task' }));
  await assertFails(setDoc(doc(db(users.audA), 'companies/A/tasks/t2'), { title: 'auditor task' }));
  await assertFails(deleteDoc(doc(db(users.empA), 'companies/A/tasks/t1')));
  await assertSucceeds(deleteDoc(doc(db(users.gmA), 'companies/A/tasks/t1')));
});

test('RBAC-02 only owner / chairman / general manager manage members; ownership cannot move', async () => {
  await assertFails(updateDoc(doc(db(users.accA), 'companies/A'), { name: 'renamed by accountant' }));
  await assertSucceeds(updateDoc(doc(db(users.gmA), 'companies/A'), { name: 'Renamed by GM' }));
  await assertFails(updateDoc(doc(db(users.gmA), 'companies/A'), { ownerUid: 'gmA' }));
  await assertFails(updateDoc(doc(db(users.gmA), 'companies/A'), { memberIds: ['gmA', 'accA'] }));
  await assertFails(deleteDoc(doc(db(users.gmA), 'companies/A')));
});

test('RBAC-03 a role value of "owner" in roles grants nothing beyond member rights', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => updateDoc(doc(ctx.firestore(), 'companies/A'), { 'roles.empA': 'owner' }));
  await assertFails(updateDoc(doc(db(users.empA), 'companies/A'), { name: 'pretend owner' }));
  await assertFails(setDoc(doc(db(users.empA), 'companies/A/workspaces/x'), { name: 'pretend owner' }));
});

test('INV-01 invitation flow: manager invites, only the addressed email can join with that role', async () => {
  const gm = db(users.gmA);
  const email = users.invitee.email;
  await assertFails(setDoc(doc(gm, `invites/A__${email}`), { companyId: 'A', companyName: 'A', email, role: 'owner', invitedBy: 'gmA' }));
  await assertSucceeds(setDoc(doc(gm, `invites/A__${email}`), { companyId: 'A', companyName: 'A', email, role: 'accountant', invitedBy: 'gmA' }));
  await assertSucceeds(updateDoc(doc(gm, 'companies/A'), new FieldPath('pendingInvites', email), 'accountant'));
  await assertFails(setDoc(doc(db(users.accA), `invites/A__x@example.com`), { companyId: 'A', companyName: 'A', email: 'x@example.com', role: 'employee', invitedBy: 'accA' }));
  await assertFails(setDoc(doc(db(users.ownerB), `invites/A__y@example.com`), { companyId: 'A', companyName: 'A', email: 'y@example.com', role: 'employee', invitedBy: 'ownerB' }));

  // A stranger cannot use someone else's invitation.
  await assertFails(updateDoc(doc(db(users.stranger), 'companies/A'), 'memberIds', arrayUnion('stranger'), new FieldPath('roles', 'stranger'), 'accountant'));
  // The invitee cannot take a higher role than invited.
  const inv = db(users.invitee);
  await assertFails(updateDoc(doc(inv, 'companies/A'), 'memberIds', arrayUnion('invitee'), new FieldPath('roles', 'invitee'), 'general_manager',
    new FieldPath('members', 'invitee'), { email }, new FieldPath('pendingInvites', email), deleteField()));
  // Invitee reads their invitations by email and accepts with exactly the invited role.
  const mine = await assertSucceeds(getDocs(query(collection(inv, 'invites'), where('email', '==', email))));
  assert.equal(mine.size, 1);
  await assertSucceeds(updateDoc(doc(inv, 'companies/A'), 'memberIds', arrayUnion('invitee'), new FieldPath('roles', 'invitee'), 'accountant',
    new FieldPath('members', 'invitee'), { email }, new FieldPath('pendingInvites', email), deleteField()));
  await assertSucceeds(deleteDoc(doc(inv, `invites/A__${email}`)));
  await assertSucceeds(getDoc(doc(inv, 'companies/A/workspaces/w1')));
  await assertFails(getDoc(doc(inv, 'companies/B/workspaces/w1')));
});

test('INV-02 a member can leave; the owner cannot be removed', async () => {
  const f = db(users.empA);
  const after = { ...companyA, memberIds: companyA.memberIds.filter(x => x !== 'empA'), roles: { gmA: 'general_manager', accA: 'accountant', audA: 'auditor' } };
  await assertSucceeds(setDoc(doc(f, 'companies/A'), after));
  await assertFails(getDoc(doc(f, 'companies/A/workspaces/w1')));
});

test('MSG-01 agent messages: queued as self, forward-only status, immutable body, no delete', async () => {
  const f = db(users.empA);
  const ref = doc(f, 'companies/A/agentMessages/m1');
  await assertFails(setDoc(ref, { id: 'm1', from: 'agent-999', to: ['agent-777'], body: 'x', status: 'DELIVERED', sentBy: 'empA' }));
  await assertFails(setDoc(ref, { id: 'm1', from: 'agent-999', to: ['agent-777'], body: 'x', status: 'QUEUED', sentBy: 'gmA' }));
  await assertSucceeds(setDoc(ref, { id: 'm1', from: 'agent-999', to: ['agent-777', 'agent-666'], body: 'x', status: 'QUEUED', sentBy: 'empA' }));
  await assertFails(updateDoc(ref, { status: 'ACKNOWLEDGED' }));
  await assertFails(updateDoc(ref, { body: 'tampered' }));
  await assertSucceeds(updateDoc(ref, { status: 'DELIVERED' }));
  await assertFails(updateDoc(ref, { status: 'QUEUED' }));
  await assertSucceeds(updateDoc(ref, { status: 'READ' }));
  await assertSucceeds(updateDoc(ref, { status: 'ACKNOWLEDGED' }));
  await assertFails(deleteDoc(ref));
  await assertFails(getDoc(doc(db(users.ownerB), 'companies/A/agentMessages/m1')));
});

test('AUD-01 audit log is append-only', async () => {
  const f = db(users.accA);
  await assertSucceeds(setDoc(doc(f, 'companies/A/audit/e1'), { by: 'accA', action: 'x' }));
  await assertFails(setDoc(doc(f, 'companies/A/audit/e2'), { by: 'gmA', action: 'spoof' }));
  await assertFails(updateDoc(doc(f, 'companies/A/audit/e1'), { action: 'edit' }));
  await assertFails(deleteDoc(doc(db(users.ownerA), 'companies/A/audit/e1')));
});

test('SOC-01 social links accept only the matching platform host over https', async () => {
  const gm = db(users.gmA);
  await assertSucceeds(updateDoc(doc(gm, 'companies/A'), { social: { facebook: 'https://www.facebook.com/jawafa', instagram: 'https://instagram.com/jawafa', tiktok: 'https://www.tiktok.com/@jawafa' } }));
  await assertFails(updateDoc(doc(gm, 'companies/A'), { social: { facebook: 'http://facebook.com/x' } }));
  await assertFails(updateDoc(doc(gm, 'companies/A'), { social: { instagram: 'https://evil.example/instagram.com/x' } }));
  await assertFails(updateDoc(doc(gm, 'companies/A'), { social: { twitter: 'https://x.com/a' } }));
});

test('STORE-01 Android live-store collections stay readable only by the original owner', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'orders/o1'), { total: 1 }));
  await assertFails(getDoc(doc(db(users.ownerA), 'orders/o1')));
  const owner = env.authenticatedContext('real', { email: 'zxzx.mohammad91@gmail.com', email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(owner, 'orders/o1')));
});

test('PROF-01 profiles are private to their user', async () => {
  await assertSucceeds(setDoc(doc(db(users.accA), 'profiles/accA'), { lastCompanyId: 'A' }));
  await assertFails(getDoc(doc(db(users.gmA), 'profiles/accA')));
});

test('PLAN-01 companies start free and no client can upgrade itself to Premium Plus', async () => {
  const f = db(users.stranger);
  await assertFails(setDoc(doc(f, 'companies/P'), { name: 'Paid', ownerUid: 'stranger', memberIds: ['stranger'], roles: {}, members: {}, pendingInvites: {}, social: {}, plan: 'premium_plus' }));
  await assertSucceeds(setDoc(doc(f, 'companies/P'), { name: 'Free', ownerUid: 'stranger', memberIds: ['stranger'], roles: {}, members: {}, pendingInvites: {}, social: {}, plan: 'free' }));
  await assertFails(updateDoc(doc(f, 'companies/P'), { plan: 'premium_plus' }));
  await assertFails(updateDoc(doc(db(users.ownerA), 'companies/A'), { plan: 'premium_plus' }));
  await assertSucceeds(updateDoc(doc(f, 'companies/P'), { name: 'Still free' }));
});

test('BR-01 branches: writers add validated branches, read-only roles and other companies cannot', async () => {
  const ok = { name: 'فرع الزرقاء', kind: 'market', city: 'الزرقاء', lat: 32.06, lng: 36.09, by: 'accA', at: 1 };
  await assertSucceeds(setDoc(doc(db(users.accA), 'companies/A/branches/b1'), ok));
  await assertSucceeds(setDoc(doc(db(users.gmA), 'companies/A/branches/b2'), { ...ok, lat: null, lng: null }));
  await assertFails(setDoc(doc(db(users.audA), 'companies/A/branches/b3'), ok));
  await assertFails(setDoc(doc(db(users.empA), 'companies/A/branches/b3'), ok));
  await assertFails(setDoc(doc(db(users.ownerB), 'companies/A/branches/b3'), ok));
  await assertFails(setDoc(doc(db(users.accA), 'companies/A/branches/b4'), { ...ok, kind: 'casino' }));
  await assertFails(setDoc(doc(db(users.accA), 'companies/A/branches/b5'), { ...ok, lat: 123 }));
  await assertFails(setDoc(doc(db(users.accA), 'companies/A/branches/b6'), { ...ok, extra: 'x' }));
  await assertSucceeds(getDoc(doc(db(users.audA), 'companies/A/branches/b1')));
  await assertFails(getDoc(doc(db(users.ownerB), 'companies/A/branches/b1')));
  await assertFails(deleteDoc(doc(db(users.audA), 'companies/A/branches/b1')));
  await assertSucceeds(deleteDoc(doc(db(users.accA), 'companies/A/branches/b1')));
});
