import { CATALOG_ORIGIN, catalogURL, configuredCatalogSearch, discoverCatalogSearch, parseCatalogPage } from '../_shared/encar-catalog.mjs';

/**
 * S-NOTE / Cloudflare Pages Function: POST /api/encar
 * Required: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. TAVILY_API_KEY is optional.
 * Optional ENCAR_CACHE KV contains candidate IDs only; every hit is reverified.
 * No seller/account/contact fields are used or returned.
 */

const MAX_CANDIDATES = 6;
const MAX_REQUEST_BYTES = 4096;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_SEARCH_BYTES = 512 * 1024;
const MAX_RAW_SEARCH_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const DEADLINE_MS = 35000;
const MAX_TOTAL_CANDIDATES = 12;
const ENCAR_DETAIL = 'https://fem.encar.com/cars/detail/';
const AUTO_EXPORT_HOSTS = ['encar.spb.ru', 'trust-encar.ru', 'encar.msk.ru', 'encar.cbg.ru'];
// Keep fallback search domains aligned with the URL/lot parsers below.
// Tavily's encar.com domain filter includes its official subdomains.
const SEARCH_SOURCE_DOMAINS = ['encar.com', ...AUTO_EXPORT_HOSTS, 'carsbat.com', 'deffcars.ru'];
const RECOGNIZED_SOURCE_HOSTS = new Set([...SEARCH_SOURCE_DOMAINS, 'fem.encar.com', 'm.encar.com']);
const RESULT_TEXT_FIELDS = ['title', 'content', 'raw_content'];
const CATALOG_ERRORS = new Set(['CATALOG_BLOCKED', 'CATALOG_UNAVAILABLE', 'CATALOG_FORM_UNSUPPORTED',
  'CATALOG_PARSE_FAILED', 'CATALOG_INCOMPLETE', 'CATALOG_CONFIG_INVALID', 'CATALOG_PARSER_UNAVAILABLE', 'CATALOG_LIMIT_EXCEEDED']);
const REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
const PLATE = new RegExp('^(?:' + REGIONS + ')?[0-9]{2,3}[가-힣][0-9]{4}$');
const BLOCKED = /has_been_cr_blocked|서비스\s*이용\s*제한됨|비정상적인\s*트래픽|<title>\s*(?:Access Denied|Request blocked)/i;

class EncarError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function operation(request) {
  const controller = new AbortController(), startedAt = Date.now();
  const op = { requestId: crypto.randomUUID(), startedAt, deadline: startedAt + DEADLINE_MS,
    controller, searchCount: 0, resultCount: 0, checkedCount: 0, plateMatchedCount: 0,
    resultPlateMatchCount: 0, rawResultCount: 0, recognizedSourceCount: 0, candidates: new Set(),
    catalogRequestCount: 0, catalogPageCount: 0, catalogRecordCount: 0, catalogExactMatchCount: 0,
    catalogFormCount: 0, catalogPlateFieldCount: 0, catalogLinkCount: 0,
    rejected: { plateMismatch: 0, notAdvertising: 0, notFound: 0 } };
  op.timer = setTimeout(() => controller.abort(new EncarError('DEADLINE_EXCEEDED')), DEADLINE_MS);
  op.abort = () => controller.abort(new EncarError('UPSTREAM_TIMEOUT'));
  request.signal?.addEventListener('abort', op.abort, { once: true });
  if (request.signal?.aborted) op.abort();
  return op;
}

function remaining(op) {
  if (Date.now() >= op.deadline) throw new EncarError('DEADLINE_EXCEEDED');
  if (op.controller.signal.aborted) throw op.controller.signal.reason;
  return op.deadline - Date.now();
}

function counters(op) {
  return { searchCount: op.searchCount, resultCount: op.resultCount,
    candidateCount: op.candidates.size, checkedCount: op.checkedCount,
    plateMatchedCount: op.plateMatchedCount, resultPlateMatchCount: op.resultPlateMatchCount,
    rawResultCount: op.rawResultCount, recognizedSourceCount: op.recognizedSourceCount,
    catalogRequestCount: op.catalogRequestCount, catalogPageCount: op.catalogPageCount,
    catalogRecordCount: op.catalogRecordCount, catalogExactMatchCount: op.catalogExactMatchCount,
    catalogFormCount: op.catalogFormCount, catalogPlateFieldCount: op.catalogPlateFieldCount, catalogLinkCount: op.catalogLinkCount,
    rejected: { ...op.rejected } };
}

