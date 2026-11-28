'use strict';
// Actual built Pages router/middleware and native Worker fetch/crypto/btoa.
// All Supabase and Google transport is synthetic; no real outbound requests.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Miniflare, Response: WR, convertV4MiniflareOptions } = require('miniflare');
const ORIGIN = 'https://scanner-analysis-worker.example';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = '11111111-1111-4111-8111-111111111111', SESSION = '22222222-2222-4222-8222-222222222222';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c3ludGhldGlj';
const ENV = { SUPABASE_URL: 'https://scanner-fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-publishable', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-only', GOOGLE_VISION_API_KEY: 'synthetic-google-key' };
const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const HASH = createHash('sha256').update(IMAGE).digest('hex');
const ROW = id => ({ id, revision: 1, filename: 'synthetic.png', mimeType: 'image/png', size: IMAGE.length, createdAt: '2026-11-28T00:00:00.000123Z', updatedAt: '2026-11-28T00:00:00.000123Z' });
function annotation() {
  return { text: 'synthetic-private-OCR-text', pages: [{ width: 1000, height: 1400, blocks: [{ paragraphs: [{ words: [{ confidence: .99, boundingBox: { vertices: [{ x: 900, y: 100 }, { x: 900, y: 400 }, { x: 850, y: 400 }, { x: 850, y: 100 }] }, symbols: [...'자동차등록증'].map(text => ({ text })) }] }] }] }] };
}
async function builtScript(file) {
  const bytes = fs.readFileSync(file), first = bytes.subarray(0, bytes.indexOf('\r\n')).toString();
  if (!first.startsWith('--')) return bytes.toString();
  const form = await new Response(bytes, { headers: { 'Content-Type': 'multipart/form-data; boundary=' + first.slice(2) } }).formData();
  const metadata = JSON.parse(form.get('metadata')), main = form.get(metadata.main_module);
  assert(main && typeof main.text === 'function', 'Wrangler bundle must contain its declared main module');
  const script = await main.text();
  fs.writeFileSync(path.join(path.dirname(file), 'worker-entry.mjs'), script);
  return script;
}
(async () => {
  const records = new Map(), observations = [], calls = [];
  let active = true, googleCalls = 0, readChecks = 0, storageReads = 0, providerMode = 'success';
  const options = {
    modules: true, script: await builtScript(process.argv[2]), compatibilityDate: process.env.SNOTE_TEST_COMPAT_DATE || '2026-10-24', cf: false, bindings: ENV,
    serviceBindings: { ASSETS: () => new WR('synthetic-static') },
    outboundService: async request => {
      const url = new URL(request.url), reply = (body, status = 200) => WR.json(body, { status });
      calls.push({ origin: url.origin, path: url.pathname });
      if (url.origin === 'https://vision.googleapis.com') {
        googleCalls++;
        assert.equal(request.method, 'POST'); assert.equal(url.pathname, '/v1/images:annotate'); assert.equal(url.searchParams.get('key'), ENV.GOOGLE_VISION_API_KEY);
        assert.equal(request.headers.has('Authorization'), false); assert.equal(request.headers.has('apikey'), false);
        const body = await request.json(); assert.deepEqual(Object.keys(body), ['requests']); assert.equal(body.requests.length, 1);
        assert.deepEqual(body.requests[0].features, [{ type: 'DOCUMENT_TEXT_DETECTION' }]);
        assert.deepEqual(Buffer.from(body.requests[0].image.content, 'base64'), IMAGE);
        assert.deepEqual(Object.keys(body.requests[0].image), ['content']);
        assert.deepEqual(body.requests[0].imageContext.languageHints, ['ko', 'en']);
        if (providerMode === 'error') return reply({ responses: [{ error: { code: 13, message: 'synthetic-private-provider-error' } }] });
        if (providerMode === 'blank') return reply({ responses: [{}] });
        return reply({ responses: [{ fullTextAnnotation: annotation() }] });
      }
      assert.equal(url.origin, ENV.SUPABASE_URL, 'No real outbound service');
      if (url.pathname === '/rest/v1/rpc/snote_office_context') {
        const body = await request.json(); assert.equal(request.headers.get('apikey'), ENV.SUPABASE_PUBLISHABLE_KEY); assert.equal(request.headers.get('Authorization'), 'Bearer ' + JWT);
        if (!active || body.p_company !== COMPANY) return reply({ code: '42501' }, 403);
        return reply({ ok: true, companyId: COMPANY, actorId: ACTOR, sessionId: SESSION });
      }
      if (url.pathname === '/rest/v1/rpc/snote_scanner_action') {
        const body = await request.json(); assert.equal(request.headers.get('Authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(body.p_actor, ACTOR); assert.equal(body.p_session, SESSION); assert.equal(body.p_company, COMPANY); assert.equal(body.p_action, 'read');
        readChecks++;
        if (!active) return reply({ code: '42501' }, 403);
        const row = records.get(body.p_payload.id);
        if (!row || row.revision !== body.p_payload.revision) return reply({ code: '40001' }, 409);
        return reply({ ok: true, companyId: COMPANY, item: row, path: COMPANY + '/inbox/' + row.id + '.png', sha256: HASH });
      }
      if (url.pathname === '/rest/v1/rpc/snote_service_event') {
        const body = await request.json(); observations.push(body.p_event);
        assert.equal(body.p_event.service, 'vision'); assert.equal(body.p_event.userId, ACTOR);
        for (const secret of [ENV.GOOGLE_VISION_API_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY, 'synthetic-private', 'fullTextAnnotation', 'boundingBox', COMPANY]) assert(!JSON.stringify(body).includes(secret));
        return reply({ ok: true });
      }
      const prefix = '/storage/v1/object/snote-scanner-inbox/' + COMPANY + '/inbox/';
      assert(url.pathname.startsWith(prefix)); assert.equal(request.method, 'GET'); assert.equal(request.headers.get('Authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
      const id = url.pathname.slice(prefix.length).replace(/\.png$/, ''); assert(records.has(id)); storageReads++;
      return new WR(IMAGE, { headers: { 'Content-Type': 'image/png' } });
    }
  };
  const mf = new Miniflare(typeof convertV4MiniflareOptions === 'function' ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options);
  const seed = () => { const row = ROW(randomUUID()); records.set(row.id, row); return row; };
  const send = async (row, { companyId = COMPANY, headers = {}, extra = {} } = {}) => {
    const response = await mf.dispatchFetch(ORIGIN + '/api/scanner-analysis', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ companyId, id: row.id, revision: row.revision, ...extra }) });
    const body = await response.json();
    assert.match(response.headers.get('Cache-Control'), /no-store/); assert.match(response.headers.get('Cache-Control'), /private/);
    for (const secret of [ENV.GOOGLE_VISION_API_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY, 'synthetic-private', 'fullTextAnnotation', 'boundingBox', 'snote-scanner-inbox']) assert(!JSON.stringify(body).includes(secret));
    return { status: response.status, body };
  };
  const checks = [];
  try {
    const row = seed();
    assert.equal((await send(row, { headers: { Authorization: '' } })).status, 401);
    assert.equal((await send(row, { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await send(row, { extra: { url: 'https://forbidden.invalid/private.png' } })).status, 400);
    assert.equal(calls.length, 0); checks.push('middleware bearer/origin/body injection guards');
    const first = await send(row); assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body, { ok: true, analysis: { documentType: 'registration', label: '자동차 등록증', rotation: 270, orientation: 'landscape', needsReview: false } });
    assert.equal(googleCalls, 1); assert.equal(storageReads, 1); const afterFirst = readChecks;
    checks.push('authorized immutable bytes → native Worker btoa → DOCUMENT_TEXT_DETECTION → classification/rotation metadata');
    assert.deepEqual((await send(row)).body, first.body); assert.equal(googleCalls, 1); assert.equal(storageReads, 1); assert(readChecks >= afterFirst + 2);
    checks.push('cache retains one provider call and rechecks live permission for every response');
    assert.equal((await send(row, { companyId: FOREIGN })).status, 403);
    active = false; assert.equal((await send(row)).status, 403); active = true;
    records.delete(row.id); assert.equal((await send(row)).status, 409); assert.equal(googleCalls, 1);
    checks.push('foreign company, revoked actor and deleted document cannot reuse cached analysis');
    const second = seed(); providerMode = 'error';
    const failed = await send(second); assert.equal(failed.status, 502); assert.equal(failed.body.code, 'OCR_UPSTREAM'); assert.equal(failed.body.analysis, undefined);
    providerMode = 'blank'; const blank = await send(second); assert.equal(blank.status, 200); assert.equal(blank.body.analysis.label, '미분류'); assert.equal(googleCalls, 3);
    checks.push('provider errors stay distinct from successful unclassified OCR and retry succeeds');
    const result = { ok: true, runtime: 'native Pages/workerd', checks, googleCalls, storageReads, readChecks, bundleSha256: createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'), entrySha256: createHash('sha256').update(options.script).digest('hex'), syntheticOnly: true, productionReads: 0, productionWrites: 0 };
    const output = process.env.SNOTE_SCANNER_ANALYSIS_WORKER_RESULT || '/workspace/work/scanner-ocr-v2257/scanner-analysis-workerd-results.json';
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await mf.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
