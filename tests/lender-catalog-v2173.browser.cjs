'use strict';
// Actual reload/restoreDatasets and picker flow; isolated Auth, RPC and table fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.LENDER_CATALOG_ARTIFACT_DIR||'/workspace/work/ui-v2173/lenders/catalog',results=[];
const COMPANY=['상사 등록 금융A','금리 없는 등록 금융B','미사용 등록 금융C'],OLD='이전 차량 계약금융',FOREIGN='외부 공유 금융';
fs.mkdirSync(OUT,{recursive:true});
async function values(p,id='detail-inventory-lender'){return p.locator('#'+id+' option').evaluateAll(rows=>rows.map(row=>row.value));}
async function setup(width=1440){
 const f=await fixture(width),p=f.page;
 await p.evaluate(async({COMPANY,OLD,FOREIGN})=>{
  await closeVehicle({discard:true});const S=__encarFixtureState,oldRpc=S.client.rpc.bind(S.client),oldFrom=S.client.from.bind(S.client);
  Object.assign(cars[0],{inventoryLender:OLD,inventoryLoan:1000000,moneyUnit:'KRW'});
  S.loading=true;persistCars(currentUser.username);S.loading=false;__encarFixtureCars=cars.map(SnoteMoney.storeCar);S.queue.clear();S.revisions.clear();
  const t=window.__catalog={names:[...COMPANY],rates:{},holdData:false,holdRates:false,failRates:false,dataWaiting:0,rateWaiting:0,dataResolvers:[],rateResolvers:[],tableReads:[],rateReads:[],writes:0};
  S.client.from=table=>{
   if(table!=='zc_datasets')return oldFrom(table);
   const filters={};let single=false;
   const chain={select(){return chain;},eq(key,value){filters[key]=value;return chain;},in(){return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){single=true;return chain;},single(){single=true;return chain;},then(resolve,reject){
    // The existing dealer SELECT policy returns own cars/covers, never finance_limits.
    const company=S.company.id,user=S.user.id,rows=[{company_id:company,dataset:'cars',owner_id:user,payload:structuredClone(__encarFixtureCars),revision:__encarFixtureRevision},{company_id:company,dataset:'covers',owner_id:user,payload:{},revision:1}].filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));
    t.tableReads.push({company,user,datasets:rows.map(row=>row.dataset)});
    return Promise.resolve().then(async()=>{if(t.holdData){t.dataWaiting++;await new Promise(done=>t.dataResolvers.push(done));t.dataWaiting--;}return{data:single?(rows[0]??null):rows,error:null};}).then(resolve,reject);
   }};return chain;
  };
  S.client.rpc=async(name,args={})=>{
   if(name==='snote_dealer_finance_rates_list'){
    const companyId=S.company.id,userId=S.user.id,data={companyId,userId,profiles:[{ownerId:userId,companyId,rates:structuredClone(t.rates),fallbackRates:{[COMPANY[0]]:6},lenderNames:[...t.names],revision:0},{ownerId:'55555555-5555-4555-8555-555555555555',companyId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',rates:{[FOREIGN]:9},fallbackRates:{[FOREIGN]:7},lenderNames:[FOREIGN],revision:0,sharedOnly:true}]};
    t.rateReads.push({companyId,userId});if(t.holdRates){t.rateWaiting++;await new Promise(done=>t.rateResolvers.push(done));t.rateWaiting--;}
    return t.failRates?{data:null,error:{code:'SYNTHETIC_RATE_READ'}}:{data,error:null};
   }
   if(name==='snote_finance_lock_get')return{data:{enabled:false,revision:0},error:null};
   if(name==='snote_vehicle_cost_config_get')return{data:{config:SnoteVehicleCostSettingsModel.normalize(null),revision:0},error:null};
   if(name==='snote_vehicle_taxonomy_list')return{data:{company_id:S.company.id,entries:[]},error:null};
   if(name==='snote_research_vehicle_catalog_list')return{data:{dataset_version:SnoteVehicleCatalog.version(),manifest_sha256:SnoteVehicleCatalog.manifestSha256(),entry_count:SnoteVehicleCatalog.rows().length,entries:SnoteVehicleCatalog.rows()},error:null};
   if(name==='zc_write_dataset')t.writes++;
   return oldRpc(name,args);
  };
  ACC44_LENDER_LIMITS=[['이전 브라우저 캐시 금융',900000000,99]];INVENTORY_LENDERS=ACC44_LENDER_LIMITS.map(row=>row[0]);
  SnoteDealerFinanceRates.reset();
 },{COMPANY,OLD,FOREIGN});
 return f;
}
async function release(p,kind){await p.evaluate(kind=>{const t=__catalog;t[kind==='data'?'holdData':'holdRates']=false;for(const done of t[kind==='data'?'dataResolvers':'rateResolvers'].splice(0))done();},kind);}
async function race(first,width=1440){
 const f=await setup(width),p=f.page;try{
  const before=await p.evaluate(()=>JSON.stringify(__encarFixtureCars));
  f.answerConfirm(true,/^서버에 저장된 데이터로 다시 불러올까요\?/);
  await p.evaluate(()=>{__catalog.holdData=true;__catalog.holdRates=true;window.__catalogReload=zc86Cloud.reload();});
  await p.waitForFunction(()=>__catalog.dataWaiting===1&&__catalog.rateWaiting===1);
  await release(p,first);await p.waitForFunction(first=>__catalog[first==='data'?'dataWaiting':'rateWaiting']===0,first);
  await release(p,first==='data'?'rates':'data');await p.evaluate(()=>__catalogReload);
  assert.equal(await p.evaluate(()=>__encarFixtureState.ready),true);
  assert.deepEqual(await p.evaluate(()=>ACC44_LENDER_LIMITS),[],'A dealer still cannot read the company finance limits');
  assert.equal(await p.evaluate(()=>localStorage.getItem(ZC157_FINANCE_KEY)),'[]','Names are never persisted as fabricated company limit rows');
  assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),COMPANY,'Registered names survive either order of the real concurrent dataset/rate loads');
  assert.deepEqual(await p.evaluate(()=>INVENTORY_LENDERS),COMPANY);
  await p.evaluate(()=>{navigate('buy');openVehicle('encar-car-1');});
  assert.deepEqual(await values(p),['',...COMPANY,OLD]);assert.equal(await p.locator('#detail-inventory-lender').inputValue(),OLD);
  assert.equal(await p.evaluate(()=>JSON.stringify(__encarFixtureCars)),before,'Reloading/rendering choices never changes saved vehicle finance');
  await p.evaluate(async()=>{await closeVehicle({discard:true});openAdd();SnotePurchaseRegistration.showStep(3,{focus:false});});
  assert.deepEqual(await values(p,'new-inventory-lender'),['',...COMPANY],'New vehicles include registered lenders without rates or existing vehicle usage');
  assert.equal(await p.evaluate(()=>__catalog.writes),0);assert.equal(await p.evaluate(()=>__catalog.tableReads.every(row=>row.datasets.every(value=>['cars','covers'].includes(value)))),true);
  await p.screenshot({path:path.join(OUT,'reload-'+first+'-'+width+'.png')});
  await p.evaluate(()=>closeAdd({discard:true}));await finish(f);results.push({name:'real reload '+first+' first',width,passed:true});console.log('PASS lender real reload '+first+' first '+width);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+first+'-'+width+'.png')}).catch(()=>{});await f.context.close();throw error;}
}
async function scopeAndRefresh(){
 const f=await setup(),p=f.page;try{
  assert.equal(await p.evaluate(()=>SnoteDealerFinanceRates.refresh({force:true})),true);
  await p.evaluate(()=>openVehicle('encar-car-1'));assert.deepEqual(await values(p),['',...COMPANY,OLD]);
  await p.locator('#detail-inventory-lender').selectOption(COMPANY[1]);
  await p.evaluate(()=>{__catalog.rates={'등록되지 않은 개인 과거 이율':5};__catalog.holdRates=true;window.__catalogRefresh=SnoteDealerFinanceRates.refresh({force:true});});await p.waitForFunction(()=>__catalog.rateWaiting===1);
  assert.deepEqual(await values(p),['',...COMPANY,OLD]);assert.equal(await p.locator('#detail-inventory-lender').inputValue(),COMPANY[1]);
  await release(p,'rates');await p.evaluate(()=>__catalogRefresh);assert.deepEqual(await values(p),['',...COMPANY,OLD],'Personal override keys and foreign profiles cannot expand the company registry');
  await p.evaluate(async()=>{__catalog.failRates=true;await SnoteDealerFinanceRates.refresh({force:true});});
  assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),COMPANY,'Same-scope transient rate failures retain the confirmed names');assert.equal(await p.locator('#detail-inventory-lender').inputValue(),COMPANY[1]);
  await p.evaluate(async()=>{__catalog.failRates=false;__catalog.names=[];await SnoteDealerFinanceRates.refresh({force:true});});
  assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),[],'A confirmed empty registry clears the last successful catalog');
  assert.deepEqual(await values(p),['',OLD,COMPANY[1]],'Historical saved lender and in-progress selection remain scoped to this vehicle editor');
  await p.evaluate(async()=>{await closeVehicle({discard:true});openAdd();SnotePurchaseRegistration.showStep(3,{focus:false});});assert.deepEqual(await values(p,'new-inventory-lender'),['']);
  await p.evaluate(async()=>{await closeAdd({discard:true});__catalog.names=['원래 상사 재등록 금융'];await SnoteDealerFinanceRates.refresh({force:true});__catalog.holdRates=true;window.__catalogOldRead=SnoteDealerFinanceRates.refresh({force:true});});await p.waitForFunction(()=>__catalog.rateWaiting===1);
  await p.evaluate(()=>{const S=__encarFixtureState;S.company={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'다른 검증 상사'};S.members=[{...S.members[0],company_id:S.company.id}];__catalog.names=['새 상사 등록 금융'];});
  assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),[],'Switching company immediately refuses the old catalog and unscoped browser cache');
  await release(p,'rates');assert.equal(await p.evaluate(()=>__catalogOldRead),false,'A delayed prior-company result is rejected');
  assert.equal(await p.evaluate(()=>SnoteDealerFinanceRates.refresh({force:true})),true);assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),['새 상사 등록 금융']);
  await p.evaluate(()=>{__encarFixtureState.members[0].active=false;});assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),[],'Inactive membership cannot reuse catalog data');
  await p.evaluate(()=>{__encarFixtureState.members[0].active=true;currentUser.role='accountant';});assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),[],'A role mismatch cannot fall back to an unscoped cache');
  await p.evaluate(async()=>{const S=__encarFixtureState;S.members[0].role='accountant';ACC44_LENDER_LIMITS=[['경리 상사 설정 금융',200000000,null]];});assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),['경리 상사 설정 금융'],'Accountants retain the actual company settings source');
  await p.evaluate(()=>{__encarFixtureState.members[0].role='dealer';currentUser.role='dealer';});assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),[],'A role change invalidates the prior dealer catalog');
  await p.evaluate(async()=>{await SnoteDealerFinanceRates.refresh({force:true});__catalog.holdRates=true;SnoteDealerFinanceRates.reset();});assert.deepEqual(await p.evaluate(()=>snote169CompanyLenderNames()),[],'Explicit reset invalidates confirmed catalog data until a new confirmed response');await p.waitForFunction(()=>__catalog.rateWaiting===1);await release(p,'rates');await p.waitForFunction(()=>SnoteDealerFinanceRates.ready());
  assert.equal(await p.evaluate(()=>__catalog.writes),0);await finish(f);results.push({name:'drafts, transient error, empty registry, foreign/profile isolation, company/role/reset fences',passed:true});console.log('PASS lender scoped catalog refresh lifecycle');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-scope.png')}).catch(()=>{});await f.context.close();throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{await race('rates');await race('data',390);await scopeAndRefresh();}finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
