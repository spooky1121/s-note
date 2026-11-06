'use strict';
// Real app handlers with the recycle RPC contract intercepted; no production requests.
const assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ZERO='00000000-0000-0000-0000-000000000000';
const NEXT='33333333-3333-4333-8333-333333333333';
let browser;

async function setup(width=1440){
 const f=await fixture(width),p=f.page;
 await f.context.route('**/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[]})}));
 await p.evaluate(()=>{
  const S=window.__encarFixtureState,originalRpc=S.client.rpc.bind(S.client),originalFrom=S.client.from.bind(S.client);
  S.client.supabaseUrl='https://recycle-fixture.supabase.co';S.client.supabaseKey='synthetic-public-key';
  const owner=S.user.id,company=S.company.id,alias=currentUser.username,carId='encar-car-1';
  window.__recycle={owner,company,alias,carId,coversRevision:0,mode:'ok',calls:[],removed:[],uploads:[],archives:[],receipts:new Map(),clock:0,media:[],customer:{payload:{id:alias+':'+carId,ownerId:alias,carId,name:'합성 고객',phone:'01012345678',address:'합성 주소',refundAccount:'1234567890123'},has_rrn:false,updated_at:'2026-11-06T00:00:00.000Z',restore_generation:'00000000-0000-0000-0000-000000000000'}};
  const t=window.__recycle;t.coverState={};t.archivedMedia=[];S.ready=false;covers={};localStorage.setItem('zerocar-office-v12-covers-'+alias,'{}');S.ready=true;
  const clone=x=>x==null?x:structuredClone(x);
  const ack=(kind,customerChanged=false,mediaChanged=false)=>({ok:true,id:'44444444-4444-4444-8444-444444444444',ids:[],kind,ownerId:owner,carId,cars:kind==='customer'?null:{payload:clone(window.__encarFixtureCars),revision:window.__encarFixtureRevision},covers:kind==='customer'?null:{payload:clone(t.coverState),revision:t.coversRevision},customerChanged,mediaChanged});
  t.ack=ack;
  S.client.from=function(table){
   if(!['zc_media','zc_customers'].includes(table))return originalFrom(table);
   const filters={},q={select(){return q;},eq(k,v){filters[k]=v;return q;},in(k,v){filters[k]=new Set(v);return q;},limit(){return q;},order(){return q;},maybeSingle(){q.single=true;return q;},then(resolve,reject){
    let rows=table==='zc_media'?t.media:(t.customer?[{...t.customer,company_id:company,owner_id:owner,car_id:String(t.customer.payload.carId)}]:[]);
    rows=rows.filter(row=>Object.entries(filters).every(([k,v])=>v instanceof Set?v.has(row[k]):row[k]===v));
    return Promise.resolve({data:clone(q.single?(rows[0]||null):rows),error:null}).then(resolve,reject);
   }};return q;
  };
  S.client.storage={from(){return {async upload(path,blob){t.uploads.push(path);return {data:{path},error:null};},async remove(paths){t.removed.push(...paths);return {data:[],error:null};},async download(path){if(t.holdDownload){t.downloadWaiting=true;await new Promise(resolve=>t.releaseDownload=resolve);}return {data:new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7JkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),error:null};}};}};
  S.client.rpc=async(name,args)=>{
   if(!name.startsWith('snote_recycle_')&&name!=='snote_customer_save')return originalRpc(name,args);
   t.calls.push({name,args:clone(args)});
   if(t.holdRpc){t.rpcWaiting=true;await new Promise(resolve=>t.releaseRpc=resolve);}
   if(t.mode==='reject')return {data:null,error:{code:'40001',message:'CONFLICT'}};
   if(name==='snote_recycle_list')return {data:{items:[{id:'44444444-4444-4444-8444-444444444444',kind:'vehicle',label:'합성 차량',deletedAt:'2026-11-06T00:00:00Z',snapshot:'PRIVATE-DO-NOT-EXPOSE'}],total:1},error:null};
   if(name==='snote_customer_save'){
    const existing=t.customer,generation=existing?.restore_generation||'00000000-0000-0000-0000-000000000000';
    if((existing?.updated_at??null)!==args.p_expected_updated_at||generation!==args.p_expected_generation)return {data:null,error:{code:'40001',message:'CONFLICT'}};
    const updatedAt=new Date(Date.parse('2026-11-06T00:00:01Z')+(++t.clock)*1000).toISOString();
    t.customer={payload:clone(args.p_payload),has_rrn:args.p_has_rrn,updated_at:updatedAt,restore_generation:generation};
    return {data:{ok:true,updatedAt,restoreGeneration:generation},error:null};
   }
   if(args.p_request_id&&t.receipts.has(args.p_request_id)){
    if(t.mode==='unknown-always')return {data:null,error:{code:'',message:'Failed to fetch'}};
    return {data:{...clone(t.receipts.get(args.p_request_id)),alreadyProcessed:true},error:null};
   }
   let result;
   if(name==='snote_recycle_trash_vehicle'){
    assertArgs(args);t.bundle={car:clone(window.__encarFixtureCars.find(car=>String(car.id)===carId)),customer:clone(t.customer),media:clone(t.media),cover:t.coverState[carId]};window.__encarFixtureCars=window.__encarFixtureCars.filter(car=>String(car.id)!==carId);window.__encarFixtureRevision++;t.customer=null;t.media=[];delete t.coverState[carId];t.coversRevision++;t.archives.push('vehicle');result=ack('vehicle',true,true);
   }else if(name==='snote_recycle_media'){
    assertArgs(args);const gone=new Set(args.p_remove.map(row=>row.id));t.archivedMedia.push(...clone(t.media.filter(row=>gone.has(row.id))));t.media=t.media.filter(row=>!gone.has(row.id));
    t.media.push(...args.p_records.map(row=>({...clone(row),created_at:'2026-11-06T00:00:00Z'})));
    t.archives.push(...args.p_remove.map(row=>row.id));if(gone.has(t.coverState[carId])){t.archivedCover=t.coverState[carId];delete t.coverState[carId];t.coversRevision++;}result=ack('media',false,true);
   }else if(name==='snote_recycle_trash_customer'){
    if(!t.customer||t.customer.updated_at!==args.p_expected_updated_at||t.customer.restore_generation!==args.p_expected_generation)return {data:null,error:{code:'40001',message:'CONFLICT'}};
    t.customer=null;t.archives.push('customer');result=ack('customer',true,false);
   }else if(name==='snote_recycle_restore'){
    if(t.restoreKind==='vehicle'){window.__encarFixtureCars.push(clone(t.bundle.car));window.__encarFixtureRevision++;t.customer=clone(t.bundle.customer);t.customer.restore_generation='33333333-3333-4333-8333-333333333333';t.media=clone(t.bundle.media);if(t.bundle.cover)t.coverState[carId]=t.bundle.cover;t.coversRevision++;result=ack('vehicle',true,true);}
    else if(t.restoreKind==='media'){t.media.push(...clone(t.archivedMedia));if(t.archivedCover){t.coverState[carId]=t.archivedCover;t.coversRevision++;}result=ack('media',false,true);}
    else result=ack('customer',true,false);
   }
   else throw Error('Unexpected synthetic recycle RPC '+name);
   if(args.p_request_id)t.receipts.set(args.p_request_id,clone(result));
   if(t.mode==='unknown-once'||t.mode==='unknown-always')return {data:null,error:{code:'',message:'Failed to fetch'}};
   return {data:result,error:null};
  };
  function assertArgs(args){if(args.p_owner!==owner||args.p_company!==company||args.p_expected!==window.__encarFixtureRevision||args.p_expected_covers!==t.coversRevision)throw Error('Synthetic canonical CAS mismatch');}
  t.addMedia=()=>{const row={company_id:company,owner_id:owner,id:'old-file',car_id:carId,file_path:company+'/'+owner+'/'+carId+'/old-file.png',original_name:'old.png',mime_type:'image/png',file_size:1,group_name:'registration',meta:{},created_at:'2026-11-06T00:00:00Z'};t.media=[row];mediaByCar={[carId]:[{id:row.id,carId,ownerId:alias,cloudOwnerId:owner,filePath:row.file_path,group:row.group_name,filename:row.original_name,blob:new Blob(['x'],{type:'image/png'})}]};};
 });
 f.rpcRequests=[];
 await f.context.route('https://recycle-fixture.supabase.co/rest/v1/rpc/snote_*',async route=>{
  const request=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(request.method(),'POST');assert.equal(request.headers().apikey,'synthetic-public-key');assert.equal(request.headers().authorization,'Bearer synthetic-local-encar-session');
  const name=decodeURIComponent(new URL(request.url()).pathname.split('/').pop()),args=JSON.parse(request.postData());f.rpcRequests.push({name,args,authorization:request.headers().authorization});
  const result=await p.evaluate(({name,args})=>__encarFixtureState.client.rpc(name,args),{name,args});
  return route.fulfill({status:result.error?(result.error.code?400:503):200,headers,contentType:'application/json',body:JSON.stringify(result.error||result.data)});
 });
 return f;
}

