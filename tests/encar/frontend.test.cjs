'use strict';

// Runs only the local frontend source in a minimal DOM. All network and popup
// effects are mocked; no remote scripts, real credentials, or HTTP are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../assets/snote-encar-link.js'), 'utf8');
const PREFIX = 'snote.encar.candidate.v1:';
const LOOKUP_LOGO_SRC = 'assets/encar-logo.png?v=2.33';
const PLATE = '12가3456';
const SECOND_PLATE = '34나5678';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function listing(id = '43000001', trustedId = '43000002') {
  return {
    id,
    model: '검증용 차량',
    sellerUrl: 'https://fem.encar.com/cars/detail/' + id,
    trustedId,
    trustedUrl: trustedId ? 'https://fem.encar.com/cars/detail/' + trustedId : null
  };
}

function found(plate = PLATE, listings = [listing()]) {
  return { status: 'found', plate, listings, verifiedAt: new Date().toISOString() };
}

function storedRecord(listings = [listing()], plate = PLATE) {
  return { version: 1, plate, verifiedAt: new Date().toISOString(), listings };
}

const plain = value => JSON.parse(JSON.stringify(value));

function assertLookupIcon(button, busy = false) {
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.type, 'button', 'The lookup must not submit an enclosing vehicle form');
  assert.equal(button.getAttribute('aria-label'), '엔카광고보기', 'The icon action needs its own accessible name');
  assert.equal(button.getAttribute('data-tooltip'), '엔카광고보기', 'The custom tooltip names the icon action');
  assert.equal(button.hasAttribute('title'), false, 'The custom tooltip must not compete with a native tooltip');
  if (busy) assert.equal(button.getAttribute('aria-busy'), 'true');
  else assert.ok([null, 'false'].includes(button.getAttribute('aria-busy')), 'A settled icon must no longer announce busy work');
  const icons = button.querySelectorAll('img');
  assert.equal(icons.length, 1, 'Lookup state changes must preserve exactly one logo image');
  assert.equal(icons[0].namespaceURI, 'http://www.w3.org/1999/xhtml');
  assert.equal(icons[0].getAttribute('src'), LOOKUP_LOGO_SRC, 'Every lookup state must keep the supplied PNG logo');
  assert.equal(icons[0].classList.contains('snote-encar-logo'), true);
  assert.equal(icons[0].getAttribute('alt'), '', 'The button names the action; the image is decorative');
  assert.equal(icons[0].getAttribute('aria-hidden'), 'true');
  assert.equal(icons[0].tabIndex, -1, 'Keyboard focus belongs to the button');
  assert.equal(button.querySelectorAll('svg').length, 0, 'The logo replaces the previous drawn icon');
  assert.equal([...button.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim(), '', 'The icon action must not acquire a visible text label during asynchronous work');
  return icons[0];
}

