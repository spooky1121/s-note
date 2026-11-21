'use strict';
// Real index routing and popups. Every account, API reply and request is synthetic.
const assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const MESSAGE='#snote-message-dialog[open]';

async function begin(page,target,key='pending'){
 return page.evaluate(({target,key})=>{
  window.__navigationTasks??={};
  const result=navigate(target);window.__navigationTasks[key]=result;
  return {promise:!!result&&typeof result.then==='function',value:typeof result==='boolean'?result:null};
 },{target,key});
}
async function result(page,key='pending'){return page.evaluate(key=>window.__navigationTasks[key],key);}
async function choose(page,accept){await page.locator(MESSAGE+' '+(accept?'[data-message-accept]':'[data-message-cancel]')).click();}

async function run(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 try{
  setBrowser(browser);const f=await fixture(320),p=f.page;
  await p.setViewportSize({width:320,height:640});f.manualMessages=true;
  await p.evaluate(async()=>{
   __snoteFixtureManualMessages=true;
   await closeVehicle({discard:true});
   window.__navigationConfirmations=0;
   addEventListener('snote:message-open',event=>{if(event.detail.kind==='confirm')__navigationConfirmations++;});
  });

  assert.deepEqual(await begin(p,'sell'),{promise:false,value:true});
  assert.deepEqual(await begin(p,'users'),{promise:false,value:true});
  console.log('PASS clean production navigation returns an immediate boolean');

  // Deferred module decisions isolate latest-request handling from form state.
  await p.evaluate(()=>{
   window.__navigationOffice=SnoteContractOffice;
   window.__navigationActor=currentUser;
   window.__navigationGates=[];
   window.SnoteContractOffice={beforeLeave:()=>new Promise(resolve=>__navigationGates.push(resolve))};
  });
  assert.equal((await begin(p,'sell','older')).promise,true);
  assert.equal((await begin(p,'buy','latest')).promise,true);
  await p.evaluate(()=>__navigationGates[0](true));
  assert.equal(await result(p,'older'),false);
  assert.equal(await p.evaluate(()=>route),'users');
  await p.evaluate(()=>__navigationGates[1](true));
  assert.equal(await result(p,'latest'),true);
  assert.equal(await p.evaluate(()=>route),'buy');

  assert.equal((await begin(p,'sell','oldAccount')).promise,true);
  await p.evaluate(()=>{currentUser={...currentUser,name:'전환된 합성 사용자'};__navigationGates[2](true);});
  assert.equal(await result(p,'oldAccount'),false);
  assert.equal(await p.evaluate(()=>route),'buy');
  await p.evaluate(()=>{currentUser=__navigationActor;window.SnoteContractOffice={beforeLeave:()=>Promise.resolve(null)};});
  assert.equal((await begin(p,'sell','abortedGuard')).promise,true);
  assert.equal(await result(p,'abortedGuard'),false);
  assert.equal(await p.evaluate(()=>route),'buy');
  await p.evaluate(()=>{window.SnoteContractOffice={beforeLeave:()=>null};});
  assert.deepEqual(await begin(p,'sell','abortedSyncGuard'),{promise:false,value:false});
  assert.equal(await p.evaluate(()=>route),'buy');
  await p.evaluate(()=>{window.SnoteContractOffice=__navigationOffice;});
  console.log('PASS late decisions cannot replace a newer navigation or cross an account change');
  console.log('PASS synchronous and asynchronous aborted module decisions cannot authorize navigation');

  await begin(p,'users');await p.evaluate(()=>openVehicle('encar-car-1'));
  await p.locator('#detail-extra').fill('메시지 수명 종료에도 보존할 합성 입력');
  await p.evaluate(()=>{window.__abortedVehicleClose=closeVehicle();});
  await p.locator(MESSAGE).waitFor();await p.evaluate(()=>SnoteMessages.clear());
  assert.equal(await p.evaluate(()=>__abortedVehicleClose),false);
  assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');
  assert.equal(await p.locator('#detail-extra').inputValue(),'메시지 수명 종료에도 보존할 합성 입력');
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);
  await p.evaluate(()=>{window.__explicitVehicleDiscard=closeVehicle();});
  await p.locator(MESSAGE).waitFor();await choose(p,false);
  await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});
  console.log('PASS lifecycle abort preserves edited vehicles while an explicit user cancellation still discards');

  assert.equal((await begin(p,'users')).value,true);
  await p.evaluate(()=>openVehicle('encar-car-1'));
  await p.locator('#detail-extra').fill('합성 경로 변경 전 임시 입력');
  assert.equal((await begin(p,'sell')).promise,true);
  await p.locator(MESSAGE).waitFor();
  const box=await p.locator(MESSAGE).boundingBox();
  assert(box.x>=0&&box.y>=0&&box.x+box.width<=320.5&&box.y+box.height<=640.5);
  await choose(p,false);
  assert.equal(await result(p),false);
  assert.equal(await p.evaluate(()=>route),'users');
  assert.equal(await p.locator('#detail-extra').inputValue(),'합성 경로 변경 전 임시 입력');
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);

  const before=await p.evaluate(()=>__navigationConfirmations);
  assert.equal((await begin(p,'sell')).promise,true);
  await p.locator(MESSAGE).waitFor();await choose(p,true);
  assert.equal(await result(p),true);
  assert.equal(await p.evaluate(()=>route),'sell');
  assert.equal(await p.evaluate(()=>__navigationConfirmations),before+1);
  assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'true');
  console.log('PASS dirty navigation cancellation keeps inputs; one approval discards and changes route without a save');

  await begin(p,'users');await p.evaluate(()=>openVehicle('encar-car-1'));
  await p.locator('#detail-extra').fill('이전 계정의 합성 임시 입력');
  await begin(p,'buy');await p.locator(MESSAGE).waitFor();
  await p.evaluate(()=>{window.__navigationActor=currentUser;currentUser={...currentUser,name:'다른 합성 사용자'};});
  await p.locator(MESSAGE).waitFor({state:'hidden'});
  assert.equal(await result(p),false);
  assert.equal(await p.evaluate(()=>route),'users');
  await p.evaluate(async()=>{currentUser=__navigationActor;await closeVehicle({discard:true});});
  console.log('PASS account changes cancel an open routing confirmation before it can apply');

  // Legacy hash navigation may emit both events for the same history traversal.
  await begin(p,'buy');await begin(p,'users');
  await p.evaluate(()=>openVehicle('encar-car-1'));
  await p.locator('#detail-extra').fill('브라우저 뒤로가기 합성 입력');
  await p.evaluate(()=>{__navigationConfirmations=0;history.back();});
  await p.locator(MESSAGE).waitFor();
  await p.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));
  assert.equal(await p.evaluate(()=>__navigationConfirmations),1);
  await choose(p,false);
  await p.waitForFunction(()=>history.state?.snoteNavigation?.page==='users');
  assert.equal(await p.evaluate(()=>route),'users');
  assert.equal(await p.locator('#detail-extra').inputValue(),'브라우저 뒤로가기 합성 입력');

  await p.evaluate(()=>{__navigationConfirmations=0;history.back();});
  await p.locator(MESSAGE).waitFor();
  await p.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));
  assert.equal(await p.evaluate(()=>__navigationConfirmations),1);
  await choose(p,true);await p.waitForFunction(()=>route==='buy');
  assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'true');
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);
  console.log('PASS popstate and hashchange share one decision; Back cancellation restores history and approval changes route');

  await begin(p,'users');await begin(p,'buy');await begin(p,'users');
  await p.evaluate(()=>openVehicle('encar-car-1'));
  await p.locator('#detail-extra').fill('두 번 뒤로가기에도 보존할 합성 입력');
  await p.evaluate(()=>{window.__backTwiceOrigin=history.state.snoteNavigation.position;history.back();});
  await p.locator(MESSAGE).waitFor();
  await p.evaluate(()=>history.back());
  await p.waitForFunction(()=>history.state?.snoteNavigation?.position===__backTwiceOrigin-2);
  // Attempt to approve the old dialog before its periodic stale check runs.
  await p.evaluate(()=>document.querySelector('#snote-message-dialog[open] [data-message-accept]')?.click());
  await p.waitForFunction(()=>!SnoteMessages.active());
  assert.equal(await p.evaluate(()=>route),'users');
  assert.equal(await p.evaluate(()=>history.state.snoteNavigation.page),'users');
  assert.equal(await p.locator('#detail-extra').inputValue(),'두 번 뒤로가기에도 보존할 합성 입력');
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);
  await p.evaluate(()=>closeVehicle({discard:true}));
  await finish(f);
  console.log('PASS a second Back to the visible route invalidates the first pending approval and preserves UI/history alignment');
 }finally{await browser.close();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
