'use strict';
// Compiled Pages middleware/router with synthetic upstreams only.
const assert = require('node:assert/strict'), fs = require('node:fs');
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require('miniflare');
const ORIGIN = 'https://s-note.example';
const ENV = { SUPABASE_URL: 'https://recovery-runtime.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public',
 SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private', SOLAPI_API_KEY: 'synthetic_key', SOLAPI_API_SECRET: 'synthetic_secret',
 CUSTOMER_INTAKE_OTP_SECRET: 'synthetic-otp-key-at-least-thirty-two-characters' };
(async () => {
 const calls = [], body = { action: 'send-code', purpose: 'password', name: '합성 딜러', phone: '01000000000', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
 const options = { modules: true, script: fs.readFileSync(process.argv[2], 'utf8'),
  compatibilityDate: process.env.SNOTE_TEST_COMPAT_DATE || '2026-11-01', bindings: ENV, cf: false,
  serviceBindings: { ASSETS: () => new WorkerResponse('synthetic static') },
  outboundService: async request => {
   const url = new URL(request.url); calls.push(url.pathname);
   assert.equal(url.origin, ENV.SUPABASE_URL);
   assert.equal(url.pathname, '/rest/v1/rpc/snote_phone_recovery_prepare', 'No credential request may enter observers or other Auth/SMS paths');
   assert.equal(request.headers.get('Authorization'), 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
   const data = await request.json();
   assert.equal(data.p_phone, body.phone); assert.equal(data.p_name, body.name);
   assert.match(data.p_otp_hash, /^[a-f0-9]{64}$/); assert.match(data.p_ip_hash, /^[a-f0-9]{64}$/);
   return WorkerResponse.json({ ok: true, claimed: true, canSend: false, challengeId: data.p_challenge_id,
    expiresAt: new Date(Date.now() + 300000).toISOString() });
  }
 };
 const runtime = new Miniflare(typeof convertV4MiniflareOptions === 'function' ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options);
 const send = (payload, headers = {}) => runtime.dispatchFetch(ORIGIN + '/api/account-recovery', { method: 'POST',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10', ...headers }, body: payload });
 try {
  const denied = await send(JSON.stringify(body), { Origin: 'https://foreign.example' }); assert.equal(denied.status, 403);
  const malformed = await send('{'); assert.equal(malformed.status, 400);
  const get = await runtime.dispatchFetch(ORIGIN + '/api/account-recovery'); assert.equal(get.status, 405);
  assert.equal(calls.length, 0);
  const response = await send(JSON.stringify(body)); const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ data, calls }));
  assert.equal(data.ok, true); assert.equal(data.retryAfter, 60);
  assert.match(data.challengeId, /^[a-f0-9-]{36}$/); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(Object.keys(data).sort().join(','), 'challengeId,expiresAt,ok,retryAfter');
  assert.equal(calls.length, 1);
  assert(!JSON.stringify(data).includes(body.phone)); assert(!JSON.stringify(data).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
  console.log(JSON.stringify({ passed: 1, scope: 'compiled Pages recovery route, origin/body/method guards, generic ACK, observer exclusion',
   compatibilityDate: options.compatibilityDate, syntheticOnly: true, actualMessagesOrAuthChanges: 0 }));
 } finally { await runtime.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
