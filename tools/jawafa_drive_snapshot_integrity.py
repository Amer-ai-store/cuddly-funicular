#!/usr/bin/env python3
"""Private, read-only Drive snapshot verifier with explicit freshness semantics.

Uses a pre-authorized rclone remote: never creates credentials, uploads, deletes,
or accesses Jawafa_DB. Google-reported SHA-256 is compared to a private manifest;
this is not an independent re-download and hash of each file.
"""
import argparse
import csv
from collections import Counter
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys

DEFAULT_RCLONE = r"C:\Export\JawafaDriveTransfer\rclone-portable\rclone-v1.75.2-windows-amd64\rclone.exe"
DEFAULT_CONFIG = r"C:\Export\JawafaDriveTransfer\rclone-portable\jawafa.conf"
DEFAULT_REPORT_DIR = r"C:\ProgramData\JawafaReadOnly\SecurityEvidence\SnapshotVerification"
HASH = re.compile(r"^[0-9a-f]{64}$")


def decode_csv(raw):
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    if not reader.fieldnames:
        raise ValueError("missing CSV headers")
    data = list(reader)
    if any(None in row or None in row.values() for row in data):
        raise ValueError("malformed CSV columns")
    return data


def evaluate(inventory, manifest, objects, export_results=None,
             manifest_modified=None, max_age_hours=None, now=None):
    """Pure validation: aggregate statuses only; no private table names in output."""
    problems = Counter()

    def fault(key, n=1):
        problems[key] += n

    def has_fields(rows, fields):
        if not rows:
            fault("empty_required_csv")
            return False
        if not fields.issubset(rows[0]):
            fault("wrong_csv_schema")
            return False
        return True

    inv_names = []
    if inventory and {"schema_name", "table_name"}.issubset(inventory[0]):
        inv_names = [r["schema_name"].strip() + "." + r["table_name"].strip() + ".csv"
                     for r in inventory]
    elif inventory and {"schema", "table"}.issubset(inventory[0]):
        inv_names = [r["schema"].strip() + "." + r["table"].strip() + ".csv"
                     for r in inventory]
    else:
        fault("wrong_inventory_schema")

    m_names = []
    if has_fields(manifest, {"file", "bytes", "sha256"}):
        m_names = [r["file"].strip() for r in manifest]

    drive_names = []
    for r in objects:
        if not all(k in r for k in ("Path", "Size")):
            fault("wrong_drive_metadata_schema")
            continue
        drive_names.append(r["Path"])

    for category, names in (("inventory", inv_names),
                            ("manifest", m_names), ("drive", drive_names)):
        fault(category + "_duplicates",
              sum(n - 1 for n in Counter(names).values() if n > 1))
        if not names:
            fault(category + "_empty")

    expected = set(inv_names)
    references = set()
    if export_results is not None:
        if has_fields(export_results, {"table", "status"}):
            declared = set()
            ok = set()
            for r in export_results:
                name = r["table"].strip() + ".csv"
                if name in declared:
                    fault("duplicate_export_status")
                declared.add(name)
                status = r["status"].strip()
                if status == "OK":
                    ok.add(name)
                elif status == "REFERENCE_ONLY_NOT_EXPORTED":
                    references.add(name)
                else:
                    fault("unknown_export_status")
            fault("inventory_missing_export_status", len(expected - declared))
            fault("export_status_unknown_table", len(declared - expected))
            expected = ok
        else:
            fault("unusable_export_results")

    if references.intersection(expected):
        fault("conflicting_reference_status")
    if references - set(inv_names):
        fault("unknown_reference_table", len(references - set(inv_names)))

    man_set, drive_set = set(m_names), set(drive_names)
    fault("missing_manifest", len(expected - man_set))
    fault("unexpected_manifest", len(man_set - expected))
    fault("missing_drive", len(expected - drive_set))
    fault("unexpected_drive", len(drive_set - expected))

    obj_by_name = {o.get("Path"): o for o in objects}
    for r in manifest:
        name = r.get("file", "").strip()
        o = obj_by_name.get(name)
        try:
            target_size = int(r["bytes"])
            if target_size < 0:
                raise ValueError("negative")
        except (ValueError, KeyError, TypeError):
            fault("invalid_manifest_size")
            continue
        expected_sha = r.get("sha256", "").strip().lower()
        if not HASH.fullmatch(expected_sha):
            fault("invalid_manifest_sha256")
        if o is None:
            continue
        try:
            size = int(o["Size"])
        except (KeyError, TypeError, ValueError):
            fault("invalid_drive_size")
            continue
        if size != target_size:
            fault("size_mismatch")
        hashes = o.get("Hashes") or {}
        actual = (hashes.get("sha256") or hashes.get("SHA-256") or "").lower()
        if not HASH.fullmatch(actual):
            fault("missing_provider_sha256")
        elif HASH.fullmatch(expected_sha) and actual != expected_sha:
            fault("sha256_mismatch")

    modified_age_hours = None
    if max_age_hours is not None:
        if max_age_hours <= 0:
            fault("invalid_freshness_policy")
        if not manifest_modified:
            fault("manifest_modified_time_missing")
        else:
            try:
                modified = datetime.fromisoformat(
                    manifest_modified.replace("Z", "+00:00"))
                if modified.tzinfo is None:
                    raise ValueError("missing timezone")
                current = now or datetime.now(timezone.utc)
                modified_age_hours = round(
                    (current - modified).total_seconds() / 3600, 3)
                if modified_age_hours > max_age_hours:
                    fault("stale_manifest_upload")
                if modified_age_hours < -0.0833:
                    fault("future_manifest_upload")
            except (ValueError, TypeError):
                fault("invalid_manifest_modified_time")

    faults = {k: int(v) for k, v in sorted(problems.items()) if v > 0}
    clean = not faults
    status = ("FAILED" if not clean else
              "VERIFIED" if max_age_hours is not None else
              "INTEGRITY_VERIFIED_ONLY")
    return {
        "status": status,
        "integrity_verified": clean,
        "freshness_policy_applied": max_age_hours is not None,
        "freshness_basis": "Drive manifest modified time, NOT source DB update time",
        "manifest_age_hours": modified_age_hours,
        "inventory_count": len(inventory),
        "manifest_count": len(manifest),
        "drive_file_count": len(drive_names),
        "reference_only_count": len(references),
        "issue_counts": faults,
        "hash_method": "provider_sha256_vs_manifest_not_re_download",
    }


