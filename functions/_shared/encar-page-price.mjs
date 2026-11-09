import { parseEncarPrice } from './encar-price-ocr.mjs';

// This is a review candidate from the already-verified seller page, not a
// structured/provider-verified quote. Only bounded amount fields leave here.
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_VISIBLE_TEXT = 200000;
const BLOCKS = 'address,article,blockquote,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,li,main,ol,p,section,table,tbody,td,th,thead,tr,ul';
const REMOVE = 'head,script,style,noscript,template,iframe,object,embed,svg,canvas,nav,aside,footer,select,textarea,[role="navigation"],[role="banner"],[role="complementary"]';
const INVISIBLE_CLASS = /(?:^|[\s_-])(?:hidden|hide|invisible|blind|sr-only|visually-hidden|screen-reader-only|offscreen)(?:$|[\s_-])/i;

function visibleElement(element) {
  if (element.getAttribute('hidden') !== null || element.getAttribute('inert') !== null ||
      /^(?:true|1)$/i.test(element.getAttribute('aria-hidden') || '') || INVISIBLE_CLASS.test(element.getAttribute('class') || '')) return false;
  const style = element.getAttribute('style') || '';
  // Do not interpret escaped or commented CSS as a visibility guarantee.
  return !/\\|\/\*|(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden|opacity\s*:\s*(?:0(?:\.0*)?|\.0+)\s*(?:!important\s*)?(?=;|$))/i.test(style);
}

function decodeMoneyText(value) {
  return value.replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, ' ')
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (all, hex, decimal) => {
      const code = parseInt(hex || decimal, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    }).replace(/&amp;/gi, '&');
}

export async function parseEncarPagePrice(html) {
  if (typeof html !== 'string' || new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) return { candidate: null, code: 'PAGE_TEXT_LIMIT' };
  if (typeof globalThis.HTMLRewriter !== 'function') return { candidate: null, code: 'PAGE_PARSER_UNAVAILABLE' };
  try {
    const cleaner = new HTMLRewriter().on(REMOVE, { element(element) { element.remove(); } })
      .on('*', { element(element) { if (!visibleElement(element)) element.remove(); } });
    const clean = await cleaner.transform(new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } })).text();
    const parts = []; let size = 0, limited = false;
    const append = value => { size += value.length; if (size > MAX_VISIBLE_TEXT) limited = true; if (!limited) parts.push(value); };
    const reader = new HTMLRewriter().on(BLOCKS, { element(element) { append('\n'); element.onEndTag(() => append('\n')); } })
      .on('br', { element() { append('\n'); } })
      .onDocument({ text(chunk) { append(chunk.text); } });
    // Consume the complete transformed document. An early/truncated parse must
    // not make one of multiple prices look uniquely authoritative.
    await reader.transform(new Response(clean, { headers: { 'Content-Type': 'text/html;charset=utf-8' } })).arrayBuffer();
    if (limited) return { candidate: null, code: 'PAGE_TEXT_LIMIT' };
    const text = decodeMoneyText(parts.join('')).normalize('NFKC');
    if (text.length > MAX_VISIBLE_TEXT || (text.match(/만\s*원/gu) || []).length > 1000) return { candidate: null, code: 'PAGE_TEXT_LIMIT' };
    const candidates = parseEncarPrice(text);
    if (candidates.length !== 1) return { candidate: null, code: candidates.length ? 'PAGE_AMBIGUOUS' : 'PAGE_EMPTY' };
    return { candidate: { display: candidates[0].display, priceWon: candidates[0].priceWon }, code: null };
  } catch (_) {
    return { candidate: null, code: 'PAGE_PARSE_FAILED' };
  }
}
