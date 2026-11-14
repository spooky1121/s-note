// Public catalogue structure only. This module never fetches, logs, or executes HTML.
export const CATALOG_ORIGIN = 'https://encar.spb.ru';
const CODES = new Set(['CATALOG_CONFIG_INVALID', 'CATALOG_FORM_UNSUPPORTED', 'CATALOG_PARSE_FAILED', 'CATALOG_PARSER_UNAVAILABLE']);
export class CatalogError extends Error {
  constructor(code) { super(CODES.has(code) ? code : 'CATALOG_PARSE_FAILED'); this.code = this.message; }
}
const fail = code => { throw new CatalogError(code); };
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const UNSAFE_PATH = /(?:^|\/)(?:admin|account|auth|login|logout|sign[-_]?in|sign[-_]?out|signup|register|delete|remove|destroy|create|save|update|edit|submit|checkout|payment|purchase|booking|subscribe|contact|message|send|inquiry|enquiry)(?:[./_-]|$)/i;
const WRITE_ACTION = /^(?:post|put|patch|delete|remove|destroy|create|save|update|edit|submit|logout|login|checkout|pay)$/i;
const REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
const PLATE = new RegExp('^(?:' + REGIONS + ')?[0-9]{2,3}[가-힣][0-9]{4}$');
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const IGNORED = new Set('script style textarea template noscript svg math head'.split(' '));
const BLOCK = new Set('article li div p section dl dt dd tr td th ul ol header footer aside main nav form'.split(' '));
const ATTRS = 'id class href rel role hidden aria-hidden aria-label placeholder title style action method name type value checked selected disabled readonly multiple size for form formaction formmethod'.split(' ');

function suffixValue(value) { if (typeof value !== 'string' || !/^[0-9]{4}$/.test(value)) fail('CATALOG_CONFIG_INVALID'); return value; }
function rawURL(value) {
  if (value instanceof URL) value = value.href;
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || CONTROL.test(value) || value.includes('\\')) fail('CATALOG_CONFIG_INVALID');
  return value.trim();
}
function checkedURL(value, base) {
  let url;
  try { url = new URL(rawURL(value), base); } catch { fail('CATALOG_CONFIG_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'encar.spb.ru' || url.username || url.password || url.port || url.hash) fail('CATALOG_CONFIG_INVALID');
  let path = url.pathname;
  try { for (let i = 0; i < 3; i++) { const decoded = decodeURIComponent(path); if (decoded === path) break; path = decoded; } } catch { fail('CATALOG_CONFIG_INVALID'); }
  if (CONTROL.test(path) || path.includes('\\') || /%[0-9a-f]{2}/i.test(path) || UNSAFE_PATH.test(path)) fail('CATALOG_CONFIG_INVALID');
  for (const [key, value] of url.searchParams) {
    if (CONTROL.test(key + value) || (/^(?:_?method|action|cmd|command|operation|task|do)$/i.test(key) && WRITE_ACTION.test(value))) fail('CATALOG_CONFIG_INVALID');
  }
  return url;
}
export function catalogURL(value, base = CATALOG_ORIGIN) {
  const safeBase = checkedURL(base, CATALOG_ORIGIN);
  return checkedURL(value, safeBase);
}

export function configuredCatalogSearch(template, suffix) {
  suffixValue(suffix);
  if (typeof template !== 'string' || template.split('{suffix}').length !== 2) fail('CATALOG_CONFIG_INVALID');
  const marker = 'SNOTE_CATALOG_SUFFIX_VALUE';
  const url = catalogURL(template.replace('{suffix}', marker));
  if (url.pathname.includes(marker) || [...url.searchParams.values()].filter(value => value === marker).length !== 1) fail('CATALOG_CONFIG_INVALID');
  const entries = [...url.searchParams]; url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value === marker ? suffix : value);
  return catalogURL(url);
}

function entities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', ndash: '-', mdash: '-' };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp|ensp|emsp|thinsp|ndash|mdash);/gi, (all, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? all;
    const hex = entity[1]?.toLowerCase() === 'x', number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}
