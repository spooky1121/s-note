'use strict';
// Official, independently transcribed annual dates. No network, DB, Intl lunar rules or clock dependence.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const FILE=path.join(__dirname,'../assets/korean-holidays.js'),SOURCE=fs.readFileSync(FILE,'utf8');
function load(extra={}){const window={},context=vm.createContext({window,...extra});vm.runInContext(SOURCE,context);return{api:window.SnoteKoreanHolidays,context};}
const {api}=load();
const dates=(year,month)=>[...api.getMonth(year,month).keys()].map(date=>date.slice(5));
test('2026 matches published lunar dates, announced election and the effective new holidays',()=>{
 assert.deepEqual(dates(2026,2),['02-16','02-17','02-18']);
 assert.equal(api.getDate('2026-02-17'),'설날');
 assert.deepEqual(dates(2026,5),['05-01','05-05','05-24','05-25']);
 assert.equal(api.getDate('2026-05-01'),'노동절');
 assert.equal(api.getDate('2026-07-17'),'제헌절');
 assert.equal(api.getDate('2026-06-03'),'제9회 전국동시지방선거');
 assert.deepEqual(dates(2026,9),['09-24','09-25','09-26']);
 assert.equal(api.getYear(2026).size,22);
});
test('2027 KASA almanac: Korean Seollal is February 7 and all seven substitute days are retained',()=>{
 assert.deepEqual(dates(2027,2),['02-06','02-07','02-08','02-09']);
 assert.equal(api.getDate('2027-02-06'),'설날 전날');
 assert.equal(api.getDate('2027-02-07'),'설날');
 assert.equal(api.getDate('2027-05-13'),'부처님오신날');
 assert.deepEqual(dates(2027,9),['09-14','09-15','09-16']);
 const substitutes=[...api.getYear(2027)].filter(([,name])=>name.startsWith('대체공휴일'));
 assert.deepEqual(substitutes.map(([day])=>day),['2027-02-09','2027-05-03','2027-07-19','2027-08-16','2027-10-04','2027-10-11','2027-12-27']);
 assert.equal(api.getYear(2027).size,24);
 // KASA total: 52 ordinary Sundays plus 24 named dates, less four overlapping Sundays = 72.
 assert.equal(52+api.getYear(2027).size-[...api.getYear(2027).keys()].filter(day=>new Date(day+'T12:00:00Z').getUTCDay()===0).length,72);
});
test('no substitute is invented for Saturday-only Chuseok, Memorial Day, or New Year',()=>{
 for(const day of ['2026-09-28','2026-06-08','2027-06-07','2027-01-04'])assert.equal(api.getDate(day),'',day);
 assert.equal(api.getDate('2026-08-17'),'대체공휴일(광복절)');
 assert.equal(api.getDate('2026-10-05'),'대체공휴일(개천절)');
});
test('2024 includes published election and separately announced temporary holiday',()=>{
 assert.equal(api.getDate('2024-04-10'),'제22대 국회의원선거');
 assert.equal(api.getDate('2024-10-01'),'임시공휴일(국군의 날)');
 assert.deepEqual(dates(2024,2),['02-09','02-10','02-11','02-12']);
 assert.deepEqual(dates(2024,9),['09-16','09-17','09-18']);
 assert.equal(api.getYear(2024).size,19);
});
test('2025 keeps both May 5 names and exactly one substitute plus confirmed temporary/election days',()=>{
 assert.equal(api.getDate('2025-05-05'),'어린이날 · 부처님오신날');
 assert.equal(api.getDate('2025-05-06'),'대체공휴일(부처님오신날)');
 assert.equal(api.getDate('2025-05-07'),'');
 assert.equal(api.getDate('2025-01-27'),'임시공휴일');
 assert.equal(api.getDate('2025-06-03'),'제21대 대통령선거');
 assert.equal(api.getDate('2025-10-08'),'대체공휴일(추석)');
 assert.equal(api.getDate('2025-10-10'),'','No unannounced bridge day');
 assert.equal(api.getYear(2025).size,19);
});
test('2026 legal changes do not create retroactive Labour or Constitution holidays',()=>{
 for(const year of [2024,2025])for(const suffix of ['05-01','07-17'])assert.equal(api.getDate(year+'-'+suffix),'');
 assert.equal(api.getDate('2027-05-03'),'대체공휴일(노동절)');
 assert.equal(api.getDate('2027-07-19'),'대체공휴일(제헌절)');
});
test('coverage is explicit and unsupported years never constrain or invent calendar data',()=>{
 assert.deepEqual([...api.coverage.years],[2024,2025,2026,2027]);
 assert.equal(api.version,'2026-11-24');
 assert.equal(api.coverage.verifiedAt,'2026-11-24');
 assert.equal(api.coverage.from,2024);assert.equal(api.coverage.to,2027);
 assert.equal(api.coverage.firstYear,2024);assert.equal(api.coverage.lastYear,2027);
 for(const year of [2023,2028,2029,2030,2050,1,9999,NaN,Infinity,'2026',null]){assert.equal(api.hasYear(year),false);assert.equal(api.getYear(year).size,0);assert.equal(api.getMonth(year,1).size,0);}
 assert.equal(api.getDate('2023-12-25'),'');assert.equal(api.getDate('2028-01-01'),'');
 assert.equal(api.getDate('2027-03-07'),'','Ordinary Sundays belong to UI weekday styling');
 for(const month of [0,13,1.5,NaN,'2',undefined])assert.equal(api.getMonth(2026,month).size,0);
 for(const day of ['2026-02-30','2026-2-17','2026-02-17T00:00:00Z','2026-02-17<script>',null,new Date()])assert.equal(api.getDate(day),'');
});
test('month/year copies cannot mutate later lookups or another calendar instance',()=>{
 const first=api.getMonth(2027,2);first.delete('2027-02-07');first.set('2027-02-01','fake');
 assert.equal(api.getDate('2027-02-07'),'설날');assert.equal(api.getDate('2027-02-01'),'');
 const year=api.getYear(2027);year.clear();assert.equal(api.getYear(2027).size,24);
 const other=load().api;assert.equal(other.getDate('2027-02-07'),'설날');
 assert(Object.isFrozen(api));assert(Object.isFrozen(api.coverage));assert(Object.isFrozen(api.coverage.years));
});
test('data works without Intl, Date, timers, network or persistent storage and installs once',()=>{
 const deny=new Proxy(function(){throw Error('forbidden side effect');},{get(){throw Error('forbidden side effect');}});
 const f=load({Intl:deny,Date:deny,fetch:deny,localStorage:deny,indexedDB:deny,setTimeout:deny});
 assert.equal(f.api.getDate('2027-02-07'),'설날');
 vm.runInContext(SOURCE,f.context);assert.equal(f.context.window.SnoteKoreanHolidays,f.api);
});
test('results are identical in Seoul, UTC and an American time zone',()=>{
 const prior=process.env.TZ;
 try{const outputs=['Asia/Seoul','UTC','America/Los_Angeles'].map(TZ=>{process.env.TZ=TZ;return JSON.stringify([...load().api.getYear(2027)]);});assert.equal(outputs[0],outputs[1]);assert.equal(outputs[1],outputs[2]);}
 finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
