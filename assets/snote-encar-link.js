/* S-NOTE: server-verified Encar links. No seller-account lookup. */
(() => {
  'use strict';
  if (window.SnoteEncarLink) return;

  const ENDPOINT = '/api/encar';
  const CACHE_PREFIX = 'snote.encar.candidate.v1:';
  const CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT = 45000;
  const UNVERIFIED_MESSAGES = Object.freeze({
    SEARCH_NO_RESULTS: '검색에서 광고 후보를 찾지 못했습니다. 광고 주소를 알고 있다면 아래에서 확인해 주세요.',
    SEARCH_NO_CANDIDATES: '검색 결과에서 확인할 광고 주소를 찾지 못했습니다. 광고 주소로 다시 확인할 수 있습니다.',
    PLATE_MISMATCH: '확인한 광고의 차량번호가 현재 차량과 일치하지 않습니다. 광고 주소를 다시 확인해 주세요.',
    AD_INACTIVE: '확인한 광고에서 현재 게시 중인 매물을 확인하지 못했습니다. 광고 주소를 다시 확인해 주세요.',
    DETAIL_NOT_FOUND: '광고 주소의 상세 페이지를 찾지 못했습니다. 주소를 다시 확인해 주세요.',
    CATALOG_NO_MATCH: '공개 차량 목록에서 전체 차량번호가 일치하는 후보를 확인하지 못했습니다. 광고 주소로 다시 확인할 수 있습니다.',
    NO_VERIFIED_LISTING: '확인한 후보에서 현재 차량번호와 일치하는 광고를 검증하지 못했습니다.'
  });
  const ERROR_MESSAGES = Object.freeze({
    SEARCH_NOT_CONFIGURED: '광고 검색 서비스 설정을 확인해 주세요. 관리자에게 문의해 주세요.',
    SUPABASE_NOT_CONFIGURED: '온라인 계정 연결 설정을 확인해 주세요. 관리자에게 문의해 주세요.',
    SEARCH_AUTH_FAILED: '광고 검색 서비스 인증에 실패했습니다. 관리자에게 문의해 주세요.',
    SEARCH_RATE_LIMITED: '광고 검색 요청이 많습니다. 잠시 후 다시 확인해 주세요.',
    SEARCH_QUOTA_EXCEEDED: '광고 검색 서비스의 이용 한도를 확인해 주세요. 관리자에게 문의해 주세요.',
    SEARCH_UNAVAILABLE: '광고 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    DETAIL_BLOCKED: '엔카에서 광고 확인 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',
    DETAIL_PARSE_FAILED: '광고 페이지의 정보를 읽지 못했습니다. 잠시 후 다시 확인해 주세요.',
    DETAIL_UNAVAILABLE: '광고 상세 페이지에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    AD_STATUS_UNKNOWN: '광고 상태를 확인하지 못했습니다. 진단 정보를 복사해 관리자에게 전달해 주세요.',
    CATALOG_BLOCKED: '공개 차량 목록의 접속이 제한됐습니다. 잠시 후 다시 확인해 주세요.',
    CATALOG_UNAVAILABLE: '공개 차량 목록에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',
    CATALOG_FORM_UNSUPPORTED: '공개 차량 목록의 검색 방식을 지원하지 못했습니다. 관리자에게 문의해 주세요.',
    CATALOG_PARSE_FAILED: '공개 차량 목록의 정보를 읽지 못했습니다. 관리자에게 문의해 주세요.',
    CATALOG_INCOMPLETE: '공개 차량 목록의 일부 조회를 마치지 못했습니다. 잠시 후 다시 확인해 주세요.',
    CATALOG_CONFIG_INVALID: '공개 차량 목록의 서버 설정을 확인해 주세요. 관리자에게 문의해 주세요.',
    CATALOG_PARSER_UNAVAILABLE: '공개 차량 목록의 처리 기능을 사용할 수 없습니다. 관리자에게 문의해 주세요.',
    CATALOG_LIMIT_EXCEEDED: '공개 차량 목록의 확인 범위를 초과했습니다. 관리자에게 문의해 주세요.',
    UPSTREAM_TIMEOUT: '광고 검색 또는 상세 확인 응답이 지연됐습니다. 잠시 후 다시 확인해 주세요.',
    DEADLINE_EXCEEDED: '광고 확인 시간이 초과됐습니다. 잠시 후 다시 확인해 주세요.'
  });
  const SAFE_CODES = new Set([...Object.keys(UNVERIFIED_MESSAGES), ...Object.keys(ERROR_MESSAGES),
    'METHOD_NOT_ALLOWED', 'AUTH_REQUIRED', 'AUTH_FAILED', 'STAFF_REQUIRED', 'AUTH_UNAVAILABLE',
    'INVALID_REQUEST', 'UNSUPPORTED_MEDIA_TYPE', 'REQUEST_TOO_LARGE',
    'HTTP_ERROR', 'UNVERIFIED', 'CLIENT_TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE']);
  const CATALOG_FAILURES = new Set(Object.keys(ERROR_MESSAGES).filter(code => code.startsWith('CATALOG_')));
  let active = null;
  let contextKey = '';
  let contextActor = null;
  let contextReady = false;
  let contextCar = null;
  let contextStorageKey = '', contextSavedKey = '';
  let bar, button, note, results, manual, manualInput, manualButton, manualError;
  let copyButton, copyStatus, copyFallback, saveStatus, saveRetry;
  let retryRecord = null, saveVersion = 0;
  let diagnosticSnapshot = null, feedbackVersion = 0;

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
    let storage = null;
    try { storage = window.snoteEncarLinksBridge?.context(String(car.id)) || null; } catch (_) {}
    return { car, storage, plate, key: String(car.id) + ':' + plate + ':' + String(car.ownerId || ''), actor: currentUser, ready: !!window.zc86Cloud?.ready };
  }

  function stillCurrent(job) {
    const now = currentContext();
    return active === job && now?.ready && now.key === job.key && now.actor === job.actor && now.car === job.car &&
      (now.storage?.key || '') === (job.storage?.key || '');
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

  function savedRecord(value, plate) {
    if (!value || value.version !== 1 || value.plate !== plate || !Array.isArray(value.listings) ||
        !value.listings.length || value.listings.length > 12 || typeof value.verifiedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.verifiedAt)) || Date.parse(value.verifiedAt) > Date.now() + 60000) return null;
    const listings = [];
    for (const item of value.listings) {
      if (!item || !detailUrl(item.sellerUrl, item.id)) return null;
      const trusted = String(item.trustedId) !== String(item.id) ? detailUrl(item.trustedUrl, item.trustedId) : null;
      listings.push({id: String(item.id), model: String(item.model || '').slice(0, 200),
        sellerUrl: detailUrl(item.sellerUrl, item.id), trustedId: trusted ? String(item.trustedId) : null, trustedUrl: trusted});
    }
    if (new Set(listings.map(item => item.id)).size !== listings.length) return null;
    return {version: 1, plate, verifiedAt: value.verifiedAt, listings};
  }

  function restoreSaved(context) {
    if (!context?.ready || !context.storage) return;
    const record = savedRecord(context.car.encarLinks, context.plate);
    if (!record) return;
    const expected=record.listings.flatMap(item=>[item.sellerUrl,item.trustedUrl].filter(Boolean));
    const displayed=[...results.querySelectorAll('a')].map(anchor=>anchor.href);
    if(JSON.stringify(expected)===JSON.stringify(displayed))return;
    showListings(record.listings, true);
    saveStatus.textContent = '';
    setNote('');
  }

  async function persistListings(context, record) {
    const bridge = window.snoteEncarLinksBridge;
    if (!bridge?.save || !context.storage) return false;
    if (!context.storage.canWrite) {
      saveStatus.textContent = '광고는 확인했습니다. 서버 저장은 담당 딜러 또는 관리자가 할 수 있습니다.';
      return false;
    }
    const version = ++saveVersion;
    retryRecord = record;
    saveRetry.hidden = true;
    saveStatus.textContent = '광고 링크를 서버에 저장 중…';
    const current = () => {
      const now = currentContext();
      return version === saveVersion && now?.key === context.key && now.actor === context.actor && now.ready &&
        now.car === context.car && (now.storage?.key || '') === (context.storage?.key || '');
    };
    try {
      const saved = await bridge.save(context.storage, record);
      if (!current()) return false;
      if (saved?.ok !== true) throw new Error('SAVE_NOT_CONFIRMED');
      retryRecord = null;
      saveStatus.textContent = '광고 링크를 서버에 저장했습니다.';
      return true;
    } catch (_) {
      if (current()) {
        saveStatus.textContent = '광고는 확인했지만 서버 저장을 확인하지 못했습니다.';
        saveRetry.hidden = false;
      }
      return false;
    }
  }

  function candidateFromUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (url.hostname === 'fem.encar.com') {
        const match = /^\/cars\/detail\/([1-9][0-9]{0,11})\/?$/.exec(url.pathname);
        return match?.[1] || null;
      }
      if (!['www.encar.com', 'encar.com', 'm.encar.com'].includes(url.hostname)) return null;
      if (url.hostname !== 'm.encar.com' && url.pathname !== '/dc/dc_cardetailview.do') return null;
      const ids = [...url.searchParams].filter(([key]) => key.toLowerCase() === 'carid').map(([, id]) => id);
      return ids.length === 1 && validId(ids[0]) ? ids[0] : null;
    } catch (_) { return null; }
  }

  function resetFeedback() {
    ++feedbackVersion;
    ++saveVersion;
    retryRecord = null;
    saveStatus.textContent = ''; saveRetry.hidden = true; saveRetry.disabled = false;
    diagnosticSnapshot = null;
    results.replaceChildren();
    setNote('');
    manual.hidden = true; manual.open = false; manualInput.value = ''; manualError.textContent = '';
    copyButton.hidden = true; copyButton.disabled = false; copyStatus.textContent = '';
    copyFallback.hidden = true; copyFallback.value = '';
  }

  function setDiagnostics(raw, httpStatus, fallbackCode) {
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const code = typeof data.code === 'string' && SAFE_CODES.has(data.code) ? data.code : fallbackCode;
    const safe = { service: 'snote-encar', code, httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null };
    if (typeof data.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.requestId)) safe.requestId = data.requestId;
    for (const key of ['searchCount', 'resultCount', 'candidateCount', 'checkedCount', 'plateMatchedCount', 'resultPlateMatchCount', 'rawResultCount', 'recognizedSourceCount', 'catalogRequestCount', 'catalogPageCount', 'catalogRecordCount', 'catalogExactMatchCount', 'catalogFormCount', 'catalogPlateFieldCount', 'catalogLinkCount']) {
      if (Number.isInteger(data[key]) && data[key] >= 0 && data[key] <= 1000) safe[key] = data[key];
    }
    const rejected = {};
    if (data.rejected && typeof data.rejected === 'object' && !Array.isArray(data.rejected)) {
      for (const key of ['plateMismatch', 'notAdvertising', 'notFound']) {
        if (Number.isInteger(data.rejected[key]) && data.rejected[key] >= 0 && data.rejected[key] <= 1000) rejected[key] = data.rejected[key];
      }
    }
    if (Object.keys(rejected).length) safe.rejected = rejected;
    diagnosticSnapshot = safe;
    copyButton.hidden = false;
    return code;
  }

  async function copyDiagnostics() {
    syncContext();
    if (!diagnosticSnapshot) return;
    const version = feedbackVersion, context = currentContext(), content = JSON.stringify(diagnosticSnapshot, null, 2);
    const current = () => version === feedbackVersion && currentContext()?.actor === context?.actor && currentContext()?.key === context?.key && currentContext()?.ready;
    copyButton.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(content);
      if (current()) copyStatus.textContent = '진단 정보를 복사했습니다.';
    } catch (_) {
      if (current()) {
        copyFallback.value = content; copyFallback.hidden = false; copyFallback.focus(); copyFallback.select();
        copyStatus.textContent = '선택된 진단 정보를 복사해 주세요.';
      }
    } finally { if (current()) copyButton.disabled = false; }
  }

  function lookupError(message, code = 'INVALID_RESPONSE') {
    const error = new Error(message); error.userMessage = message; error.diagnosticCode = code; return error;
  }

  function renderLookupButton(busy = false) {
    button.setAttribute('aria-label', '엔카광고보기');
    button.removeAttribute('title');
    button.setAttribute('data-tooltip', '엔카광고보기');
    button.setAttribute('aria-busy', String(busy));
    button.classList.toggle('is-loading', busy);
    if (button.querySelector('img.snote-encar-wordmark')) return;
    const logo = document.createElement('img');
    logo.className = 'snote-encar-wordmark';
    logo.src = 'assets/encar-wordmark.png?v=2.73';
    logo.width = 34; logo.height = 17;
    logo.alt = ''; logo.setAttribute('aria-hidden', 'true');
    logo.draggable = false;
    button.replaceChildren(logo);
  }

  function closeWaitingTab(job) {
    if (!job?.waitingTab) return;
    try { if (!job.waitingTab.closed) job.waitingTab.close(); } catch (_) {}
    job.waitingTab = null;
  }

  function cancel() {
    if (active) {
      active.controller.abort();
      closeWaitingTab(active);
    }
    active = null;
    resetFeedback();
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
    if(button)button.hidden=context?.car.status==='판매완료';
    const savedKey=JSON.stringify(savedRecord(context?.car.encarLinks,context?.plate));
    const nextKey = context?.key || '';
    if (nextKey !== contextKey || (context?.actor || null) !== contextActor || !!context?.ready !== contextReady || (context?.car || null) !== contextCar || (context?.storage?.key || '') !== contextStorageKey) {
      cancel();
      contextKey = nextKey;
      contextActor = context?.actor || null;
      contextReady = !!context?.ready;
      contextCar = context?.car || null;
      contextStorageKey = context?.storage?.key || '';
      contextSavedKey = savedKey;
      button.disabled = !context?.plate || !context?.ready;
      renderLookupButton();
      restoreSaved(context);
    }
    if(!active&&savedKey!==contextSavedKey){contextSavedKey=savedKey;if(savedKey!=='null')restoreSaved(context);else results.replaceChildren();}
  }

  function resetContext() {
    cancel();
    contextKey = '';
    contextActor = null;
    contextReady = false;
    contextCar = null;
    contextStorageKey = '';contextSavedKey='';
    button.disabled = true;
    renderLookupButton();
  }

  function prepareTab() {
    // Open during the user's click; do not use the noopener feature here,
    // because that would discard the handle required for later navigation.
    let tab;
    try { tab = window.open('about:blank', '_blank'); } catch (_) { return null; }
    if (!tab) return null;
    try {
      tab.opener = null;
      tab.document.title = '엔카 광고 확인 중';
      const viewport=tab.document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';tab.document.head.append(viewport);
      const style=tab.document.createElement('style');style.textContent=`
       *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:28px;background:#f6f8fb;color:#253449;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
       main{text-align:center;width:min(100%,620px)}.scene{position:relative;margin:0 auto 28px;width:230px;height:130px;overflow:hidden}.road{position:absolute;left:0;right:0;bottom:20px;height:1px;background:#dae2eb}.car{position:absolute;left:42px;top:35px;width:135px;height:64px;color:#567a9e;animation:drive 2.6s ease-in-out infinite}.scan{position:absolute;width:55px;height:55px;border:3px solid #ed6372;border-radius:50%;left:140px;top:15px;animation:scan 2.6s ease-in-out infinite}.scan:after{content:'';position:absolute;width:24px;height:3px;background:#ed6372;right:-18px;bottom:-8px;transform:rotate(45deg);border-radius:4px}
       h1{font-size:clamp(20px,4.5vw,28px);font-weight:700;letter-spacing:-1px;line-height:1.5;margin:0 0 12px;word-break:keep-all}p{font-size:14px;color:#8c98a8;line-height:1.7;margin:0}.dots{display:flex;justify-content:center;gap:7px;margin-top:25px}.dots i{width:6px;height:6px;border-radius:50%;background:#9eb2c8;animation:pulse 1.3s ease-in-out infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
       @keyframes drive{0%,100%{transform:translateX(-9px)}50%{transform:translateX(9px)}}@keyframes scan{0%,100%{transform:translateX(-40px)}50%{transform:translateX(4px)}}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
      `;tab.document.head.append(style);
      const content=tab.document.createElement('main');content.setAttribute('role','status');content.setAttribute('aria-live','polite');
      content.innerHTML='<div class="scene" aria-hidden="true"><div class="road"></div><svg class="car" viewBox="0 0 140 65" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 43v-17l19-4 14-15h42l17 20 17 5v14H15zM37 22h58M53 8l-9 14M86 8l9 14M112 33h8"/><circle cx="38" cy="45" r="10" fill="#f6f8fb"/><circle cx="103" cy="45" r="10" fill="#f6f8fb"/></svg><div class="scan"></div></div><h1>해당 차량의 엔카 광고를 찾고 있어요!</h1><p>차량번호와 광고 정보를 확인하고 있어요.<br>확인이 끝나면 광고 페이지로 이동합니다.</p><div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>';
      tab.document.body.replaceChildren(content);
    } catch (_) { /* The result links remain available in S-NOTE. */ }
    return tab;
  }

  function showListings(listings, recheck = false) {
    results.replaceChildren();
    for (const item of listings) {
      const seller = detailUrl(item.sellerUrl, item.id);
      const trusted = String(item.trustedId) !== String(item.id) ? detailUrl(item.trustedUrl, item.trustedId) : null;
      if (!seller) continue;
      const row = document.createElement('div');
      row.className = 'snote-encar-result';
      const label = document.createElement('span');
      if (listings.length > 1) { label.textContent = String(item.model || '') + ' · ' + item.id; row.append(label); }
      for (const [text, url] of [['판매자 광고', seller], ['엔카 믿고', trusted]]) {
        if (!url) continue;
        const anchor = document.createElement('a');
        anchor.textContent = text;
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        if (recheck) anchor.addEventListener('click', event => {
          event.preventDefault();
          if (active) return;
          const id = text === '엔카 믿고' ? String(item.trustedId) : String(item.id);
          lookup([...new Set([String(item.id), id])], {sellerId: String(item.id), id, trusted: text === '엔카 믿고'});
        });
        row.append(anchor);
      }
      results.append(row);
    }
  }

  async function lookup(manualIds = null, selectedLink = null) {
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
    restoreSaved(context);
    const job = {...context, controller: new AbortController(), waitingTab: prepareTab(), timedOut: false};
    active = job;
    button.disabled = true;
    renderLookupButton(true);
    setNote('차량번호와 광고 상태를 확인하고 있습니다.');
    const timeout = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, REQUEST_TIMEOUT);
    try {
      const token = await abortable(window.zc86Cloud.getAccessToken(), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!token) throw lookupError('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.', 'AUTH_REQUIRED');
      const response = await abortable(fetch(ENDPOINT, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token},
        body: JSON.stringify({plate: context.plate, candidateIds: manualIds === null ?
          [...new Set([...(savedRecord(context.car.encarLinks, context.plate)?.listings.map(item => item.id) || []), ...readCandidates(context.plate)])].slice(0, 12) : manualIds}),
        signal: job.controller.signal,
        cache: 'no-store',
        credentials: 'same-origin'
      }), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      job.httpStatus = response.status;
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw lookupError('엔카 조회 기능이 아직 연결되지 않았습니다. 관리자에게 문의해 주세요.');
      }
      const data = await abortable(response.json(), job.controller.signal);
      if (!stillCurrent(job)) { closeWaitingTab(job); return; }
      if (!response.ok || data?.status === 'error') {
        const messages = {
          401: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
          403: '이 기능을 사용할 수 있는 직원 권한을 확인해 주세요.',
          503: '엔카 조회 기능의 서버 설정이 필요합니다. 관리자에게 문의해 주세요.'
        };
        const code = setDiagnostics(data?.diagnostics, response.status, 'HTTP_ERROR');
        if (response.status >= 500 && CATALOG_FAILURES.has(code)) manual.hidden = false;
        throw lookupError(ERROR_MESSAGES[code] || messages[response.status] || '지금은 광고를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.plate !== context.plate || !Array.isArray(data.listings) || !['found','multiple','unverified'].includes(data.status)) {
        throw lookupError('광고 확인 응답이 올바르지 않습니다. 다시 시도해 주세요.');
      }
      const listings = data.listings;
      if (data.status === 'unverified') {
        if (listings.length) throw lookupError('광고 확인 응답이 올바르지 않습니다. 다시 시도해 주세요.');
        closeWaitingTab(job);
        if (manualIds === null) { try { localStorage.removeItem(CACHE_PREFIX + context.plate); } catch (_) {} }
        const code = setDiagnostics(data.diagnostics, response.status, 'UNVERIFIED');
        setNote(UNVERIFIED_MESSAGES[code] || '일치하는 현재 광고를 확인하지 못했습니다. 나중에 다시 확인해 주세요.');
        manual.hidden = false;
        return;
      }
      if (!listings.length || listings.some(item => !item || !detailUrl(item.sellerUrl, item.id)) ||
          (data.status === 'found' && listings.length !== 1) || (data.status === 'multiple' && listings.length < 2) ||
          !data.verifiedAt || !Number.isFinite(Date.parse(data.verifiedAt))) {
        throw lookupError('광고 검증 결과를 확인할 수 없습니다. 다시 시도해 주세요.');
      }
      saveCandidates(context.plate, listings);
      showListings(listings);
      const record = savedRecord({version: 1, plate: context.plate, verifiedAt: data.verifiedAt, listings}, context.plate);
      if (record) void persistListings(context, record);
      if (selectedLink) {
        const selected = listings.find(item => String(item.id) === selectedLink.sellerId);
        const selectedUrl = selected && (selectedLink.trusted ?
          (String(selected.trustedId) === selectedLink.id && detailUrl(selected.trustedUrl, selectedLink.id)) : detailUrl(selected.sellerUrl, selectedLink.id));
        if (!selectedUrl) {
          closeWaitingTab(job);
          setNote('저장된 광고의 상태가 변경되었습니다. 확인된 링크를 선택해 주세요.');
        } else if (job.waitingTab && !job.waitingTab.closed) {
          job.waitingTab.location.replace(selectedUrl); job.waitingTab = null;
          setNote('저장된 광고를 다시 확인해 열었습니다.');
        } else setNote('광고를 확인했습니다. 링크를 눌러 열어 주세요.');
        return;
      }
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
        setNote('광고를 확인했습니다. 링크를 눌러 열어 주세요.');
      }
    } catch (error) {
      closeWaitingTab(job);
      if (!stillCurrent(job)) return;
      if (!diagnosticSnapshot) setDiagnostics(null, job.httpStatus, job.timedOut ? 'CLIENT_TIMEOUT' : error?.diagnosticCode || 'NETWORK_ERROR');
      setNote(job.timedOut ? '확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : error?.userMessage || '광고 확인에 실패했습니다. 연결 상태를 확인하고 다시 시도해 주세요.', true);
    } finally {
      clearTimeout(timeout);
      if (active === job) {
        active = null;
        button.disabled = !currentContext()?.ready;
        renderLookupButton();
        syncContext();
      }
    }
  }

  function verifyManual(event) {
    event.preventDefault();
    syncContext();
    if (manual.hidden || active) return;
    const id = candidateFromUrl(manualInput.value);
    if (!id) {
      manualError.textContent = '엔카 광고의 HTTPS 주소를 확인해 주세요.';
      manualInput.focus();
      return;
    }
    manualError.textContent = '';
    lookup([id]);
  }

  function mount() {
    const overlay = document.getElementById('vehicle-overlay');
    const meta = document.getElementById('vehicle-meta');
    if (!overlay || !meta) return;
    const style = document.createElement('style');
    style.textContent = '.snote-encar-tools{margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;font-size:12px;line-height:1.6}.snote-encar-button,.snote-encar-manual button{border:1px solid #bae1f5;background:#eef9ff;color:#187bac;padding:7px 12px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer}.snote-encar-button:disabled{opacity:.6;cursor:wait}.snote-encar-note,.snote-encar-copy-status{color:#63758a}.snote-encar-note[data-error=true],.snote-encar-manual-error{color:#b54747}.snote-encar-results{flex-basis:100%;display:grid;gap:6px}.snote-encar-result{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.snote-encar-result span{color:#64748b}.snote-encar-result a{color:#187bac;font-weight:700;text-decoration:underline;text-underline-offset:3px}.snote-encar-manual{flex-basis:100%;min-width:0;max-width:100%}.snote-encar-manual summary{cursor:pointer;color:#187bac;font-weight:700}.snote-encar-manual form{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;min-width:0}.snote-encar-manual label,.snote-encar-manual-error{flex-basis:100%}.snote-encar-manual input{flex:1 1 180px;min-width:0;max-width:100%;border:1px solid #d6e2ee;border-radius:8px;padding:8px;font:inherit;background:white;color:#334155}.snote-encar-save-status{flex-basis:100%;color:#64748b;font-size:11px}.snote-encar-save-status:empty{display:none}.snote-encar-save-retry{border:1px solid #d6e2ee;border-radius:8px;background:#fff;color:#187bac;padding:5px 10px;font:inherit;cursor:pointer}.snote-encar-save-retry:disabled{opacity:.6;cursor:wait}.snote-encar-copy{padding:2px 0;border:0;background:transparent;color:#63758a;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.snote-encar-copy-fallback{flex-basis:100%;min-width:0;max-width:100%;box-sizing:border-box;height:120px;padding:8px;border:1px solid #d6e2ee;border-radius:8px;font:11px/1.5 monospace;overflow-wrap:anywhere;white-space:pre-wrap}.snote-encar-tools [hidden]{display:none!important}.snote-encar-tools :is(button,a,input,summary,textarea):focus-visible{outline:2px solid #38bdf8;outline-offset:3px}';
    style.textContent += '.snote-encar-button{display:inline-grid;place-items:center;width:44px;height:44px;padding:0;border-radius:12px;color:#d52c3b}.snote-encar-button svg{display:block;width:22px;height:22px}.snote-encar-button.is-loading{cursor:wait;opacity:.6}';
    document.head.append(style);
    bar = document.createElement('div');
    bar.className = 'snote-encar-tools';
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'snote-encar-button vehicle-header-action';
    renderLookupButton();
    button.disabled = true;
    button.addEventListener('click', () => lookup());
    note = document.createElement('span');
    note.className = 'snote-encar-note';
    note.setAttribute('role','status');
    note.setAttribute('aria-live','polite');
    results = document.createElement('div');
    results.className = 'snote-encar-results';
    saveStatus = document.createElement('span'); saveStatus.className = 'snote-encar-save-status'; saveStatus.setAttribute('role', 'status');
    saveRetry = document.createElement('button'); saveRetry.type = 'button'; saveRetry.className = 'snote-encar-save-retry'; saveRetry.textContent = '링크 저장 다시 시도'; saveRetry.hidden = true;
    saveRetry.addEventListener('click', async () => {
      const context = currentContext(), record = retryRecord;
      if (!context || !record || active) return;
      saveRetry.disabled = true;
      await persistListings(context, record);
      if (currentContext()?.key === context.key && currentContext()?.actor === context.actor) saveRetry.disabled = false;
    });
    manual = document.createElement('details'); manual.className = 'snote-encar-manual'; manual.hidden = true;
    const summary = document.createElement('summary'); summary.textContent = '광고 주소로 확인';
    const form = document.createElement('form'); form.noValidate = true; form.addEventListener('submit', verifyManual);
    const label = document.createElement('label'); label.htmlFor = 'snote-encar-manual-url'; label.textContent = '엔카 광고 주소';
    manualInput = document.createElement('input'); manualInput.id = 'snote-encar-manual-url'; manualInput.type = 'url'; manualInput.inputMode = 'url'; manualInput.maxLength = 2048; manualInput.autocomplete = 'off'; manualInput.spellcheck = false; manualInput.placeholder = 'https://fem.encar.com/cars/detail/…';
    manualButton = document.createElement('button'); manualButton.type = 'submit'; manualButton.textContent = '주소 확인';
    manualError = document.createElement('span'); manualError.className = 'snote-encar-manual-error'; manualError.setAttribute('role', 'status');
    form.append(label, manualInput, manualButton, manualError); manual.append(summary, form);
    copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.className = 'snote-encar-copy'; copyButton.textContent = '진단 정보 복사'; copyButton.hidden = true; copyButton.addEventListener('click', copyDiagnostics);
    copyStatus = document.createElement('span'); copyStatus.className = 'snote-encar-copy-status'; copyStatus.setAttribute('role', 'status');
    copyFallback = document.createElement('textarea'); copyFallback.className = 'snote-encar-copy-fallback'; copyFallback.readOnly = true; copyFallback.hidden = true; copyFallback.setAttribute('aria-label', '복사할 진단 정보');
    bar.append(note, saveStatus, saveRetry, manual, copyButton, copyStatus, copyFallback);
    meta.insertAdjacentElement('afterend', bar);
    const title = document.getElementById('vehicle-title');
    if (title) title.insertAdjacentElement('afterend', results);
    else bar.append(results);
    const headerActions = document.getElementById('vehicle-header-actions');
    if (headerActions) headerActions.prepend(button);
    else bar.prepend(button);
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
