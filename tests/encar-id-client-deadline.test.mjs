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
   append(...children){this.children.push(...children);},setAttribute(key,value){this.attributes.set(key,value);},getAttribute(key){return this.attributes.get(key)??null;},removeAttribute(key){this.attributes.delete(key);},remove(){},
   addEventListener(event,handler){listeners.set(event,handler);},showModal(){this.open=true;},close(){this.open=false;},focus(){},
   click(){listeners.get('click')?.({preventDefault(){},stopPropagation(){}});}};
  elements.push(node);return node;
 }
 const button=element('button');button.dataset.encarIdCar='synthetic-car';
 const state={requests:[],responses:[],context};let savedRecord=null;
 const sandbox={AbortController,Uint8Array,TextDecoder,Error,Set,Promise,queueMicrotask,
  document:{createElement:element,body:{append(){}},querySelectorAll(){return[button];},getElementById(){return null;},addEventListener(){}},
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(){},
  fetch(...args){state.requests.push(args);return fetchResponse?fetchResponse(...args):Promise.resolve(state.responses.shift()??success());},
  window:{addEventListener(){},snoteEncarIdBridge:{context(carId){return carId==='synthetic-car'?context:null;},current(value){return value===context;},accessToken:token,
   saved(){const popup=elements.find(e=>e.tag==='dialog'),output=elements.find(e=>e.tag==='output');return popup?.open&&!output?.hidden&&output?.value===savedRecord?.id?savedRecord:null;},
   async saveLink(base,value){savedRecord={version:2,plate:base.plate,id:value.id,url:'https://fem.encar.com/cars/detail/'+value.id+'?listAdvType=share&adnm=mo_detail_url',verifiedAt:new Date().toISOString(),priceWon:null,priceCheckedAt:null,priceSource:null};return{record:savedRecord,saved:true};}
  }}};
 vm.runInNewContext(source,sandbox,{filename:'assets/encar-id.js'});
 const dialog=elements.find(e=>e.tag==='dialog'),status=elements.find(e=>e.tag==='p'),output=elements.find(e=>e.tag==='output'),loading=elements.find(e=>e.className==='snote-encar-id-loading');
 return{...state,button,dialog,status,output,loading,diagnostics:elements.find(e=>Object.hasOwn(e.dataset,'encarErrorDetails')),diagnostic(field){return elements.find(e=>e.attributes.has('data-encar-error-'+field)).textContent;},api:sandbox.window.SnoteEncarId,
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
 assert.match(f.status.textContent,/시간이 초과/);assert.equal(f.requests.length,0);assert.equal(f.output.hidden,true);
 token.resolve(TOKEN);await flush();assert.equal(f.requests.length,0,'A late token cannot start a request');
 f.api.reset();assert.equal(f.button.disabled,false);
});

