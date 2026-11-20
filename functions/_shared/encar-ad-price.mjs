import { createBrowserSession } from './encar-id-browser.mjs';
import { parseEncarPrice } from './encar-price-ocr.mjs';
import { parseEncarPagePrice } from './encar-page-price.mjs';
import { readBoundedBytes } from './api-security.js';

// Read one known Korean listing only. This module never searches GLOAR, accepts
// a URL, writes a vehicle, or interprets an unlabelled numeric value as money.
const ID = /^[1-9][0-9]{5,11}$/;
const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
const MAX_HTML = 3 * 1024 * 1024;
const failure = (code, extras = {}) => Object.assign(new Error(code), { code, ...extras });
const compact = value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\s-]+/gu, '') : '';
export const encarAdvertisementUrl = id => {
  if (typeof id !== 'string' || !ID.test(id)) throw failure('INVALID_REQUEST');
  return 'https://fem.encar.com/cars/detail/' + id + '?listAdvType=share&adnm=mo_detail_url';
};
function check(signal) { if (signal?.aborted) throw failure('ABORTED'); }
function scope(parent, milliseconds) {
  const controller = new AbortController(), stop = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', stop, { once: true }); if (parent?.aborted) stop();
  const timer = setTimeout(() => controller.abort(failure('REQUEST_TIMEOUT')), milliseconds);
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent?.removeEventListener('abort', stop); } };
}
function pause(signal, milliseconds) {
  check(signal);
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(failure('ABORTED')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, milliseconds);
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
  });
}
async function release(resource) { try { await resource?.close?.(); } catch { /* Cleanup never hides the original safe error. */ } }

// Parse the established Encar state assignment as JSON; never execute a page's
// script. A different listing, dummy redirect or sold advert cannot be priced.
export function extractEncarBase(html) {
  if (typeof html !== 'string' || html.length > MAX_HTML) return null;
  const marker = /(?:window\s*\.\s*)?__PRELOADED_STATE__\s*=\s*/gu;
  for (let match, attempts = 0; (match = marker.exec(html)) && attempts++ < 8;) {
    let at = marker.lastIndex, json = '', quoted = false, escaped = false, depth = 0;
    if (html.slice(at, at + 10) === 'JSON.parse') {
      at += 10; while (/\s/u.test(html[at] || '')) at++; if (html[at++] !== '(') continue;
      while (/\s/u.test(html[at] || '')) at++; if (html[at] !== '"') continue;
      const start = at++;
      for (; at < html.length; at++) {
        const char = html[at]; if (escaped) { escaped = false; continue; } if (char === '\\') { escaped = true; continue; }
        if (char === '"') { try { json = JSON.parse(html.slice(start, at + 1)); } catch { /* Invalid JSON is not executable fallback. */ } break; }
      }
    } else if (html[at] === '{') {
      const start = at;
      for (; at < html.length; at++) {
        const char = html[at]; if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
        if (char === '"') quoted = true; else if (char === '{') depth++; else if (char === '}' && --depth === 0) { json = html.slice(start, at + 1); break; }
      }
    }
    if (json) try { const base = JSON.parse(json)?.cars?.base; if (base && typeof base === 'object' && !Array.isArray(base)) return base; } catch { /* Keep searching bounded assignments. */ }
  }
  return null;
}

export function verifyEncarBase(base, id, plate) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return false;
  if (String(base.vehicleId ?? '') !== id || compact(base.vehicleNo) !== plate || base.manage?.dummy === true) throw failure('ENCAR_VEHICLE_MISMATCH');
  if (base.advertisement?.status === 'SOLD') throw failure('ENCAR_NOT_ADVERTISING');
  if (base.advertisement?.status !== 'ADVERTISE') throw failure('ENCAR_STATUS_UNVERIFIED');
  return true;
}

function stateMatchesVisiblePrice(base, priceWon) {
  // Numeric state alone carries no unit guarantee. It can only corroborate an
  // amount explicitly rendered with 만원 on this same, identity-verified page.
  const value = base?.advertisement?.price;
  if (!['string', 'number'].includes(typeof value) || !/^[0-9]+(?:\.[0-9]{1,4})?$/u.test(String(value))) return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && (number === priceWon || Math.round(number * 10000) === priceWon);
}

export async function priceFromEncarHtml(html, { id, plate }) {
  const base = extractEncarBase(html); if (!verifyEncarBase(base, id, plate)) return null;
  const parsed = await parseEncarPagePrice(html);
  if (!parsed.candidate || !stateMatchesVisiblePrice(base, parsed.candidate.priceWon)) return null;
  return parsed.candidate.priceWon;
}

