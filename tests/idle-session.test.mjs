import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/idle-session.js',import.meta.url),'utf8');
const initial=1794132000000;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

function harness({shared=new Map(),session=new Map(),body=true,minutes=30,sid='sid-1',user='actor-1',project='project-1',load,save,ready=true,channelHub=[]}={}){
 let now=initial,sequence=0;const timers=new Map(),events=[],expires=[],windowEvents=new Map(),nodes=new Map();
 class Target{
  constructor(){this.handlers=new Map();this.style={};this.hidden=false;this.dataset={};this.attributes={};this.children=[];}
  addEventListener(type,handler){const list=this.handlers.get(type)||[];list.push(handler);this.handlers.set(type,list);}
  removeEventListener(type,handler){this.handlers.set(type,(this.handlers.get(type)||[]).filter(h=>h!==handler));}
  emit(type,event={}){for(const handler of [...(this.handlers.get(type)||[])])handler({type,...event});}
  setAttribute(name,value){this.attributes[name]=value;if(name==='open')this.open=true;}
  appendChild(child){this.children.push(child);child.parent=this;if(child.id)nodes.set(child.id,child);}
  querySelector(selector){return this.parts?.get(selector)||null;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){nodes.delete(this.id);this.parent?.children.splice(this.parent.children.indexOf(this),1);}
  focus(){this.focused=true;}
  set innerHTML(_value){const button=new Target(),counter=new Target();button.id='snote-idle-continue';this.parts=new Map([['#snote-idle-continue',button],['.snote-idle-countdown',counter]]);}
 }
 const document=new Target();document.body=body?new Target():null;document.frames=[];nodes.set('snote-app',new Target());
 document.getElementById=id=>nodes.get(id)||null;
 document.querySelectorAll=selector=>selector==='iframe'?document.frames:[];
 document.createElement=()=>new Target();
 document.dispatchEvent=event=>{events.push(event);document.emit(event.type,event);};
 const storage=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
 const client={};const ctx={key:'epoch-1',project,userId:user,companyId:'company-1',username:'cld_'+user,role:'dealer',client,ready,sessionId:sid};
 const setTimer=(fn,delay,interval)=>{const id=++sequence;timers.set(id,{fn,at:now+delay,interval});return id;};
 class Channel{
  constructor(name){this.name=name;this.closed=false;channelHub.push(this);}
  postMessage(value){for(const other of [...channelHub])if(other!==this&&!other.closed&&other.name===this.name)other.onmessage?.({data:structuredClone(value)});}
  close(){this.closed=true;}
 }
 const global={console,Promise,WeakSet,Math,JSON,Number,Object,String,Array,Date:class extends Date{static now(){return now;}},currentUser:{username:ctx.username,role:ctx.role},document,localStorage:storage(shared),sessionStorage:storage(session),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  setTimeout:(fn,delay)=>setTimer(fn,delay,0),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>setTimer(fn,delay,delay),clearInterval:id=>timers.delete(id),BroadcastChannel:Channel,
  addEventListener:(type,handler)=>{const list=windowEvents.get(type)||[];list.push(handler);windowEvents.set(type,list);},
  snoteIdleSessionBridge:{context:()=>ctx,current:c=>c===ctx&&global.currentUser?.username===ctx.username,load:load||(()=>Promise.resolve({minutes,sessionId:sid})),save:save||((_c,value)=>Promise.resolve({minutes:value})),expire:(c,details)=>{expires.push({context:c,...details});}}
 };
 vm.createContext(global);vm.runInContext(source,global);
 async function advance(ms,{jump=false}={}){const end=now+ms;if(jump){now=end;return;}
  while(true){let selected=null;for(const [id,timer] of timers)if(timer.at<=end&&(!selected||timer.at<selected[1].at))selected=[id,timer];if(!selected)break;
   const [id,timer]=selected;now=timer.at;if(timer.interval)timer.at+=timer.interval;else timers.delete(id);timer.fn();await flush();
  }now=end;await flush();
 }
 return {global,document,nodes,shared,session,ctx,events,expires,timers,windowEvents,api:global.SnoteIdleSession,Target,flush,advance,now:()=>now,load:()=>global.SnoteIdleSession.load(global.currentUser),input:(type='pointerdown',trusted=true)=>document.emit(type,{isTrusted:trusted}),signal:type=>{for(const handler of windowEvents.get(type)||[])handler({type});},reevaluate:()=>vm.runInContext(source,global)};
}

