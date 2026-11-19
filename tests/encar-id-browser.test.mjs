import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createBrowserSession } from '../functions/_shared/encar-id-browser.mjs';

// Workers' documented response.webSocket contract is emulated here. These
// fixtures do not authenticate Cloudflare or visit a live provider.
const ENV={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-secret'};
const ID='11111111-1111-4111-8111-111111111111';let contextSerial=0;
function cachesFixture(){const records=new Map();return{async open(){return{async match(key){return records.get(String(key))?.clone();},async put(key,response){records.set(String(key),response.clone());},async delete(key){return records.delete(String(key));}};}};}
const sessionResponse=(id=ID)=>Response.json({sessionId:id,webSocketDebuggerUrl:'wss://foreign.invalid/ignored'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function flush(){await setImmediate();}
class Socket extends EventTarget{
 constructor(handler){super();this.handler=handler;this.commands=[];this.accepted=0;this.closed=0;this.targets=0;}
 accept(){this.accepted++;}
 close(code,reason){this.closed++;assert.equal(code,1000);assert.equal(reason,'Lookup finished');}
 emit(data){this.dispatchEvent(new MessageEvent('message',{data:typeof data==='string'?data:JSON.stringify(data)}));}
 send(text){
  const command=JSON.parse(text);this.commands.push(command);
  if(this.handler?.(command,this)===false)return;
  const result=command.method==='Target.createBrowserContext'?{browserContextId:'context-'+(++contextSerial)}:command.method==='Target.createTarget'?{targetId:'target-'+(++this.targets)}:command.method==='Target.attachToTarget'?{sessionId:'session-'+command.params.targetId}:command.method==='Target.closeTarget'?{success:true}:command.method==='Page.navigate'?{frameId:'frame-1',loaderId:'loader-'+command.id}:command.method==='Runtime.evaluate'?{result:{value:{plate:'12가3456',id:'43123456'}}}:{};
  queueMicrotask(()=>{this.emit({id:command.id,...(command.sessionId?{sessionId:command.sessionId}:{}),result});if(command.method==='Page.navigate')this.emit({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{frameId:result.frameId,loaderId:result.loaderId,name:'DOMContentLoaded'}});});
 }
}
async function fixture(options={}){
 const socket=options.socket||new Socket(options.handler),requests=[];
 const fetchImpl=async(url,init)=>{requests.push({url,init});return init.method==='POST'?sessionResponse():{status:101,webSocket:socket};};
 const browser=await createBrowserSession(ENV,{fetchImpl,signal:options.signal,cacheStorage:cachesFixture()});return{socket,requests,browser};
}

test('one authenticated guarded WebSocket supports all three provider pages without a relaunch',async()=>{
 const f=await fixture();try{
  assert.equal(f.requests.length,2);const request=f.requests[0];assert.equal(request.url,'https://api.cloudflare.com/client/v4/accounts/'+ENV.CLOUDFLARE_ACCOUNT_ID+'/browser-run/devtools/browser?keep_alive=30000');assert.equal(request.init.method,'POST');assert.equal(request.init.redirect,'manual');assert.equal(request.init.headers.Authorization,'Bearer '+ENV.CLOUDFLARE_BROWSER_TOKEN);assert.equal(f.requests[1].url,'https://api.cloudflare.com/client/v4/accounts/'+ENV.CLOUDFLARE_ACCOUNT_ID+'/browser-run/devtools/browser/'+ID);assert.equal(f.requests[1].init.headers.Upgrade,'websocket');
  const policy=JSON.parse(request.init.body).guardrails;assert.deepEqual(policy.allowedDomains,['carnect.biz','*.carnect.biz','gloar-data.com','*.gloar-data.com','encar.spb.ru']);assert.deepEqual(policy.allowedDomainSets,['common-cdns']);assert.equal(f.socket.accepted,1);
  for(const url of['https://carnect.biz/catalog?tab=encar','https://gloar-data.com/en/catalog','https://encar.spb.ru/catalog/']){
   const page=await f.browser.newPage();await page.goto(url);assert.deepEqual(await page.evaluate('({plate:"12가3456",id:"43123456"})'),{plate:'12가3456',id:'43123456'});await page.keypress('Enter');await page.close();
  }
  assert.equal(f.requests.length,2);assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,3);assert.equal(f.socket.commands.filter(c=>c.method==='Target.closeTarget').length,3);assert.equal(f.socket.commands.filter(c=>c.method==='Input.dispatchKeyEvent').length,6);
 }finally{await f.browser.close();}assert.equal(f.socket.commands.filter(c=>c.method==='Target.disposeBrowserContext').length,1);assert.equal(f.socket.closed,1);
});

test('missing or malformed server credentials cannot open any socket or leak their contents',async()=>{
 let calls=0;for(const env of[{}, {...ENV,CLOUDFLARE_ACCOUNT_ID:'https://foreign.invalid'}, {...ENV,CLOUDFLARE_BROWSER_TOKEN:''}, {...ENV,CLOUDFLARE_BROWSER_TOKEN:'secret\nheader'}, {...ENV,CLOUDFLARE_BROWSER_TOKEN:'x'.repeat(4097)}]){
  await assert.rejects(createBrowserSession(env,{fetchImpl:()=>{calls++;}}),e=>e.code==='LOOKUP_NOT_CONFIGURED'&&!e.message.includes('secret')&&!e.message.includes('foreign'));
 }assert.equal(calls,0);
});

test('Cloudflare 429 is not retried and exposes only a bounded Retry-After',async()=>{
 for(const retry of['42','9999999999','invalid']){let calls=0;
  await assert.rejects(createBrowserSession(ENV,{fetchImpl:async()=>{calls++;return new Response('PRIVATE_TOKEN',{status:429,headers:{'Retry-After':retry}});}}),e=>e.code==='UPSTREAM_RATE_LIMITED'&&e.retryAfter===(retry==='42'?42:retry==='9999999999'?3600:20)&&!e.message.includes('PRIVATE'));
  assert.equal(calls,1);
 }
});

test('failed authentication or an invalid upgrade is never retried or followed to another endpoint',async()=>{
 for(const status of[302,401,403,500]){const calls=[];
  await assert.rejects(createBrowserSession(ENV,{fetchImpl:async(...args)=>{calls.push(args);return new Response('PRIVATE_FAILURE',{status,headers:{Location:'https://foreign.invalid'}});}}),e=>e.code==='BROWSER_UNAVAILABLE'&&!e.message.includes('PRIVATE'));
  assert.equal(calls.length,1);assert.equal(calls[0][1].redirect,'manual');
 }
});

test('late connections after caller cancellation disconnect without destroying the shared browser',async()=>{
 const controller=new AbortController(),late=deferred(),socket=new Socket(),waiting=deferred();let calls=0;
 const starting=createBrowserSession(ENV,{signal:controller.signal,cacheStorage:cachesFixture(),fetchImpl:(url,init)=>{calls++;if(init.method==='POST')return Promise.resolve(sessionResponse());waiting.resolve();return late.promise;}});await waiting.promise;controller.abort();await assert.rejects(starting,e=>e.code==='ABORTED'&&e.name==='AbortError');
 late.resolve({status:101,webSocket:socket});await flush();assert.equal(calls,2);assert.equal(socket.accepted,1);assert.deepEqual(socket.commands,[]);assert.equal(socket.closed,1);
});

test('connection timeout cancels an uncooperative fetch without retrying acquisition',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const late=deferred(),socket=new Socket(),waiting=deferred();let request,calls=0;
 const starting=createBrowserSession(ENV,{cacheStorage:cachesFixture(),fetchImpl:(url,init)=>{calls++;if(init.method==='POST')return Promise.resolve(sessionResponse());request=init;waiting.resolve();return late.promise;}});await waiting.promise;t.mock.timers.tick(8000);
 await assert.rejects(starting,e=>e.code==='BROWSER_UNAVAILABLE');assert.equal(request.signal.aborted,true);assert.equal(calls,2);
 late.resolve({status:101,webSocket:socket});await flush();assert.equal(socket.commands.filter(c=>c.method==='Browser.close').length,0);assert.equal(socket.closed,1);
});

test('page navigation rejects Korean Encar, arbitrary hosts, credentials, ports and non-HTTPS before sending commands',async()=>{
 const f=await fixture();try{const page=await f.browser.newPage();const before=f.socket.commands.length;
  for(const url of['https://fem.encar.com/cars/detail/43123456','https://foreign.invalid/','http://carnect.biz/catalog','https://carnect.biz.evil.invalid/','https://user:pass@carnect.biz/','https://carnect.biz:443/catalog','https://carnect.biz/catalog#fragment','https://127.0.0.1/','/catalog','https://carnect.biz\\@foreign.invalid/'])await assert.rejects(page.goto(url),e=>e.code==='PROVIDER_UNSUPPORTED');
  assert.equal(f.socket.commands.length,before);await page.close();
 }finally{await f.browser.close();}
});

test('out-of-order command responses are matched to the flattened page session',async()=>{
 const held=[];const f=await fixture({handler:(command,socket)=>{if(command.method==='Runtime.evaluate'){held.push(command);return false;}}});
 try{const first=await f.browser.newPage(),second=await f.browser.newPage();const a=first.evaluate('"first"'),b=second.evaluate('"second"');await flush();
  for(const command of held.slice().reverse())f.socket.emit({id:command.id,sessionId:command.sessionId,result:{result:{value:command.params.expression}}});
  assert.deepEqual(await Promise.all([a,b]),['"first"','"second"']);await first.close();await second.close();
 }finally{await f.browser.close();}
});

test('goto waits for the destination loader DOM readiness instead of returning at Page.navigate acknowledgement',async()=>{
 let navigation;const f=await fixture({handler:(command,socket)=>{if(command.method==='Page.navigate'){navigation=command;queueMicrotask(()=>{socket.emit({id:command.id,sessionId:command.sessionId,result:{frameId:'main-frame',loaderId:'destination-loader'}});socket.emit({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{frameId:'main-frame',loaderId:'old-about-blank-loader',name:'DOMContentLoaded'}});});return false;}}});
 try{const page=await f.browser.newPage();let ready=false;const loading=page.goto('https://carnect.biz/catalog?tab=encar').then(()=>{ready=true;});await flush();assert.equal(ready,false);
  f.socket.emit({method:'Page.lifecycleEvent',sessionId:navigation.sessionId,params:{frameId:'main-frame',loaderId:'destination-loader',name:'DOMContentLoaded'}});await loading;assert.equal(ready,true);await page.close();
 }finally{await f.browser.close();}
});

test('destination lifecycle events arriving before the navigation acknowledgement are retained',async()=>{
 const f=await fixture({handler:(command,socket)=>{if(command.method==='Page.navigate'){queueMicrotask(()=>{socket.emit({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{frameId:'early-frame',loaderId:'early-loader',name:'DOMContentLoaded'}});socket.emit({id:command.id,sessionId:command.sessionId,result:{frameId:'early-frame',loaderId:'early-loader'}});});return false;}}});
 try{const page=await f.browser.newPage();await page.goto('https://gloar-data.com/en/catalog');await page.close();}finally{await f.browser.close();}
});

test('provider cancellation settles a destination lifecycle wait and closes that target',async()=>{
 const controller=new AbortController();const f=await fixture({handler:(command,socket)=>{if(command.method==='Page.navigate'){queueMicrotask(()=>socket.emit({id:command.id,sessionId:command.sessionId,result:{frameId:'pending-frame',loaderId:'pending-loader'}}));return false;}}});
 try{const page=await f.browser.newPage({signal:controller.signal}),loading=page.goto('https://encar.spb.ru/catalog/');await flush();controller.abort();await assert.rejects(loading,e=>e.code==='ABORTED');assert(f.socket.commands.some(c=>c.method==='Target.closeTarget'));}finally{await f.browser.close();}
});

test('provider cancellation closes its page before another target is created, without closing the shared browser',async()=>{
 const controller=new AbortController(),held=[];const f=await fixture({handler:command=>{if(command.method==='Runtime.evaluate'){held.push(command);return false;}}});
 try{const old=await f.browser.newPage({signal:controller.signal}),pending=old.evaluate('"late"');await flush();controller.abort();await assert.rejects(pending,e=>e.code==='ABORTED');
  const next=await f.browser.newPage();const methods=f.socket.commands.map(c=>c.method),closeAt=methods.indexOf('Target.closeTarget'),nextAt=methods.lastIndexOf('Target.createTarget');assert(closeAt>=0&&closeAt<nextAt);assert.equal(methods.filter(m=>m==='Browser.close').length,0);
  const command=held[0];f.socket.emit({id:command.id,sessionId:command.sessionId,result:{result:{value:'ignored'}}});await next.close();
 }finally{await f.browser.close();}
});

test('overall cancellation rejects pending work and disposes only this lookup context once',async()=>{
 const controller=new AbortController();const f=await fixture({signal:controller.signal,handler:command=>command.method!=='Runtime.evaluate'});const page=await f.browser.newPage(),pending=page.evaluate('"held"');await flush();controller.abort();await assert.rejects(pending,e=>e.code==='ABORTED');await f.browser.close();await f.browser.close();assert.equal(f.socket.commands.filter(c=>c.method==='Target.disposeBrowserContext').length,1);assert.equal(f.socket.closed,1);await assert.rejects(f.browser.newPage(),e=>e.code==='ABORTED');
});

test('the next provider waits for an acknowledged old-page destruction before creating its target',async()=>{
 const controller=new AbortController(),held=[];const f=await fixture({handler:command=>{if(command.method==='Target.closeTarget'){held.push(command);return false;}}});
 try{await f.browser.newPage({signal:controller.signal});controller.abort();const next=f.browser.newPage();await flush();assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,1);
  f.socket.emit({id:held[0].id,result:{success:true}});const page=await next;assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,2);
  // Context disposal below releases the second page without another page-close ack.
  assert(page);
 }finally{await f.browser.close();}
});

