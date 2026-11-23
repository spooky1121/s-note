'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const SOURCE = fs.readFileSync(path.join(__dirname, '../assets/account-recovery-entry.js'), 'utf8');
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.synthetic', REFRESH = 'synthetic-refresh-token';
const fragment = '#access_token=' + TOKEN + '&refresh_token=' + REFRESH + '&type=recovery';
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(address) {
  const url = new URL(address), events = [], listeners = {}, elements = [];
  const node = tag => { const value = { tag, style: {}, children: [], append(...children) { this.children.push(...children); } }; elements.push(value); return value; };
  const root = node('html'), head = node('head'); elements.length = 0;
  const context = { URL, URLSearchParams, location: url, history: { replaceState(state, title, next) { events.push(['history', state, title, next]); } },
    document: { documentElement: root, head, createElement: node }, addEventListener: (name, fn) => { listeners[name] = fn; },
    stop() { events.push(['stop']); } };
  context.location.replace = target => { events.push(['replace', target]); };
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(context, name, { get() { throw Error('Recovery entry must not use persistent storage'); } });
  context.window = context; vm.runInNewContext(SOURCE, context);
  return { context, events, listeners, root, head, elements };
}

test('ordinary pages, sign-up confirmation and untyped expiry errors are untouched', () => {
  for (const address of ['https://s-note.kr/', 'https://s-note.kr/#login', 'https://s-note.kr/#type=signup&access_token=' + TOKEN,
    'https://s-note.kr/#error_code=otp_expired&error=access_denied', 'https://s-note.kr/?code=synthetic-pkce',
    'https://s-note.kr/customer.html' + fragment, 'https://s-note.kr/other-route' + fragment,
    'https://s-note.kr/index.html' + fragment,
    'file:///tmp/index.html' + fragment]) {
    const f = fixture(address); assert.deepEqual(f.events, []); assert.deepEqual(f.elements, []);
    assert.equal(f.context.SnoteRecoveryRedirecting, undefined); assert.equal(f.context.SnoteRecoveryEntry, undefined);
  }
});

test('only a recovery-tagged root entry moves to a same-origin callback and clears source history first', () => {
  const f = fixture('https://s-note.kr/?next=https://evil.example/' + fragment);
  assert.equal(f.context.SnoteRecoveryRedirecting, true);
  assert.deepEqual(f.events[0], ['history', null, '', '/']);
  assert.deepEqual(f.events[1], ['stop']);
  assert.equal(f.events[2][1], 'https://s-note.kr/account-recovery.html' + fragment);
  assert.equal(f.root.style.visibility, 'hidden');
  assert.equal(f.elements.find(element => element.tag === 'a').href, 'https://s-note.kr/account-recovery.html' + fragment);
});

test('the callback strips all query/fragment data and yields a secret only once in memory', () => {
  const f = fixture('https://s-note.kr/account-recovery.html?code=discarded&metadata=discarded' + fragment);
  assert.deepEqual(f.events, [['history', null, '', '/account-recovery.html']]);
  assert.deepEqual(copy(f.context.SnoteRecoveryEntry.take()), { kind: 'session', access_token: TOKEN, refresh_token: REFRESH });
  assert.equal(f.context.SnoteRecoveryEntry.take(), null); assert.equal(f.context.SnoteRecoveryRedirecting, undefined);
  assert.deepEqual(f.elements, []);
});

test('pretty callback URLs are supported and an unused proof is cleared on pagehide', () => {
  for (const route of ['/account-recovery', '/account-recovery/']) {
    const f = fixture('https://preview.example' + route + fragment); f.listeners.pagehide();
    assert.equal(f.context.SnoteRecoveryEntry.take(), null);
    assert.deepEqual(f.events, [['history', null, '', route]]);
  }
});

test('invalid, duplicate and signup tokens never become a callback session', () => {
  for (const hash of ['#type=signup&access_token=' + TOKEN + '&refresh_token=' + REFRESH,
    fragment + '&type=recovery', fragment + '&access_token=other', '#type=recovery&access_token=opaque&refresh_token=' + REFRESH,
    '#type=recovery&access_token=' + TOKEN + '&refresh_token=bad', '#type=recovery']) {
    const f = fixture('https://s-note.kr/account-recovery.html' + hash), value = copy(f.context.SnoteRecoveryEntry.take());
    assert.equal(value.kind, 'invalid'); assert.equal(value.access_token, undefined); assert.equal(value.refresh_token, undefined);
    assert.deepEqual(f.events, [['history', null, '', '/account-recovery.html']]);
  }
});

test('PKCE codes fail closed without a fabricated verifier or session', () => {
  for (const suffix of ['?code=synthetic-code', '#code=synthetic-code']) {
    const f = fixture('https://s-note.kr/account-recovery.html' + suffix);
    assert.deepEqual(copy(f.context.SnoteRecoveryEntry.take()), { kind: 'unsupported-code' });
    assert.deepEqual(f.events, [['history', null, '', '/account-recovery.html']]);
  }
});

test('tagged provider errors move to a secret-free expired-link state', () => {
  const f = fixture('https://s-note.kr/account-recovery.html#type=recovery&error=access_denied&error_description=untrusted');
  assert.deepEqual(copy(f.context.SnoteRecoveryEntry.take()), { kind: 'expired' });
  assert.deepEqual(f.events, [['history', null, '', '/account-recovery.html']]);
});

test('the dedicated page loads the secret consumer before deferred SDK/application code', () => {
  const html = fs.readFileSync(path.join(__dirname, '../account-recovery.html'), 'utf8');
  assert(html.indexOf('name="referrer" content="no-referrer"') < html.indexOf('account-recovery-entry.js'));
  assert(html.indexOf('account-recovery-entry.js') < html.indexOf('account-recovery-callback.js'));
  assert.match(html, /<script src="\/?assets\/account-recovery-entry\.js\?v=2\.203"><\/script>/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(html, /(?:name|id)="(?:current-password|old-password)"/);
});
