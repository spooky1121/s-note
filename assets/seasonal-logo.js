/* Web decoration only. Paper logos, Auth and the original home links keep their own behavior. */
(()=>{'use strict';
 if(window.SnoteSeasonalLogo)return;
 const selector='img.snote-seasonal-logo',original=new URL('snote-logo.png',document.currentScript?.src||new URL('assets/seasonal-logo.js',document.baseURI)).href,states=new WeakMap(),motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 function update(image){
  const state=states.get(image);if(!state)return;
  const still=state.failed||motion.matches;
  image.classList.toggle('is-seasonal-fallback',still);image.closest('.snote-seasonal-mark')?.classList.toggle('is-seasonal-fallback',still);
  const source=still?original:state.animated;if(image.src!==source)image.src=source;
 }
 function watch(image){
  if(!(image instanceof HTMLImageElement)||!image.matches(selector)||states.has(image))return;
  const state={animated:image.src,failed:image.complete&&image.naturalWidth===0};states.set(image,state);
  image.addEventListener('error',()=>{if(image.src===state.animated){state.failed=true;update(image);}});update(image);
 }
 function scan(root){if(!(root instanceof Element))return;if(root.matches(selector))watch(root);root.querySelectorAll(selector).forEach(watch);}
 scan(document.body);new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);}).observe(document.body,{childList:true,subtree:true});
 motion.addEventListener('change',()=>{scan(document.body);document.querySelectorAll(selector).forEach(update);});
 window.SnoteSeasonalLogo=Object.freeze({refresh:()=>scan(document.body)});
})();
