'use strict';
// Render the real local pages with the existing disposable account backends.
// This audit reads no operating account, customer, document or infrastructure data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {chromium} = require('./encar/node_modules/playwright');
const {setup:workspace} = require('./accountant-refinements-v2246.browser.cjs');
const {setup:scanner} = require('./accountant-scanner-v2247.browser.cjs');
const {boot:operator} = require('./operator-console.browser.cjs');
const {boot:normalBoot,backend:normalBackend} = require('./normal-login.browser.cjs');
const ROOT = path.resolve(__dirname,'..');
const PRODUCT_FILES=['index.html','assets/workspace-responsive-shell.css','assets/unified-search.css','assets/profile-compact.css','assets/home-dashboard.css','assets/accountant-information.css','assets/accountant-business-pages.css','assets/scanner.css','monthly.html','assets/customer-intake.css','assets/account-recovery.css','assets/snote-brand.png','assets/fonts/PretendardVariable.woff2'];
const sourceHashes=()=>Object.fromEntries(PRODUCT_FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const initialHashes=sourceHashes(),productCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
const OUT = process.env.SNOTE_LAYOUT_AUDIT_DIR || '/workspace/work/responsive-first-paint-v2251/overlap-audit';
const VIEWS = [[1024,600],[1280,720],[1366,768],[1440,900],[1920,1080],[360,740],[390,844]];
const records = [], errors = [];
fs.mkdirSync(OUT,{recursive:true});

function persist() {
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,operatingReads:0,operatingWrites:0,productCommit,sourceHashes:initialHashes,records,errors},null,2)+'\n');
}

async function settle(page) {
 await page.waitForFunction(()=>!document.querySelector('main.content[data-route-transition]')&&getComputedStyle(document.body).visibility==='visible');
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(async()=>{
  const nodes=[...document.querySelectorAll('.topbar,.sidebar,#snote-dashboard-home,#snote-accountant-information,#snote-scanner,#snote-accountant-business-page')];
  await Promise.all(nodes.flatMap(node=>node.getAnimations({subtree:true})).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
}

async function measure(page) {
 return page.evaluate(()=>{
  const visible=node=>{
   const r=node.getBoundingClientRect(),s=getComputedStyle(node);
   return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&node.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});
  };
  const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const name=node=>node.id?'#'+node.id:node.tagName.toLowerCase()+'.'+[...node.classList].join('.')+' '+(node.getAttribute('aria-label')||node.textContent||'').trim().replace(/\s+/g,' ').slice(0,65);
  const intentional=node=>!!node.closest('[hidden],.snote-print-root,#snote-print-root,.print-only,.snote-shell-nav-tooltip,[role=tooltip],[popover],dialog:not([open])');
  const withinScrollArea=node=>{
   for(let p=node.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+2)return true;}
   return false;
  };
  const roots=[...document.querySelectorAll('#snote-app .topbar,#snote-app>.sidebar,#snote-dashboard-home,#snote-customer-view,#snote-accountant-information,#snote-accountant-business-page,#snote-scanner,#snote-contract-office,#operator-app .topbar,#operator-main,#snote-account-recovery[open],.page-shell,.site-header,#monthly-shell')].filter(visible);
  const toolbarSelectors=['#snote-app .topbar','#snote-app .topright','.snote-info-toolbar','.snote-business-toolbar','.snote-scanner-toolbar','.snote-scanner-toolbar-main','.snote-scanner-toolbar-side','.snote-scheduler-toolbar','.snote-scheduler-layout','.snote-accountant-overview','.snote-accountant-summary','.snote-business-documents','#operator-main .list-toolbar','#operator-main .filters','#operator-app .topbar','.snote-recovery-tabs','.snote-recovery-actions','.wizard-actions','.address-input-row','.workbook-toolbar','.toolbar-actions','.summary-grid','.primary-grid','.secondary-grid'];
  const overlaps=[];
  for(const selector of toolbarSelectors){
   for(const row of document.querySelectorAll(selector)){
    if(!visible(row)||intentional(row))continue;
    const children=[...row.children].filter(e=>visible(e)&&!intentional(e)&&!['absolute','fixed'].includes(getComputedStyle(e).position)&&getComputedStyle(e).display!=='contents');
    for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
     const a=children[i],b=children[j],ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),w=Math.min(ar.right,br.right)-Math.max(ar.x,br.x),h=Math.min(ar.bottom,br.bottom)-Math.max(ar.y,br.y);
     if(w>2&&h>2)overlaps.push({row:selector,a:name(a),b:name(b),intersection:{width:w,height:h},ar:rect(a),br:rect(b)});
    }
   }
  }
  const outside=roots.filter(node=>!withinScrollArea(node)).filter(node=>{const r=node.getBoundingClientRect();return r.x< -1||r.right>innerWidth+1;}).map(node=>({name:name(node),...rect(node)}));
  const clippedControls=[];
  for(const node of document.querySelectorAll('#snote-app .topbar button,#snote-app .topbar input,.snote-info-toolbar button,.snote-info-toolbar select,.snote-business-toolbar button,.snote-scanner-toolbar button,#operator-main .list-toolbar button,#operator-main .list-toolbar input,#snote-account-recovery[open] input,#snote-account-recovery[open] button,.page-shell input,.page-shell button,.workbook-toolbar button,.workbook-toolbar input')){
   if(!visible(node)||intentional(node)||withinScrollArea(node))continue;
   const r=node.getBoundingClientRect();if(r.x< -1||r.right>innerWidth+1)clippedControls.push({name:name(node),...rect(node)});
  }
  const logos=[...document.querySelectorAll('[data-snote-service-brand] img')].filter(visible).map(node=>({name:name(node),box:rect(node),parent:rect(node.parentElement),naturalWidth:node.naturalWidth,naturalHeight:node.naturalHeight,fit:getComputedStyle(node).objectFit}));
  const failedLogos=logos.filter(item=>!item.naturalWidth||!item.naturalHeight||item.box.x<item.parent.x-1||item.box.right>item.parent.right+1||item.box.y<item.parent.y-1||item.box.bottom>item.parent.bottom+1);
  const clippedDialogs=[...document.querySelectorAll('dialog[open]')].filter(visible).filter(node=>{const r=node.getBoundingClientRect();return r.x< -1||r.right>innerWidth+1||r.y< -1||r.bottom>innerHeight+1;}).map(node=>({name:name(node),...rect(node)}));
  const page={width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth};
  const main=document.querySelector('#snote-app>.main');
  return{page,main:main&&visible(main)?rect(main):null,roots:roots.map(node=>({name:name(node),...rect(node)})),overlaps,outside,clippedControls,clippedDialogs,logos,failedLogos};
 });
}

