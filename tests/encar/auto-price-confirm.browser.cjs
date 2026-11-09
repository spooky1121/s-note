'use strict';
// Actual application, metadata/CAS bridges and confirmation UI. All auth,
// advertisements, capture results and database traffic are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_AUTO_CONFIRM_ARTIFACT_DIR||'/tmp/snote-encar-auto-confirm';
const ID='43000001',SELLER='https://fem.encar.com/cars/detail/'+ID,PRICE=37770000;
const DIALOG='#snote-encar-price-confirm',SAVE=DIALOG+' .snote-encar-price-confirm-save',CANCEL=DIALOG+' .snote-encar-price-confirm-cancel';
fs.mkdirSync(ART,{recursive:true});
function item(id=ID,price=PRICE){return{id,model:'합성 자동 가격 차량',sellerUrl:'https://fem.encar.com/cars/detail/'+id,trustedId:null,trustedUrl:null,priceWon:price,priceCheckedAt:new Date(Date.now()-1000).toISOString(),priceSource:'encar.com',priceStatus:'verified'};}
function quoted(listings=[item()]){return{status:listings.length===1?'found':'multiple',plate:'12가3456',verifiedAt:new Date().toISOString(),listings};}
function absent(){const data=quoted();Object.assign(data.listings[0],{priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'});return data;}
async function lookup(f,data,{offer=true}={}){f.reply(data);const opening=f.context.waitForEvent('page');await f.page.locator('#vehicle-encar-check').click();const popup=await opening;if(offer){if(!popup.isClosed())await popup.waitForEvent('close');}else{await popup.waitForURL(SELLER);await popup.close();}return popup;}
async function shown(p){await p.locator(DIALOG).waitFor({state:'visible'});await p.locator(DIALOG).evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));}
async function hidden(p){await p.locator(DIALOG).waitFor({state:'hidden'});}
async function stored(p){await p.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();}
async function snapshot(p){return p.evaluate(()=>({cars:structuredClone(window.__encarFixtureCars),writes:window.__encarFixtureWrites.length,sell:cars[0].sell}));}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of[1440,390,320]){
   const f=await fixture(width),p=f.page;
   try{
    assert.equal(await p.evaluate(()=>typeof window.snoteEncarLinksBridge.changePrice),'function','The current application must expose the real price-only bridge');
    const before=await snapshot(p),peer=await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]);
    await p.locator('#detail-memo').fill('아직 저장하지 않은 메모');await p.locator('#detail-extra').fill('아직 저장하지 않은 기타 비고');
    await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await lookup(f,quoted());await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
    assert.equal(await p.locator(DIALOG).isVisible(),false,'An unconfirmed metadata write must not open a price dialog');assert.equal((await snapshot(p)).writes,before.writes);
    await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await shown(p);
    assert.match(await p.locator(DIALOG+' .snote-encar-price-confirm-current').textContent(),/12,000,000원/);assert.match(await p.locator(DIALOG+' .snote-encar-price-confirm-amount').textContent(),/37,770,000원/);
    assert.equal(await p.locator(DIALOG).getByText('이 금액으로 변경하시겠습니까?',{exact:true}).isVisible(),true);assert.equal(await p.locator(SAVE).isEnabled(),true);
    const afterLookup=await snapshot(p);assert.equal(SnoteMoneyValue(afterLookup.cars[0].sell),before.sell);assert.equal(afterLookup.cars[0].vehicleMemo,undefined);assert.equal(afterLookup.cars[0].extra,undefined);
    const box=await p.locator(DIALOG).boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+.5);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.locator(DIALOG).evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await p.screenshot({path:path.join(ART,'auto-price-confirm-'+width+'.png')});await p.locator(CANCEL).click();await hidden(p);
    assert.equal((await snapshot(p)).writes,afterLookup.writes,'Cancel changes no stored price');assert.equal(await p.locator('#detail-sell').inputValue(),'12,000,000');
    await lookup(f,quoted());await shown(p);const writesBefore=(await snapshot(p)).writes;await p.locator(SAVE).click();await hidden(p);
    await p.waitForFunction(value=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===value,PRICE);
    const confirmed=await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]));assert.equal(confirmed.sell,PRICE);assert.equal(confirmed.vehicleMemo,undefined,'A price-only confirmation cannot save another draft');assert.equal(confirmed.extra,undefined);
    assert.equal((await snapshot(p)).writes,writesBefore+1);assert.equal(await p.locator('#detail-sell').inputValue(),'37,770,000');assert.equal(await p.locator('#detail-memo').inputValue(),'아직 저장하지 않은 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'아직 저장하지 않은 기타 비고');
    assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),peer);assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),true,'Only the pre-existing memo/extra drafts remain dirty');
    await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-1');});await p.locator('.snote-encar-price-value').waitFor();assert.equal(await p.locator('#detail-sell').inputValue(),'37,770,000');assert.equal(await p.locator(DIALOG).isVisible(),false,'Restoring a saved quote never opens an unsolicited confirmation');
    const requestCount=f.requests.length;await lookup(f,quoted([item(ID,PRICE)]),{offer:false});await stored(p);assert.equal(await p.locator(DIALOG).isVisible(),false,'A quote equal to the current sale price needs no change confirmation');assert.equal(f.requests.length,requestCount+1);
    await finish(f);results.push({width,metadataAckRequired:true,automaticConfirmation:true,cancelUnchanged:true,priceOnlyDatabaseSave:true,otherDraftsAndPeerPreserved:true,equalPriceNoPrompt:true,restoredQuoteNoPrompt:true,overflow:false});console.log('PASS '+width+'px automatic confirmation, cancel, exact price-only save, dirty drafts and peer preservation');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await lookup(f,quoted([item(ID,PRICE),item('43000003',39999000)]));await shown(p);
    const radios=p.locator(DIALOG+' input[type=radio]');assert.equal(await radios.count(),2);assert.equal(await p.locator(DIALOG+' input[type=radio]:checked').count(),0);assert.equal(await p.locator(SAVE).isDisabled(),true,'Conflicting advertisements require an explicit selection');
    assert.equal(await p.locator(DIALOG).evaluate(el=>el.scrollWidth>el.clientWidth),false);await p.screenshot({path:path.join(ART,'auto-price-multiple-390.png')});await radios.nth(1).check();await p.locator(SAVE).click();await hidden(p);await p.waitForFunction(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===39999000);
    await p.evaluate(()=>{window.__autoOriginalBridge=window.snoteEncarLinksBridge;window.__autoCaptureCalls=0;window.snoteEncarLinksBridge={...window.__autoOriginalBridge,async autoPrice(base,record){window.__autoCaptureCalls++;return{...record,verifiedAt:new Date().toISOString(),listings:record.listings.map(entry=>({...entry,priceWon:54900000,priceCheckedAt:new Date().toISOString(),priceSource:'encar.com-ocr',priceStatus:'review'}))};}};});
    await lookup(f,absent());await shown(p);assert.equal(await p.evaluate(()=>window.__autoCaptureCalls),1);assert.match(await p.locator(DIALOG+' .snote-encar-price-confirm-amount').textContent(),/화면에서 찾은 광고가 54,900,000원/);assert.equal(await p.locator('#snote-encar-price-ocr').isVisible(),false,'Automatic capture does not require the manual image upload dialog');
    await p.locator(SAVE).click();await hidden(p);await p.waitForFunction(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===54900000);assert.equal(await p.locator('#detail-sell').inputValue(),'54,900,000');
    await finish(f);results.push({width:390,multipleAdsRequireSelection:true,automaticCaptureMockNoUpload:true,reviewPriceExplicitConfirmation:true});console.log('PASS conflicting advertisements need selection and automatic capture result uses the same explicit confirmation');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await p.evaluate(()=>{window.__autoOriginalBridge=window.snoteEncarLinksBridge;window.snoteEncarLinksBridge={...window.__autoOriginalBridge,autoPrice:undefined};});
    await lookup(f,absent(),{offer:false});await stored(p);assert.equal(await p.locator(DIALOG).isVisible(),false);assert.equal(await p.locator('.snote-encar-price-value').textContent(),'광고 가격 확인 불가');
    await p.locator('#detail-sell').fill('13,000,000');await lookup(f,quoted(),{offer:false});await stored(p);assert.equal(await p.locator(DIALOG).isVisible(),false,'An existing price draft is never replaced by an automatic prompt');assert.equal(await p.locator('#detail-sell').inputValue(),'13,000,000');
    await p.locator('#detail-sell').fill('12,000,000');await p.evaluate(()=>{window.snoteEncarLinksBridge={...window.__autoOriginalBridge,context(id){const c=window.__autoOriginalBridge.context(id);return c?{...c,canWrite:false}:null;}};});
    await lookup(f,quoted(),{offer:false});assert.equal(await p.locator(DIALOG).isVisible(),false,'Read-only UI contexts cannot offer a stored-price change');
    await finish(f);results.push({width:390,unavailableNoPrompt:true,dirtyPriceNoPrompt:true,readOnlyNoPrompt:true});console.log('PASS unavailable prices, a dirty sale-price draft and read-only scopes never show an automatic change prompt');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await lookup(f,quoted());await shown(p);const before=await snapshot(p);await p.evaluate(()=>window.__encarFixtureWriteMode='fail');await p.locator(SAVE).click();
    await p.locator(DIALOG+' .snote-encar-price-confirm-status').getByText('변경을 확인하지 못했습니다. 현재 가격과 저장 상태를 확인한 뒤 다시 시도해 주세요.',{exact:true}).waitFor();
    await p.waitForTimeout(350);assert.equal(await p.locator(DIALOG).isVisible(),true,'A failed ACK keeps this exact staged-price retry available');assert.equal(await p.locator(SAVE).isEnabled(),true);
    assert.equal((await snapshot(p)).writes,before.writes);assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);assert.equal(await p.locator('#detail-sell').inputValue(),'37,770,000');
    await p.screenshot({path:path.join(ART,'auto-price-retry-390.png')});await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator(SAVE).click();await hidden(p);
    await p.waitForFunction(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===37770000);assert.equal((await snapshot(p)).writes,before.writes+1);assert.equal(await p.evaluate(()=>window.__encarFixtureWriteFailures),1);
    await finish(f);results.push({width:390,failedAckKeepsExactStagedRetry:true,retryCommitsExactlyOnce:true});console.log('PASS failed price ACK keeps the exact staged offer and one successful retry confirms its price-only write');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await lookup(f,quoted());await shown(p);const before=await snapshot(p);await p.locator('#detail-sell').evaluate(el=>{el.value='13,000,000';el.dispatchEvent(new Event('input',{bubbles:true}));});await hidden(p);assert.equal((await snapshot(p)).writes,before.writes);assert.equal(await p.locator('#detail-sell').inputValue(),'13,000,000');
    await p.locator('#detail-sell').fill('12,000,000');await lookup(f,quoted());await shown(p);await p.evaluate(()=>{window.__encarFixtureWriteMode='hold';});await p.locator(SAVE).click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
    await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-2');window.__autoOtherDraft=document.getElementById('detail-sell').value;window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await hidden(p);
    await p.waitForFunction(()=>document.getElementById('vehicle-title').textContent.includes('가상 검증 차량 2'));assert.equal(await p.locator('#detail-sell').inputValue(),await p.evaluate(()=>window.__autoOtherDraft));assert.equal(await p.locator('.snote-encar-price-confirm-status').textContent(),'');
    assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[1]).sell),17000000);await finish(f);results.push({width:390,changedPriceClosesPrompt:true,lateSaveCannotAffectNextVehicle:true});console.log('PASS an edited price dismisses an old offer and a pending old-vehicle confirmation cannot affect the next vehicle');
   }catch(error){await f.context.close();throw error;}
  }
 }finally{await browser.close();}
 const files=['index.html','assets/snote-encar-link.js','tests/encar/auto-price-confirm.browser.cjs'];fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')])),results,syntheticOnly:true,automaticCaptureResponseMocked:true},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

// The fixture keeps legacy monetary fields on the wire.
function SnoteMoneyValue(value){return Math.round(Number(value)*10000);}