test('an about:blank target arriving after its creation was cancelled is released and never navigated',async()=>{
 const controller=new AbortController();let held,first=true;const f=await fixture({handler:command=>{if(command.method==='Target.createTarget'&&first){first=false;held=command;return false;}}});
 try{const old=f.browser.newPage({signal:controller.signal});await flush();controller.abort();await assert.rejects(old,e=>e.code==='ABORTED');const next=await f.browser.newPage();
  f.socket.emit({id:held.id,result:{targetId:'late-blank-target'}});await flush();assert(f.socket.commands.some(c=>c.method==='Target.closeTarget'&&c.params.targetId==='late-blank-target'));assert(!f.socket.commands.some(c=>c.method==='Target.attachToTarget'&&c.params.targetId==='late-blank-target'));await next.close();
 }finally{await f.browser.close();}
});

test('a failed page-destruction acknowledgement ends this lookup context rather than overlapping providers',async()=>{
 const controller=new AbortController();const f=await fixture({handler:(command,socket)=>{if(command.method==='Target.closeTarget'){queueMicrotask(()=>socket.emit({id:command.id,result:{success:false}}));return false;}}});
 await f.browser.newPage({signal:controller.signal});controller.abort();await assert.rejects(f.browser.newPage(),e=>e.code==='BROWSER_UNAVAILABLE');await f.browser.close();assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,1);assert.equal(f.socket.closed,1);
});

