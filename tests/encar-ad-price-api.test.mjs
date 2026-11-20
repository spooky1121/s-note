import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncarAdPriceHandler } from '../functions/api/encar-ad-price.js';

// Synthetic Auth, live-member read and provider fixtures; no business writes or
// production account, credential, browser launch or external page is involved.
const ID = '43123456', PLATE = '28오6877', USER = '11111111-1111-4111-8111-111111111111', COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENV = { SUPABASE_URL: 'https://encar-price-fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' };
const TOKEN = 'synthetic.header.signature', MEMBER = { user_id: USER, company_id: COMPANY, role: 'dealer', active: true };
const originals = new WeakMap();
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const good = () => ({ id: ID, plate: PLATE, priceWon: 54900000, checkedAt: new Date().toISOString(), source: 'encar', raw: 'PRIVATE_HTML', token: 'PRIVATE_SECRET' });
function request(body = { id: ID, plate: PLATE }, { method = 'POST', headers = {}, raw, signal } = {}) {
  return new Request('https://snote.example/api/encar-ad-price', { method, headers: { Origin: 'https://snote.example', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...headers }, ...(['GET', 'HEAD'].includes(method) ? {} : { body: raw ?? JSON.stringify(body) }), ...(signal ? { signal } : {}) });
}
function fixture(t, config = {}) {
  const calls = [], lookups = [];
  if (!originals.has(t)) { originals.set(t, globalThis.fetch); t.after(() => { globalThis.fetch = originals.get(t); originals.delete(t); }); }
  globalThis.fetch = async (value, init) => {
    const url = new URL(value); calls.push({ url, init });
    assert.equal(url.origin, ENV.SUPABASE_URL); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store'); assert.equal(init.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY); assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    if (url.pathname === '/auth/v1/user') return config.auth?.() ?? json(config.user === undefined ? { id: USER, user_metadata: { role: 'admin', secret: 'PRIVATE' } } : config.user);
    assert.equal(url.pathname, '/rest/v1/zc_members'); assert.equal(url.searchParams.get('user_id'), 'eq.' + USER); assert.equal(url.searchParams.get('active'), 'eq.true'); assert.equal(url.searchParams.get('limit'), '1');
    return json(config.members === undefined ? [MEMBER] : config.members);
  };
  const lookup = async args => { lookups.push(args); assert.equal(calls.length, 2); assert.equal(args.id, ID); assert.equal(args.plate, PLATE); assert.equal(args.env, ENV); assert.equal(args.signal.aborted, false); return config.lookup ? config.lookup(args) : good(); };
  return { calls, lookups, handler: createEncarAdPriceHandler({ lookup }) };
}
async function run(handler, req = request(), env = ENV) {
  const response = await handler({ request: req, env }); assert.match(response.headers.get('Cache-Control'), /no-store.*private/u); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin'); return { response, status: response.status, body: await response.json() };
}

