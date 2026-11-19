// Ordered, read-only external-advertisement discovery. Transport is injected;
// this module never falls back to an older resolver, opens Encar, or stores data.
export const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'carnect', url: 'https://carnect.biz/catalog?tab=encar', host: 'carnect.biz' }),
  Object.freeze({ id: 'gloar', url: 'https://gloar-data.com/en/catalog', host: 'gloar-data.com' }),
  Object.freeze({ id: 'trust', url: 'https://encar.spb.ru/catalog/', host: 'encar.spb.ru' })
]);

const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
const AD_ID = /^[1-9][0-9]{5,11}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_TIMEOUT_MS = 60000;
const now = () => typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();

function invalid(code) {
  const error = new TypeError(code); error.code = code; return error;
}
function normalizedPlate(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const result = value.normalize('NFKC').replace(/[\s-]+/gu, '');
  return PLATE.test(result) ? result : '';
}
function timeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) throw invalid('INVALID_TIMEOUT');
  return value;
}
function aborted() {
  const error = new Error('Advertisement lookup was cancelled.');
  error.name = 'AbortError'; error.code = 'ABORTED'; return error;
}
function safeCode(value, fallback = 'PROVIDER_ERROR') {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
}
function sourceMatches(value, provider) {
  if (typeof value !== 'string' || !value || value.length > 2048 || value !== value.trim() || CONTROL.test(value) || value.includes('\\') || value.includes('#')) return false;
  // Inspect the original authority as well: URL.port erases an explicit :443.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (authority?.toLowerCase() !== provider.host) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === provider.host && !url.port && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function classify(result, provider, plate) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { status: 'invalid', code: 'INVALID_PROVIDER_RESULT' };
  if (result.status === 'found') {
    if (normalizedPlate(result.plate) !== plate) return { status: 'invalid', code: 'PLATE_MISMATCH' };
    if (typeof result.id !== 'string' || !AD_ID.test(result.id)) return { status: 'invalid', code: 'INVALID_AD_ID' };
    if (!sourceMatches(result.sourceUrl, provider)) return { status: 'invalid', code: 'INVALID_SOURCE_URL' };
    return { status: 'found', id: result.id };
  }
  if (result.status === 'not_found') return { status: 'not_found' };
  if (result.status === 'ambiguous') return { status: 'ambiguous', code: 'AMBIGUOUS' };
  if (result.status === 'error') return { status: 'error', code: safeCode(result.code) };
  return { status: 'invalid', code: 'INVALID_PROVIDER_RESULT' };
}

async function callProvider(provider, { plate, search, signal, milliseconds, deadlineLimited }) {
  const controller = new AbortController();
  let timer, onAbort, cause = null;
  const stop = new Promise((resolve, reject) => {
    const interrupt = code => {
      if (cause) return;
      cause = code;
      controller.abort();
      const error = new Error(code); error.code = code; reject(error);
    };
    timer = setTimeout(() => interrupt(deadlineLimited ? 'TOTAL_TIMEOUT' : 'PROVIDER_TIMEOUT'), milliseconds);
    if (signal) {
      onAbort = () => interrupt('ABORTED');
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
  // A transport must honour its signal and return only after its request has
  // finished. Racing keeps even an uncooperative transport within our deadline;
  // its aborted request is never retried, and a late result is never accepted.
  const operation = Promise.resolve().then(() => {
    if (cause === 'ABORTED') throw aborted();
    return search(provider, { plate, signal: controller.signal });
  });
  try {
    const result = await Promise.race([operation, stop]);
    if (signal?.aborted) throw aborted();
    return { result };
  } catch (error) {
    if (cause === 'ABORTED' || signal?.aborted) throw aborted();
    if (cause) return { failure: { status: 'timeout', code: cause } };
    return { failure: { status: 'error', code: safeCode(error?.code) } };
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * `search(provider, {plate, signal})` must obtain a verified original Encar ID
 * from that provider's public data and match the full plate. An internal site ID
 * or a number inferred solely from its URL is not evidence of an Encar ID.
 * No default transport is supplied until that site's search contract is known.
 */
export async function resolveEncarId({ plate: input, search, signal, providerTimeoutMs = 10000, totalTimeoutMs = 35000 } = {}) {
  const plate = normalizedPlate(input);
  if (!plate) throw invalid('INVALID_PLATE');
  if (typeof search !== 'function') throw invalid('INVALID_SEARCH');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw invalid('INVALID_SIGNAL');
  timeout(providerTimeoutMs); timeout(totalTimeoutMs);
  if (signal?.aborted) throw aborted();
  const deadline = now() + totalTimeoutMs, attempts = [];
  for (const provider of PROVIDERS) {
    if (signal?.aborted) throw aborted();
    const remaining = deadline - now();
    if (remaining <= 0) return { status: 'error', plate, code: 'TOTAL_TIMEOUT', attempts };
    const started = now(), deadlineLimited = remaining <= providerTimeoutMs;
    const response = await callProvider(provider, { plate, search, signal, milliseconds: Math.max(1, Math.ceil(Math.min(providerTimeoutMs, remaining))), deadlineLimited });
    if (signal?.aborted) throw aborted();
    const finished = now(), elapsed = finished - started;
    // A synchronous transport can delay timer callbacks. Its late result must
    // still fail the deadline rather than being accepted because the timer did
    // not get an event-loop turn first.
    const late = finished >= deadline ? 'TOTAL_TIMEOUT' : elapsed >= providerTimeoutMs ? 'PROVIDER_TIMEOUT' : null;
    const value = response.failure || (late ? { status: 'timeout', code: late } : classify(response.result, provider, plate));
    attempts.push({ provider: provider.id, status: value.status, ...(value.code ? { code: value.code } : {}), elapsedMs: Math.max(0, Math.round(elapsed)) });
    if (value.status === 'found') return { status: 'found', plate, id: value.id, provider: provider.id, attempts };
    if (value.code === 'TOTAL_TIMEOUT') return { status: 'error', plate, code: 'TOTAL_TIMEOUT', attempts };
  }
  if (attempts.every(attempt => attempt.status === 'not_found')) return { status: 'not_found', plate, code: 'NOT_FOUND', attempts };
  return { status: 'error', plate, code: attempts.some(attempt => attempt.status === 'ambiguous') ? 'AMBIGUOUS' : 'PROVIDERS_UNAVAILABLE', attempts };
}
