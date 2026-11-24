/* Three-step registration reuses the existing form controls and save pipeline. */
(()=>{'use strict';
 if(window.SnotePurchaseRegistration)return;
 const doc=document,MAX_WON=1000000000000;
 const node=(tag,text,className)=>{const el=doc.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
 const by=id=>doc.getElementById(id);
 let root,form,body,panels=[],progress=[],previous,next,complete,message,counter,step=1,saving=false,pending=false,closeJob=null,messageVersion=0,invalidControl=null,registrationMode='purchase',incomeSerial=0;
 const disabledBefore=new Map();
 const modeDisabled=new Map();
 const labels=['차량 정보','금액·비용','재고 설정'];
 const saleLabels=['차량 정보','금액·비용','정산'];
 const incomeDefinitions=[['commission','수수료'],['insurance','보험'],['finance','할부금융']];
 const currentLabels=()=>registrationMode==='sale'?saleLabels:labels;
 const isSale=()=>registrationMode==='sale';
 function setMode(value){
  registrationMode=value==='sale'?'sale':'purchase';root.dataset.registrationMode=registrationMode;
  by('purchase-registration-title').textContent=isSale()?'판매등록':'신규 차량 등록';
  progress.forEach((item,i)=>{item.lastElementChild.textContent=currentLabels()[i];panels[i].setAttribute('aria-label',currentLabels()[i]);});
  const sellLabel=form.querySelector('label[for="new-sell"]');if(sellLabel)sellLabel.textContent=isSale()?'판매가 *':'판매예정가';
  const heading=panels[1].querySelector('.add-subtitle>span');if(heading)heading.textContent=isSale()?'매입 부대비용 (−)':'매입 부대비용';
  const repairTotal=by('new-repair-total')?.parentElement;if(repairTotal?.firstChild?.nodeType===3)repairTotal.firstChild.nodeValue=isSale()?'추가비용 합계 ':'수리비 합계 ';
  for(const el of form.querySelectorAll('[data-sale-registration-only]')){el.hidden=!isSale();for(const control of el.querySelectorAll('input,select,textarea,button'))control.disabled=!isSale();}
  applyModeControls();
 }
 function applyModeControls(){
  if(!form)return;
  if(!isSale()){for(const [el,disabled]of modeDisabled)if(el.isConnected)el.disabled=disabled;modeDisabled.clear();return;}
  for(const el of form.querySelectorAll('.cost-fieldgrid input,.cost-fieldgrid select,.cost-fieldgrid button,.purchase-registration-finance-grid input,.purchase-registration-finance-grid select,.purchase-registration-finance-grid button,#snote-new-cost-settings-trigger')){
   if(!modeDisabled.has(el))modeDisabled.set(el,el.disabled);if(!el.disabled)el.disabled=true;
  }
 }
 function saleError(text,field){const error=Error(text);error.field=field;throw error;}
 function validDate(value){return globalThis.SnoteSaleValidation?.date(value)===true;}
 function readSaleDraft(strict=true){
  const read=(el,required,label)=>{const amount=money(el,required);if(strict&&amount===null)saleError(label+'을 원 단위 숫자로 입력해 주세요.',el);return amount??0;};
  const buy=read(by('new-buy'),true,'매입가'),soldPrice=read(by('new-sell'),true,'판매가'),soldAt=String(by('new-sold-date')?.value||'').trim(),purchaseAt=String(by('new-purchase-date')?.value||'').trim();
  if(strict&&soldPrice<=0)saleError('판매가는 0보다 큰 금액으로 입력해 주세요.',by('new-sell'));
  if(strict&&!validDate(soldAt))saleError('판매 완료 날짜를 입력해 주세요.',by('new-sold-date'));
  if(strict&&validDate(purchaseAt)&&soldAt<purchaseAt)saleError('판매 완료 날짜는 매입일보다 빠를 수 없습니다.',by('new-sold-date'));
  const repairRows=[...by('new-repair-items').querySelectorAll('.repair-row')];
  if(strict&&repairRows.length>40)saleError('추가비용은 최대 40개까지 입력해 주세요.',by('new-repair-add'));
  const repairItems=repairRows.map(row=>{const memoField=row.querySelector('.repair-memo'),memo=String(memoField.value||'').trim(),amount=read(row.querySelector('.repair-amount'),false,'추가비용');if(strict&&memo.length>120)saleError('추가비용 항목은 120자 이내로 입력해 주세요.',memoField);if(strict&&amount>0&&!memo)saleError('금액을 입력한 추가비용의 항목명을 입력해 주세요.',memoField);return{memo,amount};}).filter(item=>item.memo||item.amount>0);
  const incomeItems=incomeDefinitions.map(([id,label])=>({id,label,amountWon:read(by('new-sale-income-'+id),false,label+' 수익')}));
  const customRows=[...by('new-sale-income-items').querySelectorAll('.sale-registration-income-row')];
  if(strict&&customRows.length+incomeItems.length>40)saleError('수익 항목은 최대 40개까지 입력해 주세요.',by('new-sale-income-add'));
  for(const row of customRows){const field=row.querySelector('.sale-income-label'),label=String(field.value||'').trim(),amountWon=read(row.querySelector('.sale-income-amount'),false,'추가수익');if(strict&&label.length>40)saleError('추가수익 항목은 40자 이내로 입력해 주세요.',field);if(strict&&amountWon>0&&!label)saleError('금액을 입력한 추가수익의 항목명을 입력해 주세요.',field);if(label||amountWon>0)incomeItems.push({id:row.dataset.incomeId,label,amountWon});}
  const expenseTotal=repairItems.reduce((sum,item)=>sum+item.amount,0),incomeTotal=incomeItems.reduce((sum,item)=>sum+item.amountWon,0),settlement=soldPrice-buy-expenseTotal+incomeTotal;
  return{soldAt,soldPrice,buy,repairItems,incomeItems,expenseTotal,incomeTotal,settlement};
 }
 function saleDraft(){if(!mount()||!isSale())return null;return readSaleDraft(true);}
 const won=value=>Number(value||0).toLocaleString('ko-KR')+'원';
 function renderSaleSummary(){
  const host=by('sale-registration-settlement');if(!host)return;
  const draft=readSaleDraft(false);by('sale-registration-car-price').textContent=won(draft.soldPrice);
  const fill=(id,items)=>{const list=by(id);list.replaceChildren();for(const item of items){const row=node('div',null,'sale-registration-summary-row');row.append(node('span',item.label),node('strong',won(item.amountWon)));list.append(row);}};
  fill('sale-registration-expense-list',[{label:'매입가',amountWon:draft.buy},...draft.repairItems.map(item=>({label:item.memo||'추가비용',amountWon:item.amount}))]);
  fill('sale-registration-income-list',draft.incomeItems);
  by('sale-registration-expense-total').textContent=won(draft.buy+draft.expenseTotal);by('sale-registration-income-total').textContent=won(draft.incomeTotal);
  const net=by('sale-registration-net');net.textContent=won(draft.settlement);net.dataset.tone=draft.settlement<0?'expense':'income';
  by('sale-registration-income-total-live').textContent=won(draft.incomeTotal);
 }
 function addIncomeRow(){
  if(!isSale()||saving||pending)return;
  const list=by('new-sale-income-items');if(list.children.length>=37)return reportError('수익 항목은 최대 40개까지 입력할 수 있어요.',2,by('new-sale-income-add'));
  const row=node('div',null,'sale-registration-income-row');row.dataset.incomeId='sale-income-'+(++incomeSerial);
  const label=node('input');label.type='text';label.className='sale-income-label';label.maxLength=40;label.placeholder='추가수익 항목';label.setAttribute('aria-label','추가수익 항목명');
  const amount=node('input');amount.type='text';amount.className='sale-income-amount detail-money-input';amount.inputMode='numeric';amount.autocomplete='off';amount.maxLength=18;amount.placeholder='금액(원)';amount.setAttribute('aria-label','추가수익 금액 (원)');
  const remove=node('button','−','sale-income-remove');remove.type='button';remove.setAttribute('aria-label','추가수익 삭제');remove.addEventListener('click',()=>{if(saving||pending)return;row.remove();clearMessage();synchronizeSummary();form.dispatchEvent(new Event('input',{bubbles:true}));by('new-sale-income-add').focus();});
  row.append(label,amount,remove);list.append(row);label.focus();form.dispatchEvent(new Event('input',{bubbles:true}));
 }
 function control(field){const select=by('new-'+field);return select?.value==='__manual__'?by('snote98-'+field+'-input'):select;}
 function choice(field){try{if(typeof snote98Choice==='function')return snote98Choice(field);}catch{}const el=control(field);return String(el?.value||'').trim();}
 function ocrTitle(){try{return typeof snote98UsingOcrTitle==='function'&&snote98UsingOcrTitle();}catch{return false;}}
 function clearMessage(){++messageVersion;if(invalidControl){invalidControl.removeAttribute('aria-invalid');invalidControl=null;}if(message){message.textContent='';message.hidden=true;}}
 function reportError(text,which=step,field){
  showStep(which,{focus:false});const version=++messageVersion,atStep=step,el=typeof field==='string'?by(field):field;
  message.textContent=String(text||'입력 내용을 확인해 주세요.');message.dataset.tone='error';message.hidden=true;
  if(el){invalidControl=el;el.setAttribute('aria-invalid','true');}
  window.snoteNotify(message.textContent,{tone:'error',key:'purchase-registration',isCurrent:()=>version===messageVersion&&root.isConnected&&root.classList.contains('open')&&form.isConnected&&step===atStep&&!saving,returnFocus:()=>el?.isConnected&&!el.disabled?el:next});return false;
 }
 function providedValid(el){
  if(!el||el.disabled)return true;
  const value=String(el.value||'').trim(),max=Number(el.getAttribute('maxlength'));
  if(max>0&&value.length>max)return false;
  if(el.validity?.badInput)return false;
  if(!value)return true;
  return !el.validity||(!el.validity.rangeUnderflow&&!el.validity.rangeOverflow&&!el.validity.patternMismatch&&!el.validity.typeMismatch&&!el.validity.stepMismatch);
 }
 function money(el,required=false){
  const raw=String(el?.value||'').trim();
  if(!raw)return required?null:0;
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw))return null;
  const value=Number(raw.replaceAll(',',''));
  return Number.isSafeInteger(value)&&value>=0&&value<=MAX_WON?value:null;
 }
 function applyRequired(){
  if(!form)return;form.noValidate=true;
  for(const field of ['make','group','generation','grade']){
   const select=by('new-'+field),input=by('snote98-'+field+'-input');if(!select||!input)continue;
   const required=field==='make'||field==='group'&&!ocrTitle(),manual=select.value==='__manual__';
   if(select.required!==(!manual&&required))select.required=!manual&&required;
   if(input.required!==(manual&&required))input.required=manual&&required;
  }
  for(const id of ['new-plate','new-year']){const el=by(id);if(el?.required)el.required=false;}
  const rawModel=by('new-model');if(rawModel&&rawModel.required!==!!ocrTitle())rawModel.required=!!ocrTitle();
  const purchasePrice=by('new-buy');if(purchasePrice&&!purchasePrice.required)purchasePrice.required=true;
  const salePrice=by('new-sell');if(salePrice&&salePrice.required!==isSale())salePrice.required=isSale();
  const soldDate=by('new-sold-date');if(soldDate&&soldDate.required!==isSale())soldDate.required=isSale();
  const groupLabel=form.querySelector('label[for="new-group"]');if(groupLabel)groupLabel.textContent=ocrTitle()?'차명 (목록 선택)':'차명(모델명) *';
 }
 function validateStep(which){
  if(!mount())return false;applyRequired();clearMessage();
  if(which===1){
   if(!choice('make'))return reportError('제조사를 입력해 주세요.',1,control('make'));
   if(!choice('group')&&!(ocrTitle()&&String(by('new-model')?.value||'').trim()))return reportError('차명을 입력해 주세요.',1,ocrTitle()?by('new-model'):control('group'));
   const fields=['new-plate','new-vin','new-year','new-km','new-purchase-date',...(ocrTitle()?['new-model']:[]),...['make','group','generation','grade'].filter(f=>by('new-'+f)?.value==='__manual__').map(f=>'snote98-'+f+'-input')];
   for(const id of fields)if(!providedValid(by(id)))return reportError('차량 정보의 입력 형식을 확인해 주세요.',1,id);
  }
  if(which===2){
   if(isSale()){try{readSaleDraft(true);}catch(error){return reportError(error.message,2,error.field);}return true;}
   if(money(by('new-buy'),true)===null)return reportError('매입가를 원 단위 숫자로 입력해 주세요.',2,'new-buy');
   if(money(by('new-sell'))===null)return reportError('판매예정가를 원 단위 숫자로 입력해 주세요.',2,'new-sell');
   for(const el of panels[1].querySelectorAll('.cost-fieldgrid input.detail-money-input,.repair-amount'))if(money(el)===null)return reportError('비용을 0 이상 원 단위 숫자로 입력해 주세요.',2,el);
   for(const el of panels[1].querySelectorAll('.repair-memo'))if(!providedValid(el))return reportError('추가비용 메모를 확인해 주세요.',2,el);
  }
  if(which===3){
   if(isSale()){try{readSaleDraft(true);}catch(error){return reportError(error.message,2,error.field);}return true;}
   if(money(by('new-inventory-loan'))===null)return reportError('재고금액을 0 이상 원 단위 숫자로 입력해 주세요.',3,'new-inventory-loan');
   const date=by('new-inventory-started-at');if(!providedValid(date))return reportError('재고 시작일을 확인해 주세요.',3,date);
  }
  return true;
 }
 function validateAll(){for(let i=1;i<=3;i++)if(!validateStep(i))return false;return true;}
 function visibleControls(){return [...root.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);}
 function showStep(which,{focus=true}={}){
  if(!form)return false;step=Math.max(1,Math.min(3,Number(which)||1));
  panels.forEach((panel,i)=>{panel.hidden=i!==step-1;});
  progress.forEach((item,i)=>{item.classList.toggle('is-current',i===step-1);item.classList.toggle('is-complete',i<step-1);if(i===step-1)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
  previous.hidden=step===1;next.hidden=step===3;complete.hidden=step!==3;counter.textContent=step+' / 3';
  by('purchase-registration-caption').textContent=currentLabels()[step-1];
  body.scrollTop=0;applyRequired();refreshSummary();
  if(focus){const target=panels[step-1].querySelector('select:not([hidden]):not(:disabled),input:not([type="hidden"]):not([hidden]):not(:disabled),button:not(:disabled)')||(step===3?complete:next);target?.focus({preventScroll:true});}
  return true;
 }
 function refreshSummary(){
  if(!form)return;
  if(isSale()){renderSaleSummary();return;}
  if(!String(by('new-sell')?.value||'').trim()){
   const cell=by('add-cost-summary')?.querySelector('.sum-cell:last-child');
   if(cell){cell.classList.remove('net','loss');const value=cell.querySelector('strong');if(value)value.textContent='—';}
  }
 }
 function synchronizeSummary(){if(!isSale())try{if(typeof updateAddSummary==='function')updateAddSummary();}catch{}refreshSummary();}
 function financeField(label,id,type='text'){
  const wrap=node('label',null,'purchase-registration-finance-field');wrap.htmlFor=id;wrap.append(node('span',label));
  const input=node(type==='select'?'select':'input');input.id=id;
  if(type!=='select')input.type=type;
  if(type==='text'){input.className='detail-money-input';input.inputMode='numeric';input.autocomplete='off';input.placeholder='0';input.setAttribute('maxlength','18');}
  if(type==='date')input.addEventListener('click',()=>{try{if(typeof openDateInputCalendar==='function')openDateInputCalendar(input);}catch{}});
  wrap.append(input);return wrap;
 }
 function populateLenders(){
  const select=by('new-inventory-lender');if(!select)return;const old=select.value;
  let values=[];try{if(typeof snote169CompanyLenderNames==='function')values=snote169CompanyLenderNames();else if(typeof INVENTORY_LENDERS!=='undefined'&&Array.isArray(INVENTORY_LENDERS))values=INVENTORY_LENDERS;}catch{}
  select.replaceChildren(new Option('선택 안 함',''),...[...new Set(values)].map(value=>new Option(String(value),String(value))));
  if(values.includes(old))select.value=old;
 }
 function ensureDialog(){
  const dialog=root.querySelector('.snote-popup-frame')||form;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','purchase-registration-title');
  if(dialog!==form){form.removeAttribute('role');form.removeAttribute('aria-modal');}
 }
 function lockControls(){
  const controls=[...form.querySelectorAll('input,select,textarea,button'),...root.querySelectorAll('button.snote-popup-close')];
  for(const el of controls){if(!disabledBefore.has(el))disabledBefore.set(el,el.disabled);el.disabled=true;}
 }
 function unlockControls(){for(const [el,value]of disabledBefore)if(el.isConnected)el.disabled=value;disabledBefore.clear();}
 function setSaving(value,{pending:keepPending=false}={}){
  if(!mount())return;saving=!!value;pending=!!keepPending;unlockControls();
  if(saving||pending)lockControls();
  if(!saving&&pending){complete.disabled=false;for(const el of root.querySelectorAll('button.snote-popup-close'))el.disabled=false;}
  form.setAttribute('aria-busy',String(saving));complete.classList.toggle('is-saving',saving);
  complete.textContent=saving?'저장 중…':pending?'저장 재시도':'완료';
 }
 function setPending(value){setSaving(false,{pending:!!value});}
 function cancelClose(){if(closeJob)closeJob.cancel();}
 function close(finish,valid=()=>true){
  if(!mount()||!valid())return Promise.resolve(false);
  if(closeJob)return closeJob.promise;
  const frame=root.querySelector('.snote-popup-frame')||form;
  if(!frame.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve(valid()?finish():false);
  const job={promise:null,cancel:null};let resolve,settled=false,timer,animation;
  job.promise=new Promise(r=>resolve=r);closeJob=job;
  const wasInert=frame.inert,oldAnimation=frame.style.animation;frame.inert=true;frame.style.animation='none';root.dataset.registrationClosing='true';
  function end(commit){if(settled)return;settled=true;clearTimeout(timer);animation?.cancel();frame.inert=wasInert;frame.style.animation=oldAnimation;delete root.dataset.registrationClosing;if(closeJob===job)closeJob=null;resolve(commit&&valid()?finish():false);}
  job.cancel=()=>end(false);
  try{const style=getComputedStyle(frame);animation=frame.animate([{opacity:style.opacity,transform:style.transform==='none'?'translateY(0) scale(1)':style.transform},{opacity:0,transform:'translateY(8px) scale(.985)'}],{duration:170,easing:'ease-in',fill:'forwards'});animation.finished.then(()=>end(true),()=>end(false));timer=setTimeout(()=>end(true),350);}catch{end(true);}
  return job.promise;
 }
 function reset(){
  if(!mount())return;cancelClose();setSaving(false);clearMessage();
  window.SnoteVehicleCostSettings?.resetRegistration();
  by('new-prestock').checked=false;
  for(const id of ['new-inventory-loan','new-inventory-started-at','new-inventory-interest'])by(id).value='';
  incomeSerial=0;by('new-sale-income-items').replaceChildren();for(const [id]of incomeDefinitions)by('new-sale-income-'+id).value='';
  const today=new Date();by('new-sold-date').value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  populateLenders();by('new-inventory-lender').value='';by('new-interest-basis').textContent='';showStep(1,{focus:false});
 }
 function start({pending:keepPending=false,mode='purchase'}={}){
  if(!mount())return;cancelClose();
  if(!keepPending)setMode(mode);
  ensureDialog();
  if(!keepPending)reset();else{setPending(true);showStep(3,{focus:false});}
  if(!isSale()){window.SnoteVehicleCostSettings?.renderRegistrationFields({resume:keepPending});
   if(!keepPending)void window.SnoteVehicleCostSettings?.refresh({view:'new',force:true});}
  applyModeControls();
  applyRequired();synchronizeSummary();showStep(keepPending?3:1);root.scrollLeft=0;
 }
 function mount(){
  if(form)return true;root=by('overlay');form=root?.querySelector('form.modal');if(!form)return false;
  root.classList.add('snote-registration-wizard');root.setAttribute('aria-hidden',root.classList.contains('open')?'false':'true');form.classList.add('purchase-registration-modal');form.noValidate=true;form.setAttribute('role','dialog');form.setAttribute('aria-modal','true');form.setAttribute('aria-labelledby','purchase-registration-title');
  const title=form.querySelector('.modal-top h2');title.id='purchase-registration-title';title.textContent='신규 차량 등록';
  const caption=node('p',labels[0],'purchase-registration-caption');caption.id='purchase-registration-caption';title.after(caption);
  const steps=node('ol',null,'purchase-registration-progress');steps.setAttribute('aria-label','차량 등록 단계');
  labels.forEach((label,i)=>{const item=node('li');item.dataset.stepIndicator=String(i+1);item.append(node('span',String(i+1),'purchase-registration-step-number'),node('span',label));progress.push(item);steps.append(item);});form.querySelector('.modal-top').after(steps);
  body=form.querySelector('.formgrid');body.classList.add('purchase-registration-body');
  panels=labels.map((label,i)=>{const panel=node('section',null,'purchase-registration-step');panel.id='purchase-registration-step-'+(i+1);panel.dataset.registrationStep=String(i+1);panel.setAttribute('aria-label',label);panel.hidden=i!==0;return panel;});
  const vehicle=node('div',null,'purchase-registration-vehicle-grid');panels[0].append(vehicle);
  const catalog=body.querySelector('.catalog-fields');if(catalog)vehicle.append(catalog);
  const raw=by('manual-model-wrapper');if(raw)vehicle.append(raw);
  for(const id of ['new-plate','new-vin','new-year','new-color','new-km','new-purchase-date']){const item=by(id)?.closest('.formitem');if(item)vehicle.append(item);}
  const hidden=by('new-grade-custom-wrapper');if(hidden)panels[0].append(hidden);
  const preview=by('new-visual-preview');if(preview)panels[0].append(preview);
  const prices=node('div',null,'purchase-registration-prices');for(const id of ['new-buy','new-sell']){const item=by(id)?.closest('.formitem');if(item)prices.append(item);}panels[1].append(prices);
  const soldDate=node('div',null,'formitem sale-registration-date');soldDate.dataset.saleRegistrationOnly='';soldDate.hidden=true;
  const soldLabel=node('label','판매 완료일 *');soldLabel.htmlFor='new-sold-date';const soldInput=node('input');soldInput.type='date';soldInput.id='new-sold-date';soldInput.disabled=true;soldInput.addEventListener('click',()=>{try{if(typeof openDateInputCalendar==='function')openDateInputCalendar(soldInput);}catch{}});soldDate.append(soldLabel,soldInput);prices.append(soldDate);
  const subtitle=body.querySelector('.add-subtitle');if(subtitle){subtitle.textContent='';subtitle.append(node('span','매입 부대비용'));const settings=node('button');settings.type='button';settings.id='snote-new-cost-settings-trigger';settings.hidden=true;settings.setAttribute('aria-label','비용 항목 설정');settings.dataset.tooltip='비용 항목 설정';settings.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.6 2.4-2 .9-2.2-.6L2.9 9l1.7 1.7v2.6L2.9 15l1.8 3.3 2.2-.6 2 .9.6 2.4h5l.6-2.4 2-.9 2.2.6 1.8-3.3-1.7-1.7v-2.6L21.1 9l-1.8-3.3-2.2.6-2-.9-.6-2.4z"/><circle cx="12" cy="12" r="3"/></svg>';subtitle.append(settings);panels[1].append(subtitle);}
  const costs=body.querySelector('.cost-fieldgrid');if(costs)panels[1].append(costs);
  const repair=body.querySelector('.repair-group');if(repair){const add=repair.querySelector('.repair-top .section-button');if(add){add.id='new-repair-add';add.classList.add('snote-registration-cost-icon','is-add');add.setAttribute('aria-label','추가비용 추가');add.dataset.tooltip='추가비용 추가';add.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';}panels[1].append(repair);}
  const income=node('section',null,'sale-registration-income');income.dataset.saleRegistrationOnly='';income.hidden=true;const incomeHead=node('div',null,'sale-registration-income-heading');incomeHead.append(node('h3','수익 (+)'));const incomeAdd=node('button','＋','sale-registration-income-add');incomeAdd.type='button';incomeAdd.id='new-sale-income-add';incomeAdd.setAttribute('aria-label','추가수익 추가');incomeAdd.addEventListener('click',addIncomeRow);incomeHead.append(incomeAdd);income.append(incomeHead);
  const fixedIncome=node('div',null,'sale-registration-income-fixed');for(const [id,label]of incomeDefinitions){const field=financeField(label,'new-sale-income-'+id);field.querySelector('input').disabled=true;fixedIncome.append(field);}income.append(fixedIncome);const customIncome=node('div',null,'sale-registration-income-items');customIncome.id='new-sale-income-items';income.append(customIncome);const incomeTotal=node('p',null,'sale-registration-income-total-live');incomeTotal.append(node('span','수익 합계'));const incomeTotalValue=node('strong','0원');incomeTotalValue.id='sale-registration-income-total-live';incomeTotal.append(incomeTotalValue);income.append(incomeTotal);panels[1].append(income);
  const finance=node('div',null,'purchase-registration-finance-grid');
  const prestock=node('label',null,'purchase-registration-prestock');prestock.htmlFor='new-prestock';const toggle=node('input');toggle.type='checkbox';toggle.id='new-prestock';toggle.setAttribute('role','switch');prestock.append(node('span','선재고 차량'),toggle);finance.append(prestock);
  finance.append(financeField('재고금융사','new-inventory-lender','select'),financeField('재고금액','new-inventory-loan'),financeField('재고 시작일','new-inventory-started-at','date'));
  const interest=financeField('재고이자','new-inventory-interest');interest.classList.add('purchase-registration-interest');const interestInput=interest.querySelector('input');interestInput.readOnly=true;interestInput.placeholder='—';const basis=node('small',null,'purchase-registration-interest-basis');basis.id='new-interest-basis';interest.append(basis);finance.append(interest);panels[2].append(finance,node('h3','등록 요약','purchase-registration-summary-title'));
  const summary=by('add-cost-summary');if(summary)panels[2].append(summary);
  const settlement=node('section',null,'sale-registration-settlement');settlement.id='sale-registration-settlement';settlement.dataset.saleRegistrationOnly='';settlement.hidden=true;
  const carPrice=node('div',null,'sale-registration-car-price');carPrice.append(node('span','차대금 · 판매가'));const carPriceValue=node('strong','0원');carPriceValue.id='sale-registration-car-price';carPrice.append(carPriceValue);settlement.append(carPrice);
  const columns=node('div',null,'sale-registration-summary-columns');for(const [kind,label]of [['expense','비용 (−)'],['income','수익 (+)']]){const column=node('section',null,'sale-registration-summary-column is-'+kind);column.append(node('h3',label));const list=node('div',null,'sale-registration-summary-list');list.id='sale-registration-'+kind+'-list';column.append(list);const total=node('div',null,'sale-registration-summary-total');total.append(node('span',kind==='expense'?'비용 합계':'수익 합계'));const amount=node('strong','0원');amount.id='sale-registration-'+kind+'-total';total.append(amount);column.append(total);columns.append(column);}settlement.append(columns);
  const net=node('div',null,'sale-registration-summary-net');net.append(node('div','합산 정산'));const netValue=node('strong','0원');netValue.id='sale-registration-net';netValue.setAttribute('aria-live','polite');net.append(netValue);settlement.append(net,node('p','차대금 − 매입가 − 추가비용 + 수익','sale-registration-summary-formula'));panels[2].append(settlement);
  for(const unused of [...body.querySelectorAll('.model-data-note,.cost-policy')])unused.remove();body.replaceChildren(...panels);
  form.querySelector('.formtip')?.remove();
  for(const [id,label]of Object.entries({'new-generation':'등급·세부모델 (선택)','new-grade':'트림 (선택)','new-plate':'차량번호 (선택)','new-year':'연식 (선택)','new-buy':'매입가 *','new-sell':'판매예정가'})){const el=form.querySelector('label[for="'+id+'"]');if(el)el.textContent=label;}
  if(by('new-vin'))by('new-vin').placeholder='차대번호 입력';
  message=node('p',null,'purchase-registration-message');message.id='purchase-registration-message';message.setAttribute('role','alert');message.tabIndex=-1;message.hidden=true;body.after(message);
  const footer=form.querySelector('.modal-actions');complete=footer.querySelector('[type="submit"]');complete.id='purchase-registration-complete';complete.textContent='완료';
  counter=node('span','1 / 3','purchase-registration-counter');counter.setAttribute('aria-live','polite');previous=node('button','이전','btn-ghost');previous.id='purchase-registration-previous';previous.type='button';previous.hidden=true;previous.onclick=()=>{if(!saving&&!pending){clearMessage();showStep(step-1);}};
  next=node('button','다음','btn-primary');next.id='purchase-registration-next';next.type='button';next.onclick=()=>{if(!saving&&!pending&&validateStep(step))showStep(step+1);};
  const actions=node('div',null,'purchase-registration-actions');actions.append(previous,next,complete);footer.replaceChildren(counter,actions);
  form.addEventListener('submit',event=>{if(step<3){event.preventDefault();event.stopImmediatePropagation();if(!saving&&!pending&&validateStep(step))showStep(step+1);}},true);
  form.addEventListener('input',()=>{if(!saving&&!pending){clearMessage();applyRequired();synchronizeSummary();}});
  form.addEventListener('change',()=>{if(!saving&&!pending){clearMessage();applyRequired();synchronizeSummary();}});
  root.addEventListener('keydown',event=>{if(window.SnoteMessages?.active()||event.key!=='Tab'||!root.classList.contains('open'))return;const controls=visibleControls();if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}});
  new MutationObserver(applyRequired).observe(form,{subtree:true,attributes:true,attributeFilter:['required']});
  new MutationObserver(applyModeControls).observe(form,{subtree:true,childList:true});
  new MutationObserver(()=>root.setAttribute('aria-hidden',String(!root.classList.contains('open')))).observe(root,{attributes:true,attributeFilter:['class']});
  ensureDialog();setMode('purchase');applyRequired();populateLenders();showStep(1,{focus:false});return true;
 }
 window.SnotePurchaseRegistration=Object.freeze({mount,start,showStep,validateStep,validateAll,setSaving,setPending,reset,cancelClose,close,refreshSummary,reportError,saleDraft,mode:()=>registrationMode,step:()=>step,isSaving:()=>saving,isPending:()=>pending,pendingClose:()=>closeJob?.promise||null});
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 addEventListener('pagehide',cancelClose);
})();