function response(op, httpStatus, plate = '', listings = [], status = 'error', code = 'INVALID_REQUEST') {
  const body = {
    plate,
    verifiedAt: listings.length ? new Date().toISOString() : null,
    listings,
    status
  };
  if (status === 'error' || status === 'unverified') {
    body.diagnostics = { code, requestId: op.requestId, ...counters(op) };
    console.info(JSON.stringify({ requestId: op.requestId, code, ...counters(op), durationMs: Math.max(0, Date.now() - op.startedAt) }));
  }
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': op.requestId,
      ...(httpStatus === 405 ? { Allow: 'POST' } : {})
    }
  });
}

function normalizePlate(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const plate = value.normalize('NFKC').replace(/[\s-]/g, '');
  return PLATE.test(plate) ? plate : '';
}

function idOf(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const id = String(value);
  return /^[1-9][0-9]{0,11}$/.test(id) ? id : '';
}

function idsOf(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.slice(0, 32).map(idOf).filter(Boolean))].slice(0, MAX_CANDIDATES);
}

function waitFor(value, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof EncarError ? signal.reason : new EncarError('UPSTREAM_TIMEOUT'));
    if (signal.aborted) { Promise.resolve(value).catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readLimited(source, maxBytes, signal) {
  const length = Number(source.headers.get('content-length') || 0);
  if (length > maxBytes) {
    try { Promise.resolve(source.body?.cancel()).catch(() => {}); } catch (_) {}
    throw new Error('body-limit');
  }
  if (!source.body) return '';
  const reader = source.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await waitFor(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error('body-limit');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } catch (error) {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

async function fetchLimited(op, url, options = {}, maxBytes = MAX_SEARCH_BYTES, unavailable = 'SEARCH_UNAVAILABLE') {
  const budget = remaining(op);
  const controller = new AbortController();
  const abort = () => controller.abort(op.controller.signal.reason);
  op.controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new EncarError(budget <= TIMEOUT_MS ? 'DEADLINE_EXCEEDED' : 'UPSTREAM_TIMEOUT')), Math.min(TIMEOUT_MS, budget));
  try {
    const fetched = await waitFor(fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal
    }), controller.signal);
    const text = await readLimited(fetched, maxBytes, controller.signal);
    return { ok: fetched.ok, status: fetched.status, text };
  } catch (error) {
    if (error instanceof EncarError) throw error;
    if (error?.message === 'body-limit' && unavailable === 'CATALOG_UNAVAILABLE') throw new EncarError('CATALOG_LIMIT_EXCEEDED');
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new EncarError('UPSTREAM_TIMEOUT');
    throw new EncarError(unavailable);
  } finally {
    clearTimeout(timer);
    op.controller.signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

async function authorize(op, request, supaUrl, supaKey) {
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+[A-Za-z0-9._-]{30,5000}$/i.test(bearer)) return { status: 401, code: 'AUTH_REQUIRED' };
  const headers = { apikey: supaKey, Authorization: bearer };
  const auth = await fetchLimited(op, supaUrl + '/auth/v1/user', { method: 'GET', headers }, 64 * 1024, 'AUTH_UNAVAILABLE');
  if (!auth.ok) return { status: auth.status >= 500 ? 502 : 401, code: auth.status >= 500 ? 'AUTH_UNAVAILABLE' : 'AUTH_FAILED' };
  let user;
  try { user = JSON.parse(auth.text); } catch (_) { throw new EncarError('AUTH_UNAVAILABLE'); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id || '')) return { status: 401, code: 'AUTH_FAILED' };
  const url = new URL(supaUrl + '/rest/v1/zc_members');
  url.searchParams.set('select', 'user_id');
  url.searchParams.set('user_id', 'eq.' + user.id);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('limit', '1');
  const membership = await fetchLimited(op, url.toString(), { method: 'GET', headers }, 64 * 1024, 'AUTH_UNAVAILABLE');
  if (!membership.ok) return { status: membership.status >= 500 ? 502 : 403, code: membership.status >= 500 ? 'AUTH_UNAVAILABLE' : 'STAFF_REQUIRED' };
  let members;
  try { members = JSON.parse(membership.text); } catch (_) { throw new EncarError('AUTH_UNAVAILABLE'); }
  return Array.isArray(members) && members.some(member => member?.user_id === user.id) ? null : { status: 403, code: 'STAFF_REQUIRED' };
}

