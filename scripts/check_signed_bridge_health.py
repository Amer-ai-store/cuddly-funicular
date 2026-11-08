#!/usr/bin/env python3
"""Read-only live health and unsigned-request denial check.

A transient provider 503/timeout may be retried; a 401 denial is REQUIRED.
The script never uses credentials, touches accounting data, or treats 503 as 401.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

TRANSIENT = {429, 502, 503, 504}
EXPECTED_SERVICE = "aas-signed-local-worker-bridge"


class VerificationError(RuntimeError):
    pass


def _pause(attempt, sleep):
    sleep(min(attempt * 2, 4))


def _request_health(root, opener, sleep, attempts, timeout):
    failures = []
    for attempt in range(1, attempts + 1):
        try:
            with opener(root + "/health", timeout=timeout) as response:
                if response.status != 200:
                    raise VerificationError("GET /health did not return HTTP 200")
                payload = json.load(response)
            return payload, failures
        except urllib.error.HTTPError as exc:
            if exc.code not in TRANSIENT:
                raise VerificationError("GET /health returned HTTP " + str(exc.code)) from None
            failures.append("HTTP " + str(exc.code))
        except (urllib.error.URLError, TimeoutError, OSError):
            failures.append("network timeout/error")
        if attempt < attempts:
            _pause(attempt, sleep)
    raise VerificationError("GET /health unavailable after " + str(attempts) + " attempts: " + ", ".join(failures))


def _request_unsigned(root, opener, sleep, attempts, timeout):
    failures = []
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            root,
            data=b'{"action":"heartbeat"}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with opener(request, timeout=timeout) as response:
                raise VerificationError("SECURITY FAILURE: unsigned POST was accepted (HTTP " + str(response.status) + ")")
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                return failures
            if exc.code not in TRANSIENT:
                raise VerificationError("SECURITY FAILURE: unsigned POST returned HTTP " + str(exc.code)) from None
            failures.append("HTTP " + str(exc.code))
        except (urllib.error.URLError, TimeoutError, OSError):
            failures.append("network timeout/error")
        if attempt < attempts:
            _pause(attempt, sleep)
    raise VerificationError("Unsigned POST did not return required HTTP 401 after " + str(attempts) + " attempts: " + ", ".join(failures))


def probe(root, opener=None, sleep=None, attempts=3, timeout=12):
    opener = opener or urllib.request.urlopen
    sleep = sleep or time.sleep
    if not root.startswith("https://"):
        raise VerificationError("Bridge must use HTTPS")
    payload, health_transients = _request_health(root.rstrip("/"), opener, sleep, attempts, timeout)
    if not isinstance(payload, dict):
        raise VerificationError("Health payload is not an object")
    expected = {
        "service": EXPECTED_SERVICE,
        "railway_dependency": False,
        "accounting_db_access": False,
        "scope": "ISOLATED_SANDBOX",
    }
    for name, value in expected.items():
        if payload.get(name) != value or type(payload.get(name)) is not type(value):
            raise VerificationError("Unexpected health value for " + name)
    if type(payload.get("server_time_ms")) is not int:
        raise VerificationError("Health timestamp missing or invalid")
    post_transients = _request_unsigned(root.rstrip("/"), opener, sleep, attempts, timeout)
    return {"health": "HTTP 200", "unsigned_post": "HTTP 401", "transient_attempts": len(health_transients) + len(post_transients)}


def main():
    try:
        result = probe(os.environ["URL"])
    except (VerificationError, KeyError) as exc:
        print("::error title=Bridge check failed::" + str(exc))
        return 1
    print("PASS: live HTTP 200 /health, isolated sandbox, no accounting access, unsigned POST denied with HTTP 401")
    if result["transient_attempts"]:
        print("::warning title=Bridge transient errors::Provider returned " + str(result["transient_attempts"]) + " transient transport/HTTP responses before the required checks passed; monitor 503 rate.")
    print("NOTE: Does not prove production model execution, independent QA or GATE-15 acceptance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
