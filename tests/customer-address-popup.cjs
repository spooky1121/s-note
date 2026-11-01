'use strict';
// Real browser popup regression; provider SDK and every network response are mocked.
// This checks our bridge/CSP, not live Kakao compatibility. No production credentials.
// Install tools outside this static Pages repository (no root package.json):
//   npm install --prefix /tmp/snote-browser-tests --no-save --no-audit --no-fund playwright@1.57.0
// Use a Playwright-managed Chromium, or set CHROMIUM_PATH to an installed browser:
//   CHROMIUM_PATH=/usr/bin/chromium NODE_PATH=/tmp/snote-browser-tests/node_modules node tests/customer-address-popup.cjs
// Optional SNOTE_TEST_SCREENSHOT writes the final mobile screen to that path.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const token = 'a'.repeat(64), session = 'b'.repeat(64);
const info = {ok:true,rrnEnabled:true,car:{model:'현대 그랜저 2.5',plate:'123가4567',year:2024,km:18200,color:'흰색',sell:2390},companyName:'테스트 자동차',phoneMasked:'010-****-5678',expiresAt:'2026-11-02T09:00:00Z',status:'pending'};
const challenge = {ok:true,challengeId:'11111111-1111-4111-8111-111111111111',expiresAt:'2026-11-01T09:05:00Z',retryAfter:60};
const verified = {ok:true,session,sessionExpiresAt:'2026-11-01T09:30:00Z'};

