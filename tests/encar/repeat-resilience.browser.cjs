'use strict';
// Real application/price bridge in Chromium; all HTTP, auth and storage are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_RESILIENCE_ARTIFACT_DIR||'/tmp/snote-encar-resilience';
const ID='43000001',PLATE='12가3456',PRICE=54900000,SELLER='https://fem.encar.com/cars/detail/'+ID;
const BUTTON='#vehicle-encar-check',DIALOG='#snote-encar-price-confirm',CANCEL=DIALOG+' .snote-encar-price-confirm-cancel';
const results=[];fs.mkdirSync(ART,{recursive:true});
function ad(){return{plate:PLATE,status:'found',verifiedAt:new Date().toISOString(),listings:[{id:ID,model:'합성 반복 조회 차량',sellerUrl:SELLER,trustedId:null,trustedUrl:null,priceWon:null,priceCheckedAt:null,priceSource:null,priceStatus:'unavailable'}]};}
function quote(){return{ok:true,plate:PLATE,verifiedAt:new Date().toISOString(),listing:{id:ID,priceWon:PRICE,priceCheckedAt:new Date().toISOString(),priceSource:'encar.com-ocr',priceStatus:'review'}};}
async function configure(f){
 const state={lookup:[],price:[],lookupCalls:[],priceCalls:[]};
 for(const [endpoint,queue,calls] of [['encar','lookup','lookupCalls'],['encar-auto-price','price','priceCalls']])await f.context.route('**/api/'+endpoint,async route=>{
  const request=route.request();state[calls].push(JSON.parse(request.postData()));
  const entry=state[queue].shift();assert(entry,'Every '+endpoint+' response must be explicit');
  if(entry.hold)await entry.hold;
  await route.fulfill({status:entry.status||200,contentType:entry.contentType||'application/json',headers:entry.headers||{},body:typeof entry.raw==='string'?entry.raw:JSON.stringify(entry.body)});
 });return state;
}
async function run(f,{offer=true}={}){
 const opening=f.context.waitForEvent('page');await f.page.locator(BUTTON).click();const popup=await opening;
 if(offer){await f.page.locator(DIALOG).waitFor({state:'visible'});if(!popup.isClosed())await popup.waitForEvent('close');}
 else {await popup.waitForURL(SELLER);await popup.close();await f.page.locator(BUTTON+':not([disabled])').waitFor();}
 return popup;
}
async function cancel(p){await p.locator(CANCEL).click();await p.locator(DIALOG).waitFor({state:'hidden'});await p.locator(BUTTON+':not([disabled])').waitFor();}
async function safePrice(f){assert.equal(await f.page.locator('#detail-sell').inputValue(),'12,000,000');assert.equal(await f.page.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);}
async function links(f){assert.equal(await f.page.locator('.snote-encar-results a').first().getAttribute('href'),SELLER);await f.page.waitForFunction(()=>window.__encarFixtureCars[0].encarLinks?.listings?.[0]?.id==='43000001');}
async function close(f,s){assert.equal(s.lookup.length,0);assert.equal(s.price.length,0);await finish(f);}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390]){
   const f=await fixture(width),s=await configure(f),p=f.page;
   try{
    for(let i=0;i<10;i++){
     if(i===2)s.lookup.push({status:503,contentType:'text/html',raw:'<title>Service unavailable</title><p>synthetic edge error</p>'});
     s.lookup.push({body:ad()});if(i===4)s.price.push({status:503,contentType:'text/html',raw:'<title>Service unavailable</title>'});s.price.push({body:quote()});
     await run(f);await safePrice(f);await links(f);await cancel(p);
    }
    assert.equal(s.lookupCalls.length,11,'One temporary lookup failure retries once');assert.equal(s.priceCalls.length,11,'One temporary price failure retries once');
    await p.screenshot({path:path.join(ART,'repeat-success-'+width+'.png')});
    let release;const hold=new Promise(resolve=>release=resolve);s.lookup.push({body:ad(),hold});s.price.push({body:quote()});
    const opening=f.context.waitForEvent('page');await p.locator(BUTTON).click();const popup=await opening;await p.waitForFunction(()=>document.querySelector('#vehicle-encar-check').disabled);
    const joined=await p.evaluate(()=>[1,2,3].map(()=>window.SnoteEncarLink.lookupCurrent('encar-car-1','43000001')));assert.deepEqual(joined,[true,true,true]);
    const before=s.lookupCalls.length;release();await p.locator(DIALOG).waitFor({state:'visible'});if(!popup.isClosed())await popup.waitForEvent('close');assert.equal(s.lookupCalls.length,before);await cancel(p);
    results.push({width,sequentialLookups:10,lookup503Recovered:true,autoPrice503Recovered:true,duplicateEntryPointsJoined:true,salePriceUnchangedWithoutConfirmation:true});await close(f,s);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),s=await configure(f),p=f.page;
   try{
    s.lookup.push({body:ad()});for(let i=0;i<2;i++)s.price.push({status:503,contentType:'text/html',headers:{'cf-ray':'1234567890abcdef-ICN'},raw:'<title>Service unavailable</title><p>PRIVATE_PROVIDER_BODY</p>'});
    await run(f,{offer:false});await links(f);await safePrice(f);assert.equal(s.priceCalls.length,2);assert.equal(await p.locator(DIALOG).isVisible(),false);
    const copied=await p.evaluate(async()=>{window.__resilienceCopied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.__resilienceCopied=value}});document.querySelector('.snote-encar-copy').click();await new Promise(resolve=>setTimeout(resolve,0));return window.__resilienceCopied;});
    const diagnostics=JSON.parse(copied);assert.equal(diagnostics.endpoint,'encar-auto-price');assert.equal(diagnostics.httpStatus,503);assert.equal(diagnostics.attempt,2);assert.equal(diagnostics.responseType,'html');assert.equal(diagnostics.rayId,'1234567890abcdef-icn');assert.doesNotMatch(copied,/PRIVATE_PROVIDER_BODY|Bearer|synthetic_private/);
    results.push({autoPriceFinal503PreservesVerifiedLink:true,oldPriceUnchanged:true,diagnosticsSeparatePriceEndpoint:true,htmlAndSecretsExcluded:true});await close(f,s);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),s=await configure(f),p=f.page;
   try{
    s.lookup.push({body:ad()});s.price.push({status:429,headers:{'Retry-After':'60'},body:{ok:false,code:'CAPTURE_RATE_LIMITED',retryAfterSeconds:60,diagnostics:{stage:'capture',upstreamStatus:429,retryAfterSeconds:60}}});
    await run(f,{offer:false});await links(f);await safePrice(f);assert.equal(s.priceCalls.length,1,'A 60 second provider wait is not retried early');
    s.lookup.push({body:ad()});await run(f,{offer:false});assert.equal(s.lookupCalls.length,2,'Each lookup still verifies the advertisement');assert.equal(s.priceCalls.length,1,'The price cooldown prevents another billed capture');await safePrice(f);
    await p.screenshot({path:path.join(ART,'price-cooldown-390.png')});results.push({capture60SecondWaitRespected:true,noSecondBilledCaptureDuringCooldown:true,freshAdvertisementLookupStillAvailable:true});await close(f,s);
   }catch(error){await f.context.close();throw error;}
  }
 }finally{await browser.close();}
 const files=['index.html','assets/snote-encar-link.js','tests/encar/repeat-resilience.browser.cjs'];fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),syntheticOnly:true,realApplicationAndAutoPriceBridge:true,productionRequests:0,sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')])),results},null,2)+'\n');console.log('PASS actual application repeat lookup, one retry, coalescing, safe price diagnostics and provider cooldown at desktop/mobile widths');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
