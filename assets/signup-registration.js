/* Public registration form. The same-origin service owns duplicate checks, private files and roles. */
(() => {
  'use strict';
  if (window.SnoteRegistration) return;
  const form = document.getElementById('snote-registration-form');
  if (!form) return;
  const gate = document.getElementById('zc-cloud-gate'), prefix = 'snote-registration-';
  const input = name => document.getElementById(prefix + name);
  const status = input('company-status'), checkButton = input('company-check'), submit = input('submit');
  const API = '/api/registration', MAX_FILE = 5 * 1024 * 1024;
  const COMPANY_EXISTS = '등록되어 있는 상사입니다. 채팅으로 문의 부탁드립니다';
  const CONTACT_EXISTS = '가입된 이메일 또는 휴대번 입니다.';
  const UNKNOWN = '가입 요청의 처리 상태를 확인하지 못했습니다. 인증 메일을 확인하거나 로그인해 주세요. 가입 요청을 반복해서 보내지 마세요.';
  const fields = ['company', 'business', 'owner', 'address', 'name', 'phone', 'email'];
  let mode = null, generation = 0, checked = '', checking = null, sending = null, addressRevision = 0;
  let addressSession = null;
  const company = () => input('company').value.trim();
  const live = (kind, version) => mode === kind && generation === version && !gate.hidden && !form.hidden && gate.dataset.authMode === (kind === 'representative' ? 'admin' : 'dealer');
  const alert = (message, current = () => true) => window.snoteAlert(message, { tone: 'error', key: 'registration-error', isCurrent: current });
  function invalidateAddress() {
    ++addressRevision;
    closeAddress();
  }
  function addressContext() {
    if (!mode || sending || typeof currentUser === 'undefined' || currentUser !== null || window.zc86Cloud?.ready === true || !live(mode, generation)) return null;
    return Object.freeze({ kind: mode, generation, revision: addressRevision, element: input('address'), actor: currentUser });
  }
  function addressCurrent(context) {
    const now = addressContext();
    return !!context && !!now && ['kind', 'generation', 'revision', 'element', 'actor'].every(key => context[key] === now[key]);
  }
  function closeAddress() {
    const previous = addressSession; addressSession = null;
    if (!previous) return;
    clearTimeout(previous.timer); clearInterval(previous.watch);
    try { previous.popup.close(); } catch (_) {}
  }
  function openAddress() {
    const context = addressContext(); if (!context) return false;
    closeAddress(); let nonce;
    try { nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''); }
    catch (_) { void alert('주소 검색을 열지 못했습니다. 주소를 직접 입력해 주세요.', () => addressCurrent(context)); return false; }
    const url = new URL('/address-search.html', location.origin); url.searchParams.set('parentOrigin', location.origin); url.hash = nonce;
    let popup;
    try { popup = window.open(url.toString(), 'snote_signup_address_' + nonce, 'width=560,height=750,resizable=yes,scrollbars=yes'); } catch (_) {}
    if (!popup) { void alert('주소 검색창이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 눌러 주세요. 주소를 직접 입력할 수도 있습니다.', () => addressCurrent(context)); return false; }
    const session = { context, nonce, popup, timer: null, watch: null }; addressSession = session;
    const fail = () => { if (addressSession !== session || !addressCurrent(context)) return; closeAddress(); void alert('주소 검색을 불러오지 못했습니다. 다시 시도하거나 주소를 직접 입력해 주세요.', () => addressCurrent(context)); };
    session.timer = setTimeout(fail, 15000);
    session.watch = setInterval(() => { if (addressSession !== session) return; try { if (!addressCurrent(context) || popup.closed) closeAddress(); } catch (_) { closeAddress(); } }, 500);
    try { popup.focus(); } catch (_) {}
    return true;
  }
  window.addEventListener('message', event => {
    const session = addressSession, data = event.data;
    if (!session || event.origin !== location.origin || event.source !== session.popup || !data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'SNOTE_CUSTOMER_ADDRESS' || data.nonce !== session.nonce) return;
    if (!addressCurrent(session.context)) { closeAddress(); return; }
    if (data.kind === 'ready') { clearTimeout(session.timer); return; }
    if (data.kind === 'closed') { closeAddress(); return; }
    if (data.kind === 'error') { const context = session.context; closeAddress(); void alert('주소 검색을 불러오지 못했습니다. 다시 시도하거나 주소를 직접 입력해 주세요.', () => addressCurrent(context)); return; }
    if (data.kind !== 'selected' || typeof data.address !== 'string' || !data.address.trim() || data.address.length > 200 || /[\u0000-\u001f\u007f]/.test(data.address) || data.postcode && (typeof data.postcode !== 'string' || !/^\d{5}$/.test(data.postcode))) return;
    const context = session.context, field = context.element; closeAddress();
    field.value = data.address.trim(); field.dataset.postcode = data.postcode || '';
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
    const now = addressContext(); if (now?.generation === context.generation && now.element === field) { field.focus({ preventScroll: true }); field.setSelectionRange(field.value.length, field.value.length); }
  });
  const digits = value => String(value || '').replace(/\D/g, '');
  function formattedNumber(value, kind) {
    const normalized = kind === 'phone' ? String(value).replace(/^\s*\+82[\s()-]*/, '0') : String(value);
    const number = digits(normalized).slice(0, kind === 'business' ? 10 : 11);
    const middle = kind === 'business' ? 2 : number.startsWith('010') || number.length === 11 ? 4 : 3;
    return number.length <= 3 ? number : number.length <= 3 + middle ? number.slice(0, 3) + '-' + number.slice(3) : number.slice(0, 3) + '-' + number.slice(3, 3 + middle) + '-' + number.slice(3 + middle);
  }
  function caretForDigits(value, ordinal) {
    if (!ordinal) return 0;
    let count = 0;
    for (let index = 0; index < value.length; index++) if (/\d/.test(value[index]) && ++count === ordinal) return index + 1;
    return value.length;
  }
  function numericInput(element, kind) {
    let composing = false;
    function apply(value, start, end = start) {
      const next = formattedNumber(value, kind);
      if (next === value) return;
      const count = position => digits(kind === 'phone' ? value.slice(0, position).replace(/^\s*\+82[\s()-]*/, '0') : value.slice(0, position)).length;
      element.value = next;
      element.setSelectionRange(caretForDigits(next, count(start)), caretForDigits(next, count(end)));
    }
    element.addEventListener('beforeinput', event => {
      if (composing || !['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) return;
      const start = element.selectionStart, end = element.selectionEnd, value = element.value;
      if (start !== end || value[event.inputType === 'deleteContentBackward' ? start - 1 : start] !== '-') return;
      const ordinal = digits(value.slice(0, start)).length, remove = event.inputType === 'deleteContentBackward' ? ordinal - 1 : ordinal;
      const number = digits(value); if (remove < 0 || remove >= number.length) return;
      // A separator is formatting: deleting beside it removes the adjacent digit once.
      event.preventDefault(); element.value = formattedNumber(number.slice(0, remove) + number.slice(remove + 1), kind);
      const caret = caretForDigits(element.value, event.inputType === 'deleteContentBackward' ? ordinal - 1 : ordinal);
      element.setSelectionRange(caret, caret); element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    element.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain'); if (typeof text !== 'string') return;
      event.preventDefault(); const start = element.selectionStart, end = element.selectionEnd;
      const value = element.value.slice(0, start) + text + element.value.slice(end), caret = start + text.length;
      element.value = value; element.setSelectionRange(caret, caret); apply(value, caret);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    element.addEventListener('compositionstart', () => { composing = true; });
    element.addEventListener('compositionend', () => { composing = false; apply(element.value, element.selectionStart, element.selectionEnd); });
    element.addEventListener('input', () => { if (!composing) apply(element.value, element.selectionStart, element.selectionEnd); });
    element.addEventListener('change', () => apply(element.value, element.selectionStart, element.selectionEnd));
  }
  function clearCheck() {
    checked = ''; status.textContent = ''; status.hidden = true; delete status.dataset.state;
    if (checking) { checking.controller.abort(); checking = null; }
    checkButton.disabled = !!sending; checkButton.textContent = '확인'; checkButton.removeAttribute('aria-busy');
  }
  function file(name) {
    const value = input(name).files?.[0];
    if (!value || !['image/jpeg', 'image/png', 'image/webp'].includes(value.type) || !value.size || value.size > MAX_FILE) throw Error('사업자등록증과 딜러증(매매사원증)을 JPG·PNG·WebP 이미지로 각각 5MB 이하로 첨부해 주세요.');
    return value;
  }
  function busy(value) {
    form.setAttribute('aria-busy', String(value));
    for (const control of form.querySelectorAll('input,button')) control.disabled = value;
    submit.textContent = value ? '가입 처리 중…' : mode === 'dealer' ? '일반딜러 가입하기' : '상사대표 가입하기';
  }
  function matchPassword() {
    input('password-confirm').setCustomValidity(input('password-confirm').value && input('password').value !== input('password-confirm').value ? '비밀번호가 일치하지 않습니다.' : '');
  }
  function show(kind) {
    const next = ['representative', 'dealer'].includes(kind) ? kind : null;
    ++generation; invalidateAddress(); clearCheck(); mode = next;
    // Leaving a form or switching registration type never retains passwords or selected documents.
    form.reset(); matchPassword();
    form.querySelector('[data-registration-name-label]').textContent = next === 'dealer' ? '딜러 성명' : '관리자 성명';
    form.querySelector('[data-registration-phone-label]').textContent = next === 'dealer' ? '딜러 휴대전화' : '관리자 휴대전화';
    input('name').placeholder = next === 'dealer' ? '딜러 성명' : '관리자 성명';
    busy(!!sending);
  }
  async function request(body, controller, isJson = false, signup = false) {
    let response;
    try {
      response = await fetch(API, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        ...(isJson ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { body }) });
    } catch (_) { throw Object.assign(Error(signup ? UNKNOWN : '상사명 확인 중 연결이 끊겼습니다. 다시 확인해 주세요.'), { code: signup ? 'AUTH_STATUS_UNKNOWN' : 'NETWORK' }); }
    let result;
    try { result = await response.json(); } catch (_) { throw Object.assign(Error(signup ? UNKNOWN : '상사명 확인 결과를 읽지 못했습니다. 다시 확인해 주세요.'), { code: signup ? 'AUTH_STATUS_UNKNOWN' : 'NETWORK' }); }
    if (!response.ok || result?.ok !== true) {
      const code = typeof result?.code === 'string' ? result.code : 'NETWORK';
      throw Object.assign(Error(code === 'COMPANY_EXISTS' ? COMPANY_EXISTS : code === 'CONTACT_EXISTS' ? CONTACT_EXISTS : code === 'AUTH_STATUS_UNKNOWN' ? UNKNOWN : typeof result?.error === 'string' ? result.error.slice(0, 500) : '가입 서비스에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.'), { code });
    }
    return result;
  }
  async function checkCompany() {
    if (!mode || sending || checking) return;
    const name = company(), kind = mode, version = generation;
    if (name.length < 2 || name.length > 100) { await alert('상사명은 2~100자로 입력해 주세요.', () => live(kind, version)); input('company').focus(); return; }
    clearCheck();
    const operation = { controller: new AbortController() }; checking = operation;
    const current = () => checking === operation && live(kind, version) && company() === name;
    checkButton.disabled = true; checkButton.textContent = '확인 중'; checkButton.setAttribute('aria-busy', 'true');
    const timer = setTimeout(() => operation.controller.abort(), 20000);
    try {
      const result = await request({ action: 'check-company', companyName: name }, operation.controller, true);
      if (!current()) return;
      if (result.available !== true) { await alert(COMPANY_EXISTS, current); return; }
      checked = name; status.hidden = false; status.dataset.state = 'available';
      status.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg><span>사용 가능한 상사명입니다.</span>';
    } catch (error) { if (current()) await alert(error.message, current); }
    finally { clearTimeout(timer); if (checking === operation) { checking = null; checkButton.disabled = false; checkButton.textContent = '확인'; checkButton.removeAttribute('aria-busy'); } }
  }
  async function register(event) {
    event.preventDefault();
    if (!mode || sending) return;
    matchPassword(); if (!form.reportValidity()) return;
    const kind = mode, version = generation, currentView = () => live(kind, version);
    if (!checked || checked !== company()) { await alert('상사명 옆 확인 버튼을 먼저 눌러 주세요.', currentView); return; }
    const values = Object.fromEntries(fields.map(name => [name, input(name).value.trim()]));
    const profile = { kind, companyName: values.company, businessNumber: values.business.replace(/\D/g, ''), representativeName: values.owner, businessAddress: values.address, displayName: values.name, phone: values.phone.replace(/\D/g, ''), email: values.email.toLowerCase() };
    let certificate, license;
    try { certificate = file('business-certificate'); license = file('dealer-license'); } catch (error) { await alert(error.message, currentView); return; }
    const password = input('password').value, operation = { controller: new AbortController(), authority: null }; sending = operation; busy(true); invalidateAddress();
    const bridge = window.snoteRegistrationBridge;
    let timer;
    try {
      operation.authority = await bridge.capture();
      const current = () => sending === operation && currentView() && bridge.current(operation.authority) === true;
      if (!operation.authority || !current()) return;
      const body = new FormData(); body.set('profile', JSON.stringify(profile)); body.set('password', password); body.set('businessCertificate', certificate); body.set('dealerLicense', license);
      timer = setTimeout(() => operation.controller.abort(), 120000);
      const result = await request(body, operation.controller, false, true);
      if (!current()) return;
      if (typeof result.email !== 'string' || result.email.trim().toLowerCase() !== profile.email || typeof result.confirmationRequired !== 'boolean' || result.confirmationRequired && result.session !== null || !result.confirmationRequired && !result.session) throw Object.assign(Error(UNKNOWN), { code: 'AUTH_STATUS_UNKNOWN' });
      if (result.confirmationRequired) bridge.pending(operation.authority, profile.email);
      else await bridge.accept(operation.authority, result, password);
    } catch (error) {
      const current = () => sending === operation && currentView() && (!operation.authority || bridge.current(operation.authority) === true);
      if (current()) {
        const code = ['COMPANY_EXISTS', 'CONTACT_EXISTS', 'AUTH_STATUS_UNKNOWN'].find(value => error.code === value || String(error.message || '').includes(value));
        if (code === 'COMPANY_EXISTS') clearCheck();
        const message = code === 'COMPANY_EXISTS' ? COMPANY_EXISTS : code === 'CONTACT_EXISTS' ? CONTACT_EXISTS : code === 'AUTH_STATUS_UNKNOWN' ? UNKNOWN : /REGISTRATION_CONTEXT_CHANGED|REGISTRATION_INVALID_SESSION/.test(String(error.message || '')) ? '로그인 상태가 변경되었습니다. 인증 메일을 확인하거나 다시 로그인해 주세요.' : /[가-힣]/.test(String(error.message || '')) ? error.message : '가입 처리를 확인하지 못했습니다. 인증 메일을 확인한 뒤 로그인해 주세요.';
        await alert(message, current);
        if (code === 'AUTH_STATUS_UNKNOWN' && current() && operation.authority) bridge.pending(operation.authority, profile.email, true);
      }
    } finally {
      clearTimeout(timer); bridge?.finish(operation.authority);
      if (sending === operation) { sending = null; busy(false); input('password').value = ''; input('password-confirm').value = ''; matchPassword(); }
    }
  }
  input('company').addEventListener('input', clearCheck);
  numericInput(input('business'), 'business'); numericInput(input('phone'), 'phone');
  for (const event of ['input', 'change', 'reset']) form.addEventListener(event, invalidateAddress);
  checkButton.addEventListener('click', checkCompany); form.addEventListener('submit', register);
  for (const name of ['password', 'password-confirm']) input(name).addEventListener('input', matchPassword);
  function authChanged() { ++generation; invalidateAddress(); clearCheck(); form.reset(); matchPassword(); if (sending) sending.controller.abort(); }
  window.addEventListener('pagehide', () => { authChanged(); form.reset(); });
  window.SnoteRegistration = Object.freeze({ show, authChanged, addressContext, addressCurrent, openAddress });
  show(gate.dataset.authMode === 'admin' ? 'representative' : gate.dataset.authMode === 'dealer' ? 'dealer' : null);
})();
