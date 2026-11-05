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
const ENCAR_WORDMARK_PATH='/assets/encar-wordmark.png';
const MANUAL='.snote-encar-manual',ADDRESS='#snote-encar-manual-url',COPY='.snote-encar-copy',COPY_FALLBACK='.snote-encar-copy-fallback';
const REQUEST_ID='12345678-1234-4234-8234-123456789abc';
const listing=(id='43000001',trustedId='43000002',model='가상 검증 차량')=>({id,model,sellerUrl:'https://fem.encar.com/cars/detail/'+id,trustedId,trustedUrl:trustedId?'https://fem.encar.com/cars/detail/'+trustedId:null});
const found=(plate=PLATE,listings=[listing()])=>({status:listings.length>1?'multiple':'found',plate,listings,verifiedAt:'2026-11-02T00:00:00.000Z'});
const unverified=(plate=PLATE,code='SEARCH_NO_RESULTS')=>({plate,status:'unverified',listings:[],verifiedAt:null,diagnostics:{code,requestId:REQUEST_ID,searchCount:3,resultCount:0,candidateCount:0,checkedCount:0,rejected:{plateMismatch:0,notAdvertising:0,notFound:0},plate,id:'43000001',url:listing().sellerUrl,token:'PRIVATE_TOKEN'}});
let browser;
fs.mkdirSync(ARTIFACTS,{recursive:true});