def fetch(rclone_path, config_path, folder_id, *args):
    command = [rclone_path, "--config", config_path,
               "--drive-root-folder-id", folder_id, *args]
    result = subprocess.run(command, capture_output=True, timeout=300)
    if result.returncode:
        # Never echo auth stderr or OAuth information.
        raise RuntimeError("rclone command failed: " + args[0])
    return result.stdout


def run(args):
    remote = args.remote.rstrip(":") + ":"
    def rd(*cmd):
        return fetch(args.rclone, args.config, args.folder_id, *cmd)
    entries = json.loads(rd("lsjson", remote, "--max-depth", "1"))
    names = {e.get("Name") for e in entries if not e.get("IsDir")}
    needed = {"inventory_tables.csv", "manifest_sha256.csv"}
    if not needed.issubset(names):
        raise ValueError("required snapshot inventory or manifest missing")
    inventory = decode_csv(rd("cat", remote + "inventory_tables.csv"))
    manifest = decode_csv(rd("cat", remote + "manifest_sha256.csv"))
    exports = (decode_csv(rd("cat", remote + "export_results.csv"))
               if "export_results.csv" in names else None)
    objects = json.loads(rd("lsjson", remote + "data", "--recursive",
                            "--files-only", "--hash-type", "SHA-256",
                            "--fast-list"))
    manifest_meta = json.loads(
        rd("lsjson", remote + "manifest_sha256.csv", "--stat"))
    return evaluate(inventory, manifest, objects, exports,
                    manifest_modified=manifest_meta.get("ModTime"),
                    max_age_hours=args.max_manifest_age_hours)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--folder-id", required=True,
                        help="Approved Drive snapshot folder ID")
    parser.add_argument("--rclone", default=DEFAULT_RCLONE)
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--remote", default="JawafaData:")
    parser.add_argument("--max-manifest-age-hours", type=float, default=None)
    parser.add_argument("--output-dir", default=DEFAULT_REPORT_DIR)
    args = parser.parse_args(argv)
    try:
        result = run(args)
    except Exception as exc:
        result = {"status": "ERROR", "error_type": type(exc).__name__,
                  "integrity_verified": False, "issue_counts": {}}
    result["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    target = Path(args.output_dir)
    target.mkdir(parents=True, exist_ok=True)
    output = target / "latest_snapshot_verification.json"
    temp = target / "latest_snapshot_verification.json.tmp"
    os.umask(0o077)
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    os.replace(temp, output)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] in ("VERIFIED", "INTEGRITY_VERIFIED_ONLY") else 2


if __name__ == "__main__":
    sys.exit(main())
