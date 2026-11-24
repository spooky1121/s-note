/* Reveal only the settled workspace. Auth, dialogs and data ownership stay with their controllers. */
(function(root){
 'use strict';
 const document=root?.document;if(!document||root.SnoteRouteTransition)return;
 const QUIET=90,MAX_SETTLE=1000,MAX_ELAPSED=1200,MAX_LATE=15000,FADE_GUARD=600;
 const STATE='data-route-transition',OWN=new Set([STATE,'inert','aria-busy']);
 const PROBES=':scope > *, .panel-head, .snote-purchase-primary-row, .snote-home-kpis, .snote-home-kpi, .snote-scheduler-calendar, .snote-scheduler-sidebar, .snote-settings-home, .snote-settings-sections, .snote-alt-heading, table, tbody > tr:first-child, tbody > tr:last-child, .vehicle-card:first-child, .vehicle-card:last-child, .fin-mobile-card:first-child, .fin-mobile-card:last-child, iframe';
 const now=()=>root.performance?.now?.()??Date.now();
 const frame=callback=>typeof root.requestAnimationFrame==='function'?root.requestAnimationFrame(callback):root.setTimeout(callback,16);
 const stopFrame=handle=>{if(handle==null)return;if(typeof root.cancelAnimationFrame==='function')root.cancelAnimationFrame(handle);else root.clearTimeout(handle);};
 let media=null,active=null,lateWatch=null,sequence=0;try{media=root.matchMedia?.('(prefers-reduced-motion: reduce)')||null;}catch{}
 const current=job=>!!job&&active===job;
 function remember(element,name){return element.hasAttribute(name)?element.getAttribute(name):null;}
 function restore(element,name,value){if(value===null)element.removeAttribute(name);else element.setAttribute(name,value);}
 function visible(element){if(!element?.isConnected||!element.getClientRects().length)return false;const box=element.getBoundingClientRect();return box.width>0&&box.height>0&&!['hidden','collapse'].includes(root.getComputedStyle(element).visibility);}
 function busyNode(element){return visible(element)&&!element.matches('button,input,select,textarea,a,progress,meter,[role="button"],[role="combobox"]')&&(element.getAttribute('aria-busy')==='true'||element.getAttribute('data-state')==='loading'||element.id==='snote-dealer-scheduler'&&element.getAttribute('data-state')==='idle');}
 function busyTargets(element){
  const targets=[...element.querySelectorAll('[aria-busy="true"],[data-state="loading"],#snote-dealer-scheduler[data-state="idle"]')].filter(busyNode).map(node=>({node,id:node.id,monthly:false}));
  const status=element.querySelector('#monthly-frame-status');if(visible(status)&&element.querySelector('#monthly-ledger-frame')?.getAttribute('aria-busy')==='true')targets.push({node:status,id:status.id,monthly:true});
  return targets;
 }
 function stopLate(watch=lateWatch){
  if(!watch||watch!==lateWatch)return;lateWatch=null;watch.observer?.disconnect();root.clearTimeout(watch.timer);
  for(const name of ['pointerdown','keydown','beforeinput','input'])watch.element.removeEventListener(name,watch.interacted,true);
 }
 function armLate(job,targets){
  if(!job.allowLate||!targets.length||lateWatch||typeof root.MutationObserver!=='function')return;
  const watch={element:job.element,page:job.token.page,targets};lateWatch=watch;
  watch.interacted=()=>stopLate(watch);
  const waiting=()=>targets.some(target=>{
   let node=target.node;if(!node.isConnected&&target.id)node=document.getElementById(target.id);
   if(!node||!watch.element.contains(node))return false;
   return target.monthly?visible(node)&&watch.element.querySelector('#monthly-ledger-frame')?.getAttribute('aria-busy')==='true':busyNode(node);
  });
  try{
   watch.timer=root.setTimeout(()=>stopLate(watch),MAX_LATE);
   for(const name of ['pointerdown','keydown','beforeinput','input'])watch.element.addEventListener(name,watch.interacted,true);
   watch.observer=new root.MutationObserver(()=>{
    if(lateWatch!==watch)return;
    try{
     if(document.hidden||!watch.element.isConnected){stopLate(watch);return;}
     if(waiting())return;stopLate(watch);
     // Hide in this mutation microtask, before the completed layout can paint.
     const token=begin({page:watch.page,root:watch.element});if(active?.token===token)active.allowLate=false;settle(token);
    }catch{stopLate(watch);}
   });
   watch.observer.observe(watch.element,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy','data-state','hidden','style','class']});
  }catch{stopLate(watch);}
 }
 function stopWatching(job){
  stopFrame(job.raf);job.raf=null;job.mutations?.disconnect();job.resize?.disconnect();
  job.element.removeEventListener('load',job.changed,true);job.element.removeEventListener('error',job.changed,true);
  root.removeEventListener('resize',job.changed);document.fonts?.removeEventListener?.('loading',job.changed);document.fonts?.removeEventListener?.('loadingdone',job.changed);document.fonts?.removeEventListener?.('loadingerror',job.changed);
 }
 function finish(job){
  if(!current(job))return;active=null;stopWatching(job);root.clearTimeout(job.watchdog);root.clearTimeout(job.fadeTimer);
  job.element.removeEventListener('animationend',job.ended);
  // Preserve a later controller's explicit busy change instead of replacing it.
  if(job.element.getAttribute('aria-busy')==='true')restore(job.element,'aria-busy',job.before.busy);
  if(job.element.hasAttribute('inert'))restore(job.element,'inert',job.before.inert);
  if(['settling','revealing'].includes(job.element.getAttribute(STATE)))restore(job.element,STATE,job.before.state);
 }
 function reveal(job){
  if(!current(job)||job.phase==='revealing')return;root.clearTimeout(job.watchdog);job.watchdog=null;stopWatching(job);job.phase='revealing';
  if(document.hidden||media?.matches){finish(job);return;}
  job.element.setAttribute(STATE,'revealing');
  job.ended=event=>{if(event.target===job.element&&event.animationName==='snoteRouteReveal')finish(job);};
  job.element.addEventListener('animationend',job.ended);
  job.fadeTimer=root.setTimeout(()=>finish(job),FADE_GUARD);
 }
 function geometry(job){
  const values=[root.innerWidth,root.innerHeight],nodes=[job.element,...job.element.querySelectorAll(PROBES)];let count=0;
  for(const node of nodes){if(count>=64)break;if(!node.getClientRects().length)continue;const box=node.getBoundingClientRect();if(!(box.width>0&&box.height>0))continue;count++;for(const number of [box.x,box.y,box.width,box.height])values.push(Math.round(number*4)/4);}
  return values.join(',');
 }
 function unreservedImage(job){
  // Already sized vehicle thumbnails do not make navigation wait for remote images.
  const images=job.element.querySelectorAll('img');
  for(let i=0;i<Math.min(images.length,48);i++){
   const image=images[i];if(image.complete||image.loading==='lazy'||!image.getClientRects().length)continue;
   const box=image.getBoundingClientRect();if(box.bottom<0||box.top>root.innerHeight)continue;
   if(Number(image.getAttribute('width'))>0&&Number(image.getAttribute('height'))>0)continue;
   const style=root.getComputedStyle(image);if(style.aspectRatio&&style.aspectRatio!=='auto')continue;
   if(box.width>0&&box.height>0&&['contain','cover'].includes(style.objectFit))continue;
   return true;
  }
  return false;
 }
 function check(job){
  if(!current(job)||job.phase!=='settling')return;
  try{
   if(document.hidden||!job.element.isConnected){finish(job);return;}
   const stamp=now(),busy=busyTargets(job.element);if(stamp-job.settledAt>=MAX_SETTLE){armLate(job,busy);reveal(job);return;}
   const next=geometry(job);if(next===job.geometry)job.frames++;else{job.geometry=next;job.frames=0;job.changedAt=stamp;}
   if(job.frames>=3&&stamp-job.changedAt>=QUIET&&!busy.length&&document.fonts?.status!=='loading'&&!unreservedImage(job)){reveal(job);return;}
   job.raf=frame(()=>check(job));
  }catch{finish(job);}
 }
 function begin({page='',root:element}={}){
  stopLate();
  if(active)finish(active);
  if(!element||element.nodeType!==1||element.ownerDocument!==document||!element.isConnected||document.hidden)return null;
  const token=Object.freeze({id:++sequence,page:String(page)}),stamp=now();
  const job={token,element,started:stamp,settledAt:stamp,changedAt:stamp,frames:0,geometry:null,phase:'prepared',allowLate:true,raf:null,ended:null,before:{state:remember(element,STATE),busy:remember(element,'aria-busy'),inert:remember(element,'inert')}};
  active=job;
  job.changed=()=>{if(current(job)&&job.phase!=='revealing'){job.changedAt=now();job.frames=0;}};
  try{
   // Install the final release before writing anything that can hide or disable the page.
   job.release=()=>{if(current(job)){try{if(job.phase!=='revealing')armLate(job,busyTargets(job.element));}catch{}finally{finish(job);}}};
   job.watchdog=root.setTimeout(job.release,MAX_ELAPSED);
   element.setAttribute(STATE,'settling');element.setAttribute('inert','');element.setAttribute('aria-busy','true');
   if(typeof root.MutationObserver==='function'){
    job.mutations=new root.MutationObserver(records=>{if(records.some(record=>record.type!=='attributes'||!(record.target===element&&OWN.has(record.attributeName))&&record.oldValue!==record.target.getAttribute(record.attributeName)))job.changed();});
    job.mutations.observe(element,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true});
   }
   if(typeof root.ResizeObserver==='function'){job.resize=new root.ResizeObserver(job.changed);job.resize.observe(element);}
   element.addEventListener('load',job.changed,true);element.addEventListener('error',job.changed,true);root.addEventListener('resize',job.changed);
   for(const name of ['loading','loadingdone','loadingerror'])document.fonts?.addEventListener?.(name,job.changed);
   return token;
  }catch{finish(job);return null;}
 }
 function settle(token){
  const job=active;if(!job||job.token!==token||job.phase!=='prepared')return false;
  try{
   job.phase='settling';job.settledAt=now();job.changed();root.clearTimeout(job.watchdog);job.watchdog=root.setTimeout(job.release,MAX_ELAPSED);
   job.raf=frame(()=>check(job));return true;
  }catch{finish(job);return false;}
 }
 function cancel(){stopLate();if(active)finish(active);}
 root.addEventListener('snote:auth-reset',cancel);root.addEventListener('pagehide',cancel);root.addEventListener('beforeprint',cancel);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
 if(typeof media?.addEventListener==='function')media.addEventListener('change',cancel);else media?.addListener?.(cancel);
 root.SnoteRouteTransition=Object.freeze({begin,settle,cancel,pending:()=>!!active});
})(typeof window==='object'?window:globalThis);
