'use strict';
// Actual application/table handlers. Fixtures replace all accounts, vehicles,
// media, permissions and HTTP replies; no operating data or service is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const {setup:companySetup}=require('./company-purchase.browser.cjs');
const OUT=process.env.VEHICLE_RESPONSIVE_ARTIFACTS||'/tmp/snote-vehicle-responsive-v2251';
fs.mkdirSync(OUT,{recursive:true});
fs.rmSync(path.join(OUT,'verification.json'),{force:true});
const records=[];
async function settle(p){await p.waitForFunction(()=>!document.querySelector('main.content[data-route-transition]'));await p.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function mode(p,value){if(await p.locator('#list-screen').getAttribute('data-vehicle-view')!==value)await p.locator('#snote-vehicle-view-switch').click();await settle(p);}
async function seed(p){await p.evaluate(async()=>{
 await closeVehicle({discard:true});const base=cars[0],owner=currentUser.username;
 cars=Array.from({length:25},(_,i)=>({...base,id:'responsive-'+i,ownerId:owner,model:i%2?'기아 더 뉴 쏘렌토 2.2 디젤 4WD 시그니처':'메르세데스-벤츠 더 뉴 E-클래스 E350 4MATIC AMG Line',plate:(i%2?'34나':'12가')+String(3456+i),km:'123,456',year:2023,buy:38250000,sell:42750000,vin:'WDD2130431A123456',inventoryLender:'검증 재고금융 주식회사',inventoryLoan:25000000,purchaseAt:'2026-11-02',status:i%2?'판매중':'계약중'}));
 const image='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#bcd7ed"/></svg>');
 mediaByCar=Object.fromEntries(cars.map(c=>[c.id,[{id:'responsive-photo-'+c.id,carId:c.id,ownerId:owner,group:'photos',url:image}]]));covers={};
 window.snote236ResetPagination();navigate('buy');window.__responsiveBefore=JSON.stringify({cars,mediaByCar,covers,writes:__encarFixtureWrites});
 });await settle(p);
}
async function geometry(p){return p.evaluate(()=>{
 const host=document.getElementById('list-table'),table=host.querySelector('table'),visible=e=>!!e.getClientRects().length&&getComputedStyle(e).display!=='none';
 const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,width:r.width,height:r.height,client:e.clientWidth,scroll:e.scrollWidth};};
 const headers=[...table.tHead.rows[0].cells],rows=[...table.tBodies[0].rows],shown=headers.filter(visible);
 return{width:innerWidth,pageWidth:document.documentElement.scrollWidth,host:box(host),table:box(table),flow:host.dataset.snoteListFlow||null,columns:shown.map(e=>e.dataset.purchaseColumn||e.textContent.trim()),tableRole:table.getAttribute('role'),rowRoles:rows.map(e=>e.getAttribute('role')),cells:rows.flatMap((row,r)=>[...row.cells].filter(visible).map(cell=>{const s=getComputedStyle(cell),range=document.createRange();range.selectNodeContents(cell);const fragments=[...range.getClientRects()].filter(r=>r.width&&r.height);return{row:r,col:cell.dataset.purchaseColumn,label:cell.dataset.snoteListLabel,text:cell.textContent.trim(),font:parseFloat(s.fontSize),white:s.whiteSpace,...box(cell),fragments:fragments.map(r=>({x:r.x,right:r.right,y:r.y,width:r.width}))};})),labels:headers.map(e=>String(e.dataset.sortLabel||e.textContent).replace(/[↕↑↓▾]/g,'').trim()),rowIds:rows.map(e=>e.dataset.registrationCarId),hidden:[...table.querySelectorAll('[data-purchase-column]')].filter(e=>!visible(e)).map(e=>e.dataset.purchaseColumn)};
 });}