test('authenticated active staff receive only a same-ID same-plate integer-WON native quote', async t => {
  const f = fixture(t), result = await run(f.handler); assert.equal(result.status, 200); assert.deepEqual(Object.keys(result.body).sort(), ['checkedAt', 'id', 'ok', 'plate', 'priceWon', 'source']); assert.equal(result.body.priceWon, 54900000); assert.equal(result.body.id, ID); assert.equal(result.body.plate, PLATE); assert.equal(result.body.source, 'encar'); assert.equal(f.lookups.length, 1);
  assert(!JSON.stringify(result.body).includes('PRIVATE')); assert.equal(f.calls.length, 2);
});
test('new endpoint is POST-only and same-origin before any auth or provider traffic', async t => {
  const f = fixture(t);
  for (const method of ['GET', 'HEAD', 'DELETE', 'OPTIONS']) assert.equal((await run(f.handler, request({}, { method }))).status, 405);
  for (const headers of [{ Origin: 'https://foreign.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) assert.equal((await run(f.handler, request(undefined, { headers }))).status, 403);
  assert.equal(f.calls.length, 0); assert.equal(f.lookups.length, 0);
});
test('URL, legacy fields, malformed numbers, extra keys and incomplete plates are rejected before auth', async t => {
  const f = fixture(t);
  for (const body of [null, [], {}, { id: ID }, { id: Number(ID), plate: PLATE }, { id: '00000000', plate: PLATE }, { id: ID, plate: '6877' }, { id: ID, plate: PLATE, url: 'https://foreign.invalid' }, { id: ID, plate: PLATE, priceWon: 1 }, { url: 'https://fem.encar.com/cars/detail/' + ID, plate: PLATE }, { id: ID, plate: '가'.repeat(41) }]) assert.equal((await run(f.handler, request(body))).status, 400);
  assert.equal((await run(f.handler, request(null, { raw: '{broken' }))).status, 400); assert.equal(f.calls.length, 0); assert.equal(f.lookups.length, 0);
});
test('bearer, content type, encoding and bounded request bytes reject traffic before lookup', async t => {
  const f = fixture(t);
  assert.equal((await run(f.handler, request(undefined, { headers: { Authorization: '' } }))).status, 401);
  assert.equal((await run(f.handler, request(undefined, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await run(f.handler, request(undefined, { headers: { 'Content-Encoding': 'gzip' } }))).status, 415);
  assert.equal((await run(f.handler, request(undefined, { headers: { 'Content-Length': '2049' } }))).status, 413);
  assert.equal((await run(f.handler, request(undefined, { raw: 'x'.repeat(2049) }))).status, 413);
  assert.equal(f.calls.length, 0); assert.equal(f.lookups.length, 0);
});
test('inactive or foreign membership and metadata admin cannot authorize native price requests', async t => {
  for (const members of [[], null, [{ ...MEMBER, active: false }], [{ ...MEMBER, user_id: COMPANY }], [{ ...MEMBER, company_id: 'bad' }], [{ ...MEMBER, role: 'operator' }]]) {
    const f = fixture(t, { members }), result = await run(f.handler); assert.equal(result.status, 403); assert.equal(result.body.code, 'STAFF_REQUIRED'); assert.equal(f.lookups.length, 0);
  }
});
test('native read is available to all supported live staff roles without accepting anonymous Auth', async t => {
  for (const role of ['admin', 'dealer', 'accountant']) { const f = fixture(t, { members: [{ ...MEMBER, role }] }); assert.equal((await run(f.handler)).status, 200); }
  for (const user of [null, { id: 'bad' }, { id: USER, is_anonymous: true }]) { const f = fixture(t, { user }); assert.equal((await run(f.handler)).status, 401); assert.equal(f.lookups.length, 0); }
});
test('mismatched, unverified, fractional, stale or non-native quotes never reach the UI', async t => {
  for (const change of [{ id: '43999999' }, { plate: '12가3456' }, { source: 'gloar' }, { priceWon: 0 }, { priceWon: -1 }, { priceWon: 1.1 }, { priceWon: 1e13 }, { priceWon: '54900000' }, { checkedAt: 'bad' }, { checkedAt: '2020-01-01T00:00:00.000Z' }, { checkedAt: new Date(Date.now() + 3600000).toISOString() }]) {
    const f = fixture(t, { lookup: () => ({ ...good(), ...change }) }), result = await run(f.handler); assert.equal(result.status, 502); assert.equal(result.body.code, 'ENCAR_PRICE_UNVERIFIED'); assert(!('priceWon' in result.body));
  }
});
test('fixed stage failures retain quota timing while stripping every provider exception and secret', async t => {
  for (const [code, status] of [['ENCAR_VEHICLE_MISMATCH', 502], ['ENCAR_NOT_ADVERTISING', 502], ['ENCAR_PRICE_AMBIGUOUS', 502], ['LOOKUP_NOT_CONFIGURED', 503], ['BROWSER_BUSY', 503], ['UPSTREAM_RATE_LIMITED', 429], ['BROWSER_DAILY_LIMIT', 429], ['ENCAR_RATE_LIMITED', 429], ['BROWSER_AUTH_FAILED', 502]]) {
    const f = fixture(t, { lookup: () => { throw Object.assign(Error('PRIVATE_TOKEN https://secret.invalid'), { code, retryAfter: 27 }); } }), result = await run(f.handler); assert.equal(result.status, status); assert.equal(result.body.code, code); assert(!JSON.stringify(result.body).includes('PRIVATE')); assert(!JSON.stringify(result.body).includes('secret.invalid')); if (status === 429 || code === 'BROWSER_BUSY') assert.equal(result.response.headers.get('Retry-After'), '27');
  }
});
test('unclassified provider exceptions and redirects never disclose raw responses', async t => {
  const f = fixture(t, { lookup: () => { throw Error('PRIVATE_TOKEN https://secret.invalid'); } }), result = await run(f.handler); assert.equal(result.status, 502); assert.equal(result.body.code, 'ENCAR_PRICE_UNAVAILABLE'); assert(!JSON.stringify(result.body).includes('PRIVATE'));
  const g = fixture(t, { auth: () => new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid' } }) }); assert.equal((await run(g.handler)).body.code, 'AUTH_UNAVAILABLE'); assert.equal(g.lookups.length, 0);
});
test('full Korean plate formatting is normalized without weakening the ID type or passing extra request data', async t => {
  const f = fixture(t), result = await run(f.handler, request({ id: ID, plate: ' ２８오-６８７７ ' })); assert.equal(result.status, 200); assert.deepEqual(Object.keys(f.lookups[0]).sort(), ['env', 'id', 'plate', 'signal', 'waitUntil']);
});
test('caller cancellation aborts price work and cannot return a success after late provider resolution', async t => {
  const controller = new AbortController(), f = fixture(t, { lookup: () => { controller.abort(); return good(); } }), result = await run(f.handler, request(undefined, { signal: controller.signal })); assert.equal(result.status, 408); assert.equal(result.body.code, 'REQUEST_ABORTED'); assert(!('priceWon' in result.body));
});