async function happy(width){
 const f=await setup(width),p=f.page;
 const safe=await p.evaluate(async()=>snoteRecycleBinBridge.list(snoteRecycleBinBridge.context(),{}));assert.equal(safe.items[0].snapshot,undefined);
 await p.locator('#vehicle-header-delete').click();assert.match(await p.locator('#status-confirm-warning').textContent(),/휴지통/);assert.doesNotMatch(await p.locator('#status-confirm-warning').textContent(),/복구할 수 없/);
 await p.locator('#status-confirm-submit').click();await p.locator('#status-overlay.open').waitFor({state:'hidden'});
 assert.deepEqual(await p.evaluate(()=>[cars.map(row=>row.id),__recycle.archives,__recycle.removed]),[['encar-car-2'],['vehicle'],[]]);
 assert.equal(await p.evaluate(()=>__encarFixtureState.queue.size),0,'Canonical server application must not enqueue the deleted car again');
 await finish(f);console.log('PASS',width,'vehicle deletion ACK keeps bytes, removes only target, canonical revisions/cache without autosave resurrection');
}

async function media(){
 for(const mode of['ok','reject','unknown-once','unknown-always']){
  const f=await setup(),p=f.page;
  const result=await p.evaluate(async mode=>{const t=__recycle;t.addMedia();t.mode=mode;try{await updateDB([{id:'new-file',carId:t.carId,group:'registration',filename:'new.png',blob:new Blob(['new'],{type:'image/png'})}],['old-file']);return {ok:true};}catch(e){return {ok:false,code:e.code};}},mode);
  const state=await p.evaluate(()=>({calls:__recycle.calls.filter(row=>row.name==='snote_recycle_media'),removed:__recycle.removed,uploads:__recycle.uploads,archives:__recycle.archives,media:__recycle.media.map(row=>row.id),conflict:__encarFixtureState.conflict}));
  assert(!state.removed.some(path=>path.endsWith('old-file.png')),'Old document bytes must never be physically deleted');
  if(mode==='reject'){assert.equal(result.ok,false);assert.equal(result.code,'RECYCLE_CONFLICT');assert.deepEqual(state.media,['old-file']);assert.deepEqual(state.removed,state.uploads,'Explicit transactional failure cleans up only the fresh uncommitted upload');}
  else if(mode==='unknown-always'){assert.equal(result.code,'RECYCLE_UNCERTAIN_REQUEST');assert.deepEqual(state.removed,[]);assert.equal(state.conflict,true);assert.equal(state.calls.length,2);assert.equal(state.calls[0].args.p_request_id,state.calls[1].args.p_request_id);}
  else {assert.equal(result.ok,true);assert.deepEqual(state.media,['new-file']);assert.deepEqual(state.archives,['old-file']);assert.deepEqual(state.removed,[]);if(mode==='unknown-once'){assert.equal(state.calls.length,2);assert.equal(state.calls[0].args.p_request_id,state.calls[1].args.p_request_id);}}
  await finish(f);console.log('PASS media',mode,'atomic replace, protected bytes, retry identity and truthful uncertain-ACK handling');
 }
}

