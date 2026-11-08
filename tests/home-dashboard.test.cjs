'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const M=require('../assets/home-dashboard.js');
const frozen=rows=>Object.freeze(rows.map(row=>Object.freeze(row)));

test('dashboard keeps won amounts and separates inventory, purchases and completed-sale margins',()=>{
 const rows=frozen([
  {id:'stock-a',status:'판매중',purchaseAt:'2027-03-04',inventoryCost:12345678,inventoryLoan:4000000,margin:2000000},
  {id:'stock-b',status:'수리중',purchaseAt:'2027-02-18',inventoryCost:8000000,inventoryLoan:1000000,margin:-100000},
  {id:'sale-march',status:'판매완료',purchaseAt:'2027-03-01',soldAt:'2027-03-10',inventoryCost:10000000,margin:3000000},
  {id:'sale-february',status:'판매완료',purchaseAt:'2027-01-14',soldAt:'2027-02-28',inventoryCost:7000000,margin:-250000},
  {id:'sale-january',status:'판매완료',purchaseAt:'2026-12-25',soldAt:'2027-01-02',inventoryCost:5000000,margin:450000},
  {id:'prior-year',status:'판매완료',purchaseAt:'2027-02-01',soldAt:'2026-12-31',inventoryCost:6000000,margin:900000},
  {id:'future',status:'판매완료',purchaseAt:'2027-04-01',soldAt:'2027-04-02',inventoryCost:9000000,margin:8000000}
 ]),before=JSON.stringify(rows),data=M.summarize(rows,'2027-03');
 assert.equal(data.inventoryCapital,5000000,'Inventory funds mean current registered financing, not the vehicle cost');
 assert.equal(data.totalInvestment,20345678,'Only currently held vehicle costs enter total investment');
 assert.equal(data.cash,15345678,'Cash is current input cost minus current inventory financing');
 assert.equal(data.inventoryMargin,1900000);
 assert.equal(data.monthPurchaseCount,2,'Purchases include a vehicle already sold in the same month');
 assert.equal(data.monthSaleCount,1);
 assert.equal(data.monthMargin,3000000);
 assert.equal(data.yearMargin,3200000,'Prior years and future reporting months must not inflate this year');
 assert.deepEqual(data.series,[
  {month:'2027-01',purchases:1,sales:1,margin:450000},
  {month:'2027-02',purchases:2,sales:1,margin:-250000},
  {month:'2027-03',purchases:2,sales:1,margin:3000000}
 ]);
 assert.equal(JSON.stringify(rows),before);
});

test('current investment excludes every sold vehicle cost and subtracts registered financing without an external balance',()=>{
 const stock={id:'stock',status:'판매중',purchaseAt:'2027-03-01',inventoryCost:1234567,inventoryLoan:234567,margin:100000};
 const sold={id:'sold',status:'판매완료',purchaseAt:'2026-01-01',soldAt:'2026-02-01',inventoryCost:7654321,inventoryLoan:6000000,margin:-500000,soldPrice:7154321};
 const inventoryOnly=M.summarize(frozen([stock]),'2027-03');
 assert.equal(inventoryOnly.totalInvestment,1234567);assert.equal(inventoryOnly.inventoryCapital,234567);assert.equal(inventoryOnly.cash,1000000);
 const mixed=M.summarize(frozen([stock,sold]),'2027-03');
 for(const field of ['totalInvestment','inventoryCapital','cash'])assert.equal(mixed[field],inventoryOnly[field],field+' must exclude completed vehicles');
 const soldOnly=M.summarize(frozen([sold]),'2027-03');
 assert.equal(soldOnly.totalInvestment,0);assert.equal(soldOnly.inventoryCapital,0);assert.equal(soldOnly.cash,0);
 assert.equal(soldOnly.monthSaleCount,0,'Historical sales still use the selected reporting month');
});

