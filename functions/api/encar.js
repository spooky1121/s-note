import { CATALOG_ORIGIN, catalogURL, configuredCatalogSearch, discoverCatalogSearch, discoverCatalogEntry, parseCatalogPage, externalSourceURL, parseExternalAdvertisement, discoverVehicleCatalogLink, getObservedCatalogNext, discoverCatalogBranches, manufacturerMatches } from '../_shared/encar-catalog.mjs';
import { parseEncarPagePrice } from '../_shared/encar-page-price.mjs';
import { createEncarRequestBudget } from '../_shared/encar-request-budget.mjs';

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
const CATALOG_FALLBACK_BUDGET_MS = 8000;
const MODEL_CATALOG_BUDGET_MS = 8000;
const MAX_MODEL_CATALOG_PAGES = 3;
const MAX_MODEL_DISCOVERY_PAGES = 8;
const RESOLVER_RELEASE = '2.137';
const EXTERNAL_BUDGET_MS = 8000;
const MAX_EXTERNAL_PAGES = 6;
const EXTERNAL_DETAIL_ERRORS = new Set(['DETAIL_BLOCKED', 'DETAIL_UNAVAILABLE', 'DETAIL_PARSE_FAILED', 'UPSTREAM_TIMEOUT']);
const MAX_HINT_CANDIDATES = MAX_CANDIDATES * 2;
const MAX_DISCOVERY_RESERVE = MAX_CANDIDATES;
const MAX_TOTAL_CANDIDATES = MAX_HINT_CANDIDATES + MAX_DISCOVERY_RESERVE;
// Leave room below the edge subrequest limit and preserve official checks when
// optional public-directory discovery has already consumed most of the budget.
const OFFICIAL_REQUEST_RESERVE = 6;
const BUDGET_RETRY_SECONDS = 5;
const ENCAR_DETAIL = 'https://fem.encar.com/cars/detail/';
// This is an observed public mirror route for rechecking already known IDs,
// never a formula for guessing an advertisement ID from a vehicle number.
const KNOWN_HINT_SOURCE = 'https://nnov.trust-encar.ru/auto/';
const PRICE_PROVIDER = 'https://api.encar-api.com/api/car';
const MAX_PRICE_WON = 1_000_000_000_000;
const MAX_PRICE_LISTINGS = 3;
const PRICE_TIMEOUT_MS = 6000;
const AUTO_EXPORT_HOSTS = ['encar.spb.ru', 'trust-encar.ru', 'encar.msk.ru', 'encar.cbg.ru'];
// Keep fallback search domains aligned with the URL/lot parsers below.
// Tavily's encar.com domain filter includes its official subdomains.
const SEARCH_SOURCE_DOMAINS = ['encar.com', ...AUTO_EXPORT_HOSTS, 'carsbat.com', 'deffcars.ru'];
const RECOGNIZED_SOURCE_HOSTS = new Set([...SEARCH_SOURCE_DOMAINS, 'fem.encar.com', 'm.encar.com']);
const RESULT_TEXT_FIELDS = ['title', 'content', 'raw_content'];
const CATALOG_ERRORS = new Set(['CATALOG_BLOCKED', 'CATALOG_UNAVAILABLE', 'CATALOG_FORM_UNSUPPORTED',
  'CATALOG_PARSE_FAILED', 'CATALOG_INCOMPLETE', 'CATALOG_CONFIG_INVALID', 'CATALOG_PARSER_UNAVAILABLE', 'CATALOG_LIMIT_EXCEEDED', 'CATALOG_TIMEOUT']);
const REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
const PLATE = new RegExp('^(?:' + REGIONS + ')?[0-9]{2,3}[가-힣][0-9]{4}$');
const BLOCKED = /has_been_cr_blocked|서비스\s*이용\s*제한됨|비정상적인\s*트래픽|<title>\s*(?:Access Denied|Request blocked)/i;

class EncarError extends Error {
  constructor(code, safe = {}) {
    super(code); this.code = code;
    if (Number.isInteger(safe.retryAfterSeconds) && safe.retryAfterSeconds >= 0 && safe.retryAfterSeconds <= 86400) this.retryAfterSeconds = safe.retryAfterSeconds;
    if (Number.isInteger(safe.upstreamStatus) && safe.upstreamStatus >= 100 && safe.upstreamStatus <= 599) this.upstreamStatus = safe.upstreamStatus;
    if (['auth', 'member', 'search', 'detail', 'catalog', 'model_catalog', 'external', 'price'].includes(safe.stage)) this.stage = safe.stage;
  }
}

function retryAfterSeconds(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? Math.min(86400, seconds) : null;
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(text)) return null;
  const time = Date.parse(text), seconds = Math.ceil((time - now) / 1000);
  if (!Number.isFinite(time) || new Date(time).toUTCString().toLowerCase() !== text.toLowerCase()) return null;
  return Number.isSafeInteger(seconds) && seconds >= 0 ? Math.min(86400, seconds) : null;
}

function upstreamError(op, code, result, stage) {
  const error = new EncarError(code, { retryAfterSeconds: result.retryAfterSeconds, upstreamStatus: result.status, stage });
  const previous = op.failures.get(code);
  if (!previous || !(previous.retryAfterSeconds > (error.retryAfterSeconds ?? -1))) op.failures.set(code, error);
  return error;
}

