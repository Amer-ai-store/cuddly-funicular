# SECURITY_CHECKLIST

| Check | Status | Evidence |
|---|---|---|
| Company data isolated per tenant, enforced server-side | PASS (emulator) | TEN-01..04, E2E-14 |
| Unauthenticated access denied | PASS | TEN-03, E2E-04 |
| Role checks in Firestore rules, not UI only | PASS | RBAC-01..03, E2E-13 (direct API write by auditor → permission-denied) |
| Ownership cannot be transferred or owner removed by managers | PASS | RBAC-02 |
| Invitations bound to verified email and exact role | PASS | INV-01 |
| Plan (free / Premium Plus) not client-writable | PASS | PLAN-01, E2E-15 |
| Agent messages immutable, forward-only, never deleted; audit log append-only | PASS | MSG-01, AUD-01 |
| Social links: https + exact platform host (rules + client) | PASS | SOC-01, CORE-02, E2E-07 |
| Branch records validated (fields, type, coordinates) and writable only by writer roles | PASS | BR-01, E2E-27 |
| CSV export neutralises spreadsheet formulas (=,+,-,@) in text cells | PASS | E2E-22 |
| Android signing key never in repo; CI decodes it to a temp file and deletes it | PASS (review) | jawafa-one-apps.yml |
| No private keys/passwords in `dashboard/one` | PASS (static scan) | The Firebase web config in `dashboard/firebase-config.js` is a public project identifier; access is decided by rules |
| No SQL/accounting write path in the new app | PASS (static) | No SQL client or Jawafa_DB endpoint exists in dashboard/one or apps/* |
| DOM built with `textContent`/elements, no `innerHTML` from data | PASS (review) | Only static SVG strings use innerHTML |
| Service worker never caches Firestore/Auth/API responses | PASS (review) | sw.js caches same-origin shell files only |
| Desktop: contextIsolation + sandbox, no nodeIntegration, permissions denied, external links → system browser | PASS | DESK-02, main.js |
| Android: no WebView fallback (Custom Tabs only), no keystore in repo | PASS (review) | AndroidManifest FALLBACK_STRATEGY=customtabs, .gitignore |
| **Open:** Android store root collections are writable by any signed-in user (pre-existing; needed by the store app's anonymous sync) | OPEN — HIGH before public launch | Add Firebase App Check or move writes behind a backend |
| **Open:** Rules deployed to production? | NOT DONE | Owner must review and deploy |
| **Open:** Code signing for EXE/APK | NOT DONE | Unsigned/debug builds trigger SmartScreen / unknown-source warnings |
| **Open:** Rate limiting / abuse (anyone can create companies) | NOT DONE | Consider App Check + quotas |
| **Open:** Firestore `get()` cost per request in rules | INFO | Each tenant read performs one company document lookup |
