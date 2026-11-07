'use strict';
// Actual index, actual versioned research catalogue JSON and real Chromium.
// Auth and dataset acknowledgements are synthetic. Every HTTP request is routed
// by the shared fixture; this test performs no production or external writes.
// Run: CHROMIUM_PATH=/usr/bin/chromium node tests/researched-vehicle-catalog.browser.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://encar-smoke.example';
const ACTOR='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALIAS='cld_'+ACTOR.replaceAll('-','').slice(0,18);
const CATALOG=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/vehicle-catalog.json'),'utf8'));
const RECORDS=CATALOG.records,IDS=new Set(RECORDS.map(row=>row.id));
const clone=value=>structuredClone(value);
const LEGACY={make:'보관전용제조사',group:'이전차명',model:'이전세부모델',grade:'이전등급',subgrade:'이전세부등급',model_year:'2021',verification:'user_import',source:'vehicle_registration_manual',market:'KR'};
const oldCar=(extra={})=>({id:'encar-car-1',moneyUnit:'KRW',ownerId:ALIAS,model:'기존 표시 차량명 원문 그대로',make:'이전제조사',group:'이전차명군',generation:'이전세대 GX',grade:'이전등급',subgrade:'이전세부등급',plate:'12가3456',year:2021,km:'10,000',buy:1000000,sell:2200000,status:'판매중',color:'크림 화이트',purchaseAt:'2026-10-01',...extra});
const IDENTITY=['model','make','group','generation','grade','subgrade'];

async function ready(page){
 await page.waitForFunction(()=>!!window.SnoteVehicleCatalog&&typeof window.SnoteVehicleCatalog.rows==='function');
 await page.evaluate(()=>window.SnoteVehicleCatalog.ready);
 await page.waitForFunction(()=>window.SnoteVehicleCatalog.rows().length===3128);
}

async function setup(width=1440){
 const second=oldCar({id:'encar-car-2',model:'완전 미분류 차량의 원래 제목',make:'',group:'',generation:'',grade:'직접입력 트림 원문',subgrade:'수기 세부정보',plate:'34나5678'});
 const f=await fixture(width,[oldCar(),second]),p=f.page;
 await ready(p);await p.evaluate(()=>closeVehicle({discard:true}));
 await p.evaluate(({actor,company,catalog})=>{
  const S=__encarFixtureState,previous=S.client;
  window.__researchCataloguePayload=catalog;
  window.__researchCatalogueRPC=[];
  window.__researchLegacyCatalogue=Array.from({length:6},(_,i)=>({id:'aaaaaaaa-0000-4000-8000-'+String(i+1).padStart(12,'0'),make:'보관상사제조사'+i,group:'백업차명',model:'백업세대',grade:'백업등급',subgrade:'',model_year:'2021',verification:'user_import',source:'company_vehicle_registration',market:'KR'}));
  S.client={...previous,
   from(table){
    if(table!=='zc_datasets')return previous.from(table);
    const filters={},options={single:false};
    const chain={select(){return chain;},eq(key,value){filters[key]=value;return chain;},in(){return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){options.single=true;return chain;},single(){options.single=true;return chain;},then(resolve,reject){
     if(filters.company_id&&filters.company_id!==company)return Promise.reject(Error('Unexpected company')).then(resolve,reject);
     const data=[{dataset:'cars',owner_id:actor,payload:structuredClone(__encarFixtureCars),revision:__encarFixtureRevision},{dataset:'covers',owner_id:actor,payload:{},revision:1}].filter(row=>(!filters.owner_id||row.owner_id===filters.owner_id)&&(!filters.dataset||row.dataset===filters.dataset));
     return Promise.resolve({data:options.single?(data[0]||null):data,error:null}).then(resolve,reject);
    }};return chain;
   },
   async rpc(name,args){
    if(name==='snote_research_vehicle_catalog_list'){__researchCatalogueRPC.push({name,args});return{data:{dataset_version:__researchCataloguePayload.catalogVersion,manifest_sha256:window.SnoteVehicleCatalog.manifestSha256(),entry_count:__researchCataloguePayload.records.length,entries:__researchCataloguePayload.records},error:null};}
    if(name==='snote_vehicle_taxonomy_list'){__researchCatalogueRPC.push({name,args});return{data:{company_id:company,entries:[]},error:null};}
    if(name==='snote_vehicle_taxonomy_upsert'){__researchCatalogueRPC.push({name,args});throw Error('Active research choices must not overwrite the legacy five-field catalogue');}
    return previous.rpc(name,args);
   }
  };
 },{actor:ACTOR,company:COMPANY,catalog:CATALOG});
 return f;
}

