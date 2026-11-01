import { normalizeBook, calculate, previousMonth } from './monthly-workbook-model.js';

const escaped = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const integer = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
function number(value, unknown = '—', signed = false) {
  if (value === null) return unknown;
  return (signed && value > 0 ? '+' : '') + integer.format(value);
}
function money(value, unknown = '미확정') {
  return value === null ? unknown : number(value) + '원';
}
function printedTime(value) {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '인쇄일 확인 필요';
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute} (한국시간)`;
}
function textCell(value, note = false) {
  return `<td${note ? ' class="print-note"' : ''}>${escaped(value || '—')}</td>`;
}
function numericCell(value, unknown = '—', signed = false) {
  return `<td class="print-number">${escaped(number(value, unknown, signed))}</td>`;
}
function table(title, headers, rows, footer, section) {
  const body = rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">입력된 행 없음</td></tr>`;
  return `<section class="print-section" data-section="${section}"><h2>${escaped(title)}</h2><table><thead><tr>${headers.map(header => `<th scope="col">${escaped(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${footer ? `<tfoot>${footer}</tfoot>` : ''}</table></section>`;
}
function summary(label, value, key) {
  return `<div data-summary="${key}"><span>${escaped(label)}</span><b>${escaped(money(value))}</b></div>`;
}

/** Returns a text-only, escaped print snapshot. The caller owns the print container. */
export function renderPrint(value, allBooks = [], { companyName = '', saved = false, printedAt = new Date() } = {}) {
  const book = normalizeBook(value), total = calculate(book, allBooks);
  const expanded = book.dealers.length > 12 || book.expenses.length > 16 || book.adjustments.length > 6
    || book.accounts.length > 6 || book.finance.length > 6 || book.receivables.length > 6
    || book.dealers.some(row => row.name.length > 30)
    || [...book.expenses, ...book.adjustments, ...book.accounts, ...book.finance, ...book.receivables].some(row => row.label.length > 65)
    || book.receivables.some(row => row.note.length > 120 || row.note.split('\n').length > 4)
    || book.note.length > 200 || book.note.split('\n').length > 4;
  const previous = previousMonth(book.month);
  const openingDescription = total.openingSource === 'manual'
    ? '수동 이월' + (total.openingKnown ? '' : ' · 기초잔액 미입력')
    : total.openingSource === 'missing' ? '자동 이월 · 직전 월 자료 없음'
      : `${previous} 마감액 자동 이월` + (total.openingKnown ? '' : ' · 전월 마감 미확정');
  const rows = [`<div class="print-workbook ${expanded ? 'print-expanded' : 'print-compact'}">`];
  rows.push(`<header class="print-heading"><h1>월정산 결산표 · ${escaped(book.month)}</h1><p>상사: ${escaped(typeof companyName === 'string' && companyName.trim() ? companyName.trim() : '상사명 미설정')} · 단위: 원 / 대수</p><p>인쇄일: ${escaped(printedTime(printedAt))}</p></header>`);
  rows.push(`<p class="print-status">${saved === true ? '서버 저장 완료' : '서버 미저장 · 현재 입력 초안'}</p>`);
  rows.push('<div class="print-summary">' + [
    summary('상사 수입', total.income, 'income'), summary('지출 합계', total.expense, 'expense'),
    summary('운영수익', total.operatingNet, 'operatingNet'), summary('현금 조정', total.adjustment, 'adjustment'),
    summary('월 현금증감', total.cashNet, 'cashNet'), summary('기초잔액', total.opening, 'opening'),
    summary('마감잔액', total.closing, 'closing'), summary('통장-결산 차액', total.bankDifference, 'bankDifference')
  ].join('') + '</div>');
  rows.push(`<p>${escaped(openingDescription)}</p><p>매입비·매도비는 상사 수입이며 차량 매입·판매 대금과 구분합니다. 미수/정산 보조금액과 금융 잔여한도는 현금잔액에 합산하지 않습니다.</p>`);

  rows.push('<div class="print-grid-main">');
  const dealerRows = book.dealers.map(row => {
    const feeValues = [row.buyFee, row.sellFee, row.yardFee];
    const rowTotal = feeValues.some(amount => amount !== null) ? feeValues.reduce((sum, amount) => sum + (amount ?? 0), 0) : null;
    return '<tr>' + textCell(row.name) + numericCell(row.buyCount) + numericCell(row.sellCount)
      + numericCell(row.buyFee) + numericCell(row.sellFee) + numericCell(row.yardFee) + numericCell(rowTotal) + '</tr>';
  });
  rows.push(table('딜러별 상사 수입', ['성명', '매입(대)', '매도(대)', '매입비(원)', '매도비(원)', '마당비(원)', '총입금액(원)'], dealerRows,
    '<tr><th scope="row">합계</th>' + [total.buyCount, total.sellCount, total.buyFee, total.sellFee, total.yardFee, total.income].map(value => numericCell(value)).join('') + '</tr>', 'dealers'));

  rows.push(table('운영비 지출', ['지출 항목', '금액(원)'], book.expenses.map(row => '<tr>' + textCell(row.label) + numericCell(row.amount) + '</tr>'),
    '<tr><th scope="row">지출 합계</th>' + numericCell(total.expense) + '</tr>', 'expenses'));
  rows.push('</div><div class="print-grid-support"><div class="print-support-block">');
  rows.push(table('이월·현금 조정', ['조정 항목', '증가(+) / 감소(-), 원'], book.adjustments.map(row => '<tr>' + textCell(row.label) + numericCell(row.amount, '—', true) + '</tr>'),
    '<tr><th scope="row">조정 합계</th>' + numericCell(total.adjustment, '—', true) + '</tr>', 'adjustments'));
  rows.push(`<p>기초잔액: ${escaped(money(total.opening))} · 월 현금증감: ${escaped(money(total.cashNet))} · 마감잔액: ${escaped(money(total.closing))}</p>`);

  rows.push('</div><div class="print-support-block">');
  rows.push(table('계좌잔액·실제잔액 대사', ['계좌명', '입력한 잔액(원)'], book.accounts.map(row => '<tr>' + textCell(row.label) + numericCell(row.balance) + '</tr>'),
    '<tr><th scope="row">입력 계좌잔액 합계</th>' + numericCell(total.bankActual, '미입력') + '</tr>', 'accounts'));
  rows.push(`<p>통장-결산 차액 = 입력 계좌잔액 합계 − 마감잔액: <strong>${escaped(money(total.bankDifference))}</strong>. 계좌잔액은 입력된 계좌만 합산하며, 미입력 계좌는 실제 0원과 다릅니다.</p>`);

  rows.push('</div><div class="print-support-block">');
  rows.push(table('재고금융 한도', ['항목', '약정한도(원)', '사용액(원)', '잔여한도(원)', '참고 비율(%)'], book.finance.map(row => {
    const remaining = row.limit !== null && row.used !== null ? row.limit - row.used : null;
    return '<tr>' + textCell(row.label) + numericCell(row.limit) + numericCell(row.used) + numericCell(remaining, '미확정') + textCell(row.rate === null ? '—' : String(row.rate) + '%') + '</tr>';
  }), '<tr><th scope="row">금융 합계</th>' + numericCell(total.financeLimit, '미입력') + numericCell(total.financeUsed, '미입력') + numericCell(total.financeRemaining, '미확정') + textCell('참고만 표시') + '</tr>', 'finance'));
  rows.push('<p>한도·사용액이 일부만 입력된 경우 잔여한도 합계는 미확정입니다. 참고 비율로 이자나 수입을 자동 계산하지 않습니다.</p>');

  rows.push('</div><div class="print-support-block print-tail">');
  rows.push(table('미수·정산 보조내역', ['항목', '금액(원)', '메모'], book.receivables.map(row => '<tr>' + textCell(row.label) + numericCell(row.amount) + textCell(row.note, true) + '</tr>'),
    '<tr><th scope="row">미수/정산 보조 합계</th>' + numericCell(total.receivableTotal) + textCell('현금·대사차액에 자동 가감하지 않음') + '</tr>', 'receivables'));
  rows.push(book.note
    ? `<section class="print-section print-month-note" data-section="note"><h2>월 메모</h2><div class="print-note">${escaped(book.note)}</div></section>`
    : '<p class="print-note-empty" data-section="note">월 메모: 없음</p>');
  rows.push('</div></div></div>');
  return rows.join('\n');
}
