'use strict';
// Business outcomes use independently checked Decimal expectations. No database,
// browser, external service, customer data or current wall-clock date is used.
const test=require('node:test');
const assert=require('node:assert/strict');
const Finance=require('../assets/business-finance.js');

const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER='11111111-1111-4111-8111-111111111111';
const CAR_ID='business-finance-car';
const CYCLE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LOAN='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AS_OF={asOf:'2026-02-01'};
let serial=0;
const id=()=>`eeeeeeee-eeee-4eee-8eee-${String(++serial).padStart(12,'0')}`;
const clone=value=>structuredClone(value);

function car(overrides={}){
 return {id:CAR_ID,ownerId:OWNER,moneyUnit:'KRW',model:'합성 검증 차량',plate:'00가0000',
  status:'판매완료',purchaseAt:'2026-01-01',buy:30000000,sell:33500000,
  soldAt:'2026-01-31',soldPrice:33500000,inventoryLoan:0,
  costs:{bodywork:1300000,inventoryInterest:0},repairItems:[],...overrides};
}
function cycle(details={},overrides={}){
 return {id:CYCLE,sequence:1,status:'open',details:{tradeType:'direct',
  purchaseAmountWon:30000000,purchaseDate:'2026-01-01',expectedSaleWon:33500000,
  saleAmountWon:33500000,saleDate:'2026-01-31',contractDate:'2026-01-20',
  deliveryDate:'2026-01-31',legacyCostsWon:1300000,legacyCosts:{bodywork:1300000},
  legacyInterestWon:0,costsConfirmed:true,settlementStatus:'provisional',
  ownershipPercent:100,commissionWon:null,counterpartySettlementWon:null,
  sourceSignature:Finance.snapshot(car()).sourceSignature,...details},...overrides};
}
function workspace(entries=[],details={},overrides={}){
 return {apiVersion:1,companyId:COMPANY,ownerId:OWNER,carId:CAR_ID,revision:0,
  cycles:[cycle(details)],entries,...overrides};
}
function entry(kind,status,amountWon,effectiveDate,details={},overrides={}){
 return {id:id(),cycleId:CYCLE,kind,status,amountWon,effectiveDate,dueDate:null,details,...overrides};
}
function loan({amount=10000000,rate=6,date='2026-01-01',...overrides}={}){
 return entry('loan','active',amount,date,{lender:'합성 금융사',annualRate:rate,startDate:date,maturityDate:'2026-03-01'}, {id:LOAN,...overrides});
}
function loanEvent(eventType,amountWon,effectiveDate,details={},overrides={}){
 return entry('loan_event','confirmed',amountWon,effectiveDate,{loanId:LOAN,eventType,...details},overrides);
}
const repay=(amount,date,overrides={})=>loanEvent('repay',amount,date,{},overrides);
const rate=(annualRate,date,overrides={})=>loanEvent('rate',null,date,{annualRate},overrides);
function cost(amount,status='incurred',details={}){
 return entry('cost',status,amount,'2026-01-25',{category:'bodywork',label:'합성 추가 정비',...details});
}
function cash(amount,purpose,direction,status='confirmed',details={}){
 return entry('cash',status,amount,'2026-01-25',{purpose,direction,...details});
}
function freeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);
  Object.freeze(value);
 }
 return value;
}
function pure(call,input){
 const before=clone(input);freeze(input);const result=call(input);
 assert.deepEqual(input,before,'Financial calculations preserve their source records');
 return result;
}
const summarize=(w,c=car(),options=AS_OF)=>Finance.summarize(w,c,options);
const loanSummary=(w,options=AS_OF)=>Finance.loanSummary(w,LOAN,options);

test('legacy amounts without confirmation remain unknown instead of manufacturing zero costs',()=>{
 const source=car({costs:undefined,repairItems:undefined,buy:undefined,soldPrice:undefined});
 const snapshot=pure(value=>Finance.snapshot(value),source);
 assert.equal(snapshot.legacyCostsWon,null);
 const result=summarize(workspace([],{purchaseAmountWon:null,legacyCostsWon:null,legacyCosts:{},costsConfirmed:false}),source);
 assert.equal(result.managementProfitWon,null);
 assert.equal(result.complete,false);
 assert(result.warnings.length>0);
 const returnedToStock=Finance.snapshot(car({status:'판매중'}));
 assert.equal(returnedToStock.saleAmountWon,null,'A historical soldPrice retained on a stock car cannot become a new confirmed sale');
 assert.equal(returnedToStock.saleDate,null);
});

