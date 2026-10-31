'use strict';
// Isolated PostgreSQL regression: fake accounts/data only, no HTTP or production DB.
// Install this test dependency outside the static Pages checkout:
//   npm install --prefix /tmp/snote-database-tests --no-save --no-audit --no-fund @electric-sql/pglite@0.5.14
//   NODE_PATH=/tmp/snote-database-tests/node_modules node tests/customer-intake-rrn.sql.cjs
// A single PGlite connection verifies state/permissions/rollback, not multi-session lock contention.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const MIGRATIONS = path.resolve(__dirname, '..', 'supabase', 'migrations');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAR = {id:'test-car-1',model:'테스트 차량 1',plate:'000가0001',year:2026,km:1000,color:'흰색',sell:1200,status:'판매중'};

async function resetMembers(db) {
  await db.exec('delete from public.zc_members');
  await db.query('insert into public.zc_members values($1,$2,$3,true),($4,$5,$3,true),($6,$2,$7,true)',
    [ACTOR,COMPANY,'dealer',OTHER,OTHER_COMPANY,PEER,'admin']);
}
async function bootstrap() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table public.zc_companies(id uuid primary key,name text not null,rrn_enabled boolean not null default false);
    create table public.zc_members(user_id uuid not null,company_id uuid not null,role text not null,active boolean not null default true,primary key(user_id,company_id));
    create table public.zc_datasets(company_id uuid not null,owner_id uuid not null,dataset text not null,payload jsonb,primary key(company_id,owner_id,dataset));
  `);
  await db.query('insert into public.zc_companies(id,name) values($1,$2),($3,$4)',
    [COMPANY,'검증용 상사',OTHER_COMPANY,'다른 검증용 상사']);
  await resetMembers(db);
  await db.query('insert into public.zc_datasets values($1,$2,$3,$4::jsonb),($5,$6,$3,$4::jsonb)',
    [COMPANY,ACTOR,'cars',JSON.stringify([CAR]),OTHER_COMPANY,OTHER]);
  return db;
}
async function as(db,role,actor,operation) {
  assert(['anon','authenticated','service_role'].includes(role));
  await db.exec('set role '+role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
  try { return await operation(); } finally { await db.exec('reset role'); }
}
async function rpc(db,role,actor,name,args={}) {
  assert(/^[a-z_][a-z0-9_]*$/.test(name));
  const keys=Object.keys(args);
  assert(keys.every(key=>/^[a-z_][a-z0-9_]*$/.test(key)));
  const params=keys.map((key,index)=>`${key} => $${index+1}`).join(',');
  const values=keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);
  return as(db,role,actor,async()=>
    (await db.query(`select public.${name}(${params}) as result`,values)).rows[0].result);
}

const PEER='33333333-3333-4333-8333-333333333333';
const H=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const CIPHER='v1.'+'1'.repeat(24)+'.'+'a'.repeat(58);const OTHER_CIPHER='v1.'+'2'.repeat(24)+'.'+'b'.repeat(58);
const CUSTOMER={name:'검증용 고객',addressBase:'테스트로 1',addressDetail:'101호',mailingBase:'',mailingDetail:'',sameAddress:true,refundBank:'',refundAccount:'',refundHolder:'',refundConsent:false};
let db,serial=0,passed=0;const results=[];
const call=(name,args,role='service_role',actor=null)=>rpc(db,role,actor,name,args);
const row=async link=>(await db.query('select * from public.snote_customer_intake where id=$1',[link.id])).rows[0];
async function create(){const hash=H('rrn-link-'+(++serial));const r=await call('snote_intake_create',{p_car_id:'test-car-1',p_phone:'01012345678',p_token_hash:hash},'authenticated',ACTOR);assert.equal(r.ok,true,JSON.stringify(r));return {...r,hash}}
async function verified(){const link=await create();const challenge=crypto.randomUUID(),otp=H('otp-'+(++serial)),session=H('session-'+(++serial));assert.equal((await call('snote_intake_challenge',{p_token_hash:link.hash,p_challenge_id:challenge,p_otp_hash:otp})).ok,true);assert.equal((await call('snote_intake_delivery',{p_id:link.id,p_kind:'otp',p_challenge_id:challenge,p_status:'sent'})).ok,true);assert.equal((await call('snote_intake_verify',{p_token_hash:link.hash,p_challenge_id:challenge,p_otp_hash:otp,p_session_hash:session})).ok,true);return {...link,session}}
const submit=(link,cipher=CIPHER,notice='2026-11-01-r1',customer=CUSTOMER)=>call('snote_intake_submit_v2',{p_token_hash:link.hash,p_session_hash:link.session,p_customer:customer,p_consent_version:'2026-11-01',p_rrn_cipher:cipher,p_rrn_notice_version:notice});
const legacySubmit=link=>call('snote_intake_submit',{p_token_hash:link.hash,p_session_hash:link.session,p_customer:CUSTOMER,p_consent_version:'2026-11-01'});
const access=(link,actor=ACTOR)=>call('snote_intake_rrn_access',{p_id:link.id},'authenticated',actor);
const enabled=value=>db.query('update public.zc_companies set rrn_enabled=$2 where id=$1',[COMPANY,value]);
async function fresh(){await db.exec('truncate public.snote_customer_intake cascade');await enabled(false);await resetMembers(db);await db.query("update public.zc_datasets set payload=$1::jsonb where dataset='cars'",[JSON.stringify([CAR])]);}
async function test(name,fn){await fresh();try{await fn();passed++;results.push({name,ok:true});console.log('PASS',name)}catch(error){results.push({name,ok:false,error:error.message});console.error('FAIL',name,error.name,error.message);process.exitCode=1}}
(async()=>{db=await bootstrap();try{
await db.exec(fs.readFileSync(path.join(MIGRATIONS,'202611010001_customer_intake.sql'),'utf8'));
const sql=fs.readFileSync(path.join(MIGRATIONS,'202611010003_customer_intake_rrn.sql'),'utf8');await db.exec(sql);await db.exec(sql);console.log('PASS 0003 migration executes and repeats');
await test('new RPC grants are exact; sensitive columns remain inaccessible directly',async()=>{
 for(const [name,signature,allowed]of[['snote_intake_view_v2','text','service_role'],['snote_intake_submit_v2','text,text,jsonb,text,text,text','service_role'],['snote_intake_rrn_access','uuid','authenticated']])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',[role,`public.${name}(${signature})`,'EXECUTE'])).rows[0].allowed,role===allowed);
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(()=>as(db,role,ACTOR,()=>db.query('select rrn_cipher from public.snote_customer_intake')),e=>e.code==='42501');
});
await test('legacy four-arg submit and cipher-null v2 still work when collection disabled',async()=>{
 const a=await verified();assert.equal((await legacySubmit(a)).ok,true);assert.equal((await row(a)).rrn_cipher,null);
 const b=await verified();assert.equal((await submit(b,null,null)).ok,true);assert.equal((await row(b)).rrn_cipher,null);
 assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='snote_intake_submit' and p.pronargs=4")).rows[0].n,1);
});
await test('view_v2 reports current company gate without exposing sensitive data',async()=>{
 const link=await create();let info=await call('snote_intake_view_v2',{p_token_hash:link.hash});assert.equal(info.rrnEnabled,false);await enabled(true);info=await call('snote_intake_view_v2',{p_token_hash:link.hash});assert.equal(info.rrnEnabled,true);assert(!JSON.stringify(info).includes('rrnCipher'));assert(!JSON.stringify(info).includes(link.hash));
});
await test('disabled collection rejects ciphertext before ordinary submission commits',async()=>{
 const link=await verified();assert.equal((await submit(link)).code,'RRN_NOT_AVAILABLE');const saved=await row(link);assert.equal(saved.submitted_at,null);assert.equal(saved.submission_payload,null);assert.equal(saved.rrn_cipher,null);assert.equal(saved.rrn_notice_version,null);
 await enabled(true);assert.equal((await submit(link)).ok,true);
});
await test('malformed ciphertext and wrong/missing notice leave all submission fields untouched',async()=>{
 await enabled(true);const link=await verified();for(const cipher of ['', '9001011234567', 'v1.'+'1'.repeat(23)+'.'+'a'.repeat(58),CIPHER.toUpperCase()])assert.equal((await submit(link,cipher)).code,'VALIDATION_ERROR');
 for(const notice of [null,'wrong'])assert.equal((await submit(link,CIPHER,notice)).code,'VALIDATION_ERROR');
 assert.equal((await submit(link,null,'2026-11-01-r1')).code,'VALIDATION_ERROR');const saved=await row(link);assert.equal(saved.submitted_at,null);assert.equal(saved.submission_payload,null);assert.equal(saved.rrn_cipher,null);
});
await test('invalid session and forbidden plaintext customer fields cannot partially commit',async()=>{
 await enabled(true);const link=await verified();assert.equal((await submit({...link,session:H('wrong')})).code,'SESSION_EXPIRED');assert.equal((await submit(link,CIPHER,'2026-11-01-r1',{...CUSTOMER,rrn:'9001011234567'})).code,'VALIDATION_ERROR');assert.equal((await row(link)).submitted_at,null);assert.equal((await row(link)).rrn_cipher,null);
});
await test('valid submission stores only ciphertext outside ordinary JSON',async()=>{
 await enabled(true);const link=await verified();assert.equal((await submit(link)).ok,true);const saved=await row(link);assert.equal(saved.rrn_cipher,CIPHER);assert.equal(saved.rrn_notice_version,'2026-11-01-r1');assert.equal(new Date(saved.rrn_collected_at).getTime(),new Date(saved.submitted_at).getTime());assert.equal(Object.keys(saved.submission_payload).some(k=>/rrn|resident|cipher/i.test(k)),false);
 const info=await call('snote_intake_view_v2',{p_token_hash:link.hash});assert.deepEqual(Object.keys(info).sort(),['expiresAt','ok','status']);
});
await test('cipher UPDATE exception rolls ordinary submission back atomically',async()=>{
 await enabled(true);const link=await verified();await db.exec("create function public.test_reject_rrn_update() returns trigger language plpgsql as $$begin raise exception 'test-only storage failure';end$$;create trigger test_reject_rrn_update before update of rrn_cipher on public.snote_customer_intake for each row execute function public.test_reject_rrn_update();");
 try{await assert.rejects(()=>submit(link),e=>e.code==='P0001');const saved=await row(link);assert.equal(saved.submitted_at,null);assert.equal(saved.submission_payload,null);assert.equal(saved.rrn_cipher,null)}finally{await db.exec('drop trigger test_reject_rrn_update on public.snote_customer_intake;drop function public.test_reject_rrn_update()')}
 assert.equal((await submit(link)).ok,true);
});
await test('same-session retry cannot replace ciphertext or add it after legacy completion',async()=>{
 await enabled(true);const link=await verified();assert.equal((await submit(link)).ok,true);const before=await row(link);const retry=await submit(link,OTHER_CIPHER);assert.equal(retry.alreadySubmitted,true);const after=await row(link);assert.equal(after.rrn_cipher,before.rrn_cipher);assert.equal(new Date(after.rrn_collected_at).getTime(),new Date(before.rrn_collected_at).getTime());
 const legacy=await verified();assert.equal((await legacySubmit(legacy)).ok,true);assert.equal((await submit(legacy)).alreadySubmitted,true);assert.equal((await row(legacy)).rrn_cipher,null);
});
await test('list exposes only hasRrn and obeys current gate',async()=>{
 await enabled(true);const link=await verified();await submit(link);let list=await call('snote_intake_list',{p_car_id:'test-car-1'},'authenticated',ACTOR);assert.equal(list[0].hasRrn,true);assert(!JSON.stringify(list).includes(CIPHER));assert(!JSON.stringify(list).includes(link.hash));assert(!JSON.stringify(list).includes('rrnCipher'));
 await enabled(false);list=await call('snote_intake_list',{p_car_id:'test-car-1'},'authenticated',ACTOR);assert.equal(list[0].hasRrn,false);
});
await test('authorized access returns exactly cipher+token binding and records access metadata',async()=>{
 await enabled(true);const link=await verified();await submit(link);const result=await access(link);assert.deepEqual(Object.keys(result).sort(),['id','ok','rrnCipher','tokenHash']);assert.equal(result.rrnCipher,CIPHER);assert.equal(result.tokenHash,link.hash);let saved=await row(link);assert.equal(saved.rrn_access_count,1);assert(saved.rrn_last_accessed_at);await access(link);saved=await row(link);assert.equal(saved.rrn_access_count,2);
});
await test('other owner/company/admin or missing identity cannot read ciphertext',async()=>{
 await enabled(true);const link=await verified();await submit(link);for(const actor of [OTHER,PEER,null]){const result=await access(link,actor);assert.equal(result.code,'RRN_NOT_AVAILABLE');assert.equal(Object.hasOwn(result,'rrnCipher'),false)}assert.equal((await row(link)).rrn_access_count,0);
});
await test('inactive actor, changed membership, removed car and disabled gate deny access',async()=>{
 await enabled(true);const link=await verified();await submit(link);
 await db.query('update public.zc_members set active=false where user_id=$1',[ACTOR]);assert.equal((await access(link)).code,'RRN_NOT_AVAILABLE');await db.query('update public.zc_members set active=true where user_id=$1',[ACTOR]);
 await db.query("update public.zc_members set role='accountant' where user_id=$1",[ACTOR]);assert.equal((await access(link)).code,'RRN_NOT_AVAILABLE');await db.query("update public.zc_members set role='dealer',company_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where user_id=$1",[ACTOR]);assert.equal((await access(link)).code,'RRN_NOT_AVAILABLE');await db.query('update public.zc_members set company_id=$2 where user_id=$1',[ACTOR,COMPANY]);
 const snapshot=(await db.query("select payload from public.zc_datasets where owner_id=$1 and dataset='cars'",[ACTOR])).rows[0].payload;await db.query("update public.zc_datasets set payload='[]'::jsonb where owner_id=$1 and dataset='cars'",[ACTOR]);assert.equal((await access(link)).code,'RRN_NOT_AVAILABLE');await db.query("update public.zc_datasets set payload=$2::jsonb where owner_id=$1 and dataset='cars'",[ACTOR,JSON.stringify(snapshot)]);
 await enabled(false);assert.equal((await access(link)).code,'RRN_NOT_AVAILABLE');assert.equal((await row(link)).rrn_access_count,0);
});
await test('revoke and 30-day retention deny access without relying on cron',async()=>{
 await enabled(true);const revoked=await verified();await submit(revoked);await call('snote_intake_revoke',{p_id:revoked.id},'authenticated',ACTOR);assert.equal((await access(revoked)).code,'RRN_NOT_AVAILABLE');
 const old=await verified();await submit(old);await db.query("update public.snote_customer_intake set submitted_at=clock_timestamp()-interval '31 days' where id=$1",[old.id]);assert.equal((await access(old)).code,'RRN_NOT_AVAILABLE');const list=await call('snote_intake_list',{p_car_id:'test-car-1'},'authenticated',ACTOR);assert.equal(list.some(r=>r.id===old.id),false);assert.equal((await row(old)).rrn_access_count,0);assert.equal(await call('snote_intake_purge',{}),1);assert.equal(await row(old),undefined);
});
await test('database constraint rejects incomplete or plaintext-like storage despite NULL values',async()=>{
 const link=await verified();for(const [cipher,collected,notice]of [[CIPHER,null,null],['9001011234567',new Date().toISOString(),'2026-11-01-r1'],[null,new Date().toISOString(),null]])await assert.rejects(()=>db.query('update public.snote_customer_intake set rrn_cipher=$2,rrn_collected_at=$3,rrn_notice_version=$4 where id=$1',[link.id,cipher,collected,notice]),e=>e.code==='23514');assert.equal((await row(link)).rrn_cipher,null);
});
console.log(`RESULT ${passed}/${results.length} RRN scenarios passed`);
}finally{await db.close()}})().catch(error=>{console.error(error.name,error.message);process.exitCode=1});
