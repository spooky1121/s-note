(function () {
  'use strict';

  const API = '/api/customer-intake';
  const FIELDS = ['zc72-name', 'zc72-phone', 'zc72-address', 'zc73-address-detail',
    'zc72-mailing', 'zc73-mailing-detail', 'zc74-same-address',
    'zc74-refund-bank', 'zc74-refund-account', 'zc74-refund-holder'];
  let state = null;
  let sequence = 0;
  const byId = id => document.getElementById(id);
  const text = value => typeof value === 'string' ? value : '';
  const digits = value => String(value || '').replace(/\D/g, '');
  const phoneFormat = value => typeof zc72PhoneFormat === 'function' ? zc72PhoneFormat(value) : text(value);

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function button(label, className, action) {
    const element = node('button', className, label);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  }

  function currentContext() {
    const user = typeof currentUser !== 'undefined' ? currentUser : null;
    const carId = typeof zc72SaleCarId !== 'undefined' ? zc72SaleCarId : null;
    const activeId = typeof activeCarId !== 'undefined' ? activeCarId : null;
    const car = typeof cars !== 'undefined' && Array.isArray(cars) ? cars.find(item => item.id === carId) : null;
    return { user, carId, activeId, car, cloud: window.zc86Cloud };
  }

  function isCurrent(s) {
    if (state !== s || s.id !== sequence || byId('zc72-sale-modal')?.hidden !== false) return false;
    const context = currentContext();
    return context.user?.username === s.username && context.user?.role === s.role &&
      context.carId === s.carId && context.activeId === s.carId &&
      context.car?.ownerId === s.username && context.cloud === s.cloud && context.cloud?.ready === true;
  }

  function formValues() {
    return JSON.stringify(FIELDS.map(id => {
      const element = byId(id);
      return element?.type === 'checkbox' ? element.checked : element?.value || '';
    }));
  }

  function close() {
    ++sequence;
    if (state) {
      clearTimeout(state.timer);
      state.observer?.disconnect();
      for (const controller of state.controllers) controller.abort();
      state.controllers.clear();
      state.link = null;
      state.requests = [];
    }
    state = null;
    byId('snote-intake-panel')?.replaceChildren();
  }

  function message(s, content, kind = '') {
    if (!isCurrent(s)) return;
    s.message.textContent = content;
    s.message.className = 'snote-intake-message' + (kind ? ' is-' + kind : '');
  }

  function failure(error, action) {
    if (error?.status === 401 || ['UNAUTHORIZED', 'AUTH_REQUIRED', 'INVALID_JWT'].includes(error?.code))
      return '로그인이 만료되었습니다. 다시 로그인한 뒤 이용해 주세요.';
    if (error?.code === 'DB_SETUP_REQUIRED')
      return '고객 입력용 DB 설정을 확인해 주세요. Supabase에서 고객 접수·인증 SQL 전체를 적용한 뒤 새로고침해 주세요.';
    if (error?.code === 'SERVER_SETUP_REQUIRED')
      return '서버의 Supabase 연결 설정을 확인해 주세요. Cloudflare 운영 환경의 서버 키를 확인하고 재배포한 뒤 새로고침해 주세요.';
    if (['NOT_CONFIGURED', 'SERVICE_UNAVAILABLE', 'SETUP_REQUIRED'].includes(error?.code))
      return '문자 발송 설정 확인이 필요합니다. 전화번호는 미리 입력할 수 있습니다. Cloudflare 운영 환경 설정을 저장·재배포한 뒤 새로고침해 주세요.';
    if (error?.code === 'SMS_SEND_UNKNOWN')
      return '문자 접수 여부를 확인하지 못했습니다. 다시 보내기 전에 요청 상태와 고객 수신 여부를 확인해 주세요.';
    if (error?.status === 503)
      return '고객 입력 서비스에 일시적으로 연결할 수 없습니다. 입력한 번호는 유지됩니다. 잠시 후 새로고침해 주세요.';
    if (error?.code === 'FORBIDDEN') return '본인 담당 차량만 이용할 수 있습니다. 담당 딜러와 차량 상태를 확인해 주세요.';
    if (error?.code === 'RATE_LIMITED') {
      const seconds = Number(error.retryAfter);
      return Number.isFinite(seconds) && seconds > 0
        ? Math.ceil(seconds) + '초 후 다시 시도해 주세요.' : '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (error?.code === 'VALIDATION_ERROR') return '전화번호와 차량 상태를 확인해 주세요.';
    if (['REVOKED', 'EXPIRED', 'ALREADY_SUBMITTED'].includes(error?.code))
      return '요청 상태가 변경되었습니다. 새로고침으로 확인해 주세요.';
    if (action === 'create') {
      const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? 'HTTP ' + error.status : error?.name === 'AbortError' ? '요청 시간 초과' : '';
      return '문자 요청 결과를 확인하지 못했습니다. 다시 보내기 전에 새로고침으로 요청 상태를 확인해 주세요.' + (status ? ' [확인 코드: ' + status + ']' : '');
    }
    if (action === 'revoke') return '취소 결과를 확인하지 못했습니다. 새로고침으로 요청 상태를 확인해 주세요.';
    return '요청 내역을 불러오지 못했습니다. 연결 상태를 확인하고 새로고침해 주세요.';
  }

  async function request(s, action, fields) {
    if (!isCurrent(s)) throw { code: 'STALE' };
    const token = await s.cloud.getAccessToken();
    if (!isCurrent(s)) throw { code: 'STALE' };
    if (!token) throw { status: 401 };
    const controller = new AbortController();
    s.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), action === 'create' ? 45000 : 20000);
    try {
      const response = await fetch(API, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ action, ...fields }), signal: controller.signal,
        referrerPolicy: 'no-referrer'
      });
      let result;
      try { result = await response.json(); } catch (_) { result = null; }
      if (!isCurrent(s)) throw { code: 'STALE' };
      if (!response.ok || result?.ok !== true) throw {
        status: response.status, code: text(result?.code), retryAfter: result?.retryAfter
      };
      return result;
    } finally {
      clearTimeout(timeout);
      s.controllers.delete(controller);
    }
  }

  function controls(s) {
    if (!isCurrent(s)) return;
    s.create.disabled = s.busy || s.reading || s.blocked || !s.canCreate;
    s.phone.disabled = s.busy || !s.canCreate;
    s.refresh.disabled = s.busy || s.reading;
    s.copy.disabled = s.busy || !s.link;
    s.create.textContent = s.busy ? '처리 중…' : '입력 링크 문자 보내기';
    for (const item of s.list.querySelectorAll('button')) item.disabled = s.busy || s.reading;
  }

  function timestamp(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : '';
  }

  function requestStatus(item) {
    if (item.revokedAt || item.status === 'revoked') return ['취소됨', 'muted'];
    if (item.submittedAt || item.status === 'submitted') return ['입력 완료', 'success'];
    if (item.status === 'expired' || (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now())) return ['만료됨', 'muted'];
    return ['고객 입력 대기', 'pending'];
  }

  function deliveryLabel(status) {
    if (status === 'sent') return '문자 접수';
    if (status === 'failed') return '문자 접수 실패';
    if (status === 'unknown') return '문자 접수 확인 필요';
    return '문자 접수 대기';
  }

  function renderRequests(s) {
    if (!isCurrent(s)) return;
    s.list.replaceChildren();
    if (!s.requests.length) {
      s.list.append(node('p', 'snote-intake-empty', s.loaded ? '이 차량의 고객 입력 요청이 없습니다.' : '요청 내역을 아직 확인하지 못했습니다.'));
      return;
    }
    for (const item of s.requests.slice(0, 5)) {
      const [label, tone] = requestStatus(item);
      const row = node('li', 'snote-intake-request');
      const summary = node('div', 'snote-intake-summary');
      const heading = node('div', 'snote-intake-request-heading');
      heading.append(node('strong', '', phoneFormat(text(item.phone)) || '연락처 확인 필요'), node('span', 'snote-intake-badge is-' + tone, label));
      summary.append(heading);
      const detail = [deliveryLabel(item.deliveryStatus)];
      const expiry = timestamp(item.expiresAt);
      if (expiry) detail.push('만료 ' + expiry);
      summary.append(node('p', 'snote-intake-meta', detail.join(' · ')));
      row.append(summary);
      const actions = node('div', 'snote-intake-row-actions');
      if (item.submission && (item.submittedAt || item.status === 'submitted')) {
        actions.append(button('입력정보 불러오기', 'snote-intake-button is-load', () => loadSubmission(s, item)));
      }
      if (!item.revokedAt && item.status !== 'revoked' && label !== '만료됨') {
        actions.append(button('요청 취소', 'snote-intake-button is-quiet', () => revoke(s, item)));
      }
      if (actions.childElementCount) row.append(actions);
      s.list.append(row);
    }
    controls(s);
  }

  function schedule(s) {
    clearTimeout(s.timer);
    if (!isCurrent(s) || document.hidden || s.blocked) return;
    s.timer = setTimeout(() => refresh(s, false), 10000);
  }

  async function refresh(s, manual) {
    if (!isCurrent(s) || document.hidden || s.reading || s.busy) { schedule(s); return; }
    s.reading = true;
    controls(s);
    if (manual) message(s, '요청 내역을 확인하는 중입니다.');
    try {
      const result = await request(s, 'list', { carId: s.carId });
      if (!isCurrent(s)) return;
      if (!Array.isArray(result.requests)) throw {};
      s.requests = result.requests.filter(item => item && typeof item.id === 'string');
      const wasBlocked = s.blocked;
      s.blocked = false;
      s.loaded = true;
      if (s.link && !s.requests.some(item => item.id === s.link.id && !item.revokedAt &&
          item.status !== 'revoked' && item.status !== 'expired' &&
          !(item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()))) s.link = null;
      renderRequests(s);
      if (manual || wasBlocked) message(s, '요청 내역을 확인했습니다.');
    } catch (error) {
      if (!isCurrent(s)) return;
      if ([401, 403, 503].includes(error?.status)) s.blocked = true;
      message(s, failure(error, 'list'), 'error');
    } finally {
      if (isCurrent(s)) { s.reading = false; controls(s); schedule(s); }
    }
  }

  async function create(s) {
    if (!isCurrent(s) || s.busy || s.reading || s.blocked || !s.canCreate) return;
    const phone = digits(s.phone.value);
    if (!/^(?:010\d{8}|01[16789]\d{7,8})$/.test(phone)) {
      message(s, '문자를 받을 휴대전화 번호를 확인해 주세요.', 'error');
      s.phone.focus();
      return;
    }
    if (s.requests.some(item => requestStatus(item)[1] === 'pending') &&
        !window.confirm('새 링크를 보내면 이전에 보낸 입력 대기 링크는 취소됩니다. 새로 보내시겠습니까?')) return;
    s.busy = true;
    clearTimeout(s.timer);
    controls(s);
    message(s, '차량 정보를 저장한 뒤 문자 요청을 접수합니다.');
    let sent = false;
    try {
      const saved = await s.cloud.flush();
      if (!isCurrent(s)) return;
      if (saved?.ok !== true || s.cloud.conflict) {
        message(s, '차량 정보가 아직 서버에 저장되지 않았습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.', 'error');
        return;
      }
      const context = currentContext();
      if (!context.car || context.car.ownerId !== s.username || context.car.status === '판매완료') {
        message(s, '차량 상태가 변경되었습니다. 판매 창을 다시 열어 주세요.', 'error');
        return;
      }
      // A lost create response may already have invalidated the previous invitation.
      s.link = null;
      sent = true;
      const result = await request(s, 'create', { carId: s.carId, phone });
      if (!isCurrent(s)) return;
      const item = result.request;
      if (!item || typeof item.id !== 'string') throw {};
      // A raw invitation link is retained only for this open modal, never in DOM or storage.
      s.link = safeLink(result.link) ? { id: item.id, value: result.link } : null;
      s.requests = [{ ...item, phone, status: 'pending' }, ...s.requests.filter(row => row.id !== item.id)
        .map(row => requestStatus(row)[1] === 'pending' ? { ...row, status: 'revoked' } : row)].slice(0, 5);
      renderRequests(s);
      const copyNotice = s.link ? '' : ' 링크 복사는 서비스 주소 설정을 확인한 뒤 이용해 주세요.';
      if (item.deliveryStatus === 'sent') message(s, '문자 접수가 완료되었습니다. 실제 수신 여부는 고객에게 확인해 주세요.' + copyNotice, 'success');
      else if (item.deliveryStatus === 'failed') message(s, '입력 링크는 생성됐지만 문자 접수에 실패했습니다.' + (s.link ? ' 링크 복사로 전달할 수 있습니다.' : copyNotice), 'error');
      else message(s, '입력 링크는 생성됐지만 문자 접수 여부는 확인되지 않았습니다. 중복 발송 전에 고객 수신 여부를 확인해 주세요.' + copyNotice, 'error');
    } catch (error) {
      if (isCurrent(s)) {
        if (['DB_SETUP_REQUIRED', 'SERVER_SETUP_REQUIRED', 'SERVICE_UNAVAILABLE', 'NOT_CONFIGURED', 'SETUP_REQUIRED'].includes(error?.code)) s.blocked = true;
        message(s, sent ? failure(error, 'create') : '차량 정보를 저장하지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.', 'error');
      }
    } finally {
      if (isCurrent(s)) { s.busy = false; controls(s); schedule(s); }
    }
  }

  function safeLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && url.origin === window.location.origin &&
        url.pathname === '/customer.html' && !url.search && /^#[a-f0-9]{64}$/.test(url.hash);
    } catch (_) { return false; }
  }

  async function copy(s) {
    if (!isCurrent(s) || !s.link || s.busy) return;
    const value = s.link.value;
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent(s) && s.link?.value === value) message(s, '입력 링크를 복사했습니다.', 'success');
    } catch (_) {
      message(s, '링크를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.', 'error');
    }
  }

  async function revoke(s, item) {
    if (!isCurrent(s) || s.busy || s.reading || !window.confirm('이 고객 입력 요청을 취소하시겠습니까? 제출된 기록은 보관 기간 동안 유지됩니다.')) return;
    s.busy = true;
    clearTimeout(s.timer);
    controls(s);
    try {
      await request(s, 'revoke', { id: item.id });
      if (!isCurrent(s)) return;
      item.revokedAt = new Date().toISOString();
      item.status = 'revoked';
      if (s.link?.id === item.id) s.link = null;
      renderRequests(s);
      message(s, '고객 입력 요청을 취소했습니다.', 'success');
    } catch (error) {
      if (isCurrent(s)) message(s, failure(error, 'revoke'), 'error');
    } finally {
      if (isCurrent(s)) { s.busy = false; controls(s); schedule(s); }
    }
  }

  function loadSubmission(s, item) {
    if (!isCurrent(s) || s.busy || s.reading || !item.submission || typeof zc74LoadCustomer !== 'function') return;
    if (typeof zc72SaleLoading !== 'undefined' && zc72SaleLoading) {
      message(s, '계약서 저장이 끝난 뒤 입력정보를 불러와 주세요.', 'error');
      return;
    }
    if (formValues() !== s.baseline && !window.confirm('판매 정보에 수정한 내용이 있습니다. 고객이 제출한 입력정보로 바꾸시겠습니까? 주민번호는 유지됩니다.')) return;
    if (!isCurrent(s)) return;
    const source = item.submission;
    const values = {};
    for (const field of ['name', 'addressBase', 'addressDetail', 'mailingBase', 'mailingDetail', 'refundBank', 'refundAccount', 'refundHolder']) values[field] = text(source[field]);
    values.sameAddress = source.sameAddress === true;
    values.phone = phoneFormat(text(source.phone) || text(item.phone));
    const bank = byId('zc74-refund-bank');
    if (bank && values.refundBank && values.refundBank.length <= 35 &&
        !Array.from(bank.options).some(option => option.value === values.refundBank)) {
      const option = node('option', '', values.refundBank);
      option.value = values.refundBank;
      bank.append(option);
    }
    zc74LoadCustomer(values);
    // Existing input listeners mark the sale draft; no customer record or contract is saved here.
    for (const id of FIELDS) byId(id)?.dispatchEvent(new Event('input', { bubbles: true }));
    s.baseline = formValues();
    message(s, '판매 입력칸에 불러왔습니다. 내용을 확인한 뒤 기존 계약서·인수증 절차로 저장해 주세요.', 'success');
  }

  function unavailable(panel, content) {
    panel.append(node('h3', 'snote-intake-heading', '고객 직접 입력'), node('p', 'snote-intake-note', content));
  }

  function open() {
    close();
    const panel = byId('snote-intake-panel');
    if (!panel) return;
    panel.classList.add('snote-intake');
    const context = currentContext();
    if (!context.user || context.cloud?.ready !== true || typeof context.cloud.getAccessToken !== 'function' || typeof context.cloud.flush !== 'function') {
      unavailable(panel, '온라인 계정으로 로그인한 뒤 고객 입력 링크를 보낼 수 있습니다.');
      return;
    }
    if (!context.car || context.carId !== context.activeId || context.user.role === 'accountant') {
      unavailable(panel, '담당 차량의 판매 창에서 이용해 주세요.');
      return;
    }
    if (context.car.ownerId !== context.user.username) {
      unavailable(panel, '본인 담당 차량만 링크를 보낼 수 있습니다. 이 차량의 담당 딜러에게 요청해 주세요.');
      return;
    }
    const s = {
      id: sequence, username: context.user.username, role: context.user.role, carId: context.carId,
      cloud: context.cloud, canCreate: context.car.status !== '판매완료', controllers: new Set(),
      requests: [], link: null, busy: false, reading: false, blocked: false, loaded: false, timer: null,
      baseline: formValues()
    };
    state = s;
    const head = node('div', 'snote-intake-head');
    head.append(node('h3', 'snote-intake-heading', '고객 직접 입력'));
    s.refresh = button('새로고침', 'snote-intake-button is-quiet', () => refresh(s, true));
    head.append(s.refresh);
    const note = node('p', 'snote-intake-note', '고객이 문자 인증 후 정보를 입력합니다. 휴대전화 소지 확인이며, 실명·본인확인 서비스가 아닙니다.');
    const line = node('div', 'snote-intake-compose');
    const label = node('label', 'snote-intake-phone-label', '문자 받을 휴대전화');
    label.htmlFor = 'snote-intake-phone';
    s.phone = node('input', 'snote-intake-phone');
    s.phone.id = 'snote-intake-phone';
    s.phone.type = 'tel';
    s.phone.inputMode = 'tel';
    s.phone.autocomplete = 'off';
    s.phone.maxLength = 20;
    s.phone.placeholder = '010-0000-0000';
    s.phone.value = phoneFormat(byId('zc72-phone')?.value || '');
    s.phone.addEventListener('input', () => { s.phone.value = phoneFormat(s.phone.value); });
    label.append(s.phone);
    s.create = button('입력 링크 문자 보내기', 'snote-intake-button is-primary', () => create(s));
    s.copy = button('최근 링크 복사', 'snote-intake-button', () => copy(s));
    line.append(label, s.create, s.copy);
    s.message = node('p', 'snote-intake-message');
    s.message.setAttribute('role', 'status');
    s.message.setAttribute('aria-live', 'polite');
    s.list = node('ul', 'snote-intake-list');
    s.list.setAttribute('aria-label', '고객 입력 요청 내역');
    panel.append(head, note, line, s.message, s.list,
      node('p', 'snote-intake-footnote', '새 링크를 보내면 이전 입력 대기 링크는 취소됩니다. 링크는 24시간 동안 유효하며, 복사는 이 창에서 생성한 최근 링크만 가능합니다.'));
    if (!s.canCreate) message(s, '판매완료 차량은 새 링크를 보낼 수 없습니다. 기존 요청 내역만 확인할 수 있습니다.');
    renderRequests(s);
    const observer = new MutationObserver(() => { if (!isCurrent(s)) close(); });
    s.observer = observer;
    for (const element of [byId('zc72-sale-modal'), byId('zc-cloud-gate'), byId('auth-shell')]) {
      if (element) observer.observe(element, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    refresh(s, false);
  }

  document.addEventListener('visibilitychange', () => {
    const s = state;
    if (!s) return;
    clearTimeout(s.timer);
    if (!isCurrent(s)) { close(); return; }
    if (!document.hidden) refresh(s, false);
  });
  window.addEventListener('pagehide', close);
  window.snoteIntakeOpen = open;
  window.snoteIntakeClose = close;
})();
