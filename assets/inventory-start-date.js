/* A finance start date is saved independently from the vehicle's other drafts. */
(() => {
 'use strict';
 if(window.SnoteInventoryStartDate)return;
 let dialog,dateInput,status,saveButton,cancelButton,closeButton,carLabel,state=null,epoch=0;
 const bridge=()=>window.snoteInventoryStartBridge;
 function current(job){return state===job&&job.epoch===epoch&&bridge()?.current(job.base)===true;}
 function close(force=false){
  if(state?.saving&&!force)return;
  if(state?.timer)clearInterval(state.timer);
  state=null;epoch++;if(dialog?.open)dialog.close();
  if(status)status.textContent='';
 }
 async function save(){
  const job=state;if(!job||job.saving||!current(job))return;
  if(!dateInput.value||!dateInput.checkValidity()){status.textContent='오늘 이전의 올바른 재고 시작일을 입력해 주세요.';dateInput.reportValidity();return;}
  const selected=job.retryDate||dateInput.value;
  job.saving=true;dateInput.disabled=true;saveButton.disabled=true;cancelButton.disabled=true;closeButton.disabled=true;status.textContent='재고 시작일을 저장하고 있습니다…';
  try{
   const result=await bridge().save(job.base,selected);
   if(!current(job))return;
   if(result?.ok!==true||result.saved!==true||result.startDate!==selected)throw Error('UNCONFIRMED_START_DATE');
   close(true);window.toast?.('재고 시작일을 저장했습니다.');
  }catch(error){
   if(!current(job))return;
   // Keep the original context and date for an uncertain write acknowledgement.
   // The bridge reconciles its exact pending CAS before permitting another write.
   job.retryDate=job.base.car.inventoryStartedAt===selected?selected:null;
   status.textContent=typeof error?.userMessage==='string'?error.userMessage:'재고 시작일을 저장하지 못했습니다. 다시 시도해 주세요.';
  }finally{
   if(current(job)){job.saving=false;dateInput.disabled=!!job.retryDate;saveButton.disabled=false;cancelButton.disabled=false;closeButton.disabled=false;}
  }
 }
 function create(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.id='snote-inventory-start-dialog';dialog.setAttribute('aria-labelledby','snote-inventory-start-title');
  dialog.innerHTML='<button type="button" class="snote-popup-close" aria-label="재고 시작일 닫기">×</button><h2 id="snote-inventory-start-title">재고 시작일</h2><p class="snote-inventory-start-car"></p><label class="snote-inventory-start-label">시작일<input type="date" id="snote-inventory-start-date" required min="1900-01-01" autocomplete="off"></label><p class="snote-inventory-start-status" role="status" aria-live="polite"></p><footer><button type="button" class="snote-inventory-start-cancel">취소</button><button type="button" class="snote-inventory-start-save">저장</button></footer>';
  document.body.append(dialog);dateInput=dialog.querySelector('input');status=dialog.querySelector('[role=status]');saveButton=dialog.querySelector('.snote-inventory-start-save');cancelButton=dialog.querySelector('.snote-inventory-start-cancel');closeButton=dialog.querySelector('.snote-popup-close');carLabel=dialog.querySelector('.snote-inventory-start-car');
  saveButton.onclick=save;cancelButton.onclick=()=>close();closeButton.onclick=()=>close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();event.stopImmediatePropagation();close();}},true);
  dateInput.addEventListener('input',()=>{if(state&&!state.saving&&!state.retryDate)status.textContent='';});
 }
 function open(){
  if(state?.saving)return;
  const base=bridge()?.context();if(!base){window.toast?.('판매 중인 차량의 온라인 연결 상태를 확인해 주세요.');return;}
  let data;try{data=bridge().read(base);}catch(_){window.toast?.('현재 차량을 다시 확인해 주세요.');return;}
  close(true);create();const job={base,epoch:++epoch,saving:false,retryDate:data.pendingDate||null,timer:null};state=job;
  carLabel.textContent=[base.car.model,base.car.plate].filter(Boolean).join(' · ');dateInput.value=data.pendingDate||data.startDate||'';dateInput.max=data.today;dateInput.disabled=!!job.retryDate;
  saveButton.disabled=false;cancelButton.disabled=false;closeButton.disabled=false;status.textContent=job.retryDate?'이전 저장의 확인이 필요합니다. 저장을 눌러 다시 확인해 주세요.':'';
  dialog.showModal();dateInput.focus();job.timer=setInterval(()=>{if(!current(job))close(true);},250);
 }
 window.SnoteInventoryStartDate=Object.freeze({open,close:()=>close()});
})();
