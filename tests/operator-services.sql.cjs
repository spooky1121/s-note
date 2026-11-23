'use strict';
// Actual migration against isolated PostgreSQL; synthetic data only, no network.
// NODE_PATH=/workspace/work/deps/node_modules node tests/operator-services.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createOperatorFixture,OP,OP_SESSION}=require('./operator-core.sql.cjs');
const {COMPANY,FOREIGN,OWNER,ADMIN,OUTSIDER,INACTIVE}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..'),FILE='20261123120535_operator_service_observations.sql';
const SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
let db,passed=0,failed=0;
const q=(sql,args=[])=>db.query(sql,args),scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function as(role,user,session,fn,extra={}){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:user||undefined,session_id:session||undefined,...extra})]);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}}
const rpc=(name,args=[],role='authenticated',user=OP,session=OP_SESSION,extra={})=>as(role,user,session,()=>scalar('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v)),extra);
const services=(service,query={})=>rpc('snote_operator_services',[service,query]);
const record=event=>rpc('snote_service_event',[event],'service_role',null,null);
const deny=async(fn,codes=['42501'])=>assert.rejects(fn,e=>codes.includes(e.code));
const event=(patch={})=>({userId:OWNER,requestId:randomUUID(),service:'encar',startedAt:new Date().toISOString(),elapsedMs:27,ok:true,httpStatus:200,stage:'complete',adId:'43161296',requestBytes:null,responseBytes:null,...patch});
const definitions=async()=>scalar("select jsonb_object_agg(proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_operator_private' and proname=any($1::text[])",[['actor','verified_session','require_operator','claim_session','account_snapshot','account_version']]);
async function test(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;process.exitCode=1;console.error('FAIL',name,{code:e.code,message:e.message,where:e.where,stack:e.stack});}}
(async()=>{
 db=await createOperatorFixture();
 try{
  await db.exec(`alter table auth.users add column encrypted_password text;create table auth.audit_log_entries(id uuid primary key default gen_random_uuid(),created_at timestamptz,payload json,ip_address text);
   create table snote_private.profile_avatars(user_id uuid not null references auth.users(id),company_id uuid not null references public.zc_companies(id),file_path text not null,previous_path text,revision bigint not null default 1,updated_at timestamptz default now(),primary key(user_id,company_id),unique(file_path));alter table snote_private.profile_avatars enable row level security;
   revoke all on snote_private.profile_avatars from public,anon,authenticated,service_role;`);
  await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261107013521_platform_operator_access.sql'),'utf8'));
  await q("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'operator@example.invalid',now(),'{\"display_name\":\"운영 담당자\"}')",[OP]);
  await q('insert into snote_operator_private.operators(user_id,active) values($1,true)',[OP]);
  await q("insert into auth.sessions(id,user_id,ip,user_agent) values($1,$2,'192.0.2.1','Synthetic operator')",[OP_SESSION,OP]);
  const beforeDefs=await definitions(),versionBefore=await scalar('select snote_operator_private.account_version($1)',[OWNER]);
  await db.exec(SQL);
  await test('migration preserves Auth session/operator/CAS contracts and is idempotent',async()=>{
   assert.deepEqual(await definitions(),beforeDefs);assert.equal(await scalar('select snote_operator_private.account_version($1)',[OWNER]),versionBefore);await db.exec(SQL);assert.deepEqual(await definitions(),beforeDefs);
   const r=await services('encar');assert.deepEqual(r.items,[]);assert.equal(r.pageSize,20);assert(r.notes.some(x=>x.includes('適用')||x.includes('적용')));
  });
  await test('service reads/avatar/accounts remain strict live-session operator only',async()=>{
   for(const name of ['snote_operator_services','snote_operator_account_avatar']){
    const args=name.endsWith('services')?['server',{}]:[OWNER];
    for(const role of ['anon','service_role'])await deny(()=>rpc(name,args,role));
    const sid=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,ADMIN]);await deny(()=>rpc(name,args,'authenticated',ADMIN,sid));
    await deny(()=>rpc(name,args,'authenticated',OWNER,sid));await deny(()=>rpc(name,args,'authenticated',OP,randomUUID()));await deny(()=>rpc(name,args,'authenticated',OP,OP_SESSION,{is_anonymous:true}));
   }
   await q("update auth.sessions set not_after=now()-interval'1 minute' where id=$1",[OP_SESSION]);await deny(()=>services('server'));await q('update auth.sessions set not_after=null where id=$1',[OP_SESSION]);
   await q('update snote_operator_private.operators set active=false where user_id=$1',[OP]);await deny(()=>services('server'));await q('update snote_operator_private.operators set active=true where user_id=$1',[OP]);
  });
  await test('private observations have RLS, no table grants and invoker public wrappers',async()=>{
   assert.equal(await scalar("select relrowsecurity from pg_class where oid='snote_operator_private.service_events'::regclass"),true);
   for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3)',[role,'snote_operator_private.service_events',privilege]),false);
   for(const signature of ['public.snote_service_event(jsonb)','public.snote_operator_services(text,jsonb)','public.snote_operator_account_avatar(uuid)','public.snote_access_logout_confirm()'])assert.equal(await scalar('select prosecdef from pg_proc where oid=$1::regprocedure',[signature]),false);
   for(const signature of ['snote_operator_private.account_avatar_metadata(uuid)','snote_operator_private.account_last_logout(uuid)','snote_operator_private.safe_observed_bytes(text)'])for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,$3)',[role,signature,'EXECUTE']),false);
   await db.exec('grant select on snote_operator_private.service_events to authenticated');assert.equal(await as('authenticated',OWNER,null,()=>scalar('select count(*) from snote_operator_private.service_events')),0);await db.exec('revoke select on snote_operator_private.service_events from authenticated');
  });
  await test('trusted recorder derives actual tenant, is idempotent and rejects forged/secret payloads',async()=>{
   const e=event();for(const role of ['anon','authenticated'])await deny(()=>rpc('snote_service_event',[e],role));
   assert.equal((await record(e)).ok,true);assert.deepEqual(await record(e),await record(e));assert.equal(await scalar('select count(*)::int from snote_operator_private.service_events'),1);assert.equal(await scalar('select company_id from snote_operator_private.service_events where request_id=$1',[e.requestId]),COMPANY);
   await deny(()=>record({...e,elapsedMs:28}),['22023']);
   for(const field of ['plate','vin','ocrText','token','url','companyId','ip','password'])await deny(()=>record(event({[field]:'sensitive-value'})),['22023']);
   await deny(()=>record(event({userId:randomUUID()})));await deny(()=>record(event({userId:INACTIVE})));await deny(()=>record(event({userId:null})));await deny(()=>record(event({service:'vision',adId:'43161296'})),['22023']);
   await deny(()=>as('service_role',null,null,()=>scalar('select public.snote_service_event($1)',[JSON.stringify(event())]),{role:'authenticated'}));
  });
  await test('recorder validates times/numbers/enums and never accepts raw HTTP URLs',async()=>{
   for(const patch of [{requestId:'x'},{service:'other'},{startedAt:'infinity'},{startedAt:'2026-99-31T00:00:00Z'},{startedAt:'2099-01-01T00:00:00Z'},{elapsedMs:-1},{elapsedMs:86400001},{elapsedMs:'1'},{httpStatus:99},{httpStatus:600},{ok:'true'},{stage:'free-form-error'},{requestBytes:-1},{responseBytes:9007199254740992},{adId:'123?token=x'},{endpoint:'/api/encar'}])await deny(()=>record(event(patch)),['22023']);
   const validHttp=event({service:'http',userId:null,adId:null,stage:'response',endpoint:'/api/ocr',method:'POST',requestBytes:1024,responseBytes:2048});await record(validHttp);
   for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'])await record({...validHttp,requestId:randomUUID(),method});
   for(const patch of [{endpoint:'/api/ocr?token=hidden'},{endpoint:'https://example.invalid/api/ocr'},{endpoint:'/api/unlisted'},{method:'CONNECT'},{stage:'complete'},{endpoint:null},{method:null}])await deny(()=>record({...validHttp,requestId:randomUUID(),...patch}),['22023']);
   await deny(()=>q('update snote_operator_private.service_events set ok=false'),['55000']);
  });
  await test('HTTP database endpoint allowlist matches the observation registry, excluding credential recovery',async()=>{
   const {API_OBSERVATION_PATHS:paths}=await import('../functions/_shared/api-security.js');assert.equal(paths.length,14);assert.equal(paths.includes('/api/account-recovery'),false);
   for(const endpoint of paths)await record(event({service:'http',userId:null,adId:null,stage:'response',endpoint,method:'GET'}));
   await deny(()=>record(event({service:'http',userId:null,adId:null,stage:'response',endpoint:'/api/account-recovery',method:'POST'})),['22023']);
  });
  await test('service lists contain real results and safe official links without payload leakage',async()=>{
   await record(event({ok:false,httpStatus:503,stage:'provider',adId:null}));await record(event({service:'vision',stage:'parse',adId:null,requestBytes:4096}));
   const r=await services('encar');assert.equal(r.total,2);assert.equal(r.items.find(x=>x.adId).link,'https://fem.encar.com/cars/detail/43161296?listAdvType=share&adnm=mo_detail_url');assert.equal(r.items.find(x=>!x.success).httpStatus,503);assert.equal(r.items.find(x=>!x.success).stage,'provider');
   const v=await services('vision');assert.equal(v.items[0].imageBytes,4096);assert.equal(v.items[0].adId,undefined);
   for(const result of [r,v])for(const forbidden of ['payload_hash','token','plate','vin','ocrText'])assert.equal(Object.hasOwn(result.items[0],forbidden),false);
  });
  await test('server aggregate reports observed API bytes, unknown sizes and actual Storage metadata',async()=>{
   await q("insert into storage.objects(bucket_id,name,metadata) values('zc-vehicle-private','synthetic/image.png','{\"mimetype\":\"image/png\",\"size\":500}'),('snote-profile-photos','synthetic/no-size.png','{\"mimetype\":\"image/png\",\"size\":\"broken\"}'),('ignored-bucket','other.png','{\"mimetype\":\"image/png\",\"size\":99999}'),('zc-vehicle-private','file.pdf','{\"mimetype\":\"application/pdf\",\"size\":777}')");
   const r=await services('server'),metric=k=>r.metrics.find(x=>x.key===k);assert.equal(metric('image_count').value,3);assert.equal(metric('image_bytes').value,null);assert(metric('image_bytes').unavailableReason);assert.equal(metric('response_bytes').value,8*2048);assert(r.notes.some(x=>x.includes('Cloudflare 전체')));
   const api=r.items.filter(x=>x.endpoint==='/api/ocr');assert(api.every(x=>x.count>=1));assert(api.some(x=>x.knownResponseCount<x.count));assert(r.items.some(x=>x.bytes===null));
   await q("update storage.objects set metadata='{\"mimetype\":\"image/png\",\"size\":250}' where name='synthetic/no-size.png'");assert.equal((await services('server')).metrics.find(x=>x.key==='image_bytes').value,100749);
  });
  await test('SMS app history shows existing real destination/submission/status without customer secrets',async()=>{
   const submitted='2026-11-20T01:02:03Z';
   await q("insert into public.snote_customer_intake(id,company_id,owner_id,car_id,car_snapshot,company_name,phone,token_hash,expires_at,delivery_status,submitted_at,submission_payload,consent_version,consented_at) values($1,$2,$3,'synthetic-car','{\"model\":\"가상 차종\",\"plate\":\"not-output\"}','가상 상사','01012345678',$4,now()+interval'1 day','sent',$5,'{\"privateCustomerField\":\"do-not-output\"}','2026-11-01',$5)",[randomUUID(),COMPANY,OWNER,'a'.repeat(64),submitted]);
   const r=await services('sms'),i=r.items[0];assert.equal((await services('sms',{query:'01012345678'})).total,1);assert.equal((await services('sms',{query:'01099999999'})).total,0);assert.equal(i.model,'가상 차종');assert.equal(i.destination,'01012345678');assert.equal(i.status,'sent');assert.equal(i.success,true);assert.equal(i.customerSubmittedAt,'2026-11-20T01:02:03+00:00');assert.equal(r.metrics.find(x=>x.key==='submitted').value,1);assert(r.notes.some(x=>x.includes('최종 수신 확인')));
   const str=JSON.stringify(r);assert(!str.includes('do-not-output'));assert(!str.includes('not-output'));assert(!str.includes('a'.repeat(64)));
   for(const field of ['submission_payload','phone','token_hash','otp_hash','signature','car_snapshot'])assert.equal(Object.hasOwn(i,field),false);
  });
  await test('account additions reveal password boolean and validated avatar only, preserving version',async()=>{
   const before=await scalar('select snote_operator_private.account_version($1)',[OWNER]);await q('update auth.users set encrypted_password=$2 where id=$1',[OWNER,'synthetic-secret-not-output']);
   let rows=await rpc('snote_operator_accounts_list',[{}]),owner=rows.items.find(x=>x.userId===OWNER);assert.equal(owner.passwordConfigured,true);assert.equal(owner.avatarAvailable,false);assert.equal(owner.lastSignOutAt,null);assert.equal(owner.version,before);assert(!JSON.stringify(rows).includes('synthetic-secret-not-output'));
   const avatar=`${COMPANY}/${OWNER}/${randomUUID()}.png`;
   await q('insert into snote_private.profile_avatars(user_id,company_id,file_path) values($1,$2,$3)',[OWNER,COMPANY,avatar]);assert.equal((await rpc('snote_operator_account_avatar',[OWNER])).path,null,'Unpublished missing storage object must not be fetched');
   await q("insert into storage.objects(bucket_id,name,metadata) values('snote-profile-photos',$1,'{\"mimetype\":\"image/png\",\"size\":1024}')",[avatar]);
   const a=await rpc('snote_operator_account_avatar',[OWNER]);assert.equal(a.path,avatar);assert.equal(a.bucket,'snote-profile-photos');assert.equal(a.size,1024);assert.equal(a.companyId,COMPANY);rows=await rpc('snote_operator_accounts_list',[{}]);owner=rows.items.find(x=>x.userId===OWNER);assert.equal(owner.avatarAvailable,true);assert.equal(owner.version,before);
   await q('update snote_private.profile_avatars set file_path=$2 where user_id=$1',[OWNER,`${FOREIGN}/${OWNER}/${randomUUID()}.png`]);assert.equal((await rpc('snote_operator_account_avatar',[OWNER])).path,null);
   await q('update snote_private.profile_avatars set file_path=$2 where user_id=$1',[OWNER,avatar]);await q("update storage.objects set metadata='{\"mimetype\":\"image/png\",\"size\":5242881}' where name=$1",[avatar]);assert.equal((await rpc('snote_operator_account_avatar',[OWNER])).path,null);
   assert.equal(await scalar('select snote_operator_private.account_version($1)',[OWNER]),before);
  });
  await test('logout receipt rejects live, foreign, unknown and anonymous sessions; records only after real removal',async()=>{
   const sid=randomUUID();await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,OWNER]);await rpc('snote_access_ping',[],'authenticated',OWNER,sid);
   const logout=()=>rpc('snote_access_logout_confirm',[],'authenticated',OWNER,sid);
   await deny(logout);assert.equal(await scalar('select logout_at from snote_operator_private.access_sessions where session_id=$1',[sid]),null);
   await deny(()=>rpc('snote_access_logout_confirm',[],'authenticated',ADMIN,sid));await deny(()=>rpc('snote_access_logout_confirm',[],'authenticated',OWNER,randomUUID()));await deny(()=>rpc('snote_access_logout_confirm',[],'authenticated',OWNER,sid,{is_anonymous:true}));
   for(const role of ['anon','service_role'])await deny(()=>rpc('snote_access_logout_confirm',[],role,OWNER,sid));
   await q('delete from auth.sessions where id=$1',[sid]);const r=await logout();assert.equal(r.ok,true);assert.equal((await logout()).logoutAt,r.logoutAt);assert.equal(r.sessionId,sid);
   await deny(()=>rpc('snote_access_ping',[],'authenticated',OWNER,sid));let row=(await rpc('snote_operator_accounts_list',[{}])).items.find(x=>x.userId===OWNER);assert.equal(row.lastSignOutAt,r.logoutAt);
   await q("insert into auth.audit_log_entries(created_at,payload) values('2026-01-01T00:00:00Z',$1::json),('2020-01-01T00:00:00Z','{\"action\":\"logout\",\"actor_id\":\"malformed\"}')",[JSON.stringify({action:'logout',actor_id:OWNER})]);
   row=(await rpc('snote_operator_accounts_list',[{}])).items.find(x=>x.userId===OWNER);assert.equal(row.lastSignOutAt,r.logoutAt,'Earlier audit does not replace later confirmed logout');
   const latest=await scalar("select clock_timestamp()+interval'1 minute'");await q('insert into auth.audit_log_entries(created_at,payload) values($1,$2::json)',[latest,JSON.stringify({action:'user_signed_out',actor_id:OWNER})]);row=(await rpc('snote_operator_accounts_list',[{}])).items.find(x=>x.userId===OWNER);assert.equal(new Date(row.lastSignOutAt).getTime(),new Date(latest).getTime(),'Latest actual Auth audit logout is included');
   const count=await scalar('select count(*)::int from snote_operator_private.access_sessions');await deny(()=>rpc('snote_access_logout_confirm',[],'authenticated',OWNER,randomUUID()));assert.equal(await scalar('select count(*)::int from snote_operator_private.access_sessions'),count);
   assert.equal(await scalar('select snote_operator_private.account_version($1)',[OWNER]),versionBefore,'Logout/observations do not modify account CAS');
  });
  await test('strict bounded query and stable 20-row pagination ignore SQL text injection',async()=>{
   for(const query of [{page:0},{page:1000000},{query:'x'.repeat(121)},{sort:'startedAt'},{companyId:COMPANY},{unknown:true}])await deny(()=>services('encar',query),['22023']);await deny(()=>services('unsupported'),['22023']);
   assert.equal((await services('encar',{query:"' OR TRUE; --"})).total,0);
   for(let n=0;n<22;n++)await record(event({elapsedMs:n}));const one=await services('encar'),two=await services('encar',{page:2});assert.equal(one.items.length,20);assert.equal(two.items.length,4);assert.equal(one.total,24);assert.equal(new Set([...one.items,...two.items].map(x=>x.requestId)).size,24);
  });
  await test('server-observed scope and retention stay separate from client timestamps and tenant guesses',async()=>{
   const foreign=event({userId:OUTSIDER,service:'vision',adId:null});await record(foreign);assert.equal(await scalar('select company_id from snote_operator_private.service_events where request_id=$1',[foreign.requestId]),FOREIGN);
   // Old server receipts are inserted directly only by this synthetic DBA fixture.
   for(let n=0;n<105;n++)await q("insert into snote_operator_private.service_events(service,request_id,started_at,recorded_at,elapsed_ms,ok,http_status,stage,endpoint,method,payload_hash) values('http',$1,now(),clock_timestamp()-interval'91 days',0,true,200,'response','/api/weather','GET','synthetic')",[randomUUID()]);
   const oldClientTime=event({service:'http',userId:null,adId:null,stage:'response',endpoint:'/api/weather',method:'GET',startedAt:'2000-01-01T00:00:00Z'});await record(oldClientTime);
   assert.equal(await scalar("select count(*)::int from snote_operator_private.service_events where recorded_at<now()-interval'90 days'"),5,'One collection prunes at most100 receipts');
   assert.equal(await scalar('select count(*)::int from snote_operator_private.service_events where request_id=$1',[oldClientTime.requestId]),1,'Client timestamp cannot shorten server receipt retention');
   await record(event({service:'http',userId:null,adId:null,stage:'response',endpoint:'/api/weather',method:'GET'}));assert.equal(await scalar("select count(*)::int from snote_operator_private.service_events where recorded_at<now()-interval'90 days'"),0);
   await deny(()=>rpc('snote_service_event',[event({recordedAt:'2000-01-01T00:00:00Z'})],'service_role',null,null),['22023']);
   assert.equal(await scalar("select has_function_privilege('service_role','snote_operator_private.prune_service_events()','EXECUTE')"),false);
  });
  await test('reapplying migration preserves observations, logout receipts and operator allowlist',async()=>{
   const count=await scalar('select count(*)::int from snote_operator_private.service_events');const logoutCount=await scalar('select count(*)::int from snote_operator_private.access_sessions where logout_at is not null');await db.exec(SQL);assert.equal(await scalar('select count(*)::int from snote_operator_private.service_events'),count);assert.equal(await scalar('select count(*)::int from snote_operator_private.access_sessions where logout_at is not null'),logoutCount);assert.deepEqual(await definitions(),beforeDefs);assert.equal((await services('encar')).total,24);
  });
  console.log(JSON.stringify({passed,failed,migration:FILE,sha256:createHash('sha256').update(SQL).digest('hex')}));
 }finally{await db.close();}
})().catch(e=>{console.error({code:e.code,message:e.message,where:e.where,stack:e.stack});process.exitCode=1;});