function textOf(node) {
  if (node.ignored) return '';
  return node.parts.map(part => typeof part === 'string' ? part : (BLOCK.has(part.tag) ? '\n' : '') + textOf(part) + (BLOCK.has(part.tag) ? '\n' : '')).join('');
}
function text(node) { return entities(textOf(node)).normalize('NFKC'); }
function descendants(node, predicate) {
  const output = [];
  for (const child of node.children) { if (predicate(child)) output.push(child); output.push(...descendants(child, predicate)); }
  return output;
}
function parents(node) { const out = []; for (let item = node.parent; item; item = item.parent) out.push(item); return out; }
async function tree(html, ignoreForms, code) {
  if (typeof globalThis.HTMLRewriter !== 'function') fail('CATALOG_PARSER_UNAVAILABLE');
  if (typeof html !== 'string' || new TextEncoder().encode(html).byteLength > 3 * 1024 * 1024) fail(code);
  const root = { tag: '', attrs: {}, children: [], parts: [], parent: null, ignored: false, closed: true }, stack = [root];
  let count = 0;
  try {
    await new globalThis.HTMLRewriter().on('*', {
      element(element) {
        if (++count > 30000 || stack.length > 128) fail(code);
        const tag = element.tagName.toLowerCase(), attrs = {};
        for (const name of ATTRS) { const value = element.getAttribute(name); if (value !== null) { if (value.length > 4096) fail(code); attrs[name] = entities(value); } }
        const parent = stack[stack.length - 1];
        const ignored = parent.ignored || IGNORED.has(tag) || (ignoreForms && tag === 'form') || Object.hasOwn(attrs, 'hidden') || attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '');
        const node = { tag, attrs, parent, children: [], parts: [], ignored, closed: VOID.has(tag) };
        parent.children.push(node); parent.parts.push(node);
        if (!VOID.has(tag)) { stack.push(node); element.onEndTag(() => { node.closed = true; const at = stack.indexOf(node); if (at >= 0) stack.length = at; }); }
      }
    }).onDocument({ text(chunk) {
      const node = stack[stack.length - 1];
      const optionDefault = !ignoreForms && stack.some(item => item.tag === 'option') && !stack.some(item => IGNORED.has(item.tag));
      if (!node.ignored || optionDefault) node.parts.push(chunk.text);
    } }).transform(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })).text();
    return root;
  } catch { fail(code); }
}

