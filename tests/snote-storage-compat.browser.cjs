'use strict';
// Real Storage and two tabs, with the actual compatibility module and synthetic values.
// No production app, database, network service, identity or business record is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('./encar/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'https://storage-compat.example';
const OUT = process.env.STORAGE_COMPAT_ARTIFACT_DIR || '/workspace/work/storage-namespace-v2201/storage-compat';
const FILE = path.join(ROOT, 'assets/snote-storage-compat.js');
const results = [];
const sourceHash = () => crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex');

async function boot(page) {
  await page.goto(ORIGIN);
  await page.evaluate(() => {
    const C = SnoteStorageCompat;
    window.__raw = { getItem: Storage.prototype.getItem, setItem: Storage.prototype.setItem, removeItem: Storage.prototype.removeItem };
    const before = { get: Storage.prototype.getItem, set: Storage.prototype.setItem };
    C.installRemovalGuard({ StorageClass: Storage, localStorage, sessionStorage, nativeOps: __raw });
    window.__nativeUnchanged = before.get === Storage.prototype.getItem && before.set === Storage.prototype.setItem;
    window.__local = C.createAdapter(localStorage, { nativeOps: __raw });
    window.__session = C.createAdapter(sessionStorage, { nativeOps: __raw });
    window.__queued = [];
    Storage.prototype.setItem = function (key, value) {
      __raw.setItem.call(this, key, value);
      if (this === localStorage && C.describe(key)?.primary === key) __queued.push(key);
    };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const before = sourceHash();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const context = await browser.newContext();
  let outbound = 0;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, ORIGIN, 'Real outbound networking is prohibited'); outbound++;
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="/compat.js"></script><title>S-NOTE storage fixture</title>' });
    if (url.pathname === '/compat.js') return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(FILE, 'utf8') });
    return route.fulfill({ status: 204, body: '' });
  });
  const a = await context.newPage(), b = await context.newPage();
  try {
    await boot(a); await boot(b);
    assert(await a.evaluate(() => __nativeUnchanged));
    results.push({ case: 'only removeItem is wrapped; get/set remain native before application hooks', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.primaryKey('cars', 'synthetic_dealer'), old = C.legacyKey(key);
      __raw.setItem.call(localStorage, old, '[{"id":"legacy-owned"}]');
      const before = localStorage.length;
      const read = __local.readLocal(key, { mode: 'local', owner: 'synthetic_dealer', validate: raw => Array.isArray(JSON.parse(raw)) });
      return { read, copied: localStorage.getItem(key), sameLength: localStorage.length === before, queued: __queued.length };
    }), { read: '[{"id":"legacy-owned"}]', copied: null, sameLength: true, queued: 0 });
    results.push({ case: 'legacy personal data is readable without a copy or cloud write', passed: true });

    await a.evaluate(() => localStorage.setItem(SnoteStorageCompat.primaryKey('cars', 'synthetic_dealer'), '[{"id":"current-primary"}]'));
    await b.evaluate(() => {
      const C = SnoteStorageCompat, key = C.primaryKey('cars', 'synthetic_dealer');
      __raw.setItem.call(localStorage, C.legacyKey(key), '[{"id":"stale-other-tab"}]');
    });
    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.primaryKey('cars', 'synthetic_dealer');
      return { value: __local.readLocal(key, { mode: 'local', owner: 'synthetic_dealer' }), queued: __queued.length };
    }), { value: '[{"id":"current-primary"}]', queued: 1 });
    results.push({ case: 'a stale tab writing only the old alias cannot overwrite a new primary', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.primaryKey('cars', 'synthetic_dealer');
      localStorage.removeItem(key);
      return { value: __local.readLocal(key, { mode: 'local', owner: 'synthetic_dealer' }), retained: localStorage.getItem(C.legacyKey(key)), queued: __queued.length };
    }), { value: null, retained: '[{"id":"stale-other-tab"}]', queued: 1 });
    await b.evaluate(() => __raw.setItem.call(localStorage, SnoteStorageCompat.legacyKey(SnoteStorageCompat.primaryKey('cars', 'synthetic_dealer')), '[{"id":"late-old-tab"}]'));
    await boot(a);
    assert.equal(await a.evaluate(() => __local.readLocal(SnoteStorageCompat.primaryKey('cars', 'synthetic_dealer'), { mode: 'local', owner: 'synthetic_dealer' })), null);
    results.push({ case: 'primary deletion suppression survives reload and late old-tab writes without deleting old data', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.primaryKey('cars', 'synthetic_dealer'), other = C.primaryKey('cars', 'synthetic_other');
      __raw.setItem.call(localStorage, C.legacyKey(other), '[{"id":"other-owner"}]');
      localStorage.setItem(key, '[]');
      const value = __local.readLocal(key, { mode: 'local', owner: 'synthetic_dealer' });
      localStorage.removeItem(key);
      return { value, other: __local.readLocal(other, { mode: 'local', owner: 'synthetic_other' }) };
    }), { value: '[]', other: '[{"id":"other-owner"}]' });
    results.push({ case: 'explicit empty primary wins and deleting one owner does not affect another', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.keys.finance, old = C.legacyKey(key);
      __raw.setItem.call(localStorage, old, '[{"company":"unverified-old-cache"}]');
      let refused = false; try { __local.readLocal(key, { mode: 'local' }); } catch (_) { refused = true; }
      const before = localStorage.length;
      const recovery = __local.readRecovery({ dataset: 'finance', ownerId: '00000000-0000-0000-0000-000000000000', storageKey: old });
      localStorage.setItem(key, '[{"company":"verified-current-snapshot"}]');
      const conflict = __local.readRecovery({ dataset: 'finance', ownerId: '00000000-0000-0000-0000-000000000000', storageKey: old });
      return { refused, originalMissingPrimary: recovery.primaryRaw, rawAvailable: recovery.raw !== null,
        noCopy: localStorage.length === before + 1, conflict: conflict.primaryConflict, oldRetained: localStorage.getItem(old) === recovery.raw };
    }), { refused: true, originalMissingPrimary: null, rawAvailable: true, noCopy: true, conflict: true, oldRetained: true });
    results.push({ case: 'shared old finance is recovery-only and a conflicting current company snapshot stays separate', passed: true });

    assert.equal(await a.evaluate(() => {
      const C = SnoteStorageCompat, owner = 'cld_111111111111411181', key = C.primaryKey('cars', owner);
      __raw.setItem.call(localStorage, C.legacyKey(key), '[{"id":"unverified-cloud-owner"}]');
      return __local.readLocal(key, { mode: 'local', owner });
    }), null);
    results.push({ case: 'hosted owner aliases cannot restore unverified local legacy caches', passed: true });

    await a.evaluate(() => { const C = SnoteStorageCompat; __raw.setItem.call(sessionStorage, C.legacyKey(C.keys.session), 'synthetic_a'); sessionStorage.setItem(C.keys.session, 'synthetic_a'); });
    await b.evaluate(() => { const C = SnoteStorageCompat; __raw.setItem.call(sessionStorage, C.legacyKey(C.keys.session), 'synthetic_b'); sessionStorage.setItem(C.keys.session, 'synthetic_b'); });
    await a.evaluate(() => sessionStorage.removeItem(SnoteStorageCompat.keys.session));
    await a.evaluate(() => __raw.setItem.call(sessionStorage, SnoteStorageCompat.legacyKey(SnoteStorageCompat.keys.session), 'synthetic_a'));
    await boot(a);
    assert.equal(await a.evaluate(() => __session.readLocal(SnoteStorageCompat.keys.session, { mode: 'local' })), null);
    assert.equal(await b.evaluate(() => __session.readPrimary(SnoteStorageCompat.keys.session)), 'synthetic_b');
    results.push({ case: 'logout suppresses old session restoration after reload without touching the other tab session', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.keys.session;
      __raw.removeItem.call(sessionStorage, C.markerKey(key));
      __raw.setItem.call(sessionStorage, C.legacyKey(key), 'synthetic_quota_legacy');
      __raw.setItem.call(sessionStorage, key, 'synthetic_quota_primary');
      const adapter = C.createAdapter(sessionStorage, { nativeOps: { ...__raw, setItem() { throw new Error('Synthetic zero quota'); } } });
      adapter.clearSession();
      return { primary: sessionStorage.getItem(key), legacy: sessionStorage.getItem(C.legacyKey(key)), marker: sessionStorage.getItem(C.markerKey(key)) };
    }), { primary: null, legacy: null, marker: null });
    results.push({ case: 'zero write quota still clears both session hints and lets logout finish', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.primaryKey('cars', 'synthetic_quota');
      __raw.setItem.call(localStorage, key, '[{"id":"retained-current"}]');
      const adapter = C.createAdapter(localStorage, { nativeOps: { ...__raw, setItem(name, value) {
        if (name === C.markerKey(key)) throw new Error('Synthetic quota failure');
        return __raw.setItem.call(this, name, value);
      } } });
      let refused = false; try { adapter.removePrimary(key); } catch (_) { refused = true; }
      return { refused, retained: localStorage.getItem(key) };
    }), { refused: true, retained: '[{"id":"retained-current"}]' });
    results.push({ case: 'quota failure cannot delete the primary before its suppression marker is durable', passed: true });

    assert.deepEqual(await a.evaluate(() => {
      const C = SnoteStorageCompat, key = C.keys.session;
      sessionStorage.setItem(key, 'synthetic_explicit_new_login');
      __raw.setItem.call(sessionStorage, C.legacyKey(key), 'synthetic_stale_session');
      const explicit = __session.readLocal(key, { mode: 'local' });
      sessionStorage.removeItem(C.legacyKey(key));
      return { explicit, primary: sessionStorage.getItem(key), legacy: sessionStorage.getItem(C.legacyKey(key)) };
    }), { explicit: 'synthetic_explicit_new_login', primary: null, legacy: null });
    results.push({ case: 'explicit new login wins and either logout hint removes both session formats', passed: true });
  } finally {
    await browser.close();
    const receipt = { passed: results.length === 11, syntheticOnly: true, results, sourceHash: before,
      sourceUnchanged: before === sourceHash(), realNetworkRequests: 0, fixtureRequests: outbound,
      operationalDatabaseRequests: 0, actualSmsSent: 0 };
    fs.writeFileSync(path.join(OUT, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
  assert.equal(results.length, 11);
  for (const result of results) console.log('PASS ' + result.case);
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
