"""Synthetic, secret-free regression for bridge availability and authentication semantics."""
import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_signed_bridge_health import probe, VerificationError

ROOT = "https://unit-test.invalid/functions/v1/aas-signed-local-worker-bridge"
HEALTH = {
    "service": "aas-signed-local-worker-bridge",
    "railway_dependency": False,
    "accounting_db_access": False,
    "scope": "ISOLATED_SANDBOX",
    "server_time_ms": 1,
}


class FakeResponse(io.BytesIO):
    def __init__(self, payload=None, status=200):
        super().__init__(json.dumps(payload if payload is not None else HEALTH).encode())
        self.status = status


def http_error(status):
    return urllib.error.HTTPError(ROOT, status, "synthetic", None, None)


def sequence(*responses):
    items = list(responses)

    def open_fake(request, timeout=12):
        if not items:
            raise AssertionError("unexpected additional network call")
        response = items.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    return open_fake


class SignedBridgeProbeTests(unittest.TestCase):
    def run_probe(self, *responses):
        return probe(ROOT, opener=sequence(*responses), sleep=lambda _: None, attempts=3, timeout=1)

    def test_live_positive_and_denied_negative(self):
        r = self.run_probe(FakeResponse(), http_error(401))
        self.assertEqual(r["unsigned_post"], "HTTP 401")
        self.assertEqual(r["transient_attempts"], 0)

    def test_transient_503_requires_eventual_401(self):
        r = self.run_probe(FakeResponse(), http_error(503), http_error(401))
        self.assertEqual(r["transient_attempts"], 1)

    def test_read_timeout_retry_then_success(self):
        r = self.run_probe(TimeoutError(), FakeResponse(), http_error(401))
        self.assertEqual(r["transient_attempts"], 1)

    def test_multiple_provider_503_fail_closed(self):
        with self.assertRaisesRegex(VerificationError, "required HTTP 401"):
            self.run_probe(FakeResponse(), http_error(503), http_error(503), http_error(503))

    def test_unsigned_post_acceptance_is_failure(self):
        with self.assertRaisesRegex(VerificationError, "SECURITY FAILURE"):
            self.run_probe(FakeResponse(), FakeResponse({"accepted": True}, status=200))

    def test_unexpected_403_is_not_a_valid_denial(self):
        with self.assertRaisesRegex(VerificationError, "HTTP 403"):
            self.run_probe(FakeResponse(), http_error(403))

    def test_wrong_health_or_accounting_access_is_failure(self):
        wrong = dict(HEALTH, accounting_db_access=True)
        with self.assertRaisesRegex(VerificationError, "accounting_db_access"):
            self.run_probe(FakeResponse(wrong))

    def test_non_https_is_rejected(self):
        with self.assertRaisesRegex(VerificationError, "HTTPS"):
            probe("http://example.invalid", opener=sequence(), sleep=lambda _: None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
