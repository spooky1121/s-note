import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../functions/api/encar.js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const USER_ID = '10000000-0000-4000-8000-000000000001';
const TOKEN = 'test_access_token_with_more_than_thirty_characters';
const BASE = 'https://fem.encar.com/cars/detail/';
const PLATE = '12가3456';
const ORIGINAL = '43000001';
const TRUSTED = '43000002';
const SECOND = '43000003';
const env = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'fixture_publishable_key',
  TAVILY_API_KEY: 'fixture_private_search_key'
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function base(overrides = {}) {
  return {
    vehicleNo: PLATE,
    vehicleId: Number(ORIGINAL),
    queryCarId: Number(ORIGINAL),
    advertisement: { status: 'ADVERTISE' },
    manage: { dummy: false, dummyVehicleId: null },
    category: {
      manufacturerName: '현대', modelName: '더 뉴 아이오닉5',
      gradeName: '롱레인지', gradeDetailName: '프레스티지',
      yearMonth: '202409', formYear: '2025'
    },
    spec: { mileage: 24668 },
    ...overrides
  };
}

function html(vehicle = base(), encoded = false) {
  const state = JSON.stringify({ cars: {
    base: vehicle,
    seller: { name: 'PRIVATE_SELLER', phone: 'PRIVATE_PHONE', account: 'PRIVATE_ACCOUNT' }
  } });
  return '<!doctype html><html><script>window.__PRELOADED_STATE__ = ' +
    (encoded ? 'JSON.parse(' + JSON.stringify(state) + ')' : state) +
    ';</script><script>window.unrelated = { another: "}" };</script></html>';
}

function request(payload = { plate: PLATE }, headers = {}, method = 'POST') {
  return new Request('https://snote.example/api/encar', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...headers },
    ...(method === 'GET' ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  });
}

async function run(config = {}, req = request(), extraEnv = {}) {
  const calls = [];
  const pending = [];
  const logs = [];
  const oldFetch = globalThis.fetch;
  const oldInfo = console.info;
  let searchIndex = 0;
  console.info = (...values) => logs.push(values.join(' '));
  globalThis.fetch = async (urlValue, options = {}) => {
    const url = new URL(urlValue);
    const call = { url: url.href, options };
    calls.push(call);
    await config.onCall?.(call, calls);
    if (url.origin === env.SUPABASE_URL && url.pathname === '/auth/v1/user') {
      assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
      assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
      return config.authResponse ?? json(config.user ?? { id: USER_ID }, config.authStatus ?? 200);
    }
    if (url.origin === env.SUPABASE_URL && url.pathname === '/rest/v1/zc_members') {
      assert.equal(url.searchParams.get('select'), 'user_id');
      assert.equal(url.searchParams.get('user_id'), 'eq.' + USER_ID);
      assert.equal(url.searchParams.get('active'), 'eq.true');
      assert.equal(url.searchParams.get('limit'), '1');
      return config.membershipResponse ?? json(config.members ?? [{ user_id: USER_ID }], config.membershipStatus ?? 200);
    }
    if (url.href === 'https://api.tavily.com/search') {
      if (config.searchThrows) throw config.searchThrows;
      if (config.searches) {
        const next = config.searches[searchIndex++];
        assert(next, 'No more than the specified basic searches are allowed');
        if (next instanceof Error) throw next;
        if (next instanceof Response) return next;
        return json({ results: next.results ?? [] }, next.status ?? 200);
      }
      return json(config.searchPayload ?? { results: config.results ?? [] }, config.searchStatus ?? 200);
    }
    if (url.origin === 'https://fem.encar.com' && /^\/cars\/detail\/[0-9]+$/.test(url.pathname)) {
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(options.headers, { Accept: 'text/html' });
      const id = url.pathname.split('/').at(-1);
      const page = config.pages?.[id];
      if (typeof page === 'function') return page(call);
      if (page instanceof Error) throw page;
      if (page === undefined) return new Response('Not found', { status: 404 });
      return typeof page === 'string' ? new Response(page, { headers: { 'Content-Type': 'text/html' } }) : page.clone();
    }
    throw new Error('Unexpected external request: ' + url.origin);
  };
  try {
    const reply = await onRequest({
      request: req,
      env: { ...env, ...extraEnv },
      waitUntil(promise) { pending.push(promise); }
    });
    await Promise.all(pending);
    return { reply, body: await reply.json(), calls, logs };
  } finally {
    globalThis.fetch = oldFetch;
    console.info = oldInfo;
  }
}

function searchCalls(result) {
  return result.calls.filter(call => call.url === 'https://api.tavily.com/search');
}

function detailCalls(result) {
  return result.calls.filter(call => call.url.startsWith(BASE));
}

test('unauthenticated request performs no external requests', async () => {
  const result = await run({}, request({ plate: PLATE }, { Authorization: '' }));
  assert.equal(result.reply.status, 401);
  assert.equal(result.body.status, 'error');
  assert.equal(result.calls.length, 0);
});

test('expired authentication never reaches membership, search, or hints', async () => {
  const result = await run({ authStatus: 401 }, request({ plate: PLATE, candidateIds: [ORIGINAL] }));
  assert.equal(result.reply.status, 401);
  assert.equal(result.calls.length, 1);
});

test('inactive membership denies search and supplied candidate hints', async () => {
  const result = await run({ members: [] }, request({ plate: PLATE, candidateIds: [ORIGINAL] }));
  assert.equal(result.reply.status, 403);
  assert.equal(searchCalls(result).length, 0);
  assert.equal(detailCalls(result).length, 0);
});

test('a membership for a different user does not authorize the caller', async () => {
  const result = await run({ members: [{ user_id: '20000000-0000-4000-8000-000000000002' }] });
  assert.equal(result.reply.status, 403);
  assert.equal(searchCalls(result).length, 0);
});

