import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, hkdfSync } from 'node:crypto';
import { onRequest } from '../functions/api/income-settlement.js';
import { createSource, createDocument, sourceFingerprint, documentFingerprint, serializePublic, TEMPLATE_ID } from '../assets/income-settlement-model.js';

// Every HTTP request is intercepted. No production DB, SMS or OCR is contacted.
const ENV = { SUPABASE_URL: 'https://income-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-public-key', CUSTOMER_INTAKE_OTP_SECRET: 'test-only-existing-server-secret-with-at-least-32-characters' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const ACCOUNTANT = '33333333-3333-4333-8333-333333333333';
const PEER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const IDENTITY = '9001011234567';
const answer = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const copy = value => structuredClone(value);
function car(id = 'sold-car') { return { id, ownerId: 'cld_' + OWNER.replaceAll('-', '').slice(0, 18), status: '판매완료', model: '검증용 차량', plate: '000가0000', year: 2024, purchaseAt: '2026-01-01', soldAt: '2026-10-01', buy: 1200.5, sell: 1800, soldPrice: 1500.2, costs: { acquisitionTax: 4.2, bodywork: 10, incomeTax: 9, inventoryInterest: 2, repair: 99 }, repairItems: [{ memo: '검증용 수리', amount: 3.2 }], unrelated: { value: '1234567890123', exact: [null, false, 'keep'] } }; }
function fixture(t) {
  const state = {
    actor: OWNER, members: [
      { user_id: OWNER, company_id: COMPANY, role: 'dealer', active: true, display_name: '검증용 딜러' },
      { user_id: ADMIN, company_id: COMPANY, role: 'admin', active: true, display_name: '검증용 관리자' },
      { user_id: ACCOUNTANT, company_id: COMPANY, role: 'accountant', active: true, display_name: '검증용 경리' },
      { user_id: PEER, company_id: COMPANY, role: 'dealer', active: true, display_name: '다른 딜러' },
      { user_id: OTHER, company_id: OTHER_COMPANY, role: 'dealer', active: true, display_name: '다른 상사 딜러' }
    ],
    datasets: new Map([[`${COMPANY}:${OWNER}`, { payload: [car(), { ...car('other-car'), status: '판매중', custom: { untouched: 'exact' } }], revision: 0 }], [`${COMPANY}:${PEER}`, { payload: [car()], revision: 0 }], [`${OTHER_COMPANY}:${OTHER}`, { payload: [car()], revision: 0 }]]),
    lenders: [], calls: [], writes: [], writeHook: null, fetchHook: null, denyReadback: false
  };
  const original = globalThis.fetch;
  const commit = body => {
    const dataset = state.datasets.get(`${body.p_company}:${body.p_owner}`);
    if (!dataset || dataset.revision !== body.p_expected) return answer({ code: '40001', message: 'CONFLICT' }, 409);
    dataset.payload = copy(body.p_payload); dataset.revision++; return answer(dataset.revision);
  };
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url); const body = options.body === undefined ? undefined : JSON.parse(options.body);
    assert.equal(options.redirect, 'manual'); assert.equal(options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY); assert.equal(options.headers.Authorization, `Bearer ${JWT}`);
    const call = { url: parsed, options, body }; state.calls.push(call);
    if (state.fetchHook) { const result = await state.fetchHook(call); if (result !== undefined) return result; }
    if (parsed.pathname === '/auth/v1/user') return answer({ id: state.actor });
    if (parsed.pathname === '/rest/v1/zc_members') {
      const user = parsed.searchParams.get('user_id')?.slice(3), company = parsed.searchParams.get('company_id')?.slice(3);
      const active = parsed.searchParams.get('active') === 'eq.true';
      return answer(state.members.filter(member => member.user_id === user && (!company || member.company_id === company) && (!active || member.active)));
    }
    if (parsed.pathname === '/rest/v1/zc_companies') {
      const company = parsed.searchParams.get('id')?.slice(3);
      return answer([{ id: company, name: company === COMPANY ? '검증용 상사' : '다른 검증용 상사' }]);
    }
    if (parsed.pathname === '/rest/v1/zc_datasets') {
      if (state.denyReadback) throw new Error('test-only readback network failure');
      if (parsed.searchParams.get('dataset') === 'eq.finance_limits') {
        assert.equal(parsed.searchParams.get('company_id'), 'eq.' + COMPANY);
        assert.equal(parsed.searchParams.get('owner_id'), 'eq.00000000-0000-0000-0000-000000000000');
        return answer(state.lenders.length ? [{ payload: copy(state.lenders) }] : []);
      }
      assert.equal(parsed.searchParams.get('dataset'), 'eq.cars');
      assert.equal(parsed.searchParams.get('select'), 'payload,revision');
      const company = parsed.searchParams.get('company_id')?.slice(3), owner = parsed.searchParams.get('owner_id')?.slice(3);
      return answer(state.datasets.has(`${company}:${owner}`) ? [copy(state.datasets.get(`${company}:${owner}`))] : []);
    }
    if (parsed.pathname === '/rest/v1/rpc/zc_write_dataset') {
      assert.equal(options.method, 'POST'); assert.equal(body.p_dataset, 'cars'); state.writes.push(copy(body));
      return state.writeHook ? state.writeHook(body, commit) : commit(body);
    }
    throw new Error('unexpected upstream request');
  };
  t.after(() => { globalThis.fetch = original; });
  return { state, dataset: (company = COMPANY, owner = OWNER) => state.datasets.get(`${company}:${owner}`) };
}
async function call(body, { env = ENV, token = JWT, origin = 'https://s-note.example', method = 'POST', headers = {}, raw, stream } = {}) {
  const reqHeaders = { 'Content-Type': 'application/json', ...headers };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  if (origin !== null) reqHeaders.Origin = origin;
  const request = new Request('https://s-note.example/api/income-settlement', { method, headers: reqHeaders, ...(method === 'GET' ? {} : { body: stream ?? raw ?? JSON.stringify(body), ...(stream ? { duplex: 'half' } : {}) }) });
  const result = await onRequest({ request, env }); return { result, body: await result.json() };
}
function scope(extra = {}) { return { companyId: COMPANY, ownerId: OWNER, carId: 'sold-car', ...extra }; }
async function load(extra = {}, options) { const result = await call({ action: 'load', ...scope(extra) }, options); assert.equal(result.result.status, 200); return result.body; }
function saveBody(loaded, document = loaded.document, requestId = 'test-income-save-1', extra = {}) { return { action: 'save', ...scope(extra), document, baseVersion: loaded.baseVersion, sourceVersion: loaded.sourceVersion, requestId }; }
function record(document, sourceVersion, writeId = 'other-write') { return { type: 'snote-income-settlement', version: 1, templateVersion: TEMPLATE_ID, document: serializePublic(document), sourceVersion, writeId, updatedAt: '2026-11-01T00:00:00Z', updatedBy: OWNER }; }

