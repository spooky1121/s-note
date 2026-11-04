/* Add 1.5pt (=2 CSS px) to screen font declarations. Original print rules and inline fitting remain intact. */
(()=>{'use strict';if(window.snoteReadableType)return;window.snoteReadableType=true;
 const sheet=document.createElement('style');sheet.id='snote-readable-type';sheet.dataset.fontIncrease='2px';document.head.append(sheet);let queued=false;
 function rules(items){let result='';for(const rule of items){
  if(rule.type===1){const value=rule.style.getPropertyValue('font-size').trim();if(!value||/^(?:inherit|initial|unset|revert(?:-layer)?|0(?:px|pt)?|small(?:er)?|medium|large(?:r)?)$/i.test(value)||/(?:em|rem|%)\s*$/.test(value)||rule.selectorText.includes('.snote-popup-close'))continue;
   if(!/(?:px|pt|var\(|calc\(|clamp\(|min\(|max\()/i.test(value))continue;
   result+=rule.selectorText+'{font-size:calc(('+value+') + 2px)'+(rule.style.getPropertyPriority('font-size')?'!important':'')+';}';
  }else if(rule.cssRules&&/^@(media|supports|container|layer)\b/i.test(rule.cssText)){
   const head=rule.cssText.slice(0,rule.cssText.indexOf('{'));if(/^@media\s+print\b/i.test(head))continue;const child=rules(rule.cssRules);if(child)result+=head+'{'+child+'}';
  }
 }return result;}
 function rebuild(){queued=false;let css='';for(const source of document.styleSheets){if(source.ownerNode===sheet||source.disabled||source.media?.mediaText==='print')continue;try{const content=rules(source.cssRules);css+=source.media?.mediaText?'@media '+source.media.mediaText+'{'+content+'}':content;}catch{}}
  sheet.textContent='@media screen{'+css+'}';document.documentElement.dataset.snoteFontIncrease='2px';window.dispatchEvent(new Event('snote-fonts-enlarged'));
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(rebuild);}
 rebuild();document.addEventListener('load',event=>{if(event.target instanceof HTMLLinkElement&&event.target.rel==='stylesheet')schedule();},true);
 new MutationObserver(records=>{if(records.some(r=>r.target!==sheet&&!sheet.contains(r.target)&&([...r.addedNodes].some(n=>n instanceof Element&&(n.matches('style,link[rel="stylesheet"]')||n.querySelector('style,link[rel="stylesheet"]')))||r.target instanceof HTMLStyleElement)))schedule();}).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
