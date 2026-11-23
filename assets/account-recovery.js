/* Registered-contact recovery. Verification data stays inside this opening only. */
(() => {
 'use strict';
 if (window.SnoteAccountRecovery || window.SnoteRecoveryRedirecting) return;
 const API = '/api/account-recovery', REQUEST_TIMEOUT = 25000;
 const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
 let dialog, fields, state = null, sequence = 0;
 const byId = id => document.getElementById(id);
 const digits = value => String(value || '').replace(/\D/g, '');
 const normalizedName = value => String(value || '').normalize('NFC').trim();
 const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
 const phone = value => { const d = digits(value).slice(0, 11); return d.length <= 3 ? d : d.length <= 7 ? d.slice(0, 3) + '-' + d.slice(3) : d.length <= 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7); };
 function nonce() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
 }
 function bridge() { return typeof window.snoteRecoveryAvailable === 'function' ? window.snoteRecoveryAvailable : null; }
 function allowed() { try { return !window.SnoteRecoveryRedirecting && (!bridge() || bridge()() === true); } catch (_) { return false; } }
 function context(s) {
  if (!s || location.href !== s.url || bridge() !== s.bridge || !allowed()) return false;
  const gate = byId('zc-cloud-gate');
  return !gate || !gate.hidden && (gate.dataset.authMode || 'login') === 'login';
 }
 function current(s) { return state === s && s.id === sequence && dialog?.open === true && context(s); }
 function status(s, text = '', tone = '') { if (current(s)) { fields.status.textContent = text; fields.status.dataset.tone = tone; } }
 function clearSecrets(s) {
  if (s) { s.token = null; s.challengeId = null; s.email = null; s.sendAttempt = null; s.resetAttempt = null; }
  if (fields) { for (const name of ['name', 'phone', 'code', 'password', 'confirm']) fields[name].value = ''; fields.result.textContent = ''; }
 }
 function dispose({ restoreFocus = true, keepOpen = false } = {}) {
  const previous = state; state = null; sequence++;
  if (previous) { clearTimeout(previous.timer); for (const controller of previous.controllers) controller.abort(); previous.controllers.clear();
   for (const key of previous.messages) window.SnoteMessages?.dismiss?.(key); clearSecrets(previous); }
  else clearSecrets(null);
  if (!keepOpen && dialog?.open) dialog.close();
  if (restoreFocus && previous?.focus?.isConnected && context(previous)) try { previous.focus.focus({ preventScroll: true }); } catch (_) {}
 }
 function notify(s, text, tone = 'error', field = null) {
  if (!current(s)) return;
  status(s, text, tone);
  const key = 'account-recovery:' + s.id + ':' + ++s.messageId; s.messages.add(key);
  const options = { title: tone === 'success' ? '완료' : '확인해 주세요', tone, key, isCurrent: () => current(s), returnFocus: () => field?.isConnected ? field : fields.submit };
  try {
   const api = window.SnoteMessages;
   if (api?.notify) api.notify(text, options);
   else if (typeof window.snoteAlert === 'function') void window.snoteAlert(text, options);
   else field?.focus();
  } catch (_) { field?.focus(); }
 }
 async function acknowledgement(s, text) {
  if (!current(s)) return false;
  const key = 'account-recovery:' + s.id + ':complete'; s.messages.add(key);
  try {
   if (window.SnoteMessages?.alert) return await window.SnoteMessages.alert(text, { title: '완료', tone: 'success', key, isCurrent: () => current(s), returnFocus: false }) === true && current(s);
   if (typeof window.snoteAlert === 'function') return await window.snoteAlert(text, { title: '완료', tone: 'success', key, isCurrent: () => current(s), returnFocus: false }) === true && current(s);
   status(s, text, 'success');
  } catch (_) { if (current(s)) status(s, text, 'success'); }
  return false;
 }
 function fit() {
  if (!dialog?.open) return;
  const view = window.visualViewport;
  dialog.style.setProperty('--snote-recovery-height', Math.min(innerHeight, view?.height || innerHeight) + 'px');
  dialog.style.setProperty('--snote-recovery-top', (view?.offsetTop || 0) + 'px');
 }
 function controls(s) {
  if (!current(s)) return;
  const identity = s.stage === 'identity', code = s.stage === 'code', password = s.stage === 'password';
  fields.identity.hidden = !(identity || code); fields.codeSection.hidden = !code;
  fields.passwordSection.hidden = !password; fields.result.hidden = s.stage !== 'result'; fields.emailGuide.hidden = s.stage !== 'email';
  fields.name.readOnly = fields.phone.readOnly = !identity || s.busy;
  fields.code.readOnly = fields.password.readOnly = fields.confirm.readOnly = s.busy;
  const wait = Math.max(0, Math.ceil((s.retryAt - Date.now()) / 1000));
  fields.submit.disabled = s.busy || identity && wait > 0 || code && Date.now() >= s.expiresAt || password && (!s.token || Date.now() >= s.tokenExpiresAt);
  fields.submit.textContent = s.busy ? ({ send: '요청 중입니다…', verify: '확인 중입니다…', reset: '변경 중입니다…' }[s.action] || '처리 중입니다…') :
   identity ? wait ? '다시 요청 · ' + wait + '초' : '인증번호 받기' : code ? '인증번호 확인' : password ? '새 비밀번호 저장' : '로그인으로';
  fields.resend.hidden = !code; fields.resend.disabled = s.busy || wait > 0;
  fields.resend.textContent = wait ? '인증번호 다시 받기 · ' + wait + '초' : '인증번호 다시 받기';
  fields.back.hidden = identity || ['email', 'result'].includes(s.stage); fields.back.disabled = s.busy;
  fields.back.textContent = code ? '다른 번호로 다시 입력' : '처음부터 다시 인증';
 }
 function tick(s) {
  clearTimeout(s.timer); if (!current(s)) { if (state === s) dispose({ restoreFocus: false }); return; }
  if (s.stage === 'code') {
   const left = Math.max(0, Math.ceil((s.expiresAt - Date.now()) / 1000));
   fields.countdown.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
   if (!left && !s.expired && !s.busy) { s.expired = true; fields.code.value = ''; status(s, '인증번호 유효시간이 지났습니다. 새 인증번호를 받아 주세요.', 'error'); }
   const ready = Date.now() >= s.retryAt;
   if (ready && !s.resendReady) { s.resendReady = true; if (!s.expired && !s.busy) status(s, '인증번호를 다시 받을 수 있습니다.'); }
  }
  if (s.stage === 'password' && !s.busy && s.token && Date.now() >= s.tokenExpiresAt) {
   s.token = null; fields.password.value = fields.confirm.value = ''; status(s, '인증 확인 시간이 지났습니다. 처음부터 다시 인증해 주세요.', 'error');
  }
  controls(s); s.timer = setTimeout(() => tick(s), 1000);
 }
 function focus(s, field) { requestAnimationFrame(() => { if (current(s)) { fit(); field.focus({ preventScroll: true }); } }); }
 async function request(s, body, valid) {
  if (!current(s) || !valid()) throw { code: 'STALE' };
  const controller = new AbortController(); s.controllers.add(controller);
  let timer, timedOut = false, onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject({ code: timedOut ? 'NETWORK_ERROR' : 'STALE' }); controller.signal.addEventListener('abort', onAbort, { once: true }); });
  timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
  try {
   const pending = fetch(API, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
   const parsed = Promise.resolve(pending).then(async response => {
    if (!valid()) throw { code: 'STALE' };
    let value; try { value = await response.json(); } catch (_) { throw { code: 'SERVER_ERROR' }; }
    if (!valid()) throw { code: 'STALE' };
    if (!response.ok || value?.ok !== true) throw { code: typeof value?.code === 'string' ? value.code : 'SERVER_ERROR', retryAfter: value?.retryAfter,
     requiresEmail: value?.requiresEmail === true, delivery: ['sent', 'failed', 'unknown', 'pending'].includes(value?.delivery) ? value.delivery : 'unknown' };
    return value;
   });
   return await Promise.race([parsed, aborted]);
  } catch (error) { if (!current(s) || !valid()) throw { code: 'STALE' }; throw error?.code ? error : { code: 'NETWORK_ERROR' }; }
  finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); s.controllers.delete(controller); }
 }
 function error(s, failure, phase, target = null) {
  if (!current(s) || failure?.code === 'STALE') return;
  const code = failure?.code || 'SERVER_ERROR';
  if (Number.isFinite(failure?.retryAfter) && failure.retryAfter > 0) s.retryAt = Date.now() + Math.min(3600, failure.retryAfter) * 1000;
  const invalid = ['INVALID_CODE', 'CODE_INVALID', 'OTP_INVALID'].includes(code), expired = /(?:EXPIRED|LOCKED|TOO_MANY_ATTEMPTS)/.test(code);
  if (phase === 'verify' && expired) { s.expiresAt = Date.now(); fields.code.value = ''; }
  if (phase === 'reset' && /TOKEN|EXPIRED|ALREADY_RESET|REQUEST_UNAVAILABLE|PROOF_CONSUMED|REQUEST_REUSED|RESET_FAILED/.test(code)) { s.token = null; fields.password.value = fields.confirm.value = ''; }
  const text = invalid ? '인증번호가 일치하지 않습니다. 다시 확인해 주세요.' : expired ? '인증 유효시간이나 확인 횟수를 초과했습니다. 새 인증번호를 받아 주세요.' :
   /RATE_LIMIT|TOO_MANY_REQUEST/.test(code) ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' :
   /PASSWORD/.test(code) ? '10~128자의 새 비밀번호를 확인해 주세요. 더 안전한 비밀번호가 필요할 수 있습니다.' :
   phase === 'reset' && /NETWORK|RESET_UNKNOWN|RESET_PENDING|PROOF_CONSUMED/.test(code) ? '비밀번호 변경 결과를 확인하지 못했습니다. 새 비밀번호로 로그인을 확인하거나 같은 내용으로 다시 확인해 주세요.' :
   phase === 'reset' && code === 'RESET_FAILED' ? '비밀번호를 변경하지 못했습니다. 새 비밀번호 기준을 확인하고 처음부터 다시 인증해 주세요.' :
   phase === 'send' && /NETWORK|DELIVERY/.test(code) ? '인증번호 발송 결과를 확인하지 못했습니다. 문자메시지를 확인하고 잠시 후 다시 시도해 주세요.' :
   /EMAIL/.test(code) ? '이메일 인증 링크 발송 결과를 확인하지 못했습니다. 메일함을 확인하고 잠시 후 다시 요청해 주세요.' :
   /VALIDATION|PHONE|NAME/.test(code) ? '가입할 때 등록한 성명과 휴대전화 번호를 확인해 주세요.' : '인증 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  notify(s, text, 'error', target);
 }
 function identity() { return { name: normalizedName(fields.name.value), phone: digits(fields.phone.value) }; }
 function identityValid(s) {
  const value = identity();
  if (!value.name || [...value.name].length > 40 || /[\u0000-\u001f\u007f]/.test(value.name)) { notify(s, '가입할 때 등록한 성명을 입력해 주세요.', 'error', fields.name); return null; }
  if (!/^(?:010\d{8}|01[16789]\d{7,8})$/.test(value.phone)) { notify(s, '가입한 휴대전화 번호를 정확히 입력해 주세요.', 'error', fields.phone); return null; }
  return value;
 }
 async function send(s) {
  if (!current(s) || s.busy || Date.now() < s.retryAt) return;
  const value = identityValid(s); if (!value) return;
  const fingerprint = s.mode + ':' + value.name + ':' + value.phone, revision = s.revision;
  const valid = () => current(s) && s.revision === revision && JSON.stringify(identity()) === JSON.stringify(value);
  try {
   if (!s.sendAttempt || s.sendAttempt.fingerprint !== fingerprint) s.sendAttempt = { fingerprint, id: nonce() };
   s.busy = true; s.action = 'send'; fields.code.value = ''; s.token = null; s.retryAt = Date.now() + 60000;
   controls(s); status(s, '인증번호를 요청하고 있습니다.');
   const result = await request(s, { action: 'send-code', purpose: s.mode, ...value, requestId: s.sendAttempt.id }, valid);
   if (!valid()) return;
   const expiresAt = Date.parse(result.expiresAt);
   if (typeof result.challengeId !== 'string' || result.challengeId.length !== 36 || !UUID.test(result.challengeId) || !Number.isFinite(expiresAt)) throw { code: 'SERVER_ERROR' };
   s.challengeId = result.challengeId; s.expiresAt = expiresAt; s.retryAt = Date.now() + (Number.isFinite(result.retryAfter) ? Math.max(0, Math.min(3600, result.retryAfter)) : 60) * 1000;
   s.stage = 'code'; s.expired = false; s.resendReady = false; s.sendAttempt = null;
   status(s, '입력한 가입 정보와 일치하면 인증번호를 보내드립니다. 문자메시지를 확인해 주세요.'); focus(s, fields.code);
  } catch (failure) { error(s, failure, 'send', fields.phone); }
  finally { if (current(s) && s.revision === revision) { s.busy = false; controls(s); tick(s); } }
 }
 function emailGuide(s, delivery) {
  clearSecrets(s); s.stage = 'email';
  fields.emailGuide.textContent = delivery === 'sent' ? '등록된 이메일로 인증 링크를 보냈습니다. 이메일을 확인해 주세요.' :
   delivery === 'failed' ? '이메일 인증 링크를 보내지 못했습니다. 잠시 후 다시 요청해 주세요.' :
   '이메일 인증 링크 발송 결과를 확인하지 못했습니다. 메일함을 확인하고 받지 못했다면 잠시 후 다시 요청해 주세요.';
  const tip = document.createElement('p'); tip.textContent = '로그인 후 프로필에서 휴대전화 인증을 완료하면 다음부터 문자 인증으로 바로 복구할 수 있습니다.'; fields.emailGuide.append(tip);
  status(s, '', delivery === 'sent' ? 'success' : 'error'); controls(s);
 }
 async function verify(s) {
  if (!current(s) || s.busy || s.stage !== 'code') return;
  const code = digits(fields.code.value);
  if (!/^\d{6}$/.test(code)) { notify(s, '문자로 받은 인증번호 6자리를 입력해 주세요.', 'error', fields.code); return; }
  if (Date.now() >= s.expiresAt) { notify(s, '인증번호 유효시간이 지났습니다. 새 인증번호를 받아 주세요.', 'error', fields.code); return; }
  const revision = s.revision, challengeId = s.challengeId;
  const valid = () => current(s) && s.revision === revision && s.challengeId === challengeId && digits(fields.code.value) === code;
  s.busy = true; s.action = 'verify'; controls(s); status(s, '인증번호를 확인하고 있습니다.');
  try {
   const result = await request(s, { action: 'verify', purpose: s.mode, challengeId, code }, valid);
   if (!valid()) return;
   if (result.requiresEmail === true) { emailGuide(s, result.delivery); return; }
   if (s.mode === 'id') {
    const address = email(result.email); if (!address) throw { code: 'SERVER_ERROR' };
    clearSecrets(s); s.email = address; s.stage = 'result'; fields.result.textContent = address;
    status(s, '가입된 계정 ID를 확인했습니다.', 'success'); controls(s); focus(s, fields.submit);
   } else {
    const expiresAt = Date.parse(result.expiresAt);
    if (typeof result.resetToken !== 'string' || result.resetToken.length < 16 || result.resetToken.length > 4096 || /[\u0000-\u0020\u007f]/.test(result.resetToken) || !Number.isFinite(expiresAt)) throw { code: 'SERVER_ERROR' };
    s.token = result.resetToken; s.tokenExpiresAt = expiresAt; s.stage = 'password'; fields.code.value = ''; fields.name.value = fields.phone.value = '';
    status(s, '새로 사용할 비밀번호를 입력해 주세요.'); controls(s); focus(s, fields.password);
   }
  } catch (failure) { if (valid() && failure?.requiresEmail === true) emailGuide(s, failure.delivery); else error(s, failure, 'verify', fields.code); }
  finally { if (current(s) && s.revision === revision) { s.busy = false; controls(s); tick(s); } }
 }
 async function resetPassword(s) {
  if (!current(s) || s.busy || s.stage !== 'password') return;
  const password = fields.password.value, confirmation = fields.confirm.value;
  if (password.length < 10 || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) { notify(s, '새 비밀번호는 10~128자로 입력해 주세요.', 'error', fields.password); return; }
  if (password !== confirmation) { notify(s, '새 비밀번호와 확인 입력이 일치하지 않습니다.', 'error', fields.confirm); return; }
  if (!s.token || Date.now() >= s.tokenExpiresAt) { s.token = null; notify(s, '인증 확인 시간이 지났습니다. 처음부터 다시 인증해 주세요.'); controls(s); return; }
  const revision = s.revision, token = s.token, challengeId = s.challengeId;
  const valid = () => current(s) && s.revision === revision && s.token === token && s.challengeId === challengeId;
  s.busy = true; s.action = 'reset'; controls(s); status(s, '새 비밀번호를 저장하고 있습니다.');
  try {
   const encoded = new TextEncoder().encode(challengeId + ':' + token + ':' + password), digest = crypto.subtle.digest('SHA-256', encoded); encoded.fill(0);
   const fingerprint = Array.from(new Uint8Array(await digest), value => value.toString(16).padStart(2, '0')).join('');
   if (!valid() || fields.password.value !== password || fields.confirm.value !== confirmation) return;
   if (!s.resetAttempt || s.resetAttempt.fingerprint !== fingerprint) s.resetAttempt = { fingerprint, id: nonce() };
   const pending = request(s, { action: 'reset-password', challengeId, resetToken: token, password, requestId: s.resetAttempt.id }, valid);
   fields.password.value = fields.confirm.value = '';
   await pending; if (!valid()) return;
   clearSecrets(s); s.stage = 'complete'; s.busy = false; status(s, '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.', 'success'); controls(s);
   const shown = await acknowledgement(s, '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
   if (shown && current(s)) finish(s);
  } catch (failure) { if (current(s) && s.revision === revision) { fields.password.value = fields.confirm.value = ''; error(s, failure, 'reset'); } }
  finally { if (current(s) && s.revision === revision) { s.busy = false; controls(s); tick(s); } }
 }
 function finish(s) {
  if (!current(s)) return;
  const address = s.email, passwordChanged = s.mode === 'password' && s.stage === 'complete'; dispose({ restoreFocus: false });
  if (context(s)) {
   const field = byId('zc-cloud-email'); if (field && address) { field.value = address; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
   if (passwordChanged && byId('zc-cloud-password')) byId('zc-cloud-password').value = '';
   (address ? field : byId('zc-cloud-password') || field)?.focus();
  }
 }
 function invalidateInput(s, field) {
  if (!current(s)) return;
  if (field === fields.phone) {
   const count = digits(field.value.slice(0, field.selectionStart ?? field.value.length)).length;
   field.value = phone(field.value); let position = 0, seen = 0; while (position < field.value.length && seen < count) if (/\d/.test(field.value[position++])) seen++;
   try { field.setSelectionRange(position, position); } catch (_) {}
  }
  if (field === fields.code) field.value = digits(field.value).slice(0, 6);
  if (s.busy) { s.revision++; for (const controller of s.controllers) controller.abort(); s.busy = false; }
  if ([fields.name, fields.phone].includes(field)) { s.sendAttempt = null; s.resetAttempt = null; s.token = null; s.challengeId = null; s.retryAt = 0; if (s.stage === 'code') s.stage = 'identity'; fields.code.value = ''; }
  status(s); controls(s);
 }
 function mount() {
  if (dialog) return;
  dialog = document.createElement('dialog'); dialog.id = 'snote-account-recovery'; dialog.className = 'snote-popup-native snote-account-recovery-dialog';
  dialog.setAttribute('aria-labelledby', 'snote-recovery-title'); dialog.setAttribute('aria-describedby', 'snote-recovery-intro');
  dialog.innerHTML = '<button class="snote-popup-close snote-recovery-close" type="button" aria-label="계정 복구 닫기">×</button>' +
   '<header class="snote-recovery-head"><h2 id="snote-recovery-title">아이디 찾기</h2><p id="snote-recovery-intro" class="snote-recovery-intro">가입할 때 등록한 성명과 휴대전화로 인증해 주세요.</p>' +
   '<div class="snote-recovery-tabs" role="tablist" aria-label="계정 복구 방식"><button type="button" role="tab" data-recovery-mode="id" aria-selected="true">아이디 찾기</button><button type="button" role="tab" data-recovery-mode="password" aria-selected="false">비밀번호 재설정</button></div></header>' +
   '<form id="snote-recovery-form" autocomplete="off" novalidate><section id="snote-recovery-identity"><label class="snote-recovery-field">가입한 성명<input id="snote-recovery-name" name="recoveryName" maxlength="80" autocomplete="off" required></label>' +
   '<label class="snote-recovery-field">휴대전화<input id="snote-recovery-phone" name="recoveryPhone" type="tel" inputmode="tel" maxlength="13" autocomplete="off" placeholder="010-1234-5678" required></label></section>' +
   '<section id="snote-recovery-code-section" hidden><label class="snote-recovery-field" for="snote-recovery-code">인증번호<div class="snote-recovery-code-row"><input id="snote-recovery-code" name="recoveryCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6자리 인증번호"><span id="snote-recovery-countdown" class="snote-recovery-countdown" aria-hidden="true"></span></div></label></section>' +
   '<section id="snote-recovery-password-section" hidden><label class="snote-recovery-field">새 비밀번호<input id="snote-recovery-password" name="newPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password"><small>10~128자로 입력해 주세요.</small></label>' +
   '<label class="snote-recovery-field">새 비밀번호 확인<input id="snote-recovery-password-confirm" name="newPasswordConfirm" type="password" minlength="10" maxlength="128" autocomplete="new-password"></label></section>' +
   '<output id="snote-recovery-id" class="snote-recovery-result" aria-label="확인한 계정 ID" hidden></output><div id="snote-recovery-email-guide" class="snote-recovery-help" hidden></div>' +
   '<p id="snote-recovery-status" class="snote-recovery-status" role="status" aria-live="polite" aria-atomic="true"></p><div class="snote-recovery-actions"><button type="submit" id="snote-recovery-submit" class="snote-recovery-submit">인증번호 받기</button>' +
   '<button type="button" id="snote-recovery-resend" class="snote-recovery-secondary" hidden>인증번호 다시 받기</button><button type="button" id="snote-recovery-back" class="snote-recovery-secondary" hidden>다른 번호로 다시 입력</button></div></form>';
  document.body.append(dialog);
  fields = Object.fromEntries([['name', 'name'], ['phone', 'phone'], ['code', 'code'], ['password', 'password'], ['confirm', 'password-confirm'], ['identity', 'identity'], ['codeSection', 'code-section'], ['passwordSection', 'password-section'], ['result', 'id'], ['emailGuide', 'email-guide'], ['status', 'status'], ['countdown', 'countdown'], ['submit', 'submit'], ['resend', 'resend'], ['back', 'back']].map(([key, id]) => [key, byId('snote-recovery-' + id)]));
  dialog.querySelector('.snote-recovery-close').addEventListener('click', () => dispose());
  dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopImmediatePropagation(); dispose(); });
  dialog.addEventListener('close', () => { if (state && !dialog.open) dispose({ restoreFocus: false }); });
  dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); const s = state; if (!current(s)) return; if (s.stage === 'identity') void send(s); else if (s.stage === 'code') void verify(s); else if (s.stage === 'password') void resetPassword(s); else finish(s); });
  fields.resend.addEventListener('click', () => { if (state) void send(state); });
  fields.back.addEventListener('click', () => { const s = state; if (!current(s)) return; const value = identity(), mode = s.mode; begin(mode, s.focus); if (state && value.name) { fields.name.value = value.name; fields.phone.value = phone(value.phone); focus(state, fields.phone); } });
  dialog.querySelectorAll('[data-recovery-mode]').forEach(button => button.addEventListener('click', () => open(button.dataset.recoveryMode)));
  dialog.querySelector('.snote-recovery-tabs').addEventListener('keydown', event => {
   if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !current(state)) return;
   event.preventDefault(); const buttons = Array.from(dialog.querySelectorAll('[data-recovery-mode]')), index = buttons.findIndex(button => button.dataset.recoveryMode === state.mode);
   const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
   const target = buttons[next]; open(target.dataset.recoveryMode); requestAnimationFrame(() => { if (state && current(state) && state.mode === target.dataset.recoveryMode) target.focus(); });
  });
  for (const field of [fields.name, fields.phone, fields.code, fields.password, fields.confirm]) field.addEventListener('input', () => { if (state) invalidateInput(state, field); });
 }
 function begin(mode, returnFocus) {
  dispose({ restoreFocus: false, keepOpen: true });
  const s = { id: sequence, mode, url: location.href, bridge: bridge(), focus: returnFocus || document.activeElement, revision: 0,
   stage: 'identity', action: null, busy: false, retryAt: 0, expiresAt: 0, tokenExpiresAt: 0, token: null, challengeId: null, email: null,
   controllers: new Set(), messages: new Set(), messageId: 0, timer: null, sendAttempt: null, resetAttempt: null };
  state = s;
  if (!dialog.open) dialog.showModal();
  byId('snote-recovery-title').textContent = mode === 'id' ? '아이디 찾기' : '비밀번호 재설정';
  dialog.querySelectorAll('[data-recovery-mode]').forEach(button => { const selected = button.dataset.recoveryMode === mode; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  status(s); controls(s); fit(); focus(s, fields.name); tick(s); return true;
 }
 function open(mode = 'id', options = {}) {
  if (!allowed()) return false; mode = mode === 'password' ? 'password' : 'id';
  options = options && typeof options === 'object' ? options : {};
  mount(); if (state && current(state) && state.mode === mode) { focus(state, state.stage === 'password' ? fields.password : state.stage === 'code' ? fields.code : state.stage === 'identity' ? fields.name : fields.submit); return true; }
  return begin(mode, options.returnFocus || state?.focus || document.activeElement);
 }
 document.addEventListener('click', event => { const button = event.target.closest?.('[data-account-recovery]'); if (!button) return; event.preventDefault(); open(button.dataset.accountRecovery, { returnFocus: button }); });
 const check = () => { if (state && !context(state)) dispose({ restoreFocus: false }); };
 const observer = new MutationObserver(check); const gate = byId('zc-cloud-gate'); if (gate) observer.observe(gate, { attributes: true, attributeFilter: ['hidden', 'data-auth-mode'] });
 window.addEventListener('pagehide', () => dispose({ restoreFocus: false }));
 for (const event of ['popstate', 'hashchange']) window.addEventListener(event, check);
 window.addEventListener('resize', fit); window.visualViewport?.addEventListener('resize', fit); window.visualViewport?.addEventListener('scroll', fit);
 document.addEventListener('visibilitychange', () => { if (state && document.visibilityState === 'visible') tick(state); });
 window.SnoteAccountRecovery = Object.freeze({ open, close: dispose, reset: () => dispose({ restoreFocus: false }) });
})();
