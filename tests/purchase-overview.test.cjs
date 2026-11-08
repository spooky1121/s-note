'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const M=require('../assets/purchase-overview.js');

test('purchase history includes completed sales and uses purchase dates instead of sale dates',()=>{
 const rows=Object.freeze([
  Object.freeze({status:'판매중',purchaseAt:'2027-01-03'}),
  Object.freeze({status:'판매완료',purchaseAt:'2027-01-12',soldAt:'2027-02-01'}),
  Object.freeze({status:'매입진행',purchaseAt:'2027-01-20'}),
  Object.freeze({status:'수리중',purchaseAt:'2027-01-31'}),
  Object.freeze({status:'판매완료',purchaseAt:'2026-12-31',soldAt:'2027-01-01'})
 ]),before=JSON.stringify(rows),summary=M.summarize(rows,'2027-01');
 assert.deepEqual([summary.current,summary.previous,summary.total,summary.undated],[4,1,5,0]);
 assert.deepEqual(summary.previousDelta,{change:3,percent:300,tone:'up'});
 assert.equal(JSON.stringify(rows),before);
});

test('six-month purchases and previous-year comparisons retain independent reporting windows',()=>{
 const groups=[['2027-01-01',3],['2027-01-31',2],['2026-12-31',2],['2026-11-01',4],['2026-08-01',1],['2026-07-31',20],['2026-01-31',4],['2027-02-01',6]];
 const rows=Object.freeze(groups.flatMap(([purchaseAt,count])=>Array.from({length:count},(_,index)=>Object.freeze({purchaseAt,status:index%2?'판매중':'판매완료'})))),before=JSON.stringify(rows),summary=M.summarize(rows,'2027-01');
 assert.deepEqual(summary.series,[{month:'2026-08',count:1},{month:'2026-09',count:0},{month:'2026-10',count:0},{month:'2026-11',count:4},{month:'2026-12',count:2},{month:'2027-01',count:5}]);
 assert.deepEqual([summary.current,summary.previous,summary.lastYear,summary.total,summary.undated],[5,2,4,12,0]);
 assert.deepEqual(summary.previousDelta,{change:3,percent:150,tone:'up'});
 assert.deepEqual(summary.yearDelta,{change:1,percent:25,tone:'up'});
 assert.equal(JSON.stringify(rows),before);
});

test('missing or invalid purchase dates are reported separately without sale-date fallback',()=>{
 const dates=['2024-02-29','2024/2/29',' 2024.02.29 ','2023-02-29','2026-04-31','2024-02','2024-02-29T00:00:00Z','',null];
 const summary=M.summarize(dates.map(purchaseAt=>({purchaseAt,soldAt:'2024-02-01',status:'판매완료'})),'2024-02');
 assert.deepEqual([summary.current,summary.total,summary.undated],[3,3,6]);
 const absent=M.summarize([{soldAt:'2024-02-01'}],'2024-02');
 assert.deepEqual([absent.current,absent.undated],[0,1]);
});

test('empty and zero-baseline purchase reports never fabricate growth percentages',()=>{
 const empty=M.summarize([],'2026-11');
 assert.equal(empty.series.length,6);assert(empty.series.every(item=>item.count===0));
 assert.deepEqual([empty.current,empty.previous,empty.lastYear,empty.total,empty.undated],[0,0,0,0,0]);
 assert.deepEqual(empty.previousDelta,{change:0,percent:null,tone:'same'});
 const positive=M.summarize([{purchaseAt:'2026-11-01'}],'2026-11');
 assert.deepEqual(positive.previousDelta,{change:1,percent:null,tone:'up'});
 assert.deepEqual(positive.yearDelta,{change:1,percent:null,tone:'up'});
 const declining=M.summarize([{purchaseAt:'2026-10-01'}],'2026-11');
 assert.deepEqual(declining.previousDelta,{change:-1,percent:-100,tone:'down'});
});

test('invalid reporting inputs fail explicitly instead of showing plausible purchase totals',()=>{
 for(const month of ['2026-13','0000-01','2026-1',null])assert.throws(()=>M.summarize([],month),/INVALID_PURCHASE_DATA/);
 assert.throws(()=>M.summarize(null,'2026-11'),/INVALID_PURCHASE_DATA/);
 assert.throws(()=>M.summarize({},'2026-11'),/INVALID_PURCHASE_DATA/);
});
