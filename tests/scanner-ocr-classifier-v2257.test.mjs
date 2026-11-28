import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScannerDocument } from '../functions/_shared/scanner-ocr.mjs';

// Synthetic OCR boxes only: no customer files, Vision requests or billing.
function word(text, x = 80, y = 50, width = 240, height = 30, confidence = .96) {
  return { confidence, symbols: [...text].map(text => ({ text })), boundingBox: { vertices: [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }
  ] } };
}
function rotate(point, degrees, width, height) {
  if (degrees === 90) return { x: height - point.y, y: point.x };
  if (degrees === 180) return { x: width - point.x, y: height - point.y };
  if (degrees === 270) return { x: point.y, y: width - point.x };
  return { ...point };
}
function annotation(words, { degrees = 0, width = 800, height = 1200 } = {}) {
  return { text: 'RAW_PRIVATE_OCR_TEXT', pages: [{
    width: degrees % 180 ? height : width,
    height: degrees % 180 ? width : height,
    blocks: [{ paragraphs: [{ words: words.map(source => ({ ...source, boundingBox: {
      vertices: source.boundingBox.vertices.map(point => rotate(point, degrees, width, height))
    } })) }] }]
  }] };
}

test('all four pixel rotations give the same upright registration and portrait shape', () => {
  for (const degrees of [0, 90, 180, 270]) {
    const result = analyzeScannerDocument(annotation([word('자동차등록증'), word('합성 시험 문서', 80, 600)], { degrees }));
    assert.deepEqual(result, {
      documentType: 'registration', label: '자동차 등록증',
      rotation: (360 - degrees) % 360, orientation: 'portrait', needsReview: false
    }, `input rotation ${degrees}`);
  }
});

test('a naturally landscape performance document remains landscape after rotation correction', () => {
  for (const degrees of [0, 90, 180, 270]) {
    const result = analyzeScannerDocument(annotation([word('자동차성능'), word('상태점검기록부', 400, 50)], { degrees, width: 1200, height: 800 }));
    assert.equal(result.documentType, 'performance-1');
    assert.equal(result.rotation, (360 - degrees) % 360);
    assert.equal(result.orientation, 'landscape');
  }
});

test('classification priority is registration, performance first page, performance second page', () => {
  const result = words => analyzeScannerDocument(annotation(words));
  assert.equal(result([word('상태 고지자', 80, 1000), word('상태점검기록부'), word('자동차등록증', 80, 100)]).documentType, 'registration');
  assert.equal(result([word('상태 점검자', 80, 1000), word('상태점검기록부')]).documentType, 'performance-1');
  assert.equal(result([word('상태 고지자', 80, 1000)]).documentType, 'performance-2');
  assert.equal(result([word('상태 점검자', 80, 1000)]).documentType, 'performance-2');
});

test('body mentions of title keywords are not mistaken for a title in the header', () => {
  const result = analyzeScannerDocument(annotation([word('일반 서류 안내'), word('자동차등록증', 80, 650), word('자동차성능', 80, 750), word('상태 고지자', 80, 1000)]));
  assert.equal(result.documentType, 'performance-2');
  assert.equal(analyzeScannerDocument(annotation([word('일반 서류 안내'), word('상태점검기록부', 80, 650)])).documentType, 'unclassified');
});

test('spaced titles, punctuation, NFKC and small row skew are read in corrected order', () => {
  for (const degrees of [0, 90, 180, 270]) {
    const result = analyzeScannerDocument(annotation([
      word('자동차', 80, 52, 100), word('등록', 200, 50, 70), word('증', 290, 51, 25)
    ], { degrees }));
    assert.equal(result.documentType, 'registration');
  }
  assert.equal(analyzeScannerDocument(annotation([word('상태·점검 기록부')])).documentType, 'performance-1');
  assert.equal(analyzeScannerDocument(annotation([word('자\u200b동차 등록 증')])).documentType, 'registration');
});

test('footer phrase can be spaced or divided into separate words', () => {
  const result = analyzeScannerDocument(annotation([word('상태', 80, 1000, 55), word('점검자', 150, 1000, 90)]));
  assert.equal(result.label, '자동차 성능지 2장');
});

