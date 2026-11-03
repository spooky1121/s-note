(function () {
  'use strict';

  const API = '/api/customer-intake';
  const FLOW = 'wizard-v1';
  const REQUEST_TIMEOUT = 45000;
  const $ = id => document.getElementById(id);
  const stages = ['car', 'details', 'success', 'terminal'];
  const steps = ['name', 'rrn', 'address', 'phone', 'refund', 'consent'];
  const stepLabels = {name: '성함', rrn: '주민등록번호', address: '등본상 주소', phone: '휴대전화 확인', refund: '환급계좌', consent: '동의·손서명'};
  const headings = {name: 'details-heading', rrn: 'rrn-heading', address: 'address-heading', phone: 'verify-heading', refund: 'refund-heading', consent: 'consent-heading'};
  const fieldSteps = {'customer-name': 'name', 'rrn-front': 'rrn', 'rrn-back': 'rrn', 'address-base': 'address', 'address-detail': 'address', 'mailing-base': 'address', 'mailing-detail': 'address', 'customer-phone': 'phone', 'verification-code': 'phone', 'refund-bank': 'refund', 'refund-account': 'refund', 'refund-holder': 'refund', 'required-consent': 'consent', 'refund-consent': 'consent', 'signature-canvas': 'consent'};
  const customerKeys = {name: 'customer-name', addressBase: 'address-base', addressDetail: 'address-detail', mailingBase: 'mailing-base', mailingDetail: 'mailing-detail', refundBank: 'refund-bank', refundAccount: 'refund-account', refundHolder: 'refund-holder'};
  const form = $('customer-form'), fields = $('customer-fields');
  const canvas = $('signature-canvas'), context = canvas.getContext('2d');
  let token = '', session = '', verifiedPhone = '', challengeId = '', challengePhone = '', phoneDraft = '';
  let challengeExpiresAt = 0, cooldownUntil = 0, submitRetryUntil = 0;
  let pendingSubmission = null, uncertainSubmission = false;
  let stage = '', step = 'name', busy = '', activeController = null, ticker = null;
  let disposed = false, addressSession = null, historyReady = false, pageEpoch = 0, resumeInfo = false;
  let signatureStrokes = [], activePointer = null, signatureOverflow = false;

  class ApiError extends Error {
    constructor(text, code, status, retryAfter, uncertain) {
      super(text);
      this.code = code || 'SERVER_ERROR';
      this.status = status || 0;
      this.retryAfter = Number.isFinite(Number(retryAfter)) ? Math.max(0, Math.min(86400, Number(retryAfter))) : 0;
      this.uncertain = !!uncertain;
    }
  }

  function message(text, tone, focus) {
    const box = $('status-message');
    box.textContent = text || '';
    box.hidden = !text;
    box.dataset.tone = tone || 'info';
    box.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    if (text && focus) box.focus({preventScroll: false});
  }

  function writeHistory(mode) {
    if (!historyReady) return;
    const value = {snoteIntake: FLOW, screen: stage, step};
    try { window.history[mode === 'push' ? 'pushState' : 'replaceState'](value, '', location.pathname); } catch (_) { /* Navigation still works without history support. */ }
  }

  function showStage(next, focus, mode) {
    if (next !== 'details' || step !== 'address') closeAddressSearch(false);
    stage = next;
    $('load-state').hidden = true;
    for (const name of stages) $('stage-' + name).hidden = name !== next;
    $('progress').hidden = next !== 'details';
    document.querySelectorAll('[data-wizard-step]').forEach(panel => { panel.hidden = next !== 'details' || panel.dataset.wizardStep !== step; });
    if (next === 'details') {
      $('progress-label').textContent = stepLabels[step];
      $('progress-count').textContent = (steps.indexOf(step) + 1) + ' / ' + steps.length;
      $('progress-bar').value = steps.indexOf(step) + 1;
      if (step === 'consent') renderSummary();
    }
    updateControls();
    writeHistory(mode);
    if (focus) $(next === 'details' ? headings[step] : next === 'car' ? 'vehicle-heading' : next === 'success' ? 'success-heading' : 'terminal-heading').focus({preventScroll: false});
    if (next === 'details' && step === 'consent') window.requestAnimationFrame(resizeSignature);
  }

  function showStep(next, focus, mode) {
    if (!steps.includes(next)) return;
    step = next;
    showStage('details', focus, mode || 'push');
  }

  function remaining(until) { return Math.max(0, Math.ceil((until - Date.now()) / 1000)); }
  function phoneValue(value) {
    let result = String(value || '').trim().replace(/[ ()-]/g, '');
    if (result.startsWith('+82')) result = '0' + result.slice(3);
    return result;
  }
  function validPhone(value) { return /^(?:010\d{8}|01[16789]\d{7,8})$/.test(value); }
  function phoneText(value) { return value.length === 11 ? value.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3') : value.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3'); }
  function phoneVerified() { return !!session && !!verifiedPhone && phoneValue($('customer-phone').value) === verifiedPhone; }

  function updateControls() {
    const locked = !!busy || uncertainSubmission, cooldown = remaining(cooldownUntil), retry = remaining(submitRetryUntil);
    $('vehicle-confirmed').disabled = locked;
    $('vehicle-next').disabled = locked || !$('vehicle-confirmed').checked;
    fields.disabled = locked;
    syncMailing();
    $('request-code').disabled = locked || cooldown > 0 || !validPhone(phoneValue($('customer-phone').value)) || !token;
    $('request-code').hidden = phoneVerified();
    $('request-code').textContent = busy === 'send' ? '인증번호 요청 중…' : cooldown ? cooldown + '초 후 다시 요청' : challengeId ? '인증번호 다시 받기' : '인증번호 받기';
    $('verify-form').hidden = !challengeId || phoneVerified();
    $('verification-code').disabled = locked || !challengeId;
    $('verify-button').disabled = locked || !challengeId || !/^\d{6}$/.test($('verification-code').value);
    $('verify-button').textContent = busy === 'verify' ? '인증번호 확인 중…' : '인증번호 확인';
    $('verified-note').hidden = !phoneVerified();
    $('wizard-prev').disabled = locked;
    $('wizard-next').hidden = step === 'consent';
    $('wizard-next').disabled = locked || (step === 'phone' && !phoneVerified());
    $('submit-customer').hidden = step !== 'consent';
    $('submit-customer').disabled = !!busy || retry > 0;
    $('submit-customer').textContent = busy === 'submit' ? '접수 결과 확인 중…' : retry ? retry + '초 후 다시 제출' : uncertainSubmission ? '접수 결과 다시 확인' : '동의하고 접수하기';
    $('signature-clear').disabled = locked || !signatureStrokes.length;
    canvas.dataset.locked = String(locked);
    canvas.setAttribute('aria-disabled', String(locked));
    $('retry-info').disabled = !!busy;
    document.querySelectorAll('[data-address-search]').forEach(button => {
      button.disabled = locked || stage !== 'details' || step !== 'address' || !token || (button.dataset.addressSearch === 'mailing' && $('same-address').checked);
    });
    $('send-timing').textContent = cooldown && !phoneVerified() ? '인증번호 재요청은 잠시 후 가능합니다.' : '';
    if (challengeId && challengeExpiresAt) {
      const seconds = remaining(challengeExpiresAt);
      $('code-timing').textContent = seconds ? '인증번호 유효시간 ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') : '인증번호 유효시간이 지났을 수 있습니다. 필요하면 다시 요청해 주세요.';
    } else $('code-timing').textContent = '';
  }
  function setBusy(value) { busy = value; updateControls(); }

  async function request(action, values) {
    const controller = new AbortController();
    activeController = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(API, {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, flowVersion: FLOW, ...values}), signal: controller.signal});
      let body;
      try { body = await response.json(); } catch (_) { throw new ApiError('서비스 응답을 확인하지 못했습니다.', 'SERVER_ERROR', response.status, 0, true); }
      if (!response.ok || !body || body.ok !== true) throw new ApiError(typeof body?.error === 'string' ? body.error.slice(0, 240) : '요청을 처리하지 못했습니다.', body?.code, response.status, body?.retryAfter, response.status >= 500);
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('연결 상태를 확인한 뒤 다시 시도해 주세요.', 'NETWORK_ERROR', 0, 0, true);
    } finally {
      window.clearTimeout(timeout);
      if (activeController === controller) activeController = null;
    }
  }

  function clearRrn() { $('rrn-front').value = ''; $('rrn-back').value = ''; }
  function clearPrivateState() {
    closeAddressSearch(false);
    clearRrn();
    clearSignature(true);
    token = ''; session = ''; verifiedPhone = ''; challengeId = ''; challengePhone = ''; phoneDraft = '';
    pendingSubmission = null; uncertainSubmission = false;
    $('verification-code').value = '';
    $('verified-phone').textContent = '';
    $('input-summary').replaceChildren();
    form.reset();
  }
  function finish(submittedAt, existing) {
    clearPrivateState(); busy = ''; message('');
    $('success-heading').textContent = existing ? '이미 접수된 링크입니다' : '고객정보가 접수되었습니다';
    $('success-description').textContent = '담당자가 입력 내용을 확인할 수 있습니다. 수정이 필요하면 담당자에게 문의해 주세요.';
    $('submitted-time').textContent = dateText(submittedAt) ? '접수 일시 · ' + dateText(submittedAt) : '';
    showStage('success', true);
  }
  function terminal(title, description, retry) {
    if (!retry) clearPrivateState();
    busy = ''; message('');
    $('terminal-heading').textContent = title;
    $('terminal-description').textContent = description;
    $('retry-info').hidden = !retry;
    showStage('terminal', true);
  }

  function handleError(error, action) {
    if (disposed) return;
    setBusy('');
    if (error.code === 'ALREADY_SUBMITTED') { finish(null, true); return; }
    const ended = {INVALID_LINK: ['링크를 확인해 주세요', '사용할 수 없는 입력 링크입니다. 담당자에게 새 링크를 요청해 주세요.'], EXPIRED: ['입력 링크가 만료되었습니다', '담당자에게 새 링크를 요청해 주세요.'], REVOKED: ['입력 링크가 종료되었습니다', '담당자가 이 링크의 사용을 종료했습니다.'], FORBIDDEN: ['지금은 접수를 진행할 수 없습니다', '담당자에게 문의해 주세요.']};
    if (ended[error.code]) { terminal(...ended[error.code], false); return; }
    if (action === 'info') { terminal('입력 서비스를 확인해 주세요', '차량정보와 접수 설정을 확인하지 못했습니다. 잠시 후 다시 확인하거나 담당자에게 문의해 주세요.', true); return; }
    if (error.code === 'RATE_LIMITED') {
      const delay = error.retryAfter || 60;
      if (action === 'submit') submitRetryUntil = Date.now() + delay * 1000;
      else cooldownUntil = Date.now() + delay * 1000;
      message('요청이 잠시 제한되었습니다. ' + delay + '초 후 다시 시도해 주세요.', 'error', true); return;
    }
    if (action === 'submit' && uncertainSubmission) {
      message('접수 결과를 아직 확인하지 못했습니다. 입력 내용을 바꾸지 않고 같은 요청의 결과를 다시 확인해 주세요. 계속 확인되지 않으면 담당자에게 문의해 주세요.', 'error', true); return;
    }
    if (error.code === 'SESSION_EXPIRED') {
      session = ''; verifiedPhone = ''; challengeId = ''; pendingSubmission = null; uncertainSubmission = false;
      $('verification-code').value = '';
      showStep('phone', true);
      message('휴대전화 확인 시간이 끝났습니다. 다시 확인하면 입력 중인 내용으로 이어서 접수할 수 있습니다.', 'info', false); return;
    }
    if (error.code === 'LOCKED') {
      challengeId = ''; $('verification-code').value = '';
      if (error.retryAfter) cooldownUntil = Date.now() + error.retryAfter * 1000;
      message('인증 시도가 제한되었습니다. 잠시 후 인증번호를 다시 요청하거나 담당자에게 문의해 주세요.', 'error', true); return;
    }
    if (action === 'verify' && error.code === 'INVALID_CODE') { invalid('verification-code', '인증번호가 맞지 않거나 유효시간이 지났습니다. 문자로 받은 번호를 확인해 주세요.'); return; }
    if (action === 'send-code' && ['PHONE_MISMATCH', 'VALIDATION_ERROR'].includes(error.code)) { invalid('customer-phone', '입력 링크를 받으신 휴대전화번호와 일치하는지 확인해 주세요.'); return; }
    if (action === 'send-code' && error.uncertain) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + 60000);
      message('문자 접수 결과를 확인하지 못했습니다. 1분 뒤 인증번호를 다시 요청해 주세요.', 'error', true); return;
    }
    if (action === 'submit' && ['DB_SETUP_REQUIRED', 'RRN_SETUP_REQUIRED', 'RRN_NOT_AVAILABLE', 'SERVICE_UNAVAILABLE'].includes(error.code)) {
      pendingSubmission = null;
      message('접수 설정을 확인해야 합니다. 입력 내용은 유지됩니다. 담당자에게 문의한 뒤 다시 접수해 주세요.', 'error', true); return;
    }
    if (action === 'submit' && error.uncertain) {
      uncertainSubmission = true;
      message('접수 결과를 아직 확인하지 못했습니다. 입력 내용은 이 화면에 보관 중입니다. 아래 버튼으로 같은 요청의 접수 여부를 다시 확인해 주세요.', 'error', true); return;
    }
    if (action === 'submit') pendingSubmission = null;
    message(error.code === 'VALIDATION_ERROR' ? error.message : '요청을 처리하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.', 'error', true);
  }

  function dateText(value) {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(date) : '';
  }
  function displayValue(value, fallback) { return String(value ?? '').trim() || fallback || '미입력'; }
  function numberValue(value) {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return value !== null && value !== undefined && String(value).trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  async function loadInfo() {
    if (busy || !token) return;
    const epoch = pageEpoch;
    setBusy('info'); message('');
    try {
      const result = await request('info', {token});
      if (disposed || epoch !== pageEpoch) return;
      const state = String(result.status || '').toLowerCase();
      if (['submitted', 'completed', 'complete'].includes(state)) { finish(null, true); return; }
      if (['expired', 'revoked'].includes(state)) throw new ApiError('', state.toUpperCase());
      if (result.flowVersion !== FLOW || result.rrnEnabled !== true || !result.car || typeof result.car !== 'object' || Array.isArray(result.car)) throw new ApiError('', 'DB_SETUP_REQUIRED', 503);
      document.querySelectorAll('[data-company-name]').forEach(element => { element.textContent = displayValue(result.companyName, '담당 상사'); });
      const car = result.car;
      $('car-model').textContent = displayValue(car.model, '차량 정보'); $('car-plate').textContent = displayValue(car.plate, '차량번호 미입력');
      $('car-year').textContent = car.year ? displayValue(car.year) + '년' : '미입력';
      const km = numberValue(car.km); $('car-km').textContent = km === null ? displayValue(car.km) : km.toLocaleString('ko-KR') + ' km';
      $('car-color').textContent = displayValue(car.color);
      const price = numberValue(car.sellWon ?? (car.sell === '' || car.sell == null ? null : Math.round(Number(car.sell) * 10000))); $('car-price').textContent = price === null ? '담당자에게 확인' : price.toLocaleString('ko-KR') + '원';
      const masked = String(result.phoneMasked || ''); $('masked-phone').textContent = /[*•●xX]/.test(masked) ? masked.slice(0, 40) : '문자를 받은 휴대전화';
      $('link-expiry').textContent = dateText(result.expiresAt) ? '입력 가능 시간 · ' + dateText(result.expiresAt) + '까지' : '';
      showStage('car', false);
    } catch (error) { if (epoch === pageEpoch) handleError(error, 'info'); }
    finally { if (epoch === pageEpoch) setBusy(''); }
  }

  function syncMailing() {
    const same = $('same-address').checked;
    if (same) { $('mailing-base').value = $('address-base').value; $('mailing-detail').value = $('address-detail').value; }
    $('mailing-fields').hidden = same;
    $('mailing-base').disabled = same || fields.disabled; $('mailing-detail').disabled = same || fields.disabled;
  }

  const addressTargets = Object.freeze({
    residence: {base: 'address-base', detail: 'address-detail'},
    mailing: {base: 'mailing-base', detail: 'mailing-detail'}
  });

  function closeAddressSearch(restoreFocus) {
    const previous = addressSession;
    addressSession = null;
    if (previous) {
      window.clearTimeout(previous.timer);
      window.clearInterval(previous.watch);
      try { previous.popup.close(); } catch (_) { /* The search window may already be closed. */ }
    }
    $('address-search-status').hidden = true;
    if (restoreFocus && previous?.trigger?.isConnected && !previous.trigger.disabled) previous.trigger.focus();
  }

  function addressStatus(text, failed) {
    $('address-search-message').textContent = text;
    $('address-search-status').dataset.tone = failed ? 'error' : 'info';
  }

  function openAddressSearch(targetName, trigger) {
    const target = addressTargets[targetName];
    if (!target || stage !== 'details' || step !== 'address' || busy || uncertainSubmission || !token || fields.disabled || $(target.base).disabled) return;
    closeAddressSearch(false);
    let nonce;
    try { nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''); }
    catch (_) { message('주소 검색을 열지 못했습니다. 주소를 직접 입력해 주세요.', 'error', false); return; }
    const url = new URL('/address-search.html', location.origin);
    url.searchParams.set('parentOrigin', location.origin);
    url.hash = nonce;
    let popup;
    try { popup = window.open(url.toString(), 'snote_customer_address_' + nonce, 'width=560,height=750,resizable=yes,scrollbars=yes'); }
    catch (_) { /* Popup blocking is reported below without losing the form. */ }
    if (!popup) {
      message('주소 검색창이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 눌러 주세요. 주소를 직접 입력할 수도 있습니다.', 'error', false);
      return;
    }
    const current = {popup, nonce, target, targetName, trigger, timer: null, watch: null};
    addressSession = current;
    $('address-search-status').hidden = false;
    addressStatus('새 창에서 주소 검색을 불러오고 있습니다.', false);
    current.timer = window.setTimeout(() => {
      if (addressSession !== current) return;
      addressStatus('검색창이 열리지 않으면 검색을 취소한 뒤 다시 눌러 주세요. 주소를 직접 입력할 수도 있습니다.', true);
    }, 15000);
    current.watch = window.setInterval(() => {
      if (addressSession !== current) return;
      try { if (popup.closed) closeAddressSearch(true); } catch (_) { closeAddressSearch(true); }
    }, 500);
    try { popup.focus(); } catch (_) { /* Some mobile browsers choose the new tab automatically. */ }
  }

  document.querySelectorAll('[data-address-search]').forEach(button => {
    button.addEventListener('click', () => openAddressSearch(button.dataset.addressSearch, button));
  });
  $('address-search-cancel').addEventListener('click', () => closeAddressSearch(true));
  $('address-search-focus').addEventListener('click', () => {
    try { addressSession?.popup.focus(); } catch (_) { closeAddressSearch(true); }
  });
  window.addEventListener('message', event => {
    const current = addressSession, data = event.data;
    if (!current || event.source !== current.popup || event.origin !== location.origin || !data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'SNOTE_CUSTOMER_ADDRESS' || data.nonce !== current.nonce) return;
    if (stage !== 'details' || step !== 'address' || busy || uncertainSubmission || !token || fields.disabled || $(current.target.base).disabled) { closeAddressSearch(false); return; }
    if (data.kind === 'ready') {
      window.clearTimeout(current.timer);
      addressStatus('검색창에서 주소를 선택해 주세요. 선택한 주소가 이 화면에 자동으로 입력됩니다.', false);
    } else if (data.kind === 'error') {
      window.clearTimeout(current.timer);
      addressStatus('주소 검색을 불러오지 못했습니다. 검색을 취소한 뒤 다시 시도하거나 주소를 직접 입력해 주세요.', true);
    } else if (data.kind === 'closed') closeAddressSearch(true);
    else if (data.kind === 'selected') {
      if (typeof data.address !== 'string' || !data.address.trim() || data.address.length > 200 || /[\u0000-\u001f\u007f]/.test(data.address) || (data.postcode && (typeof data.postcode !== 'string' || !/^\d{5}$/.test(data.postcode)))) return;
      const target = current.target, address = data.address.trim();
      if ($(target.base).value.trim() !== address) $(target.detail).value = '';
      $(target.base).value = address;
      clearValidation();
      invalidateAttestation();
      syncMailing();
      closeAddressSearch(false);
      message('주소를 입력했습니다. 상세주소를 확인해 주세요.', 'info', false);
      $(target.detail).focus();
    }
  });

  function hasRefund() { return ['refund-bank', 'refund-account', 'refund-holder'].some(id => $(id).value.trim()); }
  function syncRefundConsent() {
    $('refund-consent-section').hidden = !hasRefund();
    if (!hasRefund()) $('refund-consent').checked = false;
  }
  function clearValidation() {
    form.querySelectorAll('input,canvas').forEach(field => { if (field.setCustomValidity) field.setCustomValidity(''); field.removeAttribute('aria-invalid'); });
  }
  function invalid(id, text) {
    const target = fieldSteps[id];
    if (target && (stage !== 'details' || step !== target)) showStep(target, false, 'replace');
    const field = $(id);
    if (field.setCustomValidity) field.setCustomValidity(text);
    field.setAttribute('aria-invalid', 'true');
    message(text, 'error', false);
    field.focus();
    if (field.reportValidity) field.reportValidity();
    return false;
  }
  function validateStep(which) {
    if (which === 'name') {
      const value = $('customer-name').value.trim();
      if (value.length < 2 || value.length > 50) return invalid('customer-name', '성함을 2~50자로 입력해 주세요.');
    } else if (which === 'rrn') {
      if (!/^\d{6}$/.test($('rrn-front').value)) return invalid('rrn-front', '주민번호 앞 6자리를 입력해 주세요.');
      if (!/^\d{7}$/.test($('rrn-back').value)) return invalid('rrn-back', '주민번호 뒤 7자리를 입력해 주세요.');
    } else if (which === 'address') {
      syncMailing();
      const base = $('address-base').value.trim(), detail = $('address-detail').value.trim(), mailing = $('mailing-base').value.trim(), mailingDetail = $('mailing-detail').value.trim();
      if (!base || base.length > 200) return invalid('address-base', '등본상 기본주소를 입력해 주세요.');
      if (detail.length > 100 || [base, detail].filter(Boolean).join(' ').length > 220) return invalid('address-detail', '기본주소와 상세주소를 합쳐 220자 이내로 입력해 주세요.');
      if (mailingDetail && !mailing) return invalid('mailing-base', '등기를 받을 기본주소도 함께 입력해 주세요.');
      if (mailing.length > 200 || mailingDetail.length > 100 || [mailing, mailingDetail].filter(Boolean).join(' ').length > 220) return invalid('mailing-detail', '등기 기본주소와 상세주소를 합쳐 220자 이내로 입력해 주세요.');
    } else if (which === 'phone') {
      if (!validPhone(phoneValue($('customer-phone').value))) return invalid('customer-phone', '문자 링크를 받으신 휴대전화번호를 입력해 주세요.');
      if (!phoneVerified()) return invalid('customer-phone', '인증번호로 휴대전화 확인을 완료해 주세요.');
    } else if (which === 'refund' && hasRefund()) {
      if (!$('refund-bank').value.trim()) return invalid('refund-bank', '환급계좌 은행명을 입력해 주세요.');
      const account = $('refund-account').value.replace(/\s/g, '');
      if (!/^[0-9-]{6,32}$/.test(account) || account.replace(/-/g, '').length < 6) return invalid('refund-account', '계좌번호는 숫자 6자리 이상, 하이픈을 포함해 32자 이내로 입력해 주세요.');
      if (!$('refund-holder').value.trim()) return invalid('refund-holder', '환급계좌 예금주를 입력해 주세요.');
    } else if (which === 'consent') {
      if (!$('required-consent').checked) return invalid('required-consent', '개인정보 수집·이용에 동의해 주세요.');
      if (hasRefund() && !$('refund-consent').checked) return invalid('refund-consent', '환급계좌 수집·이용에 동의해 주세요.');
      if (!signatureValid()) return invalid('signature-canvas', signatureOverflow ? '서명이 너무 길어졌습니다. 다시 서명을 눌러 간단히 서명해 주세요.' : '손가락이나 마우스로 직접 서명해 주세요.');
    }
    return true;
  }
  function goNext() {
    if (busy || uncertainSubmission || !token || stage !== 'details' || step === 'consent') return;
    clearValidation();
    if (!validateStep(step)) return;
    message(''); showStep(steps[steps.indexOf(step) + 1], true);
  }
  function goPrevious() {
    if (busy || uncertainSubmission || !token) return;
    clearValidation(); message('');
    const index = steps.indexOf(step);
    if (index <= 0) showStage('car', true, 'push');
    else showStep(steps[index - 1], true);
  }
  function renderSummary() {
    syncRefundConsent();
    const rows = [['성함', $('customer-name').value.trim()], ['주민번호', '입력 완료'], ['등본주소', [$('address-base').value.trim(), $('address-detail').value.trim()].filter(Boolean).join(' ')], ['휴대전화', phoneText(verifiedPhone)]];
    if (!$('same-address').checked && $('mailing-base').value.trim()) rows.push(['등기주소', [$('mailing-base').value.trim(), $('mailing-detail').value.trim()].filter(Boolean).join(' ')]);
    rows.push(['환급계좌', hasRefund() ? [$('refund-bank').value.trim(), $('refund-account').value.trim(), $('refund-holder').value.trim()].join(' · ') : '입력 안 함']);
    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; fragment.append(term, detail); }
    $('input-summary').replaceChildren(fragment);
  }

  function signatureLocked() { return disposed || !!busy || uncertainSubmission || stage !== 'details' || step !== 'consent'; }
  function signatureValid() {
    if (!context || signatureOverflow || !signatureStrokes.length) return false;
    return signatureStrokes.some(stroke => stroke.some((point, index) => index > 0 && Math.hypot(point[0] - stroke[index - 1][0], point[1] - stroke[index - 1][1]) > 0.005));
  }
  function signatureStatus(text, error) {
    $('signature-status').textContent = text;
    $('signature-status').dataset.tone = error ? 'error' : 'info';
  }
  function drawSignature() {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#14263d'; context.fillStyle = '#14263d';
    context.lineWidth = 2.3 * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    context.lineCap = 'round'; context.lineJoin = 'round';
    for (const stroke of signatureStrokes) {
      if (!stroke.length) continue;
      context.beginPath();
      context.moveTo(stroke[0][0] * canvas.width, stroke[0][1] * canvas.height);
      if (stroke.length === 1) { context.arc(stroke[0][0] * canvas.width, stroke[0][1] * canvas.height, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); }
      else { for (let index = 1; index < stroke.length; index++) context.lineTo(stroke[index][0] * canvas.width, stroke[index][1] * canvas.height); context.stroke(); }
    }
  }
  function resizeSignature() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1)), width = Math.round(bounds.width * ratio), height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    drawSignature();
  }
  function clearSignature(force) {
    if (!force && signatureLocked()) return;
    activePointer = null; signatureStrokes = []; signatureOverflow = false;
    canvas.removeAttribute('aria-invalid');
    signatureStatus('아직 서명하지 않았습니다.', false);
    drawSignature(); updateControls();
  }
  function invalidateAttestation() {
    if (uncertainSubmission || busy === 'submit') return;
    if (signatureStrokes.length) clearSignature(true);
    $('required-consent').checked = false;
  }
  function signaturePoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top].map((value, index) => Math.round(Math.max(0, Math.min(1, value / (index ? rect.height : rect.width))) * 10000) / 10000);
  }
  function appendSignaturePoint(event, final) {
    const stroke = signatureStrokes[signatureStrokes.length - 1], point = signaturePoint(event), previous = stroke[stroke.length - 1];
    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    if (distance < (final ? 0.0001 : 0.006)) return;
    if (stroke.length >= 256 || signatureStrokes.reduce((sum, item) => sum + item.length, 0) >= 1200) {
      signatureOverflow = true; signatureStatus('서명이 너무 길어졌습니다. 다시 서명을 눌러 주세요.', true); return;
    }
    stroke.push(point); drawSignature();
  }
  canvas.addEventListener('pointerdown', event => {
    if (signatureLocked() || activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    if (signatureStrokes.length >= 24 || signatureStrokes.reduce((sum, stroke) => sum + stroke.length, 0) >= 1200) { signatureOverflow = true; signatureStatus('서명이 너무 길어졌습니다. 다시 서명을 눌러 주세요.', true); return; }
    resizeSignature(); activePointer = event.pointerId;
    signatureStrokes.push([signaturePoint(event)]);
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Pointer events remain bounded to this stroke. */ }
    canvas.removeAttribute('aria-invalid'); message(''); drawSignature(); updateControls();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer || signatureLocked() || signatureOverflow) return;
    event.preventDefault(); appendSignaturePoint(event, false);
  });
  function endSignature(event) {
    if (event.pointerId !== activePointer) return;
    if (!signatureLocked() && !signatureOverflow && event.type !== 'pointercancel' && event.type !== 'lostpointercapture') appendSignaturePoint(event, true);
    activePointer = null;
    if (!signatureOverflow) signatureStatus(signatureValid() ? '서명이 입력되었습니다.' : '선이 보이도록 직접 서명해 주세요.', false);
    updateControls();
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, endSignature);
  $('signature-clear').addEventListener('click', () => { if (signatureLocked()) return; clearSignature(false); canvas.focus(); });
  if (window.ResizeObserver) new ResizeObserver(resizeSignature).observe(canvas);
  window.addEventListener('resize', resizeSignature);

  $('vehicle-confirmed').addEventListener('change', updateControls);
  $('vehicle-next').addEventListener('click', () => { if (busy || uncertainSubmission || !$('vehicle-confirmed').checked || !token) return; message(''); showStep('name', true); });
  $('wizard-next').addEventListener('click', goNext);
  $('wizard-prev').addEventListener('click', goPrevious);
  $('customer-phone').addEventListener('input', () => {
    const next = phoneValue($('customer-phone').value);
    if (next !== phoneDraft) { session = ''; verifiedPhone = ''; challengeId = ''; challengePhone = ''; $('verification-code').value = ''; }
    phoneDraft = next; updateControls();
  });
  $('customer-phone').addEventListener('blur', () => { const value = phoneValue($('customer-phone').value); if (validPhone(value)) $('customer-phone').value = phoneText(value); });
  $('request-code').addEventListener('click', async () => {
    if (busy || uncertainSubmission || remaining(cooldownUntil) || !token || stage !== 'details' || step !== 'phone' || !$('vehicle-confirmed').checked) return;
    const phone = phoneValue($('customer-phone').value);
    if (!validPhone(phone)) { invalid('customer-phone', '문자 링크를 받으신 휴대전화번호를 입력해 주세요.'); return; }
    const epoch = pageEpoch;
    challengeId = ''; session = ''; verifiedPhone = ''; challengePhone = '';
    $('verification-code').value = ''; clearValidation(); message(''); setBusy('send');
    try {
      const result = await request('send-code', {token, phone});
      if (disposed || epoch !== pageEpoch) return;
      if (typeof result.challengeId !== 'string' || !result.challengeId || result.challengeId.length > 100) throw new ApiError('', 'SERVER_ERROR', 502, 0, true);
      challengeId = result.challengeId; challengePhone = phone;
      challengeExpiresAt = Date.parse(result.expiresAt) || 0;
      cooldownUntil = Date.now() + (Number(result.retryAfter) > 0 ? Math.min(Number(result.retryAfter), 86400) : 60) * 1000;
      message('인증번호를 요청했습니다. 휴대전화에서 문자를 확인해 주세요.', 'info', false);
      setBusy(''); $('verification-code').focus();
    } catch (error) { if (epoch === pageEpoch) handleError(error, 'send-code'); }
    finally { if (epoch === pageEpoch) setBusy(''); }
  });
  $('verification-code').addEventListener('input', event => {
    if (!event.isComposing) event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 6);
    event.currentTarget.removeAttribute('aria-invalid'); updateControls();
  });
  async function verifyCode() {
    if (busy || uncertainSubmission || !challengeId || !token || step !== 'phone') return;
    const code = $('verification-code').value;
    if (!/^\d{6}$/.test(code)) { invalid('verification-code', '문자로 받은 인증번호 6자리를 입력해 주세요.'); return; }
    if (phoneValue($('customer-phone').value) !== challengePhone) { invalid('customer-phone', '번호가 변경되었습니다. 인증번호를 다시 요청해 주세요.'); return; }
    const epoch = pageEpoch;
    clearValidation(); message(''); setBusy('verify');
    try {
      const result = await request('verify', {token, challengeId, code});
      if (disposed || epoch !== pageEpoch) return;
      if (typeof result.session !== 'string' || !/^[a-f0-9]{64}$/.test(result.session) || typeof result.phone !== 'string' || !validPhone(result.phone) || result.phone !== challengePhone) throw new ApiError('', 'SERVER_ERROR', 502, 0, true);
      session = result.session; verifiedPhone = result.phone; phoneDraft = result.phone;
      $('customer-phone').value = phoneText(result.phone); $('verified-phone').textContent = phoneText(result.phone);
      challengeId = ''; $('verification-code').value = ''; message(''); showStep('refund', true);
    } catch (error) { if (epoch === pageEpoch) handleError(error, 'verify'); }
    finally { if (epoch === pageEpoch) setBusy(''); }
  }
  $('verify-button').addEventListener('click', verifyCode);
  $('verification-code').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); verifyCode(); } });
  $('same-address').addEventListener('change', () => { clearValidation(); invalidateAttestation(); syncMailing(); updateControls(); });
  form.addEventListener('input', event => {
    clearValidation();
    if (!busy && !uncertainSubmission) message('');
    if (!['verification-code', 'required-consent', 'refund-consent'].includes(event.target.id)) invalidateAttestation();
    syncMailing(); syncRefundConsent();
  });
  for (const id of ['rrn-front', 'rrn-back']) $(id).addEventListener('input', event => { if (!event.isComposing) event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, id === 'rrn-front' ? 6 : 7); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !token || remaining(submitRetryUntil)) return;
    if (stage !== 'details') return;
    if (step !== 'consent') { goNext(); return; }
    if (!uncertainSubmission) {
      clearValidation();
      if (!$('vehicle-confirmed').checked) { showStage('car', true); return; }
      for (const which of steps) if (!validateStep(which)) return;
      syncMailing();
      const customer = Object.fromEntries(Object.entries(customerKeys).map(([key, id]) => [key, $(id).value.trim()]));
      customer.sameAddress = $('same-address').checked;
      customer.refundAccount = customer.refundAccount.replace(/\s/g, '');
      customer.phone = verifiedPhone;
      const signature = {version: 1, strokes: signatureStrokes.map(stroke => stroke.map(point => [point[0], point[1]]))};
      pendingSubmission = {token, session, vehicleConfirmed: true, consent: true, refundConsent: hasRefund() && $('refund-consent').checked, rrn: $('rrn-front').value + $('rrn-back').value, rrnNoticeAccepted: true, signature, customer};
    }
    if (!pendingSubmission) return;
    const epoch = pageEpoch;
    activePointer = null; closeAddressSearch(false); message(''); setBusy('submit');
    try {
      const result = await request('submit', pendingSubmission);
      if (disposed || epoch !== pageEpoch) return;
      finish(result.submittedAt, !!result.alreadySubmitted);
    } catch (error) { if (epoch === pageEpoch) handleError(error, 'submit'); }
    finally { if (epoch === pageEpoch) setBusy(''); }
  });
  $('retry-info').addEventListener('click', loadInfo);
  window.addEventListener('popstate', event => {
    if (!token || ['success', 'terminal'].includes(stage)) { writeHistory('replace'); return; }
    if (busy || uncertainSubmission) { writeHistory('push'); return; }
    const target = event.state;
    if (target?.snoteIntake !== FLOW) { writeHistory('replace'); return; }
    clearValidation(); message('');
    if (target.screen === 'car') { showStage('car', true); return; }
    if (target.screen !== 'details' || !steps.includes(target.step)) { writeHistory('replace'); return; }
    const index = steps.indexOf(target.step);
    for (let before = 0; before < index; before++) if (!validateStep(steps[before])) return;
    showStep(target.step, true, 'replace');
  });

  function startTicker() { if (ticker === null) ticker = window.setInterval(updateControls, 1000); }
  window.addEventListener('pagehide', () => {
    if (busy === 'info') resumeInfo = true;
    if (busy === 'submit' && pendingSubmission) uncertainSubmission = true;
    if (busy === 'send') cooldownUntil = Math.max(cooldownUntil, Date.now() + 60000);
    activePointer = null; disposed = true; pageEpoch++;
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null; activeController?.abort(); busy = '';
  });
  window.addEventListener('pageshow', () => {
    disposed = false; startTicker(); updateControls();
    if (resumeInfo && token) { resumeInfo = false; loadInfo(); }
    if (uncertainSubmission && pendingSubmission) { showStep('consent', false, 'replace'); message('접수 요청 중 화면이 중단되었습니다. 입력 내용과 서명은 유지했습니다. 아래 버튼으로 같은 요청의 접수 결과를 다시 확인해 주세요.', 'info', false); }
    if (step === 'consent') resizeSignature();
  });

  try {
    const fragment = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(fragment)) token = fragment;
    window.history.replaceState({snoteIntake: FLOW, screen: 'car', step: 'name'}, '', location.pathname);
    historyReady = true;
  } catch (_) { token = ''; }
  startTicker();
  if (!token) terminal('받으신 링크를 다시 열어 주세요', '문자로 안내받은 고객정보 입력 링크가 필요합니다.', false);
  else loadInfo();
})();
