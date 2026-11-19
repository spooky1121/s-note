import { inspectAPIRequest, hardenAPIResponse, readBoundedBytes } from '../_shared/api-security.js';
import { createBrowserSession } from '../_shared/encar-id-browser.mjs';
import { searchGloarLinks } from '../_shared/gloar-search.mjs';

// A read-only, authenticated test of one server-owned public search UI.
// Neither destinations nor browser code, cookies or headers come from callers.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
const MESSAGES = Object.freeze({
  AUTH_REQUIRED: '로그인이 필요합니다.', AUTH_FAILED: '로그인을 다시 확인해 주세요.',
  STAFF_REQUIRED: '현재 계정의 사용 권한을 확인해 주세요.', AUTH_UNAVAILABLE: '로그인 정보를 확인하지 못했습니다.',
  INVALID_REQUEST: '차량번호를 확인해 주세요.', LOOKUP_NOT_CONFIGURED: '검색 브라우저의 서버 설정을 확인해 주세요.',
  BROWSER_UNAVAILABLE: '검색 브라우저에 연결하지 못했습니다.', BROWSER_BUSY: '검색 브라우저가 사용 중입니다. 잠시 후 다시 시도해 주세요.',
  UPSTREAM_RATE_LIMITED: '검색 서비스가 요청을 제한했습니다. 잠시 후 다시 시도해 주세요.',
  PROVIDER_UNAVAILABLE: 'GLOAR DATA에 연결하지 못했습니다.', PROVIDER_UNSUPPORTED: 'GLOAR DATA 검색창을 확인하지 못했습니다.',
  PROVIDER_NAVIGATION_BLOCKED: 'GLOAR DATA 검색 화면을 확인하지 못했습니다.',
  PROVIDER_SEARCH_UNCONFIRMED: 'GLOAR DATA 검색 결과가 갱신됐는지 확인하지 못했습니다.',
  GLOAR_NAVIGATION_BLOCKED: 'GLOAR DATA 검색 화면을 확인하지 못했습니다.',
  GLOAR_ACCESS_BLOCKED: 'GLOAR DATA가 자동 접속을 제한하거나 추가 확인을 요구합니다.',
  GLOAR_SEARCH_UNSUPPORTED: 'GLOAR DATA의 상단 검색창을 확인하지 못했습니다.',
  GLOAR_RESULTS_UNCONFIRMED: 'GLOAR DATA 검색 결과가 갱신됐는지 확인하지 못했습니다.',
  GLOAR_UNAVAILABLE: 'GLOAR DATA 검색 중 연결이 중단됐습니다.',
  GLOAR_RESULT_UNVERIFIED: '검색 결과의 차량번호와 링크를 확인하지 못했습니다.',
  REQUEST_TIMEOUT: '검색 시간이 초과됐습니다. 다시 시도해 주세요.', REQUEST_ABORTED: '검색을 취소했습니다.'
});
const STATUSES = Object.freeze({ AUTH_REQUIRED: 401, AUTH_FAILED: 401, STAFF_REQUIRED: 403, AUTH_UNAVAILABLE: 502,
  INVALID_REQUEST: 400, LOOKUP_NOT_CONFIGURED: 503, BROWSER_UNAVAILABLE: 502, BROWSER_BUSY: 503,
  UPSTREAM_RATE_LIMITED: 429, REQUEST_TIMEOUT: 504, REQUEST_ABORTED: 408 });
const fail = (code, status) => Object.assign(new Error(code), { code, ...(status ? { status } : {}) });

