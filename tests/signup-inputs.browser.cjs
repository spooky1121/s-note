'use strict';
// Actual Chromium + signup sources. Every API, Auth and Kakao response is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('./encar/node_modules/playwright');
const { setup, open, fill, companyCheck, constants } = require('./signup-registration.browser.cjs');
const { constants: login } = require('./normal-login.browser.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SNOTE_SIGNUP_INPUTS_ARTIFACT_DIR || '/workspace/work/signup-inputs-v2190';
const WIDTHS = (process.env.SNOTE_SIGNUP_INPUTS_WIDTHS || '1440,360,390,430').split(',').map(Number);
const PREFIX = constants.PREFIX;
const KAKAO = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
const SOURCE = ['index.html','assets/signup-registration.js','assets/signup-registration.css','functions/api/registration.js','supabase/migrations/20261122144025_verified_registration.sql','address-search.html','assets/address-search.js','assets/address-search.css'];
const hashes = () => Object.fromEntries(SOURCE.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const results = [], receipts = [];
fs.mkdirSync(OUT, { recursive: true });
function deferred() { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; }
async function settled(p) { await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function popupDismiss(p) { const dialog=p.locator('#snote-message-dialog[open]'); if(await dialog.count()) await dialog.locator('[data-message-accept]').click(); }
async function safeFixture(browser, width, callback) {
  const f = await setup(browser,width);
  try { await callback(f); await f.f.finish(); }
  catch(error) { await f.p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{}); await f.f.context.close(); throw error; }
}
async function geometry(p) {
  return p.evaluate(() => {
    const gate=document.getElementById('zc-cloud-gate'), form=document.getElementById('snote-registration-form'), origin=document.getElementById('snote-registration-company').getBoundingClientRect().top;
    return { fields:Object.fromEntries(['business','owner','address','name','phone','email','password','business-certificate','dealer-license','submit'].map(name=>{const r=document.getElementById('snote-registration-'+name).getBoundingClientRect();return[name,{top:r.top-origin,left:r.left,width:r.width,height:r.height}];})),formHeight:form.getBoundingClientRect().height,scrollHeight:gate.scrollHeight,scrollTop:gate.scrollTop,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth };
  });
}
function sameGeometry(a,b,label,{scroll=true}={}) {
  for(const [name,rect] of Object.entries(a.fields)) for(const key of ['top','left','width','height']) assert(Math.abs(rect[key]-b.fields[name][key])<=0.6,label+' changes '+name+' '+key);
  assert(Math.abs(a.formHeight-b.formHeight)<=0.6,label+' changes form height'); assert.equal(a.scrollHeight,b.scrollHeight,label+' changes scroll height');
  if(scroll) assert(Math.abs(a.scrollTop-b.scrollTop)<=1,label+' jumps current scroll');
  assert(b.pageWidth<=b.viewport,label+' creates horizontal overflow');
}
async function fixedStatusGeometry(browser,width) {
  await safeFixture(browser,width,async({f,p,signup})=>{
    await open(p); await fill(p,{check:false});
    await p.locator('#zc-cloud-gate').evaluate(el=>el.scrollTo({top:0,behavior:'instant'})); await settled(p);
    const before=await geometry(p),release=deferred(),arrived=deferred(); signup.holdCheck={promise:release.promise,arrive:arrived.resolve};
    await p.locator(PREFIX+'company-check').click(); await arrived.promise; await settled(p); const checking=await geometry(p); sameGeometry(before,checking,'checking',{scroll:false});
    release.resolve(); await p.waitForFunction(()=>document.getElementById('snote-registration-company-status').dataset.state==='available'); await settled(p);
    const available=await geometry(p); sameGeometry(before,available,'available',{scroll:false});
    const status=await p.locator(PREFIX+'company-status').evaluate(el=>({visible:getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none',text:el.textContent,color:getComputedStyle(el).color,icons:el.querySelectorAll('svg').length}));
    assert(status.visible&&status.icons>0&&/사용|가능/.test(status.text)); const rgb=status.color.match(/\d+/g).map(Number); assert(rgb[1]>rgb[0]&&rgb[1]>rgb[2],'Availability uses a green check/status');
    await p.locator('#zc-cloud-gate').evaluate(el=>el.scrollTo({top:Math.min(240,el.scrollHeight-el.clientHeight),behavior:'instant'})); await settled(p); const scrolled=await geometry(p);
    await p.locator(PREFIX+'company').evaluate(el=>{el.value+=' 수정';el.dispatchEvent(new Event('input',{bubbles:true}));}); await settled(p); const cleared=await geometry(p); sameGeometry(scrolled,cleared,'clear while scrolled');
    assert.notEqual(await p.locator(PREFIX+'company-status').getAttribute('data-state'),'available');
    signup.holdCheck=null; await p.locator(PREFIX+'company-check').evaluate(el=>el.click()); await p.waitForFunction(()=>document.getElementById('snote-registration-company-status').dataset.state==='available'); await settled(p); sameGeometry(cleared,await geometry(p),'recheck while scrolled');
    receipts.push({width,geometry:{before,checking,available,scrolled,cleared},status});
    await p.locator('#zc-cloud-gate').evaluate(el=>el.scrollTo({top:0,behavior:'instant'})); await p.screenshot({path:path.join(OUT,'signup-fixed-status-'+width+'.png'),fullPage:true});
    results.push({name:'green availability has fixed field/form/scroll geometry',width,passed:true}); console.log('PASS fixed company status geometry',width);
  });
}
async function valueAndCaret(p,name,expected) {
  const actual=await p.locator(PREFIX+name).evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd}));
  assert.equal(actual.value,expected,name+' formatted value'); assert(actual.start>=0&&actual.start<=expected.length&&actual.end<=expected.length,name+' caret stays valid'); return actual;
}
async function paste(p,context,name,text) {
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:login.ORIGIN}); await p.evaluate(value=>navigator.clipboard.writeText(value),text);
  await p.locator(PREFIX+name).focus(); await p.keyboard.press('Control+A'); await p.keyboard.press('Control+V');
}
async function formatting(browser) {
  await safeFixture(browser,390,async({f,p})=>{
    await open(p);
    const business=p.locator(PREFIX+'business'),phone=p.locator(PREFIX+'phone');
    await business.pressSequentially('1234567890'); assert.equal((await valueAndCaret(p,'business','123-45-67890')).start,12);
    await phone.pressSequentially('01012345678'); assert.equal((await valueAndCaret(p,'phone','010-1234-5678')).start,13);
    await paste(p,f.context,'business','9876543210'); assert.equal((await valueAndCaret(p,'business','987-65-43210')).start,12);
    await paste(p,f.context,'phone','0111234567'); assert.equal((await valueAndCaret(p,'phone','011-123-4567')).start,12);
    assert.equal(await phone.evaluate(el=>el.checkValidity()),true,'Legacy 011 10-digit mobiles remain valid');
    await paste(p,f.context,'phone','010-9876-5432'); await valueAndCaret(p,'phone','010-9876-5432');
    await business.fill('1234567890'); await business.evaluate(el=>el.setSelectionRange(4,5)); await p.keyboard.insertText('9'); assert.equal((await valueAndCaret(p,'business','123-95-67890')).start,5);
    await business.fill('1234567890'); await business.evaluate(el=>el.setSelectionRange(4,4)); await p.keyboard.press('Backspace'); const back=await valueAndCaret(p,'business','124-56-7890'); assert.equal(back.value.replace(/\D/g,'').length,9); assert.equal(back.start,2,'Backspace after a separator removes the preceding digit without trapping the caret');
    await business.fill('1234567890'); await business.evaluate(el=>el.setSelectionRange(3,3)); await p.keyboard.press('Delete'); const del=await valueAndCaret(p,'business','123-56-7890'); assert.equal(del.value.replace(/\D/g,'').length,9); assert(del.start<=4,'Delete before a separator removes the following digit');
    await phone.fill('01012345678'); await phone.evaluate(el=>el.setSelectionRange(4,8)); await p.keyboard.insertText('5555'); assert.equal((await valueAndCaret(p,'phone','010-5555-5678')).start,8);
    await phone.fill('01012345678'); await phone.evaluate(el=>el.setSelectionRange(4,4)); await p.keyboard.press('Backspace'); await valueAndCaret(p,'phone','011-234-5678');
    await p.screenshot({path:path.join(OUT,'signup-number-formatting-390.png'),fullPage:true}); results.push({name:'business/mobile typing, real paste, replacement, separator Backspace/Delete and caret; legacy 011',passed:true}); console.log('PASS number formatting and caret');
  });
}
async function filesRequired(browser) {
  await safeFixture(browser,390,async({f,p,signup})=>{
    for(const kind of ['representative','dealer']) {
      if(await p.locator('#snote-registration-form').isVisible()) await p.locator('#snote-auth-back').click();
      await open(p,kind); await fill(p,{files:false});
      const business=p.locator(PREFIX+'business-certificate'),dealer=p.locator(PREFIX+'dealer-license');
      for(const present of [null,'business','dealer']) {
        await business.setInputFiles([]); await dealer.setInputFiles([]);
        if(present) await (present==='business'?business:dealer).setInputFiles({name:'synthetic-required.png',mimeType:'image/png',buffer:constants.PNG});
        assert.equal(await business.evaluate(el=>el.required),true); assert.equal(await dealer.evaluate(el=>el.required),true);
        assert.equal(await p.locator('#snote-registration-form').evaluate(el=>[...el.elements].some(field=>field.validity?.valueMissing)),true); const count=signup.posts.length;
        await p.locator(PREFIX+'submit').click(); await p.waitForTimeout(80); assert.equal(signup.posts.length,count,'Missing '+present+' counterpart never reaches registration API'); assert.equal(signup.setSessions.length,0); await popupDismiss(p);
      }
    }
    results.push({name:'both evidence fields required for representative/dealer, either or both missing blocks the API',passed:true}); console.log('PASS required attachment UI');
  });
}
const POSTCODE_STUB = `window.daum={Postcode:function(options){window.__syntheticPostcode=options;this.embed=function(root){const button=document.createElement('button');button.id='synthetic-select-address';button.textContent='합성 주소 선택';button.onclick=()=>options.oncomplete({roadAddress:'합성시 합성구 새주소로 190',address:'합성시 합성구 새주소로 190',zonecode:'12345',userSelectedType:'R'});root.append(button);};}};`;
async function addressPopup(browser) {
  await safeFixture(browser,390,async({f,p,signup})=>{
    const external=[],kakaoRequests=[],childErrors=[];
    const rawHeaders=fs.readFileSync(path.join(ROOT,'_headers'),'utf8'),cspBlock=rawHeaders.split(/\n\n+/).find(block=>block.startsWith('/address-search*'));
    const csp=cspBlock.split('\n').find(line=>line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
    f.context.on('page',child=>{child.on('pageerror',error=>childErrors.push(error.message));});
    await f.context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.href===KAKAO){kakaoRequests.push(url.href);return route.fulfill({contentType:'application/javascript',body:POSTCODE_STUB});}
      if(url.origin!==login.ORIGIN){external.push(url.origin+url.pathname);return route.abort();}
      const file=path.resolve(ROOT,url.pathname.slice(1));
      if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){external.push(url.pathname);return route.abort();}
      const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'}[path.extname(file)]||'application/octet-stream';
      return route.fulfill({contentType:type,body:fs.readFileSync(file),headers:url.pathname==='/address-search.html'?{'Content-Security-Policy':csp,'Referrer-Policy':'no-referrer'}:{}});
    });
    await p.evaluate(()=>{const actualOpen=window.open;window.__signupAddressRefs=[];window.__signupAddressURLs=[];window.open=function(...args){const child=actualOpen.apply(this,args);window.__signupAddressRefs.push(child);window.__signupAddressURLs.push(String(args[0]));return child;};});
    await open(p); const button=p.locator('#snote-registration-address-search');
    assert.equal(await button.count(),1,'Registration provides a dedicated address-search action');
    const buttonGeometry=await button.evaluate(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,whiteSpace:getComputedStyle(el).whiteSpace,overflow:el.scrollHeight>el.clientHeight}));
    assert.equal(buttonGeometry.height,46); assert.equal(buttonGeometry.whiteSpace,'nowrap'); assert.equal(buttonGeometry.overflow,false,'Address search text stays on one line inside its 46px control');
    async function launch() {
      const wait=f.context.waitForEvent('page'); await button.click(); const popup=await wait; await popup.locator('#synthetic-select-address').waitFor({timeout:10000});
      const current=await p.evaluate(()=>({url:window.__signupAddressURLs.at(-1),index:window.__signupAddressRefs.length-1})),url=new URL(current.url);
      assert.equal(url.origin,login.ORIGIN);assert.equal(url.pathname,'/address-search.html');assert.deepEqual([...url.searchParams.keys()],['parentOrigin']);assert.equal(url.searchParams.get('parentOrigin'),login.ORIGIN);assert.match(url.hash,/^#[a-f0-9]{32}$/);
      const child=await popup.evaluate(()=>({openerNull:window.opener===null,hash:location.hash,origin:location.origin}));assert.deepEqual(child,{openerNull:true,hash:'',origin:login.ORIGIN});
      return{popup,index:current.index,nonce:url.hash.slice(1)};
    }
    async function send({index,nonce},patch={}){await p.evaluate(({index,nonce,patch,origin})=>window.dispatchEvent(new MessageEvent('message',{origin:patch.origin||origin,source:patch.self?window:window.__signupAddressRefs[index],data:{type:'SNOTE_CUSTOMER_ADDRESS',nonce:patch.nonce||nonce,kind:'selected',address:patch.address||'잘못된 합성 주소',postcode:'12345'}})),{index,nonce,patch,origin:login.ORIGIN});}
    async function closed(entry){await p.waitForFunction(index=>window.__signupAddressRefs[index].closed,entry.index);assert(entry.popup.isClosed());}
    await p.locator(PREFIX+'address').fill('원래 합성 주소');
    const active=await launch(); await active.popup.screenshot({path:path.join(OUT,'signup-kakao-child-window.png')});
    for(const patch of [{origin:'https://foreign.invalid'},{self:true},{nonce:'0'.repeat(32)}]) {await send(active,patch);assert.equal(await p.locator(PREFIX+'address').inputValue(),'원래 합성 주소','Wrong origin/source/nonce cannot update the signup address');}
    await active.popup.locator('#synthetic-select-address').click(); await p.waitForFunction(()=>document.getElementById('snote-registration-address').value.includes('새주소로 190')); await closed(active);
    assert.equal(await p.locator(PREFIX+'address').getAttribute('data-postcode'),'12345');await popupDismiss(p);
    assert.equal(await p.evaluate(()=>document.activeElement.id),'snote-registration-address');const caret=await p.locator(PREFIX+'address').evaluate(el=>({start:el.selectionStart,length:el.value.length}));assert.equal(caret.start,caret.length,'Selected address leaves the caret ready for a detailed address');
    const edited=await launch();await p.locator(PREFIX+'address').fill('직접 수정한 합성 주소');await closed(edited);await send(edited,{address:'편집 전 검색의 합성 주소'});assert.equal(await p.locator(PREFIX+'address').inputValue(),'직접 수정한 합성 주소','An exact old-source callback cannot overwrite a manually edited address');
    const stale=await launch();await p.locator('#snote-auth-back').click();await closed(stale);await open(p,'representative');await send(stale,{address:'지난 가입의 합성 주소'});assert.equal(await p.locator(PREFIX+'address').inputValue(),'','Previous signup mode cannot populate the new signup');
    const changed=await launch();await p.evaluate(()=>window.SnoteRegistration.authChanged());await closed(changed);await send(changed,{address:'다른 인증세대의 합성 주소'});assert.equal(await p.locator(PREFIX+'address').inputValue(),'','Auth invalidation rejects an exact old nonce and WindowProxy');
    assert.equal(signup.posts.length,0);assert.equal(kakaoRequests.length,4,'Each real new window must request the actual HTTPS SDK URL and execute its synthetic widget');assert.deepEqual(external,[]);assert.deepEqual(childErrors,[]);
    await p.screenshot({path:path.join(OUT,'signup-kakao-popup-390.png'),fullPage:true});receipts.push({addressPopup:{buttonGeometry,kakaoRequests,sourceOrigin:login.ORIGIN,firstPartyHosted:true,manualCallbackOnly:false}});
    results.push({name:'real hosted Kakao new window executes HTTPS SDK fixture; origin/source/nonce/address-edit/mode/Auth guards',passed:true});console.log('PASS signup Kakao popup callback guards');
  });
}
(async()=>{const before=hashes();let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});const focus=process.env.SNOTE_SIGNUP_INPUTS_FOCUS;if(!focus||focus==='geometry')for(const width of WIDTHS)await fixedStatusGeometry(browser,width);if(!focus||focus==='format')await formatting(browser);if(!focus||focus==='files')await filesRequired(browser);if(!focus||focus==='address')await addressPopup(browser);assert.deepEqual(hashes(),before,'Product source hashes changed during verification');}finally{await browser?.close();fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,sourceHashes:before,results,receipts},null,2)+'\n');}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
