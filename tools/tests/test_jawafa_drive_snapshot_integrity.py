"""No network, Drive access, or secrets. Synthetic snapshot contract regressions."""
import unittest
from datetime import datetime, timezone

from tools.jawafa_drive_snapshot_integrity import evaluate

A = "a" * 64
B = "b" * 64
INV = [
    {"schema": "Sales", "table": "One", "rows": "2", "cols": "3"},
    {"schema": "Sales", "table": "Two", "rows": "0", "cols": "4"},
]
MAN = [
    {"file": "Sales.One.csv", "bytes": "3", "sha256": A},
    {"file": "Sales.Two.csv", "bytes": "4", "sha256": B},
]
OBJ = [
    {"Path": "Sales.One.csv", "Size": 3, "Hashes": {"sha256": A}},
    {"Path": "Sales.Two.csv", "Size": 4, "Hashes": {"sha256": B}},
]
V5 = [
    {"table": "Sales.One", "status": "OK", "mode": "FULL"},
    {"table": "Sales.Two", "status": "REFERENCE_ONLY_NOT_EXPORTED",
     "mode": "BASELINE_REFERENCE"},
]
NOW = datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc)


class SnapshotVerifierTests(unittest.TestCase):
    def test_baseline_all_exported_matches(self):
        x = evaluate(INV, MAN, OBJ)
        self.assertEqual(x["status"], "INTEGRITY_VERIFIED_ONLY")
        self.assertEqual(x["reference_only_count"], 0)
        self.assertEqual(x["issue_counts"], {})

    def test_v5_intentionally_excluded_reference(self):
        x = evaluate(INV, MAN[:1], OBJ[:1], V5)
        self.assertEqual(x["status"], "INTEGRITY_VERIFIED_ONLY")
        self.assertEqual(x["reference_only_count"], 1)
        self.assertEqual(x["manifest_count"], 1)
        self.assertEqual(x["issue_counts"], {})

    def test_v5_no_manifest_for_ok_table(self):
        x = evaluate(INV, [], [], V5)
        self.assertEqual(x["status"], "FAILED")
        self.assertEqual(x["issue_counts"]["missing_manifest"], 1)
        self.assertEqual(x["issue_counts"]["missing_drive"], 1)

    def test_reference_must_not_be_in_manifest(self):
        x = evaluate(INV, MAN, OBJ, V5)
        self.assertEqual(x["status"], "FAILED")
        self.assertEqual(x["issue_counts"]["unexpected_manifest"], 1)
        self.assertEqual(x["issue_counts"]["unexpected_drive"], 1)

    def test_hash_mismatch_fails_closed(self):
        bad = [dict(OBJ[0], Hashes={"sha256": B}), OBJ[1]]
        x = evaluate(INV, MAN, bad)
        self.assertEqual(x["issue_counts"]["sha256_mismatch"], 1)
        self.assertEqual(x["status"], "FAILED")

    def test_hash_missing_fails_closed(self):
        bad = [dict(OBJ[0], Hashes={}), OBJ[1]]
        x = evaluate(INV, MAN, bad)
        self.assertEqual(x["issue_counts"]["missing_provider_sha256"], 1)

    def test_missing_manifest_file_fails(self):
        x = evaluate(INV, MAN[:1], OBJ)
        self.assertEqual(x["issue_counts"]["missing_manifest"], 1)
        self.assertEqual(x["issue_counts"].get("unexpected_drive", 0), 0)  # extra entries filter
        self.assertEqual(x["status"], "FAILED")

    def test_wrong_size_fails(self):
        bad = [dict(OBJ[0], Size=9), OBJ[1]]
        x = evaluate(INV, MAN, bad)
        self.assertEqual(x["issue_counts"]["size_mismatch"], 1)

    def test_unknown_export_status_fails(self):
        bad = [V5[0], dict(V5[1], status="SKIPPED")]
        x = evaluate(INV, MAN[:1], OBJ[:1], bad)
        self.assertEqual(x["status"], "FAILED")
        self.assertEqual(x["issue_counts"]["unknown_export_status"], 1)

    def test_fresh_current_manifest_verified(self):
        x = evaluate(INV, MAN[:1], OBJ[:1], V5,
                     manifest_modified="2026-11-14T05:00:00Z",
                     max_age_hours=36, now=NOW)
        self.assertEqual(x["status"], "VERIFIED")
        self.assertTrue(x["freshness_policy_applied"])

    def test_stale_manifest_does_not_pass(self):
        x = evaluate(INV, MAN[:1], OBJ[:1], V5,
                     manifest_modified="2026-11-11T23:00:00Z",
                     max_age_hours=36, now=NOW)
        self.assertEqual(x["status"], "FAILED")
        self.assertEqual(x["issue_counts"]["stale_manifest_upload"], 1)

    def test_freshness_missing_timestamp_fails(self):
        x = evaluate(INV, MAN[:1], OBJ[:1], V5,
                     max_age_hours=36, now=NOW)
        self.assertEqual(x["issue_counts"]["manifest_modified_time_missing"], 1)
        self.assertEqual(x["status"], "FAILED")

    def test_duplicate_manifest_fails(self):
        x = evaluate(INV, MAN + [MAN[0]], OBJ)
        self.assertEqual(x["status"], "FAILED")
        self.assertEqual(x["issue_counts"]["manifest_duplicates"], 1)

    def test_duplicate_status_fails(self):
        x = evaluate(INV, MAN[:1], OBJ[:1], V5 + [V5[0]])
        self.assertEqual(x["status"], "FAILED")
        self.assertEqual(x["issue_counts"]["duplicate_export_status"], 1)

    def test_legacy_header_names_supported(self):
        legacy = [
            {"schema_name": "Sales", "table_name": "One"},
            {"schema_name": "Sales", "table_name": "Two"},
        ]
        x = evaluate(legacy, MAN, OBJ)
        self.assertEqual(x["status"], "INTEGRITY_VERIFIED_ONLY")


if __name__ == "__main__":
    unittest.main()
