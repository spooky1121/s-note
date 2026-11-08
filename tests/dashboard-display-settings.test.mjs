import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/dashboard-display-settings.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness(){
 const storage=new Map(),handlers={},events=[],timers=new Map();let serial=0,reads=0,writes=0;
 const g={console,Promise,currentUser:null,document:{getElementById(){return null;},addEventListener(type,handler){(handlers[type]??=[]).push(handler);},dispatchEvent(event){events.push(event);}},CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},localStorage:{getItem(key){reads++;return storage.get(key)??null;},setItem(key,value){writes++;storage.set(key,String(value));}},zc86Cloud:{ready:false}};
 vm.runInNewContext(source,g);const api=g.SnoteDashboardDisplay,key=username=>'snote-dashboard-display:v1:'+encodeURIComponent(username);
 async function load(account){g.currentUser=account;return api.load(account);}
 async function change(checked){for(const handler of handlers.change||[])handler({target:{id:'snote-dashboard-margin-toggle',checked}});await flush();}
 async function retry(){for(const handler of handlers.click||[])handler({target:{closest:selector=>selector==='#snote-dashboard-margin-retry'?{}:null}});await flush();}
 function clock(ms){for(const[id,timer]of [...timers])if(timer.delay<=ms){timers.delete(id);timer.fn();}}
 function cloud(account={username:'cld_dealer',role:'dealer'},options={}){g.currentUser=account;g.zc86Cloud.ready=true;const auth={key:'company-A:'+account.username,companyId:'company-A',userId:'user-A',username:account.username,role:account.role,client:{}};let loads=0,saves=[];const b={context:()=>({...auth}),current:ctx=>ctx.key===auth.key&&ctx.username===g.currentUser?.username&&ctx.role===g.currentUser?.role,load:async()=>{loads++;return{hidden:false};},save:async(ctx,hidden)=>{saves.push({ctx,hidden});return{hidden};},...options};g.snoteDashboardDisplayBridge=b;return{account,auth,bridge:b,get loads(){return loads;},saves};}
 return{g,api,handlers,events,storage,key,load,change,retry,clock,cloud,get reads(){return reads;},get writes(){return writes;}};
}

test('head initialization is immediate, safely hidden before a confirmed read and registers handlers once',()=>{
 const h=harness();assert.equal(h.api.hidden(),true);assert.equal(h.api.markup(),'');assert.equal(typeof h.api.render,'function');vm.runInNewContext(source,h.g);assert.equal(h.handlers.change.length,1);assert.equal(h.handlers.click.length,1);
});

test('a new local preference defaults OFF, survives reload per account and emits no finance-lock event',async()=>{
 const h=harness();await h.load({username:'demo-A',role:'dealer'});assert.equal(h.api.hidden(),false);assert.match(h.api.markup(),/대시보드 마진 숨기기/);assert.match(h.api.markup(),/role="switch"/);await h.change(true);assert.equal(h.api.hidden(),true);assert.deepEqual(JSON.parse(h.storage.get(h.key('demo-A'))),{schemaVersion:1,hidden:true});
 const restored=harness();restored.storage.set(restored.key('demo-A'),h.storage.get(h.key('demo-A')));await restored.load({username:'demo-A',role:'dealer'});assert.equal(restored.api.hidden(),true);await restored.load({username:'demo-B',role:'admin'});assert.equal(restored.api.hidden(),false);assert(h.events.every(event=>event.type==='snote:dashboard-display-changed'));assert(h.events.some(event=>event.detail.source==='save'));
});

test('unsupported roles have no switch and corrupt local settings cannot expose margins',async()=>{
 const h=harness();await h.load({username:'office',role:'accountant'});assert.equal(h.api.hidden(),true);assert.equal(h.api.markup(),'');
 for(const raw of ['{broken','{"schemaVersion":1,"hidden":"false"}','{"schemaVersion":2,"hidden":false}']){h.storage.set(h.key('demo-A'),raw);await h.load({username:'demo-A',role:'admin'});assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/data-state="load-error"/);assert.match(h.api.markup(),/role="switch"[^>]*disabled/);}
});

