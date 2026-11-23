'use strict';
// Executes shipped inline scope/capture/restore/ACK paths. Every company, payload
// and response below is synthetic; no external request or production write occurs.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{resolve}=require('node:path');
const recovery=require('../assets/idle-recovery.js');
const compat=require('../assets/snote-storage-compat.js');
const html=readFileSync(resolve(__dirname,'../index.html'),'utf8');
const helpers=html.slice(html.indexOf('// Read company settings from the authenticated dataset snapshot'),html.indexOf('function snoteCompanyActor(){'));
const actor=html.match(/^function snoteCompanyActor\(\).*$/m)[0];
const purchaseContext=html.match(/^function snoteCompanyPurchaseContext\(\)\{[\s\S]*?^}/m)[0];
const datasetRaw=html.match(/^function snote184DatasetRaw\(dataset,owner\)\{[\s\S]*?^}/m)[0];
const scrub=html.slice(html.indexOf('function scrub(o){'),html.indexOf('function cleanCustomer('));
const shipped=html.slice(html.indexOf('function snoteIdleRecoveryScope(){'),html.indexOf('async function prepareLegacyAccount('));
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const COMPANY='33333333-3333-4333-8333-333333333333',OTHER_COMPANY='44444444-4444-4444-8444-444444444444';
const NIL='00000000-0000-0000-0000-000000000000',PROJECT='https://fixture.supabase.co';
const LEGACY={finance:'s-note-office-v182-inventory-finance-ledger',finance_limits:'s-note-office-v157-finance-companies',prestock:'s-note-office-v148-prestock-ledger',monthly:'s-note-office-v165-monthly-ledger',categories:'s-note-office-v170-monthly-category-settings'};
const alias=id=>'cld_'+id.replace(/-/g,'').slice(0,18),copy=value=>JSON.parse(JSON.stringify(value));
const OWN=[{id:'synthetic-own-finance',loan:3500000}],FOREIGN=[{id:'synthetic-other-finance',loan:9000000}],SERVER=[{id:'synthetic-own-server-base',loan:4000000}];
function fixture({dataset='finance',role='admin',revision=7,owned=OWN,server=SERVER}={}){
 class Storage{constructor(){this.data=new Map();}getItem(key){return this.data.get(key)??null;}setItem(key,value){this.data.set(key,String(value));}removeItem(key){this.data.delete(key);}}
 const storage=new Storage(),scope={project:PROJECT,userId:USER,companyId:COMPANY},key=dataset+':'+NIL,cacheKey=LEGACY[dataset];
 storage.setItem(cacheKey,JSON.stringify(owned));let readHook=null;
 const rows=server===null?[]:[{company_id:COMPANY,dataset,owner_id:NIL,payload:copy(server),revision}];
 const client={from(name){assert.equal(name,'zc_datasets');const filters={};const result=()=>rows.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));return{select(){return this;},eq(k,v){filters[k]=v;return this;},async limit(){assert.equal(filters.company_id,COMPANY);if(readHook)await readHook();return{data:copy(result()),error:null};},async maybeSingle(){assert.equal(filters.company_id,COMPANY);if(readHook)await readHook();const found=result();assert(found.length<=1,'The synthetic shared-row lookup uses the real unique company/dataset/owner key');return{data:copy(found[0]??null),error:null};}};}};
 const S={client,user:{id:USER},company:{id:COMPANY},rpcConfig:{url:PROJECT},members:[{user_id:USER,company_id:COMPANY,role,active:true}],revisions:new Map([[key,revision]]),companyOwners:new Map(),queue:new Set([key]),ready:true,loading:false,conflict:false};
 const currentUser={username:alias(USER),role};
 const bound={...recovery,read:s=>recovery.read(s,storage),write:(s,e)=>recovery.write(s,e,storage),remove:s=>recovery.remove(s,storage)};
 const context={window:{SnoteIdleRecovery:bound,SnoteStorageCompat:compat},SnoteStorageCompat:compat,S,currentUser,SNOTE203_META:'_snote203_meta',NIL,LEGACY,localStorage:storage,Storage,originalSet:Storage.prototype.setItem,
  snote220CatalogEpoch:1,cloudWriteEpoch:1,cloudPendingWrites:new Map(),ownerAlias:alias,
  parsePayload:raw=>{try{return JSON.parse(raw);}catch{return null;}},isShared:ds=>!['cars','covers'].includes(ds),
  cloudKey:(ds,owner)=>ds+':'+(!['cars','covers'].includes(ds)?NIL:owner),storageKey:(ds,owner)=>['cars','covers'].includes(ds)?'s-note-office-v12-'+ds+'-'+owner:LEGACY[ds],
  defaultBody:ds=>ds==='covers'?'{}':ds==='categories'?'null':'[]',snote221ResetIncome(){},snote220InvalidateCatalog(){context.snote220CatalogEpoch++;},snote216ResetMonthly(){},snote216InitMonthly(){},snoteCompanyOwnerRows:()=>[{user_id:USER}]
 };
 vm.createContext(context);vm.runInContext(helpers+'\n'+actor+'\n'+purchaseContext+'\n'+datasetRaw+'\n'+scrub+shipped,context);
 const adopt=value=>dataset==='finance'?context.snote184CaptureFinanceLedger(value):dataset==='prestock'?context.snote184CapturePrestockLedger(value):context.snote184CaptureFinanceSettings(value);
 if(owned!==null)adopt(owned);
 const bridge=()=>dataset==='finance'?context.window.snoteInventoryFinanceLedgerBridge:dataset==='prestock'?context.window.snotePrestockLedgerBridge:context.window.snotePrestockSettingsBridge;
 const callScope=()=>({client:S.client,user:S.user,company:S.company?.id,epoch:context.cloudWriteEpoch});
 return{S,currentUser,context,storage,rows,key,cacheKey,scope,bound,adopt,bridge,callScope,
  raw:()=>context.snote184DatasetRaw(dataset,NIL),capture:()=>context.snoteIdleCaptureRecovery(callScope()),restore:options=>context.restoreDatasets(options),
  marker:()=>recovery.read(scope,storage),overwriteRaw:()=>storage.setItem(cacheKey,JSON.stringify(FOREIGN)),setReadHook:hook=>readHook=hook,
  async legacyMarker(payload=OWN){bound.write(scope,[{dataset,ownerId:NIL,storageKey:cacheKey,revision,hash:await recovery.hash(context.snoteIdleCanonical(payload))}]);}
 };
}
for(const dataset of ['finance','finance_limits','prestock']){
 test(dataset+': confirmed snapshot ignores shared raw-cache replacement and returns copies',()=>{
  const f=fixture({dataset});f.overwriteRaw();assert.deepEqual(JSON.parse(f.raw()),OWN);
  const exposed=f.bridge().rows();exposed[0].loan=1;assert.deepEqual(JSON.parse(f.raw()),OWN);
 });
 test(dataset+': company/user/client/role/readiness mismatches block payload access',()=>{
  for(const mutate of [f=>f.S.company={id:OTHER_COMPANY},f=>f.S.user={id:OTHER},f=>f.S.user={id:USER},f=>f.S.client={},f=>f.S.ready=false,f=>f.S.loading=true,f=>f.S.members[0].active=false,f=>f.currentUser.role='dealer',f=>{f.currentUser.role='dealer';f.S.members[0].role='dealer';}]){
   const f=fixture({dataset});mutate(f);assert.equal(f.bridge().rows(),null);assert.throws(()=>f.raw(),/CONTEXT_CHANGED/);
  }
  const f=fixture({dataset,role:'accountant'});assert.deepEqual(JSON.parse(f.raw()),OWN);
 });
 test(dataset+': capture hashes own memory body even with foreign cache and a pending CAS',async()=>{
  const f=fixture({dataset});f.overwriteRaw();f.S.queue.clear();f.context.cloudPendingWrites.set(f.key,{...f.callScope(),expected:7,payloads:[copy(OWN)]});
  assert.equal(await f.capture(),true);const marker=f.marker();assert.equal(marker.entries[0].hash,await recovery.hash(f.context.snoteIdleCanonical(OWN)));
  assert.notEqual(marker.entries[0].hash,await recovery.hash(f.context.snoteIdleCanonical(FOREIGN)));
  assert.deepEqual(JSON.parse(f.storage.getItem(f.cacheKey)),FOREIGN);assert(!JSON.stringify(marker).includes('synthetic-own-finance'));
 });
 test(dataset+': owned pending body retries its original base and never adopts foreign raw cache',async()=>{
  const f=fixture({dataset});await f.capture();f.overwriteRaw();f.S.ready=false;await f.restore();f.S.ready=true;
  assert.equal(f.S.conflict,false);assert.equal(f.S.queue.has(f.key),true);assert.equal(f.S.revisions.get(f.key),7);assert.deepEqual(JSON.parse(f.raw()),OWN);
  assert.deepEqual(JSON.parse(f.storage.getItem(f.cacheKey)),FOREIGN);
 });
 test(dataset+': legacy marker without a trusted body conflicts instead of replaying shared cache',async()=>{
  const f=fixture({dataset,owned:null});await f.legacyMarker();f.overwriteRaw();await f.restore();
  assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,0);assert.ok(f.marker());assert.deepEqual(JSON.parse(f.raw()),SERVER);
  assert.deepEqual(JSON.parse(f.storage.getItem(f.cacheKey)),FOREIGN);
 });
 test(dataset+': missing owned body can acknowledge an exact authorized server commit',async()=>{
  const f=fixture({dataset,owned:null,server:OWN,revision:8});await f.legacyMarker();f.overwriteRaw();await f.restore();
  assert.equal(f.S.conflict,false);assert.equal(f.S.queue.size,0);assert.equal(f.marker(),null);assert.deepEqual(JSON.parse(f.raw()),OWN);
 });
 test(dataset+': conflicting owned edit stays readable without trusting the foreign raw cache',async()=>{
  const f=fixture({dataset});await f.capture();const edit=[{id:'synthetic-own-newer-edit',loan:2500000}];f.adopt(edit);f.overwriteRaw();await f.restore();
  assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,0);assert.ok(f.marker());assert.deepEqual(JSON.parse(f.raw()),edit);
 });
 test(dataset+': current successful newer own CAS clears an older marker even when hashes differ',async()=>{
  const f=fixture({dataset});await f.capture();const edit=[{id:'synthetic-own-confirmed-edit',loan:2000000}];f.adopt(edit);f.overwriteRaw();f.S.queue.clear();f.S.revisions.set(f.key,8);
  assert.equal(await f.context.snoteIdleAcknowledgeRecovery(f.callScope()),true);assert.equal(f.marker(),null);assert.deepEqual(JSON.parse(f.raw()),edit);
 });
 test(dataset+': missing trusted snapshot cannot capture a foreign legacy cache as own recovery',async()=>{
  const f=fixture({dataset,owned:null});f.overwriteRaw();await assert.rejects(f.capture(),/CONTEXT_CHANGED/);assert.equal(f.marker(),null);
 });
 test(dataset+': expired snapshot epoch cannot authorize a pending legacy retry',async()=>{
  const f=fixture({dataset});await f.capture();f.context.snote220CatalogEpoch++;f.overwriteRaw();await f.restore();
  assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,0);assert.ok(f.marker());assert.deepEqual(JSON.parse(f.raw()),SERVER);
 });
 test(dataset+': edits arriving during an ACK hash keep the marker until their own save',async()=>{
  const f=fixture({dataset});await f.capture();f.S.queue.clear();f.S.revisions.set(f.key,8);const hash=f.bound.hash;let once=true;
  f.bound.hash=async value=>{if(once){once=false;f.adopt([{id:'synthetic-own-unsaved-edit',loan:1500000}]);}return hash(value);};
  assert.equal(await f.context.snoteIdleAcknowledgeRecovery(f.callScope()),false);assert.ok(f.marker());
 });
 test(dataset+': actor switch during a held server read cannot capture an old company body',async()=>{
  const f=fixture({dataset});await f.capture();f.overwriteRaw();f.setReadHook(async()=>{f.S.user={id:OTHER};});
  await assert.rejects(f.restore(),/CONTEXT_CHANGED/);assert.equal(f.bridge().rows(),null);assert.ok(f.marker());assert.deepEqual(JSON.parse(f.storage.getItem(f.cacheKey)),FOREIGN);
 });
 test(dataset+': actor switch during capture hash cannot write a marker for another actor',async()=>{
  const f=fixture({dataset}),hash=f.bound.hash;let once=true;f.bound.hash=async value=>{if(once){once=false;f.S.user={id:OTHER};}return hash(value);};
  await assert.rejects(f.capture(),/CONTEXT_CHANGED/);assert.equal(f.marker(),null);
 });
 test(dataset+': actor switch during ACK cannot remove the original recovery marker',async()=>{
  const f=fixture({dataset});await f.capture();f.S.queue.clear();f.S.revisions.set(f.key,8);const scope=f.callScope(),hash=f.bound.hash;let once=true;
  f.bound.hash=async value=>{if(once){once=false;f.S.user={id:OTHER};}return hash(value);};
  assert.equal(await f.context.snoteIdleAcknowledgeRecovery(scope),false);assert.ok(f.marker());
 });
}
for(const dataset of ['finance','finance_limits','prestock'])test(dataset+': catalog epoch invalidates an otherwise identical authenticated snapshot',()=>{
 const f=fixture({dataset});f.context.snote220CatalogEpoch++;assert.equal(f.bridge().rows(),null);assert.throws(()=>f.raw(),/CONTEXT_CHANGED/);
});

