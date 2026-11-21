import { sameOriginRequest, hardenAPIResponse } from '../_shared/api-security.js';

// Only provision the shared private bucket. User-JWT Storage RLS owns all file operations.
const BUCKET = 'snote-business-private';
const LIMIT = 10 * 1024 * 1024;
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BODY = 4096, MAX_RESPONSE = 64 * 1024;
const ERRORS = {
  INVALID_REQUEST: [400, '첨부파일 준비 요청을 확인해 주세요.'],
  UNAUTHORIZED: [401, '온라인 계정으로 다시 로그인해 주세요.'],
  FORBIDDEN: [403, '해당 차량과 첨부파일의 접근 권한을 확인해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  PAYLOAD_TOO_LARGE: [413, '요청 크기가 허용 범위를 초과했습니다.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'JSON 요청만 사용할 수 있습니다.'],
  SETUP_REQUIRED: [503, '업무 첨부파일 저장 연결을 준비하지 못했습니다.'],
  BUCKET_POLICY_MISMATCH: [503, '첨부파일 저장소의 비공개 설정과 업로드 제한을 확인해 주세요.'],
  UPSTREAM_ERROR: [502, '첨부파일 저장소 준비 결과를 확인하지 못했습니다. 다시 시도해 주세요.']
};
class SetupError extends Error { constructor(code) { super(code); this.code = code; } }
function fail(code) { throw new SetupError(code); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function json(body, status = 200) {
  return hardenAPIResponse(new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', ...(status === 405 ? { Allow: 'POST' } : {})
  } }));
}
function errorResponse(error) {
  const code = error instanceof SetupError ? error.code : 'UPSTREAM_ERROR';
  return json({ ok: false, code, error: ERRORS[code][1], message: ERRORS[code][1] }, ERRORS[code][0]);
}
function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match || match[1].length < 30 || match[1].length > 5000) fail('UNAUTHORIZED');
  return match[1];
}
function configuration(env = {}) {
  let url; try { url = new URL(env.SUPABASE_URL); } catch { fail('SETUP_REQUIRED'); }
  const key = name => typeof env[name] === 'string' ? env[name].trim() : '';
  const publishable = key('SUPABASE_PUBLISHABLE_KEY'), service = key('SUPABASE_SERVICE_ROLE_KEY');
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !publishable || !service || [publishable, service].some(value => value.length > 8192 || /[\r\n]/.test(value))) fail('SETUP_REQUIRED');
  return { origin: url.origin, publishable, service };
}
async function readBytes(body, maximum, code) {
  const reader = body?.getReader(); if (!reader) fail(code);
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > maximum) { void reader.cancel().catch(() => {}); fail(code); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function body(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('UNSUPPORTED_MEDIA_TYPE');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail('PAYLOAD_TOO_LARGE');
  if (!request.body) fail('INVALID_REQUEST');
  let timer;
  try {
    const bytes = await Promise.race([readBytes(request.body, MAX_BODY, 'PAYLOAD_TOO_LARGE'), new Promise((_, reject) => {
      timer = setTimeout(() => { void request.body?.cancel().catch(() => {}); reject(new SetupError('INVALID_REQUEST')); }, 5000);
    })]);
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INVALID_REQUEST'); }
    const fields = ['companyId', 'ownerId', 'carId', 'evidenceId', 'entryId'];
    if (!object(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) fail('INVALID_REQUEST');
    for (const key of ['companyId', 'ownerId', 'evidenceId', 'entryId']) {
      if (typeof value[key] !== 'string' || !UUID.test(value[key])) fail('INVALID_REQUEST');
      value[key] = value[key].toLowerCase();
    }
    if (typeof value.carId !== 'string' || !value.carId || value.carId.trim() !== value.carId || [...value.carId].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value.carId)) fail('INVALID_REQUEST');
    return value;
  } catch (error) { if (error instanceof SetupError) throw error; fail('INVALID_REQUEST'); }
  finally { clearTimeout(timer); }
}
async function upstream(config, path, { token, service = false, method = 'GET', payload } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const key = service ? config.service : config.publishable;
    const response = await fetch(config.origin + path, { method, redirect: 'manual', cache: 'no-store', signal: controller.signal, headers: {
      apikey: key, Authorization: 'Bearer ' + (service ? config.service : token), Accept: 'application/json',
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
    }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); fail('UPSTREAM_ERROR'); }
    const bytes = await readBytes(response.body, MAX_RESPONSE, 'UPSTREAM_ERROR');
    let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('UPSTREAM_ERROR'); }
    return { status: response.status, ok: response.ok, data };
  } catch (error) { if (error instanceof SetupError) throw error; fail('UPSTREAM_ERROR'); }
  finally { clearTimeout(timer); }
}
async function authorize(config, token, scope) {
  const result = await upstream(config, '/rest/v1/rpc/snote_business_evidence', { token, method: 'POST', payload: {
    p_company: scope.companyId, p_owner: scope.ownerId, p_car_id: scope.carId,
    p_action: 'read', p_id: scope.evidenceId, p_entry_id: scope.entryId, p_meta: null
  } });
  if (!result.ok) {
    if (result.status === 401) fail('UNAUTHORIZED');
    if (result.status === 403 || result.data?.code === '42501') fail('FORBIDDEN');
    if (['PGRST202', 'PGRST204', '42P01', '42883'].includes(result.data?.code)) fail('SETUP_REQUIRED');
    fail('UPSTREAM_ERROR');
  }
  const evidence = result.data;
  if (!object(evidence) || evidence.id !== scope.evidenceId || evidence.entryId !== scope.entryId || evidence.bucket !== BUCKET || !['pending', 'ready'].includes(evidence.state)) fail('FORBIDDEN');
}
function policy(bucket) {
  const mime = bucket?.allowed_mime_types;
  if (!object(bucket) || bucket.id !== BUCKET || bucket.name !== BUCKET || bucket.public !== false || bucket.file_size_limit !== LIMIT ||
      !Array.isArray(mime) || mime.length !== MIME.length || new Set(mime).size !== MIME.length || MIME.some(type => !mime.includes(type))) fail('BUCKET_POLICY_MISMATCH');
}
async function provision(config) {
  const endpoint = '/storage/v1/bucket/' + BUCKET;
  let current = await upstream(config, endpoint, { service: true });
  if (current.ok) { policy(current.data); return; }
  // Storage versions may carry a not-found status in either the HTTP status or JSON statusCode.
  if (!(current.status === 404 || current.status === 400 && (current.data?.statusCode === '404' || current.data?.statusCode === 404 || current.data?.code === 'NoSuchBucket'))) fail('UPSTREAM_ERROR');
  const created = await upstream(config, '/storage/v1/bucket', { service: true, method: 'POST', payload: {
    id: BUCKET, name: BUCKET, public: false, file_size_limit: LIMIT, allowed_mime_types: MIME
  } });
  if (!created.ok && created.status !== 409 && !(created.status === 400 && (created.data?.statusCode === '409' || created.data?.statusCode === 409 || created.data?.code === 'BucketAlreadyExists'))) fail('UPSTREAM_ERROR');
  // A concurrent creator must satisfy the same immutable policy before returning success.
  current = await upstream(config, endpoint, { service: true });
  if (!current.ok) fail('UPSTREAM_ERROR'); policy(current.data);
}
export async function onRequestPost({ request, env }) {
  try {
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    if (!sameOriginRequest(request)) fail('FORBIDDEN');
    const token = bearer(request), scope = await body(request), config = configuration(env);
    await authorize(config, token, scope);
    await provision(config);
    return json({ ok: true, bucket: BUCKET });
  } catch (error) { return errorResponse(error); }
}
export function onRequest(context) {
  if (context.request.method !== 'POST') return errorResponse(new SetupError('METHOD_NOT_ALLOWED'));
  return onRequestPost(context);
}
