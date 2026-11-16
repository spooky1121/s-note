import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './html-rewriter-setup.mjs';

const source = (await readFile(new URL('../../functions/api/encar.js', import.meta.url), 'utf8'))
  .replace("'../_shared/encar-catalog.mjs'", JSON.stringify(new URL('../../functions/_shared/encar-catalog.mjs', import.meta.url).href))
  .replace("'../_shared/encar-page-price.mjs'", JSON.stringify(new URL('../../functions/_shared/encar-page-price.mjs', import.meta.url).href));
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const PLATE = '12가3456';
const ID = '43000001';
const BASE = 'https://fem.encar.com/cars/detail/';
const CATALOG = 'https://encar.spb.ru';
const TOKEN = 'synthetic_access_token_with_more_than_thirty_characters';
const USER = '10000000-0000-4000-8000-000000000001';
const ENV = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'synthetic_publishable_key',
  TAVILY_API_KEY: 'synthetic_tavily_key'
};

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function page(id = ID, overrides = {}) {
  return '<!doctype html><script>window.__PRELOADED_STATE__ = ' + JSON.stringify({ cars: { base: {
    vehicleNo: PLATE, vehicleId: Number(id), queryCarId: Number(id),
    advertisement: { status: 'ADVERTISE' }, manage: { dummy: false, dummyVehicleId: null },
    category: { modelName: '합성 조회 차량' }, spec: { mileage: 100 }, ...overrides
  } } }) + ';</script>';
}

async function run({ results = [], searches, pages = {}, candidateIds, cacheIds, externalPages = {}, searchKey = ENV.TAVILY_API_KEY } = {}) {
  const calls = [], pending = [], logs = [];
  const previousFetch = globalThis.fetch, previousInfo = console.info;
  let searchIndex = 0;
  console.info = (...values) => logs.push(values.join(' '));
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    calls.push({ url: url.href, options });
    if (url.origin === ENV.SUPABASE_URL && url.pathname === '/auth/v1/user') return json({ id: USER });
    if (url.origin === ENV.SUPABASE_URL && url.pathname === '/rest/v1/zc_members') return json([{ user_id: USER }]);
    if (url.origin === CATALOG) {
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      return new Response(url.pathname === '/'
        ? '<form action="/catalog" method="get"><input name="car_number" aria-label="Номер автомобиля"><button>Поиск</button></form>'
        : '<div class="no-results">Ничего не найдено</div>', { headers: { 'Content-Type': 'text/html' } });
    }
    if (url.href === 'https://api.tavily.com/search') {
      const batch = searches ? searches[searchIndex++] : results;
      assert.ok(Array.isArray(batch), 'No more than the specified search batches are allowed');
      return json({ results: batch });
    }
    if (url.origin === 'https://fem.encar.com' && /^\/cars\/detail\/[0-9]+$/.test(url.pathname)) {
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      const id = url.pathname.split('/').at(-1);
      if (pages[id] instanceof Error) throw pages[id];
      return Object.hasOwn(pages, id)
        ? pages[id] instanceof Response ? pages[id].clone() : new Response(pages[id], { headers: { 'Content-Type': 'text/html' } })
        : new Response('Not found', { status: 404 });
    }
    if (Object.hasOwn(externalPages, url.href)) {
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
      assert.deepEqual(options.headers, { Accept: 'text/html' });
      assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
      const body = externalPages[url.href];
      return body instanceof Response ? body.clone() : new Response(body, { headers: { 'Content-Type': 'text/html' } });
    }
    throw new Error('Unexpected upstream: ' + url.origin);
  };
  try {
    const reply = await onRequest({
      request: new Request('https://snote.example/api/encar', {
        method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate: PLATE, ...(candidateIds ? { candidateIds } : {}) })
      }),
      env: {
        ...ENV,
        TAVILY_API_KEY: searchKey,
        ...(cacheIds ? { ENCAR_CACHE: {
          async get(key) { assert.equal(key, 'encar:candidates:v1:' + PLATE); return JSON.stringify(cacheIds); },
          async put() {}
        } } : {})
      },
      waitUntil(promise) { pending.push(promise); }
    });
    await Promise.all(pending);
    return { reply, body: await reply.json(), calls, logs };
  } finally {
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
  }
}

const details = result => result.calls.filter(call => call.url.startsWith(BASE));
const searchCalls = result => result.calls.filter(call => call.url === 'https://api.tavily.com/search');

