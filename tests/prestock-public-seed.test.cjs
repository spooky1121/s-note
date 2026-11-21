'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function sourceFunction(name) {
  const source = html.match(new RegExp(`^function ${name}\\([^\\n]*\\n[\\s\\S]*?^}\\s*$`, 'm'));
  assert.ok(source, `expected source function ${name}`);
  return source[0];
}

function openSyntheticLedger(initial = {}) {
  const store = new Map(Object.entries(initial));
  const sandbox = vm.createContext({
    PRESTOCK_V148_KEY: 'saved', PRESTOCK_STORAGE_KEY: 'legacy',
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: () => assert.fail('Ledger reads must not mutate storage')
    },
    console: {warn() {}},
    snote203PrestockConfig: () => ({total: 1000})
  });
  vm.runInContext([
    'prestockLegacyRows', 'prestockDefaults', 'prestockAllRows', 'prestockSums',
    'normalizePrestockPlate', 'prestockOutstandingIndex', 'prestockForCar',
    'isValidPrestockDate'
  ].map(sourceFunction).join('\n'), sandbox);
  return {
    read: () => JSON.parse(JSON.stringify(sandbox.prestockAllRows())),
    sums: () => sandbox.prestockSums(),
    vehicle: plate => sandbox.prestockForCar({plate})
  };
}

const syntheticPlate = '00가0000';
const row = (id, params = {}) => ({
  id, model: '합성 테스트', date: '2026-01-01', plate: syntheticPlate,
  amount: 200, repaid: false, ...params
});

test('public bundle has no embedded prestock example definitions', () => {
  assert.equal(/PRESTOCK_LEDGER_SAMPLE|PRESTOCK_BANK_(?:TOTAL|LABEL)/.test(html), false);
});

test('fresh or malformed browser state gets no examples', () => {
  for (const initial of [{}, {saved: '{broken'}, {saved: '{}' }]) {
    const ledger = openSyntheticLedger(initial);
    assert.deepEqual(ledger.read(), []);
    assert.equal(ledger.sums().total, 0);
    assert.equal(ledger.vehicle(syntheticPlate), 0);
  }
});

test('older user entries remain the fallback and explicit empty storage stays empty', () => {
  const entry = row('ps-older', {meta: {preserve: true}});
  const legacy = JSON.stringify([entry]);
  assert.deepEqual(openSyntheticLedger({legacy}).read(), [entry]);
  assert.deepEqual(openSyntheticLedger({legacy, saved: '[]'}).read(), []);
});

test('returning browser preserves the existing ledger, repayment and adjustments', () => {
  const rows = [
    row('ps-advance', {meta: {preserve: true}}),
    row('ps-repaid', {amount: 700, repaid: true}),
    row('ps-adjustment', {amount: -25, type: 'adjustment'}),
    row('sample-0', {amount: 300, sample: true})
  ];
  const ledger = openSyntheticLedger({saved: JSON.stringify(rows)});
  assert.deepEqual(ledger.read(), rows);
  assert.equal(ledger.sums().total, 475);
  assert.equal(ledger.sums().repaid, 1);
  assert.equal(ledger.vehicle(syntheticPlate), 475);
});
