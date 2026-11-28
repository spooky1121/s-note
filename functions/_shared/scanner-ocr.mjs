// Vision preserves natural-reading vertex order even when a word is rotated.
// https://docs.cloud.google.com/vision/docs/reference/rpc/google.cloud.vision.v1#word
// This module only returns document metadata. Recognized text must not leave the server.
const LABELS = Object.freeze({
  registration: '자동차 등록증',
  'performance-1': '자동차 성능지 1장',
  'performance-2': '자동차 성능지 2장',
  unclassified: '미분류'
});
const MAX_NODES = 30000;
const MAX_WORDS = 12000;
const MAX_TEXT = 120000;
const MIN_CONFIDENCE = .35;
const HEADER_FRACTION = .4;

function dimension(value) {
  return Number.isFinite(value) && value > 0 && value <= 100000 ? value : 0;
}
function confidence(word) {
  if (word?.confidence === undefined) return .8;
  return typeof word.confidence === 'number' && Number.isFinite(word.confidence)
    ? Math.max(0, Math.min(1, word.confidence)) : 0;
}
function normalize(value) {
  return value.normalize('NFKC').replace(/[\s\p{P}\p{Z}\p{Cf}]/gu, '');
}
function points(box, width, height) {
  const normalized = !Array.isArray(box?.vertices) && Array.isArray(box?.normalizedVertices);
  const vertices = normalized ? box.normalizedVertices : box?.vertices;
  if (!Array.isArray(vertices) || vertices.length !== 4 || !width || !height) return null;
  const result = [];
  for (const vertex of vertices) {
    if (!vertex || typeof vertex !== 'object') return null;
    // Protobuf JSON omits zero coordinates.
    let x = vertex.x === undefined ? 0 : vertex.x;
    let y = vertex.y === undefined ? 0 : vertex.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (normalized) { x *= width; y *= height; }
    // Slight OCR overhang is allowed; arbitrary out-of-image geometry is not.
    if (x < -width * .05 || x > width * 1.05 || y < -height * .05 || y > height * 1.05) return null;
    result.push({ x, y });
  }
  const horizontal = Math.hypot(result[1].x - result[0].x, result[1].y - result[0].y);
  const vertical = Math.hypot(result[3].x - result[0].x, result[3].y - result[0].y);
  if (horizontal < 1 || vertical < 1) return null;
  return result;
}
function rotate(point, rotation, width, height) {
  if (rotation === 90) return { x: height - point.y, y: point.x };
  if (rotation === 180) return { x: width - point.x, y: height - point.y };
  if (rotation === 270) return { x: point.y, y: width - point.x };
  return point;
}
function aspect(width, height) {
  if (!width || !height) return 'unknown';
  if (Math.abs(width - height) <= Math.max(width, height) * .02) return 'square';
  return width > height ? 'landscape' : 'portrait';
}
function headerText(words, pageHeight) {
  const ordered = words.filter(word => word.top >= -pageHeight * .05 && word.middle <= pageHeight * HEADER_FRACTION)
    .sort((a, b) => a.middle - b.middle || a.left - b.left);
  const lines = [];
  for (const word of ordered) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(word.middle - line.middle) <= Math.max(2, Math.min(line.height, word.height) * .55)) {
      line.words.push(word);
    } else lines.push({ middle: word.middle, height: word.height, words: [word] });
  }
  return normalize(lines.map(line => line.words.sort((a, b) => a.left - b.left).map(word => word.text).join(' ')).join('\n'));
}

export function analyzeScannerDocument(annotation, dimensions = {}) {
  const page = Array.isArray(annotation?.pages) ? annotation.pages[0] : null;
  const width = dimension(page?.width) || dimension(dimensions?.width);
  const height = dimension(page?.height) || dimension(dimensions?.height);
  let nodes = 0;
  let textLength = 0;
  let truncated = false;
  let seenWords = 0;
  const words = [];
  const visit = () => { if (++nodes > MAX_NODES) { truncated = true; return false; } return true; };
  outer: for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
    if (!visit()) break;
    for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
      if (!visit()) break outer;
      for (const word of Array.isArray(paragraph?.words) ? paragraph.words : []) {
        if (!visit() || ++seenWords > MAX_WORDS) { truncated = true; break outer; }
        if (!Array.isArray(word?.symbols)) continue;
        let text = '';
        for (const symbol of word.symbols) {
          if (!visit()) break outer;
          if (typeof symbol?.text !== 'string') continue;
          text += symbol.text.slice(0, 8);
          if (text.length >= 256) { truncated = true; break; }
        }
        text = text.slice(0, 256);
        if (textLength + text.length > MAX_TEXT) { truncated = true; break outer; }
        textLength += text.length;
        const certainty = confidence(word);
        if (!text || certainty < MIN_CONFIDENCE) continue;
        const polygon = points(word.boundingBox, width, height);
        words.push({ text, polygon, confidence: certainty });
      }
    }
  }

  const scores = [0, 0, 0, 0];
  let total = 0;
  for (const word of words) {
    if (!word.polygon) continue;
    const a = word.polygon[0], b = word.polygon[1];
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
    const nearest = Math.round(angle / 90) % 4;
    const distance = Math.min(Math.abs(angle - nearest * 90), 360 - Math.abs(angle - nearest * 90));
    const weight = Math.min(normalize(word.text).length, 20) * word.confidence;
    total += weight;
    if (distance <= 22.5) scores[nearest] += weight;
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (scores[i] > scores[best]) best = i;
  const certain = total >= 2.1 && scores[best] / total >= .72;
  const rotation = certain ? (360 - best * 90) % 360 : 0;
  const correctedWidth = rotation % 180 ? height : width;
  const correctedHeight = rotation % 180 ? width : height;
  const positioned = [];
  for (const word of words) {
    if (!word.polygon) continue;
    const polygon = word.polygon.map(point => rotate(point, rotation, width, height));
    const left = Math.min(...polygon.map(point => point.x));
    const top = Math.min(...polygon.map(point => point.y));
    const bottom = Math.max(...polygon.map(point => point.y));
    positioned.push({ text: word.text, left, top, middle: (top + bottom) / 2, height: bottom - top });
  }
  // Header matching requires confident geometry: raw annotation.text has no reliable location.
  const header = certain ? headerText(positioned, correctedHeight) : '';
  const whole = normalize(words.map(word => word.text).join(' '));
  let documentType = 'unclassified';
  if (header.includes('자동차등록증')) documentType = 'registration';
  else if (header.includes('자동차성능') || header.includes('상태점검기록부')) documentType = 'performance-1';
  else if (whole.includes('상태고지자') || whole.includes('상태점검자')) documentType = 'performance-2';
  return {
    documentType,
    label: LABELS[documentType],
    rotation,
    orientation: aspect(correctedWidth, correctedHeight),
    needsReview: !certain || truncated || (Array.isArray(annotation?.pages) && annotation.pages.length > 1)
  };
}
