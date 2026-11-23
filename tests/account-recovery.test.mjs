import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { onRequest } from '../functions/api/account-recovery.js';

// Entirely synthetic Auth, private RPC and SMS endpoints. This test must never
// send a real SMS/email, change a real password, or touch a production account.
const ENV = { SUPABASE_URL: 'https://recovery-fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-secret',
  SOLAPI_API_KEY: 'synthetic-solapi-key', SOLAPI_API_SECRET: 'synthetic-solapi-secret', CUSTOMER_INTAKE_OTP_SECRET: 'synthetic-only-recovery-otp-secret-longer-than-32-characters' };
const USER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const PHONE = '01012345678', EMAIL = 'recovery-owner@example.test', NAME = '가상 딜러';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const hash = value => createHash('sha256').update(value).digest('hex');
const mac = (domain, ...values) => createHmac('sha256', ENV.CUSTOMER_INTAKE_OTP_SECRET).update(JSON.stringify(['snote-phone-recovery:' + domain + ':v1', ...values])).digest('hex');
const sendBody = (purpose = 'password', extra = {}) => ({ action: 'send-code', purpose, name: NAME, phone: '010-1234-5678', requestId: randomUUID(), ...extra });

function fixture(t, patch = {}) {
  const previous = globalThis.fetch;
  const state = { calls: [], jobs: [], messages: [], emailRequests: [], authUpdates: [], records: new Map(), requests: new Map(), resets: new Map(), eligible: true, emailRoute: false,
    finalizationDrops: 0, emailDeliveryDrops: 0, ...patch };
  state.context = { waitUntil(promise) { state.jobs.push(promise); } };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), body = options.body === undefined ? undefined : JSON.parse(options.body), call = { url, options, body };
    state.calls.push(call); assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
    if (state.override) { const custom = await state.override(call, state); if (custom) return custom; }
    if (url.origin === 'https://api.solapi.com') {
      assert.equal(url.pathname, '/messages/v4/send'); assert.equal(options.method, 'POST');
      assert.match(options.headers.Authorization, /^HMAC-SHA256 apiKey=synthetic-solapi-key,/u);
      assert(!options.headers.Authorization.includes(ENV.SOLAPI_API_SECRET));
      state.messages.push(body.message);
      if (state.smsHold) await state.smsHold;
      if (state.smsThrow) throw Error('PRIVATE_PROVIDER_ERROR');
      if (state.smsRedirect) return new Response(null, { status: 307, headers: { Location: 'https://outside.example/private' } });
      return json(state.smsBody || { statusCode: '2000', messageId: 'SMS_SYNTHETIC_123456' }, state.smsStatus || 200);
    }
    assert.equal(url.origin, ENV.SUPABASE_URL, 'no credentials forwarded outside the fixed project');
    const isRecover = url.pathname === '/auth/v1/recover', key = isRecover ? ENV.SUPABASE_PUBLISHABLE_KEY : ENV.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(options.headers.apikey, key); assert.equal(options.headers.Authorization, 'Bearer ' + key);
    if (isRecover) {
      assert.equal(options.method, 'POST'); assert.equal(url.searchParams.get('redirect_to'), 'https://s-note.kr/');
      assert.deepEqual(body, { email: EMAIL }); state.emailRequests.push(call);
      if (state.emailHold) await state.emailHold;
      if (state.emailThrow) throw Error('PRIVATE_EMAIL_ERROR');
      if (state.emailRedirect) return new Response(null, { status: 302, headers: { Location: 'https://outside.example/private' } });
      return json(state.emailBody || {}, state.emailStatus || 200);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      assert.equal(url.pathname, '/auth/v1/admin/users/' + USER); assert.equal(options.method, 'PUT'); assert.deepEqual(Object.keys(body), ['password']);
      state.authUpdates.push(call);
      if (state.authHold) await state.authHold;
      if (state.authThrow) throw Error('PRIVATE_AUTH_ERROR');
      if (state.authRedirect) return new Response(null, { status: 307, headers: { Location: 'https://outside.example/private' } });
      return json(state.authBody || { id: USER }, state.authStatus || 200);
    }
    assert.equal(options.method, 'POST');
    const suffix = url.pathname.replace('/rest/v1/rpc/snote_phone_recovery_', '');
    if (suffix === 'prepare') {
      if (state.rateLimited) return json({ ok: false, code: 'RATE_LIMITED', retryAfter: 117, message: 'PRIVATE_DATABASE_ERROR' });
      let record = state.requests.get(body.p_request_id);
      if (record) {
        if (record.phone !== body.p_phone || record.name !== body.p_name || record.purpose !== body.p_purpose) return json({ ok: false, code: 'REQUEST_REUSED' });
        return json({ ok: true, challengeId: record.id, claimed: false, canSend: state.eligible, phone: record.phone, status: record.status, expiresAt: record.expiresAt, retryAfter: 60 });
      }
      record = { id: body.p_challenge_id, phone: body.p_phone, name: body.p_name, purpose: body.p_purpose, otpHash: body.p_otp_hash, status: 'pending', expiresAt: new Date(Date.now() + 300000).toISOString(), attempts: 0 };
      state.requests.set(body.p_request_id, record); state.records.set(record.id, record);
      return json({ ok: true, challengeId: record.id, claimed: true, canSend: state.eligible, phone: state.canonicalPhone || (state.eligible ? record.phone : null), status: 'pending', expiresAt: record.expiresAt, retryAfter: 60 });
    }
    if (suffix === 'delivery') {
      state.records.get(body.p_challenge_id).status = body.p_status; return json({ ok: true });
    }
    if (suffix === 'verify') {
      if (state.verifyCode) return json({ ok: false, code: state.verifyCode, message: 'PRIVATE_DATABASE_ERROR' });
      const record = state.records.get(body.p_challenge_id);
      if (!record || !state.eligible || record.purpose !== body.p_purpose || record.status !== 'sent' || record.otpHash !== body.p_otp_hash) {
        if (record && ++record.attempts >= 5) return json({ ok: false, code: 'LOCKED' });
        return json({ ok: false, code: 'INVALID_CODE' });
      }
      record.proof = body.p_receipt_hash; record.verified = true;
      const claimedEmail = state.emailRoute && record.emailStatus === undefined;
      if (claimedEmail) record.emailStatus = 'pending';
      return json({ ok: true, route: state.emailRoute ? 'email' : 'phone', email: EMAIL, challengeId: record.id, claimedEmail,
        emailStatus: record.emailStatus, resetExpiresAt: new Date(Date.now() + 300000).toISOString() });
    }
    if (suffix === 'email_delivery') {
      const record = state.records.get(body.p_challenge_id); assert.equal(body.p_receipt_hash, record.proof);
      if (record.emailStatus !== 'pending' && record.emailStatus !== body.p_status) return json({ ok: false, code: 'REQUEST_REUSED' });
      if (record.emailStatus === 'pending') record.emailStatus = body.p_status;
      if (state.emailDeliveryDrops-- > 0) throw Error('PRIVATE_DATABASE_ERROR');
      return json({ ok: true, emailStatus: record.emailStatus });
    }
    if (suffix === 'reset_prepare') {
      const record = state.records.get(body.p_challenge_id), old = state.resets.get(body.p_job_id);
      if (old) {
        if (old.proof !== body.p_receipt_hash || old.fingerprint !== body.p_password_fingerprint || old.executor !== body.p_executor_hash || old.challenge !== body.p_challenge_id) return json({ ok: false, code: 'REQUEST_REUSED' });
        return json({ ok: true, claimed: false, state: old.state, jobId: old.id, userId: USER, email: EMAIL });
      }
      if (!record || !record.verified || record.purpose !== 'password' || record.proof !== body.p_receipt_hash || state.emailRoute) return json({ ok: false, code: 'INVALID_CODE' });
      if (record.jobId) return json({ ok: false, code: 'PROOF_CONSUMED' });
      record.jobId = body.p_job_id;
      const job = { id: body.p_job_id, state: 'applying', proof: body.p_receipt_hash, fingerprint: body.p_password_fingerprint, executor: body.p_executor_hash, challenge: body.p_challenge_id };
      state.resets.set(job.id, job);
      return json({ ok: true, claimed: true, state: job.state, jobId: job.id, userId: USER, email: EMAIL, expiresAt: new Date(Date.now() + 60000).toISOString() });
    }
    if (suffix === 'reset_finalize') {
      const job = state.resets.get(body.p_job_id); assert.equal(body.p_receipt_hash, job.proof); assert.equal(body.p_password_fingerprint, job.fingerprint); assert.equal(body.p_executor_hash, job.executor);
      if (job.state === 'applying') job.state = body.p_outcome;
      if (state.finalizationDrops-- > 0) throw Error('PRIVATE_DATABASE_ERROR');
      return json({ ok: true, jobId: job.id, state: job.state });
    }
    assert.fail('Unexpected synthetic endpoint: ' + url.pathname);
  };
  t.after(() => { globalThis.fetch = previous; });
  state.call = async (body, { headers = {}, env = ENV, method = 'POST', raw, context = state.context } = {}) => {
    const request = new Request('https://s-note.example/api/account-recovery', { method, headers: { Origin: 'https://s-note.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10', ...headers },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: raw === undefined ? JSON.stringify(body) : raw }) });
    const response = await onRequest({ ...context, request, env }); return { response, status: response.status, body: await response.json() };
  };
  state.flush = async () => { await Promise.all(state.jobs); };
  state.prove = async (purpose = 'password') => {
    const sent = await state.call(sendBody(purpose)); assert.equal(sent.status, 200); await state.flush();
    const code = state.messages.at(-1).text.match(/인증번호: (\d{6})/u)[1];
    const verification = { action: 'verify', purpose, challengeId: sent.body.challengeId, code };
    const result = await state.call(verification);
    return { sent, verification, result, reset: { action: 'reset-password', challengeId: sent.body.challengeId, resetToken: result.body.resetToken, password: 'Synthetic-new-password-42!', requestId: randomUUID() } };
  };
  return state;
}
function clean(value, extra = []) {
  const encoded = JSON.stringify(value);
  for (const forbidden of [ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.SOLAPI_API_KEY, ENV.SOLAPI_API_SECRET, ENV.CUSTOMER_INTAKE_OTP_SECRET, USER, OTHER, 'PRIVATE_', 'otp_hash', 'executor_hash', ...extra]) assert(!encoded.includes(forbidden), 'private value was exposed');
}
async function until(check) {
  const deadline = performance.now() + 1000;
  while (!check() && performance.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert(check(), 'synthetic upstream request did not start');
}

test('send acknowledgement is identical before proof, and the only SMS destination is canonical server data', async t => {
  for (const eligible of [true, false]) {
    const f = fixture(t, { eligible }), input = sendBody('id'), result = await f.call(input); await f.flush();
    assert.equal(result.status, 200); assert.deepEqual(Object.keys(result.body).sort(), ['challengeId', 'expiresAt', 'ok', 'retryAfter']);
    assert.equal(result.body.retryAfter, 60); clean(result.body, [PHONE, EMAIL]);
    assert.equal(f.messages.length, eligible ? 1 : 0);
    if (eligible) { assert.equal(f.messages[0].from, '01096669997'); assert.equal(f.messages[0].to, PHONE); assert.equal(f.messages[0].type, 'SMS'); }
    const prepare = f.calls.find(call => call.url.pathname.endsWith('/snote_phone_recovery_prepare')).body;
    assert.equal(prepare.p_phone, PHONE); assert.equal(prepare.p_name, NAME); assert.equal(prepare.p_phone_hash, mac('phone', PHONE)); assert.equal(prepare.p_ip_hash, mac('ip', '192.0.2.10'));
    assert(!Object.hasOwn(prepare, 'userId')); assert(!Object.hasOwn(prepare, 'code')); assert.match(prepare.p_otp_hash, /^[a-f0-9]{64}$/u);
    assert.match(result.response.headers.get('Cache-Control'), /no-store.*private/u); assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer');
  }
});

test('provider response duration and failures do not change the pre-proof acknowledgement or cause retries', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { smsHold: pending }), input = sendBody(), result = await f.call(input);
  assert.equal(result.status, 200); release(); await f.flush();
  const again = await f.call(input); await f.flush(); assert.equal(again.body.challengeId, result.body.challengeId); assert.equal(f.messages.length, 1);
  for (const patch of [{ smsThrow: true }, { smsRedirect: true }, { smsStatus: 400 }, { smsBody: { statusCode: '3001' } }, { smsBody: { statusCode: '2000', messageId: 'bad' } }]) {
    const x = fixture(t, patch), b = sendBody(), first = await x.call(b); await x.flush(); assert.equal(first.status, 200); clean(first.body);
    await x.call(b); await x.flush(); assert.equal(x.messages.length, 1);
    assert(['failed', 'unknown'].includes(x.records.get(first.body.challengeId).status));
  }
});

