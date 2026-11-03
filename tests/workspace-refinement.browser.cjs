'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');const {fixture,setBrowser}=require('./encar/browser-smoke.cjs');
const ART=process.env.REFINEMENT_ARTIFACTS||path.join(require('node:os').tmpdir(),'snote-refinement-v237');fs.mkdirSync(ART,{recursive:true});
const SIGNATURE={version:1,strokes:[[[.1,.2],[.4,.7],[.8,.3]]]};
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of [1440,390,320]){
  const f=await fixture(width),p=f.page;
  await p.evaluate(()=>closeVehicle({discard:true}));
  await p.evaluate(()=>{
   cars=Array.from({length:25},(_,i)=>({id:'refine-'+i,ownerId:currentUser.username,model:i?'조회차량 '+i:'쏘나타 하이브리드',make:i?'기아':'현대',plate:i?'11가'+String(i).padStart(4,'0'):'12가3456',status:'판매중',buy:1000,sell:1500}));
   window.__refineRecords=cars.map((c,i)=>({id:currentUser.username+':'+c.id,ownerId:currentUser.username,carId:c.id,name:i?'가상고객 '+i:'홍길동',phone:i?'010-5555-'+String(i).padStart(4,'0'):'010-1234-5678',carModel:c.model,plate:c.plate,address:i?'대전시 가상로 '+i:'서울특별시 강남구 테헤란로 101',refundBank:'테스트은행',refundAccount:'12345',rrnCipher:{serverIdentity:true},updatedAt:250-i}));
   zc72ReadOwner=async()=>structuredClone(window.__refineRecords);
   window.snote214ReadCustomerIdentities=async records=>({values:new Map(records.map((r,i)=>[r.carId,r.carId==='refine-0'?'900101-1234567':'000101-3000000'])),failed:new Set()});
   window.__refineData=JSON.stringify(cars);navigate('users');
  });
  await p.waitForFunction(()=>document.querySelector('[data-customer-identity="refine-0"]')?.textContent==='900101-*******');
  assert.equal(await p.locator('#snote-customer-rows tr').count(),20);assert.equal(await p.locator('.snote-list-action svg').count(),80);
  assert.equal(await p.locator('.zc72-customers th').first().getAttribute('data-sort-label'),'차량');assert.equal(await p.locator('#snote-customer-rows tr').first().locator('td').first().getAttribute('data-label'),'차량');
  if(width>760){await p.locator('.zc72-customers th').filter({hasText:'고객'}).first().locator('button').click();}else await p.locator('.snote-mobile-sort:visible select').selectOption({label:'고객'});
  assert.match(await p.locator('#snote-customer-rows tr').first().textContent(),/가상고객/);assert.equal(await p.evaluate(()=>document.querySelector('.zc72-customers').innerHTML.includes('900101-1234567')),false);
  const input=p.locator('#snote-customer-search');
  for(const query of ['홍길동','900101','9001011234567','1234567','01012345678','12가3456','테헤란로','쏘나타','현대','홍길동 현대','테스트은행']){
   await input.fill(query);const count=await p.locator('#snote-customer-rows tr').count();assert.equal(count,query==='테스트은행'?20:1,query);if(query!=='테스트은행')assert.equal(await p.locator('[data-customer-identity="refine-0"]').textContent(),'900101-*******');else assert((await p.locator('[data-customer-identity]').allTextContents()).every(x=>x.endsWith('-*******')));
  }
  await input.fill('없는고객');assert.equal(await p.locator('#snote-customer-rows tr').count(),0);assert(await p.locator('#snote-customer-empty').isVisible());
  await input.fill('홍길동');
  const privacy=await p.evaluate(()=>({html:document.querySelector('#alt-content').innerHTML,stores:JSON.stringify({...localStorage,...sessionStorage})}));assert(!privacy.html.includes('9001011234567')&&!privacy.html.includes('900101-1234567'));assert(!privacy.stores.includes('9001011234567')&&!privacy.stores.includes('900101-1234567'));
  assert.equal(await p.locator('[data-customer-delete="refine-0"]').getAttribute('aria-label'),'고객 삭제');assert.equal(await p.locator('[data-customer-delete="refine-0"]').evaluate(e=>getComputedStyle(e).color),'rgb(220, 57, 76)');
  await p.screenshot({path:path.join(ART,'customers-'+width+'.png'),fullPage:true});
  await p.evaluate(()=>{window.__detachedCustomerInput=document.querySelector('#snote-customer-search');navigate('buy')});assert.equal(await p.evaluate(()=>window.__detachedCustomerInput.value),'');assert.equal(await p.evaluate(()=>JSON.stringify(cars)===window.__refineData),true);
  assert.equal(await p.locator('#list-table th').filter({hasText:'사진 / 서류'}).count(),0);assert.equal(await p.locator('#list-mobile .mobile-media').count(),0);
  await p.evaluate(()=>openVehicle('refine-0'));await p.locator('#vehicle-header-delete').waitFor({state:'visible'});await p.locator('#vehicle-header-delete').focus();assert.equal(await p.locator('#vehicle-header-delete').evaluate(e=>getComputedStyle(e,'::after').content),'"삭제"');
  await p.locator('#vehicle-header-delete').click();assert.equal(await p.evaluate(()=>pendingStatusChange.next),'매입취소');await p.locator('#status-confirm-no').click();assert.equal(await p.evaluate(()=>cars.some(c=>c.id==='refine-0')),true);
  await p.evaluate(()=>{const c=cars.find(c=>c.id==='refine-0');c.status='판매완료';c.soldAt='2026-11-03';c.encarLinks={version:1,plate:c.plate,verifiedAt:new Date().toISOString(),listings:[{id:'43000001',model:c.model,sellerUrl:'https://fem.encar.com/cars/detail/43000001',trustedId:null,trustedUrl:null}]};renderVehicle();SnoteEncarLink.refresh()});
  assert.equal(await p.locator('.snote-encar-button').isVisible(),false);assert.equal(await p.locator('.snote-encar-results a').count(),1);
  await p.locator('#vehicle-header-delete').click();await p.locator('#status-confirm-no').click();assert.equal(await p.evaluate(()=>cars.find(c=>c.id==='refine-0').status),'판매완료');
  await p.evaluate(()=>{currentUser.role='accountant';renderVehicle()});assert.equal(await p.locator('#vehicle-header-delete').isVisible(),false);await p.evaluate(()=>snote237DeleteVehicle());assert.equal(await p.evaluate(()=>pendingStatusChange),null);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS '+width+' customer private multi-field search/masking/icons/pagination; purchase media removal; detail deletion confirm/cancel/access; sold Encar hidden with stored link');
 }
 {
  const f=await fixture(),p=f.page;
  await p.locator('#vehicle-header-delete').click();await p.locator('#status-confirm-submit').click();
  await p.waitForFunction(()=>!cars.some(c=>c.id==='encar-car-1')&&activeCarId===null);
  await p.evaluate(()=>window.zc86Cloud.flush());assert.equal(await p.evaluate(()=>window.__encarFixtureCars.some(c=>c.id==='encar-car-1')),false);assert.equal(await p.evaluate(()=>cars.some(c=>c.id==='encar-car-2')),true);
  await p.evaluate(()=>{openVehicle('encar-car-2');window.__originalPersistCars=persistCars;persistCars=()=>false});await p.locator('#vehicle-header-delete').click();await p.locator('#status-confirm-submit').click();assert.equal(await p.evaluate(()=>cars.some(c=>c.id==='encar-car-2')),true);assert.equal(await p.locator('#status-overlay').evaluate(e=>e.classList.contains('open')),true);assert.equal(await p.locator('#status-confirm-submit').isDisabled(),false);await p.evaluate(()=>{persistCars=window.__originalPersistCars;closeStatusModal()});
  await p.locator('#vehicle-header-delete').click();await p.evaluate(()=>{currentUser={...currentUser}});await p.locator('#status-confirm-submit').click();assert.equal(await p.evaluate(()=>cars.some(c=>c.id==='encar-car-2')),true);assert.equal(await p.evaluate(()=>pendingStatusChange),null);
  assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS detail trash uses actual purchase cancellation: confirmed deletion persists, sibling survives, failed persistence retains car and retry, changed actor cannot delete');
 }
 {
  const f=await fixture(),p=f.page;
  f.reply({status:'found',plate:'12가3456',verifiedAt:new Date().toISOString(),listings:[{id:'43000001',model:'가상 차량',sellerUrl:'https://fem.encar.com/cars/detail/43000001',trustedId:null,trustedUrl:null}]});
  await p.evaluate(()=>{window.__nativeLookupFetch=fetch;window.fetch=async(...args)=>{const response=await window.__nativeLookupFetch(...args);if(String(args[0])!=='/api/encar')return response;return new Proxy(response,{get(target,key){if(key==='json')return async()=>{const body=await target.json();window.__lookupHeld=true;await new Promise(r=>window.__releaseLookup=r);return body};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})}});
  const wait=f.context.waitForEvent('page');await p.locator('.snote-encar-button').click();const popup=await wait;await p.waitForFunction(()=>window.__lookupHeld);assert.equal(await popup.locator('h1').textContent(),'해당 차량의 엔카 광고를 찾고 있어요!');assert.equal(await popup.locator('.car,.scan').count(),2);assert.equal(await popup.evaluate(()=>opener===null),true);await popup.screenshot({path:path.join(ART,'encar-waiting.png')});await p.evaluate(()=>window.__releaseLookup());await popup.waitForURL('https://fem.encar.com/cars/detail/43000001');await p.waitForFunction(()=>document.querySelector('.snote-encar-save-status').textContent.includes('서버에 저장했습니다'));const saved=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));assert.equal(saved[0].encarLinks.listings[0].sellerUrl,'https://fem.encar.com/cars/detail/43000001');await popup.close();await f.context.close();
  const second=await fixture(390,saved);assert.equal(await second.page.locator('.snote-encar-results a').count(),1);assert.equal(second.requests.length,0);await second.context.close();console.log('PASS animated isolated waiting tab stays until navigation; actual bridge persists verified URL and clean browser restores it without lookup');
 }
}finally{await browser.close()}})().catch(error=>{console.error(error.stack);process.exitCode=1});