test('direct sale yields 2.2m management profit; incurred unpaid costs reduce profit immediately',()=>{
 const source=car(),base=workspace();
 const result=pure(value=>summarize(value,source),base);
 assert.equal(result.managementProfitWon,2200000);
 assert.equal(Finance.cycleSummary(base,CYCLE,source,AS_OF).managementProfitWon,2200000);
 const expense=cost(100000),withUnpaidCost=summarize(workspace([expense]),source);
 assert.equal(withUnpaidCost.managementProfitWon,2100000);
 assert.equal(withUnpaidCost.cash.confirmedOutWon,0,'An incurred unpaid cost is not an actual cash payment');
 const withPayment=summarize(workspace([expense,cash(100000,'cost','out','confirmed',{referenceId:expense.id})]),source);
 assert.equal(withPayment.managementProfitWon,2100000,'Paying an incurred cost cannot charge the expense twice');
 assert.equal(withPayment.cash.confirmedOutWon,100000);
 assert.equal(withPayment.cash.netWon,-100000);
});

test('loan draw and principal repayment are funding flows, not sale revenue or vehicle expenses',()=>{
 const repaid=workspace([loan({rate:0}),repay(10000000,'2026-01-25'),
  cash(10000000,'loan_draw','in','confirmed',{referenceId:LOAN}),cash(10000000,'loan_repayment','out','confirmed',{referenceId:LOAN})]);
 const funded=summarize(repaid);
 assert.equal(funded.managementProfitWon,2200000);
 assert.equal(funded.cash.confirmedInWon,10000000);
 assert.equal(funded.cash.confirmedOutWon,10000000);
 assert.equal(funded.cash.netWon,0);
 assert.equal(loanSummary(repaid).principalOutstandingWon,0);
 assert.equal(loanSummary(repaid).estimatedInterestWon,0);
 const fee=loanEvent('fee',50000,'2026-01-20');
 const withFee=workspace([loan({rate:0}),fee,cash(50000,'cost','out','confirmed',{referenceId:fee.id})]);
 assert.equal(loanSummary(withFee).feesWon,50000);
 assert.equal(summarize(withFee).managementProfitWon,2150000,
  'A financing fee is an expense once; its cash payment cannot add the expense again');
});

test('a 10m loan at 6% accrues 50,959 won for Jan1–Feb1 even when the car was sold Jan10',()=>{
 const original=workspace([loan()],{saleDate:'2026-01-10',deliveryDate:'2026-01-10'});
 const summary=pure(value=>loanSummary(value),original);
 assert.equal(summary.principalOutstandingWon,10000000);
 assert.equal(summary.estimatedInterestWon,50959);
 assert.equal(summary.managementInterestWon,50959);
 assert.equal(summary.actualInterestWon,0);
 assert.equal(summary.complete,true);
 const unsold=workspace([loan()],{saleAmountWon:null,saleDate:null,deliveryDate:null});
 assert.equal(loanSummary(unsold).estimatedInterestWon,50959);
});

test('Jan16 partial repayment applies only prospectively and rounds the combined interest once',()=>{
 // Decimal: 10m*.06*15/365 + 6m*.06*16/365 = 40438.356164…
 // Rounding each interval separately incorrectly produces 40,439 won.
 const summary=loanSummary(workspace([loan(),repay(4000000,'2026-01-16')]));
 assert.equal(summary.principalOutstandingWon,6000000);
 assert.equal(summary.estimatedInterestWon,40438);
 assert.equal(summary.managementInterestWon,40438);
});

test('Jan20 rate change preserves the earlier 19 days at the original rate',()=>{
 // Decimal: 10m*.06*19/365 + 10m*.12*12/365 = 70684.931506…
 const summary=loanSummary(workspace([loan(),rate(12,'2026-01-20')]));
 assert.equal(summary.principalOutstandingWon,10000000);
 assert.equal(summary.estimatedInterestWon,70685);
});

