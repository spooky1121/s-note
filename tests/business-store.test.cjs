'use strict';
// Actual index bridge + money boundary + store. All authentication/RPC data is synthetic.
// No network, hosted data, messages, browser storage or production writes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const ROOT=path.join(__dirname,'..'),html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const begin=html.indexOf('/* Vehicle business RPC bridge:'),end=html.indexOf('\nwindow.zc86Cloud=',begin);assert(begin>=0&&end>begin);
const bridgeSource=html.slice(begin,end),moneySource=fs.readFileSync(path.join(ROOT,'assets/money.js'),'utf8'),storeSource=fs.readFileSync(path.join(ROOT,'assets/business-store.js'),'utf8');
const actorSource=html.match(/^function snoteCompanyActor\(\).*$/m)?.[0];assert(actorSource);
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER='11111111-1111-4111-8111-111111111111',PEER='22222222-2222-4222-8222-222222222222',ADMIN='33333333-3333-4333-8333-333333333333';
const CYCLE='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ENTRY='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const clone=value=>structuredClone(value),alias=id=>'cld_'+id.replaceAll('-','').slice(0,18),defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};},tick=()=>new Promise(resolve=>setImmediate(resolve));
const ref=(ownerId=OWNER,carId='business-store-car',companyId=COMPANY)=>({companyId,ownerId,carId});
function workspace(r=ref(),patch={}){return{apiVersion:1,companyId:r.companyId,ownerId:r.ownerId,carId:r.carId,revision:0,currentCycleId:CYCLE,cycles:[{id:CYCLE,sequence:1,status:'open',details:{tradeType:'direct'}}],entries:[],audit:[],wireCar:{id:r.carId,ownerId:alias(r.ownerId),buy:3000,sell:3350,inventoryLoan:1000,costs:{bodywork:130},repairItems:[{id:'repair',amount:30}],customCosts:{'custom-11111111-1111-4111-8111-111111111111':200000}},capabilities:{canWrite:true,customerRead:true,customerWrite:true},...patch};}
const command=(amount=1250000)=>({action:'save_entry',entry:{id:ENTRY,cycleId:CYCLE,kind:'cash',status:'confirmed',amountWon:amount,effectiveDate:'2026-11-21',dueDate:null,details:{direction:'in',purpose:'sale',notes:'합성 입력 보존'}}});

