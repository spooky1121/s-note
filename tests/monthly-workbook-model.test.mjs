import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPE, VERSION, createBook, normalizeBook, validateBook, calculate, parseNumber,
  previousMonth, listBooks, legacyRows, mergeMonth, fingerprint, exportCSV
} from '../assets/monthly-workbook-model.js';

const clone = value => structuredClone(value);
const invalid = fn => assert.throws(fn, error => error?.code === 'INVALID_DATA');
function manual(month, amount = 0) {
  const book = createBook(month); book.opening = { mode: 'manual', amount }; return book;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function csvRows(source) {
  const rows = []; let row = [], cell = '', quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    if (quoted) {
      if (ch === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++; }
    else cell += ch;
  }
  assert.equal(quoted, false, 'CSV quotes must balance');
  return rows;
}

test('createBook is an input-only generic blank template with separate row objects', () => {
  const book = createBook('2026-01'), other = createBook('2026-02');
  assert.equal(book.type, TYPE); assert.equal(book.version, VERSION); assert.equal(book.id, 'monthly-book:2026-01');
  assert.deepEqual([book.dealers.length, book.expenses.length, book.adjustments.length, book.accounts.length, book.finance.length, book.receivables.length], [9, 9, 2, 3, 3, 3]);
  assert.deepEqual(book.expenses.map(row => row.label), ['임차료', '관리비', '주차비', '통신비', '회비', '보험료', '급여', '금융이자', '기타운영비']);
  assert.deepEqual(book.accounts.map(row => row.label), ['법인통장', '매입비통장', '기타계좌']);
  assert(book.dealers.every(row => row.name === '' && Object.values(row).slice(2).every(value => value === null)));
  assert.equal(book.opening.amount, null); assert.equal(book.note, ''); assert.equal(validateBook(book).ok, true);
  book.dealers[0].buyFee = 42; assert.equal(other.dealers[0].buyFee, null);
  assert.equal('closing' in book, false); assert.equal('income' in book, false);
});

test('strict integer parsing preserves unknown, zero, currency/count units and signed adjustments', () => {
  for (const [input, expected] of [[null, null], [undefined, null], ['', null], [' \t ', null], ['0', 0], ['-0', 0], [0, 0], ['1,234', 1234], ['₩1,234원', 1234], ['-₩1,234원', -1234], ['₩-1,234원', -1234], ['(1,234)', -1234], ['(₩1,234원)', -1234], ['＋１２３', 123], ['999999999999', 999999999999]]) {
    assert.equal(parseNumber(input), expected, `parse ${String(input)}`);
  }
  assert.equal(parseNumber('3대', { count: true }), 3);
  assert.equal(parseNumber('1,234 대', { count: true }), 1234);
  assert.equal(parseNumber('999999', { count: true }), 999999);
  assert.equal(parseNumber('0', { allowNegative: false }), 0);
  assert.equal(Object.is(parseNumber('-0'), -0), false);
});

test('invalid pasted amounts cannot become different plausible amounts', () => {
  for (const input of [true, {}, [], NaN, Infinity, 1.5, '1.5', '1,234.00', '1e3', '1.2만', '12달러', '1,23', '1 2', '--1', '1-2', '-', '(1', '(-1)', '1원원', '₩₩1', '1000000000000', '-1000000000000']) invalid(() => parseNumber(input));
  for (const input of ['-1', '(1)', '1000000', '₩1대', '1.0대']) invalid(() => parseNumber(input, { count: true }));
  for (const input of [-1, '-1', '(1)']) invalid(() => parseNumber(input, { allowNegative: false }));
});

test('month validation covers exact format and year transition', () => {
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(previousMonth('2026-10'), '2026-09');
  assert.equal(previousMonth('0001-01'), null);
  for (const month of ['2026-00', '2026-13', '2026-1', '2026-01-extra', '0000-01', null]) {
    invalid(() => previousMonth(month)); invalid(() => createBook(month));
  }
});

test('normalization allows only contractual input fields without mutating data', () => {
  const book = createBook('2026-01');
  book.income = 999; book.closing = 999; book.extra = { private: true };
  book.dealers[0].unknown = 3; book.opening.derived = 4;
  book.dealers[0].name = ' 담당자 A ';
  book.updatedAt = '2026-01-10T00:00:00.000Z'; book.writeId = 'request-example';
  const before = clone(book); freeze(book);
  const result = normalizeBook(book);
  assert.equal(result.dealers[0].name, '담당자 A');
  assert.equal(result.updatedAt, before.updatedAt); assert.equal(result.writeId, 'request-example');
  for (const key of ['income', 'closing', 'extra']) assert.equal(key in result, false);
  assert.equal('unknown' in result.dealers[0], false); assert.equal('derived' in result.opening, false);
  assert.deepEqual(book, before); assert.notEqual(result.dealers, book.dealers);
});

test('validation rejects malformed schema, bad row identifiers and limits', () => {
  const mutations = [
    book => { book.version = 2; }, book => { book.month = '2026-13'; }, book => { book.id = 'other'; },
    book => { book.opening.mode = 'unrecognized'; }, book => { book.dealers[0].name = '가'.repeat(61); },
    book => { book.expenses[0].label = '가'.repeat(121); }, book => { book.note = 'x'.repeat(501); },
    book => { book.receivables[0].note = 'x'.repeat(501); }, book => { book.accounts[0].id = ''; },
    book => { book.dealers[1].id = book.dealers[0].id; }, book => { delete book.dealers[0].buyFee; },
    book => { book.dealers[0].buyFee = '100'; }, book => { book.dealers[0].sellCount = -1; },
    book => { book.dealers[0].buyCount = 1000000; }, book => { book.expenses[0].amount = 1.1; },
    book => { book.adjustments[0].amount = 1000000000000; }, book => { book.finance[0].limit = -1; },
    book => { book.finance[0].used = -1; }, book => { book.finance[0].rate = 100.001; },
    book => { book.finance[0].rate = NaN; }, book => { book.updatedAt = null; }
  ];
  for (const mutate of mutations) {
    const book = createBook('2026-01'); mutate(book);
    const result = validateBook(book);
    assert.equal(result.ok, false); assert.equal(result.book, null);
    assert(result.errors.every(error => typeof error.path === 'string' && typeof error.message === 'string'));
    invalid(() => normalizeBook(book));
  }
  for (const [section, limit] of Object.entries({ dealers: 50, expenses: 200, adjustments: 50, accounts: 30, finance: 30, receivables: 100 })) {
    const book = createBook('2026-01'), sample = book[section][0];
    book[section] = Array.from({ length: limit + 1 }, (_, index) => ({ ...sample, id: `row-${index}` }));
    assert.equal(validateBook(book).ok, false, section);
  }
});

test('all contractual money fields allow negatives except finance principal/limit', () => {
  const book = manual('2026-01', -10);
  book.dealers[0].buyFee = -1; book.expenses[0].amount = -2;
  book.adjustments[0].amount = -3; book.accounts[0].balance = -4;
  book.receivables[0].amount = -5;
  assert.equal(validateBook(book).ok, true);
  const total = calculate(book);
  assert.equal(total.operatingNet, 1); assert.equal(total.cashNet, -2); assert.equal(total.closing, -12);
  assert.equal(total.bankActual, -4); assert.equal(total.bankDifference, 8); assert.equal(total.receivableTotal, -5);
});

test('fee income, costs and cash adjustments stay separate from credit and receivables', () => {
  const book = manual('2026-01');
  Object.assign(book.dealers[0], { buyCount: 2, sellCount: 3, buyFee: 20, sellFee: 30, yardFee: 40 });
  book.expenses[0].amount = 50; book.adjustments[0].amount = -7;
  Object.assign(book.finance[0], { limit: 9000, used: 7000, rate: 12.5 });
  book.receivables[0].amount = 12345; book.accounts[0].balance = 100;
  const t = calculate(book);
  assert.deepEqual([t.buyCount, t.sellCount, t.buyFee, t.sellFee, t.yardFee], [2, 3, 20, 30, 40]);
  assert.deepEqual([t.income, t.expense, t.operatingNet, t.adjustment, t.cashNet], [90, 50, 40, -7, 33]);
  assert.equal(t.closing, 33); assert.equal(t.bankDifference, 67);
  assert.equal(t.financeRemaining, 2000); assert.equal(t.receivableTotal, 12345);
  book.finance[0].rate = 99; book.receivables[0].amount = -999;
  assert.equal(calculate(book).closing, 33);
});

test('blank versus explicit zero is preserved for opening, bank and finance', () => {
  const book = createBook('2026-01');
  let total = calculate(book);
  assert.equal(total.openingKnown, false); assert.equal(total.opening, null); assert.equal(total.closing, null);
  assert.equal(total.openingSource, 'missing'); assert.equal(total.bankKnown, false); assert.equal(total.bankActual, null);
  assert.equal(total.bankDifference, null); assert.equal(total.financeKnown, false);
  assert.equal(total.financeLimit, null); assert.equal(total.financeUsed, null); assert.equal(total.financeRemaining, null);
  book.opening = { mode: 'manual', amount: 0 }; book.accounts[0].balance = 0;
  book.finance[0].limit = 0; book.finance[0].used = 0;
  total = calculate(book);
  assert.equal(total.openingKnown, true); assert.equal(total.closingKnown, true); assert.equal(total.closing, 0);
  assert.equal(total.bankKnown, true); assert.equal(total.bankActual, 0); assert.equal(total.bankDifference, 0);
  assert.equal(total.financeKnown, true); assert.equal(total.financeRemaining, 0);
});

test('automatic carry recursively follows exact previous months across years', () => {
  const december = manual('2025-12', 100); december.dealers[0].buyFee = 25;
  const january = createBook('2026-01'); january.expenses[0].amount = 5;
  const february = createBook('2026-02'); february.adjustments[0].amount = 6;
  const total = calculate(february, [december, january]);
  assert.equal(total.openingSource, 'auto'); assert.equal(total.opening, 120); assert.equal(total.closing, 126);
  assert.equal(total.income, 0); assert.equal(total.expense, 0); assert.equal(total.adjustment, 6);
});

test('missing months are not skipped, and a prior unset opening stays unknown', () => {
  const january = manual('2026-01', 100), march = createBook('2026-03');
  let total = calculate(march, [january]);
  assert.equal(total.openingSource, 'missing'); assert.equal(total.closingKnown, false);
  const february = manual('2026-02', null);
  total = calculate(march, [january, february]);
  assert.equal(total.openingSource, 'auto'); assert.equal(total.openingKnown, false); assert.equal(total.closing, null);
  february.opening.amount = 0;
  total = calculate(march, [january, february]); assert.equal(total.opening, 0); assert.equal(total.closing, 0);
});

test('the current draft overrides the saved same month once, without mutating books', () => {
  const january = manual('2026-01', 10), saved = createBook('2026-02'), draft = clone(saved);
  saved.dealers[0].buyFee = 1; draft.dealers[0].buyFee = 9;
  const books = freeze([january, saved]);
  assert.equal(calculate(draft, books).closing, 19);
  assert.equal(saved.dealers[0].buyFee, 1);
});

test('partly entered finance is unknown; over-limit and partially entered bank values remain honest', () => {
  const book = manual('2026-01');
  book.finance[0].label = '참고 한도'; book.finance[0].limit = 100;
  let total = calculate(book); assert.equal(total.financeLimit, 100); assert.equal(total.financeUsed, null); assert.equal(total.financeRemaining, null);
  book.finance[0].used = 150;
  total = calculate(book); assert.equal(total.financeKnown, true); assert.equal(total.financeRemaining, -50);
  book.finance[1].limit = 20;
  total = calculate(book); assert.equal(total.financeKnown, false); assert.equal(total.financeRemaining, null);
  book.accounts[1].balance = -5;
  total = calculate(book); assert.equal(total.bankKnown, true); assert.equal(total.bankActual, -5); assert.equal(total.bankDifference, -5);
});

test('a long carry cannot silently exceed safe integer arithmetic', () => {
  const maximum = 999999999999, books = [];
  for (let index = 0; index < 23; index++) {
    const month = `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
    const book = index === 0 ? manual(month) : createBook(month);
    book.dealers = Array.from({ length: 50 }, (_, n) => ({ id: `d-${n}`, name: '', buyCount: null, sellCount: null, buyFee: maximum, sellFee: maximum, yardFee: maximum }));
    book.expenses = Array.from({ length: 200 }, (_, n) => ({ id: `e-${n}`, label: '', amount: -maximum }));
    book.adjustments = Array.from({ length: 50 }, (_, n) => ({ id: `a-${n}`, label: '', amount: maximum }));
    books.push(book);
  }
  invalid(() => calculate(books.at(-1), books));
});

test('mixed-array merges preserve every other legacy/unknown record exactly', () => {
  const legacy = { id: 'legacy-entry', amount: 12, note: '0000000000000', extra: { future: ['a', null] } };
  const unknown = { type: 'other-future-record', data: { text: '  retain spacing\n' } };
  const otherMonth = createBook('2026-02'); otherMonth.futureField = 'preserve untouched raw book';
  const payload = freeze([legacy, null, unknown, otherMonth, 42, ['future-array']]);
  const before = clone(payload), book = createBook('2026-01'); book.income = 123;
  const result = mergeMonth(payload, book);
  assert.deepEqual(payload, before); assert.equal(result.length, payload.length + 1);
  payload.forEach((record, index) => assert.strictEqual(result[index], record));
  assert.equal('income' in result.at(-1), false);
  assert.deepEqual(legacyRows(result), [legacy, null, unknown, 42, payload[5]]);
  assert.deepEqual(listBooks(result).map(row => row.month), ['2026-01', '2026-02']);
  assert.equal('futureField' in listBooks(result)[1], false);
  const replacement = clone(book); replacement.note = 'updated';
  const again = mergeMonth(result, replacement);
  assert.equal(again.length, result.length); assert.equal(again.at(-1).note, 'updated');
  assert.strictEqual(again[0], legacy); assert.strictEqual(again[3], otherMonth);
});

test('malformed reserved records and duplicate months fail closed', () => {
  const book = createBook('2026-01');
  for (const payload of [null, {}, '[]']) { invalid(() => listBooks(payload)); invalid(() => mergeMonth(payload, book)); invalid(() => legacyRows(payload)); }
  for (const payload of [[book, clone(book)], [{ ...book, version: 2 }], [{ type: TYPE, month: book.month, version: VERSION }]]) {
    invalid(() => listBooks(payload)); invalid(() => mergeMonth(payload, book)); invalid(() => calculate(book, payload));
  }
});

test('fingerprints sort object keys, keep array order and metadata, and do not mutate', async () => {
  const first = freeze({ b: [{ y: 2, x: 1 }, null], a: true, writeId: 'request-a' });
  const reordered = { writeId: 'request-a', a: true, b: [{ x: 1, y: 2 }, null] };
  const hash = await fingerprint(first);
  assert.match(hash, /^[a-f0-9]{64}$/); assert.equal(hash, await fingerprint(reordered));
  assert.notEqual(hash, await fingerprint({ ...reordered, writeId: 'request-b' }));
  assert.notEqual(hash, await fingerprint({ ...reordered, b: [null, { x: 1, y: 2 }] }));
  assert.equal(await fingerprint(null), null);
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [undefined, cyclic, { n: Infinity }, { n: undefined }]) await assert.rejects(fingerprint(value), error => error?.code === 'INVALID_DATA');
});

test('CSV round-trips Korean text/quotes/newlines and guards text formulas without altering numeric negatives', () => {
  const book = manual('2026-01');
  Object.assign(book.dealers[0], { name: '=HYPERLINK("test")', buyCount: 0, buyFee: -123 });
  book.expenses[0].label = '@SUM(test)'; book.expenses[0].amount = -7;
  book.adjustments[0].label = '+unsafe'; book.receivables[0].label = '-unsafe';
  book.note = '한글, "따옴표"\n둘째 줄';
  const csv = exportCSV(book);
  assert(csv.startsWith('\uFEFF')); assert(csv.endsWith('\r\n'));
  const rows = csvRows(csv);
  assert(rows.some(row => row[0] === "'=HYPERLINK(\"test\")" && row[1] === '0' && row[3] === '-123'));
  assert(rows.some(row => row[0] === "'@SUM(test)" && row[1] === '-7'));
  assert(rows.some(row => row[0] === "'+unsafe")); assert(rows.some(row => row[0] === "'-unsafe"));
  assert(rows.some(row => row[0] === book.note));
  assert(rows.some(row => row[0] === '재고금융')); assert(rows.some(row => row[0] === '미수/정산 보조'));
  assert.equal(csv.includes("'-123"), false);
  assert(rows.some(row => row[0] === '담당자명') === false);
  assert(rows.some(row => row.length === 7 && row[0] === '' && row[1] === '' && row[6] === '0'));
  const invalidBook = clone(book); invalidBook.dealers[0].buyFee = 0.1;
  invalid(() => exportCSV(invalidBook));
});
