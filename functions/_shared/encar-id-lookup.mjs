import { PROVIDERS } from './encar-id-resolver.mjs';

const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
const AD_ID = /^[1-9][0-9]{5,11}$/;
const FATAL = new Set(['SEARCH_NOT_CONFIGURED', 'SEARCH_AUTH_FAILED', 'SEARCH_RATE_LIMITED', 'SEARCH_UNAVAILABLE', 'SEARCH_INVALID_RESPONSE']);
const failure = code => Object.assign(new Error(code), { code });
const aborted = () => Object.assign(failure('ABORTED'), { name: 'AbortError' });

function normalizePlate(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const plate = value.normalize('NFKC').replace(/[\s-]+/gu, '');
  return PLATE.test(plate) ? plate : '';
}
function matchingResult(result, provider, plate) {
  if (!result || Array.isArray(result) || result.status !== 'found' || normalizePlate(result.plate) !== plate || typeof result.id !== 'string' || !AD_ID.test(result.id)) return false;
  const source = result.sourceUrl;
  if (typeof source !== 'string' || source.length > 2048 || /[\s\\#\u0000-\u001f\u007f-\u009f]/u.test(source)) return false;
  try {
    const url = new URL(source), authority = /^https:\/\/([^/?#]+)/i.exec(source)?.[1];
    return authority?.toLowerCase() === provider.host && url.protocol === 'https:' && url.hostname === provider.host && !url.port && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function checkCancellation(signal) { if (signal?.aborted) throw aborted(); }
async function cancellableSearch(operation, signal) {
  checkCancellation(signal);
  if (!signal) return operation();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { checkCancellation(signal); return operation(); }), cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

// Each HTTP search has its own eight-second limit. This loop only decides
// which source comes next; it never opens an advertisement or writes a vehicle.
export async function findAdvertisementId({ plate: input, search, signal } = {}) {
  const plate = normalizePlate(input);
  if (!plate) throw failure('INVALID_PLATE');
  if (typeof search !== 'function') throw failure('INVALID_SEARCH');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw failure('INVALID_SIGNAL');
  let failed = false, ambiguous = false;
  for (const provider of PROVIDERS) {
    checkCancellation(signal);
    let result;
    try { result = await cancellableSearch(() => search(provider, { plate, signal }), signal); }
    catch (error) {
      checkCancellation(signal);
      if (FATAL.has(error?.code)) throw error;
      failed = true;
      continue;
    }
    checkCancellation(signal);
    if (matchingResult(result, provider, plate)) return { status: 'found', plate, id: result.id, provider: provider.id };
    if (result?.status === 'error' && FATAL.has(result.code)) {
      const error = failure(result.code);
      if (Number.isInteger(result.retryAfter)) error.retryAfter = Math.max(1, Math.min(3600, result.retryAfter));
      throw error;
    }
    if (result?.status !== 'not_found') failed = true;
    if (result?.status === 'ambiguous') ambiguous = true;
  }
  return failed ? { status: 'error', plate, code: ambiguous ? 'AMBIGUOUS' : 'PROVIDERS_UNAVAILABLE' } : { status: 'not_found', plate, code: 'NOT_FOUND' };
}
