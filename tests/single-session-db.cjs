'use strict';
// Actual PostgreSQL execution in an isolated PGlite database. Never connects to
// production. PGlite is one backend: contender order tests are interleavings,
// not proof of simultaneous cross-connection lock contention.
// NODE_PATH=/workspace/work/deps/node_modules node tests/single-session-db.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createOperatorFixture,OP}=require('./operator-core.sql.cjs');
const {COMPANY,OWNER,OUTSIDER}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..');
const FILE=fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(name=>name.endsWith('_single_active_account_session.sql')).sort().at(-1);
assert(FILE,'The CLI-generated session migration must exist');
const SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const A='a0000000-0000-4000-8000-000000000001',B='b0000000-0000-4000-8000-000000000002',C='c0000000-0000-4000-8000-000000000003';
const START='2026-01-01T00:00:00.000Z';
let db,passed=0,failed=0;
const q=(sql,args=[])=>db.query(sql,args);
const val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function group(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(error){failed++;process.exitCode=1;console.error('FAIL',name,{code:error.code,message:error.message,where:error.where,stack:error instanceof assert.AssertionError?error.stack:undefined});}}
async function denied(fn,codes=['42501','PT401']){await assert.rejects(fn,error=>codes.includes(error.code));}
async function request({role='authenticated',user=OWNER,sid=A,method='POST',route='/rpc/snote_session_status',readOnly=false,hook=true,claims={},allowDelete=false}={},fn){
 await db.exec('begin'+(readOnly?' read only':''));
 try{
  await q("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);
  await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub:user||undefined,session_id:sid||undefined,is_anonymous:false,...claims})]);
  await q("select set_config('request.path',$1,true),set_config('request.method',$2,true)",[route,method]);
  if(allowDelete)await q("select set_config('storage.allow_delete_query','true',true)");
  await db.exec('set local role '+role);
  if(hook)await q('select snote_session_private.guard_request()');
  const result=await fn();await db.exec('commit');return result;
 }catch(error){await db.exec('rollback');throw error;}
}
const status=(sid=A,extra={})=>request({...extra,sid,route:extra.route||'/rpc/snote_session_status'},()=>val('select public.snote_session_status()'));
const claim=(sid=A,extra={})=>request({...extra,sid,route:extra.route||'/rpc/snote_session_claim'},()=>extra.confirmReplace!==undefined||extra.expectedGeneration!==undefined
 ?val('select public.snote_session_claim($1,$2)',[extra.confirmReplace??false,extra.expectedGeneration??null]):val('select public.snote_session_claim()'));
// Used only by existing ordering/access tests; consent behavior is asserted
// separately below with explicit probe and confirmation calls.
async function acceptedClaim(sid=A,extra={}){const result=await claim(sid,extra);return result.requiresConfirmation
 ?claim(sid,{...extra,confirmReplace:true,expectedGeneration:result.generation}):result;}
