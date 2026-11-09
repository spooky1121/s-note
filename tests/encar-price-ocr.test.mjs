import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEncarPrice } from '../functions/_shared/encar-price-ocr.mjs';
import { onRequestPost } from '../functions/api/ocr.js';

const values = text => parseEncarPrice({ text }).map(item => item.priceWon);

test('만원 immediately after an amount converts exactly to integer KRW', () => {
  assert.deepEqual(parseEncarPrice({ text: '모델 Y 롱 레인지 AWD\n5,490만원' }), [
    { id: 'price-1', display: '5,490만원', priceWon: 54900000 }
  ]);
  assert.deepEqual(values('850만원'), [8500000]);
  assert.deepEqual(values('판매가격 1억원'), []);
});
test('OCR whitespace, broken unit lines, fullwidth numbers and comma spacing are normalized', () => {
  for (const text of ['5 , 490\n만 원', '５，４９０만원', '5,490\r\n만원', '5,490 만 원']) {
    assert.deepEqual(values(text), [54900000], text);
  }
  assert.deepEqual(values('2022\n5,490만원'), [54900000]);
});
test('a precise decimal 만원 amount is accepted only when it represents whole won', () => {
  assert.deepEqual(parseEncarPrice('1.25만원\n0.0001만원'), [
    { id: 'price-1', display: '1.25만원', priceWon: 12500 },
    { id: 'price-2', display: '0.0001만원', priceWon: 1 }
  ]);
  assert.deepEqual(values('0.00001만원'), []);
  assert.deepEqual(values('1.2500만원'), [12500]);
});
test('zero, signed, overflow and non-decimal numeric representations are excluded', () => {
  for (const text of ['0만원', '-100만원', '−100만원', '－100만원', '–100만원', '- 100만원', '+100만원', '+ 100만원', '100000001만원', '1e3만원', 'NaN만원', 'Infinity만원']) {
    assert.deepEqual(values(text), [], text);
  }
  assert.deepEqual(values('100000000만원'), [1000000000000]);
});
test('malformed amounts cannot yield a plausible suffix match', () => {
  for (const text of ['54,90만원', '5,,490만원', '5.490.0만원', '5,49O만원', 'O490만원', '12,34만원', '1.2.3만원', '5 490만원', '5,\n490만원', '5\n490만원', '1. 5만원', '1.\n5만원', '5\n\n490만원']) {
    assert.deepEqual(values(text), [], text);
  }
});
test('unsupported mixed Korean magnitude units cannot become a smaller suffix price', () => {
  for (const text of ['1억 5,490만원', '1억5,490만원', '1억\n5,490만원', '1조 5,490만원', '5천 490만원', '1억\n\n5,490만원', '1억원 5,490만원', '1억 원 5,490만원', '1억원5,490만원', '1억, 5,490만원', '1억 원\n5,490만원']) assert.deepEqual(values(text), [], text);
});
test('ranges and starting-price language are not offered as a single definite price', () => {
  for (const text of ['5,000~5,490만원', '5,000 ~ 5,490만원', '5,000만원~5,490만원', '5,490만원부터', '5,490만원 이상', '5,490만원 이하']) {
    assert.deepEqual(values(text), [], text);
  }
});
test('monthly installments are excluded without discarding a nearby actual sale price', () => {
  assert.deepEqual(values('월 납입금 49만원\n판매가 5,490만원'), [54900000]);
  assert.deepEqual(values('월 납입금 49만원 판매가 5,490만원'), [54900000]);
  assert.deepEqual(values('49만원/월 판매가 5,490만원'), [54900000]);
  assert.deepEqual(values('월 납입금\n49만원'), []);
  assert.deepEqual(values('월\n\n49만원'), []);
  assert.deepEqual(values('할부\n\n49만원'), []);
});
test('lease, rental, insurance and unrelated new-car or financing amounts are excluded locally', () => {
  const labels = ['할부', '리스료', '렌트료', '렌탈금', '보험료', '신차가격', '신차가', '신차판매가', '출고가', '보증금', '계약금', '잔가', '선납금', '이전비', '취득세', '할인금액'];
  for (const label of labels) assert.deepEqual(values(label + ' 49만원\n판매가 5,490만원'), [54900000], label);
  assert.deepEqual(values('5,490만원\n보험료 계산\n신차가격표'), [54900000]);
});
test('distinct candidates remain distinct and repeated displayed prices are deduplicated', () => {
  assert.deepEqual(parseEncarPrice('판매가 5,490만원\n비교매물 4,200만원\n5,490만원'), [
    { id: 'price-1', display: '5,490만원', priceWon: 54900000 },
    { id: 'price-2', display: '4,200만원', priceWon: 42000000 }
  ]);
});
test('candidate output contains only bounded amount data and never surrounding OCR details', () => {
  const result = parseEncarPrice('PRIVATE_LOGIN 서영민\n38다6738\n900101-1234567\n5,490만원');
  assert.deepEqual(Object.keys(result[0]).sort(), ['display', 'id', 'priceWon']);
  assert(!JSON.stringify(result).includes('PRIVATE_LOGIN'));
  assert(!JSON.stringify(result).includes('38다6738'));
  assert(!JSON.stringify(result).includes('900101'));
  const capped = parseEncarPrice(Array.from({ length: 40 }, (_, index) => (index + 1) + '만원').join('\n'));
  assert.equal(capped.length, 20);assert.equal(capped.at(-1).id, 'price-20');
});
test('structured Vision symbol responses and missing annotation are handled without raw data exposure', () => {
  const words = [{ symbols: [...'5,490'].map(text => ({ text })) }, { symbols: [...'만원'].map(text => ({ text })) }];
  assert.deepEqual(parseEncarPrice({ pages: [{ blocks: [{ paragraphs: [{ words }] }] }] }), [{ id: 'price-1', display: '5,490만원', priceWon: 54900000 }]);
  for (const value of [null, undefined, {}, [], 123, { text: null }]) assert.deepEqual(parseEncarPrice(value), []);
});