async function releaseLabels(page,{loggedIn=false,width=1440}={}){
 const release=await page.evaluate(()=>({version:document.documentElement.getAttribute('data-snote-release'),apiVersion:window.SnoteRelease?.version,frozen:Object.isFrozen(window.SnoteRelease),labels:[...document.querySelectorAll('[data-snote-version]')].map(element=>({text:element.textContent,prefix:element.getAttribute('data-snote-version-prefix')||'',suffix:element.getAttribute('data-snote-version-suffix')||''})),scripts:[...document.scripts].filter(script=>script.src&&new URL(script.src).pathname==='/assets/release-info.js').map(script=>script.src)}));
 assert.match(release.version,/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/);assert.equal(release.apiVersion,release.version);assert.equal(release.frozen,true);assert.equal(release.labels.length,4);assert.equal(release.scripts.length,1);assert.equal(new URL(release.scripts[0]).searchParams.get('v'),release.version);
 for(const label of release.labels)assert.equal(label.text,label.prefix+'v'+release.version+label.suffix);
 assert.equal(await page.locator('.auth-topline [data-snote-version]').textContent(),'v'+release.version+' · ONLINE');
 assert.equal(await page.locator('.topright [data-snote-version]').count(),0);assert.equal(await page.locator('.sidebar .snote-sidebar-version').textContent(),'v'+release.version);assert.equal(await page.locator('#mobile-drawer .snote-sidebar-version').textContent(),'v'+release.version);
 assert.equal(await page.locator('.snote-login-footer [data-snote-version]').textContent(),'v'+release.version,'The runtime-created cloud login footer must use the same canonical version');
 if(loggedIn){
  assert.equal(await page.locator('#auth-shell').evaluate(element=>element.classList.contains('hidden')),true);
  assert.equal(await page.locator('.sidebar .snote-sidebar-version').isVisible(),width>760,'The version belongs at the sidebar bottom');assert.equal(await page.locator('#snote-weather').isVisible(),true);
  await page.locator('#snote-calculator-trigger:not([disabled])').waitFor();
  const calculator=await page.locator('#snote-calculator-trigger').boundingBox(),profile=await page.locator('#snote-profile-trigger').boundingBox();assert(calculator&&profile);assert(calculator.x+calculator.width<=profile.x+1,'The version label must not disturb the calculator/profile placement');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 return release.version;
}

async function releaseLifecycle(page,version){
 await page.evaluate(()=>{
  window.__releaseOriginal=window.SnoteRelease;
  const direct=document.createElement('span');direct.id='release-fixture-direct';direct.hidden=true;direct.setAttribute('data-snote-version','');direct.setAttribute('data-snote-version-prefix','[');direct.setAttribute('data-snote-version-suffix',']');direct.textContent='버전 확인 중';document.body.append(direct);
  const subtree=document.createElement('div');subtree.id='release-fixture-subtree';subtree.hidden=true;const nested=document.createElement('span');nested.setAttribute('data-snote-version','');nested.setAttribute('data-snote-version-suffix',' · 추가 표시');nested.textContent='버전 확인 중';subtree.append(nested);document.body.append(subtree);
 });
 await page.waitForFunction(version=>document.getElementById('release-fixture-direct').textContent==='[v'+version+']'&&document.querySelector('#release-fixture-subtree [data-snote-version]').textContent==='v'+version+' · 추가 표시',version);
 await page.evaluate(async()=>{const original=[...document.scripts].find(script=>script.src&&new URL(script.src).pathname==='/assets/release-info.js');const duplicate=document.createElement('script');duplicate.src=original.src;await new Promise((resolve,reject)=>{duplicate.onload=resolve;duplicate.onerror=reject;document.body.append(duplicate);});duplicate.remove();});
 assert.equal(await page.evaluate(()=>window.SnoteRelease===window.__releaseOriginal),true,'Duplicate script loading must keep the same release synchronizer');
 await page.evaluate(()=>{document.getElementById('release-fixture-direct').remove();document.getElementById('release-fixture-subtree').remove();document.querySelector('.auth-topline [data-snote-version]').textContent='버전 확인 중';window.SnoteRelease.refresh();});
 await releaseLabels(page,{loggedIn:true});
 console.log('PASS actual HTML canonical release synchronizes all three original badges, late added markers/subtrees, and duplicate-script refresh without changing app state');
}

async function fixture(width=1440,savedCars=null,{primaryColor=null,weather=null}={}){
 const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
 const f={context,page,requests:[],navigations:[],external:[],unexpected:[],errors:[],responses:[],dialogs:[],dialogAnswers:[],unexpectedDialogs:[]};
 const answerDialog=async dialog=>{
  const type=dialog.type(),message=dialog.message(),expected=f.dialogAnswers.shift();
  const answer=expected?.answer??(type!=='confirm');
  f.dialogs.push({type,message,answer});
  if(expected){if(expected.type!==type||!expected.message.test(message))f.unexpectedDialogs.push({type,message});}
  else f.unexpectedDialogs.push({type,message});
  if(answer)await dialog.accept();else await dialog.dismiss();
 };
 f.answerConfirm=(answer,message=/^변경사항을 저장하시겠습니까\?\n확인: 저장 후 닫기 · 취소: 저장하지 않고 닫기$/)=>f.dialogAnswers.push({type:'confirm',message,answer});
 f.answerAlert=(message)=>f.dialogAnswers.push({type:'alert',message,answer:true});
 context.on('page',opened=>{opened.on('pageerror',error=>f.errors.push(error.message));opened.on('dialog',answerDialog);});
 page.on('pageerror',error=>f.errors.push(error.message));page.on('dialog',answerDialog);page.setDefaultTimeout(15000);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin==='https://fem.encar.com'&&/^\/cars\/detail\/4300000[1-6]$/.test(url.pathname)){
   f.navigations.push(url.href);return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><title>가상 엔카 광고</title><p>로컬 검증용 광고 응답</p>'});
  }
  if(url.origin!==ORIGIN){f.external.push(url.href);return route.abort();}
  if(url.pathname==='/api/weather')return route.fulfill({status:weather?.ok===false?503:200,contentType:'application/json',body:JSON.stringify(weather||{ok:true,temperature:18.4,code:0,region:'합성 지역',source:'MET Norway'})});
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
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__encarFixtureAuth&&!!window.SnoteEncarLink&&!!window.SnoteRelease);await page.evaluate(()=>window.__encarFixtureAuth);f.release=await releaseLabels(page,{width});
 await page.evaluate(async({actor,company,alias,token,plate,secondPlate,savedCars,primaryColor})=>{
  await enterWorkspace({username:alias,name:'가상 검증 딜러',role:'dealer',company:'가상 검증 상사',employeeNo:'TEST',union:''});
  cars=[{id:'encar-car-1',ownerId:alias,model:'가상 검증 차량 1',plate,year:2026,km:'10,000',buy:1000,sell:1200,status:'판매중'},{id:'encar-car-2',ownerId:alias,model:'가상 검증 차량 2',plate:secondPlate,year:2026,km:'20,000',buy:1500,sell:1700,status:'판매중'}];
  if(savedCars)cars=structuredClone(savedCars);
  if(typeof primaryColor==='string')cars[0].color=primaryColor;
  const wire=cars.map(SnoteMoney.storeCar);cars=normalizedCars(wire,alias);localStorage.setItem(carsStoreKey(alias),JSON.stringify(wire));window.__encarFixtureCars=structuredClone(wire);
  window.__encarFixtureWrites=[];window.__encarFixtureRevision=0;window.__encarFixtureWriteMode='ok';window.__encarFixtureWriteWaiting=false;window.__encarFixtureReleaseWrite=null;window.__encarFixtureWriteFailures=0;
  const S=window.__encarFixtureState;S.user={id:actor,email:'synthetic@example.invalid'};S.company={id:company,name:'가상 검증 상사'};S.members=[{user_id:actor,company_id:company,role:'dealer',display_name:'가상 검증 딜러',active:true}];
  S.client={auth:{getSession:async()=>({data:{session:{access_token:token,user:{id:actor}}},error:null}),signOut:async()=>({error:null})},from(table){
   const chain={select(){return chain},eq(){return chain},in(){return chain},order(){return chain},limit(){return chain},maybeSingle(){return chain},single(){return chain},then(resolve,reject){
    if(table==='zc_datasets')return Promise.resolve({data:[{dataset:'cars',owner_id:actor,payload:structuredClone(window.__encarFixtureCars),revision:window.__encarFixtureRevision},{dataset:'covers',owner_id:actor,payload:{},revision:1}],error:null}).then(resolve,reject);
    if(table==='zc_media')return Promise.resolve({data:[],error:null}).then(resolve,reject);
    if(table==='zc_customers')return Promise.resolve({data:null,error:null}).then(resolve,reject);
    return Promise.reject(Error('Unexpected browser fixture table '+table)).then(resolve,reject);
   }};return chain;
  },rpc:async(name,args)=>{
   if(name!=='zc_write_dataset'||args.p_dataset!=='cars'||args.p_company!==company||args.p_owner!==actor)throw Error('Unexpected browser fixture RPC');
   if(args.p_expected!==window.__encarFixtureRevision)return{data:null,error:{code:'CONFLICT',message:'CONFLICT'}};
   if(window.__encarFixtureWriteMode==='hold'){
    window.__encarFixtureWriteWaiting=true;await new Promise(resolve=>window.__encarFixtureReleaseWrite=resolve);window.__encarFixtureWriteWaiting=false;
   }
   if(window.__encarFixtureWriteMode==='fail'){window.__encarFixtureWriteFailures++;return{data:null,error:{message:'SYNTHETIC_DB_WRITE_FAILED'}};}
   window.__encarFixtureCars=structuredClone(args.p_payload);window.__encarFixtureWrites.push(structuredClone(args));
   return{data:++window.__encarFixtureRevision,error:null};
  }};
  document.getElementById('zc-cloud-gate').hidden=true;
 },{actor:ACTOR,company:COMPANY,alias:ALIAS,token:TOKEN,plate:PLATE,secondPlate:SECOND_PLATE,savedCars,primaryColor});
 await releaseLabels(page,{loggedIn:true,width});
 if(width===1440)await page.screenshot({path:path.join(ARTIFACTS,'release-header-1440.png')});
 await page.evaluate(()=>openVehicle('encar-car-1'));
 await page.locator(BUTTON).waitFor({state:'visible'});assert.equal(await page.locator(BUTTON).isDisabled(),true,'Local/demo login must not enable an online lookup');
 await assertEncarLogo(page);
 await page.evaluate(()=>{window.__encarFixtureState.ready=true;document.getElementById('zc86-topbar').hidden=false;});await page.locator(BUTTON+':not([disabled])').waitFor();
 await page.locator('#vehicle-overlay .vehicle-detail-frame').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))});f.reply=(body,status=200)=>f.responses.push({body,status});return f;
}
async function assertEncarLogo(page){
 const logo=page.locator(BUTTON+' img.snote-encar-wordmark');assert.equal(await logo.count(),1);assert.equal(await page.locator(BUTTON+' svg').count(),0);assert.equal(await logo.getAttribute('aria-hidden'),'true');assert.equal(await logo.getAttribute('alt'),'');assert.equal(await page.locator(BUTTON).getAttribute('title'),null,'The native tooltip must not duplicate the custom tooltip');
 const image=await logo.evaluate(async element=>{await element.decode();const box=element.getBoundingClientRect();return{path:new URL(element.src).pathname,naturalWidth:element.naturalWidth,naturalHeight:element.naturalHeight,width:box.width,height:box.height,fit:getComputedStyle(element).objectFit};});assert.equal(image.path,ENCAR_WORDMARK_PATH);assert(image.naturalWidth/image.naturalHeight>2,'The Encar wordmark must keep its wide proportions');assert(Math.abs(image.width-40)<.01);assert(Math.abs(image.height-20)<.01);assert.equal(image.fit,'contain');
}
async function lookup(f,body,status=200){f.reply(body,status);const popupPromise=f.context.waitForEvent('page');await f.page.locator(BUTTON).click();const popup=await popupPromise;await f.page.locator(BUTTON+':not([disabled])').waitFor();await assertEncarLogo(f.page);return popup;}
async function verifyAddress(f,body,address){f.reply(body);const popupPromise=f.context.waitForEvent('page');await f.page.locator(ADDRESS).fill(address);await f.page.locator(MANUAL+' button').click();const popup=await popupPromise;await f.page.locator(BUTTON+':not([disabled])').waitFor();return popup;}
async function closed(popup){if(!popup.isClosed())await popup.waitForEvent('close');assert.equal(popup.isClosed(),true);}
async function assertLinks(f,expected){
 const actual=await f.page.locator(LINKS).evaluateAll(elements=>elements.map(a=>({text:a.textContent,url:a.href,target:a.target,rel:a.rel})));
 assert.deepEqual(actual.map(a=>a.url),expected);for(const a of actual){assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');}
}
async function assertStoredLinks(f){const expected=await f.page.evaluate(()=>{const c=cars.find(c=>c.id===activeCarId);return(c?.encarLinks?.listings||[]).flatMap(item=>[item.sellerUrl,item.trustedUrl].filter(Boolean));});await assertLinks(f,expected);}
async function position(f){
 await f.page.locator('#vehicle-overlay .vehicle-detail-frame').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})))});
 const geometry=await f.page.evaluate(()=>{const rect=selector=>{const b=document.querySelector(selector).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};const close=document.querySelector('#vehicle-overlay .detail-close'),bounds=close.getBoundingClientRect(),style=getComputedStyle(close),modal=document.querySelector('#vehicle-overlay .vehicle-modal'),frame=document.querySelector('#vehicle-overlay .vehicle-detail-frame'),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;return {button:rect('.snote-encar-button'),actions:rect('#vehicle-header-actions'),actionRects:[...document.querySelectorAll('#vehicle-header-actions .vehicle-header-action')].map(element=>{const b=element.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};}),buttonInActions:close.closest('[role=\"dialog\"]').querySelector('#vehicle-header-actions').contains(document.querySelector('.snote-encar-button')),meta:rect('#vehicle-meta'),header:rect('.vehicle-header'),modal:rect('#vehicle-overlay .vehicle-modal'),close:rect('#vehicle-overlay .detail-close'),closePosition:style.position,closeRadius:style.borderRadius,closeBackground:style.backgroundColor,closeColor:style.color,closeHits:[[0,0],[-12,0],[12,0],[0,-12],[0,12],[-9,-9],[9,-9],[-9,9],[9,9]].map(([dx,dy])=>document.elementFromPoint(cx+dx,cy+dy)?.closest('.detail-close')===close),dialogContainsClose:close.closest('[role="dialog"]')===frame&&modal.closest('[role="dialog"]')===frame,frameOverflow:getComputedStyle(frame).overflow,modalOverflowStyle:getComputedStyle(modal).overflow,scrollTop:modal.scrollTop,viewportWidth:innerWidth,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,modalOverflow:modal.scrollWidth>modal.clientWidth};});
 assert.equal(geometry.buttonInActions,true,'The Encar action must share the title actions with quote, sale and save');assert(geometry.actions.x>=geometry.header.x&&geometry.actions.right<=geometry.header.right,'All title actions must remain inside the actual detail header');assert.equal(geometry.actionRects.length,6);for(const action of geometry.actionRects){assert(action.width>=39.99&&action.height>=39.99,'Every icon action must keep a useful pointer target: '+JSON.stringify(action));assert(action.x>=geometry.header.x&&action.right<=geometry.header.right);}for(let i=1;i<geometry.actionRects.length;i++)assert(geometry.actionRects[i-1].right<=geometry.actionRects[i].x+.5||geometry.actionRects[i-1].bottom<=geometry.actionRects[i].y+.5,'The icon actions must not overlap');assert(geometry.button.right<=geometry.close.x||geometry.button.x>=geometry.close.right||geometry.button.bottom<=geometry.close.y||geometry.button.y>=geometry.close.bottom,'Encar button must not overlap the detail close button');assert.equal(geometry.overflow,false);assert.equal(geometry.modalOverflow,false);
 assert.equal(geometry.closePosition,'absolute');assert.equal(geometry.close.width,34);assert.equal(geometry.close.height,34);assert.equal(geometry.closeRadius,'50%');assert.equal(geometry.closeColor,'rgb(255, 255, 255)');assert.equal(geometry.closeBackground,'rgb(223, 53, 70)');assert(Math.abs(geometry.close.x-(geometry.viewportWidth>760?geometry.modal.x-17:8))<1,'The close circle must straddle the drawer left edge or stay inside the mobile viewport');assert(Math.abs(geometry.close.y-(geometry.modal.y+(geometry.viewportWidth>760?18:12)))<1,'The close circle must remain near the drawer top');assert(geometry.close.x>=0&&geometry.close.right<=geometry.viewportWidth&&geometry.close.y>=0&&geometry.close.bottom<=geometry.viewportHeight,'The close target must fit inside the viewport');assert(geometry.closeHits.every(Boolean),'The close target center and edges must be clickable');assert.equal(geometry.dialogContainsClose,true);assert.equal(geometry.frameOverflow,'visible');assert.equal(geometry.modalOverflowStyle,'auto');
 return geometry;
}

