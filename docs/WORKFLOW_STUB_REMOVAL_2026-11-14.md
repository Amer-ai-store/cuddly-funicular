# Invalid Unity workflow stub remediation — 2026-11-14

Repository: `Amer-ai-store/cuddly-funicular`

## Proven failure
- `.github/workflows/main.yml` had just two top-level YAML lines: `- name: Buildalon unity-uwp-builder` and `uses: buildalon/unity-uwp-builder@v1.0.4`.
- GitHub Actions requires a workflow mapping with events and jobs; the file was only an **individual step fragment** and therefore not a runnable workflow.
- The failed run `43154342716` at the merged branch SHA `a6b910d8f27da5e762710e3082ba550b3fd9a8e5` completed with `failure` and **zero jobs**; see https://github.com/Amer-ai-store/cuddly-funicular/actions/runs/43154342716 .
- Repository history shows the file was introduced in initial commit `b4856b0978f4f8617b320cc410cea7e7797d7ed1`, with no subsequent edits.
- Searching the repository for the builder action returned only this invalid workflow stub. No Unity build steps or project integration were proven.

## Minimal-root-cause correction
- Delete **only** the invalid `.github/workflows/main.yml` stub. It never executed a working build or tests, so deletion does not turn a functioning gate off.
- Preserve the existing Android build `.github/workflows/android-build.yml` and independent quality, security, and CI workflows unchanged.
- If Unity UWP packaging is required later, create a fully specified workflow in a separate PR with a validated Unity project, toolchain, runner, build/test steps, explicit permissions and evidence. Do not reintroduce a standalone action step as a workflow.
- Do not claim that removing this malformed file proves Unity build capability, nor that all GitHub failures are resolved.

## Acceptance
- GitHub no longer creates new `.github/workflows/main.yml` failed runs for a push on `main`.
- Active security, Android and other CI workflows retain their expected triggers and behavior.
- No changes to financial exports, Jawafa_DB, deployment configuration, or other workflow files.

This is separate from the private on-server Drive integrity verification and rclone OAuth client migration tracked in Issue #5.
