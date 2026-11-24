/* Mobile Back dismisses one popup through its existing close/dirty-save path. */
(()=>{
 'use strict';
 if(window.SnoteMobilePopupHistory)return;
 // Embedded documents share the parent's session history. The parent observes
 // their dialogs, so they must never install a second history controller.
 try{if(parent!==window&&parent.location.origin===location.origin){parent.SnoteMobilePopupHistory?.refresh();return;}}catch{}
 const KEY='snoteMobilePopup',INDEX='snoteMobileHistoryPosition',media=matchMedia('(max-width: 760px)'),retired=new Map(),documents=new Map(),orders=new WeakMap();
 const popoverSupported=typeof HTMLElement.prototype.showPopover==='function',layerSelector='dialog,#snote-dropdown-menu'+(popoverSupported?',:popover-open':''),openLayerSelector='dialog[open],#snote-dropdown-menu'+(popoverSupported?',:popover-open':'');
 let serial=0,token=null,depth=0,stack=[],moving=null,queued=false,resetting=false,last=entry();
 const handled=new WeakMap(),ignoredHashes=new Set();
 function clean(state){const next=state&&typeof state==='object'?{...state}:{};delete next[KEY];return next;}
 function entry(){return {state:history.state,url:location.href,index:window.navigation?.currentEntry?.index??history.state?.[INDEX]};}
 function marker(state=history.state){const m=state?.[KEY];return m&&m.version===1&&typeof m.token==='string'&&Number.isInteger(m.depth)&&m.depth>0?m:null;}
 function coordinate(state){const m=marker(state),position=state?.snoteNavigation?.position;return (Number.isInteger(position)?position:0)+(m?.depth||0);}
 function difference(a,b){return Number.isInteger(a.index)&&Number.isInteger(b.index)?a.index-b.index:coordinate(a.state)-coordinate(b.state);}
 function visible(node){try{if(!node.isConnected||node.hidden||node.closest('[hidden]'))return false;const style=node.ownerDocument.defaultView.getComputedStyle(node);return style.display!=='none'&&style.visibility!=='hidden'&&node.getClientRects().length>0;}catch{return false;}}
 function frameVisible(doc){try{const frame=doc.defaultView.frameElement;return !frame||visible(frame)&&frameVisible(frame.ownerDocument);}catch{return false;}}
 function rank(node){
  let value=0;for(let p=node;p;p=p.parentElement){if(p.matches(openLayerSelector)){value=1e12+(orders.get(p)||0);break;}const z=Number(p.ownerDocument.defaultView.getComputedStyle(p).zIndex);if(Number.isFinite(z))value=Math.max(value,z);}
  const frame=node.ownerDocument.defaultView.frameElement;
  return frame?rank(frame)+(node.matches('dialog[open]')?1:Math.min(value,999999)/1e6)/1000:value;
 }
 function collect(){
  const found=[];
  for(const doc of documents.keys()){
   if(!frameVisible(doc))continue;
   for(const node of doc.querySelectorAll('dialog[open],.overlay,.snote-popup-overlay,[role="dialog"],[role="alertdialog"],#snote-profile-menu,#ps-action-menu,.color-picker.expanded .color-menu')){
    if(!visible(node)||node.id==='zc-cloud-gate'||node.closest('#mobile-drawer[aria-hidden="true"]'))continue;
    if(node.matches('dialog')&&!node.open)continue;
    if(!node.matches(layerSelector)&&node.closest('dialog'))continue;
    const menu=node.matches('#snote-profile-menu,#ps-action-menu,.color-menu');
    const host=node.matches(layerSelector)||menu?node:node.closest('.overlay,.snote-popup-overlay')||node;
    if(found.includes(host)||!visible(host))continue;
    // A dialog's labelled content and its overlay are one layer.
    if(!menu&&!host.matches(layerSelector)&&found.some(other=>!other.matches(layerSelector)&&other.contains(host)))continue;
    for(let i=found.length-1;i>=0;i--)if(!menu&&!found[i].matches(layerSelector)&&!found[i].matches('#snote-profile-menu,#ps-action-menu,.color-menu')&&host.contains(found[i]))found.splice(i,1);
    if(!orders.has(host))orders.set(host,++serial);found.push(host);
   }
  }
  return found.sort((a,b)=>rank(a)-rank(b)||orders.get(a)-orders.get(b));
 }
 function remember(){last=entry();}
 function finishTravel(job){
  if(moving!==job)return;
  clearTimeout(job.timer);moving=null;depth=marker()?.token===token?marker().depth:0;remember();job.after?.();job.resolve(true);refresh();
 }
 function watchTravel(job){
  job.timer=setTimeout(()=>{
   if(moving!==job)return;
   const now=entry();
   if(Number.isInteger(job.targetIndex)&&now.index===job.targetIndex){finishTravel(job);return;}
   // Browsers can cancel a queued history.go when another Back is already
   // queued, without emitting another popstate. Retry the same destination,
   // never complete a close against the intervening page.
   if(Number.isInteger(job.targetIndex))history.go(Number.isInteger(now.index)?job.targetIndex-now.index:1);
   watchTravel(job);
  },32);
 }
 function travel(delta,after=null){
  if(!delta){after?.();refresh();return;}
  const current=entry(),job={after,targetIndex:Number.isInteger(current.index)?current.index+delta:null,timer:null,promise:null,resolve:null};job.promise=new Promise(resolve=>job.resolve=resolve);moving=job;history.go(delta);watchTravel(job);
 }
 function retire(following=false){if(token)retired.set(token,{following});token=null;depth=0;}
 function push(){
  if(!token)token=crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  // Standalone flows may replace history.state with their own wizard fields.
  // Stamp their current base before opening a popup, preserving every field.
  if(!Number.isInteger(history.state?.[INDEX]))history.replaceState({...clean(history.state),[INDEX]:0},'',location.href);
  ++depth;history.pushState({...clean(history.state),[INDEX]:(history.state?.[INDEX]||0)+1,[KEY]:{version:1,token,depth}},'',location.href);remember();
 }
 function reconcile(){
  queued=false;observeFrames();const found=collect();
  // A fresh opening receives a fresh ordering, including reused native dialogs.
  for(const old of stack)if(!found.includes(old))orders.delete(old);
  stack=found;
  if(moving)return;
  // A router's asynchronous leave guard still owns its original Forward entry.
  // Inserting a sentinel at its temporary destination would truncate that entry
  // before the router can restore a declined traversal.
  if(typeof snote253HistoryPending!=='undefined'&&snote253HistoryPending!==null)return;
  if(!media.matches||resetting){
   const m=marker();if(m&&m.token===token){const remove=m.depth;retire();travel(-remove);return;}
   retire();remember();return;
  }
  const m=marker();
  // A history traversal changes history.state before popstate is delivered.
  // Focus/style observers may run in that gap; only the capture listener may
  // consume it, otherwise a new sentinel could replace the destination first.
  if(token&&marker(last.state)?.token===token&&(!m||m.token!==token||m.depth!==depth))return;
  if(token&&(!m||m.token!==token))depth=0;
  if(!stack.length){if(m&&m.token===token){const remove=m.depth;retire();travel(-remove);return;}retire();remember();return;}
  // Closing drawers remain visible until their authorized animation completes.
  // Wait for its mutation instead of re-adding the Back entry just consumed.
  if(stack.some(node=>node.dataset.snoteDrawerClosing==='1')){remember();return;}
  if(depth>stack.length){const remove=depth-stack.length;travel(-remove);return;}
  while(depth<stack.length)push();
  remember();
 }
 function refresh(){if(queued)return;queued=true;queueMicrotask(reconcile);}
 function observe(doc){
  if(documents.has(doc)||!doc.documentElement)return;
  const observer=new MutationObserver(records=>{for(const record of records)if(record.attributeName==='open'&&record.target.open)orders.set(record.target,++serial);refresh();});observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','class','style','aria-hidden','role','data-snote-drawer-closing']});documents.set(doc,observer);
  doc.addEventListener('close',refresh,true);doc.addEventListener('cancel',refresh,true);
 }
 function observeFrames(){
  observe(document);
  for(const doc of [...documents.keys()]){
   if(doc!==document){let attached=false;try{const frame=doc.defaultView?.frameElement;attached=!!frame?.isConnected&&frame.contentDocument===doc;}catch{}if(!attached){documents.get(doc).disconnect();documents.delete(doc);continue;}}
   for(const frame of doc.querySelectorAll('iframe')){
    if(!frame.__snotePopupHistoryLoad){frame.__snotePopupHistoryLoad=true;frame.addEventListener('load',refresh);}
    try{if(frame.contentDocument)observe(frame.contentDocument);}catch{}
   }
  }
 }
 function closeTop(node){
  if(!node?.isConnected)return;
  const view=node.ownerDocument.defaultView;
  if(view.SnoteSearchFocus?.current===node){view.SnoteSearchFocus.close({focus:true});return;}
  if(node.id==='snote-profile-menu'){view.snoteCloseProfileMenu?.(true);return;}
  if(node.id==='ps-action-menu'){view.closePrestockMenu?.();return;}
  if(node.matches('.color-menu')){view.closeColorPickers?.();return;}
  if(node.id==='snote-message-dialog'&&view.SnoteMessages?.dismissTop){view.SnoteMessages.dismissTop({abort:true});return;}
  if(node.matches('dialog')){
   // Dispatch the native cancellation path: handlers may keep a saving/dirty
   // popup open. Only dialogs without a prevented cancel use the default close.
   if(node.dispatchEvent(new view.Event('cancel',{cancelable:true})))node.close();
   return;
  }
  const button=node.querySelector('.snote-popup-close,.detail-close,.close-dialog,.quote-close,.contract-close,.zc72-close,.zc182-close,.zc71-x,.mobile-drawer-close,button[aria-label*="닫기"],button[aria-label="취소"],button.close,button[onclick*="zc80DismissUnlock"]');
  if(button&&!button.disabled)button.click();
 }
 function pop(event){
  if(handled.has(event))return handled.get(event);
  const previous=last,now=entry(),m=marker(now.state),was=marker(previous.state),delta=difference(previous,now);
  function consume(){handled.set(event,true);event.stopImmediatePropagation();if(previous.url!==now.url)ignoredHashes.add(now.url);}
  if(moving){
   consume();const job=moving;
   // User Back can race an internal cleanup/restore. Complete the operation
   // only at its exact destination; an unrelated popstate cannot authorize
   // closing the popup or leave the route and history at different positions.
   if(Number.isInteger(job.targetIndex)&&now.index!==job.targetIndex){remember();return true;}
   finishTravel(job);return true;
  }
  const found=collect();
  if(media.matches&&!resetting&&found.length){
   consume();stack=found;
   const top=found.at(-1),oneBack=was?.token===token&&((m?.token===token&&m.depth===was.depth-1)||was.depth===1&&!m&&delta>0);
   if(oneBack){depth=m?.depth||0;remember();closeTop(top);refresh();return true;}
   // A history jump or a rapid second Back must restore this page before the
   // existing close handler runs; routers never see the intermediate route.
   travel(delta||1,()=>{if(delta>=0)closeTop(top);});return true;
  }
  if(m){
   consume();remember();
   // Closed popup entries are inert in both directions. A Forward traversal
   // at the end returns to its clean page instead of resurrecting old content.
   const old=retired.get(m.token);
   if(delta<0&&old?.following!==true){travel(-m.depth);return true;}
   history.go(delta<0?1:-1);return true;
  }
  depth=0;remember();handled.set(event,false);return false;
 }
 function handleNavigationEvent(event){
  if(!event)return false;
  if(event.type==='popstate')return pop(event);
  if(event.type==='hashchange'&&(moving||ignoredHashes.has(event.newURL))){ignoredHashes.delete(event.newURL);event.stopImmediatePropagation();return true;}
  return false;
 }
 function navigationState(state){
  const next=clean(state),m=marker();
  const previous=history.state?.snoteNavigation?.position,position=next.snoteNavigation?.position;
  next[INDEX]=(history.state?.[INDEX]||0)+(Number.isInteger(previous)&&Number.isInteger(position)&&previous!==position?1:0);
  if(m){if(token===m.token)retire(true);else retired.set(m.token,{following:true});}
  const job=moving;
  if(job)job.after=null;
  // The app writes immediately after this hook; observe its completed write.
  queueMicrotask(()=>{
   // A real navigation can replace/truncate an internal move's old target.
   // Preserve the newly authorized route, cancel the old popup callback and
   // let any already queued browser traversal return to this new entry.
   if(job&&moving===job)job.targetIndex=entry().index??null;
   remember();refresh();
  });return next;
 }
 function reset(){
  resetting=true;stack=[];retired.clear();ignoredHashes.clear();
  // An old close callback must never operate on a reused popup after sign-out.
  // If its traversal is already queued, return to the entry being replaced by
  // the auth reset and let the normal stale-entry checks handle later Back.
  if(moving){moving.after=null;moving.targetIndex=entry().index??null;}
  for(const doc of documents.keys())if(doc!==document){documents.get(doc).disconnect();documents.delete(doc);}
  refresh();queueMicrotask(()=>{resetting=false;refresh();});
 }
 function prepareRouteChange(){if(!moving)reconcile();return moving?moving.promise:true;}
 window.SnoteMobilePopupHistory=Object.freeze({refresh,navigationState,reset,handleNavigationEvent,prepareRouteChange});
 addEventListener('popstate',handleNavigationEvent,true);addEventListener('hashchange',handleNavigationEvent,true);
 media.addEventListener('change',()=>{if(!media.matches&&moving)moving.after=null;refresh();});addEventListener('snote:auth-reset',reset);addEventListener('pageshow',refresh);
 addEventListener('pagehide',()=>{if(moving){clearTimeout(moving.timer);moving.resolve(false);}moving=null;});
 // A reload has no popup to restore from a previous document's sentinel.
 if(marker()){const old=marker();retired.set(old.token,{following:false});travel(-old.depth);}
 else if(!Number.isInteger(history.state?.[INDEX])){history.replaceState({...clean(history.state),[INDEX]:0},'',location.href);remember();}
 observeFrames();refresh();
})();
