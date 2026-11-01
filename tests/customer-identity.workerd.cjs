'use strict';
// Actual Cloudflare runtime with strict fake Supabase responses; no real network or PII.
// Install miniflare and esbuild outside this static Pages repository.
// NODE_PATH=/path/to/test-tools/node_modules node tests/customer-identity.workerd.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require('miniflare');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://s-note.example';
const ENV = { SUPABASE_URL: 'https://identity-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-public-key', CUSTOMER_INTAKE_OTP_SECRET: 'test-server-secret-for-identity-'.repeat(2) };
const OWNER = '11111111-1111-4111-8111-111111111111';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const CAR = 'test-car-1';

(async () => {
  const bundle = await build({ stdin: {
    contents: "import { onRequest } from './functions/api/customer-identity.js'; export default {fetch(request,env){return onRequest({request,env});}};",
    resolveDir: ROOT, sourcefile: 'manual-identity-runtime.js'
  }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  let stored = '', redirectAuth = false;
  const outgoing = [];
  const options = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-24', bindings: ENV, cf: false,
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, ENV.SUPABASE_URL, 'Never contact a redirect target or SMS provider');
      assert.equal(request.method, 'GET', 'This API never splits customer writes across requests');
      assert.equal(request.headers.get('apikey'), ENV.SUPABASE_PUBLISHABLE_KEY);
      assert.equal(request.headers.get('Authorization'), 'Bearer ' + JWT);
      outgoing.push(url);
      if (url.pathname === '/auth/v1/user') return redirectAuth
        ? new WorkerResponse(null, { status: 302, headers: { Location: 'https://credential-target.invalid/capture' } })
        : WorkerResponse.json({ id: OWNER });
      if (url.pathname === '/rest/v1/zc_members') {
        assert.equal(url.searchParams.get('user_id'), 'eq.' + OWNER);
        return WorkerResponse.json([{ user_id: OWNER, company_id: COMPANY, role: 'dealer', active: true }]);
      }
      assert.equal(url.searchParams.get('company_id'), 'eq.' + COMPANY);
      assert.equal(url.searchParams.get('owner_id'), 'eq.' + OWNER);
      if (url.pathname === '/rest/v1/zc_datasets') return WorkerResponse.json([{ payload: [{ id: CAR, model: '테스트 차량', status: '판매중' }] }]);
      assert.equal(url.pathname, '/rest/v1/zc_customers');
      if (url.searchParams.get('select') === 'car_id') return WorkerResponse.json(stored ? [{ car_id: CAR }] : []);
      assert.equal(url.searchParams.get('select'), 'car_id,identity:payload->identityCipher');
      return WorkerResponse.json(stored ? [{ car_id: CAR, identity: stored }] : []);
    }
  };
  const config = typeof convertV4MiniflareOptions === 'function'
    ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options;
  const runtime = new Miniflare(config);
  const post = async body => {
    const response = await runtime.dispatchFetch(ORIGIN + '/api/customer-identity', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + JWT }, body: JSON.stringify(body)
    });
    assert.equal(response.headers.get('Cache-Control'), 'no-store, private, max-age=0');
    return { status: response.status, body: await response.json() };
  };
  try {
    const health = await runtime.dispatchFetch(ORIGIN + '/api/customer-identity', { headers: { Origin: ORIGIN } });
    assert.equal((await health.json()).configured, true, 'No SOLAPI/service key/additional secret required');
    for (const value of ['0001013000000', '1234567890']) {
      const encrypted = await post({ action: 'encrypt', carId: CAR, value });
      assert.equal(encrypted.status, 200);
      assert.match(encrypted.body.identityCipher, /^smi1\.[a-f0-9]{24}\.(?:[a-f0-9]{52}|[a-f0-9]{58})$/);
      assert.equal(JSON.stringify(encrypted.body).includes(value), false);
      stored = encrypted.body.identityCipher; // Simulates the caller's one atomic customer payload write.
      const read = await post({ action: 'read', carId: CAR });
      assert.equal(read.status, 200); assert.equal(read.body.value, value);
      const many = await post({ action: 'read-many', carIds: [CAR] });
      assert.equal(many.status, 200); assert.deepEqual(many.body.identities, [{ carId: CAR, value }]);
    }
    stored = stored.slice(0, -1) + (stored.endsWith('0') ? '1' : '0');
    const bad = await post({ action: 'read', carId: CAR });
    assert.equal(bad.status, 502); assert.equal(bad.body.code, 'IDENTITY_DECRYPT_FAILED');
    redirectAuth = true;
    const redirect = await post({ action: 'read', carId: CAR });
    assert.equal(redirect.status, 502); assert.equal(redirect.body.code, 'UPSTREAM_ERROR');
    assert(outgoing.every(url => url.origin === ENV.SUPABASE_URL));
    console.log('PASS actual workerd: manual identity 13/10-digit encryption, canonical reads/batch, row binding, tamper refusal, credential-safe redirect refusal; no real network');
  } finally { await runtime.dispose(); }
})().catch(error => { console.error(error.name + ': ' + String(error.message).slice(0, 1200)); process.exitCode = 1; });
