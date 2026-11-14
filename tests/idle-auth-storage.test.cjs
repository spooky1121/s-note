const {test}=require('node:test');const assert=require('node:assert/strict');
const {create,identity}=require('../assets/idle-auth-storage.js');
const project='https://testproject.supabase.co',user='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',key='sb-testproject-auth-token';
const map=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const session=(sessionId=sid,userId=user)=>JSON.stringify({access_token:'header.'+Buffer.from(JSON.stringify({sub:userId,session_id:sessionId})).toString('base64url')+'.signature',refresh_token:'test-only'});
function fixture(){const local=map(),other=map(),base={getItem:k=>local.getItem(k),setItem:(k,v)=>local.setItem(k,v),removeItem:k=>{local.removeItem(k);other.removeItem(k)}};return {local,other,store:create({project,base,local,session:other})};}
function tombstone(f,overrides={}){f.local.setItem('snote-idle:v1:'+encodeURIComponent(project)+':'+encodeURIComponent(user)+':expired:'+encodeURIComponent(sid),JSON.stringify({version:1,project,userId:user,sessionId:sid,at:Date.now(),...overrides}));}
test('normal SDK persistence delegates without adding any idle payload copies',()=>{const f=fixture();f.store.setItem(key,session());assert.equal(f.store.getItem(key),session());assert.deepEqual(identity(session()),{userId:user,sessionId:sid});});
test('a matching expired session cannot restore or rewrite tokens',()=>{const f=fixture();f.store.setItem(key,session());tombstone(f);assert.equal(f.store.getItem(key),null);f.local.removeItem(key);f.store.setItem(key,session());assert.equal(f.local.getItem(key),null);});
test('foreign, future and malformed expiry markers do not block a fresh session',()=>{const f=fixture();for(const marker of [{userId:'another-user'},{at:Date.now()+100000},{version:2}]){tombstone(f,marker);f.store.setItem(key,session());assert.equal(f.store.getItem(key),session());}tombstone(f);const fresh=session('new-session');f.store.authorizeSession({userId:user,sessionId:'new-session'});f.store.setItem(key,fresh);assert.equal(f.store.getItem(key),fresh);});
test('revocation clears only the expected SDK session and related keys in both stores',()=>{const f=fixture();for(const store of [f.local,f.other]){store.setItem(key,session());store.setItem(key+'-user','profile');store.setItem(key+'-code-verifier','verifier');store.setItem('unrelated-business-cache','keep');}f.store.revoke({userId:user,sessionId:sid});for(const store of [f.local,f.other]){assert.equal(store.getItem(key),null);assert.equal(store.getItem(key+'-user'),null);assert.equal(store.getItem('unrelated-business-cache'),'keep');}f.store.setItem(key,session());assert.equal(f.local.getItem(key),null);assert.equal(f.store.getItem(key),null);});
test('an in-flight old adapter cannot clear or overwrite a newer user session',()=>{const f=fixture(),fresh=session('fresh-session','other-user');f.local.setItem(key,fresh);assert.equal(f.store.hasDifferentSession({userId:user,sessionId:sid}),true);f.store.revoke({userId:user,sessionId:sid});assert.equal(f.local.getItem(key),fresh);f.store.setItem(key,session());f.store.removeItem(key);assert.equal(f.local.getItem(key),fresh);});
test('preserve revokes old adapter while a new adapter remains usable',()=>{const f=fixture();f.local.setItem(key,session('fresh-session'));f.store.revoke({userId:user,sessionId:sid},{preserve:true});assert.equal(f.store.getItem(key),null);assert.ok(f.local.getItem(key));const next=create({project,base:{getItem:k=>f.local.getItem(k),setItem:(k,v)=>f.local.setItem(k,v),removeItem:k=>f.local.removeItem(k)},local:f.local,session:f.other});assert.equal(next.getItem(key),session('fresh-session'));});