// Executed only inside the server-owned native Encar page. Bounded identity and
// candidate fields leave the browser; complete HTML and private page text do not.
export function encarAdvertisementPageAction({ id }) {
  const clean = value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\s-]+/gu, '') : '';
  let current; try { current = new URL(location.href); } catch { return { invalidLocation: true }; }
  if (current.origin !== 'https://fem.encar.com' || current.pathname !== '/cars/detail/' + id || current.username || current.password || current.port || current.hash) return { invalidLocation: true };
  const visible = element => {
    if (!element?.isConnected || element.closest('script,style,noscript,template,nav,footer,form,[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let parent = element; parent; parent = parent.parentElement) { const style = getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false; }
    const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
  };
  const excluded = element => {
    for (let parent = element, depth = 0; parent && parent !== document.body && depth++ < 8; parent = parent.parentElement) {
      if (/(?:recommend|similar|related|recent|insurance|installment|lease|rental|loan|finance|monthly)/iu.test(String(parent.className || '') + ' ' + (parent.id || '') + ' ' + (parent.getAttribute('aria-label') || ''))) return true;
      if (parent.tagName === 'A') { try { const link = new URL(parent.href); const match = /^\/cars\/detail\/([0-9]+)/u.exec(link.pathname); if (match && match[1] !== id) return true; } catch { return true; } }
    }
    return false;
  };
  const top = element => { const rect = element.getBoundingClientRect(); return rect.top >= -100 && rect.top < Math.max(innerHeight * 2, 1600); };
  const rawBase = window.__PRELOADED_STATE__?.cars?.base;
  const base = rawBase && typeof rawBase === 'object' ? {
    vehicleId: typeof rawBase.vehicleId === 'number' || typeof rawBase.vehicleId === 'string' ? String(rawBase.vehicleId).slice(0, 20) : '',
    vehicleNo: typeof rawBase.vehicleNo === 'string' ? rawBase.vehicleNo.slice(0, 40) : '',
    manage: { dummy: rawBase.manage?.dummy === true },
    advertisement: { status: typeof rawBase.advertisement?.status === 'string' ? rawBase.advertisement.status.slice(0, 40) : '' }
  } : null;
  const platePattern = /(?<![0-9가-힣])(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[ \t\u00a0]*)?[0-9]{2,3}[ \t\u00a0]*[가-힣][ \t\u00a0]*[0-9]{4}(?![0-9가-힣])/gu;
  const plates = new Set(), prices = [], plateBlocks = new Map(); let checked = 0, limited = false, blocked = false, inactive = false;
  const blockOf = element => {
    for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
      if (/^(?:block|flex|grid|table|list-item|flow-root)/u.test(getComputedStyle(parent).display)) return parent;
    }
    return document.body;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) {
    if (++checked > 16000) { limited = true; break; }
    const element = node.parentElement; if (!visible(element) || !top(element) || excluded(element)) continue;
    const value = (node.nodeValue || '').normalize('NFKC');
    if (value.length < 1000 && /(?:접근이\s*제한|비정상적인\s*접근|access\s*denied|verify\s*(?:you|that)|captcha|잠시\s*후\s*다시\s*시도)/iu.test(value)) blocked = true;
    if (value.length < 300 && /(?:판매가?\s*완료된\s*(?:차량|매물)|판매\s*종료된\s*(?:차량|매물)|판매중인\s*차량이\s*아닙니다|존재하지\s*않는\s*(?:차량|매물))/u.test(value)) inactive = true;
    if (value.length <= 2000) {
      const block = blockOf(element), accumulated = (plateBlocks.get(block) || '') + value.replace(/[\t\r\n\f ]+/gu, ' ');
      if (accumulated.length <= 12000) plateBlocks.set(block, accumulated); else limited = true;
    }
  }
  for (const value of plateBlocks.values()) for (const match of value.matchAll(platePattern)) { plates.add(clean(match[0])); if (plates.size > 10) { limited = true; break; } }
  const elements = document.querySelectorAll('strong,b,p,div,span,em,h1,h2,h3,dt,dd');
  if (elements.length > 16000) limited = true;
  for (const element of [...elements].slice(0, 16000)) {
    if (!visible(element) || !top(element) || excluded(element)) continue;
    const text = (element.innerText || element.textContent || '').normalize('NFKC').trim();
    if (!text || text.length > 180 || !/만\s*원/u.test(text)) continue;
    // A recommendation or monthly fee must not become the advertised amount.
    const local = element.parentElement && element.parentElement.children.length <= 4 ? (element.parentElement.innerText || '').trim() : '';
    if (/(?:월\s*(?:납입|납부|할부|리스|렌트|이용)|할부금|리스료|렌트료|보험료|보증금|선납금|취득세|이전비|등록비|신차\s*(?:가|가격))/u.test(text)) continue;
    if (local.length < 160 && !/(?:판매\s*(?:가|가격)|차량\s*(?:가|가격))/u.test(text) && /^(?:월|할부|리스|렌트|보험료|신차가격)/u.test(local)) continue;
    const font = Math.max(parseFloat(getComputedStyle(element).fontSize) || 0, ...[...element.querySelectorAll('strong,b,span,em')].slice(0, 20).filter(visible).map(child => parseFloat(getComputedStyle(child).fontSize) || 0));
    if (font < 20) continue;
    if (!prices.includes(text)) prices.push(text); if (prices.length > 40) { limited = true; break; }
  }
  return { base, plates: [...plates], prices: prices.slice(0, 40), blocked, inactive, limited, ready: document.readyState };
}

