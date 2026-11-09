// The real Encar handler with synthetic auth, canonical pages and price-provider
// replies. No production credentials, vehicles, customers or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './html-rewriter-setup.mjs';

const source = (await readFile(new URL('../../functions/api/encar.js', import.meta.url), 'utf8'))
  .replace("'../_shared/encar-catalog.mjs'", JSON.stringify(new URL('../../functions/_shared/encar-catalog.mjs', import.meta.url).href));
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const PLATE='12가3456', ID='43000001', ALIAS='43000002';
const ACTOR='10000000-0000-4000-8000-000000000001', TOKEN='synthetic_access_token_longer_than_thirty_characters';
const KEY='synthetic_private_price_key', PROVIDER='https://api.encar-api.com/api/car';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function page(id=ID, options={}) {
 const base={vehicleNo:PLATE,vehicleId:Number(id),queryCarId:Number(id),advertisement:{status:'ADVERTISE'},manage:{dummy:false,dummyVehicleId:null},category:{modelName:'합성 가격 차량'},spec:{mileage:10},...options};
 return '<script>window.__PRELOADED_STATE__='+JSON.stringify({cars:{base}})+';</script>';
}
async function run(config={}) {
 const calls=[],logs=[],previous=globalThis.fetch,info=console.info;
 console.info=(...args)=>logs.push(args.join(' '));
 globalThis.fetch=async(value,options={})=>{
  const url=new URL(value);calls.push({url:url.href,options});await config.onCall?.(url,options);
  if(url.href==='https://fixture.supabase.co/auth/v1/user')return json({id:ACTOR},config.authStatus||200);
  if(url.origin==='https://fixture.supabase.co'&&url.pathname==='/rest/v1/zc_members')return json([{user_id:ACTOR}]);
  if(url.origin==='https://fem.encar.com'){
   const id=url.pathname.split('/').at(-1),body=config.pages?.[id];
   return body instanceof Response?body: new Response(body===undefined?page(id):body,{headers:{'Content-Type':'text/html'}});
  }
  if(url.origin==='https://api.encar-api.com'){
   assert.equal(url.pathname,'/api/car');assert.deepEqual([...url.searchParams.keys()],['id']);
   if(config.provider)return config.provider(url,options,calls);
   return config.providerReply??json(config.row??{Id:url.searchParams.get('id'),Price:2820});
  }
  if(url.origin==='https://encar.spb.ru')return new Response('<div class="no-results">Ничего не найдено</div>',{headers:{'Content-Type':'text/html'}});
  throw Error('Unexpected synthetic URL: '+url.origin);
 };
 try{
  const payload=config.payload??{plate:PLATE,candidateIds:[ID]};
  const reply=await onRequest({request:new Request('https://snote.example/api/encar',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+TOKEN},body:JSON.stringify(payload),signal:config.signal}),env:{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic_public_key',TAVILY_API_KEY:'',ENCAR_API_KEY:Object.hasOwn(config,'key')?config.key:KEY}});
  return {status:reply.status,body:await reply.json(),calls,logs};
 }finally{globalThis.fetch=previous;console.info=info;}
}
const providerCalls=r=>r.calls.filter(c=>c.url.startsWith(PROVIDER));
function unavailable(row){assert.deepEqual([row.priceWon,row.priceCheckedAt,row.priceSource,row.priceStatus],[null,null,null,'unavailable']);}

test('canonical, live, same-plate advertisement receives exact provider KRW price and fetch time only',async()=>{
 const start=Date.now(),r=await run({row:{Id:ID,Price:2820,VehicleNo:PLATE,Status:'ADVERTISE',Seller:{name:'PRIVATE_SELLER',phone:'PRIVATE_PHONE'},previousPrice:99,priceEur:1}}),item=r.body.listings[0];
 assert.equal(r.status,200);assert.equal(r.body.status,'found');assert.equal(item.id,ID);assert.equal(item.priceWon,28200000);assert.equal(item.priceSource,'encar-api.com');assert.equal(item.priceStatus,'verified');assert(Date.parse(item.priceCheckedAt)>=start&&Date.parse(item.priceCheckedAt)<=Date.now());
 assert.doesNotMatch(JSON.stringify(r.body)+r.logs.join(''),/PRIVATE_|synthetic_private|synthetic_access|previousPrice|priceEur/);
 assert.equal(providerCalls(r).length,1);const call=providerCalls(r)[0];assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'manual');assert.equal(call.options.cache,'no-store');assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');assert.deepEqual(call.options.headers,{'x-api-key':KEY,Accept:'application/json'});
 assert(r.calls.filter(c=>!c.url.startsWith(PROVIDER)).every(c=>!JSON.stringify(c.options).includes(KEY)));
});

