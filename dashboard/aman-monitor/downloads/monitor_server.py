#!/usr/bin/env python3
"""Private access-monitor API, using only Python's standard library.

Run on a separate trusted management host behind an existing HTTPS reverse proxy.
This service does not install software, execute commands, open firewall ports,
collect operating-system logs, or access a personal ChatGPT account.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import datetime as dt
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import stat
import sys
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request


UTC = dt.timezone.utc
MAX_BODY_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 180 * 1024
MAX_EVENTS = 150
MAX_SOURCES = 25
MAX_BATCH_EVENTS = 100
RETENTION_DAYS = 7
REQUEST_TIMEOUT = 5
GEO_TIMEOUT = 5
GEO_MAX_BYTES = 64 * 1024
DEFAULT_ORIGIN = 'https://amer-ai-store.github.io'
EVENT_TYPES = frozenset(('login_success', 'login_failed', 'logout', 'http_request', 'process'))
SOURCE_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$')
TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9._~-]{32,512}$')
TIMESTAMP_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$')


class ServiceError(Exception):
    """An intentionally non-sensitive error safe to return to the caller."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def utc_now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def encode_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def decode_json(value: bytes) -> object:
    def reject_constant(_value: str) -> None:
        raise ValueError('Non-finite number')
    try:
        return json.loads(value.decode('utf-8', errors='strict'), object_pairs_hook=_unique_object, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError) as cause:
        raise ServiceError(400, 'Invalid JSON') from cause


