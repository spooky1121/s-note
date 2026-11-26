'use strict';
// The accountant projection contains workflow counts, never financial records.
const assert=require('node:assert/strict'),test=require('node:test');
const model=require('../assets/home-dashboard.js');
const counts={totalCount:10,inventoryCount:7,contractCount:2,monthPurchaseCount:4};

test('accountant workflow counts retain verified zero values and do not mutate the projection',()=>{
 const source=Object.freeze({...counts}),result=model.accountantSummary(source);
 assert.deepEqual(result,counts);assert.notEqual(result,source);assert(Object.isFrozen(result));
 assert.deepEqual(model.accountantSummary({totalCount:0,inventoryCount:0,contractCount:0,monthPurchaseCount:0}),{totalCount:0,inventoryCount:0,contractCount:0,monthPurchaseCount:0});
});

test('incomplete, unsafe and contradictory company counts are rejected before rendering',()=>{
 for(const input of [null,[],{},'10',...Object.keys(counts).flatMap(field=>[
  {...counts,[field]:undefined},{...counts,[field]:-1},{...counts,[field]:1.5},{...counts,[field]:'3'},
  {...counts,[field]:NaN},{...counts,[field]:Infinity},{...counts,[field]:Number.MAX_SAFE_INTEGER+1}
 ]),{...counts,inventoryCount:11},{...counts,contractCount:8},{...counts,monthPurchaseCount:11}]){
  assert.throws(()=>model.accountantSummary(input),/INVALID_ACCOUNTANT_WORK_SUMMARY/);
 }
});

test('the accountant projection never consults financial amounts or customer records',()=>{
 const source={...counts};
 for(const key of ['rows','margin','inventoryCost','inventoryLoan','soldPrice','customers'])Object.defineProperty(source,key,{get(){throw Error('Financial/customer fields must not be read');}});
 const result=model.accountantSummary(source);assert.deepEqual(result,counts);assert.deepEqual(Object.keys(result).sort(),Object.keys(counts).sort());
});

const month='2027-03';
const work=()=>({...counts,inventoryBuyAmount:123456789,monthSaleCount:2,series:[{month:'2027-01',purchases:3,sales:0},{month:'2027-02',purchases:3,sales:1},{month:'2027-03',purchases:4,sales:2}]});
const finance=()=>({limit:200000000,used:35000000});

test('verified accountant dashboard projects company purchase amounts, completed sales and shared financing without changing inputs',()=>{
 const source=work(),funding=finance(),before=JSON.stringify([source,funding]),result=model.accountantDashboard(source,funding,month);
 assert.equal(result.inventoryBuyAmount,123456789);assert.equal(result.inventoryCount,7);assert.equal(result.monthPurchaseCount,4);assert.equal(result.monthSaleCount,2);
 assert.deepEqual(result.financeSummary,{limit:200000000,used:35000000});assert.deepEqual(result.series,source.series);
 assert(Object.isFrozen(result)&&Object.isFrozen(result.financeSummary)&&Object.isFrozen(result.series)&&result.series.every(Object.isFrozen));
 assert.notEqual(result.series,source.series);assert.equal(JSON.stringify([source,funding]),before);
});

test('unverified amounts remain null while verified zero amounts remain zero',()=>{
 const unknown=model.accountantDashboard({...work(),inventoryBuyAmount:null,monthSaleCount:null,series:null},{limit:null,used:null},month);
 assert.equal(unknown.inventoryBuyAmount,null);assert.equal(unknown.monthSaleCount,null);assert.equal(unknown.series,null);assert.deepEqual(unknown.financeSummary,{limit:null,used:null});
 const empty={totalCount:0,inventoryCount:0,contractCount:0,monthPurchaseCount:0,inventoryBuyAmount:0,monthSaleCount:0,series:[{month:'2027-01',purchases:0,sales:0},{month:'2027-02',purchases:0,sales:0},{month:'2027-03',purchases:0,sales:0}]};
 const zero=model.accountantDashboard(empty,{limit:0,used:0},month);assert.equal(zero.inventoryBuyAmount,0);assert.equal(zero.monthSaleCount,0);assert.deepEqual(zero.financeSummary,{limit:0,used:0});
 assert.deepEqual(model.accountantDashboard(work(),{limit:null,used:35000000},month).financeSummary,{limit:null,used:35000000});
});

test('accountant finance amounts retain safe over-limit values and reject malformed or missing amounts',()=>{
 const result=model.accountantDashboard(work(),{limit:1,used:Number.MAX_SAFE_INTEGER},month);assert.equal(result.financeSummary.used,Number.MAX_SAFE_INTEGER);
 for(const bad of [undefined,-1,1.5,'100',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>model.accountantDashboard({...work(),inventoryBuyAmount:bad},finance(),month),/INVALID_ACCOUNTANT_DASHBOARD/);
  assert.throws(()=>model.accountantDashboard(work(),{limit:bad,used:0},month),/INVALID_ACCOUNTANT_DASHBOARD/);
  assert.throws(()=>model.accountantDashboard(work(),{limit:0,used:bad},month),/INVALID_ACCOUNTANT_DASHBOARD/);
 }
 for(const funding of [null,[],{},'finance'])assert.throws(()=>model.accountantDashboard(work(),funding,month),/INVALID_ACCOUNTANT_DASHBOARD/);
});

test('accountant graph months and counts must agree with the verified company and current month',()=>{
 for(const series of [[],work().series.slice(1),[...work().series,work().series[0]],[...work().series].reverse(),work().series.map((row,index)=>({...row,month:index===1?'2027-01':row.month})),work().series.map((row,index)=>({...row,purchases:index===2?3:row.purchases})),work().series.map((row,index)=>({...row,sales:index===2?1:row.sales})),work().series.map((row,index)=>({...row,sales:index===0?4:row.sales})),work().series.map((row,index)=>({...row,purchases:index===0?4:row.purchases}))])assert.throws(()=>model.accountantDashboard({...work(),series},finance(),month),/INVALID_ACCOUNTANT_DASHBOARD/);
 for(const bad of [-1,1.5,'2',undefined,8])assert.throws(()=>model.accountantDashboard({...work(),monthSaleCount:bad},finance(),month),/INVALID_ACCOUNTANT_DASHBOARD/);
 for(const value of ['2027-13','0000-01',null])assert.throws(()=>model.accountantDashboard(work(),finance(),value),/INVALID_ACCOUNTANT_DASHBOARD/);
});

test('accountant business projection does not consult owner profit, raw vehicle or customer data',()=>{
 const source=work();for(const key of ['rows','margin','inventoryCost','inventoryLoan','soldPrice','customers'])Object.defineProperty(source,key,{get(){throw Error('Owner or customer data must not be read');}});
 const result=model.accountantDashboard(source,finance(),month);
 assert.deepEqual(Object.keys(result.series[0]).sort(),['month','purchases','sales']);assert(!Object.hasOwn(result,'margin'));assert(!Object.hasOwn(result,'rows'));
});
