/* View-scoped exit motion. Cleanup runs only after an authorized close still owns its view. */
(()=>{'use strict';if(window.snoteDrawerMotion)return;const jobs=new Map();
function cancel(root){jobs.get(root)?.cancel();}
function close(root,finish,valid=()=>true){if(!root||!valid())return Promise.resolve(false);const pending=jobs.get(root);if(pending)return pending.promise;const frame=root.querySelector('.vehicle-detail-frame,.snote-popup-frame');if(!frame||!frame.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve(finish());
 const job={promise:null,cancel:null};let resolve;job.promise=new Promise(r=>resolve=r);jobs.set(root,job);const wasInert=frame.inert,inlineAnimation=frame.style.animation,start=getComputedStyle(frame).transform;let animation,timer,settled=false;
 function complete(commit){if(settled)return;settled=true;clearTimeout(timer);if(jobs.get(root)===job)jobs.delete(root);animation?.cancel();frame.style.animation=inlineAnimation;frame.inert=wasInert;delete root.dataset.snoteDrawerClosing;let result=false;try{if(commit&&valid())result=finish();}finally{resolve(result);}}
 job.cancel=()=>complete(false);frame.style.animation='none';frame.inert=true;root.dataset.snoteDrawerClosing='1';try{animation=frame.animate([{transform:start==='none'?'translateX(0)':start},{transform:'translateX(100%)'}],{duration:250,easing:'cubic-bezier(.4,0,.6,1)',fill:'forwards'});animation.finished.then(()=>complete(true),()=>complete(false));timer=setTimeout(()=>complete(true),450);}catch{complete(true);}return job.promise;
}
window.snoteDrawerMotion={close,cancel,pending:root=>jobs.get(root)?.promise||null};addEventListener('pagehide',()=>{for(const root of [...jobs.keys()])cancel(root);});})();