async function openAdd(page){await page.evaluate(()=>openAdd());await page.locator('#overlay.open').waitFor();await ready(page);}

async function choose(page,prefix,row){
 for(const [field,value]of [['make',row.make],['group',row.group],['generation',row.model]])await page.locator('#'+prefix+'-'+field).selectOption(value);
 const grade=page.locator('#'+prefix+'-grade');
 assert((await grade.locator('option').evaluateAll(options=>options.map(option=>option.value))).includes(row.id),'Every source observation must have its own leaf option');
 await grade.selectOption(row.id);
 const selected=await page.evaluate(prefix=>snote282GradeRecord(prefix),prefix);
 assert.equal(selected.researchId,row.researchId);assert.equal(selected.grade,row.grade);assert.equal(selected.subgrade,row.subgrade);
 const label=await grade.locator('option:checked').textContent();
 assert(label.trim());assert(!label.includes(row.id),'Internal research IDs must not be user-facing option labels');
 if(row.grade)assert(label.includes(row.grade));if(row.subgrade)assert(label.includes(row.subgrade));
 if(!row.grade)assert.match(label,/미기재|미확인|정보|모델/,'A blank source grade needs a readable display label, not a fabricated trim');
 return selected;
}

async function register(page,row,index){
 await openAdd(page);await choose(page,'new',row);
 const plate='91가'+String(index).padStart(4,'0');
 await page.locator('#new-plate').fill(plate);await page.locator('#new-year').fill('2025');
 await page.locator('#new-km').fill('1000');await page.locator('#new-buy').fill('1000000');await page.locator('#new-sell').fill('1500000');
 await page.locator('#new-purchase-date').fill('2026-11-01');
 const preview=await page.locator('#new-visual-preview').textContent();
 assert(!/research-[a-f0-9]{24}/.test(preview),'Preview must resolve the selected leaf to its real labels');
 const previewAlt=await page.locator('#new-visual-preview img').getAttribute('alt');
 assert(!/research-[a-f0-9]{24}/.test(previewAlt),'Default image descriptions must not leak the selection ID');
 const expectedRef=await page.evaluate(id=>window.SnoteVehicleCatalog.reference(window.SnoteVehicleCatalog.get(id)),row.id);
 await page.locator('#overlay [type=submit]').click();
 await page.waitForFunction(plate=>__encarFixtureCars.some(car=>car.plate===plate),plate);
 await page.locator('#overlay.open').waitFor({state:'hidden'});
 const saved=await page.evaluate(plate=>SnoteMoney.car(__encarFixtureCars.find(car=>car.plate===plate)),plate);
 assert.equal(saved.make,row.make);assert.equal(saved.group,row.group);assert.equal(saved.generation,row.model);
 assert.equal(saved.grade,row.grade);assert.equal(saved.subgrade,row.subgrade);
 assert.equal(saved.taxonomyCatalogRef.researchId,row.researchId);assert.deepEqual(saved.taxonomyCatalogRef,expectedRef);
 assert(!/research-[a-f0-9]{24}/.test(saved.model),'Stored display title must not contain an opaque selection ID');
 return saved;
}

async function assertQuote(page,car,row=null){
 await page.evaluate(id=>openVehicle(id),car.id);await page.locator('#vehicle-overlay.open').waitFor();
 if(row)assert.equal(await page.locator('#detail-grade').inputValue(),row.id,'A saved source-context reference must restore its own leaf');
 await page.locator('#vehicle-header-actions .quote-launch').click();await page.locator('#quote-overlay.open').waitFor();
 const printed=await page.locator('#quote-grade').inputValue(),title=await page.locator('#quote-car-name').inputValue();
 assert(!/research-[a-f0-9]{24}|__existing__/.test(printed+' '+title),'Quote must resolve IDs and legacy sentinels before displaying them');
 if(car.grade)assert(printed.includes(car.grade),'Quote must retain the actual trim name');
 if(car.subgrade)assert(printed.includes(car.subgrade),'Quote must retain the separate subgrade');
 await page.evaluate(()=>closeQuotePreview());await page.evaluate(()=>closeVehicle({discard:true}));
}

