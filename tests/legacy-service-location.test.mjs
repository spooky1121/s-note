import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../assets/service-location.js', import.meta.url), 'utf8');

function run(input, { refuse = false, bodyExists = false } = {}) {
  const url = new URL(input), events = [], nodes = [], style = {};
  style.removeProperty = name => { events.push(['style-remove', name]); delete style[name]; };
  const element = name => ({ tagName: name, style: {}, children: [], setAttribute(name, value) { this[name] = value; }, append(...children) { this.children.push(...children); },
    replaceWith(next) { events.push(['replace-body', next]); } });
  const root = element('html'); root.style = style;
  const document = { documentElement: root, head: { append(node) { events.push(['head', node]); } },
    body: bodyExists ? element('body') : null, createElement(name) { const node = element(name); nodes.push(node); return node; } };
  const location = { protocol: url.protocol, hostname: url.hostname, pathname: url.pathname, search: url.search, hash: url.hash,
    replace(value) { events.push(['replace', value, style.visibility]); if (refuse) throw Error('synthetic navigation refusal'); } };
  const forbiddenStorage = new Proxy({}, { get() { throw Error('Service location must not touch stored data'); } });
  const window = { location, document, stop() { events.push(['stop']); }, localStorage: forbiddenStorage,
    sessionStorage: forbiddenStorage, indexedDB: forbiddenStorage };
  vm.runInNewContext(script, { window, document, URL });
  return { events, nodes, root, document };
}

test('only the retired project and its own subdomains move to the current service', () => {
  for (const url of ['https://zerocar-office.pages.dev/', 'https://abc123.zerocar-office.pages.dev/',
    'https://preview.branch.zerocar-office.pages.dev/', 'https://zerocar-office.synthetic-account.workers.dev/',
    'http://zerocar-office.pages.dev/', 'https://ZEROCAR-OFFICE.PAGES.DEV./']) {
    const result = run(url), replace = result.events.find(event => event[0] === 'replace');
    assert.equal(replace?.[1], 'https://s-note.kr/');
    assert.equal(replace[2], 'hidden');
    assert.equal(result.nodes.find(node => node.id === 'snote-service-location').style.visibility, 'visible');
    assert(result.events.findIndex(event => event[0] === 'stop') < result.events.findIndex(event => event[0] === 'replace'));
    assert.equal(result.events.find(event => event[0] === 'head')[1].content, 'no-referrer');
  }
});

test('current service, local development, genuine company hosts and lookalikes remain completely unchanged', () => {
  for (const url of ['https://s-note.kr/', 'https://www.s-note.kr/', 'https://s-note.pages.dev/',
    'https://abc123.s-note.pages.dev/', 'http://localhost:8788/', 'http://127.0.0.1:8788/',
    'https://zerocar.kr/', 'https://company-zerocar.example/', 'https://notzerocar-office.pages.dev/',
    'https://zerocar-office.pages.dev.evil.example/', 'https://evil.example/zerocar-office.pages.dev/',
    'https://zerocar-office.synthetic-account.workers.dev.evil.example/', 'https://zerocar-office.workers.dev/',
    'https://other.synthetic-account.workers.dev/', 'file:///workspace/s-note/index.html']) {
    const result = run(url); assert.deepEqual(result.events, [], url); assert.deepEqual(result.nodes, [], url);
    assert.equal(result.root.style.visibility, undefined);
  }
});

test('path, search parameters and a customer or auth fragment survive without copying the source authority', () => {
  const input = 'https://user:secret@zerocar-office.pages.dev:8443/customer.html?mode=edit&car=1%2F2#synthetic-token-_%2F';
  const result = run(input);
  assert.equal(result.events.find(event => event[0] === 'replace')[1],
    'https://s-note.kr/customer.html?mode=edit&car=1%2F2#synthetic-token-_%2F');
});

test('a network-path-style pathname cannot redirect to an attacker origin', () => {
  const result = run('https://zerocar-office.pages.dev//evil.example/customer.html?next=https%3A%2F%2Fevil.example%2F#synthetic');
  const target = result.events.find(event => event[0] === 'replace')[1];
  assert.equal(target, 'https://s-note.kr//evil.example/customer.html?next=https%3A%2F%2Fevil.example%2F#synthetic');
  assert.equal(new URL(target).origin, 'https://s-note.kr');
});

test('refused or silently ignored navigation retains a visible current-service exit without replacing existing content', () => {
  for (const refuse of [false, true]) for (const bodyExists of [false, true]) {
    const result = run('https://zerocar-office.pages.dev/customer.html#synthetic', { refuse, bodyExists });
    const link = result.nodes.find(node => node.tagName === 'a');
    assert.equal(link.href, 'https://s-note.kr/customer.html#synthetic');
    assert.equal(link.textContent, 'S-NOTE 열기'); assert.equal(link.referrerPolicy, 'no-referrer');
    assert.equal(result.root.style.visibility, 'hidden');
    assert.equal(result.nodes.find(node => node.id === 'snote-service-location').style.visibility, 'visible');
    assert.equal(result.events.some(event => event[0] === 'replace-body' || event[0] === 'style-remove'), false);
    assert.equal(result.document.body !== null, bodyExists);
  }
});

test('every public HTML entry point loads the guard synchronously before other executable scripts', () => {
  for (const name of ['index.html', 'customer.html', 'monthly.html', 'income-settlement.html', 'operator.html', 'address-search.html']) {
    const html = fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    const first = html.match(/<script\b([^>]*)>/i); assert(first, name);
    assert.match(first[1], /src=["']assets\/service-location\.js\?v=2\.200["']/);
    assert.doesNotMatch(first[1], /\b(?:async|defer|type\s*=\s*["']module)\b/i, name);
    assert(html.indexOf(first[0]) < html.indexOf('</head>'), name);
  }
});
