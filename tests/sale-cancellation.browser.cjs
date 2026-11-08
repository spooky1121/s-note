'use strict';
const assert=require('node:assert/strict');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
async function cancellationFixture(width=1440){
 const f=await fixture(width);await f.page.evaluate(async()=>{
  closeVehicle({discard:true});const car=cars.find(c=>c.id==='encar-car-1');car.status='판매완료';car.soldAt=todayLocal();car.soldPrice=25000000;
  persistCars(car.ownerId);if(!(await window.zc86Cloud.flush()).ok)throw Error('Synthetic setup save failed');
  navigate('sell');changeVehicleStatus({stopPropagation(){},target:{value:'판매취소'}},car.id);
 });return f;
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of [1440,390,320]){
  const f=await cancellationFixture(width),p=f.page,before=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));
  await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator('#status-confirm-submit').click();
  await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);assert.equal(await p.evaluate(()=>route),'sell');assert.equal(await p.locator('#status-confirm-submit').isDisabled(),true);assert.equal(await p.locator('#status-overlay').getAttribute('aria-hidden'),'false');
  await p.evaluate(()=>{confirmStatusChange();closeStatusModal();});assert.equal(await p.locator('#status-overlay').getAttribute('aria-hidden'),'false');
  assert.deepEqual(await p.evaluate(()=>structuredClone(window.__encarFixtureCars)),before);
  await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>route==='buy');
  const expected=structuredClone(before);expected[0].status='판매중';delete expected[0].soldAt;delete expected[0].soldPrice;
  assert.deepEqual(await p.evaluate(()=>structuredClone(window.__encarFixtureCars)),expected);assert.equal(await p.locator('#status-overlay').getAttribute('aria-hidden'),'true');await finish(f);
  console.log('PASS',width,'sale cancellation waits for server confirmation and preserves unrelated records');
 }
 for(const mode of ['fail','lost-response']){
  const f=await cancellationFixture(),p=f.page,initialWrites=await p.evaluate(()=>window.__encarFixtureWrites.length);
  await p.evaluate(value=>window.__encarFixtureWriteMode=value,mode);await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0&&!document.querySelector('#status-confirm-submit').disabled);
  assert.equal(await p.evaluate(()=>route),'sell');assert.equal(await p.locator('#status-overlay').getAttribute('aria-hidden'),'false');
  await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>route==='buy');
  assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),initialWrites+1);assert.equal(await p.evaluate(()=>window.__encarFixtureState.conflict),false);await finish(f);
  console.log('PASS cancellation',mode,'retry succeeds without a duplicate commit or false conflict');
 }
 {const f=await cancellationFixture(),p=f.page;await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);await p.evaluate(()=>navigate('cars'));await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!window.__encarFixtureState.saving);assert.equal(await p.evaluate(()=>route),'cars');await finish(f);console.log('PASS late cancellation ACK cannot redirect newer navigation');}
 }finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
