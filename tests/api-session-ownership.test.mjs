import test from 'node:test';
import assert from 'node:assert/strict';
import { API_POLICIES, securityResponse } from '../functions/_shared/api-security.js';
import { needsSessionOwnership, requireSessionOwnership } from '../functions/_shared/session-ownership.js';
import { onRequest } from '../functions/api/_middleware.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key' };
const jwt = (claims = {}) => ['eyJhbGciOiJFUzI1NiJ9', Buffer.from(JSON.stringify({ role: 'authenticated', sub: userId, session_id: sessionId, ...claims })).toString('base64url'), 'c2lnbmF0dXJl'].join('.');
const req = (path = '/api/encar', options = {}) => new Request('https://s-note.example' + path, {
  method: 'POST', body: '{}', ...options,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt(), ...options.headers }
});
const ack = (changes = {}) => ({ ok: true, active: true, userId, sessionId, generation: 2, reason: 'ACTIVE', ...changes });
const throwsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkDiagnostics(diagnostics, stage, upstreamHttpStatus) {
  assert.deepEqual(Object.keys(diagnostics).sort(), ['code', 'stage', 'requestId', ...(upstreamHttpStatus === undefined ? [] : ['upstreamHttpStatus'])].sort());
  assert.equal(diagnostics.code, 'SESSION_UNAVAILABLE'); assert.equal(diagnostics.stage, stage);
  assert.match(diagnostics.requestId, UUID); assert.equal(diagnostics.upstreamHttpStatus, upstreamHttpStatus);
  for (const secret of [userId, sessionId, jwt(), env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, 'PRIVATE_UPSTREAM']) assert.equal(JSON.stringify(diagnostics).includes(secret), false);
}

test('current and legacy sessions are verified by exactly one uncached no-argument RPC', async () => {
  for (const status of [ack(), ack({ generation: 0, reason: 'LEGACY' })]) {
    const calls = [];
    const result = await requireSessionOwnership(req(), env, { fetcher: async (url, options) => {
      calls.push({ url, options }); return Response.json(status);
    } });
    assert.deepEqual(result, { userId, sessionId, generation: status.generation });
    assert.equal(calls.length, 1);
    const { url, options } = calls[0];
    assert.equal(url, env.SUPABASE_URL + '/rest/v1/rpc/snote_session_status');
    assert.equal(options.method, 'POST'); assert.equal(options.body, '{}');
    assert.equal(options.headers.Authorization, 'Bearer ' + jwt());
    assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
  }
});

test('replaced and removed Auth sessions cannot dispatch any paid or privileged API action', async () => {
  const original = globalThis.fetch;
  try {
    for (const reason of ['REPLACED', 'SESSION_MISSING']) {
      globalThis.fetch = async () => Response.json(ack({ active: false, reason }));
      for (const [path, policy] of Object.entries(API_POLICIES)) {
        if (path === '/api/weather') continue;
        let called = 0;
        const request = req(path, path === '/api/ocr' ? { headers: { 'Content-Type': 'image/png' }, body: 'image' } : {});
        const response = await onRequest({ request, env, next: () => { called++; return Response.json({ ok: true }); } });
        assert.equal(response.status, 401, path); assert.equal(called, 0, path);
        const body = await response.json(); assert.equal(body.code, 'SESSION_REPLACED');
        assert.equal(body.error, '다른 기기에서 로그인하여 로그아웃되었습니다.');
        assert.match(response.headers.get('Cache-Control'), /no-store/);
      }
    }
  } finally { globalThis.fetch = original; }
});

test('middleware permits the active session and does not replace existing handler authorization', async () => {
  const original = globalThis.fetch; let statusCalls = 0, handlers = 0;
  try {
    globalThis.fetch = async () => { statusCalls++; return Response.json(ack()); };
    const response = await onRequest({ request: req(), env, next: () => { handlers++; return Response.json({ ok: false, code: 'MEMBERSHIP_REQUIRED' }, { status: 403 }); } });
    assert.equal(response.status, 403); assert.equal(statusCalls, 1); assert.equal(handlers, 1);
    assert.equal((await response.json()).code, 'MEMBERSHIP_REQUIRED');
  } finally { globalThis.fetch = original; }
});

test('public weather/configuration and customer link/OTP flows remain independent of dealer sessions', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw Error('public requests must not call Auth'); };
    const requests = [
      new Request('https://s-note.example/api/weather'),
      new Request('https://s-note.example/api/encar-auto-price'),
      new Request('https://s-note.example/api/ocr'),
      new Request('https://s-note.example/api/customer-intake?token=public-link'),
      new Request('https://s-note.example/api/customer-intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer opaque-customer-token' }, body: '{}' })
    ];
    for (const request of requests) {
      let called = 0;
      const response = await onRequest({ request, env: {}, next: () => { called++; return Response.json({ ok: true }); } });
      assert.equal(response.status, 200); assert.equal(called, 1);
      assert.equal(needsSessionOwnership(request, API_POLICIES[new URL(request.url).pathname]), false);
    }
  } finally { globalThis.fetch = original; }
});

