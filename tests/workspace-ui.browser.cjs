'use strict';
// Actual HTML and shared synthetic fixture: no production data or external API calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser}=require('./encar/browser-smoke.cjs');
const ART=process.env.WORKSPACE_UI_ARTIFACTS||path.join(require('node:os').tmpdir(),'snote-workspace-v236');fs.mkdirSync(ART,{recursive:true});
async function geometry(p,root,selector='.snote-popup-close'){
 const button=p.locator(root+' '+selector).first();await button.waitFor({state:'visible'});
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await p.waitForFunction(selector=>Math.abs(document.querySelector(selector).getBoundingClientRect().width-30)<.001,root+' '+selector);
 const g=await button.evaluate(b=>{const r=b.getBoundingClientRect(),f=b.parentElement.getBoundingClientRect(),s=getComputedStyle(b),cx=r.x+15,cy=r.y+15;return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,color:s.color,bg:s.backgroundColor,radius:s.borderRadius,cornerX:f.right,cornerY:f.top,points:[[0,0],[12,0],[-12,0],[0,12],[0,-12]].map(([dx,dy])=>document.elementFromPoint(cx+dx,cy+dy)?.outerHTML.slice(0,180)),hit:[[0,0],[12,0],[-12,0],[0,12],[0,-12]].every(([dx,dy])=>document.elementFromPoint(cx+dx,cy+dy)?.closest('button')===b),vw:innerWidth,vh:innerHeight}});
 assert(Math.abs(g.width-30)<.01,root);assert(Math.abs(g.height-30)<.01,root);assert.equal(g.radius,'6px',root);assert.equal(g.bg,'rgba(0, 0, 0, 0)',root);assert.equal(g.color,'rgb(129, 134, 155)',root);assert(g.x>=0&&g.y>=0&&g.right<=g.vw&&g.bottom<=g.vh,JSON.stringify({root,g}));assert(g.hit,JSON.stringify({root,g}));
 if(!root.includes('calculator')){assert(Math.abs(g.right-(g.cornerX-10))<2,root+' corner X');assert(Math.abs(g.y-(g.cornerY+10))<2,root+' corner Y');}
 return button;
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of [1440,390,320]){
  const f=await fixture(width),p=f.page;
  await p.evaluate(()=>closeVehicle({discard:true}));
  assert.deepEqual(await p.evaluate(()=>({dashboard:Object.hasOwn(pages,'dashboard'),cars:Object.hasOwn(pages,'cars'),default:snoteDefaultPage()})),{dashboard:false,cars:false,default:'buy'});
  for(const role of ['dealer','admin','accountant']){await p.evaluate(role=>{currentUser.role=role;buildMenus()},role);assert.equal(await p.locator('#desktop-nav button[onclick*="dashboard"],#desktop-nav button[onclick*="\'cars\'"]').count(),0);}
  await p.evaluate(()=>{currentUser.role='dealer';buildMenus();cars=Array.from({length:45},(_,i)=>({id:'page-car-'+i,ownerId:currentUser.username,model:'가상차 '+String(i).padStart(2,'0'),plate:'00가'+String(i).padStart(4,'0'),purchaseAt:'2026-11-03',buy:1000,sell:1200,status:'판매중'}));window.__pageSource=JSON.stringify(cars);navigate('buy');});
  const row=width>=800?'#list-table tbody tr':'#list-mobile .vehicle-card';assert.equal(await p.locator(row).count(),20);await p.locator('#list-pagination button[aria-label="3페이지"]').click();assert.equal(await p.locator(row).count(),5);assert.equal(await p.locator('#list-pagination [aria-current=page]').textContent(),'3');
  await p.locator('#list-query').fill('가상차 0');assert.equal(await p.locator(row).count(),10);assert.equal(await p.locator('#list-pagination').isVisible(),false);await p.locator('#list-query').fill('');assert.equal(await p.locator(row).count(),20);assert.equal(await p.locator('#list-pagination [aria-current=page]').textContent(),'1');assert.equal(await p.evaluate(()=>JSON.stringify(cars)===window.__pageSource),true);
  await p.locator('#list-pagination button[aria-label="3페이지"]').click();await p.evaluate(()=>{cars=cars.slice(0,21);renderCars()});assert.equal(await p.locator(row).count(),1);assert.equal(await p.locator('#list-pagination [aria-current=page]').textContent(),'2');
  await p.screenshot({path:path.join(ART,'pagination-'+width+'.png')});
  await p.evaluate(()=>openVehicle('page-car-0'));await geometry(p,'#vehicle-overlay');await p.evaluate(()=>closeVehicle({discard:true}));
  // Open every existing non-native popup in isolation. Existing handler identity must survive migration.
  const roots=['#overlay','#vin-select-overlay','#quote-overlay','#contract-overlay','#status-overlay','#ps-confirm-overlay','#zc-dashboard-gate','#zc-auto-reg-overlay','#zc182-finance-overlay','#zc80-unlock','#zc85-postcode-overlay','#zc76-receipt-overlay','#zoom-overlay','#snote201-image-zoom'];
  for(const root of roots){
   await p.evaluate(root=>{const e=document.querySelector(root);e.hidden=false;e.classList.add('open');e.setAttribute('aria-hidden','false');},root);
   const button=await geometry(p,root);assert(await button.getAttribute('onclick')||root==='#zc85-postcode-overlay',root+' preserves original handler');
   if(root==='#zc76-receipt-overlay'){assert.equal(await p.locator(root+' .snote-popup-close').count(),1);assert.equal(await p.locator(root+' button[onclick="zc76PrintReceipt()"]').textContent(),'인수증 인쇄');}
   const before=await button.boundingBox();await p.evaluate(root=>{const card=document.querySelector(root+' .snote-popup-card,.snote-zoom-body');if(card)card.scrollTop=1000},root);const after=await button.boundingBox();assert(Math.abs(before.y-after.y)<1,root+' fixed relative to its frame');
   if(root==='#overlay')await p.screenshot({path:path.join(ART,'registration-close-'+width+'.png')});
   await p.evaluate(root=>{const e=document.querySelector(root);e.classList.remove('open');e.hidden=true;e.setAttribute('aria-hidden','true');},root);
  }
  await p.evaluate(()=>document.getElementById('snote-profile-dialog').showModal());const profile=await geometry(p,'#snote-profile-dialog');await profile.click();assert.equal(await p.locator('#snote-profile-dialog').evaluate(e=>e.open),false);
  await p.locator('#snote-calculator-trigger').click();await geometry(p,'#snote-calculator-panel');await p.locator('#snote-calculator-close').click();
  await p.evaluate(()=>{currentUser.role='admin';cars=Array.from({length:45},(_,i)=>({id:'finance-page-'+i,ownerId:currentUser.username,model:'금융가상차 '+i,plate:'10가'+String(i).padStart(4,'0'),buy:1000,sell:1200,status:'판매중',inventoryLoan:100,inventoryLender:'KB캐피탈'}));navigate('inventoryFinance');});
  const finRow=width>=800?'#inventory-finance-tbody tr':'#inventory-finance-mobile .fin-mobile-card';assert.equal(await p.locator(finRow).count(),20);await p.locator('#finance-pagination [aria-label="3페이지"]').click();assert.equal(await p.locator(finRow).count(),5);await p.locator('#inventory-finance-search').fill('금융가상차 1');assert.equal(await p.locator(finRow).count(),11);assert.equal(await p.locator('#finance-pagination').isVisible(),false);
  await p.evaluate(()=>navigate('finance'));assert.equal(await p.locator('.snote-profit-table tbody tr').count(),20);await p.locator('#profit-pagination [aria-label="3페이지"]').click();assert.equal(await p.locator('.snote-profit-table tbody tr').count(),5);
  await p.evaluate(()=>navigate('acctFinance'));assert.equal(await p.locator('#acct-finance-table tbody tr').count(),20);await p.locator('#acct-finance-pagination [aria-label="3페이지"]').click();assert.equal(await p.locator('#acct-finance-table tbody tr').count(),5);
  assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS '+width+' pagination boundaries/search/source preservation, retired pages, all popup geometry/scrolling, native profile and calculator close');
 }
}finally{await browser.close()}})().catch(error=>{console.error(error.stack);process.exitCode=1});
