'use strict';
// Exercise the shipped queue and Storage hook with an offline CAS server. No
// credentials, production accounts, or network requests are used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const between=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const source=between('const originalSet=Storage.prototype.setItem;','async function ensureConnection(');
const scrub=between('function scrub(o){','function cleanCustomer(');
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const COMPANY='company-a',OWNER='owner-a',KEY='cars:'+OWNER,STORAGE='cars-'+OWNER;
function fixture({dataset='cars',initial=[{id:'car-a',status:'판매완료',soldAt:'2026-11-07',soldPrice:25000000,nested:{b:2,a:1}}],revision=7}={}){
 class Storage{constructor(){this.values=new Map();}getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}}
 const storage=new Storage(),row={company_id:COMPANY,dataset,owner_id:OWNER,payload:clone(initial),revision};
 const calls=[],reads=[],alerts=[],failures=[],statuses=[];let mode='ok',readMode='ok',hold=null;
 const S={client:null,user:{id:'actor-a'},company:{id:COMPANY},ready:true,loading:false,revisions:new Map([[dataset+':'+OWNER,revision]]),queue:new Set(),saving:false,conflict:false};
 const client={from(table){assert.equal(table,'zc_datasets');const filters={};
  const read=async single=>{
   reads.push({...filters});assert.deepEqual(filters,single?{company_id:COMPANY,dataset,owner_id:OWNER}:{company_id:COMPANY});
   if(hold?.kind==='read'){const waiting=hold;hold=null;waiting.entered.resolve();await waiting.release.promise;}
   if(readMode==='error')return {data:null,error:{message:'read offline'}};
   if(readMode==='throw')throw Error('read connection lost');
   if(readMode==='missing')return {data:single?null:[],error:null};
   return {data:single?clone(row):[clone(row)],error:null};
  };
  return {select(value){assert.equal(value,'company_id,dataset,owner_id,payload,revision');return this;},eq(k,v){filters[k]=v;return this;},limit(){return this;},maybeSingle(){return read(true);},then(resolve,reject){return read(false).then(resolve,reject);}};
 },async rpc(name,args){
  assert.equal(name,'zc_write_dataset');assert.equal(args.p_company,COMPANY);assert.equal(args.p_dataset,dataset);assert.equal(args.p_owner,OWNER);
  calls.push(clone(args));
  if(hold?.kind==='write'){const waiting=hold;hold=null;waiting.entered.resolve();await waiting.release.promise;}
  if(mode==='fail')return {error:{message:'offline'}};
  if(mode==='throw-before')throw Error('connection lost before commit');
  if(args.p_expected!==row.revision)return {error:{message:'CONFLICT'}};
  row.payload=clone(args.p_payload);row.revision++;
  if(mode==='lose')return {data:null,error:{message:'response lost'}};
  if(mode==='throw-after')throw Error('connection lost after commit');
  return {data:mode==='invalid'?'bad-revision':row.revision,error:null};
 }};S.client=client;
 const context={S,Storage,localStorage:storage,LEGACY:{monthly:STORAGE},ownerAlias:value=>value,cloudKey:(ds,owner)=>ds+':'+owner,
  storageKey:()=>STORAGE,toEntry:()=>({ds:dataset,owner:OWNER}),isShared:()=>dataset==='monthly',defaultBody:()=> '[]',parsePayload:JSON.parse,
  showStatus:value=>statuses.push(value),errMsg:error=>error.message,fail:error=>failures.push(error.message),alert:value=>alerts.push(value),
  setTimeout:()=>1,clearTimeout(){}};
 storage.setItem(STORAGE,JSON.stringify(initial));vm.createContext(context);vm.runInContext(scrub+source,context);
 return {S,row,storage,calls,reads,alerts,failures,statuses,context,setMode(value){mode=value;},setReadMode(value){readMode=value;},
  write(payload){storage.setItem(STORAGE,JSON.stringify(payload));},flush:()=>context.flush(),
  hold(kind){hold={kind,entered:deferred(),release:deferred()};return hold;}};
}
const edited=()=>[{id:'car-a',status:'판매중',nested:{b:2,a:1}}];
for(const mode of ['lose','throw-after','invalid'])test(`lost or invalid ACK (${mode}) rechecks canonical data without a duplicate write`,async()=>{
 const f=fixture();f.write(edited());f.setMode(mode);
 assert.equal((await f.flush()).ok,false);assert.equal(f.S.queue.size,1);assert.equal(f.row.revision,8);assert.equal(f.S.revisions.get(KEY),7);
 f.setMode('ok');assert.equal((await f.flush()).ok,true);
 assert.equal(f.reads.length,1);assert.equal(f.calls.length,1);assert.equal(f.S.revisions.get(KEY),8);assert.equal(f.S.queue.size,0);assert.equal(f.S.conflict,false);assert.equal(f.alerts.length,0);
});
for(const mode of ['fail','throw-before'])test(`uncommitted write (${mode}) is retained and retried at its original revision`,async()=>{
 const f=fixture();f.write(edited());f.setMode(mode);assert.equal((await f.flush()).ok,false);assert.equal(f.S.queue.size,1);
 f.setMode('ok');assert.equal((await f.flush()).ok,true);assert.deepEqual(f.calls.map(call=>call.p_expected),[7,7]);assert.equal(f.row.revision,8);
});
test('new local edits after a lost response use the recovered revision and preserve all fields',async()=>{
 const f=fixture();f.write(edited());f.setMode('lose');await f.flush();const next=[...edited(),{id:'car-b',memo:'keep me'}];f.write(next);f.setMode('ok');
 assert.equal((await f.flush()).ok,true);assert.deepEqual(f.calls.map(call=>call.p_expected),[7,8]);assert.deepEqual(f.row.payload,next);assert.equal(f.row.revision,9);
});
test('edits during the recovery read are not overwritten or written twice',async()=>{
 const f=fixture();f.write(edited());f.setMode('lose');await f.flush();f.setMode('ok');const hold=f.hold('read'),pending=f.flush();await hold.entered.promise;
 const next=[...edited(),{id:'car-b',memo:'edited while reading'}];f.write(next);hold.release.resolve();assert.equal((await pending).ok,true);
 assert.deepEqual(f.calls.map(call=>call.p_expected),[7,8]);assert.deepEqual(f.row.payload,next);
});
test('equivalent JSON object key ordering recovers, while arrays stay ordered',async()=>{
 const f=fixture();f.write(edited());f.setMode('lose');await f.flush();f.row.payload=[{nested:{a:1,b:2},status:'판매중',id:'car-a'}];f.setMode('ok');
 assert.equal((await f.flush()).ok,true);assert.equal(f.calls.length,1);
 const different=fixture({initial:[{id:'a'},{id:'b'}]});different.write([{id:'b'},{id:'a'}]);different.setMode('lose');await different.flush();different.row.payload.reverse();
 assert.equal((await different.flush()).ok,false);assert.equal(different.S.conflict,true);
});
for(const change of [f=>{f.row.payload[0].memo='another device';},f=>{f.row.revision++;},f=>{f.row.revision=10;f.row.payload=edited();}])test('a different or newer server write is a real conflict and is never overwritten',async()=>{
 const f=fixture();f.write(edited());f.setMode('lose');await f.flush();change(f);const before=clone(f.row);f.setMode('ok');
 assert.equal((await f.flush()).ok,false);assert.equal(f.S.conflict,true);assert.equal(f.alerts.length,1);assert.equal(f.calls.length,1);assert.deepEqual(f.row,before);assert.equal(f.S.queue.size,1);
});
for(const mode of ['error','throw'])test(`failed reconciliation read (${mode}) preserves retry state without a false conflict`,async()=>{
 const f=fixture();f.write(edited());f.setMode('lose');await f.flush();f.setMode('ok');f.setReadMode(mode);
 assert.equal((await f.flush()).ok,false);assert.equal(f.S.queue.size,1);assert.equal(f.S.conflict,false);assert.equal(f.calls.length,1);
 f.setReadMode('ok');assert.equal((await f.flush()).ok,true);assert.equal(f.calls.length,1);
});
test('missing initial row can retry revision zero, but missing an established row is a conflict',async()=>{
 const f=fixture({revision:0});f.write(edited());f.setMode('fail');await f.flush();f.setReadMode('missing');f.setMode('ok');assert.equal((await f.flush()).ok,true);assert.deepEqual(f.calls.map(call=>call.p_expected),[0,0]);
 const existing=fixture();existing.write(edited());existing.setMode('lose');await existing.flush();existing.setReadMode('missing');assert.equal((await existing.flush()).ok,false);assert.equal(existing.S.conflict,true);
});
test('malformed or wrong-scope recovery responses cannot acknowledge a write',async()=>{
 for(const change of [f=>f.row.company_id='other',f=>f.row.owner_id='other',f=>f.row.dataset='covers',f=>f.row.revision='8',f=>f.row.revision=-1]){
  const f=fixture();f.write(edited());f.setMode('lose');await f.flush();change(f);assert.equal((await f.flush()).ok,false);assert.equal(f.S.revisions.get(KEY),7);assert.equal(f.calls.length,1);
 }
});
test('normal overlapping flush calls share a single RPC and newer queued edits drain afterward',async()=>{
 const f=fixture(),hold=f.hold('write');f.write(edited());const first=f.flush();await hold.entered.promise;const second=f.flush();const next=[...edited(),{id:'car-b'}];f.write(next);hold.release.resolve();
 assert.equal((await first).ok,true);assert.equal((await second).ok,true);assert.deepEqual(f.calls.map(call=>call.p_expected),[7,8]);assert.deepEqual(f.row.payload,next);
});
test('late ACK or recovery results after an account/company/client change cannot change local revision',async()=>{
 for(const kind of ['write','read'])for(const change of [f=>f.S.user={id:'other'},f=>f.S.company={id:'other'},f=>f.S.client={},f=>f.S.ready=false]){
  const f=fixture();f.write(edited());if(kind==='read'){f.setMode('lose');await f.flush();f.setMode('ok');}
  const hold=f.hold(kind),pending=f.flush();await hold.entered.promise;change(f);hold.release.resolve();assert.equal((await pending).ok,false);assert.equal(f.S.revisions.get(KEY),7);assert.equal(f.statuses.includes('● 모든 변경사항 서버 저장 완료'),false);
 }
});
test('shared monthly payloads use their existing storage key and recover without scrubbing',async()=>{
 const f=fixture({dataset:'monthly',initial:[{note:'1234567890123',amount:10}]});const next=[{note:'1234567890123',amount:20}];f.write(next);f.setMode('lose');await f.flush();f.setMode('ok');assert.equal((await f.flush()).ok,true);assert.deepEqual(f.row.payload,next);assert.equal(f.calls.length,1);
});
test('invalid monthly format remains queued and never reaches the server',async()=>{
 const f=fixture({dataset:'monthly'});f.write({invalid:true});assert.equal((await f.flush()).ok,false);assert.equal(f.S.queue.size,1);assert.equal(f.calls.length,0);
});
test('normal writes retain scrubbing and never include unrelated sensitive fields in recovery snapshots',async()=>{
 const f=fixture();f.write([{id:'car-a',rrn:'123456-1234567',memo:'1234561234567'}]);f.setMode('lose');await f.flush();assert.deepEqual(f.calls[0].p_payload,[{id:'car-a',memo:''}]);f.setMode('ok');assert.equal((await f.flush()).ok,true);
});

