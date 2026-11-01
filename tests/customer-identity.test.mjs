import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { onRequest } from '../functions/api/customer-identity.js';

// Every upstream request is intercepted; no production reads/writes or SMS.
const ENV = { SUPABASE_URL: 'https://identity-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-public-key', CUSTOMER_INTAKE_OTP_SECRET: 'test-only-existing-server-secret-with-at-least-32-characters' };
const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const VALUE = '9001011234567';
const KEY = Buffer.from(hkdfSync('sha256', Buffer.from(ENV.CUSTOMER_INTAKE_OTP_SECRET), Buffer.from('snote-customer-intake:rrn:v1:hkdf-salt'), Buffer.from('snote-customer-intake:rrn:v1:aes-256-gcm'), 32));
const answer = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const member = { user_id: USER, company_id: COMPANY, role: 'dealer', active: true, rrn_enabled: false };
function envelope(value, { company = COMPANY, owner = USER, carId = 'car-1', key = KEY } = {}) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('snote-manual-identity:v1:' + JSON.stringify([company, owner, carId])));
  const encrypted = Buffer.concat([cipher.update(value), cipher.final(), cipher.getAuthTag()]);
  return `smi1.${iv.toString('hex')}.${encrypted.toString('hex')}`;
}
function mock(t, handler) {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.headers.Authorization, `Bearer ${JWT}`);
    const call = { url: new URL(url), options }; calls.push(call);
    return handler(call, calls);
  };
  t.after(() => { globalThis.fetch = previous; }); return calls;
}
function standard(call, { members = [member], customers = [], cars = [{ id: 'car-1' }] } = {}) {
  if (call.url.pathname === '/auth/v1/user') return answer({ id: USER });
  if (call.url.pathname === '/rest/v1/zc_members') { assert.equal(call.url.searchParams.get('user_id'), `eq.${USER}`); assert.equal(call.url.searchParams.get('active'), 'eq.true'); return answer(members); }
  assert.equal(call.url.searchParams.get('company_id'), `eq.${COMPANY}`);
  assert.equal(call.url.searchParams.get('owner_id'), `eq.${USER}`);
  if (call.url.pathname === '/rest/v1/zc_datasets') { assert.equal(call.url.searchParams.get('dataset'), 'eq.cars'); return answer([{ payload: cars }]); }
  if (call.url.pathname === '/rest/v1/zc_customers') return answer(customers);
  throw new Error('unexpected upstream');
}
async function call(body, { env = ENV, jwt = JWT, origin = 'https://s-note.example', method = 'POST', headers = {}, raw, stream } = {}) {
  const allHeaders = { 'Content-Type': 'application/json', ...headers };
  if (jwt) allHeaders.Authorization = `Bearer ${jwt}`;
  if (origin !== null) allHeaders.Origin = origin;
  const request = new Request('https://s-note.example/api/customer-identity', { method, headers: allHeaders, ...(method === 'GET' ? {} : { body: stream ?? raw ?? JSON.stringify(body), ...(stream ? { duplex: 'half' } : {}) }) });
  const result = await onRequest({ request, env }); return { result, body: await result.json() };
}

test('manual identity uses existing server key only, ignores company RRN flag, and independently encrypts 10/13 digits', async t => {
  const calls = mock(t, call => standard(call));
  for (const value of ['1234567890', VALUE]) {
    const result = await call({ action: 'encrypt', carId: 'car-1', value });
    assert.equal(result.result.status, 200); assert.equal(result.body.ok, true);
    assert.match(result.body.identityCipher, /^smi1\.[a-f0-9]{24}\.(?:[a-f0-9]{52}|[a-f0-9]{58})$/);
    assert.equal(JSON.stringify(result.body).includes(value), false);
    const [, iv, ciphertext] = result.body.identityCipher.split('.'); const bytes = Buffer.from(ciphertext, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'hex'));
    decipher.setAAD(Buffer.from('snote-manual-identity:v1:' + JSON.stringify([COMPANY, USER, 'car-1']))); decipher.setAuthTag(bytes.subarray(-16));
    assert.equal(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString(), value);
  }
  assert.equal(calls.filter(c => c.url.pathname === '/rest/v1/zc_datasets').length, 2);
  assert.ok(calls.every(c => !c.url.href.includes('solapi')));
  const health = await call(null, { method: 'GET' });
  assert.deepEqual(health.body, { service: 'snote-customer-identity', configured: true });
});

