import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/workspace-order-store.js',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clone=value=>structuredClone(value),tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const key=(company=C,role='dealer',section='sidebar')=>'snote_order_v1_'+(company||'platform')+'_'+role+'_'+section;
function fixture({fastTimeout=false}={}){
 let active={ready:true,key:'scope-A',actorId:A,companyId:C,role:'dealer'},token='token-A';
 const users=new Map([[A,{id:A,user_metadata:{unrelated:'untouched'}}],[B,{id:B,user_metadata:{}}]]);
 const puts=[],pins=[],reads=[],confirmed=[],hooks={};
 const world={URL,AbortController,Map,Set,Object,Array,Error,Promise,JSON,setTimeout:fastTimeout?(fn)=>setTimeout(fn,5):setTimeout,clearTimeout};vm.runInNewContext(source,world);
 const options={context:()=>active,onConfirmedUser:(user,ctx)=>confirmed.push({user:clone(user),ctx:clone(ctx)}),pin:async ctx=>{
  const pinnedToken=token,pinnedContext={...ctx};pins.push({ctx:clone(ctx),token:pinnedToken});if(hooks.pin)await hooks.pin(ctx);
  return {accessToken:pinnedToken,url:hooks.url||'https://synthetic.supabase.co',anonKey:'sb_publishable_synthetic',current:()=>active?.key===pinnedContext.key&&token===pinnedToken&&active?.ready===true,
   readUser:async()=>{reads.push({token:pinnedToken,actor:ctx.actorId});return hooks.readUser?hooks.readUser(ctx,pinnedToken):clone(users.get(ctx.actorId));},
   fetch:async(url,init)=>{
    const body=JSON.parse(init.body),call={url,init,body};puts.push(call);if(hooks.fetch)return hooks.fetch(call,ctx);
    Object.assign(users.get(ctx.actorId).user_metadata,body.data);return{ok:true,status:200,json:async()=>clone(users.get(ctx.actorId))};
   }};
 }};
 const store=world.SnoteWorkspaceOrderStore.create(options);
 return{store,world,options,users,puts,pins,reads,confirmed,hooks,get active(){return active;},set active(value){active=value;},get token(){return token;},set token(value){token=value;}};
}
const code=(operation,wanted)=>assert.rejects(operation,error=>error.code===wanted);

test('read defaults to null and saves a single scoped metadata key using the pinned own-user token',async()=>{
 const f=fixture(),ctx=f.store.context();assert(Object.isFrozen(ctx));assert.equal(await f.store.read(ctx,'sidebar'),null);
 assert.deepEqual(Array.from((await f.store.save(ctx,'sidebar',['buy','dashboard','sell'])).ids),['buy','dashboard','sell']);
 const call=f.puts[0];assert.equal(call.url,'https://synthetic.supabase.co/auth/v1/user');assert.equal(call.init.method,'PUT');assert.equal(call.init.credentials,'omit');assert.equal(call.init.cache,'no-store');assert.equal(call.init.redirect,'error');assert.equal(call.init.referrerPolicy,'no-referrer');assert.equal(call.init.headers.Authorization,'Bearer token-A');assert.equal(call.init.headers.apikey,'sb_publishable_synthetic');assert.deepEqual(Object.keys(call.body),['data']);assert.deepEqual(Object.keys(call.body.data),[key()]);assert.deepEqual(call.body.data[key()],{version:1,ids:['buy','dashboard','sell']});assert.equal(f.users.get(A).user_metadata.unrelated,'untouched');
 assert.deepEqual(Array.from(await f.store.read(ctx,'sidebar')),['buy','dashboard','sell']);assert.equal(f.reads.length,4,'one initial read plus pre-save and post-save verification plus final read');assert.equal(f.confirmed.length,3);
});

test('account, company, role and section each have independent storage scopes',async()=>{
 const f=fixture();await f.store.save(f.store.context(),'sidebar',['buy']);f.active={...f.active,role:'accountant',key:'accountant'};await f.store.save(f.store.context(),'document-types',['sale','purchase']);await f.store.save(f.store.context(),'form-types',['transfer-contract']);f.active={...f.active,companyId:D,key:'company-D'};assert.equal(await f.store.read(f.store.context(),'document-types'),null);await f.store.save(f.store.context(),'sidebar',['contractOffice']);
 const meta=f.users.get(A).user_metadata;assert.deepEqual(meta[key()],{version:1,ids:['buy']});assert.deepEqual(meta[key(C,'accountant','document-types')],{version:1,ids:['sale','purchase']});assert.deepEqual(meta[key(D,'accountant')],{version:1,ids:['contractOffice']});
 f.active={ready:true,key:'account-B',actorId:B,companyId:C,role:'dealer'};f.token='token-B';assert.equal(await f.store.read(f.store.context(),'sidebar'),null);await f.store.save(f.store.context(),'sidebar',['sell']);assert.deepEqual(f.users.get(B).user_metadata[key()].ids,['sell']);assert.deepEqual(f.users.get(A).user_metadata[key()].ids,['buy']);
});

