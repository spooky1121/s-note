import { getResidentEncryptionKeys } from './customer-intake.js';
import { TEMPLATE_ID, createSource, sourceFingerprint, createDocument, normalizeDocument, calculate, documentFingerprint, serializePublic } from '../../assets/income-settlement-model.js';

const TYPE = 'snote-income-settlement';
const MAX_BODY = 64 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CIPHER = /^isi1\.[a-f0-9]{24}\.[a-f0-9]{58}$/;
const MESSAGES = {
  NETWORK: [502, '서버 저장 결과를 확인하지 못했습니다. 입력 내용을 유지하고 다시 시도해 주세요.'],
  CONFLICT: [409, '다른 화면에서 소득정산이 변경되었습니다. 현재 입력과 서버 자료를 확인해 주세요.'],
  SOURCE_CHANGED: [409, '차량 원본 정보가 변경되었습니다. 최신 차량 정보를 확인한 뒤 다시 정산해 주세요.'],
  NOT_SOLD: [409, '현재 판매완료 상태인 차량만 소득정산을 이용할 수 있습니다.'],
  FORBIDDEN: [403, '현재 소속과 차량 정산 권한을 확인해 주세요.'],
  UNAUTHORIZED: [401, '로그인이 필요합니다. 다시 로그인해 주세요.'],
  SETUP_REQUIRED: [503, '소득정산 서버 연결 또는 암호화 설정을 확인해 주세요.'],
  VALIDATION_ERROR: [400, '소득정산 입력 형식을 확인해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '요청 크기가 허용 범위를 초과했습니다.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'JSON 요청만 사용할 수 있습니다.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.']
};
class SettlementError extends Error {
  constructor(code, details = {}) { super(MESSAGES[code][1]); this.code = code; Object.assign(this, details); }
}
function fail(code, details) { throw new SettlementError(code, details); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    ...(status === 405 ? { Allow: 'GET, POST' } : {})
  } });
}
function errorResponse(error) {
  const safe = error instanceof SettlementError ? error : new SettlementError('NETWORK');
  const body = { code: safe.code, error: MESSAGES[safe.code][1], message: MESSAGES[safe.code][1] };
  if (safe.code === 'CONFLICT') { body.remoteDocument = safe.remoteDocument; body.baseVersion = safe.baseVersion; }
  if (safe.code === 'SOURCE_CHANGED') { body.source = safe.source; body.sourceVersion = safe.sourceVersion; }
  return json(body, MESSAGES[safe.code][0]);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function whitelist(value, keys) { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('VALIDATION_ERROR'); }
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
function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match || match[1].length < 30 || match[1].length > 5000) fail('UNAUTHORIZED');
  return match[1];
}
function requestScope(body) {
  if (typeof body.companyId !== 'string' || !UUID.test(body.companyId) || typeof body.ownerId !== 'string' || !UUID.test(body.ownerId) || typeof body.carId !== 'string' || !body.carId || body.carId.trim() !== body.carId || [...body.carId].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(body.carId)) fail('VALIDATION_ERROR');
  return { company: body.companyId, owner: body.ownerId, carId: body.carId };
}
async function boundedJson(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('UNSUPPORTED_MEDIA_TYPE');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail('PAYLOAD_TOO_LARGE');
  if (!request.body) fail('VALIDATION_ERROR');
  const reader = request.body.getReader(); let timer;
  try {
    const read = async () => {
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) { void reader.cancel().catch(() => {}); fail('PAYLOAD_TOO_LARGE'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('VALIDATION_ERROR'); }
    };
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new SettlementError('VALIDATION_ERROR')); }, 5000); })]);
  } finally { clearTimeout(timer); }
}
async function fetchJson(config, jwt, path, { query, body } = {}) {
  const url = new URL(config.supabase + path);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.href, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: config.publishable, Authorization: `Bearer ${jwt}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); fail('NETWORK'); }
    const reader = response.body?.getReader(); if (!reader) fail('NETWORK');
    const chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE) { void reader.cancel().catch(() => {}); fail('NETWORK'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { data = null; }
    if (!response.ok) {
      if (response.status === 401) fail('UNAUTHORIZED');
      if (response.status === 403) fail('FORBIDDEN');
      if (object(data) && ['PGRST202', 'PGRST204', '42P01', '42703', '42883'].includes(data.code)) fail('SETUP_REQUIRED');
      if (body !== undefined && (response.status === 409 || ['40001', 'CONFLICT', 'RPC_CONFLICT'].includes(data?.code) || /\bCONFLICT\b/i.test(String(data?.message || '')))) {
        const conflict = new SettlementError('NETWORK'); conflict.rpcConflict = true; throw conflict;
      }
      fail('NETWORK');
    }
    if (data === null) fail('NETWORK');
    return data;
  } catch (error) { if (error instanceof SettlementError) throw error; fail('NETWORK'); }
  finally { clearTimeout(timer); }
}
async function authenticate(config, jwt, scope) {
  const user = await fetchJson(config, jwt, '/auth/v1/user');
  if (!object(user) || !UUID.test(user.id || '')) fail('UNAUTHORIZED');
  const members = await fetchJson(config, jwt, '/rest/v1/zc_members', { query: { select: 'user_id,company_id,role,active,display_name', user_id: `eq.${user.id}`, active: 'eq.true', limit: '2' } });
  if (!Array.isArray(members) || members.length !== 1) fail('FORBIDDEN');
  const member = members[0];
  if (!object(member) || member.user_id !== user.id || member.active !== true || member.company_id !== scope.company || !['dealer', 'admin', 'accountant'].includes(member.role) || (member.role === 'dealer' && scope.owner !== user.id)) fail('FORBIDDEN');
  return { actor: user.id, role: member.role, ownName: typeof member.display_name === 'string' ? member.display_name : '' };
}
async function fresh(config, jwt, scope) {
  const actor = await authenticate(config, jwt, scope);
  const companies = await fetchJson(config, jwt, '/rest/v1/zc_companies', { query: { select: 'id,name', id: `eq.${scope.company}`, limit: '1' } });
  if (!Array.isArray(companies) || companies.length !== 1 || companies[0].id !== scope.company || typeof companies[0].name !== 'string') fail('FORBIDDEN');
  let dealerName = actor.ownName;
  if (scope.owner !== actor.actor) {
    const owners = await fetchJson(config, jwt, '/rest/v1/zc_members', { query: { select: 'user_id,company_id,display_name', user_id: `eq.${scope.owner}`, company_id: `eq.${scope.company}`, limit: '2' } });
    if (!Array.isArray(owners) || owners.length > 1) fail('FORBIDDEN');
    if (owners.some(owner => owner.user_id !== scope.owner || owner.company_id !== scope.company)) fail('FORBIDDEN');
    dealerName = typeof owners[0]?.display_name === 'string' ? owners[0].display_name : '';
  }
  const rows = await fetchJson(config, jwt, '/rest/v1/zc_datasets', { query: { select: 'payload,revision', company_id: `eq.${scope.company}`, owner_id: `eq.${scope.owner}`, dataset: 'eq.cars', limit: '2' } });
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0].payload)) fail('FORBIDDEN');
  if (typeof rows[0].revision !== 'number' && !(typeof rows[0].revision === 'string' && /^\d+$/.test(rows[0].revision))) fail('VALIDATION_ERROR');
  const revision = Number(rows[0].revision);
  if (!Number.isSafeInteger(revision) || revision < 0) fail('VALIDATION_ERROR');
  const payload = structuredClone(rows[0].payload);
  // Never return or rewrite an old malformed record containing a plaintext H50.
  if (payload.some(car => object(car?.incomeSettlement?.document?.cells) && car.incomeSettlement.document.cells.H50)) fail('SETUP_REQUIRED');
  const matching = payload.map((car, index) => ({ car, index })).filter(({ car }) => object(car) && String(car.id) === scope.carId);
  if (matching.length !== 1) fail(matching.length > 1 ? 'VALIDATION_ERROR' : 'FORBIDDEN');
  const { car, index } = matching[0];
  if (car.status !== '판매완료') fail('NOT_SOLD');
  let lenders = [];
  if (Number(car.inventoryLoan || 0) > 0) {
    const finance = await fetchJson(config, jwt, '/rest/v1/zc_datasets', { query: { select: 'payload', company_id: `eq.${scope.company}`, owner_id: 'eq.00000000-0000-0000-0000-000000000000', dataset: 'eq.finance_limits', limit: '2' } });
    if (!Array.isArray(finance) || finance.length > 1) fail('VALIDATION_ERROR');
    if (finance.length) { if (!Array.isArray(finance[0].payload)) fail('VALIDATION_ERROR'); lenders = finance[0].payload; }
  }
  let source;
  try { source = createSource(car, { ownerId: scope.owner, dealerName, companyName: companies[0].name, lenders }); } catch { fail('VALIDATION_ERROR'); }
  return { payload, revision, car, index, actor: actor.actor, source, sourceVersion: await sourceFingerprint(source) };
}
function document(value) {
  try { const normalized = normalizeDocument(value); calculate(normalized); return normalized; }
  catch { fail('VALIDATION_ERROR'); }
}
function hex(bytes) { return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''); }
function unhex(value) { return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16)); }
async function incomeKeys(env) {
  const resident = await getResidentEncryptionKeys(env); const keys = [];
  for (const raw of resident.keys) {
    try {
      const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
      keys.push(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('snote-income-settlement:identity:v1:hkdf-salt'), info: new TextEncoder().encode('snote-income-settlement:broker-identity:v1:aes-256-gcm') }, material, 256)));
    } catch { fail('SETUP_REQUIRED'); }
  }
  return { key: keys[0] || null, keys };
}
function aad(scope) { return new TextEncoder().encode('snote-income-settlement:broker-identity:v1:' + JSON.stringify([scope.company, scope.owner, scope.carId])); }
async function aes(raw, usage) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]); }
async function encrypt(value, keys, scope) {
  if (!keys.key) fail('SETUP_REQUIRED');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(scope), tagLength: 128 }, await aes(keys.key, 'encrypt'), new TextEncoder().encode(value));
  return `isi1.${hex(iv)}.${hex(new Uint8Array(encrypted))}`;
}
async function decrypt(value, keys, scope) {
  if (!keys.key) fail('SETUP_REQUIRED');
  if (typeof value !== 'string' || !CIPHER.test(value)) fail('SETUP_REQUIRED');
  const [, iv, encrypted] = value.split('.');
  for (const candidate of keys.keys) {
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: aad(scope), tagLength: 128 }, await aes(candidate, 'decrypt'), unhex(encrypted));
      const identity = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      if (/^\d{13}$/.test(identity)) return identity;
    } catch { /* Do not disclose keys, scope or partial values. */ }
  }
  fail('SETUP_REQUIRED');
}
async function storedDocument(raw, source, keys, scope) {
  if (raw === null || raw === undefined) return document(createDocument(source));
  if (!object(raw) || raw.type !== TYPE || raw.version !== 1 || raw.templateVersion !== TEMPLATE_ID || !object(raw.document) || raw.document?.cells?.H50) fail('SETUP_REQUIRED');
  const result = document(raw.document);
  if (Object.hasOwn(raw, 'privateCipher')) result.cells.H50 = await decrypt(raw.privateCipher, keys, scope);
  return document(result);
}
async function conflict(remote, keys, scope) {
  fail('CONFLICT', { remoteDocument: await storedDocument(remote.car.incomeSettlement, remote.source, keys, scope), baseVersion: await documentFingerprint(remote.car.incomeSettlement ?? null) });
}
function sourceGuard(remote, expected) {
  if (remote.sourceVersion !== expected) fail('SOURCE_CHANGED', { source: remote.source, sourceVersion: remote.sourceVersion });
}
async function sameWrite(remote, desired, keys, scope, body) {
  const record = remote.car.incomeSettlement;
  if (!record || record.writeId !== body.requestId) return false;
  const saved = await storedDocument(record, remote.source, keys, scope);
  return record.sourceVersion === body.sourceVersion && await documentFingerprint(saved) === await documentFingerprint(desired);
}
async function savedResponse(remote, keys, scope) {
  const raw = remote.car.incomeSettlement;
  return { ok: true, document: await storedDocument(raw, remote.source, keys, scope), baseVersion: await documentFingerprint(raw), source: remote.source, sourceVersion: remote.sourceVersion, revision: remote.revision, payload: remote.payload };
}
async function recover(config, jwt, scope, desired, keys, body, exhausted = false) {
  const remote = await fresh(config, jwt, scope); sourceGuard(remote, body.sourceVersion);
  const current = remote.car.incomeSettlement ?? null;
  if (current?.writeId === body.requestId) {
    if (await sameWrite(remote, desired, keys, scope, body)) return savedResponse(remote, keys, scope);
    return conflict(remote, keys, scope);
  }
  if (await documentFingerprint(current) !== body.baseVersion || exhausted) return conflict(remote, keys, scope);
  fail('NETWORK');
}
async function perform(request, config, body, env) {
  if (!object(body) || !['load', 'save'].includes(body.action)) fail('VALIDATION_ERROR');
  whitelist(body, ['action', 'companyId', 'ownerId', 'carId', ...(body.action === 'save' ? ['document', 'baseVersion', 'sourceVersion', 'requestId'] : [])]);
  const scope = requestScope(body); const jwt = bearer(request);
  if (body.action === 'save' && ((body.baseVersion !== null && (typeof body.baseVersion !== 'string' || !HASH.test(body.baseVersion))) || typeof body.sourceVersion !== 'string' || !HASH.test(body.sourceVersion) || typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(body.requestId))) fail('VALIDATION_ERROR');
  const desired = body.action === 'save' ? document(body.document) : null;
  let keys;
  if (body.action === 'load') {
    const remote = await fresh(config, jwt, scope); const raw = remote.car.incomeSettlement ?? null;
    keys = await incomeKeys(env);
    return { ok: true, source: remote.source, sourceVersion: remote.sourceVersion, document: await storedDocument(raw, remote.source, keys, scope), baseVersion: await documentFingerprint(raw), revision: remote.revision, stored: raw !== null, sourceChanged: raw !== null && raw.sourceVersion !== remote.sourceVersion };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await fresh(config, jwt, scope); sourceGuard(remote, body.sourceVersion);
    keys ||= await incomeKeys(env);
    if (desired.cells.H50 && !keys.key) fail('SETUP_REQUIRED');
    const current = remote.car.incomeSettlement ?? null;
    const baseVersion = await documentFingerprint(current);
    if (current?.writeId === body.requestId) {
      if (await sameWrite(remote, desired, keys, scope, body)) return savedResponse(remote, keys, scope);
      return conflict(remote, keys, scope);
    }
    if (baseVersion !== body.baseVersion) return conflict(remote, keys, scope);
    // Decrypt the previous value even when clearing it: a missing/wrong key must
    // never turn an unavailable identity into an unintended successful erase.
    await storedDocument(current, remote.source, keys, scope);
    const publicDocument = serializePublic(desired);
    if (publicDocument?.cells?.H50) fail('SETUP_REQUIRED');
    const record = { type: TYPE, version: 1, templateVersion: TEMPLATE_ID, document: publicDocument, sourceVersion: body.sourceVersion, writeId: body.requestId, updatedAt: new Date().toISOString(), updatedBy: remote.actor };
    if (desired.cells.H50) record.privateCipher = await encrypt(desired.cells.H50, keys, scope);
    const payload = remote.payload.map((car, index) => index === remote.index ? { ...car, incomeSettlement: record } : car);
    let revision;
    try { revision = await fetchJson(config, jwt, '/rest/v1/rpc/zc_write_dataset', { body: { p_company: scope.company, p_dataset: 'cars', p_owner: scope.owner, p_expected: remote.revision, p_payload: payload } }); }
    catch (error) {
      if (!(error instanceof SettlementError) || error.code !== 'NETWORK') throw error;
      if (error.rpcConflict && attempt < 2) continue;
      return recover(config, jwt, scope, desired, keys, body, !!error.rpcConflict);
    }
    if ((typeof revision !== 'number' && !(typeof revision === 'string' && /^\d+$/.test(revision))) || !Number.isSafeInteger(Number(revision)) || Number(revision) <= remote.revision) return recover(config, jwt, scope, desired, keys, body);
    return savedResponse({ ...remote, payload, car: payload[remote.index], revision: Number(revision) }, keys, scope);
  }
  fail('NETWORK');
}
export async function onRequestGet({ request, env }) {
  try { origin(request); return json({ service: 'snote-income-settlement', configured: !!configuration(env) }); }
  catch (error) { return errorResponse(error); }
}
export async function onRequestPost({ request, env }) {
  try { origin(request); const config = configuration(env); if (!config) fail('SETUP_REQUIRED'); return json(await perform(request, config, await boundedJson(request), env)); }
  catch (error) { return errorResponse(error); }
}
export function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return errorResponse(new SettlementError('METHOD_NOT_ALLOWED'));
}
