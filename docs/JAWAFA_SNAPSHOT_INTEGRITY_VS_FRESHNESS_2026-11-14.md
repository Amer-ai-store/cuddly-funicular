# Jawafa Drive snapshot integrity vs freshness — 2026-11-14

## Grounded evidence (private files not redistributed)

- Baseline folder `Jawafa_DB_Exports`: `inventory_tables.csv` last modified 2026-10-26, and `manifest_sha256.csv` last modified 2026-10-27. The verified 2026-11-12 on-host result attests to the integrity of **this older snapshot**, not to current financial database recency.
- Later archive folder `Jawafa_Forensic_Offsite_Copy_20261112/Exports/hourly-v5/20261112-0100`: metadata retrieved directly from the private owner's Google Drive.
- This later inventory contains **1,024** unique declared tables, while export results contain **1,023 OK** and **1 REFERENCE_ONLY_NOT_EXPORTED** (a declared baseline reference intentionally not exported). The newer SHA-256 manifest contains **1,023** unique entries, all SHA-256 strings syntactically valid.
- The manifest names match the 1,023 `OK` table names **exactly**. The one declared table not in the manifest is exactly the `REFERENCE_ONLY_NOT_EXPORTED` entry. No missing manifest entry was found for an `OK` table.
- Google Drive listing returned **1,000** CSV children of the new `data` folder, but that metadata endpoint is capped at 1,000 entries per call. **This does not independently establish the remaining 23 Drive files or their hashes.** The newer export has *not yet passed complete per-file Drive hash verification* from this session.

## Added safe validator: `tools/jawafa_drive_snapshot_integrity.py`

- Requires a verified, private, existing rclone OAuth configuration; accepts an **explicit** snapshot folder ID, e.g. the newer archive folder ID (never guess “latest” from a path).
- Permits either baseline `schema_name/table_name` or newer `schema/table` inventory columns.
- Verifies **exactly** one eligible manifest/Drive file for each export result with `status=OK`. A `REFERENCE_ONLY_NOT_EXPORTED` row may be omitted only when declared in `export_results.csv`.
- Rejects unknown statuses, missing/extra/duplicate manifest or Drive entries, absent SHA-256 metadata, invalid hashes and size mismatches.
- Without a freshness policy, output is **`INTEGRITY_VERIFIED_ONLY`**, not unqualified `VERIFIED`. With `--max-manifest-age-hours N`, freshness of the **Google Drive manifest's modification timestamp** is checked and the result is `VERIFIED` only when content + this upload-timestamp policy both pass.
- Google Drive manifest modification is **not** proof of the source database's own last update; actual source freshness requires additional on-host export scheduler/SQL evidence.
- No downloading all 8.64 GB is necessary for provider-reported SHA-256 comparison; this is NOT a fresh download-and-rehash verification.
- This source is a **new tool only in GitHub** until an authorized private on-host deployment runs it. It does not alter the server's existing working daily task, financial database, or OAuth configuration.

## Operator-only test example (private host, read only)

```powershell
# On the authorized server using a pre-authorized rclone remote, not a public CI runner:
python tools/jawafa_drive_snapshot_integrity.py `
  --folder-id 1WMPPWYLyooGUhY74xp4wkclWFbWUQE8h `
  --max-manifest-age-hours 36
```

A historical snapshot older than 36 hours should **fail the freshness policy**, even when its hashes are valid. For forensic archive verification only, omit that option: the output is then `INTEGRITY_VERIFIED_ONLY`.

## Verification and blocked next steps

- GitHub PR CI runs the Python validator's deterministic unit tests with no credentials or Drive data.
- Live validation of all 1,023 newer files requires an authorized on-host rclone session or Google Drive API pagination. The Remote Desktop Commander connector reported its **monthly usage limit** on 2026-11-14, so it was not possible to run this script on JAWAFFASVR during this session.
- Cross-check the final snapshot against a completed export manifest, SQL read-only source freshness, and scheduling evidence before claiming current backups are operational.
- The working rclone remote relies on a shared OAuth client ID scheduled for retirement during 2026. Track safe migration to a separate privately authorized client in Issue #5. Never reveal its refresh token or overwrite the working `jawafa.conf` until the replacement passes private validation.

No sensitive schema/table names, hashes or financial file contents are stored in this document.