test('missing provider key is a configuration error even with candidate hints', async () => {
  const result = await run({}, request({ plate: PLATE, candidateIds: [ORIGINAL] }), { TAVILY_API_KEY: '' });
  assert.equal(result.reply.status, 503);
  assert.equal(result.body.status, 'error');
  assert.equal(result.calls.length, 0);
});

test('POST uses the exact search payload and returns only verified allowlisted fields', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html() } });
  assert.equal(result.reply.status, 200);
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.plate, PLATE);
  assert.ok(Number.isFinite(Date.parse(result.body.verifiedAt)));
  assert.deepEqual(Object.keys(result.body).sort(), ['listings', 'plate', 'status', 'verifiedAt']);
  assert.deepEqual(result.body.listings, [{
    id: ORIGINAL, trustedId: null, sellerUrl: BASE + ORIGINAL, trustedUrl: null,
    model: '현대 더 뉴 아이오닉5 롱레인지 프레스티지',
    yearMonth: '202409', formYear: '2025', mileage: 24668
  }]);
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|fixture_private|test_access/);
  assert.equal(result.reply.headers.get('cache-control'), 'no-store, private');
  const search = searchCalls(result)[0];
  assert.equal(search.options.headers.Authorization, 'Bearer fixture_private_search_key');
  assert.deepEqual(JSON.parse(search.options.body), {
    query: '"' + PLATE + '"', exact_match: true, search_depth: 'basic',
    max_results: 8, auto_parameters: false, include_answer: false, include_raw_content: false
  });
});

test('a snippet containing the plate cannot verify an unrelated lot ID', async () => {
  const result = await run({
    results: [{ url: 'https://carsbat.com/car/example', content: PLATE + ' Lot number: ' + ORIGINAL }],
    pages: { [ORIGINAL]: html(base({ vehicleNo: '12나3456' })) }
  });
  assert.equal(result.body.status, 'unverified');
  assert.deepEqual(result.body.listings, []);
  assert.equal(result.body.verifiedAt, null);
  assert.equal(detailCalls(result).length, 1);
});

test('arbitrary numeric strings and unapproved host names do not become candidate IDs', async () => {
  const result = await run({ results: [
    { url: 'https://example.com/car/' + ORIGINAL, content: PLATE + ' 43000001 24668 202409' },
    { url: 'https://evil.example/?carid=' + ORIGINAL, content: 'Lot number: ' + ORIGINAL },
    { url: 'https://fem.encar.com.evil.example/cars/detail/' + ORIGINAL, content: PLATE }
  ] });
  assert.equal(result.body.status, 'unverified');
  assert.equal(detailCalls(result).length, 0);
});

test('known URL patterns and explicit carsbat lot labels produce candidates without fetching those sites', async t => {
  const examples = [
    { url: 'https://www.encar.com/dc/dc_cardetailview.do?carid=' + ORIGINAL },
    { url: 'https://trust-encar.ru/auto/' + ORIGINAL },
    { url: 'https://encar.spb.ru/auto/' + ORIGINAL },
    { url: 'https://encar.msk.ru/auto/' + ORIGINAL },
    { url: 'https://encar.cbg.ru/auto/' + ORIGINAL },
    { url: 'https://deffcars.ru/catalog/encar_' + ORIGINAL + '.html' },
    { url: 'https://carsbat.com/vehicle/example', content: 'Номер лота: ' + ORIGINAL },
    { url: 'https://example.com/article', content: 'Listing: ' + BASE + ORIGINAL }
  ];
  for (const example of examples) {
    await t.test(example.url, async () => {
      const result = await run({ results: [example], pages: { [ORIGINAL]: html() } });
      assert.equal(result.body.status, 'found');
      assert.equal(detailCalls(result).length, 1);
      assert.ok(result.calls.every(call => /^(?:https:\/\/fixture\.supabase\.co\/|https:\/\/api\.tavily\.com\/search$|https:\/\/fem\.encar\.com\/cars\/detail\/)/.test(call.url)));
    });
  }
});

test('JSON extraction respects braces, escaped quotes, and backslashes inside strings', async () => {
  const modelName = '모델 } { "특별" \\ 경로';
  const vehicle = base();
  vehicle.category.modelName = modelName;
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html(vehicle) } });
  assert.equal(result.body.status, 'found');
  assert.ok(result.body.listings[0].model.includes(modelName));
});

test('JSON.parse with an encoded JSON string is decoded without executing scripts', async () => {
  const vehicle = base();
  vehicle.category.modelName = 'JSON.parse } \\ "문자열"';
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html(vehicle, true) } });
  assert.equal(result.body.status, 'found');
  assert.ok(result.body.listings[0].model.includes(vehicle.category.modelName));
});

test('inactive advertisement remains unverified even when plate matches', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html(base({ advertisement: { status: 'SOLD' } })) } });
  assert.equal(result.body.status, 'unverified');
  assert.deepEqual(result.body.listings, []);
});

test('an explicit block page is an error even when its HTTP status is 404', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: {
    [ORIGINAL]: new Response('has_been_cr_blocked_AWS.html 서비스 이용 제한됨', { status: 404 })
  } });
  assert.equal(result.reply.status, 502);
  assert.equal(result.body.status, 'error');
});

test('genuine absent listing is unverified, not a parsing failure', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }] });
  assert.equal(result.reply.status, 200);
  assert.equal(result.body.status, 'unverified');
});

test('a successful HTTP page with malformed state is an error, not no-match', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: '<script>window.__PRELOADED_STATE__ = {broken}</script>' } });
  assert.equal(result.reply.status, 502);
  assert.equal(result.body.status, 'error');
});