function operation(request) {
  const controller = new AbortController(), startedAt = Date.now();
  const op = { requestId: crypto.randomUUID(), startedAt, deadline: startedAt + DEADLINE_MS,
    requestBudget: createEncarRequestBudget({ deadline: startedAt + DEADLINE_MS }),
    requestStage: 'input', budgetExhausted: false, budgetStage: null, failures: new Map(),
    controller, searchCount: 0, resultCount: 0, checkedCount: 0, plateMatchedCount: 0,
    resultPlateMatchCount: 0, rawResultCount: 0, recognizedSourceCount: 0, candidates: new Set(),
    catalogRequestCount: 0, catalogPageCount: 0, catalogRecordCount: 0, catalogExactMatchCount: 0,
    catalogFormCount: 0, catalogPlateFieldCount: 0, catalogLinkCount: 0, pagePrices: new Map(), priceDiagnostics: null,
    externalSources: new Set(), externalPriority: new Set(), plateLocalCandidates: new Set(), externalPages: new Map(), externalChecked: new Set(), externalIgnored: new Set(), externalEvidence: new Map(), externalSpentMs: 0, detailErrors: new Set(),
    externalMismatches: new Set(), searchEvidence: new Map(), searchEvidenceAccepted: new Set(), searchEvidenceCount: 0, searchEvidenceAcceptedCount: 0, parseReasonCounts: {},
    catalogResponses: new Map(), searchConfigured: null, discoveryStage: 'input', discoveryProvided: false,
    modelCatalogRequestCount: 0, modelCatalogPageCount: 0, modelCatalogRecordCount: 0, modelCatalogExactMatchCount: 0,
    modelBranchPageCount: 0, externalRequestCount: 0, externalMatchCount: 0, externalSkippedCount: 0,
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

function consumeRequest(op, stage, optional = false) {
  op.requestStage = stage;
  if (optional && op.requestBudget.remaining() <= OFFICIAL_REQUEST_RESERVE) {
    if (!op.budgetExhausted) op.budgetStage = stage;
    op.budgetExhausted = true;
    throw new EncarError('REQUEST_BUDGET_EXCEEDED');
  }
  try { op.requestBudget.consume(stage); }
  catch (error) {
    if (error?.code === 'REQUEST_BUDGET_EXCEEDED') {
      if (!op.budgetExhausted) op.budgetStage = stage;
      op.budgetExhausted = true;
    }
    if (['DEADLINE_EXCEEDED', 'REQUEST_BUDGET_EXCEEDED'].includes(error?.code)) throw new EncarError(error.code);
    throw error;
  }
}

function reuseRequest(op, stage) {
  op.requestStage = stage;
  try { op.requestBudget.reuse(stage); }
  catch (_) { throw new EncarError('DEADLINE_EXCEEDED'); }
}

function counters(op) {
  const budget = op.requestBudget.diagnostics();
  return { resolverRelease: RESOLVER_RELEASE, discoveryProvided: op.discoveryProvided,
    requestCount: budget.requestCount, reusedCount: budget.reusedCount,
    budgetLimit: budget.budgetLimit, budgetRemaining: budget.remaining,
    budgetExhausted: op.budgetExhausted, stage: op.budgetStage || op.requestStage,
    searchCount: op.searchCount, resultCount: op.resultCount,
    candidateCount: op.candidates.size, checkedCount: op.checkedCount,
    plateMatchedCount: op.plateMatchedCount, resultPlateMatchCount: op.resultPlateMatchCount,
    rawResultCount: op.rawResultCount, recognizedSourceCount: op.recognizedSourceCount,
    catalogRequestCount: op.catalogRequestCount, catalogPageCount: op.catalogPageCount,
    catalogRecordCount: op.catalogRecordCount, catalogExactMatchCount: op.catalogExactMatchCount,
    catalogFormCount: op.catalogFormCount, catalogPlateFieldCount: op.catalogPlateFieldCount, catalogLinkCount: op.catalogLinkCount,
    ...(typeof op.searchConfigured === 'boolean' ? { searchConfigured: op.searchConfigured } : {}),
    discoveryStage: op.discoveryStage, modelCatalogRequestCount: op.modelCatalogRequestCount,
    modelCatalogPageCount: op.modelCatalogPageCount, modelCatalogRecordCount: op.modelCatalogRecordCount,
    modelCatalogExactMatchCount: op.modelCatalogExactMatchCount, modelBranchPageCount: op.modelBranchPageCount,
    externalRequestCount: op.externalRequestCount, externalMatchCount: op.externalMatchCount, externalSkippedCount: op.externalSkippedCount,
    searchEvidenceCount: op.searchEvidenceCount, searchEvidenceAcceptedCount: op.searchEvidenceAcceptedCount, parseReasonCounts: { ...op.parseReasonCounts },
    rejected: { ...op.rejected } };
}

function response(op, httpStatus, plate = '', listings = [], status = 'error', code = 'INVALID_REQUEST') {
  if (op.budgetExhausted && !listings.length && !['SEARCH_RATE_LIMITED', 'SEARCH_QUOTA_EXCEEDED'].includes(code)) {
    httpStatus = 502; status = 'error'; code = 'REQUEST_BUDGET_EXCEEDED';
  }
  const body = {
    plate,
    verifiedAt: listings.length ? new Date().toISOString() : null,
    listings,
    status
  };
  const failure = code === 'REQUEST_BUDGET_EXCEEDED' ? null : op.failures.get(code);
  const retryAfter = code === 'REQUEST_BUDGET_EXCEEDED' ? BUDGET_RETRY_SECONDS : failure?.retryAfterSeconds;
  if (op.priceDiagnostics) body.priceDiagnostics = {
    providerRequests: op.priceDiagnostics.providerRequests,
    pageReviewCount: op.priceDiagnostics.pageReviewCount,
    codes: [...op.priceDiagnostics.codes].sort((a, b) => a.code.localeCompare(b.code) || (a.httpStatus || 0) - (b.httpStatus || 0))
  };
  if (status === 'error' || status === 'unverified') {
    body.diagnostics = { code, requestId: op.requestId, ...counters(op) };
    if (failure?.upstreamStatus) body.diagnostics.upstreamStatus = failure.upstreamStatus;
    if (failure?.stage) body.diagnostics.stage = failure.stage;
    console.info(JSON.stringify({ ...body.diagnostics, durationMs: Math.max(0, Date.now() - op.startedAt) }));
  }
  if (status === 'error' && Number.isInteger(retryAfter)) body.retryAfterSeconds = retryAfter;
  if (status === 'error' && code === 'SEARCH_QUOTA_EXCEEDED') body.autoRetry = false;
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': op.requestId,
      'X-Encar-Resolver-Release': RESOLVER_RELEASE,
      ...(status === 'error' && Number.isInteger(retryAfter) ? { 'Retry-After': String(retryAfter) } : {}),
      ...(httpStatus === 405 ? { Allow: 'POST' } : {})
    }
  });
}

function normalizePlate(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const plate = value.normalize('NFKC').replace(/[\s-]/g, '');
  return PLATE.test(plate) ? plate : '';
}

function discoveryOf(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['make', 'model', 'grade'].includes(key)) || !Object.hasOwn(value, 'make')) throw new EncarError('INVALID_REQUEST');
  const labels = {};
  for (const key of ['make', ...(Object.hasOwn(value, 'model') ? ['model'] : []), ...(Object.hasOwn(value, 'grade') ? ['grade'] : [])]) {
    if (typeof value[key] !== 'string' || value[key].length > 80 || /[\u0000-\u001f\u007f-\u009f\\/<>]/.test(value[key]) || /:\/\//.test(value[key])) throw new EncarError('INVALID_REQUEST');
    const label = value[key].normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!label || label.length > 80 || /[\u0000-\u001f\u007f-\u009f\\/<>]/.test(label)) throw new EncarError('INVALID_REQUEST');
    labels[key] = label;
  }
  return labels;
}

function explicitSourcesOf(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new EncarError('INVALID_REQUEST');
  try { return [...new Set(value.map(item => {
    if (typeof item !== 'string' || !/^https:\/\//i.test(item)) throw new EncarError('INVALID_REQUEST');
    return externalSourceURL(item).href;
  }))]; }
  catch (_) { throw new EncarError('INVALID_REQUEST'); }
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

async function fetchLimited(op, url, options = {}, maxBytes = MAX_SEARCH_BYTES, unavailable = 'SEARCH_UNAVAILABLE', stageSignal = null, stage = 'search', optional = false) {
  const budget = remaining(op);
  if (stageSignal?.aborted) throw stageSignal.reason;
  const controller = new AbortController();
  const abort = () => controller.abort(op.controller.signal.reason);
  const stopStage = () => controller.abort(stageSignal.reason);
  op.controller.signal.addEventListener('abort', abort, { once: true });
  stageSignal?.addEventListener('abort', stopStage, { once: true });
  const timer = setTimeout(() => controller.abort(new EncarError(budget <= TIMEOUT_MS ? 'DEADLINE_EXCEEDED' : 'UPSTREAM_TIMEOUT')), Math.min(TIMEOUT_MS, budget));
  try {
    consumeRequest(op, stage, optional);
    const fetched = await waitFor(fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal
    }), controller.signal);
    const text = await readLimited(fetched, maxBytes, controller.signal);
    const retryAfter = [429, 502, 503, 504].includes(fetched.status) ? retryAfterSeconds(fetched.headers.get('Retry-After')) : null;
    return { ok: fetched.ok, status: fetched.status, text, ...(retryAfter === null ? {} : { retryAfterSeconds: retryAfter }) };
  } catch (error) {
    if (error instanceof EncarError) throw error;
    if (error?.message === 'body-limit' && unavailable === 'CATALOG_UNAVAILABLE') throw new EncarError('CATALOG_LIMIT_EXCEEDED');
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new EncarError('UPSTREAM_TIMEOUT');
    throw new EncarError(unavailable);
  } finally {
    clearTimeout(timer);
    op.controller.signal.removeEventListener('abort', abort);
    stageSignal?.removeEventListener('abort', stopStage);
    controller.abort();
  }
}

