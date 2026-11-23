'use strict';
// Isolated real PostgreSQL migration checks. All contacts/passwords are synthetic.
// NODE_PATH=/workspace/work/deps/node_modules node tests/phone-recovery.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createOperatorFixture,OP,OP_SESSION}=require('./operator-core.sql.cjs');
const {COMPANY,FOREIGN,OWNER,ADMIN,OUTSIDER,INACTIVE}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..'),FILE='20261123132420_phone_account_recovery.sql',SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
let db,passed=0,failed=0;const q=(sql,args=[])=>db.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const hash=s=>createHash('sha256').update(s).digest('hex'),OTP=hash('synthetic-otp-proof'),RECEIPT=hash('synthetic-receipt'),IP=hash('synthetic-ip');
const PHONE='01012345678',NAME='Synthetic dealer';
async function as(role,fn){await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role})]);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}}
const rpc=(name,args=[],role='service_role')=>as(role,()=>v('select public.snote_phone_recovery_'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args));
const prepare=(opts={})=>{const o={request:randomUUID(),challenge:randomUUID(),purpose:'password',name:NAME,phone:PHONE,ip:IP,...opts};return rpc('prepare',[o.request,o.challenge,o.purpose,o.name,o.phone,hash(o.phone),o.ip,OTP]);};
const verify=(id,purpose='password',otp=OTP,receipt=RECEIPT,ip=IP)=>rpc('verify',[id,purpose,otp,receipt,ip]);
const delivered=id=>rpc('delivery',[id,'sent']);
const deny=async(fn,codes=['42501'])=>assert.rejects(fn,e=>codes.includes(e.code));
async function test(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;process.exitCode=1;console.error('FAIL',name,e.code,e.message,e.where||'',e.stack);}}
async function cool(){await q("update snote_private.recovery_rate_events set created_at=clock_timestamp()-interval'25 hours'");}
async function bind(user=OWNER,phone=PHONE){await q("insert into snote_private.recovery_phone_bindings(user_id,phone,verified_at,source) values($1,$2,clock_timestamp(),'profile_otp') on conflict(user_id) do update set phone=excluded.phone,invalidated_at=null",[user,phone]);}
async function proof(){await cool();const p=await prepare();assert.equal(p.canSend,true);await delivered(p.challengeId);const r=await verify(p.challengeId);assert.equal(r.route,'phone');return p;}
async function job(p){const j={id:randomUUID(),challenge:p.challengeId,receipt:RECEIPT,fp:hash('new-password-'+randomUUID()),executor:hash(randomUUID())};j.result=await rpc('reset_prepare',[j.id,j.challenge,j.receipt,j.fp,j.executor]);return j;}
const finish=(j,outcome)=>rpc('reset_finalize',[j.id,j.receipt,j.fp,j.executor,outcome]);
async function createRecoveryFixture({apply=true}={}){const d=await createOperatorFixture();

 await d.exec(`alter table auth.users add column role text,add column aud text,add column phone text,add column phone_confirmed_at timestamptz,add column encrypted_password text default 'synthetic-existing-password';`);
 await d.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261106113504_personal_profile_editor.sql'),'utf8'));
 await d.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261106131154_verified_profile_contact.sql'),'utf8'));
 const registration=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261122144025_verified_registration.sql'),'utf8');const start=registration.indexOf('create or replace function snote_private.registration_phone('),end=registration.indexOf('end$f$;',start);await d.exec(registration.slice(start,end+7));
 await d.query('update public.zc_members set phone=$2,display_name=$3 where user_id=$1',[OWNER,PHONE,NAME]);await d.query('insert into snote_private.member_profiles(user_id,phone) values($1,$2)',[OWNER,PHONE]);
 await d.query("insert into auth.users(id,email,email_confirmed_at) values($1,'operator@example.invalid',now())",[OP]);await d.query('insert into snote_operator_private.operators(user_id,active) values($1,true)',[OP]);
 if(apply)await d.exec(SQL);return d;
}
async function main(){db=await createRecoveryFixture({apply:false});try{
 const defs=await v("select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_operator_private' and p.proname in('actor','verified_session','account_snapshot','account_version')");
 await db.exec(SQL);
 await test('migration is idempotent and all public/private recovery boundaries are service-only',async()=>{
  await db.exec(SQL);assert.deepEqual(await v("select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_operator_private' and p.proname in('actor','verified_session','account_snapshot','account_version')"),defs);
  const fn=await q("select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'snote_phone_recovery_%'");assert.equal(fn.rows.length,6);
  for(const f of fn.rows){assert.equal(f.prosecdef,false);for(const role of['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2::oid,$3)',[role,f.oid,'EXECUTE']),false);}
  for(const t of['recovery_phone_bindings','recovery_challenges','recovery_rate_events','recovery_reset_jobs'])for(const role of['anon','authenticated','service_role'])for(const perm of['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await v('select has_table_privilege($1,$2,$3)',[role,'snote_private.'+t,perm]),false);
  await deny(()=>prepare.call(null,{}).then(()=>rpc('verify',[randomUUID(),'password',OTP,RECEIPT,IP],'authenticated')));
 });
 await test('unverified legacy contact gets SMS proof then native email only; never a direct reset receipt',async()=>{
  await cool();const p=await prepare();assert.equal(p.canSend,true);assert.equal(p.phone,PHONE);await delivered(p.challengeId);const r=await verify(p.challengeId);assert.equal(r.route,'email');assert.equal(r.claimedEmail,true);assert.equal(r.emailStatus,'pending');assert(r.email.endsWith('@example.invalid'));
  const retry=await verify(p.challengeId);assert.equal(retry.claimedEmail,false);assert.equal(retry.resetExpiresAt,r.resetExpiresAt);assert.equal((await rpc('email_delivery',[p.challengeId,RECEIPT,'sent'])).emailStatus,'sent');assert.equal((await verify(p.challengeId)).emailStatus,'sent');assert.equal((await rpc('email_delivery',[p.challengeId,RECEIPT,'failed'])).code,'REQUEST_REUSED');
  assert.equal((await job(p)).result.code,'UNAVAILABLE');assert.equal(await v('select count(*)::int from snote_private.recovery_phone_bindings'),0,'Fresh recovery SMS never self-enrolls a legacy phone');
 });
 await test('opaque decoys, name mismatch, wrong IP, ambiguous and operator accounts never reveal an ID',async()=>{
  for(const opt of[{name:'Other name'},{phone:'01000000001'}]){await cool();const p=await prepare(opt);assert.equal(p.canSend,false);assert.equal(p.phone,null);assert.equal((await verify(p.challengeId)).ok,false);}
  await cool();const p=await prepare();await delivered(p.challengeId);assert.equal((await verify(p.challengeId,'password',OTP,RECEIPT,hash('foreign-ip'))).code,'INVALID_CODE');
  await q('update public.zc_members set phone=$2 where user_id=$1',[OUTSIDER,PHONE]);await cool();assert.equal((await prepare()).canSend,false);await q("update public.zc_members set phone='' where user_id=$1",[OUTSIDER]);
  await q('insert into snote_operator_private.operators(user_id,active) values($1,false)',[OWNER]);await cool();assert.equal((await prepare()).canSend,false);await q('delete from snote_operator_private.operators where user_id=$1',[OWNER]);
 });
 await test('empty private canonical phone never falls back to stale member phone',async()=>{
  await q('update public.zc_members set phone=$2 where user_id=$1',[OUTSIDER,'010-8765-4321']);assert.equal(await v('select snote_private.recovery_canonical_phone($1)',[OUTSIDER]),'','Malformed legacy member fallback matches existing profile snapshot');await q("update public.zc_members set phone='' where user_id=$1",[OUTSIDER]);
  await q("update snote_private.member_profiles set phone='' where user_id=$1",[OWNER]);await cool();assert.equal((await prepare()).canSend,false);await q('update snote_private.member_profiles set phone=$2 where user_id=$1',[OWNER,PHONE]);
 });
 await test('challenge idempotence never changes original OTP and persistent phone/IP budgets apply to decoys too',async()=>{
  await cool();const req=randomUUID();const p=await prepare({request:req});const retry=await prepare({request:req});assert.equal(retry.challengeId,p.challengeId);assert.equal(retry.claimed,false);assert.equal(retry.canSend,false);assert.equal((await prepare({request:req,name:'Other'})).code,'REQUEST_REUSED');assert.equal((await prepare()).code,'RATE_LIMITED');
  await cool();await q("insert into snote_private.recovery_rate_events(request_id,phone_hash,ip_hash) select gen_random_uuid(),$1,$2 from generate_series(1,30)",[hash('other-phone'),IP]);assert.equal((await prepare({phone:'01000000002'})).code,'RATE_LIMITED');await cool();
 });
 await test('failed OTP attempts commit, stop at five, and expiry/purpose/delivery cannot be bypassed',async()=>{
  await cool();let p=await prepare();assert.equal((await verify(p.challengeId)).code,'INVALID_CODE');await delivered(p.challengeId);for(let n=1;n<=4;n++)assert.equal((await verify(p.challengeId,'password',hash('wrong'))).code,n===4?'LOCKED':'INVALID_CODE');assert.equal((await verify(p.challengeId)).code,'LOCKED');
  await cool();p=await prepare();await delivered(p.challengeId);assert.equal((await verify(p.challengeId,'id')).code,'INVALID_CODE');await q("update snote_private.recovery_challenges set expires_at=clock_timestamp()-interval'1 second' where challenge_id=$1",[p.challengeId]);assert.equal((await verify(p.challengeId)).code,'EXPIRED');
  await cool();p=await prepare();await rpc('delivery',[p.challengeId,'unknown']);assert.equal((await rpc('delivery',[p.challengeId,'sent'])).code,'UNAVAILABLE');assert.equal((await verify(p.challengeId)).code,'INVALID_CODE');
 });
 await test('a real authenticated phone challenge consumption persists proof and survives challenge replacement',async()=>{
  const cid=randomUUID();await q("insert into snote_private.profile_phone_challenges(user_id,company_id,challenge_id,phone,expected_profile,otp_hash,expires_at,delivery_status) values($1,$2,$3,$4,'{}',$5,now()+interval'5 minutes','sent')",[OWNER,COMPANY,cid,PHONE,OTP]);
  await q('update snote_private.profile_phone_challenges set consumed_at=clock_timestamp(),verified_hash=otp_hash,otp_hash=null where user_id=$1',[OWNER]);assert.equal(await v('select source from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]),'profile_otp');
  await q('update snote_private.profile_phone_challenges set challenge_id=$2,consumed_at=null,verified_hash=null,otp_hash=$3 where user_id=$1',[OWNER,randomUUID(),OTP]);const p=await proof();assert.equal((await verify(p.challengeId)).route,'phone');
 });
 await test('proven ID retrieval reveals email only after SMS proof and snapshot changes invalidate proofs',async()=>{
  await cool();const p=await prepare({purpose:'id'});assert.equal(p.email,undefined);await delivered(p.challengeId);assert.equal((await verify(p.challengeId,'id')).route,'phone');
  await cool();const other=await prepare();await delivered(other.challengeId);await q("update auth.users set email='changed@example.invalid' where id=$1",[OWNER]);assert.equal((await verify(other.challengeId)).code,'UNAVAILABLE');await q('update auth.users set email=$2 where id=$1',[OWNER,OWNER+'@example.invalid']);
 });
 await test('one-use reset job has a single winner, immutable payload and no applying/unknown retry execution',async()=>{
  const p=await proof(),j=await job(p);assert.equal(j.result.claimed,true);assert.equal(j.result.userId,OWNER);assert.equal((await rpc('reset_prepare',[j.id,j.challenge,j.receipt,j.fp,j.executor])).claimed,false);assert.equal((await rpc('reset_prepare',[j.id,j.challenge,j.receipt,hash('other-password'),j.executor])).code,'REQUEST_REUSED');assert.equal((await job(p)).result.code,'PROOF_CONSUMED');
  assert.equal((await finish(j,'unknown')).state,'unknown');await deny(()=>q('update snote_private.member_profiles set phone=$2 where user_id=$1',[OWNER,'01000009999']),['40001']);await deny(()=>q('insert into snote_operator_private.operators(user_id,active) values($1,true)',[OWNER]),['40001']);await q("update snote_private.recovery_reset_jobs set apply_until=clock_timestamp()-interval'1 second' where job_id=$1",[j.id]);await q('insert into snote_operator_private.operators(user_id,active) values($1,true)',[OWNER]);await q('delete from snote_operator_private.operators where user_id=$1',[OWNER]);assert.equal((await rpc('reset_prepare',[j.id,j.challenge,j.receipt,j.fp,j.executor])).claimed,false);assert.equal((await finish(j,'applied')).code,'REQUEST_REUSED');assert.equal((await verify(p.challengeId)).code,'PROOF_CONSUMED');
 });
 await test('applying job guards phone/email/eligibility/operator grants while permitting its password-only Auth update',async()=>{
  const p=await proof(),j=await job(p);assert.equal(j.result.claimed,true);
  await deny(()=>q('update snote_private.member_profiles set phone=$2 where user_id=$1',[OWNER,'01000009999']),['40001']);await deny(()=>q("update auth.users set email='stolen@example.invalid' where id=$1",[OWNER]),['40001']);await deny(()=>q('update auth.users set phone_confirmed_at=clock_timestamp() where id=$1',[OWNER]),['40001']);await deny(()=>q('update public.zc_members set active=false where user_id=$1',[OWNER]),['40001']);await deny(()=>q('insert into snote_operator_private.operators(user_id,active) values($1,true)',[OWNER]),['40001']);await deny(()=>q('insert into snote_operator_private.account_state(user_id,archived) values($1,true)',[OWNER]),['40001']);
  const ownSession=randomUUID(),otherSession=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)',[ownSession,OWNER,otherSession,OUTSIDER]);
  assert.equal((await finish(j,'applied')).code,'UNAVAILABLE','Cannot finalize success before any actual Auth password mutation');
  await q("update auth.users set encrypted_password='synthetic-new-password',updated_at=clock_timestamp() where id=$1",[OWNER]);assert.equal((await finish(j,'applied')).state,'applied');assert.equal((await finish(j,'applied')).state,'applied');assert.equal(await v('select count(*)::int from auth.sessions where id=$1',[ownSession]),0);assert.equal(await v('select count(*)::int from auth.sessions where id=$1',[otherSession]),1);
 });
 await test('current phone changes invalidate durable proof and returning to old number cannot revive it',async()=>{
  await q('update snote_private.member_profiles set phone=$2 where user_id=$1',[OWNER,'01000009999']);assert(await v('select invalidated_at from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]));await q('update snote_private.member_profiles set phone=$2 where user_id=$1',[OWNER,PHONE]);await cool();const p=await prepare();await delivered(p.challengeId);assert.equal((await verify(p.challengeId)).route,'email');await bind();
  await q('update public.zc_members set active=false where user_id=$1',[OWNER]);await q('update public.zc_members set active=true where user_id=$1',[OWNER]);assert(await v('select invalidated_at from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]));
 });
 await test('future actual Auth phone confirmation enrolls only exact canonical phone and revocation invalidates it',async()=>{
  await q('update auth.users set phone=$2,phone_confirmed_at=clock_timestamp() where id=$1',[OWNER,PHONE]);assert.equal(await v('select source from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]),'auth_phone');assert.equal(await v('select invalidated_at from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]),null);
  await q('update auth.users set phone_confirmed_at=null where id=$1',[OWNER]);assert(await v('select invalidated_at from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]));
 });
 await test('existing authenticated profile/SMS proof regression works unchanged with recovery triggers installed',async()=>{
  // The original standalone fixture rejects every application trigger. Permit
  // only the known operator/recovery guards under test, retaining all assertions.
  const actual=fs.readFileSync(path.join(ROOT,'tests/profile-contact.rollback.sql'),'utf8');
  const adapted=actual.replace("and not tgisinternal) then raise exception 'Unexpected fixture trigger'","and not tgisinternal and tgname not in('snote_operator_archived_member_guard','snote_recovery_member_guard','snote_recovery_member_binding','snote_recovery_auth_guard','snote_recovery_auth_binding')) then raise exception 'Unexpected fixture trigger'");assert.notEqual(adapted,actual);
  try{const results=await db.exec(adapted);assert(results.some(r=>r.rows?.some(row=>String(row.result||'').startsWith('PASS'))));}catch(error){await db.exec('rollback');throw error;}
 });
 await test('repeat migration preserves invalidated proofs and does not expose passwords/OTP/plaintext secrets',async()=>{
  await db.exec(SQL);assert(await v('select invalidated_at from snote_private.recovery_phone_bindings where user_id=$1',[OWNER]));for(const name of['snote_phone_recovery_verify','snote_phone_recovery_reset_prepare'])assert(SQL.includes('security invoker'));
  const cols=(await q("select column_name from information_schema.columns where table_schema='snote_private' and table_name in('recovery_challenges','recovery_reset_jobs')")).rows.map(x=>x.column_name);for(const forbidden of['password','otp','receipt','ip_address','encrypted_password'])assert(!cols.includes(forbidden));
 });
 console.log(JSON.stringify({passed,failed,migration:FILE,sha256:hash(SQL)}));
 }finally{await db.close();}}
module.exports={createRecoveryFixture,SQL,FILE,PHONE,NAME,OWNER,COMPANY,OP};
if(require.main===module)main().catch(e=>{console.error(e.code,e.message,e.where||'',e.stack);process.exitCode=1;});
