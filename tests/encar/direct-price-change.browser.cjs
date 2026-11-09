'use strict';
// Actual app, stored-price restoration and actual price-only CAS bridge. Auth,
// price acquisition and server data are synthetic; no external service is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_DIRECT_PRICE_ARTIFACT_DIR||'/tmp/snote-encar-direct-price';
const ID='43000001',PRICE=54900000,DIALOG='#snote-encar-price-confirm',BUTTON='.snote-encar-price-apply';
fs.mkdirSync(ART,{recursive:true});
function record(price=PRICE){const at=new Date().toISOString();return{version:1,plate:'12가3456',verifiedAt:at,listings:[{id:ID,model:'합성 직접 변경 차량',sellerUrl:'https://fem.encar.com/cars/detail/'+ID,trustedId:'43000002',trustedUrl:'https://fem.encar.com/cars/detail/43000002',priceWon:price,priceCheckedAt:at,priceSource:'encar.com-ocr',priceStatus:'review'}]};}
async function seed(f,price=PRICE){await f.page.evaluate(async value=>{const bridge=window.snoteEncarLinksBridge;await bridge.save(bridge.context('encar-car-1'),value);window.SnoteEncarLink.refresh();},record(price));await f.page.locator(BUTTON).waitFor({state:'visible'});await f.page.waitForFunction(()=>!document.querySelector('.snote-encar-price-apply').disabled);}
async function snap(p){return p.evaluate(()=>({cars:structuredClone(window.__encarFixtureCars),writes:window.__encarFixtureWrites.length,runtimePrice:cars[0].sell}));}
async function settled(p){await p.waitForFunction(()=>!window.__encarFixtureState.saving);}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of[1440,390,320]){
   const f=await fixture(width),p=f.page;
   try{
    await p.evaluate(()=>{if(navigate('buy')!==true)throw Error('The direct-price fixture must be on the actual purchase list');});await seed(f);const before=await snap(p),peer=await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]);
    const tablePrice=p.locator('#list-table tr.vehicle-clickable').filter({has:p.locator('.car-name',{hasText:'가상 검증 차량 1'})}).locator('td.price').last(),cardPrice=p.locator('#list-mobile .vehicle-card').filter({has:p.locator('.vehicle-title',{hasText:'가상 검증 차량 1'})}).locator('.vehicle-price');assert.equal(await tablePrice.textContent(),'12,000,000원');assert.equal(await cardPrice.textContent(),'판매예정가 12,000,000원');
    assert.equal(f.requests.length,0,'Restoring an already stored quote must not request another advertisement');assert.equal(await p.locator(DIALOG).isVisible(),false);
    assert.equal(await p.locator('.snote-encar-price-value').textContent(),'엔카 광고가 54,900,000원');assert.doesNotMatch(await p.locator('.snote-encar-results').textContent(),/OCR|화면에서 찾은/);
    const button=p.locator(BUTTON);assert.equal(await button.textContent(),'판매가 변경');assert.equal(await button.getAttribute('aria-label'),'판매가 변경');
    const order=await p.locator('.snote-encar-result').evaluate(row=>[...row.querySelectorAll('a,button')].map(el=>el.textContent));assert.deepEqual(order.slice(0,3),['판매자 광고','엔카 믿고','판매가 변경']);
    await p.screenshot({path:path.join(ART,'direct-price-layout-'+width+'.png')});
    const geometry=await button.evaluate(el=>{const b=el.getBoundingClientRect(),trusted=el.closest('.snote-encar-result').querySelector('a[href$="43000002"]').getBoundingClientRect(),price=el.closest('.snote-encar-price-info').querySelector('strong').getBoundingClientRect();return{width:b.width,height:b.height,withTrusted:Math.abs(b.y+b.height/2-trusted.y-trusted.height/2)<14,withPrice:Math.abs(b.y+b.height/2-price.y-price.height/2)<14,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===el,overflow:document.documentElement.scrollWidth>innerWidth};});assert(geometry.height>=28&&geometry.hit&&geometry.withPrice,JSON.stringify(geometry));if(width>=1000)assert.equal(geometry.withTrusted,true);assert.equal(geometry.overflow,false);
    await p.locator('#detail-memo').fill('판매가만 저장하고 남길 메모');await p.locator('#detail-extra').fill('저장하지 않을 기타 비고');
    await p.screenshot({path:path.join(ART,'direct-price-ready-'+width+'.png')});await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await button.click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
    assert.equal(await p.locator(DIALOG).isVisible(),false,'The explicit change button must not ask for a second confirmation');assert.equal(await button.isDisabled(),true);assert.equal((await snap(p)).writes,before.writes);
    await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(price=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===price,PRICE);await settled(p);
    assert.equal(await p.locator(DIALOG).isVisible(),false);assert.equal(await p.locator('#detail-sell').inputValue(),'54,900,000');assert.equal(await p.locator('#detail-memo').inputValue(),'판매가만 저장하고 남길 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'저장하지 않을 기타 비고');
    await p.locator('.snote-encar-price-feedback').getByText('판매가를 54,900,000원으로 저장했습니다.',{exact:true}).waitFor();const saved=await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]));assert.equal(saved.vehicleMemo,undefined);assert.equal(saved.extra,undefined);assert.equal((await snap(p)).writes,before.writes+1);assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),peer);assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),true);
    assert.equal(await tablePrice.textContent(),'54,900,000원','The acknowledged direct price must immediately repaint the underlying table');assert.equal(await cardPrice.textContent(),'판매예정가 54,900,000원','The acknowledged direct price must immediately repaint the underlying mobile/card list');
    await p.screenshot({path:path.join(ART,'direct-price-saved-'+width+'.png')});await finish(f);results.push({width,neutralLabel:true,inlineChangeButton:true,noSecondConfirmation:true,priceOnlyDatabaseSave:true,otherDraftsAndPeerPreserved:true,underlyingTableAndCardUpdated:true,geometry});console.log('PASS '+width+'px neutral price, inline change action, direct price-only commit, refreshed lists and preserved dirty drafts');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await seed(f);const before=await snap(p);await p.evaluate(()=>{window.__directExpectedPrices=[];window.__directOriginalBridge=window.snoteEncarLinksBridge;window.snoteEncarLinksBridge={...window.__directOriginalBridge,changePrice(...args){window.__directExpectedPrices.push(args[3].expectedSellWon);return window.__directOriginalBridge.changePrice(...args);}};window.__encarFixtureWriteMode='lost-response';});
    await p.locator(BUTTON).click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0);await settled(p);await p.waitForTimeout(350);
    assert.equal((await snap(p)).writes,before.writes+1,'A lost response fixture must have committed the requested value once');assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),PRICE);assert.equal(await p.locator(DIALOG).isVisible(),false);assert.doesNotMatch(await p.locator('.snote-encar-price-feedback').textContent(),/저장했습니다/);assert.equal(await p.locator(BUTTON).isEnabled(),true);
    await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator(BUTTON).click();await settled(p);await p.waitForTimeout(350);
    assert.deepEqual(await p.evaluate(()=>window.__directExpectedPrices),[12000000,12000000],'Retry must keep the original expected price even if the first response was lost after commit');assert.equal((await snap(p)).writes,before.writes+1,'Recovering a lost response must not duplicate the first committed mutation');assert.match(await p.locator('.snote-encar-price-feedback').textContent(),/저장했습니다/);assert.equal(await p.locator(DIALOG).isVisible(),false);
    const recovered=await p.evaluate(()=>({queued:window.__encarFixtureState.queue.size,conflict:!!window.__encarFixtureState.conflict,revision:[...window.__encarFixtureState.revisions.values()].includes(window.__encarFixtureRevision),dirty:snoteVehicleHasChanges(),price:SnoteMoney.car(window.__encarFixtureCars[0]).sell}));assert.deepEqual(recovered,{queued:0,conflict:false,revision:true,dirty:false,price:PRICE},'A success after lost response must reflect the actual acknowledged server revision and clean price baseline');
    await finish(f);results.push({width:390,lostResponsePreservesOriginalExpectedPrice:true,lostResponseRecoveredAfterServerRecheck:true,commitsOnceWithoutFalseSuccess:true});console.log('PASS a lost response preserves the original price CAS and recovers its server-verified commit exactly once');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await seed(f);const before=await snap(p);await p.evaluate(()=>window.__encarFixtureWriteMode='fail');await p.locator(BUTTON).click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0);await settled(p);await p.waitForTimeout(350);
    assert.equal(await p.locator(DIALOG).isVisible(),false);assert.equal((await snap(p)).writes,before.writes);assert.equal(await p.locator('#detail-sell').inputValue(),'54,900,000');assert.equal(await p.locator(BUTTON).isEnabled(),true,'The exact failed direct request must remain retryable with its original expected price');
    await p.locator('#detail-sell').fill('13,000,000');const pageCount=f.context.pages().length;await p.locator('#vehicle-encar-check').click();await p.locator(BUTTON).click();await p.waitForTimeout(350);assert.equal(f.requests.length,0,'An unconfirmed price save must block another lookup even when its staged input was edited');assert.equal(f.context.pages().length,pageCount);assert.equal((await snap(p)).writes,before.writes);assert.equal(await p.locator('#detail-sell').inputValue(),'13,000,000');await p.locator('#detail-sell').fill('54,900,000');
    await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator(BUTTON).click();await p.waitForFunction(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===54900000);await settled(p);assert.equal((await snap(p)).writes,before.writes+1);assert.equal(await p.locator(DIALOG).isVisible(),false);
    await finish(f);results.push({width:390,failedAckRetryKeepsOriginalExpectedPrice:true,retryCommitsOnce:true,pendingPriceBlocksLookupAndOtherInput:true});console.log('PASS a failed direct price ACK protects staged input, blocks other lookups and retries the original expected value exactly once');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await seed(f);const before=await snap(p);await p.locator('#detail-sell').fill('13,000,000');await p.locator(BUTTON).click();await p.waitForTimeout(350);
    assert.equal((await snap(p)).writes,before.writes);assert.equal(await p.locator('#detail-sell').inputValue(),'13,000,000');assert.equal(await p.locator(DIALOG).isVisible(),false);
    await p.evaluate(()=>{window.__directOriginalBridge=window.snoteEncarLinksBridge;window.snoteEncarLinksBridge={...window.__directOriginalBridge,context(id){const c=window.__directOriginalBridge.context(id);return c?{...c,canWrite:false}:null;}};window.SnoteEncarLink.refresh();});assert.equal(await p.locator(BUTTON).isVisible(),false);
    await p.evaluate(()=>{window.snoteEncarLinksBridge=window.__directOriginalBridge;cars[0].status='판매완료';window.SnoteEncarLink.refresh();});assert.equal(await p.locator(BUTTON).isVisible(),false);
    await finish(f);results.push({width:390,dirtySalePriceProtected:true,readOnlyAndSoldHidden:true});console.log('PASS the explicit button protects an existing price draft and remains absent for read-only/sold vehicles');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await seed(f);await p.evaluate(()=>{window.__directOriginalBridge=window.snoteEncarLinksBridge;window.snoteEncarLinksBridge={...window.__directOriginalBridge,async changePrice(...args){window.__directWaiting=true;await new Promise(resolve=>window.__directRelease=resolve);return window.__directOriginalBridge.changePrice(...args);}};});
    await p.locator(BUTTON).click();await p.waitForFunction(()=>window.__directWaiting);await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-2');window.__directOtherPrice=document.getElementById('detail-sell').value;window.__directRelease();});await p.waitForFunction(()=>document.getElementById('vehicle-title').textContent.includes('가상 검증 차량 2'));await p.waitForTimeout(350);
    assert.equal(await p.locator('#detail-sell').inputValue(),await p.evaluate(()=>window.__directOtherPrice));assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[1]).sell),17000000);assert.equal(await p.locator(DIALOG).isVisible(),false);
    await finish(f);results.push({width:390,lateDirectPriceCannotAffectNextVehicle:true});console.log('PASS a delayed explicit price change cannot affect the next vehicle');
   }catch(error){await f.context.close();throw error;}
  }
 }finally{await browser.close();}
 const files=['index.html','assets/snote-encar-link.js','tests/encar/browser-smoke.cjs','tests/encar/direct-price-change.browser.cjs'];fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')])),results,syntheticOnly:true},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
