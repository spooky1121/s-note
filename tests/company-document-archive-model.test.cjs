'use strict';
// Pure projection from the actual archive module. Fixtures contain no customer data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'assets/contract-office.js'),'utf8'),marker=' window.SnoteContractOffice=Object.freeze';
assert.equal(source.split(marker).length,2,'The module has exactly one API boundary');
const window={addEventListener(){},dispatchEvent(){}},sandbox={window,Event:class Event{},Intl,Date,Map,Set,JSON};
vm.runInNewContext(source.replace(marker,' window.__archiveModel={vehicles:archiveVehicleProjection,project:archiveProjection,money:archiveMoney};\n'+marker),sandbox);
const model=window.__archiveModel,plain=value=>JSON.parse(JSON.stringify(value));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const car=(id,ownerId=A,overrides={})=>({id,ownerId,plate:'가상번호',model:'가상 차량',purchaseAt:'2026-11-20',buy:12345678,status:'판매중',...overrides});
const record=(id,carOwnerId=A,carId='one',overrides={})=>({id,carOwnerId,carId,documentKind:'purchase',updatedAt:'2026-11-20T10:00:00Z',payload:{plate:'가상번호',model:'가상 문서 차량',sellerName:'가상 양도인',buyerName:'가상 양수인',contractDate:'2026-11-20'},...overrides});

test('company vehicle projection includes unsaved, sold and former-owner rows',()=>{
 const vehicles=[car('unsaved'),car('sold',B,{status:'판매완료'}),car('former',C,{ownerName:'가상 이전 직원'})],before=JSON.stringify(vehicles),result=model.project(vehicles,[]);
 assert.equal(result.rows.length,3);assert(result.rows.every(row=>row.record===null&&row.buyer===''));assert.equal(result.legacy.length,0);assert.equal(JSON.stringify(vehicles),before);
});
test('document joins require owner UUID plus original car ID',()=>{
 const records=[record('owner-a',A,'same'),record('owner-b',B,'same',{payload:{buyerName:'다른 가상 양수인'}}),record('foreign-owner',C,'same',{updatedAt:'2026-11-25T10:00:00Z',payload:{buyerName:'연결하지 않을 가상 이름'}})],result=model.project([car('same',A),car('same',B)],records);
 assert.deepEqual(plain(result.rows.map(row=>[row.car.ownerId,row.record.id,row.buyer])),[[A,'owner-a','가상 양수인'],[B,'owner-b','다른 가상 양수인']]);assert.deepEqual(plain(result.legacy.map(row=>row.id)),['foreign-owner']);
});
test('the latest linked document supplies its saved transferee without inference',()=>{
 const older=record('older'),newer=record('newer',A,'one',{documentKind:'sale',updatedAt:'2026-11-21T10:00:00Z',payload:{buyerName:'최신 가상 양수인'}}),result=model.project([car('one')],[older,newer]);
 assert.equal(result.rows[0].record.id,'newer');assert.equal(result.rows[0].buyer,'최신 가상 양수인');assert.deepEqual(plain(result.legacy.map(row=>row.id)),['older']);
 const empty=model.project([car('one',A,{ownerName:'담당자 이름'})],[{...newer,payload:{buyerName:''}}]);assert.equal(empty.rows[0].buyer,'');
});
test('manual, removed-car and older linked documents remain available as history',()=>{
 const docs=[record('manual',null,null),record('removed',B,'gone'),record('older',A,'one'),record('current',A,'one',{updatedAt:'2026-11-22T00:00:00Z'})],result=model.project([car('one')],docs);
 assert.equal(result.rows[0].record.id,'current');assert.deepEqual(plain(result.legacy.map(row=>row.id)).sort(),['manual','older','removed']);assert.equal(new Set(result.legacy.map(row=>row.id)).size,3);
});
test('purchase order is deterministic and invalid historical dates stay unknown',()=>{
 const rows=[car('b',B),car('a',A),car('new',C,{purchaseAt:'2026-11-25'}),car('unknown',A,{purchaseAt:'2026-02-30'})],before=JSON.stringify(rows),result=model.project(rows,[]);
 assert.deepEqual(plain(result.rows.map(row=>row.car.id)),['new','a','b','unknown']);assert.equal(result.rows.at(-1).car.purchaseAt,'');assert.equal(JSON.stringify(rows),before);
});
test('vehicle search covers the six displayed values without moving current documents into history',()=>{
 const vehicles=[car('one')],docs=[record('current')];assert.equal(model.project(vehicles,docs,'가상 양수인').rows.length,1);assert.equal(model.project(vehicles,docs,'12,345,678원').rows.length,1);assert.equal(model.project(vehicles,docs,'2026-11-20').rows.length,1);assert.equal(model.project(vehicles,docs,'no match').rows.length,0);assert.equal(model.project(vehicles,docs,'가상 문서 차량').legacy.length,0);
});
test('ambiguous canonical duplicates and invalid identities fail rather than merge silently',()=>{
 assert.throws(()=>model.vehicles([car('same'),car('same')]),/ARCHIVE_VEHICLES_INVALID/);assert.equal(model.vehicles([car('same',A),car('same',B)]).length,2);for(const invalid of[car(''),car('one','not-a-uuid'),{...car('one'),id:123}])assert.throws(()=>model.vehicles([invalid]),/ARCHIVE_VEHICLES_INVALID/);
});
test('KRW amounts preserve exact zero and reject invalid values instead of rounding',()=>{
 assert.equal(model.money(0),'0원');assert.equal(model.money(12345678),'12,345,678원');for(const value of[null,undefined,NaN,Infinity,-1,1.5,'1000'])assert.equal(model.money(value),'—');
});
