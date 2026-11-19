import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

// Execute the actual client with synthetic identity, DOM, clock and responses.
// No browser, authentication service, provider or customer data is accessed.
const source=fs.readFileSync(new URL('../assets/encar-id.js',import.meta.url),'utf8');
const PLATE='12가3456',TOKEN='synthetic.token.value';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture({token=()=>Promise.resolve(TOKEN),fetchResponse}={}){
 const elements=[],timers=new Map(),context={plate:PLATE};let nextTimer=0;
 function element(tag){
  const listeners=new Map();
  const node={tag,attributes:new Map(),dataset:{},children:[],open:false,hidden:false,value:'',textContent:'',disabled:false,
   append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);},
   addEventListener(event,handler){listeners.set(event,handler);},showModal(){this.open=true;},close(){this.open=false;},focus(){},
   click(){listeners.get('click')?.({preventDefault(){},stopPropagation(){}});}};
  elements.push(node);return node;
 }
 const button=element('button');button.dataset.encarIdCar='synthetic-car';
 const state={requests:[],responses:[],context};
 const sandbox={AbortController,Uint8Array,TextDecoder,Error,Set,Promise,
  document:{createElement:element,body:{append(){}},querySelectorAll(){return[button];},getElementById(){return null;}},
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(){},
  fetch(...args){state.requests.push(args);return fetchResponse?fetchResponse(...args):Promise.resolve(state.responses.shift()??success());},
  window:{snoteEncarIdBridge:{context(carId){return carId==='synthetic-car'?context:null;},current(value){return value===context;},accessToken:token}}};
 vm.runInNewContext(source,sandbox,{filename:'assets/encar-id.js'});
 const dialog=elements.find(e=>e.tag==='dialog'),status=elements.find(e=>e.tag==='p'),output=elements.find(e=>e.tag==='output');
 return{...state,button,dialog,status,output,api:sandbox.window.SnoteEncarId,
  deadline(){const timer=[...timers.values()].find(t=>t.ms===55000);assert(timer,'The active client deadline must exist');timer.fn();},
  start(){return sandbox.window.SnoteEncarId.lookup('synthetic-car');}};
}
function success(id='43123456'){
 return new Response(JSON.stringify({ok:true,status:'found',plate:PLATE,id,provider:'carnect'}),{headers:{'Content-Type':'application/json'}});
}
async function settled(promise){
 const pending=Symbol('pending');const value=await Promise.race([promise,setImmediate(pending)]);
 assert.notEqual(value,pending,'A cancelled lookup must settle without waiting for an uncooperative dependency');return value;
}
async function flush(){await setImmediate();}
function heldBody(){
 const read=deferred(),cancel=deferred(),state={reads:0,cancels:0,releases:0};
 const response={ok:true,headers:new Headers({'Content-Type':'application/json'}),body:{getReader(){return{
  read(){state.reads++;return read.promise;},cancel(){state.cancels++;return cancel.promise;},releaseLock(){state.releases++;}};}}};
 return{response,read,cancel,state};
}

test('the lookup deadline also bounds a pending session token and ignores its late value',async()=>{
 const token=deferred(),f=fixture({token:()=>token.promise}),lookup=f.start();await flush();
 assert.equal(f.button.disabled,true);f.deadline();assert.equal(await settled(lookup),false);
 assert.equal(f.dialog.open,true);assert.equal(f.dialog.attributes.has('aria-busy'),false);
 assert.match(f.status.textContent,/시간이 초과/);assert.equal(f.requests.length,0);assert.equal(f.output.hidden,true);
 token.resolve(TOKEN);await flush();assert.equal(f.requests.length,0,'A late token cannot start a request');
 f.api.reset();assert.equal(f.button.disabled,false);
});

test('closing during token acquisition settles immediately and allows a fresh lookup',async()=>{
 const oldToken=deferred();let tokens=0;const f=fixture({token:()=>++tokens===1?oldToken.promise:Promise.resolve(TOKEN)}),old=f.start();await flush();
 f.api.reset();assert.equal(await settled(old),false);assert.equal(f.dialog.open,false);assert.equal(f.button.disabled,false);
 const fresh=f.start();assert.equal(await settled(fresh),true);assert.equal(f.output.value,'43123456');
 oldToken.resolve(TOKEN);await flush();assert.equal(f.requests.length,1);assert.equal(f.output.value,'43123456');f.api.reset();
});

test('an uncooperative fetch cannot retain the busy dialog after its deadline or display a late result',async()=>{
 const response=deferred(),f=fixture({fetchResponse:()=>response.promise}),lookup=f.start();await flush();
 assert.equal(f.requests.length,1);f.deadline();assert.equal(await settled(lookup),false);
 assert.equal(f.dialog.attributes.has('aria-busy'),false);assert.match(f.status.textContent,/시간이 초과/);
 response.resolve(success());await flush();assert.equal(f.output.hidden,true);assert.equal(f.output.value,'');f.api.reset();
});

test('deadline cancels a pending body read without awaiting an uncooperative reader cancellation',async()=>{
 const body=heldBody(),f=fixture({fetchResponse:()=>Promise.resolve(body.response)}),lookup=f.start();await flush();
 assert.equal(body.state.reads,1);f.deadline();assert.equal(await settled(lookup),false);
 assert.equal(body.state.cancels,1);assert.equal(body.state.releases,1);assert.equal(f.dialog.attributes.has('aria-busy'),false);assert.match(f.status.textContent,/시간이 초과/);
 body.read.resolve({done:false,value:new TextEncoder().encode(JSON.stringify({ok:true,status:'found',plate:PLATE,id:'43999999',provider:'trust'}))});await flush();
 assert.equal(f.output.hidden,true);assert.equal(f.output.value,'');body.cancel.resolve();f.api.reset();
});

test('closing a pending body read cannot hang or overwrite a subsequent successful popup',async()=>{
 const body=heldBody();let requests=0;const f=fixture({fetchResponse:()=>Promise.resolve(++requests===1?body.response:success('43123457'))}),old=f.start();await flush();
 f.api.reset();assert.equal(await settled(old),false);assert.equal(f.dialog.open,false);assert.equal(body.state.cancels,1);
 assert.equal(await settled(f.start()),true);assert.equal(f.output.value,'43123457');
 body.read.resolve({done:false,value:new TextEncoder().encode(JSON.stringify({ok:true,status:'found',plate:PLATE,id:'43999999',provider:'trust'}))});await flush();
 assert.equal(f.output.value,'43123457');assert.equal(f.dialog.open,true);assert.equal(f.requests.length,2);body.cancel.resolve();f.api.reset();
});
