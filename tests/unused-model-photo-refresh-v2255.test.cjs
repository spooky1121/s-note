'use strict';

// Actual source functions, synthetic rows/Blobs and an in-memory SDK only.
// This does not connect to Supabase, read credentials or alter a database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const baselinePath = process.env.SNOTE_CLEANUP_BASELINE_HTML || '/workspace/work/cleanup-optimization-v2255/baseline/index.html';
const baseline = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : null;
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = '11111111-1111-4111-8111-111111111111';
const alias = id => 'cld_' + id.replace(/-/g, '').slice(0, 18);
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, 'Expected actual media source anchors');
  return source.slice(first, last);
}
function record(id, group = 'photos', car = 'synthetic-car') {
  return { id, company_id: COMPANY, owner_id: USER, car_id: car, group_name: group,
    file_path: COMPANY + '/' + USER + '/' + id + '.jpg', original_name: id + '.jpg',
    mime_type: 'image/jpeg', file_size: 4, created_at: '2026-11-01T00:00:00.000Z', meta: { keySuffix: id } };
}
function fixture(source = html, { role = 'accountant', rows = [], failedPaths = new Set(), metadataGate = null, downloadGate = null } = {}) {
  const calls = { metadata: [], downloads: [], created: [], revoked: [], renders: 0, events: [], warnings: [] };
  const client = {
    from(table) {
      assert.equal(table, 'zc_media');
      const filters = {}, query = { table, filters, fields: null, options: null, limit: null };
      const chain = {
        select(fields, options) { query.fields = fields; query.options = options; return chain; },
        eq(key, value) { filters[key] = value; return chain; },
        limit(value) { query.limit = value; return chain; },
        then(resolve, reject) {
          calls.metadata.push(clone(query));
          return Promise.resolve().then(async () => {
            if (metadataGate) { metadataGate.started.resolve(); await metadataGate.release.promise; }
            const data = rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
            return { data, error: null, count: data.length };
          }).then(resolve, reject);
        }
      };
      return chain;
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'synthetic-private');
      return { async download(file) {
        calls.downloads.push(file);
        if (downloadGate) { downloadGate.started.resolve(); await downloadGate.release.promise; }
        return failedPaths.has(file) ? { data: null, error: { code: 'SYNTHETIC_FAILED_PREVIEW' } }
          : { data: new Blob(['test'], { type: 'image/jpeg' }), error: null };
      } };
    } }
  };
  const context = vm.createContext({
    Blob, Event, Promise, Map, Set, Date,
    console: { warn(...args) { calls.warnings.push(args); } },
    S: { ready: true, user: { id: USER }, company: { id: COMPANY }, client },
    currentUser: { username: alias(USER), role },
    activeCarId: null, snote220CatalogEpoch: 1,
    BUCKET: 'synthetic-private', ownerAlias: alias,
    snoteCompanyActor() { return { role }; },
    SNOTE174_DOCUMENT_GROUPS: new Set(['registration', 'inspection1', 'inspection2']),
    renderCars() { calls.renders++; }, renderVehicle() { throw Error('No detail popup in this test'); },
    window: { dispatchEvent(event) { calls.events.push(event.type); } },
    URL: {
      createObjectURL(blob) { assert(blob instanceof Blob); const url = 'blob:synthetic-' + (calls.created.length + 1); calls.created.push(url); return url; },
      revokeObjectURL(url) { calls.revoked.push(url); }
    },
    prevModelPhotos() { throw Error('Cloud refresh must not fall back to local model reads'); }
  });
  vm.runInContext('let snoteServerMediaEpoch=0,snoteServerModelEpoch=0,mediaObjectUrls=[],modelPhotoUrls=[],mediaByCar={},modelPhotos=[],snote174VehicleDocumentSnapshot=null;\n' +
    section(source, 'function snoteMediaScope(){', '\nrefreshMedia=async function(){') + '\n' +
    section(source, 'async function modelPhotoRows(', '\nasync function storeModelPhoto('), context);
  return {
    context, calls,
    refresh: () => context.serverMediaRefresh(),
    read: expression => vm.runInContext(expression, context),
    summary() { return { metadata: calls.metadata.length, modelMetadata: calls.metadata.filter(row => row.filters.group_name === 'modelPhoto').length,
      downloads: calls.downloads.length, modelDownloads: calls.downloads.filter(file => /model-/.test(file)).length, objectUrls: calls.created.length }; }
  };
}

