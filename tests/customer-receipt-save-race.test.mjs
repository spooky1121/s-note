import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Execute the actual persistence function with synthetic, in-memory boundaries.
// No database, customer identity API, SMS, HTTP or browser storage is contacted.
const source = readFileSync(process.env.SNOTE_RECEIPT_RACE_SOURCE || fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const start = source.indexOf('async function snote214SaveCustomer(');
const end = source.indexOf('\nfunction snote214CustomerMarker(', start);
assert(start >= 0 && end > start, 'The production customer persistence function must be present');
const implementation = source.slice(start, end);
const ORIGINAL_KEYS = ['customerSignature', 'customerSignatureSignedAt', 'intakeSource', 'receiptDetails'];
const copy = value => value == null ? value : structuredClone(value);
const receipt = (children, checked) => ({ children, business: checked ? 'invoice' : null, privacyConsent: checked,
  insuranceConfirmed: checked, delegationConfirmed: checked, cashConfirmed: checked, consentVersion: 'receipt-v1' });
function person(letter, receiptDetails = receipt(letter === 'A' ? 'two' : 'three', letter !== 'A')) {
  const n = letter.charCodeAt(0) - 64;
  return { name: 'Synthetic customer ' + letter, phone: '0101234567' + n, ownerId: 'synthetic-owner', carId: 'synthetic-car',
    customerSignature: { version: 1, strokes: [[[n / 10, .1], [.9, .9]]] }, customerSignatureSignedAt: '2026-11-20T00:00:0' + n + '.000Z',
    intakeSource: { requestId: 'synthetic-request-' + letter, submittedAt: '2026-11-20T00:00:0' + n + '.000Z' }, receiptDetails };
}
function bundle(value) { return Object.fromEntries(ORIGINAL_KEYS.map(key => [key, copy(value[key])])); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness({ latest = person('A'), selected = null, readGate, sessionGate } = {}) {
  let live = copy(selected), stale = false;
  const writes = [], readsStarted = deferred(), sessionStarted = deferred();
  const ctx = { uid: 'synthetic-uuid', companyId: 'synthetic-company' };
  const context = {
    window: { snoteIntakeSignatureForSave(incoming) {
      return live && incoming?.name === live.name && incoming?.phone === live.phone ? bundle(live) : null;
    } },
    snote214ReadCustomerRow: async () => {
      readsStarted.resolve(); if (readGate) await readGate.promise;
      return latest ? { payload: copy(latest), restore_generation: 'synthetic-generation', updated_at: '2026-11-19T00:00:00.000Z', has_rrn: true } : null;
    },
    snote214CheckCustomerContext() { if (stale) throw Error('Synthetic actor changed'); },
    snote214EncryptIdentity: async () => 'synthetic-new-identity-cipher',
    SNOTE_RECYCLE_ZERO: 'synthetic-generation', cleanCustomer: copy,
    snoteRecycleContext: () => ({ userId: ctx.uid, companyId: ctx.companyId }),
    snoteRecyclePinnedSession: async value => { sessionStarted.resolve(); if (sessionGate) await sessionGate.promise; return value; },
    snoteRecyclePinnedPost: async (_session, rpc, args) => {
      assert.equal(rpc, 'snote_customer_save'); writes.push(copy(args));
      return { data: { ok: true, updatedAt: '2026-11-20T01:00:00.000Z', restoreGeneration: 'synthetic-generation' } };
    },
    snoteRecycleCheck() {}, showStatus() {},
    snoteRecycleError: (_code, message) => Error(message), snoteRecycleMapError: error => Error(error.message)
  };
  vm.createContext(context); vm.runInContext(implementation, context);
  return {
    writes, readsStarted: readsStarted.promise, sessionStarted: sessionStarted.promise,
    select: value => { live = copy(value); }, stale: () => { stale = true; },
    save: (incoming, { identityOnly = false, pending = '', requireExisting = true } = {}) => context.snote214SaveCustomer(ctx, 'synthetic-car', copy(incoming), pending, identityOnly, requireExisting),
    payload: () => JSON.parse(JSON.stringify(writes.at(-1)?.p_payload))
  };
}
const selectionChanged = error => /선택한 고객 접수 정보가 변경되었습니다/.test(error.message);

test('a live selected submission saves its signature, source and receipt as one bundle', async () => {
  const a = person('A'), b = person('B'), h = harness({ latest: a, selected: b });
  await h.save(b);
  assert.equal(h.writes.length, 1); assert.deepEqual(bundle(h.payload()), bundle(b));
});

for (const action of ['close', 'reset']) test(action + ' during the pending row read cannot save B receipt beside A signature', async () => {
  const readGate = deferred(), h = harness({ selected: person('B'), readGate });
  const saving = h.save(person('B'));
  await h.readsStarted; h.select(null); readGate.resolve();
  await assert.rejects(saving, selectionChanged); assert.equal(h.writes.length, 0);
});

test('switching to another same-name submission cannot authorize an older queued bundle', async () => {
  const readGate = deferred(), b = person('B'), c = { ...person('C'), name: b.name, phone: b.phone };
  const h = harness({ selected: b, readGate }), saving = h.save(b);
  await h.readsStarted; h.select(c); readGate.resolve();
  await assert.rejects(saving, selectionChanged); assert.equal(h.writes.length, 0);
});

test('closing after original proof validation but during session pinning prevents the save RPC', async () => {
  const sessionGate = deferred(), h = harness({ selected: person('B'), sessionGate }), saving = h.save(person('B'));
  await h.sessionStarted; h.select(null); sessionGate.resolve();
  await assert.rejects(saving, selectionChanged); assert.equal(h.writes.length, 0);
});

test('ordinary manually renamed customer clears receipt without replacing its saved original signature', async () => {
  const a = person('A'), incoming = { ...a, name: 'Manually changed customer', receiptDetails: null }, h = harness({ latest: a });
  await h.save(incoming);
  assert.equal(h.payload().name, incoming.name); assert.equal(h.payload().receiptDetails, null);
  for (const key of ORIGINAL_KEYS.slice(0, 3)) assert.deepEqual(h.payload()[key], a[key]);
});

test('identity-only save ignores selection and preserves the exact current original and receipt', async () => {
  const a = { ...person('A'), identityCipher: 'synthetic-old-identity-cipher' }, h = harness({ latest: a, selected: person('B') });
  await h.save(null, { identityOnly: true, pending: '9001011234567' });
  assert.deepEqual(bundle(h.payload()), bundle(a)); assert.equal(h.payload().identityCipher, 'synthetic-new-identity-cipher');
});

test('an explicitly selected legacy submission atomically clears a prior receipt', async () => {
  const b = person('B', null), h = harness({ selected: b });
  await h.save(b);
  assert.deepEqual(bundle(h.payload()), bundle(b)); assert.equal(h.payload().receiptDetails, null);
});

test('a closed legacy selection cannot replace source or clear another customer receipt', async () => {
  const h = harness(); await assert.rejects(h.save(person('B', null)), selectionChanged); assert.equal(h.writes.length, 0);
});

test('ordinary saves with omitted receipt preserve it and tolerate JSONB object-key ordering', async () => {
  const a = person('A'), incoming = { ...a, customerSignature: { strokes: a.customerSignature.strokes, version: 1 },
    intakeSource: { submittedAt: a.intakeSource.submittedAt, requestId: a.intakeSource.requestId } };
  delete incoming.receiptDetails;
  const h = harness({ latest: a }); await h.save(incoming);
  assert.deepEqual(bundle(h.payload()), bundle(a));
});

test('legacy partial ordinary writes without original or receipt fields preserve the latest bundle', async () => {
  const a = person('A'), h = harness({ latest: a });
  await h.save({ ownerId: a.ownerId, carId: a.carId, name: a.name, phone: a.phone, address: 'Synthetic edited address' });
  assert.deepEqual(bundle(h.payload()), bundle(a)); assert.equal(h.payload().address, 'Synthetic edited address');
});

test('a new unsigned customer with no original or receipt fields can still be saved', async () => {
  const h = harness({ latest: null });
  await h.save({ ownerId: 'synthetic-owner', carId: 'synthetic-car', name: 'New unsigned customer', phone: '01055556666' }, { requireExisting: false });
  assert.equal(h.writes.length, 1); assert.equal(h.payload().name, 'New unsigned customer');
  for (const key of ORIGINAL_KEYS) assert.equal(Object.hasOwn(h.payload(), key), false);
});

test('a receipt change without a selected signed source cannot use the saved signature as proof', async () => {
  const a = person('A'), h = harness({ latest: a });
  await assert.rejects(h.save({ ...a, receiptDetails: receipt('three', true) }), selectionChanged); assert.equal(h.writes.length, 0);
});

test('actor change during session pinning still fails before any save RPC', async () => {
  const sessionGate = deferred(), h = harness({ selected: person('B'), sessionGate }), saving = h.save(person('B'));
  await h.sessionStarted; h.stale(); sessionGate.resolve();
  await assert.rejects(saving, /Synthetic actor changed/); assert.equal(h.writes.length, 0);
});