test('original and trusted pages deduplicate by original ID, with both links separately verified', async () => {
  const result = await run({
    results: [{ url: BASE + ORIGINAL }, { url: BASE + TRUSTED }],
    pages: {
      [ORIGINAL]: html(base({ manage: { dummy: false, dummyVehicleId: Number(TRUSTED) } })),
      [TRUSTED]: html(base({ queryCarId: Number(TRUSTED), manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } }))
    }
  });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings.length, 1);
  assert.equal(result.body.listings[0].trustedId, TRUSTED);
  assert.equal(result.body.listings[0].trustedUrl, BASE + TRUSTED);
  assert.equal(result.body.listings[0].sellerUrl, BASE + ORIGINAL);
  assert.equal(detailCalls(result).length, 2);
});

test('a trusted-page-only candidate still verifies its canonical original before returning it', async () => {
  const result = await run({
    results: [{ url: BASE + TRUSTED }],
    pages: {
      [ORIGINAL]: html(base({ manage: { dummy: false, dummyVehicleId: Number(TRUSTED) } })),
      [TRUSTED]: html(base({ queryCarId: Number(TRUSTED), manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } }))
    }
  });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].id, ORIGINAL);
  assert.equal(detailCalls(result).length, 2);
});

test('dummyVehicleId is not returned when its page belongs to a different plate', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: {
    [ORIGINAL]: html(base({ manage: { dummy: false, dummyVehicleId: Number(TRUSTED) } })),
    [TRUSTED]: html(base({ vehicleNo: '12나3456', manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } }))
  } });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].trustedId, null);
  assert.equal(result.body.listings[0].trustedUrl, null);
});

test('distinct original advertisements with the exact same plate return multiple', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }, { url: BASE + SECOND }], pages: {
    [ORIGINAL]: html(),
    [SECOND]: html(base({ vehicleId: Number(SECOND), queryCarId: Number(SECOND) }))
  } });
  assert.equal(result.body.status, 'multiple');
  assert.deepEqual(result.body.listings.map(item => item.id), [ORIGINAL, SECOND]);
});

test('verified browser candidate hint skips the provider, but still fetches public detail', async () => {
  const result = await run({ pages: { [ORIGINAL]: html() } }, request({ plate: '12 가 3456', candidateIds: [ORIGINAL] }));
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.plate, PLATE);
  assert.equal(searchCalls(result).length, 0);
  assert.equal(detailCalls(result).length, 1);
});

test('mismatched browser candidate hint falls back to search and is never trusted', async () => {
  const result = await run({ results: [{ url: BASE + SECOND }], pages: {
    [ORIGINAL]: html(base({ vehicleNo: '12나3456' })),
    [SECOND]: html(base({ vehicleId: Number(SECOND), queryCarId: Number(SECOND) }))
  } }, request({ plate: PLATE, candidateIds: [ORIGINAL] }));
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].id, SECOND);
  assert.equal(searchCalls(result).length, 1);
});

test('partial upstream failure stays visible even when another candidate verifies', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }, { url: BASE + SECOND }], pages: {
    [ORIGINAL]: new Response('blocked', { status: 403 }),
    [SECOND]: html(base({ vehicleId: Number(SECOND), queryCarId: Number(SECOND) }))
  } });
  assert.equal(result.reply.status, 502);
  assert.equal(result.body.status, 'error');
  assert.equal(result.body.listings[0].id, SECOND);
});

test('timeout/abort is an error, not unverified', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: {
    [ORIGINAL]: new DOMException('The request timed out', 'AbortError')
  } });
  assert.equal(result.reply.status, 502);
  assert.equal(result.body.status, 'error');
});

test('redirects are not followed to another host or used as successful verification', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: {
    [ORIGINAL]: new Response('', { status: 302, headers: { Location: 'https://untrusted.example/private' } })
  } });
  assert.equal(result.body.status, 'error');
  assert.equal(detailCalls(result).length, 1);
});

test('oversized detail response is an error', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: {
    [ORIGINAL]: new Response(html(), { headers: { 'Content-Length': String(3 * 1024 * 1024 + 1) } })
  } });
  assert.equal(result.body.status, 'error');
});

test('KV stores only candidate IDs for one hour and never caches verified listing data', async () => {
  const writes = [];
  const cache = {
    async get() { return null; },
    async put(...args) { writes.push(args); }
  };
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html() } }, request(), { ENCAR_CACHE: cache });
  assert.equal(result.body.status, 'found');
  assert.deepEqual(writes, [['encar:candidates:v1:' + PLATE, JSON.stringify([ORIGINAL]), { expirationTtl: 3600 }]]);
});

test('cached candidate is reverified and cannot revive an inactive advertisement', async () => {
  const result = await run({ pages: { [ORIGINAL]: html(base({ advertisement: { status: 'SOLD' } })) } }, request(), {
    ENCAR_CACHE: { async get() { return JSON.stringify([ORIGINAL]); }, async put() {} }
  });
  assert.equal(result.body.status, 'unverified');
  assert.equal(searchCalls(result).length, 2);
  assert.equal(detailCalls(result).length, 1);
});

test('at most six search candidates are fetched, with no guesses from other text', async () => {
  const ids = Array.from({ length: 8 }, (_, index) => String(44000001 + index));
  const result = await run({ results: ids.map(id => ({ url: BASE + id })) });
  assert.equal(result.body.status, 'unverified');
  assert.equal(detailCalls(result).length, 6);
});

test('invalid or injected plate is rejected before a search request', async () => {
  const result = await run({}, request({ plate: '12가3456).Hidden.Y.(' }));
  assert.equal(result.reply.status, 400);
  assert.equal(searchCalls(result).length, 0);
});

test('oversized input is rejected and does not reach the provider', async () => {
  const result = await run({}, request(JSON.stringify({ plate: PLATE, extra: 'x'.repeat(5000) })));
  assert.equal(result.reply.status, 413);
  assert.equal(searchCalls(result).length, 0);
});