test('partial repayment followed by a rate change uses three dated balance/rate intervals',()=>{
 // Decimal: 10m*.06*15/365 + 6m*.06*4/365 + 6m*.12*12/365
 // = 52273.972602…; sale status never closes the loan.
 const entries=[loan(),repay(4000000,'2026-01-16'),rate(12,'2026-01-20')];
 const summary=loanSummary(workspace(entries,{saleDate:'2026-01-10'}));
 assert.equal(summary.principalOutstandingWon,6000000);
 assert.equal(summary.estimatedInterestWon,52274);
 assert.equal(summary.complete,true);
});

test('full repayment retains historical interest after the outstanding principal reaches zero',()=>{
 const w=workspace([loan(),repay(10000000,'2026-01-16')]);
 const result=loanSummary(w);
 assert.equal(result.principalOutstandingWon,0);
 assert.equal(result.estimatedInterestWon,24658);
 assert.equal(result.managementInterestWon,24658);
 assert.equal(loanSummary(w,{asOf:'2026-02-15'}).estimatedInterestWon,24658);
 assert.equal(loanSummary(workspace([loan(),repay(10000000,'2026-02-01')])).estimatedInterestWon,50959,
  'A repayment on the cutoff date cannot remove the preceding 31 days of interest');
});

test('same-day changes have zero intervening days, are input-order independent, and exclude future events',()=>{
 const events=[repay(4000000,'2026-01-16'),rate(12,'2026-01-16')];
 // Decimal total 56219.178082…; separately rounded intervals would be 56,220.
 for(const ordered of [events,[...events].reverse()]){
  const result=loanSummary(workspace([loan(),...ordered]));
  assert.equal(result.principalOutstandingWon,6000000);
  assert.equal(result.estimatedInterestWon,56219);
 }
 const future=loanSummary(workspace([loan(),repay(4000000,'2026-02-02'),rate(12,'2026-02-02')]));
 assert.equal(future.principalOutstandingWon,10000000);
 assert.equal(future.estimatedInterestWon,50959);
 const sameDay=loanSummary(workspace([loan(),repay(4000000,'2026-01-01'),rate(12,'2026-01-01')]));
 assert.equal(sameDay.estimatedInterestWon,61151);
 const netMovements=[repay(11000000,'2026-01-16'),loanEvent('draw',3000000,'2026-01-16')];
 for(const ordered of [netMovements,[...netMovements].reverse()]){
  const net=loanSummary(workspace([loan(),...ordered]));
  assert.equal(net.principalOutstandingWon,2000000,'Same-day draw and repayment use their net movement');
  assert.equal(net.estimatedInterestWon,29918);
 }
 assert.equal(loanSummary(workspace([loan({amount:3650,rate:5})]),{asOf:'2026-01-02'}).estimatedInterestWon,1,
  'Exactly half a won rounds up, not to even');
});

test('confirmed interest invoices replace covered estimates without double-counting finance expense',()=>{
 const full=loanEvent('interest_invoice',52000,'2026-02-01',{periodStart:'2026-01-01',periodEnd:'2026-02-01'});
 const summary=loanSummary(workspace([loan(),full]));
 assert.equal(summary.estimatedInterestWon,50959,'The independently useful full-period forecast remains available');
 assert.equal(summary.actualInterestWon,52000);
 assert.equal(summary.managementInterestWon,52000,'Actual billed interest replaces the same covered forecast');
 const partial=loanEvent('interest_invoice',25000,'2026-01-16',{periodStart:'2026-01-01',periodEnd:'2026-01-16'});
 const mixed=loanSummary(workspace([loan(),repay(4000000,'2026-01-16'),partial]));
 assert.equal(mixed.actualInterestWon,25000);
 assert.equal(mixed.managementInterestWon,40781,'25,000 actual + 15,780.821917… uncovered estimate');
});

test('unknown invoice coverage and conflicting same-day rates return incomplete results with warnings',()=>{
 const unscopedInvoice=loanEvent('interest_invoice',52000,'2026-02-01');
 const invoice=loanSummary(workspace([loan(),unscopedInvoice]));
 assert.equal(invoice.actualInterestWon,52000,'An invoice without coverage is still an actual charge exactly once');
 assert.equal(invoice.complete,false);
 assert(invoice.warnings.length>0);
 const conflicting=loanSummary(workspace([loan(),rate(8,'2026-01-20'),rate(12,'2026-01-20')]));
 assert.equal(conflicting.complete,false);
 assert.equal(conflicting.estimatedInterestWon,null);
 assert(conflicting.warnings.length>0);
});

