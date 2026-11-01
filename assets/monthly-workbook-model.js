/** Pure input model for the shared, Excel-style monthly workbook. */
export const TYPE = 'snote-monthly-workbook';
export const VERSION = 1;

const MONEY_MAX = 999999999999;
const COUNT_MAX = 999999;
const LIMITS = { dealers: 50, expenses: 200, adjustments: 50, accounts: 30, finance: 30, receivables: 100 };
const MONEY_FIELDS = { dealers: ['buyFee', 'sellFee', 'yardFee'], expenses: ['amount'], adjustments: ['amount'], accounts: ['balance'], finance: ['limit', 'used'], receivables: ['amount'] };
const COMMON_EXPENSES = ['임차료', '관리비', '주차비', '통신비', '회비', '보험료', '급여', '금융이자', '기타운영비'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function invalid(message, errors) {
  const error = new Error(message);
  error.code = 'INVALID_DATA';
  if (errors) error.errors = errors;
  return error;
}
function validMonth(value) {
  return typeof value === 'string' && /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
}
function requireMonth(month) {
  if (!validMonth(month)) throw invalid('월은 YYYY-MM 형식으로 입력해 주세요.');
  return month;
}
export function previousMonth(month) {
  requireMonth(month);
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  if (number > 1) return `${String(year).padStart(4, '0')}-${String(number - 1).padStart(2, '0')}`;
  return year > 1 ? `${String(year - 1).padStart(4, '0')}-12` : null;
}

/** Empty is unknown, while an explicitly entered zero is a real zero. */
export function parseNumber(text, { count = false, allowNegative = true } = {}) {
  if (text === null || text === undefined) return null;
  const maximum = count ? COUNT_MAX : MONEY_MAX;
  if (typeof text === 'number') {
    if (!Number.isSafeInteger(text) || Math.abs(text) > maximum || ((count || !allowNegative) && text < 0)) throw invalid(count ? '대수는 0~999999의 정수로 입력해 주세요.' : '금액은 허용 범위 안의 원 단위 정수로 입력해 주세요.');
    return text === 0 ? 0 : text;
  }
  if (typeof text !== 'string') throw invalid('숫자 입력 형식을 확인해 주세요.');
  let value = text.normalize('NFKC').trim();
  if (!value) return null;
  let accountingNegative = false;
  if (value.startsWith('(') || value.endsWith(')')) {
    if (!value.startsWith('(') || !value.endsWith(')')) throw invalid('괄호 금액 형식을 확인해 주세요.');
    accountingNegative = true;
    value = value.slice(1, -1).trim();
  }
  if (count) {
    value = value.replace(/\s*대$/, '').trim();
  } else {
    value = value.replace(/^([+-]?)\s*₩\s*/, '$1').replace(/\s*원$/, '').trim();
  }
  if (accountingNegative && /^[+-]/.test(value)) throw invalid('금액 부호를 한 번만 입력해 주세요.');
  if (!/^[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(value)) throw invalid('소수·지수 표기 없이 정수로 입력해 주세요.');
  let integer;
  try { integer = BigInt(value.replaceAll(',', '')); } catch { throw invalid('숫자 입력 형식을 확인해 주세요.'); }
  if (accountingNegative) integer = -integer;
  if (integer > BigInt(maximum) || integer < -BigInt(maximum) || ((count || !allowNegative) && integer < 0n)) throw invalid(count ? '대수는 0~999999의 정수로 입력해 주세요.' : '금액 범위와 음수 허용 여부를 확인해 주세요.');
  return Number(integer) || 0;
}

export function createBook(month) {
  requireMonth(month);
  return {
    type: TYPE, version: VERSION, id: `monthly-book:${month}`, month,
    dealers: Array.from({ length: 9 }, (_, index) => ({ id: `dealer-${index + 1}`, name: '', buyCount: null, sellCount: null, buyFee: null, sellFee: null, yardFee: null })),
    expenses: COMMON_EXPENSES.map((label, index) => ({ id: `expense-${index + 1}`, label, amount: null })),
    adjustments: Array.from({ length: 2 }, (_, index) => ({ id: `adjustment-${index + 1}`, label: '', amount: null })),
    opening: { mode: 'auto', amount: null },
    accounts: ['법인통장', '매입비통장', '기타계좌'].map((label, index) => ({ id: `account-${index + 1}`, label, balance: null })),
    finance: Array.from({ length: 3 }, (_, index) => ({ id: `finance-${index + 1}`, label: '', limit: null, used: null, rate: null })),
    receivables: Array.from({ length: 3 }, (_, index) => ({ id: `receivable-${index + 1}`, label: '', amount: null, note: '' })),
    note: ''
  };
}

export function validateBook(value) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!plain(value)) return { ok: false, book: null, errors: [{ path: '', message: '월정산 데이터 형식을 확인해 주세요.' }] };
  if (value.type !== TYPE) add('type', '월정산 데이터 종류가 올바르지 않습니다.');
  if (value.version !== VERSION) add('version', '지원하지 않는 월정산 데이터 버전입니다.');
  if (!validMonth(value.month)) add('month', '월은 YYYY-MM 형식이어야 합니다.');
  if (value.id !== `monthly-book:${value.month}`) add('id', '월정산 식별자와 월이 일치하지 않습니다.');
  const string = (object, key, path, maximum, nonempty = false) => {
    const raw = object[key];
    if (typeof raw !== 'string') { add(path, '문자열 입력 형식을 확인해 주세요.'); return ''; }
    const result = raw.trim();
    if (result.length > maximum || (nonempty && !result)) add(path, `입력 길이를 확인해 주세요. (최대 ${maximum}자)`);
    return result;
  };
  const money = (object, key, path, nonnegative = false, count = false) => {
    const number = object[key];
    if (number === null) return null;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || Math.abs(number) > (count ? COUNT_MAX : MONEY_MAX) || ((nonnegative || count) && number < 0)) {
      add(path, count ? '대수는 0~999999의 정수 또는 미입력이어야 합니다.' : '금액은 허용 범위의 원 단위 정수 또는 미입력이어야 합니다.');
      return null;
    }
    return number === 0 ? 0 : number;
  };
  const book = { type: TYPE, version: VERSION, id: value.id, month: value.month };
  for (const [section, maximum] of Object.entries(LIMITS)) {
    if (!Array.isArray(value[section])) { add(section, '행 목록 형식이 올바르지 않습니다.'); book[section] = []; continue; }
    if (value[section].length > maximum) add(section, `최대 ${maximum}행까지 입력할 수 있습니다.`);
    const ids = new Set();
    book[section] = value[section].map((row, index) => {
      const path = `${section}[${index}]`;
      if (!plain(row)) { add(path, '행 데이터 형식이 올바르지 않습니다.'); return {}; }
      const item = { id: string(row, 'id', `${path}.id`, 100, true) };
      if (ids.has(item.id)) add(`${path}.id`, '같은 표에서 행 식별자가 중복되었습니다.');
      ids.add(item.id);
      if (section === 'dealers') {
        item.name = string(row, 'name', `${path}.name`, 60);
        item.buyCount = money(row, 'buyCount', `${path}.buyCount`, true, true);
        item.sellCount = money(row, 'sellCount', `${path}.sellCount`, true, true);
      } else item.label = string(row, 'label', `${path}.label`, 120);
      for (const key of MONEY_FIELDS[section]) item[key] = money(row, key, `${path}.${key}`, section === 'finance');
      if (section === 'finance') {
        const rate = row.rate;
        if (rate !== null && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100)) add(`${path}.rate`, '참고 비율은 0~100 또는 미입력이어야 합니다.');
        item.rate = rate;
      }
      if (section === 'receivables') item.note = string(row, 'note', `${path}.note`, 500);
      return item;
    });
  }
  if (!plain(value.opening)) { add('opening', '이월 설정 형식이 올바르지 않습니다.'); book.opening = { mode: 'auto', amount: null }; }
  else {
    if (!['auto', 'manual'].includes(value.opening.mode)) add('opening.mode', '이월 방식이 올바르지 않습니다.');
    book.opening = { mode: value.opening.mode, amount: money(value.opening, 'amount', 'opening.amount') };
  }
  book.note = string(value, 'note', 'note', 500);
  for (const key of ['updatedAt', 'writeId']) if (own(value, key)) book[key] = string(value, key, key, 100);
  return { ok: errors.length === 0, book: errors.length ? null : book, errors };
}