test('real vehicle photos and documents remain loaded, counted and displayed without reading dormant model photos', async () => {
  const rows = [record('real-photo'), record('real-registration', 'registration'), record('real-inspection', 'inspection1'), record('model-one', 'modelPhoto')];
  const f = fixture(html, { rows });
  await f.refresh();
  assert.deepEqual(f.summary(), { metadata: 1, modelMetadata: 0, downloads: 3, modelDownloads: 0, objectUrls: 3 });
  assert.deepEqual(f.calls.metadata[0].filters, { company_id: COMPANY });
  assert.deepEqual(f.calls.metadata[0].options, { count: 'exact' });
  assert.deepEqual(clone(f.read('mediaByCar["synthetic-car"].map(row=>[row.id,row.group,row.ownerId,!!row.url])')),
    rows.slice(0, 3).map(row => [row.id, row.group_name, alias(USER), true]));
  assert.equal(f.read('snote174VehicleDocumentSnapshot.complete'), true);
  assert.equal(f.read('snote174VehicleDocumentSnapshot.current()'), true);
  assert.deepEqual(clone(f.read('snote174VehicleDocumentSnapshot.groups.get(ownerAlias(S.user.id)+"\\u0000synthetic-car")')), ['registration', 'inspection1']);
  assert.equal(f.calls.renders, 1);
  assert.deepEqual(f.calls.events, ['snote:vehicle-documents-ready']);
});

test('failed document preview still retains authoritative document metadata and does not load a model fallback', async () => {
  const registration = record('real-registration', 'registration');
  const f = fixture(html, { rows: [registration, record('model-one', 'modelPhoto')], failedPaths: new Set([registration.file_path]) });
  await f.refresh();
  assert.deepEqual(f.summary(), { metadata: 1, modelMetadata: 0, downloads: 1, modelDownloads: 0, objectUrls: 0 });
  assert.deepEqual(clone(f.read('Object.keys(mediaByCar)')), []);
  assert.deepEqual(clone(f.read('snote174VehicleDocumentSnapshot.groups.get(ownerAlias(S.user.id)+"\\u0000synthetic-car")')), ['registration']);
  assert.equal(f.read('snote174VehicleDocumentSnapshot.complete'), true);
});

test('a held metadata response cannot download or render private data after the account changes', async () => {
  const gate = { started: deferred(), release: deferred() };
  const f = fixture(html, { rows: [record('real-photo')], metadataGate: gate });
  const outcome = f.refresh().then(() => null, error => error);
  await gate.started.promise;
  f.read('S.user={id:"22222222-2222-4222-8222-222222222222"};currentUser={username:ownerAlias(S.user.id),role:"accountant"};mediaByCar={"new-account-car":[{id:"new-account-file"}]};');
  gate.release.resolve();
  const error = await outcome;
  assert.equal(error.code, 'CONTEXT_CHANGED');
  assert.equal(f.calls.downloads.length, 0);
  assert.equal(f.calls.renders, 0);
  assert.deepEqual(clone(f.read('mediaByCar["new-account-car"].map(row=>row.id)')), ['new-account-file']);
});

