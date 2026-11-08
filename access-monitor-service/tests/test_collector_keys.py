"""Rotation/revocation capability tests using synthetic credentials only."""
import hashlib
import secrets
import sqlite3
import unittest
import test_monitor_server as fixture
from test_monitor_server import READ, WRITE, payload, event, service

ADMIN='test_admin_'+secrets.token_urlsafe(32)

class CollectorKeyTests(unittest.TestCase):
    request=fixture.HttpTests.request
    tearDown=fixture.HttpTests.tearDown
    def setUp(self):
        fixture.HttpTests.setUp(self)
        self.server.config=service.Config.from_env({'AMAN_READ_TOKEN':READ,'AMAN_COLLECTOR_TOKEN':WRITE,'AMAN_ADMIN_TOKEN':ADMIN})

    def rotate(self, source='test-server'):
        status, _, data=self.request('POST','/api/collector-key',token=ADMIN,body={'source_id':source})
        self.assertEqual(status,200)
        return data['token']

    def test_read_and_collector_cannot_manage_keys_or_admin_read_records(self):
        for token in (None,READ,WRITE):
            self.assertEqual(self.request('POST','/api/collector-key',token=token,body={'source_id':'test-server'})[0],401)
            self.assertEqual(self.request('POST','/api/collector-key/revoke',token=token,body={})[0],401)
            self.assertEqual(self.request('GET','/api/collector-key/status',token=token)[0],401)
        self.assertEqual(self.request('GET','/api/events',token=ADMIN)[0],401)

    def test_rotation_revokes_old_key_and_bootstrap_and_binds_source(self):
        first=self.rotate()
        self.assertEqual(self.request('POST','/api/ingest',token=first,body=payload())[0],200)
        second=self.rotate()
        for token in (first,WRITE):
            self.assertEqual(self.request('POST','/api/ingest',token=token,body=payload())[0],401)
        self.assertEqual(self.request('POST','/api/ingest',token=second,body=payload())[0],200)
        self.assertEqual(self.request('POST','/api/ingest',token=second,body=payload([event(source_id='other')],'other'))[0],401)
        self.assertEqual(self.request('GET','/api/events',token=second)[0],401)
        with sqlite3.connect(self.path if hasattr(self,'path') else self.store.path) as db:
            row=db.execute('select digest from collector_key').fetchone()
            self.assertEqual(row[0],hashlib.sha256(second.encode('ascii')).hexdigest())

    def test_revoke_survives_restart_without_resurrecting_bootstrap(self):
        token=self.rotate()
        self.assertEqual(self.request('POST','/api/collector-key/revoke',token=ADMIN,body={})[0],200)
        self.server.store=service.Store(self.store.path)
        for credential in (token,WRITE):
            self.assertEqual(self.request('POST','/api/ingest',token=credential,body=payload())[0],401)
        response=self.request('GET','/api/collector-key/status',token=ADMIN)[2]
        self.assertFalse(response['active'])
        self.assertNotIn('token',response)

    def test_invalid_rotation_preserves_active_key(self):
        token=self.rotate()
        for body in ({'source_id':'bad source'}, {'source_id':'test-server','token':'extra'}, []):
            self.assertEqual(self.request('POST','/api/collector-key',token=ADMIN,body=body)[0],400)
        self.assertEqual(self.request('POST','/api/ingest',token=token,body=payload())[0],200)
