'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const M=require('../assets/home-dashboard.js');
const frozen=rows=>Object.freeze(rows.map(row=>Object.freeze(row)));

test('dashboard keeps won amounts and separates inventory, purchases and completed-sale margins',()=>{
 const rows=frozen([
  {id:'stock-a',status:'판매중',purchaseAt:'2027-03-04',inventoryCost:12345678,margin:2000000},
  {id:'stock-b',status:'수리중',purchaseAt:'2027-02-18',inventoryCost:8000000,margin:-100000},
  {id:'sale-march',status:'판매완료',purchaseAt:'2027-03-01',soldAt:'2027-03-10',inventoryCost:10000000,margin:3000000},
  {id:'sale-february',status:'판매완료',purchaseAt:'2027-01-14',soldAt:'2027-02-28',inventoryCost:7000000,margin:-250000},
  {id:'sale-january',status:'판매완료',purchaseAt:'2026-12-25',soldAt:'2027-01-02',inventoryCost:5000000,margin:450000},
  {id:'prior-year',status:'판매완료',purchaseAt:'2027-02-01',soldAt:'2026-12-31',inventoryCost:6000000,margin:900000},
  {id:'future',status:'판매완료',purchaseAt:'2027-04-01',soldAt:'2027-04-02',inventoryCost:9000000,margin:8000000}
 ]),before=JSON.stringify(rows),data=M.summarize(rows,'2027-03');
 assert.equal(data.inventoryCapital,20345678);
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

test('unknown cash remains unknown while a confirmed zero or balance can produce total investment',()=>{
 const rows=frozen([{id:'stock',status:'판매중',purchaseAt:'2027-03-01',inventoryCost:1234567,margin:100000}]);
 const unknown=M.summarize(rows,'2027-03');
 assert.equal(unknown.cash,null);assert.equal(unknown.totalInvestment,null);
 const zero=M.summarize(rows,'2027-03',0);
 assert.equal(zero.cash,0);assert.equal(zero.totalInvestment,1234567);
 const funded=M.summarize(rows,'2027-03',7654321);
 assert.equal(funded.cash,7654321);assert.equal(funded.totalInvestment,8888888);
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
  {status:'판매중',purchaseAt:'2024-02-30',soldAt:'2024-02-29',inventoryCost:500,margin:999}
 ]),data=M.summarize(rows,'2024-02');
 assert.equal(data.monthPurchaseCount,5);assert.equal(data.monthSaleCount,3);
 assert.equal(data.monthMargin,33);assert.equal(data.yearMargin,33);
 assert.equal(data.inventoryCapital,500);
 assert.deepEqual(data.series.at(-1),{month:'2024-02',purchases:5,sales:3,margin:33});
});

test('empty dashboards have three zero months without inventing a cash balance',()=>{
 const data=M.summarize([],'2027-01');
 assert.deepEqual(data.series,[
  {month:'2026-11',purchases:0,sales:0,margin:0},
  {month:'2026-12',purchases:0,sales:0,margin:0},
  {month:'2027-01',purchases:0,sales:0,margin:0}
 ]);
 for(const key of ['inventoryCapital','monthPurchaseCount','monthSaleCount','monthMargin','yearMargin','inventoryMargin'])assert.equal(data[key],0,key);
 assert.equal(data.cash,null);assert.equal(data.totalInvestment,null);
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

test('invalid report inputs and unconfirmed cash values fail explicitly',()=>{
 for(const month of ['2027-13','0000-01','2027-3',null])assert.throws(()=>M.summarize([],month));
 for(const rows of [null,{},'cars'])assert.throws(()=>M.summarize(rows,'2027-03'));
 for(const cash of [-1,1.5,NaN,Infinity,'1000',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>M.summarize([],'2027-03',cash));
});