test('decimal conversion is exact down to a won, with a one-trillion-won maximum',async t=>{
 for(const [raw,won]of [[2820,28200000],['2820',28200000],[1.005,10050],['0.0001',1],['100000000',1000000000000]])await t.test(String(raw),async()=>{const r=await run({row:{Id:ID,Price:raw}});assert.equal(r.body.listings[0].priceWon,won);});
});

test('zero, negative, malformed, quoted, fractional-won, unsafe and non-cash prices are unavailable without losing links',async t=>{
 for(const raw of [0,-1,null,true,{},[],NaN,Infinity,'','상담','리스','2,820','2820원','1e5','0.00001',100000001,'100000000.0001','9007199254740992'])await t.test(String(raw),async()=>{const r=await run({row:{Id:ID,Price:raw}});assert.equal(r.status,200);assert.equal(r.body.listings[0].sellerUrl,'https://fem.encar.com/cars/detail/'+ID);unavailable(r.body.listings[0]);});
});

test('only uppercase current Price is accepted, not EUR, old price or guessed source HTML fields',async t=>{
 for(const row of [{Id:ID,price:2820},{Id:ID,priceEur:2820},{Id:ID,priceDrop:{previousPrice:2820}},{Id:ID,advertisement:{price:2820}},{Id:ID}])await t.test(JSON.stringify(row),async()=>{const r=await run({row});unavailable(r.body.listings[0]);});
});

test('exact canonical ID and any provided plate, status, currency and lease flags must agree',async t=>{
 for(const delta of [{Id:ALIAS},{VehicleNo:'34나5678'},{VehicleNo:''},{details:{vehicleNo:'34나5678'}},{Status:'SOLD'},{Status:'REMOVED'},{status:'unknown'},{Sold:true},{isSold:0},{Available:false},{Currency:'EUR'},{PriceType:'LEASE'},{SellType:'리스'},{Lease:true},{Rental:true}])await t.test(JSON.stringify(delta),async()=>{const r=await run({row:{Id:ID,Price:2820,...delta}});unavailable(r.body.listings[0]);});
});

test('bounded documented container wrappers work and ambiguous nested prices fail closed',async t=>{
 const r=await run({row:{data:{car:{Id:ID,Price:2820}}}});assert.equal(r.body.listings[0].priceWon,28200000);
 for(const row of [{Id:ID,Price:2820,data:{Id:ID,Price:9999}},{data:{result:{car:{payload:{Id:ID,Price:2820}}}}},[{Id:ID,Price:2820}]])await t.test(JSON.stringify(row),async()=>{const r=await run({row});unavailable(r.body.listings[0]);});
});

test('missing and malformed API keys skip provider use while the verified advertisement still succeeds',async t=>{
 for(const key of ['',undefined,'short','private\nheader','x'.repeat(1025)])await t.test(String(key),async()=>{const r=await run({key});assert.equal(r.status,200);unavailable(r.body.listings[0]);assert.equal(providerCalls(r).length,0);});
});

test('provider HTTP rejection, removal, redirects, invalid JSON/type and oversized bodies do not erase verified links',async t=>{
 for(const status of [301,302,307,401,403,404,429,500,503])await t.test(String(status),async()=>{const r=await run({providerReply:new Response('private message '+KEY,{status,headers:{Location:'https://evil.example/private'}})});assert.equal(r.status,200);unavailable(r.body.listings[0]);assert.equal(providerCalls(r).length,1);assert.doesNotMatch(JSON.stringify(r.body)+r.logs.join(''),/private message|synthetic_private/);});
 for(const response of [new Response('invalid',{headers:{'Content-Type':'application/json'}}),new Response(JSON.stringify({Id:ID,Price:1}),{headers:{'Content-Type':'text/html'}}),new Response('x',{headers:{'Content-Type':'application/json','Content-Length':'1048577'}}),new Response('x'.repeat(1048577),{headers:{'Content-Type':'application/json'}})])await t.test('invalid response',async()=>{const r=await run({providerReply:response});assert.equal(r.status,200);unavailable(r.body.listings[0]);});
});

