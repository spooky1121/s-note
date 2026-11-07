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
 function start(adapter) {
  stop();
  if (!adapter || typeof adapter.rpc !== 'function' || typeof adapter.current !== 'function') return;
  const state = { rpc: adapter.rpc, current: adapter.current, epoch, pending: false };
  active = state; void ping(state);
 }
 document.addEventListener('visibilitychange', () => { if (active && document.visibilityState !== 'hidden') void ping(active); });
 window.addEventListener('online', () => { if (active) void ping(active); });
 window.addEventListener('pagehide', stop);
 window.SnoteAccessTracker = Object.freeze({ start, stop });
})();
