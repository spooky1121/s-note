'use strict';
// Actual WebCrypto signing and local client, synthetic helper only. No scanner,
// customer record, cloud credential, database or local service is contacted.
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto'),M=require('../assets/scanner-device.js');
const {JSDOM}=require('./encar/node_modules/jsdom'),fs=require('node:fs'),path=require('node:path');
const NOW=Date.parse('2026-11-28T00:00:00Z'),TOKEN='ab'.repeat(32),SCOPE='["company-A","user-A"]',SESSION='["company-A","user-A","session-A"]';
const response=(body,status=200)=>Response.json(body,{status}),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(options={}){
 const f={calls:[],current:true,now:NOW,pending:new Map(),failFinish:null,holdFinish:null,badChallenge:null,finished:0};
 const store=options.store||M.createCredentialStore({crypto:webcrypto});f.store=store;
 f.fetch=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;assert.equal(u.origin,M.BASE);assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.targetAddressSpace,'loopback');assert(!Object.keys(init.headers).some(k=>/authorization|apikey|cookie/i.test(k)));assert(!JSON.stringify(body).includes('cloud-secret'));f.calls.push({path:u.pathname,body});
  if(u.pathname==='/v1/health')return response({ok:true,product:'snote-scanner-connector',platform:'windows',protocol:options.old?1:2,version:options.old?'1.0.0':'1.1.0'});
  if(u.pathname==='/v2/connect/start'){
   assert.deepEqual(Object.keys(body).sort(),['clientId','publicKey','scope','session']);assert.match(body.scope,/^[a-f0-9]{64}$/);assert.match(body.session,/^[a-f0-9]{64}$/);assert(!JSON.stringify(body).includes(SCOPE));assert(!JSON.stringify(body).includes(SESSION));
   const bytes=Buffer.from(body.publicKey,'base64'),digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');assert.equal(body.clientId,digest);const publicKey=await webcrypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
   const id=webcrypto.randomUUID(),nonce=webcrypto.getRandomValues(new Uint8Array(32));f.pending.set(id,{publicKey,nonce});return response({ok:true,id,challenge:f.badChallenge||Buffer.from(nonce).toString('base64'),expiresAt:new Date(f.now+120000).toISOString()});
  }
  assert.equal(u.pathname,'/v2/connect/finish');assert.deepEqual(Object.keys(body).sort(),['id','signature']);const entry=f.pending.get(body.id);assert(entry);assert.equal(Buffer.from(body.signature,'base64').length,64);assert(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},entry.publicKey,Buffer.from(body.signature,'base64'),entry.nonce));f.pending.delete(body.id);f.finished++;
  if(f.holdFinish)await f.holdFinish.promise;
  if(f.failFinish)return response({ok:false,code:f.failFinish},403);
  return response({ok:true,token:TOKEN,expiresAt:new Date(f.now+3600000).toISOString(),remembered:options.remembered!==false});
 };
 f.make=(patch={})=>M.createClient({fetch:f.fetch,crypto:webcrypto,credentialStore:store,credentialScope:SCOPE,scopeKey:SESSION,origin:'https://s-note.kr',clock:()=>f.now,isCurrent:()=>f.current,...patch});f.client=f.make();return f;
}

test('code-free connection proves possession of a nonextractable P256 key and is single-flight',async()=>{
 const f=fixture(),one=f.client.connect(),two=f.client.connect();assert.equal(one,two);await one;assert(f.client.connected());assert.equal(f.calls.filter(c=>c.path.endsWith('/start')).length,1);assert.equal(f.finished,1);assert.equal(f.calls.some(c=>c.path==='/v1/pair'),false);assert.equal(f.client.remembered(),false,'Missing durable IDB must not promise future auto-connect');
 const scope=f.calls.find(c=>c.path.endsWith('/start')).body.scope,identity=await f.store.identity(scope);assert.equal(identity.privateKey.extractable,false);await assert.rejects(webcrypto.subtle.exportKey('pkcs8',identity.privateKey));
});
test('new sessions reuse the browser identity but receive a fresh handshake and opaque session binding',async()=>{
 const f=fixture();await f.client.connect();const first=f.calls.find(c=>c.path.endsWith('/start')).body;const next=f.make({scopeKey:'new verified session'});await next.connect();const second=f.calls.filter(c=>c.path.endsWith('/start'))[1].body;assert.equal(second.clientId,first.clientId);assert.equal(second.scope,first.scope);assert.notEqual(second.session,first.session);assert.equal(f.finished,2);
});
test('company/user and origin changes use distinct credentials and never a shared identity',async()=>{
 const f=fixture();await f.client.connect();await f.make({credentialScope:'company-B/user-A'}).connect();await f.make({origin:'https://s-note.pages.dev'}).connect();const starts=f.calls.filter(c=>c.path.endsWith('/start')).map(c=>c.body);assert.equal(new Set(starts.map(s=>s.clientId)).size,3);assert.equal(new Set(starts.map(s=>s.scope)).size,3);
});
test('denied approval consumes the attempt and a later explicit retry creates a new challenge',async()=>{
 const f=fixture();f.failFinish='CONNECTION_DENIED';await assert.rejects(f.client.connect(),{code:'CONNECTION_DENIED'});assert.equal(f.client.connected(),false);f.failFinish=null;await f.client.connect();const ids=f.calls.filter(c=>c.path.endsWith('/finish')).map(c=>c.body.id);assert.equal(new Set(ids).size,2);assert(f.client.connected());
});
test('old helpers are detected before any connect request and show an update requirement',async()=>{
 const f=fixture({old:true});await assert.rejects(f.client.connect(),{code:'UPDATE_REQUIRED'});assert.equal(f.calls.length,1);assert.equal(f.client.connected(),false);assert.match(M.message({code:'UPDATE_REQUIRED'}),/최신 버전/);
});
test('a malformed challenge is rejected without signing or finishing an approval',async()=>{
 const f=fixture();f.badChallenge='not-base64';await assert.rejects(f.client.connect(),{code:'INVALID_RESPONSE'});assert.equal(f.finished,0);assert.equal(f.client.connected(),false);
});
test('cancel cannot accept a late native approval and does not retain the cancelled connection promise',async()=>{
 const f=fixture();f.holdFinish=deferred();const cancelled=f.client.connect();while(!f.finished)await new Promise(r=>setTimeout(r,0));f.client.cancel();const next=f.client.connect();assert.notEqual(next,cancelled);f.holdFinish.resolve();f.holdFinish=null;await assert.rejects(cancelled,{code:'CANCELLED'});await next;assert(f.client.connected());assert.equal(f.finished,2);
});
test('a changed application context cannot accept a late capability',async()=>{
 const f=fixture();f.holdFinish=deferred();const pending=f.client.connect();while(!f.finished)await new Promise(r=>setTimeout(r,0));f.current=false;f.holdFinish.resolve();await assert.rejects(pending,{code:'CONTEXT_CHANGED'});f.current=true;assert.equal(f.client.connected(),false);
});
test('device preferences contain only validated scan settings and stay account-scoped',async()=>{
 const store=M.createCredentialStore({crypto:webcrypto}),key='a'.repeat(64),other='b'.repeat(64),settings={deviceId:'printer-A',source:'flatbed',dpi:300,color:'color',token:TOKEN,image:'must-not-save',password:'cloud-secret'};await store.saveSelection(key,settings);assert.deepEqual(await store.loadSelection(key),{deviceId:'printer-A',source:'flatbed',dpi:300,color:'color'});assert.equal(await store.loadSelection(other),null);assert.equal(await store.saveSelection(key,{...settings,deviceId:'bad\nname'}),false);
});