test('GET is rejected without any external request', async () => {
  const result = await run({}, request({}, {}, 'GET'));
  assert.equal(result.reply.status, 405);
  assert.equal(result.reply.headers.get('allow'), 'POST');
  assert.equal(result.calls.length, 0);
});

test('branded hints and relevance counts require the complete plate token including a region', async () => {
  const regionalPlate = '서울' + PLATE;
  const regional = { url: 'https://fixture.invalid/car', content: regionalPlate + ' Encar ID: ' + ORIGINAL };
  const mismatch = await run({ results: [regional], pages: { [ORIGINAL]: html() } });
  assert.equal(mismatch.body.diagnostics.code, 'SEARCH_NO_CANDIDATES');
  assert.equal(mismatch.body.diagnostics.resultPlateMatchCount, 0);
  assert.equal(detailCalls(mismatch).length, 0);
  const prose = await run({ results: [{ url: 'https://fixture.invalid/car', content: '차량번호' + PLATE + '입니다. Encar ID: ' + ORIGINAL }], pages: { [ORIGINAL]: html() } });
  assert.equal(prose.body.status, 'found');
  const exact = await run({ results: [regional], pages: { [ORIGINAL]: html(base({ vehicleNo: regionalPlate })) } }, request({ plate: regionalPlate }));
  assert.equal(exact.body.status, 'found');
});

test('all direct result URLs precede snippet links when six candidates fill the limit', async () => {
  const noise = Array.from({ length: 6 }, (_, index) => String(44000001 + index));
  const pages = Object.fromEntries(noise.map(id => [id, html(base({ vehicleNo: '12나3456', vehicleId: Number(id), queryCarId: Number(id) }))]));
  pages[ORIGINAL] = html();
  const result = await run({ results: [
    { url: 'https://example.com/article', content: noise.map(id => BASE + id).join(' ') },
    { url: BASE + ORIGINAL, content: PLATE }
  ], pages });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].id, ORIGINAL);
  assert.equal(detailCalls(result).length, 6);
  assert.equal(searchCalls(result).length, 1);
});

test('explicit carsbat lot labels in titles and known URLs in metadata yield verified candidates', async t => {
  for (const result of [
    { url: 'https://carsbat.com/vehicle/synthetic', title: 'Lot number: ' + ORIGINAL, content: PLATE },
    { url: 'https://carsbat.com/vehicle/synthetic', title: 'Номер лота: ' + ORIGINAL, content: PLATE },
    { url: 'https://example.com/article', title: BASE + ORIGINAL, content: PLATE },
    { url: 'https://example.com/article', raw_content: BASE + ORIGINAL, content: PLATE }
  ]) await t.test(JSON.stringify(Object.keys(result)), async () => {
    const found = await run({ results: [result], pages: { [ORIGINAL]: html() } });
    assert.equal(found.body.status, 'found'); assert.equal(detailCalls(found).length, 1);
  });
});

test('mobile Encar carid URL is only a candidate and is fetched on the fixed detail host', async () => {
  const result = await run({ results: [{ url: 'https://m.encar.com/mobile/moCarDetail.do?carid=' + ORIGINAL }], pages: { [ORIGINAL]: html() } });
  assert.equal(result.body.status, 'found');
  assert.deepEqual(detailCalls(result).map(call => call.url), [BASE + ORIGINAL]);
  assert.ok(result.calls.every(call => !call.url.startsWith('https://m.encar.com/')));
});

test('plain numbers and lot labels from unknown hosts remain untrusted in every metadata field', async () => {
  const result = await run({ results: [{ url: 'https://example.com/article', title: 'Lot number: ' + ORIGINAL,
    content: PLATE + ' ' + ORIGINAL, raw_content: 'Номер лота: ' + ORIGINAL }] });
  assert.equal(result.body.status, 'unverified');
  assert.equal(result.body.diagnostics.code, 'SEARCH_NO_CANDIDATES');
  assert.equal(detailCalls(result).length, 0);
});

test('empty exact search gets one unquoted plate-only basic search and stops when verified', async () => {
  const result = await run({ searches: [{ results: [] }, { results: [{ url: BASE + ORIGINAL }] }], pages: { [ORIGINAL]: html() } });
  assert.equal(result.body.status, 'found');
  const calls = searchCalls(result); assert.equal(calls.length, 2);
  const first = JSON.parse(calls[0].options.body), second = JSON.parse(calls[1].options.body);
  assert.equal(first.query, '"' + PLATE + '"'); assert.equal(first.exact_match, true);
  assert.equal(second.query, PLATE); assert.equal(Object.hasOwn(second, 'exact_match'), false);
  assert.equal(second.search_depth, 'basic'); assert.equal(second.max_results, 8);
  assert.equal(first.include_raw_content, false); assert.equal(Object.hasOwn(first, 'include_domains'), false);
  assert.equal(second.include_raw_content, true);
  assert.deepEqual(second.include_domains, ['encar.com', 'encar.spb.ru', 'trust-encar.ru', 'encar.msk.ru', 'encar.cbg.ru', 'carsbat.com', 'deffcars.ru']);
  assert.deepEqual(Object.keys(result.body).sort(), ['listings', 'plate', 'status', 'verifiedAt']);
});

test('a normal no-match first search can resolve on fallback, with repeated details memoized', async () => {
  const result = await run({ searches: [
    { results: [{ url: BASE + ORIGINAL }] },
    { results: [{ url: BASE + ORIGINAL }, { url: BASE + SECOND }] }
  ], pages: { [ORIGINAL]: html(base({ vehicleNo: '12나3456' })), [SECOND]: html(base({ vehicleId: Number(SECOND), queryCarId: Number(SECOND) })) } });
  assert.equal(result.body.status, 'found'); assert.equal(result.body.listings[0].id, SECOND);
  assert.equal(searchCalls(result).length, 2);
  assert.equal(detailCalls(result).filter(call => call.url === BASE + ORIGINAL).length, 1);
  assert.equal(detailCalls(result).length, 2);
});