test('ASCII regional trust-encar result URLs provide hints but only verified official links are returned', async t => {
  for (const host of ['cheboksary.trust-encar.ru', 'saint-petersburg.trust-encar.ru']) await t.test(host, async () => {
    const result = await run({ results: [{ url: 'https://' + host + '/auto/' + ID + '/', content: PLATE }], pages: { [ID]: page() } });
    assert.equal(result.reply.status, 200);
    assert.equal(result.body.status, 'found');
    assert.equal(result.body.listings[0].sellerUrl, BASE + ID);
    assert.equal(result.body.listings[0].trustedUrl, null);
    assert.deepEqual(details(result).map(call => call.url), [BASE + ID]);
    assert.equal(result.calls.some(call => new URL(call.url).hostname === host), false);
    assert.equal(JSON.stringify(result.body).includes(host), false);
  });
});

test('lookalike, credentialed, port and invalid DNS trust-encar URLs never become candidates', async t => {
  const bad = [
    'https://cheboksary.trust-encar.ru.evil.example',
    'https://nottrust-encar.ru',
    'https://trust-encar.ru.evil.example',
    'https://user:pass@cheboksary.trust-encar.ru',
    'https://cheboksary.trust-encar.ru:444',
    'https://cheboksary.trust-encar.ru:443',
    'https://чебоксары.trust-encar.ru',
    'https://chebok_sary.trust-encar.ru',
    'https://-cheboksary.trust-encar.ru',
    'https://cheboksary-.trust-encar.ru',
    'https://a..trust-encar.ru',
    'https://' + 'a'.repeat(64) + '.trust-encar.ru'
  ];
  for (const origin of bad) await t.test(origin, async () => {
    const result = await run({ results: [{ url: origin + '/auto/' + ID + '/', content: PLATE }], pages: { [ID]: page() } });
    assert.equal(result.body.status, 'unverified');
    assert.equal(result.body.diagnostics.code, 'SEARCH_NO_CANDIDATES');
    assert.equal(result.body.diagnostics.candidateCount, 0);
    assert.equal(details(result).length, 0);
    assert.equal(result.body.listings.length, 0);
  });
});

test('exact full-plate URL at result eight is verified before six unrelated URL candidates', async () => {
  const results = Array.from({ length: 7 }, (_, index) => ({
    url: BASE + String(43000010 + index), content: index === 0 ? '서울' + PLATE : '34나5678'
  }));
  results.push({ url: BASE + ID, content: PLATE });
  const result = await run({ results, pages: { [ID]: page() } });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].id, ID);
  assert.ok(details(result).some(call => call.url === BASE + ID));
  assert.ok(details(result).length <= 6);
  assert.equal(searchCalls(result).length, 1);
});

test('six stale client hints do not discard a separately cached verified candidate', async () => {
  const stale = Array.from({ length: 6 }, (_, index) => String(43000020 + index));
  const result = await run({ candidateIds: stale, cacheIds: [ID], pages: { [ID]: page() } });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].id, ID);
  assert.equal(searchCalls(result).length, 0);
  assert.ok(details(result).some(call => call.url === BASE + ID));
  assert.equal(details(result).length, 7);
});

test('twelve stale client and cached hints leave room for a fresh exact-plate search result', async () => {
  const client = Array.from({ length: 6 }, (_, index) => String(43000030 + index));
  const cached = Array.from({ length: 6 }, (_, index) => String(43000040 + index));
  const result = await run({
    candidateIds: client, cacheIds: cached,
    results: [{ url: BASE + ID, content: PLATE }], pages: { [ID]: page() }
  });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].id, ID);
  assert.equal(searchCalls(result).length, 1);
  assert.equal(details(result).length, 13);
  assert.equal(new Set(details(result).map(call => call.url)).size, 13);
});

test('twelve stale hints and six search candidates stop at eighteen unique checks without another search', async () => {
  const client = Array.from({ length: 6 }, (_, index) => String(43000030 + index));
  const cached = Array.from({ length: 6 }, (_, index) => String(43000040 + index));
  const found = Array.from({ length: 6 }, (_, index) => String(43000050 + index));
  const result = await run({
    candidateIds: client, cacheIds: cached,
    searches: [found.map(id => ({ url: BASE + id, content: PLATE }))]
  });
  assert.equal(result.body.status, 'unverified');
  assert.equal(result.body.diagnostics.candidateCount, 18);
  assert.equal(result.body.diagnostics.checkedCount, 18);
  assert.equal(searchCalls(result).length, 1);
  assert.equal(details(result).length, 18);
  assert.equal(new Set(details(result).map(call => call.url)).size, 18);
});

