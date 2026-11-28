import { hardenAPIResponse, readBoundedBytes, sameOriginRequest } from '../_shared/api-security.js';
import { createServiceTelemetry } from '../_shared/service-telemetry.mjs';
import { analyzeScannerDocument } from '../_shared/scanner-ocr.mjs';
import { openScannerImage } from './scanner.js';

const ERRORS = {
  UNAUTHORIZED: [401, '다시 로그인해 주세요.'],
  FORBIDDEN: [403, '스캔 문서 분석 권한을 확인해 주세요.'],
  INVALID_REQUEST: [400, '분석할 스캔 문서를 확인해 주세요.'],
  CONFLICT: [409, '문서가 변경되었습니다. 다시 불러온 뒤 확인해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '분석 요청 크기를 확인해 주세요.'],
  UNSUPPORTED_MEDIA_TYPE: [415, '지원하는 스캔 이미지 형식을 확인해 주세요.'],
  SETUP_REQUIRED: [503, '스캔 문서 저장소 설정을 확인해 주세요.'],
  NETWORK: [502, '스캔 문서를 확인하지 못했습니다. 다시 시도해 주세요.'],
  OCR_SETUP_REQUIRED: [503, 'Google Vision API 연결 설정을 확인해 주세요.'],
  OCR_RATE_LIMITED: [429, '문서 분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.'],
  OCR_UPSTREAM: [502, '문서를 분석하지 못했습니다. 다시 시도해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.']
};
const CACHE_LIMIT = 64, CACHE_TTL_MS = 15 * 60 * 1000, MAX_INFLIGHT = 2;
const cache = new Map(), inflight = new Map();
let blockedUntil = 0;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const json = (body, status = 200) => hardenAPIResponse(Response.json(body, { status }));

function cached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, entry);
  return entry.analysis;
}
function remember(key, analysis) {
  const now = Date.now();
  for (const [id, value] of cache) if (value.until <= now) cache.delete(id);
  cache.delete(key); cache.set(key, { until: now + CACHE_TTL_MS, analysis });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}
