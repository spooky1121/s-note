'use strict';
// Deliberately reorder notification responses around a confirmed read. All HTTP,
// auth and data use the existing isolated browser fixture; no live accounts/DB.
const assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');

async function setup(page,{holdRead=false}={}){
 await page.evaluate(holdRead=>{
  closeVehicle({discard:true});
  const state=window.__notificationRace={account:'account-a',unreads:{'account-a':1,'account-b':2},holdSummary:false,holdRead,summaryCalls:0,summaryReturned:0,readPending:false,readReturned:false};
  window.snoteVehicleShareBridge={
   context:()=>({key:state.account}),current:context=>context?.key===state.account,
   notification:async(context,args)=>{
    const account=context.key;
    if(args.p_action==='summary'){
     const unread=state.unreads[account];++state.summaryCalls;
     if(state.holdSummary){state.summaryPending=true;await new Promise(resolve=>state.releaseSummary=resolve);state.summaryPending=false;state.holdSummary=false;}
     ++state.summaryReturned;return{unread,items:[]};
    }
    if(args.p_action==='list')return{unread:state.unreads[account],items:[{id:'55555555-5555-4555-8555-555555555555',car:'응답 순서 검증 차량',actor:'가상 딜러',createdAt:'2026-11-05T00:00:00Z',readAt:null,moneyUnit:'KRW',changes:[{field:'color',before:'흰색',after:'검정색'}]}]};
    if(args.p_action==='read'){
     state.readPending=true;
     if(state.holdRead)await new Promise(resolve=>state.releaseRead=resolve);
     state.unreads[account]=0;state.readReturned=true;return{unread:0,items:[]};
    }
    throw Error('Unexpected notification test action');
   }
  };
  window.dispatchEvent(new Event('snote-vehicle-changed'));
 },holdRead);
 await page.locator('#snote-profile-trigger.snote-has-notifications').waitFor();
}

async function permissionVersionRace(page,width){
 await page.evaluate(()=>{
  closeVehicle({discard:true});
  const id='88888888-8888-4888-8888-888888888888';
  const state=window.__permissionNotice={account:'permission-account',permission:'edit',version:1,status:'pending',calls:[],events:0,hold:true};
  window.addEventListener('snote-vehicle-sharing-updated',()=>state.events++);
  window.snoteVehicleShareBridge={
   context:()=>({key:state.account}),current:context=>context?.key===state.account,
   notification:async(context,args)=>{
    if(args.p_action==='summary')return{unread:1};
    if(args.p_action==='read')return{unread:0};
    if(args.p_action!=='list')throw Error('Unexpected fixture action');
    return{unread:0,items:[{id,eventType:'share_invitation',car:'권한 변경 검증 차량',actor:'가상 소유자',createdAt:'2026-11-09T00:00:00Z',readAt:'2026-11-09T00:00:01Z',changes:[],invitation:{id,version:state.version,state:state.status,permission:state.permission}}]};
   },
   reply:async(context,args)=>{
    state.calls.push(structuredClone(args));
    if(state.hold){state.waiting=true;await new Promise(resolve=>state.release=resolve);state.waiting=false;}
    if(args.p_expected!==state.version)throw Object.assign(Error('CONFLICT'),{code:'40001'});
    state.status=args.p_accept?'accepted':'rejected';state.version++;
    return{ok:true,invitationId:id,state:state.status,version:state.version,alreadyProcessed:false};
   }
  };
  window.dispatchEvent(new Event('snote-vehicle-changed'));void snoteOpenNotifications();
 });
 const modal=page.locator('#snote-notifications-dialog'),row=modal.locator('[data-invitation-id="88888888-8888-4888-8888-888888888888"]');
 await row.getByRole('button',{name:'차량 공유 초대 수락'}).waitFor();assert.equal(await row.getAttribute('data-share-permission'),'edit');
 await row.getByRole('button',{name:'차량 공유 초대 수락'}).click();await page.waitForFunction(()=>__permissionNotice.waiting);
 await page.evaluate(()=>{__permissionNotice.permission='read';__permissionNotice.version=2;__permissionNotice.hold=false;__permissionNotice.release();});
 await page.waitForFunction(()=>document.querySelector('[data-invitation-id="88888888-8888-4888-8888-888888888888"]')?.dataset.sharePermission==='read');
 assert.equal(await row.getAttribute('data-invitation-state'),'pending');assert.match(await modal.locator('[role=status]').textContent(),/이미 처리되었거나 변경된 초대/);assert.equal(await page.evaluate(()=>__permissionNotice.events),0,'A stale acceptance cannot publish any sharing grant');
 assert.doesNotMatch(await row.locator('.notification-invitation-status').textContent(),/수정|삭제|휴지통/);
 await row.getByRole('button',{name:'차량 공유 초대 수락'}).click();await page.waitForFunction(()=>document.querySelector('[data-invitation-id="88888888-8888-4888-8888-888888888888"]')?.dataset.invitationState==='accepted');
 assert.equal(await row.getAttribute('data-share-permission'),'read');assert.match(await row.textContent(),/공유 권한: 읽기/);
 assert.deepEqual(await page.evaluate(()=>__permissionNotice.calls.map(call=>call.p_expected)),[1,2]);assert.equal(await page.evaluate(()=>__permissionNotice.events),1);
 console.log('PASS',width,'permission changes invalidate an old invitation version and display only confirmed current access before acceptance');
}

