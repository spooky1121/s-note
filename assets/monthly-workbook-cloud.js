import { TYPE, VERSION, validateBook, listBooks, mergeMonth, fingerprint } from './monthly-workbook-model.js';

const MAX_ATTEMPTS = 3;
const MESSAGES = {
  NETWORK: '서버 저장 결과를 확인하지 못했습니다. 입력 내용을 유지하고 다시 시도해 주세요.',
  CONFLICT: '같은 월의 서버 자료가 변경되었습니다. 현재 입력과 서버 자료를 확인해 주세요.',
  CONTEXT_CHANGED: '로그인 또는 회사 연결이 변경되었습니다. 현재 화면을 다시 열어 주세요.',
  INVALID_DATA: '월정산 자료 형식을 확인해 주세요. 기존 자료는 변경하지 않았습니다.',
  FORBIDDEN: '월정산을 저장할 권한이 없습니다.'
};
class StoreError extends Error {
  constructor(code, details = {}) { super(MESSAGES[code]); this.code = code; Object.assign(this, details); }
}
function error(code, details) { return new StoreError(code, details); }
function clone(value) { return structuredClone(value); }
function externalError(value) {
  if (value instanceof StoreError) return value;
  const code = ['CONTEXT_CHANGED', 'INVALID_DATA', 'FORBIDDEN'].includes(value?.code) ? value.code : 'NETWORK';
  return error(code);
}
function casConflict(value) { return value?.code === 'RPC_CONFLICT' || value?.code === 'CONFLICT' || /\bCONFLICT\b/i.test(String(value?.message || '')); }
function businessBook(book) {
  const checked = validateBook(book);
  if (!checked?.ok) throw error('INVALID_DATA');
  const result = clone(checked.book);
  delete result.updatedAt; delete result.writeId;
  return result;
}
function rawMonth(payload, month) { return payload.find(record => record?.type === TYPE && record.version === VERSION && record.month === month) || null; }
function validatePayload(payload) {
  if (!Array.isArray(payload)) throw error('INVALID_DATA');
  try { listBooks(payload); } catch { throw error('INVALID_DATA'); }
}

