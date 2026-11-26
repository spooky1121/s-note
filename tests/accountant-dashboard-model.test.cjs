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
