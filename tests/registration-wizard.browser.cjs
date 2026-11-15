'use strict';
// Actual app and registration wizard. Every Auth/data/Storage response is synthetic.
// No production credentials, business data, OCR, SMS or external API calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_REGISTRATION_WIZARD_ARTIFACT_DIR||'/tmp/snote-registration-wizard';
const OVERLAY='#overlay',NEXT='#purchase-registration-next',PREVIOUS='#purchase-registration-previous',COMPLETE='#purchase-registration-complete',MESSAGE='#purchase-registration-message',SUCCESS='#snote-purchase-registration-success';
fs.mkdirSync(OUT,{recursive:true});
const tick=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const sourceHashes=()=>Object.fromEntries(['index.html','assets/purchase-registration.js','assets/purchase-registration.css','assets/purchase-registration-success.js','assets/purchase-registration-success.css','assets/list-sort.js','assets/list-pagination.js','tests/registration-wizard.browser.cjs'].filter(f=>fs.existsSync(path.join(ROOT,f))).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')]));
async function currentStep(p,n){for(let i=1;i<=3;i++)assert.equal(await p.locator('#purchase-registration-step-'+i).isVisible(),i===n,'Only current registration part is visible');await p.locator('#purchase-registration-step-'+n).evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getTiming()?.iterations)).map(a=>a.finished.catch(()=>{}))));}
async function setup(width=1440){
 const f=await fixture(width),p=f.page;
 await p.waitForFunction(()=>!!window.SnotePurchaseRegistration&&!!document.getElementById('purchase-registration-step-1'));
 await p.evaluate(()=>{
  closeVehicle({discard:true});navigate('buy');
  const client=window.__encarFixtureState.client,rpc=client.rpc.bind(client);
  window.__registrationTaxonomyWrites=[];window.__registrationTaxonomyMode='ok';
  client.rpc=async(name,args)=>{
   if(name==='snote_vehicle_taxonomy_list')return{data:{company_id:window.__encarFixtureState.company.id,entries:[]},error:null};
   if(name==='snote_research_vehicle_catalog_list'){const api=SnoteVehicleCatalog,entries=api.rows();return{data:{dataset_version:api.version(),manifest_sha256:api.manifestSha256(),entry_count:entries.length,entries},error:null};}
   if(name==='snote_vehicle_taxonomy_upsert'){
    if(args.p_expected_company_id!==window.__encarFixtureState.company.id)throw Error('Taxonomy request must be company scoped');
    window.__registrationTaxonomyWrites.push(structuredClone(args));if(window.__registrationTaxonomyMode==='fail')return{data:null,error:{code:'SYNTHETIC_TAXONOMY_FAILED'}};
    return{data:{company_id:args.p_expected_company_id,entry:{id:'33333333-3333-4333-8333-333333333333',...args.p_entry,verification:'user_import',source:'company_vehicle_registration',market:'KR'},inserted:true},error:null};
   }return rpc(name,args);
  };
  window.__registrationBefore=structuredClone(window.__encarFixtureCars);
  window.__registrationLedgerBefore=typeof PRESTOCK_V148_KEY==='string'?localStorage.getItem(PRESTOCK_V148_KEY):null;
  window.__registrationSuccessCount=0;
  new MutationObserver(records=>{for(const record of records)for(const n of record.addedNodes)if(n.nodeType===1&&(n.id==='snote-purchase-registration-success'||n.querySelector?.('#snote-purchase-registration-success')))window.__registrationSuccessCount++;}).observe(document.body,{childList:true,subtree:true});
  openAdd();
 });
 await p.locator(OVERLAY+'.open').waitFor();await currentStep(p,1);await tick(p);
 return f;
}
async function identity(p,name='검증 차명'){
 for(const [field,value]of[['make','검증 제조사'],['group',name]]){
  const select=p.locator('#new-'+field);if(await select.inputValue()!=='__manual__')await select.selectOption('__manual__',{force:true});
  await p.locator('#snote98-'+field+'-input').fill(value);
 }
 await p.locator('#new-plate').fill('');await p.locator('#new-year').fill('');await p.locator('#new-km').fill('');
}
async function stage3(p,{name='검증 차명',buy='10000000',sell=''}={}){
 await identity(p,name);await p.locator(NEXT).click();await currentStep(p,2);
 await p.locator('#new-buy').fill(buy);await p.locator('#new-sell').fill(sell);
 await p.locator(NEXT).click();await currentStep(p,3);
}
async function writes(p){return p.evaluate(()=>({writes:structuredClone(window.__encarFixtureWrites),remote:window.__encarFixtureCars.map(row=>SnoteMoney.car(structuredClone(row))),local:structuredClone(cars),success:window.__registrationSuccessCount,revision:window.__encarFixtureRevision}));}
async function noSuccess(p){assert.equal(await p.locator(SUCCESS).count(),0);assert.equal(await p.evaluate(()=>window.__registrationSuccessCount),0);}
async function firstVisibleRow(p){return p.locator('[data-registration-car-id]:visible').first().getAttribute('data-registration-car-id');}
async function completeAndWait(p,expectedCommits=1){
 await p.locator(COMPLETE).click();try{await p.waitForFunction(n=>window.__encarFixtureWrites.length===n,expectedCommits);}catch(error){console.error('Registration save debug',JSON.stringify(await p.evaluate(()=>({message:document.getElementById('purchase-registration-message')?.textContent,toast:document.getElementById('toast')?.textContent,buy:document.getElementById('new-buy')?.value,overlay:document.getElementById('overlay').className,localCount:cars.length,remoteCount:__encarFixtureCars.length,writes:__encarFixtureWrites.length,failures:__encarFixtureWriteFailures,attempt:typeof snotePurchaseRegistrationAttempt!=='undefined'?{staged:snotePurchaseRegistrationAttempt?.staged,inflight:snotePurchaseRegistrationAttempt?.inflight,session:snotePurchaseRegistrationAttempt?.session}:null}))));throw error;}
 await p.waitForFunction(()=>!document.getElementById('overlay').classList.contains('open'));
 await p.waitForFunction(()=>window.__registrationSuccessCount>0);await p.waitForFunction(()=>!document.getElementById('snote-purchase-registration-success'));
 const state=await writes(p),previous=new Set(await p.evaluate(()=>window.__registrationBefore.map(c=>c.id))),created=state.remote.filter(c=>!previous.has(c.id));assert(created.length>0);const row=created.at(-1);
 assert.equal(await p.evaluate(()=>route),'buy');assert.equal(await firstVisibleRow(p),state.remote[0].id);return{state,row:state.remote.find(c=>c.id===state.remote[0].id)};
}
async function geometry(p,width){
 const g=await p.locator(OVERLAY).evaluate(root=>{const form=root.querySelector('form'),frame=root.querySelector('.snote-popup-frame')||form,r=frame.getBoundingClientRect(),s=getComputedStyle(frame),body=root.querySelector('form');return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,centerX:(r.left+r.right)/2,centerY:(r.top+r.bottom)/2,animation:s.animationName,overflow:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth,role:frame.getAttribute('role')||form.getAttribute('role'),novalidate:form.noValidate};});
 assert.equal(g.viewportWidth,width);assert(Math.abs(g.centerX-width/2)<=2,'Registration dialog is centered horizontally');assert(g.x>=0&&g.right<=width+.5);assert(g.y>=0&&g.bottom<=g.viewportHeight+.5);assert.equal(g.overflow,false);assert.equal(g.novalidate,true);assert(!g.animation.includes('snote-vehicle-slide'),'Manual registration no longer uses a side drawer');return g;
}
(async()=>{const before=sourceHashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  if(!process.env.SNOTE_REGISTRATION_DETAIL_ONLY){
  for(const width of[1440,390,320]){
   const f=await setup(width),p=f.page;try{
    const g=await geometry(p,width);await p.screenshot({path:path.join(OUT,'wizard-step1-'+width+'.png')});assert.equal(await p.locator(COMPLETE).isVisible(),false);
    await p.locator(NEXT).click();await currentStep(p,1);assert.equal((await writes(p)).writes.length,0);
    await identity(p,'선택항목 생략 '+width);await p.locator('#snote98-group-input').press('Enter');await currentStep(p,2);assert.equal((await writes(p)).writes.length,0);
    await p.locator(NEXT).click();await currentStep(p,2);assert.equal((await writes(p)).writes.length,0);
    await p.locator('#new-buy').fill(width===320?'0':'10000000');assert.equal(await p.locator('#new-buy').inputValue(),width===320?'0':'10,000,000');
    await p.locator(PREVIOUS).click();await currentStep(p,1);assert.equal(await p.locator('#snote98-group-input').inputValue(),'선택항목 생략 '+width);
    await p.locator(NEXT).click();await currentStep(p,2);assert.equal(await p.locator('#new-buy').inputValue(),width===320?'0':'10,000,000');
    await p.screenshot({path:path.join(OUT,'wizard-step2-'+width+'.png')});await p.locator(NEXT).click();await currentStep(p,3);await p.screenshot({path:path.join(OUT,'wizard-step3-'+width+'.png')});assert.match(await p.locator('#add-cost-summary').textContent(),/예상 마진/);assert.match(await p.locator('#add-cost-summary').textContent(),/[—–-]/);
    await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator(COMPLETE).click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);await noSuccess(p);assert.equal(await p.locator(OVERLAY).evaluate(el=>el.classList.contains('open')),true);
    assert.equal(await p.locator('#new-inventory-loan').isDisabled(),true);await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});
    await p.waitForFunction(()=>window.__encarFixtureWrites.length===1);await p.waitForFunction(()=>!document.getElementById('overlay').classList.contains('open'));await p.waitForFunction(()=>window.__registrationSuccessCount===1);await p.waitForFunction(()=>!document.getElementById('snote-purchase-registration-success'));
    const state=await writes(p),row=state.remote[0];assert.match(row.model,/검증 제조사.*선택항목 생략/);assert.equal(row.make,'검증 제조사');assert.equal(row.plate,'');assert(!row.year||row.year===null);assert.equal(row.buy,width===320?0:10000000);assert.equal(row.sell,0);assert.equal(row.inventoryLoan,0);assert.equal(state.remote.length,3);assert.equal(await firstVisibleRow(p),row.id);assert.equal(await p.evaluate(()=>route),'buy');
    await p.screenshot({path:path.join(OUT,'registered-'+width+'.png')});results.push({name:'centered '+width+'px three-part registration validates only required identity/buy and saves after ACK',width,geometry:g,optionalFieldsSkipped:true,enterAdvancesWithoutSaving:true,historyRetained:true,noSuccessBeforeAcknowledgement:true,firstVisibleRow:true});
    await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await stage3(p,{name:'저장 재시도 차량'});await p.evaluate(()=>window.__encarFixtureWriteMode='fail');await p.locator(COMPLETE).click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0);await p.locator(COMPLETE+':not([disabled])').waitFor();await noSuccess(p);await currentStep(p,3);
    const pending=await writes(p);
    const id=await p.evaluate(()=>cars.find(c=>!__registrationBefore.some(old=>old.id===c.id)).id);assert.equal(pending.local.length,3);assert.equal(pending.remote.length,2);
    await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await completeAndWait(p);const after=await writes(p);assert.equal(after.remote.length,3);assert.equal(after.remote.filter(c=>c.id===id).length,1);assert.equal(after.local.filter(c=>c.id===id).length,1);assert.equal(after.success,1);
    results.push({name:'unconfirmed failure keeps part3 and retry confirms the same vehicle without duplication',sameIdRetried:true,noFalseSuccess:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await stage3(p,{name:'응답 유실 복구 차량'});await p.evaluate(()=>window.__encarFixtureWriteMode='lost-response');await p.locator(COMPLETE).click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0);await p.locator(COMPLETE+':not([disabled])').waitFor();await noSuccess(p);const pending=await writes(p),id=pending.remote[0].id;assert.equal(pending.writes.length,1);assert.equal(pending.remote.length,3);
    await p.evaluate(()=>window.__encarFixtureWriteMode='ok');await p.locator(COMPLETE).click();await p.waitForFunction(()=>!document.getElementById('overlay').classList.contains('open'));await p.waitForFunction(()=>window.__registrationSuccessCount===1);await p.waitForFunction(()=>!document.getElementById('snote-purchase-registration-success'));const after=await writes(p);assert.equal(after.writes.length,1);assert.equal(after.remote.filter(c=>c.id===id).length,1);assert.equal(after.remote.length,3);
    results.push({name:'lost response recovers a server-committed vehicle exactly once',serverCommitReconciled:true,duplicateWrites:0});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await p.clock.setFixedTime(new Date('2026-11-15T09:00:00.000Z'));
    await identity(p,'금융과 비용 검증 차량');await p.locator(NEXT).click();await currentStep(p,2);
    await p.locator('#new-buy').fill('10000000');await p.locator('#new-sell').fill('12000000');await p.locator('#new-bodywork').fill('100000');await p.locator('#new-performanceInspection').fill('50000');
    await p.locator('#new-repair-items .repair-memo').first().fill('합성 추가비용');await p.locator('#new-repair-items .repair-amount').first().fill('25000');
    await p.locator(NEXT).click();await currentStep(p,3);
    const lender=await p.evaluate(async()=>{const name=document.getElementById('new-inventory-lender').options[1]?.value;if(!name)throw Error('Fixture requires existing lender');const row=ACC44_LENDER_LIMITS.find(x=>x[0]===name);if(row)row[2]=12;else ACC44_LENDER_LIMITS.push([name,100000000,12]);if(!await SnoteDealerFinanceRates.refresh({force:true}))throw Error('Synthetic seeded lender rate did not load');return name;});
    await p.locator('#new-prestock').check();await p.locator('#new-inventory-lender').selectOption(lender);await p.locator('#new-inventory-loan').fill('1000000');await p.locator('#new-inventory-started-at').fill('2026-11-05');await p.locator('#new-inventory-loan').blur();await tick(p);
    const interest=Math.round(1000000*.12*10/365),direct=100000+50000+25000+interest;
    assert.equal(Number((await p.locator('#new-inventory-interest').inputValue()).replaceAll(',','')),interest);
    const values=await p.locator('#add-cost-summary .sum-cell strong').allTextContents();assert.deepEqual(values.map(v=>Number(v.replace(/[^0-9-]/g,''))),[direct,10000000+direct,12000000-10000000-direct]);
    const {row}=await completeAndWait(p);assert.equal(row.isPrestock,true);assert.equal(row.inventoryLoan,1000000);assert.equal(row.inventoryLender,lender);assert.equal(row.inventoryStartedAt,'2026-11-05');assert.equal(row.costs.inventoryInterest,interest);assert.equal(row.costs.performanceInspection,50000);assert.equal(row.repairItems[0].amount,25000);
    assert.equal(await p.evaluate(()=>typeof PRESTOCK_V148_KEY==='string'?localStorage.getItem(PRESTOCK_V148_KEY):null),await p.evaluate(()=>__registrationLedgerBefore),'Vehicle classification does not invent a prestock ledger transfer');
    results.push({name:'costs, additional items, stock finance date and daily interest persist without creating a ledger transfer',interestWon:interest,loanIsNotDuplicatedAsCost:true,prestockClassificationStored:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await p.evaluate(async()=>{closeAdd();const base=__encarFixtureCars[0];const rows=Array.from({length:25},(_,i)=>({...base,id:'existing-registration-'+i,model:'기존 차량 '+String(i).padStart(2,'0'),plate:'10가'+String(1000+i)}));__encarFixtureCars=structuredClone(rows);__registrationBefore=structuredClone(rows);cars=normalizedCars(rows,currentUser.username);localStorage.setItem(carsStoreKey(currentUser.username),JSON.stringify(rows));navigate('buy');renderCars();await zc86Cloud.flush();__encarFixtureWrites=[];});
    await p.locator('#list-query').fill('기존');await p.locator('#list-table [data-sort-column]').first().click();await p.locator('#list-pagination').getByRole('button',{name:'2페이지',exact:true}).click();assert.equal(await p.locator('#list-pagination [aria-current="page"]').textContent(),'2');
    if(await p.locator('#list-screen').getAttribute('data-vehicle-view')!=='cards')await p.locator('#snote-vehicle-view-switch').click();await p.evaluate(()=>openAdd());await stage3(p,{name:'맨 위 새 카드'});const {row}=await completeAndWait(p);
    assert.equal(await p.locator('#list-query').inputValue(),'');assert.equal(await p.locator('#list-pagination [aria-current="page"]').textContent(),'1');assert.equal(await p.locator('#list-screen').getAttribute('data-vehicle-view'),'cards');assert.equal(await p.evaluate(()=>SnoteListSort.active('vehicles')),false);
    assert.equal(await firstVisibleRow(p),row.id);assert.equal(await p.locator('#list-mobile > [data-registration-car-id]').count(),20);await p.locator('[data-registration-car-id="'+row.id+'"].snote-registration-created:visible').waitFor();
    await p.screenshot({path:path.join(OUT,'registered-card-first-page.png')});results.push({name:'confirmed registration clears stale search/sort and reveals the first card on page1 with20-item pagination',cardViewPreserved:true,previousPage:2,firstPage:1,entryAnimation:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await stage3(p,{name:'응답 대기 중 다시 연 차량'});await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator(COMPLETE).click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
    const id=await p.evaluate(()=>snotePurchaseRegistrationAttempt.row.id);await p.evaluate(()=>{closeAdd();openAdd();});await currentStep(p,3);assert.equal(await p.locator('#new-buy').inputValue(),'10,000,000');assert.equal(await p.locator('#new-inventory-loan').isDisabled(),true);
    await p.evaluate(()=>{__encarFixtureWriteMode='ok';__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!snotePurchaseRegistrationAttempt?.inflight);await noSuccess(p);assert.equal(await p.locator(OVERLAY).evaluate(el=>el.classList.contains('open')),true);
    await completeAndWait(p);const state=await writes(p);assert.equal(state.writes.length,1);assert.equal(state.remote.filter(c=>c.id===id).length,1);assert.equal(state.success,1);
    results.push({name:'closing and reopening during a held ACK suppresses stale completion and resumes the same pending row',staleCompletionIgnored:true,sameRowResumed:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await stage3(p,{name:'세션 변경 응답 검증'});await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator(COMPLETE).click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
    await p.evaluate(()=>{currentUser={...currentUser,username:'synthetic-next-account'};window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!snotePurchaseRegistrationAttempt?.inflight);await noSuccess(p);assert.equal(await p.locator(OVERLAY).evaluate(el=>el.classList.contains('open')),true);
    results.push({name:'a late ACK after account identity changes cannot close or celebrate the next account workspace',noCrossAccountSuccess:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  for(const taxonomyMode of ['ok','fail']){
   const f=await setup(),p=f.page;try{
    await identity(p,'직접 입력 차종');await p.locator('#snote98-generation-input').fill('검증 세대');await p.locator('#new-grade').selectOption('__manual__',{force:true});await p.locator('#snote98-grade-input').fill('검증 트림');
    await p.locator(NEXT).click();await p.locator('#new-buy').fill('9500000');await p.locator(NEXT).click();await p.evaluate(mode=>__registrationTaxonomyMode=mode,taxonomyMode);
    const {row}=await completeAndWait(p);assert.equal(row.group,'직접 입력 차종');assert.equal(row.generation,'검증 세대');assert.equal(row.grade,'검증 트림');assert.equal(row.buy,9500000);
    const requests=await p.evaluate(()=>__registrationTaxonomyWrites);assert.equal(requests.length,1);assert.deepEqual(requests[0].p_entry,{make:'검증 제조사',group:'직접 입력 차종',model:'검증 세대',grade:'검증 트림',subgrade:'',model_year:''});
    results.push({name:'complete custom taxonomy '+taxonomyMode+' preserves authoritative vehicle acknowledgement',taxonomyMode,vehicleSaved:true,companyScopedTaxonomy:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    const selection=await p.evaluate(()=>{const row=SnoteVehicleCatalog.rows().find(r=>r.make&&r.group&&r.model&&r.grade);if(!row)throw Error('Expected existing verified catalogue');return{make:row.make,group:row.group,model:row.model,id:row.id,grade:row.grade};});
    await p.locator('#new-make').selectOption(selection.make);await p.locator('#new-group').selectOption(selection.group);await p.locator('#new-generation').selectOption(selection.model);await p.locator('#new-grade').selectOption(selection.id);
    await p.locator(NEXT).click();await p.locator('#new-buy').fill('15000000');await p.locator(NEXT).click();const {row}=await completeAndWait(p);assert.equal(row.make,selection.make);assert.equal(row.group,selection.group);assert.equal(row.generation,selection.model);assert.equal(row.grade,selection.grade);assert(row.taxonomyCatalogRef?.researchId);assert.equal(await p.evaluate(()=>__registrationTaxonomyWrites.length),0);
    results.push({name:'the existing verified catalogue selection is retained through all wizard parts and saved',catalogueReferenceStored:true,noManualCatalogueWrite:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;try{
    const expected=await p.evaluate(async()=>{closeAdd();openAutoRegistration();const match=snote201BestCatalog('그랜저');if(!match)throw Error('Expected known OCR model');zcAutoRegFile=new File([new Uint8Array([137,80,78,71])],'synthetic-registration.png',{type:'image/png'});document.getElementById('zc-auto-reg-plate').value='999가9999';document.getElementById('zc-auto-reg-model').value='그랜저';document.getElementById('zc-auto-reg-year').value='2025';document.getElementById('zc-auto-reg-vin').value='KMHXX000000000001';await continueAutoRegistration();return match;});
    await currentStep(p,1);assert.equal(await p.locator('#new-make').inputValue(),expected.make);assert.equal(await p.locator('#new-group').inputValue(),expected.group);assert.equal(await p.locator('#new-plate').inputValue(),'999가9999');assert.equal(await p.locator('#new-year').inputValue(),'2025');assert.equal(await p.locator('#new-vin').inputValue(),'KMHXX000000000001');assert.equal(await p.evaluate(()=>zcAutoRegPendingFile?.name),'synthetic-registration.png');assert.equal((await writes(p)).writes.length,0);await p.evaluate(()=>closeAdd());
    results.push({name:'the existing registration-document prefill enters wizard part1 with image and vehicle fields retained',ocrPrefillRetained:true,noOcrOrServerCall:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  }
  {
   const f=await setup(),p=f.page;try{
    await stage3(p,{name:'최소 정보 상세 저장 차량'});const {row}=await completeAndWait(p);assert.equal(row.km,'');
    await p.evaluate(id=>openVehicle(id),row.id);
    const scopes=await p.evaluate(id=>{const edit=window.snoteVehicleEditBridge,car=cars.find(c=>c.id===id),actor=currentUser,owner=car.ownerId;const allowed=!!edit.context(id),encarBlocked=window.snoteEncarLinksBridge.context(id)===null;car.ownerId='cld_unrelated_fixture';const wrongOwnerBlocked=edit.context(id)===null;car.ownerId=owner;currentUser={...actor,username:'cld_unrelated_fixture'};const wrongActorBlocked=edit.context(id)===null;currentUser=actor;return{allowed,encarBlocked,wrongOwnerBlocked,wrongActorBlocked};},row.id);
    assert.deepEqual(scopes,{allowed:true,encarBlocked:true,wrongOwnerBlocked:true,wrongActorBlocked:true});assert.equal(f.requests.length,0,'Editing a blank-plate vehicle cannot initiate an Encar search');await p.locator('#detail-memo').fill('선택항목을 생략해 등록한 차량의 메모');await p.locator('#detail-km').fill('');await p.locator('#detail-buy').fill('10500000');await p.evaluate(()=>__encarFixtureWriteMode='fail');await p.locator('#vehicle-header-save').click();await p.waitForFunction(()=>__encarFixtureWriteFailures>0&&!__encarFixtureState.saving);await p.locator('#vehicle-header-save:not([disabled])').waitFor();assert.equal(await p.locator('#vehicle-save-success').getAttribute('aria-hidden'),'true');
    const failedDetail=await p.evaluate(()=>snoteVehicleWriteState(activeCarId));assert(failedDetail?.pending,'A blank-plate detail edit keeps its scoped pending acknowledgement state');assert.equal((await writes(p)).writes.length,1);await p.evaluate(()=>__encarFixtureWriteMode='hold');await p.locator('#vehicle-header-save').click();await p.waitForFunction(()=>__encarFixtureWriteWaiting);assert.equal(await p.locator('#vehicle-save-success').getAttribute('aria-hidden'),'true');assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');assert(await p.evaluate(()=>!!snoteVehicleWriteState(activeCarId)));await p.evaluate(()=>{__encarFixtureWriteMode='ok';__encarFixtureReleaseWrite();});try{await p.waitForFunction(()=>__encarFixtureWrites.length>=2);}catch(error){console.error('Minimal detail save debug',JSON.stringify(await p.evaluate(()=>({toast:document.getElementById('toast')?.textContent,activeCarId,car:cars.find(c=>c.id===activeCarId),vehicleContext:!!snoteVehicleContext(),encarContext:!!snoteEncarLinksBridge.context(activeCarId),writes:__encarFixtureWrites.length,queue:__encarFixtureState.queue.size}))));throw error;}await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});
    const state=await writes(p),updated=state.remote.find(c=>c.id===row.id);assert.equal(updated.vehicleMemo,'선택항목을 생략해 등록한 차량의 메모');assert.equal(updated.buy,10500000);assert.equal(updated.km,'');assert.equal(updated.group,row.group);assert.equal(state.remote.length,3);assert.equal(state.remote.filter(c=>c.id===row.id).length,1);assert(state.revision>=2);
    await p.evaluate(id=>openVehicle(id),row.id);assert.equal(await p.locator('#detail-memo').inputValue(),updated.vehicleMemo);assert.equal(await p.locator('#detail-buy').inputValue(),'10,500,000');assert.equal(await p.locator('#detail-km').inputValue(),'');await p.evaluate(()=>closeVehicle({discard:true}));
    results.push({name:'a minimal registration remains editable in vehicle detail without inventing a missing mileage',memoAndAmountRoundTrip:true,blankMileageRetained:true,blankPlateEditAllowedButEncarBlocked:true,wrongActorAndOwnerBlocked:true,failedDetailRetryWaitsForAck:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await p.evaluate(()=>{closeAdd();openVehicle('encar-car-1');});assert.equal(await p.locator('#detail-km').inputValue(),'10,000');await p.locator('#detail-km').fill('');await p.locator('#detail-memo').fill('저장되면 안 되는 변경');await p.locator('#vehicle-header-save').click();await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('주행거리'));assert.equal((await writes(p)).writes.length,0);assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');assert.equal((await writes(p)).remote.find(c=>c.id==='encar-car-1').km,'10,000');await p.evaluate(()=>closeVehicle({discard:true}));
    results.push({name:'clearing a previously known mileage still rejects detail saving without a server write',knownMileageCannotBeErased:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;try{
    await identity(p,'취소한 차량');await p.locator(NEXT).click();await p.locator('#new-buy').fill('12500000');await p.evaluate(()=>closeAdd({animate:true}));await p.waitForFunction(()=>!document.getElementById('overlay').classList.contains('open'));const state=await writes(p);assert.equal(state.writes.length,0);assert.equal(state.local.length,2);await noSuccess(p);results.push({name:'closing an unfinished registration creates no vehicle or server write',noBusinessWrite:true});await finish(f);console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  assert.deepEqual(sourceHashes(),before,'Product/test sources must stay frozen during final verification');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,profile:process.env.SNOTE_REGISTRATION_DETAIL_ONLY?'detail':'full',at:new Date().toISOString(),sourceHashes:before,results,syntheticOnly:true,productionWrites:0},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