async function allRowsAndLeaves(f){
 const p=f.page;
 const actual=await p.evaluate(()=>window.SnoteVehicleCatalog.rows());
 assert.equal(actual.length,3128);assert.deepEqual(actual.map(r=>r.id).sort(),[...IDS].sort());
 const expectedById=new Map(RECORDS.map(r=>[r.id,r]));
 for(const row of actual){
  const expected=expectedById.get(row.id);
  for(const key of ['make','group','model','grade','subgrade','modelYear','market','fuel','engine','drivetrain','transmission','sourcePeriod','sourcePublicationDate','qualifiers','savedSourceConditions'])assert.deepEqual(row[key],expected[key],'Source context changed: '+row.id+' '+key);
 }
 assert.equal(actual.filter(row=>!row.grade).length,180);assert.equal(actual.filter(row=>row.subgrade).length,408);assert.equal(actual.filter(row=>row.market==='GLOBAL').length,154);
 assert.equal(new Set(actual.map(r=>JSON.stringify(['make','group','model','grade','subgrade'].map(k=>r[k])))).size,2924,'The 204 context-distinct observations must survive identical five-field names');
 // Put former browser-global imports into their original database. Re-running
 // actual initialization must keep those bytes available but never activate them.
 await p.evaluate(async legacy=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('zerocar-office-v13-taxonomy',1);request.onupgradeneeded=()=>request.result.createObjectStore('entries',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put({...legacy,key:'legacy-catalogue-backup-test'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();await initTaxonomy();
 },LEGACY);
 await openAdd(p);
 const accessibility=await p.evaluate(async()=>{
  const rows=window.SnoteVehicleCatalog.rows(),branches=new Map(),ids=new Set(),missing=[];
  for(const row of rows){const key=JSON.stringify([row.make,row.group,row.model]);if(!branches.has(key))branches.set(key,{make:row.make,group:row.group,model:row.model,ids:[]});branches.get(key).ids.push(row.id);}
  const select=(field,value)=>{const element=document.getElementById('new-'+field);element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));};
  for(const branch of branches.values()){
   select('make',branch.make);select('group',branch.group);select('generation',branch.model);
   const options=[...document.getElementById('new-grade').options].map(o=>o.value),expected=new Set(branch.ids);
   for(const id of branch.ids){if(!options.includes(id))missing.push(id);else ids.add(id);}
   for(const id of options)if(id.startsWith('research-')&&!expected.has(id))missing.push('wrong-parent:'+id);
  }
  return{reachable:[...ids].sort(),missing,branches:branches.size,choices:domesticTaxonomy().map(r=>r.id),makes:[...document.getElementById('new-make').options].map(o=>o.value),legacyRows:__researchLegacyCatalogue.length,upserts:__researchCatalogueRPC.filter(r=>r.name==='snote_vehicle_taxonomy_upsert').length};
 });
 assert.deepEqual(accessibility.missing,[]);assert.deepEqual(accessibility.reachable,[...IDS].sort());
 assert.equal(accessibility.choices.length,3128);assert(!accessibility.makes.includes(LEGACY.make));assert(!accessibility.makes.some(name=>name.startsWith('보관상사제조사')));
 assert.equal(accessibility.legacyRows,6);assert.equal(accessibility.upserts,0);
 await p.evaluate(()=>closeAdd());
 console.log('PASS all 3128 source-context rows reach actual dropdown leaves across '+accessibility.branches+' branches; blank grades, subgrades, GLOBAL rows and 204 equal-name tuples remain distinct; old DB stays backup only');
}

async function legacyFinancialSave(f){
 const p=f.page;
 for(const id of ['encar-car-1','encar-car-2']){
  await p.evaluate(id=>openVehicle(id),id);await p.locator('#vehicle-overlay.open').waitFor();
  const before=await p.evaluate(id=>structuredClone(cars.find(car=>car.id===id)),id);
  const projected=await p.evaluate(()=>getDetailModel());
  for(const key of IDENTITY)assert.equal(projected[key],before[key],'Opening a former catalogue vehicle must preserve '+key);
  await p.locator('#detail-sell').fill(id==='encar-car-1'?'2234567':'2345678');
  await p.locator('#vehicle-header-save').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});
  const saved=await p.evaluate(id=>SnoteMoney.car(__encarFixtureCars.find(car=>car.id===id)),id);
  for(const key of IDENTITY)assert.equal(saved[key],before[key],'Saving a price must not rewrite a legacy '+key);
  assert.deepEqual(saved.taxonomyCatalogRef,before.taxonomyCatalogRef);
  assert.equal(saved.sell,id==='encar-car-1'?2234567:2345678);
  await assertQuote(p,saved);
 }
 console.log('PASS financial-only server saves preserve complete legacy and unclassified vehicle identities; quote labels contain no sentinels or record IDs');
}

