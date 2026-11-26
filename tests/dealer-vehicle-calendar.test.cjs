'use strict';
// Pure date-only projection. A synthetic document exposes the existing UI model without mounting DOM or sending requests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={document:{},addEventListener(){}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/dealer-scheduler.js'),'utf8'),{window:root});
const M=root.SnoteDealerSchedulerUI.model,plain=value=>JSON.parse(JSON.stringify(value));
const row=(id,values={})=>({id,model:'가상 차량',plate:'12가3456',purchaseAt:'2026-11-23',soldAt:'',status:'판매중',...values});
test('normalization accepts complete legacy date-only formats and rejects incomplete, overflowing or timestamp values',()=>{
 for(const value of['2026-11-23',' 2026/11/23 ','2026.11.23'])assert.equal(M.normalizeVehicleDate(value),'2026-11-23');
 assert.equal(M.normalizeVehicleDate('2024/2/29'),'2024-02-29');assert.equal(M.normalizeVehicleDate('0001-1-1'),'0001-01-01');assert.equal(M.normalizeVehicleDate('9999.12.31'),'9999-12-31');
 for(const value of[null,1,'','2026-11','2026-11-23T00:00:00Z','2026-02-29','1900-02-29','2026/4/31','0000-01-01','2026-13-01','2026-00-01','2026-01-00','10000-01-01'])assert.equal(M.normalizeVehicleDate(value),null,String(value));
});
test('every valid purchase date is retained, including vehicles already sold',()=>{
 const events=M.vehicleEvents([row('stock'),row('sold',{status:'판매완료',purchaseAt:'2026/10/1',soldAt:'2026-11-22'}),row('contract',{status:'계약중'}),row('repair',{status:'수리중'}),row('bad',{purchaseAt:'2026-02-30'})]);
 assert.deepEqual(plain(events.filter(e=>e.kind==='purchase').map(e=>e.vehicleId)).sort(),['contract','repair','sold','stock']);
 assert.equal(events.find(e=>e.vehicleId==='sold'&&e.kind==='purchase').eventDate,'2026-10-01');
});
test('sales require completed status and their own valid sale date; a purchase date is never a fallback',()=>{
 const events=M.vehicleEvents([row('sold',{status:'판매완료',soldAt:'2026.11.24'}),row('contract',{status:'계약중',soldAt:'2026-11-24'}),row('stock',{soldAt:'2026-11-24'}),row('undated',{status:'판매완료',soldAt:''}),row('partial',{status:'판매완료',soldAt:'2026-11'}),row('invalid',{status:'판매완료',soldAt:'2026-02-30'})]);
 assert.deepEqual(plain(events.filter(e=>e.kind==='sale').map(e=>[e.vehicleId,e.eventDate])),[['sold','2026-11-24']]);
});
test('duplicate records cannot inflate counts and conflicting duplicate identities are omitted',()=>{
 const a=row('duplicate',{status:'판매완료',soldAt:'2026-11-24'});assert.equal(M.vehicleEvents([a,{...a,purchaseAt:'2026/11/23'}]).length,2);
 assert.equal(M.vehicleEvents([a,{...a,purchaseAt:'2026-11-22'},a]).length,0);
 assert.equal(M.vehicleEvents([row(''),row(1),null]).length,0);
});
test('projection is readonly, leaves inputs intact and carries no money, customer or editable schedule fields',()=>{
 const original=Object.freeze(row('safe',{model:'<img src=x>',plate:'12가3456',buy:999,sell:999,inventoryLoan:999,notes:'must not copy',title:'must not copy',role:'must not copy',customer:{name:'must not copy'}})),before=JSON.stringify(original),events=M.vehicleEvents([original]);
 assert.equal(JSON.stringify(original),before);assert.equal(events[0].readOnly,true);assert(Object.isFrozen(events[0]));assert.equal(events[0].model,'<img src=x>');assert.deepEqual(Object.keys(events[0]).sort(),['eventDate','id','kind','model','plate','readOnly','vehicleId']);assert(!JSON.stringify(events).includes('must not copy'));
});
test('deterministic ordering distinguishes purchase and sale even on the same date',()=>{
 const events=M.vehicleEvents([row('z',{model:'B',status:'판매완료',soldAt:'2026-11-23'}),row('a',{model:'A',status:'판매완료',soldAt:'2026-11-23'})]);
 assert.deepEqual(plain(events.map(e=>[e.kind,e.vehicleId])),[['purchase','a'],['purchase','z'],['sale','a'],['sale','z']]);assert.equal(new Set(events.map(e=>e.id)).size,4);
});
test('two compact slots preserve both kinds of work and the more count includes all vehicle records',()=>{
 const personal=Array.from({length:4},(_,i)=>({id:'personal-'+i})),vehicles=M.vehicleEvents([row('a'),row('b'),row('c')]),s=M.daySummary(personal,vehicles,4);
 assert.equal(s.shown.length,2);assert.equal(s.shown[0].personal,true);assert.equal(s.shown[1].personal,false);assert.equal(s.total,7);assert.equal(s.remaining,5);
 assert.equal(M.daySummary([],vehicles,0).shown.length,2);assert.equal(M.daySummary(personal,[],4).shown.length,2);assert.equal(M.daySummary([],[],0).remaining,0);
});
test('server counts survive the personal 500-record bound without inventing loaded records',()=>{
 const personal=Array.from({length:500},(_,i)=>({id:'personal-'+i})),vehicles=M.vehicleEvents(Array.from({length:6},(_,i)=>row('car-'+i,{status:i<2?'판매완료':'판매중',soldAt:'2026-11-23'}))),s=M.daySummary(personal,vehicles,620);
 assert.equal(vehicles.length,8);assert.equal(s.total,628);assert.equal(s.remaining,626);assert.equal(s.shown.length,2);assert.equal(personal.length,500);
 const unloaded=M.daySummary([],vehicles,620);assert.equal(unloaded.total,628);assert.equal(unloaded.remaining,626);assert(unloaded.shown.every(entry=>entry.personal===false));
});

