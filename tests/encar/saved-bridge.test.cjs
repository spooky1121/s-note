'use strict';
// Extract the actual bridge, Storage hook, flush and reload functions. The only
// server is an in-memory CAS fixture; no production account or network is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
function between(start,end){const at=html.indexOf(start);assert(at>=0,start);const stop=html.indexOf(end,at);assert(stop>at,end);return html.slice(at,stop);}
const bridge=between('// S-NOTE Encar vehicle link persistence bridge.','// End S-NOTE Encar vehicle link persistence bridge.');
const storage=between('const originalSet=Storage.prototype.setItem;','async function ensureConnection(');
const persist=between('function persistCars(ownerId=null){','function dealerLabel(');
const reset=between('let snote221IncomeEpoch=0;','function snote221IncomeContext(');
const reload=between('async function reload(){if(!S.ready)return;','status.addEventListener(\'click\',reload);');
const scrub=between('function scrub(o){','function cleanCustomer(');
// Owner authorization is shared with company-purchase views. Execute the real
// helpers too, so this isolated bridge does not replace that policy with a stub.
const companyOwners=between('function snoteCompanyActor(){','function snoteCompanyOwnerLabel(');
const COMPANY='10000000-0000-4000-8000-000000000001',USER='20000000-0000-4000-8000-000000000001',OTHER='30000000-0000-4000-8000-000000000001';
const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18),key=owner=>'cars:'+owner,store=owner=>'zerocar-office-v12-cars-'+alias(owner);
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const record=(model='검증 차량')=>({version:1,plate:'12가3456',verifiedAt:new Date().toISOString(),listings:[{id:'43000001',model,sellerUrl:'https://fem.encar.com/cars/detail/43000001',trustedId:'43000002',trustedUrl:'https://fem.encar.com/cars/detail/43000002'}]});

