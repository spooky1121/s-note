/* A native recovery-email session is isolated from the main application's saved session. */
(() => {
  'use strict';
  const PUBLIC_CONFIG = Object.freeze({ url: 'https://rmlycycleuscfqywbihj.supabase.co', key: 'sb_publishable_sNBW_Qz-1H2vi1rG-ayUJg_aOWD2fHn' });
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
  const byId = id => document.getElementById(id);
  const fields = ['snote-email-recovery-password', 'snote-email-recovery-confirm'];
  let active = null, serial = 0;
  function current(state) { return active === state && !state.closed && state.serial === serial && location.href === state.address; }
  function clearPasswords() { for (const id of fields) { const field = byId(id); if (field) field.value = ''; } }
  function clearProof(state) {
    if (state.proof) { delete state.proof.access_token; delete state.proof.refresh_token; }
    state.proof = null; window.SnoteRecoveryEntry?.clear();
  }
  function hidePrivate() {
    clearPasswords(); byId('snote-email-recovery-id').textContent = '';
    byId('snote-email-recovery-account').hidden = true; byId('snote-email-recovery-form').hidden = true;
    byId('snote-email-recovery-phone-guide').hidden = true;
  }
  function status(state, value, tone = '') {
    if (!current(state)) return;
    const node = byId('snote-email-recovery-status'); node.textContent = value; node.dataset.tone = tone;
  }
  function controls(state) {
    if (!current(state)) return;
    const disabled = state.busy || state.stage !== 'ready';
    byId('snote-email-recovery-submit').disabled = disabled;
    for (const id of fields) byId(id).disabled = disabled;
    byId('snote-email-recovery-form').setAttribute('aria-busy', String(state.busy));
  }
  function deadline(operation, ms) {
    let timer;
    return Promise.race([Promise.resolve(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('RECOVERY_TIMEOUT')), ms); })])
      .finally(() => clearTimeout(timer));
  }
  function abort(state) { for (const request of state.requests) request.abort(); state.requests.clear(); }
  function storage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear() };
  }
  function authFetch(state) {
    return async (input, options = {}) => {
      const address = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      const method = String(options.method || input.method || 'GET').toUpperCase();
      const logout = address.pathname === '/auth/v1/logout';
      if (address.origin !== PUBLIC_CONFIG.url || !address.pathname.startsWith('/auth/v1/') || address.username || address.password ||
          (!current(state) && !logout)) throw Error('RECOVERY_CONTEXT_CHANGED');
      if (method === 'PUT' && address.pathname === '/auth/v1/user') {
        if (state.updateSent) throw Error('RECOVERY_WRITE_REPLAY');
        state.updateSent = true;
      }
      const controller = new AbortController(); state.requests.add(controller);
      let timer;
      try {
        const request = fetch(input, { ...options, credentials: 'omit', cache: 'no-store', redirect: 'error',
          referrerPolicy: 'no-referrer', keepalive: logout, signal: controller.signal });
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('RECOVERY_TIMEOUT')); }, logout ? 3000 : 15000); });
        return await Promise.race([request, timeout]);
      } finally { clearTimeout(timer); state.requests.delete(controller); }
    };
  }
  async function dispose(state, client = state.client) {
    if (!client) { state.memory?.clear(); return; }
    // This SDK has its own in-memory session. Do not remove main-app storage.
    try { await deadline(client.auth.signOut({ scope: 'local' }), 3200); } catch (_) { /* No temporary session is persisted. */ }
    finally { state.memory?.clear(); if (state.client === client) state.client = null; }
  }
  async function inform(state, text, tone = 'error') {
    if (!current(state)) return false;
    status(state, text, tone);
    try {
      if (typeof window.SnoteMessages?.alert === 'function') return await window.SnoteMessages.alert(text, {
        tone, title: tone === 'success' ? '완료' : '확인해 주세요', key: state.messageKey,
        isCurrent: () => current(state), returnFocus: false
      }) === true && current(state);
    } catch (_) { /* The page status remains available if shared popups cannot mount. */ }
    return false;
  }
  async function fail(state, text) {
    if (!current(state)) return;
    state.stage = 'error'; state.busy = false; clearProof(state); hidePrivate(); controls(state);
    abort(state); void dispose(state); await inform(state, text);
  }
  async function leave() {
    const state = active;
    if (state) {
      state.closed = true; active = null; ++serial;
      clearProof(state); hidePrivate(); abort(state); state.user = null;
      try { window.SnoteMessages?.dismiss(state.messageKey); } catch (_) {}
      await dispose(state);
    }
    try { await deadline(window.SnoteMobilePopupHistory?.prepareRouteChange?.(), 1500); } catch (_) { /* Navigation still offers an exit if history traversal is unavailable. */ }
    const target = new URL(location.origin); target.pathname = '/'; location.replace(target.href);
  }
  function clearPage() {
    const state = active; active = null; ++serial;
    if (state) { state.closed = true; clearProof(state); abort(state); state.user = null; void dispose(state); }
    hidePrivate();
  }
  async function submit(event) {
    event.preventDefault(); const state = active;
    if (!state || !current(state) || state.stage !== 'ready' || state.busy || !state.client || !state.user) return;
    let password = byId(fields[0]).value, confirmation = byId(fields[1]).value;
    if (password.length < 10 || password.length > 128) {
      password = confirmation = ''; await inform(state, '새 비밀번호는 10~128자로 입력해 주세요.');
      if (current(state)) byId(fields[0]).focus(); return;
    }
    if (password !== confirmation) {
      password = confirmation = ''; await inform(state, '새 비밀번호와 확인 입력이 일치하지 않습니다.');
      if (current(state)) byId(fields[1]).focus(); return;
    }
    const client = state.client, userId = state.user.id;
    state.busy = true; state.updateSent = false; controls(state); status(state, '새 비밀번호를 저장하고 있습니다.');
    try {
      const update = client.auth.updateUser({ password }); password = confirmation = ''; clearPasswords();
      const result = await deadline(update, 18000);
      if (!current(state)) { void dispose(state, client); return; }
      if (result?.error) {
        const code = result.error.code;
        if (code === 'weak_password' || code === 'same_password') {
          state.busy = false; controls(state);
          await inform(state, code === 'same_password' ? '이전과 다른 새 비밀번호를 입력해 주세요.' : '더 안전한 새 비밀번호를 입력해 주세요.');
          if (current(state)) byId(fields[0]).focus(); return;
        }
        throw Error('RECOVERY_UPDATE_FAILED');
      }
      if (result?.data?.user?.id !== userId) throw Error('RECOVERY_UPDATE_FAILED');
      state.stage = 'done'; state.busy = false; state.user = null; hidePrivate(); controls(state);
      await dispose(state, client);
      if (!current(state)) return;
      const accepted = await inform(state, '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.', 'success');
      if (accepted && current(state)) await leave();
    } catch (_) {
      password = confirmation = ''; clearPasswords();
      await fail(state, '비밀번호 변경 결과를 확인하지 못했습니다. 새 비밀번호로 로그인하거나 복구 링크를 다시 요청해 주세요.');
    } finally { password = confirmation = ''; if (current(state)) { state.busy = false; controls(state); } }
  }
  async function start() {
    hidePrivate();
    const state = { serial: ++serial, address: location.href, closed: false, stage: 'checking', busy: true,
      proof: window.SnoteRecoveryEntry?.take(), requests: new Set(), memory: storage(), client: null, user: null,
      updateSent: false, messageKey: 'email-account-recovery:' + serial };
    active = state; controls(state);
    if (state.proof?.kind !== 'session') {
      const codeOnly = state.proof?.kind === 'unsupported-code';
      await fail(state, codeOnly ? '이 복구 링크는 사용할 수 없습니다. 로그인 화면에서 계정 찾기를 다시 진행해 주세요.' :
        '인증 링크가 없거나 만료되었습니다. 로그인 화면에서 계정 찾기를 다시 진행해 주세요.'); return;
    }
    let client;
    try {
      const library = await deadline(import(SDK), 15000);
      if (!current(state)) return;
      client = library.createClient(PUBLIC_CONFIG.url, PUBLIC_CONFIG.key, { auth: {
        persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        storage: state.memory, storageKey: 'snote-email-recovery-transient'
      }, global: { fetch: authFetch(state) } });
      state.client = client;
      const established = await deadline(client.auth.setSession({ access_token: state.proof.access_token, refresh_token: state.proof.refresh_token }), 18000);
      clearProof(state);
      if (!current(state)) { void dispose(state, client); return; }
      if (established?.error) throw Error('RECOVERY_SESSION_INVALID');
      const verified = await deadline(client.auth.getUser(), 18000);
      if (!current(state)) { void dispose(state, client); return; }
      const user = verified?.data?.user;
      if (verified?.error || !user || typeof user.id !== 'string' || user.id.length !== 36 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id) ||
        typeof user.email !== 'string' || user.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) throw Error('RECOVERY_SESSION_INVALID');
      state.user = { id: user.id }; state.stage = 'ready'; state.busy = false;
      byId('snote-email-recovery-id').textContent = user.email;
      byId('snote-email-recovery-account').hidden = false; byId('snote-email-recovery-form').hidden = false;
      byId('snote-email-recovery-phone-guide').hidden = false;
      status(state, '계정을 확인했습니다. 아이디를 확인하고 로그인하거나 새 비밀번호를 설정해 주세요.'); controls(state);
      byId(fields[0]).focus();
    } catch (_) { await fail(state, '이메일 인증을 확인하지 못했습니다. 로그인 화면에서 복구 링크를 다시 요청해 주세요.'); }
    finally { clearProof(state); if (!current(state) && client) void dispose(state, client); }
  }
  byId('snote-email-recovery-form').addEventListener('submit', event => { void submit(event); });
  for (const id of ['snote-email-recovery-close', 'snote-email-recovery-login']) byId(id).addEventListener('click', () => { void leave(); });
  window.addEventListener('pagehide', clearPage);
  window.addEventListener('hashchange', () => { clearPage(); try { history.replaceState(null, '', location.pathname); } catch (_) {} });
  window.addEventListener('popstate', () => { if (active && location.href !== active.address) clearPage(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { clearPage(); byId('snote-email-recovery-status').textContent = '복구 링크를 다시 열어 주세요.'; } });
  void start();
})();
