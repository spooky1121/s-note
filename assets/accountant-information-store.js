/* Company information stays in memory and is published only after scoped server verification. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else if(!root.SnoteAccountantInformationData)root.SnoteAccountantInformationData=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,NIL='00000000-0000-0000-0000-000000000000',MAX_REVISION=2147483647,TIMEOUT=15000,CACHE_MS=30000;
 const KINDS=Object.freeze(['groups','contacts','accounts']),LIMITS=Object.freeze({groups:500,contacts:5000,accounts:2000});
 const FIELDS=Object.freeze({groups:Object.freeze(['id','name']),contacts:Object.freeze(['id','name','phone','groupId','memo']),accounts:Object.freeze(['id','bankName','accountNumber','memo'])});
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),copy=value=>JSON.parse(JSON.stringify(value));
 const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
 const failure=code=>Object.assign(Error(code),{code}),fail=code=>{throw failure(code);};
 const issue=code=>({ok:false,error:{code}}),empty=()=>({groups:[],contacts:[],accounts:[]});
 function kind(value){if(!KINDS.includes(value))fail('INFORMATION_INVALID_KIND');return value;}
 function uuid(value){if(typeof value!=='string'||!UUID.test(value)||value.toLowerCase()===NIL)fail('INFORMATION_INVALID_RECORD');return value.toLowerCase();}
 function text(value,max,{required=false,multiline=false}={}){
  if(typeof value!=='string')fail('INFORMATION_INVALID_RECORD');if(required)value=value.replace(/^ +| +$/g,'');
  const chars=Array.from(value);if(chars.length>max||required&&!chars.length||chars.some(c=>{const n=c.codePointAt(0);return n>=0xd800&&n<=0xdfff;})||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))fail('INFORMATION_INVALID_RECORD');return value;
 }
 function revision(value,{draft=false}={}){if(!Number.isInteger(value)||value<(draft?0:1)||value>MAX_REVISION)fail('INFORMATION_INVALID_REVISION');return value;}
 function timestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)||!Number.isFinite(Date.parse(value)))fail('INFORMATION_ACK_INVALID');
  const date=value.slice(0,10),[y,m,d]=date.split('-').map(Number),last=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];if(y<1||m<1||m>12||d<1||d>last)fail('INFORMATION_ACK_INVALID');return value;
 }
 function record(type,value,{stored=false}={}){
  kind(type);if(!object(value))fail('INFORMATION_INVALID_RECORD');
  const allowed=[...FIELDS[type],'revision',...(stored?['createdAt','updatedAt']:['createdAt','updatedAt'])];
  if(Object.keys(value).some(key=>!allowed.includes(key))||stored&&(!Object.keys(value).every(key=>allowed.includes(key))||Object.keys(value).length!==allowed.length))fail('INFORMATION_INVALID_RECORD');
  const out={id:uuid(value.id)};
  if(type==='groups')out.name=text(value.name,60,{required:true});
  if(type==='contacts'){
   out.name=text(value.name,100,{required:true});out.phone=text(value.phone,40,{required:true});
   const digits=out.phone.replace(/\D/g,'').length;if(!/^\+?[0-9() -]+$/.test(out.phone)||digits<7||digits>20)fail('INFORMATION_INVALID_RECORD');
   out.groupId=value.groupId===null?null:uuid(value.groupId);out.memo=text(value.memo,2000,{multiline:true});
  }
  if(type==='accounts'){
   out.bankName=text(value.bankName,60,{required:true});out.accountNumber=text(value.accountNumber,64,{required:true});
   const digits=out.accountNumber.replace(/\D/g,'').length;if(!/^[0-9 -]+$/.test(out.accountNumber)||digits<6||digits>40)fail('INFORMATION_INVALID_RECORD');out.memo=text(value.memo,2000,{multiline:true});
  }
  out.revision=revision(value.revision,{draft:!stored});
  if(stored){out.createdAt=timestamp(value.createdAt);out.updatedAt=timestamp(value.updatedAt);if(Date.parse(out.updatedAt)<Date.parse(out.createdAt))fail('INFORMATION_ACK_INVALID');}
  return out;
 }
 function randomId(){if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();if(!root.crypto?.getRandomValues)fail('INFORMATION_UNAVAILABLE');const b=root.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
 function newRecord(type,values={}){
  kind(type);if(!object(values))fail('INFORMATION_INVALID_RECORD');
  const defaults=type==='groups'?{name:''}:type==='contacts'?{name:'',phone:'',groupId:null,memo:''}:{bankName:'',accountNumber:'',memo:''};
  const out={id:randomId(),...defaults};for(const field of FIELDS[type])if(Object.hasOwn(values,field))out[field]=values[field];out.id=uuid(out.id);return {...out,revision:0};
 }
 const payload=(type,value)=>Object.fromEntries(FIELDS[type].map(field=>[field,value[field]]));
 const equal=(type,a,b)=>FIELDS[type].every(field=>a[field]===b[field]);
 const scope=value=>Object.fromEntries(['key','actorId','companyId','role','ready'].map(key=>[key,value[key]]));
 const same=(a,b)=>!!a&&!!b&&['key','actorId','companyId','role','ready'].every(key=>a[key]===b[key]);
 function contextValid(value){return object(value)&&value.ready===true&&typeof value.key==='string'&&value.key.length>0&&value.key.length<=2000&&!/[\u0000-\u001f\u007f]/.test(value.key)&&UUID.test(value.actorId||'')&&value.actorId.toLowerCase()!==NIL&&UUID.test(value.companyId||'')&&value.companyId.toLowerCase()!==NIL&&['admin','accountant'].includes(value.role);}
 function scopeAck(result,ctx){if(!object(result)||result.ok!==true||result.companyId!==ctx.companyId.toLowerCase())fail('INFORMATION_ACK_INVALID');}
 function listAck(result,ctx){
  scopeAck(result,ctx);if(result.complete!==true||!object(result.counts)||Object.keys(result.counts).length!==3)fail('INFORMATION_ACK_INVALID');
  const data=empty();for(const type of KINDS){const count=result.counts[type],rows=result[type];if(!Number.isSafeInteger(count)||count<0||count>LIMITS[type]||!Array.isArray(rows)||rows.length!==count)fail('INFORMATION_ACK_INVALID');const ids=new Set();data[type]=rows.map(value=>{let row;try{row=record(type,value,{stored:true});}catch{fail('INFORMATION_ACK_INVALID');}if(ids.has(row.id))fail('INFORMATION_ACK_INVALID');ids.add(row.id);return row;});}
  const groups=new Set(data.groups.map(row=>row.id));if(data.contacts.some(row=>row.groupId!==null&&!groups.has(row.groupId)))fail('INFORMATION_ACK_INVALID');return freeze(data);
 }
 function saveAck(result,ctx,type,desired,expected){scopeAck(result,ctx);if(result.kind!==type||typeof result.duplicate!=='boolean')fail('INFORMATION_ACK_INVALID');let saved;try{saved=record(type,result.record,{stored:true});}catch{fail('INFORMATION_ACK_INVALID');}if(saved.revision!==expected+1||!equal(type,saved,desired))fail('INFORMATION_ACK_INVALID');return saved;}
 function deleteAck(result,ctx,type,id,expected){scopeAck(result,ctx);if(result.kind!==type||result.id!==id||result.revision!==expected+1||result.deleted!==true||typeof result.duplicate!=='boolean')fail('INFORMATION_ACK_INVALID');return {id,revision:result.revision,deleted:true};}
 const known=new Set(['INFORMATION_CONTEXT_CHANGED','INFORMATION_STALE','INFORMATION_UNAVAILABLE','INFORMATION_NETWORK','INFORMATION_TIMEOUT','INFORMATION_ACK_INVALID','INFORMATION_BUSY','INFORMATION_INVALID_RECORD','INFORMATION_INVALID_KIND','INFORMATION_INVALID_REVISION','INFORMATION_CONFLICT','INFORMATION_RECORD_UNAVAILABLE','INFORMATION_GROUP_IN_USE','INFORMATION_GROUP_UNAVAILABLE','INFORMATION_GROUP_EXISTS','INFORMATION_LIMIT_REACHED','INFORMATION_UNCERTAIN_EDIT','INFORMATION_DESTROYED']);
 function codeOf(error){if(known.has(error?.code))return error.code;if(known.has(error?.message))return error.message;return {INFORMATION_FORBIDDEN:'INFORMATION_CONTEXT_CHANGED',INFORMATION_SETUP_REQUIRED:'INFORMATION_UNAVAILABLE',INFORMATION_INVALID_RESPONSE:'INFORMATION_ACK_INVALID','42501':'INFORMATION_CONTEXT_CHANGED','40001':'INFORMATION_CONFLICT','23505':'INFORMATION_CONFLICT','23514':'INFORMATION_INVALID_RECORD','22023':'INFORMATION_INVALID_RECORD','54000':'INFORMATION_LIMIT_REACHED','PGRST202':'INFORMATION_UNAVAILABLE','42883':'INFORMATION_UNAVAILABLE',CONTEXT_CHANGED:'INFORMATION_CONTEXT_CHANGED',FORBIDDEN:'INFORMATION_CONTEXT_CHANGED',NETWORK:'INFORMATION_NETWORK',SETUP_REQUIRED:'INFORMATION_UNAVAILABLE'}[error?.code]||'INFORMATION_NETWORK';}
 const uncertainCodes=new Set(['INFORMATION_NETWORK','INFORMATION_TIMEOUT','INFORMATION_ACK_INVALID']);
 function create(options={}){
  let state=null,epoch=0,alive=true,denied=null;const watchers=[];
  const api=()=>options.bridge||root.snoteAccountantInformationBridge,now=typeof options.now==='function'?options.now:()=>Date.now(),notify=typeof options.onChange==='function'?options.onChange:()=>{};
  const active=()=>{try{return typeof options.isActive!=='function'||options.isActive()===true;}catch{return false;}};
  const context=()=>{try{const value=typeof options.context==='function'?options.context():api()?.context?.();return contextValid(value)&&active()?value:null;}catch{return null;}};
  function valid(s){if(!alive||state!==s||s.epoch!==epoch||s.api!==api()||!same(context(),s.scope))return false;try{return (options.current||s.api?.current)?.call(s.api,s.context)===true;}catch{return false;}}
  function clear(){epoch++;if(state){for(const job of state.jobs)job.abort();state.data=empty();state.readTask=null;state.uncertain.clear();}state=null;}
  function ensure(){
   if(!alive)return null;const ctx=context();if(!ctx){clear();return null;}if(denied){if(denied.api===api()&&same(denied.scope,scope(ctx))){if(state)clear();return null;}denied=null;}
   if(state&&!valid(state))clear();if(!state)state={context:ctx,scope:scope(ctx),api:api(),epoch,version:0,status:'idle',loaded:false,at:0,data:empty(),error:null,uncertain:new Map(),readTask:null,mutation:null,jobs:new Set()};return state;
  }
  const unavailable=()=>!alive?'INFORMATION_DESTROYED':denied?'INFORMATION_CONTEXT_CHANGED':'INFORMATION_UNAVAILABLE';
  function snapshot(){const s=ensure();return freeze(s?copy({key:s.scope.key,status:s.status,loaded:s.loaded,...s.data,error:s.error,uncertain:s.uncertain.size>0,busy:!!s.mutation}):{key:null,status:'unavailable',loaded:false,...empty(),error:{code:unavailable()},uncertain:false,busy:false});}
  function emit(){try{notify(snapshot());}catch{/* Presentation errors cannot change a scoped operation. */}}
  function deny(s){denied={scope:s.scope,api:s.api};clear();emit();}
  function apply(s,data){s.data=data;s.loaded=true;s.at=now();}
  function call(s,method,args,version=s.version){
   const controller=new AbortController();s.jobs.add(controller);let timer,onAbort;
   const current=()=>valid(s)&&s.version===version;
   const aborted=new Promise((_,reject)=>{onAbort=()=>reject(failure('INFORMATION_STALE'));controller.signal.addEventListener('abort',onAbort,{once:true});});
   const work=Promise.resolve().then(()=>{if(!current())fail('INFORMATION_STALE');const fn=s.api?.[method];if(typeof fn!=='function')fail('INFORMATION_UNAVAILABLE');return fn.call(s.api,s.context,...args);});
   const timed=new Promise((_,reject)=>{timer=root.setTimeout(()=>reject(failure('INFORMATION_TIMEOUT')),Number.isFinite(options.timeoutMs)?Math.max(1,options.timeoutMs):TIMEOUT);});
   return Promise.race([work,aborted,timed]).then(result=>{if(!current())fail('INFORMATION_STALE');return result;}).finally(()=>{root.clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);s.jobs.delete(controller);});
  }
  function read(s,{force=false,publish=true}={}){
   if(!valid(s))return Promise.resolve(issue('INFORMATION_STALE'));if(s.readTask)return s.readTask;
   if(!force&&s.loaded&&s.at<=now()&&now()-s.at<CACHE_MS){if(publish){s.status='ready';s.error=null;emit();}return Promise.resolve({ok:true,data:s.data,cached:true});}
   const version=s.version,job=Promise.resolve().then(async()=>{
    try{const raw=await call(s,'list',[],version);const data=listAck(raw,s.scope);if(!valid(s)||s.version!==version)return issue('INFORMATION_STALE');if(publish){apply(s,data);s.status='ready';s.error=null;emit();}return {ok:true,data};}
    catch(error){const code=valid(s)&&s.version===version?codeOf(error):'INFORMATION_STALE';if(code==='INFORMATION_CONTEXT_CHANGED'&&valid(s)){deny(s);return issue(code);}if(publish&&valid(s)&&s.version===version){s.status='error';s.error={code};emit();}return issue(code);}
    finally{if(s.readTask===job)s.readTask=null;}
   });s.readTask=job;if(publish){s.status='loading';s.error=null;emit();}return job;
  }
  function refresh({force=false}={}){const s=ensure();if(!s)return Promise.resolve(issue(unavailable()));if(s.mutation)return Promise.resolve(issue('INFORMATION_BUSY'));return read(s,{force});}
  function patch(s,type,saved,deleted){
   const data=copy(s.data),id=saved?.id||deleted.id;data[type]=data[type].filter(row=>row.id!==id);if(saved)data[type].push(saved);
   try{const checked=listAck({ok:true,companyId:s.scope.companyId.toLowerCase(),complete:true,...data,counts:Object.fromEntries(KINDS.map(k=>[k,data[k].length]))},s.scope);apply(s,checked);}catch{s.data=empty();s.loaded=false;s.at=0;}
  }
  function mutate(operation,type,input,explicitExpected){
   const s=ensure();if(!s)return Promise.resolve(issue(unavailable()));let desired,id,expected;
   try{kind(type);if(operation==='save'){desired=record(type,{...input,revision:explicitExpected??input?.revision});id=desired.id;expected=desired.revision;}else{if(!object(input))fail('INFORMATION_INVALID_RECORD');id=uuid(input.id);expected=revision(input.revision);}if(expected>=MAX_REVISION)fail('INFORMATION_INVALID_REVISION');}catch(error){return Promise.resolve(issue(codeOf(error)));}
   const fingerprint=JSON.stringify([operation,type,id,expected,desired?payload(type,desired):null]);
   if(s.mutation)return s.mutation.fingerprint===fingerprint?s.mutation.promise:Promise.resolve(issue('INFORMATION_BUSY'));
   if(!s.loaded)return Promise.resolve(issue('INFORMATION_UNAVAILABLE'));
   const uncertainKey=type+':'+id,prior=s.uncertain.get(uncertainKey);
   if(prior&&prior.fingerprint!==fingerprint){const current=s.data[type].find(row=>row.id===id);if(expected>prior.expected&&current?.revision===expected)s.uncertain.delete(uncertainKey);else return Promise.resolve({...issue('INFORMATION_UNCERTAIN_EDIT'),recordId:id,uncertain:true});}
   s.version++;s.readTask=null;s.status='saving';s.error=null;const task={fingerprint,promise:null};s.mutation=task;
   task.promise=Promise.resolve().then(async()=>{
    let saved=null,deleted=null,problem=null,uncertain=false;
    try{const raw=await call(s,operation==='save'?'save':'remove',operation==='save'?[type,payload(type,desired),expected]:[type,id,expected]);if(operation==='save')saved=saveAck(raw,s.scope,type,desired,expected);else deleted=deleteAck(raw,s.scope,type,id,expected);}
    catch(error){if(!valid(s))return issue('INFORMATION_STALE');problem=codeOf(error);if(problem==='INFORMATION_CONTEXT_CHANGED'){deny(s);return issue(problem);}uncertain=uncertainCodes.has(problem);}
    if(!valid(s))return issue('INFORMATION_STALE');
    const refreshed=await read(s,{force:true,publish:false});if(refreshed.error?.code==='INFORMATION_CONTEXT_CHANGED')return refreshed;if(!valid(s))return issue('INFORMATION_STALE');
    if(refreshed.ok){apply(s,refreshed.data);if(uncertain&&operation==='save'){const confirmed=refreshed.data[type].find(row=>row.id===id);if(confirmed?.revision===expected+1&&equal(type,confirmed,desired)){saved=confirmed;problem=null;uncertain=false;}}}
    else if(saved||deleted)patch(s,type,saved,deleted);
    if(uncertain)s.uncertain.set(uncertainKey,{type,id,expected,fingerprint});else s.uncertain.delete(uncertainKey);
    const ok=!!(saved||deleted);s.status=ok&&refreshed.ok?'ready':'error';s.error=problem?{code:problem,uncertain}:refreshed.ok?null:{code:refreshed.error.code};emit();
    return ok?{ok:true,...(saved?{record:freeze(copy(saved))}:deleted),...(refreshed.ok?{}:{refreshError:refreshed.error})}:{...issue(problem||'INFORMATION_NETWORK'),recordId:id,uncertain};
   }).finally(()=>{if(valid(s)&&s.mutation===task){s.mutation=null;emit();}});emit();return task.promise;
  }
  function reset(){clear();emit();}
  function destroy(){clear();alive=false;for(const[name,listener]of watchers)root.removeEventListener?.(name,listener);emit();}
  if(typeof root.addEventListener==='function')for(const name of ['snote:auth-reset','pagehide','snote:route-changed']){const listener=()=>{if(name!=='snote:route-changed'||!active())reset();};root.addEventListener(name,listener);watchers.push([name,listener]);}
  return Object.freeze({refresh,load:refresh,snapshot,newRecord,save:(type,row,expected)=>mutate('save',type,row,expected),remove:(type,row)=>mutate('remove',type,row),
   saveContact:(row,expected)=>mutate('save','contacts',row,expected),saveGroup:(row,expected)=>mutate('save','groups',row,expected),saveAccount:(row,expected)=>mutate('save','accounts',row,expected),
   removeContact:(id,expected)=>mutate('remove','contacts',{id,revision:expected}),removeGroup:(id,expected)=>mutate('remove','groups',{id,revision:expected}),removeAccount:(id,expected)=>mutate('remove','accounts',{id,revision:expected}),reset,destroy});
 }
 return Object.freeze({create,newRecord,model:Object.freeze({record,listAck,payload,limits:LIMITS,maxRevision:MAX_REVISION})});
});
