// Operator-only service metadata. Never accept request bodies, provider URLs,
// OCR output, credentials or exception messages at this boundary.
import { API_OBSERVATION_PATHS } from './api-security.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const AD_ID = /^[1-9][0-9]{5,11}$/u;
const SERVICES = new Set(['encar', 'vision', 'http']);
const STAGES = new Set(['request', 'validation', 'auth', 'membership', 'lookup', 'verification', 'not_found', 'complete', 'upload', 'provider', 'parse', 'response', 'blocked', 'exception']);
const MAX_BYTES = 2147483647, MAX_ELAPSED_MS = 86400000;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export const SERVICE_TELEMETRY_TIMEOUT_MS = 3000;

function configuration(env) {
  const origin = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim().replace(/\/$/u, '') : '';
  const key = typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(origin) || !key || key.length > 8192 || /[^\x21-\x7e]/u.test(key)) return null;
  return { origin, key };
}
function byteCount(value) { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BYTES ? value : null; }
function timestamp(now) { try { const value = now(); if (Number.isFinite(value) && Number.isFinite(new Date(value).getTime())) return value; } catch {} return Date.now(); }
function cancelBody(response) { try { return Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { return Promise.resolve(); } }
async function persist(config, event, fetchImpl) {
  const controller = new AbortController(); let timer;
  const expired = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, SERVICE_TELEMETRY_TIMEOUT_MS); });
  // Both the network and a late response body are consumed even if the deadline
  // wins. A broken/missing telemetry RPC must never affect the user's operation.
  const pending = Promise.resolve().then(() => fetchImpl(config.origin + '/rest/v1/rpc/snote_service_event', {
    method: 'POST', redirect: 'manual', cache: 'no-store', signal: controller.signal,
    headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ p_event: event })
  })).then(cancelBody, () => {});
  try { await Promise.race([pending, expired]); } finally { clearTimeout(timer); }
}

// Anonymous HTTP observations have no account claims. The middleware supplies
// measured counts; only fixed API paths and method names can leave this module.
export async function writeHttpTelemetry(env, value, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const config = configuration(env);
    if (!config || typeof fetchImpl !== 'function' || !value || typeof value !== 'object' || Array.isArray(value) ||
        value.userId !== null || value.service !== 'http' || value.adId !== null || !UUID.test(value.requestId || '') ||
        typeof value.startedAt !== 'string' || value.startedAt.length > 40 || !Number.isFinite(Date.parse(value.startedAt)) ||
        !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > MAX_ELAPSED_MS ||
        typeof value.ok !== 'boolean' || !Number.isSafeInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599 ||
        !['response', 'exception'].includes(value.stage) || !API_OBSERVATION_PATHS.includes(value.endpoint) || !HTTP_METHODS.has(value.method)) return;
    const event = { userId: null, requestId: value.requestId.toLowerCase(), service: 'http', startedAt: new Date(value.startedAt).toISOString(),
      elapsedMs: value.elapsedMs, ok: value.ok, httpStatus: value.httpStatus, stage: value.stage, adId: null,
      requestBytes: byteCount(value.requestBytes), responseBytes: byteCount(value.responseBytes), endpoint: value.endpoint, method: value.method };
    await persist(config, event, fetchImpl);
  } catch { /* Aggregate measurements are never allowed to affect a response. */ }
}

export function createServiceTelemetry(context, { service, now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  const started = timestamp(now), fallbackId = crypto.randomUUID();
  let actorId = null, stage = 'request', requestBytes = null, responseBytes = null, finished = false;
  return Object.freeze({
    authorized(actor) { if (UUID.test(actor?.userId || '')) actorId = actor.userId.toLowerCase(); },
    stage(value) { if (STAGES.has(value)) stage = value; },
    bytes(value = {}) {
      if (Object.hasOwn(value, 'requestBytes')) requestBytes = byteCount(value.requestBytes);
      if (Object.hasOwn(value, 'responseBytes')) responseBytes = byteCount(value.responseBytes);
    },
    finish(response, { ok = response.ok, adId = null, stage: finalStage } = {}) {
      if (finished) return response;
      finished = true;
      const observedId = response.headers.get('X-Snote-Request-Id');
      const requestId = UUID.test(observedId || '') ? observedId.toLowerCase() : fallbackId;
      if (!observedId) response.headers.set('X-Snote-Request-Id', requestId);
      const observedStage = response.headers.get('X-Snote-Lookup-Stage');
      const resultStage = STAGES.has(finalStage) ? finalStage : STAGES.has(observedStage) ? observedStage : stage;
      const rawElapsed = response.headers.get('X-Snote-Duration-Ms');
      const elapsed = rawElapsed !== null && /^\d{1,9}$/u.test(rawElapsed) ? Number(rawElapsed) : timestamp(now) - started;
      const event = { userId: actorId, requestId, service, startedAt: new Date(started).toISOString(),
        elapsedMs: Math.min(MAX_ELAPSED_MS, Math.max(0, Math.round(elapsed))), ok: ok === true,
        httpStatus: response.status, stage: resultStage, adId: service === 'encar' && ok === true && typeof adId === 'string' && AD_ID.test(adId) ? adId : null,
        requestBytes, responseBytes };
      const config = configuration(context?.env);
      if (!actorId || !SERVICES.has(service) || !config || typeof context?.waitUntil !== 'function' || typeof fetchImpl !== 'function') return response;
      // Promise work is handed to the platform, never awaited by the handler.
      // Keep the call bound to its Pages context, including throwing test stubs.
      try { context.waitUntil(persist(config, event, fetchImpl).catch(() => {})); } catch {}
      return response;
    }
  });
}
