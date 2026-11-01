import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalculator } from '../assets/quick-calculator-model.js';

function press(calculator, ...keys) { for (const key of keys) calculator.input(key); return calculator.snapshot(); }
function digits(calculator, value) { return press(calculator, ...String(value)); }
function binary(left, operator, right) {
  const calculator = createCalculator(); digits(calculator, left); calculator.input(operator); digits(calculator, right); return calculator.input('=');
}

test('initial state and reset are plain independent JSON snapshots', () => {
  const calculator = createCalculator();
  const initial = { display: '0', expression: '', error: null, errorCode: null, hasValue: false, preview: null };
  assert.deepEqual(calculator.snapshot(), initial);
  const snapshot = calculator.input('7'); snapshot.display = 'changed';
  assert.equal(calculator.snapshot().display, '7');
  assert.deepEqual(calculator.reset(), initial);
  assert.deepEqual(JSON.parse(JSON.stringify(calculator.snapshot())), initial);
});

test('four arithmetic operations and negative results', () => {
  for (const [left, operator, right, expected] of [[12, '+', 7, '19'], [12, '-', 17, '-5'], [12, '*', 7, '84'], [12, '/', 4, '3']]) {
    const result = binary(left, operator, right); assert.equal(result.display, expected); assert.equal(result.error, null);
  }
});

test('decimal arithmetic hides binary floating-point display noise while keeping 15 significant digits', () => {
  assert.equal(binary('0.1', '+', '0.2').display, '0.3');
  assert.equal(binary('0.3', '-', '0.2').display, '0.1');
  assert.equal(binary('1.23456789012345', '+', '1').display, '2.23456789012345');
  assert.equal(binary('99999999999999', '+', '1').display, '100000000000000');
  const calculator = createCalculator();
  press(calculator, '0', '.', '1', '+', '0', '.', '2', '-', '0', '.', '3', '=');
  assert.equal(calculator.snapshot().display, '0');
});

test('decimal point, leading zero and input size are bounded without corrupting entry', () => {
  const calculator = createCalculator();
  assert.equal(press(calculator, '0', '0', '9', '.', '.', '2').display, '9.2');
  calculator.reset(); digits(calculator, '9999999999999999');
  assert.equal(calculator.snapshot().display, '999999999999999');
  assert.equal(calculator.snapshot().error, null);
  calculator.reset(); digits(calculator, '0.' + '0'.repeat(100));
  assert.ok(calculator.snapshot().display.length <= 24);
  assert.equal(calculator.snapshot().display.includes('NaN'), false);
});

test('operator replacement and chained operations calculate immediately from left to right', () => {
  const calculator = createCalculator();
  assert.equal(press(calculator, '7', '+', '*', '2', '=').display, '14');
  calculator.reset();
  assert.equal(press(calculator, '2', '+', '3', '*', '4', '=').display, '20');
  calculator.reset();
  assert.equal(press(calculator, '9', '/', '3', '-', '1', '=').display, '2');
});

test('preview is side-effect free and exists only for a complete pending calculation', () => {
  const calculator = createCalculator();
  assert.equal(press(calculator, '2', '+').preview, null);
  const preview = calculator.input('3');
  assert.equal(preview.display, '3'); assert.equal(preview.preview, '5'); assert.equal(preview.expression, '2 + 3');
  assert.deepEqual(calculator.snapshot(), preview); assert.equal(calculator.input('=').display, '5');
  calculator.reset();
  const division = press(calculator, '1', '/', '0');
  assert.equal(division.preview, null); assert.equal(division.error, null);
});

test('repeat equals reuses the last operator and operand', () => {
  const calculator = createCalculator();
  assert.equal(press(calculator, '5', '+', '2', '=').display, '7');
  assert.equal(calculator.input('=').display, '9');
  assert.equal(calculator.input('=').display, '11');
  assert.equal(press(calculator, '*', '3', '=').display, '33');
  assert.equal(calculator.input('=').display, '99');
  calculator.reset();
  assert.equal(press(calculator, '8', '+', '=').display, '16');
  assert.equal(calculator.input('=').display, '24');
});

test('new digits or decimal after equals start a fresh calculation', () => {
  const calculator = createCalculator();
  press(calculator, '5', '+', '2', '=');
  assert.equal(calculator.input('3').display, '3');
  assert.equal(calculator.input('=').display, '3');
  calculator.input('.');
  assert.equal(calculator.snapshot().display, '0.');
  assert.equal(press(calculator, '5', '+', '1', '=').display, '1.5');
});