test('same request nonce cannot change phone, name or purpose, and server destination mismatch never sends', async t => {
  const f = fixture(t), input = sendBody(); await f.call(input); await f.flush();
  for (const patch of [{ purpose: 'id' }, { phone: '01099998888' }, { name: '다른 이름' }]) assert.equal((await f.call({ ...input, ...patch })).body.code, 'REQUEST_REUSED');
  assert.equal(f.messages.length, 1);
  const bad = fixture(t, { canonicalPhone: '01099998888' }); assert.equal((await bad.call(sendBody())).status, 502); await bad.flush(); assert.equal(bad.messages.length, 0);
});

test('direct verified-phone ID lookup reveals only its email after the exact purpose-bound OTP', async t => {
  const f = fixture(t), proof = await f.prove('id'); assert.equal(proof.result.status, 200); assert.deepEqual(proof.result.body, { ok: true, email: EMAIL });
  const verifyCall = f.calls.find(call => call.url.pathname.endsWith('/snote_phone_recovery_verify')).body;
  assert.equal(verifyCall.p_otp_hash, mac('otp', 'id', proof.verification.challengeId, proof.verification.code));
  assert(!JSON.stringify(verifyCall).includes(proof.verification.code));
  assert.equal((await f.call({ ...proof.verification, purpose: 'password' })).body.code, 'INVALID_CODE'); clean(proof.result.body);
});