test('platform operator requires a verified null-company context and uses only its operator section',async()=>{
 const f=fixture();f.active={ready:true,key:'platform',actorId:A,companyId:null,role:'operator'};const ctx=f.store.context();assert(ctx);await f.store.save(ctx,'operator-sidebar',['support','vehicles','accounts','access']);assert.deepEqual(f.users.get(A).user_metadata[key(null,'operator','operator-sidebar')].ids,['support','vehicles','accounts','access']);await code(f.store.read(ctx,'sidebar'),'ORDER_INVALID');await code(f.store.save(ctx,'document-types',[]),'ORDER_INVALID');f.active={...f.active,companyId:C};assert.equal(f.store.context(),null);
});

test('input and metadata are strictly bounded and never create route permissions',async()=>{
 const f=fixture(),ctx=f.store.context();for(const order of[null,{},'buy',['buy','buy'],[''],['with space'],['<script>'],['a'.repeat(65)],Array.from({length:33},(_,i)=>'item'+i)])await code(f.store.save(ctx,'sidebar',order),'ORDER_INVALID');for(const section of['unknown','operator-sidebar','__proto__'])await code(f.store.save(ctx,section,[]),'ORDER_INVALID');assert.equal(f.puts.length,0);
 for(const entry of[null,{version:2,ids:[]},{version:1,ids:['buy','buy']},{version:1,ids:['가']},{version:1,ids:[],extra:true}]){f.users.get(A).user_metadata[key()]=entry;await code(f.store.read(ctx,'sidebar'),'ORDER_INVALID');}
 await f.store.save(ctx,'sidebar',Array.from({length:32},(_,i)=>'id_'+i));assert.equal((await f.store.read(ctx,'sidebar')).length,32);await f.store.save(ctx,'sidebar',[]);assert.deepEqual(Array.from(await f.store.read(ctx,'sidebar')),[]);
});

test('unready and changed account/company/role contexts cannot start a write',async()=>{
 for(const patch of[{ready:false},{actorId:B},{companyId:D},{role:'admin'},{key:'different'}]){const f=fixture(),ctx=f.store.context();f.active={...f.active,...patch};assert.equal(f.store.current(ctx),false);await code(f.store.save(ctx,'sidebar',['buy']),'ORDER_CONTEXT_CHANGED');assert.equal(f.pins.length,0);assert.equal(f.puts.length,0);}
 const f=fixture();for(const patch of[{actorId:'invalid'},{companyId:null},{role:'company-admin'},{key:''},{ready:false}]){f.active={ready:true,key:'valid',actorId:A,companyId:C,role:'dealer',...patch};assert.equal(f.store.context(),null);}
});

test('account or token switching during pinning/read discards late responses and never writes the new account',async()=>{
 for(const mode of['account','token']){const f=fixture(),ctx=f.store.context(),hold=deferred();f.hooks.pin=()=>hold.promise;const saved=f.store.save(ctx,'sidebar',['buy']);await tick();if(mode==='account')f.active={...f.active,actorId:B,key:'account-B'};else f.token='new-token';hold.resolve();await code(saved,'ORDER_CONTEXT_CHANGED');assert.equal(f.puts.length,0);assert.equal(f.confirmed.length,0);}
 const f=fixture(),ctx=f.store.context(),hold=deferred();f.hooks.readUser=()=>hold.promise;const reading=f.store.read(ctx,'sidebar');await tick();f.active={...f.active,companyId:D,key:'company-D'};hold.resolve(clone(f.users.get(A)));await code(reading,'ORDER_CONTEXT_CHANGED');assert.equal(f.confirmed.length,0);
});