function fixture({role='dealer',owner=USER,server:initial}={}){
 class MemoryStorage{constructor(){this.data=new Map();}getItem(k){return this.data.get(String(k))??null;}setItem(k,v){if(this.fail)throw Error('fixture quota');this.data.set(String(k),String(v));}removeItem(k){this.data.delete(String(k));}}
 const localStorage=new MemoryStorage(),calls=[],events=[],server=new Map(initial?clone(initial):[
  [key(USER),{revision:7,payload:[{id:'car-a',ownerId:alias(USER),plate:'12가3456',model:'검증 차량',buy:100,incomeSettlement:{privateCipher:'opaque',document:{cells:{H50:''}}}},{id:'car-sibling',ownerId:alias(USER),plate:'34나7890',buy:200}]}],
  [key(OTHER),{revision:4,payload:[{id:'car-other',ownerId:alias(OTHER),plate:'56다1234',buy:300}]}]
 ]);
 const members=[{user_id:USER,company_id:COMPANY,role,active:true},{user_id:OTHER,company_id:COMPANY,role:'dealer',active:true}];
 let gate=null,failNext=false,ackOverride=false,restores=0;
 const S={ready:true,loading:false,busy:false,user:{id:USER},company:{id:COMPANY},members,companyOwners:new Map(),client:null,revisions:new Map(),queue:new Set(),timer:null,saving:false,conflict:false};
 const overlay={open:true,classList:{contains(name){return name==='open'&&overlay.open;}}};
 const storageOwner=k=>members.find(member=>store(member.user_id)===k)?.user_id;
 const context={S,Storage:MemoryStorage,localStorage,snote224VehicleOpen:1,console:{error(){},warn(){}},setTimeout(){return 1;},clearTimeout(){},
  currentUser:{username:alias(USER),role},activeCarId:owner===USER?'car-a':'car-other',cars:[],ownerAlias:alias,
  byId:id=>id==='vehicle-overlay'?overlay:null,
  isAccountant(){return context.currentUser?.role==='accountant';},isSnoteAdmin(){return context.currentUser?.role==='admin';},
  cloudKey:(dataset,ownerId)=>dataset+':'+ownerId,storageKey:(dataset,ownerId)=>'zerocar-office-v12-cars-'+ownerId,
  carsStoreKey:ownerId=>'zerocar-office-v12-cars-'+(ownerId||context.currentUser?.username),
  toEntry:k=>{const ownerId=storageOwner(k);return ownerId?{ds:'cars',owner:ownerId}:null;},isShared:()=>false,
  parsePayload:value=>{try{return JSON.parse(value);}catch{return null;}},defaultBody:()=> '[]',showStatus(){},errMsg:error=>error.message,
  fail(error){events.push('failure');},alert(){},confirm:()=>true,
  snote216ResetMonthly(){},snote216InitMonthly(){},snote222ResetContractSession(){},
  loadCarsForUser(){context.cars=[...server.values()].flatMap(row=>clone(row.payload));},loadCovers(){},refreshMedia:async()=>{},buildStats(){},navigate(){},route:'buy',
  snote220RefreshTaxonomy:async()=>{},
  async restoreDatasets(){events.push('restore');restores++;context.snote221ResetIncome();for(const [rowKey,row]of server){const ownerId=rowKey.slice(5);localStorage.data.set(store(ownerId),JSON.stringify(row.payload));S.revisions.set(rowKey,row.revision);}},
  window:null};
 context.window=context;
 for(const[rowKey,row]of server){localStorage.data.set(store(rowKey.slice(5)),JSON.stringify(row.payload));S.revisions.set(rowKey,row.revision);}
 context.cars=role==='dealer'?clone(server.get(key(USER)).payload):[...server.values()].flatMap(row=>clone(row.payload));
 S.client={async rpc(name,args){
  assert.equal(name,'zc_write_dataset');assert.equal(args.p_dataset,'cars');assert.equal(args.p_company,COMPANY);
  const call={...args,p_payload:clone(args.p_payload)};calls.push(call);events.push('rpc-start');
  const waiting=gate;gate=null;if(waiting){waiting.entered.resolve();await waiting.release.promise;}
  if(failNext){failNext=false;return{error:{message:'fixture write failed'}};}
  const row=server.get(key(args.p_owner));if(row.revision!==args.p_expected)return{error:{message:'CONFLICT'}};
  const revision=row.revision+1;server.set(key(args.p_owner),{revision,payload:clone(args.p_payload)});events.push('rpc-ack');
  return{data:ackOverride?'invalid-ack':revision,error:null};
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../assets/money.js'),'utf8'),context);vm.runInContext(companyOwners+scrub+persist+storage+bridge+reset+reload+'\nwindow.flushActual=flush;window.persistActual=persistCars;window.reloadActual=reload;',context);
 return{context,S,server,calls,events,localStorage,bridge:context.snoteEncarLinksBridge,
  get restores(){return restores;},hold(){const entry={entered:deferred(),release:deferred()};gate=entry;return entry;},
  failNext(){failNext=true;},invalidAck(){ackOverride=true;},
  view(open){overlay.open=open;if(open)context.snote224VehicleOpen++;},reset(){context.snote221ResetIncome();},
  serverRecord(){return clone(server.get(key(owner)).payload.find(car=>car.id===context.activeCarId));}};
}

test('actual Storage hook and CAS flush persist only the selected metadata and restore it on another login',async()=>{
 const f=fixture(),before=clone(f.server.get(key(USER)).payload),data=record();
 assert.equal((await f.bridge.save(f.bridge.context('car-a'),data)).ok,true);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].p_owner,USER);assert.equal(f.calls[0].p_expected,7);
 const after=f.server.get(key(USER));assert.equal(after.revision,8);assert.deepEqual(after.payload[0],{...before[0],encarLinks:data});assert.deepEqual(after.payload[1],before[1]);
 const other=fixture({server:[...f.server]});assert.deepEqual(other.context.cars[0].encarLinks,data);
});

test('admin persists the actual owner dataset and preserves sibling and other-owner arrays',async()=>{
 const f=fixture({role:'admin',owner:OTHER}),own=clone(f.server.get(key(USER)));
 assert.equal((await f.bridge.save(f.bridge.context('car-other'),{...record(),plate:'56다1234'})).ok,true);
 assert.equal(f.calls[0].p_owner,OTHER);assert.equal(f.calls[0].p_payload.length,1);assert.deepEqual(f.server.get(key(USER)),own);
});

