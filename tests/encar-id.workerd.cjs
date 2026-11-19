'use strict';
// Default production Pages API + native Workers WebSocket/CDP transport.
// All Auth, membership and browser replies are synthetic service-bound workers.
// NODE_PATH=/path/to/test-tools/node_modules node tests/encar-id.workerd.cjs /tmp/pages.js
const assert=require('node:assert/strict'),fs=require('node:fs');
const{Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const{JSDOM}=require('./encar/node_modules/jsdom');
const ORIGIN='https://native-id-api.example',USER='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const ENV={SUPABASE_URL:'https://native-id-auth.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-token'};
const fixture=`
let mode='carnect',stats;const reset=()=>{stats={auth:0,members:0,launches:0,commands:[],expressions:[],navigations:[],targets:0,closedTargets:0,closedBrowsers:0,unexpected:[]};};reset();
export default{async fetch(request){
 const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){if(url.pathname==='/reset'){mode=url.searchParams.get('mode')||'carnect';reset();}return Response.json(stats);}
 if(url.origin==='https://native-id-auth.supabase.co'){
  if(request.method!=='GET'||request.headers.get('Authorization')!=='Bearer ${JWT}'||request.headers.get('apikey')!=='synthetic-public-key')throw Error('Synthetic Auth contract mismatch');
  if(url.pathname==='/auth/v1/user'){stats.auth++;return Response.json({id:'${USER}'});}
  if(url.pathname==='/rest/v1/zc_members'){stats.members++;return Response.json(mode==='denied'?[]:[{user_id:'${USER}',company_id:'${COMPANY}',role:'dealer',active:true}]);}
 }
 if(url.href==='https://api.cloudflare.com/client/v4/accounts/${ENV.CLOUDFLARE_ACCOUNT_ID}/browser-run/devtools/browser?keep_alive=10000'){
  stats.launches++;
  if(request.headers.get('Upgrade')!=='websocket'||request.headers.get('Authorization')!=='Bearer synthetic-browser-token')throw Error('Synthetic browser authentication mismatch');
  const guardrails=JSON.parse(atob(request.headers.get('cf-brapi-guardrails').replace(/-/g,'+').replace(/_/g,'/')));
  if(guardrails.allowedDomains.includes('fem.encar.com'))throw Error('Korean Encar must not be navigable');
  if(mode==='limited')return new Response('Synthetic limit',{status:429,headers:{'Retry-After':'29'}});
  const pair=new WebSocketPair(),[client,socket]=Object.values(pair),sessions=new Map();socket.accept();
  socket.addEventListener('message',event=>{
   const c=JSON.parse(event.data);stats.commands.push(c.method);let result={};
   if(c.method==='Target.createTarget'){if(c.params.url!=='about:blank')throw Error('Unexpected initial target');result={targetId:'target-'+(++stats.targets)};}
   if(c.method==='Target.attachToTarget'){const id='session-'+c.params.targetId;sessions.set(id,{target:c.params.targetId,url:'about:blank'});result={sessionId:id};}
   if(c.method==='Target.closeTarget'){stats.closedTargets++;result={success:true};}
   if(c.method==='Browser.close')stats.closedBrowsers++;
   const page=sessions.get(c.sessionId);
   if(c.method==='Page.navigate'){
    const target=new URL(c.params.url);if(!['carnect.biz','gloar-data.com','encar.spb.ru'].includes(target.hostname))throw Error('Forbidden navigation');
    page.url=target.href;stats.navigations.push(target.href);result={frameId:'frame-'+page.target,loaderId:'loader-'+stats.navigations.length};
    const navigation=result;
    setTimeout(()=>{try{socket.send(JSON.stringify({method:'Page.frameNavigated',sessionId:c.sessionId,params:{frame:{id:navigation.frameId,loaderId:navigation.loaderId,url:page.url}}}));socket.send(JSON.stringify({method:'Page.lifecycleEvent',sessionId:c.sessionId,params:{frameId:navigation.frameId,loaderId:navigation.loaderId,name:'DOMContentLoaded',timestamp:1}}));socket.send(JSON.stringify({method:'Page.domContentEventFired',sessionId:c.sessionId,params:{timestamp:1}}));}catch{}},1);
   }
   if(c.method==='Runtime.evaluate'){
    stats.expressions.push(c.params.expression);
    let value;
    if(c.params.expression.includes('"op":"prepare"'))value={prepared:true,submitted:false,baseline:'before'};
    else{
     const provider=new URL(page.url).hostname==='carnect.biz'?'carnect':new URL(page.url).hostname==='gloar-data.com'?'gloar':'trust';
     const found=mode===provider;
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
(async()=>{
 let outbound=0;
 let script=fs.readFileSync(process.argv[2],'utf8');
 if(script.startsWith('--')){const boundary=script.split('\r\n')[0].slice(2),form=await new Response(script,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData(),metadata=JSON.parse(form.get('metadata'));script=await form.get(metadata.main_module).text();}
 const options={workers:[
  {name:'api',modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/pages.mjs',contents:script}],compatibilityDate:'2026-10-01',bindings:ENV,serviceBindings:{ASSETS:()=>new WorkerResponse('synthetic-static')},outboundService:'id-fixture'},
  {name:'id-fixture',modulesRoot:'/native-id-api',modules:[{type:'ESModule',path:'/native-id-api/fixture.mjs',contents:fixture}],compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('Outbound forbidden',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 const request=()=>runtime.dispatchFetch(ORIGIN+'/api/encar-id',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify({plate:'12가3456'})});
 try{
  const upstream=await runtime.getWorker('id-fixture');
  for(const mode of['carnect','gloar','trust','not_found','limited','denied']){
   await upstream.fetch('https://fixture.internal/reset?mode='+mode);
   const response=await request(),body=await response.json(),stats=await(await upstream.fetch('https://fixture.internal/stats')).json();
   assert.match(response.headers.get('Cache-Control'),/no-store/);assert.deepEqual(stats.unexpected,[]);assert.equal(stats.auth,1,JSON.stringify({mode,status:response.status,body,stats}));assert.equal(stats.members,1);
   if(mode==='denied'){assert.equal(response.status,403);assert.equal(stats.launches,0);continue;}
   assert.equal(stats.launches,1,'A lookup must acquire only one browser');
   if(mode==='limited'){assert.equal(response.status,429);assert.equal(body.code,'UPSTREAM_RATE_LIMITED');assert.equal(response.headers.get('Retry-After'),'29');assert.deepEqual(stats.commands,[]);continue;}
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(stats.closedBrowsers,1);assert.equal(stats.closedTargets,stats.targets);
   const expression=stats.expressions.find(value=>value.includes('"op":"prepare"'));assert(expression,'The production API must send the fixed public-UI preparation expression');
   const dom=new JSDOM('<main><label>License plate<input placeholder="e.g. 123가4567"></label></main>',{url:'https://carnect.biz/catalog?tab=encar',runScripts:'outside-only'});
   Object.defineProperty(dom.window.document,'readyState',{get:()=> 'complete'});
   dom.window.Element.prototype.getClientRects=function(){return[{width:100,height:20}];};dom.window.Element.prototype.getBoundingClientRect=function(){return{width:100,height:20};};
   try{const prepared=dom.window.eval(expression);assert.equal(prepared.prepared,true,'Actual bundled expression must execute without importing bundler helpers: '+JSON.stringify(prepared));assert.equal(dom.window.document.querySelector('input').value,'12가3456');}finally{dom.window.close();}
   if(mode==='not_found'){assert.equal(body.status,'not_found');assert.equal(stats.navigations.length,3);assert(!('id'in body));}
   else{assert.deepEqual(body,{ok:true,status:'found',plate:'12가3456',id:'43123456',provider:mode});assert.equal(stats.navigations.length,['carnect','gloar','trust'].indexOf(mode)+1);}
   assert.deepEqual(stats.navigations,['https://carnect.biz/catalog?tab=encar','https://gloar-data.com/en/catalog','https://encar.spb.ru/catalog/'].slice(0,stats.navigations.length));
   assert(!stats.commands.some(method=>/Screenshot|PrintToPDF/i.test(method)));
  }
  assert.equal(outbound,0);console.log('PASS native Pages default ID API: Auth/membership, real Worker response.webSocket/CDP upgrade, one browser, ordered first-match stop, all-empty fallback, 429 Retry-After, denied auth and cleanup; synthetic only, external outbound=0.');
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
