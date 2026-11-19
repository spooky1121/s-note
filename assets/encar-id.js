/* External advertisement ID lookup only. No listing, price, vehicle or local writes. */
(()=>{'use strict';
 if(window.SnoteEncarId)return;
 const bridge=()=>window.snoteEncarIdBridge,ID=/^[1-9][0-9]{5,11}$/,providers=new Set(['carnect','gloar','trust']);
 let session=null,sequence=0;
 const dialog=document.createElement('dialog');dialog.id='snote-encar-id-dialog';dialog.className='snote-encar-id-dialog snote-popup-native';dialog.setAttribute('aria-labelledby','snote-encar-id-title');
 const title=document.createElement('h2');title.id='snote-encar-id-title';title.textContent='광고 ID';
 const output=document.createElement('output');output.dataset.encarAdId='';output.hidden=true;output.setAttribute('aria-label','광고 ID');
 const status=document.createElement('p');status.className='snote-encar-id-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const confirm=document.createElement('button');confirm.type='button';confirm.className='snote-encar-id-confirm';confirm.textContent='확인';confirm.addEventListener('click',close);
 dialog.append(title,output,status,confirm);document.body.append(dialog);
 function close(){const active=session;session=null;++sequence;if(active){active.controller.abort();clearTimeout(active.timeout);}if(dialog.open)dialog.close();dialog.removeAttribute('aria-busy');output.value='';output.textContent='';output.hidden=true;status.textContent='';sync();}
 function live(s){return session===s&&dialog.open&&bridge()?.current(s.context)===true;}
 function message(code){return({NOT_FOUND:'광고 ID를 찾지 못했습니다.',AUTH_REQUIRED:'다시 로그인한 뒤 확인해 주세요.',AUTH_FAILED:'다시 로그인한 뒤 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 차량을 다시 확인해 주세요.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 확인해 주세요.',UPSTREAM_RATE_LIMITED:'외부 사이트의 요청 제한으로 잠시 후 다시 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 ID 검색 연결을 준비하고 있습니다.',PROVIDER_UNSUPPORTED:'외부 사이트의 검색 화면을 확인하지 못했습니다.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다. 다시 확인해 주세요.'})[code]||'광고 ID를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';}
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
  output.hidden=true;output.textContent='';output.value='';status.textContent='광고 ID를 찾고 있습니다.';dialog.setAttribute('aria-busy','true');dialog.showModal();sync();
  s.timeout=setTimeout(()=>{s.timedOut=true;controller.abort();},55000);
  try{
   const token=await abortable(controller.signal,()=>bridge().accessToken(context));if(!live(s))return false;if(!token)throw Error('AUTH_REQUIRED');
   const response=await abortable(controller.signal,()=>fetch('/api/encar-id',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({plate:context.plate}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal}));
   const data=await json(response,controller.signal);if(!live(s))return false;
   if(!response.ok||data?.ok!==true||data.status!=='found')throw Error(typeof data?.code==='string'?data.code:data?.status==='not_found'?'NOT_FOUND':'INVALID_RESPONSE');
   if(data.plate!==context.plate||typeof data.id!=='string'||!ID.test(data.id)||!providers.has(data.provider))throw Error('INVALID_RESPONSE');
   output.value=data.id;output.textContent=data.id;output.hidden=false;status.textContent='';
   return true;
  }catch(error){if(live(s)){output.hidden=true;status.textContent=message(s.timedOut?'REQUEST_TIMEOUT':error?.message);}}finally{clearTimeout(s.timeout);if(live(s)){dialog.removeAttribute('aria-busy');confirm.focus();}}
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
