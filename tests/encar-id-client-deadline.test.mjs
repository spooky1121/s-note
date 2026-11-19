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
function fixture({token=()=>Promise.resolve(TOKEN),fetchResponse,popupBlocked=false}={}){
 const elements=[],timers=new Map(),context={plate:PLATE};let nextTimer=0;
 function element(tag){
  const listeners=new Map();
  const node={tag,attributes:new Map(),dataset:{},children:[],open:false,hidden:false,value:'',textContent:'',disabled:false,
   append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);if(key==='href')delete this.href;},
   addEventListener(event,handler){listeners.set(event,handler);},showModal(){this.open=true;},close(){this.open=false;},focus(){},
   click(){listeners.get('click')?.({preventDefault(){},stopPropagation(){}});}};
  elements.push(node);return node;
 }
 const button=element('button');button.dataset.encarIdCar='synthetic-car';
 const state={requests:[],responses:[],context,popups:[],navigations:[],opens:[]};
 function open(...args){
  state.opens.push(args);if(popupBlocked)return null;
  const attributes=new Map(),popup={closed:false,opener:'owner',document:{documentElement:{setAttribute(key,value){attributes.set(key,value);},getAttribute(key){return attributes.get(key);}},body:{textContent:''}},close(){this.closed=true;}};
  popup.location={href:'about:blank',replace(url){state.navigations.push(url);this.href=url;}};state.popups.push(popup);return popup;
 }
 const sandbox={AbortController,Uint8Array,TextDecoder,Error,Set,Promise,
  document:{createElement:element,body:{append(){}},querySelectorAll(){return[button];},getElementById(){return null;}},
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(){},
  fetch(...args){state.requests.push(args);return fetchResponse?fetchResponse(...args):Promise.resolve(state.responses.shift()??success());},
  window:{open,snoteEncarIdBridge:{context(carId){return carId==='synthetic-car'?context:null;},current(value){return value===context;},accessToken:token}}};
 vm.runInNewContext(source,sandbox,{filename:'assets/encar-id.js'});
 const dialog=elements.find(e=>e.tag==='dialog'),status=elements.find(e=>e.tag==='p'),link=elements.find(e=>e.tag==='a'),loading=elements.find(e=>e.className==='snote-encar-id-loading');
 return{...state,button,dialog,status,link,loading,api:sandbox.window.SnoteEncarId,
  deadline(){const timer=[...timers.values()].find(t=>t.ms===55000);assert(timer,'The active client deadline must exist');timer.fn();},
  start(){return sandbox.window.SnoteEncarId.lookup('synthetic-car');}};
}
function success(id='43123456'){
 return new Response(JSON.stringify({ok:true,status:'found',plate:PLATE,id,provider:'gloar'}),{headers:{'Content-Type':'application/json'}});
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
 assert.equal(f.loading.hidden,true,'A timed-out search must stop its loading decoration');
 assert.match(f.status.textContent,/시간이 초과/);assert.equal(f.requests.length,0);assert.equal(f.link.hidden,true);
 token.resolve(TOKEN);await flush();assert.equal(f.requests.length,0,'A late token cannot start a request');
 f.api.reset();assert.equal(f.button.disabled,false);
});

test('closing during token acquisition settles immediately and allows a fresh lookup',async()=>{
 const oldToken=deferred();let tokens=0;const f=fixture({token:()=>++tokens===1?oldToken.promise:Promise.resolve(TOKEN)}),old=f.start();await flush();
 assert.equal(f.loading.hidden,false);f.api.reset();assert.equal(await settled(old),false);assert.equal(f.dialog.open,false);assert.equal(f.button.disabled,false);assert.equal(f.loading.hidden,true);
 const fresh=f.start();assert.equal(await settled(fresh),true);assert.deepEqual(f.navigations,['https://fem.encar.com/cars/detail/43123456']);assert.equal(f.dialog.open,false);
 oldToken.resolve(TOKEN);await flush();assert.equal(f.requests.length,1);assert.deepEqual(f.navigations,['https://fem.encar.com/cars/detail/43123456']);assert.equal(f.dialog.open,false);f.api.reset();
});

test('an uncooperative fetch cannot retain the busy dialog after its deadline or display a late result',async()=>{
 const response=deferred(),f=fixture({fetchResponse:()=>response.promise}),lookup=f.start();await flush();
 assert.equal(f.requests.length,1);f.deadline();assert.equal(await settled(lookup),false);
 assert.equal(f.dialog.attributes.has('aria-busy'),false);assert.match(f.status.textContent,/시간이 초과/);
 response.resolve(success());await flush();assert.equal(f.link.hidden,true);assert.equal(f.navigations.length,0);assert.equal(f.popups[0].closed,true);f.api.reset();
});

test('deadline cancels a pending body read without awaiting an uncooperative reader cancellation',async()=>{
 const body=heldBody(),f=fixture({fetchResponse:()=>Promise.resolve(body.response)}),lookup=f.start();await flush();
 assert.equal(body.state.reads,1);f.deadline();assert.equal(await settled(lookup),false);
 assert.equal(body.state.cancels,1);assert.equal(body.state.releases,1);assert.equal(f.dialog.attributes.has('aria-busy'),false);assert.match(f.status.textContent,/시간이 초과/);
 body.read.resolve({done:false,value:new TextEncoder().encode(JSON.stringify({ok:true,status:'found',plate:PLATE,id:'43999999',provider:'trust'}))});await flush();
 assert.equal(f.link.hidden,true);assert.equal(f.navigations.length,0);assert.equal(f.popups[0].closed,true);body.cancel.resolve();f.api.reset();
});

