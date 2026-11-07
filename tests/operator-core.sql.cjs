'use strict';
// Isolated PostgreSQL security/atomicity tests. No production/network access.
// Reuses the tenant baseline (including real recycle guards) with synthetic users.
// NODE_PATH=/workspace/work/deps/node_modules node tests/operator-core.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createFixture,COMPANY,FOREIGN,OWNER,UPLOADER,ADMIN,OUTSIDER,ACCOUNTANT,INACTIVE}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..');
const FILE='20261107013019_platform_operator_console.sql';
const SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const OP='99999999-9999-4999-8999-999999999999',OP_SESSION='99999999-9999-4999-8999-999999999998';
const ID='operator-car-a',alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);
const CUSTOM='custom-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db,passed=0,failed=0;
async function createOperatorFixture(){
 const d=await createFixture();
 await d.exec(`alter table auth.users add column deleted_at timestamptz,add column is_anonymous boolean not null default false,add column raw_user_meta_data jsonb default '{}',add column created_at timestamptz default now(),add column last_sign_in_at timestamptz,add column updated_at timestamptz default now();
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),not_after timestamptz,refreshed_at timestamp,user_agent text,ip inet);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 alter table public.zc_companies add column business_number text not null default '',add column representative_name text not null default '',add column business_postcode text not null default '',add column business_address text not null default '',add column business_address_detail text not null default '',add column business_phone text not null default '';
 create table snote_private.member_profiles(user_id uuid primary key references auth.users(id),phone text not null,address text not null default '',revision bigint not null default 1,updated_at timestamptz default now());
 -- PGlite has no pgcrypto. These visibly synthetic PGP stand-ins validate SQL
 -- source/destination key choice and retention, not cryptographic security.
 create function extensions.pgp_sym_encrypt(p_text text,p_key text,p_options text) returns bytea language sql as $$select convert_to(p_key||':'||p_text,'UTF8')$$;
 create function extensions.pgp_sym_decrypt(p_cipher bytea,p_key text) returns text language plpgsql as $$begin if left(convert_from(p_cipher,'UTF8'),length(p_key)+1)<>p_key||':' then raise exception 'WRONG_TEST_PGP_KEY';end if;return substr(convert_from(p_cipher,'UTF8'),length(p_key)+2);end$$;
 `);
 await d.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261106113557_scoped_recycle_bin.sql'),'utf8'));
 await d.exec(SQL);return d;
}
const q=(sql,args=[])=>db.query(sql,args);
const value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function as(role,user,session,fn){
 await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
 await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:user||undefined,session_id:session||undefined,is_anonymous:false})]);
 await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}
}
async function rpc(name,args={},role='authenticated',actor=OP,session=OP_SESSION){
 return as(role,role==='service_role'?null:actor,role==='service_role'?null:session,()=>{
  const entries=Object.entries(role==='service_role'?{p_actor:actor,p_session:session,...args}:args);
  return value('select public.snote_operator_'+name+'('+entries.map(([key],i)=>key+' => $'+(i+1)).join(',')+')',entries.map(([,v])=>v!==null&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v));
 });
}
const server=(name,args={})=>rpc(name,args,'service_role');
const av=user=>value('select snote_operator_private.account_version($1)',[user]);
const cv=company=>value('select snote_operator_private.company_version($1)',[company]);
async function denied(fn,codes=['42501']){await assert.rejects(fn,e=>codes.includes(e.code));}
async function test(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;process.exitCode=1;console.error('FAIL',name,{code:e.code,message:e.message,where:e.where});}}
async function session(user,id=randomUUID()) {await q("insert into auth.sessions(id,user_id,ip,user_agent) values($1,$2,'192.0.2.9','Synthetic browser') on conflict(id) do update set not_after=null",[id,user]);return id;}
const car=()=>value("select payload->0 from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER]);
async function readSource(){return server('vehicle_read',{p_company:COMPANY,p_owner:OWNER,p_car_id:ID});}
async function prepare(mode='copy',requestId=randomUUID()) {
 const row=await readSource();return server('transfer_prepare',{p_request_id:requestId,p_source:{companyId:COMPANY,ownerId:OWNER,carId:ID,revision:row.revision,coversRevision:row.coversRevision},p_target:{companyId:FOREIGN,ownerId:OUTSIDER},p_mode:mode});
}
const rewrap=value=>{if(typeof value==='string'&&/^(smi1|isi1)\./.test(value))return value+'.rewrapped';if(Array.isArray(value))return value.map(rewrap);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrap(v)]));return value;};
async function copyFiles(job){for(const m of job.media)await q("insert into storage.objects(bucket_id,name,metadata) values('zc-vehicle-private',$1,$2::jsonb) on conflict(bucket_id,name) do nothing",[m.target.file_path,JSON.stringify({mimetype:m.target.mime_type,size:Number(m.target.file_size)})]);}
async function commit(job){return server('transfer_commit',{p_request_id:job.jobId,p_vehicle:rewrap(job.vehicle),p_customer:job.customer?rewrap(job.customer.payload):null});}
async function main(){
 db=await createOperatorFixture();
 try{
  await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[OP,'operator@example.invalid']);
  await session(OP,OP_SESSION);const normalSessions=new Map();for(const u of[OWNER,ADMIN,OUTSIDER,ACCOUNTANT,INACTIVE])normalSessions.set(u,await session(u));
  await test('empty operator allowlist grants nobody; tenant admins/dealers/anonymous cannot cross scope',async()=>{
   assert.equal(await value('select count(*)::int from snote_operator_private.operators'),0);
   for(const actor of[OP,OWNER,ADMIN,OUTSIDER,ACCOUNTANT]){assert.deepEqual(await rpc('context',{},'authenticated',actor,normalSessions.get(actor)||OP_SESSION),{allowed:false});await denied(async()=>rpc('vehicles_list',{p_query:{}},'authenticated',actor,normalSessions.get(actor)||OP_SESSION));}
   await denied(async()=>rpc('context',{},'anon',null,null));await denied(async()=>as('service_role',null,null,()=>value('select public.snote_operator_context()')));
   await q("insert into snote_operator_private.operators(user_id,active,reason) values($1,true,'synthetic explicit owner authorization')",[OP]);
  });
  await test('allowlist plus a confirmed, live exact Auth session is mandatory for every operation',async()=>{
   const c=await rpc('context');assert.equal(c.allowed,true);assert.equal(c.actorId,OP);assert.equal(c.sessionId,OP_SESSION);
   for(const sid of[null,'not-a-uuid',normalSessions.get(OWNER)])assert.deepEqual(await rpc('context',{},'authenticated',OP,sid),{allowed:false});
   await q("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[OP_SESSION]);assert.deepEqual(await rpc('context'),{allowed:false});await session(OP,OP_SESSION);
   await q("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[OP]);assert.deepEqual(await rpc('context'),{allowed:false});await q('update auth.users set banned_until=null where id=$1',[OP]);
   await q('delete from auth.sessions where id=$1',[OP_SESSION]);await denied(async()=>rpc('companies_list',{p_query:{}}));await session(OP,OP_SESSION);
  });
  await test('private ACL/RLS, immutable audit, invoker wrappers and service-only plans are exact',async()=>{
   for(const table of['operators','account_state','company_state','membership_archive_intent','requests','audit_log','transfer_jobs','transfer_files','auth_jobs']){
    assert.equal(await value('select relrowsecurity from pg_class where oid=$1::regclass',['snote_operator_private.'+table]),true);
    for(const role of['anon','authenticated','service_role'])for(const privilege of['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await value('select has_table_privilege($1,$2,$3)',[role,'snote_operator_private.'+table,privilege]),false);
   }
   for(const name of['context','vehicles_list','accounts_list','companies_list','vehicle_save','vehicle_archive','vehicle_restore','account_save','account_state','company_save','company_state','vehicle_read','transfer_prepare','transfer_commit','transfer_get','transfer_abort','auth_prepare','auth_finalize']){
    const f=(await q("select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",['snote_operator_'+name])).rows[0];assert.equal(f.prosecdef,false);assert(f.proconfig.includes('search_path=""'));
   }
   await denied(async()=>as('authenticated',OP,OP_SESSION,()=>q('select * from snote_operator_private.operators')));
   await denied(async()=>rpc('transfer_get',{p_actor:OP,p_session:OP_SESSION,p_request_id:randomUUID()}));
   await q("insert into snote_operator_private.audit_log(actor_id,session_id,action,subject) values($1,$2,'test','test')",[OP,OP_SESSION]);
   await denied(async()=>db.exec("update snote_operator_private.audit_log set subject='tampered'"),['55000']);await denied(async()=>db.exec('truncate snote_operator_private.audit_log'),['55000']);
  });
  const original={id:ID,ownerId:alias(OWNER),model:'Synthetic source',make:'현대',plate:'000가0001',buy:1000,sell:1400,status:'판매중',costs:{repair:10},customCosts:{[CUSTOM]:123456},customCostLabels:{[CUSTOM]:'검증 비용'},customerSnapshot:{identityCipher:'smi1.fake.source'},incomeSettlement:{privateCipher:'isi1.fake.source'}};
  await q("insert into public.zc_datasets(company_id,dataset,owner_id,payload,revision) values($1,'cars',$2,$3::jsonb,1),($1,'covers',$2,'{}',1),($4,'cars',$5,'[]',1),($4,'covers',$5,'{}',1)",[COMPANY,OWNER,JSON.stringify([original]),FOREIGN,OUTSIDER]);
  await q("insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn) values($1,$2,$3,$4::jsonb,true)",[COMPANY,UPLOADER,ID,JSON.stringify({id:alias(UPLOADER)+':'+ID,ownerId:alias(UPLOADER),carId:ID,name:'Synthetic customer',identityCipher:'smi1.fake.customer',intakeSource:'synthetic-old-request'})]);
  const file={company_id:COMPANY,owner_id:UPLOADER,id:'source-photo',car_id:ID,file_path:`${COMPANY}/${UPLOADER}/${ID}/source-photo.png`,original_name:'source.png',mime_type:'image/png',file_size:3,group_name:'photos',meta:{}};
  await q("select set_config('snote.recycle_internal','1',false)");await q('insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name,meta) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',[file.company_id,file.owner_id,file.id,file.car_id,file.file_path,file.original_name,file.mime_type,file.file_size,file.group_name,JSON.stringify(file.meta)]);await q("update public.zc_datasets set payload=jsonb_build_object($3::text,'source-photo'::text) where company_id=$1 and owner_id=$2 and dataset='covers'",[COMPANY,OWNER,ID]);await q("select set_config('snote.recycle_internal','',false)");
  await q("insert into storage.objects(bucket_id,name,metadata) values('zc-vehicle-private',$1,'{\"size\":3,\"mimetype\":\"image/png\"}')",[file.file_path]);
  await test('cross-company list is operator-only, fixed 20, safely searchable/sortable and excludes customer secrets',async()=>{
   const rows=await rpc('vehicles_list',{p_query:{sort:'buy',direction:'asc'}});assert.equal(rows.total,1);assert.equal(rows.pageSize,20);assert.equal(rows.items[0].vehicle.customerSnapshot,undefined);assert.equal(rows.items[0].vehicle.incomeSettlement,undefined);assert.equal(rows.items[0].vehicle.customCosts[CUSTOM],123456);assert.equal((await rpc('vehicles_list',{p_query:{query:"' OR TRUE --"}})).total,0);
   await denied(async()=>rpc('vehicles_list',{p_query:{sort:'model;drop table'}}),['22023']);
   for(let i=0;i<21;i++)await q('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)',[randomUUID(),'paging-'+i+'@example.invalid',JSON.stringify({display_name:'Paging '+String(i).padStart(2,'0')})]);
   const one=await rpc('accounts_list',{p_query:{query:'paging-',sort:'displayName',direction:'asc'}}),two=await rpc('accounts_list',{p_query:{query:'paging-',sort:'displayName',direction:'asc',page:2}});assert.equal(one.total,21);assert.equal(one.items.length,20);assert.equal(two.items.length,1);assert.equal(one.items[0].displayName,'Paging 00');assert.equal(two.items[0].displayName,'Paging 20');
  });
  await test('vehicle edit uses whole-dataset CAS, preserves unknown/private fields and validates won custom costs',async()=>{
   const row=await readSource(),candidate={...row.vehicle,moneyUnit:'KRW',buy:10000000,sell:14000000,costs:{repair:100000},extra:'operator corrected'};const request=randomUUID();
   const args={p_company:COMPANY,p_owner:OWNER,p_car_id:ID,p_expected:row.revision,p_vehicle:candidate,p_request_id:request};const result=await rpc('vehicle_save',args);assert.equal(result.revision,row.revision+1);assert.deepEqual(await rpc('vehicle_save',args),result);assert.equal((await car()).customerSnapshot.identityCipher,'smi1.fake.source');
   await denied(async()=>rpc('vehicle_save',{...args,p_request_id:randomUUID()}),['40001']);
   await denied(async()=>rpc('vehicle_save',{...args,p_request_id:randomUUID(),p_expected:result.revision,p_vehicle:{...candidate,customCosts:{[CUSTOM]:1.25}}}),['22023']);
   await denied(async()=>rpc('vehicle_save',{...args,p_request_id:randomUUID(),p_expected:result.revision,p_vehicle:{...candidate,customerSnapshot:{identityCipher:'smi1.replaced'}}}),['22023']);
  });
  await test('account edit uses metadata CAS and soft deletion instantly blocks tenant memberships/sessions',async()=>{
   const version=await av(OWNER);const saved=await rpc('account_save',{p_user:OWNER,p_expected:version,p_patch:{displayName:'Corrected dealer',phone:'010-1234-5678',address:'Synthetic road',companyId:COMPANY,role:'dealer'},p_request_id:randomUUID()});assert.equal(saved.account.phone,'01012345678');assert.notEqual(saved.account.version,version);
   await denied(async()=>rpc('account_save',{p_user:OWNER,p_expected:version,p_patch:{displayName:'Stale'},p_request_id:randomUUID()}),['40001']);
   const archived=await rpc('account_state',{p_user:OWNER,p_expected:await av(OWNER),p_active:false,p_request_id:randomUUID()});assert.equal(archived.account.archived,true);assert.equal(await value('select active from public.zc_members where user_id=$1',[OWNER]),false);assert.equal(await value('select count(*)::int from auth.sessions where user_id=$1',[OWNER]),0);
   await denied(async()=>q('update public.zc_members set active=true where user_id=$1',[OWNER]));
   const restored=await rpc('account_state',{p_user:OWNER,p_expected:await av(OWNER),p_active:true,p_request_id:randomUUID()});assert.equal(restored.account.archived,false);assert.equal(await value('select active from public.zc_members where user_id=$1',[OWNER]),true);
   await denied(async()=>rpc('account_state',{p_user:OP,p_expected:await av(OP),p_active:false,p_request_id:randomUUID()}));
  });
  await test('nested account/company archives restore original intent in either order without reviving inactive users',async()=>{
   for(const accountFirst of[true,false]){
    const stateA=active=>rpc('account_state',{p_user:OWNER,p_expected:null,p_active:active,p_request_id:randomUUID()});
    const account=async active=>rpc('account_state',{p_user:OWNER,p_expected:await av(OWNER),p_active:active,p_request_id:randomUUID()});
    const company=async active=>rpc('company_state',{p_company:COMPANY,p_expected:await cv(COMPANY),p_active:active,p_request_id:randomUUID()});
    if(accountFirst){await account(false);await company(false);await account(true);await company(true);}else{await company(false);await account(false);await company(true);await account(true);}
    assert.equal(await value('select active from public.zc_members where user_id=$1',[OWNER]),true);assert.equal(await value('select active from public.zc_members where user_id=$1',[INACTIVE]),false);assert.equal(await value('select count(*)::int from snote_operator_private.membership_archive_intent'),0);
   }
  });
  await test('transfer prepare is immutable/idempotent, hides staged files and rejects missing bytes/cipher reuse',async()=>{
   const job=await prepare();assert.equal(job.media[0].source.owner_id,UPLOADER);assert.equal(job.media[0].target.owner_id,OUTSIDER);assert.equal(job.media[0].copied,false);assert.equal(job.customer.owner_id,UPLOADER);assert.deepEqual(await server('transfer_get',{p_request_id:job.jobId}),job);assert.deepEqual(await prepare('copy',job.jobId),job);
   await denied(async()=>commit(job),['40001']);await copyFiles(job);
   assert.equal(await as('authenticated',OUTSIDER,normalSessions.get(OUTSIDER),()=>value('select count(*)::int from storage.objects where name=$1',[job.media[0].target.file_path])),0);
   assert.equal(await as('authenticated',UPLOADER,await session(UPLOADER),()=>value('select count(*)::int from storage.objects where name=$1',[file.file_path])),1);
   await denied(async()=>server('transfer_commit',{p_request_id:job.jobId,p_vehicle:job.vehicle,p_customer:job.customer.payload}),['22023']);
   const aborted=await server('transfer_abort',{p_request_id:job.jobId});assert.deepEqual(aborted.cleanupPaths,[job.media[0].target.file_path]);assert.equal(aborted.status,'aborted');
   assert.equal(await as('authenticated',OUTSIDER,normalSessions.get(OUTSIDER),()=>value('select count(*)::int from storage.objects where name=$1',[job.media[0].target.file_path])),0);
  });
  await test('complete copy rewraps all cipher contexts and remaps multi-owner media/cover/customer identities',async()=>{
   const job=await prepare();await copyFiles(job);assert.equal((await server('transfer_get',{p_request_id:job.jobId})).media[0].copied,true);const result=await commit(job);assert.equal(result.status,'committed');assert.deepEqual(await commit(job),result);
   const copied=await value("select c from public.zc_datasets d cross join lateral jsonb_array_elements(d.payload)c where d.company_id=$1 and d.owner_id=$2 and d.dataset='cars' and c->>'id'=$3",[FOREIGN,OUTSIDER,job.target.carId]);assert.equal(copied.ownerId,alias(OUTSIDER));assert.equal(copied.customCosts[CUSTOM],123456);assert.equal(copied.customerSnapshot.identityCipher,'smi1.fake.source.rewrapped');
   const customer=(await q('select * from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[FOREIGN,OUTSIDER,job.target.carId])).rows[0];assert.equal(customer.payload.id,alias(OUTSIDER)+':'+job.target.carId);assert.equal(customer.payload.ownerId,alias(OUTSIDER));assert.equal(customer.payload.identityCipher,'smi1.fake.customer.rewrapped');assert.notEqual(customer.restore_generation,'00000000-0000-0000-0000-000000000000');
   assert.equal(await value("select payload->$3 from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='covers'",[FOREIGN,OUTSIDER,job.target.carId]),job.media[0].target.id);assert.equal((await car()).id,ID);
   assert.equal(await as('authenticated',OUTSIDER,normalSessions.get(OUTSIDER),()=>value('select count(*)::int from storage.objects where name=$1',[job.media[0].target.file_path])),1);
   assert.deepEqual((await server('transfer_abort',{p_request_id:job.jobId})).cleanupPaths,[]);
  });
  await test('transfer CAS failure preserves source and hides cleanup objects; source bytes are frozen while prepared',async()=>{
   const job=await prepare();await copyFiles(job);
   await as('authenticated',UPLOADER,await session(UPLOADER),()=>q("update storage.objects set metadata='{}' where name=$1",[file.file_path]));
   assert.equal(await value("select metadata->>'size' from storage.objects where name=$1",[file.file_path]),'3');
   await q("update public.zc_customers set payload=payload||'{\"name\":\"newer edit\"}' where company_id=$1 and car_id=$2",[COMPANY,ID]);
   await denied(async()=>commit(job),['40001']);assert.equal((await car()).id,ID);assert.equal((await server('transfer_get',{p_request_id:job.jobId})).status,'prepared');await server('transfer_abort',{p_request_id:job.jobId});
  });
  await test('legacy resident ciphertext is rekeyed only inside SQL with original expiry and absent target keys block safely',async()=>{
   await q('insert into zc_private.rrn_keys(company_id,secret) values($1,$2),($3,$4)',[COMPANY,'synthetic-source-key',FOREIGN,'synthetic-target-key']);
   await q("insert into zc_private.rrn_secrets(company_id,owner_id,car_id,cipher,expires_at,created_at) values($1,$2,$3,extensions.pgp_sym_encrypt('0001013000000','synthetic-source-key','test'),now()+interval '10 days',now()-interval '20 days')",[COMPANY,UPLOADER,ID]);
   const before=(await q('select expires_at,created_at from zc_private.rrn_secrets where company_id=$1 and car_id=$2',[COMPANY,ID])).rows[0];
   const job=await prepare();assert.equal(job.legacyRrnCount,1);assert.equal(job.rrn,undefined);await copyFiles(job);await commit(job);
   const row=(await q("select extensions.pgp_sym_decrypt(cipher,'synthetic-target-key') plain,expires_at,created_at from zc_private.rrn_secrets where company_id=$1 and owner_id=$2 and car_id=$3",[FOREIGN,OUTSIDER,job.target.carId])).rows[0];assert.equal(row.plain,'0001013000000');assert.deepEqual(row.expires_at,before.expires_at);assert.deepEqual(row.created_at,before.created_at);
   await q('delete from zc_private.rrn_keys where company_id=$1',[FOREIGN]);const blocked=await prepare();assert(blocked.blockers.includes('LEGACY_RRN_KEY_UNAVAILABLE'));await denied(async()=>commit(blocked),['22023']);await server('transfer_abort',{p_request_id:blocked.jobId});await q('insert into zc_private.rrn_keys values($1,$2)',[FOREIGN,'synthetic-target-key']);
  });
  await test('move atomically archives original and preserves original bytes/intake revocation with recoverable restore',async()=>{
   const job=await prepare('move');await copyFiles(job);const result=await commit(job);assert.equal(result.status,'committed');assert.ok(result.recycleId);assert.equal(await value("select count(*)::int from public.zc_datasets d cross join lateral jsonb_array_elements(d.payload)c where d.company_id=$1 and d.dataset='cars' and c->>'id'=$2",[COMPANY,ID]),0);assert.equal(await value('select count(*)::int from storage.objects where name=$1',[file.file_path]),1);
   const restored=await rpc('vehicle_restore',{p_company:COMPANY,p_entry:result.recycleId,p_request_id:randomUUID()});assert.equal(restored.ok,true);assert.equal((await car()).id,ID);assert.equal(await value('select count(*)::int from public.zc_customers where company_id=$1 and car_id=$2',[COMPANY,ID]),1);
  });
  await test('auth identity updates expose no password, require prepare/version and confirm real Auth email before immutable finalization',async()=>{
   const requestId=randomUUID(),email='changed@example.invalid';const prepared=await server('auth_prepare',{p_user:OWNER,p_expected:await av(OWNER),p_request_id:requestId,p_fingerprint:'opaque-server-hmac-'.repeat(4),p_fields:['email'],p_email:email});assert.equal(prepared.status,'prepared');
   await denied(async()=>server('auth_finalize',{p_request_id:requestId,p_success:true,p_auth_result:{id:OWNER,email}}),['40001']);await q('update auth.users set email=$2 where id=$1',[OWNER,email]);
   const done=await server('auth_finalize',{p_request_id:requestId,p_success:true,p_auth_result:{id:OWNER,email}});assert.equal(done.status,'committed');assert.deepEqual(await server('auth_finalize',{p_request_id:requestId,p_success:true,p_auth_result:{id:OWNER,email}}),done);assert.equal(done.account.email,email);
   const audit=await value("select jsonb_agg(to_jsonb(a))::text from snote_operator_private.audit_log a where action like 'auth_update%'");assert(!audit.includes('opaque-server-hmac'));assert(!audit.includes('passwordHash'));
  });
  await test('expired Auth plans cannot replay over a newer success and fresh plans detect intervening Auth changes',async()=>{
   const oldId=randomUUID(),oldVersion=await av(OWNER),oldArgs={p_user:OWNER,p_expected:oldVersion,p_request_id:oldId,p_fingerprint:'stale-plan-server-hmac-'.repeat(3),p_fields:['email'],p_email:'stale-a@example.invalid'};
   await server('auth_prepare',oldArgs);await q("update snote_operator_private.auth_jobs set created_at=now()-interval '16 minutes' where actor_id=$1 and request_id=$2",[OP,oldId]);
   const freshId=randomUUID(),freshEmail='newer-b@example.invalid';await server('auth_prepare',{p_user:OWNER,p_expected:await av(OWNER),p_request_id:freshId,p_fingerprint:'fresh-plan-server-hmac-'.repeat(3),p_fields:['email'],p_email:freshEmail});
   await q('update auth.users set email=$2,updated_at=clock_timestamp() where id=$1',[OWNER,freshEmail]);await server('auth_finalize',{p_request_id:freshId,p_success:true,p_auth_result:{id:OWNER,email:freshEmail}});
   await denied(async()=>server('auth_prepare',oldArgs),['40001']);await denied(async()=>server('auth_finalize',{p_request_id:oldId,p_success:true,p_auth_result:{id:OWNER,email:oldArgs.p_email}}),['40001']);assert.equal(await value('select email from auth.users where id=$1',[OWNER]),freshEmail);
   const changedId=randomUUID(),changedArgs={p_user:OWNER,p_expected:await av(OWNER),p_request_id:changedId,p_fingerprint:'concurrent-auth-change-'.repeat(3),p_fields:['password'],p_email:null};await server('auth_prepare',changedArgs);await q("update auth.users set updated_at=clock_timestamp()+interval '1 second' where id=$1",[OWNER]);await denied(async()=>server('auth_prepare',changedArgs),['40001']);await server('auth_finalize',{p_request_id:changedId,p_success:false,p_auth_result:{id:OWNER}});
  });
  await test('ambiguous cover and unsupported old identity formats stop transfer before any data mutation',async()=>{
   const source=await car();await q("update public.zc_datasets set payload=jsonb_set(payload,'{0,rrnCipher}','{\"iv\":\"legacy\",\"data\":\"encrypted\"}') where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER]);
   const blocked=await prepare();assert(blocked.blockers.includes('UNSUPPORTED_IDENTITY_CIPHER'));await server('transfer_abort',{p_request_id:blocked.jobId});await q("update public.zc_datasets set payload=jsonb_set(payload,'{0}',$3::jsonb) where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER,JSON.stringify(source)]);
   await q("select set_config('snote.recycle_internal','1',false)");const otherPath=`${COMPANY}/${OWNER}/${ID}/duplicate-photo.png`;await q("insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name,meta) values($1,$2,'source-photo',$3,$4,'duplicate.png','image/png',3,'photos','{}')",[COMPANY,OWNER,ID,otherPath]);await q("select set_config('snote.recycle_internal','',false)");await q("insert into storage.objects(bucket_id,name,metadata) values('zc-vehicle-private',$1,'{\"size\":3,\"mimetype\":\"image/png\"}')",[otherPath]);
   const cover=await prepare();assert(cover.blockers.includes('AMBIGUOUS_COVER'));await denied(async()=>commit(cover),['22023']);await server('transfer_abort',{p_request_id:cover.jobId});assert.equal((await car()).id,ID);
  });
  await test('repeat migration preserves allowlist/data/audit and keeps ordinary tenant scope guards intact',async()=>{
   const before=await value('select count(*)::int from snote_operator_private.audit_log');await db.exec(SQL);assert.equal(await value('select count(*)::int from snote_operator_private.audit_log'),before);assert.equal((await rpc('context')).allowed,true);
   await denied(async()=>as('authenticated',ADMIN,await session(ADMIN),()=>q('select public.snote_recycle_list($1)',[FOREIGN])));
  });
 }finally{await db.close();}
 console.log(`${passed} operator core SQL groups passed; ${failed} failed`);
}
module.exports={createOperatorFixture,OP,OP_SESSION,SQL};
if(require.main===module)main().catch(e=>{console.error({code:e.code,message:e.message,where:e.where});process.exitCode=1;});
