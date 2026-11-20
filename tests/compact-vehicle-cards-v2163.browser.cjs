'use strict';
// Actual application UI; every vehicle, identity, advertisement and response is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.COMPACT_CARDS_ARTIFACT_DIR||'/workspace/work/ui-v2163/cards-browser';fs.mkdirSync(OUT,{recursive:true});
const WIDTHS=(process.env.COMPACT_CARDS_WIDTHS||'1440,390,320').split(',').map(Number),results=[];
const CAR='encar-car-1',OTHER='encar-car-2',SOLD='encar-card-sold',AD='43123456',URL='https://fem.encar.com/cars/detail/'+AD+'?listAdvType=share&adnm=mo_detail_url';
const visible=(p,s)=>p.locator(s).filter({visible:true}).first();
const row=(p,id=CAR)=>visible(p,'#list-screen [data-registration-car-id="'+id+'"]');
async function frames(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function setup(width){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;
 await f.context.route(URL,r=>r.fulfill({contentType:'text/html',body:'<title>합성 엔카 광고</title><p>합성 광고 링크 검증</p>'}));
 await p.evaluate(async({id,url})=>{
  await closeVehicle({discard:true});const S=__encarFixtureState;S.revisions.set('cars:'+S.user.id,__encarFixtureRevision);
  Object.assign(cars[0],{model:'테슬라 모델 Y 롱레인지',make:'테슬라',status:'계약중',year:2025,km:'47,123',buy:35000000,sell:42000000,purchaseAt:todayLocal(),encarLinks:{version:2,plate:'12가3456',id,url,verifiedAt:new Date().toISOString(),priceWon:42000000,priceCheckedAt:new Date().toISOString(),priceSource:'encar'}});
  Object.assign(cars[1],{model:'현대 그랜저 하이브리드',make:'현대',status:'판매중',year:2024,km:'23,456',buy:28000000,sell:33000000,purchaseAt:todayLocal()});
  cars.push({...structuredClone(cars[1]),id:'encar-card-third',plate:'56다7890',model:'기아 쏘렌토 하이브리드',make:'기아'});
  cars.push({...structuredClone(cars[0]),id:'encar-card-sold',plate:'78라1234',status:'판매완료',soldAt:todayLocal()});
  persistCars();const saved=await zc86Cloud.flush();if(saved?.ok!==true)throw Error('Synthetic inventory seed must be acknowledged');navigate('buy');renderCars();
 },{id:AD,url:URL});await p.locator('#list-screen').waitFor({state:'visible'});await frames(p);return f;
}
async function stamp(p,expected=true,id=CAR){
 const item=row(p,id),badge=item.locator('.car-thumb > .snote-contract-stamp');assert.equal(await badge.count(),expected?1:0);
 if(!expected)return null;
 const m=await badge.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),photo=e.parentElement.getBoundingClientRect();return{width:r.width,height:r.height,cssWidth:parseFloat(s.width),photoWidth:photo.width,photoLeft:photo.left,photoTop:photo.top,left:r.left,top:r.top,transform:s.transform,color:s.color,pointer:s.pointerEvents,text:e.textContent,aria:e.getAttribute('aria-label')};});
 assert.equal(m.text,'계약중');assert.equal(m.aria,'계약중');assert.notEqual(m.transform,'none');assert.equal(m.pointer,'none');assert.match(m.color,/185, 31, 48/);assert(m.left<m.photoLeft+m.photoWidth*.35,'Contract stamp stays near the thumbnail top-left');
 assert.equal(await item.evaluate(e=>Number(getComputedStyle(e).opacity)),.48,'The existing complete-row/card fading remains intact');return m;
}
async function cards(p,width,{accountant=false}={}){
 await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');await frames(p);
 assert.equal(await p.locator('#snote-vehicle-view-switch').getAttribute('data-vehicle-view'),'cards');assert.match(await p.locator('#snote-vehicle-view-switch').getAttribute('aria-label'),/현재 카드형/);
 const item=row(p),m=await item.evaluate((e,accountant)=>{
  const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const photo=e.querySelector(':scope > .car-thumb'),title=e.querySelector(accountant?'.acct-mobile-heading strong':'.vehicle-title'),meta=e.querySelector(accountant?'.acct-mobile-sub':'.vehicle-meta'),price=e.querySelector(accountant?'.acct-mobile-fields > div:nth-child(4) strong':'.vehicle-price');
  return{card:rect(e),photo:rect(photo),title:rect(title),meta:rect(meta),price:rect(price),priceColor:getComputedStyle(price).color,overflow:e.scrollWidth>e.clientWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,grid:getComputedStyle(e.parentElement).gridTemplateColumns};
 },accountant);
 assert(!m.overflow&&!m.documentOverflow,'Compact cards must fit the viewport without horizontal overflow');assert(m.photo.width>=(width<=360?70:80)&&m.photo.width<=110,'Thumbnail must stay small rather than fill the card width');assert(m.title.x>=m.photo.right+6,'Model information belongs to the right of the photo');assert(m.title.y<=m.photo.y+2,'Model information starts beside the photo top');assert(m.meta.x>=m.photo.right+6);assert(m.card.height<(accountant?320:260),'Normal synthetic records must remain compact: '+m.card.height+'px');assert.match(m.priceColor,/40, 102, 213/,'The primary price is visually emphasized');
 const badge=await stamp(p);assert(badge.cssWidth/badge.photoWidth>=.32&&badge.cssWidth/badge.photoWidth<=.4,'Card stamp takes approximately one third of the photo width');await stamp(p,false,OTHER);
 const marker=await item.locator('.car-thumb').evaluate(photo=>{const e=document.createElement('span');e.className='snote-shared-vehicle-marker snote-shared-vehicle-marker--photo';e.setAttribute('role','img');e.setAttribute('aria-label','공유 차량');e.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>';photo.append(e);const r=e.getBoundingClientRect(),p=photo.getBoundingClientRect(),s=getComputedStyle(e),result={right:r.right,photoRight:p.right,left:r.left,width:r.width,display:s.display};e.remove();return result;});assert.notEqual(marker.display,'none');assert(marker.width>0&&marker.right<=marker.photoRight+.5&&marker.left>m.photo.x+m.photo.width*.55,'Shared-vehicle marker remains visible at the photo right while the contract stamp uses its left');
 const text=await item.innerText();assert.match(text,/12가3456/);assert.match(text,/2025년/);assert.match(text,/47,123/);assert.match(text,/35,000,000원/);if(!accountant)assert.match(text,/42,000,000원/);
 if(width===1440)assert.equal(m.grid.split(' ').length,3,'Desktop card grid should display three small horizontal cards');
 await p.screenshot({path:path.join(OUT,(accountant?'accountant':'dealer')+'-cards-'+width+'.png')});return{...m,badge};
}
async function dealer(width){
 const f=await setup(width),p=f.page;try{
  const before=await p.evaluate(()=>({cars:__encarFixtureCars,writes:__encarFixtureWrites.length}));
  await stamp(p);await stamp(p,false,OTHER);assert.equal(await row(p).locator('.car-thumb img').count(),1,'Fallback thumbnail must retain its image and contract stamp');
  await row(p).locator('select.status-select').selectOption('판매중');await p.locator('#status-overlay.open').waitFor();await p.locator('#status-confirm-no').click();await p.locator('#status-overlay').waitFor({state:'hidden'});await stamp(p);
  const metric=await cards(p,width);
  assert.equal(await row(p).locator('.snote-list-encar').evaluate(e=>e.tagName),'A');assert.equal(await row(p).locator('.snote-list-encar').getAttribute('href'),URL);assert.equal(await row(p).locator('.snote-list-encar').getAttribute('target'),'_blank');
  const opened=p.waitForEvent('popup');await row(p).locator('.snote-list-encar').click();const ad=await opened;await ad.waitForURL(URL);await ad.waitForLoadState('domcontentloaded');assert.equal(ad.url(),URL);await ad.close();assert.equal(await p.locator('#vehicle-overlay').isVisible(),false,'Native Encar action must not bubble into vehicle detail');assert.equal(f.requests.length,0,'Saved links open without a fresh vehicle lookup');
  await row(p).locator('.vehicle-title').click();await p.locator('#vehicle-overlay.open').waitFor();assert.equal(await p.locator('#vehicle-title').textContent(),'테슬라 모델 Y 롱레인지');assert.equal(await p.locator('#vehicle-overlay .snote-contract-stamp').count(),0,'Stamp belongs to the list thumbnail, not detail');await p.evaluate(()=>closeVehicle({discard:true}));
  await p.evaluate(()=>{window.__cardOriginalPhotos=carPhotos;carPhotos=id=>id==='encar-car-1'?[{id:'synthetic-photo',url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="lightblue"/></svg>'}]:window.__cardOriginalPhotos(id);renderCars();});await stamp(p);assert.match(await row(p).locator('.car-thumb img').getAttribute('alt'),/실차 사진/,'Existing actual-photo selection still wraps the same contract overlay');
  const scope=await p.evaluate(()=>{const previous=route,c=cars[0];route='dashboard';const dashboard=thumbHtml(c);route='sell';const sold=carMobile([{...c,status:'판매완료'}]);route=previous;return{dashboard,sold};});assert(!scope.dashboard.includes('snote-contract-stamp')&&!scope.sold.includes('snote-contract-stamp'),'Dashboard and completed-sale rows must not acquire purchase contract stamps');
  await p.evaluate(()=>{carPhotos=window.__cardOriginalPhotos;cars[0].model='메르세데스 벤츠 프리미엄 롱 휠베이스 하이브리드 4MATIC 특별 에디션';renderCars();});await frames(p);assert.equal(await row(p).evaluate(e=>e.scrollWidth>e.clientWidth),false,'Long names must wrap rather than escape the compact card');assert.equal(await row(p).locator('.vehicle-title > span:first-child').textContent(),'메르세데스 벤츠 프리미엄 롱 휠베이스 하이브리드 4MATIC 특별 에디션');await p.evaluate(()=>{cars[0].model='테슬라 모델 Y 롱레인지';renderCars();});
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='list');await stamp(p);assert.equal(await p.evaluate(()=>localStorage.getItem('snote:vehicle-list-view:v1')),'list');
  const after=await p.evaluate(()=>({cars:__encarFixtureCars,writes:__encarFixtureWrites.length}));assert.deepEqual(after,before,'View toggles, cancelled status changes and native links must not write or alter any persisted vehicle data');
  await p.evaluate(()=>navigate('sell'));await row(p,SOLD).waitFor();assert.equal(await row(p,SOLD).locator('.snote-contract-stamp').count(),0);await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');assert.match(await row(p,SOLD).innerText(),/판매 완료일/);assert.equal(await row(p,SOLD).locator('.mobile-media').count(),1,'Sold card document counters remain present');assert.equal(await row(p,SOLD).locator('.snote221-income-button').count(),1,'Sold card income-settlement action remains present');assert.equal(await row(p,SOLD).evaluate(e=>e.scrollWidth>e.clientWidth),false);await p.screenshot({path:path.join(OUT,'sold-cards-'+width+'.png')});
  results.push({kind:'dealer list/card compact layout, stamp, preserved interactions and data',width,metric,passed:true});console.log('PASS dealer compact cards '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-dealer-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function accountant(width){
 const f=await setup(width),p=f.page;try{
  await p.evaluate(()=>{const S=__encarFixtureState,original=S.client.rpc.bind(S.client);currentUser={...currentUser,role:'accountant'};S.members[0].role='accountant';S.client.rpc=async(name,args)=>name==='snote_company_purchase_rows'?{data:{companyId:S.company.id,owners:[{id:S.user.id,name:'합성 담당 딜러',active:true,memberExists:true}],datasets:[{dataset:'cars',ownerId:S.user.id,revision:__encarFixtureRevision,payload:structuredClone(__encarFixtureCars)},{dataset:'covers',ownerId:S.user.id,revision:1,payload:{}}]},error:null}:original(name,args);snoteResetPurchaseScope();navigate('buy');});await p.evaluate(()=>snoteWaitCompanyPurchase());await p.evaluate(()=>renderCars());await row(p).waitFor();
  assert.equal(await row(p).locator('select.status-select').count(),0);const metric=await cards(p,width,{accountant:true});assert.equal(await row(p).locator('select.status-select').count(),0,'New card arrangement must not grant accountant status editing');assert.match(await row(p).locator('.status').textContent(),/계약중/);assert.equal(await row(p).locator('.acct-mobile-fields > div').count(),8);assert.equal(await row(p).locator('.vehicle-price').count(),0,'Accountant scope must not gain dealer selling-price fields');
  await row(p).locator('.acct-mobile-heading strong').click();await p.locator('#vehicle-overlay.open').waitFor();assert.equal(await p.locator('#vehicle-header-save').isVisible(),false,'Accountant vehicle detail must remain read-only');await p.evaluate(()=>closeVehicle({discard:true}));results.push({kind:'accountant read-only card photo and existing financial fields',width,metric,passed:true});console.log('PASS accountant compact cards '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-accountant-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of WIDTHS){await dealer(width);await accountant(width);}fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