async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function badge(page,{unread}){
 const present=unread>0;
 assert.equal(await page.locator('#snote-profile-trigger').evaluate(e=>e.classList.contains('snote-has-notifications')),present);
 assert.equal(await page.locator('#snote-profile-notifications').evaluate(e=>e.classList.contains('snote-has-notifications')),present);
 assert.equal(await page.locator('#snote-notifications-button').count(),0);
 assert.equal(await page.locator('#snote-profile-trigger').getAttribute('data-unread-count'),String(unread));
 assert.equal(await page.locator('#snote-profile-notifications').getAttribute('aria-label'),present?'알림, 새 알림 '+unread+'개':'알림');
}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390]){
   {
    const f=await fixture(width),p=f.page;await setup(p);
    await p.evaluate(()=>{__notificationRace.holdSummary=true;window.dispatchEvent(new Event('snote-vehicle-changed'));});
    await p.waitForFunction(()=>__notificationRace.summaryPending===true);
    const before=await p.evaluate(()=>__notificationRace.summaryReturned);
    await p.evaluate(()=>{void window.snoteOpenNotifications();});
    await p.waitForFunction(()=>__notificationRace.readReturned&&!document.getElementById('snote-profile-trigger').classList.contains('snote-has-notifications'));
    await badge(p,{unread:0});
    await p.evaluate(()=>__notificationRace.releaseSummary());
    await p.waitForFunction(before=>__notificationRace.summaryReturned>before,before);await settle(p);
    await badge(p,{unread:0});
    await finish(f);console.log('PASS',width,'a stale pre-read summary cannot relight profile or menu badges without a bell after confirmed read');
   }
   {
    const f=await fixture(width),p=f.page;await setup(p,{holdRead:true});
    await p.evaluate(()=>{void window.snoteOpenNotifications();});await p.waitForFunction(()=>__notificationRace.readPending);
    await p.locator('#snote-notifications-dialog').getByRole('button',{name:'알림 닫기'}).click();
    await p.locator('#snote-notifications-dialog').waitFor({state:'hidden'});await badge(p,{unread:1});
    await p.evaluate(()=>__notificationRace.releaseRead());
    await p.waitForFunction(()=>__notificationRace.readReturned&&!document.getElementById('snote-profile-trigger').classList.contains('snote-has-notifications'));
    await badge(p,{unread:0});
    await finish(f);console.log('PASS',width,'confirmed read clears current-account badges even when its dialog was already closed');
   }
   {
    const f=await fixture(width),p=f.page;await setup(p,{holdRead:true});
    await p.evaluate(()=>{void window.snoteOpenNotifications();});await p.waitForFunction(()=>__notificationRace.readPending);
    await p.evaluate(()=>{__notificationRace.account='account-b';window.dispatchEvent(new Event('snote-vehicle-changed'));});
    await p.locator('#snote-notifications-dialog').waitFor({state:'hidden'});
    await p.waitForFunction(()=>document.getElementById('snote-profile-notifications').getAttribute('aria-label')==='알림, 새 알림 2개');
    await p.evaluate(()=>__notificationRace.releaseRead());await p.waitForFunction(()=>__notificationRace.readReturned);await settle(p);
    await badge(p,{unread:2});
    await finish(f);console.log('PASS',width,'a previous-account read acknowledgement cannot change the newly selected account badges');
   }
   {
    const f=await fixture(width);await permissionVersionRace(f.page,width);await finish(f);
   }
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
