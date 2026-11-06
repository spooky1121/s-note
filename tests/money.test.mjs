import test from 'node:test';import assert from 'node:assert/strict';import '../assets/money.js';import '../assets/inventory-interest.js';
const M=globalThis.SnoteMoney;
test('legacy vehicle fields become integer won once; repeated read/save never multiplies balances',()=>{
 const legacy={id:'money-test',buy:1000,sell:1200.5,soldPrice:null,inventoryLoan:500,costs:{bodywork:1.2,inventoryInterest:5.0959,repair:99},repairItems:[{memo:'수리',amount:2.3}],year:2026,km:10000,plate:'12가3456',contractData:{'ct-total-price':'12,005,000'},unknown:{amount:7}};
 let current=M.car(legacy);assert.equal(current.buy,10000000);assert.equal(current.sell,12005000);assert.equal(current.costs.inventoryInterest,50959);assert.equal(current.repairItems[0].amount,23000);assert.equal(M.car(current),current);
 for(let i=0;i<20;i++){const wire=M.storeCar(current);assert.deepEqual(wire,legacy);current=M.car(JSON.parse(JSON.stringify(wire)));assert.equal(current.buy,10000000);}
 assert.equal(current.year,2026);assert.deepEqual(current.contractData,legacy.contractData);assert.deepEqual(current.unknown,legacy.unknown);
});
test('one-won edits persist with legacy wire precision, without changing other cars or native-won documents',()=>{
 const original={buy:1000,costs:{bodywork:1},repairItems:[]},current=M.car(original);current.buy=10000001;current.costs.bodywork=1;
 const wire=M.storeCar(current);assert.equal(wire.buy,1000.0001);assert.equal(wire.costs.bodywork,0.0001);assert.equal(M.car(wire).buy,10000001);assert.equal(original.buy,1000);
 const snap={...current,inventoryInterestSnapshot:{version:1,principalWon:10000001,amountWon:50959}};assert.equal(M.storeCar(snap).inventoryInterestSnapshot.principalManwon,1000.0001);assert.equal(M.storeCar(snap).inventoryInterestSnapshot.amountWon,50959);
});
test('finance ledger principal converts at its boundary; rates and native-won ledgers stay unscaled',()=>{
 const old={loan:123.4,lender:'검증금융',annualRate:6,other:7},won=M.finance(old);assert.equal(won.loan,1234000);assert.equal(won.annualRate,6);assert.equal(M.finance(won),won);assert.deepEqual(M.storeFinance(won),old);
 assert.equal(M.toWon('0.00005'),1);assert.equal(M.toWon('-0.00005'),-1);assert.equal(M.toWon('1e-4'),1);assert.equal(M.toWon('bad'),'bad');assert.equal(M.toWon(null),null);
});
test('old fractional repair aggregates retain their whole-won total on conversion',()=>{const car=M.car({repairItems:[{amount:.000025},{amount:.000025}]});assert.equal(car.repairItems.reduce((n,r)=>n+r.amount,0),1);assert(car.repairItems.every(r=>Number.isSafeInteger(r.amount)));});
test('performance inspection costs preserve integer-won precision and old datasets on repeated wire round trips',()=>{
 const old={id:'inspection-test',buy:1000,costs:{bodywork:1,performanceInspection:12.3456,unknown:7},untouched:{memo:'keep'}};
 let car=M.car(old);assert.equal(car.costs.performanceInspection,123456);assert.deepEqual(M.storeCar(car),old);
 for(const amount of [0,1,123456,1000000000000]){car.costs.performanceInspection=amount;for(let i=0;i<10;i++){car=M.car(JSON.parse(JSON.stringify(M.storeCar(car))));assert.equal(car.costs.performanceInspection,amount);}assert.equal(car.costs.bodywork,10000);assert.equal(car.costs.unknown,7);assert.deepEqual(car.untouched,old.untouched);}
 const absent={buy:1000,costs:{bodywork:1}};assert.equal(M.car(absent).costs.performanceInspection,undefined);assert.deepEqual(M.storeCar(M.car(absent)),absent);
});
test('legacy and won principals give exactly the same daily interest, including saved historical rates',()=>{
 const old={inventoryLoan:1000,inventoryLender:'검증금융',purchaseAt:'2026-01-01',soldAt:'2026-02-01',status:'판매완료'},rates=[['검증금융',150000,6]],won=M.car(old);
 assert.equal(SnoteInventoryInterest.calculate(won,rates).amountWon,50959);assert.deepEqual(SnoteInventoryInterest.calculate(won,rates),SnoteInventoryInterest.calculate(old,rates));
 won.inventoryInterestSnapshot=SnoteInventoryInterest.snapshot(won,rates);const stored=M.storeCar(won);assert.equal(SnoteInventoryInterest.calculate(M.car(stored),[['검증금융',150000,12]]).amountWon,50959);
});
