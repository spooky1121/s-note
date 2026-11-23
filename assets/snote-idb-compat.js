/* New databases use S-NOTE names. Historical names below are read-only import sources. */
(function (global) {
  'use strict';
  if (global.SnoteIdbCompat) return;

  const META = '_snoteNamespace', MARKER = 'migration', FENCE = 'cutover';
  const CONFIG = Object.freeze({
    files: { name: 's-note-office-v12-files', legacy: 'zerocar-office-v12-files', version: 3,
      stores: { media: { key: 'id', indexes: { carId: 'carId' } }, modelPhotos: { key: 'key' } } },
    accounts: { name: 's-note-office-v12-accounts', legacy: 'zerocar-office-v12-accounts', version: 2,
      stores: { users: { key: 'username' } } },
    customers: { name: 's-note-office-v172-customers', legacy: 'zerocar-office-v172-customers', version: 2,
      stores: { customers: { key: 'id', indexes: { ownerId: 'ownerId' } } } }
  });
  const states = new Map();
  function failure(code, cause) {
    const message = code === 'IDB_OTHER_TAB_OPEN'
      ? '다른 창의 S-NOTE를 닫거나 새로고침한 뒤 다시 시도해 주세요. 기존 자료는 그대로 보관되어 있습니다.'
      : code === 'IDB_STORAGE_FULL'
        ? '브라우저 저장 공간이 부족해 자료 이름 변경을 완료하지 못했습니다. 기존 자료는 그대로 보관되어 있으니 공간을 확보한 뒤 다시 시도해 주세요.'
        : code === 'IDB_CONTEXT_CHANGED'
          ? '다른 창에서 저장소 연결이 변경되었습니다. 현재 화면을 다시 열어 주세요.'
          : '브라우저 자료 연결을 완료하지 못했습니다. 기존 자료는 그대로 보관되어 있으니 다시 시도해 주세요.';
    const error = new Error(message, cause ? { cause } : undefined);
    error.code = code;
    return error;
  }
  function mapError(error) {
    if (typeof error?.code === 'string' && error.code.startsWith('IDB_')) return error;
    return failure(error?.name === 'QuotaExceededError' ? 'IDB_STORAGE_FULL'
      : error?.name === 'InvalidStateError' || error?.name === 'VersionError' ? 'IDB_CONTEXT_CHANGED'
        : 'IDB_MIGRATION_FAILED', error);
  }
  function stateFor(kind) {
    if (!Object.hasOwn(CONFIG, kind)) throw failure('IDB_UNKNOWN_DATABASE');
    if (!states.has(kind)) states.set(kind, { kind, config: CONFIG[kind], db: null, ready: false,
      primaryFlight: null, migrationFlight: null, phase: 'new', lastError: null });
    return states.get(kind);
  }
  function track(state, db) {
    const transaction = db.transaction.bind(db), close = db.close.bind(db);
    let closed = false;
    Object.defineProperty(db, 'transaction', { configurable: true, writable: true, value(...args) {
      if (closed) throw failure('IDB_CONTEXT_CHANGED');
      return transaction(...args);
    } });
    Object.defineProperty(db, 'close', { configurable: true, writable: true, value() {
      if (closed) return;
      closed = true; close();
      if (state.db === db) { state.db = null; state.ready = false; }
    } });
    db.addEventListener('versionchange', () => {
      db.close(); state.lastError = 'IDB_CONTEXT_CHANGED';
      if (typeof global.CustomEvent === 'function') global.dispatchEvent?.(new global.CustomEvent('snote:idb-context-changed',
        { detail: { kind: state.kind, code: 'IDB_CONTEXT_CHANGED' } }));
    });
    return db;
  }
  function schema(db, transaction, config) {
    for (const [name, spec] of Object.entries(config.stores)) {
      const store = db.objectStoreNames.contains(name) ? transaction.objectStore(name) : db.createObjectStore(name, { keyPath: spec.key });
      if (store.keyPath !== spec.key) throw failure('IDB_SCHEMA_CONFLICT');
      for (const [index, key] of Object.entries(spec.indexes || {})) {
        if (!store.indexNames.contains(index)) store.createIndex(index, key, { unique: false });
        else if (store.index(index).keyPath !== key || store.index(index).unique) throw failure('IDB_SCHEMA_CONFLICT');
      }
    }
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
  }
  function ensurePrimary(state) {
    if (state.db) return Promise.resolve(state.db);
    if (state.primaryFlight) return state.primaryFlight;
    state.primaryFlight = new Promise((resolve, reject) => {
      let request, cancelled = false, problem;
      try { request = global.indexedDB.open(state.config.name, state.config.version); }
      catch (error) { reject(mapError(error)); return; }
      request.onblocked = () => { cancelled = true; reject(failure('IDB_OTHER_TAB_OPEN')); };
      request.onupgradeneeded = () => {
        if (cancelled) { request.transaction.abort(); return; }
        try { schema(request.result, request.transaction, state.config); }
        catch (error) { problem = error; request.transaction.abort(); }
      };
      request.onerror = () => reject(mapError(problem || request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (cancelled) { db.close(); return; }
        state.db = track(state, db); resolve(state.db);
      };
    }).finally(() => { state.primaryFlight = null; });
    return state.primaryFlight;
  }
  function readMarker(db) {
    return new Promise((resolve, reject) => {
      let transaction, result;
      try {
        transaction = db.transaction(META, 'readonly');
        const request = transaction.objectStore(META).get(MARKER);
        request.onsuccess = () => { result = request.result; };
      } catch (error) { reject(mapError(error)); return; }
      transaction.oncomplete = () => resolve(result || null);
      transaction.onabort = transaction.onerror = () => reject(mapError(transaction.error));
    });
  }
  // Aborting first creation distinguishes absence without leaving an empty old database.
  function existingLegacy(config) {
    return new Promise((resolve, reject) => {
      let request, absent = false;
      try { request = global.indexedDB.open(config.legacy); }
      catch (error) { reject(mapError(error)); return; }
      request.onupgradeneeded = event => {
        if (event.oldVersion === 0) { absent = true; request.transaction.abort(); }
      };
      request.onerror = () => absent ? resolve(null) : reject(mapError(request.error));
      request.onsuccess = () => {
        const db = request.result;
        db.addEventListener('versionchange', () => db.close());
        resolve(db);
      };
    });
  }
  function readFence(db) {
    if (!db.objectStoreNames.contains(META)) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      let transaction, result;
      try {
        transaction = db.transaction(META, 'readonly');
        const request = transaction.objectStore(META).get(FENCE);
        request.onsuccess = () => { result = request.result; };
      } catch (error) { reject(mapError(error)); return; }
      transaction.oncomplete = () => resolve(result || null);
      transaction.onabort = transaction.onerror = () => reject(mapError(transaction.error));
    });
  }
  async function fenceLegacy(config) {
    const existing = await existingLegacy(config);
    if (!existing) return null;
    let fence;
    try {
      fence = await readFence(existing);
      for (const name of existing.objectStoreNames) {
        if (name !== META && !Object.hasOwn(config.stores, name)) throw failure('IDB_SCHEMA_CONFLICT');
      }
      if (fence && (fence.schemaVersion !== 1 || fence.target !== config.name)) throw failure('IDB_SCHEMA_CONFLICT');
      if (fence) return existing;
    } catch (error) { existing.close(); throw error; }
    const version = existing.version + 1;
    existing.close();
    return new Promise((resolve, reject) => {
      let request, cancelled = false, problem;
      try { request = global.indexedDB.open(config.legacy, version); }
      catch (error) { reject(mapError(error)); return; }
      // A pending IDBOpenDBRequest cannot be cancelled. Disarm every late callback.
      request.onblocked = () => { cancelled = true; reject(failure('IDB_OTHER_TAB_OPEN')); };
      request.onupgradeneeded = () => {
        if (cancelled) { request.transaction.abort(); return; }
        try {
          const db = request.result, store = db.objectStoreNames.contains(META)
            ? request.transaction.objectStore(META) : db.createObjectStore(META, { keyPath: 'key' });
          store.put({ key: FENCE, schemaVersion: 1, target: config.name });
        } catch (error) { problem = error; request.transaction.abort(); }
      };
      request.onerror = () => reject(mapError(problem || request.error));
      request.onsuccess = () => {
        const db = request.result;
        if (cancelled) { db.close(); return; }
        db.addEventListener('versionchange', () => db.close());
        resolve(db);
      };
    });
  }
  function snapshot(db, config) {
    const stores = Object.keys(config.stores).filter(name => db.objectStoreNames.contains(name));
    if (!stores.length) return Promise.resolve({ version: db.version, rows: {} });
    return new Promise((resolve, reject) => {
      const rows = {};
      let transaction, problem;
      try {
        transaction = db.transaction(stores, 'readonly');
        for (const name of stores) {
          const store = transaction.objectStore(name);
          if (store.keyPath !== config.stores[name].key) throw failure('IDB_SCHEMA_CONFLICT');
          rows[name] = [];
          const request = store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) { rows[name].push({ key: cursor.primaryKey, value: cursor.value }); cursor.continue(); }
          };
        }
      } catch (error) {
        problem = error;
        try { transaction?.abort(); } catch (_) { /* No transaction started. */ }
        reject(mapError(error)); return;
      }
      transaction.oncomplete = () => resolve({ version: db.version, rows });
      transaction.onabort = transaction.onerror = () => reject(mapError(problem || transaction.error));
    });
  }
  function commitSnapshot(db, kind, data) {
    return new Promise((resolve, reject) => {
      let transaction, problem;
      try {
        transaction = db.transaction([...Object.keys(CONFIG[kind].stores), META], 'readwrite');
        const meta = transaction.objectStore(META), marker = meta.get(MARKER);
        marker.onsuccess = () => {
          // A second tab may have completed the copy after our earlier read.
          // Recheck under this transaction's locks before importing any old row.
          const current = marker.result;
          if (current && (current.schemaVersion !== 1 || current.kind !== kind ||
              ![true, false].includes(current.complete))) {
            problem = failure('IDB_SCHEMA_CONFLICT'); transaction.abort(); return;
          }
          if (current?.complete === true) return;
          try {
            for (const [name, records] of Object.entries(data.rows)) {
              const store = transaction.objectStore(name);
              for (const record of records) {
                const request = store.count(record.key);
                request.onsuccess = () => {
                  if (request.result !== 0) return; // Existing primary values always win, including empty fields and zero.
                  try { store.add(record.value); }
                  catch (error) { problem = error; transaction.abort(); }
                };
              }
            }
            meta.put({ key: MARKER, schemaVersion: 1, kind, complete: true,
              sourceVersion: data.version, migratedAt: Date.now() });
          } catch (error) { problem = error; transaction.abort(); }
        };
      } catch (error) {
        problem = error;
        try { transaction?.abort(); } catch (_) { /* No transaction started. */ }
        reject(mapError(error)); return;
      }
      transaction.addEventListener('error', event => {
        if (!problem || problem.name === 'AbortError') problem = event.target?.error || problem;
      });
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(mapError(problem || transaction.error));
    });
  }
  function open(kind, options = {}) {
    let state;
    try { state = stateFor(kind); } catch (error) { return Promise.reject(error); }
    if (options.migrate === false) return ensurePrimary(state);
    if (state.migrationFlight) return state.migrationFlight;
    state.migrationFlight = (async () => {
      const db = await ensurePrimary(state), marker = await readMarker(db);
      if (marker) {
        if (marker.schemaVersion !== 1 || marker.kind !== kind || ![true, false].includes(marker.complete)) throw failure('IDB_SCHEMA_CONFLICT');
      }
      if (marker?.complete === true) {
        state.ready = true; state.phase = 'ready'; state.lastError = null; return db;
      }
      state.phase = 'migrating';
      let legacy;
      try {
        legacy = await fenceLegacy(state.config);
        const data = legacy ? await snapshot(legacy, state.config) : { version: null, rows: {} };
        await commitSnapshot(db, kind, data);
        state.ready = true; state.phase = 'ready'; state.lastError = null;
        return db;
      } finally { legacy?.close(); }
    })().catch(error => {
      const mapped = mapError(error); state.phase = 'retry'; state.lastError = mapped.code; throw mapped;
    }).finally(() => { state.migrationFlight = null; });
    return state.migrationFlight;
  }
  function close(kind) {
    const state = stateFor(kind);
    state.db?.close(); state.ready = false;
  }
  global.SnoteIdbCompat = Object.freeze({ open, close,
    names: Object.freeze(Object.fromEntries(Object.entries(CONFIG).map(([kind, config]) => [kind, config.name]))),
    inspect(kind) { const state = stateFor(kind); return { name: state.config.name, phase: state.phase,
      ready: state.ready, connected: !!state.db, lastError: state.lastError }; }
  });
})(typeof window === 'undefined' ? globalThis : window);
