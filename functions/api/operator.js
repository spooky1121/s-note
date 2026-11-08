import '../../assets/money.js';
import { readBoundedBytes } from '../_shared/api-security.js';
import { createTransferRewrapper } from '../_shared/operator-transfer.js';

// Platform operations are authorized twice: verified Auth user + a live-session
// database allowlist. Company admin roles and browser-supplied identities confer
// no operator authority. Service credentials are used only after those checks.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BUCKET = 'zc-vehicle-private', MAX_JSON = 16 * 1024 * 1024, MAX_FILE = 15 * 1024 * 1024;
// Six files also fit within a 50-subrequest Worker budget when every Storage
// copy reply is lost and needs two authenticated byte-verification downloads.
const COPY_BATCH = 6, MAX_TRANSFER_MEDIA = 1000;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CODES = {
  UNAUTHORIZED: [401, '운영자 계정으로 다시 로그인해 주세요.'],
  FORBIDDEN: [403, '이 기능은 승인된 운영자만 사용할 수 있습니다.'],
  INVALID_REQUEST: [400, '입력 항목과 요청 형식을 확인해 주세요.'],
  METHOD_NOT_ALLOWED: [405, '지원하지 않는 요청 방식입니다.'],
  CONFLICT: [409, '자료가 변경되었습니다. 새로 조회한 뒤 다시 시도해 주세요.'],
  TRANSFER_BLOCKED: [409, '이관 조건을 확인해야 합니다. 원본 자료는 그대로 보존됩니다.'],
  TRANSFER_NOT_FOUND: [404, '저장된 이관 요청을 찾지 못했습니다. 이전 내용을 다시 확인해 주세요.'],
  TRANSFER_ENCRYPTION_REQUIRED: [503, '고객정보 암호화를 확인하지 못했습니다. 원본은 변경되지 않았습니다.'],
  SETUP_REQUIRED: [503, '운영자 기능의 서버 설정을 확인해 주세요.'],
  RATE_LIMITED: [429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.'],
  NETWORK: [502, '처리 결과를 확인하지 못했습니다. 같은 요청으로 상태를 다시 확인해 주세요.']
};
class OperatorError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new OperatorError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST'); }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_REQUEST'); return value.toLowerCase(); }
function label(value, max = 200, empty = false) { if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail('INVALID_REQUEST'); return value.trim(); }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_REQUEST'); return value; }
function fingerprint(value) { return label(value, 128); }
function scope(value, expected = false) {
  fields(value, ['companyId', 'ownerId', 'carId', ...(expected ? ['revision', 'coversRevision'] : [])]);
  return { companyId: uuid(value.companyId), ownerId: uuid(value.ownerId), carId: label(value.carId),
    ...(expected ? { revision: revision(value.revision), coversRevision: revision(value.coversRevision) } : {}) };
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: headers('application/json; charset=utf-8') }); }
function headers(type) { return { 'Content-Type': type, 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' }; }
function configuration(env) {
  try {
    const url = new URL(env.SUPABASE_URL), values = [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_SERVICE_ROLE_KEY];
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || values.some(v => typeof v !== 'string' || !v.trim() || /[\r\n]/.test(v))) fail('SETUP_REQUIRED');
    return { url: url.origin, pub: values[0].trim(), service: values[1].trim() };
  } catch { fail('SETUP_REQUIRED'); }
}
async function bytes(response, maximum) {
  const length = Number(response.headers.get('Content-Length') || 0);
  if (length > maximum) fail('NETWORK');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > maximum) { await reader.cancel(); fail('NETWORK'); } chunks.push(next.value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function requestJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('INVALID_REQUEST');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBytes(request, 1024 * 1024))); }
  catch { fail('INVALID_REQUEST'); }
}
function databaseError(status, data, adminAuth = false) {
  if (status === 401) fail('UNAUTHORIZED');
  if (status === 429) fail('RATE_LIMITED');
  if (data?.code === '42501' || status === 403) fail('FORBIDDEN');
  if (status === 409 || String(data?.statusCode) === '409' || ['40001', '23505'].includes(data?.code)) fail('CONFLICT');
  if (data?.code === '22023' && data.message === 'TRANSFER_NOT_FOUND') fail('TRANSFER_NOT_FOUND');
  if (data?.code === '22023') fail('INVALID_REQUEST');
  if (['PGRST202', '42P01', '42883'].includes(data?.code)) fail('SETUP_REQUIRED');
  if (adminAuth && (status === 400 || status === 422)) fail('INVALID_REQUEST');
  fail('NETWORK');
}
async function upstream(c, jwt, path, { body, method, service = false, binary = false } = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const key = service ? c.service : c.pub;
    const response = await fetch(c.url + path, { method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { apikey: key, Authorization: 'Bearer ' + (service ? c.service : jwt), Accept: binary ? 'application/octet-stream' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status >= 300 && response.status < 400) fail('NETWORK');
    if (binary && response.ok) return { data: await bytes(response, MAX_FILE), mime: (response.headers.get('Content-Type') || '').split(';')[0].toLowerCase() };
    let data;
    try { const raw = await bytes(response, MAX_JSON); data = raw.length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) : null; } catch { fail('NETWORK'); }
    if (!response.ok) databaseError(response.status, data, path.startsWith('/auth/v1/admin/'));
    return data;
  } catch (error) { if (error instanceof OperatorError) throw error; fail('NETWORK'); }
  finally { clearTimeout(timeout); }
}
async function authorize(c, jwt) {
  const user = await upstream(c, jwt, '/auth/v1/user');
  if (!UUID.test(user?.id || '') || user.is_anonymous === true) fail('UNAUTHORIZED');
  const context = await upstream(c, jwt, '/rest/v1/rpc/snote_operator_context', { body: {} });
  if (!object(context) || context.allowed !== true || context.actorId !== user.id || !UUID.test(context.sessionId || '')) fail('FORBIDDEN');
  return { actorId: uuid(context.actorId), sessionId: uuid(context.sessionId), email: typeof context.email === 'string' ? context.email : '', allowed: true };
}
async function recheck(c, jwt, actor) {
  const next = await upstream(c, jwt, '/rest/v1/rpc/snote_operator_context', { body: {} });
  if (next?.allowed !== true || next.actorId !== actor.actorId || next.sessionId !== actor.sessionId) fail('FORBIDDEN');
}
async function rpc(c, jwt, actor, name, args = {}, service = false) {
  if (service) await recheck(c, jwt, actor);
  return upstream(c, jwt, '/rest/v1/rpc/snote_operator_' + name, { body: { ...args, ...(service ? { p_actor: actor.actorId, p_session: actor.sessionId } : {}) }, service });
}
const VEHICLE_FIELDS = ['id', 'ownerId', 'moneyUnit', 'model', 'make', 'group', 'generation', 'grade', 'subgrade', 'plate', 'year', 'vin', 'buy', 'sell', 'soldPrice', 'soldAt', 'purchaseAt', 'status', 'km', 'color', 'extra', 'costs', 'customCosts', 'customCostLabels', 'repairItems', 'inventoryLoan', 'inventoryLender', 'emoji', 'inventoryInterestSnapshot', 'taxonomyCatalogRef', 'encarLinks'];
const EDITABLE = ['model', 'make', 'group', 'generation', 'grade', 'subgrade', 'plate', 'year', 'vin', 'km', 'color', 'purchaseAt', 'soldAt', 'status', 'extra', 'buy', 'sell', 'soldPrice', 'inventoryLoan', 'inventoryLender', 'costs', 'customCosts', 'customCostLabels', 'repairItems'];
const COSTS = ['bodywork', 'polish', 'performanceInspection', 'repair', 'advertising', 'purchaseFee', 'purchaseOther', 'acquisitionTax', 'incomeTax', 'inventoryInterest'];
function publicValue(value, depth = 0) {
  if (depth > 32) fail('NETWORK');
  if (typeof value === 'string') return /^(?:smi1|isi1|v1)\.[a-f0-9]/.test(value) ? '' : value.replace(/\b(\d{6})[- ]?\d{7}\b/g, '$1-*******');
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => publicValue(v, depth + 1));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/rrn|jumin|resident|identityCipher|privateCipher|password|access.?token|refresh.?token/i.test(key)).map(([key, v]) => [key, publicValue(v, depth + 1)]));
}
function publicVehicle(value) { return publicValue(globalThis.SnoteMoney.car(Object.fromEntries(VEHICLE_FIELDS.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]])))); }
function publicMedia(row) { return publicValue({ id: String(row.id || ''), group: String(row.group_name || ''), name: String(row.original_name || ''), mimeType: String(row.mime_type || ''), size: Number(row.file_size || 0) }); }
function publicResult(data) {
  if (!object(data)) fail('NETWORK');
  const result = publicValue(data);
  if (Array.isArray(data.items)) result.items = data.items.map(item => object(item) && object(item.vehicle) ? { ...publicValue(item), vehicle: publicVehicle(item.vehicle) } : publicValue(item));
  if (object(data.vehicle)) result.vehicle = publicVehicle(data.vehicle);
  if (Array.isArray(data.media)) result.media = data.media.map(publicMedia);
  // Raw canonical customer records are only used inside transfer preparation.
  delete result.customer; delete result.rrn; delete result.raw; delete result.snapshot;
  return result;
}
function money(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000000) fail('INVALID_REQUEST'); return value; }
function vehiclePatch(patch) {
  fields(patch, EDITABLE); const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['buy', 'sell', 'soldPrice', 'inventoryLoan'].includes(key)) result[key] = money(value);
    else if (key === 'costs') { fields(value, COSTS); result[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, money(v)])); }
    else if (key === 'customCosts' || key === 'customCostLabels') {
      if (!object(value) || Object.keys(value).length > 128) fail('INVALID_REQUEST');
      result[key] = Object.fromEntries(Object.entries(value).map(([id, item]) => {
        if (!id.startsWith('custom-') || !UUID.test(id.slice(7))) fail('INVALID_REQUEST');
        return [id, key === 'customCosts' ? money(item) : label(item, 24)];
      }));
    }
    else if (key === 'repairItems') {
      if (!Array.isArray(value) || value.length > 100) fail('INVALID_REQUEST');
      result[key] = value.map(row => { fields(row, ['memo', 'amount']); return { memo: label(row.memo, 160, true), amount: money(row.amount) }; });
    } else if (key === 'year') { if (!Number.isInteger(value) || value < 1900 || value > new Date().getUTCFullYear() + 1) fail('INVALID_REQUEST'); result[key] = value; }
    else if (key === 'status') { if (!['판매중', '수리중', '판매완료'].includes(value)) fail('INVALID_REQUEST'); result[key] = value; }
    else if (['purchaseAt', 'soldAt'].includes(key)) { if (typeof value !== 'string' || value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_REQUEST'); result[key] = value; }
    else if (key === 'km') { const raw = typeof value === 'number' ? String(value) : value; if (typeof raw !== 'string' || !/^[\d,]{1,12}$/.test(raw) || Number(raw.replaceAll(',', '')) > 9999999) fail('INVALID_REQUEST'); result[key] = Number(raw.replaceAll(',', '')).toLocaleString('en-US'); }
    else result[key] = label(value, key === 'extra' ? 5000 : 200, !['model', 'plate'].includes(key));
  }
  return result;
}
function accountPatch(patch, company) {
  const allowed = company ? ['name', 'businessNumber', 'representativeName', 'businessPhone', 'postcode', 'address', 'addressDetail'] : ['displayName', 'phone', 'address', 'companyId', 'role'];
  const lengths = company ? { name: 100, businessNumber: 50, representativeName: 50, businessPhone: 50, postcode: 50, address: 200, addressDetail: 200 } : { displayName: 40, phone: 30, address: 300 };
  fields(patch, allowed);
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!company && key === 'companyId') result[key] = uuid(value);
    else if (!company && key === 'role') { if (!['admin', 'dealer', 'accountant'].includes(value)) fail('INVALID_REQUEST'); result[key] = value; }
    else result[key] = label(value, lengths[key], !['displayName', 'name'].includes(key));
  }
  return result;
}
function supportText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('INVALID_REQUEST');
  return value.trim();
}
function supportPage(value) {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail('INVALID_REQUEST');
  return value;
}
function supportBefore(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_REQUEST');
  return value;
}
function supportIds(value) {
  if (!Array.isArray(value) || value.length > 100) fail('INVALID_REQUEST');
  const ids=value.map(uuid);if(new Set(ids).size!==ids.length)fail('INVALID_REQUEST');return ids;
}
function supportResult(value) {
  // Support RPCs project only conversation/message fields. Keep the original
  // message text, including line breaks, within this verified operator scope.
  if (!object(value)) fail('NETWORK');
  return value;
}
async function readVehicle(c, jwt, actor, b) { return rpc(c, jwt, actor, 'vehicle_read', { p_company: uuid(b.companyId), p_owner: uuid(b.ownerId), p_car_id: label(b.carId) }, true); }
function safePath(path, expected) {
  if (typeof path !== 'string' || path.length > 1800) fail('NETWORK');
  const parts = path.split('/');
  if (parts.length !== 4 || !UUID.test(parts[0]) || !UUID.test(parts[1])) fail('NETWORK');
  for (const part of parts) {
    let decoded; try { decoded = decodeURIComponent(part); } catch { fail('NETWORK'); }
    if (!part || decoded === '.' || decoded === '..' || /[\\\u0000-\u001f\u007f]/.test(decoded) || encodeURIComponent(decoded) !== part) fail('NETWORK');
  }
  if (expected && (parts[0] !== expected.companyId || parts[1] !== expected.ownerId || parts[2] !== encodeURIComponent(expected.carId))) fail('NETWORK');
  // Percent escapes are part of the stored object key. Encode them again in
  // the HTTP URL so Storage receives that exact key, rather than another path.
  return parts.map(encodeURIComponent).join('/');
}
async function mediaFile(c, jwt, actor, b) {
  const record = await readVehicle(c, jwt, actor, b), rows = record?.media;
  if (!Array.isArray(rows)) fail('NETWORK');
  const matches = rows.filter(row => row.id === b.mediaId); if (matches.length !== 1) fail('INVALID_REQUEST');
  const row = matches[0]; if (!MIME.has(row.mime_type) || row.file_size > MAX_FILE) fail('INVALID_REQUEST');
  if (row.company_id !== b.companyId || row.car_id !== b.carId) fail('NETWORK');
  const fileScope = { companyId: uuid(row.company_id), ownerId: uuid(row.owner_id), carId: label(row.car_id) };
  await recheck(c, jwt, actor);
  const downloaded = await upstream(c, jwt, '/storage/v1/object/' + BUCKET + '/' + safePath(row.file_path, fileScope), { service: true, binary: true });
  await recheck(c, jwt, actor);
  if (downloaded.data.length !== Number(row.file_size) || downloaded.mime !== row.mime_type) fail('NETWORK');
  return new Response(downloaded.data, { headers: { ...headers(row.mime_type), 'Content-Disposition': 'inline' } });
}
const TRANSFER_POLICY = Object.freeze({ customer: 'canonical', encryptedIdentity: 'rebound_to_destination', signatures: 'original_provenance_preserved', intakeLinks: false, sharedGrants: false, moveSource: 'recoverable_archive' });
function planPublic(job, requestId) {
  if (!object(job) || !['prepared', 'committed', 'aborted', 'failed'].includes(job.status) || !['copy', 'move'].includes(job.mode)) fail('NETWORK');
  const blockers = Array.isArray(job.blockers) ? job.blockers.filter(s => typeof s === 'string' && /^[A-Z0-9_]{1,80}$/.test(s)) : [];
  return { requestId, jobId: job.jobId, status: job.status, mode: job.mode, source: publicValue(job.source), target: publicValue(job.target), mediaCount: job.media?.length || job.mediaCount || 0, hasCustomer: !!job.customer || job.hasCustomer === true, legacyRrnCount: Number(job.legacyRrnCount || 0), blockers, policy: TRANSFER_POLICY };
}
async function storageCopy(c, jwt, actor, item, source, target) {
  if (!object(item) || !object(item.source) || !object(item.target)) fail('NETWORK');
  const a = item.source, b = item.target;
  const fileScope = { ...source, ownerId: uuid(a.owner_id) };
  safePath(a.file_path, fileScope); safePath(b.file_path, target);
  if (a.company_id !== source.companyId || a.car_id !== source.carId || b.company_id !== target.companyId || b.owner_id !== target.ownerId || b.car_id !== target.carId || !MIME.has(a.mime_type) || b.mime_type !== a.mime_type || Number(b.file_size) !== Number(a.file_size) || Number(a.file_size) < 1 || Number(a.file_size) > MAX_FILE) fail('NETWORK');
  await recheck(c, jwt, actor);
  // Storage's copy endpoint copies the real object contents, never only SQL
  // metadata. Deterministic destination paths belong to this immutable DB job.
  try { await upstream(c, jwt, '/storage/v1/object/copy', { service: true, body: { bucketId: BUCKET, sourceKey: a.file_path, destinationKey: b.file_path } }); }
  catch (error) {
    // A copy may have succeeded while its reply was lost. An existing object is
    // reusable only after its actual bytes match the current source exactly.
    if (!['CONFLICT', 'NETWORK'].includes(error.code)) throw error;
    await recheck(c, jwt, actor);
    const left = await upstream(c, jwt, '/storage/v1/object/' + BUCKET + '/' + safePath(a.file_path, fileScope), { service: true, binary: true });
    await recheck(c, jwt, actor);
    const right = await upstream(c, jwt, '/storage/v1/object/' + BUCKET + '/' + safePath(b.file_path, target), { service: true, binary: true });
    if (left.mime !== a.mime_type || right.mime !== b.mime_type || left.data.length !== Number(a.file_size) || right.data.length !== left.data.length) fail('CONFLICT');
    const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
    const l = await digest(left.data), r = await digest(right.data); if (!l.every((byte, i) => byte === r[i])) fail('CONFLICT');
  }
}
async function transferCommit(c, jwt, actor, env, requestId) {
  const job = await rpc(c, jwt, actor, 'transfer_get', { p_request_id: requestId }, true);
  if (job?.status === 'committed') return { ...planPublic(job, requestId), ...publicResult(job.result || {}), status: 'committed', duplicate: true };
  if (job?.status !== 'prepared' || !Array.isArray(job.media) || job.media.length > MAX_TRANSFER_MEDIA) fail('CONFLICT');
  if (job.blockers?.length) fail('TRANSFER_BLOCKED');
  const source = scope(job.source, true), target = scope(job.target);
  const rewrap = createTransferRewrapper(env, source, target);
  const vehicle = await rewrap(job.vehicle);
  let customer = null;
  if (job.customer) {
    const customerSource = scope({ companyId: job.customer.company_id, ownerId: job.customer.owner_id, carId: job.customer.car_id });
    if (customerSource.companyId !== source.companyId || customerSource.carId !== source.carId) fail('NETWORK');
    customer = await createTransferRewrapper(env, customerSource, target)(job.customer.payload);
  }
  const pending = job.media.filter(item => item.copied !== true), batch = pending.slice(0, COPY_BATCH);
  for (const item of batch) await storageCopy(c, jwt, actor, item, source, target);
  // A cancel in another window can race an in-flight object copy. Re-read the
  // durable job after copying so a late object is cleaned after cancellation,
  // while a concurrently committed destination is always retained.
  const latest = await rpc(c, jwt, actor, 'transfer_get', { p_request_id: requestId }, true);
  if (latest?.status === 'aborted') { await transferAbort(c, jwt, actor, requestId); fail('CONFLICT'); }
  if (latest?.status === 'committed') return { ...planPublic(latest, requestId), ...publicResult(latest.result || {}), status: 'committed', duplicate: true };
  if (latest?.status !== 'prepared' || !Array.isArray(latest.media)) fail('CONFLICT');
  const remaining = latest.media.filter(item => item.copied !== true).length;
  if (batch.length && remaining >= pending.length) fail('NETWORK');
  if (remaining) return { ...planPublic(latest, requestId), status: 'prepared', copied: latest.media.length - remaining, totalMedia: latest.media.length, remaining, continue: true };
  const result = await rpc(c, jwt, actor, 'transfer_commit', { p_request_id: requestId, p_vehicle: vehicle, p_customer: customer }, true);
  if (result?.status !== 'committed') fail('NETWORK');
  return { ...publicResult(result), requestId, policy: TRANSFER_POLICY };
}
async function transferAbort(c, jwt, actor, requestId) {
  let result;
  try { result = await rpc(c, jwt, actor, 'transfer_abort', { p_request_id: requestId }, true); }
  catch (error) {
    // The UI keeps the opaque request ID before preparing, so even a lost
    // prepare reply is recoverable. A proven absent job has no files to clean.
    if (error.code === 'TRANSFER_NOT_FOUND') return { requestId, status: 'aborted', cleanupPending: false, missing: true };
    throw error;
  }
  if (!object(result) || !Array.isArray(result.cleanupPaths)) fail('NETWORK');
  const paths = result.cleanupPaths; if (paths.length > MAX_TRANSFER_MEDIA) fail('NETWORK'); paths.forEach(path => safePath(path));
  let cleanupPending = false;
  if (paths.length) {
    try { await recheck(c, jwt, actor); await upstream(c, jwt, '/storage/v1/object/' + BUCKET, { service: true, method: 'DELETE', body: { prefixes: paths } }); }
    catch { cleanupPending = true; }
  }
  return { requestId, status: result.status, cleanupPending };
}
async function authUpdate(c, jwt, actor, b) {
  const target = uuid(b.userId), requestId = uuid(b.requestId), expected = fingerprint(b.expected), patch = {};
  if (b.email !== undefined) { const email = label(b.email, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('INVALID_REQUEST'); patch.email = email; }
  if (b.password !== undefined) { if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128 || /[\u0000-\u001f\u007f]/.test(b.password)) fail('INVALID_REQUEST'); patch.password = b.password; }
  const changed = Object.keys(patch); if (!changed.length) fail('INVALID_REQUEST');
  // Bind retries to the exact operation without persisting/logging a password
  // or a dictionary-testable unsalted password hash in the audit tables.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.service), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('snote-operator-auth:v1:' + JSON.stringify([actor.actorId, target, requestId, patch])));
  const hash = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  const prepared = await rpc(c, jwt, actor, 'auth_prepare', { p_user: target, p_expected: expected, p_request_id: requestId, p_fingerprint: hash, p_fields: changed, p_email: patch.email || null }, true);
  if (prepared?.status === 'committed') return { requestId, status: 'committed', duplicate: true,
    ...(object(prepared.result?.account) ? { account: publicValue(prepared.result.account) } : {}) };
  if (prepared?.status !== 'prepared' || prepared.userId !== target) fail('CONFLICT');
  await recheck(c, jwt, actor);
  let changedUser;
  try { changedUser = await upstream(c, jwt, '/auth/v1/admin/users/' + target, { service: true, method: 'PUT', body: patch }); }
  catch (error) { if (['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT', 'RATE_LIMITED'].includes(error.code)) await rpc(c, jwt, actor, 'auth_finalize', { p_request_id: requestId, p_success: false, p_auth_result: { id: target } }, true); throw error; }
  if (changedUser?.id !== target || patch.email && changedUser.email?.toLowerCase() !== patch.email) fail('NETWORK');
  const finalized = await rpc(c, jwt, actor, 'auth_finalize', { p_request_id: requestId, p_success: true, p_auth_result: { id: target, ...(typeof changedUser.email === 'string' ? { email: changedUser.email } : {}) } }, true);
  if (finalized?.status !== 'committed') fail('NETWORK');
  return { requestId, status: 'committed', userId: target, changedFields: changed,
    ...(object(finalized.account) ? { account: publicValue(finalized.account) } : {}) };
}

