import './money.js?v=2.76';
import './inventory-interest.js?v=2.112';
import './custom-cost-model.js?v=2.85';
import { TEMPLATE, TEMPLATE_ID } from './income-settlement-template.js?v=2.41';
export { TEMPLATE, TEMPLATE_ID };

const TYPE = 'snote-income-settlement';
const MAX_MONEY = 9_999_999_999_999;
const INPUTS = Object.keys(TEMPLATE.inputs);
const COSTS = [['bodywork', '차량판금비용'], ['polish', '차량광택비용'], ['performanceInspection', '성능점검비'], ['advertising', '광고비용'], ['purchaseFee', '매입수수료'], ['purchaseOther', '매입비'], ['repair', '수리비']];
class IncomeError extends Error {
  constructor(message = '소득정산 입력 형식을 확인해 주세요.', cell) { super(message); this.code = 'VALIDATION_ERROR'; if (cell) this.cell = cell; }
}
function invalid(message, cell) { throw new IncomeError(message, cell); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function only(value, fields) { if (!plain(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.includes(key))) invalid(); }
function controls(value, multiline = false) { return (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u : /[\u0000-\u001f\u007f-\u009f]/u).test(value); }
function validText(value, limit, multiline = false) { if (typeof value !== 'string' || controls(value, multiline) || Array.from(value).length > limit) invalid(); return value; }
function date(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('날짜를 YYYY-MM-DD 형식으로 확인해 주세요.');
  const [year, month, day] = value.split('-').map(Number), parsed = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) invalid('실제 날짜를 확인해 주세요.');
  return value;
}

export function parseMoney(raw) {
  if (raw === null) return null;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || Math.abs(raw) > MAX_MONEY) invalid('금액은 허용 범위의 원 단위 정수로 입력해 주세요.');
    return Object.is(raw, -0) ? 0 : raw;
  }
  if (typeof raw !== 'string') invalid('금액 형식을 확인해 주세요.');
  let value = raw.normalize('NFKC').trim();
  if (!value) return null;
  let parentheses = false;
  if (value.startsWith('(') && value.endsWith(')')) { parentheses = true; value = value.slice(1, -1).trim(); }
  let currency = false;
  if (value.startsWith('₩')) { currency = true; value = value.slice(1).trim(); }
  let sign = '';
  if (/^[+-]/.test(value)) { sign = value[0]; value = value.slice(1).trim(); }
  if (!currency && value.startsWith('₩')) value = value.slice(1).trim();
  if (value.endsWith('원')) value = value.slice(0, -1).trim();
  if ((parentheses && sign) || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) invalid('금액은 소수·지수·문자 없이 원 단위 정수로 입력해 주세요.');
  const amount = BigInt(value.replaceAll(',', '')) * (parentheses || sign === '-' ? -1n : 1n);
  if (amount > BigInt(MAX_MONEY) || amount < -BigInt(MAX_MONEY)) invalid('입력할 수 있는 금액 범위를 초과했습니다.');
  return Number(amount);
}

export function normalizeDocument(raw) {
  only(raw, ['type', 'version', 'templateVersion', 'cells', 'purchaseKind', 'overrides']);
  if (raw.type !== TYPE || raw.version !== 1 || raw.templateVersion !== TEMPLATE_ID || !['recycled', 'invoice', 'manual'].includes(raw.purchaseKind)) invalid('소득정산 문서 버전을 확인해 주세요.');
  only(raw.cells, INPUTS);
  const cells = {};
  for (const [cell, metadata] of Object.entries(TEMPLATE.inputs)) {
    const value = Object.hasOwn(raw.cells, cell) ? raw.cells[cell] : metadata.kind === 'money' ? null : '';
    try {
      if (metadata.kind === 'money') cells[cell] = parseMoney(value);
      else if (metadata.kind === 'date') cells[cell] = date(value);
      else if (metadata.kind === 'identity') {
        if (typeof value !== 'string') invalid();
        const identifier = value.trim();
        if (identifier && !/^\d{6}-?\d{7}$/.test(identifier)) invalid('알선딜러 주민번호는 앞 6자리와 뒤 7자리를 확인해 주세요.');
        cells[cell] = identifier.replace('-', '');
      } else cells[cell] = validText(value, metadata.maxLength || 100, cell === 'J4');
    } catch (error) { if (error instanceof IncomeError) { error.cell = cell; throw error; } invalid(undefined, cell); }
  }
  const overrides = raw.overrides ?? [];
  if (!Array.isArray(overrides) || overrides.length > INPUTS.length || overrides.some(cell => typeof cell !== 'string' || !INPUTS.includes(cell))) invalid('수정한 입력칸 정보를 확인해 주세요.');
  return { type: TYPE, version: 1, templateVersion: TEMPLATE_ID, cells, purchaseKind: raw.purchaseKind, overrides: [...new Set(overrides)].sort() };
}