test('load uses sold canonical car values and returns a fresh D11 document without leaking the owner payload', async t => {
  const { state } = fixture(t); const loaded = await load();
  assert.equal(loaded.stored, false); assert.equal(loaded.baseVersion, null); assert.equal(loaded.revision, 0);
  assert.equal(loaded.sourceChanged, false);
  assert.equal(loaded.source.buyWon, 12005000); assert.equal(loaded.source.soldWon, 15002000);
  assert.equal(loaded.document.cells.D11, 12005000); assert.equal(loaded.document.cells.D10, 0); assert.equal(loaded.document.cells.D31, 42000);
  assert.equal(loaded.document.cells.C2, '검증용 딜러'); assert.equal(loaded.document.cells.G2, '검증용 상사');
  assert.equal(Object.hasOwn(loaded, 'payload'), false); assert.equal(state.writes.length, 0);
  assert.equal(loaded.source.costSuggestions.find(item => item.key === 'repair').amountWon, 32000);
});

test('save persists only the settlement property and returns an exact canonical owner payload after actual ACK', async t => {
  const { state, dataset } = fixture(t); const before = copy(dataset().payload); const loaded = await load();
  loaded.document.cells.J4 = '검증용 정산 메모'; loaded.document.cells.D40 = -1234;
  const saved = await call(saveBody(loaded)); assert.equal(saved.result.status, 200); assert.equal(saved.body.ok, true);
  assert.equal(state.writes.length, 1); assert.equal(state.writes[0].p_expected, 0);
  const after = copy(dataset().payload); const stored = after[0].incomeSettlement; delete after[0].incomeSettlement;
  assert.deepEqual(after, before); assert.equal(stored.document.cells.J4, '검증용 정산 메모'); assert.equal(stored.document.cells.D40, -1234);
  assert.equal(stored.writeId, 'test-income-save-1'); assert.equal(stored.updatedBy, OWNER); assert.equal(stored.sourceVersion, loaded.sourceVersion);
  assert.deepEqual(saved.body.payload, dataset().payload); assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.baseVersion, await documentFingerprint(stored));
  const reopened = await load(); assert.equal(reopened.stored, true); assert.deepEqual(reopened.document, saved.body.document);
});