export function priceFromEncarSnapshot(snapshot, { id, plate }) {
  if (!snapshot || snapshot.invalidLocation) throw failure('ENCAR_LOCATION_UNVERIFIED');
  if (snapshot.blocked) throw failure('ENCAR_ACCESS_BLOCKED');
  if (snapshot.inactive) throw failure('ENCAR_NOT_ADVERTISING');
  if (snapshot.limited) throw failure('ENCAR_PRICE_UNVERIFIED');
  const stateProof = verifyEncarBase(snapshot.base, id, plate);
  if (!stateProof && (!Array.isArray(snapshot.plates) || snapshot.plates.length !== 1 || snapshot.plates[0] !== plate)) {
    if (snapshot.plates?.length === 1 && snapshot.plates[0] !== plate) throw failure('ENCAR_VEHICLE_MISMATCH');
    return null;
  }
  if (!Array.isArray(snapshot.prices) || snapshot.prices.length > 40 || snapshot.prices.some(text => typeof text !== 'string' || text.length > 180)) throw failure('ENCAR_PRICE_UNVERIFIED');
  const values = new Set(snapshot.prices.flatMap(text => parseEncarPrice(text)).map(candidate => candidate.priceWon));
  if (values.size > 1) throw failure('ENCAR_PRICE_AMBIGUOUS');
  return values.size === 1 ? [...values][0] : null;
}

async function nativeHtml({ id, plate, signal, fetchImpl }) {
  const bounded = scope(signal, 5000);
  try {
    const response = await fetchImpl(encarAdvertisementUrl(id), { method: 'GET', headers: { Accept: 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9' }, redirect: 'manual', cache: 'no-store', signal: bounded.signal });
    check(signal);
    // Never follow a redirect or try to defeat a native Encar access challenge.
    if (response.status === 429) throw failure('ENCAR_RATE_LIMITED');
    if (!response.ok || !/text\/html/iu.test(response.headers.get('Content-Type') || '')) return null;
    const bytes = await readBoundedBytes(response, MAX_HTML, { timeoutMs: 5000 });
    return await priceFromEncarHtml(new TextDecoder().decode(bytes), { id, plate });
  } catch (error) {
    check(signal);
    if (['ENCAR_VEHICLE_MISMATCH', 'ENCAR_NOT_ADVERTISING', 'ENCAR_STATUS_UNVERIFIED', 'ENCAR_RATE_LIMITED'].includes(error?.code)) throw error;
    return null;
  } finally { bounded.dispose(); }
}

export async function readEncarAdvertisementPrice({ id, plate, env = {}, signal, waitUntil, fetchImpl = fetch, createBrowser = createBrowserSession, now = Date.now, sleep = pause }) {
  if (typeof id !== 'string' || !ID.test(id) || typeof plate !== 'string' || !PLATE.test(plate)) throw failure('INVALID_REQUEST');
  check(signal);
  let priceWon = await nativeHtml({ id, plate, signal, fetchImpl });
  check(signal);
  if (!priceWon) {
    let browser, page;
    try {
      browser = await createBrowser(env, { signal, waitUntil, fetchImpl, encarOnly: true });
      check(signal); page = await browser.newPage({ signal });
      await page.goto(encarAdvertisementUrl(id));
      const expression = '(()=>{const __name=fn=>fn;return (' + encarAdvertisementPageAction.toString() + ')(' + JSON.stringify({ id }) + ');})()';
      // Bounded hydration polling; never relaunch, rotate credentials, or retry
      // an upstream quota/access failure. A still-valid saved link remains usable.
      for (let attempt = 0; attempt < 18; attempt++) {
        check(signal);
        priceWon = priceFromEncarSnapshot(await page.evaluate(expression), { id, plate });
        if (priceWon) break;
        if (attempt < 17) await sleep(signal, 250);
      }
      if (!priceWon) throw failure('ENCAR_PRICE_UNAVAILABLE');
    } finally { await release(page); await release(browser); }
  }
  return { id, plate, priceWon, checkedAt: new Date(now()).toISOString(), source: 'encar' };
}
