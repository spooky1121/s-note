/* Canonical, memory-only business records. Never put financial/customer facts in browser storage. */
((root)=>{'use strict';
 if(root.SnoteBusinessStore)return;
 const cache=new Map(),pending=new Map(),lists=new Map(),sources=new Map();let identity='',generation=0,listGeneration=0;
 const bridge=()=>root.snoteBusinessBridge;
 const context=()=>{try{return bridge()?.context?.()||null;}catch{return null;}};
 const current=c=>!!c&&bridge()?.current?.(c)===true;
 const error=(code,message)=>Object.assign(Error(message),{code});
 function scoped(){const c=context();if(!c?.ready)throw error('NOT_READY','로그인과 차량 자료가 준비된 뒤 다시 확인해 주세요.');if(identity!==c.key){cache.clear();lists.clear();pending.clear();identity=c.key;++generation;}return c;}
 const assertCurrent=(c,g)=>{if(g!==generation||!current(c))throw error('CONTEXT_CHANGED','계정 또는 업무 화면이 변경되었습니다.');};
 const key=(c,r)=>JSON.stringify([c.key,r.companyId||c.companyId,r.ownerId,r.carId]);
 function reference(r){if(!r||typeof r.ownerId!=='string'||typeof r.carId!=='string'||!r.carId)throw error('INVALID_REFERENCE','연결 차량을 확인해 주세요.');if(r.companyId&&r.companyId!==context()?.companyId)throw error('FORBIDDEN','연결 차량의 상사를 확인해 주세요.');return{companyId:r.companyId,ownerId:r.ownerId,carId:r.carId};}
 function canonical(value,c,ref){
  if(!value||value.apiVersion!==1||value.companyId!==c.companyId||value.ownerId!==ref.ownerId||String(value.carId)!==ref.carId||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.cycles)||!Array.isArray(value.entries))throw error('INVALID_RESPONSE','업무 자료의 차량 범위를 확인하지 못했습니다.');
  const result=structuredClone(value);result.carSnapshot=root.SnoteMoney?.car?.(result.wireCar)||result.carSnapshot||null;
  if(result.carSnapshot){result.carSnapshot={...result.carSnapshot,id:ref.carId,ownerId:'cld_'+ref.ownerId.replaceAll('-','').slice(0,18)};}
  result.capabilities={canWrite:value.capabilities?.canWrite===true,customerRead:value.capabilities?.customerRead===true,customerWrite:value.capabilities?.customerWrite===true};
  if(ref.ownerId!==c.actorId&&(result.capabilities.customerRead||result.capabilities.customerWrite))throw error('INVALID_RESPONSE','고객 업무의 소유 범위가 일치하지 않습니다.');
  if(!result.capabilities.customerRead&&result.entries.some(e=>e.kind==='lead'||e.kind==='task'&&['contact','visit','contract','delivery'].includes(e.details?.category)))throw error('INVALID_RESPONSE','고객 업무의 조회 범위를 확인하지 못했습니다.');
  const privateEntry=e=>e?.kind==='lead'||e?.kind==='task'&&['contact','visit','contract','delivery'].includes(e.details?.category);
  if(!result.capabilities.customerRead&&result.audit?.some(a=>privateEntry(a.changes?.before)||privateEntry(a.changes?.after)))throw error('INVALID_RESPONSE','고객 변경 이력의 조회 범위를 확인하지 못했습니다.');
  return result;
 }
 function announce(workspace){root.dispatchEvent(new CustomEvent('snote:business-changed',{detail:{companyId:workspace.companyId,ownerId:workspace.ownerId,carId:workspace.carId,revision:workspace.revision}}));}
 async function read(ref,{force=false}={}){
  const c=scoped(),g=generation,r=reference(ref),source=sources.get(r.ownerId)||0,k=key(c,r),prior=cache.get(k);
  if(!force&&prior?.value&&Date.now()-prior.at<30000)return structuredClone(prior.value);
  if(prior?.task)return prior.task;
  const state=prior||{};cache.set(k,state);
  const task=(async()=>{const raw=await bridge().read(c,r);assertCurrent(c,g);if(source!==(sources.get(r.ownerId)||0))throw error('SOURCE_CHANGED','차량 정보가 갱신되었습니다. 최신 업무를 다시 확인해 주세요.');const value=canonical(raw,c,r),latest=cache.get(k)?.value;if(latest&&latest.revision>value.revision)return structuredClone(latest);state.value=value;state.at=Date.now();return structuredClone(value);})();
  state.task=task;try{return await task;}finally{if(state.task===task)delete state.task;}
 }
 async function command(ref,command,{expectedRevision,requestId}={}){
  const c=scoped(),g=generation,r=reference(ref),k=key(c,r),state=cache.get(k),revision=expectedRevision??state?.value?.revision;
  if(!Number.isSafeInteger(revision)||revision<0)throw error('READ_REQUIRED','최신 업무 자료를 먼저 불러와 주세요.');
  if(!state?.value)throw error('READ_REQUIRED','차량 정보가 갱신되었습니다. 최신 업무를 확인한 뒤 입력 내용을 다시 저장해 주세요.');
  if(state?.value?.capabilities.canWrite!==true)throw error('FORBIDDEN','이 차량의 업무를 수정할 권한이 없습니다.');
  const snapshot=structuredClone(command),id=requestId||crypto.randomUUID(),body=JSON.stringify([r,revision,snapshot]),existing=pending.get(id);
  if(existing){if(existing.body!==body)throw error('REQUEST_REUSED','변경된 내용은 새 저장 요청으로 확인해 주세요.');return existing.task;}
  const task=(async()=>{
   let raw;
   for(let attempt=0;attempt<2;attempt++){
    try{raw=await bridge().write(c,r,{expectedRevision:revision,requestId:id,command:structuredClone(snapshot)});break;}
    catch(e){assertCurrent(c,g);if(attempt||!['NETWORK','FETCH_ERROR','TIMEOUT'].includes(e.code))throw e;}
   }
   assertCurrent(c,g);
   const value=canonical(raw,c,r);if(value.revision!==revision+1||value.requestId!==id)throw error('INVALID_RESPONSE','저장된 업무 버전을 확인하지 못했습니다.');
   const newest=cache.get(k)?.value;const accepted=newest&&newest.revision>value.revision?newest:value;cache.set(k,{value:accepted,at:Date.now()});lists.clear();announce(accepted);return structuredClone(accepted);
  })();
  pending.set(id,{body,task});try{return await task;}finally{if(pending.get(id)?.task===task)pending.delete(id);}
 }
 async function list({scope='mine',page=1,pageSize=25,query='',force=false}={}){
  const c=scoped(),g=generation,source=listGeneration;if(scope==='company'&&!c.canCompany)throw error('FORBIDDEN','상사 전체 업무를 조회할 권한이 없습니다.');
  const args={scope,page:Math.max(1,Math.trunc(page)),pageSize:Math.max(1,Math.min(50,Math.trunc(pageSize))),query:String(query).slice(0,120)},k=JSON.stringify([c.key,args]),old=lists.get(k);
  if(!force&&old?.value&&Date.now()-old.at<15000)return structuredClone(old.value);
  if(old?.task)return old.task;
  const state={};lists.set(k,state);
  state.task=(async()=>{const value=await bridge().list(c,args);assertCurrent(c,g);if(source!==listGeneration)throw error('SOURCE_CHANGED','차량 목록이 갱신되었습니다. 다시 확인해 주세요.');if(!value||!Array.isArray(value.items)||!Number.isSafeInteger(value.page)||typeof value.hasMore!=='boolean')throw error('INVALID_RESPONSE','업무 목록 응답을 확인하지 못했습니다.');
   const items=value.items.map(w=>{const parsed=canonical(w,c,reference(w)),newer=cache.get(key(c,parsed))?.value;return newer&&newer.revision>parsed.revision?structuredClone(newer):parsed;});
   if(scope==='mine'&&items.some(w=>w.ownerId!==c.actorId))throw error('INVALID_RESPONSE','본인 업무의 조회 범위가 일치하지 않습니다.');
   for(const w of items)cache.set(key(c,w),{value:w,at:Date.now()});
   state.value={...value,items};state.at=Date.now();return structuredClone(state.value);
  })();try{return await state.task;}finally{delete state.task;}
 }
 async function preferences(){const c=scoped(),g=generation,value=await bridge().preferences(c);assertCurrent(c,g);return value;}
 async function savePreferences(payload,expectedRevision){const c=scoped(),g=generation,value=await bridge().savePreferences(c,{payload,expectedRevision,requestId:crypto.randomUUID()});assertCurrent(c,g);lists.clear();root.dispatchEvent(new CustomEvent('snote:business-changed',{detail:{companyId:c.companyId,preferences:true}}));return value;}
 const reset=()=>{++generation;++listGeneration;identity='';cache.clear();lists.clear();pending.clear();sources.clear();};
 function sourceChanged(ref){const c=context();if(!current(c)||ref?.companyId!==c.companyId||!ref.ownerId)return;const owner=ref.ownerId;sources.set(owner,(sources.get(owner)||0)+1);++listGeneration;lists.clear();for(const[k,state]of cache){const value=state.value;if(value?.ownerId===owner||JSON.parse(k)[2]===owner)cache.delete(k);}root.dispatchEvent(new CustomEvent('snote:business-changed',{detail:{companyId:c.companyId,ownerId:owner,carId:ref.carId||null,source:true}}));}
 root.addEventListener('snote:auth-reset',reset);root.addEventListener('pagehide',reset);
 root.SnoteBusinessStore=Object.freeze({context,current,read,command,list,preferences,savePreferences,reset,sourceChanged,
  members(){const c=scoped();return bridge().members(c);},
  media(ref){const c=scoped();return bridge().media(c,reference(ref));},
  async customer(ref){const c=scoped(),g=generation;const value=await bridge().customer(c,reference(ref));assertCurrent(c,g);return value;},
  history(){const c=scoped();return bridge().history(c);},
  async evidence(ref,entryId){const c=scoped(),g=generation,value=await bridge().evidence(c,reference(ref),{action:'read',entryId});assertCurrent(c,g);return value;},
  async uploadEvidence(ref,entryId,file,{requestId}={}){const c=scoped(),g=generation,r=reference(ref),w=cache.get(key(c,r))?.value;if(!w?.capabilities.canWrite)throw error('FORBIDDEN','첨부자료를 저장할 권한이 없습니다.');const value=await bridge().uploadEvidence(c,r,entryId,file,requestId||crypto.randomUUID());assertCurrent(c,g);return value;},
  async downloadEvidence(ref,id,entryId){const c=scoped(),g=generation,value=await bridge().downloadEvidence(c,reference(ref),id,entryId);assertCurrent(c,g);return value;},
  vehicle(){try{return bridge()?.vehicle?.()||null;}catch{return null;}},
  cached(ref){const c=context();if(!current(c))return null;const value=cache.get(key(c,ref))?.value;return value?structuredClone(value):null;},
  async openVehicle(w){const c=scoped();if(w?.companyId!==c.companyId)throw error('FORBIDDEN','연결된 상사의 차량을 확인해 주세요.');return bridge().openVehicle(c,reference(w));}
 });
 root.dispatchEvent(new Event('snote:business-ready'));
})(globalThis);