test('a sale removes both its input costs and its financing from the current capital summary',()=>{
 const rows=frozen([{id:'a',status:'판매중',inventoryCost:15000000,inventoryLoan:8000000,margin:300000},{id:'b',status:'수리중',inventoryCost:7000000,inventoryLoan:2000000,margin:-100000}]);
 const before=JSON.stringify(rows),initial=M.summarize(rows,'2027-03');
 const completed=M.summarize(frozen(rows.map(row=>row.id==='a'?{...row,status:'판매완료',soldAt:'2027-03-04'}:row)),'2027-03');
 assert.equal(initial.totalInvestment,22000000);assert.equal(initial.inventoryCapital,10000000);assert.equal(initial.cash,12000000);
 assert.equal(completed.totalInvestment,7000000);assert.equal(completed.inventoryCapital,2000000);assert.equal(completed.cash,5000000);
 assert.equal(completed.totalInvestment,completed.inventoryCapital+completed.cash);assert.equal(completed.monthMargin,300000);
 assert.equal(JSON.stringify(rows),before);
});

test('partial repayment, zero finance and financing above cost preserve the requested subtraction',()=>{
 const row={id:'holding',status:'판매중',inventoryCost:20000000,inventoryLoan:8000000,margin:100000};
 for(const [inventoryLoan,cash] of [[8000000,12000000],[5000000,15000000],[0,20000000],[25000000,-5000000]]){
  const data=M.summarize(frozen([{...row,inventoryLoan}]),'2027-03');
  assert.equal(data.totalInvestment,20000000);assert.equal(data.inventoryCapital,inventoryLoan);assert.equal(data.cash,cash);
 }
});

test('sold cost and loan fields are not read for current capital even when their legacy values are invalid',()=>{
 const data=M.summarize(frozen([{status:'판매중',inventoryCost:5000000,inventoryLoan:2000000,margin:0},{status:'판매완료',inventoryCost:NaN,inventoryLoan:'legacy',margin:0}]),'2027-03');
 assert.equal(data.totalInvestment,5000000);assert.equal(data.inventoryCapital,2000000);assert.equal(data.cash,3000000);
});

test('only complete real calendar dates enter monthly counts and no missing sale date falls back to purchase date',()=>{
 for(const date of ['2024-02-29','2024/2/29',' 2024.02.29 '])assert.equal(M.monthOf(date),'2024-02');
 for(const date of ['2023-02-29','2024-04-31','2024-02','2024-02-29T00:00:00Z','',null,123])assert.equal(M.monthOf(date),null,String(date));
 const rows=frozen([
  {status:'판매완료',purchaseAt:'2024-02-29',soldAt:'2024-02-29',inventoryCost:1000,margin:11},
  {status:'판매완료',purchaseAt:'2024/2/29',soldAt:'2024/2/29',inventoryCost:1000,margin:11},
  {status:'판매완료',purchaseAt:'2024.02.29',soldAt:'2024.02.29',inventoryCost:1000,margin:11},
  {status:'판매완료',purchaseAt:'2024-02-29',soldAt:'2024-02-30',inventoryCost:1000,margin:999},
  {status:'판매완료',purchaseAt:'2024-02-29',inventoryCost:1000,margin:999},
  {status:'판매중',purchaseAt:'2024-02-30',soldAt:'2024-02-29',inventoryCost:500,inventoryLoan:200,margin:999}
 ]),data=M.summarize(rows,'2024-02');
 assert.equal(data.monthPurchaseCount,5);assert.equal(data.monthSaleCount,3);
 assert.equal(data.monthMargin,33);assert.equal(data.yearMargin,33);
 assert.equal(data.inventoryCapital,200);assert.equal(data.totalInvestment,500);assert.equal(data.cash,300);
 assert.deepEqual(data.series.at(-1),{month:'2024-02',purchases:5,sales:3,margin:33});
});

