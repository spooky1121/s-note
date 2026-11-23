'use strict';
// Actual tracker with synthetic sessions, deterministic deadlines and no network/storage access.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const SOURCE = fs.readFileSync(path.join(__dirname, '../assets/access-tracker.js'), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE = 'https://synthetic-project.supabase.co', RPC = BASE + '/rest/v1/rpc/snote_access_logout_confirm';
const jwt = (claims = {}, header = { alg: 'HS256', typ: 'JWT' }) => Buffer.from(JSON.stringify(header)).toString('base64url') + '.' +
  Buffer.from(JSON.stringify({ sub: USER, session_id: SESSION, role: 'authenticated', exp: 4102444800, ...claims })).toString('base64url') + '.synthetic_signature';
const session = token => ({ user: { id: USER }, access_token: token || jwt() });
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(options = {}) {
  const calls = [], timers = new Map(), events = new Map(), forbidden = [];
  let serial = 0, reads = 0;
  const client = { supabaseUrl: BASE, auth: { getSession() { reads++; return options.getSession ? options.getSession() : Promise.resolve({ data: { session: session() }, error: null }); } },
    rpc() { throw Error('Use the captured direct transport after SDK signOut'); } };
  const context = { URL, AbortController, atob: value => Buffer.from(value, 'base64').toString('binary'),
    document: { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn) }, navigator: { onLine: true },
    addEventListener: (name, fn) => events.set(name, fn), setTimeout(fn, ms) { timers.set(++serial, { fn, ms }); return serial; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, init) { calls.push({ url, init }); return options.fetch ? options.fetch(url, init) : Promise.resolve({ ok: true, json: async () => ({ ok: true }) }); },
    console: { log() { forbidden.push('log'); throw Error('No credential logging'); }, error() { forbidden.push('error'); throw Error('No credential logging'); } } };
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(context, name, { get() { forbidden.push(name); throw Error('No persistence'); } });
  context.window = context; vm.runInNewContext(SOURCE, context);
  const args = { client, url: BASE, anonKey: 'synthetic-publishable-key', userId: USER, current: () => true };
  return { context, client, args, calls, timers, forbidden, tracker: context.SnoteAccessTracker, reads: () => reads,
    prepare(overrides = {}) { return context.SnoteAccessTracker.prepareSignOut({ ...args, ...overrides }); },
    run(ms) { const pair = [...timers].find(([, timer]) => timer.ms === ms); assert(pair, 'Missing timer ' + ms); timers.delete(pair[0]); pair[1].fn(); } };
}
function clean(f) { assert.equal(f.timers.size, 0); assert.deepEqual(f.forbidden, []); }

test('captures the real session before signOut and only sends when its one-shot confirmation is called', async () => {
  let signedOut = false;
  const token = jwt(), f = fixture({ getSession: async () => ({ data: { session: signedOut ? null : session(token) }, error: null }) });
  const confirm = await f.prepare(); assert.equal(typeof confirm, 'function'); assert.equal(f.reads(), 1); assert.equal(f.calls.length, 0); clean(f);
  signedOut = true; assert.equal(await confirm(), true); assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0]; assert.equal(url, RPC); assert.equal(init.method, 'POST'); assert.equal(init.body, '{}');
  assert.equal(init.headers.Authorization, 'Bearer ' + token); assert.equal(init.headers.apikey, f.args.anonKey);
  assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
  assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.keepalive, true); assert.equal(init.signal.aborted, false);
  assert.equal(await confirm(), false); assert.equal(f.calls.length, 1); clean(f);
});

test('confirmation does not depend on the intentionally cleared post-signout UI/session state', async () => {
  let current = true; const f = fixture(), confirm = await f.prepare({ current: () => current });
  current = false; f.client.auth.getSession = async () => ({ data: { session: null } });
  assert.equal(await confirm(), true); assert.equal(f.calls.length, 1); clean(f);
});

test('concurrent confirmation attempts cannot duplicate the captured request', async () => {
  const response = deferred(), f = fixture({ fetch: () => response.promise }), confirm = await f.prepare();
  const first = confirm(), second = confirm(); assert.equal(await second, false); assert.equal(f.calls.length, 1);
  response.resolve({ ok: true, json: async () => ({ ok: true }) }); assert.equal(await first, true); assert.equal(await confirm(), false); clean(f);
});

test('getSession has a one-second deadline and a late token cannot issue a request', async () => {
  const pending = deferred(), f = fixture({ getSession: () => pending.promise }), preparation = f.prepare();
  await settle(); assert.equal(f.reads(), 1); assert.equal(f.calls.length, 0); f.run(1000); assert.equal(await preparation, null); clean(f);
  pending.resolve({ data: { session: session() }, error: null }); await settle(); assert.equal(f.calls.length, 0); clean(f);
});