function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; }
function rational(n, d = 1n) { if (!d) invalid('수식에서 0으로 나눌 수 없습니다.'); if (d < 0n) { n = -n; d = -d; } const common = gcd(n, d); return { n: n / common, d: d / common }; }
const ZERO = rational(0n);
function add(a, b) { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function subtract(a, b) { return rational(a.n * b.d - b.n * a.d, a.d * b.d); }
function multiply(a, b) { return rational(a.n * b.n, a.d * b.d); }
function divide(a, b) { return rational(a.n * b.d, a.d * b.n); }
function decimal(value) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match || !(match[2] || match[3])) invalid('수치 형식을 확인해 주세요.');
  const exponent = Number(match[4] || 0), fraction = match[3] || '';
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) invalid('수치 범위를 확인해 주세요.');
  let n = BigInt((match[2] || '0') + fraction) * (match[1] === '-' ? -1n : 1n), scale = fraction.length - exponent;
  return scale >= 0 ? rational(n, 10n ** BigInt(scale)) : rational(n * 10n ** BigInt(-scale));
}
function round(value, digits = 0, down = false) {
  if (!Number.isInteger(digits) || digits < -12 || digits > 12) invalid('지원하지 않는 수식 반올림 자리입니다.');
  const scale = 10n ** BigInt(Math.abs(digits));
  const numerator = digits >= 0 ? value.n * scale : value.n, denominator = digits >= 0 ? value.d : value.d * scale;
  let result = numerator / denominator;
  if (!down && (numerator < 0n ? -numerator : numerator) % denominator * 2n >= denominator) result += numerator < 0n ? -1n : 1n;
  return digits >= 0 ? rational(result, scale) : rational(result * scale);
}
function integer(value) { if (value.d !== 1n || value.n > BigInt(Number.MAX_SAFE_INTEGER) || value.n < -BigInt(Number.MAX_SAFE_INTEGER)) invalid('계산 결과가 정수 또는 안전 범위를 벗어났습니다.'); return Number(value.n); }

function sourceText(value, limit) { if (typeof value !== 'string') return ''; return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim()).slice(0, limit).join(''); }
function sourceId(value, optional = false) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && value.length <= 200 && !controls(value) && (optional || value.length)) return value;
  if (optional && value == null) return '';
  invalid('차량과 담당자 연결 정보를 확인해 주세요.');
}
function sourceDate(value) { if (typeof value !== 'string') return ''; try { return date(value); } catch { return ''; } }
function moneyValue(value) {
  if (value == null || value === '') return null;
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && (!value.trim() || value.length > 200))) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > MAX_MONEY) return null;
  try { return decimal(String(value).trim()); } catch { return null; }
}
function won(value) {
  if (!value) return null;
  const result = round(value);
  return result.n <= BigInt(MAX_MONEY) && result.n >= -BigInt(MAX_MONEY) ? Number(result.n) : null;
}