test('closing a pending body read cannot hang or overwrite a subsequent advertisement tab',async()=>{
 const body=heldBody();let requests=0;const f=fixture({fetchResponse:()=>Promise.resolve(++requests===1?body.response:success('43123457'))}),old=f.start();await flush();
 f.api.reset();assert.equal(await settled(old),false);assert.equal(f.dialog.open,false);assert.equal(body.state.cancels,1);
 assert.equal(await settled(f.start()),true);assert.deepEqual(f.navigations,['https://fem.encar.com/cars/detail/43123457']);
 body.read.resolve({done:false,value:new TextEncoder().encode(JSON.stringify({ok:true,status:'found',plate:PLATE,id:'43999999',provider:'trust'}))});await flush();
 assert.deepEqual(f.navigations,['https://fem.encar.com/cars/detail/43123457']);assert.equal(f.dialog.open,false);assert.equal(f.requests.length,2);body.cancel.resolve();f.api.reset();
});

test('search animation is decorative and runs only while a real lookup is pending',async()=>{
 for(const outcome of['found','limited']){
  const response=deferred(),f=fixture({fetchResponse:()=>response.promise});assert.equal(f.loading.hidden,true);assert.equal(f.loading.attributes.get('aria-hidden'),'true');
  const lookup=f.start();await flush();assert.equal(f.loading.hidden,false);assert.equal(f.dialog.attributes.get('aria-busy'),'true');assert.equal(f.link.hidden,true);
  response.resolve(outcome==='found'?success():new Response(JSON.stringify({ok:false,code:'UPSTREAM_RATE_LIMITED'}),{status:429,headers:{'Content-Type':'application/json'}}));
  assert.equal(await settled(lookup),outcome==='found');assert.equal(f.loading.hidden,true);assert.equal(f.dialog.attributes.has('aria-busy'),false);
  if(outcome==='found'){assert.deepEqual(f.navigations,['https://fem.encar.com/cars/detail/43123456']);assert.equal(f.dialog.open,false);assert.equal(f.status.textContent,'');}else{assert.equal(f.link.hidden,true);assert.match(f.status.textContent,/검색 브라우저의 실행 요청/);}
  f.api.reset();assert.equal(f.loading.hidden,true);
 }
});

test('a tab is reserved before awaiting the token, detached from its opener and navigated only after proof',async()=>{
 const token=deferred(),f=fixture({token:()=>token.promise}),lookup=f.start();
 assert.deepEqual(f.opens,[['about:blank','_blank']]);assert.equal(f.popups[0].opener,null);assert.equal(f.navigations.length,0);
 token.resolve(TOKEN);assert.equal(await settled(lookup),true);
 assert.deepEqual(f.navigations,['https://fem.encar.com/cars/detail/43123456']);assert.equal(f.popups[0].closed,false);assert.equal(f.dialog.open,false);assert.equal(f.link.hidden,true);assert.equal(f.button.disabled,false);
});

test('a blocked popup uses a user-clickable fixed Encar link without displaying the ID or retrying window.open',async()=>{
 const f=fixture({popupBlocked:true});assert.equal(await settled(f.start()),true);
 assert.equal(f.opens.length,1);assert.equal(f.popups.length,0);assert.equal(f.navigations.length,0);assert.equal(f.dialog.open,true);
 assert.equal(f.link.hidden,false);assert.equal(f.link.textContent,'엔카 광고 열기');assert.equal(f.link.href,'https://fem.encar.com/cars/detail/43123456');assert.equal(f.link.target,'_blank');assert.equal(f.link.rel,'noopener noreferrer');assert(!f.status.textContent.includes('43123456'));
 f.api.reset();assert.equal(f.link.hidden,true);assert.equal(f.link.href,undefined);
});

test('a manually closed waiting tab is not reopened automatically and receives the same verified fallback',async()=>{
 const response=deferred(),f=fixture({fetchResponse:()=>response.promise}),lookup=f.start();await flush();f.popups[0].close();response.resolve(success());assert.equal(await settled(lookup),true);
 assert.equal(f.opens.length,1);assert.equal(f.navigations.length,0);assert.equal(f.link.hidden,false);assert.equal(f.link.href,'https://fem.encar.com/cars/detail/43123456');f.api.reset();
});

test('a waiting tab that the user navigates elsewhere is never overwritten or closed by completion or reset',async()=>{
 for(const found of [true,false]){
  const response=deferred(),f=fixture({fetchResponse:()=>response.promise}),lookup=f.start();await flush();f.popups[0].location.href='https://different.invalid/user-page';
  response.resolve(found?success():new Response(JSON.stringify({ok:false,code:'NOT_FOUND'}),{headers:{'Content-Type':'application/json'}}));assert.equal(await settled(lookup),found);
  assert.equal(f.popups[0].closed,false);assert.equal(f.navigations.length,0);f.api.reset();assert.equal(f.popups[0].closed,false);assert.equal(f.popups[0].location.href,'https://different.invalid/user-page');
 }
});

test('unverified IDs, providers and plate responses close the waiting tab without creating an advertisement link',async()=>{
 for(const changed of [{id:'160f5ea0-def9-4473-b2b5-457e5269cfb8'},{id:'https://foreign.invalid/'},{plate:'12나3456'},{provider:'trust'}]){
  const f=fixture({fetchResponse:()=>Promise.resolve(new Response(JSON.stringify({ok:true,status:'found',plate:PLATE,id:'43123456',provider:'gloar',...changed}),{headers:{'Content-Type':'application/json'}}))});
  assert.equal(await settled(f.start()),false);assert.equal(f.popups[0].closed,true);assert.equal(f.navigations.length,0);assert.equal(f.link.hidden,true);assert.equal(f.link.href,undefined);f.api.reset();
 }
});