function parsedURL(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value.replace(/&amp;/g, '&'));
    return ['https:', 'http:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function idFromURL(value) {
  const url = parsedURL(value);
  if (!url) return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'fem.encar.com') {
    return idOf(/^\/cars\/detail\/([0-9]+)(?:\/|$)/.exec(url.pathname)?.[1]);
  }
  if (host === 'encar.com' || host === 'm.encar.com') {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === 'carid') return idOf(value);
    }
  }
  if (AUTO_EXPORT_HOSTS.includes(host)) {
    return idOf(/^\/auto\/([0-9]+)(?:\/|$)/.exec(url.pathname)?.[1]);
  }
  if (host === 'deffcars.ru') {
    return idOf(/encar_([0-9]+)(?![0-9])/i.exec(url.pathname)?.[1]);
  }
  return '';
}

function resultMentionsPlate(result, plate) {
  return RESULT_TEXT_FIELDS.some(key => {
    if (typeof result?.[key] !== 'string') return false;
    const compact = result[key].normalize('NFKC').replace(/[\s-]/g, '');
    if (!compact.includes(plate)) return false;
    const tokens = new RegExp('(?<![0-9])' + REGIONS + '?[0-9]{2,3}[가-힣][0-9]{4}(?![0-9])', 'g');
    for (const match of compact.matchAll(tokens)) if (match[0] === plate) return true;
    return false;
  });
}

function candidatesFromResults(results, plate) {
  const ids = new Set();
  const add = value => {
    const id = idOf(value);
    if (id && ids.size < MAX_CANDIDATES) ids.add(id);
  };
  const limited = results.slice(0, 8);
  // Indexed result URLs precede incidental links in any one snippet.
  for (const result of limited) add(idFromURL(result?.url));
  for (const result of limited) {
    const content = RESULT_TEXT_FIELDS.map(key => typeof result?.[key] === 'string' ? result[key] : '').join('\n');
    for (const match of content.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
      add(idFromURL(match[0].replace(/[),.;\]}]+$/, '')));
    }
    const sourceHost = parsedURL(result?.url)?.hostname.toLowerCase().replace(/^www\./, '');
    if (sourceHost === 'carsbat.com') {
      for (const match of content.matchAll(/(?:\bLot\s+(?:number|no\.?)|Номер\s+лота)\s*[:#–-]?\s*([0-9]+)(?![0-9])/giu)) {
        add(match[1]);
      }
    }
    // A branded listing label is a hint only when the same indexed result
    // explicitly mentions the requested plate. Bare numbers never qualify.
    if (resultMentionsPlate(result, plate)) {
      for (const match of content.normalize('NFKC').matchAll(/(?:\bEncar\s*ID|엔카\s*매물\s*번호)\s*[:：#]\s*([0-9]+)(?![0-9])/giu)) add(match[1]);
    }
    if (ids.size >= MAX_CANDIDATES) break;
  }
  return [...ids];
}

async function searchCandidates(op, plate, apiKey, fallback = false) {
  remaining(op);
  ++op.searchCount;
  const result = await fetchLimited(op, 'https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      query: fallback ? plate : '"' + plate + '"',
      ...(!fallback ? { exact_match: true } : {}),
      search_depth: 'basic',
      max_results: 8,
      auto_parameters: false,
      include_answer: false,
      include_raw_content: fallback,
      ...(fallback ? { include_domains: SEARCH_SOURCE_DOMAINS } : {})
    })
  }, fallback ? MAX_RAW_SEARCH_BYTES : MAX_SEARCH_BYTES);
  if (!result.ok) {
    if ([401, 403].includes(result.status)) throw new EncarError('SEARCH_AUTH_FAILED');
    if ([432, 433].includes(result.status)) throw new EncarError('SEARCH_QUOTA_EXCEEDED');
    if (result.status === 429) throw new EncarError('SEARCH_RATE_LIMITED');
    throw new EncarError('SEARCH_UNAVAILABLE');
  }
  let payload;
  try { payload = JSON.parse(result.text); } catch (_) { throw new EncarError('SEARCH_UNAVAILABLE'); }
  if (!Array.isArray(payload?.results)) throw new EncarError('SEARCH_UNAVAILABLE');
  const results = payload.results.slice(0, 8);
  op.resultCount += results.length;
  for (const item of results) {
    if (resultMentionsPlate(item, plate)) ++op.resultPlateMatchCount;
    if (typeof item?.raw_content === 'string' && item.raw_content.trim()) ++op.rawResultCount;
    const host = parsedURL(item?.url)?.hostname.toLowerCase().replace(/^www\./, '');
    if (RECOGNIZED_SOURCE_HOSTS.has(host)) ++op.recognizedSourceCount;
  }
  return candidatesFromResults(results, plate);
}

