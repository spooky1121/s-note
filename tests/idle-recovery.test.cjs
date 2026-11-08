'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const recovery = require('../assets/idle-recovery.js');

const scope = Object.freeze({
  project: 'https://fixture.supabase.co',
  userId: '11111111-1111-4111-8111-111111111111',
  companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
});
const otherUser = '22222222-2222-4222-8222-222222222222';
const otherCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nilOwner = '00000000-0000-0000-0000-000000000000';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

function cacheKey(dataset, ownerId) {
  return `zerocar-office-v12-${dataset}-cld_${ownerId.replaceAll('-', '').slice(0, 18)}`;
}

function entry(overrides = {}) {
  return {
    dataset: 'cars',
    ownerId: scope.userId,
    storageKey: cacheKey('cars', scope.userId),
    revision: 2,
    hash: hashA,
    ...overrides
  };
}

function memoryStorage(initial = []) {
  const values = new Map(initial);
  const calls = [];
  return {
    values,
    calls,
    getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    setItem(key, value) {
      assert.equal(typeof value, 'string');
      calls.push(['set', key]);
      values.set(key, value);
    },
    removeItem(key) { calls.push(['remove', key]); values.delete(key); }
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('SHA-256 uses the supplied string and marker keys isolate project, account and company', async () => {
  assert.equal(await recovery.hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await recovery.hash('abc'), await recovery.hash('abcd'));
  await assert.rejects(() => recovery.hash(null));
  const keys = [
    recovery.key(scope),
    recovery.key({ ...scope, project: 'ref-test' }),
    recovery.key({ ...scope, userId: otherUser }),
    recovery.key({ ...scope, companyId: otherCompany })
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(recovery.key({ ...scope, project: `${scope.project}/`, companyId: scope.companyId.toUpperCase() }), recovery.key(scope));
});

test('markers contain only explicit metadata and leave the source cache and inputs untouched', () => {
  const privateSentinel = 'synthetic-private-payload-do-not-copy';
  const source = JSON.stringify([{ customer: privateSentinel }]);
  const row = freeze(entry({ payload: { customer: privateSentinel }, customer: privateSentinel, rawJWT: 'synthetic.jwt.secret' }));
  const rows = freeze([row]);
  const scopedInput = freeze({ ...scope, rawJWT: 'synthetic.scope.secret' });
  const before = JSON.stringify({ rows, scopedInput });
  const storage = memoryStorage([[row.storageKey, source]]);

  recovery.write(scopedInput, rows, storage);

  const serialized = storage.values.get(recovery.key(scope));
  const marker = JSON.parse(serialized);
  assert.deepEqual(Object.keys(marker).sort(), ['v', 'project', 'userId', 'companyId', 'entries'].sort());
  assert.deepEqual(Object.keys(marker.entries[0]).sort(), ['dataset', 'ownerId', 'storageKey', 'revision', 'hash'].sort());
  assert.equal(marker.v, 1);
  assert.equal(serialized.includes(privateSentinel), false);
  assert.equal(serialized.includes('synthetic.jwt.secret'), false);
  assert.equal(serialized.includes('synthetic.scope.secret'), false);
  assert.deepEqual(recovery.read(scope, storage), marker);
  assert.equal(storage.values.get(row.storageKey), source);
  assert.equal(JSON.stringify({ rows, scopedInput }), before);
  assert.equal(recovery.read({ ...scope, userId: otherUser }, storage), null);

  recovery.remove(scope, storage);
  assert.equal(recovery.read(scope, storage), null);
  assert.equal(storage.values.get(row.storageKey), source);
});

test('invalid scopes, revisions, hashes and unauthorized cache keys cannot replace a valid marker', () => {
  const storage = memoryStorage();
  recovery.write(scope, [entry()], storage);
  const key = recovery.key(scope);
  const original = storage.values.get(key);
  const invalidScopes = [
    null,
    {},
    { ...scope, project: '' },
    { ...scope, userId: 'another-user' },
    { ...scope, companyId: 'another-company' },
    { ...scope, project: 'https://user:password@fixture.supabase.co' },
    { ...scope, project: 'https://fixture.supabase.co/?secret=value' }
  ];
  for (const invalid of invalidScopes) {
    assert.throws(() => recovery.write(invalid, [entry()], storage));
    assert.equal(storage.values.get(key), original);
  }
  const invalidEntries = [
    entry({ revision: -1 }), entry({ revision: 1.5 }), entry({ revision: Number.MAX_SAFE_INTEGER + 1 }), entry({ revision: NaN }),
    entry({ hash: 'a'.repeat(63) }), entry({ hash: 'z'.repeat(64) }),
    entry({ ownerId: 'invalid-owner' }), entry({ ownerId: nilOwner }),
    entry({ dataset: 'session' }), entry({ storageKey: 'sb-project-auth-token' }),
    entry({ storageKey: cacheKey('cars', otherUser) })
  ];
  for (const invalid of invalidEntries) {
    assert.throws(() => recovery.write(scope, [invalid], storage));
    assert.equal(storage.values.get(key), original);
  }
  recovery.write(scope, [entry({ revision: Number.MAX_SAFE_INTEGER })], storage);
  assert.equal(recovery.read(scope, storage).entries[0].revision, Number.MAX_SAFE_INTEGER);
});

test('duplicates and excessive entries are rejected while shared datasets require their exact cache keys', () => {
  const storage = memoryStorage();
  recovery.write(scope, [entry()], storage);
  const key = recovery.key(scope);
  const original = storage.values.get(key);
  assert.throws(() => recovery.write(scope, [entry(), entry({ revision: 3 })], storage));
  assert.equal(storage.values.get(key), original);
  assert.throws(() => recovery.write(scope, Array(1), storage));
  assert.equal(storage.values.get(key), original);
  const collidingOwner = '11111111-1111-4111-8111-111111111112';
  assert.throws(() => recovery.write(scope, [entry(), entry({ ownerId: collidingOwner })], storage));
  assert.equal(storage.values.get(key), original);

  const shared = [
    ['finance', 'zerocar-office-v182-inventory-finance-ledger'],
    ['finance_limits', 'zerocar-office-v157-finance-companies'],
    ['prestock', 'zerocar-office-v148-prestock-ledger'],
    ['monthly', 'zerocar-office-v165-monthly-ledger'],
    ['categories', 'zerocar-office-v170-monthly-category-settings']
  ].map(([dataset, storageKey]) => entry({ dataset, storageKey, ownerId: nilOwner }));
  recovery.write(scope, [entry(), entry({ dataset: 'covers', storageKey: cacheKey('covers', scope.userId) }), ...shared], storage);
  assert.equal(recovery.read(scope, storage).entries.length, 7);
  assert.throws(() => recovery.write(scope, [entry({ ...shared[0], ownerId: scope.userId })], storage));

  const many = Array.from({ length: 1001 }, (_, index) => {
    const ownerId = `${(index + 1).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
    return entry({ ownerId, storageKey: cacheKey('cars', ownerId) });
  });
  recovery.write(scope, many.slice(0, 1000), storage);
  const atLimit = storage.values.get(key);
  assert.equal(recovery.read(scope, storage).entries.length, 1000);
  assert.throws(() => recovery.write(scope, many, storage));
  assert.equal(storage.values.get(key), atLimit);
});

test('corrupt and cross-scope markers fail visibly and retain their original stored bytes', () => {
  const storage = memoryStorage();
  const key = recovery.key(scope);
  assert.equal(recovery.read(scope, storage), null);
  recovery.write(scope, [entry()], storage);
  const valid = JSON.parse(storage.values.get(key));
  const corruptValues = [
    '{incomplete',
    'null',
    '[]',
    JSON.stringify({ ...valid, v: 2 }),
    JSON.stringify({ ...valid, project: 'other-project' }),
    JSON.stringify({ ...valid, userId: otherUser }),
    JSON.stringify({ ...valid, companyId: otherCompany }),
    JSON.stringify({ ...valid, payload: 'synthetic-unexpected-data' }),
    JSON.stringify({ ...valid, entries: [entry({ payload: 'synthetic-unexpected-data' })] }),
    JSON.stringify({ ...valid, entries: [entry({ revision: -1 })] }),
    JSON.stringify({ ...valid, entries: [entry(), entry()] })
  ];
  for (const corrupt of corruptValues) {
    storage.values.set(key, corrupt);
    assert.throws(() => recovery.read(scope, storage));
    assert.throws(() => recovery.write(scope, [entry()], storage));
    assert.throws(() => recovery.remove(scope, storage));
    assert.equal(storage.values.get(key), corrupt);
  }
  const otherScope = { ...scope, userId: otherUser };
  const copied = JSON.stringify(valid);
  storage.values.set(recovery.key(otherScope), copied);
  assert.throws(() => recovery.read(otherScope, storage));
  assert.equal(storage.values.get(recovery.key(otherScope)), copied);
});

test('reconciliation retries only the original revision, recognizes late acknowledgments and protects conflicts', () => {
  const row = freeze(entry());
  const cases = [
    [{ cacheHash: hashA, serverRevision: 2, serverHash: hashB }, 'retry'],
    [{ cacheHash: hashA, serverRevision: 2, serverHash: hashA }, 'acknowledged'],
    [{ cacheHash: hashA, serverRevision: 3, serverHash: hashA }, 'acknowledged'],
    [{ cacheHash: hashA, serverRevision: 3, serverHash: hashB }, 'conflict'],
    [{ cacheHash: hashA, serverRevision: 1, serverHash: hashB }, 'conflict'],
    [{ cacheHash: hashA, serverRevision: 1, serverHash: hashA }, 'conflict'],
    [{ cacheHash: hashA, serverRevision: 0, serverHash: null, serverExists: false }, 'conflict']
  ];
  for (const [observation, expected] of cases) {
    const before = JSON.stringify(observation);
    assert.equal(recovery.reconcile(row, freeze(observation)), expected);
    assert.equal(JSON.stringify(observation), before);
  }
  assert.equal(recovery.reconcile(freeze(entry({ revision: 0 })), freeze({
    cacheHash: hashA, serverRevision: 0, serverHash: null, serverExists: false
  })), 'retry');
  assert.deepEqual(row, entry());
});

test('a changed local cache takes precedence over acknowledgment, retry and conflict decisions', () => {
  const row = freeze(entry());
  for (const observation of [
    { cacheHash: hashB, serverRevision: 3, serverHash: hashA },
    { cacheHash: hashB, serverRevision: 2, serverHash: hashB },
    { cacheHash: hashB, serverRevision: 9, serverHash: hashB },
    { cacheHash: hashB, serverRevision: 0, serverHash: null, serverExists: false }
  ]) {
    assert.equal(recovery.reconcile(row, freeze(observation)), 'cache-changed');
  }
  assert.deepEqual(row, entry());
});

test('storage read, write and removal failures propagate without deleting markers or source caches', () => {
  const row = freeze(entry());
  const storage = memoryStorage([[row.storageKey, 'synthetic-existing-cache']]);
  recovery.write(scope, [row], storage);
  const key = recovery.key(scope);
  const original = storage.values.get(key);
  const failure = new Error('synthetic storage failure');

  const failedWrite = { ...storage, setItem() { throw failure; } };
  assert.throws(() => recovery.write(scope, [entry({ revision: 3 })], failedWrite), error => error === failure);
  assert.equal(storage.values.get(key), original);
  assert.equal(storage.calls.some(([operation]) => operation === 'remove'), false);

  const failedRead = { ...storage, getItem() { throw failure; } };
  assert.throws(() => recovery.read(scope, failedRead), error => error === failure);
  const failedRemove = { ...storage, removeItem() { throw failure; } };
  assert.throws(() => recovery.remove(scope, failedRemove), error => error === failure);
  assert.equal(storage.values.get(key), original);
  assert.equal(storage.values.get(row.storageKey), 'synthetic-existing-cache');
});
