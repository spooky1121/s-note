import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { API_POLICIES, createBurstLimiter, inspectAPIRequest, readBoundedBytes } from '../functions/_shared/api-security.js';
import { onRequest } from '../functions/api/_middleware.js';
const ORIGIN = 'https://s-note.example';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const request = (path = '/api/ocr', options = {}) => new Request(ORIGIN + path, options);
const post = (headers = {}) => request('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: 'Bearer ' + JWT, ...headers }, body: 'image' });
test('every deployed API has an explicit middleware policy', () => {
  const names = readdirSync(new URL('../functions/api/', import.meta.url)).filter(n => n.endsWith('.js') && n !== '_middleware.js').map(n => '/api/' + n.slice(0, -3));
  assert.deepEqual(names.sort(), Object.keys(API_POLICIES).sort());
});
test('reject cross-origin and same-site subdomains before dispatch', async () => {
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    let called = false;
    const res = await onRequest({ request: post(headers), next: () => { called = true; } });
    assert.equal(res.status, 403); assert.equal(called, false);
  }
  assert.equal(inspectAPIRequest(post({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' })).response, undefined);
  assert.equal(inspectAPIRequest(post()).response, undefined); // Non-browser clients still undergo Auth checks downstream.
});
test('method, auth, length, encoding and media type are checked before providers', () => {
  assert.equal(inspectAPIRequest(request('/api/missing')).response.status, 404);
  assert.equal(inspectAPIRequest(request('/api/ocr', { method: 'DELETE' })).response.status, 405);
  assert.equal(inspectAPIRequest(post({ Authorization: 'Bearer forged' })).response.status, 401);
  for (const length of ['-1', 'NaN', '6291457']) assert.equal(inspectAPIRequest(post({ 'Content-Length': length })).response.status, 413);
  assert.equal(inspectAPIRequest(post({ 'Content-Type': 'text/plain' })).response.status, 415);
  assert.equal(inspectAPIRequest(post({ 'Content-Encoding': 'gzip' })).response.status, 415);
  assert.equal(inspectAPIRequest(request('/api/customer-intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response, undefined);
  assert.equal(inspectAPIRequest(request('/api/vehicle-taxonomy-probe?companyId=example')).response.status, 401);
});
test('limited byte reader stops chunked oversize without trusting Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); c.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
  const message = new Response(stream, { headers: { 'Content-Length': '1' } });
  await assert.rejects(readBoundedBytes(message, 6), e => e.code === 'PAYLOAD_TOO_LARGE');
  assert.equal(cancelled, true);
  assert.deepEqual([...await readBoundedBytes(new Response(new Uint8Array([1, 2, 3])), 3)], [1, 2, 3]);
});
test('slow body times out and cancels instead of retaining a reader', async () => {
  let cancelled = false;
  await assert.rejects(readBoundedBytes(new Response(new ReadableStream({ cancel() { cancelled = true; } })), 10, { timeoutMs: 5 }), e => e.code === 'REQUEST_TIMEOUT');
  assert.equal(cancelled, true);
});
test('burst brake cannot be bypassed by changing JWT/query; resets and caps memory', async () => {
  let now = 0; const limiter = createBurstLimiter({ now: () => now, maxEntries: 2 }), policy = { limit: 2 };
  const req = (ip, suffix = '') => request('/api/weather' + suffix, { headers: { 'CF-Connecting-IP': ip } });
  assert.equal(limiter(req('192.0.2.1'), '/api/weather', policy), null);
  assert.equal(limiter(req('192.0.2.1', '?refresh=1'), '/api/weather', policy), null);
  const blocked = limiter(req('192.0.2.1', '?random=2'), '/api/weather', policy);
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(limiter(req('192.0.2.2'), '/api/weather', policy), null);
  assert.equal(limiter(req('192.0.2.3'), '/api/weather', policy), null, 'Saturated tracking never denies unrelated new clients');
  now = 60001; assert.equal(limiter(req('192.0.2.3'), '/api/weather', policy), null);
});
test('API success, provider errors and exceptions all receive security headers', async () => {
  for (const next of [() => new Response('ok', { status: 200, headers: { 'Retry-After': '20' } }), () => new Response('{}', { status: 503 }), () => { throw Error('secret-provider-key'); }]) {
    const res = await onRequest({ request: request('/api/weather'), next });
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(res.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
    assert.match(res.headers.get('Cache-Control'), /no-store/);
    assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.equal((await res.text()).includes('secret-provider-key'), false);
  }
});
test('static browser baseline preserves stricter customer/popup policies and avoids permissive script CSP', () => {
  const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  assert.match(headers, /\/\*\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'self'/);
  assert.match(headers, /\/operator\*[\s\S]*script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(headers, /\/monthly\*[\s\S]*frame-ancestors 'self'/);
  assert.match(headers, /\/customer\*[\s\S]*frame-ancestors 'none'/);
  assert.equal(headers.includes("script-src 'self' 'unsafe-inline'"), false);
});

test('missing edge IP never trusts a caller-controlled forwarded IP or creates a shared denial bucket', () => {
  const limiter = createBurstLimiter(), policy = { limit: 1 };
  for (let i = 0; i < 3; i++) {
    const req = request('/api/weather', { headers: { 'X-Forwarded-For': '192.0.2.1' } });
    assert.equal(limiter(req, '/api/weather', policy), null);
  }
});
