/* S-NOTE: verified Encar links, plate input only. No seller-account lookup. */
(() => {
  'use strict';
  if (window.SnoteEncarLink) return;

  const ENDPOINT = '/api/encar';
  const CACHE_PREFIX = 'snote.encar.candidate.v1:';
  const CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT = 45000;
  let active = null;
  let contextKey = '';
  let contextActor = null;
  let contextReady = false;
  let bar, button, note, results;

  function normalizePlate(value) {
    return String(value || '').normalize('NFKC').replace(/[\s-]+/g, '');
  }

  function validId(value) {
    return /^[1-9][0-9]{0,11}$/.test(String(value ?? ''));
  }

  function currentContext() {
    const overlay = document.getElementById('vehicle-overlay');
    if (!overlay?.classList.contains('open')) return null;
    if (typeof activeCarId === 'undefined' || typeof cars === 'undefined') return null;
    if (typeof currentUser === 'undefined' || !currentUser) return null;
    const car = cars.find(item => item.id === activeCarId);
    if (!car) return null;
    const plate = normalizePlate(car.plate);
    return { plate, key: String(car.id) + ':' + plate, actor: currentUser, ready: !!window.zc86Cloud?.ready };
  }

  function stillCurrent(job) {
    const now = currentContext();
    return active === job && now?.ready && now.key === job.key && now.actor === job.actor;
  }

  function readCandidates(plate) {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_PREFIX + plate) || 'null');
      if (!saved || saved.plate !== plate || !Number.isFinite(saved.at)) return [];
      if (Date.now() - saved.at > CACHE_AGE || saved.at > Date.now() + 60000) return [];
      return [...new Set((saved.ids || []).map(String).filter(validId))].slice(0,6);
    } catch (_) { return []; }
  }

  function saveCandidates(plate, listings) {
    const ids = [...new Set(listings.map(item => String(item.id)))].filter(validId);
    if (!ids.length) return;
    try {
      localStorage.setItem(CACHE_PREFIX + plate, JSON.stringify({plate, ids: ids.slice(0,6), at: Date.now()}));
    } catch (_) { /* Storage is optional; every candidate is verified by the server. */ }
  }

  function detailUrl(value, id) {
    if (!validId(id)) return null;
    const expected = 'https://fem.encar.com/cars/detail/' + String(id);
    return value === expected ? expected : null;
  }

  function closeWaitingTab(job) {
    if (!job?.waitingTab) return;
    try { if (!job.waitingTab.closed) job.waitingTab.close(); } catch (_) {}
    job.waitingTab = null;
  }

  function cancel() {
    if (!active) return;
    active.controller.abort();
    closeWaitingTab(active);
    active = null;
  }

  function setNote(message, isError = false) {
    note.textContent = message;
    note.dataset.error = isError ? 'true' : 'false';
  }

  function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        reject(new DOMException('요청이 취소되었습니다.', 'AbortError'));
      };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, {once:true});
      Promise.resolve(promise).then(value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      }, error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
    });
  }

  function syncContext() {
    const context = currentContext();
    const nextKey = context?.key || '';
    if (nextKey !== contextKey || (context?.actor || null) !== contextActor || !!context?.ready !== contextReady) {
      cancel();
      contextKey = nextKey;
      contextActor = context?.actor || null;
      contextReady = !!context?.ready;
      results.replaceChildren();
      setNote('');
      button.disabled = !context?.plate || !context?.ready;
      button.textContent = '엔카 광고 보기';
    }
  }

  function resetContext() {
    cancel();
    contextKey = '';
    contextActor = null;
    contextReady = false;
    results.replaceChildren();
    setNote('');
    button.disabled = true;
    button.textContent = '엔카 광고 보기';
  }

  function prepareTab() {
    // Open during the user's click; do not use the noopener feature here,
    // because that would discard the handle required for later navigation.
    const tab = window.open('about:blank', '_blank');
    if (!tab) return null;
    try {
      tab.opener = null;
      tab.document.title = '엔카 광고 확인 중';
      const message = tab.document.createElement('p');
      message.textContent = '차량번호와 일치하는 광고를 확인하고 있습니다. 잠시만 기다려 주세요.';
      message.style.cssText = 'font:16px/1.8 system-ui,sans-serif;max-width:560px;margin:72px auto;padding:24px;color:#334155';
      tab.document.body.replaceChildren(message);
    } catch (_) { /* The result links remain available in S-NOTE. */ }
    return tab;
  }

  function showListings(listings) {
    results.replaceChildren();
    for (const item of listings) {
      const seller = detailUrl(item.sellerUrl, item.id);
      const trusted = detailUrl(item.trustedUrl, item.trustedId);
      if (!seller) continue;
      const row = document.createElement('div');
      row.className = 'snote-encar-result';
      const label = document.createElement('span');
      label.textContent = listings.length > 1 ? (String(item.model || '확인된 광고') + ' · ' + item.id) : '확인된 광고';
      row.append(label);
      for (const [text, url] of [['판매자 광고', seller], ['엔카 믿고', trusted]]) {
        if (!url) continue;
        const anchor = document.createElement('a');
        anchor.textContent = text;
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        row.append(anchor);
      }
      results.append(row);
    }
  }

  async function lookup() {
    syncContext();
    const context = currentContext();
    if (!context || !/^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(context.plate)) {
      setNote('차량번호를 확인해 주세요.', true);
      return;
    }
    if (!window.zc86Cloud?.ready) {
      setNote('S-NOTE 온라인 로그인 후 사용할 수 있습니다.', true);
      return;
    }
    cancel();
    const job = {...context, controller: new AbortController(), waitingTab: prepareTab(), timedOut: false};
    active = job;
    button.disabled = true;
    button.textContent = '광고 확인 중…';
    results.replaceChildren();
    setNote('차량번호와 광고 상태를 확인하고 있습니다.');
    const timeout = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, REQUEST_TIMEOUT);
    try {
      const token = await abortable(window.zc86Cloud.getAccessToken(), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      const response = await abortable(fetch(ENDPOINT, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token},
        body: JSON.stringify({plate: context.plate, candidateIds: readCandidates(context.plate)}),
        signal: job.controller.signal,
        cache: 'no-store',
        credentials: 'same-origin'
      }), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('엔카 조회 기능이 아직 연결되지 않았습니다. 관리자에게 문의해 주세요.');
      }
      const data = await abortable(response.json(), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!response.ok || data.status === 'error') {
        const messages = {
          401: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
          403: '이 기능을 사용할 수 있는 직원 권한을 확인해 주세요.',
          503: '엔카 조회 기능의 서버 설정이 필요합니다. 관리자에게 문의해 주세요.'
        };
        throw new Error(messages[response.status] || '지금은 광고를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
      if (data.plate !== context.plate || !Array.isArray(data.listings) || !['found','multiple','unverified'].includes(data.status)) {
        throw new Error('광고 확인 응답이 올바르지 않습니다. 다시 시도해 주세요.');
      }
      const listings = data.listings;
      if (data.status === 'unverified') {
        if (listings.length) throw new Error('광고 확인 응답이 올바르지 않습니다. 다시 시도해 주세요.');
        closeWaitingTab(job);
        try { localStorage.removeItem(CACHE_PREFIX + context.plate); } catch (_) {}
        setNote('일치하는 현재 광고를 확인하지 못했습니다. 나중에 다시 확인해 주세요.');
        return;
      }
      if (!listings.length || listings.some(item => !item || !detailUrl(item.sellerUrl, item.id)) ||
          (data.status === 'found' && listings.length !== 1) || (data.status === 'multiple' && listings.length < 2) ||
          !data.verifiedAt || !Number.isFinite(Date.parse(data.verifiedAt))) {
        throw new Error('광고 검증 결과를 확인할 수 없습니다. 다시 시도해 주세요.');
      }
      saveCandidates(context.plate, listings);
      showListings(listings);
      if (data.status === 'multiple' || listings.length !== 1) {
        closeWaitingTab(job);
        setNote('같은 차량번호의 광고가 여러 개입니다. 열 광고를 선택해 주세요.');
        return;
      }
      const url = detailUrl(listings[0].sellerUrl, listings[0].id);
      if (job.waitingTab && !job.waitingTab.closed) {
        job.waitingTab.location.replace(url);
        job.waitingTab = null;
        setNote('차량번호가 일치하는 광고를 열었습니다.');
      } else {
        setNote('광고를 확인했습니다. 아래 링크를 눌러 열어 주세요.');
      }
    } catch (error) {
      closeWaitingTab(job);
      if (!stillCurrent(job)) return;
      setNote(job.timedOut ? '확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : String(error?.message || '광고 확인에 실패했습니다.').slice(0,220), true);
    } finally {
      clearTimeout(timeout);
      if (active === job) {
        active = null;
        button.disabled = !currentContext()?.ready;
        button.textContent = '엔카 광고 보기';
        syncContext();
      }
    }
  }

  function mount() {
    const overlay = document.getElementById('vehicle-overlay');
    const meta = document.getElementById('vehicle-meta');
    if (!overlay || !meta) return;
    const style = document.createElement('style');
    style.textContent = '.snote-encar-tools{margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;line-height:1.6}.snote-encar-button{border:1px solid #bae1f5;background:#eef9ff;color:#187bac;padding:7px 12px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer}.snote-encar-button:disabled{opacity:.6;cursor:wait}.snote-encar-note{color:#63758a}.snote-encar-note[data-error=true]{color:#b54747}.snote-encar-results{flex-basis:100%;display:grid;gap:6px}.snote-encar-result{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.snote-encar-result span{color:#64748b}.snote-encar-result a{color:#187bac;font-weight:700;text-decoration:underline;text-underline-offset:3px}.snote-encar-button:focus-visible,.snote-encar-result a:focus-visible{outline:2px solid #38bdf8;outline-offset:3px}';
    document.head.append(style);
    bar = document.createElement('div');
    bar.className = 'snote-encar-tools';
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'snote-encar-button';
    button.textContent = '엔카 광고 보기';
    button.disabled = true;
    button.addEventListener('click', lookup);
    note = document.createElement('span');
    note.className = 'snote-encar-note';
    note.setAttribute('role','status');
    note.setAttribute('aria-live','polite');
    results = document.createElement('div');
    results.className = 'snote-encar-results';
    bar.append(button, note, results);
    meta.insertAdjacentElement('afterend', bar);
    new MutationObserver(syncContext).observe(overlay, {attributes:true,attributeFilter:['class']});
    new MutationObserver(syncContext).observe(meta, {childList:true,subtree:true,characterData:true});
    for (const id of ['zc-cloud-gate', 'zc86-topbar']) {
      const element = document.getElementById(id);
      if (element) new MutationObserver(syncContext).observe(element, {attributes:true,attributeFilter:['hidden']});
    }
    const cloudStatus = document.getElementById('zc-cloud-status');
    if (cloudStatus) new MutationObserver(syncContext).observe(cloudStatus, {
      attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true
    });
    window.addEventListener('pagehide', resetContext);
    window.addEventListener('pageshow', syncContext);
    window.SnoteEncarLink = Object.freeze({refresh: syncContext});
    syncContext();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
