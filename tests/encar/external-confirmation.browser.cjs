'use strict';
// The real application and persistence/CAS bridges run in Chromium. All lookup,
// advertisements, authentication and database responses are synthetic.
// Run: node tests/encar/external-confirmation.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_EXTERNAL_ARTIFACT_DIR||'/tmp/snote-encar-external-confirmation';
const ID='43000001',SELLER='https://fem.encar.com/cars/detail/'+ID;
const SOURCE='https://nnov.trust-encar.ru/auto/'+ID+'/';
const BADGE='.snote-encar-external-status',DIALOG='#snote-encar-price-confirm';
const layoutChecks=[];
fs.mkdirSync(ART,{recursive:true});

function external({forgedPrice=false}={}){
 const checkedAt=new Date().toISOString();
 const listing={id:ID,model:'합성 외부 확인 차량',sellerUrl:SELLER,trustedId:null,trustedUrl:null,
  externalVerification:{source:'trust-encar',sourceUrl:SOURCE,checkedAt,advertisedAt:'2026-10-21',modifiedAt:'2026-10-22'}};
 if(forgedPrice)Object.assign(listing,{priceWon:37770000,priceCheckedAt:checkedAt,priceSource:'encar.com',priceStatus:'verified'});
 return{status:'found',plate:'12가3456',verifiedAt:checkedAt,listings:[listing]};
}
function official(){
 const checkedAt=new Date().toISOString();
 return{status:'found',plate:'12가3456',verifiedAt:checkedAt,listings:[{id:ID,model:'합성 공식 확인 차량',sellerUrl:SELLER,trustedId:null,trustedUrl:null,
  priceWon:37770000,priceCheckedAt:checkedAt,priceSource:'encar.com',priceStatus:'verified'}]};
}
async function stored(page){await page.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();}
async function lookupExternal(f,data){
 f.reply(data);const opening=f.context.waitForEvent('page');await f.page.locator('#vehicle-encar-check').click();
 const popup=await opening;await popup.waitForURL(SELLER);await popup.close();await stored(f.page);
}
async function verifyExternal(f,expected){
 const p=f.page,badge=p.locator(BADGE);await badge.waitFor({state:'visible'});
 await p.locator('#vehicle-overlay .vehicle-detail-frame').evaluate(async element=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
 assert.equal(await badge.textContent(),'외부 광고 확인');
 const geometry=await p.evaluate(()=>Object.fromEntries(['.snote-encar-external-status','.snote-encar-results a','.snote-encar-result','.snote-encar-results','.vehicle-name-links','.vehicle-header','.vehicle-modal','.vehicle-detail-frame'].map(selector=>{const el=document.querySelector(selector),r=el?.getBoundingClientRect();return[selector,r?{left:r.left,right:r.right,width:r.width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}:null];})));
 for(const [selector,box] of Object.entries(geometry))if(box)assert(box.left>=-.5&&box.right<=p.viewportSize().width+.5,'External details must stay inside the viewport: '+selector+' '+JSON.stringify(box));
 assert(geometry['.vehicle-modal'].scrollWidth<=geometry['.vehicle-modal'].clientWidth,'External provenance must not widen the drawer contents');
 if(!layoutChecks.some(item=>item.width===p.viewportSize().width))layoutChecks.push({width:p.viewportSize().width,geometry});
 const tooltip=await badge.getAttribute('data-tooltip');
 assert.match(tooltip,/한국 엔카/);assert.match(tooltip,/확인하지 못/);assert.match(tooltip,/2026-10-21/);assert.match(tooltip,/2026-10-22/);assert(tooltip.includes(SOURCE));
 await p.mouse.move(0,0);await badge.hover();const bubble=p.locator('#snote-icon-tooltip');await bubble.waitFor({state:'visible'});
 assert.match(await bubble.textContent(),/한국 엔카/);assert((await bubble.textContent()).includes(SOURCE));
 const bounds=await bubble.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=p.viewportSize().width+.5,'The full provenance tooltip must fit inside the viewport');
 await p.mouse.move(0,0);await bubble.waitFor({state:'hidden'});await p.keyboard.press('Tab');await badge.focus();await bubble.waitFor({state:'visible'});
 assert((await bubble.textContent()).includes(SOURCE),'Keyboard focus must expose the same provenance tooltip');
 const links=await p.locator('.snote-encar-results a').evaluateAll(elements=>elements.map(el=>({href:el.href,target:el.target,rel:el.rel})));
 assert.deepEqual(links,[{href:SELLER,target:'_blank',rel:'noopener noreferrer'}]);
 assert.equal(await p.locator('.snote-encar-price-apply').count(),0,'External plate evidence cannot expose a price-change action');
 assert.equal(await p.locator('.snote-encar-price-value').count(),0,'An external quote cannot be presented as an official price');
 assert.equal(await p.locator(DIALOG).isVisible(),false,'External evidence cannot open an automatic price confirmation');
 assert.equal(f.autoPriceRequests.length,0,'External evidence cannot request automatic price capture');
 assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);
 const record=await p.evaluate(()=>structuredClone(window.__encarFixtureCars[0].encarLinks));
 assert.deepEqual(record.listings[0].externalVerification,expected.externalVerification,'The real scoped database bridge must retain external provenance');
 assert(!['verified','review'].includes(record.listings[0].priceStatus),'External evidence cannot preserve a forged verified price');
 assert.equal(record.listings[0].trustedId,null);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 return record;
}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of[1440,390,320]){
   const f=await fixture(width),p=f.page,data=external({forgedPrice:width===390});let savedCars;
   try{
    const peer=await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]);
    await p.locator('#detail-memo').fill('아직 저장하지 않은 메모');
    await lookupExternal(f,data);const record=await verifyExternal(f,data.listings[0]);
    assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
    assert.equal(await p.locator('#detail-memo').inputValue(),'아직 저장하지 않은 메모');
    assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].vehicleMemo),undefined,'Lookup must save only link metadata');
    assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),peer,'Another vehicle must stay unchanged');
    const guarded=await p.evaluate(async({record,id})=>{
     const context=window.snoteEncarLinksBridge.context('encar-car-1'),errors={};
     for(const kind of['autoPrice','applyPrice','changePrice'])try{
      if(kind==='autoPrice')await window.snoteEncarLinksBridge.autoPrice(context,record,{listingId:id});
      else if(kind==='changePrice')await window.snoteEncarLinksBridge.changePrice(context,record,id,{expectedSellWon:12000000});
      else await window.snoteEncarLinksBridge.applyPrice(context,record,id);
      errors[kind]=null;
     }catch(error){errors[kind]=error.code||error.message;}
     return errors;
    },{record,id:ID});
    assert(Object.values(guarded).every(Boolean),'The persistence bridge must reject all direct external-price entry points');
    assert.equal(f.autoPriceRequests.length,0);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
    await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-1');});
    await verifyExternal(f,data.listings[0]);assert.equal(f.requests.length,1,'Reopening a saved record must not rerun discovery');
    await p.screenshot({path:path.join(ART,'external-confirmed-'+width+'.png')});
    savedCars=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));
    await finish(f);
   }catch(error){await f.context.close();throw error;}
   const restored=await fixture(width,savedCars);
   try{
    await verifyExternal(restored,data.listings[0]);assert.equal(restored.requests.length,0,'A fresh workspace must restore persisted provenance without a lookup');
    assert.equal(await restored.page.evaluate(()=>window.__encarFixtureWrites.length),0);
    if(width===1440){
     await restored.page.evaluate(async()=>{await closeVehicle({discard:true,animate:false});navigate('buy');});
     const icon=restored.page.locator('.snote-list-encar[data-encar-car-id="encar-car-1"]').first();await icon.waitFor({state:'visible'});
     const opening=restored.context.waitForEvent('page');await icon.click();const popup=await opening;
     await popup.waitForURL(SELLER);await popup.close();await restored.page.locator(BADGE).waitFor({state:'visible'});
     assert.equal(restored.requests.length,0,'A saved external list entry opens its exact link without rediscovery');assert.equal(restored.autoPriceRequests.length,0);
     assert.equal(await restored.page.locator(DIALOG).isVisible(),false);
    }
    await finish(restored);
   }catch(error){await restored.context.close();throw error;}
   results.push({width,externalPlateLink:true,sourceAndDateTooltip:true,scopedPersistence:true,restoredWorkspace:true,
    noAutomaticCapture:true,noPriceMutation:true,directPriceBridgeDenied:true,peerAndDraftPreserved:true,
    forgedPriceDiscarded:width===390,realListEntry:width===1440});
   console.log('PASS '+width+'px external provenance, scoped save, restored workspace, no capture/price mutation and preserved drafts');
  }
  const f=await fixture(1440),p=f.page;
  try{
   f.reply(official());const opening=f.context.waitForEvent('page');await p.locator('#vehicle-encar-check').click();const popup=await opening;
   if(!popup.isClosed())await popup.waitForEvent('close');await stored(p);await p.locator(DIALOG).waitFor({state:'visible'});
   assert.match(await p.locator(DIALOG+' .snote-encar-price-confirm-amount').textContent(),/37,770,000원/);
   assert.equal(await p.locator(BADGE).count(),0,'Official evidence must not inherit an external badge');
   assert.equal(await p.locator('.snote-encar-price-apply').count(),1);
   await p.locator(DIALOG+' .snote-encar-price-confirm-cancel').click();await p.locator(DIALOG).waitFor({state:'hidden'});
   assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);
   assert.equal(f.autoPriceRequests.length,0,'An already verified official quote requires no automatic capture');
   await finish(f);results.push({officialVerifiedPriceOfferPreserved:true,cancelUnchanged:true});
   console.log('PASS an official verified quote retains the existing price confirmation path');
  }catch(error){await f.context.close();throw error;}
 }finally{await browser.close();}
 const files=['index.html','assets/snote-encar-link.js','tests/encar/browser-smoke.cjs','tests/encar/external-confirmation.browser.cjs'];
 fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),syntheticOnly:true,
  sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')])),layoutChecks,results},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