test('missing loan basis stays null while an explicit zero rate remains a known zero',()=>{
 const missingRate=loanSummary(workspace([loan({rate:null})]));
 assert.equal(missingRate.estimatedInterestWon,null);
 assert.equal(missingRate.complete,false);
 const missingDate=loanSummary(workspace([loan({date:null})]));
 assert.equal(missingDate.estimatedInterestWon,null);
 assert.equal(missingDate.complete,false);
 const missingPrincipal=loanSummary(workspace([loan({amount:null})]));
 assert.equal(missingPrincipal.principalOutstandingWon,null);
 assert.equal(missingPrincipal.estimatedInterestWon,null);
 assert.equal(missingPrincipal.complete,false);
 const zeroRate=loanSummary(workspace([loan({rate:0})]));
 assert.equal(zeroRate.estimatedInterestWon,0);
 assert.equal(zeroRate.complete,true);
 const overpaid=loanSummary(workspace([loan(),repay(11000000,'2026-01-16')]));
 assert.equal(overpaid.principalOutstandingWon,null);
 assert.equal(overpaid.estimatedInterestWon,null);
 assert.equal(overpaid.complete,false);
 for(const malformed of [loan({amount:'10000000'}),loan({rate:'6'}),loan({date:'2026-02-30'})]){
  assert.throws(()=>loanSummary(workspace([malformed])), 'Malformed values cannot be silently coerced into valid loan terms');
 }
});

test('incurred refunds reduce costs, and reversed or unconfirmed records cannot alter confirmed balances',()=>{
 const originalCost=cost(200000),refund=cost(-100000,'incurred',{refundOf:originalCost.id});
 const withRefund=summarize(workspace([originalCost,refund]));
 assert.equal(withRefund.managementProfitWon,2100000);
 assert.equal(summarize(workspace([originalCost,{...refund,status:'unconfirmed'}])).managementProfitWon,2000000,
  'An unconfirmed refund cannot improve management profit');
 const reversedRepayment=repay(4000000,'2026-01-16',{status:'reversed'}),pendingRepayment=cash(4000000,'loan_repayment','out','planned',{referenceId:LOAN});
 for(const repayment of [reversedRepayment,pendingRepayment]){
  const w=workspace([loan(),repayment]),before=clone(w),result=loanSummary(w);
  assert.equal(result.principalOutstandingWon,10000000);
  assert.equal(result.estimatedInterestWon,50959);
  assert.deepEqual(w,before,'Historical reversed records remain present and unchanged');
 }
});

test('repeated identical entry IDs are idempotent; conflicting duplicates are rejected',()=>{
 const repayment=repay(4000000,'2026-01-16'),w=workspace([loan(),repayment,clone(repayment)]);
 assert.equal(loanSummary(w).principalOutstandingWon,6000000);
 assert.equal(loanSummary(w).estimatedInterestWon,40438);
 const conflicting=workspace([loan(),repayment,{...clone(repayment),amountWon:3000000}]);
 assert.throws(()=>loanSummary(conflicting),error=>error.code==='DUPLICATE_ID');
});

test('appraisal retains the 29.7m purchase ceiling and refuses unknown inputs rather than assuming zero',()=>{
 const input={expectedSaleWon:33500000,estimatedCostsWon:1300000,targetProfitWon:2000000,reserveWon:500000};
 const result=pure(value=>Finance.appraisal(value),input);
 assert.equal(result.maxPurchaseWon,29700000);
 const missing=Finance.appraisal({...input,estimatedCostsWon:null});
 assert.equal(missing.maxPurchaseWon,null);
 assert.equal(missing.complete,false);
});

