import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { operatorProviderStatus } from '../functions/_shared/operator-services.js';

// Synthetic credentials and provider replies only: no network or paid request.
const ENV = { SOLAPI_API_KEY: 'synthetic-key', SOLAPI_API_SECRET: 'synthetic-secret-never-returned' };
const NOW = Date.parse('2026-11-23T05:06:07.000Z');
const pricing = { countryId: '82', serviceMethod: 'MT', sms: 12.5, lms: 30, mms: 40, ata: 0 };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const byKey = result => Object.fromEntries(result.metrics.map(metric => [metric.key, metric]));
function fixture(overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.solapi.com');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
    assert(options.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Authorization']);
    const auth = /^HMAC-SHA256 apiKey=([^,]+), date=([^,]+), salt=([a-f0-9]{32}), signature=([a-f0-9]{64})$/u.exec(options.headers.Authorization);
    assert(auth); assert.equal(auth[1], ENV.SOLAPI_API_KEY); assert.equal(auth[2], new Date(NOW).toISOString());
    assert.equal(auth[4], createHmac('sha256', ENV.SOLAPI_API_SECRET).update(auth[2] + auth[3]).digest('hex'));
    const kind = url.pathname === '/cash/v1/balance' ? 'balance' : url.pathname === '/messages/v4/list' ? 'messages' : 'pricing';
    if (kind === 'pricing') {
      assert.equal(url.pathname, '/pricing/v1/messaging');
      assert.deepEqual([...url.searchParams], [['countryId', '82'], ['serviceMethod', 'MT']]);
    } else if (kind === 'messages') assert.equal(url.search, '?limit=20');
    else assert.equal(url.search, '');
    calls.push({ url, options });
    return overrides[kind] ? overrides[kind](url, options) : reply(kind === 'balance' ? { balance: 123456.75, point: 0 } : kind === 'messages' ? { messageList: {} } : pricing);
  };
  return { calls, fetchImpl, run: (extra = {}) => operatorProviderStatus(ENV, { service: 'sms', now: () => NOW, fetchImpl, ...extra }) };
}
function noSecrets(value) {
  const encoded = JSON.stringify(value);
  for (const secret of [...Object.values(ENV), 'PRIVATE_PROVIDER_BODY', 'Authorization', 'https://outside.example', 'GOOGLE_VISION_API_KEY', 'CLOUDFLARE_BROWSER_TOKEN']) assert(!encoded.includes(secret));
}

test('actual account balance and KR MT prices use signed fixed GETs, retaining true zero and decimals', async () => {
  const f = fixture(), result = await f.run(), metrics = byKey(result);
  assert.equal(f.calls.length, 3); assert.equal(result.status, 'ok'); assert.deepEqual(result.providerItems, []);
  assert.equal(metrics.balance.value, 123456.75); assert.equal(metrics.points.value, 0);
  assert.equal(metrics.smsUnitPrice.value, 12.5); assert.equal(metrics.lmsUnitPrice.value, 30); assert.equal(metrics.mmsUnitPrice.value, 40); assert.equal(metrics.alimtalkUnitPrice.value, 0);
  assert(result.notes.some(note => /고객 입력 안내는 LMS/u.test(note))); assert(result.notes.some(note => /알림톡 발송에는 채널·승인 템플릿/u.test(note)));
  for (const metric of result.metrics) {
    assert.equal(metric.asOf, new Date(NOW).toISOString()); assert.equal(metric.unit, '원'); assert.equal(metric.unavailableReason, null);
  }
  assert.notEqual(f.calls[0].options.headers.Authorization, f.calls[1].options.headers.Authorization, 'fresh salt for each GET');
  noSecrets(result);
});

test('unconfigured or malformed credentials never cause a request or invented zero balance', async () => {
  for (const env of [{}, null, { ...ENV, SOLAPI_API_KEY: 'bad,key' }, { ...ENV, SOLAPI_API_SECRET: 'bad\r\nheader' }, { ...ENV, SOLAPI_API_SECRET: '' }]) {
    let calls = 0;
    const result = await operatorProviderStatus(env, { service: 'sms', now: () => NOW, fetchImpl: async () => { calls++; throw Error('must not request'); } });
    assert.equal(calls, 0); assert.equal(result.status, 'unavailable');
    assert(result.metrics.every(metric => metric.value === null && metric.asOf === null && metric.unavailableReason)); noSecrets(result);
  }
});