// Extract a JSON object while respecting quotes and backslash escapes.
// No eval, Function constructor, script execution, or external page requests.
function jsonObjectAt(source, start) {
  if (source[start] !== '{') throw new Error('state-object');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(source.slice(start, i + 1));
  }
  throw new Error('state-truncated');
}

function jsonStringAt(source, start) {
  if (source[start] !== '"') throw new Error('state-string');
  let escaped = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === '"') return { value: JSON.parse(source.slice(start, i + 1)), end: i + 1 };
  }
  throw new Error('state-truncated');
}

function extractState(html) {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const source = script[1];
    const assigned = /(?:window\s*\.\s*)?__PRELOADED_STATE__\s*=\s*/g;
    for (const match of source.matchAll(assigned)) {
      const start = match.index + match[0].length;
      try {
        let state;
        if (source[start] === '{') {
          state = jsonObjectAt(source, start);
        } else {
          const parseCall = /^JSON\s*\.\s*parse\s*\(\s*/.exec(source.slice(start));
          if (!parseCall) continue;
          const encoded = jsonStringAt(source, start + parseCall[0].length);
          if (!/^\s*\)/.test(source.slice(encoded.end))) continue;
          state = JSON.parse(encoded.value);
        }
        if (state?.cars?.base && typeof state.cars.base === 'object') return state;
      } catch {
        // A different script may contain the assignment text inside a string.
      }
    }
  }
  throw new Error('state-parse');
}

function shortText(value, limit = 120) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function listingData(base) {
  const category = base.category || {};
  const yearMonth = String(category.yearMonth || '');
  const formYear = String(category.formYear || '');
  const rawMileage = base.spec?.mileage;
  const mileage = rawMileage !== null && rawMileage !== undefined && rawMileage !== '' ? Number(rawMileage) : NaN;
  return {
    model: ['manufacturerName', 'modelName', 'gradeName', 'gradeDetailName']
      .map(key => shortText(category[key])).filter(Boolean).join(' ').slice(0, 300),
    yearMonth: /^[0-9]{4}(?:0[1-9]|1[0-2])$/.test(yearMonth) ? yearMonth : null,
    formYear: /^[0-9]{4}$/.test(formYear) ? formYear : null,
    mileage: Number.isSafeInteger(mileage) && mileage >= 0 ? mileage : null
  };
}