test('bounded final flush may read only its pinned expired session until revocation',()=>{const f=fixture();f.store.setItem(key,session());tombstone(f);assert.equal(f.store.getItem(key),null);f.store.beginExpiry({userId:user,sessionId:sid});assert.equal(f.store.getItem(key),session());f.local.removeItem(key);f.store.setItem(key,session());assert.equal(f.local.getItem(key),null,'Expired tokens still cannot be rewritten');f.local.setItem(key,session());f.store.revoke({userId:user,sessionId:sid});assert.equal(f.store.getItem(key),null);});

test('an active tab keeps its pinned session for authoritative status after another tab publishes a winner',()=>{
 const f=fixture(),old=session(),winner=session('winning-session');
 f.local.setItem(key,old);assert.equal(f.store.getItem(key),old);
 f.local.setItem(key,winner);
 assert.equal(f.store.getItem(key),old,'The old tab must check its own session rather than adopt or lock on the winner');
 f.store.setItem(key,session(sid,user).replace('test-only','old-inflight-refresh'));
 f.store.removeItem(key);
 assert.equal(f.local.getItem(key),winner,'Old SDK refresh and removal cannot overwrite or erase the winner');
 f.store.revoke({userId:user,sessionId:sid});assert.equal(f.local.getItem(key),winner);
});

test('only explicit confirmed promotion permits the pinned adapter to publish a different session',()=>{
 const f=fixture(),old=session(),winner=session('winning-session');f.store.setItem(key,old);
 f.store.setItem(key,winner);assert.equal(f.local.getItem(key),old);
 f.store.authorizeSession({userId:user,sessionId:'winning-session'});
 assert.equal(f.store.getItem(key),null,'Promotion must not read the old canonical token as the new pin');
 f.store.setItem(key,winner);assert.equal(f.local.getItem(key),winner);assert.equal(f.store.getItem(key),winner);
 f.store.setItem(key,old);assert.equal(f.local.getItem(key),winner);
});

test('foreign user and verifier storage never enters the old tab or overwrites the winning tab',()=>{
 const f=fixture();f.store.setItem(key,session());f.store.setItem(key+'-user','old-user');f.store.setItem(key+'-code-verifier','old-verifier');
 const winner=session('winning-session');f.local.setItem(key,winner);f.local.setItem(key+'-user','winner-user');f.local.setItem(key+'-code-verifier','winner-verifier');
 assert.equal(f.store.getItem(key+'-user'),'old-user');assert.equal(f.store.getItem(key+'-code-verifier'),'old-verifier');
 f.store.setItem(key+'-user','old-refreshed-user');f.store.removeItem(key+'-code-verifier');
 assert.equal(f.local.getItem(key+'-user'),'winner-user');assert.equal(f.local.getItem(key+'-code-verifier'),'winner-verifier');
});

test('the operator custom auth key uses the same pin and confirmed promotion contract',()=>{
 const f=fixture(),authKey='snote-operator-auth-v1',store=create({project,authKey,base:f.local,local:f.local,session:f.other}),old=session(),winner=session('operator-winner');
 store.setItem(authKey,old);f.local.setItem(authKey,winner);assert.equal(store.getItem(authKey),old);
 store.setItem(authKey,old);store.removeItem(authKey);assert.equal(f.local.getItem(authKey),winner);
 store.authorizeSession({userId:user,sessionId:'operator-winner'});store.setItem(authKey,winner);assert.equal(store.getItem(authKey),winner);
 store.revoke({userId:user,sessionId:'operator-winner'});assert.equal(f.local.getItem(authKey),null);assert.throws(()=>store.authorizeSession({userId:user,sessionId:sid}));
});

