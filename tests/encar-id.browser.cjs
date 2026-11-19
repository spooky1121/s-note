'use strict';
// Actual S-NOTE + native Chromium tabs. All identity, data, lookup and Encar HTML are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.ENCAR_ID_ARTIFACT_DIR||'/workspace/work/encar-ad-tab-ui/qa';fs.mkdirSync(OUT,{recursive:true});
const PLATE='12가3456',SECOND='34나5678',CAR='encar-car-1',ENDPOINT='/api/encar-id',FEM='https://fem.encar.com/cars/detail/';
const dialog=p=>p.locator('#snote-encar-id-dialog');
const idText=p=>p.locator('#snote-encar-id-dialog [data-encar-ad-id]').evaluateAll(nodes=>nodes.map(e=>e.textContent||'').join('').trim());
const found=(id='43123456',provider='gloar',plate=PLATE)=>({ok:true,status:'found',plate,id,provider});
async function install(f){
 const p=f.page,state={requests:[],legacy:[],replies:[],held:[],popups:[],navigations:[],before:null};
 f.context.on('page',page=>state.popups.push(page));
 await f.context.route('https://fem.encar.com/**',async route=>{const url=new URL(route.request().url());assert.equal(url.origin,'https://fem.encar.com');assert.match(url.pathname,/^\/cars\/detail\/[1-9][0-9]{5,11}$/);assert.equal(url.search,'');assert.equal(url.hash,'');state.navigations.push(url.href);await route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><title>합성 엔카 광고</title><p>외부 요청 없는 브라우저 검사</p>'});});
 await p.route('**/api/encar*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname!==ENDPOINT){state.legacy.push(url.pathname);return route.fulfill({status:410,contentType:'application/json',body:'{"ok":false,"code":"RETIRED"}'});}
  assert.equal(req.method(),'POST');assert.match(req.headers()['content-type'],/^application\/json/);assert.equal(req.headers().authorization,'Bearer '+await p.evaluate(()=>__encarFixtureSession.access_token));
  const body=req.postDataJSON();assert.deepEqual(Object.keys(body),['plate'],'Only the plate may be sent; no old IDs, customer data, price or arbitrary URL');assert.equal(body.plate,PLATE);state.requests.push(body);
  const reply=state.replies.shift();assert(reply,'Every lookup requires an explicit synthetic response');if(reply.hold)await new Promise(resolve=>state.held.push(resolve));
  try{await route.fulfill({status:reply.status||200,contentType:'application/json',body:JSON.stringify(reply.body)});}catch(error){if(!reply.hold)throw error;}
 });
 await p.evaluate(()=>{window.__encarIdEvents=[];window.__encarPopupBlocked=false;const open=window.open;window.open=(...args)=>{__encarIdEvents.push({type:'open',url:args[0]});return __encarPopupBlocked?null:open.apply(window,args);};const fetch=window.fetch;window.fetch=(url,...args)=>{if(url==='/api/encar-id')__encarIdEvents.push({type:'request'});return fetch.call(window,url,...args);};});
 await p.waitForFunction(()=>!!window.SnoteEncarId);await p.locator('#vehicle-encar-check:not([disabled])').waitFor();state.before=await p.evaluate(()=>JSON.stringify(cars));return state;
}
async function clean(f,state){
 const p=f.page;assert.deepEqual(state.legacy,[]);assert.deepEqual(f.navigations,[]);assert.deepEqual(f.autoPriceRequests,[]);assert.deepEqual(f.requests,[]);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Opening the advertisement may never write a vehicle');assert.equal(await p.evaluate(()=>JSON.stringify(cars)),state.before,'Cached links, prices and all vehicle fields must remain unchanged');assert.equal(await idText(p),'','No advertisement ID output may remain');
}
async function confirm(p){if(await dialog(p).isVisible()){await dialog(p).getByRole('button',{name:'확인',exact:true}).click();await dialog(p).waitFor({state:'hidden'});}}
async function closePopup(popup){if(!popup.isClosed())await popup.waitForEvent('close');assert.equal(popup.isClosed(),true);}
async function waitHeld(p,state){for(let attempt=0;!state.held.length&&attempt<150;attempt++)await p.waitForTimeout(10);assert(state.held.length,'The explicitly held request must reach the new endpoint');}
async function pending(f,state,button,body=found()){
 state.replies.push({body,hold:true});const opened=f.context.waitForEvent('page');await button.click();const popup=await opened;await waitHeld(f.page,state);assert.equal(popup.url(),'about:blank');assert.equal(await popup.evaluate(()=>window.opener===null),true,'DOM opener must be detached while waiting');await dialog(f.page).waitFor({state:'visible'});return popup;
}
async function success(f,state,button,id){
 const p=f.page,before=await p.evaluate(()=>__encarIdEvents.length);state.replies.push({body:found(id)});const opened=f.context.waitForEvent('page');await button.click();const popup=await opened;await popup.waitForURL(FEM+id);await dialog(p).waitFor({state:'hidden'});assert.equal(await popup.evaluate(()=>window.opener===null),true);const events=await p.evaluate(start=>__encarIdEvents.slice(start),before);assert.equal(events[0].type,'open');assert.equal(events[0].url,'about:blank');assert.equal(events[1].type,'request','The reserved tab must open before asynchronous API work');await clean(f,state);await popup.close();
}
async function buy(p){await p.evaluate(async()=>{await closeVehicle({discard:true});navigate('buy');});await p.locator('#list-screen').waitFor({state:'visible'});}
function listButton(p){return p.locator('#list-screen button.snote-list-encar[data-encar-id-car="'+CAR+'"]:visible').first();}
async function run(width){const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;let state;const report={width};
 try{
  state=await install(f);await p.evaluate(()=>{cars[0].encarLinks={version:1,plate:'12가3456',verifiedAt:'2026-01-01T00:00:00.000Z',listings:[{id:'42000000',sellerUrl:'https://fem.encar.com/cars/detail/42000000'}]};renderVehicle();});state.before=await p.evaluate(()=>JSON.stringify(cars));
  await success(f,state,p.locator('#vehicle-encar-check'),'43123456');report.detailNewTab=true;await p.screenshot({path:path.join(OUT,'detail-opened-'+width+'.png')});
  await buy(p);assert.equal(await p.locator('#list-table th').filter({hasText:/엔카/}).count(),1);assert.equal(await p.locator('#list-screen button.snote-list-encar[data-encar-id-car="encar-car-2"]:visible').count(),1);await success(f,state,listButton(p),'43123457');assert.equal(await p.locator('#vehicle-overlay.open').count(),0);report.listNewTab=true;
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');await success(f,state,listButton(p),'43123458');report.cardsNewTab=true;
  for(const body of[{ok:false,status:'not_found',code:'NOT_FOUND'},found('<img src=x onerror=alert(1)>'),found('43123459','gloar',SECOND),found('43123459','carnect'),found('43123459','trust')]){
   const navs=state.navigations.length;state.replies.push({body});const opened=f.context.waitForEvent('page');await listButton(p).click();const popup=await opened;await closePopup(popup);await dialog(p).waitFor({state:'visible'});assert.equal(await idText(p),'');assert.equal(await dialog(p).locator('img[src="x"]').count(),0);assert.equal(state.navigations.length,navs);assert.equal(await dialog(p).getByRole('link',{name:'엔카 광고 열기',exact:true}).count(),0);await confirm(p);await clean(f,state);
  }report.rejectedResponsesCannotNavigate=true;
  state.replies.push({body:{ok:false,status:'error',code:'GLOAR_INPUT_MISSING',error:'Untrusted upstream text'}});const errorOpened=f.context.waitForEvent('page');await listButton(p).click();await closePopup(await errorOpened);await dialog(p).locator('[role="status"]').filter({hasText:'GLOAR DATA의 검색창을 찾지 못했습니다.'}).waitFor();assert(!((await dialog(p).innerText()).includes('Untrusted upstream text')));await confirm(p);report.safeErrorAndBlankCleanup=true;
  const before=state.requests.length,cancelled=await pending(f,state,listButton(p));await listButton(p).evaluate(e=>{e.click();e.click();});assert.equal(state.requests.length,before+1);await confirm(p);await closePopup(cancelled);const cancelledNavs=state.navigations.length;state.held.shift()();await p.waitForTimeout(70);assert.equal(state.navigations.length,cancelledNavs);report.cancelAndDuplicateGuard=true;
  const manual=await pending(f,state,listButton(p));await manual.goto(FEM+'43999999');await confirm(p);assert.equal(manual.isClosed(),false,'Cancel must not close a tab the user navigated');state.held.shift()();await p.waitForTimeout(50);assert.equal(manual.url(),FEM+'43999999');await manual.close();report.userNavigatedTabPreserved=true;
  await p.evaluate(()=>window.__encarPopupBlocked=true);state.replies.push({body:found('43123461')});await listButton(p).click();const fallback=dialog(p).getByRole('link',{name:'엔카 광고 열기',exact:true});await fallback.waitFor();assert.equal(await fallback.getAttribute('href'),FEM+'43123461');assert.equal(await fallback.getAttribute('target'),'_blank');assert.equal(await fallback.getAttribute('rel'),'noopener noreferrer');assert.equal(await idText(p),'');assert(!((await dialog(p).innerText()).includes('43123461')));await p.screenshot({path:path.join(OUT,'popup-fallback-'+width+'.png')});const fallbackOpened=f.context.waitForEvent('page');await fallback.click();const fallbackTab=await fallbackOpened;await fallbackTab.waitForURL(FEM+'43123461');assert.equal(await fallbackTab.evaluate(()=>window.opener===null),true);await fallbackTab.close();await confirm(p);await p.evaluate(()=>window.__encarPopupBlocked=false);report.blockedPopupVerifiedLink=true;
  const closed=await pending(f,state,listButton(p),found('43123462'));await closed.close();const count=state.popups.length;state.held.shift()();await fallback.waitFor();assert.equal(await fallback.getAttribute('href'),FEM+'43123462');assert.equal(state.popups.length,count,'A closed waiting tab must use a gesture fallback, not an asynchronous popup');await confirm(p);report.closedPopupVerifiedLink=true;
  await clean(f,state);const stale=await pending(f,state,listButton(p));await p.evaluate(()=>{__encarFixtureState.user={id:'99999999-9999-4999-8999-999999999999'};currentUser={...currentUser,username:'other-synthetic-account'};});await dialog(p).waitFor({state:'hidden'});await closePopup(stale);const staleNavs=state.navigations.length;state.held.shift()();await p.waitForTimeout(70);assert.equal(state.navigations.length,staleNavs);report.staleAccountBlocked=true;
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.requests=state.requests.length;report.pass=true;
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});throw error;}finally{state?.held.splice(0).forEach(resolve=>resolve());await finish(f);}
 console.log('PASS Encar verified new tab + fallbacks',width,'detail/list/cards, native tabs, safe failures/cancel/stale and no writes');return report;
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{const reports=[];for(const width of[1440,390])reports.push(await run(width));fs.writeFileSync(path.join(OUT,'browser-results.json'),JSON.stringify({syntheticOnly:true,liveProviderVerified:false,productionReads:0,productionWrites:0,reports},null,2)+'\n');}finally{await browser.close();}}
module.exports={install,clean,confirm,closePopup,waitHeld,pending,success,dialog,found,idText};
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