async function detail(op, id, plate) {
  try {
    remaining(op);
    ++op.checkedCount;
    const fetched = await fetchLimited(op, ENCAR_DETAIL + id, {
      method: 'GET', headers: { Accept: 'text/html' }
    }, MAX_HTML_BYTES, 'DETAIL_UNAVAILABLE');
    if (BLOCKED.test(fetched.text) || [403, 429].includes(fetched.status)) return { kind: 'error', code: 'DETAIL_BLOCKED' };
    if (fetched.status === 404 || fetched.status === 410) { ++op.rejected.notFound; return { kind: 'unverified' }; }
    if (!fetched.ok) return { kind: 'error', code: 'DETAIL_UNAVAILABLE' };
    const base = extractState(fetched.text).cars.base;
    const actualPlate = normalizePlate(base.vehicleNo);
    const originalId = idOf(base.vehicleId);
    if (!actualPlate || !originalId) return { kind: 'error', code: 'DETAIL_PARSE_FAILED' };
    if (actualPlate !== plate) { ++op.rejected.plateMismatch; return { kind: 'unverified' }; }
    ++op.plateMatchedCount;
    const identity = {
      id: originalId,
      sourceId: id,
      dummyId: idOf(base.manage?.dummyVehicleId),
      dummy: base.manage?.dummy === true,
      queryId: idOf(base.queryCarId)
    };
    if (base.advertisement?.status === 'SOLD') {
      ++op.rejected.notAdvertising;
      // An inactive trusted alias is not a verified link. Its same-plate
      // canonical ID may still locate a separately active original page.
      return { kind: 'inactive', ...identity };
    }
    if (base.advertisement?.status !== 'ADVERTISE') return { kind: 'error', code: 'AD_STATUS_UNKNOWN' };
    return { kind: 'match', ...identity, ...listingData(base) };
  } catch (error) {
    return { kind: 'error', code: error instanceof EncarError ? error.code : 'DETAIL_PARSE_FAILED' };
  }
}

async function mapConcurrent(values, operation, concurrency = 3) {
  const output = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await operation(values[index]);
    }
  }));
  return output;
}

async function verifyCandidates(ids, getDetail) {
  const discovered = await mapConcurrent(ids, getDetail);
  const errors = discovered.filter(item => item.kind === 'error').map(item => item.code);
  const roots = new Map();
  await mapConcurrent(discovered.filter(item => item.kind === 'match' ||
    (item.kind === 'inactive' && item.dummy && item.sourceId !== item.id)), async candidate => {
    const original = candidate.sourceId === candidate.id ? candidate : await getDetail(candidate.id);
    if (original.kind === 'error') errors.push(original.code);
    if (original.kind === 'match' && original.id === candidate.id && !original.dummy) roots.set(original.id, original);
  });
  const listings = await mapConcurrent([...roots.values()], async original => {
    let trustedId = null;
    if (original.dummyId && original.dummyId !== original.id) {
      const trusted = await getDetail(original.dummyId);
      if (trusted.kind === 'error') errors.push(trusted.code);
      if (trusted.kind === 'match' && trusted.id === original.id && trusted.dummy &&
          trusted.dummyId === original.dummyId && (!trusted.queryId || trusted.queryId === original.dummyId)) {
        trustedId = original.dummyId;
      }
    }
    return {
      id: original.id,
      trustedId,
      sellerUrl: ENCAR_DETAIL + original.id,
      trustedUrl: trustedId ? ENCAR_DETAIL + trustedId : null,
      model: original.model,
      yearMonth: original.yearMonth,
      formYear: original.formYear,
      mileage: original.mileage
    };
  });
  listings.sort((a, b) => a.id.localeCompare(b.id));
  const priority = ['DEADLINE_EXCEEDED', 'UPSTREAM_TIMEOUT', 'DETAIL_BLOCKED', 'DETAIL_PARSE_FAILED', 'AD_STATUS_UNKNOWN', 'DETAIL_UNAVAILABLE'];
  const errorCode = priority.find(code => errors.includes(code)) || (errors.length ? 'DETAIL_UNAVAILABLE' : null);
  return { listings, errored: !!errorCode, errorCode };
}

function catalogError(error, fallback = 'CATALOG_PARSE_FAILED') {
  if (error instanceof EncarError) return error;
  return new EncarError(CATALOG_ERRORS.has(error?.code) ? error.code : fallback);
}

async function catalogHTML(op, url) {
  const safeURL = catalogURL(url);
  remaining(op);
  ++op.catalogRequestCount;
  const result = await fetchLimited(op, safeURL.href, { method: 'GET', headers: { Accept: 'text/html' } }, MAX_HTML_BYTES, 'CATALOG_UNAVAILABLE');
  if (BLOCKED.test(result.text) || [403, 429].includes(result.status) || /<title>\s*(?:Just a moment|Attention Required)/i.test(result.text)) throw new EncarError('CATALOG_BLOCKED');
  if (!result.ok) throw new EncarError('CATALOG_UNAVAILABLE');
  return result.text;
}