test('late downloaded bytes cannot overwrite another company or revoke its current photo URL', async () => {
  const gate = { started: deferred(), release: deferred() };
  const f = fixture(html, { rows: [record('real-photo')], downloadGate: gate });
  const outcome = f.refresh().then(() => null, error => error);
  await gate.started.promise;
  f.read('S.company={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"};mediaByCar={"new-company-car":[{id:"current-file"}]};mediaObjectUrls=["blob:current-company"];');
  gate.release.resolve();
  const error = await outcome;
  assert.equal(error.code, 'CONTEXT_CHANGED');
  assert.equal(f.calls.created.length, 0);
  assert.deepEqual(f.calls.revoked, []);
  assert.equal(f.calls.renders, 0);
  assert.deepEqual(clone(f.read('mediaObjectUrls')), ['blob:current-company']);
  assert.deepEqual(clone(f.read('Object.keys(mediaByCar)')), ['new-company-car']);
});

test('local vehicle refresh reads only vehicle media and preserves the dormant model-photo store', async () => {
  const calls = [], created = [];
  const record = { id: 'local-car-photo', carId: 'local-car', ownerId: alias(USER), group: 'photos', blob: new Blob(['test']) };
  const context = vm.createContext({
    Promise, currentUser: { username: alias(USER) }, activeCarId: null,
    fileDB: { transaction(store, mode) {
      calls.push([store, mode]); return { objectStore() { return { getAll() { const request = {}; queueMicrotask(() => { request.result = [record]; request.onsuccess(); }); return request; } }; } };
    } },
    isAccountant: () => false, renderCars() {}, renderVehicle() {},
    URL: { createObjectURL() { created.push('blob:local'); return 'blob:local'; }, revokeObjectURL() {} },
    refreshModelPhotos() { throw Error('Dormant model photos must not be loaded by a local vehicle refresh'); }
  });
  vm.runInContext('let mediaObjectUrls=[],mediaByCar={},modelPhotoUrls=[],modelPhotos=[];\n' +
    section(html, 'async function refreshMedia(){', '\nfunction updateDB('), context);
  await context.refreshMedia();
  assert.deepEqual(calls, [['media', 'readonly']]);
  assert.deepEqual(created, ['blob:local']);
  assert.equal(vm.runInContext('mediaByCar["local-car"][0].id', context), 'local-car-photo');
  assert.match(fs.readFileSync(path.join(root, 'assets/snote-idb-compat.js'), 'utf8'), /modelPhotos:\s*\{\s*key:\s*'key'\s*\}/);
  assert.match(html, /async function modelPhotoRows\(/);
  assert.match(html, /saveReferencePhoto=async function/);
  assert.match(html, /importModelPhotoBundle=async function/);
  assert.match(html, /removeReferencePhoto=async function/);
});

test('controlled baseline comparison removes one model metadata read and all unused model byte work', { skip: !baseline && 'Set SNOTE_CLEANUP_BASELINE_HTML for a controlled pre-change comparison' }, async () => {
  const rows = [record('real-photo'), record('real-registration', 'registration'), ...Array.from({ length: 3 }, (_, i) => record('model-' + i, 'modelPhoto'))];
  const before = fixture(baseline, { rows }), after = fixture(html, { rows });
  await before.refresh(); await after.refresh();
  assert.deepEqual(before.summary(), { metadata: 2, modelMetadata: 1, downloads: 5, modelDownloads: 3, objectUrls: 5 });
  assert.deepEqual(after.summary(), { metadata: 1, modelMetadata: 0, downloads: 2, modelDownloads: 0, objectUrls: 2 });
  const project = f => clone(f.read('Object.values(mediaByCar).flat().map(row=>[row.id,row.group,row.filePath])'));
  assert.deepEqual(project(before), project(after));
  const receipt = { ok: true, syntheticOnly: true, operatingReads: 0, operatingWrites: 0, actualSourceFunctions: true,
    syntheticModelRows: 3, before: before.summary(), after: after.summary(), realVehicleMediaUnchanged: true,
    interpretation: 'Request and byte-work counts in a controlled fixture; not production timing measurements.' };
  const destination = process.env.SNOTE_MODEL_REFRESH_RECEIPT;
  if (destination) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(receipt, null, 2) + '\n'); }
});
