import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaxonomyEntry, taxonomyEntryFromCar, taxonomyIdentity, createVehicleTaxonomyStore } from '../assets/vehicle-taxonomy-store.js';

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROW_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const clone = value => structuredClone(value);
const entry = (extra = {}) => ({ make: '현대', group: '그랜저', model: '디 올 뉴 그랜저', grade: '가솔린 2.5', subgrade: '익스클루시브', model_year: '2025', ...extra });
const row = (extra = {}) => ({ id: ROW_ID, ...entry(), verification: 'user_import', source: 'company_vehicle_registration', market: 'KR', ...extra });
function coded(code) { return Object.assign(new Error('Untrusted internal request detail'), { code }); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(rows = []) {
  const state = { key: 'company-a:user-a:session-a', company: COMPANY_A, rows: clone(rows), reads: 0, upserts: [], loaded: [], saved: [], events: [], readHook: null, upsertHook: null, loadedHook: null, savedHook: null };
  const adapter = {
    currentKey: () => state.key, companyId: () => state.company,
    async read() { state.reads++; return state.readHook ? state.readHook() : { company_id: state.company, entries: clone(state.rows) }; },
    async upsert(value) {
      state.upserts.push(clone(value));
      if (state.upsertHook) return state.upsertHook(value);
      const result = row({ ...value }); state.rows.push(clone(result));
      return { company_id: state.company, entry: result, inserted: true };
    },
    async onLoaded(values) { if (state.loadedHook) await state.loadedHook(values); state.loaded.push(clone(values)); state.events.push('loaded'); },
    async onSaved(value) { if (state.savedHook) await state.savedHook(value); state.saved.push(clone(value)); state.events.push('saved'); }
  };
  return { state, adapter, store: createVehicleTaxonomyStore(adapter) };
}

test('normalizes display whitespace, optional defaults and Unicode code-point lengths without mutating input', () => {
  const input = { make: '  ＨＹＵＮＤＡＩ  ', group: ' 그랜저\u00a0  하이브리드 ', model: ' 디  올 뉴 ' };
  const before = clone(input), result = normalizeTaxonomyEntry(input);
  assert.deepEqual(result, { make: 'ＨＹＵＮＤＡＩ', group: '그랜저 하이브리드', model: '디 올 뉴', grade: '', subgrade: '', model_year: '' });
  assert.deepEqual(input, before); assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(normalizeTaxonomyEntry(entry({ make: '🚗'.repeat(45) })).make.length, 90);
});

test('car conversion uses generation and numeric year, ignoring the full display title and unrelated car data', () => {
  const result = taxonomyEntryFromCar({ ...entry(), generation: ' GN7 ', year: 2026, model: '현대 그랜저 GN7 가솔린 2.5 익스클루시브', ownerId: 'private-owner', id: 'car-1', grade: null, subgrade: undefined });
  assert.deepEqual(result, { make: '현대', group: '그랜저', model: 'GN7', grade: '', subgrade: '', model_year: '2026' });
  assert.throws(() => taxonomyEntryFromCar({ ...entry(), generation: '', model: 'Display title is not a generation' }), { code: 'INVALID_DATA' });
});

test('identity uses the SQL five-name NFKC/ASCII-case tuple, ignores year and safely distinguishes delimiter-containing names', () => {
  const first = entry({ make: ' ＨＹＵＮＤＡＩ ', group: ' Grandeur   HEV ', model: ' GN7 ', grade: ' PREMIUM ', subgrade: '', model_year: '2024' });
  const second = entry({ make: 'hyundai', group: 'grandeur hev', model: 'gn7', grade: 'premium', subgrade: '', model_year: '2026' });
  assert.equal(taxonomyIdentity(first), taxonomyIdentity(second));
  assert.deepEqual(JSON.parse(taxonomyIdentity(first)), ['hyundai', 'grandeur hev', 'gn7', 'premium', '']);
  assert.equal(taxonomyIdentity({ ...first, id: ROW_ID, source: 'metadata', model_year: 2026 }), taxonomyIdentity(first));
  assert.notEqual(taxonomyIdentity(entry({ make: 'A|B', group: 'C' })), taxonomyIdentity(entry({ make: 'A', group: 'B|C' })));
  assert.notEqual(taxonomyIdentity(entry({ make: 'Straße' })), taxonomyIdentity(entry({ make: 'STRASSE' })), 'Only ASCII letter case is folded');
});

test('non-ASCII case stays distinct while ES Unicode whitespace and NFKC ASCII spelling match the server identity', async () => {
  const greek = ['ΟΣ', 'ος', 'οσ'].map(make => taxonomyIdentity(entry({ make })));
  assert.equal(new Set(greek).size, 3);
  const dotted = ['İ', 'i\u0307', 'i'].map(make => taxonomyIdentity(entry({ make })));
  assert.equal(new Set(dotted).size, 3);
  assert.equal(taxonomyIdentity(entry({ make: 'I' })), taxonomyIdentity(entry({ make: 'i' })));
  assert.equal(normalizeTaxonomyEntry(entry({ make: ' A\u1680B ' })).make, 'A B');
  assert.equal(taxonomyIdentity(entry({ make: ' A\u1680B ' })), taxonomyIdentity(entry({ make: 'a b' })));
  assert.equal(taxonomyIdentity(entry({ make: '\ufeffＡ\u3000Ｂ\u202fＣ\ufeff' })), taxonomyIdentity(entry({ make: 'a b c' })));
  const { state, store } = fixture([row({ make: 'ΟΣ' }), row({ id: SECOND_ID, make: 'οσ' })]);
  assert.equal((await store.load()).entries.length, 2); assert.equal(state.loaded.length, 1);
});

test('rejects missing names, unknown fields, controls, wrong types, malformed Unicode and invalid years before any RPC', async () => {
  const { state, store } = fixture();
  const invalid = [null, [], {}, { ...entry(), company_id: COMPANY_B }, entry({ make: '' }), entry({ group: ' ' }), entry({ model: 2026 }), entry({ make: 'x'.repeat(46) }), entry({ group: 'x'.repeat(81) }), entry({ model: 'x'.repeat(101) }), entry({ grade: 'x'.repeat(101) }), entry({ subgrade: 'x'.repeat(81) }), entry({ grade: null }), entry({ model_year: null }), entry({ model_year: 2026 }), entry({ model_year: '1969' }), entry({ model_year: String(new Date().getUTCFullYear() + 2) }), entry({ model_year: '20e3' }), entry({ model_year: '２０２６' }), entry({ make: '현대\n차' }), entry({ make: '현대\t차' }), entry({ make: '현대\u0085차' }), entry({ make: '\ud800' })];
  for (const value of invalid) await assert.rejects(store.save(value), { code: 'INVALID_DATA' });
  assert.equal(state.upserts.length, 0); assert.equal(state.saved.length, 0);
  assert.equal(normalizeTaxonomyEntry(entry({ model_year: '1970' })).model_year, '1970');
  assert.equal(normalizeTaxonomyEntry(entry({ model_year: String(new Date().getUTCFullYear() + 1) })).model_year, String(new Date().getUTCFullYear() + 1));
});

test('load returns only validated company-scoped rows and calls the cache with a detached copy', async () => {
  const source = row(); const { state, store } = fixture([source]);
  state.loadedHook = values => { values[0].model = 'cache-private-copy'; };
  const result = await store.load();
  assert.equal(result.company_id, COMPANY_A); assert.deepEqual(result.entries, [source]);
  result.entries[0].grade = 'caller-private-copy'; assert.deepEqual(state.rows, [source]);
  assert.equal(state.loaded[0][0].model, 'cache-private-copy'); assert.equal(state.upserts.length, 0);
});

test('empty server list clears scoped cache only after actual read success', async () => {
  const { state, store } = fixture(); assert.deepEqual(await store.load(), { company_id: COMPANY_A, entries: [] });
  assert.deepEqual(state.loaded, [[]]);
  state.readHook = () => { throw coded('NETWORK'); };
  await assert.rejects(store.load(), { code: 'NETWORK' }); assert.equal(state.loaded.length, 1);
});

test('rejects forged company, invalid IDs, unexpected metadata and duplicate server identities without applying rows', async () => {
  const badReplies = [
    { company_id: COMPANY_B, entries: [row()] }, { company_id: COMPANY_A, entries: [row({ id: 'not-a-uuid' })] },
    { company_id: COMPANY_A, entries: [row({ verification: 'official_verified' })] }, { company_id: COMPANY_A, entries: [row({ source: 'browser-global' })] },
    { company_id: COMPANY_A, entries: [row({ market: 'US' })] }, { company_id: COMPANY_A, entries: [row({ model_year: 2026 })] },
    { company_id: COMPANY_A, entries: [row({ hiddenCompanyId: COMPANY_B })] }, { company_id: COMPANY_A, entries: [row(), row({ id: SECOND_ID, model_year: '2026' })] },
    { company_id: COMPANY_A, entries: [row(), row({ group: 'Other' })] }, { company_id: COMPANY_A, entries: {} }
  ];
  for (const response of badReplies) {
    const { state, store } = fixture(); state.readHook = () => clone(response);
    await assert.rejects(store.load(), { code: 'INVALID_DATA' }); assert.equal(state.loaded.length, 0);
  }
});

test('save acknowledges the server original label/year on a canonical duplicate, without replacing official metadata', async () => {
  const { state, store } = fixture(); const original = row({ make: 'Hyundai', group: 'Grandeur', model: 'GN7', grade: 'Premium', subgrade: '', model_year: '2025' });
  state.upsertHook = () => ({ company_id: COMPANY_A, entry: clone(original), inserted: false });
  const result = await store.save({ make: 'ＨＹＵＮＤＡＩ', group: ' grandeUr ', model: 'gn7', grade: 'PREMIUM', subgrade: '', model_year: '2026' });
  assert.deepEqual(result, { company_id: COMPANY_A, entry: original, inserted: false });
  assert.deepEqual(state.saved, [original]); assert.equal(state.upserts.length, 1);
  assert.deepEqual(Object.keys(state.upserts[0]), ['make', 'group', 'model', 'grade', 'subgrade', 'model_year']);
});

test('wrong or malformed save ACK never reports success or applies cache', async () => {
  const replies = [
    { company_id: COMPANY_B, entry: row(), inserted: true }, { company_id: COMPANY_A, entry: row({ model: 'Wrong generation' }), inserted: true },
    { company_id: COMPANY_A, entry: row({ id: '' }), inserted: true }, { company_id: COMPANY_A, entry: row(), inserted: 'true' },
    { company_id: COMPANY_A, entry: row({ verification: 'official' }), inserted: true }, { company_id: COMPANY_A, inserted: true }
  ];
  for (const response of replies) {
    const { state, store } = fixture(); state.upsertHook = () => clone(response);
    await assert.rejects(store.save(entry()), { code: 'INVALID_DATA' }); assert.equal(state.saved.length, 0);
  }
});

test('concurrent saves serialize snapshots captured at invocation, even while caller mutates queued input', async () => {
  const { state, store } = fixture(); const gate = deferred(), firstStarted = deferred();
  state.upsertHook = async value => { if (state.upserts.length === 1) { firstStarted.resolve(); await gate.promise; } return { company_id: COMPANY_A, entry: row({ ...value, id: state.upserts.length === 1 ? ROW_ID : SECOND_ID }), inserted: true }; };
  const first = store.save(entry()); await firstStarted.promise;
  const secondInput = entry({ model: 'Second generation' }); const second = store.save(secondInput); secondInput.model = 'Later caller mutation';
  assert.equal(state.upserts.length, 1); gate.resolve(); await Promise.all([first, second]);
  assert.equal(state.upserts.length, 2); assert.equal(state.upserts[1].model, 'Second generation');
  assert.deepEqual(state.saved.map(value => value.model), ['디 올 뉴 그랜저', 'Second generation']);
});

test('load queued after save cannot apply a stale full list after the new row callback', async () => {
  const { state, store } = fixture(); const gate = deferred(), started = deferred();
  state.upsertHook = async value => { started.resolve(); await gate.promise; const saved = row(value); state.rows = [saved]; return { company_id: COMPANY_A, entry: saved, inserted: true }; };
  const save = store.save(entry()); await started.promise; const load = store.load(); assert.equal(state.reads, 0);
  gate.resolve(); await save; const loaded = await load;
  assert.deepEqual(loaded.entries, state.rows); assert.deepEqual(state.events, ['saved', 'loaded']);
});

test('context change during read discards old company response before callback', async () => {
  const { state, store } = fixture([row()]); const gate = deferred(), started = deferred();
  state.readHook = async () => { started.resolve(); await gate.promise; return { company_id: COMPANY_A, entries: [row()] }; };
  const operation = store.load(); await started.promise; state.key = 'company-b:user-b:new-session'; state.company = COMPANY_B; gate.resolve();
  await assert.rejects(operation, { code: 'CONTEXT_CHANGED' }); assert.equal(state.loaded.length, 0);
});

test('same context key with changed company is still rejected, including a queued write before dispatch', async () => {
  const { state, store } = fixture(); const gate = deferred(), started = deferred();
  state.upsertHook = async () => { started.resolve(); await gate.promise; return { company_id: COMPANY_A, entry: row(), inserted: true }; };
  const first = store.save(entry()); await started.promise; const second = store.save(entry({ grade: 'Second' }));
  const observed = Promise.allSettled([first, second]); state.company = COMPANY_B; gate.resolve();
  const results = await observed; assert(results.every(value => value.status === 'rejected' && value.reason.code === 'CONTEXT_CHANGED'));
  assert.equal(state.upserts.length, 1); assert.equal(state.saved.length, 0);
});

test('context changed inside asynchronous callback rejects the operation and never returns old-company success', async () => {
  for (const method of ['load', 'save']) {
    const { state, store } = fixture([row()]); const gate = deferred(), started = deferred();
    const callback = async () => { started.resolve(); await gate.promise; };
    if (method === 'load') state.loadedHook = callback; else state.savedHook = callback;
    const operation = method === 'load' ? store.load() : store.save(entry()); await started.promise;
    state.key = null; gate.resolve(); await assert.rejects(operation, { code: 'CONTEXT_CHANGED' });
  }
});

test('setup/permission/network codes propagate safely and a failed operation does not poison the queue', async () => {
  for (const code of ['SETUP_REQUIRED', 'FORBIDDEN', 'NETWORK']) {
    const { state, store } = fixture(); state.upsertHook = () => { throw coded(code); };
    await assert.rejects(store.save(entry()), error => error.code === code && !error.message.includes('Untrusted'));
    assert.equal(state.saved.length, 0); state.upsertHook = null;
    assert.equal((await store.save(entry())).inserted, true); assert.equal(state.saved.length, 1);
  }
});

test('lost ACK remains an error; later explicit idempotent retry acknowledges only the returned server row', async () => {
  const { state, store } = fixture(); let stored = null;
  state.upsertHook = value => { if (!stored) { stored = row(value); throw coded('NETWORK'); } return { company_id: COMPANY_A, entry: clone(stored), inserted: false }; };
  await assert.rejects(store.save(entry()), { code: 'NETWORK' }); assert.equal(state.upserts.length, 1); assert.equal(state.saved.length, 0); assert.equal(state.reads, 0);
  const retry = await store.save(entry()); assert.equal(retry.inserted, false); assert.deepEqual(state.saved, [stored]);
});

test('invalid or missing context is rejected without calling adapters', async () => {
  const { state, store } = fixture(); state.key = null;
  await assert.rejects(store.load(), { code: 'CONTEXT_CHANGED' }); await assert.rejects(store.save(entry()), { code: 'CONTEXT_CHANGED' });
  assert.equal(state.reads, 0); assert.equal(state.upserts.length, 0);
  assert.throws(() => createVehicleTaxonomyStore({}), { code: 'INVALID_DATA' });
});

test('callback mutations cannot alter returned save ACK or the adapter server row', async () => {
  const { state, store } = fixture(); state.savedHook = value => { value.model = 'Callback mutation'; value.verification = 'fake-official'; };
  const result = await store.save(entry()); assert.equal(result.entry.model, '디 올 뉴 그랜저'); assert.equal(result.entry.verification, 'user_import');
  assert.equal(state.rows[0].model, '디 올 뉴 그랜저'); assert.equal(state.rows[0].verification, 'user_import');
});
