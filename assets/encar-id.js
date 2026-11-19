/* External advertisement ID lookup only. No listing, price, vehicle or local writes. */
(()=>{'use strict';
 if(window.SnoteEncarId)return;
 const bridge=()=>window.snoteEncarIdBridge,ID=/^[1-9][0-9]{5,11}$/,providers=new Set(['gloar']);
 let session=null,sequence=0;
 const dialog=document.createElement('dialog');dialog.id='snote-encar-id-dialog';dialog.className='snote-encar-id-dialog snote-popup-native';dialog.setAttribute('aria-labelledby','snote-encar-id-title');
 const title=document.createElement('h2');title.id='snote-encar-id-title';title.textContent='광고 ID';
 const loading=document.createElement('div');loading.className='snote-encar-id-loading';loading.dataset.encarIdLoading='';loading.hidden=true;loading.setAttribute('aria-hidden','true');
 const scan=document.createElement('div');scan.className='snote-encar-id-scan';
 for(const name of['card','beam','lens']){const shape=document.createElement('span');shape.className='snote-encar-id-scan-'+name;scan.append(shape);}
 const dots=document.createElement('div');dots.className='snote-encar-id-loading-dots';for(let index=0;index<3;index++)dots.append(document.createElement('span'));loading.append(scan,dots);
 const output=document.createElement('output');output.dataset.encarAdId='';output.hidden=true;output.setAttribute('aria-label','광고 ID');
 const status=document.createElement('p');status.className='snote-encar-id-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const confirm=document.createElement('button');confirm.type='button';confirm.className='snote-encar-id-confirm';confirm.textContent='확인';confirm.addEventListener('click',close);
 dialog.append(title,loading,output,status,confirm);document.body.append(dialog);
 function busy(active){loading.hidden=!active;if(active)dialog.setAttribute('aria-busy','true');else dialog.removeAttribute('aria-busy');}
 function close(){const active=session;session=null;++sequence;if(active){active.controller.abort();clearTimeout(active.timeout);}if(dialog.open)dialog.close();busy(false);output.value='';output.textContent='';output.hidden=true;status.textContent='';sync();}
 function live(s){return session===s&&dialog.open&&bridge()?.current(s.context)===true;}
 function message(code){return({SEARCH_NOT_CONFIGURED:'검색 서비스 설정을 확인해 주세요.',SEARCH_AUTH_FAILED:'검색 서비스의 인증 설정을 확인해 주세요.',SEARCH_RATE_LIMITED:'검색 서비스가 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',SEARCH_UNAVAILABLE:'검색 서비스에 연결하지 못했습니다.',SEARCH_INVALID_RESPONSE:'검색 서비스의 응답을 확인하지 못했습니다.',SEARCH_TIMEOUT:'광고 검색 시간이 초과됐습니다.',NOT_FOUND:'광고 ID를 찾지 못했습니다.',AUTH_REQUIRED:'다시 로그인한 뒤 확인해 주세요.',AUTH_FAILED:'다시 로그인한 뒤 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 차량을 다시 확인해 주세요.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 확인해 주세요.',UPSTREAM_RATE_LIMITED:'검색 브라우저의 실행 요청이 제한되었습니다. 잠시 후 다시 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 검색 서버 설정을 확인해 주세요.',BROWSER_UNAVAILABLE:'광고 검색 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.',BROWSER_BUSY:'다른 광고 검색이 진행 중입니다. 잠시 후 다시 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.',PROVIDER_UNSUPPORTED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',PROVIDERS_UNAVAILABLE:'GLOAR DATA의 검색 응답을 확인하지 못했습니다.',GLOAR_PAGE_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_ACCESS_BLOCKED:'GLOAR DATA에서 검색 브라우저의 접근을 제한했습니다.',GLOAR_NAVIGATION_BLOCKED:'GLOAR DATA의 검색 화면을 확인하지 못했습니다.',GLOAR_INPUT_MISSING:'GLOAR DATA의 검색창을 찾지 못했습니다.',GLOAR_INPUT_UNAVAILABLE:'GLOAR DATA의 검색창을 사용할 수 없습니다.',GLOAR_INPUT_UNCONFIRMED:'GLOAR DATA의 검색창에 차량번호가 적용됐는지 확인하지 못했습니다.',GLOAR_FOCUS_FAILED:'GLOAR DATA의 검색창을 선택하지 못했습니다.',GLOAR_ENTER_FAILED:'GLOAR DATA의 차량 검색을 실행하지 못했습니다.',GLOAR_NO_NAVIGATION:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_UNAVAILABLE:'GLOAR DATA에 연결하지 못했습니다.',GLOAR_SEARCH_UNCONFIRMED:'GLOAR DATA의 검색 결과가 갱신됐는지 확인하지 못했습니다.',GLOAR_ID_UNVERIFIED:'GLOAR DATA에서 원본 엔카 광고 ID를 확인하지 못했습니다.',GLOAR_AMBIGUOUS:'GLOAR DATA에서 광고 ID를 하나로 확인하지 못했습니다.',BROWSER_AUTH_FAILED:'광고 검색 서버의 인증 설정을 확인해 주세요.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다. 다시 확인해 주세요.'})[code]||'광고 ID를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';}
 async function abortable(signal,operation){
  if(signal.aborted)throw Error('ABORTED');
  let abort;const interrupted=new Promise((resolve,reject)=>{abort=()=>reject(Error('ABORTED'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw Error('ABORTED');return operation();}),interrupted]);}finally{signal.removeEventListener('abort',abort);}
 }
 async function json(response,signal){if(!/application\/json/i.test(response.headers.get('Content-Type')||''))throw Error('INVALID_RESPONSE');const reader=response.body?.getReader();if(!reader)throw Error('INVALID_RESPONSE');let size=0;const chunks=[];try{for(;;){const{done,value}=await abortable(signal,()=>reader.read());if(done)break;size+=value.byteLength;if(size>16384)throw Error('INVALID_RESPONSE');chunks.push(value);}}catch(e){try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}throw e;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));}
 async function lookup(carId,options={}){
  if(session)return false;
  const context=bridge()?.context(String(carId??''),options.entry);if(!context)return false;
  const controller=new AbortController(),s={context,controller,sequence:++sequence,timeout:null,timedOut:false};session=s;
  output.hidden=true;output.textContent='';output.value='';status.textContent='GLOAR DATA에서 광고 ID를 찾고 있습니다.';busy(true);dialog.showModal();sync();
  s.timeout=setTimeout(()=>{s.timedOut=true;controller.abort();},55000);
  try{
   const token=await abortable(controller.signal,()=>bridge().accessToken(context));if(!live(s))return false;if(!token)throw Error('AUTH_REQUIRED');
   const response=await abortable(controller.signal,()=>fetch('/api/encar-id',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({plate:context.plate}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}));
   const data=await json(response,controller.signal);if(!live(s))return false;
   if(!response.ok||data?.ok!==true||data.status!=='found')throw Error(typeof data?.code==='string'?data.code:data?.status==='not_found'?'NOT_FOUND':'INVALID_RESPONSE');
   if(data.plate!==context.plate||typeof data.id!=='string'||!ID.test(data.id)||!providers.has(data.provider))throw Error('INVALID_RESPONSE');
   output.value=data.id;output.textContent=data.id;output.hidden=false;status.textContent='';
   return true;
  }catch(error){if(live(s)){output.hidden=true;status.textContent=message(s.timedOut?'REQUEST_TIMEOUT':error?.message);}}finally{clearTimeout(s.timeout);if(live(s)){busy(false);confirm.focus();}}
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
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 const list=document.getElementById('list-screen');if(list)new MutationObserver(sync).observe(list,{childList:true,subtree:true});
 const overlay=document.getElementById('vehicle-overlay');if(overlay)new MutationObserver(sync).observe(overlay,{attributes:true,attributeFilter:['class','aria-hidden'],childList:true,subtree:true});
 setInterval(sync,350);
 window.SnoteEncarId=Object.freeze({lookup,reset:close});sync();
})();
