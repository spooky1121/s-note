import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyStore } from '../assets/monthly-workbook-cloud.js';
import { TYPE, createBook, fingerprint } from '../assets/monthly-workbook-model.js';

const clone = value => structuredClone(value);
function book(month = '2026-11', amount = 100) {
  const value = createBook(month); value.dealers[0].name = '테스트 담당'; value.dealers[0].buyFee = amount; return value;
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function cas() { return Object.assign(new Error('revision conflict'), { code: 'RPC_CONFLICT' }); }
function fixture(payload = [], revision = 0) {
  const state = { payload: clone(payload), revision, key: 'company-a:user-a:frame-a', reads: 0, writes: [], commits: [], readHook: null, writeHook: null, commitHook: null };
  const commit = (next, expected) => {
    if (expected !== state.revision) throw cas();
    state.payload = clone(next); return ++state.revision;
  };
  const adapter = {
    currentKey: () => state.key,
    async read() { state.reads++; if (state.readHook) return state.readHook(); return { payload: clone(state.payload), revision: state.revision }; },
    async write(next, expected) { state.writes.push({ payload: clone(next), expected }); if (state.writeHook) return state.writeHook(next, expected, commit); return commit(next, expected); },
    async onCommitted(next, rev) { if (state.commitHook) await state.commitHook(next, rev); state.commits.push({ payload: clone(next), revision: rev }); }
  };
  return { state, store: createMonthlyStore(adapter), adapter };
}
function request(value, baseVersion = null, requestId = 'test-write-1') { return { month: value.month, book: value, baseVersion, requestId }; }
function month(payload, selected) { return payload.find(value => value?.type === TYPE && value.month === selected); }

test('load fingerprints raw books and leaves legacy/unknown financial records untouched', async () => {
  const existing = { ...book(), updatedAt: '2026-11-01T00:00:00Z', writeId: 'previous' };
  const legacy = { id: 'legacy', kind: 'out', amount: 3500, account: '1234567890123', extra: { rrnLikeField: 'keep-exactly', values: [null, false, 0] } };
  const unknown = { type: 'future-other-format', untouched: true };
  const payload = [legacy, existing, unknown]; const original = JSON.stringify(payload);
  const { state, store } = fixture(payload, 7);
  const loaded = await store.load();
  assert.equal(loaded.revision, 7); assert.equal(loaded.versions['2026-11'], await fingerprint(existing));
  assert.equal(JSON.stringify(loaded.payload), original); assert.equal(JSON.stringify(state.payload), original);
  assert.equal(state.writes.length, 0); assert.equal(state.commits.length, 0);
});

test('save merges only the selected month and acknowledges the exact committed metadata and revision', async () => {
  const previous = book('2026-10', 250); const legacy = { id: 'old', kind: 'in', amount: 200, value: '1234567890123' }; const unknown = { opaque: { keep: [1, 'value', null] } };
  const { state, store } = fixture([legacy, previous, unknown], 3);
  const input = book(); input.shouldNotPersist = 'unknown new book field';
  const result = await store.save(request(input));
  assert.equal(result.state, 'saved'); assert.equal(result.revision, 4);
  assert.equal(result.book.writeId, 'test-write-1'); assert.ok(Number.isFinite(Date.parse(result.book.updatedAt)));
  assert.equal(Object.hasOwn(result.book, 'shouldNotPersist'), false);
  assert.equal(result.baseVersion, await fingerprint(month(state.payload, '2026-11')));
  assert.deepEqual(state.payload.filter(row => row.month !== '2026-11'), [legacy, previous, unknown]);
  assert.deepEqual(state.commits, [{ payload: state.payload, revision: 4 }]); assert.equal(state.writes[0].expected, 3);
});

test('same-month changes reject with the current remote baseline without touching the caller draft', async () => {
  const original = book(); const { state, store } = fixture([original], 1);
  const baseline = (await store.load()).versions['2026-11'];
  const draft = book('2026-11', 999); const snapshot = clone(draft);
  state.payload = [book('2026-11', 777)]; state.revision = 2;
  await assert.rejects(store.save(request(draft, baseline)), error => {
    assert.equal(error.code, 'CONFLICT'); assert.deepEqual(error.remoteBook, state.payload[0]);
    // The async fingerprint is checked below; this callback remains synchronous.
    return true;
  });
  assert.deepEqual(draft, snapshot); assert.equal(state.writes.length, 0); assert.equal(state.commits.length, 0);
  try { await store.save(request(draft, baseline)); } catch (error) { assert.equal(error.baseVersion, await fingerprint(state.payload[0])); }
});

test('CAS conflict on another month retries against fresh server data and preserves intervening legacy changes', async () => {
  const target = book(); const oldOther = book('2026-10', 50); const legacy = { kind: 'in', id: 'old', amount: 9 };
  const { state, store } = fixture([target, oldOther, legacy], 4);
  const baseline = await fingerprint(target);
  state.writeHook = (next, expected, commit) => {
    if (state.writes.length === 1) { state.payload = [target, book('2026-10', 888), legacy, { unknown: 'new remote value' }]; state.revision++; throw cas(); }
    return commit(next, expected);
  };
  const result = await store.save(request(book('2026-11', 555), baseline));
  assert.equal(result.state, 'saved'); assert.equal(state.writes.length, 2); assert.equal(state.reads, 2);
  assert.equal(month(state.payload, '2026-10').dealers[0].buyFee, 888); assert.deepEqual(state.payload.at(-1), { unknown: 'new remote value' });
  assert.equal(month(state.payload, '2026-11').dealers[0].buyFee, 555);
});

test('same-month CAS conflict never retries the stale month, and repeated cross-month CAS races are bounded', async () => {
  const target = book(); const first = fixture([target], 1);
  first.state.writeHook = () => { first.state.payload = [book('2026-11', 456)]; first.state.revision++; throw cas(); };
  await assert.rejects(first.store.save(request(book('2026-11', 999), await fingerprint(target))), error => error.code === 'CONFLICT');
  assert.equal(first.state.writes.length, 1); assert.equal(first.state.commits.length, 0);
  const second = fixture([target], 1);
  second.state.writeHook = () => { second.state.payload.push({ remoteLegacy: second.state.revision }); second.state.revision++; throw cas(); };
  await assert.rejects(second.store.save(request(book('2026-11', 999), await fingerprint(target))), error => error.code === 'CONFLICT');
  assert.equal(second.state.writes.length, 3); assert.equal(second.state.commits.length, 0);
});

test('lost write acknowledgement is recovered only by matching requestId and normalized business fields', async () => {
  const { state, store } = fixture();
  state.writeHook = (next, expected, commit) => { commit(next, expected); throw new Error('response lost'); };
  const draft = book();
  const saved = await store.save(request(draft));
  assert.equal(saved.state, 'saved'); assert.equal(state.reads, 2); assert.equal(state.writes.length, 1); assert.equal(state.commits.length, 1);
  const repeated = await store.save(request(draft));
  assert.deepEqual(repeated, saved); assert.equal(state.writes.length, 1);
  const changed = book('2026-11', 222);
  await assert.rejects(store.save(request(changed, saved.baseVersion)), error => error.code === 'CONFLICT');
  assert.equal(state.writes.length, 1);
});

test('network failure without a commit never produces saved, and retry keeps the same request identity', async () => {
  const { state, store } = fixture(); const draft = book();
  state.writeHook = () => { throw new Error('private transport detail'); };
  await assert.rejects(store.save(request(draft)), error => error.code === 'NETWORK' && !error.message.includes('private transport detail'));
  assert.equal(state.commits.length, 0); assert.deepEqual(state.payload, []);
  state.writeHook = null;
  const retried = await store.save(request(draft)); assert.equal(retried.state, 'saved'); assert.equal(state.writes.length, 2);
});

test('requestId collision with different persisted fields is a conflict rather than a false lost-ACK success', async () => {
  const { state, store } = fixture();
  state.writeHook = (next, expected, commit) => {
    commit(next, expected); state.payload[0].dealers[0].buyFee = 456; throw new Error('response lost');
  };
  await assert.rejects(store.save(request(book())), error => error.code === 'CONFLICT');
  assert.equal(state.commits.length, 0); assert.equal(state.payload[0].dealers[0].buyFee, 456);
});

test('unavailable readback stays uncertain until a later same-request retry can prove the commit', async () => {
  const { state, store } = fixture();
  state.writeHook = (next, expected, commit) => { commit(next, expected); state.readHook = () => { throw new Error('offline'); }; throw new Error('response lost'); };
  const draft = book();
  await assert.rejects(store.save(request(draft)), error => error.code === 'NETWORK');
  assert.equal(state.commits.length, 0); assert.equal(state.writes.length, 1);
  state.readHook = null;
  const result = await store.save(request(draft)); assert.equal(result.state, 'saved'); assert.equal(state.writes.length, 1);
});

test('context changes before/after remote awaits prevent writes and late committed callbacks', async () => {
  const first = fixture(); const readGate = deferred();
  first.state.readHook = () => readGate.promise;
  const pendingLoad = first.store.load(); first.state.key = 'company-b:user-b:frame-b'; readGate.resolve({ payload: [], revision: 0 });
  await assert.rejects(pendingLoad, error => error.code === 'CONTEXT_CHANGED');
  assert.equal(first.state.writes.length, 0); assert.equal(first.state.commits.length, 0);

  const second = fixture(); const writeGate = deferred(); const started = deferred();
  second.state.writeHook = async (next, expected, commit) => { const rev = commit(next, expected); started.resolve(); await writeGate.promise; return rev; };
  const pendingSave = second.store.save(request(book())); await started.promise;
  second.state.key = 'company-b:user-b:frame-b'; writeGate.resolve();
  await assert.rejects(pendingSave, error => error.code === 'CONTEXT_CHANGED');
  assert.equal(second.state.commits.length, 0);
});

test('queued requests capture their original context and snapshots instead of borrowing a later company or mutation', async () => {
  const { state, store } = fixture(); const gate = deferred(); const started = deferred();
  state.readHook = () => { started.resolve(); return gate.promise; };
  const first = store.save(request(book())); const second = store.save(request(book('2026-12'), null, 'test-write-2'));
  await started.promise; state.key = 'company-b:user-b:frame-b'; gate.resolve({ payload: [], revision: 0 });
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'CONTEXT_CHANGED'));
  assert.equal(state.reads, 1); assert.equal(state.writes.length, 0);

  const isolated = fixture(); const readGate = deferred(); const readStarted = deferred();
  isolated.state.readHook = () => { readStarted.resolve(); return readGate.promise; };
  const draft = book(); const saved = isolated.store.save(request(draft)); await readStarted.promise;
  draft.dealers[0].buyFee = 999; readGate.resolve({ payload: [], revision: 0 });
  assert.equal((await saved).book.dealers[0].buyFee, 100);
});

