import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceTelemetry, writeHttpTelemetry, SERVICE_TELEMETRY_TIMEOUT_MS } from '../functions/_shared/service-telemetry.mjs';
import { API_POLICIES } from '../functions/_shared/api-security.js';
import { createEncarIdHandler } from '../functions/api/encar-id.js';
import { onRequestPost as ocr } from '../functions/api/ocr.js';

// Synthetic Auth, membership, provider and recording responses only. Every
// fetch is intercepted; no billed provider, service account or customer is used.
const USER = '11111111-1111-4111-8111-111111111111', COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'https://service-telemetry.example', PLATE = '12가3456', AD = '43123456';
const JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj';
const ENV = { SUPABASE_URL: 'https://telemetry-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', GOOGLE_VISION_API_KEY: 'synthetic-vision-key' };
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const eventKeys = ['adId','elapsedMs','httpStatus','ok','requestBytes','requestId','responseBytes','service','stage','startedAt','userId'];
const json = (value, status = 200) => Response.json(value, { status });
function context(request, env = ENV) {
  const held = [], value = { request, env, held, waitUntil(promise) { assert.equal(this, value, 'The Pages lifetime method must keep its receiver'); held.push(promise); } };
  return value;
}
function encarRequest(body = { plate: PLATE }) { return new Request(ORIGIN + '/api/encar-id', { method:'POST', headers:{ Origin:ORIGIN, 'Sec-Fetch-Site':'same-origin', 'Content-Type':'application/json', Authorization:'Bearer '+JWT }, body:JSON.stringify(body) }); }
function ocrRequest(body = png, purpose = '') { return new Request(ORIGIN + '/api/ocr' + purpose, { method:'POST', headers:{ Origin:ORIGIN, 'Content-Type':'image/png', Authorization:'Bearer '+JWT }, body, duplex:'half' }); }
function assertPrivate(event) {
  assert.deepEqual(Object.keys(event).sort(), eventKeys);assert.equal(event.userId, USER);assert.match(event.requestId,/^[0-9a-f-]{36}$/u);
  assert(Number.isFinite(Date.parse(event.startedAt)));assert(Number.isSafeInteger(event.elapsedMs)&&event.elapsedMs>=0);
  for(const forbidden of [PLATE, JWT, ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.GOOGLE_VISION_API_KEY, 'VIN_SECRET', 'PRIVATE_OCR', 'PRIVATE_CUSTOMER', 'gloar-data.com', 'sourceUrl', 'rawText', 'exception', 'phone']) assert(!JSON.stringify(event).includes(forbidden), forbidden);
}
function fixture(t, { members, authStatus = 200, googleStatus = 200, googleBody, recorder } = {}) {
  const calls = [], events = [];const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);calls.push({url,options});assert.equal(options.redirect,'manual');assert(options.signal instanceof AbortSignal);
    if(url.origin===ENV.SUPABASE_URL && url.pathname==='/rest/v1/rpc/snote_service_event') {
      assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.headers.apikey,ENV.SUPABASE_SERVICE_ROLE_KEY);assert.equal(options.headers.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);
      const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body),['p_event']);assertPrivate(body.p_event);events.push(body.p_event);
      return recorder ? recorder(body.p_event, options) : new Response(null,{status:204});
    }
    if(url.origin===ENV.SUPABASE_URL) {
      assert.equal(options.method,'GET');assert.equal(options.headers.apikey,ENV.SUPABASE_PUBLISHABLE_KEY);assert.equal(options.headers.Authorization,'Bearer '+JWT);
      if(url.pathname==='/auth/v1/user') return json({id:USER,email:'PRIVATE_CUSTOMER',user_metadata:{role:'admin'}},authStatus);
      assert.equal(url.pathname,'/rest/v1/zc_members');assert.equal(url.searchParams.get('user_id'),'eq.'+USER);assert.equal(url.searchParams.get('active'),'eq.true');assert.equal(url.searchParams.get('limit'),'1');
      assert(['user_id','user_id,company_id,role,active'].includes(url.searchParams.get('select')),'Existing membership queries remain unchanged');
      return json(members===undefined?[{user_id:USER,company_id:COMPANY,role:'dealer',active:true}]:members);
    }
    assert.equal(url.origin,'https://vision.googleapis.com');assert.equal(url.pathname,'/v1/images:annotate');assert.equal(url.searchParams.get('key'),ENV.GOOGLE_VISION_API_KEY);
    return json(googleBody||{responses:[{fullTextAnnotation:{text:'PRIVATE_OCR VIN_SECRET 12가3456 PRIVATE_CUSTOMER'}}]},googleStatus);
  };
  t.after(()=>{globalThis.fetch=original;});return {calls,events};
}
const found = () => ({status:'found',plate:PLATE,id:AD,provider:'gloar',sourceUrl:'https://gloar-data.com/en/lot/VIN_SECRET'});
const httpEvent = extra => ({userId:null,requestId:'22222222-2222-4222-8222-222222222222',service:'http',startedAt:'2026-11-23T09:00:00.000Z',elapsedMs:42,ok:true,httpStatus:200,stage:'response',adId:null,requestBytes:12,responseBytes:200,endpoint:'/api/weather',method:'GET',...extra});

