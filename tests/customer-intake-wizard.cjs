'use strict';
// Isolated wizard regression: actual Pages APIs/UI/AES + local PostgreSQL, synthetic data only.
// Every HTTP request is intercepted. Supabase calls use local SQL; SMS/Kakao SDK are fixtures.
// This verifies one PGlite connection/RLS/transactions, not production configuration or multi-session locks.
// Install dependencies outside the static Pages checkout (Node 22+):
//   npm install --prefix /tmp/snote-wizard-tests --no-save --no-audit --no-fund @electric-sql/pglite@0.5.14 playwright
//   NODE_PATH=/tmp/snote-wizard-tests/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/customer-intake-wizard.cjs
// Omit CHROMIUM_PATH to use Playwright's installed Chromium (playwright install chromium).
const fs=require('node:fs');const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const crypto=require('node:crypto');const path=require('node:path');const {chromium}=require('playwright');const {PGlite}=require('@electric-sql/pglite');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://s-note.example';
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function bootstrap({with003=false,with004=true}={}){
 const db=new PGlite();await db.waitReady;
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.zc_companies(id uuid primary key,name text not null);
 create table public.zc_members(user_id uuid not null,company_id uuid not null,role text not null,active boolean not null default true,primary key(user_id,company_id));
 create table public.zc_datasets(company_id uuid not null,owner_id uuid not null,dataset text not null,payload jsonb,primary key(company_id,owner_id,dataset));`);
 await db.query('insert into public.zc_companies values($1,$2),($3,$4)',[COMPANY,'검증용 상사',OTHER_COMPANY,'다른 검증용 상사']);
 await db.query('insert into public.zc_members values($1,$2,$3,true),($4,$5,$3,true)',[ACTOR,COMPANY,'dealer',OTHER,OTHER_COMPANY]);
 const cars=Array.from({length:3},(_,i)=>({id:'test-car-'+(i+1),ownerId:'cld_'+ACTOR.replaceAll('-','').slice(0,18),model:'검증용 차량 '+(i+1),plate:'000가'+String(i+1).padStart(4,'0'),year:2026,km:'10,000',color:'흰색',sell:1200,status:'판매중'}));
 await db.query('insert into public.zc_datasets values($1,$2,$3,$4::jsonb)',[COMPANY,ACTOR,'cars',JSON.stringify(cars)]);
 await db.query('insert into public.zc_datasets values($1,$2,$3,$4::jsonb)',[OTHER_COMPANY,OTHER,'cars',JSON.stringify([{...cars[0],ownerId:'cld_'+OTHER.replaceAll('-','').slice(0,18)}])]);
 await db.exec(`alter table public.zc_companies add column rrn_enabled boolean not null default false;
 create table public.zc_customers(company_id uuid not null,owner_id uuid not null,car_id text not null,payload jsonb not null,has_rrn boolean not null default false,updated_by uuid,updated_at timestamptz not null default clock_timestamp(),primary key(company_id,owner_id,car_id));
 alter table public.zc_customers enable row level security;
 grant select,insert,update,delete on public.zc_customers to authenticated;
 create policy own_customer on public.zc_customers to authenticated using(owner_id=auth.uid() and exists(select 1 from public.zc_members m where m.user_id=auth.uid() and m.company_id=zc_customers.company_id and m.active and m.role in('dealer','admin'))) with check(owner_id=auth.uid() and exists(select 1 from public.zc_members m where m.user_id=auth.uid() and m.company_id=zc_customers.company_id and m.active and m.role in('dealer','admin')));
 grant select on public.zc_members to authenticated;`);
 for(const n of ['202611010001_customer_intake.sql',...(with003?['202611010003_customer_intake_rrn.sql']:[]),...(with004?['202611010004_customer_intake_wizard.sql']:[])])await db.exec(fs.readFileSync(ROOT+'/supabase/migrations/'+n,'utf8'));
 return db;
}
async function as(db,role,actor,fn){
 assert(['anon','authenticated','service_role'].includes(role));await db.exec('set role '+role);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
 try{return await fn();}finally{await db.exec('reset role');}
}
const rpcQueues=new WeakMap();
function rpc(db,role,actor,name,args={}){
 assert(/^[a-z_][a-z0-9_]*$/.test(name));const keys=Object.keys(args);assert(keys.every(key=>/^[a-z_][a-z0-9_]*$/.test(key)));
 const previous=rpcQueues.get(db)||Promise.resolve();const task=previous.catch(()=>{}).then(()=>as(db,role,actor,async()=>{
  const params=keys.map((key,i)=>key+' => $'+(i+1)).join(',');const values=keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);
  return(await db.query('select public.'+name+'('+params+') as result',values)).rows[0].result;
 }));rpcQueues.set(db,task);return task;
}


const JWT='a'.repeat(22)+'.'+'b'.repeat(22)+'.'+'c'.repeat(22),OTHER_JWT='d'.repeat(22)+'.'+'e'.repeat(22)+'.'+'f'.repeat(22);
const RAW13='0001013000000',FORMATTED13='000101-3000000',RAW10='9876543210';
const serviceKey='test-service-role-key';const messages=[],requests=[],apiResults=[];
const env={SUPABASE_SERVICE_ROLE_KEY:serviceKey,CUSTOMER_INTAKE_PUBLIC_ORIGIN:ORIGIN,SOLAPI_API_KEY:'test-key',SOLAPI_API_SECRET:'test-api-secret',SOLAPI_SENDER:'0212345678',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-public-key',CUSTOMER_INTAKE_OTP_SECRET:'test-identity-key-source-'.repeat(3)};
const counters={writes:[],identity:[],legacy:[],external:[],errors:[],casMisses:0};
let db,api,intakeApi,browser,source,failNextWrite=false,holdWrite=null,holdIdentity=null,holdRead=null;
const originalFetch=global.fetch;
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})}
function equality(value){return typeof value==='string'&&value.startsWith('eq.')?value.slice(3):undefined}
function ids(value){if(value?.startsWith('eq.'))return [value.slice(3)];if(value?.startsWith('in.('))return JSON.parse('['+value.slice(4,-1)+']');return null}
function rawInPayload(payload){const copy=structuredClone(payload);delete copy.identityCipher;return [RAW13,FORMATTED13,RAW10,'987-65-43210'].some(value=>JSON.stringify(copy).includes(value))}
async function serverFetch(url,options={}){
 const u=new URL(url);
 if(u.origin==='https://api.solapi.com'){messages.push(JSON.parse(options.body).message);return response({statusCode:'2000',messageId:'TEST_MESSAGE_'+messages.length});}
 assert.equal(u.origin,env.SUPABASE_URL,'Unexpected actual network blocked');
 if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.split('/').at(-1),args=JSON.parse(options.body),headers=new Headers(options.headers),isService=headers.get('apikey')===serviceKey;try{return response(await rpc(db,isService?'service_role':'authenticated',isService?null:ACTOR,name,args));}catch(error){console.log('DB RPC ERROR',name,error.code,error.message);return response({code:error.code||'SQL_ERROR',message:'Local fixture database rejected RPC'},400);}}

 const headers=new Headers(options.headers),token=headers.get('Authorization');const actor=token==='Bearer '+JWT?ACTOR:token==='Bearer '+OTHER_JWT?OTHER:null;
 if(!actor)return response({message:'test auth required'},401);
 assert.equal(headers.get('apikey'),env.SUPABASE_PUBLISHABLE_KEY);
 if(u.pathname==='/auth/v1/user')return response({id:actor,email:'test@example.invalid'});
 const members=(await db.query('select * from public.zc_members where user_id=$1 and active=true',[actor])).rows;
 if(u.pathname==='/rest/v1/zc_members')return response(members.filter(m=>!equality(u.searchParams.get('user_id'))||m.user_id===equality(u.searchParams.get('user_id'))));
 const member=members[0];if(!member)return response([]);
 const company=equality(u.searchParams.get('company_id')),owner=equality(u.searchParams.get('owner_id'));
 if(company!==member.company_id||owner!==actor)return response([]);
 if(u.pathname==='/rest/v1/zc_datasets')return response((await db.query("select payload from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[company,owner])).rows);
 if(u.pathname==='/rest/v1/zc_customers'){
  let rows=(await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2',[company,owner])).rows;const selected=ids(u.searchParams.get('car_id'));if(selected)rows=rows.filter(row=>selected.includes(row.car_id));
  const select=u.searchParams.get('select');if(select==='car_id')return response(rows.map(r=>({car_id:r.car_id})));if(select==='car_id,identity:payload->identityCipher')return response(rows.map(r=>({car_id:r.car_id,identity:r.payload.identityCipher??null})));
  throw Error('Unexpected identity REST selection: '+select);
 }
 throw Error('Unexpected actual network request blocked: '+u.pathname);
}
async function canonical(body){
 const {table,operation,filters={},value}=body;if(table==='zc_media')return {data:[],error:null};if(table!=='zc_customers')throw Error('Unexpected UI table '+table);
 if(operation==='select'){
  const rows=(await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2',[filters.company_id||COMPANY,filters.owner_id||ACTOR])).rows.filter(row=>filters.car_id===undefined||row.car_id===filters.car_id);
  if(holdRead&&holdRead.match(body)){const held=holdRead;holdRead=null;held.entered();await held.wait;}
  return {data:body.single?(rows[0]||null):rows,error:null};
 }
 if(operation==='delete'){await db.query('delete from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[filters.company_id,filters.owner_id,filters.car_id]);return {data:[],error:null};}
 assert(['update','insert'].includes(operation),'Blind customer upsert is forbidden');assert(value&&typeof value.payload==='object');assert.equal(rawInPayload(value.payload),false,'Plain manual identity must never enter canonical JSON');
 counters.writes.push(structuredClone(body));
 if(holdWrite&&holdWrite.match(body)){const held=holdWrite;holdWrite=null;held.entered();await held.wait;}
 if(failNextWrite){failNextWrite=false;return {data:null,error:{code:'TEST_WRITE_FAILED',message:'검증용 저장 실패'}};}
 if(operation==='update'){
  const match=filters.updated_at===null?'updated_at is null':'updated_at=$7::timestamptz';
  const args=[value.payload,value.updated_by,value.updated_at,filters.company_id,filters.owner_id,filters.car_id];if(filters.updated_at!==null)args.push(filters.updated_at);
  const rows=(await db.query(`update public.zc_customers set payload=$1::jsonb,updated_by=$2,updated_at=$3::timestamptz where company_id=$4 and owner_id=$5 and car_id=$6 and ${match} returning car_id`,args)).rows;
  if(!rows.length)counters.casMisses++;return {data:rows,error:null};
 }
 try{const result=await db.query('insert into public.zc_customers(company_id,owner_id,car_id,payload,updated_by,updated_at) values($1,$2,$3,$4::jsonb,$5,$6) returning car_id',[value.company_id,value.owner_id,value.car_id,value.payload,value.updated_by,value.updated_at]);return {data:result.rows,error:null};}
 catch(error){return {data:null,error:{code:error.code,message:'Local test insert rejected'}};}
}
function html(){return source.replace("const NIL='00000000-0000-0000-0000-000000000000';","window.__identityState=S;\nconst NIL='00000000-0000-0000-0000-000000000000';").replace('\ninitializeAuth();','\nwindow.__identityReady=initializeAuth();');}
async function routeContext(page){
 page.setDefaultTimeout(12000);
 page.on('pageerror',e=>counters.errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.context().route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin==='https://t1.kakaocdn.net'&&u.pathname==='/mapjsapi/bundle/postcode/prod/postcode.v2.js')return route.fulfill({contentType:'text/javascript',body:mockSdk});if(u.origin!==ORIGIN){counters.external.push(u.origin);return route.abort()}
  if(u.pathname==='/api/customer-identity'){
   const body=JSON.parse(req.postData());counters.identity.push(structuredClone(body));
   if(holdIdentity&&holdIdentity.match(body)){const held=holdIdentity;holdIdentity=null;held.entered();await held.wait;}
   const result=await api.onRequestPost({request:new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postData()}),env});return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()});
  }
  if(u.pathname==='/api/customer-intake'){const body=JSON.parse(req.postData());requests.push(body);const result=await intakeApi.onRequestPost({request:new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postData()}),env});const text=await result.text();apiResults.push({action:body.action,status:result.status,result:JSON.parse(text)});return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:text});}
  if(u.pathname==='/customer.html'||u.pathname==='/address-search.html')return route.fulfill({contentType:'text/html; charset=utf-8',body:fs.readFileSync(ROOT+u.pathname,'utf8'),headers:headersFor(u.pathname==='/customer.html'?'/customer*':'/address-search*')});
  if(u.pathname==='/__fixture/canonical')return route.fulfill({contentType:'application/json',body:JSON.stringify(await canonical(JSON.parse(req.postData())))});
  if(u.pathname==='/__fixture/rpc'){const body=JSON.parse(req.postData());counters.legacy.push(body.name);if(body.name==='zc_write_dataset')return route.fulfill({contentType:'application/json',body:JSON.stringify({data:1,error:null})});return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{message:'Legacy identity RPC must not be used'}})});}
  if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:html()});
  if(u.pathname.startsWith('/assets/'))return route.fulfill({path:ROOT+u.pathname});
  return route.abort();
 });
}
async function boot(page,carId='test-car-1'){
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__identityReady);await page.evaluate(()=>window.__identityReady);
 const cars=(await db.query("select payload from public.zc_datasets where owner_id=$1 and dataset='cars'",[ACTOR])).rows[0].payload;
 await page.evaluate(async({actor,company,jwt,cars:all,carId})=>{
  const alias='cld_'+actor.replace(/-/g,'').slice(0,18);await enterWorkspace({username:alias,name:'검증용 딜러',role:'dealer',company:'검증용 상사',employeeNo:'TEST',union:''});
  const S=window.__identityState;S.user={id:actor};S.company={id:company,name:'검증용 상사',rrn_enabled:false};S.members=[{user_id:actor,company_id:company,display_name:'검증용 딜러',role:'dealer',active:true}];
  const send=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json()};
  S.client={auth:{getSession:async()=>({data:{session:{access_token:jwt,user:{id:actor}}},error:null})},rpc:async(name,args)=>send('/__fixture/rpc',{name,args}),from(table){
   const query={table,operation:'select',filters:{},single:false,value:null};const chain={
    select(){return chain},eq(key,value){query.filters[key]=value;return chain},is(key,value){query.filters[key]=value;return chain},order(){return chain},limit(){return chain},maybeSingle(){query.single=true;return chain},single(){query.single=true;return chain},
    update(value){query.operation='update';query.value=value;return chain},insert(value){query.operation='insert';query.value=value;return chain},upsert(value){query.operation='upsert';query.value=value;return chain},delete(){query.operation='delete';return chain},
    then(resolve,reject){return send('/__fixture/canonical',query).then(resolve,reject)}
   };return chain;
  }};S.ready=true;document.getElementById('zc-cloud-gate').hidden=true;cars=all;openVehicle(carId);await openSaleProgress();
 },{actor:ACTOR,company:COMPANY,jwt:JWT,cars,carId});
}
async function fill(page,value,name='수동 검증 고객'){
 await page.locator('#zc72-name').fill(name);await page.locator('#zc72-phone').fill('01012345678');await page.locator('#zc72-address').fill('서울시 테스트로 1');await page.locator('#zc73-address-detail').fill('101호');await page.locator('#zc72-rrn').fill(value);await page.locator('#zc72-rrn').dispatchEvent('change');
}
async function saved(carId='test-car-1'){return (await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[COMPANY,ACTOR,carId])).rows[0]}
async function apiCall(body,jwt=JWT){const result=await api.onRequestPost({request:new Request(ORIGIN+'/api/customer-identity',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+jwt},body:JSON.stringify(body)}),env});return {status:result.status,...await result.json()}}
async function initialize(){
 db=await bootstrap();
 api=await import(pathToFileURL(ROOT+'/functions/api/customer-identity.js').href);intakeApi=await import(pathToFileURL(ROOT+'/functions/api/customer-intake.js').href);source=fs.readFileSync(ROOT+'/index.html','utf8');global.fetch=serverFetch;
}

const headersFor=prefix=>Object.fromEntries(fs.readFileSync(ROOT+'/_headers','utf8').split(/\r?\n\s*\r?\n/).find(block=>block.startsWith(prefix+'\n')).split(/\r?\n/).slice(1).filter(line=>/^\s+/.test(line)).map(line=>{const split=line.indexOf(':');return [line.slice(0,split).trim(),line.slice(split+1).trim()]}));
const mockSdk="window.daum={Postcode:function(options){this.embed=function(root,settings){if(window.top!==window||location.protocol!=='https:'||window.opener!==null)throw Error('Invalid SDK execution context');const button=document.createElement('button');button.id='sdk-test-select-address';button.textContent='테스트 주소 선택';button.onclick=function(){options.oncomplete({userSelectedType:'R',roadAddress:'서울시 강남구 테스트로 1',zonecode:'12345'})};root.appendChild(button)}}};";
async function requestIntake(body,{jwt=null}={}){const r=await intakeApi.onRequestPost({request:new Request(ORIGIN+'/api/customer-intake',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{})},body:JSON.stringify(body)}),env});return {status:r.status,...await r.json()};}

const H=value=>crypto.createHash('sha256').update(String(value)).digest('hex');let serial=0;
const SIGNATURE={version:1,strokes:[[[.1,.2],[.7,.8]]]};const CIPHER='smi1.'+'1'.repeat(24)+'.'+'a'.repeat(58);
const CUSTOMER={name:'검증용 고객',addressBase:'서울시 테스트로 1',addressDetail:'101호',mailingBase:'',mailingDetail:'',sameAddress:false,refundBank:'',refundAccount:'',refundHolder:'',refundConsent:false,phone:'01012345678'};
async function create(db,{carId='test-car-1',phone='01012345678',actor=ACTOR}={}){const hash=H('wizard-link-'+(++serial)),r=await rpc(db,'authenticated',actor,'snote_intake_create',{p_car_id:carId,p_phone:phone,p_token_hash:hash});if(!r.ok)throw Error('create '+JSON.stringify(r));return {...r,hash,phone};}
async function verified(db,opts){const link=await create(db,opts),challenge=crypto.randomUUID(),otp=H('otp-'+(++serial)),session=H('session-'+(++serial));for(const [name,args]of [['snote_intake_challenge_v3',{p_token_hash:link.hash,p_challenge_id:challenge,p_otp_hash:otp,p_phone:link.phone}],['snote_intake_delivery',{p_id:link.id,p_kind:'otp',p_challenge_id:challenge,p_status:'sent'}],['snote_intake_verify',{p_token_hash:link.hash,p_challenge_id:challenge,p_otp_hash:otp,p_session_hash:session}]]){const r=await rpc(db,'service_role',null,name,args);if(!r.ok)throw Error(name+' '+JSON.stringify(r));}return {...link,session,challenge,otp};}
const submit=(db,link,{customer=CUSTOMER,cipher=CIPHER,signature=SIGNATURE,consentVersion='2026-11-01'}={})=>rpc(db,'service_role',null,'snote_intake_submit_v3',{p_token_hash:link.hash,p_session_hash:link.session,p_customer:customer,p_consent_version:consentVersion,p_identity_cipher:cipher,p_signature:signature});
const row=async(db,link)=>(await db.query('select * from public.snote_customer_intake where id=$1',[link.id])).rows[0];
const canonicalRecord=async(db,carId='test-car-1')=>(await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[COMPANY,ACTOR,carId])).rows[0];

let passed=0;
const call=(db,name,args,role='service_role',actor=null)=>rpc(db,role,actor,name,args);
async function test(db,name,fn){await db.exec('truncate public.snote_customer_intake cascade;truncate public.zc_customers;');await db.exec("update public.zc_members set role='dealer',active=true;update public.zc_companies set rrn_enabled=false;");try{await fn();passed++;console.log('PASS',name);}catch(error){console.error('FAIL',name,error.code||'',error.message);throw error;}}
async function runSql(with003){const db=await bootstrap({with003});try{
 await db.exec(fs.readFileSync(ROOT+'/supabase/migrations/202611010004_customer_intake_wizard.sql','utf8'));console.log('PASS 0004 applies/repeats with003='+with003);
 await test(db,'exact ACL / tables stay private',async()=>{
  const funcs=[['snote_intake_view_v3','text','service_role'],['snote_intake_challenge_v3','text,uuid,text,text','service_role'],['snote_intake_submit_context_v3','text,text','service_role'],['snote_intake_submit_v3','text,text,jsonb,text,text,jsonb','service_role'],['snote_intake_details_v3','uuid','authenticated']];
  for(const[name,sig,allowed]of funcs)for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,`public.${name}(${sig})`,'EXECUTE'])).rows[0].allowed,role===allowed,role+' '+name);
  for(const role of ['anon','authenticated','service_role'])await assert.rejects(()=>as(db,role,ACTOR,()=>db.query('select submission_payload from public.snote_customer_intake')),e=>e.code==='42501');
 });
 await test(db,'view v3 is enabled despite company flag false; mismatched OTP phone is inert',async()=>{
  const link=await create(db);const info=await call(db,'snote_intake_view_v3',{p_token_hash:link.hash});assert.equal(info.ok,true);assert.equal(info.rrnEnabled,true);assert.equal(info.flowVersion,'wizard-v1');assert(!JSON.stringify(info).includes(COMPANY));
  const before=await row(db,link);const r=await call(db,'snote_intake_challenge_v3',{p_token_hash:link.hash,p_challenge_id:crypto.randomUUID(),p_otp_hash:H('badphone'),p_phone:'01099998888'});assert.equal(r.ok,false);const after=await row(db,link);assert.equal(after.otp_send_count,before.otp_send_count);assert.equal(after.session_hash,before.session_hash);assert.equal(after.challenge_id,before.challenge_id);
 });
 await test(db,'verified context binds identifiers and full phone; OTP is consumed',async()=>{
  const link=await verified(db);const ctx=await call(db,'snote_intake_submit_context_v3',{p_token_hash:link.hash,p_session_hash:link.session});assert.equal(ctx.ok,true);assert.equal(ctx.companyId,COMPANY);assert.equal(ctx.ownerId,ACTOR);assert.equal(String(ctx.carId),'test-car-1');assert.equal(ctx.phone,link.phone);
  assert.equal((await call(db,'snote_intake_submit_context_v3',{p_token_hash:link.hash,p_session_hash:H('other')})).code,'SESSION_EXPIRED');assert.equal((await call(db,'snote_intake_verify',{p_token_hash:link.hash,p_challenge_id:link.challenge,p_otp_hash:link.otp,p_session_hash:H('replay')})).ok,false);
 });
 await test(db,'all fields + signature + smi1 canonical insert atomically; original source and server timestamp',async()=>{
  const link=await verified(db),result=await submit(db,link);assert.equal(result.ok,true);assert.equal(result.canonicalApplied,true);const r=await row(db,link),c=await canonicalRecord(db);assert(c);assert.equal(r.submission_payload.identityCipher,CIPHER);assert.deepEqual(r.submission_payload.signature,SIGNATURE);assert.equal(r.submission_payload.flowVersion,'wizard-v1');assert.equal(r.submission_payload.canonicalApplied,true);assert.equal(r.submission_payload.phone,link.phone);assert.equal(c.payload.identityCipher,CIPHER);assert.deepEqual(c.payload.customerSignature,SIGNATURE);assert.equal(c.payload.customerSignatureSignedAt,r.submission_payload.signedAt);assert.equal(c.payload.intakeSource.requestId,link.id);assert.equal(c.payload.intakeSource.submittedAt,result.submittedAt);assert.equal(c.payload.ownerId,'cld_'+ACTOR.replaceAll('-','').slice(0,18));assert.equal(c.payload.carId,'test-car-1');assert.equal(c.payload.address,'서울시 테스트로 1 101호');assert.equal(c.payload.mailing,'');assert.equal(c.payload.phone,link.phone);
  const listing=await call(db,'snote_intake_list',{p_car_id:'test-car-1'},'authenticated',ACTOR);assert(Array.isArray(listing));const item=listing.find(i=>i.id===link.id);assert.equal(item.hasRrn,true);assert.equal(item.hasSignature,true);assert.equal(item.canonicalApplied,true);
 });
 await test(db,'signature malformed/empty/small/size/range cases never partially commit',async()=>{
  const link=await verified(db),invalid=[null,{}, {...SIGNATURE,extra:true},{version:2,strokes:SIGNATURE.strokes},{version:'oops',strokes:SIGNATURE.strokes},{version:1,strokes:[]},{version:1,strokes:[[[.1,.2]]]},{version:1,strokes:[[[.1,.2],[.1,.2]]]},{version:1,strokes:[[[.1,.2],[.101,.201]]]},{version:1,strokes:[[[0,0],[1.01,1]]]},{version:1,strokes:[[['0',0],[1,1]]]},{version:1,strokes:[[[0,0,1],[1,1]]]},{version:1,strokes:Array.from({length:25},()=>[[0,0],[1,1]])},{version:1,strokes:[Array.from({length:257},(_,i)=>[i/256,i/256])]},{version:1,strokes:Array.from({length:5},()=>Array.from({length:241},(_,i)=>[i/240,i/240]))}];
  for(const signature of invalid){const r=await submit(db,link,{signature});assert.equal(r.code,'VALIDATION_ERROR',JSON.stringify(signature).slice(0,90));assert.equal((await row(db,link)).submitted_at,null);assert.equal(await canonicalRecord(db),undefined);}
  assert.equal((await submit(db,link)).ok,true);
 });
 await test(db,'phone/cipher/customer-key/consent validation precedes old submit',async()=>{
  const link=await verified(db);for(const overrides of [{customer:{...CUSTOMER,phone:'01099998888'}},{customer:{...CUSTOMER,phone:null}},{customer:{...CUSTOMER,rrn:'0001013000000'}},{cipher:null},{cipher:'0001013000000'},{cipher:'smi1.'+'a'.repeat(24)+'.'+'a'.repeat(52)},{consentVersion:'wrong'}]){const r=await submit(db,link,overrides);assert.equal(r.ok,false);assert.equal((await row(db,link)).submitted_at,null);assert.equal(await canonicalRecord(db),undefined);}
 });
 await test(db,'same-session retry immutable; wrong/expired session cannot retry or read context',async()=>{
  const link=await verified(db);await submit(db,link);const first=await row(db,link),c=await canonicalRecord(db);const retry=await submit(db,link,{customer:{...CUSTOMER,name:'변경된 재시도'},signature:{version:1,strokes:[[[0,0],[1,1]]]},cipher:'smi1.'+'2'.repeat(24)+'.'+'b'.repeat(58)});assert.equal(retry.ok,true);assert.equal(retry.alreadySubmitted,true);assert.deepEqual((await row(db,link)).submission_payload,first.submission_payload);assert.deepEqual((await canonicalRecord(db)).payload,c.payload);
  assert.equal((await submit(db,{...link,session:H('wrong')})).code,'SESSION_EXPIRED');await db.query("update public.snote_customer_intake set session_expires_at=clock_timestamp()-interval '1 second' where id=$1",[link.id]);assert.equal((await submit(db,link)).code,'SESSION_EXPIRED');assert.equal((await call(db,'snote_intake_submit_context_v3',{p_token_hash:link.hash,p_session_hash:link.session})).code,'SESSION_EXPIRED');
 });
 await test(db,'legacy submission cannot be accepted as signed wizard retry',async()=>{
  const link=await verified(db),customer={...CUSTOMER};delete customer.phone;
  assert.equal((await call(db,'snote_intake_submit',{p_token_hash:link.hash,p_session_hash:link.session,p_customer:customer,p_consent_version:'2026-11-01'})).ok,true);
  const first=(await row(db,link)).submission_payload;assert.equal((await submit(db,link)).code,'ALREADY_SUBMITTED');assert.deepEqual((await row(db,link)).submission_payload,first);assert.equal(await canonicalRecord(db),undefined);
 });
 await test(db,'existing canonical customer is never overwritten; intake remains durable and retry cannot recreate deleted canonical',async()=>{
  await db.query('insert into public.zc_customers(company_id,owner_id,car_id,payload) values($1,$2,$3,$4::jsonb)',[COMPANY,ACTOR,'test-car-1',JSON.stringify({name:'딜러 기존 편집',identityCipher:'old-value',customerSignature:{old:true}})]);const link=await verified(db),result=await submit(db,link);assert.equal(result.ok,true);assert.equal(result.canonicalApplied,false);assert.deepEqual((await canonicalRecord(db)).payload,{name:'딜러 기존 편집',identityCipher:'old-value',customerSignature:{old:true}});assert.equal((await row(db,link)).submission_payload.name,CUSTOMER.name);await db.exec('delete from public.zc_customers');const retry=await submit(db,link);assert.equal(retry.alreadySubmitted,true);assert.equal(await canonicalRecord(db),undefined);
 });
 await test(db,'canonical insert database error rolls back intake and can retry same verified session',async()=>{
  await db.exec("create function public.wizard_test_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic canonical error';end$$;create trigger wizard_test_failure before insert on public.zc_customers for each row execute function public.wizard_test_fail();");const link=await verified(db);try{await assert.rejects(()=>submit(db,link));assert.equal((await row(db,link)).submitted_at,null);assert.equal((await row(db,link)).submission_payload,null);assert.equal(await canonicalRecord(db),undefined);}finally{await db.exec('drop trigger wizard_test_failure on public.zc_customers;drop function public.wizard_test_fail();');}assert.equal((await submit(db,link)).ok,true);
 });
 await test(db,'numeric canonical car id retains number type',async()=>{
  const cars=(await db.query("select payload from public.zc_datasets where owner_id=$1 and dataset='cars'",[ACTOR])).rows[0].payload;cars.push({...cars[0],id:215});await db.query("update public.zc_datasets set payload=$1::jsonb where owner_id=$2 and dataset='cars'",[JSON.stringify(cars),ACTOR]);const link=await verified(db,{carId:'215'});assert.equal((await submit(db,link)).ok,true);assert.equal((await canonicalRecord(db,'215')).payload.carId,215);
 });
 await test(db,'details access denies other owner/inactive/revoked/retention; sold own car remains readable',async()=>{
  const link=await verified(db);await submit(db,link);const access=actor=>call(db,'snote_intake_details_v3',{p_id:link.id},'authenticated',actor);const good=await access(ACTOR);assert.equal(good.ok,true);assert.equal(good.identityCipher,CIPHER);assert.equal((await access(OTHER)).ok,false);
  await db.query('update public.zc_members set active=false where user_id=$1',[ACTOR]);assert.equal((await access(ACTOR)).ok,false);await db.query('update public.zc_members set active=true where user_id=$1',[ACTOR]);
  const cars=(await db.query("select payload from public.zc_datasets where owner_id=$1 and dataset='cars'",[ACTOR])).rows[0].payload;cars.find(c=>c.id==='test-car-1').status='판매완료';await db.query("update public.zc_datasets set payload=$1::jsonb where owner_id=$2 and dataset='cars'",[JSON.stringify(cars),ACTOR]);assert.equal((await access(ACTOR)).ok,true);cars.find(c=>c.id==='test-car-1').status='판매중';await db.query("update public.zc_datasets set payload=$1::jsonb where owner_id=$2 and dataset='cars'",[JSON.stringify(cars),ACTOR]);
  await db.query('update public.snote_customer_intake set revoked_at=clock_timestamp() where id=$1',[link.id]);assert.equal((await access(ACTOR)).ok,false);await db.query("update public.snote_customer_intake set revoked_at=null,submitted_at=clock_timestamp()-interval '31 days' where id=$1",[link.id]);assert.equal((await access(ACTOR)).ok,false);
 });
 }finally{await db.close();}}

const stage=(page,name)=>page.locator('[data-wizard-step="'+name+'"]');
async function unsubmitted(){const rows=(await db.query('select submitted_at,submission_payload from public.snote_customer_intake order by created_at desc limit 1')).rows;assert.equal(rows[0].submitted_at,null);assert.equal(rows[0].submission_payload,null);}
async function draw(page){await page.locator('#signature-canvas').scrollIntoViewIfNeeded();const box=await page.locator('#signature-canvas').boundingBox();assert(box);await page.mouse.move(box.x+box.width*.15,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.7,{steps:10});await page.mouse.move(box.x+box.width*.85,box.y+box.height*.3,{steps:10});await page.mouse.up();}
async function mobile(page,link,{name='모바일 단계 고객',refund=true,popup=true,wrongPhone=true}={}){
 await routeContext(page);await page.goto(link,{waitUntil:'networkidle'});await page.locator('#stage-car').waitFor({state:'visible'});assert.equal(new URL(page.url()).hash,'');await page.locator('#vehicle-confirmed').check();await page.locator('#vehicle-next').click();await stage(page,'name').waitFor({state:'visible'});
 await page.locator('#customer-name').fill(name);await page.locator('#wizard-next').click();await stage(page,'rrn').waitFor({state:'visible'});await unsubmitted();assert.equal(await page.locator('#rrn-section').isVisible(),true);await page.locator('#rrn-front').fill('000101');await page.locator('#rrn-back').fill('3000000');await page.locator('#wizard-prev').click();assert.equal(await page.locator('#customer-name').inputValue(),name);await page.locator('#wizard-next').click();assert.equal(await page.locator('#rrn-front').inputValue(),'000101');await page.locator('#wizard-next').click();await stage(page,'address').waitFor({state:'visible'});await unsubmitted();
 if(popup){const opened=page.waitForEvent('popup');await page.locator('[data-address-search="residence"]').click();const helper=await opened;await helper.locator('#sdk-test-select-address').waitFor();assert.equal(await helper.evaluate(()=>window.opener===null),true);const closed=helper.waitForEvent('close');await helper.locator('#sdk-test-select-address').click();await closed;await page.waitForFunction(()=>document.getElementById('address-base').value==='서울시 강남구 테스트로 1');}
 else await page.locator('#address-base').fill('서울시 강남구 테스트로 1');
 await page.locator('#address-detail').fill('301호');await page.locator('#same-address').uncheck();await page.locator('#mailing-base').fill('부산시 등기로 2');await page.locator('#mailing-detail').fill('202호');await page.locator('#wizard-next').click();await stage(page,'phone').waitFor({state:'visible'});await unsubmitted();
 if(wrongPhone){const before=messages.length;await page.locator('#customer-phone').fill('01099998888');await page.locator('#request-code').click();await page.locator('#status-message[data-tone="error"]').waitFor();assert.equal(messages.length,before);}
 await page.locator('#customer-phone').fill('01012345678');await page.locator('#request-code').click();await page.locator('#verification-code').waitFor({state:'visible'});const otp=/인증번호: (\d{6})/.exec(messages.at(-1).text)[1];await page.locator('#verification-code').fill(otp==='000000'?'111111':'000000');await page.locator('#verify-button').click();await page.locator('#status-message[data-tone="error"]').waitFor();await page.locator('#verification-code').fill(otp);await page.locator('#verify-button').click();await stage(page,'refund').waitFor({state:'visible'});await unsubmitted();
 if(refund){await page.locator('#refund-bank').fill('신한은행');await page.locator('#refund-account').fill('1234567890123');await page.locator('#refund-holder').fill(name);}
 await page.locator('#wizard-next').click();await stage(page,'consent').waitFor({state:'visible'});await unsubmitted();await page.locator('#required-consent').check();if(refund)await page.locator('#refund-consent').check();
 const beforeSubmit=requests.filter(r=>r.action==='submit').length;await draw(page);await page.locator('#signature-clear').click();await page.locator('#submit-customer').click();assert.equal(requests.filter(r=>r.action==='submit').length,beforeSubmit);await draw(page);await page.locator('#submit-customer').click();await page.locator('#stage-success').waitFor({state:'visible'});assert.equal(requests.filter(r=>r.action==='submit').length,beforeSubmit+1);assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 const submit=requests.filter(r=>r.action==='submit').at(-1);assert.equal(submit.flowVersion,'wizard-v1');assert.equal(submit.customer.phone,'01012345678');assert.equal(submit.rrn,RAW13);assert.equal(submit.signature.version,1);assert(submit.signature.strokes[0].length>=2);return submit;
}
async function runBrowser(){await initialize();browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});try{
 const dealer=await browser.newPage({viewport:{width:1280,height:1000}});await routeContext(dealer);await boot(dealer);const panel=dealer.locator('#snote-intake-panel');await panel.locator('.snote-intake-empty').waitFor();await panel.locator('#snote-intake-phone').fill('01012345678');await panel.getByRole('button',{name:'입력 링크 문자 보내기',exact:true}).click();await panel.locator('.snote-intake-message.is-success').waitFor();const link=/https:\/\/s-note\.example\/customer\.html#[a-f0-9]{64}/.exec(messages.at(-1).text)[0];
 const customer=await browser.newPage({viewport:{width:390,height:900}});const submit=await mobile(customer,link);const row=(await db.query('select * from public.snote_customer_intake')).rows[0];const canonical=await saved();assert.equal(row.submission_payload.name,'모바일 단계 고객');assert.equal(row.submission_payload.addressBase,'서울시 강남구 테스트로 1');assert.equal(row.submission_payload.mailingBase,'부산시 등기로 2');assert.equal(row.submission_payload.refundAccount,'1234567890123');assert.equal(row.submission_payload.flowVersion,'wizard-v1');assert.match(row.submission_payload.identityCipher,/^smi1\.[a-f0-9]{24}\.[a-f0-9]{58}$/);assert.deepEqual(canonical.payload.customerSignature,row.submission_payload.signature);assert.equal(canonical.payload.customerSignatureSignedAt,row.submission_payload.signedAt);assert.equal(canonical.payload.intakeSource.requestId,row.id);assert(!JSON.stringify(row.submission_payload).includes(RAW13));assert(!JSON.stringify(canonical.payload).includes(RAW13));
 const duplicate=await requestIntake(submit);assert.equal(duplicate.alreadySubmitted,true);assert.deepEqual((await saved()).payload,canonical.payload);const view=apiResults.find(r=>r.action==='info').result;assert.equal(view.rrnEnabled,true);assert.equal(view.flowVersion,'wizard-v1');
 const writesBefore=counters.writes.length;await panel.getByRole('button',{name:'새로고침',exact:true}).click();await dealer.waitForFunction(()=>document.getElementById('zc72-name').value==='모바일 단계 고객'&&document.getElementById('zc72-rrn').value==='000101-3000000');assert.equal(counters.writes.length,writesBefore,'Auto-fill must not overwrite canonical');assert.equal(await dealer.locator('#zc72-phone').inputValue(),'010-1234-5678');assert.equal(await dealer.locator('#zc74-refund-account').inputValue(),'1234567890123');
 console.log('PASS actual API+SQL+390px six-stage wizard, popup, signature clear/draw, final-only atomic submit, false company flag, idempotence, pristine auto-fill');
 await panel.locator('.snote-intake-signature-canvas').waitFor({state:'visible'});assert.match(await panel.locator('.snote-intake-signature').textContent(),/원제출 서명/);
 const preserved={signature:canonical.payload.customerSignature,signedAt:canonical.payload.customerSignatureSignedAt,source:canonical.payload.intakeSource};
 await dealer.locator('#zc72-name').fill('딜러 후속 수정');await dealer.locator('#snote214-save-customer').click();await dealer.waitForFunction(()=>!zc72SaleLoading);let after=await saved();assert.equal(after.payload.name,'딜러 후속 수정');assert.deepEqual(after.payload.customerSignature,preserved.signature);assert.equal(after.payload.customerSignatureSignedAt,preserved.signedAt);assert.deepEqual(after.payload.intakeSource,preserved.source);
 await dealer.getByRole('button',{name:'▣ 인수증 출력',exact:true}).click();await dealer.locator('#zc76-receipt-overlay').waitFor({state:'visible'});await dealer.locator('#snote215-receipt-signature').waitFor({state:'visible'});assert.match(await dealer.locator('#snote215-receipt-signature-image').getAttribute('src'),/^data:image\/png;base64,/);assert.match(await dealer.locator('#snote215-receipt-signature-caption').textContent(),/원제출/);assert.equal(await dealer.locator('#zc76-receipt-overlay input[type="checkbox"]:checked').count(),0);await dealer.evaluate(()=>zc76CloseReceipt());
 const readBefore=requests.filter(r=>r.action==='read-rrn').length;await dealer.evaluate(async()=>{await openSaleProgress();});await panel.locator('.snote-intake-request').first().waitFor();assert.equal(await dealer.locator('#zc72-name').inputValue(),'딜러 후속 수정');assert.equal(requests.filter(r=>r.action==='read-rrn').length,readBefore,'Canonical intakeSource prevents re-applying old submission');assert.equal(await dealer.locator('#snote215-receipt-signature-image').getAttribute('src'),null);
 console.log('PASS original signature preview/receipt, no auto-checkbox consent, later dealer edits preserve signature/source and reopen does not reapply');
 await dealer.evaluate(async()=>{closeSaleProgress();openVehicle('test-car-2');await openSaleProgress();});await panel.locator('#snote-intake-phone').fill('01012345678');await panel.getByRole('button',{name:'입력 링크 문자 보내기',exact:true}).click();await panel.locator('.snote-intake-message.is-success').waitFor();const link2=/https:\/\/s-note\.example\/customer\.html#[a-f0-9]{64}/.exec(messages.at(-1).text)[0];await dealer.locator('#zc72-name').fill('작성 중인 딜러 메모');
 const customer2=await browser.newPage({viewport:{width:320,height:900}});await mobile(customer2,link2,{name:'두 번째 모바일 고객',refund:false,popup:false,wrongPhone:false});const beforeDirtyLoad=counters.writes.length;await panel.getByRole('button',{name:'새로고침',exact:true}).click();await panel.getByText(/새 입력이 도착/).waitFor();assert.equal(await dealer.locator('#zc72-name').inputValue(),'작성 중인 딜러 메모');assert.equal(counters.writes.length,beforeDirtyLoad);assert.equal((await saved('test-car-2')).payload.name,'두 번째 모바일 고객');await panel.getByRole('button',{name:'입력정보 불러오기',exact:true}).click();await dealer.waitForFunction(()=>document.getElementById('zc72-name').value==='두 번째 모바일 고객'&&document.getElementById('zc72-rrn').value==='000101-3000000');assert.equal(counters.writes.length,beforeDirtyLoad);
 console.log('PASS 320px wizard; submitted data survives independently while dealer dirty form stays unchanged until explicit load');

 assert.deepEqual(counters.external,[]);assert.deepEqual(counters.errors,[]);console.log('COUNTERS',JSON.stringify({browserRequests:requests.length,uiWrites:counters.writes.length,smsMocks:messages.length,apiResults:apiResults.map(r=>({action:r.action,status:r.status}))}));
 }finally{await browser.close();global.fetch=originalFetch;await db.close();}}

(async()=>{await runSql(false);await runSql(true);await runBrowser();console.log('TOTAL SQL PASS',passed);})().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});
