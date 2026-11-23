'use strict';
// Run the actual Pages router/middleware and native Worker FormData/crypto.
// NODE_PATH=/path/to/tool-deps node tests/registration.workerd.cjs /tmp/pages/index.js
// Every backend response is synthetic; no email, Storage or Auth service is contacted.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require('miniflare');
const ORIGIN = 'https://registration-fixture.example';
const ENV = {
  SUPABASE_URL: 'https://registration-fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-service-key'
};
const EMAIL = 'new-dealer@example.invalid', PASSWORD = 'SyntheticSignup!123';
const USER = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const profile = { kind: 'dealer', companyName: '가상 신규 상사', businessNumber: '1234567890', representativeName: '가상 대표', businessAddress: '가상시 가상로 1', displayName: '가상 딜러', phone: '01012345678', email: EMAIL };

(async () => {
  const calls = []; let prepared = null, rejectCompany = false;
  const options = {
    modules: true, script: readFileSync(process.argv[2], 'utf8'), compatibilityDate: process.env.SNOTE_TEST_COMPAT_DATE || '2026-10-24', cf: false, bindings: ENV,
    serviceBindings: { ASSETS: () => new WorkerResponse('synthetic-static') },
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, ENV.SUPABASE_URL, 'No redirect or real service may receive registration data');
      calls.push(url.pathname);
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        assert.equal(request.headers.get('apikey'), ENV.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(request.headers.get('Authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
        const body = await request.json();
        assert(!JSON.stringify(body).includes(PASSWORD), 'Passwords cannot reach database RPCs');
        const rpc = url.pathname.split('/').pop();
        if (rpc === 'snote_registration_rate_limit') { assert.match(body.p_key, /^[a-f0-9]{64}$/); assert(!JSON.stringify(body).includes('192.0.2.189')); return WorkerResponse.json({ ok: true }); }
        if (rpc === 'snote_registration_company_check') { assert.equal(body.p_name, profile.companyName); return WorkerResponse.json({ ok: true, available: true }); }
        if (rpc === 'snote_registration_prepare') {
          if (rejectCompany) return WorkerResponse.json({ code: 'P0001', message: 'COMPANY_EXISTS' }, { status: 400 });
          prepared = body;
          assert.equal(body.p_profile.kind, 'dealer'); assert.equal(body.p_profile.email, EMAIL);
          assert.equal(body.p_documents.length, 2);
          assert.deepEqual(body.p_documents.map(d => d.slot).sort(), ['business', 'dealer']);
          for (const doc of body.p_documents) { assert(doc.path.startsWith(body.p_id + '/' + doc.slot + '/')); assert.match(doc.sha256, /^[a-f0-9]{64}$/); assert.equal(doc.size, PNG.length); }
          return WorkerResponse.json({ ok: true, id: body.p_id });
        }
        if (rpc === 'snote_registration_ready') { assert.equal(body.p_id, prepared.p_id); assert.equal(calls.filter(p => p.startsWith('/storage/v1/object/snote-registration-documents/' + prepared.p_id + '/')).length, 2); return WorkerResponse.json({ ok: true }); }
        throw Error('Unexpected RPC: ' + rpc);
      }
      if (url.pathname.startsWith('/storage/v1/object/snote-registration-documents/')) {
        assert.equal(request.method, 'POST'); assert.equal(request.headers.get('Authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(request.headers.get('Content-Type'), 'image/png'); assert.notEqual(request.headers.get('x-upsert'), 'true');
        const path = decodeURIComponent(url.pathname.split('/snote-registration-documents/')[1]); assert(prepared.p_documents.some(doc => doc.path === path));
        assert.deepEqual(Buffer.from(await request.arrayBuffer()), PNG);
        return WorkerResponse.json({ Key: 'synthetic-private-object' });
      }
      assert.equal(url.pathname, '/auth/v1/signup');
      assert.equal(request.headers.get('apikey'), ENV.SUPABASE_PUBLISHABLE_KEY);
      assert(!request.headers.get('Authorization')?.includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
      const body = await request.json(); assert.equal(body.email, EMAIL); assert.equal(body.password, PASSWORD);
      assert.equal(body.data.snote_registration.request_id, prepared.p_id);
      assert.equal(url.searchParams.get('redirect_to'), 'https://s-note.kr/');
      return WorkerResponse.json({ id: USER, email: EMAIL, identities: [{ id: USER, provider: 'email' }] });
    }
  };
  // Miniflare supports both v4 and v5; convert only where that API exists.
  const runtime = new Miniflare(typeof convertV4MiniflareOptions === 'function' ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options);
  const send = async (body, headers = {}, origin = ORIGIN) => {
    // Encode with the browser-compatible client Request first. The test tool's
    // Undici and Node have different FormData brands; the Worker receives HTTP bytes.
    const request = new Request(origin + '/api/registration', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.189', ...headers }, body });
    return runtime.dispatchFetch(request.url, { method: request.method, headers: request.headers, body: await request.arrayBuffer() });
  };
  const form = () => { const data = new FormData(); data.set('profile', JSON.stringify(profile)); data.set('password', PASSWORD); data.set('businessCertificate', new Blob([PNG], { type: 'image/png' }), 'business.png'); data.set('dealerLicense', new Blob([PNG], { type: 'image/png' }), 'dealer.png'); return data; };
  try {
    const health = await runtime.dispatchFetch(ORIGIN + '/api/registration', { headers: { Origin: ORIGIN } });
    assert.equal(health.status, 200); assert.equal((await health.json()).configured, true); assert.equal(calls.length, 0);
    const check = await send(JSON.stringify({ action: 'check-company', companyName: profile.companyName }), { 'Content-Type': 'application/json' });
    assert.equal(check.status, 200); assert.equal((await check.json()).available, true);
    const result = await send(form()), value = await result.json();
    assert.equal(result.status, 200, JSON.stringify(value)); assert.equal(value.confirmationRequired, true); assert.equal(value.session, null);
    assert(!JSON.stringify(value).includes(PASSWORD)); assert(!JSON.stringify(value).includes(ENV.SUPABASE_SERVICE_ROLE_KEY)); assert(!JSON.stringify(value).includes('snote-registration-documents'));
    assert.equal(calls.filter(path => path === '/auth/v1/signup').length, 1);
    for (const origin of ['https://zerocar-office.pages.dev', 'https://s-note.pages.dev', 'https://s-note.kr']) {
      const response = await send(form(), {}, origin), pending = await response.json();
      assert.equal(response.status, 200); assert.equal(pending.confirmationRequired, true);
    }
    assert.equal(calls.filter(path => path === '/auth/v1/signup').length, 4, 'All same-origin signup hosts send the same canonical confirmation return URL');
    assert.equal(calls.filter(path => path.startsWith('/storage/v1/object/')).length, 8, 'Every signup reserves and uploads both private documents before Auth');
    rejectCompany = true; const before = calls.length, duplicate = await send(form());
    assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).error, '등록되어 있는 상사입니다. 채팅으로 문의 부탁드립니다');
    assert(!calls.slice(before).some(path => path.startsWith('/storage/') || path.startsWith('/auth/')), 'A duplicate cannot upload or create Auth');
    const foreign = await send(JSON.stringify({ action: 'check-company', companyName: profile.companyName }), { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }); assert.equal(foreign.status, 403);
    console.log('PASS actual Pages/workerd registration: public route, JSON availability, native multipart images, private Storage, public-key Auth, canonical confirmation return from legacy/Pages/production hosts, duplicate-before-write, secret isolation and origin refusal; synthetic network only.');
  } finally { await runtime.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
