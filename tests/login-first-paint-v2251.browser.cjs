'use strict';
// Actual HTML and controller; all accounts, APIs and asset failures are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,constants}=require('./normal-login.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_FIRST_PAINT_OUTPUT||'/workspace/work/login-first-paint-v2251';
fs.mkdirSync(OUT,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const hashes=()=>Object.fromEntries(['index.html','assets/workspace-density.css','assets/login-landing.js','assets/design-settings-office.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]));
async function geometry(page){return page.evaluate(()=>{
 const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),c=getComputedStyle(el);return{selector,x:r.x,y:r.y,width:r.width,height:r.height,fontSize:c.fontSize,order:c.order};};
 const gate=document.getElementById('zc-cloud-gate');return{rects:['.snote-login-shell','.snote-login-panel','.snote-login-visual','#zc-cloud-title','#zc-cloud-email','.snote-login-photo','.snote-auth-invite','.snote-login-footer','.snote-login-shared-hint'].map(rect),copy:gate.querySelector('.snote-auth-invite').textContent,horizontal:Math.max(gate.scrollWidth-gate.clientWidth,document.documentElement.scrollWidth-innerWidth),ready:document.readyState,startup:window.SnoteStartupPresentation?.state};
});}
function currentLayout(value,width){
 assert.equal(value.horizontal,0);const[,panel,hero,title,input]=value.rects;
 assert.equal(hero.order,'1');assert.equal(title.fontSize,width>760?'31px':'29px');assert.equal(input.fontSize,width>760?'13px':'16px');
 if(width>760){assert(hero.x>=panel.x+panel.width-1);assert(hero.width>panel.width);}
 else{assert(hero.y>=panel.y+panel.height-1);assert(hero.width>0&&hero.height>=480);}
}
async function slowOptional(browser,width){
 const context=await browser.newContext({viewport:{width,height:950}}),made=deferred(),started=deferred(),released=deferred(),state=backend(),held=[];let holding=true;
 const original=context.newPage.bind(context);context.newPage=async()=>{const page=await original(),route=page.route.bind(page);page.route=(pattern,handler,...rest)=>route(pattern,async r=>{
  const pathname=new URL(r.request().url()).pathname;
  if(holding&&['/assets/workspace-density.css','/assets/login-landing.js'].includes(pathname)){held.push(pathname);started.resolve();await released.promise;}
  return handler(r);
 },...rest);made.resolve(page);return page;};
 const pending=boot(browser,state,'first-paint-'+width,{context,width});pending.catch(()=>{});const p=await made.promise;
 try{
  await started.promise;await p.waitForFunction(()=>window.SnoteStartupPresentation?.state.released);await delay(250);
  const before=await geometry(p);currentLayout(before,width);assert.equal(before.startup.deadline,true);assert.equal(before.ready,'loading');
  await p.screenshot({path:path.join(OUT,'fixed-delayed-'+width+'.png')});
  assert.equal(await p.locator('#zc-cloud-submit').isEnabled(),true);
  holding=false;released.resolve();const f=await pending;await delay(250);const after=await geometry(p);currentLayout(after,width);
  assert.deepEqual(after.rects,before.rects,'Late optional styles/scripts must not move or resize the login');
  assert.equal(after.copy,before.copy,'Late enhancements must not replace the visible signup copy');
  await p.screenshot({path:path.join(OUT,'fixed-settled-'+width+'.png')});
  await f.login();await f.ready();assert.equal(state.passwordCalls.length,1);
  await f.finish();return{width,held,before,after,login:true};
 }finally{holding=false;released.resolve();await pending.catch(()=>{});await context.close();}
}
async function failedOptional(browser){
 const context=await browser.newContext({viewport:{width:390,height:950}}),original=context.newPage.bind(context),failed=[];
 context.newPage=async()=>{const page=await original(),route=page.route.bind(page);page.route=(pattern,handler,...rest)=>route(pattern,async r=>{
  const pathname=new URL(r.request().url()).pathname;
  if(['/assets/login-landing.js','/assets/workspace-density.css','/assets/login-garage-clear.webp','/assets/login-garage-clear.png'].includes(pathname)){failed.push(pathname);return r.fulfill({status:404,body:'Synthetic optional asset failure'});}
  return handler(r);
 },...rest);return page;};
 const state=backend(),f=await boot(browser,state,'first-paint-fail',{context,width:390});try{
  const p=f.page;await p.waitForFunction(()=>window.SnoteStartupPresentation?.state.released);const value=await geometry(p);currentLayout(value,390);
  assert.equal(await p.locator('.snote-showcase').count(),4);assert.equal(await p.locator('[data-login-reveal].is-pending').count(),0);
  await f.login();await f.ready();assert.equal(state.passwordCalls.length,1);await f.finish();return{failed,geometry:value,login:true};
 }finally{await context.close();}
}
async function noJavascript(browser,width){
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:950}}),p=await context.newPage(),requests=[];
 await p.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,constants.ORIGIN,'No external request in no-JS fixture');requests.push(url.pathname);
  const file=path.resolve(ROOT,url.pathname==='/'?'index.html':url.pathname.slice(1));assert(file.startsWith(ROOT+path.sep));if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
  const types={'.html':'text/html','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
 });
 try{
  await p.goto(constants.ORIGIN,{waitUntil:'networkidle'});const value=await geometry(p);currentLayout(value,width);
  assert.equal(await p.locator('.snote-login-noscript').isVisible(),true);assert.equal(await p.locator('#zc-cloud-setup').isVisible(),false);assert.equal(await p.locator('#zc-cloud-login').isVisible(),false);
  assert.equal(await p.locator('.snote-showcase').count(),4);await p.screenshot({path:path.join(OUT,'no-js-'+width+'.png')});return{width,geometry:value,requests:requests.length};
 }finally{await context.close();}
}
if(require.main===module)(async()=>{
 const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  for(const width of[1440,390]){results.push({name:'slow optional resources '+width,...await slowOptional(browser,width)});console.log('PASS stable first paint, delayed CSS/JS and real login '+width);}
  results.push({name:'failed optional resources',...await failedOptional(browser)});console.log('PASS failed decorative JS/CSS/hero image retain current layout and login');
  for(const width of[1440,390]){results.push({name:'JavaScript disabled '+width,...await noJavascript(browser,width)});console.log('PASS JavaScript-disabled current layout and safe login guidance '+width);}
  assert.deepEqual(hashes(),before,'Product source is frozen while verifying');fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,productionReads:0,productionWrites:0,sourceHashes:before,results},null,2)+'\n');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
