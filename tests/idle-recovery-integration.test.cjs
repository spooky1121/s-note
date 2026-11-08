'use strict';
// Run the shipped capture/restore paths against synthetic storage and a CAS read.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const recovery=require('../assets/idle-recovery.js');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function snoteIdleRecoveryScope(){'),html.indexOf('async function prepareLegacyAccount('));
const scrub=html.slice(html.indexOf('function scrub(o){'),html.indexOf('function cleanCustomer('));
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='33333333-3333-4333-8333-333333333333',NIL='00000000-0000-0000-0000-000000000000';
const PROJECT='https://fixture.supabase.co';
const LEGACY={finance:'zerocar-office-v182-inventory-finance-ledger',finance_limits:'zerocar-office-v157-finance-companies',prestock:'zerocar-office-v148-prestock-ledger',monthly:'zerocar-office-v165-monthly-ledger',categories:'zerocar-office-v170-monthly-category-settings'};
const clone=value=>JSON.parse(JSON.stringify(value)),alias=id=>'cld_'+id.replace(/-/g,'').slice(0,18);
function fixture({dataset='cars',owner=USER,revision=7,cached=[{id:'a',memo:'unfinished'}],server=[{id:'a',memo:'old'}],role='dealer'}={}){
 class Storage{constructor(){this.data=new Map();}getItem(key){return this.data.get(key)??null;}setItem(key,value){this.data.set(key,String(value));}removeItem(key){this.data.delete(key);}}
 const storage=new Storage(),shared=!['cars','covers'].includes(dataset),ownerId=shared?NIL:owner,key=dataset+':'+ownerId;
 const cacheKey=shared?LEGACY[dataset]:'zerocar-office-v12-'+dataset+'-'+alias(ownerId),scope={project:PROJECT,userId:USER,companyId:COMPANY};
 storage.setItem(cacheKey,JSON.stringify(cached));
 let readError=null,readHook=null;
 const rows=server===null?[]:[{company_id:COMPANY,dataset,owner_id:ownerId,payload:clone(server),revision}];
 const client={from(name){assert.equal(name,'zc_datasets');return {select(){return this;},eq(){return this;},async limit(){if(readHook)await readHook();return {data:clone(rows),error:readError};}};}};
 const S={client,user:{id:USER},company:{id:COMPANY},rpcConfig:{url:PROJECT},members:[{user_id:USER,company_id:COMPANY}],revisions:new Map([[key,revision]]),companyOwners:new Map(),queue:new Set([key]),ready:false,loading:false,conflict:false};
 const bound={...recovery,read:s=>recovery.read(s,storage),write:(s,e)=>recovery.write(s,e,storage),remove:s=>recovery.remove(s,storage)};
 const context={window:{SnoteIdleRecovery:bound},S,NIL,LEGACY,localStorage:storage,Storage,originalSet:Storage.prototype.setItem,cloudWriteEpoch:1,cloudPendingWrites:new Map(),snote220CatalogEpoch:1,
  ownerAlias:alias,isShared:ds=>!['cars','covers'].includes(ds),cloudKey:(ds,owner)=>ds+':'+(!['cars','covers'].includes(ds)?NIL:owner),
  storageKey:(ds,owner)=>['cars','covers'].includes(ds)?'zerocar-office-v12-'+ds+'-'+owner:LEGACY[ds],defaultBody:ds=>ds==='covers'?'{}':ds==='categories'?'null':'[]',
  snote221ResetIncome(){},snote220InvalidateCatalog(){context.snote220CatalogEpoch++;},snote216ResetMonthly(){},snote216InitMonthly(){},snoteCompanyActor:()=>({role,user_id:USER}),snoteCompanyOwnerRows:()=>[{user_id:USER},{user_id:OTHER}]
 };
 vm.createContext(context);vm.runInContext(scrub+source,context);
 return {S,context,rows,storage,cacheKey,key,scope,bound,cached:()=>JSON.parse(storage.getItem(cacheKey)),marker:()=>recovery.read(scope,storage),capture:()=>context.snoteIdleCaptureRecovery({client:S.client,user:S.user,company:COMPANY,epoch:context.cloudWriteEpoch}),restore:options=>context.restoreDatasets(options),setReadError:error=>readError=error,setReadHook:hook=>readHook=hook};
}
test('capture retains original cache and records metadata hashes without customer payloads',async()=>{
 const f=fixture({cached:[{id:'a',name:'Example Customer',rrn:'900101-1234567',memo:'unfinished'}]});const original=f.storage.getItem(f.cacheKey);await f.capture();
 assert.equal(f.storage.getItem(f.cacheKey),original);const marker=f.marker();assert.equal(marker.entries.length,1);assert.equal(marker.entries[0].revision,7);assert.equal(marker.entries[0].hash.length,64);
 const text=JSON.stringify(marker);for(const value of ['Example Customer','900101','unfinished','access_token','refresh_token'])assert.equal(text.includes(value),false);
});
test('same server base revision restores the pending cache and queues only its original CAS',async()=>{
 const f=fixture();await f.capture();await f.restore();assert.equal(f.cached()[0].memo,'unfinished');assert.equal(f.S.revisions.get(f.key),7);assert.equal(f.S.queue.has(f.key),true);assert.equal(f.S.conflict,false);assert.equal(f.S.idleRecoveryRetry,true);assert.equal(f.marker().entries.length,1);
});
test('matching late commit is acknowledged despite object property order and clears marker',async()=>{
 const f=fixture({cached:[{id:'a',nested:{b:2,a:1}}],server:[{nested:{a:1,b:2},id:'a'}],revision:7});await f.capture();f.rows[0].revision=8;await f.restore();assert.equal(f.S.revisions.get(f.key),8);assert.equal(f.S.queue.size,0);assert.equal(f.S.conflict,false);assert.equal(f.marker(),null);
});
test('newer conflicting server revision never replaces local cache or rebases the write',async()=>{
 const f=fixture();await f.capture();f.rows[0].revision=9;await f.restore();assert.equal(f.cached()[0].memo,'unfinished');assert.equal(f.S.revisions.get(f.key),7);assert.equal(f.S.queue.size,0);assert.equal(f.S.conflict,true);assert.equal(f.S.idleRecoveryRetry,false);assert.ok(f.marker());
});
test('cache edits after capture are preserved as a conflict instead of silently adopted',async()=>{
 const f=fixture();await f.capture();f.storage.setItem(f.cacheKey,JSON.stringify([{id:'a',memo:'newer local'}]));await f.restore();assert.equal(f.cached()[0].memo,'newer local');assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,0);assert.ok(f.marker());
});
test('failed read retains marker and cache even on explicitly requested canonical reload',async()=>{
 const f=fixture();await f.capture();const marker=JSON.stringify(f.marker());f.setReadError(Error('offline'));
 for(const options of [undefined,{discardIdleRecovery:true}]){await assert.rejects(f.restore(options),/offline/);assert.equal(JSON.stringify(f.marker()),marker);assert.equal(f.cached()[0].memo,'unfinished');}
});
test('confirmed canonical reload discards recovery only after a successful read',async()=>{
 const f=fixture();await f.capture();await f.restore({discardIdleRecovery:true});assert.equal(f.cached()[0].memo,'old');assert.equal(f.marker(),null);assert.equal(f.S.queue.size,0);assert.equal(f.S.conflict,false);
});
test('a pending in-flight write without a queue entry is included in recovery',async()=>{
 const f=fixture();f.S.queue.clear();f.context.cloudPendingWrites.set(f.key,{client:f.S.client,user:f.S.user,company:COMPANY,epoch:1,expected:7});await f.capture();assert.equal(f.marker().entries[0].revision,7);
});
test('read completion after switching accounts cannot write old data into the new context',async()=>{
 const f=fixture();await f.capture();f.setReadHook(async()=>{f.S.user={id:OTHER};});await assert.rejects(f.restore(),/CONTEXT_CHANGED/);assert.equal(f.cached()[0].memo,'unfinished');assert.ok(f.marker());
});
test('monthly caches keep all existing fields during hashing and recovery',async()=>{
 const cached=[{id:'entry',rrn:'9001011234567',amount:12500000}],f=fixture({dataset:'monthly',cached,server:cached});await f.capture();assert.equal(f.marker().entries[0].hash,await recovery.hash(f.context.snoteIdleCanonical(cached)));f.rows[0].revision=8;await f.restore();assert.deepEqual(f.cached(),cached);assert.equal(f.marker(),null);
});
test('missing first revision retries zero, while a missing established row conflicts',async()=>{
 for(const revision of [0,7]){const f=fixture({revision,server:null});await f.capture();await f.restore();assert.equal(f.cached()[0].memo,'unfinished');assert.equal(f.S.conflict,revision!==0);assert.equal(f.S.queue.has(f.key),revision===0);}
});
test('other owner recovery retains cached data without scheduling an unauthorized write',async()=>{
 const f=fixture({owner:OTHER});await f.capture();await f.restore();assert.equal(f.cached()[0].memo,'unfinished');assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,0);
});
test('corrupted marker blocks normal restore before private cache is overwritten',async()=>{
 const f=fixture();f.storage.setItem(recovery.key(f.scope),'{bad');await assert.rejects(f.restore(),/INVALID_IDLE_RECOVERY/);assert.equal(f.cached()[0].memo,'unfinished');await f.restore({discardIdleRecovery:true});assert.equal(f.cached()[0].memo,'old');assert.equal(f.marker(),null);
});
test('successful recovered CAS removes the marker so later saved edits do not become stale conflicts',async()=>{
 const f=fixture();await f.capture();await f.restore();f.S.ready=true;f.S.queue.clear();f.S.revisions.set(f.key,8);
 const scope={client:f.S.client,user:f.S.user,company:COMPANY,epoch:f.context.cloudWriteEpoch};assert.equal(await f.context.snoteIdleAcknowledgeRecovery(scope),true);assert.equal(f.marker(),null);
});
test('unchanged or still-pending revisions cannot erase an uncertain recovery marker',async()=>{
 const f=fixture();await f.capture();f.S.ready=true;f.S.queue.clear();const scope={client:f.S.client,user:f.S.user,company:COMPANY,epoch:f.context.cloudWriteEpoch};
 assert.equal(await f.context.snoteIdleAcknowledgeRecovery(scope),false);assert.ok(f.marker());f.S.revisions.set(f.key,8);f.context.cloudPendingWrites.set(f.key,{...scope,expected:7});assert.equal(await f.context.snoteIdleAcknowledgeRecovery(scope),false);assert.ok(f.marker());
});
test('new edits arriving during recovery cleanup keep the marker until their own ACK',async()=>{
 const f=fixture();await f.capture();f.S.ready=true;f.S.queue.clear();f.S.revisions.set(f.key,8);const hash=f.bound.hash;let first=true;
 f.bound.hash=async raw=>{if(first){first=false;f.S.queue.add(f.key);}return hash(raw);};
 assert.equal(await f.context.snoteIdleAcknowledgeRecovery({client:f.S.client,user:f.S.user,company:COMPANY,epoch:f.context.cloudWriteEpoch}),false);assert.ok(f.marker());
});
test('detached old flush completion cannot clear the new session saving state',async()=>{
 const f=fixture(),c=f.context;Object.assign(c,{cloudFlushTask:null,parsePayload:JSON.parse,showStatus(){},errMsg:error=>String(error?.message||error),fail(){},alert(){},clearTimeout(){},console});
 vm.runInContext(html.slice(html.indexOf('function cloudSamePayload('),html.indexOf('async function ensureConnection(')),c);
 let oldResolve,newResolve;const oldRpc=new Promise(resolve=>oldResolve=resolve),newRpc=new Promise(resolve=>newResolve=resolve);
 f.S.ready=true;f.S.client.rpc=()=>oldRpc;const first=c.flush();assert.equal(f.S.saving,true);
 c.cloudWriteEpoch++;c.cloudFlushTask=null;c.cloudPendingWrites.clear();f.S.queue.add(f.key);f.S.client={rpc:()=>newRpc};f.S.user={id:USER};const second=c.flush();
 oldResolve({data:8,error:null});assert.equal((await first).ok,false);assert.equal(f.S.saving,true);newResolve({data:8,error:null});assert.equal((await second).ok,true);assert.equal(f.S.saving,false);
});
