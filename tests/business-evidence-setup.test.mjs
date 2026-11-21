import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, onRequestPost } from '../functions/api/business-evidence-setup.js';

// All HTTP is intercepted. No Auth, Database, Storage or real upload is contacted.
const BUCKET = 'snote-business-private';
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ENV = { SUPABASE_URL: 'https://evidence-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-service-secret' };
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const SCOPE = { companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownerId: '11111111-1111-4111-8111-111111111111', carId: 'private-evidence-car', evidenceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', entryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const POLICY = { id: BUCKET, name: BUCKET, public: false, file_size_limit: 10485760, allowed_mime_types: MIME };
const evidence = extra => ({ id: SCOPE.evidenceId, entryId: SCOPE.entryId, bucket: BUCKET, state: 'pending', path: 'PRIVATE_OBJECT_PATH', name: 'PRIVATE_CUSTOMER_FILE.pdf', ...extra });
const answer = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(t, { authorized = evidence(), rpcStatus = 200, storage = [answer(POLICY)] } = {}) {
  const calls = [], queue = [...storage], original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url), payload = options.body === undefined ? undefined : JSON.parse(options.body);
    assert.equal(parsed.origin, ENV.SUPABASE_URL, 'Every upstream destination stays on the configured project');
    assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store'); assert(options.signal instanceof AbortSignal);
    const call = { path: parsed.pathname, method: options.method, headers: options.headers, payload }; calls.push(call);
    if (parsed.pathname === '/rest/v1/rpc/snote_business_evidence') {
      assert.equal(options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY); assert.equal(options.headers.Authorization, 'Bearer ' + JWT);
      assert.equal(options.method, 'POST'); return answer(authorized, rpcStatus);
    }
    assert(calls[0]?.path === '/rest/v1/rpc/snote_business_evidence', 'Privileged Storage access must follow canonical authorization');
    assert.equal(options.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY); assert.equal(options.headers.Authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert(['/storage/v1/bucket/' + BUCKET, '/storage/v1/bucket'].includes(parsed.pathname));
    const next = queue.shift(); assert(next, 'No unplanned upstream requests are permitted');
    if (next instanceof Error) throw next;
    return next;
  };
  t.after(() => { globalThis.fetch = original; });
  return { calls, queue };
}
async function call(value = SCOPE, { method = 'POST', env = ENV, token = JWT, headers = {}, raw, endpoint = onRequest } = {}) {
  const request = new Request('https://snote.example/api/business-evidence-setup', { method, headers: {
    'Content-Type': 'application/json', Origin: 'https://snote.example', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers
  }, ...(['GET', 'HEAD'].includes(method) ? {} : { body: raw === undefined ? JSON.stringify(value) : raw }) });
  const response = await endpoint({ request, env }); return { response, data: await response.json() };
}
function secureResponse(result) {
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store, private, max-age=0');
  assert.equal(result.response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(result.response.headers.get('X-Content-Type-Options'), 'nosniff');
  const text = JSON.stringify(result.data);
  for (const secret of [JWT, ENV.SUPABASE_SERVICE_ROLE_KEY, 'PRIVATE_OBJECT_PATH', 'PRIVATE_CUSTOMER_FILE', 'PRIVATE_SQL_DETAILS']) assert(!text.includes(secret));
}
function noService(calls) { assert(calls.every(call => call.headers.apikey !== ENV.SUPABASE_SERVICE_ROLE_KEY)); }

test('an authorized pending evidence reservation can verify an existing private bucket without writing anything', async t => {
  const f = fixture(t), result = await call();
  assert.equal(result.response.status, 200); assert.deepEqual(result.data, { ok: true, bucket: BUCKET }); secureResponse(result);
  assert.deepEqual(f.calls.map(c => [c.path, c.method]), [['/rest/v1/rpc/snote_business_evidence', 'POST'], ['/storage/v1/bucket/' + BUCKET, 'GET']]);
  assert.deepEqual(f.calls[0].payload, { p_company: SCOPE.companyId, p_owner: SCOPE.ownerId, p_car_id: SCOPE.carId, p_action: 'read', p_id: SCOPE.evidenceId, p_entry_id: SCOPE.entryId, p_meta: null });
});

test('ready evidence and reordered exact MIME policies remain valid', async t => {
  fixture(t, { authorized: evidence({ state: 'ready' }), storage: [answer({ ...POLICY, allowed_mime_types: [...MIME].reverse() })] });
  const result = await call(); assert.equal(result.response.status, 200); secureResponse(result);
});

test('a missing bucket is created privately with exactly the allowed limits, then read back', async t => {
  const f = fixture(t, { storage: [answer({ statusCode: '404' }, 404), answer({ name: BUCKET }, 201), answer(POLICY)] });
  const result = await call(); assert.equal(result.response.status, 200); secureResponse(result);
  assert.deepEqual(f.calls.slice(1).map(c => [c.path, c.method]), [['/storage/v1/bucket/' + BUCKET, 'GET'], ['/storage/v1/bucket', 'POST'], ['/storage/v1/bucket/' + BUCKET, 'GET']]);
  assert.deepEqual(f.calls[2].payload, { id: BUCKET, name: BUCKET, public: false, file_size_limit: 10485760, allowed_mime_types: MIME });
  assert(f.calls.every(c => !/objects|zc_write_dataset|vehicle_write/.test(c.path)), 'Provisioning cannot transfer files or change vehicle records');
});

test('a create race is accepted only after the winning private bucket passes canonical readback', async t => {
  const f = fixture(t, { storage: [answer({ statusCode: '404' }, 404), answer({ statusCode: '409', message: 'PRIVATE_SQL_DETAILS' }, 409), answer(POLICY)] });
  const result = await call(); assert.equal(result.response.status, 200); assert.equal(f.calls.length, 4); secureResponse(result);
});

test('legacy Storage HTTP400 not-found/conflict envelopes are bounded to their known codes', async t => {
  fixture(t, { storage: [answer({ statusCode: '404' }, 400), answer({ statusCode: '409' }, 400), answer(POLICY)] });
  const result = await call(); assert.equal(result.response.status, 200); secureResponse(result);
});

test('wrong methods, foreign origins, missing bearer and non-JSON requests never reach Supabase', async t => {
  const f = fixture(t);
  for (const [options, status] of [
    [{ method: 'GET' }, 405], [{ method: 'DELETE' }, 405], [{ method: 'GET', endpoint: onRequestPost }, 405],
    [{ headers: { Origin: 'https://foreign.example' } }, 403], [{ headers: { 'Sec-Fetch-Site': 'same-site' } }, 403],
    [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403], [{ token: null }, 401], [{ token: 'invalid' }, 401],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415]
  ]) { const result = await call(SCOPE, options); assert.equal(result.response.status, status); secureResponse(result); }
  assert.equal(f.calls.length, 0);
});

