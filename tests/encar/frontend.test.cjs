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
    get manual() { return w.document.querySelector('.snote-encar-manual'); },
    get manualInput() { return w.document.getElementById('snote-encar-manual-url'); },
    get copyButton() { return w.document.querySelector('.snote-encar-copy'); },
    get copyFallback() { return w.document.querySelector('.snote-encar-copy-fallback'); },
    get copyStatus() { return w.document.querySelector('.snote-encar-copy-status'); },
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
  for (const code of ['SEARCH_NO_RESULTS', 'SEARCH_NO_CANDIDATES', 'PLATE_MISMATCH', 'AD_INACTIVE', 'DETAIL_NOT_FOUND', 'NO_VERIFIED_LISTING']) {
    await t.test(code, async sub => {
      const f = fixture(sub); await showUnverified(f, { code, requestId: REQUEST_ID, message: 'UNTRUSTED_PRIVATE_MESSAGE' });
      messages.push(f.note.textContent); assert.doesNotMatch(f.note.textContent, /UNTRUSTED|판매\s*완료|매물.*없/);
      assert.equal(f.manual.hidden, false); assert.equal(f.manual.open, false); assert.equal(f.note.dataset.error, 'false');
      assert.equal(f.tabs[0].closed, true); assert.deepEqual(f.tabs[0].navigations, []);
    });
  }
  assert.equal(new Set(messages).size, 6);
});

test('21 service diagnostic error codes distinguish setup, search, detail and timeout while unknown/old replies keep HTTP fallbacks', async t => {
  const messages = [];
  for (const code of ['SEARCH_NOT_CONFIGURED', 'SUPABASE_NOT_CONFIGURED', 'SEARCH_AUTH_FAILED', 'SEARCH_RATE_LIMITED', 'SEARCH_QUOTA_EXCEEDED', 'SEARCH_UNAVAILABLE', 'DETAIL_BLOCKED', 'DETAIL_PARSE_FAILED', 'DETAIL_UNAVAILABLE', 'AD_STATUS_UNKNOWN', 'UPSTREAM_TIMEOUT', 'DEADLINE_EXCEEDED']) {
    await t.test(code, async sub => {
      const f = fixture(sub); f.click(); await settle(); f.reply(0, { status: 'error', diagnostics: { code, requestId: REQUEST_ID, message: 'UNTRUSTED_PRIVATE_MESSAGE' } }, { status: 502 }); await settle();
      messages.push(f.note.textContent); assert.doesNotMatch(f.note.textContent, /UNTRUSTED/); assert.equal(f.note.dataset.error, 'true');
      assert.equal(f.manual.hidden, true); assert.equal(f.copyButton.hidden, false); assert.equal(f.tabs[0].closed, true);
    });
  }
  assert.equal(new Set(messages).size, 12);
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
  assert.equal(blocked.links.length, 2); assert.match(blocked.note.textContent, /아래 링크/); assert.doesNotMatch(blocked.note.textContent, /PRIVATE/);
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

test('30 optional matched-plate and search-stage counts copy only whole numbers in the existing bounds', async t => {
  const keys = ['plateMatchedCount', 'resultPlateMatchCount', 'rawResultCount', 'recognizedSourceCount'];
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
