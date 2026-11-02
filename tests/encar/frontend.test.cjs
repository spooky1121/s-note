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

function fixture(t, options = {}) {
  const console = new VirtualConsole();
  const errors = [];
  console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div id="zc-cloud-gate" hidden></div><div id="zc86-topbar"></div>
    <button id="zc-cloud-status" hidden>클라우드 연결됨</button>
    <section id="vehicle-overlay" class="overlay open">
      <header><p id="vehicle-meta">원래 차량 정보</p><button id="original-close">닫기</button></header>
      <div id="original-detail">원래 상세 본문</div>
    </section></body></html>`, {
    url: 'https://snote.test/',
    runScripts: 'outside-only',
    virtualConsole: console
  });
  const w = dom.window;
  const state = { ready: true };
  const events = [], openCalls = [], tabs = [], requests = [];
  w.cars = [{ id: 'car-1', plate: PLATE }, { id: 'car-2', plate: SECOND_PLATE }];
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
    w, state, events, openCalls, tabs, requests, button,
    originalOpenVehicle, originalCloseVehicle,
    get note() { return w.document.querySelector('.snote-encar-note'); },
    get links() { return [...w.document.querySelectorAll('.snote-encar-results a')]; },
    click() { button.click(); },
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
});

test('02 popup is synchronous, and navigation occurs only after server verification', async t => {
  const token = deferred();
  const f = fixture(t, { token: () => token.promise });
  f.click();
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
  f.click(); await settle();
  f.w.dispatchEvent(new f.w.PageTransitionEvent('pagehide', { persisted: true }));
  await settle();
  assert.equal(f.requests[0].aborted, true);
  assert.equal(f.tabs[0].closed, true);
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.textContent, '엔카 광고 보기');
  f.w.dispatchEvent(new f.w.PageTransitionEvent('pageshow', { persisted: true }));
  await settle();
  assert.equal(f.button.disabled, false);
  f.reply(0, found()); await settle();
  assert.deepEqual(f.tabs[0].navigations, []);
  f.click(); await settle(); f.reply(1, found()); await settle();
  assert.deepEqual(f.tabs[1].navigations, [listing().sellerUrl]);
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
