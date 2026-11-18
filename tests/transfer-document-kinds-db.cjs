'use strict';
// Actual Postgres policies, column grants and CAS; synthetic local data only.
// NODE_PATH=/workspace/work/deps/node_modules node tests/transfer-document-kinds-db.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const base=require('./accountant-workspace-db.cjs');
const {COMPANY,FOREIGN,OWNER,ADMIN,ACCOUNTANT,INACTIVE,PEER,FOREIGN_ACCOUNTANT,draft,blank}=base;
const FILE='20261118134644_transfer_document_kinds.sql',SQL=fs.readFileSync(path.join(__dirname,'../supabase/migrations',FILE),'utf8');
const documentNames=['snote_transfer_document_list','snote_transfer_document_read','snote_transfer_document_save'];
async function createDocumentFixture({apply=true}={}){
 const f=await base.createAccountantFixture(),{db,actor,scalar,privileged}=f;
 await actor();const legacy=await f.save({payload:draft({specialTerms:'  기존 매입 문서\n보존  '})});
 await f.save({owner:OWNER,car:'owner-sold',payload:draft({saleAmount:0})});
 const snapshot=()=>privileged(async()=>(await db.query('select * from snote_transfer_private.drafts order by company_id,id')).rows);
 const source=async name=>scalar('select pg_get_functiondef($1::regprocedure) as value',[name]);
 const metadata=async()=>({
  existing:await f.existingMetadata(),
  payloadValidator:await source('snote_transfer_private.valid_payload(jsonb)'),
  guard:await source('snote_transfer_private.guard_draft()'),
  policies:(await db.query("select * from pg_policies where schemaname='snote_transfer_private' order by policyname")).rows,
  grants:(await db.query("select column_name,privilege_type,grantee from information_schema.column_privileges where table_schema='snote_transfer_private' and table_name='drafts' and column_name<>'document_kind' order by column_name,privilege_type,grantee")).rows
 });
 const before=await snapshot(),beforeMetadata=await metadata();
 if(apply)await db.exec(SQL);
 const rpc=async(name,args)=>{const entries=Object.entries(args);return scalar('select public.snote_transfer_document_'+name+'('+entries.map(([key],i)=>'"'+key+'" => $'+(i+1)).join(',')+') as value',entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));};
 const list=(kind='purchase',company=COMPANY)=>rpc('list',{p_expected_company_id:company,p_document_kind:kind});
 const read=(id,kind='purchase',company=COMPANY)=>rpc('read',{p_id:id,p_expected_company_id:company,p_document_kind:kind});
 const save=(options={})=>{const {id=randomUUID(),company=COMPANY,owner=null,car=null,revision=0,payload=draft()}=options;const kind=Object.hasOwn(options,'kind')?options.kind:'purchase';return rpc('save',{p_expected_company_id:company,p_id:id,p_car_owner_id:owner,p_car_id:car,p_expected_revision:revision,p_payload:payload,p_document_kind:kind});};
 return {...f,legacy,before,beforeMetadata,snapshot,source,metadata,documentRpc:rpc,documentList:list,documentRead:read,documentSave:save};
}
async function run(){
 const f=await createDocumentFixture(),{db,scalar,actor,privileged,snapshot,documentList:list,documentRead:read,documentSave:save}=f;
 const deny=(fn,codes=['42501'])=>assert.rejects(fn,error=>codes.includes(error.code));
 const stripKind=rows=>rows.map(({document_kind,...row})=>row);
 let passed=0,failed=0,purchase,sale;
 const test=async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name,error.stack||error);}};
 try{
 await test('existing rows receive purchase metadata without changing payloads, revisions, authors or timestamps',async()=>{
  const rows=await snapshot();assert.deepEqual(stripKind(rows),f.before);assert(rows.every(row=>row.document_kind==='purchase'));
  const current=await f.metadata();assert.deepEqual(current.existing,f.beforeMetadata.existing);assert.deepEqual(current.policies,f.beforeMetadata.policies);assert.deepEqual(current.grants,f.beforeMetadata.grants);assert.equal(current.payloadValidator,f.beforeMetadata.payloadValidator);
  assert.equal(current.guard.replace('new.document_kind is distinct from old.document_kind\n   or ',''),f.beforeMetadata.guard);
 });
 await test('new APIs require kind and remain authenticated-only security invokers with empty search paths',async()=>{
  await privileged(async()=>{const rows=(await db.query("select p.proname,p.prosecdef,p.proconfig,p.pronargdefaults,has_function_privilege('authenticated',p.oid,'EXECUTE') member,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='public' and p.proname=any($1)) or(n.nspname='snote_transfer_private' and p.proname='assert_document_kind')",[documentNames.concat(['snote_transfer_contract_list','snote_transfer_contract_read','snote_transfer_contract_save'])])).rows;
   assert.equal(rows.length,7);for(const row of rows){assert.equal(row.prosecdef,false);assert.equal(row.pronargdefaults,0);assert.equal(row.member,true);assert.equal(row.anon,false);assert.equal(row.service,false);assert(row.proconfig.includes('search_path=""'));}
   assert.equal(await scalar("select relrowsecurity as value from pg_class where oid='snote_transfer_private.drafts'::regclass"),true);
  });await actor();await deny(()=>db.query('select public.snote_transfer_document_list($1)',[COMPANY]),['42883']);
 });
 await test('purchase and sale drafts have separate recent-first lists and kind-scoped reads',async()=>{
  await actor();purchase=await save({kind:'purchase',payload:draft({buyerName:'매입 전용'})});sale=await save({kind:'sale',payload:draft({buyerName:'판매 전용'})});
  for(const record of[purchase,sale]){assert.deepEqual(Object.keys(record).sort(),['carId','carOwnerId','documentKind','id','payload','revision','updatedAt']);assert.equal(Object.keys(record.payload).length,39);assert.equal(record.revision,1);}
  assert.equal(purchase.documentKind,'purchase');assert.equal(sale.documentKind,'sale');assert.equal((await list('sale')).length,1);assert((await list('purchase')).every(row=>row.documentKind==='purchase'));
  assert.deepEqual(await read(sale.id,'sale'),sale);assert.equal(await read(sale.id,'purchase'),null);assert.equal(await read(purchase.id,'sale'),null);assert.equal(await read(randomUUID(),'sale'),null);
  for(const kind of['purchase','sale']){const rows=await list(kind);assert(rows.every((r,i)=>!i||Date.parse(rows[i-1].updatedAt)>=Date.parse(r.updatedAt)));}
 });
 await test('old clients only list, read, insert and update purchase documents',async()=>{
  await actor();assert(!(await f.list()).some(row=>row.id===sale.id));assert.equal(await f.read(sale.id),null);assert.equal((await f.read(purchase.id)).documentKind,'purchase');
  const before=await snapshot();await actor();for(const revision of[0,1])await deny(()=>f.save({id:sale.id,revision,payload:draft({buyerName:'구형 덮어쓰기'})}),['40001']);assert.deepEqual(await snapshot(),before);
  await actor();const inserted=await f.save();assert.equal(inserted.documentKind,'purchase');const updated=await f.save({id:purchase.id,revision:purchase.revision,payload:draft({buyerName:'구형 매입 수정'})});assert.equal(updated.documentKind,'purchase');purchase=updated;
 });
 await test('immutable kind and CAS reject cross-kind reuse, duplicate insert and stale saves atomically',async()=>{
  const before=await snapshot();await actor();for(const[id,kind,revision]of[[sale.id,'purchase',0],[sale.id,'purchase',1],[purchase.id,'sale',0],[purchase.id,'sale',purchase.revision],[sale.id,'sale',0],[sale.id,'sale',2]])await deny(()=>save({id,kind,revision}),['40001']);assert.deepEqual(await snapshot(),before);
  await actor(ADMIN);sale=await save({id:sale.id,kind:'sale',revision:sale.revision,payload:draft({buyerName:'관리자 판매 수정'})});assert.equal(sale.revision,2);await actor(PEER);sale=await save({id:sale.id,kind:'sale',revision:2,payload:draft({buyerName:'동료 경리 수정'})});assert.equal(sale.revision,3);const row=(await snapshot()).find(row=>row.id===sale.id);assert.equal(row.created_by,ACCOUNTANT);assert.equal(row.updated_by,PEER);
 });
 await test('null, empty, padded, cased and unsupported kinds fail on every new API',async()=>{
  const before=await snapshot();await actor();for(const kind of[null,'',' purchase','sale ','PURCHASE','contract','매입']){await deny(()=>list(kind),['22023']);await deny(()=>read(purchase.id,kind),['22023']);await deny(()=>save({kind}),['22023']);}assert.deepEqual(await snapshot(),before);
 });
 await test('real membership protects both kinds from dealers, inactive, anonymous and service callers',async()=>{
  for(const[id,role,claims]of[[OWNER,'authenticated',{}],[INACTIVE,'authenticated',{}],[ACCOUNTANT,'authenticated',{is_anonymous:true}],[ACCOUNTANT,'service_role',{}],[null,'anon',{}]]){await actor(id,role,claims);for(const kind of['purchase','sale']){await deny(()=>list(kind));await deny(()=>read(sale.id,kind));await deny(()=>save({kind}));}}
  await actor(OWNER,'authenticated',{user_metadata:{role:'accountant',company_id:COMPANY}});await deny(()=>list('sale'));assert.equal(await scalar('select count(*)::int as value from snote_transfer_private.drafts'),0);
 });
 await test('foreign-company ids never leak or overwrite; same UUID remains scoped by company',async()=>{
  await actor(FOREIGN_ACCOUNTANT);for(const kind of['purchase','sale']){assert.equal(await read(sale.id,kind,FOREIGN),null);await deny(()=>list(kind,COMPANY));await deny(()=>save({kind,company:COMPANY}));}
  const foreign=await save({id:sale.id,kind:'sale',company:FOREIGN,payload:draft({buyerName:'다른 회사'})});assert.equal(foreign.documentKind,'sale');await actor();assert.equal((await read(sale.id,'sale')).payload.buyerName,'동료 경리 수정');await deny(()=>read(sale.id,'sale',FOREIGN));await deny(()=>list('sale',null));
 });
 await test('column grants and trigger checks prevent kind changes even with valid revisions',async()=>{
  await privileged(async()=>{assert.equal(await scalar("select has_column_privilege('authenticated','snote_transfer_private.drafts','document_kind','INSERT') as value"),true);assert.equal(await scalar("select has_column_privilege('authenticated','snote_transfer_private.drafts','document_kind','UPDATE') as value"),false);});
  const before=await snapshot();await actor();await deny(()=>db.query("update snote_transfer_private.drafts set document_kind='purchase',revision=revision+1 where company_id=$1 and id=$2",[COMPANY,sale.id]));
  await privileged(()=>deny(()=>db.query("update snote_transfer_private.drafts set document_kind='purchase',revision=revision+1 where company_id=$1 and id=$2",[COMPANY,sale.id])));
  await actor();for(const kind of['wrong',null])await deny(()=>db.query('insert into snote_transfer_private.drafts(company_id,id,document_kind,payload) values($1,$2,$3,$4)',[COMPANY,randomUUID(),kind,JSON.stringify(blank())]),[kind===null?'23502':'23514']);assert.deepEqual(await snapshot(),before);
 });
 await test('39-field schema validation is unchanged for both document types',async()=>{
  await actor();for(const kind of['purchase','sale']){const good=await save({kind,payload:draft({specialTerms:'  공백\n\t유지  ',saleAmount:999999999999,mileage:999999999})});assert.equal(good.payload.specialTerms,'  공백\n\t유지  ');for(const payload of[{...blank(),rrn:'FORBIDDEN'},{...blank(),signatureImage:'FORBIDDEN'},draft({sellerName:'줄\n바꿈'}),draft({specialTerms:'가'.repeat(2001)}),draft({saleAmount:0.5}),draft({contractDate:'2025-02-29'}),{...blank(),documentKind:kind}])await deny(()=>save({kind,payload}),['22023']);}
 });
 await test('canonical car checks, immutable author and strict revisions remain active for each kind',async()=>{
  await actor();for(const kind of['purchase','sale']){const linked=await save({kind,owner:OWNER,car:'owner-sold'});assert.equal(linked.carId,'owner-sold');await deny(()=>save({kind,owner:OWNER,car:'foreign-car'}),['22023']);await deny(()=>save({kind,owner:OWNER,car:null}),['22023']);for(const revision of[null,-1,9007199254740991])await deny(()=>save({kind,revision}),['22023']);}
  await privileged(()=>deny(()=>db.query('update snote_transfer_private.drafts set created_by=$1,revision=revision+1 where company_id=$2 and id=$3',[ADMIN,COMPANY,sale.id])));
  await actor();assert.equal(await scalar("select public.zc_can_write($1,'cars',$2) as value",[COMPANY,OWNER]),false);assert.equal(await scalar('select count(*)::int as value from public.zc_customers'),0);
 });
 await test('membership revocation immediately blocks both kinds without changing images or other tenant objects',async()=>{
  await privileged(()=>db.query('update public.zc_members set active=false where user_id=$1',[ACCOUNTANT]));await actor();for(const kind of['purchase','sale']){await deny(()=>list(kind));await deny(()=>save({kind}));}await privileged(()=>db.query('update public.zc_members set active=true where user_id=$1',[ACCOUNTANT]));const current=await f.metadata();assert.deepEqual(current.existing,f.beforeMetadata.existing);assert.deepEqual(current.policies,f.beforeMetadata.policies);assert.equal(current.payloadValidator,f.beforeMetadata.payloadValidator);
 });
 await test('repeated migration is idempotent and preserves all purchase and sale data and revisions',async()=>{
  const before=await snapshot();await db.exec(SQL);assert.deepEqual(await snapshot(),before);await actor();assert.equal((await read(sale.id,'sale')).revision,3);assert.equal(await f.read(sale.id),null);assert.equal((await f.read(f.legacy.id)).documentKind,'purchase');
 });
 await test('transaction rollback restores original functions, schema and unchanged pre-migration drafts',async()=>{
  const rolled=await createDocumentFixture({apply:false});try{const original=await rolled.snapshot();await rolled.db.exec('begin');await rolled.db.exec(SQL.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(await rolled.scalar("select count(*)::int as value from information_schema.columns where table_schema='snote_transfer_private' and table_name='drafts' and column_name='document_kind'"),1);await rolled.db.exec('rollback');assert.deepEqual(await rolled.snapshot(),original);assert.deepEqual(await rolled.metadata(),rolled.beforeMetadata);assert.equal(await rolled.scalar("select to_regprocedure('public.snote_transfer_document_list(uuid,text)') is null as value"),true);}finally{await rolled.db.close();}
 });
 console.log(JSON.stringify({passed,failed}));assert.equal(failed,0);
 }finally{await db.close();}
}
if(require.main===module)run().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={createDocumentFixture,FILE,SQL};
