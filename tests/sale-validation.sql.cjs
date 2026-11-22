'use strict';
// Isolated PostgreSQL with the repository's real dataset RPC and RLS baseline.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createFixture,COMPANY,FOREIGN,OWNER,UPLOADER,ADMIN,OUTSIDER,ACCOUNTANT}=require('./recycle-bin-db.cjs');
(async()=>{
 const db=await createFixture();let cases=0;
 const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);
 const historical={id:'legacy-sale',ownerId:alias(OWNER),status:'판매완료',soldAt:'2026-02-30',soldPrice:0,purchaseAt:'2026-11-10'};
 const active={id:'new-sale',ownerId:alias(OWNER),status:'계약중',purchaseAt:'2026-11-10',inventoryLoan:350};
 const valid={...active,status:'판매완료',soldAt:'2026-11-22',soldPrice:2500};
 const actor=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const raw=async fn=>{await db.exec('reset role');return fn();};
 const state=async()=>raw(async()=>(await db.query("select payload,revision from zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER])).rows[0]);
 const save=async(payload,by=OWNER,company=COMPANY,owner=OWNER,expected)=>{const row=await state();await actor(by);return db.query("select public.zc_write_dataset($1,'cars',$2,$3,$4::jsonb) as revision",[company,owner,expected??row.revision,JSON.stringify(payload)]);};
 const reject=async(fn,pattern)=>{await assert.rejects(fn,e=>pattern.test(e.message));cases++;};
 try{
  await db.query("insert into zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values($1,$2,'cars',$3,1,$2)",[COMPANY,OWNER,JSON.stringify([historical,active])]);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261106113557_scoped_recycle_bin.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261122052042_sale_completion_validation.sql'),'utf8'));
  const invalid=['','2026-02-29','2026-04-31','0000-01-01','2026-11-09'];
  for(const soldAt of invalid){const before=await state();await reject(()=>save([historical,{...valid,soldAt}]),/SALE_DATE/);assert.deepEqual(await state(),before);}
  for(const soldPrice of [null,0,-1,'2500',0.00001,100000001])await reject(()=>save([historical,{...valid,soldPrice}]),/SALE_PRICE/);
  await save([{...historical,extra:'Keep original historical sale'},valid]);cases++;
  let row=await state();assert.equal(row.payload[0].soldAt,historical.soldAt);assert.equal(row.payload[0].soldPrice,0);assert.equal(row.payload[1].inventoryLoan,350);
  await reject(()=>save([{...historical,soldPrice:3000},valid]),/SALE_DATE/);
  await reject(()=>save([historical,{...valid,soldAt:'2026-11-09'}]),/SALE_DATE_BEFORE_PURCHASE/);
  await save([historical,{...valid,status:'판매중'}]);cases++;
  await reject(()=>save([historical,{...valid,soldPrice:null}]),/SALE_PRICE_REQUIRED/);
  await save([historical,{...valid,soldPrice:2700}]);cases++;
  for(const who of [UPLOADER,OUTSIDER,ACCOUNTANT])await reject(()=>save([historical,valid],who),/FORBIDDEN|permission|not allowed|권한/i);
  await reject(()=>save([historical,valid],OWNER,FOREIGN,OWNER),/FORBIDDEN|permission|not allowed|권한/i);
  row=await state();await reject(()=>save([historical,valid],OWNER,COMPANY,OWNER,row.revision-1),/CONFLICT/);
  await save([historical,{...valid,soldPrice:2800}],ADMIN);cases++;
  row=await state();await actor(OWNER);
  const archived=(await db.query('select public.snote_recycle_trash_vehicle($1,$2,$3,$4,0,$5) as entry',[COMPANY,OWNER,historical.id,row.revision,randomUUID()])).rows[0].entry;
  await reject(()=>save([{...historical,soldPrice:3000},valid]),/CAR_IN_TRASH/);
  // Even a server-side internal flag cannot authorize a changed archived snapshot.
  await raw(()=>db.query("select set_config('snote.recycle_internal','1',false)"));
  await reject(()=>save([{...historical,soldPrice:3000},valid]),/SALE_DATE/);
  await raw(()=>db.query("select set_config('snote.recycle_internal','',false)"));
  await actor(OWNER);await db.query('select public.snote_recycle_restore($1,$2)',[COMPANY,archived.id]);cases++;
  row=await state();assert.deepEqual(row.payload.find(c=>c.id===historical.id),historical);
  const helper=(await raw(()=>db.query("select prosecdef,proconfig,has_function_privilege('authenticated','snote_private.validate_sale_completion()','execute') as callable from pg_proc where oid='snote_private.validate_sale_completion()'::regprocedure"))).rows[0];assert.equal(helper.prosecdef,false);assert.equal(helper.callable,false);cases++;
  console.log('PASS '+cases+' PostgreSQL sale-date/actual-price/history/resale/authorization/CAS cases; no hosted database touched');
 }finally{await db.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