export function normalizeBook(value) {
  const result = validateBook(value);
  if (!result.ok) throw invalid(result.errors[0]?.message || '월정산 데이터가 올바르지 않습니다.', result.errors);
  return result.book;
}
function requirePayload(payload) {
  if (!Array.isArray(payload)) throw invalid('기존 월정산 원장이 배열 형식이 아닙니다.');
  return payload;
}
export function listBooks(payload) {
  requirePayload(payload);
  const months = new Set(), result = [];
  for (const record of payload) {
    if (!plain(record) || record.type !== TYPE) continue;
    const book = normalizeBook(record);
    if (months.has(book.month)) throw invalid('같은 월의 월정산표가 중복되어 있습니다. 서버 자료를 확인해 주세요.');
    months.add(book.month); result.push(book);
  }
  return result.sort((left, right) => left.month.localeCompare(right.month));
}
export function legacyRows(payload) {
  requirePayload(payload);
  return payload.filter(record => !plain(record) || record.type !== TYPE);
}
export function mergeMonth(payload, value) {
  listBooks(payload); // Validate all reserved records and duplicates before any merge.
  const book = normalizeBook(value);
  let replaced = false;
  const result = payload.map(record => {
    if (plain(record) && record.type === TYPE && record.version === VERSION && record.month === book.month) {
      replaced = true; return book;
    }
    return record;
  });
  if (!replaced) result.push(book);
  return result;
}

