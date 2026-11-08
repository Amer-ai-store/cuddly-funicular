# INTEGRATION_STATUS

Rule: no integration is LIVE without a documented test in the target environment. None is LIVE in this build.

| Integration | Status | What exists | What is needed |
|---|---|---|---|
| Firebase Auth (Google) | TEST_PASSED on emulator | app.js signIn, popup/redirect fallback | Authorized domain `amer-ai-store.github.io`; Google provider on; run E2E against production |
| Firestore multi-company | TEST_PASSED on emulator | firestore.rules companies/invites/profiles | `firebase deploy --only firestore:rules` |
| SQL Server · Jawafa_DB | BLOCKED | Nothing in the new app (by design) | See DATABASE_CONNECTION_REPORT.md |
| PostgreSQL / MySQL / REST | NOT_STARTED | — | Same backend gateway |
| Gemini | BLOCKED | `aas-cc/command-center/server/ai.mjs` proxy (single-tenant AAS) | Per-company proxy with key on server, logs, cost metering |
| OpenAI / ChatGPT | BLOCKED | — | Server-side key; ChatGPT conversation links are not an API |
| Store / POS (Luqta) | BLOCKED | `dashboard/luqta-api.js` client in legacy dashboard | Deployed HTTPS Luqta server or POS sandbox for a connector test |
| Google Maps | BLOCKED | Relative sketch + "open in Google Maps" links | Domain-restricted Maps JS API key |
| Facebook / Instagram / TikTok | TEST_PASSED (links only) | Validated links in company profile | Graph / TikTok APIs + app review for posting/insights |
| TrustSoft cameras | BLOCKED | Legacy read-only TrustSoft status module | Authorised camera/event API |
| Premium Plus billing | NOT_STARTED | Plan field locked to backend | Payment provider + Admin-SDK billing function |
| Windows app | BUILT_NOT_TESTED | Installer + portable built on windows-latest (run 42271347513) | Run on Windows; optional code-signing cert |
| Android app | BUILT_NOT_TESTED | Debug APK built in CI run 42271347513; release signing pipeline ready | Owner: signing secrets + assetlinks.json (DEPLOY.md §5); install on a phone |
| iOS app | BLOCKED | PWA installable from Safari | Mac + Xcode + Apple Developer account |
