
/**
 * S-NOTE / Cloudflare Pages Function
 * File: functions/api/ocr.js
 * API: POST /api/ocr
 *
 * Cloudflare Secrets / Variables:
 * GOOGLE_VISION_API_KEY
 * SUPABASE_URL
 * SUPABASE_PUBLISHABLE_KEY
 */

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const VIN_LABEL =
  /(?:차\s*대\s*번\s*호|차대\s*번호|차대번호|\bVIN\b|CHASSIS\s*(?:NO|NUMBER)?)/i;

const NO_STORE = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff'
};

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: NO_STORE
  });
}

function clean(s) {
  return String(s || '').normalize('NFKC').trim();
}

function plateIn(text) {
  const t = clean(text).replace(/[\s.·-]/g, '');
  const m = /\d{2,3}[가-힣]\d{4}/.exec(t);

  if (!m) return '';

  const region = t.slice(
    Math.max(0, m.index - 2),
    m.index
  );

  const validRegion =
    /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(region);

  return (validRegion ? region : '') + m[0];
}

function yearIn(text) {
  const list =
    clean(text).match(/(?:19[7-9]\d|20\d{2})/g) || [];

  return list.find(
    y => Number(y) >= 1970 &&
    Number(y) <= new Date().getFullYear() + 1
  ) || '';
}

function vinNormalize(raw) {
  let vin = clean(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (vin.length !== 17) return '';

  vin = vin.replace(/I/g, '1')
           .replace(/[OQ]/g, '0');

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return '';
  if (!/[A-HJ-NPR-Z]/.test(vin) || !/\d/.test(vin)) {
    return '';
  }

  return vin;
}

function vinTokens(text) {
  const s = clean(text).toUpperCase();
  const candidates = [];

  for (const m of s.matchAll(
    /(?<![A-Z0-9])([A-Z0-9]{17})(?![A-Z0-9])/g
  )) {
    candidates.push(m[1]);
  }

  for (const m of s.matchAll(
    /(?<![A-Z0-9])([A-Z0-9]{4,}(?:[\s:./-]+[A-Z0-9]{2,}){1,6})(?![A-Z0-9])/g
  )) {
    candidates.push(m[1]);
  }

  const label = VIN_LABEL.exec(s);

  if (label) {
    const tail = s
      .slice(label.index + label[0].length)
      .split('\n')[0];

    const compact = tail.replace(/[^A-Z0-9]/g, '');

    if (compact.length === 17) {
      candidates.push(compact);
    }
  }

  return [
    ...new Set(
      candidates.map(vinNormalize).filter(Boolean)
    )
  ];
}

/* v2.01: 글자의 실제 위치를 이용한 OCR 분석 */

function documentRows(annotation) {
  const rows = [];
  let pageIndex = 0;

  for (const page of annotation?.pages || []) {
    const items = [];

    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const value = (word.symbols || [])
            .map(s => s.text || '')
            .join('')
            .trim();

          const box = word.boundingBox?.vertices || [];

          if (!value || !box.length) continue;

          const xs = box.map(v => Number(v.x || 0));
          const ys = box.map(v => Number(v.y || 0));

          const x0 = Math.min(...xs);
          const x1 = Math.max(...xs);
          const y0 = Math.min(...ys);
          const y1 = Math.max(...ys);

          if (x1 <= x0 || y1 <= y0) continue;

          items.push({
            text: value,
            x0, x1, y0, y1,
            h: Math.max(8, y1 - y0),
            cy: (y0 + y1) / 2,
            page: pageIndex
          });
        }
      }
    }

    items.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);

    const local = [];

    for (const word of items) {
      let row = local.find(
        r => Math.abs(r.cy - word.cy) <=
        Math.max(6, Math.min(r.h, word.h) * 0.58)
      );

      if (!row) {
        row = {
          words: [],
          cy: word.cy,
          h: word.h,
          page: pageIndex
        };
        local.push(row);
      }

      row.words.push(word);
      row.cy += (word.cy - row.cy) / row.words.length;
    }

    for (const row of local) {
      row.words.sort((a, b) => a.x0 - b.x0);

      row.h = Math.max(...row.words.map(w => w.h));
      row.x0 = Math.min(...row.words.map(w => w.x0));
      row.y0 = Math.min(...row.words.map(w => w.y0));
      row.y1 = Math.max(...row.words.map(w => w.y1));
      row.text = row.words.map(w => w.text).join(' ');

      rows.push(row);
    }

    pageIndex++;
  }

  return rows.sort(
    (a, b) =>
      a.page - b.page ||
      a.cy - b.cy ||
      a.x0 - b.x0
  );
}