test('broker H50 is separately HKDF-encrypted and never appears in stored documents, RPC payload or owner cache response', async t => {
  const { state, dataset } = fixture(t); const loaded = await load(); loaded.document.cells.H50 = '900101-1234567';
  const saved = await call(saveBody(loaded)); assert.equal(saved.result.status, 200);
  const stored = dataset().payload[0].incomeSettlement;
  assert.equal(stored.document.cells.H50, ''); assert.match(stored.privateCipher, /^isi1\.[a-f0-9]{24}\.[a-f0-9]{58}$/);
  assert.equal(saved.body.document.cells.H50, IDENTITY);
  for (const value of [stored, state.writes[0], saved.body.payload, saved.body.source]) assert.equal(JSON.stringify(value).includes(IDENTITY), false);
  const resident = Buffer.from(hkdfSync('sha256', Buffer.from(ENV.CUSTOMER_INTAKE_OTP_SECRET), Buffer.from('snote-customer-intake:rrn:v1:hkdf-salt'), Buffer.from('snote-customer-intake:rrn:v1:aes-256-gcm'), 32));
  const key = Buffer.from(hkdfSync('sha256', resident, Buffer.from('snote-income-settlement:identity:v1:hkdf-salt'), Buffer.from('snote-income-settlement:broker-identity:v1:aes-256-gcm'), 32));
  assert.notDeepEqual(key, resident);
  const [, iv, ciphertext] = stored.privateCipher.split('.'); const bytes = Buffer.from(ciphertext, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAAD(Buffer.from('snote-income-settlement:broker-identity:v1:' + JSON.stringify([COMPANY, OWNER, 'sold-car']))); decipher.setAuthTag(bytes.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString(), IDENTITY);
  assert.equal((await load()).document.cells.H50, IDENTITY);
  assert.equal((await load({}, { env: { ...ENV, CUSTOMER_INTAKE_RRN_KEY: 'a'.repeat(64) } })).document.cells.H50, IDENTITY);
});

test('empty identity works without a crypto key, but an existing cipher cannot be silently erased without its key', async t => {
  const { state, dataset } = fixture(t); const missingKey = { ...ENV, CUSTOMER_INTAKE_OTP_SECRET: '' };
  const basic = await load({}, { env: missingKey });
  assert.equal((await call(saveBody(basic), { env: missingKey })).result.status, 200);
  const full = await load(); full.document.cells.H50 = IDENTITY;
  assert.equal((await call(saveBody(full, full.document, 'identity-write'))).result.status, 200);
  const priorCipher = dataset().payload[0].incomeSettlement.privateCipher; const latest = await load(); latest.document.cells.H50 = '';
  const before = state.writes.length;
  for (const env of [missingKey, { ...ENV, CUSTOMER_INTAKE_OTP_SECRET: 'changed-test-only-existing-server-secret-with-at-least-32-characters' }]) {
    const failed = await call(saveBody(latest, latest.document, 'clear-identity'), { env });
    assert.equal(failed.body.code, 'SETUP_REQUIRED'); assert.equal(state.writes.length, before);
    assert.equal(dataset().payload[0].incomeSettlement.privateCipher, priorCipher);
  }
  const clear = await call(saveBody(latest, latest.document, 'clear-identity')); assert.equal(clear.result.status, 200);
  assert.equal(Object.hasOwn(dataset().payload[0].incomeSettlement, 'privateCipher'), false);
});

test('cipher tampering, car/owner/company scope substitution and a lost key fail closed', async t => {
  const { state, dataset } = fixture(t); const loaded = await load(); loaded.document.cells.H50 = IDENTITY;
  await call(saveBody(loaded)); const original = copy(dataset().payload[0].incomeSettlement);
  const failure = async (body, options) => { const result = await call(body, options); assert.equal(result.body.code, 'SETUP_REQUIRED'); assert.equal(JSON.stringify(result.body).includes(IDENTITY), false); };
  const last = original.privateCipher.slice(-1);
  dataset().payload[0].incomeSettlement.privateCipher = original.privateCipher.slice(0, -1) + (last === '0' ? '1' : '0');
  await failure({ action: 'load', ...scope() });
  dataset().payload[0].incomeSettlement = copy(original);
  dataset().payload[1] = { ...car('other-car'), incomeSettlement: copy(original) };
  await failure({ action: 'load', ...scope({ carId: 'other-car' }) });
  dataset(COMPANY, PEER).payload[0].incomeSettlement = copy(original); state.actor = ADMIN;
  await failure({ action: 'load', ...scope({ ownerId: PEER }) });
  dataset(OTHER_COMPANY, OTHER).payload[0].incomeSettlement = copy(original); state.actor = OTHER;
  await failure({ action: 'load', ...scope({ companyId: OTHER_COMPANY, ownerId: OTHER }) });
});

test('dealer is own-only, while admin/accountant may settle another dealer in the same company', async t => {
  const { state } = fixture(t);
  assert.equal((await call({ action: 'load', ...scope({ ownerId: PEER }) })).body.code, 'FORBIDDEN');
  for (const actor of [ADMIN, ACCOUNTANT]) {
    state.actor = actor; const loaded = await load({ ownerId: PEER }); assert.equal(loaded.source.dealerName, '다른 딜러');
    const saved = await call(saveBody(loaded, loaded.document, 'role-write-' + actor, { ownerId: PEER }));
    assert.equal(saved.result.status, 200); assert.equal(saved.body.payload[0].incomeSettlement.updatedBy, actor);
  }
  assert.equal((await call({ action: 'load', ...scope({ ownerId: OTHER }) })).body.code, 'FORBIDDEN');
});

test('missing, inactive, ambiguous and stale-company memberships are rejected before any write', async t => {
  const { state } = fixture(t); const loaded = await load();
  for (const mode of ['missing', 'inactive', 'ambiguous', 'other-company', 'bad-role']) {
    const saved = copy(state.members);
    if (mode === 'missing') state.members = state.members.filter(member => member.user_id !== OWNER);
    if (mode === 'inactive') state.members.find(member => member.user_id === OWNER).active = false;
    if (mode === 'ambiguous') state.members.push({ ...state.members[0], company_id: OTHER_COMPANY });
    if (mode === 'other-company') state.members.find(member => member.user_id === OWNER).company_id = OTHER_COMPANY;
    if (mode === 'bad-role') state.members.find(member => member.user_id === OWNER).role = 'viewer';
    const failed = await call(saveBody(loaded)); assert.equal(failed.body.code, 'FORBIDDEN'); state.members = saved;
  }
  assert.equal(state.writes.length, 0);
  assert.equal((await call({ action: 'load', ...scope({ companyId: OTHER_COMPANY }) })).body.code, 'FORBIDDEN');
});

test('source changes and sale cancellation stop stale settlement saves and expose only sanitized current source', async t => {
  const { state, dataset } = fixture(t); const loaded = await load();
  dataset().payload[0].buy = 1300;
  const sourceChanged = await call(saveBody(loaded)); assert.equal(sourceChanged.body.code, 'SOURCE_CHANGED');
  assert.equal(sourceChanged.body.source.buyWon, 13000000); assert.notEqual(sourceChanged.body.sourceVersion, loaded.sourceVersion); assert.equal(state.writes.length, 0);
  dataset().payload[0].status = '판매중';
  assert.equal((await call(saveBody(loaded))).body.code, 'NOT_SOLD'); assert.equal(state.writes.length, 0);
});

test('reopening a saved document signals changed car source without silently rewriting prior inputs', async t => {
  const { state, dataset } = fixture(t); const loaded = await load();
  assert.equal((await call(saveBody(loaded))).result.status, 200);
  assert.equal((await load()).sourceChanged, false);
  dataset().payload[0].buy = 1300; dataset().revision++;
  const reopened = await load();
  assert.equal(reopened.sourceChanged, true); assert.equal(reopened.source.buyWon, 13000000);
  assert.equal(reopened.document.cells.D11, 12005000);
  assert.notEqual(reopened.sourceVersion, dataset().payload[0].incomeSettlement.sourceVersion);
  assert.equal(state.writes.length, 1);
});

test('same-document conflict returns the remote document and baseline while preserving the local draft', async t => {
  const { state, dataset } = fixture(t); const loaded = await load(); const draft = copy(loaded.document); draft.cells.J4 = 'local draft';
  const remote = copy(loaded.document); remote.cells.D40 = -99;
  dataset().payload[0].incomeSettlement = record(remote, loaded.sourceVersion); dataset().revision++;
  const failure = await call(saveBody(loaded, draft)); assert.equal(failure.body.code, 'CONFLICT');
  assert.equal(failure.body.remoteDocument.cells.D40, -99); assert.equal(failure.body.baseVersion, await documentFingerprint(dataset().payload[0].incomeSettlement));
  assert.equal(draft.cells.J4, 'local draft'); assert.equal(state.writes.length, 0);
});

test('CAS retry merges other-car and unrelated-field changes from the latest owner dataset', async t => {
  const { state, dataset } = fixture(t); const loaded = await load();
  state.writeHook = (body, commit) => {
    if (state.writes.length === 1) { dataset().payload[0].extra = 'new unrelated field'; dataset().payload[1].custom.untouched = 'new other-car value'; dataset().revision++; return answer({ code: '40001', message: 'CONFLICT' }, 409); }
    return commit(body);
  };
  const saved = await call(saveBody(loaded)); assert.equal(saved.result.status, 200); assert.equal(state.writes.length, 2);
  assert.equal(saved.body.payload[0].extra, 'new unrelated field'); assert.equal(saved.body.payload[1].custom.untouched, 'new other-car value');
  assert.equal(state.writes[1].p_expected, 1); assert.equal(dataset().revision, 2);
});

test('CAS source change prevents retry and repeated revision races are bounded to three writes', async t => {
  const { state, dataset } = fixture(t); const loaded = await load();
  state.writeHook = () => { dataset().payload[0].soldPrice++; dataset().revision++; return answer({ code: '40001', message: 'CONFLICT' }, 409); };
  assert.equal((await call(saveBody(loaded))).body.code, 'SOURCE_CHANGED'); assert.equal(state.writes.length, 1);
  const current = await load(); state.writes = [];
  state.writeHook = () => { dataset().payload[1].extra = 'other change'; dataset().revision++; return answer({ code: '40001', message: 'CONFLICT' }, 409); };
  assert.equal((await call(saveBody(current))).body.code, 'CONFLICT'); assert.equal(state.writes.length, 3);
  assert.equal(Object.hasOwn(dataset().payload[0], 'incomeSettlement'), false);
});

test('lost ACK proves matching public/private content by readback and same request retry never writes twice', async t => {
  const { state, dataset } = fixture(t); const loaded = await load(); loaded.document.cells.H50 = IDENTITY;
  state.writeHook = (body, commit) => { commit(body); dataset().payload[1].extra = 'later server change'; dataset().revision++; throw new Error('lost ACK with private content ' + IDENTITY); };
  const saved = await call(saveBody(loaded)); assert.equal(saved.result.status, 200); assert.equal(saved.body.revision, 2); assert.equal(saved.body.document.cells.H50, IDENTITY);
  assert.equal(saved.body.payload[1].extra, 'later server change'); assert.equal(state.writes.length, 1);
  const again = await call(saveBody(loaded)); assert.equal(again.result.status, 200); assert.equal(state.writes.length, 1);
  const changed = copy(loaded.document); changed.cells.J4 = 'different payload';
  assert.equal((await call(saveBody(loaded, changed))).body.code, 'CONFLICT'); assert.equal(state.writes.length, 1);
});

test('unknown writes never show saved without proof, and unavailable readback can recover on exact retry', async t => {
  const { state, dataset } = fixture(t); const loaded = await load();
  state.writeHook = () => { throw new Error('private network detail ' + IDENTITY); };
  const failed = await call(saveBody(loaded)); assert.equal(failed.body.code, 'NETWORK'); assert.equal(Object.hasOwn(failed.body, 'ok'), false);
  assert.equal(JSON.stringify(failed.body).includes(IDENTITY), false); assert.equal(dataset().revision, 0);
  state.writeHook = (body, commit) => { commit(body); state.denyReadback = true; throw new Error('lost acknowledgement'); };
  const uncertain = await call(saveBody(loaded)); assert.equal(uncertain.body.code, 'NETWORK');
  state.denyReadback = false;
  const recovered = await call(saveBody(loaded)); assert.equal(recovered.result.status, 200); assert.equal(state.writes.length, 2); assert.equal(dataset().revision, 1);
});

test('untrusted fields, computed formulas, malformed JSON and cross-origin or oversized requests fail before upstream access', async t => {
  const { state } = fixture(t); const loaded = await load(); const before = state.calls.length;
  const invalidDoc = copy(loaded.document); invalidDoc.cells.D42 = 999;
  const cases = [
    [{ action: 'load', ...scope(), payload: [] }, {}, 400], [saveBody(loaded, invalidDoc), {}, 400],
    [{ ...saveBody(loaded), sourceVersion: [loaded.sourceVersion] }, {}, 400],
    [{ action: 'load', ...scope({ companyId: [COMPANY] }) }, {}, 400],
    [{ action: 'load', ...scope() }, { origin: 'https://evil.example' }, 403],
    [{ action: 'load', ...scope() }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ action: 'load', ...scope() }, { headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ action: 'load', ...scope() }, { raw: '{' }, 400], [{ action: 'load', ...scope() }, { token: null }, 401],
    [{ action: 'load', ...scope() }, { method: 'DELETE' }, 405]
  ];
  for (const [body, options, status] of cases) {
    const result = await call(body, options); assert.equal(result.result.status, status);
    assert.match(result.result.headers.get('Cache-Control'), /no-store.*private/); assert.equal(result.result.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(result.result.headers.has('Access-Control-Allow-Origin'), false);
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(65 * 1024))); controller.close(); } });
  assert.equal((await call(null, { stream })).result.status, 413); assert.equal(state.calls.length, before);
});

