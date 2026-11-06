import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/vehicle-taxonomy-probe.js';

// Offline only: Auth, memberships, provider and cache are intercepted. No real key or quota is used.
const ACTOR = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const ENV = { SUPABASE_URL: 'https://taxonomy-probe-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', ENCAR_API_KEY: 'synthetic-provider-key-do-not-echo' };
const FIRST = { Id: '38421907', Manufacturer: '현대', ModelGroup: '그랜저', Model: '그랜저 IG', Badge: '2.4 프리미엄', Price: 2820, Seller: { name: 'PRIVATE SELLER', phone: 'PRIVATE PHONE' }, Photos: ['PRIVATE PHOTO'] };
const DETAIL = { Id: '38421907', category: { manufacturer: { name: '현대', code: '005' }, modelGroup: { name: '그랜저', code: '100' }, model: { name: '그랜저 IG', code: '1001' }, grade: { name: '2.4', code: '1001001' }, gradeDetail: { name: '프리미엄', code: '100100101' } }, seller: { name: 'PRIVATE SELLER', phone: 'PRIVATE PHONE' }, details: { price: 2820, phone: 'PRIVATE PHONE', Photo: 'PRIVATE PHOTO' } };
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const rate = { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '97', 'X-RateLimit-Reset': '1794009600' };

async function fixture(run, patch = {}) {
  const previousFetch = globalThis.fetch, previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const state = { calls: [], cache: new Map(), cacheKeys: [], user: { id: ACTOR, is_anonymous: false }, members: [{ user_id: ACTOR, company_id: COMPANY, role: 'admin', active: true }],
    search: { total: 3, page: 0, count: 3, results: [FIRST, { ...FIRST }, { ...FIRST, Id: '38421908', Badge: '3.0 익스클루시브' }, { ...FIRST, Id: '38421909' }, { ...FIRST, Id: '38421910' }] }, detail: DETAIL, expectedKey: ENV.ENCAR_API_KEY, ...patch };
  const cache = {
    async match(request) { state.cacheKeys.push(request.url); if (state.cacheThrow) throw Error('synthetic cache failure'); return state.cache.get(request.url)?.clone(); },
    async put(request, response) { if (state.cacheThrow) throw Error('synthetic cache failure'); state.cache.set(request.url, response.clone()); }
  };
  if (state.noCache) delete globalThis.caches; else Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: cache } });
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), call = { url, options }; state.calls.push(call);
    assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    if (state.override) { const result = await state.override(call, state); if (result) return result; }
    if (url.origin === ENV.SUPABASE_URL) {
      assert.equal(options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY); assert.equal(options.headers.Authorization, 'Bearer ' + JWT);
      assert(!Object.hasOwn(options.headers, 'x-api-key'));
      if (url.pathname === '/auth/v1/user') return reply(state.user, state.authStatus || 200);
      assert.equal(url.pathname, '/rest/v1/zc_members'); assert.equal(url.searchParams.get('user_id'), 'eq.' + (state.user.id || ACTOR).toLowerCase());
      assert.equal(url.searchParams.get('active'), 'eq.true'); assert.equal(url.searchParams.get('limit'), '2'); return reply(state.members, state.membersStatus || 200);
    }
    assert.equal(url.origin, 'https://api.encar-api.com'); assert.equal(options.headers['x-api-key'], state.expectedKey);
    assert(!Object.hasOwn(options.headers, 'Authorization')); assert(!Object.hasOwn(options.headers, 'apikey')); assert.equal(options.method, undefined);
    if (url.pathname === '/api/cars') {
      assert.equal(url.searchParams.get('count'), '3'); assert.equal(url.searchParams.get('page'), '0'); assert(['Hyundai', 'Kia', 'BMW', 'Mercedes-Benz'].includes(url.searchParams.get('manufacturer')));
      assert.deepEqual([...url.searchParams.keys()].sort(), ['count', 'manufacturer', 'page']);
      return reply(state.search, state.searchStatus || 200, state.searchHeaders || rate);
    }
    assert.equal(url.pathname, '/api/car'); assert.equal(url.searchParams.get('id'), '38421907'); assert.deepEqual([...url.searchParams.keys()], ['id']);
    return reply(state.detail, state.detailHTTP || 200, state.detailHeaders || { ...rate, 'X-RateLimit-Remaining': '96' });
  };
  try { return await run(state); } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches); else delete globalThis.caches;
  }
}
const providerCalls = state => state.calls.filter(call => call.url.origin === 'https://api.encar-api.com');
async function call({ method = 'POST', body = { companyId: COMPANY, manufacturer: 'Hyundai' }, company = COMPANY, env = ENV, headers = {}, raw, query } = {}) {
  const url = 'https://s-note.example/api/vehicle-taxonomy-probe' + (method === 'GET' ? query ?? '?companyId=' + company : '');
  const request = new Request(url, { method, headers: { Authorization: 'Bearer ' + JWT, Origin: 'https://s-note.example', 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: raw === undefined ? JSON.stringify(body) : raw }) });
  const response = await onRequest({ request, env }); return { status: response.status, response, body: await response.json() };
}

