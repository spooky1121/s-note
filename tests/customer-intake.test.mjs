import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { onRequest } from '../functions/api/customer-intake.js';

// All HTTP is intercepted. These tests must never contact Supabase or SOLAPI.
const ENV = {
  SUPABASE_URL: 'https://intake-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', CUSTOMER_INTAKE_PUBLIC_ORIGIN: 'https://s-note.example',
  SOLAPI_API_KEY: 'test-solapi-api-key', SOLAPI_API_SECRET: 'test-solapi-api-secret',
  CUSTOMER_INTAKE_OTP_SECRET: 'test-only-otp-secret-at-least-32-characters', SOLAPI_SENDER: '02-1234-5678'
};
const ID = '12345678-1234-4234-8234-123456789abc';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const TOKEN = 'a'.repeat(64), SESSION = 'b'.repeat(64);
const CAR = { model: '테스트 차량', plate: '123가4567', year: 2024, km: 12000, color: '흰색', sell: 2300 };
const hash = value => createHash('sha256').update(value).digest('hex');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function mock(t, handler) {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    const call = { url: String(url), options, body: JSON.parse(options.body) }; calls.push(call);
    return handler(call, calls);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}
async function call(body, { env = ENV, authorization, origin = 'https://s-note.example', headers = {}, method = 'POST', raw, requestBody } = {}) {
  const reqHeaders = { 'Content-Type': 'application/json', ...headers };
  if (origin !== null) reqHeaders.Origin = origin;
  if (authorization) reqHeaders.Authorization = authorization;
  const request = new Request('https://s-note.example/api/customer-intake', {
    method, headers: reqHeaders, ...(method === 'GET' ? {} : { body: requestBody ?? raw ?? JSON.stringify(body), ...(requestBody ? { duplex: 'half' } : {}) })
  });
  const result = await onRequest({ request, env });
  return { result, body: await result.json() };
}
function submit(overrides = {}) {
  return { action: 'submit', token: TOKEN, session: SESSION, vehicleConfirmed: true, consent: true,
    customer: { name: '테스트', addressBase: '서울시 테스트로 1', addressDetail: '101호', sameAddress: true, refundBank: '', refundAccount: '', refundHolder: '' }, ...overrides };
}

test('GET exposes fixed configuration diagnostics only; missing setup prevents every mutation without network', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const get = await call(undefined, { method: 'GET', env: {} });
  assert.deepEqual(get.body, {
    service: 'snote-customer-intake', configured: false, originMatches: null,
    configurationIssues: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CUSTOMER_INTAKE_PUBLIC_ORIGIN', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_SENDER', 'CUSTOMER_INTAKE_OTP_SECRET'].map(name => ({ name, reason: '값이 설정되지 않았습니다.' }))
  });
  for (const key of Object.keys(ENV)) {
    const env = { ...ENV }; delete env[key];
    const result = await call({ action: 'create', carId: 'car-1', phone: '01012345678' }, { env, authorization: `Bearer ${JWT}` });
    assert.equal(result.result.status, 503, key); assert.equal(result.body.code, 'SERVICE_UNAVAILABLE');
  }
  assert.equal(calls.length, 0);
});