test('client and cache hint arrays each retain their six-ID limit', async () => {
  const client = Array.from({ length: 8 }, (_, index) => String(43000060 + index));
  const cached = Array.from({ length: 8 }, (_, index) => String(43000070 + index));
  const result = await run({ candidateIds: client, cacheIds: cached });
  assert.equal(result.body.status, 'unverified');
  assert.equal(result.body.diagnostics.candidateCount, 12);
  assert.equal(result.body.diagnostics.checkedCount, 12);
  assert.deepEqual(new Set(details(result).map(call => call.url)), new Set([...client.slice(0, 6), ...cached.slice(0, 6)].map(id => BASE + id)));
  assert.equal(searchCalls(result).length, 2);
});

test('an exact-plate regional catalogue result supplies official links before unrelated direct URLs', async () => {
  const results = Array.from({ length: 7 }, (_, index) => ({ url: BASE + String(43000010 + index), content: '34나5678' }));
  results.push({ url: 'https://cheboksary.trust-encar.ru/catalog/synthetic/model/', raw_content: PLATE + ' https://www.encar.com/dc/dc_cardetailview.do?carid=' + ID });
  const result = await run({ results, pages: { [ID]: page() } });
  assert.equal(result.body.status, 'found');
  assert.equal(result.body.listings[0].sellerUrl, BASE + ID);
  assert.ok(details(result).some(call => call.url === BASE + ID));
  assert.ok(details(result).length <= 6);
  assert.equal(searchCalls(result).length, 1);
  assert.equal(result.calls.some(call => new URL(call.url).hostname.endsWith('.trust-encar.ru')), false);
});

test('regional mirror hints cannot override official plate or advertising-state checks', async t => {
  for (const [name, overrides, code] of [
    ['different official plate', { vehicleNo: '34나5678' }, 'PLATE_MISMATCH'],
    ['sold official advertisement', { advertisement: { status: 'SOLD' } }, 'AD_INACTIVE']
  ]) await t.test(name, async () => {
    const result = await run({ results: [{ url: 'https://cheboksary.trust-encar.ru/auto/' + ID + '/', content: PLATE }], pages: { [ID]: page(ID, overrides) } });
    assert.equal(result.body.status, 'unverified');
    assert.equal(result.body.diagnostics.code, code);
    assert.equal(result.body.listings.length, 0);
    assert.deepEqual(details(result).map(call => call.url), [BASE + ID]);
  });
});

const EXTERNAL = 'https://nnov.trust-encar.ru/auto/' + ID + '/';
const BLOCK = () => new Response('서비스 이용 제한됨', { status: 403 });
function externalPage(id = ID, plate = PLATE, related = '') {
  return '<main><h1>Synthetic electric vehicle</h1>' +
    '<p>Дата добавления объявления 21.10.2026</p><p>Дата модификации объявления 22.10.2026</p>' +
    '<ul class="vehicle-specs"><li><span>Лот</span><strong>' + id + '</strong></li>' +
    '<li><span>Номер автомобиля</span><strong>' + plate + '</strong></li></ul>' +
    '<a href="https://www.encar.com/dc/dc_cardetailview.do?carid=' + id + '">Авто на Encar</a>' + related + '</main>';
}

test('a freshly fetched exact main-vehicle match retains an official link with separate external evidence when Encar blocks', async () => {
  const start = Date.now();
  const result = await run({
    results: [{ url: EXTERNAL, content: PLATE + ' PRIVATE_INDEX_CONTENT' }],
    pages: { [ID]: BLOCK() }, externalPages: { [EXTERNAL]: externalPage() }
  });
  assert.equal(result.reply.status, 200); assert.equal(result.body.status, 'found');
  const item = result.body.listings[0];
  assert.equal(item.id, ID); assert.equal(item.sellerUrl, BASE + ID);
  assert.equal(item.trustedId, null); assert.equal(item.trustedUrl, null);
  assert.deepEqual([item.priceWon, item.priceSource, item.priceCheckedAt, item.priceStatus], [null, null, null, 'unavailable']);
  assert.deepEqual({ ...item.externalVerification, checkedAt: null }, {
    source: 'trust-encar', sourceUrl: EXTERNAL, checkedAt: null, advertisedAt: '2026-10-21', modifiedAt: '2026-10-22'
  });
  assert(Date.parse(item.externalVerification.checkedAt) >= start && Date.parse(item.externalVerification.checkedAt) <= Date.now());
  assert.equal(result.calls.filter(call => call.url === EXTERNAL).length, 1);
  assert.equal(details(result).length, 1);
  assert.equal(result.calls.some(call => new URL(call.url).hostname === 'api.encar-api.com'), false);
  assert.doesNotMatch(result.logs.join(''), /12가3456|43000001|nnov|PRIVATE_INDEX|synthetic_access|synthetic_tavily/);
});

