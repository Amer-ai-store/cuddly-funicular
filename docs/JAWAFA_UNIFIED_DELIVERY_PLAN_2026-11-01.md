# Jawafa / Amer AI Store — Unified delivery and development plan
Date: 2026-11-01 | Target demonstration: 2026-11-02 | Status: PLAN, not production acceptance

## Authority and immutable constraints
- Existing integrated dashboard is the sole target. No parallel replacement app or misleading GitHub Pages URL.
- Jawafa_DB and original financial records are strictly read-only; no DML/DDL, SQL restart, server reboot or destructive tests.
- Production publication remains blocked until explicit authorized approval AND independent security/E2E evidence. Issue #102 is a request, not proof that publishing is blocked.
- Never store tokens, OAuth credentials, financial exports or private conversations in git, issues, APKs or CI logs. Secrets must be provisioned via approved secret store; missing third-party credentials cannot be invented.
- Every item has owner, source ref, implementation SHA, test/run ID, outcome, timestamp, and evidence link. NO EVIDENCE = NO DONE.
- Android is an independent multi-stage workstream. APK development builds are not evidence of dashboard production readiness.

## P0 — Before demonstration: safety and operability
| ID | Deliverable | Implementation and acceptance test | Current state |
|---|---|---|---|
| P0-01 | Release freeze | Inventory all GitHub Actions + external hosts; enforce protected production environments/required reviewers, prevent PR secret access; verify blocked publish via safe negative test | OPEN; #102 |
| P0-02 | Credentials and SQL least privilege | Rotate exposed/malformed credentials using authorized provider; scoped secret store; dedicated SELECT-only login; denied-write test on disposable DB only | OPEN; #91 |
| P0-03 | API and private HTTPS | Authenticated TLS gateway, strict origin policy, RBAC, rate limits, secret redaction; unauthorized 401/403 tests | OPEN; #57 |
| P0-04 | Jawafa Command Bridge | Resolve configuration and 503, route missing /api/commands 404, signed command receipt and audit; dry-run/status commands only; E2E server-to-UI | OPEN; #57 |
| P0-05 | Integrated dashboard | Identify canonical deployed application and route; prove embedded Jawafa view (not separate app); login, navigation, permissions, mobile viewport, refresh | OPEN; #57 / PR #67 |
| P0-06 | CI and reproducible build | Inspect failing job logs, pin supported Ubuntu and Node 24 actions on isolated branch; lint/unit/security/E2E and artifacts tied to SHA | OPEN; #96 |
| P0-07 | Demo readiness | Safe demo with explicit VERIFIED / DEMO / BLOCKED indicators; no production data copied into public assets; fallback offline mock clearly labeled | OPEN |

## P1 — Operational and financial acceptance
| ID | Deliverable | Evidence needed |
|---|---|---|
| P1-01 | 06:25 Asia/Amman freshness | Read-only actual business timestamp and lag; not health endpoint time |
| P1-02 | Export completeness | Row counts vs CSV cell counts, per-table hash, manifest, 15 disputed tables, exceptions and repeatable checks |
| P1-03 | Independent offsite recovery | Encrypted off-host backup, independent test restore, RPO/RTO; export alone does not pass |
| P1-04 | Financial reconciliation | Markets/Bakery/Restaurant cheque, bank, POS, GL, investment, tax reconciliation with source IDs and unresolved exceptions |
| P1-05 | Evidence chain | SHA-256, UTC/Asia-Amman clocks, user/device/source attribution limits, restricted evidence store |
| P1-06 | Deliverables | Executive + detailed report, Excel, PDF, PPTX, source index, conversation index, dashboard visibility/dedup test |
| P1-07 | GATE-15 | Independent signed test evidence for every gate; checklist or PR merge alone insufficient |

## P2 — Product enhancement backlog (proposals; not implemented)
1. Unified agents/tasks/buttons inventory with functional migration checks and owner mapping.
2. Live health topology, dependency graph, incident timeline, safe recovery controls.
3. Role-based command approval, command preview, idempotency keys, receipts and immutable audit trail.
4. Financial exception triage with confidence labels and human review.
5. Data lineage map, schema drift alerting, historical snapshots and reconciliation diffs.
6. Notification deduplication keyed by original evidence ID and accepted state transition.
7. Backup integrity dashboard with independent restore certificates.
8. Arabic-first accessible responsive UI, 2D fallback for optional 3D visualization.
9. SLO/latency/error monitoring, synthetic login tests and runbook-linked alerts.
10. Executive presentation mode displaying verified metrics and outstanding risks.
11. Offline-capable Android development mode with mock/sanitized datasets only.
12. Android phased delivery: architecture -> auth -> read-only dashboards -> audited controls -> beta APK -> security/E2E -> release candidate; versioned builds and hashes.
13. AI assistant restricted to explainable, source-linked read-only analysis and permission-gated commands.
14. Camera/media and other project integrations only after data-source inventory and privacy controls.
15. Feature flags, rollback rehearsal, accessibility and performance budgets.

## Execution protocol
1. Read #57, #91, #96, #102, PR #53/#65/#66/#67 and canonical command register.
2. Create separate isolated fix PRs for each root cause. No unreviewed merge or production deployment.
3. Record baseline, reproduce defect, write regression test, patch, run CI, perform independent staging E2E.
4. For security-critical changes, require approved operator and independent evidence before production acceptance.
5. Preserve failed tests, open blockers, and missing credentials as BLOCKED; never auto-mark complete.
6. For demo, use only verified live features; label mock/staging clearly and disclose unresolved risks.

## Traceability
- https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/57
- https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/91
- https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/96
- https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/102
- forensic-command-center/UNIFIED_COMMAND_REGISTER_2026-10-27.md on feature/forensic-command-center-20261027

This file is a coordination artifact. It does not claim fixes, APK builds, deployment, credential creation, or passing tests.
