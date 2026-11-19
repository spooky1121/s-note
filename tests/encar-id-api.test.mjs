import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncarIdHandler, onRequest } from '../functions/api/encar-id.js';

// Auth, PostgREST and the injected provider transport are controlled fixtures.
// No account, service key, live provider contract or business row is used.
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLATE='12가3456',TOKEN='eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj';
const ENV={SUPABASE_URL:'https://encar-id-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const member={user_id:USER,company_id:COMPANY,role:'dealer',active:true};
const originals=new WeakMap();
function request(body={plate:PLATE},{method='POST',headers={},signal,raw}={}){
 return new Request('https://snote.example/api/encar-id',{method,headers:{Origin:'https://snote.example','Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Authorization:'Bearer '+TOKEN,...headers},...(method==='GET'||method==='HEAD'?{}:{body:raw??JSON.stringify(body)}),...(signal?{signal}:{})});
}
function fixture(t,config={}){
 const state={calls:[],providers:[]};
 if(!originals.has(t)){originals.set(t,globalThis.fetch);t.after(()=>{globalThis.fetch=originals.get(t);originals.delete(t);});}
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);state.calls.push({url:url.href,options});assert.equal(url.origin,ENV.SUPABASE_URL,'No direct external, search, Korean Encar, price or write endpoint is permitted in this fixture');assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');assert.equal(options.headers.apikey,ENV.SUPABASE_PUBLISHABLE_KEY);assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(url.pathname==='/auth/v1/user')return config.authResponse?.()??json(config.user===undefined?{id:USER,user_metadata:{secret:'PRIVATE_METADATA',role:'admin'}}:config.user);
  assert.equal(url.pathname,'/rest/v1/zc_members');assert.equal(url.searchParams.get('user_id'),'eq.'+USER);assert.equal(url.searchParams.get('active'),'eq.true');assert.equal(url.searchParams.get('limit'),'1');assert.equal(url.searchParams.get('select'),'user_id,company_id,role,active');return config.memberResponse?.()??json(config.members===undefined?[member]:config.members);
 };
 state.lookup=async(options)=>{state.providers.push('gloar');assert.deepEqual(Object.keys(options).sort(),['env','plate','signal','waitUntil']);assert.equal(options.plate,PLATE);assert.equal(options.signal.aborted,false);assert.equal(state.calls.length,2,'Auth and active membership precede GLOAR');return config.lookup?config.lookup(options):{status:'found',plate:PLATE,id:'43123456',provider:'gloar',sourceUrl:'https://gloar-data.com/en/lot/vehicle-vin-and-uuid',priceWon:1000000,sellerPhone:'PRIVATE_PHONE'};};
 return state;
}
async function run(handler,req=request(),env=ENV){const response=await handler({request:req,env});assert.match(response.headers.get('Cache-Control'),/no-store.*private/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.match(response.headers.get('Content-Type'),/^application\/json/);return{response,status:response.status,body:await response.json()};}
function noTraffic(state){assert.deepEqual(state.calls,[]);assert.deepEqual(state.providers,[]);}
test('configuration GET exposes Browser Run presence only and never authenticates or launches',async t=>{
 const s=fixture(t);for(const token of['','synthetic-browser-secret']){
  const r=await run(onRequest,request({}, {method:'GET',headers:{Authorization:''}}),{...ENV,CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:token,TAVILY_API_KEY:'unused-search-secret'});assert.equal(r.status,200);assert.deepEqual(r.body,{ok:true,configured:!!token,provider:'gloar',release:'2.151'});assert(!JSON.stringify(r.body).includes('synthetic-browser-secret'));assert(!JSON.stringify(r.body).includes(ENV.SUPABASE_URL));
 }noTraffic(s);
});
test('verified active membership returns only the requested original advertisement ID',async t=>{
 const s=fixture(t),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,200);assert.deepEqual(r.body,{ok:true,status:'found',plate:PLATE,id:'43123456',provider:'gloar'});assert.equal(s.calls.length,2);assert.deepEqual(s.providers,['gloar']);const text=JSON.stringify(r.body);for(const value of['PRIVATE_METADATA','PRIVATE_PHONE','priceWon','sourceUrl',TOKEN,USER,COMPANY])assert(!text.includes(value));
});
test('production refuses missing Browser Run credentials after authorization without an external request',async t=>{
 const s=fixture(t),r=await run(onRequest);assert.equal(r.status,503);assert.equal(r.body.code,'LOOKUP_NOT_CONFIGURED');assert.equal(r.body.status,'error');assert(!('id'in r.body));assert.equal(s.calls.length,2);assert.deepEqual(s.providers,[]);
});
test('GLOAR-only lookup receives the originating Pages waitUntil with its proper context',async t=>{
 const s=fixture(t),held=[];let context;const handler=createEncarIdHandler({lookup:async args=>{assert.equal(args.env,ENV);args.waitUntil(Promise.resolve('synthetic metadata'));return s.lookup(args);}});
 context={request:request(),env:ENV,waitUntil(promise){assert.equal(this,context);held.push(promise);}};
 const response=await handler(context);assert.equal(response.status,200);assert.deepEqual(await Promise.all(held),['synthetic metadata']);assert.deepEqual(s.providers,['gloar']);
});
test('an unauthorized request never starts GLOAR or any other provider',async t=>{
 const s=fixture(t,{members:[]}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,403);assert.deepEqual(s.providers,[]);
});
test('browser settings, auth, quota and GLOAR stage errors are distinct and do not leak raw data',async t=>{
 for(const [code,status] of [['BROWSER_AUTH_FAILED',502],['BROWSER_UNAVAILABLE',502],['BROWSER_BUSY',503],['UPSTREAM_RATE_LIMITED',429],['BROWSER_DAILY_LIMIT',429],['GLOAR_INPUT_MISSING',502],['GLOAR_SEARCH_UNCONFIRMED',502],['GLOAR_ID_UNVERIFIED',502],['GLOAR_ACCESS_BLOCKED',502],['GLOAR_AMBIGUOUS',502]]){
  const s=fixture(t,{lookup:()=>{throw Object.assign(new Error('PRIVATE_BROWSER_TOKEN https://secret.invalid'),{code,retryAfter:27});}}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,status);assert.equal(r.body.code,code);assert.deepEqual(s.providers,['gloar']);assert(!JSON.stringify(r.body).includes('PRIVATE'));assert(!JSON.stringify(r.body).includes('secret.invalid'));if(status===429||code==='BROWSER_BUSY')assert.equal(r.response.headers.get('Retry-After'),'27');
 }
});
test('a confirmed GLOAR no-match returns NOT_FOUND without querying another site',async t=>{
 const s=fixture(t,{lookup:()=>({status:'not_found',plate:PLATE,code:'NOT_FOUND',provider:'gloar'})}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,200);assert.equal(r.body.ok,false);assert.equal(r.body.status,'not_found');assert.equal(r.body.code,'NOT_FOUND');assert(!('id'in r.body));assert.deepEqual(s.providers,['gloar']);
});
test('unproven, foreign, mismatched or GLOAR UUID results cannot become an Encar ID response',async t=>{
 const correct={status:'found',plate:PLATE,id:'43123456',provider:'gloar',sourceUrl:'https://gloar-data.com/en/lot/a-vin-and-uuid'};
 for(const result of [null,{}, {...correct,plate:'12나3456'},{...correct,id:'160f5ea0-def9-4473-b2b5-457e5269cfb8'},{...correct,id:43123456},{...correct,id:'00000000'},{...correct,provider:'carnect'},{...correct,sourceUrl:'https://foreign.invalid/en/lot/43123456'},{...correct,sourceUrl:'https://gloar-data.com/en/catalog'},{status:'not_found',plate:'12나3456',code:'NOT_FOUND'}]){
  const s=fixture(t,{lookup:()=>result}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,502);assert.equal(r.body.code,'GLOAR_ID_UNVERIFIED');assert(!('id'in r.body));
 }
});
test('provider exceptions expose no raw exception, URL, token or attempted advertisement data',async t=>{
 const s=fixture(t,{lookup:()=>{throw Error('PRIVATE_TOKEN https://secret.invalid/?key=secret');}}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,502);assert.equal(r.body.code,'PROVIDERS_UNAVAILABLE');assert(!('id'in r.body));assert(!JSON.stringify(r.body).includes('PRIVATE'));assert(!JSON.stringify(r.body).includes('secret.invalid'));assert.deepEqual(s.providers,['gloar']);
});
test('all supported active staff roles may read public advertisement IDs',async t=>{
 for(const role of['admin','dealer','accountant']){const s=fixture(t,{members:[{...member,role}]}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,200,role);assert.equal(r.body.id,'43123456');}
});
test('user metadata and mismatched or inactive membership can never authorize a provider lookup',async t=>{
 for(const members of[[],null,{},[{...member,user_id:OTHER}],[{...member,active:false}],[{...member,active:'true'}],[{...member,role:'superadmin'}],[{...member,company_id:'not-a-uuid'}],[{user_id:USER,role:'admin',active:true}]]){const s=fixture(t,{members}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,403);assert.equal(r.body.code,'STAFF_REQUIRED');assert.equal(s.calls.length,2);assert.deepEqual(s.providers,[]);}
});
test('malformed, anonymous and rejected Auth identities cannot reach membership or provider data',async t=>{
 for(const config of[{user:null},{user:{id:'invalid',user_metadata:{role:'admin'}}},{user:{id:USER,is_anonymous:true}},{authResponse:()=>json({message:'PRIVATE_AUTH_FAILURE'},401)}]){const s=fixture(t,config),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,401);assert.equal(s.calls.length,1);assert.deepEqual(s.providers,[]);assert(!JSON.stringify(r.body).includes('PRIVATE'));}
});
test('upstream authentication failures and redirects fail closed without following another host',async t=>{
 for(const authResponse of[()=>json({message:'PRIVATE_UPSTREAM'},503),()=>new Response(null,{status:302,headers:{Location:'https://secret.invalid'}}),()=>new Response('{broken',{headers:{'Content-Type':'application/json'}})]){const s=fixture(t,{authResponse}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert(r.status>=400);assert.equal(s.calls.length,1);assert.deepEqual(s.providers,[]);assert(!JSON.stringify(r.body).includes('PRIVATE'));assert(!JSON.stringify(r.body).includes('secret.invalid'));}
});
test('authentication transport and malformed upstream bodies identify the Auth stage without searching providers',async t=>{
 for(const stage of['authResponse','memberResponse'])for(const response of[()=>{throw new TypeError('PRIVATE_AUTH_NETWORK https://secret.invalid');},()=>new Response('{broken'),()=>new Response('x'.repeat(65537))]){
  const s=fixture(t,{[stage]:response}),r=await run(createEncarIdHandler({lookup:s.lookup}));assert.equal(r.status,502);assert.equal(r.body.code,'AUTH_UNAVAILABLE');assert.equal(r.body.error,'로그인 정보를 확인하지 못했습니다.');assert.equal(s.calls.length,stage==='authResponse'?1:2);assert.deepEqual(s.providers,[]);assert(!JSON.stringify(r.body).includes('PRIVATE'));assert(!JSON.stringify(r.body).includes('secret.invalid'));
 }
});
test('unsupported methods and cross-origin POST fail before external traffic',async t=>{
 const s=fixture(t),handler=createEncarIdHandler({lookup:s.lookup});for(const method of['PUT','DELETE','OPTIONS']){const r=await run(handler,request({}, {method}));assert.equal(r.status,405);}
 for(const headers of[{Origin:'https://foreign.invalid'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}])assert.equal((await run(handler,request({plate:PLATE},{headers}))).status,403);noTraffic(s);
});
test('bearer syntax, JSON media type and content encoding fail before Auth or provider traffic',async t=>{
 const s=fixture(t),handler=createEncarIdHandler({lookup:s.lookup});for(const Authorization of['','Basic private','Bearer plaintext','Bearer a.b.c with-space'])assert.equal((await run(handler,request({plate:PLATE},{headers:{Authorization}}))).status,401);
 for(const headers of[{'Content-Type':'text/plain'},{'Content-Type':'multipart/form-data'},{'Content-Encoding':'gzip'}])assert.equal((await run(handler,request({plate:PLATE},{headers}))).status,415);noTraffic(s);
});
test('only one plate field is accepted, with malformed, extra, legacy and arbitrary URL inputs rejected',async t=>{
 const s=fixture(t),handler=createEncarIdHandler({lookup:s.lookup});for(const body of[null,[],{},'string',{plate:12},{plate:''},{plate:'not-a-plate'},{plate:'12가3456',candidateIds:['43123456']},{plate:PLATE,carId:'car-a'},{plate:PLATE,url:'https://arbitrary.invalid'},{plate:PLATE,make:'현대'},{plate:'가'.repeat(41)}]){const r=await run(handler,request(body));assert.equal(r.status,400,JSON.stringify(body));}
 assert.equal((await run(handler,request(null,{raw:'{broken'}))).status,400);noTraffic(s);
});
test('both declared and actual payload sizes are bounded to 1024 bytes before authentication',async t=>{
 const s=fixture(t),handler=createEncarIdHandler({lookup:s.lookup});for(const headers of[{'Content-Length':'1025'},{'Content-Length':'nonnumeric'}])assert.equal((await run(handler,request({plate:PLATE},{headers}))).status,413);
 assert.equal((await run(handler,request({plate:'가'.repeat(400)}))).status,413);assert.equal((await run(handler,request({plate:'가'.repeat(400)},{headers:{'Content-Length':'0'}}))).status,413);noTraffic(s);
});
test('normalization retains the full Korean plate and never sends formatting or extra request fields upstream',async t=>{
 const s=fixture(t),r=await run(createEncarIdHandler({lookup:s.lookup}),request({plate:' １２가-３４５６ '}));assert.equal(r.status,200);assert.equal(r.body.plate,PLATE);assert.equal(r.body.id,'43123456');
});
test('invalid server configuration never directs authentication tokens to a user supplied host',async t=>{
 const s=fixture(t),handler=createEncarIdHandler({lookup:s.lookup});for(const env of[{...ENV,SUPABASE_URL:'https://foreign.invalid'},{...ENV,SUPABASE_URL:'http://encar-id-fixture.supabase.co'},{...ENV,SUPABASE_PUBLISHABLE_KEY:''}])assert.equal((await run(handler,request(),env)).status,503);noTraffic(s);
});
test('request cancellation aborts a pending provider and never starts another one',async t=>{
 const controller=new AbortController();const s=fixture(t,{lookup:({signal})=>{queueMicrotask(()=>controller.abort());return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
 const r=await run(createEncarIdHandler({lookup:s.lookup}),request({plate:PLATE},{signal:controller.signal}));assert.equal(r.status,408);assert.equal(r.body.code,'REQUEST_ABORTED');assert.deepEqual(s.providers,['gloar']);assert.equal(s.calls.length,2);
});