for(const newer of [false,true])test(`a timed-out original write committing after readback is recovered before CAS conflict (${newer?'newer local edit':'same payload'})`,async()=>{
 const f=fixture(),original=edited(),next=[...original,{id:'car-b',memo:'newer unsaved edit'}];f.write(original);
 const realRpc=f.S.client.rpc;let attempts=0;
 f.S.client.rpc=async(name,args)=>{
  attempts++;
  if(attempts===1)return {data:null,error:{message:'request timed out before server finished'}};
  if(attempts===2){assert.equal(args.p_expected,7);f.row.payload=clone(original);f.row.revision=8;return {data:null,error:{message:'CONFLICT'}};}
  return realRpc(name,args);
 };
 assert.equal((await f.flush()).ok,false);if(newer)f.write(next);
 assert.equal((await f.flush()).ok,true);assert.equal(f.S.conflict,false);assert.equal(f.alerts.length,0);assert.equal(f.S.queue.size,0);
 assert.equal(f.S.revisions.get(KEY),newer?9:8);assert.deepEqual(f.row.payload,newer?next:original);assert.equal(attempts,newer?3:2);assert.equal(f.reads.length,2);
 if(newer)assert.equal(f.calls[0].p_expected,8);
});
test('all unconfirmed snapshots at one revision remain recoverable after additional failed attempts',async()=>{
 const f=fixture(),original=edited(),next=[...original,{id:'car-b'}];f.write(original);f.setMode('fail');await f.flush();f.write(next);await f.flush();
 f.row.payload=original;f.row.revision=8;f.setMode('ok');assert.equal((await f.flush()).ok,true);assert.equal(f.S.conflict,false);assert.deepEqual(f.row.payload,next);assert.equal(f.calls.at(-1).p_expected,8);
});
test('readback after CAS conflict cannot overwrite a genuinely different late commit',async()=>{
 const f=fixture();f.write(edited());let attempts=0;f.S.client.rpc=async()=>{
  if(++attempts===1)return {error:{message:'timeout'}};
  f.row.revision=8;f.row.payload=[{id:'car-a',memo:'another device'}];return {error:{message:'CONFLICT'}};
 };
 await f.flush();assert.equal((await f.flush()).ok,false);assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,1);assert.equal(attempts,2);assert.equal(f.row.payload[0].memo,'another device');
});
test('unavailable readback after a retry CAS conflict stays pending without a false conflict flag',async()=>{
 const f=fixture(),original=edited();f.write(original);let attempts=0;
 f.S.client.rpc=async()=>{if(++attempts===1)return {error:{message:'timeout'}};f.row.payload=original;f.row.revision=8;f.setReadMode('error');return {error:{message:'CONFLICT'}};};
 await f.flush();assert.equal((await f.flush()).ok,false);assert.equal(f.S.conflict,false);assert.equal(f.S.queue.size,1);f.setReadMode('ok');assert.equal((await f.flush()).ok,true);assert.equal(attempts,2);
});
test('only a numeric integer ACK at the next revision can confirm an RPC result',async()=>{
 for(const data of [[8],'8',true,false,null,{},NaN,Infinity,8.5,7,9]){
  const f=fixture({revision:data===true?0:7});f.write(edited());f.S.client.rpc=async()=>({data,error:null});assert.equal((await f.flush()).ok,false);assert.equal(f.S.queue.size,1);assert.equal(f.S.revisions.get(KEY),data===true?0:7);assert.equal(f.S.conflict,false);
 }
});
test('a canonical restore epoch rejects stale ACKs even for the same authenticated identity',async()=>{
 const f=fixture(),hold=f.hold('write');f.write(edited());const pending=f.flush();await hold.entered.promise;vm.runInContext('cloudWriteEpoch++',f.context);hold.release.resolve();assert.equal((await pending).ok,false);assert.equal(f.S.revisions.get(KEY),7);assert.equal(f.S.queue.size,0);
});

