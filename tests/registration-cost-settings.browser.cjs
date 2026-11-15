'use strict';
// Actual application, cloud context bridge and cost-settings RPC contract.
// Auth, RPC storage, vehicle CAS and HTTP are synthetic; no production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_REGISTRATION_COST_ARTIFACT_DIR||'/tmp/snote-registration-cost-settings';
const A='custom-00000000-0000-4000-8000-000000000001',USER_B='22222222-2222-4222-8222-222222222222';
const TRIGGER='#snote-new-cost-settings-trigger',DIALOG='#snote-vehicle-cost-settings',NEXT='#purchase-registration-next';
fs.mkdirSync(OUT,{recursive:true});
const hashes=()=>Object.fromEntries(['index.html','assets/purchase-registration.js','assets/purchase-registration.css','assets/vehicle-cost-settings.js','assets/vehicle-cost-settings.css','tests/registration-cost-settings.browser.cjs'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]));
const check=(p,id)=>p.locator('#snote-cost-settings-list input[data-cost-field="'+id+'"]');
async function settle(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.locator('#overlay .snote-popup-frame').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getTiming()?.iterations)).map(a=>a.finished.catch(()=>{}))));}
async function setup(width=1440,seed=null){
 const f=await fixture(width,seed?.cars),p=f.page;
 await p.waitForFunction(()=>!!window.SnotePurchaseRegistration&&!!window.SnoteVehicleCostSettings);
 await p.evaluate(async({A,seed})=>{
  const S=window.__encarFixtureState,rpc=S.client.rpc.bind(S.client),copy=value=>structuredClone(value);
  const defaults=()=>SnoteVehicleCostSettingsModel.normalize(null),key=(company,user)=>company+':'+user;
  window.__registrationCosts={store:seed?.store||{[key(S.company.id,S.user.id)]:{config:SnoteVehicleCostSettingsModel.add(defaults(),'탁송비',A),revision:0}},calls:[],holdLoad:false,holdSave:false,failLoad:false,failSave:false,successes:0,loadResolvers:[],heldLoads:0};
  const t=window.__registrationCosts;
  new MutationObserver(records=>{for(const record of records)for(const el of record.addedNodes)if(el.nodeType===1&&(el.id==='snote-purchase-registration-success'||el.querySelector?.('#snote-purchase-registration-success')))t.successes++;}).observe(document.body,{childList:true,subtree:true});
  S.client.rpc=async(name,args={})=>{
   if(name==='snote_vehicle_cost_config_get'||name==='snote_vehicle_cost_config_save'){
    const user=S.user.id,company=S.company.id,owner=key(company,user);t.calls.push({name,user,company,args:copy(args)});
    if(name==='snote_vehicle_cost_config_get'){
     const result=copy(t.store[owner]||{config:defaults(),revision:0});
     if(t.holdLoad){t.heldLoads++;t.loadWaiting=true;await new Promise(resolve=>{t.loadResolvers.push(resolve);t.releaseLoad=()=>{for(const release of t.loadResolvers.splice(0))release();};});t.heldLoads--;t.loadWaiting=t.heldLoads>0;}
     return t.failLoad?{data:null,error:{code:'SYNTHETIC_LOAD_FAILED'}}:{data:result,error:null};
    }
    if(args.p_expected_company_id!==company||args.p_expected_user_id!==user)throw Error('Preference writes must be scoped to the authenticated dealer');
    if(t.holdSave){t.saveWaiting=true;await new Promise(resolve=>t.releaseSave=resolve);t.saveWaiting=false;}
    if(t.failSave)return{data:null,error:{code:'40001'}};
    const prior=t.store[owner]||{revision:0};if(prior.revision!==args.p_expected_revision)return{data:null,error:{code:'40001'}};
    const result={config:SnoteVehicleCostSettingsModel.normalize(args.p_config),revision:prior.revision+1};t.store[owner]=copy(result);return{data:copy(result),error:null};
   }
   if(name==='snote_vehicle_taxonomy_list')return{data:{company_id:S.company.id,entries:[]},error:null};
   if(name==='snote_research_vehicle_catalog_list'){const api=SnoteVehicleCatalog,entries=api.rows();return{data:{dataset_version:api.version(),manifest_sha256:api.manifestSha256(),entry_count:entries.length,entries},error:null};}
   return rpc(name,args);
  };
  SnoteVehicleCostSettings.reset();closeVehicle({discard:true});navigate('buy');openAdd();
 },{A,seed});
 await p.locator('#overlay.open').waitFor();await step2(p);return f;
}
async function step2(p,name='개인 비용 설정 등록 차량'){
 for(const[field,value]of[['make','검증 제조사'],['group',name]]){await p.locator('#new-'+field).selectOption('__manual__',{force:true});await p.locator('#snote98-'+field+'-input').fill(value);}
 await p.locator(NEXT).click();await p.locator('#purchase-registration-step-2').waitFor({state:'visible'});
 await p.locator('#new-buy').fill('10000000');await p.locator('#new-sell').fill('12000000');await settle(p);
}
async function open(p,selector=TRIGGER){await p.locator(selector).click();await p.locator(DIALOG).waitFor({state:'visible'});await check(p,'bodywork').waitFor();await check(p,'bodywork').waitFor({state:'attached'});await p.waitForFunction(()=>!document.querySelector('#snote-cost-settings-list input[data-cost-field="bodywork"]').disabled);}
async function save(p){await p.locator('#snote-cost-settings-save').click();await p.locator(DIALOG).waitFor({state:'hidden'});}
async function addCustom(p,name){await p.locator('#snote-cost-settings-name').fill(name);await p.locator('#snote-cost-settings-add button').click();return p.locator('#snote-cost-settings-list input[data-cost-field^="custom-"]').evaluateAll((els,A)=>els.map(el=>el.dataset.costField).find(id=>id!==A),A);}
async function state(p){return p.evaluate(()=>({store:structuredClone(__registrationCosts.store),calls:structuredClone(__registrationCosts.calls),writes:structuredClone(__encarFixtureWrites),cars:__encarFixtureCars.map(car=>SnoteMoney.car(car)),user:__encarFixtureState.user.id,company:__encarFixtureState.company.id}));}
async function switchDealer(p,user){await p.evaluate(async user=>{closeAdd();closeVehicle({discard:true});const S=__encarFixtureState;S.user={id:user,email:'other-synthetic@example.invalid'};S.members=[{user_id:user,company_id:S.company.id,role:'dealer',active:true,display_name:'다른 검증 딜러'}];currentUser={...currentUser,username:'cld_'+user.replaceAll('-','').slice(0,18),name:'다른 검증 딜러'};SnoteVehicleCostSettings.reset();openAdd();},user);await step2(p,'다른 딜러 등록 차량');}
(async()=>{const before=hashes(),results=[],browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390,320]){
   const f=await setup(width),p=f.page;try{
    await p.locator('#new-'+A).waitFor({state:'visible'});assert.match(await p.locator(TRIGGER).getAttribute('aria-label'),/비용.*설정/);
    const gear=await p.locator(TRIGGER).boundingBox(),caption=await p.locator('#overlay .add-subtitle').boundingBox(),gearGlyph=await p.locator(TRIGGER+' svg').boundingBox();assert(Math.abs(gear.y+gear.height/2-caption.y-caption.height/2)<=6,'Settings gear belongs on the acquisition-cost title line');assert(gearGlyph&&gearGlyph.width>=12&&gearGlyph.height>=12,'Gear glyph must remain visible inside its target');
    await p.locator('#new-bodywork').fill('123456');await p.locator('#new-'+A).fill('43210');
    await open(p);await check(p,'bodywork').uncheck();await check(p,A).uncheck();const C=await addCustom(p,'검사대행료');assert(C);
    await p.locator('#snote-cost-settings-close').click();assert.equal(await p.locator('#snote-cost-settings-confirm').isVisible(),true);assert.equal(await p.locator('#overlay.open').isVisible(),true);await p.locator('#snote-cost-settings-return').click();assert.equal(await check(p,'bodywork').isChecked(),false);assert.equal(await check(p,C).isChecked(),true);
    const dialogBox=await p.locator(DIALOG).boundingBox();assert(dialogBox.x>=0&&dialogBox.x+dialogBox.width<=width);assert.equal(await p.locator(DIALOG).evaluate(el=>el.scrollWidth>el.clientWidth),false);await p.screenshot({path:path.join(OUT,'settings-'+width+'.png')});await save(p);
    assert.equal(await p.locator('#new-bodywork').isHidden(),true);assert.equal(await p.locator('#new-'+A).isHidden(),true);assert.equal(await p.locator('#new-bodywork').inputValue(),'123,456');assert.equal(await p.locator('#new-'+A).inputValue(),'43,210');
    await p.locator('#new-'+C).fill('98765');await open(p);await p.locator('[data-cost-remove="'+C+'"]').click();assert.equal(await check(p,C).count(),0);await save(p);
    assert.equal(await p.locator('#new-'+C).inputValue(),'98,765','Removing a personal definition preserves a typed vehicle amount');
    await p.locator('#new-repair-add').click();const repair=p.locator('#new-repair-items .repair-row').last();await repair.locator('.repair-memo').fill('추가 정비');await repair.locator('.repair-amount').fill('25000');
    const icons=await p.evaluate(()=>{const add=document.getElementById('new-repair-add'),remove=document.querySelector('#new-repair-items .repair-row:last-child .repair-remove');return[add,remove].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),svg=el.querySelector('svg'),glyph=svg?.getBoundingClientRect();return{width:r.width,height:r.height,color:s.color,glyph:glyph?{width:glyph.width,height:glyph.height,opacity:Number(getComputedStyle(svg).opacity)}:null,text:el.textContent.trim(),round:parseFloat(s.borderRadius)};});});
    for(const icon of icons){assert(icon.width>10&&icon.width<=32&&icon.height>10&&icon.height<=32);assert(icon.glyph&&icon.glyph.width>=12&&icon.glyph.height>=12&&icon.glyph.opacity>0);assert.equal(icon.text,'');}const [blue,red]=icons.map(icon=>icon.color.match(/[\d.]+/g).map(Number));assert(blue[2]>blue[0],'Addition uses a blue icon');assert(red[0]>red[2],'Removal uses a red icon');
    await p.screenshot({path:path.join(OUT,'registration-costs-'+width+'.png')});await p.locator('#purchase-registration-previous').click();await p.locator(NEXT).click();assert.equal(await p.locator('#new-'+C).inputValue(),'98,765');
    await p.locator(NEXT).click();assert.match(await p.locator('#add-cost-summary').textContent(),/290,431원/);assert.match(await p.locator('#add-cost-summary').textContent(),/10,290,431원/);assert.match(await p.locator('#add-cost-summary').textContent(),/1,709,569원/);assert.equal((await state(p)).writes.length,0,'Personal display settings do not write vehicle data');
    await p.locator('#purchase-registration-complete').click();await p.waitForFunction(()=>__encarFixtureWrites.length>0);await p.waitForFunction(()=>!document.getElementById('overlay').classList.contains('open'));await p.waitForFunction(()=>__registrationCosts.successes===1);await p.waitForFunction(()=>!document.getElementById('snote-purchase-registration-success'));const saved=await state(p),row=saved.cars[0];
    assert.equal(row.costs.bodywork,123456);assert.equal(row.customCosts[A],43210);assert.equal(row.customCosts[C],98765);assert.equal(row.customCostLabels[A],'탁송비');assert.equal(row.customCostLabels[C],'검사대행료');assert.equal(row.costs.customCosts,undefined);assert.equal(row.costs.repair,25000);assert.equal(saved.cars.filter(car=>car.id===row.id).length,1);
    await p.evaluate(id=>openVehicle(id),row.id);await p.locator('#detail-'+C).waitFor();await open(p,'#snote-cost-settings-trigger');assert.equal(await check(p,'bodywork').isChecked(),false);assert.equal(await check(p,A).isChecked(),false);assert.equal(await check(p,C).count(),0);await p.locator('#snote-cost-settings-close').click();assert.equal(await p.locator('#detail-'+C).inputValue(),'98,765');await p.evaluate(()=>closeVehicle({discard:true}));
    const restoreSeed=await state(p);await finish(f);const restored=await setup(width,{cars:restoreSeed.cars.map(car=>({...car,moneyUnit:'KRW'})),store:restoreSeed.store});
    try{assert.equal(await restored.page.locator('#new-bodywork').isHidden(),true);assert.equal(await restored.page.locator('#new-'+A).isHidden(),true);assert.equal(await restored.page.locator('#new-'+A).inputValue(),'');assert.equal(await restored.page.locator('#new-'+C).count(),0,'Fresh registrations do not inherit a prior vehicle orphan amount');await restored.page.evaluate(()=>closeAdd());await finish(restored);}catch(error){await restored.context.close();throw error;}
    results.push({name:width+'px personal cost settings, retained hidden/orphan amounts, compact icons, exact totals, acknowledged top-level persistence and fresh-document restore',width,icons});console.log('PASS '+results.at(-1).name);
   }catch(error){if(!p.isClosed())await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;try{
    await open(p);await check(p,'bodywork').uncheck();await p.evaluate(()=>__registrationCosts.failSave=true);await p.locator('#snote-cost-settings-save').click();await p.waitForFunction(()=>document.getElementById('snote-cost-settings-message').textContent.includes('다른 화면'));assert.equal(await p.locator(DIALOG).isVisible(),true);assert.equal(await check(p,'bodywork').isChecked(),false);assert.equal(await p.locator('#new-bodywork').isVisible(),true,'An unacknowledged preference cannot change the form');assert.equal(await p.locator('#new-buy').inputValue(),'10,000,000');assert.equal((await state(p)).writes.length,0);
    await p.evaluate(()=>__registrationCosts.failSave=false);await save(p);assert.equal(await p.locator('#new-bodywork').isHidden(),true);assert.equal(await p.locator('#new-buy').inputValue(),'10,000,000');await p.evaluate(()=>closeAdd());await finish(f);results.push({name:'A personal-settings CAS conflict keeps the unsaved settings and vehicle drafts until acknowledged retry',noOptimisticConfig:true,retryPreservesDraft:true});console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await open(p);await check(p,'bodywork').uncheck();await p.evaluate(()=>__registrationCosts.holdSave=true);await p.locator('#snote-cost-settings-save').click();await p.waitForFunction(()=>__registrationCosts.saveWaiting);
    await switchDealer(p,USER_B);await open(p);assert.equal(await check(p,'bodywork').isChecked(),true);assert.equal(await check(p,A).count(),0);
    await p.evaluate(()=>{__registrationCosts.holdSave=false;__registrationCosts.releaseSave();});await p.waitForFunction(()=>!__registrationCosts.saveWaiting);assert.equal(await p.locator(DIALOG).isVisible(),true);assert.equal(await check(p,'bodywork').isChecked(),true);assert.equal(await check(p,A).count(),0);
    const current=await state(p);assert.equal(current.calls.filter(call=>call.name.endsWith('_save')).length,1);const old=current.calls.find(call=>call.name.endsWith('_save')),oldKey=old.company+':'+old.user;assert.equal(current.store[oldKey].config.visible.includes('bodywork'),false);assert(!current.store[current.company+':'+USER_B]);await p.locator('#snote-cost-settings-close').click();await p.evaluate(()=>closeAdd());await finish(f);results.push({name:'A delayed personal-settings save for dealer A cannot change dealer B or its open registration editor',dealerIsolation:true,lateSaveBlocked:true});console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await p.evaluate(()=>{__registrationCosts.holdLoad=true;window.__lateCostLoad=SnoteVehicleCostSettings.refresh({view:'new',force:true}).catch(error=>error.code);});await p.waitForFunction(()=>__registrationCosts.loadWaiting);
    await p.evaluate(()=>{closeAdd();openAdd();});await step2(p,'새 등록 세션');await p.evaluate(()=>{__registrationCosts.holdLoad=false;__registrationCosts.releaseLoad();});await p.evaluate(()=>__lateCostLoad);await open(p);assert.equal(await check(p,'bodywork').isChecked(),true);assert.equal(await p.locator('#snote-cost-settings-name').inputValue(),'');await p.locator('#snote-cost-settings-close').click();assert.equal(await p.locator('#snote98-group-input').inputValue(),'새 등록 세션');await p.evaluate(()=>closeAdd());await finish(f);results.push({name:'A settings load captured in a closed registration cannot replace a later registration session',lateViewLoadBlocked:true});console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(),p=f.page;try{
    await p.locator('#new-'+A).waitFor({state:'visible'});await p.locator('#new-'+A).fill('43210');await open(p);await check(p,'bodywork').uncheck();await p.evaluate(()=>__registrationCosts.holdSave=true);await p.locator('#snote-cost-settings-save').click();await p.waitForFunction(()=>__registrationCosts.saveWaiting);
    const priorLoads=(await state(p)).calls.filter(call=>call.name.endsWith('_get')).length;await p.evaluate(()=>{closeAdd();openAdd();});await step2(p,'같은 딜러 새 입력 초안');await p.locator('#new-buy').fill('11000000');await p.waitForFunction(count=>__registrationCosts.calls.filter(call=>call.name.endsWith('_get')).length>count,priorLoads);await p.locator('#new-'+A).waitFor({state:'visible'});assert.equal(await p.locator('#new-bodywork').isVisible(),true,'The new view reads the server before the delayed old commit');assert.equal(await p.locator('#new-'+A).inputValue(),'','Old vehicle custom amount cannot enter the new draft');
    await p.evaluate(()=>{__registrationCosts.holdSave=false;__registrationCosts.releaseSave();});await p.waitForFunction(()=>!__registrationCosts.saveWaiting);await p.locator('#new-bodywork').waitFor({state:'hidden'});assert.equal(await p.locator('#new-buy').inputValue(),'11,000,000');assert.equal(await p.locator('#snote98-group-input').inputValue(),'같은 딜러 새 입력 초안');assert.equal(await p.locator('#new-'+A).inputValue(),'');
    await open(p);assert.equal(await check(p,'bodywork').isChecked(),false);await check(p,'polish').uncheck();await save(p);const saved=await state(p),account=saved.company+':'+saved.user;assert.equal(saved.store[account].revision,2,'New view uses the freshly fetched post-commit revision');assert.equal(saved.store[account].config.visible.includes('polish'),false);assert.equal(saved.writes.length,0);await p.evaluate(()=>closeAdd());await finish(f);results.push({name:'A same-dealer save committed after registration reopening refreshes the current server revision without copying old vehicle drafts',actualBridgeContextChanged:true,currentRevisionReloaded:true,newDraftUntouched:true});console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390,{store:{}}),p=f.page;try{
    assert.equal(await p.locator('#new-'+A).count(),0);await p.evaluate(A=>{const S=__encarFixtureState,t=__registrationCosts;t.store[S.company.id+':'+S.user.id]={config:SnoteVehicleCostSettingsModel.add(SnoteVehicleCostSettingsModel.normalize(null),'늦게 추가된 항목',A),revision:1};t.holdLoad=true;window.__heldCostLoad=SnoteVehicleCostSettings.refresh({view:'new',force:true}).catch(error=>error.code);},A);await p.waitForFunction(()=>__registrationCosts.loadWaiting);
    await p.locator(NEXT).click();await p.evaluate(()=>__encarFixtureWriteMode='hold');await p.locator('#purchase-registration-complete').click();await p.waitForFunction(()=>__encarFixtureWriteWaiting);const staged=await p.evaluate(()=>({id:snotePurchaseRegistrationAttempt.row.id,customCosts:structuredClone(snotePurchaseRegistrationAttempt.row.customCosts)}));assert.deepEqual(staged.customCosts,{});
    await p.evaluate(()=>{__registrationCosts.holdLoad=false;__registrationCosts.releaseLoad();});await p.evaluate(()=>__heldCostLoad);await p.locator('#new-'+A).waitFor({state:'attached'});assert.equal(await p.locator('#new-'+A).isDisabled(),true,'A late-created custom field respects the frozen vehicle save');assert.deepEqual(await p.evaluate(()=>snotePurchaseRegistrationAttempt.row.customCosts),{});assert.equal(await p.locator('#new-buy').isDisabled(),true);assert.equal((await state(p)).writes.length,0);
    await p.evaluate(()=>{__encarFixtureWriteMode='ok';__encarFixtureReleaseWrite();});await p.waitForFunction(()=>__encarFixtureWrites.length===1);await p.waitForFunction(()=>__registrationCosts.successes===1);await p.waitForFunction(()=>!document.getElementById('snote-purchase-registration-success'));const saved=await state(p);assert.equal(saved.cars.filter(car=>car.id===staged.id).length,1);assert.deepEqual(saved.cars.find(car=>car.id===staged.id).customCosts,{});assert.equal(saved.cars.length,3);await finish(f);results.push({name:'A preference load creating a custom input during held vehicle ACK keeps it locked and preserves the staged vehicle snapshot',lateCustomInputDisabled:true,noDuplicateVehicle:true});console.log('PASS '+results.at(-1).name);
   }catch(error){await f.context.close();throw error;}
  }
  assert.deepEqual(hashes(),before,'Freeze source before recording final verification');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:before,results,syntheticOnly:true,productionWrites:0},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
