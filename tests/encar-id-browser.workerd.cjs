'use strict';
// Native Workers WebSocket and short-lived browser reuse, entirely within
// synthetic service-bound workers. No account/provider/customer is accessed.
// NODE_PATH=/path/to/test-tools/node_modules node tests/encar-id-browser.workerd.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const root=path.resolve(__dirname,'..');
const entry=`
import {createBrowserSession} from './transport.mjs';
export default{async fetch(request,env,context){
 const trace=[];let browser,retained=0;
 const token=new URL(request.url).searchParams.get('fresh')==='1'?'synthetic-cold-browser-token':'synthetic-browser-token';
 try{
  browser=await createBrowserSession({CLOUDFLARE_ACCOUNT_ID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',CLOUDFLARE_BROWSER_TOKEN:token},{waitUntil:promise=>{retained++;context.waitUntil(promise);},fetchImpl:async(url,options)=>{trace.push({url,method:options?.method||'GET'});return env.MOCK_CDP.fetch(url,options);}});
  const page=await browser.newPage();
  await page.goto('https://carnect.biz/catalog?tab=encar');await page.keypress('Enter');
  const value=await page.evaluate('"synthetic"');await page.close();
  return Response.json({value,trace,retained});
 }catch(error){return Response.json({code:error.code,message:error.message,trace,retryAfter:error.retryAfter,retained},{status:500});}
 finally{if(browser)await browser.close();}
}};`;
const upstream=`
const SESSION='1909cef7-23e8-4394-bc31-27404bf4348f';
const BASE='https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/browser-run/devtools/browser';
const stats={creates:0,connects:0,contexts:[],disposed:[],closedBrowsers:0,targets:[],commands:[],requests:[],guardrails:null,unexpected:[]};
const active=new Set();let nextContext=0,nextTarget=0,mode='normal';
export default{async fetch(request){
 const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){if(url.pathname==='/mode')mode=url.searchParams.get('mode')||'normal';return Response.json({...stats,activeContexts:[...active]});}
 stats.requests.push({url:request.url,method:request.method});
 if(!['Bearer synthetic-browser-token','Bearer synthetic-cold-browser-token'].includes(request.headers.get('Authorization')))return new Response('rejected',{status:403});
 if(request.url===BASE+'?keep_alive=30000'&&request.method==='POST'){
  const body=await request.json();stats.creates++;stats.guardrails=body.guardrails;
  if(!stats.guardrails||stats.guardrails.allowedDomains.includes('fem.encar.com'))return new Response('unguarded',{status:400});
  if(mode==='create_daily')return Response.json({errors:[{message:'Browser time limit exceeded for today'}]},{status:429,headers:{'Retry-After':'41'}});
  return Response.json({sessionId:SESSION,webSocketDebuggerUrl:'wss://foreign.invalid/must-not-be-used'});
 }
 if(request.url!==BASE+'/'+SESSION||request.headers.get('Upgrade')!=='websocket'){
  stats.unexpected.push({url:request.url,method:request.method});return new Response('unexpected',{status:502});
 }
 stats.connects++;
 if(mode==='connect_daily')return Response.json({errors:[{message:'Browser time limit exceeded for today'}]},{status:429,headers:{'Retry-After':'42'}});
 const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.accept();
 const ownContexts=new Set(),targets=new Map();
 socket.addEventListener('message',event=>{
  const command=JSON.parse(event.data);stats.commands.push(command.method);let result={};
  if(command.method==='Target.getBrowserContexts')result={browserContextIds:[...active]};
  if(command.method==='Target.createBrowserContext'){
   if(command.params.disposeOnDetach!==true)throw Error('Context must dispose on disconnect');
   const browserContextId='context-'+(++nextContext);active.add(browserContextId);ownContexts.add(browserContextId);stats.contexts.push(browserContextId);result={browserContextId};
  }
  if(command.method==='Target.disposeBrowserContext'){
   if(!ownContexts.has(command.params.browserContextId))throw Error('A lookup cannot dispose another context');
   active.delete(command.params.browserContextId);ownContexts.delete(command.params.browserContextId);stats.disposed.push(command.params.browserContextId);
  }
  if(command.method==='Target.createTarget'){
   if(command.params.url!=='about:blank'||!ownContexts.has(command.params.browserContextId))throw Error('Target must use own isolated context');
   const targetId='target-'+(++nextTarget);targets.set(targetId,command.params.browserContextId);stats.targets.push({targetId,browserContextId:command.params.browserContextId});result={targetId};
  }
  if(command.method==='Target.attachToTarget')result={sessionId:'session-'+command.params.targetId};
  if(command.method==='Target.closeTarget')result={success:true};
  if(command.method==='Browser.close')stats.closedBrowsers++;
  if(command.method==='Page.navigate')result={frameId:'native-frame',loaderId:'native-loader-'+nextTarget};
  if(command.method==='Runtime.evaluate')result={result:{value:{syntheticOnly:true,websocket:true}}};
  socket.send(JSON.stringify({id:command.id,...(command.sessionId?{sessionId:command.sessionId}:{}),result}));
  if(command.method==='Page.navigate')socket.send(JSON.stringify({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{...result,name:'DOMContentLoaded'}}));
 });
 socket.addEventListener('close',()=>{for(const context of ownContexts)active.delete(context);});
 return new Response(null,{status:101,webSocket:client});
}};`;
(async()=>{
 let outbound=0;
 const modules=[{type:'ESModule',path:'/id-browser-native/entry.mjs',contents:entry},{type:'ESModule',path:'/id-browser-native/transport.mjs',contents:fs.readFileSync(path.join(root,'functions/_shared/encar-id-browser.mjs'),'utf8')}];
 for(const filename of ['encar-id-browser-session.mjs','encar-id-browser-limits.mjs','api-security.js']){const file=path.join(root,'functions/_shared',filename);if(fs.existsSync(file))modules.push({type:'ESModule',path:'/id-browser-native/'+filename,contents:fs.readFileSync(file,'utf8')});}
 const options={workers:[
  {name:'client',modulesRoot:'/id-browser-native',modules,serviceBindings:{MOCK_CDP:'cdp-fixture'},compatibilityDate:'2026-10-01'},
  {name:'cdp-fixture',modulesRoot:'/id-browser-native',modules:[{type:'ESModule',path:'/id-browser-native/cdp-fixture.mjs',contents:upstream}],compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('No outbound calls allowed',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 try{
  const lookup=async()=>{const response=await runtime.dispatchFetch('https://native-id-browser.example');const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.value.syntheticOnly,true);assert.equal(result.value.websocket,true);assert(result.retained>0,'Metadata writes must retain their complete native event lifetime');};
  await Promise.all([lookup(),lookup(),lookup()]);await lookup();
  const fixture=await runtime.getWorker('cdp-fixture');const stats=await(await fixture.fetch('https://fixture.internal/stats')).json();
  assert.deepEqual(stats.unexpected,[]);assert.equal(stats.creates,1,'Repeated and concurrent lookups must reuse one app-created browser');assert.equal(stats.connects,4);assert.equal(stats.contexts.length,4);assert.equal(new Set(stats.contexts).size,4);assert.deepEqual(stats.disposed.slice().sort(),stats.contexts.slice().sort());assert.deepEqual(stats.activeContexts,[]);assert.equal(stats.closedBrowsers,0,'Normal release must disconnect rather than terminate the shared browser');assert.equal(stats.targets.length,4);assert.deepEqual(stats.targets.map(t=>t.browserContextId).sort(),stats.contexts.slice().sort());assert.deepEqual(stats.guardrails.allowedDomainSets,['common-cdns']);assert.equal(stats.commands.filter(c=>c==='Input.dispatchKeyEvent').length,8);assert.equal(outbound,0);
  for(const[mode,fresh,retry]of[['connect_daily',false,42],['create_daily',true,41]]){
   await fixture.fetch('https://fixture.internal/mode?mode='+mode);
   const before=await(await fixture.fetch('https://fixture.internal/stats')).json();
   const response=await runtime.dispatchFetch('https://native-id-browser.example'+(fresh?'?fresh=1':'')),body=await response.json();
   const now=Date.now(),day=new Date(now),untilReset=Math.ceil((Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+1)-now)/1000);
   assert.equal(response.status,500);assert.equal(body.code,'BROWSER_DAILY_LIMIT');assert(body.retryAfter>=Math.max(retry,untilReset-2)&&body.retryAfter<=86400,'Respect upstream Retry-After and do not retry before the UTC daily reset');assert.equal(body.trace.length,1,'A daily exhaustion must not retry creation or connection');
   const after=await(await fixture.fetch('https://fixture.internal/stats')).json();
   assert.equal(after.creates-before.creates,fresh?1:0);assert.equal(after.connects-before.connects,fresh?0:1);assert.equal(after.contexts.length,before.contexts.length);assert.deepEqual(after.activeContexts,[]);
  }
  assert.equal(outbound,0);
  console.log('PASS native workerd Browser Run reuse/cache lifecycle: one cold acquisition, three concurrent and one warm isolated lookup, complete metadata write event retention, context cleanup/disconnect without Browser.close; official daily limits classified at creation/connection with Retry-After and no automatic retry; synthetic service binding only, outbound=0.');
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