const PLATE_FIELD = /(?:гос[\s._-]*(?:номер|знак)|регистрационн[а-яё]*[\s._-]*номер|номер[\s._-]*(?:авто(?:мобил[яь])?|машины|тс)|(?:licen[cs]e|registration|vehicle|car)[\s._-]*(?:plate|number|no\b)|(?:plate|reg)[\s._-]*(?:number|no\b)|(?:vehicle|car)no\b|licenseplate|numberplate|\bplate\b|차량[\s_-]*번호|자동차[\s_-]*번호|번호판)/iu;
const PRIVATE_FIELD = /(?:password|passwd|phone|telephone|mobile|contact|e-?mail|login|user.?name|sign.?in|телефон|пароль|почт|логин|연락처|전화|비밀번호|로그인)/iu;
function optionValue(node) {
  const content = item => IGNORED.has(item.tag) ? '' : item.parts.map(part => typeof part === 'string' ? part : content(part)).join('');
  return node.attrs.value ?? entities(content(node)).replace(/\s+/gu, ' ').trim();
}
function defaults(controls, field) {
  const entries = [], radios = new Set();
  for (const node of controls) {
    const name = node.attrs.name;
    if (node === field || !name || Object.hasOwn(node.attrs, 'disabled')) continue;
    const type = (node.attrs.type || (node.tag === 'button' ? 'submit' : 'text')).toLowerCase();
    if (node.tag === 'input') {
      if (['button', 'reset'].includes(type)) continue;
      if (['checkbox', 'radio'].includes(type)) {
        if (!Object.hasOwn(node.attrs, 'checked')) continue;
        if (type === 'radio') { if (radios.has(name)) return null; radios.add(name); }
        entries.push([name, node.attrs.value ?? 'on']);
      } else if (['hidden', 'text', 'search', 'number'].includes(type)) entries.push([name, node.attrs.value || '']);
      else return null;
    } else if (node.tag === 'select') {
      const allOptions = descendants(node, item => item.tag === 'option' && parents(item).find(parent => parent.tag === 'select') === node && !parents(item).some(parent => parent !== node && IGNORED.has(parent.tag)));
      const selected = allOptions.filter(option => Object.hasOwn(option.attrs, 'selected'));
      const enabled = option => !Object.hasOwn(option.attrs, 'disabled') && !parents(option).some(parent => parent !== node && parent.tag === 'optgroup' && Object.hasOwn(parent.attrs, 'disabled'));
      const options = allOptions.filter(enabled);
      let chosen = selected.filter(enabled);
      if (!Object.hasOwn(node.attrs, 'multiple')) {
        if (selected.length > 1 || (node.attrs.size !== undefined && (!/^[0-9]*$/.test(node.attrs.size) || !Number.isSafeInteger(Number(node.attrs.size))))) return null;
        if (!selected.length && options.length && Number(node.attrs.size || 0) <= 1) chosen = [options[0]];
      }
      for (const option of chosen) entries.push([name, optionValue(option)]);
    } else if (node.tag === 'button' && ['button', 'reset'].includes(type)) continue;
    else return null;
  }
  return entries.some(([name]) => name === field.attrs.name) ? null : entries;
}
export async function discoverCatalogSearch(html, baseUrl, suffix) {
  suffixValue(suffix); const base = catalogURL(baseUrl), root = await tree(html, false, 'CATALOG_FORM_UNSUPPORTED');
  const forms = descendants(root, node => node.tag === 'form' && !node.ignored), labels = descendants(root, node => node.tag === 'label' && !node.ignored);
  const supported = []; let plateFieldCount = 0;
  for (const form of forms) {
    if (!form.closed || parents(form).some(node => node.tag === 'form') || (form.attrs.method || 'get').toLowerCase() !== 'get') continue;
    // Disabled fieldsets have a first-legend exception; unsupported forms are
    // rejected rather than guessing which controls the browser can submit.
    if (descendants(form, node => node.tag === 'fieldset' && Object.hasOwn(node.attrs, 'disabled')).length) continue;
    if (PRIVATE_FIELD.test([form.attrs.id, form.attrs.class, form.attrs['aria-label']].filter(Boolean).join(' '))) continue;
    if (descendants(form, node => node.tag === 'textarea' || ['password', 'email', 'file'].includes((node.attrs.type || '').toLowerCase())).length) continue;
    const controls = descendants(form, node => !node.ignored && ['input', 'select', 'button', 'textarea'].includes(node.tag));
    if (controls.some(node => (node.attrs.type || '').toLowerCase() === 'password' || node.attrs.formaction || node.attrs.formmethod || (node.attrs.form && node.attrs.form !== form.attrs.id))) continue;
    const editable = controls.filter(node => node.tag === 'input' && !Object.hasOwn(node.attrs, 'disabled') && !Object.hasOwn(node.attrs, 'readonly') && ['text', 'search', 'number', 'tel', ''].includes((node.attrs.type || '').toLowerCase()));
    const meaning = node => [node.attrs.name, node.attrs.id, node.attrs.placeholder, node.attrs['aria-label'], node.attrs.title,
      ...labels.filter(label => (node.attrs.id && label.attrs.for === node.attrs.id) || parents(node).includes(label)).map(text)].filter(Boolean).join(' ');
    if (controls.some(node => (node.attrs.type || '').toLowerCase() !== 'hidden' && PRIVATE_FIELD.test(meaning(node)))) continue;
    const fields = editable.filter(node => node.attrs.name && PLATE_FIELD.test(meaning(node)));
    plateFieldCount += fields.length;
    if (fields.length !== 1) continue;
    const field = fields[0]; let url;
    const observedDefaults = defaults(controls, field); if (!observedDefaults) continue;
    try { url = catalogURL(form.attrs.action || base.href, base); } catch { continue; }
    // Native GET submission replaces the action query with successful controls.
    url.search = '';
    for (const [name, value] of observedDefaults) url.searchParams.append(name, value);
    url.searchParams.set(field.attrs.name, suffix);
    try { supported.push(catalogURL(url)); } catch { /* A write action cannot be a GET search. */ }
  }
  const unique = new Map(supported.map(url => [url.href, url]));
  if (unique.size !== 1) fail('CATALOG_FORM_UNSUPPORTED');
  return { url: [...unique.values()][0], formCount: forms.length, plateFieldCount };
}