function fixture({role='dealer',actorId=OWNER,companyId=COMPANY}={}){
 const calls=[],events=[],customerReads=[],storageTouches=[],rows=new Map(),requests=new Map(),hooks={};let now=Date.UTC(2026,10,21,12);
 const storage={getItem(){storageTouches.push('read');throw Error('No PII cache');},setItem(){storageTouches.push('write');throw Error('No PII cache');},removeItem(){storageTouches.push('remove');throw Error('No PII cache');}};
 const listeners=new Map(),world={console,URL,Blob,Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},structuredClone,crypto:{randomUUID},setTimeout,clearTimeout,localStorage:storage,sessionStorage:storage,
  Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},dispatchEvent:event=>{events.push({type:event.type,detail:event.detail&&clone(event.detail)});for(const fn of listeners.get(event.type)||[])fn(event);},
  fetch:()=>{throw Error('No network in store tests');},ownerAlias:alias,snote220CatalogEpoch:1,snoteNavigationSession:1,
  snoteVehicleViewContext:()=>null,getOwnUuid:value=>[OWNER,PEER,ADMIN].find(id=>alias(id)===value)||null,snoteCompanyCarAllowed:()=>false,
  zc72ReadCar:async(owner,car)=>{customerReads.push({owner,car});return{name:'합성 고객',phone:'010-0000-0000'};},
  snoteCompanyOwnerRows:()=>world.S.members,snoteReadCompanyOwnerCars:()=>[],carFiles:()=>[],cars:[],
  $:()=>({classList:{contains:()=>false}}),closeVehicle:async()=>true,navigate:()=>true,openVehicle:()=>{},
 };
 world.window=world;
 const rowKey=r=>JSON.stringify([r.companyId,r.ownerId,r.carId]);
 function actor(){return world.S.user.id;}
 function canonicalFor(r){if(!rows.has(rowKey(r)))rows.set(rowKey(r),workspace(r));const result=clone(rows.get(rowKey(r)));result.capabilities={canWrite:true,customerRead:r.ownerId===actor(),customerWrite:r.ownerId===actor()};return result;}
 function defaultRPC(name,args){const r={companyId:args.p_company,ownerId:args.p_owner,carId:args.p_car_id};
  if(name==='snote_business_vehicle_read')return{data:canonicalFor(r),error:null};
  if(name==='snote_business_vehicle_write'){
   const fingerprint=JSON.stringify(args),id=actor()+':'+args.p_request_id,previous=requests.get(id);if(previous)return previous.fingerprint===fingerprint?{data:clone(previous.result),error:null}:{data:null,error:{code:'22023'}};
   const current=canonicalFor(r);if(current.revision!==args.p_expected_revision)return{data:null,error:{code:'40001'}};
   const next={...current,revision:current.revision+1,requestId:args.p_request_id};if(args.p_command.entry)next.entries=[...current.entries.filter(e=>e.id!==args.p_command.entry.id),clone(args.p_command.entry)];
   rows.set(rowKey(r),clone(next));requests.set(id,{fingerprint,result:clone(next)});return{data:next,error:null};
  }
  if(name==='snote_business_worklist'){const items=[...rows.values()].filter(w=>w.companyId===args.p_company&&(args.p_scope!=='mine'||w.ownerId===actor())).map(w=>canonicalFor(w));return{data:{items,page:args.p_page,hasMore:false},error:null};}
  if(name==='snote_business_preferences')return{data:{revision:args.p_action==='save'?args.p_expected_revision+1:0,payload:clone(args.p_payload||{dueSoonDays:7})},error:null};
  if(name==='snote_business_evidence')return{data:{items:[]},error:null};
  throw Error('Unexpected RPC '+name);
 }
 function client(){return{rpc:async(name,args)=>{const call={name,args:clone(args),actor:actor()};calls.push(call);return hooks.rpc?hooks.rpc(name,args,call):defaultRPC(name,args);}};}
 world.S={client:client(),user:{id:actorId},company:{id:companyId},ready:true,loading:false,members:[]};
 function switchTo({actorId:next=actor(),companyId:company=world.S.company.id,role:nextRole=world.currentUser?.role||role,active=true,ready=true}={}){world.S.user={id:next};world.S.company={id:company};world.currentUser={username:alias(next),role:nextRole};world.S.members=[{user_id:next,company_id:company,role:nextRole,active,display_name:'합성 사용자'},{user_id:PEER,company_id:company,role:'dealer',active:true,display_name:'합성 동료'},{user_id:ADMIN,company_id:OTHER_COMPANY,role:'admin',active:true,display_name:'다른 상사'}];world.S.ready=ready;world.S.loading=false;}
 switchTo({actorId,companyId,role});vm.createContext(world);vm.runInContext(actorSource+bridgeSource,world,{filename:'actual-business-bridge.js'});vm.runInContext(moneySource,world,{filename:'money.js'});vm.runInContext(storeSource,world,{filename:'business-store.js'});
 return{world,store:world.SnoteBusinessStore,bridge:world.snoteBusinessBridge,calls,events,customerReads,storageTouches,rows,requests,hooks,defaultRPC,switchTo,rowKey,seed:(r,w)=>rows.set(rowKey(r),clone(w)),advance:ms=>{now+=ms;},writeCalls:()=>calls.filter(c=>c.name==='snote_business_vehicle_write')};
}
const reject=(promise,code)=>assert.rejects(promise,error=>code?error.code===code:true);

test('actual bridge enforces active native company/actor/role scope and never trusts shared-vehicle permission',async()=>{
 const f=fixture();await f.store.read(ref());assert.deepEqual(f.calls[0].args,{p_company:COMPANY,p_owner:OWNER,p_car_id:ref().carId});
 await reject(f.store.read(ref(OWNER,'foreign-car',OTHER_COMPANY)),'FORBIDDEN');await reject(f.store.read(ref(PEER)),'FORBIDDEN');await reject(f.store.list({scope:'company'}),'FORBIDDEN');assert.equal(f.calls.length,1);
 f.world.S.members[0].active=false;await reject(f.store.read(ref()),'NOT_READY');assert.equal(f.store.cached(ref()),null);
 f.world.S.members[0].active=true;f.world.currentUser.role='admin';await reject(f.store.read(ref()),'NOT_READY');
 f.world.currentUser.role='dealer';f.world.S.loading=true;await reject(f.store.read(ref()),'NOT_READY');f.world.S.loading=false;
 f.world.SnoteSharedVehicleDetail={active:()=>true};assert.equal(f.store.vehicle(),null);
});

