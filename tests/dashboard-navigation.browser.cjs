'use strict';
// Actual application routing and browser history; authentication/data are
// synthetic and every outgoing request is intercepted by the shared fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_NAVIGATION_ARTIFACT_DIR||'/tmp/snote-dashboard-navigation';
fs.mkdirSync(OUT,{recursive:true});
const hashes=()=>Object.fromEntries(['index.html','assets/home-dashboard.js','assets/finance-lock-settings.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')]));
const clean=p=>assert.equal(new URL(p.url()).pathname+new URL(p.url()).search+new URL(p.url()).hash,'/');
async function landing(p){
 await p.evaluate(()=>{
  closeVehicle({discard:true});
  snoteResetWorkspaceNavigation();snoteWorkspaceSalesReady=true;
  history.replaceState({snoteNavigation:{view:'workspace',page:'sell',session:'old-session',position:0}},'','/?release=old#page=sell');
  snotePendingPage='finance';snoteEnterWorkspaceRoute();
 });
 await p.waitForFunction(()=>route==='dashboard'&&document.getElementById('zc-dashboard-gate').hidden);
 clean(p);
 const snapshot=await p.evaluate(()=>({route,history:history.state.snoteNavigation,locked:snoteHomeDashboardBridge.snapshot()?.locked,rows:snoteHomeDashboardBridge.snapshot()?.rows}));
 assert.equal(snapshot.route,'dashboard');assert.equal(snapshot.history.page,'dashboard');assert.equal(snapshot.locked,true);assert.deepEqual(snapshot.rows,[]);
 await p.locator('#snote-dashboard-home[data-state="locked"]').waitFor();
}
(async()=>{
 const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of [1440,390,320]){
   const f=await fixture(width),p=f.page;
   try{
    await landing(p);
    await p.evaluate(()=>navigate('buy'));await p.waitForFunction(()=>route==='buy');clean(p);
    await p.evaluate(()=>navigate('sell'));await p.waitForFunction(()=>route==='sell');clean(p);
    await p.goBack();await p.waitForFunction(()=>route==='buy');clean(p);
    await p.goBack();await p.waitForFunction(()=>route==='dashboard');clean(p);
    assert.equal(await p.locator('#zc-dashboard-gate').isHidden(),true);assert.equal(await p.evaluate(()=>snoteHomeDashboardBridge.snapshot().locked),true);
    await p.goForward();await p.waitForFunction(()=>route==='buy');clean(p);
    await p.evaluate(()=>navigate('finance'));await p.locator('#zc-dashboard-gate').waitFor({state:'visible'});assert.equal(await p.evaluate(()=>route),'buy');clean(p);
    await p.evaluate(()=>closeDashboardGate());
    await p.evaluate(()=>{history.replaceState({...history.state,snoteNavigation:{view:'workspace',page:'finance',session:'different-session',position:snoteHistoryPosition}},'','/');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));});
    assert.equal(await p.evaluate(()=>route),'buy');assert.equal(await p.locator('#zc-dashboard-gate').isHidden(),true);
    await p.evaluate(()=>{location.hash='page=sell';});await p.waitForFunction(()=>route==='sell'&&location.hash==='');clean(p);
    await p.evaluate(()=>{snoteWorkspaceActive=false;history.replaceState({...history.state,snoteNavigation:{view:'workspace',page:'sell',session:snoteNavigationSession,position:snoteHistoryPosition}},'','/');snoteEnterWorkspaceRoute();});
    await p.waitForFunction(()=>route==='dashboard');clean(p);assert.equal(await p.locator('#zc-dashboard-gate').isHidden(),true);
    await p.screenshot({path:path.join(OUT,'dashboard-landing-'+width+'.png')});
    results.push({width,dashboardLanding:true,oldRouteIgnored:true,cleanUrl:true,backForward:true,financePermissionGate:true,crossSessionHistoryIgnored:true,lockedRowsExcluded:true});
    await finish(f);console.log('PASS '+width+'px dashboard landing, private locked shell, clean URL and permission-checked browser history');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await p.evaluate(()=>{closeVehicle({discard:true});window.__navActor=currentUser;currentUser=null;__encarFixtureState.ready=false;snoteResetWorkspaceNavigation();document.getElementById('zc-cloud-gate').hidden=false;history.replaceState({},'','/?code=synthetic-callback#invite=abcdefghijklmnop');dispatchEvent(new PopStateEvent('popstate',{state:history.state}));});
    await p.waitForFunction(()=>document.getElementById('zc-cloud-gate').dataset.authMode==='staff');
    assert.equal(await p.locator('#snote-staff-code').inputValue(),'abcdefghijklmnop');assert.equal(new URL(p.url()).search,'?code=synthetic-callback');assert.equal(new URL(p.url()).hash,'#invite=abcdefghijklmnop');
    await p.locator('#snote-auth-back').click();await p.waitForFunction(()=>document.getElementById('zc-cloud-gate').dataset.authMode==='login');
    await p.locator('#zc86-register').click();await p.waitForFunction(()=>document.getElementById('zc-cloud-gate').dataset.authMode==='admin');
    await p.goBack();await p.waitForFunction(()=>document.getElementById('zc-cloud-gate').dataset.authMode==='login');
    await p.goBack();await p.waitForFunction(()=>document.getElementById('zc-cloud-gate').dataset.authMode==='staff');assert.equal(await p.locator('#snote-staff-code').inputValue(),'abcdefghijklmnop');
    await p.evaluate(()=>{currentUser=__navActor;__encarFixtureState.ready=true;document.getElementById('zc-cloud-gate').hidden=true;snoteWorkspaceSalesReady=true;snoteEnterWorkspaceRoute();});await p.waitForFunction(()=>route==='dashboard');clean(p);
    results.push({authHistoryUsesState:true,inviteAndCallbackPreservedBeforeLogin:true,authParametersClearedAfterLogin:true});await finish(f);console.log('PASS auth back/forward and invitation/callback preservation until verified workspace entry');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await fixture(390),p=f.page;
   try{
    await p.evaluate(()=>{closeVehicle({discard:true});currentUser.role='accountant';__encarFixtureState.members[0].role='accountant';snoteResetWorkspaceNavigation();snoteWorkspaceSalesReady=true;snoteEnterWorkspaceRoute();});
    assert.equal(await p.evaluate(()=>route),'buy');assert.equal(await p.evaluate(()=>snotePageAllowed('dashboard')),false);clean(p);
    results.push({accountantPermissionsPreserved:true,accountantLanding:'buy'});await finish(f);console.log('PASS accountant keeps its authorized landing and cannot enter the dealer financial dashboard');
   }catch(error){await f.context.close();throw error;}
  }
  assert.deepEqual(hashes(),before,'Product source changed during navigation verification');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:before,results,syntheticOnly:true},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