test('status authenticates a real active administrator and reports binding presence without consuming provider quota', async () => {
  await fixture(async state => {
    for (const key of [ENV.ENCAR_API_KEY, '', 'short', 'bad\nkey']) {
      const result = await call({ method: 'GET', env: { ...ENV, ENCAR_API_KEY: key } });
      assert.equal(result.status, 200); assert.equal(result.body.configured, key === ENV.ENCAR_API_KEY); assert.equal(result.body.providerRequestCount, 0); assert.equal(result.body.configurationCode, key === ENV.ENCAR_API_KEY ? null : key ? 'API_KEY_INVALID' : 'API_KEY_MISSING');
      assert.equal(result.body.provider, 'encar-api.com'); assert.equal(result.body.importEnabled, false); assert.equal(result.body.maxProviderRequests, 2);
      assert.deepEqual(result.body.supportedManufacturers.map(item => item.value), ['Hyundai', 'Kia', 'BMW', 'Mercedes-Benz']);
      assert(!JSON.stringify(result.body).includes(ENV.ENCAR_API_KEY));
    }
    assert.equal(state.calls.length, 8); assert.equal(providerCalls(state).length, 0);
  });
});

test('missing authentication, forged admin metadata, non-admin, inactive, foreign, duplicate, anonymous and banned identities cannot probe', async () => {
  for (const patch of [
    { user: { id: ACTOR, is_anonymous: true } }, { user: { id: ACTOR, banned_until: new Date(Date.now() + 3600000).toISOString() } },
    { user: { id: ACTOR, user_metadata: { role: 'admin' } }, members: [{ user_id: ACTOR, company_id: COMPANY, role: 'dealer', active: true }] },
    { members: [{ user_id: ACTOR, company_id: COMPANY, role: 'accountant', active: true }] },
    { members: [{ user_id: ACTOR, company_id: COMPANY, role: 'admin', active: false }] },
    { members: [{ user_id: ACTOR, company_id: FOREIGN, role: 'admin', active: true }] },
    { members: [{ user_id: OTHER, company_id: COMPANY, role: 'admin', active: true }] },
    { members: [] }, { members: [{}, {}] }, { user: { id: ACTOR }, authStatus: 401 }
  ]) await fixture(async state => { const result = await call(); assert([401, 403].includes(result.status), JSON.stringify(result.body)); assert.equal(providerCalls(state).length, 0); }, patch);
  await fixture(async state => { assert.equal((await call({ headers: { Authorization: '' } })).status, 401); assert.equal(state.calls.length, 0); });
});

