import { hardenAPIResponse, readBoundedBytes, sameOriginRequest } from '../_shared/api-security.js';
import { inspectOfficeImage } from '../_shared/office-image.js';
const BUCKET='snote-office-documents',MAX_FILE=5*1024*1024,MAX_BODY=6*1024*1024;
const KINDS=['businessRegistration','vehicleBusinessRegistration','shareholders','corporatePassbook','representativeId'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ERRORS={UNAUTHORIZED:[401,'다시 로그인해 주세요.'],FORBIDDEN:[403,'운영 서류 이용 권한을 확인해 주세요.'],INVALID_REQUEST:[400,'서류와 입력값을 확인해 주세요.'],CONFLICT:[409,'서류가 변경되었습니다. 다시 불러온 뒤 확인해 주세요.'],BUSY:[429,'처리 중인 서류가 있습니다. 잠시 후 다시 시도해 주세요.'],PAYLOAD_TOO_LARGE:[413,'서류 사진은 5MB 이하로 선택해 주세요.'],UNSUPPORTED_MEDIA_TYPE:[415,'JPG·PNG·WebP 사진을 선택해 주세요.'],SETUP_REQUIRED:[503,'운영 서류 저장소 설정을 확인해 주세요.'],NETWORK:[502,'처리 결과를 확인하지 못했습니다. 서류를 다시 불러온 뒤 확인해 주세요.'],METHOD_NOT_ALLOWED:[405,'지원하지 않는 요청 방식입니다.']};
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const json=(body,status=200)=>hardenAPIResponse(Response.json(body,{status}));
function fields(value,keys){if(!plain(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail('INVALID_REQUEST');}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))fail('INVALID_REQUEST');return v.toLowerCase();}
function revision(v){if(!Number.isInteger(v)||v<0||v>=2147483647)fail('INVALID_REQUEST');return v;}
function kind(v){if(!KINDS.includes(v))fail('INVALID_REQUEST');return v;}
function config(env={}){let url;try{url=new URL(env.SUPABASE_URL);}catch{fail('SETUP_REQUIRED');}const pub=env.SUPABASE_PUBLISHABLE_KEY,service=env.SUPABASE_SERVICE_ROLE_KEY;
 if(url.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.port||typeof pub!=='string'||typeof service!=='string'||!pub||!service||pub===service||[pub,service].some(v=>v.length>8192||/[\r\n]/.test(v)))fail('SETUP_REQUIRED');return {url:url.origin,pub,service};}
function dbError(status,data){if(status===401)fail('UNAUTHORIZED');if(status===403||data?.code==='42501')fail('FORBIDDEN');if(status===409||['40001','23505'].includes(data?.code))fail('CONFLICT');if(data?.code==='54000')fail('BUSY');if(data?.code==='22023')fail('INVALID_REQUEST');if(['PGRST202','PGRST204','42P01','42703','42883','55000'].includes(data?.code))fail('SETUP_REQUIRED');fail('NETWORK');}
async function upstream(c,path,{jwt,body,method='POST',binary=false,mime,storage=false}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{const key=jwt?c.pub:c.service,response=await fetch(c.url+path,{method,redirect:'manual',cache:'no-store',signal:controller.signal,
  headers:{apikey:key,Authorization:'Bearer '+(jwt||c.service),...(body===undefined?{}:{'Content-Type':mime||'application/json'}),...(storage&&method==='POST'?{'x-upsert':'false'}:{})},
  ...(body===undefined?{}:{body:storage&&mime?body:JSON.stringify(body)})});
  if(response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>{});fail('NETWORK');}
  const raw=await readBoundedBytes(response,binary&&response.ok?MAX_FILE:65536,{timeoutMs:18000});
  if(binary&&response.ok)return {bytes:raw,mimeType:(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase()};
  let data;try{data=raw.length?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):null;}catch{fail('NETWORK');}
  if(!response.ok){if(storage&&[404,409].includes(response.status))return {status:response.status,data};dbError(response.status,data);}return {status:response.status,data};
 }catch(e){if(ERRORS[e?.code])throw e;fail('NETWORK');}finally{clearTimeout(timer);}
}
async function authorize(c,jwt,companyId){const {data}=await upstream(c,'/rest/v1/rpc/snote_office_context',{jwt,body:{p_company:companyId}});
 if(!plain(data)||data.ok!==true||data.companyId!==companyId||!UUID.test(data.actorId||'')||!UUID.test(data.sessionId||''))fail('FORBIDDEN');return {actorId:data.actorId,sessionId:data.sessionId,companyId};}