async function customers(){
 const f=await setup(),p=f.page;
 const result=await p.evaluate(async next=>{
  const t=__recycle,old=await zc72ReadCar(t.alias,t.carId);old.name='Old editor';t.customer.payload.name='New server';t.customer.updated_at='2026-11-06T00:00:00.500Z';
  let stale;try{await zc72Write(old);}catch(e){stale=e.code;}
  const fresh=await zc72ReadCar(t.alias,t.carId);t.customer.restore_generation=next;fresh.name='Before restore';let restored;try{await zc72Write(fresh);}catch(e){restored=e.code;}
  return {stale,restored,name:t.customer.payload.name,writes:t.calls.filter(row=>row.name==='snote_customer_save').length};
 },NEXT);
 assert.deepEqual(result,{stale:'RECYCLE_CONFLICT',restored:'RECYCLE_CONFLICT',name:'New server',writes:1});
 await p.evaluate(async()=>{const t=__recycle;await zc72Delete(t.alias,t.carId);});
 assert.equal(await p.evaluate(()=>__recycle.customer),null);assert.equal(await p.evaluate(()=>cars.length),2,'Customer-only archive must not change cars');
 assert.deepEqual(await p.evaluate(()=>__recycle.removed),[]);await finish(f);console.log('PASS customer fixed CAS and restore generation reject stale writes; customer-only archive preserves all vehicles/files');
}

