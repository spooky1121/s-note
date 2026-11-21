/* Presentation only; callers retain media scope, permissions and downloads. */
(()=>{'use strict';
 if(window.SnoteVehicleImageViewer)return;
 const overlay=document.getElementById('zoom-overlay'),frame=document.getElementById('zoom-image-frame'),picture=document.getElementById('zoom-image'),status=document.getElementById('zoom-status'),downloadButton=document.getElementById('zoom-download'),closeButton=document.getElementById('zoom-close'),shareButton=document.getElementById('zoom-share');
 if(!overlay||!frame||!picture||!status||!downloadButton||!closeButton||!shareButton)return;
 let session=null;
 const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 function current(s){try{return session===s&&s.isCurrent()===true;}catch{return false;}}
 function sourceBox(source){const el=source instanceof Element?(source.matches('img')?source:source.querySelector('img')||source):null;if(!el)return null;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight?{left:r.left,top:r.top,width:r.width,height:r.height}:null;}
 function originNode(s){if(s.origin?.isConnected&&sourceBox(s.origin))return s.origin;if(s.mediaId)for(const el of document.querySelectorAll('#vehicle-overlay [data-snote-media-id]'))if(el.dataset.snoteMediaId===s.mediaId&&sourceBox(el))return el;return null;}
 function canShare(s){try{return !!s.ready&&!s.closing&&current(s)&&typeof s.share?.open==='function'&&s.share.current()===true;}catch{return false;}}
 function shareControl(s){const available=canShare(s);if(shareButton.hidden===available)shareButton.hidden=!available;shareButton.disabled=!available;}
 function fit(s){if(session!==s)return;const css=getComputedStyle(overlay),width=Math.max(1,overlay.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)),height=Math.max(1,overlay.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom));
  if(!s.ready){frame.style.width=Math.min(360,width)+'px';frame.style.height=Math.min(180,height)+'px';return;}
  const scale=Math.min(Math.min(1440,width)/picture.naturalWidth,height/picture.naturalHeight);frame.style.width=Math.max(1,picture.naturalWidth*scale)+'px';frame.style.height=Math.max(1,picture.naturalHeight*scale)+'px';
 }
 function invalidate(s){if(session!==s)return;window.closeZoom?.({restoreFocus:false});if(session===s)close({restoreFocus:false});}
 function failure(s){if(!current(s)){invalidate(s);return false;}s.ready=false;picture.hidden=true;picture.removeAttribute('src');downloadButton.disabled=true;shareControl(s);overlay.setAttribute('aria-busy','false');overlay.dataset.imageState='error';status.hidden=false;status.textContent='이미지를 불러오지 못했습니다.';fit(s);return false;}
 function dispose(s,{restoreFocus=true}={},completed=false){if(session!==s)return false;const target=originNode(s)||s.returnFocus;session=null;clearInterval(s.guard);s.cancelLoad?.();s.animation?.cancel();s.backdrop?.cancel();if(s.drawer?.isConnected)s.drawer.inert=s.wasInert;
  overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');overlay.setAttribute('aria-busy','false');delete overlay.dataset.imageState;picture.hidden=true;picture.removeAttribute('src');picture.alt='선택한 차량 이미지 크게 보기';status.hidden=true;status.textContent='';downloadButton.disabled=true;shareButton.hidden=true;shareButton.disabled=true;
  frame.style.removeProperty('width');frame.style.removeProperty('height');
  if(restoreFocus){if(target?.isConnected&&target.getClientRects().length&&!target.closest('[inert]'))target.focus({preventScroll:true});else if(s.drawer?.classList.contains('open'))s.drawer.querySelector('.detail-close')?.focus({preventScroll:true});}
  const resolve=s.resolveClose;s.resolveClose=null;resolve?.(completed);return true;
 }
 function close({restoreFocus=true,animate=false}={}){const s=session;if(!s)return Promise.resolve(true);
  if(s.closing&&animate)return s.closeTask;
  if(!animate||!s.ready||!current(s)||reduced()||typeof frame.animate!=='function'){dispose(s,{restoreFocus});return Promise.resolve(true);}
  const start={transform:getComputedStyle(frame).transform,opacity:getComputedStyle(frame).opacity};s.animation?.cancel();
  const target=sourceBox(originNode(s)),box=frame.getBoundingClientRect(),end=target?'translate('+(target.left-box.left)+'px,'+(target.top-box.top)+'px) scale('+(target.width/box.width)+','+(target.height/box.height)+')':'scale(.96)';
  s.closing=true;overlay.dataset.imageState='closing';downloadButton.disabled=true;shareControl(s);s.closeTask=new Promise(resolve=>{s.resolveClose=resolve;});
  s.animation=frame.animate([start,{transform:end,opacity:0}],{duration:220,easing:'cubic-bezier(.3,0,.25,1)',fill:'forwards'});
  s.backdrop=overlay.animate([{opacity:1},{opacity:0}],{duration:220,easing:'ease-out',fill:'forwards'});s.backdrop.finished.catch(()=>{});
  s.animation.finished.then(()=>{if(session!==s)return;if(!current(s)){invalidate(s);return;}dispose(s,{restoreFocus},true);},()=>{if(session===s)dispose(s,{restoreFocus});});
  return s.closeTask;
 }
 function open({src,origin=null,isCurrent,download,share=null,alt='선택한 차량 이미지 크게 보기'}={}){
  const returning=origin instanceof HTMLElement?origin:document.activeElement,from=sourceBox(origin||document.activeElement);close({restoreFocus:false});
  if(typeof src!=='string'||!src||typeof isCurrent!=='function')return Promise.resolve(false);
  const original=origin instanceof Element?origin:document.activeElement,s={src,isCurrent,download,share,from,origin:original,mediaId:original?.closest?.('[data-snote-media-id]')?.dataset.snoteMediaId,returnFocus:returning,ready:false,animation:null,drawer:document.getElementById('vehicle-overlay')};session=s;
  s.wasInert=!!s.drawer?.inert;if(!current(s)){close({restoreFocus:false});return Promise.resolve(false);}if(s.drawer)s.drawer.inert=true;
  overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');overlay.setAttribute('aria-busy','true');overlay.dataset.imageState='loading';picture.alt=alt;picture.hidden=true;status.hidden=false;status.textContent='이미지를 불러오는 중입니다.';downloadButton.disabled=true;shareControl(s);fit(s);closeButton.focus({preventScroll:true});
  s.guard=setInterval(()=>{if(session!==s)return;if(!current(s))invalidate(s);else if(!s.closing)shareControl(s);},200);
  const loaded=new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);picture.removeEventListener('load',onLoad);picture.removeEventListener('error',onError);resolve(value);},onLoad=()=>finish(picture.naturalWidth>0&&picture.naturalHeight>0),onError=()=>finish(false),timer=setTimeout(()=>finish(false),15000);s.cancelLoad=()=>finish(false);picture.addEventListener('load',onLoad);picture.addEventListener('error',onError);picture.src=src;if(picture.complete&&picture.naturalWidth>0)queueMicrotask(onLoad);});
  return(async()=>{if(!await loaded){if(session===s)return failure(s);return false;}if(!current(s)){invalidate(s);return false;}
   try{if(typeof picture.decode==='function')await picture.decode();}catch{if(session===s)return failure(s);return false;}
   if(!current(s)||picture.getAttribute('src')!==s.src){invalidate(s);return false;}
   s.ready=true;fit(s);picture.hidden=false;status.hidden=true;status.textContent='';downloadButton.disabled=false;shareControl(s);overlay.setAttribute('aria-busy','false');overlay.dataset.imageState='ready';
   if(!reduced()&&typeof frame.animate==='function'){const box=frame.getBoundingClientRect(),start=s.from?{transform:'translate('+(s.from.left-box.left)+'px,'+(s.from.top-box.top)+'px) scale('+(s.from.width/box.width)+','+(s.from.height/box.height)+')',opacity:.55}:{transform:'scale(.96)',opacity:0};s.animation=frame.animate([start,{transform:'none',opacity:1}],{duration:280,easing:'cubic-bezier(.2,.75,.25,1)',fill:'none'});s.animation.finished.catch(()=>{});}
   return true;
  })();
 }
 function download(){const s=session;if(!s?.ready||s.closing||!current(s))return false;try{s.download?.();return true;}catch{window.toast?.('이미지를 저장하지 못했습니다. 다시 시도해 주세요.');return false;}}
 async function share(){const s=session,dialog=document.getElementById('snote-document-mms');if(!canShare(s)||dialog?.open)return false;const action=s.share;const closed=await window.closeZoom?.({animate:true,restoreFocus:false});if(closed!==true||session!==null)return false;try{if(action.current()!==true)return false;}catch{return false;}const restore=()=>{try{if(session||action.current()!==true)return;const target=originNode(s)||s.drawer?.querySelector('.detail-close');if(target?.isConnected&&target.getClientRects().length&&!target.closest('[inert]'))target.focus({preventScroll:true});}catch{}};dialog?.addEventListener('close',restore,{once:true});try{await action.open();if(!dialog?.open){dialog?.removeEventListener('close',restore);restore();}return true;}catch{if(!dialog?.open){dialog?.removeEventListener('close',restore);restore();}window.toast?.('서류 공유를 열지 못했습니다. 다시 시도해 주세요.');return false;}}
 const resize=()=>{const s=session;if(!s)return;if(!current(s)){invalidate(s);return;}if(s.closing){window.closeZoom?.();return;}s.animation?.cancel();fit(s);};window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
 document.addEventListener('keydown',event=>{if(!session)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();window.closeZoom?.({animate:true});return;}if(event.key!=='Tab')return;const buttons=[shareButton,downloadButton,closeButton].filter(b=>!b.disabled&&!b.hidden),at=buttons.indexOf(document.activeElement);if(at<0||!event.shiftKey&&at===buttons.length-1||event.shiftKey&&at===0){event.preventDefault();buttons[event.shiftKey?buttons.length-1:0]?.focus();}},true);
 window.addEventListener('pagehide',()=>{if(session)window.closeZoom?.({restoreFocus:false});});
 window.SnoteVehicleImageViewer=Object.freeze({open,close,download,share,active:()=>session!==null});
})();
