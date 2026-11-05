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

async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function badge(page,{unread}){
 const present=unread>0;
 assert.equal(await page.locator('#snote-profile-trigger').evaluate(e=>e.classList.contains('snote-has-notifications')),present);
 assert.equal(await page.locator('#snote-profile-notifications').evaluate(e=>e.classList.contains('snote-has-notifications')),present);
 assert.equal(await page.locator('#snote-notifications-button .snote-notification-dot').isVisible(),present);
 assert.equal(await page.locator('#snote-notifications-button').getAttribute('aria-label'),present?'차량 변경 알림, 새 알림 '+unread+'개':'차량 변경 알림');
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
    await p.locator('#snote-notifications-button').click();
    await p.waitForFunction(()=>__notificationRace.readReturned&&!document.getElementById('snote-profile-trigger').classList.contains('snote-has-notifications'));
    await badge(p,{unread:0});
    await p.evaluate(()=>__notificationRace.releaseSummary());
    await p.waitForFunction(before=>__notificationRace.summaryReturned>before,before);await settle(p);
    await badge(p,{unread:0});
    await finish(f);console.log('PASS',width,'a stale pre-read summary cannot relight profile, menu or bell badges after confirmed read');
   }
   {
    const f=await fixture(width),p=f.page;await setup(p,{holdRead:true});
    await p.locator('#snote-notifications-button').click();await p.waitForFunction(()=>__notificationRace.readPending);
    await p.locator('#snote-notifications-dialog').getByRole('button',{name:'알림 닫기'}).click();
    await p.locator('#snote-notifications-dialog').waitFor({state:'hidden'});await badge(p,{unread:1});
    await p.evaluate(()=>__notificationRace.releaseRead());
    await p.waitForFunction(()=>__notificationRace.readReturned&&!document.getElementById('snote-profile-trigger').classList.contains('snote-has-notifications'));
    await badge(p,{unread:0});
    await finish(f);console.log('PASS',width,'confirmed read clears current-account badges even when its dialog was already closed');
   }
   {
    const f=await fixture(width),p=f.page;await setup(p,{holdRead:true});
    await p.locator('#snote-notifications-button').click();await p.waitForFunction(()=>__notificationRace.readPending);
    await p.evaluate(()=>{__notificationRace.account='account-b';window.dispatchEvent(new Event('snote-vehicle-changed'));});
    await p.locator('#snote-notifications-dialog').waitFor({state:'hidden'});
    await p.waitForFunction(()=>document.getElementById('snote-notifications-button').getAttribute('aria-label')==='차량 변경 알림, 새 알림 2개');
    await p.evaluate(()=>__notificationRace.releaseRead());await p.waitForFunction(()=>__notificationRace.readReturned);await settle(p);
    await badge(p,{unread:2});
    await finish(f);console.log('PASS',width,'a previous-account read acknowledgement cannot change the newly selected account badges');
   }
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
