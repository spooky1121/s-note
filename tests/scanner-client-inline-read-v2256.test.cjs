'use strict';
// Execute the shipped client with synthetic metadata and image bytes only.
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../assets/scanner-client.js');
const COMPANY='11111111-1111-4111-8111-111111111111',uuid=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0'),CONTEXT={key:'verified-company-user-session'};
const PNG=new Uint8Array([137,80,78,71,13,10,26,10,0]),IMAGE=new File([PNG],'generated.png',{type:'image/png'});
const row=(n=1)=>({id:uuid(n),revision:1,filename:IMAGE.name,mimeType:IMAGE.type,size:IMAGE.size,createdAt:'2026-11-28T00:00:00.123456Z',updatedAt:'2026-11-28T00:00:00.123456Z'});
const envelope=items=>({ok:true,companyId:COMPANY,items,nextCursor:null});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture(request){
 const f={active:true,calls:[],created:[],revoked:[],opened:[]};
 f.client=create({current:context=>f.active&&context===CONTEXT,companyId:()=>COMPANY,request:async(context,value,check)=>{assert.equal(context,CONTEXT);f.calls.push(value);return request(value,check);},createURL:blob=>{const url='blob:generated-'+f.created.length;f.created.push({blob,url});return url;},revokeURL:url=>f.revoked.push(url),openViewer:async value=>{f.opened.push(value);return true;}});
 return f;
}
test('inline reads require verified metadata and reject forged IDs or revisions before requesting bytes',async()=>{
 const f=fixture(async value=>value.action==='list'?envelope([row()]):IMAGE);
 try{await assert.rejects(f.client.read(CONTEXT,row()),{code:'CONFLICT'});assert.equal(f.calls.length,0);await f.client.list(CONTEXT);await assert.rejects(f.client.read(CONTEXT,row(2)),{code:'CONFLICT'});await assert.rejects(f.client.read(CONTEXT,{...row(),revision:2}),{code:'SCANNER_INVALID_INPUT'});await assert.rejects(f.client.read({...CONTEXT,key:'other-session'},row()),{code:'SCANNER_CONTEXT_CHANGED'});assert.equal(f.calls.filter(value=>value.action==='read').length,0);assert.equal(await f.client.read(CONTEXT,{...row(),filename:'forged.html',mimeType:'image/svg+xml',size:1}),IMAGE,'Only the verified canonical metadata is trusted');assert.deepEqual(f.calls.at(-1),{action:'read',id:row().id,revision:1});assert.equal(f.created.length,0,'Raw reads leave URL ownership with the inline viewer');}finally{f.client.reset();}
});
test('simultaneous raw read and explicit viewer share one download without sharing caller cancellation',async()=>{
 const held=deferred(),f=fixture(async value=>value.action==='list'?envelope([row()]):held.promise);let caller=true;
 try{await f.client.list(CONTEXT);const cancelled=f.client.read(CONTEXT,row(),()=>caller),raw=f.client.read(CONTEXT,row()),opened=f.client.open(CONTEXT,row(),null);assert.equal(f.calls.filter(value=>value.action==='read').length,1);assert.equal(f.created.length,0);caller=false;held.resolve(IMAGE);await assert.rejects(cancelled,{code:'SCANNER_CONTEXT_CHANGED'});assert.equal(await raw,IMAGE);assert.equal(await opened,true);assert.equal(f.created.length,1);assert.equal(f.created[0].blob,IMAGE);assert.equal(f.opened.length,1);assert.equal(f.opened[0].isCurrent(),true);}finally{f.client.reset();assert.deepEqual(f.revoked,f.created.map(value=>value.url));}
});
test('inline reads reject incorrect MIME, size, magic bytes and non-Blob responses',async()=>{
 for(const invalid of[new Blob([PNG],{type:'image/jpeg'}),new Blob([PNG,new Uint8Array([0])],{type:'image/png'}),new Blob([new Uint8Array(PNG.length)],{type:'image/png'}),PNG]){
  const f=fixture(async value=>value.action==='list'?envelope([row()]):invalid);try{await f.client.list(CONTEXT);await assert.rejects(f.client.read(CONTEXT,row()),{code:'SCANNER_INVALID_IMAGE'});assert.equal(f.created.length,0);assert.equal(f.opened.length,0);}finally{f.client.reset();}
 }
});
test('late bytes cannot return through an invalid caller or changed authenticated scope',async()=>{
 for(const mode of['caller','scope']){
  const held=deferred(),f=fixture(async value=>value.action==='list'?envelope([row()]):held.promise);let caller=true;
  try{await f.client.list(CONTEXT);const pending=f.client.read(CONTEXT,row(),()=>caller);if(mode==='caller')caller=false;else f.active=false;held.resolve(IMAGE);await assert.rejects(pending,{code:'SCANNER_CONTEXT_CHANGED'});assert.equal(f.created.length,0);assert.equal(f.opened.length,0);}finally{f.client.reset();}
 }
});
test('a verified delete ACK retires a pending raw read and prevents later read resurrection',async()=>{
 const held=deferred(),f=fixture(async value=>value.action==='list'?envelope([row()]):value.action==='read'?held.promise:{ok:true,companyId:COMPANY,id:row().id,revision:2,deleted:true,duplicate:false});
 try{await f.client.list(CONTEXT);const pending=f.client.read(CONTEXT,row());assert.equal(f.calls.filter(value=>value.action==='read').length,1);await f.client.remove(CONTEXT,{id:row().id,expectedRevision:1,requestId:uuid(99)});held.resolve(IMAGE);await assert.rejects(pending,{code:'CONFLICT'});await assert.rejects(f.client.read(CONTEXT,row()),{code:'CONFLICT'});assert.equal(f.calls.filter(value=>value.action==='read').length,1);assert.equal(f.created.length,0);await assert.rejects(f.client.list(CONTEXT),{code:'SCANNER_INVALID_RESPONSE'},'A stale metadata row cannot undo the verified tombstone');}finally{f.client.reset();}
});