test('only the exact reservation scope is accepted; paths, caller-selected bucket and malformed IDs are rejected', async t => {
  const f = fixture(t);
  for (const value of [null, [], { ...SCOPE, path: 'attacker/path' }, { ...SCOPE, bucket: 'public' }, { ...SCOPE, service: 'client-secret' },
    { ...SCOPE, companyId: 'bad' }, { ...SCOPE, ownerId: null }, { ...SCOPE, evidenceId: '' }, { ...SCOPE, entryId: 'bad' },
    { ...SCOPE, carId: ' padded' }, { ...SCOPE, carId: 'line\nbreak' }, { ...SCOPE, carId: 'x'.repeat(201) }]) {
    const result = await call(value); assert.equal(result.response.status, 400); secureResponse(result);
  }
  for (const raw of ['{', '', '{"__proto__":{}}']) assert.equal((await call(undefined, { raw })).response.status, 400);
  assert.equal(f.calls.length, 0);
});

test('declared and actual oversized bodies are rejected before any privileged operation', async t => {
  const f = fixture(t);
  assert.equal((await call(SCOPE, { headers: { 'Content-Length': '4097' } })).response.status, 413);
  assert.equal((await call(SCOPE, { headers: { 'Content-Length': 'invalid' } })).response.status, 413);
  assert.equal((await call(SCOPE, { raw: ' '.repeat(4097) })).response.status, 413);
  assert.equal(f.calls.length, 0);
});

