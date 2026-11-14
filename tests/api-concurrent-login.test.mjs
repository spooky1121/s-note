// Ordinary API dispatch after removal of the single-session lease. Endpoint
// handlers retain their JWT/membership checks. No production calls are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';

const user='11111111-1111-4111-8111-111111111111';
const token=sid=>['eyJhbGciOiJFUzI1NiJ9',Buffer.from(JSON.stringify({role:'authenticated',sub:user,session_id:sid})).toString('base64url'),'c3ludGhldGlj'].join('.');
function request(sid,changes={}) {
 return new Request('https://s-note.example/api/encar',{method:'POST',body:'{}',...changes,
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(sid),...changes.headers}});
}

test('two ordinary account sessions dispatch without a lease RPC or environment prerequisite',async()=>{
 const original=globalThis.fetch;let handlers=0;
 try {
  globalThis.fetch=()=>{throw Error('Middleware must not call an account-session lease service');};
  for(const sid of ['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333']) {
   const response=await onRequest({request:request(sid),env:{},next:()=>{handlers++;return Response.json({ok:true});}});
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
   assert.match(response.headers.get('Cache-Control'),/no-store/);assert.match(response.headers.get('Content-Security-Policy'),/default-src 'none'/);
  }
  assert.equal(handlers,2);
 } finally {globalThis.fetch=original;}
});

test('the endpoint retains its own authentication and membership denial',async()=>{
 for(const status of [401,403]) {
  let handlers=0;
  const response=await onRequest({request:request('22222222-2222-4222-8222-222222222222'),env:{},next:()=>{handlers++;return Response.json({ok:false,code:'HANDLER_AUTH_DENIED'},{status});}});
  assert.equal(response.status,status);assert.equal(handlers,1);assert.equal((await response.json()).code,'HANDLER_AUTH_DENIED');
 }
});

test('missing JWT syntax and cross-origin requests remain blocked before dispatch',async()=>{
 for(const [headers,status] of [[{Authorization:''},401],[{Origin:'https://untrusted.example'},403]]) {
  let handlers=0;
  const response=await onRequest({request:request('22222222-2222-4222-8222-222222222222',{headers}),env:{},next:()=>{handlers++;return Response.json({ok:true});}});
  assert.equal(response.status,status);assert.equal(handlers,0);
 }
});

test('public weather keeps its independent flow and handler failures remain sanitized',async()=>{
 let handlers=0;
 const response=await onRequest({request:new Request('https://s-note.example/api/weather'),env:{},next:()=>{handlers++;return Response.json({ok:true});}});
 assert.equal(response.status,200);assert.equal(handlers,1);
 const failure=await onRequest({request:request('22222222-2222-4222-8222-222222222222'),env:{},next:()=>{throw Error('PRIVATE_TOKEN_PROVIDER_DETAIL');}});
 assert.equal(failure.status,502);const data=await failure.json();assert.equal(data.code,'UPSTREAM_ERROR');assert.doesNotMatch(JSON.stringify(data),/PRIVATE_TOKEN|SESSION_/);
});
