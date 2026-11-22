'use strict';
// Actual login, locks and display module; only Auth/DB responses are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,deferred,started}=require('./normal-login.browser.cjs');
const OUT=process.env.SNOTE_OPTIONAL_DISPLAY_ARTIFACT_DIR||'/tmp/snote-optional-display';fs.mkdirSync(OUT,{recursive:true});
async function setup(browser,width,role='dealer'){
 const state=backend(),from=state.from;
 state.from=(label,args)=>{const value=from(label,args);if(args.table==='zc_members'&&value.data){const rows=Array.isArray(value.data)?value.data:[value.data];for(const row of rows)row.role=role;}return value;};
 const f=await boot(browser,state,'optional-'+role+'-'+width,{width}),p=f.page;
 await p.evaluate(()=>{
  const original=snoteDashboardDisplayBridge;
  window.__displayStarted=false;window.__displayFail=false;
  window.__displayWait=new Promise(resolve=>window.__displayRelease=resolve);
  window.snoteDashboardDisplayBridge={...original,async load(context){const value=await original.load(context);window.__displayStarted=true;window.__displayStartedReady=__normalState.ready;await __displayWait;if(__displayFail)throw Error('Synthetic display failure');return value;}};
 });
 return {f,p,state};
}
async function readyWithPending(f,p){
 await f.ready();await p.waitForFunction(()=>!__normalState.busy&&__displayStarted);
 await p.locator('#snote-dashboard-home [data-kpi="profit"]').waitFor({state:'visible'});
 assert.equal(await p.evaluate(()=>__displayStartedReady),true,'Optional metadata begins after mandatory login readiness');
 assert.equal(await p.evaluate(()=>SnoteIdleSession.inspect().armed),true);
 assert.equal(await p.evaluate(()=>SnoteDashboardDisplay.hidden()),true);
 for(const kind of ['profit','year']){
  assert.equal(await p.locator('#snote-dashboard-home [data-kpi="'+kind+'"]').getAttribute('data-margin-hidden'),'true');
  assert.equal(await p.locator('#snote-dashboard-home [data-kpi="'+kind+'"] .snote-home-number').textContent(),'-');
 }
 const frames=await p.evaluate(async()=>{const values=[];for(let i=0;i<5;i++){await new Promise(requestAnimationFrame);values.push({hidden:SnoteDashboardDisplay.hidden(),mask:[...document.querySelectorAll('#snote-dashboard-home [data-kpi="profit"],#snote-dashboard-home [data-kpi="year"]')].every(e=>e.dataset.marginHidden==='true')});}return values;});
 assert(frames.every(row=>row.hidden&&row.mask),'Pending preference must never expose amounts for a frame');
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];try{
 for(const width of [1440,390]){
  for(const role of ['dealer','admin']){
   const {f,p,state}=await setup(browser,width,role);
   try{await f.login();await readyWithPending(f,p);assert(state.rpcCalls.some(call=>call.name==='snote_finance_lock_get'));
    await p.evaluate(()=>__displayRelease());await p.waitForFunction(()=>SnoteDashboardDisplay.hidden()===false);
    await p.waitForFunction(()=>document.querySelector('#snote-dashboard-home [data-kpi="profit"]')?.dataset.marginHidden==='false');
    results.push({width,role,case:'optional pending login remains usable and masked until verified'});await f.finish();
   }catch(error){await f.context.close();throw error;}
  }
  {
   const {f,p}=await setup(browser,width);
   try{await f.login();await readyWithPending(f,p);await p.evaluate(()=>{__displayFail=true;__displayRelease();});
    await p.waitForFunction(()=>SnoteDashboardDisplay.markup().includes('load-error'));assert.equal(await p.evaluate(()=>__normalState.ready&&!__normalState.busy&&SnoteDashboardDisplay.hidden()),true);
    results.push({width,case:'display failure preserves access and hidden amounts'});await f.finish();
   }catch(error){await f.context.close();throw error;}
  }
  {
   const {f,p}=await setup(browser,width);
   try{await f.login();await readyWithPending(f,p);await p.evaluate(()=>{currentUser={...currentUser,username:'synthetic-other-account'};SnoteDashboardDisplay.reset();__displayRelease();});
    await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await p.evaluate(()=>SnoteDashboardDisplay.hidden()),true);assert.equal(await p.evaluate(()=>SnoteDashboardDisplay.markup()),'');
    results.push({width,case:'late display acknowledgement cannot apply after account replacement'});await f.finish();
   }catch(error){await f.context.close();throw error;}
  }
  {
   const {f,p,state}=await setup(browser,width),hold={started:deferred(),release:deferred()},rpc=state.rpc;
   state.rpc=async(label,args)=>{if(args.name==='snote_finance_lock_get'){hold.started.resolve();await hold.release.promise;}return rpc(label,args);};
   try{await f.login();await started(hold.started,'mandatory finance lock');
    assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(await p.evaluate(()=>__displayStarted),false);
    assert.equal(await p.evaluate(()=>SnoteDashboardDisplay.markup().includes('data-state="loading"')),true,'Settings markup exists before the optional read starts');
    assert.equal(await p.locator('#zc-cloud-gate').isHidden(),false);
    hold.release.resolve();await readyWithPending(f,p);await p.evaluate(()=>__displayRelease());
    results.push({width,case:'mandatory finance policy still blocks entry before confirmation'});await f.finish();
   }catch(error){hold.release.resolve();await f.context.close();throw error;}
  }
 }
 fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({passed:true,syntheticOnly:true,operatingChanges:0,results},null,2)+'\n');
 for(const row of results)console.log('PASS '+row.width+' '+(row.role||'dealer')+' '+row.case);
}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
