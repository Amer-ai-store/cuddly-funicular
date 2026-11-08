import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBaseUrl, endpointUrl, validateReadToken, normalizeSnapshot, sessionEvents, readLimitedJson, MAX_JSON_BYTES} from '../core.mjs';

const now = Date.parse('2026-10-29T13:00:00Z');
const makeEvent = (overrides = {}) => ({id: 'one', source_id: 'owned-server', session_id: 'ssh-12', occurred_at: '2026-10-29T12:00:00Z', type: 'login_success', actor: 'deploy', ip: '192.0.2.14', action: 'Recorded SSH login', metadata: {service: 'sshd'}, ...overrides});

test('API routes preserve a user-entered prefix and never carry the read token', () => {
  const {base} = validateBaseUrl('https://monitor.example.org/security/v1/');
  assert.equal(base, 'https://monitor.example.org/security/v1');
  assert.equal(endpointUrl(base, 'events'), 'https://monitor.example.org/security/v1/api/events');
  assert.equal(endpointUrl(base, 'geo', '2001:db8::1'), 'https://monitor.example.org/security/v1/api/geo?ip=2001%3Adb8%3A%3A1');
  assert.throws(() => endpointUrl(base, '//elsewhere.example/'));
});

test('only HTTPS or loopback development HTTP is accepted and URL credentials are rejected', () => {
  for (const value of ['http://monitor.example.org', 'http://[::1]:8147', 'ftp://example.org', 'javascript:alert(1)', 'https://user:secret@example.org', 'https://example.org?token=secret', 'https://example.org#secret', 'https://example.org?', 'https://example.org/#', 'https://example.org\\@evil.example', 'https://example.org/a b', '/relative/api']) assert.throws(() => validateBaseUrl(value), value);
  for (const value of ['http://127.0.0.1:8147/prefix', 'http://localhost:8147']) assert.equal(validateBaseUrl(value).loopback, true);
  assert.equal(validateBaseUrl('https://example.org/private').loopback, false);
});

test('a read token cannot inject whitespace or request headers', () => {
  assert.equal(validateReadToken('test-token-long-enough'), 'test-token-long-enough');
  for (const token of ['', 'short', 'token with spaces', 'abcdefgh\r\nOther: value', 'رمز-غير-ASCII']) assert.throws(() => validateReadToken(token));
});

test('import is normalized, deduplicated within each source, bounded to150 and7days', () => {
  const events = Array.from({length: 160}, (_, i) => makeEvent({id: 'id-' + i, occurred_at: new Date(now - (i + 1) * 1000).toISOString()}));
  events.push({...events[0]}, makeEvent({id: 'expired', occurred_at: '2026-10-01T00:00:00Z'}));
  const result = normalizeSnapshot({events}, {imported: true, now});
  assert.equal(result.events.length, 150);
  assert.equal(result.truncated, true);
  assert.equal(result.expired, 1);
  assert.deepEqual(result.sources, [{source_id: 'owned-server', last_seen: new Date(now - 1000).toISOString()}]);
  assert.equal(result.events[0].id, 'id-0');
  const scoped = normalizeSnapshot({events: [makeEvent(), makeEvent({source_id: 'other-server'})], sources: []}, {now});
  assert.equal(scoped.events.length, 2);
});

test('malformed JSON event contracts are rejected before replacing the view', () => {
  const bad = [null, [], {}, {events: 'text'}, {events: [makeEvent({ip: '999.1.2.3'})]}, {events: [makeEvent({type: 'execute_shell'})]}, {events: [makeEvent({occurred_at: '2026-10-29 12:00'})]}, {events: [makeEvent({occurred_at: '2026-11-01T12:00:00Z'})]}, {events: [makeEvent({actor: 'user\nsecret'})]}, {events: [makeEvent({id: null})]}, {events: [makeEvent({metadata: []})]}, {events: [], sources: [{source_id: 'x', last_seen: 'invalid'}]}];
  for (const value of bad) assert.throws(() => normalizeSnapshot(value, {imported: true, now}));
  assert.throws(() => normalizeSnapshot({events: []}, {now}), /sources/);
  assert.deepEqual(normalizeSnapshot({events: [], sources: []}, {now}).events, []);
});

test('impossible calendar dates and times are rejected rather than normalized silently', () => {
  for (const occurred_at of ['2026-02-31T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-29T24:00:00Z', '2026-10-29T12:00:00+25:00']) assert.throws(() => normalizeSnapshot({events: [makeEvent({occurred_at})]}, {imported: true, now}));
  assert.doesNotThrow(() => normalizeSnapshot({events: [makeEvent({occurred_at: '2024-02-29T12:00:00Z'})]}, {imported: true, now}));
});

test('session details require the same source and session and never infer links by IP', () => {
  const selected = makeEvent();
  const sameSession = makeEvent({id: 'two', type: 'logout', occurred_at: '2026-10-29T12:02:00Z'});
  const otherSource = makeEvent({id: 'three', source_id: 'other-server'});
  const sameIpDifferentSession = makeEvent({id: 'four', session_id: 'ssh-99'});
  assert.deepEqual(sessionEvents([sameIpDifferentSession, otherSource, sameSession, selected], selected).map(e => e.id), ['one', 'two']);
  const noSession = makeEvent({id: 'unlinked', session_id: null});
  assert.deepEqual(sessionEvents([selected, sameSession, noSession], noSession), [noSession]);
});

test('response JSON reader enforces its byte budget including streamed bodies', async () => {
  assert.deepEqual(await readLimitedJson(new Response('{"events":[],"sources":[]}')), {events: [], sources: []});
  await assert.rejects(readLimitedJson(new Response('not-json')), /JSON/);
  await assert.rejects(readLimitedJson(new Response('{}', {headers: {'content-length': String(MAX_JSON_BYTES + 1)}})), /أكبر/);
  const stream = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(MAX_JSON_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();}});
  await assert.rejects(readLimitedJson(new Response(stream)), /أكبر/);
});