function providerKey(env) {
  const key = env?.GOOGLE_VISION_API_KEY;
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[^\x21-\x7e]/.test(key)) fail('OCR_SETUP_REQUIRED');
  return key;
}
function base64(bytes) {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
// Browser decoders may already apply EXIF, while Vision's documented bounding
// boxes don't specify an EXIF coordinate contract. Avoid applying it twice.
function exifNeedsReview(bytes, mime) {
  const ascii = (at, text) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  function tiff(start, end) {
    if (end - start >= 6 && ascii(start, 'Exif\0\0')) start += 6;
    const little = ascii(start, 'II'), big = ascii(start, 'MM');
    if ((!little && !big) || end - start < 8) return true;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = at => view.getUint16(at, little), u32 = at => view.getUint32(at, little);
    if (u16(start + 2) !== 42) return true;
    const offset = u32(start + 4), at = start + offset;
    if (offset < 8 || at + 2 > end) return true;
    const count = u16(at);
    if (count > 256 || at + 2 + count * 12 > end) return true;
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (u16(entry) !== 0x112) continue;
      if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return true;
      return u16(entry + 8) !== 1;
    }
    return false;
  }
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (mime === 'image/jpeg') {
      for (let at = 2, count = 0; at + 4 <= bytes.length && count++ < 4096;) {
        if (bytes[at++] !== 255) return true;
        while (bytes[at] === 255) at++;
        const marker = bytes[at++];
        if (marker === 218 || marker === 217) break;
        const length = view.getUint16(at, false), end = at + length;
        if (length < 2 || end > bytes.length) return true;
        if (marker === 225 && length >= 8 && ascii(at + 2, 'Exif\0\0') && tiff(at + 2, end)) return true;
        at = end;
      }
    } else if (mime === 'image/png') {
      for (let at = 8, count = 0; at + 12 <= bytes.length && count++ < 4096;) {
        const size = view.getUint32(at, false), end = at + 8 + size;
        if (end + 4 > bytes.length) return true;
        if (ascii(at + 4, 'eXIf') && tiff(at + 8, end)) return true;
        at = end + 4;
      }
    } else if (mime === 'image/webp') {
      for (let at = 12, count = 0; at + 8 <= bytes.length && count++ < 1024;) {
        const size = view.getUint32(at + 4, true), end = at + 8 + size;
        if (end > bytes.length) return true;
        if (ascii(at, 'EXIF') && tiff(at + 8, end)) return true;
        at = end + (size & 1);
      }
    }
  } catch { return true; }
  return false;
}
async function googleAnalysis(image, key, telemetry) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    telemetry.stage('provider');
    telemetry.bytes({ requestBytes: image.bytes.length });
    const response = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key), {
      method: 'POST', redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: base64(image.bytes) }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['ko', 'en'] } }] })
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 429) { blockedUntil = Date.now() + 30000; fail('OCR_RATE_LIMITED'); }
      if ([400, 401, 403].includes(response.status)) fail('OCR_SETUP_REQUIRED');
      fail('OCR_UPSTREAM');
    }
    telemetry.stage('parse');
    const bytes = await readBoundedBytes(response, 4 * 1024 * 1024, { timeoutMs: 45000 });
    telemetry.bytes({ responseBytes: bytes.length });
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('OCR_UPSTREAM'); }
    if (!plain(result) || !Array.isArray(result.responses) || result.responses.length !== 1 || !plain(result.responses[0])) fail('OCR_UPSTREAM');
    const entry = result.responses[0];
    if (entry.error) {
      if (entry.error.code === 8) { blockedUntil = Date.now() + 30000; fail('OCR_RATE_LIMITED'); }
      if ([7, 16].includes(entry.error.code)) fail('OCR_SETUP_REQUIRED');
      fail('OCR_UPSTREAM');
    }
    if (entry.fullTextAnnotation !== undefined && !plain(entry.fullTextAnnotation)) fail('OCR_UPSTREAM');
    // An empty result is a successful OCR of a document with no readable text.
    // Provider errors above are never represented as an unclassified document.
    const annotation = entry.fullTextAnnotation || {};
    const analysis = analyzeScannerDocument(annotation, { width: image.width, height: image.height });
    return Object.freeze(exifNeedsReview(image.bytes, image.mimeType) ? { ...analysis, rotation: 0, orientation: 'unknown', needsReview: true } : analysis);
  } catch (error) {
    if (ERRORS[error?.code] && error.code.startsWith('OCR_')) throw error;
    fail('OCR_UPSTREAM');
  } finally { clearTimeout(timer); }
}
async function analysisFor(source, key, telemetry) {
  // Neither IDs nor checksums are logged or returned to the provider. The key
  // identifies exactly one immutable stored document, within its company.
  const id = [source.companyId, source.id, source.revision, source.sha256].join(':');
  const hit = cached(id);
  if (hit) return hit;
  if (inflight.has(id)) return inflight.get(id);
  if (blockedUntil > Date.now() || inflight.size >= MAX_INFLIGHT) fail('OCR_RATE_LIMITED');
  const pending = (async () => {
    telemetry.stage('lookup');
    const image = await source.read();
    const analysis = await googleAnalysis(image, key, telemetry);
    // Do not retain results for an object deleted or access revoked during OCR.
    await source.check();
    remember(id, analysis);
    return analysis;
  })();
  inflight.set(id, pending);
  try { return await pending; } finally { if (inflight.get(id) === pending) inflight.delete(id); }
}

export async function onRequest(context) {
  const telemetry = createServiceTelemetry(context, { service: 'vision' });
  const respond = (body, status = 200) => telemetry.finish(json(body, status));
  try {
    const { request, env } = context;
    telemetry.stage('validation');
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    if (!sameOriginRequest(request) || request.headers.get('Content-Encoding') && request.headers.get('Content-Encoding') !== 'identity') fail('FORBIDDEN');
    if (new URL(request.url).search) fail('INVALID_REQUEST');
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('UNSUPPORTED_MEDIA_TYPE');
    const bearer = request.headers.get('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(bearer) || bearer.length > 8200) fail('UNAUTHORIZED');
    let body;
    const bytes = await readBoundedBytes(request, 4096);
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INVALID_REQUEST'); }
    if (!plain(body) || Object.keys(body).length !== 3 || !['companyId', 'id', 'revision'].every(key => Object.hasOwn(body, key))) fail('INVALID_REQUEST');
    telemetry.stage('auth');
    const source = await openScannerImage(env, bearer.slice(7), body);
    telemetry.authorized({ userId: source.actorId });
    const key = providerKey(env);
    const analysis = await analysisFor(source, key, telemetry);
    // All callers, including cache hits and joined requests, must still possess
    // the live office permission and unchanged document at response time.
    await source.check();
    if (request.signal.aborted) fail('NETWORK');
    telemetry.stage('complete');
    return respond({ ok: true, analysis });
  } catch (error) {
    const code = ERRORS[error?.code] ? error.code : 'NETWORK';
    const [status, message] = ERRORS[code];
    return respond({ ok: false, code, error: message }, status);
  }
}
