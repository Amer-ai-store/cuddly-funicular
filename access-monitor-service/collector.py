#!/usr/bin/env python3
"""Read SSH authentication records and send them to an authenticated dashboard.

Standard library only. Never executes a command from a log entry, sends raw log
lines, follows HTTP redirects, or logs the service credential.
"""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import selectors
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

UTC = dt.timezone.utc
LOG = logging.getLogger("aman-collector")
MAX_LINE = 65536
SOURCE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$")
PID_RE = re.compile(r"sshd(?:-session)?\[(\d+)\]:\s*(.*)")
ACCEPTED_RE = re.compile(r"^Accepted (?:password|publickey|keyboard-interactive(?:/pam)?|hostbased|gssapi-with-mic|none) for (\S+) from (\S+) port \d+(?:\s|$)")
FAILED_RE = re.compile(r"^Failed (?:password|publickey|keyboard-interactive(?:/pam)?|hostbased|gssapi-with-mic|none) for (?:invalid user )?(\S+) from (\S+) port \d+(?:\s|$)")
CLOSED_RE = re.compile(r"pam_unix\(sshd:session\): session closed for user (\S+)")
ISO_RE = re.compile(r"^(\d{4}-\d\d-\d\d[T ][0-9:.]+(?:Z|[+-]\d\d:\d\d))\s")
SYSLOG_RE = re.compile(r"^([A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d)\s")


def utc_now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def valid_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def line_time(line: str, now: dt.datetime) -> dt.datetime | None:
    """Read ISO time or traditional local syslog time, accounting for New Year."""
    match = ISO_RE.match(line)
    if match:
        try:
            return dt.datetime.fromisoformat(match[1].replace("Z", "+00:00")).astimezone(UTC)
        except ValueError:
            return None
    match = SYSLOG_RE.match(line)
    if match:
        try:
            # A syslog line without year/timezone uses the collector host's local
            # timezone. Pick the closest year; do not turn Dec 31 into the future.
            local_now = now.astimezone()
            base = dt.datetime.strptime(f"{local_now.year} {match[1]}", "%Y %b %d %H:%M:%S")
            candidates = [base.replace(year=base.year + delta).astimezone(UTC) for delta in (-1, 0, 1)]
            return min(candidates, key=lambda item: abs((item - now).total_seconds()))
        except ValueError:
            return None
    return None


def parse_record(raw: str, source_id: str, now: dt.datetime | None = None) -> dict | None:
    """Normalize accepted/failed/closed sshd lines; omit raw and secret fields."""
    now = now or utc_now()
    if len(raw) > MAX_LINE:
        return None
    timestamp = None
    pid = None
    cursor = None
    if raw.lstrip().startswith("{"):
        try:
            journal = json.loads(raw)
            if not isinstance(journal, dict):
                return None
            message = journal.get("MESSAGE", "")
            if not isinstance(message, str):
                return None
            identifier = journal.get("SYSLOG_IDENTIFIER") or journal.get("_COMM", "")
            if identifier not in ("sshd", "sshd-session"):
                return None
            pid = str(journal.get("SYSLOG_PID") or journal.get("_PID", ""))
            cursor = journal.get("__CURSOR")
            micros = journal.get("__REALTIME_TIMESTAMP")
            timestamp = dt.datetime.fromtimestamp(int(micros) / 1_000_000, UTC) if micros is not None else None
        except (ValueError, TypeError, OverflowError, OSError):
            return None
    else:
        match = PID_RE.search(raw)
        if not match:
            return None
        pid, message = match.groups()
        timestamp = line_time(raw, now)
    if not pid or not pid.isdecimal() or len(pid) > 10 or int(pid) == 0 or timestamp is None:
        return None
    match = ACCEPTED_RE.match(message)
    event_type, action = "login_success", "SSH login accepted"
    if not match:
        match = FAILED_RE.match(message)
        event_type, action = "login_failed", "SSH login failed"
    if match:
        actor, address = match.groups()
        address = valid_ip(address)
        if address is None:
            return None
    else:
        match = CLOSED_RE.search(message)
        if not match:
            return None
        actor, address = match[1], None
        event_type, action = "logout", "SSH session closed"
    if len(actor) > 128 or any(ord(char) < 32 for char in actor):
        return None
    # Deterministic UUID makes rereads of journald records idempotent. A spool
    # preserves the same ID for every retry of file records as well.
    identity = str(cursor) if cursor else f"{iso(timestamp)}|{pid}|{message}"
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"aman:{source_id}:{identity}")),
        "source_id": source_id,
        "session_id": f"{source_id}:sshd:{pid}",
        "occurred_at": iso(timestamp),
        "type": event_type,
        "actor": actor,
        "ip": address,
        "action": action,
        "metadata": {"service": "sshd"},
    }


