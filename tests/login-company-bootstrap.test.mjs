import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Execute the shipped bootstrap and first-use profile helpers. All database
// replies, identities and delays are synthetic; no Auth or remote request runs.
const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const bootstrap = between('// Optional document identity is never borrowed', '\n// Idle recovery ');
const profileReader = between('async function snoteReadCompanyProfile(', '\nfunction snoteCompanyPhoneAvailability(');
const actorReader = source.match(/^function snoteCompanyActor\(\).*$/m)?.[0];
assert(actorReader, 'The actual active company/role helper must be available');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const actor = { user_id: 'synthetic-user', company_id: 'synthetic-company', active: true, role: 'dealer' };
const company = { id: actor.company_id, name: 'Synthetic company', rrn_enabled: false };
const profile = { id: company.id, name: company.name, business_number: '1234567890', corporate_number: '1234567890123' };
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
  const S = { client, user: { id: actor.user_id }, company: { id: 'previous-company' }, ready: false,
    members: [{ user_id: 'previous-member' }], alias: 'previous-alias', companyOwners: new Map([['previous', {}]]) };
  const window = {};
  const api = new Function('S', 'ownerAlias', 'console', 'window',
    'let currentUser=null;\n' + actorReader + '\n' + profileReader + '\n' + bootstrap + `
      return {read:readCompany,
        enter(){S.ready=true;currentUser={username:ownerAlias(S.user.id),role:'dealer'};},
        replaceActor(){currentUser={...currentUser};}
      };`)(S, id => 'alias:' + id, { warn: (...args) => warnings.push(args) }, window);
  return { S, ...api, profile: window.snoteEnsureDocumentCompany,
    profileReady: window.snoteDocumentCompanyReady, requests, warnings };
}
function success(request) {
  return ({ actor: ok(actor), company: ok(company), members: ok([actor]), profile: ok(profile) })[kind(request)];
}

test('startup waits for active membership, overlaps only required reads and defers the coalesced profile to first use', async () => {
  const gates = Object.fromEntries(['actor', 'company', 'members', 'profile'].map(name => [name, deferred()]));
  const f = fixture(request => gates[kind(request)].promise);
  let settled = false;
  const task = f.read().then(result => { settled = true; return result; });
  await tick();
  assert.deepEqual(f.requests.map(kind), ['actor']);
  gates.actor.resolve(ok(actor));
  await tick();
  assert.deepEqual(f.requests.map(kind), ['actor', 'company', 'members']);
  assert.equal(f.S.company.id, 'previous-company');
  gates.company.resolve(ok(company));
  await tick();
  assert.equal(settled, false);
  assert.equal(f.S.alias, 'previous-alias');
  gates.members.resolve(ok([actor]));
  assert.equal(await task, true);
  assert.deepEqual(f.S.company, company);
  assert.deepEqual(f.S.members, [actor]);
  assert.equal(f.S.alias, 'alias:' + actor.user_id);
  assert.equal(f.S.companyOwners.size, 0);
  assert.equal(f.profileReady(), false);
  f.enter();
  const first = f.profile(), second = f.profile();
  assert.equal(first, second, 'One captured identity read serves concurrent first-use consumers');
  await tick();
  assert.deepEqual(f.requests.map(kind), ['actor', 'company', 'members', 'profile']);
  assert.deepEqual(f.S.company, company);
  gates.profile.resolve(ok(profile));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(f.S.company.corporate_number, profile.corporate_number);
  assert.equal(f.profileReady(), true);
});

test('missing or inactive actor cannot start company or optional profile reads', async () => {
  for (const record of [null, { ...actor, active: false }]) {
    const f = fixture(() => ok(record));
    if (record) await assert.rejects(f.read(), /비활성화/);
    else assert.equal(await f.read(), false);
    await assert.rejects(f.profile(), /CONTEXT_CHANGED/);
    assert.deepEqual(f.requests.map(kind), ['actor']);
    assert.equal(f.S.company.id, 'previous-company');
  }
});

test('optional profile failure leaves completed login intact but does not mark a document identity verified', async () => {
  let failed = true;
  const f = fixture(request => kind(request) === 'profile' && failed
    ? { data: null, error: { code: '42501' } } : success(request));
  assert.equal(await f.read(), true);
  assert.deepEqual(f.requests.map(kind), ['actor', 'company', 'members']);
  f.enter();
  await assert.rejects(f.profile(), error => error.code === '42501');
  assert.deepEqual(f.S.company, company);
  assert.equal(f.S.ready, true);
  assert.equal(f.profileReady(), false);
  assert.equal(f.requests.filter(request => kind(request) === 'profile').length, 1, 'Permission denial must not be retried as a missing column');
  failed = false;
  assert.equal(await f.profile(), true);
  assert.equal(f.profileReady(), true);
});