function fixture(t, options = {}) {
  const console = new VirtualConsole();
  const errors = [];
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div id="zc-cloud-gate" hidden></div><div id="zc86-topbar"></div>
    <button id="zc-cloud-status" hidden>클라우드 연결됨</button>
    <section id="vehicle-overlay" class="overlay open">
      <header><p id="vehicle-meta">원래 차량 정보</p>${options.headerActions ? '<div id="vehicle-header-actions" role="group" aria-label="차량 작업"><button id="original-action" type="button">견적서</button></div>' : ''}<button id="original-close">닫기</button></header>
      <div id="original-detail">원래 상세 본문</div>
    </section></body></html>`, {
    url: 'https://snote.test/',
    runScripts: 'outside-only',
    virtualConsole: console
  });
  const w = dom.window;
  const state = { ready: options.ready ?? true, canWrite: options.canWrite ?? true, storageScope: 'fixture-company' };
  const events = [], openCalls = [], tabs = [], requests = [], saveCalls = [];
  w.cars = plain(options.cars || [{ id: 'car-1', plate: PLATE }, { id: 'car-2', plate: SECOND_PLATE }]);
  if (options.savedRecord !== undefined) w.cars[0].encarLinks = plain(options.savedRecord);
  w.activeCarId = 'car-1';
  w.currentUser = { username: 'test-user' };
  const originalOpenVehicle = () => {};
  const originalCloseVehicle = () => {};
  w.openVehicle = originalOpenVehicle;
  w.closeVehicle = originalCloseVehicle;
  w.zc86Cloud = {
    get ready() { return state.ready; },
    getAccessToken() {
      events.push('token');
      return options.token ? options.token() : Promise.resolve('mock-session-token');
    }
  };
  if (options.bridge) {
    w.snoteEncarLinksBridge = {
      context(carId) {
        const car = w.cars.find(item => String(item.id) === carId);
        if (!state.ready || !w.currentUser || !car) return null;
        const plate = String(car.plate || '').normalize('NFKC').replace(/[\s-]/g, '');
        return { key: [state.storageScope, w.currentUser.username, carId, plate, car.ownerId || 'fixture-owner'].join(':'),
          carId, plate, canWrite: state.canWrite, companyId: state.storageScope, userId: w.currentUser.username };
      },
      save(base, record) {
        const target = w.cars.find(item => String(item.id) === base.carId);
        const call = { base: plain(base), record: plain(record) };
        const index = saveCalls.push(call) - 1;
        if (options.applyBeforeSave && target) target.encarLinks = plain(call.record);
        return Promise.resolve(options.save ? options.save(call.base, call.record, index) : { ok: true }).then(result => {
          if (result?.ok === true && options.applySaved !== false && target) target.encarLinks = plain(call.record);
          return result;
        });
      }
    };
  }
  if (options.requestTimeoutMs !== undefined) {
    const realSetTimeout = w.setTimeout.bind(w);
    w.setTimeout = (handler, delay, ...args) => realSetTimeout(
      handler, delay === 45000 ? options.requestTimeoutMs : delay, ...args
    );
  }
  w.open = (url, target, features) => {
    events.push('open');
    openCalls.push({ url, target, features });
    if (options.popupBlocked) return null;
    const tab = {
      document: w.document.implementation.createHTMLDocument(''),
      opener: w,
      closed: false,
      navigations: [],
      close() { this.closed = true; },
      location: { replace(url) { tab.navigations.push(url); events.push('navigate'); } }
    };
    tabs.push(tab);
    return tab;
  };
  w.fetch = (url, init) => {
    assert.equal(url, '/api/encar', 'Only the mocked same-origin resolver may be called');
    events.push('fetch');
    const pending = deferred();
    const request = { url, init, pending, aborted: false };
    requests.push(request);
    const abort = () => {
      request.aborted = true;
      if (!options.ignoreAbort) pending.reject(new w.DOMException('Aborted', 'AbortError'));
    };
    if (init.signal.aborted) abort();
    else init.signal.addEventListener('abort', abort, { once: true });
    return pending.promise;
  };

  w.eval(SOURCE);
  if (!w.SnoteEncarLink) w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const button = w.document.querySelector('.snote-encar-button');
  assert.ok(button, 'The additive toolbar must mount');
  t.after(() => { w.close(); assert.equal(errors.length, 0, 'No unhandled DOM errors'); });

  return {
    w, state, events, openCalls, tabs, requests, saveCalls, button,
    originalOpenVehicle, originalCloseVehicle,
    get note() { return w.document.querySelector('.snote-encar-note'); },
    get links() { return [...w.document.querySelectorAll('.snote-encar-results a')]; },
    get manual() { return w.document.querySelector('.snote-encar-manual'); },
    get manualInput() { return w.document.getElementById('snote-encar-manual-url'); },
    get copyButton() { return w.document.querySelector('.snote-encar-copy'); },
    get copyFallback() { return w.document.querySelector('.snote-encar-copy-fallback'); },
    get copyStatus() { return w.document.querySelector('.snote-encar-copy-status'); },
    get saveStatus() { return w.document.querySelector('.snote-encar-save-status'); },
    get saveRetry() { return w.document.querySelector('.snote-encar-save-retry'); },
    closeDetail() { w.document.getElementById('vehicle-overlay').classList.remove('open'); },
    reopenDetail() { w.document.getElementById('vehicle-overlay').classList.add('open'); },
    click() { button.click(); },
    submitAddress(value) { this.manual.open = true; this.manualInput.value = value; this.manual.querySelector('button').click(); },
    reply(index, body, opts = {}) {
      const status = opts.status ?? 200;
      requests[index].pending.resolve({
        status,
        ok: status >= 200 && status < 300,
        headers: { get(name) { return name.toLowerCase() === 'content-type' ? (opts.contentType ?? 'application/json') : null; } },
        json: () => opts.jsonPromise || Promise.resolve(body)
      });
    }
  };
}

test('01 additive mount preserves existing UI/functions and duplicate loads are idempotent', t => {
  const f = fixture(t);
  assert.equal(f.w.document.getElementById('vehicle-meta').textContent, '원래 차량 정보');
  assert.equal(f.w.document.getElementById('original-detail').textContent, '원래 상세 본문');
  assert.equal(f.w.document.getElementById('original-close').textContent, '닫기');
  assert.equal(f.w.openVehicle, f.originalOpenVehicle);
  assert.equal(f.w.closeVehicle, f.originalCloseVehicle);
  f.w.eval(SOURCE);
  assert.equal(f.w.document.querySelectorAll('.snote-encar-tools').length, 1);
  assert.equal(f.button.disabled, false);
  assertLookupIcon(f.button);
});

test('02 popup is synchronous, and navigation occurs only after server verification', async t => {
  const token = deferred();
  const f = fixture(t, { token: () => token.promise });
  f.click();
  assertLookupIcon(f.button, true);
  assert.deepEqual(f.events, ['open', 'token']);
  assert.equal(f.tabs[0].opener, null);
  assert.equal(f.tabs[0].document.title, '엔카 광고 확인 중');
  assert.equal(f.requests.length, 0);
  assert.equal(f.tabs[0].navigations.length, 0);
  token.resolve('mock-session-token');
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].init.headers.Authorization, 'Bearer mock-session-token');
  assert.deepEqual(JSON.parse(f.requests[0].init.body), { plate: PLATE, candidateIds: [] });
  assert.equal(f.tabs[0].navigations.length, 0);
  f.reply(0, found());
  await settle();
  assert.deepEqual(f.tabs[0].navigations, [listing().sellerUrl]);
  assert.equal(f.links.length, 2);
  assert.equal(f.button.disabled, false);
  const saved = JSON.parse(f.w.localStorage.getItem(PREFIX + PLATE));
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'ids', 'plate']);
  assert.deepEqual(saved.ids, ['43000001']);
  assert.equal(JSON.stringify(saved).includes('https://'), false);
});

test('03 wrong response plate is rejected without navigation or saved candidates', async t => {
  const f = fixture(t);
  f.click(); await settle();
  f.reply(0, found(SECOND_PLATE)); await settle();
  assert.equal(f.tabs[0].closed, true);
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 0);
  assert.equal(f.note.dataset.error, 'true');
  assert.equal(f.w.localStorage.getItem(PREFIX + PLATE), null);
});

test('04 malformed responses remain errors, never an unverified negative result', async t => {
  const cases = [
    ['unknown status', { ...found(), status: 'upstream_failure', listings: [] }],
    ['empty found', { ...found(), listings: [] }],
    ['multiple with one item', { ...found(), status: 'multiple' }],
    ['found with two items', found(PLATE, [listing(), listing('43000003', '43000004')])],
    ['unverified with item', { ...found(), status: 'unverified' }],
    ['invalid timestamp', { ...found(), verifiedAt: 'invalid-date' }],
    ['foreign URL', found(PLATE, [{ ...listing(), sellerUrl: 'https://evil.test/43000001' }])],
    ['URL and ID disagree', found(PLATE, [{ ...listing(), id: '43000003' }])],
    ['non-array listings', { ...found(), listings: null }]
  ];
  for (const [name, body] of cases) {
    await t.test(name, async sub => {
      const f = fixture(sub);
      f.w.localStorage.setItem(PREFIX + PLATE, JSON.stringify({ plate: PLATE, ids: ['43000001'], at: Date.now() }));
      f.click(); await settle(); f.reply(0, body); await settle();
      assert.equal(f.tabs[0].closed, true);
      assert.deepEqual(f.tabs[0].navigations, []);
      assert.equal(f.links.length, 0);
      assert.equal(f.note.dataset.error, 'true');
      assert.ok(f.w.localStorage.getItem(PREFIX + PLATE), 'An invalid response must not erase the candidate as if not found');
    });
  }
});

test('05 multiple verified originals show choices without automatically opening one', async t => {
  const f = fixture(t);
  f.click(); await settle();
  const first = { ...listing(), model: '<img src=x onerror=alert(1)>' };
  f.reply(0, { ...found(PLATE, [first, listing('43000003', null)]), status: 'multiple' });
  await settle();
  assert.equal(f.tabs[0].closed, true);
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 3);
  assert.equal(f.w.document.querySelector('.snote-encar-results img'), null);
  for (const anchor of f.links) {
    assert.equal(anchor.target, '_blank');
    assert.equal(anchor.rel, 'noopener noreferrer');
  }
});

test('06 popup blocking falls back to verified links', async t => {
  const f = fixture(t, { popupBlocked: true });
  f.click(); await settle(); f.reply(0, found()); await settle();
  assert.equal(f.openCalls.length, 1);
  assert.equal(f.tabs.length, 0);
  assert.equal(f.links.length, 2);
  assert.match(f.note.textContent, /링크/);
  assert.equal(f.button.disabled, false);
});

test('07 changing vehicles cancels the old request and ignores its late reply', async t => {
  const f = fixture(t, { ignoreAbort: true });
  f.click(); await settle();
  f.w.activeCarId = 'car-2';
  f.w.document.getElementById('vehicle-meta').textContent = SECOND_PLATE;
  await settle();
  assert.equal(f.requests[0].aborted, true);
  assert.equal(f.tabs[0].closed, true);
  f.reply(0, found()); await settle();
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 0);
  assert.equal(f.w.localStorage.getItem(PREFIX + PLATE), null);
  f.click(); await settle();
  assert.equal(JSON.parse(f.requests[1].init.body).plate, SECOND_PLATE);
  f.reply(1, found(SECOND_PLATE, [listing('43000003', '43000004')])); await settle();
  assert.deepEqual(f.tabs[1].navigations, ['https://fem.encar.com/cars/detail/43000003']);
});

test('08 ready=false alone blocks a late response before currentUser is cleared', async t => {
  const f = fixture(t);
  f.click(); await settle();
  f.state.ready = false;
  f.reply(0, found()); await settle();
  assert.equal(f.tabs[0].closed, true);
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 0);
  assert.equal(f.button.disabled, true);
});

test('09 logout gate changes cancel pending work and a late response cannot restore results', async t => {
  const f = fixture(t, { ignoreAbort: true });
  f.click(); await settle();
  f.state.ready = false;
  f.w.currentUser = null;
  f.w.cars = [];
  f.w.document.getElementById('zc-cloud-gate').hidden = false;
  await settle();
  assert.equal(f.requests[0].aborted, true);
  assert.equal(f.tabs[0].closed, true);
  assert.equal(f.button.disabled, true);
  f.reply(0, found()); await settle();
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 0);
});

test('10 actor changes clear completed results even when vehicle ID and plate are unchanged', async t => {
  const f = fixture(t, { popupBlocked: true });
  f.click(); await settle(); f.reply(0, found()); await settle();
  assert.equal(f.links.length, 2);
  f.w.currentUser = { username: 'another-test-user' };
  f.w.document.getElementById('zc86-topbar').hidden = true;
  await settle();
  assert.equal(f.links.length, 0);
  assert.equal(f.note.textContent, '');
  assert.equal(f.button.disabled, false);
});

test('11 cached IDs are only candidates and are always revalidated before opening', async t => {
  const f = fixture(t);
  f.w.localStorage.setItem(PREFIX + PLATE, JSON.stringify({
    plate: PLATE, ids: ['43000001', '43000001', 'https://evil.test/', 'bad'], at: Date.now()
  }));
  f.click(); await settle();
  assert.deepEqual(JSON.parse(f.requests[0].init.body).candidateIds, ['43000001']);
  assert.deepEqual(f.tabs[0].navigations, []);
  f.reply(0, { status: 'unverified', plate: PLATE, listings: [] }); await settle();
  assert.equal(f.tabs[0].closed, true);
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 0);
  assert.equal(f.w.localStorage.getItem(PREFIX + PLATE), null);
  assert.equal(f.note.dataset.error, 'false');
});

test('12 a token promise that never settles times out, closes the popup, and restores the button', async t => {
  const token = deferred();
  const f = fixture(t, { token: () => token.promise, requestTimeoutMs: 20 });
  f.click();
  await pause(50); await settle();
  assert.equal(f.requests.length, 0);
  assert.equal(f.tabs[0].closed, true);
  assert.equal(f.button.disabled, false);
  assert.equal(f.note.dataset.error, 'true');
  assert.match(f.note.textContent, /지연/);
  token.resolve('late-mock-session-token'); await settle();
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.tabs[0].navigations, []);
});

test('13 pagehide resets pending work and bfcache pageshow restores a usable button', async t => {
  const f = fixture(t, { ignoreAbort: true });
  const logo = assertLookupIcon(f.button);
  f.click(); await settle();
  assert.equal(assertLookupIcon(f.button, true), logo);
  f.w.dispatchEvent(new f.w.PageTransitionEvent('pagehide', { persisted: true }));
  await settle();
  assert.equal(f.requests[0].aborted, true);
  assert.equal(f.tabs[0].closed, true);
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.getAttribute('aria-label'), '엔카광고보기');
  assert.equal(assertLookupIcon(f.button), logo);
  f.w.dispatchEvent(new f.w.PageTransitionEvent('pageshow', { persisted: true }));
  await settle();
  assert.equal(f.button.disabled, false);
  assert.equal(assertLookupIcon(f.button), logo);
  f.reply(0, found()); await settle();
  assert.deepEqual(f.tabs[0].navigations, []);
  f.click(); await settle();
  assert.equal(assertLookupIcon(f.button, true), logo);
  f.reply(1, found()); await settle();
  assert.deepEqual(f.tabs[1].navigations, [listing().sellerUrl]);
  assert.equal(assertLookupIcon(f.button), logo);
});

test('14 context is checked again after a delayed JSON body is decoded', async t => {
  const body = deferred();
  const f = fixture(t, { ignoreAbort: true });
  f.click(); await settle();
  f.reply(0, null, { jsonPromise: body.promise }); await settle();
  assert.deepEqual(f.tabs[0].navigations, []);
  f.w.activeCarId = 'car-2';
  f.w.document.getElementById('vehicle-meta').textContent = SECOND_PLATE;
  await settle(); body.resolve(found()); await settle();
  assert.equal(f.tabs[0].closed, true);
  assert.deepEqual(f.tabs[0].navigations, []);
  assert.equal(f.links.length, 0);
});

test('15 invalid input never creates a popup or sends a resolver request', async t => {
  const f = fixture(t);
  f.w.cars[0].plate = 'invalid-plate';
  f.w.document.getElementById('vehicle-meta').textContent = 'invalid-plate';
  await settle(); f.click(); await settle();
  assert.equal(f.openCalls.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.note.dataset.error, 'true');
});

test('16 frontend IDs and cached candidates follow the server one-to-twelve-digit contract', async t => {
  const valid = ['1', '12345678901', '999999999999'];
  for (const id of valid) {
    const f = fixture(t);
    f.w.localStorage.setItem(PREFIX + PLATE, JSON.stringify({
      plate: PLATE, at: Date.now(), ids: [...valid, '01234567', '0', '1.5', '1000000000000']
    }));
    f.click(); await settle();
    assert.deepEqual(JSON.parse(f.requests[0].init.body).candidateIds, valid);
    f.reply(0, found(PLATE, [listing(id, null)])); await settle();
    assert.deepEqual(f.tabs[0].navigations, [listing(id, null).sellerUrl]);
    assert.equal(f.note.dataset.error, 'false');
    assert.ok(JSON.parse(f.w.localStorage.getItem(PREFIX + PLATE)).ids.includes(id));
  }
  const invalid = fixture(t);
  invalid.click(); await settle();
  invalid.reply(0, found(PLATE, [listing('01234567', null)])); await settle();
  assert.deepEqual(invalid.tabs[0].navigations, []);
  assert.equal(invalid.note.dataset.error, 'true');
});

test('17 cloud reload status restores a ready button without replacing the open vehicle', async t => {
  const f = fixture(t);
  f.state.ready = false;
  f.w.document.getElementById('vehicle-meta').textContent = '차량 자료 새로고침 중';
  await settle();
  assert.equal(f.button.disabled, true);
  f.state.ready = true;
  f.w.document.getElementById('zc-cloud-status').textContent = '서버 자료 다시 불러옴';
  await settle();
  assert.equal(f.button.disabled, false);
  f.click(); await settle();
  f.reply(0, found()); await settle();
  assert.deepEqual(f.tabs[0].navigations, [listing().sellerUrl]);
});

test('18 timeout closes the waiting tab even if fetch or JSON ignores abort, and late data cannot open it', async t => {
  for (const phase of ['fetch', 'json']) {
    const body = deferred();
    const f = fixture(t, { ignoreAbort: true, requestTimeoutMs: 20 });
    f.click(); await settle();
    if (phase === 'json') { f.reply(0, null, { jsonPromise: body.promise }); await settle(); }
    await pause(50); await settle();
    assert.equal(f.tabs[0].closed, true, phase + ' must close the tab at the deadline');
    assert.equal(f.button.disabled, false);
    assert.equal(f.note.dataset.error, 'true');
    assert.match(f.note.textContent, /지연/);
    if (phase === 'json') body.resolve(found());
    else f.reply(0, found());
    await settle();
    assert.deepEqual(f.tabs[0].navigations, []);
    assert.equal(f.links.length, 0);
  }
});

const REQUEST_ID = '12345678-1234-4234-8234-123456789abc';
const unverified = diagnostics => ({ plate: PLATE, verifiedAt: null, listings: [], status: 'unverified', ...(diagnostics ? { diagnostics } : {}) });
async function showUnverified(f, diagnostics) { f.click(); await settle(); f.reply(0, unverified(diagnostics)); await settle(); }

test('19 old unverified responses retain the exact note, with an optional closed address verifier and minimal safe copy', async t => {
  const f = fixture(t); await showUnverified(f);
  assert.equal(f.note.textContent, '일치하는 현재 광고를 확인하지 못했습니다. 나중에 다시 확인해 주세요.');
  assert.equal(f.manual.hidden, false); assert.equal(f.manual.open, false);
  assert.equal(f.copyButton.hidden, false); assert.equal(f.links.length, 0);
  f.copyButton.click(); await settle();
  assert.deepEqual(JSON.parse(f.copyFallback.value), { service: 'snote-encar', code: 'UNVERIFIED', httpStatus: 200 });
  assert.equal(f.copyFallback.readOnly, true); assert.equal(f.copyFallback.hidden, false);
  assert.equal(f.w.document.activeElement, f.copyFallback); assert.equal(f.copyFallback.selectionStart, 0); assert.equal(f.copyFallback.selectionEnd, f.copyFallback.value.length);
});

test('20 unverified diagnostic reasons have distinct honest notes without raw server text', async t => {
  const messages = [];
  for (const code of ['SEARCH_NO_RESULTS', 'SEARCH_NO_CANDIDATES', 'PLATE_MISMATCH', 'AD_INACTIVE', 'DETAIL_NOT_FOUND', 'CATALOG_NO_MATCH', 'NO_VERIFIED_LISTING']) {
    await t.test(code, async sub => {
      const f = fixture(sub); await showUnverified(f, { code, requestId: REQUEST_ID, message: 'UNTRUSTED_PRIVATE_MESSAGE' });
      messages.push(f.note.textContent); assert.doesNotMatch(f.note.textContent, /UNTRUSTED|판매\s*완료|매물.*없/);
      assert.equal(f.manual.hidden, false); assert.equal(f.manual.open, false); assert.equal(f.note.dataset.error, 'false');
      assert.equal(f.tabs[0].closed, true); assert.deepEqual(f.tabs[0].navigations, []);
    });
  }
  assert.equal(new Set(messages).size, 7);
});

test('21 service diagnostic error codes distinguish setup, search, detail and timeout while unknown/old replies keep HTTP fallbacks', async t => {
  const messages = [];
  for (const code of ['SEARCH_NOT_CONFIGURED', 'SUPABASE_NOT_CONFIGURED', 'SEARCH_AUTH_FAILED', 'SEARCH_RATE_LIMITED', 'SEARCH_QUOTA_EXCEEDED', 'SEARCH_UNAVAILABLE', 'DETAIL_BLOCKED', 'DETAIL_PARSE_FAILED', 'DETAIL_UNAVAILABLE', 'AD_STATUS_UNKNOWN', 'CATALOG_BLOCKED', 'CATALOG_UNAVAILABLE', 'CATALOG_FORM_UNSUPPORTED', 'CATALOG_PARSE_FAILED', 'CATALOG_INCOMPLETE', 'CATALOG_CONFIG_INVALID', 'CATALOG_PARSER_UNAVAILABLE', 'CATALOG_LIMIT_EXCEEDED', 'UPSTREAM_TIMEOUT', 'DEADLINE_EXCEEDED']) {
    await t.test(code, async sub => {
      const f = fixture(sub); f.click(); await settle(); f.reply(0, { status: 'error', diagnostics: { code, requestId: REQUEST_ID, message: 'UNTRUSTED_PRIVATE_MESSAGE' } }, { status: 502 }); await settle();
      messages.push(f.note.textContent); assert.doesNotMatch(f.note.textContent, /UNTRUSTED/); assert.equal(f.note.dataset.error, 'true');
      assert.equal(f.manual.hidden, !code.startsWith('CATALOG_')); assert.equal(f.manual.open, false); assert.equal(f.copyButton.hidden, false); assert.equal(f.tabs[0].closed, true);
      assert.equal(f.links.length, 0); assert.deepEqual(f.tabs[0].navigations, []);
    });
  }
  assert.equal(new Set(messages).size, 20);
  const f = fixture(t); f.click(); await settle(); f.reply(0, { status: 'error', diagnostics: { code: 'UNKNOWN_PRIVATE_CODE' } }, { status: 503 }); await settle();
  assert.equal(f.note.textContent, '엔카 조회 기능의 서버 설정이 필요합니다. 관리자에게 문의해 주세요.');
});

test('22 a manual URL supplies only its explicit ID and cannot navigate until the server verifies the original seller', async t => {
  const f = fixture(t); await showUnverified(f, { code: 'SEARCH_NO_RESULTS' });
  f.w.localStorage.setItem(PREFIX + PLATE, JSON.stringify({ plate: PLATE, at: Date.now(), ids: ['43000005'] }));
  f.submitAddress('https://fem.encar.com/cars/detail/43000002?shared=yes'); await settle();
  assert.deepEqual(JSON.parse(f.requests[1].init.body), { plate: PLATE, candidateIds: ['43000002'] });
  assert.deepEqual(f.tabs[1].navigations, []); assert.equal(f.links.length, 0); assert.equal(f.manualInput.value, '');
  f.reply(1, found()); await settle();
  assert.deepEqual(f.tabs[1].navigations, [listing().sellerUrl]); assert.notEqual(f.tabs[1].navigations[0], 'https://fem.encar.com/cars/detail/43000002');
  assert.equal(f.manual.hidden, true); assert.equal(f.copyButton.hidden, true);
});

test('catalogue discovery failure leaves the independent manual verifier available without bypassing validation', async t => {
  const f = fixture(t); f.click(); await settle();
  f.reply(0, { status: 'error', diagnostics: { code: 'CATALOG_FORM_UNSUPPORTED' } }, { status: 502 }); await settle();
  assert.equal(f.manual.hidden, false); assert.equal(f.manual.open, false);
  assert.equal(f.tabs[0].closed, true); assert.equal(f.links.length, 0);
  f.submitAddress('https://fem.encar.com/cars/detail/43000001'); await settle();
  assert.deepEqual(JSON.parse(f.requests[1].init.body), { plate: PLATE, candidateIds: ['43000001'] });
  assert.deepEqual(f.tabs[1].navigations, []);
  f.reply(1, found()); await settle();
  assert.deepEqual(f.tabs[1].navigations, [listing().sellerUrl]);
});

test('23 supported HTTPS desktop/mobile addresses are ID hints only', async t => {
  for (const address of ['https://fem.encar.com/cars/detail/43000001/', 'https://www.encar.com/dc/dc_cardetailview.do?carid=43000001', 'https://encar.com/dc/dc_cardetailview.do?CarId=43000001', 'https://m.encar.com/ca/carsearch/car_detailview.do?carid=43000001']) {
    await t.test(address, async sub => {
      const f = fixture(sub); await showUnverified(f); f.w.localStorage.setItem(PREFIX + PLATE, JSON.stringify({ plate: PLATE, at: Date.now(), ids: ['43000005'] })); f.submitAddress(address); await settle();
      assert.deepEqual(JSON.parse(f.requests[1].init.body), { plate: PLATE, candidateIds: ['43000001'] }); assert.deepEqual(f.tabs[1].navigations, []);
      f.reply(1, unverified({ code: 'PLATE_MISMATCH' })); await settle(); assert.equal(f.tabs[1].closed, true); assert.deepEqual(f.tabs[1].navigations, []); assert.equal(f.links.length, 0); assert.deepEqual(JSON.parse(f.w.localStorage.getItem(PREFIX + PLATE)).ids, ['43000005'], 'An unrelated manual candidate must not erase other cached candidates');
    });
  }
});

test('24 invalid, foreign and ambiguous addresses never create a popup or API request', async t => {
  const f = fixture(t); await showUnverified(f);
  for (const address of ['javascript:alert(1)', 'http://fem.encar.com/cars/detail/43000001', 'https://fem.encar.com.evil.example/cars/detail/43000001', 'https://evil.example/?carid=43000001', 'https://user:pass@fem.encar.com/cars/detail/43000001', 'https://fem.encar.com:444/cars/detail/43000001', 'https://fem.encar.com/cars/detail/0', 'https://fem.encar.com/cars/detail/043000001', 'https://www.encar.com/other?carid=43000001', 'https://m.encar.com/detail?carid=43000001&carid=43000002', 'https://fem.encar.com/cars/detail/'+ '1'.repeat(2050)]) {
    f.submitAddress(address); await settle(); assert.equal(f.openCalls.length, 1, address); assert.equal(f.requests.length, 1, address); assert.match(f.manual.querySelector('.snote-encar-manual-error').textContent, /HTTPS 주소/);
  }
});

test('25 manual verification and previous diagnostics are cleared on a car change, even when late JSON ignores abort', async t => {
  const f = fixture(t, { ignoreAbort: true }); await showUnverified(f, { code: 'SEARCH_NO_RESULTS', requestId: REQUEST_ID });
  f.copyButton.click(); await settle(); assert.equal(f.copyFallback.hidden, false);
  f.submitAddress('https://fem.encar.com/cars/detail/43000001'); await settle();
  const decoded = deferred(); f.reply(1, null, { jsonPromise: decoded.promise }); await settle();
  f.w.activeCarId = 'car-2'; f.w.document.getElementById('vehicle-meta').textContent = SECOND_PLATE; await settle();
  decoded.resolve(found()); await settle();
  assert.equal(f.tabs[1].closed, true); assert.deepEqual(f.tabs[1].navigations, []); assert.equal(f.links.length, 0);
  assert.equal(f.manual.hidden, true); assert.equal(f.manual.open, false); assert.equal(f.manualInput.value, '');
  assert.equal(f.copyButton.hidden, true); assert.equal(f.copyFallback.hidden, true); assert.equal(f.copyFallback.value, ''); assert.equal(f.note.textContent, '');
});

test('26 diagnostic copy whitelists bounded numeric counters, UUID and known code, omitting all vehicle/auth/URL/raw fields', async t => {
  const f = fixture(t), writes = [];
  Object.defineProperty(f.w.navigator, 'clipboard', { value: { writeText: async text => writes.push(text) } });
  await showUnverified(f, { code: 'SEARCH_NO_RESULTS', requestId: REQUEST_ID, searchCount: 3, resultCount: Number.MAX_SAFE_INTEGER, candidateCount: '12', checkedCount: 1001, plateMatchedCount: 2, resultPlateMatchCount: 3, rawResultCount: 5, recognizedSourceCount: 1,
    plate: PLATE, id: '43000001', url: listing().sellerUrl, apiKey: 'PRIVATE_API_KEY', token: 'PRIVATE_TOKEN', message: 'PRIVATE_MESSAGE',
    source: 'PRIVATE_SOURCE', host: 'PRIVATE_HOST', title: 'PRIVATE_TITLE', text: 'PRIVATE_TEXT', raw_content: 'PRIVATE_RAW', body: 'PRIVATE_BODY',
    rejected: { plateMismatch: 2, notAdvertising: -1, notFound: 4, private: 'PRIVATE_VALUE' } });
  f.copyButton.click(); await settle(); assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), { service: 'snote-encar', code: 'SEARCH_NO_RESULTS', httpStatus: 200, requestId: REQUEST_ID, searchCount: 3, plateMatchedCount: 2, resultPlateMatchCount: 3, rawResultCount: 5, recognizedSourceCount: 1, rejected: { plateMismatch: 2, notFound: 4 } });
  assert.doesNotMatch(writes[0], /PRIVATE|12가3456|43000001|https:|Bearer|apiKey|token/); assert(writes[0].length < 600);
  assert.equal(f.copyFallback.hidden, true); assert.match(f.copyStatus.textContent, /복사했습니다/);
  const invalid = fixture(t); await showUnverified(invalid, { code: 'PRIVATE_TOKEN', requestId: REQUEST_ID+PLATE, searchCount: -1 }); invalid.copyButton.click(); await settle();
  assert.deepEqual(JSON.parse(invalid.copyFallback.value), { service: 'snote-encar', code: 'UNVERIFIED', httpStatus: 200 });
});

test('27 a rejected/late clipboard operation cannot restore diagnostic text after logout', async t => {
  const f = fixture(t), copied = deferred();
  Object.defineProperty(f.w.navigator, 'clipboard', { value: { writeText: () => copied.promise } });
  await showUnverified(f, { code: 'SEARCH_NO_RESULTS', requestId: REQUEST_ID }); f.copyButton.click(); await settle();
  f.state.ready = false; f.w.currentUser = null; f.w.document.getElementById('zc-cloud-gate').hidden = false; await settle(); copied.reject(Error('PRIVATE_CLIPBOARD_ERROR')); await settle();
  assert.equal(f.copyButton.hidden, true); assert.equal(f.copyFallback.hidden, true); assert.equal(f.copyFallback.value, ''); assert.equal(f.copyStatus.textContent, ''); assert.equal(f.manualInput.value, '');
});

test('28 unavailable popups and native token errors never expose raw exceptions', async t => {
  const blocked = fixture(t); blocked.w.open = () => { throw Error('PRIVATE_POPUP_ERROR'); }; blocked.click(); await settle(); blocked.reply(0, found()); await settle();
  assert.equal(blocked.links.length, 2); assert.match(blocked.note.textContent, /링크/); assert.doesNotMatch(blocked.note.textContent, /PRIVATE/);
  const failed = fixture(t, { token: () => Promise.reject(Error('PRIVATE_TOKEN_ERROR')) }); failed.click(); await settle();
  assert.equal(failed.requests.length, 0); assert.equal(failed.tabs[0].closed, true); assert.doesNotMatch(failed.note.textContent, /PRIVATE/); failed.copyButton.click(); await settle();
  assert.equal(JSON.parse(failed.copyFallback.value).code, 'NETWORK_ERROR');
  const expired = fixture(t, { token: () => Promise.resolve(null) }); expired.click(); await settle(); expired.copyButton.click(); await settle();
  assert.equal(expired.requests.length, 0); assert.equal(JSON.parse(expired.copyFallback.value).code, 'AUTH_REQUIRED');
});

test('29 an unknown advertisement state is an error, never a sold/inactive claim or direct navigation', async t => {
  const f = fixture(t); f.click(); await settle();
  f.reply(0, { ...found(), status: 'error', diagnostics: { code: 'AD_STATUS_UNKNOWN', requestId: REQUEST_ID, plateMatchedCount: 1, advertisementStatus: 'PRIVATE_RAW_STATUS', plate: PLATE, id: '43000001', url: listing().sellerUrl } }, { status: 502 }); await settle();
  assert.equal(f.note.textContent, '광고 상태를 확인하지 못했습니다. 진단 정보를 복사해 관리자에게 전달해 주세요.');
  assert.doesNotMatch(f.note.textContent, /종료|판매\s*완료|판매\s*중단|매물.*없/);
  assert.equal(f.note.dataset.error, 'true'); assert.equal(f.tabs[0].closed, true); assert.deepEqual(f.tabs[0].navigations, []); assert.equal(f.links.length, 0);
  f.copyButton.click(); await settle();
  assert.deepEqual(JSON.parse(f.copyFallback.value), { service: 'snote-encar', code: 'AD_STATUS_UNKNOWN', httpStatus: 502, requestId: REQUEST_ID, plateMatchedCount: 1 });
  assert.doesNotMatch(f.copyFallback.value, /PRIVATE|12가3456|43000001|https:|advertisementStatus/);
});

test('30 optional matched-plate, search-stage and public-catalog counts copy only whole numbers in the existing bounds', async t => {
  const keys = ['plateMatchedCount', 'resultPlateMatchCount', 'rawResultCount', 'recognizedSourceCount', 'catalogRequestCount', 'catalogPageCount', 'catalogRecordCount', 'catalogExactMatchCount', 'catalogFormCount', 'catalogPlateFieldCount', 'catalogLinkCount'];
  for (const count of [0, 1000, -1, 1.25, 1001, '1', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = fixture(t); await showUnverified(f, { code: 'NO_VERIFIED_LISTING', ...Object.fromEntries(keys.map(key => [key, count])) }); f.copyButton.click(); await settle();
    const copied = JSON.parse(f.copyFallback.value);
    for (const key of keys) {
      if (count === 0 || count === 1000) assert.equal(copied[key], count);
      else assert.equal(Object.hasOwn(copied, key), false);
    }
    assert.deepEqual(Object.keys(copied).filter(key => !keys.includes(key)), ['service', 'code', 'httpStatus']);
  }
});

test('31 incomplete public-catalog verification never opens partial listings and copies only safe catalog counters', async t => {
  const f = fixture(t); f.click(); await settle();
  const counters = { catalogRequestCount: 2, catalogPageCount: 1, catalogRecordCount: 4, catalogExactMatchCount: 1, catalogFormCount: 1, catalogPlateFieldCount: 1, catalogLinkCount: 1 };
  f.reply(0, { ...found(), status: 'error', diagnostics: { code: 'CATALOG_INCOMPLETE', requestId: REQUEST_ID, ...counters, source: 'PRIVATE_SOURCE', host: 'PRIVATE_HOST', title: 'PRIVATE_TITLE', text: 'PRIVATE_TEXT', raw_content: 'PRIVATE_RAW', body: 'PRIVATE_BODY', plate: PLATE, id: '43000001', url: listing().sellerUrl, token: 'PRIVATE_TOKEN' } }, { status: 502 }); await settle();
  assert.equal(f.note.textContent, '공개 차량 목록의 일부 조회를 마치지 못했습니다. 잠시 후 다시 확인해 주세요.');
  assert.doesNotMatch(f.note.textContent, /PRIVATE|판매\s*완료|매물.*없/); assert.equal(f.tabs[0].closed, true); assert.deepEqual(f.tabs[0].navigations, []); assert.equal(f.links.length, 0);
  f.copyButton.click(); await settle();
  assert.deepEqual(JSON.parse(f.copyFallback.value), { service: 'snote-encar', code: 'CATALOG_INCOMPLETE', httpStatus: 502, requestId: REQUEST_ID, ...counters });
  assert.doesNotMatch(f.copyFallback.value, /PRIVATE|12가3456|43000001|https:|token|raw_content/); assert(f.copyFallback.value.length < 600);
});

test('32 successful verification saves only the bounded canonical record and reports success after the server ACK', async t => {
  const saved = deferred(), f = fixture(t, { bridge: true, save: () => saved.promise });
  const result = found(PLATE, [{ ...listing(), mileage: 12345, private: 'PRIVATE_RESPONSE', token: 'PRIVATE_TOKEN' }]);
  f.click(); await settle(); f.reply(0, result); await settle();
  assert.equal(f.saveCalls.length, 1);
  assert.match(f.saveStatus.textContent, /저장 중/); assert.doesNotMatch(f.saveStatus.textContent, /저장했습니다/);
  assert.equal(f.saveRetry.hidden, true); assert.deepEqual(f.tabs[0].navigations, [listing().sellerUrl]);
  const call = f.saveCalls[0];
  assert.equal(call.base.carId, 'car-1'); assert.equal(call.base.plate, PLATE); assert.equal(call.base.canWrite, true);
  assert.deepEqual(Object.keys(call.record).sort(), ['listings', 'plate', 'verifiedAt', 'version']);
  assert.deepEqual(call.record, { version: 1, plate: PLATE, verifiedAt: result.verifiedAt, listings: [listing()] });
  assert.doesNotMatch(JSON.stringify(call.record), /PRIVATE|token|mileage/);
  saved.resolve({ ok: true }); await settle();
  assert.equal(f.saveStatus.textContent, '광고 링크를 서버에 저장했습니다.');
  assert.equal(f.saveRetry.hidden, true); assert.deepEqual(plain(f.w.cars[0].encarLinks), call.record);
});

test('33 failed or unconfirmed storage retains verified links and retries only the save', async t => {
  for (const failure of ['reject', 'unconfirmed']) await t.test(failure, async sub => {
    const f = fixture(sub, { bridge: true, save: (_base, _record, index) => index ? { ok: true } : failure === 'reject' ? Promise.reject(Error('PRIVATE_DB_ERROR')) : { ok: false } });
    f.click(); await settle(); f.reply(0, found()); await settle();
    assert.equal(f.saveCalls.length, 1); assert.equal(f.saveRetry.hidden, false);
    assert.match(f.saveStatus.textContent, /저장을 확인하지 못/); assert.doesNotMatch(f.saveStatus.textContent, /PRIVATE|저장했습니다/);
    assert.equal(f.links.length, 2); assert.deepEqual(f.tabs[0].navigations, [listing().sellerUrl]);
    f.saveRetry.click(); await settle();
    assert.equal(f.saveCalls.length, 2); assert.equal(f.requests.length, 1, 'A save retry must not spend another lookup');
    assert.deepEqual(f.saveCalls[1].record, f.saveCalls[0].record);
    assert.equal(f.saveStatus.textContent, '광고 링크를 서버에 저장했습니다.'); assert.equal(f.saveRetry.hidden, true);
  });
});

test('34 persisted car links restore immediately with no lookup, popup or write', t => {
  const f = fixture(t, { bridge: true, savedRecord: storedRecord() });
  assert.equal(f.links.length, 2); assert.deepEqual(f.links.map(a => a.href), [listing().sellerUrl, listing().trustedUrl]);
  assert.equal(f.requests.length, 0); assert.equal(f.openCalls.length, 0); assert.equal(f.saveCalls.length, 0);
  assert.equal(f.saveStatus.textContent,''); assert.doesNotMatch(f.saveStatus.textContent, /서버에 저장했습니다/);
  assert.equal(f.note.textContent, ''); assert.equal(f.saveRetry.hidden, true);
});

test('35 acknowledged car links survive closing and reopening without another lookup or write', async t => {
  const f = fixture(t, { bridge: true });
  f.click(); await settle(); f.reply(0, found()); await settle();
  assert.equal(f.saveCalls.length, 1); assert.ok(f.w.cars[0].encarLinks);
  f.closeDetail(); await settle(); assert.equal(f.links.length, 0);
  f.reopenDetail(); await settle();
  assert.equal(f.links.length, 2); assert.equal(f.requests.length, 1); assert.equal(f.openCalls.length, 1); assert.equal(f.saveCalls.length, 1);
  assert.equal(f.saveStatus.textContent,'');
});

test('36 a fresh device restores server car data without a local ID cache, then verifies its selected trusted link', async t => {
  const first = fixture(t, { bridge: true }); first.click(); await settle(); first.reply(0, found()); await settle();
  const next = fixture(t, { bridge: true, cars: plain(first.w.cars) });
  assert.equal(next.w.localStorage.getItem(PREFIX + PLATE), null); assert.equal(next.links.length, 2);
  assert.equal(next.requests.length, 0); assert.equal(next.saveCalls.length, 0);
  next.links.find(a => a.textContent === '엔카 믿고').click(); await settle();
  assert.deepEqual(JSON.parse(next.requests[0].init.body), { plate: PLATE, candidateIds: ['43000001', '43000002'] });
  assert.deepEqual(next.tabs[0].navigations, [], 'Restored data is only a hint until the server verifies it again');
  next.reply(0, found()); await settle();
  assert.deepEqual(next.tabs[0].navigations, [listing().trustedUrl]); assert.equal(next.saveCalls.length, 1);
});

test('37 an explicitly selected saved seller is reverified and remains the selection when several originals verify', async t => {
  const second = listing('43000003', null), f = fixture(t, { bridge: true, savedRecord: storedRecord([listing(), second]) });
  f.links.find(a => a.href === second.sellerUrl).click(); await settle();
  assert.deepEqual(JSON.parse(f.requests[0].init.body).candidateIds, ['43000003']); assert.deepEqual(f.tabs[0].navigations, []);
  f.reply(0, { ...found(PLATE, [listing(), second]), status: 'multiple' }); await settle();
  assert.deepEqual(f.tabs[0].navigations, [second.sellerUrl]);
  assert.equal(f.saveCalls.length, 1); assert.equal(f.saveCalls[0].record.listings.length, 2);
});

test('38 a missing, changed or inconsistent selected trusted advertisement never opens the old URL', async t => {
  for (const change of ['missing', 'changed', 'inconsistent']) await t.test(change, async sub => {
    const f = fixture(sub, { bridge: true, savedRecord: storedRecord() });
    f.links.find(a => a.textContent === '엔카 믿고').click(); await settle();
    const current = change === 'missing' ? listing('43000001', null) : listing('43000001', '43000004');
    if (change === 'inconsistent') current.trustedUrl = listing().trustedUrl;
    f.reply(0, found(PLATE, [current])); await settle();
    assert.equal(f.tabs[0].closed, true); assert.deepEqual(f.tabs[0].navigations, []);
    assert.match(f.note.textContent, /상태가 변경/);
    assert.equal(f.saveCalls.length, 1);
    if (change !== 'changed') assert.equal(f.saveCalls[0].record.listings[0].trustedUrl, null);
  });
});

test('39 late storage replies cannot restore feedback after vehicle, plate, actor, storage scope or data changes', async t => {
  for (const change of ['vehicle', 'plate', 'logout', 'scope', 'replacement']) await t.test(change, async sub => {
    const saved = deferred(), f = fixture(sub, { bridge: true, save: () => saved.promise });
    f.click(); await settle(); f.reply(0, found()); await settle(); assert.match(f.saveStatus.textContent, /저장 중/);
    if (change === 'vehicle') f.w.activeCarId = 'car-2';
    if (change === 'plate') f.w.cars[0].plate = SECOND_PLATE;
    if (change === 'logout') { f.state.ready = false; f.w.currentUser = null; f.w.document.getElementById('zc-cloud-gate').hidden = false; }
    if (change === 'scope') f.state.storageScope = 'other-fixture-company';
    if (change === 'replacement') f.w.cars = plain(f.w.cars);
    f.w.document.getElementById('vehicle-meta').textContent = '새 화면'; await settle();
    assert.equal(f.saveStatus.textContent, ''); assert.equal(f.saveRetry.hidden, true);
    saved.resolve({ ok: true }); await settle();
    assert.equal(f.saveStatus.textContent, ''); assert.equal(f.saveRetry.hidden, true); assert.equal(f.links.length, 0);
    assert.equal(f.saveCalls.length, 1);
  });
});

test('40 pending local car metadata can reopen as a recent verified hint without claiming a server ACK', async t => {
  const f = fixture(t, { bridge: true, applyBeforeSave: true, save: () => Promise.reject(Error('PRIVATE_DB_ERROR')) });
  f.click(); await settle(); f.reply(0, found()); await settle();
  assert.ok(f.w.cars[0].encarLinks); assert.equal(f.saveRetry.hidden, false);
  f.closeDetail(); await settle(); f.reopenDetail(); await settle();
  assert.equal(f.links.length, 2); assert.equal(f.saveStatus.textContent,'');
  assert.doesNotMatch(f.saveStatus.textContent, /서버에 저장했습니다|저장된 광고/);
  assert.equal(f.requests.length, 1); assert.equal(f.saveCalls.length, 1);
});

test('41 unsafe, mismatched, duplicate and oversized stored records cannot become links or trigger writes', async t => {
  const invalid = [
    { ...storedRecord(), version: 2 }, { ...storedRecord(), plate: SECOND_PLATE },
    { ...storedRecord(), verifiedAt: 'not-a-date' }, { ...storedRecord(), verifiedAt: new Date(Date.now() + 120000).toISOString() },
    storedRecord([]), storedRecord(Array.from({ length: 13 }, (_, i) => listing(String(43000001 + i), null))),
    storedRecord([listing(), listing()]), storedRecord([{ ...listing(), sellerUrl: 'https://evil.test/cars/detail/43000001' }]),
    storedRecord([{ ...listing(), sellerUrl: 'javascript:alert(1)' }]), storedRecord([{ ...listing(), id: '43000003' }])
  ];
  for (const record of invalid) {
    const f = fixture(t, { bridge: true, savedRecord: record });
    assert.equal(f.links.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.openCalls.length, 0); assert.equal(f.saveCalls.length, 0);
  }
  for (const trustedUrl of ['https://evil.test/cars/detail/43000002', 'javascript:alert(1)', 'https://fem.encar.com/cars/detail/43000004']) {
    const f = fixture(t, { bridge: true, savedRecord: storedRecord([{ ...listing(), trustedUrl }]) });
    assert.deepEqual(f.links.map(a => a.href), [listing().sellerUrl]); assert.equal(f.requests.length, 0); assert.equal(f.saveCalls.length, 0);
  }
});

test('42 read-only staff may restore and reverify links but never call the storage bridge', async t => {
  const record = storedRecord(); record.verifiedAt = new Date(Date.now() - 3600000).toISOString();
  const f = fixture(t, { bridge: true, canWrite: false, savedRecord: record }), before = JSON.stringify(f.w.cars[0]);
  assert.equal(f.links.length, 2); f.links.find(a => a.textContent === '엔카 믿고').click(); await settle();
  assert.deepEqual(f.tabs[0].navigations, []); f.reply(0, found()); await settle();
  assert.deepEqual(f.tabs[0].navigations, [listing().trustedUrl]); assert.equal(f.saveCalls.length, 0);
  assert.equal(JSON.stringify(f.w.cars[0]), before); assert.equal(f.saveRetry.hidden, true);
  assert.match(f.saveStatus.textContent, /담당 딜러|관리자/); assert.doesNotMatch(f.saveStatus.textContent, /서버에 저장했습니다/);
});

test('43 an original advertisement ID cannot also become its own trusted link or invalid server record', async t => {
  const sameId = listing('43000001', '43000001');
  const restored = fixture(t, { bridge: true, savedRecord: storedRecord([sameId]) });
  assert.deepEqual(restored.links.map(a => a.href), [sameId.sellerUrl]);
  assert.equal(restored.links.some(a => a.textContent === '엔카 믿고'), false);
  const fresh = fixture(t, { bridge: true }); fresh.click(); await settle(); fresh.reply(0, found(PLATE, [sameId])); await settle();
  assert.deepEqual(fresh.links.map(a => a.href), [sameId.sellerUrl]);
  assert.equal(fresh.saveCalls.length, 1);
  assert.equal(fresh.saveCalls[0].record.listings[0].trustedId, null);
  assert.equal(fresh.saveCalls[0].record.listings[0].trustedUrl, null);
  assert.equal(fresh.saveStatus.textContent, '광고 링크를 서버에 저장했습니다.');
});

test('44 the accessible logo survives failed lookup and retry while disabled offline actions remain named', async t => {
  const offline = fixture(t, { ready: false });
  assert.equal(offline.button.disabled, true);
  assertLookupIcon(offline.button);
  offline.click(); await settle();
  assert.equal(offline.openCalls.length, 0); assert.equal(offline.requests.length, 0);

  const f = fixture(t, { headerActions: true });
  const logo = assertLookupIcon(f.button);
  assert.equal(f.button.parentElement.id, 'vehicle-header-actions');
  assert.equal(f.w.document.getElementById('original-action').textContent, '견적서');
  f.click(); await settle(); assert.equal(assertLookupIcon(f.button, true), logo);
  f.reply(0, { status: 'error', diagnostics: { code: 'DETAIL_BLOCKED' } }, { status: 502 }); await settle();
  assert.equal(f.tabs[0].closed, true); assert.equal(f.button.disabled, false);
  assert.equal(assertLookupIcon(f.button), logo);
  assert.equal(f.note.dataset.error, 'true'); assert.deepEqual(f.tabs[0].navigations, []);
  f.click(); await settle(); assert.equal(assertLookupIcon(f.button, true), logo);
  f.reply(1, found()); await settle();
  assert.deepEqual(f.tabs[1].navigations, [listing().sellerUrl]);
  assert.equal(assertLookupIcon(f.button), logo);
});

test('45 sold vehicles hide only the lookup icon and keep authorized saved links', async t => {
 const f=fixture(t,{bridge:true,savedRecord:storedRecord()});f.w.cars[0].status='판매완료';f.w.SnoteEncarLink.refresh();assert.equal(f.button.hidden,true);assert.equal(f.links.length,2);f.w.cars[0].status='판매중';f.w.SnoteEncarLink.refresh();assert.equal(f.button.hidden,false);assert.equal(f.requests.length,0);
});
test('46 isolated waiting tab contains the requested styled message and reduced-motion animation', async t => {
 const f=fixture(t);f.click();await settle();const doc=f.tabs[0].document;assert.equal(doc.querySelector('h1').textContent,'해당 차량의 엔카 광고를 찾고 있어요!');assert.equal(doc.querySelectorAll('.car,.scan').length,2);assert.match(doc.querySelector('style').textContent,/prefers-reduced-motion/);assert.equal(f.tabs[0].opener,null);f.reply(0,found());await settle();assert.deepEqual(f.tabs[0].navigations,[listing().sellerUrl]);
});
test('47 failed recheck retains only previously saved verified URLs and its failure message', async t => {
 const f=fixture(t,{bridge:true,savedRecord:storedRecord()});f.click();await settle();f.reply(0,{status:'error',diagnostics:{code:'DETAIL_BLOCKED'}},{status:502});await settle();assert.deepEqual(f.links.map(a=>a.href),[listing().sellerUrl,listing().trustedUrl]);assert.equal(f.note.dataset.error,'true');assert.match(f.note.textContent,/제한/);assert.equal(f.tabs[0].closed,true);
});