const confirm=(sid,generation,extra={})=>claim(sid,{...extra,confirmReplace:true,expectedGeneration:generation});
async function session(user,id,seconds=0){await q("insert into auth.sessions(id,user_id,created_at) values($1,$2,$3::timestamptz+$4*interval '1 second') on conflict(id) do update set not_after=null",[id,user,START,seconds]);}
async function newUser(){const user=randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,user+'@example.invalid']);return user;}
const primary=user=>q('select * from snote_session_private.primary_sessions where user_id=$1',[user]);
async function main(){
 db=await createOperatorFixture();
 try{
  await db.exec(`create role authenticator;create publication supabase_realtime;
   -- The reused operator fixture has unrestricted synthetic membership rows;
   -- production's actual membership RLS must also be present for this test.
   alter table public.zc_members enable row level security;
   create policy synthetic_members_read on public.zc_members for select to authenticated using(user_id=auth.uid() or public.zc_is_member(company_id));
   create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);
   create table auth.mfa_amr_claims(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);
   create table if not exists public.zc_data_sets(user_id uuid primary key,value text not null);
   alter table public.zc_data_sets enable row level security;
   create policy synthetic_legacy_own on public.zc_data_sets for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
   grant select,insert,update,delete on public.zc_data_sets to authenticated;
   create function public.synthetic_definer_write(p_value text) returns text language plpgsql security definer set search_path='' as $$begin update public.zc_data_sets set value=p_value where user_id=auth.uid();return p_value;end$$;
   revoke all on function public.synthetic_definer_write(text) from public,anon,service_role;grant execute on function public.synthetic_definer_write(text) to authenticated;
  `);
  await session(OWNER,A,0);await session(OWNER,B,10);await session(OWNER,C,20);
  const foreignSID=randomUUID();await session(OUTSIDER,foreignSID,0);
  await q('insert into auth.refresh_tokens(id,session_id) values($1,$2),($3,$4)',[randomUUID(),A,randomUUID(),C]);
  await q('insert into auth.mfa_amr_claims(id,session_id) values($1,$2)',[randomUUID(),A]);
  await q("insert into public.zc_data_sets(user_id,value) values($1,'baseline'),($2,'foreign')",[OWNER,OUTSIDER]);
  await db.exec(SQL);

  await group('private ACLs, safe invoker RPCs, volatile guards and own-only signal grants are exact',async()=>{
   for(const table of['primary_sessions','pending_claims'])for(const role of['anon','authenticated','service_role'])for(const permission of['select','insert','update','delete'])assert.equal(await val('select has_table_privilege($1,$2,$3)',[role,'snote_session_private.'+table,permission]),false);
   for(const role of['anon','authenticated','service_role'])for(const permission of['insert','update','delete'])assert.equal(await val('select has_table_privilege($1,$2,$3)',[role,'public.snote_session_signals',permission]),false);
   assert.equal(await val("select has_table_privilege('authenticated','public.snote_session_signals','select')"),true);
   assert.equal(await val("select has_table_privilege('anon','public.snote_session_signals','select')"),false);
   assert.equal(await val("select has_function_privilege('authenticated','snote_session_private.status_for(uuid,uuid)','execute')"),false);
   for(const role of['anon','service_role'])for(const name of['snote_session_claim','snote_session_status'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'public.'+name+(name==='snote_session_claim'?'(boolean,bigint)':'()')]),false);
   const funcs=(await q("select n.nspname,p.proname,p.prosecdef,p.provolatile,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='snote_session_private' and p.proname in('status_for','status','is_current','claim','guard_request')) or (n.nspname='public' and p.proname in('snote_session_claim','snote_session_status'))")).rows;
   assert.equal(funcs.length,7);for(const f of funcs){assert.equal(f.provolatile,'v');assert(f.proconfig.includes('search_path=""'));assert.equal(f.prosecdef,f.nspname!=='public');}
   assert.deepEqual((await q("select n.nspname,pg_get_function_identity_arguments(p.oid) as args,p.pronargdefaults from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname='snote_session_claim') or (n.nspname='snote_session_private' and p.proname='claim') order by n.nspname")).rows,[
    {nspname:'public',args:'p_confirm_replace boolean, p_expected_generation bigint',pronargdefaults:2},
    {nspname:'snote_session_private',args:'p_confirm_replace boolean, p_expected_generation bigint',pronargdefaults:2}]);
   assert.deepEqual((await q("select column_name from information_schema.columns where table_schema='public' and table_name='snote_session_signals' order by ordinal_position")).rows.map(x=>x.column_name),['user_id','generation','changed_at']);
   assert.deepEqual((await q("select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime'")).rows,[{schemaname:'public',tablename:'snote_session_signals'}]);
  });
  await group('legacy bootstrap and GET/HEAD checks stay read-only without automatically claiming a winner',async()=>{
   for(const method of['GET','HEAD']){
    const rows=await request({method,route:'/zc_data_sets',readOnly:true},()=>q('select * from public.zc_data_sets'));
    assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].value,'baseline');
   }
   assert.deepEqual(await status(A,{method:'GET',readOnly:true}),{ok:true,active:true,userId:OWNER,sessionId:A,generation:0,reason:'LEGACY'});
   assert.equal((await primary(OWNER)).rows.length,0);assert.equal(await val('select count(*)::int from public.snote_session_signals'),0);
   await denied(()=>claim(A,{method:'GET',readOnly:true}),['PT405']);
   await denied(()=>claim(A,{readOnly:true}),['25006']);assert.equal((await primary(OWNER)).rows.length,0);
  });
  await group('a first claim activates only the JWT owner/session and retains newer unclaimed logins',async()=>{
   assert.deepEqual(await claim(),{ok:true,active:true,userId:OWNER,sessionId:A,generation:1,reason:'ACTIVE'});
   assert.deepEqual((await q('select id from auth.sessions where user_id=$1 order by id',[OWNER])).rows.map(x=>x.id),[A,B,C]);
   assert.equal(await val('select count(*)::int from auth.sessions where id=$1',[foreignSID]),1);
   const row=(await primary(OWNER)).rows[0];assert.equal(row.session_id,A);assert.equal(row.generation,1);
   assert.deepEqual(await status(),{ok:true,active:true,userId:OWNER,sessionId:A,generation:1,reason:'ACTIVE'});
  });
  await group('refreshing and idempotently claiming the same SID never changes its login rank or signal generation',async()=>{
   const before=(await primary(OWNER)).rows[0],signal=(await q('select * from public.snote_session_signals where user_id=$1',[OWNER])).rows[0];
   await q('update auth.sessions set refreshed_at=now(),updated_at=now() where id=$1',[A]);
   assert.equal((await claim(A,{claims:{iat:9999999999}})).generation,1);
   assert.deepEqual((await primary(OWNER)).rows[0],before);assert.deepEqual((await q('select * from public.snote_session_signals where user_id=$1',[OWNER])).rows[0],signal);
  });
  await group('a takeover probe and cancellation leave the winner, tokens and signal byte-identical',async()=>{
   const snapshot=async()=>({primary:(await primary(OWNER)).rows,signals:(await q('select * from public.snote_session_signals where user_id=$1',[OWNER])).rows,
    sessions:(await q('select * from auth.sessions where user_id=$1 order by id',[OWNER])).rows,
    refresh:(await q('select * from auth.refresh_tokens order by id')).rows,mfa:(await q('select * from auth.mfa_amr_claims order by id')).rows});
   const before=await snapshot(),expected={ok:true,active:false,userId:OWNER,sessionId:B,generation:1,reason:'CONFIRMATION_REQUIRED',requiresConfirmation:true};
   for(const extra of[{}, {confirmReplace:false}, {confirmReplace:null}, {confirmReplace:true}, {confirmReplace:true,expectedGeneration:0}, {confirmReplace:true,expectedGeneration:-1}, {confirmReplace:true,expectedGeneration:2}]){
    assert.deepEqual(await claim(B,extra),expected);assert.deepEqual(await snapshot(),before);
   }
   // Cancelling means no confirm RPC. The old workspace remains authoritative;
   // the pending caller cannot use app-table/Storage/operator paths.
   assert.equal((await status(A)).active,true);assert.equal((await status(B)).active,false);
   await denied(()=>request({sid:B,route:'/zc_data_sets'},()=>q('select * from public.zc_data_sets')),['PT401']);
   assert.equal((await request({sid:B,hook:false},()=>q('select * from public.zc_data_sets'))).rows.length,0);
  });
  await group('takeover deletes only older same-user Auth sessions and their refresh/MFA dependents',async()=>{
   const result=await confirm(B,1);assert.equal(result.active,true);assert.equal(result.generation,2);assert.equal(result.sessionId,B);
   assert.deepEqual((await q('select id from auth.sessions where user_id=$1 order by id',[OWNER])).rows.map(x=>x.id),[B,C]);
   assert.equal(await val('select count(*)::int from auth.refresh_tokens where session_id=$1',[A]),0);assert.equal(await val('select count(*)::int from auth.mfa_amr_claims where session_id=$1',[A]),0);
   assert.equal(await val('select count(*)::int from auth.refresh_tokens where session_id=$1',[C]),1);assert.equal(await val('select count(*)::int from auth.sessions where id=$1',[foreignSID]),1);
  });
  await group('an old JWT cannot reclaim the winner or perform an actual security-definer REST write',async()=>{
   for(const result of[await status(A),await claim(A)])assert.deepEqual(result,{ok:true,active:false,userId:OWNER,sessionId:A,generation:2,reason:'REPLACED'});
   await denied(()=>request({sid:A,route:'/rpc/synthetic_definer_write'},()=>val("select public.synthetic_definer_write('stale')")),['PT401']);
   assert.equal(await val('select value from public.zc_data_sets where user_id=$1',[OWNER]),'baseline');
   assert.equal(await request({sid:B,route:'/rpc/synthetic_definer_write'},()=>val("select public.synthetic_definer_write('current')")),'current');
   assert.equal(await val('select value from public.zc_data_sets where user_id=$1',[OWNER]),'current');
  });
  await group('restrictive app-table RLS closes direct auth.uid ownership paths even without the REST hook',async()=>{
   assert.equal((await request({sid:A,hook:false},()=>q('select * from public.zc_data_sets'))).rows.length,0);
   assert.equal((await request({sid:A,hook:false},()=>q("update public.zc_data_sets set value='stale-direct' where user_id=$1 returning user_id",[OWNER]))).rows.length,0);
   assert.equal((await request({sid:B,hook:false,readOnly:true},()=>q('select * from public.zc_data_sets'))).rows[0].value,'current');
   assert.equal((await request({sid:A,hook:false},()=>q('select * from public.zc_members'))).rows.length,0);
   const policies=(await q("select tablename,permissive,cmd,qual,with_check from pg_policies where schemaname='public' and policyname='snote_primary_session_guard'")).rows;
   assert(policies.some(x=>x.tablename==='zc_data_sets'));assert(policies.some(x=>x.tablename==='zc_members'));assert(policies.every(x=>x.permissive==='RESTRICTIVE'&&x.cmd==='ALL'&&x.qual.includes('is_current')&&x.with_check.includes('is_current')));
  });
  await group('Storage RLS independently rejects stale reads/uploads/deletes while allowing the current owner',async()=>{
   const name=COMPANY+'/'+OWNER+'/session-probe/file.png';await q("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1)",[name]);
   assert.equal((await request({sid:B,hook:false,readOnly:true},()=>q('select name from storage.objects where name=$1',[name]))).rows.length,1);
   assert.equal((await request({sid:A,hook:false,readOnly:true},()=>q('select name from storage.objects where name=$1',[name]))).rows.length,0);
   await denied(()=>request({sid:A,hook:false},()=>q("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1)",[name+'.old'])),['42501']);
   assert.equal((await request({sid:A,hook:false,allowDelete:true},()=>q('delete from storage.objects where name=$1 returning name',[name]))).rows.length,0);
   const fresh=name+'.new';await request({sid:B,hook:false},()=>q("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1)",[fresh]));
   assert.equal((await request({sid:B,hook:false,allowDelete:true},()=>q('delete from storage.objects where name=$1 returning name',[fresh]))).rows.length,1);
   const p=(await q("select permissive,cmd,qual,with_check from pg_policies where schemaname='storage' and policyname='snote_primary_session_storage'")).rows[0];assert.equal(p.permissive,'RESTRICTIVE');assert.equal(p.cmd,'ALL');assert(p.qual.includes('is_current')&&p.with_check.includes('is_current'));
  });
  await group('losers can read only their own token-free signal and status; bypass paths and all DML remain closed',async()=>{
   assert.equal((await status(A)).active,false);
   for(const method of['GET','HEAD']){
    const rows=await request({sid:A,method,route:'/snote_session_signals',readOnly:true},()=>q('select * from public.snote_session_signals'));
    assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].user_id,OWNER);assert.equal(rows.rows[0].generation,2);assert.deepEqual(Object.keys(rows.rows[0]).sort(),['changed_at','generation','user_id']);
   }
   for(const route of['/rpc/snote_session_status/','/rpc/snote_session_status_other','/rpc/snote_session_claim_other','/snote_session_signals_other','/zc_data_sets'])await denied(()=>request({sid:A,route},()=>q('select 1')),['PT401']);
   await denied(()=>request({sid:A,method:'GET',route:'/rpc/snote_session_status'},()=>val('select public.snote_session_status()')),['PT401']);
   for(const method of['POST','PATCH','DELETE'])await denied(()=>request({sid:A,method,route:'/snote_session_signals'},()=>q('select 1')),['PT401']);
   await denied(()=>request({sid:B,hook:false},()=>q('update public.snote_session_signals set generation=999 where user_id=$1',[OWNER])),['42501']);
   assert.equal((await request({user:OUTSIDER,sid:foreignSID,hook:false,readOnly:true},()=>q('select * from public.snote_session_signals'))).rows.length,0);
  });
  await group('anon/customer and service-role REST paths retain their existing independent authorization',async()=>{
   for(const role of['anon','service_role'])assert.equal(await request({role,user:null,sid:null,route:'/rpc/snote_intake_view'},()=>val('select 7')),7);
   const response=await request({role:'service_role',user:null,sid:null,route:'/rpc/snote_intake_view'},()=>val('select public.snote_intake_view($1)',['f'.repeat(64)]));assert.equal(response.ok,false);
   await denied(()=>request({role:'anon',user:null,sid:null,route:'/rpc/snote_session_claim'},()=>val('select public.snote_session_claim()')),['42501']);
   await denied(()=>request({role:'service_role',user:null,sid:null,route:'/rpc/snote_session_claim'},()=>val('select public.snote_session_claim()')),['42501']);
  });
  await group('missing, expired, foreign, anonymous, banned and unconfirmed Auth sessions never create a winner',async()=>{
   for(const kind of['missing','expired','foreign','anonymous','banned','unconfirmed','badSID','jwtAnonymous']){
    const user=await newUser(),sid=randomUUID();if(kind!=='missing')await session(kind==='foreign'?OUTSIDER:user,sid);
    if(kind==='expired')await q("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[sid]);
    if(kind==='anonymous')await q('update auth.users set is_anonymous=true where id=$1',[user]);
    if(kind==='banned')await q("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[user]);
    if(kind==='unconfirmed')await q('update auth.users set email_confirmed_at=null where id=$1',[user]);
    const extra={user,...(kind==='jwtAnonymous'?{claims:{is_anonymous:true}}:{})},given=kind==='badSID'?'not-a-uuid':sid;
    for(const result of[await status(given,extra),await claim(given,extra)]){assert.equal(result.active,false,kind);assert.equal(result.reason,'SESSION_MISSING',kind);assert.equal(result.generation,0);}
    assert.equal((await primary(user)).rows.length,0,kind);
   }
  });
  await group('the ordering tombstone survives winner logout and an old refreshed/resurrected SID cannot return',async()=>{
   await q('delete from auth.sessions where id=$1',[B]);assert.equal((await status(B)).reason,'SESSION_MISSING');
   assert.equal((await primary(OWNER)).rows[0].session_id,B);await session(OWNER,A,0);
   await q('update auth.sessions set refreshed_at=now() where id=$1',[A]);assert.equal((await claim(A)).reason,'REPLACED');assert.equal((await primary(OWNER)).rows[0].session_id,B);
   const next=await claim(C);assert.equal(next.active,true);assert.equal(next.generation,3);assert.equal((await primary(OWNER)).rows[0].session_id,C);
  });
  await group('legacy first rollout asks before displacing older live Auth sessions without creating a fence',async()=>{
   const user=await newUser(),old=randomUUID(),pending=randomUUID(),newer=randomUUID();
   await session(user,old,0);await session(user,pending,10);await session(user,newer,20);
   await q('insert into auth.refresh_tokens values($1,$2)',[randomUUID(),old]);
   const before=(await q('select * from auth.sessions where user_id=$1 order by id',[user])).rows;
   const prompt=await claim(pending,{user});assert.deepEqual(prompt,{ok:true,active:false,userId:user,sessionId:pending,generation:0,reason:'CONFIRMATION_REQUIRED',requiresConfirmation:true});
   assert.equal((await primary(user)).rows.length,0);assert.equal(await val('select count(*)::int from public.snote_session_signals where user_id=$1',[user]),0);
   assert.deepEqual((await q('select * from auth.sessions where user_id=$1 order by id',[user])).rows,before);
   assert.equal((await status(old,{user})).reason,'LEGACY');assert.equal((await status(pending,{user})).active,false);
   assert.equal((await status(pending,{user})).reason,'SESSION_MISSING');
   await denied(()=>request({user,sid:pending,route:'/zc_data_sets'},()=>q('select * from public.zc_data_sets')),['PT401']);
   assert.equal(await val('select count(*)::int from snote_session_private.pending_claims where session_id=$1',[pending]),1);
   assert.equal((await confirm(pending,0,{user})).active,true);
   assert.equal(await val('select count(*)::int from snote_session_private.pending_claims where session_id=$1',[pending]),0);
   assert.equal(await val('select count(*)::int from auth.sessions where id=$1',[old]),0);assert.equal(await val('select count(*)::int from auth.refresh_tokens where session_id=$1',[old]),0);
   assert.equal(await val('select count(*)::int from auth.sessions where id=$1',[newer]),1);
  });
  await group('legacy pending candidates never count as existing workspaces and cancellation deletes only their own marker',async()=>{
   const user=await newUser(),old=randomUUID(),pending=randomUUID(),latest=randomUUID();await session(user,old,0);await session(user,pending,10);await session(user,latest,20);
   assert.equal((await claim(pending,{user})).requiresConfirmation,true);await q('delete from auth.sessions where id=$1',[pending]);
   assert.equal(await val('select count(*)::int from snote_session_private.pending_claims where session_id=$1',[pending]),0);assert.equal((await status(old,{user})).active,true);
   await session(user,pending,10);assert.equal((await claim(pending,{user})).requiresConfirmation,true);await q('delete from auth.sessions where id=$1',[old]);
   assert.equal((await claim(latest,{user})).active,true);assert.equal((await primary(user)).rows[0].session_id,latest);
   assert.equal(await val('select count(*)::int from auth.sessions where id=$1',[pending]),0);assert.equal(await val('select count(*)::int from snote_session_private.pending_claims where session_id=$1',[pending]),0);
  });
  await group('a changed generation requires fresh acknowledgement; old pending logins cannot displace newer winners',async()=>{
   const user=await newUser(),old=randomUUID(),middle=randomUUID(),latest=randomUUID();await session(user,old,0);await session(user,middle,10);await session(user,latest,20);
   assert.equal((await claim(old,{user})).generation,1);
   assert.equal((await claim(latest,{user})).generation,1);assert.equal((await claim(middle,{user})).generation,1);
   assert.equal((await confirm(middle,1,{user})).generation,2);
   const before=(await primary(user)).rows[0],signal=(await q('select * from public.snote_session_signals where user_id=$1',[user])).rows[0];
   const prompt=await confirm(latest,1,{user});assert.equal(prompt.reason,'CONFIRMATION_REQUIRED');assert.equal(prompt.generation,2);assert.equal(prompt.sessionId,latest);
   assert.deepEqual((await primary(user)).rows[0],before);assert.deepEqual((await q('select * from public.snote_session_signals where user_id=$1',[user])).rows[0],signal);
   assert.equal(await val('select count(*)::int from auth.sessions where id=$1',[middle]),1);
   assert.equal((await confirm(latest,prompt.generation,{user})).generation,3);
   for(const extra of[{}, {confirmReplace:true,expectedGeneration:3}])assert.equal((await claim(middle,{user,...extra})).reason,'REPLACED');
  });
  await group('missing or expired winners require no new confirmation while the immutable fence still rejects older SIDs',async()=>{
   for(const mode of['deleted','expired']){
    const user=await newUser(),old=randomUUID(),pending=randomUUID();await session(user,old,0);await claim(old,{user});await session(user,pending,10);
    assert.equal((await claim(pending,{user})).reason,'CONFIRMATION_REQUIRED');
    if(mode==='deleted')await q('delete from auth.sessions where id=$1',[old]);else await q("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[old]);
    assert.equal((await claim(pending,{user})).active,true);await session(user,old,0);
    assert.equal((await confirm(old,2,{user})).reason,'REPLACED');
   }
   const user=await newUser(),expired=randomUUID(),pending=randomUUID();await session(user,expired,0);await session(user,pending,10);
   await q("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[expired]);assert.equal((await claim(pending,{user})).active,true);
  });
  await group('same-SID acknowledgement is idempotent and stale consent cannot authorize a different dead fence',async()=>{
   const user=await newUser(),old=randomUUID(),middle=randomUUID(),latest=randomUUID();await session(user,old,0);await session(user,middle,10);await session(user,latest,20);
   await claim(old,{user});await confirm(middle,1,{user});await q('delete from auth.sessions where id=$1',[middle]);
   assert.equal((await confirm(latest,1,{user})).reason,'CONFIRMATION_REQUIRED');assert.equal((await primary(user)).rows[0].session_id,middle);
   assert.equal((await claim(latest,{user})).active,true);const before=(await primary(user)).rows[0];
   assert.equal((await confirm(latest,1,{user})).active,true);assert.deepEqual((await primary(user)).rows[0],before);
  });
  await group('all queued contender orders converge on the immutable newest login, never the latest request',async()=>{
   for(const order of[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
    const user=await newUser(),ids=[randomUUID(),randomUUID(),randomUUID()];for(let i=0;i<3;i++)await session(user,ids[i],i*10);
    for(const i of order)await acceptedClaim(ids[i],{user});assert.equal((await primary(user)).rows[0].session_id,ids[2]);
    assert.equal((await claim(ids[0],{user})).active,false);assert.equal((await claim(ids[1],{user})).active,false);
   }
  });
  await group('exact timestamp ties have a stable UUID tiebreaker and lower-ranked claims cannot ping-pong',async()=>{
   for(const reverse of[false,true]){
    const user=await newUser(),low='10000000-0000-4000-8000-000000000001',high='f0000000-0000-4000-8000-000000000002';
    // Session UUIDs are global. Use a distinct fixed rank pair per scenario.
    const ids=reverse?[randomUUID(),randomUUID()].sort():[low,high];for(const id of ids)await session(user,id,30);
    for(const id of(reverse?[...ids].reverse():ids))await acceptedClaim(id,{user});assert.equal((await primary(user)).rows[0].session_id,ids[1]);
    assert.equal((await claim(ids[0],{user})).active,false);
   }
  });
  await group('read-only guards hold shared advisory locks and POST claim holds the matching exclusive lock',async()=>{
   const shared=await request({sid:C,method:'GET',route:'/zc_members',readOnly:true},()=>q("select mode from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted"));assert(shared.rows.some(x=>x.mode==='ShareLock'));
   const exclusive=await request({sid:C,route:'/rpc/snote_session_claim'},async()=>{await q('select public.snote_session_claim()');return q("select mode from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted");});assert(exclusive.rows.some(x=>x.mode==='ExclusiveLock'));
   const rows=await request({sid:C,method:'GET',route:'/zc_data_sets',readOnly:true},()=>q('select * from public.zc_data_sets'));assert.equal(rows.rows.length,1);
  });
  await group('operator authenticated and service-role entrypoints reject a replaced exact operator SID',async()=>{
   const opA=randomUUID(),opB=randomUUID();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[OP,'operator-session@example.invalid']);
   await q("insert into snote_operator_private.operators(user_id,active,reason) values($1,true,'synthetic fixture')",[OP]);await session(OP,opA,0);await session(OP,opB,10);
   await claim(opA,{user:OP});assert.equal((await request({user:OP,sid:opA,route:'/rpc/snote_operator_context'},()=>val('select public.snote_operator_context()'))).allowed,true);
   await acceptedClaim(opB,{user:OP});assert.deepEqual(await request({user:OP,sid:opA,hook:false},()=>val('select public.snote_operator_context()')),{allowed:false});
   await denied(()=>request({role:'service_role',user:null,sid:null,route:'/rpc/snote_operator_vehicle_read'},()=>val('select public.snote_operator_vehicle_read($1,$2,$3,$4,$5)',[OP,opA,COMPANY,OWNER,'missing-car'])),['42501']);
   assert.equal((await request({user:OP,sid:opB,route:'/rpc/snote_operator_context'},()=>val('select public.snote_operator_context()'))).allowed,true);
   const source=await val("select prosrc from pg_proc where oid='snote_operator_private.verified_session(uuid,uuid)'::regprocedure");assert(source.indexOf('status_for')<source.indexOf('for share of u,s'));
  });
  await group('migration replay preserves leases/signals and refuses to replace an unrelated pre-request hook',async()=>{
   const before=(await primary(OWNER)).rows[0],signal=(await q('select * from public.snote_session_signals where user_id=$1',[OWNER])).rows[0];
   // An older deployment may still contain the original no-argument functions.
   // Replay must remove these exact overloads, never leave an unconfirmed API.
   await db.exec(`create function snote_session_private.claim() returns jsonb language sql as $$select '{"unsafe":true}'::jsonb$$;
    create function public.snote_session_claim() returns jsonb language sql as $$select '{"unsafe":true}'::jsonb$$;`);
   await db.exec(SQL);
   assert.equal(await val("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ((n.nspname='public' and p.proname='snote_session_claim') or (n.nspname='snote_session_private' and p.proname='claim')) and p.pronargs=0"),0);
   assert.equal((await claim(C)).active,true);
   assert.deepEqual((await primary(OWNER)).rows[0],before);assert.deepEqual((await q('select * from public.snote_session_signals where user_id=$1',[OWNER])).rows[0],signal);
   await db.exec("alter role authenticator set pgrst.db_pre_request='public.other_security_hook'");
   await denied(()=>db.exec(SQL),['55000']);await db.exec('rollback');
   assert.match(await val("select array_to_string(setconfig,',') from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname='authenticator'"),/public.other_security_hook/);
   await db.exec("alter role authenticator set pgrst.db_pre_request='snote_session_private.guard_request'");
   assert.equal((await primary(OWNER)).rows[0].generation,3);
  });
 }finally{await db.close();}
 console.log(`${passed} single-session PostgreSQL groups passed; ${failed} failed. Cross-connection contention is not simulated by the single-backend PGlite runtime.`);
}

// Optional actual multi-connection proof, using an explicitly labelled,
// network-isolated disposable local PostgreSQL container. No database URL,
// cloud credentials or production connection option is accepted.
async function postgresRaces(){
 const {spawn,spawnSync}=require('node:child_process');
 const container=process.env.SNOTE_SESSION_POSTGRES_CONTAINER;
 assert(/^snote-session-race-[a-z0-9-]+$/.test(container||''),'Use a dedicated snote-session-race-* local test container');
 const env={...process.env};for(const key of['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
 const docker=['--host=unix:///var/run/docker.sock'];
 const inspected=spawnSync('docker',[...docker,'inspect','--format','{{index .Config.Labels "snote.session-test"}} {{.HostConfig.NetworkMode}}',container],{env,encoding:'utf8'});
 assert.equal(inspected.status,0,inspected.stderr);assert.equal(inspected.stdout.trim(),'true none','Refuse any container without the disposable label and isolated network');
 const children=new Set();
 function psql(sql,open=false){
  const child=spawn('docker',[...docker,'exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{env});children.add(child);
  let stdout='',stderr='';const listeners=[];
  child.stdout.on('data',part=>{stdout+=part.toString();for(const fn of listeners)fn();});child.stderr.on('data',part=>stderr+=part.toString());
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{children.delete(child);resolve({code,stdout,stderr});for(const fn of listeners)fn();});});
  child.stdin.write(sql+'\n');if(!open)child.stdin.end();
  return {child,done,waitFor:marker=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PostgreSQL barrier timed out: '+marker+' '+stderr)),10000);const check=()=>{if(stdout.includes(marker)){clearTimeout(timer);resolve();}};listeners.push(check);check();})};
 }
 async function exec(sql){const result=await psql(sql).done;assert.equal(result.code,0,result.stderr);return result.stdout.trim();}
 const context=(user,sid,route='/zc_data_sets',method='POST',readOnly=false)=>`begin${readOnly?' read only':''};select set_config('request.jwt.claim.sub','${user}',true);select set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:user,session_id:sid,is_anonymous:false})}',true);select set_config('request.path','${route}',true);select set_config('request.method','${method}',true);set local role authenticated;`;
 async function waiting(mode){for(let i=0;i<100;i++){if(Number(await exec(`select count(*) from pg_locks where locktype='advisory' and not granted and mode='${mode}';`))>0)return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Expected an actual waiting PostgreSQL '+mode);}
 const user1='11111111-0000-4000-8000-000000000001',user2='22222222-0000-4000-8000-000000000002';
 const a1='11111111-0000-4000-8000-000000000011',b1='11111111-0000-4000-8000-000000000012',a2='22222222-0000-4000-8000-000000000021',b2='22222222-0000-4000-8000-000000000022';
 try{
  await exec(`create role anon;create role authenticated;create role service_role;create role authenticator;create schema auth;create schema snote_operator_private;create schema storage;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
   create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,not_after timestamptz,ip inet,user_agent text);
   create table snote_operator_private.account_state(user_id uuid primary key,archived boolean not null default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema auth,storage to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
   create table public.zc_data_sets(user_id uuid primary key,value text not null);alter table public.zc_data_sets enable row level security;
   create policy own on public.zc_data_sets for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());grant select,insert,update,delete on public.zc_data_sets to authenticated;
   create table storage.objects(id uuid primary key);alter table storage.objects enable row level security;
   create publication supabase_realtime;
   insert into auth.users(id,email,email_confirmed_at) values('${user1}','first@example.invalid',now()),('${user2}','second@example.invalid',now());
   insert into auth.sessions(id,user_id,created_at) values('${a1}','${user1}','2026-01-01'),('${b1}','${user1}','2026-01-02'),('${a2}','${user2}','2026-01-01'),('${b2}','${user2}','2026-01-02');
   insert into public.zc_data_sets values('${user1}','initial'),('${user2}','initial');`);
  await exec(SQL);
  await exec(context(user1,a1,'/rpc/snote_session_claim')+'select public.snote_session_claim();commit;');
  await exec(context(user2,a2,'/rpc/snote_session_claim')+'select public.snote_session_claim();commit;');
  const oldWriter=psql(context(user1,a1)+"select snote_session_private.guard_request();select 'OLD_WRITER_HAS_SHARED';",true);
  await oldWriter.waitFor('OLD_WRITER_HAS_SHARED');
  const takeover=psql(context(user1,b1,'/rpc/snote_session_claim')+'select public.snote_session_claim(true,1);commit;');
  await waiting('ExclusiveLock');
  oldWriter.child.stdin.end("update public.zc_data_sets set value='old-finished-before-takeover' where user_id='"+user1+"';commit;\n");
  assert.equal((await oldWriter.done).code,0);assert.equal((await takeover.done).code,0);
  assert.equal(await exec("select session_id from snote_session_private.primary_sessions where user_id='"+user1+"'"),b1);
  const staleWrite=await psql(context(user1,a1)+"select snote_session_private.guard_request();update public.zc_data_sets set value='must-never-commit';commit;").done;
  assert.notEqual(staleWrite.code,0);assert.match(staleWrite.stderr,/PT401.*SESSION_REPLACED/);assert.equal(await exec("select value from public.zc_data_sets where user_id='"+user1+"'"),'old-finished-before-takeover');
  console.log('PASS actual PostgreSQL: claim waits for an already-authorized old writer, then no old write can pass');

  const holdingClaim=psql(context(user2,b2,'/rpc/snote_session_claim')+"select public.snote_session_claim(true,1);select 'NEW_CLAIM_UNCOMMITTED';",true);
  await holdingClaim.waitFor('NEW_CLAIM_UNCOMMITTED');
  const blockedOld=psql(context(user2,a2,'/zc_data_sets','GET',true)+"select snote_session_private.guard_request();select 'STALE_GUARD_MUST_NOT_PASS';select * from public.zc_data_sets;commit;");
  await waiting('ShareLock');holdingClaim.child.stdin.end('commit;\n');assert.equal((await holdingClaim.done).code,0);
  const resumed=await blockedOld.done;assert.notEqual(resumed.code,0);assert.match(resumed.stderr,/PT401.*SESSION_REPLACED/);assert(!resumed.stdout.includes('STALE_GUARD_MUST_NOT_PASS'));
  assert.equal(await exec("select value from public.zc_data_sets where user_id='"+user2+"'"),'initial');
  console.log('PASS actual PostgreSQL: a READ ONLY GET guard waiting on a claim reads the fresh post-lock winner snapshot');
  const user3='33333333-0000-4000-8000-000000000003',a3='33333333-0000-4000-8000-000000000031',b3='33333333-0000-4000-8000-000000000032',c3='33333333-0000-4000-8000-000000000033';
  await exec(`insert into auth.users(id,email,email_confirmed_at) values('${user3}','third@example.invalid',now());
   insert into auth.sessions(id,user_id,created_at) values('${a3}','${user3}','2026-01-01'),('${b3}','${user3}','2026-01-02'),('${c3}','${user3}','2026-01-03');`);
  await exec(context(user3,a3,'/rpc/snote_session_claim')+'select public.snote_session_claim();commit;');
  for(const sid of[b3,c3])assert.match(await exec(context(user3,sid,'/rpc/snote_session_claim')+'select public.snote_session_claim();commit;'),/CONFIRMATION_REQUIRED/);
  const firstConsent=psql(context(user3,b3,'/rpc/snote_session_claim')+"select public.snote_session_claim(true,1);select 'FIRST_CONSENT_UNCOMMITTED';",true);
  await firstConsent.waitFor('FIRST_CONSENT_UNCOMMITTED');
  const staleConsent=psql(context(user3,c3,'/rpc/snote_session_claim')+'select public.snote_session_claim(true,1);commit;');
  await waiting('ExclusiveLock');firstConsent.child.stdin.end('commit;\n');assert.equal((await firstConsent.done).code,0);
  const staleResult=await staleConsent.done;assert.equal(staleResult.code,0,staleResult.stderr);assert.match(staleResult.stdout,/CONFIRMATION_REQUIRED/);assert.match(staleResult.stdout,/"generation": 2/);
  assert.equal(await exec(`select session_id from snote_session_private.primary_sessions where user_id='${user3}'`),b3);
  assert.equal(await exec(`select count(*) from auth.sessions where id='${b3}'`),'1');
  assert.match(await exec(context(user3,c3,'/rpc/snote_session_claim')+'select public.snote_session_claim(true,2);commit;'),/"active": true/);
  assert.equal(await exec(`select generation from snote_session_private.primary_sessions where user_id='${user3}'`),'3');
  console.log('PASS actual PostgreSQL: simultaneous confirmations serialize; stale acknowledgement preserves winner and requires a fresh confirmation');

  const user4='44444444-0000-4000-8000-000000000004',a4='44444444-0000-4000-8000-000000000041',b4='44444444-0000-4000-8000-000000000042';
  await exec(`insert into auth.users(id,email,email_confirmed_at) values('${user4}','fourth@example.invalid',now());
   insert into auth.sessions(id,user_id,created_at) values('${a4}','${user4}','2026-01-01'),('${b4}','${user4}','2026-01-02');`);
  const legacyProbe=psql(context(user4,b4,'/rpc/snote_session_claim')+"select public.snote_session_claim();select 'LEGACY_PENDING_UNCOMMITTED';",true);await legacyProbe.waitFor('LEGACY_PENDING_UNCOMMITTED');
  const pendingGet=psql(context(user4,b4,'/zc_data_sets','GET',true)+"select snote_session_private.guard_request();select 'PENDING_MUST_NOT_PASS';commit;");
  await waiting('ShareLock');legacyProbe.child.stdin.end('commit;\n');assert.equal((await legacyProbe.done).code,0);
  const pendingResult=await pendingGet.done;assert.notEqual(pendingResult.code,0);assert.match(pendingResult.stderr,/PT401.*SESSION_REPLACED/);assert(!pendingResult.stdout.includes('PENDING_MUST_NOT_PASS'));
  assert.match(await exec(context(user4,a4,'/rpc/snote_session_status')+'select public.snote_session_status();commit;'),/LEGACY/);
  assert.equal(await exec(`select count(*) from snote_session_private.primary_sessions where user_id='${user4}'`),'0');
  assert.equal(await exec(`select count(*) from public.snote_session_signals where user_id='${user4}'`),'0');
  await exec(`delete from auth.sessions where id='${b4}'`);assert.equal(await exec(`select count(*) from snote_session_private.pending_claims where user_id='${user4}'`),'0');
  console.log('PASS actual PostgreSQL: READ ONLY pending legacy guard sees the committed candidate marker; cancellation preserves the old legacy session');
  const version=await exec('select version();');console.log('Actual PostgreSQL race groups: 4 passed; '+version);
 }finally{for(const child of children){try{child.stdin.end('rollback;\n');}catch{}child.kill('SIGTERM');}}
}
if(require.main===module)(process.argv.includes('--postgres-race')?postgresRaces():main()).catch(error=>{console.error({code:error.code,message:error.message,where:error.where,position:error.position});process.exitCode=1;});
