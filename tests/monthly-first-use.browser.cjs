'use strict';
// Real login/parent/monthly HTML and modules. Every account and network reply is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,deferred,started,constants}=require('./normal-login.browser.cjs');
const {USER,COMPANY}=constants,ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_MONTHLY_FIRST_USE_ARTIFACT_DIR||'/tmp/snote-monthly-first-use';fs.mkdirSync(OUT,{recursive:true});
let scenario=0;const only=Number(process.env.SNOTE_MONTHLY_CASE)||0,selected=()=>{scenario++;return!only||scenario===only;};
const sourceHash=()=>crypto.createHash('sha256').update(fs.readFileSync(ROOT+'/index.html')).digest('hex');
const monthPath=value=>value==='/monthly.html'||/\/monthly-workbook(?:-model|-cloud|-print)?\.js$/.test(value);
const clone=value=>JSON.parse(JSON.stringify(value));
function monthlyBackend(role){
 const state=backend(),from=state.from,rpc=state.rpc;state.monthlyReads=0;state.monthlyWrites=0;state.monthly={payload:[],revision:0};state.holdRead=null;state.failRead=false;
 state.from=async(label,input)=>{
  let result=from(label,input);
  if(input.table==='zc_members'&&result.data){const patch=row=>({...row,role});result={...result,data:Array.isArray(result.data)?result.data.map(patch):patch(result.data)};}
  if(input.table==='zc_companies'&&result.data){const patch=row=>({...row,business_number:'1234567890',corporate_number:'1234567890123',business_address:'가상 주소',representative_name:'가상 대표'});result={...result,data:Array.isArray(result.data)?result.data.map(patch):patch(result.data)};}
  if(input.table==='zc_datasets'&&input.filters?.dataset==='monthly'){
   state.monthlyReads++;assert.equal(input.filters.company_id,COMPANY);assert.equal(input.filters.owner_id,'00000000-0000-0000-0000-000000000000');assert(['admin','accountant'].includes(role));
   const response={data:{...clone(state.monthly),dataset:'monthly',owner_id:input.filters.owner_id,company_id:COMPANY},error:null},hold=state.holdRead;state.holdRead=null;
   if(hold){hold.started.resolve();await hold.release.promise;}
   if(state.failRead){state.failRead=false;return{data:null,error:{code:'NETWORK'}};}return response;
  }
  return result;
 };
 state.rpc=async(label,input)=>{if(input.name!=='zc_write_dataset')return rpc(label,input);assert(state.valid(input.token));assert(['admin','accountant'].includes(role));assert.equal(input.args.p_company,COMPANY);assert.equal(input.args.p_dataset,'monthly');assert.equal(input.args.p_owner,'00000000-0000-0000-0000-000000000000');if(input.args.p_expected!==state.monthly.revision)return{data:null,error:{code:'40001',message:'CONFLICT'}};state.monthly={payload:clone(input.args.p_payload),revision:state.monthly.revision+1};state.monthlyWrites++;return{data:state.monthly.revision,error:null};};
 return state;
}
async function begin(browser,role='accountant',width=1440){const state=monthlyBackend(role),f=await boot(browser,state,'monthly-'+role+'-'+width,{width}),paths=await f.page.evaluate(()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname));f.page.on('request',req=>paths.push(new URL(req.url()).pathname));await f.login();await f.ready();await f.page.waitForFunction(()=>!__normalState.busy);return{state,f,p:f.page,paths,frame:f.page.frameLocator('#monthly-ledger-frame')};}
async function open(app){await app.p.evaluate(()=>{navigate('monthly');window.__monthlyOpen=window.snoteMonthlyWorkbookRefresh();});await app.frame.locator('#month-input:not([disabled])').waitFor();await app.p.evaluate(()=>__monthlyOpen);}
async function saved(app){await app.frame.locator('#save-status[data-state="saved"]').waitFor();}
async function goAway(app){await app.p.evaluate(()=>navigate('buy'));}
async function relogin(app){const popup=app.p.locator('#snote-message-dialog[open]');if(await popup.isVisible())await popup.locator('[data-message-accept]').click();await app.f.login();await app.f.ready();await app.p.waitForFunction(()=>!__normalState.busy);}
async function retry(app){const popup=app.p.locator('#snote-message-dialog[open]');if(await popup.isVisible())await popup.locator('[data-message-accept]').click();await app.p.locator('#monthly-frame-retry').click();}
async function logout(app){await app.p.evaluate(()=>{window.__monthlyLogout=zc86Cloud.signOut();});const popup=app.p.locator('#snote-message-dialog[open][data-message-kind="confirm"]');await popup.waitFor();await popup.locator('[data-message-accept]').click();await app.p.evaluate(()=>__monthlyLogout);}
(async()=>{
 const before=sourceHash(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  if(selected())for(const width of[1440,390])for(const role of['dealer','accountant','admin']){
   const app=await begin(browser,role,width),{p,f,state,paths,frame}=app;
   try{
    assert.equal(await p.locator('#monthly-ledger-frame').getAttribute('src'),null);assert.equal(paths.filter(monthPath).length,0);assert.equal(state.monthlyReads,0);assert.equal(state.monthlyWrites,0);
    if(role==='dealer'){await p.evaluate(()=>{navigate('monthly');window.snoteMonthlyWorkbookRefresh();});assert.notEqual(await p.evaluate(()=>route),'monthly');assert.equal(await p.locator('#monthly-ledger-frame').getAttribute('src'),null);assert.equal(paths.filter(monthPath).length,0);assert.equal(state.monthlyReads,0);}
    else{
     await p.evaluate(()=>{navigate('monthly');window.__monthlyConcurrent=Promise.all([snoteMonthlyWorkbookRefresh(),snoteMonthlyWorkbookRefresh(),snoteMonthlyWorkbookRefresh()]);});await frame.locator('#month-input:not([disabled])').waitFor();await p.evaluate(()=>__monthlyConcurrent);
     assert.equal(paths.filter(x=>x==='/monthly.html').length,1);assert.equal(paths.filter(x=>x==='/assets/monthly-workbook-cloud.js').length,1);assert.equal(state.monthlyReads,1);assert.equal(state.monthlyWrites,0);
     await frame.locator('#dealer-body tr:first-child [data-field="name"]').fill('가상 담당자');await frame.locator('#dealer-body tr:first-child [data-field="buyFee"]').fill('1200');await saved(app);assert.equal(state.monthlyWrites,1);
     const readsBeforeReentry=state.monthlyReads;await p.evaluate(()=>{window.__monthlySameFrame=document.getElementById('monthly-ledger-frame');});await goAway(app);await open(app);assert.equal(await p.evaluate(()=>__monthlySameFrame===document.getElementById('monthly-ledger-frame')),true);assert.equal(state.monthlyReads,readsBeforeReentry,'Menu reentry performs no extra workbook read');assert.equal(await frame.locator('#dealer-body tr:first-child [data-field="name"]').inputValue(),'가상 담당자');
     await frame.locator('#print-button').evaluate(el=>{window.print=()=>window.__monthlyPrints=(window.__monthlyPrints||0)+1;});await frame.locator('#print-button').click();await frame.locator('#print-snapshot').waitFor({state:'attached'});await p.waitForFunction(()=>document.getElementById('monthly-ledger-frame').contentWindow.__monthlyPrints===1);assert.match(await frame.locator('#print-snapshot').textContent(),/가상 담당자/);
     if(width===390){await frame.locator('#new-template').click();await frame.locator('#template-dialog[open]').waitFor();await p.waitForFunction(()=>!!history.state?.snotePopup||Object.keys(history.state||{}).some(key=>/popup/i.test(key)));await p.goBack();await frame.locator('#template-dialog').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>route),'monthly');await p.screenshot({path:path.join(OUT,'monthly-mobile-'+role+'.png')});}
    }
    results.push({name:'real auth '+role+' '+width+' initial zero monthly loads; authorized first use/save/print/reopen',initialMonthlyRequests:0,initialMonthlyReads:0,authorized:role!=='dealer'});console.log('PASS '+results.at(-1).name);
   }finally{await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app,hold={started:deferred(),release:deferred()};
   await p.route('**/monthly.html?*',async route=>{hold.started.resolve();await hold.release.promise;await route.fallback();});
   try{
    await p.evaluate(()=>{navigate('monthly');window.__monthlyPending=snoteMonthlyWorkbookRefresh();});await started(hold.started,'monthly document');await goAway(app);hold.release.resolve();await p.evaluate(()=>__monthlyPending);assert.equal(state.monthlyReads,0,'A hidden unfinished first entry cannot read the workbook');await open(app);assert.equal(state.monthlyReads,1);results.push({name:'pending first HTML shares work and route-away suppresses hidden initialization'});console.log('PASS '+results.at(-1).name);
   }finally{hold.release.resolve();await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app;let fail=true;
   await p.route('**/monthly.html?*',route=>fail?(fail=false,route.fulfill({status:503,contentType:'text/html',body:'<!doctype html><p>Synthetic unavailable</p>'})):route.fallback());
   try{await p.evaluate(()=>{navigate('monthly');window.__failedMonthly=snoteMonthlyWorkbookRefresh();});await p.locator('#monthly-frame-retry:not([hidden])').waitFor();assert.equal(await p.evaluate(()=>__failedMonthly),false);assert.equal(state.monthlyReads,0);await retry(app);await app.frame.locator('#month-input:not([disabled])').waitFor();assert.equal(state.monthlyReads,1);results.push({name:'503 document has explicit retry and a fresh ready handshake'});console.log('PASS '+results.at(-1).name);}finally{await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app;let fail=true;
   await p.route('**/assets/monthly-workbook-cloud.js?*',route=>fail?(fail=false,route.fulfill({status:503,contentType:'application/javascript',body:'Synthetic module unavailable'})):route.fallback());
   try{await p.evaluate(()=>{navigate('monthly');window.__failedMonthly=snoteMonthlyWorkbookRefresh();});await p.locator('#monthly-frame-retry:not([hidden])').waitFor();assert.equal(await p.evaluate(()=>__failedMonthly),false);assert.equal(state.monthlyReads,0);await retry(app);await app.frame.locator('#month-input:not([disabled])').waitFor();assert.equal(state.monthlyReads,1);results.push({name:'failed cloud module retries with a fresh import instead of cached rejection'});console.log('PASS '+results.at(-1).name);}finally{await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app;let fail=true;
   await p.route('**/assets/monthly-workbook-model.js?*',route=>fail&&route.request().frame()===p.mainFrame()?(fail=false,route.fulfill({status:503,contentType:'application/javascript',body:'Synthetic dependency unavailable'})):route.fallback());
   try{await p.evaluate(()=>{navigate('monthly');window.__failedMonthly=snoteMonthlyWorkbookRefresh();});await p.locator('#monthly-frame-retry:not([hidden])').waitFor();assert.equal(await p.evaluate(()=>__failedMonthly),false);assert.equal(state.monthlyReads,0);await retry(app);await app.frame.locator('#month-input:not([disabled])').waitFor();assert.equal(state.monthlyReads,1);results.push({name:'failed parent model dependency also recovers on explicit retry'});console.log('PASS '+results.at(-1).name);}finally{await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app;state.failRead=true;
   try{await p.evaluate(()=>{navigate('monthly');window.__failedMonthly=snoteMonthlyWorkbookRefresh();});await p.locator('#monthly-frame-retry:not([hidden])').waitFor();assert.equal(await p.evaluate(()=>__failedMonthly),false);assert.equal(state.monthlyReads,1);await p.waitForTimeout(1100);assert.equal(state.monthlyReads,1,'Child READY retries cannot cause automatic failed reads');await goAway(app);await open(app);assert.equal(state.monthlyReads,2);results.push({name:'failed data read preserves retry and reopen without automatic request loops'});console.log('PASS '+results.at(-1).name);}finally{await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app,hold={started:deferred(),release:deferred()};state.holdRead=hold;
   try{await p.evaluate(()=>{navigate('monthly');window.__heldMonthly=snoteMonthlyWorkbookRefresh();});await started(hold.started,'monthly route-held read');await goAway(app);hold.release.resolve();assert.equal(await p.evaluate(()=>__heldMonthly),false);assert.equal(await app.frame.locator('#book-fields').evaluate(el=>el.disabled),true);await open(app);assert.equal(state.monthlyReads,2);results.push({name:'route change during first read never initializes a hidden workbook'});console.log('PASS '+results.at(-1).name);}finally{hold.release.resolve();await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app,hold={started:deferred(),release:deferred()};state.holdRead=hold;
   try{await p.evaluate(()=>{navigate('monthly');window.__heldMonthly=snoteMonthlyWorkbookRefresh();});await started(hold.started,'pinned monthly read');await p.evaluate(()=>{window.__oldMonthlyWindow=document.getElementById('monthly-ledger-frame').contentWindow;currentUser={...currentUser};});hold.release.resolve();assert.equal(await p.evaluate(()=>__heldMonthly),false);assert.equal(await p.locator('#monthly-ledger-frame').getAttribute('src'),null);assert.equal(await p.evaluate(()=>__oldMonthlyWindow===document.getElementById('monthly-ledger-frame').contentWindow),false);await open(app);assert.equal(state.monthlyReads,2);results.push({name:'late initial data is fenced by actor identity and old browsing context is retired'});console.log('PASS '+results.at(-1).name);}finally{hold.release.resolve();await f.finish();}
  }
  if(selected()){
   const app=await begin(browser),{p,f,state}=app,hold={started:deferred(),release:deferred()};
   await p.route('**/assets/monthly-workbook-cloud.js?*',async route=>{hold.started.resolve();await hold.release.promise;await route.fallback();});
   try{await p.evaluate(()=>{navigate('monthly');window.__monthlyBeforeLogout=snoteMonthlyWorkbookRefresh();});await started(hold.started,'monthly import before logout');await logout(app);hold.release.resolve();assert.equal(await p.evaluate(()=>__monthlyBeforeLogout),false);assert.equal(state.monthlyReads,0);assert.equal(await p.locator('#monthly-ledger-frame').getAttribute('src'),null);await relogin(app);assert.equal(state.monthlyReads,0);await open(app);assert.equal(state.monthlyReads,1);results.push({name:'logout during pending module suppresses the old actor read and a new login may reopen'});console.log('PASS '+results.at(-1).name);}finally{hold.release.resolve();await f.finish();}
  }
  if(selected()){
   const app=await begin(browser,'admin',390),{p,f,state}=app;
   try{await open(app);await app.frame.locator('#dealer-body tr:first-child [data-field="name"]').fill('이전 가상 담당자');await saved(app);await p.evaluate(()=>{window.__oldMonthlyWindow=document.getElementById('monthly-ledger-frame').contentWindow;window.__monthlyLogout=zc86Cloud.signOut();});const popup=p.locator('#snote-message-dialog[open][data-message-kind="confirm"]');await popup.waitFor();await popup.locator('[data-message-accept]').click();await p.evaluate(()=>__monthlyLogout);assert.equal(await p.locator('#monthly-ledger-frame').getAttribute('src'),null);assert.equal(await p.evaluate(()=>__oldMonthlyWindow===document.getElementById('monthly-ledger-frame').contentWindow),false);const reads=state.monthlyReads;await relogin(app);assert.equal(state.monthlyReads,reads);assert.equal(await p.locator('#monthly-ledger-frame').getAttribute('src'),null);await open(app);assert.equal(state.monthlyReads,reads+1);assert.equal(await app.frame.locator('#dealer-body tr:first-child [data-field="name"]').inputValue(),'이전 가상 담당자');results.push({name:'actual confirmed logout clears child; relogin defers monthly until explicit reentry'});console.log('PASS '+results.at(-1).name);}finally{await f.finish();}
  }
  assert.equal(sourceHash(),before);fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({sourceSha256:before,results,syntheticOnly:true,operatingDataChanged:false},null,2));console.log('PASS source hash unchanged; '+results.length+' scenarios');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
