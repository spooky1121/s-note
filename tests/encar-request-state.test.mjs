import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncarPendingLookup, encarLookupScopeKey } from '../functions/_shared/encar-request-state.mjs';
import { createEncarIdHandler } from '../functions/api/encar-id.js';
import { createEncarAdPriceHandler } from '../functions/api/encar-ad-price.js';

// Only synthetic inputs and intercepted Auth/membership. No provider or live DB.
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLATE='12가3456',ID='43123456',ENV={SUPABASE_URL:'https://api-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',CLOUDFLARE_ACCOUNT_ID:'f'.repeat(32),CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-private'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const found=plate=>({status:'found',id:ID,plate,provider:'gloar',sourceUrl:'https://gloar-data.com/en/lot/synthetic-lot'});
function request(kind='id',{signal,token='one.header.signature',plate=PLATE,headers={}}={}){return new Request('https://snote.example/api/encar-'+(kind==='id'?'id':'ad-price'),{method:'POST',headers:{Origin:'https://snote.example','Sec-Fetch-Site':'same-origin','Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(kind==='id'?{plate}:{plate,id:ID}),signal});}
async function read(response){return {response,status:response.status,body:await response.json()};}
function harness(t,kind='id',{lookup}={}){
 const old=globalThis.fetch,reads=[],calls=[],logs=[],holds=[],state={active:true,company:COMPANY,authStatus:200};
 globalThis.fetch=async(url,options)=>{const parsed=new URL(url),user=options.headers.Authorization.includes('two.')?OTHER:USER;reads.push({stage:parsed.pathname,user});assert.equal(options.method,'GET');if(parsed.pathname==='/auth/v1/user')return new Response(JSON.stringify({id:user}),{status:state.authStatus});return new Response(JSON.stringify([{user_id:user,company_id:state.company,role:'dealer',active:state.active}]));};
 t.after(()=>{globalThis.fetch=old;});
 const provider=async args=>{calls.push(args);return lookup?lookup(args):kind==='id'?found(args.plate):{id:args.id,plate:args.plate,priceWon:3500000,source:'encar',checkedAt:new Date().toISOString()};};
 const create=kind==='id'?createEncarIdHandler:createEncarAdPriceHandler;
 const handler=create({lookup:provider,logger:value=>logs.push(value)});
 const run=(options={},env=ENV)=>handler({request:request(kind,options),env,waitUntil(promise){holds.push(promise);}}).then(read);
 return{state,reads,calls,logs,holds,run};
}
function diagnostic(response){return{requestId:response.headers.get('X-Snote-Request-Id'),stage:response.headers.get('X-Snote-Lookup-Stage'),durationMs:Number(response.headers.get('X-Snote-Duration-Ms'))};}
function assertSafe(value){assert.deepEqual(Object.keys(value).sort(),['durationMs','requestId','stage']);assert.match(value.requestId,/^[a-f0-9-]{36}$/);assert(Number.isSafeInteger(value.durationMs)&&value.durationMs>=0);assert(['request','auth','membership','lookup','verification','complete'].includes(value.stage));for(const secret of[PLATE,USER,COMPANY,'synthetic-browser-private','synthetic-public','https://','PRIVATE','one.header.signature'])assert(!JSON.stringify(value).includes(secret));}

for(const kind of['id','price']){
 test(kind+': concurrent same-scope searches authenticate every caller and execute provider once',async t=>{
  const hold=deferred(),f=harness(t,kind,{lookup:args=>hold.promise.then(()=>kind==='id'?found(args.plate):{id:ID,plate:args.plate,priceWon:3500000,checkedAt:new Date().toISOString(),source:'encar'})});
  const first=f.run(),second=f.run();while(f.holds.length<2)await tick();assert.equal(f.calls.length,1);assert.equal(f.reads.length,4);hold.resolve();const[a,b]=await Promise.all([first,second]);assert.equal(a.status,200);assert.equal(b.status,200);assert.notEqual(diagnostic(a.response).requestId,diagnostic(b.response).requestId);assertSafe(diagnostic(a.response));assert.equal(f.logs.length,0);assert((await Promise.all(f.holds)).every(value=>value===undefined),'Shared lifetimes hold no provider data');
  await f.run();assert.equal(f.calls.length,2,'A settled lookup is not cached');
 });
 test(kind+': one cancelled consumer cannot abort another consumer or prevent retry',async t=>{
  const hold=deferred(),f=harness(t,kind,{lookup:args=>hold.promise.then(()=>kind==='id'?found(args.plate):{id:ID,plate:args.plate,priceWon:3500000,checkedAt:new Date().toISOString(),source:'encar'})}),a=new AbortController(),b=new AbortController();
  const first=f.run({signal:a.signal}),second=f.run({signal:b.signal});while(f.holds.length<2)await tick();a.abort();assert.equal((await first).status,408);assert.equal(f.calls[0].signal.aborted,false);hold.resolve();assert.equal((await second).status,200);await f.run();assert.equal(f.calls.length,2);for(const line of f.logs)assertSafe(line);
 });
 test(kind+': all consumers cancelling aborts shared work, clears it and allows a new request',async t=>{
  const hold=deferred(),f=harness(t,kind,{lookup:args=>hold.promise.then(()=>kind==='id'?found(args.plate):{id:ID,plate:args.plate,priceWon:3500000,checkedAt:new Date().toISOString(),source:'encar'})}),a=new AbortController(),b=new AbortController();
  const first=f.run({signal:a.signal}),second=f.run({signal:b.signal});while(f.holds.length<2)await tick();a.abort();b.abort();assert.equal((await first).status,408);assert.equal((await second).status,408);assert.equal(f.calls[0].signal.aborted,true);hold.resolve();assert.equal((await f.run()).status,200);assert.equal(f.calls.length,2);
 });
 test(kind+': scope, identity and deployment credentials cannot share a pending result',async t=>{
  const hold=deferred(),f=harness(t,kind,{lookup:args=>hold.promise.then(()=>kind==='id'?found(args.plate):{id:ID,plate:args.plate,priceWon:3500000,checkedAt:new Date().toISOString(),source:'encar'})});
  const requests=[f.run(),f.run({token:'two.header.signature'}),f.run({}, {...ENV,CLOUDFLARE_BROWSER_TOKEN:'different-synthetic-token'}),f.run({plate:'34나5678'})];
  while(f.calls.length<4)await tick();assert.equal(f.reads.length,8);f.state.company=OTHER_COMPANY;requests.push(f.run());while(f.calls.length<5)await tick();hold.resolve();assert((await Promise.all(requests)).every(value=>value.status===200));
 });
 test(kind+': fresh inactive membership is rejected before joining existing work',async t=>{
  const hold=deferred(),f=harness(t,kind,{lookup:args=>hold.promise.then(()=>kind==='id'?found(args.plate):{id:ID,plate:args.plate,priceWon:3500000,checkedAt:new Date().toISOString(),source:'encar'})});const first=f.run();while(!f.calls.length)await tick();f.state.active=false;assert.equal((await f.run()).status,403);assert.equal(f.calls.length,1);assert.equal(f.logs.at(-1).stage,'membership');f.state.active=true;hold.resolve();assert.equal((await first).status,200);
 });
 test(kind+': diagnostics contain only generated request ID, fixed stage and duration',async t=>{
  const f=harness(t,kind,{lookup:()=>{throw Object.assign(new Error('PRIVATE '+PLATE+' https://private.invalid/?token=synthetic-browser-private'),{code:'BROWSER_BUSY',status:503,stack:'PRIVATE'});}}),r=await f.run({headers:{'X-Snote-Request-Id':'PRIVATE-correlator'}});assert.equal(r.status,503);assert.equal(r.body.ok,false);assertSafe(f.logs[0]);assert.deepEqual(diagnostic(r.response),f.logs[0]);assert.equal(f.logs[0].stage,'lookup');assert(!JSON.stringify(r.body).includes('PRIVATE'));assert(!JSON.stringify(r.body).includes(PLATE));assert.equal(r.response.headers.get('Retry-After'),'20');
 });
}
test('only a confirmed no-match response may use NOT_FOUND; thrown 503 is an error',async t=>{
 const f=harness(t,'id',{lookup:()=>{throw Object.assign(new Error('PRIVATE'),{code:'NOT_FOUND',status:503});}}),r=await f.run();assert.equal(r.status,503);assert.equal(r.body.status,'error');assert.equal(r.body.code,'PROVIDERS_UNAVAILABLE');assert.equal(f.logs.length,1);assert.equal(f.logs[0].stage,'lookup');
 const g=harness(t,'id',{lookup:args=>({status:'not_found',plate:args.plate,code:'NOT_FOUND'})}),none=await g.run();assert.equal(none.status,200);assert.equal(none.body.status,'not_found');assert.equal(none.body.code,'NOT_FOUND');assert.equal(g.logs.length,0);assert.equal(diagnostic(none.response).stage,'complete');
});
test('pending pool is bounded without blocking independent work and discards timed-out jobs',async()=>{
 const join=createEncarPendingLookup({maxEntries:1,timeoutMs:30}),hold=deferred();let count=0;
 const operation=()=>{count++;return hold.promise;};const a=join({key:'a',operation}),b=join({key:'b',operation});assert.equal(count,0);await Promise.all([assert.rejects(a,{code:'REQUEST_TIMEOUT'}),assert.rejects(b,{code:'REQUEST_TIMEOUT'})]);assert.equal(count,2);hold.resolve('done');assert.equal(await join({key:'a',operation}), 'done');assert.equal(count,3);
});
test('scope hashes contain no raw identity, credential, query or URL',async()=>{
 const key=await encarLookupScopeKey({actor:{companyId:COMPANY,userId:USER,role:'dealer'},env:ENV,parameters:{plate:PLATE}});assert.match(key,/^[a-f0-9]{64}$/);assert(!key.includes(PLATE));
});
