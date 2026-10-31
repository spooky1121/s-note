'use strict';

// Run the actual Cloudflare workerd runtime: Node fetch accepts redirect:"error",
// but workerd rejects it before any outbound request. All upstream HTTP is mocked.
// Install test tools OUTSIDE this static Pages repository (do not add a root manifest):
//   npm install --prefix /tmp/snote-runtime-tests --no-save --no-audit --no-fund \
//     miniflare@5.20261019.2-beta undici@7.29.1
//   NODE_PATH=/tmp/snote-runtime-tests/node_modules node tests/customer-intake.workerd.cjs
// Requires Node.js 22+. Never provide real Supabase or SOLAPI credentials here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Miniflare, Response: MiniflareResponse, convertV4MiniflareOptions } = require('miniflare');
const { MockAgent, fetch: mockFetch } = require('undici');

const SOURCE = path.resolve(__dirname, '..', 'functions', 'api', 'customer-intake.js');
const ENV = {
  SUPABASE_URL: 'https://intake-runtime-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  CUSTOMER_INTAKE_PUBLIC_ORIGIN: 'https://intake.example',
  SOLAPI_API_KEY: 'test-solapi-key',
  SOLAPI_API_SECRET: 'test-solapi-secret',
  CUSTOMER_INTAKE_OTP_SECRET: 'test-only-otp-secret-at-least-32-characters',
  SOLAPI_SENDER: '0212345678'
};
const ID = '12345678-1234-4234-8234-123456789abc';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const CAR = { model: '가상 테스트 차량', plate: '000가0000', year: 2026, km: 1000, color: '흰색', sell: 1200 };
const REDIRECT_ORIGIN = 'https://redirect-target.invalid';

function parseBody(value) {
  return JSON.parse(typeof value === 'string' ? value : Buffer.from(value || []).toString());
}
function reply(data, statusCode = 200, headers = {}) {
  return {
    statusCode,
    data: JSON.stringify(data),
    responseOptions: { headers: { 'content-type': 'application/json', ...headers } }
  };
}

async function scenario(kind) {
  const mock = new MockAgent();
  mock.disableNetConnect();
  const outbound = [];
  const calls = [];
  let redirectTargetRequests = 0;
  mock.get(REDIRECT_ORIGIN).intercept({ path: '/capture', method: () => true }).reply(() => {
    redirectTargetRequests++;
    return reply({ ok: true });
  }).persist();
  mock.get(ENV.SUPABASE_URL).intercept({
    path: '/rest/v1/rpc/snote_intake_create', method: 'POST'
  }).reply(options => {
    calls.push({ kind: 'create', body: parseBody(options.body) });
    return kind === 'supabase-redirect'
      ? reply({}, 302, { location: REDIRECT_ORIGIN + '/capture' })
      : reply({ ok: true, id: ID, car: CAR, companyName: '가상 테스트 상사', expiresAt: '2026-11-02T00:00:00Z' });
  });
  if (kind !== 'supabase-redirect') {
    mock.get('https://api.solapi.com').intercept({
      path: '/messages/v4/send', method: 'POST'
    }).reply(options => {
      calls.push({ kind: 'sms', body: parseBody(options.body) });
      return kind === 'solapi-redirect'
        ? reply({}, 302, { location: REDIRECT_ORIGIN + '/capture' })
        : reply({ statusCode: '2000', messageId: 'M4V_workerd_test' });
    });
    mock.get(ENV.SUPABASE_URL).intercept({
      path: '/rest/v1/rpc/snote_intake_delivery', method: 'POST'
    }).reply(options => {
      calls.push({ kind: 'delivery', body: parseBody(options.body) });
      return reply({ ok: true });
    });
  }

  const options = {
    modules: true,
    script: fs.readFileSync(SOURCE, 'utf8') +
      '\nexport default { fetch(request, env) { return onRequest({ request, env }); } };',
    compatibilityDate: '2026-10-24',
    bindings: ENV,
    cf: false,
    outboundService: async request => {
      outbound.push({
        url: request.url,
        authorization: request.headers.get('Authorization'),
        apikey: request.headers.get('apikey')
      });
      const response = await mockFetch(request.url, {
        method: request.method,
        headers: Array.from(request.headers),
        ...(request.method === 'GET' || request.method === 'HEAD' ? {} : {
          body: new Uint8Array(await request.arrayBuffer())
        }),
        dispatcher: mock,
        // This is a raw transport shim. Let workerd itself apply redirect policy;
        // following here would hide that policy and produce a false test result.
        redirect: 'manual'
      });
      return new MiniflareResponse(await response.arrayBuffer(), {
        status: response.status, headers: Array.from(response.headers)
      });
    }
  };
  // Miniflare 5 uses worker config objects; older versions accept this API directly.
  const runtimeOptions = typeof convertV4MiniflareOptions === 'function'
    ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } }
    : options;
  let runtime;
  try {
    runtime = new Miniflare(runtimeOptions);
    const configured = await runtime.dispatchFetch('https://intake.example/api/customer-intake', {
      headers: { Origin: 'https://intake.example' }
    });
    assert.equal(configured.status, 200);
    assert.equal((await configured.json()).configured, true);
    const response = await runtime.dispatchFetch('https://intake.example/api/customer-intake', {
      method: 'POST',
      headers: {
        Origin: 'https://intake.example', 'Content-Type': 'application/json',
        Authorization: 'Bearer ' + JWT
      },
      body: JSON.stringify({ action: 'create', carId: 'test-car-1', phone: '01012345678' })
    });
    const result = await response.json();
    assert.equal(redirectTargetRequests, 0, 'Never follow an upstream redirect');
    assert(!outbound.some(item => new URL(item.url).origin === REDIRECT_ORIGIN),
      'Neither authorization headers nor request data may reach the redirect target');
    assert.equal(outbound[0].apikey, ENV.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(outbound[0].authorization, 'Bearer ' + JWT);
    if (kind === 'supabase-redirect') {
      assert.equal(response.status, 502);
      assert.equal(result.ok, undefined);
      assert.deepEqual(calls.map(call => call.kind), ['create']);
    } else {
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.ok, true);
      assert.deepEqual(calls.map(call => call.kind), ['create', 'sms', 'delivery']);
      assert.equal(calls[1].body.message.type, 'LMS');
      assert.match(outbound[1].authorization, /^HMAC-SHA256 apiKey=/);
      assert.equal(outbound[2].apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(outbound[2].authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
      const delivery = kind === 'solapi-redirect' ? 'unknown' : 'sent';
      assert.equal(result.request.deliveryStatus, delivery);
      assert.equal(calls[2].body.p_status, delivery);
    }
    console.log('PASS actual workerd: ' + kind + '; redirect target requests=0');
  } finally {
    await runtime?.dispose();
    await mock.close();
  }
}

(async () => {
  for (const kind of ['accepted', 'supabase-redirect', 'solapi-redirect']) await scenario(kind);
  console.log('PASS 3/3 actual-source workerd scenarios; real upstream networking disabled');
})().catch(error => {
  console.error(error.name + ': ' + String(error.message).slice(0, 1600));
  process.exitCode = 1;
});
