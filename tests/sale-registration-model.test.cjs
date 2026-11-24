'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../assets/sale-registration-model.js'),money=globalThis.SnoteMoney;
const clone=value=>structuredClone(value);
const fixed=()=>[{id:'commission',label:'수수료',amountWon:100001},{id:'insurance',label:'보험',amountWon:200002},{id:'finance',label:'할부금융',amountWon:300003}];
const car=(patch={})=>({id:'sale-car',moneyUnit:'KRW',status:'판매완료',soldAt:'2026-11-24',soldPrice:23456789,buy:20000000,costs:{repair:12345},unknown:{keep:['untouched']},...patch});
const saved=(patch={})=>{const result=car(patch);result.saleRegistrationIncome=model.create(result,[...fixed(),{id:'custom-stable-id',label:'추가 수입',amountWon:1}]);return result;};

test('creates the three exact fixed rows and custom income without changing input or sale price',()=>{
 const original=car(),input=fixed(),before=clone({original,input}),record=model.create(original,input);
 assert.deepEqual({original,input},before);assert.deepEqual(record,{version:1,moneyUnit:'KRW',carId:original.id,soldAt:original.soldAt,soldPriceWon:23456789,items:input});
 record.items[0].amountWon=999;assert.equal(input[0].amountWon,100001);
 const current={...original,saleRegistrationIncome:model.create(original,input)};assert.equal(model.incomeWon(current),600006);assert.equal(current.soldPrice,23456789);
});

test('legacy wire and native KRW cars read the same income through repeated saves',()=>{
 const original=saved(),wire=money.storeCar(original);assert.equal(wire.soldPrice,2345.6789);assert.equal(wire.saleRegistrationIncome.soldPriceWon,23456789);assert.equal(model.incomeWon(wire),600007);
 let current=wire;for(let i=0;i<20;i++){current=money.storeCar(money.car(JSON.parse(JSON.stringify(current))));assert.equal(current.saleRegistrationIncome.items[3].amountWon,1);assert.equal(model.incomeWon(current),600007);}
 assert.deepEqual(current,wire);assert.deepEqual(model.create(wire,fixed()),model.create(original,fixed()));
});

test('strict create rejects invalid amounts, counts, IDs, labels, fixed rows and sale facts',()=>{
 const rejectRows=rows=>assert.throws(()=>model.create(car(),rows),/수입/);
 for(const value of[-1,0.1,'1',null,NaN,Infinity,1000000000001]){const rows=fixed();rows[0].amountWon=value;rejectRows(rows);}
 for(const mutate of[rows=>rows.pop(),rows=>rows.push({...rows[0]}),rows=>rows[0].label='다른 수수료',rows=>rows[0].id='',rows=>rows[0].id='x'.repeat(101),rows=>rows[0].label='x'.repeat(61),rows=>rows[0].label='\n',rows=>rows[0].extra=true]){const rows=fixed();mutate(rows);rejectRows(rows);}
 const max=[...fixed().map(row=>({...row,amountWon:0})),...Array.from({length:50},(_,i)=>({id:'custom-'+i,label:'추가 '+i,amountWon:1000000000000}))];
 assert.equal(model.incomeWon({...car(),saleRegistrationIncome:model.create(car(),max)}),50000000000000);rejectRows([...max,{id:'too-many',label:'초과',amountWon:0}]);
 for(const patch of[{status:'판매중'},{id:''},{soldAt:'2026-02-30'},{soldAt:'0000-01-01'},{soldPrice:0},{soldPrice:'23456789'},{soldPrice:1.1},{soldPrice:1000000000001}])assert.throws(()=>model.create(car(patch),fixed()),/수입/);
});

test('absent, malformed, unconfirmed and copied records contribute zero',()=>{
 assert.equal(model.incomeWon(car()),0);assert.equal(model.incomeWon(null),0);
 const base=saved();
 for(const patch of[{id:'copy-car'},{status:'판매중'},{status:'계약중'},{soldAt:'2026-11-25'},{soldPrice:23456790}])assert.equal(model.incomeWon({...base,...patch}),0);
 for(const mutate of[r=>delete r.moneyUnit,r=>r.version=2,r=>r.moneyUnit='만원',r=>r.items[0].amountWon=-1,r=>r.items[0].amountWon='100001',r=>r.items.splice(0,1),r=>r.items[0].label='wrong',r=>r.items.push({...r.items[0]}),r=>r.extra='unsupported']){const next=clone(base);mutate(next.saleRegistrationIncome);assert.equal(model.incomeWon(next),0);}
});

