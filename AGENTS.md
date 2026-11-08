# Codex cloud environment operating instructions

## Scope
Repository: Amer-ai-store/Mohammad-Ahmed-Ghannam. These instructions apply to Codex tasks in this repository. They do not grant permissions unavailable to the agent.

## Autonomous execution
For each authorized task, inspect the repository and current environment first; select the least-privileged reversible solution; implement, test, and record evidence without repeated approval for routine non-destructive work. If blocked, try a safe alternative and report the precise blocker. Never claim a cloud environment, secret, deployment, or integration exists without verifying it through the corresponding service.

## Commit signing and DCO (required)
Every Git commit created by Codex, Claude, automation, or a developer must carry a real `Signed-off-by: Full Name <verified-contributor-email>` trailer matching the contributor who certifies the change. When committing locally, configure the correct author identity and use `git commit -s` (or `git -c user.name=... -c user.email=... commit -s`). When creating Git objects through an API, include an exact, complete `Signed-off-by:` footer in each message and verify the GitHub DCO check actually passes.
Do not invent another contributor's identity, fabricate an attestation, or disable/bypass the DCO app. When an existing PR has unsigned history, preserve the original commits in a separate immutable/archived ref and verify the content/tree before any history rewrite; update a shared ref only with an expected-SHA lease. Prefer additive changes to history rewrites.
Before marking any PR ready, verify DCO, conflict-free mergeability, source-code tests, security checks, independent review, and every required release gate. Never count skipped, neutral, or unstarted checks as successful.

## Cloud environment configuration
Create/configure a Codex cloud environment through ChatGPT settings when the service provides an authorized action. Associate it with this repository and the intended branch. Use the minimal required setup script and pinned dependencies. Enable network access only when necessary, with appropriate destination restrictions. Verify setup by running a non-destructive test.

## Variables and secrets
Environment variables are non-sensitive configuration only. Secret values must be stored in the provider's secret manager, not in repository files, logs, issues, screenshots, or chat. Never invent secret values. For missing credentials, record their names and stop only the affected integration. Rotate any exposed credentials. Do not copy secrets between Codex and GitHub Actions automatically; configure each provider separately using authorized secure actions.

## Financial and production safety
Jawafa_DB and original accounting records are read-only. No INSERT, UPDATE, DELETE, DDL, or destructive restoration. No public production deployment until independently verified HTTPS, authentication, least-privilege database credentials, security review, and end-to-end acceptance tests. Preserve backups and audit trails.

## Evidence and completion
For each task record: requested action, source, changes, tests and outputs, commit/PR links, status (NOT STARTED / BLOCKED / TESTED / VERIFIED), and remaining blockers. NO EVIDENCE = NO DONE. Prefer changes on a separate branch and PR with review before merging to main.

## Suggested non-secret variable names (examples only)
APP_ENV=staging
GITHUB_REPOSITORY=Amer-ai-store/Mohammad-Ahmed-Ghannam
JAWAFA_DB_MODE=read_only
DEPLOYMENT_ENABLED=false

## Secret key names (values must be supplied via secret manager)
GITHUB_TOKEN (only if required and not provided by native authentication)
DATABASE_READONLY_URL (only if a verified least-privilege account exists)

## Automatic fallback ladder
1. Try the connected provider's native action, then an existing verified integration, then a repository-native CI workflow or a safe documented manual prerequisite.
2. If a cloud environment cannot be created via available tools, prepare setup instructions and non-secret templates in the repository. Never claim a provider-side environment was created.
3. If credentials are unavailable, use native GitHub authentication or ephemeral CI credentials where supported. Never fabricate tokens, bypass authentication, or ask to paste secret values into issues.
4. On failing checks, inspect logs, reproduce, fix on a branch, rerun tests and keep production disabled. Escalate only irreversible operations, account-level authorization, payments, secret entry, or security exceptions.
5. Reuse existing task records; do not create duplicate agents or scheduled jobs without checking current automation inventory.

## Codex environment checklist
- Select the repository and branch in the Codex cloud environment settings.
- Non-secret environment variables: APP_ENV=staging, JAWAFA_DB_MODE=read_only, DEPLOYMENT_ENABLED=false.
- Add provider-managed secrets only if required and available; verify by safe presence checks, never by printing values.
- Default network policy: disabled; enable narrow access for required dependency registries only when supported.
- Setup script: detect package manager from lockfiles, install with its frozen/CI mode, and run existing lint/test scripts; never run database migrations during setup.
- Verify: environment starts, repository checkout succeeds, tests return exit code 0, and no secret appears in logs.
- Record the provider environment identifier, run URL, timestamp and evidence once actually created.

## Releasing the Luqta Android app

- For every new release follow [docs/release-runbook.md](docs/release-runbook.md). The stable signing key, the `production` environment and `RELEASE_PUBLISHING_ENABLED` are set up since v2.0.86; only `RELEASE_APPROVED_SHA` changes per release.
- The owner works from a phone only (no computer, no terminal). Give short Arabic steps with direct browser links. The owner does two things: updates `RELEASE_APPROVED_SHA` to the SHA you send, and approves `production` in Chrome (Desktop site), because the GitHub mobile app does not show the approval button. You do everything else and verify the signer is `CN=Amer AI Store, O=Amer AI Store, C=JO`, the Release exists and the `latest/download/amer-store.apk` link works.

## Per-conversation repository selection and signing safety

- At the beginning of each new GitHub-related task, resolve the exact `owner/repo` from the current request; do not silently reuse this repository for a different task. Read the selected repository's own `AGENTS.md`, its workflows, security requirements and latest evidence.
- This file applies to agents operating **in this repository**, not automatically to every ChatGPT account conversation. A short reusable account-level instruction template is stored in [docs/chatgpt-github-operating-policy.md](docs/chatgpt-github-operating-policy.md); the account owner must enable it through ChatGPT Custom Instructions where supported.
- Android release signing setup ([.github/workflows/release-signing-setup.yml](.github/workflows/release-signing-setup.yml)) is a **one-time, human-initiated** operation only for the relevant app and repository. **Never dispatch it in response to an unrelated task or as a recurring automation**. Do not copy a signing key, PAT or signing secrets into another repository. Check existing signing secrets and previously distributed APK certificate before any creation.
- If any `SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD` or `SIGNING_KEY_PASSWORD` already exists, fail closed without modification. Do not delete existing partial secrets to retry automatically. GitHub secrets are not retrievable and writes to the three secrets are not atomic; require secure independently controlled recovery/backup planning before treating the signing setup as production ready.
- Signing setup must never modify `RELEASE_PUBLISHING_ENABLED`, `RELEASE_APPROVED_SHA`, the `production` environment, financial data or Issue #102 release acceptance. Use non-destructive validation for recurring tasks.
