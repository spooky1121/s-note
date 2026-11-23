'use strict';
// Actual compatibility module; synthetic browser-cache values only.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/snote-storage-compat.js');
const OWNER = 'synthetic_dealer', OTHER = 'synthetic_other';
const UUID = '11111111-1111-4111-8111-111111111111', NIL = '00000000-0000-0000-0000-000000000000';
const CAR = C.primaryKey('cars', OWNER), OLD_CAR = C.legacyKey(CAR);

class MemoryStorage {
  constructor(entries = []) { this.values = new Map(entries); this.events = []; this.fail = null; }
  getItem(key) { this.events.push(['get', key]); return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    this.events.push(['set', key]);
    if (this.fail?.(key)) throw new Error('Synthetic storage failure');
    this.values.set(key, String(value));
  }
  removeItem(key) { this.events.push(['remove', key]); this.values.delete(key); }
}
const local = { mode: 'local', owner: OWNER, validate: raw => Array.isArray(JSON.parse(raw)) };

test('alias registry round trips owner-specific keys and every dataset without reassigning owners', () => {
  for (const dataset of ['cars', 'covers', 'finance', 'finance_limits', 'prestock', 'monthly', 'categories']) {
    const primary = C.primaryKey(dataset, OWNER), previous = C.legacyKey(primary);
    assert(previous && previous !== primary); assert.equal(C.canonicalKey(previous), primary);
    assert.equal(C.canonicalKey(primary), primary);
  }
  assert.equal(C.describe(CAR).owner, OWNER);
  assert.equal(C.describe(C.legacyKey(C.primaryKey('cars', OTHER))).owner, OTHER);
  assert.equal(C.describe('unrelated-cache'), null);
  assert.equal(C.canonicalKey('unrelated-cache'), 'unrelated-cache');
});

test('constructing and reading a local alias never copies, deletes, merges or schedules a write', () => {
  const store = new MemoryStorage([[OLD_CAR, '[{"id":"old-only"}]']]);
  const adapter = C.createAdapter(store); assert.deepEqual(store.events, []);
  assert.equal(adapter.readLocal(CAR, local), '[{"id":"old-only"}]');
  assert.deepEqual([...store.values.keys()], [OLD_CAR]);
  assert(store.events.every(event => event[0] === 'get'));
});

test('every present primary wins, including intentionally empty or zero values', () => {
  for (const raw of ['', '[]', '{}', '0', 'false', 'null', 'malformed-current-value']) {
    const store = new MemoryStorage([[OLD_CAR, '[{"id":"stale"}]'], [CAR, raw]]);
    assert.equal(C.createAdapter(store).readLocal(CAR, local), raw);
    assert(!store.events.some(event => event[1] === OLD_CAR));
  }
});

test('invalid aliases and mismatched local owners are retained but never imported', () => {
  const store = new MemoryStorage([[OLD_CAR, '{invalid']]), adapter = C.createAdapter(store);
  assert.equal(adapter.readLocal(CAR, local), null);
  assert.equal(adapter.readLocal(CAR, { ...local, owner: OTHER }), null);
  assert.equal(adapter.readLocal(CAR, { ...local, mode: 'cloud' }), null);
  assert.equal(store.values.get(OLD_CAR), '{invalid');
  assert(store.events.every(event => event[0] === 'get'));
});

test('hosted owner aliases cannot take unverified local fallback even in local mode', () => {
  const key = C.primaryKey('cars', 'cld_' + UUID.replaceAll('-', '').slice(0, 18));
  const store = new MemoryStorage([[C.legacyKey(key), '[{"id":"unverified-company"}]']]);
  assert.equal(C.createAdapter(store).readLocal(key, { ...local, owner: C.describe(key).owner }), null);
});

test('all shared finance and monthly aliases refuse ordinary local reads', () => {
  for (const key of [C.keys.finance, C.keys.financeLimits, C.keys.prestock, C.keys.prestockPrevious, C.keys.monthly, C.keys.categories]) {
    const store = new MemoryStorage([[C.legacyKey(key), '[{"company":"unknown"}]']]);
    assert.throws(() => C.createAdapter(store).readLocal(key, local), /verified recovery/);
    assert.equal(store.events.length, 0);
  }
});

test('ordinary saves only write the primary and leave both old data and recovery metadata alone', () => {
  const store = new MemoryStorage([[OLD_CAR, '[{"id":"original"}]']]), adapter = C.createAdapter(store);
  adapter.writePrimary(CAR, '[{"id":"current"}]');
  assert.equal(store.values.get(CAR), '[{"id":"current"}]');
  assert.equal(store.values.get(OLD_CAR), '[{"id":"original"}]');
  assert.deepEqual(store.events, [['set', CAR]]);
  assert.throws(() => adapter.writePrimary(OLD_CAR, '[]'), /read only/);
});

