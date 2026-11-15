import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Runs the actual startup company reader with controlled, synthetic database
// delays. No production session, credentials or remote request is used.
const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = source.indexOf('async function readCompany(){');
const end = source.indexOf('\n// Idle recovery ', start);
assert(start >= 0 && end > start);
const reader = source.slice(start, end);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const actor = { user_id: 'synthetic-user', company_id: 'synthetic-company', active: true, role: 'dealer' };
const company = { id: actor.company_id, name: 'Synthetic company', rrn_enabled: false };
const ok = data => ({ data, error: null });
const kind = request => request.table === 'zc_members'
  ? ('user_id' in request.filters ? 'actor' : 'members')
  : request.fields.includes('rrn_enabled') ? 'company' : 'profile';

function fixture(handler) {
  const requests = [], warnings = [];
  const client = { from(table) {
    const filters = {}; let fields = '';
    const query = {
      select(value) { fields = value; return query; },
      eq(key, value) { filters[key] = value; return query; },
      single() { return query; }, maybeSingle() { return query; },
      then(resolve, reject) {
        const request = { table, fields, filters: { ...filters } };
        requests.push(request);
        Promise.resolve().then(() => handler(request)).then(resolve, reject);
      }
    };
    return query;
  } };
  const S = { client, user: { id: actor.user_id }, company: { id: 'previous-company' },
    members: [{ user_id: 'previous-member' }], alias: 'previous-alias', companyOwners: new Map([['previous', {}]]) };
  const read = new Function('S', 'ownerAlias', 'console', reader + '\nreturn readCompany;')(
    S, id => 'alias:' + id, { warn: (...args) => warnings.push(args) }
  );
  return { S, read, requests, warnings };
}

test('startup waits for active membership, then overlaps all company reads and commits only after completion', async () => {
  const gates = Object.fromEntries(['actor', 'company', 'members', 'profile'].map(name => [name, deferred()]));
  const f = fixture(request => gates[kind(request)].promise);
  let settled = false;
  const task = f.read().then(result => { settled = true; return result; });
  await tick();
  assert.deepEqual(f.requests.map(kind), ['actor']);
  gates.actor.resolve(ok(actor));
  await tick();
  assert.deepEqual(f.requests.map(kind), ['actor', 'company', 'members', 'profile']);
  assert.equal(f.S.company.id, 'previous-company');
  gates.company.resolve(ok(company)); gates.members.resolve(ok([actor]));
  await tick();
  assert.equal(settled, false);
  assert.equal(f.S.alias, 'previous-alias');
  gates.profile.resolve(ok({ id: actor.company_id, business_number: 'synthetic' }));
  assert.equal(await task, true);
  assert.equal(f.S.company.name, company.name);
  assert.equal(f.S.company.business_number, 'synthetic');
  assert.deepEqual(f.S.members, [actor]);
  assert.equal(f.S.alias, 'alias:' + actor.user_id);
  assert.equal(f.S.companyOwners.size, 0);
});

test('missing or inactive actor cannot start company reads', async () => {
  for (const record of [null, { ...actor, active: false }]) {
    const f = fixture(() => ok(record));
    if (record) await assert.rejects(f.read(), /비활성화/);
    else assert.equal(await f.read(), false);
    assert.deepEqual(f.requests.map(kind), ['actor']);
    assert.equal(f.S.company.id, 'previous-company');
  }
});

test('optional profile failure preserves a successful basic company and member read', async () => {
  const f = fixture(request => ({ actor: ok(actor), company: ok(company), members: ok([actor]),
    profile: { data: null, error: { code: 'SYNTHETIC_OPTIONAL_FAILURE' } } })[kind(request)]);
  assert.equal(await f.read(), true);
  assert.deepEqual(f.S.company, company);
  assert.equal(f.warnings.length, 1);
});

test('required company or member failure never adopts a partially loaded workspace', async () => {
  for (const failed of ['company', 'members']) {
    const error = { code: 'SYNTHETIC_REQUIRED_FAILURE' };
    const f = fixture(request => kind(request) === failed ? { data: null, error }
      : ({ actor: ok(actor), company: ok(company), members: ok([actor]), profile: ok({ id: actor.company_id }) })[kind(request)]);
    await assert.rejects(f.read(), value => value === error);
    assert.equal(f.S.company.id, 'previous-company');
    assert.deepEqual(f.S.members, [{ user_id: 'previous-member' }]);
    assert.equal(f.S.alias, 'previous-alias');
  }
});

test('existing optional phone column and permission fallbacks remain available', async () => {
  const f = fixture(request => {
    const type = kind(request);
    if (type === 'actor') return ok(actor);
    if (type === 'company') return ok(company);
    if (type === 'members') return request.fields.endsWith(',phone')
      ? { data: null, error: { code: '42501' } } : ok([actor]);
    return request.fields.endsWith(',business_phone')
      ? { data: null, error: { code: 'PGRST204' } } : ok({ id: actor.company_id, business_number: 'synthetic' });
  });
  assert.equal(await f.read(), true);
  assert.equal(f.requests.filter(request => kind(request) === 'members').length, 2);
  assert.equal(f.requests.filter(request => kind(request) === 'profile').length, 2);
});

test('a late company response cannot replace another login or trigger fallback through its client', async () => {
  const gates = Object.fromEntries(['company', 'members', 'profile'].map(name => [name, deferred()]));
  const f = fixture(request => kind(request) === 'actor' ? ok(actor) : gates[kind(request)].promise);
  const task = f.read();
  const rejected = assert.rejects(task, /CONTEXT_CHANGED/);
  await tick();
  f.S.user = { id: 'another-user' };
  f.S.client = { from() { throw Error('Another login must not receive a fallback request'); } };
  gates.company.resolve(ok(company));
  gates.members.resolve({ data: null, error: { code: '42501' } });
  gates.profile.resolve({ data: null, error: { code: 'PGRST204' } });
  await rejected;
  assert.equal(f.requests.length, 4);
  assert.equal(f.S.company.id, 'previous-company');
  assert.equal(f.S.alias, 'previous-alias');
});
