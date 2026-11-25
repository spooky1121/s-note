'use strict';
// Actual authentication/controller with synthetic accounts and read-only fixture
// responses. The held optional stylesheet is not released until login succeeds.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,constants}=require('./normal-login.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_AVAILABILITY_DIR||'/workspace/work/login-availability-v2229';fs.mkdirSync(OUT,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms)),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const sourceHash=()=>Object.fromEntries(['index.html','assets/startup-presentation.js','assets/startup-presentation.css'].map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,n))).digest('hex')]));
const results=[];
async function fixture(browser,width,mode,{inactive=false}={}){
 const context=await browser.newContext({viewport:{width,height:950}}),made=deferred(),started=deferred(),released=deferred(),state=backend(),requests=[];let holding=true;
 if(inactive){const original=state.from;state.from=(label,input)=>{const row=original(label,input);return input.table==='zc_members'&&input.filters?.user_id===constants.USER&&row.data?{data:{...row.data,active:false},error:null}:row;};}
 const original=context.newPage.bind(context);context.newPage=async()=>{const page=await original(),route=page.route.bind(page);page.route=(pattern,handler,...rest)=>route(pattern,async r=>{
  const u=new URL(r.request().url());
  if(mode==='fonts-fail'&&u.pathname.endsWith('.woff2')){requests.push(u.pathname);return r.fulfill({status:404,body:'Synthetic font failure'});}
  if(mode==='image-fail'&&/\/snote-(?:brand|symbol)\.png$/.test(u.pathname)){requests.push(u.pathname);return r.fulfill({status:404,body:'Synthetic image failure'});}
  const match=mode==='head-css'?u.pathname==='/assets/service-brand.css':mode==='tail-css'?u.pathname==='/assets/workspace-density.css':false;
  if(match&&holding){requests.push(u.pathname);started.resolve();await released.promise;}
  return handler(r);
 },...rest);made.resolve(page);return page;};
 const pending=boot(browser,state,'availability-'+mode+'-'+width,{context,width});pending.catch(()=>{});const page=await made.promise;
 return{page,state,pending,requests,started:started.promise,release(){holding=false;released.resolve();},async finish(){this.release();const f=await pending;await f.finish();await context.close();}};
}
async function usable(page){await page.waitForFunction(()=>{const s=getComputedStyle(document.body);return window.SnoteStartupPresentation?.state.released&&s.visibility==='visible'&&Number(s.opacity)>.999&&s.pointerEvents!=='none';},{},{timeout:12000});}
async function signIn(page,password=constants.PASSWORD){await page.locator('#zc-cloud-email').fill('dealer@example.invalid');await page.locator('#zc-cloud-password').fill(password);const invalid=await page.evaluate(()=>{const f=document.getElementById('zc-cloud-email').form;return [...f.elements].filter(e=>e.willValidate&&!e.validity.valid).map(e=>({id:e.id,type:e.type,length:e.value?.length,form:e.form?.id,required:e.required,missing:e.validity.valueMissing,hidden:!!e.closest('[hidden]')}));});if(invalid.length)throw Error('FORM_INVALID '+JSON.stringify(invalid));await page.locator('#zc-cloud-submit').click();}
async function verified(page){await page.waitForFunction(()=>window.__normalState?.ready&&!__normalState.busy&&currentUser&&document.getElementById('zc-cloud-gate').hidden);}
async function tail(browser,width){const f=await fixture(browser,width,'tail-css'),p=f.page;try{
 await f.started;await usable(p);
 const before=await p.evaluate(()=>({state:document.readyState,presentation:SnoteStartupPresentation.state,pending:[...document.querySelectorAll('link[rel="stylesheet"]')].filter(l=>!l.sheet).map(l=>l.getAttribute('href')),gate:document.getElementById('zc-cloud-gate').hidden,button:document.getElementById('zc-cloud-submit').disabled}));
 assert(before.pending.some(u=>u.startsWith('assets/workspace-density.css')),'The optional CSS is still genuinely pending');assert.equal(before.gate,false);assert.equal(before.button,false);assert.equal(before.presentation.deadline,true);
 await signIn(p);await verified(p);assert.equal(f.state.passwordCalls.length,1);assert.equal(f.state.logouts.length,0);
 // Existing inline navigation/list remains usable while the optional style and
 // deferred decorative modules are pending; no private record is fabricated.
 await p.evaluate(()=>navigate('buy'));await p.waitForFunction(()=>route==='buy');assert.equal(await p.locator('#list-screen').isVisible(),true);
 await p.screenshot({path:path.join(OUT,'pending-css-authenticated-'+width+'.png')});
 const maskEvents=await p.evaluate(()=>{window.__availabilityMask=[];window.__availabilityMaskObserver=new MutationObserver(()=>__availabilityMask.push(document.documentElement.getAttribute('data-snote-startup')));__availabilityMaskObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-snote-startup']});return true;});assert(maskEvents);
 f.release();const ready=await f.pending;await delay(180);await usable(p);assert.equal(await p.evaluate(()=>__availabilityMask.some(s=>s==='pending')),false,'A late stylesheet cannot restore the screen mask');
 await p.evaluate(()=>{window.__availabilityLogout=zc86Cloud.signOut();});await p.locator('#snote-message-dialog[open][data-message-kind="confirm"] [data-message-accept]').click();await p.evaluate(()=>__availabilityLogout);await p.waitForFunction(()=>!__normalState.ready&&currentUser===null);
 assert.equal(await p.locator('#zc-cloud-gate').isVisible(),true);
 // Logout finishes with the real success notification. Until the user accepts
 // it, the native dialog correctly keeps the login form behind it inactive.
 const notice=p.locator('#snote-message-dialog[open][data-message-kind="notify"]');await notice.waitFor({state:'visible'});assert.match(await notice.innerText(),/로그아웃되었습니다/);await notice.locator('[data-message-accept]').click();await notice.waitFor({state:'hidden'});
 await signIn(p);await verified(p);assert.equal(f.state.passwordCalls.length,2);assert.equal(f.state.logouts.length,1);
 results.push({name:'pending optional CSS still permits verified login; late CSS and logout/relogin '+width,width,before,passed:true});console.log('PASS optional CSS pending, verified login, late load, logout/relogin '+width);
 }catch(error){const state=await p.evaluate(()=>({ready:__normalState.ready,busy:__normalState.busy,loading:__normalState.loading,user:currentUser?.username,gate:document.getElementById('zc-cloud-gate').hidden,button:document.getElementById('zc-cloud-submit').disabled,fields:['zc-cloud-email','zc-cloud-password'].map(id=>{const e=document.getElementById(id);return{id,type:e.type,length:e.value.length,form:e.form?.id,missing:e.validity.valueMissing};}),dialogs:[...document.querySelectorAll('dialog[open]')].map(e=>e.innerText)}));console.error('TAIL_FAIL',JSON.stringify({width,state,authCalls:f.state.passwordCalls.length,logouts:f.state.logouts.length}));await p.screenshot({path:path.join(OUT,'failed-'+width+'.png')});throw error;}finally{await f.finish();}}
async function head(browser){const f=await fixture(browser,390,'head-css'),p=f.page;try{
 await f.started;await delay(2300);const before=await p.evaluate(()=>({loading:document.readyState==='loading',pending:SnoteStartupPresentation.pending,controller:!!window.zc86Cloud}));assert(before.pending&&!before.controller,'Do not expose a partial main document before its login controller exists');
 f.release();const ready=await f.pending;await usable(p);await ready.login();await verified(p);results.push({name:'head CSS delay recovers when real controller is parsed',before,passed:true});console.log('PASS head CSS delayed parsing recovers');
 }finally{await f.finish();}}
async function failures(browser,mode){const f=await fixture(browser,390,mode),p=f.page;try{
 await f.pending;await usable(p);assert(f.requests.length>0);await signIn(p);await verified(p);assert.equal(f.state.passwordCalls.length,1);results.push({name:mode+' does not block login',requests:f.requests.length,passed:true});console.log('PASS '+mode+' login');
 }finally{await f.finish();}}
async function denied(browser,inactive){const f=await fixture(browser,390,'tail-css',{inactive}),p=f.page;try{
 await f.started;await usable(p);await signIn(p,inactive?constants.PASSWORD:'WrongSyntheticPassword!456');await p.waitForFunction(()=>!__normalState.busy);assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(await p.locator('#zc-cloud-gate').isVisible(),true);assert.equal(await p.locator('#zc-cloud-submit').isEnabled(),true);assert.equal(await p.evaluate(()=>currentUser===null),true);assert.equal(f.state.downloads.length,0);assert(f.state.reads.every(r=>r.table==='zc_members'));
 results.push({name:(inactive?'inactive member':'wrong password')+' remains blocked after display fallback',passed:true});console.log('PASS display fallback preserves '+(inactive?'membership':'password')+' protection');
 }finally{await f.finish();}}
if(require.main===module)(async()=>{const before=sourceHash(),b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{for(const width of[1440,390])await tail(b,width);await head(b);await failures(b,'fonts-fail');await failures(b,'image-fail');await denied(b,false);await denied(b,true);assert.deepEqual(sourceHash(),before,'Product source is frozen during verification');fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingReads:0,operatingWrites:0,sourceHashes:before,cases:results.length,results},null,2)+'\n');}finally{await b.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
