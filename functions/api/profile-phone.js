import { solapi } from '../_shared/document-mms.js';

// Confirms possession of the new personal number; it never changes the dealer's SMS sender.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PHONE = /^(010\d{8}|01[16789]\d{7,8})$/;
const EXPECTED = ['user_id', 'company_id', 'display_name', 'company_name', 'revision', 'phone'];
const ERRORS = {
  UNAUTHORIZED: [401, '온라인 계정으로 다시 로그인해 주세요.'],
  FORBIDDEN: [403, '현재 계정의 프로필 수정 권한을 확인해 주세요.'],
  INVALID_REQUEST: [400, '휴대전화 번호와 인증번호를 확인해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  SETUP_REQUIRED: [503, '휴대전화 인증 서비스 설정을 확인해 주세요.'],
  NETWORK: [502, '처리 상태를 확인하지 못했습니다. 프로필을 다시 불러온 후 확인해 주세요.'],
  RATE_LIMITED: [429, '요청 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.'],
  INVALID_CODE: [400, '인증번호가 일치하지 않습니다.'],
  LOCKED: [423, '인증 시도 횟수를 초과했습니다. 새 인증번호를 요청해 주세요.'],
  EXPIRED: [410, '인증번호 사용 기한이 지났습니다. 새 인증번호를 요청해 주세요.'],
  CONSUMED: [409, '이미 사용한 인증 요청입니다. 프로필을 다시 불러와 주세요.'],
  PROFILE_CONFLICT: [409, '프로필이 변경되었습니다. 다시 불러온 후 인증해 주세요.'],
  REQUEST_REUSED: [409, '이미 사용했던 인증 요청입니다. 새 인증번호를 요청해 주세요.'],
  SMS_SEND_FAILED: [502, '문자가 접수되지 않았습니다. 잠시 후 새 인증번호를 요청해 주세요.'],
  SMS_SEND_UNKNOWN: [503, '문자 접수 여부를 확인하지 못했습니다. 자동 재전송하지 않습니다. 잠시 후 다시 확인해 주세요.']
};
const LOGICAL = new Set(['FORBIDDEN', 'RATE_LIMITED', 'INVALID_CODE', 'LOCKED', 'EXPIRED', 'CONSUMED', 'PROFILE_CONFLICT', 'REQUEST_REUSED', 'VALIDATION_ERROR', 'CONFLICT', 'ALREADY_VERIFIED', 'ALREADY_USED']);
class ProfilePhoneError extends Error {
  constructor(code, retryAfter) { super(code); this.code = code; this.retryAfter = retryAfter; }
}
function fail(code, retryAfter) { throw new ProfilePhoneError(code, retryAfter); }
function json(body, status = 200, retryAfter) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    ...(status === 405 ? { Allow: 'POST' } : {}),
    ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) })
  } });
}
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fields(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST'); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_REQUEST'); return value.toLowerCase(); }
function phone(value) {
  if (typeof value !== 'string' || value.length > 25) fail('INVALID_REQUEST');
  let normalized = value.trim().replace(/[ ()-]/g, '');
  if (normalized.startsWith('+82')) normalized = '0' + normalized.slice(3);
  if (!PHONE.test(normalized)) fail('INVALID_REQUEST'); return normalized;
}
function expected(value, company) {
  fields(value, EXPECTED);
  if (Object.keys(value).length !== EXPECTED.length || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('INVALID_REQUEST');
  const result = { ...value, user_id: uuid(value.user_id), company_id: uuid(value.company_id) };
  if (result.company_id !== company) fail('INVALID_REQUEST');
  for (const [key, maximum] of [['display_name', 40], ['company_name', 100], ['phone', 11]]) {
    if (typeof result[key] !== 'string' || result[key].length > maximum || /[\x00-\x1f\x7f]/.test(result[key])) fail('INVALID_REQUEST');
  }
  if (result.phone !== '' && !PHONE.test(result.phone)) fail('INVALID_REQUEST'); return result;
}
function config(env = {}) {
  const names = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'CUSTOMER_INTAKE_OTP_SECRET', 'SOLAPI_SENDER'];
  const values = Object.fromEntries(names.map(name => [name, typeof env[name] === 'string' ? env[name].trim() : '']));
  let url; try { url = new URL(env.SUPABASE_URL); } catch { fail('SETUP_REQUIRED'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || names.some(name => !values[name] || /[\r\n]/.test(values[name]))) fail('SETUP_REQUIRED');
  const sender = values.SOLAPI_SENDER.replace(/[ -]/g, '');
  if (!/^\d{8,11}$/.test(sender) || values.CUSTOMER_INTAKE_OTP_SECRET.length < 32) fail('SETUP_REQUIRED');
  return { url: url.origin, pub: values.SUPABASE_PUBLISHABLE_KEY, service: values.SUPABASE_SERVICE_ROLE_KEY,
    key: values.SOLAPI_API_KEY, secret: values.SOLAPI_API_SECRET, otpSecret: values.CUSTOMER_INTAKE_OTP_SECRET, sender };
}
async function readBody(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_REQUEST');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096)) fail('INVALID_REQUEST');
  const reader = request.body?.getReader(); if (!reader) fail('INVALID_REQUEST'); let timer;
  try {
    const read = async () => {
      const chunks = []; let length = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 4096) { void reader.cancel().catch(() => {}); fail('INVALID_REQUEST'); } chunks.push(value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INVALID_REQUEST'); }
    };
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new ProfilePhoneError('INVALID_REQUEST')); }, 5000); })]);
  } finally { clearTimeout(timer); }
}
async function upstream(c, jwt, path, body, service = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const token = service ? c.service : jwt;
    const response = await fetch(c.url + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', cache: 'no-store',
      headers: { apikey: service ? c.service : c.pub, Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); fail('NETWORK'); }
    const reader = response.body?.getReader(); if (!reader) fail('NETWORK'); const chunks = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 65536) { void reader.cancel().catch(() => {}); fail('NETWORK'); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('NETWORK'); }
    if (!response.ok) {
      if (['PGRST202', 'PGRST204', '42P01', '42703', '42883'].includes(data?.code) || service && [401, 403].includes(response.status)) fail('SETUP_REQUIRED');
      if (response.status === 401) fail('UNAUTHORIZED'); if (response.status === 403) fail('FORBIDDEN'); fail('NETWORK');
    }
    return data;
  } catch (error) { if (error instanceof ProfilePhoneError) throw error; fail('NETWORK'); }
  finally { clearTimeout(timer); }
}
async function rpc(c, name, body) {
  const data = await upstream(c, null, '/rest/v1/rpc/' + name, body, true);
  if (!object(data)) fail('NETWORK');
  if (data.ok === false) {
    let code = LOGICAL.has(data.code) ? data.code : 'NETWORK';
    if (code === 'VALIDATION_ERROR') code = 'INVALID_REQUEST';
    if (code === 'CONFLICT') code = 'PROFILE_CONFLICT';
    if (code === 'ALREADY_USED' || code === 'ALREADY_VERIFIED') code = 'CONSUMED';
    fail(code, Number.isInteger(data.retryAfter) && data.retryAfter >= 0 && data.retryAfter <= 86400 ? data.retryAfter : undefined);
  }
  if (data.ok !== true) fail('NETWORK'); return data;
}
async function authorize(c, jwt, company, previous) {
  const user = await upstream(c, jwt, '/auth/v1/user');
  if (!object(user) || !UUID.test(user.id || '') || user.is_anonymous === true) fail('UNAUTHORIZED'); const actor = user.id.toLowerCase();
  if (previous && previous.user_id !== actor) fail('PROFILE_CONFLICT');
  const query = new URLSearchParams({ select: 'user_id,company_id,role,active', user_id: 'eq.' + actor, active: 'eq.true', limit: '2' });
  const members = await upstream(c, jwt, '/rest/v1/zc_members?' + query);
  if (!Array.isArray(members) || members.length !== 1) fail('FORBIDDEN'); const member = members[0];
  if (member.user_id !== actor || member.company_id !== company || member.active !== true || !['admin', 'dealer', 'accountant'].includes(member.role)) fail('FORBIDDEN');
  return { actor, company };
}
async function otpHash(c, scope, challenge, destination, code) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.otpSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const value = `snote-profile-phone:v1:${scope.actor}:${scope.company}:${challenge}:${destination}:${code}`;
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function randomCode() { let code = ''; while (code.length < 6) { const value = crypto.getRandomValues(new Uint8Array(1))[0]; if (value < 250) code += String(value % 10); } return code; }
async function delivery(c, scope, challengeId, status) {
  await rpc(c, 'snote_profile_phone_delivery', { p_actor: scope.actor, p_company: scope.company, p_challenge_id: challengeId, p_status: status });
}
function challengeResult(data) { return { ok: true, challengeId: data.challengeId, expiresAt: data.expiresAt, retryAfter: 60 }; }
async function send(c, scope, b, previous, destination) {
  const challengeId = b.requestId === undefined ? crypto.randomUUID() : uuid(b.requestId), code = randomCode();
  const data = await rpc(c, 'snote_profile_phone_challenge', { p_actor: scope.actor, p_company: scope.company, p_phone: destination, p_expected: previous, p_challenge_id: challengeId, p_otp_hash: await otpHash(c, scope, challengeId, destination, code) });
  if (data.challengeId !== challengeId || data.phone !== destination || typeof data.claimed !== 'boolean' || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) fail('NETWORK');
  // A reused request keeps its original hash/code. Never send a freshly generated code for it.
  if (!data.claimed) {
    if (data.status === 'sent') return challengeResult(data);
    if (data.status === 'verified') fail('CONSUMED');
    fail(data.status === 'failed' ? 'SMS_SEND_FAILED' : 'SMS_SEND_UNKNOWN', 60);
  }
  if (data.status !== 'pending') fail('NETWORK');
  let status = 'unknown';
  try {
    const result = await solapi(c, 'messages/v4/send', { message: { to: destination, from: c.sender, type: 'SMS', text: `[S-NOTE] 휴대전화 인증번호: ${code} (5분 내 입력)` } });
    if (result.ok && String(result.data?.statusCode) === '2000' && /^[A-Za-z0-9_-]{8,100}$/.test(result.data?.messageId || '')) status = 'sent';
    else if (result.status >= 400 && result.status < 500 || result.ok && /^\d{4}$/.test(String(result.data?.statusCode)) && String(result.data.statusCode) !== '2000') status = 'failed';
  } catch { /* A chargeable request is never retried automatically. */ }
  try { await delivery(c, scope, challengeId, status); }
  catch {
    status = 'unknown';
    try { await delivery(c, scope, challengeId, 'unknown'); } catch { /* No usable challenge is returned without its durable delivery ACK. */ }
  }
  if (status !== 'sent') fail(status === 'failed' ? 'SMS_SEND_FAILED' : 'SMS_SEND_UNKNOWN', 60);
  return challengeResult(data);
}
async function verify(c, scope, b, destination) {
  const challengeId = uuid(b.challengeId);
  if (typeof b.code !== 'string' || !/^\d{6}$/.test(b.code)) fail('INVALID_REQUEST');
  const data = await rpc(c, 'snote_profile_phone_verify', { p_actor: scope.actor, p_company: scope.company, p_challenge_id: challengeId, p_otp_hash: await otpHash(c, scope, challengeId, destination, b.code) });
  const profile = data.profile;
  if (!object(profile) || profile.user_id !== scope.actor || profile.company_id !== scope.company || profile.phone !== destination || !Number.isSafeInteger(profile.revision) || profile.revision < 1) fail('NETWORK');
  return { ok: true, profile };
}
export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('FORBIDDEN');
    const auth = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
    if (!auth || auth[1].length < 30 || auth[1].length > 5000) fail('UNAUTHORIZED');
    const b = await readBody(request);
    if (!object(b) || !['send-code', 'verify'].includes(b.action)) fail('INVALID_REQUEST');
    fields(b, b.action === 'send-code' ? ['action', 'companyId', 'phone', 'expected', 'requestId'] : ['action', 'companyId', 'phone', 'challengeId', 'code']);
    const company = uuid(b.companyId), destination = phone(b.phone), previous = b.action === 'send-code' ? expected(b.expected, company) : null;
    if (b.requestId !== undefined) uuid(b.requestId);
    if (b.action === 'verify' && (typeof b.code !== 'string' || !/^\d{6}$/.test(b.code) || !UUID.test(b.challengeId || ''))) fail('INVALID_REQUEST');
    const c = config(env), scope = await authorize(c, auth[1], company, previous);
    return json(b.action === 'send-code' ? await send(c, scope, b, previous, destination) : await verify(c, scope, b, destination));
  } catch (error) {
    const code = error instanceof ProfilePhoneError && ERRORS[error.code] ? error.code : 'NETWORK', [status, message] = ERRORS[code];
    const retryAfter = Number.isInteger(error?.retryAfter) && error.retryAfter >= 0 && error.retryAfter <= 86400 ? error.retryAfter : undefined;
    return json({ ok: false, code, error: message, ...(retryAfter === undefined ? {} : { retryAfter }) }, status, retryAfter);
  }
}