test('a source-linked replacement changes only that legacy cost, while ambiguous replacements stay unknown',()=>{
 const source=car({costs:{bodywork:300000,polish:1000000,inventoryInterest:0}});
 const details={legacyCosts:{bodywork:300000,polish:1000000},sourceSignature:Finance.snapshot(source).sourceSignature};
 const replacement=cost(400000,'incurred',{sourceCostKey:'bodywork'});
 const replaced=summarize(workspace([replacement],details),source);
 assert.equal(replaced.costs.managementWon,1400000);
 assert.equal(replaced.managementProfitWon,2100000);
 const conflicting=summarize(workspace([replacement,cost(450000,'incurred',{sourceCostKey:'bodywork'})],details),source);
 assert.equal(conflicting.managementProfitWon,null);
 assert.equal(conflicting.complete,false);
 assert(conflicting.warnings.length>0);
 for(const legacyCosts of [null,{polish:1300000}]){
  const missing=summarize(workspace([replacement],{...details,legacyCosts}),source);
  assert.equal(missing.managementProfitWon,null,'A missing original cost cannot be replaced as though it were zero');
  assert.equal(missing.complete,false);
 }
});

test('a changed vehicle source signature makes a previously confirmed settlement provisional',()=>{
 const source=car(),w=workspace([],{settlementStatus:'final',sourceSignature:Finance.snapshot(source).sourceSignature});
 const changed=car({costs:{bodywork:1400000,inventoryInterest:0}});
 const result=pure(value=>summarize(value,changed),w);
 assert.equal(result.complete,false);
 assert.equal(result.costs.stale,true);
 assert.equal(Finance.cycleSummary(w,CYCLE,changed,AS_OF).settlementStatus,'provisional');
 assert(result.warnings.length>0);
});

test('joint ownership allocates the vehicle profit while consignment and brokerage earn only their commission',()=>{
 const joint=Finance.cycleSummary(workspace([],{tradeType:'joint',ownershipPercent:50,counterpartySettlementWon:1100000}),CYCLE,car(),AS_OF);
 assert.equal(joint.grossProfitWon,2200000);
 assert.equal(joint.managementProfitWon,1100000);
 assert.equal(joint.estimatedProfitWon,1100000);
 assert.equal(joint.counterpartySettlementWon,1100000);
 const source=car({buy:null,costs:{bodywork:100000,inventoryInterest:0}});
 for(const tradeType of ['consignment','brokerage']){
  const result=summarize(workspace([],{tradeType,purchaseAmountWon:null,
   legacyCostsWon:100000,legacyCosts:{bodywork:100000},legacyInterestWon:0,
   commissionWon:500000,counterpartySettlementWon:33000000,
   sourceSignature:Finance.snapshot(source).sourceSignature}),source);
  assert.equal(result.sale.amountWon,33500000,'The full customer sale amount is still available for settlement');
  assert.equal(result.managementProfitWon,400000,'Dealer revenue is 500,000 commission less 100,000 expenses');
  assert.equal(result.estimatedProfitWon,400000);
 }
});

test('actual cash excludes future confirmations, preserves unknown balances, and separates customer transfer deposits from profit',()=>{
 const paid=cash(30000000,'purchase','out');
 const future={...cash(33500000,'sale','in'),effectiveDate:'2026-02-02'};
 const planned=cash(1300000,'cost','out','planned');
 const base=summarize(workspace([paid,future,planned]));
 assert.equal(base.cash.confirmedInWon,0);
 assert.equal(base.cash.confirmedOutWon,30000000);
 assert.equal(base.cash.netWon,-30000000);
 assert.equal(base.cash.plannedOutWon,1300000);
 assert.equal(base.sale.receivableWon,null,'A future receipt is not a present payment-history confirmation');
 assert.equal(base.managementProfitWon,2200000);
 const deposits=[cash(1000000,'transfer_deposit','in'),cash(400000,'transfer_refund','out')];
 const holding=summarize(workspace([paid,future,planned,...deposits]));
 assert.equal(holding.cash.netWon,-29400000);
 assert.equal(holding.cash.transferDepositBalanceWon,600000);
 assert.equal(holding.managementProfitWon,2200000,'Customer money held for transfer is neither dealer revenue nor a vehicle expense');
 const unknown=summarize(workspace([paid,cash(null,'sale','in')]));
 assert.equal(unknown.cash.netWon,null);
 assert.equal(unknown.sale.receivableWon,null);
 assert.equal(unknown.cash.complete,false);
 assert.equal(unknown.complete,false);
});

