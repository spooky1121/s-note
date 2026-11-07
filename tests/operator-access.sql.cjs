'use strict';
// Isolated PostgreSQL permissions/history checks; no network or production writes.
// NODE_PATH=/workspace/work/deps/node_modules node tests/operator-access.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const ROOT=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107013019_platform_operator_console.sql'),'utf8');
const migration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107013521_platform_operator_access.sql'),'utf8');
const OP='11111111-1111-4111-8111-111111111111',DEALER='22222222-2222-4222-8222-222222222222',ADMIN='33333333-3333-4333-8333-333333333333',UNJOINED='44444444-4444-4444-8444-444444444444';
const CO='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHERCO='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sid=n=>'99999999-9999-4999-8999-'+String(n).padStart(12,'0');
const S_OP=sid(1),S_DEALER=sid(2),S_ADMIN=sid(3),S_UNJOINED=sid(4);
let db,passed=0,failed=0;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function deny(task,codes=['42501']){await assert.rejects(task,error=>codes.includes(error.code));}
async function as(role,user,session,fn,extra={}){
 await db.exec('set role '+role);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:user,session_id:session,...extra})]);
 try{return await fn();}finally{await db.exec('reset role');}
}
const ping=(user=DEALER,session=S_DEALER,role='authenticated',extra={})=>as(role,user,session,()=>scalar('select public.snote_access_ping()'),extra);
const list=(query={},user=OP,session=S_OP,role='authenticated')=>as(role,user,session,()=>scalar('select public.snote_operator_access_list($1::jsonb)',[JSON.stringify(query)]));
async function test(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(error){failed++;process.exitCode=1;console.error('FAIL',name,error.code||error.name,error.message);}}
function functionSql(name){const start=core.indexOf('create or replace function snote_operator_private.'+name+'(');assert(start>=0,'Missing actual core function '+name);const end=core.indexOf('end$$;',start);assert(end>=0);return core.slice(start,end+7);}
(async()=>{
 db=new PGlite();await db.waitReady;
 try{
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create schema auth;create schema snote_operator_private;
   grant usage on schema public,auth to anon,authenticated,service_role;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
   create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
   create table auth.sessions(id uuid primary key,user_id uuid not null,created_at timestamptz default clock_timestamp(),updated_at timestamptz,refreshed_at timestamp,not_after timestamptz,ip inet,user_agent text);
   create table auth.audit_log_entries(id uuid primary key,created_at timestamptz,payload json,ip_address text);
   create table public.zc_companies(id uuid primary key,name text);
   create table public.zc_members(user_id uuid,company_id uuid,display_name text,active boolean,role text,joined_at timestamptz default clock_timestamp());
   create table snote_operator_private.operators(user_id uuid primary key,active boolean);
   create table snote_operator_private.account_state(user_id uuid primary key,archived boolean);
   revoke all on schema snote_operator_private from public,anon,authenticated,service_role;`);
  for(const name of ['claim_session','verified_session','require_operator','actor','query_options'])await db.exec(functionSql(name));
  await db.exec('revoke all on all functions in schema snote_operator_private from public,anon,authenticated,service_role');
  for(const[user,email]of[[OP,'operator@example.test'],[DEALER,'dealer@example.test'],[ADMIN,'admin@example.test'],[UNJOINED,'pending@example.test']]){
   await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[user,email]);
  }
  await db.query('insert into public.zc_companies values($1,$2),($3,$4)',[CO,'가상 상사',OTHERCO,'다른 상사']);
  for(const[user,role,company]of[[OP,'admin',CO],[DEALER,'dealer',CO],[ADMIN,'admin',OTHERCO]])await db.query('insert into public.zc_members(user_id,company_id,display_name,active,role) values($1,$2,$3,true,$4)',[user,company,role+' 이름',role]);
  await db.query('insert into snote_operator_private.operators values($1,true)',[OP]);
  for(const[session,user,ip,agent]of[[S_OP,OP,'203.0.113.1','Operator desktop'],[S_DEALER,DEALER,'2001:db8::123','Synthetic Android mobile'],[S_ADMIN,ADMIN,'198.51.100.10','Tenant admin'],[S_UNJOINED,UNJOINED,'198.51.100.20','Pending user']])await db.query('insert into auth.sessions(id,user_id,created_at,ip,user_agent) values($1,$2,clock_timestamp()-interval\'1 hour\',$3,$4)',[session,user,ip,agent]);
  await db.exec(migration);await db.exec(migration);
  await test('normal signed-in users can ping only their verified Auth session and trusted IP/agent',async()=>{
   const r=await ping();assert.equal(r.ok,true);assert.equal(r.sessionId,S_DEALER);
   const row=(await db.query('select * from snote_operator_private.access_sessions where session_id=$1',[S_DEALER])).rows[0];
   assert.equal(row.user_id,DEALER);assert.equal(row.login_ip,'2001:db8::123');assert.equal(row.user_agent,'Synthetic Android mobile');assert.equal(row.company_id,CO);
   assert(row.first_seen<=row.last_seen);assert.equal((await ping()).sessionId,S_DEALER);assert.equal(await scalar('select count(*) from snote_operator_private.access_sessions'),1);
   await ping(UNJOINED,S_UNJOINED);assert.equal(await scalar('select count(*) from snote_operator_private.access_sessions'),2);
   await deny(()=>as('authenticated',DEALER,S_DEALER,()=>scalar("select public.snote_access_ping('forged-ip')")),['42883']);
  });
  await test('anonymous, service, forged, expired, banned, deleted and archived sessions cannot ping',async()=>{
   await deny(()=>ping(DEALER,S_DEALER,'anon'));await deny(()=>ping(DEALER,S_DEALER,'service_role'));
   await deny(()=>ping(DEALER,S_DEALER,'authenticated',{is_anonymous:true}));await deny(()=>ping(DEALER,S_OP));await deny(()=>ping(DEALER,null));
   await db.query("update auth.sessions set not_after=clock_timestamp()-interval'1 second' where id=$1",[S_DEALER]);await deny(()=>ping());await db.query('update auth.sessions set not_after=null where id=$1',[S_DEALER]);
   await db.query("update auth.users set banned_until=clock_timestamp()+interval'1 hour' where id=$1",[DEALER]);await deny(()=>ping());await db.query('update auth.users set banned_until=null,deleted_at=clock_timestamp() where id=$1',[DEALER]);await deny(()=>ping());await db.query('update auth.users set deleted_at=null where id=$1',[DEALER]);
   await db.query('insert into snote_operator_private.account_state values($1,true)',[DEALER]);await deny(()=>ping());await db.query('delete from snote_operator_private.account_state where user_id=$1',[DEALER]);
  });
  await test('connection details require an active platform operator; tenant admins and stale operator sessions fail',async()=>{
   await deny(()=>list({},ADMIN,S_ADMIN));await deny(()=>list({},DEALER,S_DEALER));await deny(()=>list({},OP,S_OP,'anon'));await deny(()=>list({},OP,S_OP,'service_role'));await deny(()=>list({},OP,S_DEALER));
   await db.query('update snote_operator_private.operators set active=false where user_id=$1',[OP]);await deny(()=>list());await db.query('update snote_operator_private.operators set active=true where user_id=$1',[OP]);
   const r=await list();assert.equal(r.pageSize,20);assert.equal(r.activityWindowSeconds,120);assert.equal(r.observedDurationOnly,true);assert(r.items.some(x=>x.sessionId===S_DEALER&&x.loginIp==='2001:db8::123'&&x.device==='mobile'&&x.active));
  });
  await test('private storage has RLS/no direct grants; accidental SELECT does not reveal any history',async()=>{
   assert.equal(await scalar("select relrowsecurity from pg_class where oid='snote_operator_private.access_sessions'::regclass"),true);
   for(const role of['anon','authenticated','service_role'])for(const privilege of['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'snote_operator_private.access_sessions',privilege]),false);
   assert.equal(await scalar("select prosecdef from pg_proc where oid='public.snote_access_ping()'::regprocedure"),false);
   assert.equal(await scalar("select prosecdef from pg_proc where oid='public.snote_operator_access_list(jsonb)'::regprocedure"),false);
   await db.exec('grant select on snote_operator_private.access_sessions to authenticated');
   assert.equal(await as('authenticated',DEALER,S_DEALER,()=>scalar('select count(*) from snote_operator_private.access_sessions')),0);
   await db.exec('revoke select on snote_operator_private.access_sessions from authenticated');
  });
  await test('unobserved Auth sessions have unknown duration and retained history survives revocation',async()=>{
   const unknown=(await list({ownerId:ADMIN})).items.find(x=>x.sessionId===S_ADMIN);assert.equal(unknown.durationType,'auth_session');assert.equal(unknown.durationSeconds,null);assert.equal(unknown.lastSeen,null);assert.equal(unknown.active,false);assert.equal(unknown.status,'unknown');
   await db.query("update snote_operator_private.access_sessions set first_seen=clock_timestamp()-interval'7 minutes',last_seen=clock_timestamp()-interval'5 minutes' where session_id=$1",[S_DEALER]);
   const seen=(await list({ownerId:DEALER})).items.find(x=>x.sessionId===S_DEALER);assert.equal(seen.active,false);assert.equal(seen.status,'idle');assert.equal(seen.sessionValid,true);assert(seen.durationSeconds>=119&&seen.durationSeconds<=121);
   assert.equal((await list({status:'ended'})).total,0,'Idle and unobserved sessions are not ended sessions');
   assert.equal((await list({status:'archived'})).total,0,'The ended alias also excludes idle and unknown history');
   await db.query('delete from auth.sessions where id=$1',[S_DEALER]);await deny(()=>ping());
   const retained=(await list({ownerId:DEALER})).items.find(x=>x.sessionId===S_DEALER);assert.equal(retained.email,'dealer@example.test');assert.equal(retained.loginIp,'2001:db8::123');assert.equal(retained.durationType,'heartbeat');assert.equal(retained.active,false);assert.equal(retained.sessionValid,false);assert.equal(retained.status,'ended');
   for(const status of['ended','archived']){const r=await list({status});assert.equal(r.total,1);assert.equal(r.items[0].sessionId,S_DEALER);assert(r.items.every(x=>x.status==='ended'&&!x.sessionValid));}
  });
  await test('historical Auth login/logout events use real audit IP and preserve unknown duration without duplicate sign-ins',async()=>{
   const date=await scalar('select created_at from auth.sessions where id=$1',[S_ADMIN]);
   const events=[['aaaaaaaa-1111-4111-8111-111111111111',date,'login',ADMIN,'198.51.100.10'],['aaaaaaaa-2222-4222-8222-222222222222','2020-01-01T10:00:00Z','login',ADMIN,'203.0.113.22'],['aaaaaaaa-3333-4333-8333-333333333333','2020-01-01T11:00:00Z','logout',ADMIN,'invalid-ip'],['aaaaaaaa-4444-4444-8444-444444444444','2020-01-02T11:00:00Z','login','not-a-uuid','203.0.113.10'],['aaaaaaaa-5555-4555-8555-555555555555','2020-01-03T11:00:00Z','user_updated',ADMIN,'203.0.113.10']];
   for(const[id,at,action,user,ip]of events)await db.query('insert into auth.audit_log_entries values($1,$2,$3,$4)',[id,at,JSON.stringify({action,actor_id:user,actor_username:'historical@example.test'}),ip]);
   const r=await list({ownerId:ADMIN,sort:'loginAt',direction:'asc'});assert.equal(r.total,3);
   const old=r.items.filter(x=>x.durationType==='audit_event');assert.equal(old.length,2);assert(old.every(x=>x.durationSeconds===null&&x.sessionId===null&&x.status==='unknown'));
   assert.equal(old.find(x=>x.eventType==='login').loginIp,'203.0.113.22');assert.equal(old.find(x=>x.eventType==='logout').loginIp,null);
   assert.equal((await list({ownerId:ADMIN,status:'ended'})).total,0,'Unknown audit login/logout events do not acquire an invented ended status');
  });
  await test('query/sort/filter validation is closed; stable pages contain at most twenty rows',async()=>{
   for(const q of[{page:0},{page:1.2},{page:1000000},{sort:'email;drop table auth.users'},{direction:'bad'},{status:'made-up'},{query:'x'.repeat(121)},{companyId:'invalid'},{unknown:true}])await deny(()=>list(q),['22023']);
   for(let n=10;n<45;n++)await db.query("insert into auth.sessions(id,user_id,created_at,ip,user_agent) values($1,$2,clock_timestamp()-($3||' minutes')::interval,'198.51.100.99','Synthetic desktop')",[sid(n),ADMIN,String(n)]);
   const a=await list({ownerId:ADMIN,sort:'loginAt',direction:'asc',page:1}),b=await list({ownerId:ADMIN,sort:'loginAt',direction:'asc',page:2});assert.equal(a.items.length,20);assert.equal(b.items.length,18);assert.equal(a.total,38);assert.equal(a.pageSize,20);assert.equal(new Set([...a.items,...b.items].map(x=>x.recordId)).size,38);
   const co=await list({companyId:CO});assert(co.items.every(x=>x.companyId===CO));
   assert.equal((await list({query:"' OR true; --"})).items.length,0);assert.equal((await list({status:'active'})).items.some(x=>!x.active),false);
  });
  console.log(JSON.stringify({passed,failed}));
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