test('sample search and one detail use exact bounded query and return only classification data, never seller, prices, images or credentials', async () => {
  await fixture(async state => {
    const result = await call(); assert.equal(result.status, 200); const data = result.body;
    assert.equal(data.providerRequestCount, 2); assert.equal(providerCalls(state).length, 2); assert.equal(data.samples.length, 3);
    assert.deepEqual(data.samples[0], { listingId: '38421907', manufacturer: '현대', modelGroup: '그랜저', model: '그랜저 IG', badge: '2.4 프리미엄' });
    assert.deepEqual(data.samples.map(item => item.listingId), ['38421907', '38421908', '38421909']); assert.equal(data.detailStatus, 'checked');
    assert.deepEqual(data.schemaSummary, { modelGroupObserved: true, separateGradeTrimObserved: true, classificationCodeObserved: true, requiresReview: true });
    assert.deepEqual(data.rateLimit, { limit: 100, remaining: 96, reset: 1794009600 }); assert.equal(data.importEnabled, false);
    assert(data.detailClassification.some(item => item.path === 'category.gradeDetail.name' && item.value === '프리미엄'));
    for (const text of [ENV.ENCAR_API_KEY, JWT, ENV.SUPABASE_PUBLISHABLE_KEY, 'PRIVATE', 'Price', 'Photos', 'seller']) assert(!JSON.stringify(data).includes(text), text);
    assert.match(result.response.headers.get('Cache-Control'), /no-store.*private/); assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer');
    assert(state.calls.every(item => !['PATCH', 'PUT', 'DELETE'].includes(item.options.method))); assert.equal(state.cache.size, 1);
  });
});

test('compound Badge, translated group/trim and advertisement IDs never claim complete or separately coded source grades', async () => {
  await fixture(async state => {
    state.search = { data: { results: [{ Id: '38421907', Manufacturer: '현대', Model: '그랜저 IG', Badge: '2.4 프리미엄' }] } };
    state.detail = { Id: '38421907', Manufacturer: '현대', Model: '그랜저 IG', Badge: '2.4 프리미엄', en: { modelGroup: 'Grandeur', badge: '2.4 Premium', trim: 'Premium', modelId: 'translated-id' } };
    const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.samples[0].modelGroup, null);
    assert.deepEqual(result.body.schemaSummary, { modelGroupObserved: true, separateGradeTrimObserved: false, classificationCodeObserved: false, requiresReview: true });
    assert(result.body.detailClassification.some(item => item.path === 'en.modelGroup')); assert.equal(result.body.importEnabled, false);
  }, { noCache: true });
});

test('empty pages and exhausted known remaining quota stop after one provider request', async () => {
  await fixture(async state => { state.search = { total: 0, results: [] }; const result = await call(); assert.equal(result.status, 200); assert.deepEqual(result.body.samples, []); assert.equal(result.body.detailStatus, 'skipped_no_listing'); assert.equal(providerCalls(state).length, 1); }, { noCache: true });
  await fixture(async state => { state.searchHeaders = { ...rate, 'X-RateLimit-Remaining': '0' }; const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.detailStatus, 'skipped_quota'); assert.equal(result.body.warnings[0].code, 'UPSTREAM_RATE_LIMITED'); assert.equal(providerCalls(state).length, 1); }, { noCache: true });
});

test('initial provider authentication, rate, unavailable and redirects fail explicitly with no automatic retry or raw response echo', async () => {
  for (const [status, code, expected] of [[404, 'UPSTREAM_UNAVAILABLE', 503], [401, 'API_KEY_REJECTED', 502], [403, 'UPSTREAM_FORBIDDEN', 502], [429, 'UPSTREAM_RATE_LIMITED', 429], [503, 'UPSTREAM_UNAVAILABLE', 503], [302, 'UPSTREAM_REDIRECT', 502]]) {
    await fixture(async state => {
      state.searchStatus = status; state.search = { secret: ENV.ENCAR_API_KEY }; state.searchHeaders = { Location: 'https://evil.invalid/steal', 'Retry-After': '117' };
      const result = await call(); assert.equal(result.status, expected); assert.equal(result.body.code, code); assert.equal(result.body.providerRequestCount, 1);
      assert.equal(providerCalls(state).length, 1); assert(!JSON.stringify(result.body).includes(ENV.ENCAR_API_KEY)); assert(!state.calls.some(item => item.url.hostname === 'evil.invalid'));
      if (status === 429) assert.equal(result.response.headers.get('Retry-After'), '117');
    }, { noCache: true });
  }
});

test('detail failures are partial reports, stay within two calls and are not cached as a successful detail', async () => {
  for (const [status, code] of [[404, 'UPSTREAM_NOT_FOUND'], [403, 'UPSTREAM_FORBIDDEN'], [429, 'UPSTREAM_RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']]) {
    await fixture(async state => {
      state.detailHTTP = status; state.detail = { private: ENV.ENCAR_API_KEY };
      const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.detailStatus, 'unavailable'); assert.equal(result.body.warnings[0].code, code);
      assert.equal(result.body.samples.length, 3); assert.equal(result.body.providerRequestCount, 2); assert.equal(state.cache.size, 0); assert(!JSON.stringify(result.body).includes(ENV.ENCAR_API_KEY));
    });
  }
});

