/* Recovery email fragments are never handed to the main application's Auth client. */
(() => {
  'use strict';
  if (window.SnoteRecoveryEntry || window.SnoteRecoveryRedirecting) return;
  if (!['https:', 'http:'].includes(location.protocol)) return;
  const path = location.pathname.replace(/\/$/, '');
  const callback = path === '/account-recovery' || path === '/account-recovery.html';
  const fragment = new URLSearchParams(location.hash.slice(1));
  const recovery = fragment.get('type') === 'recovery';
  if (!callback && (location.pathname !== '/' || !recovery)) return;

  const cleanAddress = () => {
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* replace() also replaces the source history entry. */ }
  };
  if (callback) {
    const access = fragment.get('access_token'), refresh = fragment.get('refresh_token');
    let payload = { kind: 'missing' };
    if (recovery && (fragment.has('error') || fragment.has('error_code'))) payload = { kind: 'expired' };
    else if (recovery && fragment.getAll('type').length === 1 && fragment.getAll('access_token').length === 1 && fragment.getAll('refresh_token').length === 1 &&
      typeof access === 'string' && access.length <= 32768 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access) &&
      typeof refresh === 'string' && /^[A-Za-z0-9_-]{8,2048}$/.test(refresh)) payload = { kind: 'session', access_token: access, refresh_token: refresh };
    else if (location.search.includes('code=') || fragment.has('code')) payload = { kind: 'unsupported-code' };
    else if (location.hash) payload = { kind: 'invalid' };
    cleanAddress();
    const clear = () => { if (payload) { delete payload.access_token; delete payload.refresh_token; } payload = null; };
    window.SnoteRecoveryEntry = Object.freeze({ take() { const value = payload; payload = null; return value; }, clear });
    window.addEventListener('pagehide', clear);
    return;
  }

  // Forward only to this origin's dedicated callback, never a supplied redirect URL.
  window.SnoteRecoveryRedirecting = true;
  const target = new URL(location.origin); target.pathname = '/account-recovery.html'; target.hash = location.hash;
  cleanAddress();
  const root = document.documentElement;
  if (root) root.style.visibility = 'hidden';
  const notice = document.createElement('section'); notice.id = 'snote-recovery-redirect';
  Object.assign(notice.style, { position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeContent: 'center', gap: '16px',
    padding: '32px', background: '#f5f7fb', color: '#173451', fontFamily: 'sans-serif', textAlign: 'center', visibility: 'visible' });
  const text = document.createElement('p'); text.textContent = '계정 복구 화면으로 이동합니다.';
  const link = document.createElement('a'); link.href = target.href; link.referrerPolicy = 'no-referrer'; link.textContent = '복구 화면 열기';
  Object.assign(link.style, { padding: '12px 20px', borderRadius: '10px', background: '#2364a5', color: '#fff', textDecoration: 'none' });
  notice.append(text, link); root?.append(notice);
  const referrer = document.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer'; document.head?.append(referrer);
  try { window.stop(); } catch (_) { /* Keep a visible same-origin exit. */ }
  try { location.replace(target.href); } catch (_) { /* The explicit link remains available. */ }
})();
