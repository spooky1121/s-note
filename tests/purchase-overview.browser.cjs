'use strict';
// Actual index and Chromium; every network response, account and vehicle is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_PURCHASE_OVERVIEW_ARTIFACT_DIR||path.join(require('node:os').tmpdir(),'snote-purchase-overview');
const HOST='#snote-purchase-overview',SALES='#snote-sales-overview',CLOCK='2026-12-31T15:30:00.000Z';
const METRICS=['5대','+3대','+1대','12대'];
fs.mkdirSync(OUT,{recursive:true});
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const values=(p,host=HOST)=>p.locator(host+' .sales-overview-metric dd').allTextContents();
async function ready(p,expected=METRICS){await p.locator(HOST+'[data-state="ready"]').waitFor();await frames(p);assert.deepEqual(await values(p),expected);}
function rows(owner){
 const groups=[['2027-01-01',3],['2027-01-31',2],['2026-12-31',2],['2026-11-01',4],['2026-08-01',1],['2026-07-31',20],['2026-01-31',4],['2027-02-01',6],['2027-01',1],['2026-02-29',1],['',1]];
 return groups.flatMap(([purchaseAt,count])=>Array.from({length:count},(_,index)=>({id:'purchase-'+purchaseAt+'-'+index,ownerId:owner,purchaseAt,status:purchaseAt==='2027-01-01'?'판매완료':'판매중',soldAt:purchaseAt==='2027-01-01'?'2027-01-02':null,model:'가상 매입 차량 '+purchaseAt,plate:'000가'+String(1000+index),year:2026,km:'10,000',buy:10000000,sell:12000000,moneyUnit:'KRW',costs:{}})));
}
async function geometry(p,width,host=HOST){
 const g=await p.locator(host).evaluate(host=>{
  const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const style=getComputedStyle(host),points=[...host.querySelectorAll('.sales-overview-month')],summary=host.querySelector('.sales-overview-metrics'),chart=host.querySelector('.sales-overview-chart');
  return{host:box(host),overflow:host.scrollWidth>host.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth,summary:box(summary),chart:box(chart),rows:new Set(points.map(e=>Math.round(e.getBoundingClientRect().top))).size,metricRows:new Set([...summary.children].map(e=>Math.round(e.getBoundingClientRect().top))).size,divider:getComputedStyle(chart).borderLeftWidth,padding:style.padding,border:style.border,borderRadius:style.borderRadius,background:style.backgroundColor};
 });
 assert.equal(g.overflow,false,JSON.stringify(g));assert.equal(g.pageOverflow,false,JSON.stringify(g));assert.equal(g.rows,1);assert.equal(g.metricRows,width<=760?4:2);assert(g.summary.right<g.chart.x,'The compact metrics must sit left of the chart');assert(g.summary.width<g.chart.width);assert.equal(g.divider,'1px');assert(g.host.height<(width<=760?285:255),JSON.stringify(g));
 return g;
}
async function tooltipAndNoAction(p){
 const point=p.locator(HOST+' [data-month="2026-11"]');
 const state=()=>p.evaluate(()=>({route,query:$('list-query').value,filter:$('list-filter').value,page:document.querySelector('#list-pagination [aria-current="page"]')?.textContent||'',salesMonth:snote226ActiveSalesMonth(),url:location.href,ids:getFiltered('list').map(car=>car.id)}));
 const before=await state(),bounds=await point.boundingBox();
 assert.equal(await point.evaluate(e=>e.tagName),'SPAN');assert.equal(await point.getAttribute('role'),'img');assert.equal(await point.getAttribute('tabindex'),'0');assert.equal(await p.locator(HOST+' button,'+HOST+' a').count(),0);
 await point.hover();await p.locator('#snote-icon-tooltip:not([hidden])').waitFor();assert.match(await p.locator('#snote-icon-tooltip').textContent(),/2026년 11월 · 4대 매입/);
 const hover=await point.boundingBox();assert(Math.abs(bounds.y-hover.y)<.5,'Hover help must not lift the graph points away from their line');
 await p.mouse.move(0,0);await p.keyboard.press('Tab');await point.focus();await p.locator('#snote-icon-tooltip:not([hidden])').waitFor();assert.match(await p.locator('#snote-icon-tooltip').textContent(),/4대 매입/);
 await p.keyboard.press('Escape');await point.press('Enter');await point.press('Space');await point.click();await frames(p);assert.deepEqual(await state(),before,'Read-only graph points must not filter or navigate the vehicle list');
 const warning=p.locator(HOST+' .sales-overview-undated');assert.equal(await warning.textContent(),'매입일 확인 3대');await warning.hover();await p.locator('#snote-icon-tooltip:not([hidden])').waitFor();assert.match(await p.locator('#snote-icon-tooltip').textContent(),/매입일이 없거나 올바르지 않은 차량은 월별 집계에서 제외/);await p.mouse.move(0,0);
}
async function check(width){
 const f=await fixture(width),p=f.page,report={width};
 try{
  await p.clock.install({time:new Date(CLOCK)});
  const owner=await p.evaluate(async()=>{await closeVehicle({discard:true});window.__purchaseActor=__encarFixtureState.user.id;window.__purchaseOwner=currentUser.username;return currentUser.username;});
  const source=rows(owner),foreign='cld_222222222222422282';
  source.push(...Array.from({length:9},(_,index)=>({...source[0],id:'foreign-'+index,ownerId:foreign,shared:index%2===0,shareState:index%2===0?'accepted':'pending',model:'다른 계정 공유·비공개 차량'})));
  await p.evaluate(source=>{cars=structuredClone(source);window.__purchaseRows=structuredClone(source);window.__purchaseBefore=JSON.stringify(cars);window.__purchaseStorage=Object.fromEntries(Object.entries(localStorage));window.__purchaseWrites=__encarFixtureWrites.length;navigate('buy');},source);
  await ready(p);assert.equal(await p.locator(HOST+' h2').textContent(),'매입 현황');assert.match(await p.locator(HOST).textContent(),/전월 2대 · \+150%/);assert.match(await p.locator(HOST).textContent(),/전년 동월 4대 · \+25%/);assert.match(await p.locator(HOST).textContent(),/2026\.08 — 2027\.01/);
  assert.deepEqual(await p.locator(HOST+' .sales-overview-month').evaluateAll(items=>items.map(item=>[item.dataset.month,item.dataset.count])),[['2026-08','1'],['2026-09','0'],['2026-10','0'],['2026-11','4'],['2026-12','2'],['2027-01','5']]);
  const line=await p.locator(HOST+' polyline').getAttribute('points');assert.deepEqual(line.split(' ').map(point=>point.split(',').map(Number)),[[50,71.2],[150,84],[250,84],[350,32.8],[450,58.4],[550,20]]);
  const snapshot=await p.evaluate(()=>snotePurchaseOverviewBridge.snapshot());assert.equal(snapshot.month,'2027-01','Korean midnight must anchor the January reporting period');assert.equal(snapshot.cars.length,45);assert(snapshot.cars.every(car=>JSON.stringify(Object.keys(car))==='["purchaseAt"]'),'The renderer must receive only the dates needed for aggregation');
  report.purchase=await geometry(p,width);await p.locator(HOST).scrollIntoViewIfNeeded();await p.screenshot({path:path.join(OUT,'purchase-'+width+'.png')});
  assert.equal(await p.locator('#list-pagination [aria-label="2페이지"]').count(),1);await p.locator('#list-pagination [aria-label="2페이지"]').click();await ready(p);assert.equal(await p.locator('#list-pagination [aria-current="page"]').textContent(),'2');
  await p.locator('#list-query').fill('없는 가상 검색');await ready(p);assert.equal(await p.evaluate(()=>getFiltered('list').length),0);await p.locator('#list-query').fill('');
  await p.evaluate(()=>{$('list-filter').value='판매완료';renderCars();});await ready(p);assert.equal(await p.evaluate(()=>getFiltered('list').length),0);await p.evaluate(()=>{$('list-filter').value='all';renderCars();});await ready(p);
  await tooltipAndNoAction(p);assert.equal(await p.evaluate(()=>JSON.stringify(cars)===__purchaseBefore),true);assert.equal(await p.evaluate(()=>Object.entries(__purchaseStorage).every(([key,value])=>localStorage.getItem(key)===value)),true);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length===__purchaseWrites),true);
  await p.evaluate(()=>navigate('sell'));assert.equal(await p.locator(HOST).isVisible(),false);assert.equal(await p.locator(HOST).textContent(),'');await p.locator(SALES+'[data-state="ready"]').waitFor();assert.deepEqual(await values(p,SALES),['3대','+3대','+3대','3대']);report.sales=await geometry(p,width,SALES);
  for(const key of ['padding','border','borderRadius','background'])assert.equal(report.purchase[key],report.sales[key],'Purchase and sales cards must share '+key);
  const saleMonth=p.locator(SALES+' [data-month="2026-11"]');assert.equal(await saleMonth.evaluate(e=>e.tagName),'BUTTON');await saleMonth.focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#snote-sales-month').inputValue(),'2026-11','Existing sales month selection must remain functional');
  await p.evaluate(()=>navigate('buy'));await ready(p);assert.equal(await p.locator(SALES).isVisible(),false);
  for(const role of ['admin','accountant']){
   await p.evaluate(({role,foreign})=>{currentUser.role=role;__encarFixtureState.members[0].role=role;document.body.classList.toggle('accountant-mode',role==='accountant');buildMenus();navigate('buy');const select=$('accountant-dealer-filter');if(![...select.options].some(option=>option.value===foreign))select.add(new Option('다른 담당자',foreign));select.value=foreign;renderCars();},{role,foreign});
   await ready(p);assert.equal(await p.locator('#accountant-bar').isVisible(),false);assert.equal(await p.evaluate(()=>snotePurchaseOverviewBridge.snapshot().cars.length),45,'Buy reporting must stay own-only even for a manager with a stale foreign dealer filter');
  }
  await p.evaluate(()=>{currentUser.role='admin';__encarFixtureState.members[0].role='admin';document.body.classList.remove('accountant-mode');buildMenus();window.__purchaseEnsureCompany=snoteEnsureCompanyPurchase;window.snoteEnsureCompanyPurchase=()=>false;navigate('companyBuy');});assert.equal(await p.locator(HOST).isVisible(),false);assert.equal(await p.locator(HOST).textContent(),'');
  await p.evaluate(()=>{navigate('buy');window.snoteEnsureCompanyPurchase=__purchaseEnsureCompany;currentUser.role='dealer';__encarFixtureState.members[0].role='dealer';$('accountant-dealer-filter').value='all';buildMenus();renderCars();});await ready(p);
  await p.evaluate(()=>{__encarFixtureState.loading=true;window.dispatchEvent(new Event('snote:sales-data-changed'));});await p.locator(HOST+'[data-state="loading"]').waitFor();assert.equal(await p.locator(HOST+' .sales-overview-metric').count(),0);assert.equal(await p.evaluate(()=>snotePurchaseOverviewBridge.snapshot().cars.length),0);
  await p.evaluate(()=>{__encarFixtureState.loading=false;window.dispatchEvent(new Event('snote:sales-data-changed'));});await ready(p);
  await p.evaluate(()=>{__encarFixtureState.user.id='99999999-9999-4999-8999-999999999999';});await p.locator(HOST+'[data-state="loading"]').waitFor();assert.equal(await p.locator(HOST+' .sales-overview-month').count(),0,'The identity watchdog must clear the prior account without a render event');
  await p.evaluate(()=>{__encarFixtureState.user.id=__purchaseActor;window.dispatchEvent(new Event('snote:sales-data-changed'));});await ready(p);
  await p.evaluate(()=>{window.__purchaseCurrent=snotePurchaseOverviewBridge.current;snotePurchaseOverviewBridge.current=()=>undefined;window.dispatchEvent(new Event('snote:sales-data-changed'));});await p.locator(HOST+'[data-state="loading"]').waitFor();assert.equal(await p.locator(HOST+' .sales-overview-metric').count(),0);await p.evaluate(()=>{snotePurchaseOverviewBridge.current=__purchaseCurrent;window.dispatchEvent(new Event('snote:sales-data-changed'));});await ready(p);
  await p.evaluate(()=>{window.__purchaseOldKey=snotePurchaseOverviewBridge.snapshot().key;snoteNavigationSession='purchase-test-new-session';cars=[];renderCars();});await ready(p,['0대','0대','0대','0대']);assert.equal(await p.locator(HOST+' .sales-overview-month[data-count="0"]').count(),6);assert.equal(await p.locator(HOST+' .sales-overview-undated').count(),0);assert.notEqual(await p.evaluate(()=>snotePurchaseOverviewBridge.snapshot().key),await p.evaluate(()=>__purchaseOldKey));
  assert.doesNotMatch(await p.locator(HOST).textContent(),/Infinity|NaN|100%/);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length===__purchaseWrites),true);
  await p.evaluate(()=>{cars=structuredClone(__purchaseRows);renderCars();});await ready(p);await p.screenshot({path:path.join(OUT,'purchase-final-'+width+'.png')});
  report.checks=['KST reporting month','own inventory and completed purchase history','foreign/shared owner exclusion','previous month/year and six-point line','invalid and missing purchase dates','search/status/page independent totals','keyboard and hover help without filtering/navigation','immutable rows/storage and no dataset writes','same sales card geometry and existing sales month action','admin/accountant own scope and ignored hidden dealer filter','company page exclusion','loading/auth/current-key fail-closed clearing','empty new-session counts'];
  await finish(f);console.log('PASS '+width+' purchase counts/scopes, compact shared geometry, read-only tooltips, old sales behavior and identity clearing');return report;
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];try{for(const width of [1440,1024,390,320])results.push(await check(width));const sourceHashes=Object.fromEntries(['index.html','assets/sales-overview.js','assets/sales-overview.css','assets/purchase-overview.js','tests/purchase-overview.browser.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),browser:await browser.version(),sourceHashes,results},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