test('recorder is exact, idempotent, bound and does not wait for persistence', async t => {
  let release;const waiting=new Promise(resolve=>release=resolve);const s=fixture(t,{recorder:()=>waiting});
  const c=context(encarRequest());let clock=1000;const recorder=createServiceTelemetry(c,{service:'encar',now:()=>clock});
  recorder.authorized({userId:USER,phone:'PRIVATE_CUSTOMER'});recorder.stage('complete');recorder.bytes({requestBytes:12,responseBytes:30});clock=1027;
  const response=new Response('complete');assert.equal(recorder.finish(response,{ok:true,adId:AD}),response);recorder.finish(response,{ok:false});
  assert.equal(c.held.length,1);await Promise.resolve();assert.equal(s.events.length,1);assert.equal(s.events[0].elapsedMs,27);assert.equal(s.events[0].requestId,response.headers.get('X-Snote-Request-Id'));assert.equal(s.events[0].requestBytes,12);
  release(new Response(null,{status:204}));await Promise.all(c.held);
});
test('recorder skips absent or unverified actors, unavailable config and missing lifetime support', async () => {
  let fetches=0;const fetchImpl=async()=>{fetches++;throw Error('No network permitted');};
  for(const variant of ['unverified','invalid-user','no-key','foreign-url','no-wait']) {
    const c=context(encarRequest());if(variant==='no-key')c.env={...ENV,SUPABASE_SERVICE_ROLE_KEY:''};if(variant==='foreign-url')c.env={...ENV,SUPABASE_URL:'https://attacker.example'};if(variant==='no-wait')delete c.waitUntil;
    const recorder=createServiceTelemetry(c,{service:'encar',fetchImpl});if(variant!=='unverified')recorder.authorized({userId:variant==='invalid-user'?'forged':USER});
    assert.equal(recorder.finish(new Response('unchanged')).status,200);assert.equal(c.held.length,0);
  }
  assert.equal(fetches,0);
});
test('recorder suppresses raw metadata, malformed IDs and invalid measurements', async t => {
  const s=fixture(t),c=context(encarRequest());const recorder=createServiceTelemetry(c,{service:'vision'});recorder.authorized({userId:USER});recorder.stage('https://VIN_SECRET');recorder.bytes({requestBytes:-1,responseBytes:Infinity,rawText:'PRIVATE_OCR'});
  recorder.finish(new Response('unchanged'),{ok:true,adId:AD,stage:'PRIVATE_OCR'});await Promise.all(c.held);
  assert.deepEqual({adId:s.events[0].adId,stage:s.events[0].stage,requestBytes:s.events[0].requestBytes,responseBytes:s.events[0].responseBytes},{adId:null,stage:'request',requestBytes:null,responseBytes:null});
});
test('recorder timeout bounds waitUntil even when transport ignores cancellation', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const c=context(encarRequest()),recorder=createServiceTelemetry(c,{service:'encar',fetchImpl:async(input,options)=>{signal=options.signal;return new Promise(()=>{});}});recorder.authorized({userId:USER});recorder.finish(new Response('unchanged'));
  await Promise.resolve();assert.equal(signal.aborted,false);t.mock.timers.tick(SERVICE_TELEMETRY_TIMEOUT_MS);await Promise.all(c.held);assert.equal(signal.aborted,true);
});
test('recorder missing RPC, network errors and throwing lifetime callbacks never fail the response', async () => {
  for(const transport of [async()=>new Response('missing',{status:404}),async()=>new Response('offline',{status:503}),async()=>{throw Error('PRIVATE_CUSTOMER secret');}]) {
    const c=context(encarRequest()),recorder=createServiceTelemetry(c,{service:'encar',fetchImpl:transport});recorder.authorized({userId:USER});assert.equal(recorder.finish(new Response('business-result')).status,200);await Promise.all(c.held);
  }
  const c=context(encarRequest());c.waitUntil=()=>{throw Error('Lifetime unavailable');};const recorder=createServiceTelemetry(c,{service:'encar',fetchImpl:async()=>new Response(null,{status:204})});recorder.authorized({userId:USER});assert.equal(await recorder.finish(new Response('business-result')).text(),'business-result');
});
test('actual GLOAR route records verified found ID with the existing diagnostic request ID', async t => {
  const s=fixture(t),c=context(encarRequest()),res=await createEncarIdHandler({lookup:found})(c);assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,status:'found',plate:PLATE,id:AD,provider:'gloar'});await Promise.all(c.held);
  assert.equal(s.events.length,1);const event=s.events[0];assert.equal(event.service,'encar');assert.equal(event.ok,true);assert.equal(event.adId,AD);assert.equal(event.stage,'complete');assert.equal(event.requestId,res.headers.get('X-Snote-Request-Id'));assert.equal(event.elapsedMs,Number(res.headers.get('X-Snote-Duration-Ms')));
});
test('actual GLOAR no-match, provider failure and invalid proof stay distinct and record no guessed ID', async t => {
  for(const variant of ['not_found','provider_error','invalid_proof']) {
    const s=fixture(t),c=context(encarRequest()),lookup=()=>variant==='not_found'?{status:'not_found',plate:PLATE,code:'NOT_FOUND'}:variant==='invalid_proof'?{...found(),plate:'34나5678'}:(()=>{throw Object.assign(Error('PRIVATE_OCR VIN_SECRET'),{code:'BROWSER_BUSY'});})();
    const res=await createEncarIdHandler({lookup,logger:()=>{}})(c);await Promise.all(c.held);assert.equal(s.events.length,1);assert.equal(s.events[0].ok,false);assert.equal(s.events[0].adId,null);assert.equal(s.events[0].httpStatus,variant==='not_found'?200:variant==='provider_error'?503:502);assert.equal(s.events[0].stage,variant==='not_found'?'not_found':variant==='provider_error'?'lookup':'verification');
  }
});
test('actual shared in-flight search still records each freshly authenticated request', async t => {
  const s=fixture(t),a=context(encarRequest()),b=context(encarRequest());let invocations=0,release;const gate=new Promise(resolve=>release=resolve),handler=createEncarIdHandler({lookup:async()=>{invocations++;await gate;return found();}});
  const pending=[handler(a),handler(b)];while(a.held.length+b.held.length<2)await new Promise(resolve=>setImmediate(resolve));release();const responses=await Promise.all(pending);await Promise.all([...a.held,...b.held]);
  assert(responses.every(response=>response.status===200));assert.equal(invocations,1);assert.equal(s.events.length,2);assert.notEqual(s.events[0].requestId,s.events[1].requestId);
});
test('actual OCR records only successful usage metadata and retains the existing user_id membership query', async t => {
  for(const purpose of ['', '?purpose=encar-price']) {
    const s=fixture(t),c=context(ocrRequest(png,purpose)),res=await ocr(c);assert.equal(res.status,200);assert.equal((await res.json()).engine,'google-vision');await Promise.all(c.held);
    assert.equal(s.events.length,1);assert.equal(s.events[0].service,'vision');assert.equal(s.events[0].stage,'complete');assert.equal(s.events[0].ok,true);assert.equal(s.events[0].adId,null);assert.equal(s.events[0].requestBytes,png.byteLength);assert.equal(s.events[0].requestId,res.headers.get('X-Snote-Request-Id'));assert.equal(s.calls.find(call=>call.url.pathname==='/rest/v1/zc_members').url.searchParams.get('select'),'user_id');
  }
});
test('actual OCR provider quota, malformed image and provider parse failures record the failing stage', async t => {
  for(const variant of ['quota','invalid_image','parse']) {
    const s=fixture(t,{googleStatus:variant==='quota'?429:200,googleBody:variant==='parse'?{responses:[{error:{message:'PRIVATE_OCR'}}]}:undefined}),c=context(ocrRequest(variant==='invalid_image'?new Uint8Array([1,2,3]):png)),res=await ocr(c);await Promise.all(c.held);
    assert.equal(s.events.length,1);assert.equal(s.events[0].ok,false);assert.equal(s.events[0].httpStatus,variant==='quota'?429:variant==='invalid_image'?415:502);assert.equal(s.events[0].stage,variant==='quota'?'provider':variant==='invalid_image'?'upload':'parse');
  }
});
test('actual health, rejected authentication and membership never record an unverified user', async t => {
  const s=fixture(t,{members:[]});let c=context(encarRequest()),res=await createEncarIdHandler({lookup:found,logger:()=>{}})(c);assert.equal(res.status,403);await Promise.all(c.held);
  c=context(ocrRequest());res=await ocr(c);assert.equal(res.status,403);await Promise.all(c.held);
  c=context(new Request(ORIGIN+'/api/encar-id'));res=await createEncarIdHandler({lookup:found})(c);assert.equal(res.status,200);assert.equal(c.held.length,0);assert.equal(s.events.length,0);
});
test('anonymous HTTP recorder emits only aggregate fields and drops identities, tokens and body text', async () => {
  let event;await writeHttpTelemetry(ENV,httpEvent({authorization:JWT,rawText:'PRIVATE_OCR',sourceUrl:'https://secret.invalid',companyId:COMPANY}),{fetchImpl:async(input,options)=>{
    assert.equal(input,ENV.SUPABASE_URL+'/rest/v1/rpc/snote_service_event');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);event=JSON.parse(options.body).p_event;return new Response(null,{status:204});
  }});
  assert.deepEqual(event,httpEvent());assert.equal(event.userId,null);assert.equal(event.adId,null);assert(!JSON.stringify(event).includes(JWT));assert(!JSON.stringify(event).includes('PRIVATE_OCR'));assert(!JSON.stringify(event).includes(COMPANY));
});
test('HTTP endpoint whitelist shares all current API policy paths and accepts bounded standard methods', async () => {
  const observed=[];for(const endpoint of Object.keys(API_POLICIES))await writeHttpTelemetry(ENV,httpEvent({endpoint}),{fetchImpl:async(input,options)=>{observed.push(JSON.parse(options.body).p_event.endpoint);return new Response(null,{status:204});}});
  assert.deepEqual(observed,Object.keys(API_POLICIES));for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){let calls=0;await writeHttpTelemetry(ENV,httpEvent({method,httpStatus:405,ok:false}),{fetchImpl:async()=>{calls++;return new Response(null,{status:204});}});assert.equal(calls,1);}
});
test('HTTP raw queries, arbitrary URLs, claimed identities and malformed observations never reach the RPC', async () => {
  let calls=0;const fetchImpl=async()=>{calls++;return new Response(null,{status:204});};
  for(const invalid of [{endpoint:'/api/weather?token=PRIVATE'},{endpoint:'https://secret.invalid/api/weather'},{endpoint:'/api/unknown'},{method:'TRACE PRIVATE'},{userId:USER},{adId:AD},{service:'encar'},{requestId:'forged'},{startedAt:'not-time'},{elapsedMs:-1},{httpStatus:999},{ok:'true'},{stage:'lookup'}])await writeHttpTelemetry(ENV,httpEvent(invalid),{fetchImpl});
  assert.equal(calls,0);
});
test('HTTP recording skips missing configuration and swallows missing RPC, transport and body failures', async () => {
  let calls=0;await writeHttpTelemetry({...ENV,SUPABASE_SERVICE_ROLE_KEY:''},httpEvent(),{fetchImpl:async()=>{calls++;}});assert.equal(calls,0);
  for(const fetchImpl of [async()=>new Response('missing',{status:404}),async()=>{throw Error('PRIVATE_TOKEN');},async()=>({body:{cancel(){throw Error('PRIVATE_OCR');}}})])assert.equal(await writeHttpTelemetry(ENV,httpEvent(),{fetchImpl}),undefined);
});
test('HTTP recorder has the same bounded lifetime even when its transport ignores abort', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let signal;const pending=writeHttpTelemetry(ENV,httpEvent(),{fetchImpl:async(input,options)=>{signal=options.signal;return new Promise(()=>{});}});
  await Promise.resolve();assert.equal(signal.aborted,false);t.mock.timers.tick(SERVICE_TELEMETRY_TIMEOUT_MS);assert.equal(await pending,undefined);assert.equal(signal.aborted,true);
});