function json(value, status = 200) {
  return hardenAPIResponse(new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Snote-Release': '2.148' } }));
}
function errorResponse(code, status, retryAfter) {
  const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'PROVIDER_UNAVAILABLE';
  const response = json({ ok: false, status: 'error', code: safeCode, error: MESSAGES[safeCode] }, status || STATUSES[safeCode] || 502);
  if (safeCode === 'UPSTREAM_RATE_LIMITED' || safeCode === 'BROWSER_BUSY') {
    response.headers.set('Retry-After', String(Number.isInteger(retryAfter) ? Math.max(1, Math.min(3600, retryAfter)) : 20));
  }
  return response;
}
function scopeFor(parent, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(fail('REQUEST_TIMEOUT')), timeoutMs);
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}
async function interruptible(signal, operation) {
  if (signal.aborted) throw fail('REQUEST_ABORTED');
  let abort;
  const interrupted = new Promise((resolve, reject) => {
    abort = () => reject(fail('REQUEST_ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw fail('REQUEST_ABORTED');
      return operation();
    }), interrupted]);
  } finally { signal.removeEventListener('abort', abort); }
}
function configured(env) {
  const account = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
  const token = typeof env.CLOUDFLARE_BROWSER_TOKEN === 'string' ? env.CLOUDFLARE_BROWSER_TOKEN.trim() : '';
  return /^[a-f0-9]{32}$/i.test(account) && token.length > 0 && token.length <= 4096 && !/[^\x21-\x7e]/u.test(token);
}
async function authJson(url, headers, signal) {
  const scope = scopeFor(signal, 5000);
  try {
    return await interruptible(scope.signal, async () => {
      const response = await fetch(url, { method: 'GET', headers, signal: scope.signal, redirect: 'manual', cache: 'no-store' });
      if (!response.ok) {
        try { void response.body?.cancel().catch(() => {}); } catch {}
        throw fail(response.status === 401 ? 'AUTH_FAILED' : 'AUTH_UNAVAILABLE');
      }
      const bytes = await readBoundedBytes(response, 65536, { timeoutMs: 5000 });
      return JSON.parse(new TextDecoder().decode(bytes));
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error?.code === 'AUTH_FAILED') throw error;
    throw fail('AUTH_UNAVAILABLE');
  } finally { scope.dispose(); }
}
async function authorize(request, env, signal) {
  const origin = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim().replace(/\/$/u, '') : '';
  const key = typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' ? env.SUPABASE_PUBLISHABLE_KEY.trim() : '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(origin) || !key || key.length > 8192) throw fail('AUTH_UNAVAILABLE', 503);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/iu.test(authorization)) throw fail('AUTH_REQUIRED');
  const headers = { apikey: key, Authorization: authorization };
  const user = await authJson(origin + '/auth/v1/user', headers, signal);
  if (!UUID.test(user?.id || '') || user.is_anonymous === true) throw fail('AUTH_FAILED');
  const url = new URL(origin + '/rest/v1/zc_members');
  url.searchParams.set('select', 'user_id,company_id,role,active');
  url.searchParams.set('user_id', 'eq.' + user.id);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('limit', '1');
  const rows = await authJson(url.href, headers, signal);
  if (!Array.isArray(rows) || !rows.some(row => row?.user_id === user.id && UUID.test(row.company_id || '') &&
      row.active === true && ['admin', 'dealer', 'accountant'].includes(row.role))) throw fail('STAFF_REQUIRED');
}
function verifiedLinks(value) {
  if (!Array.isArray(value) || value.length > 20) return [];
  const links = [], seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string') continue;
    const raw = item.url;
    if (raw.length > 2048 || raw !== raw.trim() || /[\u0000-\u0020\u007f\\]/u.test(raw)) continue;
    const authority = /^https:\/\/([^/?#]+)/iu.exec(raw)?.[1];
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'gloar-data.com' || authority?.toLowerCase() !== 'gloar-data.com' ||
        url.username || url.password || url.port || url.hash || !/^\/en\/lot\/[A-Za-z0-9_-]{1,512}\/?$/u.test(url.pathname)) continue;
    url.search = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const title = typeof item.title === 'string' ? item.title.replace(/[\u0000-\u001f\u007f<>]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 160) : '';
    links.push({ url: url.href, title: title || 'GLOAR DATA 차량 상세' });
    if (links.length === 5) break;
  }
  return links;
}

export function createGloarSearchHandler({ createBrowser = createBrowserSession, search = searchGloarLinks, timeoutMs = 50000 } = {}) {
  return async function onRequest(context) {
    const { request, env = {} } = context;
    const checked = inspectAPIRequest(request);
    if (checked.response) return checked.response;
    if (request.method === 'GET') return json({ ok: true, configured: configured(env), provider: 'gloar', release: '2.148' });
    const scope = scopeFor(request.signal, Number.isInteger(timeoutMs) ? Math.max(1, Math.min(50000, timeoutMs)) : 50000);
    let browser;
    const released = new WeakSet();
    const release = async value => {
      if (!value || !['object', 'function'].includes(typeof value) || released.has(value) || typeof value.close !== 'function') return;
      released.add(value);
      let timer;
      try { await Promise.race([Promise.resolve().then(() => value.close()), new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); }
      catch {} finally { clearTimeout(timer); }
    };
    try {
      const bytes = await interruptible(scope.signal, () => readBoundedBytes(request, 1024, { timeoutMs: 5000 }));
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail('INVALID_REQUEST'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
          typeof body.plate !== 'string' || body.plate.length > 40) throw fail('INVALID_REQUEST');
      const plate = body.plate.normalize('NFKC').replace(/[\s-]+/gu, '');
      if (!PLATE.test(plate)) throw fail('INVALID_REQUEST');
      await interruptible(scope.signal, () => authorize(request, env, scope.signal));
      const opening = Promise.resolve().then(() => {
        if (scope.signal.aborted) throw fail('REQUEST_ABORTED');
        return createBrowser(env, { signal: scope.signal,
          waitUntil: typeof context.waitUntil === 'function' ? promise => context.waitUntil(promise) : undefined });
      });
      void opening.then(value => { if (scope.signal.aborted) void release(value); }).catch(() => {});
      browser = await interruptible(scope.signal, () => opening);
      if (!browser || typeof browser.newPage !== 'function') throw fail('BROWSER_UNAVAILABLE');
      const result = await interruptible(scope.signal, () => search({ plate, signal: scope.signal, browser }));
      if (result?.status === 'not_found') return json({ ok: true, status: 'not_found', plate, links: [] });
      if (result?.status === 'found') {
        if (result.plate !== plate) throw fail('GLOAR_RESULT_UNVERIFIED');
        const links = verifiedLinks(result.links);
        if (!links.length) throw fail('GLOAR_RESULT_UNVERIFIED');
        return json({ ok: true, status: 'found', plate, links });
      }
      return errorResponse(result?.code, undefined, result?.retryAfter);
    } catch (error) {
      if (scope.signal.aborted) return errorResponse(request.signal.aborted ? 'REQUEST_ABORTED' : 'REQUEST_TIMEOUT');
      if (error?.code === 'PAYLOAD_TOO_LARGE') return errorResponse('INVALID_REQUEST', 413);
      return errorResponse(error?.code, Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined, error?.retryAfter);
    } finally { await release(browser); scope.dispose(); }
  };
}

export const onRequest = createGloarSearchHandler();