test('empty cash history retains registered zero sums without inventing actual settlement balances',()=>{
 const expense=cost(100000),result=pure(value=>summarize(value),workspace([expense,loan({rate:0})]));
 assert.equal(result.cash.confirmedInWon,0);
 assert.equal(result.cash.confirmedOutWon,0);
 assert.equal(result.cash.netWon,0);
 assert.equal(result.cash.basis,'registered_confirmed_records');
 assert.deepEqual(result.cash.history,{confirmedCount:0,hasConfirmedRecords:false,purposeCounts:Object.fromEntries(['sale','purchase','cost','loan_draw','loan_repayment','loan_interest','transfer_deposit','transfer_refund','sale_refund','cost_refund','purchase_refund','other'].map(p=>[p,0]))});
 for(const item of [result.sale,result.purchase,result.costs,result.costs.payables[0]])assert.equal(item.basis,'unrecorded');
 assert.equal(result.sale.receivableWon,null);
 assert.equal(result.purchase.payableWon,null);
 assert.equal(result.costs.payableWon,null);
 assert.equal(result.costs.payables[0].remainingWon,null);
 assert.equal(result.cash.ownerFunding.beforeSaleWon,null);
 assert.equal(result.cash.ownerFunding.afterSaleWon,null);
 assert.equal(result.cash.ownerFunding.basis,'unrecorded');
 assert.equal(result.loanTotals.principalOutstandingWon,10000000,'A documented loan balance does not require an invented cash history');
 assert.equal(result.managementProfitWon,2100000,'Cash-history uncertainty does not change the existing profit formula');
 const cancelled=summarize(workspace([],{},{cycles:[cycle({}, {status:'cancelled'})]}));
 assert.equal(cancelled.sale.possibleRefundWon,null,'An unrecorded sale receipt cannot establish a zero refund obligation');
});

test('explicit confirmed zero payments establish purpose-specific registered balances',()=>{
 const expense=cost(100000),rows=[expense,cash(0,'sale','in'),cash(0,'purchase','out'),cash(0,'cost','out','confirmed',{referenceId:expense.id})];
 const result=summarize(workspace(rows));
 assert.equal(result.sale.receivableWon,33500000);
 assert.equal(result.purchase.payableWon,30000000);
 assert.equal(result.costs.payableWon,1400000);
 assert.equal(result.costs.payables[0].remainingWon,100000);
 assert.equal(result.cash.history.confirmedCount,3);
 assert.equal(result.cash.history.purposeCounts.sale,1);
 for(const item of [result.sale,result.purchase,result.costs,result.costs.payables[0]])assert.equal(item.basis,'registered_confirmed_records');
 assert.equal(result.cash.ownerFunding.beforeSaleWon,0);
 assert.equal(result.cash.ownerFunding.afterSaleWon,0);
 assert.equal(result.cash.ownerFunding.complete,false,'A registered zero is not confirmation that all historical cash has been reconciled');
 const unrelated=summarize(workspace([expense,cash(100,'cost','out','confirmed',{referenceId:id()})]));
 assert.equal(unrelated.costs.payables[0].remainingWon,null,'An unrelated payment cannot confirm this expense payment history');
});

test('registered own-funding distinguishes sale recovery, loan principal and custodial deposits',()=>{
 const rows=[cash(30000000,'purchase','out'),cash(1300000,'cost','out'),cash(10000000,'loan_draw','in'),cash(33500000,'sale','in'),cash(400000,'transfer_deposit','in'),cash(120000,'other','out')];
 const original=workspace(rows),result=pure(value=>summarize(value),original),funding=result.cash.ownerFunding;
 assert.equal(funding.beforeSaleWon,21300000);
 assert.equal(funding.afterSaleWon,-12200000);
 assert.equal(funding.basis,'registered_confirmed_records');
 assert.equal(funding.complete,false);
 assert.equal(result.managementProfitWon,2200000,'Funding, recovery and held customer cash cannot enter the profit calculation');
 assert.deepEqual(Finance.cycleSummary(original,CYCLE,car(),AS_OF).cash.ownerFunding,funding);
 assert.deepEqual(result.vehicleCash.ownerFunding,funding);
 const refunded=summarize(workspace([...rows,cash(500000,'purchase_refund','in'),cash(100000,'cost_refund','in'),cash(2000000,'loan_repayment','out'),cash(50000,'loan_interest','out'),cash(1000000,'sale_refund','out')]));
 assert.equal(refunded.cash.ownerFunding.beforeSaleWon,22750000);
 assert.equal(refunded.cash.ownerFunding.afterSaleWon,-9750000);
 const custodialOnly=summarize(workspace([cash(400000,'transfer_deposit','in'),cash(120000,'other','out')]));
 assert.equal(custodialOnly.cash.ownerFunding.beforeSaleWon,null);
 assert.equal(custodialOnly.cash.ownerFunding.basis,'unrecorded');
});

