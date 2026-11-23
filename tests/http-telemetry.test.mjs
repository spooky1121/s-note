import test from 'node:test';
import assert from 'node:assert/strict';
import {observeAPIResponse,createObservationBudget} from '../functions/_shared/http-telemetry.mjs';
import {onRequest} from '../functions/api/_middleware.js';
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key'};
function setup({url='https://s-note.example/api/ocr?purpose=registration',method='POST',headers={},environment=env}={}){
 const jobs=[],events=[];const request=new Request(url,{method,headers,...(['GET','HEAD'].includes(method)?{}:{body:'synthetic input'})});
 return {context:{request,env:environment,waitUntil(promise){jobs.push(promise);}},jobs,events,write:async(config,event)=>{assert.equal(config,environment);events.push(event);}};
}
test('streaming observes UTF8 bytes without cloning, buffering, or changing response metadata',async()=>{
 const f=setup({headers:{'Content-Length':'15'}}),chunks=['가상',' 문서','😀'];let serial=0;
 const response=new Response(new ReadableStream({pull(c){if(serial<chunks.length)c.enqueue(new TextEncoder().encode(chunks[serial++]));else c.close();}}),{status:201,headers:{'Content-Type':'text/plain','X-Fixture':'preserved'}});
 let time=1000;const out=observeAPIResponse(f.context,response,900,{write:f.write,now:()=>time});
 assert.equal(out.headers.get('X-Fixture'),'preserved');assert.equal(out.status,201);assert.equal(await out.text(),chunks.join(''));await Promise.all(f.jobs);
 assert.equal(f.events.length,1);const e=f.events[0];assert.equal(e.requestBytes,15);assert.equal(e.responseBytes,new TextEncoder().encode(chunks.join('')).length);assert.equal(e.endpoint,'/api/ocr');assert.equal(e.userId,null);assert.equal(e.service,'http');assert.equal(e.ok,true);assert.equal(e.elapsedMs,100);assert(!JSON.stringify(e).includes('purpose'));assert(!JSON.stringify(e).includes('가상'));
});
test('absent request length remains unknown; bodyless responses really transfer zero bytes',async()=>{
 const f=setup(),response=new Response(null,{status:204});assert.equal(observeAPIResponse(f.context,response,Date.now(),{write:f.write}),response);await Promise.all(f.jobs);assert.equal(f.events[0].requestBytes,null);assert.equal(f.events[0].responseBytes,0);
});
test('configuration, platform context, and unknown paths retain original response',async()=>{
 for(const f of [setup({environment:{}}),setup({url:'https://s-note.example/api/unknown'})]){const r=new Response('unchanged');assert.equal(observeAPIResponse(f.context,r,Date.now(),{write:f.write}),r);assert.equal(f.jobs.length,0);assert.equal(await r.text(),'unchanged');}
 const f=setup();delete f.context.waitUntil;const r=new Response('same');assert.equal(observeAPIResponse(f.context,r,Date.now(),{write:f.write}),r);
});
test('credential recovery is excluded before observing bytes, consuming budget or registering background work',async()=>{
 const f=setup({url:'https://s-note.example/api/account-recovery?token=synthetic-private'}),r=new Response('{"resetToken":"synthetic-private"}');let admitted=0;
 assert.equal(observeAPIResponse(f.context,r,Date.now(),{write:f.write,admit:()=>{admitted++;return true;}}),r);assert.equal(r.body.locked,false);assert.equal(f.jobs.length,0);assert.equal(f.events.length,0);assert.equal(admitted,0);assert.equal(await r.text(),'{"resetToken":"synthetic-private"}');
});
test('cancelling a download counts only observed chunks and records one incomplete response',async()=>{
 const f=setup(),r=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(5));}}));const out=observeAPIResponse(f.context,r,Date.now(),{write:f.write});const reader=out.body.getReader();await reader.read();await reader.cancel();await Promise.all(f.jobs);assert.equal(f.events.length,1);assert.equal(f.events[0].ok,false);assert.equal(f.events[0].stage,'exception');assert(f.events[0].responseBytes>=5);
});
test('upstream stream error is preserved and recorder rejection never becomes an app error',async()=>{
 const f=setup(),r=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3));c.error(Error('synthetic stream failure'));}}));const out=observeAPIResponse(f.context,r,Date.now(),{write:async()=>{throw Error('observation unavailable');}});await assert.rejects(out.text(),/synthetic stream failure/);await Promise.all(f.jobs);
});
test('middleware keeps original authentication/size defenses and also observes denials',async()=>{
 const jobs=[],calls=[];const previous=globalThis.fetch;globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response('{}');};
 try{const request=new Request('https://s-note.example/api/ocr',{method:'POST',headers:{'Content-Type':'image/jpeg',Origin:'https://external.example'},body:'x'});let next=0;const r=await onRequest({request,env,waitUntil(p){jobs.push(p);},next(){next++;throw Error('must not execute');}});assert.equal(r.status,403);await r.text();await Promise.all(jobs);assert.equal(next,0);assert.equal(calls.length,1);assert.equal(calls[0].body.p_event.httpStatus,403);assert.equal(calls[0].body.p_event.endpoint,'/api/ocr');assert(!JSON.stringify(calls[0].body).includes('external.example'));}
 finally{globalThis.fetch=previous;}
});
test('observation saturation never changes or delays a business response and resets next window',async()=>{
 const budget=createObservationBudget(2,60000),f=setup();
 for(let i=0;i<3;i++){
  const original=new Response('business continues');const observed=observeAPIResponse(f.context,original,1000,{now:()=>1000,admit:budget,write:f.write});
  if(i===2)assert.equal(observed,original);assert.equal(await observed.text(),'business continues');
 }
 await Promise.all(f.jobs);assert.equal(f.events.length,2);assert.equal(budget(61000),true);
});
