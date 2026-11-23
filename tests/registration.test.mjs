import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { onRequest } from '../functions/api/registration.js';

// All Auth, Storage and database requests are intercepted. Every account and
// evidence file is synthetic; this suite must never contact a live service.
const ORIGIN = 'https://registration.example', ID = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_URL: 'https://registration-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', CUSTOMER_INTAKE_OTP_SECRET: 'synthetic-only-budget-secret-32-characters' };
const PROFILE = { kind: 'representative', companyName: '합성 자동차', businessNumber: '123-45-67890', representativeName: '합성 대표', businessAddress: '합성시 테스트로 1', displayName: '합성 담당자', phone: '+82 10-1234-5678', email: ' New.User@Example.Invalid ' };
const PASSWORD = ' SyntheticPassword!123 ';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAEB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AHAEqb//2Q==', 'base64');
const WEBP = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAAdQxJpVtf+BiOh/AAA=', 'base64');
const JWT = Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: ID, role: 'authenticated', exp: 4102444800 })).toString('base64url') + '.synthetic';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t, options = {}) {
  const original = globalThis.fetch;
  const state = { calls: [], prepared: null, uploads: [], deletes: [], authCalls: [], rate: { ok: true }, cancel: { ok: true, cancelled: true }, ...options };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input), headers = new Headers(init.headers), binary = url.pathname.startsWith('/storage/v1/object/') && init.method === 'POST';
    const body = binary ? new Uint8Array(init.body) : init.body === undefined ? undefined : JSON.parse(init.body);
    const call = { url, init, headers, body }; state.calls.push(call);
    assert.equal(url.origin, ENV.SUPABASE_URL, 'No HTTP target outside the synthetic project');
    assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store'); assert(init.signal instanceof AbortSignal);
    const auth = url.pathname === '/auth/v1/signup';
    assert.equal(headers.get('apikey'), auth ? ENV.SUPABASE_PUBLISHABLE_KEY : ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(headers.get('authorization'), 'Bearer ' + (auth ? ENV.SUPABASE_PUBLISHABLE_KEY : ENV.SUPABASE_SERVICE_ROLE_KEY));
    if (!auth) assert.equal(JSON.stringify(body).includes(PASSWORD), false, 'Password never reaches application, budget or Storage records');
    if (state.override) { const response = await state.override(call, state); if (response) return response; }
    if (url.pathname.endsWith('/snote_registration_rate_limit')) return reply(state.rate);
    if (url.pathname.endsWith('/snote_registration_company_check')) return reply(state.company || { ok: true, available: true });
    if (url.pathname.endsWith('/snote_registration_prepare')) { state.prepared = body; return reply(state.prepare || { ok: true }, state.prepareStatus || 200); }
    if (binary) { state.uploads.push(call); return reply({ Key: url.pathname }); }
    if (url.pathname.endsWith('/snote_registration_ready')) return reply(state.ready || { ok: true });
    if (url.pathname.endsWith('/snote_registration_cancel')) return reply(state.cancel);
    if (init.method === 'DELETE' && url.pathname === '/storage/v1/object/snote-registration-documents') { state.deletes.push(body); return reply([]); }
    if (auth) {
      state.authCalls.push(call);
      if (state.authThrow) throw new DOMException('Synthetic lost Auth reply', state.authThrow);
      return reply(state.auth || { id: ID, email: 'new.user@example.invalid', identities: [{ id: ID }], confirmation_sent_at: '2026-11-01T00:00:00Z' }, state.authStatus || 200);
    }
    throw Error('Unexpected synthetic request path: ' + url.pathname);
  };
  t.after(() => { globalThis.fetch = original; }); return state;
}
function form({ profile = PROFILE, password = PASSWORD, business = { bytes: PNG, type: 'image/png', name: 'business.png' }, dealer = { bytes: WEBP, type: 'image/webp', name: 'dealer.webp' }, extra } = {}) {
  const value = new FormData(); value.append('profile', typeof profile === 'string' ? profile : JSON.stringify(profile)); value.append('password', password);
  if (business) value.append('businessCertificate', new Blob([business.bytes], { type: business.type }), business.name);
  if (dealer) value.append('dealerLicense', new Blob([dealer.bytes], { type: dealer.type }), dealer.name);
  if (extra) for (const [key, item] of extra) value.append(key, item);
  return value;
}
async function call(body, { method = 'POST', env = ENV, origin = ORIGIN, requestOrigin = ORIGIN, headers = {}, raw } = {}) {
  const requestHeaders = { ...(origin === null ? {} : { Origin: origin }), 'CF-Connecting-IP': '192.0.2.7', ...headers };
  if (body && !(body instanceof FormData) && raw === undefined) requestHeaders['Content-Type'] = 'application/json';
  const value = raw === undefined ? body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) : raw;
  const request = new Request(requestOrigin + '/api/registration', { method, headers: requestHeaders, ...(method === 'GET' ? {} : { body: value, ...(value instanceof ReadableStream ? { duplex: 'half' } : {}) }) });
  const response = await onRequest({ request, env }); return { response, status: response.status, body: await response.json() };
}
function assertPrivate(result) {
  const serialized = JSON.stringify(result.body);
  for (const secret of [ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.CUSTOMER_INTAKE_OTP_SECRET, PASSWORD]) assert.equal(serialized.includes(secret), false);
  assert.match(result.response.headers.get('Cache-Control'), /no-store.*private/); assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(result.response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(result.response.headers.has('Access-Control-Allow-Origin'), false);
}
const actions = state => state.calls.map(call => call.url.pathname);

test('GET returns the configured boolean only and configuration values never escape', async t => {
  const state = fixture(t);
  for (const env of [{}, { ...ENV, SUPABASE_URL: 'http://private-project.invalid' }, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' }, { ...ENV, SUPABASE_PUBLISHABLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY }]) {
    const result = await call(undefined, { method: 'GET', env }); assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true, configured: false }); assertPrivate(result);
  }
  const result = await call(undefined, { method: 'GET' }); assert.deepEqual(result.body, { ok: true, configured: true }); assertPrivate(result); assert.equal(state.calls.length, 0);
});
test('same-origin, methods, encoding and configured state reject before every mutation', async t => {
  const state = fixture(t);
  for (const patch of [{ origin: 'https://foreign.invalid' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } }]) {
    const result = await call({ action: 'check-company', companyName: '합성' }, patch); assert.equal(result.status, 403); assert.equal(result.body.code, 'FORBIDDEN'); assertPrivate(result);
  }
  const method = await call(undefined, { method: 'DELETE' }); assert.equal(method.status, 405); assert.equal(method.response.headers.get('Allow'), 'GET, POST');
  assert.equal((await call(form(), { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal((await call(form(), { env: {} })).status, 503); assert.equal(state.calls.length, 0);
});
test('company check returns availability without company rows and uses a persistent HMAC-only budget', async t => {
  const state = fixture(t, { company: { ok: true, available: false, privateRows: [{ secret: 'not-for-browser' }] } });
  const result = await call({ action: 'check-company', companyName: ' 합성 회사 ' }, { headers: { 'CF-Connecting-IP': '192.000.002.007', 'X-Forwarded-For': '203.0.113.99' } });
  assert.deepEqual(result.body, { ok: true, available: false }); assertPrivate(result); assert.equal(state.calls.length, 2);
  assert.deepEqual(state.calls[0].body, { p_key: createHmac('sha256', ENV.CUSTOMER_INTAKE_OTP_SECRET).update('snote-registration-rate:v1:192.0.2.7').digest('hex'), p_action: 'check-company' });
  assert.deepEqual(state.calls[1].body, { p_name: '합성 회사' }); assert.equal(JSON.stringify(state.calls.map(c => c.body)).includes('203.0.113.99'), false);
});
test('budget failures stop uploads and Auth and expose fixed retry advice only', async t => {
  const state = fixture(t, { rate: { ok: false, code: 'RATE_LIMITED', retryAfter: 45, private: ENV.SUPABASE_SERVICE_ROLE_KEY } });
  for (const body of [form(), { action: 'check-company', companyName: '합성 회사' }]) { const result = await call(body); assert.equal(result.status, 429); assert.equal(result.body.code, 'RATE_LIMITED'); assert.equal(result.response.headers.get('Retry-After'), '45'); assertPrivate(result); }
  assert.equal(state.calls.length, 2); assert(state.calls.every(call => call.url.pathname.endsWith('/snote_registration_rate_limit')));
});
test('multipart reserves duplicates first, uploads two immutable private files, marks ready and only then calls public Auth', async t => {
  const state = fixture(t); const result = await call(form()); assert.equal(result.status, 200); assertPrivate(result);
  assert.deepEqual(result.body, { ok: true, email: 'new.user@example.invalid', confirmationRequired: true, session: null });
  assert.deepEqual(actions(state).map(value => value.replace(/\/storage\/v1\/object\/snote-registration-documents\/.*/, '/private-upload')), ['/rest/v1/rpc/snote_registration_rate_limit', '/rest/v1/rpc/snote_registration_prepare', '/private-upload', '/private-upload', '/rest/v1/rpc/snote_registration_ready', '/auth/v1/signup']);
  const prepared = state.prepared; assert.match(prepared.p_id, /^[a-f0-9-]{36}$/); assert.deepEqual(prepared.p_profile, { ...PROFILE, companyName: PROFILE.companyName, businessNumber: '1234567890', phone: '01012345678', email: 'new.user@example.invalid' });
  assert.equal(prepared.p_documents.length, 2);
  for (const [index, slot, mime, bytes] of [[0, 'business', 'image/png', PNG], [1, 'dealer', 'image/webp', WEBP]]) {
    const document = prepared.p_documents[index]; assert.equal(document.slot, slot); assert.equal(document.mimeType, mime); assert.equal(document.size, bytes.length); assert.equal(document.sha256, hash(bytes));
    assert.match(document.path, new RegExp('^' + prepared.p_id + '/' + slot + '/[a-f0-9-]{36}\\.(png|webp)$')); assert.equal(Object.hasOwn(document, 'url'), false);
    const upload = state.uploads[index]; assert.equal(upload.headers.get('x-upsert'), 'false'); assert.equal(upload.headers.get('Content-Type'), mime); assert.deepEqual(Buffer.from(upload.body), bytes);
  }
  const auth = state.authCalls[0]; assert.equal(auth.url.searchParams.get('redirect_to'), 'https://s-note.kr/'); assert.equal(auth.body.password, PASSWORD); assert.deepEqual(auth.body.data, { snote_registration: { version: 2, request_id: prepared.p_id } });
  assert.deepEqual(Object.keys(auth.body).sort(), ['data', 'email', 'password']); assert.equal(state.deletes.length, 0); assert(!JSON.stringify(result.body).includes(prepared.p_id));
});
test('legacy, Pages and production signup confirmations always return to the canonical app', async t => {
  const state = fixture(t);
  const origins = ['https://zerocar-office.pages.dev', 'https://s-note.pages.dev', 'https://s-note.kr', 'https://www.s-note.kr', 'https://signup-test.s-note.pages.dev'];
  for (const origin of origins) for (const kind of ['representative', 'dealer']) {
    const result = await call(form({ profile: { ...PROFILE, kind } }), { origin, requestOrigin: origin });
    assert.equal(result.status, 200); assertPrivate(result);
    assert.equal(state.prepared.p_profile.kind, kind, 'Canonical navigation cannot alter the selected registration role');
    const auth = state.authCalls.at(-1); assert.equal(auth.url.searchParams.get('redirect_to'), 'https://s-note.kr/');
    assert.equal(auth.url.searchParams.size, 1, 'Only the fixed return URL is sent; no legacy path or caller URL is propagated');
  }
  assert.equal(state.authCalls.length, origins.length * 2);
});
test('JPEG evidence and dealer profiles follow the same private flow', async t => {
  const state = fixture(t); const result = await call(form({ profile: { ...PROFILE, kind: 'dealer' }, business: { bytes: JPEG, type: 'image/jpeg', name: 'business-camera.jpg' } }));
  assert.equal(result.status, 200); assert.equal(state.prepared.p_profile.kind, 'dealer'); assert.equal(state.prepared.p_documents[0].mimeType, 'image/jpeg'); assert.match(state.prepared.p_documents[0].path, /\.jpg$/); assertPrivate(result);
});
test('known company/contact SQL errors return exact copy before any upload or Auth', async t => {
  const state = fixture(t);
  for (const [code, payload, status, message] of [
    ['COMPANY_EXISTS', { ok: false, code: 'COMPANY_EXISTS' }, 200, '등록되어 있는 상사입니다. 채팅으로 문의 부탁드립니다'],
    ['CONTACT_EXISTS', { code: '23505', message: 'CONTACT_EXISTS' }, 400, '가입된 이메일 또는 휴대번 입니다.'],
    ['COMPANY_EXISTS', { code: 'P0001', message: 'registration COMPANY_EXISTS constraint' }, 400, '등록되어 있는 상사입니다. 채팅으로 문의 부탁드립니다']
  ]) { state.prepare = payload; state.prepareStatus = status; const result = await call(form()); assert.equal(result.status, 409); assert.deepEqual(result.body, { ok: false, code, error: message }); assertPrivate(result); }
  assert.equal(state.uploads.length, 0); assert.equal(state.authCalls.length, 0); assert.equal(state.deletes.length, 0); assert(!actions(state).some(path => path.endsWith('/snote_registration_cancel')));
});
test('unrecognized database text is never reflected or classified as a contact duplicate', async t => {
  const state = fixture(t, { prepare: { code: '23505', message: 'unrelated private constraint ' + ENV.SUPABASE_SERVICE_ROLE_KEY }, prepareStatus: 400 });
  const result = await call(form()); assert.equal(result.status, 502); assert.equal(result.body.code, 'UPSTREAM_ERROR'); assertPrivate(result); assert.equal(state.authCalls.length, 0); assert.equal(state.uploads.length, 0);
});
test('known upload failure cancels before deleting exactly the attempted manifest paths', async t => {
  const state = fixture(t, { override(call, state) { if (call.url.pathname.startsWith('/storage/v1/object/') && call.init.method === 'POST' && state.uploads.length === 1) return reply({ private: ENV.SUPABASE_SERVICE_ROLE_KEY }, 400); } });
  const result = await call(form()); assert.equal(result.status, 502); assertPrivate(result); assert.equal(state.authCalls.length, 0);
  const cancellation = state.calls.findIndex(c => c.url.pathname.endsWith('/snote_registration_cancel')), deletion = state.calls.findIndex(c => c.init.method === 'DELETE'); assert(cancellation > 0 && deletion > cancellation);
  assert.deepEqual(state.deletes, [{ prefixes: state.prepared.p_documents.map(document => document.path) }]);
});
test('cancellation false preserves completed evidence after a known failure', async t => {
  const state = fixture(t, { ready: { ok: false, code: 'REGISTRATION_CONFLICT' }, cancel: { ok: true, cancelled: false } });
  const result = await call(form()); assert.equal(result.status, 409); assert.equal(state.uploads.length, 2); assert.equal(state.authCalls.length, 0); assert.equal(state.deletes.length, 0); assertPrivate(result);
});
test('a lost upload reply is cancellable but cleanup never runs if cancellation cannot be confirmed', async t => {
  const state = fixture(t, { override(call) { if (call.url.pathname.includes('/storage/v1/object/') && call.init.method === 'POST' || call.url.pathname.endsWith('/snote_registration_cancel')) throw Error('Synthetic network interruption'); } });
  const result = await call(form()); assert.equal(result.status, 502); assert.equal(state.deletes.length, 0); assert.equal(state.authCalls.length, 0); assertPrivate(result);
});
test('immediate Auth sessions return only session fields, with no auto-login or completion RPC', async t => {
  const state = fixture(t, { auth: { user: { id: ID, email: 'new.user@example.invalid', identities: [{}], private: 'not-for-browser' }, access_token: JWT, refresh_token: 'synthetic-refresh-token', expires_in: 3600, token_type: 'bearer', extra: 'not-for-browser' } });
  const result = await call(form()); assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true, email: 'new.user@example.invalid', confirmationRequired: false, session: { access_token: JWT, refresh_token: 'synthetic-refresh-token', expires_in: 3600, token_type: 'bearer' } }); assertPrivate(result);
  assert.equal(state.authCalls.length, 1); assert(!actions(state).some(path => /token|user$|complete/.test(path))); assert.equal(state.deletes.length, 0);
});
test('Auth duplicate identities and known duplicate4xx cancel evidence; sender restriction is not a duplicate', async t => {
  const state = fixture(t);
  for (const auth of [
    { status: 200, body: { id: ID, email: 'new.user@example.invalid', identities: [] }, code: 'CONTACT_EXISTS' },
    { status: 422, body: { code: 'email_exists', private: ENV.SUPABASE_SERVICE_ROLE_KEY }, code: 'CONTACT_EXISTS' },
    { status: 400, body: { error_code: 'user_already_exists', msg: 'User already registered' }, code: 'CONTACT_EXISTS' },
    { status: 400, body: { code: 'email_address_not_authorized', message: 'not a duplicate' }, code: 'AUTH_REJECTED' }
  ]) { state.auth = auth.body; state.authStatus = auth.status; const start = state.calls.length, result = await call(form()); assert.equal(result.body.code, auth.code); assertPrivate(result); const calls = state.calls.slice(start); assert.equal(calls.filter(c => c.url.pathname === '/auth/v1/signup').length, 1); assert(calls.some(c => c.url.pathname.endsWith('/snote_registration_cancel'))); assert(calls.some(c => c.init.method === 'DELETE')); }
});
test('Auth5xx, malformed success and invalid sessions preserve pending evidence and never retry', async t => {
  const state = fixture(t);
  for (const auth of [
    { status: 503, body: { private: ENV.SUPABASE_SERVICE_ROLE_KEY } }, { status: 200, body: { unexpected: 'success' } },
    { status: 200, body: { user: { id: ID, email: 'someone-else@example.invalid' }, access_token: JWT, refresh_token: 'synthetic-refresh' } },
    { status: 200, body: { user: { id: ID, email: 'new.user@example.invalid' }, access_token: JWT, refresh_token: ENV.SUPABASE_SERVICE_ROLE_KEY } }
  ]) { state.auth = auth.body; state.authStatus = auth.status; const start = state.calls.length, result = await call(form()); assert.equal(result.status, 503); assert.equal(result.body.code, 'AUTH_STATUS_UNKNOWN'); assertPrivate(result); const calls = state.calls.slice(start); assert.equal(calls.filter(c => c.url.pathname === '/auth/v1/signup').length, 1); assert(!calls.some(c => c.url.pathname.endsWith('/snote_registration_cancel') || c.init.method === 'DELETE')); }
});
test('Auth network loss and timeout are uncertain after sending and retain all pending evidence', async t => {
  const state = fixture(t);
  for (const kind of ['Error', 'AbortError']) { state.authThrow = kind; const start = state.calls.length, result = await call(form()); assert.equal(result.status, 503); assert.equal(result.body.code, 'AUTH_STATUS_UNKNOWN'); assertPrivate(result); const calls = state.calls.slice(start); assert.equal(calls.filter(c => c.url.pathname === '/auth/v1/signup').length, 1); assert(!calls.some(c => c.url.pathname.endsWith('/snote_registration_cancel') || c.init.method === 'DELETE')); }
});
test('redirects never forward secret headers; redirects after Auth are uncertain and keep evidence', async t => {
  const state = fixture(t, { override(call) { if (call.url.pathname === '/auth/v1/signup') return new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid/steal' } }); } });
  const result = await call(form()); assert.equal(result.body.code, 'AUTH_STATUS_UNKNOWN'); assertPrivate(result); assert(!actions(state).some(path => path.endsWith('/snote_registration_cancel') || path === '/steal')); assert.equal(state.deletes.length, 0);
});
test('invalid fields, metadata overrides and duplicated multipart fields fail before prepare', async t => {
  const state = fixture(t);
  const bad = [form({ profile: { ...PROFILE, kind: 'admin' } }), form({ profile: { ...PROFILE, role: 'admin' } }), form({ profile: { ...PROFILE, email: 'not-an-email' } }), form({ password: 'too-short' }), form({ extra: [['password', PASSWORD]] }), ...['emailRedirectTo', 'redirectTo', 'redirect_to'].map(key => form({ extra: [[key, 'https://foreign.invalid']] })), form({ business: null }), form({ dealer: null }), form({ business: null, dealer: null })];
  for (const body of bad) { const result = await call(body); assert.equal(result.status, 400); assert.equal(result.body.code, 'INVALID_REQUEST'); assertPrivate(result); }
  assert.equal(state.prepared, null); assert.equal(state.uploads.length, 0); assert.equal(state.authCalls.length, 0);
});
test('empty, oversized, mismatched and truncated image evidence is rejected with bounded parsing', async t => {
  const state = fixture(t);
  for (const [file, status] of [
    [{ bytes: new Uint8Array(), type: 'image/png', name: 'empty.png' }, 400],
    [{ bytes: Buffer.alloc(5 * 1024 * 1024 + 1), type: 'image/png', name: 'large.png' }, 413],
    [{ bytes: '<svg xmlns="http://www.w3.org/2000/svg"/>', type: 'image/svg+xml', name: 'drawing.svg' }, 415],
    [{ bytes: '%PDF-1.7 fake', type: 'application/pdf', name: 'document.pdf' }, 415],
    [{ bytes: PNG, type: 'image/jpeg', name: 'mismatch.jpg' }, 415],
    [{ bytes: PNG.subarray(0, 33), type: 'image/png', name: 'truncated.png' }, 415],
    [{ bytes: JPEG.subarray(0, JPEG.length - 2), type: 'image/jpeg', name: 'truncated.jpg' }, 415],
    [{ bytes: WEBP.subarray(0, WEBP.length - 2), type: 'image/webp', name: 'truncated.webp' }, 415],
    [{ bytes: PNG, type: 'image/png', name: '../private.png' }, 400]
  ]) { const result = await call(form({ business: file })); assert.equal(result.status, status, file.name); assertPrivate(result); }
  assert.equal(state.prepared, null); assert.equal(state.uploads.length, 0); assert.equal(state.authCalls.length, 0);
});
test('total request limits count actual streamed bytes instead of trusting Content-Length', async t => {
  const state = fixture(t), maximum = 12 * 1024 * 1024;
  const declared = await call(form(), { headers: { 'Content-Length': String(maximum + 1) } }); assert.equal(declared.status, 413); assert.equal(state.calls.length, 0);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maximum + 1)); controller.close(); } });
  const result = await call(undefined, { raw: stream, headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic', 'Content-Length': '1' } });
  assert.equal(result.status, 413); assert.equal(result.body.code, 'PAYLOAD_TOO_LARGE'); assertPrivate(result); assert.equal(state.calls.length, 1); assert(state.calls[0].url.pathname.endsWith('/snote_registration_rate_limit'));
});
test('JSON company check is strict and small, and never accepts private signup fields', async t => {
  const state = fixture(t);
  for (const body of [{ action: 'signup', companyName: '합성' }, { action: 'check-company', companyName: '합성', email: 'private@example.invalid' }, { action: 'check-company', companyName: '' }]) assert.equal((await call(body)).status, 400);
  const large = await call(undefined, { raw: JSON.stringify({ action: 'check-company', companyName: 'x'.repeat(5000) }), headers: { 'Content-Type': 'application/json' } }); assert.equal(large.status, 413); assert.equal(state.calls.length, 0);
});
test('multipart uses its 30-second body budget and a stalled upload is cancelled without preparing or sending Auth', async t => {
  const state = fixture(t), original = globalThis.setTimeout; let bodyTimer, cancelled = false;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 30000) { bodyTimer = delay; return original(callback, 1, ...args); }
    return original(callback, delay, ...args);
  };
  t.after(() => { globalThis.setTimeout = original; });
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const result = await call(undefined, { raw: stream, headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' } });
  assert.equal(bodyTimer, 30000); assert.equal(result.status, 408); assert.equal(result.body.code, 'REQUEST_TIMEOUT'); assert.equal(cancelled, true);
  assertPrivate(result); assert.equal(state.calls.length, 1); assert.equal(state.prepared, null); assert.equal(state.authCalls.length, 0);
});
test('over-limit image dimensions are rejected before application reservation even with a correct image header CRC', async t => {
  const state = fixture(t), pixels = Buffer.from(PNG);
  pixels.writeUInt32BE(10000, 16); pixels.writeUInt32BE(5000, 20);
  let checksum = 0xffffffff;
  for (const byte of pixels.subarray(12, 29)) { checksum ^= byte; for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ checksum >>> 1 : checksum >>> 1; }
  pixels.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, 29);
  const result = await call(form({ business: { bytes: pixels, type: 'image/png', name: 'synthetic-50-megapixels.png' } }));
  assert.equal(result.status, 415); assert.equal(result.body.code, 'UNSUPPORTED_MEDIA_TYPE'); assertPrivate(result); assert.equal(state.prepared, null); assert.equal(state.authCalls.length, 0);
});
test('the persistent budget falls back to the service-key HMAC without storing an untrusted forwarded address', async t => {
  const state = fixture(t), env = { ...ENV }; delete env.CUSTOMER_INTAKE_OTP_SECRET;
  const result = await call({ action: 'check-company', companyName: '합성 회사' }, { env, headers: { 'CF-Connecting-IP': 'invalid-address', 'X-Forwarded-For': '203.0.113.99' } });
  assert.equal(result.status, 200); assertPrivate(result);
  assert.deepEqual(state.calls[0].body, { p_key: createHmac('sha256', ENV.SUPABASE_SERVICE_ROLE_KEY).update('snote-registration-rate:v1:unidentified').digest('hex'), p_action: 'check-company' });
});
