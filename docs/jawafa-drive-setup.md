# Jawafa Drive integration

The public GitHub Pages dashboard cannot authenticate to a private Google Drive folder by itself. Deploy the read-only verifier on a private authenticated runner. Grant a dedicated Google service account `drive.readonly` access to the Jawafa export folder, save credentials in a private secret store, and keep all CSV contents private. Run `tools/jawafa_drive_readonly_verify.py` to check all files using pagination and SHA-256 before publishing only non-sensitive aggregates to an authenticated dashboard API. Never write to the original financial database.

## GitHub Actions OIDC configuration — incident 42612792167

The scheduled workflow `.github/workflows/jawafa-drive-inventory.yml` failed at step 5 on 2026-11-09 because BOTH Actions variables below expanded to empty strings. A rerun before configuring them will fail the same way. The workflow intentionally fails closed: it must **not** report a successful Drive verification without authentication.

### Configure Google Cloud (authorized administrator)

1. In the intended Google Cloud project, create or locate a Workload Identity Pool and an OIDC provider with issuer `https://token.actions.githubusercontent.com`. Map `google.subject=assertion.sub` and `attribute.repository=assertion.repository`, and restrict trusted tokens to the exact repository `Amer-ai-store/cuddly-funicular` (ideally also `refs/heads/main`).
2. Create or select a **dedicated** service account for the Jawafa Drive export. Grant only the `roles/iam.workloadIdentityUser` impersonation binding to the repository's `principalSet://iam.googleapis.com/.../attribute.repository/Amer-ai-store/cuddly-funicular`, using the actual Workload Identity Pool resource path. Do not grant broad project Editor/Owner roles or use a downloadable service-account key.
3. Enable the Google Drive API for the project, and share **only the intended private export folder** with the dedicated service-account email as Viewer. The verifier requests the `https://www.googleapis.com/auth/drive.readonly` scope, performs no write operations, and must not have access to unrelated finance folders.

### Configure GitHub repository variables

Open **Repository → Settings → Secrets and variables → Actions → Variables** for `Amer-ai-store/cuddly-funicular`, then create:

| Variable | Required value |
|---|---|
| `JAWAFA_WIF_PROVIDER` | Full Google provider resource name: `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID` |
| `JAWAFA_WIF_SERVICE_ACCOUNT` | Dedicated service-account email, e.g. `jawafa-drive-readonly@PROJECT_ID.iam.gserviceaccount.com` |

The example strings above are **placeholders**, not working credentials. Never paste private keys, tokens, or financial CSV data into workflow YAML, commits, issues, or logs. GitHub OIDC authorization is scoped by Google Cloud IAM and the provider's attribute condition.

### Independent acceptance criteria

1. Re-run the workflow from **Actions → Jawafa Drive inventory verification → Run workflow** after the variables and Google Cloud trust are configured.
2. The federation preflight must pass; then the Google Cloud authentication step must succeed, without writing credentials to logs.
3. `Verify export privately` must succeed with `Verified: True`. A successful preflight or OIDC login alone is **not** proof that the files and SHA-256 hashes match.
4. Keep the original Jawafa_DB, export data and files strictly read-only. Do not claim success when credentials are absent or when verification reports mismatches.

Official reference: https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account
