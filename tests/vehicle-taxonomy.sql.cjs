'use strict';
// Synthetic PostgreSQL regression only. No network or production database.
// Dependency stays outside this static Pages repository:
// npm install --prefix /tmp/snote-intake-testdb --no-save --no-audit --no-fund @electric-sql/pglite@0.5.14
// NODE_PATH=/tmp/snote-intake-testdb/node_modules node tests/vehicle-taxonomy.sql.cjs
// One isolated connection verifies constraints/permissions, not concurrent sessions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const SQL = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202611010005_vehicle_taxonomy.sql'), 'utf8');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const ACCOUNTANT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const INACTIVE = '55555555-5555-4555-8555-555555555555';
const UNASSIGNED = '66666666-6666-4666-8666-666666666666';
const VIEWER = '77777777-7777-4777-8777-777777777777';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENTRY = { make: '테스트 제조사', group: '테스트 차명', model: '테스트 2세대', grade: '테스트 등급', subgrade: '', model_year: '2025' };
let db, year, passed = 0, failed = 0;

async function bootstrap() {
  const database = new PGlite(); await database.waitReady;
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table public.zc_companies(id uuid primary key, name text not null);
    create table public.zc_members(user_id uuid not null, company_id uuid not null references public.zc_companies(id),
      role text, active boolean not null default true, primary key(user_id,company_id));
    create table public.zc_datasets(company_id uuid, owner_id uuid, dataset text, payload jsonb,
      primary key(company_id,owner_id,dataset));
    alter table public.zc_datasets enable row level security;
    create policy original_dataset_policy on public.zc_datasets for select to authenticated using (false);
    grant select on public.zc_datasets to authenticated;
    -- Simulate the earlier unguarded draft so migration DROP is exercised.
    create function public.snote_vehicle_taxonomy_upsert(p_entry jsonb)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    grant execute on function public.snote_vehicle_taxonomy_upsert(jsonb) to authenticated;
  `);
  await database.query('insert into public.zc_companies values($1,$2),($3,$4)', [COMPANY, '검증용 상사', OTHER_COMPANY, '다른 검증용 상사']);
  return database;
}
async function reset() {
  await db.exec('truncate public.zc_vehicle_taxonomy; delete from public.zc_members; delete from public.zc_datasets;');
  for (const [actor, company, role, active] of [[ACTOR, COMPANY, 'dealer', true], [PEER, COMPANY, 'admin', true], [ACCOUNTANT, COMPANY, 'accountant', true], [OTHER, OTHER_COMPANY, 'dealer', true], [INACTIVE, COMPANY, 'dealer', false], [VIEWER, COMPANY, 'viewer', true]]) {
    await db.query('insert into public.zc_members values($1,$2,$3,$4)', [actor, company, role, active]);
  }
  await db.query("insert into public.zc_datasets values($1,$2,'cars',$3::jsonb)", [COMPANY, ACTOR, JSON.stringify([{ id: 'test-car-1', make: ENTRY.make, group: ENTRY.group, generation: ENTRY.model }])]);
}
async function as(role, actor, operation) {
  assert(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec('set role ' + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
  try { return await operation(); } finally { await db.exec('reset role'); }
}
async function upsert(entry = ENTRY, actor = ACTOR, role = 'authenticated', expectedCompany = actor === OTHER ? OTHER_COMPANY : COMPANY) {
  return as(role, actor, async () => (await db.query('select public.snote_vehicle_taxonomy_upsert($1::jsonb,$2::uuid) result', [entry === null ? null : JSON.stringify(entry), expectedCompany])).rows[0].result);
}
async function list(actor = ACTOR, role = 'authenticated') {
  return as(role, actor, async () => (await db.query('select public.snote_vehicle_taxonomy_list() result')).rows[0].result);
}
async function row(id) { return (await db.query('select * from public.zc_vehicle_taxonomy where id=$1', [id])).rows[0]; }
async function count() { return (await db.query('select count(*)::int n from public.zc_vehicle_taxonomy')).rows[0].n; }
async function rejects(operation, codes = ['42501']) { await assert.rejects(operation, error => codes.includes(error.code)); }
async function test(name, operation) {
  await reset();
  try { await operation(); passed++; console.log('PASS', name); }
  catch (error) { failed++; process.exitCode = 1; console.error('FAIL', name, error.code || error.name, error.message); }
}

(async () => {
  db = await bootstrap();
  try {
    year = (await db.query('select extract(year from current_date)::int as current_year')).rows[0].current_year;
    await db.exec(SQL); await db.exec(SQL); console.log('PASS migration executes twice');
    await test('RPC grants, private helpers and direct table access are exact', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const signature of ['public.snote_vehicle_taxonomy_list()', 'public.snote_vehicle_taxonomy_upsert(jsonb,uuid)']) {
          assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed, role === 'authenticated');
        }
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [role, 'public.zc_vehicle_taxonomy', privilege])).rows[0].allowed, false);
        assert.equal((await db.query("select has_schema_privilege($1,'snote_taxonomy_private','USAGE') allowed", [role])).rows[0].allowed, false);
      }
      const functions = (await db.query("select prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('snote_vehicle_taxonomy_list','snote_vehicle_taxonomy_upsert')")).rows;
      assert.equal(functions.length, 2); for (const fn of functions) { assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.includes('search_path=""')); }
      assert.equal((await db.query("select to_regprocedure('public.snote_vehicle_taxonomy_upsert(jsonb)') old_overload")).rows[0].old_overload, null);
      for (const role of ['anon', 'service_role']) { await rejects(() => list(ACTOR, role)); await rejects(() => upsert(ENTRY, ACTOR, role)); }
      await rejects(() => as('authenticated', ACTOR, () => db.query('select * from public.zc_vehicle_taxonomy')));
      await rejects(() => as('authenticated', ACTOR, () => db.query('delete from public.zc_vehicle_taxonomy')));
    });
    await test('dealer insert and company list return only fixed unverified catalogue metadata', async () => {
      const saved = await upsert({ make: ' 테스트 제조사 ', group: ' 테스트  차명 ', model: ' 테스트 2세대 ' });
      assert.equal(saved.company_id, COMPANY); assert.equal(saved.inserted, true); assert.match(saved.entry.id, /^[a-f0-9-]{36}$/);
      assert.deepEqual(saved.entry, { id: saved.entry.id, make: ENTRY.make, group: ENTRY.group, model: ENTRY.model, grade: '', subgrade: '', model_year: '', verification: 'user_import', source: 'company_vehicle_registration', market: 'KR' });
      assert.deepEqual(await list(), { company_id: COMPANY, entries: [saved.entry] });
      assert.equal((await row(saved.entry.id)).created_by, ACTOR);
    });
    await test('NFKC, case and whitespace duplicates preserve first labels, creator, year and timestamps', async () => {
      const first = await upsert({ make: ' ＢＭＷ ', group: ' 5\u00a0  시리즈 ', model: ' Ｇ６０ ', grade: '３２０d  LUXURY', subgrade: ' \u2007 ', model_year: '2024' });
      const before = await row(first.entry.id);
      const second = await upsert({ make: 'bmw', group: '5 시리즈', model: 'g60', grade: '320D luxury', model_year: '2025' }, PEER);
      assert.equal(first.inserted, true); assert.equal(second.inserted, false); assert.deepEqual(second.entry, first.entry);
      assert.deepEqual(await row(first.entry.id), before); assert.equal(await count(), 1);
      await rejects(() => db.query('insert into public.zc_vehicle_taxonomy(company_id,make,group_name,model,grade,subgrade,created_by) values($1,$2,$3,$4,$5,$6,$7)', [COMPANY, 'BMW', '5 시리즈', 'G60', '320d luxury', '', ACTOR]), ['23505']);
    });
    await test('normalization does not merge different tuple boundaries, grades, or subgrades', async () => {
      for (const entry of [
        { make: 'A||B', group: 'C', model: 'M' }, { make: 'A', group: 'B||C', model: 'M' },
        { make: 'A', group: 'B||C', model: 'M', grade: 'G' }, { make: 'A', group: 'B||C', model: 'M', grade: 'G', subgrade: 'S' }
      ]) assert.equal((await upsert(entry)).inserted, true);
      assert.equal(await count(), 4);
    });
    await test('SQL identity matches explicit ASCII case folding and every ECMAScript Unicode whitespace', async () => {
      const fold = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').replace(/[A-Z]/g, letter => letter.toLowerCase());
      for (const make of ['ΟΣ', 'ος', 'οσ', 'İ', 'i\u0307', 'ß', 'SS', 'ＡＢＣ']) {
        const entry = { make, group: 'Group', model: 'Model', grade: '', subgrade: '' };
        const saved = await upsert(entry);
        const canonical = (await row(saved.entry.id)).canonical_identity;
        assert.deepEqual(JSON.parse(canonical), [entry.make, entry.group, entry.model, '', ''].map(fold));
      }
      assert.equal(await count(), 8);
      const whitespaces = ['\u00a0', '\u1680', ...Array.from({ length: 11 }, (_, index) => String.fromCharCode(0x2000 + index)), '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff'];
      for (const whitespace of whitespaces) {
        const saved = await upsert({ make: ` ${whitespace}A${whitespace} ${whitespace}B${whitespace} `, group: 'G', model: 'M' });
        assert.equal(saved.entry.make, 'A B');
        assert.deepEqual(JSON.parse((await row(saved.entry.id)).canonical_identity), ['a b', 'g', 'm', '', '']);
      }
      assert.equal(await count(), 9);
    });
    await test('same-company peers share entries and accountants can read but never write', async () => {
      const saved = await upsert(); assert.deepEqual((await list(PEER)).entries, [saved.entry]); assert.deepEqual((await list(ACCOUNTANT)).entries, [saved.entry]);
      await rejects(() => upsert(ENTRY, ACCOUNTANT)); assert.equal(await count(), 1);
      assert.equal((await upsert({ ...ENTRY, grade: '관리자 입력' }, PEER)).inserted, true);
    });
    await test('two companies keep the same name independently and cannot forge another company', async () => {
      const a = await upsert(); const b = await upsert(ENTRY, OTHER);
      assert.equal(a.company_id, COMPANY); assert.equal(b.company_id, OTHER_COMPANY); assert.notEqual(a.entry.id, b.entry.id);
      assert.deepEqual((await list(ACTOR)).entries, [a.entry]); assert.deepEqual((await list(OTHER)).entries, [b.entry]);
      await rejects(() => upsert({ ...ENTRY, company_id: OTHER_COMPANY }), ['22023']);
      await rejects(() => upsert({ ...ENTRY, owner_id: OTHER }), ['22023']); assert.equal(await count(), 2);
    });
    await test('expected-company guard rejects stale or forged company context before any insert', async () => {
      await rejects(() => upsert(ENTRY, ACTOR, 'authenticated', OTHER_COMPANY));
      await rejects(() => upsert(ENTRY, ACTOR, 'authenticated', null));
      assert.equal(await count(), 0);
      // A previous vehicle ACK belonged to A. The member now belongs only to B.
      await db.query('update public.zc_members set company_id=$2 where user_id=$1', [ACTOR, OTHER_COMPANY]);
      await rejects(() => upsert(ENTRY, ACTOR, 'authenticated', COMPANY));
      assert.equal((await db.query('select count(*)::int n from public.zc_vehicle_taxonomy where company_id=$1', [OTHER_COMPANY])).rows[0].n, 0);
      const current = await upsert(ENTRY, ACTOR, 'authenticated', OTHER_COMPANY);
      assert.equal(current.inserted, true); assert.equal(current.company_id, OTHER_COMPANY); assert.equal(await count(), 1);
    });
    await test('RLS still denies direct reads if a client is accidentally granted SELECT', async () => {
      await upsert(); await db.exec('grant select on public.zc_vehicle_taxonomy to authenticated');
      try {
        assert.equal((await as('authenticated', ACTOR, () => db.query('select count(*)::int n from public.zc_vehicle_taxonomy'))).rows[0].n, 0);
        assert.equal((await list()).entries.length, 1);
      } finally { await db.exec('revoke select on public.zc_vehicle_taxonomy from authenticated'); }
      assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.zc_vehicle_taxonomy'::regclass")).rows[0].relrowsecurity, true);
    });
    await test('missing, inactive, deleted, unsupported and ambiguous memberships are rejected', async () => {
      await upsert();
      for (const actor of [null, UNASSIGNED, INACTIVE, VIEWER]) { await rejects(() => list(actor)); await rejects(() => upsert(ENTRY, actor)); }
      await db.query('update public.zc_members set active=false where user_id=$1', [ACTOR]); await rejects(() => list()); await rejects(() => upsert());
      await db.query('delete from public.zc_members where user_id=$1', [PEER]); await rejects(() => list(PEER));
      await db.query('update public.zc_members set active=true where user_id=$1', [ACTOR]);
      await db.query("insert into public.zc_members values($1,$2,'dealer',true)", [ACTOR, OTHER_COMPANY]);
      await rejects(() => list()); await rejects(() => upsert()); assert.equal(await count(), 1);
    });
    await test('invalid JSON fields, types, lengths, controls and years cannot persist partial entries', async () => {
      const invalid = [null, [], {}, { group: 'G', model: 'M' }, { ...ENTRY, make: '' }, { ...ENTRY, group: '   ' },
        { ...ENTRY, make: '가'.repeat(46) }, { ...ENTRY, group: '가'.repeat(81) }, { ...ENTRY, model: '가'.repeat(101) },
        { ...ENTRY, grade: '가'.repeat(101) }, { ...ENTRY, subgrade: '가'.repeat(81) },
        { ...ENTRY, make: 123 }, { ...ENTRY, grade: null }, { ...ENTRY, subgrade: [] }, { ...ENTRY, model_year: 2025 },
        { ...ENTRY, verification: 'official' }, { ...ENTRY, source: 'official' }, { ...ENTRY, arbitrary: true },
        { ...ENTRY, model: 'model\tname' }, { ...ENTRY, model: 'model\nname' }, { ...ENTRY, model: 'model\u007fname' }, { ...ENTRY, model: 'model\u0085name' },
        { ...ENTRY, model_year: '1969' }, { ...ENTRY, model_year: String(year + 2) }, { ...ENTRY, model_year: '20e3' }, { ...ENTRY, model_year: '２０２５' }];
      for (const entry of invalid) { await rejects(() => upsert(entry), ['22023']); assert.equal(await count(), 0); }
      assert.equal((await upsert({ ...ENTRY, model_year: '1970' })).inserted, true);
      assert.equal((await upsert({ ...ENTRY, grade: '다른 등급', model_year: String(year + 1) })).inserted, true);
    });
    await test('vehicle deletion cannot remove the independent company catalogue', async () => {
      const saved = await upsert();
      await db.query("update public.zc_datasets set payload='[]'::jsonb where company_id=$1 and dataset='cars'", [COMPANY]);
      await db.query("delete from public.zc_datasets where company_id=$1 and dataset='cars'", [COMPANY]);
      assert.deepEqual((await list(PEER)).entries, [saved.entry]);
    });
    await test('reapplying migration preserves saved rows, existing data/policies and exact grants', async () => {
      const saved = await upsert(); const before = await row(saved.entry.id);
      const companies = (await db.query('select * from public.zc_companies order by id')).rows;
      const memberships = (await db.query('select * from public.zc_members order by user_id')).rows;
      const datasets = (await db.query('select * from public.zc_datasets')).rows;
      const policies = (await db.query("select * from pg_policies where tablename='zc_datasets'")).rows;
      await db.exec(SQL); await db.exec(SQL);
      assert.deepEqual(await row(saved.entry.id), before); assert.deepEqual((await list()).entries, [saved.entry]);
      assert.deepEqual((await db.query('select * from public.zc_companies order by id')).rows, companies);
      assert.deepEqual((await db.query('select * from public.zc_members order by user_id')).rows, memberships);
      assert.deepEqual((await db.query('select * from public.zc_datasets')).rows, datasets);
      assert.deepEqual((await db.query("select * from pg_policies where tablename='zc_datasets'")).rows, policies);
    });
    console.log(JSON.stringify({ tests: passed + failed, passed, failed, migrationExecutions: 4, concurrency: 'single isolated connection; unique constraint enforces deduplication' }));
  } finally { await db.close(); }
})().catch(error => { console.error('SQL regression stopped', error.code || error.name, error.message); process.exitCode = 1; });