async function perform(c, jwt, actor, b, env) {
  const action = b.action;
  if (action === 'context') { fields(b, ['action']); return actor; }
  if (action === 'support-unread') {
    fields(b, ['action']);return supportResult(await rpc(c,jwt,actor,'support_unread'));
  }
  if (action === 'support-threads') {
    fields(b,['action','query']);const query=b.query||{};fields(query,['query','page','status','companyId']);
    if(query.page!==undefined&&(!Number.isSafeInteger(query.page)||query.page<1||query.page>1000000))fail('INVALID_REQUEST');
    if(query.query!==undefined)label(query.query,200,true);
    if(query.status!==undefined&&!['all','unread'].includes(query.status))fail('INVALID_REQUEST');
    if(query.companyId)uuid(query.companyId);
    return supportResult(await rpc(c,jwt,actor,'support_threads',{p_query:query}));
  }
  if (action === 'support-thread') {
    fields(b,['action','conversationId','limit','before']);
    return supportResult(await rpc(c,jwt,actor,'support_messages',{p_conversation_id:uuid(b.conversationId),p_limit:supportPage(b.limit),p_before:supportBefore(b.before)}));
  }
  if (action === 'support-read') {
    fields(b,['action','conversationId','messageIds']);
    return supportResult(await rpc(c,jwt,actor,'support_read',{p_conversation_id:uuid(b.conversationId),p_message_ids:supportIds(b.messageIds)}));
  }
  if (action === 'support-reply') {
    fields(b,['action','conversationId','text','requestId']);
    return supportResult(await rpc(c,jwt,actor,'support_reply',{p_conversation_id:uuid(b.conversationId),p_text:supportText(b.text),p_request_id:uuid(b.requestId)}));
  }
  if (['vehicles', 'accounts', 'companies', 'access'].includes(action)) {
    fields(b, ['action', 'query']); const query = b.query || {}; fields(query, ['query', 'page', 'sort', 'direction', 'status', 'companyId', 'ownerId']);
    if (query.page !== undefined && (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 1000000)) fail('INVALID_REQUEST');
    for (const key of ['query', 'sort', 'direction', 'status']) if (query[key] !== undefined) label(query[key], 200, true);
    for (const key of ['companyId', 'ownerId']) if (query[key]) uuid(query[key]);
    return publicResult(await rpc(c, jwt, actor, action + '_list', { p_query: query }));
  }
  if (['vehicle-detail', 'media-file'].includes(action)) {
    fields(b, ['action', 'companyId', 'ownerId', 'carId', ...(action === 'media-file' ? ['mediaId'] : [])]);
    if (action === 'media-file') { label(b.mediaId); return mediaFile(c, jwt, actor, b); }
    return publicResult(await readVehicle(c, jwt, actor, b));
  }
  if (['vehicle-save', 'vehicle-update'].includes(action)) {
    fields(b, ['action', 'companyId', 'ownerId', 'carId', 'expected', 'patch', 'moneyUnit', 'requestId']);
    if (b.moneyUnit !== 'KRW') fail('INVALID_REQUEST'); const expected = revision(b.expected), requestId = uuid(b.requestId), patch = vehiclePatch(b.patch);
    const source = await readVehicle(c, jwt, actor, b); if (source?.revision !== expected || !object(source.vehicle)) fail('CONFLICT');
    const normalized = globalThis.SnoteMoney.car(source.vehicle), vehicle = { ...normalized, ...patch, moneyUnit: 'KRW' };
    for (const map of ['costs', 'customCosts', 'customCostLabels']) if (patch[map]) vehicle[map] = { ...(normalized[map] || {}), ...patch[map] };
    for (const map of ['customCosts', 'customCostLabels']) if (vehicle[map]) vehiclePatch({ [map]: vehicle[map] });
    return publicResult(await rpc(c, jwt, actor, 'vehicle_save', { p_company: uuid(b.companyId), p_owner: uuid(b.ownerId), p_car_id: label(b.carId), p_expected: expected, p_vehicle: vehicle, p_request_id: requestId }));
  }
  if (action === 'vehicle-archive') {
    fields(b, ['action', 'companyId', 'ownerId', 'carId', 'expected', 'expectedCovers', 'requestId']);
    return publicResult(await rpc(c, jwt, actor, 'vehicle_archive', { p_company: uuid(b.companyId), p_owner: uuid(b.ownerId), p_car_id: label(b.carId), p_expected: revision(b.expected), p_expected_covers: revision(b.expectedCovers), p_request_id: uuid(b.requestId) }));
  }
  if (action === 'vehicle-restore') {
    fields(b, ['action', 'companyId', 'entryId', 'requestId']);
    return publicResult(await rpc(c, jwt, actor, 'vehicle_restore', { p_company: uuid(b.companyId), p_entry: uuid(b.entryId), p_request_id: uuid(b.requestId) }));
  }
  if (['account-save', 'account-state', 'company-save', 'company-state'].includes(action)) {
    const account = action.startsWith('account-'), save = action.endsWith('-save'), id = account ? 'userId' : 'companyId';
    fields(b, ['action', id, 'expected', 'requestId', ...(save ? ['patch'] : ['active'])]);
    const args = { [account ? 'p_user' : 'p_company']: uuid(b[id]), p_expected: fingerprint(b.expected), p_request_id: uuid(b.requestId) };
    if (save) args.p_patch = accountPatch(b.patch, !account);
    else { if (typeof b.active !== 'boolean') fail('INVALID_REQUEST'); args.p_active = b.active; }
    return publicResult(await rpc(c, jwt, actor, action.replace('-', '_'), args));
  }
  if (action === 'auth-update') { fields(b, ['action', 'userId', 'expected', 'requestId', 'email', 'password']); return authUpdate(c, jwt, actor, b); }
  if (action === 'transfer-plan') {
    fields(b, ['action', 'source', 'target', 'mode', 'requestId']); const source = scope(b.source, true);
    fields(b.target, ['companyId', 'ownerId']); const target = { companyId: uuid(b.target.companyId), ownerId: uuid(b.target.ownerId) };
    if (!['copy', 'move'].includes(b.mode) || source.companyId === target.companyId && source.ownerId === target.ownerId) fail('INVALID_REQUEST');
    const requestId = uuid(b.requestId), job = await rpc(c, jwt, actor, 'transfer_prepare', { p_source: source, p_target: target, p_mode: b.mode, p_request_id: requestId }, true);
    return planPublic(job, requestId);
  }
  if (['transfer-commit', 'transfer-status', 'transfer-cancel'].includes(action)) {
    fields(b, ['action', 'requestId']); const requestId = uuid(b.requestId);
    if (action === 'transfer-commit') return transferCommit(c, jwt, actor, env, requestId);
    if (action === 'transfer-cancel') return transferAbort(c, jwt, actor, requestId);
    return planPublic(await rpc(c, jwt, actor, 'transfer_get', { p_request_id: requestId }, true), requestId);
  }
  fail('INVALID_REQUEST');
}
export async function onRequest({ request, env }) {
  try {
    if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
    const origin = request.headers.get('Origin'); if (origin !== null && origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('FORBIDDEN');
    const authorization = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get('Authorization') || '');
    if (!authorization || authorization[1].length < 30 || authorization[1].length > 6000) fail('UNAUTHORIZED');
    const b = await requestJson(request); if (!object(b) || typeof b.action !== 'string') fail('INVALID_REQUEST');
    const c = configuration(env), actor = await authorize(c, authorization[1]);
    const result = await perform(c, authorization[1], actor, b, env);
    return result instanceof Response ? result : json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof OperatorError || error?.code === 'TRANSFER_ENCRYPTION_REQUIRED' ? error.code : 'NETWORK';
    const [status, message] = CODES[code] || CODES.NETWORK;
    return json({ ok: false, code: Object.hasOwn(CODES, code) ? code : 'NETWORK', error: message }, status);
  }
}