/** The adapter owns authentication, RPCs and the current company/frame identity. */
export function createMonthlyStore(adapter) {
  if (!adapter || ['read', 'write', 'currentKey', 'onCommitted'].some(name => typeof adapter[name] !== 'function')) throw error('INVALID_DATA');
  let tail = Promise.resolve();
  function captureKey() {
    let key;
    try { key = adapter.currentKey(); } catch { throw error('CONTEXT_CHANGED'); }
    if (typeof key !== 'string' || !key) throw error('CONTEXT_CHANGED');
    return key;
  }
  function check(key) { let current; try { current = adapter.currentKey(); } catch { throw error('CONTEXT_CHANGED'); } if (current !== key) throw error('CONTEXT_CHANGED'); }
  async function checked(key, operation) {
    check(key);
    try { const result = await operation(); check(key); return result; }
    catch (failure) { check(key); throw failure; }
  }
  async function fp(key, record) {
    try { return await checked(key, () => fingerprint(record)); }
    catch (failure) { if (failure?.code === 'CONTEXT_CHANGED') throw failure; throw error('INVALID_DATA'); }
  }
  async function readLatest(key) {
    let result;
    try { result = await checked(key, () => adapter.read()); }
    catch (failure) { throw externalError(failure); }
    if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0) throw error('INVALID_DATA');
    let payload;
    try { payload = clone(result.payload); validatePayload(payload); }
    catch { throw error('INVALID_DATA'); }
    return { payload, revision: result.revision };
  }
  async function conflict(key, record) {
    const baseVersion = await fp(key, record);
    check(key);
    return error('CONFLICT', { remoteBook: clone(record), baseVersion });
  }
  async function matchingWrite(key, record, request) {
    if (!record || record.writeId !== request.requestId) return false;
    const version = await fp(key, businessBook(record));
    check(key);
    return version === request.businessVersion;
  }
  async function committed(key, payload, revision, record) {
    const baseVersion = await fp(key, record);
    try { await checked(key, () => adapter.onCommitted(clone(payload), revision)); }
    catch (failure) { throw externalError(failure); }
    check(key);
    return { state: 'saved', book: clone(record), baseVersion, revision };
  }
  async function recoverWrite(key, request, fallbackCode) {
    const remote = await readLatest(key);
    const record = rawMonth(remote.payload, request.month);
    if (record?.writeId === request.requestId) {
      if (await matchingWrite(key, record, request)) return committed(key, remote.payload, remote.revision, record);
      throw await conflict(key, record);
    }
    if (await fp(key, record) !== request.baseVersion || fallbackCode === 'CONFLICT') throw await conflict(key, record);
    throw error('NETWORK');
  }
  async function saveRequest(key, request) {
    check(key);
    request.businessVersion = await fp(key, request.book);
    const desired = { ...request.book, updatedAt: new Date().toISOString(), writeId: request.requestId };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const remote = await readLatest(key);
      const record = rawMonth(remote.payload, request.month);
      if (record?.writeId === request.requestId) {
        if (await matchingWrite(key, record, request)) return committed(key, remote.payload, remote.revision, record);
        throw await conflict(key, record);
      }
      if (await fp(key, record) !== request.baseVersion) throw await conflict(key, record);
      let payload;
      try { payload = mergeMonth(remote.payload, clone(desired)); validatePayload(payload); }
      catch { throw error('INVALID_DATA'); }
      const persisted = rawMonth(payload, request.month);
      if (!persisted || persisted.writeId !== request.requestId) throw error('INVALID_DATA');
      let revision;
      try {
        revision = await checked(key, () => adapter.write(clone(payload), remote.revision));
      } catch (failure) {
        if (failure?.code === 'CONTEXT_CHANGED') throw failure;
        if (['FORBIDDEN', 'INVALID_DATA'].includes(failure?.code)) throw externalError(failure);
        if (casConflict(failure)) {
          if (attempt + 1 < MAX_ATTEMPTS) continue;
          return recoverWrite(key, request, 'CONFLICT');
        }
        return recoverWrite(key, request, 'NETWORK');
      }
      // A malformed acknowledgement is uncertain, not proof that nothing saved.
      if (!Number.isSafeInteger(revision) || revision <= remote.revision) return recoverWrite(key, request, 'NETWORK');
      return committed(key, payload, revision, persisted);
    }
    throw error('NETWORK');
  }
  return {
    async load() {
      const key = captureKey();
      const remote = await readLatest(key);
      const versions = {};
      for (const record of remote.payload) {
        if (record?.type === TYPE && record.version === VERSION) versions[record.month] = await fp(key, record);
      }
      check(key);
      return { ...remote, versions };
    },
    save(input) {
      let key, request;
      try {
        key = captureKey();
        if (!input || typeof input.month !== 'string' || typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 100 || /[\u0000-\u001f\u007f]/.test(input.requestId)) throw error('INVALID_DATA');
        const baseVersion = input.baseVersion ?? null;
        if (baseVersion !== null && (typeof baseVersion !== 'string' || !/^[a-f0-9]{64}$/.test(baseVersion))) throw error('INVALID_DATA');
        const book = businessBook(input.book);
        if (book.month !== input.month) throw error('INVALID_DATA');
        request = { month: input.month, requestId: input.requestId, baseVersion, book };
      } catch (failure) { return Promise.reject(externalError(failure?.code ? failure : error('INVALID_DATA'))); }
      const pending = tail.then(async () => {
        check(key);
        try { const result = await saveRequest(key, request); check(key); return result; }
        catch (failure) { check(key); throw failure; }
      });
      tail = pending.catch(() => {});
      return pending;
    }
  };
}
