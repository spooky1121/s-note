/* Decoded private company branding, isolated by account, company and client. */
(function(global){
 'use strict';
 const KINDS=Object.freeze(['companyStamp','companyLogo','companyOfficeStamp']);
 const MIME=new Set(['image/png','image/jpeg','image/webp']),MAX_BYTES=3*1024*1024;
 const validKind=kind=>KINDS.includes(kind);
 const issue=code=>Object.assign(new Error(code),{code});
 const object=value=>value!==null&&(typeof value==='object'||typeof value==='function');
 const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value);
 function create(options){
  if(!options||!['context','records','download','createURL','revokeURL','decode'].every(key=>typeof options[key]==='function'))throw issue('ASSET_OPTIONS_INVALID');
  let scope=null,generation=0;
  const states=new Map(KINDS.map(kind=>[kind,{status:'idle',url:null,path:null,error:null,pending:null,version:0}]));
  function context(){
   try{const value=options.context();return value&&id(value.companyId)&&id(value.userId)&&object(value.client)&&object(value.actor)?{companyId:value.companyId,userId:value.userId,client:value.client,actor:value.actor}:null;}catch(_){return null;}
  }
  const same=(a,b)=>a===null&&b===null||!!a&&!!b&&a.companyId===b.companyId&&a.userId===b.userId&&a.client===b.client&&a.actor===b.actor;
  function requireKind(kind){if(!validKind(kind))throw issue('ASSET_KIND_INVALID');}
  function revoke(url){if(url)try{options.revokeURL(url);}catch(_){} }
  function clear(kind,status='idle',error=null){
   const state=states.get(kind),url=state.url;
   state.url=null;state.path=null;state.status=status;state.error=error;
   // Consumers must remove references before an object URL is revoked.
   try{options.onClear?.(kind,url);}catch(_){}finally{revoke(url);}
  }
  function invalidateState(kind){const state=states.get(kind);state.version++;state.pending=null;clear(kind);}
  function synchronize(){
   const next=context();if(same(next,scope))return next;
   ++generation;scope=next;for(const kind of KINDS)invalidateState(kind);return next;
  }
  function current(expected,epoch,kind,version){synchronize();return generation===epoch&&same(scope,expected)&&states.get(kind).version===version;}
  function metadata(kind,row,expected){
   if(!row||typeof row!=='object'||row.company_id!==expected.companyId||row.group_name!==kind||!id(row.owner_id))throw issue('ASSET_METADATA_INVALID');
   const path=row.file_path,prefix=expected.companyId+'/'+row.owner_id+'/branding/';
   if(typeof path!=='string'||path.length>1024||!path.startsWith(prefix)||! /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path.slice(prefix.length))||path.includes('..'))throw issue('ASSET_PATH_INVALID');
   if(!MIME.has(row.mime_type))throw issue('ASSET_MIME_INVALID');
   if(!Number.isSafeInteger(row.file_size)||row.file_size<=0||row.file_size>MAX_BYTES)throw issue('ASSET_SIZE_INVALID');
   return row;
  }
  function file(blob,row){
   if(!blob||Object.prototype.toString.call(blob)!=='[object Blob]'||typeof blob.slice!=='function'||typeof blob.arrayBuffer!=='function')throw issue('ASSET_BLOB_INVALID');
   if(!Number.isSafeInteger(blob.size)||blob.size<=0||blob.size>MAX_BYTES||blob.size!==row.file_size)throw issue('ASSET_SIZE_INVALID');
   const type=String(blob.type||'').toLowerCase();
   if(type===''||type==='application/octet-stream')return blob.slice(0,blob.size,row.mime_type);
   if(!MIME.has(type)||type!==row.mime_type)throw issue('ASSET_MIME_INVALID');
   return blob;
  }
  function load(kind){
   requireKind(kind);const expected=synchronize(),state=states.get(kind);if(!expected)return Promise.resolve(null);
   if(state.pending)return state.pending.promise;
   const epoch=generation,version=state.version,pending={promise:null};state.status='loading';state.error=null;
   pending.promise=Promise.resolve().then(async()=>{
    let unpublished=null;
    try{
     let rows;
     try{rows=await options.records(kind,expected);}catch(_){throw issue('ASSET_RECORDS_FAILED');}
     if(!current(expected,epoch,kind,version))return null;
     if(!Array.isArray(rows))throw issue('ASSET_METADATA_INVALID');
     if(!rows.length){clear(kind,'missing');return null;}
     const row=metadata(kind,rows[0],expected);
     if(state.url&&state.path===row.file_path){state.status='ready';return state.url;}
     if(state.url)clear(kind,'loading');
     let blob;
     try{blob=await options.download(row,expected);}catch(_){throw issue('ASSET_DOWNLOAD_FAILED');}
     if(!current(expected,epoch,kind,version))return null;
     const normalized=file(blob,row);
     try{unpublished=options.createURL(normalized);}catch(_){throw issue('ASSET_URL_FAILED');}
     if(typeof unpublished!=='string'||!unpublished.startsWith('blob:'))throw issue('ASSET_URL_FAILED');
     try{await options.decode(unpublished);}catch(_){throw issue('ASSET_DECODE_FAILED');}
     if(!current(expected,epoch,kind,version)){revoke(unpublished);unpublished=null;return null;}
     state.url=unpublished;state.path=row.file_path;state.status='ready';state.error=null;unpublished=null;return state.url;
    }catch(error){
     if(unpublished){revoke(unpublished);unpublished=null;}
     if(!current(expected,epoch,kind,version))return null;
     const code=typeof error?.code==='string'&&/^ASSET_[A-Z_]+$/.test(error.code)?error.code:'ASSET_LOAD_FAILED';
     clear(kind,'error',code);throw issue(code);
    }finally{if(state.pending===pending)state.pending=null;}
   });
   state.pending=pending;return pending.promise;
  }
  function invalidate(kind){
   if(kind!==undefined)requireKind(kind);synchronize();for(const value of kind===undefined?KINDS:[kind])invalidateState(value);
  }
  function reset(){++generation;scope=null;for(const kind of KINDS)invalidateState(kind);}
  function snapshot(kind){
   requireKind(kind);synchronize();const state=states.get(kind);return Object.freeze({status:state.status,url:state.url,path:state.path,error:state.error,companyId:scope?.companyId||null,userId:scope?.userId||null});
  }
  return Object.freeze({load,invalidate,reset,snapshot});
 }
 global.SnoteCompanyAssets=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
