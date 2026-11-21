'use strict';
// Actual app and scoped cloud-write bridge; synthetic vehicles and HTTP only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.CONTRACT_STATUS_ARTIFACT_DIR||'/workspace/work/contract-status-v2144';
fs.mkdirSync(OUT,{recursive:true});
const ID='encar-car-1',PLATE='12가3456';
const status=p=>p.locator('#list-screen select.status-select[aria-label="'+PLATE+' 차량 상태 변경"]:visible');
const current=p=>p.evaluate(id=>{const c=cars.find(c=>c.id===id);return {route,status:c.status,soldAt:c.soldAt??null,soldPrice:c.soldPrice??null,ids:getFiltered('list').map(c=>c.id)};},ID);
async function red(locator){const color=await locator.evaluate(e=>getComputedStyle(e).color),[r,g,b]=color.match(/[\d.]+/g).map(Number);assert(r>140&&r>g*1.4&&r>b*1.15,'Contract status must have readable red text: '+color);return color;}
async function buy(p){await p.evaluate(async()=>{await closeVehicle({discard:true});navigate('buy');});if(await p.locator('#list-screen').getAttribute('data-vehicle-view')!=='list'){await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='list');}await status(p).waitFor();}
async function propose(p,next){await status(p).selectOption(next);await p.locator('#status-overlay.open').waitFor();assert.equal(await p.locator('#status-target').innerText(),next);}
async function filter(p,value){const control=p.locator('#list-filter');if(await control.isVisible())return control.selectOption(value);await control.evaluate((e,value)=>{e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function flush(p){const result=await p.evaluate(()=>zc86Cloud.flush());assert.equal(result.ok,true,'Status changes must be acknowledged by the real scoped cloud-write bridge');return p.evaluate(()=>structuredClone(__encarFixtureCars));}
async function pendingVisible(p){const state=await current(p);assert.equal(state.route,'buy');assert.equal(state.status,'계약중');assert.equal(state.soldAt,null);assert.equal(state.soldPrice,null);assert(state.ids.includes(ID));assert.equal(state.ids.length,2,'Contracting only changes its label; the existing purchase inventory count remains');assert.equal(await status(p).inputValue(),'계약중');return state;}
async function run(width){
 const f=await fixture(width),p=f.page,report={width};let stored;
 try{
  await buy(p);const before=await current(p);assert.equal(before.status,'판매중');
  assert((await status(p).locator('option').allTextContents()).includes('계약중'));
  const values=await p.evaluate(()=>cars.map(c=>({id:c.id,model:c.model,plate:c.plate,buy:c.buy,sell:c.sell,ownerId:c.ownerId})));
  await propose(p,'계약중');report.modalRed=await red(p.locator('#status-target .status'));assert.equal(await p.locator('#confirm-sale-fields').isVisible(),false);await p.locator('#status-confirm-no').click();assert.deepEqual(await current(p),before);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);
  // The purchase screen may hide its legacy state filter. Retained filter state
  // must still be cleared if it would make the just-updated vehicle disappear.
  report.legacyFilterHidden=!await p.locator('#list-filter').isVisible();await filter(p,'판매중');await propose(p,'계약중');await p.locator('#status-confirm-submit').click();await p.locator('#status-overlay').waitFor({state:'hidden'});assert.equal(await p.locator('#list-filter').inputValue(),'all','A successful contract transition must clear a restrictive on-sale filter so this vehicle stays visible');await pendingVisible(p);report.listRed=await red(status(p));
  assert.deepEqual(await p.evaluate(()=>cars.map(c=>({id:c.id,model:c.model,plate:c.plate,buy:c.buy,sell:c.sell,ownerId:c.ownerId}))),values,'A status-only action must not rewrite vehicle identity, prices or owner');
  stored=await flush(p);assert.equal(stored.find(c=>c.id===ID).status,'계약중');assert.equal(stored.find(c=>c.id==='encar-car-2').status,'판매중');report.ackRevision=await p.evaluate(()=>__encarFixtureRevision);
  await p.screenshot({path:path.join(OUT,'contract-list-'+width+'.png')});
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');await pendingVisible(p);report.cardRed=await red(status(p));assert.equal(await p.locator('#list-mobile .vehicle-card').count(),2);await p.screenshot({path:path.join(OUT,'contract-cards-'+width+'.png')});
  await p.locator('#snote-vehicle-view-switch').click();await pendingVisible(p);
  if(await p.locator('#list-filter option[value="계약중"]').count()){await filter(p,'계약중');assert.deepEqual((await current(p)).ids,[ID]);await filter(p,'all');await pendingVisible(p);report.contractFilter=true;}
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});throw error;}finally{await finish(f);}
 const restored=await fixture(width,stored),q=restored.page;
 try{
  await buy(q);await pendingVisible(q);report.restoredRed=await red(status(q));assert.equal(await q.evaluate(()=>__encarFixtureWrites.length),0,'Opening a persisted contract must not silently normalize it into another status');
  await propose(q,'판매완료');assert.equal(await q.locator('#confirm-sale-fields').isVisible(),true);await q.locator('#confirm-sold-price').fill('');await q.locator('#status-confirm-submit').click();assert.equal(await q.locator('#status-overlay.open').count(),1);assert.equal((await current(q)).status,'계약중');assert.equal(await q.evaluate(()=>__encarFixtureWrites.length),0,'Contract status does not bypass sold-price validation');await q.locator('#status-confirm-no').click();await pendingVisible(q);
  await propose(q,'판매중');await q.locator('#status-confirm-submit').click();await q.locator('#status-overlay').waitFor({state:'hidden'});const reverted=await current(q);assert.equal(reverted.route,'buy');assert.equal(reverted.status,'판매중');assert.equal(reverted.ids.length,2);assert.equal((await flush(q)).find(c=>c.id===ID).status,'판매중');
  const blocked=await q.evaluate(id=>{const c=cars.find(c=>c.id===id);c.status='판매완료';c.soldAt=todayLocal();c.soldPrice=c.sell;navigate('sell');const writes=__encarFixtureWrites.length;changeVehicleStatus({stopPropagation(){},target:{value:'계약중'}},id);return{status:c.status,pending:pendingStatusChange,modal:document.getElementById('status-overlay').classList.contains('open'),writes:__encarFixtureWrites.length===writes,options:statusSelect(c)};},ID);assert.equal(blocked.status,'판매완료');assert.equal(blocked.pending,null);assert.equal(blocked.modal,false);assert.equal(blocked.writes,true);assert(!blocked.options.includes('value="계약중"'),'Sold vehicles cannot enter contract mode through this purchase-only action');
  assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.pass=true;
 }finally{await finish(restored);}
 console.log('PASS',width,'red contract option, confirmation cancel/save, unchanged purchase membership/prices/owner, list/cards, acknowledged wire and clean-browser restore, sold-price validation and revert');return report;
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{const reports=[];for(const width of[1440,390])reports.push(await run(width));fs.writeFileSync(path.join(OUT,'browser-results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,reports},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
