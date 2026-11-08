#!/usr/bin/env node
/** Issue #61 verification: GitHub read-only; never deploys or modifies issues. */
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
const repo = process.env.GITHUB_REPOSITORY || 'Amer-ai-store/Mohammad-Ahmed-Ghannam';
const base = 'https://api.github.com/repos/' + repo;
const url = (number) => base + '/issues/' + number;

function verify(d) {
  assert.equal(d.issue61.number, 61);
  assert.equal(d.issue58.number, 58);
  assert.equal(d.issue59.number, 59);
  assert.match(d.issue61.body || '', /اختبر/u);
  assert.match(d.issue61.body || '', /issuecomment-6433198818/);
  assert.match(d.originalComment.body || '', /اختبر/u);
  assert.deepEqual(d.child61.map(x => x.number), [58], '#61 must have direct child #58 only');
  assert.equal(d.issue58.parent_issue_url, url(61), '#58 must point to #61');
  assert.ok(d.child58.some(x => x.number === 59), '#59 must be child of #58');
  assert.equal(d.issue59.parent_issue_url, url(58), '#59 must point to #58');
  return d.child58.filter(x => x.number !== 59).map(x => x.number);
}
function selfTest() {
  const d = {
    issue61: { number: 61, body: 'اختبر\nissuecomment-6433198818' },
    issue58: { number: 58, parent_issue_url: url(61) },
    issue59: { number: 59, parent_issue_url: url(58) },
    child61: [{ number: 58 }],
    child58: [{ number: 59 }, { number: 57 }],
    originalComment: { body: 'اختبر' }
  };
  assert.deepEqual(verify(d), [57]);
  assert.throws(() => verify({ ...d, child61: [] }));
  assert.throws(() => verify({ ...d, issue59: { number: 59, parent_issue_url: url(61) } }));
  console.log('PASS: three offline test cases');
}
async function getJson(path) {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(base + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'issue-61-readonly-qa',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('GitHub read ' + path + ': HTTP ' + res.status);
  return res.json();
}
async function liveTest() {
  const paths = ['/issues/61','/issues/58','/issues/59','/issues/61/sub_issues',
    '/issues/58/sub_issues','/issues/comments/6433198818'];
  const values = await Promise.all(paths.map(getJson));
  const [issue61, issue58, issue59, child61, child58, originalComment] = values;
  const unrelated = verify({ issue61, issue58, issue59, child61, child58, originalComment });
  console.log(JSON.stringify({ status: 'PASS', issue: 61, chain: [61, 58, 59],
    otherChildrenOf58NotValidated: unrelated, apiChecks: paths.length }, null, 2));
  if (unrelated.length) console.warn('::warning::Issue #58 additionally contains ' +
    unrelated.map(n => '#' + n).join(', ') + '; these issues are NOT resolved.');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Issue #61: read-only verification\n\n- **PASS:** source comment and #61 → #58 → #59 links.\n' +
    '- Other children of #58 remain outside this verification: ' +
    (unrelated.map(n => '#' + n).join(', ') || 'none') + '.\n' +
    '- No deployment or production-data changes.\n');
}
try {
  if (process.argv.includes('--self-test')) selfTest();
  else await liveTest();
} catch (err) {
  console.error('::error::Issue #61 verification FAILED: ' + err.message);
  process.exitCode = 1;
}