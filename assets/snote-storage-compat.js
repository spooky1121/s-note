/* Storage aliases are read-only compatibility, never current company authority.
 * New writes use s-note keys. Old values stay intact for explicit recovery.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnoteStorageCompat = api;
})(globalThis, function () {
  'use strict';

  const keys = Object.freeze({
    carsPrefix: 's-note-office-v12-cars-',
    coversPrefix: 's-note-office-v12-covers-',
    session: 's-note-office-v12-session',
    companyOptions: 's-note-office-v12-company-options',
    unionOptions: 's-note-office-v12-union-options',
    finance: 's-note-office-v182-inventory-finance-ledger',
    financeLimits: 's-note-office-v157-finance-companies',
    prestock: 's-note-office-v148-prestock-ledger',
    prestockPrevious: 's-note-office-v147-prestock-entries',
    monthly: 's-note-office-v165-monthly-ledger',
    categories: 's-note-office-v170-monthly-category-settings'
  });
  // Explicit old names are confined to this compatibility boundary. Do not
  // encode or rename these bytes: old cache/recovery records refer to them.
  const old = Object.freeze({
    carsPrefix: 'zerocar-office-v12-cars-',
    coversPrefix: 'zerocar-office-v12-covers-',
    session: 'zerocar-office-v12-session',
    companyOptions: 'zerocar-office-v12-company-options',
    unionOptions: 'zerocar-office-v12-union-options',
    finance: 'zerocar-office-v182-inventory-finance-ledger',
    financeLimits: 'zerocar-office-v157-finance-companies',
    prestock: 'zerocar-office-v148-prestock-ledger',
    prestockPrevious: 'zerocar-office-v147-prestock-entries',
    monthly: 'zerocar-office-v165-monthly-ledger',
    categories: 'zerocar-office-v170-monthly-category-settings'
  });
  const legacyCryptoSaltPrefix = 'ZEROCAR-RRN-v180:';
  const legacyMonthlyHeight = 'ZEROCAR_MONTHLY_HEIGHT';
  const personal = new Set(['carsPrefix', 'coversPrefix']);
  const shared = new Set(['finance', 'financeLimits', 'prestock', 'prestockPrevious', 'monthly', 'categories']);
  const MARKER = 's-note-storage-compat:v1:suppressed:';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const NIL = '00000000-0000-0000-0000-000000000000';
  const hostedAlias = /^cld_[0-9a-f]{18}$/i;
  const removalGuards = new WeakMap();

  function describe(value) {
    if (typeof value !== 'string') return null;
    for (const name of Object.keys(keys)) {
      if (personal.has(name)) {
        for (const prefix of [keys[name], old[name]]) {
          if (!value.startsWith(prefix) || value.length === prefix.length) continue;
          const owner = value.slice(prefix.length);
          return { primary: keys[name] + owner, legacy: old[name] + owner,
            kind: 'personal', dataset: name === 'carsPrefix' ? 'cars' : 'covers', owner };
        }
      } else if (value === keys[name] || value === old[name]) {
        return { primary: keys[name], legacy: old[name], name,
          kind: shared.has(name) ? 'shared' : name === 'session' ? 'session' : 'options' };
      }
    }
    return null;
  }
  const canonicalKey = key => describe(key)?.primary || key;
  const legacyKey = key => describe(key)?.legacy || null;
  const markerKey = key => MARKER + encodeURIComponent(canonicalKey(key));
  const recoveryNames = Object.freeze({ finance: 'finance', finance_limits: 'financeLimits',
    prestock: 'prestock', monthly: 'monthly', categories: 'categories' });

  function primaryKey(dataset, owner) {
    if (dataset === 'cars' || dataset === 'covers') {
      if (typeof owner !== 'string' || !owner) throw new TypeError('Storage owner is required');
      return keys[dataset === 'cars' ? 'carsPrefix' : 'coversPrefix'] + owner;
    }
    const name = recoveryNames[dataset];
    if (!name) throw new TypeError('Unknown storage dataset');
    return keys[name];
  }
  function acceptsRecoveryKey(dataset, ownerId, storageKey) {
    if (typeof ownerId !== 'string' || !UUID.test(ownerId)) return false;
    const owner = ownerId.toLowerCase(), isPersonal = dataset === 'cars' || dataset === 'covers';
    if (isPersonal ? owner === NIL : owner !== NIL) return false;
    let primary;
    try { primary = primaryKey(dataset, isPersonal ? 'cld_' + owner.replace(/-/g, '').slice(0, 18) : null); }
    catch (_) { return false; }
    return storageKey === primary || storageKey === legacyKey(primary);
  }

  function createAdapter(storage, options = {}) {
    if (!storage) throw new TypeError('Storage is unavailable');
    const methods = options.nativeOps || {};
    const operation = name => {
      const fn = methods[name] || storage[name];
      if (typeof fn !== 'function') throw new TypeError('Storage operation is unavailable');
      return fn.bind(storage);
    };
    // Capture original operations before the application's autosave wrappers.
    // Compatibility reads must never schedule a server write.
    const get = operation('getItem'), set = operation('setItem'), remove = operation('removeItem');
    function checked(key) {
      const description = describe(key);
      if (description && description.primary !== key) throw new TypeError('Storage aliases are read only');
      return description;
    }
    function suppress(key) {
      const marker = markerKey(key);
      if (get(marker) !== '1') set(marker, '1');
      if (get(marker) !== '1') throw new Error('Storage removal marker was not saved');
    }
    function readPrimary(key) { checked(key); return get(key); }
    function readLocal(key, context = {}) {
      const description = checked(key);
      // Finance/monthly caches have no company identity in their key. Only the
      // existing pinned hash/revision recovery path may inspect their aliases.
      if (description?.kind === 'shared') throw new Error('Shared cache requires verified recovery');
      const value = get(key);
      if (value !== null || !description || get(markerKey(key)) !== null) return value;
      if (context.mode !== 'local') return null;
      if (description.kind === 'personal' &&
          (context.owner !== description.owner || hostedAlias.test(description.owner))) return null;
      const previous = get(description.legacy);
      if (previous === null) return null;
      if (typeof context.validate === 'function') {
        try { if (context.validate(previous) !== true) return null; }
        catch (_) { return null; }
      }
      // No eager copy, merge, deletion, or cross-tab CAS claim. The first normal
      // save (or authenticated cloud hydration) writes only the new primary.
      return previous;
    }
    function writePrimary(key, value) {
      checked(key);
      set(key, String(value));
    }
    function removePrimary(key) {
      const description = checked(key);
      if (description) suppress(key); // Fail before deleting if this cannot persist.
      remove(key);
    }
    function clearSession() {
      // Session hints are not business data. Explicit logout invalidates both
      // formats so even an old cached client cannot restore the local session.
      remove(old.session);
      remove(keys.session);
      // Quota must not prevent logout. Removing both hints is authoritative;
      // suppression additionally protects against an old same-tab writer.
      try { suppress(keys.session); } catch (_) { /* Both hints are already gone. */ }
    }
    function readRecovery(entry) {
      if (!entry || !acceptsRecoveryKey(entry.dataset, entry.ownerId, entry.storageKey)) {
        throw new TypeError('Invalid recovery storage key');
      }
      const primary = canonicalKey(entry.storageKey), raw = get(entry.storageKey);
      const primaryRaw = entry.storageKey === primary ? raw : get(primary);
      const suppressed = entry.storageKey !== primary && primaryRaw === null && get(markerKey(primary)) !== null;
      // Caller must retain project/user/company/hash/revision checks. Merely
      // finding an alias never authorizes hydration or a database write.
      return { key: entry.storageKey, raw, primaryKey: primary, primaryRaw,
        primaryConflict: entry.storageKey !== primary && (suppressed || primaryRaw !== null && primaryRaw !== raw) };
    }
    return Object.freeze({ readPrimary, readLocal, writePrimary, removePrimary, clearSession, readRecovery });
  }

  function installRemovalGuard(options = {}) {
    const StorageClass = options.StorageClass || globalThis.Storage;
    const prototype = StorageClass?.prototype;
    if (!prototype) return Object.freeze({ installed: false });
    if (removalGuards.has(prototype)) return removalGuards.get(prototype);
    const local = options.localStorage || globalThis.localStorage;
    const session = options.sessionStorage || globalThis.sessionStorage;
    const native = options.nativeOps || {};
    const getItem = native.getItem || prototype.getItem;
    const setItem = native.setItem || prototype.setItem;
    const removeItem = native.removeItem || prototype.removeItem;
    if (![getItem, setItem, removeItem].every(fn => typeof fn === 'function')) {
      throw new TypeError('Storage operations are unavailable');
    }
    const raw = { getItem, setItem, removeItem };
    const localAdapter = local ? createAdapter(local, { nativeOps: raw }) : null;
    const sessionAdapter = session ? createAdapter(session, { nativeOps: raw }) : null;
    function guardedRemoveItem(value) {
      const key = String(value), description = describe(key);
      const adapter = this === local ? localAdapter : this === session ? sessionAdapter : null;
      if (!adapter || !description) return removeItem.call(this, key);
      if (description.kind === 'session') return adapter.clearSession();
      return adapter.removePrimary(key);
    }
    prototype.removeItem = guardedRemoveItem;
    if (prototype.removeItem !== guardedRemoveItem) throw new Error('Storage removal guard was not installed');
    const result = Object.freeze({ installed: true, restore() {
      if (prototype.removeItem === guardedRemoveItem) prototype.removeItem = removeItem;
      if (removalGuards.get(prototype) === result) removalGuards.delete(prototype);
    } });
    removalGuards.set(prototype, result);
    return result;
  }

  return Object.freeze({ keys, canonicalKey, legacyKey, describe, markerKey, primaryKey,
    acceptsRecoveryKey, legacyCryptoSaltPrefix, legacyMonthlyHeight, createAdapter, installRemovalGuard });
});