test('malformed, oversize and session-mismatched CDP replies fail closed without echoing remote content',async()=>{
 for(const bad of['{broken','x'.repeat(1024*1024+1),'wrong-session']){
  const f=await fixture({handler:(command,socket)=>{if(command.method==='Runtime.evaluate'){queueMicrotask(()=>socket.emit(bad==='wrong-session'?{id:command.id,sessionId:'wrong',result:{result:{value:'PRIVATE_DATA'}}}:bad));return false;}}});
  const page=await f.browser.newPage();await assert.rejects(page.evaluate('"held"'),e=>e.code==='BROWSER_UNAVAILABLE'&&!e.message.includes('PRIVATE'));await f.browser.close();assert.equal(f.socket.closed,1);
 }
});

test('unresponsive cleanup is bounded and closed pages cannot issue new commands',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture({handler:command=>!['Target.closeTarget','Target.disposeBrowserContext'].includes(command.method)});
 const page=await f.browser.newPage(),closing=page.close();await flush();t.mock.timers.tick(500);await closing;
 const before=f.socket.commands.length;await assert.rejects(page.evaluate('"closed"'));assert.equal(f.socket.commands.length,before);
 const all=f.browser.close();await flush();t.mock.timers.tick(500);await all;assert.equal(f.socket.closed,1);
});

