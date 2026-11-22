'use strict';
// Real app, same-origin second tab and synthetic companies. No hosted data writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const{setup:setupCompany}=require('./company-purchase.browser.cjs'),{hydrateFinance}=require('./finance-ledger-fixture.cjs');
const OUT=process.env.PRESTOCK_LEDGER_ARTIFACT_DIR||'/tmp/snote-prestock-ledger';fs.mkdirSync(OUT,{recursive:true});
const rows=[{id:'ps-company-a',date:'2026-11-01',model:'가상 A 차량',plate:'11가1111',amount:1000000,repaid:false,extra:{preserve:true}},{id:'unknown-preserved',date:'unrecognized',amount:11,extra:{untouched:true}}];
const limits=[['검증 금융',10000000,0],{_snote203_meta:{prestock:{total:8500000,bank:'가상 A 은행',account:'TEST-ACCOUNT-A',holder:'가상 상사 A'}}}];
async function setup(width){const f=await fixture(width),p=f.page;await setupCompany(p);await p.evaluate(()=>{for(const row of __companyMock.data.datasets.filter(row=>row.dataset==='cars'))for(const car of row.payload)car.ownerId='cld_'+row.ownerId.replaceAll('-','').slice(0,18);});await hydrateFinance(f,[],limits,rows);await p.evaluate(()=>{closeDashboardGate();navigate('prestock');});await p.locator('#ps-bank-account').waitFor();return f;}
async function secondTab(f){const tab=await f.context.newPage();await tab.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic second company tab</title>'}));await tab.goto('https://encar-smoke.example/second-company-prestock');return tab;}
async function swap(tab){await tab.evaluate(()=>{localStorage.setItem('zerocar-office-v148-prestock-ledger',JSON.stringify([{id:'ps-company-b',date:'2026-11-01',model:'가상 B 차량',plate:'99나9999',amount:7000000,repaid:false}]));localStorage.setItem('zerocar-office-v147-prestock-entries',JSON.stringify([{id:'ps-legacy-b',date:'2026-11-01',model:'출처 미확인 과거 캐시',amount:6000000}]));localStorage.setItem('zerocar-office-v157-finance-companies',JSON.stringify([{_snote203_meta:{prestock:{total:20000000,bank:'가상 B 은행',account:'TEST-ACCOUNT-B',holder:'가상 상사 B'}}}]));});}
function inline(p,width,key){return p.locator((width<=760?'#ps-mobile-list':'#ps-scroll')+' [data-ps-row="ps-company-a"][data-ps-field="'+key+'"]');}
async function ownOnly(p){const writes=await p.evaluate(()=>__financeScope.writes.filter(call=>call.p_dataset==='prestock'));assert(writes.every(call=>!JSON.stringify(call.p_payload).includes('ps-company-b')&&!JSON.stringify(call.p_payload).includes('ps-legacy-b')));assert(writes.every(call=>call.p_company==='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));return writes;}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of(process.env.PRESTOCK_SCOPE_CASE==='detail'?[]:[1440,390])){
  const f=await setup(width),p=f.page;let tab;
  try{
   tab=await secondTab(f);await swap(tab);await p.waitForTimeout(30);
   assert.equal(await p.locator('#ps-bank-account').innerText(),'8,500,000원');assert.equal(await p.locator('#ps-total').innerText(),'1,000,000원');assert.equal(await p.locator('#ps-balance').innerText(),'7,500,000원');
   assert.deepEqual(await p.evaluate(()=>prestockAllRows().map(row=>row.id)),['ps-company-a']);assert.equal(await p.evaluate(()=>prestockLegacyRows().length),0);
   await inline(p,width,'amount').fill('1500000');await inline(p,width,'amount').press('Enter');await p.waitForFunction(()=>document.getElementById('ps-inline-status')?.dataset.tone==='success');
   let writes=await ownOnly(p);assert.equal(writes.at(-1).p_payload.find(row=>row.id==='ps-company-a').amount,1500000);assert(writes.at(-1).p_payload.some(row=>row.id==='unknown-preserved'));
   await swap(tab);await p.evaluate(()=>{openPrestockConfirmation('repay','ps-company-a');applyPrestockAction();});assert.equal((await p.evaluate(()=>zc86Cloud.flush())).ok,true);writes=await ownOnly(p);assert.equal(writes.at(-1).p_payload.find(row=>row.id==='ps-company-a').repaid,true);assert(writes.at(-1).p_payload.some(row=>row.id==='unknown-preserved'));
   await swap(tab);await p.locator('#ps-model').fill('가상 A 추가 내역');await p.locator('#ps-amount').fill('200000');await p.locator('.ps-entry-submit').click();assert.equal((await p.evaluate(()=>zc86Cloud.flush())).ok,true);writes=await ownOnly(p);assert(writes.at(-1).p_payload.some(row=>row.model==='가상 A 추가 내역'));assert(writes.at(-1).p_payload.some(row=>row.id==='unknown-preserved'));
   assert.equal(await p.locator('#ps-total').innerText(),'200,000원');assert.equal(await p.locator('#ps-balance').innerText(),'8,300,000원');
   const fences=await p.evaluate(()=>{const S=__encarFixtureState,member=S.members[0],old={role:currentUser.role,user:S.user,client:S.client,company:S.company};const checks=[];member.role='dealer';currentUser.role='dealer';checks.push(snotePrestockLedgerBridge.rows()===null&&savePrestockRows([])===false&&prestockValueMarkup({isPrestock:true}).includes('선재고')&&prestockDetailMetric({isPrestock:true}).includes('미확인'));member.role=old.role;currentUser.role=old.role;S.company={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};checks.push(snotePrestockLedgerBridge.rows()===null);S.company=old.company;S.user={...old.user};checks.push(snotePrestockLedgerBridge.rows()===null);S.user=old.user;S.client={};checks.push(snotePrestockLedgerBridge.rows()===null);S.client=old.client;return checks;});assert(fences.every(Boolean));
   await p.screenshot({path:path.join(OUT,'prestock-company-a-'+width+'.png')});
   // A confirmed absent server ledger is empty; it does not import or erase either
   // unbound legacy cache just because a new company signs in.
   await swap(tab);const legacyBytes=await p.evaluate(()=>({current:localStorage.getItem(PRESTOCK_V148_KEY),old:localStorage.getItem(PRESTOCK_STORAGE_KEY)}));
   await p.evaluate(()=>{const S=__encarFixtureState;S.company={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'가상 새 상사'};S.members=[{user_id:S.user.id,company_id:S.company.id,role:'admin',active:true}];__financeScope.rows=[];});
   f.answerConfirm(true,/서버에 저장된 데이터로 다시 불러올까요/);await p.evaluate(()=>zc86Cloud.reload());
   assert.deepEqual(await p.evaluate(()=>snotePrestockLedgerBridge.rows()),[]);assert.deepEqual(await p.evaluate(()=>prestockAllRows()),[]);
   assert.deepEqual(await p.evaluate(()=>({current:localStorage.getItem(PRESTOCK_V148_KEY),old:localStorage.getItem(PRESTOCK_STORAGE_KEY)})),legacyBytes);
   await tab.close();tab=null;await finish(f);console.log('PASS '+width+'px actual two-tab own bank/balance/read/edit/repay/add/CAS and hidden-row preservation with role/company/user/client fences');
  }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await tab?.close().catch(()=>{});await f.context.close().catch(()=>{});throw error;}
 }
 // The current accounting UI has no prestock input. Mount its retained render
 // helper only in this synthetic fixture to exercise the compatible legacy
 // detail-save/undo branch without reintroducing it into the shipped UI.
 for(const width of[1440,390]){
  const f=await setup(width),p=f.page;let tab;
  try{
   tab=await secondTab(f);await swap(tab);
   await p.evaluate(async()=>{const S=__encarFixtureState;S.members[0].role='accountant';currentUser={...currentUser,role:'accountant'};buildMenus();navigate('buy');});await p.waitForFunction(()=>snoteEnsureCompanyPurchase()===true);
   await p.evaluate(()=>{openVehicle('company-own-1');const car=cars.find(car=>car.id==='company-own-1');document.querySelector('#acct-readonly-panel .acct-edit-fields').insertAdjacentHTML('beforeend',accountantPrestockEditMetric(car));});await p.locator('#acct-edit-prestock').waitFor();await p.locator('#acct-edit-prestock').fill('2000000');
   await p.evaluate(()=>{const S=__encarFixtureState,original=S.client.rpc.bind(S.client);window.__prestockFail=true;S.client.rpc=async(name,args)=>name==='zc_write_dataset'&&__prestockFail?{data:null,error:{message:'SYNTHETIC_WRITE_FAILURE'}}:original(name,args);});
   assert.equal(await p.evaluate(()=>saveAccountantVehicle({closeAfterSave:false})),false);assert.equal(await p.evaluate(()=>!!snoteVehicleUnconfirmedWrite),true,'Expected staged detail attempt; notifications='+JSON.stringify(f.notifications));assert.equal(await p.evaluate(()=>prestockForCar(cars.find(car=>car.id==='company-own-1'))),2000000);
   await swap(tab);assert.equal(await p.evaluate(()=>snoteVehicleUnconfirmedWrite.undo()),true);assert.equal(await p.evaluate(()=>prestockForCar(cars.find(car=>car.id==='company-own-1'))),1000000);
   await swap(tab);await p.evaluate(()=>__prestockFail=false);assert.equal((await p.evaluate(()=>zc86Cloud.flush())).ok,true);const writes=await ownOnly(p);assert(writes.length>0);assert(writes.at(-1).p_payload.some(row=>row.id==='unknown-preserved'));assert.equal(writes.at(-1).p_payload.find(row=>row.id==='ps-company-a').amount,1000000);assert(writes.at(-1).p_payload.every(row=>row.type!=='adjustment'));
   await p.evaluate(()=>{snoteVehicleUnconfirmedWrite=null;});await tab.close();tab=null;await finish(f);console.log('PASS '+width+'px retained detail handler failed-save undo and follow-up CAS restore only own-company prestock body');
  }catch(error){await p.screenshot({path:path.join(OUT,'undo-failure-'+width+'.png')}).catch(()=>{});await tab?.close().catch(()=>{});await f.context.close().catch(()=>{});throw error;}
 }
}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
