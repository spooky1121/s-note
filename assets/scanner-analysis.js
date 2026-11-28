/* Scoped, memory-only OCR work. Image bytes and recognized text never enter this queue. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SnoteScannerAnalysis=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,NIL='00000000-0000-0000-0000-000000000000',LIMIT=200;
 const LABELS=Object.freeze({'registration':'자동차 등록증','performance-1':'자동차 성능지 1장','performance-2':'자동차 성능지 2장','unclassified':'미분류'});
 const ORIENTATIONS=new Set(['portrait','landscape','square','unknown']),ROTATIONS=new Set([0,90,180,270]);
 const ERROR_CODES=new Set(['SETUP_REQUIRED','OCR_SETUP_REQUIRED','OCR_UPSTREAM','OCR_UNAVAILABLE','OCR_FAILED','OCR_TIMEOUT','OCR_RATE_LIMITED','RATE_LIMITED','BUSY','LIMIT','FORBIDDEN','UNAUTHORIZED','CONFLICT','NOT_FOUND','SCANNER_CONTEXT_CHANGED','SCANNER_INVALID_RESPONSE','SCANNER_ANALYSIS_FAILED']);
 const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value),fail=code=>Object.assign(Error(code),{code});
 function record(value){
  if(!plain(value)||typeof value.id!=='string'||!UUID.test(value.id)||value.id.toLowerCase()===NIL||value.revision!==1)throw fail('SCANNER_INVALID_INPUT');
  return Object.freeze({id:value.id.toLowerCase(),revision:1});
 }
 function analysis(value){
  if(plain(value)&&Object.hasOwn(value,'ok')){if(value.ok!==true||!plain(value.analysis))throw fail('SCANNER_INVALID_RESPONSE');value=value.analysis;}
  const fields=['documentType','label','rotation','orientation','needsReview'];
  if(!plain(value)||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key))||typeof value.documentType!=='string'||!Object.hasOwn(LABELS,value.documentType)||value.label!==LABELS[value.documentType]||!ROTATIONS.has(value.rotation)||!ORIENTATIONS.has(value.orientation)||typeof value.needsReview!=='boolean')throw fail('SCANNER_INVALID_RESPONSE');
  return Object.freeze({documentType:value.documentType,label:LABELS[value.documentType],rotation:value.rotation,orientation:value.orientation,needsReview:value.needsReview});
 }
 function errorValue(error){
  const code=ERROR_CODES.has(error?.code)?error.code:'SCANNER_ANALYSIS_FAILED';
  let message='문서를 분석하지 못했습니다. 다시 시도해 주세요.';
  if(code==='SETUP_REQUIRED'||code==='OCR_SETUP_REQUIRED')message='문서 분석 설정을 확인해 주세요.';
  else if(['OCR_RATE_LIMITED','RATE_LIMITED','BUSY','LIMIT'].includes(code))message='잠시 후 다시 분석해 주세요.';
  else if(code==='UNAUTHORIZED'||code==='FORBIDDEN')message='문서 접근 권한을 확인해 주세요.';
  else if(code==='NOT_FOUND'||code==='CONFLICT')message='문서 저장 상태를 확인해 주세요.';
  else if(code==='SCANNER_CONTEXT_CHANGED')message='로그인 상태가 변경되었습니다.';
  return Object.freeze({code,message});
 }
 function create(options={}){
  if(typeof options.request!=='function'||typeof options.current!=='function')throw fail('SCANNER_INVALID_INPUT');
  const limit=Number.isSafeInteger(options.limit)?Math.max(1,Math.min(LIMIT,options.limit)):LIMIT,concurrency=Number.isSafeInteger(options.concurrency)?Math.max(1,Math.min(2,options.concurrency)):1;
  const entries=new Map(),queue=[];let active=0,epoch=0,disposed=false;
  const valid=()=>{try{return !disposed&&options.current()===true;}catch{return false;}};
  const snapshot=entry=>Object.freeze({id:entry.record.id,revision:entry.record.revision,status:entry.status,analysis:entry.analysis,error:entry.error});
  function notify(entry){if(entry.epoch!==epoch||!valid()||entries.get(entry.key)!==entry)return;try{options.onChange?.(snapshot(entry));}catch{/* Consumer rendering must not interrupt the queue. */}}
  function settle(entry,status,value){
   if(entry.done)return;entry.done=true;entry.status=status;
   if(status==='ready'){entry.analysis=value;entry.error=null;}else{entry.analysis=null;entry.error=errorValue(value);}
   const result=snapshot(entry);notify(entry);entry.resolve(result);
  }
  function cancel(entry){settle(entry,'error',fail('SCANNER_CONTEXT_CHANGED'));}
  function pump(){
   if(!valid()){reset();return;}
   while(active<concurrency&&queue.length){
    const entry=queue.shift();if(entry.done||entry.epoch!==epoch||entries.get(entry.key)!==entry)continue;
    entry.status='loading';active++;notify(entry);
    Promise.resolve().then(()=>{
     if(!valid()||entry.epoch!==epoch||entries.get(entry.key)!==entry)throw fail('SCANNER_CONTEXT_CHANGED');
     return options.request(entry.record);
    }).then(value=>{
     if(!valid()||entry.epoch!==epoch||entries.get(entry.key)!==entry){cancel(entry);return;}
     settle(entry,'ready',analysis(value));
    }).catch(error=>{
     if(!valid()||entry.epoch!==epoch||entries.get(entry.key)!==entry){cancel(entry);return;}
     settle(entry,'error',error);
    }).finally(()=>{active--;pump();});
   }
  }
  function enqueue(value,{retry=false}={}){
   let row;try{row=record(value);if(!valid())throw fail('SCANNER_CONTEXT_CHANGED');}catch(error){return Promise.reject(error);}
   const key=row.id+':'+row.revision,known=entries.get(key);
   if(known&&!(retry===true&&known.status==='error')){entries.delete(key);entries.set(key,known);return known.promise;}
   if(!known&&entries.size>=limit){
    const oldest=Array.from(entries.values()).find(entry=>entry.done);
    if(!oldest)return Promise.resolve(Object.freeze({id:row.id,revision:row.revision,status:'error',analysis:null,error:errorValue(fail('LIMIT'))}));
    entries.delete(oldest.key);
   }
   let resolve;const promise=new Promise(done=>{resolve=done;}),entry={key,record:row,epoch,status:'queued',analysis:null,error:null,promise,resolve,done:false};
   entries.set(key,entry);queue.push(entry);notify(entry);pump();return promise;
  }
  function get(id,revision=1){
   if(!valid())return null;let row;try{row=record({id,revision});}catch{return null;}
   const key=row.id+':'+row.revision,entry=entries.get(key);if(!entry)return null;entries.delete(key);entries.set(key,entry);return snapshot(entry);
  }
  function forget(id,revision=1){
   let row;try{row=record({id,revision});}catch{return false;}
   const key=row.id+':'+row.revision,entry=entries.get(key);if(!entry)return false;
   entries.delete(key);for(let i=queue.length-1;i>=0;i--)if(queue[i]===entry)queue.splice(i,1);cancel(entry);return true;
  }
  function reset(){epoch++;const old=Array.from(entries.values());entries.clear();queue.length=0;for(const entry of old)cancel(entry);}
  function dispose(){disposed=true;reset();}
  return Object.freeze({enqueue,get,forget,reset,dispose});
 }
 return Object.freeze({create,analysis,LABELS,LIMIT});
});
