// Only primary detail-page evidence is accepted. Search document IDs and
// numbers in external URL paths are never used as original advertisement IDs.
const HOSTS = Object.freeze({ carnect: 'carnect.biz', gloar: 'gloar-data.com', trust: 'encar.spb.ru' });
const PATHS = Object.freeze({ carnect: /^\/car\/[1-9][0-9]{5,11}\/?$/, gloar: /^\/en\/lot\/[a-z0-9][a-z0-9-]{0,240}\/?$/i, trust: /^\/auto\/[1-9][0-9]{5,11}\/?$/ });
const REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
const PLATE = new RegExp('^(?:' + REGIONS + ')?[0-9]{2,3}[가-힣][0-9]{4}$', 'u');
const PLATES = new RegExp('(?<![0-9가-힣])(?:' + REGIONS + '[ \\t]*)?[0-9]{2,3}[ \\t]*[가-힣][ \\t]*[0-9]{4}(?![0-9가-힣])', 'gu');
const CONTROL = /[\u0000-\u0020\u007f-\u009f\\]/u;
const ID = /^[1-9][0-9]{5,11}$/;
const RELATED = /^(?:similar|related|recommended|recommendations|похожие|рекомендуемые|другие\s+(?:автомобили|машины|авто)|смотрите\s+также|(?:추천|유사|관련|다른)\s*(?:차량|매물|자동차))(?=$|[^\p{L}\p{N}_])/iu;
const PLATE_LABEL = /^(?:license\s*plate(?:\s*(?:number|no\.?))?|plate(?:\s*(?:number|no\.?))?|registration\s*(?:number|no\.?)|car\s*(?:number|no\.?)|vehicle\s*(?:number|no\.?)|номер\s+(?:автомобиля|авто)|차량\s*번호|자동차\s*등록\s*번호|번호판)\s*[:：|–—-]?\s*(.*)$/iu;
const ENCAR_LABEL = /^(?:original\s+)?encar\s*(?:(?:advertisement|listing|ad|source|lot)\s*)?(?:id|number|no\.?|#)\s*[:：#№|–—-]?\s*(.*)$/iu;
const LOT_LABEL = /^(?:лот(?:\s+объявления)?|номер\s+лота|lot(?:\s*(?:id|number|no\.?|#))?)\s*[:：#№|–—-]?\s*(.*)$/iu;
const error = code => ({ status: 'error', code });
const normalizePlate = value => typeof value === 'string' ? value.normalize('NFKC').replace(/[\s-]+/gu, '') : '';
const allPlates = value => [...new Set([...value.matchAll(PLATES)].map(match => normalizePlate(match[0])))];

export function validatedDetailURL(value, provider) {
  if (!provider || HOSTS[provider.id] !== provider.host || typeof value !== 'string' || value.length > 2048 || value !== value.trim() || CONTROL.test(value) || value.includes('#')) return '';
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  try {
    const url = new URL(value);
    if (authority?.toLowerCase() !== provider.host || url.protocol !== 'https:' || url.hostname !== provider.host || url.port || url.username || url.password || !PATHS[provider.id].test(url.pathname)) return '';
    if ([...url.searchParams.keys()].some(key => !/^(?:utm_[a-z_]+|gclid|fbclid)$/i.test(key))) return '';
    url.search = ''; return url.href;
  } catch { return ''; }
}

function originalId(value) {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'));
    if (url.protocol !== 'https:' || !['fem.encar.com', 'www.encar.com', 'm.encar.com', 'encar.com'].includes(url.hostname) || url.port || url.username || url.password) return '';
    const direct = /^\/cars\/detail\/([1-9][0-9]{5,11})(?:\/|$)/.exec(url.pathname)?.[1];
    if (direct) return direct;
    if (/(?:^|\/)(?:dc_)?cardetail(?:view)?\.do$/i.test(url.pathname)) for (const [key, id] of url.searchParams) if (key.toLowerCase() === 'carid' && ID.test(id)) return id;
  } catch {}
  return '';
}

function cleanLine(value) { return value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?/, '').replace(/[*_`]/g, '').replace(/^\|\s*|\s*\|$/g, '').trim(); }
function labelled(lines, pattern, validate) {
  const values = [];
  for (let index = 0; index < lines.length; index++) {
    const match = pattern.exec(cleanLine(lines[index])); if (!match) continue;
    let raw = match[1].trim(), end = index;
    if (!raw) { while (++end < lines.length && !cleanLine(lines[end])) {} raw = cleanLine(lines[end] || ''); }
    const value = validate(raw); if (value) values.push({ value, at: index, end });
  }
  return values;
}
function idFields(lines, provider) {
  const validate = value => ID.test(value) ? value : '';
  return [...labelled(lines, ENCAR_LABEL, validate), ...(provider.id === 'trust' ? labelled(lines, LOT_LABEL, validate) : [])];
}
function titleIds(title, provider) {
  const values = new Set();
  const patterns = [/(?:original\s+)?encar\s*(?:(?:advertisement|listing|ad|source|lot)\s*)?(?:id|number|no\.?|#)\s*[:#№]?\s*([1-9][0-9]{5,11})(?![0-9])/igu];
  if (provider.id === 'trust') patterns.push(/(?:лот|lot)\s*[:#№]?\s*([1-9][0-9]{5,11})(?![0-9])/igu);
  for (const pattern of patterns) for (const match of title.matchAll(pattern)) values.add(match[1]);
  return values;
}

function primarySections(value) {
  // These functions consume text/markdown, never HTML. Hidden HTML, scripts and
  // code examples are not evidence of what a public vehicle detail displays.
  let text = value.replace(/<!--[\s\S]*?-->/g, '').replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');
  // Some markdown extracts retain HTML in a later seller note. Earlier plain
  // primary fields remain usable, but never read through an HTML container
  // whose visibility and record boundaries we cannot establish here.
  const html = /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])/.exec(text);
  if (html) text = text.slice(0, html.index);
  text = text.replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, '');
  const lines = text.split(/\r?\n/), start = lines.findIndex(line => /^#\s+/.test(line));
  const sections = []; let current = [], firstHeading = false;
  for (const line of lines.slice(start < 0 ? 0 : start)) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const label = cleanLine(heading ? heading[1] : line);
    if (RELATED.test(label) && (heading || label.length < 100)) break;
    if (heading) {
      if (/^#\s+/.test(line)) { if (firstHeading) break; firstHeading = true; }
      if (current.length) sections.push(current); current = [];
    } else if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { if (current.length) sections.push(current); current = []; }
    current.push(heading ? heading[1] : line);
  }
  if (current.length) sections.push(current); return sections;
}

/** Read explicit evidence from one detail result; title and URL are not proof. */
export function readSearchAdvertisement(result, provider, inputPlate) {
  const sourceUrl = validatedDetailURL(result?.url, provider), plate = normalizePlate(inputPlate);
  if (!sourceUrl || !PLATE.test(plate)) return error('INVALID_SOURCE_URL');
  const hasRaw = typeof result.raw_content === 'string' && !!result.raw_content.trim();
  if (result.raw_content != null && typeof result.raw_content !== 'string') return error('AD_ID_UNVERIFIED');
  const source = hasRaw ? result.raw_content : result.content;
  if (typeof source !== 'string' || !source.trim() || source.length > 128000) return error('AD_ID_UNVERIFIED');
  const text = source.normalize('NFKC'); if (text.length > 128000) return error('AD_ID_UNVERIFIED');
  const sections = primarySections(text); if (!sections) return error('AD_ID_UNVERIFIED');
  const title = typeof result.title === 'string' && result.title.length <= 2048 ? result.title.normalize('NFKC') : '';
  const declaredTitlePlates = allPlates(title), declaredTitleIds = titleIds(title, provider);
  if (declaredTitlePlates.length && (declaredTitlePlates.length !== 1 || declaredTitlePlates[0] !== plate)) return { status: 'not_found', code: 'PLATE_MISMATCH' };
  const matches = new Set(); let primaryPlateSeen = false;
  for (const lines of sections) {
    const section = lines.join('\n'); if (section.length > 18000) continue;
    const fields = labelled(lines, PLATE_LABEL, value => PLATE.test(normalizePlate(value)) ? normalizePlate(value) : '');
    const values = [...new Set(fields.map(field => field.value))];
    const observed = values.length ? values : hasRaw ? allPlates(section) : [];
    if (!observed.length) continue;
    if (observed.length !== 1) return { status: 'ambiguous', code: 'AMBIGUOUS' };
    if (observed[0] !== plate) { if (!primaryPlateSeen) return { status: 'not_found', code: 'PLATE_MISMATCH' }; break; }
    primaryPlateSeen = true;
    const explicit = idFields(lines, provider), ids = new Set(explicit.map(field => field.value)), links = new Set();
    for (const match of section.matchAll(/https:\/\/[^\s<>()[\]"]+/gi)) { const id = originalId(match[0]); if (id) links.add(id); }
    if (hasRaw) for (const id of links) ids.add(id);
    else if (ids.size && [...links].some(id => !ids.has(id))) return { status: 'ambiguous', code: 'AMBIGUOUS' };
    // Indexed snippets can join distant fragments. Their two labelled fields
    // must be close, complete and uninterrupted; raw source is preferred.
    if (!hasRaw) for (const id of [...ids]) if (!explicit.some(a => a.value === id && fields.some(b => Math.abs(a.at - b.at) <= 50 && !/\.\.\.|…/.test(lines.slice(Math.min(a.at, b.at), Math.max(a.end, b.end) + 1).join('\n'))))) ids.delete(id);
    if (ids.size > 1) return { status: 'ambiguous', code: 'AMBIGUOUS' };
    for (const id of ids) matches.add(id);
  }
  if (matches.size > 1) return { status: 'ambiguous', code: 'AMBIGUOUS' };
  if (!matches.size) return error('AD_ID_UNVERIFIED');
  const id = [...matches][0];
  if (declaredTitleIds.size && (declaredTitleIds.size !== 1 || !declaredTitleIds.has(id))) return error('AD_ID_CONFLICT');
  return { status: 'found', plate, id, sourceUrl };
}
