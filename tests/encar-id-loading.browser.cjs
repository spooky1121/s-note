'use strict';
// Actual application + native Chromium tabs; all identity, data and responses are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const{install,clean,confirm,closePopup,pending,found,dialog,idText}=require('./encar-id.browser.cjs');
const OUT=process.env.ENCAR_LOADING_ARTIFACT_DIR||'/workspace/work/encar-ad-tab-ui/loading';fs.mkdirSync(OUT,{recursive:true});
async function run(width){const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;let state;try{
 state=await install(f);const button=p.locator('#vehicle-encar-check'),modal=dialog(p),loader=modal.locator('[data-encar-id-loading]'),status=modal.locator('[role="status"]');
 const active=async(body=found())=>{const popup=await pending(f,state,button,body);await loader.waitFor({state:'visible'});assert.equal(await loader.getAttribute('aria-hidden'),'true');assert.equal(await modal.getAttribute('aria-busy'),'true');assert.match(await popup.locator('body').innerText(),/엔카|광고|검색/);return popup;};
 const stopped=async()=>{await loader.waitFor({state:'hidden'});assert.equal(await modal.getAttribute('aria-busy'),null);};
 const first=await active();assert.equal(await loader.locator('.snote-encar-id-scan-lens').evaluate(e=>getComputedStyle(e).animationName),'snote-encar-search');assert.equal(await loader.locator('.snote-encar-id-loading-dots span').count(),3);assert.match(await status.innerText(),/찾고 있습니다|검색/);await p.screenshot({path:path.join(OUT,'searching-'+width+'.png')});
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await loader.locator('.snote-encar-id-scan-lens').evaluate(e=>getComputedStyle(e).animationName),'none');await p.screenshot({path:path.join(OUT,'searching-reduced-'+width+'.png')});await p.emulateMedia({reducedMotion:'no-preference'});
 state.held.shift()();await first.waitForURL('https://fem.encar.com/cars/detail/43123456');await modal.waitFor({state:'hidden'});await stopped();assert.equal(await first.evaluate(()=>window.opener===null),true);await first.close();await clean(f,state);
 const limited=await active({ok:false,code:'UPSTREAM_RATE_LIMITED'});state.held.shift()();await closePopup(limited);await status.filter({hasText:'검색 브라우저의 실행 요청'}).waitFor();await stopped();await confirm(p);
 const cancelled=await active();await confirm(p);await closePopup(cancelled);await stopped();state.held.shift()();await p.waitForTimeout(50);
 await p.evaluate(()=>{const original=window.setTimeout;window.__fastEncarDeadline=true;window.setTimeout=(fn,ms,...args)=>original(fn,window.__fastEncarDeadline&&(ms===55000||ms===60000)?120:ms,...args);});
 const timedOut=await active();await closePopup(timedOut);await status.filter({hasText:'시간이 초과'}).waitFor();await stopped();await p.evaluate(()=>window.__fastEncarDeadline=false);state.held.shift()();await confirm(p);
 const stale=await active();await p.evaluate(()=>{__encarFixtureState.user={id:'99999999-9999-4999-8999-999999999999'};currentUser={...currentUser,username:'other-synthetic-account'};});await modal.waitFor({state:'hidden'});await closePopup(stale);await stopped();state.held.shift()();await p.waitForTimeout(50);
 assert.equal(await idText(p),'');assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(state.requests.length,5);console.log('PASS Encar tab/loading',width,'native reserved tab, success/rate/close/timeout/account-change + reduced-motion');return{width,requests:state.requests.length,pass:true};
 }finally{state?.held.splice(0).forEach(resolve=>resolve());await finish(f);}}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{const results=[];for(const width of[1440,390])results.push(await run(width));fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,liveProviderVerified:false,results},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
