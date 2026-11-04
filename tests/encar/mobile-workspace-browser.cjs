'use strict';
// Real application and Chromium, with the existing isolated fixture's synthetic
// auth, data and routed HTTP. Never contacts a production service or sends SMS.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {fixture,finish,setBrowser}=require('./browser-smoke.cjs');
const ARTIFACTS=process.env.ENCAR_TEST_ARTIFACT_DIR||path.join(require('node:os').tmpdir(),'snote-encar-browser');
const baseline=process.env.SNOTE_MOBILE_BASELINE==='1';
const widths=(process.env.SNOTE_MOBILE_WIDTHS||'320,390,430').split(',').map(Number);
const output=path.join(ARTIFACTS,baseline?'mobile-baseline':'mobile-v258');
fs.mkdirSync(output,{recursive:true});
const results=[];
async function audit(page,width,role,route){
 const facts=await page.evaluate(()=>{
  const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const rows=[...document.querySelectorAll('#snote-app .content input:not([type=checkbox]):not([type=radio]):not([type=file]),#snote-app .content select,#snote-app .content textarea')].filter(visible);
  const bounds=e=>{const b=e.getBoundingClientRect();return{left:b.left,right:b.right,width:b.width,height:b.height};};
  const title=document.getElementById('screen-title');
  const labels=[...document.querySelectorAll('#snote-app :is(.vehicle-meta,.vehicle-inventory-meta,.snote202-mobile-age,.acct-mobile-fields label,.fin-mobile-card p,.ps-mobile-meta,.ps-fields label,.snote-company-fields label)')].filter(visible).map(e=>({class:e.className,text:e.textContent.slice(0,30),font:parseFloat(getComputedStyle(e).fontSize)}));
  return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,labels,title:{text:title.textContent,size:parseFloat(getComputedStyle(title).fontSize),...bounds(title)},inputs:rows.map(e=>({id:e.id,tag:e.tagName,font:parseFloat(getComputedStyle(e).fontSize),...bounds(e)})),overflowing:[...document.querySelectorAll('#snote-app .content *')].filter(e=>visible(e)&&e.getBoundingClientRect().right>innerWidth+2&&!e.closest('.tablewrap,.table-scroll,.ps-scroll,.table-wrapper,.table-container,.fin-table,.acc44-chart-wrap')).slice(0,12).map(e=>({tag:e.tagName,id:e.id,class:e.className,...bounds(e)}))};
 });
 results.push({width,role,route,...facts});
 await page.screenshot({path:path.join(output,`${width}-${role}-${route}.png`),fullPage:true});
 if(!baseline){assert(facts.documentWidth<=width+1,`${role}/${route}/${width}: document overflow ${facts.documentWidth}`);assert(facts.title.size>=18,`${role}/${route}/${width}: page title is too small ${facts.title.size}`);for(const label of facts.labels)assert(label.font>=12,`${role}/${route}/${width}: ${label.class} label too small ${label.font}`);for(const input of facts.inputs){assert(input.font>=16,`${role}/${route}/${width}: ${input.id||input.tag} input font ${input.font} triggers mobile zoom`);assert(input.left>=-1&&input.right<=width+1,`${role}/${route}/${width}: input ${input.id||input.tag} leaves viewport`);}}
 console.log('PASS mobile '+width+' '+role+'/'+route+(baseline?' baseline':'')+' '+facts.inputs.length+' controls, document '+facts.documentWidth+'px');
}
async function roles(page,role){
 await page.evaluate(role=>{
  currentUser.role=role;currentUser.name='모바일 검증 담당자';
  const S=window.__encarFixtureState;S.members[0].role=role;
  document.getElementById('profile-name').textContent=currentUser.name+' · '+(role==='admin'?'관리자':role==='accountant'?'경리':'딜러');
  buildStats();buildMenus();
 },role);
}
async function run(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
 for(const width of widths){
  const f=await fixture(width),p=f.page;
  if(baseline)await p.evaluate(()=>document.querySelectorAll('link[href*=\"mobile-shell.css\"],link[href*=\"mobile-workspace.css\"]').forEach(e=>e.remove()));
  await f.context.route('**/income-settlement.html?*',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:fs.readFileSync(path.resolve(__dirname,'../../income-settlement.html'))}));
  const incomeRequests=[];let incomeReply=null;
  await f.context.route('**/api/income-settlement',route=>{const body=JSON.parse(route.request().postData());assert.equal(body.action,'load');assert.equal(body.carId,'encar-car-2');incomeRequests.push(body);assert(incomeReply);return route.fulfill({contentType:'application/json',body:JSON.stringify(incomeReply)});});
  await p.locator('#vehicle-overlay .detail-close').click();
  await p.evaluate(()=>{
   const today=new Date(),month=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
   cars[0].model='테슬라 모델 Y 롱레인지 AWD';cars[0].purchaseAt=month+'-01';cars[0].color='흰색';cars[0].inventoryLoan=9000000;cars[0].inventoryLender='KB캐피탈';
   cars[1].model='메르세데스 벤츠 E300 아방가르드';cars[1].status='판매완료';cars[1].soldAt=month+'-03';cars[1].soldPrice=17000000;cars[1].purchaseAt=month+'-01';cars[1].color='검정색';
   window.__encarFixtureCars=structuredClone(cars);
   // Respect the monthly adapter's maybeSingle contract while retaining the
   // shared fixture for all normal car reads. This is an empty synthetic book.
   const client=window.__encarFixtureState.client,originalFrom=client.from.bind(client);
   client.from=table=>{
    if(['zc_companies','zc_members'].includes(table)){
     const S=window.__encarFixtureState,company={id:S.company.id,name:'모바일 검증 상사',business_number:'0000000000',representative_name:'가상 대표',business_postcode:'00000',business_address:'가상 테스트로 1',business_address_detail:'101호',business_phone:'02-0000-0000'},members=[{...S.members[0],display_name:'모바일 검증 담당자',phone:'010-0000-0000'},{user_id:'22222222-2222-4222-8222-222222222222',company_id:S.company.id,role:'dealer',display_name:'가상 검증 직원',active:true}];
     let single=false;const filters={};const result={select(){return result},eq(key,value){filters[key]=value;return result},order(){return result},single(){single=true;return result},maybeSingle(){single=true;return result},then(resolve,reject){const rows=table==='zc_companies'?[company]:members.filter(m=>!filters.user_id||m.user_id===filters.user_id);return Promise.resolve({data:single?rows[0]:rows,error:null}).then(resolve,reject);}};return result;
    }
    const chain=originalFrom(table);if(table!=='zc_datasets')return chain;let dataset=null;const eq=chain.eq,then=chain.then;chain.eq=(key,value)=>{if(key==='dataset')dataset=value;eq(key,value);return chain;};chain.then=(resolve,reject)=>dataset==='monthly'?Promise.resolve({data:{payload:[],revision:0},error:null}).then(resolve,reject):then(resolve,reject);return chain;
   };
  });
  for(const [role,routes] of [['dealer',['buy','sell','users']],['admin',['buy','sell','finance','prestock','inventoryFinance','monthly','settings','acctFinance']],['accountant',['buy','sell','prestock','inventoryFinance','monthly','finance']]]){
   await roles(p,role);
   for(const route of routes){await p.evaluate(route=>navigate(route),route);await p.waitForTimeout(100);if(route==='settings'){await p.locator('#snote90-company-save:not([disabled])').waitFor();assert.equal(await p.locator('#snote90-company-name').inputValue(),'모바일 검증 상사');assert.equal(await p.locator('#snote90-company-phone').isEnabled(),true);assert.equal(await p.locator('.snote90-member').count(),2);assert.match(await p.locator('#snote90-company-message').textContent(),/상사정보를 불러왔습니다/);}
    assert.equal(await p.evaluate(()=>route),route);await audit(p,width,role,route);
    if(route==='monthly'){
     const monthly=p.frameLocator('#monthly-ledger-frame');await monthly.locator('#book-fields:not([disabled])').waitFor();
     const metrics=await monthly.locator('body').evaluate(body=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,fonts:[...body.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,font:parseFloat(getComputedStyle(e).fontSize)})),scrollable:[...body.querySelectorAll('.table-scroll')].some(e=>e.scrollWidth>e.clientWidth)}));
     if(!baseline){assert(metrics.documentWidth<=metrics.width+1,'Monthly ledger must scroll tables inside the frame');for(const field of metrics.fonts)assert(field.font>=16,'Monthly '+field.id+' readable mobile input');assert(metrics.scrollable,'Wide ledger columns must remain available through local horizontal scrolling');}
     results.push({width,role,route:'monthly-iframe',...metrics});
    }
   }
  }
  await roles(p,'dealer');await p.evaluate(()=>navigate('sell'));
  incomeReply=await p.evaluate(async()=>{const model=await import('./assets/income-settlement-model.js');const source=model.createSource(cars[1],{dealerName:currentUser.name,companyName:currentUser.company,ownerId:window.__encarFixtureState.user.id});return{ok:true,stored:false,source,sourceVersion:await model.sourceFingerprint(source),document:model.createDocument(source),baseVersion:null,revision:0};});
  await p.locator('#list-mobile .snote221-income-button').click();
  const income=p.frameLocator('#snote221-income-frame');await income.locator('#income-save:not([disabled])').waitFor();
  const incomeMetrics=await income.locator('body').evaluate(body=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,fonts:[...body.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,font:parseFloat(getComputedStyle(e).fontSize)})),labelSize:parseFloat(getComputedStyle(body.querySelector('.income-field-label')).fontSize)}));
  if(!baseline){assert(incomeMetrics.documentWidth<=incomeMetrics.width+1,'Income document must stay within its frame');assert(incomeMetrics.labelSize>=12,'Income labels must be readable');for(const field of incomeMetrics.fonts)assert(field.font>=16,'Income '+field.id+' readable mobile input');}
  results.push({width,role:'dealer',route:'income-iframe',...incomeMetrics});await p.screenshot({path:path.join(output,width+'-income.png')});assert.equal(incomeRequests.length,1);await p.locator('#snote221-income-loading-close').click();await p.locator('#snote221-income-dialog').waitFor({state:'hidden'});
  await p.evaluate(()=>navigate('buy'));
  if(!baseline)for(const selector of ['#mobile-menu-trigger','#snote-calculator-trigger','#snote-profile-trigger']){const box=await p.locator(selector).boundingBox();assert(box&&box.width>=44&&box.height>=44,selector+' must retain a44px touch area');assert(box.x>=0&&box.x+box.width<=width+1,selector+' must fit viewport');}
  await p.locator('#mobile-menu-trigger').click();await p.locator('#mobile-drawer[aria-hidden=false]').waitFor();
  const menu=p.locator('#mobile-drawer-nav button').filter({hasText:'판매 완료'});await menu.click();assert.equal(await p.evaluate(()=>route),'sell');assert.equal(await p.locator('#mobile-menu-trigger').getAttribute('aria-expanded'),'false');
  await p.locator('#snote-calculator-trigger').click();await p.locator('#snote-calculator-panel:not([hidden])').waitFor();await p.screenshot({path:path.join(output,width+'-calculator.png')});await p.evaluate(()=>window.snoteCloseCalculator?.());
  await p.locator('#snote-profile-trigger').click();await p.locator('#snote-profile-menu:not([hidden])').waitFor();await p.screenshot({path:path.join(output,width+'-profile.png')});await p.keyboard.press('Escape');
  await finish(f);
 }
 }finally{fs.writeFileSync(path.join(output,'geometry.json'),JSON.stringify(results,null,2));await browser.close();}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