test('cloud preferences never use a local shadow and invalid or missing authentication fails hidden',async()=>{
 const h=harness(),c=h.cloud();h.storage.set(h.key(c.account.username),JSON.stringify({schemaVersion:1,hidden:true}));await h.api.load(c.account);assert.equal(h.api.hidden(),false);assert.equal(h.reads,0);assert.equal(h.writes,0);
 h.g.snoteDashboardDisplayBridge=null;await h.api.load(c.account);assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/load-error/);assert.equal(h.reads,0);
 const malformed=h.cloud(c.account,{load:async()=>({hidden:'false'})});await h.api.load(malformed.account);assert.equal(h.api.hidden(),true);assert.equal(h.reads,0);
});

test('showing margins waits for the confirmed ACK, disables concurrent changes and writes only the desired bool',async()=>{
 const h=harness(),pending=deferred();let writes=0;const c=h.cloud(undefined,{load:async()=>({hidden:true}),save:async(ctx,desired)=>{writes++;assert.equal(desired,false);assert.equal(ctx.userId,'user-A');return pending.promise;}});await h.api.load(c.account);await h.change(false);await h.change(false);assert.equal(writes,1);assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/data-state="saving"/);assert.match(h.api.markup(),/role="switch"[^>]*checked[^>]*disabled/);
 pending.resolve({hidden:false});await flush();assert.equal(h.api.hidden(),false);assert.match(h.api.markup(),/저장 완료/);assert.equal(h.events.filter(event=>event.detail.source==='save').length,1);
});

test('a rejected or mismatched save keeps confirmed hiding and retry rereads the server instead of replaying a write',async()=>{
 for(const result of [new Error('offline'),{hidden:true},{hidden:'false'}]){
  const h=harness();let loads=0,writes=0;const c=h.cloud(undefined,{load:async()=>({hidden:++loads===1}),save:async()=>{writes++;if(result instanceof Error)throw result;return result;}});await h.api.load(c.account);await h.change(false);assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/save-error/);await h.retry();assert.equal(h.api.hidden(),false);assert.equal(writes,1);assert.equal(loads,2);
 }
});

test('timeouts ignore late load and save results instead of revealing an unconfirmed value',async()=>{
 {
  const h=harness(),pending=deferred(),c=h.cloud(undefined,{load:()=>pending.promise});const loading=h.api.load(c.account);await flush();h.clock(15000);await loading;assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/load-error/);pending.resolve({hidden:false});await flush();assert.equal(h.api.hidden(),true);
 }
 {
  const h=harness(),pending=deferred(),c=h.cloud(undefined,{load:async()=>({hidden:true}),save:()=>pending.promise});await h.api.load(c.account);await h.change(false);h.clock(15000);await flush();assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/save-error/);pending.resolve({hidden:false});await flush();assert.equal(h.api.hidden(),true);
 }
});

test('account, company, role and client changes invalidate the previous preference and late responses',async()=>{
 for(const field of ['companyId','role','client']){
  const h=harness(),c=h.cloud(undefined,{current:()=>true});await h.api.load(c.account);assert.equal(h.api.hidden(),false);c.auth[field]=field==='client'?{}:field==='role'?'admin':'company-B';assert.equal(h.api.hidden(),true);assert.match(h.api.markup(),/role="switch"[^>]*disabled/);
 }
 const h=harness(),pending=deferred(),c=h.cloud({username:'cld_A',role:'dealer'},{load:async ctx=>ctx.username==='cld_A'?pending.promise:{hidden:true}});const old=h.api.load(c.account);await flush();const next={username:'cld_B',role:'dealer'};h.g.currentUser=next;Object.assign(c.auth,{key:'company-B:cld_B',companyId:'company-B',userId:'user-B',username:next.username});await h.api.load(next);pending.resolve({hidden:false});await old;assert.equal(h.api.hidden(),true);
});

test('reset clears old settings and a late save; rendering alone never rereads account metadata',async()=>{
 const h=harness(),pending=deferred(),c=h.cloud(undefined,{save:()=>pending.promise});await h.api.load(c.account);const loads=c.loads;h.api.render();h.api.markup();h.api.render();assert.equal(c.loads,loads);await h.change(true);h.api.reset();assert.equal(h.api.hidden(),true);assert.equal(h.api.markup(),'');pending.resolve({hidden:true});await flush();assert.equal(h.events.filter(event=>event.detail.source==='save').length,0);assert.equal(h.events.at(-1).detail.source,'reset');
});
