'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/access-tracker.js'),'utf8');
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
 const timers=new Map(),events=new Map();let serial=0;
 const on=(name,fn)=>events.set(name,fn);
 const context={document:{visibilityState:'visible',addEventListener:on},navigator:{onLine:true},addEventListener:on,setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id)};
 context.window=context;vm.runInNewContext(source,context);return{context,timers,events,tracker:context.SnoteAccessTracker,run(ms){const pair=[...timers].find(([,t])=>t.ms===ms);assert(pair,'Missing timer '+ms);timers.delete(pair[0]);pair[1].fn();}};
}
test('presence records immediately and then every minute, with no client identity or IP arguments',async()=>{
 const f=fixture(),calls=[];f.tracker.start({rpc(...args){calls.push(args);return Promise.resolve({data:{ok:true}});},current:()=>true});await settle();assert.deepEqual(calls,[[]]);assert.equal([...f.timers.values()].filter(t=>t.ms===60000).length,1);f.run(60000);await settle();assert.deepEqual(calls,[[],[]]);f.tracker.stop();assert.equal(f.timers.size,0);
});
test('hidden or offline tabs wait and resume without polling weather or making duplicate calls',async()=>{
 const f=fixture();let calls=0;f.context.document.visibilityState='hidden';f.tracker.start({rpc(){calls++;return Promise.resolve();},current:()=>true});await settle();assert.equal(calls,0);f.context.document.visibilityState='visible';f.context.navigator.onLine=false;f.events.get('visibilitychange')();await settle();assert.equal(calls,0);f.context.navigator.onLine=true;f.events.get('online')();await settle();assert.equal(calls,1);f.tracker.stop();
});
test('switching accounts during an in-flight heartbeat cannot clear the new deadline or restart the old timer',async()=>{
 const f=fixture();let resolveA,resolveB,a=0,b=0;f.tracker.start({rpc(){a++;return new Promise(r=>resolveA=r);},current:()=>true});await settle();f.events.get('online')();await settle();assert.equal(a,1);f.tracker.start({rpc(){b++;return new Promise(r=>resolveB=r);},current:()=>true});await settle();assert.equal(b,1);resolveA();await settle();assert.equal([...f.timers.values()].filter(t=>t.ms===15000).length,1);assert.equal([...f.timers.values()].filter(t=>t.ms===60000).length,0);resolveB();await settle();assert.equal([...f.timers.values()].filter(t=>t.ms===60000).length,1);f.tracker.stop();
});
test('stopped or changed sessions never send another heartbeat',async()=>{
 const f=fixture();let calls=0,current=true;f.tracker.start({rpc(){calls++;return Promise.resolve();},current:()=>current});await settle();current=false;f.run(60000);await settle();assert.equal(calls,1);assert.equal(f.timers.size,0);f.events.get('online')();assert.equal(calls,1);f.tracker.start({rpc(){calls++;return Promise.resolve();},current:()=>true});await settle();f.events.get('pagehide')();assert.equal(f.timers.size,0);
});
test('network failure or a hung RPC cannot block later presence or application work',async()=>{
 const f=fixture();let calls=0;f.tracker.start({rpc(){calls++;if(calls===1)return new Promise(()=>{});throw Error('offline');},current:()=>true});await settle();f.run(15000);await settle();assert.equal([...f.timers.values()].filter(t=>t.ms===60000).length,1);f.run(60000);await settle();assert.equal(calls,2);assert.equal([...f.timers.values()].filter(t=>t.ms===60000).length,1);f.tracker.stop();
});
