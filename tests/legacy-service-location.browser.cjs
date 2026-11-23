'use strict';
// Only synthetic pages and intercepted requests. No production service or stored customer data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./encar/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.LEGACY_LOCATION_ARTIFACT_DIR || '/workspace/work/legacy-web-v2200/service-location';
const SCRIPT = fs.readFileSync(path.join(ROOT, 'assets/service-location.js'), 'utf8');
const results = [];
fs.mkdirSync(OUT, { recursive: true });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function deadline(promise) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Expected canonical navigation did not start')), 10000); })]); }
  finally { clearTimeout(timer); }
}
async function until(predicate) {
  const limit = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > limit) throw Error('Synthetic browser observation timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function html() {
  return '<!doctype html><html><head><meta charset="utf-8"><script src="/assets/service-location.js?v=2.200"></script><title>Fixture app</title><script src="/__fixture_boot.js"></script></head><body><main id="app">Synthetic current app</main></body></html>';
}
async function fixture(browser, { hold = false, frame = null } = {}) {
  const context = await browser.newContext(), entered = deferred(), release = deferred(), requests = [], errors = [], stops = [];
  await context.exposeBinding('__recordServiceStop', (_source, value) => stops.push(value));
  await context.addInitScript(() => {
    const calls = [], originalGet = Storage.prototype.getItem;
    let storageUnavailable = false;
    try { Storage.prototype.setItem.call(localStorage, 'synthetic-company-record', '{"name":"보존할 합성 상사"}'); }
    catch (_) { storageUnavailable = true; }
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[name]; Storage.prototype[name] = function (...args) { calls.push(name); return original.apply(this, args); };
    }
    const oldOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { calls.push('indexedDB.open'); return oldOpen(...args); };
    window.__storedProbe = () => ({ calls: [...calls], storageUnavailable,
      company: storageUnavailable ? null : originalGet.call(localStorage, 'synthetic-company-record') });
    const nativeStop = window.stop.bind(window);
    window.stop = () => {
      const notice = document.getElementById('snote-service-location');
      void window.__recordServiceStop({ url: location.href, visibility: document.documentElement.style.visibility,
        noticeVisibility: notice ? getComputedStyle(notice).visibility : null,
        exit: document.getElementById('snote-service-location-exit')?.href, booted: window.__appBooted === true, probe: __storedProbe() });
      nativeStop();
    };
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ url: request.url(), method: request.method(), navigation: request.isNavigationRequest(), referer: request.headers().referer });
    if (url.pathname === '/assets/service-location.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/__fixture_boot.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.__appBooted=true;' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"synthetic":true}' });
    if (frame && url.hostname !== 's-note.kr' && url.pathname === '/old-open-app.html') {
      const child = frame === 'same-origin' ? '/monthly.html?child=1#child-fragment' : 'https://zerocar-office.pages.dev/monthly.html?child=1#child-fragment';
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>Already-open synthetic app</title></head><body><main id="old-app">Old open app</main><input id="existing-draft" value="보존할 합성 입력"><iframe ' + (frame === 'restricted' ? 'sandbox="allow-scripts allow-same-origin" ' : '') + 'src="' + child + '"></iframe></body></html>' });
    }
    if (url.hostname === 's-note.kr' && request.isNavigationRequest() && hold) {
      entered.resolve({ url: request.url(), referer: request.headers().referer }); await release.promise;
    }
    return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'self'" }, body: html() });
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  return { context, page, entered, release, requests, errors, stops, async close() { release.resolve(); await context.close(); } };
}
function intact(probe, allowUnavailable = false) { assert.deepEqual(probe.calls, []); if (probe.storageUnavailable) assert.equal(allowUnavailable, true); else assert.equal(probe.company, '{"name":"보존할 합성 상사"}'); }
async function navigate(page, url) { await page.goto(url, { waitUntil: 'commit' }).catch(error => { if (!String(error).includes('ERR_ABORTED')) throw error; }); }

