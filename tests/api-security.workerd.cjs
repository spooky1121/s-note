'use strict';
// Compile with Wrangler's actual Pages router, then exercise it in workerd.
// NODE_PATH=/path/to/test-tools/node_modules node tests/api-security.workerd.cjs /tmp/snote-security-bundle/index.js
// Add --weather-only for the forecast route regression without OCR providers.
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
    modules: true, script: readFileSync(process.argv[2], 'utf8'), compatibilityDate: process.env.SNOTE_TEST_COMPATIBILITY_DATE || '2026-11-01', bindings: ENV, cf: false,
    serviceBindings: { ASSETS: () => new WorkerResponse('static-asset') },
    outboundService: async request => {
      upstream++; const url = new URL(request.url);
      if (url.origin === 'https://api.met.no') {
        assert.equal(url.pathname, '/weatherapi/locationforecast/2.0/compact');
        assert.equal(url.search, '?lat=37.5714&lon=126.9658');
        assert.equal(request.headers.get('User-Agent'), 'S-NOTE/2.176 (+https://s-note.pages.dev)');
        const now = Date.now(), start = Math.floor(now / 86400000) * 86400000;
        return WorkerResponse.json({ type: 'Feature', properties: {
          meta: { updated_at: new Date(now - 3600000).toISOString(), units: { air_temperature: 'celsius' } },
          timeseries: Array.from({ length: 43 }, (_, i) => ({ time: new Date(start + i * 21600000).toISOString(), data: {
            instant: { details: { air_temperature: [-4, 8, 4, 0][i % 4] } },
            ...(i === 42 ? {} : { next_6_hours: { summary: { symbol_code: 'partlycloudy_day' } } })
          } }))
        } }, { headers: { Expires: new Date(now + 3600000).toUTCString(), 'Last-Modified': new Date(now - 3600000).toUTCString() } });
      }
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
    if (!process.argv.includes('--weather-only')) {
      const crossOrigin = await fetch('/api/ocr', post({ Origin: 'https://attacker.example' })); assert.equal(crossOrigin.status, 403); assert.equal(upstream, 0);
      const success = await fetch('/api/ocr', post()); assert.equal(success.status, 200); assert.equal((await success.json()).engine, 'google-vision'); assert.equal(upstream, 3);
      assert.equal(success.headers.get('X-Frame-Options'), 'DENY'); assert.match(success.headers.get('Content-Security-Policy'), /default-src 'none'/);
      const huge = await fetch('/api/ocr', { ...post(), body: new Uint8Array(6 * 1024 * 1024 + 1) }); assert.equal(huge.status, 413); assert.equal(upstream, 3);
      // Health calls do not invoke billed providers. These synthetic IPs never leave this test.
      let blocked;
      for (let i = 0; i < 31; i++) blocked = await fetch('/api/ocr?nonce=' + i, { headers: { 'CF-Connecting-IP': '192.0.2.77' } });
      assert.equal(blocked.status, 429); assert(blocked.headers.get('Retry-After')); assert.equal(upstream, 3);
      const method = await fetch('/api/operator', { method: 'DELETE' }); assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'POST');
    }
    // Exercise the generated router and real middleware together: invoking the
    // forecast handler directly cannot catch a missing API_POLICIES entry.
    const beforeForecast = upstream;
    const forecast = await fetch('/api/weather-forecast?station=108', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(forecast.status, 200, await forecast.clone().text());
    const forecastBody = await forecast.json();
    assert.equal(forecastBody.ok, true); assert.equal(forecastBody.source, 'MET Norway');
    assert.equal(forecastBody.station, 108); assert.equal(forecastBody.days.length, 7);
    assert.equal(forecast.headers.get('X-Frame-Options'), 'DENY'); assert.match(forecast.headers.get('Cache-Control'), /no-store/);
    assert.equal(upstream, beforeForecast + 1);
    assert.equal((await fetch('/api/weather-forecast?station=108')).status, 200);
    assert.equal(upstream, beforeForecast + 1, 'Repeated routed requests reuse the provider cache');
    assert.equal((await fetch('/api/weather-forecast?station=108', { method: 'POST' })).status, 405);
    assert.equal((await fetch('/api/weather-forecast?station=108', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch('/api/weather-forecast?station=999')).status, 400);
    assert.equal(upstream, beforeForecast + 1, 'Rejected requests never contact the provider');
    console.log('PASS workerd actual Pages router: API middleware + static isolation, unknown route, routed seven-day forecast/cache, method/origin/station boundaries and response headers; synthetic network only.' + (process.argv.includes('--weather-only') ? ' Forecast-only mode.' : ' OCR, payload size and burst limits also passed.'));
  } finally { await runtime.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
