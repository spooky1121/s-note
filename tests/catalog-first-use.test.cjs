'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const open=html.slice(html.indexOf('function openAdd(){'),html.indexOf('function closeAdd('));
const current=html.slice(html.indexOf('function snote253MessageCurrent('),html.indexOf('function snotePrepareRouteChange('));
const ensure=html.slice(html.indexOf('function snote2184EnsureCatalog(){'),html.indexOf('function domesticTaxonomy(){'));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture(){
 const gate=deferred(),calls={opened:0,notices:0};let key='synthetic-company:actor:0';
 const c={currentUser:{username:'synthetic-actor'},route:'buy',activeCarId:null,snote2184CatalogReady:false,snote2184AddIntent:0,snote220RegistrationSession:0,isAccountant:()=>false,snote2184EnsureCatalog:()=>gate.promise,snoteVehicleTaxonomyBridge:{context:()=>({key})},toast:()=>calls.notices++};
 c.window=c;vm.createContext(c);vm.runInContext(current+'\n'+open,c);
 const request=c.openAdd();c.openAdd=()=>{calls.opened++;return true;};
 return{c,calls,gate,request,invalidate:()=>{key='synthetic-company:actor:1';}};
}
for(const stop of ['close','route','same-account-scope','logout'])test('cold registration cannot reopen after '+stop,async()=>{
 const f=fixture();if(stop==='close')f.c.snote220RegistrationSession++;if(stop==='route')f.c.route='settings';if(stop==='same-account-scope')f.invalidate();if(stop==='logout')f.c.currentUser=null;
 f.gate.resolve();assert.equal(await f.request,false);assert.deepEqual(f.calls,{opened:0,notices:0});
});
test('a current cold registration intent resumes once after shared catalogue readiness',async()=>{
 const f=fixture();f.gate.resolve();assert.equal(await f.request,true);assert.deepEqual(f.calls,{opened:1,notices:0});
});
test('even an immediate first JSON failure waits for a new action before retry; retries coalesce',async()=>{
 let loaded=false,retries=0,initializations=0;const failed=Promise.reject(Error('synthetic offline'));failed.catch(()=>{});const gate=deferred();
 const c={snote2184CatalogTask:null,snote2184CatalogReady:false,SnoteFeatures:{loaded:()=>loaded,load:async()=>{loaded=true;}},SnoteVehicleCatalog:{ready:failed,load:()=>{retries++;c.SnoteVehicleCatalog.ready=gate.promise;return gate.promise;}},initTaxonomy:async()=>{await c.SnoteVehicleCatalog.ready;initializations++;}};
 c.window=c;vm.createContext(c);vm.runInContext(ensure,c);await assert.rejects(c.snote2184EnsureCatalog());assert.equal(retries,0);assert.equal(initializations,0);assert.equal(c.snote2184CatalogReady,false);
 const retry=c.snote2184EnsureCatalog(),duplicate=c.snote2184EnsureCatalog();assert.equal(retry,duplicate);await Promise.resolve();assert.equal(retries,1);gate.resolve();await retry;
 assert.equal(initializations,1);assert.equal(c.snote2184CatalogReady,true);assert.equal(c.snote2184EnsureCatalog(),retry);assert.equal(retries,1);
});
