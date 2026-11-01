import test from 'node:test';
import assert from 'node:assert/strict';
import { createBook } from '../assets/monthly-workbook-model.js';
import { renderPrint } from '../assets/monthly-workbook-print.js';
const printAt = '2026-01-01T16:00:00.000Z';
function card(html, key) {
  const match = html.match(new RegExp(`data-summary="${key}"[^>]*><span>[^<]*<\\/span><b>([^<]*)<\\/b>`));
  assert(match, `Missing summary ${key}`); return match[1];
}

test('print uses model totals and shows every financial block and its rows', () => {
  const prior = createBook('2025-12'); prior.opening = { mode: 'manual', amount: 100 };
  const book = createBook('2026-01');
  Object.assign(book.dealers[0], { name: '가상 담당자', buyCount: 2, sellCount: 3, buyFee: 20, sellFee: 30, yardFee: 40 });
  book.expenses[0].amount = 50; book.adjustments[0] = { id: 'adjust-1', label: '현금 조정 확인', amount: -7 };
  book.accounts[0].balance = 100; Object.assign(book.finance[0], { label: '가상 한도', limit: 900, used: 700, rate: 3.5 });
  Object.assign(book.receivables[0], { label: '가상 정산', amount: 999, note: '미수 메모\n두 번째 줄' });
  book.note = '월 메모 마지막 내용';
  const html = renderPrint(book, [prior], { companyName: '가상 상사', saved: true, printedAt: printAt });
  assert.equal(card(html, 'income'), '90원'); assert.equal(card(html, 'expense'), '50원');
  assert.equal(card(html, 'operatingNet'), '40원'); assert.equal(card(html, 'cashNet'), '33원');
  assert.equal(card(html, 'opening'), '100원'); assert.equal(card(html, 'closing'), '133원');
  assert.equal(card(html, 'bankDifference'), '-33원');
  for (const section of ['dealers', 'expenses', 'adjustments', 'accounts', 'finance', 'receivables', 'note']) assert(html.includes(`data-section="${section}"`), section);
  for (const text of ['가상 담당자', '현금 조정 확인', '가상 한도', '3.5%', '가상 정산', '미수 메모\n두 번째 줄', '월 메모 마지막 내용', '2025-12 마감액 자동 이월', '2026-01-02 01:00 (한국시간)']) assert(html.includes(text), text);
  assert(html.includes('서버 저장 완료')); assert(html.includes('단위: 원 / 대수'));
  assert.equal(/<(input|textarea|select)\b/i.test(html), false, 'Print values must be text, not clipped form controls');
});

test('all caller-controlled labels, notes and company text are escaped', () => {
  const book = createBook('2026-01'); book.opening = { mode: 'manual', amount: 0 };
  book.dealers[0].name = '<script>alert(1)</script>';
  book.expenses[0].label = '<img src=x onerror="test">';
  book.receivables[0].note = '& <svg/onload="test"> "quote" \'single\'';
  book.note = '<iframe src="test"></iframe>\n마지막 & 줄';
  const html = renderPrint(book, [], { companyName: '<img src=x onerror="bad">', printedAt: '<script>date</script>' });
  assert.equal(/<(script|img|svg|iframe)\b/i.test(html), false);
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert(html.includes('&lt;img src=x onerror=&quot;test&quot;&gt;'));
  assert(html.includes('&amp; &lt;svg/onload=&quot;test&quot;&gt; &quot;quote&quot; &#39;single&#39;'));
  assert(html.includes('&lt;iframe src=&quot;test&quot;&gt;&lt;/iframe&gt;\n마지막 &amp; 줄'));
  assert(html.includes('인쇄일 확인 필요'));
});

test('unknown balances stay unconfirmed while explicit zero and negative credit are displayed', () => {
  const book = createBook('2026-01'); book.updatedAt = '2026-01-01T00:00:00Z';
  let html = renderPrint(book, [], { printedAt: printAt });
  assert.equal(card(html, 'opening'), '미확정'); assert.equal(card(html, 'closing'), '미확정');
  assert.equal(card(html, 'bankDifference'), '미확정'); assert(html.includes('직전 월 자료 없음'));
  assert(html.includes('서버 미저장 · 현재 입력 초안'), 'updatedAt alone must never claim an ACK');
  book.opening = { mode: 'manual', amount: 0 }; book.accounts[0].balance = 0;
  book.finance[0].limit = 1; book.finance[0].used = 3;
  html = renderPrint(book, [], { saved: 'false', printedAt: printAt });
  assert.equal(card(html, 'opening'), '0원'); assert.equal(card(html, 'closing'), '0원'); assert.equal(card(html, 'bankDifference'), '0원');
  assert(html.includes('class="print-number">-2</td>')); assert(html.includes('서버 미저장'));
});

test('print includes the last rows and long notes without truncation', () => {
  const book = createBook('2026-01');
  book.dealers = Array.from({ length: 50 }, (_, index) => ({ id: `d-${index}`, name: `가상 담당 ${index}`, buyCount: null, sellCount: null, buyFee: null, sellFee: null, yardFee: null }));
  book.expenses = Array.from({ length: 200 }, (_, index) => ({ id: `e-${index}`, label: `가상 비용 ${index}`, amount: null }));
  book.receivables[2].note = '긴 메모 '.repeat(95) + '마지막확인';
  const html = renderPrint(book, [], { printedAt: printAt });
  assert(html.includes('가상 담당 49')); assert(html.includes('가상 비용 199'));
  assert(html.includes(book.receivables[2].note)); assert(html.includes('마지막확인'));
  assert(html.includes('<thead>')); assert(html.includes('<tfoot>'));
});

test('invalid input prevents printing instead of showing a fabricated total', () => {
  const book = createBook('2026-01'); book.adjustments[0].amount = 1.25;
  assert.throws(() => renderPrint(book, [], { printedAt: printAt }), error => error?.code === 'INVALID_DATA');
  const empty = createBook('2026-01'); for (const section of ['dealers', 'expenses', 'adjustments', 'accounts', 'finance', 'receivables']) empty[section] = [];
  assert(renderPrint(empty, [], { printedAt: printAt }).includes('입력된 행 없음'));
});