async function views(){
 for(const changed of[false,true]){
  const f=await setup(),p=f.page;await p.evaluate(()=>{__recycle.customer.payload.refundAccount='';return openSaleProgress();});
  await p.locator('#zc72-name').fill('Saved input');
  const result=await p.evaluate(async({changed,next})=>{const t=__recycle;t.customer.updated_at='2026-11-06T00:00:00.500Z';if(changed)t.customer.restore_generation=next;await saleProgressContract({preventDefault(){}},'save');return{writes:t.calls.filter(row=>row.name==='snote_customer_save').length,error:document.getElementById('zc72-error').textContent,name:t.customer.payload.name};},{changed,next:NEXT});
  if(changed){assert.equal(result.writes,0);assert.match(result.error,/복원/);assert.equal(result.name,'합성 고객');}else {assert.equal(result.writes,1);assert.equal(result.error,'');assert.equal(result.name,'Saved input');}
  await finish(f);
 }
 const f=await setup(),p=f.page;
 const numeric=await p.evaluate(async next=>{const t=__recycle;t.customer.payload.carId=123;t.customer.restore_generation=next;zc80ReceiptCarId=123;snote214ReceiptRestoreGeneration='00000000-0000-0000-0000-000000000000';document.getElementById('zc76-receipt-overlay').hidden=false;try{await zc80SaveRrnField(t.alias,123,'9001011234567');return 'WRONG';}catch(e){return e.code;}},NEXT);
 assert.equal(numeric,'RECYCLE_CONFLICT');await p.evaluate(()=>{document.getElementById('zc76-receipt-overlay').hidden=true;zc80ReceiptCarId=null;});await finish(f);console.log('PASS sale view accepts ordinary/intake generation, rejects restored view, and numeric receipt IDs retain the generation guard');
}

async function lateMedia(){
 const f=await setup(),p=f.page;
 await p.evaluate(()=>{__recycle.addMedia();__recycle.holdDownload=true;window.__lateRefresh=refreshMedia();});
 await p.waitForFunction(()=>__recycle.downloadWaiting);
 await p.evaluate(()=>{const S=__encarFixtureState;S.user={id:'55555555-5555-4555-8555-555555555555'};S.company={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};currentUser={...currentUser,username:'cld_555555555555455585'};mediaByCar={'new-account-car':[{id:'new-account-file'}]};modelPhotos=[{id:'new-account-reference'}];__recycle.releaseDownload();});
 await p.evaluate(()=>window.__lateRefresh);
 assert.deepEqual(await p.evaluate(()=>[Object.keys(mediaByCar),mediaByCar['new-account-car'].map(row=>row.id),modelPhotos.map(row=>row.id)]),[['new-account-car'],['new-account-file'],['new-account-reference']]);
 await finish(f);console.log('PASS late private-media download cannot append to a different account/company cache or DOM');
}

async function pendingChanges(){
 const f=await setup(),p=f.page;
 await p.evaluate(()=>{__recycle.holdRpc=true;window.__pendingTrash=snoteRecycleBinBridge.trashVehicle(cars[0]).then(()=>({ok:true}),e=>({code:e.code}));});await p.waitForFunction(()=>__recycle.rpcWaiting);
 await p.evaluate(()=>{cars[1].extra='KEEP NEW LOCAL EDIT';persistCars();__recycle.holdRpc=false;__recycle.releaseRpc();});
 assert.equal((await p.evaluate(()=>window.__pendingTrash)).code,'RECYCLE_RELOAD_REQUIRED');
 assert.equal(await p.evaluate(()=>cars[1].extra),'KEEP NEW LOCAL EDIT');assert.equal(await p.evaluate(()=>__encarFixtureState.conflict),true);
 assert.deepEqual(await p.evaluate(()=>__encarFixtureCars.map(row=>row.id)),['encar-car-2']);assert.deepEqual(await p.evaluate(()=>__recycle.removed),[]);
 await finish(f);console.log('PASS committed trash never overwrites a local edit made during its request; autosave stays blocked until reconciliation');
 const late=await setup(),q=late.page;
 await q.evaluate(()=>{__recycle.holdRpc=true;const base=snoteRecycleBinBridge.context();window.__lateList=snoteRecycleBinBridge.list(base,{}).then(()=>({ok:true}),e=>({code:e.code}));});await q.waitForFunction(()=>__recycle.rpcWaiting);
 await q.evaluate(()=>{__encarFixtureState.user={id:'55555555-5555-4555-8555-555555555555'};__recycle.holdRpc=false;__recycle.releaseRpc();});
 assert.equal((await q.evaluate(()=>window.__lateList)).code,'RECYCLE_CONTEXT_CHANGED');await finish(late);console.log('PASS late recycle metadata response is rejected after account change');
}