test('a failed new save does not suppress the intact old local data', () => {
  const store = new MemoryStorage([[OLD_CAR, '[{"id":"recoverable"}]']]), adapter = C.createAdapter(store);
  store.fail = key => key === CAR;
  assert.throws(() => adapter.writePrimary(CAR, '[]'), /Synthetic/);
  assert.equal(adapter.readLocal(CAR, local), '[{"id":"recoverable"}]');
  assert.equal(store.values.has(C.markerKey(CAR)), false);
});

test('deletion records durable suppression before removing and never deletes the old dataset', () => {
  const store = new MemoryStorage([[OLD_CAR, '[{"id":"old"}]'], [CAR, '[{"id":"new"}]']]), adapter = C.createAdapter(store);
  adapter.removePrimary(CAR);
  assert.equal(store.values.get(OLD_CAR), '[{"id":"old"}]');
  assert.equal(adapter.readLocal(CAR, local), null);
  const set = store.events.findIndex(e => e[0] === 'set' && e[1] === C.markerKey(CAR));
  const remove = store.events.findIndex(e => e[0] === 'remove' && e[1] === CAR);
  assert(set >= 0 && remove > set);
});

test('old-tab writes cannot revive a deleted primary, and explicit new saves still work', () => {
  const store = new MemoryStorage([[OLD_CAR, '[]']]), adapter = C.createAdapter(store);
  adapter.removePrimary(CAR); store.setItem(OLD_CAR, '[{"id":"stale-tab-write"}]');
  assert.equal(C.createAdapter(store).readLocal(CAR, local), null);
  adapter.writePrimary(CAR, '[{"id":"explicit-new-save"}]');
  assert.equal(adapter.readLocal(CAR, local), '[{"id":"explicit-new-save"}]');
});

test('failure to save a suppression marker aborts before deleting any current or old value', () => {
  const store = new MemoryStorage([[OLD_CAR, 'old'], [CAR, 'current']]), adapter = C.createAdapter(store);
  store.fail = key => key === C.markerKey(CAR);
  assert.throws(() => adapter.removePrimary(CAR), /Synthetic/);
  assert.equal(store.values.get(CAR), 'current'); assert.equal(store.values.get(OLD_CAR), 'old');
  assert(!store.events.some(e => e[0] === 'remove'));
});

test('explicit logout removes both session hints and prevents a later old-format restoration', () => {
  const legacy = C.legacyKey(C.keys.session), store = new MemoryStorage([[legacy, OWNER], [C.keys.session, OWNER]]);
  const adapter = C.createAdapter(store); adapter.clearSession();
  assert.equal(store.values.has(legacy), false); assert.equal(store.values.has(C.keys.session), false);
  store.setItem(legacy, OWNER);
  assert.equal(C.createAdapter(store).readLocal(C.keys.session, { mode: 'local' }), null);
  adapter.writePrimary(C.keys.session, OTHER);
  assert.equal(adapter.readLocal(C.keys.session, { mode: 'local' }), OTHER);
});

test('zero write quota does not block clearing either session format or a guarded logout', () => {
  class BrowserStorage extends MemoryStorage {}
  const previous = C.legacyKey(C.keys.session), session = new BrowserStorage([[previous, OWNER], [C.keys.session, OWNER]]);
  const localStore = new BrowserStorage(); session.fail = () => true;
  const guard = C.installRemovalGuard({ StorageClass: BrowserStorage, localStorage: localStore, sessionStorage: session });
  try {
    assert.doesNotThrow(() => session.removeItem(C.keys.session));
    assert.equal(session.values.has(previous), false); assert.equal(session.values.has(C.keys.session), false);
    assert.equal(C.createAdapter(session).readLocal(C.keys.session, { mode: 'local' }), null);
    assert.throws(() => session.setItem(previous, OWNER), /Synthetic/);
  } finally { guard.restore(); }
});

test('recovery accepts only the exact dataset/owner aliases and reports new-primary conflicts without mutation', () => {
  const key = C.keys.finance, previous = C.legacyKey(key), store = new MemoryStorage([[previous, '["pending-old"]'], [key, '["newer-primary"]']]);
  const adapter = C.createAdapter(store), result = adapter.readRecovery({ dataset: 'finance', ownerId: NIL, storageKey: previous });
  assert.deepEqual(result, { key: previous, raw: '["pending-old"]', primaryKey: key, primaryRaw: '["newer-primary"]', primaryConflict: true });
  assert.throws(() => adapter.readRecovery({ dataset: 'finance', ownerId: UUID, storageKey: previous }), /Invalid/);
  assert.throws(() => adapter.readRecovery({ dataset: 'monthly', ownerId: NIL, storageKey: previous }), /Invalid/);
  assert(store.events.every(e => e[0] === 'get'));
});

