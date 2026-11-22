'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of [1440,390]){
  const f=await fixture(width),p=f.page;
  await p.evaluate(()=>{cars[0].purchaseAt='2026-11-10';cars[0].soldPrice=99000000;cars[0].soldAt='2026-11-01';persistCars(cars[0].ownerId);closeVehicle({discard:true});openVehicle(cars[0].id);changeVehicleStatus({stopPropagation(){},target:{value:'판매완료'}},cars[0].id,{fromDetail:true});});
  assert.equal(await p.locator('#confirm-sold-price').inputValue(),'','A previous sale/advertisement price must never become the current actual sale automatically');
  await p.locator('#status-confirm-submit').click();assert.notEqual(await p.evaluate(()=>cars[0].status),'판매완료');
  assert(f.notifications.some(n=>n.message.includes('직접 입력')));
  await p.locator('#confirm-sold-price').fill('25000000');await p.locator('#confirm-sold-date').fill('2026-11-09');await p.locator('#status-confirm-submit').click();
  assert.notEqual(await p.evaluate(()=>cars[0].status),'판매완료');assert(f.notifications.some(n=>n.message.includes('매입일')));
  await p.locator('#confirm-sold-date').fill('2026-11-22');await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>route==='sell');
  assert.equal(await p.evaluate(()=>cars[0].soldPrice),25000000);assert.equal(await p.evaluate(()=>cars[0].soldAt),'2026-11-22');assert.equal(await p.evaluate(()=>cars[0].purchaseAt),'2026-11-10');
  await p.evaluate(()=>{openVehicle(cars[0].id);});await p.locator('#detail-sold-price').fill('27000000');
  f.answerConfirm(false,/실제 판매가 27,000,000원으로 저장/);assert.equal(await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false})),false);assert.equal(await p.evaluate(()=>cars[0].soldPrice),25000000);
  f.answerConfirm(true,/실제 판매가 27,000,000원으로 저장/);assert.equal(await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false})),true);assert.equal(await p.evaluate(()=>cars[0].soldPrice),27000000);
  await p.evaluate(()=>{closeVehicle({discard:true});const c=cars[0];c.purchaseAt='legacy-date';c.soldAt='2026-02-30';c.soldPrice=undefined;const wire=cars.map(SnoteMoney.storeCar);window.__encarFixtureCars=structuredClone(wire);localStorage.setItem(carsStoreKey(c.ownerId),JSON.stringify(wire));openVehicle(c.id);});
  await p.locator('#detail-extra').fill('Historical sale facts must remain unchanged');
  assert.equal(await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false})),true);
  assert.deepEqual(await p.evaluate(()=>({purchaseAt:cars[0].purchaseAt,soldAt:cars[0].soldAt,soldPrice:cars[0].soldPrice,extra:cars[0].extra})),{purchaseAt:'legacy-date',soldAt:'2026-02-30',soldPrice:undefined,extra:'Historical sale facts must remain unchanged'});
  await p.locator('#detail-purchase-date').fill('2026-11-10');await p.locator('#detail-sold-date').fill('2026-11-22');await p.locator('#detail-sold-price').fill('28000000');
  await p.evaluate(()=>window.__encarFixtureWriteMode='fail');f.answerConfirm(true,/실제 판매가 28,000,000원으로 저장/);
  assert.equal(await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false})),false);
  assert.equal(await p.evaluate(()=>snoteVehicleDiscardPending()),true,'Failed unacknowledged edits must be able to restore their exact historical sale facts');
  assert.deepEqual(await p.evaluate(()=>({purchaseAt:cars[0].purchaseAt,soldAt:cars[0].soldAt,soldPrice:cars[0].soldPrice})),{purchaseAt:'legacy-date',soldAt:'2026-02-30',soldPrice:undefined});
  assert.equal(await p.evaluate(()=>{const c=cars[0],before={...c};c.soldPrice=20000000;const saved=persistCars(c.ownerId,{original:before,facts:snote184SaleFacts(before)});Object.assign(c,before);return saved;}),false,'Fabricated rollback options cannot bypass a new invalid sale');
  await finish(f);console.log('PASS '+width+' actual-sale typed confirmation, purchase date validation, save/cancel price edit and unchanged malformed historical fields');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
