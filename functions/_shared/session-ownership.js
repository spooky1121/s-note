// A signed Auth token proves identity; the database also decides whether this
// is still the account's active application session. Never cache this decision.
import { RequestSecurityError } from './api-security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const MAXIMUM = 8192;
export const SESSION_CHECK_TIMEOUT_MS = 5000;

function identity(header) {
  try {
    if (typeof header !== 'string' || header.length > 8200) return null;
    const token = BEARER.exec(header)?.[1];
    if (!token) return null;
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)));
    if (claims.role !== 'authenticated' || !UUID.test(claims.sub || '') || !UUID.test(claims.session_id || '')) return null;
    // Unverified fields are ONLY response-consistency hints. The RPC verifies
    // the JWT signature, live Auth session and database ownership itself.
    return { token, userId: claims.sub.toLowerCase(), sessionId: claims.session_id.toLowerCase() };
  } catch { return null; }
}

function endpoint(env) {
  try {
    const url = new URL(env?.SUPABASE_URL);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
        url.username || url.password || url.port || !['', '/'].includes(url.pathname) || url.search || url.hash) return null;
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[\r\n]/.test(key)) return null;
    return { url: url.origin + '/rest/v1/rpc/snote_session_status', key };
  } catch { return null; }
}

// Public customer-link/OTP and configuration requests do not require a dealer
// session. If a caller supplies a staff JWT, it must still be the current one.
export function needsSessionOwnership(request, policy) {
  return (request.method === 'POST' && !policy.publicPost) || !!policy.authenticatedGet ||
    BEARER.test(request.headers.get('Authorization') || '');
}

export async function requireSessionOwnership(request, env, { fetcher = fetch, timeoutMs = SESSION_CHECK_TIMEOUT_MS } = {}) {
  const expected = identity(request.headers.get('Authorization'));
  if (!expected) throw new RequestSecurityError('UNAUTHORIZED');
  const config = endpoint(env);
  if (!config) throw new RequestSecurityError('SESSION_UNAVAILABLE');
  const controller = new AbortController();
  let reader, response, timer;
  const cancel = () => {
    controller.abort();
    try { const pending = reader ? reader.cancel() : response?.body?.cancel(); pending?.catch(() => {}); } catch { /* Already closed. */ }
  };
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const abort = () => { rejectDeadline(new RequestSecurityError('SESSION_UNAVAILABLE')); cancel(); };
  request.signal.addEventListener('abort', abort, { once: true });
  timer = setTimeout(abort, Math.max(1, timeoutMs));
  try {
    if (request.signal.aborted) abort();
    const fetched = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new RequestSecurityError('SESSION_UNAVAILABLE');
      return fetcher(config.url, {
        method: 'POST', headers: { apikey: config.key, Authorization: 'Bearer ' + expected.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}', signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
      });
    }).then(value => {
      // Also discard a late response from an upstream that ignored cancellation.
      if (controller.signal.aborted) { try { value?.body?.cancel()?.catch(() => {}); } catch { /* Closed. */ } throw new RequestSecurityError('SESSION_UNAVAILABLE'); }
      return value;
    });
    response = await Promise.race([fetched, deadline]);
    if (response.status === 401 || response.status === 403) throw new RequestSecurityError('UNAUTHORIZED');
    if (!response.ok || (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new RequestSecurityError('SESSION_UNAVAILABLE');
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAXIMUM)) throw new RequestSecurityError('SESSION_UNAVAILABLE');
    if (!response.body) throw new RequestSecurityError('SESSION_UNAVAILABLE');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAXIMUM) throw new RequestSecurityError('SESSION_UNAVAILABLE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const status = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!status || Array.isArray(status) || status.ok !== true || typeof status.active !== 'boolean' ||
        typeof status.userId !== 'string' || status.userId.toLowerCase() !== expected.userId ||
        typeof status.sessionId !== 'string' || status.sessionId.toLowerCase() !== expected.sessionId ||
        !Number.isSafeInteger(status.generation) || status.generation < 0 ||
        !['ACTIVE', 'LEGACY', 'REPLACED', 'SESSION_MISSING'].includes(status.reason)) throw new RequestSecurityError('SESSION_UNAVAILABLE');
    if (!status.active) {
      if (!['REPLACED', 'SESSION_MISSING'].includes(status.reason) || (status.reason === 'REPLACED' && status.generation === 0)) throw new RequestSecurityError('SESSION_UNAVAILABLE');
      throw new RequestSecurityError('SESSION_REPLACED');
    }
    if (!['ACTIVE', 'LEGACY'].includes(status.reason) || (status.reason === 'LEGACY') !== (status.generation === 0)) throw new RequestSecurityError('SESSION_UNAVAILABLE');
    return { userId: expected.userId, sessionId: expected.sessionId, generation: status.generation };
  } catch (error) {
    cancel();
    if (error instanceof RequestSecurityError) throw error;
    throw new RequestSecurityError('SESSION_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    try { reader?.releaseLock(); } catch { /* A cancelled reader may already be released. */ }
  }
}
