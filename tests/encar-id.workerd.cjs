'use strict';
// Actual compiled Pages route, native Workers fetch/WebSocket/CDP and actual
// serialized provider actions against synthetic local DOM. No real outbound.
// NODE_PATH=/path/to/tools/node_modules node tests/encar-id.workerd.cjs <pages-build>
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const{JSDOM}=require(path.join(__dirname,'encar/node_modules/jsdom'));
const ORIGIN='https://native-id-api.example',USER='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const PLATE='12가3456',ID='43123456',SECOND_PLATE='28오6877',SECOND_ID='43156966',DETAIL='https://gloar-data.com/en/lot/native-opaque-key-99999999';
const ENV={SUPABASE_URL:'https://native-id-auth.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-token'};
const fixture=`
const SESSION='1909cef7-23e8-4394-bc31-27404bf4348f',BASE='https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/browser-run/devtools/browser';
let mode='found',stats,nextContext=0,nextTarget=0;
const reset=()=>{stats={auth:0,members:0,creates:0,connects:0,contexts:[],disposed:[],navigations:[],commands:[],guardrails:[],unexpected:[]};};reset();
export default{async fetch(request,env){
 const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){if(url.pathname==='/reset'){mode=url.searchParams.get('mode')||'found';reset();}return Response.json(stats);}
 if(url.origin==='https://native-id-auth.supabase.co'){
  if(request.method!=='GET'||request.headers.get('Authorization')!=='Bearer ${JWT}'||request.headers.get('apikey')!=='synthetic-public-key')throw Error('Auth must be read-only and use requesting account');
  if(url.pathname==='/auth/v1/user'){stats.auth++;return mode==='auth_error'?new Response('PRIVATE_AUTH',{status:503}):Response.json({id:'${USER}'});}
  if(url.pathname==='/rest/v1/zc_members'){stats.members++;if(url.searchParams.get('user_id')!=='eq.${USER}'||url.searchParams.get('active')!=='eq.true'||url.searchParams.get('limit')!=='1')throw Error('Membership contract');return Response.json(mode==='denied'?[]:[{user_id:'${USER}',company_id:'${COMPANY}',role:'dealer',active:true}]);}
 }
 if(url.origin!=='https://api.cloudflare.com'){stats.unexpected.push({url:request.url,method:request.method});return new Response('Unexpected origin',{status:502});}
 if(!['Bearer synthetic-browser-token','Bearer synthetic-cold-browser-token'].includes(request.headers.get('Authorization')))throw Error('Browser must use server credentials');
 if(request.url===BASE+'?keep_alive=30000'&&request.method==='POST'){
  const body=await request.json();stats.creates++;stats.guardrails.push(body.guardrails);
  if(JSON.stringify(body.guardrails)!==JSON.stringify({allowedDomains:['gloar-data.com','*.gloar-data.com'],allowedDomainSets:['common-cdns']}))throw Error('GLOAR-only guardrails required');
  if(mode==='create_daily')return Response.json({success:false,errors:[{message:'Browser time limit exceeded for today'}]},{status:429,headers:{'Retry-After':'37'}});
  if(mode==='create_burst')return Response.json({success:false,errors:[{message:'Browser creation rate limit exceeded'}]},{status:429,headers:{'Retry-After':'38'}});
  return Response.json({sessionId:SESSION,webSocketDebuggerUrl:'wss://foreign.invalid/must-not-be-used'});
 }
 if(request.url!==BASE+'/'+SESSION||request.method!=='GET'||request.headers.get('Upgrade')!=='websocket'){stats.unexpected.push({url:request.url,method:request.method});return new Response('Unexpected browser call',{status:502});}
 stats.connects++;
 if(mode==='browser_limit')return new Response('PRIVATE_LIMIT',{status:429,headers:{'Retry-After':'31'}});
 if(mode==='browser_daily')return Response.json({success:false,errors:[{message:'Browser time limit exceeded for today'}]},{status:429,headers:{'Retry-After':'36'}});
 if(mode==='browser_busy')return new Response('PRIVATE_BUSY',{status:409,headers:{'Retry-After':'32'}});
 if(mode==='browser_auth')return new Response('PRIVATE_TOKEN',{status:403});
 const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.accept();
 const contexts=new Set(),targets=new Map(),attached=new Map();
 const dom=async(operation,fields={})=>{const response=await env.DOM.fetch('https://dom.fixture/'+operation,{method:'POST',body:JSON.stringify({mode,...fields})});const body=await response.json();if(!response.ok)throw Error(body.error||'DOM failure');return body;};
 socket.addEventListener('message',event=>{void(async()=>{
  const command=JSON.parse(event.data);stats.commands.push(command.method);let result={};
  if(command.method==='Target.createBrowserContext'){if(command.params.disposeOnDetach!==true)throw Error('Context must dispose on detach');const browserContextId='context-'+(++nextContext);contexts.add(browserContextId);stats.contexts.push(browserContextId);result={browserContextId};}
  if(command.method==='Target.createTarget'){if(command.params.url!=='about:blank'||!contexts.has(command.params.browserContextId))throw Error('Own isolated context required');const targetId='target-'+(++nextTarget);targets.set(targetId,command.params.browserContextId);result={targetId};}
  if(command.method==='Target.attachToTarget'){if(!targets.has(command.params.targetId))throw Error('Unknown target');const sessionId='page-'+command.params.targetId;attached.set(sessionId,command.params.targetId);result={sessionId};}
  const targetId=attached.get(command.sessionId);
  if(command.method==='Page.navigate'){const target=new URL(command.params.url);if(target.origin!=='https://gloar-data.com'||!/^\\/en(?:\\/lot\\/[A-Za-z0-9_-]+)?\\/?$/.test(target.pathname))throw Error('Fixed GLOAR navigation only');stats.navigations.push(command.params.url);await dom('navigate',{targetId,url:command.params.url});result={frameId:'frame-'+targetId,loaderId:'loader-'+command.id};}
  if(command.method==='Runtime.evaluate'){try{const evaluated=await dom('evaluate',{targetId,expression:command.params.expression});result={result:{value:evaluated.value}};}catch{result={exceptionDetails:{text:'Synthetic remote evaluation failed'}};}}
  if(command.method==='Input.dispatchKeyEvent'&&command.params.type==='keyDown')await dom('enter',{targetId});
  if(command.method==='Target.closeTarget'){await dom('close',{targetId:command.params.targetId});targets.delete(command.params.targetId);result={success:true};}
  if(command.method==='Target.disposeBrowserContext'){if(!contexts.has(command.params.browserContextId))throw Error('Cannot dispose another context');for(const[id,context]of targets)if(context===command.params.browserContextId){await dom('close',{targetId:id});targets.delete(id);}contexts.delete(command.params.browserContextId);stats.disposed.push(command.params.browserContextId);}
  if(command.method==='Browser.close')throw Error('Do not terminate reusable browser');
  socket.send(JSON.stringify({id:command.id,...(command.sessionId?{sessionId:command.sessionId}:{}),result}));
  if(command.method==='Page.navigate')socket.send(JSON.stringify({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{...result,name:'DOMContentLoaded'}}));
 })().catch(error=>{stats.unexpected.push({cdpError:String(error.message)});try{socket.close(1011,'Fixture failure');}catch{}});});
 return new Response(null,{status:101,webSocket:client});
}};`;
const windows=new Map(),domStats={evaluations:0,nameHelpers:0,enters:[],errors:[],navigations:[],closed:0};
function documentFor(url,mode){
 if(mode==='blocked')return '<!doctype html><title>Just a moment...</title><main>Verify you are human</main>';
 const header='<header><input id="headerSearchInput" placeholder="Enter 17-digit VIN, Lot #, or Plate..."></header>';
 if(!new URL(url).pathname.startsWith('/en/lot/'))return '<!doctype html><title>GLOAR DATA</title>'+header+'<main id="catalog">'+Array.from({length:12},(_,i)=>'<a href="/en/lot/old-'+i+'">Unchanged catalog '+i+'</a>').join('')+'</main><div id="search-portal"></div>';
 const plate=mode==='second_plate'?SECOND_PLATE:PLATE,id=mode==='second_plate'?SECOND_ID:ID,primary=['mismatch','related'].includes(mode)?'34나5678':plate;
 let html='<!doctype html><title>Synthetic GLOAR vehicle</title>'+header+'<main><h1>Synthetic Tesla</h1><p>Plate <span>'+primary.slice(0,2)+'</span><span>'+primary.slice(2)+'</span></p>';
 if(mode!=='no_id')html+='<a href="https://fem.encar.com/cars/detail/'+id+'">Source Encar</a>';
 if(mode==='ambiguous')html+='<a href="https://www.encar.com/dc/dc_cardetailview.do?carid=43111111">Second source</a>';
 html+='</main>';if(mode==='related')html+='<h2>Похожие автомобили</h2><article><p>'+plate+'</p><a href="https://fem.encar.com/cars/detail/'+id+'">Encar</a></article>';return html;
}
function makeWindow(targetId,url,mode){
 windows.get(targetId)?.close();const dom=new JSDOM(documentFor(url,mode),{url,runScripts:'outside-only'}),window=dom.window;
 Object.defineProperty(window.document,'readyState',{get:()=> 'complete',configurable:true});
 window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:100,height:24,top:0,left:0,right:100,bottom:24}];};
 const input=window.document.getElementById('headerSearchInput');if(input)input.addEventListener('keydown',event=>{
  if(event.key!=='Enter')return;domStats.enters.push({plate:input.value,focused:window.document.activeElement===input,url:window.location.href});
  const portal=window.document.getElementById('search-portal');if(!portal)return;
  if(mode==='not_found'){window.document.getElementById('catalog').replaceChildren();portal.innerHTML='<p>No results found</p>';}else portal.innerHTML='<a href="'+DETAIL+'">Matching search result '+input.value+'</a>';
 });windows.set(targetId,window);domStats.navigations.push(url);
}
async function domService(request){try{
 const operation=new URL(request.url).pathname.slice(1),body=await request.json();
 if(operation==='navigate'){makeWindow(body.targetId,body.url,body.mode);return WorkerResponse.json({ok:true});}
 if(operation==='close'){const window=windows.get(body.targetId);if(window){window.close();windows.delete(body.targetId);domStats.closed++;}return WorkerResponse.json({ok:true});}
 const window=windows.get(body.targetId);assert(window,'DOM target must exist');
 if(operation==='enter'){window.document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));return WorkerResponse.json({ok:true});}
 assert.equal(operation,'evaluate');domStats.evaluations++;if(body.expression.includes('__name'))domStats.nameHelpers++;
 assert.equal(window.__name,undefined,'Do not inject helper into fixture; production must serialize it');
 return WorkerResponse.json({value:await window.eval(body.expression)});
}catch(error){domStats.errors.push(String(error.stack||error));return WorkerResponse.json({error:String(error.message)},{status:500});}}
async function loadScript(filename){let script=fs.readFileSync(filename,'utf8');if(script.startsWith('--')){const boundary=script.split('\r\n')[0].slice(2),form=await new Response(script,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData(),metadata=JSON.parse(form.get('metadata'));script=await form.get(metadata.main_module).text();}return script;}
function checkRetry(response,code,minimum){
 const raw=response.headers.get('Retry-After');
 if(code!=='BROWSER_DAILY_LIMIT'){assert.equal(raw,minimum);return;}
 const now=Date.now(),day=new Date(now),untilReset=Math.ceil((Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+1)-now)/1000);
 const seconds=Number(raw);assert(Number.isInteger(seconds)&&seconds>=Math.max(Number(minimum),untilReset-2)&&seconds<=86400,'Daily Retry-After must honor the upstream header and not precede the UTC day reset');
}
(async()=>{
 const script=await loadScript(process.argv[2]);assert(script.includes('headerSearchInput'),'Compile actual GLOAR production route');assert(!script.includes('api.tavily.com'),'No search-engine fallback in production');
 const noToken={...ENV};delete noToken.CLOUDFLARE_BROWSER_TOKEN;
 const coldToken={...ENV,CLOUDFLARE_BROWSER_TOKEN:'synthetic-cold-browser-token'};
 let outbound=0;const options={workers:[
  ...[['api',ENV],['no-token-api',noToken],['cold-api',coldToken]].map(([name,bindings])=>({name,modulesRoot:'/native-gloar-api',modules:[{type:'ESModule',path:'/native-gloar-api/'+name+'.mjs',contents:script}],compatibilityDate:'2026-10-01',bindings,serviceBindings:{ASSETS:()=>new WorkerResponse('synthetic-static')},outboundService:'id-fixture'})),
  {name:'id-fixture',modulesRoot:'/native-gloar-api',modules:[{type:'ESModule',path:'/native-gloar-api/fixture.mjs',contents:fixture}],serviceBindings:{DOM:domService},compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('Actual outbound prohibited',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options),reports=[];
 try{
  const upstream=await runtime.getWorker('id-fixture'),noKey=await runtime.getWorker('no-token-api'),cold=await runtime.getWorker('cold-api');
  const requestOptions=(plate=PLATE)=>({method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify({plate})});
  const call=(plate=PLATE)=>runtime.dispatchFetch(ORIGIN+'/api/encar-id',requestOptions(plate));
  const state=async()=>{const s=await(await upstream.fetch('https://fixture.internal/stats')).json();assert.deepEqual(s.unexpected,[],'No unexpected network or CDP call');return s;};
  const reset=async mode=>{assert.equal(windows.size,0,'Previous request must release DOM target');await upstream.fetch('https://fixture.internal/reset?mode='+mode);};
  await reset('found');
  for(const[worker,configured]of[[null,true],[noKey,false]]){const response=worker?await worker.fetch(ORIGIN+'/api/encar-id'):await runtime.dispatchFetch(ORIGIN+'/api/encar-id');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,configured,provider:'gloar',release:'2.151'});}
  let s=await state();assert.equal(s.auth+s.members+s.creates+s.connects,0);reports.push({mode:'configuration',externalCalls:0});
  for(const[kind,status]of[['foreign-origin',403],['extra-url',400],['missing-auth',401]]){const init=requestOptions();if(kind==='foreign-origin')init.headers.Origin='https://foreign.invalid';if(kind==='extra-url')init.body=JSON.stringify({plate:PLATE,url:'https://foreign.invalid'});if(kind==='missing-auth')delete init.headers.Authorization;assert.equal((await runtime.dispatchFetch(ORIGIN+'/api/encar-id',init)).status,status);}
  s=await state();assert.equal(s.auth+s.members+s.creates+s.connects,0);reports.push({mode:'request-boundaries',externalCalls:0});
  for(const mode of['found','warm_found','second_plate','not_found','mismatch','related','no_id','ambiguous','blocked']){
   await reset(mode);const plate=mode==='second_plate'?SECOND_PLATE:PLATE,response=await call(plate),body=await response.json();s=await state();
   assert.equal(s.auth,1);assert.equal(s.members,1);assert.equal(s.connects,1);assert.equal(s.contexts.length,1);assert.deepEqual(s.disposed,s.contexts);assert.equal(windows.size,0);assert.equal(s.commands.filter(x=>x==='Target.closeTarget').length,1);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('X-Snote-Release'),'2.151');assert(!JSON.stringify(body).includes('PRIVATE'));
   if(['found','warm_found','second_plate'].includes(mode)){assert.equal(response.status,200,JSON.stringify({mode,body}));assert.deepEqual(body,{ok:true,status:'found',plate,id:mode==='second_plate'?SECOND_ID:ID,provider:'gloar'});if(mode==='warm_found')assert.equal(s.creates,0);assert.deepEqual(s.navigations,['https://gloar-data.com/en',DETAIL]);}
   else if(['not_found','mismatch','related'].includes(mode)){assert.equal(response.status,200,JSON.stringify({mode,body}));assert.equal(body.code,'NOT_FOUND');assert(!('id'in body));}
   else{assert.equal(response.status,502,JSON.stringify({mode,body}));assert.equal(body.code,({no_id:'GLOAR_ID_UNVERIFIED',ambiguous:'GLOAR_AMBIGUOUS',blocked:'GLOAR_ACCESS_BLOCKED'})[mode]);assert(!('id'in body));}
   reports.push({mode,status:response.status,creates:s.creates,connects:s.connects,navigations:s.navigations.length});
  }
  for(const[mode,status,code,retry]of[['browser_limit',429,'UPSTREAM_RATE_LIMITED','31'],['browser_daily',429,'BROWSER_DAILY_LIMIT','36'],['browser_busy',503,'BROWSER_BUSY','32'],['browser_auth',502,'BROWSER_AUTH_FAILED',null]]){
   await reset(mode);const response=await call(),body=await response.json();s=await state();assert.equal(response.status,status,JSON.stringify(body));assert.equal(body.code,code);if(retry)checkRetry(response,code,retry);assert.equal(s.connects,1);assert.equal(s.creates,0);assert.equal(s.contexts.length,0);assert(!JSON.stringify(body).includes('PRIVATE'));reports.push({mode,status,connects:1,retryAfter:response.headers.get('Retry-After')});
  }
  for(const[mode,code,retry]of[['create_daily','BROWSER_DAILY_LIMIT','37'],['create_burst','UPSTREAM_RATE_LIMITED','38']]){
   await reset(mode);const init=requestOptions();delete init.headers.Origin;
   const response=await cold.fetch(ORIGIN+'/api/encar-id',init),body=await response.json();s=await state();
   assert.equal(response.status,429,JSON.stringify({mode,body}));assert.equal(body.code,code);checkRetry(response,code,retry);
   assert.equal(s.auth,1);assert.equal(s.members,1);assert.equal(s.creates,1,'A blocked creation must not automatically relaunch');assert.equal(s.connects,0);assert.equal(s.contexts.length,0);
   assert(!JSON.stringify(body).includes('synthetic-cold-browser-token'));assert(!JSON.stringify(body).includes('Browser time limit exceeded for today'));
   reports.push({mode,status:429,creates:1,connects:0,retryAfter:response.headers.get('Retry-After')});
  }
  await reset('found');const init=requestOptions();delete init.headers.Origin;let response=await noKey.fetch(ORIGIN+'/api/encar-id',init),body=await response.json();s=await state();assert.equal(response.status,503,JSON.stringify(body));assert.equal(body.code,'LOOKUP_NOT_CONFIGURED');assert.equal(s.auth,1);assert.equal(s.members,1);assert.equal(s.creates+s.connects,0);reports.push({mode:'missing-server-token',status:response.status});
  for(const[mode,status,code]of[['denied',403,'STAFF_REQUIRED'],['auth_error',502,'AUTH_UNAVAILABLE']]){await reset(mode);response=await call();body=await response.json();s=await state();assert.equal(response.status,status);assert.equal(body.code,code);assert.equal(s.creates+s.connects,0);reports.push({mode,status});}
  assert.equal(outbound,0);assert.deepEqual(domStats.errors,[]);assert(domStats.nameHelpers>0,'Actual compiled serialized function must supply __name');assert(domStats.enters.length>=8);assert(domStats.enters.every(item=>item.focused&&[PLATE,SECOND_PLATE].includes(item.plate)&&item.url==='https://gloar-data.com/en'));assert(domStats.navigations.every(url=>new URL(url).origin==='https://gloar-data.com'));
  console.log('PASS native compiled GLOAR-only Pages lookup v2.151: server credentials, Auth/membership, native WebSocket/CDP, actual serialized DOM action, headerSearchInput+Enter, new result after unchanged catalog, primary plate/original ID proof, reuse/cleanup, upstream daily-vs-burst limits and Retry-After without automatic relaunch, auth/stage errors. Synthetic only; actual outbound=0.');
  console.log(JSON.stringify({reports,dom:{evaluations:domStats.evaluations,nameHelpers:domStats.nameHelpers,enters:domStats.enters.length,closed:domStats.closed},outbound}));
 }finally{for(const window of windows.values())window.close();windows.clear();await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