function labelKey(s) {
  return clean(s)
    .replace(/[\s\[\](){}<>:：|·.\-_,]/g, '')
    .toUpperCase();
}

function rowLabel(row, type) {
  if (!row?.words?.length) return null;

  for (let i = 0; i < row.words.length; i++) {
    for (
      let n = 1;
      n <= 4 && i + n <= row.words.length;
      n++
    ) {
      const t = labelKey(
        row.words.slice(i, i + n)
          .map(w => w.text)
          .join('')
      );

      const ok =
        type === 'model'
          ? (
            t === '차명' ||
            t === '자동차명칭' ||
            t === '자동차명'
          )
          : type === 'first'
          ? /^최초등록일(?:자)?$/.test(t)
          : type === 'year'
          ? (
            t === '연식' ||
            t === '차량연식'
          )
          : type === 'made'
          ? /^제작연월(?:일)?$/.test(t)
          : /^(?:차대번호|VIN|CHASSIS(?:NO|NUMBER)?)$/.test(t);

      if (ok) {
        const w = row.words.slice(i, i + n);

        return {
          index: i,
          count: n,
          x1: Math.max(...w.map(x => x.x1)),
          x0: w[0].x0,
          y: row.cy,
          h: row.h
        };
      }
    }
  }

  return null;
}

const OTHER_FIELDS =
  /(?:최초\s*등록\s*일|차\s*대\s*번\s*호|차\s*종|용\s*도|형\s*식|제\s*작\s*연\s*월|차\s*체|원\s*동\s*기|연\s*식|사\s*용\s*본\s*거\s*지|승\s*차\s*정\s*원|소\s*유\s*자|자동차\s*등록\s*번호|등록\s*번호|차량\s*번호|VIN)/i;

function adjacentText(rows, row, label) {
  const right = row.words
    .slice(label.index + label.count)
    .filter(w => w.x0 >= label.x1 - 8)
    .map(w => w.text)
    .join(' ')
    .trim();

  if (right) return right;

  const next = rows
    .filter(
      r =>
        r.page === row.page &&
        r !== row &&
        r.cy >= row.cy - row.h * 0.45 &&
        r.cy <= row.cy + row.h * 2.1 &&
        r.x0 > label.x1 + 3
    )
    .sort(
      (a, b) =>
        (
          Math.abs(a.cy - row.cy) * 3 +
          Math.max(0, a.x0 - label.x1) * 0.05
        ) -
        (
          Math.abs(b.cy - row.cy) * 3 +
          Math.max(0, b.x0 - label.x1) * 0.05
        )
    )[0];

  return next?.text || '';
}

function cleanedModel(text) {
  let s = clean(text)
    .replace(
      /^\s*(?:차\s*명|자동차\s*명칭?)\s*[:：]?/,
      ''
    )
    .trim();

  s = s.split(OTHER_FIELDS)[0]
    .replace(/^[\s:：|.·-]+|[\s:：|.·-]+$/g, '')
    .replace(/\s+/g, ' ');

  if (
    s.length < 2 ||
    s.length > 70 ||
    !/([가-힣]|[A-Za-z])/.test(s)
  ) {
    return '';
  }

  if (
    /^(?:승용|승합|화물|특수|소형|중형|대형|자가용|비사업용|차명|차종|제원)$/.test(s)
  ) {
    return '';
  }

  if (/^\d{2,3}[가-힣]\d{4}$/.test(s)) return '';
  if (/^\d{6,}|^\d{4}[.\-/년]\s*\d{1,2}/.test(s)) {
    return '';
  }

  return s;
}

function dateYear(text) {
  const s = clean(text);

  const matches = [
    ...s.matchAll(
      /(?:19[7-9]\d|20\d{2})(?=\s*(?:[.\/\-년]|$|\D))/g
    )
  ];

  return matches
    .map(x => x[0])
    .find(
      y =>
        Number(y) >= 1970 &&
        Number(y) <= new Date().getFullYear() + 1
    ) || '';
}

function rawFollowingLine(lines, pattern) {
  for (let i = 0; i < lines.length; i++) {
    const m = pattern.exec(lines[i]);
    if (!m) continue;

    const after = lines[i]
      .slice(m.index + m[0].length)
      .replace(/^\s*[:：|\-\]]+\s*/, '')
      .trim();

    if (after) return after;
    if (lines[i + 1]) return lines[i + 1];
  }

  return '';
}

