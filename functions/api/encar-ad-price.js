import { createEncarRequestDiagnostics, createEncarPendingLookup, encarLookupScopeKey } from '../_shared/encar-request-state.mjs';
import { inspectAPIRequest, hardenAPIResponse, readBoundedBytes } from '../_shared/api-security.js';
import { readEncarAdvertisementPrice } from '../_shared/encar-ad-price.mjs';

// A read-only, authenticated quote for a known ID. Discovery is still exclusively
// /api/encar-id; updating a vehicle remains an explicit RLS-protected user action.
const RELEASE = '2.159';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]{5,11}$/;
const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
const MESSAGES = {
  AUTH_REQUIRED: '로그인이 필요합니다.', AUTH_FAILED: '로그인을 다시 확인해 주세요.',
  STAFF_REQUIRED: '현재 계정의 사용 권한을 확인해 주세요.', AUTH_UNAVAILABLE: '로그인 정보를 확인하지 못했습니다.',
  INVALID_REQUEST: '엔카 광고 ID와 차량번호를 확인해 주세요.',
  LOOKUP_NOT_CONFIGURED: '엔카 광고 금액 조회 서버 설정을 확인해 주세요.',
  BROWSER_UNAVAILABLE: 'Cloudflare 광고 브라우저에 연결하지 못했습니다.',
  BROWSER_AUTH_FAILED: 'Cloudflare 광고 브라우저 인증 설정을 확인해 주세요.',
  BROWSER_BUSY: '다른 광고 조회가 진행 중입니다. 잠시 후 다시 확인해 주세요.',
  UPSTREAM_RATE_LIMITED: 'Cloudflare 광고 브라우저가 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',
  BROWSER_DAILY_LIMIT: 'Cloudflare 광고 브라우저의 하루 사용 한도에 도달했습니다.',
  ENCAR_RATE_LIMITED: '엔카에서 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',
  ENCAR_ACCESS_BLOCKED: '엔카에서 광고 금액 조회를 제한하고 있습니다.',
  ENCAR_VEHICLE_MISMATCH: '광고의 차량번호가 현재 차량과 달라 금액을 적용하지 않았습니다.',
  ENCAR_NOT_ADVERTISING: '판매 종료된 광고여서 금액을 적용하지 않았습니다.',
  ENCAR_STATUS_UNVERIFIED: '현재 광고 상태를 확인하지 못했습니다.',
  ENCAR_LOCATION_UNVERIFIED: '엔카 광고 페이지의 주소를 확인하지 못했습니다.',
  ENCAR_PRICE_AMBIGUOUS: '광고 금액이 여러 개여서 판매가를 확정하지 못했습니다.',
  ENCAR_PRICE_UNVERIFIED: '광고 금액을 정확하게 확인하지 못했습니다.',
  ENCAR_PRICE_UNAVAILABLE: '엔카 광고 금액을 확인하지 못했습니다. 저장된 링크는 열 수 있습니다.',
  REQUEST_TIMEOUT: '엔카 광고 금액 확인 시간이 초과됐습니다.',
  REQUEST_ABORTED: '엔카 광고 금액 확인을 취소했습니다.'
};
const STATUS = { AUTH_REQUIRED: 401, AUTH_FAILED: 401, STAFF_REQUIRED: 403, AUTH_UNAVAILABLE: 502, INVALID_REQUEST: 400, LOOKUP_NOT_CONFIGURED: 503, BROWSER_BUSY: 503, UPSTREAM_RATE_LIMITED: 429, BROWSER_DAILY_LIMIT: 429, ENCAR_RATE_LIMITED: 429, REQUEST_TIMEOUT: 504, REQUEST_ABORTED: 408 };
const failure = (code, status) => Object.assign(new Error(code), { code, status });
function json(value, status = 200) {
  return hardenAPIResponse(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Snote-Release': RELEASE } }));
}
function error(code, status = STATUS[code] || 502, retryAfter) {
  const response = json({ ok: false, code, error: MESSAGES[code] }, status);
  if (['UPSTREAM_RATE_LIMITED', 'BROWSER_DAILY_LIMIT', 'BROWSER_BUSY', 'ENCAR_RATE_LIMITED'].includes(code)) response.headers.set('Retry-After', String(Number.isInteger(retryAfter) ? Math.max(1, Math.min(code === 'BROWSER_DAILY_LIMIT' ? 86400 : 3600, retryAfter)) : 20));
  return response;
}
function abortScope(parent, milliseconds) {
  const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true }); if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(failure('REQUEST_TIMEOUT', 504)), milliseconds);
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}
async function boundedJson(url, headers, signal) {
  const scope = abortScope(signal, 5000);
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: scope.signal, redirect: 'manual', cache: 'no-store' });
    if (!response.ok) throw failure(response.status === 401 ? 'AUTH_FAILED' : 'AUTH_UNAVAILABLE', response.status === 401 ? 401 : 502);
    const bytes = await readBoundedBytes(response, 65536, { timeoutMs: 5000 }); return JSON.parse(new TextDecoder().decode(bytes));
  } catch (caught) {
    if (signal.aborted || ['AUTH_FAILED', 'AUTH_UNAVAILABLE'].includes(caught?.code)) throw caught;
    throw failure('AUTH_UNAVAILABLE', 502);
  } finally { scope.dispose(); }
}
async function authorize(request, env, signal, diagnostic) {
  const origin = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim().replace(/\/$/u, '') : '';
  const key = typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' ? env.SUPABASE_PUBLISHABLE_KEY.trim() : '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(origin) || !key || key.length > 8192) throw failure('AUTH_UNAVAILABLE', 503);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/iu.test(authorization)) throw failure('AUTH_REQUIRED', 401);
  const headers = { apikey: key, Authorization: authorization }, user = await boundedJson(origin + '/auth/v1/user', headers, signal);
  if (!UUID.test(user?.id || '') || user.is_anonymous === true) throw failure('AUTH_FAILED', 401);
  diagnostic.stage('membership');
  const url = new URL(origin + '/rest/v1/zc_members'); url.searchParams.set('select', 'user_id,company_id,role,active'); url.searchParams.set('user_id', 'eq.' + user.id); url.searchParams.set('active', 'eq.true'); url.searchParams.set('limit', '1');
  const rows = await boundedJson(url.href, headers, signal);
  const member = Array.isArray(rows) && rows.find(row => row.user_id === user.id && UUID.test(row.company_id || '') && row.active === true && ['admin', 'dealer', 'accountant'].includes(row.role));
  if (!member) throw failure('STAFF_REQUIRED', 403);
  return { userId: user.id, companyId: member.company_id, role: member.role };
}
function verified(result, id, plate) {
  const time = typeof result?.checkedAt === 'string' ? Date.parse(result.checkedAt) : NaN;
  return result?.id === id && result?.plate === plate && result?.source === 'encar' && Number.isSafeInteger(result?.priceWon) && result.priceWon > 0 && result.priceWon <= 1000000000000 && Number.isFinite(time) && result.checkedAt.length <= 32 && time <= Date.now() + 60000 && time >= Date.now() - 120000;
}
export function createEncarAdPriceHandler({ lookup = readEncarAdvertisementPrice, logger, now } = {}) {
  const join = createEncarPendingLookup({ timeoutMs: 35000 });
  return async function onRequest(context) {
    const { request, env = {} } = context, diagnostic = createEncarRequestDiagnostics({ logger, now });
    const finish = response => diagnostic.finish(response);
    const checked = inspectAPIRequest(request); if (checked.response) return finish(checked.response);
    const scope = abortScope(request.signal, 35000);
    try {
      const bytes = await readBoundedBytes(request, 2048, { timeoutMs: 5000 }); let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw failure('INVALID_REQUEST', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 || typeof body.id !== 'string' || !ID.test(body.id) || typeof body.plate !== 'string' || body.plate.length > 40) throw failure('INVALID_REQUEST', 400);
      const plate = body.plate.normalize('NFKC').replace(/[\s-]+/gu, ''); if (!PLATE.test(plate)) throw failure('INVALID_REQUEST', 400);
      diagnostic.stage('auth'); const actor = await authorize(request, env, scope.signal, diagnostic);
      if (scope.signal.aborted) throw failure('REQUEST_ABORTED', 408);
      diagnostic.stage('lookup');
      const key = await encarLookupScopeKey({ actor, env, parameters: { id: body.id, plate } }), waitUntil = typeof context.waitUntil === 'function' ? promise => context.waitUntil(promise) : undefined;
      const result = await join({ key, signal: scope.signal, waitUntil, operation: signal => lookup({ id: body.id, plate, env, signal, waitUntil }) });
      diagnostic.stage('verification');
      if (scope.signal.aborted) throw failure('REQUEST_ABORTED', 408);
      if (!verified(result, body.id, plate)) return finish(error('ENCAR_PRICE_UNVERIFIED'));
      diagnostic.stage('complete');
      return finish(json({ ok: true, id: body.id, plate, priceWon: result.priceWon, checkedAt: result.checkedAt, source: 'encar' }));
    } catch (caught) {
      if (scope.signal.aborted) return finish(error(request.signal.aborted ? 'REQUEST_ABORTED' : 'REQUEST_TIMEOUT'));
      if (caught?.code === 'PAYLOAD_TOO_LARGE') return finish(error('INVALID_REQUEST', 413));
      const code = Object.hasOwn(MESSAGES, caught?.code) ? caught.code : 'ENCAR_PRICE_UNAVAILABLE';
      return finish(error(code, caught?.status === 503 ? 503 : STATUS[code] || 502, caught?.retryAfter));
    } finally { scope.dispose(); }
  };
}
export const onRequest = createEncarAdPriceHandler();
