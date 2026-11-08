# Jawafa Drive integration

The public GitHub Pages dashboard cannot authenticate to a private Google Drive folder by itself. Deploy the read-only verifier on a private authenticated runner. Grant a dedicated Google service account `drive.readonly` access to the Jawafa export folder, save credentials in a private secret store, and keep all CSV contents private. Run `tools/jawafa_drive_readonly_verify.py` to check all files using pagination and SHA-256 before publishing only non-sensitive aggregates to an authenticated dashboard API. Never write to the original financial database.
