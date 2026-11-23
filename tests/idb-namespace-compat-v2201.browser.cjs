'use strict';
// Native IndexedDB, isolated browser contexts, synthetic records only. No real service calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('./encar/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), FILE = path.join(ROOT, 'assets/snote-idb-compat.js');
const SOURCE = fs.readFileSync(FILE, 'utf8'), HASH = crypto.createHash('sha256').update(SOURCE).digest('hex');
const OUT = process.env.IDB_NAMESPACE_ARTIFACT_DIR || '/workspace/work/storage-namespace-v2201/idb';
const ORIGIN = 'https://s-note-idb.example', results = [];
const CONFIG = {
  files: { primary: 's-note-office-v12-files', legacy: 'zerocar-office-v12-files', oldVersion: 2, version: 3,
    stores: { media: { key: 'id', index: ['carId', 'carId'] }, modelPhotos: { key: 'key' } } },
  accounts: { primary: 's-note-office-v12-accounts', legacy: 'zerocar-office-v12-accounts', oldVersion: 1, version: 2,
    stores: { users: { key: 'username' } } },
  customers: { primary: 's-note-office-v172-customers', legacy: 'zerocar-office-v172-customers', oldVersion: 1, version: 2,
    stores: { customers: { key: 'id', index: ['ownerId', 'ownerId'] } } }
};
fs.mkdirSync(OUT, { recursive: true });

