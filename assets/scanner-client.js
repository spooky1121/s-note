/* A scoped scanner inbox. Metadata is cheap; image bytes stay explicit and private. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SnoteScannerClient=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,NIL='00000000-0000-0000-0000-000000000000',MAX=5*1024*1024,PAGE=30,TYPES=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
 const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value),id=value=>typeof value==='string'&&UUID.test(value)&&value!==NIL;
 const fail=(code,uncertain)=>Object.assign(Error(code),{code,...(typeof uncertain==='boolean'?{uncertain}:{})});
 function timestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)||value.startsWith('0000'))throw fail('SCANNER_INVALID_RESPONSE');
  const date=new Date(value);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==value.slice(0,19))throw fail('SCANNER_INVALID_RESPONSE');return value;
 }
 const timeKey=value=>value.slice(0,19)+'.'+(value.match(/\.(\d+)Z$/)?.[1]||'').padEnd(6,'0')+'Z';
 function validFilename(value){return typeof value==='string'&&!!value.trim()&&Array.from(value).length<=180&&!/[\\/\u0000-\u001f\u007f]/.test(value);}
 function record(value){
  if(!plain(value)||!id(value.id)||!Number.isSafeInteger(value.revision)||value.revision!==1||!validFilename(value.filename)||!Object.hasOwn(TYPES,value.mimeType)||!Number.isSafeInteger(value.size)||value.size<1||value.size>MAX)throw fail('SCANNER_INVALID_RESPONSE');
  const createdAt=timestamp(value.createdAt),updatedAt=timestamp(value.updatedAt);if(timeKey(updatedAt)<timeKey(createdAt))throw fail('SCANNER_INVALID_RESPONSE');
  return Object.freeze({id:value.id.toLowerCase(),revision:value.revision,filename:value.filename,mimeType:value.mimeType,size:value.size,createdAt,updatedAt});
 }
 function cursor(value){if(value===null||value===undefined)return null;if(!plain(value)||Object.keys(value).length!==2||!id(value.id))throw fail('SCANNER_INVALID_CURSOR');return Object.freeze({createdAt:timestamp(value.createdAt),id:value.id.toLowerCase()});}
 const sortKey=value=>timeKey(value.createdAt)+'/'+value.id;
 function mutationError(error){
  if(typeof error?.uncertain==='boolean')return error;
  const code=typeof error?.code==='string'?error.code:'NETWORK';return fail(code,!/^(?:INVALID_REQUEST|UNSUPPORTED_MEDIA_TYPE|PAYLOAD_TOO_LARGE|CONFLICT|FORBIDDEN|UNAUTHORIZED|SETUP_REQUIRED|BUSY|LIMIT|SCANNER_INVALID_INPUT|SCANNER_CONTEXT_CHANGED)$/.test(code));
 }
 function create(options={}){
  let state=null,lease=null;const downloads=new Set();
  const guard=(context,check=()=>true)=>{try{return options.current(context)===true&&check()===true;}catch{return false;}};
  const createURL=options.createURL||((blob)=>root.URL.createObjectURL(blob)),revokeURL=options.revokeURL||((url)=>root.URL.revokeObjectURL(url));
  function closePreview(){const old=lease;lease=null;if(old?.url){options.closeViewer?.(old.url);revokeURL(old.url);}}
  function reset(){state=null;closePreview();for(const value of downloads){root.clearTimeout(value.timer);revokeURL(value.url);}downloads.clear();}
  function ensure(context){if(!guard(context))throw fail('SCANNER_CONTEXT_CHANGED');if(state?.key!==context.key){reset();state={key:context.key,rows:new Map(),deleted:new Map(),pending:new Map(),bytes:new Map(),version:0,mutating:false};}return state;}
  function assert(context,s,check=()=>true){if(state!==s||!guard(context,check))throw fail('SCANNER_CONTEXT_CHANGED');}
  function envelope(context,value){if(!plain(value)||value.ok!==true||value.companyId!==options.companyId(context))throw fail('SCANNER_INVALID_RESPONSE');return value;}
  function list(context,{cursor:input=null}={},check=()=>true){
   const s=ensure(context),after=cursor(input),key=JSON.stringify(after);assert(context,s,check);if(s.mutating)return Promise.reject(fail('BUSY'));
   let task=s.pending.get(key);
   if(!task){const version=s.version;task=(async()=>{
    const data=envelope(context,await options.request(context,{action:'list',cursor:after}));assert(context,s);if(version!==s.version)throw fail('SCANNER_STALE');
    if(!Array.isArray(data.items)||data.items.length>PAGE||!Object.hasOwn(data,'nextCursor'))throw fail('SCANNER_INVALID_RESPONSE');
    const items=data.items.map(record),seen=new Set();let previous=after?sortKey(after):null;
    for(const row of items){const key=sortKey(row);if(seen.has(row.id)||previous!==null&&key>=previous||s.deleted.has(row.id))throw fail('SCANNER_INVALID_RESPONSE');seen.add(row.id);previous=key;}
    const nextCursor=cursor(data.nextCursor);if(nextCursor&&(items.length!==PAGE||nextCursor.createdAt!==items.at(-1).createdAt||nextCursor.id!==items.at(-1).id))throw fail('SCANNER_INVALID_RESPONSE');
    for(const row of items)s.rows.set(row.id,row);return Object.freeze({items:Object.freeze(items),nextCursor});
   })().finally(()=>{if(state===s&&s.pending.get(key)===task)s.pending.delete(key);});s.pending.set(key,task);}
   return task.then(data=>{assert(context,s,check);return data;});
  }
  function target(s,value){if(!plain(value)||!id(value.id)||value.revision!==1)throw fail('SCANNER_INVALID_INPUT');const row=s.rows.get(value.id.toLowerCase());if(!row||row.revision!==value.revision||s.deleted.has(row.id))throw fail('CONFLICT');return row;}
  async function upload(context,value,check=()=>true){
   const s=ensure(context);assert(context,s,check);
   if(!value||!id(value.requestId)||!(value.file instanceof root.Blob)||!validFilename(value.file.name)||!Object.hasOwn(TYPES,value.file.type)||value.file.size<1||value.file.size>MAX)throw fail('SCANNER_INVALID_INPUT',false);
   if(s.mutating)throw fail('BUSY',false);s.mutating=true;s.version++;
   try{
    const data=envelope(context,await options.request(context,{action:'upload',requestId:value.requestId,file:value.file},check));assert(context,s,check);const row=record(data.item);
    if(typeof data.duplicate!=='boolean'||row.filename!==value.file.name||row.mimeType!==value.file.type||row.size!==value.file.size)throw fail('SCANNER_INVALID_RESPONSE',true);
    if(s.deleted.has(row.id))throw fail('CONFLICT');const known=s.rows.get(row.id);if(known&&JSON.stringify(known)!==JSON.stringify(row))throw fail('SCANNER_INVALID_RESPONSE',true);
    s.rows.set(row.id,row);return {ok:true,companyId:data.companyId,item:row,duplicate:data.duplicate};
   }catch(error){throw mutationError(error);}finally{if(state===s)s.mutating=false;}
  }
  async function remove(context,value,check=()=>true){
   const s=ensure(context);assert(context,s,check);if(!value||!id(value.id)||!id(value.requestId)||value.expectedRevision!==1)throw fail('SCANNER_INVALID_INPUT',false);
   if(!s.rows.has(value.id)&&s.deleted.get(value.id)!==2)throw fail('CONFLICT',false);if(s.mutating)throw fail('BUSY',false);s.mutating=true;s.version++;closePreview();
   try{
    const data=envelope(context,await options.request(context,{action:'delete',id:value.id,expectedRevision:value.expectedRevision,requestId:value.requestId},check));assert(context,s,check);
    if(data.deleted!==true||data.id!==value.id||data.revision!==2||typeof data.duplicate!=='boolean')throw fail('SCANNER_INVALID_RESPONSE',true);
    s.rows.delete(value.id);s.deleted.set(value.id,data.revision);return {ok:true,companyId:data.companyId,id:data.id,revision:data.revision,deleted:true,duplicate:data.duplicate};
   }catch(error){throw mutationError(error);}finally{if(state===s)s.mutating=false;}
  }
  async function readAsset(context,s,row,check){
   assert(context,s,check);const key=row.id+':'+row.revision;let task=s.bytes.get(key);
   if(!task){task=(async()=>{
    const blob=await options.request(context,{action:'read',id:row.id,revision:row.revision});assert(context,s);
    if(!(blob instanceof root.Blob)||blob.type!==row.mimeType||blob.size!==row.size)throw fail('SCANNER_INVALID_IMAGE');
    const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());assert(context,s);
    const valid=row.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:row.mimeType==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!valid)throw fail('SCANNER_INVALID_IMAGE');return blob;
   })().finally(()=>{if(state===s&&s.bytes.get(key)===task)s.bytes.delete(key);});s.bytes.set(key,task);}
   const blob=await task;assert(context,s,check);if(s.deleted.has(row.id)||s.rows.get(row.id)?.revision!==row.revision)throw fail('CONFLICT');return blob;
  }
  function saveFile(url,row,current){
   if(!current())return false;const a=(options.document||root.document).createElement('a');a.href=url;let filename=row.filename;const extension=row.mimeType==='image/jpeg'?/\.jpe?g$/i:row.mimeType==='image/png'?/\.png$/i:/\.webp$/i;if(!extension.test(filename))filename+='.'+TYPES[row.mimeType];a.download=filename;(options.document||root.document).body.append(a);try{a.click();return true;}finally{a.remove();}
  }
  async function open(context,value,origin,check=()=>true){
   const s=ensure(context),row=target(s,value);assert(context,s,check);closePreview();const pending={url:null};lease=pending;
   try{
    const blob=await readAsset(context,s,row,check);assert(context,s,check);if(lease!==pending)return false;
    pending.url=createURL(blob);const current=()=>lease===pending&&state===s&&guard(context,check)&&!s.deleted.has(row.id)&&s.rows.get(row.id)?.revision===row.revision;
    const opened=await options.openViewer({src:pending.url,origin,isCurrent:current,download:()=>saveFile(pending.url,row,current),alt:row.filename+' 확대'});
    if(!opened||!current()){if(lease===pending)closePreview();return false;}return true;
   }catch(error){if(lease===pending)closePreview();throw error;}
  }
  async function download(context,value,check=()=>true){
   const s=ensure(context),row=target(s,value),blob=await readAsset(context,s,row,check);assert(context,s,check);const url=createURL(blob),valueURL={url,timer:null};downloads.add(valueURL);
   try{return saveFile(url,row,()=>state===s&&guard(context,check)&&!s.deleted.has(row.id));}finally{valueURL.timer=root.setTimeout(()=>{if(downloads.delete(valueURL))revokeURL(url);},1000);}
  }
  return Object.freeze({list,upload,remove,open,download,reset});
 }
 return Object.freeze({create,record,cursor,validFilename,MAX_BYTES:MAX,PAGE_SIZE:PAGE});
});
