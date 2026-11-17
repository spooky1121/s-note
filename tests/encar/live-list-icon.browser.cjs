'use strict';
// Actual index, list/card rendering and scoped CAS bridge run in Chromium.
// Lookup, popup, authentication and database responses are synthetic only.
// Run: node tests/encar/live-list-icon.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_LIVE_LIST_ARTIFACT_DIR||'/tmp/snote-encar-live-list-icon';
const FILES=['index.html','assets/snote-encar-link.js','assets/vehicle-list-view.js','assets/list-pagination.js','tests/encar/browser-smoke.cjs','tests/encar/live-list-icon.browser.cjs'];
const hashes=()=>Object.fromEntries(FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const ACTOR='11111111-1111-4111-8111-111111111111',ALIAS='cld_'+ACTOR.replaceAll('-','').slice(0,18);
const CAR='encar-car-1',PEER='encar-car-2',PLATE='12가3456',ID='43000001',SELLER='https://fem.encar.com/cars/detail/'+ID;
const ICON='.snote-list-encar[data-encar-car-id="'+CAR+'"]',OTHER_ICON='.snote-list-encar:not([data-encar-car-id="'+CAR+'"])';
const DRAFT='광고 링크만 저장하고 유지할 미저장 메모',EXTRA='아직 저장하지 않은 차량 비고';
function response(external=false){
 const at=new Date().toISOString(),listing={id:ID,model:'합성 광고 확인 차량',sellerUrl:SELLER,trustedId:null,trustedUrl:null};
 if(external)listing.externalVerification={source:'trust-encar',sourceUrl:'https://nnov.trust-encar.ru/auto/'+ID+'/',checkedAt:at,advertisedAt:null,modifiedAt:null};
 else Object.assign(listing,{priceWon:12000000,priceCheckedAt:at,priceSource:'encar.com',priceStatus:'verified'});
 return{status:'found',plate:PLATE,verifiedAt:at,listings:[listing]};
}
function vehicles(){return Array.from({length:22},(_,index)=>({
 id:index===0?CAR:index===1?PEER:'synthetic-live-car-'+index,ownerId:ALIAS,model:'가상 검증 차량 '+(index+1),
 plate:index===0?PLATE:index===1?'34나5678':'56다'+String(1000+index),year:2026,km:'10,000',buy:1000,sell:1200,status:'판매중',
 purchaseAt:index===0?'2026-01-01':'2026-10-'+String(index).padStart(2,'0')
}));}
async function listState(page){return page.evaluate(()=>({
 route,query:document.getElementById('list-query').value,filter:document.getElementById('list-filter').value,
 mode:document.getElementById('list-screen').dataset.vehicleView,storedMode:localStorage.getItem('snote:vehicle-list-view:v1'),
 pagination:document.querySelector('#list-pagination .snote-page-count')?.textContent||'',
 page:document.querySelector('#list-pagination [aria-current="page"]')?.textContent||'',
 tableIds:[...document.querySelectorAll('#list-table [data-registration-car-id]')].map(element=>element.dataset.registrationCarId),
 cardIds:[...document.querySelectorAll('#list-mobile [data-registration-car-id]')].map(element=>element.dataset.registrationCarId)
}));}
async function setup(f,mode,{paged=true}={}){
 const p=f.page;
 await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});if(navigate('buy')!==true)throw Error('Actual purchase route is required');});
 await p.locator('#list-query').fill('검증');
 if(await p.locator('#list-screen').getAttribute('data-vehicle-view')!==mode)await p.locator('#snote-vehicle-view-switch').click();
 if(paged)await p.locator('#list-pagination button[aria-label="2페이지"]').click();
 const before=await listState(p);
 assert.equal(before.query,'검증');assert.equal(before.mode,mode);if(paged){assert.equal(before.page,'2');assert.match(before.pagination,/22대.*2 \/ 2페이지/);}
 assert(before.tableIds.includes(CAR)&&before.tableIds.includes(PEER));assert.deepEqual(before.tableIds,before.cardIds);
 assert.equal(await p.locator(ICON).count(),0,'No advertisement icon exists before opening or looking up this vehicle');
 assert.equal(await p.locator(OTHER_ICON).count(),0);
 const host=f.page.viewportSize().width>760&&mode==='list'?'#list-table':'#list-mobile';
 await p.locator(host+' [data-registration-car-id="'+CAR+'"]').click();await p.locator('#vehicle-encar-check:not([disabled])').waitFor();
 await p.locator('#detail-memo').fill(DRAFT);await p.locator('#detail-extra').fill(EXTRA);
 await p.evaluate(()=>{
  window.__liveOriginalRender=window.renderCars;window.__liveRenderCount=0;
  window.renderCars=function(...args){++window.__liveRenderCount;return window.__liveOriginalRender.apply(this,args);};
  window.__liveOriginalBridge=window.snoteEncarLinksBridge;window.__liveRefreshCount=0;
  window.snoteEncarLinksBridge={...window.__liveOriginalBridge,refreshList(...args){++window.__liveRefreshCount;return window.__liveOriginalBridge.refreshList(...args);}};
 });
 return before;
}
async function lookup(f,{external=false}={}){
 f.reply(response(external));const opening=f.context.waitForEvent('page');await f.page.locator('#vehicle-encar-check').click();
 const popup=await opening;await popup.waitForURL(SELLER);await popup.close();
}
async function held(page){await page.waitForFunction(()=>window.__encarFixtureWriteWaiting);}
async function noIconBeforeAck(f,before){
 const p=f.page;
 assert.equal(await p.locator(ICON).count(),0,'Finding an ad does not announce a persisted list icon before server acknowledgement');
 assert.equal(await p.locator(OTHER_ICON).count(),0);assert.equal(await p.evaluate(()=>window.__liveRenderCount),0);assert.equal(await p.evaluate(()=>window.__liveRefreshCount),0);
 assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].encarLinks),undefined);
 assert.equal(await p.evaluate(()=>activeCarId),CAR);assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');
 assert.deepEqual(await listState(p),before);
}
async function acknowledged(f,before){
 const p=f.page;
 await p.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();
 // These assertions deliberately precede closeVehicle/navigate/renderCars or
 // screenshots: closing a detail would otherwise hide the original stale-list bug.
 await p.waitForFunction(id=>['list-table','list-mobile'].every(host=>document.querySelectorAll('#'+host+' .snote-list-encar[data-encar-car-id="'+id+'"]').length===1),CAR);
 assert.equal(await p.locator(ICON).count(),2);assert.equal(await p.locator(OTHER_ICON).count(),0);
 for(const host of['#list-table','#list-mobile'])assert.equal(await p.locator(host+' '+ICON).getAttribute('href'),SELLER);
 assert.equal(await p.evaluate(()=>window.__liveRefreshCount),1,'Exactly the acknowledged link save requests one scoped list refresh');
 assert.equal(await p.evaluate(()=>window.__liveRenderCount),1,'The real list render runs once, without a test-driven repaint');
 assert.equal(await p.evaluate(()=>activeCarId),CAR);assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');
 assert.deepEqual(await listState(p),before,'Lookup must retain search, page, displayed records and list/card mode');
 assert.equal(await p.locator('#detail-memo').inputValue(),DRAFT);assert.equal(await p.locator('#detail-extra').inputValue(),EXTRA);
 assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),true);
 assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].vehicleMemo),undefined);assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),undefined);
 assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);
 assert.equal(f.requests.length,1);assert.equal(f.autoPriceRequests.length,0);
}
async function release(page){await page.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});}