test('a retained pending marker cannot restore an explicitly deleted primary from an old alias', () => {
  const key = C.keys.monthly, previous = C.legacyKey(key), payload = '[{"id":"pending-before-deletion"}]';
  const store = new MemoryStorage([[previous, payload], [key, payload]]), adapter = C.createAdapter(store);
  adapter.removePrimary(key);
  store.events.length = 0;
  const result = adapter.readRecovery({ dataset: 'monthly', ownerId: NIL, storageKey: previous });
  assert.equal(result.raw, payload, 'Keep the old source available for explicit diagnosis');
  assert.equal(result.primaryRaw, null);
  assert.equal(result.primaryConflict, true, 'A verified hash does not override explicit deletion');
  assert.equal(store.values.get(key), undefined);
  assert.equal(store.values.get(previous), payload);
  assert(store.events.every(e => e[0] === 'get'));
});

test('recovery owner and dataset validation does not widen for nil, malformed or another owner', () => {
  const primary = C.primaryKey('cars', 'cld_' + UUID.replaceAll('-', '').slice(0, 18));
  for (const key of [primary, C.legacyKey(primary)]) assert(C.acceptsRecoveryKey('cars', UUID, key));
  assert.equal(C.acceptsRecoveryKey('cars', NIL, primary), false);
  assert.equal(C.acceptsRecoveryKey('cars', 'not-an-id', primary), false);
  assert.equal(C.acceptsRecoveryKey('covers', UUID, primary), false);
  assert.equal(C.acceptsRecoveryKey('cars', '22222222-2222-4222-8222-222222222222', primary), false);
  assert.equal(C.acceptsRecoveryKey('unknown', NIL, primary), false);
});

test('captured native operations bypass an application autosave wrapper during reads and removals', () => {
  const store = new MemoryStorage([[OLD_CAR, '[]'], [CAR, '[]']]), nativeOps = {
    getItem: store.getItem, setItem: store.setItem, removeItem: store.removeItem
  };
  let queued = 0; store.setItem = function (...args) { queued++; return nativeOps.setItem.apply(this, args); };
  const adapter = C.createAdapter(store, { nativeOps }); adapter.readLocal(CAR, local); adapter.removePrimary(CAR);
  assert.equal(queued, 0); assert.equal(store.values.get(OLD_CAR), '[]');
});

test('the removal guard wraps only removeItem and leaves unrelated auth/recovery keys on the native path', () => {
  class BrowserStorage extends MemoryStorage {}
  const localStore = new BrowserStorage([[CAR, '[]'], [OLD_CAR, '[1]'], ['unrelated-auth-hint', 'value']]);
  const session = new BrowserStorage([[C.keys.session, OWNER], [C.legacyKey(C.keys.session), OWNER]]);
  const get = BrowserStorage.prototype.getItem, set = BrowserStorage.prototype.setItem, remove = BrowserStorage.prototype.removeItem;
  const guard = C.installRemovalGuard({ StorageClass: BrowserStorage, localStorage: localStore, sessionStorage: session });
  try {
    assert.equal(BrowserStorage.prototype.getItem, get); assert.equal(BrowserStorage.prototype.setItem, set);
    assert.equal(C.installRemovalGuard({ StorageClass: BrowserStorage, localStorage: localStore, sessionStorage: session }), guard);
    localStore.removeItem(CAR); assert.equal(C.createAdapter(localStore).readLocal(CAR, local), null);
    localStore.removeItem('unrelated-auth-hint'); assert.equal(localStore.values.has('unrelated-auth-hint'), false);
    assert.equal(localStore.values.has(C.markerKey('unrelated-auth-hint')), false);
    session.removeItem(C.keys.session); assert.equal(session.values.has(C.legacyKey(C.keys.session)), false);
    assert.equal(session.values.has(C.keys.session), false);
  } finally { guard.restore(); }
  assert.equal(BrowserStorage.prototype.removeItem, remove);
});

test('guarded removal fails closed on metadata quota and never merges a legacy dataset', () => {
  class BrowserStorage extends MemoryStorage {}
  const store = new BrowserStorage([[CAR, 'current'], [OLD_CAR, 'old']]), session = new BrowserStorage();
  const guard = C.installRemovalGuard({ StorageClass: BrowserStorage, localStorage: store, sessionStorage: session });
  try {
    store.fail = key => key === C.markerKey(CAR);
    assert.throws(() => store.removeItem(CAR), /Synthetic/);
    assert.equal(store.values.get(CAR), 'current'); assert.equal(store.values.get(OLD_CAR), 'old');
    assert.throws(() => store.removeItem(OLD_CAR), /read only/);
  } finally { guard.restore(); }
});