test('a snippet matching only a recommended vehicle never promotes the current external page ID', async () => {
  const related = '<section><h2>Похожие автомобили</h2><article class="car-card">' + PLATE +
    '<a href="/auto/43000003/">Related vehicle</a></article></section>';
  const result = await run({
    results: [{ url: EXTERNAL, raw_content: PLATE }], pages: { [ID]: BLOCK() },
    externalPages: { [EXTERNAL]: externalPage(ID, '34나5678', related) }
  });
  assert.equal(result.reply.status, 502); assert.equal(result.body.diagnostics.code, 'DETAIL_BLOCKED');
  assert.deepEqual(result.body.listings, []); assert.equal(result.calls.filter(call => call.url === EXTERNAL).length, 1);
  assert.equal(details(result).length, 1);
});

test('the original catalogue card supplies its own matching ID instead of borrowing the page or snippet ID', async () => {
  const correct = '43000003', url = 'https://nnov.trust-encar.ru/catalog/synthetic/model/';
  const result = await run({
    results: [{ url, content: PLATE + ' Лот: ' + ID }], pages: { [correct]: BLOCK() },
    externalPages: { [url]: '<article class="car-card">34나5678<a href="/auto/' + ID + '/">Other</a></article>' +
      '<article class="car-card">' + PLATE + '<a href="/auto/' + correct + '/">Exact</a></article>' }
  });
  assert.equal(result.body.status, 'found'); assert.equal(result.body.listings[0].id, correct);
  assert.equal(result.body.listings[0].sellerUrl, BASE + correct);
  assert.equal(result.body.listings[0].externalVerification.sourceUrl, url);
  assert(details(result).some(call => call.url === BASE + correct));
});

test('a recovered search can replace a blocked saved hint with an independently verified official advertisement', async () => {
  const fresh = '43000003';
  const result = await run({ candidateIds: [ID], pages: { [ID]: BLOCK(), [fresh]: page(fresh) }, results: [{ url: BASE + fresh, content: PLATE }] });
  assert.equal(result.body.status, 'found'); assert.equal(result.body.listings[0].id, fresh);
  assert.equal(result.body.listings[0].externalVerification, undefined);
  assert.equal(searchCalls(result).length, 1); assert.equal(details(result).filter(call => call.url === BASE + ID).length, 1);
});

test('explicit official rejection and unknown advertising status cannot be overridden by an exact mirror record', async t => {
  for (const [name, body, status] of [
    ['mismatch', page(ID, { vehicleNo: '34나5678' }), 200],
    ['sold', page(ID, { advertisement: { status: 'SOLD' } }), 200],
    ['unknown', page(ID, { advertisement: { status: 'UNKNOWN' } }), 200],
    ['not found', 'Not found', 404], ['gone', 'Gone', 410]
  ]) await t.test(name, async () => {
    const result = await run({ results: [{ url: EXTERNAL, content: PLATE }], pages: { [ID]: new Response(body, { status }) }, externalPages: { [EXTERNAL]: externalPage() } });
    assert.deepEqual(result.body.listings, []);
    assert.equal(result.calls.some(call => call.url === EXTERNAL), false);
  });
});

test('a search snippet is insufficient when the actual source is blocked, redirected, oversized or malformed', async t => {
  for (const response of [
    new Response('Forbidden', { status: 403 }),
    new Response('', { status: 302, headers: { Location: 'https://evil.example/' } }),
    new Response('too large', { headers: { 'Content-Length': String(3 * 1024 * 1024 + 1) } }),
    new Response('<main>Unknown page ' + PLATE + '</main>')
  ]) await t.test(String(response.status) + ':' + (response.headers.get('Content-Length') || ''), async () => {
    const result = await run({ results: [{ url: EXTERNAL, content: PLATE }], pages: { [ID]: BLOCK() }, externalPages: { [EXTERNAL]: response } });
    assert.deepEqual(result.body.listings, []); assert.equal(result.reply.status, 502);
    assert.equal(result.calls.filter(call => call.url === EXTERNAL).length, 1);
    assert.equal(result.calls.some(call => new URL(call.url).hostname === 'evil.example'), false);
  });
});

