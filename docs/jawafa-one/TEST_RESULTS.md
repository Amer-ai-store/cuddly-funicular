# TEST_RESULTS — run 2026-11-06 (cycle 2) on this branch

Environment: Linux container, Node 22.23.4, Java 21, firebase-tools 13 (Firestore + Auth emulators, project `demo-jawafa-one`), Chromium via Playwright, Electron 33.2.1. **Not** the production Firebase project.

| Suite | Command | Result | Evidence |
|---|---|---|---|
| Core + desktop unit | `node --test dashboard/tests/one-core.test.cjs apps/desktop/test/config.test.cjs` | 9/9 PASS | evidence/unit-tests.txt |
| Firestore rules (tenant isolation, RBAC, invites, router, audit, social, plan, branches) | emulators:exec firestore | 16/16 PASS | evidence/rules-tests.txt |
| End-to-end (2 companies, owner/auditor/stranger, branches, audit, profile, CSV, no-data mode, English, light theme, search, 390 px phone) | emulators:exec auth,firestore | 28/28 PASS (consecutive runs) | evidence/e2e-results.json, *.png |
| Desktop shell smoke (Linux Electron, same main.js) | xvfb-run electron | PASS — window title «جوافة ONE AI \| مركز القيادة»; unreachable URL → offline.html | console (session log) |
| Windows build | `npm run dist:zip` | PASS — `JAWAFA ONE AI.exe` is PE32+ x86-64 GUI; zip SHA-256 `ecd284d1fde7dfef7a4abbb460e74cc3db3b551409e0cd74a3556d0e6244d914` | build output |
| GitHub Actions run 42271347513 (commit ec489cd) | workflow jawafa-one-apps.yml | tests ✔ (19/19 E2E, rules, unit) · android-apk ✔ · windows-exe ✔ | https://github.com/Guava2026/Mohammad-Ahmed-Ghannam/actions/runs/42271347513 |
| Windows installer (NSIS) | CI windows-latest | BUILT (artifact jawafa-one-windows, 192.8 MB zip of setup.exe + portable zip) | CI artifact |
| Android APK | CI ubuntu + Android SDK 35 | BUILT debug APK, sha256 `169a38b922cc58ad0673ac111fb44383c6868e300c66f07a263a53d6e4b72bc8` (debug key changes per run — release signing added) | CI artifact jawafa-one-android-debug-apk |
| Owner deploy script dry run | `scripts/deploy-jawafa-one.sh` answered «no» | PASS — ran 16/16 rules tests, stopped before deploying | console |
| Keystore script | `scripts/make-android-keystore.sh` with a throw-away key | PASS — produced fingerprint and valid assetlinks.json (test key deleted) | console |
| Regression (all existing dashboard tests) | `node --test dashboard/tests/*` | 52/53 PASS; #11 aas-roster FAILS identically before this change | evidence/regression-tests.txt |

## Defects found and fixed during testing

1. **Security (rules):** a stored role value `"owner"` in `roles` granted owner-level rights. Fixed: `roleIn` accepts only the 7 invitable roles; test RBAC-03.
2. **UX:** after creating a company, a late `location.hash = "#company"` fired on server acknowledgement and pulled the user away from the screen they had moved to. Removed.
3. **Syntax:** an extra parenthesis in app.js (missed by `node --check` on a .js file) — CORE-06 now checks app.js as an ES module.
4. Visual: empty company selector shown when signed out (`[hidden]` overridden by CSS), oversized DEMO badges, clipped chart axis labels, mixed digit styles.

## Not tested (and therefore not claimed)

Production Google sign-in, service worker/offline install, English completeness of explanatory texts, installing the APK on a phone, running the exe/installer on Windows, signed release build (needs owner secrets), iOS.
