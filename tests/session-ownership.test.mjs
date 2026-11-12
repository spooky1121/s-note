import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/session-ownership.js',import.meta.url),'utf8');
const USER='11111111-1111-4111-8111-111111111111',OTHER_USER='22222222-2222-4222-8222-222222222222';
const SID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER_SID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
function session(userId=USER,sessionId=SID,extra={}){
 const body={sub:userId,session_id:sessionId,...extra};
 return{user:{id:userId},access_token:'header.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.signature'};
}
const ack=(active=true,generation=1,userId=USER,sessionId=SID,reason=active?'ACTIVE':'REPLACED')=>({data:{ok:true,active,userId,sessionId,generation,reason},error:null});
const confirmation=(generation=1,userId=USER,sessionId=SID)=>({data:{ok:true,active:false,userId,sessionId,generation,reason:'CONFIRMATION_REQUIRED',requiresConfirmation:true},error:null});

function harness(options={}){
 let now=100000,nextTimer=0,currentSession=options.session||session(),rpc=options.rpc,getSession=options.getSession;
 const timers=new Map(),calls=[],authCalls=[],authTokens=[],channels=[],removed=[],notices=[];
 class Target{
  constructor(){this.events=new Map();}
  addEventListener(name,handler){const list=this.events.get(name)||[];list.push(handler);this.events.set(name,list);}
  removeEventListener(name,handler){this.events.set(name,(this.events.get(name)||[]).filter(value=>value!==handler));}
  emit(name){for(const handler of [...(this.events.get(name)||[])])handler({type:name});}
 }
 const windowEvents=new Target(),document=new Target();document.visibilityState='visible';
 const timer=(fn,delay,interval=0)=>{const id=++nextTimer;timers.set(id,{fn,at:now+delay,interval});return id;};
 const client={
  auth:{getSession(){authCalls.push(now);return getSession?getSession():Promise.resolve({data:{session:currentSession},error:null});}},
  rpc(...args){calls.push(args);return rpc?rpc(...args):Promise.resolve(ack(true,1,currentSession.user.id,JSON.parse(Buffer.from(currentSession.access_token.split('.')[1],'base64url')).session_id));},
  realtime:{setAuth(token){authTokens.push(token);return Promise.resolve();}},
  channel(name){
   const channel={name,on(type,filter,handler){this.type=type;this.filter=filter;this.handler=handler;return this;},subscribe(handler){this.status=handler;return this;},emit(row){this.handler({new:row});}};
   channels.push(channel);return channel;
  },
  removeChannel(channel){removed.push(channel);return Promise.resolve();}
 };
 const global={console,document,navigator:{onLine:true},Promise,atob:globalThis.atob,Date:class extends Date{static now(){return now;}},
  setTimeout:(fn,delay)=>timer(fn,delay),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>timer(fn,delay,delay),clearInterval:id=>timers.delete(id),
  addEventListener:(...args)=>windowEvents.addEventListener(...args),removeEventListener:(...args)=>windowEvents.removeEventListener(...args)};
 vm.createContext(global);vm.runInContext(source,global);
 const notify=name=>details=>{notices.push({name,...copy(details)});return options[name]?.(details);};
 const api=global.SnoteSessionOwnership.create({client,onSuspend:notify('suspend'),onResume:notify('resume'),onRevoked:notify('revoked')});
 async function advance(ms){
  const end=now+ms;
  while(true){let chosen;for(const entry of timers)if(entry[1].at<=end&&(!chosen||entry[1].at<chosen[1].at))chosen=entry;if(!chosen)break;
   const[id,item]=chosen;now=item.at;if(item.interval)item.at+=item.interval;else timers.delete(id);item.fn();await flush();
  }
  now=end;await flush();
 }
 return{api,client,global,document,windowEvents,calls,authCalls,authTokens,channels,removed,notices,timers,
  setSession:value=>{currentSession=value;},setRpc:value=>{rpc=value;},setGetSession:value=>{getSession=value;},
  advance,run:async promise=>{await advance(0);return promise;},inspect:()=>copy(api.inspect()),count:name=>notices.filter(value=>value.name===name).length};
}