test('two empty searches report safe SEARCH_NO_RESULTS diagnostics', async () => {
  const result = await run({ searches: [{ results: [] }, { results: [] }] });
  assert.equal(result.body.status, 'unverified'); assert.equal(result.body.diagnostics.code, 'SEARCH_NO_RESULTS');
  assert.equal(result.body.diagnostics.searchCount, 2); assert.equal(result.body.diagnostics.resultCount, 0);
  assert.equal(result.body.diagnostics.candidateCount, 0); assert.equal(result.body.diagnostics.checkedCount, 0);
  assert.match(result.body.diagnostics.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(result.reply.headers.get('x-request-id'), result.body.diagnostics.requestId);
});

test('indexed results with no recognized candidate have a separate diagnostic', async () => {
  const result = await run({ results: [{ url: 'https://example.com/no-recognized-url', content: PLATE }] });
  assert.equal(result.body.diagnostics.code, 'SEARCH_NO_CANDIDATES');
  assert.equal(result.body.diagnostics.resultCount, 2); assert.equal(result.body.diagnostics.checkedCount, 0);
});

test('plate mismatch, inactive advertisement, and 404 have distinct bounded rejection counts', async t => {
  for (const [page, code, counter] of [
    [html(base({ vehicleNo: '12나3456' })), 'PLATE_MISMATCH', 'plateMismatch'],
    [html(base({ advertisement: { status: 'SOLD' } })), 'AD_INACTIVE', 'notAdvertising'],
    [new Response('not found', { status: 404 }), 'DETAIL_NOT_FOUND', 'notFound']
  ]) await t.test(code, async () => {
    const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: page } });
    assert.equal(result.body.status, 'unverified'); assert.equal(result.body.diagnostics.code, code);
    assert.equal(result.body.diagnostics.candidateCount, 1); assert.equal(result.body.diagnostics.checkedCount, 1);
    assert.equal(result.body.diagnostics.rejected[counter], 1);
  });
});

test('mixed rejection reasons remain NO_VERIFIED_LISTING instead of asserting one cause', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }, { url: BASE + SECOND }],
    pages: { [ORIGINAL]: html(base({ vehicleNo: '12나3456' })) } });
  assert.equal(result.body.diagnostics.code, 'NO_VERIFIED_LISTING');
  assert.deepEqual(result.body.diagnostics.rejected, { plateMismatch: 1, notAdvertising: 0, notFound: 1 });
});

test('provider authentication, rate, quota and unavailable errors never trigger fallback', async t => {
  for (const [status, code] of [[401, 'SEARCH_AUTH_FAILED'], [403, 'SEARCH_AUTH_FAILED'],
    [429, 'SEARCH_RATE_LIMITED'], [432, 'SEARCH_QUOTA_EXCEEDED'], [433, 'SEARCH_QUOTA_EXCEEDED'], [503, 'SEARCH_UNAVAILABLE']]) {
    await t.test(String(status), async () => {
      const result = await run({ searches: [{ status }] });
      assert.equal(result.body.status, 'error'); assert.equal(result.reply.status, 502);
      assert.equal(result.body.diagnostics.code, code); assert.equal(searchCalls(result).length, 1);
    });
  }
});

test('detail block, malformed state, redirects, and timeout never trigger another search', async t => {
  for (const [page, code] of [
    [new Response('blocked', { status: 403 }), 'DETAIL_BLOCKED'],
    ['<script>window.__PRELOADED_STATE__={broken}</script>', 'DETAIL_PARSE_FAILED'],
    [new Response('', { status: 302, headers: { Location: 'https://untrusted.example/' } }), 'DETAIL_UNAVAILABLE'],
    [new DOMException('fixture timeout', 'AbortError'), 'UPSTREAM_TIMEOUT']
  ]) await t.test(code, async () => {
    const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: page } });
    assert.equal(result.body.status, 'error'); assert.equal(result.body.diagnostics.code, code);
    assert.equal(searchCalls(result).length, 1);
  });
});

test('a failed cached detail does not spend a search request', async () => {
  const result = await run({ pages: { [ORIGINAL]: new Response('blocked', { status: 403 }) } }, request({ plate: PLATE, candidateIds: [ORIGINAL] }));
  assert.equal(result.body.diagnostics.code, 'DETAIL_BLOCKED'); assert.equal(searchCalls(result).length, 0);
});

test('two searches never exceed twelve primary candidates and fetch each ID once', async () => {
  const first = Array.from({ length: 8 }, (_, index) => String(44000001 + index));
  const second = Array.from({ length: 8 }, (_, index) => String(45000001 + index));
  const result = await run({ searches: [{ results: first.map(id => ({ url: BASE + id })) }, { results: second.map(id => ({ url: BASE + id })) }] });
  assert.equal(result.body.status, 'unverified'); assert.equal(searchCalls(result).length, 2);
  assert.equal(result.body.diagnostics.candidateCount, 12); assert.equal(detailCalls(result).length, 12);
  assert.equal(new Set(detailCalls(result).map(call => call.url)).size, 12);
});

test('hints share the twelve-candidate budget and do not spend a fallback search after it is exhausted', async () => {
  const hints = Array.from({ length: 6 }, (_, index) => String(46000001 + index));
  const found = Array.from({ length: 6 }, (_, index) => String(47000001 + index));
  const result = await run({ searches: [{ results: found.map(id => ({ url: BASE + id })) }] }, request({ plate: PLATE, candidateIds: hints }));
  assert.equal(result.body.status, 'unverified'); assert.equal(result.body.diagnostics.candidateCount, 12);
  assert.equal(detailCalls(result).length, 12); assert.equal(searchCalls(result).length, 1);
});

