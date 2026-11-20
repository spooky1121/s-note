'use strict';
// Real application/CAS/Chromium with synthetic auth, ads and owner datasets only.
// No provider, SMS, production database or real vehicle data is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.ENCAR_ID_ARTIFACT_DIR||'/workspace/work/encar-saved-v2159/browser';fs.mkdirSync(OUT,{recursive:true});
const SCENARIO=process.env.ENCAR_SAVED_TEST_SCENARIO||'all';
const WIDTHS=process.env.ENCAR_ID_TEST_WIDTHS?process.env.ENCAR_ID_TEST_WIDTHS.split(',').map(Number):[1440,390];
const CAR='encar-car-1',OTHER_CAR='encar-car-2',PLATE='12가3456',SECOND='34나5678',ID='43123456';
const URL_FOR=id=>'https://fem.encar.com/cars/detail/'+id+'?listAdvType=share&adnm=mo_detail_url';
const dialog=p=>p.locator('#snote-encar-id-dialog');
const found=(id=ID,plate=PLATE,provider='gloar')=>({ok:true,status:'found',plate,id,provider});
const results=[];
async function until(p,check,message,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await p.waitForTimeout(20);}assert.fail(message);}
async function setup(width=1440,{savedCars=null,wireKRW=false}={}){
 const f=await fixture(width,savedCars,{lookupUnavailable:true}),p=f.page;
 const state={ids:[],prices:[],idReplies:[],priceReplies:[],holds:[],legacy:[],popups:[],navigations:[],priceWon:12000000};f.ads=state;
 f.context.on('page',popup=>state.popups.push(popup));
 await f.context.route('https://fem.encar.com/**',async route=>{
  const url=new URL(route.request().url());assert.match(url.pathname,/^\/cars\/detail\/[1-9][0-9]{5,11}$/);assert.equal(url.search,'?listAdvType=share&adnm=mo_detail_url');state.navigations.push(url.href);
  await route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><title>합성 광고</title><p>외부 요청 없는 엔카 광고 응답</p>'});
 });
 await p.route('**/api/encar*',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();
  if(!['/api/encar-id','/api/encar-ad-price'].includes(url.pathname)){state.legacy.push(url.pathname);return route.fulfill({status:410,contentType:'application/json',body:'{"ok":false,"code":"RETIRED"}'});}
  assert.equal(req.method(),'POST');assert.match(req.headers()['content-type'],/^application\/json/);assert.equal(req.headers().authorization,'Bearer '+await p.evaluate(()=>__encarFixtureSession.access_token));
  assert([PLATE,SECOND].includes(body.plate),'Only the fixture vehicle plate may be queried');
  let reply;
  if(url.pathname==='/api/encar-id'){assert.deepEqual(Object.keys(body),['plate']);state.ids.push(body);reply=state.idReplies.shift();assert(reply,'Every GLOAR discovery must have an explicit synthetic response');}
  else{assert.deepEqual(Object.keys(body).sort(),['id','plate']);assert.match(body.id,/^[1-9][0-9]{5,11}$/);state.prices.push(body);reply=state.priceReplies.shift()||{body:{ok:true,id:body.id,plate:body.plate,priceWon:state.priceWon,checkedAt:new Date().toISOString(),source:'encar'}};}
  if(reply.hold)await new Promise(resolve=>state.holds.push({path:url.pathname,release:resolve}));
  try{await route.fulfill({status:reply.status||200,contentType:'application/json',body:JSON.stringify(reply.body)});}catch(error){if(!reply.hold)throw error;}
 });
 await p.waitForFunction(()=>!!window.SnoteEncarId&&typeof snoteEncarIdBridge.saveLink==='function'&&typeof snoteEncarIdBridge.saved==='function');
 // The shared fixture hydrates an authoritative revision-zero dataset without
 // performing the normal cloud read. Supply that read receipt, not a mutation.
 await p.evaluate(()=>{const S=__encarFixtureState;S.revisions.set('cars:'+S.user.id,__encarFixtureRevision);});
 if(wireKRW){
  await p.evaluate(async()=>{
   await closeVehicle({discard:true});const S=__encarFixtureState,wire=structuredClone(__encarFixtureCars);
   wire[0]={...wire[0],moneyUnit:'KRW',buy:10000000,sell:12000000,costs:{performanceInspection:123457,purchaseFee:2},repairItems:[{memo:'합성 원본 수리',amount:3}]};
   __encarFixtureCars=wire;__encarFixtureRevision=1;cars=normalizedCars(wire,currentUser.username);
   localStorage.setItem(carsStoreKey(currentUser.username),JSON.stringify(wire));S.revisions.set('cars:'+S.user.id,1);S.queue.clear();openVehicle('encar-car-1');
  });
 }
 if(savedCars){
  await p.evaluate(async()=>{persistCars();const result=await zc86Cloud.flush();if(result?.ok!==true)throw Error('Synthetic saved dataset bootstrap failed');renderCars();renderVehicle();});
 }
 await buy(p);await reopen(p);
 await p.locator('#vehicle-encar-check:not([disabled])').waitFor();return f;
}
async function clean(f){
 assert.deepEqual(f.ads.legacy,[],'Retired resolver/auto-price/OCR endpoints must not be invoked');
 assert.deepEqual(f.requests,[]);assert.deepEqual(f.autoPriceRequests,[]);assert.deepEqual(f.navigations,[]);
 assert.equal(f.ads.idReplies.length,0,'Every queued discovery response must be consumed');assert.equal(f.ads.priceReplies.length,0,'Every queued price response must be consumed');
 for(const hold of f.ads.holds.splice(0))hold.release();await finish(f);
}
async function snapshot(p){return p.evaluate(()=>({runtime:structuredClone(cars),wire:structuredClone(__encarFixtureCars),writes:structuredClone(__encarFixtureWrites),revision:__encarFixtureRevision,pending:__encarFixtureState.queue.size}));}
async function saved(p,id=CAR){return p.evaluate(id=>{const context=snoteEncarIdBridge.context(id,'detail');return context?snoteEncarIdBridge.saved(context):null;},id);}
async function awaitSaved(p,id=ID){await p.waitForFunction(({car,id})=>{const context=snoteEncarIdBridge.context(car,'detail');return context&&snoteEncarIdBridge.saved(context)?.id===id;},{car:CAR,id});return saved(p);}
async function lookup(f,reply=found()){
 f.ads.idReplies.push(reply?.body?reply:{body:reply});await f.page.locator('#vehicle-encar-check').click();await dialog(f.page).waitFor({state:'visible'});
}
async function assertFound(p,id=ID){
 await p.locator('#snote-encar-id-dialog [data-encar-ad-id]').filter({hasText:id}).waitFor();
 const link=dialog(p).locator('[data-encar-ad-link]');assert.equal(await link.getAttribute('href'),URL_FOR(id));assert.equal(await link.textContent(),URL_FOR(id));assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
 assert.equal(await dialog(p).locator('[data-encar-error-details]').isVisible(),false);
}
async function closeID(p){await dialog(p).getByRole('button',{name:'확인',exact:true}).click();await dialog(p).waitFor({state:'hidden'});}
async function awaitPrice(p,amount){
 await p.waitForFunction(amount=>{const context=snoteEncarIdBridge.context('encar-car-1','detail');return context&&snoteEncarIdBridge.saved(context)?.priceWon===amount;},amount);
 assert.match(await p.locator('#snote-encar-ad-price').textContent(),new RegExp(amount.toLocaleString('en-US')));
}
async function openSaved(f,selector='#vehicle-encar-check',id=ID){
 const before=f.ads.ids.length,opened=f.context.waitForEvent('page');await (typeof selector==='string'?f.page.locator(selector):selector).click();const popup=await opened;await popup.waitForURL(URL_FOR(id));assert.equal(await popup.evaluate(()=>opener===null),true,'The explicitly clicked saved advertisement must have no opener');assert.equal(f.ads.ids.length,before,'A saved-link click must not repeat GLOAR discovery');await popup.close();return popup;
}
async function buy(p){await p.evaluate(async()=>{await closeVehicle({discard:true});navigate('buy');});await p.locator('#list-screen').waitFor({state:'visible'});}
const icon=(p,id=CAR)=>p.locator('#list-screen .snote-list-encar[data-encar-id-car="'+id+'"]');
async function reopen(p,id=CAR){await p.evaluate(async id=>{if(document.getElementById('vehicle-overlay').classList.contains('open'))await closeVehicle({discard:true});openVehicle(id);},id);}
async function discovery(width){
 const f=await setup(width),p=f.page,s=f.ads;try{
  const original=await snapshot(p);await buy(p);assert.equal(await icon(p,CAR).count(),0);assert.equal(await icon(p,OTHER_CAR).count(),0,'Unsearched vehicles must have no Encar icon');await reopen(p);
  await p.evaluate(()=>__encarFixtureWriteMode='hold');await lookup(f);await p.waitForFunction(()=>__encarFixtureWriteWaiting);
  assert.equal(await saved(p),null,'An optimistic link must not be usable before the server ACK');assert.equal(await icon(p).count(),0,'Pending metadata cannot publish the purchase-list icon');assert.equal(s.popups.length,0,'First discovery must retain the explicit result link instead of navigating');
  await p.evaluate(()=>{__encarFixtureWriteMode='ok';__encarFixtureReleaseWrite();});await assertFound(p);const record=await awaitSaved(p);
  assert.equal(record.plate,PLATE);assert.equal(record.url,URL_FOR(ID));assert.equal(record.version,2);assert((await icon(p).count())>0);await awaitPrice(p,12000000);await closeID(p);
  const written=await snapshot(p);assert.equal(written.wire[0].encarLinks.id,ID);assert.equal(written.wire[0].encarLinks.url,URL_FOR(ID));assert.deepEqual(written.wire[1],original.wire[1],'Link/price metadata updates must preserve sibling rows');assert.equal(written.runtime[0].sell,12000000);
  const priceRequests=s.prices.length;await openSaved(f);assert.equal(s.ids.length,1);assert.equal(s.prices.length,priceRequests,'A fresh cached advertised amount avoids a repeated browser price request');
  await p.screenshot({path:path.join(OUT,'saved-detail-'+width+'.png')});await buy(p);assert.equal(await icon(p,OTHER_CAR).count(),0);const direct=icon(p).filter({visible:true}).first();assert(await direct.count());await openSaved(f,direct);assert.equal(s.prices.length,priceRequests,'A list link click must not fetch or modify prices');
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');await openSaved(f,icon(p).filter({visible:true}).first());await p.screenshot({path:path.join(OUT,'saved-cards-'+width+'.png')});
  const wire=(await snapshot(p)).wire;await clean(f);
  const restored=await setup(width,{savedCars:wire});try{assert.equal((await saved(restored.page)).id,ID);const before=(await snapshot(restored.page)).writes.length;await openSaved(restored);assert.equal(restored.ads.ids.length,0,'A new browser must reuse persisted server metadata');assert.equal((await snapshot(restored.page)).writes.length,before,'Reusing a fresh saved link must not create another vehicle mutation');await clean(restored);}catch(error){await restored.context.close().catch(()=>{});throw error;}
  results.push({name:'discovery/saved link/list/cards/reload',width,passed:true});console.log('PASS '+width+' first discovery waits for DB ACK; saved detail/list/card links open directly with no opener, no rediscovery, correct persisted metadata and sibling preservation');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-discovery-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function comparison(width,{wireKRW=false}={}){
 const f=await setup(width,{wireKRW}),p=f.page,s=f.ads;try{
  const original=await snapshot(p);s.priceWon=54900000;await p.locator('#detail-extra').fill('아직 저장하지 않은 설명');f.answerConfirm(false,/변경하시겠습니까/);
  await lookup(f);await assertFound(p);await awaitPrice(p,54900000);await closeID(p);await until(p,()=>f.dialogs.filter(d=>d.type==='confirm'&&/변경하시겠습니까/.test(d.message)).length===1,'The current advertised amount must be compared with the planned price');
  let state=await snapshot(p);assert.equal(state.runtime[0].sell,12000000,'Cancel must preserve planned price');assert.equal(await p.locator('#detail-sell').inputValue(),'12,000,000');assert.equal(await p.locator('#detail-extra').inputValue(),'아직 저장하지 않은 설명');
  assert.equal(await p.locator('#snote-encar-advertisement').evaluate(panel=>[panel,...panel.children].filter(node=>!node.hidden).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})),true,'Advertisement amount and both controls must stay inside the viewport');await p.screenshot({path:path.join(OUT,'price-comparison-'+width+'-'+(wireKRW?'KRW':'legacy')+'.png')});
  const before=state.writes.length;f.answerConfirm(true,/변경하시겠습니까/);await p.locator('#snote-encar-price-change').click();await p.waitForFunction(()=>cars[0].sell===54900000&&!snoteVehicleSaveTask);await until(p,async()=>(await snapshot(p)).writes.length===before+1,'Accept must make exactly one isolated sale-price write');
  state=await snapshot(p);assert.equal(state.wire[0].sell,wireKRW?54900000:5490,'The raw storage price must preserve its original won/legacy denomination');assert.equal(state.wire[0].moneyUnit,wireKRW?'KRW':undefined);assert.equal(state.wire[0].buy,original.wire[0].buy);assert.deepEqual(state.wire[0].costs,original.wire[0].costs);assert.deepEqual(state.wire[0].repairItems,original.wire[0].repairItems);assert.deepEqual(state.wire[1],original.wire[1]);assert.equal(state.wire[0].extra,original.wire[0].extra,'An ad-price confirmation must not commit another unsaved field');assert.equal(await p.locator('#detail-extra').inputValue(),'아직 저장하지 않은 설명');assert.equal(await p.locator('#detail-sell').inputValue(),'54,900,000');assert.match(await p.locator('#toast').textContent(),/저장되었습니다/);assert.match(await p.locator('#snote-encar-ad-price').textContent(),/54,900,000/);
  await p.screenshot({path:path.join(OUT,'price-'+width+'-'+(wireKRW?'KRW':'legacy')+'.png')});await clean(f);results.push({name:'price comparison/cancel/accept/raw unit isolation',width,wireKRW,passed:true});console.log('PASS '+width+' '+(wireKRW?'KRW':'legacy')+' advertised price remains integer won; cancellation is read-only; confirmation saves only sell and preserves drafts, sibling data and original wire units');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-price-'+width+'-'+wireKRW+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function failures(){
 for(const mode of ['fail','lost-response']){
  const f=await setup(),p=f.page;try{
   await p.evaluate(mode=>__encarFixtureWriteMode=mode,mode);await lookup(f);await dialog(p).locator('[data-encar-id-loading]').waitFor({state:'hidden'});assert.equal(await saved(p),null,'Unacknowledged metadata cannot become an active saved link');assert.equal(await icon(p).count(),0);assert.equal(f.ads.popups.length,0);assert.equal(f.ads.prices.length,0,'An unconfirmed link must not trigger a price request');
   await closeID(p);await p.evaluate(async()=>{__encarFixtureWriteMode='ok';const result=await zc86Cloud.flush();if(result?.ok!==true)throw Error('Synthetic retry reconciliation failed');renderCars();});await awaitSaved(p);assert((await icon(p).count())>0,'An explicitly reconciled server ACK can publish the recovered link');if(mode==='lost-response')assert.equal((await snapshot(p)).writes.length,1,'A lost ACK must reconcile the committed snapshot without duplicate writes');
   await clean(f);results.push({name:'unacknowledged metadata and recovery',mode,passed:true});
  }catch(error){await p.screenshot({path:path.join(OUT,'failure-write-'+mode+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
 }
 const f=await setup(),p=f.page,s=f.ads;try{
  s.priceReplies.push({status:429,body:{ok:false,code:'UPSTREAM_RATE_LIMITED',error:'PRIVATE_PROVIDER_ERROR'}});await lookup(f);await assertFound(p);await awaitSaved(p);await closeID(p);await until(p,()=>s.prices.length===1,'Price request must have been attempted');await p.waitForFunction(()=>!document.getElementById('snote-encar-price-refresh').disabled);assert(!((await p.locator('#snote-encar-advertisement').textContent()).includes('PRIVATE_PROVIDER_ERROR')));assert.equal((await snapshot(p)).runtime[0].sell,12000000);await openSaved(f);assert.equal(s.ids.length,1,'A price-service restriction must not force GLOAR rediscovery');await clean(f);results.push({name:'price failure preserves saved navigation',passed:true});
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function diagnostics(){
 const f=await setup(),p=f.page,s=f.ads;try{
  const original=(await snapshot(p)).wire;
  for(const item of [
   {status:200,body:{ok:false,status:'not_found',code:'NOT_FOUND',error:'PRIVATE_PROVIDER_TEXT'},hidden:true},
   {status:502,body:{ok:false,code:'GLOAR_INPUT_UNCONFIRMED',error:'PRIVATE_PROVIDER_TEXT'},source:/GLOAR/,message:'서버에 오류가 있습니다. 잠시후 다시 시도해주세요.'},
   {status:429,body:{ok:false,code:'UPSTREAM_RATE_LIMITED',error:'PRIVATE_PROVIDER_TEXT'},source:/Cloudflare/},
   {status:429,body:{ok:false,code:'BROWSER_DAILY_LIMIT',error:'PRIVATE_PROVIDER_TEXT'},source:/Cloudflare/},
   {status:502,body:{ok:false,code:'AUTH_UNAVAILABLE',error:'PRIVATE_PROVIDER_TEXT'},source:/S-NOTE/},
   {status:502,body:{ok:false,code:'<img src=x onerror=alert(1)> PRIVATE_TOKEN_123',error:'PRIVATE_PROVIDER_TEXT'},source:/확인되지 않음/}
  ]){
   await lookup(f,item);await dialog(p).locator('[data-encar-id-loading]').waitFor({state:'hidden'});assert.equal(await dialog(p).locator('[data-encar-ad-link]').getAttribute('href'),null);assert.equal(await dialog(p).locator('[data-encar-ad-id]').textContent(),'');const text=await dialog(p).innerText();assert(!/PRIVATE_PROVIDER_TEXT|PRIVATE_TOKEN_123|onerror/.test(text));assert.equal(await dialog(p).locator('img[src="x"]').count(),0);
   if(item.hidden)assert.equal(await dialog(p).locator('[data-encar-error-details]').isVisible(),false);else{assert.match(await dialog(p).locator('[data-encar-error-source]').textContent(),item.source);if(item.message)assert.equal(await dialog(p).locator('[role="status"]').textContent(),item.message);}
   await closeID(p);
  }
  for(const bad of [found('<img src=x onerror=alert(1)>'),found(ID,SECOND),found(ID,PLATE,'trust')]){await lookup(f,bad);await dialog(p).locator('[data-encar-id-loading]').waitFor({state:'hidden'});assert.equal(await saved(p),null);await closeID(p);}
  assert.deepEqual((await snapshot(p)).wire,original);assert.equal((await snapshot(p)).writes.length,0);assert.equal(s.prices.length,0);await clean(f);results.push({name:'fixed failure diagnostics and malformed response rejection',passed:true});console.log('PASS bounded GLOAR diagnostics, unknown/private text sanitization, wrong plate/provider/ID rejection and failed-search read-only behavior');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function stale(){
 for(const action of ['close','reopen','other-car','account']){
  const f=await setup(),p=f.page,s=f.ads;try{
   s.idReplies.push({body:found(),hold:true});await p.locator('#vehicle-encar-check').click();await until(p,()=>s.holds.some(h=>h.path==='/api/encar-id'),'Discovery must reach its held response');
   await p.evaluate(async action=>{if(action==='account'){__encarFixtureState.user={id:'99999999-9999-4999-8999-999999999999'};currentUser={...currentUser,username:'other-synthetic-account'};}else{await closeVehicle({discard:true});if(action!=='close')openVehicle(action==='other-car'?'encar-car-2':'encar-car-1');}},action);
   s.holds.splice(0).forEach(h=>h.release());await dialog(p).waitFor({state:'hidden'});await p.waitForTimeout(80);assert.equal((await snapshot(p)).writes.length,0);assert.equal(s.popups.length,0);assert.equal(s.prices.length,0);await clean(f);results.push({name:'stale discovery ignored',action,passed:true});
  }catch(error){await f.context.close().catch(()=>{});throw error;}
 }
 const f=await setup(),p=f.page,s=f.ads;try{
  s.priceReplies.push({body:{ok:true,id:ID,plate:PLATE,priceWon:13000000,checkedAt:new Date().toISOString(),source:'encar'},hold:true});await lookup(f);await assertFound(p);await awaitSaved(p);await until(p,()=>s.holds.some(h=>h.path==='/api/encar-ad-price'),'Price request must reach held response');await closeID(p);await reopen(p);s.holds.splice(0).forEach(h=>h.release());await p.waitForTimeout(100);
  const state=await snapshot(p);assert.equal(state.runtime[0].sell,12000000);assert.equal(state.wire[0].encarLinks.priceWon,null);assert.equal(f.dialogs.filter(d=>d.type==='confirm').length,0,'A price response from a previous opening cannot prompt or overwrite the reopened vehicle');await clean(f);results.push({name:'stale price cannot prompt/write after same-car reopen',passed:true});console.log('PASS late discovery and price responses ignore closed/reopened cars, other vehicles and switched accounts');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function invalidStored(){
 const f=await setup(),p=f.page;try{
  await lookup(f);await assertFound(p);await awaitPrice(p,12000000);await closeID(p);
  await p.evaluate(async()=>{await closeVehicle({discard:true});const S=__encarFixtureState;for(const data of [cars[0],__encarFixtureCars[0]])data.encarLinks.url='https://fem.encar.com.evil.example/cars/detail/43123456';localStorage.setItem(carsStoreKey(currentUser.username),JSON.stringify(__encarFixtureCars));S.queue.clear();openVehicle('encar-car-1');renderCars();});assert.equal(await saved(p),null);assert.equal(await icon(p).count(),0,'An untrusted stored URL cannot publish an Encar icon');
  f.ads.idReplies.push({body:{ok:false,status:'not_found',code:'NOT_FOUND'}});await p.locator('#vehicle-encar-check').click();await dialog(p).locator('[data-encar-id-loading]').waitFor({state:'hidden'});assert.equal(f.ads.popups.length,0);await closeID(p);
  await p.evaluate(async()=>{await closeVehicle({discard:true});cars[0].plate='34나5678';renderCars();openVehicle('encar-car-1');});assert.equal(await saved(p),null);assert.equal(await icon(p).count(),0,'A changed vehicle plate must invalidate a previously saved advertisement');await clean(f);results.push({name:'untrusted URL and changed plate reject saved navigation',passed:true});
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function permissions(){
 const f=await setup(),p=f.page;try{
  await lookup(f);await assertFound(p);await awaitPrice(p,12000000);await closeID(p);const before=await snapshot(p),requests=f.ads.prices.length;
  const denied=await p.evaluate(async()=>{
   currentUser={...currentUser,role:'accountant'};__encarFixtureState.members[0].role='accountant';
   const b=snoteEncarIdBridge,context=b.context('encar-car-1','detail'),record=b.saved(context),codes=[];
   if(!context||!record)throw Error('Synthetic accountant must retain readable saved advertisement');
   for(const run of [()=>b.saveLink(context,{id:record.id,plate:record.plate,provider:'gloar'}),()=>b.savePrice(context,{id:record.id,plate:record.plate,priceWon:13000000,checkedAt:new Date().toISOString(),source:'encar'}),()=>b.changePrice(context,12000000)])try{await run();codes.push('UNEXPECTED_WRITE');}catch(error){codes.push(error.code);}
   SnoteEncarId.sync();return codes;
  });
  assert.deepEqual(denied,['FORBIDDEN','FORBIDDEN','FORBIDDEN']);assert.equal(await p.locator('#snote-encar-price-change').isVisible(),false);assert.equal(await p.evaluate(()=>SnoteEncarId.refreshPrice()),false);assert.equal(f.ads.prices.length,requests);assert.deepEqual((await snapshot(p)).wire,before.wire);assert.equal((await snapshot(p)).writes.length,before.writes.length);await openSaved(f);
  await p.evaluate(()=>{cars[0].status='판매완료';renderCars();SnoteEncarId.sync();});assert.equal(await icon(p).count(),0,'Sold cars must not publish purchase-list Encar icons');assert.equal(await p.evaluate(()=>snoteEncarIdBridge.context('encar-car-1','detail')),null);assert.equal(await p.evaluate(()=>snote239EncarIcon(cars[0])), '');
  await clean(f);results.push({name:'accountant read-only enforcement and sold icon exclusion',passed:true});console.log('PASS actual accountant context can open a confirmed saved link but cannot discover/save price/sell; sold vehicles have no purchase-list advertisement icon');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function priceSaves(){
 for(const mode of ['fail','lost-response']){
  const f=await setup(),p=f.page;try{
   f.ads.priceWon=13000000;f.answerConfirm(false,/변경하시겠습니까/);await lookup(f);await assertFound(p);await awaitPrice(p,13000000);await closeID(p);await until(p,()=>f.dialogAnswers.length===0,'Initial comparison must be cancelled');const before=(await snapshot(p)).writes.length;
   await p.evaluate(mode=>__encarFixtureWriteMode=mode,mode);f.answerConfirm(true,/변경하시겠습니까/);await p.locator('#snote-encar-price-change').click();await p.waitForFunction(()=>!snoteVehicleSaveTask&&snoteVehicleUnconfirmedWrite?.kind==='encar-price');
   let state=await snapshot(p);assert.equal(state.runtime[0].sell,13000000);assert.equal(state.wire[0].sell,mode==='lost-response'?1300:1200);assert.match(await p.locator('#toast').textContent(),/저장하지 못했습니다/);assert.equal((await saved(p)).id,ID,'An uncertain price save must keep its confirmed advertisement link available');
   await p.evaluate(async()=>{__encarFixtureWriteMode='ok';const result=await zc86Cloud.flush();if(result?.ok!==true)throw Error('Synthetic price recovery failed');snoteVehicleAcknowledgePending(snoteVehicleContext());});await p.waitForFunction(()=>!snoteVehicleUnconfirmedWrite);
   state=await snapshot(p);assert.equal(state.runtime[0].sell,13000000);assert.equal(state.wire[0].sell,1300);assert.equal(state.writes.length,before+1,'A committed price must be reconciled without a duplicate sell write');await reopen(p);assert.equal(await p.locator('#detail-sell').inputValue(),'13,000,000');await clean(f);results.push({name:'sale-price failure/lost ACK recovery',mode,passed:true});
  }catch(error){await f.context.close().catch(()=>{});throw error;}
 }
 const f=await setup(),p=f.page;try{
  f.ads.priceReplies.push({body:{ok:true,id:ID,plate:PLATE,priceWon:13000000,checkedAt:new Date().toISOString(),source:'encar'},hold:true});await lookup(f);await assertFound(p);await until(p,()=>f.ads.holds.length===1,'Hold price before editing the planned amount');await closeID(p);await p.locator('#detail-sell').fill('12,500,000');await p.locator('#detail-sell').dispatchEvent('input');f.answerConfirm(true,/변경하시겠습니까/);f.ads.holds.splice(0).forEach(item=>item.release());await awaitPrice(p,13000000);await until(p,()=>f.dialogAnswers.length===0,'Current edited price must be compared');await p.waitForFunction(()=>!snoteVehicleSaveTask);await until(p,async()=>/변경되었습니다/.test(await p.locator('#toast').textContent()),'Dirty manual sale-price edit must be rejected by the actual bridge');
  const state=await snapshot(p);assert.equal(state.runtime[0].sell,12000000);assert.equal(state.wire[0].sell,1200);assert.equal(state.writes.length,2,'Only link and advertised-price metadata may be saved');assert.equal(await p.locator('#detail-sell').inputValue(),'12,500,000');await clean(f);results.push({name:'manual planned-price edit while advertising response pending is preserved',passed:true});console.log('PASS failed/lost sale-price ACKs recover without duplicate commits, and an in-flight ad lookup cannot overwrite a manually edited planned price');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  if(SCENARIO==='all'||SCENARIO==='links')for(const width of WIDTHS)await discovery(width);
  if(SCENARIO==='all'||SCENARIO==='price'){await comparison(1440);await comparison(390,{wireKRW:true});if(WIDTHS.includes(320))await comparison(320);}
  if(SCENARIO==='all'||SCENARIO==='failures')await failures();
  if(SCENARIO==='all'||SCENARIO==='diagnostics')await diagnostics();
  if(SCENARIO==='all'||SCENARIO==='stale')await stale();
  if(SCENARIO==='all'||SCENARIO==='invalid')await invalidStored();
  if(SCENARIO==='all'||SCENARIO==='permissions')await permissions();
  if(SCENARIO==='all'||SCENARIO==='price-saves')await priceSaves();
  fs.writeFileSync(path.join(OUT,'browser-results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,liveProviderVerified:false,passed:true,results},null,2)+'\n');
 }finally{await browser.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