test('a successful sanitized cache avoids quota, reauthenticates membership and changes key on rotation or company', async () => {
  await fixture(async state => {
    const first = await call(); assert.equal(first.body.cached, false);
    const second = await call(); assert.equal(second.body.cached, true); assert.equal(second.body.providerRequestCount, 0); assert.equal(second.body.checkedAt, first.body.checkedAt);
    assert.equal(providerCalls(state).length, 2); assert.equal(state.calls.filter(item => item.url.pathname === '/auth/v1/user').length, 2);
    state.members = [{ user_id: ACTOR, company_id: COMPANY, role: 'dealer', active: true }]; assert.equal((await call()).status, 403); assert.equal(providerCalls(state).length, 2);
    state.members[0].role = 'admin'; state.expectedKey = 'rotated-synthetic-provider-key'; const rotated = await call({ env: { ...ENV, ENCAR_API_KEY: state.expectedKey } }); assert.equal(rotated.body.cached, false); assert.equal(providerCalls(state).length, 4);
    state.members[0].company_id = FOREIGN; const foreign = await call({ body: { companyId: FOREIGN, manufacturer: 'Hyundai' }, env: { ...ENV, ENCAR_API_KEY: state.expectedKey } }); assert.equal(foreign.body.cached, false); assert.equal(providerCalls(state).length, 6);
    assert.equal(new Set(state.cacheKeys).size, 3); for (const key of state.cacheKeys) assert(!key.includes(ENV.ENCAR_API_KEY) && !key.includes(state.expectedKey));
    assert(!JSON.stringify(rotated.body).includes('rotated-synthetic')); assert(!JSON.stringify(foreign.body).includes('rotated-synthetic'));
  });
});

test('cache absence, failure, expiry, corruption and credential-looking data safely fall back to fresh bounded samples', async () => {
  for (const patch of [{ noCache: true }, { cacheThrow: true }]) await fixture(async state => { assert.equal((await call()).status, 200); assert.equal(providerCalls(state).length, 2); }, patch);
  await fixture(async state => {
    await call(); const cacheKey = [...state.cache.keys()][0]; const stored = await state.cache.get(cacheKey).json(); stored.report.checkedAt = new Date(Date.now() - 400000).toISOString(); state.cache.set(cacheKey, reply(stored));
    assert.equal((await call()).body.cached, false); assert.equal(providerCalls(state).length, 4);
    state.cache.set(cacheKey, reply({ version: 1, report: { ...stored.report, checkedAt: new Date().toISOString(), samples: [{ listingId: '38421907', manufacturer: '현대', model: ENV.ENCAR_API_KEY }] } }));
    const result = await call(); assert.equal(result.body.cached, false); assert.equal(providerCalls(state).length, 6); assert(!JSON.stringify(result.body).includes(ENV.ENCAR_API_KEY));
  });
});

test('input and configuration errors never touch provider or accept arbitrary URLs/counts', async () => {
  await fixture(async state => {
    for (const args of [
      { body: { companyId: COMPANY, manufacturer: 'https://evil.invalid' } },
      { body: { companyId: COMPANY, manufacturer: 'Hyundai', count: 500 } },
      { body: { companyId: FOREIGN, manufacturer: 'Hyundai' } },
      { method: 'GET', query: '?companyId=' + COMPANY + '&manufacturer=Hyundai' },
      { method: 'GET', query: '?companyId=' + COMPANY + '&companyId=' + COMPANY },
      { raw: '{"companyId":"' + COMPANY + '","manufacturer":"Hyundai",' },
      { raw: 'x'.repeat(2050) },
      { headers: { Origin: 'https://evil.invalid' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } },
      { env: { ...ENV, ENCAR_API_KEY: '' } }, { env: { ...ENV, ENCAR_API_KEY: 'bad key' } },
      { env: { ...ENV, SUPABASE_URL: 'https://evil.invalid' } }, { method: 'PUT' }
    ]) { const result = await call(args); assert(result.status >= 400, JSON.stringify(result.body)); }
    assert.equal(providerCalls(state).length, 0); assert(state.calls.every(item => item.url.origin === ENV.SUPABASE_URL));
  });
});