test('staff JWTs on optional/public customer endpoints still require active ownership', () => {
  assert.equal(needsSessionOwnership(req('/api/customer-intake'), API_POLICIES['/api/customer-intake']), true);
  assert.equal(needsSessionOwnership(req('/api/customer-intake', { method: 'GET', body: undefined }), API_POLICIES['/api/customer-intake']), true);
});

test('unsigned identity hints never authorize without a valid matching authoritative RPC result', async () => {
  for (const status of [null, [], {}, ack({ ok: false }), ack({ active: 'true' }), ack({ userId: sessionId }),
    ack({ sessionId: userId }), ack({ generation: -1 }), ack({ generation: 1.1 }), ack({ generation: Number.MAX_SAFE_INTEGER + 1 }),
    ack({ reason: 'UNKNOWN' }), ack({ reason: 'LEGACY' }), ack({ reason: 'ACTIVE', generation: 0 }),
    ack({ active: false, reason: 'ACTIVE' }), ack({ active: false, reason: 'LEGACY', generation: 0 }), ack({ active: false, reason: 'REPLACED', generation: 0 })]) {
    await throwsCode(requireSessionOwnership(req(), env, { fetcher: async () => Response.json(status) }), 'SESSION_UNAVAILABLE');
  }
});

test('malformed or inappropriate JWT hints are rejected before a network call', async () => {
  for (const header of [undefined, 'Bearer opaque', 'Bearer ' + jwt({ role: 'service_role' }), 'Bearer ' + jwt({ sub: 'invalid' }), 'Bearer ' + jwt({ session_id: null }), 'Bearer ' + 'x'.repeat(8300)]) {
    let calls = 0;
    const request = req(); header === undefined ? request.headers.delete('Authorization') : request.headers.set('Authorization', header);
    await throwsCode(requireSessionOwnership(request, env, { fetcher: async () => { calls++; return Response.json(ack()); } }), 'UNAUTHORIZED');
    assert.equal(calls, 0);
  }
});

test('only the configured HTTPS Supabase origin receives the user bearer', async () => {
  for (const bad of [undefined, 'https://evil.example', 'http://example-project.supabase.co', 'https://example-project.supabase.co.attacker.example',
    'https://user:password@example-project.supabase.co', 'https://example-project.supabase.co:444', 'https://example-project.supabase.co/path',
    'https://example-project.supabase.co?query=1', 'https://example-project.supabase.co#fragment']) {
    let calls = 0;
    await throwsCode(requireSessionOwnership(req(), { ...env, SUPABASE_URL: bad }, { fetcher: async () => { calls++; return Response.json(ack()); } }), 'SESSION_UNAVAILABLE');
    assert.equal(calls, 0);
  }
  await throwsCode(requireSessionOwnership(req(), { ...env, SUPABASE_PUBLISHABLE_KEY: undefined }), 'SESSION_UNAVAILABLE');
});

test('invalid upstream status, JSON, content type and excessive body fail closed', async () => {
  const responses = [new Response('upstream-token-secret', { status: 500 }), new Response('moved', { status: 302 }),
    new Response('not json', { headers: { 'Content-Type': 'application/json' } }), new Response(JSON.stringify(ack()), { headers: { 'Content-Type': 'text/html' } }),
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '9000' } }),
    new Response(' '.repeat(9000), { headers: { 'Content-Type': 'application/json', 'Content-Length': '1' } })];
  for (const response of responses) await throwsCode(requireSessionOwnership(req(), env, { fetcher: async () => response }), 'SESSION_UNAVAILABLE');
  for (const status of [401, 403]) await throwsCode(requireSessionOwnership(req(), env, { fetcher: async () => new Response('secret', { status }) }), 'UNAUTHORIZED');
});

test('one overall deadline cancels a hanging fetch even if the mock ignores AbortSignal', async () => {
  let signal;
  await throwsCode(requireSessionOwnership(req(), env, { timeoutMs: 10, fetcher: (_, options) => { signal = options.signal; return new Promise(() => {}); } }), 'SESSION_UNAVAILABLE');
  assert.equal(signal.aborted, true);
});

test('the same deadline covers hanging streamed response bodies and cancels them', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } });
  await throwsCode(requireSessionOwnership(req(), env, { timeoutMs: 10, fetcher: async () => response }), 'SESSION_UNAVAILABLE');
  assert.equal(cancelled, true);
});

test('request cancellation prevents downstream session checks from hanging', async () => {
  const controller = new AbortController();
  const request = req('/api/encar', { signal: controller.signal });
  const checked = requireSessionOwnership(request, env, { fetcher: () => new Promise(() => {}) });
  controller.abort();
  await throwsCode(checked, 'SESSION_UNAVAILABLE');
});

test('fixed session failures expose neither tokens nor upstream errors', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw Error('provider-key-and-token-secret'); };
    let called = false;
    const response = await onRequest({ request: req(), env, next: () => { called = true; return Response.json({ ok: true }); } });
    assert.equal(called, false); assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual({ ...body, diagnostics: undefined }, { ok: false, code: 'SESSION_UNAVAILABLE', error: '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', diagnostics: undefined });
    checkDiagnostics(body.diagnostics, 'RPC_NETWORK_ERROR');
  } finally { globalThis.fetch = original; }
});

