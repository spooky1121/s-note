/* Match action drawings to the shared chain's painted proportion, without changing controls. */
(()=>{'use strict';
 if(window.SnoteIconSizing)return;
 const ratio=.63,hosts='button,a,label,[role="button"]';
 const navigation='nav,.sidebar,.bottom-nav,#bottom-nav,.mobile-drawer,#mobile-drawer';
 const excluded='.topbar-profile,#snote-profile-trigger,#snote-weather,.snote-mobile-sort select,.snote-sort-header,.photo-thumb,.doc-thumb,.zoom-hit,.add-tile';
 const calculatorShapes={'+':'<path d="M12 4v16M4 12h16"/>','−':'<path d="M4 12h16"/>','×':'<path d="M5 5l14 14M19 5 5 19"/>','÷':'<path d="M4 12h16"/><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>','=':'<path d="M4 8h16M4 16h16"/>','%':'<path d="M5 20 19 4"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>','+/−':'<path d="M3 6h7M6.5 2.5v7M17 3 8 21M16 18h6"/>'};
 const pending=new Set(),tracked=new Set(),svgState=new Map(),textState=new Map(),arrowState=new Map();
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
 let scheduled=false,printing=false;
 const observer=new ResizeObserver(entries=>{for(const entry of entries)queue(entry.target);});
 function property(el,key,value){if(el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value);}
 function svgRestore(svg,state){
  if(state.applied&&svg.getAttribute('viewBox')===state.applied){if(state.original==null)svg.removeAttribute('viewBox');else svg.setAttribute('viewBox',state.original);}
  state.applied=null;if(svg.classList.contains('snote-sized-action-glyph'))svg.classList.remove('snote-sized-action-glyph');svg.style.removeProperty('--snote-action-glyph-scale');
 }
 function reset(host){
  const arrow=arrowState.get(host);if(arrow){arrow.svg.remove();if(host.contains(arrow.text))arrow.text.replaceWith(document.createTextNode(arrow.text.textContent));arrowState.delete(host);}
  if(host.classList.contains('snote-sized-mixed-action'))host.classList.remove('snote-sized-mixed-action');host.style.removeProperty('--snote-mixed-icon-gap');
  for(const svg of host.querySelectorAll('svg.snote-sized-action-glyph')){const state=svgState.get(svg);if(state&&svg.closest(hosts)===host)svgRestore(svg,state);}
  const text=textState.get(host);if(text){text.style.removeProperty('--snote-action-glyph-scale');if(text.classList.contains('snote-sized-action-text'))text.classList.remove('snote-sized-action-text');}
 }
 function queue(host){if(!(host instanceof Element))return;pending.add(host);if(!scheduled){scheduled=true;requestAnimationFrame(flush);}}
 function scan(root){
  if(!(root instanceof Element))return;
  if(root.matches(hosts))queue(root);
  const owner=root.closest(hosts);if(owner)queue(owner);
  root.querySelectorAll(hosts).forEach(queue);
 }
 function stroke(svg){let width=0;for(const node of svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,use')){const s=getComputedStyle(node);if(s.stroke!=='none'&&s.strokeOpacity!=='0')width=Math.max(width,parseFloat(s.strokeWidth)||0);}return width;}
 function originalInk(svg,state,box,sw,cw,ch){
  const values=(state.original||'').trim().split(/[\s,]+/).map(Number);
  const vw=values.length===4&&values[2]>0?values[2]:cw,vh=values.length===4&&values[3]>0?values[3]:ch;
  return Math.max(box.width+sw,box.height+sw)*Math.min(cw/vw,ch/vh);
 }
 function fitSvg(host,svg,size,mixed){
  if(mixed&&host.textContent.trim()){const gap=parseFloat(getComputedStyle(host).columnGap)||0;property(host,'--snote-mixed-icon-gap',Math.max(6,gap)+'px');if(!host.classList.contains('snote-sized-mixed-action'))host.classList.add('snote-sized-mixed-action');}
  let state=svgState.get(svg);if(!state){state={original:svg.getAttribute('viewBox'),applied:null};svgState.set(svg,state);}
  const actual=svg.getAttribute('viewBox');if(state.applied&&actual!==state.applied){state.original=actual;state.applied=null;}
  const css=getComputedStyle(svg),cw=parseFloat(css.width),ch=parseFloat(css.height);if(!(cw>0&&ch>0)||css.display==='none')return;
  let box;try{box=svg.getBBox();}catch{return;}
  const sw=stroke(svg),w=box.width+sw,h=box.height+sw;if(!(w>0&&h>0))return;
  const original=originalInk(svg,state,box,sw,cw,ch),target=Math.max(original,Math.min(size*ratio,mixed?24:Infinity));
  // Fit the viewBox to the ink first, so short '+' paths and full-size disks get the same visual weight.
  const pad=Math.max(w,h)*.01,x=box.x-sw/2-pad,y=box.y-sw/2-pad,vw=w+pad*2,vh=h+pad*2;
  const fitted=[x,y,vw,vh].map(n=>Number(n.toFixed(4))).join(' ');
  let scale=target/(Math.max(w,h)*Math.min(cw/vw,ch/vh));
  if(mixed){const outer=getComputedStyle(host),gap=(parseFloat(outer.columnGap)||0)+(parseFloat(css.marginRight)||0)+(parseFloat(css.marginLeft)||0);const allowance=Math.max(0,gap-2);scale=Math.min(scale,(cw+allowance*2)/(w*Math.min(cw/vw,ch/vh)));}
  scale=Math.min(3,Math.max(.5,scale));
  state.applied=fitted;if(svg.getAttribute('viewBox')!==fitted)svg.setAttribute('viewBox',fitted);
  if(!svg.classList.contains('snote-sized-action-glyph'))svg.classList.add('snote-sized-action-glyph');
  property(svg,'--snote-action-glyph-scale',String(Number(scale.toFixed(5))));
 }
 function fitArrow(host,size){
  const value=host.textContent.trim(),shape=value==='↑'?'<path d="M12 20V4M5 11l7-7 7 7"/>':value==='↓'?'<path d="M12 4v16M5 13l7 7 7-7"/>':host.matches('[data-calculator-key]')?calculatorShapes[value]:null;if(!shape||[...host.querySelectorAll('svg')].some(svg=>!svg.hasAttribute('data-snote-direction-glyph')))return false;
  let state=arrowState.get(host);
  if(!state||!host.contains(state.text)||!host.contains(state.svg)){
   const text=document.createElement('span');text.className='snote-original-direction-text';text.textContent=value;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.dataset.snoteDirectionGlyph='';svg.classList.add('snote-direction-glyph');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.style.width='20px';svg.style.height='20px';
   if(getComputedStyle(host).position==='static')host.classList.add('snote-direction-anchor');
   host.replaceChildren(text,svg);state={text,svg,value:null};arrowState.set(host,state);
  }
  if(state.value!==value){state.svg.innerHTML=shape;state.value=value;}
  fitSvg(host,state.svg,size,false);return true;
 }
 function fitText(host,size){
  if(!context)return false;
  const value=host.textContent.trim();if(!/^[+＋−\-×✕✖‹›↻↺↑↓←→]$/.test(value)||host.querySelector('svg,img,input,select,textarea'))return false;
  let text=textState.get(host);if(!text||!host.contains(text)){text=document.createElement('span');text.textContent=value;host.replaceChildren(text);textState.set(host,text);}
  if(!text.classList.contains('snote-sized-action-text'))text.classList.add('snote-sized-action-text');
  const s=getComputedStyle(text);context.font=[s.fontStyle,s.fontWeight,s.fontSize,s.fontFamily].join(' ');const m=context.measureText(value),ink=Math.max(m.actualBoundingBoxLeft+m.actualBoundingBoxRight,m.actualBoundingBoxAscent+m.actualBoundingBoxDescent);
  if(ink>0){
   const scale=Math.max(1,Math.min(2.5,size*ratio/ink));property(text,'--snote-action-glyph-scale',String(Number(scale.toFixed(5))));
  }
  return true;
 }
 function fit(host){
  if(!host.isConnected)return;
  if(!host.matches(hosts)||host.closest(excluded)||host.querySelector('input:not([type="file"]):not([type="hidden"]),select,textarea')){reset(host);return;}
  const svgs=[...host.querySelectorAll('svg')].filter(svg=>svg.closest(hosts)===host&&!svg.hasAttribute('data-snote-direction-glyph'));
  const textGlyph=!svgs.length&&(/^[+＋−\-×✕✖‹›↻↺↑↓←→]$/.test(host.textContent.trim())||host.matches('[data-calculator-key]')&&!!calculatorShapes[host.textContent.trim()])&&!host.querySelector('img');
  if((svgs.length===1||textGlyph)&&!tracked.has(host)){tracked.add(host);observer.observe(host);}
  const nav=!!host.closest(navigation),rect=host.getBoundingClientRect(),size=Math.min(rect.width,rect.height);
  if(size<18||size>(nav?100:64)){if(size>0)reset(host);return;}
  if(!svgs.length&&fitArrow(host,size))return;
  if(svgs.length===1){
   const mixed=!!host.textContent.trim();
   if(mixed&&!nav&&!host.matches('.snote-save-control,.snote-print-control,.snote-document-control,.button,.income-toolbar button'))return;
   if(!tracked.has(host)){tracked.add(host);observer.observe(host);}
   fitSvg(host,svgs[0],nav?Math.min(size,24/ratio):size,mixed||nav);
  }else if(!svgs.length&&fitText(host,size)){if(!tracked.has(host)){tracked.add(host);observer.observe(host);}}
 }
 function flush(){
  scheduled=false;const batch=[...pending];pending.clear();
  for(const host of tracked)if(!host.isConnected){observer.unobserve(host);tracked.delete(host);}
  for(const[svg]of svgState)if(!svg.isConnected)svgState.delete(svg);
  for(const[host]of textState)if(!host.isConnected)textState.delete(host);
  for(const[host]of arrowState)if(!host.isConnected)arrowState.delete(host);
  if(printing)return;for(const host of batch)fit(host);
 }
 function refresh(){scan(document.body);for(const host of tracked)queue(host);}
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){const host=record.target.closest?.(hosts);if(host)queue(host);if(record.attributeName==='hidden'||record.attributeName==='open')scan(record.target);}else{const host=record.target.closest?.(hosts);if(host)queue(host);for(const node of record.addedNodes)scan(node);}}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','viewBox','d','width','height','stroke-width']});
 if(document.fonts){document.fonts.ready.then(refresh);document.fonts.addEventListener('loadingdone',refresh);}
 addEventListener('resize',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 addEventListener('beforeprint',()=>{printing=true;for(const[svg,state]of svgState)svgRestore(svg,state);});
 addEventListener('afterprint',()=>{printing=false;refresh();});
 const media=matchMedia('print');media.addEventListener('change',e=>{printing=e.matches;if(printing){for(const[svg,state]of svgState)svgRestore(svg,state);}else refresh();});
 window.SnoteIconSizing=Object.freeze({refresh,ratio});refresh();
})();
