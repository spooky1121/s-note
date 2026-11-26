/* Personal scheduler state. Private events stay in memory and enter the view only after server verification. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else if(!root.SnoteDealerSchedulerData)root.SnoteDealerSchedulerData=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,MAX_REVISION=2147483647,MAX_EVENTS=500,SIDE_LIMIT=50,CACHE_MS=30000,TIMEOUT=15000;
 const keys=['calendar','today','upcoming','overdue'];
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const failure=(code,extra={})=>Object.assign(Error(code),{code,...extra});
 const fail=code=>{throw failure(code);};
 const copy=value=>JSON.parse(JSON.stringify(value));
 const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
 const pad=value=>String(value).padStart(2,'0');
 function isMonth(value){return typeof value==='string'&&/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value);}
 function isDate(value){
  if(typeof value!=='string'||!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number),last=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];return d<=last;
 }
 function utc(value){const [y,m,d]=value.split('-').map(Number),date=new Date(0);date.setUTCFullYear(y,m-1,d);date.setUTCHours(0,0,0,0);return date;}
 const dateKey=date=>{const y=date.getUTCFullYear();return y>=1&&y<=9999?String(y).padStart(4,'0')+'-'+pad(date.getUTCMonth()+1)+'-'+pad(date.getUTCDate()):null;};
 function businessDate(value=new Date()){
  const now=value instanceof Date?value:new Date(value);if(!Number.isFinite(now.getTime()))fail('SCHEDULE_INVALID_DATE');
  const shifted=new Date(now.getTime()+9*3600000),result=dateKey(shifted);if(!result)fail('SCHEDULE_INVALID_DATE');return result;
 }
 function shiftMonth(month,delta){
  if(!isMonth(month)||!Number.isSafeInteger(delta))return null;
  const [y,m]=month.split('-').map(Number),index=(y-1)*12+m-1+delta;
  if(!Number.isSafeInteger(index)||index<0||index>=9999*12)return null;return String(Math.floor(index/12)+1).padStart(4,'0')+'-'+pad(index%12+1);
 }
 function calendarGrid(month){
  if(!isMonth(month))fail('SCHEDULE_INVALID_MONTH');const first=utc(month+'-01'),start=first.getTime()-first.getUTCDay()*86400000;
  return Array.from({length:42},(_,i)=>dateKey(new Date(start+i*86400000)));
 }
 function monthRange(month){const dates=calendarGrid(month).filter(Boolean);return {rangeStart:dates[0],rangeEnd:dates.at(-1)};}
 function text(value,max,{required=false,multiline=false}={}){
  if(typeof value!=='string')fail('SCHEDULE_INVALID_EVENT');if(required)value=value.trim();
  const chars=Array.from(value);if(chars.length>max||required&&!chars.length||chars.some(char=>{const n=char.codePointAt(0);return n>=0xd800&&n<=0xdfff;})||
   (multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))fail('SCHEDULE_INVALID_EVENT');return value;
 }
 function revision(value,{draft=false}={}){if(!Number.isInteger(value)||value<(draft?0:1)||value>MAX_REVISION)fail('SCHEDULE_INVALID_REVISION');return value;}
 function event(value,{stored=false}={}){
  if(!object(value)||typeof value.id!=='string'||!UUID.test(value.id)||!isDate(value.eventDate)||typeof value.completed!=='boolean'||
   value.time!==null&&(typeof value.time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)))fail('SCHEDULE_INVALID_EVENT');
  const out={id:value.id.toLowerCase(),title:text(value.title,100,{required:true}),eventDate:value.eventDate,time:value.time,
   notes:text(value.notes,2000,{multiline:true}),completed:value.completed,revision:revision(value.revision,{draft:!stored})};
  if(stored){for(const name of ['createdAt','updatedAt']){
   const timestamp=value[name];if(typeof timestamp!=='string'||!isDate(timestamp.slice(0,10))||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(timestamp)||!Number.isFinite(Date.parse(timestamp)))fail('SCHEDULE_ACK_INVALID');out[name]=timestamp;
  }}return out;
 }
 function uuid(){if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();if(!root.crypto?.getRandomValues)fail('SCHEDULE_UNAVAILABLE');const b=root.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
 function newEvent(values={}){
  if(!object(values))fail('SCHEDULE_INVALID_EVENT');const day=values.eventDate??businessDate();if(!isDate(day))fail('SCHEDULE_INVALID_DATE');
  return {id:uuid(),title:'',eventDate:day,time:null,notes:'',completed:false,...values,revision:0,updatedAt:null};
 }
 const payload=value=>Object.fromEntries(['id','title','notes','eventDate','time','completed'].map(key=>[key,value[key]]));
 const equal=(a,b)=>JSON.stringify(payload(a))===JSON.stringify(payload(b));
 const sameScope=(a,b)=>!!a&&!!b&&['key','actorId','companyId','role','ready'].every(key=>a[key]===b[key]);
 function validContext(value){return object(value)&&typeof value.key==='string'&&value.key.length>0&&value.key.length<=2000&&UUID.test(value.actorId||'')&&UUID.test(value.companyId||'')&&['dealer','admin','accountant'].includes(value.role)&&value.ready===true;}
 function scopeAck(result,ctx){if(!object(result)||result.companyId!==ctx.companyId||result.ownerId!==ctx.actorId)fail('SCHEDULE_ACK_INVALID');}
 function listAck(result,ctx,month){
  scopeAck(result,ctx);const range=monthRange(month);
  if(result.month!==month||!isDate(result.today)||result.rangeStart!==range.rangeStart||result.rangeEnd!==range.rangeEnd||!object(result.counts)||!object(result.truncated)||!object(result.dayCounts))fail('SCHEDULE_ACK_INVALID');
  const arrays={calendar:result.events,today:result.todayEvents,upcoming:result.upcomingEvents,overdue:result.overdueEvents},seen=new Map();
  for(const key of keys){
   const limit=key==='calendar'?MAX_EVENTS:SIDE_LIMIT,count=result.counts[key];if(!Number.isSafeInteger(count)||count<0||typeof result.truncated[key]!=='boolean'||result.truncated[key]!==count>limit||!Array.isArray(arrays[key])||arrays[key].length!==Math.min(count,limit))fail('SCHEDULE_ACK_INVALID');
   const local=new Set();arrays[key]=arrays[key].map(row=>{
    const item=event(row,{stored:true});if(local.has(item.id))fail('SCHEDULE_ACK_INVALID');local.add(item.id);
    if(key==='calendar'&&(item.eventDate<range.rangeStart||item.eventDate>range.rangeEnd)||key==='today'&&item.eventDate!==result.today||key==='upcoming'&&(item.eventDate<=result.today||item.completed)||key==='overdue'&&(item.eventDate>=result.today||item.completed))fail('SCHEDULE_ACK_INVALID');
    if(seen.has(item.id)&&JSON.stringify(seen.get(item.id))!==JSON.stringify(item))fail('SCHEDULE_ACK_INVALID');seen.set(item.id,item);return item;
   });
  }
  const days=calendarGrid(month).filter(Boolean),dayKeys=Object.keys(result.dayCounts);if(dayKeys.length!==days.length||dayKeys.some(day=>!days.includes(day)))fail('SCHEDULE_ACK_INVALID');
  let total=0;const dayCounts={};for(const day of days){const count=result.dayCounts[day];if(!Number.isSafeInteger(count)||count<0)fail('SCHEDULE_ACK_INVALID');total+=count;if(!Number.isSafeInteger(total))fail('SCHEDULE_ACK_INVALID');dayCounts[day]=count;}
  if(total!==result.counts.calendar||arrays.calendar.some(row=>dayCounts[row.eventDate]<arrays.calendar.filter(x=>x.eventDate===row.eventDate).length))fail('SCHEDULE_ACK_INVALID');
  return freeze({month,today:result.today,...range,items:arrays.calendar,agenda:{today:arrays.today,upcoming:arrays.upcoming,overdue:arrays.overdue,counts:copy(result.counts),truncated:copy(result.truncated)},dayCounts});
 }
 function saveAck(result,ctx,desired,expected){scopeAck(result,ctx);if(result.ok!==true||typeof result.duplicate!=='boolean')fail('SCHEDULE_ACK_INVALID');const saved=event(result.event,{stored:true});if(saved.id!==desired.id||saved.revision!==expected+1||!equal(saved,desired))fail('SCHEDULE_ACK_INVALID');return saved;}
 function deleteAck(result,ctx,id,expected){scopeAck(result,ctx);if(result.ok!==true||result.deleted!==true||result.id!==id||result.revision!==expected+1||typeof result.duplicate!=='boolean')fail('SCHEDULE_ACK_INVALID');return {id,revision:result.revision,deleted:true};}
 const known=new Set(['SCHEDULE_CONTEXT_CHANGED','SCHEDULE_EVENT_UNAVAILABLE','SCHEDULE_CONFLICT','SCHEDULE_INVALID_EVENT','SCHEDULE_INVALID_MONTH','SCHEDULE_INVALID_REVISION','SCHEDULE_LIMIT','SCHEDULE_UNAVAILABLE','SCHEDULE_STALE','SCHEDULE_NETWORK','SCHEDULE_TIMEOUT','SCHEDULE_ACK_INVALID','SCHEDULE_BUSY','SCHEDULE_UNCERTAIN_EDIT','SCHEDULE_DESTROYED']);
 function codeOf(error){if(known.has(error?.code))return error.code;if(known.has(error?.message))return error.message;const mapped={CONTEXT_CHANGED:'SCHEDULE_CONTEXT_CHANGED',FORBIDDEN:'SCHEDULE_CONTEXT_CHANGED',CONFLICT:'SCHEDULE_CONFLICT',INVALID_DATA:'SCHEDULE_INVALID_EVENT',INVALID_RESPONSE:'SCHEDULE_ACK_INVALID',SETUP_REQUIRED:'SCHEDULE_UNAVAILABLE',NETWORK:'SCHEDULE_NETWORK','42501':'SCHEDULE_CONTEXT_CHANGED','40001':'SCHEDULE_CONFLICT'};return mapped[error?.code]||'SCHEDULE_NETWORK';}
 const errorResult=code=>({ok:false,error:{code}});
 function create(options={}){
  let state=null,epoch=0,alive=true,denied=null;const watchers=[];
  const now=typeof options.now==='function'?options.now:()=>Date.now(),onChange=typeof options.onChange==='function'?options.onChange:()=>{};
  const active=typeof options.isActive==='function'?options.isActive:()=>true;
  const api=()=>options.bridge||root.snoteDealerSchedulerBridge;
  const context=()=>{try{const value=typeof options.context==='function'?options.context():api()?.context?.();return validContext(value)&&active()?value:null;}catch{return null;}};
  function valid(s){if(!alive||state!==s||s.epoch!==epoch||s.api!==api())return false;const latest=context();if(!sameScope(latest,s.context))return false;try{return (options.current||s.api?.current)?.(s.context)===true;}catch{return false;}}
  function clear(){epoch++;if(state){for(const job of state.jobs)job.abort();state.cache.clear();state.reads.clear();state.items=[];state.agenda=null;state.uncertain=null;}state=null;}
  function deny(s){denied={context:s.context,api:s.api};clear();}
  const unavailableCode=()=>!alive?'SCHEDULE_DESTROYED':denied?'SCHEDULE_CONTEXT_CHANGED':'SCHEDULE_UNAVAILABLE';
  function ensure(){if(!alive)return null;const ctx=context();if(!ctx){clear();return null;}if(denied){if(denied.api===api()&&sameScope(denied.context,ctx)){if(state)clear();return null;}denied=null;}if(state&&!valid(state))clear();if(!state)state={epoch,key:ctx.key,context:{...ctx},api:api(),month:businessDate(now()).slice(0,7),status:'idle',items:[],agenda:null,dayCounts:{},today:null,rangeStart:null,rangeEnd:null,error:null,uncertain:null,cache:new Map(),reads:new Map(),jobs:new Set(),mutation:null,version:0};return state;}
  function snapshot(){const s=ensure();return freeze(s?copy({key:s.key,month:s.month,status:s.status,items:s.items,agenda:s.agenda,dayCounts:s.dayCounts,today:s.today,rangeStart:s.rangeStart,rangeEnd:s.rangeEnd,error:s.error,uncertain:!!s.uncertain}):{key:null,month:null,status:'unavailable',items:[],agenda:null,dayCounts:{},today:null,rangeStart:null,rangeEnd:null,error:{code:unavailableCode()},uncertain:false});}
  function emit(){try{onChange(snapshot());}catch{/* A view callback cannot alter an authenticated operation. */}}
  function apply(s,value){s.items=value.items;s.agenda=value.agenda;s.dayCounts=value.dayCounts;s.today=value.today;s.rangeStart=value.rangeStart;s.rangeEnd=value.rangeEnd;}
  function remember(s,month,value){s.cache.delete(month);s.cache.set(month,{at:now(),value});while(s.cache.size>6)s.cache.delete(s.cache.keys().next().value);}
  function call(s,method,args,version){
   const controller=new AbortController();s.jobs.add(controller);let timer,onAbort;
   const validJob=()=>valid(s)&&(version===undefined||s.version===version);
   const aborted=new Promise((_,reject)=>{onAbort=()=>reject(failure('SCHEDULE_STALE'));controller.signal.addEventListener('abort',onAbort,{once:true});});
   const work=Promise.resolve().then(()=>{if(!validJob())fail('SCHEDULE_STALE');const fn=options[method==='listMonth'?'readMonth':method==='save'?'saveEvent':'deleteEvent']||s.api?.[method];if(typeof fn!=='function')fail('SCHEDULE_UNAVAILABLE');return fn.call(s.api,s.context,...args);});
   const timed=new Promise((_,reject)=>{timer=root.setTimeout(()=>reject(failure('SCHEDULE_TIMEOUT')),Number.isFinite(options.timeoutMs)?Math.max(1,options.timeoutMs):TIMEOUT);});
   return Promise.race([work,aborted,timed]).then(value=>{if(!validJob())fail('SCHEDULE_STALE');return value;}).finally(()=>{root.clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);s.jobs.delete(controller);});
  }
  function read(s,month,{force=false,publish=true}={}){
   if(!valid(s))return Promise.resolve(errorResult('SCHEDULE_STALE'));
   const pending=s.reads.get(month);if(pending)return pending;
   const cached=s.cache.get(month);if(!force&&cached&&now()-cached.at<CACHE_MS&&cached.at<=now()&&cached.value.today===businessDate(now())){if(publish&&s.month===month){apply(s,cached.value);s.status='ready';s.error=null;emit();}return Promise.resolve({ok:true,data:cached.value,cached:true});}
  const version=s.version;
   const job=Promise.resolve().then(async()=>{
    try{const raw=await call(s,'listMonth',[month],version);let result;try{result=listAck(raw,s.context,month);}catch{fail('SCHEDULE_ACK_INVALID');}if(!valid(s)||s.version!==version)return errorResult('SCHEDULE_STALE');remember(s,month,result);if(publish&&s.month===month){apply(s,result);s.status='ready';s.error=null;emit();}return {ok:true,data:result};}
    catch(error){const code=valid(s)&&s.version===version?codeOf(error):'SCHEDULE_STALE';if(code==='SCHEDULE_CONTEXT_CHANGED'&&valid(s)){deny(s);emit();}if(publish&&valid(s)&&s.version===version&&s.month===month){s.status='error';s.error={code};emit();}return errorResult(code);}
    finally{if(s.reads.get(month)===job)s.reads.delete(month);}
   });s.reads.set(month,job);if(publish){s.status='loading';s.error=null;emit();}return job;
  }
  function refresh({month,force=false}={}){
   const s=ensure();if(!s)return Promise.resolve(errorResult(unavailableCode()));
   if(s.mutation)return Promise.resolve(errorResult('SCHEDULE_BUSY'));month=month??s.month;if(!isMonth(month))return Promise.resolve(errorResult('SCHEDULE_INVALID_MONTH'));
   if(s.month!==month){s.month=month;s.items=[];s.dayCounts={};s.rangeStart=s.rangeEnd=null;}return read(s,month,{force});
  }
  function beginMutation(kind,input){
   const s=ensure();if(!s)return Promise.resolve(errorResult(unavailableCode()));
   let desired,id,expected;try{if(kind==='save'){desired=event(input);id=desired.id;expected=desired.revision;}else{if(!object(input)||!UUID.test(input.id||''))fail('SCHEDULE_INVALID_EVENT');id=input.id.toLowerCase();expected=revision(input.revision);}
    if(expected>=MAX_REVISION)fail('SCHEDULE_INVALID_REVISION');
   }catch(error){return Promise.resolve(errorResult(codeOf(error)));}
   const fingerprint=JSON.stringify([kind,id,expected,desired?payload(desired):null]);
   if(s.mutation)return s.mutation.fingerprint===fingerprint?s.mutation.promise:Promise.resolve(errorResult('SCHEDULE_BUSY'));
   if(s.uncertain&&s.uncertain.id===id&&s.uncertain.fingerprint!==fingerprint)return Promise.resolve({...errorResult('SCHEDULE_UNCERTAIN_EDIT'),eventId:id,uncertain:true});
   s.version++;s.reads.clear();s.cache.clear();s.status='saving';s.error=null;const operation={fingerprint,promise:null};s.mutation=operation;
   operation.promise=Promise.resolve().then(async()=>{
    let saved=null,deleted=null,problem=null,uncertain=false,verifiedRead=null;
    try{
     const result=await call(s,kind,kind==='save'?[payload(desired),expected]:[id,expected]);
     try{if(kind==='save')saved=saveAck(result,s.context,desired,expected);else deleted=deleteAck(result,s.context,id,expected);}catch{fail('SCHEDULE_ACK_INVALID');}
    }catch(error){
     if(!valid(s))return errorResult('SCHEDULE_STALE');const code=codeOf(error),definite=['SCHEDULE_CONTEXT_CHANGED','SCHEDULE_EVENT_UNAVAILABLE','SCHEDULE_CONFLICT','SCHEDULE_INVALID_EVENT','SCHEDULE_INVALID_MONTH','SCHEDULE_INVALID_REVISION','SCHEDULE_LIMIT','SCHEDULE_UNAVAILABLE'].includes(code);
     problem=code;uncertain=!definite;
     if(code==='SCHEDULE_CONTEXT_CHANGED'){deny(s);emit();return errorResult(code);}
     if(uncertain&&kind==='save'){
      const result=await read(s,desired.eventDate.slice(0,7),{force:true,publish:false});if(!valid(s))return errorResult('SCHEDULE_STALE');
      if(result.ok){verifiedRead=result.data;const matched=[...result.data.items,...result.data.agenda.today,...result.data.agenda.upcoming,...result.data.agenda.overdue].find(row=>row.id===id);if(matched&&matched.revision===expected+1&&equal(matched,desired)){saved=matched;problem=null;uncertain=false;}}
     }
    }
    if(!valid(s))return errorResult('SCHEDULE_STALE');
    s.uncertain=uncertain?{id,fingerprint}:null;
    const refreshed=verifiedRead?.month===s.month?{ok:true,data:verifiedRead}:await read(s,s.month,{force:true,publish:false});if(!valid(s))return errorResult('SCHEDULE_STALE');
    if(!refreshed.ok&&refreshed.error.code==='SCHEDULE_CONTEXT_CHANGED'){s.status='error';s.error={code:'SCHEDULE_CONTEXT_CHANGED'};emit();return errorResult('SCHEDULE_CONTEXT_CHANGED');}
    if(refreshed.ok)apply(s,refreshed.data);
    else if(saved){const items=s.items.filter(row=>row.id!==id);if(s.rangeStart&&saved.eventDate>=s.rangeStart&&saved.eventDate<=s.rangeEnd)items.push(saved);s.items=items;s.agenda=null;s.dayCounts={};}
    else if(deleted){s.items=s.items.filter(row=>row.id!==id);s.agenda=null;s.dayCounts={};}
    const ok=!!(saved||deleted);s.status=ok&&refreshed.ok?'ready':'error';s.error=problem?{code:problem,uncertain}:refreshed.ok?null:{code:refreshed.error.code};emit();
    return ok?{ok:true,...(saved?{event:copy(saved)}:{...deleted}),...(refreshed.ok?{}:{refreshError:refreshed.error})}:{ok:false,error:{code:problem||'SCHEDULE_NETWORK'},eventId:id,uncertain};
   }).finally(()=>{if(valid(s)&&s.mutation===operation){s.mutation=null;emit();}});emit();return operation.promise;
  }
  function reset(){clear();emit();}
  function destroy(){clear();alive=false;for(const [name,listener]of watchers)root.removeEventListener?.(name,listener);emit();}
  if(typeof root.addEventListener==='function')for(const name of ['snote:auth-reset','pagehide','snote:route-changed']){const listener=event=>{if(name!=='snote:route-changed'||event.detail?.page!=='dashboard')reset();};root.addEventListener(name,listener);watchers.push([name,listener]);}
  return Object.freeze({refresh,snapshot,newEvent,upsert:input=>beginMutation('save',input),remove:input=>beginMutation('remove',input),reset,destroy});
 }
 const model=Object.freeze({businessDate,isDate,isMonth,shiftMonth,calendarGrid,monthRange,event,newEvent,maxRevision:MAX_REVISION});
 return Object.freeze({create,newEvent,model});
});
