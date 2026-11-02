'use strict';
// Actual index + real Chromium popups; all data, auth and HTTP responses are synthetic.
// No Supabase, Tavily, Encar, SMS, key configuration or production requests are made.
// Playwright is a development dependency isolated in tests/encar.
// Run: CHROMIUM_PATH=/usr/bin/chromium npm run test:browser --prefix tests/encar
// Omit CHROMIUM_PATH to use Playwright's separately installed Chromium.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),ORIGIN='https://encar-smoke.example';
const ACTOR='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALIAS='cld_'+ACTOR.replaceAll('-','').slice(0,18),TOKEN='synthetic-local-encar-session';
const PLATE='12가3456',SECOND_PLATE='34나5678';
const ARTIFACTS=process.env.ENCAR_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-encar-browser');
const executablePath=process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const BUTTON='.snote-encar-button',NOTE='.snote-encar-note',LINKS='.snote-encar-results a';
const listing=(id='43000001',trustedId='43000002',model='가상 검증 차량')=>({id,model,sellerUrl:'https://fem.encar.com/cars/detail/'+id,trustedId,trustedUrl:trustedId?'https://fem.encar.com/cars/detail/'+trustedId:null});
const found=(plate=PLATE,listings=[listing()])=>({status:listings.length>1?'multiple':'found',plate,listings,verifiedAt:'2026-11-02T00:00:00.000Z'});
let browser;
fs.mkdirSync(ARTIFACTS,{recursive:true});

