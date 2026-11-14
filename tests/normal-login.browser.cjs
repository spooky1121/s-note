'use strict';
// Actual main application and idle modules. Auth/data are synthetic and every
// outbound request is intercepted; this test never uses production credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://normal-login-fixture.example',DB='https://rmlycycleuscfqywbihj.supabase.co';
const SDK='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm',USER='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PASSWORD='SyntheticPassword!123',OUT=process.env.SNOTE_NORMAL_LOGIN_ARTIFACT_DIR||'/tmp/snote-normal-login';fs.mkdirSync(OUT,{recursive:true});
const copy=value=>JSON.parse(JSON.stringify(value)),claims=token=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{return{};}};
const jwt=sid=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:USER,session_id:sid,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic';
const hashes=()=>Object.fromEntries(['index.html','assets/idle-auth-storage.js','assets/idle-session.js','assets/idle-recovery.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')]));

function backend(){
 const state={sequence:0,passwordCalls:[],rpcCalls:[],logouts:[],sessions:new Map(),reads:[],user:{id:USER,email:'dealer@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{}}};
 state.issue=()=>{const sid='40000000-0000-4000-8000-'+String(++state.sequence).padStart(12,'0'),session={access_token:jwt(sid),refresh_token:'synthetic-refresh-'+sid,user:copy(state.user)};state.sessions.set(sid,{session,live:true});return copy(session);};
 state.valid=token=>state.sessions.get(claims(token).session_id)?.live===true;
 state.auth=(label,input)=>{state.passwordCalls.push({label});if(input.email!==state.user.email||input.password!==PASSWORD)return{data:{session:null,user:null},error:{code:'invalid_credentials',message:'Synthetic invalid credentials'}};const session=state.issue();return{data:{session,user:session.user},error:null};};
 state.getUser=token=>state.valid(token)?{data:{user:copy(state.user)},error:null}:{data:{user:null},error:{code:'session_not_found'}};
 state.logout=(label,{token,scope})=>{assert.equal(scope,'local');const sid=claims(token).session_id;state.logouts.push({label,sid});const s=state.sessions.get(sid);if(s)s.live=false;return{error:null};};
 state.rpc=(label,{name,token})=>{state.rpcCalls.push({label,name});assert(!/^snote_session_/.test(name),'No concurrent-session RPC may run');if(!state.valid(token))return{data:null,error:{code:'401'}};if(name==='snote_finance_lock_get')return{data:{enabled:false,revision:0},error:null};if(name==='snote_access_ping')return{data:{ok:true},error:null};return{data:null,error:{code:'PGRST202',message:'Optional synthetic RPC unavailable'}};};
 state.from=(label,{table,filters,single,token})=>{state.reads.push({label,table});if(!state.valid(token))return{data:null,error:{code:'401'}};let rows=[];
  if(table==='zc_members')rows=[{user_id:USER,company_id:COMPANY,active:true,role:'dealer',display_name:'가상 딜러'}];
  if(table==='zc_companies')rows=[{id:COMPANY,name:'가상 로그인 상사',rrn_enabled:false}];
  if(table==='zc_datasets')rows=[{company_id:COMPANY,dataset:'cars',owner_id:USER,payload:[{id:'synthetic-car',ownerId:'cld_'+USER.replaceAll('-','').slice(0,18),model:'가상 차량',plate:'12가3456',buy:1000,sell:1200,status:'판매중'}],revision:0},{company_id:COMPANY,dataset:'covers',owner_id:USER,payload:{},revision:0}];
  rows=rows.filter(row=>Object.entries(filters||{}).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));return{data:single?(rows[0]||null):rows,error:null};};
 return state;
}

const SDK_FACTORY=String.raw`(()=>{
 const state=window.__normalSdk={clients:[],events:[]};
 window.__normalFactory=(url,key,options={})=>{
  const opts=options.auth||{},persistent=opts.persistSession!==false,storage=opts.storage||localStorage,storageKey=opts.storageKey||'sb-'+new URL(url).hostname.split('.')[0]+'-auth-token';
  const c={persistent,session:null,callback:null,channels:[],options:opts,signouts:0};state.clients.push(c);if(persistent)state.main=c;
  const broadcast=persistent?new BroadcastChannel(storageKey):null;
  if(broadcast)broadcast.onmessage=({data})=>{c.session=data.session;state.events.push(data.event);c.callback?.(data.event,data.session);};
  const read=()=>{if(persistent){try{const raw=storage.getItem(storageKey);c.session=raw?JSON.parse(raw):null;}catch{c.session=null;}}return c.session;};
  const store=value=>{c.session=value;if(persistent){if(value)storage.setItem(storageKey,JSON.stringify(value));else storage.removeItem(storageKey);}};
  const emit=(event,session)=>{c.callback?.(event,session);broadcast?.postMessage({event,session});};
  const auth={getSession:async()=>({data:{session:read()},error:null}),getUser:async token=>__normalGetUser(token||read()?.access_token),signInWithPassword:async input=>{const r=await __normalAuth(input);if(!r.error){store(r.data.session);emit('SIGNED_IN',r.data.session);}return r;},onAuthStateChange:callback=>{c.callback=callback;return{data:{subscription:{unsubscribe(){c.callback=null;}}}};},stopAutoRefresh(){},startAutoRefresh(){},signOut:async options=>{c.signouts++;const r=await __normalLogout({token:read()?.access_token,scope:options?.scope});store(null);emit('SIGNED_OUT',null);return r;}};
  const client={auth,supabaseUrl:url,supabaseKey:key,rpc:(name,args)=>__normalRpc({name,args,token:read()?.access_token}),from(table){const filters={};let single=false;const q={select(){return q;},eq(k,v){filters[k]=v;return q;},in(k,v){filters[k]=v;return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},then(resolve,reject){return __normalFrom({table,filters,single,token:read()?.access_token}).then(resolve,reject);}};return q;},channel(name){const q={name,on(type,filter,handler){this.filter=filter;return this;},subscribe(){return this;}};c.channels.push(q);return q;},removeChannel:async()=>{}};c.client=client;return client;
 };
})();`;

async function boot(browser,state,label,{context,width=1440,clock=false}={}){
 const ownContext=!context;context=context||await browser.newContext({viewport:{width,height:950}});const page=await context.newPage(),f={page,context,ownContext,errors:[],unexpected:[]};page.setDefaultTimeout(20000);page.on('pageerror',e=>f.errors.push(e.message));page.on('dialog',d=>{f.errors.push('Unexpected dialog: '+d.message());void d.dismiss();});
 await page.exposeFunction('__normalAuth',input=>state.auth(label,input));await page.exposeFunction('__normalGetUser',token=>state.getUser(token));await page.exposeFunction('__normalLogout',input=>state.logout(label,input));await page.exposeFunction('__normalRpc',input=>state.rpc(label,input));await page.exposeFunction('__normalFrom',input=>state.from(label,input));await page.addInitScript(SDK_FACTORY);
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.href===SDK)return route.fulfill({contentType:'application/javascript',body:'export const createClient=(...args)=>window.__normalFactory(...args);'});
  if(url.origin===DB){const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,cache-control,pragma'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});const token=req.headers().authorization?.replace(/^Bearer /,'');if(url.pathname==='/auth/v1/logout'){assert.equal(url.searchParams.get('scope'),'local');state.logout(label,{token,scope:'local'});return route.fulfill({status:204,headers});}assert(!url.pathname.includes('snote_session_'),'No session-ownership HTTP call');if(!state.valid(token))return route.fulfill({status:401,headers,contentType:'application/json',body:'{}'});return route.fulfill({headers,contentType:'application/json',body:url.pathname==='/rest/v1/rpc/snote_profile_read'?JSON.stringify({user_id:USER,company_id:COMPANY,role:'dealer',display_name:'가상 딜러',revision:0,avatar_path:null}):'[]'});}
  if(url.origin!==ORIGIN){f.unexpected.push(url.origin+url.pathname);return route.abort();}
  if(url.pathname==='/api/weather')return route.fulfill({contentType:'application/json',body:'{"ok":true,"temperature":10,"code":0,"region":"합성","source":"기상청"}'});
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"code":"SETUP_REQUIRED"}'});
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.resolve(ROOT,relative);if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){f.unexpected.push(url.pathname);return route.fulfill({status:404,body:'Missing fixture asset'});}let body=fs.readFileSync(file);
  if(relative==='index.html'){const marker="const NIL='00000000-0000-0000-0000-000000000000';";const html=body.toString();assert(html.includes(marker));body=Buffer.from(html.replace(marker,'window.__normalState=S;\n'+marker));}
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body});
 });
 if(clock)await page.clock.install({time:new Date('2026-11-14T09:00:00Z')});
 await page.goto(ORIGIN,{waitUntil:'networkidle'});f.login=async({password=PASSWORD,remember=true}={})=>{await page.locator('#zc-cloud-email').fill('dealer@example.invalid');await page.locator('#zc-cloud-password').fill(password);await page.locator('#snote95-remember').setChecked(remember);await page.locator('#zc-cloud-submit').click();};f.ready=()=>page.waitForFunction(()=>window.__normalState?.ready&&currentUser&&window.SnoteIdleSession?.inspect()?.armed);f.finish=async()=>{assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);if(ownContext)await context.close();else await page.close();};return f;
}

