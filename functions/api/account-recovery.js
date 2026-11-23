import { readBoundedBytes, sameOriginRequest, hardenAPIResponse } from '../_shared/api-security.js';
import { solapi } from '../_shared/document-mms.js';

// Public possession-proof flow. Only private, service-role RPCs resolve an
// account. Browser input can never nominate an Auth user or a delivery address.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const PHONE = /^(?:010\d{8}|01[16789]\d{7,8})$/u;
const TOKEN = /^[a-f0-9]{64}$/u;
const SENDER = '01096669997';
const RECOVERY_REDIRECT = 'https://s-note.kr/';
const RPC_PREFIX = '/rest/v1/rpc/snote_phone_recovery_';
const ERRORS = {
  INVALID_REQUEST: [400, '입력 항목과 요청 형식을 확인해 주세요.'],
  FORBIDDEN: [403, 'S-NOTE 화면에서 다시 시도해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  SETUP_REQUIRED: [503, '계정 확인 서비스 설정을 확인해 주세요.'],
  NETWORK: [502, '처리 결과를 확인하지 못했습니다. 잠시 후 같은 요청으로 다시 확인해 주세요.'],
  RATE_LIMITED: [429, '인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.'],
  INVALID_CODE: [400, '인증번호를 확인해 주세요.'],
  LOCKED: [423, '인증 시도 횟수를 초과했습니다. 새 인증번호를 요청해 주세요.'],
  EXPIRED: [410, '인증 유효기간이 지났습니다. 새 인증번호를 요청해 주세요.'],
  PROOF_CONSUMED: [409, '이미 사용한 인증 요청입니다. 처리 결과를 확인해 주세요.'],
  REQUEST_REUSED: [409, '이미 사용한 요청입니다. 새 인증번호를 요청해 주세요.'],
  EMAIL_PENDING: [409, '인증메일 발송 요청을 확인 중입니다. 같은 인증 요청으로 다시 확인해 주세요.'],
  EMAIL_SEND_FAILED: [502, '인증메일 발송 요청이 접수되지 않았습니다. 잠시 후 새 인증을 진행해 주세요.'],
  EMAIL_SEND_UNKNOWN: [503, '인증메일 발송 요청의 접수 여부를 확인하지 못했습니다. 자동으로 다시 보내지 않습니다. 받은편지함을 먼저 확인해 주세요.'],
  RESET_PENDING: [409, '비밀번호 변경 결과를 확인 중입니다. 같은 요청으로 다시 확인해 주세요.'],
  RESET_UNKNOWN: [503, '비밀번호 변경 결과를 확인하지 못했습니다. 자동으로 다시 변경하지 않습니다. 잠시 후 로그인 상태를 확인해 주세요.'],
  RESET_FAILED: [400, '비밀번호 변경을 완료하지 못했습니다. 비밀번호 기준을 확인한 뒤 새 인증을 진행해 주세요.']
};
class RecoveryError extends Error { constructor(code, retryAfter) { super(code); this.code = code; this.retryAfter = retryAfter; } }
const fail = (code, retryAfter) => { throw new RecoveryError(code, retryAfter); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const purpose = value => { if (!['id', 'password'].includes(value)) fail('INVALID_REQUEST'); return value; };
function fields(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST'); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_REQUEST'); return value.toLowerCase(); }
function phone(value) {
  if (typeof value !== 'string' || value.length > 25) fail('INVALID_REQUEST');
  let normalized = value.trim().replace(/[ ()-]/gu, '');
  if (normalized.startsWith('+82')) normalized = '0' + normalized.slice(3);
  if (!PHONE.test(normalized)) fail('INVALID_REQUEST'); return normalized;
}
function name(value) {
  if (typeof value !== 'string') fail('INVALID_REQUEST');
  const normalized = value.normalize('NFC').trim();
  if (!normalized || [...normalized].length > 40 || /[\u0000-\u001f\u007f]/u.test(normalized)) fail('INVALID_REQUEST'); return normalized;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) fail('INVALID_REQUEST'); return value;
}
function email(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value); }
function json(body, status = 200, retryAfter) {
  return hardenAPIResponse(new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', ...(status === 405 ? { Allow: 'POST' } : {}),
    ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) })
  } }));
}
function config(env = {}) {
  let url; try { url = new URL(env.SUPABASE_URL); } catch { fail('SETUP_REQUIRED'); }
  const names = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'CUSTOMER_INTAKE_OTP_SECRET'];
  const values = names.map(key => typeof env[key] === 'string' ? env[key].trim() : '');
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      values.some(value => !value || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) || values[0] === values[1] || values[4].length < 32) fail('SETUP_REQUIRED');
  return { url: url.origin, pub: values[0], service: values[1], key: values[2], secret: values[3], otpSecret: values[4] };
}
function clientIP(request) {
  const value = (request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value) && value.split('.').every(part => Number(part) <= 255)) return value.split('.').map(Number).join('.');
  if (value.length <= 64 && /^[0-9a-f:.]+$/u.test(value) && value.includes(':')) {
    try { return new URL('http://[' + value + ']/').hostname.slice(1, -1); } catch {}
  }
  return 'unidentified';
}
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
async function hmac(c, domain, ...values) {
  const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', encoder.encode(c.otpSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(['snote-phone-recovery:' + domain + ':v1', ...values]))));
}
async function receiptHash(token) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))); }
function randomCode() {
  let value = ''; while (value.length < 6) { const byte = crypto.getRandomValues(new Uint8Array(1))[0]; if (byte < 250) value += String(byte % 10); } return value;
}
async function boundedJSON(response) {
  const reader = response.body?.getReader(); if (!reader) fail('NETWORK');
  let size = 0, complete = false; const chunks = [];
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65536) fail('NETWORK'); chunks.push(next.value); }
    complete = true;
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!object(value)) fail('NETWORK'); return value;
  } catch { fail('NETWORK'); }
  finally { if (!complete) { try { void reader.cancel().catch(() => {}); } catch {} } reader.releaseLock(); }
}
async function upstream(c, path, { body, method = 'POST', publicKey = false, authMutation = false, emailDelivery = false, timeoutMs = 12000 } = {}) {
  const controller = new AbortController(); let timer;
  const work = async () => {
    const key = publicKey ? c.pub : c.service;
    const response = await fetch(c.url + path, { method, redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status >= 300 && response.status < 400) { try { void response.body?.cancel().catch(() => {}); } catch {} fail('NETWORK'); }
    const data = await boundedJSON(response);
    if (!response.ok) {
      if (emailDelivery && response.status >= 400 && response.status < 500) fail('EMAIL_SEND_FAILED');
      if (authMutation && response.status >= 400 && response.status < 500) fail('RESET_FAILED');
      if (['PGRST202', 'PGRST204', '42P01', '42703', '42883'].includes(data.code) || [401, 403].includes(response.status)) fail('SETUP_REQUIRED');
      if (response.status === 429) fail('RATE_LIMITED');
      fail('NETWORK');
    }
    return data;
  };
  try { return await Promise.race([work(), new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RecoveryError('NETWORK')); }, timeoutMs); })]); }
  catch (error) { if (error instanceof RecoveryError) throw error; fail('NETWORK'); }
  finally { clearTimeout(timer); controller.abort(); }
}
async function rpc(c, suffix, body) {
  const data = await upstream(c, RPC_PREFIX + suffix, { body });
  if (data.ok !== true) {
    const code = ['RATE_LIMITED', 'INVALID_CODE', 'LOCKED', 'EXPIRED', 'REQUEST_REUSED', 'PROOF_CONSUMED'].includes(data.code) ? data.code : data.code === 'VALIDATION_ERROR' ? 'INVALID_REQUEST' : 'INVALID_CODE';
    fail(code, Number.isInteger(data.retryAfter) && data.retryAfter >= 0 && data.retryAfter <= 86400 ? data.retryAfter : undefined);
  }
  return data;
}
function schedule(context, work) {
  if (typeof context.waitUntil !== 'function') fail('SETUP_REQUIRED');
  // Do not start a chargeable side effect if platform scheduling itself fails.
  let start;
  const enabled = new Promise(resolve => { start = resolve; });
  const job = enabled.then(run => run ? work() : undefined).catch(() => {});
  try { context.waitUntil(job); } catch { start(false); fail('SETUP_REQUIRED'); }
  start(true);
}
async function sendSMS(c, challengeId, destination, code) {
  let status = 'unknown';
  try {
    const result = await solapi(c, 'messages/v4/send', { message: { to: destination, from: SENDER, type: 'SMS', text: `[S-NOTE] 계정 확인 인증번호: ${code} (5분 내 입력)` } });
    if (result.ok && String(result.data?.statusCode) === '2000' && /^[a-z0-9_-]{8,100}$/iu.test(result.data?.messageId || '')) status = 'sent';
    else if (result.status >= 400 && result.status < 500 || result.ok && /^\d{4}$/u.test(String(result.data?.statusCode)) && String(result.data.statusCode) !== '2000') status = 'failed';
  } catch { /* Sending is never retried after an uncertain provider response. */ }
  try { await rpc(c, 'delivery', { p_challenge_id: challengeId, p_status: status }); }
  catch { try { await rpc(c, 'delivery', { p_challenge_id: challengeId, p_status: 'unknown' }); } catch {} }
}
async function sendCode(context, c, b) {
  fields(b, ['action', 'purpose', 'name', 'phone', 'requestId']);
  const mode = purpose(b.purpose), displayName = name(b.name), destination = phone(b.phone), requestId = uuid(b.requestId);
  if (typeof context.waitUntil !== 'function') fail('SETUP_REQUIRED');
  const challenge = crypto.randomUUID(), code = randomCode();
  const [otpHash, phoneHash, ipHash] = await Promise.all([hmac(c, 'otp', mode, challenge, code), hmac(c, 'phone', destination), hmac(c, 'ip', clientIP(context.request))]);
  const data = await rpc(c, 'prepare', { p_request_id: requestId, p_challenge_id: challenge, p_purpose: mode, p_name: displayName, p_phone: destination,
    p_phone_hash: phoneHash, p_ip_hash: ipHash, p_otp_hash: otpHash });
  if (!UUID.test(data.challengeId || '') || typeof data.claimed !== 'boolean' || typeof data.canSend !== 'boolean' ||
      !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now() ||
      data.canSend && (data.phone !== destination || !PHONE.test(data.phone) || data.claimed && data.challengeId !== challenge)) fail('NETWORK');
  if (data.claimed && data.canSend) schedule(context, () => sendSMS(c, data.challengeId, data.phone, code));
  // Identical acknowledgement for unmatched, suppressed and eligible accounts.
  return { ok: true, challengeId: data.challengeId, expiresAt: data.expiresAt, retryAfter: 60 };
}
async function verify(context, c, b) {
  fields(b, ['action', 'purpose', 'challengeId', 'code']);
  const mode = purpose(b.purpose), challenge = uuid(b.challengeId);
  if (typeof b.code !== 'string' || !/^\d{6}$/u.test(b.code)) fail('INVALID_REQUEST');
  const otpHash = await hmac(c, 'otp', mode, challenge, b.code), token = await hmac(c, 'receipt', mode, challenge, otpHash), proof = await receiptHash(token);
  const data = await rpc(c, 'verify', { p_challenge_id: challenge, p_purpose: mode, p_otp_hash: otpHash, p_receipt_hash: proof, p_ip_hash: await hmac(c, 'ip', clientIP(context.request)) });
  if (data.challengeId !== challenge || !['phone', 'email'].includes(data.route) || !email(data.email) || typeof data.claimedEmail !== 'boolean') fail('NETWORK');
  if (data.route === 'email') {
    let status = data.emailStatus;
    if (!['pending', 'sent', 'failed', 'unknown'].includes(status) || data.claimedEmail && status !== 'pending') fail('NETWORK');
    if (data.claimedEmail) {
      let outcome = 'unknown';
      try {
        await upstream(c, '/auth/v1/recover?redirect_to=' + encodeURIComponent(RECOVERY_REDIRECT), { publicKey: true, body: { email: data.email }, emailDelivery: true, timeoutMs: 10000 });
        outcome = 'sent';
      } catch (error) { if (error.code === 'EMAIL_SEND_FAILED') outcome = 'failed'; }
      status = 'unknown';
      try { status = (await rpc(c, 'email_delivery', { p_challenge_id: challenge, p_receipt_hash: proof, p_status: outcome })).emailStatus; }
      catch {
        try { status = (await rpc(c, 'email_delivery', { p_challenge_id: challenge, p_receipt_hash: proof, p_status: 'unknown' })).emailStatus; } catch {}
      }
      if (!['sent', 'failed', 'unknown'].includes(status) || status === 'sent' && outcome !== 'sent') status = 'unknown';
    }
    if (status === 'sent') return { ok: true, requiresEmail: true, delivery: 'sent' };
    const error = new RecoveryError(status === 'pending' ? 'EMAIL_PENDING' : status === 'failed' ? 'EMAIL_SEND_FAILED' : 'EMAIL_SEND_UNKNOWN');
    error.requiresEmail = true; error.delivery = status; throw error;
  }
  if (mode === 'id') return { ok: true, email: data.email };
  if (!Number.isFinite(Date.parse(data.resetExpiresAt)) || Date.parse(data.resetExpiresAt) <= Date.now()) fail('NETWORK');
  return { ok: true, resetToken: token, expiresAt: data.resetExpiresAt };
}
async function resetPassword(c, b) {
  fields(b, ['action', 'challengeId', 'resetToken', 'password', 'requestId']);
  const challenge = uuid(b.challengeId), job = uuid(b.requestId), secret = password(b.password);
  if (typeof b.resetToken !== 'string' || !TOKEN.test(b.resetToken)) fail('INVALID_REQUEST');
  const proof = await receiptHash(b.resetToken), fingerprint = await hmac(c, 'password', challenge, job, proof, secret);
  const executor = await hmac(c, 'executor', challenge, job, proof, fingerprint);
  const args = { p_job_id: job, p_challenge_id: challenge, p_receipt_hash: proof, p_password_fingerprint: fingerprint, p_executor_hash: executor };
  const data = await rpc(c, 'reset_prepare', args);
  if (data.jobId !== job || typeof data.claimed !== 'boolean' || !['applying', 'applied', 'failed', 'unknown'].includes(data.state)) fail('NETWORK');
  if (!data.claimed) {
    if (data.state === 'applied') return { ok: true, status: 'completed', duplicate: true };
    fail(data.state === 'applying' ? 'RESET_PENDING' : data.state === 'failed' ? 'RESET_FAILED' : 'RESET_UNKNOWN');
  }
  if (data.state !== 'applying' || !UUID.test(data.userId || '') || !email(data.email) || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) fail('NETWORK');
  const finishArgs = { p_job_id: job, p_receipt_hash: proof, p_password_fingerprint: fingerprint, p_executor_hash: executor };
  let outcome = 'unknown';
  try {
    const user = await upstream(c, '/auth/v1/admin/users/' + data.userId, { method: 'PUT', body: { password: secret }, authMutation: true });
    if (user.id === data.userId) outcome = 'applied';
  } catch (error) { if (error.code === 'RESET_FAILED') outcome = 'failed'; }
  // Only a database finalization may confirm completion. Retrying this receipt
  // never issues another Admin PUT; its persistent job is a single-winner claim.
  let finalized;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { finalized = await rpc(c, 'reset_finalize', { ...finishArgs, p_outcome: outcome }); break; }
    catch { if (attempt === 1) fail('RESET_UNKNOWN'); }
  }
  if (finalized.jobId === job && finalized.state === 'applied' && outcome === 'applied') return { ok: true, status: 'completed' };
  fail(outcome === 'failed' ? 'RESET_FAILED' : 'RESET_UNKNOWN');
}

export async function onRequest(context) {
  try {
    const { request, env } = context;
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    if (!sameOriginRequest(request)) fail('FORBIDDEN');
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_REQUEST');
    let b; try { b = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBytes(request, 4096, { timeoutMs: 5000 }))); } catch { fail('INVALID_REQUEST'); }
    if (!object(b) || !['send-code', 'verify', 'reset-password'].includes(b.action)) fail('INVALID_REQUEST');
    const c = config(env);
    const result = b.action === 'send-code' ? await sendCode(context, c, b) : b.action === 'verify' ? await verify(context, c, b) : await resetPassword(c, b);
    return json(result);
  } catch (error) {
    const code = error instanceof RecoveryError && Object.hasOwn(ERRORS, error.code) ? error.code : 'NETWORK';
    const [status, message] = ERRORS[code], retryAfter = Number.isInteger(error?.retryAfter) && error.retryAfter >= 0 && error.retryAfter <= 86400 ? error.retryAfter : undefined;
    return json({ ok: false, code, error: message, ...(retryAfter === undefined ? {} : { retryAfter }),
      ...(error?.requiresEmail === true ? { requiresEmail: true, delivery: error.delivery } : {}) }, status, retryAfter);
  }
}
