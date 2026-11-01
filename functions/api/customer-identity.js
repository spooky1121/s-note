import { getResidentEncryptionKeys } from './customer-intake.js';

const MAX_BODY = 32 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DIGITS = /^(?:\d{10}|\d{13})$/;
const ENVELOPE = /^smi1\.[a-f0-9]{24}\.(?:[a-f0-9]{52}|[a-f0-9]{58})$/;
const ERRORS = {
  UNAUTHORIZED: [401, '로그인이 필요합니다. 다시 로그인해 주세요.'],
  FORBIDDEN: [403, '본인 소속과 담당 고객·차량의 정보만 이용할 수 있습니다.'],
  VALIDATION_ERROR: [400, '요청 형식과 입력 내용을 확인해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '요청 크기가 허용 범위를 초과했습니다.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'JSON 요청만 사용할 수 있습니다.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  SERVER_SETUP_REQUIRED: [503, 'Supabase 연결 설정과 공개 키를 확인해 주세요.'],
  RRN_SETUP_REQUIRED: [503, '서버 암호화 설정을 확인해 주세요.'],
  UPSTREAM_ERROR: [502, '서버 정보를 확인하지 못했습니다. 입력 내용을 유지하고 다시 시도해 주세요.'],
  IDENTITY_DECRYPT_FAILED: [502, '저장된 번호를 복호화하지 못했습니다. 서버 암호화 설정을 확인해 주세요.']
};
class IdentityError extends Error { constructor(code) { super(code); this.code = code; } }
function fail(code) { throw new IdentityError(code); }
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    ...(status === 405 ? { Allow: 'GET, POST' } : {})
  } });
}
function errorReply(error) {
  const code = error instanceof IdentityError && ERRORS[error.code] ? error.code : 'UPSTREAM_ERROR';
  return reply({ error: ERRORS[code][1], code }, ERRORS[code][0]);
}
function origin(request) {
  const supplied = request.headers.get('Origin');
  if (supplied !== null && supplied !== new URL(request.url).origin) fail('FORBIDDEN');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('FORBIDDEN');
}
function configuration(env = {}) {
  try {
    const url = new URL(typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '');
    const publishable = typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' ? env.SUPABASE_PUBLISHABLE_KEY.trim() : '';
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !publishable || /[\r\n]/.test(publishable)) return null;
    return { supabase: url.origin, publishable };
  } catch { return null; }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('VALIDATION_ERROR');
}
function carId(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || [...value].length > 200 || /[\u0000-\u001f\u007f]/.test(value)) fail('VALIDATION_ERROR');
  return value;
}
function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match || match[1].length < 30 || match[1].length > 5000) fail('UNAUTHORIZED');
  return match[1];
}
async function bodyJson(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('UNSUPPORTED_MEDIA_TYPE');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) fail('PAYLOAD_TOO_LARGE');
  if (!request.body) fail('VALIDATION_ERROR');
  const reader = request.body.getReader(); let timer;
  try {
    const read = async () => {
      const chunks = []; let total = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY) { void reader.cancel().catch(() => {}); fail('PAYLOAD_TOO_LARGE'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('VALIDATION_ERROR'); }
    };
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new IdentityError('VALIDATION_ERROR')); }, 5000); })]);
  } finally { clearTimeout(timer); }
}
async function get(config, jwt, path, query, maxBytes = 2 * 1024 * 1024) {
  const url = new URL(config.supabase + path);
  for (const [name, value] of Object.entries(query || {})) url.searchParams.set(name, value);
  if (url.href.length > 16000) fail('VALIDATION_ERROR');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await fetch(url.href, { method: 'GET', headers: { apikey: config.publishable, Authorization: `Bearer ${jwt}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
    if (result.status >= 300 && result.status < 400) { void result.body?.cancel().catch(() => {}); fail('UPSTREAM_ERROR'); }
    if (result.status === 401) { void result.body?.cancel().catch(() => {}); fail('UNAUTHORIZED'); }
    if (result.status === 403) { void result.body?.cancel().catch(() => {}); fail('FORBIDDEN'); }
    if (!result.ok) { void result.body?.cancel().catch(() => {}); fail('UPSTREAM_ERROR'); }
    const reader = result.body?.getReader(); if (!reader) fail('UPSTREAM_ERROR');
    let total = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { void reader.cancel().catch(() => {}); fail('UPSTREAM_ERROR'); } chunks.push(value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('UPSTREAM_ERROR'); }
  } catch (error) { if (error instanceof IdentityError) throw error; fail('UPSTREAM_ERROR'); }
  finally { clearTimeout(timer); }
}
async function authenticate(config, jwt) {
  const user = await get(config, jwt, '/auth/v1/user', null, 64 * 1024);
  if (!object(user) || !UUID.test(user.id || '')) fail('UNAUTHORIZED');
  const members = await get(config, jwt, '/rest/v1/zc_members', { select: 'user_id,company_id,role,active', user_id: `eq.${user.id}`, active: 'eq.true', limit: '2' }, 64 * 1024);
  if (!Array.isArray(members)) fail('UPSTREAM_ERROR');
  if (members.length !== 1) fail('FORBIDDEN');
  const member = members[0];
  if (!object(member) || member.user_id !== user.id || member.active !== true || !['dealer', 'admin'].includes(member.role) || !UUID.test(member.company_id || '')) fail('FORBIDDEN');
  return { owner: user.id, company: member.company_id };
}
function own(context) { return { company_id: `eq.${context.company}`, owner_id: `eq.${context.owner}` }; }
async function confirmCar(config, jwt, context, id) {
  const existing = await get(config, jwt, '/rest/v1/zc_customers', { select: 'car_id', ...own(context), car_id: `eq.${id}`, limit: '1' }, 32 * 1024);
  if (!Array.isArray(existing)) fail('UPSTREAM_ERROR');
  if (existing.some(row => object(row) && row.car_id === id)) return;
  const datasets = await get(config, jwt, '/rest/v1/zc_datasets', { select: 'payload', ...own(context), dataset: 'eq.cars', limit: '1' });
  if (!Array.isArray(datasets)) fail('UPSTREAM_ERROR');
  if (!datasets.some(row => Array.isArray(row?.payload) && row.payload.some(car => object(car) && String(car.id) === id))) fail('FORBIDDEN');
}
function hex(bytes) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
function unhex(value) { return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16)); }
function aad(context, id) { return new TextEncoder().encode('snote-manual-identity:v1:' + JSON.stringify([context.company, context.owner, id])); }
async function cryptoKey(raw, usage) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]); }
async function encrypt(keys, context, id, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context, id), tagLength: 128 }, await cryptoKey(keys.key, 'encrypt'), new TextEncoder().encode(value));
  return `smi1.${hex(iv)}.${hex(new Uint8Array(ciphertext))}`;
}
async function decrypt(keys, context, id, envelope) {
  if (typeof envelope !== 'string' || !ENVELOPE.test(envelope)) fail('IDENTITY_DECRYPT_FAILED');
  const [, iv, ciphertext] = envelope.split('.');
  for (const key of keys.keys) {
    try {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: aad(context, id), tagLength: 128 }, await cryptoKey(key, 'decrypt'), unhex(ciphertext));
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (DIGITS.test(value)) return value;
    } catch { /* Never send ciphertext, keys, or a partial value to the caller. */ }
  }
  fail('IDENTITY_DECRYPT_FAILED');
}
function inFilter(ids) { return `in.(${ids.map(id => '"' + id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',')})`; }
async function read(config, jwt, context, ids, keys) {
  const rows = await get(config, jwt, '/rest/v1/zc_customers', { select: 'car_id,identity:payload->identityCipher', ...own(context), car_id: ids.length === 1 ? `eq.${ids[0]}` : inFilter(ids), limit: String(ids.length) });
  if (!Array.isArray(rows)) fail('UPSTREAM_ERROR');
  const requested = new Set(ids); const byId = new Map();
  for (const row of rows) {
    if (!object(row) || typeof row.car_id !== 'string' || !requested.has(row.car_id)) continue;
    if (byId.has(row.car_id)) fail('UPSTREAM_ERROR');
    byId.set(row.car_id, row.identity === null || row.identity === undefined ? '' : await decrypt(keys, context, row.car_id, row.identity));
  }
  return ids.map(id => ({ carId: id, value: byId.get(id) || '' }));
}
async function perform(request, config, body, env) {
  if (!object(body) || !['encrypt', 'read', 'read-many'].includes(body.action)) fail('VALIDATION_ERROR');
  fields(body, body.action === 'encrypt' ? ['action', 'carId', 'value'] : body.action === 'read' ? ['action', 'carId'] : ['action', 'carIds']);
  const jwt = bearer(request);
  let ids;
  if (body.action === 'read-many') {
    if (!Array.isArray(body.carIds) || body.carIds.length < 1 || body.carIds.length > 100) fail('VALIDATION_ERROR');
    ids = [...new Set(body.carIds.map(carId))];
  } else ids = [carId(body.carId)];
  if (body.action === 'encrypt' && (typeof body.value !== 'string' || !DIGITS.test(body.value))) fail('VALIDATION_ERROR');
  const context = await authenticate(config, jwt);
  const keys = await getResidentEncryptionKeys(env); if (!keys.key) fail('RRN_SETUP_REQUIRED');
  if (body.action === 'encrypt') {
    await confirmCar(config, jwt, context, ids[0]);
    return { ok: true, identityCipher: await encrypt(keys, context, ids[0], body.value) };
  }
  const identities = await read(config, jwt, context, ids, keys);
  return body.action === 'read' ? { ok: true, value: identities[0].value } : { ok: true, identities };
}
export async function onRequestGet({ request, env }) {
  try { origin(request); return reply({ service: 'snote-customer-identity', configured: !!configuration(env) && !!(await getResidentEncryptionKeys(env)).key }); }
  catch (error) { return errorReply(error); }
}
export async function onRequestPost({ request, env }) {
  try {
    origin(request); const config = configuration(env); if (!config) fail('SERVER_SETUP_REQUIRED');
    return reply(await perform(request, config, await bodyJson(request), env));
  } catch (error) { return errorReply(error); }
}
export function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return errorReply(new IdentityError('METHOD_NOT_ALLOWED'));
}
