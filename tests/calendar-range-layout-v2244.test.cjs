'use strict';
// Synthetic records only: check the inclusive period projection consumed by the DOM calendar.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={document:{},addEventListener(){}};
vm.runInNewContext(fs.readFileSync(require.resolve('../assets/dealer-scheduler.js'),'utf8'),{window:root});
const M=root.SnoteDealerSchedulerUI.model,plain=value=>JSON.parse(JSON.stringify(value));
const period=(id,start,end=start,extra={})=>({id,eventDate:start,endDate:end,title:'가상 일정 '+id,time:null,completed:false,...extra});
const days=(start,count)=>Array.from({length:count},(_,index)=>{const date=new Date(start+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+index);return date.toISOString().slice(0,10);});

test('periods include both endpoints while legacy one-day records remain one day',()=>{
 const item=period('a','2026-11-03','2026-11-07');
 assert.deepEqual(plain(M.occurrenceSpan(item)),{start:'2026-11-03',end:'2026-11-07'});
 for(const day of['2026-11-03','2026-11-04','2026-11-07'])assert.equal(M.coversDay(item,day),true);
 for(const day of['2026-11-02','2026-11-08','2026-11-99',null])assert.equal(M.coversDay(item,day),false);
 assert.deepEqual(plain(M.occurrenceSpan({id:'legacy',eventDate:'2026-11-03'})),{start:'2026-11-03',end:'2026-11-03'});
});
test('repeating occurrence display dates do not overwrite canonical series dates',()=>{
 const item=Object.freeze(period('series','2026-01-31','2026-02-02',{recurrence:'monthly',occurrenceId:'series@2026-11-30',occurrenceStartDate:'2026-11-30',occurrenceEndDate:'2026-12-02'})),before=JSON.stringify(item);
 assert.deepEqual(plain(M.occurrenceSpan(item)),{start:'2026-11-30',end:'2026-12-02'});
 assert.equal(M.coversDay(item,'2026-02-01'),false);assert.equal(M.coversDay(item,'2026-12-02'),true);
 assert.equal(item.eventDate,'2026-01-31');assert.equal(JSON.stringify(item),before);
});
test('invalid explicit occurrence dates fail closed rather than showing canonical dates',()=>{
 for(const item of[period('a','2026-11-03','2026-11-02'),period('a','2026-02-30'),period('a','2026-11-03',undefined,{occurrenceStartDate:'bad',occurrenceEndDate:'2026-11-04'}),period('a','2026-11-03',undefined,{occurrenceStartDate:'2026-11-03',occurrenceEndDate:null})])assert.equal(M.occurrenceSpan(item),null);
});
test('one multiweek period retains one lane and clipped indices across every covered week',()=>{
 const range=days('2026-11-01',35),items=[period('long','2026-10-28','2026-11-26'),period('short','2026-11-02','2026-11-04')],layout=M.calendarLanes(items,range),long=layout.find(item=>item.item.id==='long');
 assert.equal(long.lane,0);assert.equal(long.startIndex,0);assert.equal(long.endIndex,25);
 assert.equal(layout.find(item=>item.item.id==='short').lane,1);
 for(const row of[0,1,2,3])assert.equal(layout.filter(item=>item.endIndex>=row*7&&item.startIndex<=row*7+6).find(item=>item.item.id==='long').lane,0);
});
test('inclusive overlaps use separate lanes; a lane is reused after its final day',()=>{
 const layout=M.calendarLanes([period('a','2026-11-02','2026-11-04'),period('b','2026-11-04','2026-11-05'),period('c','2026-11-05','2026-11-07')],days('2026-11-01',35));
 assert.deepEqual(plain(layout.map(item=>[item.item.id,item.lane])),[['a',0],['b',1],['c',0]]);
});
test('lane order is deterministic when server record order changes and never mutates input',()=>{
 const records=[period('z','2026-11-02','2026-11-03'),period('a','2026-11-02','2026-11-06'),period('b','2026-11-02','2026-11-06',{time:'09:30'})],before=JSON.stringify(records),range=days('2026-11-01',35),shape=items=>plain(M.calendarLanes(items,range).map(({key,lane,startIndex,endIndex})=>({key,lane,startIndex,endIndex})));
 assert.deepEqual(shape(records),shape([...records].reverse()));assert.equal(JSON.stringify(records),before);
 assert.equal(Object.isFrozen(M.calendarLanes(records,range)[0]),true);assert.equal(Object.isFrozen(records[0]),false);
});
test('distinct repeating occurrences keep separate identities and duplicate projections cannot inflate lanes',()=>{
 const first=period('repeat','2026-11-01','2026-11-02',{occurrenceId:'repeat@2026-11-01',occurrenceStartDate:'2026-11-01',occurrenceEndDate:'2026-11-02'}),second={...first,occurrenceId:'repeat@2026-11-08',occurrenceStartDate:'2026-11-08',occurrenceEndDate:'2026-11-09'},range=days('2026-11-01',35);
 assert.equal(M.calendarLanes([first,{...first},second],range).length,2);
 assert.deepEqual(plain(M.calendarLanes([first,{...first,title:'conflict'},first,second],range).map(item=>item.key)),['repeat@2026-11-08']);
});
test('calendar boundaries preserve null cell positions and skip out-of-window periods',()=>{
 const range=[null,...days('0001-01-01',5),null],layout=M.calendarLanes([period('edge','0001-01-01','0001-01-05'),period('later','0001-02-01')],range);
 assert.equal(layout.length,1);assert.equal(layout[0].startIndex,1);assert.equal(layout[0].endIndex,5);
 assert.deepEqual(plain(M.calendarLanes([period('a','2026-11-01')],[null,null])),[]);
});
test('readable period labels distinguish a day, a range and a year boundary',()=>{
 assert.equal(M.periodText(period('a','2026-11-03')),'11월 3일');
 assert.equal(M.periodText(period('a','2026-11-03','2026-11-08')),'11월 3일–11월 8일');
 assert.equal(M.periodText(period('a','2026-12-30','2027-01-02')),'2026년 12월 30일–2027년 1월 2일');
});