function withActualRestore(f){
 const c=f.context;Object.assign(c,{
  LEGACY:{},NIL:'nil',currentUser:{username:OWNER},route:'sell',snote220CatalogEpoch:1,
  storageKey:(dataset,owner)=>dataset+'-'+owner,
  snote221ResetIncome(){},snote220InvalidateCatalog(){c.snote220CatalogEpoch++;},snote216ResetMonthly(){},snote216InitMonthly(){},
  snoteCompanyActor:()=>({role:'dealer'}),snoteCompanyOwnerRows:()=>[{user_id:OWNER}],
  snoteEncarLinksReset(){},snoteRefreshSalesOverview(){},snoteStartAccessTracking(){},snote220RefreshTaxonomy:async()=>{},
  confirm:()=>true,loadCarsForUser(){},loadCovers(){},refreshMedia:async()=>{},buildStats(){},navigate(){},window:{}
 });f.S.companyOwners=new Map();f.S.members=[];
 vm.runInContext(between('async function restoreDatasets(){','async function prepareLegacyAccount(')+between('async function reload(){if(!S.ready)return;',"status.addEventListener('click',reload);"),c);
 return f;
}
for(const mode of ['lose','fail'])test(`actual failed reload preserves pending ${mode} write and newer edits remain retryable`,async()=>{
 const f=withActualRestore(fixture());f.write(edited());f.setMode(mode);await f.flush();f.setReadMode('error');await f.context.reload();
 assert.equal(f.S.ready,true);assert.equal(f.S.queue.has(KEY),true);assert.equal(f.S.conflict,false);assert.equal(f.S.revisions.get(KEY),7);
 const next=[...edited(),{id:'car-b',memo:'edited after failed refresh'}];f.write(next);f.setMode('ok');f.setReadMode('ok');assert.equal((await f.flush()).ok,true);
 assert.deepEqual(f.row.payload,next);assert.equal(f.S.queue.size,0);assert.equal(f.S.conflict,false);assert.equal(f.calls.at(-1).p_expected,mode==='lose'?8:7);
});
test('actual failed reload requeues an unsent edit without manufacturing an acknowledged save',async()=>{
 const f=withActualRestore(fixture());f.write(edited());f.setReadMode('error');await f.context.reload();assert.equal(f.S.queue.has(KEY),true);assert.equal(f.calls.length,0);assert.equal(f.S.revisions.get(KEY),7);
 f.setReadMode('ok');assert.equal((await f.flush()).ok,true);assert.deepEqual(f.row.payload,edited());
});
test('actual failed reload keeps a real conflict unresolved until canonical reload succeeds',async()=>{
 const f=withActualRestore(fixture());f.write(edited());f.S.conflict=true;f.setReadMode('error');await f.context.reload();assert.equal(f.S.conflict,true);assert.equal(f.S.queue.has(KEY),true);assert.equal((await f.flush()).ok,false);assert.equal(f.calls.length,0);
 f.setReadMode('ok');await f.context.reload();assert.equal(f.S.conflict,false);assert.equal(f.S.queue.size,0);assert.equal(f.S.revisions.get(KEY),7);assert.deepEqual(JSON.parse(f.storage.getItem(STORAGE)),f.row.payload);
});
test('actual successful reload clears old recovery snapshots and later edits use the canonical revision',async()=>{
 const f=withActualRestore(fixture());f.write(edited());f.setMode('lose');await f.flush();f.setMode('ok');await f.context.reload();assert.equal(f.S.queue.size,0);assert.equal(f.S.revisions.get(KEY),8);assert.equal(vm.runInContext('cloudPendingWrites.size',f.context),0);
 const next=[...edited(),{id:'car-b'}];f.write(next);const reads=f.reads.length;assert.equal((await f.flush()).ok,true);assert.equal(f.reads.length,reads);assert.equal(f.calls.at(-1).p_expected,8);assert.deepEqual(f.row.payload,next);
});
test('actual reload drains an in-flight write and preserves its uncertain result if refresh fails',async()=>{
 const f=withActualRestore(fixture()),hold=f.hold('write');f.write(edited());const saving=f.flush();await hold.entered.promise;f.setReadMode('error');const refreshing=f.context.reload();assert.equal(f.S.ready,false);hold.release.resolve();await saving;await refreshing;
 assert.equal(f.S.queue.has(KEY),true);assert.equal(f.S.ready,true);assert.equal(f.S.revisions.get(KEY),7);f.setReadMode('ok');assert.equal((await f.flush()).ok,true);assert.equal(f.S.revisions.get(KEY),8);assert.equal(f.calls.length,1);
});
test('successful restore invalidates a stale same-account in-flight ACK before it can replace canonical revision',async()=>{
 const f=withActualRestore(fixture()),hold=f.hold('write');f.write(edited());const pending=f.flush();await hold.entered.promise;f.S.ready=false;await f.context.restoreDatasets();f.S.ready=true;hold.release.resolve();assert.equal((await pending).ok,false);assert.equal(f.S.revisions.get(KEY),7);
});
test('a failed old-account reload cannot requeue its edits into a newly selected account',async()=>{
 const f=withActualRestore(fixture());f.write(edited());f.setMode('lose');await f.flush();const hold=f.hold('read');f.setReadMode('error');const pending=f.context.reload();await hold.entered.promise;f.S.user={id:'new-actor'};hold.release.resolve();await pending;assert.equal(f.S.queue.size,0);assert.equal(f.S.ready,false);
});