class Spool:
    """Durable FIFO. Capacity includes pending events and file is permission 0600."""

    def __init__(self, path: Path, max_events: int = 20000):
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        old_umask = os.umask(0o077)
        try:
            self.db = sqlite3.connect(path, timeout=5, check_same_thread=False)
        finally:
            os.umask(old_umask)
        os.chmod(path, 0o600)
        self.lock = threading.Lock()
        self.max_events = max_events
        with self.db:
            self.db.execute("PRAGMA journal_mode=DELETE")
            self.db.execute("CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
            self.db.execute("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

    def append(self, event: dict) -> bool:
        with self.lock, self.db:
            existing = self.db.execute("SELECT 1 FROM pending WHERE id=?", (event["id"],)).fetchone()
            if existing:
                return True
            count = self.db.execute("SELECT COUNT(*) FROM pending").fetchone()[0]
            if count >= self.max_events:
                return False
            self.db.execute("INSERT INTO pending VALUES (?, ?)", (event["id"], json.dumps(event, ensure_ascii=False)))
        return True

    def batch(self, size: int = 100) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT body FROM pending ORDER BY rowid LIMIT ?", (min(size, 100),)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def acknowledge(self, events: list[dict]) -> None:
        with self.lock, self.db:
            self.db.executemany("DELETE FROM pending WHERE id=?", [(item["id"],) for item in events])

    def get_state(self, key: str) -> str | None:
        with self.lock:
            row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set_state(self, key: str, value: str) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def close(self) -> None:
        self.db.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A credential must never be forwarded to a redirect destination.
        return None


def endpoint_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    local = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("endpoint requires HTTPS (HTTP only for localhost development)")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("endpoint must be a plain API URL with no credentials/query/fragment")
    path = parsed.path.rstrip("/")
    if path not in ("", "/api/ingest"):
        raise ValueError("endpoint must be the backend origin or its /api/ingest URL")
    try:
        parsed.port
    except ValueError as error:
        raise ValueError("invalid endpoint port") from error
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/api/ingest", "", ""))


def send_batch(endpoint: str, token: str, source_id: str, events: list[dict], opener=None) -> bool:
    """True only after a successful status; bounded replies and no secret output."""
    payload = json.dumps({"source_id": source_id, "events": events}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "Aman-SSH-Collector/1.0",
    }, method="POST")
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            body = response.read(8193)
            # A login page can return HTTP 200; only a JSON acknowledgement counts.
            if status < 200 or status >= 300 or "application/json" not in content_type or len(body) > 8192:
                LOG.warning("Ingest response was not a JSON acknowledgement; events remain queued")
                return False
            result = json.loads(body)
            if not isinstance(result, dict) or result.get("ok") is not True:
                LOG.warning("Ingest did not acknowledge the batch; events remain queued")
                return False
            return True
    except urllib.error.HTTPError as error:
        LOG.warning("Ingest returned HTTP %s; events remain queued", error.code)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        # Do not log the exception body or URL; responses can echo credentials.
        LOG.warning("Ingest connection/response error; events remain queued")
    return False


def read_auth_file(path: Path, stop: threading.Event, spool: Spool, enqueue, poll: float = 0.5) -> None:
    """Follow new lines, restore offsets, and reopen files on rotation/truncation.

    Fresh installations start at EOF to avoid silently importing old activity.
    Persist checkpoints only after durable event enqueue. On spool-full failure,
    the current record is retried without advancing the durable checkpoint.
    """
    handle = None
    identity = None
    key = f"file:{path.resolve()}"
    try:
        while not stop.is_set():
            try:
                stat = path.stat()
                current_id = f"{stat.st_dev}:{stat.st_ino}"
                if handle is None:
                    handle = path.open("rb")
                    identity = current_id
                    saved = spool.get_state(key)
                    if saved:
                        previous = json.loads(saved)
                        offset = int(previous.get("offset", 0)) if previous.get("identity") == current_id else 0
                        handle.seek(offset if offset <= stat.st_size else 0)
                    else:
                        handle.seek(0, os.SEEK_END)
                        spool.set_state(key, json.dumps({"identity": identity, "offset": handle.tell()}))
                if current_id == identity and stat.st_size < handle.tell():
                    handle.seek(0)
                offset = handle.tell()
                raw = handle.readline(MAX_LINE + 1)
                if raw:
                    if len(raw) > MAX_LINE:
                        # Drain an oversized record without parsing its fragments.
                        while raw and not raw.endswith(b"\n"):
                            raw = handle.readline(MAX_LINE + 1)
                        spool.set_state(key, json.dumps({"identity": identity, "offset": handle.tell()}))
                        continue
                    if not raw.endswith(b"\n"):
                        handle.seek(offset)
                        stop.wait(poll)
                        continue
                    if enqueue(raw.decode("utf-8", errors="replace")):
                        spool.set_state(key, json.dumps({"identity": identity, "offset": handle.tell()}))
                    else:
                        handle.seek(offset)
                        stop.wait(poll)
                elif current_id != identity:
                    # Drain the old file before switching to the replacement.
                    handle.close()
                    handle = None
                else:
                    stop.wait(poll)
            except FileNotFoundError:
                stop.wait(poll)
    finally:
        if handle:
            handle.close()


def read_journal(stop: threading.Event, spool: Spool, enqueue) -> None:
    """Use journald cursor for reconnect/restart; static argv, no shell."""
    while not stop.is_set():
        argv = ["journalctl", "--follow", "--output=json", "--no-pager", "--lines=0"]
        cursor = spool.get_state("journal_cursor")
        if cursor:
            argv += [f"--after-cursor={cursor}"]
            # --lines=0 means tail only and would skip queued historical records.
            argv.remove("--lines=0")
        argv += ["_COMM=sshd", "+", "_COMM=sshd-session"]
        child_env = {key: value for key, value in os.environ.items() if key != "AMAN_COLLECTOR_TOKEN"}
        process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=child_env)
        try:
            assert process.stdout is not None
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                buffer = b""
                dropping = False
                while not stop.is_set():
                    ready = selector.select(timeout=0.5)
                    if not ready:
                        continue
                    chunk = os.read(process.stdout.fileno(), MAX_LINE)
                    if not chunk:
                        break
                    buffer += chunk
                    while b"\n" in buffer:
                        raw_bytes, buffer = buffer.split(b"\n", 1)
                        if dropping or len(raw_bytes) > MAX_LINE:
                            dropping = False
                            continue
                        raw = raw_bytes.decode("utf-8", errors="replace")
                        accepted = False
                        while not stop.is_set():
                            if enqueue(raw):
                                accepted = True
                                break
                            stop.wait(1)
                        if not accepted:
                            break
                        try:
                            record = json.loads(raw)
                            cursor = record.get("__CURSOR")
                            if isinstance(cursor, str):
                                spool.set_state("journal_cursor", cursor)
                        except (ValueError, AttributeError):
                            pass
                    if len(buffer) > MAX_LINE:
                        buffer = b""
                        dropping = True
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            if process.stdout:
                process.stdout.close()
        if not stop.is_set():
            LOG.warning("journalctl stopped; retrying in 5 seconds (check log read permission)")
            stop.wait(5)


