/* Presence uses the authenticated server session; no IP or identity is supplied. */
(() => {
 'use strict';
 if (window.SnoteAccessTracker) return;
 let active = null, epoch = 0, timer = null;
 const clear = () => { clearTimeout(timer); timer = null; };
 function stop() { epoch++; active = null; clear(); }
 function current(state) { try { return active === state && state.epoch === epoch && state.current() === true; } catch (_) { return false; } }
 function schedule(state) {
  if (!current(state)) return;
  clearTimeout(timer); timer = setTimeout(() => ping(state), 60000);
 }
 async function ping(state) {
  if (!current(state)) { if (active === state) stop(); return; }
  if (state.pending) return;
  if (document.visibilityState === 'hidden' || navigator.onLine === false) { schedule(state); return; }
  state.pending = true;
  let deadlineId;
  try {
   const deadline = new Promise((_, reject) => { deadlineId = setTimeout(() => reject(new Error('PRESENCE_TIMEOUT')), 15000); });
   await Promise.race([Promise.resolve().then(() => { if (current(state)) return state.rpc(); }), deadline]);
  } catch (_) {
   // Presence must never interrupt a vehicle save or surface a false success.
  } finally {
   clearTimeout(deadlineId);
   state.pending = false;
   if (current(state)) schedule(state);
  }
 }
 function signOutOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
   const url = new URL(value);
   if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/.test(url.hostname) ||
       url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
   return url.origin;
  } catch (_) { return null; }
 }
 function sessionId(value) { return typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
 function sessionToken(session, userId) {
  if (!sessionId(userId) || session?.user?.id !== userId) return null;
  const token = session.access_token;
  if (typeof token !== 'string' || token !== token.trim() || token.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
   const decode = value => JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)));
   const parts = token.split('.'), header = decode(parts[0]), claims = decode(parts[1]);
   if (!header || typeof header !== 'object' || Array.isArray(header) || typeof header.alg !== 'string' ||
       !claims || typeof claims !== 'object' || Array.isArray(claims) || claims.sub !== userId ||
       !sessionId(claims.session_id)) return null;
   // Format checks only. The RPC verifies the signed identity and deleted session.
   return token;
  } catch (_) { return null; }
 }
 function signOutConfirmation(endpoint, anonKey, token) {
  let used = false;
  return async function confirm() {
   if (used) return false;
   used = true;
   let deadlineId, controller;
   try {
    controller = new AbortController();
    const deadline = new Promise(resolve => { deadlineId = setTimeout(() => {
     try { controller.abort(); } catch (_) { /* Confirmation is best effort. */ }
     resolve(false);
    }, 3000); });
    let request;
    try {
     request = fetch(endpoint, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      referrerPolicy: 'no-referrer', keepalive: true, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: anonKey }, body: '{}' });
    } finally { token = null; }
    const result = Promise.resolve(request).then(async response => {
     if (!response?.ok) return false;
     const value = await response.json();
     return value?.ok === true;
    }).catch(() => false);
    return await Promise.race([result, deadline]);
   } catch (_) { return false; }
   finally { token = null; clearTimeout(deadlineId); }
  };
 }
 async function prepareSignOut(options) {
  let deadlineId;
  try {
   const { client, url, anonKey, userId, current: isCurrent } = options || {};
   const origin = signOutOrigin(url);
   const valid = () => {
    try { return (isCurrent == null || typeof isCurrent === 'function' && isCurrent() === true) &&
      (client.supabaseUrl == null || signOutOrigin(client.supabaseUrl) === origin); }
    catch (_) { return false; }
   };
   if (!origin || !client || !sessionId(userId) || typeof client.auth?.getSession !== 'function' || !valid() ||
       typeof anonKey !== 'string' || !anonKey.trim() || anonKey.length > 8192 || /[\u0000-\u0020\u007f]/.test(anonKey.trim())) return null;
   const deadline = new Promise(resolve => { deadlineId = setTimeout(() => resolve(null), 1000); });
   const result = await Promise.race([Promise.resolve().then(() => client.auth.getSession()), deadline]);
   if (!valid() || !result || result.error) return null;
   const token = sessionToken(result.data?.session, userId);
   if (!token) return null;
   return signOutConfirmation(origin + '/rest/v1/rpc/snote_access_logout_confirm', anonKey.trim(), token);
  } catch (_) { return null; }
  finally { clearTimeout(deadlineId); }
 }
 function start(adapter) {
  stop();
  if (!adapter || typeof adapter.rpc !== 'function' || typeof adapter.current !== 'function') return;
  const state = { rpc: adapter.rpc, current: adapter.current, epoch, pending: false };
  active = state; void ping(state);
 }
 document.addEventListener('visibilitychange', () => { if (active && document.visibilityState !== 'hidden') void ping(active); });
 window.addEventListener('online', () => { if (active) void ping(active); });
 window.addEventListener('pagehide', stop);
 window.SnoteAccessTracker = Object.freeze({ start, stop, prepareSignOut });
})();
