'use strict';
// Real SQL authorization/CAS tests in an isolated Postgres WASM instance.
// No production credentials, hosted database or business records are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.DEALER_RATE_SQL_ARTIFACT_DIR||'/tmp/snote-dealer-finance-rates-sql';
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NIL='00000000-0000-0000-0000-000000000000';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',AC='33333333-3333-4333-8333-333333333333',OFF='44444444-4444-4444-8444-444444444444',FOREIGN='55555555-5555-4555-8555-555555555555',FORMER='66666666-6666-4666-8666-666666666666';
const migrationFile=fs.readdirSync(path.join(ROOT,'supabase/migrations')).find(name=>name.endsWith('_dealer_inventory_finance_rates.sql'));
assert(migrationFile,'A CLI-generated dealer inventory finance rates migration must exist');
const migrationPath=path.join(ROOT,'supabase/migrations',migrationFile),migration=fs.readFileSync(migrationPath,'utf8');
const datasetBaseline=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/recycle-bin-db.cjs'),'utf8').match(/^const BASELINE=(.+);$/m)[1]);
(async()=>{const db=new PGlite();await db.waitReady;const results=[];
 const scalar=async(query,params=[])=>Object.values((await db.query(query,params)).rows[0])[0];
 async function actor(role,id,fn){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id||'',role]);try{return await fn();}finally{await db.exec('reset role');}}
 const get=id=>actor('authenticated',id,()=>scalar('select public.snote_dealer_finance_rates_get()'));
 const list=(id,company=C)=>actor('authenticated',id,()=>scalar('select public.snote_dealer_finance_rates_list($1)',[company]));
 const save=(id,rates,revision,company=C,expected=id)=>actor('authenticated',id,()=>scalar('select public.snote_dealer_finance_rates_save($1,$2,$3::jsonb,$4)',[company,expected,JSON.stringify(rates),revision]));
 const denied=async(fn,code='42501')=>assert.rejects(fn,error=>error.code===code);
 const own=(result,id,company=C)=>result.profiles.find(profile=>profile.ownerId===id&&profile.companyId===company);
 const pass=name=>{results.push({name,ok:true});console.log('PASS '+name);};
 const cars=async(owner,company,payload)=>db.query("insert into public.zc_datasets values($1,$2,'cars',$3::jsonb) on conflict(company_id,owner_id,dataset) do update set payload=excluded.payload",[company,owner,JSON.stringify(payload)]);
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),deleted_at timestamptz,banned_until timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true),'is_anonymous',false)$$;grant usage on schema auth,public to anon,authenticated,service_role;create table public.zc_companies(id uuid primary key);create table public.zc_members(user_id uuid,company_id uuid,role text,active boolean);create table public.zc_datasets(company_id uuid,owner_id uuid,dataset text,payload jsonb,primary key(company_id,owner_id,dataset));create schema snote_private;create table snote_private.vehicle_shares(company_id uuid,owner_id uuid,car_id text,recipient_id uuid,recipient_company_id uuid,state text,permission text default 'read');");
  await db.exec(datasetBaseline.functions.find(row=>row.name==='zc_is_member').definition);
  await db.exec('alter table public.zc_datasets enable row level security;grant select on public.zc_datasets,public.zc_members to authenticated;create policy zc_datasets_read on public.zc_datasets for select to authenticated using('+datasetBaseline.policies.find(row=>row.name==='zc_datasets_read').using+')');
  await db.query('insert into public.zc_companies values($1),($2)',[C,D]);
  for(const id of[A,B,AC,OFF,FOREIGN,FORMER])await db.query('insert into auth.users(id) values($1)',[id]);
  for(const[id,company,role,active]of[[A,C,'dealer',true],[B,C,'admin',true],[AC,C,'accountant',true],[OFF,C,'dealer',false],[FOREIGN,D,'dealer',true],[FORMER,C,'dealer',true]])await db.query('insert into public.zc_members values($1,$2,$3,$4)',[id,company,role,active]);
  await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/202611010005_vehicle_taxonomy.sql'),'utf8'));
  const shareMigration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107041621_vehicle_share_acceptance.sql'),'utf8');
  await db.exec(shareMigration.slice(shareMigration.indexOf('create or replace function snote_private.share_member'),shareMigration.indexOf('create or replace function snote_private.vehicle_share(')));
  await db.exec(migration);await db.exec(migration);
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='snote_dealer_rate_private.profiles'::regclass"),true);
  const initial=await get(A);assert.deepEqual(initial,{companyId:C,userId:A,rates:{},revision:0});
  const firstList=await list(A);assert.deepEqual(firstList.profiles,[{companyId:C,ownerId:A,rates:{},fallbackRates:{},lenderNames:['KB캐피탈','JB우리금융','메리츠','현대캐피탈'],revision:0,sharedOnly:false}]);
  pass('idempotent migration enables RLS and returns an own default profile without modifying finance datasets');

  await cars(A,C,[{id:'car-a',inventoryLender:'KB캐피탈'}]);await cars(B,C,[{id:'car-b',inventoryLender:'KB캐피탈'}]);
  const a=await save(A,{'KB캐피탈':6.125},0),b=await save(B,{'KB캐피탈':9,'영점금융':0,'최대금융':100,'정밀금융':3.1234},0);
  assert.equal(a.revision,1);assert.equal(b.revision,1);assert.equal((await get(A)).rates['KB캐피탈'],6.125);assert.equal((await get(B)).rates['KB캐피탈'],9);
  assert.deepEqual((await list(A)).profiles.map(p=>p.ownerId),[A]);assert.equal(own(await list(B),A).rates['KB캐피탈'],6.125);assert.equal(own(await list(AC),B).rates['KB캐피탈'],9);
  pass('dealer overrides are isolated while authorized company admin and accountant use each vehicle owner profile');

  await denied(()=>save(A,{'KB캐피탈':8},1,C,B));await denied(()=>save(A,{'KB캐피탈':8},1,D));await denied(()=>list(A,D));
  await denied(()=>save(A,{'KB캐피탈':8},0),'40001');assert.deepEqual(await save(A,a.rates,1),a);assert.deepEqual(await get(A),a);
  pass('expected company/user checks and revision CAS reject impersonation and stale writes without optimistic persistence');

  for(const invalid of[null,[],{'':1},{' KB캐피탈':1},{'KB캐피탈 ':1},{'x\ny':1},{['x'.repeat(46)]:1},{'KB캐피탈':-1},{'KB캐피탈':100.0001},{'KB캐피탈':0.12345},{'KB캐피탈':'6'},{'KB캐피탈':true},{'KB캐피탈':{}},Object.fromEntries(Array.from({length:101},(_,i)=>['금융'+i,3]))])await denied(()=>save(A,invalid,1),'22023');
  await denied(()=>save(A,{},-1),'22023');assert.deepEqual(await get(A),a);
  pass('rate schema accepts exact zero and four fractional digits but rejects malformed, excessive or unsafe numeric input');

  const financeC=[['KB캐피탈',150000,5.5],['금리미설정',10000,null],['문자금리',10000,'7.25'],['정밀기존',10000,5.123456],['잘못된한도',-1,77],{_snote203_meta:{prestock:{total:123}}}];
  await db.query("insert into public.zc_datasets values($1,$2,'finance_limits',$3::jsonb)",[C,NIL,JSON.stringify(financeC)]);
  const fallbackBefore=await scalar("select payload from public.zc_datasets where company_id=$1 and dataset='finance_limits'",[C]);
  const full=own(await list(A),A);assert.deepEqual(full.lenderNames,['KB캐피탈','금리미설정','문자금리','정밀기존']);assert.deepEqual(full.fallbackRates,{'KB캐피탈':5.5,'문자금리':7.25,'정밀기존':5.1235});
  assert.equal((await actor('authenticated',A,()=>db.query("select payload from public.zc_datasets where dataset='finance_limits'"))).rows.length,0);
  for(const id of[B,AC])assert.equal((await actor('authenticated',id,()=>db.query("select payload from public.zc_datasets where dataset='finance_limits'"))).rows.length,1);
  assert.equal(own(await list(A),A).lenderNames.includes('금리미설정'),true);assert.deepEqual(own(await list(A),A).rates,{'KB캐피탈':6.125});
  pass('existing dataset RLS hides company limits from dealers while the own catalog includes every registered lender without requiring personal or default rates');
  assert.equal(JSON.stringify(full).includes('150000'),false);assert.equal(JSON.stringify(full).includes('prestock'),false);
  const cleared=await save(A,{},1);assert.equal(cleared.revision,2);assert.deepEqual(cleared.rates,{});const inherited=own(await list(A),A);assert.equal(inherited.fallbackRates['KB캐피탈'],5.5);assert.deepEqual(inherited.lenderNames,full.lenderNames);assert.deepEqual(inherited.rates,{});assert.deepEqual(await scalar("select payload from public.zc_datasets where company_id=$1 and dataset='finance_limits'",[C]),fallbackBefore);
  pass('clearing an override restores server-derived legacy fallback without exposing limits or changing company settings');

  assert.equal((await get(AC)).revision,0);await denied(()=>save(AC,{'KB캐피탈':4},0));await denied(()=>get(OFF));
  await db.query('insert into public.zc_members values($1,$2,$3,true)',[A,D,'dealer']);await denied(()=>get(A));await db.query('delete from public.zc_members where user_id=$1 and company_id=$2',[A,D]);
  await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[A]);await denied(()=>get(A));await db.query('update auth.users set banned_until=null where id=$1',[A]);
  pass('accountant writes, inactive memberships, ambiguous membership and banned actors remain forbidden');

  await save(FORMER,{'KB캐피탈':4.75},0);await cars(FORMER,C,[{id:'former-car',inventoryLender:'KB캐피탈'}]);
  await db.query('delete from public.zc_members where user_id=$1',[FORMER]);await db.query('delete from auth.users where id=$1',[FORMER]);
  assert.equal(own(await list(B),FORMER).rates['KB캐피탈'],4.75);assert.equal(own(await list(AC),FORMER).rates['KB캐피탈'],4.75);assert.equal(own(await list(A),FORMER),undefined);await denied(()=>get(FORMER));
  await cars(FORMER,C,[]);assert.equal(own(await list(B),FORMER),undefined);await cars(FORMER,C,[{id:'former-car',inventoryLender:'KB캐피탈'}]);
  pass('former dealer rates survive membership/auth deletion while company vehicles exist and stay hidden from unrelated dealers');

  await save(FOREIGN,{'KB캐피탈':11,'비공개금융':22},0,D);await cars(FOREIGN,D,[{id:'shared-foreign',inventoryLender:'KB캐피탈'},{id:'private-foreign',inventoryLender:'비공개금융'}]);
  await db.query("insert into public.zc_datasets values($1,$2,'finance_limits',$3::jsonb)",[D,NIL,JSON.stringify([['KB캐피탈',123000,12],['비공개금융',777000,99]])]);
  await db.query("insert into snote_private.vehicle_shares(company_id,owner_id,car_id,recipient_id,recipient_company_id,state) values($1,$2,'shared-foreign',$3,$4,'pending')",[D,FOREIGN,A,C]);
  assert.equal(own(await list(A),FOREIGN,D),undefined);
  await db.exec("update snote_private.vehicle_shares set state='accepted'");const shared=own(await list(A),FOREIGN,D);
  assert.deepEqual(shared,{companyId:D,ownerId:FOREIGN,rates:{'KB캐피탈':11},fallbackRates:{'KB캐피탈':12},lenderNames:['KB캐피탈'],revision:1,sharedOnly:true});
  assert.equal(JSON.stringify(shared).includes('비공개금융'),false);assert.equal(own(await list(AC),FOREIGN,D),undefined);assert.equal(own(await list(B),FOREIGN,D),undefined);
  pass('accepted vehicle sharing exposes only that vehicle lender terms with source-company fallback, never unrelated borrowing terms');

  await db.exec("update snote_private.vehicle_shares set state='rejected'");assert.equal(own(await list(A),FOREIGN,D),undefined);
  await db.exec("update snote_private.vehicle_shares set state='accepted'");await db.query('update public.zc_members set active=false where user_id=$1',[FOREIGN]);assert.equal(own(await list(A),FOREIGN,D),undefined);await db.query('update public.zc_members set active=true where user_id=$1',[FOREIGN]);
  await cars(B,D,[{id:'shared-foreign',inventoryLender:'KB캐피탈'}]);assert.equal(own(await list(A),FOREIGN,D),undefined);await cars(B,D,[]);
  await cars(FOREIGN,D,[{id:'private-foreign',inventoryLender:'비공개금융'}]);assert.equal(own(await list(A),FOREIGN,D),undefined);
  pass('rejected/revoked, inactive-owner, duplicate-owner and missing-vehicle shares cannot retain access');

  await db.query("update public.zc_datasets set payload='[]'::jsonb where company_id=$1 and dataset='finance_limits'",[C]);assert.deepEqual(own(await list(A),A).lenderNames,[]);assert.deepEqual(own(await list(A),A).fallbackRates,{});
  await db.query("update public.zc_datasets set payload='{}'::jsonb where company_id=$1 and dataset='cars' and owner_id=$2",[C,B]);assert.equal(own(await list(AC),B),undefined);
  pass('an authoritative empty finance catalogue stays empty and malformed car payloads do not fabricate owners');

  for(const role of['anon','service_role'])for(const command of['select public.snote_dealer_finance_rates_get()',"select public.snote_dealer_finance_rates_list('"+C+"'::uuid)"])await denied(()=>actor(role,A,()=>scalar(command)));
  await denied(()=>actor('authenticated',A,()=>db.query('select * from snote_dealer_rate_private.profiles')));
  await denied(()=>actor('authenticated',A,()=>db.query("select snote_dealer_rate_private.company_fallback('"+D+"'::uuid)")));
  await db.exec('grant select on snote_dealer_rate_private.profiles to authenticated');assert.equal((await actor('authenticated',A,()=>db.query('select * from snote_dealer_rate_private.profiles'))).rows.length,0);
  const publicSecurity=await db.query("select prosecdef from pg_proc where oid in('public.snote_dealer_finance_rates_get()'::regprocedure,'public.snote_dealer_finance_rates_list(uuid)'::regprocedure,'public.snote_dealer_finance_rates_save(uuid,uuid,jsonb,integer)'::regprocedure)");assert(publicSecurity.rows.every(row=>row.prosecdef===false));
  pass('private tables/helpers and public RPCs deny anon/service access; RLS still denies direct authenticated reads if SELECT is accidentally granted');

  fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),migration:path.relative(ROOT,migrationPath),sourceHashes:{[path.relative(ROOT,migrationPath)]:crypto.createHash('sha256').update(migration).digest('hex'),'tests/dealer-finance-rates.sql.cjs':crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')},results,productionWrites:0},null,2)+'\n');
  console.log('PASS dealer finance rate SQL groups',results.length);
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