test('missing numbers, numeric strings, booleans and null remain unknown rather than zero', async () => {
  const f = fixture({ balance: () => reply({ balance: null, point: '' }), pricing: () => reply({ ...pricing, sms: '12', lms: null, mms: false, ata: -1 }) });
  const result = await f.run(); assert.equal(result.status, 'unavailable');
  assert(result.metrics.every(metric => metric.value === null && metric.unavailableReason));
  const partial = await fixture({ balance: () => reply({ balance: 0 }) }).run();
  assert.equal(partial.status, 'degraded'); assert.equal(byKey(partial).balance.value, 0); assert.equal(byKey(partial).points.value, null);
  const { lms, ...withoutLms } = pricing;
  const absent = await fixture({ pricing: () => reply(withoutLms) }).run();
  assert.equal(absent.status, 'degraded'); assert.equal(byKey(absent).lmsUnitPrice.value, null); assert(byKey(absent).lmsUnitPrice.unavailableReason);
});

test('foreign-country or non-MT pricing is not reported as Korean outbound account pricing', async () => {
  for (const wrong of [{ countryId: '1' }, { serviceMethod: 'MO' }, { countryId: null }]) {
    const result = await fixture({ pricing: () => reply({ ...pricing, ...wrong }) }).run();
    assert.equal(result.status, 'degraded');
    for (const key of ['smsUnitPrice', 'lmsUnitPrice', 'mmsUnitPrice', 'alimtalkUnitPrice']) assert.equal(byKey(result)[key].value, null);
  }
});

test('read permission failure and provider 429 retain independently successful metrics without retries', async () => {
  for (const status of [401, 403, 429, 503]) {
    const f = fixture({ balance: () => reply({ error: 'PRIVATE_PROVIDER_BODY' }, status) }), result = await f.run();
    assert.equal(result.status, 'degraded'); assert.equal(f.calls.length, 3);
    assert.equal(byKey(result).balance.value, null); assert.equal(byKey(result).mmsUnitPrice.value, 40);
    if (status === 429) assert.match(byKey(result).balance.unavailableReason, /제한/u);
    if ([401, 403].includes(status)) assert.match(byKey(result).balance.unavailableReason, /권한/u);
    noSecrets(result);
  }
});

test('malformed, empty, non-object and oversized provider replies fail only their metrics', async () => {
  const responses = [
    () => new Response('PRIVATE_PROVIDER_BODY'), () => new Response(''), () => reply([]),
    () => reply({ padding: 'x'.repeat(512 * 1024 + 1) }),
    () => new Response('{}', { headers: { 'Content-Length': String(512 * 1024 + 1) } }),
    () => new Response(new Uint8Array([255]))
  ];
  for (const response of responses) {
    const result = await fixture({ balance: response }).run();
    assert.equal(result.status, 'degraded'); assert.equal(byKey(result).balance.value, null); noSecrets(result);
  }
});

test('redirects are never followed and secrets are not forwarded to an external origin', async () => {
  for (const status of [301, 302, 307, 308]) {
    const f = fixture({ balance: () => new Response(null, { status, headers: { Location: 'https://outside.example/PRIVATE_PROVIDER_BODY' } }) });
    const result = await f.run(); assert.equal(f.calls.length, 3); assert.equal(result.status, 'degraded'); noSecrets(result);
  }
});

test('network and AbortError failures are safe and do not reject the status page', async () => {
  for (const error of [new Error('PRIVATE_PROVIDER_BODY'), new Error('__proto__'), new Error('toString'), new DOMException('PRIVATE_PROVIDER_BODY', 'AbortError')]) {
    const result = await fixture({ balance: () => { throw error; }, pricing: () => { throw error; }, messages: () => { throw error; } }).run();
    assert.equal(result.status, 'unavailable'); assert(result.metrics.every(metric => metric.value === null && typeof metric.unavailableReason === 'string')); noSecrets(result);
  }
});

test('deadline completes even when the provider ignores abort and never resolves', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ balance: () => new Promise(() => {}), pricing: () => new Promise(() => {}), messages: () => new Promise(() => {}) });
  const pending = f.run();
  // Allow HMAC generation and fetch to begin before advancing the deadline.
  for (let i = 0; i < 20 && f.calls.length < 3; i++) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(12000);
  const result = await pending;
  assert.equal(result.status, 'unavailable'); assert(result.metrics.every(metric => /시간/u.test(metric.unavailableReason)));
  assert(f.calls.every(call => call.options.signal.aborted)); noSecrets(result);
});

