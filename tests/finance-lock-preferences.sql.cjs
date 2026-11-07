'use strict';
// Real isolated PostgreSQL execution; no network or production database access.
// NODE_PATH=/workspace/work/deps/node_modules node tests/finance-lock-preferences.sql.cjs
// A single connection tests stale competing snapshots; unique-key/CAS SQL
// handles actual concurrent writers in PostgreSQL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const ROOT=path.join(__dirname,'..');
const FILE='20261107041331_workspace_finance_lock_preferences.sql';
const SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const AC='33333333-3333-4333-8333-333333333333',OFF='44444444-4444-4444-8444-444444444444';
const PEER='55555555-5555-4555-8555-555555555555',FOREIGN='66666666-6666-4666-8666-666666666666';
const VIEWER='77777777-7777-4777-8777-777777777777',MISSING='88888888-8888-4888-8888-888888888888';
let db,passed=0;
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
async function actor(role,id,fn){
 assert(['anon','authenticated','service_role'].includes(role));
 await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
 try{return await fn();}finally{await db.exec('reset role');}
}
const read=(id=A,role='authenticated')=>actor(role,id,()=>scalar('select public.snote_finance_lock_get()'));
const save=(id,enabled,revision,company=id===FOREIGN?D:C,expected=id,role='authenticated')=>actor(role,id,()=>scalar('select public.snote_finance_lock_save($1::uuid,$2::uuid,$3::boolean,$4::integer)',[company,expected,enabled,revision]));
const denied=(fn,code='42501')=>assert.rejects(fn,e=>e.code===code);
async function group(name,fn){await fn();passed++;console.log('PASS',name);}
async function main(){
 db=new PGlite();await db.waitReady;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth,public to anon,authenticated,service_role;
   create table public.zc_companies(id uuid primary key);
   create table public.zc_members(user_id uuid not null,company_id uuid not null references public.zc_companies(id),role text,active boolean not null,primary key(user_id,company_id));
   create table public.zc_datasets(company_id uuid,owner_id uuid,dataset text,payload jsonb,revision integer);
   create table public.zc_customers(company_id uuid,owner_id uuid,car_id text,payload jsonb);
  `);
  await db.query('insert into public.zc_companies values($1),($2)',[C,D]);
  for(const id of[A,B,AC,OFF,PEER,FOREIGN,VIEWER,MISSING])await db.query('insert into auth.users values($1)',[id]);
  for(const[id,company,role,active]of[[A,C,'dealer',true],[B,C,'admin',true],[AC,C,'accountant',true],[OFF,C,'dealer',false],[PEER,C,'dealer',true],[FOREIGN,D,'dealer',true],[VIEWER,C,'viewer',true]])await db.query('insert into public.zc_members values($1,$2,$3,$4)',[id,company,role,active]);
  await db.query("insert into public.zc_datasets values($1,$2,'cars',$3::jsonb,7)",[C,A,JSON.stringify([{id:'untouched',buy:12345678,moneyUnit:'KRW'}])]);
  await db.query('insert into public.zc_customers values($1,$2,$3,$4::jsonb)',[C,A,'untouched',JSON.stringify({name:'Synthetic customer'})]);
  await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/202611010005_vehicle_taxonomy.sql'),'utf8'));
  const snapshot=async()=>({members:(await db.query('select * from public.zc_members order by user_id,company_id')).rows,companies:(await db.query('select * from public.zc_companies order by id')).rows,cars:(await db.query('select * from public.zc_datasets')).rows,customers:(await db.query('select * from public.zc_customers')).rows});
  const original=await snapshot();await db.exec(SQL);await db.exec(SQL);
  await group('repeated migration preserves existing membership, vehicles, customers and finance permissions',async()=>{
   assert.deepEqual(await snapshot(),original);assert.equal(await scalar('select count(*)::int from snote_workspace_private.finance_lock_preferences'),0);
  });
  await group('role defaults are read-only and come from actual active membership rather than JWT metadata',async()=>{
   await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({user_metadata:{role:'admin',finance_lock_enabled:false},app_metadata:{company_id:D}})]);
   assert.deepEqual(await read(A),{enabled:true,revision:0});assert.deepEqual(await read(B),{enabled:false,revision:0});assert.deepEqual(await read(AC),{enabled:false,revision:0});
   assert.equal(await scalar('select count(*)::int from snote_workspace_private.finance_lock_preferences'),0);
   await db.query("update public.zc_members set role='admin' where user_id=$1",[A]);assert.deepEqual(await read(A),{enabled:false,revision:0});await db.query("update public.zc_members set role='dealer' where user_id=$1",[A]);
  });
  await group('dealer/admin preferences persist independently for each user even inside the same company',async()=>{
   assert.deepEqual(await save(A,false,0),{enabled:false,revision:1});assert.deepEqual(await read(A),{enabled:false,revision:1});
   assert.deepEqual(await read(PEER),{enabled:true,revision:0});assert.deepEqual(await save(B,true,0),{enabled:true,revision:1});assert.deepEqual(await read(B),{enabled:true,revision:1});
   assert.deepEqual(await read(FOREIGN),{enabled:true,revision:0});
  });
  await group('stale first-write and subsequent-write snapshots cannot overwrite a newer preference',async()=>{
   await denied(()=>save(A,true,0),'40001');assert.deepEqual(await save(A,true,1),{enabled:true,revision:2});await denied(()=>save(A,false,1),'40001');assert.deepEqual(await read(A),{enabled:true,revision:2});
  });
  await group('expected actor/company checks reject forged, missing and stale tenant contexts without any extra row',async()=>{
   const count=await scalar('select count(*)::int from snote_workspace_private.finance_lock_preferences');
   for(const[company,expected]of[[D,A],[C,B],[null,A],[C,null]])await denied(()=>save(A,false,2,company,expected));
   assert.equal(await scalar('select count(*)::int from snote_workspace_private.finance_lock_preferences'),count);assert.deepEqual(await read(A),{enabled:true,revision:2});
  });
  await group('tenant changes isolate the new preference while preserving the previous company choice',async()=>{
   await db.query('update public.zc_members set company_id=$2 where user_id=$1',[A,D]);assert.deepEqual(await read(A),{enabled:true,revision:0});await denied(()=>save(A,false,2,C));
   assert.deepEqual(await save(A,false,0,D),{enabled:false,revision:1});await db.query('update public.zc_members set company_id=$2 where user_id=$1',[A,C]);assert.deepEqual(await read(A),{enabled:true,revision:2});
  });
  await group('accountant, inactive, unassigned and unsupported-role callers cannot change settings',async()=>{
   await denied(()=>save(AC,true,0));
   for(const id of[OFF,MISSING,VIEWER,null]){await denied(()=>read(id));await denied(()=>save(id,true,0));}
   await db.query('update public.zc_members set active=false where user_id=$1',[A]);await denied(()=>read(A));await denied(()=>save(A,false,2));await db.query('update public.zc_members set active=true where user_id=$1',[A]);
   await db.query("insert into public.zc_members values($1,$2,'dealer',true)",[A,D]);await denied(()=>read(A));await denied(()=>save(A,false,2));await db.query('delete from public.zc_members where user_id=$1 and company_id=$2',[A,D]);
  });
  await group('invalid booleans and revisions fail atomically and never consume a version',async()=>{
   for(const[enabled,revision]of[[null,2],[false,null],[false,-1],[false,2147483647]])await denied(()=>save(A,enabled,revision),'22023');
   await denied(()=>save(A,false,100),'40001');assert.deepEqual(await read(A),{enabled:true,revision:2});
  });
  await group('anonymous/service and direct-table privileges are denied; public wrappers use invoker security',async()=>{
   for(const role of['anon','service_role']){await denied(()=>read(A,role));await denied(()=>save(A,false,2,C,A,role));}
   for(const role of['anon','authenticated','service_role'])for(const privilege of['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'snote_workspace_private.finance_lock_preferences',privilege]),false);
   for(const[signature,definer]of[['public.snote_finance_lock_get()',false],['public.snote_finance_lock_save(uuid,uuid,boolean,integer)',false],['snote_workspace_private.get_finance_lock()',true],['snote_workspace_private.save_finance_lock(uuid,uuid,boolean,integer)',true]]){
    const f=(await db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0];assert.equal(f.prosecdef,definer);assert(f.proconfig.includes('search_path=""'));
    for(const role of['anon','authenticated','service_role'])assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,signature]),role==='authenticated');
   }
   assert.equal(await scalar("select relrowsecurity from pg_class where oid='snote_workspace_private.finance_lock_preferences'::regclass"),true);
   await denied(()=>actor('authenticated',A,()=>db.query('select * from snote_workspace_private.finance_lock_preferences')));
  });
  await group('RLS still hides every row under accidental SELECT grants while checked own RPC reads remain usable',async()=>{
   await db.exec('grant select on snote_workspace_private.finance_lock_preferences to authenticated');try{assert.equal((await actor('authenticated',A,()=>db.query('select * from snote_workspace_private.finance_lock_preferences'))).rows.length,0);assert.deepEqual(await read(A),{enabled:true,revision:2});}finally{await db.exec('revoke select on snote_workspace_private.finance_lock_preferences from authenticated');}
  });
  await group('migration replay retains saved choices, exact grants and all unrelated operational records',async()=>{
   const preferences=(await db.query('select * from snote_workspace_private.finance_lock_preferences order by user_id,company_id')).rows;await db.exec(SQL);
   assert.deepEqual((await db.query('select * from snote_workspace_private.finance_lock_preferences order by user_id,company_id')).rows,preferences);assert.deepEqual(await snapshot(),original);assert.deepEqual(await read(A),{enabled:true,revision:2});
  });
  console.log(`${passed} finance lock preference SQL groups passed`);
 }finally{await db.close();}
}
if(require.main===module)main().catch(error=>{console.error({code:error.code,message:error.message,where:error.where});process.exitCode=1;});