async function retired(browser, start, expected, history = false) {
  console.log('START retired', start);
  const f = await fixture(browser, { hold: true }), { page: p } = f;
  try {
    if (history) { await p.goto('https://previous.example/sentinel'); await p.waitForFunction(() => window.__appBooted === true); }
    await navigate(p, start); console.log('SOURCE committed', start); const request = await deadline(f.entered.promise); console.log('CANONICAL entered', expected);
    assert.equal(request.url, expected.split('#')[0]); assert.equal(request.referer, undefined, 'Old path/query must not become a referrer');
    await until(() => f.stops.length > 0); const before = f.stops[0];
    assert.equal(before.visibility, 'hidden', 'Old HTML must not flash while destination is pending');
    assert.equal(before.noticeVisibility, 'visible'); assert.equal(before.exit, expected);
    assert.notEqual(before.booted, true, 'The obsolete app must not continue booting'); intact(before.probe);
    f.release.resolve(); await p.waitForURL(expected); await p.waitForFunction(() => window.__appBooted === true); console.log('CANONICAL ready', expected);
    assert.equal(await p.locator('#app').isVisible(), true); intact(await p.evaluate(() => __storedProbe()));
    assert.equal(await p.evaluate(() => document.documentElement.style.visibility), '');
    if (history) { await p.goBack(); await p.waitForURL('https://previous.example/sentinel'); }
    assert.deepEqual(f.errors, []); results.push({ kind: 'retired navigation', start, expected, historyReplaced: history, passed: true });
  } finally { await f.close(); }
}

async function unchanged(browser, url) {
  console.log('START unchanged', url);
  const f = await fixture(browser), { page: p } = f;
  try {
    await p.goto(url); await p.waitForFunction(() => window.__appBooted === true);
    assert.equal(p.url(), url); assert.equal(await p.locator('#app').isVisible(), true);
    assert.equal(await p.evaluate(() => document.documentElement.style.visibility), '');
    assert.deepEqual(f.stops, [], 'Current hosts must not stop or navigate their document');
    intact(await p.evaluate(() => __storedProbe()));
    assert.equal(f.requests.some(request => new URL(request.url).hostname === 's-note.kr' && new URL(url).hostname !== 's-note.kr'), false);
    assert.deepEqual(f.errors, []); results.push({ kind: 'current/company/lookalike unchanged', url, passed: true });
  } finally { await f.close(); }
}

async function framed(browser, sameOrigin) {
  console.log('START framed', sameOrigin);
  const f = await fixture(browser, { hold: true, frame: sameOrigin ? 'same-origin' : 'external' }), { page: p } = f;
  const start = (sameOrigin ? 'https://zerocar-office.pages.dev' : 'https://company-zerocar.example') + '/old-open-app.html?month=2026-11#parent-fragment';
  try {
    await navigate(p, start); const request = await deadline(f.entered.promise);
    const expected = sameOrigin ? 'https://s-note.kr/old-open-app.html?month=2026-11#parent-fragment' : 'https://s-note.kr/monthly.html?child=1#child-fragment';
    assert.equal(request.url, expected.split('#')[0]); assert.equal(request.referer, undefined);
    assert.equal(p.url(), start); await until(() => f.stops.length > 0);
    const before = f.stops[0]; assert.equal(before.url, sameOrigin ? start : 'https://zerocar-office.pages.dev/monthly.html?child=1#child-fragment');
    assert.equal(before.visibility, 'hidden'); assert.equal(before.noticeVisibility, 'visible'); assert.equal(before.exit, expected); intact(before.probe, !sameOrigin);
    f.release.resolve();
    if (sameOrigin) { await p.waitForURL(expected); await p.waitForFunction(() => window.__appBooted === true); }
    else {
      await p.waitForFunction(() => document.querySelector('iframe')?.contentWindow !== null);
      await until(() => p.frames().some(frame => frame.url() === expected));
      assert.equal(p.url(), start); assert.equal(await p.locator('#old-app').isVisible(), true);
      const child = p.frames().find(frame => frame.url() === expected); await child.waitForFunction(() => window.__appBooted === true); intact(await child.evaluate(() => __storedProbe()), true);
    }
    assert.deepEqual(f.errors, []); results.push({ kind: sameOrigin ? 'same-origin stale parent moves as a whole' : 'external parent preserved; only retired child moves', passed: true });
  } finally { await f.close(); }
}

