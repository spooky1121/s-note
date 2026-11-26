/* Company-scoped office images. Bytes remain private and are read only on demand. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SnoteOfficeDocumentClient=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const KINDS=Object.freeze(['businessRegistration','vehicleBusinessRegistration','shareholders','corporatePassbook','representativeId']);
 const TYPES=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}),MAX=5*1024*1024,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 const fail=code=>Object.assign(Error(code),{code});
 function record(raw){
  if(!raw||!KINDS.includes(raw.kind)||!Number.isSafeInteger(raw.revision)||raw.revision<0||raw.revision>2147483647||!['missing','ready'].includes(raw.status))throw fail('OFFICE_INVALID_RESPONSE');
  const missing=raw.status==='missing';
  if(missing?raw.fileId!==null:!UUID.test(raw.fileId||''))throw fail('OFFICE_INVALID_RESPONSE');
  if(!missing&&(raw.revision<1||!Object.hasOwn(TYPES,raw.mimeType)||!Number.isSafeInteger(raw.size)||raw.size<1||raw.size>MAX||typeof raw.filename!=='string'||!raw.filename.trim()||Array.from(raw.filename).length>180||/[\\/\u0000-\u001f\u007f]/.test(raw.filename)||typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt))))throw fail('OFFICE_INVALID_RESPONSE');
  if(missing&&raw.updatedAt!==null&&(typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt))))throw fail('OFFICE_INVALID_RESPONSE');
  return Object.freeze({kind:raw.kind,revision:raw.revision,status:raw.status,fileId:raw.fileId,filename:missing?'':raw.filename,mimeType:missing?null:raw.mimeType,size:missing?0:raw.size,updatedAt:raw.updatedAt??null,canUpload:true});
 }
 function create(options={}){
  let state=null,preview=null;
  const guard=(context,check=()=>true)=>{try{return options.current(context)===true&&check()===true;}catch{return false;}};
  function closePreview(){const old=preview;preview=null;if(old?.url){options.closeViewer?.(old.url);(options.revokeURL||root.URL.revokeObjectURL.bind(root.URL))(old.url);}}
  function reset(){closePreview();state=null;}
  function ensure(context){if(!guard(context)){reset();throw fail('OFFICE_CONTEXT_CHANGED');}if(state?.key!==context.key){reset();state={key:context.key,rows:new Map(),pending:null,version:0,mutating:false};}return state;}
  function assert(context,s,check){if(state!==s||!guard(context,check))throw fail('OFFICE_CONTEXT_CHANGED');}
  function envelope(context,data){if(!data||data.ok!==true||data.companyId!==options.companyId(context))throw fail('OFFICE_INVALID_RESPONSE');return data;}
  function load(context){
   const s=ensure(context);if(s.mutating)return Promise.reject(fail('OFFICE_BUSY'));if(s.pending)return s.pending;const version=s.version;
   const task=(async()=>{const data=envelope(context,await options.request(context,{action:'list'}));assert(context,s);
    if(!Array.isArray(data.documents)||data.documents.length!==KINDS.length)throw fail('OFFICE_INVALID_RESPONSE');
    const rows=data.documents.map(record);if(new Set(rows.map(row=>row.kind)).size!==KINDS.length)throw fail('OFFICE_INVALID_RESPONSE');
    if(s.version!==version)throw fail('OFFICE_CONTEXT_CHANGED');closePreview();s.rows=new Map(rows.map(row=>[row.kind,row]));return {complete:true,documents:rows};
   })().finally(()=>{if(state===s&&s.pending===task)s.pending=null;});s.pending=task;return task;
  }
  async function mutate(context,action,value,check=()=>true){
   const s=ensure(context);assert(context,s,check);
   if(!value||!KINDS.includes(value.kind)||!UUID.test(value.requestId||'')||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||value.expectedRevision>=2147483647)throw fail('OFFICE_INVALID_INPUT');
   if(action==='upload'&&(!(value.file instanceof root.Blob)||!Object.hasOwn(TYPES,value.file.type)||value.file.size<1||value.file.size>MAX))throw fail('OFFICE_INVALID_IMAGE');
   if(action==='delete'&&!UUID.test(value.fileId||''))throw fail('OFFICE_INVALID_INPUT');
   if(s.mutating)throw fail('OFFICE_BUSY');s.mutating=true;s.version++;closePreview();
   try{
    const data=envelope(context,await options.request(context,{action,...value},check));assert(context,s,check);const row=record(data.document);
    if(row.kind!==value.kind||row.revision!==value.expectedRevision+1||(action==='delete'?row.status!=='missing':row.status!=='ready')||typeof data.duplicate!=='boolean')throw fail('OFFICE_INVALID_RESPONSE');
    const known=s.rows.get(row.kind);if(known&&(known.revision>row.revision||known.revision===row.revision&&(known.fileId!==row.fileId||known.status!==row.status)))throw fail('CONFLICT');
    s.rows.set(row.kind,row);return {ok:true,companyId:data.companyId,document:row,duplicate:data.duplicate};
   }finally{if(state===s)s.mutating=false;}
  }
  async function open(context,kind,origin,check=()=>true){
   const s=ensure(context);if(!KINDS.includes(kind))return false;
   if(!s.rows.size)await load(context);assert(context,s,check);const row=s.rows.get(kind);if(row?.status!=='ready')return false;
   closePreview();const lease={url:null};preview=lease;
   try{
    const blob=await options.request(context,{action:'read',kind,fileId:row.fileId,revision:row.revision},check);assert(context,s,check);
    if(preview!==lease||s.rows.get(kind)!==row||!(blob instanceof root.Blob)||blob.type!==row.mimeType||blob.size!==row.size)throw fail('OFFICE_INVALID_IMAGE');
    const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());assert(context,s,check);
    const valid=row.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:row.mimeType==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!valid||preview!==lease)throw fail('OFFICE_INVALID_IMAGE');
    lease.url=(options.createURL||root.URL.createObjectURL.bind(root.URL))(blob);
    const current=()=>preview===lease&&state===s&&guard(context,check)&&s.rows.get(kind)===row;
    const download=()=>{if(!current())return false;const a=root.document.createElement('a');a.href=lease.url;let filename=row.filename.replace(/[\\/\u0000-\u001f\u007f]/g,'_').trim()||'운영서류';const extension=row.mimeType==='image/jpeg'?/\.jpe?g$/i:row.mimeType==='image/png'?/\.png$/i:/\.webp$/i;if(!extension.test(filename))filename+='.'+TYPES[row.mimeType];a.download=filename;root.document.body.append(a);a.click();a.remove();return true;};
    const opened=await options.openViewer({src:lease.url,origin,isCurrent:current,download,alt:'운영서류 확대'});
    if(!opened||!current()){if(preview===lease)closePreview();return false;}return true;
   }catch(error){if(preview===lease)closePreview();throw error;}
  }
  return Object.freeze({load,upload:(context,value,check)=>mutate(context,'upload',value,check),remove:(context,value,check)=>mutate(context,'delete',value,check),open,reset});
 }
 return Object.freeze({create,record,KINDS,MAX_BYTES:MAX});
});