test('password proof returns a short-lived receipt and resets only the server-resolved user once', async t => {
  const f = fixture(t), proof = await f.prove(); assert.equal(proof.result.status, 200); assert.match(proof.result.body.resetToken, /^[a-f0-9]{64}$/u);
  clean(proof.result.body, [EMAIL, PHONE]);
  const verifyCall = f.calls.find(call => call.url.pathname.endsWith('/snote_phone_recovery_verify')).body; assert.equal(verifyCall.p_receipt_hash, hash(proof.result.body.resetToken));
  assert.equal((await f.call(proof.reset)).status, 200); assert.equal(f.authUpdates.length, 1); assert.equal(f.authUpdates[0].body.password, proof.reset.password);
  const duplicate = await f.call(proof.reset); assert.equal(duplicate.status, 200); assert.equal(duplicate.body.duplicate, true); assert.equal(f.authUpdates.length, 1);
  assert.equal((await f.call({ ...proof.reset, password: 'Different-new-password-99!' })).body.code, 'REQUEST_REUSED');
  assert.equal((await f.call({ ...proof.reset, requestId: randomUUID() })).body.code, 'PROOF_CONSUMED');
  assert.equal((await f.call({ ...proof.reset, userId: OTHER })).status, 400); clean(duplicate.body, [proof.reset.password, proof.result.body.resetToken]);
  const prepare = f.calls.find(call => call.url.pathname.endsWith('/snote_phone_recovery_reset_prepare')).body;
  assert(!JSON.stringify(prepare).includes(proof.reset.password)); assert(!JSON.stringify(prepare).includes(proof.result.body.resetToken));
});

