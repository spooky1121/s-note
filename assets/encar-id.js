/* Advertisement ID lookup and manual Encar link. No price, vehicle or local writes. */
(()=>{'use strict';
 if(window.SnoteEncarId)return;
 const bridge=()=>window.snoteEncarIdBridge,ID=/^[1-9][0-9]{5,11}$/,providers=new Set(['gloar']);
 let session=null,sequence=0;
 const dialog=document.createElement('dialog');dialog.id='snote-encar-id-dialog';dialog.className='snote-encar-id-dialog snote-popup-native';dialog.setAttribute('aria-labelledby','snote-encar-id-title');
 const title=document.createElement('h2');title.id='snote-encar-id-title';title.textContent='차량 광고 검색';
 const loading=document.createElement('div');loading.className='snote-encar-id-loading';loading.dataset.encarIdLoading='';loading.hidden=true;loading.setAttribute('aria-hidden','true');
 const scan=document.createElement('div');scan.className='snote-encar-id-scan';
 for(const name of['card','beam','lens']){const shape=document.createElement('span');shape.className='snote-encar-id-scan-'+name;scan.append(shape);}
 const dots=document.createElement('div');dots.className='snote-encar-id-loading-dots';for(let index=0;index<3;index++)dots.append(document.createElement('span'));loading.append(scan,dots);
 const output=document.createElement('output');output.dataset.encarAdId='';output.hidden=true;output.setAttribute('aria-label','광고 ID');
 const adLink=document.createElement('a');adLink.dataset.encarAdLink='';adLink.className='snote-encar-id-link';adLink.target='_blank';adLink.rel='noopener noreferrer';adLink.hidden=true;
 const status=document.createElement('p');status.className='snote-encar-id-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const diagnostics=document.createElement('div');diagnostics.dataset.encarErrorDetails='';diagnostics.className='snote-encar-error-details';diagnostics.hidden=true;diagnostics.setAttribute('role','group');diagnostics.setAttribute('aria-label','오류 진단 결과');
 const diagnosticFields={};for(const field of['source','stage','detail','code','http','note']){const line=document.createElement('p');line.setAttribute('data-encar-error-'+field,'');diagnosticFields[field]=line;diagnostics.append(line);}
 const confirm=document.createElement('button');confirm.type='button';confirm.className='snote-encar-id-confirm';confirm.textContent='확인';confirm.addEventListener('click',close);
 dialog.append(title,loading,adLink,output,status,diagnostics,confirm);document.body.append(dialog);
 function clearLink(){adLink.hidden=true;adLink.removeAttribute('href');adLink.textContent='';}
 function clearDiagnostics(){diagnostics.hidden=true;for(const field of Object.values(diagnosticFields))field.textContent='';}
 // Codes identify observed execution stages, not a third-party outage. Never
 // display arbitrary exception text, provider bodies, credentials or car data.
 const diagnosticCodes={
  GLOAR_INPUT_UNCONFIRMED:['gloar','차량번호 입력값 확인','GLOAR 검색창의 차량번호 입력값을 확인하지 못했습니다.'],
  GLOAR_INPUT_MISSING:['gloar','검색창 확인','GLOAR 화면에서 검색창을 찾지 못했습니다.'],
  GLOAR_INPUT_UNAVAILABLE:['gloar','검색창 준비','GLOAR 검색창을 사용할 수 없는 상태입니다.'],
  GLOAR_FOCUS_FAILED:['gloar','검색창 선택','GLOAR 검색창을 선택하지 못했습니다.'],
  GLOAR_ENTER_FAILED:['gloar','검색 실행','GLOAR 화면에서 검색 실행을 완료하지 못했습니다.'],
  GLOAR_ACCESS_BLOCKED:['gloar','검색 화면 접근','GLOAR 화면에서 접근 제한 안내를 확인했습니다.',true],
  GLOAR_NAVIGATION_BLOCKED:['gloar','검색 결과 주소 확인','검색 결과의 이동 주소를 검증하지 못했습니다.'],
  GLOAR_SEARCH_UNCONFIRMED:['gloar','검색 결과 확인','검색 결과가 갱신됐는지 확인하지 못했습니다.'],
  GLOAR_ID_UNVERIFIED:['gloar','원본 엔카 ID 확인','검색 결과에서 원본 엔카 광고 ID를 확인하지 못했습니다.'],
  GLOAR_AMBIGUOUS:['gloar','원본 엔카 ID 확인','확인된 광고 ID가 여러 개여서 하나로 확정하지 못했습니다.'],
  GLOAR_UNAVAILABLE:['gloar','검색 화면 응답 확인','GLOAR 검색 화면의 응답을 확인하지 못했습니다.'],
  GLOAR_PAGE_UNAVAILABLE:['gloar','검색 화면 접속','GLOAR 검색 화면 접속을 완료하지 못했습니다.'],
  GLOAR_NO_NAVIGATION:['gloar','검색 결과 이동','검색 결과 화면으로 이동했는지 확인하지 못했습니다.'],
  UPSTREAM_RATE_LIMITED:['cloudflare','브라우저 요청 제한','Cloudflare에서 요청 제한 응답을 받았습니다.',true],
  BROWSER_DAILY_LIMIT:['cloudflare','브라우저 하루 사용 한도','Cloudflare 응답에서 하루 사용 한도 도달을 확인했습니다.',true],
  BROWSER_AUTH_FAILED:['cloudflare','브라우저 인증','Cloudflare에서 브라우저 인증 거절 응답을 받았습니다.',true],
  BROWSER_BUSY:['cloudflare','브라우저 접속','Cloudflare에서 브라우저 사용 중 응답을 받았습니다.',true],
  BROWSER_UNAVAILABLE:['cloudflare','브라우저 연결·실행','검색 브라우저 연결 또는 실행을 완료하지 못했습니다.'],
  LOOKUP_NOT_CONFIGURED:['snote','검색 서버 설정','S-NOTE의 검색 브라우저 설정을 확인해야 합니다.',true],
  AUTH_REQUIRED:['snote','로그인 확인','현재 로그인 정보가 필요합니다.',true],
  AUTH_FAILED:['snote','로그인 확인','현재 로그인 정보를 다시 확인해야 합니다.',true],
  AUTH_UNAVAILABLE:['snote','로그인·권한 확인','로그인 확인 단계의 설정 또는 응답을 확인하지 못했습니다.'],
  STAFF_REQUIRED:['snote','사용 권한 확인','현재 계정의 사용 권한을 확인해야 합니다.',true],
  INVALID_REQUEST:['snote','요청 확인','차량번호 또는 검색 요청 형식을 확인해야 합니다.',true],
  UNAUTHORIZED:['snote','요청 인증','S-NOTE에서 요청 인증을 확인하지 못했습니다.',true],
  FORBIDDEN:['snote','요청 접근 확인','S-NOTE에서 허용되지 않은 요청으로 처리했습니다.',true],
  RATE_LIMITED:['snote','요청 확인','S-NOTE 응답에서 요청 제한을 확인했습니다.',true],
  INVALID_RESPONSE:['unknown','검색 응답 검증','검색 응답의 형식 또는 차량·광고 정보가 올바른지 확인하지 못했습니다.'],
  RESPONSE_UNREADABLE:['unknown','S-NOTE 응답 읽기','검색 서버의 응답 내용을 읽지 못했습니다.'],
  NETWORK_ERROR:['unknown','S-NOTE 서버 연결','브라우저에서 검색 서버의 응답을 받지 못했습니다.'],
  REQUEST_TIMEOUT:['unknown','검색 처리 시간','검색 처리 중 제한 시간을 초과했습니다.'],
  REQUEST_ABORTED:['unknown','검색 요청 종료','검색 요청이 종료됐습니다.'],
  PROVIDERS_UNAVAILABLE:['unknown','검색 처리','검색 처리 중 확인되지 않은 오류가 발생했습니다.'],
  PROVIDER_UNSUPPORTED:['unknown','검색 화면 검증','검색 화면 또는 주소를 검증하지 못했습니다.']
 };
 function showDiagnostics(code,s){
  clearDiagnostics();if(code==='NOT_FOUND')return;
  const known=Object.prototype.hasOwnProperty.call(diagnosticCodes,code),safeCode=known?code:'UNKNOWN_ERROR';
  const info=known?diagnosticCodes[code]:s.phase==='session'?['snote','로그인 정보 확인','로그인 정보를 준비하는 단계에서 오류가 발생했습니다.']:['unknown','검색 처리','오류 원인을 확정할 수 없습니다.'];
  const source={snote:'S-NOTE 서버·인증',cloudflare:'Cloudflare 연결 구간',gloar:'GLOAR 검색 화면',unknown:'확인되지 않음'}[info[0]];
  diagnosticFields.source.textContent='오류 구간: '+source;diagnosticFields.stage.textContent='확인 단계: '+info[1];diagnosticFields.detail.textContent=info[2];diagnosticFields.code.textContent='오류 코드: '+safeCode;
  diagnosticFields.http.textContent='S-NOTE 응답: '+(Number.isInteger(s.httpStatus)&&s.httpStatus>=100&&s.httpStatus<=599?'HTTP '+s.httpStatus:'HTTP 응답 없음');
  diagnosticFields.note.textContent=info[3]?'해당 처리 결과를 확인했습니다.':'해당 구간에서 중단됐으며, 서버 장애 여부는 확인되지 않았습니다.';
  diagnostics.hidden=false;
 }
 function busy(active){loading.hidden=!active;if(active)dialog.setAttribute('aria-busy','true');else dialog.removeAttribute('aria-busy');}
 function close(){const active=session;session=null;++sequence;if(active){active.controller.abort();clearTimeout(active.timeout);}if(dialog.open)dialog.close();busy(false);title.textContent='차량 광고 검색';output.value='';output.textContent='';output.hidden=true;clearLink();clearDiagnostics();status.textContent='';sync();}
 function live(s){return session===s&&dialog.open&&bridge()?.current(s.context)===true;}
 function message(code){return({SEARCH_NOT_CONFIGURED:'검색 서비스 설정을 확인해 주세요.',SEARCH_AUTH_FAILED:'검색 서비스의 인증 설정을 확인해 주세요.',SEARCH_RATE_LIMITED:'검색 서비스가 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',SEARCH_UNAVAILABLE:'검색 서비스에 연결하지 못했습니다.',SEARCH_INVALID_RESPONSE:'검색 서비스의 응답을 확인하지 못했습니다.',SEARCH_TIMEOUT:'광고 검색 시간이 초과됐습니다.',NOT_FOUND:'광고 ID를 찾지 못했습니다.',AUTH_REQUIRED:'다시 로그인한 뒤 확인해 주세요.',AUTH_FAILED:'다시 로그인한 뒤 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 차량을 다시 확인해 주세요.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 확인해 주세요.',UPSTREAM_RATE_LIMITED:'Cloudflare 검색 브라우저가 요청을 제한했습니다. Cloudflare 사용량·요금제를 확인해 주세요.',BROWSER_DAILY_LIMIT:'Cloudflare 검색 브라우저의 하루 사용 한도에 도달했습니다. Cloudflare 사용량·요금제를 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 검색 서버 설정을 확인해 주세요.',BROWSER_UNAVAILABLE:'광고 검색 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',BROWSER_BUSY:'다른 광고 검색이 진행 중입니다. 잠시 후 다시 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.',PROVIDER_UNSUPPORTED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',PROVIDERS_UNAVAILABLE:'GLOAR DATA의 검색 응답을 확인하지 못했습니다.',GLOAR_PAGE_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_ACCESS_BLOCKED:'GLOAR DATA에서 검색 브라우저의 접근을 제한했습니다.',GLOAR_NAVIGATION_BLOCKED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',GLOAR_INPUT_MISSING:'GLOAR DATA의 검색창을 찾지 못했습니다.',GLOAR_INPUT_UNAVAILABLE:'GLOAR DATA의 검색창을 사용할 수 없습니다.',GLOAR_INPUT_UNCONFIRMED:'서버에 오류가 있습니다. 잠시후 다시 시도해주세요.',GLOAR_FOCUS_FAILED:'GLOAR DATA의 검색창을 선택하지 못했습니다.',GLOAR_ENTER_FAILED:'GLOAR DATA의 차량 검색을 실행하지 못했습니다.',GLOAR_NO_NAVIGATION:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_SEARCH_UNCONFIRMED:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_ID_UNVERIFIED:'GLOAR DATA에서 원본 엔카 광고 ID를 확인하지 못했습니다.',GLOAR_AMBIGUOUS:'GLOAR DATA에서 광고 ID를 하나로 확인하지 못했습니다.',BROWSER_AUTH_FAILED:'광고 검색 서버의 인증 설정을 확인해 주세요.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다. 다시 확인해 주세요.'})[code]||'광고 ID를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';}
 async function abortable(signal,operation){
  if(signal.aborted)throw Error('ABORTED');
  let abort;const interrupted=new Promise((resolve,reject)=>{abort=()=>reject(Error('ABORTED'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw Error('ABORTED');return operation();}),interrupted]);}finally{signal.removeEventListener('abort',abort);}
 }
 async function json(response,signal){if(!/application\/json/i.test(response.headers.get('Content-Type')||''))throw Error('INVALID_RESPONSE');const reader=response.body?.getReader();if(!reader)throw Error('INVALID_RESPONSE');let size=0;const chunks=[];try{for(;;){const{done,value}=await abortable(signal,()=>reader.read());if(done)break;size+=value.byteLength;if(size>16384)throw Error('INVALID_RESPONSE');chunks.push(value);}}catch(e){try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}throw e;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));}
 async function lookup(carId,options={}){
  if(session)return false;
  const context=bridge()?.context(String(carId??''),options.entry);if(!context)return false;
  const controller=new AbortController(),s={context,controller,sequence:++sequence,timeout:null,timedOut:false,phase:'session',httpStatus:null};session=s;
  title.textContent='차량 광고 검색';output.hidden=true;output.textContent='';output.value='';clearLink();clearDiagnostics();status.textContent='차량의 광고페이지를 찾고있습니다.';busy(true);dialog.showModal();sync();
  s.timeout=setTimeout(()=>{s.timedOut=true;controller.abort();},55000);
  try{
   const token=await abortable(controller.signal,()=>bridge().accessToken(context));if(!live(s))return false;if(!token)throw Error('AUTH_REQUIRED');
   s.phase='request';const response=await abortable(controller.signal,()=>fetch('/api/encar-id',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({plate:context.plate}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}));
   s.httpStatus=response.status;s.phase='response';const data=await json(response,controller.signal);if(!live(s))return false;s.phase='result';
   if(!response.ok||data?.ok!==true||data.status!=='found')throw Error(typeof data?.code==='string'?data.code:data?.status==='not_found'?'NOT_FOUND':'INVALID_RESPONSE');
   if(data.plate!==context.plate||typeof data.id!=='string'||!ID.test(data.id)||!providers.has(data.provider))throw Error('INVALID_RESPONSE');
   title.textContent='엔카 링크 페이지';output.value=data.id;output.textContent=data.id;output.hidden=false;status.textContent='';
   const url='https://fem.encar.com/cars/detail/'+data.id+'?listAdvType=share&adnm=mo_detail_url';adLink.href=url;adLink.textContent=url;adLink.hidden=false;
   return true;
  }catch(error){if(live(s)){const raw=error?.message,code=s.timedOut?'REQUEST_TIMEOUT':raw==='NOT_FOUND'||Object.prototype.hasOwnProperty.call(diagnosticCodes,raw)?raw:s.phase==='request'?'NETWORK_ERROR':s.phase==='response'?'RESPONSE_UNREADABLE':'UNKNOWN_ERROR';output.hidden=true;clearLink();status.textContent=message(code);showDiagnostics(code,s);}}finally{clearTimeout(s.timeout);if(live(s)){busy(false);confirm.focus();}}
  return false;
 }
 function sync(){
  if(session&&!bridge()?.current(session.context)){close();return;}
  for(const button of document.querySelectorAll('button[data-encar-id-car],#vehicle-encar-check')){
   const detail=button.id==='vehicle-encar-check',carId=button.dataset.encarIdCar;
   const context=bridge()?.context(carId,detail?'detail':'list');button.disabled=!!session||!context;
  }
 }
 const detail=document.getElementById('vehicle-encar-check');detail?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void lookup(detail.dataset.encarIdCar,{entry:'detail'});});
 adLink.addEventListener('click',event=>{if(!session||!live(session)||adLink.hidden){event.preventDefault();close();}});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 const list=document.getElementById('list-screen');if(list)new MutationObserver(sync).observe(list,{childList:true,subtree:true});
 const overlay=document.getElementById('vehicle-overlay');if(overlay)new MutationObserver(sync).observe(overlay,{attributes:true,attributeFilter:['class','aria-hidden'],childList:true,subtree:true});
 setInterval(sync,350);
 window.SnoteEncarId=Object.freeze({lookup,reset:close});sync();
})();