async function catalogCandidates(op, env, plate) {
  const suffix = plate.slice(-4);
  let searchURL;
  try {
    const template = env.ENCAR_CATALOG_SEARCH_URL;
    searchURL = template === undefined || (typeof template === 'string' && !template.trim()) ? null : configuredCatalogSearch(template, suffix);
    if (!searchURL) {
      const home = catalogURL(CATALOG_ORIGIN + '/');
      const html = await catalogHTML(op, home);
      const form = await waitFor(discoverCatalogSearch(html, home.href, suffix), op.controller.signal);
      op.catalogFormCount += form.formCount;
      op.catalogPlateFieldCount += form.plateFieldCount;
      searchURL = catalogURL(form.url);
    }
    const original = catalogURL(searchURL), visited = new Set(), ids = new Set();
    const filterKeys = [...new Set(original.searchParams.keys())].filter(key => original.searchParams.getAll(key).some(value => value.includes(suffix)));
    if (!filterKeys.length) throw new EncarError('CATALOG_FORM_UNSUPPORTED');
    let current = original;
    for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
      if (visited.has(current.href)) throw new EncarError('CATALOG_INCOMPLETE');
      visited.add(current.href);
      const html = await catalogHTML(op, current);
      const parsed = await waitFor(parseCatalogPage(html, current.href, plate), op.controller.signal);
      ++op.catalogPageCount;
      op.catalogRecordCount += parsed.recordCount;
      op.catalogExactMatchCount += parsed.exactMatchCount;
      op.catalogLinkCount += parsed.linkCount;
      for (const value of parsed.ids) {
        const id = idOf(value);
        if (!id) throw new EncarError('CATALOG_PARSE_FAILED');
        ids.add(id);
      }
      const newCount = [...ids].filter(id => !op.candidates.has(id)).length;
      if (parsed.truncated || newCount + op.candidates.size > MAX_TOTAL_CANDIDATES) throw new EncarError('CATALOG_INCOMPLETE');
      if (!parsed.nextUrl) return [...ids];
      if (pageNumber === 2) throw new EncarError('CATALOG_INCOMPLETE');
      const next = catalogURL(parsed.nextUrl, current.href);
      // Preserve actual form filters, including repeated values, while retaining
      // the actual next link's pagination parameters. Never invent a next URL.
      for (const key of new Set(original.searchParams.keys())) {
        if (filterKeys.includes(key)) {
          next.searchParams.delete(key);
          for (const value of original.searchParams.getAll(key)) next.searchParams.append(key, value);
        } else if (!next.searchParams.has(key)) {
          for (const value of original.searchParams.getAll(key)) next.searchParams.append(key, value);
        }
      }
      current = next;
    }
    throw new EncarError('CATALOG_INCOMPLETE');
  } catch (error) {
    throw catalogError(error);
  }
}

async function cachedCandidates(op, env, plate) {
  if (typeof env.ENCAR_CACHE?.get !== 'function') return [];
  try {
    const saved = await waitFor(env.ENCAR_CACHE.get('encar:candidates:v1:' + plate), op.controller.signal);
    if (typeof saved !== 'string' || saved.length > MAX_REQUEST_BYTES) return [];
    return idsOf(JSON.parse(saved));
  } catch (error) {
    if (error instanceof EncarError) throw error;
    return [];
  }
}

function saveCandidates(context, plate, ids) {
  if (!ids.length || typeof context.env.ENCAR_CACHE?.put !== 'function') return;
  const saving = Promise.resolve().then(() => context.env.ENCAR_CACHE.put(
    'encar:candidates:v1:' + plate,
    JSON.stringify(idsOf(ids)),
    { expirationTtl: 3600 }
  )).catch(() => {});
  if (typeof context.waitUntil === 'function') context.waitUntil(saving);
}