async function inspect(f){return f.page.evaluate(()=>({ready:__normalState.ready,current:currentUser?.username,clientCount:__normalSdk.clients.length,mainSignouts:__normalSdk.main?.signouts,sessionId:SnoteIdleSession.inspect()?.sessionId,armed:SnoteIdleSession.inspect()?.armed,minutes:SnoteIdleSession.inspect()?.minutes,ownershipModule:typeof window.SnoteSessionOwnership,confirmation:!!document.getElementById('session-replacement-modal'),veil:!!document.getElementById('snote-session-veil'),channels:__normalSdk.clients.flatMap(c=>c.channels).map(c=>c.filter?.table)}));}

(async()=>{const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  for(const sameContext of[false,true]){
   const state=backend(),context=sameContext?await browser.newContext({viewport:{width:1440,height:950}}):null,fixtures=[];
   try{const a=await boot(browser,state,'A',{context});fixtures.push(a);await a.login({remember:!sameContext});await a.ready();const aBefore=await inspect(a),oldSid=aBefore.sessionId;assert(aBefore.armed);
    const b=await boot(browser,state,'B',{context});fixtures.push(b);await b.login();await b.ready();await a.page.waitForTimeout(600);const one=await inspect(a),two=await inspect(b);assert(one.ready&&two.ready);assert.equal(one.mainSignouts,0);assert.equal(two.mainSignouts,0);assert.equal(one.ownershipModule,'undefined');assert.equal(two.ownershipModule,'undefined');assert(!one.confirmation&&!two.confirmation&&!one.veil&&!two.veil);assert(one.armed&&two.armed);assert.equal(one.minutes,30);assert.equal(two.minutes,30);assert.equal(state.passwordCalls.length,2);assert.equal(state.logouts.length,0);assert.equal([...state.sessions.values()].filter(s=>s.live).length,2);assert(state.rpcCalls.every(c=>!/^snote_session_/.test(c.name)));assert(!one.channels.includes('snote_session_signals')&&!two.channels.includes('snote_session_signals'));
    if(sameContext){assert.notEqual(one.sessionId,oldSid);assert.equal(one.sessionId,two.sessionId,'Same-account storage refresh adopts the new session without ending the old tab');}
    else assert.notEqual(one.sessionId,two.sessionId);
    results.push({name:sameContext?'same-browser tabs remain usable after a second login':'independent browsers allow the same account concurrently',noConfirmationOrRevocation:true,noSessionRpc:true,idleRemainsArmed:true});console.log('PASS '+results.at(-1).name);
   }finally{for(const f of fixtures)await f.finish();if(context)await context.close();}
  }
  {
   const state=backend(),f=await boot(browser,state,'retry',{width:390});try{await f.login({password:'wrong'});await f.page.waitForFunction(()=>!__normalState.busy);assert.equal((await inspect(f)).ready,false);assert.equal(await f.page.locator('#zc-cloud-submit').isEnabled(),true);await f.login();await f.ready();const baseline=await inspect(f);assert.equal(await f.page.evaluate(p=>zc86Cloud.verifyPassword(p),PASSWORD),true);assert.equal((await inspect(f)).sessionId,baseline.sessionId);assert.equal((await inspect(f)).ready,true);const beforeRestore=state.passwordCalls.length;await f.page.reload({waitUntil:'networkidle'});await f.ready();assert.equal(state.passwordCalls.length,beforeRestore);assert.equal((await inspect(f)).sessionId,baseline.sessionId);assert.equal((await inspect(f)).clientCount,1);assert(state.rpcCalls.every(c=>!/^snote_session_/.test(c.name)));results.push({name:'wrong password retries, isolated password check and remembered restore use ordinary Auth',noSessionRpc:true});console.log('PASS '+results.at(-1).name);
   }finally{await f.finish();}
  }
  {
   const state=backend(),a=await boot(browser,state,'logout-A'),b=await boot(browser,state,'logout-B');try{await a.login();await a.ready();await b.login();await b.ready();const sidB=(await inspect(b)).sessionId;a.page.removeAllListeners('dialog');a.page.once('dialog',d=>void d.accept());await a.page.evaluate(()=>zc86Cloud.signOut());await a.page.waitForFunction(()=>!__normalState.ready);assert.equal((await inspect(b)).ready,true);assert.equal(state.sessions.get(sidB).live,true);assert.equal(state.logouts.length,1);results.push({name:'explicit logout ends only the current browser session',otherBrowserPreserved:true});console.log('PASS '+results.at(-1).name);
   }finally{await a.finish();await b.finish();}
  }
  {
   const state=backend(),f=await boot(browser,state,'idle',{clock:true});try{await f.login();await f.ready();const baseline=await inspect(f);assert.equal(baseline.minutes,30);await f.page.clock.fastForward(31*60000);await f.page.waitForFunction(()=>!__normalState.ready&&currentUser===null);assert.equal(await f.page.locator('#zc-cloud-login').isVisible(),true);assert.equal(state.logouts.length,1);assert.equal(state.sessions.get(baseline.sessionId).live,false);assert(state.rpcCalls.every(c=>!/^snote_session_/.test(c.name)));results.push({name:'the existing30-minute inactivity logout still clears only its own session',idleExpiryPreserved:true});console.log('PASS '+results.at(-1).name);
   }finally{await f.finish();}
  }
  assert.deepEqual(hashes(),before,'Product source changed during verification');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:before,results,syntheticOnly:true,realExternalRequests:0},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