test('accountant can obtain a read context but cannot persist links; dealer cannot write another owner',async()=>{
 const f=fixture({role:'accountant',owner:OTHER}),base=f.bridge.context('car-other');assert.equal(base.canWrite,false);
 await assert.rejects(f.bridge.save(base,{...record(),plate:'56다1234'}),error=>error.code==='FORBIDDEN');assert.equal(f.calls.length,0);
 const dealer=fixture();dealer.context.activeCarId='car-other';dealer.context.cars.push({id:'car-other',ownerId:alias(OTHER),plate:'56다1234'});assert.equal(dealer.bridge.context('car-other'),null);
});

test('non-active owner, missing company and duplicate vehicle contexts are denied',()=>{
 for(const change of [f=>{f.S.members[0].active=false;},f=>{f.S.company=null;},f=>{f.context.cars.push(clone(f.context.cars[0]));}]){
  const f=fixture();change(f);assert.equal(f.bridge.context('car-a'),null);
 }
});

test('record validation rejects external links, mismatched plates, unknown fields and invalid timestamps',async()=>{
 const changes=[data=>{data.plate='34나7890';},data=>{data.listings[0].sellerUrl='https://evil.example/';},data=>{data.listings[0].trustedUrl='javascript:alert(1)';},data=>{data.listings[0].trustedId=null;},data=>{data.verifiedAt='invalid';},data=>{data.verifiedAt=new Date(Date.now()+120000).toISOString();},data=>{data.extra='PRIVATE';},data=>{data.listings[0].phone='PRIVATE';},data=>{data.listings=Array.from({length:13},()=>data.listings[0]);}];
 for(const change of changes){const f=fixture(),data=record();change(data);await assert.rejects(f.bridge.save(f.bridge.context('car-a'),data),error=>error.code==='INVALID_DATA');assert.equal(f.calls.length,0);assert.equal(f.context.cars[0].encarLinks,undefined);}
});

test('preflush failure leaves the previous link record and unrelated edits intact',async()=>{
 const f=fixture();f.context.cars[0].encarLinks=record('previous');f.context.cars[0].buy=123;f.context.persistActual();f.failNext();
 await assert.rejects(f.bridge.save(f.bridge.context('car-a'),record('new')),error=>error.code==='NETWORK');
 assert.equal(f.context.cars[0].encarLinks.listings[0].model,'previous');assert.equal(f.context.cars[0].buy,123);
});

test('failed metadata ACK remains retryable but is never a confirmed success',async()=>{
 const f=fixture(),data=record();f.failNext();await assert.rejects(f.bridge.save(f.bridge.context('car-a'),data),error=>error.code==='NETWORK');
 assert.equal(f.S.queue.size,1);assert.equal(f.serverRecord().encarLinks,undefined);
 assert.equal((await f.bridge.save(f.bridge.context('car-a'),data)).ok,true);assert.deepEqual(f.serverRecord().encarLinks,data);
});

test('an invalid RPC revision cannot become a saved acknowledgement',async()=>{
 const f=fixture();f.invalidAck();await assert.rejects(f.bridge.save(f.bridge.context('car-a'),record()),error=>error.code==='NETWORK');
});

test('local write failure rolls back only the selected metadata field',async()=>{
 const f=fixture(),previous=record('previous');f.context.cars[0].encarLinks=previous;f.localStorage.fail=true;
 await assert.rejects(f.bridge.save(f.bridge.context('car-a'),record('next')),error=>error.code==='NETWORK');assert.equal(f.context.cars[0].encarLinks,previous);assert.equal(f.calls.length,0);
});

test('a newer queued save supersedes its predecessor and only the latest field reaches the server',async()=>{
 const f=fixture(),base=f.bridge.context('car-a');const first=f.bridge.save(base,record('old')),second=f.bridge.save(base,record('new'));
 const values=await Promise.allSettled([first,second]);assert.equal(values[0].status,'rejected');assert.equal(values[1].status,'fulfilled');
 assert.equal(f.calls.length,1);assert.equal(f.serverRecord().encarLinks.listings[0].model,'new');
});

test('a newer save waits for an already-sent RPC and then persists the latest result',async()=>{
 const f=fixture(),base=f.bridge.context('car-a'),gate=f.hold();const first=f.bridge.save(base,record('old'));const caught=first.catch(error=>error);
 await gate.entered.promise;const second=f.bridge.save(base,record('new'));gate.release.resolve();
 assert.equal((await caught).code,'CONTEXT_CHANGED');assert.equal((await second).ok,true);assert.equal(f.calls.length,2);
 assert.equal(f.serverRecord().encarLinks.listings[0].model,'new');
});

