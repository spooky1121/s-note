'use strict';
// Real application unread streams and profile UI; synthetic auth/RPC only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.PROFILE_BADGE_ARTIFACT_DIR||'/workspace/work/documents-v2165/profile-badge';fs.mkdirSync(OUT,{recursive:true});
const WIDTHS=(process.env.PROFILE_BADGE_WIDTHS||'1440,390,320').split(',').map(Number),results=[];
async function seed(f){
 await f.page.evaluate(async()=>{
  await closeVehicle({discard:true});
  const S=__encarFixtureState,original=S.client.rpc.bind(S.client);
  const state=window.__profileBadge={notifications:2,support:3,calls:[],holdSummary:false};
  const messages=()=>Array.from({length:state.support},(_,i)=>({id:'88888888-8888-4888-8888-'+String(i+1).padStart(12,'0'),sender:'operator',text:'합성 상담 답변 '+i,sequence:i+1,createdAt:'2026-11-21T01:00:00Z',readAt:null}));
  S.client.rpc=async(name,args)=>{
   if(name==='snote_vehicle_notifications'){
    state.calls.push({name,args});
    if(args.p_action==='summary'){const count=state.notifications;if(state.holdSummary){state.holdSummary=false;state.waiting=true;await new Promise(resolve=>state.releaseSummary=resolve);state.waiting=false;}return{data:{unread:count},error:null};}
    if(args.p_action==='list')return{data:{unread:state.notifications,items:Array.from({length:Math.min(state.notifications,2)},(_,i)=>({id:'99999999-9999-4999-8999-'+String(i+1).padStart(12,'0'),eventType:'changed',car:'합성 차량 '+i,actor:'합성 딜러',createdAt:'2026-11-21T01:00:00Z',readAt:null,changes:[]}))},error:null};
    if(args.p_action==='read'){state.notifications=0;return{data:{unread:0},error:null};}
   }
   if(name==='snote_support_messages'){state.calls.push({name,args});return{data:{messages:messages().slice(-args.p_limit),hasMore:false,nextBefore:null,unreadCount:state.support},error:null};}
   if(name==='snote_support_read'){state.calls.push({name,args});state.support=0;return{data:{unreadCount:0},error:null};}
   return original(name,args);
  };
  window.dispatchEvent(new Event('snote-vehicle-changed'));document.dispatchEvent(new Event('visibilitychange'));
 });
 await f.page.waitForFunction(()=>document.getElementById('snote-profile-trigger').dataset.unreadCount==='5');
}
async function refresh(p,notifications,support){await p.evaluate(({notifications,support})=>{Object.assign(__profileBadge,{notifications,support});window.dispatchEvent(new Event('snote-vehicle-changed'));document.dispatchEvent(new Event('visibilitychange'));},{notifications,support});await p.waitForFunction(total=>document.getElementById('snote-profile-trigger').dataset.unreadCount===String(total),notifications+support);}
async function run(width){
 const f=await fixture(width),p=f.page;try{
  await p.waitForFunction(()=>!!window.SnoteProfileNotificationBadge);await seed(f);
  const profile=p.locator('#snote-profile-trigger'),badge=p.locator('#snote-profile-unread-badge');
  assert.equal(await badge.textContent(),'5');assert.match(await profile.getAttribute('aria-label'),/새 알림 2개, 새 상담 메시지 3개/);
  const initial=await badge.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),profile=e.parentElement;return{width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,radius:s.borderRadius,animation:s.animationName,legacy:getComputedStyle(profile,'::after').display};});
  assert(initial.width>=20&&initial.width<=24&&initial.height===initial.width);assert.equal(initial.radius,'50%');assert.equal(initial.legacy,'none');assert.notEqual(initial.animation,'none');assert(initial.left>=0&&initial.right<=width&&initial.top>=0);
  await p.evaluate(()=>{for(let n=0;n<3;n++){window.dispatchEvent(new Event('snote-vehicle-changed'));document.dispatchEvent(new Event('visibilitychange'));}});await p.waitForTimeout(80);assert.equal(await badge.textContent(),'5','Repeated observations must replace counts, not accumulate them');
  await p.evaluate(()=>snoteOpenNotifications());await p.locator('#snote-notifications-dialog').waitFor({state:'visible'});await p.waitForFunction(()=>document.getElementById('snote-profile-trigger').dataset.unreadCount==='3');
  await p.getByRole('button',{name:'알림 닫기',exact:true}).click();await p.locator('#snote-notifications-dialog').waitFor({state:'hidden'});
  await p.evaluate(()=>SnoteChatbot.open());await p.getByRole('button',{name:'상담원 연결',exact:true}).click();await p.waitForFunction(()=>document.getElementById('snote-profile-trigger').dataset.unreadCount==='0');assert.equal(await badge.isHidden(),true,'The final read acknowledgement must hide the profile badge');await p.evaluate(()=>SnoteChatbot.close(false));
  await refresh(p,120,2);assert.equal(await badge.textContent(),'99+');assert.match(await profile.getAttribute('aria-label'),/새 알림 120개, 새 상담 메시지 2개/);
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await badge.evaluate(e=>getComputedStyle(e).animationName),'none');await p.emulateMedia({reducedMotion:'no-preference'});
  await refresh(p,2,3);const writes=await p.evaluate(()=>__encarFixtureWrites.length);
  await p.screenshot({path:path.join(OUT,'profile-badge-'+width+'.png')});
  const prior=await p.evaluate(()=>({expanded:document.getElementById('snote-profile-trigger').getAttribute('aria-expanded'),onclick:document.getElementById('snote-profile-trigger').getAttribute('onclick')}));
  await profile.click();assert.equal(await profile.getAttribute('aria-expanded'),'true');await p.evaluate(()=>snoteCloseProfileMenu(false));assert.equal(await profile.getAttribute('onclick'),prior.onclick);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),writes);
  results.push({kind:'actual unread sum/read acknowledgements/99+/reduced motion/menu',width,initial,passed:true});
  if(width===1440){
   await p.evaluate(()=>{__profileBadge.holdSummary=true;window.dispatchEvent(new Event('snote-vehicle-changed'));});await p.waitForFunction(()=>__profileBadge.waiting);
   await p.evaluate(()=>{
    window.__oldProfileContexts={notifications:snoteVehicleShareBridge.context(),support:snoteSupportChatBridge.context()};
    const S=__encarFixtureState,id='77777777-7777-4777-8777-777777777777',alias='cld_'+id.replaceAll('-','').slice(0,18);S.user={...S.user,id,email:'other@example.invalid'};S.alias=alias;S.members=[{user_id:id,company_id:S.company.id,active:true,role:'dealer',display_name:'다른 합성 계정'}];currentUser={...currentUser,username:alias,name:'다른 합성 계정'};document.getElementById('profile-name').textContent='다른 합성 계정';Object.assign(__profileBadge,{notifications:2,support:1});
    window.dispatchEvent(new Event('snote-vehicle-changed'));document.dispatchEvent(new Event('visibilitychange'));
   });
   await p.waitForFunction(()=>document.getElementById('snote-profile-trigger').dataset.unreadCount==='1');await p.evaluate(()=>__profileBadge.releaseSummary());await p.waitForFunction(()=>document.getElementById('snote-profile-trigger').dataset.unreadCount==='3');
   await p.evaluate(()=>{SnoteProfileNotificationBadge.update('notifications',900,__oldProfileContexts.notifications);SnoteProfileNotificationBadge.update('support',900,__oldProfileContexts.support);SnoteProfileNotificationBadge.update('support',0,null);});assert.equal(await badge.textContent(),'3','Old account replies or unscoped resets must not erase or replace valid new counts');assert(!/900/.test(await profile.getAttribute('aria-label')));
   await p.evaluate(()=>{__encarFixtureState.ready=false;__encarFixtureState.user=null;currentUser=null;document.getElementById('profile-name').textContent='내 프로필';});await p.waitForFunction(()=>document.getElementById('snote-profile-unread-badge').hidden);assert.equal(await profile.getAttribute('data-unread-count'),'0');
   results.push({kind:'account switch held response/stale source rejection/logout reset',width,passed:true});
  }
  await finish(f);console.log('PASS profile numeric unread badge '+width);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of WIDTHS)await run(width);fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
