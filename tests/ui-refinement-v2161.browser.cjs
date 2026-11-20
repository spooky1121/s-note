'use strict';
// Actual application DOM and interactions, with synthetic auth/owner datasets only.
// No production, advertisement, customer or SMS requests are permitted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.UI_REFINEMENT_ARTIFACT_DIR||'/workspace/work/ui-v2161/browser';fs.mkdirSync(OUT,{recursive:true});
const FOCUS=process.env.UI_REFINEMENT_FOCUS||'all',WIDTHS=(process.env.UI_REFINEMENT_WIDTHS||'1440,390,320').split(',').map(Number),results=[];
const CAR='encar-car-1',OTHER='encar-car-2',AD='43123456',URL_FOR=id=>'https://fem.encar.com/cars/detail/'+id+'?listAdvType=share&adnm=mo_detail_url';
async function frames(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function setup(width){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;
 await f.context.route('https://encar-smoke.example/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:'{"ok":true,"requests":[]}'}));
 await p.waitForFunction(()=>typeof snoteEncarIdBridge?.saved==='function');
 await p.evaluate(async({id,url})=>{
  await closeVehicle({discard:true});const S=__encarFixtureState;S.revisions.set('cars:'+S.user.id,__encarFixtureRevision);
  Object.assign(cars[0],{model:'계약 검증 차량',status:'계약중',purchaseAt:todayLocal(),encarLinks:{version:2,plate:'12가3456',id,url,verifiedAt:new Date().toISOString(),priceWon:13000000,priceCheckedAt:new Date().toISOString(),priceSource:'encar'}});
  Object.assign(cars[1],{model:'판매 검증 차량',status:'판매중',purchaseAt:todayLocal()});
  persistCars();const saved=await zc86Cloud.flush();if(saved?.ok!==true)throw Error('Synthetic owner dataset seed must be acknowledged');navigate('buy');renderCars();
 },{id:AD,url:URL_FOR(AD)});await p.locator('#list-screen').waitFor({state:'visible'});await frames(p);return f;
}
function visible(p,selector){return p.locator(selector).filter({visible:true}).first();}
function row(p,id=CAR){return visible(p,'#list-screen [data-registration-car-id="'+id+'"]');}
async function viewport(p,label){const metric=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(metric.scroll<=metric.width+1,label+' must not create horizontal document overflow');}
async function assertFaded(p,id=CAR){
 const data=await row(p,id).evaluate(e=>({opacity:Number(getComputedStyle(e).opacity),disabled:e.getAttribute('aria-disabled'),pointer:getComputedStyle(e).pointerEvents,classes:e.className,children:[...e.querySelectorAll('img,strong,select,.car-name,.vehicle-title,.status')].filter(n=>n.getBoundingClientRect().width).map(n=>({tag:n.tagName,pointer:getComputedStyle(n).pointerEvents,opacity:Number(getComputedStyle(n).opacity)}))}));
 assert(data.opacity>0&&data.opacity<=.6,'The complete contracting row/card must be visibly faded');assert.notEqual(data.pointer,'none');assert.notEqual(data.disabled,'true');
 assert.equal(await row(p,OTHER).evaluate(e=>Number(getComputedStyle(e).opacity)),1,'Normal selling vehicles must retain their full appearance');
 return data;
}
async function lists(width){
 const f=await setup(width),p=f.page;try{
  const before=await p.evaluate(()=>({rows:__encarFixtureCars,writes:__encarFixtureWrites.length}));
  const listMetric=await assertFaded(p);assert.match(await row(p).innerText(),/계약중/);assert.equal(await row(p).locator('select.status-select').isEnabled(),true);
  await row(p).locator('.car-name,.vehicle-title,.acct-car-cell strong').first().click();await p.locator('#vehicle-overlay.open').waitFor();assert.equal(await p.locator('#vehicle-title').textContent(),'계약 검증 차량');
  assert.equal(await p.locator('#vehicle-overlay .vehicle-detail-frame').evaluate(e=>Number(getComputedStyle(e).opacity)),1,'Contracting visual treatment belongs to the purchase list, not the editable detail drawer');
  await p.evaluate(()=>closeVehicle({discard:true}));
  await row(p).locator('select.status-select').selectOption('판매중');await p.locator('#status-overlay.open').waitFor();await p.locator('#status-confirm-no').click();await p.locator('#status-overlay').waitFor({state:'hidden'});assert.equal(await row(p).locator('select.status-select').inputValue(),'계약중');
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');const cardMetric=await assertFaded(p);await viewport(p,'Contracting cards');
  await row(p).locator('select.status-select').selectOption('판매중');await p.locator('#status-overlay.open').waitFor();await p.locator('#status-confirm-submit').click();await p.locator('#status-overlay').waitFor({state:'hidden'});assert.equal(await p.evaluate(async()=>(await zc86Cloud.flush())?.ok),true);assert.equal(await row(p).evaluate(e=>Number(getComputedStyle(e).opacity)),1,'Changing the contract status back must immediately remove fading');assert.equal(await row(p).locator('select.status-select').inputValue(),'판매중');
  await row(p).locator('select.status-select').selectOption('계약중');await p.locator('#status-confirm-submit').waitFor({state:'visible'});await p.locator('#status-confirm-submit').click();await p.locator('#status-overlay').waitFor({state:'hidden'});assert.equal(await p.evaluate(async()=>(await zc86Cloud.flush())?.ok),true);await assertFaded(p);
  const after=await p.evaluate(()=>({rows:__encarFixtureCars,writes:__encarFixtureWrites.length}));assert.equal(after.writes,before.writes+2,'Only the two explicitly confirmed synthetic status changes may write');assert.deepEqual(after.rows,before.rows,'Round-trip status changes must preserve every vehicle amount, saved advertisement and sibling row');
  await p.screenshot({path:path.join(OUT,'contracting-cards-'+width+'.png')});results.push({kind:'purchase list/card contracting appearance and interactions',width,listMetric,cardMetric,passed:true});console.log('PASS contracting purchase row/card '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-lists-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function accountant(width){
 const f=await setup(width),p=f.page;try{
  await p.evaluate(()=>{
   const S=__encarFixtureState,original=S.client.rpc.bind(S.client);currentUser={...currentUser,role:'accountant'};S.members[0].role='accountant';
   S.client.rpc=async(name,args)=>name==='snote_company_purchase_rows'?{data:{companyId:S.company.id,owners:[{id:S.user.id,name:'합성 담당 딜러',active:true,memberExists:true}],datasets:[{dataset:'cars',ownerId:S.user.id,revision:__encarFixtureRevision,payload:structuredClone(__encarFixtureCars)},{dataset:'covers',ownerId:S.user.id,revision:1,payload:{}}]},error:null}:original(name,args);
   snoteResetPurchaseScope();navigate('buy');
  });await p.evaluate(()=>snoteWaitCompanyPurchase());await p.evaluate(()=>renderCars());await row(p).waitFor();await assertFaded(p);assert.equal(await row(p).locator('select.status-select').count(),0,'The same visual treatment must not grant the accountant status editing');assert.match(await row(p).locator('.status').textContent(),/계약중/);
  await row(p).locator('.acct-car-cell strong,.acct-mobile-heading strong').first().click();await p.locator('#vehicle-overlay.open').waitFor();assert.equal(await p.locator('#vehicle-title').textContent(),'계약 검증 차량');assert.equal(await p.locator('#vehicle-header-save').isVisible(),false,'The accountant detail stays read-only');
  await p.evaluate(()=>closeVehicle({discard:true}));await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');await assertFaded(p);await viewport(p,'Read-only contracting cards');results.push({kind:'accountant readonly contracting row/card',width,passed:true});console.log('PASS readonly accountant contracting rows/cards '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-accountant-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function finance(width,{icons=true}={}){
 const f=await setup(width),p=f.page;try{
  const amounts=await p.evaluate(()=>cars.map(c=>({id:c.id,buy:c.buy,sell:c.sell,costs:c.costs})));
  await p.evaluate(()=>{zcDashboardGateGranted=true;navigate('finance');});await p.locator('#alt-screen').waitFor({state:'visible'});
  const text=await p.locator('#snote-app').innerText();assert(!text.includes('마진'),'All rendered finance labels must use 수익');assert(text.includes('수익'));assert.equal(await p.getByRole('button',{name:/수익\s*상세\s*보기/}).count(),0,'The removed redundant profit detail button must not remain in the DOM');
  assert.match(await p.locator('.snote-profit-table thead').textContent(),/예상 수익/);assert.equal(await p.locator('.snote-profit-table tbody tr').count(),2,'Contracting vehicles remain part of unsold financial inventory');
  if(icons){
   const metrics=await p.locator('#stats .stat').evaluateAll(cards=>cards.filter(e=>/재고대출금 총액|현금 투자금/.test(e.querySelector('.label')?.textContent||'')).map(e=>({label:e.querySelector('.label').textContent,viewBox:e.querySelector('svg')?.getAttribute('viewBox'),markup:e.querySelector('svg')?.outerHTML})));
   assert.equal(metrics.length,2);assert(metrics.every(m=>m.viewBox==='0 0 24 24'));const defs=await p.evaluate(()=>{const canonical=name=>{const host=document.createElement('div');host.innerHTML=ico(name);return host.querySelector('svg').innerHTML;};return{bank:canonical('bank'),dollar:canonical('dollar'),rendered:[...document.querySelectorAll('#stats .stat')].filter(e=>/재고대출금 총액|현금 투자금/.test(e.querySelector('.label')?.textContent||'')).map(e=>e.querySelector('svg').innerHTML)};});assert.notEqual(defs.bank,defs.dollar,'Bank and dollar icons must be distinct symbols');assert.deepEqual(defs.rendered,[defs.bank,defs.dollar],'Only the requested money summary symbols use the new bank and dollar glyphs');
  }
  assert.deepEqual(await p.evaluate(()=>cars.map(c=>({id:c.id,buy:c.buy,sell:c.sell,costs:c.costs}))),amounts,'Terminology and icon changes must leave money values untouched');await viewport(p,'Finance page');await p.screenshot({path:path.join(OUT,'finance-'+width+'.png')});results.push({kind:'profit terminology and finance summary icons',width,passed:true});console.log('PASS finance terminology/icons '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-finance-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function heading(width,{icons=true}={}){
 const f=await setup(width),p=f.page;try{
  await p.evaluate(()=>openVehicle('encar-car-1'));await p.waitForFunction(()=>!document.getElementById('snote-encar-advertisement').hidden);await frames(p);
  const initial=await p.locator('#snote-encar-advertisement').evaluate(e=>{const name=document.getElementById('vehicle-title'),a=e.getBoundingClientRect(),b=name.getBoundingClientRect();return{parent:e.parentElement.className,beside:a.left>=b.right-1&&Math.abs((a.top+a.bottom)-(b.top+b.bottom))<20};});assert(initial.parent.includes('vehicle-name-links'),'Advertisement amount must belong beside the car name, not under metadata');if(width===1440)assert(initial.beside,'A regular desktop name and amount should share their title line');
  await p.evaluate(async()=>{await closeVehicle({discard:true});const c=cars[0];c.model='메르세데스 벤츠 프리미엄 롱 휠베이스 하이브리드 4MATIC 특별 에디션';c.encarLinks.priceWon=1000000000000;persistCars();const r=await zc86Cloud.flush();if(r?.ok!==true)throw Error('Synthetic maximum price read receipt');openVehicle(c.id);});await p.waitForFunction(()=>document.getElementById('snote-encar-ad-price').textContent.includes('1,000,000,000,000'));await frames(p);
  assert.equal(await p.locator('#snote-encar-price-change').isVisible(),true);assert.equal(await p.locator('#snote-encar-price-refresh').isEnabled(),true);
  const geometry=await p.locator('#vehicle-overlay .vehicle-detail-frame').evaluate(frame=>{const shown=e=>!e.hidden&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;const selected=['#vehicle-title','#snote-encar-ad-price','#snote-encar-price-refresh','#snote-encar-price-change','#vehicle-header-actions','.detail-close'];return{overflow:frame.querySelector('.vehicle-modal').scrollWidth>frame.querySelector('.vehicle-modal').clientWidth,items:selected.map(s=>{const e=frame.querySelector(s),r=e.getBoundingClientRect();return{selector:s,shown:shown(e),left:r.left,right:r.right,top:r.top,bottom:r.bottom};})};});assert.equal(geometry.overflow,false);for(const item of geometry.items.filter(i=>i.shown))assert(item.left>=-.6&&item.right<=width+.6,item.selector+' must stay inside the viewport at maximum car name and price');await viewport(p,'Detail title and ad price');
  if(icons){
   const e=p.locator('#vehicle-encar-check svg[data-snote-action-icon="encar"]');assert.equal(await e.count(),1);assert.equal(await e.evaluate(node=>node.namespaceURI),'http://www.w3.org/2000/svg');
   const glyphs=await p.locator('#vehicle-header-actions .vehicle-header-action > svg').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{type:e.dataset.snoteActionIcon||'',viewBox:e.getAttribute('viewBox'),width:r.width,height:r.height,fill:s.fill,stroke:s.stroke};}));assert(glyphs.length>=5);assert(glyphs.every(g=>g.viewBox.split(/[ ,]+/).map(Number).every(Number.isFinite)&&g.width>=18&&g.width<=24&&g.height>=18&&g.height<=24),'Header icons retain finite normalized viewports and a consistent compact rendered scale');assert(glyphs.some(g=>g.type==='sale'),'Vehicle sale action must use the new car-handshake glyph');
  }
  await p.screenshot({path:path.join(OUT,'detail-price-'+width+'.png')});results.push({kind:'car-name advertisement price and compact icon layout',width,geometry,passed:true});console.log('PASS title price/icons '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-heading-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function semanticIcons(width){
 const f=await setup(width),p=f.page;try{
  await p.evaluate(()=>openVehicle('encar-car-1'));await p.locator('#vehicle-overlay.open').waitFor();
  const expected=await p.evaluate(()=>Object.fromEntries(['sale','contract','receipt','encar'].map(kind=>{const host=document.createElement('div');host.innerHTML=snote161ActionIcon(kind);return[kind,[...host.querySelectorAll('path')].map(path=>path.getAttribute('d'))];})));
  const actual=async selector=>p.locator(selector).evaluate(svg=>({kind:svg.dataset.snoteActionIcon,classes:svg.closest('button')?.className,paths:[...svg.querySelectorAll('path')].map(p=>p.getAttribute('d')),paint:[...svg.querySelectorAll('path')].map(p=>({fill:getComputedStyle(p).fill,stroke:getComputedStyle(p).stroke})),box:{width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height}}));
  const sale=await actual('#vehicle-header-actions svg[data-snote-action-icon="sale"]');assert.deepEqual(sale.paths,expected.sale,'Detail sale action must retain the new car/handshake artwork after shared action upgrades');
  await p.locator('#vehicle-header-actions [aria-label="판매진행"]').click();await p.locator('#zc72-sale-modal').waitFor({state:'visible'});await frames(p);
  for(const [kind,selector]of [['contract','#zc72-print-button svg'],['receipt','#zc72-sale-modal [aria-label="인수증 출력"] svg']]){
   const item=await actual(selector);assert.equal(item.kind,kind);assert(item.classes.split(/\s+/).includes('snote-document-control'),'Document-entry classification must remain intact');assert.deepEqual(item.paths,expected[kind],'The '+kind+' launch must keep the reference-inspired semantic icon rather than being overwritten as a generic document');assert(item.box.width>=18&&item.box.width<=24&&item.box.height>=18&&item.box.height<=24,'Document entry icons must match the shared compact action scale');assert(item.paint.every(p=>p.fill==='none'&&p.stroke!=='none'));
  }
  assert.equal(await p.locator('#zc72-print-button').getAttribute('type'),'submit');assert.equal(await p.locator('#zc72-print-button').getAttribute('form'),'zc72-sale-form');assert.match(await p.locator('#zc72-sale-modal [aria-label="인수증 출력"]').getAttribute('onclick'),/saleProgressContract/);assert.equal(await p.locator('#snote214-save-customer').evaluate(e=>e.classList.contains('snote-save-control')),true);assert.equal(await p.locator('#snote214-save-customer svg').getAttribute('data-snote-action-symbol'),'save');assert.equal(await p.locator('#quote-overlay [data-document-print]').evaluate(e=>e.classList.contains('snote-print-control')),true);await viewport(p,'Sale document actions');await p.screenshot({path:path.join(OUT,'sale-document-icons-'+width+'.png')});await p.evaluate(()=>closeSaleProgress());results.push({kind:'semantic document/sale artwork survives shared action upgrades',width,passed:true});console.log('PASS semantic document action icons '+width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-icons-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of WIDTHS){if(['all','lists'].includes(FOCUS))await lists(width);if(['all','finance'].includes(FOCUS))await finance(width,{icons:FOCUS!=='finance'});if(['all','heading'].includes(FOCUS))await heading(width,{icons:FOCUS!=='heading'});if(['all','icons'].includes(FOCUS))await semanticIcons(width);}
 if(['all','accountant'].includes(FOCUS))for(const width of WIDTHS.filter(w=>w!==320))await accountant(width);
 fs.writeFileSync(path.join(OUT,'results-'+FOCUS+'.json'),JSON.stringify({passed:true,syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');
 }finally{await browser.close();}}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
