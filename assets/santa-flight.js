/* A single decorative flight per minute, independent of business data and navigation. */
(()=>{'use strict';
 if(window.top!==window.self||window.SnoteSantaFlight||document.getElementById('snote-santa'))return;
 const asset=new URL('santa-sleigh.webp',document.currentScript?.src||new URL('assets/santa-flight.js',document.baseURI)).href,motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const root=document.createElement('div'),flight=document.createElement('div'),image=document.createElement('img');
 root.id='snote-santa';root.className='is-paused';root.setAttribute('aria-hidden','true');root.inert=true;
 flight.className='snote-santa-flight';image.alt='';image.width=1666;image.height=944;image.decoding='async';image.draggable=false;image.fetchPriority='low';
 flight.append(image);root.append(flight);document.body.append(root);
 let loaded=false,failed=false;
 function refresh(){
  const stopped=motion.matches||document.hidden||failed;
  root.classList.toggle('is-paused',stopped||!loaded);
  if(!stopped&&!image.getAttribute('src'))image.src=asset;
 }
 image.addEventListener('load',()=>{loaded=true;refresh();});image.addEventListener('error',()=>{failed=true;refresh();});
 document.addEventListener('visibilitychange',refresh);motion.addEventListener('change',refresh);
 window.SnoteSantaFlight=Object.freeze({refresh});refresh();
})();
