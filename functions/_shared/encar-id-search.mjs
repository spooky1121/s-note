import { PROVIDERS } from './encar-id-resolver.mjs';
import { readSearchAdvertisement, validatedDetailURL } from './encar-id-search-parser.mjs';

// Fixed indexed search only. No page automation, advertisement navigation,
// arbitrary URL input, price lookup, vehicle write or persistent result cache.
const SEARCH_URL = 'https://api.tavily.com/search';
const EXTRACT_URL = 'https://api.tavily.com/extract';
const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 6;
const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
const SAFE_FAILURES = new Set(['SEARCH_AUTH_FAILED', 'SEARCH_RATE_LIMITED', 'SEARCH_NOT_CONFIGURED', 'SEARCH_UNAVAILABLE']);
const fail = (code, extras = {}) => Object.assign(new Error(code), { code, ...extras });
const aborted = () => Object.assign(fail('ABORTED'), { name: 'AbortError' });
function cancel(response) { try { void response?.body?.cancel().catch(() => {}); } catch {} }
function retryAfter(response) {
  const value = response.headers?.get('Retry-After') || '';
  if (/^[0-9]{1,10}$/.test(value)) return Math.max(1, Math.min(3600, Number(value)));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.min(3600, Math.ceil((date - Date.now()) / 1000))) : 60;
}
async function interruptible(operation, signal) {
  const pending = Promise.resolve(operation);
  if (signal.aborted) { void pending.catch(() => {}); throw aborted(); }
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(aborted());
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([pending, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function json(response, signal) {
  const length = response.headers.get('Content-Length');
  if ((length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) ||
      !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
    cancel(response); throw fail('SEARCH_UNAVAILABLE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail('SEARCH_UNAVAILABLE');
  const stop = () => { try { void reader.cancel().catch(() => {}); } catch {} };
  signal.addEventListener('abort', stop, { once: true });
  let size = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await interruptible(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw fail('SEARCH_UNAVAILABLE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { stop(); throw error; }
  finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}
function mentionsPlate(result, plate) {
  const text = ['title', 'content', 'raw_content'].map(key => typeof result?.[key] === 'string' ? result[key] : '').join('\n').normalize('NFKC');
  // Keep years, prices and separate fields apart. Only formatting inside the
  // plate may vary; an adjacent extra digit or different Korean letter cannot.
  const pattern = Array.from(plate).join('[\\t\\p{Zs}-]*');
  return new RegExp('(?:^|[^0-9가-힣])' + pattern + '(?:$|[^0-9가-힣])', 'u').test(text);
}

/** One provider search, plus at most one extraction of observed detail URLs. */
export async function searchExternalAdvertisements(provider, { plate, signal, apiKey, fetchImpl = fetch } = {}) {
  if (signal?.aborted) throw aborted();
  if (!PROVIDERS.some(value => value.id === provider?.id && value.host === provider.host && value.url === provider.url) ||
      typeof plate !== 'string' || !PLATE.test(plate) || typeof fetchImpl !== 'function') return { status: 'error', code: 'INVALID_REQUEST' };
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || key.length > 4096 || /[^\x21-\x7e]/u.test(key)) throw fail('SEARCH_NOT_CONFIGURED');
  const controller = new AbortController(), stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, TIMEOUT_MS);
  async function request(url, body) {
    if (controller.signal.aborted) throw aborted();
    const pending = Promise.resolve().then(() => fetchImpl(url, {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body)
    }));
    void pending.then(response => { if (controller.signal.aborted) cancel(response); }, () => {});
    const response = await interruptible(pending, controller.signal);
    if ([401, 403].includes(response.status)) { cancel(response); throw fail('SEARCH_AUTH_FAILED'); }
    if ([429, 432, 433, 434].includes(response.status)) { cancel(response); throw fail('SEARCH_RATE_LIMITED', { retryAfter: retryAfter(response) }); }
    if (!response.ok) { cancel(response); throw fail('SEARCH_UNAVAILABLE'); }
    return json(response, controller.signal);
  }
  try {
    const data = await request(SEARCH_URL, {
      query: '"' + plate + '" site:' + provider.host,
      exact_match: true, include_domains: [provider.host], include_domains_mode: 'restrict',
      search_depth: 'basic', max_results: MAX_RESULTS, auto_parameters: false,
      include_answer: false, include_raw_content: 'markdown'
    });
    if (!Array.isArray(data?.results)) throw fail('SEARCH_UNAVAILABLE');
    if (!data.results.length) return { status: 'not_found' };
    const entries = [];
    for (const result of data.results.slice(0, MAX_RESULTS)) {
      const parsed = readSearchAdvertisement(result, provider, plate);
      if (parsed?.status === 'found') return parsed;
      entries.push({ result, url: validatedDetailURL(result?.url, provider), parsed });
    }
    const urls = [...new Set(entries.filter(entry => entry.url && entry.parsed?.status === 'error' && mentionsPlate(entry.result, plate)).map(entry => entry.url))].slice(0, 3);
    if (urls.length) {
      const extracted = await request(EXTRACT_URL, { urls, extract_depth: 'basic', format: 'markdown', include_images: false });
      if (!Array.isArray(extracted?.results) || (extracted.failed_results !== undefined && !Array.isArray(extracted.failed_results))) throw fail('SEARCH_UNAVAILABLE');
      for (const result of extracted.results.slice(0, 3)) {
        const url = validatedDetailURL(result?.url, provider);
        if (!url || !urls.includes(url)) continue;
        for (const entry of entries) if (entry.url === url) {
          const parsed = readSearchAdvertisement({ ...entry.result, ...result, title: entry.result.title }, provider, plate);
          if (parsed?.status === 'found') return parsed;
          entry.parsed = parsed;
        }
      }
    }
    if (entries.some(entry => entry.parsed?.status === 'ambiguous')) return { status: 'ambiguous', code: 'AMBIGUOUS' };
    return data.results.length <= MAX_RESULTS && entries.every(entry => entry.parsed?.status === 'not_found')
      ? { status: 'not_found' } : { status: 'error', code: 'AD_ID_UNVERIFIED' };
  } catch (error) {
    if (signal?.aborted) throw aborted();
    if (SAFE_FAILURES.has(error?.code)) throw error;
    throw fail('SEARCH_UNAVAILABLE');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); controller.abort(); }
}
