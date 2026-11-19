import test from 'node:test';
import assert from 'node:assert/strict';
import { createGloarSearchHandler, onRequest } from '../functions/api/gloar-search.js';

// Synthetic Auth/membership and browser/search transports. No production
// credentials, customer/vehicle rows or actual GLOAR requests are used.
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLATE = '28오6877';
const TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj';
const ENV = { SUPABASE_URL: 'https://gloar-test-fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key' };
const BROWSER_ENV = { ...ENV, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_BROWSER_TOKEN: 'PRIVATE_BROWSER_SECRET' };
const LINK = 'https://gloar-data.com/en/lot/tesla-model-y-synthetic-key';
const member = { user_id: USER, company_id: COMPANY, active: true, role: 'dealer' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const originals = new WeakMap();

function request(body = { plate: PLATE }, { method = 'POST', headers = {}, signal, raw } = {}) {
  return new Request('https://snote.example/api/gloar-search', { method,
    headers: { Origin: 'https://snote.example', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: raw ?? JSON.stringify(body) }), ...(signal ? { signal } : {}) });
}
function fixture(t, config = {}) {
  if (!originals.has(t)) { originals.set(t, globalThis.fetch); t.after(() => { globalThis.fetch = originals.get(t); originals.delete(t); }); }
  const state = { auth: [], opened: 0, searches: [], closed: 0 };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    state.auth.push({ url: url.href, options });
    assert.equal(url.origin, ENV.SUPABASE_URL, 'The API fixture never calls a provider, a price endpoint or an arbitrary origin');
    assert.equal(options.method, 'GET', 'Auth is read-only');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    if (url.pathname === '/auth/v1/user') return config.authResponse?.() ?? json(config.user === undefined ? { id: USER, user_metadata: { role: 'admin', secret: 'PRIVATE_METADATA' } } : config.user);
    assert.equal(url.pathname, '/rest/v1/zc_members');
    assert.equal(url.searchParams.get('user_id'), 'eq.' + USER);
    assert.equal(url.searchParams.get('active'), 'eq.true');
    assert.equal(url.searchParams.get('select'), 'user_id,company_id,role,active');
    assert.equal(url.searchParams.get('limit'), '1');
    return config.memberResponse?.() ?? json(config.members === undefined ? [member] : config.members);
  };
  state.browser = { newPage() { throw Error('The injected search must not actually navigate'); }, async close() { state.closed++; if (config.close) return config.close(); } };
  state.createBrowser = async (env, options) => {
    assert.equal(state.auth.length, 2, 'Live Auth and active membership precede a paid browser');
    assert.equal(options.signal.aborted, false);
    state.opened++;
    return config.open ? config.open(env, options, state) : state.browser;
  };
  state.search = async options => {
    assert.deepEqual(Object.keys(options).sort(), ['browser', 'plate', 'signal']);
    assert.equal(options.browser, state.browser);
    assert.equal(options.plate, PLATE);
    assert.equal(options.signal.aborted, false);
    state.searches.push(options);
    return config.search ? config.search(options, state) : { status: 'found', plate: PLATE, links: [{ url: LINK, title: 'Tesla Model Y' }], token: 'PRIVATE_RESULT', priceWon: 1 };
  };
  state.handler = createGloarSearchHandler({ createBrowser: state.createBrowser, search: state.search, ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}) });
  return state;
}
async function run(handler, req = request(), env = ENV) {
  const response = await handler({ request: req, env });
  assert.match(response.headers.get('Content-Type'), /^application\/json/u);
  assert.match(response.headers.get('Cache-Control'), /no-store.*private/u);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  return { response, status: response.status, body: await response.json() };
}
function noTraffic(state) { assert.equal(state.auth.length, 0); assert.equal(state.opened, 0); assert.equal(state.searches.length, 0); assert.equal(state.closed, 0); }