test('configuration diagnostics never expose values and invalid settings remain fail-closed', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const cases = [
    ['SUPABASE_URL', 'http://private-project.supabase.co'],
    ['SUPABASE_URL', 'https://private-project.supabase.co/rest/v1'],
    ['SUPABASE_URL', 'https://private-user:private-password@private-project.supabase.co'],
    ['CUSTOMER_INTAKE_PUBLIC_ORIGIN', 'http://private-host.example'],
    ['CUSTOMER_INTAKE_PUBLIC_ORIGIN', 'https://private-host.example/customer.html'],
    ['SOLAPI_SENDER', '+8201012345678'], ['SOLAPI_SENDER', 'private-invalid-sender'],
    ['CUSTOMER_INTAKE_OTP_SECRET', 'private-short-value'],
    ...['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'CUSTOMER_INTAKE_OTP_SECRET'].map(name => [name, 'private-first-line\nprivate-second-line-very-long-value'])
  ];
  for (const [name, value] of cases) {
    const env = { ...ENV, [name]: value };
    const get = await call(undefined, { method: 'GET', env });
    assert.equal(get.body.configured, false, name); assert.equal(get.body.originMatches, null);
    assert.ok(get.body.configurationIssues.some(issue => issue.name === name));
    for (const issue of get.body.configurationIssues) {
      assert.ok(Object.hasOwn(ENV, issue.name)); assert.deepEqual(Object.keys(issue).sort(), ['name', 'reason']);
    }
    const serialized = JSON.stringify(get.body);
    for (const privateValue of Object.values(env)) assert.equal(serialized.includes(privateValue), false);
    assert.equal(serialized.includes('private-'), false);
    const post = await call({ action: 'create', carId: 'car-1', phone: '01012345678' }, { env, authorization: `Bearer ${JWT}` });
    assert.equal(post.result.status, 503); assert.equal(post.body.code, 'SERVICE_UNAVAILABLE');
  }
  const valid = await call(undefined, { method: 'GET' });
  assert.deepEqual(valid.body, { service: 'snote-customer-intake', configured: true, configurationIssues: [], originMatches: true });
  assert.equal(calls.length, 0);
});

test('address-bar diagnostics identify canonical origin mismatch without relaxing cross-origin protection', async t => {
  mock(t, () => { throw new Error('unexpected network'); });
  const env = { ...ENV, CUSTOMER_INTAKE_PUBLIC_ORIGIN: 'https://canonical-private.example' };
  const get = await call(undefined, { method: 'GET', env, origin: null });
  assert.equal(get.body.configured, true); assert.equal(get.body.originMatches, false);
  assert.deepEqual(get.body.configurationIssues, [{ name: 'CUSTOMER_INTAKE_PUBLIC_ORIGIN', reason: '실제 접속 주소와 운영 주소 설정이 일치하지 않습니다.' }]);
  assert.equal(JSON.stringify(get.body).includes(env.CUSTOMER_INTAKE_PUBLIC_ORIGIN), false);
  assert.equal((await call(undefined, { method: 'GET', env })).result.status, 403);
});

