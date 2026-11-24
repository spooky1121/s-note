/* Embedded close drawing with a CSS fallback; keep the original buttons and close rules. */
(()=>{'use strict';
 if(window.SnoteCloseControls)return;
 const selector='button.snote-popup-close,button.close-button,button.snote-chat-close,button.co-close,button.co-history-close,#close-search';
 const owners=new WeakMap();
 const imageURL='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#F6374A"/><path d="m10.75 10.75 10.5 10.5m0-10.5-10.5 10.5" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>');
 function fallback(button,image){
  if(image.parentNode!==button||!button.matches(selector))return;
  const replacement=document.createElement('span');replacement.className='snote-close-image snote-close-fallback';replacement.setAttribute('aria-hidden','true');replacement.textContent='×';
  button.replaceChildren(replacement);
 }
 function watchImage(button,image){
  if(!owners.has(image))image.addEventListener('error',()=>fallback(owners.get(image),image));
  owners.set(image,button);
 }
 function render(button){
  if(!(button instanceof HTMLButtonElement)||!button.matches(selector))return;
  if(!button.hasAttribute('aria-label')){const label=button.getAttribute('title')||button.textContent.trim();button.setAttribute('aria-label',!label||/^[×✕✖xX]$/.test(label)?'닫기':label);}
  const image=button.firstElementChild;
  if(button.childNodes.length===1){
   if(image?.matches('span.snote-close-image.snote-close-fallback')&&image.textContent==='×')return;
   if(image?.matches('img.snote-close-image')&&image.getAttribute('src')===imageURL){watchImage(button,image);if(image.complete&&image.naturalWidth===0)fallback(button,image);return;}
  }
  const replacement=document.createElement('img');replacement.className='snote-close-image';replacement.alt='';replacement.setAttribute('aria-hidden','true');replacement.draggable=false;replacement.width=24;replacement.height=24;
  watchImage(button,replacement);replacement.src=imageURL;
  button.replaceChildren(replacement);
 }
 function scan(root){if(!(root instanceof Element))return;if(root.matches(selector))render(root);root.querySelectorAll(selector).forEach(render);}
 scan(document.body);
 new MutationObserver(records=>{for(const record of records){render(record.target.closest?.(selector));if(record.type!=='attributes')for(const node of record.addedNodes)scan(node);}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-label','src']});
 window.SnoteCloseControls=Object.freeze({refresh:()=>scan(document.body)});
})();