async function vehicleCloseRegression(width,height=950){
 const f=await fixture(width),p=f.page;if(height!==950){await p.setViewportSize({width,height});await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}const before=await position(f);
 const isolated=await p.evaluate(()=>{const element=document.querySelector('#overlay .close'),read=()=>{const style=getComputedStyle(element);return{position:style.position,background:style.backgroundColor,color:style.color,radius:style.borderRadius};},enabled=read(),sheet=document.querySelector('link[href*="assets/vehicle-detail.css"]');sheet.disabled=true;const disabled=read();sheet.disabled=false;return{enabled,disabled};});assert.deepEqual(isolated.enabled,isolated.disabled,'The vehicle-specific close styling must not affect other popup controls');
 const choices=Array.from({length:6},(_,index)=>listing(String(43000001+index),null,'검증용 다중 광고 '+(index+1)+' · '+'상세 설명이 있는 차량 모델 '.repeat(2)));
 const popup=await lookup(f,found(PLATE,choices));await closed(popup);const expanded=await position(f);assert(expanded.header.height>before.header.height+100,'Six real result rows must substantially expand the header');assert(Math.abs(expanded.close.y-before.close.y)<1,'Adding result rows must not push the close button downward');
 await p.screenshot({path:path.join(ARTIFACTS,'vehicle-close-'+width+'x'+height+'-expanded.png')});
 await p.evaluate(()=>{const modal=document.querySelector('#vehicle-overlay .vehicle-modal');modal.scrollTop=Math.min(900,modal.scrollHeight-modal.clientHeight);});await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const scrolled=await position(f);assert(scrolled.scrollTop>0);assert(Math.abs(scrolled.close.y-expanded.close.y)<1,'The close button must remain at the same corner after scrolling the detail');await p.screenshot({path:path.join(ARTIFACTS,'vehicle-close-'+width+'x'+height+'-scrolled.png')});
 if(width===1440){await p.locator('#vehicle-overlay .detail-close').focus();await p.keyboard.press('Enter');}else await p.mouse.click(scrolled.close.x+scrolled.close.width/2,scrolled.close.y+scrolled.close.height/2);
 await p.waitForFunction(()=>document.querySelector('#vehicle-overlay').getAttribute('aria-hidden')==='true');assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'true');assert.equal(await p.evaluate(()=>activeCarId),null);await finish(f);console.log('PASS '+width+'x'+height+' vehicle close: left overlapping red close, unclipped 34px target, six-result expansion, 900px scrolling, quadrant hit tests, keyboard/click close and other-popup isolation');
}
async function heldJson(f,body,address){
 await f.page.evaluate(()=>{
  if(!window.__encarNativeFetch)window.__encarNativeFetch=window.fetch.bind(window);
  window.__encarJsonWaiting=false;window.__encarReleaseJson=null;
  window.fetch=async(...args)=>{
   const response=await window.__encarNativeFetch(...args);if(String(args[0])!=='/api/encar')return response;
   return new Proxy(response,{get(target,key){if(key==='json')return async()=>{const body=await target.json();window.__encarJsonWaiting=true;await new Promise(resolve=>window.__encarReleaseJson=resolve);return body;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  };
 });
 f.reply(body);const popupPromise=f.context.waitForEvent('page');if(address){await f.page.locator(ADDRESS).fill(address);await f.page.locator(MANUAL+' button').click();}else await f.page.locator(BUTTON).click();const popup=await popupPromise;await f.page.waitForFunction(()=>window.__encarJsonWaiting);await assertEncarLogo(f.page);assert.equal(await popup.evaluate(()=>opener===null),true,'Waiting popup must disconnect its opener before any API result');return popup;
}
async function releaseJson(f){await f.page.evaluate(()=>{window.__encarReleaseJson();window.fetch=window.__encarNativeFetch;});await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function finish(f){assert.deepEqual(f.external,[],'No external requests are allowed');assert.deepEqual(f.unexpected,[],'No unrelated API requests are allowed');assert.deepEqual(f.errors,[],'Actual index must have no uncaught browser errors');assert.deepEqual(f.unexpectedDialogs,[],'Every confirm/alert must have an explicit expected answer');assert.equal(f.dialogAnswers.length,0,'Every queued dialog answer must be used');assert.equal(f.responses.length,0);await f.context.close();}

async function vehicleSaveOnCloseRegression(){
 {
  const f=await fixture(),p=f.page;
  await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.deepEqual(f.dialogs,[],'An unchanged vehicle must close without a confirmation');
  await p.evaluate(()=>openVehicle('encar-car-1'));const original=await p.locator('#detail-extra').inputValue();
  await p.locator('#detail-extra').fill('저장하지 않을 임시 메모');f.answerConfirm(false);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0,'Cancel means discard, without a server write');await p.evaluate(()=>openVehicle('encar-car-1'));assert.equal(await p.locator('#detail-extra').inputValue(),original);
  await p.locator('#detail-extra').fill('서버 확인 후 닫기');await p.evaluate(()=>window.__encarFixtureWriteMode='hold');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
  assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false','The vehicle must remain open until the server acknowledges the write');assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra||''),original);
  await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),'서버 확인 후 닫기');assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);assert.equal(f.dialogs.length,2);
  await p.evaluate(()=>openVehicle('encar-car-1'));assert.equal(await p.locator('#detail-extra').inputValue(),'서버 확인 후 닫기');await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(f.dialogs.length,2,'Reopening a successfully saved vehicle must establish a clean baseline');
  await p.evaluate(()=>openVehicle('encar-car-1'));await p.locator('#detail-extra').fill('상단 저장 아이콘으로 저장');await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator('#vehicle-header-save').click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);assert.equal(f.dialogs.length,2,'The explicit save action must not ask the close confirmation');assert.equal(await p.locator('#vehicle-save-success').getAttribute('aria-hidden'),'true','The success animation must wait for the server acknowledgement');
  await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.locator('#vehicle-save-success.visible').waitFor();assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),'상단 저장 아이콘으로 저장');
  await p.evaluate(()=>{const S=window.__encarFixtureState,id='22222222-2222-4222-8222-222222222222';S.members.push({...S.members[0],user_id:id,role:'accountant'});S.user={...S.user,id};currentUser={...currentUser,username:'cld_'+id.replaceAll('-','').slice(0,18),name:'가상 검증 경리',role:'accountant'};document.body.classList.add('accountant-mode');openVehicle('encar-car-1');});await p.locator('#acct-edit-loan').fill('1234000');await p.locator('#acct-edit-lender').selectOption('KB캐피탈');assert.equal(await p.locator('#acct-edit-prestock').count(),0);await p.evaluate(()=>renderVehicle());
  assert.equal(await p.locator('#acct-edit-loan').inputValue(),'1,234,000');assert.equal(await p.locator('#acct-edit-lender').inputValue(),'KB캐피탈');assert.equal(await p.locator('#acct-edit-prestock').count(),0,'The removed prestock editor must stay absent on accountant rerender');f.answerConfirm(false);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});
  await finish(f);console.log('PASS vehicle close: clean/discard/ACK states, acknowledged header-save animation and accountant financing drafts preserved across rerender');
 }
 {
  const f=await fixture(),p=f.page;await p.locator('#detail-km').fill('');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('주행거리'));
  assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');assert.equal(await p.locator('#detail-km').inputValue(),'');assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);
  f.answerConfirm(false);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});await finish(f);console.log('PASS vehicle close keeps invalid input visible after a save validation failure and allows an explicit discard');
 }
 {
  const f=await fixture(),p=f.page;await p.locator('#detail-extra').fill('서버 재시도 메모');await p.evaluate(()=>window.__encarFixtureWriteMode='fail');f.answerConfirm(true);await p.locator('.detail-close').click();
  await p.waitForFunction(()=>{const S=window.__encarFixtureState;return window.__encarFixtureWriteFailures>0&&!S.saving&&S.queue.size>0;});assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false','A failed server write must keep the edited vehicle open');assert.equal(await p.locator('#detail-extra').inputValue(),'서버 재시도 메모');assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);
  await p.evaluate(()=>window.__encarFixtureWriteMode='ok');f.answerConfirm(true);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),'서버 재시도 메모');await finish(f);console.log('PASS vehicle close waits for a failed server save, preserves edits and retries successfully before closing');
 }
 {
  const f=await fixture(),p=f.page;const original=await p.locator('#detail-extra').inputValue();await p.locator('#detail-extra').fill('취소할 미확인 저장 시도');await p.evaluate(()=>window.__encarFixtureWriteMode='fail');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0&&!window.__encarFixtureState.saving);
  const record={version:1,plate:PLATE,verifiedAt:found().verifiedAt,listings:[listing()]};await p.evaluate(record=>{cars[0].encarLinks=record;cars[1].extra='다른 차량의 후속 수정';persistCars();},record);
  f.answerConfirm(false);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>cars[0].extra||''),original,'Discard after a failed save must restore this vehicle\'s attempted edits');
  const flushed=await p.evaluate(async()=>{window.__encarFixtureWriteMode='ok';return window.zc86Cloud.flush();});assert.equal(flushed.ok,true);const stored=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));assert.equal(stored[0].extra||'',original,'A later flush must not resurrect the discarded failed attempt');assert.deepEqual(stored[0].encarLinks,record,'Independent verified-link metadata must survive the rollback');assert.equal(stored[1].extra,'다른 차량의 후속 수정','Another vehicle\'s newer edits must survive the rollback');
  await p.evaluate(()=>{openVehicle('encar-car-1');window.__encarFixtureWriteMode='fail';window.__encarFixtureWriteFailures=0;});await p.locator('#detail-extra').fill('수동으로 되돌릴 실패 저장');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0&&!window.__encarFixtureState.saving);
  await p.locator('#detail-extra').fill(original);const prompts=f.dialogs.length;await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(f.dialogs.length,prompts,'Restoring the original input must close without asking again');
  assert.equal((await p.evaluate(async()=>{window.__encarFixtureWriteMode='ok';return window.zc86Cloud.flush();})).ok,true);assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra||''),original,'A clean close after manually restoring the original input must cancel the stale pending write');
  await p.evaluate(()=>{openVehicle('encar-car-1');window.__encarFixtureWriteMode='fail';window.__encarFixtureWriteFailures=0;});await p.locator('#detail-extra').fill('나중에 서버 확인을 받은 정상 메모 A');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>window.__encarFixtureWriteFailures>0&&!window.__encarFixtureState.saving);assert.equal((await p.evaluate(async()=>{window.__encarFixtureWriteMode='ok';return window.zc86Cloud.flush();})).ok,true);
  await p.locator('#detail-extra').fill('버릴 편집 메모 B');f.answerConfirm(false);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal((await p.evaluate(()=>window.zc86Cloud.flush())).ok,true);assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),'나중에 서버 확인을 받은 정상 메모 A','Discarding newer form input must not undo an older failed attempt that has since received a server acknowledgement');await finish(f);console.log('PASS failed-save discard/manual restoration cancel stale writes, preserve independent changes and retain a later acknowledged save');
 }
 {
  const f=await fixture(),p=f.page;await p.locator('#detail-extra').fill('먼저 저장하는 메모');await p.evaluate(()=>window.__encarFixtureWriteMode='hold');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
  await p.locator('#detail-extra').fill('서버 응답을 기다리며 추가한 메모');await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!window.__encarFixtureState.saving);await p.waitForTimeout(1250);
  assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false','New edits made while saving must not be discarded by closing on the older acknowledgement');assert.equal(await p.locator('#detail-extra').inputValue(),'서버 응답을 기다리며 추가한 메모');assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),'먼저 저장하는 메모');
  f.answerConfirm(true);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),'서버 응답을 기다리며 추가한 메모');await finish(f);console.log('PASS edits added during a pending save remain visible and require their own server acknowledgement');
 }
 {
  const f=await fixture(),p=f.page;await p.locator('#detail-extra').fill('이전 차량 저장 요청');await p.evaluate(()=>window.__encarFixtureWriteMode='hold');f.answerConfirm(true);await p.locator('.detail-close').click();await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
  await p.evaluate(()=>openVehicle('encar-car-2'));await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!window.__encarFixtureState.saving);await p.waitForTimeout(1250);
  assert.equal(await p.evaluate(()=>activeCarId),'encar-car-2');assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false','A late first-car save must not close the newly opened vehicle');assert.match(await p.locator('#vehicle-title').textContent(),/차량 2/);assert.equal(await p.locator('#vehicle-save-success').getAttribute('aria-hidden'),'true');await finish(f);console.log('PASS a late close/save acknowledgement cannot show success over or close a different vehicle');
 }
}