async function fixture(browser) {
  const context = await browser.newContext(), requests = [], errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url()); requests.push(url.href);
    assert.equal(url.origin, ORIGIN, 'Every external request is blocked');
    assert.equal(url.pathname, '/');
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><title>Synthetic IDB test</title><body></body></html>' });
  });
  const addPage = async () => {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN); await page.addScriptTag({ content: SOURCE }); return page;
  };
  const page = await addPage();
  return { page, addPage, errors, async close() { assert.deepEqual(errors, []); await context.close(); } };
}
async function seed(page, kind, { primary = false, rows = {}, hold = false, extra = false, version } = {}) {
  return page.evaluate(async ({ config, primary, rows, hold, extra, version }) => {
    const name = primary ? config.primary : config.legacy;
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, version || (primary ? 1 : config.oldVersion));
      r.onupgradeneeded = () => {
        for (const [name, spec] of Object.entries(config.stores)) {
          if (!r.result.objectStoreNames.contains(name)) {
            const store = r.result.createObjectStore(name, { keyPath: spec.key });
            if (spec.index) store.createIndex(...spec.index);
          }
        }
        if (extra && !r.result.objectStoreNames.contains('unknownPrivateStore')) r.result.createObjectStore('unknownPrivateStore', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const names = Object.keys(rows);
    if (names.length) await new Promise((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      for (const name of names) for (const value of rows[name]) {
        const copy = { ...value };
        if (copy.syntheticBlob !== undefined) { copy.blob = new File([copy.syntheticBlob], 'synthetic.png', { type: 'image/png', lastModified: 17 }); delete copy.syntheticBlob; }
        tx.objectStore(name).put(copy);
      }
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    if (hold) { window.__heldSource = db; return db.version; }
    db.close(); return db.version;
  }, { config: CONFIG[kind], primary, rows, hold, extra, version });
}
async function inspect(page, kind, primary = true) {
  return page.evaluate(async ({ config, primary }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(primary ? config.primary : config.legacy); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const stores = [...db.objectStoreNames], data = {};
      await Promise.all(stores.map(name => new Promise((resolve, reject) => {
        const tx = db.transaction(name), r = tx.objectStore(name).getAll();
        r.onsuccess = async () => {
          data[name] = await Promise.all(r.result.map(async value => value.blob instanceof Blob
            ? { ...value, blob: { text: await value.blob.text(), type: value.blob.type, fileName: value.blob.name, lastModified: value.blob.lastModified } } : value));
          resolve();
        };
        r.onerror = () => reject(r.error);
      })));
      return { version: db.version, stores, data };
    } finally { db.close(); }
  }, { config: CONFIG[kind], primary });
}
async function open(page, kind, options) {
  return page.evaluate(async ({ kind, options }) => {
    try { const db = await SnoteIdbCompat.open(kind, options); return { ok: true, name: db.name, version: db.version, stores: [...db.objectStoreNames], state: SnoteIdbCompat.inspect(kind) }; }
    catch (error) { return { ok: false, code: error.code, message: error.message }; }
  }, { kind, options });
}
async function check(browser, name, run) {
  const f = await fixture(browser);
  try { await run(f); results.push({ name, passed: true }); console.log('PASS ' + name); }
  finally { await f.close(); }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  try {
    await check(browser, 'schema-only startup touches no legacy DB and supplies native indexes', async ({ page }) => {
      await page.evaluate(() => { window.__opened = []; const native = indexedDB.open.bind(indexedDB); indexedDB.open = (...args) => { __opened.push(args[0]); return native(...args); }; });
      for (const kind of Object.keys(CONFIG)) {
        const result = await open(page, kind, { migrate: false }); assert(result.ok); assert.equal(result.name, CONFIG[kind].primary); assert.equal(result.version, CONFIG[kind].version); assert.equal(result.state.ready, false);
      }
      assert.deepEqual(await page.evaluate(() => __opened), Object.values(CONFIG).map(c => c.primary));
      const names = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name).sort());
      assert.deepEqual(names, Object.values(CONFIG).map(c => c.primary).sort());
    });
    await check(browser, 'absent legacy probe leaves no old DB and the confirmed marker prevents another import', async ({ page }) => {
      assert((await open(page, 'files')).ok);
      const result = await inspect(page, 'files'); assert.equal(result.data._snoteNamespace[0].complete, true); assert.equal(result.data._snoteNamespace[0].sourceVersion, null);
      const names = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name)); assert.deepEqual(names, [CONFIG.files.primary]);
      await page.evaluate(() => { window.__oldOpenCalls = 0; const native = indexedDB.open.bind(indexedDB); indexedDB.open = (...args) => { __oldOpenCalls++; return native(...args); }; });
      assert((await open(page, 'files')).ok); assert.equal(await page.evaluate(() => __oldOpenCalls), 0);
    });
    await check(browser, 'media and model-photo Blob contents migrate while newer primary fields and zero remain authoritative', async ({ page }) => {
      await seed(page, 'files', { rows: { media: [{ id: 'old-photo', carId: 'car-a', ownerId: 'owner-a', group: 'photos', amount: 0, note: '', syntheticBlob: 'synthetic blob bytes' }, { id: 'same-id', carId: 'car-a', note: 'old value' }], modelPhotos: [{ key: 'model-a', keySuffix: 'make|model', ownerId: 'owner-a', syntheticBlob: 'synthetic model bytes' }] } });
      await seed(page, 'files', { primary: true, rows: { media: [{ id: 'same-id', carId: 'car-a', note: '', amount: 0, approved: false }] } });
      assert((await open(page, 'files')).ok);
      const actual = await inspect(page, 'files'), source = await inspect(page, 'files', false);
      assert.equal(actual.version, 3); assert.equal(source.version, 3); assert.equal(actual.data.media.length, 2); assert.equal(source.data.media.length, 2);
      const photo = actual.data.media.find(r => r.id === 'old-photo'); assert.equal(photo.blob.text, 'synthetic blob bytes'); assert.equal(photo.blob.type, 'image/png'); assert.equal(photo.blob.fileName, 'synthetic.png'); assert.equal(photo.blob.lastModified, 17); assert.equal(photo.amount, 0); assert.equal(photo.note, '');
      assert.deepEqual(actual.data.media.find(r => r.id === 'same-id'), { id: 'same-id', carId: 'car-a', note: '', amount: 0, approved: false });
      assert.equal(actual.data.modelPhotos[0].blob.text, 'synthetic model bytes');
      assert.equal(await page.evaluate(async () => { const db = await SnoteIdbCompat.open('files'); return new Promise((resolve, reject) => { const q = db.transaction('media').objectStore('media').index('carId').getAll('car-a'); q.onsuccess = () => resolve(q.result.length); q.onerror = () => reject(q.error); }); }), 2);
    });
    await check(browser, 'account password hashes, salts and opaque encrypted fields are copied without reinterpretation', async ({ page }) => {
      const account = { username: 'synthetic-user', salt: 'synthetic salt', passwordHash: 'synthetic hash', rrnCipher: { version: 1, iv: 'opaque', ciphertext: 'synthetic only' }, empty: '', enabled: false };
      await seed(page, 'accounts', { rows: { users: [account, { username: 'newer-user', name: 'old' }] } });
      await seed(page, 'accounts', { primary: true, rows: { users: [{ username: 'newer-user', name: 'new', amount: 0 }] } });
      assert((await open(page, 'accounts')).ok);
      const data = (await inspect(page, 'accounts')).data.users;
      assert.deepEqual(data.find(r => r.username === account.username), account); assert.equal(data.find(r => r.username === 'newer-user').name, 'new');
    });
    await check(browser, 'customer owner index and complete row shape survive migration', async ({ page }) => {
      await seed(page, 'customers', { rows: { customers: [{ id: 'owner-a:car-a', ownerId: 'owner-a', carId: 'car-a', name: '가상 고객', amount: 0, empty: '', signature: { strokes: [[0, 1]] } }, { id: 'owner-b:car-a', ownerId: 'owner-b', carId: 'car-a' }] } });
      assert((await open(page, 'customers')).ok);
      const rows = await page.evaluate(async () => { const db = await SnoteIdbCompat.open('customers'); return new Promise((resolve, reject) => { const q = db.transaction('customers').objectStore('customers').index('ownerId').getAll('owner-a'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); }); });
      assert.equal(rows.length, 1); assert.equal(rows[0].name, '가상 고객'); assert.equal(rows[0].amount, 0); assert.equal(rows[0].empty, ''); assert.deepEqual(rows[0].signature, { strokes: [[0, 1]] });
    });
    await check(browser, 'a completed import never resurrects a primary deletion after close and reopen', async ({ page }) => {
      await seed(page, 'customers', { rows: { customers: [{ id: 'a:c', ownerId: 'a', carId: 'c' }] } }); assert((await open(page, 'customers')).ok);
      await page.evaluate(async () => { const db = await SnoteIdbCompat.open('customers'); await new Promise((resolve, reject) => { const tx = db.transaction('customers', 'readwrite'); tx.objectStore('customers').delete('a:c'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close(); });
      assert((await open(page, 'customers')).ok); assert.deepEqual((await inspect(page, 'customers')).data.customers, []); assert.equal((await inspect(page, 'customers', false)).data.customers.length, 1);
    });
    await check(browser, 'quota abort rolls back imported rows and marker, preserves both sources, and permits retry', async ({ page }) => {
      await seed(page, 'files', { rows: { media: [{ id: 'copy-a', carId: 'c' }, { id: 'fail-b', carId: 'c' }] } });
      await seed(page, 'files', { primary: true, rows: { media: [{ id: 'confirmed', carId: 'c', note: 'new' }] } });
      await page.evaluate(name => { const native = IDBObjectStore.prototype.add; window.__restoreAdd = () => { IDBObjectStore.prototype.add = native; }; IDBObjectStore.prototype.add = function (value, ...args) { if (this.transaction.db.name === name && value.id === 'fail-b') throw new DOMException('Synthetic capacity failure', 'QuotaExceededError'); return native.call(this, value, ...args); }; }, CONFIG.files.primary);
      const failed = await open(page, 'files'); assert.equal(failed.ok, false); assert.equal(failed.code, 'IDB_STORAGE_FULL');
      const before = await inspect(page, 'files'); assert.deepEqual(before.data.media.map(r => r.id), ['confirmed']); assert.deepEqual(before.data._snoteNamespace, []); assert.equal((await inspect(page, 'files', false)).data.media.length, 2);
      await page.evaluate(() => __restoreAdd()); assert((await open(page, 'files')).ok); assert.equal((await inspect(page, 'files')).data.media.length, 3);
    });
    await check(browser, 'marker-write abort cannot expose a half import and can retry', async ({ page }) => {
      await seed(page, 'accounts', { rows: { users: [{ username: 'first', salt: 's' }, { username: 'second', salt: 't' }] } });
      await page.evaluate(name => { const native = IDBObjectStore.prototype.put; window.__restorePut = () => { IDBObjectStore.prototype.put = native; }; IDBObjectStore.prototype.put = function (value, ...args) { if (this.transaction.db.name === name && this.name === '_snoteNamespace') throw new DOMException('Synthetic commit failure', 'AbortError'); return native.call(this, value, ...args); }; }, CONFIG.accounts.primary);
      assert.equal((await open(page, 'accounts')).ok, false); const data = (await inspect(page, 'accounts')).data; assert.deepEqual(data.users, []); assert.deepEqual(data._snoteNamespace, []);
      await page.evaluate(() => __restorePut()); assert((await open(page, 'accounts')).ok); assert.equal((await inspect(page, 'accounts')).data.users.length, 2);
    });
    await check(browser, 'an old held connection blocks cutover without partial copying; late upgrade callbacks are disarmed', async ({ page }) => {
      await seed(page, 'accounts', { rows: { users: [{ username: 'kept', salt: 's' }] }, hold: true });
      const failed = await open(page, 'accounts'); assert.equal(failed.code, 'IDB_OTHER_TAB_OPEN'); assert.deepEqual((await inspect(page, 'accounts')).data.users, []);
      await page.evaluate(() => { __heldSource.close(); __heldSource = null; });
      assert((await open(page, 'accounts')).ok); assert.equal((await inspect(page, 'accounts')).data.users.length, 1); assert.equal((await inspect(page, 'accounts', false)).version, 2);
      const oldOpen = await page.evaluate(async config => new Promise(resolve => { const r = indexedDB.open(config.legacy, config.oldVersion); r.onsuccess = () => { r.result.close(); resolve('unexpected-open'); }; r.onerror = () => resolve(r.error.name); }), CONFIG.accounts);
      assert.equal(oldOpen, 'VersionError');
    });
    await check(browser, 'simultaneous callers share one migration and native connection', async ({ page }) => {
      await seed(page, 'accounts', { rows: { users: [{ username: 'one' }] } });
      const value = await page.evaluate(async () => { const first = SnoteIdbCompat.open('accounts'), second = SnoteIdbCompat.open('accounts'); const samePromise = first === second, values = await Promise.all([first, second]); return { samePromise, sameDb: values[0] === values[1] }; });
      assert.deepEqual(value, { samePromise: true, sameDb: true }); assert.equal((await inspect(page, 'accounts')).data.users.length, 1);
    });
    await check(browser, 'a second tab cannot import a stale snapshot after another tab completes and deletes a row', async ({ page, addPage }) => {
      await seed(page, 'files', { rows: { media: [{ id: 'deleted-after-cutover', carId: 'c' }] } });
      const other = await addPage();
      await other.evaluate(legacy => {
        const native = IDBDatabase.prototype.transaction, descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
        window.__snapshotHeld = false;
        IDBDatabase.prototype.transaction = function (...args) {
          const tx = native.apply(this, args);
          if (this.name === legacy && args[1] === 'readonly' && tx.objectStoreNames.contains('media')) {
            Object.defineProperty(tx, 'oncomplete', { configurable: true, get() { return descriptor.get.call(tx); }, set(handler) { descriptor.set.call(tx, event => { __snapshotHeld = true; window.__releaseSnapshot = () => handler.call(tx, event); }); } });
          }
          return tx;
        };
        window.__secondImport = SnoteIdbCompat.open('files').then(db => ({ name: db.name }));
      }, CONFIG.files.legacy);
      await other.waitForFunction(() => __snapshotHeld);
      assert((await open(page, 'files')).ok);
      await page.evaluate(async () => { const db = await SnoteIdbCompat.open('files'); await new Promise((resolve, reject) => { const tx = db.transaction('media', 'readwrite'); tx.objectStore('media').delete('deleted-after-cutover'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); });
      await other.evaluate(async () => { __releaseSnapshot(); await __secondImport; });
      assert.deepEqual((await inspect(page, 'files')).data.media, []);
    });
    await check(browser, 'explicit native close reopens a live handle and external version changes produce a clear error', async ({ page }) => {
      await seed(page, 'accounts', { rows: { users: [{ username: 'kept' }] } }); assert((await open(page, 'accounts')).ok);
      const result = await page.evaluate(async () => { const first = await SnoteIdbCompat.open('accounts'); first.close(); const second = await SnoteIdbCompat.open('accounts'); window.__keptHandle = second; return { native: second instanceof IDBDatabase, different: first !== second, size: await new Promise(resolve => { const r = second.transaction('users').objectStore('users').count(); r.onsuccess = () => resolve(r.result); }) }; });
      assert.deepEqual(result, { native: true, different: true, size: 1 });
      await page.evaluate(async config => new Promise((resolve, reject) => { const r = indexedDB.open(config.primary, config.version + 1); r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error); }), CONFIG.accounts);
      assert.equal(await page.evaluate(() => { try { __keptHandle.transaction('users'); return null; } catch (error) { return error.code; } }), 'IDB_CONTEXT_CHANGED');
      assert.equal((await open(page, 'accounts')).code, 'IDB_CONTEXT_CHANGED');
    });
    await check(browser, 'unknown legacy schema is preserved and fails before a guessed copy', async ({ page }) => {
      await seed(page, 'files', { rows: { media: [{ id: 'kept' }], unknownPrivateStore: [{ id: 'private', opaque: 'preserve' }] }, extra: true });
      assert.equal((await open(page, 'files')).code, 'IDB_SCHEMA_CONFLICT'); const source = await inspect(page, 'files', false); assert.equal(source.version, 2); assert.equal(source.data.unknownPrivateStore.length, 1); assert.deepEqual((await inspect(page, 'files')).data.media, []);
    });
    await check(browser, 'a malformed confirmed marker cannot authorize a legacy read or import', async ({ page }) => {
      await seed(page, 'accounts', { rows: { users: [{ username: 'old' }] } }); assert((await open(page, 'accounts', { migrate: false })).ok);
      await page.evaluate(async () => { const db = await SnoteIdbCompat.open('accounts', { migrate: false }); await new Promise((resolve, reject) => { const tx = db.transaction('_snoteNamespace', 'readwrite'); tx.objectStore('_snoteNamespace').put({ key: 'migration', schemaVersion: 1, kind: 'customers', complete: true }); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); });
      assert.equal((await open(page, 'accounts')).code, 'IDB_SCHEMA_CONFLICT'); assert.equal((await inspect(page, 'accounts', false)).version, 1); assert.deepEqual((await inspect(page, 'accounts')).data.users, []);
    });
  } finally {
    await browser.close();
    const after = crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex');
    fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ passed: results.length === 14 && after === HASH, groups: results.length, syntheticOnly: true, liveRequests: 0, productSourceSha256: HASH, sourceUnchanged: after === HASH, results }, null, 2) + '\n');
  }
  assert.equal(results.length, 14);
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
