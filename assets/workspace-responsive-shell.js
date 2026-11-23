/* Rail labels live inside the workspace sidebar and never replace navigation or reorder handlers. */
(()=>{
 'use strict';if(window.SnoteResponsiveShell)return;
 const side=document.querySelector('#snote-app>.sidebar'),nav=side?.querySelector('#desktop-nav');if(!side||!nav)return;
 const app=side.parentElement,gate=document.getElementById('zc-cloud-gate');
 const media=matchMedia('(min-width:761px) and (max-width:1120px)'),tip=document.createElement('div');
 tip.id='snote-shell-nav-tooltip';tip.className='snote-shell-nav-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;side.append(tip);
 let active=null,originalTitle=null,frame=null;
 function described(button,add){const before=button.getAttribute('aria-describedby'),ids=new Set((before||'').split(/\s+/).filter(Boolean));if(add)ids.add(tip.id);else ids.delete(tip.id);const after=[...ids].join(' ');if(after&&after!==before)button.setAttribute('aria-describedby',after);else if(!after&&before!==null)button.removeAttribute('aria-describedby');}
 function eligible(button){return media.matches&&!app.inert&&!app.hidden&&app.getAttribute('aria-hidden')!=='true'&&!(gate&&!gate.hidden&&getComputedStyle(gate).display!=='none')&&!!button?.isConnected&&button.parentElement===nav&&button.matches('button[data-nav-label]')&&!button.hidden&&button.getClientRects().length>0&&!nav.classList.contains('snote-reorder-edit')&&getComputedStyle(side).display!=='none';}
 function hide(){if(frame!==null){cancelAnimationFrame(frame);frame=null;}if(active){described(active,false);if(originalTitle!==null&&!active.hasAttribute('title'))active.setAttribute('title',originalTitle);}active=null;originalTitle=null;tip.hidden=true;tip.textContent='';}
 function position(){frame=null;if(!eligible(active))return hide();const text=active.getAttribute('aria-label')||active.dataset.navLabel;if(!text)return hide();described(active,true);if(tip.textContent!==text)tip.textContent=text;tip.hidden=false;const r=active.getBoundingClientRect(),s=side.getBoundingClientRect(),b=tip.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(innerWidth-b.width-8,s.right+8))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-b.height-8,r.top+(r.height-b.height)/2))+'px';}
 function schedule(){if(active&&frame===null)frame=requestAnimationFrame(position);}
 function show(button){if(!eligible(button))return;hide();active=button;originalTitle=button.getAttribute('title');button.removeAttribute('title');described(button,true);position();}
 const target=value=>value instanceof Element?value.closest('button[data-nav-label]'):null;
 nav.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;const button=target(event.target);if(button&&button!==active&&!button.contains(event.relatedTarget))show(button);});
 nav.addEventListener('pointerout',event=>{if(active?.contains(event.target)&&!active.contains(event.relatedTarget)){const focused=document.activeElement===active&&active.matches(':focus-visible');if(!focused)hide();}});
 nav.addEventListener('focusin',event=>{const button=target(event.target);if(button)show(button);});
 nav.addEventListener('focusout',event=>{if(active?.contains(event.target))hide();});
 nav.addEventListener('pointerdown',hide,true);nav.addEventListener('keydown',event=>{if(event.key==='Escape'||event.key==='F2'||event.altKey)hide();});
 side.addEventListener('scroll',hide,{passive:true});window.addEventListener('resize',hide);media.addEventListener('change',hide);
 for(const name of ['blur','pagehide','snote:auth-reset','snote:message-open','snote:route-changed'])window.addEventListener(name,hide);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();});
 new MutationObserver(records=>{if(active){if(!eligible(active))hide();else{described(active,true);if(records.some(record=>record.attributeName!=='aria-describedby'))schedule();}}}).observe(nav,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-label','aria-describedby','data-nav-label','hidden']});
 const visibility=new MutationObserver(()=>{if(active&&!eligible(active))hide();});
 visibility.observe(app,{attributes:true,attributeFilter:['hidden','inert','aria-hidden','style','class']});
 if(gate)visibility.observe(gate,{attributes:true,attributeFilter:['hidden','style','class']});
 window.SnoteResponsiveShell=Object.freeze({hide,refresh:schedule});
})();