async function action(c,scope,name,payload={}){const {data}=await upstream(c,'/rest/v1/rpc/snote_office_action',{body:{p_actor:scope.actorId,p_session:scope.sessionId,p_company:scope.companyId,p_action:name,p_payload:payload}});if(!plain(data)||data.ok!==true||data.companyId!==scope.companyId)fail('NETWORK');return data;}
function document(row){if(!plain(row)||!KINDS.includes(row.kind)||!Number.isInteger(row.revision)||row.revision<0||row.revision>2147483647||!['ready','missing'].includes(row.status)||typeof row.filename!=='string'||[...row.filename].length>180||/[\u0000-\u001f\u007f\\/]/.test(row.filename)||!Number.isInteger(row.size))fail('NETWORK');
 if(row.status==='ready'){if(!UUID.test(row.fileId||'')||row.revision<1||!row.filename||!['image/jpeg','image/png','image/webp'].includes(row.mimeType)||row.size<1||row.size>MAX_FILE)fail('NETWORK');}
 else if(row.fileId!==null||row.filename!==''||row.mimeType!==null||row.size!==0)fail('NETWORK');
 if(row.updatedAt!==null&&(typeof row.updatedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(row.updatedAt)||!Number.isFinite(Date.parse(row.updatedAt))))fail('NETWORK');
 return Object.fromEntries(['kind','revision','fileId','status','filename','mimeType','size','updatedAt'].map(k=>[k,row[k]]));}
function ack(value){if(!plain(value)||value.ok!==true||typeof value.duplicate!=='boolean')fail('NETWORK');return {ok:true,companyId:value.companyId,document:document(value.document),duplicate:value.duplicate};}
function objectPath(scope,k,path){if(typeof path!=='string'||!new RegExp('^'+scope.companyId+'/'+kind(k)+'/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(jpg|png|webp)$').test(path))fail('NETWORK');return '/storage/v1/object/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/');}
async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function cleanup(c,scope){try{const pending=await action(c,scope,'cleanup_claim');if(!Array.isArray(pending.files)||pending.files.length>5)return;
 for(const file of pending.files){let success=false;try{const parts=String(file.path||'').split('/');objectPath(scope,parts[1],file.path);uuid(file.fileId);uuid(file.token);const res=await upstream(c,'/storage/v1/object/'+BUCKET,{method:'DELETE',storage:true,body:{prefixes:[file.path]}});success=res.status===200||res.status===404;}catch{/* Keep the lease for a later scoped cleanup. */}try{await action(c,scope,'cleanup_finish',{fileId:file.fileId,token:file.token,success});}catch{/* A lost cleanup ACK is retried after the lease. */}}
 }catch{/* Cleanup must never turn a committed slot into a failed save. */}}