test('empty dashboards have three zero months and zero calculated capital and cash',()=>{
 const data=M.summarize([],'2027-01');
 assert.deepEqual(data.series,[
  {month:'2026-11',purchases:0,sales:0,margin:0},
  {month:'2026-12',purchases:0,sales:0,margin:0},
  {month:'2027-01',purchases:0,sales:0,margin:0}
 ]);
 for(const key of ['inventoryCapital','monthPurchaseCount','monthSaleCount','monthMargin','yearMargin','inventoryMargin'])assert.equal(data[key],0,key);
 assert.equal(data.cash,0);assert.equal(data.totalInvestment,0);
 assert.deepEqual(data.inventoryRecent,[]);assert.deepEqual(data.soldRecent,[]);
});

test('realized losses stay negative in monthly, yearly and chart summaries',()=>{
 const rows=frozen([
  {id:'loss',status:'판매완료',purchaseAt:'2027-02-01',soldAt:'2027-03-01',inventoryCost:1000000,margin:-5000},
  {id:'gain',status:'판매완료',purchaseAt:'2027-02-02',soldAt:'2027-03-02',inventoryCost:1000000,margin:2000}
 ]),data=M.summarize(rows,'2027-03');
 assert.equal(data.monthSaleCount,2);assert.equal(data.monthMargin,-3000);assert.equal(data.yearMargin,-3000);
 assert.deepEqual(data.series.at(-1),{month:'2027-03',purchases:0,sales:2,margin:-3000});
});

test('recent workflow lists use their own dates, retain only four entries and leave frozen records unchanged',()=>{
 const dates=['2027-01-02','2027-03-02','2027-02-10','2027-03-04','2027-03-01','2027-03-03'];
 const rows=frozen(dates.flatMap((date,index)=>[
  {id:'stock-'+index,status:'판매중',purchaseAt:date,inventoryCost:1000+index,margin:100},
  {id:'sale-'+index,status:'판매완료',purchaseAt:'2026-01-01',soldAt:date,inventoryCost:2000+index,margin:index-3}
 ])),before=JSON.stringify(rows),data=M.summarize(rows,'2027-03');
 assert.deepEqual(data.inventoryRecent.map(row=>row.id),['stock-3','stock-5','stock-1','stock-4']);
 assert.deepEqual(data.soldRecent.map(row=>row.id),['sale-3','sale-5','sale-1','sale-4']);
 assert.equal(JSON.stringify(rows),before,'Summarizing and sorting must never mutate stored vehicle records');
});

test('dashboard uses the Korean calendar at the UTC month and year boundary',()=>{
 assert.equal(M.currentMonth(new Date('2026-12-31T14:59:59.999Z')),'2026-12');
 assert.equal(M.currentMonth(new Date('2026-12-31T15:00:00.000Z')),'2027-01');
 assert.equal(M.currentMonth(new Date('2024-02-29T15:00:00.000Z')),'2024-03');
});

test('invalid report inputs and unsafe cost totals fail explicitly',()=>{
 for(const month of ['2027-13','0000-01','2027-3',null])assert.throws(()=>M.summarize([],month));
 for(const rows of [null,{},'cars'])assert.throws(()=>M.summarize(rows,'2027-03'));
 for(const inventoryCost of [1.5,NaN,Infinity,'1000',true,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>M.summarize([{inventoryCost,status:'판매중'}],'2027-03'));
 for(const inventoryLoan of [-1,1.5,NaN,Infinity,'1000',true,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>M.summarize([{inventoryCost:0,inventoryLoan}],'2027-03'));
 assert.throws(()=>M.summarize([{inventoryCost:Number.MAX_SAFE_INTEGER},{inventoryCost:1}],'2027-03'));
 assert.throws(()=>M.summarize([{inventoryLoan:Number.MAX_SAFE_INTEGER},{inventoryLoan:1}],'2027-03'));
 assert.throws(()=>M.summarize([{inventoryCost:-Number.MAX_SAFE_INTEGER,inventoryLoan:2}],'2027-03'),'An unsafe derived cash value must not be rounded or displayed');
});