test('changed actor/client URL contexts and throwing current predicates fail closed before sending', async () => {
  for (const kind of ['actor', 'url']) {
    let current = true; const pending = deferred(), f = fixture({ getSession: () => pending.promise });
    const preparation = f.prepare({ current: () => current }); await settle();
    if (kind === 'actor') current = false; else f.client.supabaseUrl = 'https://other-project.supabase.co';
    pending.resolve({ data: { session: session() }, error: null }); assert.equal(await preparation, null); assert.equal(f.calls.length, 0); clean(f);
  }
  for (const predicate of [false, 'current', () => false, () => { throw Error('changed'); }]) {
    const f = fixture(); assert.equal(await f.prepare({ current: predicate }), null); assert.equal(f.reads(), 0); clean(f);
  }
});

test('only a clean HTTPS Supabase project URL matching the SDK client is accepted', async () => {
  const bad = ['http://synthetic-project.supabase.co', '//synthetic-project.supabase.co', 'https://supabase.co',
    'https://evil.example', 'https://synthetic-project.supabase.co.evil.example', 'https://synthetic-project.supabase.co@evil.example',
    'https://user:secret@synthetic-project.supabase.co', 'https://synthetic-project.supabase.co:444',
    BASE + '/rest/v1', BASE + '?token=synthetic', BASE + '#synthetic', ' ' + BASE, BASE + '\n',
    'https://synthetic-\nproject.supabase.co', 'https://nested.synthetic-project.supabase.co', 'https://-bad.supabase.co'];
  for (const url of bad) { const f = fixture(); assert.equal(await f.prepare({ url }), null, url); assert.equal(f.reads(), 0); assert.equal(f.calls.length, 0); clean(f); }
  const f = fixture(); assert.equal(await f.prepare({ url: 'https://other-project.supabase.co' }), null); assert.equal(f.reads(), 0); clean(f);
  const good = fixture(); good.client.supabaseUrl = BASE + '/'; assert.equal(typeof await good.prepare({ url: BASE + ':443/' }), 'function'); clean(good);
});

test('invalid identity, opaque/malformed tokens and non-UUID session claims never obtain a confirmation', async () => {
  const wrong = [null, { user: { id: OTHER }, access_token: jwt() }, session('synthetic-operator-token'),
    session(jwt({ sub: OTHER })), session(jwt({ session_id: null })), session(jwt({ session_id: 'session' })),
    session(jwt({ session_id: SESSION + '\n' })), session(jwt({ session_id: 123 })), session(jwt() + '\n'),
    session('bad.' + Buffer.from('{"sub":"' + USER + '","session_id":"' + SESSION + '"}').toString('base64url') + '.signature'),
    session(jwt({}, [])), session(jwt({}, { alg: 1 }))];
  for (const value of wrong) {
    const f = fixture({ getSession: async () => ({ data: { session: value }, error: null }) });
    assert.equal(await f.prepare(), null); assert.equal(f.calls.length, 0); clean(f);
  }
  for (const userId of [null, USER + '\n', 'not-a-uuid', OTHER]) {
    const f = fixture(); assert.equal(await f.prepare({ userId }), null); assert.equal(f.calls.length, 0); clean(f);
  }
});

test('missing configuration, header-control characters and SDK errors are harmless no-ops', async () => {
  const missing = fixture();
  for (const options of [undefined, null, {}, { get client() { throw Error('unavailable config'); } }]) assert.equal(await missing.tracker.prepareSignOut(options), null);
  assert.equal(missing.reads(), 0); clean(missing);
  for (const overrides of [{ client: null }, { url: null }, { anonKey: '' }, { anonKey: 'a\nb' }, { anonKey: 'a\u0000b' }]) {
    const f = fixture(); assert.equal(await f.prepare(overrides), null); assert.equal(f.reads(), 0); assert.equal(f.calls.length, 0); clean(f);
  }
  for (const getSession of [async () => { throw Error('offline'); }, async () => ({ error: { message: 'no session' }, data: { session: session() } })]) {
    const f = fixture({ getSession }); assert.equal(await f.prepare(), null); assert.equal(f.calls.length, 0); clean(f);
  }
});

test('network, HTTP, JSON and synchronous transport failures never throw or retry', async () => {
  const failures = [() => { throw Error('offline'); }, () => Promise.reject(Error('offline')),
    async () => ({ ok: false, json: async () => { throw Error('must not read error body'); } }),
    async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({ ok: false }) }),
    async () => ({ ok: true, json: async () => ({ ok: 'true' }) })];
  for (const fetch of failures) {
    const f = fixture({ fetch }), confirm = await f.prepare(); assert.equal(await confirm(), false); assert.equal(await confirm(), false);
    assert.equal(f.calls.length, 1); clean(f);
  }
});

test('hung requests or bodies time out after three seconds even if fetch ignores abort', async () => {
  for (const body of [false, true]) {
    const pending = deferred(), f = fixture({ fetch: () => body ? Promise.resolve({ ok: true, json: () => pending.promise }) : pending.promise });
    const confirm = await f.prepare(), confirmation = confirm(); await settle(); f.run(3000);
    assert.equal(await confirmation, false); assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(await confirm(), false); clean(f);
    pending.resolve(body ? { ok: true } : { ok: true, json: async () => ({ ok: true }) }); await settle(); assert.equal(f.calls.length, 1); clean(f);
  }
});