test('sign supports negative first/right operands and never displays negative zero', () => {
  const calculator = createCalculator();
  assert.equal(calculator.input('SIGN').display, '0');
  assert.equal(calculator.input('5').display, '-5');
  assert.equal(calculator.input('SIGN').display, '5');
  assert.equal(press(calculator, '+', 'SIGN', '2', '=').display, '3');
  calculator.reset();
  assert.equal(press(calculator, '0', 'SIGN', '*', '2', '=').display, '0');
  assert.equal(calculator.snapshot().display.startsWith('-0'), false);
});

test('percent uses the base for addition/subtraction and a fraction for multiplication/division', () => {
  for (const [operator, expected] of [['+', '220'], ['-', '180'], ['*', '20'], ['/', '2000']]) {
    const calculator = createCalculator(); digits(calculator, '200'); calculator.input(operator); digits(calculator, '10');
    assert.equal(press(calculator, 'PERCENT', '=').display, expected);
  }
  const calculator = createCalculator(); digits(calculator, '50');
  assert.equal(calculator.input('PERCENT').display, '0.5');
  calculator.reset(); digits(calculator, '200'); calculator.input('+'); digits(calculator, '10');
  assert.equal(press(calculator, 'SIGN', 'PERCENT', '=').display, '180');
});

test('backspace handles current entry, a pending operator, a completed result and empty entry', () => {
  const calculator = createCalculator(); digits(calculator, '12.3');
  assert.equal(calculator.input('BACKSPACE').display, '12.');
  assert.equal(calculator.input('BACKSPACE').display, '12');
  assert.equal(press(calculator, '+', 'BACKSPACE').expression, '');
  assert.equal(calculator.snapshot().display, '12');
  assert.equal(press(calculator, '+', '3', '=', 'BACKSPACE').display, '1');
  assert.equal(press(calculator, 'BACKSPACE', 'BACKSPACE').display, '0');
  assert.equal(calculator.input('=').display, '0');
});

test('division by zero is explicit and digit/decimal/backspace input recovers immediately', () => {
  const calculator = createCalculator();
  const failed = press(calculator, '1', '/', '0', '=');
  assert.equal(failed.display, '오류'); assert.equal(failed.errorCode, 'DIVIDE_BY_ZERO'); assert.ok(failed.error);
  assert.equal(press(calculator, '+', '=').errorCode, 'DIVIDE_BY_ZERO');
  assert.equal(calculator.input('7').display, '7'); assert.equal(calculator.snapshot().error, null);
  press(calculator, '/', '0', '='); assert.equal(calculator.input('.').display, '0.');
  press(calculator, '/', '0', '='); assert.equal(calculator.input('BACKSPACE').display, '0');
  assert.equal(calculator.snapshot().error, null);
});

test('large finite values use scientific notation and overflow never exposes Infinity or NaN', () => {
  const calculator = createCalculator(); digits(calculator, '100000000000000'); calculator.input('*'); digits(calculator, '100000000000000');
  assert.match(calculator.input('=').display, /e\+/);
  for (let i = 0; i < 30 && !calculator.snapshot().error; i++) calculator.input('=');
  const failed = calculator.snapshot(); assert.equal(failed.errorCode, 'OUT_OF_RANGE');
  assert.equal(JSON.stringify(failed).includes('Infinity'), false); assert.equal(JSON.stringify(failed).includes('NaN'), false);
  assert.equal(calculator.input('2').display, '2'); assert.equal(calculator.snapshot().error, null);
});

test('AC clears errors, percent, repeat equals and pending operators', () => {
  const calculator = createCalculator(); press(calculator, '8', '+', '2', '=', 'PERCENT', '*');
  assert.deepEqual(calculator.input('AC'), createCalculator().snapshot());
  assert.deepEqual(calculator.input('='), createCalculator().snapshot());
});

test('unknown keys and objects are inert and cannot execute expressions', () => {
  const calculator = createCalculator(); calculator.input('3'); const before = calculator.snapshot();
  for (const value of ['alert(1)', '1+2', '(', ')', 'e', 'Infinity', undefined, 5, { toString() { throw new Error('must not evaluate'); } }]) {
    assert.deepEqual(calculator.input(value), before);
  }
});
