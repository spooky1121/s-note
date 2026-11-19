import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createBrowserSession } from '../functions/_shared/encar-id-browser.mjs';

// Workers' documented response.webSocket contract is emulated here. These
// fixtures do not authenticate Cloudflare or visit a live provider.
const ENV={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-secret'};
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
  const result=command.method==='Target.createTarget'?{targetId:'target-'+(++this.targets)}:command.method==='Target.attachToTarget'?{sessionId:'session-'+command.params.targetId}:command.method==='Target.closeTarget'?{success:true}:command.method==='Page.navigate'?{frameId:'frame-1',loaderId:'loader-'+command.id}:command.method==='Runtime.evaluate'?{result:{value:{plate:'12가3456',id:'43123456'}}}:{};
  queueMicrotask(()=>{this.emit({id:command.id,...(command.sessionId?{sessionId:command.sessionId}:{}),result});if(command.method==='Page.navigate')this.emit({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{frameId:result.frameId,loaderId:result.loaderId,name:'DOMContentLoaded'}});});
 }
}
async function fixture(options={}){
 const socket=options.socket||new Socket(options.handler),requests=[];
 const fetchImpl=async(url,init)=>{requests.push({url,init});return{status:101,webSocket:socket};};
 const browser=await createBrowserSession(ENV,{fetchImpl,signal:options.signal});return{socket,requests,browser};
}

test('one authenticated guarded WebSocket supports all three provider pages without a relaunch',async()=>{
 const f=await fixture();try{
  assert.equal(f.requests.length,1);const request=f.requests[0];assert.equal(request.url,'https://api.cloudflare.com/client/v4/accounts/'+ENV.CLOUDFLARE_ACCOUNT_ID+'/browser-run/devtools/browser?keep_alive=10000');assert.equal(request.init.method,'GET');assert.equal(request.init.redirect,'manual');assert.equal(request.init.headers.Upgrade,'websocket');assert.equal(request.init.headers.Authorization,'Bearer '+ENV.CLOUDFLARE_BROWSER_TOKEN);
  const policy=JSON.parse(Buffer.from(request.init.headers['cf-brapi-guardrails'],'base64url').toString());assert.deepEqual(policy.allowedDomains,['carnect.biz','*.carnect.biz','gloar-data.com','*.gloar-data.com','encar.spb.ru']);assert.deepEqual(policy.allowedDomainSets,['common-cdns']);assert.equal(f.socket.accepted,1);
  for(const url of['https://carnect.biz/catalog?tab=encar','https://gloar-data.com/en/catalog','https://encar.spb.ru/catalog/']){
   const page=await f.browser.newPage();await page.goto(url);assert.deepEqual(await page.evaluate('({plate:"12가3456",id:"43123456"})'),{plate:'12가3456',id:'43123456'});await page.keypress('Enter');await page.close();
  }
  assert.equal(f.requests.length,1);assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,3);assert.equal(f.socket.commands.filter(c=>c.method==='Target.closeTarget').length,3);assert.equal(f.socket.commands.filter(c=>c.method==='Input.dispatchKeyEvent').length,6);
 }finally{await f.browser.close();}assert.equal(f.socket.commands.filter(c=>c.method==='Browser.close').length,1);assert.equal(f.socket.closed,1);
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

test('late acquired sessions after caller cancellation are explicitly destroyed without starting a provider',async()=>{
 const controller=new AbortController(),late=deferred(),socket=new Socket();let calls=0;
 const starting=createBrowserSession(ENV,{signal:controller.signal,fetchImpl:()=>{calls++;return late.promise;}});await flush();controller.abort();await assert.rejects(starting,e=>e.code==='ABORTED'&&e.name==='AbortError');
 late.resolve({status:101,webSocket:socket});await flush();assert.equal(calls,1);assert.equal(socket.accepted,1);assert.deepEqual(socket.commands.map(c=>c.method),['Browser.close']);assert.equal(socket.closed,1);
});

test('launch timeout cancels an uncooperative fetch and never retries acquisition',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const late=deferred(),socket=new Socket();let request;
 const starting=createBrowserSession(ENV,{fetchImpl:(url,init)=>{request=init;return late.promise;}});await flush();t.mock.timers.tick(8000);
 await assert.rejects(starting,e=>e.code==='BROWSER_UNAVAILABLE');assert.equal(request.signal.aborted,true);
 late.resolve({status:101,webSocket:socket});await flush();assert.equal(socket.commands.filter(c=>c.method==='Browser.close').length,1);assert.equal(socket.closed,1);
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

test('overall cancellation rejects pending work and closes the actual browser once',async()=>{
 const controller=new AbortController();const f=await fixture({signal:controller.signal,handler:command=>command.method!=='Runtime.evaluate'});const page=await f.browser.newPage(),pending=page.evaluate('"held"');await flush();controller.abort();await assert.rejects(pending,e=>e.code==='ABORTED');await f.browser.close();await f.browser.close();assert.equal(f.socket.commands.filter(c=>c.method==='Browser.close').length,1);assert.equal(f.socket.closed,1);await assert.rejects(f.browser.newPage(),e=>e.code==='ABORTED');
});

test('the next provider waits for an acknowledged old-page destruction before creating its target',async()=>{
 const controller=new AbortController(),held=[];const f=await fixture({handler:command=>{if(command.method==='Target.closeTarget'){held.push(command);return false;}}});
 try{await f.browser.newPage({signal:controller.signal});controller.abort();const next=f.browser.newPage();await flush();assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,1);
  f.socket.emit({id:held[0].id,result:{success:true}});const page=await next;assert.equal(f.socket.commands.filter(c=>c.method==='Target.createTarget').length,2);
  // The second page closes during Browser.close below; no queued close ack is required.
  assert(page);
 }finally{await f.browser.close();}
});

test('an about:blank target arriving after its creation was cancelled is released and never navigated',async()=>{
 const controller=new AbortController();let held,first=true;const f=await fixture({handler:command=>{if(command.method==='Target.createTarget'&&first){first=false;held=command;return false;}}});
 try{const old=f.browser.newPage({signal:controller.signal});await flush();controller.abort();await assert.rejects(old,e=>e.code==='ABORTED');const next=await f.browser.newPage();
  f.socket.emit({id:held.id,result:{targetId:'late-blank-target'}});await flush();assert(f.socket.commands.some(c=>c.method==='Target.closeTarget'&&c.params.targetId==='late-blank-target'));assert(!f.socket.commands.some(c=>c.method==='Target.attachToTarget'&&c.params.targetId==='late-blank-target'));await next.close();
 }finally{await f.browser.close();}
});

test('a failed page-destruction acknowledgement ends the browser rather than overlapping providers',async()=>{
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
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture({handler:command=>!['Target.closeTarget','Browser.close'].includes(command.method)});
 const page=await f.browser.newPage(),closing=page.close();await flush();t.mock.timers.tick(500);await closing;
 const before=f.socket.commands.length;await assert.rejects(page.evaluate('"closed"'));assert.equal(f.socket.commands.length,before);
 const all=f.browser.close();await flush();t.mock.timers.tick(500);await all;assert.equal(f.socket.closed,1);
});