def run(args) -> int:
    token = os.environ.get("AMAN_COLLECTOR_TOKEN", "")
    if not token or "\n" in token or "\r" in token:
        LOG.error("Set AMAN_COLLECTOR_TOKEN through a secure environment configuration")
        return 2
    stop = threading.Event()
    reader_failed = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())
    spool = Spool(Path(args.spool), args.max_events)

    def enqueue(raw: str) -> bool:
        event = parse_record(raw, args.source_id)
        if event is None:
            return True
        if not spool.append(event):
            LOG.error("Local queue is full; log reading is paused until delivery resumes")
            return False
        return True

    def reader() -> None:
        try:
            if args.auth_log:
                read_auth_file(Path(args.auth_log), stop, spool, enqueue)
            else:
                read_journal(stop, spool, enqueue)
        except (OSError, ValueError, sqlite3.Error):
            LOG.error("Cannot read authentication source; check path and permissions")
            reader_failed.set()
            stop.set()

    worker = threading.Thread(target=reader, name="ssh-reader", daemon=True)
    worker.start()
    LOG.info("Collector started for source %s; no raw log lines are transmitted", args.source_id)
    failures = 0
    last_send = 0.0
    try:
        while not stop.is_set():
            events = spool.batch()
            elapsed = time.monotonic() - last_send
            if events or elapsed >= args.heartbeat:
                if send_batch(args.endpoint, token, args.source_id, events):
                    spool.acknowledge(events)
                    failures = 0
                    last_send = time.monotonic()
                    if events:
                        LOG.info("Delivered %s authentication events", len(events))
                else:
                    failures += 1
                    stop.wait(min(60, 2 ** min(failures, 6)))
            stop.wait(args.interval)
    finally:
        stop.set()
        worker.join(timeout=7)
        if not worker.is_alive():
            spool.close()
    return 1 if reader_failed.is_set() else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only SSH access collector for an authenticated Aman dashboard")
    parser.add_argument("--endpoint", required=True, help="HTTPS backend ingest URL shown in dashboard setup (no token in URL)")
    parser.add_argument("--source-id", required=True, help="Server identifier, letters/numbers/_.- up to 80 chars")
    parser.add_argument("--auth-log", help="Follow a readable auth.log/secure file instead of journald")
    parser.add_argument("--spool", default="./aman-spool.sqlite3", help="Durable local queue path; protect its containing directory")
    parser.add_argument("--max-events", type=int, default=20000, help="Maximum queued events; pause reads when full")
    parser.add_argument("--interval", type=float, default=3, help="Delivery polling interval seconds (minimum 1)")
    parser.add_argument("--heartbeat", type=float, default=30, help="Heartbeat seconds (minimum 10)")
    args = parser.parse_args(argv)
    try:
        args.endpoint = endpoint_url(args.endpoint)
    except ValueError as error:
        parser.error(str(error))
    if not SOURCE_RE.fullmatch(args.source_id):
        parser.error("invalid source-id; use letters/numbers/_.- up to 80 characters")
    if not 100 <= args.max_events <= 100000:
        parser.error("max-events must be between 100 and 100000")
    if not 1 <= args.interval <= 300 or not 10 <= args.heartbeat <= 3600:
        parser.error("interval must be 1–300 seconds; heartbeat must be 10–3600 seconds")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