test('ID proof and wrong or changed receipts can never call the admin password API', async t => {
  const f = fixture(t), proof = await f.prove('id');
  for (const token of ['a'.repeat(64), mac('receipt', 'id', proof.verification.challengeId, mac('otp', 'id', proof.verification.challengeId, proof.verification.code))]) {
    assert.equal((await f.call({ ...proof.reset, resetToken: token })).body.code, 'INVALID_CODE');
  }
  assert.equal(f.authUpdates.length, 0);
});

test('concurrent reset requests have one executor; applying and uncertain jobs never replay Admin PUT', async t => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { authHold: held }), proof = await f.prove(), first = f.call(proof.reset);
  await until(() => f.authUpdates.length > 0);
  const second = await f.call(proof.reset); assert.equal(second.body.code, 'RESET_PENDING'); assert.equal(f.authUpdates.length, 1);
  release(); assert.equal((await first).status, 200); assert.equal(f.authUpdates.length, 1);
  for (const patch of [{ authThrow: true }, { authRedirect: true }, { authStatus: 503 }, { authBody: { id: OTHER } }]) {
    const x = fixture(t, patch), p = await x.prove(), result = await x.call(p.reset);
    assert.equal(result.body.code, 'RESET_UNKNOWN'); assert.equal((await x.call(p.reset)).body.code, 'RESET_UNKNOWN'); assert.equal(x.authUpdates.length, 1); clean(result.body);
  }
});