test('repeated and concurrent lookups reuse one created browser with separate connections and contexts',async()=>{
 const storage=cachesFixture(),requests=[],sockets=[];let creates=0;
 const fetchImpl=async(url,init)=>{requests.push({url,init});if(init.method==='POST'){creates++;await flush();return sessionResponse();}const socket=new Socket();sockets.push(socket);return{status:101,webSocket:socket};};
 const first=await createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});await first.close();
 const others=await Promise.all([createBrowserSession(ENV,{fetchImpl,cacheStorage:storage}),createBrowserSession(ENV,{fetchImpl,cacheStorage:storage})]);await Promise.all(others.map(browser=>browser.close()));
 assert.equal(creates,1);assert.equal(sockets.length,3);const contexts=sockets.flatMap(socket=>socket.commands.filter(c=>c.method==='Target.createBrowserContext'));assert.equal(contexts.length,3);assert(contexts.every(c=>c.params.disposeOnDetach===true));
 for(const socket of sockets){assert.equal(socket.commands.filter(c=>c.method==='Target.disposeBrowserContext').length,1);assert.equal(socket.commands.filter(c=>c.method==='Browser.close').length,0);assert.equal(socket.closed,1);}
 assert(requests.every(request=>request.url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+ENV.CLOUDFLARE_ACCOUNT_ID+'/browser-run/devtools/browser')));
});

