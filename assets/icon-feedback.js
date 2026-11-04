/* Shared, escaped icon help outside scrolling cards; no action handlers are replaced. */
(()=>{'use strict';
 if(window.snoteIconFeedback)return;window.snoteIconFeedback=true;
 const selector='button,a,[role="button"],label,[role="img"][title],[role="img"][aria-label],#snote-weather';
 const clean=value=>String(value||'').trim().replace(/\s+/g,' ');
 function mark(el){
  if(!(el instanceof Element)||el.matches('canvas,video,iframe')||!el.matches(selector)||el.closest('.snote-icon-tooltip'))return;
  const text=clean(el.textContent),icon=el.hasAttribute('data-tooltip')||el.querySelector('svg,img,i')||/icon|weather/i.test(el.className)||el.getAttribute('role')==='img'||(!text&&el.hasAttribute('aria-label'))||/^[+＋×✕✖−\-↻↺⋮…⚙☰↑↓←→✓✔⌄]+$/u.test(text);
  if(!icon)return;
  if(el.tagName==='LABEL'&&!el.querySelector('svg,img')&&!/icon/.test(el.className))return;
  const title=clean(el.getAttribute('title'));if(title){el.dataset.snoteIconTitle=title;el.removeAttribute('title');}
  const label=clean(el.dataset.tooltip||el.getAttribute('aria-label')||el.dataset.snoteIconTitle||el.querySelector('img')?.alt||text);
  if(!label)return;
  el.dataset.snoteIconHelp=label;el.classList.add('snote-icon-interactive');
  if(!el.hasAttribute('aria-label')&&el.matches('button,a,[role="button"],[role="img"]'))el.setAttribute('aria-label',label);
 }
 function scan(root){if(!(root instanceof Element))return;mark(root);root.querySelectorAll(selector).forEach(mark);}
 scan(document.body);
 const tip=document.createElement('div');tip.id='snote-icon-tooltip';tip.className='snote-icon-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 let active=null,timer=null;
 function hide(){clearTimeout(timer);timer=null;if(active){const ids=(active.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);if(ids.length)active.setAttribute('aria-describedby',ids.join(' '));else active.removeAttribute('aria-describedby');}active=null;tip.hidden=true;}
 function show(el){hide();active=el;timer=setTimeout(()=>{
  if(active!==el||!el.isConnected||!el.getClientRects().length)return hide();
  const host=el.closest('dialog[open]')||document.body;host.append(tip);tip.textContent=el.dataset.snoteIconHelp;tip.hidden=false;
  const rect=el.getBoundingClientRect(),box=tip.getBoundingClientRect(),below=rect.top<box.height+14;
  const left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left+rect.width/2-box.width/2));
  tip.style.left=left+'px';tip.style.top=(below?Math.min(innerHeight-box.height-8,rect.bottom+9):rect.top-box.height-9)+'px';tip.dataset.placement=below?'below':'above';
  tip.style.setProperty('--snote-tooltip-arrow',Math.max(9,Math.min(box.width-9,rect.left+rect.width/2-left))+'px');
  const ids=new Set((el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));ids.add(tip.id);el.setAttribute('aria-describedby',[...ids].join(' '));
 },180);}
 const trigger=node=>node instanceof Element?node.closest('[data-snote-icon-help]'):null;
 document.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const el=trigger(event.target);if(el&&!el.contains(event.relatedTarget)&&el!==active)show(el);});
 document.addEventListener('pointerout',event=>{if(active&&!active.contains(event.relatedTarget)&&active.contains(event.target))hide();});
 document.addEventListener('focusin',event=>{const el=trigger(event.target);if(el?.matches(':focus-visible'))show(el);});
 document.addEventListener('focusout',event=>{if(active?.contains(event.target))hide();});
 document.addEventListener('pointerdown',hide,true);document.addEventListener('scroll',hide,true);addEventListener('resize',hide);addEventListener('pagehide',hide);
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){if(['title','aria-label','data-tooltip'].includes(record.attributeName))mark(record.target);}else{mark(record.target.closest?.(selector));for(const node of record.addedNodes)scan(node);}}if(active&&(!active.isConnected||!active.getClientRects().length))hide();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['title','aria-label','data-tooltip','class','hidden','open']});
})();
