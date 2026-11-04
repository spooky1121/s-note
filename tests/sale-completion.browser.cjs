'use strict';const assert=require('node:assert/strict');const{chromium}=require('./encar/node_modules/playwright');const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of[1440,390,320]){
  const f=await fixture(width),p=f.page;
  await p.evaluate(()=>{closeVehicle({discard:true});openAdd();});
  const positions=await p.evaluate(async()=>{const frame=document.querySelector('#overlay .snote-popup-frame'),xs=[];for(let i=0;i<24;i++){xs.push(frame.getBoundingClientRect().x);await new Promise(requestAnimationFrame)}return xs;});
  const final=positions.at(-1);assert.ok(positions.every((x,i)=>x>=final-1&&(!i||x<=positions[i-1]+1)),JSON.stringify(positions));
  assert.equal(await p.evaluate(()=>document.querySelector('#overlay').scrollLeft),0);
  await p.locator('#new-buy').fill('12345678');assert.equal(await p.locator('#new-buy').inputValue(),'12,345,678');
  await p.locator('#new-sell').fill('23456789');await p.locator('#new-bodywork').fill('1234');assert.equal(await p.locator('#new-bodywork').inputValue(),'1,234');
  assert.equal(await p.evaluate(()=>costInputs('new').bodywork),1234);
  await p.locator('#new-buy').press('End');await p.locator('#new-buy').press('Backspace');assert.equal(await p.locator('#new-buy').inputValue(),'1,234,567');
  await p.evaluate(()=>{closeAdd({discard:true,animate:false});openVehicle('encar-car-1');});
  await p.waitForTimeout(350);
  await p.locator('#detail-extra').fill('판매 완료 시 함께 저장');
  await p.evaluate(()=>changeVehicleStatus({stopPropagation(){},target:{value:'판매완료'}},'encar-car-1',{fromDetail:true}));
  await p.locator('#confirm-sold-price').fill('12345678');assert.equal(await p.locator('#confirm-sold-price').inputValue(),'12,345,678');
  await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator('#status-confirm-submit').click();
  await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);assert.equal(await p.locator('.snote-sale-complete').count(),0);
  await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});
  await p.locator('.snote-sale-complete').waitFor();
  assert.equal(await p.evaluate(()=>window.__encarFixtureCars.find(x=>x.id==='encar-car-1').status),'판매완료');
  assert.equal(await p.evaluate(()=>window.__encarFixtureCars.find(x=>x.id==='encar-car-1').extra),'판매 완료 시 함께 저장');
  await p.waitForFunction(()=>route==='sell');assert.equal(await p.locator('.snote-sale-complete').count(),0);await finish(f);
  console.log('PASS',width,'live grouping, first-frame drawer motion, save ACK → completion animation → sold list');
 }
 {const f=await fixture(),p=f.page;await p.evaluate(()=>{changeVehicleStatus({stopPropagation(){},target:{value:'판매완료'}},'encar-car-1',{fromDetail:true});window.__encarFixtureWriteMode='fail';});await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0&&!document.querySelector('#status-confirm-submit').disabled);assert.equal(await p.locator('.snote-sale-complete').count(),0);assert.notEqual(await p.evaluate(()=>route),'sell');await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>route==='sell');await finish(f);console.log('PASS failed ACK retains confirmation and retry succeeds');}

 {const f=await fixture(),p=f.page;await p.evaluate(()=>{changeVehicleStatus({stopPropagation(){},target:{value:'판매완료'}},'encar-car-1',{fromDetail:true});window.__encarFixtureWriteMode='hold';});await p.locator('#status-confirm-submit').click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);await p.evaluate(()=>openVehicle('encar-car-2'));await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!window.__encarFixtureState.saving);await p.waitForTimeout(1200);assert.notEqual(await p.evaluate(()=>route),'sell');assert.equal(await p.evaluate(()=>activeCarId),'encar-car-2');assert.equal(await p.locator('.snote-sale-complete').count(),0);await finish(f);console.log('PASS late sale ACK cannot redirect or close another vehicle');}
 }finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
