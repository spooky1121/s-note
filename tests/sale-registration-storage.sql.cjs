'use strict';
// Actual dataset RPC and RLS in isolated PostgreSQL; no hosted database or credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createFixture,COMPANY,FOREIGN,OWNER,OUTSIDER}=require('./recycle-bin-db.cjs');
const model=require('../assets/sale-registration-model.js'),money=globalThis.SnoteMoney;
const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);
const items=[{id:'commission',label:'수수료',amountWon:12345},{id:'insurance',label:'보험',amountWon:23456},{id:'finance',label:'할부금융',amountWon:34567},{id:'extra-1',label:'합성 추가수익',amountWon:5637}];
(async()=>{
 const db=await createFixture();
 const historical={id:'historical-unchanged',ownerId:alias(OWNER),status:'판매완료',soldAt:'2026-02-30',soldPrice:0,purchaseAt:'2026-11-10'};
 const car={id:'sale-registration-synthetic',ownerId:alias(OWNER),moneyUnit:'KRW',status:'판매완료',buy:10000001,sell:12000004,soldPrice:12000004,purchaseAt:'2026-11-01',soldAt:'2026-11-24',inventoryLoan:0,repairItems:[{memo:'합성 추가비용',amount:125001}],costs:{repair:125001}};
 car.saleRegistrationIncome=model.create(car,items);
 const actor=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const state=async()=>{await db.exec('reset role');return(await db.query("select payload,revision from zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER])).rows[0];};
 const save=async(rows,revision,who=OWNER,company=COMPANY)=>{await actor(who);return db.query("select public.zc_write_dataset($1,'cars',$2,$3,$4::jsonb)",[company,OWNER,revision,JSON.stringify(rows)]);};
 try{
  // Seed an unchanged historical record before adding the sale-validation trigger.
  await db.query("insert into zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values($1,$2,'cars',$3,1,$2)",[COMPANY,OWNER,JSON.stringify([historical])]);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261106113557_scoped_recycle_bin.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261122052042_sale_completion_validation.sql'),'utf8'));
  await save([historical,money.storeCar(car)],1);let stored=await state();assert.equal(stored.revision,2);assert.deepEqual(stored.payload[0],historical);
  assert.equal(stored.payload[1].buy,1000.0001);assert.equal(stored.payload[1].soldPrice,1200.0004);assert.equal(stored.payload[1].repairItems[0].amount,12.5001);
  assert.deepEqual(stored.payload[1].saleRegistrationIncome,car.saleRegistrationIncome);assert.equal(model.incomeWon(stored.payload[1]),76005);
  await assert.rejects(()=>save(stored.payload,1),/conflict|revision|40001/i);assert.deepEqual(await state(),stored);
  await assert.rejects(()=>save(stored.payload,2,OUTSIDER),error=>error.code==='P0001'&&error.message==='저장 권한이 없습니다');assert.deepEqual(await state(),stored);
  await assert.rejects(()=>save(stored.payload,2,OWNER,FOREIGN),error=>error.code==='P0001'&&error.message==='저장 권한이 없습니다');assert.deepEqual(await state(),stored);
  const corrected=model.prepare(money.car(stored.payload[1]),{...money.car(stored.payload[1]),soldPrice:13000005,soldAt:'2026-11-25'});
  await save([historical,money.storeCar(corrected)],2);stored=await state();assert.equal(model.incomeWon(stored.payload[1]),76005);assert.equal(stored.payload[1].saleRegistrationIncome.soldPriceWon,13000005);
  const active=model.prepare(money.car(stored.payload[1]),{...money.car(stored.payload[1]),status:'판매중'});
  await save([historical,money.storeCar(active)],3);stored=await state();assert.equal(Object.hasOwn(stored.payload[1],'saleRegistrationIncome'),false);assert.equal(model.incomeWon(stored.payload[1]),0);assert.deepEqual(stored.payload[0],historical);
  console.log('PASS isolated sale registration storage: won precision, nested income, sale correction, cancellation, historical preservation, CAS and tenant permissions');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
