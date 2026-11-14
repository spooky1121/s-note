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

async function run({ results = [], searches, pages = {}, candidateIds, cacheIds } = {}) {
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
      return Object.hasOwn(pages, id)
        ? new Response(pages[id], { headers: { 'Content-Type': 'text/html' } })
        : new Response('Not found', { status: 404 });
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