test('a same-plate trusted alias is resolved but only the canonical seller ID is priced',async()=>{
 const r=await run({payload:{plate:PLATE,candidateIds:[ALIAS]},pages:{[ALIAS]:page(ID,{queryCarId:Number(ALIAS),manage:{dummy:true,dummyVehicleId:Number(ALIAS)}}),[ID]:page(ID,{manage:{dummy:false,dummyVehicleId:Number(ALIAS)}})}});
 assert.equal(r.body.listings[0].id,ID);assert.equal(r.body.listings[0].trustedId,ALIAS);assert.equal(new URL(providerCalls(r)[0].url).searchParams.get('id'),ID);assert.equal(providerCalls(r).length,1);
});

test('failed authentication, inactive advertisements and wrong vehicle plates never consume provider requests',async t=>{
 for(const config of [{authStatus:401},{pages:{[ID]:page(ID,{vehicleNo:'34나5678'})}},{pages:{[ID]:page(ID,{advertisement:{status:'SOLD'}})}}])await t.test(JSON.stringify(config),async()=>{const r=await run(config);assert.equal(providerCalls(r).length,0);assert.equal(r.body.listings.length,0);});
});

test('multiple verified advertisements bind individual prices and use at most three provider requests',async()=>{
 const ids=Array.from({length:5},(_,i)=>String(43000001+i));
 const r=await run({payload:{plate:PLATE,candidateIds:ids},provider:(url)=>json({Id:url.searchParams.get('id'),Price:Number(url.searchParams.get('id'))-43000000})});
 assert.equal(r.body.status,'multiple');assert.equal(providerCalls(r).length,3);assert.equal(r.body.listings.length,5);
 for(const [index,row]of r.body.listings.entries()){if(index<3)assert.equal(row.priceWon,(index+1)*10000);else unavailable(row);}
});

test('a provider that never returns is cut off by the shared six-second budget without failing a link',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered;const ready=new Promise(resolve=>entered=resolve);
 const pending=run({provider:()=>{entered();return new Promise(()=>{});}});await ready;t.mock.timers.tick(6001);const r=await pending;
 assert.equal(r.status,200);assert.equal(r.body.status,'found');unavailable(r.body.listings[0]);assert.equal(providerCalls(r).length,1);
});

test('a hanging provider body shares the same bounded price budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered;const ready=new Promise(resolve=>entered=resolve);
 const pending=run({provider:()=>new Response(new ReadableStream({pull(){entered();}},{highWaterMark:0}),{headers:{'Content-Type':'application/json'}})});await ready;t.mock.timers.tick(6001);const r=await pending;
 assert.equal(r.status,200);unavailable(r.body.listings[0]);
});

test('price lookup is skipped when the verified advertisement leaves too little total deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const previous=Date.now;let now=100000;Date.now=()=>now;t.after(()=>{Date.now=previous;});
 const r=await run({onCall:url=>{if(url.origin==='https://fem.encar.com')now+=34600;}});
 assert.equal(r.status,200);assert.equal(providerCalls(r).length,0);unavailable(r.body.listings[0]);
});

test('price timeout shrinks with the original deadline and still preserves the verified advertisement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const previous=Date.now;let now=100000;Date.now=()=>now;t.after(()=>{Date.now=previous;});let entered;const ready=new Promise(resolve=>entered=resolve);
 const pending=run({onCall:url=>{if(url.origin==='https://fem.encar.com')now+=34000;},provider:()=>{entered();return new Promise(()=>{});}});
 await ready;t.mock.timers.tick(751);const r=await pending;assert.equal(r.status,200);unavailable(r.body.listings[0]);assert(Date.now()<135000);
});

test('request cancellation aborts outstanding optional price work without waiting for the provider',async()=>{
 const controller=new AbortController();let entered;const ready=new Promise(resolve=>entered=resolve);
 const pending=run({signal:controller.signal,provider:()=>{entered();return new Promise(()=>{});}});await ready;controller.abort();const r=await pending;
 assert.equal(r.status,200);unavailable(r.body.listings[0]);assert.equal(providerCalls(r)[0].options.signal.aborted,true);
});
