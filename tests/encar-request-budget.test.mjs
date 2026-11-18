import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncarRequestBudget, EncarRequestBudgetError, DEFAULT_REQUEST_BUDGET, REQUEST_BUDGET_STAGES } from '../functions/_shared/encar-request-budget.mjs';

const typed = (fn, code) => assert.throws(fn, error => error instanceof EncarRequestBudgetError && error.code === code && error.message === code);
const create = options => createEncarRequestBudget({ deadline: 35000, now: () => 0, ...options });

test('44 total actual attempts include Auth and membership and stop before the 45th fetch', async () => {
  const budget = create(), called = [];
  const fetchStage = async stage => { budget.consume(stage); called.push(stage); throw Error('synthetic transport failure'); };
  for (const stage of ['auth', 'member', ...Array.from({ length: 42 }, () => 'detail')]) await assert.rejects(fetchStage(stage), /synthetic transport failure/);
  assert.equal(called.length, 44); assert.equal(budget.remaining(), 0);
  await assert.rejects(fetchStage('search'), error => error.code === 'REQUEST_BUDGET_EXCEEDED');
  assert.equal(called.length, 44, 'a rejected reservation cannot start an actual fetch');
  assert.deepEqual(budget.diagnostics(), { requestCount: 44, reusedCount: 0, budgetLimit: 44, remaining: 0 });
});

test('derived canonical and dummy detail calls consume capacity as ordinary fetches', () => {
  const budget = create(); budget.consume('auth'); budget.consume('member');
  let completed = 0;
  for (let candidate = 0; candidate < 14; candidate++) {
    for (const derived of ['source', 'canonical', 'dummy']) { budget.consume('detail'); completed++; }
  }
  assert.equal(completed, 42); assert.equal(budget.remaining(), 0);
  typed(() => budget.consume('detail'), 'REQUEST_BUDGET_EXCEEDED');
});

test('reuse never consumes or replenishes capacity and is still allowed after count exhaustion', () => {
  const budget = create({ limit: 2 });
  budget.consume('auth'); assert.equal(budget.reuse('detail'), 1);
  budget.consume('member'); assert.equal(budget.reuse('catalog'), 2);
  assert.deepEqual(budget.diagnostics(), { requestCount: 2, reusedCount: 2, budgetLimit: 2, remaining: 0 });
  typed(() => budget.consume('detail'), 'REQUEST_BUDGET_EXCEEDED');
});

test('the existing hard deadline stops new requests and memo use at the exact deadline', () => {
  let time = 999;
  const budget = create({ deadline: 1000, now: () => time });
  budget.consume('auth'); time = 1000;
  typed(() => budget.consume('member'), 'DEADLINE_EXCEEDED');
  typed(() => budget.reuse('detail'), 'DEADLINE_EXCEEDED');
  assert.deepEqual(budget.diagnostics(), { requestCount: 1, reusedCount: 0, budgetLimit: 44, remaining: 43 });
  assert.equal(budget.remaining(), 43, 'safe diagnostics remain readable after the deadline');
});

test('all documented stages are accepted and unknown stages fail without coercion or leaking input', () => {
  const budget = create();
  for (const stage of REQUEST_BUDGET_STAGES) budget.consume(stage);
  let coerced = false;
  for (const stage of ['', 'AUTH', 'token:PRIVATE', undefined, null, [], { toString() { coerced = true; return 'auth'; } }]) {
    typed(() => budget.consume(stage), 'INVALID_REQUEST_BUDGET_STAGE');
    typed(() => budget.reuse(stage), 'INVALID_REQUEST_BUDGET_STAGE');
  }
  assert.equal(coerced, false);
  assert.equal(budget.diagnostics().requestCount, REQUEST_BUDGET_STAGES.length);
});

test('invalid configuration cannot raise the hard cap, create an unbounded clock, or coerce values', () => {
  for (const limit of [0, -1, 45, 10000, 1.5, NaN, Infinity, '44', null]) typed(() => create({ limit }), 'INVALID_REQUEST_BUDGET_CONFIG');
  for (const deadline of [undefined, -1, 0.5, NaN, Infinity, '35000', null]) typed(() => create({ deadline }), 'INVALID_REQUEST_BUDGET_CONFIG');
  typed(() => create({ now: null }), 'INVALID_REQUEST_BUDGET_CONFIG');
  for (const current of [NaN, Infinity, -1, 0.5, '0']) {
    const budget = create({ now: () => current });
    typed(() => budget.consume('auth'), 'INVALID_REQUEST_BUDGET_CONFIG');
    assert.equal(budget.remaining(), DEFAULT_REQUEST_BUDGET);
  }
});

test('concurrent callers sharing one operation reserve atomically and cannot oversubscribe', async () => {
  const budget = create({ limit: 3 }); let fetched = 0;
  const results = await Promise.allSettled(Array.from({ length: 12 }, async () => {
    budget.consume('detail'); fetched++; await Promise.resolve();
  }));
  assert.equal(fetched, 3); assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'REQUEST_BUDGET_EXCEEDED'));
  assert.equal(budget.remaining(), 0);
});

test('separate operations have independent counters and lifetimes with no cross-request I/O', () => {
  let firstTime = 0;
  const first = create({ limit: 1, now: () => firstTime }), second = create({ limit: 1 });
  first.consume('auth'); firstTime = 35000;
  typed(() => first.reuse('detail'), 'DEADLINE_EXCEEDED');
  assert.equal(second.remaining(), 1); second.consume('auth');
  assert.deepEqual(second.diagnostics(), { requestCount: 1, reusedCount: 0, budgetLimit: 1, remaining: 0 });
});

test('diagnostics contain four bounded integers only and caller mutation cannot affect accounting', () => {
  const budget = create(); budget.consume('auth');
  const diagnostic = budget.diagnostics();
  assert.deepEqual(Object.keys(diagnostic).sort(), ['budgetLimit', 'remaining', 'requestCount', 'reusedCount']);
  assert(Object.values(diagnostic).every(value => Number.isSafeInteger(value) && value >= 0));
  assert(Object.isFrozen(budget)); assert(Object.isFrozen(diagnostic)); assert(Object.isFrozen(REQUEST_BUDGET_STAGES));
  assert.throws(() => { diagnostic.remaining = 999; }, TypeError);
  assert.throws(() => { budget.consume = () => 999; }, TypeError);
  assert.equal(budget.remaining(), 43);
  assert.equal(new EncarRequestBudgetError('PRIVATE token or URL').code, 'INVALID_REQUEST_BUDGET_CONFIG');
});