test('RPC setup errors are classified without leaking upstream bodies or sending SMS', async t => {
  for (const code of ['PGRST202', 'PGRST204', '42P01', '42703', '42883']) {
    const calls = mock(t, () => response({ code, message: 'private SQL phone 01012345678', details: ENV.SUPABASE_SERVICE_ROLE_KEY }, 400));
    const result = await call({ action: 'create', carId: 'car-1', phone: '01012345678' }, { authorization: `Bearer ${JWT}` });
    assert.equal(result.result.status, 503); assert.equal(result.body.code, 'DB_SETUP_REQUIRED');
    assert.equal(JSON.stringify(result.body).includes('01012345678'), false);
    assert.equal(JSON.stringify(result.body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY), false);
    assert.equal(calls.length, 1);
  }
  for (const status of [401, 403]) {
    const calls = mock(t, () => response({ message: ENV.SUPABASE_SERVICE_ROLE_KEY }, status));
    const publicResult = await call({ action: 'info', token: TOKEN });
    assert.equal(publicResult.result.status, 503); assert.equal(publicResult.body.code, 'SERVER_SETUP_REQUIRED');
    const dealerResult = await call({ action: 'list', carId: 'car-1' }, { authorization: `Bearer ${JWT}` });
    assert.equal(dealerResult.result.status, status); assert.equal(dealerResult.body.code, status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
    assert.equal(JSON.stringify(publicResult.body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY), false);
    assert.equal(calls.length, 2);
  }
});

test('server fetch uses workerd-compatible manual redirects and refuses every 3xx without following credentials', async t => {
  for (const redirectAt of ['supabase', 'solapi']) {
    const calls = mock(t, call => {
      assert.equal(call.options.redirect, 'manual');
      if (call.url.includes('private-redirect.example')) throw new Error('must never follow redirect');
      if (call.url.endsWith('/snote_intake_create') && redirectAt === 'solapi') return response({ ok: true, id: ID, car: CAR });
      if (call.url.endsWith('/snote_intake_delivery')) return response({ ok: true });
      return new Response(null, { status: 302, headers: { Location: 'https://private-redirect.example/steal' } });
    });
    const result = await call({ action: 'create', carId: 'car-1', phone: '01012345678' }, { authorization: `Bearer ${JWT}` });
    if (redirectAt === 'supabase') { assert.equal(result.result.status, 502); assert.equal(result.body.code, 'UPSTREAM_ERROR'); assert.equal(calls.length, 1); }
    else { assert.equal(result.body.request.deliveryStatus, 'unknown'); assert.equal(calls.length, 3); assert.equal(calls.at(-1).body.p_status, 'unknown'); }
    assert.equal(calls.some(call => call.url.includes('private-redirect.example')), false);
    assert.equal(calls.filter(call => call.url.startsWith('https://api.solapi.com/')).length, redirectAt === 'supabase' ? 0 : 1);
  }
});

test('invalid origins, methods, content types, JWTs and body shapes are rejected with private headers', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const cases = [
    [{ action: 'info', token: TOKEN }, { origin: 'https://evil.example' }, 403],
    [{ action: 'info', token: TOKEN }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ action: 'info', token: TOKEN }, { method: 'DELETE' }, 405],
    [{ action: 'info', token: TOKEN }, { headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ action: 'list', carId: 'car-1' }, {}, 401],
    [{ action: 'create', carId: 'car-1', phone: '01012345678' }, { authorization: 'Bearer invalid' }, 401],
    [{ action: ['info'], token: TOKEN }, {}, 400],
    [{ action: 'info', token: TOKEN, companyId: ID }, {}, 400],
    [{ action: 'info', token: TOKEN }, { raw: '{' }, 400]
  ];
  for (const [body, options, expected] of cases) {
    const result = await call(body, options); assert.equal(result.result.status, expected);
    assert.match(result.result.headers.get('Cache-Control'), /no-store.*private/);
    assert.equal(result.result.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(result.result.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(result.result.headers.has('Access-Control-Allow-Origin'), false);
  }
  assert.equal(calls.length, 0);
});

test('16 KiB limit also rejects streamed requests without a Content-Length', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const payload = JSON.stringify({ action: 'info', token: 'x'.repeat(17 * 1024) });
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } });
  assert.equal((await call(null, { requestBody: stream })).result.status, 413);
  assert.equal((await call({}, { headers: { 'Content-Length': String(17 * 1024) } })).result.status, 413);
  assert.equal(calls.length, 0);
});

