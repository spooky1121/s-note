import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { onRequest } from '../functions/api/scanner-analysis.js';
import { onRequest as scanRequest } from '../functions/api/scanner.js';
import { inspectAPIRequest } from '../functions/_shared/api-security.js';
const require = createRequire(import.meta.url);
const { createScannerFixture, COMPANY, FOREIGN, ACCOUNTANT, ADMIN, OWNER } = require('./scanner-inbox.sql.cjs');
const ENV = { SUPABASE_URL: 'https://office-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', GOOGLE_VISION_API_KEY: 'synthetic-google-key' };
const ORIGIN = 'https://office.example';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAEB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AHAEqb//2Q==', 'base64');
let f, original, state, files = new Map(), dbTurn = Promise.resolve();
// PGlite's single connection has session-local role/claim settings; real RPCs
// use independent transactions. Serialize the mock connection accordingly.
function rpc(work) { const pending = dbTurn.then(work); dbTurn = pending.catch(() => {}); return pending; }
const reply = (value, status = 200) => Response.json(value, { status });
const token = actor => Buffer.from('{"alg":"HS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: actor, session_id: f.sessions.get(actor) })).toString('base64url') + '.synthetic';
function annotation(text = '자동차등록증', turned = false) {
  const vertices = turned ? [{ x: 900, y: 100 }, { x: 900, y: 400 }, { x: 850, y: 400 }, { x: 850, y: 100 }] : [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 160 }, { x: 100, y: 160 }];
  return { pages: [{ width: 1000, height: 1400, blocks: [{ paragraphs: [{ words: [{ confidence: .99, boundingBox: { vertices }, symbols: [...text].map(text => ({ text })) }] }] }] }], text: 'synthetic-private-text' };
}
before(async () => {
  f = await createScannerFixture(); original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input), headers = new Headers(init.headers);
    assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store');
    if (url.origin === 'https://vision.googleapis.com') {
      assert.equal(url.pathname, '/v1/images:annotate'); assert.equal(url.searchParams.get('key'), ENV.GOOGLE_VISION_API_KEY);
      assert.equal(headers.has('Authorization'), false); assert.equal(headers.has('apikey'), false);
      const body = JSON.parse(init.body); assert.deepEqual(body.requests[0].features, [{ type: 'DOCUMENT_TEXT_DETECTION' }]);
      assert.deepEqual(Object.keys(body.requests[0].image), ['content']); assert(!init.body.includes(COMPANY));
      state.google++; if (state.blockGoogle) await state.blockGoogle;
      if (state.googleHook) await state.googleHook();
      if (state.googleRaw) return new Response(state.googleRaw);
      return reply(state.googleBody || { responses: [{ fullTextAnnotation: annotation() }] }, state.googleStatus || 200);
    }
    assert.equal(url.origin, ENV.SUPABASE_URL, 'No live network traffic');
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const body = JSON.parse(init.body);
      return rpc(async () => { try {
        if (url.pathname.endsWith('/snote_office_context')) {
          const actor = [ACCOUNTANT, ADMIN, OWNER].find(actor => headers.get('authorization') === 'Bearer ' + token(actor));
          if (!actor) return reply({ code: '42501' }, 403);
          assert.equal(headers.get('apikey'), ENV.SUPABASE_PUBLISHABLE_KEY);
          return reply(await f.context(actor, body.p_company));
        }
        assert(url.pathname.endsWith('/snote_scanner_action'));
        assert.equal(headers.get('authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
        if (body.p_action === 'read') state.readChecks++;
        return reply(await f.act(body.p_action, body.p_payload, body.p_actor, body.p_company, { session: body.p_session }));
      } catch (error) { return reply({ code: error.code }, error.code === '42501' ? 403 : error.code === '40001' ? 409 : 400); } });
    }
    assert(url.pathname.startsWith('/storage/v1/object/snote-scanner-inbox/'));
    assert.equal(headers.get('authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
    const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/snote-scanner-inbox/'.length));
    if (init.method === 'POST') {
      const bytes = new Uint8Array(init.body), mime = headers.get('content-type'); files.set(path, { bytes, mime });
      await f.db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['snote-scanner-inbox', path, JSON.stringify({ mimetype: mime, size: bytes.length })]);
      return reply({ Key: path });
    }
    assert.equal(init.method, 'GET'); state.storageReads++;
    const file = files.get(path); if (!file) return reply({}, 404);
    return new Response(file.bytes, { headers: { 'Content-Type': file.mime } });
  };
});
after(async () => { globalThis.fetch = original; await f?.db.close(); });
beforeEach(async () => {
  await f.db.exec('truncate snote_scanner_private.scans,snote_scanner_private.requests cascade;truncate storage.objects');
  await f.db.query('update public.zc_members set active=true where user_id=$1', [ACCOUNTANT]);
  files.clear(); state = { google: 0, storageReads: 0, readChecks: 0 };
});
async function save(bytes = PNG, mime = 'image/png') {
  const form = new FormData(); Object.entries({ action: 'upload', companyId: COMPANY, requestId: randomUUID() }).forEach(([k, v]) => form.append(k, v));
  form.append('file', new Blob([bytes], { type: mime }), 'synthetic.' + mime.split('/')[1]);
  const response = await scanRequest({ request: new Request(ORIGIN + '/api/scanner', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + token(ACCOUNTANT) }, body: form }), env: ENV });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.item;
}
async function call(row, options = {}) {
  const { actor = ACCOUNTANT, env = ENV, headers = {}, method = 'POST', body = { companyId: COMPANY, id: row?.id, revision: row?.revision } } = options;
  const request = new Request(ORIGIN + '/api/scanner-analysis', { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(actor), ...headers }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  const response = await onRequest({ request, env }); return { response, status: response.status, body: await response.json() };
}
function privateResult(result) {
  assert.match(result.response.headers.get('Cache-Control'), /no-store/); assert.match(result.response.headers.get('Cache-Control'), /private/);
  const text = JSON.stringify(result.body);
  for (const value of [ENV.GOOGLE_VISION_API_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY, 'synthetic-private-text', 'snote-scanner-inbox', 'fullTextAnnotation', 'boundingBox', 'content']) assert(!text.includes(value));
}
async function waitFor(check) { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } assert.fail('Synthetic provider did not reach expected state'); }
test('authenticated scanner analysis reads immutable private bytes and returns only document metadata', async () => {
  const row = await save(), result = await call(row); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body), ['ok', 'analysis']); assert.equal(result.body.analysis.label, '자동차 등록증');
  assert.equal(result.body.analysis.rotation, 0); assert.equal(state.google, 1); assert.equal(state.storageReads, 1); privateResult(result);
});
test('API middleware admits the authenticated bounded analysis route', async () => {
  const request = new Request(ORIGIN + '/api/scanner-analysis', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + token(ACCOUNTANT), 'Content-Type': 'application/json' }, body: '{}' });
  const result = inspectAPIRequest(request); assert.equal(result.path, '/api/scanner-analysis'); assert.equal(result.policy.maximum, 4096);
});
test('repeated and simultaneous requests share one Google call while every response rechecks live read permission', async () => {
  const row = await save(); let release; state.blockGoogle = new Promise(resolve => { release = resolve; });
  const a = call(row); await waitFor(() => state.google >= 1);
  const b = call(row); release(); const results = await Promise.all([a, b]); assert(results.every(result => result.status === 200), JSON.stringify(results.map(result => result.body)));
  assert.equal((await call(row, { actor: ADMIN })).status, 200); assert.equal(state.google, 1); assert.equal(state.storageReads, 1); assert(state.readChecks >= 8);
});
test('distinct documents are bounded to two simultaneous provider jobs without retaining blocked requests', async () => {
  const rows = [await save(), await save(), await save()]; let release;
  state.blockGoogle = new Promise(resolve => { release = resolve; });
  const first = call(rows[0]), second = call(rows[1]);
  try {
    await waitFor(() => state.google === 2);
    const blocked = await call(rows[2]); assert.equal(blocked.status, 429); assert.equal(blocked.body.code, 'OCR_RATE_LIMITED');
    assert.equal(state.google, 2);
  } finally { release(); }
  assert((await Promise.all([first, second])).every(result => result.status === 200));
  assert.equal((await call(rows[2])).status, 200); assert.equal(state.google, 3);
});
test('cached analysis is not returned after actor revocation or scan tombstone', async () => {
  const row = await save(); assert.equal((await call(row)).status, 200);
  await f.db.query('update public.zc_members set active=false where user_id=$1', [ACCOUNTANT]);
  assert.equal((await call(row)).status, 403); assert.equal(state.google, 1);
  await f.db.query('update public.zc_members set active=true where user_id=$1', [ACCOUNTANT]);
  await f.act('delete', { id: row.id, expectedRevision: row.revision, requestId: randomUUID() });
  assert.equal((await call(row)).status, 409); assert.equal(state.google, 1);
});
test('revocation during Google processing suppresses classification and cannot seed a usable cached response', async () => {
  const row = await save(); state.googleHook = () => f.db.query('update public.zc_members set active=false where user_id=$1', [ACCOUNTANT]);
  const result = await call(row); assert.equal(result.status, 403); assert.equal(result.body.analysis, undefined); privateResult(result);
  await f.db.query('update public.zc_members set active=true where user_id=$1', [ACCOUNTANT]); state.googleHook = null;
  assert.equal((await call(row)).status, 200); assert.equal(state.google, 2);
});
test('dealer, foreign office, missing bearer, wrong revision and arbitrary IDs never reach Google', async () => {
  const row = await save();
  assert.equal((await call(row, { actor: OWNER })).status, 403);
  assert.equal((await call(row, { body: { companyId: FOREIGN, id: row.id, revision: 1 } })).status, 403);
  assert.equal((await call(row, { headers: { Authorization: '' } })).status, 401);
  assert.equal((await call({ ...row, revision: 2 })).status, 409);
  assert.equal((await call({ ...row, id: randomUUID() })).status, 409); assert.equal(state.google, 0);
});
test('invalid origin, methods, content, body size and injected paths reject before Google', async () => {
  const row = await save();
  for (const headers of [{ Origin: 'https://foreign.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Encoding': 'gzip' }]) assert.equal((await call(row, { headers })).status, 403);
  assert.equal((await call(row, { method: 'GET' })).status, 405);
  assert.equal((await call(row, { headers: { 'Content-Type': 'image/jpeg' } })).status, 415);
  assert.equal((await call(row, { body: 'x'.repeat(4097) })).status, 413);
  for (const body of ['{', [], { companyId: COMPANY, id: row.id, revision: 1, path: 'https://forbidden.invalid/image.jpg' }, { companyId: COMPANY, id: row.id, revision: 0 }]) assert.equal((await call(row, { body })).status, 400);
  assert.equal(state.google, 0);
});
test('stored image tampering is rejected before sending any bytes to Google', async () => {
  const row = await save(), path = [...files.keys()][0], file = files.get(path);
  files.set(path, { ...file, bytes: new Uint8Array(PNG.length) });
  const result = await call(row); assert.equal(result.status, 502); assert.equal(state.google, 0); privateResult(result);
});
test('missing provider key and rejected credentials remain distinguishable from successful unclassified results', async () => {
  const row = await save(); let result = await call(row, { env: { ...ENV, GOOGLE_VISION_API_KEY: '' } });
  assert.equal(result.status, 503); assert.equal(result.body.code, 'OCR_SETUP_REQUIRED'); assert.equal(state.google, 0);
  state.googleStatus = 403; state.googleBody = { error: { message: 'synthetic-secret-provider-message' } };
  result = await call(row); assert.equal(result.status, 503); assert.equal(result.body.code, 'OCR_SETUP_REQUIRED'); assert(!JSON.stringify(result.body).includes('synthetic-secret')); privateResult(result);
  state.googleStatus = 200; state.googleBody = { responses: [{}] };
  result = await call(row); assert.equal(result.status, 200); assert.equal(result.body.analysis.label, '미분류'); assert.equal(state.google, 2);
});
test('Google malformed response, per-image error and oversized JSON are retryable errors rather than unclassified', async () => {
  const row = await save();
  for (const body of [{ responses: [] }, { responses: [{ error: { code: 13, message: 'synthetic-private-provider-error' } }] }, { responses: [{ fullTextAnnotation: [] }] }]) {
    state.googleBody = body; const result = await call(row); assert.equal(result.status, 502); assert.equal(result.body.code, 'OCR_UPSTREAM'); privateResult(result);
  }
  state.googleRaw = 'x'.repeat(4 * 1024 * 1024 + 1); assert.equal((await call(row)).body.code, 'OCR_UPSTREAM');
  state.googleRaw = null; state.googleBody = { responses: [{ fullTextAnnotation: annotation('일반 서류') }] };
  assert.equal((await call(row)).body.analysis.label, '미분류'); assert.equal(state.google, 5);
});
function jpegExif(orientation, little = true) {
  const tiff = Buffer.alloc(26); tiff.write(little ? 'II' : 'MM', 0);
  const w16 = (value, at) => little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at);
  const w32 = (value, at) => little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at);
  w16(42, 2); w32(8, 4); w16(1, 8); w16(0x112, 10); w16(3, 12); w32(1, 14); w16(orientation, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]), marker = Buffer.alloc(4); marker[0] = 255; marker[1] = 225; marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([JPEG.subarray(0, 2), marker, payload, JPEG.subarray(2)]);
}
test('EXIF rotated or mirrored JPEGs avoid double correction while standard-orientation scans are rotated by OCR', async () => {
  state.googleBody = { responses: [{ fullTextAnnotation: annotation('자동차등록증', true) }] };
  for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
    const row = await save(jpegExif(orientation, orientation % 2 === 0), 'image/jpeg'), result = await call(row);
    assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.analysis.rotation, 0); assert.equal(result.body.analysis.needsReview, true); assert.equal(result.body.analysis.label, '자동차 등록증');
  }
  const row = await save(jpegExif(1), 'image/jpeg'), result = await call(row);
  assert.equal(result.body.analysis.rotation, 270); assert.equal(result.body.analysis.needsReview, false);
});
test('provider quota backoff shares the error safely and never reports an unclassified document', async () => {
  const row = await save(); state.googleStatus = 429;
  const result = await call(row); assert.equal(result.status, 429); assert.equal(result.body.code, 'OCR_RATE_LIMITED'); privateResult(result);
  assert.equal((await call(row)).body.code, 'OCR_RATE_LIMITED'); assert.equal(state.google, 1);
});