test('default is 30 minutes; settings offer only supported positive durations',async()=>{
 const h=harness();await h.load();assert.equal(h.api.inspect().minutes,30);assert.equal(h.api.inspect().armed,true);
 const html=h.api.markup();for(const value of [5,10,15,30,60])assert.match(html,new RegExp('value="'+value+'"'));assert.doesNotMatch(html,/끄기|value="0"/);
 assert.equal(await h.api.save(0),false);assert.equal(await h.api.save('10'),false);
 const local=harness();local.global.currentUser={username:'demo',role:'dealer'};local.global.snoteIdleSessionBridge.context=()=>null;await local.load();assert.equal(local.api.inspect().minutes,30);assert.equal(await local.api.save(5),true);await local.advance(300001,{jump:true});local.api.tick();assert.equal(local.expires.length,0);assert.equal(local.events.filter(event=>event.type==='snote:idle-expired').length,1);
});

test('warning begins 60 seconds before expiry; actual input continues the session',async()=>{
 const h=harness({minutes:5});await h.load();await h.advance(239000);assert.equal(h.api.inspect().warning,false);
 await h.advance(1000);assert.equal(h.api.inspect().warning,true);const dialog=h.nodes.get('snote-idle-warning');assert.equal(dialog.querySelector('.snote-idle-countdown').textContent,'1:00');assert.equal(dialog.querySelector('#snote-idle-continue').focused,true);
 h.input('pointerdown');assert.equal(h.api.inspect().warning,false);assert.equal(h.api.inspect().deadline,h.now()+300000);assert.equal(h.expires.length,0);
});

test('synthetic input, focus, pageshow, visibility, afterprint and scroll cannot renew activity',async()=>{
 const h=harness({minutes:5});await h.load();const deadline=h.api.inspect().deadline;await h.advance(250000);
 for(const type of ['pointerdown','keydown','wheel','touchstart','touchmove'])h.input(type,false);
 for(const type of ['focus','pageshow','afterprint'])h.signal(type);h.document.emit('visibilitychange');h.input('scroll',true);
 assert.equal(h.api.inspect().deadline,deadline);await h.advance(50000);assert.equal(h.expires.length,1);assert.equal(h.expires[0].reason,'idle');
});

test('sleep past the deadline expires before the first trusted click can revive it',async()=>{
 const h=harness({minutes:5});await h.load();await h.advance(360000,{jump:true});h.input();h.input();h.api.tick();
 assert.equal(h.api.inspect().expired,true);assert.equal(h.expires.length,1);assert.equal(h.api.wasExpired(h.ctx.project,h.ctx.userId,'sid-1'),true);
 const record=JSON.parse(h.shared.get(h.api.storageKeys(h.ctx.project,h.ctx.userId,'sid-1').expired));assert.deepEqual(Object.keys(record).sort(),['at','project','sessionId','userId','version']);
});

test('reload preserves the original deadline and cannot clear a session tombstone',async()=>{
 const shared=new Map(),h=harness({shared,minutes:5});await h.load();const deadline=h.api.inspect().deadline;h.api.reset();
 const reloaded=harness({shared,minutes:5});await reloaded.advance(240000,{jump:true});await reloaded.load();assert.equal(reloaded.api.inspect().deadline,deadline);assert.equal(reloaded.api.inspect().warning,true);
 await reloaded.advance(60000);assert.equal(reloaded.expires.length,1);
 const third=harness({shared,minutes:5});await third.advance(300000,{jump:true});await third.load();assert.equal(third.api.inspect().expired,true);assert.equal(third.expires.length,1);
});

test('same-account tabs share real input and expire the same session once',async()=>{
 const shared=new Map(),hub=[],a=harness({shared,channelHub:hub,minutes:5}),b=harness({shared,channelHub:hub,minutes:5});await a.load();await b.load();
 await a.advance(250000,{jump:true});await b.advance(250000,{jump:true});b.input('keydown');assert.equal(a.api.inspect().lastActivity,b.now());assert.equal(a.api.inspect().warning,false);
 await a.advance(300000,{jump:true});await b.advance(300000,{jump:true});a.api.tick();assert.equal(a.expires.length,1);assert.equal(b.expires.length,1);assert.equal(b.expires[0].reason,'remote');b.api.tick();assert.equal(b.expires.length,1);
});

