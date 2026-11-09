'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT='/workspace/work/v2112-inventory-start-browser';
const sourceNames=['index.html','assets/inventory-interest.js','assets/inventory-start-date.js','assets/inventory-start-date.css'];
const hashes=()=>Object.fromEntries(sourceNames.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const sourceHashes=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of[1440,390,320]){
   const f=await fixture(width),p=f.page;
   try{
    await p.waitForFunction(()=>!!window.SnoteInventoryStartDate&&!!window.snoteInventoryStartBridge);
    const setup=await p.evaluate(async()=>{
     ACC44_LENDER_LIMITS=[['KB캐피탈',150000,6],['JB우리금융',150000,12]];INVENTORY_LENDERS=ACC44_LENDER_LIMITS.map(x=>x[0]);
     const today=SnoteInventoryInterest.today(),ago=days=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);},c=cars[0];
     Object.assign(c,{purchaseAt:ago(31),inventoryLoan:10000000,inventoryLender:'KB캐피탈'});delete c.inventoryStartedAt;delete c.inventoryInterestSnapshot;
     if(!persistCars(c.ownerId))throw Error('SETUP_PERSIST_FAILED');const saved=await zc86Cloud.flush();if(saved?.ok!==true)throw Error('SETUP_ACK_FAILED');renderVehicle();snoteVehicleRememberDraft();
     return{today,purchase:ago(31),chosen:ago(7),other:ago(8),memo:c.vehicleMemo||'',extra:c.extra||''};
    });
    await p.locator('#car-cost-section').scrollIntoViewIfNeeded();
    const interest=p.locator('#detail-inventory-interest'),trigger=p.locator('#detail-inventory-start-trigger');
    assert.equal(await interest.inputValue(),'50,959');assert.equal(await p.locator('#detail-interest-basis').textContent(),'연 6%');assert.equal(await trigger.textContent(),'재고이자');assert.match(await trigger.getAttribute('data-tooltip'),new RegExp(setup.purchase));
    const layout=await p.locator('#detail-interest-basis').evaluate(e=>{const note=e.getBoundingClientRect(),label=document.getElementById('detail-inventory-start-trigger').getBoundingClientRect(),field=document.getElementById('detail-inventory-interest').getBoundingClientRect();return{beside:note.x>=label.right-1,center:Math.abs(note.y+note.height/2-label.y-label.height/2)<3,aboveInput:note.bottom<=field.y+1};});assert(layout.beside&&layout.center&&layout.aboveInput,JSON.stringify(layout));
    await trigger.scrollIntoViewIfNeeded();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.mouse.move(1,1);await trigger.hover();
    if(!await p.locator('#snote-icon-tooltip').isVisible()){await p.mouse.move(1,1);await trigger.hover();}
    await p.locator('#snote-icon-tooltip').waitFor({state:'visible'});assert.match(await p.locator('#snote-icon-tooltip').textContent(),new RegExp(setup.purchase));
    await p.locator('#detail-memo').fill('미저장 메모 '+width);await p.locator('#detail-extra').fill('미저장 비고 '+width);
    await trigger.click();const dialog=p.locator('#snote-inventory-start-dialog');await dialog.waitFor({state:'visible'});
    assert.equal(await p.locator('#snote-inventory-start-date').inputValue(),setup.purchase);assert.equal(await p.locator('#snote-inventory-start-date').getAttribute('max'),setup.today);
    const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.width<=360);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await p.screenshot({path:path.join(OUT,width+'.png')});
    await p.locator('#snote-inventory-start-date').fill(setup.chosen);await p.locator('.snote-inventory-start-save').click();await dialog.waitFor({state:'hidden'});
    await p.waitForFunction(date=>window.__encarFixtureCars[0].inventoryStartedAt===date,setup.chosen);
    const saved=await p.evaluate(()=>({row:window.__encarFixtureCars[0],dirty:snoteVehicleHasChanges(),live:cars[0].costs.inventoryInterest,writes:window.__encarFixtureWrites.length}));
    assert.equal(saved.row.costs.inventoryInterest,1.1507);assert.equal(saved.live,11507);assert.equal(saved.row.inventoryInterestSnapshot.amountWon,11507);assert.equal(saved.row.vehicleMemo||'',setup.memo);assert.equal(saved.row.extra||'',setup.extra);assert.equal(saved.dirty,true);
    assert.equal(await interest.inputValue(),'11,507');assert.equal(await p.locator('#detail-memo').inputValue(),'미저장 메모 '+width);assert.equal(await p.locator('#detail-extra').inputValue(),'미저장 비고 '+width);assert.match(await trigger.getAttribute('data-tooltip'),new RegExp(setup.chosen));
    await trigger.click();await p.locator('#snote-inventory-start-date').fill(setup.other);await p.locator('.snote-inventory-start-cancel').click();assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].inventoryStartedAt),setup.chosen);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),saved.writes);
    await p.locator('#detail-inventory-loan').fill('20000000');assert.equal(await interest.inputValue(),'23,014');await p.locator('#detail-inventory-lender').selectOption('JB우리금융');assert.equal(await interest.inputValue(),'46,027');assert.equal(await p.locator('#detail-interest-basis').textContent(),'연 12%');
    await p.locator('#detail-inventory-loan').fill('10000000');await p.locator('#detail-inventory-lender').selectOption('KB캐피탈');
    await p.evaluate(async()=>{const c=cars[0];await closeVehicle({discard:true,animate:false});c.status='판매완료';c.soldAt=SnoteInventoryInterest.today();c.inventoryInterestSnapshot=SnoteInventoryInterest.snapshot(c,ACC44_LENDER_LIMITS);ACC44_LENDER_LIMITS=[['KB캐피탈',150000,12],['JB우리금융',150000,12]];openVehicle(c.id);});
    assert.equal(await trigger.isDisabled(),true);assert.equal(await p.locator('#detail-interest-basis').textContent(),'연 6%');assert.equal(await p.evaluate(()=>normalizeCosts(cars[0]).inventoryInterest),11507);
    await p.evaluate(()=>{const S=window.__encarFixtureState;S.members[0].role='accountant';currentUser={...currentUser,role:'accountant'};renderVehicle();SnoteInventoryStartDate.open();});
    assert.equal(await p.evaluate(()=>snoteInventoryStartBridge.context()),null);assert.equal(await dialog.isVisible(),false);
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpectedDialogs,[]);
    results.push({width,rateAndStartTooltip:true,actualHoverBubble:true,dialogFits:true,dateOnlyDatabaseSave:true,dirtyMemoAndExtraPreserved:true,cancelNoWrite:true,loanAndLenderRecalculation:true,soldDateEditDisabled:true,soldSnapshotFrozen:true,readOnlyDateEditDenied:true,overflow:false});
    console.log('PASS '+width+' inventory date popup, exact rate, date-only CAS, preserved drafts, cancel, recalculation and sold snapshot');
   }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});const diagnostic=await p.evaluate(()=>({state:document.getElementById('snote-inventory-start-dialog')?.textContent,button:document.getElementById('detail-inventory-start-trigger')?.outerHTML,toast:document.getElementById('toast')?.textContent,car:cars[0],saveState:window.__encarFixtureState?.queue?.size})).catch(()=>null);fs.writeFileSync(path.join(OUT,'failure-'+width+'.json'),JSON.stringify(diagnostic,null,2)+'\n');throw error;}
   finally{await f.context.close();}
  }
  assert.deepEqual(hashes(),sourceHashes,'Product source changed during browser verification');
  fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes,results,syntheticAccountAndDatabase:true,liveBillingCalls:0},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