test('existing own customer permits encryption after its car was deleted; absent car and customer deny it', async t => {
  let existing = [{ car_id: 'deleted-car' }];
  const calls = mock(t, call => standard(call, { customers: existing, cars: [] }));
  assert.equal((await call({ action: 'encrypt', carId: 'deleted-car', value: VALUE })).result.status, 200);
  assert.equal(calls.some(c => c.url.pathname === '/rest/v1/zc_datasets'), false);
  existing = [];
  const denied = await call({ action: 'encrypt', carId: 'not-my-car', value: VALUE });
  assert.equal(denied.result.status, 403); assert.equal(denied.body.code, 'FORBIDDEN');
});

test('read uses only server-stored identity projection and returns missing values without legacy fallback', async t => {
  let customers = [{ car_id: 'car-1', identity: envelope(VALUE) }];
  const calls = mock(t, call => standard(call, { customers }));
  assert.deepEqual((await call({ action: 'read', carId: 'car-1' })).body, { ok: true, value: VALUE });
  const query = calls.at(-1).url.searchParams;
  assert.equal(query.get('select'), 'car_id,identity:payload->identityCipher');
  assert.equal(query.get('car_id'), 'eq.car-1');
  assert.equal(calls.some(c => c.url.pathname.includes('zc_read_rrn')), false);
  customers = [];
  assert.deepEqual((await call({ action: 'read', carId: 'car-1' })).body, { ok: true, value: '' });
  customers = [{ car_id: 'car-1', identity: null }];
  assert.deepEqual((await call({ action: 'read', carId: 'car-1' })).body, { ok: true, value: '' });
});

test('read-many is bounded, deduplicates IDs and safely quotes PostgREST IN filters', async t => {
  const tricky = 'quote",slash\\,comma)car';
  const calls = mock(t, call => standard(call, { customers: [{ car_id: tricky, identity: envelope('1234567890', { carId: tricky }) }, { car_id: 'car-1', identity: envelope(VALUE) }, { car_id: 'unrequested', identity: envelope(VALUE) }] }));
  const result = await call({ action: 'read-many', carIds: ['car-1', tricky, 'missing', 'car-1'] });
  assert.deepEqual(result.body, { ok: true, identities: [{ carId: 'car-1', value: VALUE }, { carId: tricky, value: '1234567890' }, { carId: 'missing', value: '' }] });
  assert.equal(calls.at(-1).url.searchParams.get('car_id'), 'in.("car-1","quote\\\",slash\\\\,comma)car","missing")');
  assert.equal(calls.at(-1).url.searchParams.get('limit'), '3');
  const before = calls.length;
  for (const carIds of [[], Array.from({ length: 101 }, (_, n) => `car-${n}`), ['ok', null]]) {
    assert.equal((await call({ action: 'read-many', carIds })).result.status, 400);
  }
  assert.equal(calls.length, before);
});

test('tampering and owner/company/car substitution fail with no plaintext, ciphertext, raw error or legacy request', async t => {
  let current;
  const valid = envelope(VALUE);
  const calls = mock(t, call => standard(call, { customers: [{ car_id: 'car-1', identity: current }] }));
  for (const cipher of [
    envelope(VALUE, { owner: OTHER }), envelope(VALUE, { company: OTHER }), envelope(VALUE, { carId: 'car-2' }),
    valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0'), 'invalid-private-ciphertext', { plaintext: VALUE },
    envelope(VALUE, { key: Buffer.alloc(32, 7) })
  ]) {
    current = cipher;
    const failure = await call({ action: 'read', carId: 'car-1' });
    assert.equal(failure.result.status, 502); assert.equal(failure.body.code, 'IDENTITY_DECRYPT_FAILED');
    assert.equal(JSON.stringify(failure.body).includes(VALUE), false);
    assert.equal(JSON.stringify(failure.body).includes('private-ciphertext'), false);
  }
  assert.equal(calls.some(c => c.url.pathname.includes('/rpc/')), false);
});