test('a changed remember preference cannot let an old refresh erase the other store winner',()=>{
 const local=map(),tab=map();let remember=true;
 const base={getItem:k=>(remember?local:tab).getItem(k),setItem(k,v){const target=remember?local:tab;target.setItem(k,v);(remember?tab:local).removeItem(k);},removeItem(k){local.removeItem(k);tab.removeItem(k);}};
 const store=create({project,base,local,session:tab}),old=session(),winner=session('remembered-winner');store.setItem(key,old);local.setItem(key,winner);remember=false;
 assert.equal(store.getItem(key),old);store.setItem(key,old);store.removeItem(key);
 assert.equal(local.getItem(key),winner);assert.equal(tab.getItem(key),null);
});

test('queued old-tab revocation and refresh serialize with confirmed winner publication',async()=>{
 const local=map(),tab=map(),names=[],queue=[];
 const locks={request(name,options,work){names.push(name);assert.equal(options.mode,'exclusive');return new Promise((resolve,reject)=>queue.push(()=>{try{resolve(work());}catch(error){reject(error);}}));}};
 const make=()=>create({project,base:local,local,session:tab,locks}),old=make(),next=make(),a=session(),b=session('queued-winner');
 const first=old.setItem(key,a);queue.shift()();await first;assert.equal(old.getItem(key),a);
 next.authorizeSession({userId:user,sessionId:'queued-winner'});
 const promotion=next.setItem(key,b),lateRefresh=old.setItem(key,a),cleanup=old.revoke({userId:user,sessionId:sid});
 assert.equal(old.getItem(key),null,'In-memory revocation is immediate while physical cleanup waits');
 while(queue.length)queue.shift()();await Promise.all([promotion,lateRefresh,cleanup]);
 assert.equal(local.getItem(key),b);assert.equal(next.getItem(key),b);
 assert.equal(new Set(names).size,1,'All mutations use the same project and auth-key lock');
});

test('late SDK refresh failure cannot remove the newly promoted pin on the same client',()=>{
 const f=fixture(),winner=session('same-client-winner');f.store.setItem(key,session());
 f.store.authorizeSession({userId:user,sessionId:'same-client-winner'});f.store.setItem(key,winner);f.store.setItem(key+'-user','winner-user');
 f.store.removeItem(key);f.store.removeItem(key+'-user');f.store.removeItem(key+'-code-verifier');
 assert.equal(f.local.getItem(key),winner);assert.equal(f.store.getItem(key),winner);assert.equal(f.store.getItem(key+'-user'),'winner-user');
 f.store.revoke({userId:user,sessionId:'same-client-winner'});assert.equal(f.local.getItem(key),null);assert.equal(f.store.getItem(key),null);
});

test('an unbound SDK cleanup cannot remove a different tab session published after its old invalid read',()=>{
 const f=fixture(),winner=session('already-published-winner');
 f.local.setItem(key,winner);f.store.removeItem(key);assert.equal(f.local.getItem(key),winner);
});

test('confirmed promotion does not attach the prior session user or verifier to its new token',()=>{
 const f=fixture(),winner=session('promoted-without-related-values');
 f.store.setItem(key,session());f.store.setItem(key+'-user','old-user');f.store.setItem(key+'-code-verifier','old-verifier');
 f.store.authorizeSession({userId:user,sessionId:'promoted-without-related-values'});f.store.setItem(key,winner);
 assert.equal(f.store.getItem(key),winner);
 for(const suffix of ['-user','-code-verifier'])assert.equal(f.store.getItem(key+suffix),null,'A new session cannot inherit the old session '+suffix);
 f.store.setItem(key+'-user','confirmed-user');assert.equal(f.store.getItem(key+'-user'),'confirmed-user','Related storage remains usable after promotion');
});

test('queued old-session related writes cannot cross confirmed promotion while waiting for the storage lock',async()=>{
 const local=map(),tab=map(),queue=[],locks={request(name,options,work){return new Promise((resolve,reject)=>queue.push(()=>{try{resolve(work());}catch(error){reject(error);}}));}};
 const store=create({project,base:local,local,session:tab,locks}),winner=session('queued-related-winner');
 const first=store.setItem(key,session());queue.shift()();await first;
 const staleUser=store.setItem(key+'-user','old-delayed-user'),staleVerifier=store.setItem(key+'-code-verifier','old-delayed-verifier');
 store.authorizeSession({userId:user,sessionId:'queued-related-winner'});const promotion=store.setItem(key,winner);
 while(queue.length)queue.shift()();await Promise.all([staleUser,staleVerifier,promotion]);
 assert.equal(store.getItem(key),winner);
 for(const suffix of ['-user','-code-verifier'])assert.equal(store.getItem(key+suffix),null,'A queued old-session '+suffix+' cannot join the promoted session');
});