test('invalid JSON, oversized bodies, wrong listing shape and nested wrong-car IDs fail without returning raw source', async () => {
  await fixture(async state => {
    state.search = { rows: [FIRST] }; assert.equal((await call()).body.code, 'UPSTREAM_INVALID');
    state.search = { results: [{ ...FIRST, Model: ENV.ENCAR_API_KEY }] }; const secret = await call(); assert.equal(secret.body.code, 'UPSTREAM_INVALID'); assert(!JSON.stringify(secret.body).includes(ENV.ENCAR_API_KEY));
    state.search = { results: [FIRST] }; state.detail = { data: { Id: '99999999', category: DETAIL.category } }; const mismatch = await call(); assert.equal(mismatch.body.detailStatus, 'unavailable'); assert.equal(mismatch.body.warnings[0].code, 'UPSTREAM_INVALID');
  }, { noCache: true });
  await fixture(async state => {
    const result = await call(); assert.equal(result.body.code, 'UPSTREAM_INVALID'); assert.equal(providerCalls(state).length, 1);
  }, { override(call) { if (call.url.pathname === '/api/cars') return new Response('not-json ' + ENV.ENCAR_API_KEY, { status: 200, headers: { 'Content-Type': 'text/html' } }); }, noCache: true });
  await fixture(async state => {
    const result = await call(); assert.equal(result.body.code, 'UPSTREAM_INVALID'); assert.equal(providerCalls(state).length, 1);
  }, { override(call) { if (call.url.pathname === '/api/cars') return new Response('x', { status: 200, headers: { 'Content-Length': '1048577' } }); }, noCache: true });
});

test('safe classification extraction ignores arbitrary fields, credentials and translations as code authority', async () => {
  await fixture(async state => {
    state.detail = { Id: '38421907', data: { category: { model: { name: '그랜저 IG', code: '101' }, badge: '2.4 프리미엄', seller: { name: 'PRIVATE NAME' }, grade: { name: ENV.ENCAR_API_KEY }, trim: { name: 'avg_free_1234567890_secret' } }, en: { modelGroup: 'Grandeur', trim: 'Premium' } }, Contact: 'PRIVATE PHONE', API_KEY: ENV.ENCAR_API_KEY };
    const result = await call(); const value = JSON.stringify(result.body); assert(!value.includes(ENV.ENCAR_API_KEY)); assert(!value.includes('avg_free_')); assert(!value.includes('PRIVATE'));
    assert.equal(result.body.schemaSummary.separateGradeTrimObserved, false); assert.equal(result.body.schemaSummary.classificationCodeObserved, true);
  }, { noCache: true });
});

test('simultaneous identical requests share one bounded provider operation after separate administrator checks', async () => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  await fixture(async state => {
    const first = call(); await started; const second = call(); await new Promise(resolve => setTimeout(resolve, 20)); release();
    const [a, b] = await Promise.all([first, second]); assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(providerCalls(state).length, 2);
    assert.equal(a.body.providerRequestCount, 2); assert.equal(b.body.providerRequestCount, 0); assert.equal(b.body.cached, true);
    assert.equal(state.calls.filter(item => item.url.pathname === '/auth/v1/user').length, 2);
  }, { noCache: true, async override(call) { if (call.url.pathname === '/api/cars') { entered(); await gate; } } });
});