test('session-unavailable diagnostics distinguish configuration, HTTP, response and network failures', async t => {
  for (const [name, extraEnv, fetcher, stage, upstreamHttpStatus] of [
    ['configuration', { SUPABASE_URL: 'https://PRIVATE_UPSTREAM.invalid' }, () => assert.fail('invalid config must not fetch'), 'CONFIG_INVALID', undefined],
    ['missing RPC', {}, async () => new Response('PRIVATE_UPSTREAM', { status: 404 }), 'RPC_HTTP_ERROR', 404],
    ['server failure', {}, async () => new Response('PRIVATE_UPSTREAM', { status: 500 }), 'RPC_HTTP_ERROR', 500],
    ['content type', {}, async () => new Response('PRIVATE_UPSTREAM'), 'RPC_RESPONSE_INVALID', 200],
    ['invalid JSON', {}, async () => new Response('PRIVATE_UPSTREAM', { headers: { 'Content-Type': 'application/json' } }), 'RPC_RESPONSE_INVALID', 200],
    ['invalid identity', {}, async () => Response.json(ack({ userId: 'PRIVATE_UPSTREAM' })), 'RPC_RESPONSE_INVALID', 200],
    ['fetch failure', {}, async () => { throw Error('PRIVATE_UPSTREAM ' + jwt()); }, 'RPC_NETWORK_ERROR', undefined],
    ['stream failure', {}, async () => new Response(new ReadableStream({ start(controller) { controller.error(Error('PRIVATE_UPSTREAM')); } }), { headers: { 'Content-Type': 'application/json' } }), 'RPC_NETWORK_ERROR', 200]
  ]) await t.test(name, async () => {
    await assert.rejects(requireSessionOwnership(req(), { ...env, ...extraEnv }, { fetcher }), error => {
      assert.equal(error.code, 'SESSION_UNAVAILABLE'); checkDiagnostics(error.diagnostics, stage, upstreamHttpStatus); return true;
    });
  });
});

test('deadline and caller cancellation have separate bounded diagnostics and cancel response bodies', async () => {
  for (const streamed of [false, true]) {
    let cancelled = false, reached;
    const ready = new Promise(resolve => { reached = resolve; });
    const response = new Response(new ReadableStream({ pull() { reached(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/json' } });
    const fetcher = streamed ? async () => response : () => { reached(); return new Promise(() => {}); };
    await assert.rejects(requireSessionOwnership(req(), env, { timeoutMs: 10, fetcher }), error => {
      assert.equal(error.code, 'SESSION_UNAVAILABLE'); checkDiagnostics(error.diagnostics, 'RPC_TIMEOUT', streamed ? 200 : undefined); return true;
    });
    assert.equal(cancelled, streamed);
    const controller = new AbortController();
    const checked = requireSessionOwnership(req('/api/encar', { signal: controller.signal }), env, { fetcher: () => { reached(); return new Promise(() => {}); } });
    await ready; controller.abort();
    await assert.rejects(checked, error => {
      assert.equal(error.code, 'SESSION_UNAVAILABLE'); checkDiagnostics(error.diagnostics, 'REQUEST_ABORTED'); return true;
    });
  }
});

test('middleware keeps session diagnostics sanitized and limits them to unavailable failures', async () => {
  const requestId = '33333333-3333-4333-8333-333333333333';
  const diagnostics = { code: 'SESSION_UNAVAILABLE', stage: 'RPC_HTTP_ERROR', requestId, upstreamHttpStatus: 502,
    token: jwt(), userId, sessionId, url: env.SUPABASE_URL, raw: 'PRIVATE_UPSTREAM' };
  const response = securityResponse('SESSION_UNAVAILABLE', {}, diagnostics), body = await response.json();
  assert.equal(response.status, 503); checkDiagnostics(body.diagnostics, 'RPC_HTTP_ERROR', 502);
  assert.equal(body.diagnostics.requestId, requestId);
  for (const code of ['UNAUTHORIZED', 'SESSION_REPLACED', 'UPSTREAM_ERROR']) assert.equal((await securityResponse(code, {}, diagnostics).json()).diagnostics, undefined);
  for (const invalid of [{ ...diagnostics, stage: 'PRIVATE_UPSTREAM' }, { ...diagnostics, code: 'PRIVATE_UPSTREAM' }, { ...diagnostics, requestId: jwt() }]) {
    assert.equal((await securityResponse('SESSION_UNAVAILABLE', {}, invalid).json()).diagnostics, undefined);
  }
  for (const upstreamHttpStatus of [99, 600, 502.1, '502', null, NaN]) {
    const sanitized = (await securityResponse('SESSION_UNAVAILABLE', {}, { ...diagnostics, upstreamHttpStatus }).json()).diagnostics;
    checkDiagnostics(sanitized, 'RPC_HTTP_ERROR');
  }
});
