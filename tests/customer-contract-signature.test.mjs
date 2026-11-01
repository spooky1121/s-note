import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../assets/customer-contract-signature.js', import.meta.url), 'utf8');
const png = 'data:image/png;base64,c2lnbmF0dXJl';
const signature = { version: 1, strokes: [[[0.1, 0.2], [0.8, 0.7]]] };

function fixture(extra = {}) {
  const sandbox = vm.createContext({});
  vm.runInContext(code, sandbox);
  let context = { actor: {}, ownerId: 'dealer-a', carId: 12, view: 1, open: true,
    mode: 'sale', customerName: '고객 가' };
  let rendered = null;
  const controller = sandbox.snoteCreateCustomerContractSignature({
    currentContext: () => context,
    imageFor: value => value === signature ? png : '',
    render: value => { rendered = value; },
    ...extra
  });
  const person = { ownerId: 'dealer-a', carId: 12, name: '고객 가', customerSignature: signature,
    customerSignatureSignedAt: '2026-11-01T10:00:00Z' };
  return { controller, person, get context() { return context; }, set context(value) { context = value; },
    get rendered() { return rendered; } };
}

test('explicit saved customer uses sanitized image and labels its original submission', () => {
  const f = fixture();
  assert.equal(f.controller.set(f.person), true);
  assert.equal(f.rendered.visible, true);
  assert.equal(f.rendered.image, png);
  assert.match(f.rendered.caption, /^고객 원제출 서명/);
});

test('purchase never receives a sales buyer signature; sale restores the same scope', () => {
  const f = fixture(); f.controller.set(f.person);
  f.context = { ...f.context, mode: 'purchase' };
  assert.equal(f.controller.sync().visible, false);
  assert.equal(f.rendered.image, '');
  f.context = { ...f.context, mode: 'sale' };
  assert.equal(f.controller.sync().visible, true);
});

test('customer name edits hide the source and only equivalent whitespace matches', () => {
  const f = fixture(); f.controller.set(f.person);
  f.context = { ...f.context, customerName: '다른 고객' };
  assert.equal(f.controller.sync().visible, false);
  f.context = { ...f.context, customerName: '  고객   가  ' };
  assert.equal(f.controller.sync().visible, true);
});

test('missing or invalid signature clears the previously displayed image', () => {
  const f = fixture(); f.controller.set(f.person);
  assert.equal(f.controller.set({ ...f.person, customerSignature: null }), false);
  assert.equal(f.rendered.visible, false);
  assert.equal(f.rendered.image, '');
  f.controller.set(f.person);
  assert.equal(f.controller.set(null), false);
  assert.equal(f.rendered.visible, false);
});

test('wrong owner/car cannot attach a signature even with the same customer name', () => {
  for (const change of [{ ownerId: 'dealer-b' }, { carId: 99 }]) {
    const f = fixture(); f.controller.set(f.person);
    assert.equal(f.controller.set({ ...f.person, ...change }), false);
    assert.equal(f.rendered.visible, false);
  }
});

test('switching actor, car, view or closing permanently discards old source', () => {
  for (const change of [{ actor: {} }, { ownerId: 'dealer-b' }, { carId: 99 }, { view: 2 }, { open: false }]) {
    const f = fixture(); const previous = f.context; f.controller.set(f.person);
    f.context = { ...f.context, ...change };
    assert.equal(f.controller.sync().visible, false);
    f.context = previous;
    assert.equal(f.controller.sync().visible, false);
  }
});

test('late callback from old scope cannot replace or clear the current signature', () => {
  const f = fixture(); const oldContext = f.context;
  f.context = { ...f.context, view: 2 };
  f.controller.set(f.person);
  assert.equal(f.controller.set({ ...f.person, customerSignature: null }, oldContext), false);
  assert.equal(f.rendered.visible, true);
});

test('same signature retains its known original name across saves and reopen in this session', () => {
  const f = fixture(); f.controller.set(f.person);
  f.controller.clear();
  f.context = { ...f.context, view: 2, customerName: '고객 나' };
  assert.equal(f.controller.set({ ...f.person, name: '고객 나' }), true);
  assert.equal(f.rendered.visible, false);
  f.context = { ...f.context, customerName: '고객 가' };
  assert.equal(f.controller.sync().visible, true);
});

test('known original names do not leak across actors or cars', () => {
  for (const change of [{ actor: {} }, { carId: 99 }]) {
    const f = fixture(); f.controller.set(f.person); f.controller.clear();
    f.context = { ...f.context, ...change, customerName: '고객 나' };
    f.controller.set({ ...f.person, carId: f.context.carId, name: '고객 나' });
    assert.equal(f.rendered.visible, true);
  }
});

test('arbitrary URLs, SVG data, malformed and unbounded image data are rejected', () => {
  for (const value of ['https://example.invalid/sign.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,broken!', 'data:image/png;base64,' + 'a'.repeat(500000)]) {
    const f = fixture({ imageFor: () => value });
    assert.equal(f.controller.set(f.person), false);
    assert.equal(f.rendered.image, '');
  }
});

test('print readiness waits for the current trusted image', async () => {
  let done; const pending = new Promise(resolve => { done = resolve; });
  const f = fixture({ imageReady: () => pending }); f.controller.set(f.person);
  let resolved = false; const ready = f.controller.ready().then(value => { resolved = true; return value; });
  await Promise.resolve(); assert.equal(resolved, false);
  done(); assert.equal(await ready, true);
});

test('close, source replacement, name edit and car switch during decode cancel printing', async () => {
  for (const action of ['clear', 'replace', 'name', 'car']) {
    let done; const pending = new Promise(resolve => { done = resolve; });
    const f = fixture({ imageReady: () => pending }); f.controller.set(f.person);
    const ready = f.controller.ready();
    if (action === 'clear') f.controller.clear();
    if (action === 'replace') f.controller.set(f.person);
    if (action === 'name') f.context = { ...f.context, customerName: '다른 고객' };
    if (action === 'car') f.context = { ...f.context, carId: 99 };
    done(); assert.equal(await ready, false);
  }
});

test('decode failure blocks printing while a contract without a signature remains printable', async () => {
  const f = fixture({ imageReady: async () => { throw Error('decode'); } });
  f.controller.set(f.person); assert.equal(await f.controller.ready(), false);
  f.controller.clear(); assert.equal(await f.controller.ready(), true);
});
