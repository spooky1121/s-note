'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8');
function between(start,end){const at=html.indexOf(start),stop=html.indexOf(end,at);assert(at>=0&&stop>at,start);return html.slice(at,stop);}
const entry=between('function snote239EncarListing(','function snote202InventoryAge(');
const scope=between('function isPurchaseListRoute(','let snotePurchaseNavigationScope=');
const refresh=between(' refreshList(base){',' async autoPrice(');
const ID='43000001',SECOND='43000002',OWNER='cld_own',OTHER='cld_other';
function record(){return {version:1,plate:'12가3456',verifiedAt:new Date().toISOString(),listings:[{id:ID,sellerUrl:'https://fem.encar.com/cars/detail/'+ID},{id:SECOND,sellerUrl:'https://fem.encar.com/cars/detail/'+SECOND}]};}
function fixture(options={}){
 const own={id:'car-a',ownerId:OWNER,plate:'12가3456',model:'검증 차량',status:'판매중',encarLinks:record()};
 const peer={...own,id:'car-b',ownerId:OTHER,model:'다른 차량',encarLinks:record()};
 const state={ready:true,cloudReady:true,conflict:false,dirty:false,motion:false,lookupAccepted:true,scopeKey:'company:user:dealer',companyId:'company',userId:'user',canCompany:false,allowed:new Set([own,peer]),openCalls:[],lookups:[],toasts:[],listRenders:0,baseline:{memo:'미저장 메모',repairs:[{memo:'추가비용',amount:'50,000'}]},...options};
 const overlay={open:false,classList:{contains(value){return value==='open'&&overlay.open;}}};
 const context={console,Date,Set,currentUser:{username:OWNER,role:'dealer'},route:'buy',cars:[own,peer],activeCarId:null,
  snoteVehicleSaveTask:null,snoteVehicleCloseTask:null,snoteVehicleUnconfirmedWrite:null,
  $:id=>id==='vehicle-overlay'?overlay:null,
  esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
  toast:value=>state.toasts.push(value),snoteVehicleHasChanges:()=>state.dirty,
  openVehicle(id){state.openCalls.push(id);state.baseline=null;context.activeCarId=id;overlay.open=true;state.afterOpen?.();},
  renderCars(){state.listRenders++;state.renderError?.();},
  snoteVehicleContext(){return context.activeCarId&&overlay.open?{car:context.cars.find(car=>car.id===context.activeCarId)}:null;},
  snoteVehicleCurrent:view=>state.currentView!==false&&view?.car===context.cars.find(car=>car.id===context.activeCarId),
  snoteEncarLinksCheck(base){if(state.checkThrows)throw Error('stale context');if(base!==state.refreshBase)throw Error('wrong base');return {car:own};},window:null};
 context.window=context;
 context.zc86Cloud={get ready(){return state.cloudReady;},get conflict(){return state.conflict;}};
 context.snoteDrawerMotion={pending:()=>state.motion};
 context.snoteCompanyPurchaseBridge={context:()=>state.noContext?null:{key:state.scopeKey,companyId:state.companyId,userId:state.userId,ownerAlias:state.ownerAlias??OWNER,role:state.role??context.currentUser?.role,ready:state.ready,canCompany:state.canCompany},carAllowed:car=>state.canCompany&&state.allowed.has(car)};
 context.snoteEncarLinksBridge={context:carId=>{const car=context.cars.find(car=>String(car.id)===carId);return car&&overlay.open&&String(context.activeCarId)===carId?{car,actor:context.currentUser,carId}:null;}};
 context.SnoteEncarLink={lookupCurrent(carId,listingId){state.lookups.push({carId,listingId,activeCarId:context.activeCarId,baseline:state.baseline});if(state.lookupThrows)throw Error('fixture failure');return state.lookupAccepted;}};
 vm.createContext(context);vm.runInContext(scope+entry+'\nwindow.refreshActual={'+refresh+'}.refreshList;',context);
 function event(extra={}){return {button:0,stopped:0,prevented:0,stopPropagation(){this.stopped++;},preventDefault(){this.prevented++;},...extra};}
 return {state,context,own,peer,overlay,event,click(extra={},carId='car-a',listingId=ID){const e=event(extra),result=context.snote239OpenEncarFromList(e,carId,listingId);return {event:e,result};}};
}
test('list icon binds the explicit canonical advertisement and escapes vehicle attributes',()=>{
 const f=fixture();f.own.model='<img src=x onerror=alert(1)>"';const markup=f.context.snote239EncarIcon(f.own);
 assert.match(markup,/data-encar-car-id="car-a"/);assert.match(markup,/data-encar-listing-id="43000001"/);
 assert.match(markup,/href="https:\/\/fem\.encar\.com\/cars\/detail\/43000001"/);assert.match(markup,/snote239OpenEncarFromList/);
 assert.equal(markup.includes('<img src=x'),false);assert.match(markup,/&lt;img/);assert.match(markup,/onkeydown="event.stopPropagation\(\)"/);
});
test('normal icon activation opens the exact visible drawer and immediately rechecks the selected advertisement',()=>{
 const f=fixture(),value=f.click({},'car-a',SECOND);
 assert.equal(value.result,false);assert.equal(value.event.stopped,1);assert.equal(value.event.prevented,1);
 assert.deepEqual(f.state.openCalls,['car-a']);assert.deepEqual(f.state.lookups,[{carId:'car-a',listingId:SECOND,activeCarId:'car-a',baseline:null}]);
});
test('legacy numeric advertisement identifiers retain canonical rendering and normalize the selected lookup id',()=>{
 const f=fixture();f.own.encarLinks.listings[0].id=Number(ID);
 assert.match(f.context.snote239EncarIcon(f.own),/data-encar-listing-id="43000001"/);
 f.click();assert.equal(f.state.lookups[0].listingId,ID);assert.equal(typeof f.state.lookups[0].listingId,'string');
});
test('already-open exact vehicle is reused without resetting dirty memo or additional-cost drafts',()=>{
 const f=fixture({dirty:true});f.overlay.open=true;f.context.activeCarId='car-a';const baseline=f.state.baseline;
 f.click();assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,1);assert.equal(f.state.baseline,baseline);assert.equal(f.state.lookups[0].baseline,baseline);
});
test('a different dirty drawer is never opened or reset by a list advertisement click',()=>{
 const f=fixture({dirty:true});f.overlay.open=true;f.context.activeCarId='car-b';const baseline=f.state.baseline;
 f.click();assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);assert.equal(f.context.activeCarId,'car-b');assert.equal(f.state.baseline,baseline);assert.equal(f.state.toasts.length,1);
});
test('save, close, unconfirmed writes, close animation and conflict block list entry before a draft reset',()=>{
 for(const mutate of [f=>f.context.snoteVehicleSaveTask={},f=>f.context.snoteVehicleCloseTask={},f=>f.context.snoteVehicleUnconfirmedWrite={},f=>f.state.motion=true,f=>f.state.conflict=true]){
  const f=fixture();f.overlay.open=true;f.context.activeCarId='car-b';const baseline=f.state.baseline;mutate(f);f.click();
  assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);assert.equal(f.state.baseline,baseline);
 }
});
test('missing, sold, duplicate and out-of-scope vehicles never reach openVehicle',()=>{
 for(const mutate of [f=>f.context.route='sell',f=>f.context.route='finance',f=>f.state.ready=false,f=>f.state.cloudReady=false,f=>f.state.noContext=true,f=>f.state.companyId='',f=>f.state.userId='',f=>f.state.scopeKey='',f=>f.state.ownerAlias=OTHER,f=>f.state.role='admin',f=>f.context.currentUser=null,f=>f.context.cars=[],f=>f.context.cars.push({...f.own}),f=>f.own.status='판매완료',f=>f.own.ownerId=OTHER]){
  const f=fixture();const baseline=f.state.baseline;mutate(f);f.click();assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);assert.equal(f.state.baseline,baseline);
 }
});
test('company administrators can recheck an allowed owner while dealer and ordinary purchase scope remain restricted',()=>{
 const allowed=fixture({canCompany:true});allowed.context.currentUser.role='admin';allowed.context.route='companyBuy';allowed.click({},'car-b');assert.deepEqual(allowed.state.openCalls,['car-b']);assert.equal(allowed.state.lookups[0].carId,'car-b');
 for(const change of [f=>f.state.canCompany=false,f=>f.state.allowed.delete(f.peer),f=>f.context.route='buy']){
  const f=fixture({canCompany:true});f.context.currentUser.role='admin';f.context.route='companyBuy';change(f);f.click({},'car-b');assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);
 }
});
test('malformed or stale saved advertisement identity is rejected before opening a drawer',()=>{
 for(const mutate of [f=>f.own.encarLinks.plate='34나5678',f=>f.own.encarLinks.verifiedAt=new Date(Date.now()+120000).toISOString(),f=>f.own.encarLinks.listings[0].sellerUrl='https://evil.example/',f=>f.own.encarLinks.listings[0].id='javascript:alert(1)',f=>f.own.encarLinks.listings.push({...f.own.encarLinks.listings[0]}),f=>f.own.plate='',f=>f.own.encarLinks.listings=[]]){
  const f=fixture();mutate(f);assert.equal(f.context.snote239EncarIcon(f.own),'');f.click();assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);
 }
 const f=fixture();f.click({},'car-a','43000099');assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);
});
test('modified and middle clicks preserve native advertisements without opening or resetting vehicle drafts',()=>{
 for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2}]){
  const f=fixture(),baseline=f.state.baseline,value=f.click(extra);assert.equal(value.result,true);assert.equal(value.event.prevented,0);assert.equal(value.event.stopped,1);assert.equal(f.state.openCalls.length,0);assert.equal(f.state.lookups.length,0);assert.equal(f.state.baseline,baseline);
 }
 const f=fixture();delete f.context.SnoteEncarLink;const value=f.click();assert.equal(value.result,true);assert.equal(value.event.prevented,0);assert.equal(f.state.openCalls.length,0);
});
test('context changes caused while rendering cannot start an old actor, route, company or vehicle lookup',()=>{
 for(const mutate of [f=>f.context.currentUser={username:OWNER,role:'dealer'},f=>f.context.route='finance',f=>f.state.scopeKey='other-company',f=>f.context.cars[0]={...f.own},f=>f.context.activeCarId='car-b',f=>f.overlay.open=false,f=>f.state.ready=false]){
  const f=fixture();f.state.afterOpen=()=>mutate(f);f.click();assert.deepEqual(f.state.openCalls,['car-a']);assert.equal(f.state.lookups.length,0);
 }
});
test('busy or failed lookup dispatch cannot fall through into a native or duplicate request',()=>{
 for(const options of [{lookupAccepted:false},{lookupThrows:true}]){
  const f=fixture(options),value=f.click();assert.equal(value.result,false);assert.equal(value.event.prevented,1);assert.equal(f.state.lookups.length,1);assert.equal(f.state.toasts.length,1);
 }
});
test('confirmed-save refresh repaints only the current purchase list and preserves detail draft objects',()=>{
 const f=fixture();f.overlay.open=true;f.context.activeCarId='car-a';const baseline=f.state.baseline,base={};f.state.refreshBase=base;
 assert.equal(f.context.refreshActual(base),true);assert.equal(f.state.listRenders,1);assert.equal(f.state.baseline,baseline);assert.equal(f.state.openCalls.length,0);assert.equal(f.context.activeCarId,'car-a');
 for(const mutate of [()=>f.state.checkThrows=true,()=>{f.state.checkThrows=false;f.context.route='finance';},()=>{f.context.route='buy';f.context.activeCarId='car-b';},()=>{f.context.activeCarId='car-a';f.state.currentView=false;}]){
  mutate();assert.equal(f.context.refreshActual(base),false);assert.equal(f.state.listRenders,1);assert.equal(f.state.baseline,baseline);
 }
});
