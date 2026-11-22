'use strict';
// Actual online workspace. Auth, company identity, roles and all network replies are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,dashboardReady,deferred,started,constants}=require('./normal-login.browser.cjs');
const {USER,COMPANY}=constants,OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OUT=process.env.SNOTE_FIRST_USE_ARTIFACT_DIR||'/tmp/snote-first-use';fs.mkdirSync(OUT,{recursive:true});
const profile={id:COMPANY,name:'가상 로그인 상사',business_number:'1234567890',corporate_number:'1234567890123',business_phone:'0212345678',business_address:'가상 회사 주소',business_address_detail:'가상 상세주소',representative_name:'가상 대표'};
const companyAck=(state,{role='dealer',hold=null,failure=null}={})=>{
 const original=state.from;let reads=0;
 state.from=async(label,input)=>{let result=original(label,input);if(input.table==='zc_members'&&result.data){const change=row=>({...row,role});result={...result,data:Array.isArray(result.data)?result.data.map(change):change(result.data)};}
  if(input.table==='zc_companies'){reads++;if(reads>1&&hold){hold.started.resolve();await hold.release.promise;}if(reads>1&&failure)return{data:null,error:{code:failure}};return{data:{...profile},error:null};}return result;
 };return()=>reads;
};
async function begin(browser,label,options){const state=backend(),reads=companyAck(state,options),f=await boot(browser,state,label);await f.login();await dashboardReady(f);return{state,reads,f,p:f.page};}
async function openCar(p){await p.evaluate(()=>{navigate('buy');openVehicle('synthetic-car');});await p.locator('#vehicle-overlay.open').waitFor();}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  {
   const {f,p,state,reads}=await begin(browser,'optional-tools');try{
    const before=await p.evaluate(()=>({paths:performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname),catalog:!!window.SnoteVehicleCatalog,office:!!window.SnoteContractOffice,income:typeof window.snoteIncomeOpenForCar,critical:['SnoteFinanceLock','SnoteIdleSession','SnotePaymentAccounts','snote222ContractSignature'].every(key=>!!window[key])}));
    assert.equal(before.catalog,false);assert.equal(before.office,false);assert.equal(before.income,'undefined');assert.equal(before.critical,true);assert.equal(reads(),1,'Only verified basic company data is required for login');
    assert(!before.paths.some(p=>/vehicle-catalog\.js|vehicle-taxonomy-ui\.js|contract-office\.js|income-settlement-parent\.js|tesseract/.test(p)));
    await p.evaluate(()=>navigate('buy'));await p.locator('#snote92-buy-manual').click();await p.locator('#overlay.open').waitFor();await p.waitForFunction(()=>SnoteVehicleCatalog?.rows().length>0);assert(await p.locator('#new-make option').count()>1);
    assert.equal(await p.evaluate(()=>typeof window.Tesseract),'undefined');assert(!state.rpcCalls.some(row=>/snote_customer_save|zc_write_dataset/.test(row.name)));
    results.push({name:'catalogue and registration load on first use; auth, gates and signature stay eager',initialCompanyReads:1,ocrEngineRequests:0});
   }finally{await f.finish();}
  }
  for(const stop of ['close','route','company']){
   const hold={started:deferred(),release:deferred()},{f,p,reads}=await begin(browser,'profile-'+stop,{hold});try{
    await openCar(p);await p.evaluate(()=>{window.__firstContract=openContractPreview({loadCustomer:false});});await started(hold.started,'profile first-use read');
    assert.equal(await p.locator('#contract-overlay').getAttribute('aria-hidden'),'true');assert.equal(reads(),2);
    // A second consumer shares the single profile read without opening another view.
    await p.evaluate(()=>{window.__concurrentProfile=snoteEnsureDocumentCompany();});assert.equal(reads(),2);
    if(stop==='close')await p.evaluate(()=>closeVehicle({discard:true,animate:false}));
    if(stop==='route')await p.evaluate(()=>navigate('settings'));
    if(stop==='company')await p.evaluate(other=>{__normalState.company={id:other,name:'다른 가상 상사'};},OTHER_COMPANY);
    hold.release.resolve();await p.evaluate(async()=>{await Promise.allSettled([__firstContract,__concurrentProfile]);});
    assert.equal(await p.locator('#contract-overlay').getAttribute('aria-hidden'),'true','A stale first-use intent cannot reopen a document');
    if(stop==='company')assert.equal(await p.evaluate(()=>zc86Cloud.companyProfile.corporate_number),'');
    if(stop==='close'){
     await openCar(p);await p.evaluate(()=>openContractPreview({loadCustomer:false}));await p.locator('#contract-overlay.open').waitFor();
     assert.equal(reads(),2,'A verified current profile is reused');assert.equal(await p.evaluate(()=>zc86Cloud.companyProfile.corporate_number),profile.corporate_number);
     assert((await p.locator('#ct-seller-name').inputValue()).includes(profile.name));assert((await p.locator('#ct-seller-address').inputValue()).includes(profile.business_address));
    }
    results.push({name:'late document identity is fenced after '+stop,initialCompanyReads:1,coalescedFirstUseReads:1,staleDocumentOpened:false});
   }finally{hold.release.resolve();await f.finish();}
  }
  {
   const {f,p}=await begin(browser,'profile-failure',{failure:'42501'});try{
    await openCar(p);await p.evaluate(()=>openContractPreview({loadCustomer:false}));assert.equal(await p.locator('#contract-overlay').getAttribute('aria-hidden'),'true');
    assert.equal(await p.evaluate(()=>snoteDocumentCompanyReady()),false);results.push({name:'unverified company identity blocks documents without blocking login'});
   }finally{await f.finish();}
  }
  {
   const {f,p,state}=await begin(browser,'company-read-coalescing',{role:'admin'});const original=state.rpc,hold={started:deferred(),release:deferred()};
   state.rpc=async(label,input)=>{const result=original(label,input);if(input.name==='snote_company_purchase_rows'){hold.started.resolve();await hold.release.promise;return{data:{companyId:COMPANY,datasets:[{dataset:'cars',ownerId:USER,payload:[],revision:0},{dataset:'covers',ownerId:USER,payload:{},revision:0}],owners:[{id:USER,name:'가상 관리자',active:true,memberExists:true}]},error:null};}return result;};
   try{
    await p.evaluate(()=>{const context=snoteCompanyPurchaseBridge.context();window.__companyReadA=snoteCompanyPurchaseBridge.load(context);window.__companyReadB=snoteCompanyPurchaseBridge.load(context);});await started(hold.started,'company read');
    assert.equal(state.rpcCalls.filter(r=>r.name==='snote_company_purchase_rows').length,1);hold.release.resolve();await p.evaluate(()=>Promise.all([__companyReadA,__companyReadB]));
    assert.equal(state.rpcCalls.filter(r=>r.name==='snote_dealer_finance_rates_list').length,1,'The previously confirmed same-company rates are reused');
    results.push({name:'same-context company reads coalesce and reuse verified finance rates',companyReads:1,rateReads:1});
   }finally{hold.release.resolve();await f.finish();}
  }
  {
   const state=backend(),hold={started:deferred(),release:deferred()},reads=companyAck(state,{role:'accountant',hold}),f=await boot(browser,state,'accountant-first-workspace'),p=f.page;
   try{
    await f.login();await f.ready();await p.waitForFunction(()=>!__normalState.busy);await started(hold.started,'accountant document identity');
    assert.equal(await p.evaluate(()=>route),'contractOffice');assert.equal(await p.locator('#zc-cloud-gate').isHidden(),true);assert.equal(await p.locator('#contract-office-form').count(),0,'No blank company form is mounted while identity is unverified');
    hold.release.resolve();await p.locator('#contract-office-landing').waitFor({state:'visible'});
    assert.equal(reads(),2);assert.equal(await p.evaluate(()=>snoteDocumentCompanyReady()),true);
    const modules=await p.evaluate(()=>['SnoteContractOffice','SnoteTransferDocumentLayout','SnoteTransferNameSeal','SnoteTransferCompanySeal','SnoteCompanyAssets'].every(key=>!!window[key]));assert.equal(modules,true);
    await p.locator('#contract-office-landing [data-document-kind="purchase"]').click();await p.locator('#contract-office-form').waitFor({state:'visible'});
    assert((await p.locator('#contract-office-form [name="sellerName"]').inputValue()).includes(profile.name));assert.equal(await p.evaluate(()=>zc86Cloud.companyProfile.corporate_number),profile.corporate_number);
    results.push({name:'accountant first workspace loads the complete office tool only after verified company identity',companyReads:2,blankCompanyFormMounted:false});
   }finally{hold.release.resolve();await f.finish();}
  }
  {
   const {f,p,state}=await begin(browser,'taxonomy-company-switch'),ordinary=state.rpc,hold={started:deferred(),release:deferred()};
   const custom=(label,id)=>({id,make:label,group:'가상 전용 차명',model:'가상 전용 세대',grade:'',subgrade:'',model_year:'',verification:'user_import',source:'company_vehicle_registration',market:'KR'});
   state.rpc=async(label,input)=>{const result=ordinary(label,input);if(input.name==='snote_vehicle_taxonomy_list'){const company=await p.evaluate(()=>__normalState.company.id);if(company===OTHER_COMPANY){hold.started.resolve();await hold.release.promise;}return{data:{company_id:company,entries:[custom(company===COMPANY?'가상 A 전용 제조사':'가상 B 전용 제조사',company===COMPANY?'44444444-4444-4444-8444-444444444444':'55555555-5555-4555-8555-555555555555')]},error:null};}return result;};
   try{
    await p.evaluate(async()=>{await navigate('buy');await openAdd();});await p.waitForFunction(()=>window.snoteVehicleTaxonomyRows?.().some(row=>row.make==='가상 A 전용 제조사'));
    assert((await p.locator('#new-make').textContent()).includes('가상 A 전용 제조사'));
    await p.evaluate(async other=>{
     await closeAdd();window.snoteResetVehicleTaxonomy?.();SnoteIdleSession.reset();SnoteFinanceLock.reset();SnoteDashboardDisplay.reset();
     const S=__normalState,userId='22222222-2222-4222-8222-222222222222',alias='cld_'+userId.replaceAll('-','').slice(0,18);
     S.user={id:userId,email:'other@example.invalid'};S.company={id:other,name:'다른 가상 상사'};S.members=[{user_id:userId,company_id:other,active:true,role:'dealer',display_name:'다른 가상 딜러'}];S.alias=alias;currentUser={username:alias,name:'다른 가상 딜러',company:S.company.name,role:'dealer'};cars=[];
     if(snoteVehicleTaxonomyRows().length)throw Error('Previous company custom rows survived invalidation');
     await navigate('buy');await openAdd();
    },OTHER_COMPANY);
    await started(hold.started,'new company taxonomy');
    const frames=await p.evaluate(async()=>{const values=[];for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);values.push({oldOption:document.getElementById('new-make').textContent.includes('가상 A 전용 제조사'),oldRow:snoteVehicleTaxonomyRows().some(row=>row.make==='가상 A 전용 제조사'),publicContainsPrivate:SnoteVehicleCatalog.rows().some(row=>row.make==='가상 A 전용 제조사')});}return values;});
    assert(frames.every(row=>!row.oldOption&&!row.oldRow&&!row.publicContainsPrivate));hold.release.resolve();await p.waitForFunction(()=>snoteVehicleTaxonomyRows().some(row=>row.make==='가상 B 전용 제조사'));
    assert(!(await p.locator('#new-make').textContent()).includes('가상 A 전용 제조사'));results.push({name:'account/company switch never displays previous custom catalogue rows while the new response is held',protectedFrames:frames.length});
   }finally{hold.release.resolve();await f.finish();}
  }
  {
   const hold={started:deferred(),release:deferred()},{f,p}=await begin(browser,'same-company-new-profile-ack',{role:'admin',hold});
   try{
    await p.evaluate(()=>{window.__oldDocumentIdentity=snoteEnsureDocumentCompany().then(()=>({ok:true}),error=>({ok:false,code:error.message}));});await started(hold.started,'old company identity');
    const saved={user_id:USER,company_id:COMPANY,role:'admin',display_name:'새 가상 대표',company_name:'새로 저장한 가상 상사',phone:'01012345678',address:'새 가상 주소',company_address:'새 가상 상사 주소',revision:1};
    await p.route(constants.DB+'/rest/v1/rpc/snote_profile_save',route=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'POST,OPTIONS'},contentType:'application/json',body:route.request().method()==='OPTIONS'?'{}':JSON.stringify(saved)}));
    await p.evaluate(async value=>{const context=snoteProfileBridge.context();const {display_name,phone,address,company_name,company_address}=value;await snoteProfileBridge.save(context,0,{display_name,phone,address,company_name,company_address});},saved);
    assert.equal(await p.evaluate(()=>zc86Cloud.company),saved.company_name);hold.release.resolve();assert.equal((await p.evaluate(()=>__oldDocumentIdentity)).ok,false);assert.equal(await p.evaluate(()=>zc86Cloud.company),saved.company_name);
    results.push({name:'a late document identity read cannot overwrite a newer same-company profile save acknowledgment'});
   }finally{hold.release.resolve();await f.finish();}
  }
  fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,syntheticOnly:true,productionRequests:0,results},null,2)+'\n');for(const r of results)console.log('PASS '+r.name);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