function duplicatePair(){
 const groups=new Map();
 for(const row of RECORDS){const key=JSON.stringify(['make','group','model','grade','subgrade'].map(k=>row[k]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 const context=row=>JSON.stringify(['modelYear','fuel','engine','market','sourcePeriod','sourcePublicationDate','qualifiers'].map(k=>row[k]));
 for(const values of groups.values())for(let i=1;i<values.length;i++)if(context(values[0])!==context(values[i]))return[values[0],values[i]];
 throw Error('Expected an actual same-name, context-distinct source pair');
}

async function sourceRegistrations(f,width){
 const p=f.page,subgrade=RECORDS.find(r=>r.market==='KR'&&r.subgrade),empty=RECORDS.find(r=>!r.grade),global=RECORDS.find(r=>r.market==='GLOBAL');
 const selected=width===1440?[subgrade,empty,global,...duplicatePair()]:[width===320?global:subgrade];
 const saved=[];
 for(let i=0;i<selected.length;i++){
  const car=await register(p,selected[i],1000+i);saved.push(car);await assertQuote(p,car,selected[i]);
 }
 if(width===1440){
  const [a,b]=saved.slice(-2);assert.equal(a.grade,b.grade);assert.equal(a.subgrade,b.subgrade);assert.notEqual(a.taxonomyCatalogRef.researchId,b.taxonomyCatalogRef.researchId);
 }
 assert.equal(await p.evaluate(()=>__researchCatalogueRPC.filter(r=>r.name==='snote_vehicle_taxonomy_upsert').length),0);
 await p.screenshot({path:'/tmp/snote-researched-catalog-'+width+'.png'});
 console.log('PASS '+width+'px actual research-ID selection → preview → server vehicle ACK → source reference/subgrade persistence → detail restore → quote text');
}

async function delayedInitialCatalogue(f){
 const p=await f.context.newPage();let release,requested=false;
 const gate=new Promise(resolve=>release=resolve);
 await p.route('**/assets/vehicle-catalog.json*',async route=>{requested=true;await gate;return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(ROOT,'assets/vehicle-catalog.json'))});});
 await p.goto(ORIGIN,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>!!window.SnoteVehicleCatalog&&!!window.__encarFixtureAuth);await p.evaluate(()=>window.__encarFixtureAuth);
 await p.evaluate(async alias=>{await enterWorkspace({username:alias,name:'지연 로딩 검증 딜러',company:'합성 상사',role:'dealer',employeeNo:'TEST',union:''});document.getElementById('zc-cloud-gate').hidden=true;openAdd();},ALIAS);
 await p.waitForTimeout(100);assert.equal(requested,true);
 const before=await p.locator('#new-make option').evaluateAll(options=>options.map(option=>option.value));
 assert(!before.includes(LEGACY.make));assert.equal(await p.evaluate(()=>window.SnoteVehicleCatalog.rows().length),0,'A delayed source must not activate a legacy fallback');
 release();await ready(p);
 await p.waitForFunction(()=>document.getElementById('new-make').options.length>10);
 assert.equal(await p.evaluate(()=>domesticTaxonomy().filter(row=>row.researchId).length),3128);
 await p.evaluate(()=>closeAdd());await p.close();
 console.log('PASS opening registration before async catalogue readiness keeps legacy data inactive and fills untouched choices after the real JSON becomes ready');
}