test('authentication and exact single active dealer/admin membership are required', async t => {
  let members = [member]; let authResponse;
  const calls = mock(t, call => call.url.pathname === '/auth/v1/user' && authResponse ? authResponse() : standard(call, { members }));
  assert.equal((await call({ action: 'read', carId: 'car-1' }, { jwt: null })).result.status, 401);
  assert.equal(calls.length, 0);
  for (const rows of [[], [member, { ...member, company_id: OTHER }], [{ ...member, active: false }], [{ ...member, user_id: OTHER }], [{ ...member, role: 'accountant' }]]) {
    members = rows; assert.equal((await call({ action: 'read', carId: 'car-1' })).result.status, 403);
  }
  authResponse = () => answer({ message: ENV.CUSTOMER_INTAKE_OTP_SECRET }, 401);
  const unauthorized = await call({ action: 'read', carId: 'car-1' });
  assert.equal(unauthorized.body.code, 'UNAUTHORIZED');
  assert.equal(JSON.stringify(unauthorized.body).includes(ENV.CUSTOMER_INTAKE_OTP_SECRET), false);
});

test('Origin, content type, 32 KiB streaming limit and unknown sensitive fields are checked without upstream calls', async t => {
  const calls = mock(t, () => { throw new Error('unexpected network'); });
  const request = { action: 'read', carId: 'car-1' };
  for (const [body, options, status] of [
    [request, { origin: 'https://evil.example' }, 403], [request, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [request, { headers: { 'Content-Type': 'text/plain' } }, 415], [request, { raw: '{' }, 400],
    [{ ...request, companyId: COMPANY }, {}, 400], [{ ...request, identityCipher: envelope(VALUE) }, {}, 400],
    [{ action: 'encrypt', carId: 'car-1', value: '900101-1234567' }, {}, 400], [{ action: 'encrypt', carId: 'car-1', value: '９００１０１１２３４５６７' }, {}, 400],
    [request, { method: 'DELETE' }, 405]
  ]) {
    const result = await call(body, options); assert.equal(result.result.status, status);
    assert.match(result.result.headers.get('Cache-Control'), /no-store.*private/);
    assert.equal(result.result.headers.get('Referrer-Policy'), 'no-referrer'); assert.equal(result.result.headers.has('Access-Control-Allow-Origin'), false);
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(33 * 1024))); controller.close(); } });
  assert.equal((await call(null, { stream })).result.status, 413);
  assert.equal(calls.length, 0);
});

test('manual upstream redirects are rejected and no credentials reach redirect targets', async t => {
  const calls = mock(t, () => new Response(null, { status: 302, headers: { Location: 'https://private-redirect.example' } }));
  const failure = await call({ action: 'read', carId: 'car-1' });
  assert.equal(failure.body.code, 'UPSTREAM_ERROR'); assert.equal(calls.length, 1);
  assert.equal(calls.some(c => c.url.hostname === 'private-redirect.example'), false);
});

test('lost or missing crypto configuration fails clearly while a newly added dedicated key can still read derived records', async t => {
  const calls = mock(t, call => standard(call, { customers: [{ car_id: 'car-1', identity: envelope(VALUE) }] }));
  const withDedicated = await call({ action: 'read', carId: 'car-1' }, { env: { ...ENV, CUSTOMER_INTAKE_RRN_KEY: 'a'.repeat(64) } });
  assert.deepEqual(withDedicated.body, { ok: true, value: VALUE });
  const lost = await call({ action: 'read', carId: 'car-1' }, { env: { ...ENV, CUSTOMER_INTAKE_OTP_SECRET: 'changed-test-only-existing-secret-at-least-32-characters' } });
  assert.equal(lost.body.code, 'IDENTITY_DECRYPT_FAILED');
  const missing = await call({ action: 'read', carId: 'car-1' }, { env: { ...ENV, CUSTOMER_INTAKE_OTP_SECRET: '' } });
  assert.equal(missing.body.code, 'RRN_SETUP_REQUIRED');
  assert.ok(calls.every(c => c.options.method === 'GET'));
});
