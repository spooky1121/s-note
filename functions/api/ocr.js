
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIN_LABEL = /(?:차\s*대\s*번\s*호|차대\s*번호|차대번호|\bVIN\b|CHASSIS\s*(?:NO|NUMBER)?)/i;
const NO_STORE = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
};
function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}
function clean(s) { return String(s || '').normalize('NFKC').trim(); }
function plateIn(text) {
  const t = clean(text).replace(/[\s.·-]/g, '');
  const m = /\d{2,3}[가-힣]\d{4}/.exec(t);
  if (!m) return '';
  const region = t.slice(Math.max(0, m.index - 2), m.index);
  const validRegion = /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(region);
  return (validRegion ? region : '') + m[0];
}
function yearIn(text) {
  const list = clean(text).match(/(?:19[7-9]\d|20\d{2})/g) || [];
  return list.find(y => Number(y) >= 1970 && Number(y) <= new Date().getFullYear() + 1) || '';
}
function vinNormalize(raw) {
  let vin = clean(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (vin.length !== 17) return '';
  vin = vin.replace(/I/g, '1').replace(/[OQ]/g, '0');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return '';
  if (!/[A-HJ-NPR-Z]/.test(vin) || !/\d/.test(vin)) return '';
  return vin;
}
function vinTokens(text) {
  const s = clean(text).toUpperCase();
  const candidates = [];
  for (const m of s.matchAll(/(?<![A-Z0-9])([A-Z0-9]{17})(?![A-Z0-9])/g)) candidates.push(m[1]);
  for (const m of s.matchAll(/(?<![A-Z0-9])([A-Z0-9]{4,}(?:[\s:./-]+[A-Z0-9]{2,}){1,6})(?![A-Z0-9])/g)) candidates.push(m[1]);
  const label = VIN_LABEL.exec(s);
  if (label) {
    const tail = s.slice(label.index + label[0].length).split('\n')[0];
    const compact = tail.replace(/[^A-Z0-9]/g, '');
    if (compact.length === 17) candidates.push(compact);
  }
  return [...new Set(candidates.map(vinNormalize).filter(Boolean))];
}
function googleLayoutLines(annotation) {
  const words = [];
  for (const p of annotation?.pages || []) for (const block of p.blocks || [])
    for (const paragraph of block.paragraphs || []) for (const word of paragraph.words || []) {
      const text = (word.symbols || []).map(s => s.text || '').join('');
      const vertices = word.boundingBox?.vertices || [];
      const x = Math.min(...vertices.map(v => v.x || 0)),
            y = Math.min(...vertices.map(v => v.y || 0)),
            height = Math.max(...vertices.map(v => v.y || 0)) - y;
      if (text && Number.isFinite(x) && Number.isFinite(y)) words.push({ text, x, y: y + height / 2, h: Math.max(10, height) });
    }
  words.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups = [];
  for (const word of words) {
    let group = groups.find(g => Math.abs(g.y - word.y) <= Math.max(8, Math.min(g.h, word.h) * 0.65));
    if (!group) { group = { y: word.y, h: word.h, words: [] }; groups.push(group); }
    group.words.push(word);
    group.y = (group.y * (group.words.length - 1) + word.y) / group.words.length;
  }
  return groups.sort((a, b) => a.y - b.y).map(g => g.words.sort((a, b) => a.x - b.x).map(w => w.text).join(' '));
}
function parseDocument(annotation) {
  const raw = clean(annotation?.text || '');
  const googleLines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const layoutLines = googleLayoutLines(annotation);
  const lines = [...layoutLines, ...googleLines];
  const scoredVin = new Map();
  function addVin(s, points) {
    for (const v of vinTokens(s)) scoredVin.set(v, Math.max(scoredVin.get(v) || 0, points));
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    addVin(line, VIN_LABEL.test(line) ? 100 : 18);
    if (VIN_LABEL.test(line)) {
      for (let delta = 1; delta <= 3; delta++) if (lines[i + delta]) addVin(lines[i + delta], 85 - 12 * delta);
      if (i > 0) addVin(lines[i - 1], 35);
    }
  }
  const vin = [...scoredVin].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  let plate = '', model = '', year = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!plate && /(?:자동차\s*등록\s*번호|등록\s*번호|차량\s*번호)/.test(line)) {
      plate = plateIn(line) || plateIn(lines[i + 1] || '');
    }
    if (!model && /(?:차\s*명|자동차\s*명칭)/.test(line)) {
      const after = line.replace(/^.*?(?:차\s*명|자동차\s*명칭)\s*[:：]?\s*/, '');
      const value = after && !/^(?:형식|원동기|최초|자동차등록번호|차대번호)/.test(after)
        ? after : (lines[i + 1] || '');
      if (value && value.length <= 60) model = value;
    }
    if (!year && /(?:제작\s*연월|최초\s*등록\s*일|연\s*식)/.test(line))
      year = yearIn(line) || yearIn(lines[i + 1] || '');
  }
  if (!plate) plate = plateIn(raw);
  if (!year) year = yearIn(raw);
  return { plate, model, year, vin };
}
function isSupportedImage(type, bytes) {
  if (!ALLOWED.has(type) || bytes.length < 12) return false;
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return false;
}
export function onRequestGet() {
  return reply(200, { service: 'snote-vision-ocr', ok: true, upload: 'POST /api/ocr' });
}
export async function onRequestPost({ request, env }) {
  const googleKey = String(env.GOOGLE_VISION_API_KEY || '').trim();
  const supaUrl = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supaKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!googleKey || !/^https:\/\/[\w-]+\.supabase\.co$/.test(supaUrl) || !supaKey)
    return reply(503, { error: 'Cloudflare OCR 환경 변수가 설정되지 않았습니다.' });
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+[A-Za-z0-9._-]{30,5000}$/i.test(bearer))
    return reply(401, { error: 'S-NOTE 로그인이 필요합니다.' });
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const length = Number(request.headers.get('content-length') || 0);
  if (!ALLOWED.has(contentType)) return reply(415, { error: 'JPG, PNG 또는 WEBP 등록증 이미지만 전송할 수 있습니다.' });
  if (length > MAX_IMAGE_BYTES) return reply(413, { error: 'Google OCR 등록증 파일은 6MB 이하로 선택해 주세요.' });
  try {
    const h = { apikey: supaKey, Authorization: bearer };
    const auth = await fetch(supaUrl + '/auth/v1/user', { method: 'GET', headers: h });
    if (!auth.ok) return reply(401, { error: '로그인 세션이 만료되었습니다. 다시 로그인하세요.' });
    const user = await auth.json();
    if (!/^[0-9a-f-]{36}$/i.test(user?.id || '')) return reply(401, { error: '로그인 사용자 확인에 실패했습니다.' });
    const memberURL = new URL(supaUrl + '/rest/v1/zc_members');
    memberURL.searchParams.set('select', 'user_id');
    memberURL.searchParams.set('user_id', 'eq.' + user.id);
    memberURL.searchParams.set('active', 'eq.true');
    memberURL.searchParams.set('limit', '1');
    const membership = await fetch(memberURL.toString(), { method: 'GET', headers: h });
    if (!membership.ok) return reply(403, { error: 'S-NOTE 직원 권한을 확인할 수 없습니다.' });
    const members = await membership.json();
    if (!Array.isArray(members) || members.length < 1) return reply(403, { error: '활성화된 S-NOTE 직원만 OCR을 사용할 수 있습니다.' });
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES || buffer.byteLength === 0) return reply(413, { error: '6MB 이하의 이미지 파일을 선택하세요.' });
    const image = new Uint8Array(buffer);
    if (!isSupportedImage(contentType, image)) return reply(415, { error: '이미지 파일의 형식을 확인해 주세요.' });
    let binary = '';
    for (let i = 0; i < image.length; i += 0x8000)
      binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
    const base64 = btoa(binary);
    const google = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': googleKey },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['ko', 'en'] } }] }),
    });
    if (!google.ok) {
      if (google.status === 429) return reply(429, { error: 'Google OCR 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' });
      if (google.status === 403) return reply(502, { error: 'Google Vision API 키 권한 또는 결제 설정을 확인해 주세요.' });
      return reply(502, { error: 'Google Vision OCR 서버 응답 오류 (' + google.status + ').' });
    }
    const data = await google.json();
    const result = data?.responses?.[0];
    if (result?.error) return reply(502, { error: 'Google Vision이 이미지를 처리하지 못했습니다.' });
    const fields = parseDocument(result?.fullTextAnnotation || { text: result?.textAnnotations?.[0]?.description || '' });
    return reply(200, { ok: true, fields, engine: 'google-vision' });
  } catch (_) {
    return reply(502, { error: 'OCR 연결 중 오류가 발생했습니다. 서버 설정과 인터넷 연결을 확인해 주세요.' });
  }
}