test('upstream redirects are never followed and malformed success acknowledgements require readback proof', async t => {
  const { state } = fixture(t); state.fetchHook = () => new Response(null, { status: 302, headers: { Location: 'https://private-redirect.example' } });
  const failed = await call({ action: 'load', ...scope() }); assert.equal(failed.body.code, 'NETWORK'); assert.equal(state.calls.length, 1);
  assert.equal(state.calls.some(item => item.url.hostname === 'private-redirect.example'), false);
  state.fetchHook = null; const loaded = await load();
  state.writeHook = () => answer(true);
  const badAck = await call(saveBody(loaded)); assert.equal(badAck.body.code, 'NETWORK');
});

test('plain H50 left in any stored owner record fails closed instead of leaking through cache payload', async t => {
  const { dataset, state } = fixture(t); const loaded = await load();
  const bad = copy(loaded.document); bad.cells.H50 = IDENTITY;
  dataset().payload[1].incomeSettlement = { ...record(bad, loaded.sourceVersion), document: bad };
  const failed = await call(saveBody(loaded)); assert.equal(failed.body.code, 'SETUP_REQUIRED'); assert.equal(JSON.stringify(failed.body).includes(IDENTITY), false); assert.equal(state.writes.length, 0);
});


test('financed settlement reads company shared rates using caller JWT and rejects a changed rate at save', async t => {
 const {state}=fixture(t);const current=state.datasets.get(`${COMPANY}:${OWNER}`).payload[0];
 current.inventoryLoan=1000;current.inventoryLender='검증금융';state.lenders=[['검증금융',100000,6]];
 const loaded=await load();assert.equal(loaded.source.inventoryInterestWon,448767);
 assert(!loaded.source.unmapped.some(x=>x.key==='inventoryInterest'));
 state.lenders=[['검증금융',100000,12]];
 const result=await call(saveBody(loaded));assert.equal(result.result.status,409);assert.equal(state.writes.length,0);
});

test('inspection expense is returned with won precision, retained on save and invalidates stale settlement source', async t => {
 const {state,dataset}=fixture(t),current=dataset().payload[0];current.costs.performanceInspection=1.2345;
 const loaded=await load(),suggestion=loaded.source.costSuggestions.find(item=>item.key==='performanceInspection');
 assert.deepEqual(suggestion,{key:'performanceInspection',label:'성능점검비',amountWon:12345});
 loaded.document.cells.B15=suggestion.label;loaded.document.cells.D15=suggestion.amountWon;
 const saved=await call(saveBody(loaded));assert.equal(saved.result.status,200);assert.equal(dataset().payload[0].costs.performanceInspection,1.2345);
 assert.equal(dataset().payload[0].incomeSettlement.document.cells.D15,12345);
 const reopened=await load();assert.equal(reopened.source.costSuggestions.find(item=>item.key==='performanceInspection').amountWon,12345);
 const writes=state.writes.length;dataset().payload[0].costs.performanceInspection=1.2346;
 const stale=await call(saveBody(reopened,reopened.document,'test-inspection-stale'));
 assert.equal(stale.result.status,409);assert.equal(state.writes.length,writes);assert.equal(dataset().payload[0].costs.performanceInspection,1.2346);
});
