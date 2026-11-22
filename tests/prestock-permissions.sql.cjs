'use strict';
// Preserved production-policy definitions, executed only in isolated Postgres WASM.
const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const baseline=JSON.parse(fs.readFileSync('tests/recycle-bin-db.cjs','utf8').match(/^const BASELINE=(.+);$/m)[1]);
const A='11111111-1111-4111-8111-111111111111',K='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444',F='55555555-5555-4555-8555-555555555555';
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NIL='00000000-0000-0000-0000-000000000000';
(async()=>{const db=new PGlite();await db.waitReady;try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table public.zc_members(user_id uuid primary key,company_id uuid,role text,active boolean);
 create table public.zc_datasets(company_id uuid,dataset text,owner_id uuid,payload jsonb,revision int,updated_by uuid,updated_at timestamptz,primary key(company_id,dataset,owner_id));
 create table public.zc_audit(company_id uuid,actor_id uuid,entity text,item_key text,action text);`);
 for(const name of ['zc_is_member','zc_can_write','zc_write_dataset'])await db.exec(baseline.functions.find(row=>row.name===name).definition);
 const policy=baseline.policies.find(row=>row.name==='zc_datasets_read');
 await db.exec('alter table public.zc_datasets enable row level security;grant select on public.zc_datasets,public.zc_members to authenticated,anon;create policy zc_datasets_read on public.zc_datasets for select to authenticated using('+policy.using+');');
 for(const[id,company,role,active]of[[A,C,'admin',true],[K,C,'accountant',true],[D,C,'dealer',true],[I,C,'admin',false],[F,B,'admin',true]])await db.query('insert into public.zc_members values($1,$2,$3,$4)',[id,company,role,active]);
 for(const company of[C,B])await db.query("insert into public.zc_datasets values($1,'prestock',$2,$3,1,null,now())",[company,NIL,JSON.stringify([{id:'ps-synthetic-'+company[0],amount:3500000}])]);
 await db.query("insert into public.zc_datasets values($1,'cars',$2,$3,1,null,now())",[C,D,JSON.stringify([{id:'synthetic-dealer-car',isPrestock:true}])]);
 async function actor(uid,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+role);}
 const visible=async(company=C)=>(await db.query("select payload from public.zc_datasets where company_id=$1 and dataset='prestock' and owner_id=$2",[company,NIL])).rows;
 const canWrite=async(company=C)=>(await db.query("select public.zc_can_write($1,'prestock',$2) allowed",[company,NIL])).rows[0].allowed;
 let cases=0;
 for(const uid of[A,K]){await actor(uid);assert.equal((await visible()).length,1);assert.equal((await visible(B)).length,0);assert.equal(await canWrite(),true);assert.equal(await canWrite(B),false);cases+=4;}
 await actor(D);assert.equal((await visible()).length,0);assert.equal(await canWrite(),false);assert.equal((await db.query("select payload->0->>'isPrestock' flag from public.zc_datasets where dataset='cars' and owner_id=$1",[D])).rows[0].flag,'true');cases+=3;
 await assert.rejects(()=>db.query("select public.zc_write_dataset($1,'prestock',$2,1,'[]'::jsonb)",[C,NIL]),/권한/);cases++;
 for(const [uid,role]of[[I,'authenticated'],[F,'authenticated'],['','anon']]){await actor(uid,role);assert.equal((await visible()).length,0);assert.equal(await canWrite(),false);cases+=2;}
 await actor(A);assert.equal((await db.query("select public.zc_write_dataset($1,'prestock',$2,1,$3::jsonb) revision",[C,NIL,JSON.stringify([{id:'ps-synthetic-owned-repaid',amount:3500000,repaid:true}])])).rows[0].revision,2);cases++;
 await actor(K);assert.equal((await db.query("select public.zc_write_dataset($1,'prestock',$2,2,$3::jsonb) revision",[C,NIL,JSON.stringify([{id:'ps-synthetic-owned-repaid',amount:3500000,repaid:true}])])).rows[0].revision,3);cases++;
 console.log('PASS '+cases+' preserved-policy prestock cases: manager same-company read/write, dealer own-car flag without shared-ledger access, inactive/foreign/anon denial and exact CAS');
}finally{await db.close();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