async function authorize(op, request, supaUrl, supaKey) {
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+[A-Za-z0-9._-]{30,5000}$/i.test(bearer)) return { status: 401, code: 'AUTH_REQUIRED' };
  const headers = { apikey: supaKey, Authorization: bearer };
  const auth = await fetchLimited(op, supaUrl + '/auth/v1/user', { method: 'GET', headers }, 64 * 1024, 'AUTH_UNAVAILABLE', null, 'auth');
  if (!auth.ok) {
    const unavailable = auth.status >= 500 || auth.status === 429, code = unavailable ? 'AUTH_UNAVAILABLE' : 'AUTH_FAILED';
    upstreamError(op, code, auth, 'auth');
    return { status: unavailable ? 502 : 401, code };
  }
  let user;
  try { user = JSON.parse(auth.text); } catch (_) { throw new EncarError('AUTH_UNAVAILABLE'); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id || '')) return { status: 401, code: 'AUTH_FAILED' };
  const url = new URL(supaUrl + '/rest/v1/zc_members');
  url.searchParams.set('select', 'user_id');
  url.searchParams.set('user_id', 'eq.' + user.id);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('limit', '1');
  const membership = await fetchLimited(op, url.toString(), { method: 'GET', headers }, 64 * 1024, 'AUTH_UNAVAILABLE', null, 'member');
  if (!membership.ok) {
    const unavailable = membership.status >= 500 || membership.status === 429, code = unavailable ? 'AUTH_UNAVAILABLE' : 'STAFF_REQUIRED';
    upstreamError(op, code, membership, 'member');
    return { status: unavailable ? 502 : 403, code };
  }
  let members;
  try { members = JSON.parse(membership.text); } catch (_) { throw new EncarError('AUTH_UNAVAILABLE'); }
  return Array.isArray(members) && members.some(member => member?.user_id === user.id) ? null : { status: 403, code: 'STAFF_REQUIRED' };
}