def _valid_origin(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(value)
        return bool(
            parsed.scheme == 'https' and parsed.hostname and parsed.netloc
            and not parsed.path and not parsed.query and not parsed.fragment
            and not parsed.username and not parsed.password
            and parsed.port != 0 and '*' not in value
            and not any(char.isspace() or ord(char) < 33 for char in value)
        )
    except ValueError:
        return False


@dataclass(frozen=True)
class Config:
    read_digest: bytes
    collector_digest: bytes
    allowed_origin: str
    admin_digest: bytes | None = None

    @classmethod
    def from_env(cls, environ: dict | None = None) -> 'Config':
        env = os.environ if environ is None else environ
        read_token = env.get('AMAN_READ_TOKEN', '')
        collector_token = env.get('AMAN_COLLECTOR_TOKEN', '')
        if not isinstance(read_token, str) or not isinstance(collector_token, str):
            raise ValueError('Configure two distinct URL-safe tokens of at least 32 characters')
        if not TOKEN_PATTERN.fullmatch(read_token) or not TOKEN_PATTERN.fullmatch(collector_token):
            raise ValueError('Configure two distinct URL-safe tokens of at least 32 characters')
        if hmac.compare_digest(read_token, collector_token):
            raise ValueError('Read and collector tokens must be distinct')
        origin = env.get('AMAN_ALLOWED_ORIGIN', DEFAULT_ORIGIN)
        if not isinstance(origin, str) or not _valid_origin(origin):
            raise ValueError('AMAN_ALLOWED_ORIGIN must be one exact HTTPS origin without a path')
        admin_token = env.get('AMAN_ADMIN_TOKEN', '')
        if not isinstance(admin_token, str) or (admin_token and (not TOKEN_PATTERN.fullmatch(admin_token) or admin_token in (read_token, collector_token))):
            raise ValueError('Admin token must be valid and distinct from read/collector tokens')
        return cls(hashlib.sha256(read_token.encode('ascii')).digest(), hashlib.sha256(collector_token.encode('ascii')).digest(), origin, hashlib.sha256(admin_token.encode('ascii')).digest() if admin_token else None)

    def accepts(self, authorization: str | None, capability: str) -> bool:
        if not isinstance(authorization, str) or len(authorization) > 520:
            return False
        match = re.fullmatch(r'(?i:Bearer) ([A-Za-z0-9._~-]{32,512})', authorization)
        if not match:
            return False
        supplied = hashlib.sha256(match[1].encode('ascii')).digest()
        expected = {'read': self.read_digest, 'collector': self.collector_digest, 'admin': self.admin_digest}.get(capability)
        return expected is not None and hmac.compare_digest(supplied, expected)


def _text(value: object, label: str, maximum: int, optional: bool = False) -> str | None:
    if optional and (value is None or value == ''):
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ServiceError(400, f'Invalid {label}')
    if any(unicodedata.category(char) == 'Cc' for char in value):
        raise ServiceError(400, f'Invalid {label}')
    return value.strip()


def validate_payload(payload: object, now: dt.datetime | None = None) -> tuple[str, list[dict], int]:
    now = now or utc_now()
    if not isinstance(payload, dict) or set(payload) - {'source_id', 'events'}:
        raise ServiceError(400, 'Expected source_id and events only')
    source_id = payload.get('source_id')
    if not isinstance(source_id, str) or not SOURCE_PATTERN.fullmatch(source_id):
        raise ServiceError(400, 'Invalid source_id')
    items = payload.get('events')
    if not isinstance(items, list) or len(items) > MAX_BATCH_EVENTS:
        raise ServiceError(400, 'events must contain at most 100 records')
    normalized = []
    expired = 0
    cutoff = now - dt.timedelta(days=RETENTION_DAYS)
    allowed_fields = {'id', 'source_id', 'session_id', 'occurred_at', 'type', 'actor', 'ip', 'action', 'metadata'}
    for item in items:
        if not isinstance(item, dict) or set(item) - allowed_fields:
            raise ServiceError(400, 'Invalid event fields')
        if 'source_id' in item and item['source_id'] != source_id:
            raise ServiceError(400, 'Event source_id does not match batch')
        event_id = _text(item.get('id'), 'event id', 120)
        event_type = item.get('type')
        if not isinstance(event_type, str) or event_type not in EVENT_TYPES:
            raise ServiceError(400, 'Invalid event type')
        raw_time = item.get('occurred_at')
        if not isinstance(raw_time, str) or len(raw_time) > 40 or not TIMESTAMP_PATTERN.fullmatch(raw_time):
            raise ServiceError(400, 'occurred_at must be an ISO timestamp with a timezone')
        try:
            timestamp = dt.datetime.fromisoformat(raw_time.replace('Z', '+00:00')).astimezone(UTC)
        except (ValueError, OverflowError) as cause:
            raise ServiceError(400, 'Invalid event timestamp') from cause
        if timestamp > now + dt.timedelta(minutes=5):
            raise ServiceError(400, 'Event timestamp is in the future')
        address = item.get('ip')
        if address is not None and address != '':
            if not isinstance(address, str) or len(address) > 45 or '%' in address:
                raise ServiceError(400, 'Invalid IP address')
            try:
                address = str(ipaddress.ip_address(address))
            except ValueError as cause:
                raise ServiceError(400, 'Invalid IP address') from cause
        else:
            address = None
        metadata = item.get('metadata')
        if metadata is None:
            metadata = {}
        if not isinstance(metadata, dict) or set(metadata) - {'service', 'source_occurred_at', 'clock_offset_seconds', 'source_record_id', 'received_at'}:
            raise ServiceError(400, 'Invalid metadata')
        service = _text(metadata.get('service'), 'service', 40, optional=True)
        normalized_metadata = {'service': service} if service else {}
        if 'source_record_id' in metadata:
            normalized_metadata['source_record_id'] = _text(metadata['source_record_id'], 'source_record_id', 32)
        if 'source_occurred_at' in metadata:
            original = metadata['source_occurred_at']
            try:
                if not isinstance(original, str) or len(original) > 40 or not TIMESTAMP_PATTERN.fullmatch(original):
                    raise ValueError()
                normalized_metadata['source_occurred_at'] = iso(dt.datetime.fromisoformat(original.replace('Z', '+00:00')))
            except (ValueError, OverflowError) as cause:
                raise ServiceError(400, 'Invalid original timestamp') from cause
        if 'clock_offset_seconds' in metadata:
            offset = metadata['clock_offset_seconds']
            if isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset) or abs(offset) > 86400:
                raise ServiceError(400, 'Invalid clock correction')
            normalized_metadata['clock_offset_seconds'] = offset
        normalized_metadata['received_at'] = iso(now)
        event = {
            'id': event_id, 'source_id': source_id,
            'session_id': _text(item.get('session_id'), 'session_id', 160, optional=True),
            'occurred_at': iso(timestamp), 'type': event_type,
            'actor': _text(item.get('actor'), 'actor', 128, optional=True),
            'ip': address, 'action': _text(item.get('action'), 'action', 500, optional=True),
            'metadata': normalized_metadata,
        }
        if timestamp < cutoff:
            expired += 1
        else:
            normalized.append(event)
    return source_id, normalized, expired


