'use strict';
// Current index, real metadata bridge and real price-only/save flow. HTTP, auth,
// vehicles, prices and database responses are synthetic; no external calls run.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_PRICE_ARTIFACT_DIR||'/tmp/snote-encar-price';
const ID='43000001',SELLER='https://fem.encar.com/cars/detail/'+ID,TRUSTED='https://fem.encar.com/cars/detail/43000002';
const PRICE=37770000,fields=['priceWon','priceCheckedAt','priceSource','priceStatus'];
const quoted=(price=PRICE)=>{const at=new Date(Date.now()-30000).toISOString();return{status:'found',plate:'12가3456',verifiedAt:new Date().toISOString(),listings:[{id:ID,model:'합성 가격 검증 차량',sellerUrl:SELLER,trustedId:'43000002',trustedUrl:TRUSTED,priceWon:price,priceCheckedAt:at,priceSource:'encar-api.com',priceStatus:'verified'}]};};
const unavailable=()=>{const value=quoted();Object.assign(value.listings[0],{priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'});return value;};
fs.mkdirSync(ART,{recursive:true});
async function lookup(f,body){f.reply(body);const opening=f.context.waitForEvent('page');await f.page.locator('#vehicle-encar-check').click();const popup=await opening;if(body.listings.some(item=>['verified','review'].includes(item.priceStatus))){if(!popup.isClosed())await popup.waitForEvent('close');}else{await popup.waitForURL(SELLER);await popup.close();}}
async function stored(f){await f.page.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();}
async function cancelAutomaticOffer(f){const dialog=f.page.locator('#snote-encar-price-confirm');await dialog.waitFor({state:'visible'});await dialog.locator('.snote-encar-price-confirm-cancel').click();await dialog.waitFor({state:'hidden'});}
async function refreshPrice(f,mutate){await f.page.evaluate(mutate);await f.page.evaluate(()=>window.SnoteEncarLink.refresh());}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{for(const width of[1440,390,320]){
  const f=await fixture(width),p=f.page;
  try{
   const before=await p.evaluate(()=>({sell:cars[0].sell,peer:normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0],writes:window.__encarFixtureWrites.length}));
   await p.locator('#detail-memo').fill('기존 입력 중인 차량 메모');await p.locator('#detail-extra').fill('저장 전 기타 비고');
   await p.evaluate(()=>window.__encarFixtureWriteMode='hold');const response=quoted();await lookup(f,response);
   await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
   const apply=p.locator('.snote-encar-price-apply'),price=p.locator('.snote-encar-price-value'),checked=p.locator('.snote-encar-price-checked');
   assert.equal(await price.textContent(),'엔카 광고가 37,770,000원');assert.equal(await checked.getAttribute('datetime'),response.listings[0].priceCheckedAt);
   const expectedTime=await p.evaluate(at=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at))+' 확인',response.listings[0].priceCheckedAt);
   assert.equal(await checked.textContent(),expectedTime);assert.equal(await apply.isDisabled(),true,'A metadata write awaiting its server ACK cannot authorize price application');
   assert.equal(await p.evaluate(()=>cars[0].sell),before.sell,'Looking up an ad must never change the original sale price');
   await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await stored(f);await cancelAutomaticOffer(f);await apply.waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('.snote-encar-price-apply').disabled);
   const data=await p.evaluate(()=>window.__encarFixtureCars[0].encarLinks.listings[0]);for(const field of fields)assert.equal(data[field],response.listings[0][field]);
   assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),before.writes+1);assert.equal(await p.locator('#detail-memo').inputValue(),'기존 입력 중인 차량 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'저장 전 기타 비고');
   const geometry=await apply.evaluate(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el,overflow:document.documentElement.scrollWidth>innerWidth};});assert(geometry.width>=32&&geometry.height>=28&&geometry.hit);assert.equal(geometry.overflow,false);
   await p.screenshot({path:path.join(ART,'price-ready-'+width+'.png')});
   await apply.click();await p.locator('.snote-encar-price-feedback').getByText('판매가를 37,770,000원으로 저장했습니다.',{exact:true}).waitFor();
   assert.equal(await p.locator('#detail-sell').inputValue(),'37,770,000');assert.equal(await p.locator('#detail-memo').inputValue(),'기존 입력 중인 차량 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'저장 전 기타 비고');
   assert.equal(await p.evaluate(()=>cars[0].sell),PRICE);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),before.writes+2,'The explicit button saves only the selected price immediately');
   const priceOnlyCar=await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]));assert.equal(priceOnlyCar.sell,PRICE);assert.equal(priceOnlyCar.vehicleMemo,undefined);assert.equal(priceOnlyCar.extra,undefined);assert.equal(await p.locator('#snote-encar-price-confirm').isVisible(),false,'An explicit change action cannot ask for another confirmation');
   await p.locator('#vehicle-header-save').click();await p.waitForFunction(price=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===price,PRICE);
   const savedCar=await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]));assert.equal(savedCar.sell,PRICE);assert.equal(savedCar.vehicleMemo,'기존 입력 중인 차량 메모');assert.equal(savedCar.extra,'저장 전 기타 비고');
   assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),before.peer,'A price application cannot alter another vehicle');
   await p.waitForFunction(()=>document.getElementById('vehicle-overlay').getAttribute('aria-hidden')==='true');await p.evaluate(()=>openVehicle('encar-car-1'));await price.waitFor();assert.equal(await price.textContent(),'엔카 광고가 37,770,000원');assert.equal(f.requests.length,1,'Reopening restored price metadata must not request the provider again');
   await refreshPrice(f,()=>{const entry=cars[0].encarLinks.listings[0];entry.priceWon=39999000;entry.priceCheckedAt=new Date(Date.now()-10000).toISOString();});
   await p.waitForFunction(()=>document.querySelector('.snote-encar-price-value')?.textContent==='엔카 광고가 39,999,000원');assert.equal(await p.locator('.snote-encar-price-apply').count(),1,'Same URL price updates reuse one application control');
   await refreshPrice(f,()=>{cars[0].status='판매완료';});assert.equal(await p.locator('#vehicle-encar-check').isVisible(),false);assert.equal(await apply.isVisible(),false,'Sold vehicles cannot apply an advertised price');assert.equal(await p.locator('.snote-encar-results a').count(),2);
   await refreshPrice(f,()=>{cars[0].status='판매중';cars[0].encarLinks.listings[0].priceWon=-1;});assert.equal(await apply.count(),0);assert.equal(await price.textContent(),'광고 가격 확인 불가');assert.equal(await p.locator('.snote-encar-results a').count(),2,'Invalid price metadata must not destroy valid saved links');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(ART,'price-invalid-preserved-links-'+width+'.png')});
   results.push({width,sourcePriceStored:true,ackRequired:true,wonAndKoreaTime:true,immediatePriceOnlySave:true,otherDraftsPreserved:true,normalVehicleSave:true,peerUnchanged:true,reopenWithoutProvider:true,sameUrlRefresh:true,soldDenied:true,invalidPriceLinksPreserved:true,geometry});
   await finish(f);console.log('PASS '+width+'px price metadata, server ACK gate, KRW/Korean time, price-only change, subsequent normal save, reload and price/status guards');
  }catch(error){await f.context.close();throw error;}
 }
 // Exercise server save failure/retry and unavailable-price replacement with the
 // real metadata bridge, then hold an apply callback across a vehicle switch.
 {
  const f=await fixture(390),p=f.page;
  try{
   await p.evaluate(()=>window.__encarFixtureWriteMode='fail');await lookup(f,quoted());await p.locator('.snote-encar-save-retry').waitFor({state:'visible'});
   assert.equal(await p.locator('.snote-encar-price-apply').isDisabled(),true);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);assert.equal(await p.locator('.snote-encar-results a').count(),2);
   await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator('.snote-encar-save-retry').click();await stored(f);await cancelAutomaticOffer(f);assert.equal(f.requests.length,1);await p.waitForFunction(()=>!document.querySelector('.snote-encar-price-apply').disabled);
   await p.evaluate(()=>{window.__priceOriginalBridge=window.snoteEncarLinksBridge;window.snoteEncarLinksBridge={...window.__priceOriginalBridge,async changePrice(...args){window.__priceApplyWaiting=true;await new Promise(resolve=>window.__priceReleaseApply=resolve);return window.__priceOriginalBridge.changePrice(...args);}};});
   await p.locator('.snote-encar-price-apply').click();await p.waitForFunction(()=>window.__priceApplyWaiting);
   await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-2');window.__priceOtherSell=document.getElementById('detail-sell').value;window.__priceReleaseApply();});
   await p.waitForFunction(()=>document.getElementById('vehicle-title').textContent.includes('가상 검증 차량 2'));assert.equal(await p.locator('#detail-sell').inputValue(),await p.evaluate(()=>window.__priceOtherSell));assert.equal(await p.locator('.snote-encar-price-feedback').count(),0,'A prior vehicle apply callback must not annotate another vehicle');
   await p.evaluate(async()=>{window.snoteEncarLinksBridge={...window.__priceOriginalBridge,autoPrice:undefined};await closeVehicle({discard:true,animate:false});openVehicle('encar-car-1');});
   await lookup(f,unavailable());await stored(f);assert.equal(await p.locator('.snote-encar-price-value').textContent(),'광고 가격 확인 불가');assert.equal(await p.locator('.snote-encar-price-apply').count(),0);
   const absent=await p.evaluate(()=>window.__encarFixtureCars[0].encarLinks.listings[0]);assert.equal(absent.priceStatus,'unavailable');assert.equal(absent.priceWon,null);assert.equal(absent.priceCheckedAt,null);assert.equal(absent.priceSource,null);
   await p.screenshot({path:path.join(ART,'price-unavailable-390.png')});await finish(f);results.push({width:390,failedSaveCannotApply:true,saveRetryWithoutProvider:true,vehicleSwitchLateApplyDenied:true,unavailableDoesNotMasqueradeAsCurrentPrice:true});console.log('PASS price save failure/retry, vehicle-scope late apply and unavailable price replace');
  }catch(error){await f.context.close();throw error;}
 }
 }finally{await browser.close();}
 const files=['index.html','assets/snote-encar-link.js','tests/encar/browser-smoke.cjs','tests/encar/price-action.browser.cjs'];fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')])),results,syntheticOnly:true},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
