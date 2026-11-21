'use strict';
// Compile with Wrangler's actual Pages router, then exercise it in workerd.
// NODE_PATH=/path/to/test-tools/node_modules node tests/api-security.workerd.cjs /tmp/snote-security-bundle/index.js
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require('miniflare');
const ORIGIN = 'https://s-note.example', JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const ENV = { SUPABASE_URL: 'https://ocr-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-only-public-key', GOOGLE_VISION_API_KEY: 'test-only-vision-key' };
const USER = '11111111-1111-4111-8111-111111111111';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
(async () => {
  let upstream = 0;
  const options = {
    modules: true, script: readFileSync(process.argv[2], 'utf8'), compatibilityDate: '2026-11-01', bindings: ENV, cf: false,
    serviceBindings: { ASSETS: () => new WorkerResponse('static-asset') },
    outboundService: async request => {
      upstream++; const url = new URL(request.url);
      if (url.pathname === '/auth/v1/user') return WorkerResponse.json({ id: USER });
      if (url.pathname === '/rest/v1/zc_members') return WorkerResponse.json([{ user_id: USER }]);
      assert.equal(url.origin, 'https://vision.googleapis.com');
      return WorkerResponse.json({ responses: [{ fullTextAnnotation: { text: '합성 검증' } }] });
    }
  };
  const runtime = new Miniflare(typeof convertV4MiniflareOptions === 'function' ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options);
  const fetch = (path, options = {}) => runtime.dispatchFetch(ORIGIN + path, options);
  const post = (extra = {}) => ({ method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + JWT, 'Content-Type': 'image/png', ...extra }, body: png });
  try {
    const staticFile = await fetch('/assets/money.js'); assert.equal(await staticFile.text(), 'static-asset');
    const unknown = await fetch('/api/not-a-route'); assert.equal(unknown.status, 404); assert.equal((await unknown.json()).code, 'NOT_FOUND');
    const crossOrigin = await fetch('/api/ocr', post({ Origin: 'https://attacker.example' })); assert.equal(crossOrigin.status, 403); assert.equal(upstream, 0);
    const success = await fetch('/api/ocr', post()); assert.equal(success.status, 200); assert.equal((await success.json()).engine, 'google-vision'); assert.equal(upstream, 3);
    assert.equal(success.headers.get('X-Frame-Options'), 'DENY'); assert.match(success.headers.get('Content-Security-Policy'), /default-src 'none'/);
    const huge = await fetch('/api/ocr', { ...post(), body: new Uint8Array(6 * 1024 * 1024 + 1) }); assert.equal(huge.status, 413); assert.equal(upstream, 3);
    // Health calls do not invoke billed providers. These synthetic IPs never leave this test.
    let blocked;
    for (let i = 0; i < 31; i++) blocked = await fetch('/api/ocr?nonce=' + i, { headers: { 'CF-Connecting-IP': '192.0.2.77' } });
    assert.equal(blocked.status, 429); assert(blocked.headers.get('Retry-After')); assert.equal(upstream, 3);
    const method = await fetch('/api/operator', { method: 'DELETE' }); assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'POST');
    console.log('PASS workerd actual Pages router: API middleware + static isolation, unknown route, origin/auth boundaries, valid OCR, oversize refusal before providers, IP/path burst limit and response headers; synthetic network only.');
  } finally { await runtime.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
