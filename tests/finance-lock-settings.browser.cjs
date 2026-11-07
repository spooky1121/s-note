'use strict';
// Actual index/navigation/settings/auth bridge; all database/auth replies are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DB='https://finance-lock-fixture.supabase.co',KEY='synthetic-finance-public-key',PASSWORD='synthetic-finance-password';
const token=id=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic-signature';
const TOKENS={[ACTOR]:token(ACTOR),[OTHER]:token(OTHER)},alias=id=>'cld_'+id.replaceAll('-','').slice(0,18),copy=value=>structuredClone(value);
const control=p=>p.locator('#snote-finance-lock-toggle'),gate=p=>p.locator('#zc-dashboard-gate');
function server(role='dealer',saved){return{roles:{[ACTOR]:role,[OTHER]:'dealer'},rows:saved?copy(saved):{},calls:[],auth:[],violations:[],holds:new Map(),failLoad:false,failSave:false,wrongAuthActor:false};}
async function waiting(f,key){for(let i=0;i<200;i++){if(f.state.holds.get(key)?.waiting)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Did not reach held '+key);}
function hold(f,key){f.state.holds.set(key,{waiting:false,resolve:null});}
function release(f,key){const h=f.state.holds.get(key);f.state.holds.delete(key);h?.resolve?.();}
async function pause(state,key){const h=state.holds.get(key);if(h){h.waiting=true;await new Promise(resolve=>h.resolve=resolve);}}
async function setup(width=1440,state=server(),actor=ACTOR){
 const f=await fixture(width),p=f.page;f.state=state;await p.evaluate(()=>closeVehicle({discard:true}));
 async function rpc({name,args={},jwt}){
  const id=Object.keys(TOKENS).find(id=>TOKENS[id]===jwt),role=state.roles[id];state.calls.push({name,args:copy(args),actor:id});
  if(!id||!role)return{data:null,error:{code:'42501',message:'FORBIDDEN'}};
  const prior=copy(state.rows[id]||{enabled:role==='dealer',revision:0});
  if(name==='snote_finance_lock_get'){
   await pause(state,'load:'+id);if(state.failLoad)return{data:null,error:{code:'NETWORK',message:'Synthetic read unavailable'}};
   return{data:role==='accountant'?{enabled:false,revision:0}:prior,error:null};
  }
  if(name!=='snote_finance_lock_save'){state.violations.push('Unexpected preference RPC '+name);return{data:null,error:{code:'42883',message:'Unknown RPC'}};}
  if(role==='accountant'||args.p_expected_company_id!==COMPANY||args.p_expected_user_id!==id)return{data:null,error:{code:'42501',message:'FORBIDDEN'}};
  if(typeof args.p_enabled!=='boolean'||!Number.isSafeInteger(args.p_expected_revision))return{data:null,error:{code:'22023',message:'INVALID_SETTING'}};
  await pause(state,'save:'+id);if(state.failSave||args.p_expected_revision!==prior.revision)return{data:null,error:{code:'40001',message:'CONFLICT'}};
  const result={enabled:args.p_enabled,revision:prior.revision+1};state.rows[id]=copy(result);return{data:result,error:null};
 }
 await p.exposeFunction('__financeRpcFixture',rpc);
 await p.exposeFunction('__financePasswordFixture',async({email,password})=>{
  const id=email==='second@example.invalid'?OTHER:ACTOR;state.auth.push({actor:id,correct:password===PASSWORD});await pause(state,'auth:'+id);
  return password===PASSWORD?{data:{user:{id:state.wrongAuthActor?OTHER:id,email},session:{access_token:TOKENS[id]}},error:null}:{data:{user:null},error:{code:'invalid_credentials',message:'Invalid login credentials'}};
 });
 await f.context.route(DB+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'apikey, authorization, content-type, x-client-info'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(req.headers().apikey!==KEY)state.violations.push('Unexpected public key');
  const result=await rpc({name:url.pathname.split('/').pop(),args:req.postDataJSON(),jwt:(req.headers().authorization||'').replace(/^Bearer /,'')});
  return route.fulfill({status:result.error?result.error.code==='40001'?409:result.error.code==='42501'?403:503:200,headers,contentType:'application/json',body:JSON.stringify(result.error||result.data)});
 });
 await f.context.route('**/api/vehicle-taxonomy-probe*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,provider:'encar-api.com',configured:false})}));
 await f.context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@*/+esm',route=>route.fulfill({contentType:'application/javascript',body:`export function createClient(url,key,options){const q=window.__financeAuthTest;q.created.push({url,key,options});let user=null;return{auth:{async setSession(session){const id=Object.keys(q.tokens).find(id=>q.tokens[id]===session.access_token);user={id,email:id===q.other?'second@example.invalid':'first@example.invalid'};return{data:{user},error:null}},async getUser(){return{data:{user},error:null}},async signInWithPassword(credentials){const result=await window.__financePasswordFixture(credentials);user=result.data?.user;return result},async signOut(options){q.cleanups.push(options);if(q.holdCleanup){q.cleanupWaiting=true;await new Promise(resolve=>q.releaseCleanup=resolve);}return{error:null}}}};}`}));
 await p.evaluate(({actor,other,company,role,key,url,tokens})=>{
  const S=__encarFixtureState,original=S.client,from=original.from.bind(original);window.__financeAuthTest={tokens,other,created:[],cleanups:[],mainLogins:0,holdSession:false,sessionWaiting:false,releaseSession:null};const q=__financeAuthTest;
  S.user={id:actor,email:actor===other?'second@example.invalid':'first@example.invalid'};S.company={id:company,name:'합성 잠금 검증 상사'};S.members=[{user_id:actor,company_id:company,role,active:true,display_name:'합성 사용자'},{user_id:actor===other?Object.keys(tokens).find(id=>id!==other):other,company_id:company,role:'dealer',active:true}];
  S.client={...original,supabaseUrl:url,supabaseKey:key,auth:{...original.auth,async getSession(){const snapshot={access_token:tokens[S.user.id],refresh_token:'synthetic-refresh-'+S.user.id,user:copyUser(S.user)};if(q.holdSession){q.sessionWaiting=true;await new Promise(resolve=>q.releaseSession=resolve);}return{data:{session:snapshot},error:null}},async getUser(jwt){const id=Object.keys(tokens).find(id=>tokens[id]===jwt);return{data:{user:id?{id,email:id===other?'second@example.invalid':'first@example.invalid'}:null},error:id?null:{code:'bad_jwt'}}},async signInWithPassword(){q.mainLogins++;throw Error('Main auth session must not be used for privacy-gate reauthentication');}},from(table){if(!['zc_companies','zc_members'].includes(table))return from(table);let one=false;const c={select(){return c},eq(){return c},order(){return c},single(){one=true;return c},maybeSingle(){one=true;return c},then(resolve,reject){const rows=table==='zc_companies'?[S.company]:S.members;return Promise.resolve({data:one?rows[0]:rows,error:null}).then(resolve,reject)}};return c},async rpc(name,args){if(name.startsWith('snote_finance_lock_'))return window.__financeRpcFixture({name,args,jwt:tokens[S.user.id]});if(name==='snote_vehicle_notifications')return{data:{items:[],unread:0},error:null};return original.rpc(name,args)}};
  S.rpcConfig={client:S.client,url,key};S.ready=true;currentUser={...currentUser,username:'cld_'+actor.replaceAll('-','').slice(0,18),role,name:'합성 사용자',company:S.company.name};document.body.classList.toggle('accountant-mode',role==='accountant');
  function copyUser(user){return{...user}};
 },{actor,other:OTHER,company:COMPANY,role:state.roles[actor],key:KEY,url:DB,tokens:TOKENS});
 await p.evaluate(()=>SnoteFinanceLock.load(currentUser));return f;
}
async function settings(p){await p.evaluate(()=>navigate('settings'));await control(p).waitFor();}
async function toggle(p,enabled){await settings(p);if(await control(p).isChecked()!==enabled)await control(p).click();await p.waitForFunction(enabled=>window.SnoteFinanceLock.enabled()===enabled&&!document.getElementById('snote-finance-lock-toggle').disabled,enabled);assert.equal(await control(p).isChecked(),enabled);}
async function enter(p,locked){await p.evaluate(()=>navigate('finance'));if(locked){await gate(p).waitFor({state:'visible'});assert.notEqual(await p.evaluate(()=>route),'finance');}else{await p.waitForFunction(()=>route==='finance');assert.equal(await gate(p).isHidden(),true);}}
async function password(p,value=PASSWORD,valid=true){await p.locator('#zc-dashboard-gate-password').fill(value);await p.locator('#zc-dashboard-gate-submit').click();if(valid){await p.waitForFunction(()=>route==='finance');assert.equal(await gate(p).isHidden(),true);}else{await p.waitForFunction(()=>document.getElementById('zc-dashboard-gate-error').textContent.length>0);assert.equal(await gate(p).isVisible(),true);assert.notEqual(await p.evaluate(()=>route),'finance');}}
async function close(f){assert.deepEqual(f.state.violations,[]);assert.equal(await f.page.evaluate(()=>__financeAuthTest.mainLogins),0);await finish(f);}
async function switchActor(p,id=OTHER){await p.evaluate(async({id,other})=>{const S=__encarFixtureState;S.user={id,email:id===other?'second@example.invalid':'first@example.invalid'};await enterWorkspace({...currentUser,username:'cld_'+id.replaceAll('-','').slice(0,18),role:'dealer',name:'전환한 합성 사용자'},{restoreHistory:false});navigate('settings');},{id,other:OTHER});}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of[1440,390,320]){
  const state=server(),f=await setup(width,state),p=f.page;await settings(p);assert.equal(await control(p).isChecked(),true);assert.equal(await control(p).isEnabled(),true);
  await enter(p,true);await password(p,'synthetic-wrong',false);await password(p);await p.evaluate(()=>navigate('buy'));await enter(p,true);await p.keyboard.press('Escape');assert.equal(await p.locator('#zc-dashboard-gate-password').inputValue(),'');
  await toggle(p,false);assert.deepEqual(state.rows[ACTOR],{enabled:false,revision:1});const authCount=state.auth.length;for(let i=0;i<3;i++){await p.evaluate(()=>navigate('buy'));await enter(p,false);}assert.equal(state.auth.length,authCount);
  await settings(p);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/snote-finance-lock-off-'+width+'.png'});await close(f);
  const restored=await setup(width,state),r=restored.page;assert.equal(await r.evaluate(()=>SnoteFinanceLock.enabled()),false);await enter(r,false);await toggle(r,true);assert.deepEqual(state.rows[ACTOR],{enabled:true,revision:2});
  await r.goBack();await gate(r).waitFor({state:'visible'});assert.notEqual(await r.evaluate(()=>route),'finance');await r.keyboard.press('Escape');await r.evaluate(()=>{location.hash='page=finance'});await gate(r).waitFor({state:'visible'});assert.notEqual(await r.evaluate(()=>route),'finance');await password(r,'synthetic-wrong',false);await password(r);await r.evaluate(()=>navigate('buy'));await enter(r,true);await r.keyboard.press('Escape');
  const clients=await r.evaluate(()=>__financeAuthTest.created);assert(clients.length>0&&clients.every(c=>c.options.auth.persistSession===false&&c.options.auth.autoRefreshToken===false&&c.options.auth.detectSessionInUrl===false));assert((await r.evaluate(()=>__financeAuthTest.cleanups)).every(o=>o.scope==='local'));await close(restored);
  console.log('PASS',width,'real settings/RPC/transient auth: dealer defaults, OFF repeated entry and fresh-document persistence, ON wrong/right password, per-entry relock and hash/back-history protection');
 }
 // Failed and delayed RPCs cannot unlock an unconfirmed or different account.
 {
  const state=server(),f=await setup(1440,state),p=f.page;await settings(p);state.failSave=true;await control(p).click();await p.locator('#snote-finance-lock-retry').waitFor({state:'visible'});assert.equal(await p.evaluate(()=>SnoteFinanceLock.enabled()),true);assert.equal(await control(p).isChecked(),true);assert.equal(state.rows[ACTOR],undefined);state.failSave=false;await p.locator('#snote-finance-lock-retry').click();await control(p).waitFor({state:'visible'});await p.waitForFunction(()=>!document.getElementById('snote-finance-lock-toggle').disabled);
  hold(f,'save:'+ACTOR);await control(p).click();await waiting(f,'save:'+ACTOR);assert.equal(await p.evaluate(()=>SnoteFinanceLock.enabled()),true);assert.equal(await control(p).isDisabled(),true);await switchActor(p);assert.equal(await control(p).isChecked(),true);release(f,'save:'+ACTOR);await p.waitForTimeout(80);assert.equal(await p.evaluate(()=>SnoteFinanceLock.enabled()),true);assert.equal(await control(p).isChecked(),true);assert.equal(state.rows[OTHER],undefined);await enter(p,true);await p.keyboard.press('Escape');await close(f);
 }
 {
  const state=server();state.rows[ACTOR]={enabled:false,revision:4};state.failLoad=true;const f=await setup(1440,state),p=f.page;await settings(p);assert.equal(await p.evaluate(()=>SnoteFinanceLock.enabled()),true);assert.equal(await control(p).isDisabled(),true);await enter(p,true);await p.keyboard.press('Escape');state.failLoad=false;await settings(p);await p.locator('#snote-finance-lock-retry').click();await p.waitForFunction(()=>SnoteFinanceLock.enabled()===false);await enter(p,false);await close(f);
 }
 // A password response from another account/session cannot grant access.
 {
  const f=await setup(),p=f.page;await settings(p);await enter(p,true);hold(f,'auth:'+ACTOR);await p.locator('#zc-dashboard-gate-password').fill(PASSWORD);await p.locator('#zc-dashboard-gate-submit').click();await waiting(f,'auth:'+ACTOR);await switchActor(p);release(f,'auth:'+ACTOR);await p.waitForTimeout(80);assert.notEqual(await p.evaluate(()=>route),'finance');assert.equal(await p.evaluate(()=>SnoteFinanceLock.enabled()),true);assert.equal(await p.locator('#zc-dashboard-gate-password').inputValue(),'');await close(f);
 }
 {
  const f=await setup(),p=f.page;await settings(p);await enter(p,true);await p.evaluate(()=>{__financeAuthTest.holdSession=true});await p.locator('#zc-dashboard-gate-password').fill(PASSWORD);await p.locator('#zc-dashboard-gate-submit').click();await p.waitForFunction(()=>__financeAuthTest.sessionWaiting);await p.evaluate(()=>{__financeAuthTest.holdSession=false});await switchActor(p);await p.evaluate(()=>__financeAuthTest.releaseSession());await p.waitForTimeout(80);assert.equal(f.state.auth.length,0);assert.notEqual(await p.evaluate(()=>route),'finance');await close(f);
 }
 {
  const state=server();state.wrongAuthActor=true;const f=await setup(1440,state),p=f.page;await settings(p);await enter(p,true);await password(p,PASSWORD,false);assert.equal(state.auth[0].correct,true,'A successful password reply for another user is still denied');assert.equal(await p.evaluate(()=>__encarFixtureState.user.id),ACTOR);await close(f);
 }
 {
  const f=await setup(),p=f.page;await settings(p);await enter(p,true);await p.evaluate(()=>{__financeAuthTest.holdCleanup=true});await p.locator('#zc-dashboard-gate-password').fill(PASSWORD);await p.locator('#zc-dashboard-gate-submit').click();await p.waitForFunction(()=>__financeAuthTest.cleanupWaiting);
  await p.evaluate(()=>{const S=__encarFixtureState,next='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';S.company={...S.company,id:next};S.members=S.members.map(row=>row.user_id===S.user.id?{...row,company_id:next}:row);__financeAuthTest.holdCleanup=false;__financeAuthTest.releaseCleanup();});
  await p.waitForFunction(()=>!document.getElementById('zc-dashboard-gate-submit').disabled&&document.getElementById('zc-dashboard-gate-error').textContent.length>0);assert.notEqual(await p.evaluate(()=>route),'finance','Changing company during transient cleanup must invalidate the successful password result');await close(f);
 }
 // Administrator defaults preserve the current bypass; accountants do not gain settings rights.
 {
  const f=await setup(1440,server('admin')),p=f.page;await enter(p,false);assert.equal(f.state.auth.length,0);await settings(p);assert.equal(await control(p).isChecked(),false);await toggle(p,true);await enter(p,true);await password(p);await close(f);
 }
 {
  const f=await setup(1440,server('accountant')),p=f.page;assert.equal(await p.evaluate(()=>SnoteFinanceLock.enabled()),false);assert.equal(await p.evaluate(()=>navigate('settings')),false);assert.equal(await control(p).count(),0);assert.equal(await gate(p).isHidden(),true);assert.equal(await p.evaluate(async()=>{try{await snoteFinanceLockBridge.save(snoteFinanceLockBridge.context(),false,0);return false}catch{return true}}),true);assert.equal(f.state.calls.some(call=>call.name==='snote_finance_lock_save'),false);await p.evaluate(()=>navigate('finance'));assert.equal(await p.locator('#dealer-finance-overview').isHidden(),true);assert.equal(await gate(p).isHidden(),true);await close(f);
 }
 console.log('PASS real privacy preference failures/late ACK, account/password/session isolation, administrator opt-in and accountant settings denial');
}finally{await browser.close()}})().catch(error=>{console.error(error.stack);process.exitCode=1});
