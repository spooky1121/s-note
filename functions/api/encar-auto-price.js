import { onRequest as resolveAdvertisement } from './encar.js';
import { parseEncarPrice } from '../_shared/encar-price-ocr.mjs';
import { permittedAPIOrigin, securityResponse, hardenAPIResponse } from '../_shared/api-security.js';

// The browser receives a reviewed amount only. Images, OCR text and service
// credentials are intentionally kept out of responses and persistent storage.
const MAX_REQUEST = 2048;
const MAX_CAPTURE = 6 * 1024 * 1024;
const MAX_OCR = 4 * 1024 * 1024;
const MAX_PRICE = 1000000000000;
const DEADLINE_MS = 60000;
const CAPTURE_MS = 20000;
const OCR_MS = 10000;
const RELEASE = '2.137';
const PRICE_CACHE_MS = 10000;
const MAX_PRICE_CACHE = 32;
const MAX_RETRY_SECONDS = 86400;
// Only settled numeric/identity records live here. Never share a Response,
// stream, promise, auth result, image, OCR text or credential across requests.
const providerRuntimes = new WeakMap();
const DETAIL = 'https://fem.encar.com/cars/detail/';
const REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
const PLATE = new RegExp('^(?:' + REGIONS + ')?[0-9]{2,3}[가-힣][0-9]{4}$');
const BLOCKED_TEXT = /captcha|verify\s*(?:you|human)|access\s*denied|서비스\s*이용\s*제한|비정상적인\s*트래픽|보안\s*문자|사람인지\s*확인|요청\s*차단/i;
const INACTIVE_TEXT = /판매\s*(?:완료|종료)|판매된\s*차량|광고\s*(?:종료|중단)|\bSOLD\b|\bREMOVED\b/i;
const ERRORS = Object.freeze({
  INVALID_REQUEST: [400, '자동 가격 인식 요청을 확인해 주세요.'],
  REQUEST_TOO_LARGE: [413, '자동 가격 인식 요청 크기를 확인해 주세요.'],
  AUTH_REQUIRED: [401, '로그인 후 자동 가격 인식을 다시 시도해 주세요.'],
  FORBIDDEN: [403, '자동 가격 인식 권한을 확인해 주세요.'],
  SETUP_REQUIRED: [503, '서버 자동 캡처 서비스 연결 설정이 필요합니다.'],
  VEHICLE_UNVERIFIED: [409, '차량번호와 현재 광고 상태를 먼저 확인해 주세요.'],
  VERIFY_UNAVAILABLE: [502, '엔카 광고의 차량 정보를 확인하지 못했습니다.'],
  REQUEST_BUDGET_EXCEEDED: [502, '광고 확인의 추가 탐색을 멈췄습니다. 잠시 후 다시 시도해 주세요.'],
  CAPTURE_AUTH_FAILED: [502, '서버 자동 캡처 서비스 인증 설정을 확인해 주세요.'],
  CAPTURE_RATE_LIMITED: [429, '서버 자동 캡처 이용 한도를 확인해 주세요.'],
  CAPTURE_UNAVAILABLE: [502, '엔카 화면을 자동으로 열지 못했습니다.'],
  CAPTURE_INVALID: [502, '자동 캡처 화면을 확인하지 못했습니다.'],
  CAPTURE_TIMEOUT: [504, '엔카 화면 자동 캡처가 지연됐습니다.'],
  OCR_AUTH_FAILED: [502, 'Google Vision 인식 설정을 확인해 주세요.'],
  OCR_RATE_LIMITED: [429, 'Google Vision 인식 이용 한도를 확인해 주세요.'],
  OCR_UNAVAILABLE: [502, '자동 캡처의 금액을 인식하지 못했습니다.'],
  OCR_INVALID: [502, '자동 가격 인식 응답을 확인하지 못했습니다.'],
  OCR_TIMEOUT: [504, '자동 가격 인식 응답이 지연됐습니다.'],
  CAPTURE_BLOCKED: [422, '엔카에서 자동 화면 확인을 제한했습니다.'],
  PLATE_MISMATCH: [409, '자동 캡처의 차량번호를 확인하지 못했습니다.'],
  PRICE_NOT_FOUND: [422, '자동 캡처에서 판매가격을 찾지 못했습니다.'],
  PRICE_AMBIGUOUS: [422, '여러 금액이 보여 판매가격을 자동으로 선택하지 않았습니다.'],
  REQUEST_TIMEOUT: [504, '자동 가격 확인 시간이 초과됐습니다.'],
  REQUEST_ABORTED: [408, '자동 가격 확인 요청이 취소됐습니다.']
});
class AutoPriceError extends Error {
  constructor(code, { upstreamStatus, retryAfterSeconds } = {}) {
    super(code); this.code = code;
    if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) this.upstreamStatus = upstreamStatus;
    if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 0 && retryAfterSeconds <= MAX_RETRY_SECONDS) this.retryAfterSeconds = retryAfterSeconds;
  }
}
const fail = code => { throw new AutoPriceError(code); };
function stamp(response, requestId) {
  const headers = new Headers(response.headers);
  headers.set('X-Request-ID', requestId); headers.set('X-Encar-Resolver-Release', RELEASE);
  return new Response(response.body, { status: response.status, headers });
}
function diagnostics(op, error) {
  return { requestId: op.requestId, resolverRelease: RELEASE, endpoint: 'encar-auto-price', stage: op.stage,
    priceCacheHit: op.priceCacheHit,
    ...(Number.isInteger(error?.upstreamStatus ?? op.upstreamStatus) ? { upstreamStatus: error?.upstreamStatus ?? op.upstreamStatus } : {}),
    ...(Number.isInteger(error?.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}) };
}
function json(value, status = 200, op = null, extraHeaders = {}) {
  return stamp(hardenAPIResponse(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } })), op?.requestId || crypto.randomUUID());
}
function failure(op, failure) {
  const code = ERRORS[failure.code] ? failure.code : 'CAPTURE_UNAVAILABLE', [status, error] = ERRORS[code];
  const retry = failure.retryAfterSeconds;
  return json({ ok: false, code, error, diagnostics: diagnostics(op, failure),
    ...(Number.isInteger(retry) ? { retryAfterSeconds: retry } : {}) }, status, op,
  Number.isInteger(retry) ? { 'Retry-After': String(retry) } : {});
}
function runtimeFor(settings) {
  const fetcher = globalThis.fetch;
  let runtime = providerRuntimes.get(fetcher);
  if (!runtime || runtime.account !== settings.account) {
    runtime = { account: settings.account, prices: new Map(), capture: null, vision: null };
    providerRuntimes.set(fetcher, runtime);
  }
  for (const [key, entry] of runtime.prices) if (entry.expiresAt <= Date.now()) runtime.prices.delete(key);
  return runtime;
}
function retrySeconds(header, fallback) {
  if (typeof header !== 'string' || header.length > 128) return fallback;
  const value = header.trim(); let seconds;
  if (/^\d{1,10}$/.test(value)) seconds = Number(value);
  else if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    const time = Date.parse(value); if (Number.isFinite(time) && new Date(time).toUTCString() === value) seconds = Math.max(0, Math.ceil((time - Date.now()) / 1000));
  }
  return Number.isFinite(seconds) ? Math.min(MAX_RETRY_SECONDS, seconds) : fallback;
}
function providerFailure(runtime, provider, response, code) {
  const fallback = response.status === 429 ? 10 : 3;
  const retryAfterSeconds = retrySeconds(response.headers.get('Retry-After'), fallback);
  const record = Object.freeze({ code, upstreamStatus: response.status, until: Date.now() + retryAfterSeconds * 1000 });
  runtime[provider] = record;
  throw new AutoPriceError(code, { upstreamStatus: response.status, retryAfterSeconds });
}
function checkCooldown(op, runtime, provider) {
  const record = runtime[provider];
  if (!record) return;
  if (record.until <= Date.now()) { runtime[provider] = null; return; }
  op.stage = provider;
  throw new AutoPriceError(record.code, { upstreamStatus: record.upstreamStatus,
    retryAfterSeconds: Math.ceil((record.until - Date.now()) / 1000) });
}
function plateOf(value) { if (typeof value !== 'string' || value.length > 40) return ''; const text = value.normalize('NFKC').replace(/[\s-]/g, ''); return PLATE.test(text) ? text : ''; }
function idOf(value) { return typeof value === 'string' && /^[1-9][0-9]{0,11}$/.test(value) ? value : ''; }
function keyOf(value, maximum = 1024) { return typeof value === 'string' && value.trim().length >= 8 && value.trim().length <= maximum && /^[\x21-\x7e]+$/.test(value.trim()) ? value.trim() : ''; }
function config(env) {
  const account = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' && /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID.trim()) ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
  const token = keyOf(env.CLOUDFLARE_BROWSER_TOKEN, 4096), vision = keyOf(env.GOOGLE_VISION_API_KEY);
  return { account, token, vision, configured: !!(account && token && vision) };
}
function cancel(body) { try { void body?.cancel().catch(() => {}); } catch (_) {} }
function wait(value, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AutoPriceError('REQUEST_ABORTED'));
    if (signal.aborted) { Promise.resolve(value).catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then(result => { signal.removeEventListener('abort', abort); resolve(result); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function bytes(message, maximum, signal, code) {
  const length = message.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) { cancel(message.body); fail(code); }
  const reader = message.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    for (;;) { const part = await wait(reader.read(), signal); if (part.done) break; size += part.value.byteLength; if (size > maximum) fail(code); chunks.push(part.value); }
    const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
  } catch (error) { try { void reader.cancel().catch(() => {}); } catch (_) {} throw error; }
  finally { try { reader.releaseLock(); } catch (_) {} }
}
async function readJson(message, maximum, signal, code) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(message, maximum, signal, code))); } catch (error) { if (error instanceof AutoPriceError) throw error; fail(code); } }
function operation(request) {
  const controller = new AbortController(), deadline = Date.now() + DEADLINE_MS;
  let expired = false;
  const abort = () => controller.abort();
  request.signal?.addEventListener('abort', abort, { once: true }); if (request.signal?.aborted) abort();
  const timer = setTimeout(() => { expired = true; controller.abort(); }, DEADLINE_MS);
  return { requestId: crypto.randomUUID(), stage: 'verify', priceCacheHit: false, upstreamStatus: null,
    controller, deadline, get expired() { return expired; }, finish() { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); controller.abort(); } };
}
async function stage(op, maximum, reserve, timeoutCode, work) {
  const available = op.deadline - Date.now() - reserve; if (available < 100 || op.controller.signal.aborted) fail(op.expired ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED');
  const controller = new AbortController(), abort = () => controller.abort(); let timedOut = false;
  op.controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(maximum, available));
  try { return await wait(work(controller.signal, Math.min(maximum, available)), controller.signal); }
  catch (error) { if (op.expired) fail('REQUEST_TIMEOUT'); if (timedOut) fail(timeoutCode); if (op.controller.signal.aborted) fail('REQUEST_ABORTED'); throw error; }
  finally { clearTimeout(timer); op.controller.signal.removeEventListener('abort', abort); controller.abort(); }
}
function goodPrice(item) {
  return item && ['verified', 'review'].includes(item.priceStatus) && item.priceSource === 'encar.com' && Number.isSafeInteger(item.priceWon) && item.priceWon > 0 && item.priceWon <= MAX_PRICE && typeof item.priceCheckedAt === 'string' && Number.isFinite(Date.parse(item.priceCheckedAt)) && Date.parse(item.priceCheckedAt) <= Date.now() + 60000;
}
async function verify(op, request, env, plate, id) {
  return stage(op, 35000, 2000, 'VERIFY_UNAVAILABLE', async signal => {
    const url = new URL('/api/encar', request.url);
    const response = await wait(resolveAdvertisement({ request: new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('Authorization') || '', Origin: url.origin },
      body: JSON.stringify({ plate, candidateIds: [id] }), signal
    }), env: { ...env, ENCAR_API_KEY: '', TAVILY_API_KEY: '', ENCAR_CACHE: undefined } }), signal);
    op.upstreamStatus = response.status;
    const transient = !response.ok && (response.status === 429 || response.status >= 500 && response.status <= 599);
    let result;
    try { result = await readJson(response, 128 * 1024, signal, 'VERIFY_UNAVAILABLE'); }
    catch (error) { if (!transient || error?.code !== 'VERIFY_UNAVAILABLE') throw error; }
    if (response.status === 401) fail('AUTH_REQUIRED'); if (response.status === 403) fail('FORBIDDEN');
    if (!response.ok && result?.diagnostics?.code === 'SUPABASE_NOT_CONFIGURED') fail('SETUP_REQUIRED');
    if (!response.ok && result?.diagnostics?.code === 'REQUEST_BUDGET_EXCEEDED') throw new AutoPriceError('REQUEST_BUDGET_EXCEEDED', {
      upstreamStatus: response.status, retryAfterSeconds: retrySeconds(response.headers.get('Retry-After'), 5)
    });
    if (transient) throw new AutoPriceError('VERIFY_UNAVAILABLE', {
      upstreamStatus: response.status, retryAfterSeconds: retrySeconds(response.headers.get('Retry-After'), 3)
    });
    if (!response.ok || result?.status !== 'found' || result.plate !== plate || !Array.isArray(result.listings)) fail('VEHICLE_UNVERIFIED');
    const matches = result.listings.filter(item => item?.id === id && item.sellerUrl === DETAIL + id);
    if (matches.length !== 1 || Object.hasOwn(matches[0], 'externalVerification')) fail('VEHICLE_UNVERIFIED');
    const checked = typeof result.verifiedAt === 'string' ? new Date(result.verifiedAt) : new Date(NaN);
    if (!Number.isFinite(checked.getTime()) || checked.toISOString() !== result.verifiedAt || checked.getTime() > Date.now() + 60000) fail('VERIFY_UNAVAILABLE');
    return { listing: matches[0], verifiedAt: result.verifiedAt };
  });
}
function validPng(image) {
  if (image.length < 24 || ![137,80,78,71,13,10,26,10].every((value, i) => image[i] === value) || ![73,72,68,82].every((value, i) => image[12 + i] === value)) return false;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength), width = view.getUint32(16), height = view.getUint32(20);
  return width >= 320 && width <= 2880 && height >= 200 && height <= 3000 && width * height <= 8000000;
}
function validDimensions(width, height) { return width >= 320 && width <= 2880 && height >= 200 && height <= 3000 && width * height <= 8000000; }
function validJpeg(image) {
  if (image.length < 16 || image[0] !== 0xff || image[1] !== 0xd8 || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) return false;
  let offset = 2;
  while (offset + 3 < image.length && offset < 256 * 1024) {
    if (image[offset++] !== 0xff) return false;
    while (image[offset] === 0xff && offset < image.length) offset++;
    const marker = image[offset++];
    if (marker === 0xda || marker === 0xd9 || marker === 0 || marker === undefined) return false;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
    const length = image[offset] * 256 + image[offset + 1];
    if (length < 2 || offset + length > image.length) return false;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 11 || image[offset + 2] !== 8) return false;
      const height = image[offset + 3] * 256 + image[offset + 4], width = image[offset + 5] * 256 + image[offset + 6], components = image[offset + 7];
      return [1, 3, 4].includes(components) && length === 8 + components * 3 && validDimensions(width, height);
    }
    offset += length;
  }
  return false;
}
function base64(image) {
  if (typeof image.toBase64 === 'function') return image.toBase64();
  let text = ''; for (let i = 0; i < image.length; i += 0x8000) text += String.fromCharCode(...image.subarray(i, i + 0x8000)); return btoa(text);
}
function matchingPlate(text, plate) {
  // Keep word/line boundaries so a following price does not become extra plate
  // digits; allow OCR spacing inside the actual plate without taking a suffix.
  const normalized = text.normalize('NFKC').replace(/[·-]/g, ' ');
  const pattern = new RegExp('(?<![0-9])(?:' + REGIONS + '[ \\t]*)?[0-9]{2,3}[ \\t\\r\\n]*[가-힣][ \\t\\r\\n]*[0-9]{4}(?![0-9])', 'gu');
  return [...normalized.matchAll(pattern)].some(match => plateOf(match[0]) === plate);
}
async function capture(op, settings, id, runtime) {
  op.stage = 'capture'; op.upstreamStatus = null;
  return stage(op, CAPTURE_MS, 8000, 'CAPTURE_TIMEOUT', async (signal, budget) => {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + settings.account + '/browser-rendering/screenshot';
    const response = await wait(fetch(url, {
      method: 'POST', headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': 'application/json', Accept: 'image/jpeg, image/png' },
      body: JSON.stringify({ url: DETAIL + id, viewport: { width: 1440, height: 1200, deviceScaleFactor: 1 }, screenshotOptions: { type: 'jpeg', quality: 98, fullPage: false, captureBeyondViewport: false }, gotoOptions: { waitUntil: 'networkidle2', timeout: Math.max(100, Math.min(15000, budget - 250)) } }),
      redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal
    }), signal);
    op.upstreamStatus = response.status;
    if ([401,403].includes(response.status)) { cancel(response.body); fail('CAPTURE_AUTH_FAILED'); }
    if (response.status === 429 || response.status >= 500 && response.status <= 599) {
      cancel(response.body); providerFailure(runtime, 'capture', response, response.status === 429 ? 'CAPTURE_RATE_LIMITED' : 'CAPTURE_UNAVAILABLE');
    }
    if (response.status !== 200) { cancel(response.body); fail('CAPTURE_UNAVAILABLE'); }
    const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg'].includes(type)) { cancel(response.body); fail('CAPTURE_INVALID'); }
    const image = await bytes(response, MAX_CAPTURE, signal, 'CAPTURE_INVALID');
    if (!(type === 'image/png' ? validPng(image) : validJpeg(image))) fail('CAPTURE_INVALID'); return image;
  });
}
async function recognize(op, settings, image, plate, runtime) {
  op.stage = 'vision'; op.upstreamStatus = null;
  return stage(op, OCR_MS, 0, 'OCR_TIMEOUT', async signal => {
    const response = await wait(fetch('https://vision.googleapis.com/v1/images:annotate?fields=responses(error,fullTextAnnotation(text),textAnnotations(description))', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.vision },
      body: JSON.stringify({ requests: [{ image: { content: base64(image) }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['ko','en'] } }] }),
      redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal
    }), signal);
    op.upstreamStatus = response.status;
    if ([400,401,403].includes(response.status)) { cancel(response.body); fail('OCR_AUTH_FAILED'); }
    if (response.status === 429 || response.status >= 500 && response.status <= 599) {
      cancel(response.body); providerFailure(runtime, 'vision', response, response.status === 429 ? 'OCR_RATE_LIMITED' : 'OCR_UNAVAILABLE');
    }
    if (response.status !== 200 || (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') { cancel(response.body); fail('OCR_UNAVAILABLE'); }
    const data = await readJson(response, MAX_OCR, signal, 'OCR_INVALID'), result = data?.responses?.[0];
    if (!result || result.error) fail('OCR_UNAVAILABLE');
    const annotation = result.fullTextAnnotation || { text: result.textAnnotations?.[0]?.description };
    if (typeof annotation.text !== 'string' || annotation.text.length > 200000) fail('OCR_INVALID');
    const text = annotation.text.normalize('NFKC');
    // Reject the entire result before the shared parser's bounds can hide a
    // later conflicting amount or a blocked-page marker.
    if (text.length > 200000 || (text.match(/만\s*원/gu) || []).length > 1000) fail('OCR_INVALID');
    if (BLOCKED_TEXT.test(text) || INACTIVE_TEXT.test(text)) fail('CAPTURE_BLOCKED');
    if (!matchingPlate(text, plate)) fail('PLATE_MISMATCH');
    const candidates = parseEncarPrice({ text }); if (!candidates.length) fail('PRICE_NOT_FOUND'); if (candidates.length !== 1) fail('PRICE_AMBIGUOUS'); return candidates[0].priceWon;
  });
}

