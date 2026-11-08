# RELEASE_READINESS

## Decision: **NOT READY** for production

| Section 18 criterion | State |
|---|---|
| Build succeeds | Web: yes (static). Windows installer + portable: yes (CI). Debug APK: yes (CI). Signed release: needs owner secrets |
| Critical tests pass | Yes on emulators, locally and in GitHub Actions (16 rules, 28 E2E, 9 unit); 1 pre-existing unrelated failure |
| User permissions proven | On emulator only |
| Company isolation proven | On emulator only (API-level) |
| Secrets protected | Yes — no secrets in client code |
| Required connection tests pass | No — SQL, Gemini, POS all BLOCKED |
| Data integrity proven | N/A — only DEMO data |
| Required agent tests pass | No — no delivery channel |
| No known critical vulnerabilities | Open HIGH item: store collections writable by any signed-in user (App Check needed) |
| Rollback & recovery plan | Below |

## Safe to do now

A **preview** at `/one/` (DEMO data, clearly labelled) after merge, once the owner deploys the new rules and authorises the domain.

## Rollback

- Web: revert the merge commit; Pages redeploys the previous `dashboard/`. The legacy dashboard is untouched.
- Rules: `firebase deploy --only firestore:rules` with the previous `firestore.rules` from git history (the store section is unchanged, so the Android app is unaffected either way).
- Apps: they only load the hosted URL; reverting the web reverts them.