test('nonowner CRM is inaccessible while company admins/accountants retain noncustomer business data',async()=>{
 for(const role of['admin','accountant']){const f=fixture({actorId:ADMIN,role}),r=ref(OWNER);const w=await f.store.read(r);assert.equal(w.capabilities.customerRead,false);assert.equal(w.capabilities.customerWrite,false);assert.equal(await f.store.customer(r),null);assert.equal(f.customerReads.length,0);}
 const f=fixture();assert.equal((await f.store.customer(ref())).name,'합성 고객');assert.equal(f.customerReads.length,1);
});

test('malformed private CRM capabilities, lead/task records and customer audit snapshots fail closed',async()=>{
 for(const privateEntry of[{kind:'lead',details:{name:'비공개 합성'}},...['contact','visit','contract','delivery'].map(category=>({kind:'task',details:{category}}))]){const f=fixture({actorId:ADMIN,role:'admin'});f.hooks.rpc=()=>({data:workspace(ref(),{entries:[privateEntry],capabilities:{canWrite:true,customerRead:false,customerWrite:false}}),error:null});await reject(f.store.read(ref()),'INVALID_RESPONSE');assert.equal(f.store.cached(ref()),null);}
 for(const patch of[{capabilities:{canWrite:true,customerRead:true,customerWrite:true}},{audit:[{changes:{before:{kind:'lead',details:{name:'비공개 합성'}},after:null}}]}]){const f=fixture({actorId:ADMIN,role:'admin'});f.hooks.rpc=()=>({data:workspace(ref(),{capabilities:{canWrite:true,customerRead:false,customerWrite:false},...patch}),error:null});await reject(f.store.read(ref()),'INVALID_RESPONSE');}
});

test('legacy money crosses the real KRW boundary once and new amountWon/null values are unchanged',async()=>{
 const f=fixture();f.seed(ref(),workspace(ref(),{entries:[{id:ENTRY,kind:'cash',amountWon:1250000,effectiveDate:null,details:{}}]}));const w=await f.store.read(ref());assert.equal(w.carSnapshot.buy,30000000);assert.equal(w.carSnapshot.sell,33500000);assert.equal(w.carSnapshot.inventoryLoan,10000000);assert.equal(w.carSnapshot.costs.bodywork,1300000);assert.equal(w.carSnapshot.repairItems[0].amount,300000);assert.equal(w.carSnapshot.moneyUnit,'KRW');assert.equal(w.entries[0].amountWon,1250000);assert.equal(w.entries[0].effectiveDate,null);assert.equal(w.carSnapshot.customCosts['custom-11111111-1111-4111-8111-111111111111'],200000);assert.equal(f.world.SnoteMoney.car(w.carSnapshot).buy,30000000);
 w.carSnapshot.buy=1;w.entries[0].amountWon=1;assert.equal(f.store.cached(ref()).carSnapshot.buy,30000000);assert.equal(f.store.cached(ref()).entries[0].amountWon,1250000);
 const won=workspace(ref(),{wireCar:{id:ref().carId,moneyUnit:'KRW',buy:30000000,sell:null,inventoryLoan:0}});f.hooks.rpc=()=>({data:won,error:null});const fresh=await f.store.read(ref(),{force:true});assert.equal(fresh.carSnapshot.buy,30000000);assert.equal(fresh.carSnapshot.sell,null);
});

