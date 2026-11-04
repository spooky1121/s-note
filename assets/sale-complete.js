/* Completion follows the authenticated server acknowledgement, never the local queue. */
window.snoteSaleComplete=current=>new Promise(resolve=>{
 const layer=document.createElement('div');layer.className='snote-sale-complete';layer.setAttribute('role','status');layer.setAttribute('aria-live','polite');
 layer.innerHTML='<div><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="m19 32 9 9 18-19"/></svg><strong>판매 완료</strong><span>변경사항이 저장되었습니다.</span></div>';
 document.body.append(layer);let done=false;const finish=ok=>{if(done)return;done=true;clearInterval(check);clearTimeout(timer);document.removeEventListener('keydown',keys,true);layer.remove();resolve(ok);};
 const keys=e=>{if(['Escape','Tab','Enter'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape')finish(current());}};
 document.addEventListener('keydown',keys,true);
 const check=setInterval(()=>{if(!current())finish(false)},60),timer=setTimeout(()=>finish(current()),matchMedia('(prefers-reduced-motion:reduce)').matches?150:1050);
});
