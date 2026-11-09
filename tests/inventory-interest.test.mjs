import test from 'node:test';import assert from 'node:assert/strict';
import '../assets/inventory-interest.js';
import {createSource,createDocument,calculate} from '../assets/income-settlement-model.js';
const I=globalThis.SnoteInventoryInterest,rates=[['검증금융',100000,6]];
const car=(extra={})=>({id:'interest-test',status:'판매중',purchaseAt:'2026-01-01',inventoryLoan:1000,inventoryLender:'검증금융',buy:1000,soldPrice:1500,...extra});
test('daily interest rounds once to won, respects elapsed calendar days and leap day',()=>{
 assert.equal(I.calculate(car(),rates,{today:'2026-02-01'}).amountWon,50959);
 assert.equal(I.calculate(car(),rates,{today:'2026-01-01'}).amountWon,0);
 assert.equal(I.calculate(car({purchaseAt:'2024-02-28'}),rates,{today:'2024-03-01'}).days,2);
 assert.equal(I.calculate(car(),rates,{today:'2027-01-01'}).amountWon,600000);
});
test('explicit inventory start date changes every daily interest calculation without changing the purchase date',()=>{
 const value=car({inventoryStartedAt:'2026-01-15'}),before=JSON.stringify(value),result=I.calculate(value,rates,{today:'2026-02-01'});
 assert.equal(result.start,'2026-01-15');assert.equal(result.days,17);assert.equal(result.amountWon,27945);assert.equal(result.annualRate,6);assert.equal(value.purchaseAt,'2026-01-01');assert.equal(JSON.stringify(value),before);
 assert.equal(I.calculate({...value,moneyUnit:'KRW',inventoryLoan:10000000},rates,{today:'2026-02-01'}).amountWon,result.amountWon);
 assert.equal(I.calculate({...value,inventoryStartedAt:'2026-02-01'},rates,{today:'2026-02-01'}).amountWon,0);
 assert.equal(I.calculate({...value,inventoryStartedAt:'2024-02-29'},rates,{today:'2024-03-01'}).days,1);
});
test('only absent inventory start dates fall back to validated legacy purchase dates',()=>{
 assert.equal(I.startDate(car()),'2026-01-01');assert.equal(I.startDate(car({purchaseAt:'2026.1.2'})),'2026-01-02');
 assert.equal(I.calculate(car({purchaseAt:'2026/1/2'}),rates,{today:'2026-02-01'}).days,30);
 for(const inventoryStartedAt of ['',null,undefined,0,{},'2026-1-15','2026/01/15','2026-02-30','2025-02-29','1899-12-31','2026-01-15T00:00:00Z']){
  assert.equal(I.startDate(car({inventoryStartedAt})),'' );
  assert.equal(I.calculate(car({inventoryStartedAt}),rates,{today:'2026-02-01'}).ready,false);
  assert.equal(I.calculate(car({inventoryLoan:0,inventoryStartedAt}),rates,{today:'2026-02-01'}).ready,false);
 }
 assert.equal(I.calculate(car({inventoryStartedAt:'2026-02-02'}),rates,{today:'2026-02-01'}).ready,false);
 assert.equal(I.calculate(car({purchaseAt:'invalid',inventoryStartedAt:'2026-01-15'}),rates,{today:'2026-02-01'}).amountWon,27945);
});
test('inventory interest uses the configured corresponding lender rate and retains explicit zero APR',()=>{
 const value=car({inventoryStartedAt:'2026-01-15'}),lenders=[['다른금융',100000,99],...rates];
 assert.equal(I.calculate(value,lenders,{today:'2026-02-01'}).annualRate,6);
 assert.equal(I.calculate(value,[['검증금융',100000,0]],{today:'2026-02-01'}).amountWon,0);
 assert.equal(I.calculate({...value,inventoryLender:'없는금융'},lenders,{today:'2026-02-01'}).ready,false);
});
test('default interest end date rolls at Seoul midnight rather than UTC midnight',()=>{
 const RealDate=globalThis.Date;let instant='2026-01-01T14:59:59.999Z';
 try{
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return new RealDate(instant).getTime();}};
  const value=car({inventoryStartedAt:'2026-01-01'});assert.equal(I.today(),'2026-01-01');assert.equal(I.calculate(value,rates).amountWon,0);
  instant='2026-01-01T15:00:00.000Z';assert.equal(I.today(),'2026-01-02');assert.equal(I.calculate(value,rates).days,1);assert.equal(I.calculate(value,rates).amountWon,1644);
 }finally{globalThis.Date=RealDate;}
});
test('missing rates differ from explicit zero; invalid dates and principals fail without invented interest',()=>{
 for(const row of [[],[['검증금융',100000]],[['검증금융',100000,null]],[['검증금융',100000,'']]])assert.equal(I.calculate(car(),row,{today:'2026-02-01'}).ready,false);
 assert.equal(I.calculate(car(),[['검증금융',100000,0]],{today:'2026-02-01'}).amountWon,0);
 for(const value of [{purchaseAt:'2026-02-30'},{purchaseAt:'2027-01-01'},{inventoryLoan:-1},{inventoryLoan:Infinity}])assert.equal(I.calculate(car(value),rates,{today:'2026-02-01'}).ready,false);
 assert.equal(I.calculate(car({inventoryLoan:0,purchaseAt:''}),[]).amountWon,0);
});
test('sold cars stop on sold date and saved interest rate stays frozen until principal or dates change',()=>{
 const sold=car({status:'판매완료',soldAt:'2026-02-01'});sold.inventoryInterestSnapshot=I.snapshot(sold,rates);
 assert.equal(I.calculate(sold,[['검증금융',100000,12]],{today:'2026-12-01'}).amountWon,50959);
 assert.equal(I.calculate({...sold,inventoryLoan:2000},rates).amountWon,101918);
 assert.equal(I.calculate({...sold,soldAt:'2026-02-02'},rates).days,32);
});
test('sold snapshots freeze the effective inventory start basis and survive legacy wire money conversion',async()=>{
 await import('../assets/money.js');const M=globalThis.SnoteMoney;
 const sold=car({status:'판매완료',soldAt:'2026-02-01',inventoryStartedAt:'2026-01-15'});sold.inventoryInterestSnapshot=I.snapshot(sold,rates);
 assert.equal(sold.inventoryInterestSnapshot.start,'2026-01-15');assert.equal(sold.inventoryInterestSnapshot.amountWon,27945);
 const changedRates=[['검증금융',100000,12]];assert.equal(I.calculate(sold,changedRates).amountWon,27945);
 assert.equal(I.calculate({...sold,inventoryStartedAt:'2026-01-16'},changedRates).amountWon,52603);
 assert.equal(I.calculate({...sold,inventoryStartedAt:'2026-02-02'},changedRates).ready,false);
 const wire=M.storeCar(M.car(sold));assert.equal(wire.inventoryStartedAt,'2026-01-15');assert.equal(wire.inventoryInterestSnapshot.amountWon,27945);assert.equal(I.calculate(M.car(wire),changedRates).amountWon,27945);
 const legacy=car({purchaseAt:'2026.1.1',status:'판매완료',soldAt:'2026-02-01',inventoryInterestSnapshot:{version:1,lender:'검증금융',principalManwon:1000,annualRate:6,start:'2026.1.1',end:'2026-02-01',amountWon:50959}});
 assert.equal(I.calculate(legacy,changedRates).amountWon,50959);
 assert.equal(I.calculate({...legacy,inventoryStartedAt:'2026-01-01'},changedRates).amountWon,50959);
});
test('an active-date snapshot uses the latest lender APR on same-day sale and freezes only after finalization',async()=>{
 const active=car({inventoryStartedAt:'2026-01-15'}),eight=[['검증금융',100000,8]],twelve=[['검증금융',100000,12]];
 active.inventoryInterestSnapshot=I.snapshot(active,rates,{today:'2026-02-01'});
 assert.equal(active.inventoryInterestSnapshot.finalized,false);assert.equal(active.inventoryInterestSnapshot.annualRate,6);
 assert.equal(I.calculate(active,eight,{today:'2026-02-01'}).annualRate,8);
 const sold={...active,status:'판매완료',soldAt:'2026-02-01'};
 assert.equal(I.calculate(sold,eight).annualRate,8);assert.equal(I.calculate(sold,eight).amountWon,37260);
 sold.inventoryInterestSnapshot=I.snapshot(sold,eight);assert.equal(sold.inventoryInterestSnapshot.finalized,true);
 assert.equal(I.calculate(sold,twelve).annualRate,8);assert.equal(I.calculate(sold,twelve).amountWon,37260);
 await import('../assets/money.js');const M=globalThis.SnoteMoney,wire=M.storeCar(M.car(sold));
 assert.equal(wire.inventoryInterestSnapshot.finalized,true);assert.equal(I.calculate(M.car(wire),twelve).amountWon,37260);
 const legacy={...sold,inventoryInterestSnapshot:{...sold.inventoryInterestSnapshot}};delete legacy.inventoryInterestSnapshot.finalized;
 assert.equal(I.calculate(legacy,twelve).annualRate,8);assert.equal(I.calculate(legacy,twelve).amountWon,37260);
 const malformed={...sold,inventoryInterestSnapshot:{...sold.inventoryInterestSnapshot,finalized:null}};
 assert.equal(I.calculate(malformed,twelve).annualRate,12);
});
test('settlement source and profit apply the same explicit inventory start basis once',()=>{
 const value=car({status:'판매완료',soldAt:'2026-02-01',inventoryStartedAt:'2026-01-15'}),source=createSource(value,{lenders:rates});
 assert.equal(source.inventoryInterestWon,27945);const doc=createDocument(source),plain=calculate(doc),withInterest=calculate(doc,source);
 assert.equal(withInterest.cells.D28,plain.cells.D28+27945);assert.equal(withInterest.cells.E36,plain.cells.E36-27945);assert.equal(withInterest.cells.D39,plain.cells.D39-27945);
});
test('income settlement deducts interest once in cost and profit without adding an invoice VAT claim',()=>{
 const source=createSource(car({status:'판매완료',soldAt:'2026-02-01'}),{lenders:rates});assert.equal(source.inventoryInterestWon,50959);
 const doc=createDocument(source);doc.cells.D15=11000;
 const plain=calculate(doc),withInterest=calculate(doc,source);
 assert.equal(withInterest.cells.D28,plain.cells.D28+50959);assert.equal(withInterest.cells.E36,plain.cells.E36-50959);
 assert.equal(withInterest.cells.D39,plain.cells.D39-50959);assert.equal(withInterest.cells.H28,plain.cells.H28);assert.equal(withInterest.totals.vat,plain.totals.vat);
 assert(withInterest.totals.purchaseNet<plain.totals.purchaseNet);
 assert.equal(calculate(doc,source).cells.D28,withInterest.cells.D28);assert(!source.unmapped.some(x=>x.key==='inventoryInterest'));
});
test('missing basis retains legacy interest and reports warning; no loan contributes zero',()=>{
 const source=createSource(car({status:'판매완료',soldAt:'2026-02-01',costs:{inventoryInterest:1.2345}}));assert.equal(source.inventoryInterestWon,12345);assert(source.warnings.some(x=>x.includes('기존 재고 이자')));
 assert.equal(createSource(car({inventoryLoan:0,costs:{inventoryInterest:4}})).inventoryInterestWon,0);
});
test('printed settlement uses the same interest-adjusted cost and explicit interest note',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);const {JSDOM}=require('./encar/node_modules/jsdom');const {buildPrintSnapshot}=await import('../assets/income-settlement-print.js');
 const source=createSource(car({status:'판매완료',soldAt:'2026-02-01'}),{lenders:rates}),doc=createDocument(source),dom=new JSDOM('<!doctype html><html><body></body></html>');
 const fragment=buildPrintSnapshot(doc,{source,domDocument:dom.window.document});dom.window.document.body.append(fragment);
 assert.match(dom.window.document.querySelector('.print-footer').textContent,/재고금융 이자 50,959원 포함/);
 assert.equal(Number(dom.window.document.querySelector('[data-cell-address="D28"]').textContent.replaceAll(',','')),50959);dom.window.close();
});
