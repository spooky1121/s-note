// The actual browser module talks to the actual API handler. Only upstream
// HTTP and window.open are synthetic; no credentials or production data are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const frontend = await readFile(new URL('../../assets/snote-encar-link.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../../functions/api/encar.js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(backend).toString('base64'));
const PLATE = '12가3456', ORIGINAL = '43000001', TRUSTED = '43000002';
const BASE = 'https://fem.encar.com/cars/detail/';
const TOKEN = 'synthetic_integration_token_longer_than_thirty_characters';
const USER = '10000000-0000-4000-8000-000000000001';
const tick = () => new Promise(resolve => setImmediate(resolve));

function detail(id, plate = PLATE) {
  const trusted = id === TRUSTED;
  return '<script>window.__PRELOADED_STATE__ = ' + JSON.stringify({ cars: { base: {
    vehicleNo: plate, vehicleId: Number(ORIGINAL), queryCarId: Number(id),
    advertisement: { status: 'ADVERTISE' },
    manage: { dummy: trusted, dummyVehicleId: Number(TRUSTED) },
    category: { modelName: '가상 연동 검증 차량' }, spec: { mileage: 100 }
  } } }) + ';</script>';
}

function fixture(t, { batches = [], plate = PLATE } = {}) {
  const dom = new JSDOM('<!doctype html><div id="zc-cloud-gate" hidden></div>' +
    '<div id="zc86-topbar"></div><section id="vehicle-overlay" class="open"><p id="vehicle-meta">차량</p></section>',
  { url: 'https://integration.example/', runScripts: 'outside-only' });
  const w = dom.window, requests = [], searches = [], tabs = [], logs = [];
  const previousFetch = globalThis.fetch, previousInfo = console.info;
  console.info = value => logs.push(value);
  let heldDetail = null;
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.href === 'https://fixture.supabase.co/auth/v1/user') return json({ id: USER });
    if (url.origin === 'https://fixture.supabase.co' && url.pathname === '/rest/v1/zc_members') return json([{ user_id: USER }]);
    if (url.href === 'https://api.tavily.com/search') {
      searches.push(JSON.parse(options.body));
      return json({ results: batches.shift() || [] });
    }
    if (url.origin === 'https://fem.encar.com' && [ORIGINAL, TRUSTED].some(id => url.href === BASE + id)) {
      if (heldDetail) await heldDetail;
      return new Response(detail(url.pathname.split('/').at(-1), plate), { headers: { 'Content-Type': 'text/html' } });
    }
    assert.fail('Unexpected upstream in integration fixture');
  };
  w.cars = [{ id: 'fixture-car', plate: PLATE }]; w.activeCarId = 'fixture-car'; w.currentUser = { id: USER };
  w.zc86Cloud = { ready: true, getAccessToken: async () => TOKEN };
  w.open = () => {
    const tab = { opener: w, document: w.document.implementation.createHTMLDocument(''), closed: false, navigations: [],
      close() { this.closed = true; }, location: { replace(url) { tab.navigations.push(url); } } };
    tabs.push(tab); return tab;
  };
  w.fetch = async (url, init) => {
    assert.equal(url, '/api/encar');
    requests.push(JSON.parse(init.body));
    const controller = new AbortController(), abort = () => controller.abort();
    init.signal.addEventListener('abort', abort, { once: true });
    try {
      return await onRequest({ request: new Request('https://integration.example/api/encar', {
        method: init.method, headers: init.headers, body: init.body, signal: controller.signal
      }), env: { TAVILY_API_KEY: 'synthetic_search_secret', SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'synthetic_publishable_key' } });
    } finally { init.signal.removeEventListener('abort', abort); }
  };
  w.eval(frontend); if (!w.SnoteEncarLink) w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  t.after(() => { globalThis.fetch = previousFetch; console.info = previousInfo; dom.window.close(); });
  const button = w.document.querySelector('.snote-encar-button');
  async function done() {
    for (let attempt = 0; attempt < 100; attempt++) { await tick(); if (!button.disabled) return; }
    assert.fail('Integration fixture did not finish');
  }
  return { w, button, tabs, searches, requests, logs, done,
    holdDetails(promise) { heldDetail = promise; },
    get note() { return w.document.querySelector('.snote-encar-note').textContent; },
    get manual() { return w.document.querySelector('.snote-encar-manual'); },
    submit(url) { w.document.querySelector('.snote-encar-manual input').value = url;
      w.document.querySelector('.snote-encar-manual form').dispatchEvent(new w.Event('submit', { cancelable: true })); }
  };
}

test('integration: automatic fallback uses the plate and opens separately verified original/trusted links', async t => {
  const f = fixture(t, { batches: [[], [{ url: 'https://encar.spb.ru/auto/' + ORIGINAL + '/' }]] });
  f.button.click(); await f.done();
  assert.deepEqual(f.searches.map(search => search.query), ['"' + PLATE + '"', PLATE]);
  assert.deepEqual(f.tabs[0].navigations, [BASE + ORIGINAL]);
  assert.equal(f.tabs[0].opener, null);
  assert.deepEqual([...f.w.document.querySelectorAll('.snote-encar-results a')].map(a => a.href), [BASE + ORIGINAL, BASE + TRUSTED]);
  assert.equal(f.manual.hidden, true);
});

test('integration: fallback raw content supplies a missing indexed candidate before any link can open', async t => {
  const f = fixture(t, { batches: [[{ url: 'https://fixture.invalid/vehicle', title: '가상 검색 결과' }],
    [{ url: 'https://carsbat.com/fixture', title: '가상 검색 결과', raw_content: PLATE + ' Lot number: ' + ORIGINAL }]] });
  f.button.click(); await f.done();
  assert.equal(f.searches.length, 2);
  assert.equal(f.searches[0].include_raw_content, false);
  assert.equal(f.searches[1].include_raw_content, true);
  assert.deepEqual(f.tabs[0].navigations, [BASE + ORIGINAL]);
  assert.equal(f.manual.hidden, true);
});

test('integration: no indexed candidate reports its stage; a supplied URL still waits for real server verification', async t => {
  const f = fixture(t); f.button.click(); await f.done();
  assert.equal(f.tabs[0].closed, true); assert.equal(f.manual.hidden, false);
  assert.match(f.note, /검색에서 광고 후보/);
  let release; f.holdDetails(new Promise(resolve => { release = resolve; }));
  f.submit(BASE + ORIGINAL); await tick();
  assert.deepEqual(f.requests[1].candidateIds, [ORIGINAL]);
  assert.deepEqual(f.tabs[1].navigations, [], 'An input URL alone never authorizes navigation');
  release(); await f.done();
  assert.deepEqual(f.tabs[1].navigations, [BASE + ORIGINAL]);
  assert.equal(f.searches.length, 2, 'Verified supplied hints do not need another search');
  assert.doesNotMatch(f.logs.join('\n'), /12가3456|43000001|43000002|synthetic_search_secret|synthetic_publishable_key|synthetic_integration_token/);
});

test('integration: a supplied URL for another plate stays unverified through both API and screen', async t => {
  const f = fixture(t, { plate: '34나5678' }); f.button.click(); await f.done();
  f.submit(BASE + ORIGINAL); await f.done();
  assert.equal(f.tabs[1].closed, true); assert.deepEqual(f.tabs[1].navigations, []);
  assert.match(f.note, /차량번호가 현재 차량과 일치하지/);
  assert.equal(f.w.document.querySelectorAll('.snote-encar-results a').length, 0);
});
