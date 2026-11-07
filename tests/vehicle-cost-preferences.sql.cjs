'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',AC='33333333-3333-4333-8333-333333333333',OFF='44444444-4444-4444-8444-444444444444';
const CUSTOM='custom-55555555-5555-4555-8555-555555555555';
(async()=>{const db=new PGlite();await db.waitReady;let groups=0;const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
 async function actor(role,id,fn){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');}}
 const read=id=>actor('authenticated',id,()=>scalar('select public.snote_vehicle_cost_config_get()'));
 const save=(id,config,revision,company=C,expected=id)=>actor('authenticated',id,()=>scalar('select public.snote_vehicle_cost_config_save($1,$2,$3::jsonb,$4)',[company,expected,JSON.stringify(config),revision]));
 const denied=async(fn,code='42501')=>assert.rejects(fn,e=>e.code===code);
 try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;create table public.zc_companies(id uuid primary key);create table public.zc_members(user_id uuid,company_id uuid,role text,active boolean);");
  await db.query('insert into public.zc_companies values($1),($2)',[C,D]);for(const id of[A,B,AC,OFF])await db.query('insert into auth.users values($1)',[id]);for(const[id,role,active]of[[A,'dealer',true],[B,'admin',true],[AC,'accountant',true],[OFF,'dealer',false]])await db.query('insert into public.zc_members values($1,$2,$3,$4)',[id,C,role,active]);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/202611010005_vehicle_taxonomy.sql'),'utf8'));
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261107014146_vehicle_cost_preferences.sql'),'utf8');await db.exec(migration);await db.exec(migration);
  const initial=await read(A);assert.equal(initial.revision,0);assert.equal(initial.config.visible.length,12);assert.deepEqual(initial.config.customFields,[]);groups++;
  const config={schemaVersion:1,visible:['inventoryInterest',CUSTOM],customFields:[{id:CUSTOM,label:'탁송비'}]};const first=await save(A,config,0);assert.equal(first.revision,1);assert.deepEqual(first.config,config);assert.deepEqual(await save(A,config,1),first);assert.deepEqual(await read(A),first);assert.deepEqual(await read(B),initial);groups++;
  await denied(()=>save(B,config,0,C,A));await denied(()=>save(A,config,1,D));assert.deepEqual(await read(B),initial);groups++;
  await denied(()=>save(A,{...config,visible:[]},0),'40001');assert.deepEqual(await read(A),first);groups++;
  for(const invalid of[{...config,extra:true},{...config,schemaVersion:2},{...config,visible:['unregistered']},{...config,visible:[CUSTOM,CUSTOM]},{...config,customFields:[{id:CUSTOM,label:'x\ny'}]},{...config,customFields:[{id:CUSTOM,label:'재고 이자'}]},{...config,customFields:[{id:CUSTOM,label:'x'.repeat(25)}]},{...config,customFields:[{id:CUSTOM,label:'탁송비'},{id:CUSTOM,label:'다른 이름'}]}])await denied(()=>save(A,invalid,1),'22023');assert.deepEqual(await read(A),first);groups++;
  assert.deepEqual(await read(AC),initial);await denied(()=>save(AC,config,0));await denied(()=>read(OFF));groups++;
  for(const role of['anon','service_role'])await denied(()=>actor(role,A,()=>scalar('select public.snote_vehicle_cost_config_get()')));await denied(()=>actor('authenticated',A,()=>db.query('select * from snote_cost_private.preferences')));await db.exec('grant select on snote_cost_private.preferences to authenticated');const rows=await actor('authenticated',A,()=>db.query('select * from snote_cost_private.preferences'));assert.equal(rows.rows.length,0);groups++;
  console.log('PASS vehicle cost preference SQL groups',groups);
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