function controllerFixture({multiple=false}={}){
 const dom=new JSDOM('<div id="host"></div>',{url:'https://s-note.kr/',runScripts:'outside-only'}),w=dom.window,f={dom,w,current:true,connected:false,scans:0,connections:0,saves:0,deviceHold:null,savedSelection:null};
 w.URL.createObjectURL=()=> 'blob:generated';w.URL.revokeObjectURL=()=>{};w.eval(fs.readFileSync(path.join(__dirname,'../assets/scanner-device.js'),'utf8'));
 const devices=[{id:'generic-WIA-A',name:'Canon 가상 스캐너',sources:['flatbed']},...(multiple?[{id:'generic-WIA-B',name:'HP 가상 스캐너',sources:['flatbed','feeder']}]:[])];
 const client={probe:async()=>{},connect:async()=>{f.connected=true;f.connections++;},connected:()=>f.connected,devices:async()=>{if(f.deviceHold)await f.deviceHold.promise;return devices;},scan:async()=>{f.scans++;return new w.File([new Uint8Array([255,216,255,217])],'scan.jpg',{type:'image/jpeg'});},cancel:()=>{},forget:()=>{f.connected=false;},exportConnection:()=>null,loadSelection:async()=>f.savedSelection,saveSelection:async value=>{f.savedSelection={...value};}};
 f.controller=w.SnoteScannerDevice.createController({host:w.document.getElementById('host'),scopeKey:'verified-session',credentialScope:'company/user',isCurrent:()=>f.current,platform:'Win32',client,onSave:async()=>{f.saves++;return true;}});return f;
}
test('one available manufacturer-independent scanner starts on the original web scan click without any code input',async()=>{
 const f=controllerFixture();try{await f.controller.activate();assert.equal(f.connections,1);assert.equal(f.scans,1);assert.equal(f.saves,0);assert(f.controller.pending());assert.equal(f.w.document.querySelector('[data-scanner-device-code]'),null);assert.equal(f.w.document.querySelector('input'),null);}finally{f.controller.dispose();f.dom.window.close();}
});
test('multiple scanners require a first choice, then preserve the selected device for later clicks',async()=>{
 const f=controllerFixture({multiple:true});try{await f.controller.activate();assert.equal(f.scans,0);const select=f.w.document.querySelector('[data-scanner-device-select]');select.value='generic-WIA-B';select.dispatchEvent(new f.w.Event('change'));f.w.document.querySelector('[data-scanner-device-start]').click();await new Promise(r=>setTimeout(r,0));assert.equal(f.scans,1);assert.equal(f.savedSelection.deviceId,'generic-WIA-B');}finally{f.controller.dispose();f.dom.window.close();}
});
test('cancel during delayed device discovery never starts a scan or publishes stale controls',async()=>{
 const f=controllerFixture();try{f.deviceHold=deferred();const opening=f.controller.activate();await new Promise(r=>setTimeout(r,0));f.controller.cancel();f.deviceHold.resolve();await opening;assert.equal(f.scans,0);assert.equal(f.controller.pending(),false);assert.equal(f.w.document.querySelector('[data-scanner-device-panel]').hidden,true);assert.equal(f.w.document.querySelectorAll('[data-scanner-device-select] option').length,0);}finally{f.controller.dispose();f.dom.window.close();}
});
