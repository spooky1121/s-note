/* One shared close image; existing button handlers, positions and access rules stay intact. */
(()=>{'use strict';
 if(window.SnoteCloseControls)return;
 const selector='button.snote-popup-close,button.close-button,button.snote-chat-close,button.co-close,button.co-history-close,#close-search';
 const imageURL=new URL('close-circle.svg',document.currentScript?.src||new URL('assets/close-controls.js',document.baseURI)).href;
 function render(button){
  if(!(button instanceof HTMLButtonElement)||!button.matches(selector))return;
  if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.getAttribute('title')||button.textContent.trim()||'닫기');
  const image=button.firstElementChild;
  if(button.childNodes.length===1&&image?.matches('img.snote-close-image')&&image.getAttribute('src')===imageURL)return;
  const replacement=document.createElement('img');replacement.className='snote-close-image';replacement.src=imageURL;replacement.alt='';replacement.setAttribute('aria-hidden','true');replacement.draggable=false;replacement.width=30;replacement.height=30;
  button.replaceChildren(replacement);
 }
 function scan(root){if(!(root instanceof Element))return;if(root.matches(selector))render(root);root.querySelectorAll(selector).forEach(render);}
 scan(document.body);
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')render(record.target);else{render(record.target.closest?.('button'));for(const node of record.addedNodes)scan(node);}}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-label']});
 window.SnoteCloseControls=Object.freeze({refresh:()=>scan(document.body)});
})();
