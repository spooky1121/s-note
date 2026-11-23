/* Optional presentation enhancement: the fixed login gate owns its scroll. */
(()=>{'use strict';
 const gate=document.getElementById('zc-cloud-gate');if(!gate)return;
 const items=[...gate.querySelectorAll('[data-login-reveal]')],motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');let observer;
 const reveal=item=>{item.classList.remove('is-pending');item.classList.add('is-revealed');observer?.unobserve(item);};
 const showAll=()=>{observer?.disconnect();gate.classList.remove('snote-landing-motion');for(const item of items)reveal(item);};
 if(!items.length||!('IntersectionObserver'in window)||motion?.matches)return;
 try{
  observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)reveal(entry.target);},{root:gate,rootMargin:'0px 0px -4% 0px',threshold:.1});
  gate.classList.add('snote-landing-motion');const frame=gate.getBoundingClientRect();
  for(const item of items){const bounds=item.getBoundingClientRect();if(bounds.top<frame.bottom&&bounds.bottom>frame.top)reveal(item);else{item.classList.add('is-pending');observer.observe(item);}}
  gate.addEventListener('focusin',event=>{const item=event.target.closest?.('[data-login-reveal]');if(item)reveal(item);});
  motion?.addEventListener?.('change',event=>{if(event.matches)showAll();});
 }catch{showAll();}
})();