test('configuration diagnostics reveal only fixed reason names', async () => {
  const search = await run({}, request(), { TAVILY_API_KEY: '' });
  assert.equal(search.body.diagnostics.code, 'SEARCH_NOT_CONFIGURED'); assert.equal(search.calls.length, 0);
  const supabase = await run({}, request(), { SUPABASE_URL: 'invalid-url' });
  assert.equal(supabase.body.diagnostics.code, 'SUPABASE_NOT_CONFIGURED'); assert.equal(supabase.calls.length, 0);
});

test('diagnostics and structured logs exclude all plate, listing IDs, URLs, credentials and raw upstream content', async () => {
  const result = await run({ searchPayload: { detail: 'PRIVATE_UPSTREAM ' + TOKEN + ' ' + env.TAVILY_API_KEY } });
  assert.equal(result.body.status, 'error'); assert.equal(result.body.diagnostics.code, 'SEARCH_UNAVAILABLE');
  assert.equal(result.logs.length, 1);
  const log = JSON.parse(result.logs[0]);
  assert.deepEqual(Object.keys(log).sort(), ['candidateCount', 'checkedCount', 'code', 'durationMs', 'plateMatchedCount', 'rawResultCount', 'recognizedSourceCount', 'rejected', 'requestId', 'resultCount', 'resultPlateMatchCount', 'searchCount']);
  assert.deepEqual(Object.keys(result.body.diagnostics).sort(), ['candidateCount', 'checkedCount', 'code', 'plateMatchedCount', 'rawResultCount', 'recognizedSourceCount', 'rejected', 'requestId', 'resultCount', 'resultPlateMatchCount', 'searchCount']);
  for (const value of [PLATE, ORIGINAL, BASE, TOKEN, env.TAVILY_API_KEY, env.SUPABASE_PUBLISHABLE_KEY, 'PRIVATE_UPSTREAM']) {
    assert.equal(JSON.stringify(result.body.diagnostics).includes(value), false);
    assert.equal(result.logs.join('').includes(value), false);
  }
});

test('35-second overall deadline covers successful prior stages and a hanging detail fetch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const pending = run({ results: [{ url: BASE + ORIGINAL }], onCall(call) {
    if (call.url.startsWith(BASE)) { entered(); return new Promise(() => {}); }
    t.mock.timers.tick(9000);
  } });
  await ready;
  t.mock.timers.tick(8001);
  const result = await pending;
  assert.equal(result.body.diagnostics.code, 'DEADLINE_EXCEEDED'); assert.equal(result.body.status, 'error');
  assert.equal(searchCalls(result).length, 1); assert.equal(result.body.diagnostics.checkedCount, 1);
});

test('per-fetch timeout includes an auth response body that never finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const body = new ReadableStream({ pull() { entered(); } });
  const pending = run({ authResponse: new Response(body) });
  await ready; await new Promise(setImmediate); assert.equal(body.locked, true);
  t.mock.timers.tick(10001);
  const result = await pending;
  assert.equal(result.body.diagnostics.code, 'UPSTREAM_TIMEOUT'); assert.equal(result.calls.length, 1);
});

test('overall deadline also bounds the incoming JSON body instead of misreporting invalid JSON', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const body = new ReadableStream({ pull() {} });
  const req = new Request('https://snote.example/api/encar', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body, duplex: 'half' });
  const pending = run({}, req);
  await new Promise(setImmediate); assert.equal(req.body.locked, true);
  t.mock.timers.tick(35001);
  const result = await pending;
  assert.equal(result.body.diagnostics.code, 'DEADLINE_EXCEEDED'); assert.equal(searchCalls(result).length, 0);
});

test('remaining overall budget also interrupts a detail response body, not only its fetch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const body = new ReadableStream({ pull() {} });
  const pending = run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: () => new Response(body) },
    onCall(call) { if (!call.url.startsWith(BASE)) t.mock.timers.tick(9000); } });
  await new Promise(setImmediate); assert.equal(body.locked, true);
  t.mock.timers.tick(8001);
  const result = await pending;
  assert.equal(result.body.diagnostics.code, 'DEADLINE_EXCEEDED'); assert.equal(searchCalls(result).length, 1);
});

test('search response body timeout is an error and does not trigger fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const body = new ReadableStream({ pull() {} });
  const pending = run({ searches: [new Response(body)] });
  await new Promise(setImmediate); assert.equal(body.locked, true);
  t.mock.timers.tick(10001);
  const result = await pending;
  assert.equal(result.body.diagnostics.code, 'UPSTREAM_TIMEOUT'); assert.equal(searchCalls(result).length, 1);
});

test('incoming cancellation stops the operation before a search can be billed', async () => {
  const controller = new AbortController();
  const req = new Request('https://snote.example/api/encar', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ plate: PLATE }), signal: controller.signal });
  const result = await run({ onCall() { controller.abort(); } }, req);
  assert.equal(result.body.status, 'error'); assert.equal(result.body.diagnostics.code, 'UPSTREAM_TIMEOUT');
  assert.equal(searchCalls(result).length, 0);
});

test('a sold advertisement for a different plate is a mismatch, not an inactive matching vehicle', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html(base({ vehicleNo: '12나3456', advertisement: { status: 'SOLD' } })) } });
  assert.equal(result.body.diagnostics.code, 'PLATE_MISMATCH');
  assert.equal(result.body.diagnostics.plateMatchedCount, 0);
  assert.deepEqual(result.body.diagnostics.rejected, { plateMismatch: 1, notAdvertising: 0, notFound: 0 });
});