test('unconfirmed, reversed, future or unknown cash cannot establish known own-funding or historical settlement',()=>{
 const excluded=[cash(30000000,'purchase','out','planned'),cash(10000000,'loan_draw','in','reversed'),{...cash(33500000,'sale','in'),effectiveDate:'2026-02-02'}];
 const result=summarize(workspace(excluded));
 assert.equal(result.cash.history.confirmedCount,0);
 assert.equal(result.purchase.payableWon,null);
 assert.equal(result.sale.receivableWon,null);
 assert.equal(result.cash.ownerFunding.beforeSaleWon,null);
 for(const missing of [{amountWon:null},{effectiveDate:null}]){
  const unknown=summarize(workspace([{...cash(100000,'purchase','out'),...missing}]));
  assert.equal(unknown.cash.history.confirmedCount,1);
  assert.equal(unknown.cash.history.purposeCounts.purchase,1);
  assert.equal(unknown.cash.ownerFunding.basis,'unknown');
  assert.equal(unknown.cash.ownerFunding.beforeSaleWon,null);
  assert.equal(unknown.purchase.payableWon,null);
  assert.equal(unknown.purchase.basis,'unknown');
 }
});

test('source-linked refund credits subtract the original expense once and cannot exceed its amount',()=>{
 const source=car({costs:{bodywork:300000,polish:1000000,inventoryInterest:0}});
 const details={legacyCosts:{bodywork:300000,polish:1000000},sourceSignature:Finance.snapshot(source).sourceSignature};
 const legacyCredit=cost(-100000,'incurred',{refundOf:'legacy:bodywork',sourceCostKey:'bodywork'});
 const legacy=summarize(workspace([legacyCredit],details),source);
 assert.equal(legacy.costs.managementWon,1200000,'A 100,000 credit reduces the existing 1.3m cost to 1.2m');
 assert.equal(legacy.managementProfitWon,2300000);
 const replacement=cost(200000,'incurred',{sourceCostKey:'bodywork'});
 const credit=cost(-50000,'incurred',{refundOf:replacement.id,sourceCostKey:'bodywork'});
 const adjusted=summarize(workspace([replacement,credit],details),source);
 assert.equal(adjusted.costs.managementWon,1150000,'Replace 300,000 with 200,000, then refund 50,000 exactly once');
 assert.equal(adjusted.managementProfitWon,2350000);
 const excessiveLegacy=[cost(-200000,'incurred',{refundOf:'legacy:bodywork'}),cost(-150000,'incurred',{refundOf:'legacy:bodywork'})];
 const excessiveEntry=[replacement,cost(-150000,'incurred',{refundOf:replacement.id}),cost(-100000,'incurred',{refundOf:replacement.id})];
 for(const entries of [excessiveLegacy,excessiveEntry]){
  const excessive=summarize(workspace(entries,details),source);
  assert.equal(excessive.managementProfitWon,null);
  assert.equal(excessive.complete,false);
  assert(excessive.warnings.length>0);
 }
});

test('a paid cost followed by a credit and cash refund leaves a fully settled net payable',()=>{
 for(const refundReferencesOriginal of [false,true]){
  const expense=cost(100000),credit=cost(-20000,'incurred',{refundOf:expense.id});
  const payment=cash(100000,'cost','out','confirmed',{referenceId:expense.id});
  const refund=cash(20000,'cost_refund','in','confirmed',{
   referenceId:refundReferencesOriginal?expense.id:credit.id
  });
  const result=pure(value=>summarize(value),workspace([expense,credit,payment,refund]));
  const payable=result.costs.payables.find(item=>item.entryId===expense.id);
  assert(payable,'The original expense retains its payable identity');
  assert.equal(payable.netAmountWon,80000);
  assert.equal(payable.paidWon,80000);
  assert.equal(payable.remainingWon,0);
  assert.equal(result.cash.costPaidWon,80000);
  assert.equal(result.cash.netWon,-80000);
  assert.equal(result.managementProfitWon,2120000);
 }
});