async function inspect(page,role,route,subject=page) {
 for(const [width,height] of VIEWS){
  await page.setViewportSize({width,height});await settle(page);
  const geometry=await measure(subject),issues=geometry.page.documentWidth>geometry.page.width+1||geometry.overlaps.length||geometry.outside.length||geometry.clippedControls.length||geometry.clippedDialogs.length||geometry.failedLogos.length;
  const entry={role,route,width,height,issues:!!issues,...geometry};records.push(entry);persist();
  if(issues||width===1024||width===390)await page.screenshot({path:path.join(OUT,[role,route,width].join('-')+'.png'),fullPage:false});
  if(issues)console.log('FINDING '+role+' '+route+' '+width+' '+JSON.stringify({page:geometry.page,overlaps:geometry.overlaps,outside:geometry.outside,clippedControls:geometry.clippedControls,clippedDialogs:geometry.clippedDialogs,failedLogos:geometry.failedLogos}));
 }
 console.log('AUDIT '+role+' '+route+' '+VIEWS.length+' viewports');
}

async function navigation(page,id,options){
 assert.equal(await page.evaluate(async({id,options})=>window.navigate(id,options),{id,options}),true,'Allowed synthetic route '+id);
 await settle(page);
 if(id==='dashboard')await page.locator('#snote-dealer-scheduler[data-state=ready]').waitFor();
 if(id==='users'){
  await page.locator('#snote-customer-view').waitFor({state:'visible'});await page.locator('#snote-customer-search').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>route),'users');assert((await page.locator('#snote-customer-view').innerText()).trim().length>0,'Customer view renders actual toolbar/list content');
 }
 if(id==='acctInfo')await page.locator('#snote-accountant-information[data-info-state=ready]').waitFor();
 if(id==='contractArchive')await page.locator('#contract-office-archive-rows tr').first().waitFor();
}

async function workspaceAudit(browser,role){
 const f=await workspace(browser,1440,role+'@example.invalid'),page=f.page;
 try{
  const routes=role==='accountant'?['dashboard','contractArchive','contractOffice','acctOperations','acctBank','acctTax','acctLookup','acctDealerIncome','acctInfo']:['dashboard','users','settings'];
  for(const route of routes){
   try{await navigation(page,route);await inspect(page,role,route);}catch(error){errors.push({role,route,error:error.stack});persist();console.log('ERROR '+role+' '+route+' '+error.message);}
  }
  if(role==='accountant')for(const tab of ['contacts','staff']){await navigation(page,'acctInfo',{informationTab:tab});await page.locator('#snote-accountant-information[data-info-tab='+tab+']').waitFor();await inspect(page,role,'acctInfo-'+tab);}
  await f.finish();
 }catch(error){await f.context.close();throw error;}
}