test('create stores a token hash, authenticates as dealer, and only accepts SOLAPI code 2000 plus a messageId', async t => {
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_create')) return response({ ok: true, id: ID, car: CAR, companyName: '테스트 상사', expiresAt: '2026-11-02T00:00:00Z' });
    if (call.url.startsWith('https://api.solapi.com/')) return response({ statusCode: '2000', messageId: 'M4V_test_message' });
    if (call.url.endsWith('/snote_intake_delivery')) return response({ ok: true });
    throw new Error('unexpected request');
  });
  const result = await call({ action: 'create', carId: 'car-1', phone: '+82 10-1234-5678' }, { authorization: `Bearer ${JWT}` });
  assert.equal(result.result.status, 200); assert.equal(result.body.request.deliveryStatus, 'sent');
  const rawToken = result.body.link.split('#')[1]; assert.match(rawToken, /^[a-f0-9]{64}$/);
  assert.equal(result.body.link, `https://s-note.example/customer.html#${rawToken}`);
  assert.deepEqual(calls[0].body, { p_car_id: 'car-1', p_phone: '01012345678', p_token_hash: hash(rawToken) });
  assert.equal(calls[0].options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${JWT}`);
  const sms = calls[1]; assert.equal(sms.body.message.type, 'LMS'); assert.equal(sms.body.message.subject, '고객정보 입력 안내');
  assert.equal(sms.body.message.from, '0212345678'); assert.match(sms.body.message.text, /customer\.html#[a-f0-9]{64}/);
  const auth = /^HMAC-SHA256 apiKey=(.*), date=(.*), salt=(.*), signature=(.*)$/.exec(sms.options.headers.Authorization);
  assert.ok(auth); assert.equal(auth[1], ENV.SOLAPI_API_KEY);
  assert.equal(auth[4], createHmac('sha256', ENV.SOLAPI_API_SECRET).update(auth[2] + auth[3]).digest('hex'));
  assert.deepEqual(calls[2].body, { p_id: ID, p_kind: 'invitation', p_challenge_id: null, p_status: 'sent' });
  assert.equal(calls[2].options.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
});

test('invitation provider failure or uncertain reception is honest and never automatically resends', async t => {
  for (const [provider, expected] of [
    [() => response({ statusCode: '3000', error: 'private provider detail' }, 400), 'failed'],
    [() => { throw new Error('network may have accepted message'); }, 'unknown'],
    [() => response({ statusCode: '2000' }), 'unknown'],
    [() => response({ error: 'server unavailable' }, 500), 'unknown']
  ]) {
    const calls = mock(t, call => {
      if (call.url.endsWith('/snote_intake_create')) return response({ ok: true, id: ID, car: CAR });
      if (call.url.startsWith('https://api.solapi.com/')) return provider();
      if (call.url.endsWith('/snote_intake_delivery')) return response({ ok: true });
      throw new Error('unexpected request');
    });
    const result = await call({ action: 'create', carId: 'car-1', phone: '01012345678' }, { authorization: `Bearer ${JWT}` });
    assert.equal(result.body.request.deliveryStatus, expected); assert.ok(result.body.link); assert.ok(result.body.warning);
    assert.equal(calls.filter(x => x.url.startsWith('https://api.solapi.com/')).length, 1);
    assert.equal(calls.at(-1).body.p_status, expected);
  }
});

test('OTP goes only to private RPC phone, is salted by challenge, and raw code never reaches client or DB', async t => {
  let challengeId;
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_challenge')) { challengeId = call.body.p_challenge_id; return response({ ok: true, id: ID, phone: '01012345678', challengeId, expiresAt: '2026-11-01T00:05:00Z' }); }
    if (call.url.startsWith('https://api.solapi.com/')) return response({ statusCode: '2000', messageId: 'M4V_test_message' });
    if (call.url.endsWith('/snote_intake_delivery')) return response({ ok: true });
    throw new Error('unexpected request');
  });
  const result = await call({ action: 'send-code', token: TOKEN });
  assert.deepEqual(result.body, { ok: true, challengeId, expiresAt: '2026-11-01T00:05:00Z', retryAfter: 60 });
  const sms = calls[1].body.message; assert.equal(sms.to, '01012345678'); assert.equal(sms.type, 'SMS');
  const code = /인증번호: (\d{6})/.exec(sms.text)[1];
  assert.equal(calls[0].body.p_otp_hash, createHmac('sha256', ENV.CUSTOMER_INTAKE_OTP_SECRET).update(`${challengeId}:${code}`).digest('hex'));
  assert.equal(calls[0].body.p_token_hash, hash(TOKEN));
  assert.equal(Object.hasOwn(calls[0].body, 'code'), false); assert.equal(Object.hasOwn(result.body, 'code'), false);
  assert.equal(JSON.stringify(result.body).includes('01012345678'), false);
});

test('failed/uncertain OTPs are invalidated; provider or delivery-ack failure cannot return a usable challenge', async t => {
  for (const kind of ['rejected', 'uncertain', 'ack-lost']) {
    const calls = mock(t, call => {
      if (call.url.endsWith('/snote_intake_challenge')) return response({ ok: true, id: ID, phone: '01012345678', challengeId: call.body.p_challenge_id });
      if (call.url.startsWith('https://api.solapi.com/')) { if (kind === 'uncertain') throw new Error('timeout'); return response({ statusCode: kind === 'rejected' ? '3000' : '2000', messageId: 'M4V_test_message' }); }
      if (call.url.endsWith('/snote_intake_delivery')) { if (kind === 'ack-lost' && call.body.p_status === 'sent') throw new Error('ack lost'); return response({ ok: true }); }
      throw new Error('unexpected request');
    });
    const result = await call({ action: 'send-code', token: TOKEN });
    assert.equal(result.body.code, kind === 'rejected' ? 'SMS_SEND_FAILED' : 'SMS_SEND_UNKNOWN');
    assert.equal(Object.hasOwn(result.body, 'challengeId'), false);
    assert.equal(calls.at(-1).body.p_status, kind === 'rejected' ? 'failed' : 'unknown');
    assert.equal(calls.filter(x => x.url.startsWith('https://api.solapi.com/')).length, 1);
  }
});

test('invalid, expired and mismatched links, wrong OTP, lockout and rate limit are delegated and sanitized', async t => {
  for (const [action, code, status] of [['info', 'EXPIRED', 410], ['info', 'INVALID_LINK', 404], ['verify', 'INVALID_CODE', 400], ['verify', 'LOCKED', 423], ['send-code', 'RATE_LIMITED', 429], ['submit', 'SESSION_EXPIRED', 401]]) {
    const calls = mock(t, () => response({ ok: false, code, message: 'private 01012345678 address account token', retryAfter: 60 }));
    const body = action === 'submit' ? submit() : { action, token: TOKEN, ...(action === 'verify' ? { challengeId: ID, code: '123456' } : {}) };
    const result = await call(body); assert.equal(result.result.status, status); assert.equal(result.body.code, code);
    assert.equal(JSON.stringify(result.body).includes('01012345678'), false);
    assert.equal(calls.length, 1);
    if (code === 'RATE_LIMITED') { assert.equal(result.body.retryAfter, 60); assert.equal(result.result.headers.get('Retry-After'), '60'); }
  }
});

test('verification hashes the session and binds OTP to challenge; no session on failed verification', async t => {
  const calls = mock(t, () => response({ ok: true, sessionExpiresAt: '2026-11-01T00:30:00Z', privatePhone: '01012345678' }));
  const result = await call({ action: 'verify', token: TOKEN, challengeId: ID, code: '123456' });
  assert.match(result.body.session, /^[a-f0-9]{64}$/); assert.equal(calls[0].body.p_session_hash, hash(result.body.session));
  assert.equal(calls[0].body.p_otp_hash, createHmac('sha256', ENV.CUSTOMER_INTAKE_OTP_SECRET).update(`${ID}:123456`).digest('hex'));
  assert.deepEqual(Object.keys(result.body).sort(), ['ok', 'session', 'sessionExpiresAt']);
});

test('submitted public view has no personal data; dealer list strips internal and sensitive fields', async t => {
  mock(t, call => call.url.endsWith('/snote_intake_view')
    ? response({ ok: true, status: 'submitted', expiresAt: '2026-11-02', phone: '01012345678', submission: { name: 'private' } })
    : response([{ id: ID, submittedAt: '2026-11-01', phone: '01012345678', token_hash: 'secret', otp_hash: 'secret', submission: { name: '테스트', phone: '01012345678', refundConsent: true, rrn: 'secret', password: 'secret' } }]));
  assert.deepEqual((await call({ action: 'info', token: TOKEN })).body, { ok: true, status: 'submitted', expiresAt: '2026-11-02' });
  const result = await call({ action: 'list', carId: 'car-1' }, { authorization: `Bearer ${JWT}` });
  assert.equal(JSON.stringify(result.body).includes('secret'), false); assert.equal(result.body.requests[0].submission.refundConsent, true);
});

test('submit rejects browser verification, sensitive fields, invalid addresses, partial refund and missing optional consent', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const cases = [
    submit({ verified: true }), submit({ consent: false }), submit({ vehicleConfirmed: false }),
    submit({ customer: { ...submit().customer, residentNumber: 'sensitive' } }),
    submit({ customer: { ...submit().customer, phone: '01012345678' } }),
    submit({ customer: { ...submit().customer, name: '가' } }),
    submit({ customer: { ...submit().customer, addressBase: '가'.repeat(200), addressDetail: '나'.repeat(30) } }),
    submit({ customer: { ...submit().customer, refundBank: '은행' } }),
    submit({ refundConsent: true }),
    submit({ customer: { ...submit().customer, sameAddress: false, mailingBase: '', mailingDetail: '101호' } }),
    submit({ customer: { ...submit().customer, refundBank: '은행', refundAccount: '123-456789', refundHolder: '테스트' } }),
    submit({ refundConsent: true, customer: { ...submit().customer, refundBank: '은행', refundAccount: '------', refundHolder: '테스트' } })
  ];
  for (const body of cases) assert.equal((await call(body)).result.status, 400);
  assert.equal((await call(submit({ session: 'invalid' }))).body.code, 'SESSION_EXPIRED');
  assert.equal((await call({ action: 'info', token: 'invalid' })).body.code, 'INVALID_LINK');
  assert.equal(calls.length, 0);
});

test('mailing address is optional when sameAddress is false, and an optional base may have a detail', async t => {
  const calls = mock(t, () => response({ ok: true, submittedAt: '2026-11-01T00:00:00Z' }));
  for (const [mailingBase, mailingDetail] of [['', ''], ['서울시 우편로 2', '202호']]) {
    const result = await call(submit({ customer: { ...submit().customer, sameAddress: false, mailingBase, mailingDetail } }));
    assert.equal(result.result.status, 200);
    assert.equal(calls.at(-1).body.p_customer.mailingBase, mailingBase);
    assert.equal(calls.at(-1).body.p_customer.mailingDetail, mailingDetail);
    assert.equal(calls.at(-1).body.p_customer.refundConsent, false);
  }
});

test('submit is durable-only, derives phone server-side, forwards separate refund consent, and permits same-session retry', async t => {
  let count = 0;
  const calls = mock(t, () => { count++; if (count === 1) throw new Error('commit acknowledgement unknown'); return response({ ok: true, submittedAt: '2026-11-01T00:00:00Z', alreadySubmitted: true, payload: { name: 'private' } }); });
  const body = submit({ refundConsent: true, customer: { ...submit().customer, refundBank: '은행', refundAccount: '123 - 456789', refundHolder: '테스트' } });
  const failed = await call(body); assert.equal(failed.result.status, 502); assert.equal(failed.body.ok, undefined);
  const retry = await call(body); assert.deepEqual(retry.body, { ok: true, submittedAt: '2026-11-01T00:00:00Z', alreadySubmitted: true });
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[0].body.p_token_hash, hash(TOKEN)); assert.equal(calls[0].body.p_session_hash, hash(SESSION));
  assert.equal(calls[0].body.p_consent_version, '2026-11-01');
  assert.equal(calls[0].body.p_customer.refundConsent, true); assert.equal(calls[0].body.p_customer.refundAccount, '123-456789');
  assert.equal(calls[0].body.p_customer.mailingBase, body.customer.addressBase);
  assert.equal(Object.hasOwn(calls[0].body.p_customer, 'phone'), false);
  assert.equal(calls.length, 2);
});
