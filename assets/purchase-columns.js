/* Personal purchase-list visibility only. Vehicle data and row order stay untouched. */
(()=>{'use strict';
 if(window.SnotePurchaseColumns)return;
 const screen=document.getElementById('list-screen');if(!screen)return;
 const PREFIX='snote:purchase-columns:v1:',fixed=new Set(['model','plate']);
 const definitions=[['model','차명'],['owner','담당 딜러'],['color','색상'],['plate','차량번호'],['year','연식'],['mileage','주행거리'],['purchaseDate','매입일자'],['buyPrice','매입가'],['expectedSellPrice','판매예정가'],['expectedProfit','예상수익'],['totalInvestment','총투입원가'],['additionalCosts','부대비용합계'],['inventoryLoan','재고대출금'],['inventoryInterest','재고이자'],['vin','차대번호'],['finance','재고금융'],['lender','재고금융사'],['documents','서류'],['quote','견적서'],['advertising','엔카광고'],['status','상태'],['age','경과일자']];
 const labels=new Map(definitions),optional=new Set(definitions.map(([id])=>id).filter(id=>!fixed.has(id)));
 const actor=()=>typeof currentUser==='undefined'?null:currentUser,page=()=>typeof route==='string'?route:'';
 const activeRoute=()=>page()==='buy';
 let state=null,applied='',queued=false,opened=null,trigger=null,available=[];
 const dialog=document.createElement('dialog');dialog.id='snote-purchase-columns';dialog.className='snote-popup-native';dialog.setAttribute('aria-labelledby','snote-purchase-columns-title');
 dialog.innerHTML='<div class="snote-popup-native-body"><header><h2 id="snote-purchase-columns-title">매입 목록 표시 설정</h2><p>목록과 카드에서 보일 항목을 선택하세요.</p></header><div class="snote-purchase-column-options" role="group" aria-label="표시할 항목"></div><p class="snote-purchase-column-note">차명과 차량번호는 항상 표시됩니다.</p><p class="snote-purchase-column-status" role="status" aria-live="polite"></p></div><button type="button" class="snote-popup-close" aria-label="목록 표시 설정 닫기">×</button>';
 document.body.append(dialog);const options=dialog.querySelector('.snote-purchase-column-options'),status=dialog.querySelector('[role=status]');
 function scope(){
  const who=actor();if(!who||!['dealer','admin','accountant'].includes(who.role)||typeof who.username!=='string'||!who.username)return null;
  let context=null;try{context=window.snoteCompanyPurchaseBridge?.context?.()||null;}catch{return null;}
  if(context){if(!context.ready||context.ownerAlias!==who.username||context.role!==who.role||typeof context.companyId!=='string'||!context.companyId||typeof context.userId!=='string'||!context.userId||window.snoteCompanyPurchaseBridge?.current?.(context)!==true)return null;return {key:PREFIX+encodeURIComponent(JSON.stringify([context.companyId,context.userId,context.role])),actor:who,role:who.role};}
  if(who.username.startsWith('cld_')||window.zc86Cloud?.ready)return null;
  return {key:PREFIX+encodeURIComponent(JSON.stringify([String(who.company||'local'),'local:'+who.username,who.role])),actor:who,role:who.role};
 }
 const added=['expectedProfit','totalInvestment','additionalCosts','inventoryInterest','vin','quote'];
 const defaults=role=>[...added,...(role==='accountant'?[]:['inventoryLoan'])];
 function read(key,role){try{const value=JSON.parse(localStorage.getItem(key));if(![1,2].includes(value?.schemaVersion)||!Array.isArray(value.hidden))return new Set(defaults(role));return new Set([...value.hidden.filter(id=>typeof id==='string'&&optional.has(id)),...(value.schemaVersion===1?defaults(role):[])]);}catch{return new Set(defaults(role));}}
 function columns(role){
  const actual=[...screen.querySelectorAll('#list-table thead th[data-purchase-column]')].map(node=>node.dataset.purchaseColumn).filter(id=>labels.has(id));
  if(actual.length)return [...new Set(actual)];
  const ids=role==='accountant'?['model','owner','color','plate','year','mileage','purchaseDate','buyPrice','expectedProfit','totalInvestment','additionalCosts','inventoryLoan','inventoryInterest','vin','finance','lender','documents','advertising','status','age']:['model','color','plate','year','mileage','purchaseDate','buyPrice','expectedSellPrice','expectedProfit','totalInvestment','additionalCosts','inventoryLoan','inventoryInterest','vin','finance','lender','documents','quote','advertising','status','age'];
  return ids;
 }
 const set=(name,value)=>{if(screen.dataset[name]!==value)screen.dataset[name]=value;};
 function hidden(id){return !!state&&activeRoute()&&screen.dataset.purchaseColumnsActive==='true'&&optional.has(id)&&state.hidden.has(id);}
 function close({restoreFocus=true}={}){if(!dialog.open)return;dialog.close();opened=null;trigger?.setAttribute('aria-expanded','false');window.SnoteMobilePopupHistory?.refresh();if(restoreFocus&&trigger?.isConnected&&!trigger.hidden&&scope()?.key===state?.key)trigger.focus({preventScroll:true});}
 function mount(){
  const toolbar=document.getElementById('snote-vehicle-view-toolbar');if(!toolbar)return;
  if(!trigger){trigger=document.createElement('button');trigger.id='snote-purchase-columns-trigger';trigger.type='button';trigger.className='snote-list-action snote-purchase-columns-trigger';trigger.setAttribute('aria-label','매입 목록 표시 설정');trigger.dataset.tooltip='목록 표시 설정';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',dialog.id);trigger.setAttribute('aria-expanded','false');trigger.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.7 3-.6 2.2-2 .9-2-.6-2.2 3.8 1.5 1.7v2l-1.5 1.7 2.2 3.8 2-.6 2 .9.6 2.2h4.5l.6-2.2 2-.9 2 .6 2.2-3.8-1.5-1.7v-2l1.5-1.7-2.2-3.8-2 .6-2-.9-.6-2.2Z"/><circle cx="12" cy="12" r="3"/></svg>';trigger.addEventListener('click',open);}
  if(trigger.parentElement!==toolbar||toolbar.lastElementChild!==trigger)toolbar.append(trigger);
 }
 function paintOptions(){
  if(!dialog.open)return;const fingerprint=available.join('|');
  if(options.dataset.columns!==fingerprint){const ordered=['model','plate',...available.filter(id=>!fixed.has(id))],nodes=ordered.map(id=>{const row=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');row.className='snote-purchase-column-option';input.type='checkbox';input.dataset.purchaseColumnChoice=id;input.disabled=fixed.has(id);text.textContent=labels.get(id);if(fixed.has(id))row.classList.add('is-fixed');row.append(input,text);return row;});options.replaceChildren(...nodes);options.dataset.columns=fingerprint;}
  for(const input of options.querySelectorAll('input'))input.checked=fixed.has(input.dataset.purchaseColumnChoice)||!state.hidden.has(input.dataset.purchaseColumnChoice);
 }
 function refresh(){
  queued=false;mount();const next=scope(),enabled=activeRoute()&&!!next;
  if(opened&&(!enabled||opened.key!==next.key||opened.actor!==next.actor))close({restoreFocus:false});
  if(!next){state=null;}else if(state?.key!==next.key){state={...next,hidden:read(next.key,next.role)};}else state.actor=next.actor;
  available=enabled?columns(next.role):[];
  if(trigger){if(trigger.hidden===enabled)trigger.hidden=!enabled;if(trigger.disabled===enabled)trigger.disabled=!enabled;}
  const ids=state?[...state.hidden].sort():[],signature=JSON.stringify([enabled,state?.key||'',available,ids]);
  if(signature!==applied){applied=signature;set('purchaseColumnsActive',enabled?'true':'false');set('purchaseHiddenColumns',enabled?ids.join(' '):'');set('purchaseHiddenExisting',String(enabled&&ids.some(id=>!added.includes(id)&&(id!=='inventoryLoan'||next.role==='accountant'))));set('purchaseNoMeta',String(enabled&&['year','mileage','purchaseDate'].every(id=>state.hidden.has(id))));set('purchaseNoDealerFooter',String(enabled&&['status','advertising','age','quote'].every(id=>state.hidden.has(id))));set('purchaseNoAccountantFooter',String(enabled&&['status','advertising'].every(id=>state.hidden.has(id))));set('purchaseNoAccountantFields',String(enabled&&['year','mileage','purchaseDate','buyPrice','inventoryLoan','finance','lender','documents','age',...added.filter(id=>id!=='quote')].every(id=>state.hidden.has(id))));set('purchaseNoExtraFields',String(enabled&&[...added.filter(id=>id!=='quote'),'inventoryLoan'].every(id=>state.hidden.has(id))));window.SnoteListSort?.refresh();}
  paintOptions();
 }
 function queue(){if(!queued){queued=true;queueMicrotask(refresh);}}
 function open(){refresh();const now=scope();if(!activeRoute()||!state||now?.key!==state.key)return false;if(dialog.open)return true;opened={key:now.key,actor:now.actor};status.textContent='선택한 항목이 바로 적용됩니다.';dialog.showModal();trigger.setAttribute('aria-expanded','true');paintOptions();dialog.querySelector('input:not(:disabled)')?.focus({preventScroll:true});window.SnoteMobilePopupHistory?.refresh();return true;}
 options.addEventListener('change',event=>{
  const input=event.target,id=input.dataset?.purchaseColumnChoice;if(!id)return;const now=scope();if(!opened||!state||opened.key!==now?.key||opened.actor!==now?.actor||state.key!==now.key){close({restoreFocus:false});refresh();return;}
  if(fixed.has(id)||!optional.has(id)){input.checked=true;return;}
  if(input.checked)state.hidden.delete(id);else state.hidden.add(id);
  status.textContent='선택한 항목이 바로 적용됩니다.';
  try{localStorage.setItem(state.key,JSON.stringify({schemaVersion:2,hidden:[...state.hidden].sort()}));}catch{const key=state.key,who=now.actor;window.snoteNotify?.('화면에는 적용했지만 표시 설정을 기억하지 못했습니다. 다시 시도해 주세요.',{tone:'error',key:'purchase-columns-storage',isCurrent:()=>{const current=scope();return dialog.open&&opened?.key===key&&opened.actor===who&&current?.key===key&&current.actor===who;},returnFocus:()=>input});}
  refresh();
 });
 dialog.querySelector('.snote-popup-close').addEventListener('click',()=>close());dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}});
 window.addEventListener('snote:route-changed',()=>{close({restoreFocus:false});refresh();});window.addEventListener('snote:auth-reset',()=>{close({restoreFocus:false});state=null;applied='';refresh();});window.addEventListener('storage',event=>{if(event.key===state?.key){state.hidden=read(state.key,state.role);applied='';refresh();}});window.addEventListener('pagehide',()=>close({restoreFocus:false}));
 new MutationObserver(queue).observe(screen,{childList:true,subtree:true});setInterval(refresh,250);
 window.SnotePurchaseColumns=Object.freeze({open,close,hidden,refresh});refresh();
})();
