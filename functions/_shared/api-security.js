// Defense in depth for Pages APIs. These isolate-local counters are a bounded
// burst brake, NOT a distributed quota or a replacement for Cloudflare WAF.
export const API_POLICIES = Object.freeze({
  '/api/weather': { methods: ['GET'], limit: 60, maximum: 0 },
  '/api/ocr': { methods: ['GET', 'POST'], limit: 30, maximum: 6 * 1024 * 1024, image: true },
  '/api/encar': { methods: ['POST'], limit: 60, maximum: 4096 },
  '/api/customer-intake': { methods: ['GET', 'POST'], limit: 120, maximum: 64 * 1024, publicPost: true },
  '/api/customer-identity': { methods: ['GET', 'POST'], limit: 240, maximum: 32 * 1024 },
  '/api/income-settlement': { methods: ['GET', 'POST'], limit: 240, maximum: 64 * 1024 },
  '/api/profile-phone': { methods: ['POST'], limit: 60, maximum: 4096 },
  '/api/document-mms': { methods: ['POST'], limit: 60, maximum: 300000 },
  '/api/operator': { methods: ['POST'], limit: 240, maximum: 1024 * 1024 },
  '/api/vehicle-taxonomy-probe': { methods: ['GET', 'POST'], limit: 30, maximum: 2048, authenticatedGet: true }
});
const MESSAGES = {
  FORBIDDEN: [403, '허용되지 않은 요청입니다. S-NOTE에서 다시 시도해 주세요.'],
  UNAUTHORIZED: [401, '로그인이 필요합니다. 다시 로그인해 주세요.'],
  NOT_FOUND: [404, '요청한 API를 찾을 수 없습니다.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  INVALID_REQUEST: [400, '요청 형식을 확인해 주세요.'],
  PAYLOAD_TOO_LARGE: [413, '요청 크기가 허용 범위를 초과했습니다.'],
  UNSUPPORTED_MEDIA_TYPE: [415, '지원하지 않는 요청 형식입니다.'],
  REQUEST_TIMEOUT: [408, '요청 전송 시간이 초과되었습니다. 다시 시도해 주세요.'],
  RATE_LIMITED: [429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.'],
  UPSTREAM_ERROR: [502, '서버 응답을 확인하지 못했습니다. 처리 내역을 먼저 확인해 주세요.']
};
export class RequestSecurityError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function securityResponse(code, extraHeaders = {}) {
  const [status, error] = MESSAGES[code] || MESSAGES.UPSTREAM_ERROR;
  return hardenAPIResponse(new Response(JSON.stringify({ ok: false, code, error }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  }));
}
export function hardenAPIResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, private, max-age=0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export function sameOriginRequest(request) {
  const origin = request.headers.get('Origin');
  return (origin === null || origin === new URL(request.url).origin) &&
    !['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'));
}
export function inspectAPIRequest(request) {
  const url = new URL(request.url), policy = API_POLICIES[url.pathname];
  if (!policy) return { response: securityResponse('NOT_FOUND') };
  if (!sameOriginRequest(request)) return { response: securityResponse('FORBIDDEN') };
  if (!policy.methods.includes(request.method)) return { response: securityResponse('METHOD_NOT_ALLOWED', { Allow: policy.methods.join(', ') }) };
  if (request.url.length > 4096) return { response: securityResponse('INVALID_REQUEST') };
  if ((request.method === 'POST' && !policy.publicPost) || policy.authenticatedGet) {
    // Syntax only. Downstream still verifies with Auth, live membership and RLS.
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(request.headers.get('Authorization') || '') ||
        (request.headers.get('Authorization') || '').length > 8200) return { response: securityResponse('UNAUTHORIZED') };
  }
  if (request.method === 'POST') {
    const length = request.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > policy.maximum)) return { response: securityResponse('PAYLOAD_TOO_LARGE') };
    if (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding') !== 'identity') return { response: securityResponse('UNSUPPORTED_MEDIA_TYPE') };
    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!(policy.image ? ['image/jpeg', 'image/png', 'image/webp'].includes(type) : type === 'application/json')) return { response: securityResponse('UNSUPPORTED_MEDIA_TYPE') };
  }
  return { policy, path: url.pathname };
}
export function createBurstLimiter({ maxEntries = 4096, windowMs = 60000, now = Date.now } = {}) {
  const entries = new Map(); let nextSweep = 0;
  return function limit(request, path, policy) {
    // This header is supplied/overwritten by Cloudflare on the public edge.
    // Do not use client-controlled Authorization, query strings or X-Forwarded-For.
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) return null;
    const current = now();
    if (current >= nextSweep) {
      for (const [key, entry] of entries) if (entry.expires <= current) entries.delete(key);
      nextSweep = current + 1000;
    }
    const key = ip + ':' + path; let entry = entries.get(key);
    if (!entry || entry.expires <= current) {
      // A full tracking table must not lock unrelated clients out. Eviction
      // keeps memory bounded; distributed/rotating clients require edge quotas.
      if (entries.size >= maxEntries && !entry) entries.delete(entries.keys().next().value);
      entry = { count: 0, expires: current + windowMs }; entries.set(key, entry);
    }
    if (++entry.count > policy.limit) return securityResponse('RATE_LIMITED', { 'Retry-After': String(Math.max(1, Math.ceil((entry.expires - current) / 1000))) });
    return null;
  };
}
export async function readBoundedBytes(message, maximum, { timeoutMs = 10000 } = {}) {
  const length = message.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new RequestSecurityError('PAYLOAD_TOO_LARGE');
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader(), chunks = []; let size = 0, timer;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(new RequestSecurityError('REQUEST_TIMEOUT')); cancel(); }, timeoutMs); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { cancel(); throw new RequestSecurityError('PAYLOAD_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
