'use strict';
// Native saved-ad links with actual index/CAS/Chromium. All data and responses are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.ENCAR_LIST_ARTIFACT_DIR||'/workspace/work/ui-v2162/encar-list';fs.mkdirSync(OUT,{recursive:true});
const WIDTHS=(process.env.ENCAR_LIST_WIDTHS||'1440,390,320').split(',').map(Number),CAR='encar-car-1',ID='43123456',AD_URL='https://fem.encar.com/cars/detail/'+ID+'?listAdvType=share&adnm=mo_detail_url',results=[];
const originalRead=fs.readFileSync;
if(process.env.ENCAR_LIST_SOURCE)fs.readFileSync=function(file,...args){return originalRead.call(this,path.resolve(String(file))===path.join(ROOT,'index.html')?process.env.ENCAR_LIST_SOURCE:file,...args);};
let realBrowser,bundleMode='present';
function nativeFixtureBrowser(){return{async newContext(options){const context=await realBrowser.newContext(options),original=context.route.bind(context);context.route=async(pattern,handler,...rest)=>original(pattern,pattern==='**/*'?async route=>{if(bundleMode==='missing'&&new URL(route.request().url()).pathname==='/assets/encar-id.js')return route.fulfill({contentType:'application/javascript',body:'/* Synthetic unavailable optional discovery/price bundle. */'});return handler(route);}:handler,...rest);return context;}};}
function icon(p){return p.locator('#list-screen .snote-list-encar[data-encar-id-car="'+CAR+'"]').filter({visible:true}).first();}
async function setup(width,{missing=false}={}){
 bundleMode=missing?'missing':'present';const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;f.adRequests=[];f.popups=[];
 await f.context.route('https://fem.encar.com/**',route=>{assert.equal(route.request().url(),AD_URL);return route.fulfill({contentType:'text/html',body:'<!doctype html><title>합성 광고</title>'});});
 await p.route('**/api/encar*',route=>{f.adRequests.push(new URL(route.request().url()).pathname);return route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"code":"SYNTHETIC_PRICE_UNAVAILABLE"}'});});
 f.context.on('page',popup=>f.popups.push(popup));
 await p.evaluate(async({id,url})=>{
  await closeVehicle({discard:true});const S=__encarFixtureState;S.revisions.set('cars:'+S.user.id,__encarFixtureRevision);
  cars[0].encarLinks={version:2,plate:cars[0].plate,id,url,verifiedAt:new Date().toISOString(),priceWon:12000000,priceCheckedAt:new Date().toISOString(),priceSource:'encar'};
  persistCars();if((await zc86Cloud.flush())?.ok!==true)throw Error('Synthetic seed needs its CAS receipt');navigate('buy');renderCars();
 },{id:ID,url:AD_URL});
 await icon(p).waitFor();await p.locator('#snote-reorder-notice:not([hidden])').waitFor({state:'hidden'});await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await p.evaluate(()=>!!window.SnoteEncarId),!missing);f.seedWrites=await p.evaluate(()=>__encarFixtureWrites.length);return f;
}
async function open(f,kind='pointer'){
 const p=f.page,link=icon(p);await link.scrollIntoViewIfNeeded();assert.equal(await link.evaluate(e=>e.tagName),'A','Confirmed saved advertisements must be native links, not disabled buttons');
 assert.equal(await link.getAttribute('href'),AD_URL);assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
 const opened=f.context.waitForEvent('page',{timeout:5000});
 if(kind==='enter'||kind==='space'){await link.focus();await link.press(kind==='enter'?'Enter':'Space');}
 else{const box=await link.locator('svg').boundingBox()||await link.boundingBox();if(process.env.ENCAR_LIST_TRACE)console.log('CLICK TRACE',JSON.stringify(await link.evaluate((e,b)=>({box:b,rect:e.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,1000),href:e.getAttribute('href'),context:!!snoteEncarIdBridge.context(e.dataset.encarIdCar,'list'),saved:!!snoteEncarIdBridge.saved(snoteEncarIdBridge.context(e.dataset.encarIdCar,'list'))}),box)));await p.mouse.click(box.x+box.width/2,box.y+box.height/2,{button:kind==='middle'?'middle':'left'});}
 const popup=await opened;await popup.waitForURL(AD_URL);assert.equal(await popup.evaluate(()=>opener===null),true);await popup.close();
 assert.equal(await p.locator('#vehicle-overlay').evaluate(e=>e.classList.contains('open')),false,'Following the ad must not open the containing vehicle row');
}
async function sameWrites(f){assert.equal(await f.page.evaluate(()=>__encarFixtureWrites.length),f.seedWrites,'Opening saved links must not mutate the vehicle dataset');assert.deepEqual(f.adRequests,[],'List links must not search GLOAR, fetch prices or use retired APIs');}
async function normal(width){
 const f=await setup(width),p=f.page;try{
  await open(f);await open(f,'enter');await open(f,'space');
  const auxiliary=await icon(p).evaluate(link=>['auxclick','contextmenu'].map(type=>{let prevented;link.addEventListener(type,event=>{prevented=event.defaultPrevented;event.preventDefault();},{once:true});link.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:type==='auxclick'?1:2}));return{type,prevented};}));assert(auxiliary.every(item=>item.prevented===false),'Valid auxiliary/context-menu activations must retain native-link behavior');
  await p.locator('#list-screen [data-registration-car-id="'+CAR+'"] .car-name,#list-screen [data-registration-car-id="'+CAR+'"] .vehicle-title').filter({visible:true}).first().click();
  await p.locator('#vehicle-overlay.open').waitFor();await p.locator('#vehicle-overlay [aria-label="차량 상세 닫기"]').click();await p.waitForFunction(()=>!document.getElementById('vehicle-overlay').classList.contains('open'));
  await open(f);await p.evaluate(()=>renderCars());await open(f);
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');await open(f);await open(f,'enter');
  await p.screenshot({path:path.join(OUT,'native-list-'+width+'.png')});await sameWrites(f);await finish(f);results.push({kind:'native table/card/keyboard/auxiliary guards/real drawer close/rerender',width,passed:true});console.log('PASS native saved list links '+width);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-normal-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function missing(width){
 const f=await setup(width,{missing:true}),p=f.page;try{await open(f);await open(f,'enter');await p.locator('#snote-vehicle-view-switch').click();await open(f);await sameWrites(f);await finish(f);results.push({kind:'unavailable optional discovery bundle',width,passed:true});console.log('PASS saved native links without discovery bundle '+width);}catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function stale(){
 const f=await setup(1440),p=f.page;try{
  const before=f.popups.length;
  const rejected=await icon(p).evaluate(link=>{cars[0].plate='34나5678';return ['click','auxclick','contextmenu'].map(type=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,button:type==='auxclick'?1:type==='contextmenu'?2:0});const result=link.dispatchEvent(event);return{type,result,prevented:event.defaultPrevented};});});
  assert(rejected.every(item=>item.result===false&&item.prevented),'Changed plates must cancel every native activation');await p.waitForTimeout(80);assert.equal(f.popups.length,before);assert.equal(await icon(p).getAttribute('href'),null);assert.equal(await icon(p).getAttribute('aria-disabled'),'true');
  await p.evaluate(()=>{cars[0].plate='12가3456';renderCars();});await open(f);
  const denied=await icon(p).evaluate(link=>{__encarFixtureState.members[0].active=false;const event=new MouseEvent('click',{bubbles:true,cancelable:true});return{allowed:link.dispatchEvent(event),prevented:event.defaultPrevented};});assert.deepEqual(denied,{allowed:false,prevented:true});await sameWrites(f);await finish(f);results.push({kind:'changed plate and inactive account reject native activation',passed:true});console.log('PASS stale/unauthorized native saved link guards');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
(async()=>{realBrowser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(nativeFixtureBrowser());try{for(const width of WIDTHS){if(process.env.ENCAR_LIST_FOCUS!=='missing')await normal(width);await missing(width);}if(process.env.ENCAR_LIST_FOCUS!=='missing')await stale();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}finally{await realBrowser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