test('cancellation clears only optional income and never resurrects it on resale',()=>{
 const before=saved(),cancelled={...before,status:'판매중'};delete cancelled.soldAt;delete cancelled.soldPrice;
 const result=model.prepare(before,cancelled);assert.equal(result.saleRegistrationIncome,undefined);assert.equal(model.incomeWon(result),0);assert.equal(model.incomeWon(before),600007);
 assert.equal(model.incomeWon(model.prepare(result,{...result,status:'판매완료',soldAt:before.soldAt,soldPrice:before.soldPrice})),0);
 const generic=model.prepare(before,{...before,status:'계약중'});assert.equal(generic.saleRegistrationIncome,undefined);assert.equal(generic.soldAt,before.soldAt);assert.equal(generic.soldPrice,before.soldPrice);
});

test('same-sale date/price corrections rebind an unchanged valid record, including legacy wire',()=>{
 const before=saved(),after={...before,soldAt:'2026-11-25',soldPrice:23456790},input=clone({before,after});
 const result=model.prepare(before,after);assert.equal(model.incomeWon(result),600007);assert.equal(result.saleRegistrationIncome.soldAt,after.soldAt);assert.equal(result.saleRegistrationIncome.soldPriceWon,after.soldPrice);assert.deepEqual({before,after},input);
 const legacyBefore=money.storeCar(before),legacyAfter=money.storeCar(after),legacyResult=model.prepare(legacyBefore,legacyAfter);assert.equal(legacyResult.soldPrice,2345.679);assert.equal(legacyResult.saleRegistrationIncome.soldPriceWon,23456790);assert.equal(model.incomeWon(legacyResult),600007);
 const zeros=saved();zeros.saleRegistrationIncome=model.create(zeros,fixed().map(row=>({...row,amountWon:0})));const corrected=model.prepare(zeros,{...zeros,soldPrice:30000000});assert.equal(corrected.saleRegistrationIncome.soldPriceWon,30000000);
});

test('changed/new/invalid records and clones are not silently rebound',()=>{
 const before=saved(),changed={...before,soldPrice:25000000,saleRegistrationIncome:clone(before.saleRegistrationIncome)};changed.saleRegistrationIncome.items[0].amountWon++;
 for(const [old,next]of[[before,changed],[undefined,{...before,soldPrice:25000000}],[{...before,soldPrice:1},{...before,soldPrice:25000000}],[before,{...before,id:'copy-car'}],[before,{...before,saleRegistrationIncome:undefined}],[before,{...before,soldPrice:0}]]){
  const expected=clone(next),result=model.prepare(old,next);assert.deepEqual(result,expected);assert.equal(model.incomeWon(result),0);
 }
 const intentional={...before,soldPrice:25000000};intentional.saleRegistrationIncome=model.create(intentional,[...fixed(),{id:'new-income',label:'새 입력',amountWon:2}]);assert.equal(model.incomeWon(model.prepare(before,intentional)),600008);
});

test('historical cars and unrelated tax-settlement/private/unknown fields remain unchanged and unshared',()=>{
 const historical=car({soldAt:'historical-date',soldPrice:0,incomeSettlement:{type:'snote-income-settlement',privateCipher:'synthetic',document:{cells:{H50:'',D8:20000000}}}}),before=clone(historical),result=model.prepare(historical,historical);
 assert.deepEqual(result,before);assert.equal(Object.hasOwn(result,'saleRegistrationIncome'),false);assert.notEqual(result,historical);assert.notEqual(result.unknown,historical.unknown);assert.notEqual(result.incomeSettlement,historical.incomeSettlement);result.unknown.keep.push('new');assert.deepEqual(historical,before);
 const active=saved({incomeSettlement:clone(historical.incomeSettlement)}),cancelled=model.prepare(active,{...active,status:'판매중'});assert.deepEqual(cancelled.incomeSettlement,historical.incomeSettlement);assert.equal(model.incomeWon(cancelled),0);
});
