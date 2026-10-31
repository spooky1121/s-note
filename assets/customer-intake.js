(function () {
  'use strict';

  const API = '/api/customer-intake';
  const REQUEST_TIMEOUT = 45000;
  const $ = id => document.getElementById(id);
  const stageNames = ['car', 'verify', 'details', 'success', 'terminal'];
  const form = $('customer-form');
  const fields = $('customer-fields');
  const customerKeys = {
    name: 'customer-name', addressBase: 'address-base', addressDetail: 'address-detail',
    mailingBase: 'mailing-base', mailingDetail: 'mailing-detail',
    refundBank: 'refund-bank', refundAccount: 'refund-account', refundHolder: 'refund-holder'
  };
  let token = '';
  let session = '';
  let challengeId = '';
  let challengeExpiresAt = 0;
  let cooldownUntil = 0;
  let submitRetryUntil = 0;
  let pendingSubmission = null;
  let uncertainSubmission = false;
  let stage = '';
  let busy = '';
  let phoneMasked = '';
  let activeController = null;
  let ticker = null;
  let disposed = false;

  class ApiError extends Error {
    constructor(message, code, status, retryAfter, uncertain) {
      super(message);
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

  function showStage(next, focus) {
    stage = next;
    $('load-state').hidden = true;
    for (const name of stageNames) $('stage-' + name).hidden = name !== next;
    $('progress').hidden = next === 'terminal';
    const index = ['car', 'verify', 'details', 'success'].indexOf(next);
    document.querySelectorAll('[data-step]').forEach((element, number) => {
      element.classList.toggle('is-complete', index > number);
      if (number === index) element.setAttribute('aria-current', 'step');
      else element.removeAttribute('aria-current');
    });
    updateControls();
    if (focus) {
      const heading = $(next === 'car' ? 'vehicle-heading' : next === 'verify' ? 'verify-heading' : next === 'details' ? 'details-heading' : next === 'success' ? 'success-heading' : 'terminal-heading');
      heading.focus({preventScroll: false});
    }
  }

  function remaining(until) {
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  function updateControls() {
    const locked = !!busy;
    const cooldown = remaining(cooldownUntil);
    const retry = remaining(submitRetryUntil);
    $('vehicle-confirmed').disabled = locked;
    $('vehicle-next').disabled = locked || !$('vehicle-confirmed').checked;
    $('vehicle-next').textContent = session ? '입력 화면으로 돌아가기 →' : '휴대전화 확인하기 →';
    $('request-code').disabled = locked || cooldown > 0 || !$('vehicle-confirmed').checked;
    $('request-code').textContent = busy === 'send' ? '인증번호 요청 중…' : cooldown ? cooldown + '초 후 다시 요청' : challengeId ? '인증번호 다시 받기' : '인증번호 받기';
    $('request-code').classList.toggle('secondary', !!challengeId);
    $('request-code').classList.toggle('primary', !challengeId);
    $('verification-code').disabled = locked || !challengeId;
    $('verify-form').hidden = !challengeId;
    $('verify-button').disabled = locked || !challengeId || !/^\d{6}$/.test($('verification-code').value);
    $('verify-button').textContent = busy === 'verify' ? '인증번호 확인 중…' : '인증번호 확인';
    $('back-to-car').disabled = locked;
    $('review-vehicle').disabled = locked || uncertainSubmission;
    fields.disabled = busy === 'submit' || uncertainSubmission;
    if (!fields.disabled) {
      $('mailing-base').disabled = $('same-address').checked;
      $('mailing-detail').disabled = $('same-address').checked;
    }
    $('submit-customer').disabled = locked || retry > 0;
    $('submit-customer').textContent = busy === 'submit' ? '접수 결과 확인 중…' : retry ? retry + '초 후 다시 제출' : uncertainSubmission ? '접수 결과 다시 확인' : '고객정보 접수하기 →';
    $('retry-info').disabled = locked;
    $('send-timing').textContent = cooldown ? '인증번호 재요청은 잠시 후 가능합니다.' : '';
    if (challengeId && challengeExpiresAt) {
      const seconds = remaining(challengeExpiresAt);
      $('code-timing').textContent = seconds ? '인증번호 유효시간 ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') : '인증번호 유효시간이 지났을 수 있습니다. 필요하면 다시 요청해 주세요.';
    } else $('code-timing').textContent = '';
  }

  function setBusy(value) {
    busy = value;
    updateControls();
  }

  async function request(action, values) {
    const controller = new AbortController();
    activeController = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(API, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        referrerPolicy: 'no-referrer', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, ...values}), signal: controller.signal
      });
      let body;
      try { body = await response.json(); }
      catch (_) { throw new ApiError('서비스 응답을 확인하지 못했습니다.', 'SERVER_ERROR', response.status, 0, true); }
      if (!response.ok || !body || body.ok !== true) {
        const errorText = typeof body?.error === 'string' ? body.error.slice(0, 240) : '요청을 처리하지 못했습니다.';
        throw new ApiError(errorText, body?.code, response.status, body?.retryAfter, response.status >= 500);
      }
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('연결 상태를 확인한 뒤 다시 시도해 주세요.', 'NETWORK_ERROR', 0, 0, true);
    } finally {
      window.clearTimeout(timeout);
      if (activeController === controller) activeController = null;
    }
  }

  function clearPrivateState() {
    token = '';
    session = '';
    challengeId = '';
    pendingSubmission = null;
    uncertainSubmission = false;
    $('verification-code').value = '';
    form.reset();
  }

  function finish(submittedAt, existing) {
    clearPrivateState();
    busy = '';
    message('');
    $('success-heading').textContent = existing ? '이미 접수된 링크입니다' : '고객정보가 접수되었습니다';
    $('success-description').textContent = '담당자가 판매 진행 화면에서 확인할 수 있습니다. 수정이 필요하면 담당자에게 문의해 주세요.';
    $('submitted-time').textContent = dateText(submittedAt) ? '접수 일시 · ' + dateText(submittedAt) : '';
    showStage('success', true);
  }

  function terminal(title, description, retry) {
    if (!retry) clearPrivateState();
    busy = '';
    message('');
    $('terminal-heading').textContent = title;
    $('terminal-description').textContent = description;
    $('retry-info').hidden = !retry;
    showStage('terminal', true);
  }

  function handleError(error, action) {
    if (disposed) return;
    if (error.code === 'ALREADY_SUBMITTED') {
      finish(null, true);
      return;
    }
    const ended = {
      INVALID_LINK: ['링크를 확인해 주세요', '사용할 수 없는 입력 링크입니다. 담당자에게 새 링크를 요청해 주세요.'],
      EXPIRED: ['입력 링크가 만료되었습니다', '안내된 입력 시간이 지났습니다. 담당자에게 새 링크를 요청해 주세요.'],
      REVOKED: ['입력 링크가 종료되었습니다', '담당자가 이 링크의 사용을 종료했습니다. 새 링크가 필요한지 담당자에게 확인해 주세요.'],
      FORBIDDEN: ['지금은 접수를 진행할 수 없습니다', '이 링크로 입력할 수 없는 상태입니다. 담당자에게 문의해 주세요.']
    };
    if (ended[error.code]) {
      terminal(ended[error.code][0], ended[error.code][1], false);
      return;
    }
    if (action === 'info') {
      terminal('연결을 확인해 주세요', error.status === 503 ? '현재 고객 입력 서비스를 이용할 수 없습니다. 잠시 후 다시 확인하거나 담당자에게 문의해 주세요.' : '차량 안내를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.', true);
      return;
    }
    if (error.code === 'SESSION_EXPIRED') {
      session = '';
      challengeId = '';
      pendingSubmission = null;
      uncertainSubmission = false;
      $('verification-code').value = '';
      showStage('verify', true);
      message('휴대전화 확인 시간이 끝났습니다. 다시 확인하면 입력 중인 내용으로 이어서 접수할 수 있습니다.', 'info', false);
      return;
    }
    if (error.code === 'RATE_LIMITED') {
      const delay = error.retryAfter || 60;
      if (action === 'submit') submitRetryUntil = Date.now() + delay * 1000;
      else cooldownUntil = Date.now() + delay * 1000;
      message('요청이 잠시 제한되었습니다. ' + delay + '초 후 다시 시도해 주세요.', 'error', true);
      return;
    }
    if (error.code === 'LOCKED') {
      challengeId = '';
      $('verification-code').value = '';
      if (error.retryAfter) cooldownUntil = Date.now() + error.retryAfter * 1000;
      message('인증 시도가 제한되었습니다. 잠시 후 인증번호를 다시 요청하거나 담당자에게 새 링크를 요청해 주세요.', 'error', true);
      return;
    }
    if (action === 'verify' && error.code === 'INVALID_CODE') {
      $('verification-code').setAttribute('aria-invalid', 'true');
      message('인증번호가 맞지 않거나 유효시간이 지났습니다. 문자로 받은 번호를 다시 확인해 주세요.', 'error', false);
      $('verification-code').focus();
      $('verification-code').select();
      return;
    }
    if (action === 'send-code' && error.uncertain) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + 60000);
      message('문자 접수 결과를 확인하지 못했습니다. 1분 뒤 인증번호를 다시 요청해 주세요.', 'error', true);
      return;
    }
    if (action === 'submit' && error.uncertain) {
      uncertainSubmission = true;
      message('접수 결과를 아직 확인하지 못했습니다. 입력 내용은 이 화면에 보관 중입니다. 아래 버튼으로 접수 여부를 다시 확인해 주세요.', 'error', true);
      return;
    }
    if (action === 'submit') {
      pendingSubmission = null;
      uncertainSubmission = false;
    }
    const text = error.code === 'VALIDATION_ERROR' ? error.message : error.status === 503 ? '현재 접수를 처리할 수 없습니다. 입력한 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.' : '요청을 처리하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.';
    message(text, 'error', true);
  }

  function dateText(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(date);
  }

  function displayValue(value, fallback) {
    const text = String(value ?? '').trim();
    return text || fallback || '미입력';
  }

  function numberValue(value) {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return value !== null && value !== undefined && String(value).trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  async function loadInfo() {
    if (busy || !token) return;
    setBusy('info');
    message('');
    try {
      const result = await request('info', {token});
      if (disposed) return;
      const state = String(result.status || '').toLowerCase();
      if (['submitted', 'completed', 'complete'].includes(state)) {
        finish(null, true);
        return;
      }
      if (['expired', 'revoked'].includes(state)) throw new ApiError('', state.toUpperCase());
      if (!result.car || typeof result.car !== 'object' || Array.isArray(result.car)) throw new ApiError('', 'SERVER_ERROR', 502);
      const company = displayValue(result.companyName, '담당 상사');
      document.querySelectorAll('[data-company-name]').forEach(element => { element.textContent = company; });
      const car = result.car;
      $('car-model').textContent = displayValue(car.model, '차량 정보');
      $('car-plate').textContent = displayValue(car.plate, '차량번호 미입력');
      $('car-year').textContent = car.year ? displayValue(car.year) + '년' : '미입력';
      const km = numberValue(car.km);
      $('car-km').textContent = km === null ? displayValue(car.km) : km.toLocaleString('ko-KR') + ' km';
      $('car-color').textContent = displayValue(car.color);
      const price = numberValue(car.sell);
      $('car-price').textContent = price === null ? '담당자에게 확인' : price.toLocaleString('ko-KR') + '만원';
      const masked = String(result.phoneMasked || '');
      phoneMasked = /[*•●xX]/.test(masked) ? masked.slice(0, 40) : '문자를 받은 휴대전화';
      $('masked-phone').textContent = phoneMasked;
      $('verified-phone').textContent = phoneMasked;
      $('link-expiry').textContent = dateText(result.expiresAt) ? '입력 가능 시간 · ' + dateText(result.expiresAt) + '까지' : '';
      showStage('car', false);
    } catch (error) {
      handleError(error, 'info');
    } finally {
      setBusy('');
    }
  }

  function syncMailing() {
    const same = $('same-address').checked;
    if (same) {
      $('mailing-base').value = $('address-base').value;
      $('mailing-detail').value = $('address-detail').value;
    }
    $('mailing-base').disabled = same || fields.disabled;
    $('mailing-detail').disabled = same || fields.disabled;
  }

  function hasRefund() {
    return ['refund-bank', 'refund-account', 'refund-holder'].some(id => $(id).value.trim());
  }

  function syncRefundConsent() {
    const provided = hasRefund();
    $('refund-consent-section').hidden = !provided;
    $('refund-consent').required = provided;
    if (!provided) $('refund-consent').checked = false;
  }

  function clearValidation() {
    form.querySelectorAll('input').forEach(input => {
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
    });
  }

  function invalid(id, text) {
    const field = $(id);
    field.setCustomValidity(text);
    field.setAttribute('aria-invalid', 'true');
    message(text, 'error', false);
    field.focus();
    field.reportValidity();
    return null;
  }

  function collectCustomer() {
    clearValidation();
    syncMailing();
    syncRefundConsent();
    const customer = Object.fromEntries(Object.entries(customerKeys).map(([key, id]) => [key, $(id).value.trim()]));
    customer.sameAddress = $('same-address').checked;
    customer.refundAccount = customer.refundAccount.replace(/\s/g, '');
    if (customer.name.length < 2 || customer.name.length > 50) return invalid('customer-name', '성함을 2~50자로 입력해 주세요.');
    if (!customer.addressBase || customer.addressBase.length > 200) return invalid('address-base', '기본주소를 입력해 주세요.');
    if (customer.addressDetail.length > 100 || [customer.addressBase, customer.addressDetail].filter(Boolean).join(' ').length > 220) return invalid('address-detail', '기본주소와 상세주소를 합쳐 220자 이내로 입력해 주세요.');
    if (customer.mailingDetail && !customer.mailingBase) return invalid('mailing-base', '등기를 받을 기본주소도 함께 입력해 주세요.');
    if ([customer.mailingBase, customer.mailingDetail].filter(Boolean).join(' ').length > 220) return invalid('mailing-detail', '등기 기본주소와 상세주소를 합쳐 220자 이내로 입력해 주세요.');
    if (hasRefund()) {
      if (!customer.refundBank) return invalid('refund-bank', '환급계좌 은행명을 입력해 주세요.');
      if (!/^[0-9-]{6,32}$/.test(customer.refundAccount) || customer.refundAccount.replace(/-/g, '').length < 6) return invalid('refund-account', '환급계좌 번호는 숫자 6자리 이상, 하이픈을 포함해 32자 이내로 입력해 주세요.');
      if (!customer.refundHolder) return invalid('refund-holder', '환급계좌 예금주를 입력해 주세요.');
      if (!$('refund-consent').checked) return invalid('refund-consent', '환급계좌 수집·이용 동의 여부를 확인해 주세요.');
    }
    if (!$('required-consent').checked) return invalid('required-consent', '개인정보 수집·이용 동의 여부를 확인해 주세요.');
    if (!form.reportValidity()) return null;
    return customer;
  }

  $('vehicle-confirmed').addEventListener('change', updateControls);
  $('vehicle-next').addEventListener('click', () => {
    if (busy || !$('vehicle-confirmed').checked) return;
    message('');
    showStage(session ? 'details' : 'verify', true);
  });
  for (const id of ['back-to-car', 'review-vehicle']) $(id).addEventListener('click', () => {
    if (busy || uncertainSubmission) return;
    message('');
    showStage('car', true);
  });

  $('request-code').addEventListener('click', async () => {
    if (busy || remaining(cooldownUntil) || !token || !$('vehicle-confirmed').checked) return;
    challengeId = '';
    $('verification-code').value = '';
    $('verification-code').removeAttribute('aria-invalid');
    message('');
    setBusy('send');
    try {
      const result = await request('send-code', {token});
      if (disposed) return;
      if (typeof result.challengeId !== 'string' || result.challengeId.length > 100 || !result.challengeId) throw new ApiError('', 'SERVER_ERROR', 502, 0, true);
      challengeId = result.challengeId;
      challengeExpiresAt = Date.parse(result.expiresAt) || 0;
      cooldownUntil = Date.now() + (Number(result.retryAfter) > 0 ? Math.min(Number(result.retryAfter), 86400) : 60) * 1000;
      message('인증번호 발송 요청이 접수되었습니다. 휴대전화에서 문자를 확인해 주세요.', 'info', false);
      setBusy('');
      $('verification-code').focus();
    } catch (error) {
      handleError(error, 'send-code');
    } finally {
      setBusy('');
    }
  });

  $('verification-code').addEventListener('input', event => {
    if (event.isComposing) return;
    event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 6);
    event.currentTarget.removeAttribute('aria-invalid');
    updateControls();
  });
  $('verify-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !challengeId || !token) return;
    const code = $('verification-code').value;
    if (!/^\d{6}$/.test(code)) {
      message('문자로 받은 인증번호 6자리를 입력해 주세요.', 'error', false);
      $('verification-code').focus();
      return;
    }
    message('');
    setBusy('verify');
    try {
      const result = await request('verify', {token, challengeId, code});
      if (disposed) return;
      if (typeof result.session !== 'string' || !/^[a-f0-9]{64}$/.test(result.session)) throw new ApiError('', 'SERVER_ERROR', 502, 0, true);
      session = result.session;
      challengeId = '';
      $('verification-code').value = '';
      message('');
      showStage('details', true);
    } catch (error) {
      handleError(error, 'verify');
    } finally {
      setBusy('');
    }
  });

  $('same-address').addEventListener('change', () => {
    clearValidation();
    syncMailing();
  });
  form.addEventListener('input', () => {
    clearValidation();
    if (!busy && !uncertainSubmission) message('');
    syncMailing();
    syncRefundConsent();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !token) return;
    if (!session) {
      showStage('verify', true);
      message('휴대전화 확인을 먼저 진행해 주세요.', 'info', false);
      return;
    }
    if (!$('vehicle-confirmed').checked) {
      showStage('car', true);
      return;
    }
    if (!uncertainSubmission) {
      const customer = collectCustomer();
      if (!customer) return;
      pendingSubmission = {token, session, vehicleConfirmed: true, consent: true, refundConsent: hasRefund() && $('refund-consent').checked, customer};
    }
    if (!pendingSubmission) return;
    message('');
    setBusy('submit');
    try {
      const result = await request('submit', pendingSubmission);
      if (disposed) return;
      finish(result.submittedAt, !!result.alreadySubmitted);
    } catch (error) {
      handleError(error, 'submit');
    } finally {
      setBusy('');
    }
  });
  $('retry-info').addEventListener('click', loadInfo);

  function startTicker() {
    if (ticker === null) ticker = window.setInterval(updateControls, 1000);
  }
  window.addEventListener('pagehide', () => {
    if (busy === 'submit' && pendingSubmission) uncertainSubmission = true;
    disposed = true;
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
    activeController?.abort();
    busy = '';
  });
  window.addEventListener('pageshow', () => {
    disposed = false;
    startTicker();
    updateControls();
    if (uncertainSubmission && pendingSubmission) {
      showStage('details', false);
      message('접수 요청 중 화면이 중단되었습니다. 입력 내용은 유지했습니다. 아래 버튼으로 접수 결과를 다시 확인해 주세요.', 'info', false);
    }
  });

  try {
    const fragment = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(fragment)) token = fragment;
    window.history.replaceState(null, '', window.location.pathname);
  } catch (_) {
    token = '';
  }
  startTicker();
  if (!token) terminal('받으신 링크를 다시 열어 주세요', '문자로 안내받은 고객정보 입력 링크가 필요합니다. 문자에 있는 링크를 다시 눌러 주세요.', false);
  else loadInfo();
})();
