/* Shared action sizing: 20px drawings, 16px close X and small add/remove circles. */
(()=>{'use strict';
 if(window.SnoteIconSizing)return;
 const glyphSize=20,hosts='button,a,label,[role="button"]';
 const closeControls='button.snote-popup-close,button.close-button,#close-search';
 const navigation='nav,.sidebar,.bottom-nav,#bottom-nav,.mobile-drawer,#mobile-drawer';
 const excluded='.topbar-profile,#snote-profile-trigger,#snote-weather,.snote-mobile-sort select,.snote-sort-header,.photo-thumb,.doc-thumb,.zoom-hit,.add-tile';
 const calculatorShapes={'+':'<path d="M12 4v16M4 12h16"/>','−':'<path d="M4 12h16"/>','×':'<path d="M5 5l14 14M19 5 5 19"/>','÷':'<path d="M4 12h16"/><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>','=':'<path d="M4 8h16M4 16h16"/>','%':'<path d="M5 20 19 4"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>','+/−':'<path d="M3 6h7M6.5 2.5v7M17 3 8 21M16 18h6"/>'};
 const symbols={...calculatorShapes,'＋':calculatorShapes['+'],'-':calculatorShapes['−'],'✕':calculatorShapes['×'],'✖':calculatorShapes['×'],'‹':'<path d="m15 4-8 8 8 8"/>','›':'<path d="m9 4 8 8-8 8"/>','←':'<path d="M20 12H4m7-7-7 7 7 7"/>','→':'<path d="M4 12h16m-7-7 7 7-7 7"/>','↻':'<path d="M20 5v6h-6M4 19v-6h6M5.5 8a7 7 0 0 1 11.6-2L20 9M4 15l2.9 3A7 7 0 0 0 18.5 16"/>','↺':'<path d="M4 5v6h6M20 19v-6h-6M18.5 8A7 7 0 0 0 6.9 6L4 9m16 6-2.9 3A7 7 0 0 1 5.5 16"/>'};
 const pending=new Set(),tracked=new Set(),svgState=new Map(),arrowState=new Map(),stepState=new Map(),stepTextState=new Map();
 let scheduled=false,printing=false;
 const observer=new ResizeObserver(entries=>{for(const entry of entries)queue(entry.target);});
 function property(el,key,value){if(el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value);}
 function svgRestore(svg,state){
  if(state.applied&&svg.getAttribute('viewBox')===state.applied){if(state.original==null)svg.removeAttribute('viewBox');else svg.setAttribute('viewBox',state.original);}
  state.applied=null;if(svg.classList.contains('snote-sized-action-glyph'))svg.classList.remove('snote-sized-action-glyph');svg.style.removeProperty('--snote-action-glyph-scale');
 }
 function stepKind(host){
  if(host.matches(closeControls+', [data-calculator-key]')||host.closest(navigation)&&!host.matches('.mobile-new-car,.plus-tab'))return null;
  const preset=host.dataset.settingsIcon;if(preset==='plus'||preset==='minus')return preset;
  const label=[host.getAttribute('aria-label'),host.dataset.tooltip,host.dataset.snoteIconHelp,host.textContent].filter(Boolean).join(' ');
  if(!host.matches('.snote-detail-icon.is-add,.repair-remove,.ps-add,.snote-finance-add,.mobile-new-car,.plus-tab,#snote92-buy-manual,#income-add-cost')&&!/추가|신규|등록|삭제|제거/.test(label))return null;
  const text=host.textContent.trim();if(/^[+＋](?:$|\s+\S)/.test(text))return 'plus';if(/^[−-](?:$|\s+\S)/.test(text))return 'minus';
  const svg=host.querySelector('svg');if(!svg)return null;
  const shapes=svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,use');if(shapes.length!==1||shapes[0].tagName.toLowerCase()!=='path')return null;
  const d=(shapes[0].getAttribute('d')||'').replace(/[\s,]/g,'');
  if(['M125v14M512h14','M512h14M125v14','M124v16M412h16','M412h16M124v16'].includes(d))return 'plus';
  if(['M512h14','M412h16'].includes(d))return 'minus';return null;
 }
 function clearStepText(host){
  const state=stepTextState.get(host);if(!state)return;
  if(host.contains(state.text)&&state.text.textContent===state.rendered)state.text.textContent=state.original;
  state.prefix.remove();state.svg.remove();stepTextState.delete(host);
 }
 function fitStepText(host,kind){
  const state=stepTextState.get(host);if(state&&host.contains(state.text)&&host.contains(state.svg))return;
  if(state)stepTextState.delete(host);if(host.querySelector('svg'))return;
  const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let text;
  while(text=walker.nextNode())if(text.textContent.trim())break;
  const match=text?.textContent.match(/^(\s*[+＋−-])(\s+\S[\s\S]*)$/);if(!match)return;
  const original=text.textContent,prefix=document.createElement('span');prefix.className='snote-original-step-prefix';prefix.textContent=match[1];text.before(prefix);text.textContent=match[2];
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.style.width='20px';svg.style.height='20px';svg.innerHTML=kind==='plus'?'<path d="M12 5v14M5 12h14"/>':'<path d="M5 12h14"/>';host.prepend(svg);stepTextState.set(host,{text,original,rendered:match[2],prefix,svg});
 }
 function clearStep(host){
  const state=stepState.get(host);if(!state)return;
  if(state.ring){if(state.ringNative)state.ring.classList.remove('snote-step-glyph-ring');else state.ring.replaceWith(...state.ring.childNodes);}
  for(const[key,value,priority]of state.styles){if(value)host.style.setProperty(key,value,priority);else host.style.removeProperty(key);}
  host.classList.remove('snote-step-circle','snote-step-glyph','snote-step-plus','snote-step-minus');stepState.delete(host);
 }
 function compactStep(host,kind){
  const mixed=!!host.textContent.trim()&&!/^[+＋−-]$/.test(host.textContent.trim()),mode=mixed||host.matches('.add-tile')?'glyph':'circle';
  let state=stepState.get(host);if(state&&(state.kind!==kind||state.mode!==mode)){clearStep(host);state=null;}
  if(!state){state={kind,mode,styles:[],svg:null,ring:null};stepState.set(host,state);}
  for(const value of ['plus','minus'])host.classList.toggle('snote-step-'+value,value===kind);
  if(mode==='glyph'){
   host.classList.add('snote-step-glyph');const svg=host.querySelector('svg');
   if(svg&&(!state.ring||!state.ring.contains(svg))){if(state.ringNative)state.ring?.classList.remove('snote-step-glyph-ring');else state.ring?.remove();const native=svg.parentElement.matches('.mobile-plus'),ring=native?svg.parentElement:document.createElement('span');ring.classList.add('snote-step-glyph-ring');if(!native){ring.setAttribute('aria-hidden','true');svg.before(ring);ring.append(svg);}state.svg=svg;state.ring=ring;state.ringNative=native;}
   return;
  }
  host.classList.add('snote-step-circle');host.classList.remove('snote-flat-icon-control');
  const values=[['display','inline-grid'],['place-items','center'],['box-sizing','border-box'],['width','28px'],['height','28px'],['min-width','28px'],['min-height','28px'],['flex','0 0 28px'],['align-self','center'],['padding','0px'],['border','0px solid transparent'],['border-radius','50%'],['background','var(--snote-step-background, #edf4ff)'],['color','var(--snote-step-color, #315cf5)'],['box-shadow','none']];
  if(!state.styles.length)state.styles=values.map(([key])=>[key,host.style.getPropertyValue(key),host.style.getPropertyPriority(key)]);
  for(const[key,value]of values)if(host.style.getPropertyValue(key)!==value||host.style.getPropertyPriority(key)!=='important')host.style.setProperty(key,value,'important');
 }
 function reset(host){
  clearStep(host);clearStepText(host);
  const arrow=arrowState.get(host);if(arrow){arrow.svg.remove();if(host.contains(arrow.text))arrow.text.replaceWith(document.createTextNode(arrow.text.textContent));arrowState.delete(host);}
  if(host.classList.contains('snote-sized-mixed-action'))host.classList.remove('snote-sized-mixed-action');host.style.removeProperty('--snote-mixed-icon-gap');
  for(const svg of host.querySelectorAll('svg.snote-sized-action-glyph')){const state=svgState.get(svg);if(state&&svg.closest(hosts)===host)svgRestore(svg,state);}
 }
 function queue(host){if(!(host instanceof Element))return;pending.add(host);if(!scheduled){scheduled=true;requestAnimationFrame(flush);}}
 function scan(root){
  if(!(root instanceof Element))return;
  if(root.matches(hosts))queue(root);
  const owner=root.closest(hosts);if(owner)queue(owner);
  root.querySelectorAll(hosts).forEach(queue);
 }
 function stroke(svg){let width=0;for(const node of svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,use')){const s=getComputedStyle(node);if(s.stroke!=='none'&&s.strokeOpacity!=='0')width=Math.max(width,parseFloat(s.strokeWidth)||0);}return width;}
 function fitSvg(host,svg,size,mixed){
  if(mixed&&host.textContent.trim()){const gap=parseFloat(getComputedStyle(host).columnGap)||0;property(host,'--snote-mixed-icon-gap',Math.max(6,gap)+'px');if(!host.classList.contains('snote-sized-mixed-action'))host.classList.add('snote-sized-mixed-action');}
  let state=svgState.get(svg);if(!state){state={original:svg.getAttribute('viewBox'),applied:null};svgState.set(svg,state);}
  const actual=svg.getAttribute('viewBox');if(state.applied&&actual!==state.applied){state.original=actual;state.applied=null;}
  const css=getComputedStyle(svg),cw=parseFloat(css.width),ch=parseFloat(css.height);if(!(cw>0&&ch>0)||css.display==='none')return;
  let box;try{box=svg.getBBox();}catch{return;}
  const sw=stroke(svg),w=box.width+sw,h=box.height+sw;if(!(w>0&&h>0))return;
  const target=host.matches(closeControls)?16:stepKind(host)?13:glyphSize;
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
  const value=host.textContent.trim(),shape=value==='↑'?'<path d="M12 20V4M5 11l7-7 7 7"/>':value==='↓'?'<path d="M12 4v16M5 13l7 7 7-7"/>':symbols[value]||null;if(!shape||[...host.querySelectorAll('svg')].some(svg=>!svg.hasAttribute('data-snote-direction-glyph')))return false;
  let state=arrowState.get(host);
  if(!state||!host.contains(state.text)||!host.contains(state.svg)){
   const text=document.createElement('span');text.className='snote-original-direction-text';text.textContent=value;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.dataset.snoteDirectionGlyph='';svg.classList.add('snote-direction-glyph');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.65');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.style.width='20px';svg.style.height='20px';svg.style.setProperty('display','block','important');
   if(getComputedStyle(host).position==='static')host.classList.add('snote-direction-anchor');
   host.replaceChildren(text,svg);state={text,svg,value:null};arrowState.set(host,state);
  }
  if(state.value!==value){state.svg.innerHTML=shape;state.value=value;}
  fitSvg(host,state.svg,size,false);return true;
 }
 function flat(host,nav,mixed){
  const plus=host.querySelector('.mobile-plus');if(plus&&!stepKind(host))for(const[k,v]of[['background','transparent'],['box-shadow','none'],['color','rgb(49, 92, 245)'],['width','20px'],['height','20px'],['margin-top','0px']])if(plus.style.getPropertyValue(k)!==v||plus.style.getPropertyPriority(k)!=='important')plus.style.setProperty(k,v,'important');
  // Close controls share a quiet X with a square hover target.
  if(host.matches(closeControls)){
   if(host.classList.contains('snote-flat-icon-control'))host.classList.remove('snote-flat-icon-control');
   for(const[k,v]of[['background','var(--snote-close-background, transparent)'],['border','0px solid transparent'],['border-radius','4px'],['box-shadow','none'],['color','rgb(75, 75, 80)'],['width','30px'],['height','30px'],['min-width','30px'],['min-height','30px'],['padding','0px'],['margin','0px'],['box-sizing','border-box']])if(host.style.getPropertyValue(k)!==v||host.style.getPropertyPriority(k)!=='important')host.style.setProperty(k,v,'important');
   return;
  }
  const step=stepKind(host);if(step){compactStep(host,step);return;}clearStep(host);
  if(nav)return;
  if(!host.classList.contains('snote-flat-icon-control'))host.classList.add('snote-flat-icon-control');
  for(const[k,v]of[['background','transparent'],['border','0px solid transparent'],['box-shadow','none']])if(host.style.getPropertyValue(k)!==v||host.style.getPropertyPriority(k)!=='important')host.style.setProperty(k,v,'important');
  const css=getComputedStyle(host),white=/^rgba?\(\s*255[, ]+\s*255[, ]+\s*255/.test(css.color),close=host.matches('.snote-popup-close,.detail-close,.close,.close-button,[data-document-close]');
  if(close||white||host.matches('[data-calculator-key]')){const primary=host.matches('.snote-calculator-equals,.snote-save-control')||host.getAttribute('aria-pressed')==='true',color=primary?'rgb(23, 98, 187)':'rgb(100, 120, 142)';if(host.style.getPropertyValue('color')!==color||host.style.getPropertyPriority('color')!=='important')host.style.setProperty('color',color,'important');}
 }
 function fit(host){
  if(!host.isConnected)return;
  if(!host.matches(hosts)||host.closest(excluded)&&!(host.matches('.add-tile')&&stepKind(host))||host.querySelector('input:not([type="file"]):not([type="hidden"]),select,textarea')){reset(host);return;}
  const step=stepKind(host);if(step)fitStepText(host,step);else clearStepText(host);
  const svgs=[...host.querySelectorAll('svg')].filter(svg=>svg.closest(hosts)===host&&!svg.hasAttribute('data-snote-direction-glyph'));
  const textGlyph=!svgs.length&&(/^[+＋−\-×✕✖‹›↻↺↑↓←→]$/.test(host.textContent.trim())||host.matches('[data-calculator-key]')&&!!calculatorShapes[host.textContent.trim()])&&!host.querySelector('img');
  if((svgs.length===1||textGlyph)&&!tracked.has(host)){tracked.add(host);observer.observe(host);}
  const nav=!!host.closest(navigation),rect=host.getBoundingClientRect(),size=Math.min(rect.width,rect.height);
  if(size<18||size>(nav?100:64)&&!(host.matches('.add-tile')&&stepKind(host))){if(size>0)reset(host);return;}
  if(!svgs.length&&fitArrow(host,size)){flat(host,nav,false);return;}
  if(svgs.length===1){
   const mixed=!!host.textContent.trim();
   if(mixed&&!nav&&!stepKind(host)&&!host.matches('.snote-save-control,.snote-print-control,.snote-document-control,.button,.income-toolbar button'))return;
   if(!tracked.has(host)){tracked.add(host);observer.observe(host);}
   flat(host,nav,mixed);fitSvg(host,svgs[0],size,mixed||nav);
  }
 }
 function flush(){
  scheduled=false;const batch=[...pending];pending.clear();
  for(const host of tracked)if(!host.isConnected){observer.unobserve(host);tracked.delete(host);}
  for(const[svg]of svgState)if(!svg.isConnected)svgState.delete(svg);
  for(const[host]of arrowState)if(!host.isConnected)arrowState.delete(host);
  for(const[host]of stepState)if(!host.isConnected)stepState.delete(host);
  for(const[host]of stepTextState)if(!host.isConnected)stepTextState.delete(host);
  if(printing)return;for(const host of batch)fit(host);
 }
 function refresh(){scan(document.body);for(const host of tracked)queue(host);}
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){const host=record.target.closest?.(hosts);if(host)queue(host);if(record.attributeName==='hidden'||record.attributeName==='open')scan(record.target);}else{const host=record.target.closest?.(hosts);if(host)queue(host);for(const node of record.addedNodes)scan(node);}}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','viewBox','d','width','height','stroke-width','aria-pressed','aria-label','data-tooltip','data-settings-icon','data-settings-symbol']});
 if(document.fonts){document.fonts.ready.then(refresh);document.fonts.addEventListener('loadingdone',refresh);}
 addEventListener('resize',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 function printMode(active){printing=active;if(active){for(const[host]of stepState)clearStep(host);for(const[host]of stepTextState)clearStepText(host);for(const[svg,state]of svgState)svgRestore(svg,state);}for(const state of arrowState.values())state.svg.style.setProperty('display',active?'none':'block','important');if(!active)refresh();}
 addEventListener('beforeprint',()=>printMode(true));addEventListener('afterprint',()=>printMode(false));
 const media=matchMedia('print');media.addEventListener('change',e=>printMode(e.matches));
 window.SnoteIconSizing=Object.freeze({refresh,size:glyphSize});refresh();
})();
