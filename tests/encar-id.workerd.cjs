'use strict';
// Actual Pages API + native Workers WebSockets/Cache API. All Auth and Browser
// Run replies are service-bound fixtures; no live account/provider is contacted.
// NODE_PATH=/path/to/test-tools/node_modules node tests/encar-id.workerd.cjs /tmp/pages.js
const assert=require('node:assert/strict'),fs=require('node:fs');
const{Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const{JSDOM}=require('./encar/node_modules/jsdom');
const ORIGIN='https://native-id-api.example',USER='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const ACCOUNT='a'.repeat(32),BROWSER_PATH='/client/v4/accounts/'+ACCOUNT+'/browser-run/devtools/browser';
const ENV={SUPABASE_URL:'https://native-id-auth.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-token'};
const fixture=`
let mode='carnect',stats,browserSerial=0,connectionSerial=0,contextSerial=0,targetSerial=0;
const browsers=new Map(),contexts=new Map();
const reset=()=>{stats={auth:0,members:0,creates:0,connects:0,commands:[],expressions:[],navigations:[],targets:0,closedTargets:0,createdContexts:[],disposedContexts:[],closedBrowsers:0,unexpected:[]};};reset();
export default{async fetch(request){
 const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){
  if(url.pathname==='/reset'){mode=url.searchParams.get('mode')||'carnect';if(url.searchParams.get('expire')==='1')browsers.clear();reset();}
  return Response.json({...stats,remainingContexts:[...contexts.keys()],browserCount:browsers.size});
 }
 if(url.origin==='https://native-id-auth.supabase.co'){
  if(request.method!=='GET'||request.headers.get('Authorization')!=='Bearer ${JWT}'||request.headers.get('apikey')!=='synthetic-public-key')throw Error('Synthetic Auth contract mismatch');
  if(url.pathname==='/auth/v1/user'){stats.auth++;return Response.json({id:'${USER}'});}
  if(url.pathname==='/rest/v1/zc_members'){stats.members++;return Response.json(mode==='denied'?[]:[{user_id:'${USER}',company_id:'${COMPANY}',role:'dealer',active:true}]);}
 }
 if(url.origin==='https://api.cloudflare.com'&&url.pathname.startsWith('${BROWSER_PATH}')){
  if(!['Bearer synthetic-browser-token','Bearer synthetic-browser-token-fresh'].includes(request.headers.get('Authorization')))throw Error('Synthetic browser authentication mismatch');
  if(url.pathname==='${BROWSER_PATH}'&&request.method==='POST'){
   stats.creates++;
   if(url.searchParams.get('keep_alive')!=='30000')throw Error('Unexpected browser inactivity window');
   const body=await request.json();if(Object.keys(body).join(',')!=='guardrails')throw Error('Only fixed guardrails may be sent');
   const domains=body.guardrails?.allowedDomains||[];
   if(domains.includes('fem.encar.com')||!domains.includes('carnect.biz')||!domains.includes('gloar-data.com')||!domains.includes('encar.spb.ru'))throw Error('Unsafe browser domains');
   if(mode==='limited_cold')return new Response('Synthetic cold limit',{status:429,headers:{'Retry-After':'29'}});
   const id='11111111-1111-4111-8111-'+String(++browserSerial).padStart(12,'0');if(mode!=='fresh_missing')browsers.set(id,{});
   // The production code must ignore a returned URL and use its fixed origin.
   return Response.json({sessionId:id,webSocketDebuggerUrl:'wss://untrusted-url.invalid/never-follow'});
  }
  const id=url.pathname.slice('${BROWSER_PATH}/'.length);
  if(request.method!=='GET'||!/^11111111-1111-4111-8111-[0-9]{12}$/.test(id)||request.headers.get('Upgrade')!=='websocket')throw Error('Fixed known-session reconnect contract mismatch');
  stats.connects++;
  if(mode==='limited')return new Response('Synthetic reconnect limit',{status:429,headers:{'Retry-After':'29'}});
  if(mode==='busy')return new Response('Synthetic connection busy',{status:409,headers:{'Retry-After':'2'}});
  if(!browsers.has(id))return new Response('Synthetic expired session',{status:404});
  const connection=++connectionSerial,modeAtConnect=mode,pair=new WebSocketPair(),[client,socket]=Object.values(pair),sessions=new Map();socket.accept();
  socket.addEventListener('message',event=>{
   const c=JSON.parse(event.data);stats.commands.push(c.method);let result={};
   if(c.method==='Target.createBrowserContext'){
    if(c.params.disposeOnDetach!==true)throw Error('Every lookup must use an isolated disposable context');
    const context='context-'+(++contextSerial);contexts.set(context,{connection,browser:id,targets:new Set()});stats.createdContexts.push(context);result={browserContextId:context};
   }
   if(c.method==='Target.disposeBrowserContext'){
    const context=contexts.get(c.params.browserContextId);if(!context||context.connection!==connection)throw Error('Context belongs to another lookup');
    stats.disposedContexts.push(c.params.browserContextId);contexts.delete(c.params.browserContextId);
   }
   if(c.method==='Target.createTarget'){
    const context=contexts.get(c.params.browserContextId);if(!context||context.connection!==connection||c.params.url!=='about:blank')throw Error('A page may not use the shared default context');
    const target='target-'+(++targetSerial);context.targets.add(target);stats.targets++;result={targetId:target};
   }
   if(c.method==='Target.attachToTarget'){
    const context=[...contexts.values()].find(value=>value.connection===connection&&value.targets.has(c.params.targetId));if(!context)throw Error('Unknown target');
    const session='session-'+c.params.targetId;sessions.set(session,{target:c.params.targetId,url:'about:blank'});result={sessionId:session};
   }
   if(c.method==='Target.closeTarget'){stats.closedTargets++;for(const context of contexts.values())context.targets.delete(c.params.targetId);result={success:true};}
   if(c.method==='Browser.close')stats.closedBrowsers++;
   const page=sessions.get(c.sessionId);
   if(c.method==='Page.navigate'){
    const target=new URL(c.params.url);if(!['carnect.biz','gloar-data.com','encar.spb.ru'].includes(target.hostname))throw Error('Forbidden navigation');
    page.url=target.href;stats.navigations.push(target.href);result={frameId:'frame-'+page.target,loaderId:'loader-'+stats.navigations.length};
    const navigation=result;
    setTimeout(()=>{try{socket.send(JSON.stringify({method:'Page.frameNavigated',sessionId:c.sessionId,params:{frame:{id:navigation.frameId,loaderId:navigation.loaderId,url:page.url}}}));socket.send(JSON.stringify({method:'Page.lifecycleEvent',sessionId:c.sessionId,params:{frameId:navigation.frameId,loaderId:navigation.loaderId,name:'DOMContentLoaded',timestamp:1}}));}catch{}},1);
   }
   if(c.method==='Runtime.evaluate'){
    stats.expressions.push(c.params.expression);let value;
    if(c.params.expression.includes('"op":"prepare"'))value={prepared:true,submitted:false,baseline:'before'};
    else{
     const provider=new URL(page.url).hostname==='carnect.biz'?'carnect':new URL(page.url).hostname==='gloar-data.com'?'gloar':'trust',found=modeAtConnect===provider;
     value={url:page.url,detail:false,ready:true,busy:false,empty:!found,fingerprint:'after',links:[],linkCount:0,buttonCount:0,inputMatches:true,searchMatches:true,exactPlateSeen:found,ids:found?['43123456']:[]};
    }
    result={result:{value}};
   }
   socket.send(JSON.stringify({id:c.id,...(c.sessionId?{sessionId:c.sessionId}:{}),result}));
  });
  return new Response(null,{status:101,webSocket:client});
 }
 stats.unexpected.push({origin:url.origin,path:url.pathname,method:request.method});return new Response('Unexpected synthetic request',{status:502});
}};`;
function verifyExpression(expressions){
 const expression=expressions.find(value=>value.includes('"op":"prepare"'));assert(expression,'The compiled API must send a fixed public-UI preparation expression');
 const dom=new JSDOM('<main><label>License plate<input placeholder="e.g. 123가4567"></label></main>',{url:'https://carnect.biz/catalog?tab=encar',runScripts:'outside-only'});
 Object.defineProperty(dom.window.document,'readyState',{get:()=> 'complete'});
 dom.window.Element.prototype.getClientRects=function(){return[{width:100,height:20}];};dom.window.Element.prototype.getBoundingClientRect=function(){return{width:100,height:20};};
 try{const prepared=dom.window.eval(expression);assert.equal(prepared.prepared,true,'Actual bundled expression must execute without module helpers: '+JSON.stringify(prepared));assert.equal(dom.window.document.querySelector('input').value,'12가3456');}finally{dom.window.close();}
}
(async()=>{
 let outbound=0,script=fs.readFileSync(process.argv[2],'utf8');
 if(script.startsWith('--')){const boundary=script.split('\r\n')[0].slice(2),form=await new Response(script,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData(),metadata=JSON.parse(form.get('metadata'));script=await form.get(metadata.main_module).text();}
 const options={workers:[
  {name:'api',modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/pages.mjs',contents:script}],compatibilityDate:'2026-10-01',bindings:ENV,serviceBindings:{ASSETS:()=>new WorkerResponse('synthetic-static')},outboundService:'id-fixture'},
  {name:'fresh-api',modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/fresh-pages.mjs',contents:script}],compatibilityDate:'2026-10-01',bindings:{...ENV,CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-token-fresh'},serviceBindings:{ASSETS:()=>new WorkerResponse('synthetic-static')},outboundService:'id-fixture'},
  {name:'id-fixture',modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/fixture.mjs',contents:fixture}],compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('Outbound forbidden',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 const request=()=>runtime.dispatchFetch(ORIGIN+'/api/encar-id',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify({plate:'12가3456'})});
 const seenContexts=new Set(),reports=[];
 try{
  const upstream=await runtime.getWorker('id-fixture');
  async function run(mode,{expire=false,count=1,parallel=false}={}){
   await upstream.fetch('https://fixture.internal/reset?mode='+mode+(expire?'&expire=1':''));
   const once=async()=>{const response=await request();return{response,body:await response.json()};};const responses=[];if(parallel)responses.push(...await Promise.all(Array.from({length:count},once)));else for(let i=0;i<count;i++)responses.push(await once());
   const stats=await(await upstream.fetch('https://fixture.internal/stats')).json();
   assert.deepEqual(stats.unexpected,[]);assert.equal(stats.auth,count,JSON.stringify({mode,responses:responses.map(r=>({status:r.response.status,body:r.body})),stats}));assert.equal(stats.members,count);assert.equal(stats.closedBrowsers,0,'Releasing a lookup must not kill the shared browser');assert.deepEqual(stats.remainingContexts,[],'Every lookup context must be disposed');
   for(const context of stats.createdContexts){assert(!seenContexts.has(context),'Each request must get a fresh isolated context');seenContexts.add(context);}
   assert.deepEqual([...stats.disposedContexts].sort(),[...stats.createdContexts].sort());assert.equal(stats.closedTargets,stats.targets);assert(!stats.commands.some(method=>/Screenshot|PrintToPDF/i.test(method)));
   for(const {response}of responses)assert.match(response.headers.get('Cache-Control'),/no-store/);
   reports.push({mode,count,parallel,creates:stats.creates,connects:stats.connects,contexts:stats.createdContexts.length});
   return{responses,stats};
  }
  let r=await run('limited_cold');assert.equal(r.responses[0].response.status,429);assert.equal(r.responses[0].body.code,'UPSTREAM_RATE_LIMITED');assert.equal(r.responses[0].response.headers.get('Retry-After'),'29');assert.equal(r.stats.creates,1);assert.equal(r.stats.connects,0);
  r=await run('carnect',{count:2,parallel:true});assert.equal(r.stats.creates,1,'Repeated lookups must reuse one known browser');assert.equal(r.stats.connects,2,'Each request must own its own WebSocket');assert.equal(r.stats.createdContexts.length,2);
  for(const {response,body}of r.responses){assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body,{ok:true,status:'found',plate:'12가3456',id:'43123456',provider:'carnect'});}assert.deepEqual(r.stats.navigations,Array(2).fill('https://carnect.biz/catalog?tab=encar'));verifyExpression(r.stats.expressions);
  for(const mode of['gloar','trust','not_found']){
   r=await run(mode);assert.equal(r.stats.creates,0,'A warm lookup must not create another browser');assert.equal(r.stats.connects,1);const{response,body}=r.responses[0];assert.equal(response.status,200,JSON.stringify(body));
   if(mode==='not_found'){assert.equal(body.status,'not_found');assert(!('id'in body));}else assert.deepEqual(body,{ok:true,status:'found',plate:'12가3456',id:'43123456',provider:mode});
   const expected=mode==='not_found'?3:['carnect','gloar','trust'].indexOf(mode)+1;assert.deepEqual(r.stats.navigations,['https://carnect.biz/catalog?tab=encar','https://gloar-data.com/en/catalog','https://encar.spb.ru/catalog/'].slice(0,expected));
  }
  r=await run('carnect',{expire:true});assert.equal(r.responses[0].response.status,200,JSON.stringify(r.responses[0].body));assert.equal(r.stats.creates,1,'Only an expired known session may be replaced');assert.equal(r.stats.connects,2,'One expired reconnect plus one new-session reconnect');
  for(const mode of['limited','busy']){r=await run(mode);assert.equal(r.stats.creates,0,'A limited/busy known session must not be invalidated or replaced');assert.equal(r.stats.connects,1);assert.equal(r.responses[0].body.code,mode==='limited'?'UPSTREAM_RATE_LIMITED':'BROWSER_BUSY');assert.equal(r.responses[0].response.status,mode==='limited'?429:503);assert.deepEqual(r.stats.commands,[]);}
  r=await run('carnect',{count:2});assert.equal(r.responses[0].response.status,200);assert.equal(r.responses[1].response.status,200);assert.equal(r.stats.creates,0,'A prior 429/409 must retain the known session');
  r=await run('denied');assert.equal(r.responses[0].response.status,403);assert.equal(r.stats.creates,0);assert.equal(r.stats.connects,0);
  await upstream.fetch('https://fixture.internal/reset?mode=fresh_missing');const freshApi=await runtime.getWorker('fresh-api');const fresh=await freshApi.fetch(ORIGIN+'/api/encar-id',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify({plate:'12가3456'})});const freshBody=await fresh.json(),freshStats=await(await upstream.fetch('https://fixture.internal/stats')).json();assert.equal(fresh.status,502,JSON.stringify(freshBody));assert.equal(freshStats.creates,1,'A newly created missing session must not launch another browser');assert.equal(freshStats.connects,1);assert.deepEqual(freshStats.unexpected,[]);reports.push({mode:'fresh_missing',creates:freshStats.creates,connects:freshStats.connects});
  assert.equal(outbound,0);console.log('PASS native Pages v2.146: known-browser reuse across requests with fresh WebSocket/context, ordered first-match stop, expired-session replacement, no retry on429/409, Auth isolation, cleanup and actual bundled expression; synthetic only, external outbound=0.');console.log(JSON.stringify(reports));
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
