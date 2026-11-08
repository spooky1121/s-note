import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, OCR_UPLOAD_TIMEOUT_MS, OCR_REQUEST_TIMEOUT_MS } from '../functions/api/ocr.js';
const ORIGIN = 'https://s-note.example';
const ENV = { SUPABASE_URL: 'https://ocr-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-only-public-key', GOOGLE_VISION_API_KEY: 'test-only-vision-key' };
const USER = '11111111-1111-4111-8111-111111111111';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
function request(body = png, headers = {}) { return new Request(ORIGIN + '/api/ocr', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + JWT, 'Content-Type': 'image/png', ...headers }, body, duplex: 'half' }); }
function fixture(t, hook) {
  const calls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = new URL(url); calls.push({ target, options });
    assert.equal(options.redirect, 'manual'); assert(options.signal instanceof AbortSignal);
    if (hook) { const value = hook(target); if (value) return value; }
    if (target.pathname === '/auth/v1/user') return Response.json({ id: USER });
    if (target.pathname === '/rest/v1/zc_members') { assert.equal(target.searchParams.get('active'), 'eq.true'); return Response.json([{ user_id: USER }]); }
    assert.equal(target.origin, 'https://vision.googleapis.com');
    return Response.json({ responses: [{ fullTextAnnotation: { text: '검증용' } }] });
  };
  t.after(() => { globalThis.fetch = original; }); return calls;
}
test('OCR preserves successful authenticated PNG handling with bounded provider responses', async t => {
  const calls = fixture(t); const res = await onRequestPost({ request: request(), env: ENV });
  assert.equal(res.status, 200); assert.equal((await res.json()).engine, 'google-vision'); assert.equal(calls.length, 3);
});
test('OCR rejects cross-origin uploads before any Auth or billed provider request', async t => {
  const calls = fixture(t); const res = await onRequestPost({ request: request(png, { Origin: 'https://attacker.example' }), env: ENV });
  assert.equal(res.status, 403); assert.equal(calls.length, 0);
});
test('OCR rejects chunked images over 6 MiB before billed provider request and cancels stream', async t => {
  const calls = fixture(t); let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6 * 1024 * 1024)); c.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const res = await onRequestPost({ request: request(body), env: ENV });
  assert.equal(res.status, 413); assert.equal(cancelled, true); assert.equal(calls.length, 2);
});
test('OCR never follows an Auth redirect with credentials', async t => {
  const calls = fixture(t, url => url.pathname === '/auth/v1/user' && new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }));
  const res = await onRequestPost({ request: request(), env: ENV });
  assert.equal(res.status, 401); assert.equal(calls.length, 1); assert.equal(calls[0].target.origin, ENV.SUPABASE_URL);
});
test('OCR rejects oversized provider data as upstream error, not as invalid user upload', async t => {
  const calls = fixture(t, url => url.pathname === '/auth/v1/user' && new Response('x'.repeat(65537)));
  const res = await onRequestPost({ request: request(), env: ENV });
  assert.equal(res.status, 502); assert.equal(calls.length, 1); assert.equal((await res.text()).includes(ENV.GOOGLE_VISION_API_KEY), false);
});

test('OCR upload and provider deadlines preserve the existing 60s browser budget', async t => {
  fixture(t); const original = globalThis.setTimeout, delays = [];
  globalThis.setTimeout = (callback, delay, ...args) => { delays.push(delay); return original(callback, delay, ...args); };
  t.after(() => { globalThis.setTimeout = original; });
  const res = await onRequestPost({ request: request(), env: ENV });
  assert.equal(res.status, 200);
  assert.equal(OCR_UPLOAD_TIMEOUT_MS, 55000); assert.equal(OCR_REQUEST_TIMEOUT_MS, 58000);
  assert(OCR_UPLOAD_TIMEOUT_MS > 6 * 1024 * 1024 * 8 / 1000000 * 1000, 'A 6 MiB upload at 1 Mbps fits the upload budget');
  assert(OCR_REQUEST_TIMEOUT_MS < 60000); assert(delays.includes(OCR_UPLOAD_TIMEOUT_MS)); assert(delays.includes(OCR_REQUEST_TIMEOUT_MS));
});