async function vehicleHeaderAndMediaRegression(width){
 const f=await fixture(width),p=f.page;await position(f);
 for(const label of ['엔카광고보기','견적서','판매진행','저장']){
  const action=p.getByRole('button',{name:label,exact:true});assert.equal(await action.count(),1);if(label==='엔카광고보기')await assertEncarLogo(p);else{assert.equal(await action.locator('svg').count(),1);assert.equal(await action.locator('svg').getAttribute('aria-hidden'),'true');}assert.equal(await action.getAttribute('title'),null,'Custom icon tooltips must not also trigger a native browser tooltip');assert(await action.getAttribute('data-tooltip'));
  assert.equal(await action.evaluate(element=>!!element.closest('#vehicle-header-actions')),true);
  await action.hover();await p.locator('#snote-icon-tooltip:not([hidden])').waitFor();assert.equal(await p.locator('#snote-icon-tooltip').textContent(),await action.getAttribute('data-tooltip'));assert.equal(await action.evaluate(element=>getComputedStyle(element,'::after').display),'none','Only the shared balloon should appear');
 }
 await p.locator('#detail-buy').fill('11000000');await p.locator('#detail-inventory-loan').fill('2000000');await p.locator('#detail-advertising').fill('200000');await p.locator('#detail-incomeTax').fill('300000');await p.locator('#detail-extra').fill('미디어 작업 중 보존할 편집');
 assert.equal(await p.locator('#vehicle-cash-investment').textContent(),'9,200,000원','The top cash-investment card must update immediately and exclude income tax');
 await p.getByRole('button',{name:'견적서',exact:true}).click();await p.locator('#quote-overlay.open').waitFor();assert.equal(await p.locator('#quote-plate').inputValue(),PLATE);await p.evaluate(()=>closeQuotePreview());await p.locator('#vehicle-overlay.open').waitFor();
 await p.evaluate(()=>window.snoteIntakeOpen=()=>{});await p.getByRole('button',{name:'판매진행',exact:true}).click();await p.locator('#zc72-sale-modal:not([hidden])').waitFor();assert.match(await p.locator('#zc72-car-title').textContent(),new RegExp(PLATE));await p.evaluate(()=>closeSaleProgress());await p.locator('#vehicle-overlay.open').waitFor();assert.deepEqual(f.dialogs,[],'Opening quote and sale forms must not trigger the vehicle close/save prompt');
 await p.evaluate(async alias=>{
  window.__encarFixtureState.ready=false;await dbReady;
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aROsAAAAASUVORK5CYII='),character=>character.charCodeAt(0)),blob=new Blob([bytes],{type:'image/png'});
  const records=Array.from({length:5},(_,index)=>({id:index===0?'photo-0\");window.__mediaInjected=true;//':'photo-'+index,carId:'encar-car-1',ownerId:alias,group:'photos',filename:index===0?'사진 <img src=x onerror=window.__mediaInjected=true>.png':'사진 '+index+'.png',createdAt:index+1,blob}));
  for(const [index,group] of ['registration','inspection1','inspection2'].entries())records.push({id:'document-'+group,carId:'encar-car-1',ownerId:alias,group,filename:'긴 문서 파일명 '+group+' <img onerror=window.__mediaInjected=true>.png',createdAt:index+10,blob});
  await updateDB(records);await refreshMedia();
 },ALIAS);
 await p.locator('.photo-thumb').nth(4).waitFor();assert.equal(await p.locator('.photo-thumb').count(),5);assert.equal(await p.locator('#photo-count').textContent(),'5 / 5');assert.equal(await p.locator('#photo-add').isDisabled(),true);assert.equal(await p.locator('#photo-grid .add-tile').count(),0);assert.equal(await p.locator('#photo-grid .zc-default-tile').count(),0);
 await p.locator('#photo-input').setInputFiles({name:'한도 초과 사진.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aROsAAAAASUVORK5CYII=','base64')});await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('실차 사진은 최대 5장'));assert.equal(await p.locator('.photo-thumb').count(),5,'The actual file input must also reject an upload beyond the five-photo limit');
 const media=await p.locator('.vehicle-media-grid').evaluate(element=>({columns:getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,panels:[...element.children].filter(child=>child.classList.contains('media-section')).length,overflow:element.scrollWidth>element.clientWidth}));assert.equal(media.columns,width>700?2:1);assert.equal(media.panels,2);assert.equal(media.overflow,false);
 assert.equal(await p.locator('#photo-grid .photo-tile').evaluateAll(tiles=>tiles.every(tile=>{const bounds=tile.getBoundingClientRect(),buttons=[...tile.querySelectorAll('.tile-controls button')].map(button=>button.getBoundingClientRect());return buttons.length===2&&buttons.every(button=>button.x>=bounds.x-.5&&button.right<=bounds.right+.5)&&buttons[0].right<=buttons[1].x+.5;})),true,'Compact cover/delete controls must remain inside each thumbnail without overlapping');
 await p.locator('.photo-thumb').first().focus();await p.keyboard.press('Enter');await p.locator('#zoom-overlay.open').waitFor();assert.equal(await p.evaluate(()=>zoomRecordId),'photo-0\");window.__mediaInjected=true;//');assert.match(await p.locator('#zoom-caption').textContent(),/<img src=x/);await p.keyboard.press('Escape');await p.locator('#zoom-overlay.open').waitFor({state:'hidden'});
 await p.getByRole('button',{name:'실차 사진 2 대표 사진으로 지정',exact:true}).click();assert.equal(await p.locator('.photo-tile').nth(1).locator('.cover-badge').count(),1);
 await p.locator('.doc-thumb').focus();await p.keyboard.press('Space');await p.locator('#zoom-overlay.open').waitFor();assert.equal(await p.evaluate(()=>zoomRecordId),'document-registration');await p.keyboard.press('Escape');
 await p.locator('#doc-tab-inspection').click();assert.equal(await p.locator('.doc-thumb').count(),2);assert.equal(await p.locator('#doc-tab-inspection').getAttribute('aria-selected'),'true');assert.equal(await p.locator('#registration-ocr-zone').evaluate(element=>element.classList.contains('visible')),false);assert.equal(await p.locator('#doc-grid .doc-filename').count(),0);
 await p.locator('.doc-thumb').nth(1).click();await p.locator('#zoom-overlay.open').waitFor();assert.equal(await p.evaluate(()=>zoomRecordId),'document-inspection2');await p.keyboard.press('Escape');
 f.answerConfirm(true,/^실차 사진를 삭제할까요\?$/);await p.getByRole('button',{name:'실차 사진 1 삭제',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.photo-thumb').length===4);assert.equal(await p.locator('#photo-add').isDisabled(),false);assert.equal(await p.locator('#photo-grid .add-tile').count(),1);
 assert.equal(await p.locator('#detail-extra').inputValue(),'미디어 작업 중 보존할 편집');assert.equal(await p.locator('#detail-buy').inputValue(),'11,000,000');assert.equal(await p.locator('#vehicle-cash-investment').textContent(),'9,200,000원','Media rerenders must preserve unsaved amounts and the live cash card');
 assert.equal(await p.evaluate(()=>window.__mediaInjected||false),false,'Untrusted media IDs and filenames must remain inert in rendered handlers and labels');assert.equal(await p.locator('#vehicle-overlay img[onerror]').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await position(f);await p.screenshot({path:path.join(ARTIFACTS,'vehicle-detail-compact-'+width+'.png')});
 await finish(f);console.log('PASS '+width+'px title icon actions open the correct forms; compact media panels preserve max-five, keyboard zoom, cover/delete, document tabs and inert filenames');
}

async function assertCompactVehicleForm(page,width){
 const layout=await page.evaluate(()=>{
  const visible=element=>element.getClientRects().length>0,rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const identity=document.querySelector('.vehicle-identity-grid'),costs=document.getElementById('car-cost-section');
  const fields=[...document.querySelectorAll('.vehicle-identity-grid>label>input,.vehicle-identity-grid>label>select:not([hidden]),#car-cost-section input,#car-cost-section .detail-lender-row select')].filter(visible).map(element=>({id:element.id,...rect(element),font:parseFloat(getComputedStyle(element).fontSize)}));
  const labels=[...document.querySelectorAll('.vehicle-identity-grid>label,#car-cost-section .cost-edit>label,#car-cost-section .detail-lender-row>label')].filter(visible).map(element=>({font:parseFloat(getComputedStyle(element).fontSize),overflow:element.scrollWidth>element.clientWidth+1}));
  const fullRows=['detail-model','detail-extra','detail-purchase-date','detail-vin'].map(id=>({id,...rect(document.getElementById(id).closest('label'))}));
  const summary=[...document.querySelectorAll('.detail-summary .sum-cell strong')].map(element=>{const range=document.createRange();range.selectNodeContents(element);return{text:element.textContent,overflow:element.scrollWidth>element.clientWidth+1,lines:range.getClientRects().length};});
  const trigger=document.getElementById('detail-color-trigger'),swatch=document.getElementById('detail-color-swatch'),triggerStyle=getComputedStyle(trigger);
  const colorBar={trigger:rect(trigger),swatch:rect(swatch),label:rect(trigger.closest('label')),reference:rect(document.getElementById('detail-km')),radius:parseFloat(triggerStyle.borderRadius),borderX:parseFloat(triggerStyle.borderLeftWidth)+parseFloat(triggerStyle.borderRightWidth),borderY:parseFloat(triggerStyle.borderTopWidth)+parseFloat(triggerStyle.borderBottomWidth)};
  const icons=[...document.querySelectorAll('#vehicle-header-actions svg')].map(svg=>{const box=svg.getBBox(),view=svg.viewBox.baseVal;return{label:svg.closest('button').getAttribute('aria-label'),decorative:svg.getAttribute('aria-hidden')==='true'&&svg.getAttribute('focusable')==='false',width:box.width,height:box.height,inside:box.x>=view.x&&box.y>=view.y&&box.x+box.width<=view.x+view.width&&box.y+box.height<=view.y+view.height,lengths:[...svg.querySelectorAll('path,circle,rect,line,polyline,polygon')].map(shape=>shape.getTotalLength())};});
  return{identity:rect(identity),identityColumns:getComputedStyle(identity).gridTemplateColumns.split(/\s+/).length,costColumns:getComputedStyle(costs).gridTemplateColumns.split(/\s+/).length,summaryColumns:getComputedStyle(document.querySelector('.detail-summary')).gridTemplateColumns.split(/\s+/).length,fields,labels,fullRows,summary,colorBar,icons,overflow:document.documentElement.scrollWidth>innerWidth||document.querySelector('.vehicle-modal').scrollWidth>document.querySelector('.vehicle-modal').clientWidth};
 });
 assert.equal(layout.identityColumns,width>=1100?2:width>760?4:2);assert.equal(layout.costColumns,width>=1100?2:width>760?4:2);assert.equal(layout.summaryColumns,width<=480?1:width<=760?2:3);assert.equal(layout.overflow,false);assert(layout.labels.every(label=>label.font>=11&&!label.overflow),'Compact labels must remain readable without horizontal clipping');
 for(const field of layout.fields){assert.equal(field.height,width>760?34:36,'Compact input height: '+field.id);assert(field.font>=(width>760?13:16),'Input text must remain readable: '+field.id);assert(field.width>40,'Every visible form control must retain usable width: '+field.id);}
 for(const row of layout.fullRows.filter(row=>width<=760||['detail-model','detail-extra'].includes(row.id)))assert(Math.abs(row.width-layout.identity.width)<1,'Long '+row.id+' fields must span the form row');
 assert(layout.summary.every(value=>!value.overflow&&value.lines===1),'Summary amounts must remain on one readable line inside their cards: '+JSON.stringify(layout.summary));
 const bar=layout.colorBar;assert(Math.abs(bar.trigger.width-bar.label.width)<1&&Math.abs(bar.trigger.width-bar.reference.width)<1,'The color bar must fill the same column width as the neighboring input');assert.equal(bar.trigger.height,bar.reference.height);assert.equal(bar.trigger.height,width>760?34:36);assert.equal(bar.radius,8);assert(Math.abs(bar.swatch.width-(bar.trigger.width-bar.borderX))<1&&Math.abs(bar.swatch.height-(bar.trigger.height-bar.borderY))<1,'The selected color must fill the bar inside its border');
 assert.equal(layout.icons.length,5);for(const icon of layout.icons){assert.equal(icon.decorative,true,'SVGs must stay decorative inside their named buttons: '+icon.label);assert(icon.width>5&&icon.height>5&&icon.inside,'The actual SVG geometry must remain visible inside the viewBox: '+icon.label);assert(icon.lengths.length>0&&icon.lengths.every(length=>Number.isFinite(length)&&length>0),'The action icon paths must render nonempty native SVG geometry: '+icon.label);}
}

async function vehiclePaletteRegression(width){
 const legacy='크림 화이트',basic=['','흰색','검정색','회색','은색','빨간색','파란색','남색','초록색','갈색','베이지색','노란색','주황색'];
 const f=await fixture(width,null,{primaryColor:legacy}),p=f.page,trigger=p.locator('#detail-color-trigger'),menu=p.locator('#detail-color-menu');
 await assertCompactVehicleForm(p,width);await p.screenshot({path:path.join(ARTIFACTS,'vehicle-form-v233-'+width+'-top.png')});await p.locator('#car-cost-section').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(ARTIFACTS,'vehicle-form-v233-'+width+'-costs.png')});
 if(width===320){
  const buy=await p.locator('#detail-buy').inputValue(),advertising=await p.locator('#detail-advertising').inputValue();await p.locator('#detail-buy').fill('100000000');await p.locator('#detail-advertising').fill('100000000');await assertCompactVehicleForm(p,width);assert.deepEqual(await p.locator('.detail-summary .sum-cell strong').allTextContents(),['100,000,000원','200,000,000원','-188,000,000원'],'Supported large amounts must remain exact and unabridged');await p.locator('.detail-summary').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(ARTIFACTS,'vehicle-form-v233-320-large-amounts.png')});await p.locator('#detail-buy').fill(buy);await p.locator('#detail-advertising').fill(advertising);await assertCompactVehicleForm(p,width);
 }
 if(width===390){await p.setViewportSize({width:600,height:950});await assertCompactVehicleForm(p,600);await p.setViewportSize({width,height:950});await assertCompactVehicleForm(p,width);}
 const registration=await p.evaluate(()=>{openAdd();const result={options:[...document.getElementById('new-color').options].map(option=>option.value),source:COLOR_OPTIONS.map(option=>option[0])};closeAdd();return result;});assert.deepEqual(registration.options,registration.source);assert(registration.options.length>basic.length*2,'The registration form must keep its original expanded color list');
 await p.evaluate(()=>{window.__detailColorEvents=[];for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.id==='detail-color')window.__detailColorEvents.push(type);});});assert.equal(await p.locator('#detail-color').inputValue(),legacy);assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),false);
 await trigger.click();await menu.waitFor({state:'visible'});assert.deepEqual(await menu.locator('[role=option]').evaluateAll(elements=>elements.map(element=>element.dataset.value)),[...basic,legacy]);assert.equal(await menu.locator('.detail-color-current').count(),1);assert.equal(await menu.locator('.detail-color-current').getAttribute('data-value'),legacy);assert.equal(await menu.locator('[aria-selected=true]').getAttribute('data-value'),legacy);
 const palette=await menu.evaluate(element=>{const r=element.getBoundingClientRect(),modalElement=element.closest('.vehicle-modal'),modal=modalElement.getBoundingClientRect(),style=getComputedStyle(element);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,modalLeft:modal.left+modalElement.clientLeft,modalRight:modal.left+modalElement.clientLeft+modalElement.clientWidth,modalTop:modal.top+modalElement.clientTop,modalBottom:modal.top+modalElement.clientTop+modalElement.clientHeight,columns:style.gridTemplateColumns.split(/\s+/).length,viewportWidth:innerWidth,viewportHeight:innerHeight,visibleOptionHits:[...element.querySelectorAll('[role=option]')].map(option=>({option,r:option.getBoundingClientRect()})).filter(({r:b})=>b.top>=r.top+2&&b.bottom<=r.bottom-2).every(({option,r:b})=>document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('[role=option]')===option)};});
 assert.equal(palette.columns,4);assert(palette.left>=palette.modalLeft&&palette.right<=palette.modalRight&&palette.top>=palette.modalTop&&palette.bottom<=palette.modalBottom,'The palette must fit inside the actual scroll clip, not just the viewport');assert(palette.left>=0&&palette.right<=palette.viewportWidth&&palette.top>=0&&palette.bottom<=palette.viewportHeight);assert.equal(palette.visibleOptionHits,true,'Every visible color option must be clickable through the real popup layers');
 assert.equal(await menu.locator('[data-value="흰색"] .color-bar').evaluate(element=>parseFloat(getComputedStyle(element).borderTopWidth)>=1),true,'White must retain a visible border');await p.screenshot({path:path.join(ARTIFACTS,'vehicle-palette-v233-'+width+'.png')});await menu.locator('.detail-color-current').click();assert.deepEqual(await p.evaluate(()=>window.__detailColorEvents),[]);assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),false,'Choosing the current legacy value must not create an edit');
 await trigger.focus();await p.keyboard.press('ArrowDown');await menu.waitFor({state:'visible'});await p.keyboard.press('Home');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'');await p.keyboard.press('End');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),legacy);await p.keyboard.press('ArrowLeft');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'주황색');await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),legacy);await p.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await p.evaluate(()=>document.activeElement.id),'detail-color-trigger');assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false','Escape must close the palette without closing the vehicle');
 await trigger.click();await p.locator('#vehicle-title').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false','A click outside the palette must close it');
 await trigger.click();await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');assert.equal(await p.locator('#detail-color').inputValue(),'흰색');const whiteBar=await trigger.evaluate(element=>{const style=getComputedStyle(element);return{border:parseFloat(style.borderTopWidth),style:style.borderTopStyle,color:style.borderTopColor,paint:getComputedStyle(document.getElementById('detail-color-swatch')).backgroundColor};});assert.equal(whiteBar.paint,'rgb(255, 255, 255)');assert(whiteBar.border>=1&&whiteBar.style==='solid'&&!['transparent','rgba(0, 0, 0, 0)','rgb(255, 255, 255)'].includes(whiteBar.color),'The full white bar must remain visible through its contrasting border');assert.deepEqual(await p.evaluate(()=>window.__detailColorEvents),['input','change']);assert.equal(await p.evaluate(()=>snoteVehicleHasChanges()),true);f.answerConfirm(false);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].color),legacy);
 await p.evaluate(()=>openVehicle('encar-car-1'));assert.equal(await p.locator('#detail-color').inputValue(),legacy);
 if(width===1440){
  await p.locator('#detail-extra').fill('색상값을 바꾸지 않는 저장');await p.locator('#vehicle-header-save').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].color),legacy,'Saving unrelated fields must retain the exact legacy color value');await p.evaluate(()=>openVehicle('encar-car-1'));await trigger.click();await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowDown');await p.keyboard.press('Space');assert.equal(await p.locator('#detail-color').inputValue(),'검정색');f.answerConfirm(true);await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].color),'검정색','An intentional basic-color selection must reach the server');
 }
 await finish(f);console.log('PASS '+width+'px compact aligned form, readable amounts, single-tooltip Encar wordmark and clipped-safe 12-color palette preserve legacy values, keyboard use and explicit save/discard');
}