export async function onRequest({ request, env = {} }) {
  if (!permittedAPIOrigin(request)) return stamp(securityResponse('FORBIDDEN'), crypto.randomUUID());
  if (request.method === 'GET') return json({ ok: true, configured: config(env).configured });
  if (request.method !== 'POST') return stamp(securityResponse('METHOD_NOT_ALLOWED', { Allow: 'GET, POST' }), crypto.randomUUID());
  const op = operation(request);
  try {
    if (new URL(request.url).search || (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_REQUEST');
    if (!/^Bearer\s+[A-Za-z0-9._-]{30,5000}$/i.test(request.headers.get('Authorization') || '')) fail('AUTH_REQUIRED');
    const raw = await stage(op, 5000, 2000, 'REQUEST_TIMEOUT', signal => bytes(request, MAX_REQUEST, signal, 'REQUEST_TOO_LARGE'));
    let payload;try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch (_) { fail('INVALID_REQUEST'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).sort().join(',') !== 'id,plate') fail('INVALID_REQUEST');
    const plate = plateOf(payload.plate), id = idOf(payload.id); if (!plate || !id) fail('INVALID_REQUEST');
    const verified = await verify(op, request, env, plate, id), existing = verified.listing;
    if (goodPrice(existing)) return json({ ok: true, plate, verifiedAt: verified.verifiedAt, listing: { id, priceWon: existing.priceWon, priceCheckedAt: existing.priceCheckedAt, priceSource: existing.priceSource, priceStatus: 'review' }, diagnostics: diagnostics(op) }, 200, op);
    const settings = config(env); if (!settings.configured) fail('SETUP_REQUIRED');
    const runtime = runtimeFor(settings), cacheKey = plate + ':' + id, cached = runtime.prices.get(cacheKey);
    if (cached) {
      op.priceCacheHit = true;
      return json({ ok: true, plate, verifiedAt: verified.verifiedAt, listing: { id, priceWon: cached.priceWon, priceCheckedAt: cached.priceCheckedAt, priceSource: 'encar.com-ocr', priceStatus: 'review' }, diagnostics: diagnostics(op) }, 200, op);
    }
    // A known Vision cooldown must stop before another screenshot is billed.
    checkCooldown(op, runtime, 'vision'); checkCooldown(op, runtime, 'capture');
    const image = await capture(op, settings, id, runtime);
    checkCooldown(op, runtime, 'vision');
    const priceWon = await recognize(op, settings, image, plate, runtime), priceCheckedAt = new Date().toISOString();
    if (op.controller.signal.aborted) fail(op.expired ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED');
    if (runtime.prices.size >= MAX_PRICE_CACHE) runtime.prices.delete(runtime.prices.keys().next().value);
    runtime.prices.set(cacheKey, Object.freeze({ plate, id, sourceCheckedAt: verified.verifiedAt, priceWon, priceCheckedAt, expiresAt: Date.now() + PRICE_CACHE_MS }));
    return json({ ok: true, plate, verifiedAt: verified.verifiedAt, listing: { id, priceWon, priceCheckedAt, priceSource: 'encar.com-ocr', priceStatus: 'review' }, diagnostics: diagnostics(op) }, 200, op);
  } catch (error) { return failure(op, error instanceof AutoPriceError ? error : new AutoPriceError(op.expired ? 'REQUEST_TIMEOUT' : 'CAPTURE_UNAVAILABLE')); }
  finally { op.finish(); }
}
