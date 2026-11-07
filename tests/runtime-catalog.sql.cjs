'use strict';
// Isolated, synthetic Postgres security regression. No network, auth-service or
// production database writes. Optional real runtime JSON is public research only.
// NODE_PATH=/workspace/work/deps/node_modules node tests/runtime-catalog.sql.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const ROOT = path.join(__dirname, '..');
const INITIAL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/202611010005_vehicle_taxonomy.sql'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261107002437_researched_vehicle_catalog_replacement.sql'), 'utf8');
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEALER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const ACCOUNTANT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const INACTIVE = '55555555-5555-4555-8555-555555555555';
const UNASSIGNED = '66666666-6666-4666-8666-666666666666';
const VIEWER = '77777777-7777-4777-8777-777777777777';
const CUSTOM = { make: '새 직접입력', group: '새 분류', model: '새 모델', grade: '등급', subgrade: '', model_year: '2026' };
let db, legacyBefore, passed = 0, failed = 0;
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
async function reject(operation, codes = ['42501']) { await assert.rejects(operation, error => codes.includes(error.code)); }
async function as(role, actor, operation) {
  assert(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec('set role ' + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
  try { return await operation(); } finally { await db.exec('reset role'); }
}
const research = (actor = DEALER, role = 'authenticated') => as(role, actor, () => scalar('select public.snote_research_vehicle_catalog_list()'));
const customList = (actor = DEALER, role = 'authenticated') => as(role, actor, () => scalar('select public.snote_vehicle_taxonomy_list()'));
const customSave = (entry = CUSTOM, actor = DEALER, company = actor === OTHER ? OTHER_COMPANY : COMPANY) =>
  as('authenticated', actor, () => scalar('select public.snote_vehicle_taxonomy_upsert($1::jsonb,$2::uuid)', [JSON.stringify(entry), company]));
async function test(name, operation) {
  try { await operation(); passed++; console.log('PASS', name); }
  catch (error) { failed++; process.exitCode = 1; console.error('FAIL', name, error.code || error.name, error.message); }
}
const sample = (id, extra = {}) => ({ id, researchId: id, make: '현대', group: '테스트', model: '테스트 세대', grade: '기본', subgrade: '', model_year: '2024', market: 'KR', engine: '1.6', evidence: [{ sourceUrl: 'https://example.test/source', evidenceStatus: 'official_direct' }], ...extra });
const document = (version, records) => JSON.stringify({ schemaVersion: 1, catalogVersion: version, counts: { records: records.length }, records }, null, 2) + '\n';
async function stage(raw, { expectedCount, hash = sha(raw), skipRows = false } = {}) {
  const parsed = JSON.parse(raw);
  await db.query('insert into snote_catalog_private.datasets(dataset_version,manifest_sha256,expected_count,raw_document) values($1,$2,$3,$4)', [parsed.catalogVersion, hash, expectedCount ?? parsed.records.length, raw]);
  if (!skipRows) await db.query(`insert into snote_catalog_private.catalog_entries(dataset_version,research_id,ordinal,payload)
    select $1, original.payload ->> 'id', original.ordinal::integer, original.payload
      from jsonb_array_elements($2::jsonb -> 'records') with ordinality as original(payload,ordinal)`, [parsed.catalogVersion, raw]);
  return { version: parsed.catalogVersion, hash };
}
const activate = (version, hash) => scalar('select snote_catalog_private.activate_dataset($1,$2)', [version, hash]);
(async () => {
  db = new PGlite(); await db.waitReady;
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table public.zc_companies(id uuid primary key,name text not null);
      create table public.zc_members(user_id uuid not null,company_id uuid not null references public.zc_companies(id),role text,active boolean not null default true,primary key(user_id,company_id));
      create table public.zc_datasets(company_id uuid,owner_id uuid,dataset text,payload jsonb,primary key(company_id,owner_id,dataset));
      alter table public.zc_datasets enable row level security;
      create policy original_vehicle_policy on public.zc_datasets for select to authenticated using(false);
      grant select on public.zc_datasets to authenticated;
    `);
    await db.query('insert into public.zc_companies values($1,$2),($3,$4)', [COMPANY, '테스트 상사', OTHER_COMPANY, '다른 테스트 상사']);
    for (const [actor, company, role, active] of [[DEALER,COMPANY,'dealer',true],[ADMIN,COMPANY,'admin',true],[ACCOUNTANT,COMPANY,'accountant',true],[OTHER,OTHER_COMPANY,'dealer',true],[INACTIVE,COMPANY,'dealer',false],[VIEWER,COMPANY,'viewer',true]]) {
      await db.query('insert into public.zc_members values($1,$2,$3,$4)', [actor,company,role,active]);
    }
    await db.query("insert into public.zc_datasets values($1,$2,'cars',$3::jsonb)", [COMPANY, DEALER, JSON.stringify([{ id: 'untouched-car', make: '원래 제조사', taxonomyCatalogRef: 'legacy' }])]);
    await db.exec(INITIAL);
    for (let n = 0; n < 6; n++) await db.query('insert into public.zc_vehicle_taxonomy(company_id,make,group_name,model,grade,model_year,created_by) values($1,$2,$3,$4,$5,$6,$7)', [COMPANY, '원래 제조사', '원래 차명', '기존 차종 ' + n, n < 3 ? '기존 등급' : '', '2025', DEALER]);
    legacyBefore = (await db.query('select to_jsonb(e) row_data from public.zc_vehicle_taxonomy e order by id')).rows.map(row => row.row_data);
    const untouched = (await db.query('select * from public.zc_datasets')).rows;
    const membersBefore = (await db.query('select * from public.zc_members order by user_id')).rows;
    await db.exec(MIGRATION); await db.exec(MIGRATION);
    await test('migration repeats without changing six complete legacy rows, vehicle JSON or memberships', async () => {
      assert.deepEqual((await db.query('select to_jsonb(e) row_data from public.zc_vehicle_taxonomy e order by id')).rows.map(row => row.row_data), legacyBefore);
      assert.deepEqual((await db.query('select row_data from snote_catalog_private.legacy_entries order by id')).rows.map(row => row.row_data), legacyBefore);
      assert.equal(await scalar('select entry_count from snote_catalog_private.legacy_backup_manifest'), 6);
      assert.equal(await scalar(`select payload_sha256 = encode(sha256(convert_to((select jsonb_agg(row_data order by id)::text from snote_catalog_private.legacy_entries),'UTF8')),'hex') from snote_catalog_private.legacy_backup_manifest`), true);
      assert.deepEqual((await db.query('select * from public.zc_datasets')).rows, untouched);
      assert.deepEqual((await db.query('select * from public.zc_members order by user_id')).rows, membersBefore);
      assert.deepEqual(await customList(), { company_id: COMPANY, entries: [] });
      await reject(() => research(), ['55000']);
    });
    await test('all private tables and legacy backup have exact ACLs, RLS and invoker-only public wrappers', async () => {
      const tables = ['legacy_entries','legacy_backup_manifest','datasets','catalog_entries','active_dataset','custom_entries'].map(name => 'snote_catalog_private.' + name).concat('public.zc_vehicle_taxonomy');
      for (const table of tables) {
        assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [table]), true);
        for (const role of ['anon','authenticated','service_role']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
          assert.equal(await scalar('select has_table_privilege($1,$2,$3)', [role,table,privilege]), false);
        }
      }
      for (const signature of ['public.snote_research_vehicle_catalog_list()','public.snote_vehicle_taxonomy_list()','public.snote_vehicle_taxonomy_upsert(jsonb,uuid)']) {
        for (const role of ['anon','authenticated','service_role']) assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role,signature]), role === 'authenticated');
        const row = (await db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
        assert.equal(row.prosecdef, false); assert.ok(row.proconfig.includes('search_path=""'));
      }
      for (const role of ['anon','authenticated','service_role']) assert.equal(await scalar("select has_function_privilege($1,'snote_catalog_private.activate_dataset(text,text)','EXECUTE')", [role]), false);
      assert.equal(await scalar("select has_schema_privilege('anon','snote_catalog_private','USAGE')"), false);
      assert.equal(await scalar("select to_regprocedure('public.snote_vehicle_taxonomy_upsert(jsonb)')"), null);
    });
    await test('anon, service-role and unauthenticated callers cannot read research or the backup', async () => {
      for (const role of ['anon','service_role']) {
        await reject(() => research(DEALER, role)); await reject(() => customList(DEALER, role));
        await reject(() => as(role, DEALER, () => db.query('select * from snote_catalog_private.legacy_entries')));
      }
      await reject(() => research(null));
      for (const table of ['datasets','catalog_entries','legacy_entries','legacy_backup_manifest','custom_entries']) {
        await reject(() => as('authenticated', DEALER, () => db.query('select * from snote_catalog_private.' + table)));
      }
      await reject(() => as('authenticated', DEALER, () => activate('fake', '0'.repeat(64))));
      await reject(() => as('authenticated', DEALER, () => db.query("insert into snote_catalog_private.datasets(dataset_version,manifest_sha256,expected_count) values('forged',repeat('0',64),1)")));
    });
    const firstRaw = document('synthetic-v1', [sample('year-2024'),sample('year-2025',{ model_year:'2025', engine:'2.0', qualifiers:{ sourcePeriod:'2025-01' } }),sample('global-market',{ market:'GLOBAL', model_year:'2026', fuel:'전기', sourceUrl:'https://example.test/global' })]);
    const first = await stage(firstRaw);
    await test('count, hash and complete payload checks fail closed before any activation', async () => {
      await reject(() => activate(first.version, '0'.repeat(64)), ['22023']);
      assert.equal(await scalar('select count(*)::int from snote_catalog_private.active_dataset'), 0);
      await db.query('update snote_catalog_private.catalog_entries set payload=jsonb_set(payload,$2,$3::jsonb) where research_id=$1', ['year-2024','{engine}','"tampered"']);
      await reject(() => activate(first.version, first.hash), ['22023']);
      await db.query('update snote_catalog_private.catalog_entries set payload=$2::jsonb where research_id=$1', ['year-2024',JSON.stringify(JSON.parse(firstRaw).records[0])]);
      await db.query("delete from snote_catalog_private.catalog_entries where research_id='global-market'");
      await reject(() => activate(first.version, first.hash), ['22023']);
      await db.query('insert into snote_catalog_private.catalog_entries values($1,$2,$3,$4::jsonb)', [first.version,'global-market',3,JSON.stringify(JSON.parse(firstRaw).records[2])]);
      await db.query('update snote_catalog_private.datasets set raw_document=raw_document || chr(32) where dataset_version=$1', [first.version]);
      await reject(() => activate(first.version, first.hash), ['22023']);
      await db.query('update snote_catalog_private.datasets set raw_document=$2 where dataset_version=$1', [first.version,firstRaw]);
      assert.equal(await scalar('select count(*)::int from snote_catalog_private.active_dataset'), 0);
    });
    await test('stable ids retain identical five-label observations, year/engine contexts and GLOBAL market', async () => {
      const activated = await activate(first.version,first.hash);
      assert.equal(activated.entry_count,3); assert.equal(activated.previous_version,null);
      const result = await research();
      assert.equal(result.dataset_version,first.version); assert.equal(result.manifest_sha256,first.hash); assert.equal(result.entry_count,3);
      assert.deepEqual(result.entries,JSON.parse(firstRaw).records);
      assert.equal(result.entries.filter(entry => entry.market === 'GLOBAL').length,1);
      assert.deepEqual(await research(OTHER), result); assert.deepEqual(await research(ACCOUNTANT),result);
      for (const invalid of [{}, { id:'only-id' }, { id:'different',researchId:'new-id' }]) {
        const raw = document('invalid-row-' + Object.keys(invalid).length,[sample('valid')]);
        const id = JSON.parse(raw).catalogVersion;
        if (!await scalar('select count(*)::int from snote_catalog_private.datasets where dataset_version=$1',[id])) await stage(raw,{skipRows:true});
        await reject(() => db.query('insert into snote_catalog_private.catalog_entries values($1,$2,1,$3::jsonb)',[id,'new-id',JSON.stringify(invalid)]),['23514']);
      }
    });
    await test('client writes, activated updates and immutable backup mutations are blocked', async () => {
      for (const sql of ["update snote_catalog_private.catalog_entries set payload=payload || '{\"engine\":\"changed\"}'::jsonb where research_id='year-2024'", "delete from snote_catalog_private.catalog_entries where research_id='year-2024'", "insert into snote_catalog_private.catalog_entries values('synthetic-v1','late',4,'{\"id\":\"late\",\"researchId\":\"late\"}')", "update snote_catalog_private.datasets set manifest_sha256=repeat('0',64) where dataset_version='synthetic-v1'", "delete from snote_catalog_private.datasets where dataset_version='synthetic-v1'", 'truncate snote_catalog_private.catalog_entries','truncate snote_catalog_private.datasets cascade']) await reject(() => db.exec(sql),['55000']);
      for (const sql of ['update snote_catalog_private.legacy_entries set row_data=\'{}\'::jsonb','delete from snote_catalog_private.legacy_entries','truncate snote_catalog_private.legacy_entries','update snote_catalog_private.legacy_backup_manifest set entry_count=0']) await reject(() => db.exec(sql),['55000']);
      for (const sql of ["delete from snote_catalog_private.catalog_entries", "update snote_catalog_private.active_dataset set dataset_version='forged'", "delete from public.zc_vehicle_taxonomy"]) await reject(() => as('authenticated',DEALER,() => db.exec(sql)));
      assert.deepEqual((await research()).entries,JSON.parse(firstRaw).records);
    });
    await test('new custom epoch keeps manual registration compatibility without reviving six legacy entries', async () => {
      const saved = await customSave(); assert.equal(saved.inserted,true); assert.equal(saved.company_id,COMPANY);
      assert.deepEqual(saved.entry,{ id:saved.entry.id,...CUSTOM,verification:'user_import',source:'company_vehicle_registration',market:'KR' });
      assert.deepEqual((await customList()).entries,[saved.entry]); assert.deepEqual((await customList(ADMIN)).entries,[saved.entry]);
      assert.deepEqual((await customList(OTHER)).entries,[]);
      assert.equal((await customSave({...CUSTOM,make:' 새   직접입력 ',model_year:'2025'},ADMIN)).inserted,false);
      await reject(() => customSave(CUSTOM,ACCOUNTANT));
      await reject(() => customSave(CUSTOM,DEALER,OTHER_COMPANY));
      await reject(() => customSave({...CUSTOM,company_id:OTHER_COMPANY}),['22023']);
      await reject(() => customSave({...CUSTOM,model:'with\ncontrol'}),['22023']);
      await reject(() => customSave({...CUSTOM,grade:{ nested:'invalid' }}),['22023']);
      const other = await customSave(CUSTOM,OTHER); assert.equal(other.inserted,true); assert.notEqual(other.entry.id,saved.entry.id);
      assert.equal(await scalar('select count(*)::int from public.zc_vehicle_taxonomy'),6);
      assert.equal(await scalar('select count(*)::int from snote_catalog_private.legacy_entries'),6);
      assert.equal((await research()).entries.length,3);
    });
    await test('real active membership controls reads and saves; JWT company/admin claims do not bypass it', async () => {
      for (const actor of [null,INACTIVE,UNASSIGNED,VIEWER]) { await reject(() => research(actor)); await reject(() => customList(actor)); await reject(() => customSave(CUSTOM,actor)); }
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'admin',company_id:COMPANY,user_metadata:{role:'admin'}})]);
      await reject(() => research(UNASSIGNED));
      await db.query('update public.zc_members set active=false where user_id=$1',[DEALER]);
      try { await reject(() => research()); await reject(() => customList()); } finally { await db.query('update public.zc_members set active=true where user_id=$1',[DEALER]); }
      await db.query("insert into public.zc_members values($1,$2,'dealer',true)",[DEALER,OTHER_COMPANY]);
      try { await reject(() => research()); await reject(() => customSave()); } finally { await db.query('delete from public.zc_members where user_id=$1 and company_id=$2',[DEALER,OTHER_COMPANY]); }
      await db.query("select set_config('request.jwt.claims','{}',false)");
    });
    await test('RLS still hides backup, shared rows and manual rows under accidental SELECT grants', async () => {
      for (const table of ['legacy_entries','datasets','catalog_entries','custom_entries']) {
        await db.exec('grant select on snote_catalog_private.' + table + ' to authenticated');
        try { assert.equal(await as('authenticated',DEALER,() => scalar('select count(*)::int from snote_catalog_private.' + table)),0); }
        finally { await db.exec('revoke select on snote_catalog_private.' + table + ' from authenticated'); }
      }
      assert.equal((await research()).entry_count,3);
    });
    await test('bad stages leave the old pointer intact; successful activation and rollback are atomic', async () => {
      const bad = await stage(document('synthetic-count-error',[sample('count-error')]),{expectedCount:2});
      await reject(() => activate(bad.version,bad.hash),['22023']); assert.equal((await research()).dataset_version,first.version);
      const second = await stage(document('synthetic-v2',[sample('replacement',{make:'기아',grade:'새자료'})]));
      const result = await activate(second.version,second.hash); assert.equal(result.previous_version,first.version);
      assert.equal((await research()).dataset_version,second.version); assert.equal((await research()).entries[0].make,'기아');
      await activate(first.version,first.hash); assert.equal((await research()).dataset_version,first.version);
      await activate(first.version,first.hash); assert.deepEqual((await research()).entries,JSON.parse(firstRaw).records);
    });
    await test('migration reapply preserves activated dataset, new custom epoch and original private backup', async () => {
      const before = await research(), customBefore = await customList();
      await db.exec(MIGRATION);
      assert.deepEqual(await research(),before); assert.deepEqual(await customList(),customBefore);
      assert.deepEqual((await db.query('select row_data from snote_catalog_private.legacy_entries order by id')).rows.map(row => row.row_data),legacyBefore);
      assert.deepEqual((await db.query('select * from public.zc_datasets')).rows,untouched);
      assert.deepEqual((await db.query('select * from public.zc_members order by user_id')).rows,membersBefore);
    });
    const runtimePath = path.join(ROOT,'assets/vehicle-catalog.json');
    if (fs.existsSync(runtimePath)) await test('all 3,128 real observations and 154 GLOBAL rows round-trip with exact document SHA and full context', async () => {
      const raw = fs.readFileSync(runtimePath,'utf8'); const parsed = JSON.parse(raw);
      assert.equal(parsed.records.length,3128); assert.equal(new Set(parsed.records.map(row => row.id)).size,3128);
      const real = await stage(raw); await activate(real.version,real.hash);
      const result = await research(); assert.equal(result.entry_count,3128); assert.equal(result.manifest_sha256,sha(raw));
      assert.deepEqual(result.entries,parsed.records); assert.equal(result.entries.filter(row => row.market === 'GLOBAL').length,154);
      assert.equal(result.entries.filter(row => row.market === 'KR').length,2974);
      assert.deepEqual((await db.query('select row_data from snote_catalog_private.legacy_entries order by id')).rows.map(row => row.row_data),legacyBefore);
      await db.exec(MIGRATION); assert.equal((await research()).entry_count,3128);
      await activate(first.version,first.hash); assert.equal((await research()).dataset_version,first.version);
    });
  } finally { await db.close(); }
  console.log(`${passed} runtime catalog database tests passed; ${failed} failed`);
})().catch(error => { console.error(error.code || error.name,error.message); process.exitCode = 1; });
