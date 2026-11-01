import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
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
const RRN_KEY = 'c'.repeat(64), TEST_RRN = '9001011234567';
const RRN_ENV = { ...ENV, CUSTOMER_INTAKE_RRN_KEY: RRN_KEY };
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
    configurationIssues: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CUSTOMER_INTAKE_PUBLIC_ORIGIN', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_SENDER', 'CUSTOMER_INTAKE_OTP_SECRET'].map(name => ({ name, reason: '값이 설정되지 않았습니다.' })),
    rrnConfigured: false, rrnConfigurationIssues: [{ name: 'CUSTOMER_INTAKE_OTP_SECRET', reason: '기본 서버 키 설정을 확인해야 주민번호 암호화를 사용할 수 있습니다.' }], rrnKeyMode: null, flowVersion: 'wizard-v1'
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
  assert.deepEqual(valid.body, { service: 'snote-customer-intake', configured: true, configurationIssues: [], originMatches: true, rrnConfigured: true, rrnConfigurationIssues: [{ name: 'CUSTOMER_INTAKE_RRN_KEY', reason: '별도 암호화 키 없이 기본 서버 키에서 분리한 암호화 키로 보관합니다.' }], rrnKeyMode: 'derived', flowVersion: 'wizard-v1' });
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
  mock(t, call => /\/snote_intake_view(?:_v2)?$/.test(call.url)
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

function rrnEnvelope(digits = TEST_RRN, tokenHash = hash(TOKEN), key = RRN_KEY) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(`snote-intake-rrn:v1:${tokenHash}`));
  const encrypted = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('hex')}.${encrypted.toString('hex')}`;
}

test('absent or invalid optional RRN key derives encryption from the existing server key and never blocks basic intake', async t => {
  const calls = mock(t, () => response({ ok: true, submittedAt: '2026-11-01T00:00:00Z' }));
  for (const key of [undefined, '', 'private-invalid-key', 'f'.repeat(63), 'g'.repeat(64), 'f'.repeat(65)]) {
    const env = { ...ENV, CUSTOMER_INTAKE_RRN_KEY: key };
    const metadata = await call(undefined, { method: 'GET', env });
    assert.equal(metadata.body.configured, true); assert.equal(metadata.body.rrnConfigured, true); assert.equal(metadata.body.rrnKeyMode, 'derived');
    assert.equal(metadata.body.rrnConfigurationIssues.length, 1);
    assert.equal(metadata.body.rrnConfigurationIssues[0].name, 'CUSTOMER_INTAKE_RRN_KEY');
    if (key) assert.equal(JSON.stringify(metadata.body).includes(key), false);
    const basic = await call(submit(), { env }); assert.equal(basic.result.status, 200);
    assert.ok(calls.at(-1).url.endsWith('/snote_intake_submit'));
    const sensitive = await call(submit({ rrn: TEST_RRN, rrnNoticeAccepted: true }), { env });
    assert.equal(sensitive.result.status, 200);
    assert.ok(calls.at(-1).url.endsWith('/snote_intake_submit_v2'));
    assert.match(calls.at(-1).body.p_rrn_cipher, /^v1\.[a-f0-9]{24}\.[a-f0-9]{58}$/);
  }
  const ready = await call(undefined, { method: 'GET', env: RRN_ENV });
  assert.equal(ready.body.rrnConfigured, true); assert.deepEqual(ready.body.rrnConfigurationIssues, []);
  assert.equal(ready.body.rrnKeyMode, 'dedicated');
  assert.equal(JSON.stringify(ready.body).includes(RRN_KEY), false);
});

test('RRN validation requires real birth date, ASCII digits and explicit notice without adding RRN to customer JSON', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const inputs = [
    { rrn: TEST_RRN }, { rrn: TEST_RRN, rrnNoticeAccepted: false },
    { rrn: TEST_RRN, rrnNoticeAccepted: 'true' }, { rrn: 9001011234567, rrnNoticeAccepted: true },
    { rrn: '9002301234567', rrnNoticeAccepted: true }, { rrn: '9001019234567', rrnNoticeAccepted: true },
    { rrn: '9912313234567', rrnNoticeAccepted: true }, { rrn: '９００１０１１２３４５６７', rrnNoticeAccepted: true },
    { rrn: '900101 1234567', rrnNoticeAccepted: true },
    { customer: { ...submit().customer, rrn: TEST_RRN } }
  ];
  for (const input of inputs) {
    const result = await call(submit(input), { env: RRN_ENV });
    assert.equal(result.result.status, 400); assert.equal(result.body.code, 'VALIDATION_ERROR');
    assert.equal(JSON.stringify(result.body).includes(TEST_RRN), false);
  }
  assert.equal(calls.length, 0);
});

test('RRN submission encrypts independently with random IV and row-bound AAD; plaintext never enters DB payload or response', async t => {
  const calls = mock(t, () => response({ ok: true, submittedAt: '2026-11-01T00:00:00Z' }));
  for (let n = 0; n < 2; n++) {
    const result = await call(submit({ rrn: '900101-1234567', rrnNoticeAccepted: true }), { env: RRN_ENV });
    assert.equal(result.result.status, 200); assert.equal(JSON.stringify(result.body).includes(TEST_RRN), false);
    const sent = calls.at(-1);
    assert.ok(sent.url.endsWith('/snote_intake_submit_v2'));
    assert.equal(sent.body.p_rrn_notice_version, '2026-11-01-r1');
    assert.equal(sent.body.p_consent_version, '2026-11-01');
    assert.match(sent.body.p_rrn_cipher, /^v1\.[a-f0-9]{24}\.[a-f0-9]{58}$/);
    assert.equal(JSON.stringify(sent.body).includes(TEST_RRN), false);
    assert.equal(Object.hasOwn(sent.body.p_customer, 'rrn'), false);
    const [, ivHex, cipherHex] = sent.body.p_rrn_cipher.split('.');
    const encrypted = Buffer.from(cipherHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(RRN_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAAD(Buffer.from(`snote-intake-rrn:v1:${hash(TOKEN)}`));
    decipher.setAuthTag(encrypted.subarray(-16));
    assert.equal(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'), TEST_RRN);
  }
  assert.notEqual(calls[0].body.p_rrn_cipher, calls[1].body.p_rrn_cipher);
});

test('RRN company policy denials and missing v2 SQL never turn into a fake successful or unencrypted submission', async t => {
  for (const setupMissing of [false, true]) {
    const calls = mock(t, () => setupMissing ? response({ code: 'PGRST202', message: TEST_RRN }, 404) : response({ ok: false, code: 'RRN_NOT_AVAILABLE', message: TEST_RRN }));
    const result = await call(submit({ rrn: TEST_RRN, rrnNoticeAccepted: true }), { env: RRN_ENV });
    assert.equal(result.body.code, setupMissing ? 'DB_SETUP_REQUIRED' : 'RRN_NOT_AVAILABLE');
    assert.equal(result.result.status, setupMissing ? 503 : 403);
    assert.equal(JSON.stringify(result.body).includes(TEST_RRN), false);
    assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith('/snote_intake_submit_v2'));
  }
});

test('info enables RRN only with both valid encryption key and authoritative DB policy, with legacy SQL fallback', async t => {
  const info = { ok: true, status: 'pending', car: CAR, companyName: '상사', phoneMasked: '010-****-5678', rrnEnabled: true };
  let v2Missing = false;
  const calls = mock(t, call => call.url.endsWith('/snote_intake_view_v2') && v2Missing ? response({ code: 'PGRST202', message: 'not installed' }, 404) : response(info));
  const derived = await call({ action: 'info', token: TOKEN });
  assert.equal(derived.body.rrnEnabled, true); assert.ok(calls.at(-1).url.endsWith('/snote_intake_view_v2'));
  const enabled = await call({ action: 'info', token: TOKEN }, { env: RRN_ENV });
  assert.equal(enabled.body.rrnEnabled, true); assert.ok(calls.at(-1).url.endsWith('/snote_intake_view_v2'));
  info.rrnEnabled = false;
  assert.equal((await call({ action: 'info', token: TOKEN })).body.rrnEnabled, false);
  info.rrnEnabled = true;
  v2Missing = true;
  const fallback = await call({ action: 'info', token: TOKEN }, { env: RRN_ENV });
  assert.equal(fallback.body.rrnEnabled, false);
  assert.ok(calls.at(-2).url.endsWith('/snote_intake_view_v2')); assert.ok(calls.at(-1).url.endsWith('/snote_intake_view'));
});

test('read-rrn requires dealer JWT and valid key, checks returned row, and rejects tampering or cross-row ciphertext', async t => {
  let data = { ok: true, id: ID, tokenHash: hash(TOKEN), rrnCipher: rrnEnvelope() };
  const calls = mock(t, call => call.url.endsWith('/snote_intake_details_v3') ? response({ ok: true, id: ID, source: 'legacy' }) : response(data));
  assert.equal((await call({ action: 'read-rrn', id: ID }, { env: RRN_ENV })).result.status, 401);
  assert.equal((await call({ action: 'read-rrn', id: ID }, { env: { ...ENV, CUSTOMER_INTAKE_OTP_SECRET: '' }, authorization: `Bearer ${JWT}` })).body.code, 'SERVICE_UNAVAILABLE');
  assert.equal(calls.length, 0);
  const read = () => call({ action: 'read-rrn', id: ID }, { env: RRN_ENV, authorization: `Bearer ${JWT}` });
  const success = await read(); assert.deepEqual(success.body, { ok: true, rrn: TEST_RRN });
  assert.match(success.result.headers.get('Cache-Control'), /no-store/);
  assert.ok(calls.at(-1).url.endsWith('/snote_intake_rrn_access'));
  assert.deepEqual(calls.at(-1).body, { p_id: ID }); assert.equal(calls.at(-1).options.headers.Authorization, `Bearer ${JWT}`);
  for (const changed of [
    { ...data, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { ...data, tokenHash: hash('different-row') },
    { ...data, rrnCipher: data.rrnCipher.slice(0, -1) + (data.rrnCipher.endsWith('0') ? '1' : '0') },
    { ...data, rrnCipher: rrnEnvelope(TEST_RRN, hash(TOKEN), 'd'.repeat(64)) },
    { ok: false, code: 'RRN_NOT_AVAILABLE', message: TEST_RRN }
  ]) {
    data = changed;
    const failure = await read(); assert.equal(failure.result.status, 403); assert.equal(failure.body.code, 'RRN_NOT_AVAILABLE');
    assert.equal(JSON.stringify(failure.body).includes(TEST_RRN), false); assert.equal(Object.hasOwn(failure.body, 'rrn'), false);
  }
});

test('dealer list exposes only DB-approved hasRrn and never ciphertext or plaintext from RPC fields', async t => {
  const cipher = rrnEnvelope();
  mock(t, () => response([{ id: ID, submittedAt: '2026-11-01', hasRrn: true, rrnCipher: cipher, rrn: TEST_RRN, submission: { name: '테스트', rrn: TEST_RRN, rrnCipher: cipher } }]));
  for (const env of [ENV, RRN_ENV]) {
    const result = await call({ action: 'list', carId: 'car-1' }, { env, authorization: `Bearer ${JWT}` });
    assert.equal(result.body.requests[0].hasRrn, true);
    assert.equal(JSON.stringify(result.body).includes(TEST_RRN), false); assert.equal(JSON.stringify(result.body).includes(cipher), false);
  }
});

test('HKDF key is deterministic and domain-separated; derived records remain readable after adding a dedicated key', async t => {
  const derived = Buffer.from(hkdfSync('sha256', Buffer.from(ENV.CUSTOMER_INTAKE_OTP_SECRET), Buffer.from('snote-customer-intake:rrn:v1:hkdf-salt'), Buffer.from('snote-customer-intake:rrn:v1:aes-256-gcm'), 32));
  assert.equal(derived.length, 32);
  assert.notEqual(derived.toString('hex'), Buffer.from(ENV.CUSTOMER_INTAKE_OTP_SECRET).subarray(0, 32).toString('hex'));
  assert.notEqual(derived.toString('hex'), hash(ENV.CUSTOMER_INTAKE_OTP_SECRET));
  let storedCipher;
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_submit_v2')) { storedCipher = call.body.p_rrn_cipher; return response({ ok: true, submittedAt: '2026-11-01T00:00:00Z' }); }
    if (call.url.endsWith('/snote_intake_rrn_access')) return response({ ok: true, id: ID, tokenHash: hash(TOKEN), rrnCipher: storedCipher });
    if (call.url.endsWith('/snote_intake_details_v3')) return response({ code: 'PGRST202' }, 404);
    throw new Error('unexpected request');
  });
  const encrypted = [];
  for (let i = 0; i < 2; i++) {
    assert.equal((await call(submit({ rrn: TEST_RRN, rrnNoticeAccepted: true }))).result.status, 200);
    encrypted.push(storedCipher);
    const [, iv, ciphertext] = storedCipher.split('.'); const bytes = Buffer.from(ciphertext, 'hex');
    const decrypt = createDecipheriv('aes-256-gcm', derived, Buffer.from(iv, 'hex'));
    decrypt.setAAD(Buffer.from(`snote-intake-rrn:v1:${hash(TOKEN)}`)); decrypt.setAuthTag(bytes.subarray(-16));
    assert.equal(Buffer.concat([decrypt.update(bytes.subarray(0, -16)), decrypt.final()]).toString('utf8'), TEST_RRN);
    assert.equal(JSON.stringify(calls.at(-1).body).includes(TEST_RRN), false);
  }
  assert.notEqual(encrypted[0], encrypted[1]);
  const read = env => call({ action: 'read-rrn', id: ID }, { env, authorization: `Bearer ${JWT}` });
  for (const env of [ENV, RRN_ENV, { ...ENV, CUSTOMER_INTAKE_RRN_KEY: 'invalid-optional-key' }]) {
    assert.deepEqual((await read(env)).body, { ok: true, rrn: TEST_RRN });
  }
  const changed = await read({ ...ENV, CUSTOMER_INTAKE_OTP_SECRET: 'different-test-only-otp-secret-at-least-32-characters' });
  assert.equal(changed.body.code, 'RRN_NOT_AVAILABLE'); assert.equal(Object.hasOwn(changed.body, 'rrn'), false);
  assert.equal(JSON.stringify(changed.body).includes(TEST_RRN), false);
});

test('existing dedicated-key records survive OTP key changes but missing basic OTP setup stays fail-closed', async t => {
  const calls = mock(t, call => call.url.endsWith('/snote_intake_details_v3') ? response({ ok: true, id: ID, source: 'legacy' }) : response({ ok: true, id: ID, tokenHash: hash(TOKEN), rrnCipher: rrnEnvelope() }));
  const env = { ...RRN_ENV, CUSTOMER_INTAKE_OTP_SECRET: 'changed-test-only-otp-secret-at-least-32-characters' };
  const success = await call({ action: 'read-rrn', id: ID }, { env, authorization: `Bearer ${JWT}` });
  assert.deepEqual(success.body, { ok: true, rrn: TEST_RRN });
  const before = calls.length;
  for (const secret of [undefined, '', 'too-short', 'first-line\nsecond-line-long-private-test-secret']) {
    const failed = await call(submit({ rrn: TEST_RRN, rrnNoticeAccepted: true }), { env: { ...RRN_ENV, CUSTOMER_INTAKE_OTP_SECRET: secret } });
    assert.equal(failed.result.status, 503); assert.equal(failed.body.code, 'SERVICE_UNAVAILABLE');
  }
  assert.equal(calls.length, before);
});

const FLOW = 'wizard-v1';
const OWNER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const CONTEXT = { ok: true, companyId: COMPANY, ownerId: OWNER, carId: 'car-1', phone: '01012345678' };
const SIGNATURE = { version: 1, strokes: [[[0.123456, 0.234567], [0.8, 0.7]]] };
const NORMAL_SIGNATURE = { version: 1, strokes: [[[0.1235, 0.2346], [0.8, 0.7]]] };
function wizardSubmit(overrides = {}) {
  return submit({ flowVersion: FLOW, rrn: TEST_RRN, rrnNoticeAccepted: true, signature: SIGNATURE, customer: { ...submit().customer, phone: CONTEXT.phone }, ...overrides });
}

test('wizard info requires v3 SQL and never falls back to a legacy signatureless flow', async t => {
  let installed = false;
  const calls = mock(t, () => installed ? response({ ok: true, car: CAR, status: 'pending', companyName: '상사', phoneMasked: '010-****-5678', expiresAt: '2026-11-02', rrnEnabled: true, rrn_enabled: false, flowVersion: FLOW }) : response({ code: 'PGRST202', message: 'private SQL' }, 404));
  const missing = await call({ action: 'info', token: TOKEN, flowVersion: FLOW });
  assert.equal(missing.body.code, 'DB_SETUP_REQUIRED'); assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/snote_intake_view_v3'));
  installed = true;
  const info = await call({ action: 'info', token: TOKEN, flowVersion: FLOW });
  assert.equal(info.body.flowVersion, FLOW); assert.equal(info.body.rrnEnabled, true);
  assert.equal(Object.hasOwn(info.body, 'phone'), false); assert.equal(JSON.stringify(info.body).includes(CONTEXT.phone), false);
  const before = calls.length;
  assert.equal((await call({ action: 'info', token: TOKEN, flowVersion: 'unknown-version' })).result.status, 400);
  assert.equal((await call({ action: 'create', carId: 'car-1', phone: CONTEXT.phone, flowVersion: FLOW }, { authorization: `Bearer ${JWT}` })).result.status, 400);
  assert.equal(calls.length, before);
});

test('wizard phone challenge validates the supplied phone in DB before sending only to the bound recipient', async t => {
  let allowed = false;
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_challenge_v3')) return allowed ? response({ ok: true, id: ID, phone: CONTEXT.phone, challengeId: call.body.p_challenge_id, expiresAt: '2026-11-01T00:05:00Z' }) : response({ ok: false, code: 'VALIDATION_ERROR', message: CONTEXT.phone });
    if (call.url.startsWith('https://api.solapi.com/')) return response({ statusCode: '2000', messageId: 'M4V_test_message' });
    if (call.url.endsWith('/snote_intake_delivery')) return response({ ok: true });
    throw new Error('unexpected request');
  });
  const rejected = await call({ action: 'send-code', token: TOKEN, flowVersion: FLOW, phone: '01099998888' });
  assert.equal(rejected.result.status, 400); assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(rejected.body).includes(CONTEXT.phone), false);
  allowed = true;
  const accepted = await call({ action: 'send-code', token: TOKEN, flowVersion: FLOW, phone: '+82 10-1234-5678' });
  assert.equal(accepted.result.status, 200); assert.equal(calls[1].body.p_phone, CONTEXT.phone);
  assert.equal(calls[2].body.message.to, CONTEXT.phone);
  assert.equal(Object.hasOwn(accepted.body, 'phone'), false); assert.equal(Object.hasOwn(accepted.body, 'code'), false);
});

test('wizard verification returns the full server phone only after OTP and verified session context succeed', async t => {
  let mode = 'wrong';
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_verify')) return mode === 'wrong' ? response({ ok: false, code: 'INVALID_CODE' }) : response({ ok: true, sessionExpiresAt: '2026-11-01T00:30:00Z' });
    if (call.url.endsWith('/snote_intake_submit_context_v3')) return mode === 'missing' ? response({ code: 'PGRST202' }, 404) : response(CONTEXT);
    throw new Error('unexpected request');
  });
  const body = { action: 'verify', token: TOKEN, flowVersion: FLOW, challengeId: ID, code: '123456' };
  assert.equal((await call(body)).body.code, 'INVALID_CODE'); assert.equal(calls.length, 1);
  mode = 'missing';
  const missing = await call(body); assert.equal(missing.body.code, 'DB_SETUP_REQUIRED'); assert.equal(Object.hasOwn(missing.body, 'session'), false); assert.equal(Object.hasOwn(missing.body, 'phone'), false);
  mode = 'valid';
  const valid = await call(body);
  assert.equal(valid.body.phone, CONTEXT.phone); assert.equal(valid.body.flowVersion, FLOW);
  assert.equal(calls.at(-1).body.p_session_hash, hash(valid.body.session));
  for (const privateField of ['companyId', 'ownerId', 'carId']) assert.equal(Object.hasOwn(valid.body, privateField), false);
});

test('wizard final submission uses verified context, normalized signature and one atomic v3 save with smi1 ciphertext', async t => {
  const calls = mock(t, call => call.url.endsWith('/snote_intake_submit_context_v3') ? response(CONTEXT) : response({ ok: true, submittedAt: '2026-11-01T00:00:00Z', canonicalApplied: true }));
  const submitted = await call(wizardSubmit());
  assert.deepEqual(submitted.body, { ok: true, submittedAt: '2026-11-01T00:00:00Z', canonicalApplied: true });
  assert.equal(calls.length, 2); assert.ok(calls[1].url.endsWith('/snote_intake_submit_v3'));
  const args = calls[1].body;
  assert.deepEqual(Object.keys(args).sort(), ['p_token_hash', 'p_session_hash', 'p_customer', 'p_consent_version', 'p_identity_cipher', 'p_signature'].sort());
  assert.deepEqual(args.p_signature, NORMAL_SIGNATURE); assert.equal(args.p_customer.phone, CONTEXT.phone);
  assert.equal(args.p_consent_version, '2026-11-01'); assert.equal(args.p_token_hash, hash(TOKEN)); assert.equal(args.p_session_hash, hash(SESSION));
  assert.match(args.p_identity_cipher, /^smi1\.[a-f0-9]{24}\.[a-f0-9]{58}$/);
  assert.equal(JSON.stringify(args).includes(TEST_RRN), false); assert.equal(Object.hasOwn(args.p_customer, 'identityCipher'), false);
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(ENV.CUSTOMER_INTAKE_OTP_SECRET), Buffer.from('snote-customer-intake:rrn:v1:hkdf-salt'), Buffer.from('snote-customer-intake:rrn:v1:aes-256-gcm'), 32));
  const [, iv, encrypted] = args.p_identity_cipher.split('.'); const bytes = Buffer.from(encrypted, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAAD(Buffer.from('snote-manual-identity:v1:' + JSON.stringify([COMPANY, OWNER, 'car-1']))); decipher.setAuthTag(bytes.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString(), TEST_RRN);
});

test('wizard signatures reject unknown formats, excessive points and insufficient ink before any DB call', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const invalid = [undefined, '<svg>private</svg>', { version: 1, strokes: [], image: 'data:private' }, { version: 1, strokes: [] },
    { version: 1, strokes: [[]] }, { version: '1', strokes: [[[0, 0], [1, 1]]] },
    { version: 1, strokes: [[[0, 0], [0.1, '0.2']]] }, { version: 1, strokes: [[[0, 0], [0.1, 0.2, 0.3]]] },
    { version: 1, strokes: [[[0, 0], [1.1, 0.2]]] }, { version: 1, strokes: [[[0, 0], [NaN, 0.2]]] },
    { version: 1, strokes: [[[0.3, 0.1], [0.305, 0.1]]] }, { version: 1, strokes: [[[0.1, 0.1], [0.1, 0.1]]] },
    { version: 1, strokes: [Array.from({ length: 257 }, (_, i) => [i / 300, 0.2])] },
    { version: 1, strokes: Array.from({ length: 25 }, () => [[0, 0], [1, 1]]) },
    { version: 1, strokes: Array.from({ length: 6 }, () => Array.from({ length: 201 }, (_, i) => [i / 250, 0.2])) }
  ];
  for (const input of invalid) {
    const result = await call(wizardSubmit({ signature: input }));
    assert.equal(result.result.status, 400); assert.equal(result.body.code, 'VALIDATION_ERROR');
  }
  for (const change of [{ rrn: '' }, { rrnNoticeAccepted: false }, { customer: { ...submit().customer } }]) assert.equal((await call(wizardSubmit(change))).result.status, 400);
  assert.equal(calls.length, 0);
});

test('wizard rejects phone/context mismatch and setup failures without any legacy or signatureless save', async t => {
  let mode = 'mismatch';
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_submit_context_v3')) return mode === 'context-missing' ? response({ code: 'PGRST202' }, 404) : response({ ...CONTEXT, phone: mode === 'mismatch' ? '01099998888' : CONTEXT.phone });
    if (call.url.endsWith('/snote_intake_submit_v3')) return response({ code: 'PGRST202', message: 'private SQL' }, 404);
    throw new Error('legacy save must never run');
  });
  assert.equal((await call(wizardSubmit())).body.code, 'VALIDATION_ERROR'); assert.equal(calls.length, 1);
  mode = 'context-missing'; assert.equal((await call(wizardSubmit())).body.code, 'DB_SETUP_REQUIRED');
  mode = 'submit-missing'; assert.equal((await call(wizardSubmit())).body.code, 'DB_SETUP_REQUIRED');
  assert.ok(calls.every(call => call.url.endsWith('/snote_intake_submit_context_v3') || call.url.endsWith('/snote_intake_submit_v3')));
});

test('wizard accepts bounded signature JSON above legacy size and preserves exact-payload retry semantics', async t => {
  let first = true;
  const calls = mock(t, call => {
    if (call.url.endsWith('/snote_intake_submit_context_v3')) return response(CONTEXT);
    if (first) { first = false; throw new Error('commit response lost'); }
    return response({ ok: true, submittedAt: '2026-11-01T00:00:00Z', canonicalApplied: false, alreadySubmitted: true });
  });
  const raw = JSON.stringify(wizardSubmit()) + ' '.repeat(20 * 1024);
  const failed = await call(null, { raw }); assert.equal(failed.body.code, 'UPSTREAM_ERROR');
  const retry = await call(null, { raw }); assert.deepEqual(retry.body, { ok: true, submittedAt: '2026-11-01T00:00:00Z', alreadySubmitted: true, canonicalApplied: false });
  assert.deepEqual(calls[1].body.p_signature, calls[3].body.p_signature); assert.equal(calls[1].body.p_session_hash, calls[3].body.p_session_hash);
  const before = calls.length;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(wizardSubmit()) + ' '.repeat(65 * 1024))); controller.close(); } });
  assert.equal((await call(null, { requestBody: stream })).result.status, 413); assert.equal(calls.length, before);
});

test('dealer list returns signature metadata but strips every ciphertext and private binding', async t => {
  mock(t, () => response([{ id: ID, submittedAt: '2026-11-01', hasRrn: true, hasSignature: true, canonicalApplied: true, submission: { name: '테스트', phone: CONTEXT.phone, signature: SIGNATURE, signedAt: '2026-11-01T00:00:00Z', flowVersion: FLOW, identityCipher: 'private-cipher', rrn: TEST_RRN, tokenHash: TOKEN, ownerId: OWNER } }]));
  const result = await call({ action: 'list', carId: 'car-1' }, { authorization: `Bearer ${JWT}` });
  const item = result.body.requests[0];
  assert.equal(item.hasRrn, true); assert.equal(item.hasSignature, true); assert.equal(item.canonicalApplied, true);
  assert.deepEqual(item.submission.signature, NORMAL_SIGNATURE); assert.equal(item.submission.flowVersion, FLOW);
  assert.equal(item.submission.signedAt, '2026-11-01T00:00:00Z');
  for (const privateValue of ['private-cipher', TEST_RRN, TOKEN, OWNER]) assert.equal(JSON.stringify(result.body).includes(privateValue), false);
});

test('new intake identity decrypts from authoritative details and never falls back after a new-cipher error', async t => {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(ENV.CUSTOMER_INTAKE_OTP_SECRET), Buffer.from('snote-customer-intake:rrn:v1:hkdf-salt'), Buffer.from('snote-customer-intake:rrn:v1:aes-256-gcm'), 32));
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('snote-manual-identity:v1:' + JSON.stringify([COMPANY, OWNER, 'car-1'])));
  const encrypted = Buffer.concat([cipher.update(TEST_RRN), cipher.final(), cipher.getAuthTag()]);
  let details = { ok: true, id: ID, companyId: COMPANY, ownerId: OWNER, carId: 'car-1', identityCipher: `smi1.${iv.toString('hex')}.${encrypted.toString('hex')}` };
  const original = details;
  const calls = mock(t, call => { assert.ok(call.url.endsWith('/snote_intake_details_v3')); return response(details); });
  const read = () => call({ action: 'read-rrn', id: ID }, { authorization: `Bearer ${JWT}` });
  assert.deepEqual((await read()).body, { ok: true, rrn: TEST_RRN });
  for (const tampered of [{ ...original, ownerId: COMPANY }, { ...original, carId: 'other-car' }, { ...original, identityCipher: 'corrupt', source: 'legacy' }, { ...original, identityCipher: null, source: 'legacy' }]) {
    details = tampered;
    const result = await read(); assert.equal(result.body.code, 'RRN_NOT_AVAILABLE'); assert.equal(Object.hasOwn(result.body, 'rrn'), false);
  }
  assert.equal(calls.length, 5);
});
