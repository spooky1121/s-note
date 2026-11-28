'use strict';
// Real controller, generated images, no scanner or operating requests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('./encar/node_modules/jsdom');
const JPEG=new Uint8Array([255,216,255,217]);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(done=>setTimeout(done,0));};
function fixture({inlinePreview=true}={}){
 const dom=new JSDOM('<div id="host"></div>',{url:'https://s-note.kr/',runScripts:'outside-only'}),w=dom.window;
 const f={dom,w,current:true,connected:false,files:[],previews:[],saved:[],created:[],revoked:[],accept:true,canSave:true,hold:null};
 w.URL.createObjectURL=blob=>{const url='blob:generated-'+f.created.length;f.created.push({url,blob});return url;};w.URL.revokeObjectURL=url=>f.revoked.push(url);
 w.eval(fs.readFileSync(path.join(__dirname,'../assets/scanner-device.js'),'utf8'));
 const client={probe:async()=>{},connect:async()=>{f.connected=true;},connected:()=>f.connected,devices:async()=>[{id:'generic-wia',name:'합성 스캐너',sources:['flatbed']}],scan:async()=>{if(f.hold)await f.hold.promise;const file=new w.File([JPEG],'scan-'+(f.files.length+1)+'.jpg',{type:'image/jpeg'});f.files.push(file);return file;},cancel(){},forget(){f.connected=false;},exportConnection:()=>null};
 f.controller=w.SnoteScannerDevice.createController({host:w.document.getElementById('host'),scopeKey:'verified-session',credentialScope:'company/user',isCurrent:()=>f.current,platform:'Win32',client,inlinePreview,onPreview:file=>f.previews.push(file),canSave:()=>f.canSave,onSave:file=>{f.saved.push(file);return f.accept;}});
 f.query=selector=>w.document.querySelector(selector);f.close=()=>{f.controller.dispose();dom.window.close();};return f;
}
test('inline device preview publishes the exact File without a second image URL or automatic upload',async()=>{
 const f=fixture();try{assert.equal(f.previews.length,0);await f.controller.activate();assert.equal(f.previews.length,1);assert.equal(f.previews[0],f.files[0]);assert(f.controller.pending());assert.equal(f.saved.length,0);assert.equal(f.query('[data-scanner-device-image]').hidden,true);assert.equal(f.query('[data-scanner-device-image]').hasAttribute('src'),false);assert(f.query('[data-scanner-device-panel]').hasAttribute('data-inline-preview'));assert.equal(f.query('[data-scanner-device-save]').hidden,false);assert.equal(f.created.length,0);}finally{f.close();}
});
test('the original file is saved only after confirmation and the native preview is cleared once',async()=>{
 const f=fixture();try{await f.controller.activate();const original=f.files[0];f.query('[data-scanner-device-save]').click();await settle();assert.deepEqual(f.saved,[original]);assert.deepEqual(f.previews,[original,null]);assert.equal(f.controller.pending(),false);assert.equal(f.query('[data-scanner-device-panel]').hidden,true);assert.equal(f.created.length,0);assert.equal(f.revoked.length,0);f.controller.cancel();assert.deepEqual(f.previews,[original,null]);}finally{f.close();}
});
test('a rejected or blocked save keeps the same file available for later explicit save',async()=>{
 const f=fixture();try{await f.controller.activate();const original=f.files[0];f.canSave=false;f.query('[data-scanner-device-save]').click();await settle();assert.equal(f.saved.length,0);assert(f.controller.pending());f.canSave=true;f.accept=false;f.query('[data-scanner-device-save]').click();await settle();assert.deepEqual(f.previews,[original]);assert(f.controller.pending());f.accept=true;f.query('[data-scanner-device-save]').click();await settle();assert.deepEqual(f.saved,[original,original]);assert.deepEqual(f.previews,[original,null]);assert(!f.controller.pending());}finally{f.close();}
});
test('scanning again replaces the current inline preview and cancelling clears only that pending image',async()=>{
 const f=fixture();try{await f.controller.activate();f.query('[data-scanner-device-again]').click();await settle();assert.equal(f.files.length,2);assert.deepEqual(f.previews,[f.files[0],null,f.files[1]]);f.controller.cancel();assert.deepEqual(f.previews,[f.files[0],null,f.files[1],null]);assert.equal(f.saved.length,0);assert.equal(f.created.length,0);}finally{f.close();}
});
test('a cancelled acquisition never publishes late bytes to the external preview',async()=>{
 const f=fixture();try{await f.controller.activate({settings:true});f.hold=deferred();f.query('[data-scanner-device-start]').click();await settle();f.controller.cancel();f.hold.resolve();await settle();assert.equal(f.previews.length,0);assert.equal(f.saved.length,0);assert.equal(f.created.length,0);assert.equal(f.controller.pending(),false);}finally{f.close();}
});
test('a changed company/account cannot receive a late image or stale preview notification',async()=>{
 const f=fixture();try{await f.controller.activate({settings:true});f.hold=deferred();f.query('[data-scanner-device-start]').click();await settle();f.current=false;f.hold.resolve();await settle();assert.equal(f.previews.length,0);assert.equal(f.saved.length,0);assert.equal(f.created.length,0);}finally{f.close();}
});
test('standalone callers keep the original visible preview and owned URL cleanup',async()=>{
 const f=fixture({inlinePreview:false});try{await f.controller.activate();assert.equal(f.query('[data-scanner-device-image]').hidden,false);assert.equal(f.query('[data-scanner-device-panel]').hasAttribute('data-inline-preview'),false);assert.equal(f.query('[data-scanner-device-image]').getAttribute('src'),'blob:generated-0');assert.equal(f.created[0].blob,f.files[0]);f.controller.cancel();assert.deepEqual(f.revoked,['blob:generated-0']);assert.deepEqual(f.previews,[f.files[0],null]);}finally{f.close();}
});