test('duplicate in-flight commands share a fixed request and reuse with changed body is rejected',async()=>{
 const f=fixture();await f.store.read(ref());const hold=defer(),id=randomUUID(),input=command();f.hooks.rpc=(name,args)=>name==='snote_business_vehicle_write'?hold.promise:f.defaultRPC(name,args);const a=f.store.command(ref(),input,{requestId:id}),b=f.store.command(ref(),clone(input),{requestId:id});await tick();assert.equal(f.writeCalls().length,1);await reject(f.store.command(ref(),command(2),{requestId:id}),'REQUEST_REUSED');hold.resolve(f.defaultRPC('snote_business_vehicle_write',f.writeCalls()[0].args));assert.equal((await a).revision,1);assert.equal((await b).revision,1);assert.equal(f.requests.size,1);
});

test('response loss retries the identical request UUID, expected revision and immutable submitted command',async()=>{
 const f=fixture();await f.store.read(ref());const id=randomUUID(),input=command(),before=clone(input);let attempts=0;
 f.hooks.rpc=(name,args)=>{if(name!=='snote_business_vehicle_write')return f.defaultRPC(name,args);attempts++;const result=f.defaultRPC(name,args);if(attempts===1){input.entry.amountWon=9999999;input.entry.details.notes='보류 중 추가 입력';args.p_command.entry.amountWon=7;throw Error('Synthetic lost response after server commit');}return result;};
 const saved=await f.store.command(ref(),input,{requestId:id});assert.equal(saved.revision,1);assert.equal(f.writeCalls().length,2);assert.deepEqual(f.writeCalls()[0].args,f.writeCalls()[1].args);assert.deepEqual(f.writeCalls()[1].args.p_command,before);assert.equal(input.entry.amountWon,9999999,'New caller input remains separate from the submitted snapshot');assert.equal(f.requests.size,1);
});

test('two transport failures preserve cached state and an explicit retry can confirm the same committed request',async()=>{
 const f=fixture();await f.store.read(ref());const input=command(),id=randomUUID(),before=clone(input);f.hooks.rpc=(name,args)=>{if(name==='snote_business_vehicle_write'){f.defaultRPC(name,args);throw Error('Synthetic dropped response');}return f.defaultRPC(name,args);};await reject(f.store.command(ref(),input,{requestId:id}),'NETWORK');assert.deepEqual(input,before);assert.equal(f.store.cached(ref()).revision,0);assert.equal(f.writeCalls().length,2);delete f.hooks.rpc;assert.equal((await f.store.command(ref(),input,{requestId:id})).revision,1);assert.equal(f.requests.size,1);
});

test('CAS, permissions and validation errors never retry or discard the caller input/cache',async()=>{
 for(const[raw,code]of[['40001','CONFLICT'],['42501','FORBIDDEN'],['22023','INVALID_DATA'],['23514','INVALID_DATA'],['PGRST202','SETUP_REQUIRED']]){const f=fixture();await f.store.read(ref());const input=command(),before=clone(input);f.hooks.rpc=()=>({data:null,error:{code:raw}});await reject(f.store.command(ref(),input),code);assert.equal(f.writeCalls().length,1);assert.equal(f.store.cached(ref()).revision,0);assert.deepEqual(input,before);assert.equal(f.events.filter(e=>e.type==='snote:business-changed').length,0);}
});

test('malformed workspace responses do not replace known facts or report successful writes',async()=>{
 for(const patch of[{apiVersion:2},{companyId:OTHER_COMPANY},{ownerId:PEER},{carId:'other-id'},{revision:-1},{revision:0.5},{entries:null},{cycles:{}}]){const f=fixture();await f.store.read(ref());f.hooks.rpc=()=>({data:workspace(ref(),patch),error:null});await reject(f.store.read(ref(),{force:true}),'INVALID_RESPONSE');assert.equal(f.store.cached(ref()).revision,0);}
 for(const data of[null,'<html>upstream failure</html>',{}]){const f=fixture();await f.store.read(ref());f.hooks.rpc=()=>({data,error:null});await reject(f.store.command(ref(),command()),'INVALID_RESPONSE');assert.equal(f.store.cached(ref()).revision,0);assert.equal(f.events.filter(e=>e.type==='snote:business-changed').length,0);}
});

