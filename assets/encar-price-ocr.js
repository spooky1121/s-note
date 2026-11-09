/* Captured-price OCR is a user-reviewed draft, never a verified Encar quote. */
(()=>{'use strict';
 if(window.SnoteEncarPriceOcr)return;
 const bridge=()=>window.snoteEncarPriceOcrBridge,MAX_BYTES=6*1024*1024,MAX_WON=1000000000000;
 const dialog=document.createElement('dialog');dialog.id='snote-encar-price-ocr';dialog.setAttribute('aria-labelledby','encar-price-ocr-title');
 dialog.innerHTML='<div class="encar-price-ocr-frame"><button type="button" class="snote-popup-close" aria-label="광고 가격 캡처 인식 닫기">×</button><header><h2 id="encar-price-ocr-title">광고 가격 캡처 인식</h2><p class="encar-price-ocr-subtitle"></p></header><p class="encar-price-ocr-help">차명과 판매가격이 보이는 캡처를 선택하세요. 인식 결과를 원본과 비교한 뒤 직접 선택합니다.</p><label class="encar-price-ocr-upload" for="encar-price-ocr-file">캡처 이미지<input id="encar-price-ocr-file" type="file" accept="image/png,image/jpeg,image/webp"><small>PNG · JPG · WEBP, 최대 6MB</small></label><figure class="encar-price-ocr-preview" hidden><img alt="선택한 광고 캡처 원본"><a class="encar-price-ocr-original" target="_blank" rel="noopener noreferrer">원본 크게 보기</a><figcaption>원본의 판매가격과 아래 인식 후보를 비교하세요.</figcaption></figure><div class="encar-price-ocr-read-actions"><button type="button" class="encar-price-ocr-read" id="encar-price-ocr-read" aria-busy="false" disabled>캡처에서 금액 찾기</button></div><p class="encar-price-ocr-status" role="status" aria-live="polite"></p><fieldset class="encar-price-ocr-candidates" hidden><legend>OCR 인식 후보 · 직접 확인</legend><div class="encar-price-ocr-options"></div><p>월 납입금이나 보험료가 아닌 실제 차량 판매가격을 선택하세요.</p></fieldset><footer><button type="button" class="encar-price-ocr-apply" disabled>금액 확인 후 입력</button><p class="encar-price-ocr-save-help">확인한 금액만 판매예정가 입력칸에 채웁니다. 최종 저장은 기존 파란 저장 아이콘을 사용하세요.</p></footer></div>';
 document.body.append(dialog);
 const input=dialog.querySelector('input[type=file]'),preview=dialog.querySelector('figure'),image=preview.querySelector('img'),original=preview.querySelector('.encar-price-ocr-original'),status=dialog.querySelector('[role=status]'),options=dialog.querySelector('.encar-price-ocr-options'),fieldset=dialog.querySelector('fieldset'),read=dialog.querySelector('.encar-price-ocr-read'),apply=dialog.querySelector('.encar-price-ocr-apply'),subtitle=dialog.querySelector('.encar-price-ocr-subtitle');
 let session=null,epoch=0;
 const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const current=s=>session===s&&dialog.open&&bridge()?.current(s.context)===true;
 function note(text,bad=false){status.textContent=text;status.classList.toggle('is-error',bad);}
 function clearResults(s){if(s){s.candidates=[];s.selected=null;}options.replaceChildren();fieldset.hidden=true;apply.disabled=true;}
 function abort(s){if(!s)return;s.version++;s.abort?.abort();s.abort=null;s.reading=false;s.applying=false;try{bridge()?.clear?.(s.context);}catch{};}
 function release(s){if(s?.url){URL.revokeObjectURL(s.url);s.url=null;}image.removeAttribute('src');original.removeAttribute('href');preview.hidden=true;}
 function close(){const s=session;session=null;++epoch;if(s){abort(s);clearInterval(s.timer);release(s);}input.value='';clearResults();note('');dialog.close();}
 function writable(s){if(!current(s))return false;const now=bridge()?.context();return now?.canWrite===true&&now.car===s.context.car&&now.car?.status!=='판매완료';}
 function controls(s){read.disabled=!current(s)||!s.file||!s.decoded||s.reading||s.applying;read.setAttribute('aria-busy',String(s.reading));fieldset.disabled=s.reading||s.applying;apply.disabled=!writable(s)||s.reading||s.applying||!s.selected;}
 function errorMessage(error){
  if(typeof error?.userMessage==='string'&&error.userMessage.length<=180)return error.userMessage;
  const code=String(error?.code||'');return /PENDING|CONFLICT/.test(code)?'진행 중인 차량 저장을 먼저 확인한 뒤 다시 입력해 주세요.':/FORBIDDEN|AUTH/.test(code)?'현재 로그인과 차량 수정 권한을 확인해 주세요.':/TIMEOUT/.test(code)?'이미지 인식 응답이 늦어졌습니다. 잠시 후 다시 시도해 주세요.':/RATE_LIMIT|QUOTA/.test(code)?'이미지 인식 요청 한도를 확인한 뒤 다시 시도해 주세요.':/SETUP|CONFIG/.test(code)?'이미지 인식 서비스 설정을 확인해 주세요.':'이미지의 금액을 읽지 못했습니다. 캡처와 연결 상태를 확인한 뒤 다시 시도해 주세요.';
 }
 function candidates(data){
  if(data?.ok!==true||data.purpose!=='encar-price'||data.engine!=='google-vision'||data.requiresConfirmation!==true||!Array.isArray(data.candidates)||data.candidates.length>20)throw Error('INVALID_RESPONSE');
  const ids=new Set();return data.candidates.map(item=>{
   if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)||ids.has(item.id)||typeof item.display!=='string'||item.display.length>80||!Number.isSafeInteger(item.priceWon)||item.priceWon<=0||item.priceWon>MAX_WON)throw Error('INVALID_RESPONSE');
   const match=/^((?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,4})?)만원$/.exec(item.display);if(!match)throw Error('INVALID_RESPONSE');
   const[whole,fraction='']=match[1].replaceAll(',','').split('.'),won=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
   if(won!==BigInt(item.priceWon))throw Error('INVALID_RESPONSE');ids.add(item.id);return {id:item.id,display:item.display,priceWon:item.priceWon};
  });
 }
 function renderCandidates(s,values){
  clearResults(s);s.candidates=values;fieldset.hidden=!values.length;
  for(const item of values){const label=node('label',undefined,'encar-price-ocr-option'),radio=node('input');radio.type='radio';radio.name='encar-price-ocr-candidate';radio.value=item.id;
   const text=node('span'),original=node('strong',item.display),converted=node('small',item.priceWon.toLocaleString('ko-KR')+'원');text.append(original,converted);label.append(radio,text);options.append(label);
   radio.onchange=()=>{if(!current(s)||s.reading||s.applying)return;s.selected=radio.checked?item:null;controls(s);};
  }
  note(values.length?'OCR 인식 후보입니다. 원본의 판매가격과 일치하는 금액을 직접 선택하세요.':'만원으로 표시된 판매가격을 찾지 못했습니다. 가격 부분이 선명한 캡처로 다시 시도하세요.',!values.length);
 }
 async function fileChanged(){
  const s=session;if(!current(s))return;abort(s);release(s);clearResults(s);s.file=null;s.decoded=false;note('');
  const file=input.files?.[0];if(!file){controls(s);return;}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>MAX_BYTES){note('PNG·JPG·WEBP 형식의 6MB 이하 이미지 파일을 선택하세요.',true);controls(s);return;}
  const version=s.version;s.file=file;s.url=URL.createObjectURL(file);image.src=s.url;original.href=s.url;
  try{if(typeof image.decode==='function')await image.decode();if(!current(s)||s.version!==version)return;s.decoded=true;preview.hidden=false;note('캡처를 확인한 뒤 금액 찾기를 눌러주세요.');}
  catch{if(current(s)&&s.version===version){release(s);s.file=null;note('이미지 파일을 열지 못했습니다. 다른 캡처를 선택하세요.',true);}}
  finally{if(current(s)&&s.version===version)controls(s);}
 }
 input.addEventListener('change',fileChanged);
 read.onclick=async()=>{
  const s=session;if(!current(s)||!s.file||!s.decoded||s.reading||s.applying)return;abort(s);clearResults(s);const version=s.version,controller=new AbortController();s.abort=controller;s.reading=true;controls(s);note('캡처에서 금액을 찾고 있습니다…');
  try{const result=await bridge().read(s.context,s.file,{signal:controller.signal});if(!current(s)||s.version!==version||controller.signal.aborted)return;renderCandidates(s,candidates(result));}
  catch(error){if(current(s)&&s.version===version&&!controller.signal.aborted)note(errorMessage(error),true);}
  finally{if(current(s)&&s.version===version){s.abort=null;s.reading=false;controls(s);}}
 };
 apply.onclick=async()=>{
  const s=session;if(!writable(s)||s.reading||s.applying||!s.selected)return;const version=s.version,selected=s.selected;s.applying=true;controls(s);
  try{const result=await bridge().apply(s.context,selected);if(!current(s)||s.version!==version)return;if(result?.ok!==true||result.priceWon!==selected.priceWon||result.saved!==false)throw Error('UNCONFIRMED_DRAFT');note('판매예정가에 입력했습니다. 창을 닫고 파란 저장 아이콘을 눌러 저장해 주세요.');}
  catch(error){if(current(s)&&s.version===version)note(errorMessage(error),true);}
  finally{if(current(s)&&s.version===version){s.applying=false;controls(s);}}
 };
 function open(){
  const context=bridge()?.context();if(!context)return;close();const s={context,id:++epoch,version:0,file:null,url:null,decoded:false,candidates:[],selected:null,reading:false,applying:false,abort:null};session=s;subtitle.textContent=[context.car?.model,context.car?.plate].filter(Boolean).join(' · ');dialog.showModal();note('캡처를 선택해 실제 인식 결과를 확인하세요.');controls(s);
  s.timer=setInterval(()=>{if(!current(s)){close();return;}controls(s);},250);input.focus();
 }
 dialog.querySelector('.snote-popup-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();event.stopImmediatePropagation();close();}},true);
 const header=()=>document.getElementById('vehicle-encar-price-ocr');
 function mount(){const button=header();if(!button||button.dataset.ocrBound==='true')return;button.dataset.ocrBound='true';button.onclick=open;}
 function refresh(){mount();const button=header();if(button)button.disabled=!bridge()?.context();if(session&&!current(session))close();}
 mount();refresh();const refreshTimer=setInterval(refresh,500);
 window.addEventListener('pagehide',()=>{close();clearInterval(refreshTimer);});window.addEventListener('snote:route-changed',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 window.SnoteEncarPriceOcr=Object.freeze({open,close,refresh});
})();