export function createSource(car, { dealerName = '', companyName = '', ownerId, lenders = [] } = {}) {
  if (!plain(car)) invalid('차량 자료를 확인해 주세요.');
  car = globalThis.SnoteMoney.car(car);
  const warnings = [], costs = plain(car.costs) ? car.costs : {};
  const convert = (value, label, required = false) => {
    const amount = won(moneyValue(value));
    if (amount === null && (required || (value != null && value !== ''))) warnings.push(label + ' 원 단위 금액을 확인해 주세요.');
    return amount;
  };
  const buyWon = convert(car.buy, '최초 매입금액', true), soldWon = convert(car.soldPrice, '실제 판매금액', true);
  const acquisitionTaxWon = convert(costs.acquisitionTax, '취득세');
  const costSuggestions = [];
  for (const [key, label] of COSTS) {
    let amountWon;
    if (key === 'repair' && Array.isArray(car.repairItems)) {
      let total = ZERO, valid = true;
      for (const item of car.repairItems) { const amount = plain(item) ? moneyValue(item.amount) : null; if (amount === null) { valid = false; break; } total = add(total, amount); }
      amountWon = valid ? won(total) : null;
      if (!valid || amountWon === null) warnings.push('수리비 원 단위 금액을 확인해 주세요.');
    } else amountWon = convert(costs[key], label);
    if (amountWon !== null && amountWon !== 0) costSuggestions.push({ key, label, amountWon });
  }
  const interest = globalThis.SnoteInventoryInterest.calculate(car, lenders);
  const inventoryInterestWon = interest.ready ? interest.amountWon : (convert(costs.inventoryInterest, '재고금융 이자') || 0);
  let customCostsWon;
  try { customCostsWon = globalThis.SnoteCustomCosts.sum(globalThis.SnoteCustomCosts.normalize(car.customCosts, { strict: true })); }
  catch { invalid('추가 비용의 항목과 원 단위 금액을 확인해 주세요.'); }
  if (!interest.ready && Number(car.inventoryLoan || 0) > 0) warnings.push(interest.reason + ' 기존 재고 이자를 반영합니다.');
  const unmapped = [];
  for (const [key, label] of [['incomeTax', '기존 소득세 (참고)']]) {
    const amountWon = convert(costs[key], label); if (amountWon !== null && amountWon !== 0) unmapped.push({ key, label, amountWon });
  }
  const year = car.year == null ? '' : String(car.year).trim();
  return { carId: sourceId(car.id), ownerId: sourceId(ownerId ?? car.ownerId, true), status: sourceText(car.status, 40), model: sourceText(car.model, 200), plate: sourceText(car.plate, 30), year: /^\d{4}$/.test(year) ? year : '', purchaseAt: sourceDate(car.purchaseAt), soldAt: sourceDate(car.soldAt), buyWon, soldWon, acquisitionTaxWon, dealerName: sourceText(dealerName, 100), companyName: sourceText(companyName, 100), costSuggestions, inventoryInterestWon, ...(customCostsWon > 0 ? { customCostsWon } : {}), unmapped, warnings };
}

export function createDocument(source) {
  if (!plain(source)) invalid('차량 정산 기준정보를 확인해 주세요.');
  const cells = Object.fromEntries(Object.entries(TEMPLATE.inputs).map(([cell, metadata]) => [cell, metadata.kind === 'money' ? null : '']));
  Object.assign(cells, { C2: source.dealerName || '', C3: source.model || '', F3: source.plate || '', J3: source.year == null ? '' : String(source.year), C4: source.purchaseAt || '', F4: source.soldAt || '', J4: '', G2: source.companyName || '', D8: source.soldWon ?? null, D10: 0, D11: source.buyWon ?? null, D31: source.acquisitionTaxWon ?? null });
  return normalizeDocument({ type: TYPE, version: 1, templateVersion: TEMPLATE_ID, cells, purchaseKind: 'recycled', overrides: [] });
}

export function invoiceCostSuggestions(source) {
  if (!plain(source) || !Array.isArray(source.costSuggestions)) return [];
  return source.costSuggestions.map(item => {
    if (!plain(item) || !COSTS.some(([key]) => key === item.key) || typeof item.label !== 'string') invalid('부대비용 참고자료를 확인해 주세요.');
    const amountWon = parseMoney(item.amountWon); if (amountWon === null) invalid('부대비용 참고금액을 확인해 주세요.');
    return { key: item.key, label: validText(item.label, 100), amountWon };
  });
}

