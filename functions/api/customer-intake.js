/** Customer phone-possession confirmation. This is not a legal-name identity check. */
const MAX_BODY = 16 * 1024;
const CONSENT_VERSION = '2026-11-01';
const RRN_NOTICE_VERSION = '2026-11-01-r1';
const TOKEN = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CUSTOMER_FIELDS = ['name', 'addressBase', 'addressDetail', 'mailingBase', 'mailingDetail', 'sameAddress', 'refundBank', 'refundAccount', 'refundHolder'];
const ACTION_FIELDS = {
  create: ['carId', 'phone'], list: ['carId'], revoke: ['id'], 'read-rrn': ['id'], info: ['token'],
  'send-code': ['token'], verify: ['token', 'challengeId', 'code'],
  submit: ['token', 'session', 'vehicleConfirmed', 'consent', 'refundConsent', 'customer', 'rrn', 'rrnNoticeAccepted']
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
  DB_SETUP_REQUIRED: [503, '고객접수 SQL이 모두 적용되었는지 확인해 주세요.'],
  SERVER_SETUP_REQUIRED: [503, 'Supabase 서버 키 설정과 권한을 확인해 주세요.'],
  RRN_SETUP_REQUIRED: [503, '주민번호 암호화 설정을 확인해 주세요.'],
  RRN_NOT_AVAILABLE: [403, '주민번호 정보를 이용할 수 없습니다. 담당자와 보관기간·권한 설정을 확인해 주세요.'],
  UPSTREAM_ERROR: [502, '서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'],
  SMS_SEND_FAILED: [502, '문자가 접수되지 않았습니다. 잠시 후 새 인증번호를 요청하세요.'],
  SMS_SEND_UNKNOWN: [503, '문자 접수 여부를 확인하지 못했습니다. 자동 재전송하지 않습니다. 잠시 후 다시 요청하세요.']
};
const RPC_CODES = new Set(['INVALID_LINK', 'EXPIRED', 'REVOKED', 'ALREADY_SUBMITTED', 'RATE_LIMITED', 'INVALID_CODE', 'LOCKED', 'SESSION_EXPIRED', 'VALIDATION_ERROR', 'FORBIDDEN', 'RRN_NOT_AVAILABLE']);
const DB_SETUP_CODES = new Set(['PGRST202', 'PGRST204', '42P01', '42703', '42883']);

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
const CONFIG_NAMES = [
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'CUSTOMER_INTAKE_PUBLIC_ORIGIN', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET',
  'SOLAPI_SENDER', 'CUSTOMER_INTAKE_OTP_SECRET'
];
function inspectConfiguration(env = {}) {
  const values = Object.fromEntries(CONFIG_NAMES.map(name => [name, typeof env?.[name] === 'string' ? env[name].trim() : '']));
  const issues = [];
  // Diagnostics contain fixed names and fixed explanations only. Never include
  // configured values, their lengths, prefixes, or hashes in a public response.
  const issue = (name, reason) => { if (!issues.some(item => item.name === name)) issues.push({ name, reason }); };
  for (const name of CONFIG_NAMES) if (!values[name]) issue(name, '값이 설정되지 않았습니다.');
  let supabase, publicOrigin;
  try {
    supabase = new URL(values.SUPABASE_URL);
    if (supabase.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(supabase.hostname) || supabase.port || supabase.username || supabase.password || supabase.search || supabase.hash || supabase.pathname !== '/') throw new Error('invalid');
  } catch { issue('SUPABASE_URL', 'HTTPS Supabase 프로젝트 주소를 경로 없이 입력해 주세요.'); }
  try {
    publicOrigin = new URL(values.CUSTOMER_INTAKE_PUBLIC_ORIGIN);
    if (publicOrigin.protocol !== 'https:' || publicOrigin.username || publicOrigin.password || publicOrigin.search || publicOrigin.hash || publicOrigin.pathname !== '/' || !publicOrigin.hostname.includes('.')) throw new Error('invalid');
  } catch { issue('CUSTOMER_INTAKE_PUBLIC_ORIGIN', '실제 운영 HTTPS 주소를 경로·쿼리·해시 없이 입력해 주세요.'); }
  const sender = values.SOLAPI_SENDER.replace(/[ -]/g, '');
  if (!/^\d{8,11}$/.test(sender)) issue('SOLAPI_SENDER', '승인된 국내 발신번호를 숫자 8~11자리로 입력해 주세요.');
  for (const name of ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'CUSTOMER_INTAKE_OTP_SECRET']) {
    if (/[\r\n]/.test(values[name])) issue(name, '줄바꿈 없이 한 줄로 입력해 주세요.');
  }
  if (values.CUSTOMER_INTAKE_OTP_SECRET.length < 32) issue('CUSTOMER_INTAKE_OTP_SECRET', '32자 이상의 충분히 긴 무작위 문자열을 설정해 주세요.');
  return {
    config: issues.length ? null : {
      supabase: supabase.origin, publicOrigin: publicOrigin.origin,
      publishable: values.SUPABASE_PUBLISHABLE_KEY, serviceRole: values.SUPABASE_SERVICE_ROLE_KEY,
      apiKey: values.SOLAPI_API_KEY, apiSecret: values.SOLAPI_API_SECRET,
      otpSecret: values.CUSTOMER_INTAKE_OTP_SECRET, sender
    },
    issues
  };
}
function configuration(env) { return inspectConfiguration(env).config; }
function inspectRrnConfiguration(env = {}) {
  const value = typeof env?.CUSTOMER_INTAKE_RRN_KEY === 'string' ? env.CUSTOMER_INTAKE_RRN_KEY.trim() : '';
  if (!value) return { key: null, issues: [{ name: 'CUSTOMER_INTAKE_RRN_KEY', reason: '주민번호 암호화 키가 설정되지 않았습니다.' }] };
  if (!/^[a-f0-9]{64}$/i.test(value)) return { key: null, issues: [{ name: 'CUSTOMER_INTAKE_RRN_KEY', reason: '32바이트 암호화 키를 64자리 16진수로 입력해 주세요.' }] };
  return { key: unhex(value), issues: [] };
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
function unhex(value) { return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16)); }
function normalizedRrn(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string') fail('VALIDATION_ERROR');
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^\d{6}-?\d{7}$/.test(trimmed)) fail('VALIDATION_ERROR');
  const digits = trimmed.replace('-', '');
  const type = Number(digits[6]);
  if (type < 1 || type > 8) fail('VALIDATION_ERROR');
  const year = Number(digits.slice(0, 2)) + ([1, 2, 5, 6].includes(type) ? 1900 : 2000);
  const month = Number(digits.slice(2, 4)); const day = Number(digits.slice(4, 6));
  const birth = new Date(Date.UTC(year, month - 1, day));
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day || birth.getTime() > today) fail('VALIDATION_ERROR');
  return digits;
}
async function rrnKey(rawKey, usage) {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [usage]);
}
function rrnAad(tokenHash) { return new TextEncoder().encode(`snote-intake-rrn:v1:${tokenHash}`); }
async function encryptRrn(rawKey, digits, tokenHash) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: rrnAad(tokenHash), tagLength: 128 }, await rrnKey(rawKey, 'encrypt'), new TextEncoder().encode(digits));
  return `v1.${hex(iv)}.${hex(new Uint8Array(ciphertext))}`;
}
async function decryptRrn(rawKey, envelope, tokenHash) {
  if (typeof envelope !== 'string' || !/^v1\.[a-f0-9]{24}\.[a-f0-9]{58}$/.test(envelope) || !TOKEN.test(tokenHash || '')) fail('RRN_NOT_AVAILABLE');
  try {
    const [, iv, ciphertext] = envelope.split('.');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: rrnAad(tokenHash), tagLength: 128 }, await rrnKey(rawKey, 'decrypt'), unhex(ciphertext));
    const digits = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (!/^\d{13}$/.test(digits) || normalizedRrn(digits) !== digits) fail('RRN_NOT_AVAILABLE');
    return digits;
  } catch { fail('RRN_NOT_AVAILABLE'); }
}
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
    // workerd supports manual/follow only. Reject redirects before parsing so
    // Supabase/SOLAPI credentials are never forwarded to a redirect target.
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Upstream redirect refused');
    }
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
  if (!response.ok) {
    if (object(data) && DB_SETUP_CODES.has(data.code)) fail('DB_SETUP_REQUIRED');
    if (response.status === 401) fail(jwt ? 'UNAUTHORIZED' : 'SERVER_SETUP_REQUIRED');
    if (response.status === 403) fail(jwt ? 'FORBIDDEN' : 'SERVER_SETUP_REQUIRED');
    fail('UPSTREAM_ERROR');
  }
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
function safeInfo(data, rrnAvailable = false) {
  if (data.ok !== true) fail('UPSTREAM_ERROR');
  if (data.status === 'submitted') return { ok: true, status: 'submitted', expiresAt: data.expiresAt };
  return { ok: true, car: car(data.car), companyName: data.companyName, phoneMasked: data.phoneMasked, expiresAt: data.expiresAt, status: data.status, rrnEnabled: rrnAvailable && data.rrnEnabled === true };
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
async function perform(request, config, body, rrnEncryptionKey) {
  if (!object(body) || typeof body.action !== 'string' || !Object.hasOwn(ACTION_FIELDS, body.action)) fail('INVALID_REQUEST');
  const action = body.action;
  whitelist(body, ['action', ...ACTION_FIELDS[action]]);
  const jwt = ['create', 'list', 'revoke', 'read-rrn'].includes(action) ? auth(request) : undefined;
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
      result.hasRrn = !!rrnEncryptionKey && row.hasRrn === true;
      if (row.submittedAt && object(row.submission)) result.submission = Object.fromEntries([...CUSTOMER_FIELDS, 'refundConsent', 'phone', 'carModel', 'plate'].filter(key => Object.hasOwn(row.submission, key)).map(key => [key, row.submission[key]]));
      return result;
    }) };
  }
  if (action === 'revoke') { const data = await rpc(config, 'snote_intake_revoke', { p_id: uuid(body.id) }, jwt); if (data.ok !== true) fail('UPSTREAM_ERROR'); return { ok: true }; }
  if (action === 'read-rrn') {
    const id = uuid(body.id);
    if (!rrnEncryptionKey) fail('RRN_SETUP_REQUIRED');
    const data = await rpc(config, 'snote_intake_rrn_access', { p_id: id }, jwt);
    if (data.ok !== true || data.id !== id) fail('RRN_NOT_AVAILABLE');
    return { ok: true, rrn: await decryptRrn(rrnEncryptionKey, data.rrnCipher, data.tokenHash) };
  }
  const tokenHash = await sha(token(body.token));
  if (action === 'info') {
    if (rrnEncryptionKey) {
      try { return safeInfo(await rpc(config, 'snote_intake_view_v2', { p_token_hash: tokenHash }), true); }
      catch (error) { if (!(error instanceof IntakeError) || error.code !== 'DB_SETUP_REQUIRED') throw error; }
    }
    return safeInfo(await rpc(config, 'snote_intake_view', { p_token_hash: tokenHash }));
  }
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
    const rrn = normalizedRrn(body.rrn);
    if (body.rrnNoticeAccepted !== undefined && typeof body.rrnNoticeAccepted !== 'boolean') fail('VALIDATION_ERROR');
    if (rrn && body.rrnNoticeAccepted !== true) fail('VALIDATION_ERROR');
    if (rrn && !rrnEncryptionKey) fail('RRN_SETUP_REQUIRED');
    const args = { p_token_hash: tokenHash, p_session_hash: await sha(body.session), p_customer: details, p_consent_version: CONSENT_VERSION };
    if (rrn) {
      args.p_rrn_cipher = await encryptRrn(rrnEncryptionKey, rrn, tokenHash);
      args.p_rrn_notice_version = RRN_NOTICE_VERSION;
    }
    const data = await rpc(config, rrn ? 'snote_intake_submit_v2' : 'snote_intake_submit', args);
    if (data.ok !== true || typeof data.submittedAt !== 'string') fail('UPSTREAM_ERROR');
    return { ok: true, submittedAt: data.submittedAt, ...(data.alreadySubmitted === true ? { alreadySubmitted: true } : {}) };
  }
  fail('INVALID_REQUEST');
}

export function onRequestGet({ request, env }) {
  try {
    const { config, issues } = inspectConfiguration(env);
    const rrn = inspectRrnConfiguration(env);
    sameOrigin(request, config);
    const originMatches = config ? new URL(request.url).origin === config.publicOrigin : null;
    if (originMatches === false) issues.push({ name: 'CUSTOMER_INTAKE_PUBLIC_ORIGIN', reason: '실제 접속 주소와 운영 주소 설정이 일치하지 않습니다.' });
    return json({ service: 'snote-customer-intake', configured: !!config, configurationIssues: issues, originMatches, rrnConfigured: !!rrn.key, rrnConfigurationIssues: rrn.issues });
  } catch (error) { return errorResponse(error); }
}
export async function onRequestPost({ request, env }) {
  try {
    sameOrigin(request);
    const config = configuration(env); if (!config) fail('SERVICE_UNAVAILABLE'); sameOrigin(request, config);
    return json(await perform(request, config, await boundedJson(request), inspectRrnConfiguration(env).key));
  } catch (error) { return errorResponse(error); }
}
export function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return errorResponse(new IntakeError('METHOD_NOT_ALLOWED'));
}
