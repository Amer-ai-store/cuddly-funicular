# Reusable GitHub operating policy for ChatGPT and coding agents

This document is a **template**, not an account-wide ChatGPT setting and not an automatically running agent. The canonical instructions for this repository are in [AGENTS.md](../AGENTS.md). Copy the shorter block below into **ChatGPT Settings → Personalization → Custom Instructions** for conversations where that setting applies. Project-specific instructions and connected app permissions may limit or supersede it.

## Short account-level instruction (paste manually)

```text
For GitHub-related tasks, work autonomously with available authorized tools. First identify the correct owner/repository from the current task, link and connected account; never assume a previous repo. Read current code, issues, PRs, workflows, approvals and protections before changing anything. Use least privilege, a dedicated branch/PR where appropriate, static and CI tests, and exact API/CI evidence. Investigate failures and retry safe alternatives without claiming success unless verified. Never expose or invent secrets, bypass approval gates, publish to production without required independent acceptance, or change/delete/archive/alter financial, accounting or numerical records. Keep Jawafa_DB read-only. For Android release signing, check whether existing signing secrets and the installed-app signing certificate already exist: never automatically create, regenerate, rotate or copy a signing key across repositories. The one-time release-signing-setup workflow can only be deliberately initiated for the matching repository/application after secure authorization and backup planning. Ordinary tasks should run only non-destructive validation. Report exactly what was changed, tested, verified and blocked; include links.
```

## Per-repository routing

1. Identify the exact `owner/repo` from the latest explicit GitHub URL or the user's current task; if no repo is resolvable, do not guess or push changes to another repo.
2. Inspect that repository's root `AGENTS.md`, default branch, applicable release workflow, application identifiers, environment protection, existing signing workflow and current issues.
3. A signing workflow is only relevant to an Android app that deliberately uses the three `SIGNING_*` secrets; **do not** blindly distribute or run it in unrelated repositories.
4. The presence of `RELEASE_SETUP_TOKEN` never authorizes routine operation. A one-day fine-grained token must be limited to the exact repository and repository Secrets permission and revoked after the deliberate one-time run.
5. Existing published Android installers require certificate continuity. Check known APK/certificate evidence before creating a new signing key. GitHub Actions secrets are write-only after submission: keep an independently controlled, encrypted recovery copy before relying on a key for production; the workflow does **not** create such a backup.
6. For each routine GitHub task: inspect → identify risks → safely repair on a branch → validate → independent checks/review → merge only when gates pass → verify actual result. Record evidence and blockers. Do not use a one-time signing key generator as a per-task trigger.

## Verification criteria

- GitHub workflow file exists on the intended default branch; `workflow_dispatch` indicates only *manual eligibility*, not a successful run.
- A successful setup run must explicitly prove the three named secrets exist (their values cannot be recovered via GitHub API) and a subsequent safe Android build should verify the signing certificate matches the expected one; neither check alone proves independent backup.
- Release publishing remains governed by `RELEASE_PUBLISHING_ENABLED`, `RELEASE_APPROVED_SHA`, protected `production` approval and applicable security/E2E acceptance. Never infer those controls from documentation.
- Shared/global ChatGPT custom instructions guide behavior when applied, but cannot install a GitHub webhook, cause every chat to trigger an Action, or grant unavailable tool access.

## Source and ownership

Originally based on [PR #156](https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/pull/156) (Android key setup). Customize this document, never secrets, when changing repositories. This guidance does not change workflow triggers or publish gates.
