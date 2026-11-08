'use strict';
// Run the production status-confirmation handlers with synthetic DOM elements.
// This intentionally does not sign in, mutate production data, or call a network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function closeStatusModal(){'),html.indexOf('/* v2.02: 매입관리 금융상태 색상.'));
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
function fixture(){
 const classes=new Set(['open','cancel-mode']),frame={inert:false,classList:{remove:k=>classes.delete(k)}};
 const node=()=>({disabled:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},classList:{remove:k=>classes.delete(k),contains:k=>classes.has(k)},querySelector:()=>frame});
 const elements={'status-confirm-submit':node(),'status-overlay':node(),'vehicle-overlay':node()};
 const c={id:'car-a',ownerId:'owner-a',status:'판매완료',soldAt:'2026-11-07',soldPrice:25000000,buy:20000000,costs:{repair:40000},memo:'keep',photos:['photo-a'],customer:{name:'synthetic'}};
 const user={username:'owner-a',role:'dealer'},req={id:c.id,old:c.status,next:'판매취소',ownerId:c.ownerId,actor:user},calls={persist:[],flush:0,closeVehicle:0,stats:0,menus:0,navigate:[],toasts:[]};
 let persist=true,flush=async()=>({ok:true});
 const cloud={ready:true,conflict:false,flush:async()=>{calls.flush++;return flush();}};
 const context={pendingStatusChange:req,currentUser:user,cars:[c],activeCarId:c.id,snote224VehicleOpen:1,route:'sell',window:{zc86Cloud:cloud},
  $:id=>elements[id],isAccountant:()=>context.currentUser?.role==='accountant',canManageCar:car=>context.currentUser?.role==='admin'||car.ownerId===context.currentUser?.username,
  toast:msg=>calls.toasts.push(msg),persistCars:owner=>{calls.persist.push({owner,car:clone(c)});return persist;},
  closeVehicle:()=>{calls.closeVehicle++;},buildStats:()=>calls.stats++,buildMenus:()=>calls.menus++,navigate:value=>{calls.navigate.push(value);context.route=value;}};
 vm.createContext(context);vm.runInContext(source,context);
 return {c,user,req,calls,cloud,context,elements,classes,frame,confirm:()=>context.confirmStatusChange(),setPersist(value){persist=value;},setFlush(value){flush=value;}};
}
const succeeded=f=>f.calls.toasts.some(value=>value.includes('판매 취소 완료'));
test('sale cancellation cannot close, navigate, or report success before the server ACK',async()=>{
 const f=fixture(),gate=deferred(),before=clone(f.c);f.setFlush(()=>gate.promise);const pending=f.confirm();
 assert.equal(f.calls.flush,1);assert.equal(succeeded(f),false);assert.equal(f.elements['status-confirm-submit'].disabled,true);assert.equal(f.elements['status-confirm-submit'].attributes['aria-busy'],'true');assert.equal(f.frame.inert,true);
 assert.equal(f.calls.closeVehicle,0);assert.equal(f.classes.has('open'),true);assert.deepEqual(f.calls.navigate,[]);
 await f.confirm();f.context.closeStatusModal();assert.equal(f.calls.flush,1);assert.equal(f.calls.persist.length,1);assert.equal(f.classes.has('open'),true);
 gate.resolve({ok:true});await pending;
 assert.equal(succeeded(f),true);assert.equal(f.classes.has('open'),false);assert.deepEqual(f.calls.navigate,['buy']);assert.equal(f.calls.closeVehicle,1);assert.equal(f.frame.inert,false);
 delete before.soldAt;delete before.soldPrice;before.status='판매중';assert.deepEqual(f.c,before);assert.equal(f.calls.persist[0].owner,'owner-a');
});
for(const failure of ['negative','throw','conflict'])test(`failed server confirmation (${failure}) stays open, keeps pending state, and permits a safe retry`,async()=>{
 const f=fixture();f.setFlush(async()=>{if(failure==='throw')throw Error('offline');if(failure==='conflict')f.cloud.conflict=true;return {ok:failure==='conflict'};});
 await f.confirm();assert.equal(succeeded(f),false);assert.equal(f.classes.has('open'),true);assert.equal(f.calls.closeVehicle,0);assert.deepEqual(f.calls.navigate,[]);assert.equal(f.elements['status-confirm-submit'].disabled,false);assert.equal(f.frame.inert,false);assert.equal(f.req.attempt,true);
 assert.equal(f.c.status,'판매중');assert.equal(f.context.pendingStatusChange,f.req);f.cloud.conflict=false;f.setFlush(async()=>({ok:true}));await f.confirm();assert.equal(succeeded(f),true);assert.deepEqual(f.calls.navigate,['buy']);
});
test('local persistence failure restores sale fields and does not request a server write',async()=>{
 const f=fixture(),before=clone(f.c);f.setPersist(false);await f.confirm();assert.deepEqual(f.c,before);assert.equal(f.calls.flush,0);assert.equal(f.req.attempt,undefined);assert.equal(succeeded(f),false);assert.equal(f.classes.has('open'),true);assert.equal(f.elements['status-confirm-submit'].disabled,false);
});
test('offline/unready login cannot mutate the vehicle or falsely complete cancellation',async()=>{
 const f=fixture(),before=clone(f.c);f.cloud.ready=false;await f.confirm();assert.deepEqual(f.c,before);assert.equal(f.calls.persist.length,0);assert.equal(f.calls.flush,0);assert.equal(succeeded(f),false);assert.equal(f.classes.has('open'),true);
});
test('accountants and changed actors/owners cannot cancel a sale',async()=>{
 for(const change of [f=>f.context.currentUser={...f.user,role:'accountant'},f=>f.context.currentUser={...f.user},f=>f.c.ownerId='other',f=>f.c.status='판매중']){
  const f=fixture();change(f);await f.confirm();assert.equal(f.calls.persist.length,0);assert.equal(f.calls.flush,0);assert.equal(succeeded(f),false);
 }
});
test('admin cancellation persists only the selected owner',async()=>{
 const f=fixture();f.user.role='admin';f.user.username='admin';await f.confirm();assert.equal(succeeded(f),true);assert.equal(f.calls.persist[0].owner,'owner-a');
});
test('late ACK cannot redirect or close a newer route, vehicle, actor, or modal',async()=>{
 for(const change of [f=>f.context.route='finance',f=>f.context.activeCarId='car-b',f=>f.context.snote224VehicleOpen++,f=>f.context.currentUser={...f.user},f=>f.context.cars=[],f=>f.context.pendingStatusChange={...f.req,id:'new-request'}]){
  const f=fixture(),gate=deferred();f.setFlush(()=>gate.promise);const pending=f.confirm();change(f);gate.resolve({ok:true});await pending;
  assert.equal(succeeded(f),false);assert.equal(f.calls.closeVehicle,0);assert.deepEqual(f.calls.navigate,[]);assert.equal(f.frame.inert,false);
 }
});
test('a detail frame already inert stays inert after cancellation',async()=>{
 const f=fixture();f.frame.inert=true;await f.confirm();assert.equal(f.frame.inert,true);
});
