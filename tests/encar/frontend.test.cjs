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
const LOOKUP_LOGO_SRC = 'assets/encar-wordmark.png?v=2.73';
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
  assert.equal(icons[0].classList.contains('snote-encar-wordmark'), true);
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
      <header><p id="vehicle-meta">원래 차량 정보</p>${options.headerActions ? '<div id="vehicle-header-actions" role="group" aria-label="차량 작업">'+(options.staticButton?'<button id="vehicle-encar-check" data-existing-header-control="true" type="button" disabled>광고 확인</button>':'')+'<button id="original-action" type="button">견적서</button></div>' : ''}<button id="original-close">닫기</button></header>
      <div id="original-detail">원래 상세 본문</div>
    </section></body></html>`, {
    url: 'https://snote.test/',
    runScripts: 'outside-only',
    virtualConsole: console
  });
  const w = dom.window;
  const state = { ready: options.ready ?? true, canWrite: options.canWrite ?? true, storageScope: 'fixture-company' };
  const events = [], openCalls = [], tabs = [], requests = [], saveCalls = [], applyCalls = [], changeCalls = [], autoCalls = [], refreshListCalls = [], toasts = [];
  w.toast = message => toasts.push(message);
  w.cars = plain(options.cars || [{ id: 'car-1', plate: PLATE }, { id: 'car-2', plate: SECOND_PLATE }]);
  if (options.savedRecord !== undefined) w.cars[0].encarLinks = plain(options.savedRecord);
  w.activeCarId = 'car-1';
  w.currentUser = { username: 'test-user' };
  if(options.autoConfirm){
    const input=w.document.createElement('input');input.id='detail-sell';input.value=Number(w.cars[0].sell??0).toLocaleString('ko-KR');w.document.getElementById('original-detail').append(input);
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  }
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
      applyPrice(base, record, listingId) {
        const call = {base: plain(base), record: plain(record), listingId}; applyCalls.push(call);
        return options.applyPrice ? options.applyPrice(call.base, call.record, listingId) : {ok:true, priceWon:record.listings.find(item=>item.id===listingId)?.priceWon, saved:false};
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
    if(options.autoConfirm)w.snoteEncarLinksBridge.changePrice=async(base,record,listingId,expectation)=>{
      const target=w.cars.find(item=>String(item.id)===base.carId),call={base:plain(base),record:plain(record),listingId,expectation:plain(expectation)};changeCalls.push(call);
      const priceWon=record.listings.find(item=>item.id===listingId)?.priceWon;
      const result=await(options.changePrice?options.changePrice(call):{ok:true,priceWon,saved:true});
      if(result?.ok===true&&result.saved===true&&options.applyChanged!==false&&target){target.sell=result.priceWon;if(w.activeCarId===target.id)w.document.getElementById('detail-sell').value=result.priceWon.toLocaleString('ko-KR');}
      return result;
    };
    if(options.autoConfirm)w.snoteEncarLinksBridge.refreshList=base=>{refreshListCalls.push(plain(base));if(options.refreshList)options.refreshList(base);};
    if(options.autoPrice)w.snoteEncarLinksBridge.autoPrice=async(base,record,settings)=>{const call={base:plain(base),record:plain(record),settings};autoCalls.push(call);return options.autoPrice(call);};
  }
  if (options.requestTimeoutMs !== undefined || options.autoTimeoutMs !== undefined) {
    const realSetTimeout = w.setTimeout.bind(w);
    w.setTimeout = (handler, delay, ...args) => realSetTimeout(
      handler, delay === 45000 && options.requestTimeoutMs !== undefined ? options.requestTimeoutMs : delay === 65000 && options.autoTimeoutMs !== undefined ? options.autoTimeoutMs : delay, ...args
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
    w, state, events, openCalls, tabs, requests, saveCalls, applyCalls, changeCalls, autoCalls, refreshListCalls, toasts, button,
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
    get priceControls() { return [...w.document.querySelectorAll('.snote-encar-price-apply')]; },
    get prices() { return [...w.document.querySelectorAll('.snote-encar-price-value')]; },
    get priceFeedback() { return w.document.querySelector('.snote-encar-price-feedback'); },
    get lastToast() { return toasts.at(-1) || ''; },
    get priceConfirmation(){return w.document.getElementById('snote-encar-price-confirm');},
    get priceChangeButton(){return w.document.querySelector('.snote-encar-price-confirm-save');},
    get priceCancelButton(){return w.document.querySelector('.snote-encar-price-confirm-cancel');},
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
  for (const code of ['SEARCH_NOT_CONFIGURED', 'SUPABASE_NOT_CONFIGURED', 'SEARCH_AUTH_FAILED', 'SEARCH_RATE_LIMITED', 'SEARCH_QUOTA_EXCEEDED', 'SEARCH_UNAVAILABLE', 'DETAIL_BLOCKED', 'DETAIL_PARSE_FAILED', 'DETAIL_UNAVAILABLE', 'AD_STATUS_UNKNOWN', 'CATALOG_BLOCKED', 'CATALOG_UNAVAILABLE', 'CATALOG_FORM_UNSUPPORTED', 'CATALOG_PARSE_FAILED', 'CATALOG_INCOMPLETE', 'CATALOG_TIMEOUT', 'CATALOG_CONFIG_INVALID', 'CATALOG_PARSER_UNAVAILABLE', 'CATALOG_LIMIT_EXCEEDED', 'UPSTREAM_TIMEOUT', 'DEADLINE_EXCEEDED']) {
    await t.test(code, async sub => {
      const f = fixture(sub); f.click(); await settle(); f.reply(0, { status: 'error', diagnostics: { code, requestId: REQUEST_ID, message: 'UNTRUSTED_PRIVATE_MESSAGE' } }, { status: 502 }); await settle();
      messages.push(f.note.textContent); assert.doesNotMatch(f.note.textContent, /UNTRUSTED/); assert.equal(f.note.dataset.error, 'true');
      assert.equal(f.manual.hidden, !code.startsWith('CATALOG_')); assert.equal(f.manual.open, false); assert.equal(f.copyButton.hidden, false); assert.equal(f.tabs[0].closed, true);
      assert.equal(f.links.length, 0); assert.deepEqual(f.tabs[0].navigations, []);
    });
  }
  assert.equal(new Set(messages).size, 21);
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

test('catalogue timeout preserves its safe diagnostic and offers manual verification without admitting partial listings', async t => {
  const f = fixture(t, {bridge:true}); f.click(); await settle();
  f.reply(0, {...found(), status:'error', diagnostics:{code:'CATALOG_TIMEOUT', requestId:REQUEST_ID, catalogRequestCount:2, body:'PRIVATE_BODY', token:'PRIVATE_TOKEN'}}, {status:502}); await settle();
  assert.equal(f.note.textContent, '공개 차량 목록 확인이 지연됐습니다. 광고 주소로 다시 확인할 수 있습니다.');
  assert.equal(f.manual.hidden, false); assert.equal(f.manual.open, false); assert.equal(f.tabs[0].closed, true);
  assert.deepEqual(f.tabs[0].navigations, []); assert.equal(f.links.length, 0); assert.equal(f.saveCalls.length, 0);
  f.copyButton.click(); await settle();
  assert.deepEqual(JSON.parse(f.copyFallback.value), {service:'snote-encar', code:'CATALOG_TIMEOUT', httpStatus:502, requestId:REQUEST_ID, catalogRequestCount:2});
  assert.doesNotMatch(f.copyFallback.value, /PRIVATE|12가3456|43000001|https:|token/);
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

test('middleware failures keep allowlisted request reasons without exposing response fields or opening advertisements', async t => {
  for (const [code, status, message] of [
    ['SESSION_UNAVAILABLE', 503, '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
    ['SESSION_REPLACED', 401, '다른 기기에서 로그인하여 로그아웃되었습니다.'],
    ['UNAUTHORIZED', 401, '로그인이 필요합니다. 다시 로그인해 주세요.'],
    ['FORBIDDEN', 403, '허용되지 않은 요청입니다. S-NOTE에서 다시 시도해 주세요.'],
    ['RATE_LIMITED', 429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.']
  ]) {
    await t.test(code, async sub => {
      const f = fixture(sub, {bridge:true, savedRecord:storedRecord()});
      f.click(); await settle();
      f.reply(0, {ok:false, code, error:'PRIVATE_RESPONSE', plate:PLATE, listings:[listing()], token:'PRIVATE_TOKEN'}, {status}); await settle();
      assert.equal(f.note.textContent, message); assert.equal(f.note.dataset.error, 'true');
      assert.equal(f.tabs[0].closed, true); assert.deepEqual(f.tabs[0].navigations, []); assert.equal(f.saveCalls.length, 0);
      assert.equal(f.links.length, 2, 'Previously saved links survive a current failed recheck');
      f.copyButton.click(); await settle();
      assert.deepEqual(JSON.parse(f.copyFallback.value), {service:'snote-encar', code, httpStatus:status});
      assert.doesNotMatch(f.copyFallback.value, /PRIVATE|12가3456|43000001|https:|token/);
    });
  }
  const unknown = fixture(t); unknown.click(); await settle();
  unknown.reply(0, {ok:false, code:'PRIVATE_UNKNOWN', error:'PRIVATE_RESPONSE'}, {status:503}); await settle(); unknown.copyButton.click(); await settle();
  assert.equal(JSON.parse(unknown.copyFallback.value).code, 'HTTP_ERROR'); assert.doesNotMatch(unknown.note.textContent, /PRIVATE/);
});

test('current ownership exceptions preserve their reason while late exceptions remain silent', async t => {
  for (const code of ['SESSION_UNAVAILABLE', 'SESSION_CONTEXT_CHANGED']) {
    for (const typed of [false, true]) {
      const f = fixture(t, {bridge:true}); f.click(); await settle();
      const error = typed ? Object.assign(Error('PRIVATE_AUTH_ERROR'), {code, httpStatus:503}) : Error(code);
      f.requests[0].pending.reject(error); await settle(); f.copyButton.click(); await settle();
      assert.equal(JSON.parse(f.copyFallback.value).code, code);
      assert.equal(JSON.parse(f.copyFallback.value).httpStatus, typed ? 503 : null);
      assert.match(f.note.textContent, /로그인/); assert.doesNotMatch(f.note.textContent, /PRIVATE/);
      assert.equal(f.tabs[0].closed, true); assert.equal(f.saveCalls.length, 0); assert.deepEqual(f.tabs[0].navigations, []);
    }
  }
  for (const change of [f=>{f.w.currentUser={username:'another-user'};}, f=>{f.state.ready=false;}]) {
    const f = fixture(t, {bridge:true}); f.click(); await settle(); change(f); f.w.SnoteEncarLink.refresh();
    f.requests[0].pending.reject(Object.assign(Error('PRIVATE_AUTH_ERROR'), {code:'SESSION_UNAVAILABLE',httpStatus:503})); await settle();
    assert.equal(f.note.textContent, ''); assert.equal(f.copyButton.hidden, true); assert.equal(f.tabs[0].closed, true); assert.equal(f.saveCalls.length, 0);
  }
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
test('48 reuses the permanent header action without duplicate controls and restores it after viewing a sold vehicle', async t => {
 const f=fixture(t,{headerActions:true,staticButton:true,ready:false});
 assert.equal(f.button.id,'vehicle-encar-check');
 assert.equal(f.button.dataset.existingHeaderControl,'true','Mount must preserve the page control rather than replacing it');
 assert.equal(f.w.document.querySelectorAll('#vehicle-encar-check,.snote-encar-button').length,1);
 assert.equal(f.button.parentElement.id,'vehicle-header-actions');assertLookupIcon(f.button);
 assert.equal(f.button.disabled,true,'The permanent action cannot bypass online authentication');
 f.state.ready=true;f.w.SnoteEncarLink.refresh();assert.equal(f.button.disabled,false);
 f.w.cars[0].status='판매완료';f.w.SnoteEncarLink.refresh();assert.equal(f.button.hidden,true);
 f.w.cars[0].status='판매중';f.w.SnoteEncarLink.refresh();assert.equal(f.button.hidden,false);
 f.w.eval(SOURCE);assert.equal(f.w.document.querySelectorAll('.snote-encar-button').length,1);
 f.click();await settle();f.reply(0,found());await settle();
 assert.deepEqual(f.tabs[0].navigations,[listing().sellerUrl]);
});

function pricedListing(priceWon=37770000,checkedAt=new Date(Date.now()-3600000).toISOString(),id='43000001') {
 return {...listing(id,null),priceWon,priceCheckedAt:checkedAt,priceSource:'encar-api.com',priceStatus:'verified'};
}

test('49 exact KRW advertisement prices and Korean observation time persist before an explicit draft-only price action', async t => {
 const saved=deferred(),f=fixture(t,{bridge:true,save:()=>saved.promise}),item=pricedListing();
 f.w.cars[0].sell=12000000;const before=JSON.stringify(f.w.cars[0]);f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();
 assert.equal(f.prices[0].textContent,'엔카 광고가 37,770,000원');assert.equal(f.priceControls.length,1);assert.equal(f.priceControls[0].disabled,true);
 assert.equal(JSON.stringify(f.w.cars[0]),before,'An advertisement price never automatically replaces the vehicle selling price');
 f.priceControls[0].dispatchEvent(new f.w.MouseEvent('click'));await settle();assert.equal(f.applyCalls.length,0,'Programmatic clicks cannot bypass a pending storage ACK');
 assert.equal(f.saveCalls[0].record.listings[0].priceWon,37770000);assert.equal(f.saveCalls[0].record.listings[0].priceSource,'encar-api.com');
 const checked=f.w.document.querySelector('.snote-encar-price-checked');assert.equal(checked.getAttribute('datetime'),item.priceCheckedAt);
 assert.equal(checked.textContent,new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(item.priceCheckedAt))+' 확인');
 saved.resolve({ok:true});await settle();assert.equal(f.priceControls[0].disabled,false);assert.equal(f.w.cars[0].sell,12000000);
 f.priceControls[0].click();await settle();assert.equal(f.applyCalls.length,1);assert.equal(f.applyCalls[0].listingId,item.id);assert.equal(f.applyCalls[0].record.listings[0].priceWon,37770000);
 assert.match(f.lastToast,/입력했습니다/);assert.match(f.lastToast,/저장을 눌러/);assert.equal(f.toasts.includes('저장 되었습니다.'),false);assert.equal(f.w.cars[0].sell,12000000,'Only the real bridge may edit the explicit input draft');
});

test('50 missing, malformed or untrusted price metadata never displays or applies a misleading amount while links survive',async t=>{
 const older=new Date(Date.now()-3600000).toISOString();
 const mutations=[{priceWon:0},{priceWon:-1},{priceWon:1.5},{priceWon:1000000000001},{priceWon:'37770000'},
  {priceWon:null},{priceSource:'evil.test'},{priceSource:null},{priceCheckedAt:'invalid'},
  {priceCheckedAt:'2026-02-30'},{priceCheckedAt:'2026-01-01T09:00:00+09:00'},{priceCheckedAt:'2026-01-01T00:00:00Z'},
  {priceCheckedAt:new Date(Date.now()+120000).toISOString()},{priceCheckedAt:new Date(Date.parse(older)+120000).toISOString(),older},
  {priceStatus:'estimated'},{priceStatus:'unavailable'},{priceStatus:null}];
 for(const [index,patch]of mutations.entries())await t.test(String(index),async sub=>{
  const record=storedRecord([{...pricedListing(),...patch}]);if(patch.older)record.verifiedAt=patch.older;
  const f=fixture(sub,{bridge:true,savedRecord:record});assert.equal(f.links.length,1);assert.equal(f.prices[0].textContent,'광고 가격 확인 불가');assert.equal(f.priceControls.length,0);assert.equal(f.applyCalls.length,0);
 });
 const legacy=fixture(t,{bridge:true,savedRecord:storedRecord()});assert.equal(legacy.links.length,2);assert.equal(legacy.prices.length,0);assert.equal(legacy.priceControls.length,0);
});

test('51 the same advertisement URLs re-render changed price and checked time from the saved record',async t=>{
 const first=pricedListing(),f=fixture(t,{bridge:true,savedRecord:storedRecord([first])});assert.equal(f.priceControls[0].disabled,false);
 const updated=pricedListing(41234567,new Date(Date.now()-1800000).toISOString());f.w.cars[0].encarLinks=storedRecord([updated]);f.w.SnoteEncarLink.refresh();
 assert.equal(f.prices[0].textContent,'엔카 광고가 41,234,567원');assert.equal(f.w.document.querySelector('.snote-encar-price-checked').getAttribute('datetime'),updated.priceCheckedAt);assert.equal(f.priceControls.length,1);
 f.priceControls[0].click();await settle();assert.equal(f.applyCalls[0].record.listings[0].priceWon,41234567);assert.equal(f.requests.length,0);
});

test('52 failed price metadata storage keeps the amount visible but disables applying until a confirmed retry',async t=>{
 const f=fixture(t,{bridge:true,save:(_b,_r,index)=>({ok:index>0})});f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();
 assert.equal(f.priceControls[0].disabled,true);assert.equal(f.saveRetry.hidden,false);f.priceControls[0].dispatchEvent(new f.w.MouseEvent('click'));await settle();assert.equal(f.applyCalls.length,0);
 f.saveRetry.click();await settle();assert.equal(f.priceControls[0].disabled,false);assert.equal(f.requests.length,1);assert.equal(f.saveCalls.length,2);
});

test('53 read-only staff and sold vehicles can see stored prices but cannot apply them',async t=>{
 const readonly=fixture(t,{bridge:true,canWrite:false,savedRecord:storedRecord([pricedListing()])});assert.equal(readonly.prices[0].textContent,'엔카 광고가 37,770,000원');assert.equal(readonly.priceControls[0].hidden,true);
 readonly.priceControls[0].dispatchEvent(new readonly.w.MouseEvent('click'));await settle();assert.equal(readonly.applyCalls.length,0);
 const sold=fixture(t,{bridge:true,savedRecord:storedRecord([pricedListing()])});sold.w.cars[0].status='판매완료';sold.w.SnoteEncarLink.refresh();assert.equal(sold.priceControls[0].hidden,true);sold.priceControls[0].dispatchEvent(new sold.w.MouseEvent('click'));await settle();assert.equal(sold.applyCalls.length,0);
 sold.w.cars[0].status='판매중';sold.w.SnoteEncarLink.refresh();assert.equal(sold.priceControls[0].hidden,false);assert.equal(sold.priceControls[0].disabled,false);
});

test('54 applying is single flight and a stale account or changed price ignores late acknowledgements',async t=>{
 for(const change of['account','company','price','closed'])await t.test(change,async sub=>{
  const held=deferred(),f=fixture(sub,{bridge:true,savedRecord:storedRecord([pricedListing()]),applyPrice:()=>held.promise});
  f.priceControls[0].click();await settle();assert.equal(f.applyCalls.length,1);assert.equal(f.priceControls[0].disabled,true);f.priceControls[0].dispatchEvent(new f.w.MouseEvent('click'));assert.equal(f.applyCalls.length,1);
  if(change==='account')f.w.currentUser={username:'other'};if(change==='company')f.state.storageScope='other-company';if(change==='price')f.w.cars[0].encarLinks=storedRecord([pricedListing(42000000)]);if(change==='closed')f.closeDetail();
  f.w.SnoteEncarLink.refresh();held.resolve({ok:true,priceWon:37770000,saved:false});await settle();
  assert.equal(f.toasts.some(message=>/입력했습니다/.test(message)),false);assert.equal(f.priceFeedback,null);
 });
});

test('55 a failed or malformed draft response keeps the verified price and never promises that it was saved',async t=>{
 for(const response of[{ok:false},{ok:true,priceWon:37770001,saved:false},{ok:true,priceWon:37770000,saved:true}])await t.test(JSON.stringify(response),async sub=>{
  const f=fixture(sub,{bridge:true,savedRecord:storedRecord([pricedListing()]),applyPrice:()=>response});f.priceControls[0].click();await settle();assert.match(f.lastToast,/입력하지 못/);assert.equal(f.toasts.includes('저장 되었습니다.'),false);assert.equal(f.prices[0].textContent,'엔카 광고가 37,770,000원');assert.equal(f.priceControls[0].disabled,false);
 });
});

test('56 automatic price confirmation waits for metadata ACK, keeps the user in S-NOTE and requires an explicit change',async t=>{
 const gate=deferred(),f=fixture(t,{bridge:true,autoConfirm:true,save:()=>gate.promise,cars:[{id:'car-1',plate:PLATE,sell:12000000}]}),item=pricedListing();
 f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.priceConfirmation.open,false);assert.equal(f.tabs[0].closed,true);assert.deepEqual(f.tabs[0].navigations,[]);
 assert.equal(f.changeCalls.length,0);gate.resolve({ok:true});await settle();assert.equal(f.priceConfirmation.open,true);assert.match(f.priceConfirmation.textContent,/이 금액으로 변경하시겠습니까/);assert.match(f.priceConfirmation.textContent,/12,000,000원/);assert.match(f.priceConfirmation.textContent,/37,770,000원/);
 assert.equal(f.w.cars[0].sell,12000000);f.priceCancelButton.click();assert.equal(f.priceConfirmation.open,false);assert.equal(f.changeCalls.length,0);
 f.priceControls[0].click();assert.equal(f.priceConfirmation.open,false);await settle();assert.equal(f.changeCalls.length,1);assert.equal(f.changeCalls[0].expectation.expectedSellWon,12000000);assert.equal(f.changeCalls[0].listingId,item.id);
 assert.equal(f.w.cars[0].sell,item.priceWon);assert.equal(f.priceConfirmation.open,false);assert.equal(f.lastToast,'저장 되었습니다.');assert.equal(f.priceFeedback,null);
});

test('57 saved restore, equal price, readonly, sold and edited sale-price drafts do not create an automatic change prompt',async t=>{
 const item=pricedListing();const restored=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord([item]),cars:[{id:'car-1',plate:PLATE,sell:12000000}]});assert.equal(restored.priceConfirmation.open,false);
 for(const kind of['equal','readonly','sold','dirty'])await t.test(kind,async sub=>{
  const f=fixture(sub,{bridge:true,autoConfirm:true,canWrite:kind!=='readonly',cars:[{id:'car-1',plate:PLATE,sell:kind==='equal'?item.priceWon:12000000,status:kind==='sold'?'판매완료':'판매중'}]});
  if(kind==='dirty')f.w.document.getElementById('detail-sell').value='13,000,000';
  f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.priceConfirmation.open,false);assert.equal(f.changeCalls.length,0);
  assert.deepEqual(f.tabs[0].navigations,[item.sellerUrl]);if(kind==='dirty')assert.equal(f.w.document.getElementById('detail-sell').value,'13,000,000');
 });
});

test('58 conflicting advertisement prices require selecting the intended ad instead of using the first result',async t=>{
 const f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}]}),items=[pricedListing(),pricedListing(39999000,new Date().toISOString(),'43000003')];
 f.click();await settle();f.reply(0,{...found(PLATE,items),status:'multiple'});await settle();assert.equal(f.priceConfirmation.open,true);assert.equal(f.priceChangeButton.disabled,true);
 const radios=[...f.priceConfirmation.querySelectorAll('input[type=radio]')];assert.equal(radios.length,2);assert(radios.every(radio=>!radio.checked));f.priceChangeButton.dispatchEvent(new f.w.MouseEvent('click'));assert.equal(f.changeCalls.length,0);
 radios[1].checked=true;radios[1].dispatchEvent(new f.w.Event('change'));assert.equal(f.priceChangeButton.disabled,false);f.priceChangeButton.click();await settle();assert.equal(f.changeCalls[0].listingId,'43000003');assert.equal(f.w.cars[0].sell,39999000);
});

test('59 automatic OCR price fallback runs once for a bound ad then requires review of the returned screen price',async t=>{
 const item={...pricedListing(),priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'};
 const f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}],autoPrice:({record})=>{const next=plain(record);Object.assign(next.listings[0],{priceWon:54900000,priceCheckedAt:new Date().toISOString(),priceSource:'encar.com-ocr',priceStatus:'review'});return next;}});
 f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.autoCalls.length,1);assert.equal(f.autoCalls[0].settings.listingId,item.id);assert(f.autoCalls[0].settings.signal instanceof f.w.AbortSignal);
 assert.equal(f.prices[0].textContent,'엔카 광고가 54,900,000원');assert.equal(f.priceConfirmation.open,true);assert.match(f.priceConfirmation.textContent,/엔카 광고가/);assert.equal(f.changeCalls.length,0);
 f.priceChangeButton.click();await settle();assert.equal(f.w.cars[0].sell,54900000);assert.equal(f.changeCalls[0].record.listings[0].priceStatus,'review');
});

test('60 automatic price setup failures preserve the advertising link and make the missing service explicit',async t=>{
 const f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}],autoPrice:()=>{throw Object.assign(Error('PRIVATE'),{code:'SETUP_REQUIRED'});}}),item={...pricedListing(),priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'};
 f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.autoCalls.length,1);assert.equal(f.priceConfirmation.open,false);assert.deepEqual(f.tabs[0].navigations,[item.sellerUrl]);assert.equal(f.links.length,1);
 assert.match(f.note.textContent,/자동 가격 인식 서비스 연결 설정/);assert.equal(f.note.textContent.includes('PRIVATE'),false);assert.equal(JSON.parse(f.copyFallback.value||'null'),null);
});

test('61 confirmation scope, Esc and late change responses cannot affect a new vehicle or close the drawer',async t=>{
 for(const kind of['account','company','vehicle','sell','record'])await t.test(kind,async sub=>{
  const f=fixture(sub,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000},{id:'car-2',plate:SECOND_PLATE,sell:20000000}]});f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();assert.equal(f.priceConfirmation.open,true);
  if(kind==='account')f.w.currentUser={username:'other'};if(kind==='company')f.state.storageScope='other';if(kind==='vehicle')f.w.activeCarId='car-2';if(kind==='sell')f.w.document.getElementById('detail-sell').value='14,000,000';if(kind==='record')f.w.cars[0].encarLinks=storedRecord([pricedListing(40000000)]);
  f.w.SnoteEncarLink.refresh();assert.equal(f.priceConfirmation.open,false);assert.equal(f.changeCalls.length,0);
 });
 const held=deferred(),f=fixture(t,{bridge:true,autoConfirm:true,changePrice:()=>held.promise,cars:[{id:'car-1',plate:PLATE,sell:12000000},{id:'car-2',plate:SECOND_PLATE,sell:20000000}]});f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();
 f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.priceConfirmation.open,false);assert.equal(f.w.document.getElementById('vehicle-overlay').classList.contains('open'),true);
 f.priceControls[0].click();await settle();f.w.activeCarId='car-2';f.w.SnoteEncarLink.refresh();held.resolve({ok:true,priceWon:37770000,saved:true});await settle();assert.equal(f.priceConfirmation.open,false);assert.equal(f.w.cars[1].sell,20000000);assert.equal(f.saveStatus.textContent.includes('변경했습니다'),false);
});

test('62 a reviewed price keeps its source metadata while the visible amount uses the common advertisement label',async t=>{
 const item={...pricedListing(54900000),priceStatus:'review',priceSource:'encar.com'},f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
 f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.priceConfirmation.open,true);assert.equal(f.prices[0].textContent,'엔카 광고가 54,900,000원');assert.equal(f.w.cars[0].encarLinks.listings[0].priceStatus,'review');assert.equal(f.w.cars[0].encarLinks.listings[0].priceSource,'encar.com');
 const original=f.priceConfirmation.querySelector('.snote-encar-price-confirm-original');assert.equal(original.href,item.sellerUrl);assert.equal(original.target,'_blank');assert.equal(original.rel,'noopener noreferrer');assert.equal(original.hidden,false);assert.equal(f.changeCalls.length,0);
});

test('63 safe provider diagnostics distinguish API failure without persisting or copying raw data',async t=>{
 const item={...pricedListing(),priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'},f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
 f.click();await settle();f.reply(0,{...found(PLATE,[item]),priceDiagnostics:{providerRequests:0,pageReviewCount:0,codes:[{code:'KEY_MISSING',httpStatus:null,count:1},{code:'PRIVATE_VALUE',httpStatus:200,count:1}],raw:'PRIVATE_RAW',key:'PRIVATE_KEY'}});await settle();
 assert.equal(f.priceConfirmation.open,false);assert.match(f.note.textContent,/가격 API 키 설정/);f.copyButton.click();await settle();const copied=JSON.parse(f.copyFallback.value);assert.equal(copied.code,'PRICE_API_KEY_MISSING');assert.deepEqual(copied.price,{providerRequests:0,pageReviewCount:0,codes:[{code:'KEY_MISSING',httpStatus:null,count:1}]});assert(!f.copyFallback.value.includes('PRIVATE'));
 assert.equal(Object.hasOwn(f.saveCalls[0].record,'priceDiagnostics'),false);
});

test('64 malformed automatic fallback cannot substitute a different advertisement or overwrite a planned price',async t=>{
 const item={...pricedListing(),priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'},f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}],autoPrice:({record})=>({...record,listings:[{...pricedListing(54900000,new Date().toISOString(),'43000009'),priceSource:'encar.com-ocr',priceStatus:'review'}]})});
 f.click();await settle();f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.autoCalls.length,1);assert.equal(f.priceConfirmation.open,false);assert.equal(f.w.cars[0].sell,12000000);assert.equal(f.links[0].href,item.sellerUrl);assert.match(f.note.textContent,/가격을 자동 확인하지 못/);
});

test('65 an unavailable multi-ad response never chooses an OCR target until the user selects an advertisement link',async t=>{
 const empty=id=>({...pricedListing(54900000,new Date().toISOString(),id),priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'}),items=[empty('43000001'),empty('43000003')];
 const f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}],autoPrice:({record,settings})=>{const next=plain(record);Object.assign(next.listings.find(item=>item.id===settings.listingId),{priceWon:54900000,priceCheckedAt:new Date().toISOString(),priceSource:'encar.com-ocr',priceStatus:'review'});return next;}});
 f.click();await settle();f.reply(0,{...found(PLATE,items),status:'multiple'});await settle();assert.equal(f.autoCalls.length,0);assert.equal(f.priceConfirmation.open,false);
 f.links[1].click();await settle();f.reply(1,{...found(PLATE,items),status:'multiple'});await settle();assert.equal(f.autoCalls.length,1);assert.equal(f.autoCalls[0].settings.listingId,'43000003');assert.equal(f.priceConfirmation.open,true);assert.equal(f.priceConfirmation.querySelectorAll('input[type=radio]').length,0);assert.equal(f.priceChangeButton.disabled,false);assert.equal(f.priceConfirmation.querySelector('.snote-encar-price-confirm-original').href,items[1].sellerUrl);
});

test('66 an automatic confirmation waits for another modal to close and never changes a dirty sale draft',async t=>{
 const gate=deferred(),f=fixture(t,{bridge:true,autoConfirm:true,save:()=>gate.promise,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();
 const other=f.w.document.createElement('dialog');f.w.document.body.append(other);other.showModal();gate.resolve({ok:true});await settle();assert.equal(f.priceConfirmation.open,false);other.close();await settle();assert.equal(f.priceConfirmation.open,true);f.priceCancelButton.click();
 const next=deferred();const dirty=fixture(t,{bridge:true,autoConfirm:true,save:()=>next.promise,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});dirty.click();await settle();dirty.reply(0,found(PLATE,[pricedListing()]));await settle();dirty.w.document.getElementById('detail-sell').value='13,000,000';next.resolve({ok:true});await settle();assert.equal(dirty.priceConfirmation.open,false);assert.equal(dirty.changeCalls.length,0);
});

test('67 confirmation changes are single flight and an unconfirmed save remains visibly retryable',async t=>{
 const gate=deferred(),f=fixture(t,{bridge:true,autoConfirm:true,changePrice:()=>gate.promise,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();
 f.priceChangeButton.click();f.priceChangeButton.dispatchEvent(new f.w.MouseEvent('click'));f.priceCancelButton.dispatchEvent(new f.w.MouseEvent('click'));f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.changeCalls.length,1);assert.equal(f.priceConfirmation.open,true);
 gate.resolve({ok:false});await settle();assert.equal(f.priceConfirmation.open,true);assert.equal(f.priceChangeButton.disabled,false);assert.equal(f.priceCancelButton.disabled,false);assert.match(f.priceConfirmation.querySelector('[role=status]').textContent,/변경을 확인하지 못/);assert.equal(f.w.cars[0].sell,12000000);f.priceCancelButton.click();
});

test('68 automatic price phase timeout degrades to the verified advertisement instead of hanging or changing price',async t=>{
 const gate=deferred(),item={...pricedListing(),priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'},f=fixture(t,{bridge:true,autoConfirm:true,autoTimeoutMs:3,autoPrice:()=>gate.promise,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
 f.click();await settle();f.reply(0,found(PLATE,[item]));await pause(15);await settle();assert.equal(f.autoCalls.length,1);assert.equal(f.autoCalls[0].settings.signal.aborted,true);assert.deepEqual(f.tabs[0].navigations,[item.sellerUrl]);assert.equal(f.priceConfirmation.open,false);assert.equal(f.w.cars[0].sell,12000000);assert.match(f.note.textContent,/가격 확인이 지연/);gate.resolve(storedRecord([pricedListing()]));await settle();assert.equal(f.priceConfirmation.open,false);
});

test('69 a staged price with a lost server acknowledgement keeps only the same confirmation retryable',async t=>{
 let attempt=0;const f=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}],changePrice:call=>{
  f.w.cars[0].sell=37770000;f.w.document.getElementById('detail-sell').value='37,770,000';
  if(attempt++===0)throw Error('LOST_ACK');return {ok:true,priceWon:37770000,saved:true};
 }});
 f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();f.priceChangeButton.click();await settle();await pause(300);
 assert.equal(f.priceConfirmation.open,true);assert.equal(f.priceChangeButton.disabled,false);assert.match(f.priceConfirmation.querySelector('[role=status]').textContent,/변경을 확인하지 못/);
 f.priceChangeButton.click();await settle();assert.equal(f.changeCalls.length,2);assert.equal(f.changeCalls[1].expectation.expectedSellWon,12000000);assert.equal(f.priceConfirmation.open,false);assert.equal(f.lastToast,'저장 되었습니다.');assert.doesNotMatch(f.saveStatus.textContent,/변경했습니다/);
});

test('70 stored reviewed quotes show a compact inline sale button and preserve review metadata',t=>{
 const item={...pricedListing(),trustedId:'43000002',trustedUrl:'https://fem.encar.com/cars/detail/43000002',priceStatus:'review',priceSource:'encar.com-ocr'},f=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord([item]),cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
 assert.equal(f.prices[0].textContent,'엔카 광고가 37,770,000원');assert.equal(f.priceControls[0].textContent,'판매가 변경');assert.equal(f.priceControls[0].getAttribute('aria-label'),'판매가 변경');assert.equal(f.priceControls[0].querySelector('svg'),null);assert.equal(f.w.document.querySelector('.snote-encar-price-checked').hidden,true);
 assert.equal(f.prices[0].closest('.snote-encar-price-info').previousElementSibling.textContent,'엔카 믿고');assert.equal(f.w.document.body.textContent.includes('화면에서 찾은'),false);assert.equal(f.w.cars[0].encarLinks.listings[0].priceSource,'encar.com-ocr');assert.equal(f.w.cars[0].encarLinks.listings[0].priceStatus,'review');
});

test('71 an explicit sale button saves immediately without another confirmation and refreshes the list only after ACK',async t=>{
 const held=deferred(),f=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord([pricedListing()]),cars:[{id:'car-1',plate:PLATE,sell:12000000}],changePrice:()=>held.promise});
 f.priceControls[0].click();assert.equal(f.changeCalls.length,1);assert.equal(f.applyCalls.length,0);assert.equal(f.priceConfirmation.open,false);assert.equal(f.priceControls[0].disabled,true);assert.equal(f.refreshListCalls.length,0);assert.deepEqual(f.toasts,[]);assert.equal(f.priceFeedback,null);f.priceControls[0].dispatchEvent(new f.w.MouseEvent('click'));assert.equal(f.changeCalls.length,1);
 held.resolve({ok:true,priceWon:37770000,saved:true});await settle();assert.equal(f.w.cars[0].sell,37770000);assert.equal(f.priceConfirmation.open,false);assert.equal(f.refreshListCalls.length,1);assert.equal(f.lastToast,'저장 되었습니다.');assert.equal(f.priceFeedback,null);
});

test('72 direct sale changes protect an edited price while allowing unrelated drafts',async t=>{
 const f=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord([pricedListing()]),cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
 f.w.document.getElementById('detail-sell').value='13,000,000';f.priceControls[0].click();await settle();assert.equal(f.changeCalls.length,0);assert.match(f.lastToast,/입력 중인 판매가/);assert.equal(f.priceFeedback,null);assert.equal(f.w.document.getElementById('detail-sell').value,'13,000,000');
 const memo=f.w.document.createElement('input');memo.id='detail-memo';memo.value='unsaved memo';f.w.document.getElementById('original-detail').append(memo);f.w.document.getElementById('detail-sell').value='12,000,000';f.priceControls[0].click();await settle();assert.equal(f.changeCalls.length,1);assert.equal(memo.value,'unsaved memo');assert.equal(f.changeCalls[0].expectation.expectedSellWon,12000000);
});

test('73 failed direct saves retain the original expected price and exact listing for an explicit retry',async t=>{
 let attempts=0;const items=[pricedListing(),pricedListing(39999000,new Date().toISOString(),'43000003')],f=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord(items),cars:[{id:'car-1',plate:PLATE,sell:12000000}],changePrice:()=>{
  f.w.cars[0].sell=37770000;f.w.document.getElementById('detail-sell').value='37,770,000';if(attempts++===0)throw Error('LOST_ACK');return{ok:true,priceWon:37770000,saved:true};
 }});
 f.priceControls[0].click();await settle();await pause(300);assert.equal(f.priceConfirmation.open,false);assert.equal(f.lastToast,'저장 확인이 필요합니다.');assert.equal(f.priceFeedback,null);assert.equal(f.refreshListCalls.length,0);assert.equal(f.priceControls[0].disabled,false);assert.equal(f.priceControls[1].disabled,true);assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1',items[0].id),false);f.click();assert.equal(f.openCalls.length,0);
 f.w.document.getElementById('detail-sell').value='38,000,000';assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1',items[0].id),false);f.priceControls[0].click();await settle();assert.equal(f.changeCalls.length,1);assert.match(f.lastToast,/입력 중인/);f.w.document.getElementById('detail-sell').value='37,770,000';
 f.priceControls[0].click();await settle();assert.equal(f.changeCalls.length,2);assert(f.changeCalls.every(call=>call.expectation.expectedSellWon===12000000));assert(f.changeCalls.every(call=>call.listingId===items[0].id));assert.equal(f.refreshListCalls.length,1);assert.equal(f.lastToast,'저장 되었습니다.');assert.equal(f.priceFeedback,null);
});

test('74 malformed direct save acknowledgements never claim success and keep the same expected price retryable',async t=>{
 for(const response of[{ok:false},{ok:true,priceWon:37770001,saved:true},{ok:true,priceWon:37770000,saved:false}])await t.test(JSON.stringify(response),async sub=>{
  const f=fixture(sub,{bridge:true,autoConfirm:true,applyChanged:false,savedRecord:storedRecord([pricedListing()]),cars:[{id:'car-1',plate:PLATE,sell:12000000}],changePrice:()=>response});f.priceControls[0].click();await settle();assert.equal(f.lastToast,'저장 확인이 필요합니다.');assert.equal(f.priceFeedback,null);assert.equal(f.toasts.includes('저장 되었습니다.'),false);assert.equal(f.refreshListCalls.length,0);assert.equal(f.w.cars[0].sell,12000000);f.priceControls[0].click();await settle();assert.equal(f.changeCalls[1].expectation.expectedSellWon,12000000);
 });
});

test('75 stale direct save acknowledgements cannot refresh another vehicle, account or quote',async t=>{
 for(const kind of['account','company','vehicle','record','closed'])await t.test(kind,async sub=>{
  const held=deferred(),f=fixture(sub,{bridge:true,autoConfirm:true,savedRecord:storedRecord([pricedListing()]),cars:[{id:'car-1',plate:PLATE,sell:12000000},{id:'car-2',plate:SECOND_PLATE,sell:20000000}],changePrice:()=>held.promise});f.priceControls[0].click();await settle();
  if(kind==='account')f.w.currentUser={username:'other'};if(kind==='company')f.state.storageScope='other';if(kind==='vehicle')f.w.activeCarId='car-2';if(kind==='record')f.w.cars[0].encarLinks=storedRecord([pricedListing(40000000)]);if(kind==='closed')f.closeDetail();f.w.SnoteEncarLink.refresh();held.resolve({ok:true,priceWon:37770000,saved:true});await settle();assert.equal(f.refreshListCalls.length,0);assert.equal(f.w.cars[1].sell,20000000);assert.equal(f.priceConfirmation.open,false);assert.deepEqual(f.toasts,[]);assert.equal(f.priceFeedback,null);
 });
});

test('76 public list lookup validates the open saved advertisement and opens its waiting tab synchronously',async t=>{
 const item=pricedListing(),f=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord([item]),cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
 for(const args of[['other-car',item.id],['car-1','43000009'],['car-1','javascript:bad'],['car-1',null]])assert.equal(f.w.SnoteEncarLink.lookupCurrent(...args),false);assert.equal(f.openCalls.length,0);
 f.w.document.getElementById('vehicle-overlay').setAttribute('aria-busy','true');assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1',item.id),false);f.w.document.getElementById('vehicle-overlay').setAttribute('aria-busy','false');
 assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1',item.id),true);assert.deepEqual(f.events,['open','token']);assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1',item.id),false);await settle();assert.deepEqual(JSON.parse(f.requests[0].init.body),{plate:PLATE,candidateIds:[item.id]});f.reply(0,found(PLATE,[item]));await settle();assert.equal(f.priceConfirmation.open,true);
});

test('77 saving and unavailable scopes cannot start a public list lookup or direct price save',async t=>{
 const f=fixture(t,{bridge:true,autoConfirm:true,savedRecord:storedRecord([pricedListing()]),cars:[{id:'car-1',plate:PLATE,sell:12000000}]});f.w.document.getElementById('vehicle-overlay').setAttribute('aria-busy','true');f.w.SnoteEncarLink.refresh();assert.equal(f.priceControls[0].disabled,true);f.priceControls[0].dispatchEvent(new f.w.MouseEvent('click'));assert.equal(f.changeCalls.length,0);assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1','43000001'),false);f.closeDetail();assert.equal(f.w.SnoteEncarLink.lookupCurrent('car-1','43000001'),false);assert.equal(f.openCalls.length,0);
 const noSaved=fixture(t,{bridge:true,autoConfirm:true,cars:[{id:'car-1',plate:PLATE,sell:12000000}]});assert.equal(noSaved.w.SnoteEncarLink.lookupCurrent('car-1','43000001'),false);
});

test('78 a failed toast renderer cannot turn a confirmed price save into a failed write or skip the list refresh',async t=>{
 for(const kind of['direct','confirmation'])await t.test(kind,async sub=>{
  const f=fixture(sub,{bridge:true,autoConfirm:true,...(kind==='direct'?{savedRecord:storedRecord([pricedListing()])}:{}),cars:[{id:'car-1',plate:PLATE,sell:12000000}]});
  f.w.toast=()=>{throw Error('SYNTHETIC_NOTICE_FAILURE');};
  if(kind==='confirmation'){f.click();await settle();f.reply(0,found(PLATE,[pricedListing()]));await settle();f.priceChangeButton.click();}else f.priceControls[0].click();
  await settle();assert.equal(f.w.cars[0].sell,37770000);assert.equal(f.changeCalls.length,1);assert.equal(f.refreshListCalls.length,1);assert.equal(f.priceConfirmation.open,false);assert.equal(f.priceFeedback,null);assert.equal(f.priceControls[0].disabled,false);
  f.priceControls[0].click();await settle();assert.equal(f.changeCalls.length,1,'An acknowledged save cannot become an uncertain retry when its notification fails');
 });
});
