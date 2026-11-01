// A general calculator, independent of the financial ledgers and the DOM.
const PRECISION = 15;
const MAX_ENTRY_LENGTH = 24;
const OPERATORS = new Set(['+', '-', '*', '/']);
const SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const MESSAGES = { DIVIDE_BY_ZERO: '0으로 나눌 수 없습니다.', OUT_OF_RANGE: '계산 결과가 표시 범위를 초과했습니다.' };

function rounded(value) {
  if (!Number.isFinite(value)) return null;
  const result = Number(value.toPrecision(PRECISION));
  return Number.isFinite(result) ? (Object.is(result, -0) ? 0 : result) : null;
}
function formatted(value) { return String(Object.is(value, -0) ? 0 : value); }
function calculate(left, operator, right) {
  if (operator === '/' && right === 0) return { errorCode: 'DIVIDE_BY_ZERO' };
  const value = operator === '+' ? left + right : operator === '-' ? left - right : operator === '*' ? left * right : left / right;
  const result = rounded(value);
  return result === null ? { errorCode: 'OUT_OF_RANGE' } : { value: result };
}
function displayedEntry(entry) { return entry.startsWith('-') && Number(entry) === 0 ? entry.slice(1) : entry; }

export function createCalculator() {
  let entry, left, operator, waiting, evaluated, repeatOperator, repeatOperand, lastExpression, errorCode, hasValue;
  function clear() {
    entry = '0'; left = null; operator = null; waiting = false; evaluated = false;
    repeatOperator = null; repeatOperand = null; lastExpression = ''; errorCode = null; hasValue = false;
  }
  function snapshot() {
    let expression = lastExpression; let preview = null;
    if (operator) {
      expression = `${formatted(left)} ${SYMBOLS[operator]}${waiting ? '' : ' ' + displayedEntry(entry)}`;
      if (!waiting && !errorCode) {
        const result = calculate(left, operator, Number(entry));
        if (!result.errorCode) preview = formatted(result.value);
      }
    }
    return { display: errorCode ? '오류' : displayedEntry(entry), expression, error: errorCode ? MESSAGES[errorCode] : null, errorCode, hasValue, preview };
  }
  function reset() { clear(); return snapshot(); }
  function fail(code, expression) {
    errorCode = code; lastExpression = expression; operator = null; left = null;
    repeatOperator = null; repeatOperand = null; waiting = false; evaluated = true; hasValue = true;
  }
  function prepareEntry() {
    if (errorCode || (evaluated && !operator)) clear();
    if (waiting || entry.includes('e')) { entry = '0'; waiting = false; }
    evaluated = false; lastExpression = '';
  }
  function digit(key) {
    prepareEntry();
    let candidate;
    if (entry === '0') candidate = key;
    else if (entry === '-0') candidate = key === '0' ? '-0' : '-' + key;
    else candidate = entry + key;
    const significant = candidate.replace('-', '').replace('.', '').replace(/^0+/, '');
    if (significant.length <= PRECISION && candidate.replace('-', '').length <= MAX_ENTRY_LENGTH) entry = candidate;
    hasValue = true;
  }
  function decimal() {
    prepareEntry();
    if (!entry.includes('.') && entry.replace('-', '').length < MAX_ENTRY_LENGTH) entry += '.';
    hasValue = true;
  }
  function operation(next) {
    if (errorCode) return;
    if (operator && waiting) { operator = next; return; }
    if (operator) {
      const right = Number(entry); const expression = `${formatted(left)} ${SYMBOLS[operator]} ${displayedEntry(entry)} =`;
      const result = calculate(left, operator, right);
      if (result.errorCode) { fail(result.errorCode, expression); return; }
      entry = formatted(result.value); left = result.value;
    } else left = Number(entry);
    operator = next; waiting = true; evaluated = false; lastExpression = '';
    repeatOperator = null; repeatOperand = null; hasValue = true;
  }
  function equals() {
    if (errorCode) return;
    const selected = operator || repeatOperator;
    if (!selected) {
      if (hasValue) { entry = formatted(Number(entry)); lastExpression = `${entry} =`; evaluated = true; }
      return;
    }
    const a = operator ? left : Number(entry);
    const b = operator ? (waiting ? left : Number(entry)) : repeatOperand;
    const expression = `${formatted(a)} ${SYMBOLS[selected]} ${formatted(b)} =`;
    const result = calculate(a, selected, b);
    if (result.errorCode) { fail(result.errorCode, expression); return; }
    entry = formatted(result.value); lastExpression = expression; repeatOperator = selected; repeatOperand = b;
    operator = null; left = null; waiting = false; evaluated = true; hasValue = true;
  }
  function sign() {
    if (errorCode) clear();
    if (waiting) { entry = '0'; waiting = false; }
    entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry;
    lastExpression = ''; repeatOperator = null; repeatOperand = null; hasValue = true;
  }
  function percent() {
    if (errorCode) return;
    if (waiting) { entry = '0'; waiting = false; }
    let value = Number(entry) / 100;
    if (operator === '+' || operator === '-') value *= left;
    const result = rounded(value);
    if (result === null) { fail('OUT_OF_RANGE', ''); return; }
    entry = formatted(result); lastExpression = ''; repeatOperator = null; repeatOperand = null; hasValue = true;
  }
  function backspace() {
    if (errorCode) { clear(); return; }
    if (operator && waiting) {
      entry = formatted(left); left = null; operator = null; waiting = false;
    } else if (entry.includes('e')) entry = '0';
    else { entry = entry.slice(0, -1); if (!entry || entry === '-') entry = '0'; }
    evaluated = false; lastExpression = ''; repeatOperator = null; repeatOperand = null;
    hasValue = entry !== '0' || operator !== null;
  }
  function input(key) {
    if (typeof key !== 'string') return snapshot();
    if (/^\d$/.test(key)) digit(key);
    else if (key === '.') decimal();
    else if (OPERATORS.has(key)) operation(key);
    else if (key === '=') equals();
    else if (key === 'AC') clear();
    else if (key === 'BACKSPACE') backspace();
    else if (key === 'SIGN') sign();
    else if (key === 'PERCENT') percent();
    return snapshot();
  }
  clear();
  return { input, snapshot, reset };
}