test('known prices survive missing transaction dates, and a different source vehicle is rejected',()=>{
 for(const missing of [
  {purchaseDate:null},
  {saleDate:null},
  {purchaseDate:null,saleDate:null}
 ]){
  const source=car({
   ...(Object.hasOwn(missing,'purchaseDate')?{purchaseAt:null}:{}),
   ...(Object.hasOwn(missing,'saleDate')?{soldAt:null}:{})
  });
  const result=summarize(workspace([],{...missing,sourceSignature:Finance.snapshot(source).sourceSignature}),source);
  assert.equal(result.costs.stale,false,'The missing dates alone make this result incomplete, not a signature mismatch');
  assert.equal(result.purchase.amountWon,30000000);
  assert.equal(result.sale.amountWon,33500000);
  assert.equal(result.managementProfitWon,2200000);
  assert.equal(result.complete,false);
  assert(result.warnings.length>0);
 }
 const other=car({id:'another-business-vehicle'});
 assert.throws(()=>summarize(workspace(),other),{code:'SCOPE_MISMATCH'});
 assert.throws(()=>Finance.cycleSummary(workspace(),CYCLE,other,AS_OF),{code:'SCOPE_MISMATCH'});
});

test('appraisal accepts the document sale-estimate alias and rejects contradictory estimates',()=>{
 const input={saleEstimateWon:33500000,estimatedCostsWon:1300000,targetProfitWon:2000000,reserveWon:500000};
 const result=pure(value=>Finance.appraisal(value),input);
 assert.equal(result.maxPurchaseWon,29700000);
 assert.equal(result.complete,true);
 assert.equal(Finance.appraisal({...input,expectedSaleWon:33500000}).maxPurchaseWon,29700000);
 assert.throws(()=>Finance.appraisal({...input,expectedSaleWon:34000000}));
});

test('cancelling an earlier trade preserves its cash and unpaid loan when a new trade opens',()=>{
 const nextId='ffffffff-ffff-4fff-8fff-ffffffffffff';
 const saleDeposit=cash(1000000,'sale','in');
 const oldLoan=loan();
 const previous=cycle({}, {status:'cancelled'});
 const source=car({status:'판매중',buy:28000000,sell:32000000,purchaseAt:'2026-02-01',
  soldAt:null,soldPrice:null,costs:{},repairItems:[]});
 const next=cycle({purchaseAmountWon:28000000,purchaseDate:'2026-02-01',expectedSaleWon:32000000,
  saleAmountWon:null,saleDate:null,contractDate:null,deliveryDate:null,
  legacyCostsWon:0,legacyCosts:{},legacyInterestWon:0,
  sourceSignature:Finance.snapshot(source).sourceSignature},
 {id:nextId,sequence:2,status:'open'});
 const w=workspace([saleDeposit,oldLoan],{}, {cycles:[previous,next]});
 const originalEntries=clone(w.entries);
 const result=pure(value=>summarize(value,source),w);
 assert.equal(result.activeCycleId,nextId);
 assert.equal(result.vehicleCash.netWon,1000000,'Cancellation does not manufacture an actual cash refund');
 assert.equal(result.loans.length,1);
 assert.equal(result.loans[0].id,LOAN);
 assert.equal(result.loans[0].cycleId,CYCLE);
 assert.equal(result.loanTotals.principalOutstandingWon,10000000);
 assert.equal(result.loanTotals.estimatedInterestWon,50959);
 const old=result.cycles.find(item=>item.id===CYCLE);
 assert(old);
 assert.equal(old.status,'cancelled');
 assert.equal(old.cash.confirmedInWon,1000000);
 assert.equal(old.cash.confirmedOutWon,0);
 assert.equal(old.cash.netWon,1000000);
 assert.equal(old.sale.receivableWon,null);
 assert.equal(old.sale.possibleRefundWon,1000000);
 assert.deepEqual(w.entries,originalEntries,'Both confirmed cash and the original loan remain in the cancelled trade');
 assert.equal(w.entries.length,2);
});