test('company, identity, plate and view changes during preflush prevent the old result from being applied',async()=>{
 for(const change of [f=>{f.S.company={id:'40000000-0000-4000-8000-000000000001'};},f=>{f.context.currentUser={...f.context.currentUser};},f=>{f.context.cars[0].plate='34나7890';},f=>{f.view(false);f.view(true);},f=>f.reset()]){
  const f=fixture(),base=f.bridge.context('car-a');f.context.cars[0].buy=123;f.context.persistActual();const gate=f.hold();
  const pending=f.bridge.save(base,record()).catch(error=>error);await gate.entered.promise;change(f);gate.release.resolve();
  assert.equal((await pending).code,'CONTEXT_CHANGED');assert.equal(f.context.cars[0].encarLinks,undefined);
 }
});

test('actual reload drains an old RPC before restoring canonical payload and revision',async()=>{
 const f=fixture(),base=f.bridge.context('car-a'),gate=f.hold(),data=record();
 const save=f.bridge.save(base,data).catch(error=>error);await gate.entered.promise;
 const reload=f.context.reloadActual();await Promise.resolve();assert.equal(f.S.ready,false);assert.equal(f.restores,0);
 gate.release.resolve();await reload;assert.equal((await save).code,'CONTEXT_CHANGED');
 assert.equal(f.restores,1);assert(f.events.indexOf('rpc-ack')<f.events.indexOf('restore'));
 assert.equal(f.S.revisions.get(key(USER)),8);assert.deepEqual(f.context.cars[0].encarLinks,data);
 f.context.cars[0].buy=456;f.context.persistActual();assert.equal((await f.context.flushActual()).ok,true);
 assert.equal(f.calls.at(-1).p_expected,8);assert.deepEqual(f.serverRecord().encarLinks,data);assert.equal(f.serverRecord().buy,456);
});

test('vehicle save cancellation checks every pending dataset before accepting a later cars ACK',()=>{
 const discard=between('function snoteVehicleDiscardPending(){','function snoteVehicleHasChanges(');
 for(const queued of [null,'prestock:shared','finance:shared']){
  const f=fixture(),scope=f.bridge.context('car-a');let undos=0,acknowledged=0;
  f.S.revisions.set(key(USER),8);if(queued)f.S.queue.add(queued);
  f.context.snoteVehicleSameView=()=>true;
  f.context.snoteVehicleAcknowledgePending=()=>{acknowledged++;};
  f.context.toast=()=>assert.fail('The fixture rollback must succeed');
  f.context.undoFixture=()=>{undos++;return true;};
  f.context.pendingFixture={context:{id:'car-a',cloud:true,scopeKey:scope.key},revision:7};
  vm.runInContext('let snoteVehicleUnconfirmedWrite={...pendingFixture,undo:undoFixture};\n'+discard,f.context);
  assert.equal(f.context.snoteVehicleDiscardPending(),true);
  assert.equal(undos,queued?1:0,'A partially saved transaction must remain cancellable');
  assert.equal(acknowledged,queued?0:1,'Only a fully acknowledged transaction is a previous completed save');
 }
});

test('vehicle acknowledgement status is scoped to the current authenticated vehicle and contains no payload',()=>{
 const f=fixture(),state=f.context.snoteVehicleWriteState('car-a');
 assert.deepEqual(Object.keys(state).sort(),['key','pending','revision','saving']);
 assert.equal(state.revision,7);assert.equal(state.pending,false);
 assert.equal(f.context.snoteVehicleWriteState('car-sibling'),null);
 f.S.ready=false;assert.equal(f.context.snoteVehicleWriteState('car-a'),null);
});

test('navigation checks real vehicle changes even when OCR has not emitted an input event',()=>{
 const questions=[],context={window:{},document:{querySelectorAll:()=>[]},SNOTE_DRAFT_HOSTS:'fixture',snoteVehicleHasChanges:()=>true,confirm:message=>{questions.push(message);return false;}};
 vm.createContext(context);
 vm.runInContext(between('function snotePrepareRouteChange(){',"addEventListener('popstate',snoteRestoreNavigation);"),context);
 assert.equal(context.snotePrepareRouteChange(),false);
 assert.equal(questions.length,1);assert.match(questions[0],/저장하지 않고 화면을 이동/);
});