async function assertGeometry(p,label){const g=await geometry(p);
 assert(g.host.scroll<=g.host.client+1,label+' has no horizontal list scrolling: '+JSON.stringify(g));
 assert(g.pageWidth<=g.width+1,label+' has no document overflow');assert(g.table.width<=g.host.width+1,label+' table fits its region');
 for(const cell of g.cells){assert(cell.x>=g.host.x-1&&cell.right<=g.host.right+1,label+' all chosen cells stay inside the list');assert(cell.scroll<=cell.client+1,label+' cell contents are readable and fit: '+JSON.stringify(cell));if(g.flow){assert.equal(g.tableRole,'table');assert(g.rowRoles.every(r=>r==='row'));assert(cell.label&&g.labels.includes(cell.label),'Each original visible value is labelled by its column');assert(cell.font>=11);}if(['plate','buyPrice','expectedSellPrice','purchaseDate'].includes(cell.col))assert.equal(cell.fragments.length,1,label+' keeps a number/date on a single line: '+JSON.stringify(cell));}
 records.push({case:label,geometry:g});return g;
}
async function allColumns(p,all){const tools=p.locator('#snote-purchase-tools-toggle');if(await tools.isVisible()&&await tools.getAttribute('aria-expanded')!=='true')await tools.click();await p.locator('#snote-purchase-columns-trigger').click();if(all){for(const choice of await p.locator('#snote-purchase-columns input:not(:disabled)').all())await choice.setChecked(true);}else{await p.locator('#snote-purchase-columns [data-purchase-preset=basic]').click();}await p.keyboard.press('Escape');await settle(p);}
async function screenshot(p,name){await p.mouse.move(0,0);await p.locator('#snote-icon-tooltip').waitFor({state:'hidden'}).catch(()=>{});await p.screenshot({path:path.join(OUT,name)});}
async function baseline(p,label){
 await p.evaluate(()=>{document.querySelector('link[href*="vehicle-list-responsive.css"]').sheet.disabled=true;});await settle(p);
 records.push({case:label,beforeResponsiveStyles:true,geometry:await geometry(p)});
 await p.evaluate(()=>{document.querySelector('link[href*="vehicle-list-responsive.css"]').sheet.disabled=false;SnoteVehicleListResponsive.refresh();});await settle(p);
}
async function dropdown(p){const trigger=p.locator('#list-table .snote-status-trigger:not([hidden])').first();await trigger.scrollIntoViewIfNeeded();await trigger.click();const menu=p.locator('#snote-status-menu');await menu.waitFor({state:'visible'});const r=await menu.boundingBox(),v=p.viewportSize();assert(r.x>=0&&r.y>=0&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,'Status menu remains positioned in the viewport');assert(await menu.getByRole('option').count()>=3);await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert(await trigger.evaluate(e=>document.activeElement===e),'Status menu returns focus to the original action');}
async function interactions(p){
 const before=await p.evaluate(()=>JSON.stringify({cars,mediaByCar,covers,writes:__encarFixtureWrites}));
 const sort=p.locator('#list-table th[data-purchase-column=buyPrice] .snote-sort-header');await sort.click();await settle(p);await dropdown(p);
 const photo=p.locator('#list-table [data-snote-list-photo]').first();await photo.click();await p.waitForFunction(()=>document.getElementById('zoom-overlay').dataset.imageState==='ready');assert.equal(await p.locator('#vehicle-overlay').isVisible(),false);await p.keyboard.press('Escape');await p.locator('#zoom-overlay').waitFor({state:'hidden'});
 await p.locator('#list-pagination [aria-label="2페이지"]').click();await settle(p);assert.equal(await p.locator('#list-table tbody tr').count(),5);await assertGeometry(p,'1024/page-2');await p.locator('#list-pagination [aria-label="1페이지"]').click();await settle(p);
 const row=p.locator('#list-table tbody tr').first();await row.focus();await p.keyboard.press('Enter');await p.locator('#vehicle-overlay.open').waitFor();await p.evaluate(()=>closeVehicle({discard:true}));await p.locator('#vehicle-overlay').waitFor({state:'hidden'});
 assert.equal(await p.evaluate(()=>JSON.stringify({cars,mediaByCar,covers,writes:__encarFixtureWrites})),before,'Responsive sorting, paging, photos and detail do not write/copy/change vehicles');
 // Existing restrictions win over the responsive display rules.
 await p.evaluate(()=>{const table=document.querySelector('#list-table table');window.__responsiveHidden=table.tBodies[0].rows[0].querySelector('[data-purchase-column=inventoryLoan]');__responsiveHidden.hidden=true;SnoteVehicleListResponsive.refresh();});
 assert.equal(await p.evaluate(()=>getComputedStyle(__responsiveHidden).display),'none','HTML hidden cells stay hidden');await p.evaluate(()=>{__responsiveHidden.hidden=false;});
 await p.evaluate(()=>{const body=document.querySelector('#list-table tbody');window.__responsiveRows=[...body.children];const row=document.createElement('tr'),cell=row.insertCell();cell.colSpan=20;cell.textContent='가상 빈 목록 안내';body.replaceChildren(row);SnoteVehicleListResponsive.refresh();});
 const empty=await p.locator('#list-table tbody td').boundingBox(),rowWidth=await p.locator('#list-table tbody tr').evaluate(row=>row.getBoundingClientRect().width-parseFloat(getComputedStyle(row).borderLeftWidth)-parseFloat(getComputedStyle(row).borderRightWidth));assert(Math.abs(empty.width-rowWidth)<1,'A colspan empty state occupies the whole row inside its emphasis border');assert.equal(await p.locator('#list-table tbody td').getAttribute('data-snote-list-label'),null);
 await p.evaluate(()=>{document.querySelector('#list-table tbody').replaceChildren(...__responsiveRows);SnoteVehicleListResponsive.refresh();});
}
async function dealer(browser){setBrowser(browser);const f=await fixture(1024,null,{lookupUnavailable:true}),p=f.page;try{await seed(p);await mode(p,'list');
 for(const width of[1024,1280,1366,1440,1920]){await p.setViewportSize({width,height:950});await settle(p);await baseline(p,'baseline/default/'+width);const after=await assertGeometry(p,'dealer/default/'+width);if([1024,1366].includes(width))await screenshot(p,'default-'+width+'.png');if(width===1920)assert.equal(after.flow,null,'Wide desktop default keeps the table presentation');}
 await p.setViewportSize({width:1024,height:950});await allColumns(p,true);
 for(const width of[1024,1280,1366,1440,1920]){await p.setViewportSize({width,height:950});await settle(p);await baseline(p,'baseline/all/'+width);const g=await assertGeometry(p,'dealer/all/'+width);assert.equal(g.columns.length,20,'All 20 chosen fields remain visible');if(width===1024)await screenshot(p,'all-1024.png');}
 await p.setViewportSize({width:1024,height:950});await settle(p);await interactions(p);
 await allColumns(p,false);const preset=await assertGeometry(p,'dealer/basic-preset/1024');assert(!preset.columns.some(id=>['vin','documents','quote','inventoryLoan'].includes(id)),'Responsive cells preserve the chosen hidden columns');
 // Personal selection preferences and actual nodes survive responsive reflow.
 const selected=await p.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('snote:purchase-columns:')))));
 await p.evaluate(()=>window.__responsiveNodes=[...document.querySelectorAll('#list-table tbody tr')]);await p.setViewportSize({width:1920,height:950});await settle(p);assert(await p.evaluate(()=>__responsiveNodes.every(e=>e.isConnected)));assert.equal(await p.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('snote:purchase-columns:'))))),selected);
 for(const width of[360,390]){await p.setViewportSize({width,height:844});await mode(p,'cards');const g=await p.locator('#list-mobile').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,document:document.documentElement.scrollWidth,viewport:innerWidth,cards:[...el.querySelectorAll('.vehicle-card')].map(c=>({client:c.clientWidth,scroll:c.scrollWidth,width:c.getBoundingClientRect().width}))}));assert(g.scroll<=g.client+1&&g.document<=g.viewport+1);assert(g.cards.every(c=>c.scroll<=c.client+1));assert.equal(await p.locator('#list-table').getAttribute('data-snote-list-flow'),null);records.push({case:'mobile/cards/'+width,geometry:g});}
 await p.setViewportSize({width:1024,height:950});await mode(p,'list');await p.evaluate(()=>{cars[0].status='판매완료';cars[0].soldAt=todayLocal();cars[0].soldPrice=42750000;navigate('sell');});await settle(p);await assertGeometry(p,'dealer/sold/1024');assert.equal(await p.locator('#list-table .snote221-income-button').count(),1);await dropdown(p);
 await finish(f);console.log('PASS vehicle responsive dealer/default/all/presets/sold, 1024–1920px, 360/390px mobile, numbers, labels, focus, sorting, paging, photos, unchanged source/preferences and hidden controls');
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-dealer.png'),fullPage:true}).catch(()=>{});await f.context.close();throw e;}}
async function company(browser){setBrowser(browser);const f=await fixture(1024,null,{lookupUnavailable:true}),p=f.page;try{await companySetup(p);await p.evaluate(()=>{currentUser.role='accountant';__encarFixtureState.members[0].role='accountant';buildMenus();navigate('buy');});await p.waitForFunction(()=>snoteEnsureCompanyPurchase()===true);await settle(p);await mode(p,'list');await assertGeometry(p,'accountant/default/1024');await allColumns(p,true);await assertGeometry(p,'accountant/all/1024');
 await p.evaluate(()=>{currentUser.role='admin';__encarFixtureState.members[0].role='admin';buildMenus();navigate('companyBuy');});await p.waitForFunction(()=>snoteEnsureCompanyPurchase()===true);await settle(p);await assertGeometry(p,'admin/company/1024');await finish(f);console.log('PASS accountant default/all and admin company purchase use the same responsive rows without changing selected fields');
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-company.png'),fullPage:true}).catch(()=>{});await f.context.close();throw e;}}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{await dealer(browser);await company(browser);fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({ok:true,syntheticOnly:true,productionWrites:0,records},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
