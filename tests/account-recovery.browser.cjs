'use strict';
// Actual recovery dialog and shared message UI; all SMS/Auth/network responses are synthetic.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('./encar/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'https://recovery-fixture.example';
const OUT = process.env.ACCOUNT_RECOVERY_ARTIFACT_DIR || '/workspace/work/phone-recovery-v2203/frontend';
const NAME = '합성 딜러', PHONE = '01012345678', EMAIL = 'synthetic-dealer@example.invalid', PASSWORD = 'SyntheticNewPassword!123';
const CHALLENGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TOKEN = 'synthetic-reset-proof-token-with-at-least-32-characters';
const results = []; fs.mkdirSync(OUT, { recursive: true });
const sourceHashes = () => Object.fromEntries(['assets/account-recovery.js', 'assets/account-recovery.css'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate) { const end = Date.now() + 10000; while (!predicate()) { if (Date.now() > end) throw Error('Synthetic recovery observation timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
async function fixture(browser, width = 390, handler = null, { mobileHistory = false } = {}) {
 const context = await browser.newContext({ viewport: { width, height: 844 } }), calls = [], errors = [], consoleLines = [];
 const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('console', message => consoleLines.push(message.text()));
 await page.clock.install();
 await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()); assert.equal(url.origin, ORIGIN, 'Unexpected external request blocked');
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/message-popup.css"><link rel="stylesheet" href="/assets/account-recovery.css"><script src="/__fixture.js"></script>' + (mobileHistory ? '<script src="/assets/mobile-popup-history.js"></script>' : '') + '<script src="/assets/message-popup.js" defer></script><script src="/assets/account-recovery.js" defer></script></head><body><section id="zc-cloud-gate" data-auth-mode="login"><form id="zc-cloud-login"><input id="zc-cloud-email" type="email"><input id="zc-cloud-password" type="password"><button type="button" data-account-recovery="id">아이디 찾기</button><button type="button" data-account-recovery="password">비밀번호 찾기</button></form></section></body></html>' });
  if (url.pathname === '/__fixture.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.__recoveryAllowed=true;window.snoteRecoveryAvailable=()=>__recoveryAllowed;window.snoteMessageContext=()=>({page:location.pathname,mode:document.getElementById("zc-cloud-gate")?.dataset.authMode});window.__nativeAlertCalls=0;window.alert=()=>{__nativeAlertCalls++;};' });
  if (url.pathname.startsWith('/assets/')) return route.fulfill({ path: path.join(ROOT, url.pathname) });
  assert.equal(url.pathname, '/api/account-recovery'); assert.equal(request.method(), 'POST'); assert.equal(url.search, ''); assert.equal(request.headers().authorization, undefined);
  const body = request.postDataJSON(); calls.push(body);
  const now = await page.evaluate(() => Date.now());
  let response = handler ? await handler(body, { now, page, calls }) : null;
  if (!response) response = { body: body.action === 'send-code' ? { ok: true, challengeId: CHALLENGE, expiresAt: new Date(now + 300000).toISOString(), retryAfter: 60 } :
   body.action === 'verify' ? body.purpose === 'id' ? { ok: true, email: EMAIL } : { ok: true, resetToken: TOKEN, expiresAt: new Date(now + 300000).toISOString() } : { ok: true } };
  try { await route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body) }); }
  catch (error) { if (!/closed|handled|Invalid Interception|cancel|intercept/i.test(String(error))) throw error; }
 });
 await page.goto(ORIGIN + '/#login'); await page.waitForFunction(() => !!window.SnoteAccountRecovery);
 return { context, page, calls, errors, consoleLines, async close() { await context.close(); } };
}
async function open(f, mode = 'id') { await f.page.locator('[data-account-recovery="' + mode + '"]').click(); await f.page.locator('#snote-account-recovery[open]').waitFor(); }
async function identity(f, phone = PHONE) { await f.page.locator('#snote-recovery-name').fill(NAME); await f.page.locator('#snote-recovery-phone').fill(phone); }
async function send(f) { await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-recovery-code-section:not([hidden])').waitFor(); }
async function verify(f) { await f.page.locator('#snote-recovery-code').fill('000042'); await f.page.locator('#snote-recovery-submit').click(); }
async function passwordStage(f) { await open(f, 'password'); await identity(f); await send(f); await verify(f); await f.page.locator('#snote-recovery-password-section:not([hidden])').waitFor(); }
async function acknowledge(f) { const message = f.page.locator('#snote-message-dialog[open]'); if (await message.count()) await message.locator('[data-message-accept]').click(); }
async function secretsEmpty(f) {
 for (const id of ['name', 'phone', 'code', 'password', 'password-confirm']) assert.equal(await f.page.locator('#snote-recovery-' + id).inputValue(), '');
 assert.equal(await f.page.locator('#snote-recovery-id').textContent(), '');
}
async function safe(f) {
 assert.deepEqual(f.errors, []); assert.equal(await f.page.evaluate(() => __nativeAlertCalls), 0);
 const persistent = await f.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, history: history.state }));
 for (const secret of [NAME, PHONE, EMAIL, PASSWORD, TOKEN, '000042']) assert(!persistent.includes(secret), 'Recovery proof must not persist: ' + secret);
 assert.equal(f.page.url(), ORIGIN + '/#login');
 for (const line of f.consoleLines) assert(![NAME, PHONE, EMAIL, PASSWORD, TOKEN, '000042'].some(secret => line.includes(secret)), 'No proof in logs');
}
async function idFlow(browser, width) {
 const f = await fixture(browser, width);
 try {
  await open(f); await identity(f); assert.equal(await f.page.locator('#snote-recovery-phone').inputValue(), '010-1234-5678');
  assert.equal(await f.page.locator('#snote-recovery-id').textContent(), ''); await send(f);
  assert.equal(await f.page.locator('#snote-recovery-resend').isDisabled(), true); assert.equal(f.calls[0].name, NAME); assert.equal(f.calls[0].phone, PHONE); assert.equal(f.calls[0].purpose, 'id'); assert.match(f.calls[0].requestId, /^[0-9a-f-]{36}$/);
  await verify(f); await f.page.locator('#snote-recovery-id:not([hidden])').waitFor(); assert.equal(await f.page.locator('#snote-recovery-id').textContent(), EMAIL);
  assert.equal(await f.page.locator('#snote-recovery-code').inputValue(), ''); await f.page.screenshot({ path: path.join(OUT, 'verified-id-' + width + '.png') });
  await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' });
  assert.equal(await f.page.locator('#zc-cloud-email').inputValue(), EMAIL); await secretsEmpty(f); await safe(f);
  results.push({ case: 'trusted ID proof, phone formatting and explicit login prefill', width, passed: true });
 } finally { await f.close(); }
}
async function passwordFlow(browser) {
 const began = deferred(), release = deferred(); let resetBody;
 const f = await fixture(browser, 390, async body => { if (body.action === 'reset-password') { resetBody = body; began.resolve(); await release.promise; return { body: { ok: true } }; } });
 try {
  await f.page.locator('#zc-cloud-password').fill('OldSyntheticPassword'); await passwordStage(f);
  assert.equal(await f.page.locator('#snote-recovery-code').inputValue(), ''); assert.equal(await f.page.locator('#snote-recovery-id').textContent(), '');
  await f.page.locator('#snote-recovery-password').fill(PASSWORD); await f.page.locator('#snote-recovery-password-confirm').fill(PASSWORD); await f.page.locator('#snote-recovery-submit').click(); await began.promise;
  assert.equal(resetBody.resetToken, TOKEN); assert.equal(resetBody.password, PASSWORD); assert.match(resetBody.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(await f.page.locator('#snote-recovery-password').inputValue(), ''); assert.equal(await f.page.locator('#snote-recovery-password-confirm').inputValue(), ''); assert.equal(f.calls.filter(call => call.action === 'reset-password').length, 1);
  release.resolve(); await f.page.locator('#snote-message-dialog[open]').waitFor(); assert.match(await f.page.locator('#snote-message-copy').textContent(), /변경되었습니다/); await acknowledge(f);
  await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' }); await secretsEmpty(f); assert.equal(await f.page.locator('#zc-cloud-password').inputValue(), ''); await safe(f);
  results.push({ case: 'trusted password reset, immediate input clearing and shared success alert', passed: true });
 } finally { release.resolve(); await f.close(); }
}
async function legacyEmail(browser, purpose, delivery) {
 const f = await fixture(browser, 390, async body => body.action === 'verify' ? { body: { ok: true, requiresEmail: true, delivery, email: 'must-not-display@example.invalid', resetToken: TOKEN } } : null);
 try {
  await open(f, purpose); await identity(f); await send(f); await verify(f); await f.page.locator('#snote-recovery-email-guide:not([hidden])').waitFor();
  const text = await f.page.locator('#snote-recovery-email-guide').innerText();
  if (delivery === 'sent') assert.match(text, /인증 링크를 보냈습니다/); else assert(!text.includes('보냈습니다'));
  assert.match(text, /프로필에서 휴대전화 인증/); assert(!(await f.page.locator('#snote-account-recovery').innerText()).includes('must-not-display'));
  assert.equal(await f.page.locator('#snote-recovery-password-section').isHidden(), true); assert.equal(await f.page.locator('#snote-recovery-id').textContent(), '');
  assert.equal(f.calls.filter(call => call.action === 'reset-password').length, 0); await f.page.locator('#snote-recovery-submit').click(); await secretsEmpty(f); await safe(f);
  results.push({ case: 'legacy contact requires email without exposing identity/token', purpose, delivery, passed: true });
 } finally { await f.close(); }
}
async function validationAndTiming(browser) {
 const f = await fixture(browser);
 try {
  await open(f); await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-message-dialog[open]').waitFor(); assert.equal(f.calls.length, 0); await acknowledge(f);
  await identity(f, '0111234567'); assert.equal(await f.page.locator('#snote-recovery-phone').inputValue(), '011-123-4567'); await send(f);
  const first = f.calls[0].requestId; await f.page.clock.fastForward(61000); await f.page.waitForFunction(() => !document.getElementById('snote-recovery-resend').disabled);
  await f.page.locator('#snote-recovery-code').fill('123456'); await f.page.locator('#snote-recovery-resend').click(); await until(() => f.calls.length === 2); await f.page.waitForFunction(() => !document.getElementById('snote-recovery-submit').disabled);
  assert.notEqual(f.calls[1].requestId, first); assert.equal(await f.page.locator('#snote-recovery-code').inputValue(), '');
  await f.page.clock.fastForward(300001); assert.equal(await f.page.locator('#snote-recovery-submit').isDisabled(), true); assert.match(await f.page.locator('#snote-recovery-status').textContent(), /유効|유효시간/);
  assert.equal(await f.page.locator('#snote-recovery-resend').isEnabled(), true); await f.page.keyboard.press('Escape'); await secretsEmpty(f); await safe(f);
  results.push({ case: 'required name, legacy mobile formatting, resend cooldown and five-minute expiry', passed: true });
 } finally { await f.close(); }
}
async function lateResponses(browser, action) {
 const began = deferred(), release = deferred();
 const f = await fixture(browser, 390, async body => { if (body.action === action) { began.resolve(); await release.promise; return { status: action === 'reset-password' ? 503 : 200, body: action === 'send-code' ? { ok: true, challengeId: CHALLENGE, expiresAt: new Date(Date.now() + 300000).toISOString(), retryAfter: 60 } : action === 'verify' ? { ok: true, email: EMAIL } : { ok: false, code: 'NETWORK_ERROR' } }; } return null; });
 try {
  if (action === 'reset-password') { await passwordStage(f); await f.page.locator('#snote-recovery-password').fill(PASSWORD); await f.page.locator('#snote-recovery-password-confirm').fill(PASSWORD); }
  else { await open(f); await identity(f); if (action === 'verify') { await send(f); await f.page.locator('#snote-recovery-code').fill('000042'); } }
  await f.page.locator('#snote-recovery-submit').click(); await began.promise;
  await f.page.evaluate(() => { SnoteAccountRecovery.close({ restoreFocus: false }); SnoteAccountRecovery.open('password'); });
  await f.page.locator('#snote-recovery-name').fill('새 합성 사용자'); await f.page.locator('#snote-recovery-phone').fill('01087654321'); release.resolve();
  await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await f.page.locator('#snote-recovery-name').inputValue(), '새 합성 사용자'); assert.equal(await f.page.locator('#snote-recovery-phone').inputValue(), '010-8765-4321');
  assert.equal(await f.page.locator('#snote-recovery-id').textContent(), ''); assert.equal(await f.page.locator('#snote-recovery-password-section').isHidden(), true);
  assert.equal(await f.page.locator('#snote-message-dialog[open]').count(), 0); await f.page.evaluate(() => SnoteAccountRecovery.close()); await secretsEmpty(f); await safe(f);
  results.push({ case: 'late response cannot change a closed/reopened recovery view', action, passed: true });
 } finally { release.resolve(); await f.close(); }
}
async function lifecycleAndGeometry(browser, width) {
 const f = await fixture(browser, width);
 try {
  await open(f, 'password'); await identity(f); await send(f); await verify(f); await f.page.locator('#snote-recovery-password-section:not([hidden])').waitFor();
  await f.page.locator('#snote-recovery-password').fill(PASSWORD); await f.page.locator('#snote-recovery-password-confirm').fill(PASSWORD);
  await f.page.evaluate(() => { const view = visualViewport; Object.defineProperty(view, 'height', { configurable: true, get: () => 340 }); Object.defineProperty(view, 'offsetTop', { configurable: true, get: () => 100 }); view.dispatchEvent(new Event('resize')); });
  const metrics = await f.page.locator('#snote-account-recovery').evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, top: r.top, bottom: r.bottom, font: getComputedStyle(document.getElementById('snote-recovery-password')).fontSize }; });
  assert(metrics.x >= 0 && metrics.right <= width + .5 && metrics.top >= 99.5 && metrics.bottom <= 440.5, JSON.stringify(metrics)); assert.equal(metrics.font, '16px');
  await f.page.screenshot({ path: path.join(OUT, 'keyboard-' + width + '.png') });
  await f.page.evaluate(() => { document.getElementById('zc-cloud-gate').dataset.authMode = 'dealer'; }); await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' }); await secretsEmpty(f);
  await f.page.evaluate(() => { document.getElementById('zc-cloud-gate').dataset.authMode = 'login'; SnoteAccountRecovery.open('password'); }); await identity(f);
  await f.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))); await secretsEmpty(f);
  await f.page.evaluate(() => { SnoteAccountRecovery.open('id'); __recoveryAllowed = false; }); await f.page.clock.fastForward(1001); await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' }); await secretsEmpty(f);
  await safe(f); results.push({ case: 'mobile keyboard sizing and auth/page lifecycle clearing', width, passed: true });
 } finally { await f.close(); }
}
async function popupHistory(browser) {
 const f = await fixture(browser, 390, null, { mobileHistory: true });
 const settled = async () => { await f.page.evaluate(async () => { SnoteMobilePopupHistory.refresh(); await SnoteMobilePopupHistory.prepareRouteChange(); }); await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
 try {
  await passwordStage(f); await settled();
  await f.page.locator('#snote-recovery-password').fill('short'); await f.page.locator('#snote-recovery-password-confirm').fill('short'); await f.page.locator('#snote-recovery-submit').click();
  await f.page.locator('#snote-message-dialog[open]').waitFor(); await settled(); assert.equal(await f.page.locator('#snote-message-dialog [data-message-close]').isHidden(), true);
  await acknowledge(f); await settled(); assert.equal(await f.page.locator('#snote-account-recovery').isVisible(), true); assert.equal(await f.page.locator('#snote-recovery-password-section').isVisible(), true);
  await f.page.locator('#snote-recovery-password').fill(PASSWORD); await f.page.locator('#snote-recovery-password-confirm').fill('MismatchPassword!123'); await f.page.locator('#snote-recovery-submit').click();
  await f.page.locator('#snote-message-dialog[open]').waitFor(); await settled();
  await f.page.evaluate(() => history.back()); await f.page.locator('#snote-message-dialog').waitFor({ state: 'hidden' }); await settled(); assert.equal(await f.page.locator('#snote-account-recovery').isVisible(), true);
  await f.page.locator('#snote-recovery-password-confirm').fill(PASSWORD); await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-message-dialog[open]').waitFor(); await settled();
  await f.page.evaluate(() => history.back()); await f.page.locator('#snote-message-dialog').waitFor({ state: 'hidden' }); await settled(); assert.equal(await f.page.locator('#snote-account-recovery').isVisible(), true); await secretsEmpty(f);
  assert.match(await f.page.locator('#snote-recovery-status').textContent(), /변경되었습니다/); await f.page.locator('#snote-recovery-submit').click();
  await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' }); await settled(); await secretsEmpty(f); assert.equal(f.calls.filter(call => call.action === 'reset-password').length, 1);
  await open(f); await identity(f); await settled(); await f.page.evaluate(() => history.back()); await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' }); await settled(); await secretsEmpty(f); await safe(f);
  results.push({ case: 'mobile Back and same-URL shared message dismissal preserve the active proof and close only the top popup', passed: true });
 } finally { await f.close(); }
}
async function sendRetry(browser) {
 let attempts = 0;
 const f = await fixture(browser, 390, async body => body.action === 'send-code' && ++attempts === 1 ? { status: 503, body: { ok: false, code: 'NETWORK' } } : null);
 try {
  await open(f); await identity(f); await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-message-dialog[open]').waitFor(); await acknowledge(f);
  assert.equal(f.calls.length, 1); assert.equal(await f.page.locator('#snote-recovery-submit').isDisabled(), true); const requestId = f.calls[0].requestId;
  await f.page.clock.fastForward(61000); await send(f); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].requestId, requestId);
  await f.page.locator('#snote-recovery-code').fill('12'); await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-message-dialog[open]').waitFor(); await acknowledge(f); assert.equal(f.calls.length, 2);
  await f.page.evaluate(() => SnoteAccountRecovery.close()); await secretsEmpty(f); await safe(f);
  results.push({ case: 'unknown SMS outcome never auto-retries and a manual retry reuses its request receipt', passed: true });
 } finally { await f.close(); }
}
async function resetRetry(browser) {
 let attempts = 0;
 const f = await fixture(browser, 390, async body => body.action === 'reset-password' && ++attempts <= 2 ? { status: 503, body: { ok: false, code: attempts === 1 ? 'RESET_UNKNOWN' : 'RESET_PENDING' } } : null);
 try {
  await passwordStage(f);
  for (let attempt = 0; attempt < 3; attempt++) {
   const value = attempt < 2 ? PASSWORD : PASSWORD + '2'; await f.page.locator('#snote-recovery-password').fill(value); await f.page.locator('#snote-recovery-password-confirm').fill(value); await f.page.locator('#snote-recovery-submit').click();
   await f.page.locator('#snote-message-dialog[open]').waitFor();
   if (attempt < 2) assert.match(await f.page.locator('#snote-message-copy').textContent(), /결과를 확인하지 못했습니다/);
   await acknowledge(f);
  }
  await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' });
  const resets = f.calls.filter(call => call.action === 'reset-password'); assert.equal(resets.length, 3); assert.equal(resets[0].requestId, resets[1].requestId); assert.notEqual(resets[1].requestId, resets[2].requestId);
  await secretsEmpty(f); await safe(f); results.push({ case: 'unknown password outcome uses stable manual retry receipts without automatic password updates', passed: true });
 } finally { await f.close(); }
}
async function legacyEmailError(browser, delivery) {
 const f = await fixture(browser, 390, async body => body.action === 'verify' ? { status: delivery === 'failed' ? 502 : 503, body: { ok: false, code: delivery === 'failed' ? 'EMAIL_SEND_FAILED' : delivery === 'pending' ? 'EMAIL_PENDING' : 'EMAIL_SEND_UNKNOWN', requiresEmail: true, delivery } } : null);
 try {
  await open(f, 'password'); await identity(f); await send(f); await verify(f); await f.page.locator('#snote-recovery-email-guide:not([hidden])').waitFor();
  const text = await f.page.locator('#snote-recovery-email-guide').innerText(); assert(!text.includes('보냈습니다')); assert.match(text, /프로필에서 휴대전화 인증/); await secretsEmpty(f); await f.page.locator('#snote-recovery-submit').click(); await safe(f);
  results.push({ case: 'legacy email failure/pending transport responses keep generic honest delivery guidance', delivery, passed: true });
 } finally { await f.close(); }
}
async function mainIntegration(browser, width) {
 const normal = require('./normal-login.browser.cjs'), state = normal.backend(), f = await normal.boot(browser, state, 'recovery-integration-' + width, { width });
 try {
  assert.equal(await f.page.evaluate(() => snoteRecoveryAvailable()), true); assert.equal(await f.page.locator('[data-account-recovery="id"]').count(), 1); await open(f);
  assert.equal(await f.page.locator('#snote-account-recovery .snote-recovery-close').isVisible(), true); await f.page.locator('#snote-recovery-name').fill(NAME); await f.page.screenshot({ path: path.join(OUT, 'main-login-recovery-' + width + '.png') });
  await f.page.evaluate(() => { document.getElementById('zc-cloud-email').value = 'dealer@example.invalid'; document.getElementById('zc-cloud-password').value = 'SyntheticPassword!123'; document.getElementById('zc-cloud-login').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' }); await normal.dashboardReady(f); await secretsEmpty(f); assert.equal(await f.page.evaluate(() => snoteRecoveryAvailable()), false); assert.equal(await f.page.evaluate(() => SnoteAccountRecovery.open()), false);
  results.push({ case: 'actual main login bridge and sign-in hook clear recovery before authenticated dashboard entry', width, passed: true });
 } finally { await f.finish(); }
}
async function keyboardModeChange(browser) {
 const f = await fixture(browser);
 try {
  await open(f); await identity(f); await send(f); await f.page.locator('#snote-recovery-code').fill('000042');
  await f.page.locator('[data-recovery-mode="id"]').focus(); await f.page.keyboard.press('ArrowRight');
  assert.equal(await f.page.locator('[data-recovery-mode="password"]').getAttribute('aria-selected'), 'true'); await secretsEmpty(f); assert.equal(f.calls.length, 1);
  await f.page.keyboard.press('Escape'); await f.page.locator('#snote-account-recovery').waitFor({ state: 'hidden' });
  assert.equal(await f.page.locator('[data-account-recovery="id"]').evaluate(node => document.activeElement === node), true); await safe(f);
  results.push({ case: 'keyboard mode change discards the prior proof and restores the original login trigger on close', passed: true });
 } finally { await f.close(); }
}
async function inputContract(browser) {
 const f = await fixture(browser);
 try {
  await open(f); await identity(f, '0101234567'); await f.page.locator('#snote-recovery-submit').click(); await f.page.locator('#snote-message-dialog[open]').waitFor(); await acknowledge(f); assert.equal(f.calls.length, 0);
  const name = '합성  Dealer'; await f.page.locator('#snote-recovery-name').fill('  ' + name.normalize('NFD') + '  '); await f.page.locator('#snote-recovery-phone').fill(PHONE); await send(f);
  assert.equal(f.calls[0].name, name, 'Name must match the API NFC/trim rule without collapsing registered internal spaces'); await f.page.evaluate(() => SnoteAccountRecovery.close()); await secretsEmpty(f); await safe(f);
  results.push({ case: 'phone length and registered-name normalization exactly match the server contract', passed: true });
 } finally { await f.close(); }
}
async function main() {
 const before = sourceHashes(), browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
 try {
  for (const width of [1440, 390]) await idFlow(browser, width); await passwordFlow(browser);
  for (const purpose of ['id', 'password']) for (const delivery of ['sent', 'failed', 'unknown']) await legacyEmail(browser, purpose, delivery);
  await validationAndTiming(browser); for (const action of ['send-code', 'verify', 'reset-password']) await lateResponses(browser, action);
  for (const width of [360, 390, 430]) await lifecycleAndGeometry(browser, width);
  await popupHistory(browser); await sendRetry(browser); await resetRetry(browser); for (const delivery of ['failed', 'unknown', 'pending']) await legacyEmailError(browser, delivery);
  for (const width of [1440, 390]) await mainIntegration(browser, width);
  await keyboardModeChange(browser);
  await inputContract(browser);
  assert.deepEqual(sourceHashes(), before); for (const result of results) console.log('PASS ' + result.case + ' ' + (result.width || result.purpose || result.action || ''));
 } finally { await browser.close(); fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ passed: results.length === 26, cases: results.length, sourceHashes: before, syntheticOnly: true, actualSmsSent: 0, actualAuthCalls: 0, realKeyboardDevicesTested: 0, results }, null, 2) + '\n'); }
 assert.equal(results.length, 26);
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
