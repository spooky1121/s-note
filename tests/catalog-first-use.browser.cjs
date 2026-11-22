'use strict';
// Actual application/assets, synthetic Auth/company acknowledgements only.
// No production, OCR service, external catalogue or database connections.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,deferred,started,constants}=require('./normal-login.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_CATALOG_ARTIFACT_DIR||'/tmp/snote-catalog-first-use';fs.mkdirSync(OUT,{recursive:true});
const RAW=fs.readFileSync(path.join(ROOT,'assets/vehicle-catalog.json'),'utf8'),CATALOG=JSON.parse(RAW),HASH=crypto.createHash('sha256').update(RAW).digest('hex');
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const files=['index.html','assets/feature-loader.js','assets/vehicle-catalog.js','assets/vehicle-taxonomy-ui.js'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
async function begin(browser,label,role='dealer'){
 const state=backend(),read=state.from,rpc=state.rpc;
 state.from=async(label,input)=>{const result=await read(label,input);if(input.table==='zc_members'&&Array.isArray(result.data))result.data=result.data.map(row=>({...row,role}));return result;};
 state.rpc=async(label,input)=>{const result=rpc(label,input);if(input.name==='snote_research_vehicle_catalog_list')return{data:{dataset_version:CATALOG.catalogVersion,manifest_sha256:HASH,entry_count:CATALOG.records.length,entries:CATALOG.records},error:null};if(input.name==='snote_vehicle_taxonomy_list')return{data:{company_id:constants.COMPANY,entries:[]},error:null};if(input.name==='snote_company_purchase_rows')return{data:{companyId:constants.COMPANY,datasets:[{dataset:'cars',ownerId:constants.USER,payload:[],revision:0},{dataset:'covers',ownerId:constants.USER,payload:{},revision:0}],owners:[{id:constants.USER,name:'가상 직원',active:true,memberExists:true}]},error:null};return result;};
 const f=await boot(browser,state,label);await f.login();await f.ready();await f.page.waitForFunction(()=>!__normalState.busy);return{f,p:f.page,state};
}
const outcome=expression=>`(${expression}).then(()=>({ok:true}),e=>({ok:false,code:e.code||'IMPORT_FAILED'}))`;
(async()=>{const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  for(const role of ['dealer','admin','accountant']){
   const {f,p,state}=await begin(browser,'initial-'+role,role);try{
    assert.equal(await p.evaluate(()=>!!window.SnoteVehicleCatalog),false);assert.equal(await p.evaluate(()=>!!window.snoteVehicleTaxonomyRows),false);
    const requests=await p.evaluate(()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname));assert(!requests.some(file=>/vehicle-catalog\.(js|json)|vehicle-taxonomy-(ui|store)\.js/.test(file)));
    if(role==='accountant'){assert.equal(await p.evaluate(()=>openAdd()),false);assert.equal(await p.evaluate(()=>!!window.SnoteVehicleCatalog),false);}
    assert(!state.rpcCalls.some(row=>/vehicle_taxonomy|research_vehicle_catalog/.test(row.name)));results.push({name:role+' initial workspace defers optional catalogue and classification reads'});
   }finally{await f.finish();}
  }
  {
   const {f,p}=await begin(browser,'json-retry');let allow=false,requests=0;try{
    await p.route('**/assets/vehicle-catalog.json*',route=>{requests++;return allow?route.fulfill({contentType:'application/json',body:RAW}):route.fulfill({status:503,contentType:'application/json',body:'{}'});});
    assert.equal((await p.evaluate(outcome('snote2184EnsureCatalog()'))).ok,false);const failed=await p.evaluate(()=>({rows:SnoteVehicleCatalog.rows().length,version:SnoteVehicleCatalog.version()}));assert.deepEqual(failed,{rows:0,version:null});
    const failedRequests=requests;allow=true;const value=await p.evaluate(async()=>{const a=snote2184EnsureCatalog(),b=snote2184EnsureCatalog();const same=a===b;await Promise.all([a,b]);return{same,rows:SnoteVehicleCatalog.rows().length};});assert.deepEqual(value,{same:true,rows:3128});assert.equal(requests,failedRequests+1);
    await p.evaluate(()=>snote2184EnsureCatalog());assert.equal(requests,failedRequests+1);results.push({name:'failed JSON stays empty; next first use retries once and concurrent/successful consumers share it',failedRequests,retryRequests:1});
   }finally{await f.finish();}
  }
  for(const file of ['vehicle-catalog.js','vehicle-taxonomy-ui.js','vehicle-taxonomy-store.js']){
   const {f,p,state}=await begin(browser,'module-retry-'+file),requests=[];try{
    await p.route('**/assets/'+file+'*',route=>{const url=new URL(route.request().url());if(url.pathname!=='/assets/'+file)return route.fallback();requests.push(url.search);return requests.length===1?route.fulfill({status:503,contentType:'application/javascript',body:''}):route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(ROOT,'assets',file))});});
    assert.equal((await p.evaluate(outcome('snote220RefreshTaxonomy()'))).ok,false);await p.evaluate(()=>snote220RefreshTaxonomy());
    assert.equal(await p.evaluate(()=>SnoteVehicleCatalog.rows().length),3128);assert.deepEqual(await p.evaluate(()=>snoteVehicleTaxonomyRows()),[]);assert.equal(requests.length,2);assert.equal(new URLSearchParams(requests[1]).get('snote_retry'),'1');
    assert(!state.rpcCalls.some(row=>/upsert|zc_write_dataset/.test(row.name)));results.push({name:'actual workspace first-use '+file+' failure retries without a reload or classification write',requests});
   }finally{await f.finish();}
  }
  for(const stop of ['close','route','reload','company','logout']){
   const {f,p}=await begin(browser,'late-'+stop),hold={started:deferred(),release:deferred()};try{
    await p.route('**/assets/vehicle-catalog.json*',async route=>{hold.started.resolve();await hold.release.promise;return route.fulfill({contentType:'application/json',body:RAW});});
    await p.evaluate(()=>{navigate('buy');window.__coldRegistration=openAdd();});await started(hold.started,'catalogue JSON');assert.equal(await p.locator('#overlay').evaluate(el=>el.classList.contains('open')),false);
    if(stop==='close')await p.evaluate(()=>closeAdd());
    if(stop==='route')await p.evaluate(()=>navigate('settings'));
    if(stop==='reload'){
     await p.evaluate(()=>{window.__beforeReloadActor=currentUser;window.__beforeReloadKey=snoteVehicleTaxonomyBridge.context().key;window.__reloadCatalogue=zc86Cloud.reload();});
     const box=p.locator('#snote-message-dialog[open][data-message-kind="confirm"]');await box.waitFor({state:'visible'});await box.locator('[data-message-accept]').click();await p.evaluate(()=>__reloadCatalogue);
     assert.equal(await p.evaluate(()=>currentUser===__beforeReloadActor),true);assert.equal(await p.evaluate(()=>snoteVehicleTaxonomyBridge.context().key===__beforeReloadKey),false);
    }
    if(stop==='company')await p.evaluate(other=>{const s=__normalState;s.company={id:other,name:'다른 가상 상사'};s.members=s.members.map(row=>({...row,company_id:other}));},OTHER);
    if(stop==='logout'){
     await p.evaluate(()=>{window.__catalogueLogout=zc86Cloud.signOut();});const box=p.locator('#snote-message-dialog[open][data-message-kind="confirm"]');await box.waitFor({state:'visible'});await box.locator('[data-message-accept]').click();await p.evaluate(()=>__catalogueLogout);
    }
    hold.release.resolve();assert.equal(await p.evaluate(()=>__coldRegistration),false);assert.equal(await p.locator('#overlay').evaluate(el=>el.classList.contains('open')),false);
    assert.equal(await p.evaluate(()=>SnoteVehicleCatalog.rows().some(row=>row.company_id)),false);results.push({name:'late catalogue cannot reopen registration or publish private rows after '+stop});
   }finally{hold.release.resolve();await f.finish();}
  }
  assert.deepEqual(hashes(),before);fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,syntheticOnly:true,productionRequests:0,sourceHashes:before,results},null,2)+'\n');for(const result of results)console.log('PASS '+result.name);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