test('closing during token acquisition settles immediately and allows a fresh lookup',async()=>{
 const oldToken=deferred();let tokens=0;const f=fixture({token:()=>++tokens===1?oldToken.promise:Promise.resolve(TOKEN)}),old=f.start();await flush();
 assert.equal(f.loading.hidden,false);f.api.reset();assert.equal(await settled(old),false);assert.equal(f.dialog.open,false);assert.equal(f.button.disabled,false);assert.equal(f.loading.hidden,true);
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

test('search animation is decorative and runs only while a real lookup is pending',async()=>{
 for(const outcome of['found','limited','daily']){
  const response=deferred(),f=fixture({fetchResponse:()=>response.promise});assert.equal(f.loading.hidden,true);assert.equal(f.loading.attributes.get('aria-hidden'),'true');
  const lookup=f.start();await flush();assert.equal(f.loading.hidden,false);assert.equal(f.dialog.attributes.get('aria-busy'),'true');assert.equal(f.output.hidden,true);
  response.resolve(outcome==='found'?success():new Response(JSON.stringify({ok:false,code:outcome==='daily'?'BROWSER_DAILY_LIMIT':'UPSTREAM_RATE_LIMITED'}),{status:429,headers:{'Content-Type':'application/json'}}));
  assert.equal(await settled(lookup),outcome==='found');assert.equal(f.loading.hidden,true);assert.equal(f.dialog.attributes.has('aria-busy'),false);
  if(outcome==='found'){assert.equal(f.output.value,'43123456');assert.equal(f.status.textContent,'');}else{assert.equal(f.output.hidden,true);assert.equal(f.status.textContent,outcome==='daily'?'Cloudflare 검색 브라우저의 하루 사용 한도에 도달했습니다. Cloudflare 사용량·요금제를 확인해 주세요.':'Cloudflare 검색 브라우저가 요청을 제한했습니다. Cloudflare 사용량·요금제를 확인해 주세요.');}
  f.api.reset();assert.equal(f.loading.hidden,true);
 }
});

test('diagnostics distinguish the observed GLOAR, Cloudflare and S-NOTE stages without claiming a site outage',async()=>{
 for(const [code,http,origin,observed] of [['GLOAR_INPUT_UNCONFIRMED',502,'GLOAR 검색 화면',false],['BROWSER_UNAVAILABLE',502,'Cloudflare 연결 구간',false],['UPSTREAM_RATE_LIMITED',429,'Cloudflare 연결 구간',true],['BROWSER_DAILY_LIMIT',429,'Cloudflare 연결 구간',true],['AUTH_UNAVAILABLE',502,'S-NOTE 서버·인증',false]]){
  const f=fixture({fetchResponse:()=>Promise.resolve(new Response(JSON.stringify({ok:false,code,error:'PRIVATE_PROVIDER_TOKEN_AND_BODY'}),{status:http,headers:{'Content-Type':'application/json'}}))});
  assert.equal(await settled(f.start()),false);assert.equal(f.diagnostics.hidden,false);assert.equal(f.diagnostic('source'),'오류 구간: '+origin);assert.equal(f.diagnostic('code'),'오류 코드: '+code);assert.equal(f.diagnostic('http'),'S-NOTE 응답: HTTP '+http);
  assert.equal(f.diagnostic('note'),observed?'해당 처리 결과를 확인했습니다.':'해당 구간에서 중단됐으며, 서버 장애 여부는 확인되지 않았습니다.');
  if(code==='GLOAR_INPUT_UNCONFIRMED'){assert.equal(f.status.textContent,'서버에 오류가 있습니다. 잠시후 다시 시도해주세요.');assert.match(f.diagnostic('stage'),/입력값 확인/);}
  assert(!Object.values(f.diagnostics.children).some(e=>e.textContent.includes('PRIVATE')));f.api.reset();assert.equal(f.diagnostics.hidden,true);assert.equal(f.diagnostic('code'),'');
 }
});

test('network, unreadable and unknown failures remain unconfirmed and never echo provider diagnostics or raw bodies',async()=>{
 for(const [fetchResponse,code,http] of [[()=>{throw new TypeError('PRIVATE_NETWORK_TOKEN');},'NETWORK_ERROR','HTTP 응답 없음'],[()=>Promise.resolve(new Response('PRIVATE_BODY',{status:503,headers:{'Content-Type':'application/json'}})),'RESPONSE_UNREADABLE','HTTP 503'],[()=>Promise.resolve(new Response(JSON.stringify({ok:false,code:'PRIVATE_VENDOR_CODE',error:'PRIVATE_VENDOR_BODY',diagnostics:{source:'gloar',detail:'PRIVATE_DETAIL'}}),{status:502,headers:{'Content-Type':'application/json'}})),'UNKNOWN_ERROR','HTTP 502']]){
  const f=fixture({fetchResponse});assert.equal(await settled(f.start()),false);assert.equal(f.diagnostic('source'),'오류 구간: 확인되지 않음');assert.equal(f.diagnostic('code'),'오류 코드: '+code);assert.equal(f.diagnostic('http'),'S-NOTE 응답: '+http);assert(![f.status.textContent,...f.diagnostics.children.map(e=>e.textContent)].join(' ').includes('PRIVATE'));f.api.reset();
 }
});

test('diagnostics are cleared for a fresh lookup, normal absence, success and reset',async()=>{
 const response=deferred();let calls=0;const f=fixture({fetchResponse:()=>++calls===1?Promise.resolve(new Response('{"ok":false,"code":"GLOAR_INPUT_UNCONFIRMED"}',{status:502,headers:{'Content-Type':'application/json'}})):response.promise});
 await settled(f.start());assert.equal(f.diagnostics.hidden,false);f.api.reset();const fresh=f.start();await flush();assert.equal(f.diagnostics.hidden,true);assert.equal(f.diagnostic('stage'),'');response.resolve(success());assert.equal(await settled(fresh),true);assert.equal(f.diagnostics.hidden,true);assert.equal(f.diagnostic('source'),'');f.api.reset();
 const empty=fixture({fetchResponse:()=>Promise.resolve(new Response('{"ok":false,"code":"NOT_FOUND"}',{headers:{'Content-Type':'application/json'}}))});assert.equal(await settled(empty.start()),false);assert.equal(empty.diagnostics.hidden,true);empty.api.reset();
});