function safe(number) {
  if (!Number.isSafeInteger(number)) throw invalid('합계 또는 이월 금액이 안전한 정수 범위를 넘었습니다.');
  return number === 0 ? 0 : number;
}
const sum = numbers => numbers.reduce((total, number) => safe(total + (number === null ? 0 : number)), 0);
function cashTotals(book) {
  const buyCount = sum(book.dealers.map(row => row.buyCount)), sellCount = sum(book.dealers.map(row => row.sellCount));
  const buyFee = sum(book.dealers.map(row => row.buyFee)), sellFee = sum(book.dealers.map(row => row.sellFee)), yardFee = sum(book.dealers.map(row => row.yardFee));
  const income = sum([buyFee, sellFee, yardFee]), expense = sum(book.expenses.map(row => row.amount));
  const operatingNet = safe(income - expense), adjustment = sum(book.adjustments.map(row => row.amount));
  return { buyCount, sellCount, buyFee, sellFee, yardFee, income, expense, operatingNet, adjustment, cashNet: sum([operatingNet, adjustment]) };
}
export function calculate(value, allBooks = []) {
  const book = normalizeBook(value);
  const books = new Map(listBooks(allBooks).map(item => [item.month, item]));
  books.set(book.month, book);
  // Iterative unwind avoids call-stack growth across long, automatically carried chains.
  const chain = [], positions = new Map();
  let current = book, result;
  for (;;) {
    const base = cashTotals(current);
    if (current.opening.mode === 'manual') {
      const known = current.opening.amount !== null;
      result = { ...base, opening: current.opening.amount, openingKnown: known, openingSource: 'manual', closing: known ? sum([current.opening.amount, base.cashNet]) : null, closingKnown: known };
      break;
    }
    const prior = previousMonth(current.month), priorBook = prior && books.get(prior);
    if (!priorBook) {
      result = { ...base, opening: null, openingKnown: false, openingSource: 'missing', closing: null, closingKnown: false };
      break;
    }
    if (positions.has(current.month)) throw invalid('이월 연결이 올바르지 않습니다.');
    positions.set(current.month, true); chain.push({ base }); current = priorBook;
  }
  while (chain.length) {
    const { base } = chain.pop();
    result = { ...base, opening: result.closing, openingKnown: result.closingKnown, openingSource: 'auto', closing: result.closingKnown ? sum([result.closing, base.cashNet]) : null, closingKnown: result.closingKnown };
  }
  const enteredBalances = book.accounts.map(row => row.balance).filter(number => number !== null);
  const bankKnown = enteredBalances.length > 0, bankActual = bankKnown ? sum(enteredBalances) : null;
  const activeFinance = book.finance.filter(row => row.limit !== null || row.used !== null);
  const limits = book.finance.map(row => row.limit).filter(number => number !== null);
  const uses = book.finance.map(row => row.used).filter(number => number !== null);
  const financeKnown = activeFinance.length > 0 && activeFinance.every(row => row.limit !== null && row.used !== null);
  const financeLimit = limits.length ? sum(limits) : null, financeUsed = uses.length ? sum(uses) : null;
  return { ...result, bankActual, bankKnown, bankDifference: bankKnown && result.closingKnown ? safe(bankActual - result.closing) : null,
    receivableTotal: sum(book.receivables.map(row => row.amount)), financeLimit, financeUsed,
    financeRemaining: financeKnown ? safe(financeLimit - financeUsed) : null, financeKnown };
}

