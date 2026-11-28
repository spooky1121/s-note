import { hardenAPIResponse, readBoundedBytes, sameOriginRequest } from '../_shared/api-security.js';
import { inspectOfficeImage } from '../_shared/office-image.js';
import { authorizeOperatorSession } from './operator.js';

const MAX_FILE = 6 * 1024 * 1024, MAX_BODY = MAX_FILE + 65536;
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FIELDS = ['plate', 'vin', 'model', 'modelYear'];
const ERRORS = {
  UNAUTHORIZED: [401, '운영자 계정으로 다시 로그인해 주세요.'],
  FORBIDDEN: [403, '승인된 운영자만 자체 OCR을 시험할 수 있습니다.'],
  INVALID_REQUEST: [400, '등록증 이미지 한 장을 선택해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '6MB 이하 이미지를 선택해 주세요.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'JPG·PNG·WebP 이미지를 선택해 주세요.'],
  OCR_SETUP_REQUIRED: [503, '자체 OCR 서버 연결 설정을 확인해 주세요. Google로 전송하지 않았습니다.'],
  OCR_BUSY: [429, '다른 문서를 분석 중입니다. 잠시 후 다시 시도해 주세요.'],
  OCR_NOT_READY: [503, '자체 OCR 모델을 준비 중입니다. 다시 시도하거나 직접 입력해 주세요.'],
  OCR_TIMEOUT: [504, '분석 시간이 초과되었습니다. 다시 시도하거나 직접 입력해 주세요.'],
  OCR_FAILED: [502, '자체 OCR 분석을 완료하지 못했습니다. 다시 시도하거나 직접 입력해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.']
};
const fail = code => { throw Object.assign(Error(code), { code }); };
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
function configuration(env, request) {
  if (env?.SNOTE_OPERATOR_OCR_PROVIDER !== 'self') fail('OCR_SETUP_REQUIRED');
  let url; try { url = new URL(env.SNOTE_SELF_OCR_URL); } catch { fail('OCR_SETUP_REQUIRED'); }
  const local = env.SNOTE_OCR_ALLOW_LOCALHOST === '1' && loopback(new URL(request.url).hostname) && loopback(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:') || url.username || url.password || url.search || url.hash || url.pathname !== '/ocr/vehicle-registration') fail('OCR_SETUP_REQUIRED');
  const token = env.SNOTE_OCR_SERVICE_TOKEN;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) fail('OCR_SETUP_REQUIRED');
  return { url: url.href, token };
}
function cleanResult(raw) {
  if (!plain(raw) || raw.ok !== true || raw.engine !== 'paddleocr-self-hosted' || !plain(raw.fields) || !plain(raw.image)) fail('OCR_FAILED');
  const { width, height } = raw.image, rotation = raw.image.rotation ?? 0;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40000000 || ![0, 90, 180, 270].includes(rotation)) fail('OCR_FAILED');
  const fields = {};
  for (const key of FIELDS) {
    const f = raw.fields[key];
    if (!plain(f) || !(f.value === null || typeof f.value === 'string' && f.value.length <= (key === 'model' ? 180 : key === 'modelYear' ? 4 : 32) && !/[\u0000-\u001f\u007f]/u.test(f.value)) || typeof f.needsReview !== 'boolean' || typeof f.autoFill !== 'boolean' || !Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 1 || !Array.isArray(f.reasons) || f.reasons.length > 12 || f.reasons.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(x))) fail('OCR_FAILED');
    if (f.autoFill && (f.needsReview || !f.value)) fail('OCR_FAILED');
    if (f.autoFill && (key === 'vin' && !/^[A-HJ-NPR-Z0-9]{17}$/.test(f.value) || key === 'modelYear' && !/^(19|20)\d\d$/.test(f.value))) fail('OCR_FAILED');
    const polygon = f.polygon;
    if (polygon !== null && (!Array.isArray(polygon) || polygon.length !== 4 || polygon.some(p => !Array.isArray(p) || p.length !== 2 || p.some(x => !Number.isFinite(x)) || p[0] < 0 || p[0] > width || p[1] < 0 || p[1] > height))) fail('OCR_FAILED');
    fields[key] = { value: f.value, needsReview: f.needsReview, reasons: f.reasons, polygon, confidence: f.confidence, autoFill: f.autoFill };
  }
  if (!Number.isFinite(raw.elapsedMs) || raw.elapsedMs < 0 || raw.elapsedMs > 3600000) fail('OCR_FAILED');
  return { ok: true, engine: 'paddleocr-self-hosted', fields, image: { width, height, rotation }, elapsedMs: Math.round(raw.elapsedMs) };
}
export async function onRequest({ request, env }) {
  let controller, timer;
  const reply = (body, status = 200) => hardenAPIResponse(Response.json(body, { status }));
  try {
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    if (!sameOriginRequest(request) || request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding') !== 'identity') fail('FORBIDDEN');
    if (new URL(request.url).search || !/^multipart\/form-data(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('INVALID_REQUEST');
    const bearer = request.headers.get('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(bearer) || bearer.length > 8200) fail('UNAUTHORIZED');
    const actor = await authorizeOperatorSession(env, bearer.slice(7)), config = configuration(env, request);
    const bytes = await readBoundedBytes(request, MAX_BODY);
    let form; try { form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); } catch { fail('INVALID_REQUEST'); }
    const entries = [...form.entries()], file = form.get('file');
    if (entries.length !== 1 || entries[0][0] !== 'file' || !file || typeof file.arrayBuffer !== 'function' || !MIMES.has(file.type)) fail('INVALID_REQUEST');
    if (file.size < 1 || file.size > MAX_FILE) fail('PAYLOAD_TOO_LARGE');
    const image = new Uint8Array(await file.arrayBuffer());
    try { inspectOfficeImage(image, file.type); } catch { fail('UNSUPPORTED_MEDIA_TYPE'); }
    if (request.signal.aborted) fail('OCR_FAILED');
    // Deliberately discard the uploaded filename; only image bytes reach the
    // private CPU service. There is no Google fallback and no Storage write.
    const upload = new FormData(); upload.append('file', new Blob([image], { type: file.type }), 'registration.' + ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type]);
    controller = new AbortController(); timer = setTimeout(() => controller.abort(), 100000);
    const response = await fetch(config.url, { method: 'POST', redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + config.token, Accept: 'application/json' }, body: upload, signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      fail(({ 429: 'OCR_BUSY', 503: 'OCR_NOT_READY', 504: 'OCR_TIMEOUT' })[response.status] || 'OCR_FAILED');
    }
    let raw; try { raw = await readBoundedBytes(response, 65536, { timeoutMs: 100000 }); } catch { fail('OCR_FAILED'); }
    let result; try { result = cleanResult(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); } catch { fail('OCR_FAILED'); }
    await actor.recheck();
    if (request.signal.aborted) fail('OCR_FAILED');
    return reply(result);
  } catch (error) {
    const code = ERRORS[error?.code] ? error.code : ['NETWORK', 'SETUP_REQUIRED'].includes(error?.code) ? 'OCR_SETUP_REQUIRED' : 'OCR_FAILED', [status, message] = ERRORS[code];
    return reply({ ok: false, code, error: message }, status);
  } finally { clearTimeout(timer); controller?.abort(); }
}