test('write ACK must acknowledge exactly the next revision and the submitted request UUID',async()=>{
 for(const patch of[{revision:0},{revision:2},{requestId:randomUUID()},{requestId:undefined}]){const f=fixture();await f.store.read(ref());const id=randomUUID();f.hooks.rpc=()=>({data:workspace(ref(),{revision:1,requestId:id,...patch}),error:null});await reject(f.store.command(ref(),command(),{requestId:id}),'INVALID_RESPONSE');assert.equal(f.store.cached(ref()).revision,0);assert.equal(f.events.filter(e=>e.type==='snote:business-changed').length,0);}
});

test('an older in-flight read cannot overwrite a newer acknowledged command',async()=>{
 const f=fixture();await f.store.read(ref());const hold=defer(),old=workspace();f.hooks.rpc=(name,args)=>name==='snote_business_vehicle_read'?hold.promise:f.defaultRPC(name,args);const reading=f.store.read(ref(),{force:true});const saved=await f.store.command(ref(),command());hold.resolve({data:old,error:null});assert.equal((await reading).revision,saved.revision);assert.equal(f.store.cached(ref()).revision,1);
});

test('an older in-flight list preserves a newer acknowledged workspace and rejects mine/foreign scope mismatches',async()=>{
 const f=fixture();await f.store.read(ref());const hold=defer();f.hooks.rpc=(name,args)=>name==='snote_business_worklist'?hold.promise:f.defaultRPC(name,args);const listing=f.store.list({force:true});await f.store.command(ref(),command());hold.resolve({data:{items:[workspace()],page:1,hasMore:false},error:null});assert.equal((await listing).items[0].revision,1);assert.equal(f.store.cached(ref()).revision,1);
 for(const bad of[workspace(ref(PEER)),workspace(ref(OWNER,'other',OTHER_COMPANY))]){f.hooks.rpc=()=>({data:{items:[bad],page:1,hasMore:false},error:null});await reject(f.store.list({force:true}));assert.equal(f.store.cached(ref()).revision,1);}
});

test('an older successful write ACK cannot roll back a newer read and write ACK',async()=>{
 const f=fixture();await f.store.read(ref());const hold=defer();let first=true;
 f.hooks.rpc=(name,args)=>{const result=f.defaultRPC(name,args);if(name==='snote_business_vehicle_write'&&first){first=false;return hold.promise.then(()=>result);}return result;};
 const one=f.store.command(ref(),command(100));await tick();assert.equal((await f.store.read(ref(),{force:true})).revision,1);const two=await f.store.command(ref(),command(200));assert.equal(two.revision,2);hold.resolve();assert.equal((await one).revision,2);assert.equal(f.store.cached(ref()).revision,2);assert.equal(f.store.cached(ref()).entries[0].amountWon,200);
});

test('auth/company/role/client changes discard a late write ACK and do not populate the next account',async()=>{
 for(const change of[f=>f.switchTo({actorId:PEER}),f=>f.switchTo({companyId:OTHER_COMPANY}),f=>{f.world.currentUser.role='accountant';f.world.S.members[0].role='accountant';},f=>{f.world.S.client={rpc:async()=>{throw Error('Unexpected new client write');}};}]){const f=fixture();await f.store.read(ref());const hold=defer();f.hooks.rpc=(name,args)=>name==='snote_business_vehicle_write'?hold.promise:f.defaultRPC(name,args);const writing=f.store.command(ref(),command(),{requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});await tick();change(f);hold.resolve({data:workspace(ref(),{revision:1,requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}),error:null});await reject(writing,'CONTEXT_CHANGED');assert.equal(f.store.cached(ref()),null);assert.equal(f.events.filter(e=>e.type==='snote:business-changed').length,0);}
});

test('same-identity reset invalidates held read, list and write and never repopulates cleared memory',async()=>{
 for(const action of['read','list','write']){const f=fixture();await f.store.read(ref());const hold=defer(),id=randomUUID();f.hooks.rpc=()=>hold.promise;const pending=action==='read'?f.store.read(ref(),{force:true}):action==='list'?f.store.list({force:true}):f.store.command(ref(),command(),{requestId:id});await tick();const identity=f.store.context().key;f.store.reset();assert.equal(f.store.context().key,identity,'The auth session itself intentionally remains unchanged');assert.equal(f.store.cached(ref()),null);hold.resolve({data:action==='list'?{items:[workspace()],page:1,hasMore:false}:workspace(ref(),{revision:action==='write'?1:0,requestId:id}),error:null});await reject(pending,'CONTEXT_CHANGED');assert.equal(f.store.cached(ref()),null);assert.equal(f.events.filter(e=>e.type==='snote:business-changed').length,0);}
});