// The observed public homepage links to /catalog/ but its quick brand/model
// form has no plate field. Follow only that actual same-origin directory link;
// do not invent a search URL, query name or script-driven request.
export async function discoverCatalogEntry(html, baseUrl) {
  const base = catalogURL(baseUrl), root = await tree(html, false, 'CATALOG_FORM_UNSUPPORTED');
  const entries = new Map();
  for (const node of descendants(root, item => item.tag === 'a' && !item.ignored && item.attrs.href)) {
    let url;
    try { url = catalogURL(node.attrs.href, base.href); } catch { continue; }
    if (!/^\/catalog\/?$/.test(url.pathname) || url.search || url.href === base.href) continue;
    entries.set(url.origin + '/catalog', url);
  }
  if (entries.size !== 1) fail('CATALOG_FORM_UNSUPPORTED');
  return [...entries.values()][0];
}

function plateTokens(value) {
  value = value.normalize('NFKC');
  const separator = '[\\p{Zs}\\t-]*', pattern = new RegExp('(?:' + REGIONS + separator + ')?[0-9]{2,3}' + separator + '[가-힣]' + separator + '[0-9](?:' + separator + '[0-9]){3}', 'gu'), found = new Set();
  for (const match of value.matchAll(pattern)) {
    if (/[0-9]/.test(value[match.index - 1] || '') || /[0-9]/.test(value[match.index + match[0].length] || '')) continue;
    const normalized = match[0].replace(/[\s-]/gu, ''); if (PLATE.test(normalized)) found.add(normalized);
  }
  return found;
}
function isCard(node) {
  if (node.ignored) return false;
  if (node.tag === 'article' || node.tag === 'li') return true;
  // Complete class tokens identify records; BEM image/body descendants do not.
  return (node.attrs.class || '').split(/\s+/u).some(value => /^(?:(?:car|vehicle|auto|catalog|listing|advert|offer)[_-])?(?:card|item|record)(?:--[a-z0-9_-]+)?$/i.test(value));
}
function adId(node, base) {
  if (node.tag !== 'a' || node.ignored || !node.attrs.href) return null;
  let url; try { url = catalogURL(node.attrs.href, base); } catch { return null; }
  return /^\/auto\/([1-9][0-9]{0,11})\/?$/.exec(url.pathname)?.[1] || null;
}
function looksLikeAd(node, base) {
  if (node.tag !== 'a' || node.ignored || !node.attrs.href) return false;
  try { return /^\/auto(?:\/|$)/i.test(new URL(node.attrs.href, base).pathname); } catch { return false; }
}
function nextPage(root, base) {
  const found = new Map();
  for (const node of descendants(root, node => node.tag === 'a' && !node.ignored && node.attrs.href)) {
    const relNext = (node.attrs.rel || '').toLowerCase().split(/\s+/).includes('next');
    const pagination = [node, ...parents(node)].some(parent => /(?:^|[\s_-])(?:paginat(?:ion|or)|pager|paging)(?:$|[\s_-])/i.test(parent.attrs.class || '') || /pagination|страниц|페이지/iu.test(parent.attrs['aria-label'] || ''));
    const nextText = /^(?:next(?:\s+page)?|следующая(?:\s+страница)?|следующий|далее|다음(?:\s*페이지)?|[›»→])$/iu.test(text(node).trim()) || /(?:^|[\s_-])next(?:$|[\s_-])/i.test(node.attrs.class || '');
    if (!relNext && !(pagination && nextText)) continue;
    let url; try { url = catalogURL(node.attrs.href, base); } catch { fail('CATALOG_PARSE_FAILED'); }
    found.set(url.href, url);
  }
  if (found.size > 1) fail('CATALOG_PARSE_FAILED');
  return [...found.values()][0] || null;
}
function explicitEmpty(root) {
  const empty = /^(?:(?:по вашему запросу[:\s]*)?(?:ничего не найдено|нет результатов|нет автомобилей)|автомобили не найдены|no (?:results|vehicles|cars|listings)(?: (?:were )?found)?|0 results|검색(?:된)?\s*(?:결과|차량)(?:가|이)?\s*(?:없습니다|없음)|차량이 없습니다)[.!\s]*$/iu;
  const status = node => /(?:^|[\s_-])(?:no[-_]?results|empty|not[-_]?found|zero[-_]?results|no[-_]?cars)(?:$|[\s_-])/i.test(node.attrs.class || '') || node.attrs.role === 'status';
  return empty.test(text(root).trim()) || descendants(root, node => !node.ignored && ['div', 'p', 'section', 'main', 'span'].includes(node.tag)).some(node => status(node) && empty.test(text(node).trim()));
}