test('save serialization prevents overlapping writes and merges independently edited months', async () => {
  const { state, store } = fixture(); const gate = deferred(); const started = deferred(); let active = 0, maximum = 0;
  state.writeHook = async (next, expected, commit) => {
    active++; maximum = Math.max(maximum, active);
    if (state.writes.length === 1) { started.resolve(); await gate.promise; }
    try { return commit(next, expected); } finally { active--; }
  };
  const first = store.save(request(book())); const second = store.save(request(book('2026-12', 200), null, 'test-write-2'));
  await started.promise; assert.equal(state.writes.length, 1); gate.resolve();
  await Promise.all([first, second]);
  assert.equal(maximum, 1); assert.equal(state.writes.length, 2); assert.equal(state.payload.length, 2);
  assert.equal(month(state.payload, '2026-11').dealers[0].buyFee, 100); assert.equal(month(state.payload, '2026-12').dealers[0].buyFee, 200);
});

test('invalid datasets, duplicate month records and invalid input fail closed without altering financial data', async () => {
  for (const payload of [null, {}, [book(), book()]]) {
    const { state, store } = fixture(); state.payload = clone(payload);
    await assert.rejects(store.load(), error => error.code === 'INVALID_DATA');
    await assert.rejects(store.save(request(book())), error => error.code === 'INVALID_DATA');
    assert.equal(state.writes.length, 0);
  }
  const { state, store } = fixture();
  for (const invalid of [request(book(), 'not-a-fingerprint'), { ...request(book()), month: '2026-12' }, { ...request(book()), requestId: '' }, request({ ...book(), month: 'invalid-month' })]) {
    await assert.rejects(store.save(invalid), error => error.code === 'INVALID_DATA');
  }
  assert.equal(state.reads, 0); assert.equal(state.writes.length, 0);
});

test('a malformed write acknowledgement is not trusted, and failed cache callbacks can recover idempotently', async () => {
  const first = fixture(); first.state.writeHook = () => null;
  await assert.rejects(first.store.save(request(book())), error => error.code === 'NETWORK');
  assert.equal(first.state.commits.length, 0);
  const second = fixture(); second.state.commitHook = () => { throw new Error('private cache failure'); };
  await assert.rejects(second.store.save(request(book())), error => error.code === 'NETWORK');
  assert.equal(second.state.writes.length, 1); assert.equal(second.state.commits.length, 0);
  second.state.commitHook = null;
  assert.equal((await second.store.save(request(book()))).state, 'saved'); assert.equal(second.state.writes.length, 1);
});