test('the owner is checked before PUT and both response and fresh user ACK must match',async()=>{
 const wrong=fixture();wrong.hooks.readUser=()=>clone(wrong.users.get(B));await code(wrong.store.save(wrong.store.context(),'sidebar',['buy']),'ORDER_AUTH');assert.equal(wrong.puts.length,0);
 for(const mode of['put','fresh']){const f=fixture(),ctx=f.store.context();let count=0;f.hooks.readUser=()=>{count++;const user=clone(f.users.get(A));if(mode==='fresh'&&count>1)user.user_metadata[key()]={version:1,ids:['sell']};return user;};f.hooks.fetch=async call=>{Object.assign(f.users.get(A).user_metadata,call.body.data);const result=clone(f.users.get(A));if(mode==='put')result.user_metadata[key()]={version:1,ids:['sell']};return{ok:true,status:200,json:async()=>result};};await code(f.store.save(ctx,'sidebar',['buy']),'ORDER_ACK_MISMATCH');assert.equal(f.confirmed.length,0);}
});

test('late PUT ACKs cannot update the current account or invoke confirmed callbacks',async()=>{
 const f=fixture(),ctx=f.store.context(),hold=deferred();f.hooks.fetch=()=>hold.promise;const saved=f.store.save(ctx,'sidebar',['buy']);await tick();assert.equal(f.puts.length,1);f.active={...f.active,actorId:B,key:'account-B'};f.token='token-B';hold.resolve({ok:true,status:200,json:async()=>clone(f.users.get(A))});await code(saved,'ORDER_CONTEXT_CHANGED');assert.equal(f.confirmed.length,0);assert.equal(f.puts[0].init.headers.Authorization,'Bearer token-A');assert.equal(f.users.get(B).user_metadata[key()],undefined);
});

test('writes serialize, snapshot caller arrays and recover after a failed write without clobbering other keys',async()=>{
 const f=fixture(),ctx=f.store.context(),hold=deferred();let count=0;f.hooks.fetch=async(call,bound)=>{count++;if(count===1)await hold.promise;Object.assign(f.users.get(bound.actorId).user_metadata,call.body.data);return{ok:true,status:200,json:async()=>clone(f.users.get(bound.actorId))};};const order=['buy'],first=f.store.save(ctx,'sidebar',order);order.push('sell');const second=f.store.save(ctx,'sidebar',['sell']);await tick();assert.equal(f.puts.length,1);hold.resolve();await first;await second;assert.equal(f.puts.length,2);assert.deepEqual(f.puts[0].body.data[key()].ids,['buy']);assert.deepEqual(f.users.get(A).user_metadata[key()].ids,['sell']);
 f.hooks.fetch=async()=>({ok:false,status:503});await code(f.store.save(ctx,'sidebar',['buy']),'ORDER_UNAVAILABLE');delete f.hooks.fetch;await f.store.save(ctx,'sidebar',['dashboard']);assert.deepEqual(f.users.get(A).user_metadata[key()].ids,['dashboard']);assert.equal(f.users.get(A).user_metadata.unrelated,'untouched');
});

test('concurrent reads share only an in-flight request and return independent array copies',async()=>{
 const f=fixture(),ctx=f.store.context(),hold=deferred();f.users.get(A).user_metadata[key()]={version:1,ids:['buy','sell']};f.hooks.readUser=()=>hold.promise;const one=f.store.read(ctx,'sidebar'),two=f.store.read(ctx,'sidebar');await tick();assert.equal(f.reads.length,1);hold.resolve(clone(f.users.get(A)));const a=await one,b=await two;a.push('dashboard');assert.deepEqual(Array.from(b),['buy','sell']);delete f.hooks.readUser;await f.store.read(ctx,'sidebar');assert.equal(f.reads.length,2,'no persistent user or metadata cache');
});

test('invalid destinations are rejected before network and timed-out PUTs abort without confirmation',async()=>{
 for(const url of['http://synthetic.supabase.co','https://evil.example','https://synthetic.supabase.co/other','https://synthetic.supabase.co?token=bad','https://user@synthetic.supabase.co']){const f=fixture();f.hooks.url=url;await code(f.store.save(f.store.context(),'sidebar',['buy']),'ORDER_AUTH');assert.equal(f.puts.length,0);}
 const f=fixture({fastTimeout:true});let signal;f.hooks.fetch=call=>{signal=call.init.signal;return new Promise(()=>{});};await code(f.store.save(f.store.context(),'sidebar',['buy']),'ORDER_TIMEOUT');assert.equal(signal.aborted,true);assert.equal(f.confirmed.length,0);
});

test('duplicate loading keeps the public factory stable and requires no local PII cache',()=>{
 const f=fixture(),original=f.world.SnoteWorkspaceOrderStore;vm.runInNewContext(source,f.world);assert.equal(f.world.SnoteWorkspaceOrderStore,original);assert(Object.isFrozen(original));assert(Object.isFrozen(f.store));assert.equal('localStorage' in f.world,false);assert.equal('sessionStorage' in f.world,false);
});