module.exports={fixture,setBrowser(value){browser=value;},finish};
if(require.main===module)(async()=>{
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  {
   const f=await fixture(),p=f.page;await releaseLifecycle(p,f.release);await position(f);assert.equal(await p.locator('.snote-encar-tools').count(),1);await p.screenshot({path:path.join(ARTIFACTS,'encar-detail-1440.png')});
   let popup=await lookup(f,found());await popup.waitForURL(listing().sellerUrl);assert.equal(await popup.evaluate(()=>opener===null),true);assert.deepEqual(f.requests[0],{plate:PLATE,candidateIds:[]});await assertLinks(f,[listing().sellerUrl,listing().trustedUrl]);await popup.close();
   assert.deepEqual(await p.evaluate(plate=>Object.keys(JSON.parse(localStorage.getItem('snote.encar.candidate.v1:'+plate))).sort(),PLATE),['at','ids','plate']);
   console.log('PASS real index desktop/header placement, local login disabled, online ready enabled, verified single seller popup and trusted fallback links');

   const choices=[listing('43000003','43000004','<img src=x onerror=alert(1)>'),listing('43000005',null,'두 번째 가상 광고')];
   const navigations=f.navigations.length;popup=await lookup(f,found(PLATE,choices));await closed(popup);assert.equal(f.navigations.length,navigations,'Multiple results must not choose an advertisement automatically');
   await assertLinks(f,[choices[0].sellerUrl,choices[0].trustedUrl,choices[1].sellerUrl]);assert.equal(await p.locator('.snote-encar-results img').count(),0);assert.match(await p.locator('.snote-encar-result').first().textContent(),/<img src=x onerror=alert\(1\)>/);
   const trustedPromise=f.context.waitForEvent('page');await p.getByRole('link',{name:'엔카 믿고'}).click();const trusted=await trustedPromise;await trusted.waitForURL(choices[0].trustedUrl);assert.equal(await trusted.evaluate(()=>opener===null),true);await trusted.close();
   console.log('PASS multiple chooser avoids auto-navigation, renders model text safely, and opens only its verified trusted URL');

   await p.evaluate(()=>{window.__encarOriginalOpen=window.open;window.open=()=>null;});f.reply(found());await p.locator(BUTTON).click();await p.locator(BUTTON+':not([disabled])').waitFor();assert.match(await p.locator(NOTE).textContent(),/링크/);await assertLinks(f,[listing().sellerUrl,listing().trustedUrl]);await p.evaluate(()=>window.open=window.__encarOriginalOpen);
   popup=await lookup(f,found(PLATE,[{...listing(),sellerUrl:'https://untrusted.example/cars/detail/43000001'}]));await closed(popup);await assertStoredLinks(f);assert.equal(await p.locator(NOTE).getAttribute('data-error'),'true');
   popup=await lookup(f,found(SECOND_PLATE));await closed(popup);await assertStoredLinks(f);assert.equal(await p.locator(NOTE).getAttribute('data-error'),'true');
   console.log('PASS simulated popup blocking keeps clickable verified fallback links; foreign URLs and a different response plate never navigate');

   popup=await lookup(f,unverified());await closed(popup);assert.match(await p.locator(NOTE).textContent(),/검색에서 광고 후보/);assert.equal(await p.locator(MANUAL).evaluate(el=>el.open),false);
   await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__encarCopied=text;}}}));
   await p.locator(COPY).click();const copied=await p.evaluate(()=>window.__encarCopied);assert.equal(JSON.parse(copied).code,'SEARCH_NO_RESULTS');assert.equal(JSON.parse(copied).requestId,REQUEST_ID);assert(copied.length<600);assert.doesNotMatch(copied,/PRIVATE|12가3456|43000001|https:|token|url/i);
   await p.locator(MANUAL+' summary').click();await p.locator(ADDRESS).fill('https://fem.encar.com.evil.example/cars/detail/43000001');const badCount=f.requests.length,badPages=f.context.pages().length;await p.locator(MANUAL+' button').click();assert.match(await p.locator('.snote-encar-manual-error').textContent(),/HTTPS 주소/);assert.equal(f.requests.length,badCount);assert.equal(f.context.pages().length,badPages);
   const beforeManual=f.navigations.length;popup=await verifyAddress(f,unverified(PLATE,'PLATE_MISMATCH'),'https://m.encar.com/ca/carsearch/car_detailview.do?carid=43000002');await closed(popup);assert.equal(f.navigations.length,beforeManual);assert.deepEqual(f.requests.at(-1),{plate:PLATE,candidateIds:['43000002']});assert.match(await p.locator(NOTE).textContent(),/차량번호가 현재 차량과 일치하지/);
   await p.locator(MANUAL+' summary').click();popup=await heldJson(f,found(),'https://fem.encar.com/cars/detail/43000002?shared=yes');assert.equal(popup.url(),'about:blank');assert.equal(f.navigations.length,beforeManual);assert.deepEqual(f.requests.at(-1),{plate:PLATE,candidateIds:['43000002']});await releaseJson(f);await popup.waitForURL(listing().sellerUrl);await popup.close();
   assert.equal(await p.locator(MANUAL).isHidden(),true);assert.equal(await p.locator(COPY).isHidden(),true);assert.equal(await p.evaluate(()=>document.getElementById('vehicle-overlay').dataset.snoteHistoryDirty||''),'','Lookup-only address input must not mark the vehicle as an unsaved edit');
   const originalMileage=await p.locator('#detail-km').inputValue();await p.locator('#detail-km').fill('12345');assert.equal(await p.evaluate(()=>document.getElementById('vehicle-overlay').dataset.snoteHistoryDirty),'1','Actual vehicle edits must still be tracked');await p.locator('#detail-km').fill(originalMileage);await p.evaluate(()=>delete document.getElementById('vehicle-overlay').dataset.snoteHistoryDirty);
   console.log('PASS actual unverified diagnostics, privacy-safe clipboard, bad-host rejection, manual ID-only server validation with no direct navigation, and lookup/vehicle draft separation');

   const catalogCounts={catalogRequestCount:2,catalogPageCount:1,catalogRecordCount:4,catalogExactMatchCount:1,catalogFormCount:1,catalogPlateFieldCount:1,catalogLinkCount:1},beforeCatalog=f.navigations.length;
   popup=await lookup(f,{...found(),status:'error',diagnostics:{code:'CATALOG_INCOMPLETE',requestId:REQUEST_ID,...catalogCounts,plate:PLATE,url:listing().sellerUrl,body:'PRIVATE_CATALOG_BODY',token:'PRIVATE_TOKEN'}},502);await closed(popup);assert.equal(f.navigations.length,beforeCatalog);await assertStoredLinks(f);assert.match(await p.locator(NOTE).textContent(),/공개 차량 목록의 일부 조회/);
   assert.equal(await p.locator('.snote-encar-manual').evaluate(e=>e.hidden),false);assert.equal(await p.locator('.snote-encar-manual').evaluate(e=>e.open),false);
   await p.locator(COPY).click();const catalogCopy=await p.evaluate(()=>window.__encarCopied);assert.deepEqual(JSON.parse(catalogCopy),{service:'snote-encar',code:'CATALOG_INCOMPLETE',httpStatus:502,requestId:REQUEST_ID,...catalogCounts});assert.doesNotMatch(catalogCopy,/PRIVATE|12가3456|43000001|https:|token|body/i);
   popup=await lookup(f,unverified(PLATE,'CATALOG_NO_MATCH'));await closed(popup);assert.match(await p.locator(NOTE).textContent(),/공개 차량 목록에서 전체 차량번호/);assert.equal(await p.locator(MANUAL).isHidden(),false);assert.equal(await p.locator(MANUAL).evaluate(el=>el.open),false);assert.equal(f.navigations.length,beforeCatalog);await assertStoredLinks(f);
   console.log('PASS actual public-catalog incomplete/no-match replies use specific honest notes, do not open partial listings, and copy only safe numeric diagnostics');

   popup=await heldJson(f,found());const beforeSwitch=f.navigations.length;await p.evaluate(()=>openVehicle('encar-car-2'));await closed(popup);await releaseJson(f);assert.equal(await p.locator(LINKS).count(),0);assert.equal(await p.locator(NOTE).textContent(),'');assert.equal(f.navigations.length,beforeSwitch);await p.locator(BUTTON+':not([disabled])').waitFor();
   console.log('PASS real car switch cancels its waiting tab and a late parsed response cannot insert links or open the previous car advertisement');

   f.answerConfirm(true,/^서버에 저장된 데이터로 다시 불러올까요\? 현재 브라우저에서 서버에 반영되지 않은 변경사항은 사라집니다\.$/);await p.evaluate(()=>window.zc86Cloud.reload());await p.locator('#vehicle-overlay.open').waitFor();await p.locator(BUTTON+':not([disabled])').waitFor();assert.equal(await p.evaluate(()=>window.zc86Cloud.ready),true);await position(f);
   console.log('PASS actual cloud reload restores the online button after ready=false metadata rendering');

   popup=await heldJson(f,found(SECOND_PLATE));const beforeLogout=f.navigations.length;f.answerConfirm(true,/^온라인 계정에서 로그아웃할까요\?$/);await p.evaluate(()=>window.zc86Cloud.signOut());await closed(popup);await releaseJson(f);assert.equal(await p.locator(LINKS).count(),0);assert.equal(f.navigations.length,beforeLogout);assert.equal(await p.locator(BUTTON).isDisabled(),true);assert.equal(await p.evaluate(()=>currentUser),null);
   console.log('PASS actual cloud logout cancels the popup and ignores late lookup content without navigating or leaking links');await finish(f);
  }
  for(const width of [390,320]){
   const f=await fixture(width),p=f.page;await position(f);let popup=await lookup(f,found());await popup.waitForURL(listing().sellerUrl);await popup.close();await position(f);
   popup=await lookup(f,unverified());await closed(popup);await p.locator(MANUAL+' summary').click();const longAddress='https://fem.encar.com/cars/detail/43000002?shared='+'x'.repeat(1800);await p.locator(ADDRESS).fill(longAddress);await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('SIMULATED_CLIPBOARD_UNAVAILABLE');}}}));await p.locator(COPY).click();await p.locator(COPY_FALLBACK).waitFor({state:'visible'});assert.equal(await p.locator(COPY_FALLBACK).evaluate(el=>el.readOnly),true);assert.doesNotMatch(await p.locator(COPY_FALLBACK).inputValue(),/PRIVATE|12가3456|43000001|https:|token|url/i);await position(f);await p.screenshot({path:path.join(ARTIFACTS,'encar-detail-'+width+'.png')});
   popup=await verifyAddress(f,found(),longAddress);await popup.waitForURL(listing().sellerUrl);await popup.close();assert.deepEqual(f.requests.at(-1),{plate:PLATE,candidateIds:['43000002']});await position(f);
   await p.locator('.detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'true');assert.equal(await p.locator(LINKS).count(),0);assert.equal(await p.locator(ADDRESS).inputValue(),'');assert.equal(await p.locator(COPY_FALLBACK).inputValue(),'');await finish(f);console.log('PASS '+width+'px actual manual verifier/long URL/selected diagnostic fallback fit without overflow, verify through the server, and clear on close');
  }
  {
   const f=await fixture(),p=f.page;let popup=await lookup(f,found());await popup.waitForURL(listing().sellerUrl);await popup.close();
   await p.waitForFunction(()=>document.querySelector('.snote-encar-save-status').textContent.includes('서버에 저장했습니다'));
   const saved=await p.evaluate(()=>({cars:structuredClone(window.__encarFixtureCars),writes:structuredClone(window.__encarFixtureWrites)}));
   assert.equal(saved.writes.length,1);assert.equal(saved.writes[0].p_expected,0);assert.equal(saved.cars[0].encarLinks.listings[0].sellerUrl,listing().sellerUrl);assert.equal(saved.cars[0].encarLinks.listings[0].trustedUrl,listing().trustedUrl);assert.equal(saved.cars[1].encarLinks,undefined);
   const requestCount=f.requests.length;await p.locator('#vehicle-overlay .detail-close').click();await p.evaluate(()=>openVehicle('encar-car-1'));await p.locator(LINKS).first().waitFor();
   await assertLinks(f,[listing().sellerUrl,listing().trustedUrl]);assert.equal(f.requests.length,requestCount,'Reopening must show stored links without a lookup');
   f.reply(found());const popupPromise=f.context.waitForEvent('page');await p.getByRole('link',{name:'엔카 믿고',exact:true}).click();popup=await popupPromise;await popup.waitForURL(listing().trustedUrl);assert.deepEqual(f.requests.at(-1).candidateIds,['43000001','43000002']);await popup.close();
   await p.waitForFunction(()=>document.querySelector('.snote-encar-save-status').textContent.includes('서버에 저장했습니다'));await finish(f);
   const second=await fixture(390,saved.cars),mobile=second.page;await mobile.locator(LINKS).first().waitFor();await assertLinks(second,[listing().sellerUrl,listing().trustedUrl]);assert.equal(second.requests.length,0,'A new browser must restore links from its server dataset, not local candidate storage');
   assert.equal(await mobile.evaluate(plate=>localStorage.getItem('snote.encar.candidate.v1:'+plate),PLATE),null);await position(second);await mobile.screenshot({path:path.join(ARTIFACTS,'encar-saved-links-390.png')});
   popup=await lookup(second,found());await popup.waitForURL(listing().sellerUrl);await popup.close();assert.deepEqual(second.requests[0].candidateIds,['43000001'],'The main lookup must also reuse server-stored IDs');
   await mobile.waitForFunction(()=>document.querySelector('.snote-encar-save-status').textContent.includes('서버에 저장했습니다'));await finish(second);
   console.log('PASS actual cloud bridge writes scoped verified seller/trusted URLs, reopens without search, revalidates the selected trusted link, and restores in a clean second browser');
  }
  for(const width of [1440,390,320])await vehicleCloseRegression(width);
  await vehicleCloseRegression(320,640);
  await vehicleSaveOnCloseRegression();
  for(const width of [1440,390])await vehicleHeaderAndMediaRegression(width);
  for(const width of [1440,390,320])await vehiclePaletteRegression(width);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
