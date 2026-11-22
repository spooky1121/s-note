// Request-local diagnostics contain no input, identity, URL or exception text.
const STAGES = new Set(['request', 'auth', 'membership', 'lookup', 'verification', 'complete']);
export function createEncarRequestDiagnostics({ now = Date.now, logger = value => console.info(value) } = {}) {
  const requestId = crypto.randomUUID(), started = now(); let stage = 'request';
  return {
    stage(value) { if (STAGES.has(value)) stage = value; },
    finish(response, { failed = response.status >= 400 } = {}) {
      const elapsed = now() - started;
      const value = { requestId, stage, durationMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0 };
      response.headers.set('X-Snote-Request-Id', value.requestId);
      response.headers.set('X-Snote-Lookup-Stage', value.stage);
      response.headers.set('X-Snote-Duration-Ms', String(value.durationMs));
      if (failed) { try { logger(value); } catch {} }
      return response;
    }
  };
}
const aborted = () => Object.assign(new Error('REQUEST_ABORTED'), { code: 'REQUEST_ABORTED', name: 'AbortError' });

// Keep only pending plain-result promises in this isolate. Authentication is
// performed afresh by every caller before joining. This is neither a quota nor
// a result cache: a full pool executes independently and settled work is removed.
export function createEncarPendingLookup({ maxEntries = 64, timeoutMs = 45000 } = {}) {
  const pending = new Map();
  function create(key, operation, tracked) {
    const controller = new AbortController();
    const entry = { controller, consumers: 0, settled: false, promise: null };
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(controller.signal.reason || aborted());
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('REQUEST_TIMEOUT'), { code: 'REQUEST_TIMEOUT' })), timeoutMs);
    entry.promise = Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason || aborted();
      return operation(controller.signal);
    }), interrupted]).finally(() => {
      entry.settled = true; clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
      if (pending.get(key) === entry) pending.delete(key);
    });
    // A caller can cancel before a provider settles. Always consume rejection.
    void entry.promise.catch(() => {});
    if (tracked) pending.set(key, entry);
    return entry;
  }
  return async function join({ key, signal, waitUntil, operation }) {
    if (signal?.aborted) throw aborted();
    let entry = pending.get(key);
    if (!entry || entry.settled || entry.controller.signal.aborted) entry = create(key, operation, pending.size < maxEntries);
    entry.consumers++;
    // Keep the originating execution alive if one tab closes while another is
    // waiting. Provider I/O is consumed there; no browser/socket is shared.
    if (typeof waitUntil === 'function') { try { waitUntil(entry.promise.then(() => {}, () => {})); } catch {} }
    return await new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, value) => {
        if (done) return; done = true; signal?.removeEventListener('abort', cancel); entry.consumers--;
        if (!entry.settled && entry.consumers === 0) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort(aborted());
        }
        callback(value);
      };
      const cancel = () => finish(reject, aborted());
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
    });
  };
}
export async function encarLookupScopeKey({ actor, env, parameters }) {
  // Raw credentials and query input never become map keys or diagnostic data.
  const source = JSON.stringify([env.SUPABASE_URL || '', env.SUPABASE_PUBLISHABLE_KEY || '', env.CLOUDFLARE_ACCOUNT_ID || '', env.CLOUDFLARE_BROWSER_TOKEN || '', actor.companyId, actor.userId, actor.role, parameters]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
