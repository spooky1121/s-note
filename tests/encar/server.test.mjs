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
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (urlValue, options = {}) => {
    const url = new URL(urlValue);
    const call = { url: url.href, options };
    calls.push(call);
    if (url.origin === env.SUPABASE_URL && url.pathname === '/auth/v1/user') {
      assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
      assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
      return json(config.user ?? { id: USER_ID }, config.authStatus ?? 200);
    }
    if (url.origin === env.SUPABASE_URL && url.pathname === '/rest/v1/zc_members') {
      assert.equal(url.searchParams.get('select'), 'user_id');
      assert.equal(url.searchParams.get('user_id'), 'eq.' + USER_ID);
      assert.equal(url.searchParams.get('active'), 'eq.true');
      assert.equal(url.searchParams.get('limit'), '1');
      return json(config.members ?? [{ user_id: USER_ID }], config.membershipStatus ?? 200);
    }
    if (url.href === 'https://api.tavily.com/search') {
      if (config.searchThrows) throw config.searchThrows;
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
    return { reply, body: await reply.json(), calls };
  } finally {
    globalThis.fetch = oldFetch;
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
  assert.equal(searchCalls(result).length, 1);
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
