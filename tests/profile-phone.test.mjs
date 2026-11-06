import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequest } from '../functions/api/profile-phone.js';

// All Auth, database and SMS HTTP is intercepted; no real message may be sent.
const ACTOR = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHALLENGE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const ENV = { SUPABASE_URL: 'https://profile-phone-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', SOLAPI_API_KEY: 'test-solapi-key', SOLAPI_API_SECRET: 'test-solapi-secret', SOLAPI_SENDER: '02-1234-5678', CUSTOMER_INTAKE_OTP_SECRET: 'test-only-shared-otp-secret-at-least-32-characters' };
const PREVIOUS = { user_id: ACTOR, company_id: COMPANY, display_name: '합성 딜러', company_name: '합성 상사', revision: 1, phone: '01011112222' };
const PROFILE = { ...PREVIOUS, phone: '01099998888', revision: 2, role: 'dealer', address: '합성 상사 주소' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sendBody = overrides => ({ action: 'send-code', companyId: COMPANY, phone: '010-9999-8888', expected: PREVIOUS, requestId: CHALLENGE, ...overrides });
const verifyBody = overrides => ({ action: 'verify', companyId: COMPANY, phone: '01099998888', challengeId: CHALLENGE, code: '000042', ...overrides });
function digest(code, { actor = ACTOR, company = COMPANY, challenge = CHALLENGE, phone = '01099998888' } = {}) { return createHmac('sha256', ENV.CUSTOMER_INTAKE_OTP_SECRET).update(`snote-profile-phone:v1:${actor}:${company}:${challenge}:${phone}:${code}`).digest('hex'); }

function fixture(t, patch = {}) {
  const original = globalThis.fetch;
  const state = { calls: [], messages: [], deliveries: [], hashes: [], user: { id: ACTOR }, member: { user_id: ACTOR, company_id: COMPANY, role: 'dealer', active: true }, profile: PROFILE, ...patch };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), body = options.body === undefined ? undefined : JSON.parse(options.body), call = { url, options, body };
    state.calls.push(call); assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
    if (state.override) { const custom = await state.override(call); if (custom) return custom; }
    if (url.origin === 'https://api.solapi.com') {
      assert.equal(url.pathname, '/messages/v4/send'); assert.match(options.headers.Authorization, /^HMAC-SHA256 apiKey=test-solapi-key,/);
      assert(!options.headers.Authorization.includes(ENV.SOLAPI_API_SECRET)); assert(!JSON.stringify(body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
      state.messages.push(body.message);
      if (state.providerThrow) throw Error('synthetic lost chargeable reply');
      if (state.providerRedirect) return new Response(null, { status: 302, headers: { Location: 'https://private-redirect.invalid/steal' } });
      return reply(state.providerBody || { statusCode: '2000', messageId: 'SMS_SYNTHETIC_1234' }, state.providerStatus || 200);
    }
    assert.equal(url.origin, ENV.SUPABASE_URL);
    const service = url.pathname.startsWith('/rest/v1/rpc/');
    assert.equal(options.headers.apikey, service ? ENV.SUPABASE_SERVICE_ROLE_KEY : ENV.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.headers.Authorization, 'Bearer ' + (service ? ENV.SUPABASE_SERVICE_ROLE_KEY : JWT));
    if (url.pathname === '/auth/v1/user') return reply(state.user, state.authStatus || 200);
    if (url.pathname === '/rest/v1/zc_members') {
      assert.equal(url.searchParams.get('user_id'), 'eq.' + ACTOR); assert.equal(url.searchParams.get('active'), 'eq.true');
      return reply(state.members || [state.member], state.memberStatus || 200);
    }
    if (url.pathname === '/rest/v1/rpc/snote_profile_phone_challenge') {
      state.hashes.push(body.p_otp_hash);
      if (state.reserve) return reply(state.reserve);
      return reply({ ok: true, claimed: true, status: 'pending', challengeId: body.p_challenge_id, phone: body.p_phone, expiresAt: new Date(Date.now() + 300000).toISOString(), retryAfter: 60 });
    }
    if (url.pathname === '/rest/v1/rpc/snote_profile_phone_delivery') {
      state.deliveries.push(body);
      if (state.deliveryFailures > 0) { state.deliveryFailures--; throw Error('synthetic delivery ACK loss'); }
      return reply({ ok: true });
    }
    if (url.pathname === '/rest/v1/rpc/snote_profile_phone_verify') {
      state.hashes.push(body.p_otp_hash); return reply(state.verification || { ok: true, profile: state.profile });
    }
    throw Error('Unexpected HTTP: ' + url.href);
  };
  t.after(() => { globalThis.fetch = original; }); return state;
}
async function call(body, { env = ENV, method = 'POST', headers = {}, raw } = {}) {
  const request = new Request('https://s-note.example/api/profile-phone', { method, headers: { Authorization: 'Bearer ' + JWT, Origin: 'https://s-note.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: raw === undefined ? JSON.stringify(body) : raw }) });
  const response = await onRequest({ request, env }); return { response, status: response.status, body: await response.json() };
}

test('personal-number SMS binds actual actor/company, uses approved server sender, and stores only a domain-separated hash', async t => {
  const state = fixture(t); const result = await call(sendBody());
  assert.equal(result.status, 200); assert.equal(result.body.challengeId, CHALLENGE); assert.equal(result.body.retryAfter, 60);
  assert.deepEqual(Object.keys(result.body).sort(), ['challengeId', 'expiresAt', 'ok', 'retryAfter']);
  assert.equal(state.messages.length, 1); const message = state.messages[0], code = message.text.match(/인증번호: (\d{6})/)[1];
  assert.equal(message.type, 'SMS'); assert.equal(message.from, '0212345678'); assert.equal(message.to, '01099998888');
  assert.equal(state.hashes[0], digest(code)); assert(!JSON.stringify(result.body).includes(code));
  const reserve = state.calls.find(c => c.url.pathname.endsWith('/snote_profile_phone_challenge')).body;
  assert.equal(reserve.p_actor, ACTOR); assert.equal(reserve.p_company, COMPANY); assert.deepEqual(reserve.p_expected, PREVIOUS);
  assert.equal(reserve.p_phone, '01099998888'); assert.equal('code' in reserve, false);
  assert.deepEqual(state.deliveries.map(d => d.p_status), ['sent']);
  assert(state.calls.every(c => !['PATCH', 'PUT', 'DELETE'].includes(c.options.method)));
  assert.match(result.response.headers.get('Cache-Control'), /no-store.*private/); assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer');
});

test('reused request IDs return only the original sent challenge and never send a new generated code', async t => {
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  for (const status of ['sent', 'pending', 'failed', 'unknown', 'verified']) {
    const state = fixture(t, { reserve: { ok: true, claimed: false, status, challengeId: CHALLENGE, phone: '01099998888', expiresAt } });
    const result = await call(sendBody()); assert.equal(state.messages.length, 0); assert.equal(state.deliveries.length, 0);
    assert.equal(result.status, status === 'sent' ? 200 : status === 'failed' ? 502 : status === 'verified' ? 409 : 503);
    if (status === 'sent') assert.equal(result.body.challengeId, CHALLENGE); else assert(!Object.hasOwn(result.body, 'challengeId'));
  }
});

test('provider rejects, redirects, invalid ACKs and unknown outcomes never trigger automatic SMS retries', async t => {
  for (const patch of [
    { providerStatus: 400, providerBody: { private: ENV.SOLAPI_API_SECRET }, expected: 'failed' },
    { providerBody: { statusCode: '3001' }, expected: 'failed' },
    { providerStatus: 503, providerBody: {}, expected: 'unknown' },
    { providerBody: { statusCode: '2000', messageId: 'bad' }, expected: 'unknown' },
    { providerRedirect: true, expected: 'unknown' }, { providerThrow: true, expected: 'unknown' }
  ]) {
    const state = fixture(t, patch), result = await call(sendBody()); assert.equal(state.messages.length, 1);
    assert.deepEqual(state.deliveries.map(d => d.p_status), [patch.expected]); assert.equal(result.body.code, patch.expected === 'failed' ? 'SMS_SEND_FAILED' : 'SMS_SEND_UNKNOWN');
    assert.equal(result.response.headers.get('Retry-After'), '60'); assert(!Object.hasOwn(result.body, 'challengeId'));
    assert(!JSON.stringify(result.body).includes(ENV.SOLAPI_API_SECRET));
    assert(state.calls.every(c => c.url.hostname !== 'private-redirect.invalid'));
  }
});

test('lost delivery ACK is compensated with unknown and a usable challenge is never returned without durable acknowledgement', async t => {
  for (const failures of [1, 2]) {
    const state = fixture(t, { deliveryFailures: failures }), result = await call(sendBody());
    assert.equal(state.messages.length, 1); assert.deepEqual(state.deliveries.map(d => d.p_status), ['sent', 'unknown']);
    assert.equal(result.status, 503); assert.equal(result.body.code, 'SMS_SEND_UNKNOWN'); assert(!Object.hasOwn(result.body, 'challengeId'));
  }
});

test('verification hashes the exact actor/company/challenge/normalized destination and applies only its returned profile', async t => {
  const state = fixture(t), result = await call(verifyBody({ phone: '+82 10-9999-8888', challengeId: CHALLENGE.toUpperCase() }));
  assert.equal(result.status, 200); assert.deepEqual(result.body.profile, PROFILE); assert.deepEqual(state.hashes, [digest('000042')]);
  assert.equal(state.messages.length, 0); const args = state.calls.at(-1).body;
  assert.deepEqual(args, { p_actor: ACTOR, p_company: COMPANY, p_challenge_id: CHALLENGE, p_otp_hash: digest('000042') });
  assert(!JSON.stringify(args).includes('000042'));
});

test('logical OTP expiry/lock/CAS/rate errors stay explicit and upstream diagnostics never reach the client', async t => {
  for (const [code, status] of [['INVALID_CODE', 400], ['EXPIRED', 410], ['LOCKED', 423], ['PROFILE_CONFLICT', 409], ['CONSUMED', 409], ['REQUEST_REUSED', 409], ['RATE_LIMITED', 429], ['FORBIDDEN', 403]]) {
    const state = fixture(t, { verification: { ok: false, code, message: 'PRIVATE SQL ' + ENV.SUPABASE_SERVICE_ROLE_KEY, ...(code === 'RATE_LIMITED' ? { retryAfter: 117 } : {}) } });
    const result = await call(verifyBody()); assert.equal(result.status, status); assert.equal(result.body.code, code); assert.equal(state.messages.length, 0);
    assert(!JSON.stringify(result.body).includes('PRIVATE')); assert(!JSON.stringify(result.body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
    if (code === 'RATE_LIMITED') assert.equal(result.response.headers.get('Retry-After'), '117');
  }
  const state = fixture(t, { reserve: { ok: false, code: 'RATE_LIMITED', retryAfter: 60 } });
  assert.equal((await call(sendBody())).status, 429); assert.equal(state.messages.length, 0);
});

test('auth server and actual active membership deny anonymous, inactive, moved, duplicated and forged-role users before service mutations', async t => {
  for (const [patch, status] of [
    [{ authStatus: 401, user: { private: ENV.SUPABASE_SERVICE_ROLE_KEY } }, 401],
    [{ user: { id: ACTOR, is_anonymous: true } }, 401],
    [{ member: { user_id: ACTOR, company_id: COMPANY, role: 'dealer', active: false } }, 403],
    [{ member: { user_id: ACTOR, company_id: FOREIGN, role: 'admin', active: true } }, 403],
    [{ member: { user_id: OTHER, company_id: COMPANY, role: 'admin', active: true } }, 403],
    [{ user: { id: ACTOR, user_metadata: { role: 'admin' } }, member: { user_id: ACTOR, company_id: COMPANY, role: 'blocked', active: true } }, 403],
    [{ members: [] }, 403], [{ members: [PROFILE, PROFILE] }, 403]
  ]) {
    const state = fixture(t, patch), result = await call(sendBody()); assert.equal(result.status, status);
    assert.equal(state.calls.filter(c => c.url.pathname.startsWith('/rest/v1/rpc/')).length, 0); assert.equal(state.messages.length, 0);
  }
  const state = fixture(t); assert.equal((await call(sendBody({ expected: { ...PREVIOUS, user_id: OTHER } }))).body.code, 'PROFILE_CONFLICT');
  assert.equal(state.calls.length, 1);
});

test('accountant and administrator can confirm their own phone while returned actor/company/phone mismatches fail closed', async t => {
  for (const role of ['admin', 'accountant']) {
    const state = fixture(t, { member: { user_id: ACTOR, company_id: COMPANY, role, active: true } });
    assert.equal((await call(verifyBody())).status, 200); assert.equal(state.messages.length, 0);
  }
  for (const change of [{ user_id: OTHER }, { company_id: FOREIGN }, { phone: PREVIOUS.phone }, { revision: 0 }]) {
    fixture(t, { profile: { ...PROFILE, ...change } }); assert.equal((await call(verifyBody())).body.code, 'NETWORK');
  }
});

test('bad bodies, foreign origins, missing JWTs, excess fields and numeric OTPs make zero outbound requests', async t => {
  const state = fixture(t);
  const cases = [
    [sendBody(), { method: 'GET' }, 405], [sendBody(), { headers: { Origin: 'https://evil.example' } }, 403],
    [sendBody(), { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403], [sendBody(), { headers: { Authorization: '' } }, 401],
    [sendBody(), { headers: { Authorization: 'Bearer private-invalid' } }, 401], [sendBody(), { headers: { 'Content-Type': 'text/plain' } }, 400],
    [sendBody({ actor: OTHER }), {}, 400], [sendBody({ expected: { ...PREVIOUS, role: 'admin' } }), {}, 400],
    [sendBody({ expected: { ...PREVIOUS, company_id: FOREIGN } }), {}, 400], [sendBody({ expected: { ...PREVIOUS, phone: 'bad' } }), {}, 400],
    [sendBody({ phone: '0101234567' }), {}, 400], [sendBody({ requestId: 'bad' }), {}, 400],
    [verifyBody({ code: 42 }), {}, 400], [verifyBody({ code: '42' }), {}, 400], [verifyBody({ challengeId: 'bad' }), {}, 400],
    [sendBody(), { raw: '{' }, 400], [sendBody(), { raw: JSON.stringify({ padding: 'x'.repeat(5000) }) }, 400],
    [sendBody(), { headers: { 'Content-Length': '4097' } }, 400]
  ];
  for (const [body, options, status] of cases) assert.equal((await call(body, options)).status, status);
  assert.equal(state.calls.length, 0);
});

test('missing or malformed reused server settings are fail-closed and never exposed in public errors', async t => {
  const state = fixture(t);
  for (const key of Object.keys(ENV)) {
    const env = { ...ENV }; delete env[key]; const result = await call(sendBody(), { env }); assert.equal(result.status, 503, key); assert.equal(result.body.code, 'SETUP_REQUIRED');
  }
  for (const [key, value] of [['SUPABASE_URL', 'https://private-user:private-password@profile-phone-test.supabase.co'], ['SOLAPI_SENDER', '+8201012345678'], ['CUSTOMER_INTAKE_OTP_SECRET', 'private-short'], ['SUPABASE_SERVICE_ROLE_KEY', 'private-line\nprivate-key']]) {
    const result = await call(sendBody(), { env: { ...ENV, [key]: value } }); assert.equal(result.status, 503); assert(!JSON.stringify(result.body).includes(value));
  }
  assert.equal(state.calls.length, 0);
});

test('Supabase redirects/setup failures and malformed reserve responses cannot forward keys or send any SMS', async t => {
  for (const stage of ['auth', 'reserve', 'setup', 'mismatch']) {
    const state = fixture(t, { override(call) {
      if (stage === 'auth' && call.url.pathname === '/auth/v1/user' || stage === 'reserve' && call.url.pathname.endsWith('/snote_profile_phone_challenge')) return new Response(null, { status: 302, headers: { Location: 'https://private-redirect.invalid/steal' } });
      if (stage === 'setup' && call.url.pathname.endsWith('/snote_profile_phone_challenge')) return reply({ code: 'PGRST202', message: 'PRIVATE ' + ENV.SUPABASE_SERVICE_ROLE_KEY }, 400);
      if (stage === 'mismatch' && call.url.pathname.endsWith('/snote_profile_phone_challenge')) return reply({ ok: true, claimed: true, status: 'pending', challengeId: CHALLENGE, phone: PREVIOUS.phone, expiresAt: new Date(Date.now() + 300000).toISOString() });
    } });
    const result = await call(sendBody()); assert.equal(result.status, stage === 'setup' ? 503 : 502); assert.equal(state.messages.length, 0);
    assert(state.calls.every(c => c.url.hostname !== 'private-redirect.invalid')); assert(!JSON.stringify(result.body).includes('PRIVATE'));
  }
});
