import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAi } from '../server/ai.mjs';

// Injected provider contract fixtures; these tests never call an external model.
const configured = { GEMINI_API_KEY: 'test-provider-secret', GEMINI_MODEL: 'configured-test-model', GEMINI_ALLOWED_MODELS: '["alternate-test-model"]' };
const responseFixture = (patch = {}) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'نتيجة من عقد الاختبار' }] }, finishReason: 'STOP' }], ...patch }), { headers: { 'Content-Type': 'application/json' } });
const errorHas = (status, code) => (error) => error.status === status && error.code === code;

test('missing key or configured model makes no provider request', async () => {
  let calls = 0;
  const outgoing = async () => { calls++; return responseFixture(); };
  for (const env of [{}, { GEMINI_API_KEY: 'test-key' }, { GEMINI_MODEL: 'configured-test-model' }, { ...configured, GEMINI_MODEL: '../unsafe', GEMINI_ALLOWED_MODELS: '[]' }, { ...configured, GEMINI_ALLOWED_MODELS: 'invalid-json' }]) {
    await assert.rejects(generateAi({ prompt: 'طلب اختبار' }, env, outgoing), errorHas(503, 'provider_not_configured'));
  }
  assert.equal(calls, 0);
});

test('configured text request targets Gemini and sends its secret only in the header', async () => {
  let captured;
  const result = await generateAi({ prompt: '  طلب اختبار  ' }, configured, async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'تفكير خاص', thought: true }, { text: ' الجزء الأول ' }, { text: 'الجزء الثاني' }, { inlineData: { mimeType: 'image/png', data: 'ignored' } }] } }] }));
  });
  assert.deepEqual(result, { content: 'الجزء الأول\nالجزء الثاني', model: 'configured-test-model' });
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/configured-test-model:generateContent');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, 'manual');
  assert.equal(captured.options.headers['x-goog-api-key'], configured.GEMINI_API_KEY);
  assert.ok(!captured.url.includes(configured.GEMINI_API_KEY));
  assert.ok(!captured.options.body.includes(configured.GEMINI_API_KEY));
  assert.deepEqual(JSON.parse(captured.options.body).contents, [{ role: 'user', parts: [{ text: 'طلب اختبار' }] }]);
});

test('explicit models must be configured and allowlist-only policy never guesses a default', async () => {
  let calls = 0;
  const outgoing = async () => { calls++; return responseFixture(); };
  const alternative = await generateAi({ prompt: 'اختبار', model: 'alternate-test-model' }, configured, outgoing);
  assert.equal(alternative.model, 'alternate-test-model');
  const allowedOnly = { GEMINI_API_KEY: 'test-key', GEMINI_ALLOWED_MODELS: '["approved-test-model"]' };
  await assert.rejects(generateAi({ prompt: 'اختبار' }, allowedOnly, outgoing), errorHas(422, 'model_required'));
  const selected = await generateAi({ prompt: 'اختبار', model: 'approved-test-model' }, allowedOnly, outgoing);
  assert.equal(selected.model, 'approved-test-model');
  for (const model of ['unconfigured-model', '../other-model', 'model?key=value', '', 7]) {
    await assert.rejects(generateAi({ prompt: 'اختبار', model }, configured, outgoing), (error) => error.status === 422);
  }
  assert.equal(calls, 2);
});

test('image analysis forwards bounded canonical base64 with its MIME type', async () => {
  const encoded = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
  let contents;
  await generateAi({ prompt: 'حلل صورة الاختبار', imageBase64: encoded, mimeType: 'image/jpeg' }, configured, async (_, options) => {
    contents = JSON.parse(options.body).contents;
    return responseFixture();
  });
  assert.deepEqual(contents[0].parts, [{ text: 'حلل صورة الاختبار' }, { inlineData: { mimeType: 'image/jpeg', data: encoded } }]);
  let calls = 0;
  const outgoing = async () => { calls++; return responseFixture(); };
  const invalidImages = [
    { imageBase64: encoded, mimeType: 'image/gif' },
    { imageBase64: encoded }, { mimeType: 'image/jpeg' },
    { imageBase64: '', mimeType: 'image/jpeg' },
    { imageBase64: 'data:image/jpeg;base64,' + encoded, mimeType: 'image/jpeg' },
    { imageBase64: 'AB==', mimeType: 'image/jpeg' },
    { imageBase64: 'YWJj\n', mimeType: 'image/jpeg' },
    { imageBase64: 'A'.repeat(512 * 1024 + 4), mimeType: 'image/jpeg' },
  ];
  for (const image of invalidImages) await assert.rejects(generateAi({ prompt: 'اختبار', ...image }, configured, outgoing), (error) => error.status === 422);
  assert.equal(calls, 0);
});