test('required company or member failure never adopts a partially loaded workspace', async () => {
  for (const failed of ['company', 'members']) {
    const error = { code: 'SYNTHETIC_REQUIRED_FAILURE' };
    const f = fixture(request => kind(request) === failed ? { data: null, error } : success(request));
    await assert.rejects(f.read(), value => value === error);
    assert.equal(f.S.company.id, 'previous-company');
    assert.deepEqual(f.S.members, [{ user_id: 'previous-member' }]);
    assert.equal(f.S.alias, 'previous-alias');
    assert(!f.requests.some(request => kind(request) === 'profile'));
  }
});

test('optional member phone permission and document phone-column fallbacks execute in their own verified phases', async () => {
  for (const missingColumn of ['42703', 'PGRST204']) {
    const f = fixture(request => {
      const type = kind(request);
      if (type === 'members') return request.fields.endsWith(',phone')
        ? { data: null, error: { code: '42501' } } : ok([actor]);
      if (type === 'profile') return request.fields.endsWith(',business_phone')
        ? { data: null, error: { code: missingColumn } } : ok(profile);
      return success(request);
    });
    assert.equal(await f.read(), true);
    assert.equal(f.requests.filter(request => kind(request) === 'members').length, 2);
    assert.equal(f.requests.filter(request => kind(request) === 'profile').length, 0);
    f.enter();
    assert.equal(await f.profile(), true);
    assert.equal(f.requests.filter(request => kind(request) === 'profile').length, 2);
    assert.equal(f.S.company.corporate_number, profile.corporate_number);
    assert(f.requests.filter(request => kind(request) === 'profile').every(request => request.filters.id === company.id));
  }
});

test('a late required response cannot replace another login or trigger fallback through its client', async () => {
  const gates = Object.fromEntries(['company', 'members'].map(name => [name, deferred()]));
  const f = fixture(request => kind(request) === 'actor' ? ok(actor) : gates[kind(request)].promise);
  const task = f.read();
  const rejected = assert.rejects(task, /CONTEXT_CHANGED/);
  await tick();
  f.S.user = { id: 'another-user' };
  f.S.client = { from() { throw Error('Another login must not receive a fallback request'); } };
  gates.company.resolve(ok(company));
  gates.members.resolve({ data: null, error: { code: '42501' } });
  await rejected;
  assert.equal(f.requests.length, 3);
  assert.equal(f.S.company.id, 'previous-company');
  assert.equal(f.S.alias, 'previous-alias');
});

test('late document identity responses are rejected after user-object, client, company or actor changes', async () => {
  for (const changed of ['user', 'client', 'company', 'actor']) {
    const gate = deferred();
    const f = fixture(request => kind(request) === 'profile' ? gate.promise : success(request));
    await f.read(); f.enter();
    const task = f.profile(), rejected = assert.rejects(task, /CONTEXT_CHANGED/);
    await tick();
    if (changed === 'user') f.S.user = { ...f.S.user };
    if (changed === 'client') f.S.client = { from() { throw Error('New client must not receive the old identity request'); } };
    if (changed === 'company') f.S.company = { id: 'another-company', name: 'Another synthetic company' };
    if (changed === 'actor') f.replaceActor();
    gate.resolve(ok(profile)); await rejected;
    assert.equal(f.S.company.corporate_number, undefined);
    assert.equal(f.profileReady(), false);
    assert.equal(f.requests.filter(request => kind(request) === 'profile').length, 1);
  }
});

test('a mismatched profile row is never merged and unready policy state cannot start a first-use read', async () => {
  const f = fixture(request => kind(request) === 'profile' ? ok({ ...profile, id: 'another-company' }) : success(request));
  await f.read();
  await assert.rejects(f.profile(), /CONTEXT_CHANGED/);
  assert(!f.requests.some(request => kind(request) === 'profile'));
  f.enter(); await assert.rejects(f.profile(), /INVALID_COMPANY_PROFILE/);
  assert.equal(f.S.company.corporate_number, undefined);
  assert.equal(f.profileReady(), false);
});
