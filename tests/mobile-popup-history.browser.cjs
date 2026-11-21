'use strict';
// Real history traversals and production close handlers; all accounts/HTTP are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const MESSAGE='#snote-message-dialog';
async function depth(p,value){try{await p.waitForFunction(value=>(history.state?.snoteMobilePopup?.depth||0)===value,value);}catch(error){console.error('DEPTH',await p.evaluate(()=>({state:history.state,route,open:[...document.querySelectorAll('dialog[open],.overlay.open,.snote-popup-overlay:not([hidden])')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,closing:e.dataset.snoteDrawerClosing}))})));throw error;}}
async function back(p){await p.evaluate(()=>history.back());}
async function current(p,page){assert.equal(await p.evaluate(()=>route),page);assert.equal(await p.evaluate(()=>history.state?.snoteNavigation?.page),page);}
async function ready(width,withoutNavigation=false){
 const f=await fixture(width,null,{manualMessages:true}),p=f.page;
 if(withoutNavigation)await p.evaluate(()=>Object.defineProperty(window,'navigation',{value:undefined,configurable:true}));
 if(!await p.evaluate(()=>!!window.SnoteMobilePopupHistory))await p.addScriptTag({path:path.resolve(__dirname,'../assets/mobile-popup-history.js')});
 await depth(p,1);await back(p);await p.waitForFunction(()=>activeCarId===null);await depth(p,0);
 await p.evaluate(()=>navigate('buy'));await current(p,'buy');return f;
}
async function nested(f){
 const p=f.page;await p.evaluate(()=>openVehicle(cars[0].id));await depth(p,1);
 await p.locator('#vehicle-overlay .vehicle-modal').evaluate(e=>e.scrollTop=350);
 const scroll=await p.locator('#vehicle-overlay .vehicle-modal').evaluate(e=>e.scrollTop);
 await p.evaluate(()=>SnoteInventoryStartDate.open());await depth(p,2);
 await p.evaluate(()=>{window.__popupResult='pending';snoteConfirm('모바일 최상위 확인').then(v=>window.__popupResult=v);});await depth(p,3);
 await back(p);await p.waitForFunction(()=>__popupResult===null);await depth(p,2);
 assert.equal(await p.locator('#snote-inventory-start-dialog').evaluate(e=>e.open),true);await current(p,'buy');
 await back(p);await p.waitForFunction(()=>!document.getElementById('snote-inventory-start-dialog').open);await depth(p,1);
 assert.equal(await p.evaluate(()=>activeCarId),await p.evaluate(()=>cars[0].id));
 assert.equal(await p.locator('#vehicle-overlay .vehicle-modal').evaluate(e=>e.scrollTop),scroll,'Nested Back must preserve the parent drawer scroll');
 await back(p);await p.waitForFunction(()=>activeCarId===null);await depth(p,0);await current(p,'buy');
 await back(p);await p.waitForFunction(()=>route==='dashboard');await p.evaluate(()=>history.forward());await p.waitForFunction(()=>route==='buy');
 // Forward to a consumed popup sentinel is inert, and never resurrects its UI.
 await p.evaluate(()=>history.forward());await depth(p,0);await current(p,'buy');assert.equal(await p.evaluate(()=>activeCarId),null);
}
async function explicitAndQueued(f){
 const p=f.page;await p.evaluate(()=>openVehicle(cars[0].id));await depth(p,1);
 await p.locator('#vehicle-overlay .detail-close').click();await p.waitForFunction(()=>activeCarId===null);await depth(p,0);
 await back(p);await p.waitForFunction(()=>route==='dashboard');await p.evaluate(()=>history.forward());await p.waitForFunction(()=>route==='buy');
 await p.evaluate(()=>{window.__first='pending';window.__second='pending';snoteConfirm('첫 요청').then(v=>window.__first=v);snoteAlert('두 번째 요청').then(v=>window.__second=v);});await depth(p,1);
 await back(p);await p.waitForFunction(()=>__first===null&&document.getElementById('snote-message-copy').textContent==='두 번째 요청');await depth(p,1);
 assert.equal(await p.evaluate(()=>__second),'pending');await back(p);await p.waitForFunction(()=>__second===null);await depth(p,0);await current(p,'buy');
 await p.evaluate(()=>snoteNotify('자동 닫기',{duration:300,key:'mobile-history-auto'}));await depth(p,1);await p.locator(MESSAGE).waitFor({state:'hidden'});await depth(p,0);
 await p.evaluate(()=>SnoteInventoryStartDate.open()); // no active car: only a guarded notice may appear
 if(await p.locator(MESSAGE).isVisible()){await p.keyboard.press('Escape');await depth(p,0);}
}
async function menusAndNativeGuards(f){
 const p=f.page;
 await p.locator('#snote-profile-trigger').click();await depth(p,1);await back(p);await depth(p,0);assert.equal(await p.locator('#snote-profile-menu').isVisible(),false);await current(p,'buy');
 await p.locator('#snote-calculator-trigger').click();await depth(p,1);await back(p);await p.locator('#snote-calculator-panel').waitFor({state:'hidden'});await depth(p,0);await current(p,'buy');
 await p.evaluate(()=>openMobileDrawer());await depth(p,1);await back(p);await depth(p,0);assert.equal(await p.locator('#mobile-drawer').getAttribute('aria-hidden'),'true');
 await p.evaluate(()=>openVehicle(cars[0].id));await depth(p,1);await p.locator('#detail-color-trigger').click();await depth(p,2);await back(p);await depth(p,1);assert.equal(await p.locator('#detail-color-picker').evaluate(e=>e.classList.contains('expanded')),false);assert.notEqual(await p.evaluate(()=>activeCarId),null);
 await p.evaluate(()=>{window.__dateBridge=snoteInventoryStartBridge;window.__dateSaving=false;window.snoteInventoryStartBridge={...__dateBridge,save:(base,date)=>{__dateSaving=true;return new Promise(resolve=>window.__releaseDate=()=>{__dateSaving=false;resolve({ok:true,saved:true,startDate:date});});}};SnoteInventoryStartDate.open();});await depth(p,2);
 await p.locator('#snote-inventory-start-date').fill('2026-01-01');await p.locator('.snote-inventory-start-save').click();await p.waitForFunction(()=>__dateSaving);await back(p);await depth(p,2);assert.equal(await p.locator('#snote-inventory-start-dialog').evaluate(e=>e.open),true);await current(p,'buy');
 await p.evaluate(()=>__releaseDate());await p.locator('#snote-inventory-start-dialog').waitFor({state:'hidden'});
 if(await p.locator(MESSAGE).isVisible())await back(p);await depth(p,1);await p.evaluate(()=>window.snoteInventoryStartBridge=__dateBridge);await back(p);await p.waitForFunction(()=>activeCarId===null);await depth(p,0);
 // Browser top-layer order follows showModal chronology, regardless of CSS z-index.
 await p.evaluate(()=>{for(const [id,z] of [['mobile-native-old',999999],['mobile-native-new',0]]){const d=document.createElement('dialog');d.id=id;d.style.zIndex=String(z);d.textContent=id;document.body.append(d);d.showModal();}});await depth(p,2);
 await back(p);await depth(p,1);assert.equal(await p.locator('#mobile-native-new').evaluate(e=>e.open),false);assert.equal(await p.locator('#mobile-native-old').evaluate(e=>e.open),true);await back(p);await depth(p,0);await p.evaluate(()=>{document.getElementById('mobile-native-old').remove();document.getElementById('mobile-native-new').remove();});
}
async function dirty(f){
 const p=f.page;await p.evaluate(()=>openVehicle(cars[0].id));await depth(p,1);
 await p.locator('#detail-model').fill('모바일 보존 초안');await back(p);await p.locator(MESSAGE+'[open]').waitFor();await depth(p,2);
 await current(p,'buy');assert.equal(await p.locator('#detail-model').inputValue(),'모바일 보존 초안');
 const writes=await p.evaluate(()=>__encarFixtureWrites.length);
 await back(p);await p.locator(MESSAGE).waitFor({state:'hidden'});await depth(p,1);
 assert.equal(await p.locator('#detail-model').inputValue(),'모바일 보존 초안');assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),writes,'Back over a confirmation must abort, never save or discard its parent');
 await back(p);await p.locator(MESSAGE+'[open]').waitFor();await depth(p,2);
 await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator(MESSAGE+' [data-message-accept]').click();await p.waitForFunction(()=>__encarFixtureWriteWaiting);
 await back(p);await p.waitForTimeout(80);await current(p,'buy');assert.notEqual(await p.evaluate(()=>activeCarId),null,'An in-flight save cannot navigate behind its drawer');
 await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';__encarFixtureReleaseWrite();});await p.waitForFunction(()=>activeCarId===null);
 if(await p.locator(MESSAGE).isVisible())await back(p);await depth(p,0);await current(p,'buy');
 assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),writes+1);assert.equal(await p.evaluate(()=>cars[0].model),'모바일 보존 초안');
}
async function overlayRoots(f){
 const p=f.page;
 // Mount each existing overlay in its empty/clean state. Its actual X handler
 // must be reached even when popup-controls moved that X outside the role card.
 for(const id of ['overlay','zc-dashboard-gate','zc-auto-reg-overlay','zc182-finance-overlay','zc80-unlock','status-overlay','ps-confirm-overlay','quote-overlay','contract-overlay','zc76-receipt-overlay','zc72-sale-modal','zoom-overlay','snote201-image-zoom']){
  await p.evaluate(async id=>{if(id==='zoom-overlay'){await SnoteVehicleImageViewer.open({src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="green"/></svg>',isCurrent:()=>true});return;}const e=document.getElementById(id);e.hidden=false;e.classList.add('open');e.setAttribute('aria-hidden','false');},id);await depth(p,1);
  await back(p);await depth(p,0);await current(p,'buy');
  await p.locator('#'+id).waitFor({state:'hidden'});
  assert.equal(await p.locator('#'+id).isVisible(),false,'Back must use the existing close control of '+id);
 }
}
async function routeGuard(f){
 const p=f.page;
 await p.evaluate(()=>navigate('sell'));
 await p.evaluate(()=>{window.__oldOffice=SnoteContractOffice;window.SnoteContractOffice={...SnoteContractOffice,beforeLeave:()=>snoteConfirm('화면 이동 중 보존할 초안')};});
 await back(p);await p.locator(MESSAGE+'[open]').waitFor();await depth(p,0);
 assert.equal(await p.evaluate(()=>route),'sell');
 await back(p);await p.locator(MESSAGE).waitFor({state:'hidden'});await p.waitForFunction(()=>history.state?.snoteNavigation?.page==='sell');await current(p,'sell');await depth(p,0);
 await back(p);await p.locator(MESSAGE+'[open]').waitFor();await p.locator(MESSAGE+' [data-message-cancel]').click();await p.waitForFunction(()=>history.state?.snoteNavigation?.page==='sell');await current(p,'sell');
 await p.evaluate(()=>window.SnoteContractOffice=__oldOffice);await back(p);await p.waitForFunction(()=>route==='buy');await current(p,'buy');
}
async function navigationDuringCleanup(f,width){
 const p=f.page;
 for(const mode of ['cancel','delay']){
  await p.evaluate(mode=>{
   const d=document.createElement('dialog');d.id='mobile-cleanup-fixture';d.textContent='닫기 정리 중 화면 이동';document.body.append(d);d.showModal();
   window.__originalPopupGo=history.go.bind(history);window.__heldPopupGo=null;window.__popupGoCount=0;
   history.go=delta=>{__popupGoCount++;if(mode==='delay'||__popupGoCount===1){__heldPopupGo=delta;return;}__originalPopupGo(delta);};
  },mode);await depth(p,1);await p.evaluate(()=>document.getElementById('mobile-cleanup-fixture').close());await p.waitForFunction(()=>__heldPopupGo!==null);
  await p.evaluate(()=>{window.__cleanupNavigation='pending';Promise.resolve(navigate('sell')).then(value=>window.__cleanupNavigation=value);});
  if(mode==='delay'){await p.waitForTimeout(90);assert.equal(await p.evaluate(()=>route),'buy','A new route waits for the old cleanup rather than truncating its destination');assert.equal(await p.evaluate(()=>__cleanupNavigation),'pending');await p.evaluate(()=>{history.go=__originalPopupGo;__originalPopupGo(__heldPopupGo);});}
  await p.waitForFunction(()=>__cleanupNavigation===true);await current(p,'sell');await depth(p,0);assert(await p.evaluate(()=>__popupGoCount)>=1);
  await p.evaluate(()=>{history.go=__originalPopupGo;document.getElementById('mobile-cleanup-fixture').remove();});await back(p);await p.waitForFunction(()=>route==='buy');await current(p,'buy');
 }
 await p.evaluate(()=>{const d=document.createElement('dialog');d.id='mobile-resize-fixture';d.textContent='화면 크기 변경';document.body.append(d);d.showModal();});await depth(p,1);
 await p.setViewportSize({width:900,height:950});await depth(p,0);await current(p,'buy');assert.equal(await p.locator('#mobile-resize-fixture').evaluate(e=>e.open),true,'Desktop transition removes mobile history without force-closing the popup');
 await p.evaluate(()=>{document.getElementById('mobile-resize-fixture').close();document.getElementById('mobile-resize-fixture').remove();});await p.setViewportSize({width,height:950});await depth(p,0);
}
async function frames(f){
 const p=f.page;
 await f.context.route('**/mobile-popup-child.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/assets/message-popup.js"></script><script src="/assets/mobile-popup-history.js" defer></script><button id="trigger">열기</button><dialog id="child-dialog"><form method="dialog"><button>닫기</button></form></dialog><script>trigger.onclick=()=>document.getElementById("child-dialog").showModal();</script>'}));
 await p.evaluate(()=>{const iframe=document.createElement('iframe');iframe.id='mobile-popup-frame';iframe.src='/mobile-popup-child.html';iframe.style.cssText='position:fixed;inset:200px 0 auto;width:250px;height:250px;z-index:10';document.body.append(iframe);});
 const frame=p.frameLocator('#mobile-popup-frame');await frame.locator('#trigger').click();await depth(p,1);
 await frame.locator('body').evaluate(()=>{window.__childAnswer='pending';snoteConfirm('자식 확인').then(v=>window.__childAnswer=v);});await depth(p,2);
 await back(p);await p.waitForFunction(()=>!document.getElementById('snote-message-dialog').open);await depth(p,1);assert.equal(await frame.locator('body').evaluate(()=>window.__childAnswer),null);
 assert.equal(await frame.locator('#child-dialog').evaluate(e=>e.open),true);await back(p);await depth(p,0);assert.equal(await frame.locator('#child-dialog').evaluate(e=>e.open),false);await current(p,'buy');
 await p.evaluate(()=>{window.__parentAnswer='pending';snoteConfirm('부모 소유 확인').then(v=>window.__parentAnswer=v);});await depth(p,1);
 assert.equal(await frame.locator('body').evaluate(()=>SnoteMessages.dismissTop({abort:true})),false,'A delegated child cannot abort another owner’s active decision');assert.equal(await p.evaluate(()=>__parentAnswer),'pending');await back(p);await depth(p,0);assert.equal(await p.evaluate(()=>__parentAnswer),null);
 await p.evaluate(()=>document.getElementById('mobile-popup-frame').remove());
}
async function rapidAndReset(f){
 const p=f.page;await p.evaluate(()=>openVehicle(cars[0].id));await depth(p,1);
 await p.evaluate(()=>{history.back();setTimeout(()=>history.back(),25);setTimeout(()=>history.back(),45);});
 await p.waitForFunction(()=>activeCarId===null);await p.waitForTimeout(200);await current(p,'buy');await depth(p,0);
 await p.evaluate(()=>{openVehicle(cars[0].id);SnoteInventoryStartDate.open();});await depth(p,2);
 await p.evaluate(()=>{window.__beforeReset=history.state.snoteMobilePopup.token;currentUser=null;for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();snoteVehicleCloseNow();snoteResetWorkspaceNavigation();snoteWriteAuthHistory('login','replace');document.getElementById('zc-cloud-gate').hidden=false;__encarFixtureState.ready=false;});
 await depth(p,0);await p.evaluate(()=>history.back());await p.waitForTimeout(200);
 assert.equal(await p.evaluate(()=>currentUser),null);assert.equal(await p.evaluate(()=>history.state?.snoteNavigation?.view),'auth');assert.equal(await p.evaluate(()=>!!history.state?.snoteMobilePopup),false);assert.equal(await p.locator('#vehicle-overlay').isVisible(),false);
}
async function standaloneCustomer(browser,width){
 const context=await browser.newContext({viewport:{width,height:950}}),p=await context.newPage(),errors=[],external=[];
 p.on('pageerror',error=>errors.push(error.message));p.setDefaultTimeout(15000);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!=='https://popup-customer.example'){external.push(url.href);return route.abort();}
  if(url.pathname==='/api/customer-intake'){assert.equal(JSON.parse(route.request().postData()).action,'info');return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,flowVersion:'wizard-v1',rrnEnabled:true,status:'pending',car:{model:'합성 모바일 차량',plate:'12가3456',year:2026,km:10000,sellWon:23000000},companyName:'합성 상사',phoneMasked:'010-****-5678',expiresAt:'2099-01-01T00:00:00Z'})});}
  const file=path.resolve(__dirname,'..',url.pathname.slice(1));return file.startsWith(path.resolve(__dirname,'..')+path.sep)&&fs.existsSync(file)?route.fulfill({path:file}):route.abort();
 });
 try{
  await p.goto('https://popup-customer.example/customer.html#'+'a'.repeat(64),{waitUntil:'networkidle'});await p.locator('#stage-car').waitFor({state:'visible'});
  await p.locator('#vehicle-confirmed').check();await p.locator('#vehicle-next').click();await p.locator('#customer-name').fill('모바일 보존 고객');await p.locator('#wizard-next').click();await p.locator('[data-wizard-step="rrn"]').waitFor({state:'visible'});
  await p.evaluate(()=>{window.__customerBack='pending';snoteConfirm('단독 화면 확인').then(v=>window.__customerBack=v);});await depth(p,1);await back(p);await p.waitForFunction(()=>__customerBack===null);await depth(p,0);
  assert.equal(await p.locator('[data-wizard-step="rrn"]').isVisible(),true);assert.equal(await p.locator('#customer-name').inputValue(),'모바일 보존 고객');assert.equal(await p.evaluate(()=>history.state.screen),'details');assert.equal(await p.evaluate(()=>history.state.step),'rrn');
  await p.locator('#wizard-next').click();await p.locator(MESSAGE+'[open]').waitFor();await depth(p,1);await back(p);await depth(p,0);assert.equal(await p.locator('[data-wizard-step="rrn"]').isVisible(),true,'Back closes validation only, without invoking the wizard popstate handler');
  await back(p);await p.locator('[data-wizard-step="name"]').waitFor({state:'visible'});assert.equal(await p.locator('#customer-name').inputValue(),'모바일 보존 고객');assert.equal(await p.evaluate(()=>history.state.step),'name');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS standalone customer popup Back preserves wizard '+width);
 }finally{await context.close();}
}
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(b);
 try{for(const width of [390,320]){const f=await ready(width,width===320);await nested(f);await explicitAndQueued(f);await menusAndNativeGuards(f);await dirty(f);await overlayRoots(f);await frames(f);await routeGuard(f);await navigationDuringCleanup(f,width);await rapidAndReset(f);await finish(f);console.log('PASS mobile popup history '+width+(width===320?' without Navigation API':''));await standaloneCustomer(b,width);}}
 finally{await b.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
