/* Verified Encar discovery, saved vehicle links and confirmed planned-price changes. */
(()=>{'use strict';
 if(window.SnoteEncarId)return;
 const bridge=()=>window.snoteEncarIdBridge,ID=/^[1-9][0-9]{5,11}$/,providers=new Set(['gloar']);
 let session=null,sequence=0,priceJob=null,priceWrite=null,priceState=null,pendingComparison=null,detailScope=null,priceComparison=null;
 const compared=new Set(),MAX_WON=1000000000000,FRESH_MS=15*60*1000;
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
 const diagnosticFields={};for(const field of['source','stage','detail','code','http','request','duration','note']){const line=document.createElement('p');line.setAttribute('data-encar-error-'+field,'');diagnosticFields[field]=line;diagnostics.append(line);}
 const confirm=document.createElement('button');confirm.type='button';confirm.className='snote-encar-id-confirm';confirm.textContent='확인';confirm.addEventListener('click',close);
 dialog.append(title,loading,adLink,output,status,diagnostics,confirm);document.body.append(dialog);
 function clearLink(){adLink.hidden=true;adLink.removeAttribute('href');adLink.textContent='';}
 function clearDiagnostics(){diagnostics.hidden=true;for(const field of Object.values(diagnosticFields))field.textContent='';}
 // Codes identify observed execution stages, not a third-party outage. Never
 // display arbitrary exception text, provider bodies, credentials or car data.
 const serverStages={request:'요청 형식 확인',auth:'로그인 확인',membership:'상사·권한 확인',lookup:'외부 광고 조회',verification:'조회 결과 검증',complete:'조회 완료'};
 function responseDiagnostics(response){const requestId=response.headers.get('X-Snote-Request-Id'),stage=response.headers.get('X-Snote-Lookup-Stage'),text=response.headers.get('X-Snote-Duration-Ms'),durationMs=Number(text);return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId||'')&&Object.hasOwn(serverStages,stage)&&/^\d{1,9}$/.test(text||'')&&Number.isSafeInteger(durationMs)?{requestId,stage,durationMs}:null;}
 function diagnosticText(value){return value?'\n요청 ID: '+value.requestId+'\n확인 단계: '+serverStages[value.stage]+' · 소요 시간: '+(value.durationMs/1000).toFixed(2)+'초':'';}
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
  HTTP_UNAVAILABLE:['unknown','S-NOTE 서버 응답','서버 오류 응답을 받아 조회를 완료하지 못했습니다. 매물 없음으로 처리하지 않았습니다.'],
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
  if(s.diagnostic){diagnosticFields.request.textContent='요청 ID: '+s.diagnostic.requestId;diagnosticFields.stage.textContent='확인 단계: '+serverStages[s.diagnostic.stage];diagnosticFields.duration.textContent='소요 시간: '+(s.diagnostic.durationMs/1000).toFixed(2)+'초';}
  diagnosticFields.note.textContent=info[3]?'해당 처리 결과를 확인했습니다.':'해당 구간에서 중단됐으며, 서버 장애 여부는 확인되지 않았습니다.';
  diagnostics.hidden=false;
 }
 function busy(active){loading.hidden=!active;if(active)dialog.setAttribute('aria-busy','true');else dialog.removeAttribute('aria-busy');}
 function close(){const active=session;session=null;++sequence;if(active){active.controller.abort();clearTimeout(active.timeout);}if(dialog.open)dialog.close();busy(false);title.textContent='차량 광고 검색';output.value='';output.textContent='';output.hidden=true;clearLink();clearDiagnostics();status.textContent='';sync();queueMicrotask(resumeComparison);}
 function live(s){return session===s&&dialog.open&&bridge()?.current(s.context)===true;}
 function message(code){return({HTTP_UNAVAILABLE:'서버에 오류가 있습니다. 잠시후 다시 시도해주세요.',SEARCH_NOT_CONFIGURED:'검색 서비스 설정을 확인해 주세요.',SEARCH_AUTH_FAILED:'검색 서비스의 인증 설정을 확인해 주세요.',SEARCH_RATE_LIMITED:'검색 서비스가 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',SEARCH_UNAVAILABLE:'검색 서비스에 연결하지 못했습니다.',SEARCH_INVALID_RESPONSE:'검색 서비스의 응답을 확인하지 못했습니다.',SEARCH_TIMEOUT:'광고 검색 시간이 초과됐습니다.',NOT_FOUND:'광고 ID를 찾지 못했습니다.',AUTH_REQUIRED:'다시 로그인한 뒤 확인해 주세요.',AUTH_FAILED:'다시 로그인한 뒤 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 차량을 다시 확인해 주세요.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 확인해 주세요.',UPSTREAM_RATE_LIMITED:'Cloudflare 검색 브라우저가 요청을 제한했습니다. Cloudflare 사용량·요금제를 확인해 주세요.',BROWSER_DAILY_LIMIT:'Cloudflare 검색 브라우저의 하루 사용 한도에 도달했습니다. Cloudflare 사용량·요금제를 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 검색 서버 설정을 확인해 주세요.',BROWSER_UNAVAILABLE:'광고 검색 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',BROWSER_BUSY:'다른 광고 검색이 진행 중입니다. 잠시 후 다시 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.',PROVIDER_UNSUPPORTED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',PROVIDERS_UNAVAILABLE:'GLOAR DATA의 검색 응답을 확인하지 못했습니다.',GLOAR_PAGE_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_ACCESS_BLOCKED:'GLOAR DATA에서 검색 브라우저의 접근을 제한했습니다.',GLOAR_NAVIGATION_BLOCKED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',GLOAR_INPUT_MISSING:'GLOAR DATA의 검색창을 찾지 못했습니다.',GLOAR_INPUT_UNAVAILABLE:'GLOAR DATA의 검색창을 사용할 수 없습니다.',GLOAR_INPUT_UNCONFIRMED:'서버에 오류가 있습니다. 잠시후 다시 시도해주세요.',GLOAR_FOCUS_FAILED:'GLOAR DATA의 검색창을 선택하지 못했습니다.',GLOAR_ENTER_FAILED:'GLOAR DATA의 차량 검색을 실행하지 못했습니다.',GLOAR_NO_NAVIGATION:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_SEARCH_UNCONFIRMED:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_ID_UNVERIFIED:'GLOAR DATA에서 원본 엔카 광고 ID를 확인하지 못했습니다.',GLOAR_AMBIGUOUS:'GLOAR DATA에서 광고 ID를 하나로 확인하지 못했습니다.',BROWSER_AUTH_FAILED:'광고 검색 서버의 인증 설정을 확인해 주세요.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다. 다시 확인해 주세요.'})[code]||'광고 ID를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';}
 async function abortable(signal,operation){
  if(signal.aborted)throw Error('ABORTED');
  let abort;const interrupted=new Promise((resolve,reject)=>{abort=()=>reject(Error('ABORTED'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw Error('ABORTED');return operation();}),interrupted]);}finally{signal.removeEventListener('abort',abort);}
 }
 async function json(response,signal){if(!/application\/json/i.test(response.headers.get('Content-Type')||''))throw Error('INVALID_RESPONSE');const reader=response.body?.getReader();if(!reader)throw Error('INVALID_RESPONSE');let size=0;const chunks=[];try{for(;;){const{done,value}=await abortable(signal,()=>reader.read());if(done)break;size+=value.byteLength;if(size>16384)throw Error('INVALID_RESPONSE');chunks.push(value);}}catch(e){try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}throw e;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));}
 const pricePanel=document.createElement('div');pricePanel.id='snote-encar-advertisement';pricePanel.className='snote-encar-advertisement';pricePanel.hidden=true;
 const priceLabel=document.createElement('span');priceLabel.id='snote-encar-ad-price';priceLabel.className='snote-encar-ad-price';
 const priceChange=document.createElement('button');priceChange.id='snote-encar-price-change';priceChange.type='button';priceChange.className='snote-encar-price-change';priceChange.textContent='판매가 변경';
 const priceMessage=document.createElement('span');priceMessage.id='snote-encar-price-message';priceMessage.className='snote-encar-price-message';priceMessage.setAttribute('role','status');priceMessage.setAttribute('aria-live','polite');
 pricePanel.append(priceLabel,priceChange,priceMessage);document.getElementById('vehicle-title')?.after(pricePanel);
 const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 const adURL=id=>'https://fem.encar.com/cars/detail/'+id+'?listAdvType=share&adnm=mo_detail_url';
 const won=value=>Number.isSafeInteger(value)&&value>0&&value<=MAX_WON;
 const current=context=>!!context&&bridge()?.current(context)===true;
 const writable=context=>!!context&&['admin','dealer'].includes(context.actor?.role);
 function saved(context){
  try{const value=bridge()?.saved?.(context);if(!value||value.plate!==context.plate||typeof value.id!=='string'||!ID.test(value.id)||value.url!==adURL(value.id)||typeof value.verifiedAt!=='string'||!Number.isFinite(Date.parse(value.verifiedAt)))return null;return value;}catch{return null;}
 }
 function detailContext(){const id=document.getElementById('vehicle-encar-check')?.dataset.encarIdCar;return id?bridge()?.context(id,'detail'):null;}
 function priced(value){return !!value&&won(value.priceWon)&&value.priceSource==='encar'&&typeof value.priceCheckedAt==='string'&&Number.isFinite(Date.parse(value.priceCheckedAt));}
 function fresh(value){const age=Date.now()-Date.parse(value?.priceCheckedAt||'');return priced(value)&&age>=-60000&&age<=FRESH_MS;}
 function planned(context){try{const value=bridge()?.plannedPrice?.(context);return Number.isSafeInteger(value)&&value>=0&&value<=MAX_WON?value:null;}catch{return null;}}
 function priceFailure(code){const messages={
  BROWSER_DAILY_LIMIT:'Cloudflare 광고 브라우저의 하루 사용 한도에 도달했습니다.',UPSTREAM_RATE_LIMITED:'Cloudflare 광고 브라우저가 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',BROWSER_BUSY:'다른 광고 금액을 확인 중입니다. 잠시 후 다시 확인해 주세요.',BROWSER_AUTH_FAILED:'Cloudflare 광고 브라우저 인증 설정을 확인해 주세요.',BROWSER_UNAVAILABLE:'Cloudflare 광고 브라우저에 연결하지 못했습니다.',LOOKUP_NOT_CONFIGURED:'광고 금액 조회 서버 설정을 확인해 주세요.',
  ENCAR_RATE_LIMITED:'엔카에서 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',ENCAR_ACCESS_BLOCKED:'엔카에서 광고 금액 조회를 제한하고 있습니다.',ENCAR_VEHICLE_MISMATCH:'광고의 차량번호가 현재 차량과 달라 금액을 적용하지 않았습니다.',ENCAR_NOT_ADVERTISING:'판매 종료된 광고여서 금액을 적용하지 않았습니다.',ENCAR_STATUS_UNVERIFIED:'현재 광고 상태를 확인하지 못했습니다.',ENCAR_LOCATION_UNVERIFIED:'엔카 광고 페이지의 주소를 확인하지 못했습니다.',ENCAR_PRICE_AMBIGUOUS:'광고 금액이 여러 개여서 판매가를 확정하지 못했습니다.',ENCAR_PRICE_UNVERIFIED:'광고 금액을 정확하게 확인하지 못했습니다.',ENCAR_PRICE_UNAVAILABLE:'엔카 광고 금액을 확인하지 못했습니다. 저장된 링크는 열 수 있습니다.',
  AUTH_REQUIRED:'다시 로그인한 뒤 광고 금액을 확인해 주세요.',AUTH_FAILED:'다시 로그인한 뒤 광고 금액을 확인해 주세요.',AUTH_UNAVAILABLE:'광고 금액 조회의 로그인 확인을 완료하지 못했습니다.',STAFF_REQUIRED:'현재 차량의 조회 권한을 확인해 주세요.',PLATE_MISMATCH:'광고의 차량번호를 확인하지 못해 금액을 적용하지 않았습니다.',REQUEST_TIMEOUT:'엔카 광고 금액 확인 시간이 초과됐습니다. 다시 확인해 주세요.',PRICE_UNAVAILABLE:'광고 금액을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.'
 };return Object.hasOwn(messages,code)?messages[code]:'광고 금액을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';}
 function writeFailure(code,link=false){const messages={FORBIDDEN:link?'본인 담당 차량의 광고 링크만 저장할 수 있습니다.':'판매예정가 변경 권한을 확인해 주세요.',CONTEXT_CHANGED:'차량이나 입력 내용이 변경되었습니다. 현재 내용을 다시 확인해 주세요.',CONFLICT:'다른 화면에서 차량이 변경되었습니다. 최신 자료를 확인해 주세요.',PENDING:'진행 중인 차량 저장이 끝난 뒤 다시 시도해 주세요.'};return Object.hasOwn(messages,code)?messages[code]:(link?'광고 링크를 저장하지 못했습니다. 차량 저장 상태를 확인한 뒤 다시 시도해 주세요.':'판매예정가를 저장하지 못했습니다. 현재 입력과 서버 저장 상태를 확인해 주세요.');}
 function notify(text,options={}){window.snoteNotify(text,options);}
 function lookupFailure(s,text){if(!live(s))return;status.textContent='';notify(text,{tone:'error',isCurrent:()=>live(s)});}
 function cancelPrice(){if(priceJob){priceJob.controller.abort();clearTimeout(priceJob.timeout);}priceJob=null;priceState=null;pendingComparison=null;priceComparison=null;}
 function reset(){cancelPrice();priceWrite=null;detailScope=null;compared.clear();close();pricePanel.hidden=true;setText(priceLabel,'');setText(priceMessage,'');priceLabel.removeAttribute('title');}
 function sameStored(context,record){const value=current(context)&&saved(context);return value&&value.id===record.id&&value.plate===record.plate&&value.priceWon===record.priceWon&&value.priceCheckedAt===record.priceCheckedAt&&value.priceSource==='encar';}
 function openSaved(record){
  // A native link click stays inside the initiating user gesture and strips the opener.
  const anchor=document.createElement('a');anchor.href=adURL(record.id);anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();
 }
 async function applyPrice(context,record,expected){
  if(priceWrite||!sameStored(context,record)||planned(context)!==expected||!writable(context))return false;
  const operation={context,id:record.id};priceWrite=operation;sync();
  try{const result=await bridge().changePrice(context,expected);if(!current(context)||priceWrite!==operation)return false;if(result?.saved!==true||result.priceWon!==record.priceWon)throw Error('INVALID_RESPONSE');notify('저장되었습니다.',{tone:'success',isCurrent:()=>current(context)});return true;}
  catch(error){if(current(context)&&priceWrite===operation){priceState={key:context.key,id:record.id,message:writeFailure(error?.code)};notify(priceState.message,{tone:'error',isCurrent:()=>current(context)&&saved(context)?.id===record.id});}return false;}
  finally{if(priceWrite===operation){priceWrite=null;sync();}}
 }
 async function comparePrice(context,record,{repeat=false}={}){
  if(!sameStored(context,record)||!priced(record)||!writable(context))return false;
  const expected=planned(context);if(expected===null||expected===record.priceWon)return false;
  const key=JSON.stringify([context.key,record.id,record.priceWon,expected]);if(!repeat&&compared.has(key))return false;
  // Keep the confirmation available when returning from the explicitly opened advertisement.
  if(dialog.open||document.hidden){pendingComparison={context,record,repeat};return false;}
  if(compared.size>=128)compared.clear();compared.add(key);pendingComparison=null;
  const comparison={},job=priceJob,valid=()=>priceComparison===comparison&&priceJob===job&&!priceWrite&&!dialog.open&&!document.hidden&&sameStored(context,record)&&planned(context)===expected&&writable(context);priceComparison=comparison;
  try{const accepted=await window.snoteConfirm('엔카 광고가 '+record.priceWon.toLocaleString('ko-KR')+'원입니다.\n현재 판매예정가는 '+expected.toLocaleString('ko-KR')+'원입니다.\n판매예정가를 엔카 광고금액으로 변경하시겠습니까?',{isCurrent:valid});
   if(!accepted||!valid())return false;return applyPrice(context,record,expected);
  }finally{if(priceComparison===comparison)priceComparison=null;}
 }
 function resumeComparison(){const value=pendingComparison;if(!value||dialog.open||document.hidden)return;pendingComparison=null;void comparePrice(value.context,value.record,{repeat:value.repeat});}
 async function refreshPrice(context=detailContext(),{force=false,repeat=false}={}){
  renderPrice();
  const record=context&&saved(context);if(!current(context)||context.entry!=='detail'||!record||!writable(context))return false;
  if(priceJob&&priceJob.context.key===context.key&&priceJob.id===record.id)return priceJob.promise;
  if(!force&&fresh(record)){await comparePrice(context,record,{repeat});return true;}
  cancelPrice();const controller=new AbortController(),job={context,id:record.id,controller,timeout:null,timedOut:false,promise:null};priceJob=job;priceState=null;
  const live=()=>priceJob===job&&!controller.signal.aborted&&current(context)&&saved(context)?.id===record.id;
  job.timeout=setTimeout(()=>{job.timedOut=true;controller.abort();},50000);sync();
  job.promise=(async()=>{try{
   const token=await abortable(controller.signal,()=>bridge().accessToken(context));if(!live())return false;if(!token)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
   const response=await abortable(controller.signal,()=>fetch('/api/encar-ad-price',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id:record.id,plate:context.plate}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}));
   job.diagnostic=responseDiagnostics(response);const data=await json(response,controller.signal);if(!live())return false;
   if(!response.ok||data?.ok!==true)throw Object.assign(Error('PRICE_UNAVAILABLE'),{code:typeof data?.code==='string'?data.code:'PRICE_UNAVAILABLE'});
   const checked=Date.parse(data.checkedAt),age=Date.now()-checked;
   if(data.id!==record.id||data.plate!==context.plate||data.source!=='encar'||!won(data.priceWon)||typeof data.checkedAt!=='string'||!Number.isFinite(checked)||age< -60000||age>86400000)throw Error('INVALID_RESPONSE');
   clearTimeout(job.timeout);
   const result=await bridge().savePrice(context,{id:data.id,plate:data.plate,priceWon:data.priceWon,checkedAt:new Date(checked).toISOString(),source:'encar'});if(!live())return false;
   const stored=saved(context);if(result?.saved!==true||!stored||stored.id!==record.id||stored.priceWon!==data.priceWon||stored.priceSource!=='encar')throw Error('INVALID_RESPONSE');
   priceState=null;sync();await comparePrice(context,stored,{repeat});return true;
  }catch(error){if(live()||job.timedOut&&priceJob===job&&current(context)&&saved(context)?.id===record.id){priceState={key:context.key,id:record.id,message:priceFailure(job.timedOut?'REQUEST_TIMEOUT':error?.code)+diagnosticText(job.diagnostic)};notify(priceState.message,{tone:'error',key:'encar-price:'+context.key+':'+record.id,isCurrent:()=>current(context)&&saved(context)?.id===record.id});}return false;}
  finally{clearTimeout(job.timeout);if(priceJob===job){priceJob=null;sync();}}})();return job.promise;
 }
 function renderPrice(){
  const context=detailContext(),record=context&&saved(context),scope=context?context.key:null;
  if(detailScope!==scope){cancelPrice();detailScope=scope;compared.clear();}
  if(priceJob&&!current(priceJob.context))cancelPrice();
  if(!context||!record){pricePanel.hidden=true;setText(priceLabel,'');setText(priceMessage,'');priceLabel.removeAttribute('title');return;}
  pricePanel.hidden=false;const checking=!!priceJob&&priceJob.context.key===context.key&&priceJob.id===record.id,writing=!!priceWrite&&priceWrite.context.key===context.key;
  setText(priceLabel,priced(record)?'엔카 광고가 '+record.priceWon.toLocaleString('ko-KR')+'원':checking?'엔카 광고가 확인 중…':'엔카 광고가 확인 필요');
  if(priced(record))priceLabel.title='광고 금액 확인 · '+new Date(record.priceCheckedAt).toLocaleString('ko-KR');else priceLabel.removeAttribute('title');
  const expected=planned(context);priceChange.hidden=!priced(record)||!writable(context)||expected===null||expected===record.priceWon;priceChange.disabled=checking||writing;
  setText(priceMessage,'');
 }
 priceChange.addEventListener('click',()=>{const context=detailContext(),record=context&&saved(context);if(record)void refreshPrice(context,{force:!fresh(record),repeat:true});});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumeComparison();});window.addEventListener('focus',resumeComparison);
 window.addEventListener('snote:encar-advertisement-changed',()=>sync());
 async function lookup(carId,options={}){
  const context=bridge()?.context(String(carId??''),options.entry);if(!context)return false;
  const stored=saved(context);if(stored){openSaved(stored);if(context.entry==='detail')setTimeout(()=>{if(current(context))void refreshPrice(context);},0);return true;}
  if(session)return false;
  const controller=new AbortController(),s={context,controller,sequence:++sequence,timeout:null,timedOut:false,phase:'session',httpStatus:null};session=s;
  title.textContent='차량 광고 검색';output.hidden=true;output.textContent='';output.value='';clearLink();clearDiagnostics();status.textContent='차량의 광고페이지를 찾고있습니다.';busy(true);dialog.showModal();sync();
  s.timeout=setTimeout(()=>{s.timedOut=true;controller.abort();},55000);
  try{
   const token=await abortable(controller.signal,()=>bridge().accessToken(context));if(!live(s))return false;if(!token)throw Error('AUTH_REQUIRED');
   s.phase='request';const response=await abortable(controller.signal,()=>fetch('/api/encar-id',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({plate:context.plate}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}));
   s.httpStatus=response.status;s.diagnostic=responseDiagnostics(response);s.phase='response';const data=await json(response,controller.signal);if(!live(s))return false;s.phase='result';
   if(!response.ok)throw Error(typeof data?.code==='string'&&data.code!=='NOT_FOUND'?data.code:'HTTP_UNAVAILABLE');
   if(response.status===200&&data?.ok===false&&data.status==='not_found'&&data.code==='NOT_FOUND')throw Error('NOT_FOUND');
   if(data?.ok!==true||data.status!=='found')throw Error(data?.code!=='NOT_FOUND'&&Object.hasOwn(diagnosticCodes,data?.code)?data.code:'INVALID_RESPONSE');
   if(data.plate!==context.plate||typeof data.id!=='string'||!ID.test(data.id)||!providers.has(data.provider))throw Error('INVALID_RESPONSE');
   clearTimeout(s.timeout);s.phase='save';
   title.textContent='엔카 링크 페이지';output.value=data.id;output.textContent=data.id;output.hidden=false;status.textContent='광고 링크를 저장하고 있습니다.';
   const url=adURL(data.id);adLink.href=url;adLink.textContent=url;adLink.hidden=false;
   try{const result=await bridge().saveLink(context,{id:data.id,plate:data.plate,provider:data.provider});if(!live(s))return false;if(result?.saved!==true||saved(context)?.id!==data.id)throw Error('INVALID_RESPONSE');}
   catch(error){if(live(s)){lookupFailure(s,writeFailure(error?.code,true));clearDiagnostics();}return false;}
   status.textContent='';notify('광고 링크를 저장했습니다.',{tone:'success',isCurrent:()=>live(s)});sync();if(context.entry==='detail')void refreshPrice(context);
   return true;
  }catch(error){if(live(s)){const raw=error?.message,code=s.timedOut?'REQUEST_TIMEOUT':raw==='NOT_FOUND'||Object.prototype.hasOwnProperty.call(diagnosticCodes,raw)?raw:s.phase==='request'?'NETWORK_ERROR':s.phase==='response'?'RESPONSE_UNREADABLE':'UNKNOWN_ERROR';output.hidden=true;clearLink();lookupFailure(s,message(code));showDiagnostics(code,s);}}finally{clearTimeout(s.timeout);if(live(s)){busy(false);if(!window.SnoteMessages?.active())confirm.focus();}}
  return false;
 }
 function sync(){
  if(session&&!bridge()?.current(session.context)){close();return;}
  renderPrice();
  for(const button of document.querySelectorAll('button[data-encar-id-car],a.snote-list-encar[data-encar-id-car],#vehicle-encar-check')){
   const detail=button.id==='vehicle-encar-check',carId=button.dataset.encarIdCar;
   const context=bridge()?.context(carId,detail?'detail':'list');
   if(button.tagName==='A'){
    // Saved list links use native navigation and an index-local activation guard.
    // A temporarily open detail drawer must not strip their URL and leave them
    // dependent on this optional search/price bundle being available to reopen it.
    if(context){const record=saved(context);
     if(record){if(button.getAttribute('href')!==record.url)button.setAttribute('href',record.url);button.removeAttribute('aria-disabled');button.removeAttribute('tabindex');}
     else{button.removeAttribute('href');button.setAttribute('aria-disabled','true');button.tabIndex=-1;}
    }
    continue;
   }
   button.disabled=!context||!!session&&!saved(context);
   if(detail){const label=context&&saved(context)?'엔카 광고 열기':'엔카 광고 찾기';if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);if(button.dataset.tooltip!==label)button.dataset.tooltip=label;}
  }
 }
 const detail=document.getElementById('vehicle-encar-check');detail?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void lookup(detail.dataset.encarIdCar,{entry:'detail'});});
 adLink.addEventListener('click',event=>{if(!session||!live(session)||adLink.hidden){event.preventDefault();close();}});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 const list=document.getElementById('list-screen');if(list)new MutationObserver(sync).observe(list,{childList:true,subtree:true});
 const overlay=document.getElementById('vehicle-overlay');if(overlay)new MutationObserver(sync).observe(overlay,{attributes:true,attributeFilter:['class','aria-hidden'],childList:true,subtree:true});
 setInterval(sync,350);
 document.getElementById('detail-sell')?.addEventListener('input',()=>renderPrice());
 window.SnoteEncarId=Object.freeze({lookup,reset,refreshPrice,sync});sync();
})();
