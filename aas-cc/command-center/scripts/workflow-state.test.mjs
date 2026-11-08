import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLiveState, normalizeLiveState, mutateLiveState } from '../server/state.mjs';

// Isolated fixture records describe test inputs, not real project execution.
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), D = 'd'.repeat(40);
const report = [{ kind: 'report', label: 'تحليل نطاق الاختبار', content: 'نتيجة مراجعة مدخلات الاختبار والملفات التي تتطلب التعديل.' }];
const diff = [{ kind: 'diff', label: 'فرق تعديل الاختبار', content: 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after' }];
const logs = [{ kind: 'log', label: 'مخرجات فحص الاختبار', content: 'fixture-check: 2 checks passed; command exited with status 0.' }];
const act = (state, operation, payload) => mutateLiveState(state, operation, payload);
const current = (state) => { const workflow = state.workflows[0]; return { workflow, step: workflow.steps[workflow.currentStepIndex] }; };
function started({ count = 2, mode = 'change' } = {}) {
  return act(initialLiveState(), 'startWorkflow', { title: 'سير اختبار معزول', description: 'فحص البوابات دون تنفيذ شيفرة خارجية.', repository: 'FixtureOwner/FixtureRepo', sourceRevision: A, mode, steps: Array.from({ length: count }, (_, index) => ({ title: 'خطوة ' + (index + 1) })) }).state;
}
function payload(state, patch = {}) {
  const { workflow, step } = current(state);
  return { workflowId: workflow.id, stepId: step.id, sourceRevision: workflow.sourceRevision, stepRevision: step.revision, ...patch };
}
const analysis = (state, patch = {}) => act(state, 'recordWorkflowAnalysis', payload(state, { summary: 'تحليل موثق لنطاق الخطوة.', evidence: report, ...patch })).state;
const change = (state, revision = B, patch = {}) => act(state, 'recordWorkflowChange', payload(state, { sourceRevision: revision, changeType: 'modification', summary: 'تعديل ملف الاختبار حسب فرق الشيفرة المرفق.', evidence: diff, ...patch })).state;
const verify = (state, patch = {}) => act(state, 'recordWorkflowVerification', payload(state, { summary: 'فحوص موثقة على مراجعة المصدر المحددة.', evidence: logs, outcome: 'passed', checks: [{ name: 'fixture-check', command: 'node fixture-check.mjs', exitCode: 0, evidenceIndex: 0 }], ...patch })).state;
const advance = (state) => act(state, 'advanceWorkflow', payload(state)).state;

test('live schema gains empty workflows without creating events or execution claims', () => {
  const initial = initialLiveState();
  assert.deepEqual(initial.workflows, []);
  const older = structuredClone(initial); delete older.workflows;
  assert.deepEqual(normalizeLiveState(older).workflows, []);
  assert.deepEqual(initial.activity, []);
  assert.deepEqual(initial.runs, []);
});

test('future steps and every skipped phase stay locked; boolean claims are not evidence', () => {
  const state = started(), before = JSON.stringify(state);
  const { workflow } = current(state);
  assert.throws(() => act(state, 'advanceWorkflow', payload(state)), /البوابة مقفلة/);
  assert.throws(() => change(state), /التحليل الموثق/);
  assert.throws(() => verify(state), /يبدأ التحقق/);
  assert.throws(() => act(state, 'recordWorkflowAnalysis', { ...payload(state), stepId: workflow.steps[1].id, summary: 'تخطي', evidence: report }), /الخطوة مقفلة/);
  assert.throws(() => analysis(state, { evidence: [true] }), /الدليل يجب/);
  assert.throws(() => analysis(state, { evidence: [{ kind: 'report', label: 'نجاح', passed: true }] }), /أرفق محتوى/);
  assert.throws(() => analysis(state, { sourceRevision: B }), /المصدر الحالي/);
  assert.equal(JSON.stringify(state), before);
});

test('ordered analysis, evidenced change, successful verification and explicit advancement complete each gate', () => {
  let state = started();
  state = analysis(state);
  assert.equal(current(state).step.phase, 'implementation');
  assert.equal(current(state).step.revision, 1);
  assert.equal(current(state).step.analysis.provenance, 'manual');
  assert.throws(() => change(state, A), /معرّف مصدر جديد/);
  assert.throws(() => change(state, B, { evidence: report }), /فرق شيفرة فعلي/);
  state = change(state);
  assert.equal(current(state).step.phase, 'verification');
  assert.equal(current(state).step.revision, 2);
  state = verify(state);
  assert.equal(current(state).step.revision, 2);
  assert.equal(current(state).step.phase, 'verification');
  assert.equal(current(state).workflow.currentStepIndex, 0);
  state = advance(state);
  assert.equal(current(state).workflow.currentStepIndex, 1);
  assert.equal(state.workflows[0].steps[0].phase, 'complete');
  assert.equal(current(state).step.sourceRevision, B);
  state = advance(verify(change(analysis(state), C)));
  assert.equal(state.workflows[0].status, 'complete');
  assert.ok(state.workflows[0].steps.every((step) => step.phase === 'complete'));
  assert.deepEqual(state.runs, []);
  const appended = act(state, 'addWorkflowStep', { workflowId: state.workflows[0].id, title: 'خطوة إضافية' }).state;
  assert.equal(current(appended).workflow.status, 'active');
  assert.equal(current(appended).workflow.currentStepIndex, 2);
  assert.equal(current(appended).step.phase, 'analysis');
});

test('failed or blocked checks cannot advance and only matching source/revision evidence can recover', () => {
  const state = change(analysis(started({ count: 1 })));
  const before = JSON.stringify(state);
  assert.throws(() => verify(state, { outcome: 'passed', checks: [] }), /يتطلب فحوصًا/);
  assert.throws(() => verify(state, { outcome: 'passed', checks: [{ name: 'فحص', command: 'fixture', exitCode: 1, evidenceIndex: 0 }] }), /يتطلب فحوصًا/);
  assert.throws(() => verify(state, { checks: [{ name: 'فحص', command: 'fixture', exitCode: true, evidenceIndex: 0 }] }), /رمز خروج/);
  assert.throws(() => verify(state, { sourceRevision: A }), /نسخة المصدر الحالية/);
  assert.throws(() => verify(state, { stepRevision: 0 }), /مراجعة قديمة/);
  assert.equal(JSON.stringify(state), before);
  const failed = verify(state, { outcome: 'failed', checks: [{ name: 'fixture-check', command: 'node fixture-check.mjs', exitCode: 1, evidenceIndex: 0 }] });
  assert.equal(current(failed).workflow.status, 'failed');
  assert.throws(() => advance(failed), /البوابة مقفلة/);
  const blocked = verify(failed, { outcome: 'blocked', checks: [], summary: 'خدمة الفحص غير متاحة؛ لم يُنفّذ أمر.' });
  assert.equal(current(blocked).workflow.status, 'blocked');
  assert.throws(() => advance(blocked), /البوابة مقفلة/);
  assert.equal(current(advance(verify(blocked))).workflow.status, 'complete');
});

test('revising an earlier change invalidates its verification and every downstream result while retaining evidence history', () => {
  let state = started();
  state = advance(verify(change(analysis(state))));
  state = advance(verify(change(analysis(state), C)));
  const workflow = state.workflows[0], first = workflow.steps[0];
  const previousVerificationId = first.verification.id;
  const revised = act(state, 'recordWorkflowChange', { workflowId: workflow.id, stepId: first.id, sourceRevision: D, changeType: 'addition', summary: 'إضافة ملف تستوجب إعادة الفحص وما بعدها.', evidence: diff }).state;
  assert.equal(revised.workflows[0].currentStepIndex, 0);
  assert.equal(revised.workflows[0].status, 'active');
  assert.equal(revised.workflows[0].steps[0].phase, 'verification');
  assert.equal(revised.workflows[0].steps[0].verification, null);
  assert.equal(revised.workflows[0].steps[1].phase, 'analysis');
  assert.equal(revised.workflows[0].steps[1].status, 'pending');
  assert.equal(revised.workflows[0].steps[1].analysis, null);
  assert.equal(revised.workflows[0].steps[1].change, null);
  assert.equal(revised.workflows[0].steps[1].verification, null);
  assert.ok(revised.workflows[0].events.some((event) => event.record?.id === previousVerificationId));
  assert.throws(() => advance(revised), /البوابة مقفلة/);
});

test('manual records cannot impersonate runner or server analysis; trusted receipts are versioned and cannot replay', () => {
  let state = started({ count: 1 });
  state = analysis(state, { provenance: 'runner', runnerId: 'forged', receiptId: 'forged' });
  assert.equal(current(state).step.analysis.provenance, 'manual');
  assert.equal(current(state).step.analysis.runnerId, null);
  const unchanged = JSON.stringify(state);
  assert.throws(() => act(state, 'recordWorkflowRunnerReceipt', { ...payload(state), phase: 'implementation', runnerId: 'test-runner', receiptId: 'receipt-bad', stepRevision: 0, sourceRevision: B, changeType: 'modification', summary: 'إيصال قديم', evidence: diff }), /مراجعة قديمة/);
  assert.equal(JSON.stringify(state), unchanged);
  state = act(state, 'recordWorkflowRunnerReceipt', { ...payload(state), phase: 'implementation', runnerId: 'test-runner', receiptId: 'receipt-change', sourceRevision: B, changeType: 'modification', summary: 'فرق موثق من منفذ الاختبار.', evidence: diff }).state;
  assert.equal(current(state).step.change.provenance, 'runner');
  state = act(state, 'recordWorkflowRunnerReceipt', { ...payload(state), phase: 'verification', runnerId: 'test-runner', receiptId: 'receipt-verify', summary: 'مخرجات فحص إيصال الاختبار.', evidence: logs, outcome: 'passed', checks: [{ name: 'fixture-check', command: 'node fixture-check.mjs', exitCode: 0, evidenceIndex: 0 }] }).state;
  assert.throws(() => act(state, 'recordWorkflowRunnerReceipt', { ...payload(state), phase: 'verification', runnerId: 'test-runner', receiptId: 'receipt-verify', summary: 'مكرر', evidence: logs, outcome: 'passed', checks: [{ name: 'check', command: 'fixture', exitCode: 0, evidenceIndex: 0 }] }), /مسجل مسبقًا/);
  assert.throws(() => act(state, 'advanceWorkflowRunner', { ...payload(state), runnerId: 'other-runner', verificationReceiptId: 'receipt-verify' }), /للمنفّذ نفسه/);
  const done = act(state, 'advanceWorkflowRunner', { ...payload(state), runnerId: 'test-runner', verificationReceiptId: 'receipt-verify' }).state;
  assert.equal(done.workflows[0].status, 'complete');
  assert.equal(done.workflows[0].events[0].provenance, 'runner');
  assert.deepEqual(done.runs, []);
  const another = act(done, 'startWorkflow', { title: 'سير ثانٍ لا يعيد استخدام إيصال سابق', sourceRevision: A, steps: [{ title: 'تحليل جديد' }] }).state;
  assert.throws(() => act(another, 'recordWorkflowRunnerReceipt', { ...payload(another), phase: 'analysis', runnerId: 'test-runner', receiptId: 'receipt-verify', summary: 'إعادة إيصال خطوة من خطة أخرى', evidence: report }), /مسجل مسبقًا/);
});

test('server analysis provenance remains analysis-only and analysis-only mode still requires a verification gate', () => {
  let state = started({ count: 1, mode: 'analysis-only' });
  state = act(state, 'recordWorkflowAnalysisResult', payload(state, { summary: 'نتائج تحليل المصدر الفعلي وفق النطاق المرفق.', evidence: report })).state;
  assert.equal(current(state).step.analysis.provenance, 'server-analysis');
  assert.equal(current(state).step.phase, 'verification');
  assert.equal(current(state).step.change, null);
  assert.throws(() => change(state), /التحليل وحده/);
  assert.throws(() => advance(state), /البوابة مقفلة/);
  const manualVerified = verify(state);
  assert.throws(() => act(manualVerified, 'advanceWorkflowRunner', { ...payload(manualVerified), runnerId: 'test-runner', verificationReceiptId: 'fixture' }), /الانتقال الآلي/);
  assert.equal(advance(manualVerified).workflows[0].status, 'complete');
});

test('imports and reset cannot manufacture completed gates or erase a current failure', () => {
  const failed = analysis(started({ count: 1 }), { outcome: 'blocked', summary: 'معلومات المصدر ناقصة؛ لا يمكن التعديل بعد.' });
  const incoming = initialLiveState();
  incoming.workflows = [{ id: 'forged', status: 'complete', provenance: 'runner' }];
  const restored = act(failed, 'importData', { data: incoming }).state;
  assert.deepEqual(restored.workflows, failed.workflows);
  assert.equal(restored.workflows[0].status, 'blocked');
  assert.deepEqual(act(restored, 'reset').state.workflows, failed.workflows);
  const empty = act(initialLiveState(), 'importData', { data: incoming }).state;
  assert.deepEqual(empty.workflows, []);
});
