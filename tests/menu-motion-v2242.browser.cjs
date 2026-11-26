'use strict';
// Real Auth, navigation and dashboard assets; synthetic accounts/data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,setup}=require('./dashboard-layout-news-v2241.browser.cjs');
const {constants:{PASSWORD}}=require('./dealer-scheduler.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_MENU_MOTION_V2242_DIR||'/workspace/work/menu-motion-v2242/qa';
fs.mkdirSync(OUT,{recursive:true});
const FILES=['index.html','assets/accountant-navigation.js','assets/accountant-navigation.css','assets/home-dashboard.js','assets/home-dashboard.css','assets/workspace-reorder.js','assets/workspace-reorder.css','assets/route-transition.js','assets/route-transition.css','assets/feature-loader.js','assets/dashboard-news.js','assets/dashboard-news.css','assets/snote-brand.png','assets/fonts/PretendardVariable.woff2'];
const checks=[],sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const sources=()=>Object.fromEntries(FILES.map(file=>[file,{bytes:fs.statSync(path.join(ROOT,file)).size,sha256:sha(fs.readFileSync(path.join(ROOT,file)))}]));
function record(name,evidence={}){checks.push({name,...evidence});console.log('PASS '+name);fs.writeFileSync(path.join(OUT,'progress.json'),JSON.stringify({syntheticOnly:true,operatingReads:0,operatingWrites:0,checks},null,2)+'\n');}
async function settle(p){
 await p.waitForFunction(()=>!document.querySelector('main.content[data-route-transition]')&&getComputedStyle(document.body).visibility==='visible');
 await p.evaluate(()=>document.fonts.ready);
 await p.evaluate(async()=>{const nodes=[...document.querySelectorAll('.sidebar,#mobile-drawer,#snote-dashboard-home')];for(const e of nodes)e.getBoundingClientRect();await Promise.all(nodes.flatMap(e=>e.getAnimations({subtree:true})).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
}
async function drawer(p,open){
 const visible=await p.evaluate(()=>document.body.classList.contains('mobile-drawer-visible'));
 if(visible===open)return;
 if(open)await p.locator('#mobile-menu-trigger').click();else await p.keyboard.press('Escape');
 await p.waitForFunction(open=>document.body.classList.contains('mobile-drawer-visible')===open,open);await settle(p);
}
async function ids(p){const state=await p.evaluate(()=>{const all=[...document.querySelectorAll('[id]')],seen=new Set(),duplicates=[];for(const e of all){if(seen.has(e.id))duplicates.push(e.id);seen.add(e.id);}const broken=[...document.querySelectorAll('[data-accountant-group-toggle][aria-controls]')].filter(e=>!document.getElementById(e.getAttribute('aria-controls'))).map(e=>e.getAttribute('aria-controls'));return{duplicates,broken};});assert.deepEqual(state,{duplicates:[],broken:[]});}
function selector(host,group){return host+' [data-accountant-group-toggle='+group+']';}
async function groupState(p,host,group){return p.locator(selector(host,group)).evaluate(trigger=>{const child=document.getElementById(trigger.getAttribute('aria-controls')),r=child.getBoundingClientRect();return{expanded:trigger.getAttribute('aria-expanded'),hidden:child.hidden,inert:child.inert,ariaHidden:child.getAttribute('aria-hidden'),height:r.height,animations:child.getAnimations().filter(a=>a.playState==='running').length,style:child.getAttribute('style')||'',connected:child.isConnected};});}
function finalGroup(state,open){assert.equal(state.expanded,String(open));assert.equal(state.hidden,!open);assert.equal(state.inert,!open);assert.equal(state.ariaHidden,String(!open));assert.equal(state.animations,0);if(open)assert(state.height>45);else assert(state.height<.1);}
async function setGroup(p,host,group,open){if((await groupState(p,host,group)).expanded!==String(open)){await p.locator(selector(host,group)).click();await settle(p);}finalGroup(await groupState(p,host,group),open);}
async function traceGroup(p,host,group,open){
 return p.locator(selector(host,group)).evaluate(async(trigger,open)=>{
  const child=document.getElementById(trigger.getAttribute('aria-controls')),frames=[];
  const take=()=>({height:child.getBoundingClientRect().height,hidden:child.hidden,inert:child.inert,ariaHidden:child.getAttribute('aria-hidden'),expanded:trigger.getAttribute('aria-expanded'),opacity:Number(getComputedStyle(child).opacity),running:child.getAnimations().some(a=>a.playState==='running')});
  const before=take();trigger.click();const immediate=take();
  let start;await new Promise(resolve=>{function sample(t){if(start===undefined)start=t;frames.push(take());if(t-start<400)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample);});
  return{before,immediate,frames,after:take(),open};
 },open);
}
function moving(trace){
 const min=Math.min(trace.before.height,trace.after.height),max=Math.max(trace.before.height,trace.after.height);
 assert(max-min>40,'A grouped submenu must have a real height range');
 assert(trace.frames.length>4,'Motion must be sampled over actual frames');
 assert(trace.frames.some(f=>f.running&&f.height>min+2&&f.height<max-2),'No intermediate animated submenu height was observed');
 assert.equal(trace.immediate.expanded,String(trace.open));assert.equal(trace.immediate.inert,!trace.open);assert.equal(trace.immediate.ariaHidden,String(!trace.open));
 if(!trace.open)assert.equal(trace.immediate.hidden,false,'Closing content remains painted until the animation completes');
 finalGroup({...trace.after,animations:trace.after.running?1:0},trace.open);
 return{frameCount:trace.frames.length,minHeight:min,maxHeight:max,intermediate:trace.frames.filter(f=>f.height>min+2&&f.height<max-2).map(f=>Number(f.height.toFixed(2)))};
}
async function rapidToggle(p,host,group){
 await setGroup(p,host,group,false);
 const trace=await p.locator(selector(host,group)).evaluate(async trigger=>{
  const child=document.getElementById(trigger.getAttribute('aria-controls')),continuity=[];
  for(const delay of[70,35,25,0]){const before=child.getBoundingClientRect().height;trigger.click();continuity.push({before,after:child.getBoundingClientRect().height});if(delay)await new Promise(r=>setTimeout(r,delay));}
  await Promise.all(child.getAnimations().map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return continuity;
 });
 finalGroup(await groupState(p,host,group),false);
 assert(trace.slice(1).every(pair=>Math.abs(pair.before-pair.after)<2),'Reversing an active animation jumps away from its current height');
 await p.locator(selector(host,group)).focus();await p.keyboard.press('Tab');
 assert.equal(await p.locator(selector(host,group)).evaluate(trigger=>document.getElementById(trigger.getAttribute('aria-controls')).contains(document.activeElement)),false,'Tab entered a collapsed subtree');
 assert.equal(await p.locator(selector(host,group)).evaluate(trigger=>{const child=document.getElementById(trigger.getAttribute('aria-controls'));child.querySelector('button').focus();return child.contains(document.activeElement);}),false,'Inert submenu accepted programmatic focus');
 return trace;
}
async function focusRecovery(p,host,group){
 await setGroup(p,host,group,true);
 assert.equal(await p.locator(selector(host,group)).evaluate(trigger=>{const child=document.getElementById(trigger.getAttribute('aria-controls'));child.querySelector('button').focus();trigger.click();return document.activeElement===trigger;}),true,'Closing a subtree did not restore its internal focus to the group trigger');
 await settle(p);finalGroup(await groupState(p,host,group),false);
}
function noWrites(state){assert.equal(state.writes.length,0);assert.equal(state.boxWrites.length,0);assert(!state.rpcCalls.some(call=>/zc_write_dataset|profile_save|finance_lock_save|finance_rates_save/.test(call.name)));}
async function menuMotion(browser){
 const state=backend(),f=await setup(browser,1440,{email:'accountant@example.invalid',state}),p=f.page;
 try{
  for(const width of[1440,1024,390,360]){
   await p.setViewportSize({width,height:950});await settle(p);const mobile=width<=760,host=mobile?'#mobile-drawer-nav':'#desktop-nav';if(mobile)await drawer(p,true);
   for(const group of['documents','settlement']){
    await setGroup(p,host,group,false);const opening=moving(await traceGroup(p,host,group,true)),closing=moving(await traceGroup(p,host,group,false));
    const rapid=await rapidToggle(p,host,group);await focusRecovery(p,host,group);await setGroup(p,host,group,true);await ids(p);
    const geometry=await p.locator(host).evaluate(host=>{const r=host.getBoundingClientRect();return{viewport:innerWidth,page:document.documentElement.scrollWidth,x:r.x,right:r.right,font:getComputedStyle(host).fontFamily,compact:[...host.querySelectorAll('.snote-nav-label')].filter(e=>e.getBoundingClientRect().width<=2).length};});
    assert(geometry.page<=width+1&&geometry.x>=-1&&geometry.right<=width+1,JSON.stringify(geometry));assert.match(geometry.font,/Pretendard/);if(width===1024)assert(geometry.compact>0);
    record((group==='documents'?'서류함':'정산')+' animates real intermediate heights, reverses smoothly and fences collapsed focus '+width,{opening,closing,rapid,geometry});
   }
   await p.screenshot({path:path.join(OUT,'menu-'+width+'.png')});if(mobile)await drawer(p,false);
  }
  await p.setViewportSize({width:1440,height:950});await settle(p);await setGroup(p,'#desktop-nav','documents',true);
  await p.evaluate(()=>{const trigger=document.querySelector('#desktop-nav [data-accountant-group-toggle=documents]');window.__motion242OldChildren=document.getElementById(trigger.getAttribute('aria-controls'));trigger.click();navigate('acctBank');});
  await p.waitForFunction(()=>route==='acctBank');await settle(p);assert.equal(await p.evaluate(()=>__motion242OldChildren.isConnected),false);assert.equal(await p.evaluate(()=>__motion242OldChildren.getAnimations().filter(a=>a.playState==='running').length),0);finalGroup(await groupState(p,'#desktop-nav','documents'),false);
  await p.evaluate(()=>navigate('acctOperations'));await settle(p);finalGroup(await groupState(p,'#desktop-nav','documents'),true);assert.equal(await p.locator('#desktop-nav [data-page=acctOperations]').getAttribute('aria-current'),'page');await ids(p);
  record('route rerender cancels detached submenu motion and automatically expands the active document group');
  await logoutAndRelogin(f);record('ordinary logout cancels submenu motion and relogin rebuilds clean expanded groups without stale ARIA targets');
  await p.emulateMedia({reducedMotion:'reduce'});
  for(const width of[1440,390]){
   await p.setViewportSize({width,height:950});await settle(p);const host=width<=760?'#mobile-drawer-nav':'#desktop-nav';if(width<=760)await drawer(p,true);
   for(const group of['documents','settlement'])for(const open of[false,true,false]){if((await groupState(p,host,group)).expanded!==String(open))await p.locator(selector(host,group)).evaluate(e=>e.click());finalGroup(await groupState(p,host,group),open);}
   record('reduced-motion grouped menus reach the final hidden/ARIA/inert state immediately '+width);if(width<=760)await drawer(p,false);
  }
  noWrites(state);await f.finish();
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-menu.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function logoutAndRelogin(f){
 const p=f.page;await setGroup(p,'#desktop-nav','documents',true);
 await p.evaluate(()=>{const trigger=document.querySelector('#desktop-nav [data-accountant-group-toggle=documents]');window.__motion242BeforeLogout=document.getElementById(trigger.getAttribute('aria-controls'));trigger.click();window.__motion242Logout=zc86Cloud.signOut();});
 const dialog=p.locator('#snote-message-dialog[open][data-message-kind=confirm]');await dialog.waitFor();await dialog.locator('[data-message-accept]').click();await p.evaluate(()=>__motion242Logout);await p.waitForFunction(()=>!__normalState.ready&&currentUser===null);await p.waitForFunction(()=>!document.querySelector('dialog:modal')&&!__normalState.busy);
 assert.equal(await p.evaluate(()=>__motion242BeforeLogout.getAnimations().filter(a=>a.playState==='running').length),0);
 await p.locator('#zc-cloud-login').waitFor({state:'visible'});await p.locator('#snote95-remember').setChecked(true);await p.locator('#zc-cloud-password').fill(PASSWORD);await p.locator('#zc-cloud-email').click();await p.locator('#zc-cloud-email').fill('accountant@example.invalid');assert.equal(await p.locator('#zc-cloud-email').inputValue(),'accountant@example.invalid');await p.locator('#zc-cloud-submit').click();await f.ready();await p.waitForFunction(()=>!__normalState.busy);await settle(p);
 for(const group of['documents','settlement'])finalGroup(await groupState(p,'#desktop-nav',group),true);await ids(p);
}
const ORDER=['capital','inventory','cash','purchase','sale','profit','year','forecast'];
const EXPECTED={capital:'15,100,000원',inventory:'2,000,000원',cash:'13,100,000원',purchase:'3대',sale:'1대',profit:'900,000원',year:'1,100,000원',forecast:'2,600,000원'};
async function settlementState(p){return p.locator('.snote-home-settlement-toggle').evaluate(toggle=>{const content=document.getElementById(toggle.getAttribute('aria-controls')),icon=toggle.querySelector('.snote-home-settlement-chevron');return{expanded:toggle.getAttribute('aria-expanded'),hidden:content.hidden,inert:content.inert,ariaHidden:content.getAttribute('aria-hidden'),chevrons:toggle.querySelectorAll('.snote-home-settlement-chevron').length,svgs:toggle.querySelectorAll('svg').length,iconHidden:icon?.getAttribute('aria-hidden'),focusable:icon?.getAttribute('focusable'),iconWidth:icon?.getBoundingClientRect().width,iconHeight:icon?.getBoundingClientRect().height,rotation:icon?getComputedStyle(icon).transform:null,name:toggle.textContent.trim(),animations:content.getAnimations().filter(a=>a.playState==='running').length};});}
function settledDisclosure(state,open){assert.equal(state.expanded,String(open));assert.equal(state.hidden,!open);assert.equal(state.inert,!open);assert.equal(state.ariaHidden,String(!open));assert.equal(state.animations,0);assert.equal(state.name,'수익 정산');assert.equal(state.chevrons,1);assert.equal(state.svgs,1);assert.equal(state.iconHidden,'true');assert.equal(state.focusable,'false');assert(state.iconWidth>=10&&state.iconWidth<=14&&state.iconHeight>=10&&state.iconHeight<=14);}
async function settlementTrace(p){return p.evaluate(async()=>{const home=document.getElementById('snote-dashboard-home'),toggle=home.querySelector('.snote-home-settlement-toggle'),content=document.getElementById(toggle.getAttribute('aria-controls')),nodes=[...home.querySelectorAll('.snote-scheduler-calendar,.snote-scheduler-agenda,.snote-home-chart-group,.snote-home-settlement-heading')],measure=()=>nodes.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width};}),before=measure(),frames=[],heights=[];toggle.click();let start;await new Promise(resolve=>{function take(t){if(start===undefined)start=t;frames.push(measure());heights.push(content.getBoundingClientRect().height);if(t-start<390)requestAnimationFrame(take);else resolve();}requestAnimationFrame(take);});return{before,frames,heights};});}
function stableDisclosure(trace){let delta=0;for(const frame of trace.frames)for(let i=0;i<frame.length;i++)for(const axis of['x','y','width'])delta=Math.max(delta,Math.abs(frame[i][axis]-trace.before[i][axis]));assert(delta<1.2,'Disclosure moved another dashboard card anchor by '+delta);const min=Math.min(...trace.heights),max=Math.max(...trace.heights);assert(max-min>25&&trace.heights.some(h=>h>min+2&&h<max-2));return{frames:trace.frames.length,maxAnchorDelta:delta};}
async function settlement(browser){
 const state=backend(),f=await setup(browser,1440,{state}),p=f.page;
 try{
  await p.waitForFunction(()=>document.querySelector('[data-metric=profit] dd')?.textContent==='900,000원');await p.locator('#snote-dashboard-news[data-news-state=ready]').waitFor();await settle(p);
  const original=await p.evaluate(()=>JSON.stringify(cars));
  for(const width of[1440,390]){
   await p.setViewportSize({width,height:950});await settle(p);settledDisclosure(await settlementState(p),false);
   assert.deepEqual(await p.locator('.snote-home-settlement>[data-metric]').evaluateAll(rows=>rows.map(e=>e.dataset.metric)),ORDER);assert.deepEqual(await p.locator('.snote-home-settlement>[data-metric]').evaluateAll(rows=>Object.fromEntries(rows.map(e=>[e.dataset.metric,e.querySelector('dd').textContent]))),EXPECTED);
   const before=await settlementState(p),opening=stableDisclosure(await settlementTrace(p));await settle(p);const after=await settlementState(p);settledDisclosure(after,true);assert.notEqual(after.rotation,before.rotation);assert.equal(await p.getByRole('button',{name:'수익 정산',exact:true}).count(),1);
   await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(OUT,'settlement-'+width+'.png'),fullPage:true});const closing=stableDisclosure(await settlementTrace(p));await settle(p);settledDisclosure(await settlementState(p),false);assert.equal(await p.evaluate(()=>JSON.stringify(cars)),original);
   record('settlement shows purchase/sale counts before monthly/yearly profit with one small SVG and stable existing disclosure '+width,{order:ORDER,opening,closing,chevron:after});
  }
  await p.emulateMedia({reducedMotion:'reduce'});for(const open of[true,false]){await p.locator('.snote-home-settlement-toggle').evaluate(e=>e.click());settledDisclosure(await settlementState(p),open);}noWrites(state);record('reduced-motion settlement expands immediately without changing amounts or any stored data');await f.finish();
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-settlement.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
if(require.main===module)(async()=>{
 const before=sources();assert.equal(before['assets/snote-brand.png'].sha256,'6c236520a57ebf10acd1b07de57315fce9709c38093e4ab558a44c0543b048d8');assert.equal(before['assets/fonts/PretendardVariable.woff2'].sha256,'9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 try{const group=process.env.SNOTE_MENU_MOTION_V2242_GROUP;if(!group||group==='menus')await menuMotion(browser);if(!group||group==='settlement')await settlement(browser);assert.deepEqual(sources(),before,'Product files changed while the menu motion suite was running');fs.writeFileSync(path.join(OUT,group?'results-'+group+'.json':'results.json'),JSON.stringify({ok:true,version:'2.242',syntheticOnly:true,operatingReads:0,operatingWrites:0,naverRequests:0,checks,sourceHashes:before,testSha256:sha(fs.readFileSync(__filename)),limitations:['Synthetic backend and public-news responses only.','Chromium viewport emulation, not physical mobile devices.','Focused navigation/disclosure regression only; no unrelated full document or financial suite was repeated.']},null,2)+'\n');}
 finally{await browser.close();}
})().catch(error=>{fs.writeFileSync(path.join(OUT,'failure.txt'),error.stack||String(error));console.error(error.stack||error);process.exitCode=1;});