function stableJSON(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value)) || ancestors.has(value)) throw invalid('지문을 만들 수 없는 JSON 데이터입니다.');
  ancestors.add(value);
  let encoded;
  if (Array.isArray(value)) encoded = `[${Array.from(value, item => stableJSON(item, ancestors)).join(',')}]`;
  else encoded = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key], ancestors)}`).join(',')}}`;
  ancestors.delete(value);
  return encoded;
}
export async function fingerprint(record) {
  if (record === null) return null;
  const bytes = new TextEncoder().encode(stableJSON(record));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (/^[\t\r\n]/.test(text) || /^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function exportCSV(value, allBooks = []) {
  const book = normalizeBook(value), total = calculate(book, allBooks);
  const rows = [[`월정산 ${book.month}`], ['통화', '원'], [], ['요약', '값'],
    ['매입 대수', total.buyCount], ['매도 대수', total.sellCount], ['매입비 상사수입', total.buyFee], ['매도비 상사수입', total.sellFee], ['마당비 수입', total.yardFee],
    ['수입 합계', total.income], ['지출 합계', total.expense], ['운영수익', total.operatingNet], ['현금조정', total.adjustment], ['월 현금증감', total.cashNet],
    ['기초잔액', total.opening], ['이월 방식', total.openingSource === 'manual' ? '수동' : total.openingSource === 'auto' ? '전월 자동' : '전월 미설정'],
    ['마감잔액', total.closing], ['입력 계좌잔액 합계', total.bankActual], ['통장-결산 차액', total.bankDifference], ['미수/정산 보조 합계', total.receivableTotal],
    ['금융 약정한도', total.financeLimit], ['금융 사용액', total.financeUsed], ['금융 잔여한도', total.financeRemaining], [],
    ['딜러별 상사 수입'], ['성명', '매입 대수', '매도 대수', '매입비', '매도비', '마당비 입금', '총입금액']];
  for (const row of book.dealers) rows.push([row.name, row.buyCount, row.sellCount, row.buyFee, row.sellFee, row.yardFee, sum([row.buyFee, row.sellFee, row.yardFee])]);
  rows.push([], ['운영비 지출'], ['항목', '금액']);
  for (const row of book.expenses) rows.push([row.label, row.amount]);
  rows.push([], ['현금 조정'], ['항목', '부호 있는 금액']);
  for (const row of book.adjustments) rows.push([row.label, row.amount]);
  rows.push([], ['계좌 잔액'], ['계좌명', '잔액']);
  for (const row of book.accounts) rows.push([row.label, row.balance]);
  rows.push([], ['재고금융'], ['항목', '약정한도', '사용액', '잔여한도', '참고 비율(%)']);
  for (const row of book.finance) rows.push([row.label, row.limit, row.used, row.limit !== null && row.used !== null ? safe(row.limit - row.used) : null, row.rate]);
  rows.push([], ['미수/정산 보조'], ['항목', '금액', '메모']);
  for (const row of book.receivables) rows.push([row.label, row.amount, row.note]);
  rows.push([], ['월 메모'], [book.note]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
