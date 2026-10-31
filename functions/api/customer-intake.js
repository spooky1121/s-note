/** Customer phone-possession confirmation. This is not a legal-name identity check. */
const MAX_BODY = 16 * 1024;
const CONSENT_VERSION = '2026-11-01';
const TOKEN = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CUSTOMER_FIELDS = ['name', 'addressBase', 'addressDetail', 'mailingBase', 'mailingDetail', 'sameAddress', 'refundBank', 'refundAccount', 'refundHolder'];
const ACTION_FIELDS = {
  create: ['carId', 'phone'], list: ['carId'], revoke: ['id'], info: ['token'],
  'send-code': ['token'], verify: ['token', 'challengeId', 'code'],
  submit: ['token', 'session', 'vehicleConfirmed', 'consent', 'refundConsent', 'customer']
};
const MESSAGES = {
  INVALID_LINK: [404, '입력 링크를 확인해 주세요.'],
  EXPIRED: [410, '입력 링크의 사용 기한이 지났습니다. 담당자에게 새 링크를 요청하세요.'],
  REVOKED: [410, '사용이 취소된 입력 링크입니다.'],
  ALREADY_SUBMITTED: [409, '이미 제출한 입력 링크입니다.'],
  RATE_LIMITED: [429, '요청 횟수를 초과했습니다. 잠시 후 다시 시도하세요.'],
  INVALID_CODE: [400, '인증번호가 일치하지 않습니다.'],
  LOCKED: [423, '인증 시도 횟수를 초과했습니다. 새 인증번호를 요청하세요.'],
  SESSION_EXPIRED: [401, '휴대전화 확인이 만료되었습니다. 다시 인증하세요.'],
  VALIDATION_ERROR: [400, '입력 내용을 확인해 주세요.'],
  FORBIDDEN: [403, '이 작업을 수행할 권한이 없습니다.'],
  UNAUTHORIZED: [401, '로그인이 필요합니다.'],
  INVALID_REQUEST: [400, '요청 형식을 확인해 주세요.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'JSON 요청만 사용할 수 있습니다.'],
  PAYLOAD_TOO_LARGE: [413, '요청 크기가 허용 범위를 초과했습니다.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  SERVICE_UNAVAILABLE: [503, '고객정보 입력 서비스 설정을 확인해 주세요.'],
  UPSTREAM_ERROR: [502, '서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'],
  SMS_SEND_FAILED: [502, '문자가 접수되지 않았습니다. 잠시 후 새 인증번호를 요청하세요.'],
  SMS_SEND_UNKNOWN: [503, '문자 접수 여부를 확인하지 못했습니다. 자동 재전송하지 않습니다. 잠시 후 다시 요청하세요.']
};
const RPC_CODES = new Set(['INVALID_LINK', 'EXPIRED', 'REVOKED', 'ALREADY_SUBMITTED', 'RATE_LIMITED', 'INVALID_CODE', 'LOCKED', 'SESSION_EXPIRED', 'VALIDATION_ERROR', 'FORBIDDEN']);

class IntakeError extends Error {
  constructor(code, retryAfter) { super(code); this.code = code; this.retryAfter = retryAfter; }
}
function fail(code, retryAfter) { throw new IntakeError(code, retryAfter); }
function json(body, status = 200, retryAfter) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY'
  };
  if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
  if (status === 405) headers.Allow = 'GET, POST';
  return new Response(JSON.stringify(body), { status, headers });
}
function errorResponse(error) {
  const code = error instanceof IntakeError && MESSAGES[error.code] ? error.code : 'UPSTREAM_ERROR';
  const [status, message] = MESSAGES[code];
  const retryAfter = Number.isInteger(error?.retryAfter) && error.retryAfter >= 0 && error.retryAfter <= 86400 ? error.retryAfter : undefined;
  return json({ error: message, code, ...(retryAfter === undefined ? {} : { retryAfter }) }, status, retryAfter);
}
function configuration(env = {}) {
  const value = key => typeof env[key] === 'string' ? env[key].trim() : '';
  try {
    const supabase = new URL(value('SUPABASE_URL'));
    const publicOrigin = new URL(value('CUSTOMER_INTAKE_PUBLIC_ORIGIN'));
    const sender = value('SOLAPI_SENDER').replace(/[ -]/g, '');
    if (supabase.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(supabase.hostname) || supabase.port || supabase.username || supabase.password || supabase.search || supabase.hash || supabase.pathname !== '/') return null;
    if (publicOrigin.protocol !== 'https:' || publicOrigin.username || publicOrigin.password || publicOrigin.search || publicOrigin.hash || publicOrigin.pathname !== '/' || !publicOrigin.hostname.includes('.')) return null;
    const publishable = value('SUPABASE_PUBLISHABLE_KEY');
    const serviceRole = value('SUPABASE_SERVICE_ROLE_KEY');
    const apiKey = value('SOLAPI_API_KEY');
    const apiSecret = value('SOLAPI_API_SECRET');
    const otpSecret = value('CUSTOMER_INTAKE_OTP_SECRET');
    if (!publishable || !serviceRole || !apiKey || !apiSecret || otpSecret.length < 32 || !/^\d{8,11}$/.test(sender)) return null;
    if ([publishable, serviceRole, apiKey, apiSecret, otpSecret].some(x => /[\r\n]/.test(x))) return null;
    return { supabase: supabase.origin, publicOrigin: publicOrigin.origin, publishable, serviceRole, apiKey, apiSecret, otpSecret, sender };
  } catch { return null; }
}
function sameOrigin(request, config) {
  const origin = request.headers.get('Origin');
  if (origin !== null && (origin !== new URL(request.url).origin || (config && origin !== config.publicOrigin))) fail('FORBIDDEN');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('FORBIDDEN');
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function whitelist(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail('VALIDATION_ERROR');
}
function text(value, max, required = true) {
  if (typeof value !== 'string') { if (!required && value === undefined) return ''; fail('VALIDATION_ERROR'); }
  const result = value.normalize('NFC').trim();
  if ((required && !result) || [...result].length > max || /[\u0000-\u001f\u007f]/.test(result)) fail('VALIDATION_ERROR');
  return result;
}
function phone(value) {
  let result = text(value, 25).replace(/[ ()-]/g, '');
  if (result.startsWith('+82')) result = '0' + result.slice(3);
  if (!/^(?:010\d{8}|01[16789]\d{7,8})$/.test(result)) fail('VALIDATION_ERROR');
  return result;
}
function token(value) { if (typeof value !== 'string' || !TOKEN.test(value)) fail('INVALID_LINK'); return value; }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('VALIDATION_ERROR'); return value; }
function customer(value) {
  whitelist(value, CUSTOMER_FIELDS);
  if (typeof value.sameAddress !== 'boolean') fail('VALIDATION_ERROR');
  const result = {
    name: text(value.name, 50), addressBase: text(value.addressBase, 200), addressDetail: text(value.addressDetail, 100, false),
    mailingBase: text(value.mailingBase, 200, false), mailingDetail: text(value.mailingDetail, 100, false), sameAddress: value.sameAddress,
    refundBank: text(value.refundBank, 35, false), refundAccount: text(value.refundAccount, 64, false).normalize('NFKC').replace(/\s/g, ''), refundHolder: text(value.refundHolder, 50, false)
  };
  if ([...result.name].length < 2) fail('VALIDATION_ERROR');
  if (result.sameAddress) { result.mailingBase = result.addressBase; result.mailingDetail = result.addressDetail; }
  if (!result.sameAddress && result.mailingDetail && !result.mailingBase) fail('VALIDATION_ERROR');
  if ([...`${result.addressBase}${result.addressDetail ? ' ' + result.addressDetail : ''}`].length > 220 || [...`${result.mailingBase}${result.mailingDetail ? ' ' + result.mailingDetail : ''}`].length > 220) fail('VALIDATION_ERROR');
  const refund = [result.refundBank, result.refundAccount, result.refundHolder];
  if (refund.some(Boolean) && (!refund.every(Boolean) || !/^[\d-]{6,32}$/.test(result.refundAccount) || result.refundAccount.replace(/-/g, '').length < 6)) fail('VALIDATION_ERROR');
  return result;
}
async function boundedJson(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('UNSUPPORTED_MEDIA_TYPE');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail('PAYLOAD_TOO_LARGE');
  if (!request.body) fail('INVALID_REQUEST');
  const reader = request.body.getReader();
  let timer;
  try {
    const read = async () => {
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) { void reader.cancel().catch(() => {}); fail('PAYLOAD_TOO_LARGE'); }
        chunks.push(value);
      }
      const all = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all)); } catch { fail('INVALID_REQUEST'); }
    };
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new IntakeError('INVALID_REQUEST')); }, 5000); })]);
  } finally { clearTimeout(timer); }
}
function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
async function sha(value) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}
function randomCode() {
  let result = '';
  while (result.length < 6) { const b = crypto.getRandomValues(new Uint8Array(1))[0]; if (b < 250) result += String(b % 10); }
  return result;
}
async function fetchJson(url, options, timeout, maxBytes = 256 * 1024) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
    const reader = response.body?.getReader(); let size = 0; const chunks = [];
    if (!reader) throw new Error('empty');
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new Error('size'); } chunks.push(value); }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    let data; try { data = JSON.parse(new TextDecoder().decode(all)); } catch { data = null; }
    return { response, data };
  } finally { clearTimeout(timer); }
}
async function rpc(config, name, args, jwt) {
  let response, data;
  try {
    ({ response, data } = await fetchJson(`${config.supabase}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: jwt ? config.publishable : config.serviceRole, Authorization: `Bearer ${jwt || config.serviceRole}` }, body: JSON.stringify(args)
    }, 15000));
  } catch { fail('UPSTREAM_ERROR'); }
  if (!response.ok) { if (jwt && response.status === 401) fail('UNAUTHORIZED'); if (jwt && response.status === 403) fail('FORBIDDEN'); fail('UPSTREAM_ERROR'); }
  if (object(data) && data.ok === false) fail(RPC_CODES.has(data.code) ? data.code : 'UPSTREAM_ERROR', data.retryAfter);
  if (!object(data) && !Array.isArray(data)) fail('UPSTREAM_ERROR');
  return data;
}
function auth(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
  if (!match || match[1].length < 30 || match[1].length > 5000) fail('UNAUTHORIZED');
  return match[1];
}
function car(value) {
  if (!object(value)) fail('UPSTREAM_ERROR');
  return Object.fromEntries(['model', 'plate', 'year', 'km', 'color', 'sell'].map(key => [key, ['string', 'number'].includes(typeof value[key]) ? value[key] : '']));
}
function safeInfo(data) {
  if (data.ok !== true) fail('UPSTREAM_ERROR');
  if (data.status === 'submitted') return { ok: true, status: 'submitted', expiresAt: data.expiresAt };
  return { ok: true, car: car(data.car), companyName: data.companyName, phoneMasked: data.phoneMasked, expiresAt: data.expiresAt, status: data.status };
}
async function delivery(config, id, kind, challengeId, status) {
  const result = await rpc(config, 'snote_intake_delivery', { p_id: id, p_kind: kind, p_challenge_id: challengeId, p_status: status });
  if (result.ok !== true) fail('UPSTREAM_ERROR');
}
async function sendMessage(config, to, body, invitation) {
  const date = new Date().toISOString(); const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const signature = await hmac(config.apiSecret, date + salt);
  try {
    const { response, data } = await fetchJson('https://api.solapi.com/messages/v4/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `HMAC-SHA256 apiKey=${config.apiKey}, date=${date}, salt=${salt}, signature=${signature}` },
      body: JSON.stringify({ message: { to, from: config.sender, text: body, type: invitation ? 'LMS' : 'SMS', ...(invitation ? { subject: '고객정보 입력 안내' } : {}) } })
    }, 10000, 16 * 1024);
    if (response.ok && String(data?.statusCode) === '2000' && typeof data?.messageId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(data.messageId)) return 'sent';
    if ((response.status >= 400 && response.status < 500) || (data?.statusCode !== undefined && String(data.statusCode) !== '2000')) return 'failed';
    return 'unknown';
  } catch { return 'unknown'; }
}
async function perform(request, config, body) {
  if (!object(body) || typeof body.action !== 'string' || !Object.hasOwn(ACTION_FIELDS, body.action)) fail('INVALID_REQUEST');
  const action = body.action;
  whitelist(body, ['action', ...ACTION_FIELDS[action]]);
  const jwt = ['create', 'list', 'revoke'].includes(action) ? auth(request) : undefined;
  if (action === 'create') {
    const carId = text(body.carId, 200); const recipient = phone(body.phone); const rawToken = randomToken();
    const data = await rpc(config, 'snote_intake_create', { p_car_id: carId, p_phone: recipient, p_token_hash: await sha(rawToken) }, jwt);
    if (data.ok !== true || !UUID.test(data.id || '')) fail('UPSTREAM_ERROR');
    const link = `${config.publicOrigin}/customer.html#${rawToken}`;
    let status = await sendMessage(config, recipient, `[S-NOTE] 고객정보 입력 안내\n담당자가 요청한 차량과 안내 내용을 확인하고 입력해 주세요.\n${link}\n24시간 이내 사용 가능합니다.`, true);
    try { await delivery(config, data.id, 'invitation', null, status); } catch { status = 'unknown'; }
    return { ok: true, request: { id: data.id, car: car(data.car), companyName: data.companyName, expiresAt: data.expiresAt, deliveryStatus: status }, link,
      ...(status === 'sent' ? {} : { warning: status === 'failed' ? '안내 문자가 접수되지 않았습니다. 링크를 직접 전달하거나 상태를 확인한 뒤 새로 요청하세요.' : '안내 문자 접수 여부를 확인하지 못했습니다. 자동 재전송하지 않습니다. 중복 발송에 주의하고 상태를 확인하세요.' }) };
  }
  if (action === 'list') {
    const rows = await rpc(config, 'snote_intake_list', { p_car_id: text(body.carId, 200) }, jwt);
    if (!Array.isArray(rows) || rows.length > 5) fail('UPSTREAM_ERROR');
    const fields = ['id', 'phone', 'createdAt', 'expiresAt', 'submittedAt', 'revokedAt', 'deliveryStatus', 'status'];
    return { ok: true, requests: rows.map(row => {
      if (!object(row)) fail('UPSTREAM_ERROR');
      const result = Object.fromEntries(fields.map(key => [key, row[key] ?? null]));
      if (row.submittedAt && object(row.submission)) result.submission = Object.fromEntries([...CUSTOMER_FIELDS, 'refundConsent', 'phone', 'carModel', 'plate'].filter(key => Object.hasOwn(row.submission, key)).map(key => [key, row.submission[key]]));
      return result;
    }) };
  }
  if (action === 'revoke') { const data = await rpc(config, 'snote_intake_revoke', { p_id: uuid(body.id) }, jwt); if (data.ok !== true) fail('UPSTREAM_ERROR'); return { ok: true }; }
  const tokenHash = await sha(token(body.token));
  if (action === 'info') return safeInfo(await rpc(config, 'snote_intake_view', { p_token_hash: tokenHash }));
  if (action === 'send-code') {
    const challengeId = crypto.randomUUID(); const code = randomCode();
    const data = await rpc(config, 'snote_intake_challenge', { p_token_hash: tokenHash, p_challenge_id: challengeId, p_otp_hash: await hmac(config.otpSecret, `${challengeId}:${code}`) });
    if (data.ok !== true || data.challengeId !== challengeId || !UUID.test(data.id || '') || !/^(?:010\d{8}|01[16789]\d{7,8})$/.test(data.phone || '')) fail('UPSTREAM_ERROR');
    let status = await sendMessage(config, data.phone, `[S-NOTE] 인증번호: ${code} (5분 내 입력)`, false);
    try { await delivery(config, data.id, 'otp', challengeId, status); } catch {
      status = 'unknown';
      // A pending challenge is unusable. If the acknowledgement was lost after a
      // sent update, explicitly invalidate it; never repeat the SMS request.
      try { await delivery(config, data.id, 'otp', challengeId, 'unknown'); } catch { /* No client challenge/session is issued. */ }
    }
    if (status !== 'sent') fail(status === 'failed' ? 'SMS_SEND_FAILED' : 'SMS_SEND_UNKNOWN', 60);
    return { ok: true, challengeId, expiresAt: data.expiresAt, retryAfter: 60 };
  }
  if (action === 'verify') {
    const challengeId = uuid(body.challengeId);
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fail('VALIDATION_ERROR');
    const session = randomToken();
    const data = await rpc(config, 'snote_intake_verify', { p_token_hash: tokenHash, p_challenge_id: challengeId, p_otp_hash: await hmac(config.otpSecret, `${challengeId}:${body.code}`), p_session_hash: await sha(session) });
    if (data.ok !== true || typeof data.sessionExpiresAt !== 'string') fail('UPSTREAM_ERROR');
    return { ok: true, session, sessionExpiresAt: data.sessionExpiresAt };
  }
  if (action === 'submit') {
    if (body.vehicleConfirmed !== true || body.consent !== true) fail('VALIDATION_ERROR');
    if (body.refundConsent !== undefined && typeof body.refundConsent !== 'boolean') fail('VALIDATION_ERROR');
    if (typeof body.session !== 'string' || !TOKEN.test(body.session)) fail('SESSION_EXPIRED');
    const details = customer(body.customer);
    if (details.refundBank && body.refundConsent !== true) fail('VALIDATION_ERROR');
    if (!details.refundBank && body.refundConsent === true) fail('VALIDATION_ERROR');
    details.refundConsent = body.refundConsent === true;
    const data = await rpc(config, 'snote_intake_submit', { p_token_hash: tokenHash, p_session_hash: await sha(body.session), p_customer: details, p_consent_version: CONSENT_VERSION });
    if (data.ok !== true || typeof data.submittedAt !== 'string') fail('UPSTREAM_ERROR');
    return { ok: true, submittedAt: data.submittedAt, ...(data.alreadySubmitted === true ? { alreadySubmitted: true } : {}) };
  }
  fail('INVALID_REQUEST');
}

export function onRequestGet({ request, env }) {
  try { const config = configuration(env); sameOrigin(request, config); return json({ service: 'snote-customer-intake', configured: !!config }); } catch (error) { return errorResponse(error); }
}
export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const config = configuration(env); if (!config) fail('SERVICE_UNAVAILABLE'); sameOrigin(request, config);
    return json(await perform(request, config, await boundedJson(request)));
  } catch (error) { return errorResponse(error); }
}
export function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return errorResponse(new IntakeError('METHOD_NOT_ALLOWED'));
}
