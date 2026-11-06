// Read-only, administrator-only sample. No taxonomy, vehicle or customer row is written.
const PROVIDER = 'encar-api.com';
const PROVIDER_BASE = 'https://api.encar-api.com/api';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BRANDS = Object.freeze([{ value: 'Hyundai', label: '현대' }, { value: 'Kia', label: '기아' }, { value: 'BMW', label: 'BMW' }, { value: 'Mercedes-Benz', label: '벤츠' }]);
const CACHE_SECONDS = 300;
const ERRORS = {
  UNAUTHORIZED: [401, '온라인 계정으로 다시 로그인해 주세요.'],
  FORBIDDEN: [403, '현재 상사의 관리자만 차종 API를 확인할 수 있습니다.'],
  INVALID_REQUEST: [400, '조회할 제조사를 확인해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  SETUP_REQUIRED: [503, '서버 인증 설정을 확인해 주세요.'],
  AUTH_UNAVAILABLE: [503, '관리자 인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
  API_KEY_MISSING: [503, 'Cloudflare Production에 ENCAR_API_KEY를 암호화해 등록한 뒤 다시 배포해 주세요.'],
  API_KEY_INVALID: [503, '등록한 차종 API 키 형식을 확인해 주세요.'],
  API_KEY_REJECTED: [502, '공급자가 API 키를 승인하지 않았습니다. 등록한 키와 이용 상태를 확인해 주세요.'],
  UPSTREAM_FORBIDDEN: [502, '공급자가 접근을 거절했습니다. 키 권한과 접근 정책을 확인해 주세요.'],
  UPSTREAM_RATE_LIMITED: [429, '차종 API 호출 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도해 주세요.'],
  UPSTREAM_UNAVAILABLE: [503, '차종 API가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.'],
  UPSTREAM_NOT_FOUND: [404, '선택한 매물은 현재 공급자에서 조회할 수 없습니다.'],
  UPSTREAM_INVALID: [502, '차종 API 응답 형식을 확인하지 못했습니다.'],
  UPSTREAM_REDIRECT: [502, '차종 API 연결 주소를 확인하지 못했습니다.'],
  UPSTREAM_TIMEOUT: [504, '차종 API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.']
};
const CONTAINERS = new Set(['data', 'result', 'results', 'car', 'vehicle', 'details', 'category', 'classification', 'listing', 'item', 'payload', 'en', 'de']);
const CLASS_FIELDS = new Set(['manufacturer', 'manufacturername', 'manufacturerid', 'manufacturercode', 'brand', 'brandname', 'brandid', 'brandcode', 'modelgroup', 'modelgroupname', 'modelgroupid', 'modelgroupcode', 'model', 'modelname', 'modelid', 'modelcode', 'generation', 'generationname', 'generationid', 'generationcode', 'badge', 'badgename', 'badgeid', 'badgecode', 'badgedetail', 'badgedetailname', 'badgedetailid', 'badgedetailcode', 'grade', 'gradename', 'gradeid', 'gradecode', 'gradedetail', 'gradedetailname', 'gradedetailid', 'gradedetailcode', 'subgrade', 'subgradename', 'subgradeid', 'subgradecode', 'trim', 'trimname', 'trimid', 'trimcode', 'subtrim', 'subtrimname', 'subtrimid', 'subtrimcode']);
for (const root of ['manufacturer','brand','modelgroup','modelgrp','model','generation','badge','badgedetail','grade','gradedetail','subgrade','trim','subtrim']) for (const suffix of ['', 'id', 'code', 'cd', 'name', 'nm']) CLASS_FIELDS.add(root + suffix);
const LABEL_FIELDS = new Set(['id', 'code', 'cd', 'name', 'nm', 'label', 'value', 'text']);
const DETAIL_STATUSES = new Set(['checked', 'skipped_no_listing', 'skipped_quota', 'unavailable']);
const inflight = new Map();
class ProbeError extends Error {
  constructor(code, retryAfter) { super(code); this.code = code; this.retryAfter = retryAfter; }
}
const fail = (code, retryAfter) => { throw new ProbeError(code, retryAfter); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const norm = value => value.toLowerCase().replace(/[_-]/g, '');
function json(data, status = 200, retryAfter) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private, max-age=0',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
    ...(status === 405 ? { Allow: 'GET, POST' } : {}), ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) })
  } });
}
function identifier(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_REQUEST'); return value.toLowerCase(); }
function settings(env) {
  let url; try { url = new URL(env?.SUPABASE_URL); } catch { fail('SETUP_REQUIRED'); }
  const pub = typeof env?.SUPABASE_PUBLISHABLE_KEY === 'string' ? env.SUPABASE_PUBLISHABLE_KEY.trim() : '';
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !pub || /[\r\n]/.test(pub)) fail('SETUP_REQUIRED');
  const key = typeof env?.ENCAR_API_KEY === 'string' ? env.ENCAR_API_KEY.trim() : '';
  const validKey = key.length >= 8 && key.length <= 1024 && /^[\x21-\x7e]+$/.test(key);
  return { url: url.origin, pub, key, configured: validKey };
}
function operation(request) {
  const controller = new AbortController(), deadline = Date.now() + 26000;
  const timer = setTimeout(() => controller.abort(), 26000);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true }); if (request.signal.aborted) abort();
  return { controller, deadline, providerRequestCount: 0, finish() { clearTimeout(timer); request.signal.removeEventListener('abort', abort); } };
}
function abortable(promise, signal, code) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ProbeError(code));
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function cancel(response) { try { void response.body?.cancel().catch(() => {}); } catch {} }
async function limitedJSON(response, maximum, signal, code) {
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) { cancel(response); fail(code); }
  const reader = response.body?.getReader(); if (!reader) fail(code);
  try {
    const chunks = []; let total = 0;
    while (true) {
      const result = await abortable(reader.read(), signal, code); if (result.done) break;
      total += result.value.byteLength; if (total > maximum) { void reader.cancel().catch(() => {}); fail(code); } chunks.push(result.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(code); }
  } catch (error) { try { void reader.cancel().catch(() => {}); } catch {} throw error; }
}
function integer(value, maximum = 1000000000000000) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}
function safeInteger(value, key) { const result = integer(value); return result !== null && String(result).includes(key) ? null : result; }
function limits(headers, key) {
  return { limit: safeInteger(headers.get('X-RateLimit-Limit'), key), remaining: safeInteger(headers.get('X-RateLimit-Remaining'), key), reset: safeInteger(headers.get('X-RateLimit-Reset'), key) };
}
async function fetchJSON(op, url, options, provider = false) {
  const remaining = op.deadline - Date.now(); if (remaining <= 0 || op.controller.signal.aborted) fail(provider ? 'UPSTREAM_TIMEOUT' : 'AUTH_UNAVAILABLE');
  if (provider) { if (op.providerRequestCount >= 2) fail('UPSTREAM_INVALID'); op.providerRequestCount++; }
  const controller = new AbortController(), abort = () => controller.abort();
  op.controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.min(provider ? 10000 : 8000, remaining));
  try {
    const response = await abortable(fetch(url, { ...options, redirect: 'manual', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal }), controller.signal, provider ? 'UPSTREAM_TIMEOUT' : 'AUTH_UNAVAILABLE');
    if (response.status >= 300 && response.status < 400) { cancel(response); fail(provider ? 'UPSTREAM_REDIRECT' : 'AUTH_UNAVAILABLE'); }
    const rateLimit = provider ? limits(response.headers, options.headers['x-api-key']) : null;
    if (!response.ok) {
      cancel(response);
      if (!provider) { if (response.status === 401) fail('UNAUTHORIZED'); if (response.status === 403) fail('FORBIDDEN'); fail('AUTH_UNAVAILABLE'); }
      if (response.status === 401) fail('API_KEY_REJECTED');
      if (response.status === 403) fail('UPSTREAM_FORBIDDEN');
      if (response.status === 429) fail('UPSTREAM_RATE_LIMITED', integer(response.headers.get('Retry-After'), 86400) ?? 60);
      if (response.status === 404) fail(url.startsWith(PROVIDER_BASE + '/car?') ? 'UPSTREAM_NOT_FOUND' : 'UPSTREAM_UNAVAILABLE');
      fail('UPSTREAM_UNAVAILABLE');
    }
    return { data: await limitedJSON(response, provider ? 1048576 : 65536, controller.signal, provider ? 'UPSTREAM_INVALID' : 'AUTH_UNAVAILABLE'), rateLimit };
  } catch (error) { if (controller.signal.aborted) fail(provider ? 'UPSTREAM_TIMEOUT' : 'AUTH_UNAVAILABLE'); if (error instanceof ProbeError) throw error; fail(provider ? 'UPSTREAM_UNAVAILABLE' : 'AUTH_UNAVAILABLE'); }
  finally { clearTimeout(timer); op.controller.signal.removeEventListener('abort', abort); }
}
async function authorize(op, config, jwt, company) {
  const headers = { apikey: config.pub, Authorization: 'Bearer ' + jwt, Accept: 'application/json' };
  const { data: user } = await fetchJSON(op, config.url + '/auth/v1/user', { headers });
  if (!object(user) || !UUID.test(user.id || '') || user.is_anonymous === true) fail('UNAUTHORIZED');
  if (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now())) fail('FORBIDDEN');
  const actor = user.id.toLowerCase();
  const query = new URLSearchParams({ select: 'user_id,company_id,role,active', user_id: 'eq.' + actor, active: 'eq.true', limit: '2' });
  const { data: members } = await fetchJSON(op, config.url + '/rest/v1/zc_members?' + query, { headers });
  if (!Array.isArray(members) || members.length !== 1) fail('FORBIDDEN'); const member = members[0];
  if (member.user_id !== actor || member.company_id !== company || member.role !== 'admin' || member.active !== true) fail('FORBIDDEN');
}
async function readRequest(request, op) {
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') fail('INVALID_REQUEST');
  return limitedJSON(request, 2048, op.controller.signal, 'INVALID_REQUEST');
}
function own(value, names) {
  if (!object(value)) return undefined;
  for (const key of Object.keys(value).slice(0, 200)) if (names.includes(norm(key))) return value[key];
}
function safeText(value, key, maximum = 160) {
  if (typeof value !== 'string') return null;
  const text = value.trim().normalize('NFC').replace(/\s+/g, ' ');
  if (!text || text.length > maximum || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(text) || text.includes(key) || /avg_(?:free_)?[a-z0-9_-]{8,}/i.test(text)) return null;
  return text;
}
function label(value, key) {
  if (object(value)) value = own(value, ['name', 'nm', 'label', 'text', 'value']);
  return safeText(value, key);
}
function listingId(value) { if (typeof value === 'number' && !Number.isSafeInteger(value)) return null; return /^(?:[1-9][0-9]{0,11})$/.test(String(value)) ? String(value) : null; }
function sample(row, key, depth = 0) {
  if (!object(row)) return null;
  const rawId = listingId(own(row, ['id', 'listingid', 'vehicleid'])), id = rawId && safeText(rawId, key, 12);
  const manufacturer = label(own(row, ['manufacturer', 'manufacturername', 'manufacturernm', 'brand', 'brandname', 'brandnm']), key), model = label(own(row, ['model', 'modelname', 'modelnm']), key);
  if (!id || !manufacturer || !model) {
    if (depth < 3) for (const name of Object.keys(row).slice(0, 100)) if (['data','result','car','vehicle','listing','item','payload'].includes(norm(name))) { const found = sample(row[name], key, depth + 1); if (found) return found; }
    return null;
  }
  return { listingId: id, manufacturer, modelGroup: label(own(row, ['modelgroup', 'modelgroupname', 'modelgroupnm', 'modelgrp', 'modelgrpname', 'modelgrpnm']), key), model, badge: label(own(row, ['badge', 'badgename', 'badgenm']), key) };
}
function listingRows(data, depth = 0) {
  if (Array.isArray(data)) return data; if (!object(data) || depth > 3) return null;
  for (const key of Object.keys(data).slice(0, 100)) if (['results', 'cars', 'listings', 'vehicles', 'items', 'data', 'result', 'payload'].includes(norm(key))) {
    const found = listingRows(data[key], depth + 1); if (found !== null) return found;
  }
  return null;
}
function samples(data, key) {
  const rows = listingRows(data); if (!rows || rows.length > 500) fail('UPSTREAM_INVALID');
  const result = [], seen = new Set();
  for (const row of rows) {
    const item = sample(row, key); if (!item || seen.has(item.listingId)) continue;
    seen.add(item.listingId); result.push(item); if (result.length === 3) break;
  }
  if (rows.length && !result.length) fail('UPSTREAM_INVALID'); return result;
}
function detailListingId(data, depth = 0) {
  if (!object(data) || depth > 3) return null;
  const id = listingId(own(data, ['id', 'listingid', 'vehicleid'])); if (id) return id;
  for (const name of Object.keys(data).slice(0, 100)) if (['data', 'result', 'car', 'vehicle', 'listing', 'item', 'payload'].includes(norm(name))) { const found = detailListingId(data[name], depth + 1); if (found) return found; }
  return null;
}
function detailHints(data, key) {
  const result = [], seen = new Set(); let nodes = 0;
  function walk(value, path = [], selected = false, depth = 0) {
    if (!object(value) || depth > 7 || nodes++ > 200 || result.length >= 60) return;
    for (const name of Object.keys(value).slice(0, 100)) {
      if (result.length >= 60) break;
      const normalized = norm(name), classification = CLASS_FIELDS.has(normalized), inherited = selected && LABEL_FIELDS.has(normalized);
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(name) || !classification && !inherited && !CONTAINERS.has(normalized)) continue;
      const next = [...path, name], item = value[name];
      if (object(item)) { walk(item, next, classification || inherited, depth + 1); continue; }
      if (!classification && !inherited) continue;
      const scalar = safeText(typeof item === 'number' && Number.isFinite(item) ? String(item) : item, key);
      if (!scalar || scalar.length > 160) continue;
      const namePath = next.join('.'); if (seen.has(namePath)) continue;
      seen.add(namePath); result.push({ path: namePath, value: scalar });
    }
  }
  walk(data); return result;
}
function schema(result, hints) {
  const names = hints.map(item => item.path.split('.').map(norm)), sourceNames = names.filter(parts => !parts.some(part => ['en', 'de'].includes(part)));
  const hasFamily = (pattern, entries = names) => entries.some(parts => parts.some(part => pattern.test(part)));
  return { modelGroupObserved: result.some(item => !!item.modelGroup) || hasFamily(/^(?:modelgroup|modelgrp)(?:name|nm|id|code|cd)?$/),
    separateGradeTrimObserved: hasFamily(/^(?:grade|badge)(?:name|nm|id|code|cd)?$/, sourceNames) && hasFamily(/^(?:gradedetail|badgedetail|subgrade|subtrim)(?:name|nm|id|code|cd)?$/, sourceNames),
    classificationCodeObserved: sourceNames.some(parts => parts.some(part => /(?:manufacturer|brand|modelgroup|modelgrp|model|generation|badge|badgedetail|grade|gradedetail|subgrade|trim|subtrim)(?:id|code|cd)$/.test(part))) || sourceNames.some(parts => parts.length > 1 && ['id', 'code', 'cd'].includes(parts.at(-1)) && CLASS_FIELDS.has(parts.at(-2))),
    requiresReview: true };
}
function warning(error) { const code = error instanceof ProbeError && ERRORS[error.code] ? error.code : 'UPSTREAM_UNAVAILABLE'; return { code, message: ERRORS[code][1] }; }
async function keyDigest(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function safeHintPath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,399}$/.test(path)) return false;
  const parts = path.split('.'); if (parts.length > 8) return false; let selected = false, leaf = false;
  for (const name of parts) { const value = norm(name), classification = CLASS_FIELDS.has(value), inherited = selected && LABEL_FIELDS.has(value); if (!classification && !inherited && !CONTAINERS.has(value)) return false; leaf = classification || inherited; selected = leaf; }
  return leaf;
}
function cachedReport(value, brand, key) {
  if (!object(value) || value.version !== 1 || !object(value.report)) return null;
  const report = value.report, age = Date.now() - Date.parse(report.checkedAt);
  if (report.provider !== PROVIDER || report.manufacturer !== brand || !Number.isFinite(age) || age < -30000 || age > CACHE_SECONDS * 1000 || !DETAIL_STATUSES.has(report.detailStatus) || !Array.isArray(report.samples) || report.samples.length > 3 || !Array.isArray(report.detailClassification) || report.detailClassification.length > 60) return null;
  const result = report.samples.map(row => sample(row, key)); if (result.some(row => !row)) return null;
  const hints = report.detailClassification.map(item => object(item) && safeHintPath(item.path) ? { path: item.path, value: safeText(item.value, key) } : null);
  if (hints.some(item => !item?.value)) return null;
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter(item => ERRORS[item?.code]).slice(0, 3).map(item => warning(new ProbeError(item.code))) : [];
  const rate = object(report.rateLimit) ? report.rateLimit : {};
  return { ok: true, configured: true, provider: PROVIDER, manufacturer: brand, checkedAt: report.checkedAt, cached: true, providerRequestCount: 0,
    samples: result, detailClassification: hints, schemaSummary: schema(result, hints), detailStatus: report.detailStatus,
    rateLimit: { limit: safeInteger(rate.limit, key), remaining: safeInteger(rate.remaining, key), reset: safeInteger(rate.reset, key) }, warnings, importEnabled: false };
}
async function probe(op, config, brand) {
  const search = new URL(PROVIDER_BASE + '/cars'); search.search = new URLSearchParams({ manufacturer: brand, count: '3', page: '0' }).toString();
  const first = await fetchJSON(op, search.href, { headers: { 'x-api-key': config.key, Accept: 'application/json' } }, true);
  const result = samples(first.data, config.key); let rateLimit = first.rateLimit, hints = [], detailStatus = result.length ? 'checked' : 'skipped_no_listing'; const warnings = [];
  if (result.length && first.rateLimit.remaining === 0) { detailStatus = 'skipped_quota'; warnings.push(warning(new ProbeError('UPSTREAM_RATE_LIMITED'))); }
  else if (result.length) {
    try {
      const detail = await fetchJSON(op, PROVIDER_BASE + '/car?' + new URLSearchParams({ id: result[0].listingId }), { headers: { 'x-api-key': config.key, Accept: 'application/json' } }, true);
      if (!object(detail.data)) fail('UPSTREAM_INVALID');
      const detailId = detailListingId(detail.data);
      if (detailId && detailId !== result[0].listingId) fail('UPSTREAM_INVALID');
      hints = detailHints(detail.data, config.key); rateLimit = detail.rateLimit;
      if (!hints.length) { detailStatus = 'unavailable'; warnings.push(warning(new ProbeError('UPSTREAM_INVALID'))); }
    } catch (error) { detailStatus = 'unavailable'; warnings.push(warning(error)); }
  }
  return { ok: true, configured: true, provider: PROVIDER, manufacturer: brand, checkedAt: new Date().toISOString(), cached: false, providerRequestCount: op.providerRequestCount,
    samples: result, detailClassification: hints, schemaSummary: schema(result, hints), detailStatus, rateLimit, warnings, importEnabled: false };
}
export async function onRequest(context) {
  const { request, env } = context; const op = operation(request);
  try {
    if (!['GET', 'POST'].includes(request.method)) fail('METHOD_NOT_ALLOWED');
    const origin = request.headers.get('Origin'); if (origin !== null && origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('FORBIDDEN');
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
    if (!match || match[1].length < 30 || match[1].length > 8192) fail('UNAUTHORIZED');
    let company, brand;
    if (request.method === 'GET') {
      const url = new URL(request.url); if ([...url.searchParams.keys()].some(name => name !== 'companyId') || url.searchParams.getAll('companyId').length !== 1) fail('INVALID_REQUEST');
      company = identifier(url.searchParams.get('companyId'));
    } else {
      const body = await readRequest(request, op); if (!object(body) || Object.keys(body).length !== 2 || Object.keys(body).some(name => !['companyId', 'manufacturer'].includes(name))) fail('INVALID_REQUEST');
      company = identifier(body.companyId); if (!BRANDS.some(item => item.value === body.manufacturer)) fail('INVALID_REQUEST'); brand = body.manufacturer;
    }
    const config = settings(env); await authorize(op, config, match[1], company);
    if (request.method === 'GET') return json({ ok: true, configured: config.configured, configurationCode: config.configured ? null : config.key ? 'API_KEY_INVALID' : 'API_KEY_MISSING', provider: PROVIDER, supportedManufacturers: BRANDS, maxProviderRequests: 2, providerRequestCount: 0, importEnabled: false });
    if (!config.key) fail('API_KEY_MISSING'); if (!config.configured) fail('API_KEY_INVALID');
    const digest = await keyDigest(config.key);
    const cacheKey = new Request(new URL('/api/_taxonomy-probe-cache/v1/' + company + '/' + encodeURIComponent(brand) + '/' + digest, request.url));
    const cache = globalThis.caches?.default;
    try {
      const stored = await abortable(cache?.match(cacheKey), op.controller.signal, 'UPSTREAM_TIMEOUT');
      if (stored) { const report = cachedReport(await limitedJSON(stored, 65536, op.controller.signal, 'UPSTREAM_INVALID'), brand, config.key); if (report) return json(report); }
    } catch {}
    const pendingKey = company + ':' + brand + ':' + digest, pending = inflight.get(pendingKey);
    if (pending) { const report = await abortable(pending, op.controller.signal, 'UPSTREAM_TIMEOUT'); return json({ ...report, cached: true, providerRequestCount: 0 }); }
    const task = probe(op, config, brand); if (inflight.size < 128) inflight.set(pendingKey, task);
    try {
      const report = await task;
      if (cache && report.detailStatus !== 'unavailable') {
        try { await abortable(cache.put(cacheKey, new Response(JSON.stringify({ version: 1, report }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CACHE_SECONDS } })), op.controller.signal, 'UPSTREAM_TIMEOUT'); } catch {}
      }
      return json(report);
    } finally { if (inflight.get(pendingKey) === task) inflight.delete(pendingKey); }
  } catch (error) {
    const code = error instanceof ProbeError && ERRORS[error.code] ? error.code : 'UPSTREAM_UNAVAILABLE', [status, message] = ERRORS[code];
    const retryAfter = integer(error?.retryAfter, 86400);
    return json({ ok: false, code, error: message, providerRequestCount: op.providerRequestCount, ...(retryAfter === null ? {} : { retryAfter }) }, status, retryAfter === null ? undefined : retryAfter);
  } finally { op.finish(); }
}
