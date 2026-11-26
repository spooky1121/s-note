/* Registration metadata stays scoped and image bytes are fetched only on an explicit open. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else if(!root.SnoteContractRegistrationStore)root.SnoteContractRegistrationStore=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,MAX_BYTES=25*1024*1024,MAX_ROWS=3000;
 const TYPES=Object.freeze({'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp']}),ALWAYS=()=>true;
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\\/\u0000-\u001f\u007f]/.test(value)&&!/^\.{1,2}$/.test(value)&&!/^[a-z][a-z0-9+.-]*:/i.test(value);
 const target=value=>object(value)&&UUID.test(value.ownerId||'')&&id(value.id)?{ownerId:value.ownerId.toLowerCase(),id:value.id}:null;
 const key=value=>JSON.stringify([value.ownerId,value.id]);
 const contextShape=value=>object(value)&&typeof value.key==='string'&&value.key.length>0&&value.key.length<=4096&&UUID.test(value.companyId||'')&&UUID.test(value.userId||'')&&value.ready===true;
 const sameContext=(a,b)=>contextShape(a)&&contextShape(b)&&['key','companyId','userId','role','client','actor'].every(name=>a[name]===b[name]);
 const safeGuard=guard=>{try{return typeof guard==='function'&&guard()===true;}catch{return false;}};
 function filename(row){
  const original=typeof row.original_name==='string'?row.original_name:'',name=Array.from(original.replace(/[\\/\u0000-\u001f\u007f]/g,'_').trim()).slice(0,180).join('')||'자동차등록증';
  return /\.(?:jpe?g|png|webp)$/i.test(name)?name:name+'.'+TYPES[row.mime_type][0];
 }
 function metadata(row,companyId,groupName){
  if(!object(row)||row.company_id!==companyId||!UUID.test(row.owner_id||'')||!id(row.id)||!id(row.car_id)||row.group_name!==groupName||!Object.hasOwn(TYPES,row.mime_type)||!Number.isSafeInteger(row.file_size)||row.file_size<1||row.file_size>MAX_BYTES||typeof row.created_at!=='string'||row.created_at.length>64||!Number.isFinite(Date.parse(row.created_at))||typeof row.file_path!=='string'||row.file_path.length>1800)return null;
  let head;try{head=[companyId,row.owner_id,encodeURIComponent(row.car_id),encodeURIComponent(row.id)+'.'];}catch{return null;}
  if(!TYPES[row.mime_type].some(ext=>row.file_path===head.slice(0,3).join('/')+'/'+head[3]+ext))return null;
  return Object.freeze({id:row.id,company_id:row.company_id,owner_id:row.owner_id,car_id:row.car_id,group_name:row.group_name,file_path:row.file_path,original_name:typeof row.original_name==='string'?row.original_name.slice(0,1000):'',mime_type:row.mime_type,file_size:row.file_size,created_at:row.created_at});
 }
 const rowKey=row=>JSON.stringify([row.company_id,row.owner_id,row.id,row.file_path,row.mime_type,row.file_size,row.created_at]);
 async function imageBlob(blob,row){
  if(typeof Blob!=='function'||!(blob instanceof Blob)||blob.size!==row.file_size||blob.size<1||blob.size>MAX_BYTES||blob.type!==row.mime_type)return false;
  const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());
  if(row.mime_type==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(row.mime_type==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 }
 function create(options={}){
  const groupName=options.groupName||'registration';
  if(!['registration','inspection1','inspection2'].includes(groupName))throw Error('DOCUMENT_GROUP_INVALID');
  let state=null,epoch=0,lease=null;
  const duration=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(30000,options.timeoutMs)):15000;
  const makeURL=options.createObjectURL||((blob)=>root.URL.createObjectURL(blob)),revokeURL=options.revokeObjectURL||((url)=>root.URL.revokeObjectURL(url));
  const doc=options.document||root.document,maxAssets=Number.isSafeInteger(options.maxReady)?Math.max(1,Math.min(8,options.maxReady)):4;
  function revoke(asset){if(asset?.url)try{revokeURL(asset.url);}catch{} }
  function clearLease(){lease?.monitor?.disconnect();lease=null;}
  function clear(){epoch++;clearLease();if(state){for(const asset of state.assets.values())revoke(asset);state.assets.clear();state.downloads.clear();state.openJob=null;state.rows.clear();}state=null;}
  function verified(context){
   try{const latest=options.context?.();return sameContext(context,latest)&&options.current?.(context)===true&&options.current?.(latest)===true;}catch{return false;}
  }
  function live(s){if(state!==s||s.epoch!==epoch||!verified(s.context)){if(state===s)clear();return false;}return true;}
  function ensure(context){
   if(!verified(context)){if(state)clear();return null;}
   if(state&&!sameContext(state.context,context))clear();
   if(!state)state={context:{...context},epoch,version:0,status:'idle',complete:false,rows:new Map(),uncertain:new Set(),assets:new Map(),downloads:new Map(),pending:null,openJob:null};
   return live(state)?state:null;
  }
  function resolve(s,input){
   const wanted=target(input);if(!wanted||!live(s))return null;
   try{const value=options.resolveVehicle?.(s.context,wanted),actual=target(value);if(!actual||actual.ownerId!==wanted.ownerId||actual.id!==wanted.id||!live(s))return null;return {...actual,ambiguous:value.ambiguous===true};}catch{return null;}
  }
  function newest(s,identity){return s.rows.get(identity.id)?.[0]||null;}
  function status(s,identity){
   if(!identity)return {status:'unavailable'};if(identity.ambiguous)return {status:'ambiguous'};
   if(s.status!=='ready')return {status:'unknown'};
   if(s.uncertain.has(identity.id)||s.uncertain.has('*'))return {status:'unknown'};
   const row=newest(s,identity);if(!row)return {status:s.complete?'missing':'unknown'};
   const asset=s.assets.get(rowKey(row));return asset?.ready?{status:'ready',thumbnail:asset.url}:{status:'registered'};
  }
  function registration(context,input){const s=ensure(context);return s?status(s,resolve(s,input)):{status:'unavailable'};}
  function timed(work){
   let timer;const timeout=new Promise((_,reject)=>{timer=root.setTimeout(()=>reject(Error('REGISTRATION_TIMEOUT')),duration);});
   return Promise.race([Promise.resolve().then(work),timeout]).finally(()=>root.clearTimeout(timer));
  }
  function prepare(context,identities,{force=false}={},preserve=null){
   const s=ensure(context);if(!s||!Array.isArray(identities)||!identities.some(value=>{const resolved=resolve(s,value);return resolved&&!resolved.ambiguous;}))return Promise.resolve(false);
   if(s.pending)return s.pending;if(s.status==='ready'&&!force)return Promise.resolve(true);
   s.version++;if(lease!==preserve)clearLease();else if(preserve)preserve.version=s.version;for(const asset of s.assets.values())revoke(asset);s.assets.clear();s.downloads.clear();s.rows.clear();s.uncertain.clear();s.complete=false;s.status='loading';
   const version=s.version,job=timed(()=>{if(!live(s)||s.version!==version)throw Error('REGISTRATION_STALE');return options.readMetadata(s.context);}).then(result=>{
    if(!live(s)||s.version!==version)return false;
    if(!object(result)||!Array.isArray(result.rows)||result.rows.length>MAX_ROWS||typeof result.complete!=='boolean')throw Error('REGISTRATION_METADATA_INVALID');
    const seen=new Map();for(const source of result.rows){
     const row=metadata(source,s.context.companyId,groupName);
     if(!row){s.uncertain.add(id(source?.car_id)?source.car_id:'*');continue;}
     const unique=JSON.stringify([row.company_id,row.owner_id,row.id]),previous=seen.get(unique);
     if(previous){if(rowKey(previous)!==rowKey(row)||previous.car_id!==row.car_id){s.uncertain.add(previous.car_id);s.uncertain.add(row.car_id);}continue;}
     seen.set(unique,row);if(!s.rows.has(row.car_id))s.rows.set(row.car_id,[]);s.rows.get(row.car_id).push(row);
    }
    for(const rows of s.rows.values())rows.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.id.localeCompare(b.id)||a.owner_id.localeCompare(b.owner_id));
    if(!live(s)||s.version!==version)return false;s.complete=result.complete;s.status='ready';return true;
   }).catch(()=>{if(live(s)&&s.version===version){s.status='error';s.complete=false;s.rows.clear();}return false;}).finally(()=>{if(state===s&&s.pending===job)s.pending=null;});
   s.pending=job;return job;
  }
  const prepareRegistrations=(context,identities,settings)=>prepare(context,identities,settings);
  function pendingCurrent(value){
   if(lease!==value||value.replaced||!live(value.state)||value.version!==value.state.version||!safeGuard(value.uiGuard))return false;
   const identity=resolve(value.state,value.identity);return !!identity&&!identity.ambiguous;
  }
  const currentLease=value=>pendingCurrent(value)&&!!value.row&&newest(value.state,value.identity)===value.row;
  function watch(value){
   const picture=doc?.getElementById?.('zoom-image'),Observer=options.MutationObserver||root.MutationObserver;if(!picture||typeof Observer!=='function')return;
   value.monitor=new Observer(()=>{value.replaced=true;value.monitor?.disconnect();});value.monitor.observe(picture,{attributes:true,attributeFilter:['src']});
  }
  function releaseWatch(value){const replaced=!!value.monitor?.takeRecords?.().length;value.monitor?.disconnect();value.monitor=null;if(replaced)value.replaced=true;return !value.replaced;}
  function asset(s,row,isCurrent=ALWAYS){
   const id=rowKey(row),cached=s.assets.get(id);if(cached){s.assets.delete(id);s.assets.set(id,cached);return Promise.resolve(cached);}
   if(s.downloads.has(id))return s.downloads.get(id);const version=s.version;
   const job=timed(async()=>{if(!live(s)||s.version!==version)throw Error('REGISTRATION_STALE');return options.download(s.context,row);}).then(async blob=>{
    if(!live(s)||s.version!==version||!safeGuard(isCurrent)||!await imageBlob(blob,row)||!live(s)||s.version!==version||!safeGuard(isCurrent))return null;
    let url;try{url=makeURL(blob);}catch{return null;}
    if(typeof url!=='string'||!url.startsWith('blob:')){if(url)try{revokeURL(url);}catch{}return null;}
    const value={url,ready:false};if(!live(s)||s.version!==version||!safeGuard(isCurrent)){revoke(value);return null;}
    s.assets.set(id,value);while(s.assets.size>maxAssets){const oldest=s.assets.keys().next().value,removed=s.assets.get(oldest);s.assets.delete(oldest);revoke(removed);}return value;
   }).catch(()=>null).finally(()=>{if(s.downloads.get(id)===job)s.downloads.delete(id);});s.downloads.set(id,job);return job;
  }
  function saveFile(value){
   if(!currentLease(value)||!value.asset?.ready||!doc?.createElement)return false;
   const link=doc.createElement('a');link.href=value.asset.url;link.download=filename(value.row);doc.body?.append?.(link);try{link.click();return true;}finally{link.remove?.();}
  }
  function openRegistration(context,input,origin,uiGuard=ALWAYS){
   const s=ensure(context),identity=s&&resolve(s,input);if(!s||!identity||identity.ambiguous||!safeGuard(uiGuard))return Promise.resolve(false);
   const openingKey=key(identity);
   if(s.openJob?.key===openingKey&&pendingCurrent(s.openJob.lease))return s.openJob.promise.then(result=>result&&safeGuard(uiGuard)&&live(s));
   const value={state:s,identity,version:s.version,row:null,asset:null,uiGuard,origin,replaced:false,monitor:null};clearLease();lease=value;watch(value);
   const job=(async()=>{
    if(s.status!=='ready'){
     const loaded=await prepare(context,[identity],{},value);if(!loaded||!pendingCurrent(value))return false;
    }
    if(!pendingCurrent(value))return false;const currentIdentity=resolve(s,identity);if(!currentIdentity||currentIdentity.ambiguous||s.uncertain.has(identity.id)||s.uncertain.has('*'))return false;
    value.row=newest(s,identity);value.version=s.version;if(!value.row)return false;
    const ready=await asset(s,value.row,()=>currentLease(value));if(!ready||!currentLease(value)||!releaseWatch(value))return false;value.asset=ready;
    let opened;try{const task=options.openViewer?.({src:ready.url,origin,isCurrent:()=>currentLease(value),download:()=>saveFile(value),alt:({registration:'자동차등록증',inspection1:'성능·상태점검기록부 1',inspection2:'성능·상태점검기록부 2'})[groupName]+' 확대'});watch(value);opened=await timed(()=>task);}catch{opened=false;}
    if(!opened||!currentLease(value)){
     if(lease===value){releaseWatch(value);lease=null;}
     if(s.assets.get(rowKey(value.row))===ready){s.assets.delete(rowKey(value.row));revoke(ready);}return false;
    }
    ready.ready=true;return true;
   })().catch(()=>false).finally(()=>{if(lease===value&&!value.asset?.ready){releaseWatch(value);lease=null;}if(state===s&&s.openJob?.promise===job)s.openJob=null;});
   s.openJob={key:openingKey,lease:value,promise:job};return job;
  }
  return Object.freeze({registration,prepareRegistrations,openRegistration,reset:clear});
 }
 return Object.freeze({create});
});