test('unknown or malformed advertising states are never guessed active or reported sold', async t => {
  for (const status of ['NORMAL', 'ADVERTISING', 'UNSUPPORTED_FIXTURE_STATUS', '', null, {}, TOKEN, env.TAVILY_API_KEY, 'PRIVATE_PERSON 주민번호', BASE + ORIGINAL]) {
    await t.test(typeof status + ':' + String(status).length, async () => {
      const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html(base({ advertisement: { status } })) } });
      assert.equal(result.reply.status, 502); assert.equal(result.body.diagnostics.code, 'AD_STATUS_UNKNOWN');
      assert.equal(result.body.listings.length, 0); assert.equal(result.body.diagnostics.plateMatchedCount, 1);
      assert.equal(result.body.diagnostics.rejected.notAdvertising, 0); assert.equal(searchCalls(result).length, 1);
      assert.equal(Object.hasOwn(result.body.diagnostics, 'advertisementStates'), false);
      for (const privateValue of [TOKEN, env.TAVILY_API_KEY, PLATE, ORIGINAL, 'PRIVATE_PERSON']) {
        assert.equal(JSON.stringify(result.body.diagnostics).includes(privateValue), false);
        assert.equal(result.logs.join('').includes(privateValue), false);
      }
    });
  }
});

test('valid identity and an exact plate are required before counting a plate match', async () => {
  const result = await run({ results: [{ url: BASE + ORIGINAL }], pages: { [ORIGINAL]: html(base({ vehicleId: null, advertisement: { status: 'SOLD' } })) } });
  assert.equal(result.body.diagnostics.code, 'DETAIL_PARSE_FAILED');
  assert.equal(result.body.diagnostics.plateMatchedCount, 0); assert.equal(result.body.diagnostics.rejected.notAdvertising, 0);
});

test('an inactive trusted alias can locate an independently active original but is never linked', async () => {
  const result = await run({ results: [{ url: BASE + TRUSTED }], pages: {
    [TRUSTED]: html(base({ queryCarId: Number(TRUSTED), advertisement: { status: 'SOLD' }, manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } })),
    [ORIGINAL]: html(base({ manage: { dummy: false, dummyVehicleId: Number(TRUSTED) } }))
  } });
  assert.equal(result.body.status, 'found'); assert.equal(result.body.listings.length, 1);
  assert.equal(result.body.listings[0].sellerUrl, BASE + ORIGINAL);
  assert.equal(result.body.listings[0].trustedId, null); assert.equal(result.body.listings[0].trustedUrl, null);
  assert.equal(detailCalls(result).length, 2); assert.equal(searchCalls(result).length, 1);
  assert.deepEqual(Object.keys(result.body).sort(), ['listings', 'plate', 'status', 'verifiedAt']);
});

test('inactive alias does not open an inactive canonical original or revisit either page', async () => {
  const result = await run({ results: [{ url: BASE + TRUSTED }], pages: {
    [TRUSTED]: html(base({ queryCarId: Number(TRUSTED), advertisement: { status: 'SOLD' }, manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } })),
    [ORIGINAL]: html(base({ advertisement: { status: 'SOLD' }, manage: { dummy: false, dummyVehicleId: Number(TRUSTED) } }))
  } });
  assert.equal(result.body.status, 'unverified'); assert.equal(result.body.diagnostics.code, 'AD_INACTIVE');
  assert.equal(result.body.diagnostics.plateMatchedCount, 2); assert.equal(result.body.diagnostics.rejected.notAdvertising, 2);
  assert.equal(detailCalls(result).length, 2); assert.equal(searchCalls(result).length, 2);
});

test('inactive trusted page from another plate never supplies a canonical lookup hint', async () => {
  const result = await run({ results: [{ url: BASE + TRUSTED }], pages: {
    [TRUSTED]: html(base({ vehicleNo: '12나3456', queryCarId: Number(TRUSTED), advertisement: { status: 'SOLD' }, manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } })),
    [ORIGINAL]: html()
  } });
  assert.equal(result.body.diagnostics.code, 'PLATE_MISMATCH'); assert.equal(detailCalls(result).length, 1);
  assert.equal(result.body.diagnostics.plateMatchedCount, 0);
});

test('unknown canonical and trusted states preserve conservative partial-error handling', async t => {
  for (const unknown of ['original', 'trusted']) await t.test(unknown, async () => {
    const result = await run({ results: [{ url: BASE + (unknown === 'original' ? TRUSTED : ORIGINAL) }], pages: {
      [TRUSTED]: html(base({ queryCarId: Number(TRUSTED), advertisement: { status: unknown === 'trusted' ? 'UNSUPPORTED_FIXTURE_STATUS' : 'SOLD' }, manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } })),
      [ORIGINAL]: html(base({ advertisement: { status: unknown === 'original' ? 'UNSUPPORTED_FIXTURE_STATUS' : 'ADVERTISE' }, manage: { dummy: false, dummyVehicleId: Number(TRUSTED) } }))
    } });
    assert.equal(result.reply.status, 502); assert.equal(result.body.diagnostics.code, 'AD_STATUS_UNKNOWN');
    assert.equal(result.body.status, 'error'); assert.equal(searchCalls(result).length, 1);
    assert.ok(result.body.listings.every(item => item.trustedUrl === null));
  });
});