async function fixture(width=1440){
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
 const f={context,page,requests:[],navigations:[],external:[],unexpected:[],errors:[],responses:[]};
 context.on('page',opened=>{opened.on('pageerror',error=>f.errors.push(error.message));opened.on('dialog',dialog=>dialog.accept());});
 page.on('pageerror',error=>f.errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(15000);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin==='https://fem.encar.com'&&/^\/cars\/detail\/4300000[1-6]$/.test(url.pathname)){
   f.navigations.push(url.href);return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><title>가상 엔카 광고</title><p>로컬 검증용 광고 응답</p>'});
  }
  if(url.origin!==ORIGIN){f.external.push(url.href);return route.abort();}
  if(url.pathname==='/api/encar'){
   const body=JSON.parse(request.postData());assert.equal(request.method(),'POST');assert.equal(request.headers().authorization,'Bearer '+TOKEN);assert.deepEqual(Object.keys(body).sort(),['candidateIds','plate']);assert(Array.isArray(body.candidateIds));
   f.requests.push(body);const response=f.responses.shift();assert(response,'Every lookup must have an explicit synthetic response');
   return route.fulfill({status:response.status||200,contentType:response.contentType||'application/json',body:JSON.stringify(response.body)});
  }
  if(url.pathname==='/'){
   let source=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
   assert(source.includes('\ninitializeAuth();'));assert(source.includes("const NIL='00000000-0000-0000-0000-000000000000';"));
   source=source.replace('\ninitializeAuth();','\nwindow.__encarFixtureAuth=initializeAuth();').replace("const NIL='00000000-0000-0000-0000-000000000000';","window.__encarFixtureState=S;\nconst NIL='00000000-0000-0000-0000-000000000000';");
   return route.fulfill({contentType:'text/html;charset=utf-8',body:source});
  }
  const relative=url.pathname.slice(1),file=path.resolve(ROOT,relative);
  if((url.pathname.startsWith('/assets/')||url.pathname==='/monthly.html')&&file.startsWith(ROOT+path.sep)&&fs.existsSync(file)){
   const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
   return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  }
  f.unexpected.push(url.pathname);return route.abort();
 });
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__encarFixtureAuth&&!!window.SnoteEncarLink);await page.evaluate(()=>window.__encarFixtureAuth);
 await page.evaluate(async({actor,company,alias,token,plate,secondPlate})=>{
  await enterWorkspace({username:alias,name:'가상 검증 딜러',role:'dealer',company:'가상 검증 상사',employeeNo:'TEST',union:''});
  cars=[{id:'encar-car-1',ownerId:alias,model:'가상 검증 차량 1',plate,year:2026,km:'10,000',buy:1000,sell:1200,status:'판매중'},{id:'encar-car-2',ownerId:alias,model:'가상 검증 차량 2',plate:secondPlate,year:2026,km:'20,000',buy:1500,sell:1700,status:'판매중'}];
  localStorage.setItem(carsStoreKey(alias),JSON.stringify(cars));window.__encarFixtureCars=structuredClone(cars);
  const S=window.__encarFixtureState;S.user={id:actor,email:'synthetic@example.invalid'};S.company={id:company,name:'가상 검증 상사'};S.members=[{user_id:actor,company_id:company,role:'dealer',display_name:'가상 검증 딜러',active:true}];
  S.client={auth:{getSession:async()=>({data:{session:{access_token:token,user:{id:actor}}},error:null}),signOut:async()=>({error:null})},from(table){
   const chain={select(){return chain},eq(){return chain},in(){return chain},order(){return chain},limit(){return chain},maybeSingle(){return chain},single(){return chain},then(resolve,reject){
    if(table==='zc_datasets')return Promise.resolve({data:[{dataset:'cars',owner_id:actor,payload:window.__encarFixtureCars,revision:1},{dataset:'covers',owner_id:actor,payload:{},revision:1}],error:null}).then(resolve,reject);
    if(table==='zc_media')return Promise.resolve({data:[],error:null}).then(resolve,reject);
    return Promise.reject(Error('Unexpected browser fixture table '+table)).then(resolve,reject);
   }};return chain;
  },rpc:async()=>({data:[],error:null})};
  document.getElementById('zc-cloud-gate').hidden=true;openVehicle('encar-car-1');
 },{actor:ACTOR,company:COMPANY,alias:ALIAS,token:TOKEN,plate:PLATE,secondPlate:SECOND_PLATE});
 await page.locator(BUTTON).waitFor({state:'visible'});assert.equal(await page.locator(BUTTON).isDisabled(),true,'Local/demo login must not enable an online lookup');
 await page.evaluate(()=>{window.__encarFixtureState.ready=true;document.getElementById('zc86-topbar').hidden=false;});await page.locator(BUTTON+':not([disabled])').waitFor();
 f.reply=(body,status=200)=>f.responses.push({body,status});return f;
}
async function lookup(f,body){f.reply(body);const popupPromise=f.context.waitForEvent('page');await f.page.locator(BUTTON).click();const popup=await popupPromise;await f.page.locator(BUTTON+':not([disabled])').waitFor();return popup;}
async function closed(popup){if(!popup.isClosed())await popup.waitForEvent('close');assert.equal(popup.isClosed(),true);}
async function assertLinks(f,expected){
 const actual=await f.page.locator(LINKS).evaluateAll(elements=>elements.map(a=>({text:a.textContent,url:a.href,target:a.target,rel:a.rel})));
 assert.deepEqual(actual.map(a=>a.url),expected);for(const a of actual){assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');}
}
async function position(f){
 const geometry=await f.page.evaluate(()=>{const rect=selector=>{const b=document.querySelector(selector).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};return {button:rect('.snote-encar-button'),meta:rect('#vehicle-meta'),header:rect('.vehicle-header'),close:rect('.detail-close'),overflow:document.documentElement.scrollWidth>innerWidth,modalOverflow:document.querySelector('.vehicle-modal').scrollWidth>document.querySelector('.vehicle-modal').clientWidth};});
 assert(geometry.button.y>=geometry.meta.bottom,'Button must sit below the actual vehicle metadata');assert(geometry.button.x>=geometry.header.x&&geometry.button.right<=geometry.header.right,'Button must remain inside the actual detail header');assert(geometry.button.right<=geometry.close.x||geometry.button.bottom<=geometry.close.y||geometry.button.y>=geometry.close.bottom,'Encar button must not overlap the detail close button');assert.equal(geometry.overflow,false);assert.equal(geometry.modalOverflow,false);
}
async function heldJson(f,body){
 await f.page.evaluate(()=>{
  if(!window.__encarNativeFetch)window.__encarNativeFetch=window.fetch.bind(window);
  window.__encarJsonWaiting=false;window.__encarReleaseJson=null;
  window.fetch=async(...args)=>{
   const response=await window.__encarNativeFetch(...args);if(String(args[0])!=='/api/encar')return response;
   return new Proxy(response,{get(target,key){if(key==='json')return async()=>{const body=await target.json();window.__encarJsonWaiting=true;await new Promise(resolve=>window.__encarReleaseJson=resolve);return body;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  };
 });
 f.reply(body);const popupPromise=f.context.waitForEvent('page');await f.page.locator(BUTTON).click();const popup=await popupPromise;await f.page.waitForFunction(()=>window.__encarJsonWaiting);assert.equal(await popup.evaluate(()=>opener===null),true,'Waiting popup must disconnect its opener before any API result');return popup;
}
async function releaseJson(f){await f.page.evaluate(()=>{window.__encarReleaseJson();window.fetch=window.__encarNativeFetch;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function finish(f){assert.deepEqual(f.external,[],'No external requests are allowed');assert.deepEqual(f.unexpected,[],'No unrelated API requests are allowed');assert.deepEqual(f.errors,[],'Actual index must have no uncaught browser errors');assert.equal(f.responses.length,0);await f.context.close();}

(async()=>{
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  {
   const f=await fixture(),p=f.page;await position(f);assert.equal(await p.locator('.snote-encar-tools').count(),1);await p.screenshot({path:path.join(ARTIFACTS,'encar-detail-1440.png')});
   let popup=await lookup(f,found());await popup.waitForURL(listing().sellerUrl);assert.equal(await popup.evaluate(()=>opener===null),true);assert.deepEqual(f.requests[0],{plate:PLATE,candidateIds:[]});await assertLinks(f,[listing().sellerUrl,listing().trustedUrl]);await popup.close();
   assert.deepEqual(await p.evaluate(plate=>Object.keys(JSON.parse(localStorage.getItem('snote.encar.candidate.v1:'+plate))).sort(),PLATE),['at','ids','plate']);
   console.log('PASS real index desktop/header placement, local login disabled, online ready enabled, verified single seller popup and trusted fallback links');

   const choices=[listing('43000003','43000004','<img src=x onerror=alert(1)>'),listing('43000005',null,'두 번째 가상 광고')];
   const navigations=f.navigations.length;popup=await lookup(f,found(PLATE,choices));await closed(popup);assert.equal(f.navigations.length,navigations,'Multiple results must not choose an advertisement automatically');
   await assertLinks(f,[choices[0].sellerUrl,choices[0].trustedUrl,choices[1].sellerUrl]);assert.equal(await p.locator('.snote-encar-results img').count(),0);assert.match(await p.locator('.snote-encar-result').first().textContent(),/<img src=x onerror=alert\(1\)>/);
   const trustedPromise=f.context.waitForEvent('page');await p.getByRole('link',{name:'엔카 믿고'}).click();const trusted=await trustedPromise;await trusted.waitForURL(choices[0].trustedUrl);assert.equal(await trusted.evaluate(()=>opener===null),true);await trusted.close();
   console.log('PASS multiple chooser avoids auto-navigation, renders model text safely, and opens only its verified trusted URL');

   await p.evaluate(()=>{window.__encarOriginalOpen=window.open;window.open=()=>null;});f.reply(found());await p.locator(BUTTON).click();await p.locator(BUTTON+':not([disabled])').waitFor();assert.match(await p.locator(NOTE).textContent(),/아래 링크/);await assertLinks(f,[listing().sellerUrl,listing().trustedUrl]);await p.evaluate(()=>window.open=window.__encarOriginalOpen);
   popup=await lookup(f,found(PLATE,[{...listing(),sellerUrl:'https://untrusted.example/cars/detail/43000001'}]));await closed(popup);assert.equal(await p.locator(LINKS).count(),0);assert.equal(await p.locator(NOTE).getAttribute('data-error'),'true');
   popup=await lookup(f,found(SECOND_PLATE));await closed(popup);assert.equal(await p.locator(LINKS).count(),0);assert.equal(await p.locator(NOTE).getAttribute('data-error'),'true');
   console.log('PASS simulated popup blocking keeps clickable verified fallback links; foreign URLs and a different response plate never navigate');

   popup=await heldJson(f,found());const beforeSwitch=f.navigations.length;await p.evaluate(()=>openVehicle('encar-car-2'));await closed(popup);await releaseJson(f);assert.equal(await p.locator(LINKS).count(),0);assert.equal(await p.locator(NOTE).textContent(),'');assert.equal(f.navigations.length,beforeSwitch);await p.locator(BUTTON+':not([disabled])').waitFor();
   console.log('PASS real car switch cancels its waiting tab and a late parsed response cannot insert links or open the previous car advertisement');

   await p.evaluate(()=>window.zc86Cloud.reload());await p.locator('#vehicle-overlay.open').waitFor();await p.locator(BUTTON+':not([disabled])').waitFor();assert.equal(await p.evaluate(()=>window.zc86Cloud.ready),true);await position(f);
   console.log('PASS actual cloud reload restores the online button after ready=false metadata rendering');

   popup=await heldJson(f,found(SECOND_PLATE));const beforeLogout=f.navigations.length;await p.evaluate(()=>window.zc86Cloud.signOut());await closed(popup);await releaseJson(f);assert.equal(await p.locator(LINKS).count(),0);assert.equal(f.navigations.length,beforeLogout);assert.equal(await p.locator(BUTTON).isDisabled(),true);assert.equal(await p.evaluate(()=>currentUser),null);
   console.log('PASS actual cloud logout cancels the popup and ignores late lookup content without navigating or leaking links');await finish(f);
  }
  for(const width of [390,320]){
   const f=await fixture(width),p=f.page;await position(f);const popup=await lookup(f,found());await popup.waitForURL(listing().sellerUrl);await popup.close();await position(f);await p.screenshot({path:path.join(ARTIFACTS,'encar-detail-'+width+'.png')});
   await p.locator('.detail-close').click();assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'true');assert.equal(await p.locator(LINKS).count(),0);await finish(f);console.log('PASS '+width+'px real detail header/button/verified links fit without overflow and the existing close button clears the result');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
