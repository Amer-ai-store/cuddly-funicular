# Jawafa V1 → V3.0 technical handoff
Source: «لوحة القيادة المركزيه والتطبيق». Receiver: «بدء تفصيلي مطور 111». Tracker: [Issue #92](https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/issues/92).

## Required marker (created only when V1 is actually complete)
The first development conversation must deliver complete, source-controlled V1 including an exact source SHA incorporated into main, source directories, genuine successful CI runs on **that exact SHA**, and a handoff review describing known blockers. Add `handoff/jawafa-v1-ready.json` to main in a reviewed PR:
```json
{
  "status": "READY_FOR_STAGE2",
  "source_repo": "Amer-ai-store/Mohammad-Ahmed-Ghannam",
  "source_commit": "REPLACE_WITH_REAL_40_HEX_COMMIT",
  "source_paths": ["app", "dashboard"],
  "ci_evidence": [
    { "workflow": "Android build and unit tests", "run_id": 123456 }
  ],
  "handoff_notes": "Real completion proof; list limitations and independent QA evidence."
}
```
**Do not commit this placeholder.** It cannot pass the gate.

## Automated watch
`.github/workflows/jawafa-v1-stage2-watch.yml` checks immediately when the handoff marker is pushed to `main`, and rechecks after relevant CI workflows complete on `main`. It also polls every 6 hours using GitHub's best-effort scheduler (scheduled runs can be delayed); `workflow_dispatch` allows an explicit recheck. Pull requests run an offline marker schema preflight but **only the post-merge main-branch run** can establish verified CI evidence and announce readiness. Missing marker => WAITING_FOR_V1. Malformed or false evidence => BLOCKED. Real source SHA, presence in main, paths and successful matching Actions run(s) => one non-duplicated Issue #92 comment with source SHA and linked proof. Nothing touches Jawafa_DB, server or another ChatGPT conversation. This establishes a **technical handoff**, not financial GATE-15 acceptance.

## Stage 2 (V3.0) execution — after proof
Use the verified V1 commit as a source baseline; import to a separate stage-2 branch, never overwrite the main development conversation's code. Apply the user's full V3.0 contract: historical audit and financial forensics, read-only integration to TrustSoft/Jawafa_DB, preservation of evidence, 3D command center, explainable AI and specialists, graph/time-machine/digital-twin/simulations, protected mobile integration and full test receipts. Build Android APK using the existing `.github/workflows/android-build.yml` or equivalent verified Gradle toolchain. Store checksums and build receipts. Windows EXE is an independent output. **The watch does not create code or an APK autonomously:** an authorized development session is required for implementing and validating V3.0.

Never publish private accounting data, private chat content, passwords or API tokens in public GitHub. No DML/DDL or modification to original accounting data. NO EVIDENCE = NO DONE.