test('empty, oversized or unsupported input fails without invoking Gemini', async () => {
  let calls = 0;
  const outgoing = async () => { calls++; return responseFixture(); };
  for (const input of [{ prompt: '' }, { prompt: '   ' }, { prompt: 'a'.repeat(12001) }, { prompt: 5 }, { prompt: 'اختبار', searchGrounding: true }, []]) await assert.rejects(generateAi(input, configured, outgoing), (error) => error.status === 422);
  assert.equal(calls, 0);
});

test('provider errors, redirects and network failures are redacted', async () => {
  const privateText = 'test-provider-secret echoed-private-prompt';
  for (const [status, code] of [[302, 'provider_request_failed'], [400, 'provider_request_invalid'], [401, 'provider_access_denied'], [403, 'provider_access_denied'], [404, 'provider_model_unavailable'], [429, 'provider_quota_exceeded'], [500, 'provider_request_failed']]) {
    await assert.rejects(generateAi({ prompt: 'echoed-private-prompt' }, configured, async () => new Response(JSON.stringify({ error: { message: privateText } }), { status })), (error) => {
      assert.equal(error.status, status === 429 ? 429 : 502);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(privateText));
      assert.ok(!error.message.includes(configured.GEMINI_API_KEY));
      assert.ok(!error.message.includes('echoed-private-prompt'));
      return true;
    });
  }
  await assert.rejects(generateAi({ prompt: 'اختبار' }, configured, async () => { throw new Error(privateText); }), (error) => error.status === 502 && error.code === 'provider_unavailable' && !error.message.includes(privateText));
});

test('blocked, incomplete, thought-only and empty responses cannot claim a generated result', async () => {
  const noResultFixtures = [
    { candidates: [] },
    { promptFeedback: { blockReason: 'SAFETY' }, candidates: [{ content: { parts: [{ text: 'blocked-text' }] }, finishReason: 'STOP' }] },
    { candidates: [{ content: { parts: [{ text: 'blocked-text' }] }, finishReason: 'STOP', safetyRatings: [{ blocked: true }] }] },
    ...['SAFETY', 'RECITATION', 'MAX_TOKENS', 'OTHER', 'FINISH_REASON_UNSPECIFIED'].map((finishReason) => ({ candidates: [{ content: { parts: [{ text: 'incomplete-text' }] }, finishReason }] })),
    { candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'STOP' }] },
    { candidates: [{ content: { parts: [{ text: 'thought', thought: true }] }, finishReason: 'STOP' }] },
  ];
  for (const data of noResultFixtures) await assert.rejects(generateAi({ prompt: 'اختبار' }, configured, async () => responseFixture(data)), errorHas(502, 'model_no_result'));
});

test('provider responses have a streaming byte limit and invalid JSON is redacted', async () => {
  await assert.rejects(generateAi({ prompt: 'اختبار' }, configured, async () => new Response('raw-private-error')), errorHas(502, 'provider_invalid_response'));
  await assert.rejects(generateAi({ prompt: 'اختبار' }, configured, async () => new Response('{}', { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } })), errorHas(502, 'provider_invalid_response'));
  await assert.rejects(generateAi({ prompt: 'اختبار' }, configured, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), errorHas(502, 'provider_invalid_response'));
});

test('provider aborts produce the timeout contract without exposing transport errors', async () => {
  await assert.rejects(generateAi({ prompt: 'اختبار' }, configured, async () => { const error = new Error('private abort detail'); error.name = 'AbortError'; throw error; }), (error) => error.status === 504 && error.code === 'provider_timeout' && !error.message.includes('private'));
});

test('the 20 second deadline aborts a stalled provider request', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = generateAi({ prompt: 'اختبار مهلة الاتصال' }, configured, async (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(19999);
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await assert.rejects(pending, errorHas(504, 'provider_timeout'));
  assert.equal(signal.aborted, true);
});
