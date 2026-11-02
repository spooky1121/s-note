/**
 * S-NOTE / Cloudflare Pages Function: POST /api/encar
 * Required secrets: TAVILY_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY.
 * Optional ENCAR_CACHE KV contains candidate IDs only; every hit is reverified.
 * No seller/account/contact fields are used or returned.
 */

const MAX_CANDIDATES = 6;
const MAX_REQUEST_BYTES = 4096;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_SEARCH_BYTES = 512 * 1024;
const TIMEOUT_MS = 10000;
const ENCAR_DETAIL = 'https://fem.encar.com/cars/detail/';
const REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
const PLATE = new RegExp('^(?:' + REGIONS + ')?[0-9]{2,3}[가-힣][0-9]{4}$');
const BLOCKED = /has_been_cr_blocked|서비스\s*이용\s*제한됨|비정상적인\s*트래픽|<title>\s*(?:Access Denied|Request blocked)/i;

function response(httpStatus, plate = '', listings = [], status = 'error') {
  return new Response(JSON.stringify({
    plate,
    verifiedAt: listings.length ? new Date().toISOString() : null,
    listings,
    status
  }), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
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

async function readLimited(source, maxBytes) {
  const length = Number(source.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('body-limit');
  if (!source.body) return '';
  const reader = source.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error('body-limit');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    reader.releaseLock();
  }
}

async function fetchLimited(url, options = {}, maxBytes = MAX_SEARCH_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const fetched = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal
    });
    const text = await readLimited(fetched, maxBytes);
    return { ok: fetched.ok, status: fetched.status, text };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function authorize(request, supaUrl, supaKey) {
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+[A-Za-z0-9._-]{30,5000}$/i.test(bearer)) return 401;
  const headers = { apikey: supaKey, Authorization: bearer };
  const auth = await fetchLimited(supaUrl + '/auth/v1/user', { method: 'GET', headers }, 64 * 1024);
  if (!auth.ok) return auth.status >= 500 ? 502 : 401;
  const user = JSON.parse(auth.text);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id || '')) return 401;
  const url = new URL(supaUrl + '/rest/v1/zc_members');
  url.searchParams.set('select', 'user_id');
  url.searchParams.set('user_id', 'eq.' + user.id);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('limit', '1');
  const membership = await fetchLimited(url.toString(), { method: 'GET', headers }, 64 * 1024);
  if (!membership.ok) return membership.status >= 500 ? 502 : 403;
  const members = JSON.parse(membership.text);
  return Array.isArray(members) && members.some(member => member?.user_id === user.id) ? 200 : 403;
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
  if (host === 'encar.com') {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() === 'carid') return idOf(value);
    }
  }
  if (['trust-encar.ru', 'encar.spb.ru', 'encar.msk.ru', 'encar.cbg.ru'].includes(host)) {
    return idOf(/^\/auto\/([0-9]+)(?:\/|$)/.exec(url.pathname)?.[1]);
  }
  if (host === 'deffcars.ru') {
    return idOf(/encar_([0-9]+)(?![0-9])/i.exec(url.pathname)?.[1]);
  }
  return '';
}

function candidatesFromResults(results) {
  const ids = new Set();
  const add = value => {
    const id = idOf(value);
    if (id && ids.size < MAX_CANDIDATES) ids.add(id);
  };
  for (const result of results.slice(0, 8)) {
    add(idFromURL(result?.url));
    const content = typeof result?.content === 'string' ? result.content : '';
    for (const match of content.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
      add(idFromURL(match[0].replace(/[),.;\]}]+$/, '')));
    }
    const sourceHost = parsedURL(result?.url)?.hostname.toLowerCase().replace(/^www\./, '');
    if (sourceHost === 'carsbat.com') {
      for (const match of content.matchAll(/(?:\bLot\s+(?:number|no\.?)|Номер\s+лота)\s*[:#–-]?\s*([0-9]+)(?![0-9])/giu)) {
        add(match[1]);
      }
    }
    if (ids.size >= MAX_CANDIDATES) break;
  }
  return [...ids];
}

async function searchCandidates(plate, apiKey) {
  const result = await fetchLimited('https://api.tavily.com/search', {
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
      include_raw_content: false
    })
  });
  if (!result.ok) throw new Error('search-upstream');
  const payload = JSON.parse(result.text);
  if (!Array.isArray(payload?.results)) throw new Error('search-schema');
  return candidatesFromResults(payload.results);
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

