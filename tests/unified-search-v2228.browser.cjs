'use strict';
// Real S-NOTE document and verified synthetic logins. Every request is intercepted;
// private business records below exist only in this disposable browser context.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,constants}=require('./normal-login.browser.cjs');
const OUT=process.env.SNOTE_UNIFIED_SEARCH_DIR||'/workspace/work/compact-workspace-v2228/search';
fs.mkdirSync(OUT,{recursive:true});
const FORM='#snote-global-search',INPUT='#snote-global-query',RESULTS='#snote-global-results';
const checked=[],record=(name,extra={})=>{checked.push({name,...extra});console.log('PASS '+name);};
const sourceFiles=['index.html','assets/unified-search.js','assets/unified-search.css','assets/search-focus.js','assets/search-focus.css','assets/received-share-list.js'];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
async function setup(browser,width=1440,role='dealer',reducedMotion=false){
 const state=backend(),originalFrom=state.from;
 state.from=(label,args)=>{const r=originalFrom(label,args);if(args.table==='zc_members'&&r.data)for(const row of Array.isArray(r.data)?r.data:[r.data])row.role=role;return r;};
 const context=await browser.newContext({viewport:{width,height:950},reducedMotion:reducedMotion?'reduce':'no-preference'});
 const f=await boot(browser,state,`unified-${role}-${width}`,{context});
 await f.login();await f.ready();await f.page.waitForFunction(()=>!__normalState.busy&&!!window.SnoteUnifiedSearch&&!!window.snoteUnifiedSearchBridge.context());
 assert.equal(await f.page.evaluate(()=>currentUser.role),role,'Role comes from the verified membership fixture');
 await f.page.evaluate(()=>{
  const owner=currentUser.username,base=cars[0]||{id:'synthetic-car'};
  cars.splice(0,cars.length,{...base,id:'synthetic-car',ownerId:owner,model:'BMW iX3',plate:'12가3456',vin:'SYNTHETICVIN101',brand:'BMW',year:2023,color:'파랑',vehicleMemo:'강남보관 신속탁송',buy:91827364,sell:81726354,inventoryLoan:71625344,profit:61524334,refund:51423324,rrnCipher:'SECRET_RRN_CIPHER',status:'판매중'},
   {...base,id:'synthetic-sold',ownerId:owner,model:'현대 그랜저',plate:'34나5678',vin:'SYNTHETICVIN202',year:2024,vehicleMemo:'분당보관',status:'판매완료',soldAt:'2026-11-15',soldPrice:41322314},
   {...base,id:'synthetic-other',ownerId:'other-unverified-owner',model:'타인비공유차량',plate:'99허9999',status:'판매중'});
  const c=window.__searchQA={owner,customerCalls:[],sharedCalls:[],opens:[],hold:false,releases:[],failCustomer:false,failShared:false};
  c.customers=[{ownerId:owner,carId:'synthetic-car',name:'가상 김고객',phone:'010-2222-3333',addressBase:'서울시 강남구',addressDetail:'테스트로 101',rrnCipher:'SECRET_CUSTOMER_CIPHER',rrn:'SECRET_IDENTITY_NUMBER',refundAccount:'SECRET_REFUND_ACCOUNT',refund:31221304},
   {ownerId:owner,carId:'synthetic-sold',name:'가상 이고객',phone:'010-4444-5555',address:'경기도 분당구',carModel:'현대 그랜저'},
   {ownerId:'other-unverified-owner',carId:'other-record',name:'타인비공유고객',phone:'010-9999-8888'}];
  c.shared=[{id:'synthetic-shared',ownerId:'shared-owner',model:'공유 아이오닉',plate:'56다7890',vin:'SYNTHETICVIN303',brand:'현대',year:2025,memo:'공유메모',status:'판매중',ownerLabel:'가상 공유딜러',shared:true}];
  const wait=async()=>{if(c.hold)await new Promise(resolve=>c.releases.push(resolve));};
  zc72ReadOwner=async ownerId=>{c.customerCalls.push(ownerId);await wait();if(c.failCustomer)throw Error('Synthetic customer failure');return structuredClone(c.customers);};
  const previous=window.SnoteReceivedVehicleList;
  window.SnoteReceivedVehicleList=Object.freeze({...previous,async searchRows(){c.sharedCalls.push(true);await wait();if(c.failShared)throw Error('Synthetic shared failure');return structuredClone(c.shared);},async searchOpen(id){c.opens.push(id);return true;}});
  c.release=()=>{c.hold=false;for(const release of c.releases.splice(0))release();};
  renderCars();
 });
 return{...f,state,async close(){await f.finish();await context.close();}};
}
async function search(page,query,{enter=false}={}){
 await page.locator(INPUT).fill(query);await page.locator(INPUT).focus();
 if(enter)await page.locator(INPUT).press('Enter');else await page.locator(FORM+' [type=submit]').click();
 await page.waitForFunction(()=>{const f=document.querySelector('#snote-global-search'),r=document.querySelector('#snote-global-results');return !f.hasAttribute('aria-busy')&&!r.hidden&&r.getAttribute('aria-busy')!=='true';});
 return page.locator(RESULTS).innerText();
}
async function closeSearch(page){await page.evaluate(()=>SnoteSearchFocus.close());await page.waitForFunction(()=>!SnoteSearchFocus.current);}
async function geometry(page){return page.evaluate(()=>{
 const form=document.querySelector('#snote-global-search'),topbar=form.closest('.topbar');
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 return{viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,form:rect(form),topbar:rect(topbar),blur:getComputedStyle(form,'::backdrop').backdropFilter,popover:form.matches(':popover-open'),motion:getComputedStyle(form).animationName};
});}
async function layoutCase(browser,width,reducedMotion=false){const f=await setup(browser,width,'dealer',reducedMotion),p=f.page;try{
 const before=await geometry(p);assert(before.form.width>150&&before.form.right<=width+1&&before.form.x>=-1);assert(before.document<=width+1,'No horizontal document overflow');
 if(width>=761)assert(Math.abs(before.form.x+before.form.width/2-(before.topbar.x+before.topbar.width/2))<3,'Search is centered in the desktop topbar');
 await p.screenshot({path:path.join(OUT,`closed-${width}${reducedMotion?'-reduced':''}.png`)});
 assert.deepEqual(await p.evaluate(()=>[__searchQA.customerCalls.length,__searchQA.sharedCalls.length]),[0,0],'No customer/shared search read before input');
 await p.locator(INPUT).focus();assert.deepEqual(await p.evaluate(()=>[__searchQA.customerCalls.length,__searchQA.sharedCalls.length]),[0,0],'Focusing an empty field never fetches search data');
 await p.locator(INPUT).fill('BMW');
 await p.waitForFunction(()=>!document.querySelector('#snote-global-search').hasAttribute('aria-busy')&&document.querySelector('#snote-global-results').textContent.includes('BMW iX3'));
 assert.deepEqual(await p.evaluate(()=>[__searchQA.customerCalls.length,__searchQA.sharedCalls.length]),[1,1],'Typing performs one debounced authorized live search');
 const focused=await geometry(p);assert(focused.popover);assert.equal(focused.blur,'blur(4px)');assert(focused.form.x>=11&&focused.form.right<=width-11,'Search popup fits the viewport');
 if(reducedMotion)assert.equal(focused.motion,'none');
 const text=await search(p,'BMW',{enter:true});assert.match(text,/BMW iX3/);assert(!text.includes('타인비공유'));
 await p.screenshot({path:path.join(OUT,`results-${width}${reducedMotion?'-reduced':''}.png`)});
 const result=p.locator(RESULTS+' [data-unified-result]').first();await p.locator(INPUT).focus();await p.locator(INPUT).press('Tab');
 // The dismiss button is intentionally in the keyboard order before results.
 for(let i=0;i<4&&!(await p.evaluate(()=>document.activeElement?.matches('[data-unified-result]')));i++){assert.equal(await p.evaluate(()=>!!SnoteSearchFocus.current),true,'Tab must keep search open while entering its results');await p.keyboard.press('Tab');}
 assert.equal(await result.evaluate(e=>e===document.activeElement),true,'Tab enters real result buttons without closing the popover');
 assert.equal(await p.locator(FORM).evaluate(e=>e.matches(':popover-open')),true);
 await p.keyboard.press('Escape');assert.equal(await p.locator(FORM).evaluate(e=>e.matches(':popover-open')),false);
 assert.equal(await p.locator(RESULTS).isHidden(),true);
 const after=await geometry(p);assert(Math.abs(before.form.width-after.form.width)<1,'Closing restores original dimensions');assert(Math.abs(before.form.x-after.form.x)<1);
 await search(p,'BMW');const routeBefore=await p.evaluate(()=>route);await p.mouse.click(4,Math.min(500,await p.evaluate(()=>innerHeight-20)));
 assert.equal(await p.locator(FORM).evaluate(e=>e.matches(':popover-open')),false);assert.equal(await p.evaluate(()=>route),routeBefore,'Outside click closes only search and does not trigger underlying navigation');
 if(width<=760){
  await search(p,'BMW');await p.waitForFunction(()=>history.state?.snoteMobilePopup?.depth>0);const beforeBack=await p.evaluate(()=>({route,url:location.href}));
  await p.evaluate(()=>history.back());await p.waitForFunction(()=>!SnoteSearchFocus.current);assert.deepEqual(await p.evaluate(()=>({route,url:location.href})),beforeBack,'Mobile Back closes only the popup');
 }
 record(`responsive actual-app search ${width}${reducedMotion?' reduced motion':''}`,{before,focused});await f.close();
}catch(e){await p.screenshot({path:path.join(OUT,`failure-layout-${width}.png`)}).catch(()=>{});await p.context().close();throw e;}}
async function functionality(browser){const f=await setup(browser),p=f.page;try{
 const sources=await p.evaluate(async()=>snoteUnifiedSearchBridge.sources(snoteUnifiedSearchBridge.context()));
 assert.equal(sources.vehicles.length,3);assert.equal(sources.customers.length,2);assert(!JSON.stringify(sources).includes('타인비공유'));
 const safeKeys=['id','ownerId','model','plate','vin','brand','make','year','color','memo','status','ownerLabel','shared'];
 for(const row of sources.vehicles.filter(r=>!r.shared))assert(Object.keys(row).every(k=>safeKeys.includes(k)));
 for(const secret of ['91827364','81726354','71625344','61524334','51423324','41322314','31221304','SECRET_RRN_CIPHER','SECRET_CUSTOMER_CIPHER','SECRET_IDENTITY_NUMBER','SECRET_REFUND_ACCOUNT'])assert(!JSON.stringify(sources).includes(secret),'Sensitive money/identity/refund source excluded: '+secret);
 record('bridge sources use authorized nonfinancial projections only');
 const cases=[['SYNTHETICVIN101','BMW iX3'],['12가 3456','BMW iX3'],['BMW 파랑','BMW iX3'],['강남보관 신속탁송','BMW iX3'],['김고객','가상 김고객'],['01022223333','가상 김고객'],['강남구 테스트로','가상 김고객'],['이고객 그랜저','가상 이고객'],['공유메모','공유 아이오닉'],['고객 관리','고객 관리']];
 for(const[q,want]of cases)assert((await search(p,q,{enter:true})).includes(want),`Matching ${q} => ${want}`);
 for(const q of ['91827364','71625344','SECRET_RRN_CIPHER','SECRET_REFUND_ACCOUNT','타인비공유차량','타인비공유고객'])assert.match(await search(p,q),/검색 결과가 없습니다/);
 record('vehicle model/plate/VIN/memo and customer name/phone/address/car match multiple normalized tokens');
 const menuSources=await p.evaluate(async()=>{const ctx=snoteUnifiedSearchBridge.context();return{menus:(await snoteUnifiedSearchBridge.sources(ctx)).menus.map(m=>m.id).sort(),allowed:Object.keys(pages).filter(snotePageAllowed).sort()};});assert.deepEqual(menuSources.menus,menuSources.allowed);assert(!menuSources.menus.includes('monthly'));
 record('dealer menu search matches real route permissions');
 await search(p,'SYNTHETICVIN101');await p.locator(RESULTS+' [data-unified-result]').filter({hasText:'BMW iX3'}).click();await p.waitForFunction(()=>activeCarId==='synthetic-car'&&document.querySelector('#vehicle-overlay').classList.contains('open'));
 assert.equal(await p.evaluate(()=>route),'buy');await p.screenshot({path:path.join(OUT,'own-vehicle-open.png')});await p.evaluate(()=>closeVehicle({discard:true,animate:false}));
 record('own-vehicle search opens the actual existing vehicle detail');
 await search(p,'김고객');await p.locator(RESULTS+' [data-unified-result]').filter({hasText:'가상 김고객'}).click();await p.waitForFunction(()=>route==='users'&&document.querySelector('#snote-customer-search')?.value==='010-2222-3333');
 record('customer result enters customer management and sets its actual filter');
 await closeSearch(p);await search(p,'매입 관리');await p.locator(RESULTS+' [data-unified-result]').filter({hasText:'매입 관리'}).click();await p.waitForFunction(()=>route==='buy');record('menu result uses existing navigation');
 await search(p,'공유메모');await p.locator(RESULTS+' [data-unified-result]').filter({hasText:'공유 아이오닉'}).click();assert.deepEqual(await p.evaluate(()=>__searchQA.opens),['synthetic-shared']);record('shared vehicle result invokes authorized shared detail opener');
 // Repeated submit / query changes use one bridge in-flight read and only paint the last query.
 await closeSearch(p);await p.evaluate(()=>{__searchQA.hold=true;__searchQA.customerCalls=[];__searchQA.sharedCalls=[];});
 await p.locator(INPUT).fill('BMW');await p.locator(INPUT).press('Enter');await p.waitForFunction(()=>__searchQA.releases.length===2);
 await p.locator(INPUT).fill('그랜저');await p.locator(INPUT).press('Enter');await p.waitForTimeout(40);
 assert.deepEqual(await p.evaluate(()=>[__searchQA.customerCalls.length,__searchQA.sharedCalls.length]),[1,1]);
 await p.evaluate(()=>__searchQA.release());await p.waitForFunction(()=>!document.querySelector('#snote-global-search').hasAttribute('aria-busy'));
 const raced=await p.locator(RESULTS).innerText();assert(raced.includes('그랜저')&&!raced.includes('BMW'));
 record('rapid query changes coalesce source reads and discard older query paint');
 // Change actor identity while verified scope remains synthetic; old contexts must not survive it.
 await p.evaluate(()=>{__searchQA.hold=true;});await p.locator(INPUT).fill('BMW');await p.locator(INPUT).press('Enter');await p.waitForFunction(()=>__searchQA.releases.length===2);
 await p.evaluate(()=>{window.__beforeSwitchActor=currentUser;window.__beforeSwitchContext=snoteUnifiedSearchBridge.context();currentUser={...currentUser};});
 assert.equal(await p.evaluate(()=>snoteUnifiedSearchBridge.current(__beforeSwitchContext)),false);await p.evaluate(()=>__searchQA.release());await p.waitForTimeout(350);
 assert.equal(await p.locator(RESULTS).isHidden(),true,'A stale actor reply is never painted');assert.equal(await p.locator(INPUT).inputValue(),'');
 record('late async response is dropped after actor/context replacement');
 // A failed customer source is partial, not a silent empty definitive result; retry works.
 await p.evaluate(()=>{__searchQA.failCustomer=true;});assert.match(await search(p,'BMW'),/일부 자료를 불러오지 못했습니다/);
 await p.evaluate(()=>{__searchQA.failCustomer=false;});assert((await search(p,'김고객')).includes('가상 김고객'));record('partial failure preserves safe results and explicit retry succeeds');
 await f.close();
}catch(e){await p.screenshot({path:path.join(OUT,'failure-function.png')}).catch(()=>{});await p.context().close();throw e;}}
async function roles(browser){for(const role of ['accountant','admin']){const f=await setup(browser,390,role),p=f.page;try{
 const data=await p.evaluate(async()=>{const ctx=snoteUnifiedSearchBridge.context();return{sources:await snoteUnifiedSearchBridge.sources(ctx),allowed:Object.keys(pages).filter(snotePageAllowed)};});
 assert.deepEqual(data.sources.menus.map(m=>m.id).sort(),data.allowed.sort());
 if(role==='accountant'){
  assert.deepEqual(await p.evaluate(()=>[__searchQA.customerCalls.length,__searchQA.sharedCalls.length]),[0,0]);assert.deepEqual(data.sources.customers,[]);assert(data.sources.menus.some(m=>m.id==='dashboard'));assert(!data.sources.menus.some(m=>['users','settings','vehicleInspection'].includes(m.id)));
  await search(p,'김고객');assert.deepEqual(await p.evaluate(()=>[__searchQA.customerCalls.length,__searchQA.sharedCalls.length]),[0,0]);
 }else assert(data.sources.menus.some(m=>m.id==='monthly')&&data.sources.menus.some(m=>m.id==='companyBuy'));
 record(`${role} search respects verified membership permissions${role==='accountant'?' with zero customer/shared requests':''}`);await f.close();
}catch(e){await p.screenshot({path:path.join(OUT,'failure-'+role+'.png')}).catch(()=>{});await p.context().close();throw e;}}}
if(require.main===module)(async()=>{const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{
 const group=process.env.SNOTE_UNIFIED_SEARCH_GROUP;if(!group||group==='layout'){for(const width of [1440,1024,850,761,390,360])await layoutCase(browser,width);await layoutCase(browser,390,true);}if(!group||group==='function')await functionality(browser);if(!group||group==='roles')await roles(browser);
 const after=hashes();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,operationalRequests:0,operationalWrites:0,checks:checked.length,group:process.env.SNOTE_UNIFIED_SEARCH_GROUP||'all',checked,sourceHashes:after,sourceChangedDuringRun:JSON.stringify(before)!==JSON.stringify(after)},null,2)+'\n');console.log('PASS unified search all '+checked.length+' checks');
}finally{await browser.close();}})().catch(e=>{fs.writeFileSync(path.join(OUT,'failure.txt'),e.stack||String(e));console.error(e.stack||e);process.exitCode=1;});
module.exports={setup,search,geometry};