async function pinnedActor(){
 for(const action of['trash','restore','customer']){
  const f=await setup(),p=f.page;
  await p.evaluate(action=>{const t=__recycle,S=__encarFixtureState;S.client.auth.getSession=async()=>{t.sessionWaiting=true;return new Promise(resolve=>t.releaseSession=resolve);};
   const operation=action==='trash'?()=>snoteRecycleBinBridge.trashVehicle(cars[0]):action==='restore'?()=>snoteRecycleBinBridge.restore(snoteRecycleBinBridge.context(),{id:'44444444-4444-4444-8444-444444444444'}):async()=>{const record=await zc72ReadCar(t.alias,t.carId);record.name='A save';return zc72Write(record);};
   window.__pinnedOperation=operation().then(()=>({ok:true}),e=>({code:e.code}));
  },action);await p.waitForFunction(()=>__recycle.sessionWaiting);
  await p.evaluate(()=>{const actor='55555555-5555-4555-8555-555555555555',S=__encarFixtureState;S.user={id:actor};currentUser={...currentUser,username:'cld_555555555555455585'};S.members.push({user_id:actor,company_id:S.company.id,role:'admin',active:true});__recycle.releaseSession({data:{session:{access_token:'different-actor-token',user:{id:actor}}},error:null});});
  assert.equal((await p.evaluate(()=>window.__pinnedOperation)).code,'RECYCLE_CONTEXT_CHANGED');assert.equal(f.rpcRequests.length,0,'An A action must never dispatch with B credentials after delayed getSession');
  assert.deepEqual(await p.evaluate(()=>__recycle.archives),[]);assert.equal(await p.evaluate(()=>__recycle.customer.payload.name),'합성 고객');await finish(f);
 }
 console.log('PASS delayed getSession plus account switch sends zero trash, restore or customer mutations with another actor token');
}

async function roundTrips(){
 for(const kind of['vehicle','media']){
  const f=await setup(),p=f.page;
  const state=await p.evaluate(async kind=>{const t=__recycle,S=__encarFixtureState;t.addMedia();t.restoreKind=kind;t.coverState[t.carId]='old-file';S.ready=false;covers[t.carId]='old-file';localStorage.setItem('zerocar-office-v12-covers-'+t.alias,JSON.stringify(covers));S.ready=true;
   const before=structuredClone(__encarFixtureCars),customer=structuredClone(t.customer.payload);
   if(kind==='vehicle')await snoteRecycleBinBridge.trashVehicle(cars.find(car=>car.id===t.carId));else await updateDB([],['old-file']);
   const trashed={cars:cars.map(car=>car.id),media:t.media.length,cover:covers[t.carId]??null};
   await snoteRecycleBinBridge.restore(snoteRecycleBinBridge.context(),{id:'44444444-4444-4444-8444-444444444444'});
   return{before,customer,trashed,after:__encarFixtureCars,restoredCustomer:t.customer.payload,restoredMedia:mediaByCar[t.carId].map(row=>({id:row.id,filePath:row.filePath,owner:row.cloudOwnerId})),cover:covers[t.carId],removed:t.removed,queue:S.queue.size};
  },kind);
  assert.equal(state.trashed.media,0);assert.equal(state.trashed.cover,null);assert.equal(state.trashed.cars.length,kind==='vehicle'?1:2);
  assert.deepEqual(state.after.slice().sort((a,b)=>a.id.localeCompare(b.id)),state.before.slice().sort((a,b)=>a.id.localeCompare(b.id)));assert.deepEqual(state.restoredCustomer,state.customer);assert.equal(state.cover,'old-file');assert.equal(state.restoredMedia[0].id,'old-file');assert.match(state.restoredMedia[0].filePath,/old-file.png$/);assert.equal(state.restoredMedia[0].owner,'11111111-1111-4111-8111-111111111111');assert.deepEqual(state.removed,[]);assert.equal(state.queue,0);
  await finish(f);console.log('PASS',kind,'restore applies canonical datasets/covers, refreshes retained private file and preserves customer payload without new autosave writes');
 }
}

(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of[1440,390])await happy(width);await media();await customers();await views();await lateMedia();await pendingChanges();await pinnedActor();await roundTrips();}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