export async function onRequest(context) {
  const { request, env = {} } = context;
  const op = operation(request);
  let plate = '';
  const finish = (httpStatus, listings = [], status = 'error', code = 'INVALID_REQUEST') => response(op, httpStatus, plate, listings, status, code);
  const unverifiedCode = fallback => {
    const rejected = Object.entries(op.rejected).filter(([, count]) => count > 0);
    if (rejected.length === 1) return { plateMismatch: 'PLATE_MISMATCH', notAdvertising: 'AD_INACTIVE', notFound: 'DETAIL_NOT_FOUND' }[rejected[0][0]];
    return op.candidates.size ? 'NO_VERIFIED_LISTING' : fallback;
  };
  const select = values => values.filter(id => {
    if (op.candidates.has(id)) return true;
    if (op.candidates.size >= MAX_TOTAL_CANDIDATES) return false;
    op.candidates.add(id); return true;
  });
  try {
    if (request.method !== 'POST') return finish(405, [], 'error', 'METHOD_NOT_ALLOWED');
    const apiKey = String(env.TAVILY_API_KEY || '').trim();
    const supaUrl = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const supaKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (!/^https:\/\/[\w-]+\.supabase\.co$/.test(supaUrl) || !supaKey) return finish(503, [], 'error', 'SUPABASE_NOT_CONFIGURED');
    const authorization = await authorize(op, request, supaUrl, supaKey);
    if (authorization) return finish(authorization.status, [], 'error', authorization.code);
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return finish(415, [], 'error', 'UNSUPPORTED_MEDIA_TYPE');
    let payload;
    try {
      payload = JSON.parse(await readLimited(request, MAX_REQUEST_BYTES, op.controller.signal));
    } catch (error) {
      if (error instanceof EncarError) throw error;
      return finish(error?.message === 'body-limit' ? 413 : 400, [], 'error', error?.message === 'body-limit' ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST');
    }
    plate = normalizePlate(payload?.plate);
    if (!plate || (payload?.candidateIds !== undefined && !Array.isArray(payload.candidateIds))) return finish(400);
    const memo = new Map();
    const getDetail = id => {
      if (!memo.has(id)) memo.set(id, detail(op, id, plate));
      return memo.get(id);
    };
    const hints = select(idsOf([...idsOf(payload.candidateIds), ...await cachedCandidates(op, env, plate)]));
    const hinted = await verifyCandidates(hints, getDetail);
    if (hinted.errored) return finish(502, hinted.listings, 'error', hinted.errorCode);
    if (hinted.listings.length) {
      saveCandidates(context, plate, hinted.listings.map(item => item.id));
      remaining(op);
      return finish(200, hinted.listings, hinted.listings.length > 1 ? 'multiple' : 'found');
    }
    let catalogFailure = null;
    try {
      const candidates = select(await catalogCandidates(op, env, plate));
      const verified = await verifyCandidates(candidates, getDetail);
      // A failed detail is not a failed discovery provider: never bypass its
      // partial-error policy with an independent search result.
      if (verified.errored) return finish(502, verified.listings, 'error', verified.errorCode);
      if (verified.listings.length) {
        remaining(op);
        saveCandidates(context, plate, verified.listings.map(item => item.id));
        return finish(200, verified.listings, verified.listings.length > 1 ? 'multiple' : 'found');
      }
    } catch (error) {
      catalogFailure = catalogError(error);
    }
    if (!apiKey) return catalogFailure ? finish(502, [], 'error', catalogFailure.code) : finish(200, [], 'unverified', unverifiedCode('CATALOG_NO_MATCH'));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt && op.candidates.size >= MAX_TOTAL_CANDIDATES) break;
        const candidates = select(await searchCandidates(op, plate, apiKey, attempt === 1));
        const verified = await verifyCandidates(candidates, getDetail);
        if (verified.errored) return finish(502, verified.listings, 'error', verified.errorCode);
        if (verified.listings.length) {
          remaining(op);
          saveCandidates(context, plate, verified.listings.map(item => item.id));
          return finish(200, verified.listings, verified.listings.length > 1 ? 'multiple' : 'found');
        }
      }
    } catch (error) {
      if (catalogFailure) return finish(502, [], 'error', catalogFailure.code);
      throw error;
    }
    remaining(op);
    if (catalogFailure) return finish(502, [], 'error', catalogFailure.code);
    saveCandidates(context, plate, [...op.candidates]);
    const code = unverifiedCode(op.resultCount ? 'SEARCH_NO_CANDIDATES' : 'SEARCH_NO_RESULTS');
    return finish(200, [], 'unverified', code);
  } catch (error) {
    return finish(502, [], 'error', error instanceof EncarError ? error.code : 'SEARCH_UNAVAILABLE');
  } finally {
    clearTimeout(op.timer);
    request.signal?.removeEventListener('abort', op.abort);
  }
}
