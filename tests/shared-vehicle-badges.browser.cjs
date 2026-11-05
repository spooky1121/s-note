'use strict';
// Actual application/DOM, isolated auth/HTTP fixture. No production sharing is created.
const assert=require('node:assert/strict');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);try{
for(const width of[1440,390,320]){const f=await fixture(width),p=f.page;
 await p.evaluate(()=>{const base=window.snoteVehicleShareBridge;window.__sharedBadgeTest={context:'shared-badge-account-a',calls:0,items:[{ownerId:window.__encarFixtureState.user.id,carId:'encar-car-1'}],fail:false};window.snoteVehicleShareBridge={...base,badgeContext:()=>__sharedBadgeTest.context?{key:__sharedBadgeTest.context}:null,badgeCurrent:c=>!!c&&c.key===__sharedBadgeTest.context,badges:async c=>{__sharedBadgeTest.calls++;if(__sharedBadgeTest.fail)throw Error('fixture unavailable');return structuredClone(__sharedBadgeTest.items);},owner:base.owner.bind(base)};});
 // Root normally connects these two static assets in index.html. Explicit injection
 // keeps this test usable while the containing page is being updated in parallel.
 if(!await p.evaluate(()=>window.snoteSharedVehicleBadges))await p.addScriptTag({content:fs.readFileSync(path.resolve(__dirname,'../assets/shared-vehicle-badges.js'),'utf8')});
 if(!await p.locator('link[href*="shared-vehicle-badges.css"]').count())await p.addStyleTag({content:fs.readFileSync(path.resolve(__dirname,'../assets/shared-vehicle-badges.css'),'utf8')});
 await p.evaluate(()=>{renderCars();window.snoteRefreshSharedVehicleBadges();});
 const row1=p.locator('#list-table .vehicle-clickable[onclick="openVehicle(\'encar-car-1\')"]'),row2=p.locator('#list-table .vehicle-clickable[onclick="openVehicle(\'encar-car-2\')"]');
 await row1.locator('.snote-shared-vehicle-badge').waitFor({state:'attached'});assert.equal(await row2.locator('.snote-shared-vehicle-badge').count(),0);
 assert.equal(await p.locator('#list-mobile [onclick="openVehicle(\'encar-car-1\')"] .snote-shared-vehicle-badge').count(),1);assert.equal(await p.locator('#list-mobile [onclick="openVehicle(\'encar-car-2\')"] .snote-shared-vehicle-badge').count(),0);
 await p.evaluate(()=>{currentUser.role='accountant';renderCars();});await p.locator('#list-table .acct-car-cell .snote-shared-vehicle-badge').waitFor({state:'attached'});assert.equal(await p.locator('#list-mobile .acct-mobile-heading .snote-shared-vehicle-badge').count(),1);await p.evaluate(()=>{currentUser.role='dealer';renderCars();});const badge=p.locator('#vehicle-title>.snote-shared-vehicle-badge');await badge.waitFor({state:'attached'});assert.equal(await badge.evaluate(e=>getComputedStyle(e).color),'rgb(49, 92, 245)');assert.equal(await badge.locator('svg circle').count(),3);assert.equal(await badge.locator('svg').getAttribute('aria-hidden'),'true');
 await p.evaluate(()=>{renderVehicle();});await badge.waitFor({state:'attached'});assert.equal(await p.locator('#vehicle-title>.snote-shared-vehicle-badge').count(),1,'Rerender restores a single shared mark beside the model');
 await p.evaluate(()=>openVehicle('encar-car-2'));await p.waitForFunction(()=>!document.querySelector('#vehicle-title>.snote-shared-vehicle-badge'));
 await p.evaluate(()=>{closeVehicle({discard:true});const strong=document.createElement('strong');strong.textContent='가상 공유받은 차량';const button=document.createElement('button');button.className='vehicle-sharing-car';button.append(strong);document.querySelector('#snote-vehicle-sharing main').append(button);});await p.locator('.vehicle-sharing-car strong>.snote-shared-vehicle-badge').waitFor({state:'attached'});
 // Sold cars continue using the same scoped owner/card mapping.
 await p.evaluate(()=>{cars[0].status='판매완료';cars[0].soldAt=todayLocal();cars[0].soldPrice=12345678;navigate('sell');});await p.locator('#list-table .snote-shared-vehicle-badge').waitFor({state:'attached'});assert.equal(await p.locator('#list-mobile .snote-shared-vehicle-badge').count(),1);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.screenshot({path:'/tmp/snote-v263-shared-badge-'+width+'.png'});
 const calls=await p.evaluate(()=>__sharedBadgeTest.calls);await p.evaluate(()=>{for(let i=0;i<3;i++)renderCars();});await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>__sharedBadgeTest.calls),calls,'DOM rerenders must not query once per row');
 await p.evaluate(async()=>{__sharedBadgeTest.context='shared-badge-account-b';__sharedBadgeTest.items=[];renderCars();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});assert.equal(await p.locator('#list-table .snote-shared-vehicle-badge').count(),0,'A new context rerender must not use the previous account cache before its polling timer');await p.evaluate(()=>{__sharedBadgeTest.context='shared-badge-account-a';window.snoteRefreshSharedVehicleBadges();});await p.evaluate(()=>{__sharedBadgeTest.items=[];window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));});await p.waitForFunction(()=>!document.querySelector('#list-table .snote-shared-vehicle-badge'));assert.equal(await p.locator('#list-mobile .snote-shared-vehicle-badge').count(),0);
 await p.evaluate(()=>{__sharedBadgeTest.items=[{ownerId:__encarFixtureState.user.id,carId:'encar-car-1'}];window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));});await p.locator('#list-table .snote-shared-vehicle-badge').waitFor({state:'attached'});
 await p.evaluate(()=>{__sharedBadgeTest.fail=true;window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));});await p.waitForFunction(()=>!document.querySelector('#list-table .snote-shared-vehicle-badge'));
 await p.evaluate(()=>{__sharedBadgeTest.fail=false;__sharedBadgeTest.items=[{ownerId:__encarFixtureState.user.id,carId:'encar-car-1'}];window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));});await p.locator('#list-table .snote-shared-vehicle-badge').waitFor({state:'attached'});
 await p.evaluate(()=>__sharedBadgeTest.context=null);await p.waitForFunction(()=>!document.querySelector('.snote-shared-vehicle-badge'));
 await finish(f);console.log('PASS',width,'scoped shared-only blue people/arrows/check mark in desktop/mobile/sold lists and detail, inbox marker, no repeat query on rerender, revoke/failure/account clearing');
}
}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1});
