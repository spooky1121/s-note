'use strict';
// Real shipped projection and status transition with synthetic records only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={document:{},addEventListener(){}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/dealer-scheduler.js'),'utf8'),{window:root});
const M=root.SnoteDealerSchedulerUI.model,plain=value=>JSON.parse(JSON.stringify(value));
const car=(id,extra={})=>({id,model:'합성 차량',plate:'00가0001',purchaseAt:'2026-11-01',soldAt:'',status:'계약중',contractAt:'2026-11-28',...extra});
test('contract events require their own real date and contracting status',()=>{
 const input=[car('valid'),car('format',{contractAt:'2026/11/27'}),car('missing',{contractAt:''}),car('invalid',{contractAt:'2026-02-30'}),car('stock',{status:'판매중'}),car('sold',{status:'판매완료',soldAt:'2026-11-29'})];
 assert.deepEqual(plain(M.vehicleEvents(input).filter(e=>e.kind==='contract').map(e=>[e.vehicleId,e.eventDate])),[['format','2026-11-27'],['valid','2026-11-28']]);
 assert.deepEqual(plain(M.undatedContractVehicles(input).map(e=>e.vehicleId)),['missing','invalid']);
 assert.equal(M.vehicleEvents([car('none',{purchaseAt:'',contractAt:''})]).length,0,'Neither today nor purchase date is invented');
});
test('undated contracting vehicles are readonly and never copy private customer or money fields',()=>{
 const input=Object.freeze(car('legacy',{contractAt:null,customer:{name:'PRIVATE'},buy:123,notes:'PRIVATE'})),before=JSON.stringify(input),items=M.undatedContractVehicles([input]);
 assert.equal(JSON.stringify(input),before);assert(Object.isFrozen(items[0]));assert.deepEqual(Object.keys(items[0]).sort(),['id','kind','model','plate','readOnly','vehicleId']);assert(!JSON.stringify(items).includes('PRIVATE'));
});
test('contract duplicates keep owner identity and reject conflicting dates or states',()=>{
 const owner='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',a=car('same',{ownerId:owner}),b=car('same',{ownerId:peer});
 assert.equal(M.vehicleEvents([a,a,b]).filter(e=>e.kind==='contract').length,2);
 assert.equal(M.vehicleEvents([a,{...a,contractAt:'2026-11-27'}]).length,0);
 assert.equal(M.undatedContractVehicles([car('same',{contractAt:''}),car('same',{contractAt:'2026-11-28'})]).length,0);
});
test('contracts keep deterministic purchase-contract-sale order and stay distinct from editable schedules',()=>{
 const events=M.vehicleEvents([car('c',{purchaseAt:'2026-11-28'}),car('s',{status:'판매완료',purchaseAt:'2026-11-28',soldAt:'2026-11-28'})]);
 assert.deepEqual(plain(events.map(e=>e.kind)),['purchase','purchase','contract','sale']);assert(events.every(e=>e.readOnly&&Object.isFrozen(e)));
});
const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),start=html.indexOf('function snote256VehicleStatusPatch('),end=html.indexOf('/* v2.02: 매입관리 금융상태 색상.',start);assert(start>=0&&end>start);const source=html.slice(start,end);
function stateFixture(ok=true){
 const actor={username:'own'},vehicle=car('status-car',{ownerId:'own',status:'판매중',contractAt:undefined});delete vehicle.contractAt;
 const messages=[],writes=[],button={disabled:false},filter={value:'all'};class FrozenDate extends Date{constructor(...args){super(args.length?args[0]:'2026-11-28T15:30:00Z');}}
 const box={Date:FrozenDate,Intl,Object,currentUser:actor,cars:[vehicle],pendingStatusChange:{id:vehicle.id,ownerId:'own',old:'판매중',next:'계약중',actor},activeCarId:null,route:'buy',$:id=>id==='list-filter'?filter:button,isAccountant:()=>false,canManageCar:()=>true,persistCars:()=>{writes.push({...vehicle});return ok;},isPurchaseListRoute:()=>true,closeStatusModal(){},buildStats(){},buildMenus(){},renderCars(){},toast:text=>messages.push(text)};
 vm.createContext(box);vm.runInContext(source,box);return{box,vehicle,writes,messages};
}
test('only an actual transition into contracting writes its Korean status-change date',async()=>{
 const f=stateFixture();await f.box.confirmStatusChange();assert.equal(f.vehicle.status,'계약중');assert.equal(f.vehicle.contractAt,'2026-11-29');assert.equal(f.writes.length,1);
 const patch=f.box.snote256VehicleStatusPatch(f.vehicle,'계약중',new Date('2026-12-01T00:00:00Z'));assert.deepEqual(plain(patch),{status:'계약중'},'An already-contracting legacy row is not backfilled or redated');
 for(const next of ['판매중','판매완료','수리중'])assert.deepEqual(plain(f.box.snote256VehicleStatusPatch(f.vehicle,next)),{status:next});
});
test('a rejected persistence restores status and does not retain a new contract date',async()=>{
 const f=stateFixture(false),before=JSON.stringify(f.vehicle);await f.box.confirmStatusChange();assert.equal(JSON.stringify(f.vehicle),before);assert(!Object.hasOwn(f.vehicle,'contractAt'));assert.equal(f.messages.length,1);
});
