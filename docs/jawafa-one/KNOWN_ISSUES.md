# KNOWN_ISSUES

1. **Pre-existing failing test** `dashboard/tests/aas-roster.test.cjs` #11 expects the nav label `دليل الوكلاء والمستشارين`; the legacy NAV now says `دليل الوكلاء`. Fails identically without this change. Not modified (outside scope).
2. All operational figures are **DEMO**; no LIVE data source exists.
3. Gemini/OpenAI not connected; the assistant only answers 4 question types locally and refuses the rest.
4. Android: debug APK is built in CI but not installed on a device yet; a stable signed release needs the owner's signing secrets (DEPLOY.md step 5).
5. Windows exe not launched on Windows; unsigned (SmartScreen warning). Google may refuse sign-in in some embedded-browser cases; the app hides the Electron token in its user agent but this is not verified against production Google sign-in.
6. Without `/.well-known/assetlinks.json` on `amer-ai-store.github.io` (served from the account's user-site repo), the Android app shows a Chrome URL bar.
7. English translation covers navigation and most labels; some explanatory texts are Arabic-only.
8. Branch-level permissions are not implemented: roles apply to the whole company.
9. Deleting a company is allowed by rules (owner) but not offered in UI; subcollections would be orphaned.
10. Android-store root collections remain writable by any signed-in user (pre-existing; see SECURITY_CHECKLIST).
11. `firestore.rules` changes are **not deployed**; production still runs the previous rules.
12. `.github/workflows/main.yml` is an empty file (commit 2e8b590) so GitHub reports a failed run on every push. Pre-existing; not changed.
13. Node 20 deprecation warnings from pinned GitHub actions in CI (informational).
