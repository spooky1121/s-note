/* Shared message popups. Decisions: true=accept, false=user decline, null=lifecycle/stale abort. */
(()=>{
 'use strict';
 if(window.SnoteMessages)return;
 const own=window,doc=document;
 function installValidation(api){
  let pending=false;
  doc.addEventListener('invalid',event=>{
   const field=event.target;if(!field?.validity||!field.willValidate)return;
   event.preventDefault();if(pending||api.active())return;pending=true;
   queueMicrotask(()=>{pending=false;if(!field.isConnected||api.active()||field.validity.valid)return;
    const validity=field.validity;
    const text=validity.customError?field.validationMessage:validity.valueMissing?'필수 항목을 입력해 주세요.':validity.rangeUnderflow||validity.rangeOverflow?'입력값의 허용 범위를 확인해 주세요.':'입력한 값의 형식을 확인해 주세요.';
    api.notify(text,{tone:'error',key:'form-validation',isCurrent:()=>field.isConnected&&!field.validity.valid&&field.getClientRects().length>0,returnFocus:()=>{field.scrollIntoView?.({block:'center'});return field;}});
   });
  },true);
 }
 let parentApi=null;
 try{if(parent!==own&&parent.location.origin===location.origin)parentApi=parent.SnoteMessages;}catch{}
 if(parentApi?._request){
  const api=Object.freeze({confirm:(text,options)=>parentApi._request('confirm',text,options,own),alert:(text,options)=>parentApi._request('alert',text,options,own),notify:(text,options)=>{void parentApi._request('notify',text,options,own);},active:()=>parentApi.active(),clear:()=>parentApi._clearOwner(own),dismiss:key=>parentApi._dismissOwner(own,key),_request:(kind,text,options,owner)=>parentApi._request(kind,text,options,owner),_clearOwner:owner=>parentApi._clearOwner(owner),_dismissOwner:(owner,key)=>parentApi._dismissOwner(owner,key)});
  own.SnoteMessages=api;own.snoteConfirm=api.confirm;own.snoteAlert=api.alert;own.snoteNotify=api.notify;
  installValidation(api);own.addEventListener('pagehide',api.clear);return;
 }
 let dialog,title,copy,accept,cancel,icon,active=null,queue=[],serial=0,timer=null,scopeTimer=null,closing=false;
 const textOf=value=>String(value??'').trim();
 function snapshot(){try{return own.snoteMessageContext?.()??{page:location.pathname};}catch{return null;}}
 function same(a,b){if(a===b)return true;if(!a||!b)return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>a[key]===b[key]);}
 function current(item){try{return !item.owner.closed&&same(item.scope,snapshot())&&(!item.options.isCurrent||item.options.isCurrent()===true);}catch{return false;}}
 function focusTarget(item){if(item.options.returnFocus===false)return null;let target;try{target=typeof item.options.returnFocus==='function'?item.options.returnFocus():item.options.returnFocus;}catch{}return target?.isConnected?target:item.focus?.isConnected?item.focus:null;}
 function restore(item){const target=focusTarget(item);if(target&&!target.closest?.('[hidden],[inert]'))try{target.focus({preventScroll:true});}catch{}}
 function stopTimer(){clearTimeout(timer);timer=null;}
 function finish(value=false,{restoreFocus=true,aborted=false}={}){
  const item=active;if(!item||closing)return;closing=true;active=null;stopTimer();
  if(dialog?.open)dialog.close();if(copy)copy.textContent='';if(title)title.textContent='';
  const valid=current(item);item.resolve(aborted||!valid?null:value===true);closing=false;
  if(restoreFocus&&valid&&!aborted)restore(item);
  queueMicrotask(next);
 }
 function clearOwner(owner){
  const removed=queue.filter(item=>!owner||item.owner===owner);queue=queue.filter(item=>owner&&item.owner!==owner);for(const item of removed)item.resolve(null);
  if(active&&(!owner||active.owner===owner))finish(false,{restoreFocus:false,aborted:true});
 }
 function dismissOwner(owner,key){
  const matches=item=>(!owner||item.owner===owner)&&item.kind==='notify'&&(key===undefined||item.options.key===key);
  const removed=queue.filter(matches);queue=queue.filter(item=>!matches(item));for(const item of removed)item.resolve(null);
  if(active&&matches(active))finish(false);
 }
 function mount(){
  if(dialog)return true;if(!doc.body)return false;
  dialog=doc.createElement('dialog');dialog.id='snote-message-dialog';dialog.className='snote-popup-native';dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','snote-message-title');dialog.setAttribute('aria-describedby','snote-message-copy');
  dialog.innerHTML='<button type="button" class="snote-popup-close" aria-label="메시지 닫기" data-message-close>×</button><div class="snote-message-body"><div class="snote-message-icon" aria-hidden="true"></div><h2 id="snote-message-title"></h2><p id="snote-message-copy"></p><div class="snote-message-actions"><button type="button" data-message-cancel>취소</button><button type="button" data-message-accept>확인</button></div></div>';
  doc.body.append(dialog);title=dialog.querySelector('h2');copy=dialog.querySelector('p');icon=dialog.querySelector('.snote-message-icon');accept=dialog.querySelector('[data-message-accept]');cancel=dialog.querySelector('[data-message-cancel]');
  accept.addEventListener('click',()=>finish(true));cancel.addEventListener('click',()=>finish(false));dialog.querySelector('[data-message-close]').addEventListener('click',()=>finish(false));
  dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopImmediatePropagation();finish(false);});
  dialog.addEventListener('close',()=>{if(active&&!closing&&!dialog.open)finish(false,{aborted:true});});
  dialog.addEventListener('click',event=>{if(event.target===dialog&&active?.kind==='notify'){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)finish(false);}});
  return true;
 }
 const glyph=tone=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>'+(tone==='success'?'<path d="m8 12 2.6 2.6L16 9"/>':tone==='error'?'<path d="M12 7v6m0 3h.01"/>':'<path d="M12 11v6m0-10h.01"/>')+'</svg>';
 function paint(item){
  dialog.dataset.messageId=String(item.id);dialog.dataset.messageKind=item.kind;dialog.dataset.tone=item.options.tone||'info';dialog.dataset.messageKey=item.options.key||'';
  title.textContent=textOf(item.options.title)||(item.kind==='confirm'?'확인':item.options.tone==='error'?'확인해 주세요':item.options.tone==='success'?'완료':'알림');
  for(const button of[accept,cancel]){for(const attr of['aria-label','data-tooltip','data-snote-icon-help','data-snote-icon-title','aria-describedby'])button.removeAttribute(attr);button.classList.remove('snote-save-control','snote-print-control','snote-document-control','snote-action-icon-only','snote-icon-interactive');}
  copy.textContent=item.text;icon.innerHTML=glyph(item.options.tone);cancel.hidden=item.kind!=='confirm';cancel.textContent=item.options.cancelText||'취소';accept.textContent=item.options.acceptText||item.options.confirmText||'확인';accept.dataset.danger=String(item.options.danger===true);
 }
 function arm(item){stopTimer();const duration=Number(item.options.duration??(item.kind==='notify'&&item.options.tone!=='error'?3000:0));if(item.kind==='notify'&&Number.isFinite(duration)&&duration>0)timer=setTimeout(()=>{if(active===item)finish(false);},Math.max(300,duration));}
 function next(){
  if(active)return;if(!mount()){doc.addEventListener('DOMContentLoaded',next,{once:true});return;}
  while(queue.length){const item=queue.shift();if(!current(item)){item.resolve(null);continue;}active=item;paint(item);try{dialog.showModal();}catch{active=null;item.resolve(null);continue;}
   (item.kind==='confirm'&&item.options.danger?cancel:accept).focus({preventScroll:true});arm(item);
   own.dispatchEvent(new CustomEvent('snote:message-open',{detail:{id:item.id,kind:item.kind,text:item.text,key:item.options.key||'',tone:item.options.tone||'info'}}));break;
  }
 }
 function request(kind,value,options={},owner=own){
  const text=textOf(value);if(!text)return Promise.resolve(null);options=options&&typeof options==='object'?options:{};
  const item={id:++serial,kind,text,options:{...options},owner,scope:snapshot(),focus:owner.document.activeElement,resolve:null};if(!current(item))return Promise.resolve(null);
  const duplicate=[active,...queue].find(other=>other&&other.owner===owner&&other.kind===kind&&same(other.scope,item.scope)&&(options.key?other.options.key===options.key:other.text===text));
  if(duplicate){
   if(kind==='confirm')return Promise.resolve(null);
   if(kind==='notify'){duplicate.text=text;duplicate.options={...options};if(duplicate===active){paint(duplicate);arm(duplicate);}return Promise.resolve(null);}
  }
  const task=new Promise(resolve=>item.resolve=resolve);
  // An explicit decision must not wait behind a transient progress notice.
  if(kind!=='notify'&&active?.kind==='notify'&&Number(active.options.duration??(active.options.tone==='error'?0:3000))>0)finish(false,{restoreFocus:false});
  if(kind==='confirm')queue.unshift(item);else queue.push(item);next();return task;
 }
 const api=Object.freeze({confirm:(text,options)=>request('confirm',text,options),alert:(text,options)=>request('alert',text,options),notify:(text,options)=>{void request('notify',text,options);},active:()=>!!active,clear:()=>clearOwner(),dismiss:key=>dismissOwner(null,key),_request:request,_clearOwner:clearOwner,_dismissOwner:dismissOwner});
 own.SnoteMessages=api;own.snoteConfirm=api.confirm;own.snoteAlert=api.alert;own.snoteNotify=api.notify;
 installValidation(api);
 // Keep keystrokes inside the topmost message rather than closing its parent popup.
 doc.addEventListener('keydown',event=>{
  if(!active||!dialog?.open)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);return;}
  if(event.key==='Tab'){const buttons=[...dialog.querySelectorAll('button')].filter(button=>!button.hidden&&!button.disabled);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}event.stopImmediatePropagation();}
 },true);
 function prune(){for(const item of [...queue])if(!current(item)){queue=queue.filter(other=>other!==item);item.resolve(null);}if(active&&!current(active))finish(false,{restoreFocus:false,aborted:true});}
 function watch(){clearInterval(scopeTimer);scopeTimer=setInterval(prune,100);}
 watch();own.addEventListener('pageshow',watch);own.addEventListener('snote:route-changed',prune);own.addEventListener('snote:sales-data-changed',prune);
 own.addEventListener('pagehide',()=>{clearOwner();clearInterval(scopeTimer);});
 own.addEventListener('beforeprint',()=>{dismissOwner(null);});
 own.addEventListener('snote:auth-reset',()=>clearOwner());
})();
