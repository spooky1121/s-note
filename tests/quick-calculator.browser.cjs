'use strict';
// Real index, local seeded sample accounts, and intercepted static assets only.
// No Supabase, SMS, or other external requests are allowed by this fixture.
// Requires Playwright available via NODE_PATH/local installation.
// Run: NODE_PATH="$(npm root -g)" CHROMIUM_PATH=/usr/bin/chromium node tests/quick-calculator.browser.cjs
// CALCULATOR_TEST_ARTIFACT_DIR optionally selects the screenshot output directory.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://quick-calculator.example';
const ARTIFACTS=process.env.CALCULATOR_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-quick-calculator');
const executablePath=process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
fs.mkdirSync(ARTIFACTS,{recursive:true});
let browser;
async function fixture(width=1440,reducedMotion=false){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:reducedMotion?'reduce':'no-preference'}),page=await context.newPage(),external=[],errors=[],blocked=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==ORIGIN){external.push(url.href);return route.abort();}
  if(url.pathname==='/'){
   const source=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
   assert(source.includes('\ninitializeAuth();'),'The test must expose the actual local sample initialization without replacing auth behavior');
   return route.fulfill({contentType:'text/html;charset=utf-8',body:source.replace('\ninitializeAuth();','\nwindow.__quickCalculatorFixtureAuth=initializeAuth();')});
  }
  if(url.pathname==='/monthly.html')return route.fulfill({contentType:'text/html;charset=utf-8',body:fs.readFileSync(path.join(ROOT,'monthly.html'),'utf8')});
  if(url.pathname.startsWith('/assets/')){const relative=url.pathname.slice(1);if(!fs.existsSync(path.join(ROOT,relative))){blocked.push(url.pathname);return route.abort();}const types={'.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};return route.fulfill({contentType:types[path.extname(relative)]||'application/octet-stream',body:fs.readFileSync(path.join(ROOT,relative))});}
  blocked.push(url.pathname);return route.abort();
 });
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__quickCalculatorFixtureAuth);await page.evaluate(()=>window.__quickCalculatorFixtureAuth);
 async function account(name='accounting'){await page.evaluate(async name=>{const sample=await getAccount(name);if(!sample)throw Error('Expected existing local sample account');await enterWorkspace(sample);document.getElementById('zc-cloud-gate').hidden=true;},name);await page.locator('#snote-calculator-trigger:not([disabled])').waitFor();}
 await account();
 return {context,page,external,errors,blocked,account};
}
const trigger=p=>p.locator('#snote-calculator-trigger'),panel=p=>p.locator('#snote-calculator-panel');
async function open(p){if(await panel(p).isHidden())await trigger(p).click();await panel(p).waitFor({state:'visible'});}
async function close(p){if(await panel(p).isVisible())await p.locator('#snote-calculator-close').click();await panel(p).waitFor({state:'hidden'});}
async function key(p,value){await p.locator('[data-calculator-key="'+value+'"]').click();}
async function display(p){return(await p.locator('#snote-calculator-display').textContent()).trim().replace(/,/g,'').replace(/−/g,'-');}
async function outside(p){await p.locator('#screen-title').click();await panel(p).waitFor({state:'hidden'});}
async function noOverflow(p){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
async function finish(f){assert.deepEqual(f.external,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.blocked,[]);await f.context.close();}

(async()=>{
 browser=await chromium.launch({executablePath,headless:true});
 try{
  {
   const f=await fixture(),p=f.page;
   assert.equal(await panel(p).isHidden(),true);assert.equal(await trigger(p).getAttribute('aria-expanded'),'false');
   const icon=await trigger(p).boundingBox(),profile=await p.locator('#snote-profile-trigger').boundingBox();assert(icon.x+icon.width<=profile.x+1,'Calculator must sit to the left of the profile');assert(Math.abs(icon.y+icon.height/2-profile.y-profile.height/2)<12,'Calculator and profile should share one row');
   await open(p);await p.waitForFunction(()=>document.getElementById('snote-calculator-panel').classList.contains('is-open'));
   assert.equal(await panel(p).getAttribute('role'),'dialog');assert.equal(await panel(p).getAttribute('aria-modal'),'false');assert.equal(await panel(p).evaluate(el=>el.inert),false);assert((await panel(p).evaluate(el=>getComputedStyle(el).transitionDuration)).split(',').some(v=>parseFloat(v)>0));
   await key(p,'AC');await p.keyboard.type('8+2');assert.equal((await p.locator('#snote-calculator-preview').textContent()).trim(),'= 10');await p.keyboard.press('Enter');assert.equal(await display(p),'10');
   await key(p,'AC');for(const value of ['8','*','7','='])await key(p,value);assert.equal(await display(p),'56');
   await key(p,'AC');await p.keyboard.type('9-12');await p.keyboard.press('Enter');assert.equal(await display(p),'-3');
   await key(p,'AC');await p.keyboard.type('7/2');await p.keyboard.press('Enter');assert.equal(await display(p),'3.5');
   await key(p,'AC');await p.keyboard.type('123');await p.keyboard.press('Backspace');assert.equal(await display(p),'12');await p.keyboard.press('Delete');assert.equal(await display(p),'0');
   await p.keyboard.type('1/0');await p.keyboard.press('Enter');assert.equal(await p.locator('#snote-calculator-display').getAttribute('data-error'),'true');assert((await p.locator('#snote-calculator-help').textContent()).includes('0으로'));await p.keyboard.type('7');assert.equal(await display(p),'7');assert.equal(await p.locator('#snote-calculator-display').getAttribute('data-error'),'false');
   await p.keyboard.press('Escape');await panel(p).waitFor({state:'hidden'});assert.equal(await trigger(p).evaluate(el=>document.activeElement===el),true);assert.equal(await panel(p).evaluate(el=>el.inert),true);
   await open(p);await outside(p);assert.equal(await trigger(p).getAttribute('aria-expanded'),'false');
   await open(p);await p.locator('#snote-profile-trigger').click();await panel(p).waitFor({state:'hidden'});assert.equal(await p.locator('#snote-profile-menu').isVisible(),true);await trigger(p).click();await panel(p).waitFor({state:'visible'});assert.equal(await p.locator('#snote-profile-menu').isHidden(),true);
   await p.evaluate(()=>navigate('inventoryFinance'));await panel(p).waitFor({state:'hidden'});await p.locator('#inventory-finance-search').waitFor({state:'visible'});await open(p);const before=await display(p);await p.locator('#inventory-finance-search').click();await panel(p).waitFor({state:'hidden'});await p.keyboard.type('12+3');await p.keyboard.press('Backspace');await p.keyboard.press('Enter');assert.equal(await p.locator('#inventory-finance-search').inputValue(),'12+');assert.equal(await display(p),before,'Typing in a real search field must not feed the calculator');
   await p.evaluate(()=>navigate('monthly'));const frame=p.frameLocator('#monthly-ledger-frame');await frame.locator('#reference-button').waitFor({state:'visible'});await open(p);const card=await panel(p).boundingBox(),iframe=await p.locator('#monthly-ledger-frame').boundingBox();const y=Math.max(iframe.y+20,card.y+card.height+16);assert(y<880,'Fixture must click a visible point inside the real monthly iframe');await p.mouse.click(iframe.x+20,y);await panel(p).waitFor({state:'hidden'});
   await open(p);await p.evaluate(()=>{navigate('inventoryFinance');navigate('monthly');navigate('inventoryFinance');});await panel(p).waitFor({state:'hidden'});assert.equal(await p.locator('#inventory-finance-search').isVisible(),true);
   await open(p);await f.account('dealer2');await panel(p).waitFor({state:'hidden'});assert.equal(await display(p),'0');
   await f.account();await open(p);await key(p,'1');await key(p,'2');await key(p,'3');await key(p,'.');await key(p,'4');await key(p,'5');await noOverflow(p);await p.screenshot({path:path.join(ARTIFACTS,'quick-calculator-1440.png'),fullPage:true});
   await p.reload({waitUntil:'networkidle'});await p.waitForFunction(()=>!!window.__quickCalculatorFixtureAuth);await p.evaluate(()=>window.__quickCalculatorFixtureAuth);assert.equal(await panel(p).isHidden(),true);await f.account();assert.equal(await panel(p).isHidden(),true);await finish(f);
   console.log('PASS desktop actual index: profile-left placement, slide transitions, real-time arithmetic/keyboard/edit/error recovery, Escape/focus, outside/profile/navigation/account reset/real iframe close, search typing isolation and reload hidden');
  }
  {
   const f=await fixture(390,true),p=f.page;await open(p);await noOverflow(p);const card=await panel(p).boundingBox(),icon=await trigger(p).boundingBox(),profile=await p.locator('#snote-profile-trigger').boundingBox();assert(card.x>=11&&card.x+card.width<=379,'390px panel must retain viewport margins');assert(card.y>=icon.y+icon.height-2,'Panel must open below the icon');assert(icon.x+icon.width<=profile.x+1,'Mobile icon remains before profile');assert((await panel(p).evaluate(el=>getComputedStyle(el).transitionDuration)).split(',').every(v=>parseFloat(v)===0));
   await key(p,'AC');await p.keyboard.type('1250.5+250');assert.equal((await p.locator('#snote-calculator-preview').textContent()).trim(),'= 1,500.5');await p.keyboard.press('Enter');assert.equal(await display(p),'1500.5');await p.screenshot({path:path.join(ARTIFACTS,'quick-calculator-390.png'),fullPage:true});await p.keyboard.press('Escape');assert.equal(await panel(p).isHidden(),true);await open(p);await p.locator('#snote-calculator-close').click();assert.equal(await panel(p).isHidden(),true);await noOverflow(p);await finish(f);
   console.log('PASS 390px actual index: profile-left icon, viewport-clamped card, zero body overflow, numeric preview, reduced-motion open/close and explicit close focus');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