test('known password rejection stays failed and lost finalization acknowledgement is read back without a second password mutation', async t => {
  const f = fixture(t, { authStatus: 422, authBody: { error: 'PRIVATE_PASSWORD_POLICY' } }), proof = await f.prove();
  assert.equal((await f.call(proof.reset)).body.code, 'RESET_FAILED'); assert.equal((await f.call(proof.reset)).body.code, 'RESET_FAILED'); assert.equal(f.authUpdates.length, 1);
  const x = fixture(t, { finalizationDrops: 1 }), p = await x.prove(), result = await x.call(p.reset);
  assert.equal(result.status, 200); assert.equal(x.authUpdates.length, 1); assert.equal(x.calls.filter(call => call.url.pathname.endsWith('/snote_phone_recovery_reset_finalize')).length, 2); clean(result.body);
});

test('legacy unverified phones require native email proof, using only the server email and fixed root redirect', async t => {
  for (const mode of ['id', 'password']) {
    const f = fixture(t, { emailRoute: true }), proof = await f.prove(mode);
    assert.equal(proof.result.status, 200); assert.deepEqual(proof.result.body, { ok: true, requiresEmail: true, delivery: 'sent' });
    assert.equal(f.emailRequests.length, 1); clean(proof.result.body, [EMAIL]);
    assert.deepEqual((await f.call(proof.verification)).body, proof.result.body); assert.equal(f.emailRequests.length, 1);
    if (mode === 'password') assert.equal((await f.call({ ...proof.reset, resetToken: 'a'.repeat(64) })).body.code, 'INVALID_CODE');
    assert.equal(f.authUpdates.length, 0);
  }
});

test('legacy email failure or uncertain acceptance is honest, durable and never automatically resent', async t => {
  for (const patch of [{ emailStatus: 400 }, { emailStatus: 429 }, { emailStatus: 503 }, { emailThrow: true }, { emailRedirect: true }]) {
    const f = fixture(t, { emailRoute: true, ...patch }), proof = await f.prove();
    assert.equal(proof.result.body.requiresEmail, true); assert(['failed', 'unknown'].includes(proof.result.body.delivery)); assert.equal(proof.result.body.ok, false);
    assert.deepEqual((await f.call(proof.verification)).body, proof.result.body); assert.equal(f.emailRequests.length, 1); clean(proof.result.body, [EMAIL]);
  }
  const f = fixture(t, { emailRoute: true, emailDeliveryDrops: 1 }), proof = await f.prove();
  assert.equal(proof.result.body.code, 'EMAIL_SEND_UNKNOWN');
  assert.deepEqual((await f.call(proof.verification)).body, { ok: true, requiresEmail: true, delivery: 'sent' });
  assert.equal(f.emailRequests.length, 1); assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/snote_phone_recovery_email_delivery')).length, 2);
});

test('persistent rate, expiry, lock and unavailable proof errors do not expose private account details', async t => {
  const f = fixture(t, { rateLimited: true }), limited = await f.call(sendBody());
  assert.equal(limited.status, 429); assert.equal(limited.response.headers.get('Retry-After'), '117'); await f.flush(); assert.equal(f.messages.length, 0); clean(limited.body);
  for (const [code, status] of [['INVALID_CODE', 400], ['LOCKED', 423], ['EXPIRED', 410], ['UNAVAILABLE', 400], ['PROOF_CONSUMED', 409]]) {
    const x = fixture(t, { verifyCode: code }), result = await x.call({ action: 'verify', purpose: 'id', challengeId: randomUUID(), code: '123456' });
    assert.equal(result.status, status); clean(result.body, [EMAIL]);
  }
});

