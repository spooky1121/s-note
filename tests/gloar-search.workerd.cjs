'use strict';
// Native workerd execution of the real API and UI controller. All Auth replies
// and browser page snapshots are controlled fixtures, not live GLOAR evidence.
// NODE_PATH=/path/to/wrangler/node_modules node tests/gloar-search.workerd.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {build}=require('esbuild');
const {Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const ROOT=path.resolve(__dirname,'..');
const OUTPUT='/workspace/work/gloar-search-test/native';
const ORIGIN='https://gloar-test.example';
const USER='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const PLATE='28오6877',CATALOG='https://gloar-data.com/en/catalog';
const DETAIL='https://gloar-data.com/en/lot/tesla-model-y-native-fixture';
const ENV={SUPABASE_URL:'https://gloar-native-auth.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-token'};
const fixture=`
import {createGloarSearchHandler} from ${JSON.stringify(path.join(ROOT,'functions/api/gloar-search.js'))};
import {searchGloarLinks} from ${JSON.stringify(path.join(ROOT,'functions/_shared/gloar-search.mjs'))};
let mode='found',stats;
const reset=()=>stats={browsers:0,pages:0,enters:0,evaluations:0,serializedHelper:false,pageCloses:0,browserCloses:0,visits:[]};reset();
const makeBrowser=async(env)=>{
 if(!env.CLOUDFLARE_BROWSER_TOKEN)throw Object.assign(new Error('PRIVATE_CONFIG'),{code:'LOOKUP_NOT_CONFIGURED'});
 if(mode==='quota')throw Object.assign(new Error('PRIVATE_QUOTA'),{code:'UPSTREAM_RATE_LIMITED',retryAfter:37});
 stats.browsers++;
 return{async close(){stats.browserCloses++;},async newPage(){stats.pages++;let current='about:blank',entered=false;
  return{async close(){stats.pageCloses++;},async goto(url){
   if(url!==${JSON.stringify(CATALOG)}&&url!==${JSON.stringify(DETAIL)})throw Error('Unexpected page destination');
   current=url;stats.visits.push(url);
  },async keypress(key){if(key!=='Enter')throw Error('Unexpected key');entered=true;stats.enters++;},async evaluate(expression){
   stats.evaluations++;if(typeof expression!=='string'||!expression.includes('gloarPageAction'))throw Error('Expected server-owned serialized action');
   stats.serializedHelper=expression.includes('const __name=fn=>fn')||/const __name\\s*=\\s*\\(?fn\\)?\\s*=>\\s*fn/.test(expression);
   if(!stats.serializedHelper)throw Error('Serialized keepNames helper missing');
   if(mode==='challenge')return{error:'GLOAR_ACCESS_BLOCKED'};
   if(expression.includes('"operation":"prepare"'))return{prepared:true,baseline:'initial-fixture'};
   if(!entered)throw Error('Catalog must be searched before reading results');
   if(current===${JSON.stringify(DETAIL)})return{ready:true,busy:false,url:current,title:'Synthetic Tesla Model Y',exact:mode!=='mismatch',other:mode==='mismatch',plates:[mode==='mismatch'?'12가3456':${JSON.stringify(PLATE)}]};
   return{ready:true,busy:false,inputMatches:true,fingerprint:mode==='empty'?'empty-fixture':'result-fixture',links:mode==='empty'?[]:[${JSON.stringify(DETAIL)}],linkCount:mode==='empty'?0:1,empty:mode==='empty'};
  }};
 }};
};
export default{async fetch(request,env,context){
 const url=new URL(request.url);
 if(url.pathname==='/__fixture/reset'){mode=url.searchParams.get('mode')||'found';reset();return Response.json(stats);}
 if(url.pathname==='/__fixture/stats')return Response.json(stats);
 const search=mode==='timeout'?()=>new Promise(()=>{}):mode==='unsafe'?async()=>({status:'found',plate:${JSON.stringify(PLATE)},links:[{url:'https://foreign.invalid/en/lot/forged',title:'PRIVATE'}]}):args=>searchGloarLinks({...args,pollMs:0});
 return createGloarSearchHandler({createBrowser:makeBrowser,search,timeoutMs:mode==='timeout'?25:5000})({request,env,waitUntil:promise=>context.waitUntil(promise)});
}};
`;
const authFixture=`
let mode='found',stats;const reset=()=>stats={auth:0,members:0,unexpected:[]};reset();
export default{async fetch(request){const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){if(url.pathname==='/reset'){mode=url.searchParams.get('mode')||'found';reset();}return Response.json(stats);}
 if(url.origin==='https://gloar-native-auth.supabase.co'){
  if(request.method!=='GET'||request.headers.get('Authorization')!=='Bearer ${JWT}'||request.headers.get('apikey')!=='synthetic-public-key')throw Error('Auth contract mismatch');
  if(url.pathname==='/auth/v1/user'){stats.auth++;if(mode==='auth-redirect')return new Response(null,{status:302,headers:{Location:'https://foreign.invalid/forbidden'}});if(mode==='auth-rejected')return Response.json({message:'PRIVATE_AUTH'},{status:401});return Response.json({id:'${USER}'});}
  if(url.pathname==='/rest/v1/zc_members'){stats.members++;if(url.searchParams.get('user_id')!=='eq.${USER}'||url.searchParams.get('active')!=='eq.true')throw Error('Invalid membership scope');return Response.json(mode==='denied'?[]:[{user_id:'${USER}',company_id:'${COMPANY}',role:'dealer',active:true}]);}
 }
 stats.unexpected.push({origin:url.origin,path:url.pathname,method:request.method});return new Response('Unexpected request',{status:502});
}};
`;
(async()=>{
 fs.mkdirSync(OUTPUT,{recursive:true});
 const compiled=await build({stdin:{contents:fixture,resolveDir:ROOT,sourcefile:'gloar-native-fixture.mjs',loader:'js'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',keepNames:true,logLevel:'silent'});
 const script=compiled.outputFiles[0].text;
 fs.writeFileSync(path.join(OUTPUT,'compiled-fixture.mjs'),script);
 fs.writeFileSync(path.join(OUTPUT,'auth-fixture.mjs'),authFixture);
 let outbound=0;
 const noKey={...ENV};delete noKey.CLOUDFLARE_BROWSER_TOKEN;
 const options={workers:[
  ...[['gloar-native',ENV],['gloar-native-no-key',noKey]].map(([name,bindings])=>({name,modulesRoot:'/gloar-native',modules:[{type:'ESModule',path:'/gloar-native/'+name+'.mjs',contents:script}],compatibilityDate:'2026-10-01',bindings,outboundService:'gloar-auth-fixture'})),
  {name:'gloar-auth-fixture',modulesRoot:'/gloar-native',modules:[{type:'ESModule',path:'/gloar-native/auth.mjs',contents:authFixture}],compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('Outbound prohibited',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 const reports=[];
 try{
  const api=await runtime.getWorker('gloar-native'),missing=await runtime.getWorker('gloar-native-no-key'),auth=await runtime.getWorker('gloar-auth-fixture');
  const opts=body=>({method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+JWT},body:JSON.stringify(body||{plate:PLATE})});
  const request=(options=opts())=>runtime.dispatchFetch(ORIGIN+'/api/gloar-search',options);
  const reset=async mode=>{await api.fetch(ORIGIN+'/__fixture/reset?mode='+mode);await auth.fetch('https://fixture.internal/reset?mode='+mode);};
  const stats=async()=>{const browser=await(await api.fetch(ORIGIN+'/__fixture/stats')).json(),network=await(await auth.fetch('https://fixture.internal/stats')).json();assert.deepEqual(network.unexpected,[]);return{browser,network};};
  await reset('found');
  for(const [worker,configured]of[[api,true],[missing,false]]){const response=await worker.fetch(ORIGIN+'/api/gloar-search');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,configured,provider:'gloar',release:'2.148'});}
  let state=await stats();assert.equal(state.network.auth,0);assert.equal(state.browser.browsers,0);reports.push({case:'configuration-presence',calls:0});
  for(const [mode,status]of[['missing-auth',401],['foreign-origin',403],['extra-url',400]]){
   const options=opts();if(mode==='missing-auth')delete options.headers.Authorization;if(mode==='foreign-origin')options.headers.Origin='https://foreign.invalid';if(mode==='extra-url')options.body=JSON.stringify({plate:PLATE,url:'https://foreign.invalid'});
   const response=await request(options);assert.equal(response.status,status);reports.push({case:mode,status});
  }
  state=await stats();assert.equal(state.network.auth,0);assert.equal(state.browser.browsers,0);
  for(const [mode,status,code]of[['found',200],['empty',200],['mismatch',200],['challenge',502,'GLOAR_ACCESS_BLOCKED'],['unsafe',502,'GLOAR_RESULT_UNVERIFIED'],['quota',429,'UPSTREAM_RATE_LIMITED'],['timeout',504,'REQUEST_TIMEOUT'],['auth-redirect',502,'AUTH_UNAVAILABLE'],['auth-rejected',401,'AUTH_FAILED'],['denied',403,'STAFF_REQUIRED']]){
   await reset(mode);const response=await request(),body=await response.json();state=await stats();assert.equal(response.status,status,JSON.stringify({mode,body}));assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert(!JSON.stringify(body).includes('PRIVATE'));
   if(code)assert.equal(body.code,code);
   if(mode==='found'){assert.deepEqual(body,{ok:true,status:'found',plate:PLATE,links:[{url:DETAIL,title:'Synthetic Tesla Model Y'}]});assert.equal(state.browser.enters,1);assert.equal(state.browser.serializedHelper,true);assert.deepEqual(state.browser.visits,[CATALOG,DETAIL]);}
   if(['empty','mismatch'].includes(mode))assert.deepEqual(body,{ok:true,status:'not_found',plate:PLATE,links:[]});
   if(['auth-redirect','auth-rejected','denied'].includes(mode))assert.equal(state.browser.browsers,0);
   else if(mode!=='quota')assert.equal(state.browser.browserCloses,1,'Every created browser is released');
   if(['found','empty','mismatch','challenge'].includes(mode))assert.equal(state.browser.pageCloses,1);
   if(mode==='quota')assert.equal(response.headers.get('Retry-After'),'37');
   reports.push({case:mode,status,auth:state.network.auth,members:state.network.members,browsers:state.browser.browsers,visits:state.browser.visits.length});
  }
  await auth.fetch('https://fixture.internal/reset?mode=found');
  const missingOptions=opts();delete missingOptions.headers.Origin;
  const response=await missing.fetch(ORIGIN+'/api/gloar-search',missingOptions),body=await response.json();assert.equal(response.status,503);assert.equal(body.code,'LOOKUP_NOT_CONFIGURED');reports.push({case:'missing-browser-key',status:503});
  assert.equal(outbound,0);
  const receipt={passed:true,runtime:'native workerd',compiled:'real API and real GLOAR UI controller, keepNames=true',fixtures:'Auth and browser snapshots synthetic',actualExternalOutbound:outbound,liveGloarVerified:false,cases:reports};
  fs.writeFileSync(path.join(OUTPUT,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log('PASS native GLOAR smoke: '+reports.length+' cases; real API/controller compiled; input Enter, exact-plate detail, auth/origin boundaries, no-write transport, timeout, quota and cleanup verified with synthetic fixtures. Actual external outbound=0; live GLOAR remains unverified.');
  console.log(JSON.stringify(reports));
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
