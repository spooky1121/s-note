/* Recovery records contain metadata only. Dataset values stay in their original keys. */
(function(root,factory){
 'use strict';
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.SnoteIdleRecovery=api;
})(globalThis,function(root){
 'use strict';
 const NIL='00000000-0000-0000-0000-000000000000';
 const PREFIX='snote-idle-recovery:v1:';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const HASH=/^[0-9a-f]{64}$/i;
 const DATASETS=Object.freeze(['cars','covers','finance','finance_limits','prestock','monthly','categories']);
 const registry=root.SnoteStorageCompat||(typeof module==='object'&&module.exports&&typeof require==='function'?require('./snote-storage-compat.js'):null);
 const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';
 const invalid=reason=>{throw new Error('INVALID_IDLE_RECOVERY_'+reason);};
 function compatible(){
  if(!registry||typeof registry.acceptsRecoveryKey!=='function'||typeof registry.canonicalKey!=='function')invalid('COMPAT');
  return registry;
 }
 const revision=value=>Number.isSafeInteger(value)&&value>=0;
 function uuid(value,allowNil){
  if(typeof value!=='string'||!UUID.test(value))invalid('ID');
  const result=value.toLowerCase();
  if(!allowNil&&result===NIL)invalid('ID');
  return result;
 }
 function scope(value){
  if(!object(value))invalid('SCOPE');
  let project=value.project;
  if(typeof project!=='string'||project.length>300||project!==project.trim())invalid('PROJECT');
  if(/^https:\/\//i.test(project)){
   let url;try{url=new URL(project);}catch(_){invalid('PROJECT');}
   if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.hostname||url.hostname.length>253)invalid('PROJECT');
   project=url.origin;
  }else{
   if(!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(project))invalid('PROJECT');
   project=project.toLowerCase();
  }
  return {project,userId:uuid(value.userId,false),companyId:uuid(value.companyId,false)};
 }
 function scopeKey(value){return PREFIX+encodeURIComponent(value.project)+':'+value.userId+':'+value.companyId;}
 function key(value){compatible();return scopeKey(scope(value));}
 function entry(value){
  if(!object(value))invalid('ENTRY');
  const dataset=value.dataset,ownerId=uuid(value.ownerId,true),storageKey=value.storageKey;
  if(typeof dataset!=='string'||!DATASETS.includes(dataset))invalid('DATASET');
  const personal=dataset==='cars'||dataset==='covers';
  if((personal&&ownerId===NIL)||(!personal&&ownerId!==NIL)||!compatible().acceptsRecoveryKey(dataset,ownerId,storageKey))invalid('STORAGE_KEY');
  if(!revision(value.revision))invalid('REVISION');
  if(typeof value.hash!=='string'||!HASH.test(value.hash))invalid('HASH');
  // Never spread the input: raw values, customers and credentials must not be copied.
  return {dataset,ownerId,storageKey,revision:value.revision,hash:value.hash.toLowerCase()};
 }
 function entries(value,strict){
  if(!Array.isArray(value)||value.length>1000)invalid('ENTRIES');
  for(let index=0;index<value.length;index++)if(!own(value,index))invalid('ENTRIES');
  const storageKeys=new Set(),owners=new Set();
  return value.map(item=>{
   if(strict&&(!object(item)||Object.keys(item).length!==5||Object.keys(item).some(name=>!['dataset','ownerId','storageKey','revision','hash'].includes(name))))invalid('ENTRY');
   const result=entry(item),owner=result.dataset+':'+result.ownerId,canonical=compatible().canonicalKey(result.storageKey);
   if(storageKeys.has(canonical)||owners.has(owner))invalid('DUPLICATE');
   storageKeys.add(canonical);owners.add(owner);return result;
  });
 }
 function storage(value){
  const result=value===undefined?root.localStorage:value;
  if(!result||typeof result.getItem!=='function'||typeof result.setItem!=='function'||typeof result.removeItem!=='function')invalid('STORAGE');
  return result;
 }
 function read(value,providedStorage){
  compatible();
  const current=scope(value),store=storage(providedStorage),raw=store.getItem(scopeKey(current));
  if(raw===null)return null;
  if(typeof raw!=='string'||raw.length>1048576)invalid('RECORD');
  let record;try{record=JSON.parse(raw);}catch(_){invalid('RECORD');}
  if(!object(record)||record.v!==1||Object.keys(record).length!==5||Object.keys(record).some(name=>!['v','project','userId','companyId','entries'].includes(name)))invalid('RECORD');
  const saved=scope(record);
  if(saved.project!==current.project||saved.userId!==current.userId||saved.companyId!==current.companyId)invalid('SCOPE');
  return {v:1,...current,entries:entries(record.entries,true)};
 }
 function write(value,items,providedStorage){
  compatible();
  const current=scope(value),store=storage(providedStorage);
  const record={v:1,...current,entries:entries(items,false)};
  const serialized=JSON.stringify(record);
  if(serialized.length>1048576)invalid('RECORD');
  // Validate any existing record before replacing it; corruption needs explicit recovery.
  read(current,store);
  store.setItem(scopeKey(current),serialized);
  return record;
 }
 function remove(value,providedStorage){
  compatible();
  const current=scope(value),store=storage(providedStorage);
  if(read(current,store)!==null)store.removeItem(scopeKey(current));
 }
 async function hash(serialized){
  if(typeof serialized!=='string')invalid('HASH_INPUT');
  if(!root.crypto?.subtle||typeof root.TextEncoder!=='function')invalid('CRYPTO');
  const bytes=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
 }
 function reconcile(value,state){
  const captured=entry(value);
  if(!object(state)||typeof state.cacheHash!=='string'||!HASH.test(state.cacheHash)||state.cacheHash.toLowerCase()!==captured.hash)return 'cache-changed';
  const serverExists=own(state,'serverExists')?state.serverExists:true;
  if(typeof serverExists!=='boolean')return 'conflict';
  if(!serverExists)return captured.revision===0&&(state.serverRevision===undefined||state.serverRevision===null||state.serverRevision===0)?'retry':'conflict';
  if(!revision(state.serverRevision))return 'conflict';
  if(typeof state.serverHash==='string'&&HASH.test(state.serverHash)&&state.serverHash.toLowerCase()===captured.hash&&state.serverRevision>=captured.revision)return 'acknowledged';
  return state.serverRevision===captured.revision?'retry':'conflict';
 }
 return Object.freeze({key,hash,read,write,remove,reconcile});
});
