'use strict';
// Actual application, personal-rate bridge and Chromium. All Auth/RPC/HTTP are
// synthetic; no production account, preference or vehicle is read or modified.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_DEALER_RATES_ARTIFACT_DIR||'/tmp/snote-dealer-finance-rates';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',F='44444444-4444-4444-8444-444444444444',C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',L='KB캐피탈';
const PANEL='#snote-dealer-finance-rates',INPUT='#snote-dealer-rates-list input[data-dealer-rate="'+L+'"]',SAVE='#snote-dealer-rates-save';
const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);
fs.mkdirSync(OUT,{recursive:true});
const hashes=()=>Object.fromEntries(['index.html','assets/dealer-finance-rates.js','assets/dealer-finance-rates.css','assets/inventory-interest.js','tests/encar/browser-smoke.cjs','tests/dealer-finance-rates.browser.cjs'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]));
async function setup(width=1440){
 const f=await fixture(width),p=f.page;await p.waitForFunction(()=>!!window.SnoteDealerFinanceRates&&!!window.snoteDealerRatesBridge);
 await f.context.route('**/api/vehicle-taxonomy-probe?*',route=>{assert.equal(route.request().method(),'GET');return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,provider:'encar-api.com',configured:false})});});
 await p.evaluate(async({A,B,F,C,D,L})=>{
  closeVehicle({discard:true});const S=__encarFixtureState,oldRpc=S.client.rpc.bind(S.client),clone=value=>structuredClone(value),key=(company,user)=>company+':'+user;
  window.__dealerRateTest={store:{[key(C,A)]:{rates:{[L]:6},revision:1},[key(C,B)]:{rates:{[L]:12},revision:2},[key(D,F)]:{rates:{},revision:0}},fallback:{[C]:{[L]:3},[D]:{[L]:4}},names:{[C]:[L,'JB우리금융'],[D]:[L,'JB우리금융']},financeWrites:[],financeRevision:0,calls:[],holdLoad:false,holdSave:false,failLoad:false,failSave:false,badAck:false,loadResolvers:[],saveResolvers:[],heldLoads:0,heldSaves:0};
  const t=__dealerRateTest,profile=(company,user,sharedOnly=false)=>({companyId:company,ownerId:user,...clone(t.store[key(company,user)]||{rates:{},revision:0}),fallbackRates:clone(t.fallback[company]||{}),lenderNames:clone(t.names[company]||[]),sharedOnly});
  S.client.rpc=async(name,args={})=>{
   if(name==='zc_write_dataset'&&args.p_dataset==='finance_limits'){
    if(args.p_company!==S.company.id||args.p_owner!=='00000000-0000-0000-0000-000000000000')throw Error('Shared finance writes must use current company and NIL owner');
    if(args.p_expected!==t.financeRevision)return{data:null,error:{code:'40001'}};
    const rows=args.p_payload.filter(Array.isArray);t.names[S.company.id]=rows.map(row=>row[0]);t.fallback[S.company.id]=Object.fromEntries(rows.filter(row=>row[2]!=null).map(row=>[row[0],row[2]]));t.financeWrites.push(clone(args));return{data:++t.financeRevision,error:null};
   }
   if(name==='snote_dealer_finance_rates_list'||name==='snote_dealer_finance_rates_save'){
    const company=S.company.id,user=S.user.id,owner=key(company,user);t.calls.push({name,company,user,args:clone(args)});
    if(args.p_expected_company_id!==company)return {data:null,error:{code:'42501'}};
    if(name==='snote_dealer_finance_rates_list'){
     const profiles=[profile(company,user),...[[C,A],[C,B],[D,F]].filter(([c,u])=>c!==company||u!==user).map(([c,u])=>profile(c,u,true))],data={companyId:company,userId:user,profiles};
     if(t.holdLoad){t.heldLoads++;await new Promise(resolve=>t.loadResolvers.push(resolve));t.heldLoads--;}
     return t.failLoad?{data:null,error:{code:'SYNTHETIC_RATE_READ'}}:{data:clone(data),error:null};
    }
    if(args.p_expected_user_id!==user)return{data:null,error:{code:'42501'}};
    if(t.holdSave){t.heldSaves++;await new Promise(resolve=>t.saveResolvers.push(resolve));t.heldSaves--;}
    if(t.failSave)return {data:null,error:{code:'40001'}};
    const previous=t.store[owner]||{rates:{},revision:0};if(args.p_expected_revision!==previous.revision)return{data:null,error:{code:'40001'}};
    const saved={rates:clone(args.p_rates),revision:previous.revision+1};t.store[owner]=saved;
    return{data:{companyId:company,userId:user,...clone(saved),...(t.badAck?{revision:args.p_expected_revision}: {})},error:null};
   }
   if(name==='snote_vehicle_cost_config_get')return{data:{config:SnoteVehicleCostSettingsModel.normalize(null),revision:0},error:null};
   if(name==='snote_vehicle_taxonomy_list')return{data:{company_id:S.company.id,entries:[]},error:null};
   if(name==='snote_research_vehicle_catalog_list'){const v=SnoteVehicleCatalog,entries=v.rows();return{data:{dataset_version:v.version(),manifest_sha256:v.manifestSha256(),entry_count:entries.length,entries},error:null};}
   return oldRpc(name,args);
  };
  S.rpcConfig.client=S.client;S.loading=false;S.busy=false;S.ready=true;
  const end=SnoteInventoryInterest.today(),start=new Date(Date.parse(end+'T00:00:00Z')-10*86400000).toISOString().slice(0,10);
  Object.assign(cars[0],{moneyUnit:'KRW',inventoryLoan:10000000,inventoryLender:L,inventoryStartedAt:start,purchaseAt:start,buy:10000000,sell:12000000,costs:{},repairItems:[]});
  S.loading=true;persistCars(currentUser.username);S.loading=false;__encarFixtureCars=cars.map(SnoteMoney.storeCar);S.queue.clear();S.revisions.clear();
  ACC44_LENDER_LIMITS=[[L,1500000000,99],['JB우리금융',800000000,88]];INVENTORY_LENDERS=ACC44_LENDER_LIMITS.map(row=>row[0]);
  window.__dealerRateDates={end,start};SnoteDealerFinanceRates.reset();if(!await SnoteDealerFinanceRates.refresh({force:true}))throw Error('Synthetic initial rate read failed');
 },{A,B,F,C,D,L});
 return f;
}
async function settings(p){await p.evaluate(()=>navigate('settings'));await p.locator(PANEL).waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#snote-dealer-rates-list input[data-dealer-rate="KB캐피탈"]').disabled);}
async function release(p,type){await p.evaluate(type=>{const t=__dealerRateTest;t[type==='load'?'holdLoad':'holdSave']=false;for(const resolve of t[type==='load'?'loadResolvers':'saveResolvers'].splice(0))resolve();},type);}
async function settled(p){await p.waitForFunction(()=>!['loading','saving'].includes(document.getElementById('snote-dealer-finance-rates')?.dataset.state));}
async function calculation(p,owner=A,extra={}){return p.evaluate(({owner,extra})=>snote239Interest({...cars[0],ownerId:'cld_'+owner.replaceAll('-','').slice(0,18),...extra}),{owner,extra});}
async function clean(f){await f.page.evaluate(()=>{closeAdd();closeVehicle({discard:true});});await finish(f);}
async function switchActor(p,user,company=C,role='dealer'){
 await p.evaluate(async({user,company,role})=>{closeVehicle({discard:true});closeAdd();const S=__encarFixtureState;S.user={id:user,email:'other-synthetic@example.invalid'};S.company={id:company,name:'다른 검증 상사'};S.members=[{user_id:user,company_id:company,role,active:true,display_name:'다른 딜러'}];currentUser={...currentUser,username:'cld_'+user.replaceAll('-','').slice(0,18),role,name:'다른 딜러'};SnoteDealerFinanceRates.reset();await SnoteDealerFinanceRates.refresh({force:true});navigate('settings');},{user,company,role});
}
(async()=>{
 const before=hashes(),results=[],browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 const selected=process.env.SNOTE_DEALER_RATE_CASES?.split(',');
 async function run(name,fn){if(selected&&!selected.includes(name))return;const result=await fn();results.push({name,...result});console.log('PASS '+name);}
 try{
  for(const width of [1440,390,320])await run('settings-'+width,async()=>{
   const f=await setup(width),p=f.page;try{
    await settings(p);assert.equal(await p.locator(INPUT).inputValue(),'6');assert.equal(await p.locator(INPUT).getAttribute('placeholder'),'3','Default comes from source-company RPC, not stale viewer99%');
    await p.locator(INPUT).fill('0');await p.evaluate(()=>__dealerRateTest.holdSave=true);await p.locator(SAVE).click();await p.waitForFunction(()=>__dealerRateTest.heldSaves===1);assert.equal((await calculation(p)).annualRate,6,'No optimistic personal rate before ACK');assert.equal(await p.locator(SAVE).isDisabled(),true);
    await release(p,'save');await settled(p);assert.equal((await calculation(p)).amountWon,0);assert.equal(await p.locator(INPUT).inputValue(),'0');assert.match(await p.locator('#snote-dealer-rates-status').textContent(),/저장/);
    await p.locator(INPUT).fill('');await p.locator(SAVE).click();await settled(p);assert.equal((await calculation(p)).annualRate,3);assert.equal((await calculation(p)).amountWon,8219);assert.equal(await p.evaluate(()=>Object.hasOwn(__dealerRateTest.store['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111'].rates,'KB캐피탈')),false);
    const geometry=await p.locator(PANEL).evaluate(el=>{const b=el.getBoundingClientRect(),input=el.querySelector('input'),i=input.getBoundingClientRect(),button=el.querySelector('button'),s=button.getBoundingClientRect(),svg=button.querySelector('svg').getBoundingClientRect();return{x:b.x,right:b.right,width:b.width,overflow:el.scrollWidth>el.clientWidth,viewport:innerWidth,inputWidth:i.width,saveWidth:s.width,saveHeight:s.height,glyph:svg.width};});assert(geometry.x>=0&&geometry.right<=width+.5);assert.equal(geometry.overflow,false);assert(geometry.inputWidth<=100);assert(geometry.saveWidth<=32&&geometry.saveHeight<=32&&geometry.glyph>=14);await p.screenshot({path:path.join(OUT,'settings-'+width+'.png')});
    assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Rate preference save must not write vehicle records');await clean(f);return{width,geometry,zeroAndInheritedRate:true,serverAcknowledgedOnly:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('owner-rates-and-frozen-sales',async()=>{
   const f=await setup(),p=f.page;try{
    assert.equal((await calculation(p,A)).amountWon,16438);assert.equal((await calculation(p,B)).amountWon,32877);assert.equal((await calculation(p,F)).amountWon,10959,'Foreign shared owner uses original company4%, not viewer3% or99%');assert.equal((await calculation(p,'55555555-5555-4555-8555-555555555555')).ready,false,'Missing known owner cannot inherit viewer rates');
    const actual=await p.evaluate(()=>{const c=cars[0],sold={...c,status:'판매완료',soldAt:__dealerRateDates.end};sold.inventoryInterestSnapshot=SnoteInventoryInterest.snapshot(sold,snoteInventoryLendersFor(sold));window.__rateSold=sold;return{normalized:normalizeCosts(c).inventoryInterest,total:totals(c.buy,c.sell,normalizeCosts(c)),snapshot:sold.inventoryInterestSnapshot};});assert.equal(actual.normalized,16438);assert.equal(actual.total.direct,16438);assert.equal(actual.snapshot.annualRate,6);
    await p.evaluate(async()=>{__dealerRateTest.store['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111']={rates:{KB캐피탈:18},revision:2};await SnoteDealerFinanceRates.refresh({force:true});});assert.equal((await calculation(p,A)).amountWon,49315);assert.equal(await p.evaluate(()=>snote239Interest(__rateSold).amountWon),16438);
    const admin=await p.evaluate(async()=>{const S=__encarFixtureState;S.members[0].role='admin';currentUser.role='admin';await SnoteDealerFinanceRates.refresh({force:true});return snote239Interest({...cars[0],ownerId:'cld_222222222222422282'});});assert.equal(admin.annualRate,12,'Administrator view uses the vehicle owner rate');await clean(f);return{ownerCorrect:true,foreignFallback:true,unknownOwnerRejected:true,soldSnapshotPreserved:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('validation-conflict-and-retry',async()=>{
   const f=await setup(390),p=f.page;try{
    await settings(p);const calls=await p.evaluate(()=>__dealerRateTest.calls.length);for(const rate of [-1,101,1.12345,'6'])assert.equal(await p.evaluate(rate=>SnoteDealerFinanceRates.save({KB캐피탈:rate}),rate),false);assert.equal(await p.evaluate(()=>__dealerRateTest.calls.length),calls);
    await p.locator(INPUT).fill('9.125');await p.evaluate(()=>__dealerRateTest.failSave=true);await p.locator(SAVE).click();await settled(p);assert.equal((await calculation(p)).annualRate,6);assert.equal(await p.locator(INPUT).inputValue(),'9.125');assert.equal(await p.locator(SAVE).isDisabled(),true);assert.equal(await p.locator('#snote-dealer-rates-retry').isVisible(),true);
    await p.evaluate(()=>__dealerRateTest.failSave=false);await p.locator('#snote-dealer-rates-retry').click();await settled(p);assert.equal(await p.locator(INPUT).inputValue(),'9.125','Reload keeps the typed rate draft');await p.locator(SAVE).click();await settled(p);assert.equal((await calculation(p)).annualRate,9.125);
    await p.locator(INPUT).fill('10');await p.evaluate(()=>__dealerRateTest.badAck=true);await p.locator(SAVE).click();await settled(p);assert.equal((await calculation(p)).annualRate,9.125,'Malformed ACK cannot apply a rate');assert.equal(await p.locator(INPUT).inputValue(),'10');await p.evaluate(()=>__dealerRateTest.badAck=false);await p.locator('#snote-dealer-rates-retry').click();await settled(p);assert.equal((await calculation(p)).annualRate,10,'Server reload reconciles an uncertain committed value');
    await clean(f);return{scalarValidation:true,conflictNoOptimisticRate:true,typedDraftRetained:true,uncertainAckReconciled:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('late-save-account-isolation',async()=>{
   const f=await setup(),p=f.page;try{
    await settings(p);await p.locator(INPUT).fill('7');await p.evaluate(()=>__dealerRateTest.holdSave=true);await p.locator(SAVE).click();await p.waitForFunction(()=>__dealerRateTest.heldSaves===1);
    await switchActor(p,B);assert.equal(await p.locator(INPUT).inputValue(),'12');await release(p,'save');await p.waitForFunction(()=>__dealerRateTest.heldSaves===0);assert.equal(await p.locator(INPUT).inputValue(),'12');assert.equal(await p.evaluate(()=>SnoteDealerFinanceRates.config().rates.KB캐피탈),12);assert.equal(await p.evaluate(()=>__dealerRateTest.store['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111'].rates.KB캐피탈),7);await clean(f);return{oldActorCommitCannotApplyToNewActor:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('load-failure-and-retry',async()=>{
   const f=await setup(390),p=f.page;try{
    await settings(p);await p.locator(INPUT).fill('7');assert.equal(await p.evaluate(async()=>{__dealerRateTest.failLoad=true;return SnoteDealerFinanceRates.refresh({force:true});}),false);assert.equal(await p.locator(INPUT).isDisabled(),true);assert.equal(await p.locator('#snote-dealer-rates-retry').isVisible(),true);assert.equal((await calculation(p)).ready,false,'Failed authenticated rate reads must not invent a viewer/default rate');assert.equal(await p.evaluate(()=>SnoteDealerFinanceRates.config()),null);
    await p.evaluate(()=>__dealerRateTest.failLoad=false);await p.locator('#snote-dealer-rates-retry').click();await settled(p);assert.equal(await p.locator(INPUT).inputValue(),'7');assert.equal((await calculation(p)).annualRate,6);await p.locator(SAVE).click();await settled(p);assert.equal((await calculation(p)).annualRate,7);await clean(f);return{noInventedRateAfterReadFailure:true,retryRetainsTypedDraft:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('late-load-account-and-company-isolation',async()=>{
   const f=await setup(),p=f.page;try{
    await p.evaluate(()=>{__dealerRateTest.holdLoad=true;window.__oldRateLoad=SnoteDealerFinanceRates.refresh({force:true});});await p.waitForFunction(()=>__dealerRateTest.heldLoads===1);await p.evaluate(()=>__dealerRateTest.holdLoad=false);await switchActor(p,F,D);assert.equal(await p.locator(INPUT).inputValue(),'');assert.equal(await p.locator(INPUT).getAttribute('placeholder'),'4');await release(p,'load');await p.evaluate(()=>__oldRateLoad);assert.equal(await p.locator(INPUT).getAttribute('placeholder'),'4');assert.equal(await p.evaluate(()=>SnoteDealerFinanceRates.config().fallbackRates.KB캐피탈),4);await clean(f);return{lateLoadRejectedAcrossCompany:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('detail-live-draft-and-owner-snapshot',async()=>{
   const f=await setup(),p=f.page;try{
    await p.evaluate(()=>{navigate('buy');openVehicle('encar-car-1');});await p.locator('#detail-memo').fill('이율 변경 후에도 보존할 메모');await p.locator('#detail-inventory-loan').fill('15000000');assert.equal(await p.locator('#detail-inventory-interest').inputValue(),'24,658');
    assert.equal(await p.evaluate(()=>SnoteDealerFinanceRates.save({KB캐피탈:12})),true);assert.equal(await p.locator('#detail-inventory-interest').inputValue(),'49,315');assert.equal(await p.locator('#detail-inventory-loan').inputValue(),'15,000,000');assert.equal(await p.locator('#detail-memo').inputValue(),'이율 변경 후에도 보존할 메모');
    assert.equal(await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false})),true);const stored=await p.evaluate(()=>SnoteMoney.car(__encarFixtureCars.find(c=>c.id==='encar-car-1')));assert.equal(stored.inventoryInterestSnapshot.annualRate,12);assert.equal(stored.inventoryInterestSnapshot.principalWon??Math.round(stored.inventoryInterestSnapshot.principalManwon*10000),15000000);assert.equal(stored.costs.inventoryInterest,49315);assert.equal(stored.vehicleMemo,'이율 변경 후에도 보존할 메모');await clean(f);return{liveDraftPreserved:true,authoritativeVehicleSnapshot:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('new-registration-current-dealer-rate',async()=>{
   const f=await setup(390),p=f.page;try{
    await p.evaluate(async()=>{INVENTORY_LENDERS=['이전 상사 금융'];__dealerRateTest.names[__encarFixtureState.company.id].push('딜러 확인 금융');await SnoteDealerFinanceRates.refresh({force:true});navigate('buy');openAdd();});for(const [field,value]of [['make','검증 제조사'],['group','개인 이율 신규 차량']]){await p.locator('#new-'+field).selectOption('__manual__',{force:true});await p.locator('#snote98-'+field+'-input').fill(value);}await p.locator('#purchase-registration-next').click();await p.locator('#new-buy').fill('10000000');await p.locator('#new-sell').fill('12000000');await p.locator('#purchase-registration-next').click();assert.equal(await p.locator('#new-inventory-lender option').evaluateAll(options=>options.some(option=>option.value==='딜러 확인 금융')),true,'Dealer uses registered names from the confirmed source profile');await p.locator('#new-inventory-loan').fill('10000000');await p.locator('#new-inventory-lender').selectOption(L);await p.evaluate(()=>SnoteDealerFinanceRates.refresh({force:true}));assert.equal(await p.locator('#new-inventory-lender').inputValue(),L);assert.equal(await p.locator('#new-inventory-loan').inputValue(),'10,000,000');await p.locator('#new-inventory-started-at').fill(await p.evaluate(()=>__dealerRateDates.start));
    const draft=await p.evaluate(()=>snoteNewCarFinancialDraft());assert.equal(draft.interest.annualRate,6);assert.equal(draft.draft.costs.inventoryInterest,16438);assert.match(await p.locator('#add-cost-summary').textContent(),/10,016,438원/);
    await p.locator('#purchase-registration-complete').click();await p.waitForFunction(()=>__encarFixtureCars.length===3);await p.waitForFunction(()=>!document.getElementById('overlay').classList.contains('open'));await p.waitForFunction(()=>!document.getElementById('snote-purchase-registration-success'));const created=await p.evaluate(()=>SnoteMoney.car(__encarFixtureCars.find(c=>c.id!=='encar-car-1'&&c.id!=='encar-car-2')));assert.equal(created.costs.inventoryInterest,16438);assert.equal(created.ownerId,alias(A));await clean(f);return{newDraftUsesCurrentDealer:true,confirmedRowKeepsOwnInterest:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('bootstrap-and-write-scope',async()=>{
   const f=await setup(),p=f.page;try{
    const state=await p.evaluate(async()=>{const S=__encarFixtureState,old=currentUser;S.ready=false;currentUser=null;SnoteDealerFinanceRates.reset();const allowed=!!snoteDealerRatesBridge.context();const loaded=await SnoteDealerFinanceRates.refresh({force:true});const first=snote239Interest(cars[0]);const context=snoteDealerRatesBridge.context(),calls=__dealerRateTest.calls.length;let denied=false;try{await snoteDealerRatesBridge.save(context,{KB캐피탈:8},1);}catch{denied=true;}currentUser=old;S.ready=true;const own=snoteDealerRatesBridge.context();let forged=false;try{await snoteDealerRatesBridge.save({...own,userId:'22222222-2222-4222-8222-222222222222'},{KB캐피탈:8},1);}catch{forged=true;}return{allowed,loaded,first,denied,forged,noWrite:__dealerRateTest.calls.length===calls};});assert.equal(state.allowed,true);assert.equal(state.loaded,true);assert.equal(state.first.annualRate,6);assert.equal(state.denied,true);assert.equal(state.forged,true);assert.equal(state.noWrite,true);await clean(f);return{preReadyLoad:true,firstFinanceUsesOwnerRate:true,notReadyAndForgedWritesBlocked:true};
   }catch(error){await f.context.close();throw error;}
  });
  await run('shared-lender-ack-refresh-and-partial-notice',async()=>{
   const f=await setup(),p=f.page;try{
    await p.evaluate(async()=>{const S=__encarFixtureState;S.members[0].role='admin';currentUser.role='admin';ACC44_LENDER_LIMITS=[['KB캐피탈',1500000000,3],['JB우리금융',800000000,4]];INVENTORY_LENDERS=ACC44_LENDER_LIMITS.map(row=>row[0]);__dealerRateTest.fallback[S.company.id].JB우리금융=4;await SnoteDealerFinanceRates.refresh({force:true});navigate('settings');});await p.locator('#snote90-lenders-save').waitFor();await p.waitForFunction(()=>!document.querySelector('#snote-dealer-rates-list input[data-dealer-rate="KB캐피탈"]').disabled);
    await p.locator(INPUT).fill('7');await p.locator('.snote203-lender[data-name="KB캐피탈"] input[data-rate]').fill('5');await p.locator('#snote90-lender-name').fill('새 검증금융');await p.locator('#snote90-lender-limit').fill('50000000');await p.locator('#snote90-lender-add').click();await p.locator('#snote90-lenders-save').click();await p.waitForFunction(()=>__dealerRateTest.financeWrites.length===1&&!document.getElementById('snote90-lenders-save').disabled);await p.waitForFunction(()=>!!document.querySelector('#snote-dealer-rates-list input[data-dealer-rate="새 검증금융"]'));
    assert.equal(await p.locator(INPUT).inputValue(),'7','Company lender refresh preserves a touched personal rate');assert.equal(await p.locator(INPUT).getAttribute('placeholder'),'5');assert.equal(await p.locator('#snote-dealer-rates-list input[data-dealer-rate="새 검증금융"]').getAttribute('placeholder'),'0');assert.equal((await calculation(p)).annualRate,6,'Shared default edit does not overwrite personal override');
    await p.evaluate(()=>__dealerRateTest.failLoad=true);await p.locator('.snote203-lender[data-name="KB캐피탈"] input[data-rate]').fill('6');await p.locator('#snote90-lenders-save').click();await p.waitForFunction(()=>__dealerRateTest.financeWrites.length===2&&!document.getElementById('snote90-lenders-save').disabled);assert.match(await p.locator('#toast').textContent(),/금융사는 저장되었습니다.*다시 불러/);assert.equal(await p.locator(INPUT).inputValue(),'7');assert.equal(await p.locator('#snote-dealer-rates-retry').isVisible(),true);
    await p.evaluate(()=>__dealerRateTest.failLoad=false);await p.locator('#snote-dealer-rates-retry').click();await settled(p);assert.equal(await p.locator(INPUT).getAttribute('placeholder'),'6');assert.equal(await p.locator(INPUT).inputValue(),'7');await p.locator(SAVE).click();await settled(p);assert.equal((await calculation(p)).annualRate,7);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await p.evaluate(()=>openAdd());assert.equal(await p.locator('#new-inventory-lender option').evaluateAll(options=>options.some(option=>option.value==='새 검증금융')),true);await p.evaluate(()=>{document.getElementById('new-inventory-lender').value='새 검증금융';});await p.evaluate(()=>SnoteDealerFinanceRates.refresh({force:true}));assert.equal(await p.locator('#new-inventory-lender').inputValue(),'새 검증금융');await clean(f);return{sharedNamesAndDefaultsReloadedAfterAck:true,touchedPersonalRatePreserved:true,partialRefreshFailureReported:true,newRegistrationCatalogAndSelectionPreserved:true};
   }catch(error){await f.context.close();throw error;}
  });
  assert.deepEqual(hashes(),before,'Products and browser tests must stay frozen during final verification');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:before,results,syntheticOnly:true,productionWrites:0},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