(async()=>{
 fs.mkdirSync(ART,{recursive:true});const testedHashes=hashes(),results=[];
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390,320])for(const mode of['list','cards']){
   const f=await fixture(width,vehicles()),p=f.page;
   try{
    const before=await setup(f,mode),peers=await p.evaluate(()=>normalizedCars(window.__encarFixtureCars.slice(1),currentUser.username));
    await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await lookup(f,{external:mode==='cards'});await held(p);await noIconBeforeAck(f,before);
    await release(p);await acknowledged(f,before);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
    assert.deepEqual(await p.evaluate(()=>normalizedCars(window.__encarFixtureCars.slice(1),currentUser.username)),peers,'Other vehicles are not changed or given icons');
    // Capture the now-visible list only after proving the underlying DOM was
    // already updated while the original detail remained open.
    await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});});
    await p.locator((width>760&&mode==='list'?'#list-table':'#list-mobile')+' '+ICON).waitFor({state:'visible'});
    await p.screenshot({path:path.join(ART,'live-list-'+mode+'-'+width+'.png')});await finish(f);
    results.push({width,mode,source:mode==='cards'?'external-exact-plate':'official',noIconBeforeAck:true,underlyingDomUpdatedWhileDetailOpen:true,
     searchPageModeAndDraftPreserved:true,otherVehiclesUnchanged:true});
    console.log('PASS '+width+'px '+mode+': icon appears in the underlying table and cards only after the exact server ACK, with page/search/drafts retained');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390,vehicles()),p=f.page;
   try{
    const before=await setup(f,'cards');await p.evaluate(()=>window.__encarFixtureWriteMode='fail');await lookup(f,{external:true});
    await p.locator('.snote-encar-save-retry').waitFor({state:'visible'});await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0&&!window.__encarFixtureState.saving);
    await noIconBeforeAck(f,before);assert.equal(await p.locator('.snote-encar-save-status').textContent(),'광고는 확인했지만 서버 저장을 확인하지 못했습니다.');
    await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator('.snote-encar-save-retry').click();await held(p);await noIconBeforeAck(f,before);
    await release(p);await acknowledged(f,before);assert((await p.evaluate(()=>window.__encarFixtureWrites.length))>=1);
    assert.equal(await p.evaluate(()=>window.__encarFixtureState.queue.size),0);assert.equal(f.requests.length,1,'Retrying persistence must not rediscover the advertisement');
    await finish(f);results.push({failedAckNoIcon:true,retryAckShowsIcon:true,retryDoesNotLookupAgain:true});console.log('PASS failed save and held retry retain no list icon; only the successful retry ACK publishes it');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await setup(f,'list',{paged:false});await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await lookup(f,{external:true});await held(p);
    assert.equal(await p.locator(ICON).count(),0);
    await p.evaluate(()=>{openVehicle('encar-car-2');document.getElementById('detail-memo').value='다른 차량에서 작성 중인 메모';window.__liveRenderCount=0;window.__liveRefreshCount=0;});
    const afterSwitch=await listState(p);await release(p);await p.waitForFunction(()=>window.__encarFixtureWrites.length===1&&!window.__encarFixtureState.saving);await p.waitForTimeout(250);
    assert.equal(await p.evaluate(()=>activeCarId),PEER);assert.equal(await p.locator('#detail-memo').inputValue(),'다른 차량에서 작성 중인 메모');
    assert.equal(await p.evaluate(()=>window.__liveRefreshCount),0);assert.equal(await p.evaluate(()=>window.__liveRenderCount),0,'A stale link ACK cannot repaint the next vehicle context');
    assert.equal(await p.locator(OTHER_ICON).count(),0);assert.deepEqual(await listState(p),afterSwitch);assert.equal(f.requests.length,1);await finish(f);
    results.push({lateAckCannotRefreshOtherVehicle:true,otherVehicleDraftPreserved:true});console.log('PASS a delayed ACK for the previous detail cannot refresh or alter the next vehicle');
   }catch(error){await f.context.close();throw error;}
  }
 }finally{await browser.close();}
 assert.deepEqual(hashes(),testedHashes,'The integration test must run against one unchanged source snapshot');
 fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),syntheticOnly:true,actualIndexAndCasBridge:true,
  sourceHashes:testedHashes,results},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