for(const dataset of ['finance','finance_limits','prestock']){
 test(dataset+': previous-format metadata retries bound memory without reading or copying an unscoped alias',async()=>{
  const f=fixture({dataset}),previous=compat.legacyKey(f.cacheKey),entry={dataset,ownerId:NIL,storageKey:previous,revision:7,hash:await recovery.hash(f.context.snoteIdleCanonical(OWN))};
  f.bound.write(f.scope,[entry]);f.storage.setItem(previous,JSON.stringify(FOREIGN));f.overwriteRaw();
  const get=f.storage.getItem.bind(f.storage);f.storage.getItem=key=>{assert.notEqual(key,previous,'Previous raw finance is never recovery authority');return get(key);};
  await f.restore();assert.equal(f.S.conflict,false);assert.equal(f.S.queue.has(f.key),true);assert.deepEqual(JSON.parse(f.raw()),OWN);
  assert.deepEqual(JSON.parse(f.storage.data.get(previous)),FOREIGN);assert.deepEqual(JSON.parse(f.storage.getItem(f.cacheKey)),FOREIGN);assert.equal(f.marker().entries[0].storageKey,previous);
 });
 test(dataset+': an exact authorized server ACK does not inspect an unscoped previous alias',async()=>{
  const f=fixture({dataset,owned:null,server:OWN,revision:8}),previous=compat.legacyKey(f.cacheKey);
  f.bound.write(f.scope,[{dataset,ownerId:NIL,storageKey:previous,revision:7,hash:await recovery.hash(f.context.snoteIdleCanonical(OWN))}]);
  f.storage.setItem(previous,JSON.stringify(FOREIGN));const get=f.storage.getItem.bind(f.storage);f.storage.getItem=key=>{assert.notEqual(key,previous);return get(key);};
  await f.restore();assert.equal(f.S.conflict,false);assert.equal(f.S.queue.size,0);assert.equal(f.marker(),null);assert.deepEqual(JSON.parse(f.raw()),OWN);assert.deepEqual(JSON.parse(f.storage.data.get(previous)),FOREIGN);
 });
 test(dataset+': primary deletion vetoes an old alias ACK without adopting or queueing any raw financial data',async()=>{
  const f=fixture({dataset,owned:null,server:OWN,revision:8}),previous=compat.legacyKey(f.cacheKey);
  f.bound.write(f.scope,[{dataset,ownerId:NIL,storageKey:previous,revision:7,hash:await recovery.hash(f.context.snoteIdleCanonical(OWN))}]);
  f.storage.removeItem(f.cacheKey);f.storage.setItem(compat.markerKey(f.cacheKey),'1');f.storage.setItem(previous,JSON.stringify(FOREIGN));
  const get=f.storage.getItem.bind(f.storage);f.storage.getItem=key=>{assert.notEqual(key,previous);return get(key);};
  await f.restore();assert.equal(f.S.conflict,true);assert.equal(f.S.queue.size,0);assert.equal(f.storage.getItem(f.cacheKey),null);assert.equal(f.marker().entries[0].storageKey,previous);assert.deepEqual(JSON.parse(f.storage.data.get(previous)),FOREIGN);
 });
}