test('only the allowed official transport and parse failures may retain an exact externally matched link', async t => {
  for (const [name, official] of [
    ['blocked', BLOCK()], ['unavailable', new Response('Unavailable', { status: 503 })],
    ['malformed state', '<script>window.__PRELOADED_STATE__={broken}</script>'],
    ['timeout', new DOMException('Synthetic timeout', 'AbortError')]
  ]) await t.test(name, async () => {
    const result = await run({ results: [{ url: EXTERNAL, content: PLATE }], pages: { [ID]: official }, externalPages: { [EXTERNAL]: externalPage() } });
    assert.equal(result.body.status, 'found'); assert.equal(result.body.listings[0].externalVerification.sourceUrl, EXTERNAL);
    assert.equal(details(result).length, 1); assert.equal(result.body.listings[0].priceStatus, 'unavailable');
  });
});

test('at most six public source pages are fetched across both searches and unrelated bodies never supply a link', async () => {
  const ids = Array.from({ length: 8 }, (_, index) => String(43000010 + index));
  const urls = ids.map(id => 'https://nnov.trust-encar.ru/auto/' + id + '/');
  const result = await run({
    results: urls.map(url => ({ url, content: PLATE })),
    pages: Object.fromEntries(ids.map(id => [id, BLOCK()])),
    externalPages: Object.fromEntries(urls.map((url, index) => [url, externalPage(ids[index], '34나5678')]))
  });
  assert.deepEqual(result.body.listings, []); assert.equal(result.body.diagnostics.code, 'DETAIL_BLOCKED');
  assert.equal(result.calls.filter(call => new URL(call.url).hostname === 'nnov.trust-encar.ru').length, 6);
  assert.equal(searchCalls(result).length, 2); assert.equal(details(result).length, 6);
});

test('a saved known ID can be checked against the observed mirror route without a search API key', async () => {
  const result = await run({ searchKey: '', candidateIds: [ID], pages: { [ID]: BLOCK() }, externalPages: { [EXTERNAL]: externalPage() } });
  assert.equal(result.body.status, 'found'); assert.equal(result.body.listings[0].id, ID);
  assert.equal(result.body.listings[0].externalVerification.sourceUrl, EXTERNAL);
  assert.equal(result.body.listings[0].priceStatus, 'unavailable');
  assert.equal(searchCalls(result).length, 0); assert.equal(details(result).length, 1);
  assert.equal(result.calls.filter(call => call.url === EXTERNAL).length, 1);
});

test('a known-ID mirror page for another plate is rejected without guessing any other advertisement ID', async () => {
  const result = await run({ searchKey: '', candidateIds: [ID], pages: { [ID]: BLOCK() }, externalPages: { [EXTERNAL]: externalPage(ID, '34나5678') } });
  assert.equal(result.reply.status, 502); assert.equal(result.body.diagnostics.code, 'DETAIL_BLOCKED');
  assert.deepEqual(result.body.listings, []); assert.equal(details(result).length, 1); assert.equal(searchCalls(result).length, 0);
  assert.equal(result.calls.filter(call => new URL(call.url).hostname.endsWith('trust-encar.ru')).length, 1);
});

test('known-ID fallback uses at most three existing hints and never creates IDs or runs before fresh searches', async () => {
  const ids = Array.from({ length: 5 }, (_, index) => String(43000010 + index));
  const urls = ids.map(id => 'https://nnov.trust-encar.ru/auto/' + id + '/');
  const result = await run({ candidateIds: ids, pages: Object.fromEntries(ids.map(id => [id, BLOCK()])),
    externalPages: Object.fromEntries(urls.map((url, index) => [url, externalPage(ids[index], '34나5678')])) });
  assert.deepEqual(result.body.listings, []); assert.equal(searchCalls(result).length, 2);
  const external = result.calls.filter(call => new URL(call.url).hostname === 'nnov.trust-encar.ru');
  assert.deepEqual(external.map(call => call.url), urls.slice(0, 3));
  assert(result.calls.indexOf(external[0]) > result.calls.indexOf(searchCalls(result)[1]));
  assert.equal(details(result).length, ids.length);
  const none = await run({ searchKey: '' });
  assert.equal(none.calls.some(call => new URL(call.url).hostname.endsWith('trust-encar.ru')), false);
});