function formulaParser(formula) {
  const text = formula.slice(1), tokens = []; let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset])) { offset++; continue; }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)|^[A-Z]+\d+|^[A-Z]+|^(?:>=|<=|<>|[+\-*/(),:%><=])/.exec(text.slice(offset));
    if (!match) invalid('지원하지 않는 원본 수식입니다.'); tokens.push(match[0]); offset += match[0].length;
  }
  let position = 0;
  const take = value => { if (tokens[position] === value) { position++; return true; } return false; };
  function primary() {
    const token = tokens[position++]; let node;
    if (token === '(') { node = compare(); if (!take(')')) invalid('수식 괄호를 확인해 주세요.'); }
    else if (/^(?:\d|\.)/.test(token || '')) node = { type: 'number', value: decimal(token) };
    else if (/^[A-Z]+\d+$/.test(token || '')) { node = { type: 'cell', cell: token }; if (take(':')) { const end = tokens[position++]; if (!/^[A-Z]+\d+$/.test(end || '')) invalid(); node = { type: 'range', start: token, end }; } }
    else if (['SUM', 'ROUND', 'ROUNDDOWN', 'IF'].includes(token) && take('(')) { const args = []; if (!take(')')) { do { args.push(compare()); } while (take(',')); if (!take(')')) invalid(); } node = { type: 'function', name: token, args }; }
    else invalid('지원하지 않는 원본 수식입니다.');
    while (take('%')) node = { type: 'binary', operator: '/', left: node, right: { type: 'number', value: rational(100n) } };
    return node;
  }
  function unary() { if (take('+')) return unary(); if (take('-')) return { type: 'binary', operator: '-', left: { type: 'number', value: ZERO }, right: unary() }; return primary(); }
  function product() { let node = unary(); while (['*', '/'].includes(tokens[position])) { const operator = tokens[position++]; node = { type: 'binary', operator, left: node, right: unary() }; } return node; }
  function sum() { let node = product(); while (['+', '-'].includes(tokens[position])) { const operator = tokens[position++]; node = { type: 'binary', operator, left: node, right: product() }; } return node; }
  function compare() { let node = sum(); if (['>', '<', '>=', '<=', '=', '<>'].includes(tokens[position])) { const operator = tokens[position++]; node = { type: 'compare', operator, left: node, right: sum() }; } return node; }
  const tree = compare(); if (position !== tokens.length) invalid('원본 수식 뒤에 처리되지 않은 내용이 있습니다.'); return tree;
}
const FORMULAS = Object.fromEntries(Object.entries(TEMPLATE.formulas).map(([cell, formula]) => [cell, formulaParser(formula)]));
function range(start, end) {
  const parts = cell => { const match = /^([A-Z]+)(\d+)$/.exec(cell); return [Array.from(match[1]).reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0), Number(match[2])]; };
  const [a, b] = parts(start), [c, d] = parts(end), cells = [];
  if (Math.max(a, c) > TEMPLATE.cols || Math.max(b, d) > TEMPLATE.rows) invalid('원본 수식 참조 범위를 확인해 주세요.');
  for (let row = Math.min(b, d); row <= Math.max(b, d); row++) for (let col = Math.min(a, c); col <= Math.max(a, c); col++) cells.push(String.fromCharCode(64 + col) + row);
  return cells;
}