async function detail(id, plate) {
  try {
    const fetched = await fetchLimited(ENCAR_DETAIL + id, {
      method: 'GET', headers: { Accept: 'text/html' }
    }, MAX_HTML_BYTES);
    if (BLOCKED.test(fetched.text)) return { kind: 'error' };
    if (fetched.status === 404 || fetched.status === 410) return { kind: 'unverified' };
    if (!fetched.ok) return { kind: 'error' };
    const base = extractState(fetched.text).cars.base;
    if (typeof base.advertisement?.status !== 'string') return { kind: 'error' };
    if (base.advertisement.status !== 'ADVERTISE') return { kind: 'unverified' };
    const actualPlate = normalizePlate(base.vehicleNo);
    const originalId = idOf(base.vehicleId);
    if (!actualPlate || !originalId) return { kind: 'error' };
    if (actualPlate !== plate) return { kind: 'unverified' };
    return {
      kind: 'match',
      id: originalId,
      sourceId: id,
      dummyId: idOf(base.manage?.dummyVehicleId),
      dummy: base.manage?.dummy === true,
      queryId: idOf(base.queryCarId),
      ...listingData(base)
    };
  } catch {
    return { kind: 'error' };
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
  let errored = discovered.some(item => item.kind === 'error');
  const roots = new Map();
  await mapConcurrent(discovered.filter(item => item.kind === 'match'), async candidate => {
    const original = candidate.sourceId === candidate.id ? candidate : await getDetail(candidate.id);
    if (original.kind === 'error') errored = true;
    if (original.kind === 'match' && original.id === candidate.id && !original.dummy) roots.set(original.id, original);
  });
  const listings = await mapConcurrent([...roots.values()], async original => {
    let trustedId = null;
    if (original.dummyId && original.dummyId !== original.id) {
      const trusted = await getDetail(original.dummyId);
      if (trusted.kind === 'error') errored = true;
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
  return { listings, errored };
}

async function cachedCandidates(env, plate) {
  if (typeof env.ENCAR_CACHE?.get !== 'function') return [];
  try {
    const saved = await env.ENCAR_CACHE.get('encar:candidates:v1:' + plate);
    if (typeof saved !== 'string' || saved.length > MAX_REQUEST_BYTES) return [];
    return idsOf(JSON.parse(saved));
  } catch {
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
  if (request.method !== 'POST') return response(405);
  const apiKey = String(env.TAVILY_API_KEY || '').trim();
  const supaUrl = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supaKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!apiKey || !/^https:\/\/[\w-]+\.supabase\.co$/.test(supaUrl) || !supaKey) return response(503);
  let plate = '';
  try {
    const authorization = await authorize(request, supaUrl, supaKey);
    if (authorization !== 200) return response(authorization);
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return response(415);
    let payload;
    try {
      payload = JSON.parse(await readLimited(request, MAX_REQUEST_BYTES));
    } catch (error) {
      return response(error?.message === 'body-limit' ? 413 : 400);
    }
    plate = normalizePlate(payload?.plate);
    if (!plate || (payload?.candidateIds !== undefined && !Array.isArray(payload.candidateIds))) return response(400);
    const memo = new Map();
    const getDetail = id => {
      if (!memo.has(id)) memo.set(id, detail(id, plate));
      return memo.get(id);
    };
    const hints = idsOf([...idsOf(payload.candidateIds), ...await cachedCandidates(env, plate)]);
    const hinted = await verifyCandidates(hints, getDetail);
    if (hinted.listings.length) {
      saveCandidates(context, plate, hinted.listings.map(item => item.id));
      return response(hinted.errored ? 502 : 200, plate, hinted.listings,
        hinted.errored ? 'error' : hinted.listings.length > 1 ? 'multiple' : 'found');
    }
    const candidates = await searchCandidates(plate, apiKey);
    const verified = await verifyCandidates(candidates, getDetail);
    saveCandidates(context, plate, verified.listings.length ? verified.listings.map(item => item.id) : candidates);
    const errored = hinted.errored || verified.errored;
    return response(errored ? 502 : 200, plate, verified.listings,
      errored ? 'error' : verified.listings.length > 1 ? 'multiple' : verified.listings.length ? 'found' : 'unverified');
  } catch {
    return response(502, plate);
  }
}