test('configuration never permits arbitrary upstream hosts or malformed secrets', async t => {
  const f = fixture(t);
  for (const env of [{}, { ...ENV, SUPABASE_URL: 'https://attacker.example' }, { ...ENV, SUPABASE_URL: 'http://evidence-test.supabase.co' },
    { ...ENV, SUPABASE_URL: ENV.SUPABASE_URL + '/different' }, { ...ENV, SUPABASE_URL: 'https://user:pass@evidence-test.supabase.co' },
    { ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' }, { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'first\nsecond' }, { ...ENV, SUPABASE_PUBLISHABLE_KEY: '' }]) {
    const result = await call(SCOPE, { env }); assert.equal(result.response.status, 503); assert.equal(result.data.code, 'SETUP_REQUIRED'); secureResponse(result);
  }
  assert.equal(f.calls.length, 0);
});

for (const [name, record] of [
  ['missing', null], ['array', [evidence()]], ['wrong evidence', evidence({ id: SCOPE.entryId })], ['wrong entry', evidence({ entryId: SCOPE.evidenceId })],
  ['wrong bucket', evidence({ bucket: 'zc-vehicle-private' })], ['wrong state', evidence({ state: 'deleted' })]
]) test('a canonical reservation mismatch (' + name + ') cannot trigger a service-role operation', async t => {
  const f = fixture(t, { authorized: record }); const result = await call(); assert.equal(result.response.status, 403); assert.equal(f.calls.length, 1); noService(f.calls); secureResponse(result);
});

for (const [name, status, record, expected] of [
  ['expired JWT', 401, {}, 401], ['denied scope', 403, {}, 403], ['SQL access denied', 400, { code: '42501', details: 'PRIVATE_SQL_DETAILS' }, 403],
  ['missing RPC', 404, { code: 'PGRST202' }, 503], ['RPC failure', 500, { message: ENV.SUPABASE_SERVICE_ROLE_KEY }, 502]
]) test('authorization failure (' + name + ') is safe and never reaches Storage', async t => {
  const f = fixture(t, { authorized: record, rpcStatus: status }); const result = await call(); assert.equal(result.response.status, expected); assert.equal(f.calls.length, 1); noService(f.calls); secureResponse(result);
});

for (const [name, value] of [
  ['public bucket', { ...POLICY, public: true }], ['unlimited size', { ...POLICY, file_size_limit: null }], ['wrong size', { ...POLICY, file_size_limit: 5242880 }],
  ['wildcard MIME', { ...POLICY, allowed_mime_types: ['image/*', 'application/pdf'] }], ['extra MIME', { ...POLICY, allowed_mime_types: [...MIME, 'text/html'] }],
  ['duplicate MIME', { ...POLICY, allowed_mime_types: [MIME[0], MIME[0], MIME[1], MIME[2]] }], ['wrong identity', { ...POLICY, id: 'different' }]
]) test('existing policy mismatch (' + name + ') fails closed without editing the bucket', async t => {
  const f = fixture(t, { storage: [answer(value)] }); const result = await call(); assert.equal(result.response.status, 503); assert.equal(result.data.code, 'BUCKET_POLICY_MISMATCH');
  assert.deepEqual(f.calls.slice(1).map(c => c.method), ['GET']); secureResponse(result);
});

test('a race winner or newly created bucket with unsafe policy cannot be reported ready', async t => {
  fixture(t, { storage: [answer({}, 404), answer({}, 409), answer({ ...POLICY, public: true })] });
  const result = await call(); assert.equal(result.response.status, 503); assert.equal(result.data.code, 'BUCKET_POLICY_MISMATCH'); secureResponse(result);
});

test('Storage errors do not downgrade into a create attempt or disclose private upstream messages', async t => {
  const f = fixture(t, { storage: [answer({ statusCode: '404', message: ENV.SUPABASE_SERVICE_ROLE_KEY, path: 'PRIVATE_OBJECT_PATH' }, 500)] });
  const result = await call(); assert.equal(result.response.status, 502); assert.equal(f.calls.length, 2); secureResponse(result);
});

test('create failure cannot be mistaken for a race and performs no subsequent file request', async t => {
  const f = fixture(t, { storage: [answer({}, 404), answer({ statusCode: '409', message: 'PRIVATE_SQL_DETAILS' }, 500)] });
  const result = await call(); assert.equal(result.response.status, 502); assert.equal(f.calls.length, 3); secureResponse(result);
});

test('redirects, invalid JSON, network errors and oversized upstream replies fail without leaking response details', async t => {
  for (const storage of [
    [new Response('', { status: 302, headers: { Location: 'https://attacker.example' } })],
    [new Response('PRIVATE_SQL_DETAILS', { status: 200 })],
    [new Error('PRIVATE_SQL_DETAILS ' + JWT)], [answer({ message: 'x'.repeat(65537) })]
  ]) {
    const f = fixture(t, { storage }); const result = await call(); assert.equal(result.response.status, 502); assert.equal(f.calls.length, 2); secureResponse(result);
  }
});