const ORIGIN = 'https://s-note.example';
const ENV = { SUPABASE_URL: 'https://ocr-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-only-public-key', GOOGLE_VISION_API_KEY: 'test-only-vision-key' };
const USER = '11111111-1111-4111-8111-111111111111';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function request(query = '?purpose=encar-price', extra = {}) {
  return new Request(ORIGIN + '/api/ocr' + query, { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + JWT, 'Content-Type': 'image/png', ...extra }, body: png });
}
function fixture(t, { text = '차량명\n5,490만원', hook } = {}) {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);calls.push({ target, options });
    assert.equal(options.redirect, 'manual');assert(options.signal instanceof AbortSignal);
    const overridden = hook?.(target, options);if (overridden) return overridden;
    if (target.pathname === '/auth/v1/user') return Response.json({ id: USER });
    if (target.pathname === '/rest/v1/zc_members') { assert.equal(target.searchParams.get('active'), 'eq.true');return Response.json([{ user_id: USER }]); }
    assert.equal(target.origin, 'https://vision.googleapis.com');
    assert.equal(options.method, 'POST');
    return Response.json({ responses: [{ fullTextAnnotation: { text } }] });
  };
  t.after(() => { globalThis.fetch = original; });return calls;
}
test('price purpose retains real auth/member/image handling and returns review-required amount candidates', async t => {
  const calls = fixture(t, { text: 'PRIVATE_CONTACT 01012345678\n5,490만원' });
  const res = await onRequestPost({ request: request(), env: ENV });assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await res.json(), { ok: true, purpose: 'encar-price', engine: 'google-vision', candidates: [{ id: 'price-1', display: '5,490만원', priceWon: 54900000 }], requiresConfirmation: true });
  assert.equal(calls.length, 3);assert.equal(JSON.parse(calls[2].options.body).requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
});
test('missing or ambiguous price remains a successful empty/multiple-candidate response and is never automatically selected', async t => {
  fixture(t, { text: '월 납입금49만원' });const empty = await onRequestPost({ request: request(), env: ENV });
  assert.deepEqual((await empty.json()).candidates, []);
});
test('registration defaults and explicit registration preserve the previous response contract', async t => {
  fixture(t);
  for (const query of ['', '?purpose=registration']) {
    const res = await onRequestPost({ request: request(query), env: ENV });const result = await res.json();
    assert.equal(res.status, 200);assert.deepEqual(Object.keys(result).sort(), ['engine', 'fields', 'ok']);assert.equal(result.engine, 'google-vision');
  }
});
test('unknown, empty and repeated purpose values reject before authentication and billed OCR', async t => {
  const calls = fixture(t);
  for (const query of ['?purpose=', '?purpose=unknown', '?purpose=encar-price&purpose=registration', '?purpose=encar-price&purpose=encar-price']) {
    const res = await onRequestPost({ request: request(query), env: ENV });assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});
test('cross-origin and unauthenticated price requests never reach billed OCR', async t => {
  const calls = fixture(t);
  assert.equal((await onRequestPost({ request: request('?purpose=encar-price', { Origin: 'https://attacker.example' }), env: ENV })).status, 403);
  assert.equal((await onRequestPost({ request: request('?purpose=encar-price', { Authorization: '' }), env: ENV })).status, 401);
  assert.equal(calls.length, 0);
});
test('inactive membership prevents price OCR and no image reaches Vision', async t => {
  const calls = fixture(t, { hook: url => url.pathname === '/rest/v1/zc_members' && Response.json([]) });
  assert.equal((await onRequestPost({ request: request(), env: ENV })).status, 403);assert.equal(calls.length, 2);
});
test('unsupported file types and forged PNG bytes cannot reach billed price OCR', async t => {
  const calls = fixture(t);
  assert.equal((await onRequestPost({ request: request('?purpose=encar-price', { 'Content-Type': 'image/svg+xml' }), env: ENV })).status, 415);assert.equal(calls.length, 0);
  const bad = new Request(ORIGIN + '/api/ocr?purpose=encar-price', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + JWT, 'Content-Type': 'image/png' }, body: 'not an image' });
  assert.equal((await onRequestPost({ request: bad, env: ENV })).status, 415);assert.equal(calls.length, 2);
});
test('provider errors do not expose a key or raw OCR text as candidates', async t => {
  fixture(t, { hook: url => url.origin === 'https://vision.googleapis.com' && Response.json({ responses: [{ error: { message: 'PRIVATE_PROVIDER_TEXT ' + ENV.GOOGLE_VISION_API_KEY } }] }) });
  const res = await onRequestPost({ request: request(), env: ENV });assert.equal(res.status, 502);
  const body = await res.text();assert(!body.includes('PRIVATE_PROVIDER_TEXT'));assert(!body.includes(ENV.GOOGLE_VISION_API_KEY));
});