test('GLOAR configuration GET reports credential presence only without Auth or browser calls', async t => {
  const s = fixture(t);
  for (const [env, expected] of [[ENV, false], [BROWSER_ENV, true], [{ ...BROWSER_ENV, CLOUDFLARE_ACCOUNT_ID: 'bad' }, false], [{ ...BROWSER_ENV, CLOUDFLARE_BROWSER_TOKEN: ' ' }, false]]) {
    const r = await run(onRequest, request({}, { method: 'GET', headers: { Authorization: '' } }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, configured: expected, provider: 'gloar', release: '2.148' });
    for (const privateValue of ['PRIVATE', 'SUPABASE_URL', USER, COMPANY, TOKEN]) assert(!JSON.stringify(r.body).includes(privateValue));
  }
  noTraffic(s);
});
test('GLOAR found response contains only independently validated result links after active membership', async t => {
  const s = fixture(t), r = await run(s.handler);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, status: 'found', plate: PLATE, links: [{ url: LINK, title: 'Tesla Model Y' }] });
  assert.equal(s.auth.length, 2); assert.equal(s.opened, 1); assert.equal(s.searches.length, 1); assert.equal(s.closed, 1);
  for (const privateValue of ['PRIVATE', 'priceWon', USER, COMPANY, TOKEN]) assert(!JSON.stringify(r.body).includes(privateValue));
});
test('GLOAR full plate normalizes formatting and supports all active staff roles', async t => {
  for (const role of ['admin', 'dealer', 'accountant']) {
    const s = fixture(t, { members: [{ ...member, role }] });
    const r = await run(s.handler, request({ plate: ' ２８오-６８７７ ' }));
    assert.equal(r.status, 200); assert.equal(r.body.plate, PLATE); assert.equal(s.closed, 1);
  }
});
test('GLOAR POST never accepts client URL, code, cookies or extra fields', async t => {
  const s = fixture(t);
  for (const body of [null, [], 'string', {}, { plate: '' }, { plate: 28 }, { plate: '6877' }, { plate: 'bad' }, { plate: '가'.repeat(41) },
    { plate: PLATE, url: 'https://arbitrary.invalid' }, { plate: PLATE, code: 'alert(1)' }, { plate: PLATE, cookies: [] }, { plate: PLATE, provider: 'trust' }]) {
    assert.equal((await run(s.handler, request(body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await run(s.handler, request({}, { raw: '{bad' }))).status, 400);
  noTraffic(s);
});
test('GLOAR body size, content type, bearer syntax and origin reject before Auth', async t => {
  const s = fixture(t);
  for (const headers of [{ Origin: 'https://foreign.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) assert.equal((await run(s.handler, request({ plate: PLATE }, { headers }))).status, 403);
  for (const Authorization of ['', 'Basic private', 'Bearer plaintext', 'Bearer a.b.c extra']) assert.equal((await run(s.handler, request({ plate: PLATE }, { headers: { Authorization } }))).status, 401);
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]) assert.equal((await run(s.handler, request({ plate: PLATE }, { headers }))).status, 415);
  for (const headers of [{ 'Content-Length': '1025' }, { 'Content-Length': 'bad' }]) assert.equal((await run(s.handler, request({ plate: PLATE }, { headers }))).status, 413);
  assert.equal((await run(s.handler, request({ plate: '가'.repeat(400) }))).status, 413);
  for (const method of ['PUT', 'DELETE', 'OPTIONS']) assert.equal((await run(s.handler, request({}, { method }))).status, 405);
  noTraffic(s);
});
test('GLOAR user metadata never substitutes for live active membership', async t => {
  for (const members of [[], null, {}, [{ ...member, user_id: OTHER }], [{ ...member, active: false }], [{ ...member, role: 'operator' }], [{ ...member, company_id: 'bad' }]]) {
    const s = fixture(t, { members }), r = await run(s.handler);
    assert.equal(r.status, 403); assert.equal(r.body.code, 'STAFF_REQUIRED'); assert.equal(s.opened, 0); assert.equal(s.auth.length, 2);
  }
});
test('GLOAR anonymous, malformed and rejected Auth never opens a browser', async t => {
  for (const config of [{ user: null }, { user: { id: USER, is_anonymous: true } }, { user: { id: 'bad' } }, { authResponse: () => json({ secret: 'PRIVATE' }, 401) }]) {
    const s = fixture(t, config), r = await run(s.handler);
    assert.equal(r.status, 401); assert.equal(r.body.code, 'AUTH_FAILED'); assert.equal(s.opened, 0); assert.equal(s.auth.length, 1);
    assert(!JSON.stringify(r.body).includes('PRIVATE'));
  }
});
test('GLOAR Auth redirects, malformed responses and network failures fail closed', async t => {
  for (const response of [() => new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid' } }), () => json({}, 503), () => new Response('{broken'), () => { throw Error('PRIVATE_AUTH'); }, () => new Response('x'.repeat(65537))]) {
    const s = fixture(t, { authResponse: response }), r = await run(s.handler);
    assert.equal(r.status, 502); assert.equal(r.body.code, 'AUTH_UNAVAILABLE'); assert.equal(s.opened, 0); assert.equal(s.auth.length, 1);
    assert(!JSON.stringify(r.body).includes('PRIVATE')); assert(!JSON.stringify(r.body).includes('foreign.invalid'));
  }
});
test('GLOAR invalid server Auth config never sends bearer tokens to another host', async t => {
  const s = fixture(t);
  for (const env of [{ ...ENV, SUPABASE_URL: 'https://foreign.invalid' }, { ...ENV, SUPABASE_URL: 'http://gloar-test-fixture.supabase.co' }, { ...ENV, SUPABASE_PUBLISHABLE_KEY: '' }]) {
    assert.equal((await run(s.handler, request(), env)).status, 503);
  }
  noTraffic(s);
});
test('GLOAR default browser transport fails missing config without any external call', async t => {
  const s = fixture(t), r = await run(onRequest);
  assert.equal(r.status, 503); assert.equal(r.body.code, 'LOOKUP_NOT_CONFIGURED'); assert.equal(s.auth.length, 2); assert.equal(s.opened, 0);
});
test('GLOAR confirmed empty search is distinct from a provider error and always closes', async t => {
  const s = fixture(t, { search: () => ({ status: 'not_found' }) }), r = await run(s.handler);
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, status: 'not_found', plate: PLATE, links: [] }); assert.equal(s.closed, 1);
});
test('GLOAR output rejects plate mismatch or unverified/empty links', async t => {
  for (const result of [{ status: 'found', plate: '66너7230', links: [{ url: LINK }] }, { status: 'found', plate: PLATE, links: [] }, { status: 'found', plate: PLATE, links: [{ url: 'https://gloar-data.com/en/catalog' }] }]) {
    const s = fixture(t, { search: () => result }), r = await run(s.handler);
    assert.equal(r.status, 502); assert.equal(r.body.code, 'GLOAR_RESULT_UNVERIFIED'); assert(!('links' in r.body)); assert.equal(s.closed, 1);
  }
});
test('GLOAR independently filters foreign schemes, hosts, ports, credentials, fragments and invalid paths', async t => {
  const invalid = ['http://gloar-data.com/en/lot/abc', 'https://foreign.invalid/en/lot/abc', 'https://gloar-data.com.evil.invalid/en/lot/abc',
    'https://gloar-data.com:443/en/lot/abc', 'https://gloar-data.com:8443/en/lot/abc', 'https://name@gloar-data.com/en/lot/abc',
    'https://gloar-data.com/en/lot/abc#private', 'https://gloar-data.com/en/catalog', 'https://gloar-data.com/en/lot/abc/extra',
    'https://gloar-data.com/en/lot/%2e%2e', 'https://gloar-data.com/en/lot/with space', ' https://gloar-data.com/en/lot/abc'];
  const s = fixture(t, { search: () => ({ status: 'found', plate: PLATE, links: [...invalid.map(url => ({ url })), { url: LINK + '?token=PRIVATE', title: '<Tesla>\n Model Y' }, { url: LINK }] }) });
  const r = await run(s.handler); assert.equal(r.status, 200);
  assert.deepEqual(r.body.links, [{ url: LINK, title: 'Tesla Model Y' }]); assert(!JSON.stringify(r.body).includes('PRIVATE')); assert.equal(s.closed, 1);
});
test('GLOAR result count and title sizes remain bounded', async t => {
  const s = fixture(t, { search: () => ({ status: 'found', plate: PLATE, links: Array.from({ length: 10 }, (_, i) => ({ url: LINK + '-' + i, title: 'x'.repeat(500) })) }) });
  const r = await run(s.handler); assert.equal(r.body.links.length, 5); assert(r.body.links.every(link => link.title.length === 160));
});
test('GLOAR upstream rate limits and busy status preserve bounded Retry-After without raw errors', async t => {
  for (const [code, status] of [['UPSTREAM_RATE_LIMITED', 429], ['BROWSER_BUSY', 503]]) {
    const s = fixture(t, { open() { throw Object.assign(Error('PRIVATE_TOKEN'), { code, retryAfter: 27 }); } }), r = await run(s.handler);
    assert.equal(r.status, status); assert.equal(r.body.code, code); assert.equal(r.response.headers.get('Retry-After'), '27'); assert.equal(s.searches.length, 0); assert(!JSON.stringify(r.body).includes('PRIVATE'));
  }
  const s = fixture(t, { search: () => ({ status: 'error', code: 'UPSTREAM_RATE_LIMITED', retryAfter: 99999 }) }), r = await run(s.handler);
  assert.equal(r.status, 429); assert.equal(r.response.headers.get('Retry-After'), '3600'); assert.equal(s.closed, 1);
});
test('GLOAR raw exceptions and cleanup errors cannot leak or replace a valid response', async t => {
  let s = fixture(t, { search() { throw Error('PRIVATE_TOKEN https://secret.invalid'); } });
  let r = await run(s.handler); assert.equal(r.status, 502); assert.equal(r.body.code, 'PROVIDER_UNAVAILABLE'); assert.equal(s.closed, 1); assert(!JSON.stringify(r.body).includes('PRIVATE')); assert(!JSON.stringify(r.body).includes('secret.invalid'));
  s = fixture(t, { close() { throw Error('PRIVATE_CLEANUP'); } });
  r = await run(s.handler); assert.equal(r.status, 200); assert.equal(r.body.status, 'found'); assert.equal(s.closed, 1);
});
test('GLOAR shared transport failures retain their safe stage codes and hide raw page data', async t => {
  for (const code of ['GLOAR_NAVIGATION_BLOCKED', 'GLOAR_ACCESS_BLOCKED', 'GLOAR_SEARCH_UNSUPPORTED', 'GLOAR_RESULTS_UNCONFIRMED', 'GLOAR_UNAVAILABLE']) {
    const s = fixture(t, { search: () => ({ status: 'error', code, error: 'PRIVATE_PAGE_CONTENT', url: 'https://secret.invalid' }) });
    const r = await run(s.handler); assert.equal(r.status, 502); assert.equal(r.body.code, code); assert.equal(s.closed, 1);
    assert(!JSON.stringify(r.body).includes('PRIVATE')); assert(!JSON.stringify(r.body).includes('secret.invalid'));
  }
});
test('GLOAR status GET permits external document navigation but rejects cross-origin scripted fetches', async t => {
  const s = fixture(t);
  const navigation = new Request('https://snote.example/api/gloar-search', { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } });
  assert.equal((await run(onRequest, navigation, BROWSER_ENV)).status, 200);
  const scripted = new Request('https://snote.example/api/gloar-search', { headers: { Origin: 'https://foreign.invalid', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' } });
  assert.equal((await run(onRequest, scripted, BROWSER_ENV)).status, 403); noTraffic(s);
});
test('GLOAR times out an uncooperative search and releases its isolated browser once', async t => {
  const s = fixture(t, { timeoutMs: 20, search: () => new Promise(() => {}) });
  const r = await run(s.handler); assert.equal(r.status, 504); assert.equal(r.body.code, 'REQUEST_TIMEOUT'); assert.equal(s.closed, 1); assert.equal(s.searches[0].signal.aborted, true);
});
test('GLOAR request cancellation aborts an uncooperative search and releases it', async t => {
  const controller = new AbortController();
  const s = fixture(t, { search() { queueMicrotask(() => controller.abort()); return new Promise(() => {}); } });
  const r = await run(s.handler, request({ plate: PLATE }, { signal: controller.signal }));
  assert.equal(r.status, 408); assert.equal(r.body.code, 'REQUEST_ABORTED'); assert.equal(s.closed, 1); assert.equal(s.searches[0].signal.aborted, true);
});
test('GLOAR late browser creation is released after the deadline without a search', async t => {
  let resolve;
  const s = fixture(t, { timeoutMs: 15, open: () => new Promise(r => { resolve = r; }) });
  const r = await run(s.handler); assert.equal(r.status, 504); assert.equal(s.closed, 0); assert.equal(s.searches.length, 0);
  resolve(s.browser); await new Promise(r => setTimeout(r, 0)); assert.equal(s.closed, 1);
});
test('GLOAR retains Pages waitUntil receiver and performs no browser work for denied membership', async t => {
  const s = fixture(t), held = []; let context;
  const handler = createGloarSearchHandler({ search: s.search, createBrowser: async (env, { waitUntil }) => { waitUntil(Promise.resolve('metadata')); return s.browser; } });
  context = { request: request(), env: ENV, waitUntil(promise) { assert.equal(this, context); held.push(promise); } };
  const response = await handler(context); assert.equal(response.status, 200); assert.deepEqual(await Promise.all(held), ['metadata']); assert.equal(s.closed, 1);
  const denied = fixture(t, { members: [] }); const r = await run(denied.handler); assert.equal(r.status, 403); assert.equal(denied.opened, 0);
});