export async function parseCatalogPage(html, currentUrl, plate) {
  const base = catalogURL(currentUrl);
  if (typeof plate !== 'string') fail('CATALOG_PARSE_FAILED');
  plate = plate.normalize('NFKC').replace(/[\s-]/gu, ''); if (!PLATE.test(plate)) fail('CATALOG_PARSE_FAILED');
  const root = await tree(html, true, 'CATALOG_PARSE_FAILED'), anchors = descendants(root, node => !!adId(node, base));
  if (/<title>\s*(?:access denied|request blocked)/iu.test(html) || /(?:captcha|access denied|request blocked|enable javascript|javascript is required|доступ ограничен|проверка браузера)/iu.test(text(root))) fail('CATALOG_PARSE_FAILED');
  if (descendants(root, node => looksLikeAd(node, base) && !adId(node, base)).length) fail('CATALOG_PARSE_FAILED');
  const cards = descendants(root, isCard).filter(node => descendants(node, child => !!adId(child, base)).length > 0);
  const records = cards.filter(node => !descendants(node, child => cards.includes(child)).length);
  if (descendants(root, node => isCard(node) && plateTokens(text(node)).size > 0 && !parents(node).some(parent => records.includes(parent)) && !descendants(node, child => records.includes(child)).length && !records.includes(node)).length) fail('CATALOG_PARSE_FAILED');
  const ids = new Set(); let exactMatchCount = 0;
  for (const node of records) {
    const links = new Set(descendants(node, child => !!adId(child, base)).map(child => adId(child, base))), tokens = plateTokens(text(node));
    if (!node.closed || links.size !== 1 || tokens.size !== 1) fail('CATALOG_PARSE_FAILED');
    if (tokens.has(plate)) { ++exactMatchCount; for (const id of links) ids.add(id); }
  }
  if (!records.length) {
    if (anchors.length || !explicitEmpty(root)) fail('CATALOG_PARSE_FAILED');
    if (nextPage(root, base)) fail('CATALOG_PARSE_FAILED');
    return { ids: [], recordCount: 0, exactMatchCount: 0, linkCount: 0, empty: true, nextUrl: null, truncated: false };
  }
  // Links outside any understood record must not borrow a plate from the page.
  if (anchors.some(anchor => !parents(anchor).some(parent => records.includes(parent)))) fail('CATALOG_PARSE_FAILED');
  return { ids: [...ids].slice(0, 12), recordCount: records.length, exactMatchCount, linkCount: anchors.length, empty: false, nextUrl: nextPage(root, base), truncated: ids.size > 12 };
}
