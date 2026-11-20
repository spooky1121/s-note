import { acquireKnownSession, browserRetryAfter } from './encar-id-browser-session.mjs';
import { browserLimitFailure } from './encar-id-browser-limits.mjs';

// Fixed server-owned Browser Run transport for the ID-only lookup. This is not
// a general URL/code endpoint; the public API accepts only a Korean plate.
const MAX_MESSAGE = 1024 * 1024;
const LAUNCH_TIMEOUT = 8000;
const COMMAND_TIMEOUT = 5000;
const CLEANUP_TIMEOUT = 500;
const GUARDRAILS = Object.freeze({
  allowedDomains: Object.freeze(['carnect.biz', '*.carnect.biz', 'gloar-data.com', '*.gloar-data.com', 'encar.spb.ru']),
  allowedDomainSets: Object.freeze(['common-cdns'])
});
const GLOAR_GUARDRAILS = Object.freeze({
  allowedDomains: Object.freeze(['gloar-data.com', '*.gloar-data.com']),
  allowedDomainSets: Object.freeze(['common-cdns'])
});
const ENCAR_GUARDRAILS = Object.freeze({
  allowedDomains: Object.freeze(['fem.encar.com', '*.encar.com']),
  allowedDomainSets: Object.freeze(['common-cdns'])
});

function failure(code = 'BROWSER_UNAVAILABLE', extras = {}) {
  return Object.assign(new Error(code), { code, ...extras });
}
function aborted() {
  return Object.assign(failure('ABORTED'), { name: 'AbortError' });
}
function safeClose(socket) {
  try { socket.close(1000, 'Lookup finished'); } catch {}
}
function checkSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw failure();
}
function destination(value, gloarOnly = false, encarOnly = false) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\u0000-\u0020\u007f\\#]/u.test(value)) throw failure('PROVIDER_UNSUPPORTED');
  // Keep an explicit :443 disallowed too; URL.port would erase it.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  let url;
  try { url = new URL(value); } catch { throw failure('PROVIDER_UNSUPPORTED'); }
  const host = url.hostname.toLowerCase();
  const allowed = encarOnly ? host === 'fem.encar.com' : gloarOnly ? host === 'gloar-data.com' : host === 'carnect.biz' || host.endsWith('.carnect.biz') || host === 'gloar-data.com' || host.endsWith('.gloar-data.com') || host === 'encar.spb.ru';
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || authority?.toLowerCase() !== host) throw failure('PROVIDER_UNSUPPORTED');
  return url.href;
}
async function waitFor(operation, { signal, milliseconds }) {
  if (signal?.aborted) throw aborted();
  let timer, abort;
  const interrupted = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(failure()), milliseconds);
    if (signal) { abort = () => reject(aborted()); signal.addEventListener('abort', abort, { once: true }); }
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { clearTimeout(timer); if (signal && abort) signal.removeEventListener('abort', abort); }
}

