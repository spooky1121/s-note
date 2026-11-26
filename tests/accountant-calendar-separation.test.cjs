'use strict';
// Run the real index vehicle-date bridge with synthetic authenticated contexts.
// Personal scheduler isolation is covered by accountant-schedule.sql.cjs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const start=html.indexOf('window.snote206VehicleCalendarLoaded=()=>{'),end=html.indexOf('window.snoteMountWorkspaceMenus=',start);
assert(start>=0&&end>start,'The actual vehicle calendar bridge must be available');
const source=html.slice(start,end),USER='11111111-1111-4111-8111-111111111111',PEER='22222222-2222-4222-8222-222222222222';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18),plain=value=>JSON.parse(JSON.stringify(value));
function fixture(role='accountant'){
 const own={id:'own',ownerId:alias(USER),companyId:COMPANY,model:'Synthetic own car',plate:'00가0001',purchaseAt:'2026-11-01',soldAt:'2026-11-26',status:'판매완료'};
 for(const key of ['buy','sell','inventoryLoan','incomeSettlement','customer','notes'])Object.defineProperty(own,key,{get(){throw Error('Vehicle dates must not read '+key);}});
 const rows=[own,{...own,id:'peer',ownerId:alias(PEER)},{...own,id:'foreign',companyId:FOREIGN},{...own,id:'conflicting-source'}];
 const member={user_id:USER,company_id:COMPANY,active:true,role},actor={key:'verified-personal-calendar',role,actorId:USER,companyId:COMPANY,ready:true},scope={key:'verified-vehicle-scope',ownerAlias:alias(USER),role,ready:true,canRead:role==='admin'||role==='accountant'};
 const box={window:{snoteCompanyPurchaseBridge:{current:()=>true,carAllowed:()=>true},snoteCompanyPurchaseIsReady:()=>true},S:{client:{synthetic:true},user:{id:USER},company:{id:COMPANY},members:[member],carScopes:new WeakMap()},currentUser:{username:alias(USER),role},route:'dashboard',snoteWorkspaceSalesReady:true,snote220CatalogEpoch:1,snote206VehicleCalendarLoadedScope:null,cars:rows,ownerAlias:alias,snote205SchedulerContext:()=>actor,snotePurchaseContext:()=>scope};
 box.S.carScopes.set(rows[3],{companyId:COMPANY,ownerId:PEER,carId:'conflicting-source',epoch:1});
 vm.createContext(box);vm.runInContext(source,box);box.window.snote206VehicleCalendarLoaded();
 return {box,actor,scope,member,bridge:box.window.snoteDealerVehicleCalendarBridge};
}
test('accountants never receive company/dealer vehicle dates or retained calendar cache keys',()=>{
 const f=fixture();Object.defineProperty(f.box,'cars',{get(){throw Error('Accountant calendar must not inspect any vehicle list');}});
 assert.equal(f.bridge.snapshot(),null);assert.equal(f.bridge.current('verified-personal-calendar'),false);assert.equal(f.box.snote206VehicleCalendarLoadedScope,null);
});
test('an accountant role cannot reuse a previously loaded dealer vehicle calendar',()=>{
 const f=fixture('dealer'),before=f.bridge.snapshot();assert(before&&before.rows.length===1);
 f.member.role=f.actor.role=f.scope.role=f.box.currentUser.role='accountant';f.scope.canRead=true;
 Object.defineProperty(f.box,'cars',{get(){throw Error('Old dealer rows must stay inaccessible after role change');}});
 assert.equal(f.bridge.snapshot(),null);assert.equal(f.bridge.current(before.key),false);
});
for(const role of ['dealer','admin'])test(role+' retains their own readonly vehicle dates without company-wide or financial projection',()=>{
 const f=fixture(role),snapshot=f.bridge.snapshot();assert.equal(snapshot.loading,false);assert.equal(f.bridge.current(snapshot.key),true);
 assert.deepEqual(plain(snapshot.rows),[{id:'own',model:'Synthetic own car',plate:'00가0001',purchaseAt:'2026-11-01',soldAt:'2026-11-26',status:'판매완료'}]);
});
test('route, actor, client, company and epoch replacements reject the former date projection',()=>{
 for(const mutate of [f=>{f.box.route='acctInfo';},f=>{f.box.currentUser={...f.box.currentUser};},f=>{f.box.S.client={synthetic:'replacement'};},f=>{f.box.S.company={id:FOREIGN};f.actor.companyId=FOREIGN;f.member.company_id=FOREIGN;f.scope.key='verified-foreign-vehicle-scope';},f=>{f.box.snote220CatalogEpoch++;}]){
  const f=fixture('dealer'),before=f.bridge.snapshot();mutate(f);assert.equal(f.bridge.snapshot(),null);assert.equal(f.bridge.current(before.key),false);
 }
});
test('unverified vehicle hydration publishes no rows and cannot become a current calendar',()=>{
 for(const mutate of [f=>{f.box.snoteWorkspaceSalesReady=false;},f=>{f.scope.ready=false;}]){const f=fixture('dealer');mutate(f);const snapshot=f.bridge.snapshot();assert.equal(snapshot.loading,true);assert.deepEqual(plain(snapshot.rows),[]);assert.equal(f.bridge.current(snapshot.key),false);}
 const f=fixture('dealer');f.box.snote205SchedulerContext=()=>null;assert.equal(f.bridge.snapshot(),null);
});