test('canonical cycles between inactive aliases are bounded to one lookup hop and memoized', async () => {
  const result = await run({ results: [{ url: BASE + TRUSTED }], pages: {
    [TRUSTED]: html(base({ queryCarId: Number(TRUSTED), advertisement: { status: 'SOLD' }, manage: { dummy: true, dummyVehicleId: Number(TRUSTED) } })),
    [ORIGINAL]: html(base({ vehicleId: Number(TRUSTED), queryCarId: Number(ORIGINAL), advertisement: { status: 'SOLD' }, manage: { dummy: true, dummyVehicleId: Number(ORIGINAL) } }))
  } });
  assert.equal(result.body.status, 'unverified'); assert.equal(detailCalls(result).length, 2);
  assert.equal(new Set(detailCalls(result).map(call => call.url)).size, 2);
  assert.equal(result.body.diagnostics.candidateCount, 1); assert.equal(result.body.diagnostics.checkedCount, 2);
});

test('fallback raw content actually recovers a known URL or carsbat lot and verifies its detail', async t => {
  for (const item of [
    { url: 'https://example.com/article', content: PLATE, raw_content: BASE + ORIGINAL },
    { url: 'https://carsbat.com/vehicle/synthetic', content: PLATE, raw_content: 'Lot number: ' + ORIGINAL }
  ]) await t.test(item.url.includes('carsbat') ? 'lot' : 'URL', async () => {
    const result = await run({ searches: [{ results: [{ url: item.url, content: PLATE }] }, { results: [item] }], pages: { [ORIGINAL]: html() } });
    assert.equal(result.body.status, 'found'); assert.equal(result.body.listings[0].id, ORIGINAL);
    assert.equal(searchCalls(result).length, 2); assert.equal(detailCalls(result).length, 1);
    assert.equal(JSON.parse(searchCalls(result)[1].options.body).include_raw_content, true);
  });
});

test('only a branded listing ID in a result mentioning the exact plate can be used on an unknown host', async t => {
  for (const label of ['Encar ID: ', '엔카 매물번호: ']) await t.test(label, async () => {
    const result = await run({ searches: [{ results: [] }, { results: [{ url: 'https://example.com/article', title: '12 가-3456', raw_content: label + ORIGINAL }] }], pages: { [ORIGINAL]: html() } });
    assert.equal(result.body.status, 'found'); assert.equal(detailCalls(result).length, 1);
  });
});

test('irrelevant plates and generic lot/numeric labels on unknown hosts never become branded candidates', async t => {
  for (const item of [
    { content: '12나3456', raw_content: 'Encar ID: ' + ORIGINAL },
    { content: '112가34567', raw_content: '엔카 매물번호: ' + ORIGINAL },
    { content: PLATE, raw_content: 'Lot number: ' + ORIGINAL },
    { content: PLATE, raw_content: ORIGINAL }
  ]) await t.test(item.raw_content.slice(0, 15), async () => {
    const result = await run({ searches: [{ results: [] }, { results: [{ url: 'https://unknown.example/article', ...item }] }] });
    assert.equal(result.body.diagnostics.code, 'SEARCH_NO_CANDIDATES'); assert.equal(detailCalls(result).length, 0);
  });
});

test('result relevance, raw availability and known source counters are safe integers with no metadata', async () => {
  const result = await run({ searches: [{ results: [
    { url: 'https://carsbat.com/vehicle/synthetic', title: '１２ 가-３４５６', raw_content: 'PRIVATE_PERSON no lot labels' },
    { url: 'https://unknown.example/article', content: '12나3456', raw_content: ' ' }
  ] }, { results: [{ url: 'https://fem.encar.com/cars', content: 'unrelated content', raw_content: 'PRIVATE_PERSON ' + TOKEN }] }] });
  const diagnostics = result.body.diagnostics;
  assert.equal(diagnostics.resultCount, 3); assert.equal(diagnostics.resultPlateMatchCount, 1);
  assert.equal(diagnostics.rawResultCount, 2); assert.equal(diagnostics.recognizedSourceCount, 2);
  assert.equal(diagnostics.plateMatchedCount, 0);
  for (const key of ['resultPlateMatchCount', 'rawResultCount', 'recognizedSourceCount']) assert(Number.isSafeInteger(diagnostics[key]));
  for (const value of ['PRIVATE_PERSON', TOKEN, 'carsbat.com', 'unknown.example', PLATE]) {
    assert.equal(JSON.stringify(diagnostics).includes(value), false); assert.equal(result.logs.join('').includes(value), false);
  }
});

test('first search retains 512KiB body bound while fallback raw responses may exceed it below 2MiB', async () => {
  const oversizedFirst = await run({ searches: [json({ results: [], padding: 'x'.repeat(512 * 1024) })] });
  assert.equal(oversizedFirst.body.diagnostics.code, 'SEARCH_UNAVAILABLE'); assert.equal(searchCalls(oversizedFirst).length, 1);
  const result = await run({ searches: [{ results: [] }, { results: [{ url: 'https://carsbat.com/vehicle/synthetic', raw_content: 'Lot number: ' + ORIGINAL + ' ' + 'x'.repeat(600 * 1024) }] }], pages: { [ORIGINAL]: html() } });
  assert.equal(result.body.status, 'found'); assert.equal(searchCalls(result).length, 2);
});

test('fallback raw response larger than 2MiB is cancelled and stays an error', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const result = await run({ searches: [{ results: [] }, new Response(body)] });
  assert.equal(result.body.status, 'error'); assert.equal(result.body.diagnostics.code, 'SEARCH_UNAVAILABLE');
  assert.equal(searchCalls(result).length, 2); assert.equal(cancelled, true);
});

test('fallback raw body waiting is still bounded by the shared 35-second deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const body = new ReadableStream({ pull() {} });
  let callCount = 0;
  const pending = run({ searches: [{ results: [] }, new Response(body)], onCall() { if (++callCount <= 3) t.mock.timers.tick(9000); } });
  await new Promise(setImmediate); assert.equal(body.locked, true);
  t.mock.timers.tick(8001);
  const result = await pending;
  assert.equal(result.body.diagnostics.code, 'DEADLINE_EXCEEDED'); assert.equal(searchCalls(result).length, 2);
});