test('auth-reset and pagehide clear memory and invalidate pending auxiliary responses',async()=>{
 for(const event of['snote:auth-reset','pagehide']){const f=fixture();await f.store.read(ref());const hold=defer();f.hooks.rpc=()=>hold.promise;const pending=f.store.preferences();await tick();f.world.dispatchEvent(new f.world.Event(event));assert.equal(f.store.cached(ref()),null);hold.resolve({data:{revision:0,payload:{dueSoonDays:7}},error:null});await reject(pending,'CONTEXT_CHANGED');assert.equal(f.storageTouches.length,0);}
});

test('stale old pending cleanup cannot erase a new same-ID request after reset',async()=>{
 const f=fixture();await f.store.read(ref());const old=defer(),fresh=defer(),id=randomUUID();let writes=0;f.hooks.rpc=(name,args)=>{if(name!=='snote_business_vehicle_write')return f.defaultRPC(name,args);writes++;return writes===1?old.promise:fresh.promise;};const first=f.store.command(ref(),command(),{requestId:id});await tick();f.store.reset();await f.store.read(ref());const second=f.store.command(ref(),command(),{requestId:id});await tick();old.resolve({data:workspace(ref(),{revision:1,requestId:id}),error:null});await reject(first,'CONTEXT_CHANGED');const duplicate=f.store.command(ref(),command(),{requestId:id});await tick();assert.equal(writes,2);fresh.resolve(f.defaultRPC('snote_business_vehicle_write',f.writeCalls().at(-1).args));await second;await duplicate;assert.equal(f.requests.size,1);
});

test('read/list cache windows are bounded and caller mutation cannot change cached canonical records',async()=>{
 const f=fixture();const a=await f.store.read(ref());a.cycles[0].details.tradeType='tampered';assert.equal(f.store.cached(ref()).cycles[0].details.tradeType,'direct');await f.store.read(ref());assert.equal(f.calls.length,1);f.advance(30001);await f.store.read(ref());assert.equal(f.calls.length,2);const list=await f.store.list();list.items[0].wireCar.buy=1;assert.equal(f.store.cached(ref()).wireCar.buy,3000);await f.store.list();assert.equal(f.calls.filter(c=>c.name==='snote_business_worklist').length,1);f.advance(15001);await f.store.list();assert.equal(f.calls.filter(c=>c.name==='snote_business_worklist').length,2);assert.equal(f.storageTouches.length,0);
});

test('commands require an acknowledged writable workspace and preserve unknown money rather than zeroing it',async()=>{
 const f=fixture();await reject(f.store.command(ref(),command()),'READ_REQUIRED');f.seed(ref(),workspace(ref(),{capabilities:{canWrite:false,customerRead:true,customerWrite:true},wireCar:{buy:null,sell:null,moneyUnit:'KRW'}}));f.hooks.rpc=()=>({data:workspace(ref(),{capabilities:{canWrite:false,customerRead:true,customerWrite:true},wireCar:{buy:null,sell:null,moneyUnit:'KRW'}}),error:null});const result=await f.store.read(ref());assert.equal(result.carSnapshot.buy,null);await reject(f.store.command(ref(),command()),'FORBIDDEN');assert.equal(f.writeCalls().length,0);
});

test('members are restricted to active same-company identities and duplicate script loading is harmless',()=>{
 const f=fixture();const members=clone(f.store.members());assert(members.every(m=>[OWNER,PEER].includes(m.id)));const original=f.world.SnoteBusinessStore;vm.runInContext(storeSource,f.world);assert.equal(f.world.SnoteBusinessStore,original);assert(Object.isFrozen(original));assert.equal(f.storageTouches.length,0);
});

module.exports={fixture,workspace,command,ref,COMPANY,OTHER_COMPANY,OWNER,PEER,ADMIN,CYCLE,ENTRY};