def _private_database_file(path: Path) -> Path:
    """Require an existing private directory; reject symlink/hardlink databases."""
    path = Path(os.path.abspath(os.path.expanduser(str(path))))
    for component in (path.parent, *path.parent.parents):
        if component.is_symlink():
            raise ValueError('Database directories must not be symlinks')
    parent = path.parent.stat()
    if not stat.S_ISDIR(parent.st_mode):
        raise ValueError('Database parent must be an existing private directory')
    if os.name == 'posix' and (parent.st_uid != os.geteuid() or stat.S_IMODE(parent.st_mode) & 0o077):
        raise ValueError('Database parent must be owned by this service account with mode 0700')
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or path.is_symlink():
            raise ValueError('Database must be a regular file without links')
        if os.name == 'posix' and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077):
            raise ValueError('Database must be owned by this service account with mode 0600')
    finally:
        os.close(descriptor)
    return path


class Store:
    """One locally administered SQLite database, bounded after every transaction."""

    def __init__(self, path: Path):
        self.path = _private_database_file(path)
        self.lock = threading.RLock()
        with self._connect() as connection:
            version = connection.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1, 2):
                raise ValueError('Unsupported database schema version')
            if version == 0:
                connection.execute('BEGIN IMMEDIATE')
                existing = connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").fetchall()
                if existing:
                    raise ValueError('Refusing to modify an unrelated SQLite database')
                connection.execute('CREATE TABLE events (source_id TEXT NOT NULL, event_id TEXT NOT NULL, occurred_at TEXT NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY (source_id, event_id))')
                connection.execute('CREATE INDEX events_occurred_idx ON events (occurred_at DESC)')
                connection.execute('CREATE TABLE sources (source_id TEXT PRIMARY KEY NOT NULL, last_seen TEXT NOT NULL)')
                connection.execute('PRAGMA user_version = 1')
            connection.execute('SELECT source_id, event_id, occurred_at, event_json FROM events LIMIT 0')
            connection.execute('SELECT source_id, last_seen FROM sources LIMIT 0')
            if version < 2:
                connection.execute('CREATE TABLE IF NOT EXISTS collector_key (id INTEGER PRIMARY KEY CHECK(id = 1), digest TEXT, source_id TEXT, created_at TEXT)')
                connection.execute('PRAGMA user_version = 2')

    def collector_key(self, action: str = 'status', source_id: str | None = None) -> dict:
        with self.lock, self._connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            if action == 'rotate':
                if not isinstance(source_id, str) or not SOURCE_PATTERN.fullmatch(source_id):
                    raise ServiceError(400, 'Valid source_id required')
                token = 'aman_' + secrets.token_urlsafe(32)
                connection.execute('INSERT INTO collector_key(id,digest,source_id,created_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest, source_id=excluded.source_id, created_at=excluded.created_at', (hashlib.sha256(token.encode('ascii')).hexdigest(), source_id, iso(utc_now())))
                return {'active': True, 'token': token, 'source_id': source_id}
            if action == 'revoke':
                connection.execute('INSERT INTO collector_key(id) VALUES(1) ON CONFLICT(id) DO UPDATE SET digest=NULL')
            row = connection.execute('SELECT digest,source_id,created_at FROM collector_key WHERE id=1').fetchone()
            return {'active': bool(row and row['digest']), 'source_id': row['source_id'] if row else None, 'created_at': row['created_at'] if row else None, 'legacy_bootstrap': row is None}

    @staticmethod
    def _authorize_collector(connection, config: Config, authorization: str, source_id: str) -> None:
        row = connection.execute('SELECT digest,source_id FROM collector_key WHERE id=1').fetchone()
        if row is None:
            accepted = config.accepts(authorization, 'collector')
        else:
            match = re.fullmatch(r'(?i:Bearer) (aman_[A-Za-z0-9_-]{43})', authorization or '')
            accepted = bool(match and row['digest'] and row['source_id'] == source_id and hmac.compare_digest(hashlib.sha256(match[1].encode('ascii')).hexdigest(), row['digest']))
        if not accepted:
            raise ServiceError(401, 'Unauthorized')

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=REQUEST_TIMEOUT)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _snapshot(connection: sqlite3.Connection, now: dt.datetime, limit: int = MAX_EVENTS) -> dict:
        rows = connection.execute('SELECT event_json FROM events ORDER BY occurred_at DESC, source_id ASC, event_id ASC LIMIT ?', (limit,)).fetchall()
        sources = [dict(row) for row in connection.execute('SELECT source_id, last_seen FROM sources ORDER BY last_seen DESC, source_id ASC LIMIT ?', (MAX_SOURCES,))]
        return {
            'events': [json.loads(row['event_json']) for row in rows],
            'sources': sources, 'server_time': iso(now), 'retention_days': RETENTION_DAYS,
            'limit': MAX_EVENTS, 'truncated': len(rows) == MAX_EVENTS,
        }

    @classmethod
    def _prune(cls, connection: sqlite3.Connection, now: dt.datetime) -> None:
        cutoff = iso(now - dt.timedelta(days=RETENTION_DAYS))
        connection.execute('DELETE FROM events WHERE occurred_at < ?', (cutoff,))
        connection.execute('DELETE FROM sources WHERE last_seen < ?', (cutoff,))
        connection.execute('DELETE FROM events WHERE rowid NOT IN (SELECT rowid FROM events ORDER BY occurred_at DESC, source_id ASC, event_id ASC LIMIT ?)', (MAX_EVENTS,))
        connection.execute('DELETE FROM sources WHERE source_id NOT IN (SELECT source_id FROM sources ORDER BY last_seen DESC, source_id ASC LIMIT ?)', (MAX_SOURCES,))
        connection.execute('DELETE FROM events WHERE source_id NOT IN (SELECT source_id FROM sources)')
        snapshot = cls._snapshot(connection, now)
        while len(encode_json(snapshot)) > MAX_RESPONSE_BYTES and snapshot['events']:
            event = snapshot['events'].pop()
            connection.execute('DELETE FROM events WHERE source_id = ? AND event_id = ?', (event['source_id'], event['id']))
        if len(encode_json(snapshot)) > MAX_RESPONSE_BYTES:
            raise ServiceError(413, 'Stored dashboard state exceeds its byte limit')

    def ingest(self, source_id: str, events: list[dict], expired: int, now: dt.datetime | None = None, *, authorization: str | None = None, config: Config | None = None) -> dict:
        now = now or utc_now()
        with self.lock, self._connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            if config is not None:
                self._authorize_collector(connection, config, authorization, source_id)
            connection.execute('INSERT INTO sources (source_id, last_seen) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET last_seen = excluded.last_seen', (source_id, iso(now)))
            inserted = 0
            for event in events:
                cursor = connection.execute('INSERT INTO events (source_id, event_id, occurred_at, event_json) VALUES (?, ?, ?, ?) ON CONFLICT(source_id, event_id) DO NOTHING', (source_id, event['id'], event['occurred_at'], encode_json(event).decode('utf-8')))
                inserted += cursor.rowcount
            self._prune(connection, now)
            return {'ok': True, 'accepted': len(events), 'stored': inserted, 'expired': expired, 'server_time': iso(now)}

    def events(self, now: dt.datetime | None = None, limit: int = MAX_EVENTS) -> dict:
        now = now or utc_now()
        with self.lock, self._connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            self._prune(connection, now)
            return self._snapshot(connection, now, limit)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _fp, _code, _msg, _headers, _newurl):
        return None