function parsedURL(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const source = value.replace(/&amp;/g, '&');
    const authority = /^https?:\/\/([^/?#]+)/i.exec(source)?.[1];
    if (!authority || !/^[a-z0-9.-]+$/i.test(authority)) return null;
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function autoExportHost(host) {
  if (AUTO_EXPORT_HOSTS.includes(host)) return true;
  if (!host.endsWith('.trust-encar.ru') || host.length > 253) return false;
  return host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function recognizedSourceHost(host) {
  return RECOGNIZED_SOURCE_HOSTS.has(host) || (typeof host === 'string' && autoExportHost(host));
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
  if (autoExportHost(host)) {
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

// Search raw_content may be Markdown. These small, plate-local windows only
// rank discovery hints; original HTML and the final exact plate check remain
// mandatory. A different plate or a new Markdown card heading ends a window.
function plateLocalContent(result, plate) {
  const windows = [];
  for (const field of RESULT_TEXT_FIELDS) {
    if (typeof result?.[field] !== 'string') continue;
    const content = result[field].normalize('NFKC');
    const tokens = [];
    for (const token of content.matchAll(new RegExp('(?<![0-9])' + REGIONS + '?[0-9]{2,3}[\\s-]*[가-힣][\\s-]*[0-9]{4}(?![0-9])', 'g'))) {
      tokens.push(token);
      if (tokens.length >= 4096) break;
    }
    for (let index = 0; index < tokens.length && windows.length < 32; ++index) {
      const token = tokens[index];
      if (token[0].replace(/[\s-]/g, '') !== plate) continue;
      let start = Math.max(0, token.index - 1536, index ? tokens[index - 1].index + tokens[index - 1][0].length : 0);
      let end = Math.min(content.length, token.index + token[0].length + 1536, tokens[index + 1]?.index ?? content.length);
      const before = content.slice(start, token.index), beforeBoundaries = [...before.matchAll(/^\s*(?:#{1,6}\s+|[-*_]{3,}\s*$)/gm)];
      if (beforeBoundaries.length) start += beforeBoundaries.at(-1).index;
      const after = content.slice(token.index + token[0].length, end), nextBoundary = /^\s*(?:#{1,6}\s+|[-*_]{3,}\s*$)/m.exec(after);
      if (nextBoundary) end = token.index + token[0].length + nextBoundary.index;
      windows.push(content.slice(start, end));
    }
  }
  return windows;
}

function parseReason(op, code) {
  op.parseReasonCounts[code] = Math.min(1000, (op.parseReasonCounts[code] || 0) + 1);
}

function rememberSearchEvidence(op, results, plate, discovery, checkedAt) {
  if (!discovery?.make) return;
  for (const result of results) {
    let source;
    try { source = externalSourceURL(result?.url); } catch { continue; }
    if (!resultMentionsPlate(result, plate)) continue;
    for (const field of RESULT_TEXT_FIELDS) {
      if (typeof result?.[field] !== 'string') continue;
      // Full Markdown card boundaries are retained here. Unlike hint windows,
      // another plate in this same block makes the search proof ambiguous.
      const content = result[field].normalize('NFKC');
      const blocks = content.split(/(?=^#{1,6}\s+)|^\s*[-*_]{3,}\s*$/gm, 4096);
      for (const block of blocks) {
        if (block.length > 8192 || !resultMentionsPlate({ content: block }, plate)) continue;
        const visible = block.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/[^\s<>"'\\]+/gi, '');
        const plates = new Set([...visible.matchAll(new RegExp('(?<![0-9])' + REGIONS + '?[0-9]{2,3}[\\s-]*[가-힣][\\s-]*[0-9]{4}(?![0-9])', 'g'))].map(match => normalizePlate(match[0])));
        plates.delete('');
        if (plates.size !== 1 || !plates.has(plate)) { parseReason(op, 'SEARCH_PLATE_AMBIGUOUS'); continue; }
        if (!manufacturerMatches(visible, discovery.make)) { parseReason(op, 'SEARCH_MANUFACTURER_MISMATCH'); continue; }
        const ids = new Set();
        for (const match of block.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
          const id = idFromURL(match[0].replace(/[),.;\]}]+$/, ''));
          if (id) ids.add(id);
        }
        const plain = visible.replace(/[*_`]/g, '');
        for (const match of plain.matchAll(/(?:^|[^\p{L}\p{N}])(?:Лот(?:\s+объявления)?|Номер\s+лота|Lot(?:\s+(?:number|no\.?))?|Encar\s*ID|엔카\s*매물\s*번호)\s*[:：#№]?\s*([0-9]+)(?![0-9])/giu)) {
          const id = idOf(match[1]); if (id) ids.add(id);
        }
        if (ids.size !== 1) { parseReason(op, ids.size ? 'SEARCH_ID_AMBIGUOUS' : 'SEARCH_ID_MISSING'); continue; }
        const id = [...ids][0], sourceId = idFromURL(source.href);
        if (sourceId && sourceId !== id) { parseReason(op, 'SEARCH_SOURCE_ID_MISMATCH'); continue; }
        if (!op.searchEvidence.has(id) && op.searchEvidence.size < MAX_CANDIDATES) {
          op.searchEvidence.set(id, { source: 'trust-encar', sourceUrl: source.href, checkedAt,
            advertisedAt: null, modifiedAt: null, method: 'search-index' });
          ++op.searchEvidenceCount;
          op.plateLocalCandidates.add(id);
          rememberExternalSource(op, source.href, true);
        }
      }
    }
  }
}

function rememberExternalSource(op, value, priority = false) {
  if (op.externalSources.size >= MAX_TOTAL_CANDIDATES) return;
  try {
    const url = externalSourceURL(value).href;
    op.externalSources.add(url);
    if (priority) op.externalPriority.add(url);
  } catch (_) { /* Only public allowlisted advertisements/catalogues qualify. */ }
}

function rememberExternalResults(op, results, plate) {
  const ranked = results.slice(0, 8).map(result => ({ result, matches: resultMentionsPlate(result, plate) }));
  for (const { result } of ranked.filter(item => item.matches)) for (const local of plateLocalContent(result, plate)) {
    for (const match of local.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) rememberExternalSource(op, match[0].replace(/[),.;\]}]+$/, ''), true);
  }
  for (const matches of [true, false]) for (const { result } of ranked.filter(item => item.matches === matches)) {
    rememberExternalSource(op, result?.url, matches);
    for (const key of RESULT_TEXT_FIELDS) if (typeof result?.[key] === 'string') {
      for (const match of result[key].matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
        rememberExternalSource(op, match[0].replace(/[),.;\]}]+$/, ''));
      }
    }
  }
}

function candidatesFromResults(results, plate, op = null) {
  const ids = new Set();
  const add = value => {
    const id = idOf(value);
    if (id && ids.size < MAX_CANDIDATES) ids.add(id);
  };
  const addLocal = value => {
    const id = idOf(value);
    if (id && op && op.plateLocalCandidates.size < MAX_CANDIDATES) op.plateLocalCandidates.add(id);
    add(value);
  };
  const limited = results.slice(0, 8).map(result => ({ result, matches: resultMentionsPlate(result, plate) }));
  for (const { result } of limited.filter(item => item.matches)) {
    const sourceHost = parsedURL(result?.url)?.hostname.toLowerCase().replace(/^www\./, '');
    for (const local of plateLocalContent(result, plate)) {
      for (const match of local.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) addLocal(idFromURL(match[0].replace(/[),.;\]}]+$/, '')));
      const plain = local.replace(/[*_`]/g, '');
      for (const match of plain.matchAll(/(?:\bEncar\s*ID|엔카\s*매물\s*번호)\s*[:：#]\s*([0-9]+)(?![0-9])/giu)) addLocal(match[1]);
      if (autoExportHost(sourceHost || '') || sourceHost === 'carsbat.com') {
        for (const match of plain.matchAll(/(?:^|[^\p{L}\p{N}])(?:Лот(?:\s+объявления)?|Номер\s+лота|Lot(?:\s+(?:number|no\.?))?)\s*[:：#№]?\s*([0-9]+)(?![0-9])/giu)) addLocal(match[1]);
      }
    }
  }
  // Exact-plate evidence gets the bounded candidate slots first. Within each
  // relevance group, indexed URLs precede incidental links in snippets.
  for (const matches of [true, false]) {
    const group = limited.filter(item => item.matches === matches).map(item => item.result);
    for (const result of group) add(idFromURL(result?.url));
    for (const result of group) {
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
      // A branded listing label is a hint only when this indexed result
      // explicitly mentions the requested plate. Bare numbers never qualify.
      if (matches) {
        for (const match of content.normalize('NFKC').matchAll(/(?:\bEncar\s*ID|엔카\s*매물\s*번호)\s*[:：#]\s*([0-9]+)(?![0-9])/giu)) add(match[1]);
        if (autoExportHost(sourceHost || '')) {
          // A catalogue lot label is only a discovery hint. A snippet cannot
          // bind its plate to this ID; the original HTML must do that below.
          for (const match of content.normalize('NFKC').matchAll(/(?:^|[^\p{L}\p{N}])(?:Лот(?:\s+объявления)?|Lot(?:\s+(?:number|no\.?))?)\s*[:：#№]\s*([0-9]+)(?![0-9])/giu)) add(match[1]);
        }
      }
      if (ids.size >= MAX_CANDIDATES) break;
    }
    if (ids.size >= MAX_CANDIDATES) break;
  }
  return [...ids];
}

async function searchCandidates(op, plate, apiKey, fallback = false, discovery = null) {
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
      query: '"' + plate + '"',
      exact_match: true,
      search_depth: 'basic',
      max_results: 8,
      auto_parameters: false,
      include_answer: false,
      include_raw_content: fallback,
      ...(fallback ? { include_domains: SEARCH_SOURCE_DOMAINS } : {})
    })
  }, fallback ? MAX_RAW_SEARCH_BYTES : MAX_SEARCH_BYTES);
  if (!result.ok) {
    if ([401, 403].includes(result.status)) throw upstreamError(op, 'SEARCH_AUTH_FAILED', result, 'search');
    if ([432, 433].includes(result.status)) throw upstreamError(op, 'SEARCH_QUOTA_EXCEEDED', result, 'search');
    if (result.status === 429) throw upstreamError(op, 'SEARCH_RATE_LIMITED', result, 'search');
    throw upstreamError(op, 'SEARCH_UNAVAILABLE', result, 'search');
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
    if (recognizedSourceHost(host)) ++op.recognizedSourceCount;
  }
  rememberExternalResults(op, results, plate);
  rememberSearchEvidence(op, results, plate, discovery, new Date().toISOString());
  return [...new Set([...op.searchEvidence.keys(), ...candidatesFromResults(results, plate, op)])].slice(0, MAX_CANDIDATES);
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
    }, MAX_HTML_BYTES, 'DETAIL_UNAVAILABLE', null, 'detail');
    if (BLOCKED.test(fetched.text) || [403, 429].includes(fetched.status)) { upstreamError(op, 'DETAIL_BLOCKED', fetched, 'detail'); return { kind: 'error', code: 'DETAIL_BLOCKED' }; }
    if (fetched.status === 404 || fetched.status === 410) { ++op.rejected.notFound; return { kind: 'unverified' }; }
    if (!fetched.ok) { upstreamError(op, 'DETAIL_UNAVAILABLE', fetched, 'detail'); return { kind: 'error', code: 'DETAIL_UNAVAILABLE' }; }
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
    if (originalId === id && !identity.dummy) {
      const budget = Math.min(1000, op.deadline - Date.now() - 250);
      if (budget >= 50 && !op.controller.signal.aborted) {
        const controller = new AbortController(), abort = () => controller.abort(new EncarError('PRICE_UNAVAILABLE'));
        op.controller.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, budget);
        try { const page = await waitFor(parseEncarPagePrice(fetched.text), controller.signal);op.pagePrices.set(originalId, { ...page, checkedAt: page.candidate ? new Date().toISOString() : null }); }
        catch (_) { op.pagePrices.set(originalId, { candidate: null, code: 'PAGE_TIMEOUT' }); }
        finally { clearTimeout(timer); op.controller.signal.removeEventListener('abort', abort); controller.abort(); }
      } else op.pagePrices.set(originalId, { candidate: null, code: 'PAGE_TIMEOUT' });
    }
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

async function externalListings(op, plate, getDetail, select) {
  const urls = [...op.externalSources].filter(url => !op.externalChecked.has(url) && !op.externalIgnored.has(url))
    .sort((a, b) => Number(op.externalPriority.has(b)) - Number(op.externalPriority.has(a)));
  const budget = Math.min(EXTERNAL_BUDGET_MS - op.externalSpentMs, remaining(op) - 250);
  if (urls.length && budget >= 50) {
    const startedAt = Date.now();
    const controller = new AbortController(), signal = controller.signal;
    const abort = () => controller.abort(op.controller.signal.reason);
    op.controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new EncarError('UPSTREAM_TIMEOUT')), budget);
    try {
      await mapConcurrent(urls, async value => {
        try {
          const url = externalSourceURL(value);
          const sourceId = idFromURL(url.href);
          if (sourceId && op.candidates.has(sourceId)) {
            const official = await getDetail(sourceId);
            if (official.kind !== 'error' || !EXTERNAL_DETAIL_ERRORS.has(official.code)) {
              op.externalIgnored.add(value); ++op.externalSkippedCount;
              return;
            }
          }
          let page = op.externalPages.get(url.href);
          if (!page) {
            if (op.externalRequestCount >= MAX_EXTERNAL_PAGES || signal.aborted) return;
            ++op.externalRequestCount;
            op.externalChecked.add(value);
            const fetched = await fetchLimited(op, url.href, {
              method: 'GET', headers: { Accept: 'text/html' },
              credentials: 'omit', referrerPolicy: 'no-referrer'
            }, MAX_HTML_BYTES, 'DETAIL_UNAVAILABLE', signal, 'external', true);
            if (!fetched.ok || BLOCKED.test(fetched.text)) return;
            page = { html: fetched.text, checkedAt: new Date().toISOString() };
          } else { op.externalChecked.add(value); reuseRequest(op, 'external'); }
          const parsed = await waitFor(parseExternalAdvertisement(page.html, url.href, plate), signal);
          if (parsed.kind === 'detail' && !parsed.matches.length) op.externalMismatches.add(url.href);
          for (const item of (Array.isArray(parsed?.matches) ? parsed.matches : []).slice(0, 12)) {
            const id = idOf(item?.id);
            if (!id || externalSourceURL(item.sourceUrl).href !== url.href || op.externalEvidence.has(id)) continue;
            op.externalEvidence.set(id, {
              source: 'trust-encar', sourceUrl: url.href, checkedAt: page.checkedAt,
              advertisedAt: item.advertisedAt ?? null, modifiedAt: item.modifiedAt ?? null
            });
            ++op.externalMatchCount;
          }
        } catch (error) {
          if (error?.sourceConflict === true) op.externalMismatches.add(value);
          if (error?.code === 'CATALOG_PARSE_FAILED' || error?.code === 'CATALOG_PARSER_UNAVAILABLE') parseReason(op, 'EXTERNAL_HTML_PARSE_FAILED');
          /* A blocked or ambiguous public page is never HTML evidence. */
        }
      });
    } finally {
      op.externalSpentMs += Math.max(0, Date.now() - startedAt);
      clearTimeout(timer);
      op.controller.signal.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  remaining(op);
  const ids = select([...op.externalEvidence.keys()]);
  if (!ids.length) return [];
  // Source pages can discover an ID omitted from a search snippet. It still
  // receives the same official check; explicit rejections must win over a mirror.
  const verified = await verifyCandidates(ids, getDetail);
  const listings = new Map(verified.listings.map(item => [item.id, item]));
  for (const id of ids) {
    if (listings.has(id)) continue;
    const official = await getDetail(id);
    if (official.kind !== 'error' || !EXTERNAL_DETAIL_ERRORS.has(official.code)) continue;
    listings.set(id, {
      id, sellerUrl: ENCAR_DETAIL + id, trustedId: null, trustedUrl: null, model: '',
      externalVerification: op.externalEvidence.get(id), ...unavailablePrice()
    });
  }
  return [...listings.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function searchListings(op, plate, getDetail, select) {
  const ids = select([...op.searchEvidence.keys()]);
  if (!ids.length) return [];
  const verified = await verifyCandidates(ids, getDetail);
  const listings = new Map(verified.listings.map(item => [item.id, item]));
  for (const id of ids) {
    if (listings.has(id)) continue;
    const evidence = op.searchEvidence.get(id), official = await getDetail(id);
    if (official.kind !== 'error' || !EXTERNAL_DETAIL_ERRORS.has(official.code) || op.externalMismatches.has(evidence.sourceUrl)) continue;
    listings.set(id, { id, sellerUrl: ENCAR_DETAIL + id, trustedId: null, trustedUrl: null, model: '',
      externalVerification: evidence, ...unavailablePrice() });
    if (!op.searchEvidenceAccepted.has(id)) {
      op.searchEvidenceAccepted.add(id); ++op.searchEvidenceAcceptedCount;
    }
  }
  return [...listings.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function unavailablePrice() {
  return { priceWon: null, priceCheckedAt: null, priceSource: null, priceStatus: 'unavailable' };
}

// The provider documents uppercase Price in units of 10,000 KRW. Do not use
// translated/EUR fields, priceDrop.previousPrice, or guesses from arbitrary HTML.
function priceInWon(value) {
  if (typeof value !== 'string' && typeof value !== 'number' || typeof value === 'number' && !Number.isFinite(value)) return null;
  const text = String(value);
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const won = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  return won > 0n && won <= BigInt(MAX_PRICE_WON) ? Number(won) : null;
}

function providerPrice(data, id, plate) {
  const invalid = code => ({ priceWon: null, code });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const matches = [];
  function inspect(value, depth = 0) {
    if (!object(value) || depth > 3 || matches.length > 1) return;
    // Binding to the canonical seller ID is mandatory. The same ID's plate and
    // live ADVERTISE state were already verified on Encar immediately above.
    if (Object.hasOwn(value, 'Id') && Object.hasOwn(value, 'Price')) matches.push(value);
    for (const key of ['data', 'result', 'car', 'vehicle', 'listing', 'item', 'payload']) {
      if (Object.hasOwn(value, key)) inspect(value[key], depth + 1);
    }
  }
  inspect(data);
  if (matches.length !== 1) return invalid('SCHEMA_INVALID');
  const row = matches[0];
  if (idOf(row.Id) !== id) return invalid('ID_MISMATCH');
  for (const value of [row, row.details].filter(object)) {
    for (const key of ['VehicleNo', 'vehicleNo', 'CarNo', 'carNo', 'VehicleNumber', 'vehicleNumber']) {
      if (Object.hasOwn(value, key) && normalizePlate(value[key]) !== plate) return invalid('CONTEXT_MISMATCH');
    }
    for (const key of ['Status', 'status', 'AdvertisementStatus', 'advertisementStatus']) {
      if (Object.hasOwn(value, key) && !['ADVERTISE', 'ACTIVE', 'AVAILABLE', 'ON_SALE', 'FOR_SALE'].includes(value[key])) return invalid('CONTEXT_MISMATCH');
    }
    for (const key of ['Sold', 'sold', 'IsSold', 'isSold']) if (Object.hasOwn(value, key) && value[key] !== false) return invalid('CONTEXT_MISMATCH');
    for (const key of ['Available', 'available', 'IsAvailable', 'isAvailable']) if (Object.hasOwn(value, key) && value[key] !== true) return invalid('CONTEXT_MISMATCH');
    for (const key of ['Currency', 'currency']) if (Object.hasOwn(value, key) && value[key] !== 'KRW') return invalid('CURRENCY_UNSUPPORTED');
    for (const key of ['PriceType', 'priceType', 'SaleType', 'saleType', 'SellType', 'sellType']) {
      if (Object.hasOwn(value, key) && !['CASH', 'SALE', 'NORMAL', '매매', '일반'].includes(value[key])) return invalid('NON_CASH_PRICE');
    }
    for (const key of ['Lease', 'lease', 'IsLease', 'isLease', 'Rental', 'rental', 'IsRental', 'isRental']) {
      if (Object.hasOwn(value, key) && value[key] !== false) return invalid('NON_CASH_PRICE');
    }
  }
  const priceWon = priceInWon(row.Price);
  return { priceWon, code: priceWon === null ? 'PRICE_INVALID' : null };
}

function priceDiagnostic(op, code, httpStatus = null, count = 1) {
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) httpStatus = null;
  const row = op.priceDiagnostics.codes.find(item => item.code === code && item.httpStatus === httpStatus);
  if (row) row.count += count;
  else op.priceDiagnostics.codes.push({ code, httpStatus, count });
}

async function addPrices(op, env, listings, plate) {
  const result = listings.map(item => ({ ...item, ...unavailablePrice() }));
  op.priceDiagnostics = { providerRequests: 0, pageReviewCount: 0, codes: [] };
  const fallback = () => {
    for (const item of result) if (item.priceStatus !== 'verified') {
      const page = op.pagePrices.get(item.id);
      if (page?.candidate) {
        Object.assign(item, { priceWon: page.candidate.priceWon, priceCheckedAt: page.checkedAt, priceSource: 'encar.com', priceStatus: 'review' });
        op.priceDiagnostics.pageReviewCount++;
      } else priceDiagnostic(op, page?.code || 'PAGE_EMPTY');
    }
    return result;
  };
  const key = typeof env.ENCAR_API_KEY === 'string' ? env.ENCAR_API_KEY.trim() : '';
  const budget = Math.min(PRICE_TIMEOUT_MS, op.deadline - Date.now() - 250);
  if (!key) { priceDiagnostic(op, 'KEY_MISSING', null, result.length); return fallback(); }
  if (key.length < 8 || key.length > 1024 || !/^[\x21-\x7e]+$/.test(key)) { priceDiagnostic(op, 'KEY_INVALID', null, result.length); return fallback(); }
  if (budget < 250 || op.controller.signal.aborted) { priceDiagnostic(op, 'TIMEOUT', null, result.length); return fallback(); }
  if (result.length > MAX_PRICE_LISTINGS) priceDiagnostic(op, 'LIMIT_SKIPPED', null, result.length - MAX_PRICE_LISTINGS);
  const controller = new AbortController();
  const abort = () => controller.abort(new EncarError('PRICE_UNAVAILABLE'));
  op.controller.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, budget);
  try {
    await Promise.all(result.slice(0, MAX_PRICE_LISTINGS).map(async item => {
      let httpStatus = null;
      try {
        const url = new URL(PRICE_PROVIDER); url.searchParams.set('id', item.id);
        consumeRequest(op, 'price');
        op.priceDiagnostics.providerRequests++;
        const fetched = await waitFor(fetch(url.href, {
          method: 'GET', headers: { 'x-api-key': key, Accept: 'application/json' },
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
          redirect: 'manual', signal: controller.signal
        }), controller.signal);
        httpStatus = fetched.status;
        if (fetched.status !== 200 || (fetched.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
          try { void fetched.body?.cancel().catch(() => {}); } catch (_) {}
          const code = [401, 403].includes(fetched.status) ? 'AUTH_FAILED' : fetched.status === 429 ? 'RATE_LIMITED' : fetched.status >= 300 && fetched.status < 400 ? 'REDIRECT' : fetched.status === 200 ? 'SCHEMA_INVALID' : 'UNAVAILABLE';
          priceDiagnostic(op, code, httpStatus);
          return;
        }
        const raw = await readLimited(fetched, 1024 * 1024, controller.signal);
        let data;try { data = JSON.parse(raw); } catch (_) { priceDiagnostic(op, 'SCHEMA_INVALID', httpStatus); return; }
        const { priceWon, code } = providerPrice(data, item.id, plate);
        if (priceWon === null) { priceDiagnostic(op, code, httpStatus); return; }
        if (controller.signal.aborted) { priceDiagnostic(op, 'TIMEOUT', httpStatus); return; }
        Object.assign(item, { priceWon, priceCheckedAt: new Date().toISOString(), priceSource: 'encar-api.com', priceStatus: 'verified' });
      } catch (error) { priceDiagnostic(op, error?.code === 'REQUEST_BUDGET_EXCEEDED' ? 'REQUEST_BUDGET_EXCEEDED' : controller.signal.aborted ? 'TIMEOUT' : error?.message === 'body-limit' ? 'RESPONSE_LIMIT' : 'UNAVAILABLE', httpStatus); }
    }));
  } finally {
    clearTimeout(timer);
    op.controller.signal.removeEventListener('abort', abort);
    controller.abort();
  }
  return fallback();
}

function catalogError(error, fallback = 'CATALOG_PARSE_FAILED') {
  if (error instanceof EncarError) return error;
  return new EncarError(CATALOG_ERRORS.has(error?.code) ? error.code : fallback);
}

async function catalogHTML(op, url, stageSignal = null) {
  const safeURL = catalogURL(url);
  remaining(op);
  if (stageSignal?.aborted) throw stageSignal.reason;
  const cacheKey = /^\/catalog\/?$/.test(safeURL.pathname) && !safeURL.search ? safeURL.origin + '/catalog/' : safeURL.href;
  const stage = op.discoveryStage === 'model_catalog' ? 'model_catalog' : 'catalog';
  if (op.catalogResponses.has(cacheKey)) { reuseRequest(op, stage); return op.catalogResponses.get(cacheKey).html; }
  ++op.catalogRequestCount;
  const result = await fetchLimited(op, safeURL.href, { method: 'GET', headers: { Accept: 'text/html' } }, MAX_HTML_BYTES, 'CATALOG_UNAVAILABLE', stageSignal, stage, true);
  if (BLOCKED.test(result.text) || [403, 429].includes(result.status) || /<title>\s*(?:Just a moment|Attention Required)/i.test(result.text)) throw upstreamError(op, 'CATALOG_BLOCKED', result, stage);
  if (!result.ok) throw upstreamError(op, 'CATALOG_UNAVAILABLE', result, stage);
  op.catalogResponses.set(cacheKey, { html: result.text, checkedAt: new Date().toISOString() });
  return result.text;
}

async function modelCatalogCandidates(op, plate, discovery) {
  if (!discovery?.model) return [];
  const budget = Math.min(MODEL_CATALOG_BUDGET_MS, remaining(op) - 250);
  if (budget < 50) return [];
  const controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(op.controller.signal.reason);
  op.controller.signal.addEventListener('abort', abort, { once: true });
  if (op.controller.signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new EncarError('CATALOG_TIMEOUT')), budget);
  const getHTML = async url => {
    const before = op.catalogRequestCount;
    try { return await catalogHTML(op, url, signal); }
    finally { op.modelCatalogRequestCount += op.catalogRequestCount - before; }
  };
  try {
    // /catalog/ is an observed public directory. Manufacturer and model paths
    // are never constructed from hints: each is an actual visible page anchor.
    const directory = catalogURL(CATALOG_ORIGIN + '/catalog/');
    const directoryHTML = await getHTML(directory);
    const makeURL = await waitFor(discoverVehicleCatalogLink(directoryHTML, directory.href, discovery, 'make'), signal);
    if (!makeURL) return [];
    const makeHTML = await getHTML(makeURL);
    const modelURL = await waitFor(discoverVehicleCatalogLink(makeHTML, makeURL.href, discovery, 'model'), signal);
    if (!modelURL) return [];
    const rootPath = modelURL.pathname.replace(/\/$/, '');
    const visited = new Set(), pending = [{ url: catalogURL(modelURL), pageNumber: 1 }];
    let incomplete = false;
    while (pending.length) {
      if (op.modelCatalogPageCount >= MAX_MODEL_DISCOVERY_PAGES) throw new EncarError('CATALOG_INCOMPLETE');
      const { url: current, pageNumber } = pending.shift();
      if (visited.has(current.href)) { incomplete = true; continue; }
      visited.add(current.href);
      const html = await getHTML(current);
      const branches = await waitFor(discoverCatalogBranches(html, current.href, discovery), signal);
      let parsed;
      try { parsed = await waitFor(parseExternalAdvertisement(html, current.href, plate), signal); }
      catch (error) {
        if (error?.code === 'CATALOG_PARSE_FAILED') parseReason(op, 'MODEL_HTML_PARSE_FAILED');
        // A navigation-only generation/grade directory can have no vehicle
        // cards. Only actual bounded child anchors permit further discovery.
        if (!branches.length || error?.code !== 'CATALOG_PARSE_FAILED') throw error;
        parsed = { recordCount: 0, matches: [] };
      }
      ++op.modelCatalogPageCount;
      if (current.pathname.replace(/\/$/, '') !== rootPath) ++op.modelBranchPageCount;
      op.modelCatalogRecordCount += parsed.recordCount;
      const matches = parsed.matches.slice(0, 12);
      op.modelCatalogExactMatchCount += matches.length;
      if (matches.length) {
        const ids = [...new Set(matches.map(item => idOf(item.id)).filter(Boolean))];
        const cached = op.catalogResponses.get(current.href);
        const checkedAt = cached?.checkedAt || new Date().toISOString();
        rememberExternalSource(op, current.href, true);
        op.externalPages.set(current.href, { html, checkedAt });
        for (const item of matches) {
          const id = idOf(item.id);
          if (!id || item.sourceUrl !== current.href || op.externalEvidence.has(id)) continue;
          op.externalEvidence.set(id, { source: 'trust-encar', sourceUrl: current.href, checkedAt,
            advertisedAt: item.advertisedAt ?? null, modifiedAt: item.modifiedAt ?? null });
          ++op.externalMatchCount;
        }
        // The final identity test is the plate in this card, not these hints.
        // A positive relationship needs no exhaustive scan for other adverts.
        return ids;
      }
      const next = await waitFor(getObservedCatalogNext(html, current.href), signal);
      const descendants = branches.filter(url => !visited.has(url.href)).map(url => ({ url: catalogURL(url), pageNumber: 1 }));
      if (next) {
        if (pageNumber >= MAX_MODEL_CATALOG_PAGES || visited.has(next.href)) incomplete = true;
        else descendants.push({ url: catalogURL(next, current.href), pageNumber: pageNumber + 1 });
      }
      // Depth first: an observed grade branch is checked before another page
      // of its parent catalogue; optional hints only order these siblings.
      pending.unshift(...descendants);
    }
    if (incomplete) throw new EncarError('CATALOG_INCOMPLETE');
    return [];
  } catch (error) { throw catalogError(error); }
  finally {
    clearTimeout(timer);
    op.controller.signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

async function catalogCandidates(op, env, plate, reserveFallback = false) {
  const suffix = plate.slice(-4);
  const controller = reserveFallback ? new AbortController() : null;
  const abort = () => controller?.abort(op.controller.signal.reason);
  const signal = controller?.signal || op.controller.signal;
  if (controller) {
    op.controller.signal.addEventListener('abort', abort, { once: true });
    if (op.controller.signal.aborted) abort();
  }
  const timer = controller ? setTimeout(() => controller.abort(new EncarError('CATALOG_TIMEOUT')), CATALOG_FALLBACK_BUDGET_MS) : null;
  let searchURL;
  try {
    const template = env.ENCAR_CATALOG_SEARCH_URL;
    searchURL = template === undefined || (typeof template === 'string' && !template.trim()) ? null : configuredCatalogSearch(template, suffix);
    if (!searchURL) {
      const home = catalogURL(CATALOG_ORIGIN + '/');
      const html = await catalogHTML(op, home, signal);
      let form;
      try { form = await waitFor(discoverCatalogSearch(html, home.href, suffix), signal); }
      catch (error) {
        if (error?.code !== 'CATALOG_FORM_UNSUPPORTED') throw error;
        const entry = await waitFor(discoverCatalogEntry(html, home.href), signal);
        const entryHTML = await catalogHTML(op, entry, signal);
        form = await waitFor(discoverCatalogSearch(entryHTML, entry.href, suffix), signal);
      }
      op.catalogFormCount += form.formCount;
      op.catalogPlateFieldCount += form.plateFieldCount;
      searchURL = catalogURL(form.url);
    }
    const original = catalogURL(searchURL), visited = new Set(), ids = new Set(), pages = new Map();
    const filterKeys = [...new Set(original.searchParams.keys())].filter(key => original.searchParams.getAll(key).some(value => value.includes(suffix)));
    if (!filterKeys.length) throw new EncarError('CATALOG_FORM_UNSUPPORTED');
    let current = original;
    for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
      if (visited.has(current.href)) throw new EncarError('CATALOG_INCOMPLETE');
      visited.add(current.href);
      const html = await catalogHTML(op, current, signal);
      const checkedAt = new Date().toISOString();
      const parsed = await waitFor(parseCatalogPage(html, current.href, plate), signal);
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
      if (parsed.exactMatchCount) pages.set(current.href, { html, checkedAt });
      if (!parsed.nextUrl) {
        // Reuse only complete catalogue runs. A truncated run must not later
        // masquerade as a complete external match through an early page.
        for (const [url, page] of pages) {
          rememberExternalSource(op, url);
          op.externalPages.set(url, page);
        }
        return [...ids];
      }
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
  } finally {
    clearTimeout(timer);
    op.controller.signal.removeEventListener('abort', abort);
    controller?.abort();
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
  const found = async listings => {
    remaining(op);
    const official = listings.filter(item => !item.externalVerification);
    const priced = official.length ? await addPrices(op, env, official, plate) : [];
    const byId = new Map(priced.map(item => [item.id, item]));
    const result = listings.map(item => item.externalVerification ? { ...item, ...unavailablePrice() } : byId.get(item.id));
    return finish(200, result, listings.length > 1 ? 'multiple' : 'found');
  };
  const detailFailure = () => ['DEADLINE_EXCEEDED', 'UPSTREAM_TIMEOUT', 'DETAIL_BLOCKED', 'DETAIL_PARSE_FAILED', 'AD_STATUS_UNKNOWN', 'DETAIL_UNAVAILABLE']
    .find(code => op.detailErrors.has(code)) || [...op.detailErrors][0];
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
    op.searchConfigured = !!apiKey;
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
    let discovery, sourceUrls;
    try { discovery = discoveryOf(payload?.discovery); sourceUrls = explicitSourcesOf(payload?.sourceUrls); }
    catch (_) { return finish(400); }
    op.discoveryProvided = !!discovery;
    const memo = new Map();
    const getDetail = id => {
      if (!memo.has(id)) memo.set(id, detail(op, id, plate).then(result => {
        if (result.kind === 'error') op.detailErrors.add(result.code);
        return result;
      }));
      else reuseRequest(op, 'detail');
      return memo.get(id);
    };
    const sourceIds = sourceUrls.map(idFromURL).filter(Boolean);
    const hints = select([...new Set([...sourceIds, ...idsOf(payload.candidateIds), ...await cachedCandidates(op, env, plate)])].slice(0, MAX_HINT_CANDIDATES));
    const knownHintFallback = async () => {
      const known = [...new Set([...op.plateLocalCandidates, ...hints])];
      if (!known.length) return [];
      let count = 0;
      for (const id of known) {
        const official = await getDetail(id);
        if (official.kind !== 'error' || !EXTERNAL_DETAIL_ERRORS.has(official.code)) continue;
        rememberExternalSource(op, KNOWN_HINT_SOURCE + id + '/', true);
        if (++count === 3) break;
      }
      return count ? externalListings(op, plate, getDetail, select) : [];
    };
    op.discoveryStage = 'saved_candidates';
    const hinted = await verifyCandidates(hints, getDetail);
    if (hinted.listings.length) {
      saveCandidates(context, plate, hinted.listings.map(item => item.id));
      remaining(op);
      return await found(hinted.listings);
    }
    if (sourceUrls.length) {
      op.discoveryStage = 'explicit_source';
      for (const source of sourceUrls) rememberExternalSource(op, source, true);
      const explicit = await externalListings(op, plate, getDetail, select);
      if (explicit.length) {
        saveCandidates(context, plate, explicit.map(item => item.id));
        return await found(explicit);
      }
    }
    const searchAttempt = async attempt => {
      op.discoveryStage = attempt ? 'search_targeted' : 'search_exact';
      const candidates = select(await searchCandidates(op, plate, apiKey, attempt === 1, discovery));
      const verified = await verifyCandidates(candidates, getDetail);
      if (verified.listings.length) return verified.listings;
      const external = await externalListings(op, plate, getDetail, select);
      if (external.length) return external;
      return searchListings(op, plate, getDetail, select);
    };
    let earlySearch = false, searchFailure = null;
    // A caller's make is enough to evaluate a same-card search observation.
    // Public catalogue forms and model names are no prerequisite for this path.
    if (apiKey && discovery) {
      earlySearch = true;
      try {
        const listings = await searchAttempt(0);
        if (listings.length) {
          saveCandidates(context, plate, listings.map(item => item.id));
          return await found(listings);
        }
      } catch (error) { searchFailure = error; }
    }
    let catalogFailure = null;
    op.discoveryStage = 'catalog_form';
    try {
      const candidates = select(await catalogCandidates(op, env, plate, !!apiKey || !!discovery));
      const verified = await verifyCandidates(candidates, getDetail);
      if (verified.listings.length) {
        remaining(op);
        saveCandidates(context, plate, verified.listings.map(item => item.id));
        return await found(verified.listings);
      }
      const external = await externalListings(op, plate, getDetail, select);
      if (external.length) {
        saveCandidates(context, plate, external.map(item => item.id));
        return await found(external);
      }
    } catch (error) {
      catalogFailure = catalogError(error);
    }
    if (discovery?.model) {
      op.discoveryStage = 'model_catalog';
      try {
        const candidates = select(await modelCatalogCandidates(op, plate, discovery));
        const verified = await verifyCandidates(candidates, getDetail);
        if (verified.listings.length) {
          saveCandidates(context, plate, verified.listings.map(item => item.id));
          return await found(verified.listings);
        }
        const external = await externalListings(op, plate, getDetail, select);
        if (external.length) {
          saveCandidates(context, plate, external.map(item => item.id));
          return await found(external);
        }
      } catch (error) {
        // Model hints only narrow discovery. A wrong or absent hint is never
        // interpreted as a vehicle-identity mismatch or a negative ad status.
        const modelFailure = catalogError(error);
        if (!catalogFailure || catalogFailure.code === 'CATALOG_FORM_UNSUPPORTED') catalogFailure = modelFailure;
      }
    }
    if (!apiKey) {
      op.discoveryStage = 'known_candidates';
      const external = await knownHintFallback();
      if (external.length) {
        saveCandidates(context, plate, external.map(item => item.id));
        return await found(external);
      }
      if (op.detailErrors.size) return finish(502, [], 'error', detailFailure());
      if (catalogFailure && catalogFailure.code !== 'CATALOG_FORM_UNSUPPORTED') return finish(502, [], 'error', catalogFailure.code);
      if (op.candidates.size) return finish(200, [], 'unverified', unverifiedCode('CATALOG_NO_MATCH'));
      return catalogFailure ? finish(502, [], 'error', catalogFailure.code) : finish(200, [], 'unverified', unverifiedCode('CATALOG_NO_MATCH'));
    }
    if (searchFailure) throw searchFailure;
    for (let attempt = earlySearch ? 1 : 0; attempt < 2; attempt++) {
      if (attempt && op.candidates.size >= MAX_TOTAL_CANDIDATES) break;
      const listings = await searchAttempt(attempt);
      if (listings.length) {
        saveCandidates(context, plate, listings.map(item => item.id));
        return await found(listings);
      }
    }
    remaining(op);
    op.discoveryStage = 'known_candidates';
    const external = await knownHintFallback();
    if (external.length) {
      saveCandidates(context, plate, external.map(item => item.id));
      return await found(external);
    }
    if (op.detailErrors.size) return finish(502, [], 'error', detailFailure());
    if (catalogFailure && catalogFailure.code !== 'CATALOG_FORM_UNSUPPORTED') return finish(502, [], 'error', catalogFailure.code);
    if (op.candidates.size) return finish(200, [], 'unverified', unverifiedCode('SEARCH_NO_CANDIDATES'));
    if (catalogFailure) return finish(502, [], 'error', catalogFailure.code);
    const code = unverifiedCode(op.resultCount ? 'SEARCH_NO_CANDIDATES' : 'SEARCH_NO_RESULTS');
    return finish(200, [], 'unverified', code);
  } catch (error) {
    return finish(error?.code === 'SEARCH_RATE_LIMITED' ? 429 : 502, [], 'error', error instanceof EncarError ? error.code : 'SEARCH_UNAVAILABLE');
  } finally {
    clearTimeout(op.timer);
    request.signal?.removeEventListener('abort', op.abort);
  }
}