test('related writes queued by an unbound SDK cannot become the confirmed session user or verifier',async()=>{
 const local=map(),tab=map(),queue=[],locks={request(name,options,work){return new Promise((resolve,reject)=>queue.push(()=>{try{resolve(work());}catch(error){reject(error);}}));}};
 const store=create({project,base:local,local,session:tab,locks}),winner=session('initial-promotion-winner');
 const staleUser=store.setItem(key+'-user','unbound-user'),staleVerifier=store.setItem(key+'-code-verifier','unbound-verifier');
 store.authorizeSession({userId:user,sessionId:'initial-promotion-winner'});const promotion=store.setItem(key,winner);
 while(queue.length)queue.shift()();await Promise.all([staleUser,staleVerifier,promotion]);
 assert.equal(store.getItem(key),winner);
 for(const suffix of ['-user','-code-verifier'])assert.equal(store.getItem(key+suffix),null,'An unbound queued '+suffix+' cannot acquire the later authorized identity');
});

test('a delayed authorized publication cannot replace a newer account generation in either write order',()=>{
 for(const order of ['old-then-new','new-then-old']){
  const local=map(),make=()=>create({project,base:local,local,session:map()}),initial=make(),b=make(),c=make();
  const aRaw=session('initial-owner'),bRaw=session('generation-two'),cRaw=session('generation-three');
  initial.authorizeSession({userId:user,sessionId:'initial-owner',generation:1});initial.setItem(key,aRaw);
  assert.equal(b.getItem(key),aRaw);assert.equal(c.getItem(key),aRaw);
  b.authorizeSession({userId:user,sessionId:'generation-two',generation:2});
  c.authorizeSession({userId:user,sessionId:'generation-three',generation:3});
  if(order==='old-then-new'){b.setItem(key,bRaw);c.setItem(key,cRaw);}else{c.setItem(key,cRaw);b.setItem(key,bRaw);}
  assert.equal(local.getItem(key),cRaw,'Generation three remains canonical after '+order);
  assert.equal(b.getItem(key),bRaw,'The superseded tab retains its own token for authoritative status instead of adopting the winner');
  b.revoke({userId:user,sessionId:'generation-two'});
  assert.equal(local.getItem(key),cRaw,'Losing-tab cleanup preserves the latest canonical session after '+order);
  assert.equal(c.getItem(key),cRaw);
 }
});

test('explicitly authorizing another account permits its generation one after a prior account generation nine',()=>{
 const local=map(),make=()=>create({project,base:local,local,session:map()}),old=make(),next=make(),oldRaw=session('prior-account-owner'),nextUser='second-account',nextRaw=session('second-account-owner',nextUser);
 old.authorizeSession({userId:user,sessionId:'prior-account-owner',generation:9});old.setItem(key,oldRaw);
 assert.equal(next.getItem(key),oldRaw);next.setItem(key,nextRaw);assert.equal(local.getItem(key),oldRaw,'A foreign token needs explicit authorization');
 next.authorizeSession({userId:nextUser,sessionId:'second-account-owner',generation:1});next.setItem(key,nextRaw);
 assert.equal(local.getItem(key),nextRaw,'Generation comparison is scoped to the authenticated account');
 old.setItem(key,oldRaw);old.revoke({userId:user,sessionId:'prior-account-owner'});
 assert.equal(local.getItem(key),nextRaw,'Old-account refresh and cleanup cannot erase the explicitly promoted account');
});