def _public_ipv4(value: str) -> ipaddress.IPv4Address:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as cause:
        raise ServiceError(400, 'Approximate lookup supports public IPv4 addresses only') from cause
    if not isinstance(address, ipaddress.IPv4Address) or not address.is_global or address.is_multicast or address.is_reserved:
        raise ServiceError(400, 'Approximate lookup supports public IPv4 addresses only')
    for network in ('192.0.0.0/24', '192.88.99.0/24'):
        if address in ipaddress.ip_network(network):
            raise ServiceError(400, 'Approximate lookup supports public IPv4 addresses only')
    return address


def lookup_coarse_location(value: str, opener=None) -> dict:
    address = _public_ipv4(value)
    opener = opener or urllib.request.build_opener(NoRedirect())
    url = f'https://ipapi.co/{address}/json/'
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'AmanAccessMonitor/1'})
    try:
        with opener.open(request, timeout=GEO_TIMEOUT) as response:
            if response.status != 200:
                raise ServiceError(502, 'Approximate location service unavailable')
            declared = response.headers.get('Content-Length')
            if declared and (not declared.isdecimal() or int(declared) > GEO_MAX_BYTES):
                raise ServiceError(502, 'Location service response too large')
            raw = response.read(GEO_MAX_BYTES + 1)
        if len(raw) > GEO_MAX_BYTES:
            raise ServiceError(502, 'Location service response too large')
        result = decode_json(raw)
    except ServiceError as cause:
        if cause.status == 400:
            raise ServiceError(502, 'Location service returned invalid data') from cause
        raise
    except (OSError, urllib.error.URLError, ValueError) as cause:
        raise ServiceError(502, 'Approximate location service unavailable') from cause
    if not isinstance(result, dict) or result.get('error'):
        raise ServiceError(502, 'Approximate location unavailable')
    latitude, longitude = result.get('latitude'), result.get('longitude')
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (latitude, longitude)):
        raise ServiceError(502, 'Approximate location unavailable')
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ServiceError(502, 'Approximate location unavailable')
    def label(value):
        return value if isinstance(value, str) and len(value) <= 160 and not any(unicodedata.category(char) == 'Cc' for char in value) else None
    return {
        'ip': str(address), 'city': label(result.get('city')), 'region': label(result.get('region')),
        'country': label(result.get('country_name')), 'latitude': latitude, 'longitude': longitude,
        'approximate': True,
    }


class PrivateServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 16

    def __init__(self, address: tuple[str, int], config: Config, store: Store, geo_lookup=lookup_coarse_location):
        self.config = config
        self.store = store
        self.geo_lookup = geo_lookup
        self.slots = threading.BoundedSemaphore(16)
        if ':' in address[0]:
            self.address_family = socket.AF_INET6
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, _request, _client_address):
        # No tracebacks, request headers, raw records, or credentials in logs.
        pass


class Handler(BaseHTTPRequestHandler):
    server_version = 'AmanPrivateAPI'
    sys_version = ''
    protocol_version = 'HTTP/1.0'

    def setup(self):
        self.request.settimeout(REQUEST_TIMEOUT)
        super().setup()

    def log_message(self, _format, *_args):
        pass

    def log_error(self, _format, *_args):
        pass

    def send_error(self, code, message=None, explain=None):
        self._respond(code, {'error': 'Request rejected'})

    def parse_request(self):
        if not super().parse_request():
            return False
        if len(self.path) > 2048:
            self._respond(414, {'error': 'Request URL too long'})
            return False
        if len(self.headers.as_bytes()) > 16384:
            self._respond(431, {'error': 'Request headers too large'})
            return False
        return True

    def _respond(self, status_code: int, data: object = None, extra: dict | None = None):
        body = b'' if status_code == 204 else encode_json(data)
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Vary', 'Origin')
        self.send_header('Connection', 'close')
        if getattr(self, 'headers', None) and self.headers.get('Origin') == self.server.config.allowed_origin:
            self.send_header('Access-Control-Allow-Origin', self.server.config.allowed_origin)
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.close_connection = True
        if self.command != 'HEAD' and body:
            self.wfile.write(body)

    def _origin(self):
        origins = self.headers.get_all('Origin', [])
        if len(origins) > 1 or (origins and origins[0] != self.server.config.allowed_origin):
            raise ServiceError(403, 'Origin is not allowed')

    def _authenticate(self, capability: str):
        authorizations = self.headers.get_all('Authorization', [])
        if len(authorizations) != 1 or not self.server.config.accepts(authorizations[0], capability):
            raise ServiceError(401, 'Unauthorized')

    def _route(self) -> tuple[str, dict[str, list[str]]]:
        if not self.path.startswith('/') or self.path.startswith('//'):
            raise ServiceError(400, 'Invalid request target')
        parts = urllib.parse.urlsplit(self.path)
        if parts.path not in ('/api/events', '/api/ingest', '/api/geo', '/api/collector-key', '/api/collector-key/status', '/api/collector-key/revoke'):
            raise ServiceError(404, 'Not found')
        try:
            query = urllib.parse.parse_qs(parts.query, keep_blank_values=True, strict_parsing=True, max_num_fields=4)
        except ValueError as cause:
            raise ServiceError(400, 'Invalid query') from cause
        return parts.path, query

    def _json_body(self) -> object:
        if self.headers.get_all('Transfer-Encoding', []):
            raise ServiceError(400, 'Transfer-Encoding is not supported')
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,10}', lengths[0]):
            raise ServiceError(411, 'One valid Content-Length is required')
        length = int(lengths[0])
        if length > MAX_BODY_BYTES:
            raise ServiceError(413, 'Payload too large')
        if not re.fullmatch(r'application/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*', self.headers.get('Content-Type', ''), re.IGNORECASE):
            raise ServiceError(415, 'Use application/json with UTF-8')
        try:
            raw = self.rfile.read(length)
        except (TimeoutError, socket.timeout) as cause:
            raise ServiceError(408, 'Request body timed out') from cause
        if len(raw) != length:
            raise ServiceError(400, 'Incomplete request body')
        return decode_json(raw)

    def _dispatch(self):
        try:
            self._origin()
            path, query = self._route()
            expected = 'POST' if path in ('/api/ingest', '/api/collector-key', '/api/collector-key/revoke') else 'GET'
            if self.command == 'OPTIONS':
                if self.headers.get('Origin') != self.server.config.allowed_origin:
                    raise ServiceError(403, 'An allowed Origin is required')
                if self.headers.get('Access-Control-Request-Method') != expected:
                    raise ServiceError(403, 'Requested method is not allowed')
                requested = {value.strip().lower() for value in self.headers.get('Access-Control-Request-Headers', '').split(',') if value.strip()}
                if requested - {'authorization', 'content-type'}:
                    raise ServiceError(403, 'Requested headers are not allowed')
                self._respond(204, extra={'Access-Control-Allow-Methods': f'{expected}, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '300'})
                return
            if self.command != expected:
                self._respond(405, {'error': 'Method not allowed'}, {'Allow': f'{expected}, OPTIONS'})
                return
            if path.startswith('/api/collector-key'):
                self._authenticate('admin')
                if query:
                    raise ServiceError(400, 'Query parameters are not supported here')
                if path.endswith('/status'):
                    result = self.server.store.collector_key()
                else:
                    body = self._json_body()
                    if path.endswith('/revoke'):
                        if body != {}:
                            raise ServiceError(400, 'Empty object required')
                        result = self.server.store.collector_key('revoke')
                    else:
                        if not isinstance(body, dict) or set(body) != {'source_id'}:
                            raise ServiceError(400, 'source_id required')
                        result = self.server.store.collector_key('rotate', body['source_id'])
            elif path == '/api/ingest':
                authorizations = self.headers.get_all('Authorization', [])
                if len(authorizations) != 1:
                    raise ServiceError(401, 'Unauthorized')
                if query:
                    raise ServiceError(400, 'Query parameters are not supported here')
                source_id, events, expired = validate_payload(self._json_body())
                result = self.server.store.ingest(source_id, events, expired, authorization=authorizations[0], config=self.server.config)
            elif path == '/api/events':
                self._authenticate('read')
                if set(query) - {'limit'} or len(query.get('limit', ['150'])) != 1:
                    raise ServiceError(400, 'Invalid query')
                raw_limit = query.get('limit', ['150'])[0]
                if not raw_limit.isdecimal() or not 1 <= int(raw_limit) <= MAX_EVENTS:
                    raise ServiceError(400, 'limit must be between 1 and 150')
                result = self.server.store.events(limit=int(raw_limit))
            else:
                self._authenticate('read')
                if set(query) != {'ip'} or len(query['ip']) != 1:
                    raise ServiceError(400, 'One public IPv4 address is required')
                result = self.server.geo_lookup(query['ip'][0])
            self._respond(200, result)
        except ServiceError as cause:
            self._respond(cause.status, {'error': cause.message})
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            self.close_connection = True
        except Exception:
            self._respond(503, {'error': 'Private API unavailable; retry later'})

    do_GET = _dispatch
    do_POST = _dispatch
    do_OPTIONS = _dispatch
    do_HEAD = _dispatch
    do_PUT = _dispatch
    do_DELETE = _dispatch
    do_PATCH = _dispatch


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Private read/collector API for the Aman dashboard; standard library only')
    parser.add_argument('--db', required=True, type=Path, help='SQLite file inside an existing private directory (0700)')
    parser.add_argument('--host', default='127.0.0.1', choices=('127.0.0.1', '::1'), help='Loopback bind address; use an existing HTTPS reverse proxy')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    try:
        config = Config.from_env()
        store = Store(args.db)
        server = PrivateServer((args.host, args.port), config, store)
    except (ValueError, OSError, sqlite3.Error):
        print('Startup rejected: check private database permissions, distinct token configuration, allowed HTTPS origin, and loopback address.', file=sys.stderr)
        return 2
    print('Aman private API is listening on loopback. HTTPS reverse-proxy setup is external to this program.', flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
