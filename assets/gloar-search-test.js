/* Read-only GLOAR search test. Uses an existing S-NOTE session; never refreshes or persists it. */
(()=>{'use strict';
 const PROJECT='https://rmlycycleuscfqywbihj.supabase.co',AUTH_KEY='sb-rmlycycleuscfqywbihj-auth-token';
 const PLATE=/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?\d{2,3}[가-힣]\d{4}$/u;
 const form=document.getElementById('search-form'),input=document.getElementById('plate'),searchButton=document.getElementById('search-button'),cancelButton=document.getElementById('cancel-button');
 const notice=document.getElementById('auth-notice'),authMessage=document.getElementById('auth-message'),configuration=document.getElementById('configuration');
 const status=document.getElementById('search-status'),feedback=status.parentElement,spinner=document.getElementById('search-spinner');
 const resultsSection=document.getElementById('results-section'),results=document.getElementById('results'),resultTitle=document.getElementById('results-title'),resultCount=document.getElementById('result-count');
 const diagnostics=document.getElementById('diagnostics'),diagnosticOutput=document.getElementById('diagnostic-output');
 const MESSAGES=Object.freeze({AUTH_REQUIRED:'S-NOTE에 로그인한 뒤 다시 검색해 주세요.',AUTH_FAILED:'로그인이 만료됐습니다. S-NOTE에 다시 로그인해 주세요.',STAFF_REQUIRED:'현재 계정의 검색 권한을 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',INVALID_REQUEST:'차량번호를 확인해 주세요. 예: 28오6877',LOOKUP_NOT_CONFIGURED:'검색 브라우저의 서버 설정이 필요합니다.',BROWSER_UNAVAILABLE:'검색 브라우저에 연결하지 못했습니다.',BROWSER_BUSY:'검색 브라우저가 사용 중입니다. 잠시 후 다시 시도해 주세요.',UPSTREAM_RATE_LIMITED:'검색 서비스가 요청을 제한했습니다. 잠시 후 다시 시도해 주세요.',PROVIDER_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',PROVIDER_UNSUPPORTED:'GLOAR DATA의 검색창을 확인하지 못했습니다.',PROVIDER_NAVIGATION_BLOCKED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',PROVIDER_SEARCH_UNCONFIRMED:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_NAVIGATION_BLOCKED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',GLOAR_ACCESS_BLOCKED:'GLOAR DATA에서 검색 브라우저의 접근을 제한했습니다.',GLOAR_SEARCH_UNSUPPORTED:'GLOAR DATA의 검색창을 확인하지 못했습니다.',GLOAR_RESULTS_UNCONFIRMED:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_RESULT_UNVERIFIED:'검색 결과의 차량번호와 링크를 확인하지 못했습니다.',REQUEST_TIMEOUT:'검색 시간이 초과됐습니다. 다시 시도해 주세요.',REQUEST_ABORTED:'검색을 취소했습니다.',INVALID_RESPONSE:'검색 서버의 응답을 확인하지 못했습니다.',NETWORK_ERROR:'검색 서버에 연결하지 못했습니다.',SESSION_CHANGED:'로그인 정보가 변경되어 검색을 취소했습니다.'});
 let active=null,sequence=0,configured=null,rejectedToken=null;
 const compact=value=>value.normalize('NFKC').replace(/[\s-]+/gu,'');
 function session(){
  try{
   const storage=localStorage.getItem('snote95-remember-login')==='1'?localStorage:sessionStorage;
   const raw=storage.getItem(AUTH_KEY),id=window.SnoteIdleAuthStorage?.identity(raw);
   if(!id||window.SnoteIdleAuthStorage.expired(PROJECT,id,localStorage))return null;
   const token=JSON.parse(raw).access_token;
   if(typeof token!=='string'||token===rejectedToken||token.length>16384||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))return null;
   const encoded=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
   const claims=JSON.parse(atob(encoded+'='.repeat((4-encoded.length%4)%4)));
   if(!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()||claims.sub!==id.userId||claims.session_id!==id.sessionId)return null;
   return{token,userId:id.userId,sessionId:id.sessionId};
  }catch{return null;}
 }
 const sameSession=expected=>{const current=session();return!!current&&current.userId===expected.userId&&current.sessionId===expected.sessionId;};
 function updateAuth(){
  const authenticated=!!session();notice.hidden=authenticated;
  searchButton.disabled=!!active||configured===false||!authenticated;
  return authenticated;
 }
 function setStatus(message,state=''){status.textContent=message;feedback.dataset.state=state;}
 function clearResults(){results.replaceChildren();resultsSection.hidden=true;resultCount.textContent='';diagnostics.hidden=true;diagnosticOutput.textContent='';}
 function setBusy(busy){input.disabled=busy;cancelButton.hidden=!busy;spinner.hidden=!busy;form.setAttribute('aria-busy',String(busy));updateAuth();}
 function diagnostic(value){diagnostics.hidden=false;diagnosticOutput.textContent=JSON.stringify(value,null,2);}
 function stop(message='검색을 취소했습니다.'){
  const previous=active;active=null;++sequence;
  if(previous){clearTimeout(previous.timer);clearInterval(previous.monitor);previous.controller.abort();}
  setBusy(false);setStatus(message);input.focus();
 }
 function current(request){return active===request&&sequence===request.sequence;}
 async function interruptible(signal,operation){
  if(signal.aborted)throw new Error('ABORTED');
  let abort;
  const cancelled=new Promise((resolve,reject)=>{abort=()=>reject(new Error('ABORTED'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw new Error('ABORTED');return operation();}),cancelled]);}
  finally{signal.removeEventListener('abort',abort);}
 }
 async function readJson(response,signal,maxBytes=65536){
  if(!/\bapplication\/json\b/iu.test(response.headers.get('Content-Type')||''))throw new Error('INVALID_RESPONSE');
  const reader=response.body?.getReader();if(!reader)throw new Error('INVALID_RESPONSE');
  const chunks=[];let size=0;
  try{for(;;){const value=await interruptible(signal,()=>reader.read());if(value.done)break;size+=value.value.byteLength;if(size>maxBytes)throw new Error('INVALID_RESPONSE');chunks.push(value.value);}}
  catch(error){try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}throw error;}
  finally{try{reader.releaseLock();}catch{}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('INVALID_RESPONSE');}
 }
 function safeLink(item){
  if(!item||typeof item.url!=='string'||item.url.length>2048||item.url!==item.url.trim()||/[\u0000-\u0020\u007f\\]/u.test(item.url))return null;
  try{
   const authority=/^https:\/\/([^/?#]+)/iu.exec(item.url)?.[1],url=new URL(item.url);
   if(url.protocol!=='https:'||url.hostname!=='gloar-data.com'||authority?.toLowerCase()!=='gloar-data.com'||url.username||url.password||url.port||url.hash||!/^\/en\/lot\/[A-Za-z0-9_-]{1,512}\/?$/u.test(url.pathname))return null;
   url.search='';
   const title=typeof item.title==='string'?item.title.replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim().slice(0,160):'';
   return{url:url.href,title:title||'GLOAR DATA 차량 상세'};
  }catch{return null;}
 }
 function showLinks(plate,items){
  if(!Array.isArray(items)||items.length>20)throw new Error('INVALID_RESPONSE');
  const links=[],seen=new Set();
  for(const item of items){const link=safeLink(item);if(link&&!seen.has(link.url)){links.push(link);seen.add(link.url);}if(links.length===5)break;}
  if(!links.length)throw new Error('INVALID_RESPONSE');
  for(const item of links){
   const row=document.createElement('li'),anchor=document.createElement('a'),address=document.createElement('span');
   anchor.href=item.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.className='result-link';anchor.textContent=item.title;
   address.className='result-url';address.textContent=item.url;anchor.append(address);row.append(anchor);results.append(row);
  }
  resultTitle.textContent=plate+' 검색 결과';resultCount.textContent=links.length+'건';resultsSection.hidden=false;
  return links.length;
 }
 async function search(event){
  event.preventDefault();if(active)return;
  clearResults();const plate=compact(input.value);
  if(!PLATE.test(plate)){setStatus(MESSAGES.INVALID_REQUEST,'error');input.focus();return;}
  input.value=plate;const auth=session();
  if(!auth){updateAuth();setStatus(MESSAGES.AUTH_REQUIRED,'error');return;}
  if(configured===false){setStatus(MESSAGES.LOOKUP_NOT_CONFIGURED,'error');return;}
  const controller=new AbortController(),request={controller,sequence:++sequence,auth,timedOut:false,timer:null,monitor:null};active=request;
  request.timer=setTimeout(()=>{request.timedOut=true;controller.abort();},60000);
  request.monitor=setInterval(()=>{if(current(request)&&!sameSession(auth)){stop(MESSAGES.SESSION_CHANGED);updateAuth();}},400);
  setBusy(true);setStatus('GLOAR DATA에서 차량을 찾고 있습니다.');
  let httpStatus;
  try{
   const response=await interruptible(controller.signal,()=>fetch('/api/gloar-search',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({plate}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}));
   httpStatus=response.status;const data=await readJson(response,controller.signal);
   if(!current(request))return;if(!sameSession(auth)){stop(MESSAGES.SESSION_CHANGED);return;}
   if(data?.plate!==undefined&&data.plate!==plate)throw new Error('INVALID_RESPONSE');
   if(response.ok&&data?.status==='not_found'&&(data.ok===true||data.ok===false)){
    setStatus(plate+'의 검색 결과를 찾지 못했습니다.');diagnostic({status:'not_found',httpStatus,plate,linkCount:0});return;
   }
   if(!response.ok||data?.ok!==true||data.status!=='found'){
    const code=typeof data?.code==='string'&&Object.hasOwn(MESSAGES,data.code)?data.code:httpStatus===401?'AUTH_FAILED':'INVALID_RESPONSE';
    if(code==='AUTH_REQUIRED'||code==='AUTH_FAILED'){rejectedToken=auth.token;notice.hidden=false;authMessage.textContent=MESSAGES[code];}
    throw new Error(code);
   }
   if(data.plate!==plate)throw new Error('INVALID_RESPONSE');
   const count=showLinks(plate,data.links);setStatus('실제 검색 결과 '+count+'건을 찾았습니다.');diagnostic({status:'found',httpStatus,plate,linkCount:count});
  }catch(error){
   if(!current(request))return;
   const code=request.timedOut?'REQUEST_TIMEOUT':controller.signal.aborted?'REQUEST_ABORTED':Object.hasOwn(MESSAGES,error?.message)?error.message:'NETWORK_ERROR';
   clearResults();setStatus(MESSAGES[code],'error');diagnostic({status:'error',...(httpStatus?{httpStatus}:{}),code,plate});
  }finally{
   clearTimeout(request.timer);clearInterval(request.monitor);
   if(current(request)){active=null;setBusy(false);searchButton.focus();}
  }
 }
 async function checkConfiguration(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await interruptible(controller.signal,()=>fetch('/api/gloar-search',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}));
   const data=await readJson(response,controller.signal,8192);
   if(!response.ok||data?.ok!==true||typeof data.configured!=='boolean')throw new Error('INVALID_RESPONSE');
   configured=data.configured;configuration.textContent=configured?'검색 준비됨':'서버 설정 필요';configuration.dataset.state=configured?'ready':'error';
   if(!configured&&!active)setStatus(MESSAGES.LOOKUP_NOT_CONFIGURED,'error');
  }catch{configuration.textContent='연결 확인 필요';configuration.dataset.state='error';}
  finally{clearTimeout(timer);updateAuth();}
 }
 form.addEventListener('submit',search);cancelButton.addEventListener('click',()=>stop());
 window.addEventListener('storage',()=>{if(active&&!sameSession(active.auth))stop(MESSAGES.SESSION_CHANGED);updateAuth();});
 window.addEventListener('focus',updateAuth);
 window.addEventListener('pageshow',updateAuth);
 window.addEventListener('pagehide',()=>{if(active)stop();});
 updateAuth();void checkConfiguration();
})();
