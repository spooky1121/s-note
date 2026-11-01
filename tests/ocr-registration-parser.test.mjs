import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../functions/api/ocr.js';

// Entirely synthetic annotations: no uploaded registration, network or OCR billing.
function word(text, x, width, y = 30) {
  return { symbols: [...text].map(text => ({ text })), boundingBox: { vertices: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + 20 }, { x, y: y + 20 }] } };
}
function annotation(words, text = '차명 TEXT_FALLBACK') {
  return { text, pages: [{ blocks: [{ paragraphs: [{ words }] }] }] };
}
function row(...values) { return [word('차명', 10, 40), ...values]; }

test('raw text removes explicit field markers before NFKC can turn them into a model digit', () => {
  for (const [text, expected] of [
    ['차명 쏘나타 ⑤ 형식 LF', '쏘나타'], ['차명 그랜저 ⑤ 형식 IG', '그랜저'],
    ['차명 K5 ⑤ 형식 DL3', 'K5'], ['차명 아이오닉 5 ⑤ 형식 NE', '아이오닉 5'],
    ['차명 쏘나타 ⑤', '쏘나타'], ['차명 그랜저⑤', '그랜저'], ['차명 아이오닉5⑤', '아이오닉5'], ['차명 쏘나타 (5) 형식 LF', '쏘나타'],
    ['차명 쏘나타 （５） 형식 LF', '쏘나타'], ['차명 쏘나타 ⑸ 형식 LF', '쏘나타'],
    ['차명 BMW X5 [5] 형식 G05', 'BMW X5'], ['차명 BMW X5 ［５］ 형식 G05', 'BMW X5'],
    ['차명\n그랜저 ⑤ 형식 IG', '그랜저'], ['차명 그랜저⑤형식 IG', '그랜저']
  ]) assert.equal(parseDocument({ text }).model, expected, text);
});

test('legitimate model numbers and ambiguous plain 5 are retained', () => {
  for (const model of ['K5', 'BMW X5', 'SM5', '아이오닉 5', '아이오닉5', 'MAZDA 5', '2025 그랜저', 'K5 2.0 프레스티지', 'CX-5', 'BMW 525d', '아이오닉 5N', '그랜저 5', '쏘나타 5']) {
    assert.equal(parseDocument({ text: `차명 ${model}` }).model, model);
  }
  assert.equal(parseDocument({ text: '차명 아이오닉5 형식NE' }).model, '아이오닉5');
  assert.equal(parseDocument({ text: '차명 K５ ⑤ 형식 DL3' }).model, 'K5');
  assert.equal(parseDocument({ text: '차명 K5 (5)' }).model, 'K5 (5)');
});

test('positioned OCR stops at the next field, including a digit fused with its label', () => {
  for (const marker of ['⑤', '(5)', '5']) {
    const result = parseDocument(annotation(row(word('그랜저', 100, 70), word(marker, 320, 15), word('형식', 345, 40), word('IG', 410, 30))));
    assert.equal(result.model, '그랜저', marker);
  }
  const merged = parseDocument(annotation(row(word('K5', 100, 35), word('5형식', 320, 60), word('DL3', 410, 40))));
  assert.equal(merged.model, 'K5');
});

test('positioned OCR retains the real trailing 5 beside its model and drops only a separate field marker', () => {
  const model = [word('아이오닉', 100, 70), word('5', 180, 12)];
  const adjacentLabel = parseDocument(annotation(row(...model, word('형식', 200, 40), word('NE', 270, 30))));
  assert.equal(adjacentLabel.model, '아이오닉 5');
  const separateMarker = parseDocument(annotation(row(...model, word('5', 320, 12), word('형식', 345, 40), word('NE', 410, 30))));
  assert.equal(separateMarker.model, '아이오닉 5');
  const noFieldEvidence = parseDocument(annotation(row(word('그랜저', 100, 70), word('5', 320, 12))));
  assert.equal(noFieldEvidence.model, '그랜저 5');
});

test('an empty model cell followed by another field does not borrow an unrelated nearby value', () => {
  const fields = parseDocument(annotation(row(word('⑤', 320, 12), word('형식', 345, 40), word('IG', 410, 30), word('UNRELATED', 100, 100, 65)), 'OCR_TEXT_UNAVAILABLE'));
  assert.equal(fields.model, '');
});

test('model-only boundary changes preserve plate, first registration year and VIN extraction', () => {
  const text = '차명 K5 ⑤ 형식 DL3\n최초등록일 2024-01-02\n자동차등록번호 123가4567\n차대번호 KNALK412BFA123456';
  const fields = parseDocument(annotation(row(word('K5', 100, 35), word('⑤', 320, 12), word('형식', 345, 40), word('DL3', 410, 40)), text));
  assert.deepEqual(fields, { model: 'K5', plate: '123가4567', year: '2024', vin: 'KNALK412BFA123456' });
  assert.deepEqual(parseDocument({}), { model: '', plate: '', year: '', vin: '' });
});