const rawHeaders=fs.readFileSync(root+'/_headers','utf8');
const cspFor=pathname=>{const block=rawHeaders.split(/\n\n+/).find(b=>b.startsWith(pathname.startsWith('/address-search')?'/address-search*':'/customer*'));return block.split('\n').find(l=>l.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim()};
let sdkFail=false;
const sdkMock=`
window.fixtureSdkProbe={origin:globalThis.origin,protocol:location.protocol,hashCleared:location.hash==='',openerNull:window.opener===null};
window.daum={Postcode:function(options){this.embed=function(host){
 const button=document.createElement('button');button.id='mock-select';button.textContent='검색 주소 선택';button.onclick=()=>options.oncomplete({userSelectedType:'R',roadAddress:'서울특별시 중구 세종대로 110',zonecode:'04524'});host.append(button);
 const wrapper=document.createElement('iframe');wrapper.id='mock-wrapper';host.append(wrapper);
 const provider=wrapper.contentDocument.createElement('iframe');provider.id='mock-provider';provider.src='https://postcode.map.kakao.com/provider-fixture';wrapper.contentDocument.body.append(provider);
}}};
`;
const providerScript=`(async()=>{window.fixtureProbe={origin:globalThis.origin,protocol:location.protocol};try{localStorage.setItem('address-origin-fixture','1');localStorage.removeItem('address-origin-fixture');fixtureProbe.storage=true}catch(e){fixtureProbe.storage=false}try{const r=await fetch('/origin-probe',{method:'POST',body:'fixture'});fixtureProbe.fetchOk=r.ok}catch(e){fixtureProbe.fetchOk=false}fixtureProbe.done=true;})();`;

let browser;
async function fixture(custom, hash=token, width=320){
 const context=await browser.newContext({viewport:{width,height:900}});
 const page=await context.newPage(), calls=[], external=[], errors=[];
 context.on('page', tab=>tab.on('pageerror',e=>errors.push(e.message)));
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const actualOpen=window.open;window.fixturePopupRefs=[];window.fixturePopupUrls=[];window.open=function(...args){const result=actualOpen.apply(this,args);fixturePopupRefs.push(result);fixturePopupUrls.push(args[0]);return result;}});
 await page.clock.install({time:new Date('2026-11-01T09:00:00Z')});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.href==='https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js')return sdkFail?route.abort():route.fulfill({contentType:'application/javascript',body:sdkMock});
  if(url.origin==='https://postcode.map.kakao.com'){
   if(url.pathname==='/provider-fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/provider-fixture.js"></script>'});
   if(url.pathname==='/provider-fixture.js')return route.fulfill({contentType:'application/javascript',body:providerScript});
   if(url.pathname==='/origin-probe')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
  }
  if(url.origin!=='https://customer.test'){external.push(url.origin);return route.abort();}
  if(url.pathname==='/api/customer-intake'){
   assert.equal(request.method(),'POST');assert.equal(url.search,'');
   const body=JSON.parse(request.postData());calls.push(body);
   assert.equal(body.token,token);
   const result=custom?await custom(body,calls):null;
   if(result==='abort')return route.abort('failed');
   const answer=result||{body:body.action==='info'?info:body.action==='send-code'?challenge:body.action==='verify'?verified:{ok:true,submittedAt:'2026-11-01T09:01:00Z'}};
   return route.fulfill({status:answer.status||200,contentType:'application/json',body:JSON.stringify(answer.body)});
  }
  const files={'/customer.html':'customer.html','/assets/customer-intake.js':'assets/customer-intake.js','/assets/customer-intake.css':'assets/customer-intake.css','/assets/snote-logo.png':'assets/snote-logo.png','/address-search.html':'address-search.html','/assets/address-search.js':'assets/address-search.js','/assets/address-search.css':'assets/address-search.css'};
  if(!files[url.pathname])return route.abort();
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'};
  return route.fulfill({contentType:types[path.extname(url.pathname)],body:fs.readFileSync(path.join(root,files[url.pathname])),headers:{'Content-Security-Policy':cspFor(url.pathname),'Referrer-Policy':'no-referrer'}});
 });
 await page.goto('https://customer.test/customer.html'+(hash?'#'+hash:''),{waitUntil:'networkidle'});
 return {context,page,calls,external,errors};
}
async function layout(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
async function begin(page){await page.locator('#stage-car').waitFor({state:'visible'});await page.locator('#vehicle-confirmed').check();await page.locator('#vehicle-next').click();await page.locator('#request-code').click();await page.locator('#verification-code').fill('000123');await page.locator('#verify-button').click();await page.locator('#stage-details').waitFor({state:'visible'});}
async function fill(page){await page.locator('#customer-name').fill('김테스트');await page.locator('#address-base').fill('서울특별시 강남구 테스트로 10');await page.locator('#address-detail').fill('101동 202호');await page.locator('#required-consent').check();}
async function finishFixture(f){assert.deepEqual(f.external,[]);assert.deepEqual(f.errors,[]);await f.context.close();}

async function popup(f,target='residence'){
 const pending=f.context.waitForEvent('page');await f.page.locator('[data-address-search="'+target+'"]').click();const child=await pending;await child.locator('#mock-select').waitFor();return child;
}
async function closed(child){if(!child.isClosed())await child.waitForEvent('close');}
async function assertParentAddress(p,value){assert.equal(await p.locator('#address-base').inputValue(),value);}
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  {
   const f=await fixture(),p=f.page;await begin(p);await fill(p);await p.locator('#rrn-front').fill('900101');await p.locator('#rrn-back').fill('1234567');
   assert.equal(await p.locator('iframe,dialog').count(),0);assert.equal(await p.locator('[data-address-search="mailing"]').isDisabled(),true);
   let child=await popup(f);
   assert.deepEqual(await child.evaluate(()=>fixtureSdkProbe),{origin:'https://customer.test',protocol:'https:',hashCleared:true,openerNull:true});
   const url=await p.evaluate(()=>fixturePopupUrls[0]);assert(!url.includes(token));assert(!url.includes(session));assert(!url.includes('1234567'));assert.deepEqual([...new URL(url).searchParams.keys()],['parentOrigin']);
   const nonce=new URL(url).hash.slice(1);assert.match(nonce,/^[a-f0-9]{32}$/);
   assert.equal(await child.locator('#mock-wrapper').evaluate(e=>e.contentWindow.origin),'https://customer.test');
   await child.waitForFunction(()=>frames.length===1&&frames[0].frames.length===1);
   const provider=child.frames().find(frame=>frame.url().startsWith('https://postcode.map.kakao.com/provider-fixture'));await provider.waitForFunction(()=>window.fixtureProbe?.done);
   const probe=await provider.evaluate(()=>fixtureProbe);assert.equal(probe.origin,'https://postcode.map.kakao.com');assert.equal(probe.protocol,'https:');assert.equal(probe.fetchOk,true);
   await p.evaluate(nonce=>{for(const [origin,source,n]of [['https://wrong.test',fixturePopupRefs[0],nonce],[location.origin,window,nonce],[location.origin,fixturePopupRefs[0],'0'.repeat(32)]])dispatchEvent(new MessageEvent('message',{origin,source,data:{type:'SNOTE_CUSTOMER_ADDRESS',nonce:n,kind:'selected',address:'잘못된 주소'}}));},nonce);
   await assertParentAddress(p,'서울특별시 강남구 테스트로 10');
   await child.locator('#mock-select').click();await closed(child);await p.locator('#address-search-status').waitFor({state:'hidden'});
   await assertParentAddress(p,'서울특별시 중구 세종대로 110');assert.equal(await p.locator('#mailing-base').inputValue(),'서울특별시 중구 세종대로 110');assert.equal(await p.locator('#address-detail').inputValue(),'');assert.equal(await p.locator('#rrn-back').inputValue(),'1234567');assert.equal(await p.evaluate(()=>document.activeElement.id),'address-detail');
   await p.locator('#same-address').uncheck();child=await popup(f,'mailing');
   await child.locator('#mock-select').click();await closed(child);assert.equal(await p.evaluate(()=>document.activeElement.id),'mailing-detail');
   await assertParentAddress(p,'서울특별시 중구 세종대로 110');
   child=await popup(f);const old=child;const next=await popup(f,'mailing');await closed(old);
   const newNonce=await p.evaluate(()=>new URL(fixturePopupUrls.at(-1)).hash.slice(1));
   await p.evaluate(nonce=>dispatchEvent(new MessageEvent('message',{origin:location.origin,source:fixturePopupRefs.at(-2),data:{type:'SNOTE_CUSTOMER_ADDRESS',nonce,kind:'selected',address:'이전 창 주소'}})),newNonce);
   assert.equal(await p.locator('#mailing-base').inputValue(),'서울특별시 중구 세종대로 110');
   await p.locator('#address-search-cancel').click();await closed(next);await p.locator('#address-search-status').waitFor({state:'hidden'});
   child=await popup(f);await child.locator('#close-search').click();await closed(child);await p.locator('#address-search-status').waitFor({state:'hidden'});
   child=await popup(f);await child.keyboard.press('Escape').catch(error=>{if(!child.isClosed())throw error;});await closed(child);await p.locator('#address-search-status').waitFor({state:'hidden'});
   child=await popup(f);await child.close();await p.clock.fastForward(600);await p.locator('#address-search-status').waitFor({state:'hidden'});
   await layout(p);if(process.env.SNOTE_TEST_SCREENSHOT)await p.screenshot({path:process.env.SNOTE_TEST_SCREENSHOT,fullPage:true});
   assert.equal(await p.locator('#rrn-back').inputValue(),'1234567');await finishFixture(f);
   console.log('PASS real HTTPS popup, SDK opener null/fragment cleared, about:blank wrapper + HTTPS provider nested iframe same-origin fetch, origin/source/nonce/stale rejection, residence/mailing/detail focus, cancel/Escape/window close, 320px, RRN preserved');
  }
  {
   const f=await fixture(),p=f.page;await begin(p);await fill(p);await p.evaluate(()=>window.open=()=>null);await p.locator('[data-address-search="residence"]').click();await p.getByText(/주소 검색창이 차단되었습니다/).waitFor();assert.equal(f.context.pages().length,1);await assertParentAddress(p,'서울특별시 강남구 테스트로 10');assert.equal(await p.locator('#address-base').isEnabled(),true);await finishFixture(f);console.log('PASS blocked popup shows recovery and preserves editable form');
  }
  {
   sdkFail=true;const f=await fixture(),p=f.page;await begin(p);await fill(p);const pending=f.context.waitForEvent('page');await p.locator('[data-address-search="residence"]').click();const child=await pending;await child.locator('#search-status[data-tone="error"]').waitFor();await p.locator('#address-search-status[data-tone="error"]').waitFor();await p.locator('#address-search-cancel').click();await closed(child);await assertParentAddress(p,'서울특별시 강남구 테스트로 10');assert.equal(await p.locator('#address-base').isEnabled(),true);await finishFixture(f);sdkFail=false;console.log('PASS SDK load failure preserves editable address and cancel');
  }
  {
   const context=await browser.newContext();let sdkRequests=0;await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='t1.kakaocdn.net'){sdkRequests++;return route.abort();}const file=url.pathname==='/address-search.html'?'address-search.html':url.pathname.slice(1);if(!fs.existsSync(root+'/'+file))return route.abort();return route.fulfill({contentType:path.extname(file)==='.html'?'text/html':path.extname(file)==='.js'?'application/javascript':'text/css',body:fs.readFileSync(root+'/'+file)});});const p=await context.newPage();await p.goto('https://customer.test/address-search.html?parentOrigin=https%3A%2F%2Fcustomer.test#'+'1'.repeat(32));await p.getByText('고객정보 입력 화면의 주소 검색 버튼으로 열어 주세요.').waitFor();assert.equal(sdkRequests,0);await context.close();console.log('PASS direct helper without trusted opener rejects before SDK load');
  }
  console.log('ALL V2.13 ADDRESS POPUP FIXTURE CHECKS PASSED');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