async function refusedTopNavigation(browser) {
  const f = await fixture(browser, { frame: 'restricted' }), { page: p } = f;
  const start = 'https://zerocar-office.pages.dev/old-open-app.html?month=2026-11#parent-fragment';
  try {
    await navigate(p, start); await until(() => f.stops.length > 0);
    await p.waitForFunction(() => !!document.getElementById('snote-service-location-exit'));
    assert.equal(p.url(), start); assert.equal(await p.locator('#snote-service-location-exit').isVisible(), true);
    assert.equal(await p.locator('#snote-service-location-exit').getAttribute('href'), 'https://s-note.kr/old-open-app.html?month=2026-11#parent-fragment');
    assert.equal(await p.locator('#existing-draft').inputValue(), '보존할 합성 입력');
    assert.equal(await p.locator('#old-app').count(), 1, 'Fallback must preserve the original DOM');
    intact(await p.evaluate(() => __storedProbe()));
    assert.equal(f.requests.some(request => new URL(request.url).hostname === 's-note.kr'), false);
    await p.screenshot({ path: path.join(OUT, 'restricted-navigation-exit.png') });
    await p.getByRole('link', { name: 'S-NOTE 열기', exact: true }).click();
    await p.waitForURL('https://s-note.kr/old-open-app.html?month=2026-11#parent-fragment');
    await p.waitForFunction(() => window.__appBooted === true);
    assert.deepEqual(f.errors, []); results.push({ kind: 'restricted iframe navigation preserves old draft and a visible official exit', passed: true });
  } finally { await f.close(); }
}

async function apiUnaffected(browser) {
  const f = await fixture(browser);
  try {
    const url = 'https://zerocar-office.pages.dev/api/synthetic'; await f.page.goto(url);
    assert.equal(f.page.url(), url); assert.match(await f.page.locator('body').innerText(), /"ok":true/);
    assert.equal(f.requests.some(request => request.url.includes('service-location.js') || new URL(request.url).hostname === 's-note.kr'), false);
    results.push({ kind: 'frontend guard is not a server/API redirect', passed: true });
  } finally { await f.close(); }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  try {
    await retired(browser, 'https://zerocar-office.pages.dev/', 'https://s-note.kr/', true);
    await retired(browser, 'https://abc123.zerocar-office.pages.dev/customer.html?mode=edit&car=1%2F2#synthetic-token-_%2F', 'https://s-note.kr/customer.html?mode=edit&car=1%2F2#synthetic-token-_%2F');
    await retired(browser, 'https://zerocar-office.synthetic-account.workers.dev/index.html?from=bookmark#panel', 'https://s-note.kr/index.html?from=bookmark#panel');
    await retired(browser, 'https://zerocar-office.pages.dev//evil.example/customer.html?next=https%3A%2F%2Fevil.example%2F#synthetic', 'https://s-note.kr//evil.example/customer.html?next=https%3A%2F%2Fevil.example%2F#synthetic');
    for (const url of ['https://s-note.kr/', 'https://www.s-note.kr/customer.html#synthetic', 'https://s-note.pages.dev/',
      'https://abc123.s-note.pages.dev/', 'http://localhost:8788/', 'http://127.0.0.1:8788/', 'https://zerocar.kr/',
      'https://company-zerocar.example/', 'https://notzerocar-office.pages.dev/', 'https://zerocar-office.pages.dev.evil.example/',
      'https://zerocar-office.synthetic-account.workers.dev.evil.example/', 'https://other.synthetic-account.workers.dev/']) await unchanged(browser, url);
    await framed(browser, true); await framed(browser, false); await refusedTopNavigation(browser); await apiUnaffected(browser);
    for (const result of results) console.log('PASS ' + result.kind + (result.start || result.url ? ': ' + (result.start || result.url) : ''));
  } finally {
    await browser.close(); fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ passed: results.length === 20, syntheticOnly: true, realNetworkRequests: 0, actualMessagesSent: 0, results }, null, 2) + '\n');
  }
  assert.equal(results.length, 20);
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