function queueCleanup(context,c,scope){if(typeof context.waitUntil==='function')context.waitUntil(cleanup(c,scope));}
async function readJSON(request){const bytes=await readBoundedBytes(request,4096);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_REQUEST');}}
async function upload(context,c,jwt,request){
 const bytes=await readBoundedBytes(request,MAX_BODY),headers=new Headers({'Content-Type':request.headers.get('Content-Type')});let form;
 try{form=await new Response(bytes,{headers}).formData();}catch{fail('INVALID_REQUEST');}
 const names=['action','companyId','kind','expectedRevision','requestId','file'];if([...form.keys()].length!==names.length||names.some(k=>!form.has(k)))fail('INVALID_REQUEST');
 if(form.get('action')!=='upload'||typeof form.get('expectedRevision')!=='string'||!/^(0|[1-9][0-9]{0,9})$/.test(form.get('expectedRevision')))fail('INVALID_REQUEST');
 const companyId=uuid(form.get('companyId')),k=kind(form.get('kind')),expectedRevision=revision(Number(form.get('expectedRevision'))),requestId=uuid(form.get('requestId')),file=form.get('file');
 if(!file||typeof file==='string'||typeof file.arrayBuffer!=='function'||typeof file.name!=='string'||!file.name.trim()||[...file.name].length>180||/[\u0000-\u001f\u007f/\\]/.test(file.name))fail('INVALID_REQUEST');
 if(file.size<1||file.size>MAX_FILE)fail('PAYLOAD_TOO_LARGE');const data=new Uint8Array(await file.arrayBuffer()),info=inspectOfficeImage(data,file.type.toLowerCase()),sha256=await hash(data),scope=await authorize(c,jwt,companyId);
 const prepared=await action(c,scope,'prepare',{requestId,kind:k,expectedRevision,filename:file.name,mimeType:info.mimeType,size:data.length,sha256,width:info.width,height:info.height,formatVersion:1});
 if(prepared.document){queueCleanup(context,c,scope);return json(ack(prepared));}
 const path=objectPath(scope,k,prepared.path);if(prepared.requestId!==requestId||!UUID.test(prepared.fileId||''))fail('NETWORK');
 try{
  if(prepared.stage==='pending'){
   try{const uploaded=await upstream(c,path,{storage:true,mime:info.mimeType,body:data});if(uploaded.status===409){const existing=await upstream(c,path,{method:'GET',binary:true,storage:true});if(!existing.bytes||existing.mimeType!==info.mimeType||existing.bytes.length!==data.length||await hash(existing.bytes)!==sha256)fail('CONFLICT');}}
   catch(e){if(e.code!=='NETWORK')throw e;const existing=await upstream(c,path,{method:'GET',binary:true,storage:true});if(!existing.bytes||existing.mimeType!==info.mimeType||existing.bytes.length!==data.length||await hash(existing.bytes)!==sha256)fail('NETWORK');}
   await action(c,scope,'verify',{requestId});
  }else if(prepared.stage!=='verified')fail('CONFLICT');
  let published;
  try{published=await action(c,scope,'publish',{requestId});}catch(e){if(e.code!=='NETWORK')throw e;const recovered=await action(c,scope,'status',{requestId});if(!recovered.document)throw e;published=recovered;}
  const result=ack(published);queueCleanup(context,c,scope);return json(result);
 }catch(e){if(['CONFLICT','INVALID_REQUEST','FORBIDDEN'].includes(e.code)){try{await action(c,scope,'discard',{requestId});}catch{/* Retain uncertain reservation for a safe later sweep. */}}queueCleanup(context,c,scope);throw e;}
}
export async function onRequest(context){
 try{const {request,env}=context;if(request.method!=='POST')fail('METHOD_NOT_ALLOWED');if(!sameOriginRequest(request)||request.headers.get('Content-Encoding')&&request.headers.get('Content-Encoding')!=='identity')fail('FORBIDDEN');
  const bearer=request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(bearer)||bearer.length>8200)fail('UNAUTHORIZED');
  const jwt=bearer.slice(7),c=config(env),type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(type==='multipart/form-data')return await upload(context,c,jwt,request);if(type!=='application/json')fail('UNSUPPORTED_MEDIA_TYPE');
  const b=await readJSON(request);if(!plain(b))fail('INVALID_REQUEST');const companyId=uuid(b.companyId),scope=await authorize(c,jwt,companyId);
  if(b.action==='list'){fields(b,['action','companyId']);const result=await action(c,scope,'list');if(!Array.isArray(result.documents)||result.documents.length!==KINDS.length)fail('NETWORK');const docs=result.documents.map(document);if(new Set(docs.map(d=>d.kind)).size!==KINDS.length)fail('NETWORK');queueCleanup(context,c,scope);return json({ok:true,companyId,documents:docs});}
  if(b.action==='read'){fields(b,['action','companyId','kind','fileId','revision']);const payload={kind:kind(b.kind),fileId:uuid(b.fileId),revision:revision(b.revision)},resolved=await action(c,scope,'read',payload),row=document(resolved.document);
   const asset=await upstream(c,objectPath(scope,row.kind,resolved.path),{method:'GET',binary:true,storage:true});if(!asset.bytes||asset.bytes.length!==row.size||asset.mimeType!==row.mimeType||await hash(asset.bytes)!==resolved.sha256)fail('NETWORK');inspectOfficeImage(asset.bytes,row.mimeType);
   const checked=await action(c,scope,'read',payload);if(checked.path!==resolved.path||checked.sha256!==resolved.sha256)fail('CONFLICT');
   return hardenAPIResponse(new Response(asset.bytes,{headers:{'Content-Type':row.mimeType,'Content-Length':String(asset.bytes.length),'Content-Disposition':'inline'}}));}
  if(b.action==='delete'){fields(b,['action','companyId','kind','fileId','expectedRevision','requestId']);const payload={kind:kind(b.kind),fileId:uuid(b.fileId),expectedRevision:revision(b.expectedRevision),requestId:uuid(b.requestId)};let deleted;
   try{deleted=await action(c,scope,'delete',payload);}catch(e){if(e.code!=='NETWORK')throw e;deleted=await action(c,scope,'status',{requestId:payload.requestId});if(!deleted.document)throw e;}
   queueCleanup(context,c,scope);return json(ack(deleted));}
  fail('INVALID_REQUEST');
 }catch(e){const code=ERRORS[e?.code]?e.code:e?.code==='REQUEST_TIMEOUT'?'NETWORK':'NETWORK',[status,error]=ERRORS[code];return json({ok:false,code,error},status);}
}
