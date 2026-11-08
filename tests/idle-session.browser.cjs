'use strict';
// Actual index/controller/Auth bridge. All identities, sessions, datasets and HTTP are synthetic.
// Run: node tests/idle-session.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_IDLE_SESSION_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-idle-session');
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID='33333333-3333-4333-8333-333333333333',NEW_SID='44444444-4444-4444-8444-444444444444';
const DB='https://idle-fixture.supabase.co',KEY='synthetic-idle-public-key',AUTH_KEY='sb-idle-fixture-auth-token',FIELD='snote_idle_timeout_minutes';
const HOST='#snote-idle-session-setting',SELECT='#snote-idle-minutes',WARNING='#snote-idle-warning',CONTINUE='#snote-idle-continue';
const clone=value=>JSON.parse(JSON.stringify(value)),alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);
const token=(id,sid=SID)=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,session_id:sid,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic';
fs.mkdirSync(OUT,{recursive:true});
function server(){return{users:{[ACTOR]:{id:ACTOR,email:'first@example.invalid',user_metadata:{snote_registration:{full_name:'가상 사용자',phone:'01012345678'},unrelated:'preserve-A'}},[OTHER]:{id:OTHER,email:'second@example.invalid',user_metadata:{unrelated:'preserve-B'}}},puts:[],reads:[],logouts:[],holds:new Map(),putMode:'ok',logoutMode:'ok'};}
function hold(s,key){s.holds.set(key,{waiting:false,release:null});}
function release(s,key){const h=s.holds.get(key);s.holds.delete(key);h?.release?.();}
async function pause(s,key){const h=s.holds.get(key);if(h){h.waiting=true;await new Promise(resolve=>h.release=resolve);}}
async function waiting(s,key){for(let i=0;i<200;i++){if(s.holds.get(key)?.waiting)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Did not reach held '+key);}
async function fixtureWithRecovery(width){
 // Expose one existing private function in the served test document only. The product file is untouched.
 const read=fs.readFileSync,marker="const NIL='00000000-0000-0000-0000-000000000000';";
 fs.readFileSync=function(file,...args){const value=read.call(this,file,...args);if(path.resolve(String(file))===path.join(ROOT,'index.html')&&typeof value==='string'){assert(value.includes(marker));return value.replace(marker,'window.__idleFixtureRestore=restoreDatasets;\n'+marker);}return value;};
 try{return await fixture(width);}finally{fs.readFileSync=read;}
}
async function setup(width,state=server()){
 const f=await fixtureWithRecovery(width),p=f.page;f.idleServer=state;
 await p.clock.install({time:new Date('2027-03-15T03:00:00Z')});
 await p.exposeFunction('__idleGetSession',async({id,sid})=>{const session={access_token:token(id,sid),refresh_token:'synthetic-refresh-'+sid,user:clone(state.users[id])};await pause(state,'session');return{data:{session},error:null};});
 await p.exposeFunction('__idleGetUser',async({id,jwt})=>{state.reads.push({id,jwt});await pause(state,'read');return{data:{user:clone(state.users[id])},error:null};});
 await f.context.route(DB+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':'*','access-control-allow-methods':'PUT, POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type, cache-control, pragma'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(req.headers().apikey,KEY);assert.equal(req.headers().cookie,undefined);assert.equal(req.headers().referer,undefined);
  const jwt=req.headers().authorization?.replace(/^Bearer /,''),identity=JSON.parse(Buffer.from(jwt?.split('.')[1]||'','base64url').toString());
  assert(Object.hasOwn(state.users,identity.sub),'Only a known synthetic identity may be targeted');
  if(url.pathname==='/auth/v1/logout'){
   assert.equal(req.method(),'POST');assert.equal(url.search,'?scope=local');state.logouts.push({userId:identity.sub,sessionId:identity.session_id,jwt});
   if(state.logoutMode==='offline')return route.abort('internetdisconnected');
   return route.fulfill({status:204,headers});
  }
  assert.equal(url.pathname,'/auth/v1/user');assert.equal(req.method(),'PUT');
  const body=req.postDataJSON();assert.deepEqual(Object.keys(body),['data']);assert.deepEqual(Object.keys(body.data),[FIELD]);assert([5,10,15,30,60].includes(body.data[FIELD]));
  state.puts.push({userId:identity.sub,sessionId:identity.session_id,body:clone(body),jwt});
  if(state.putMode==='failure')return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({message:'Synthetic unavailable'})});
  const user=clone(state.users[identity.sub]);user.user_metadata={...user.user_metadata,...body.data};if(state.putMode!=='ack-only')state.users[identity.sub]=clone(user);
  await pause(state,'put');return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(user)});
 });
 await p.evaluate(async({actor,other,company,url,key,user,peer,sid,authKey})=>{
  await closeVehicle({discard:true});SnoteIdleSession.reset();const S=__encarFixtureState,previous=S.client;
  window.__idleActor=actor;window.__idleSid=sid;window.__idleStopped=0;window.__idleSdkSignouts=0;
  S.user=user;S.company={id:company,name:'가상 자동 로그아웃 상사'};S.members=[{user_id:actor,company_id:company,role:'dealer',active:true,display_name:'가상 딜러'},{user_id:other,company_id:company,role:'dealer',active:true,display_name:'가상 다른 딜러'}];
  S.client={...previous,supabaseUrl:url,supabaseKey:key,auth:{...previous.auth,getSession:()=>__idleGetSession({id:__idleActor,sid:__idleSid}),getUser:jwt=>{const id=jwt?JSON.parse(atob(jwt.split('.')[1])).sub:__idleActor;return __idleGetUser({id,jwt:jwt||null});},stopAutoRefresh:()=>{__idleStopped++;},signOut:async()=>{__idleSdkSignouts++;throw Error('Automatic expiry must use the pinned local HTTP target');}},rpc(name,args){if(name==='snote_finance_lock_get')return Promise.resolve({data:{enabled:false,revision:0},error:null});return previous.rpc(name,args);},from(table){if(!['zc_companies','zc_members'].includes(table))return previous.from(table);let one=false;const chain={select(){return chain},eq(){return chain},order(){return chain},single(){one=true;return chain},maybeSingle(){one=true;return chain},then(resolve,reject){const rows=table==='zc_companies'?[S.company]:S.members;return Promise.resolve({data:one?rows[0]:rows,error:null}).then(resolve,reject)}};return chain;}};
  S.rpcConfig={client:S.client,url,key};S.ready=true;S.loading=false;S.conflict=false;S.queue.clear();S.saving=false;clearTimeout(S.timer);
  currentUser={...currentUser,username:'cld_'+actor.replaceAll('-','').slice(0,18),role:'dealer',name:'가상 딜러',company:S.company.name};
  window.__idleClient=S.client;window.__idleUserReference=S.user;window.__idlePeer=peer;window.__idleCompany=structuredClone(S.company);window.__idleMembers=structuredClone(S.members);window.__idleAccount=structuredClone(currentUser);
  const auth=await S.client.auth.getSession();for(const store of [localStorage,sessionStorage]){store.setItem(authKey,JSON.stringify(auth.data.session));store.setItem(authKey+'-code-verifier','synthetic-verifier');store.setItem(authKey+'-user','synthetic-user-cache');store.setItem('sb-unrelated-auth-token','do-not-remove');}
  localStorage.setItem('snote95-remember-login','1');await Promise.all([SnoteFinanceLock.load(currentUser),SnoteDashboardDisplay.load(currentUser),SnoteIdleSession.load(currentUser)]);buildMenus();navigate('settings');
 },{actor:ACTOR,other:OTHER,company:COMPANY,url:DB,key:KEY,user:clone(state.users[ACTOR]),peer:clone(state.users[OTHER]),sid:SID,authKey:AUTH_KEY});
 await p.locator(HOST+'[data-state="ready"]').waitFor();assert.equal(await p.evaluate(()=>SnoteIdleSession.inspect().armed),true);return f;
}
async function selectMinutes(f,minutes,{error=false}={}){
 await f.page.locator(SELECT).selectOption(String(minutes));
 await f.page.waitForFunction(({minutes,error})=>{const s=SnoteIdleSession.inspect();return error?s?.status==='save-error':s?.status==='ready'&&s.minutes===minutes;},{minutes,error});
}
async function advanceTo(p,at){const now=await p.evaluate(()=>Date.now());assert(at>=now);await p.clock.fastForward(at-now);}
async function assertSignedOut(f,{offline=false}={}){
 const p=f.page;await p.waitForFunction(()=>!__encarFixtureState.ready&&currentUser===null&&document.getElementById('zc-cloud-gate')?.hidden===false);
 const cleared=await p.evaluate(authKey=>({actor:__encarFixtureState.user,client:__encarFixtureState.client,cars:cars.length,covers:Object.keys(covers).length,photos:modelPhotos.length,media:Object.keys(mediaByCar).length,activeCar:activeCarId,contractOpen:document.getElementById('contract-overlay').classList.contains('open'),vehicleOpen:document.getElementById('vehicle-overlay').classList.contains('open'),content:['alt-content','list-table','list-mobile','list-pagination','stats','dashboard-analytics','vehicle-title'].map(id=>{const text=document.getElementById(id)?.textContent?.trim()||'';return text==='표시할 차량이 없습니다.'?'':text;}),inert:document.getElementById('snote-app').inert,privateHidden:document.getElementById('snote-app').getAttribute('aria-hidden'),dialogs:document.querySelectorAll('dialog[open]').length,remember:localStorage.getItem('snote95-remember-login'),workspaceSession:sessionStorage.getItem('zerocar-office-v12-session'),credentials:[localStorage,sessionStorage].flatMap(s=>[s.getItem(authKey),s.getItem(authKey+'-code-verifier'),s.getItem(authKey+'-user')]),unrelated:[localStorage.getItem('sb-unrelated-auth-token'),sessionStorage.getItem('sb-unrelated-auth-token')],stopped:__idleStopped,sdkSignouts:__idleSdkSignouts}),AUTH_KEY);
 assert.deepEqual(cleared,{actor:null,client:null,cars:0,covers:0,photos:0,media:0,activeCar:null,contractOpen:false,vehicleOpen:false,content:Array(7).fill(''),inert:true,privateHidden:'true',dialogs:0,remember:null,workspaceSession:null,credentials:Array(6).fill(null),unrelated:['do-not-remove','do-not-remove'],stopped:1,sdkSignouts:0});
 await p.waitForFunction(()=>!document.getElementById('snote-idle-veil'));for(let i=0;i<100&&!f.idleServer.logouts.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(f.idleServer.logouts.map(({userId,sessionId})=>({userId,sessionId})),[{userId:ACTOR,sessionId:SID}]);assert.equal(await p.locator('#zc-cloud-password').inputValue(),'');assert.equal(f.unexpectedDialogs.length,0,'Automatic expiry must never wait for a confirmation');
 if(offline)assert.equal(await p.evaluate(()=>SnoteIdleSession.wasExpired('https://idle-fixture.supabase.co','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')),true);
}
async function preferencesAndWarning(width){
 const s=server(),f=await setup(width,s),p=f.page;
 try{
  assert.equal(await p.locator(SELECT).inputValue(),'30');assert.deepEqual(await p.locator(SELECT+' option').evaluateAll(options=>options.map(o=>Number(o.value))),[5,10,15,30,60]);
  const before=clone(s.users[ACTOR].user_metadata);await selectMinutes(f,15);assert.equal(s.puts.length,1);assert.equal(s.puts[0].sessionId,SID);assert.deepEqual(s.users[ACTOR].user_metadata,{...before,[FIELD]:15});assert.equal(await p.evaluate(()=>__encarFixtureState.user===__idleUserReference),true);
  s.putMode='failure';await selectMinutes(f,5,{error:true});assert.equal(await p.locator(SELECT).inputValue(),'15');s.putMode='ok';await p.locator('#snote-idle-retry').click();await p.locator(HOST+'[data-state="ready"]').waitFor();
  s.putMode='ack-only';await selectMinutes(f,10,{error:true});assert.equal(await p.locator(SELECT).inputValue(),'15');s.putMode='ok';await p.locator('#snote-idle-retry').click();await p.locator(HOST+'[data-state="ready"]').waitFor();
  await p.evaluate(async()=>{SnoteIdleSession.reset();await SnoteIdleSession.load(currentUser);});assert.equal(await p.locator(SELECT).inputValue(),'15');
  const deadline=await p.evaluate(()=>SnoteIdleSession.inspect().deadline);await advanceTo(p,deadline-60000);await p.locator(WARNING+'[open]').waitFor();assert.equal(await p.locator('.snote-idle-countdown').textContent(),'1:00');
  await p.clock.runFor(250);await p.screenshot({path:path.join(OUT,'warning-'+width+'.png'),fullPage:width<=760});await p.locator(CONTINUE).click();await p.locator(WARNING).waitFor({state:'detached'});const renewed=await p.evaluate(()=>SnoteIdleSession.inspect());assert.equal(renewed.expired,false);assert.equal(renewed.deadline-renewed.lastActivity,15*60000);assert(renewed.deadline>deadline);assert.equal(s.logouts.length,0);
  // Script-generated events and a programmatic scroll cannot count as personal activity.
  const last=renewed.lastActivity;await p.clock.fastForward(5000);await p.evaluate(()=>{document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'A',bubbles:true}));window.scrollTo(0,20);});assert.equal(await p.evaluate(()=>SnoteIdleSession.inspect().lastActivity),last);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(OUT,'settings-'+width+'.png'),fullPage:width<=760});await finish(f);
  console.log('PASS '+width+' default 30, all choices, pinned metadata persistence, failed ACK, one-minute warning and trusted continuation');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-preferences-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function sleepingExpiry(){
 const s=server();s.logoutMode='offline';const f=await setup(1440,s),p=f.page;
 try{
  await p.evaluate(()=>{navigate('buy');openVehicle('encar-car-1');});const deadline=await p.evaluate(()=>SnoteIdleSession.inspect().deadline);
  // pauseAt advances the wall clock without running timers, as a suspended background tab does.
  await p.clock.pauseAt(new Date(deadline+1));await p.mouse.click(25,120);await assertSignedOut(f,{offline:true});await p.screenshot({path:path.join(OUT,'expired-login.png'),fullPage:true});await finish(f);
  console.log('PASS suspended-tab first trusted click expires before activity, private UI clears and offline local logout never touches other sessions');
 }catch(error){await f.context.close();throw error;}
}
async function pendingRecovery(mode){
 const f=await setup(1440),p=f.page;
 try{
  const cached=await p.evaluate(mode=>{navigate('buy');__encarFixtureWriteMode=mode;const key=carsStoreKey(currentUser.username),rows=JSON.parse(localStorage.getItem(key));rows[0].memo='Synthetic pending change - recovery must retain';localStorage.setItem(key,JSON.stringify(rows));clearTimeout(__encarFixtureState.timer);return localStorage.getItem(key);},mode);
  const deadline=await p.evaluate(()=>SnoteIdleSession.inspect().deadline);await advanceTo(p,deadline+1);await assertSignedOut(f);
  const marker=await p.evaluate(({project,userId,companyId})=>SnoteIdleRecovery.read({project,userId,companyId}),{project:DB,userId:ACTOR,companyId:COMPANY});assert(marker);assert.equal(marker.entries.length,1);assert.deepEqual(Object.keys(marker.entries[0]).sort(),['dataset','hash','ownerId','revision','storageKey']);assert.equal(marker.entries[0].revision,0);assert.equal(marker.entries[0].dataset,'cars');assert(!JSON.stringify(marker).includes('Synthetic pending change'));
  const restored=await p.evaluate(async({project,key,user,company})=>{const S=__encarFixtureState;S.client=__idleClient;S.rpcConfig={client:S.client,url:project,key};S.user=user;S.company=company;S.members=__idleMembers;S.ready=false;S.loading=false;currentUser=__idleAccount;await __idleFixtureRestore();return{cache:localStorage.getItem(carsStoreKey(currentUser.username)),queued:[...S.queue],conflict:S.conflict,marker:SnoteIdleRecovery.read({project,userId:S.user.id,companyId:S.company.id}),writes:__encarFixtureWrites.length};},{project:DB,key:KEY,user:clone(f.idleServer.users[ACTOR]),company:{id:COMPANY,name:'가상 자동 로그아웃 상사'}});
  assert.deepEqual(JSON.parse(restored.cache),JSON.parse(cached));assert.equal(restored.conflict,false);
  if(mode==='fail'){assert.deepEqual(restored.queued,['cars:'+ACTOR]);assert(restored.marker);assert.equal(restored.writes,0);}else{assert.deepEqual(restored.queued,[]);assert.equal(restored.marker,null);assert.equal(restored.writes,1);}
  await finish(f);console.log('PASS '+mode+' pending save remains in original cache; '+(mode==='fail'?'same-revision retry':'lost-response server ACK')+' reconciles without blind overwrite');
 }catch(error){await f.context.close();throw error;}
}
async function latePreferenceAccountSwitch(){
 const s=server(),f=await setup(1440,s),p=f.page;
 try{
  hold(s,'put');await p.locator(SELECT).selectOption('5');await waiting(s,'put');
  await p.evaluate(async({id,user,sid})=>{SnoteIdleSession.reset();const S=__encarFixtureState;S.user=user;__idleActor=id;__idleSid=sid;currentUser={...currentUser,username:'cld_'+id.replaceAll('-','').slice(0,18)};await SnoteIdleSession.load(currentUser);buildMenus();navigate('settings');},{id:OTHER,user:clone(s.users[OTHER]),sid:NEW_SID});
  release(s,'put');await p.waitForTimeout(30);assert.equal(s.puts.length,1);assert.equal(s.puts[0].userId,ACTOR);assert.equal(await p.locator(SELECT).inputValue(),'30');assert.equal(await p.evaluate(()=>__encarFixtureState.user.id),OTHER);assert.equal(s.users[OTHER].user_metadata[FIELD],undefined);await finish(f);console.log('PASS late preference response cannot alter the new account or its timeout');
 }catch(error){release(s,'put');await f.context.close();throw error;}
}
async function freshSessionSurvivesOldExit(preserveNewSession){
 const f=await setup(1440),p=f.page;
 try{
  const fresh={access_token:token(ACTOR,NEW_SID),refresh_token:'new-synthetic-refresh',user:clone(f.idleServer.users[ACTOR])};
  await p.evaluate(async({fresh,authKey,oldSid,preserveNewSession})=>{const ctx=snoteIdleSessionBridge.context();for(const storage of[localStorage,sessionStorage]){storage.setItem(authKey,JSON.stringify(fresh));storage.setItem(authKey+'-code-verifier','new-session-verifier');}await snoteIdleSessionBridge.expire(ctx,{sessionId:oldSid,reason:preserveNewSession?'session-changed':'idle',preserveNewSession});},{fresh,authKey:AUTH_KEY,oldSid:SID,preserveNewSession});
  const result=await p.evaluate(authKey=>({ready:__encarFixtureState.ready,user:currentUser,raw:[localStorage.getItem(authKey),sessionStorage.getItem(authKey)],verifier:[localStorage.getItem(authKey+'-code-verifier'),sessionStorage.getItem(authKey+'-code-verifier')],remember:localStorage.getItem('snote95-remember-login')}),AUTH_KEY);
  assert.equal(result.ready,false);assert.equal(result.user,null);assert.deepEqual(result.raw.map(JSON.parse),[fresh,fresh]);assert.deepEqual(result.verifier,['new-session-verifier','new-session-verifier']);assert.equal(result.remember,'1');assert.equal(f.idleServer.logouts.length,0);await finish(f);console.log('PASS replacing the current Auth session locks the old UI and preserves the newly stored session '+(preserveNewSession?'after':'before')+' the Auth event');
 }catch(error){await f.context.close();throw error;}
}
async function lateOldFlushCannotClearNewAccount(){
 const f=await setup(1440),p=f.page;
 try{
  await p.evaluate(()=>{__encarFixtureWriteMode='hold';const key=carsStoreKey(currentUser.username),rows=JSON.parse(localStorage.getItem(key));rows[0].memo='Synthetic old account pending save';localStorage.setItem(key,JSON.stringify(rows));clearTimeout(__encarFixtureState.timer);});
  const deadline=await p.evaluate(()=>SnoteIdleSession.inspect().deadline);await advanceTo(p,deadline+1);await p.waitForFunction(()=>__encarFixtureWriteWaiting);
  await p.evaluate(async({other,user,sid,authKey,project,key})=>{
   const S=__encarFixtureState,oldClient=S.client;SnoteIdleSession.reset();__idleActor=other;__idleSid=sid;S.client={...oldClient};S.rpcConfig={client:S.client,url:project,key};S.user=user;S.company=__idleCompany;S.members=__idleMembers;S.ready=true;currentUser={...__idleAccount,username:'cld_'+other.replaceAll('-','').slice(0,18)};cars=[{id:'new-account-car',ownerId:currentUser.username,model:'Synthetic new account vehicle',status:'판매중'}];
   const session=await S.client.auth.getSession();localStorage.setItem(authKey,JSON.stringify(session.data.session));document.getElementById('snote-app').inert=false;document.getElementById('snote-app').removeAttribute('aria-hidden');await SnoteIdleSession.load(currentUser);__encarFixtureReleaseWrite();
  },{other:OTHER,user:clone(f.idleServer.users[OTHER]),sid:NEW_SID,authKey:AUTH_KEY,project:DB,key:KEY});
  await p.waitForFunction(()=>!document.getElementById('snote-idle-veil'));const result=await p.evaluate(authKey=>({actor:__encarFixtureState.user?.id,current:currentUser?.username,ready:__encarFixtureState.ready,ids:cars.map(car=>car.id),auth:JSON.parse(localStorage.getItem(authKey)),session:SnoteIdleSession.inspect()?.sessionId}),AUTH_KEY);
  assert.equal(result.actor,OTHER);assert.equal(result.current,alias(OTHER));assert.equal(result.ready,true);assert.deepEqual(result.ids,['new-account-car']);assert.equal(result.auth.access_token,token(OTHER,NEW_SID));assert.equal(result.session,NEW_SID);assert.equal(f.idleServer.logouts.length,0);await finish(f);console.log('PASS a delayed old-account flush cannot clear a newly authenticated account, its vehicle data or its Auth storage');
 }catch(error){await p.evaluate(()=>__encarFixtureReleaseWrite?.()).catch(()=>{});await f.context.close();throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{await preferencesAndWarning(1440);await preferencesAndWarning(390);await sleepingExpiry();await pendingRecovery('fail');await pendingRecovery('lost-response');await latePreferenceAccountSwitch();await freshSessionSurvivesOldExit(true);await freshSessionSurvivesOldExit(false);await lateOldFlushCannotClearNewAccount();const sourceHashes=Object.fromEntries(['index.html','assets/idle-session.js','assets/idle-session.css','assets/idle-auth-storage.js','assets/idle-recovery.js','tests/idle-session.browser.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),browser:await browser.version(),sourceHashes,checks:['desktop and mobile settings','default 30 and five timeout choices','verified pinned metadata writes and failed readback','one-minute warning, trusted continuation and synthetic-event rejection','sleeping-tab expiry before trusted activity','private UI and exact scoped Auth storage cleanup, including offline','pending failed writes and lost-response ACK recovery','late account preference race','fresh session preserved on old exit','delayed old-account flush cannot clear a new account']},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