export function calculate(raw, source = {}) {
  const interest = source?.inventoryInterestWon ?? 0;
  if (!Number.isSafeInteger(interest) || interest < 0 || interest > MAX_MONEY) invalid('재고 이자를 확인해 주세요.');
  const customCosts = source?.customCostsWon ?? 0;
  if (!Number.isSafeInteger(customCosts) || customCosts < 0) invalid('추가 비용의 원 단위 합계를 확인해 주세요.');
  const doc = normalizeDocument(raw), cache = new Map(), active = new Set();
  function cell(id) {
    if (cache.has(id)) return cache.get(id);
    if (active.has(id)) invalid('순환 수식은 계산할 수 없습니다.');
    active.add(id);
    let value = FORMULAS[id] ? evaluate(FORMULAS[id]) : typeof doc.cells[id] === 'number' ? rational(BigInt(doc.cells[id])) : ZERO;
    if (id === 'D28') value = add(add(value, rational(BigInt(interest))), rational(BigInt(customCosts)));
    active.delete(id); cache.set(id, value); return value;
  }
  function evaluate(node) {
    if (node.type === 'number') return node.value;
    if (node.type === 'cell') return cell(node.cell);
    if (node.type === 'range') invalid('범위는 SUM 함수에서만 사용할 수 있습니다.');
    if (node.type === 'binary') { const a = evaluate(node.left), b = evaluate(node.right); return ({ '+': add, '-': subtract, '*': multiply, '/': divide })[node.operator](a, b); }
    if (node.type === 'compare') { const difference = subtract(evaluate(node.left), evaluate(node.right)).n; return rational(({ '>': difference > 0n, '<': difference < 0n, '>=': difference >= 0n, '<=': difference <= 0n, '=': difference === 0n, '<>': difference !== 0n })[node.operator] ? 1n : 0n); }
    if (node.name === 'IF') { if (node.args.length !== 3) invalid(); return evaluate(evaluate(node.args[0]).n !== 0n ? node.args[1] : node.args[2]); }
    if (node.name === 'SUM') return node.args.reduce((total, value) => value.type === 'range' ? range(value.start, value.end).reduce((subtotal, id) => add(subtotal, cell(id)), total) : add(total, evaluate(value)), ZERO);
    if (node.args.length !== 2) invalid(); return round(evaluate(node.args[0]), integer(evaluate(node.args[1])), node.name === 'ROUNDDOWN');
  }
  const cells = { ...doc.cells };
  for (const id of Object.keys(FORMULAS)) cells[id] = integer(cell(id));
  const warnings = [
    '첨부 원본의 재활용매입세액 라벨은 10/110이지만 F11은 1.09로 나눕니다. 원본 수식을 그대로 적용합니다.',
    'D41은 D40을 더합니다. 타차량 적자분을 차감하려면 D40에 음수를 입력해 주세요.',
    'H35는 병합된 비기준 셀 I30:I32를 참조하는 원본 수식을 유지하므로 0으로 계산됩니다.',
    '알선딜러 계산은 원본처럼 음수 결과를 0으로 보정하지 않습니다.'
  ];
  if (doc.cells.D8 === null) warnings.push('실제 판매금액이 비어 있어 원본 수식의 0으로 계산합니다. 희망 판매가격으로 대체하지 않습니다.');
  if ((doc.purchaseKind === 'recycled' && doc.cells.D11 === null) || (doc.purchaseKind === 'invoice' && doc.cells.D10 === null) || (doc.cells.D10 === null && doc.cells.D11 === null)) warnings.push('매입금액이 비어 있어 0으로 계산합니다.');
  if (doc.cells.D10 && doc.cells.D11) warnings.push('세금계산서 매입액과 재활용매입 금액이 모두 입력되어 있습니다. 중복 여부를 확인해 주세요.');
  return { cells, totals: { vat: cells.I36, purchaseIncome: cells.D41, purchaseIncomeTax: cells.D42, purchaseLocalTax: cells.D43, purchaseNet: cells.D44, brokerIncome: cells.D49, brokerIncomeTax: cells.D50, brokerLocalTax: cells.D51, brokerNet: cells.D52 }, warnings };
}

function stable(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  invalid('저장된 자료의 JSON 형식을 확인해 주세요.');
}
async function hash(value) { const bytes = new TextEncoder().encode(stable(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function sourceFingerprint(source) { return hash(source); }
export async function documentFingerprint(rawStored) { return rawStored == null ? null : hash(rawStored); }
export function serializePublic(raw) { const doc = normalizeDocument(raw); doc.cells.H50 = ''; return doc; }
export function draftDocument(raw) { return serializePublic(raw); }