async function coldDetailCatalogue(f,edit='none'){
 const p=await f.context.newPage(),row=RECORDS.find(record=>record.market==='KR'&&record.subgrade);
 const reference=await f.page.evaluate(id=>window.SnoteVehicleCatalog.reference(window.SnoteVehicleCatalog.get(id)),row.id);
 const saved=oldCar({model:'저장된 연구분류 차량 제목 원문',make:row.make,group:row.group,generation:row.model,grade:row.grade,subgrade:row.subgrade,taxonomyCatalogRef:reference});
 let release,requested=false;const gate=new Promise(resolve=>release=resolve);
 await p.route('**/assets/vehicle-catalog.json*',async route=>{requested=true;await gate;return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(ROOT,'assets/vehicle-catalog.json'))});});
 await p.goto(ORIGIN,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>!!window.SnoteVehicleCatalog&&!!window.__encarFixtureAuth);await p.evaluate(()=>window.__encarFixtureAuth);
 await p.evaluate(async({alias,car,actor,company})=>{
  await enterWorkspace({username:alias,name:'지연 상세 검증 딜러',company:'합성 상사',role:'dealer',employeeNo:'TEST',union:''});
  cars=normalizedCars([SnoteMoney.storeCar(car)],alias);
  const S=__encarFixtureState;S.user={id:actor,email:'cold-detail@example.invalid'};S.company={id:company,name:'합성 상사'};S.members=[{user_id:actor,company_id:company,role:'dealer',active:true,display_name:'지연 상세 검증 딜러'}];
  S.client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-cold-detail-token',user:{id:actor}}},error:null}),getUser:async()=>({data:{user:{id:actor}},error:null})},
   from(){const chain={select(){return chain;},eq(){return chain;},in(){return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){return chain;},single(){return chain;},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};return chain;},
   async rpc(name){
    if(name==='snote_vehicle_taxonomy_list')return{data:{company_id:company,entries:[]},error:null};
    if(name==='snote_research_vehicle_catalog_list'){const catalogue=window.SnoteVehicleCatalog;return{data:{dataset_version:catalogue.version(),manifest_sha256:catalogue.manifestSha256(),entry_count:catalogue.rows().length,entries:catalogue.rows()},error:null};}
    throw Error('Unexpected cold-detail fixture RPC '+name);
   }
  };S.ready=true;document.getElementById('zc-cloud-gate').hidden=true;openVehicle(car.id);
 },{alias:ALIAS,car:saved,actor:ACTOR,company:COMPANY});
 await p.locator('#vehicle-overlay.open').waitFor();assert.equal(requested,true);
 assert.equal(await p.evaluate(()=>window.SnoteVehicleCatalog.rows().length),0);
 const initial=await p.evaluate(()=>({identity:getDetailModel(),classification:snote282DetailState(),dirty:snoteVehicleHasChanges()}));
 for(const key of IDENTITY)assert.equal(initial.identity[key],saved[key]);
 assert.deepEqual(initial.identity.taxonomyCatalogRef,reference);assert.equal(initial.dirty,false,'Opening before catalogue readiness must start from an unchanged vehicle draft');
 if(edit==='identity')await p.locator('#detail-model').fill('사용자가 직접 고친 차량명 보존');
 if(edit==='financial')await p.locator('#detail-sell').fill('3456789');
 const edited=await p.evaluate(()=>({classification:snote282DetailState(),sell:document.getElementById('detail-sell').value,dirty:snoteVehicleHasChanges()}));
 if(edit!=='none')assert.equal(edited.dirty,true);
 release();await ready(p);
 if(edit==='none'){
  await p.waitForFunction(make=>[...document.getElementById('detail-make').options].some(option=>option.value===make),row.make);
  assert.equal(await p.locator('#detail-grade').inputValue(),row.id,'Untouched cold-opened detail must restore its saved source-context option after readiness');
  assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),false,'Automatic source readiness must not create false unsaved changes');
  const identity=await p.evaluate(()=>getDetailModel());
  for(const key of IDENTITY)assert.equal(identity[key],saved[key]);assert.deepEqual(identity.taxonomyCatalogRef,reference);
 }else{
  assert.equal(await p.evaluate(()=>snote282DetailState()),edited.classification,'Source readiness must not reinitialize a user-edited detail form');
  assert.equal(await p.locator('#detail-sell').inputValue(),edited.sell);
  assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),true,'An existing user draft must stay dirty after the source finishes loading');
  if(edit==='identity')assert.equal(await p.locator('#detail-model').inputValue(),'사용자가 직접 고친 차량명 보존');
 }
 await p.evaluate(()=>closeVehicle({discard:true}));await p.close();
 console.log('PASS cold detail '+edit+': saved identity/ref and dirty state survive delayed catalogue readiness without overwriting user input');
}

async function main(){
 assert.equal(RECORDS.length,3128);assert.equal(IDS.size,3128);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)});setBrowser(browser);
 try{
  for(const width of [1440,390,320]){
   const f=await setup(width);
   try{if(width===1440){await allRowsAndLeaves(f);await legacyFinancialSave(f);}await sourceRegistrations(f,width);if(width===1440){await delayedInitialCatalogue(f);for(const edit of ['none','identity','financial'])await coldDetailCatalogue(f,edit);}await finish(f);}
   catch(error){await f.page.screenshot({path:'/tmp/snote-researched-catalog-failure-'+width+'.png'}).catch(()=>{});throw error;}
  }
  console.log('ALL RESEARCH VEHICLE CATALOGUE BROWSER CHECKS PASSED');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