test('caller abort stops a stalled provider read without a second provider request or raw exception', async () => {
  await fixture(async state => {
    const controller = new AbortController();
    const request = new Request('https://s-note.example/api/vehicle-taxonomy-probe', { method: 'POST', headers: { Authorization: 'Bearer ' + JWT, Origin: 'https://s-note.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: COMPANY, manufacturer: 'Hyundai' }), signal: controller.signal });
    const pending = onRequest({ request, env: ENV }); await new Promise(resolve => setTimeout(resolve, 30)); controller.abort();
    const response = await pending, data = await response.json(); assert.equal(response.status, 504); assert.equal(data.code, 'UPSTREAM_TIMEOUT'); assert.equal(providerCalls(state).length, 1);
    assert(!JSON.stringify(data).includes(ENV.ENCAR_API_KEY));
  }, { noCache: true, override(call) { if (call.url.pathname === '/api/cars') return new Response(new ReadableStream({ start() {} })); } });
});

test('Korean Cd/Nm modelGrp aliases and safe item/payload wrappers are observed without guessing the fields meaning', async () => {
  await fixture(async state => {
    state.search = { payload: { items: [{ item: { Id: '38421907', ManufacturerNm: '현대', ModelGrpNm: '그랜저', ModelNm: '그랜저 IG', BadgeNm: '2.4 프리미엄' } }] } };
    state.detail = { payload: { listing: { Id: '38421907', category: { manufacturerCd: '005', manufacturerNm: '현대', modelGrpCd: '100', modelGrpNm: '그랜저', modelCd: '1001', modelNm: '그랜저 IG', gradeCd: '11', gradeNm: '2.4', gradeDetailCd: '12', gradeDetailNm: '프리미엄' } } } };
    const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.samples[0].manufacturer, '현대'); assert.equal(result.body.samples[0].modelGroup, '그랜저');
    assert(result.body.detailClassification.some(item => item.path === 'payload.listing.category.gradeDetailCd' && item.value === '12'));
    assert.deepEqual(result.body.schemaSummary, { modelGroupObserved: true, separateGradeTrimObserved: true, classificationCodeObserved: true, requiresReview: true });
    state.detail = { Id: '38421907', grade: '2.4 프리미엄', trim: '2.4 프리미엄' }; const ambiguous = await call();
    assert.equal(ambiguous.body.schemaSummary.separateGradeTrimObserved, false);
  }, { noCache: true });
});

test('numeric credential echoes in classification IDs, quota and listing ID never reach the response', async () => {
  const key = '12345678';
  await fixture(async state => {
    state.detail = { Id: '38421907', category: { manufacturerNm: '현대', model: { name: '그랜저 IG', cd: 12345678 }, gradeCd: 12345678 } };
    state.searchHeaders = { ...rate, 'X-RateLimit-Limit': key, 'X-RateLimit-Remaining': key, 'X-RateLimit-Reset': key }; state.detailHeaders = state.searchHeaders;
    const result = await call({ env: { ...ENV, ENCAR_API_KEY: key } }); assert.equal(result.status, 200); assert(!JSON.stringify(result.body).includes(key));
    assert.deepEqual(result.body.rateLimit, { limit: null, remaining: null, reset: null }); assert.equal(result.body.schemaSummary.classificationCodeObserved, false);
    state.search = { results: [{ ...FIRST, Id: key }] }; const badId = await call({ env: { ...ENV, ENCAR_API_KEY: key } });
    assert.equal(badId.body.code, 'UPSTREAM_INVALID'); assert(!JSON.stringify(badId.body).includes(key));
  }, { noCache: true, expectedKey: key });
});

test('cached arbitrary seller/contact paths are rejected rather than treated as sanitized classification data', async () => {
  await fixture(async state => {
    await call(); const cacheKey = [...state.cache.keys()][0], stored = await state.cache.get(cacheKey).json();
    stored.report.detailClassification.push({ path: 'seller.name', value: 'PRIVATE CACHED CONTACT' }); state.cache.set(cacheKey, reply(stored));
    const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.cached, false); assert.equal(providerCalls(state).length, 4);
    assert(!JSON.stringify(result.body).includes('PRIVATE CACHED CONTACT'));
  });
});

test('classification diagnostics enforce their sixty-field ceiling even when one provider object has many aliases', async () => {
  await fixture(async state => {
    state.detail = { Id: '38421907' };
    for (const name of ['manufacturer','brand','modelGroup','modelGrp','model','generation','badge','badgeDetail','grade','gradeDetail','subgrade','trim','subtrim']) for (const suffix of ['', 'Id', 'Code', 'Cd', 'Name', 'Nm']) state.detail[name + suffix] = '관측값';
    const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.detailClassification.length, 60);
    const cached = await call(); assert.equal(cached.body.cached, true); assert.equal(cached.body.detailClassification.length, 60); assert.equal(providerCalls(state).length, 2);
  });
});
