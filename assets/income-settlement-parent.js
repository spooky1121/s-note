import {createSource,createDocument,sourceFingerprint} from './income-settlement-model.js?v=2.39';

const bridge=()=>window.snoteIncomeSettlementBridge;
const dialog=document.createElement('dialog');dialog.id='snote221-income-dialog';dialog.setAttribute('aria-label','차량 소득정산');
const frame=document.createElement('iframe');frame.id='snote221-income-frame';frame.title='차량별 매입매출 및 소득정산';
const loadingClose=document.createElement('button');loadingClose.id='snote221-income-loading-close';loadingClose.type='button';loadingClose.textContent='×';loadingClose.setAttribute('aria-label','소득정산 닫기');loadingClose.addEventListener('click',()=>{if(active?.initial&&active.ready)post(active,{type:'SNOTE_INCOME_REQUEST_CLOSE'});else close();});
dialog.append(loadingClose,frame);document.body.append(dialog);
let active=null;
function failure(code,message){return Object.assign(new Error(message),{code});}
function current(context){return active===context&&bridge()?.current(context.base);}
function check(context){if(!current(context))throw failure('CONTEXT_CHANGED','로그인 또는 정산 대상이 변경되었습니다.');}
function post(context,message){if(current(context))frame.contentWindow?.postMessage({...message,contextKey:context.public.key},location.origin);}
function close(){
 const context=active;active=null;
 if(dialog.open)dialog.close();
 if(context)frame.contentWindow?.postMessage({type:'SNOTE_INCOME_RESET'},location.origin);
 try{frame.contentWindow?.location.replace('about:blank');}catch(_){frame.src='about:blank';}
}
function enqueue(context,operation){const task=context.tail.catch(()=>{}).then(async()=>{check(context);const result=await operation();check(context);return result;});context.tail=task;return task;}
function publicData(data){const result={...data};delete result.payload;return result;}
function errorData(error){
 const result={code:error?.code||'NETWORK',message:error?.message||'정산서 서버 응답을 확인하지 못했습니다.'};
 for(const key of ['remoteDocument','baseVersion','source','sourceVersion'])if(error?.[key]!==undefined)result[key]=error[key];
 return result;
}
async function request(context,body){
 check(context);
 if(context.base.mode==='demo')return demoRequest(context,body);
 const snapshot=await bridge().prepare(context.base);check(context);
 const token=await bridge().token(context.base);check(context);
 if(!token)throw failure('UNAUTHORIZED','온라인 로그인 상태를 확인해 주세요.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch('/api/income-settlement',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({...body,companyId:context.base.companyId,ownerId:context.base.ownerId,carId:context.base.carId}),signal:controller.signal});
  check(context);
  if(!(response.headers.get('Content-Type')||'').includes('application/json'))throw failure('NETWORK','정산서 API가 정상 응답하지 않습니다. 배포 상태를 확인해 주세요.');
  const data=await response.json();check(context);
  if(!response.ok||data?.ok!==true){const rejected=failure(data?.code||'NETWORK',data?.error||data?.message||'정산서 요청을 처리하지 못했습니다.');for(const key of ['remoteDocument','baseVersion','source','sourceVersion'])if(data?.[key]!==undefined)rejected[key]=data[key];throw rejected;}
  if(String(data.source?.carId)!==context.base.carId||data.source?.ownerId!==context.base.ownerId)throw failure('NETWORK','정산서 차량의 서버 응답이 요청과 일치하지 않습니다.');
  if(body.action==='save'){
   const applied=await bridge().apply(context.base,data,snapshot);check(context);
   if(applied===false)data.cacheNotice='정산서는 서버에 저장되었습니다. 차량 목록의 다른 변경사항은 서버에서 다시 확인해 주세요.';
  }
  return data;
 }catch(error){check(context);if(error?.name==='AbortError')throw failure('NETWORK','정산서 응답 시간이 초과됐습니다. 작성 내용을 유지한 채 저장 결과를 다시 확인해 주세요.');throw error;}
 finally{clearTimeout(timer);}
}
async function demoRequest(context,body){
 check(context);
 const info=bridge().demoSource(context.base);check(context);
 const source=createSource(info.car,{dealerName:info.dealerName,companyName:info.companyName,ownerId:context.base.ownerId,lenders:info.lenders});
 const sourceVersion=await sourceFingerprint(source);check(context);
 if(body.action==='save')throw failure('ONLINE_REQUIRED','서버 저장은 온라인 계정으로 로그인한 뒤 사용할 수 있습니다. 현재 작성본은 인쇄할 수 있습니다.');
 return {ok:true,stored:false,source,sourceVersion,document:createDocument(source),baseVersion:null,revision:0};
}
function init(context){if(context.ready&&context.initial&&current(context)){loadingClose.hidden=false;post(context,{type:'SNOTE_INCOME_INIT',context:context.public,...publicData(context.initial)});}}
async function open(carId){
 if(active?.base.carId===carId&&dialog.open)return;
 if(active?.dirty&&!confirm('현재 작성 중인 정산서 대신 다른 차량을 열까요?'))return;
 close();
 const base=bridge()?.context(carId);if(!base)throw failure('FORBIDDEN','판매 완료 차량과 로그인 권한을 확인해 주세요.');
 const nonce=crypto.randomUUID();
 const context={base,public:{...base,key:base.key+':'+nonce},dirty:false,ready:false,initial:null,tail:Promise.resolve()};
 active=context;
 loadingClose.hidden=false;
 try{frame.contentWindow.location.replace('income-settlement.html?v=2.36');}catch(_){frame.src='income-settlement.html?v=2.36';}
 dialog.showModal();
 try{context.initial=await enqueue(context,()=>request(context,{action:'load'}));init(context);}
 catch(error){if(current(context)){close();window.toast?.(error.message||'정산서를 불러오지 못했습니다.');}}
}
window.snoteIncomeOpenForCar=open;
window.snoteResetIncomeSettlement=close;
window.snoteIncomePrepareRouteChange=()=>{if(!dialog.open)return true;if(active?.dirty&&!confirm('정산서 작성 내용이 있습니다. 서버에 저장하지 않고 화면을 이동할까요?'))return false;close();return true;};
dialog.addEventListener('cancel',event=>{event.preventDefault();if(active?.initial&&active.ready)post(active,{type:'SNOTE_INCOME_REQUEST_CLOSE'});else close();});
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==frame.contentWindow||!event.data||typeof event.data!=='object')return;
 const data=event.data,context=active;if(!context)return;
 if(data.type==='SNOTE_INCOME_READY'){
  try{if(!frame.contentWindow.location.pathname.endsWith('/income-settlement.html')&&!frame.contentWindow.location.pathname.endsWith('/income-settlement'))return;}catch(_){return;}
  context.ready=true;init(context);return;
 }
 if(data.contextKey!==context.public.key||!current(context))return;
 if(data.type==='SNOTE_INCOME_DIRTY'){context.dirty=data.dirty===true;return;}
 if(data.type==='SNOTE_INCOME_CLOSE'){if(data.dirty===true&&!confirm('정산서를 저장하지 않고 닫을까요?'))return;close();return;}
 if(!['SNOTE_INCOME_SAVE','SNOTE_INCOME_LOAD','SNOTE_INCOME_PRINT_VALIDATE'].includes(data.type)||typeof data.requestId!=='string'||data.requestId.length>100)return;
 const responseType=data.type==='SNOTE_INCOME_SAVE'?'SNOTE_INCOME_RESULT':data.type==='SNOTE_INCOME_LOAD'?'SNOTE_INCOME_SYNC':'SNOTE_INCOME_PRINT_RESULT';
 const identifiers={type:responseType,requestId:data.requestId,clientSeq:data.clientSeq};
 void enqueue(context,async()=>{
  if(data.type==='SNOTE_INCOME_SAVE'){
   const result=await request(context,{action:'save',requestId:data.requestId,document:data.document,baseVersion:data.baseVersion,sourceVersion:data.sourceVersion});
   context.initial=result;post(context,{...identifiers,state:'saved',...publicData(result)});
  }else{
   const result=await request(context,{action:'load'});context.initial=result;
   if(data.type==='SNOTE_INCOME_PRINT_VALIDATE'&&data.sourceVersion&&result.sourceVersion!==data.sourceVersion)post(context,{...identifiers,state:'error',code:'SOURCE_CHANGED',message:'차량의 매입·판매 정보가 변경되었습니다. 원천 정보를 다시 확인해 주세요.',source:result.source,sourceVersion:result.sourceVersion});
   else if(data.type==='SNOTE_INCOME_PRINT_VALIDATE'&&Object.hasOwn(data,'baseVersion')&&data.baseVersion!==result.baseVersion)post(context,{...identifiers,state:'error',code:'CONFLICT',message:'다른 화면에서 정산서를 변경했습니다. 인쇄 전 서버 자료를 확인해 주세요.',remoteDocument:result.document,baseVersion:result.baseVersion});
   else post(context,{...identifiers,state:'saved',...publicData(result)});
  }
 }).catch(error=>{if(current(context))post(context,{...identifiers,state:error.code==='CONFLICT'?'conflict':error.code==='SOURCE_CHANGED'?'source_changed':'error',...errorData(error)});});
});
window.addEventListener('beforeunload',event=>{if(active?.dirty){event.preventDefault();event.returnValue='';}});
