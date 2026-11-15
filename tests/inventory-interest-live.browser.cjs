'use strict';
// Actual app and Chromium, synthetic authenticated owner-CAS only. No live writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_INTEREST_LIVE_ARTIFACT_DIR||'/workspace/work/v2121-inventory-live/final';
const files=['index.html','assets/inventory-interest.js','assets/inventory-start-date.js','assets/inventory-start-date.css','tests/inventory-interest-live.browser.cjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
fs.mkdirSync(OUT,{recursive:true});
async function setup(p,{blankPlate=false,explicit=true}={}){return p.evaluate(async({blankPlate,explicit})=>{
 ACC44_LENDER_LIMITS=[['KB캐피탈',150000,6],['JB우리금융',150000,12]];INVENTORY_LENDERS=ACC44_LENDER_LIMITS.map(row=>row[0]);
 const ago=days=>{const d=new Date(SnoteInventoryInterest.today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);},c=cars[0];
 Object.assign(c,{moneyUnit:'KRW',purchaseAt:ago(31),inventoryLoan:10000000,inventoryLender:'KB캐피탈'});delete c.inventoryInterestSnapshot;
 if(explicit)c.inventoryStartedAt=ago(10);else delete c.inventoryStartedAt;if(blankPlate)c.plate='';
 if(!persistCars(c.ownerId)||(await zc86Cloud.flush())?.ok!==true)throw Error('Fixture setup save failed');renderVehicle();snoteVehicleRememberDraft();
 return{ten:ago(10),seven:ago(7),four:ago(4),writes:__encarFixtureWrites.length};
 },{blankPlate,explicit});}
const interest=p=>p.locator('#detail-inventory-interest');
const totals=p=>p.locator('#detail-cost-summary .sum-cell strong').allTextContents();
async function amount(p,expected){assert.equal(await interest(p).inputValue(),expected);assert.equal((await totals(p))[0],expected+'원');}
async function openDate(p){await p.locator('#detail-inventory-start-trigger').click();await p.locator('#snote-inventory-start-dialog').waitFor({state:'visible'});}
async function closeDate(p){await p.locator('#snote-inventory-start-dialog .snote-popup-close').click();await p.locator('#snote-inventory-start-dialog').waitFor({state:'hidden'});}
async function clean(f){assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpectedDialogs,[]);assert.deepEqual(f.external,[]);await f.context.close();}
(async()=>{const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of[1440,390,320]){const f=await fixture(width),p=f.page;try{
   const dates=await setup(p);await amount(p,'16,438');
   await p.locator('#detail-inventory-loan').fill('20000000');await amount(p,'32,877');
   await p.evaluate(()=>{const input=document.getElementById('detail-inventory-loan');input.value='30000000';input.dispatchEvent(new Event('change',{bubbles:true}));});await amount(p,'49,315');
   await p.locator('#detail-inventory-lender').selectOption('JB우리금융');await amount(p,'98,630');
   await p.locator('#detail-inventory-loan').fill('20000000');await p.locator('#detail-inventory-lender').selectOption('KB캐피탈');await amount(p,'32,877');
   await p.locator('#detail-memo').fill('날짜만 저장해도 유지할 미저장 메모');await openDate(p);await p.locator('#snote-inventory-start-date').fill(dates.seven);await amount(p,'23,014');
   assert.match(await p.locator('.snote-inventory-start-status').textContent(),/23,014원/);assert.equal(await p.evaluate(()=>cars[0].inventoryStartedAt),dates.ten);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),dates.writes);
   await closeDate(p);await amount(p,'32,877');assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),dates.writes);
   await openDate(p);await p.evaluate(date=>{const input=document.getElementById('snote-inventory-start-date');input.value=date;input.dispatchEvent(new Event('change',{bubbles:true}));},dates.four);await amount(p,'13,151');
   await p.locator('.snote-inventory-start-save').click();await p.locator('#snote-inventory-start-dialog').waitFor({state:'hidden'});await amount(p,'13,151');
   const saved=await p.evaluate(()=>SnoteMoney.car(__encarFixtureCars[0]));assert.equal(saved.inventoryStartedAt,dates.four);assert.equal(saved.inventoryLoan,10000000);assert.equal(saved.costs.inventoryInterest,6575);assert.equal(saved.inventoryInterestSnapshot.amountWon,6575);assert.notEqual(saved.vehicleMemo,'날짜만 저장해도 유지할 미저장 메모');
   assert.equal(await p.locator('#detail-inventory-loan').inputValue(),'20,000,000');assert.equal(await p.locator('#detail-memo').inputValue(),'날짜만 저장해도 유지할 미저장 메모');
   await p.locator('#car-cost-section').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(OUT,'live-interest-'+width+'.png')});
   results.push({name:'live loan/lender and execution-date preview '+width,width,inputAndChange:true,summaryImmediate:true,cancelNoWrite:true,dateOnlySaveKeepsDrafts:true});console.log('PASS '+results.at(-1).name);await clean(f);
  }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});console.error(await p.evaluate(()=>({toast:document.getElementById('toast').textContent,status:document.querySelector('.snote-inventory-start-status')?.textContent,interest:document.getElementById('detail-inventory-interest').value,car:cars[0]})).catch(()=>null));await f.context.close();throw error;}}
  {const f=await fixture(),p=f.page;try{
   const dates=await setup(p);await amount(p,'16,438');await p.locator('#detail-inventory-lender').selectOption('');assert.equal(await interest(p).inputValue(),'');assert.match(await interest(p).getAttribute('placeholder'),/연이율/);assert.equal((await totals(p))[0],'0원');
   await p.locator('#detail-inventory-lender').selectOption('KB캐피탈');await amount(p,'16,438');await openDate(p);await p.locator('#snote-inventory-start-date').fill('');assert.equal(await interest(p).inputValue(),'');assert.match(await p.locator('.snote-inventory-start-status').textContent(),/시작일/);await closeDate(p);await amount(p,'16,438');
   assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),dates.writes);
   await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});const c=cars[1];c.inventoryLoan=1000000;c.inventoryLender='';c.costs={...(c.costs||{}),inventoryInterest:7777};openVehicle(c.id);});assert.equal(await interest(p).inputValue(),'7,777');await p.locator('#detail-inventory-loan').fill('2000000');assert.equal(await interest(p).inputValue(),'7,777');
   results.push({name:'unknown lender or incomplete date clears stale auto interest while another vehicle keeps its saved manual fallback',noStaleValue:true,crossVehicleManualPreserved:true,noWrite:true});console.log('PASS '+results.at(-1).name);await clean(f);
  }catch(error){await f.context.close();throw error;}}
  {const f=await fixture(),p=f.page;try{
   const dates=await setup(p,{blankPlate:true});assert.equal(await p.evaluate(()=>!!snoteInventoryStartBridge.context()),true);assert.equal(await p.evaluate(()=>snoteEncarLinksBridge.context(activeCarId)),null);await openDate(p);await p.locator('#snote-inventory-start-date').fill(dates.seven);await amount(p,'11,507');await p.locator('.snote-inventory-start-save').click();await p.locator('#snote-inventory-start-dialog').waitFor({state:'hidden'});await amount(p,'11,507');
   assert.equal(await p.evaluate(()=>SnoteMoney.car(__encarFixtureCars[0]).inventoryStartedAt),dates.seven);
   const blocked=await p.evaluate(()=>{const actor=currentUser,owner=cars[0].ownerId;currentUser={...actor,username:'other'};const wrongActor=snoteInventoryStartBridge.context()===null;currentUser=actor;cars[0].ownerId='cld_unrelated';const wrongOwner=snoteInventoryStartBridge.context()===null;cars[0].ownerId=owner;return{wrongActor,wrongOwner};});assert.deepEqual(blocked,{wrongActor:true,wrongOwner:true});
   results.push({name:'blank-plate vehicles can save their date with unchanged account and owner guards',strictEncar:true,wrongActorAndOwnerDenied:true});console.log('PASS '+results.at(-1).name);await clean(f);
  }catch(error){await f.context.close();throw error;}}
  {const f=await fixture(390),p=f.page;try{
   const dates=await setup(p);await openDate(p);await p.locator('#snote-inventory-start-date').fill(dates.seven);await amount(p,'11,507');await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-2');});await p.locator('#snote-inventory-start-dialog').waitFor({state:'hidden'});
   assert.equal(await p.evaluate(()=>snote239InterestPreview),null);assert.equal(await p.evaluate(()=>cars[0].inventoryStartedAt),dates.ten);assert.equal(await interest(p).inputValue(),'0');assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),dates.writes);
   await p.evaluate(()=>{const c=cars[0];c.inventoryInterestSnapshot=SnoteInventoryInterest.snapshot({...c,status:'판매완료',soldAt:SnoteInventoryInterest.today()},ACC44_LENDER_LIMITS);c.status='판매완료';c.soldAt=SnoteInventoryInterest.today();ACC44_LENDER_LIMITS=[['KB캐피탈',150000,12]];closeVehicle({discard:true});openVehicle(c.id);});await amount(p,'16,438');assert.equal(await p.locator('#detail-inventory-start-trigger').isDisabled(),true);
   results.push({name:'leaving the vehicle clears its preview and sold snapshots retain their saved rate',lateViewProtected:true,soldSnapshotPreserved:true});console.log('PASS '+results.at(-1).name);await clean(f);
  }catch(error){await f.context.close();throw error;}}
  assert.deepEqual(hashes(),before,'Product changed while validating');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:before,results,syntheticOnly:true,productionWrites:0},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
