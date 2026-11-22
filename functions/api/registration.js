import { hardenAPIResponse, readBoundedBytes, sameOriginRequest } from '../_shared/api-security.js';

// Evidence is reserved and uploaded before Auth sends an email. Only the private
// application and a subsequently verified user can complete registration.
const BUCKET = 'snote-registration-documents';
const MAX_BODY = 12 * 1024 * 1024, MAX_FILE = 5 * 1024 * 1024, MAX_PIXELS = 40000000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PROFILE_KEYS = ['kind', 'companyName', 'businessNumber', 'representativeName', 'businessAddress', 'displayName', 'phone', 'email'];
const FILES = [['businessCertificate', 'business'], ['dealerLicense', 'dealer']];
const RPC_CODES = new Set(['COMPANY_EXISTS', 'CONTACT_EXISTS', 'RATE_LIMITED', 'VALIDATION_ERROR', 'INVALID_REQUEST', 'REQUEST_EXPIRED', 'REGISTRATION_CONFLICT']);
const DB_CODES = new Set(['PGRST202', 'PGRST204', '42P01', '42703', '42883']);
const ERRORS = {
  COMPANY_EXISTS: [409, '등록되어 있는 상사입니다. 채팅으로 문의 부탁드립니다'],
  CONTACT_EXISTS: [409, '가입된 이메일 또는 휴대번 입니다.'],
  RATE_LIMITED: [429, '가입 요청이 많습니다. 잠시 후 다시 시도해 주세요.'],
  INVALID_REQUEST: [400, '가입 정보와 필수 첨부서류를 확인해 주세요.'],
  VALIDATION_ERROR: [400, '가입 정보와 필수 첨부서류를 확인해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '첨부서류는 각각 5MB 이하로 선택해 주세요.'],
  UNSUPPORTED_MEDIA_TYPE: [415, '첨부서류는 JPEG, PNG, WebP 이미지로 선택해 주세요.'],
  FORBIDDEN: [403, '현재 S-NOTE 화면에서 다시 시도해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  REQUEST_TIMEOUT: [408, '요청 전송 시간이 초과되었습니다. 다시 시도해 주세요.'],
  SETUP_REQUIRED: [503, '회원가입 서비스 설정을 확인해 주세요.'],
  AUTH_REJECTED: [400, '이메일과 비밀번호를 확인한 뒤 다시 시도해 주세요.'],
  AUTH_STATUS_UNKNOWN: [503, '가입 처리 결과를 확인하지 못했습니다. 다시 가입하기 전에 인증 메일을 확인하거나 로그인해 주세요.'],
  REQUEST_EXPIRED: [409, '가입 요청의 확인 시간이 지났습니다. 다시 시도해 주세요.'],
  REGISTRATION_CONFLICT: [409, '가입 요청 상태가 변경되었습니다. 인증 메일과 로그인 상태를 확인해 주세요.'],
  UPSTREAM_ERROR: [502, '가입 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.']
};
class RegistrationError extends Error {
  constructor(code, { retryAfter, knownAuthFailure = false } = {}) { super(code); this.code = code; this.retryAfter = retryAfter; this.knownAuthFailure = knownAuthFailure; }
}
function fail(code, options) { throw new RegistrationError(code, options); }
function json(value, status = 200, headers = {}) {
  return hardenAPIResponse(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } }));
}
function errorResponse(error) {
  const code = error instanceof RegistrationError && ERRORS[error.code] ? error.code : error?.code === 'PAYLOAD_TOO_LARGE' || error?.code === 'REQUEST_TIMEOUT' ? error.code : 'UPSTREAM_ERROR';
  const [status, message] = ERRORS[code], retry = Number.isInteger(error?.retryAfter) && error.retryAfter >= 0 && error.retryAfter <= 3600 ? error.retryAfter : undefined;
  return json({ ok: false, code, error: message }, status, { ...(status === 405 ? { Allow: 'GET, POST' } : {}), ...(retry === undefined ? {} : { 'Retry-After': String(retry) }) });
}
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST'); }
function text(value, maximum) {
  if (typeof value !== 'string') fail('INVALID_REQUEST');
  const result = value.normalize('NFC').trim();
  if (!result || [...result].length > maximum || /[\u0000-\u001f\u007f]/.test(result)) fail('INVALID_REQUEST');
  return result;
}
function configuration(env = {}) {
  const pub = typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' ? env.SUPABASE_PUBLISHABLE_KEY.trim() : '', service = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  let url; try { url = new URL(env.SUPABASE_URL); } catch { return null; }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !pub || !service || pub === service || [pub, service].some(value => value.length > 8192 || /[\r\n]/.test(value))) return null;
  const secret = typeof env.CUSTOMER_INTAKE_OTP_SECRET === 'string' ? env.CUSTOMER_INTAKE_OTP_SECRET.trim() : '';
  return { url: url.origin, pub, service, budgetSecret: secret.length >= 32 && !/[\r\n]/.test(secret) ? secret : service };
}
function profile(value) {
  keys(value, PROFILE_KEYS); if (Object.keys(value).length !== PROFILE_KEYS.length || !['representative', 'dealer'].includes(value.kind)) fail('INVALID_REQUEST');
  const normalized = {
    kind: value.kind, companyName: text(value.companyName, 100), businessNumber: text(value.businessNumber, 30).replace(/[ ()-]/g, ''),
    representativeName: text(value.representativeName, 100), businessAddress: text(value.businessAddress, 300),
    displayName: text(value.displayName, 40), phone: text(value.phone, 30).replace(/[ ()-]/g, ''), email: text(value.email, 254).toLowerCase()
  };
  if (normalized.phone.startsWith('+82')) normalized.phone = '0' + normalized.phone.slice(3);
  if (!/^\d{10}$/.test(normalized.businessNumber) || !/^(?:010\d{8}|01[16789]\d{7,8})$/.test(normalized.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized.email)) fail('INVALID_REQUEST');
  return normalized;
}
function password(value) { if (typeof value !== 'string' || value.length < 10 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_REQUEST'); return value; }
function dimensions(width, height) { if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > MAX_PIXELS) fail('UNSUPPORTED_MEDIA_TYPE'); return { width, height }; }
const u16be = (b, i) => b[i] * 256 + b[i + 1], u16le = (b, i) => b[i] + b[i + 1] * 256;
const u24le = (b, i) => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
const u32be = (b, i) => (b[i] * 16777216 + b[i + 1] * 65536 + b[i + 2] * 256 + b[i + 3]) >>> 0;
const u32le = (b, i) => (b[i] + b[i + 1] * 256 + b[i + 2] * 65536 + b[i + 3] * 16777216) >>> 0;
const ascii = (b, i, value) => [...value].every((character, n) => b[i + n] === character.charCodeAt(0));
const CRC = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc(bytes, start, end) { let value = 0xffffffff; for (let index = start; index < end; index++) value = CRC[(value ^ bytes[index]) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
function png(bytes) {
  if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) fail('UNSUPPORTED_MEDIA_TYPE');
  let at = 8, count = 0, hasData = false, dataClosed = false, palette = false, color, dataSize = 0;
  const prefix = [];
  while (at + 12 <= bytes.length && ++count <= 4096) {
    const length = u32be(bytes, at), end = at + 12 + length;
    if (end > bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) fail('UNSUPPORTED_MEDIA_TYPE');
    if (count === 1) {
      if (type !== 'IHDR' || length !== 13 || crc(bytes, at + 4, at + 8 + length) !== u32be(bytes, at + 8 + length)) fail('UNSUPPORTED_MEDIA_TYPE');
      dimensions(u32be(bytes, at + 8), u32be(bytes, at + 12)); color = bytes[at + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(bytes[at + 16]) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || ![0, 1].includes(bytes[at + 20])) fail('UNSUPPORTED_MEDIA_TYPE');
    } else if (type === 'IHDR') fail('UNSUPPORTED_MEDIA_TYPE');
    if (type === 'PLTE') { if (hasData || !length || length > 768 || length % 3) fail('UNSUPPORTED_MEDIA_TYPE'); palette = true; }
    if (type === 'IDAT') {
      if (dataClosed || color === 3 && !palette) fail('UNSUPPORTED_MEDIA_TYPE');
      for (let i = 0; i < length && prefix.length < 2; i++) prefix.push(bytes[at + 8 + i]);
      dataSize += length;
      hasData = true;
    } else if (hasData) dataClosed = true;
    if (type === 'IEND') { if (length || end !== bytes.length || !hasData || dataSize < 6 || (prefix[0] & 15) !== 8 || ((prefix[0] << 8) + prefix[1]) % 31 || prefix[1] & 32 || u32be(bytes, at + 8) !== 0xae426082) fail('UNSUPPORTED_MEDIA_TYPE'); return 'image/png'; }
    if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IDAT'].includes(type)) fail('UNSUPPORTED_MEDIA_TYPE');
    at = end;
  }
  fail('UNSUPPORTED_MEDIA_TYPE');
}
function jpeg(bytes) {
  if (bytes.length < 24 || bytes[0] !== 255 || bytes[1] !== 216) fail('UNSUPPORTED_MEDIA_TYPE');
  let at = 2, frame = false, scan = false, entropy = false, components = 0;
  while (at < bytes.length) {
    if (entropy) {
      let data = false;
      while (at < bytes.length - 1) {
        if (bytes[at] !== 255) { at++; data = true; continue; }
        let next = at + 1; while (next < bytes.length && bytes[next] === 255) next++;
        if (next >= bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
        if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) { at = next + 1; data = true; continue; }
        break;
      }
      if (!data) fail('UNSUPPORTED_MEDIA_TYPE'); entropy = false;
    }
    if (bytes[at++] !== 255) fail('UNSUPPORTED_MEDIA_TYPE'); while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217) { if (!frame || !scan || at !== bytes.length) fail('UNSUPPORTED_MEDIA_TYPE'); return 'image/jpeg'; }
    if ([0, 216, 1].includes(marker) || marker >= 208 && marker <= 215 || at + 2 > bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
    const length = u16be(bytes, at); if (length < 2 || at + length > bytes.length) fail('UNSUPPORTED_MEDIA_TYPE');
    if ([192, 193, 194].includes(marker)) {
      if (frame || length < 8 || bytes[at + 2] !== 8) fail('UNSUPPORTED_MEDIA_TYPE'); components = bytes[at + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3) fail('UNSUPPORTED_MEDIA_TYPE');
      dimensions(u16be(bytes, at + 5), u16be(bytes, at + 3)); frame = true;
    } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) fail('UNSUPPORTED_MEDIA_TYPE');
    if (marker === 218) { if (!frame || length < 6 || bytes[at + 2] < 1 || bytes[at + 2] > components || length !== 6 + 2 * bytes[at + 2]) fail('UNSUPPORTED_MEDIA_TYPE'); scan = true; entropy = true; }
    at += length;
  }
  fail('UNSUPPORTED_MEDIA_TYPE');
}
function webp(bytes) {
  if (bytes.length < 26 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP') || u32le(bytes, 4) !== bytes.length - 8) fail('UNSUPPORTED_MEDIA_TYPE');
  let at = 12, count = 0, canvas = null, image = null;
  while (at + 8 <= bytes.length && ++count <= 1024) {
    const size = u32le(bytes, at + 4), start = at + 8, end = start + size, next = end + (size & 1), type = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (end > bytes.length || next > bytes.length || size & 1 && bytes[end] !== 0) fail('UNSUPPORTED_MEDIA_TYPE');
    if (type === 'VP8X') {
      if (count !== 1 || size !== 10 || bytes[start] & 0xc3 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) fail('UNSUPPORTED_MEDIA_TYPE');
      canvas = dimensions(u24le(bytes, start + 4) + 1, u24le(bytes, start + 7) + 1);
    } else if (type === 'VP8 ') {
      if (image || !canvas && count !== 1 || size < 10 || bytes[start] & 1 || ![157, 1, 42].every((value, i) => bytes[start + 3 + i] === value)) fail('UNSUPPORTED_MEDIA_TYPE');
      image = dimensions(u16le(bytes, start + 6) & 16383, u16le(bytes, start + 8) & 16383);
    } else if (type === 'VP8L') {
      if (image || !canvas && count !== 1 || size < 5 || bytes[start] !== 47 || u32le(bytes, start + 1) >>> 29) fail('UNSUPPORTED_MEDIA_TYPE');
      const value = u32le(bytes, start + 1); image = dimensions((value & 16383) + 1, (value >>> 14 & 16383) + 1);
    } else if (type === 'ANIM' || type === 'ANMF' || !canvas && !image) fail('UNSUPPORTED_MEDIA_TYPE');
    at = next;
  }
  if (at !== bytes.length || !image || canvas && (canvas.width !== image.width || canvas.height !== image.height)) fail('UNSUPPORTED_MEDIA_TYPE');
  return 'image/webp';
}
function imageType(bytes, declared) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(declared)) fail('UNSUPPORTED_MEDIA_TYPE');
  const detected = bytes[0] === 137 ? png(bytes) : bytes[0] === 255 ? jpeg(bytes) : ascii(bytes, 0, 'RIFF') ? webp(bytes) : null;
  if (detected !== declared) fail('UNSUPPORTED_MEDIA_TYPE'); return detected;
}
async function documents(form, id) {
  const result = [];
  for (const [field, slot] of FILES) {
    const file = form.get(field);
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || !file.size) fail('INVALID_REQUEST');
    if (file.size > MAX_FILE) fail('PAYLOAD_TOO_LARGE');
    const bytes = new Uint8Array(await file.arrayBuffer()), mimeType = imageType(bytes, file.type.toLowerCase());
    const originalName = text(file.name, 180); if (/[\\/]/.test(originalName)) fail('INVALID_REQUEST');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType];
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    result.push({ bytes, document: { slot, path: `${id}/${slot}/${crypto.randomUUID()}.${extension}`, mimeType, size: bytes.byteLength, sha256, originalName } });
  }
  return result;
}
async function requestJSON(c, path, { body, method = 'POST', publicKey = false, type = 'application/json', extraHeaders = {}, jsonBody = true } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000), key = publicKey ? c.pub : c.service;
  try {
    const response = await fetch(c.url + path, { method, redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json', 'Content-Type': type, ...extraHeaders }, body: jsonBody ? JSON.stringify(body) : body });
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); fail('UPSTREAM_ERROR'); }
    const raw = await readBoundedBytes(response, 65536, { timeoutMs: 10000 });
    let data = null; if (raw.length) { try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('UPSTREAM_ERROR'); } }
    return { response, data };
  } catch (error) { if (error instanceof RegistrationError) throw error; fail('UPSTREAM_ERROR'); }
  finally { clearTimeout(timer); }
}
function logicalCode(value) {
  if (!object(value)) return null;
  if (RPC_CODES.has(value.code)) return value.code;
  // SQL uniqueness exceptions may be wrapped by PostgREST. Match only known
  // fixed identifiers, never return the original database text to a browser.
  if (['P0001', '23505'].includes(value.code) && typeof value.message === 'string') {
    for (const code of ['COMPANY_EXISTS', 'CONTACT_EXISTS']) if (new RegExp('(?:^|\\W)' + code + '(?:$|\\W)').test(value.message)) return code;
  }
  return null;
}
async function rpc(c, name, body) {
  const { response, data } = await requestJSON(c, '/rest/v1/rpc/' + name, { body }), code = logicalCode(data);
  if (code && (!response.ok || data.ok === false)) fail(code, { retryAfter: data.retryAfter });
  if (!response.ok) { if (DB_CODES.has(data?.code) || [401, 403].includes(response.status)) fail('SETUP_REQUIRED'); fail('UPSTREAM_ERROR'); }
  if (!object(data) || data.ok !== true) fail('UPSTREAM_ERROR'); return data;
}
function clientIP(request) {
  const value = (request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(part => Number(part) <= 255)) return value.split('.').map(Number).join('.');
  if (value.length <= 64 && /^[0-9a-f:.]+$/.test(value) && value.includes(':')) { try { return new URL('http://[' + value + ']/').hostname.slice(1, -1); } catch {} }
  return 'unidentified';
}
async function budget(c, request, action) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.budgetSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('snote-registration-rate:v1:' + clientIP(request)));
  const digest = [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, '0')).join('');
  await rpc(c, 'snote_registration_rate_limit', { p_key: digest, p_action: action });
}
const DUPLICATE_AUTH = new Set(['email_exists', 'user_already_exists']);
function authDuplicate(data) { return object(data) && ([data.code, data.error_code, data.error].some(code => DUPLICATE_AUTH.has(code)) || ['User already registered', 'A user with this email address has already been registered'].includes(data.msg || data.message)); }
async function signup(c, origin, id, value, pass) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000); let status;
  try {
    const response = await fetch(c.url + '/auth/v1/signup?redirect_to=' + encodeURIComponent(origin + '/'), { method: 'POST', redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { apikey: c.pub, Authorization: 'Bearer ' + c.pub, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: value.email, password: pass, data: { snote_registration: { version: 2, request_id: id } } }) });
    status = response.status;
    if (status >= 500 || status >= 300 && status < 400) { void response.body?.cancel().catch(() => {}); fail('AUTH_STATUS_UNKNOWN'); }
    let data = null;
    try { const raw = await readBoundedBytes(response, 65536, { timeoutMs: 10000 }); data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { if (status >= 400 && status < 500) fail('AUTH_REJECTED', { knownAuthFailure: true }); fail('AUTH_STATUS_UNKNOWN'); }
    if (!response.ok) {
      if (authDuplicate(data)) fail('CONTACT_EXISTS', { knownAuthFailure: true });
      if (status === 429) fail('RATE_LIMITED', { knownAuthFailure: true });
      if ([401, 403].includes(status)) fail('SETUP_REQUIRED', { knownAuthFailure: true });
      fail('AUTH_REJECTED', { knownAuthFailure: true });
    }
    const user = object(data?.user) ? data.user : object(data?.session?.user) ? data.session.user : object(data) && UUID.test(data.id || '') ? data : null;
    if (authDuplicate(data) || user && Array.isArray(user.identities) && user.identities.length === 0) fail('CONTACT_EXISTS', { knownAuthFailure: true });
    if (!user || !UUID.test(user.id || '') || typeof user.email !== 'string' || user.email.trim().toLowerCase() !== value.email) fail('AUTH_STATUS_UNKNOWN');
    const source = object(data.session) ? data.session : data;
    const hasAccess = Object.hasOwn(source, 'access_token'), hasRefresh = Object.hasOwn(source, 'refresh_token');
    if (!hasAccess && !hasRefresh) return { ok: true, email: value.email, confirmationRequired: true, session: null };
    if (typeof source.access_token !== 'string' || source.access_token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(source.access_token) || typeof source.refresh_token !== 'string' || !/^[A-Za-z0-9._~-]{10,4096}$/.test(source.refresh_token)) fail('AUTH_STATUS_UNKNOWN');
    if ([c.service, c.budgetSecret].some(secret => source.access_token.includes(secret) || source.refresh_token.includes(secret)) || source.access_token === c.pub || source.refresh_token === c.pub) fail('AUTH_STATUS_UNKNOWN');
    const session = { access_token: source.access_token, refresh_token: source.refresh_token };
    if (Number.isSafeInteger(source.expires_in) && source.expires_in > 0 && source.expires_in <= 86400) session.expires_in = source.expires_in;
    if (source.token_type === 'bearer') session.token_type = 'bearer';
    return { ok: true, email: value.email, confirmationRequired: false, session };
  } catch (error) {
    if (error instanceof RegistrationError && error.knownAuthFailure) throw error;
    if (status >= 400 && status < 500) fail('AUTH_REJECTED', { knownAuthFailure: true });
    fail('AUTH_STATUS_UNKNOWN');
  } finally { clearTimeout(timer); }
}
async function cancel(c, id, paths) {
  try {
    const cancelled = await rpc(c, 'snote_registration_cancel', { p_id: id });
    if (cancelled.cancelled !== true || !paths.length) return;
    await requestJSON(c, '/storage/v1/object/' + BUCKET, { method: 'DELETE', body: { prefixes: [...new Set(paths)] } });
  } catch { /* Unconfirmed cancellation must never delete completed evidence. */ }
}
async function register(c, request) {
  const id = crypto.randomUUID(), uploaded = []; let attemptedPrepare = false, prepared = false, authSent = false;
  try {
    const raw = await readBoundedBytes(request, MAX_BODY, { timeoutMs: 30000 }); let form;
    try { form = await new Response(raw, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); } catch { fail('INVALID_REQUEST'); }
    const allowed = ['profile', 'password', ...FILES.map(([field]) => field)];
    if ([...form.keys()].some(key => !allowed.includes(key)) || allowed.some(key => form.getAll(key).length !== 1)) fail('INVALID_REQUEST');
    const source = form.get('profile'); if (typeof source !== 'string' || source.length > 8192) fail('INVALID_REQUEST');
    let value; try { value = JSON.parse(source); } catch { fail('INVALID_REQUEST'); } value = profile(value);
    const pass = password(form.get('password')), files = await documents(form, id);
    attemptedPrepare = true;
    await rpc(c, 'snote_registration_prepare', { p_id: id, p_profile: value, p_documents: files.map(file => file.document) }); prepared = true;
    for (const file of files) {
      uploaded.push(file.document.path);
      const { response } = await requestJSON(c, '/storage/v1/object/' + BUCKET + '/' + file.document.path.split('/').map(encodeURIComponent).join('/'), { body: file.bytes, jsonBody: false, type: file.document.mimeType, extraHeaders: { 'x-upsert': 'false' } });
      if (!response.ok) fail('UPSTREAM_ERROR');
    }
    await rpc(c, 'snote_registration_ready', { p_id: id });
    authSent = true;
    return await signup(c, new URL(request.url).origin, id, value, pass);
  } catch (error) {
    if (attemptedPrepare && (!authSent || error instanceof RegistrationError && error.knownAuthFailure) && (prepared || !['COMPANY_EXISTS', 'CONTACT_EXISTS'].includes(error?.code))) await cancel(c, id, uploaded);
    throw error;
  }
}
export async function onRequest({ request, env }) {
  try {
    if (!sameOriginRequest(request)) fail('FORBIDDEN');
    if (!['GET', 'POST'].includes(request.method)) fail('METHOD_NOT_ALLOWED');
    const c = configuration(env);
    if (request.method === 'GET') return json({ ok: true, configured: !!c });
    if (!c) fail('SETUP_REQUIRED');
    if (request.url.length > 4096 || new URL(request.url).protocol !== 'https:') fail('INVALID_REQUEST');
    if (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding') !== 'identity') fail('UNSUPPORTED_MEDIA_TYPE');
    const declared = request.headers.get('Content-Length'); if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) fail('PAYLOAD_TOO_LARGE');
    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (type === 'application/json') {
      const raw = await readBoundedBytes(request, 4096, { timeoutMs: 5000 }); let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('INVALID_REQUEST'); }
      keys(body, ['action', 'companyName']); if (body.action !== 'check-company' || Object.keys(body).length !== 2) fail('INVALID_REQUEST');
      const name = text(body.companyName, 100); await budget(c, request, 'check-company');
      const result = await rpc(c, 'snote_registration_company_check', { p_name: name }); if (typeof result.available !== 'boolean') fail('UPSTREAM_ERROR');
      return json({ ok: true, available: result.available });
    }
    if (type !== 'multipart/form-data' || !/;\s*boundary=(?:"[^"\r\n]{1,200}"|[^;\s\r\n]{1,200})(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('UNSUPPORTED_MEDIA_TYPE');
    await budget(c, request, 'register');
    return json(await register(c, request));
  } catch (error) { return errorResponse(error); }
}
export const onRequestGet = onRequest, onRequestPost = onRequest;