test('mobile three/four slots keep personal and vehicle entries and exact hidden totals',()=>{
 const personal=Array.from({length:5},(_,i)=>({id:'mobile-personal-'+i})),vehicles=M.vehicleEvents([row('a'),row('b'),row('c')]),before=JSON.stringify({personal,vehicles});
 for(const capacity of[3,4]){const s=M.daySummary(personal,vehicles,5,capacity);assert.equal(s.shown.length,capacity);assert(s.shown.some(entry=>entry.personal)&&s.shown.some(entry=>!entry.personal));assert.equal(new Set(s.shown.map(entry=>entry.item.id)).size,capacity);assert.equal(s.total,8);assert.equal(s.remaining,8-capacity);}
 assert.equal(JSON.stringify({personal,vehicles}),before,'Choosing visible mobile rows does not modify or invent records');
});
test('mobile more counts preserve server-truncated personal totals and use only loaded entries',()=>{
 const personal=[{id:'one-loaded'}],vehicles=M.vehicleEvents([row('a'),row('b'),row('c')]);
 for(const capacity of[3,4]){const s=M.daySummary(personal,vehicles,620,capacity);assert.equal(s.total,623);assert.equal(s.remaining,623-capacity);assert.equal(s.shown.length,capacity);assert.equal(s.shown.filter(entry=>entry.personal).length,1);}
 const unloaded=M.daySummary([],vehicles,620,4);assert.equal(unloaded.shown.length,3);assert(unloaded.shown.every(entry=>!entry.personal));assert.equal(unloaded.total,623);assert.equal(unloaded.remaining,620);
});

test('same raw IDs from two verified owner projections remain distinct and scoped duplicates do not inflate the calendar',()=>{
 const first='a1111111-1111-4111-8111-111111111111',second='b2222222-2222-4222-8222-222222222222',a=row('same-raw-id',{ownerId:first,status:'판매완료',soldAt:'2026-11-24'}),b=row('same-raw-id',{ownerId:second,status:'판매완료',soldAt:'2026-11-24'});
 const events=M.vehicleEvents([a,b,{...a,ownerId:first.toUpperCase()}]);
 assert.equal(events.length,4);assert.equal(new Set(events.map(e=>e.id)).size,4);assert.deepEqual(plain(events.filter(e=>e.kind==='purchase').map(e=>e.vehicleId)).sort(),[first+':same-raw-id',second+':same-raw-id']);
 const conflict=M.vehicleEvents([a,{...a,model:'같은 owner의 다른 payload'},b]);assert.equal(conflict.length,2);assert(conflict.every(e=>e.vehicleId===second+':same-raw-id'));
});
test('a legal 200-character raw vehicle ID survives the owner prefix without truncation or lost purchase/sale dates',()=>{
 const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',raw='가'.repeat(200),input=[row(raw,{ownerId:first,status:'판매완료',soldAt:'2026-11-24'}),row(raw,{ownerId:second,status:'판매완료',soldAt:'2026-11-24'})],before=JSON.stringify(input),events=M.vehicleEvents(input);
 assert.equal(events.length,4);assert.equal(new Set(events.map(e=>e.id)).size,4);assert(events.every(e=>e.vehicleId.length===237&&e.vehicleId.endsWith(':'+raw)));assert.deepEqual(plain(events.map(e=>e.eventDate)),['2026-11-23','2026-11-23','2026-11-24','2026-11-24']);assert.equal(JSON.stringify(input),before);
 const unscoped=M.vehicleEvents([row(raw)]);assert.equal(unscoped.length,1);assert.equal(unscoped[0].vehicleId,raw);assert.equal(unscoped[0].id,'purchase:'+raw+':2026-11-23');
});
test('explicit invalid owner IDs and oversized raw IDs fail closed without accepting role metadata as authority',()=>{
 const valid='11111111-1111-4111-8111-111111111111';
 for(const ownerId of[undefined,null,'',1,{},'hidden-owner',valid+'x','https://outside.example.invalid/owner'])assert.equal(M.vehicleEvents([row('bad-owner',{ownerId,role:'accountant',companyId:'forged-company'})]).length,0,String(ownerId));
 assert.equal(M.vehicleEvents([row('x'.repeat(201))]).length,0);assert.equal(M.vehicleEvents([row('x'.repeat(201),{ownerId:valid,role:'admin'})]).length,0);
 const own=M.vehicleEvents([row('legacy-own',{role:'accountant',companyId:'forged-company'})]);assert.equal(own.length,1);assert.equal(own[0].vehicleId,'legacy-own');assert.equal(own[0].id,'purchase:legacy-own:2026-11-23');assert.deepEqual(Object.keys(own[0]).sort(),['eventDate','id','kind','model','plate','readOnly','vehicleId']);
});