test('dominant page text wins over a differently oriented short stamp', () => {
  const source = annotation([word('자동차등록증'), word('합성 문서 기본 정보', 80, 400)]);
  const stamp = word('인', 0, 0, 20, 20);
  stamp.boundingBox.vertices = [{ x: 700, y: 600 }, { x: 700, y: 620 }, { x: 680, y: 620 }, { x: 680, y: 600 }];
  source.pages[0].blocks[0].paragraphs[0].words.push(stamp);
  const result = analyzeScannerDocument(source);
  assert.equal(result.rotation, 0);
  assert.equal(result.needsReview, false);
  assert.equal(result.documentType, 'registration');
});

test('conflicting or non-cardinal text directions require review without forced rotation', () => {
  const mixed = annotation([word('가나다라마바사')]);
  const other = annotation([word('아자차카타파하')], { degrees: 180 });
  mixed.pages[0].blocks[0].paragraphs[0].words.push(other.pages[0].blocks[0].paragraphs[0].words[0]);
  assert.equal(analyzeScannerDocument(mixed).rotation, 0);
  assert.equal(analyzeScannerDocument(mixed).needsReview, true);
  const diagonal = word('자동차등록증');
  diagonal.boundingBox.vertices = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 180, y: 220 }, { x: 80, y: 120 }];
  const result = analyzeScannerDocument(annotation([diagonal]));
  assert.equal(result.rotation, 0);
  assert.equal(result.needsReview, true);
  assert.equal(result.documentType, 'unclassified');
});

test('low confidence, invalid confidence, malformed geometry and raw text alone cannot determine header or rotation', () => {
  for (const confidence of [0, .1, NaN, Infinity, '1']) {
    const result = analyzeScannerDocument(annotation([word('자동차등록증', 80, 50, 240, 30, confidence)], { degrees: 180 }));
    assert.equal(result.documentType, 'unclassified');
    assert.equal(result.rotation, 0);
    assert.equal(result.needsReview, true);
  }
  const bad = word('자동차등록증');
  bad.boundingBox.vertices[1].x = Infinity;
  assert.equal(analyzeScannerDocument(annotation([bad])).documentType, 'unclassified');
  assert.equal(analyzeScannerDocument({ text: '자동차등록증\n상태점검기록부' }, { width: 800, height: 1200 }).documentType, 'unclassified');
});

test('omitted zero coordinates and normalized vertices are supported', () => {
  const zero = word('자동차등록증', 0, 0, 240, 30);
  zero.boundingBox.vertices = [{}, { x: 240 }, { x: 240, y: 30 }, { y: 30 }];
  assert.equal(analyzeScannerDocument(annotation([zero])).documentType, 'registration');
  const normalized = annotation([word('자동차등록증')]);
  const target = normalized.pages[0].blocks[0].paragraphs[0].words[0];
  target.boundingBox.normalizedVertices = target.boundingBox.vertices.map(point => ({ x: point.x / 800, y: point.y / 1200 }));
  delete target.boundingBox.vertices;
  assert.equal(analyzeScannerDocument(normalized).documentType, 'registration');
});

test('unknown documents and empty OCR remain unclassified and never return recognized text', () => {
  const result = analyzeScannerDocument(annotation([word('다른 종류의 문서')]));
  assert.deepEqual(Object.keys(result).sort(), ['documentType', 'label', 'needsReview', 'orientation', 'rotation']);
  assert.equal(result.label, '미분류');
  assert.equal(result.needsReview, false);
  assert.ok(!JSON.stringify(result).includes('RAW_PRIVATE_OCR_TEXT'));
  assert.equal(analyzeScannerDocument({}).orientation, 'unknown');
  assert.equal(analyzeScannerDocument(null).label, '미분류');
});

test('finite input bounds prevent runaway traversal, including huge empty hierarchy arrays', () => {
  const huge = { pages: [{ width: 800, height: 1200, blocks: Array(40000).fill({ paragraphs: [] }) }] };
  assert.equal(analyzeScannerDocument(huge).needsReview, true);
  const textBomb = word('가');
  textBomb.symbols = Array(100000).fill({ text: '가'.repeat(1000) });
  assert.equal(analyzeScannerDocument(annotation([textBomb])).needsReview, true);
});

test('missing page dimensions use validated image dimensions and multiple pages flag review', () => {
  const source = annotation([word('자동차등록증')]);
  delete source.pages[0].width;
  delete source.pages[0].height;
  assert.equal(analyzeScannerDocument(source, { width: 800, height: 1200 }).documentType, 'registration');
  source.pages.push({});
  assert.equal(analyzeScannerDocument(source, { width: 800, height: 1200 }).needsReview, true);
});
