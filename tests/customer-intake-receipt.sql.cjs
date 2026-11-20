'use strict';
// Synthetic PostgreSQL only. Tests the actual migration, transactions and ACLs;
// no production database, customer, SMS or HTTP service is touched.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const{PGlite}=require('@electric-sql/pglite');
const ROOT=path.resolve(__dirname,'..'),MIGRATION=fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(name=>name.endsWith('_customer_intake_receipt_details.sql')).sort().at(-1);assert(MIGRATION);
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SIGNATURE={version:1,strokes:[[[.1,.2],[.7,.8]]]},CIPHER='smi1.'+'1'.repeat(24)+'.'+'a'.repeat(58);
const RECEIPT={children:'two',business:'cash',privacyConsent:true,insuranceConfirmed:true,delegationConfirmed:true,cashConfirmed:true,consentVersion:'receipt-v1'};
const CUSTOMER={name:'합성 고객',phone:'01012345678',addressBase:'서울시 합성로 1',addressDetail:'101호',mailingBase:'',mailingDetail:'',sameAddress:true,refundBank:'',refundAccount:'',refundHolder:'',refundConsent:false};
const H=value=>crypto.createHash('sha256').update(value).digest('hex');let serial=0,passed=0;
async function bootstrap(){
 const db=new PGlite();await db.waitReady;
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.zc_companies(id uuid primary key,name text not null);
 create table public.zc_members(user_id uuid not null,company_id uuid not null,role text not null,active boolean not null default true,primary key(user_id,company_id));
 create table public.zc_datasets(company_id uuid not null,owner_id uuid not null,dataset text not null,payload jsonb,primary key(company_id,owner_id,dataset));
 create table public.zc_customers(company_id uuid not null,owner_id uuid not null,car_id text not null,payload jsonb not null,has_rrn boolean not null default false,updated_by uuid,updated_at timestamptz not null default clock_timestamp(),primary key(company_id,owner_id,car_id));
 alter table public.zc_customers enable row level security;
 grant select,insert,update,delete on public.zc_customers to authenticated;
 create policy own_customer on public.zc_customers to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
 grant select on public.zc_members to authenticated;`);
 await db.query('insert into public.zc_companies values($1,$2)',[COMPANY,'합성 상사']);
 await db.query('insert into public.zc_members values($1,$2,$3,true),($4,$2,$3,true)',[OWNER,COMPANY,'dealer',OTHER]);
 await db.query('insert into public.zc_datasets values($1,$2,$3,$4::jsonb)',[COMPANY,OWNER,'cars',JSON.stringify([{id:'synthetic-car',ownerId:'cld_'+OWNER.replaceAll('-','').slice(0,18),model:'합성 차량',plate:'12가3456',year:2026,km:1000,color:'흰색',sell:1200,status:'판매중'}])]);
 for(const name of ['202611010001_customer_intake.sql','202611010004_customer_intake_wizard.sql',MIGRATION])await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations',name),'utf8'));
 return db;
}
async function rpc(db,name,args,role='service_role',actor=null){
 assert(/^[a-z_][a-z0-9_]*$/.test(name));assert(['anon','authenticated','service_role'].includes(role));
 const keys=Object.keys(args);assert(keys.every(key=>/^[a-z_][a-z0-9_]*$/.test(key)));
 await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
 try{return(await db.query('select public.'+name+'('+keys.map((key,i)=>key+' => $'+(i+1)).join(',')+') as result',keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]))).rows[0].result;}finally{await db.exec('reset role');}
}
async function verified(db){
 const hash=H('receipt-link-'+(++serial)),created=await rpc(db,'snote_intake_create',{p_car_id:'synthetic-car',p_phone:CUSTOMER.phone,p_token_hash:hash},'authenticated',OWNER);assert.equal(created.ok,true);
 const challenge=crypto.randomUUID(),otp=H('receipt-otp-'+serial),session=H('receipt-session-'+serial);
 assert.equal((await rpc(db,'snote_intake_challenge_v3',{p_token_hash:hash,p_challenge_id:challenge,p_otp_hash:otp,p_phone:CUSTOMER.phone})).ok,true);
 assert.equal((await rpc(db,'snote_intake_delivery',{p_id:created.id,p_kind:'otp',p_challenge_id:challenge,p_status:'sent'})).ok,true);
 assert.equal((await rpc(db,'snote_intake_verify',{p_token_hash:hash,p_challenge_id:challenge,p_otp_hash:otp,p_session_hash:session})).ok,true);
 return{...created,hash,session};
}
const args=(link,receipt=RECEIPT)=>({p_token_hash:link.hash,p_session_hash:link.session,p_customer:CUSTOMER,p_consent_version:'2026-11-01',p_identity_cipher:CIPHER,p_signature:SIGNATURE,p_receipt_details:receipt});
const submit=(db,link,receipt=RECEIPT)=>rpc(db,'snote_intake_submit_v4',args(link,receipt));
const intake=async(db,link)=>(await db.query('select * from public.snote_customer_intake where id=$1',[link.id])).rows[0];
const customer=async db=>(await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[COMPANY,OWNER,'synthetic-car'])).rows[0];
async function check(db,name,fn){await db.exec('truncate public.snote_customer_intake cascade;truncate public.zc_customers;update public.zc_members set active=true;');await fn();passed++;console.log('PASS',name);}
(async()=>{const db=await bootstrap();try{
 await check(db,'migration repeats and retains private table/function permissions',async()=>{
  await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations',MIGRATION),'utf8'));
  for(const role of ['anon','authenticated','service_role']){
   assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,'public.snote_intake_submit_v4(text,text,jsonb,text,text,jsonb,jsonb)','EXECUTE'])).rows[0].allowed,role==='service_role');
   assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,'snote_intake_private.receipt_details(jsonb)','EXECUTE'])).rows[0].allowed,false);
   await db.exec('set role '+role);try{await assert.rejects(()=>db.query('select submission_payload from public.snote_customer_intake'),e=>e.code==='42501');}finally{await db.exec('reset role');}
  }
 });
 await check(db,'receipt and original signature save atomically into submission and new canonical customer',async()=>{
  const link=await verified(db),result=await submit(db,link);assert.equal(result.ok,true);assert.equal(result.canonicalApplied,true);
  const row=await intake(db,link),canonical=await customer(db);
  assert.deepEqual(row.submission_payload.receiptDetails,RECEIPT);assert.deepEqual(canonical.payload.receiptDetails,RECEIPT);
  assert.deepEqual(row.submission_payload.signature,SIGNATURE);assert.deepEqual(canonical.payload.customerSignature,SIGNATURE);
  assert.equal(canonical.payload.intakeSource.requestId,link.id);assert.equal(canonical.payload.customerSignatureSignedAt,row.submission_payload.signedAt);
  const listed=await rpc(db,'snote_intake_list',{p_car_id:'synthetic-car'},'authenticated',OWNER);assert.deepEqual(listed[0].submission.receiptDetails,RECEIPT);
 });
 await check(db,'unchecked flags remain false and unselected choices remain null',async()=>{
  const link=await verified(db),value={children:null,business:null,privacyConsent:false,insuranceConfirmed:false,delegationConfirmed:false,cashConfirmed:false,consentVersion:'receipt-v1'};
  assert.equal((await submit(db,link,value)).ok,true);assert.deepEqual((await intake(db,link)).submission_payload.receiptDetails,value);assert.deepEqual((await customer(db)).payload.receiptDetails,value);
 });
 await check(db,'SQL independently rejects missing, unknown, coerced and invalid receipt data',async()=>{
  const link=await verified(db);
  for(const value of [null,[],{}, {...RECEIPT,children:4},{...RECEIPT,children:'four'},{...RECEIPT,business:'business'},{...RECEIPT,privacyConsent:'true'},{...RECEIPT,insuranceConfirmed:1},{...RECEIPT,cashConfirmed:null},{...RECEIPT,consentVersion:'future'}, {...RECEIPT,arbitrary:true}])assert.equal((await submit(db,link,value)).code,'VALIDATION_ERROR');
  assert.equal((await intake(db,link)).submitted_at,null);assert.equal(await customer(db),undefined);
 });
 await check(db,'identical retry is read-only and changed receipt cannot amend completed consent',async()=>{
  const link=await verified(db);assert.equal((await submit(db,link)).ok,true);const original=await intake(db,link),canonical=await customer(db);
  assert.equal((await submit(db,link)).alreadySubmitted,true);assert.deepEqual(await intake(db,link),original);
  assert.equal((await submit(db,link,{...RECEIPT,privacyConsent:false})).code,'ALREADY_SUBMITTED');assert.deepEqual(await intake(db,link),original);assert.deepEqual(await customer(db),canonical);
 });
 await check(db,'previous v3 intake cannot acquire retroactive receipt consent',async()=>{
  const link=await verified(db),legacy=args(link);delete legacy.p_receipt_details;
  assert.equal((await rpc(db,'snote_intake_submit_v3',legacy)).ok,true);const before=await intake(db,link);
  assert.equal((await submit(db,link)).code,'ALREADY_SUBMITTED');assert.deepEqual(await intake(db,link),before);assert.equal(Object.hasOwn((await customer(db)).payload,'receiptDetails'),false);
 });
 await check(db,'second customer submission stores its own receipt without overwriting existing canonical data',async()=>{
  const first=await verified(db);await submit(db,first);const before=await customer(db),second=await verified(db),value={...RECEIPT,children:'three',business:'invoice',privacyConsent:false};
  const result=await submit(db,second,value);assert.equal(result.ok,true);assert.equal(result.canonicalApplied,false);assert.deepEqual(await customer(db),before);assert.deepEqual((await intake(db,second)).submission_payload.receiptDetails,value);
 });
 await check(db,'expired or wrong session and inactive owner fail before receipt/signature storage',async()=>{
  const link=await verified(db),bad={...args(link),p_session_hash:H('wrong-session')};assert.equal((await rpc(db,'snote_intake_submit_v4',bad)).code,'SESSION_EXPIRED');
  await db.query('update public.zc_members set active=false where user_id=$1',[OWNER]);const result=await submit(db,link);assert.equal(result.ok,false);assert.equal((await intake(db,link)).submitted_at,null);assert.equal(await customer(db),undefined);
 });
 await check(db,'a receipt write failure rolls back intake, encrypted identity, signature and canonical insert',async()=>{
  await db.exec("create function public.receipt_test_failure() returns trigger language plpgsql as $$begin if new.submission_payload ? 'receiptDetails' then raise exception 'synthetic receipt failure';end if;return new;end$$;create trigger receipt_test_fail before update on public.snote_customer_intake for each row execute function public.receipt_test_failure();");
  try{const link=await verified(db);await assert.rejects(()=>submit(db,link),/synthetic receipt failure/);const row=await intake(db,link);assert.equal(row.submitted_at,null);assert.equal(row.submission_payload,null);assert.equal(await customer(db),undefined);}finally{await db.exec('drop trigger receipt_test_fail on public.snote_customer_intake;drop function public.receipt_test_failure();');}
 });
 console.log('TOTAL RECEIPT SQL PASS',passed);
}finally{await db.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
