"""Synthetic-only tests: temporary databases, localhost HTTP, fake geo provider."""

from __future__ import annotations

import contextlib
import datetime as dt
import http.client
import io
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import monitor_server as service


READ = 'test_read_' + secrets.token_urlsafe(32)
WRITE = 'test_collector_' + secrets.token_urlsafe(32)
NOW = dt.datetime(2026, 10, 29, 12, 0, tzinfo=dt.timezone.utc)


def config():
    return service.Config.from_env({'AMAN_READ_TOKEN': READ, 'AMAN_COLLECTOR_TOKEN': WRITE})


def event(event_id='event-1', source_id='test-server', when=None, **changes):
    result = {
        'id': event_id, 'source_id': source_id, 'session_id': 'synthetic-session',
        'occurred_at': service.iso(when or service.utc_now()), 'type': 'login_success',
        'actor': 'test-actor', 'ip': '203.0.113.10', 'action': 'SSH login accepted',
        'metadata': {'service': 'sshd'},
    }
    result.update(changes)
    return result


def payload(items=None, source_id='test-server'):
    return {'source_id': source_id, 'events': [event()] if items is None else items}


class ConfigAndSchemaTests(unittest.TestCase):
    def test_config_roles_are_distinct_and_only_digests_are_retained(self):
        current = config()
        self.assertTrue(current.accepts(f'Bearer {READ}', 'read'))
        self.assertTrue(current.accepts(f'Bearer {WRITE}', 'collector'))
        self.assertFalse(current.accepts(f'Bearer {READ}', 'collector'))
        self.assertFalse(current.accepts(f'Bearer {WRITE}', 'read'))
        self.assertNotIn(READ, repr(current))
        self.assertNotIn(WRITE, repr(current))
        for env in ({}, {'AMAN_READ_TOKEN': READ, 'AMAN_COLLECTOR_TOKEN': READ}, {'AMAN_READ_TOKEN': 'short', 'AMAN_COLLECTOR_TOKEN': WRITE}):
            with self.assertRaises(ValueError):
                service.Config.from_env(env)
        for origin in ('*', 'null', 'http://amer-ai-store.github.io', 'https://amer-ai-store.github.io/repository', 'https://amer-ai-store.github.io/', 'https://user:password@example.test'):
            with self.assertRaises(ValueError):
                service.Config.from_env({'AMAN_READ_TOKEN': READ, 'AMAN_COLLECTOR_TOKEN': WRITE, 'AMAN_ALLOWED_ORIGIN': origin})

    def test_strict_event_schema_accepts_ipv6_and_null_but_rejects_raw_secret_fields(self):
        valid = event(when=NOW, ip='2001:4860:0:0:0:0:0:8888')
        source, records, expired = service.validate_payload(payload([valid]), NOW)
        self.assertEqual(source, 'test-server')
        self.assertEqual(records[0]['ip'], '2001:4860::8888')
        self.assertEqual(expired, 0)
        self.assertIsNone(service.validate_payload(payload([event(when=NOW, ip=None)]), NOW)[1][0]['ip'])
        invalid = [
            event(when=NOW, password='must-never-be-stored'),
            event(when=NOW, source_id='other-server'),
            event(when=NOW, type='execute_command'),
            event(when=NOW, metadata=[]), event(when=NOW, metadata=False),
            event(when=NOW, metadata=0), event(when=NOW, metadata={'raw': 'forbidden'}),
            event(when=NOW, occurred_at='2026-02-30T12:00:00Z'),
            event(when=NOW, occurred_at='2026-10-29'),
            event(when=NOW, occurred_at=service.iso(NOW + dt.timedelta(minutes=6))),
            event(when=NOW, ip='127.000.000.001'), event(when=NOW, ip='8.8.8.8/anything'),
            event(when=NOW, ip='fe80::1%eth0'), event(when=NOW, actor='bad\nactor'),
        ]
        for invalid_event in invalid:
            with self.subTest(fields=list(invalid_event)):
                with self.assertRaises(service.ServiceError):
                    service.validate_payload(payload([invalid_event]), NOW)
        with self.assertRaises(service.ServiceError):
            service.validate_payload(payload([event(when=NOW)] * 101), NOW)
        with self.assertRaises(service.ServiceError):
            service.validate_payload({**payload([]), 'token': 'not-accepted'}, NOW)

    def test_json_rejects_duplicate_keys_non_finite_and_invalid_utf8(self):
        for raw in (b'{"events":[],"events":[]}', b'{"value":NaN}', b'{"value":Infinity}', b'\xff'):
            with self.assertRaises(service.ServiceError):
                service.decode_json(raw)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'private.sqlite3'
        self.store = service.Store(self.path)

    def tearDown(self):
        self.directory.cleanup()

    def ingest(self, items, source_id='test-server', now=NOW):
        normalized = service.validate_payload(payload(items, source_id), now)
        return self.store.ingest(*normalized, now=now)

    def test_idempotence_is_per_source_and_state_survives_restart(self):
        first = event(when=NOW)
        self.assertEqual(self.ingest([first])['stored'], 1)
        self.assertEqual(self.ingest([first])['stored'], 0)
        self.ingest([event(source_id='second-server', when=NOW)], 'second-server')
        restarted = service.Store(self.path)
        snapshot = restarted.events(now=NOW)
        self.assertEqual(len(snapshot['events']), 2)
        self.assertEqual(len(snapshot['sources']), 2)
        self.assertEqual(snapshot['limit'], 150)

    def test_retention_is_purged_on_read_and_expired_replays_are_acknowledged(self):
        self.ingest([event(when=NOW)])
        later = NOW + dt.timedelta(days=7, seconds=1)
        snapshot = self.store.events(now=later)
        self.assertEqual(snapshot['events'], [])
        self.assertEqual(snapshot['sources'], [])
        reply = self.ingest([event(when=NOW)], now=later)
        self.assertTrue(reply['ok'])
        self.assertEqual(reply['expired'], 1)
        self.assertEqual(reply['stored'], 0)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)

    def test_event_source_and_serialized_byte_bounds(self):
        for batch in range(3):
            items = [event(str(batch * 100 + index), when=NOW - dt.timedelta(milliseconds=index), actor='ح' * 128, action='ح' * 500, session_id='ح' * 160) for index in range(100)]
            self.ingest(items)
        snapshot = self.store.events(now=NOW)
        self.assertLessEqual(len(snapshot['events']), 150)
        self.assertLessEqual(len(service.encode_json(snapshot)), service.MAX_RESPONSE_BYTES)
        for index in range(30):
            source = f'synthetic-{index:02}'
            self.ingest([event(str(index), source_id=source, when=NOW)], source, now=NOW + dt.timedelta(seconds=index))
        snapshot = self.store.events(now=NOW + dt.timedelta(seconds=31))
        source_names = {item['source_id'] for item in snapshot['sources']}
        self.assertEqual(len(source_names), 25)
        self.assertTrue({item['source_id'] for item in snapshot['events']} <= source_names)

    def test_heartbeat_updates_health_without_fabricating_login(self):
        self.ingest([])
        self.ingest([], now=NOW + dt.timedelta(seconds=30))
        snapshot = self.store.events(now=NOW + dt.timedelta(seconds=30))
        self.assertEqual(snapshot['events'], [])
        self.assertEqual(snapshot['sources'][0]['last_seen'], service.iso(NOW + dt.timedelta(seconds=30)))

    @unittest.skipUnless(os.name == 'posix', 'POSIX ownership/mode checks')
    def test_private_file_permissions_links_and_unrelated_database_are_rejected(self):
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        link = Path(self.directory.name) / 'symlink.sqlite3'
        link.symlink_to(self.path)
        with self.assertRaises((ValueError, OSError)):
            service.Store(link)
        hardlink = Path(self.directory.name) / 'hardlink.sqlite3'
        os.link(self.path, hardlink)
        with self.assertRaises(ValueError):
            service.Store(hardlink)
        hardlink.unlink()
        os.chmod(self.path, 0o644)
        with self.assertRaises(ValueError):
            service.Store(self.path)
        os.chmod(self.path, 0o600)
        unrelated = Path(self.directory.name) / 'unrelated.sqlite3'
        with sqlite3.connect(unrelated) as connection:
            connection.execute('CREATE TABLE keep_this (id TEXT)')
        os.chmod(unrelated, 0o600)
        with self.assertRaises(ValueError):
            service.Store(unrelated)
        unsafe_dir = Path(self.directory.name) / 'public'
        unsafe_dir.mkdir(mode=0o755)
        os.chmod(unsafe_dir, 0o755)
        with self.assertRaises(ValueError):
            service.Store(unsafe_dir / 'private.sqlite3')


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = service.Store(Path(self.directory.name) / 'private.sqlite3')
        self.geo_calls = []
        def fake_geo(value):
            self.geo_calls.append(value)
            return {'ip': value, 'city': 'Synthetic city', 'region': 'Synthetic region', 'country': 'Synthetic country', 'latitude': 25.0, 'longitude': 45.0, 'approximate': True}
        self.server = service.PrivateServer(('127.0.0.1', 0), config(), self.store, fake_geo)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def request(self, method, path, *, token=None, origin=service.DEFAULT_ORIGIN, body=None, headers=None):
        current_headers = dict(headers or {})
        if token is not None:
            current_headers['Authorization'] = f'Bearer {token}'
        if origin is not None:
            current_headers['Origin'] = origin
        if body is not None and not isinstance(body, bytes):
            body = service.encode_json(body)
            current_headers.setdefault('Content-Type', 'application/json')
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=2)
        try:
            connection.request(method, path, body=body, headers=current_headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw) if raw else None
        finally:
            connection.close()

    def test_capabilities_keep_read_and_ingest_separate(self):
        for token in (None, WRITE):
            self.assertEqual(self.request('GET', '/api/events', token=token)[0], 401)
        self.assertEqual(self.request('POST', '/api/ingest', token=READ, body=payload())[0], 401)
        self.assertEqual(self.request('GET', f'/api/events?token={READ}')[0], 401)
        status, headers, data = self.request('POST', '/api/ingest', token=WRITE, origin=None, body=payload())
        self.assertEqual(status, 200)
        self.assertTrue(data['ok'])
        status, headers, data = self.request('GET', '/api/events', token=READ)
        self.assertEqual(status, 200)
        self.assertEqual(len(data['events']), 1)
        self.assertEqual(headers['Access-Control-Allow-Origin'], service.DEFAULT_ORIGIN)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Credentials', headers)
        self.assertEqual(self.request('POST', '/api/ingest', token=WRITE, body=payload(data['events']))[2]['stored'], 0)

    def test_exact_cors_and_anonymous_preflight_without_data(self):
        for origin in ('null', 'https://hostile.example', f'{service.DEFAULT_ORIGIN}/repository', f'{service.DEFAULT_ORIGIN}/'):
            status, headers, _ = self.request('GET', '/api/events', token=READ, origin=origin)
            self.assertEqual(status, 403)
            self.assertNotIn('Access-Control-Allow-Origin', headers)
        status, headers, body = self.request('OPTIONS', '/api/events', headers={'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'})
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertEqual(headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type')
        self.assertEqual(headers['Content-Length'], '0')
        for extra in ({'Access-Control-Request-Method': 'DELETE'}, {'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Cookie'}):
            self.assertEqual(self.request('OPTIONS', '/api/events', headers=extra)[0], 403)
        self.assertEqual(self.request('OPTIONS', '/api/events', origin=None, headers={'Access-Control-Request-Method': 'GET'})[0], 403)

    def test_schema_payload_and_route_limits_leave_database_unchanged(self):
        status, _, _ = self.request('POST', '/api/ingest', token=WRITE, body=payload([event(password='forbidden')]))
        self.assertEqual(status, 400)
        self.assertEqual(self.request('POST', '/api/ingest', token=WRITE, body=b'x' * (service.MAX_BODY_BYTES + 1), headers={'Content-Type': 'application/json'})[0], 413)
        self.assertEqual(self.request('POST', '/api/ingest', token=WRITE, body=b'{"events":NaN}', headers={'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.request('POST', '/api/ingest', token=WRITE, body=b'{}', headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('GET', '/api/events?limit=151', token=READ)[0], 400)
        self.assertEqual(self.request('GET', '/api/events', token=READ)[2]['events'], [])
        self.assertEqual(self.request('GET', '/api/ingest', token=WRITE)[0], 405)
        self.assertEqual(self.request('GET', '/no-such-route', token=READ)[0], 404)

    def test_missing_or_duplicate_content_length_and_transfer_encoding_are_rejected(self):
        for extra, expected in (([], 411), (['Content-Length: 2', 'Content-Length: 2'], 411), (['Content-Length: 2', 'Transfer-Encoding: chunked'], 400)):
            lines = ['POST /api/ingest HTTP/1.1', 'Host: localhost', f'Authorization: Bearer {WRITE}', 'Content-Type: application/json', *extra, '', '{}']
            with socket.create_connection(self.server.server_address, timeout=2) as connection:
                connection.sendall('\r\n'.join(lines).encode())
                response = connection.recv(4096)
            self.assertTrue(response.startswith(f'HTTP/1.0 {expected} '.encode()))

    def test_body_read_timeout_is_bounded(self):
        with mock.patch.object(service, 'REQUEST_TIMEOUT', 0.1):
            with socket.create_connection(self.server.server_address, timeout=2) as connection:
                request = f'POST /api/ingest HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {WRITE}\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n'
                connection.sendall(request.encode())
                response = connection.recv(4096)
                self.assertTrue(response.startswith(b'HTTP/1.0 408 '))

    def test_geo_is_explicit_and_requires_read_capability(self):
        self.request('GET', '/api/events', token=READ)
        self.request('POST', '/api/ingest', token=WRITE, body=payload())
        self.assertEqual(self.geo_calls, [])
        self.assertEqual(self.request('GET', '/api/geo?ip=8.8.8.8', token=WRITE)[0], 401)
        status, _, data = self.request('GET', '/api/geo?ip=8.8.8.8', token=READ)
        self.assertEqual(status, 200)
        self.assertTrue(data['approximate'])
        self.assertEqual(self.geo_calls, ['8.8.8.8'])

    def test_requests_do_not_log_tokens_headers_or_records(self):
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured), contextlib.redirect_stdout(captured):
            self.request('GET', '/api/events', token=READ)
            self.request('POST', '/api/ingest', token=WRITE, body=payload([event(actor='SYNTHETIC_PRIVATE_ACTOR')]))
            self.request('GET', '/missing', token=READ)
        self.assertEqual(captured.getvalue(), '')


class FakeResponse:
    def __init__(self, body, status=200, headers=None):
        self.body = body
        self.status = status
        self.headers = headers or {}
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return None
    def read(self, maximum):
        return self.body[:maximum]


class FakeOpener:
    def __init__(self, response=None, failure=None):
        self.response = response
        self.failure = failure
        self.calls = []
    def open(self, request, *, timeout):
        self.calls.append((request, timeout))
        if self.failure:
            raise self.failure
        return self.response


class GeoTests(unittest.TestCase):
    def test_fixed_https_provider_receives_no_api_credentials_and_returns_only_coarse_fields(self):
        opener = FakeOpener(FakeResponse(service.encode_json({'latitude': 25.0, 'longitude': 45.0, 'city': 'Synthetic city', 'region': 'Synthetic region', 'country_name': 'Synthetic country', 'postal': 'not-returned', 'street': 'not-returned'})))
        result = service.lookup_coarse_location('8.8.8.8', opener=opener)
        request, timeout = opener.calls[0]
        self.assertEqual(request.full_url, 'https://ipapi.co/8.8.8.8/json/')
        self.assertEqual(timeout, 5)
        self.assertNotIn('Authorization', dict(request.header_items()))
        self.assertNotIn('OAI-Sites-Authorization', dict(request.header_items()))
        self.assertEqual(set(result), {'ip', 'city', 'region', 'country', 'latitude', 'longitude', 'approximate'})
        self.assertTrue(result['approximate'])

    def test_private_reserved_malformed_and_ipv6_addresses_never_trigger_network(self):
        addresses = ('0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.0.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '2001:4860::1', '8.8.8.8@hostile.example', 'https://hostile.example')
        opener = FakeOpener()
        for address in addresses:
            with self.assertRaises(service.ServiceError):
                service.lookup_coarse_location(address, opener=opener)
        self.assertEqual(opener.calls, [])

    def test_provider_errors_byte_limits_coordinates_and_redirects_are_rejected(self):
        cases = (
            FakeResponse(b'{}', status=302),
            FakeResponse(b'x' * (service.GEO_MAX_BYTES + 1)),
            FakeResponse(b'{}', headers={'Content-Length': str(service.GEO_MAX_BYTES + 1)}),
            FakeResponse(b'{"latitude":NaN,"longitude":0}'),
            FakeResponse(b'{"latitude":91,"longitude":0}'),
            FakeResponse(b'{"latitude":true,"longitude":0}'),
            FakeResponse(b'{"latitude":"25","longitude":45}'),
            FakeResponse(b'{"error":true}'),
        )
        for response in cases:
            with self.assertRaises(service.ServiceError) as raised:
                service.lookup_coarse_location('8.8.8.8', opener=FakeOpener(response))
            self.assertEqual(raised.exception.status, 502)
        with self.assertRaises(service.ServiceError):
            service.lookup_coarse_location('8.8.8.8', opener=FakeOpener(failure=TimeoutError()))
        self.assertIsNone(service.NoRedirect().redirect_request(None, None, 302, None, None, 'https://hostile.example'))


if __name__ == '__main__':
    unittest.main()
