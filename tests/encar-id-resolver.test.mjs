import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, resolveEncarId } from '../functions/_shared/encar-id-resolver.mjs';

// Provider transports and pages are synthetic; these tests prove orchestration,
// validation and bounds, not the currently unverified live search contracts.
const PLATE='12가3456';
const match=(provider,id='43123456',plate=PLATE)=>({status:'found',plate,id,sourceUrl:provider.url});
const options=search=>({plate:PLATE,search,providerTimeoutMs:1000,totalTimeoutMs:5000});
test('providers are immutable and ordered Carnect, GLOAR, Trust',()=>{
 assert.deepEqual(PROVIDERS.map(p=>p.id),['carnect','gloar','trust']);assert(Object.isFrozen(PROVIDERS));
 for(const p of PROVIDERS){assert(Object.isFrozen(p));assert.equal(new URL(p.url).hostname,p.host);assert.equal(new URL(p.url).protocol,'https:');}
});
test('the first verified result stops the sequence with only an ID and safe metadata',async()=>{
 const calls=[];const result=await resolveEncarId(options(async(provider,{plate,signal})=>{calls.push(provider.id);assert.equal(plate,PLATE);assert.equal(signal.aborted,false);return{...match(provider),priceWon:999999,sellerPhone:'PRIVATE_PHONE'};}));
 assert.deepEqual(calls,['carnect']);assert.equal(result.status,'found');assert.equal(result.id,'43123456');assert.equal(result.plate,PLATE);assert.equal(result.provider,'carnect');assert.equal(result.attempts.length,1);
 const serialized=JSON.stringify(result);assert(!serialized.includes('priceWon'));assert(!serialized.includes('PRIVATE_PHONE'));assert(!serialized.includes('fem.encar.com'));
});
test('not-found sources proceed sequentially and a later hit stops before the third source',async()=>{
 const calls=[];const result=await resolveEncarId(options(async provider=>{calls.push(provider.id);return provider.id==='gloar'?match(provider,'43123457'):{status:'not_found'};}));
 assert.deepEqual(calls,['carnect','gloar']);assert.equal(result.status,'found');assert.equal(result.provider,'gloar');assert.equal(result.id,'43123457');
});
test('a rate limit or provider exception is not retried and may fall through to the next source',async()=>{
 const calls=[];const result=await resolveEncarId(options(async provider=>{calls.push(provider.id);if(provider.id==='carnect')return{status:'error',code:'RATE_LIMITED',retryAfterSeconds:60};if(provider.id==='gloar')throw Error('PRIVATE_TOKEN provider internals');return match(provider,'43123458');}));
 assert.deepEqual(calls,['carnect','gloar','trust']);assert.equal(result.status,'found');assert.equal(result.provider,'trust');assert(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
});
test('only three actual no-matches produce NOT_FOUND, while failures remain unavailable',async()=>{
 const clean=await resolveEncarId(options(async()=>({status:'not_found'})));assert.equal(clean.status,'not_found');assert.equal(clean.code,'NOT_FOUND');assert.equal(clean.attempts.length,3);assert(!('id'in clean));
 const failed=await resolveEncarId(options(async()=>({status:'error',code:'PROVIDER_BLOCKED'})));assert.equal(failed.status,'error');assert.equal(failed.code,'PROVIDERS_UNAVAILABLE');assert.equal(failed.attempts.length,3);assert(!('id'in failed));
});
test('an ambiguous source is never converted into a guessed ID',async()=>{
 const result=await resolveEncarId(options(async provider=>provider.id==='carnect'?{...match(provider),status:'ambiguous'}:{status:'not_found'}));assert.equal(result.status,'error');assert.equal(result.code,'AMBIGUOUS');assert(!('id'in result));
});
test('wrong plates and malformed IDs are rejected before accepting a later exact match',async()=>{
 for(const bad of[{plate:'34나5678'},{id:'<img src=x>'},{id:'01234567'},{id:'123'},{id:'1234567890123'}]){
  const result=await resolveEncarId(options(async provider=>provider.id==='carnect'?{...match(provider),...bad}:provider.id==='gloar'?match(provider):{status:'not_found'}));assert.equal(result.status,'found');assert.equal(result.provider,'gloar');assert.equal(result.attempts[0].status,'invalid');
 }
});
test('source URLs cannot use credentials, ports, fragments, foreign or sibling hosts',async()=>{
 for(const sourceUrl of['http://carnect.biz/car/43123456','https://evil.invalid/car/43123456','https://carnect.biz.evil.invalid/car/43123456','https://sub.carnect.biz/car/43123456','https://user:password@carnect.biz/car/43123456','https://carnect.biz:443/car/43123456','https://carnect.biz/car/43123456#source']){
  const result=await resolveEncarId(options(async provider=>provider.id==='carnect'?{...match(provider),sourceUrl}:{status:'not_found'}));assert.notEqual(result.status,'found',sourceUrl);assert(!('id'in result),sourceUrl);assert.equal(result.attempts[0].status,'invalid',sourceUrl);
 }
});
test('provider timeouts abort each transport before the next begins and leave no active request',async()=>{
 let active=0,max=0;const calls=[];const result=await resolveEncarId({plate:PLATE,providerTimeoutMs:5,totalTimeoutMs:3000,search:async(provider,{signal})=>{calls.push(provider.id);active++;max=Math.max(max,active);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{active--;reject(Object.assign(Error('ABORTED'),{name:'AbortError'}));},{once:true}));}});
 assert.deepEqual(calls,['carnect','gloar','trust']);assert.equal(max,1);assert.equal(active,0);assert.equal(result.status,'error');assert(result.attempts.every(a=>a.status==='timeout'));
});
test('the total deadline stops the remaining providers',async()=>{
 const calls=[];const started=Date.now();const result=await resolveEncarId({plate:PLATE,providerTimeoutMs:1000,totalTimeoutMs:10,search:async(provider,{signal})=>{calls.push(provider.id);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
 assert.equal(result.status,'error');assert.equal(result.code,'TOTAL_TIMEOUT');assert.deepEqual(calls,['carnect']);assert(Date.now()-started<1000);
});
test('an uncooperative transport cannot hold the resolver beyond its configured bounds',async()=>{
 const started=Date.now();const result=await resolveEncarId({plate:PLATE,providerTimeoutMs:3,totalTimeoutMs:2000,search:()=>new Promise(()=>{})});assert.equal(result.status,'error');assert.equal(result.attempts.length,3);assert(Date.now()-started<1000);
});
test('caller cancellation is propagated and never resumes at another provider',async()=>{
 const before=new AbortController();before.abort();let calls=0;
 await assert.rejects(resolveEncarId({...options(async()=>{calls++;return{status:'not_found'};}),signal:before.signal}),e=>e.name==='AbortError'&&e.code==='ABORTED');assert.equal(calls,0);
 const controller=new AbortController();await assert.rejects(resolveEncarId({...options(async(provider,{signal})=>{calls++;queueMicrotask(()=>controller.abort());return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}),signal:controller.signal}),e=>e.name==='AbortError'&&e.code==='ABORTED');assert.equal(calls,1);
});
test('invalid caller inputs fail before invoking any provider',async()=>{
 let calls=0;const search=async()=>{calls++;return{status:'not_found'};};
 for(const patch of[{plate:''},{plate:'not-a-plate'},{plate:123},{search:null},{providerTimeoutMs:0},{totalTimeoutMs:-1},{providerTimeoutMs:60001},{signal:{aborted:false}}])await assert.rejects(resolveEncarId({...options(search),...patch}),e=>['INVALID_PLATE','INVALID_SEARCH','INVALID_TIMEOUT','INVALID_SIGNAL'].includes(e.code));
 assert.equal(calls,0);
});
