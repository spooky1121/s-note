import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './encar/html-rewriter-setup.mjs';
import { encarAdvertisementUrl, extractEncarBase, verifyEncarBase, priceFromEncarHtml, encarAdvertisementPageAction, priceFromEncarSnapshot, readEncarAdvertisementPrice } from '../functions/_shared/encar-ad-price.mjs';
const require = createRequire(import.meta.url), { JSDOM } = require('./encar/node_modules/jsdom');
const ID = '43123456', PLATE = '28오6877', ARGS = { id: ID, plate: PLATE };
const base = () => ({ vehicleId: Number(ID), vehicleNo: PLATE, manage: { dummy: false }, advertisement: { status: 'ADVERTISE', price: 5490 } });
const stateHtml = (value = base(), content = '<main><div>판매가 <strong>5,490만원</strong></div></main>') => '<script>window.__PRELOADED_STATE__ = ' + JSON.stringify({ cars: { base: value } }) + ';</script>' + content;
function snapshot(html, value = base(), url = encarAdvertisementUrl(ID)) {
  const page = new JSDOM('<style>body{font-size:16px;opacity:1}strong{font-size:24px;opacity:1}*{opacity:1}</style>' + html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  page.window.HTMLElement.prototype.getBoundingClientRect = function () { return { top: 200, bottom: 240, width: 150, height: 40 }; };
  if (value !== null) page.window.__PRELOADED_STATE__ = { cars: { base: value } };
  try { return JSON.parse(JSON.stringify(page.window.eval('(' + encarAdvertisementPageAction.toString() + ')(' + JSON.stringify({ id: ID }) + ')'))); } finally { page.window.close(); }
}
const visible = '<main><p>' + PLATE + '</p><div>차량 가격 <strong>5,490<span>만원</span></strong></div></main>';

test('native state JSON is parsed without execution, including JSON.parse and escaped braces', () => {
  const value = { ...base(), note: 'quoted \" brace } and \\ path' };
  assert.deepEqual(extractEncarBase(stateHtml(value)), value);
  assert.deepEqual(extractEncarBase('<script>window.__PRELOADED_STATE__=JSON.parse(' + JSON.stringify(JSON.stringify({ cars: { base: value } })) + ');</script>'), value);
  assert.equal(extractEncarBase('<script>window.__PRELOADED_STATE__=(()=>{throw "never execute"})()</script>'), null);
  assert.equal(extractEncarBase('x'.repeat(3 * 1024 * 1024 + 1)), null);
});
test('only exact native ID, full plate, live advertisement and non-dummy vehicle provide identity proof', () => {
  assert.equal(verifyEncarBase(base(), ID, PLATE), true);
  assert.equal(verifyEncarBase(null, ID, PLATE), false);
  for (const changed of [{ vehicleId: '43999999' }, { vehicleNo: '128오6877' }, { vehicleNo: '28오6878' }, { manage: { dummy: true } }]) assert.throws(() => verifyEncarBase({ ...base(), ...changed }, ID, PLATE), { code: 'ENCAR_VEHICLE_MISMATCH' });
  assert.throws(() => verifyEncarBase({ ...base(), advertisement: { status: 'SOLD' } }, ID, PLATE), { code: 'ENCAR_NOT_ADVERTISING' });
  assert.throws(() => verifyEncarBase({ ...base(), advertisement: {} }, ID, PLATE), { code: 'ENCAR_STATUS_UNVERIFIED' });
});
test('fast native HTML quote requires both identity and an explicit visible 만원 amount corroborated by state', async () => {
  assert.equal(await priceFromEncarHtml(stateHtml(), ARGS), 54900000);
  assert.equal(await priceFromEncarHtml(stateHtml({ ...base(), advertisement: { status: 'ADVERTISE', price: 54900000 } }), ARGS), 54900000);
  assert.equal(await priceFromEncarHtml(stateHtml({ ...base(), advertisement: { status: 'ADVERTISE', price: 4990 } }), ARGS), null);
  assert.equal(await priceFromEncarHtml('<main>5,490만원</main>', ARGS), null);
  assert.equal(await priceFromEncarHtml(stateHtml(base(), '<main>월 납입금 49만원</main>'), ARGS), null);
  assert.equal(await priceFromEncarHtml(stateHtml(base(), '<main>판매가 5,490만원<br>다른 차량 4,990만원</main>'), ARGS), null);
  assert.equal(await priceFromEncarHtml(stateHtml(base(), '<main>5490</main>'), ARGS), null);
});
test('browser DOM reads the prominent split-unit price and returns only bounded safe candidate fields', () => {
  const result = snapshot(visible + '<p>PRIVATE_UNRELATED_PHONE</p>'); assert.equal(priceFromEncarSnapshot(result, ARGS), 54900000);
  assert.deepEqual(result.plates, [PLATE]); assert(!JSON.stringify(result).includes('PRIVATE_UNRELATED_PHONE'));
  assert.deepEqual(Object.keys(result).sort(), ['base', 'blocked', 'inactive', 'limited', 'plates', 'prices', 'ready']);
});
test('visible full primary plate can bind the price when the native state is unavailable', () => {
  assert.equal(priceFromEncarSnapshot(snapshot(visible, null), ARGS), 54900000);
  assert.equal(priceFromEncarSnapshot(snapshot('<main><p><span>28</span><b>오</b><span>6877</span></p><strong>5,490만원</strong></main>', null), ARGS), 54900000);
  assert.equal(priceFromEncarSnapshot(snapshot('<main><p>28</p><p>오6877</p><strong>5,490만원</strong></main>', null), ARGS), null);
  assert.equal(priceFromEncarSnapshot(snapshot('<main><p>6877</p><strong>5,490만원</strong></main>', null), ARGS), null);
  assert.throws(() => priceFromEncarSnapshot(snapshot(visible.replace(PLATE, '12가3456'), null), ARGS), { code: 'ENCAR_VEHICLE_MISMATCH' });
});
test('the wrong native state cannot be overruled by a matching visible plate', () => {
  assert.throws(() => priceFromEncarSnapshot(snapshot(visible, { ...base(), vehicleNo: '12가3456' }), ARGS), { code: 'ENCAR_VEHICLE_MISMATCH' });
});
test('hidden, related, monthly, insurance and other-listing prices cannot overwrite the advertised amount', () => {
  const extras = '<div hidden><strong>1,111만원</strong></div><section class="recommend"><p>12가3456</p><strong>2,222만원</strong></section><div class="monthly"><strong>49만원</strong></div><p><strong>보험료 100만원</strong></p><a href="/cars/detail/43999999"><strong>3,333만원</strong></a>';
  assert.equal(priceFromEncarSnapshot(snapshot(visible + extras), ARGS), 54900000);
  assert.throws(() => priceFromEncarSnapshot(snapshot(visible + '<section><strong>4,990만원</strong></section>'), ARGS), { code: 'ENCAR_PRICE_AMBIGUOUS' });
  assert.equal(priceFromEncarSnapshot(snapshot('<p>' + PLATE + '</p><p>5,490만원</p>'), ARGS), null, 'small unrelated text is not the advertised price');
});
test('wrong destination, challenge, sold, oversize and unlabelled values fail closed', () => {
  assert.throws(() => priceFromEncarSnapshot(snapshot(visible, base(), 'https://foreign.invalid/cars/detail/' + ID), ARGS), { code: 'ENCAR_LOCATION_UNVERIFIED' });
  assert.throws(() => priceFromEncarSnapshot(snapshot(visible + '<p>비정상적인 접근입니다</p>'), ARGS), { code: 'ENCAR_ACCESS_BLOCKED' });
  assert.throws(() => priceFromEncarSnapshot(snapshot(visible + '<p>판매가 완료된 차량입니다</p>', null), ARGS), { code: 'ENCAR_NOT_ADVERTISING' });
  assert.throws(() => priceFromEncarSnapshot({ base: base(), prices: ['x'.repeat(181)] }, ARGS), { code: 'ENCAR_PRICE_UNVERIFIED' });
  for (const prices of [['5490'], ['월 49만원'], ['1억 5,490만원'], ['-5,490만원']]) assert.equal(priceFromEncarSnapshot({ base: base(), prices }, ARGS), null);
});
test('money conversion retains exact integer WON and decimal 만원, rather than multiplying by 1000', () => {
  assert.equal(priceFromEncarSnapshot({ base: base(), prices: ['5,490만원'] }, ARGS), 54900000);
  assert.equal(priceFromEncarSnapshot({ base: base(), prices: ['5,490.1234만원'] }, ARGS), 54901234);
});
test('fixed native HTML success avoids Cloudflare, cookies, arbitrary URL and all write methods', async () => {
  let calls = 0; const result = await readEncarAdvertisementPrice({ ...ARGS, fetchImpl: async (url, init) => { calls++; assert.equal(url, encarAdvertisementUrl(ID)); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store'); assert.equal(init.headers.Authorization, undefined); return new Response(stateHtml(), { headers: { 'Content-Type': 'text/html' } }); }, createBrowser: () => { throw Error('must not launch'); }, now: () => 1000 });
  assert.equal(calls, 1); assert.deepEqual(result, { ...ARGS, priceWon: 54900000, checkedAt: '1970-01-01T00:00:01.000Z', source: 'encar' });
});
test('native unavailable falls back once to isolated native-only browser and closes page/context', async () => {
  const visits = [], closes = [], options = []; let reads = 0, sleeps = 0;
  const result = await readEncarAdvertisementPrice({ ...ARGS, env: { marker: 'private' }, fetchImpl: async () => new Response('', { status: 403 }), createBrowser: async (env, args) => { assert.deepEqual(env, { marker: 'private' }); options.push(args); return { async newPage() { return { async goto(url) { visits.push(url); }, async evaluate(expression) { assert(expression.includes('const __name=fn=>fn')); reads++; return { base: base(), prices: reads === 1 ? [] : ['5,490만원'] }; }, async close() { closes.push('page'); } }; }, async close() { closes.push('browser'); } }; }, sleep: async () => { sleeps++; } });
  assert.equal(result.priceWon, 54900000); assert.equal(options[0].encarOnly, true); assert.equal(options[0].gloarOnly, undefined); assert.deepEqual(visits, [encarAdvertisementUrl(ID)]); assert.deepEqual(closes, ['page', 'browser']); assert.equal(reads, 2); assert.equal(sleeps, 1);
});
test('Cloudflare quota is surfaced unchanged without relaunch, credential rotation or alternate provider', async () => {
  let launches = 0;
  await assert.rejects(readEncarAdvertisementPrice({ ...ARGS, fetchImpl: async () => new Response('', { status: 403 }), createBrowser: async () => { launches++; throw Object.assign(Error('private'), { code: 'UPSTREAM_RATE_LIMITED', retryAfter: 28 }); } }), error => error.code === 'UPSTREAM_RATE_LIMITED' && error.retryAfter === 28);
  assert.equal(launches, 1);
});
test('native quota and verified mismatches stop before opening another browser', async () => {
  for (const response of [() => new Response('', { status: 429 }), () => new Response(stateHtml({ ...base(), vehicleNo: '12가3456' }), { headers: { 'Content-Type': 'text/html' } })]) {
    let launches = 0; await assert.rejects(readEncarAdvertisementPrice({ ...ARGS, fetchImpl: response, createBrowser: () => { launches++; } }), error => ['ENCAR_RATE_LIMITED', 'ENCAR_VEHICLE_MISMATCH'].includes(error.code)); assert.equal(launches, 0);
  }
});
test('a cancelled browser price read closes resources and never returns a price', async () => {
  const controller = new AbortController(), closes = [];
  await assert.rejects(readEncarAdvertisementPrice({ ...ARGS, signal: controller.signal, fetchImpl: async () => new Response('', { status: 403 }), createBrowser: async () => ({ async newPage() { return { async goto() {}, async evaluate() { controller.abort(); return { base: base(), prices: [] }; }, async close() { closes.push('page'); } }; }, async close() { closes.push('browser'); } }), sleep: async signal => { assert.equal(signal.aborted, true); throw Object.assign(Error('abort'), { code: 'ABORTED' }); } }), { code: 'ABORTED' });
  assert.deepEqual(closes, ['page', 'browser']);
});
