'use strict';
// Actual detail markup/CSS and native Chromium focus/scroll; every account,
// vehicle, image and response belongs to the isolated synthetic fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const {setup:setupCompanyCatalog}=require('./company-purchase.browser.cjs');
const OUT=process.env.DETAIL_VIEWPORT_ARTIFACT_DIR||'/workspace/work/ui-v2163/browser';
const SIZES=(process.env.DETAIL_VIEWPORT_SIZES||'1440x900,1366x768,1280x720,390x844,320x740').split(',').map(s=>s.split('x').map(Number));
const results=[];fs.mkdirSync(OUT,{recursive:true});
const nextFrame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function geometry(page){
 return page.evaluate(()=>{
  const modal=document.querySelector('#vehicle-overlay .vehicle-modal'),visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const selectors=['.vehicle-header','.vehicle-body','#vehicle-overview','.vehicle-info-column','.car-identity-section','.vehicle-memo-section','#car-cost-section','.vehicle-media-grid','.vehicle-photo-panel','.vehicle-document-panel','#sold-info-section','#acct-readonly-panel'];
  const sections=Object.fromEntries(selectors.map(selector=>{const e=document.querySelector('#vehicle-overlay '+selector);return[selector,e&&visible(e)?box(e):null];}));
  const frame=box(modal),controls=[...modal.querySelectorAll('input,select,textarea,button,a[href]')].filter(visible).map(e=>({id:e.id||e.getAttribute('aria-label')||e.textContent.trim().slice(0,35),...box(e),font:parseFloat(getComputedStyle(e).fontSize)}));
  const horizontal=controls.filter(e=>e.x<frame.x-.75||e.right>frame.right+.75||e.width<1);
  const clippedLabels=[];
  for(const label of modal.querySelectorAll('.vehicle-identity-grid>label,#car-cost-section .cost-edit>label,.detail-summary .sum-cell strong')){
   if(!visible(label))continue;const bounds=label.getBoundingClientRect();
   for(const node of label.childNodes){if(node.nodeType!==Node.TEXT_NODE||!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.left<bounds.left-.75||r.right>bounds.right+.75)clippedLabels.push(node.textContent.trim());}
  }
  return{viewport:{width:innerWidth,height:innerHeight},frame:box(document.querySelector('#vehicle-overlay .vehicle-detail-frame')),modal:frame,scrollHeight:modal.scrollHeight,clientHeight:modal.clientHeight,scrollTop:modal.scrollTop,overflowStyle:getComputedStyle(modal).overflowY,pageOverflow:document.documentElement.scrollWidth>innerWidth,modalOverflow:modal.scrollWidth>modal.clientWidth+1,sections,controls,horizontal,clippedLabels};
 });
}
function assertGeometry(g,width,height,kind){
 assert(Math.abs(g.frame.height-height)<1&&Math.abs(g.modal.height-height)<1,kind+' frame must retain the full current viewport height');
 assert(g.frame.x>=-.5&&g.frame.right<=width+.5&&g.modal.y>=-.5&&g.modal.bottom<=height+.5,kind+' drawer must stay inside the viewport: '+JSON.stringify({frame:g.frame,modal:g.modal,viewport:g.viewport}));
 assert.equal(g.pageOverflow,false,kind+' must not widen the document');assert.equal(g.modalOverflow,false,kind+' must not introduce horizontal scrolling');
 assert.deepEqual(g.horizontal,[],kind+' controls must remain inside the drawer horizontally');assert.deepEqual(g.clippedLabels,[],kind+' labels and summary values must not be cut off');
 if(g.scrollHeight>g.clientHeight+1)assert(['auto','scroll'].includes(g.overflowStyle),kind+' overflow must remain scrollable');
}
async function reachableSections(page,sections,stem){
 for(const selector of sections){
  const section=page.locator('#vehicle-overlay '+selector);if(!await section.isVisible())continue;
  await section.scrollIntoViewIfNeeded();await nextFrame(page);
  const visible=await section.evaluate(e=>{const r=e.getBoundingClientRect(),modal=document.querySelector('#vehicle-overlay .vehicle-modal').getBoundingClientRect();return r.width>0&&r.bottom>modal.y&&r.top<modal.bottom;});
  assert(visible,'Detail section remains scroll-reachable: '+selector);
 }
 await page.screenshot({path:path.join(OUT,stem+'-bottom.png')});
}
async function keyboardFields(page,kind){
 const expected=await page.evaluate(()=>{
  const fields=[...document.querySelectorAll('#vehicle-overlay .vehicle-modal input,#vehicle-overlay .vehicle-modal select,#vehicle-overlay .vehicle-modal textarea')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden');
  return fields.map((e,i)=>{e.dataset.viewportField='field-'+i;return{key:e.dataset.viewportField,id:e.id||e.getAttribute('aria-label')||e.name||e.className};});
 });
 assert(expected.length>0,kind+' must have keyboard accessible fields');
 await page.locator('#vehicle-overlay .vehicle-modal').evaluate(e=>e.scrollTop=0);await page.locator('#vehicle-overlay .detail-close').focus();
 const visited=new Set(),obscured=[];
 for(let attempt=0;attempt<expected.length*5+30&&visited.size<expected.length;attempt++){
  await page.keyboard.press('Tab');await nextFrame(page);
  const active=await page.evaluate(()=>{const e=document.activeElement,key=e?.dataset?.viewportField;if(!key)return null;const r=e.getBoundingClientRect(),m=document.querySelector('#vehicle-overlay .vehicle-modal').getBoundingClientRect(),h=document.querySelector('#vehicle-overlay .vehicle-header').getBoundingClientRect();return{key,id:e.id||e.getAttribute('aria-label'),inside:r.left>=m.left-.75&&r.right<=m.right+.75&&(e.tagName==='TEXTAREA'?Math.min(r.bottom,m.bottom)-Math.max(r.top,h.bottom)>=Math.min(r.height,40):r.top>=h.bottom-.75&&r.bottom<=m.bottom+.75),top:r.top,bottom:r.bottom,headerBottom:h.bottom,modalBottom:m.bottom,scrollTop:document.querySelector('#vehicle-overlay .vehicle-modal').scrollTop};});
  if(active){visited.add(active.key);if(!active.inside)obscured.push(active);}
 }
 assert.deepEqual(expected.filter(field=>!visited.has(field.key)),[],kind+' all rendered form fields must be reachable using the actual Tab key');
 assert.deepEqual(obscured,[],kind+' keyboard focus must scroll fields into the usable part of the drawer');return{fields:expected.length,visited:visited.size};
}
async function populateMedia(page){
 await page.evaluate(async()=>{
  // Seed display memory only; the product's guarded online media write path is untouched.
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d');c.fillStyle='#dcebf9';c.fillRect(0,0,320,180);c.fillStyle='#215ea0';c.font='bold 24px sans-serif';c.fillText('SYNTHETIC VEHICLE',15,95);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const car=cars[0],records=Array.from({length:5},(_,i)=>({id:'viewport-photo-'+i,carId:car.id,ownerId:car.ownerId,group:'photos',filename:'합성 차량 사진 '+(i+1)+'.png',createdAt:i+1,blob}));
  for(const [i,group] of ['registration','inspection1','inspection2'].entries())records.push({id:'viewport-'+group,carId:car.id,ownerId:car.ownerId,group,filename:'합성 차량 서류 '+group+'.png',createdAt:i+10,blob});
  mediaByCar[car.id]=records.map(record=>({...record,url:URL.createObjectURL(record.blob)}));mediaObjectUrls.push(...mediaByCar[car.id].map(record=>record.url));renderVehicle();
 });await page.locator('#photo-grid .photo-thumb').nth(4).waitFor();
}
async function populatedMedia(f,width,height){
 const page=f.page;await populateMedia(page);
 assert.equal(await page.locator('.photo-thumb').count(),5);assert.equal(await page.locator('.doc-thumb').count(),1);
 const tiles=await page.locator('#photo-grid .photo-tile').evaluateAll(tiles=>tiles.map(tile=>{const r=tile.getBoundingClientRect(),buttons=[...tile.querySelectorAll('.tile-controls button')].map(e=>e.getBoundingClientRect());return{width:r.width,height:r.height,controlsInside:buttons.every(b=>b.left>=r.left-.75&&b.right<=r.right+.75&&b.top>=r.top-.75&&b.bottom<=r.bottom+.75),overlap:buttons[0].right>buttons[1].left+.75};}));
 assert(tiles.every(tile=>tile.controlsInside&&!tile.overlap),'All five thumbnail controls must remain inside their actual tiles: '+JSON.stringify(tiles));
 await page.locator('.photo-thumb').last().scrollIntoViewIfNeeded();await page.locator('.photo-thumb').last().focus();await page.keyboard.press('Enter');await page.locator('#zoom-overlay.open').waitFor();assert.equal(await page.evaluate(()=>zoomRecordId),'viewport-photo-4');await page.keyboard.press('Escape');
 await page.locator('#doc-tab-inspection').click();assert.equal(await page.locator('.doc-thumb').count(),2);await page.locator('.doc-thumb').last().focus();await page.keyboard.press('Space');await page.locator('#zoom-overlay.open').waitFor();assert.equal(await page.evaluate(()=>zoomRecordId),'viewport-inspection2');await page.keyboard.press('Escape');
 await reachableSections(page,['.vehicle-photo-panel','.vehicle-document-panel'],`dealer-populated-${width}x${height}`);
 const g=await geometry(page);assertGeometry(g,width,height,'Populated media');const keyboard=await keyboardFields(page,'Dealer');results.push({kind:'five photos, two-page documents, keyboard and native scroll',width,height,geometry:g,keyboard});
}
async function repairOverflow(f,width,height){
 const p=f.page;await p.evaluate(()=>renderRepairRows('detail',Array.from({length:40},(_,i)=>({memo:'합성 추가비용 '+(i+1),amount:i+1}))));
 const g=await geometry(p);assertGeometry(g,width,height,'Forty cost rows');assert(g.scrollHeight>g.clientHeight,'Many additional costs must produce scrolling rather than clipped data');
 await p.locator('#detail-repair-items .repair-memo').last().focus();await p.keyboard.press('Tab');await nextFrame(p);
 const tail=await p.locator('#detail-repair-items .repair-amount').last().evaluate(e=>{const r=e.getBoundingClientRect(),m=document.querySelector('#vehicle-overlay .vehicle-modal').getBoundingClientRect();return{focused:document.activeElement===e,top:r.top,bottom:r.bottom,modalTop:m.top,modalBottom:m.bottom};});
 assert(tail.focused&&tail.bottom<=tail.modalBottom+1&&tail.top>=tail.modalTop,'The last additional cost is keyboard reachable after native scrolling');
 await p.screenshot({path:path.join(OUT,`dealer-forty-costs-${width}x${height}.png`)});results.push({kind:'forty additional cost rows retain overflow',width,height,tail,scrollHeight:g.scrollHeight});
 await p.evaluate(()=>renderRepairRows('detail',[]));
}
async function settleDrawer(page){await nextFrame(page);await page.locator('#vehicle-overlay .vehicle-detail-frame').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));await nextFrame(page);}
async function soldAndAccountant(f,width,height){
 const p=f.page;await p.evaluate(()=>{cars[0].status='판매완료';cars[0].soldAt='2026-11-20';cars[0].soldPrice=12000000;openVehicle(cars[0].id);});await settleDrawer(p);
 assert.equal(await p.locator('#sold-info-section').isVisible(),true);assert.equal(await p.locator('#detail-sold-date').inputValue(),'2026-11-20');
 let g=await geometry(p);assertGeometry(g,width,height,'Sold vehicle');const keyboard=await keyboardFields(p,'Sold vehicle');await reachableSections(p,['#sold-info-section','.vehicle-document-panel'],`sold-${width}x${height}`);results.push({kind:'sold information remains visible and keyboard reachable',width,height,geometry:g,keyboard});
 await setupCompanyCatalog(p);await p.evaluate(()=>{currentUser.role='accountant';__encarFixtureState.members[0].role='accountant';document.body.classList.add('accountant-mode');navigate('buy');});await p.waitForFunction(()=>snoteEnsureCompanyPurchase()===true);await p.evaluate(()=>openVehicle('company-dealer-0'));await settleDrawer(p);
 assert.equal(await p.locator('#acct-readonly-panel').isVisible(),true,'Accountant detail must keep its original read-only information panel');assert.equal(await p.locator('.vehicle-info-column').isVisible(),false,'Accountant must not expose the dealer-only duplicate editable information');
 g=await geometry(p);assertGeometry(g,width,height,'Accountant');const accountantKeyboard=await keyboardFields(p,'Accountant');await reachableSections(p,['#acct-readonly-panel'],`accountant-${width}x${height}`);assert.equal(await p.evaluate(()=>__companyMock.writes.length),0);results.push({kind:'accountant read-only information and finance fields',width,height,geometry:g,keyboard:accountantKeyboard});
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{for(const [width,height] of SIZES){const f=await fixture(width),p=f.page;try{
  await p.setViewportSize({width,height});await p.locator('#toast').waitFor({state:'hidden'});await nextFrame(p);const g=await geometry(p);assertGeometry(g,width,height,'Default dealer');assert(g.sections['.car-identity-section']&&g.sections['.vehicle-memo-section']&&g.sections['#car-cost-section']&&g.sections['.vehicle-media-grid']);
  await p.screenshot({path:path.join(OUT,`dealer-default-${width}x${height}.png`)});results.push({kind:'default compact full-height dealer detail',width,height,geometry:g});
  await populatedMedia(f,width,height);if(width===1440||width===320)await repairOverflow(f,width,height);await soldAndAccountant(f,width,height);
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Viewport, keyboard and local media checks must not save any vehicle');await finish(f);console.log(`PASS detail v2.163 ${width}x${height}`);
 }catch(error){await p.screenshot({path:path.join(OUT,`failure-${width}x${height}.png`),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}}
 finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,actualSMSSent:0,results},null,2)+'\n');}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
