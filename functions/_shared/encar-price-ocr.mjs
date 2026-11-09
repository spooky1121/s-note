// A screenshot supplies unverified price candidates, never a verified listing.
// Only bounded amount strings leave this parser; unrelated OCR text is private.
const MAX_TEXT_LENGTH = 200000;
const MAX_PRICE_WON = 1000000000000n;
const MAX_CANDIDATES = 20;
const EXCLUDED_LABEL = /(?:월\s*(?:납입|납부|할부|리스|렌트|렌탈|이용|부담)?|할부\s*(?:금|료|납입)?|리스\s*(?:료|금|납입)?|렌트\s*(?:료|금)?|렌탈\s*(?:료|금)?|보험\s*(?:료|금|가격)?|신차\s*(?:가|가격|판매가)|출고\s*가|잔존\s*가|잔\s*가|보증\s*금|선납\s*금|선수\s*금|계약\s*금|취득\s*세|이전\s*비|등록\s*비|할인\s*(?:액|금액)|지원\s*금|수수\s*료)/u;
const SALE_LABEL = /(?:판매\s*(?:가격|금액|가)|매매\s*(?:가격|가)|차량\s*(?:가격|가)|매물\s*가격)/gu;
const MIXED_UNIT_END = /(?:억|조|천|백)(?:\s*원)?[\s,()[\]과와및]*$/u;

function annotationText(annotation) {
  if (typeof annotation === 'string') return annotation.slice(0, MAX_TEXT_LENGTH);
  if (!annotation || typeof annotation !== 'object') return '';
  if (typeof annotation.text === 'string') return annotation.text.slice(0, MAX_TEXT_LENGTH);
  // Vision normally includes fullTextAnnotation.text. Retain a bounded fallback
  // for valid structured responses that contain symbols and detected breaks only.
  const parts = []; let length = 0;
  for (const page of (Array.isArray(annotation.pages) ? annotation.pages : [])) {
    for (const block of (Array.isArray(page?.blocks) ? page.blocks : [])) {
      for (const paragraph of (Array.isArray(block?.paragraphs) ? block.paragraphs : [])) {
        for (const word of (Array.isArray(paragraph?.words) ? paragraph.words : [])) {
          for (const symbol of (Array.isArray(word?.symbols) ? word.symbols : [])) {
            const text = typeof symbol?.text === 'string' ? symbol.text : '';
            parts.push(text); length += text.length;
            const type = symbol?.property?.detectedBreak?.type;
            const ending = ['LINE_BREAK', 'EOL_SURE_SPACE'].includes(type) ? '\n' : ['SPACE', 'SURE_SPACE'].includes(type) ? ' ' : '';
            if (ending) { parts.push(ending); length++; }
            if (length >= MAX_TEXT_LENGTH) return parts.join('').slice(0, MAX_TEXT_LENGTH);
          }
          parts.push(' '); length++;
        }
        parts.push('\n'); length++;
      }
    }
  }
  return parts.join('').slice(0, MAX_TEXT_LENGTH);
}

function normalized(text) {
  return text.normalize('NFKC').replace(/\r\n?/g, '\n')
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-')
    .replace(/([0-9])[ \t]*,[ \t]*(?=[0-9])/g, '$1,');
}

function amount(raw) {
  if (raw.length > 30 || !/^(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,4})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.replaceAll(',', '').split('.');
  const won = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  if (won <= 0n || won > MAX_PRICE_WON) return null;
  const trimmed = fraction.replace(/0+$/, '');
  return { priceWon: Number(won), display: BigInt(whole).toLocaleString('en-US') + (trimmed ? '.' + trimmed : '') + '만원' };
}

function excluded(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextLine = text.indexOf('\n', end);
  const lineEnd = nextLine < 0 ? text.length : nextLine;
  let before = text.slice(lineStart, start);
  // Never reinterpret the tail of an OCR-split or mixed-unit amount as a much
  // smaller complete price. A separate plain four-digit model year is allowed.
  if (/[0-9][0-9,.]*[ \t]+$/u.test(before) || MIXED_UNIT_END.test(before)) return true;
  const preceding = text.slice(Math.max(0, lineStart - 160), lineStart).trimEnd();
  const previous = preceding.slice(preceding.lastIndexOf('\n') + 1).trim();
  if (!before.trim()) {
    if (/^[0-9][0-9,.]*$/u.test(previous) && !/^(?:19|20)[0-9]{2}$/u.test(previous) || MIXED_UNIT_END.test(previous)) return true;
  }
  const priorAmounts = [...before.matchAll(/만\s*원/gu)];
  if (priorAmounts.length) { const last = priorAmounts.at(-1); before = before.slice(last.index + last[0].length); }
  // An explicit later sale label starts a new local clause: a monthly payment
  // earlier on the same line must not hide the actual advertised selling price.
  const sale = [...before.matchAll(SALE_LABEL)].at(-1);
  if (sale && !/신차\s*$/u.test(before.slice(0, sale.index))) before = before.slice(sale.index);
  if (EXCLUDED_LABEL.test(before.slice(-80))) return true;
  if (!before.trim()) {
    const label = previous;
    if (label.length <= 40 && !/[0-9]/u.test(label) && EXCLUDED_LABEL.test(label)) return true;
  }
  const after = text.slice(end, lineEnd);
  if (/^\s*(?:\/\s*월|월(?:\s|$)|월\s*(?:납|할부|리스|렌트)|리스료|렌트료|보험료|잔가|보증금|부터|이상|이하|[~～-])/u.test(after)) return true;
  if (/[+\-~～]\s*$/u.test(text.slice(Math.max(0, start - 160), start))) return true;
  return false;
}

export function parseEncarPrice(annotation) {
  const text = normalized(annotationText(annotation));
  // The left boundary prevents suffix matches inside malformed amounts such as
  // 12,34만원, 1e3만원, 5,49O만원, and minus-prefixed amounts.
  const pattern = /(?<![0-9A-Za-z.,+\-])([+\-]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?)\s*만\s*원/gu;
  const candidates = [], seen = new Set(); let checked = 0;
  for (const match of text.matchAll(pattern)) {
    if (++checked > 1000 || candidates.length >= MAX_CANDIDATES) break;
    const value = amount(match[1]);
    if (!value || excluded(text, match.index, match.index + match[0].length) || seen.has(value.priceWon)) continue;
    seen.add(value.priceWon);
    candidates.push({ id: 'price-' + (candidates.length + 1), display: value.display, priceWon: value.priceWon });
  }
  return candidates;
}