/** Reconnect a feature-owned browser, with an isolated context per lookup. */
export async function createBrowserSession(env = {}, { signal, fetchImpl = fetch, cacheStorage = globalThis.caches, waitUntil, gloarOnly = false, encarOnly = false } = {}) {
  checkSignal(signal);
  if (signal?.aborted) throw aborted();
  if (typeof gloarOnly !== 'boolean' || typeof encarOnly !== 'boolean' || gloarOnly && encarOnly) throw failure('PROVIDER_UNSUPPORTED');
  const account = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
  const token = typeof env.CLOUDFLARE_BROWSER_TOKEN === 'string' ? env.CLOUDFLARE_BROWSER_TOKEN.trim() : '';
  if (!/^[a-f0-9]{32}$/i.test(account) || !token || token.length > 4096 || /[^\x21-\x7e]/u.test(token)) throw failure('LOOKUP_NOT_CONFIGURED');
  if (typeof fetchImpl !== 'function') throw failure();
  const options = { account, token, guardrails: encarOnly ? ENCAR_GUARDRAILS : gloarOnly ? GLOAR_GUARDRAILS : GUARDRAILS, fetchImpl, signal, cacheStorage, waitUntil };
  let known = await acquireKnownSession(options), response;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(), abortLaunch = () => controller.abort();
    signal?.addEventListener('abort', abortLaunch, { once: true });
    const timer = setTimeout(abortLaunch, LAUNCH_TIMEOUT);
    const launched = Promise.resolve().then(() => {
      if (signal?.aborted) throw aborted();
      return fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-run/devtools/browser/${known.sessionId}`, {
        method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}` }
      });
    });
    try { response = await waitFor(launched, { signal, milliseconds: LAUNCH_TIMEOUT }); }
    catch {
      controller.abort();
      // Closing only this late connection must never terminate a shared browser.
      void launched.then(late => { const socket = late?.webSocket; if (!socket) return; try { socket.accept(); } catch {} safeClose(socket); }).catch(() => {});
      throw signal?.aborted ? aborted() : failure();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abortLaunch); }
    if (response?.status === 429) throw await browserLimitFailure(response, { signal });
    if (response?.status === 409) throw failure('BROWSER_BUSY', { retryAfter: browserRetryAfter(response) });
    if ([401, 403].includes(response?.status)) throw failure('BROWSER_AUTH_FAILED');
    if (attempt === 0 && known.reused && [404, 410].includes(response?.status)) {
      try { void response.body?.cancel().catch(() => {}); } catch {}
      await known.invalidate(); known = await acquireKnownSession(options); continue;
    }
    break;
  }
  const socket = response?.webSocket;
  if (response?.status !== 101 || !socket || typeof socket.accept !== 'function') {
    try { void response?.body?.cancel().catch(() => {}); } catch {}
    throw failure();
  }
  let serial = 0, active = true, closePromise = null, browserContextId = null;
  const pending = new Map(), abandoned = new Map(), closingPages = new Set(), eventHandlers = new Map(), closeHandlers = new Set();
  function rejectAll(error) {
    for (const item of [...pending.values()]) item.finish(error);
  }
  function send(method, params = {}, { sessionId, requestSignal, milliseconds = COMMAND_TIMEOUT, cleanup = false, onLateResult } = {}) {
    if ((!active && !cleanup) || (!cleanup && signal?.aborted)) return Promise.reject(signal?.aborted ? aborted() : failure());
    if (!cleanup && requestSignal?.aborted) return Promise.reject(aborted());
    const id = ++serial;
    let payload;
    try { payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }); } catch { return Promise.reject(failure()); }
    if (payload.length > MAX_MESSAGE || new TextEncoder().encode(payload).byteLength > MAX_MESSAGE) return Promise.reject(failure());
    return new Promise((resolve, reject) => {
      let timer, abort;
      const finish = (error, value, late = false) => {
        if (!pending.delete(id)) return;
        if (late && active && onLateResult) abandoned.set(id, { sessionId, onLateResult });
        clearTimeout(timer);
        if (requestSignal && abort) requestSignal.removeEventListener('abort', abort);
        error ? reject(error) : resolve(value);
      };
      pending.set(id, { finish, sessionId, method });
      timer = setTimeout(() => finish(failure(), undefined, true), milliseconds);
      if (!cleanup && requestSignal) { abort = () => finish(aborted(), undefined, true); requestSignal.addEventListener('abort', abort, { once: true }); }
      try { socket.send(payload); } catch { finish(failure()); }
    });
  }
  function message(event) {
    let text;
    try {
      if (typeof event.data === 'string') {
        if (event.data.length > MAX_MESSAGE || new TextEncoder().encode(event.data).byteLength > MAX_MESSAGE) throw failure();
        text = event.data;
      } else if (event.data instanceof ArrayBuffer && event.data.byteLength <= MAX_MESSAGE) text = new TextDecoder().decode(event.data);
      else throw failure();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure();
      if (data.id === undefined) {
        if (typeof data.method === 'string') for (const handler of eventHandlers.get(data.sessionId) || []) handler(data.method, data.params || {});
        return;
      }
      if (!Number.isSafeInteger(data.id)) throw failure();
      const item = pending.get(data.id);
      if (!item) {
        const late = abandoned.get(data.id);
        abandoned.delete(data.id);
        if (late && !data.error && (data.sessionId || undefined) === late.sessionId) late.onLateResult(data.result);
        return; // Aborted results never revive a lookup; release late resources.
      }
      if ((data.sessionId || undefined) !== item.sessionId) throw failure();
      const transientContext = item.method === 'Runtime.evaluate' && data.error?.code === -32000 && /Execution context was destroyed|Cannot find context with specified id|Cannot find execution context|Cannot find default execution context|Inspected target navigated or closed/i.test(data.error.message || '');
      item.finish(data.error ? failure(transientContext ? 'PAGE_CONTEXT_UNAVAILABLE' : 'BROWSER_UNAVAILABLE') : null, data.result);
    } catch { void close(); }
  }
  function disconnected() { void close(); }
  async function close() {
    if (closePromise) return closePromise;
    active = false;
    abandoned.clear();
    for (const handler of closeHandlers) handler();
    closeHandlers.clear(); eventHandlers.clear();
    signal?.removeEventListener('abort', parentAborted);
    rejectAll(signal?.aborted ? aborted() : failure());
    closePromise = (async () => {
      try { if (browserContextId) await send('Target.disposeBrowserContext', { browserContextId }, { cleanup: true, milliseconds: CLEANUP_TIMEOUT }); } catch {}
      finally {
        rejectAll(failure());
        socket.removeEventListener('message', message);
        socket.removeEventListener('close', disconnected);
        socket.removeEventListener('error', disconnected);
        safeClose(socket);
        try { await known.touch(); } catch {}
      }
    })();
    return closePromise;
  }
  function parentAborted() { void close(); }
  function destroyTarget(targetId) {
    if (!active) return Promise.resolve();
    const closing = send('Target.closeTarget', { targetId }, { cleanup: true, milliseconds: CLEANUP_TIMEOUT }).then(result => {
      if (result?.success !== true) throw failure();
    }).catch(error => {
      // An unconfirmed old target must not keep requesting while another site
      // starts. End the whole browser instead of continuing in that session.
      void close(); throw error;
    });
    closingPages.add(closing);
    void closing.then(() => closingPages.delete(closing), () => closingPages.delete(closing));
    return closing;
  }
  socket.addEventListener('message', message);
  socket.addEventListener('close', disconnected);
  socket.addEventListener('error', disconnected);
  try { socket.accept(); } catch { await close(); throw failure(); }
  signal?.addEventListener('abort', parentAborted, { once: true });
  if (signal?.aborted) { await close(); throw aborted(); }
  try {
    const createdContext = await send('Target.createBrowserContext', { disposeOnDetach: true }, { requestSignal: signal });
    browserContextId = createdContext?.browserContextId;
    if (typeof browserContextId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(browserContextId)) throw failure();
    await known.touch();
  } catch (error) { await close(); throw error; }

  return Object.freeze({
    async newPage({ signal: pageSignal } = {}) {
      checkSignal(pageSignal);
      if (closingPages.size) {
        try { await waitFor(Promise.all([...closingPages]), { signal: pageSignal, milliseconds: CLEANUP_TIMEOUT }); }
        catch (error) { void close(); throw error; }
      }
      const created = await send('Target.createTarget', { url: 'about:blank', browserContextId }, {
        requestSignal: pageSignal,
        onLateResult(result) {
          if (typeof result?.targetId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(result.targetId)) void destroyTarget(result.targetId).catch(() => {});
        }
      });
      void known.touch().catch(() => {});
      const targetId = created?.targetId;
      if (typeof targetId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(targetId)) throw failure();
      let closed = false;
      const pageCloseHandlers = new Set();
      const closePage = async () => {
        if (closed) return;
        closed = true;
        for (const handler of pageCloseHandlers) handler();
        pageCloseHandlers.clear();
        pageSignal?.removeEventListener('abort', abortPage);
        if (!active) return;
        try { await destroyTarget(targetId); } catch {}
      };
      const abortPage = () => { void closePage(); };
      // Queue target destruction immediately on cancellation. CDP sends it
      // before a subsequent provider can enqueue its target/navigation.
      pageSignal?.addEventListener('abort', abortPage, { once: true });
      try {
        if (pageSignal?.aborted) throw aborted();
        const attached = await send('Target.attachToTarget', { targetId, flatten: true }, { requestSignal: pageSignal });
        const sessionId = attached?.sessionId;
        if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw failure();
        const command = (method, params) => closed ? Promise.reject(failure()) : send(method, params, { sessionId, requestSignal: pageSignal });
        await command('Page.enable');
        await command('Runtime.enable');
        await command('Page.setLifecycleEventsEnabled', { enabled: true });
        return Object.freeze({
          async goto(url) {
            const target = destination(url, gloarOnly, encarOnly), observed = [];
            let frameId, loaderId, readyResolve, readyReject;
            const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
            // The session may close before Page.navigate replies. Keep that
            // rejection handled even while the navigation command is pending.
            void ready.catch(() => {});
            const inspect = () => {
              if (frameId && loaderId && observed.some(event => event.frameId === frameId && event.loaderId === loaderId && ['DOMContentLoaded', 'load'].includes(event.name))) readyResolve();
            };
            const listener = (method, params) => {
              if (method !== 'Page.lifecycleEvent') return;
              if (observed.length >= 16) observed.shift();
              observed.push(params); inspect();
            };
            const stopped = () => readyReject(pageSignal?.aborted || signal?.aborted ? aborted() : failure());
            let listeners = eventHandlers.get(sessionId);
            if (!listeners) { listeners = new Set(); eventHandlers.set(sessionId, listeners); }
            listeners.add(listener); pageCloseHandlers.add(stopped); closeHandlers.add(stopped);
            try {
              const result = await command('Page.navigate', { url: target });
              if (result?.errorText || typeof result?.frameId !== 'string') throw failure('PROVIDER_UNAVAILABLE');
              frameId = result.frameId; loaderId = result.loaderId;
              if (typeof loaderId !== 'string' || !loaderId) {
                // CDP omits loaderId for a same-document navigation. Prove that
                // its current context already is the requested ready document.
                const state = await command('Runtime.evaluate', { expression: `location.href === ${JSON.stringify(target)} && document.readyState !== 'loading'`, returnByValue: true });
                if (state?.result?.value !== true) throw failure('PROVIDER_UNAVAILABLE');
                readyResolve();
              } else inspect();
              await waitFor(ready, { signal: pageSignal, milliseconds: COMMAND_TIMEOUT });
            } finally {
              listeners.delete(listener); if (!listeners.size) eventHandlers.delete(sessionId);
              pageCloseHandlers.delete(stopped); closeHandlers.delete(stopped);
            }
          },
          async evaluate(expression) {
            if (typeof expression !== 'string' || expression.length > 256 * 1024) throw failure();
            const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result?.exceptionDetails) throw failure('PROVIDER_UNAVAILABLE');
            return result?.result?.value;
          },
          async keypress(key) {
            if (key !== 'Enter') throw failure();
            await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
            await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
          },
          close: closePage
        });
      } catch (error) { await closePage(); throw error; }
    },
    close
  });
}
