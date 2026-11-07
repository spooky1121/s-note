'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');const {chromium}=require('./encar/node_modules/playwright');const {fixture,setBrowser}=require('./encar/browser-smoke.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of [1440,390,320]){
 const f=await fixture(width),p=f.page;
 await p.evaluate(()=>{ACC44_LENDER_LIMITS=[['KB캐피탈',150000,6],['JB우리금융',150000,12]];INVENTORY_LENDERS=ACC44_LENDER_LIMITS.map(x=>x[0]);const today=SnoteInventoryInterest.today(),date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-31);const c=cars[0];Object.assign(c,{purchaseAt:date.toISOString().slice(0,10),inventoryLoan:10000000,inventoryLender:'KB캐피탈'});renderVehicle();});
 await p.locator('#car-cost-section').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/snote-v242-inputs-'+width+'.png'});
 const interest=p.locator('#detail-inventory-interest');assert.equal(await interest.inputValue(),'50,959');assert.equal(await interest.evaluate(e=>e.readOnly),true);assert.match(await p.locator('#detail-interest-basis').textContent(),/연 6% · 31일 · 50,959원/);
 assert.equal(await p.evaluate(()=>normalizeCosts(cars[0]).inventoryInterest),50959);
 assert.equal(await p.evaluate(()=>Math.round(totals(cars[0].buy,cars[0].sell,normalizeCosts(cars[0])).margin)),1949041);
 await p.locator('#detail-inventory-loan').fill('20000000');assert.equal(await interest.inputValue(),'101,918');await p.locator('#detail-inventory-lender').selectOption('JB우리금융');assert.equal(await interest.inputValue(),'203,836');
 await p.locator('#detail-inventory-loan').fill('10000000');await p.locator('#detail-inventory-lender').selectOption('KB캐피탈');
 assert.equal(await p.locator('#car-cost-section .vehicle-section-unit').count(),0);assert.equal(await p.locator('#car-cost-section label').evaluateAll(es=>es.some(e=>e.childNodes[0]?.textContent.includes('(만원)'))),false);
 await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false}));await p.waitForFunction(()=>window.__encarFixtureCars[0].costs?.inventoryInterest===5.0959);
 assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].inventoryInterestSnapshot.amountWon),50959);
 await p.evaluate(()=>{closeVehicle({discard:true});cars[0].encarLinks={version:1,plate:cars[0].plate,verifiedAt:new Date().toISOString(),listings:[{id:'43000001',sellerUrl:'https://fem.encar.com/cars/detail/43000001'}]};cars[1].encarLinks={version:1,plate:'틀린번호',verifiedAt:new Date().toISOString(),listings:[{id:'43000002',sellerUrl:'https://fem.encar.com/cars/detail/43000002'}]};navigate('buy')});
 const table=p.locator('#list-screen table');const heads=await table.locator('thead th').evaluateAll(es=>es.map(e=>e.dataset.sortLabel||e.textContent));assert.equal(heads[heads.indexOf('경과일자')+1],'광고');assert.equal(await table.locator('tbody .snote-list-encar').count(),1);assert.equal(await p.evaluate(()=>snote202FinanceState(cars[0]).includes('재고')),false);
 const select=p.locator('#list-screen .status-select:visible').first(),selectBounds=await select.boundingBox();assert(selectBounds.width<=(width>=1024?86:120));assert(selectBounds.x>=0&&selectBounds.x+selectBounds.width<=width);
 const logo=p.locator('#list-screen .snote-list-encar:visible').first();await logo.waitFor();assert.equal(await logo.getAttribute('href'),'https://fem.encar.com/cars/detail/43000001');await logo.evaluate(e=>{e.addEventListener('click',event=>event.preventDefault());e.click()});assert.equal(await p.evaluate(()=>activeCarId),null);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.screenshot({path:'/tmp/snote-finance-v239-'+width+'.png'});assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpectedDialogs,[]);await f.context.close();console.log('PASS '+width+' daily won interest, loan/rate changes, all-cost profit, saved server ACK snapshot, field units, lender-only finance, narrow status, verified Encar after age and isolated click');
 }
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
