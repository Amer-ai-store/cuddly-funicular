# REQUIREMENTS_MATRIX — JAWAFA ONE AI

Generated from one table; counts below are computed from these rows, not estimated. Status vocabulary: NOT_STARTED, IN_PROGRESS, BUILT_NOT_TESTED, TEST_FAILED, TEST_PASSED, VERIFIED, BLOCKED.

**No row is VERIFIED**: VERIFIED requires a run in the target environment (the deployed site with the real Firebase project). All passes below ran on Firebase emulators and local Chromium on 2026-11-06.

| ID | Requirement | Priority | Implementation files | Dependencies | Acceptance criteria | Test ID | Test result | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| REQ-001 | Central Executive Dashboard | P0 | dashboard/one/app.js (renderHome) | core.js | KPIs, 7-day chart, agents, maps, assistant, hub; every figure labelled by source | E2E-02, E2E-03 | PASS (DEMO data) | docs/jawafa-one/evidence/e2e-results.json, 01-home-desktop-signed-out.png | TEST_PASSED |
| REQ-002 | Sales Management | P1 | app.js (renderSales), core.js dailySales | Data source | Daily sales + invoices filterable by branch | E2E-02, CORE-05 | PASS (DEMO) | docs/jawafa-one/evidence/e2e-results.json, unit-tests.txt | TEST_PASSED |
| REQ-003 | Procurement Management | P1 | — (legacy view jawafa-purchases is a status page) | REQ-057 | Purchase orders/suppliers from verified source | — | — | — | NOT_STARTED |
| REQ-004 | Inventory & Warehouses | P1 | app.js (renderInventory) | Data source | Stock per site, below-reorder filter, negative stock flagged | E2E-02 | PASS (DEMO) | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-005 | Financial Management | P1 | app.js (renderFinance) | REQ-057 | Read-only finance views from accounting source | E2E-02 | PASS render only (DEMO) | docs/jawafa-one/evidence/e2e-results.json | IN_PROGRESS |
| REQ-006 | Banking & Cheque Reconciliation | P1 | core.js detectAnomalies (unmatched_cheque), renderFinance | REQ-057 | Cleared cheques matched against bank lines | CORE-04 | PASS (DEMO) | docs/jawafa-one/evidence/unit-tests.txt | TEST_PASSED |
| REQ-007 | Cash Flow Intelligence | P2 | core.js (cash_variance), assistant liquidity answer | REQ-057 | Cash forecast from real ledger | CORE-04 | PASS variance only | docs/jawafa-one/evidence/unit-tests.txt | IN_PROGRESS |
| REQ-008 | Fraud & Anomaly Detection | P0 | core.js detectAnomalies/classify, renderInvestigations | REQ-057 for LIVE | 6 detectors; classes proven/unproven/verify/hypothesis; DEMO never 'proven'; no person accused | CORE-04 | PASS (DEMO) | docs/jawafa-one/evidence/unit-tests.txt | TEST_PASSED |
| REQ-009 | Employee Management | P2 | — (count only) | Data source | Employee records & devices | — | — | — | NOT_STARTED |
| REQ-010 | Branch Management | P1 | app.js renderBranches/addBranch/deleteBranch; rules companies/{id}/branches | — | Writers add/delete validated branches (name, type, city, coordinates); read-only roles see list; other companies denied | BR-01, E2E-24, E2E-27 | PASS | docs/jawafa-one/evidence/rules-tests.txt, e2e-results.json, 08-branches.png | TEST_PASSED |
| REQ-011 | Google Maps & Logistics | P2 | app.js renderMaps (sketch + Google Maps links) | Maps API key (domain-restricted) | Interactive map of branches/vehicles | E2E-02 | PASS sketch only | docs/jawafa-one/evidence/e2e-results.json | BLOCKED |
| REQ-012 | Restaurant & Bakery Operations | P2 | — | Data source | Production/sales for restaurant & bakery | — | — | — | NOT_STARTED |
| REQ-013 | Supplier Intelligence | P2 | — | REQ-003 | Supplier scoring from purchases | — | — | — | NOT_STARTED |
| REQ-014 | TrustSoft & Camera Integrations | P2 | legacy dashboard/trustsoft (read-only status) | Authorised camera API | Camera status/events per branch | — | — | — | BLOCKED |
| REQ-015 | AI Executive Assistant — local engine | P1 | app.js answer() | core.js | Answers 4 question types from dataset with cited source; refuses otherwise | E2E-05 | PASS | docs/jawafa-one/evidence/e2e-results.json, 02-assistant.png | TEST_PASSED |
| REQ-016 | Agent Command Center (registry UI) | P0 | app.js renderAgents, dashboard/aas/official-agent-roster.mjs | — | All known agents listed with honest status | E2E-02, E2E-10 | PASS | docs/jawafa-one/evidence/03-agents-signed-in.png | TEST_PASSED |
| REQ-017 | Task Distribution System | P1 | app.js company tasks; rules /tasks | REQ-041 dispatchers | Tasks per company with role rules; automatic dispatch | RBAC-01 | PASS rules | docs/jawafa-one/evidence/rules-tests.txt | IN_PROGRESS |
| REQ-018 | Audit & Evidence Center | P1 | rules /audit (append-only); app.js audit() + renderAudit (filter, CSV) | — | Append-only trail + viewer | AUD-01, E2E-25 | PASS | docs/jawafa-one/evidence/rules-tests.txt, 09-audit.png | TEST_PASSED |
| REQ-019 | Reports & Analytics / Export | P2 | app.js toCsv/downloadCsv on sales, inventory, findings, branches, audit | Data source for real reports | CSV export with source line and formula-injection guard; scheduled/PDF reports | E2E-22 | PASS (CSV only; no report builder) | docs/jawafa-one/evidence/e2e-results.json | IN_PROGRESS |
| REQ-020 | User & Role Management | P0 | app.js renderMembers, firestore.rules | REQ-021 | Invite, change role, remove, leave; enforced server-side | RBAC-01..03, INV-01..02, E2E-09, E2E-11..13 | PASS | docs/jawafa-one/evidence/rules-tests.txt, e2e-results.json | TEST_PASSED |
| REQ-021 | Google Authentication | P0 | app.js signIn (Firebase Auth compat 10.14.1) | Authorized domain amer-ai-store.github.io in Firebase console | Google sign-in; unauthenticated access denied | TEN-03, E2E-01, E2E-04, E2E-06 | PASS on emulator; production sign-in not yet exercised | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-022 | Multi-Tenant SaaS (company isolation) | P0 | firestore.rules companies/** | — | Company B cannot read/write company A via API | TEN-01..04, E2E-14 | PASS | docs/jawafa-one/evidence/rules-tests.txt, e2e-results.json | TEST_PASSED |
| REQ-023 | Database Connection Center (SQL Server/PostgreSQL/MySQL/REST) | P0 | app.js integrations() status only | Secure backend + least-privilege read-only account | Authorised read, record match, latency, outage, write-block, tenant isolation tests | — | — | INTEGRATION_STATUS.md | BLOCKED |
| REQ-024 | Store & POS Integration Center | P1 | legacy dashboard/luqta-api.js (client) | Deployed Luqta HTTPS server / POS sandbox | One connector verified against a real test environment | — | — | INTEGRATION_STATUS.md | BLOCKED |
| REQ-025 | ChatGPT & OpenAI Integration | P1 | — | Server-side key + backend proxy | Model calls from backend with logs/costs | — | — | INTEGRATION_STATUS.md | BLOCKED |
| REQ-026 | Gemini Integration | P1 | aas-cc/command-center/server/ai.mjs exists (not wired) | Backend per-company proxy | Gemini answers from authorised data with sources | — | — | INTEGRATION_STATUS.md | BLOCKED |
| REQ-027 | Facebook page link | P2 | app.js company profile; core.js validateSocial; rules validSocial | — | Managers add/edit https facebook.com link; shown in profile | SOC-01, E2E-07, E2E-08, CORE-02 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-028 | Instagram profile link | P2 | same as above | — | https instagram.com only | SOC-01, CORE-02 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-029 | TikTok profile link | P2 | same as above | — | https tiktok.com only | SOC-01, E2E-08 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-030 | Notifications & Approvals | P2 | — (invitations only) | — | Approval workflow + notifications | — | — | — | NOT_STARTED |
| REQ-031 | PWA | P1 | dashboard/one/manifest.webmanifest, sw.js, icon.svg | HTTPS host | Installable, shell cached, company data never cached | CORE-06 (syntax only) | sw not exercised (only registers on https) | docs/jawafa-one/evidence/unit-tests.txt | BUILT_NOT_TESTED |
| REQ-032 | Android APK (Trusted Web Activity) | P1 | apps/android/** ; workflow android-apk job; scripts/make-android-keystore.sh; apps/android/well-known/assetlinks.template.json | Owner: signing secrets + assetlinks.json on amer-ai-store.github.io | APK builds, installs, opens the app in Chrome; Google sign-in works | CI run 42271347513 android-apk | Debug APK BUILT in CI (sha256 169a38b9…). Not installed on a device yet | CI artifact jawafa-one-android-debug-apk | BUILT_NOT_TESTED |
| REQ-033 | Windows EXE (Electron) | P1 | apps/desktop/** ; workflow windows-exe job | Code-signing certificate (optional) | Portable exe + installer; app loads; only app/sign-in hosts open inside; offline page | DESK-01..03, Linux-Electron smoke, CI run 42271347513 windows-exe | PASS logic + shell; installer + zip BUILT on windows-latest; not launched on Windows | CI artifact jawafa-one-windows | BUILT_NOT_TESTED |
| REQ-034 | iOS app | P2 | PWA (Safari › Share › Add to Home Screen) | macOS + Xcode + Apple Developer Program account and signing | Native IPA installable on iPhone | — | — | — | BLOCKED |
| REQ-035 | System Administration | P2 | app.js integrations hub, company admin | — | Admin console | E2E-02 | PASS render | docs/jawafa-one/evidence/e2e-results.json | IN_PROGRESS |
| REQ-036 | Subscription & Company Management | P1 | company create/profile; plan field locked | Billing provider | Company lifecycle + plan management | E2E-06, PLAN-01 | PASS company; billing absent | docs/jawafa-one/evidence/rules-tests.txt | IN_PROGRESS |
| REQ-037 | AI Command Eye | P3 | — | Specification needed | Undefined in sources | — | — | — | NOT_STARTED |
| REQ-038 | Agent discovery & inventory | P0 | AGENT_MIGRATION_REPORT.md | — | Every agent in repo sources inventoried | repo grep for 999/777/666 | 19 official agents found; 999/777/666/D1/D2 not found | AGENT_MIGRATION_REPORT.md | BUILT_NOT_TESTED |
| REQ-039 | Agent Message Router (many-to-many, QUEUED→DELIVERED→READ→ACKNOWLEDGED/FAILED, dedupe) | P0 | core.js createRouter; rules agentMessages; app.js sendMessage | — | Forward-only states; receipts required from a recipient; unique ids; immutable body; no delete | CORE-03, MSG-01, E2E-10 | PASS | docs/jawafa-one/evidence/unit-tests.txt, rules-tests.txt, e2e-results.json | TEST_PASSED |
| REQ-040 | Per-agent test + two-agent delivery over real channel | P0 | — | Authorised agent endpoints | Receipt from destination | — | — | AGENT_MIGRATION_REPORT.md | BLOCKED |
| REQ-041 | Migrate 999 / 777 / 666 / dispatcher 1 & 2 | P0 | registry placeholders (BLOCKED) | Agent definitions + API channel | Definitions, permissions, tools transferred | — | — | AGENT_MIGRATION_REPORT.md | BLOCKED |
| REQ-042 | User profiles | P2 | rules /profiles; app.js selectCompany writes profiles/{uid} | — | Profile stores email, name, last company; private to user | PROF-01, E2E-26 | PASS | docs/jawafa-one/evidence/rules-tests.txt, e2e-results.json | TEST_PASSED |
| REQ-043 | Company registration | P0 | app.js createCompany | REQ-021 | Signed-in user creates company as sole owner, plan free | TEN-01, E2E-06 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-044 | Company membership & invitations | P0 | app.js invite/accept/revoke; rules invites | — | Only the invited verified email joins, with exactly the invited role | INV-01, E2E-09, E2E-11 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-045 | Branch-level permissions | P1 | — | REQ-010 | Role scoped to branches | — | — | — | NOT_STARTED |
| REQ-046 | Two test companies & cross-company API attack test | P0 | tests/firestore/tenancy.rules.test.mjs, tests/e2e/jawafa-one.e2e.mjs | — | Access denied via API, not just UI | TEN-02, E2E-14 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-047 | Roles: Owner, Chairman, GM, Procurement Mgr, Branch Mgr, Accountant, Auditor, Employee | P0 | core.js ROLES, firestore.rules | — | Exactly these 8 roles | CORE-01, RBAC-01..03 | PASS | docs/jawafa-one/evidence/unit-tests.txt | TEST_PASSED |
| REQ-048 | Server-side RBAC (not hidden buttons) | P0 | firestore.rules | — | Direct API writes by read-only roles rejected | RBAC-01, E2E-13 | PASS | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-049 | LIVE / DEMO / UNVERIFIED separation | P0 | core.js source labels, app.js badges/banners | — | All demo figures visibly labelled | E2E-03, CORE-04 | PASS | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-050 | No operational numbers when disconnected | P0 | app.js noData() | — | Demo hidden → 'no data source' instead of figures | E2E-23 | PASS | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-051 | Arabic RTL default + English | P1 | app.js T(), I18N, lang toggle | — | Full UI in both languages | E2E-20 | PASS for direction, navigation and headings; some explanatory texts Arabic-only | docs/jawafa-one/evidence/06-inventory-english.png | IN_PROGRESS |
| REQ-052 | Dark & light modes | P2 | styles.css tokens, theme toggle | — | Both themes legible | E2E-21 | PASS (light body text contrast 16.6:1) | docs/jawafa-one/evidence/07-home-light.png | TEST_PASSED |
| REQ-053 | Mobile-first layout | P0 | styles.css (bottom nav ≤860px) | — | No horizontal scroll at 390px, bottom nav | E2E-16, E2E-17 | PASS | docs/jawafa-one/evidence/04-home-mobile-390.png | TEST_PASSED |
| REQ-054 | Global search (Ctrl+K) | P2 | app.js setupSearch | — | Jump to any screen | E2E-19 | PASS | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-055 | Reorderable home & custom shortcuts (new app) | P3 | — (exists in legacy dashboard only) | — | — | — | — | — | NOT_STARTED |
| REQ-056 | Performance on phone viewport | P1 | no framework, no chart lib, lazy Firebase | — | Ready < 8 s | PERF-01 | PASS (desktop 1.0 s, mobile 0.6 s, local emulator — not a production measurement) | docs/jawafa-one/evidence/e2e-results.json | TEST_PASSED |
| REQ-057 | Backend Integration Layer for SQL (read-only, pagination, incremental sync) | P0 | — | Server, read-only DB login, network path to Jawafa_DB | — | — | — | DATABASE_CONNECTION_REPORT.md | BLOCKED |
| REQ-058 | No secrets/API keys in frontend | P0 | dashboard/one/* | — | No private keys; Firebase web config is a public identifier | static scan | PASS (no keys/passwords in dashboard/one) | SECURITY_CHECKLIST.md | TEST_PASSED |
| REQ-059 | No modification of Jawafa_DB / financial records | P0 | dashboard/one has no SQL or accounting write path | — | No write path exists | static scan | PASS | SECURITY_CHECKLIST.md | TEST_PASSED |
| REQ-060 | Business model: free for every business, no fees, no commission | P0 | plans view; rules force plan='free' on create and lock plan | — | No client can self-upgrade; free plan has full core | PLAN-01, E2E-15 | PASS | docs/jawafa-one/evidence/rules-tests.txt, e2e-results.json | TEST_PASSED |
| REQ-061 | Premium Plus subscription billing | P1 | plans view (button disabled) | Payment provider + billing backend (Admin SDK) | Paid upgrade changes plan server-side | — | — | — | NOT_STARTED |
| REQ-062 | Preserve legacy command center (dashboard/index.html, 38 views) | P0 | unchanged | — | Existing tests keep passing | regression suite | 52/53 PASS; 1 failure pre-dates this work | docs/jawafa-one/evidence/regression-tests.txt | TEST_PASSED |
| REQ-063 | Existing test aas-roster #11 (agent-directory label) | P2 | dashboard/tests/aas-roster.test.cjs | — | Test matches current navigation label | aas-roster #11 | FAIL before and after this change | KNOWN_ISSUES.md | TEST_FAILED |
| REQ-064 | Preserve Jawafa operations/forensic views | P0 | dashboard/index.html, jawafa-*.js — unchanged | — | Untouched | regression suite | PASS (jawafa tests) | docs/jawafa-one/evidence/regression-tests.txt | TEST_PASSED |
| REQ-065 | Preserve Luqta store admin client | P1 | dashboard/luqta-*.js — unchanged | — | Untouched | luqta-api tests | PASS | docs/jawafa-one/evidence/regression-tests.txt | TEST_PASSED |
| REQ-066 | Preserve AAS-CC Command Center (Cloudflare Worker) | P1 | aas-cc/ — unchanged | — | Untouched (no file changed) | not re-run this session | — | git diff shows no change under aas-cc/ | BUILT_NOT_TESTED |
| REQ-067 | Preserve Android apps (app/, luqta-mobile/) | P1 | unchanged | Android SDK | Builds (no file changed) | not re-run (Android SDK blocked in sandbox) | — | git diff shows no change under app/, luqta-mobile/ | BUILT_NOT_TESTED |
| REQ-068 | Preserve Android → Firestore live store (owner-only read) | P0 | firestore.rules root store rules kept | — | Only owner email reads store collections | STORE-01 | PASS | docs/jawafa-one/evidence/rules-tests.txt | TEST_PASSED |
| REQ-069 | Release readiness | P0 | RELEASE_READINESS.md | All P0 rows | Section 18 criteria | — | — | RELEASE_READINESS.md | BLOCKED |

## Counts

- VERIFIED: 0
- TEST_PASSED: 35
- BUILT_NOT_TESTED: 6
- IN_PROGRESS: 7
- TEST_FAILED: 1
- BLOCKED: 11
- NOT_STARTED: 9
- **Total: 69**