test('missing or throwing platform scheduling cannot start a chargeable send', async t => {
  const f = fixture(t);
  assert.equal((await f.call(sendBody(), { context: {} })).status, 503); assert.equal(f.calls.length, 0);
  const result = await f.call(sendBody(), { context: { waitUntil() { throw Error('PRIVATE_PLATFORM_ERROR'); } } });
  assert.equal(result.status, 503); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.messages.length, 0); clean(result.body);
});

test('strict JSON, origin, bounds and input checks reject arbitrary actors, destinations, URLs and credentials', async t => {
  const f = fixture(t), input = sendBody();
  for (const [body, options] of [
    [input, { method: 'GET' }], [input, { headers: { Origin: 'https://outside.example' } }], [input, { headers: { 'Sec-Fetch-Site': 'same-site' } }],
    [input, { headers: { 'Content-Type': 'text/plain' } }], [input, { raw: 'not-json' }], [input, { raw: 'x'.repeat(4097) }],
    [{ ...input, userId: OTHER }], [{ ...input, email: EMAIL }], [{ ...input, redirectTo: 'https://outside.example' }],
    [{ ...input, phone: '02-1234-5678' }], [{ ...input, name: '' }], [{ ...input, name: 'x'.repeat(41) }], [{ ...input, purpose: 'admin' }],
    [{ action: 'reset-password', challengeId: randomUUID(), resetToken: 'a'.repeat(64), requestId: randomUUID(), password: 'short' }],
    [input, { env: { ...ENV, SUPABASE_URL: 'https://outside.example' } }], [input, { env: { ...ENV, CUSTOMER_INTAKE_OTP_SECRET: 'short' } }]
  ]) { const result = await f.call(body, options); assert(result.status >= 400); clean(result.body); }
  assert.equal(f.calls.length, 0); assert.equal(f.messages.length, 0);
});

test('untrusted forwarding headers are ignored and phone throttles do not change with purpose', async t => {
  const f = fixture(t);
  await f.call(sendBody('id', { phone: '+82 10-1234-5678' }), { headers: { 'X-Forwarded-For': '203.0.113.200' } });
  await f.call(sendBody('password')); await f.flush();
  const calls = f.calls.filter(call => call.url.pathname.endsWith('/snote_phone_recovery_prepare')).map(call => call.body);
  assert.equal(calls[0].p_phone_hash, calls[1].p_phone_hash); assert.equal(calls[0].p_ip_hash, calls[1].p_ip_hash); assert.equal(calls[0].p_ip_hash, mac('ip', '192.0.2.10'));
});

test('the native email deadline records unknown and cannot resend when the upstream ignores abort', async t => {
  const f = fixture(t, { emailRoute: true, emailHold: new Promise(() => {}) });
  const sent = await f.call(sendBody()); await f.flush();
  const body = { action: 'verify', purpose: 'password', challengeId: sent.body.challengeId, code: f.messages[0].text.match(/인증번호: (\d{6})/u)[1] };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.call(body);
  await until(() => f.emailRequests.length > 0);
  assert.equal(f.emailRequests.length, 1); t.mock.timers.tick(10000);
  const result = await pending; assert.equal(result.body.code, 'EMAIL_SEND_UNKNOWN'); assert.equal(result.body.requiresEmail, true); assert.equal(result.body.delivery, 'unknown');
  assert.equal((await f.call(body)).body.code, 'EMAIL_SEND_UNKNOWN'); assert.equal(f.emailRequests.length, 1); clean(result.body, [EMAIL]);
});

test('the Admin password deadline freezes an unknown job without a second write', async t => {
  const f = fixture(t, { authHold: new Promise(() => {}) }), proof = await f.prove();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.call(proof.reset);
  await until(() => f.authUpdates.length > 0);
  assert.equal(f.authUpdates.length, 1); t.mock.timers.tick(12000);
  const result = await pending; assert.equal(result.body.code, 'RESET_UNKNOWN'); assert.equal((await f.call(proof.reset)).body.code, 'RESET_UNKNOWN');
  assert.equal(f.authUpdates.length, 1); clean(result.body);
});