async function usersAudit(browser){
 for(const role of ['dealer','admin']){
  const f=await workspace(browser,1440,role+'@example.invalid');
  try{await navigation(f.page,'users');await inspect(f.page,role,'users');await f.finish();}catch(error){await f.context.close();throw error;}
 }
}

async function monthlyAudit(browser){
 const f=await workspace(browser),page=f.page;
 try{
  await navigation(page,'acctInfo',{informationTab:'contacts'});await page.locator('#snote-accountant-information[data-info-tab=contacts]').waitFor();await inspect(page,'accountant','acctInfo-contacts');
  await navigation(page,'monthly');await page.frameLocator('#monthly-ledger-frame').locator('#month-input:not([disabled])').waitFor();
  const frame=page.frames().find(candidate=>new URL(candidate.url()).pathname==='/monthly.html');assert(frame);
  await inspect(page,'accountant','monthly-parent');await inspect(page,'accountant','monthly-frame',frame);await f.finish();
 }catch(error){await f.context.close();throw error;}
}

async function publicAudit(browser){
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),requests=[],external=[],pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 const origin='https://layout-public.example';
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(url.pathname==='/api/customer-intake'){
   const body=request.postDataJSON();assert.equal(body.action,'info','Layout audit must never send SMS or submit a customer');requests.push(body.action);
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:'pending',flowVersion:'wizard-v1',rrnEnabled:true,companyName:'가상 검증 상사',phoneMasked:'010-****-5678',expiresAt:'2099-01-01T00:00:00Z',car:{model:'가상 현대 그랜저 하이브리드 익스클루시브',plate:'12가3456',year:2026,km:12345,color:'흰색',sellWon:39800000}})});
  }
  const file=path.join(ROOT,decodeURIComponent(url.pathname));
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
  return route.fulfill({status:404,body:''});
 });
 try{
  await page.goto(origin+'/customer.html#'+'a'.repeat(64));await page.locator('#stage-car:not([hidden])').waitFor();
  await inspect(page,'public','customer-vehicle');await page.locator('#vehicle-confirmed').check();await page.locator('#vehicle-next').click();await page.locator('[data-wizard-step=name]:not([hidden])').waitFor();await inspect(page,'public','customer-name');
  assert.deepEqual(requests,['info']);assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);
 }finally{await context.close();}
 const f=await normalBoot(browser,normalBackend(),'layout-recovery');
 try{
  await f.page.locator('[data-account-recovery=id]').click();await f.page.locator('#snote-account-recovery[open]').waitFor();await inspect(f.page,'public','account-recovery');await f.finish();
 }catch(error){await f.context.close();throw error;}
}

async function scannerAudit(browser){
 const f=await scanner(browser),page=f.page;
 try{await navigation(page,'acctScanner');await page.locator('[data-scanner-record-id]').first().waitFor();await inspect(page,'accountant','acctScanner');await f.finish();}catch(error){await f.context.close();throw error;}
}

async function operatorAudit(browser){
 const f=await operator(browser,1440,{resume:true}),page=f.page;
 try{
  await f.ready();
  for(const route of ['vehicles','accounts','access']){
   await page.locator('#operator-navigation [data-view='+route+']').click();await page.waitForFunction(()=>document.querySelector('#operator-table-wrap').getAttribute('aria-busy')==='false');await inspect(page,'operator',route);
  }
  await f.finish();
 }catch(error){await f.context.close();throw error;}
}

if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 try{
  const group=process.env.SNOTE_LAYOUT_AUDIT_GROUP;
  if(!group||group==='dealer')await workspaceAudit(browser,'dealer');
  if(!group||group==='admin')await workspaceAudit(browser,'admin');
  if(!group||group==='accountant')await workspaceAudit(browser,'accountant');
  if(!group||group==='scanner')await scannerAudit(browser);
  if(!group||group==='operator')await operatorAudit(browser);
  if(group==='users'||group==='extra')await usersAudit(browser);
  if(!group||group==='monthly'||group==='extra')await monthlyAudit(browser);
  if(!group||group==='public'||group==='extra')await publicAudit(browser);
  persist();console.log('RESULT '+JSON.stringify({scenarios:records.length,findings:records.filter(row=>row.issues).length,errors:errors.length,out:OUT}));
  if(process.env.SNOTE_LAYOUT_AUDIT_STRICT==='1'){assert.deepEqual(errors,[]);assert.deepEqual(records.filter(row=>row.issues),[],'Visible workspace roots and control siblings must fit without overlap');assert.deepEqual(sourceHashes(),initialHashes,'Product sources stay frozen during layout verification');}
 }finally{await browser.close();}
})().catch(error=>{errors.push({fatal:error.stack});persist();console.error(error.stack||error);process.exitCode=1;});

module.exports={measure,inspect,VIEWS};