test('recent provider messages expose only allowlisted metadata, never message text, OTP or custom fields', async () => {
  const messageId = 'M4VSYNTHETIC0001';
  const value = { messageId, to: '01012345678', type: 'MMS', status: 'COMPLETE', statusCode: '4000', dateCreated: '2026-11-23T14:00:00+09:00',
    text: 'PRIVATE_PROVIDER_BODY OTP 987654', subject: 'PRIVATE_PROVIDER_BODY', imageId: 'PRIVATE_PROVIDER_BODY',
    customFields: { customer: 'PRIVATE_PROVIDER_BODY' }, log: [{ message: 'PRIVATE_PROVIDER_BODY' }], reason: 'PRIVATE_PROVIDER_BODY',
    kakaoOptions: { buttons: [{ linkMo: 'https://outside.example/token' }] }, accountId: 'PRIVATE_PROVIDER_BODY' };
  const f = fixture({ messages: () => reply({ messageList: { [messageId]: value } }) }), result = await f.run();
  assert.equal(f.calls.length, 3); assert.equal(result.status, 'ok');
  assert.deepEqual(result.providerItems, [{ messageId, at: '2026-11-23T05:00:00.000Z', destination: '01012345678', type: 'MMS', status: 'COMPLETE (4000)' }]);
  assert(!JSON.stringify(result).includes('987654')); noSecrets(result);
});

test('recent history failures keep successful balance and prices and state the missing provider history', async () => {
  const failures = [() => reply({ error: 'PRIVATE_PROVIDER_BODY' }, 403), () => reply({}, 429), () => reply({}, 503),
    () => { throw new DOMException('PRIVATE_PROVIDER_BODY', 'AbortError'); }, () => new Response('PRIVATE_PROVIDER_BODY'),
    () => reply({ messageList: [] }), () => reply({})];
  for (const messages of failures) {
    const result = await fixture({ messages }).run();
    assert.equal(result.status, 'degraded'); assert.deepEqual(result.providerItems, []);
    assert.equal(byKey(result).balance.value, 123456.75); assert.equal(byKey(result).mmsUnitPrice.value, 40);
    assert(result.notes.some(note => /SOLAPI 최근 발송 내역을 조회하지 못했습니다/u.test(note))); noSecrets(result);
  }
});

test('provider metadata is bounded and sorted, rejects ID mismatch, and never labels processing complete as delivery success', async () => {
  const messageList = Object.fromEntries(Array.from({ length: 25 }, (_, i) => {
    const messageId = 'M4VSYNTHETIC' + String(i).padStart(3, '0');
    return [messageId, { messageId, dateCreated: new Date(NOW + i * 1000).toISOString(), to: '+821012345678', type: 'ATA', status: 'COMPLETE', statusCode: '3000' }];
  }));
  messageList.bad = { messageId: 'different-id', to: 'PRIVATE_PROVIDER_BODY' };
  messageList['<script>'] = { messageId: '<script>', to: 'PRIVATE_PROVIDER_BODY' };
  const result = await fixture({ messages: () => reply({ messageList }) }).run();
  assert.equal(result.providerItems.length, 20); assert.equal(result.providerItems[0].messageId, 'M4VSYNTHETIC024');
  assert.equal(result.providerItems.at(-1).messageId, 'M4VSYNTHETIC005');
  assert(result.providerItems.every(item => item.status === 'COMPLETE (3000)' && item.destination === '+821012345678'));
  const unknown = await fixture({ messages: () => reply({ messageList: { M4VUNKNOWN: { messageId: 'M4VUNKNOWN', to: '<script>', type: '<script>', status: '<script>', statusCode: '<script>', dateCreated: 'PRIVATE_PROVIDER_BODY' } } }) }).run();
  assert.deepEqual(unknown.providerItems, [{ messageId: 'M4VUNKNOWN', at: null, destination: '미확인', type: '미확인', status: '미확인' }]); noSecrets(result); noSecrets(unknown);
});

test('Vision, Encar and server status use config truth and no paid or analytics provider requests', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw Error('must not request'); };
  const ready = { GOOGLE_VISION_API_KEY: 'synthetic-vision', SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_BROWSER_TOKEN: 'synthetic-browser-only-token' };
  for (const service of ['vision', 'encar', 'server', 'unsupported']) {
    const missing = await operatorProviderStatus({}, { service, fetchImpl }), configured = await operatorProviderStatus(ready, { service, fetchImpl });
    assert.equal(missing.status, 'unavailable'); assert.deepEqual(missing.metrics, []);
    assert.equal(configured.status, ['vision', 'encar'].includes(service) ? 'ok' : 'unavailable');
    assert.deepEqual(configured.metrics, []); assert(configured.notes.length); noSecrets(configured);
  }
  const invalid = await operatorProviderStatus({ ...ready, CLOUDFLARE_ACCOUNT_ID: 'invalid' }, { service: 'encar', fetchImpl });
  assert.equal(invalid.status, 'unavailable'); assert.equal(calls, 0);
});
