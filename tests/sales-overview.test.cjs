'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const M=require('../assets/sales-overview.js');
test('Korean current month is stable across UTC month/year boundary and host timezone',()=>{
 for(const tz of ['UTC','America/Los_Angeles','Asia/Seoul']){process.env.TZ=tz;assert.equal(M.currentMonth(new Date('2026-12-31T14:59:59.999Z')),'2026-12');assert.equal(M.currentMonth(new Date('2026-12-31T15:00:00.000Z')),'2027-01');assert.equal(M.currentMonth(new Date('2026-02-28T15:00:00Z')),'2026-03');}
});
test('saved date-only formats require a real complete calendar date',()=>{
 for(const value of ['2024-02-29','2024/2/29',' 2024.02.29 '])assert.equal(M.soldMonth(value),'2024-02');
 for(const value of ['2023-02-29','2026-04-31','2026-00-01','2026-01-00','2026-13-01','0000-01-01','2026-01','2026-01-01T00:00:00Z','2026/1/3oops','',null,123])assert.equal(M.soldMonth(value),null,String(value));
 assert.equal(M.soldMonth('2000-02-29'),'2000-02');assert.equal(M.soldMonth('1900-02-29'),null);
});
test('six-month series and independent monthly/year comparisons use only completed sales',()=>{
 const rows=[['2027-01-01',3],['2027-01-31',2],['2026-12-31',2],['2026-11-01',4],['2026-08-01',1],['2026-07-31',20],['2026-01-31',4],['2027-02-01',6]].flatMap(([soldAt,n])=>Array.from({length:n},(_,i)=>Object.freeze({id:soldAt+'-'+i,ownerId:'scope-a',status:'판매완료',soldAt})));
 rows.push(Object.freeze({status:'판매중',soldAt:'2027-01-01'}),Object.freeze({status:'판매완료',soldAt:'2027-01'}),Object.freeze({status:'판매완료',soldAt:null}));Object.freeze(rows);const before=JSON.stringify(rows),s=M.summarize(rows,'2027-01');
 assert.deepEqual(s.series,[{month:'2026-08',count:1},{month:'2026-09',count:0},{month:'2026-10',count:0},{month:'2026-11',count:4},{month:'2026-12',count:2},{month:'2027-01',count:5}]);
 assert.deepEqual([s.current,s.previous,s.lastYear,s.total,s.undated],[5,2,4,12,2]);assert.deepEqual(s.previousDelta,{change:3,percent:150,tone:'up'});assert.deepEqual(s.yearDelta,{change:1,percent:25,tone:'up'});assert.equal(JSON.stringify(rows),before);
});
test('empty and zero baselines avoid fabricated percentages or Infinity',()=>{
 const empty=M.summarize([],'2026-11');assert.equal(empty.series.length,6);assert(empty.series.every(x=>x.count===0));assert.deepEqual([empty.current,empty.total,empty.undated],[0,0,0]);assert.deepEqual(empty.previousDelta,{change:0,percent:null,tone:'same'});
 assert.deepEqual(M.compare(3,0),{change:3,percent:null,tone:'up'});assert.deepEqual(M.compare(0,3),{change:-3,percent:-100,tone:'down'});assert.deepEqual(M.compare(2,3),{change:-1,percent:-33.3,tone:'down'});
});
test('month shifts handle December/January, leap years and invalid inputs explicitly',()=>{
 assert.equal(M.shiftMonth('2027-01',-1),'2026-12');assert.equal(M.shiftMonth('2027-01',-12),'2026-01');assert.equal(M.shiftMonth('2026-12',1),'2027-01');assert.equal(M.shiftMonth('2024-02',-5),'2023-09');assert.equal(M.shiftMonth('0001-01',-1),null);assert.equal(M.shiftMonth('9999-12',1),null);
 for(const month of ['2026-13','0000-01','2026-1',null]){assert.throws(()=>M.summarize([],month),/INVALID_SALES_DATA/);assert.throws(()=>M.shiftMonth(month,1),/INVALID_MONTH/);}assert.throws(()=>M.summarize(null,'2026-01'),/INVALID_SALES_DATA/);
});