function parseDocument(annotation) {
  const raw = clean(annotation?.text || '');

  const textLines = raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const rows = documentRows(annotation);
  const allLines = [
    ...rows.map(r => r.text),
    ...textLines
  ];

  const scoredVin = new Map();

  function addVin(text, score) {
    for (const vin of vinTokens(text)) {
      scoredVin.set(
        vin,
        Math.max(score, scoredVin.get(vin) || 0)
      );
    }
  }

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];

    addVin(line, VIN_LABEL.test(line) ? 100 : 18);

    if (VIN_LABEL.test(line)) {
      for (let delta = 1; delta <= 2; delta++) {
        if (allLines[i + delta]) {
          addVin(
            allLines[i + delta],
            85 - 12 * delta
          );
        }
      }
    }
  }

  const vin = [...scoredVin]
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  let model = '';
  let year = '';
  let plate = '';

  const modelCandidates = [];
  const yearCandidates = [];

  for (const row of rows) {
    for (const type of [
      'model',
      'first',
      'year',
      'made'
    ]) {
      const found = rowLabel(row, type);

      if (!found) continue;

      const value = adjacentText(
        rows,
        row,
        found
      );

      if (type === 'model') {
        const name = cleanedModel(value);

        if (name) {
          modelCandidates.push({
            name,
            score: 100 +
              (row.words.some(
                w => w.text.includes('차명')
              ) ? 10 : 0)
          });
        }
      } else {
        const y = dateYear(value);

        if (y) {
          yearCandidates.push({
            year: y,
            score:
              type === 'first' ? 120 :
              type === 'year' ? 90 : 45
          });
        }
      }
    }
  }

  model = modelCandidates
    .sort((a, b) => b.score - a.score)[0]?.name || '';

  if (!model) {
    model = cleanedModel(
      rawFollowingLine(
        textLines,
        /(?:^|\s)(?:차\s*명|자동차\s*명칭?)\s*[:：]?/
      )
    );
  }

  const first = dateYear(
    rawFollowingLine(
      textLines,
      /최초\s*등록\s*일(?:자)?\s*[:：]?/
    )
  );

  if (first) {
    yearCandidates.push({
      year: first,
      score: 110
    });
  }

  if (!yearCandidates.length) {
    const explicit = dateYear(
      rawFollowingLine(
        textLines,
        /(?:^|\s)연\s*식\s*[:：]?/
      )
    );

    if (explicit) {
      yearCandidates.push({
        year: explicit,
        score: 65
      });
    }
  }

  year = yearCandidates
    .sort((a, b) => b.score - a.score)[0]?.year || '';

  for (let i = 0; i < allLines.length; i++) {
    if (
      !plate &&
      /(?:자동차\s*등록\s*번호|차량\s*번호|등록\s*번호)/.test(
        allLines[i]
      )
    ) {
      plate =
        plateIn(allLines[i]) ||
        plateIn(allLines[i + 1] || '');
    }
  }

  if (!plate) plate = plateIn(raw);

  return {
    plate,
    model,
    year,
    vin
  };
}

function isSupportedImage(type, bytes) {
  if (!ALLOWED.has(type) || bytes.length < 12) {
    return false;
  }

  if (type === 'image/jpeg') {
    return bytes[0] === 0xff &&
           bytes[1] === 0xd8;
  }

  if (type === 'image/png') {
    return bytes[0] === 0x89 &&
           bytes[1] === 0x50 &&
           bytes[2] === 0x4e &&
           bytes[3] === 0x47;
  }

  if (type === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
           String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }

  return false;
}

export function onRequestGet({ env } = {}) {
  const configured = !!(
    env?.GOOGLE_VISION_API_KEY &&
    env?.SUPABASE_URL &&
    env?.SUPABASE_PUBLISHABLE_KEY
  );

  return reply(200, {
    service: 'snote-vision-ocr',
    ok: true,
    configured,
    upload: 'POST /api/ocr'
  });
}