test('claim is explicit, deferred outside auth callbacks and sends no caller-supplied RPC arguments',async()=>{
 const h=harness(),pending=h.api.claim(session());
 assert.equal(h.authCalls.length,0);assert.equal(h.calls.length,0);assert.equal(h.api.authorized(),false);
 assert.equal(await h.run(pending),true);assert.deepEqual(h.calls,[['snote_session_claim']]);
 assert(h.authCalls.length>=2);assert.equal(h.api.authorized(),true);assert.equal(h.count('resume'),1);
 assert.equal(h.channels[0].type,'postgres_changes');assert.deepEqual(copy(h.channels[0].filter),{event:'*',schema:'public',table:'snote_session_signals',filter:'user_id=eq.'+USER});
 assert.equal(h.authTokens.at(-1),session().access_token);assert(!JSON.stringify(h.inspect()).includes('signature'));h.api.stop();
});

test('another live owner requires explicit consent; no callback cannot take over or revoke',async()=>{
 const h=harness({rpc:()=>Promise.resolve(confirmation(4))});assert.equal(await h.run(h.api.claim(session())),false);
 assert.deepEqual(h.calls,[['snote_session_claim']]);assert.equal(h.inspect().reason,'confirmation-required');assert.equal(h.api.authorized(),false);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('replacement consent waits beyond the network deadline and submits only the observed generation',async()=>{
 const choice=deferred();let requests=0;const h=harness({rpc:()=>Promise.resolve(++requests===1?confirmation(4):ack(true,5))});
 const pending=h.api.claim(session(),{confirmReplacement:details=>{assert.equal(details.generation,4);return choice.promise;}});await h.advance(0);
 assert.equal(h.inspect().waitingConfirmation,true);await h.advance(25000);h.windowEvents.emit('focus');h.channels[0].emit({user_id:USER,generation:5});await h.advance(0);
 assert.equal(h.calls.length,1);assert.equal(h.count('revoked'),0);assert.equal(h.inspect().pending,true);assert.equal(h.api.authorized(),false);
 choice.resolve(true);await flush();assert.equal(await pending,true);assert.deepEqual(copy(h.calls[1]),['snote_session_claim',{p_confirm_replace:true,p_expected_generation:4}]);assert.equal(h.calls.length,2);h.api.stop();
});

test('cancellation preserves the existing owner and does not issue a second claim or revoke callback',async()=>{
 for(const decision of[false,undefined,'yes']){const h=harness({rpc:()=>Promise.resolve(confirmation(2))});assert.equal(await h.run(h.api.claim(session(),{confirmReplacement:()=>decision})),false);assert.equal(h.calls.length,1);assert.equal(h.inspect().reason,'confirmation-cancelled');assert.equal(h.count('revoked'),0);h.api.stop();}
});

test('confirmation envelopes are valid only for a claim with the exact typed confirmation flag',async()=>{
 const bad=[{data:{...confirmation(2).data,requiresConfirmation:false},error:null},{data:{...confirmation(2).data,requiresConfirmation:'true'},error:null},{data:{...ack().data,requiresConfirmation:true},error:null}];
 for(const response of bad){let prompts=0;const h=harness({rpc:()=>Promise.resolve(response)});assert.equal(await h.run(h.api.claim(session(),{confirmReplacement:()=>{prompts++;return true;}})),false);assert.equal(prompts,0);assert.equal(h.count('revoked'),0);assert.equal(h.calls.length,1);h.api.stop();}
 const h=harness({rpc:()=>Promise.resolve(confirmation(2))});assert.equal(await h.run(h.api.check(session())),false);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('a background status for an old identity cannot rebind a claim waiting for consent',async()=>{
 const choice=deferred();let calls=0;const h=harness({session:session(USER,OTHER_SID),rpc:()=>Promise.resolve(++calls===1?confirmation(2,USER,OTHER_SID):ack(true,3,USER,OTHER_SID))});const pending=h.api.claim(session(USER,OTHER_SID),{confirmReplacement:()=>choice.promise});await h.advance(0);
 const background=h.api.check(session(),'refresh');assert.equal(background,pending);assert.equal(h.inspect().sessionId,OTHER_SID);choice.resolve(true);await flush();assert.equal(await pending,true);assert.equal(h.inspect().sessionId,OTHER_SID);h.api.stop();
});

test('a changed generation requires another decision and never silently reuses old consent',async()=>{
 let call=0,decisions=0;const h=harness({rpc:()=>Promise.resolve(++call===1?confirmation(2):confirmation(3))});
 assert.equal(await h.run(h.api.claim(session(),{confirmReplacement:details=>{decisions++;assert.equal(details.generation,decisions+1);return decisions===1;}})),false);
 assert.equal(decisions,2);assert.deepEqual(copy(h.calls),[['snote_session_claim'],['snote_session_claim',{p_confirm_replace:true,p_expected_generation:2}]]);assert.equal(h.inspect().reason,'confirmation-cancelled');assert.equal(h.count('revoked'),0);h.api.stop();
});

test('approval cannot retry after its authentication identity changed while the dialog was open',async()=>{
 const choice=deferred(),h=harness({rpc:()=>Promise.resolve(confirmation(2))});const pending=h.api.claim(session(),{confirmReplacement:()=>choice.promise});await h.advance(0);
 h.setSession(session(USER,OTHER_SID));choice.resolve(true);await flush();assert.equal(await pending,false);assert.equal(h.calls.length,1);assert.equal(h.api.authorized(),false);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('stopping or rebinding closes a waiting claim and ignores late approval',async()=>{
 for(const action of['stop','rebind']){const choice=deferred(),h=harness({rpc:()=>Promise.resolve(confirmation(2))});const pending=h.api.claim(session(),{confirmReplacement:()=>choice.promise});await h.advance(0);
  if(action==='stop')h.api.stop();else{h.setSession(session(OTHER_USER,OTHER_SID));h.setRpc(()=>Promise.resolve(ack(true,4,OTHER_USER,OTHER_SID)));const next=h.api.claim(session(OTHER_USER,OTHER_SID));assert.equal(await h.run(next),true);}
  assert.equal(await pending,false);const before=h.calls.length;choice.resolve(true);await flush();assert.equal(h.calls.length,before);h.api.stop();
 }
});

test('network verification after approval retains the unused eight-second budget',async()=>{
 const choice=deferred(),response=deferred();let calls=0;const h=harness({rpc:()=>++calls===1?Promise.resolve(confirmation(2)):response.promise});const pending=h.api.claim(session(),{confirmReplacement:()=>choice.promise});await h.advance(0);await h.advance(20000);choice.resolve(true);await flush();assert.equal(h.calls.length,2);
 await h.advance(7999);assert.equal(h.inspect().pending,true);await h.advance(1);assert.equal(await pending,false);assert.equal(h.inspect().reason,'verification-timeout');response.resolve(ack(true,3));await flush();assert.equal(h.api.authorized(),false);h.api.stop();
});

test('restore/status accepts verified legacy ownership and never claims implicitly',async()=>{
 const h=harness({rpc:()=>Promise.resolve(ack(true,0,USER,SID,'LEGACY'))});
 assert.equal(await h.run(h.api.check()),true);assert.deepEqual(h.calls,[['snote_session_status']]);assert.equal(h.inspect().generation,0);assert.equal(h.inspect().reason,'LEGACY');h.api.stop();
});

test('an absent or malformed explicit session cannot authorize or claim',async()=>{
 const bad=[undefined,{},session(OTHER_USER,SID,{sub:USER}),{...session(),access_token:'bad'},session(USER,'not-a-session-id')];
 for(const value of bad){const h=harness();assert.equal(await h.api.claim(value),false);assert.equal(h.calls.length,0);assert.equal(h.api.authorized(),false);assert.equal(h.count('revoked'),0);h.api.stop();}
});

test('refresh checks status and updates Realtime auth without creating a new owner',async()=>{
 const h=harness();assert.equal(await h.run(h.api.check(session())),true);
 const refreshed=session(USER,SID,{exp:9999999999});h.setSession(refreshed);
 const pending=h.api.check(refreshed,'auth-event');assert.equal(h.api.authorized(),false);assert.equal(await h.run(pending),true);
 assert.deepEqual(h.calls.map(value=>value[0]),['snote_session_status','snote_session_status']);assert.equal(h.authTokens.at(-1),refreshed.access_token);assert.equal(h.channels.length,1);h.api.stop();
});

test('confirmed inactive ownership suspends and revokes once, without calling Supabase signOut',async()=>{
 const h=harness();await h.run(h.api.check(session()));h.setRpc(()=>Promise.resolve(ack(false,2)));
 assert.equal(await h.run(h.api.require('vehicle-save')),false);assert.equal(h.api.authorized(),false);assert.equal(h.inspect().state,'revoked');assert.equal(h.count('revoked'),1);
 assert.equal(h.inspect().generation,2);assert.equal(h.notices.find(value=>value.name==='revoked').generation,2);
 const length=h.calls.length;assert.equal(await h.api.check(session()),false);assert.equal(await h.api.claim(session()),false);assert.equal(h.calls.length,length);assert.equal(h.count('revoked'),1);assert.equal(h.client.auth.signOut,undefined);h.api.stop();
});

test('malformed, foreign and unsuccessful acknowledgements suspend rather than authorizing or revoking',async()=>{
 const malformed=[
  {data:null,error:null},{data:{...ack().data,ok:false},error:null},{data:{...ack().data,active:'true'},error:null},
  ack(true,1,OTHER_USER),ack(false,1,USER,OTHER_SID),ack(true,-1),ack(true,Number.MAX_SAFE_INTEGER+1),
  {data:{...ack().data,reason:null},error:null},{data:ack().data,error:{message:'network'}}
 ];
 for(const response of malformed){const h=harness({rpc:()=>Promise.resolve(response)});assert.equal(await h.run(h.api.check(session())),false);assert.equal(h.api.authorized(),false);assert.equal(h.count('revoked'),0);h.api.stop();}
});

test('semantic reason mismatches are unavailable responses rather than ownership revocations',async()=>{
 const invalid=[ack(false,1,USER,SID,'ACTIVE'),ack(false,0,USER,SID,'LEGACY'),ack(false,0,USER,SID,'REPLACED'),ack(true,0,USER,SID,'ACTIVE'),ack(true,1,USER,SID,'LEGACY'),ack(true,1,USER,SID,'SESSION_MISSING'),ack(false,1,USER,SID,'UNKNOWN')];
 for(const response of invalid){const h=harness({rpc:()=>Promise.resolve(response)});assert.equal(await h.run(h.api.check(session())),false);assert.equal(h.inspect().state,'suspended');assert.equal(h.count('revoked'),0);h.api.stop();}
 const claiming=harness({rpc:()=>Promise.resolve(ack(true,0,USER,SID,'LEGACY'))});assert.equal(await claiming.run(claiming.api.claim(session())),false);assert.equal(claiming.count('revoked'),0);claiming.api.stop();
});

test('a matching SESSION_MISSING response remains authoritative even with generation zero',async()=>{
 const h=harness();await h.run(h.api.check(session()));h.setRpc(()=>Promise.resolve(ack(false,0,USER,SID,'SESSION_MISSING')));assert.equal(await h.run(h.api.check()),false);assert.equal(h.count('revoked'),1);h.api.stop();
});

test('pre-RPC auth identity mismatch blocks the request without claiming another session',async()=>{
 const h=harness({session:session(OTHER_USER,OTHER_SID)});assert.equal(await h.run(h.api.claim(session())),false);assert.equal(h.calls.length,0);assert.equal(h.api.authorized(),false);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('an auth switch while the RPC is pending cannot apply its old active acknowledgement',async()=>{
 const response=deferred(),h=harness({rpc:()=>response.promise}),promise=h.api.check(session());await h.advance(0);assert.equal(h.calls.length,1);
 h.setSession(session(OTHER_USER,OTHER_SID));response.resolve(ack());await flush();assert.equal(await promise,false);assert.equal(h.api.authorized(),false);assert.equal(h.count('resume'),0);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('ordinary concurrent checks/actions use one in-flight verification without a UI flash',async()=>{
 const h=harness();await h.run(h.api.check(session()));const suspended=h.count('suspend'),resumed=h.count('resume'),response=deferred();h.setRpc(()=>response.promise);
 const first=h.api.require('persist-cars'),second=h.api.check(),third=h.api.require();assert.equal(first,second);assert.equal(second,third);assert.equal(h.api.authorized(),true);
 await h.advance(0);assert.equal(h.calls.length,2);response.resolve(ack());await flush();assert.equal(await first,true);assert.equal(h.count('suspend'),suspended);assert.equal(h.count('resume'),resumed);h.api.stop();
});

test('an explicit claim supersedes an older same-session status read',async()=>{
 const response=deferred();let reads=0;const h=harness({rpc:()=>++reads===1?response.promise:Promise.resolve(ack())});const old=h.api.check(session());await h.advance(0);const claiming=h.api.claim(session());assert.equal(await old,false);assert.equal(await h.run(claiming),true);
 response.resolve(ack(false,2));await flush();assert.equal(h.api.authorized(),true);assert.equal(h.count('revoked'),0);assert.deepEqual(h.calls.map(value=>value[0]),['snote_session_status','snote_session_claim']);h.api.stop();
});

test('a generation hint only nudges status; it does not blindly evict the still-active owner',async()=>{
 const h=harness();await h.run(h.api.check(session()));const channel=h.channels[0];h.setRpc(()=>Promise.resolve(ack(true,2)));
 channel.emit({generation:999999});assert.equal(h.api.authorized(),false);assert.equal(h.count('revoked'),0);assert.equal(h.calls.length,1);
 await h.advance(0);assert.equal(h.api.authorized(),true);assert.equal(h.count('revoked'),0);assert.equal(h.calls.at(-1)[0],'snote_session_status');
 const length=h.calls.length;channel.emit({user_id:OTHER_USER,generation:3});channel.emit({user_id:USER,generation:'3'});await h.advance(0);assert.equal(h.calls.length,length);h.api.stop();
});

test('a hint during an old active read forces a fresh status check before resuming',async()=>{
 const h=harness();await h.run(h.api.check(session()));const response=deferred();let reads=0;h.setRpc(()=>++reads===1?response.promise:Promise.resolve(ack(false,2)));
 const pending=h.api.require();await h.advance(0);h.channels[0].emit({user_id:USER,generation:2});assert.equal(h.api.authorized(),false);
 response.resolve(ack(true,1));await flush();assert.equal(await pending,false);assert.equal(h.count('resume'),1);assert.equal(h.count('revoked'),1);assert.equal(reads,2);h.api.stop();
});

test('a hint during claim follows with status rather than issuing another takeover',async()=>{
 const response=deferred();let called=0;const h=harness({rpc:()=>++called===1?response.promise:Promise.resolve(ack(false,2))});
 const pending=h.api.claim(session());await h.advance(0);h.channels[0].emit({user_id:USER,generation:2});response.resolve(ack(true,1));await flush();
 assert.equal(await pending,false);assert.deepEqual(h.calls.map(value=>value[0]),['snote_session_claim','snote_session_status']);assert.equal(h.count('resume'),0);assert.equal(h.count('revoked'),1);h.api.stop();
});

test('visible online polling runs every five seconds without suspending a verified owner',async()=>{
 const h=harness();await h.run(h.api.check(session()));const suspended=h.count('suspend');await h.advance(4999);assert.equal(h.calls.length,1);await h.advance(1);assert.equal(h.calls.length,2);assert.equal(h.count('suspend'),suspended);
 h.document.visibilityState='hidden';await h.advance(10000);assert.equal(h.calls.length,2);h.document.visibilityState='visible';h.global.navigator.onLine=false;await h.advance(5000);assert.equal(h.calls.length,2);h.api.stop();
});

test('foreground events synchronously suspend and coalesce a deferred status check',async()=>{
 const h=harness();await h.run(h.api.check(session()));const before=h.calls.length;
 h.windowEvents.emit('focus');h.windowEvents.emit('pageshow');h.document.emit('visibilitychange');assert.equal(h.api.authorized(),false);assert.equal(h.calls.length,before);
 await h.advance(0);assert.equal(h.api.authorized(),true);assert.equal(h.calls.length,before+1);h.api.stop();
});

test('going offline during a verification cannot authorize its late successful response',async()=>{
 const h=harness();await h.run(h.api.check(session()));const response=deferred();h.setRpc(()=>response.promise);
 const pending=h.api.require();await h.advance(0);h.global.navigator.onLine=false;h.windowEvents.emit('offline');assert.equal(h.api.authorized(),false);
 response.resolve(ack());await flush();assert.equal(await pending,false);assert.equal(h.count('revoked'),0);
 h.setRpc(()=>Promise.resolve(ack()));h.global.navigator.onLine=true;h.windowEvents.emit('online');await h.advance(0);assert.equal(h.api.authorized(),true);h.api.stop();
});

test('network failures suspend without revoking; a verified retry resumes once',async()=>{
 const h=harness();await h.run(h.api.check(session()));h.setRpc(()=>Promise.reject(Error('offline')));
 assert.equal(await h.run(h.api.require()),false);assert.equal(h.inspect().state,'suspended');assert.equal(h.count('revoked'),0);assert.equal(h.count('resume'),1);
 h.setRpc(()=>Promise.resolve(ack()));assert.equal(await h.run(h.api.check()),true);assert.equal(h.count('resume'),2);h.api.stop();
});

test('a different explicit login can rebind the same client after a failed verification',async()=>{
 const h=harness({rpc:()=>Promise.reject(Error('network'))});assert.equal(await h.run(h.api.check(session())),false);
 h.setSession(session(USER,OTHER_SID));h.setRpc(()=>Promise.resolve(ack(true,2,USER,OTHER_SID)));assert.equal(await h.run(h.api.claim(session(USER,OTHER_SID))),true);assert.equal(h.inspect().sessionId,OTHER_SID);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('getSession timeout finishes within eight seconds and ignores its late result',async()=>{
 const response=deferred(),h=harness({getSession:()=>response.promise}),pending=h.api.check(session());await h.advance(0);await h.advance(7999);assert.equal(h.inspect().pending,true);
 await h.advance(1);assert.equal(await pending,false);assert.equal(h.inspect().reason,'verification-timeout');response.resolve({data:{session:session()},error:null});await flush();assert.equal(h.calls.length,0);assert.equal(h.count('resume'),0);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('RPC timeout cannot authorize even if the server replies active later',async()=>{
 const h=harness();await h.run(h.api.check(session()));const response=deferred();h.setRpc(()=>response.promise);const pending=h.api.require();await h.advance(0);await h.advance(8000);
 assert.equal(await pending,false);assert.equal(h.api.authorized(),false);response.resolve(ack());await flush();assert.equal(h.api.authorized(),false);assert.equal(h.count('resume'),1);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('A to B identity switches cancel old reads and old Realtime signals without affecting B',async()=>{
 const response=deferred();let reads=0;const h=harness({rpc:()=>++reads===1?response.promise:Promise.resolve(ack(true,3,OTHER_USER,OTHER_SID))});
 const old=h.api.check(session());await h.advance(0);const oldChannel=h.channels[0];h.setSession(session(OTHER_USER,OTHER_SID));const next=h.api.check(session(OTHER_USER,OTHER_SID),'auth-event');assert.equal(await old,false);
 assert.equal(await h.run(next),true);response.resolve(ack(false,9));oldChannel.emit({user_id:USER,generation:10});await flush();assert.equal(h.api.authorized(),true);assert.equal(h.inspect().userId,OTHER_USER);assert.equal(h.count('revoked'),0);assert(h.removed.includes(oldChannel));h.api.stop();
});

test('stop resolves pending callers and removes timers, event handlers and subscriptions',async()=>{
 const h=harness();await h.run(h.api.check(session()));const response=deferred();h.setRpc(()=>response.promise);const pending=h.api.require();await h.advance(0);const oldChannel=h.channels[0];h.api.stop();
 assert.equal(await pending,false);assert.equal(h.api.authorized(),false);assert.equal(h.inspect().state,'stopped');assert.equal(h.timers.size,0);assert.equal(h.removed.length,1);
 response.resolve(ack());h.windowEvents.emit('focus');oldChannel.emit({generation:3});await h.advance(10000);assert.equal(h.calls.length,2);assert.equal(h.count('revoked'),0);assert.equal(await h.api.check(session()),false);
 assert([...h.windowEvents.events.values()].every(value=>value.length===0));assert([...h.document.events.values()].every(value=>value.length===0));
});

test('callback failures cannot turn authoritative success or revocation into a different outcome',async()=>{
 const h=harness({suspend:()=>{throw Error('renderer');},resume:()=>Promise.reject(Error('renderer')),revoked:()=>{throw Error('renderer');}});
 assert.equal(await h.run(h.api.claim(session())),true);assert.equal(h.api.authorized(),true);h.setRpc(()=>Promise.resolve(ack(false,2)));assert.equal(await h.run(h.api.check()),false);assert.equal(h.count('revoked'),1);h.api.stop();
});

test('a closed Realtime channel is replaced and its old callbacks cannot affect the new subscription',async()=>{
 const h=harness();await h.run(h.api.check(session()));const old=h.channels[0];old.status('CLOSED');assert.equal(h.api.authorized(),false);await h.advance(0);
 assert.equal(h.api.authorized(),true);assert.equal(h.channels.length,2);assert.notEqual(h.channels[0].name,h.channels[1].name);assert(h.removed.includes(old));const before=h.calls.length;old.emit({generation:99});await h.advance(0);assert.equal(h.calls.length,before);h.api.stop();
});

test('Realtime transport failures leave authoritative polling usable',async()=>{
 const h=harness();h.client.realtime.setAuth=()=>Promise.reject(Error('socket down'));assert.equal(await h.run(h.api.check(session())),true);
 h.channels[0].status('CHANNEL_ERROR');await h.advance(0);assert.equal(h.api.authorized(),true);assert.equal(h.count('revoked'),0);await h.advance(5000);assert.equal(h.calls.at(-1)[0],'snote_session_status');h.api.stop();
});

test('a lower generation cannot replace an already confirmed generation',async()=>{
 const h=harness({rpc:()=>Promise.resolve(ack(true,4))});await h.run(h.api.check(session()));h.setRpc(()=>Promise.resolve(ack(true,3)));
 assert.equal(await h.run(h.api.require()),false);assert.equal(h.inspect().generation,4);assert.equal(h.count('revoked'),0);h.api.stop();
});

test('a freshly authenticated different session can claim after the old one was revoked',async()=>{
 const h=harness({rpc:()=>Promise.resolve(ack(false,2))});assert.equal(await h.run(h.api.check(session())),false);assert.equal(h.count('revoked'),1);
 h.setSession(session(USER,OTHER_SID));h.setRpc(()=>Promise.resolve(ack(true,3,USER,OTHER_SID)));assert.equal(await h.run(h.api.claim(session(USER,OTHER_SID))),true);assert.equal(h.api.authorized(),true);assert.equal(h.inspect().sessionId,OTHER_SID);h.api.stop();
});

test('a callback stopping the owner cannot leave a hung claim or an authorized instance',async()=>{
 let owner;const h=harness({suspend:()=>owner?.stop()});owner=h.api;assert.equal(await owner.claim(session()),false);assert.equal(owner.authorized(),false);assert.equal(h.timers.size,0);
});

test('stopping inside an inactive-response suspend callback remains terminal without a later revoke callback',async()=>{
 let stopOnSuspend=false,owner;const h=harness({suspend:()=>{if(stopOnSuspend)owner.stop();}});owner=h.api;await h.run(owner.check(session()));stopOnSuspend=true;h.setRpc(()=>Promise.resolve(ack(false,2)));
 assert.equal(await h.run(owner.require()),false);assert.equal(owner.inspect().state,'stopped');assert.equal(h.count('revoked'),0);assert.equal(h.timers.size,0);
});
