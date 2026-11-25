'use strict';
// Real Auth/dashboard with synthetic records and intercepted requests only.
// Sample every animation frame: endpoint screenshots cannot detect a layout jump.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {boot,constants}=require('./dealer-scheduler.browser.cjs');
const {stateWithCars,ownRows}=require('./compact-dashboard.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_STABLE_KPI_ARTIFACT_DIR||'/workspace/work/dashboard-stable-v2230/qa';fs.mkdirSync(OUT,{recursive:true});
const HOME='#snote-dashboard-home',CAPITAL=HOME+' [data-kpi=capital]';
async function settle(page){await page.evaluate(async()=>{const home=document.querySelector('#snote-dashboard-home');await Promise.all(home.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function ready(page){await page.locator(HOME+'[data-state=ready]').waitFor();await page.evaluate(()=>document.fonts.ready);await settle(page);}
async function snapshot(page){return page.locator(HOME).evaluate(home=>({rows:JSON.stringify(snoteHomeDashboardBridge.snapshot()?.rows),amounts:[...home.querySelectorAll('.snote-home-kpi')].map(e=>({kind:e.dataset.kpi,text:e.querySelector('.snote-home-number').textContent})),calendar:home.querySelectorAll('[role=gridcell]').length}));}
async function frames(page,{expanded,rapid=false}={}){
 return page.evaluate(async({expanded,rapid})=>{
  const home=document.querySelector('#snote-dashboard-home'),grid=home.querySelector('.snote-home-kpis'),capital=home.querySelector('[data-kpi=capital]');
  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height,right:r.right,bottom:r.bottom+scrollY};};
  const selectors=['.snote-scheduler-calendar','.snote-scheduler-agenda-section','.snote-home-chart-group','.snote-home-settlement-card'];
  const nodes=selectors.flatMap(selector=>[...home.querySelectorAll(selector)].map((node,index)=>({key:selector+':'+index,node})));
  function frame(){return{time:performance.now(),scrollY,grid:rect(grid),capital:rect(capital),other:Object.fromEntries(nodes.map(({key,node})=>[key,rect(node)])),cards:[...grid.querySelectorAll('.snote-home-kpi')].filter(e=>!e.hidden&&Number(getComputedStyle(e).opacity)>.05).map(e=>({kind:e.dataset.kpi,...rect(e)}))};}
  const before=frame(),seen=[];let start;
  const done=new Promise(resolve=>{function sample(now){if(start===undefined)start=now;seen.push(frame());if(now-start<650)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample);});
  if(rapid){capital.click();capital.click();capital.click();}else if((capital.getAttribute('aria-expanded')==='true')!==expanded)capital.click();
  if(expanded&&!rapid)requestAnimationFrame(()=>requestAnimationFrame(()=>dispatchEvent(new Event('snote-fonts-enlarged'))));
  await done;return{before,frames:seen,expanded:capital.getAttribute('aria-expanded')==='true',refitDuringAnimation:expanded&&!rapid};
 },{expanded,rapid});
}
function stationary(trace,label){
 assert(trace.frames.length>2,label+' samples actual animation frames');
 let worst=0;
 for(const f of trace.frames){
  for(const key of ['y','height']){const delta=Math.abs(f.grid[key]-trace.before.grid[key]);worst=Math.max(worst,delta);assert(delta<1.1,label+' KPI reserved '+key+' changed by '+delta+'px');}
  for(const key of ['x','y'])assert(Math.abs(f.capital[key]-trace.before.capital[key])<1.1,label+' total-investment anchor '+key+' moved');
  assert(Math.abs(f.scrollY-trace.before.scrollY)<1.1,label+' scroll position jumped');
  for(const[key,before]of Object.entries(trace.before.other))for(const axis of ['x','y']){const delta=Math.abs(f.other[key][axis]-before[axis]);worst=Math.max(worst,delta);assert(delta<1.1,label+' '+key+' '+axis+' moved by '+delta+'px');}
  for(const card of f.cards){assert(card.y>=f.grid.y-1.1&&card.bottom<=f.grid.bottom+1.1,label+' animated '+card.kind+' stays inside its reserved band');for(const[key,box]of Object.entries(f.other)){const w=Math.min(card.right,box.right)-Math.max(card.x,box.x),h=Math.min(card.bottom,box.bottom)-Math.max(card.y,box.y);assert(w<=1.1||h<=1.1,label+' '+card.kind+' overlaps '+key);}}
 }
 return{frames:trace.frames.length,maxPositionDelta:worst,expanded:trace.expanded,gridHeight:trace.before.grid.height};
}
async function fit(page,expanded){const value=await page.locator(HOME).evaluate(home=>{const grid=home.querySelector('.snote-home-kpis'),r=grid.getBoundingClientRect();return{width:innerWidth,pageWidth:document.documentElement.scrollWidth,grid:{width:r.width,height:r.height},visible:[...grid.querySelectorAll('.snote-home-kpi')].filter(e=>!e.hidden).map(e=>{const r=e.getBoundingClientRect(),value=e.querySelector('.snote-home-kpi-value'),range=document.createRange();range.selectNodeContents(e.querySelector('.snote-home-number'));return{kind:e.dataset.kpi,left:r.left,right:r.right,amountWidth:value.clientWidth,amountScroll:value.scrollWidth,fragments:[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).length};})};});assert(value.pageWidth<=value.width+1,'No horizontal viewport overflow');assert.equal(value.visible.length,expanded?7:1);for(const card of value.visible){assert(card.left>=-1&&card.right<=value.width+1,'Visible card fits the viewport');assert(card.amountScroll<=card.amountWidth+1,'Amount fits the card');assert.equal(card.fragments,1,'Amount remains on one line');}return value;}
async function cycle(page,label){
 const original=await snapshot(page),checks=[];await fit(page,false);
 checks.push(stationary(await frames(page,{expanded:true}),label+' open'));await settle(page);await fit(page,true);assert.deepEqual(await snapshot(page),original);
 checks.push(stationary(await frames(page,{expanded:false}),label+' close'));await settle(page);await fit(page,false);
 checks.push(stationary(await frames(page,{rapid:true}),label+' rapid open'));await settle(page);await fit(page,true);
 checks.push(stationary(await frames(page,{rapid:true}),label+' rapid close'));await settle(page);await fit(page,false);assert.deepEqual(await snapshot(page),original);return checks;
}
async function check(browser,width,reduced=false){const state=stateWithCars();state.vehicleRows.set(constants.A,ownRows());const f=await boot(browser,state,width,'stable-kpi-'+width+(reduced?'-reduced':'')),p=f.page;try{
 if(reduced)await p.emulateMedia({reducedMotion:'reduce'});await ready(p);assert.equal(await p.locator(CAPITAL).getAttribute('aria-expanded'),'false');
 if(width<=760){await p.locator(CAPITAL).scrollIntoViewIfNeeded();await settle(p);}
 await p.screenshot({path:path.join(OUT,'collapsed-'+width+(reduced?'-reduced':'')+'.png'),fullPage:true});
 const writes=state.writes.length,checks=await cycle(p,String(width));
 await p.locator(CAPITAL).evaluate(e=>e.click());await settle(p);await p.screenshot({path:path.join(OUT,'expanded-'+width+(reduced?'-reduced':'')+'.png'),fullPage:true});
 assert.equal(await p.locator(HOME+' .snote-home-kpi:not([data-kpi=capital])').evaluateAll(es=>es.every(e=>!e.hidden&&!e.inert&&e.tabIndex===0)),true);
 await p.locator(CAPITAL).evaluate(e=>e.click());await settle(p);assert.equal(await p.locator(HOME+' .snote-home-kpi:not([data-kpi=capital])').evaluateAll(es=>es.every(e=>e.hidden&&e.inert&&e.tabIndex===-1)),true);assert.equal(state.writes.length,writes);
 if(reduced)assert.equal(await p.locator(HOME).evaluate(e=>e.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).length),0);
 return{width,reduced,checks,unchangedValues:true,operatingWrites:0};
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+(reduced?'-reduced':'')+'.png'),fullPage:true}).catch(()=>{});throw error;}finally{await f.finish();}}
async function resizeAndLongValues(browser){const state=stateWithCars();state.vehicleRows.set(constants.A,ownRows());const f=await boot(browser,state,1440,'stable-kpi-resize'),p=f.page;try{
 await ready(p);await p.evaluate(()=>{for(const c of cars)if(c.status!=='판매완료'){c.buy=1234567890123;c.sell=2345678901234;}dispatchEvent(new Event('snote:sales-data-changed'));});await ready(p);const checks=[];
 for(const width of[1440,1024,390]){await p.setViewportSize({width,height:950});await ready(p);await p.evaluate(()=>scrollTo(0,0));await settle(p);checks.push({width,checks:await cycle(p,'long '+width)});}
 await p.setViewportSize({width:1440,height:950});await ready(p);await p.locator(CAPITAL).evaluate(e=>e.click());await p.waitForTimeout(40);await p.setViewportSize({width:850,height:950});await ready(p);await fit(p,true);await p.locator(CAPITAL).evaluate(e=>e.click());await settle(p);await fit(p,false);checks.push({width:850,checks:await cycle(p,'resize during animation')});
 assert.equal(state.writes.length,0);return{longAmounts:true,resizeDuringAnimation:true,checks};
 }finally{await f.finish();}}
module.exports={check,resizeAndLongValues,stationary,frames};
if(require.main===module)(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];try{for(const width of[1440,1024,850,761,390,360]){results.push(await check(browser,width));console.log('PASS stable KPI band '+width);}results.push(await check(browser,390,true));console.log('PASS stable KPI reduced motion');results.push(await resizeAndLongValues(browser));console.log('PASS stable KPI resize and long amounts');fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingWrites:0,results},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
