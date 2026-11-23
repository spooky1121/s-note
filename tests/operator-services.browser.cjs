'use strict';
// Actual operator assets with isolated synthetic API replies. No production data or paid probes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {boot}=require('./operator-console.browser.cjs');
const ART=process.env.OPERATOR_SERVICES_ARTIFACTS||'/workspace/work/operator-services-v2202/ui';fs.mkdirSync(ART,{recursive:true});
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aROsAAAAASUVORK5CYII=';
const LARGE_IMAGE='data:image/png;base64,'+Buffer.concat([Buffer.from(IMAGE.split(',')[1],'base64'),Buffer.alloc(2*1024*1024)]).toString('base64');
const AT='2026-11-23T12:00:00Z';
const idle=p=>p.waitForFunction(()=>document.querySelector('#operator-table-wrap').getAttribute('aria-busy')==='false');
async function select(p,view){await p.locator(`#operator-navigation [data-view=${view}]`).click();await idle(p);}
async function intercept(f,handler){await f.context.route('**/api/operator',async route=>{
 const request=route.request(),body=request.postDataJSON();if(!['services','account-avatar'].includes(body.action))return route.fallback();
 assert.equal(request.method(),'POST');assert.equal(request.headers().authorization,'Bearer synthetic-operator-token');f.requests.push(structuredClone(body));
 const value=await handler(body);await route.fulfill({status:value.status||200,contentType:'application/json',body:JSON.stringify(value.body||value)});
});}
function result(service,{page=1,query=''}={}){
 const account={displayName:'합성 운영 대상',email:'synthetic-services@example.invalid'},rows={
  sms:Array.from({length:21},(_,n)=>({at:AT,...account,model:'합성 차량 '+n,destination:'010-****-'+String(1200+n),type:'customer_input',status:n?'pending':'sent',success:true,customerSubmittedAt:n?null:AT})),
  encar:[{at:AT,...account,success:true,elapsedMs:1275,adId:'43123456',link:'https://untrusted.invalid/'},{at:AT,...account,success:false,elapsedMs:0,adId:'<img src=x onerror=alert(1)>'}],
  vision:[{at:AT,...account,success:true,elapsedMs:1850,stage:'document_text',imageBytes:2097152},{at:AT,...account,success:false,elapsedMs:null,stage:'provider_unavailable',imageBytes:0}],
  server:[{hour:AT,endpoint:'/api/synthetic',method:'POST',count:125,errors:3,bytes:4096,knownRequestBytes:1572864,knownRequestCount:90,knownResponseCount:100}]
 };
 const all=rows[service].filter(row=>!query||JSON.stringify(row).includes(query));
 return{ok:true,service,checkedAt:AT,metrics:[
  {key:'verified',label:service==='sms'?'충전 잔액':'기록된 요청',value:service==='sms'?8765.5:125,unit:service==='sms'?'원':'건',source:service==='sms'?'SOLAPI':'S-NOTE 처리 기록',asOf:AT},
  {key:'zero',label:'추가 차감',value:0,unit:'원',source:'합성 응답',asOf:AT},
  {key:'unavailable',label:'제공처 잔여 한도',value:null,unit:'건',source:'제공처',asOf:null,unavailableReason:'조회 권한이 없어 확인할 수 없습니다.'},
  ...(service==='server'?[{key:'traffic',label:'확인된 응답 크기',value:1572864,unit:'B',source:'합성 처리 기록',asOf:AT},{key:'capacity',label:'자료 저장량',value:1.5*1024**4,unit:'byte',source:'합성 처리 기록',asOf:AT},{key:'unknown_bytes',label:'미수집 요청량',value:null,unit:'B',source:'합성 처리 기록',asOf:null,unavailableReason:'수집되지 않은 정보입니다.'}]:[])
 ],notes:['수집 시작 이후 확인된 요청만 포함합니다.'],providerItems:service==='sms'?[{messageId:'synthetic-provider-1',at:AT,destination:'01000000000',type:'SMS',status:'성공'},{messageId:'synthetic-provider-2',at:AT,destination:'01000000001',type:'LMS',status:'대기'}]:[],items:all.slice((page-1)*20,page*20),total:all.length,page,pageSize:20};
}
async function invalidCredentials(browser){
 const f=await boot(browser,390),p=f.page;await p.locator('#operator-email').fill('wrong-synthetic@example.invalid');await p.locator('#operator-password').fill('IncorrectSyntheticPassword!');await p.locator('#operator-signin').click();await p.waitForFunction(()=>document.querySelector('#operator-login-message').dataset.tone==='error');
 assert.equal(await p.locator('#operator-login-message').textContent(),'계정 ID 또는 비밀번호를 확인해주세요.');assert.equal(await p.locator('#operator-password').inputValue(),'');assert.equal(await p.locator('#operator-app').isHidden(),true);assert.equal(f.requests.length,0);await f.finish();console.log('PASS invalid operator credentials use the exact account ID/password message and never request privileged data');
}
async function accounts(browser){
 const f=await boot(browser,1440,{resume:true}),p=f.page;await f.ready();
 Object.assign(f.state.accounts[0],{passwordConfigured:true,lastSignOutAt:AT,avatarAvailable:true});
 Object.assign(f.state.accounts[1],{passwordConfigured:false,avatarAvailable:true});
 Object.assign(f.state.accounts[2],{avatarAvailable:true});
 await intercept(f,body=>({ok:true,userId:body.userId,image:body.userId===f.state.accounts[0].userId?LARGE_IMAGE:body.userId===f.state.accounts[1].userId?'https://untrusted.invalid/track.png':null}));
 assert.equal(f.requests.some(x=>x.action==='services'),false,'Provider requests must start only when a service menu opens');
 await select(p,'accounts');assert.match(await p.locator('#operator-note').textContent(),/확인된 기록|수집되지 않은 과거 기록/);
 const titles=await p.locator('#operator-table thead th').allTextContents();
 for(const name of['계정ID','비밀번호','연락처','상사 · 권한','최근 로그인','최근 로그아웃'])assert(titles.some(x=>x.includes(name)),name);
 const rows=p.locator('#operator-table tbody tr');
 await rows.first().locator('.account-avatar img').waitFor();
 assert(LARGE_IMAGE.length>2*1024*1024);assert.equal(await rows.first().locator('.account-avatar img').getAttribute('src').then(value=>value.length),LARGE_IMAGE.length);await rows.first().locator('.account-avatar img').evaluate(image=>image.decode());assert.equal(await rows.first().locator('.account-avatar img').evaluate(image=>image.naturalWidth),1,'A valid registered PNG above the old 2MiB data URI cap must decode and display');
 assert.equal(await rows.nth(1).locator('.account-avatar img').count(),0,'External image addresses are never rendered');
 assert.match(await rows.first().textContent(),/설정됨|2026/);assert.match(await rows.nth(1).textContent(),/미설정/);assert.match(await rows.nth(2).textContent(),/확인 불가/);
 assert.equal(await rows.first().locator('.account-email').textContent(),f.state.accounts[0].email);
 await rows.first().getByRole('button',{name:'비밀번호 변경',exact:true}).click();
 const password=p.locator('#operator-account-auth-form [name=password]');await password.waitFor();await password.fill('SyntheticNewPassword!987');
 await p.getByRole('button',{name:'로그인 정보 변경',exact:true}).click();await p.locator('#snote-message-dialog[open][data-message-kind=confirm]').waitFor();
 assert.equal(f.state.mutations.filter(x=>x.action==='auth-update').length,0,'Password changes require explicit confirmation');
 await p.locator('#snote-message-dialog [data-message-cancel]').click();assert.equal(f.state.mutations.filter(x=>x.action==='auth-update').length,0);
 await p.getByRole('button',{name:'로그인 정보 변경',exact:true}).click();await p.locator('#snote-message-dialog[open] [data-message-accept]').click();
 await p.locator('#operator-drawer').waitFor({state:'hidden'});assert.equal(f.state.mutations.at(-1).action,'auth-update');
 assert.equal(await p.evaluate(()=>[localStorage,sessionStorage].some(storage=>Object.values(storage).some(value=>value.includes('SyntheticNewPassword!987')))),false);
 await p.screenshot({path:path.join(ART,'accounts-1440.png')});await f.finish();console.log('PASS account ID/status/contact/company/login/logout/avatar, private image fallback and confirmed password change without persistence');
}
async function avatarQueue(browser){
 const f=await boot(browser,1440,{resume:true}),p=f.page;await f.ready();
 for(const row of f.state.accounts)row.avatarAvailable=false;for(const row of f.state.accounts.slice(0,8))row.avatarAvailable=true;
 await p.evaluate(()=>{const original=window.fetch;window.__avatarProbe={active:0,max:0,phase:'old',started:[],observers:[]};const NativeObserver=window.IntersectionObserver;window.IntersectionObserver=class extends NativeObserver{constructor(callback,options){super(callback,options);__avatarProbe.observers.push({callback,observer:this});}};window.fetch=async function(input,options){const body=options?.body&&JSON.parse(options.body);if(body?.action!=='account-avatar')return original.call(this,input,options);const probe=__avatarProbe;probe.active++;probe.max=Math.max(probe.max,probe.active);probe.started.push({userId:body.userId,phase:probe.phase});try{return await original.call(this,input,options);}finally{probe.active--;}};});
 let phase='old';const held=[];
 await f.context.route('**/api/operator',async route=>{
  const request=route.request(),body=request.postDataJSON();if(body.action!=='account-avatar')return route.fallback();f.requests.push(structuredClone(body));
  const requestPhase=phase;await new Promise(resolve=>held.push({phase:requestPhase,userId:body.userId,release:resolve}));
  try{await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,userId:body.userId,image:IMAGE})});}catch(error){if(!/ABORTED|aborted/i.test(request.failure()?.errorText||''))throw error;}
 });
 await select(p,'accounts');await p.waitForFunction(()=>__avatarProbe.started.length===2);await p.waitForTimeout(80);
 assert.equal(await p.locator('#operator-table tbody tr').nth(3).locator('.account-avatar').evaluate(element=>element.getBoundingClientRect().bottom<innerHeight),true,'At least four eligible avatar rows are actually visible');
 await p.evaluate(()=>__avatarProbe.oldTarget=document.querySelectorAll('#operator-table .account-avatar')[3]);assert.equal(held.length,2);assert.equal(await p.evaluate(()=>__avatarProbe.max),2,'Visible avatar downloads are limited to two');
 await select(p,'vehicles');await p.waitForFunction(()=>__avatarProbe.active===0);assert.equal(await p.locator('#operator-table .account-avatar').count(),0);
 for(const row of f.state.accounts)row.avatarAvailable=false;for(const row of f.state.accounts.slice(0,4))row.avatarAvailable=true;
 phase='new';await p.evaluate(()=>__avatarProbe.phase='new');await select(p,'accounts');await p.waitForFunction(()=>__avatarProbe.started.filter(row=>row.phase==='new').length===2);
 await p.evaluate(()=>{const old=__avatarProbe.observers[0];old.callback([{target:__avatarProbe.oldTarget,isIntersecting:true}],old.observer);});for(const job of held.filter(row=>row.phase==='old'))job.release();await p.waitForTimeout(80);
 assert.equal(await p.evaluate(()=>__avatarProbe.started.filter(row=>row.phase==='old').length),2,'Queued old-view avatars must never start after reset');
 assert.equal(await p.evaluate(()=>__avatarProbe.started.filter(row=>row.phase==='new').length),2,"Late aborted replies cannot release another view's active slots");
 assert.equal(await p.evaluate(()=>__avatarProbe.active),2);assert.equal(await p.evaluate(()=>__avatarProbe.max),2);
 held.find(row=>row.phase==='new').release();await p.waitForFunction(()=>__avatarProbe.started.filter(row=>row.phase==='new').length===3);
 for(let round=0;round<5;round++){for(const job of held.filter(row=>row.phase==='new'))job.release();await p.waitForTimeout(30);}
 await p.waitForFunction(()=>__avatarProbe.active===0&&document.querySelectorAll('#operator-table .account-avatar img').length===4);assert.equal(await p.evaluate(()=>__avatarProbe.max),2);
 await f.finish();console.log('PASS bounded two-avatar queue, reset aborts active requests, old queued jobs never start, and late aborts preserve new-view concurrency slots');
}
async function services(browser){
 const f=await boot(browser,1440,{resume:true}),p=f.page;await f.ready();await intercept(f,body=>result(body.service,body.query));
 await select(p,'sms');assert.equal(await p.locator('#operator-provider-history tbody tr').count(),2);assert.match(await p.locator('#operator-provider-history').textContent(),/솔라피 최근 발송|synthetic-provider-1|01000000000/);assert.equal(await p.locator('#operator-tabs button').count(),0);assert.equal(await p.locator('#operator-table tbody tr').count(),20);
 const cards=p.locator('#operator-service-summary');assert.match(await cards.textContent(),/8,765\.5 원/);assert.match(await cards.locator('[data-metric=zero]').textContent(),/0 원/);
 const missing=cards.locator('[data-metric=unavailable]');assert.match(await missing.textContent(),/확인 불가|조회 권한/);assert.doesNotMatch(await missing.locator('strong').textContent(),/0/);
 assert.match(await p.locator('#operator-table tbody tr').first().textContent(),/010-\*\*\*\*-1200|발송 성공/);
 await p.locator('#operator-pagination').getByRole('button',{name:'다음',exact:true}).click();await idle(p);assert.equal(await p.locator('#operator-table tbody tr').count(),1);assert.equal(f.requests.filter(x=>x.action==='services').at(-1).query.page,2);
 await p.locator('#operator-search').fill('synthetic-services@example.invalid');await p.locator('#operator-search-form').press('Enter');await idle(p);assert.equal(f.requests.filter(x=>x.action==='services').at(-1).query.page,1);
 await select(p,'encar');assert.equal(await p.locator('#operator-table tbody a').count(),1);const link=p.locator('#operator-table tbody a');assert.equal(await link.getAttribute('href'),'https://fem.encar.com/cars/detail/43123456?listAdvType=share&adnm=mo_detail_url');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.equal(await p.locator('#operator-table tbody img').count(),0);assert.match(await p.locator('#operator-table tbody').textContent(),/1,275 ms|실패/);
 await select(p,'vision');assert.equal(await p.locator('#operator-table tbody tr').first().locator('td').nth(5).textContent(),'2 MB');assert.equal(await p.locator('#operator-table tbody tr').first().locator('td').nth(5).getAttribute('title'),'2,097,152 B');assert.equal(await p.locator('#operator-table tbody tr').nth(1).locator('td').nth(5).textContent(),'0 B');
 await select(p,'server');const serverRow=p.locator('#operator-table tbody tr').first();assert.equal(await serverRow.locator('td').nth(3).textContent(),'125');assert.match(await serverRow.locator('td').nth(5).textContent(),/^1\.5 MB90\/125건 확인$/);assert.match(await serverRow.locator('td').nth(6).textContent(),/^4 KB100\/125건 확인$/);assert.equal(await serverRow.locator('td').nth(5).getAttribute('title'),'1,572,864 B');assert.equal(await serverRow.locator('td').nth(6).getAttribute('title'),'4,096 B');assert.equal(await cards.locator('[data-metric=traffic] strong').textContent(),'1.5 MB');assert.equal(await cards.locator('[data-metric=capacity] strong').textContent(),'1.5 TB');assert.equal(await cards.locator('[data-metric=unknown_bytes] strong').textContent(),'확인 불가');assert.equal(await cards.locator('[data-metric=verified] strong').textContent(),'125 건');await p.screenshot({path:path.join(ART,'services-1440.png')});
 await f.finish();console.log('PASS four service menus, lazy provider requests, paginated/searchable real-value cards, distinct unknowns, SMS receipts, safe Encar link, Vision and server records');
}
async function fencing(browser){
 const f=await boot(browser,1440,{resume:true}),p=f.page;await f.ready();let releaseSms,releaseVision,fail=false;
 await intercept(f,body=>{if(fail)return{status:503,body:{ok:false,code:'SETUP_REQUIRED',error:'합성 설정 오류'}};if(body.service==='sms')return new Promise(resolve=>releaseSms=()=>resolve(result('sms')));if(body.service==='vision')return new Promise(resolve=>releaseVision=()=>resolve(result('vision')));return result(body.service,body.query);});
 await p.locator('#operator-navigation [data-view=sms]').click();await p.waitForFunction(()=>document.querySelector('#operator-table-wrap').getAttribute('aria-busy')==='true');
 await select(p,'server');releaseSms();await p.waitForTimeout(80);assert.equal(await p.locator('#operator-page-title').textContent(),'서버');assert.doesNotMatch(await p.locator('#operator-service-summary').textContent(),/충전 잔액/);
 fail=true;await p.locator('#operator-refresh').click();await idle(p);assert.match(await p.locator('#operator-service-summary').textContent(),/확인하지 못했습니다/);assert.equal(await p.locator('#operator-service-summary .service-metric').count(),0);fail=false;
 await p.locator('#operator-navigation [data-view=vision]').click();await p.waitForFunction(()=>document.querySelector('#operator-table-wrap').getAttribute('aria-busy')==='true');
 await p.locator('#operator-signout').click();await p.locator('#operator-login').waitFor({state:'visible'});releaseVision();await p.waitForTimeout(80);
 assert.equal(await p.locator('#operator-service-summary').textContent(),'');assert.equal(await p.locator('#operator-table tbody tr').count(),0);assert.equal(await p.locator('#operator-service-summary').isHidden(),true);
 await f.finish();console.log('PASS service response fencing after menu changes/logout; failed refresh clears stale metric values instead of fabricating zeros');
}
async function logoutConfirmation(browser){for(const mode of['success','error','changed']){
 const f=await boot(browser,390,{resume:true}),p=f.page;await f.ready();
 await p.evaluate(mode=>{const actual=window.SnoteAccessTracker;window.__logoutConfirmed=0;window.__logoutPrepared=0;window.SnoteAccessTracker={...actual,async prepareSignOut(options){
  if(options.userId!==__operatorAuthMock.session.user.id||!/^https:\/\/[^/]+\.supabase\.co$/.test(options.url)||!options.anonKey)throw Error('Invalid signout scope');window.__logoutPrepared++;
  if(mode==='error')options.client.auth.signOut=async()=>({error:{code:'synthetic_logout_failure'}});
  if(mode==='changed')await new Promise(resolve=>window.__releaseLogoutPrepare=resolve);
  return async()=>{window.__logoutConfirmed++;return true;};
 }};},mode);
 await p.locator('#operator-signout').click();await p.waitForFunction(()=>__logoutPrepared===1);
 if(mode==='changed'){
  await p.evaluate(()=>__operatorAuthMock.callback('TOKEN_REFRESHED',__operatorAuthMock.session));await p.waitForTimeout(80);await p.evaluate(()=>__releaseLogoutPrepare());await p.waitForTimeout(80);
  assert.equal(await p.locator('#operator-app').isVisible(),true);assert.equal(await p.evaluate(()=>__operatorAuthMock.signouts),0);
 }else{await p.locator('#operator-login').waitFor({state:'visible'});await p.waitForTimeout(20);}
 assert.equal(await p.evaluate(()=>__logoutConfirmed),mode==='success'?1:0);await f.finish();
 }console.log('PASS logout confirmation only after SDK success; SDK errors and auth changes during preparation cannot confirm or terminate a replacement context');
}
async function responsive(browser){for(const width of[320,390,430,1440]){
 const f=await boot(browser,width,{resume:true,supportHandler:async body=>body.action==='support-unread'?{ok:true,unreadTotal:125}:{ok:true,items:[],total:0,page:1,pageSize:20}}),p=f.page;await f.ready();await intercept(f,body=>result(body.service,body.query));
 await p.waitForFunction(()=>document.querySelector('#operator-support-badge').textContent==='125');const badge=p.locator('#operator-support-badge');assert.equal(await badge.textContent(),'125');assert.equal(await badge.evaluate(e=>getComputedStyle(e).animationName),'operator-unread-pulse');
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await badge.evaluate(e=>getComputedStyle(e).animationName),'none');
 await select(p,'sms');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(ART,'sms-'+width+'.png')});
 await select(p,'accounts');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width<1000)assert.equal(await p.locator('#operator-table-wrap').evaluate(e=>e.scrollWidth>e.clientWidth),true);await p.screenshot({path:path.join(ART,'accounts-'+width+'.png')});
 await p.locator('#operator-signout').click();await p.locator('#operator-login').waitFor({state:'visible'});assert.equal(await badge.isHidden(),true);assert.equal(await badge.textContent(),'');await f.finish();console.log('PASS',width,'eight-menu responsive services/accounts, actual numeric unread badge, reduced-motion and logout clear');
}}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{await invalidCredentials(browser);await accounts(browser);await avatarQueue(browser);await services(browser);await fencing(browser);await logoutConfirmation(browser);await responsive(browser);}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
