'use strict';
// Disposable PostgreSQL fixtures only. No live account/email/credential is read.
// NODE_PATH=/workspace/work/deps/node_modules node tests/staff-login-ids-db.cjs
const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261118114817_company_staff_login_ids.sql','utf8');
const A='b1300000-0000-4000-8000-000000000001',D='b1300000-0000-4000-8000-000000000002',K='b1300000-0000-4000-8000-000000000003',I='b1300000-0000-4000-8000-000000000004',N='b1300000-0000-4000-8000-000000000005',B='b1300000-0000-4000-8000-000000000006',C='b1300000-0000-4000-8000-000000000010',F='b1300000-0000-4000-8000-000000000020';
(async()=>{const db=new PGlite();await db.waitReady;let groups=0;const pass=message=>{groups++;console.log('PASS '+message);};try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;
 create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}',banned_until timestamptz,deleted_at timestamptz,email_confirmed_at timestamptz default now(),is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated,anon,service_role;
 grant execute on all functions in schema auth to authenticated,anon,service_role;
 create table public.zc_members(user_id uuid primary key,company_id uuid,role text,display_name text,active boolean);
 alter table public.zc_members enable row level security;
 grant select on public.zc_members to authenticated;
 create policy members_own on public.zc_members for select to authenticated using(user_id=auth.uid());`);
 for(const[id,company,role,active,email]of[[A,C,'admin',true,'admin@example.test'],[D,C,'dealer',true,'dealer@example.test'],[K,C,'accountant',true,'accountant@example.test'],[I,C,'dealer',false,'inactive@example.test'],[N,C,'dealer',true,null],[B,F,'admin',true,'foreign@example.test']]){
  await db.query('insert into auth.users(id,email,encrypted_password,raw_user_meta_data)values($1,$2,$3,$4)',[id,email,'SECRET_PASSWORD_'+id,JSON.stringify({role:'admin',PRIVATE_AUTH_CANARY:'NEVER_RETURN'})]);
  await db.query('insert into public.zc_members values($1,$2,$3,$4,$5)',[id,company,role,'Synthetic '+role,active]);
 }
 await db.exec(migration);await db.exec(migration);
 async function actor(uid,claims={},role='authenticated'){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid,JSON.stringify({sub:uid,role:'authenticated',...claims})]);await db.exec('set role '+role);
 }
 const read=async(company=C)=>(await db.query('select public.snote_company_staff_logins($1) value',[company])).rows[0].value;
 const denied=async fn=>assert.rejects(fn,error=>error.code==='42501');
 await actor(A);const rows=await read();assert.equal(rows.length,5);assert.deepEqual(rows.map(r=>r.userId),[A,D,K,I,N]);
 assert.deepEqual(rows.find(r=>r.userId===D),{userId:D,loginId:'dealer@example.test'});assert.equal(rows.find(r=>r.userId===N).loginId,null);
 for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['loginId','userId']);
 assert(!JSON.stringify(rows).includes('foreign@example.test'));assert(!JSON.stringify(rows).includes('SECRET_PASSWORD'));assert(!JSON.stringify(rows).includes('NEVER_RETURN'));
 assert.equal((await db.query('select count(*)::int n from public.zc_members')).rows[0].n,1,'The helper deliberately scopes its privileged lookup instead of granting broad membership reads');
 pass('current administrator receives only own-company UUID/login-email pairs, including null IDs; no auth metadata/password or foreign account');
 await denied(()=>db.query('select email from auth.users'));await denied(()=>db.query('select encrypted_password from auth.users'));
 const acl=(await db.query("select has_table_privilege('authenticated','auth.users','SELECT') table_read,has_column_privilege('authenticated','auth.users','email','SELECT') email_read,has_column_privilege('authenticated','auth.users','encrypted_password','SELECT') password_read")).rows[0];assert.deepEqual(acl,{table_read:false,email_read:false,password_read:false});
 pass('authenticated callers have no direct auth.users, email, password or broad table access');
 await denied(()=>read(F));await denied(()=>read(null));await denied(()=>read('b1300000-0000-4000-8000-000000000099'));
 await actor(D,{user_metadata:{role:'admin',company_id:C},app_metadata:{role:'admin'}});await denied(()=>read());
 await actor(K);await denied(()=>read());await actor(I);await denied(()=>read());await actor(N);await denied(()=>read());await actor(B);await denied(()=>read());assert.equal((await read(F)).length,1);
 pass('expected-company, dealer/accountant/inactive role and JWT metadata spoofing are rejected by server membership');
 await actor(A,{is_anonymous:true});await denied(()=>read());await actor(A,{role:'anon'});await denied(()=>read());await actor('');await denied(()=>read());
 await actor(A,{},'anon');await denied(()=>read());await actor(A,{role:'service_role'},'service_role');await denied(()=>read());
 pass('anonymous sessions, unauthenticated callers, wrong JWT roles and service-role wrapper access are denied');
 await db.exec('reset role');await db.query('update public.zc_members set active=false where user_id=$1',[A]);await actor(A);await denied(()=>read());
 await db.exec('reset role');await db.query("update public.zc_members set active=true,role='dealer' where user_id=$1",[A]);await actor(A);await denied(()=>read());
 await db.exec('reset role');await db.query("update public.zc_members set role='admin' where user_id=$1",[A]);await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[A]);await actor(A);await denied(()=>read());
 await db.exec('reset role');await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[A]);await actor(A);await denied(()=>read());
 await db.exec('reset role');await db.query('update auth.users set deleted_at=null,email_confirmed_at=null where id=$1',[A]);await actor(A);await denied(()=>read());
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now(),is_anonymous=true where id=$1',[A]);await actor(A,{is_anonymous:false});await denied(()=>read());
 await db.exec('reset role');await db.query('update auth.users set is_anonymous=false where id=$1',[A]);await db.query('delete from auth.users where id=$1',[A]);await actor(A);await denied(()=>read());
 pass('inactive, demoted, banned, soft-deleted, unconfirmed, anonymous and deleted administrators cannot reuse an old authenticated token');
 await db.exec('reset role');const functions=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') member,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='snote_private' and p.proname='company_staff_login_ids')or(n.nspname='public'and p.proname='snote_company_staff_logins') order by n.nspname")).rows;
 assert.equal(functions.length,2);for(const fn of functions){assert.equal(fn.prosecdef,fn.nspname==='snote_private');assert.deepEqual(fn.proconfig,['search_path=""']);assert.equal(fn.anon,false);assert.equal(fn.member,true);assert.equal(fn.service,false);}
 assert.equal((await db.query('select count(*)::int n from public.zc_members')).rows[0].n,6);assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,5);
 pass('idempotent migration keeps privileged code private, public wrapper invoker-only, fixed search paths and narrowly granted execution');
 console.log(groups+' staff login ID PostgreSQL groups passed');
}finally{await db.close()}})().catch(error=>{console.error(error);process.exitCode=1});