test('new session and another account are isolated from an old expiry',async()=>{
 const shared=new Map(),hub=[],old=harness({shared,channelHub:hub,minutes:5}),fresh=harness({shared,channelHub:hub,minutes:5,sid:'sid-new'}),other=harness({shared,channelHub:hub,minutes:5,user:'actor-2'});
 await old.load();await old.advance(301000,{jump:true});await fresh.advance(301000,{jump:true});await other.advance(301000,{jump:true});await fresh.load();await other.load();fresh.input();old.api.tick();
 assert.equal(old.api.inspect().expired,true);assert.equal(fresh.api.inspect().expired,false);assert.equal(other.api.inspect().expired,false);assert.equal(fresh.expires.length,0);assert.equal(other.expires.length,0);
});

test('continuous activity from another tab survives a long sleep; a gap does not revive an expired session',async()=>{
 const shared=new Map(),hub=[],sleeping=harness({shared,channelHub:hub,minutes:5}),active=harness({shared,channelHub:hub,minutes:5});await sleeping.load();await active.load();
 // Disable BroadcastChannel delivery to the sleeping tab, as a suspended browser does.
 for(const channel of hub)if(channel===hub[0])channel.onmessage=null;
 for(let i=0;i<3;i++){await active.advance(240000,{jump:true});active.input();}
 await sleeping.advance(720000,{jump:true});sleeping.api.tick();assert.equal(sleeping.api.inspect().expired,false);assert.equal(sleeping.api.inspect().lastActivity,active.now());
 // A fresh login after a gap starts a new activity chain and cannot revive the sleeping old session.
 await sleeping.advance(600000,{jump:true});const fresh=harness({shared,channelHub:hub,minutes:5,sid:'new-session'});await fresh.advance(1320000,{jump:true});await fresh.load();fresh.input();sleeping.api.tick();assert.equal(sleeping.api.inspect().expired,true);assert.equal(fresh.api.inspect().expired,false);
});

test('foreign and future activity records are ignored',async()=>{
 const h=harness({minutes:5});await h.load();const keys=h.api.storageKeys(h.ctx.project,h.ctx.userId,'sid-1'),deadline=h.api.inspect().deadline;
 const since=Object.fromEntries([5,10,15,30,60].map(n=>[n,initial]));h.shared.set(keys.activity,JSON.stringify({version:1,project:'foreign',userId:h.ctx.userId,at:initial+1,since}));h.api.tick();assert.equal(h.api.inspect().deadline,deadline);
 h.shared.set(keys.activity,JSON.stringify({version:1,project:h.ctx.project,userId:h.ctx.userId,at:initial+100000,since}));h.api.tick();assert.equal(h.api.inspect().deadline,deadline);
});

test('confirmed preference ACK only; save errors retain the timer and stale ACKs cannot affect a new account',async()=>{
 const pending=deferred();const h=harness({save:()=>pending.promise});await h.load();const saving=h.api.save(10);await flush();assert.equal(h.api.inspect().status,'saving');pending.resolve({minutes:15});assert.equal(await saving,false);assert.equal(h.api.inspect().minutes,30);assert.equal(h.api.inspect().status,'save-error');
 const late=deferred();h.global.snoteIdleSessionBridge.save=()=>late.promise;const second=h.api.save(10);await flush();h.api.reset();late.resolve({minutes:10});assert.equal(await second,false);assert.equal(h.api.inspect(),null);
});

test('failed preference read retains a safe 30-minute timer with verified session ID and retry; missing ID never arms',async()=>{
 const h=harness({load:()=>Promise.reject(Error('offline'))});assert.equal(await h.load(),false);assert.equal(h.api.inspect().minutes,30);assert.equal(h.api.inspect().armed,true);assert.match(h.api.markup(),/다시 시도/);
 const missing=harness({load:()=>Promise.reject(Error('offline'))});missing.ctx.sessionId=null;await missing.load();assert.equal(missing.api.inspect().armed,false);
});

test('head initialization, duplicate evaluation, delayed readiness and same-origin iframe input are safe',async()=>{
 const h=harness({body:false,ready:false,minutes:5});const listeners=h.document.handlers.get('change').length;h.reevaluate();assert.equal(h.document.handlers.get('change').length,listeners);await h.load();assert.equal(h.api.inspect().armed,false);
 h.document.body=new h.Target();h.ctx.ready=true;const frame=new h.Target();frame.contentDocument=new h.Target();h.document.frames.push(frame);h.api.tick();assert.equal(h.api.inspect().armed,true);
 await h.advance(60000);frame.contentDocument.emit('keydown',{isTrusted:true});assert.equal(h.api.inspect().lastActivity,h.now());h.api.reset();assert.equal(frame.contentDocument.handlers.get('keydown').length,0);
});