test('cold concurrent requests single-flight only session metadata and create fresh sockets',async()=>{
 const storage=cachesFixture(),post=deferred(),waiting=deferred(),sockets=[];let creates=0;
 const fetchImpl=async(url,init)=>{if(init.method==='POST'){creates++;waiting.resolve();return post.promise;}const socket=new Socket();sockets.push(socket);return{status:101,webSocket:socket};};
 const first=createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});await waiting.promise;const second=createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});post.resolve(sessionResponse());
 const browsers=await Promise.all([first,second]);assert.equal(creates,1);assert.equal(sockets.length,2);await Promise.all(browsers.map(browser=>browser.close()));
});

test('cancelled caller stops waiting while another caller may use the one metadata acquisition',async()=>{
 const storage=cachesFixture(),post=deferred(),waiting=deferred(),controller=new AbortController(),retained=[];let creates=0,connections=0;
 const fetchImpl=async(url,init)=>{if(init.method==='POST'){creates++;waiting.resolve();return post.promise;}connections++;return{status:101,webSocket:new Socket()};};
 const first=createBrowserSession(ENV,{fetchImpl,cacheStorage:storage,signal:controller.signal,waitUntil:promise=>retained.push(promise)});await waiting.promise;const second=createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});controller.abort();await assert.rejects(first,error=>error.code==='ABORTED');post.resolve(sessionResponse());const browser=await second;await browser.close();assert.equal(creates,1);assert.equal(connections,1);assert.equal(retained.length,1);await retained[0];
});

test('a named-cache record can reconnect a known session without reusing request-owned I/O',async()=>{
 const records=new Map(),storage=()=>({async open(){return{async match(key){return records.get(String(key))?.clone();},async put(key,response){records.set(String(key),response.clone());},async delete(key){return records.delete(String(key));}};}});
 let creates=0,connects=0;const fetchImpl=async(url,init)=>{if(init.method==='POST'){creates++;return sessionResponse();}connects++;return{status:101,webSocket:new Socket()};};
 const first=await createBrowserSession(ENV,{fetchImpl,cacheStorage:storage()});await first.close();const second=await createBrowserSession(ENV,{fetchImpl,cacheStorage:storage()});await second.close();assert.equal(creates,1);assert.equal(connects,2);for(const value of records.values()){const text=await value.clone().text();assert(!text.includes(ENV.CLOUDFLARE_BROWSER_TOKEN));assert(!text.includes('webSocketDebuggerUrl'));}
});

