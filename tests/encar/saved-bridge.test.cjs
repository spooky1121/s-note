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
const detailMoney=between('function readDetailMoney(value){','function detailMoneyField(');
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
 const sellInput={value:'기존 입력',disabled:false,readOnly:false,events:[],dispatchEvent(event){this.events.push({type:event.type,bubbles:event.bubbles});return true;}};
 const storageOwner=k=>members.find(member=>store(member.user_id)===k)?.user_id;
 const context={S,Storage:MemoryStorage,localStorage,snote224VehicleOpen:1,console:{error(){},warn(){}},setTimeout(){return 1;},clearTimeout(){},
  currentUser:{username:alias(USER),role},activeCarId:owner===USER?'car-a':'car-other',cars:[],ownerAlias:alias,
  byId:id=>id==='vehicle-overlay'?overlay:id==='detail-sell'?sellInput:null,Event,
  snoteVehicleSaveTask:null,snoteVehicleCloseTask:null,snoteVehicleUnconfirmedWrite:null,
  isAccountant(){return context.currentUser?.role==='accountant';},isSnoteAdmin(){return context.currentUser?.role==='admin';},
  cloudKey:(dataset,ownerId)=>dataset+':'+ownerId,storageKey:(dataset,ownerId)=>'zerocar-office-v12-cars-'+ownerId,
  carsStoreKey:ownerId=>'zerocar-office-v12-cars-'+(ownerId||context.currentUser?.username),
  toEntry:k=>{const ownerId=storageOwner(k);return ownerId?{ds:'cars',owner:ownerId}:null;},isShared:()=>false,
  parsePayload:value=>{try{return JSON.parse(value);}catch{return null;}},defaultBody:()=> '[]',showStatus(){},errMsg:error=>error.message,
  fail(error){events.push('failure');},alert(){},confirm:()=>true,
  snote216ResetMonthly(){},snote216InitMonthly(){},snote222ResetContractSession(){},
  loadCarsForUser(){context.cars=[...server.values()].flatMap(row=>clone(row.payload));},loadCovers(){},refreshMedia:async()=>{},buildStats(){},navigate(){},route:'buy',
  snote220RefreshTaxonomy:async()=>{},snoteRefreshSalesOverview(){},snoteStartAccessTracking(){},
  async restoreDatasets(){events.push('restore');restores++;context.snote221ResetIncome();for(const [rowKey,row]of server){const ownerId=rowKey.slice(5);localStorage.data.set(store(ownerId),JSON.stringify(row.payload));S.revisions.set(rowKey,row.revision);}},
  window:null};
 context.window=context;
 for(const[rowKey,row]of server){localStorage.data.set(store(rowKey.slice(5)),JSON.stringify(row.payload));S.revisions.set(rowKey,row.revision);}
 context.cars=role==='dealer'?clone(server.get(key(USER)).payload):[...server.values()].flatMap(row=>clone(row.payload));
 S.client={from(table){
  assert.equal(table,'zc_datasets');const filters={};return {select(){return this;},eq(name,value){filters[name]=value;return this;},async maybeSingle(){
   assert.equal(filters.company_id,COMPANY);assert.equal(filters.dataset,'cars');
   const row=server.get(key(filters.owner_id));return {data:row?{...clone(row),company_id:COMPANY,dataset:'cars',owner_id:filters.owner_id}:null,error:null};
  }};
 },async rpc(name,args){
  assert.equal(name,'zc_write_dataset');assert.equal(args.p_dataset,'cars');assert.equal(args.p_company,COMPANY);
  const call={...args,p_payload:clone(args.p_payload)};calls.push(call);events.push('rpc-start');
  const waiting=gate;gate=null;if(waiting){waiting.entered.resolve();await waiting.release.promise;}
  if(failNext){failNext=false;return{error:{message:'fixture write failed'}};}
  const row=server.get(key(args.p_owner));if(row.revision!==args.p_expected)return{error:{message:'CONFLICT'}};
  const revision=row.revision+1;server.set(key(args.p_owner),{revision,payload:clone(args.p_payload)});events.push('rpc-ack');
  return{data:ackOverride?'invalid-ack':revision,error:null};
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../assets/money.js'),'utf8'),context);vm.runInContext(companyOwners+detailMoney+scrub+persist+storage+bridge+reset+reload+'\nwindow.flushActual=flush;window.persistActual=persistCars;window.reloadActual=reload;',context);
 return{context,S,server,calls,events,localStorage,sellInput,bridge:context.snoteEncarLinksBridge,
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

const pricedRecord=()=>{const data=record();Object.assign(data.listings[0],{priceWon:28200000,priceCheckedAt:data.verifiedAt,priceSource:'encar-api.com',priceStatus:'verified'});return data;};
test('price metadata remains integer KRW through actual persistence and reload without changing the planned sale price',async()=>{
 const f=fixture(),data=pricedRecord(),before=clone(f.server.get(key(USER)).payload);
 assert.equal((await f.bridge.save(f.bridge.context('car-a'),data)).ok,true);
 assert.deepEqual(f.serverRecord().encarLinks,data);assert.equal(f.serverRecord().encarLinks.listings[0].priceWon,28200000);
 assert.deepEqual(f.server.get(key(USER)).payload[1],before[1]);assert.equal(f.serverRecord().sell,undefined);
 const other=fixture({server:[...f.server]});assert.deepEqual(other.context.cars[0].encarLinks,data);
});
test('unavailable price metadata and old link-only records remain valid and cannot populate a price',async()=>{
 for(const unavailable of[false,true]){const f=fixture(),data=record();if(unavailable)Object.assign(data.listings[0],{priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'});
  const base=f.bridge.context('car-a');await f.bridge.save(base,data);assert.deepEqual(f.serverRecord().encarLinks,data);
  assert.throws(()=>f.bridge.applyPrice(base,data,'43000001'),error=>error.code==='INVALID_DATA');assert.equal(f.sellInput.events.length,0);
 }
});
test('invalid or inconsistent price metadata never reaches the database',async()=>{
 const changes=[...([0,-1,2.5,Infinity,Number.MAX_SAFE_INTEGER,1000000000001,'28200000'].map(value=>data=>{data.listings[0].priceWon=value;})),
  data=>{data.listings[0].priceSource='EUR';},data=>{data.listings[0].priceCheckedAt='2026-02-30';},data=>{data.listings[0].priceCheckedAt=new Date(Date.now()+120000).toISOString();},
  data=>{data.listings[0].priceStatus='unavailable';},data=>{delete data.listings[0].priceStatus;},data=>{data.listings[0].priceStatus='unknown';}];
 for(const change of changes){const f=fixture(),data=pricedRecord();change(data);await assert.rejects(f.bridge.save(f.bridge.context('car-a'),data),error=>error.code==='INVALID_DATA');assert.equal(f.calls.length,0);}
});
test('applying a confirmed price fills only the current price draft and preserves all stored vehicles',async()=>{
 const f=fixture(),base=f.bridge.context('car-a'),data=pricedRecord();await f.bridge.save(base,data);const snapshot=clone([...f.server]),cars=clone(f.context.cars),writes=f.calls.length;
 f.context.otherUnsavedDraft='보존할 다른 입력';
 const result=f.bridge.applyPrice(base,data,'43000001');assert.equal(result.ok,true);assert.equal(result.priceWon,28200000);assert.equal(result.saved,false);
 assert.equal(f.sellInput.value,'28,200,000');assert.deepEqual(f.sellInput.events,[{type:'input',bubbles:true}]);assert.equal(f.context.otherUnsavedDraft,'보존할 다른 입력');
 assert.equal(f.calls.length,writes);assert.deepEqual([...f.server],snapshot);assert.deepEqual(clone(f.context.cars),cars);
});
test('only the exact saved price and listing can be applied, including same-URL price changes',async()=>{
 const f=fixture(),base=f.bridge.context('car-a'),data=pricedRecord();await f.bridge.save(base,data);
 const changed=clone(data);changed.listings[0].priceWon++;
 assert.throws(()=>f.bridge.applyPrice(base,changed,'43000001'),error=>error.code==='CONTEXT_CHANGED');
 assert.throws(()=>f.bridge.applyPrice(base,data,'43000003'),error=>error.code==='INVALID_DATA');
 const payload=JSON.parse(f.localStorage.getItem(store(USER)));payload[0].encarLinks.listings[0].priceWon++;f.localStorage.data.set(store(USER),JSON.stringify(payload));
 assert.throws(()=>f.bridge.applyPrice(base,data,'43000001'),error=>error.code==='CONTEXT_CHANGED');assert.equal(f.sellInput.events.length,0);
});
test('price draft application refuses pending saves, conflicts, unavailable inputs and sold vehicles',async()=>{
 const changes=[f=>{f.S.saving=true;},f=>{f.S.conflict=true;},f=>{f.S.queue.add(key(USER));},f=>{f.context.snoteVehicleSaveTask={};},f=>{f.context.snoteVehicleCloseTask={};},f=>{f.context.snoteVehicleUnconfirmedWrite={};},f=>{f.sellInput.disabled=true;},f=>{f.sellInput.readOnly=true;},f=>{f.context.cars[0].status='판매완료';}];
 for(const change of changes){const f=fixture(),base=f.bridge.context('car-a'),data=pricedRecord();await f.bridge.save(base,data);change(f);assert.throws(()=>f.bridge.applyPrice(base,data,'43000001'));assert.equal(f.sellInput.events.length,0);}
});
test('price draft scope does not survive dealer, company, plate or drawer-session changes',async()=>{
 for(const change of[f=>{f.context.currentUser={...f.context.currentUser};},f=>{f.S.company={...f.S.company};},f=>{f.context.cars[0].plate='34나7890';},f=>{f.view(false);f.view(true);},f=>{f.reset();}]){
  const f=fixture(),base=f.bridge.context('car-a'),data=pricedRecord();await f.bridge.save(base,data);change(f);assert.throws(()=>f.bridge.applyPrice(base,data,'43000001'),error=>error.code==='CONTEXT_CHANGED');assert.equal(f.sellInput.events.length,0);
 }
});

const ocrCandidate=()=>({id:'price-1',display:'5,490만원',priceWon:54900000});
const ocrResponse=(candidates=[ocrCandidate()])=>({ok:true,purpose:'encar-price',engine:'google-vision',requiresConfirmation:true,candidates});
function ocrFixture(options={}){
 const f=fixture(options);Object.assign(f.context,{Blob,AbortController,TextDecoder,Uint8Array});
 const token='synthetic-local-ocr-session-token-12345';f.S.client.auth={getSession:async()=>({data:{session:{access_token:token,user:{id:USER}}},error:null})};
 const calls=[];f.context.fetch=async(url,init)=>{calls.push({url,init});return Response.json(ocrResponse());};
 return {...f,ocr:f.context.snoteEncarPriceOcrBridge,ocrCalls:calls,token,file:()=>new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'})};
}
test('OCR uses the authenticated fixed endpoint and exposes candidates without changing any stored price or image',async()=>{
 const f=ocrFixture(),base=f.ocr.context(),before=clone([...f.server]),data=await f.ocr.read(base,f.file());
 assert.deepEqual(clone(data),ocrResponse());assert.equal(f.ocrCalls.length,1);const request=f.ocrCalls[0];
 assert.equal(request.url,'/api/ocr?purpose=encar-price');assert.equal(request.init.method,'POST');assert.equal(request.init.redirect,'error');assert.equal(request.init.cache,'no-store');
 assert.equal(request.init.headers.Authorization,'Bearer '+f.token);assert.equal(request.init.headers['Content-Type'],'image/png');assert(request.init.body instanceof Blob);assert.equal(request.init.referrerPolicy,'no-referrer');
 assert.equal(f.calls.length,0);assert.deepEqual([...f.server],before);assert.equal(f.sellInput.events.length,0);
});
test('OCR confirmed candidate fills only the sale draft and a modified or cleared candidate cannot be applied',async()=>{
 const f=ocrFixture(),base=f.ocr.context(),data=await f.ocr.read(base,f.file()),before=clone([...f.server]);
 const wrong={...data.candidates[0],priceWon:5490000};assert.throws(()=>f.ocr.apply(base,wrong),error=>error.code==='INVALID_DATA');
 const result=f.ocr.apply(base,data.candidates[0]);assert.equal(result.saved,false);assert.equal(f.sellInput.value,'54,900,000');assert.equal(f.sellInput.events.length,1);
 assert.deepEqual([...f.server],before);assert.equal(f.calls.length,0);f.ocr.clear(base);assert.throws(()=>f.ocr.apply(base,data.candidates[0]),error=>error.code==='INVALID_DATA');
});
test('OCR rejects a bad purpose, confirmation marker, price factor, ID or display before a draft can change',async()=>{
 const changes=[d=>{d.purpose='registration';},d=>{d.requiresConfirmation=false;},d=>{d.engine='unknown';},d=>{d.candidates[0].priceWon=5490000;},d=>{d.candidates[0].display='5,490';},d=>{d.candidates[0].id='price-0';},d=>{d.candidates.push({...d.candidates[0]});},d=>{d.candidates[0].priceWon=1000000000001;}];
 for(const change of changes){const f=ocrFixture(),data=ocrResponse();change(data);f.context.fetch=async()=>Response.json(data);const base=f.ocr.context();await assert.rejects(f.ocr.read(base,f.file()),error=>error.code==='INVALID_DATA');assert.throws(()=>f.ocr.apply(base,ocrCandidate()),error=>error.code==='INVALID_DATA');assert.equal(f.sellInput.events.length,0);}
});
test('OCR validates image type and length before any authenticated or billed request',async()=>{
 const f=ocrFixture(),base=f.ocr.context();let sessions=0;f.S.client.auth.getSession=async()=>{sessions++;};
 for(const file of[new Blob([],{type:'image/png'}),new Blob(['not an image'],{type:'text/plain'}),new Blob([new Uint8Array(6*1024*1024+1)],{type:'image/png'})])await assert.rejects(f.ocr.read(base,file),error=>error.code==='INVALID_IMAGE');
 assert.equal(sessions,0);assert.equal(f.ocrCalls.length,0);
});
test('OCR pins the session user and does not send another account token with an image',async()=>{
 const f=ocrFixture(),base=f.ocr.context();f.S.client.auth.getSession=async()=>({data:{session:{access_token:f.token,user:{id:OTHER}}},error:null});
 await assert.rejects(f.ocr.read(base,f.file()),error=>error.code==='AUTH_REQUIRED');assert.equal(f.ocrCalls.length,0);
});
test('OCR fixed errors do not return provider bodies or leak a candidate from a failed response',async()=>{
 for(const [status,code] of[[401,'AUTH_REQUIRED'],[403,'FORBIDDEN'],[429,'OCR_RATE_LIMITED'],[503,'SETUP_REQUIRED'],[502,'OCR_FAILED']]){
  const f=ocrFixture(),base=f.ocr.context();f.context.fetch=async()=>Response.json({error:'PRIVATE_PROVIDER_BODY'}, {status});
  await assert.rejects(f.ocr.read(base,f.file()),error=>error.code===code&&!error.message.includes('PRIVATE_PROVIDER_BODY'));assert.throws(()=>f.ocr.apply(base,ocrCandidate()));
 }
});
test('OCR rejects oversized responses and inconsistent or empty candidates without changing a draft',async()=>{
 const f=ocrFixture(),base=f.ocr.context();f.context.fetch=async()=>new Response('x'.repeat(65537));await assert.rejects(f.ocr.read(base,f.file()));assert.equal(f.sellInput.events.length,0);
 f.context.fetch=async()=>Response.json(ocrResponse([]));assert.equal((await f.ocr.read(base,f.file())).candidates.length,0);assert.throws(()=>f.ocr.apply(base,ocrCandidate()),error=>error.code==='INVALID_DATA');
});
test('clearing or replacing an in-flight OCR read prevents stale candidate acceptance',async()=>{
 const f=ocrFixture(),base=f.ocr.context(),entered=deferred(),release=deferred();f.context.fetch=async()=>{entered.resolve();return release.promise;};
 const pending=f.ocr.read(base,f.file()).catch(error=>error);await entered.promise;f.ocr.clear(base);release.resolve(Response.json(ocrResponse()));assert.equal((await pending).code,'OCR_CANCELLED');
 assert.throws(()=>f.ocr.apply(base,ocrCandidate()),error=>error.code==='INVALID_DATA');
 f.context.fetch=async()=>Response.json(ocrResponse());assert.equal((await f.ocr.read(base,f.file())).candidates[0].priceWon,54900000);
});
test('OCR scope changes during session lookup never start an image upload',async()=>{
 const f=ocrFixture(),base=f.ocr.context(),gate=deferred();f.S.client.auth.getSession=()=>gate.promise;const pending=f.ocr.read(base,f.file()).catch(error=>error);
 f.context.currentUser={...f.context.currentUser};gate.resolve({data:{session:{access_token:f.token,user:{id:USER}}},error:null});assert.equal((await pending).code,'CONTEXT_CHANGED');assert.equal(f.ocrCalls.length,0);
});
test('OCR draft application preserves dealer and admin authority while denying accountant, sold and pending writes',async()=>{
 const admin=ocrFixture({role:'admin',owner:OTHER}),adminBase=admin.ocr.context(),adminData=await admin.ocr.read(adminBase,admin.file());assert.equal(admin.ocr.apply(adminBase,adminData.candidates[0]).ok,true);assert.equal(admin.calls.length,0);
 const accountant=ocrFixture({role:'accountant',owner:OTHER}),readBase=accountant.ocr.context(),readData=await accountant.ocr.read(readBase,accountant.file());assert.throws(()=>accountant.ocr.apply(readBase,readData.candidates[0]),error=>error.code==='FORBIDDEN');
 for(const change of[f=>{f.context.cars[0].status='판매완료';},f=>{f.S.saving=true;},f=>{f.S.queue.add(key(USER));},f=>{f.S.conflict=true;},f=>{f.context.snoteVehicleSaveTask={};}]){
  const f=ocrFixture(),base=f.ocr.context(),data=await f.ocr.read(base,f.file());change(f);assert.throws(()=>f.ocr.apply(base,data.candidates[0]));assert.equal(f.sellInput.events.length,0);
 }
});