export async function onRequestPost({ request, env }) {
  const googleKey = String(
    env.GOOGLE_VISION_API_KEY || ''
  ).trim();

  const supaUrl = String(
    env.SUPABASE_URL || ''
  ).trim().replace(/\/$/, '');

  const supaKey = String(
    env.SUPABASE_PUBLISHABLE_KEY || ''
  ).trim();

  if (
    !googleKey ||
    !/^https:\/\/[\w-]+\.supabase\.co$/.test(supaUrl) ||
    !supaKey
  ) {
    return reply(503, {
      error: 'Cloudflare OCR 환경 변수가 설정되지 않았습니다.'
    });
  }

  const bearer = request.headers.get('authorization') || '';

  if (!/^Bearer\s+[A-Za-z0-9._-]{30,5000}$/i.test(bearer)) {
    return reply(401, {
      error: 'S-NOTE 로그인이 필요합니다.'
    });
  }

  const contentType = (
    request.headers.get('content-type') || ''
  ).split(';')[0].trim().toLowerCase();

  const length = Number(
    request.headers.get('content-length') || 0
  );

  if (!ALLOWED.has(contentType)) {
    return reply(415, {
      error: 'JPG, PNG 또는 WEBP 등록증 이미지만 전송할 수 있습니다.'
    });
  }

  if (length > MAX_IMAGE_BYTES) {
    return reply(413, {
      error: 'Google OCR 등록증 파일은 6MB 이하로 선택해 주세요.'
    });
  }

  try {
    const h = {
      apikey: supaKey,
      Authorization: bearer
    };

    const auth = await fetch(
      supaUrl + '/auth/v1/user',
      {
        method: 'GET',
        headers: h
      }
    );

    if (!auth.ok) {
      return reply(401, {
        error: '로그인 세션이 만료되었습니다. 다시 로그인하세요.'
      });
    }

    const user = await auth.json();

    if (!/^[0-9a-f-]{36}$/i.test(user?.id || '')) {
      return reply(401, {
        error: '로그인 사용자 확인에 실패했습니다.'
      });
    }

    const memberURL = new URL(
      supaUrl + '/rest/v1/zc_members'
    );

    memberURL.searchParams.set('select', 'user_id');
    memberURL.searchParams.set('user_id', 'eq.' + user.id);
    memberURL.searchParams.set('active', 'eq.true');
    memberURL.searchParams.set('limit', '1');

    const membership = await fetch(
      memberURL.toString(),
      {
        method: 'GET',
        headers: h
      }
    );

    if (!membership.ok) {
      return reply(403, {
        error: 'S-NOTE 직원 권한을 확인할 수 없습니다.'
      });
    }

    const members = await membership.json();

    if (!Array.isArray(members) || members.length < 1) {
      return reply(403, {
        error: '활성화된 S-NOTE 직원만 OCR을 사용할 수 있습니다.'
      });
    }

    const buffer = await request.arrayBuffer();

    if (
      buffer.byteLength > MAX_IMAGE_BYTES ||
      buffer.byteLength === 0
    ) {
      return reply(413, {
        error: '6MB 이하의 이미지 파일을 선택하세요.'
      });
    }

    const image = new Uint8Array(buffer);

    if (!isSupportedImage(contentType, image)) {
      return reply(415, {
        error: '이미지 파일의 형식을 확인해 주세요.'
      });
    }

    let binary = '';

    for (
      let i = 0;
      i < image.length;
      i += 0x8000
    ) {
      binary += String.fromCharCode(
        ...image.subarray(i, i + 0x8000)
      );
    }

    const base64 = btoa(binary);

    const google = await fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' +
      encodeURIComponent(googleKey),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [{
            image: {
              content: base64
            },
            features: [{
              type: 'DOCUMENT_TEXT_DETECTION'
            }],
            imageContext: {
              languageHints: ['ko', 'en']
            }
          }]
        })
      }
    );

    if (!google.ok) {
      if (google.status === 429) {
        return reply(429, {
          error: 'Google OCR 요청 한도를 초과했습니다.'
        });
      }

      if (
        google.status === 403 ||
        google.status === 400 ||
        google.status === 401
      ) {
        return reply(502, {
          error: 'Google Vision API 키, API 제한 및 결제 설정을 확인하세요 (Google HTTP ' +
            google.status + ').'
        });
      }

      return reply(502, {
        error: 'Google Vision OCR 서버 응답 오류 (' +
          google.status + ').'
      });
    }

    const data = await google.json();
    const result = data?.responses?.[0];

    if (result?.error) {
      return reply(502, {
        error: 'Google Vision이 이미지를 처리하지 못했습니다.'
      });
    }

    const fields = parseDocument(
      result?.fullTextAnnotation || {
        text: result?.textAnnotations?.[0]?.description || ''
      }
    );

    return reply(200, {
      ok: true,
      fields,
      engine: 'google-vision'
    });

  } catch (_) {
    return reply(502, {
      error: 'OCR 연결 중 오류가 발생했습니다.'
    });
  }
}