test('an explicitly expired known session is replaced at most once without trying arbitrary sessions',async()=>{
 for(const expired of[404,410]){
  const storage=cachesFixture(),requests=[];let creates=0,oldConnections=0;const replacement='22222222-2222-4222-8222-222222222222';
  const fetchImpl=async(url,init)=>{requests.push({url,init});if(init.method==='POST')return sessionResponse(++creates===1?ID:replacement);if(url.endsWith('/'+ID)&&++oldConnections>1)return new Response('expired',{status:expired});return{status:101,webSocket:new Socket()};};
  const first=await createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});await first.close();const second=await createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});await second.close();assert.equal(creates,2);assert.equal(requests.filter(request=>request.init.method==='GET').length,3);assert(requests.at(-1).url.endsWith('/'+replacement));
 }
});

test('an existing connection rate limit or busy response preserves its known browser without a relaunch',async()=>{
 for(const [status,code]of[[429,'UPSTREAM_RATE_LIMITED'],[409,'BROWSER_BUSY']]){
  const storage=cachesFixture();let creates=0,connects=0;
  const fetchImpl=async(url,init)=>{if(init.method==='POST'){creates++;return sessionResponse();}if(++connects===1)return new Response('PRIVATE_PROVIDER',{status,headers:{'Retry-After':'31'}});return{status:101,webSocket:new Socket()};};
  await assert.rejects(createBrowserSession(ENV,{fetchImpl,cacheStorage:storage}),error=>error.code===code&&error.retryAfter===31&&!error.message.includes('PRIVATE'));const next=await createBrowserSession(ENV,{fetchImpl,cacheStorage:storage});await next.close();assert.equal(creates,1);assert.equal(connects,2);
 }
});

test('the complete acquisition deadline bounds a slow trickling body and cancels its reader',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const started=deferred();let read=0,cancelled=0,signal;
 const response={ok:true,status:200,headers:new Headers({'Content-Type':'application/json'}),body:{getReader(){return{read(){started.resolve();return new Promise(resolve=>setTimeout(()=>resolve({done:false,value:new TextEncoder().encode(' ')}),2000));},cancel(){cancelled++;return Promise.resolve();},releaseLock(){}};}}};
 const lookup=createBrowserSession(ENV,{cacheStorage:cachesFixture(),fetchImpl:async(url,init)=>{assert.equal(init.method,'POST');signal=init.signal;return response;}});const failed=assert.rejects(lookup,error=>error.code==='BROWSER_UNAVAILABLE');await started.promise;
 for(let step=0;step<4;step++){t.mock.timers.tick(2000);await flush();}
 await failed;assert.equal(signal.aborted,true);assert(cancelled>0);
});

test('only known navigation-context CDP errors are transient; script failures stay failures',async()=>{
 for(const [reply,expected]of[[{error:{code:-32000,message:'Execution context was destroyed.'}},'PAGE_CONTEXT_UNAVAILABLE'],[{error:{code:-32000,message:'PRIVATE arbitrary failure'}},'BROWSER_UNAVAILABLE'],[{result:{exceptionDetails:{text:'ReferenceError PRIVATE_SCRIPT'}}},'PROVIDER_UNAVAILABLE']]){
  const f=await fixture({handler:(command,socket)=>{if(command.method==='Runtime.evaluate'){queueMicrotask(()=>socket.emit({id:command.id,sessionId:command.sessionId,...reply}));return false;}}});
  try{const page=await f.browser.newPage();await assert.rejects(page.evaluate('fixed code'),error=>error.code===expected&&!error.message.includes('PRIVATE'));await page.close();}finally{await f.browser.close();}
 }
});

test('a new browser whose first connection fails with 404 is not launched again',async()=>{
 let created=0,connected=0;
 await assert.rejects(createBrowserSession(ENV,{cacheStorage:cachesFixture(),fetchImpl:async(url,init)=>{if(init.method==='POST'){created++;return sessionResponse();}connected++;return new Response('new connection failed',{status:404});}}),error=>error.code==='BROWSER_UNAVAILABLE');assert.equal(created,1);assert.equal(connected,1);
});
