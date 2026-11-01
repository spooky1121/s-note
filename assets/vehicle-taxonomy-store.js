const INPUT_FIELDS = ['make', 'group', 'model', 'grade', 'subgrade', 'model_year'];
const IDENTITY_FIELDS = ['make', 'group', 'model', 'grade', 'subgrade'];
const LIMITS = { make: 45, group: 80, model: 100, grade: 100, subgrade: 80 };
const ROW_FIELDS = ['id', ...INPUT_FIELDS, 'verification', 'source', 'market'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MESSAGES = {
  SETUP_REQUIRED: '회사 차종 목록의 서버 설정이 필요합니다. 설정 후 다시 시도해 주세요.',
  NETWORK: '회사 차종 목록의 서버 응답을 확인하지 못했습니다. 다시 시도해 주세요.',
  CONTEXT_CHANGED: '로그인 또는 회사 정보가 변경되었습니다. 현재 화면을 다시 열어 주세요.',
  INVALID_DATA: '차량 분류의 제조사·차종·세대와 입력 형식을 확인해 주세요.',
  FORBIDDEN: '회사 차종 목록을 이용할 권한이 없습니다.'
};

class TaxonomyError extends Error {
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}
function failure(code) { return new TaxonomyError(code); }
function externalFailure(error) {
  return error instanceof TaxonomyError ? error : failure(Object.hasOwn(MESSAGES, error?.code) ? error.code : 'NETWORK');
}
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function fieldsOnly(value, allowed) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw failure('INVALID_DATA');
}
function label(value, limit, required) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value) ||
      Array.from(value).some(character => character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff)) throw failure('INVALID_DATA');
  const result = value.trim().replace(/\s+/gu, ' ');
  if ((required && !result) || Array.from(result).length > limit) throw failure('INVALID_DATA');
  return result;
}

/** Validate taxonomy fields, preserving display spelling and returning no metadata. */
export function normalizeTaxonomyEntry(input) {
  fieldsOnly(input, INPUT_FIELDS);
  const entry = {};
  for (const key of IDENTITY_FIELDS) {
    const required = ['make', 'group', 'model'].includes(key);
    if (required && !Object.hasOwn(input, key)) throw failure('INVALID_DATA');
    entry[key] = label(Object.hasOwn(input, key) ? input[key] : '', LIMITS[key], required);
  }
  const year = Object.hasOwn(input, 'model_year') ? input.model_year : '';
  if (typeof year !== 'string') throw failure('INVALID_DATA');
  entry.model_year = label(year, 4, false);
  if (entry.model_year && (!/^\d{4}$/.test(entry.model_year) || Number(entry.model_year) < 1970 || Number(entry.model_year) > new Date().getUTCFullYear() + 1)) throw failure('INVALID_DATA');
  return entry;
}

/** The taxonomy model is the vehicle generation, never the full display title. */
export function taxonomyEntryFromCar(car) {
  if (!plain(car)) throw failure('INVALID_DATA');
  return normalizeTaxonomyEntry({
    make: car.make, group: car.group, model: car.generation,
    grade: car.grade ?? '', subgrade: car.subgrade ?? '',
    model_year: car.year == null || car.year === '' ? '' : typeof car.year === 'number' ? String(car.year) : car.year
  });
}

/** Match server NFKC/ES-whitespace/ASCII-case identity; year is metadata only. */
export function taxonomyIdentity(input) {
  if (!plain(input)) throw failure('INVALID_DATA');
  const entry = normalizeTaxonomyEntry(Object.fromEntries(IDENTITY_FIELDS.map(key => [key, input[key] === undefined ? '' : input[key]])));
  return JSON.stringify(IDENTITY_FIELDS.map(key => entry[key].normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/[A-Z]/g, character => character.toLowerCase())));
}

function company(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw failure('INVALID_DATA');
  return value.toLowerCase();
}
function serverEntry(value) {
  fieldsOnly(value, ROW_FIELDS);
  if (typeof value.id !== 'string' || !UUID.test(value.id) || value.verification !== 'user_import' || value.source !== 'company_vehicle_registration' || value.market !== 'KR') throw failure('INVALID_DATA');
  if (INPUT_FIELDS.some(key => !Object.hasOwn(value, key))) throw failure('INVALID_DATA');
  const entry = normalizeTaxonomyEntry(Object.fromEntries(INPUT_FIELDS.map(key => [key, value[key]])));
  return { id: value.id.toLowerCase(), ...entry, verification: 'user_import', source: 'company_vehicle_registration', market: 'KR' };
}
function clone(value) { return structuredClone(value); }

/** The adapter supplies authenticated, company-scoped RPCs and cache callbacks. */
export function createVehicleTaxonomyStore(adapter) {
  if (!adapter || ['currentKey', 'companyId', 'read', 'upsert', 'onLoaded', 'onSaved'].some(name => typeof adapter[name] !== 'function')) throw failure('INVALID_DATA');
  let tail = Promise.resolve();
  function capture() {
    try {
      const key = adapter.currentKey(), companyId = company(adapter.companyId());
      if (typeof key !== 'string' || !key.trim()) throw failure('CONTEXT_CHANGED');
      return { key, companyId };
    } catch (_) { throw failure('CONTEXT_CHANGED'); }
  }
  function check(context) {
    const current = capture();
    if (current.key !== context.key || current.companyId !== context.companyId) throw failure('CONTEXT_CHANGED');
  }
  async function checked(context, operation) {
    check(context);
    try { const value = await operation(); check(context); return value; }
    catch (error) { check(context); throw externalFailure(error); }
  }
  function enqueue(operation) {
    const task = tail.catch(() => {}).then(operation);
    tail = task;
    return task;
  }
  function responseCompany(value, context, allowed) {
    fieldsOnly(value, allowed);
    if (company(value.company_id) !== context.companyId) throw failure('INVALID_DATA');
  }
  return {
    load() {
      let context;
      try { context = capture(); } catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const response = await checked(context, () => adapter.read());
        responseCompany(response, context, ['company_id', 'entries']);
        if (!Array.isArray(response.entries)) throw failure('INVALID_DATA');
        const entries = response.entries.map(serverEntry), ids = new Set(), identities = new Set();
        for (const entry of entries) {
          const identity = taxonomyIdentity(entry);
          if (ids.has(entry.id) || identities.has(identity)) throw failure('INVALID_DATA');
          ids.add(entry.id); identities.add(identity);
        }
        await checked(context, () => adapter.onLoaded(clone(entries)));
        return { company_id: context.companyId, entries: clone(entries) };
      });
    },
    save(input) {
      let context, entry, identity;
      try { entry = normalizeTaxonomyEntry(input); identity = taxonomyIdentity(entry); context = capture(); }
      catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const response = await checked(context, () => adapter.upsert(clone(entry)));
        responseCompany(response, context, ['company_id', 'entry', 'inserted']);
        const saved = serverEntry(response.entry);
        if (typeof response.inserted !== 'boolean' || taxonomyIdentity(saved) !== identity) throw failure('INVALID_DATA');
        await checked(context, () => adapter.onSaved(clone(saved)));
        return { company_id: context.companyId, entry: clone(saved), inserted: response.inserted };
      });
    }
  };
}
