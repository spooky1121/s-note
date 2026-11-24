/* One shared menu; every native select keeps its layout, value, form and change handler. */
(()=>{
 'use strict';
 if(window.SnoteDropdownMenu)return;
 const EXCLUDED='.status-select,.snote-status-native,#list-filter,[multiple],[hidden],[aria-hidden="true"],[data-snote-native-dropdown],[data-snote-custom-select]';
 const canPopover=typeof HTMLElement.prototype.showPopover==='function';
 let menu=null,list=null,active=null,serial=0,queued=false,watcher=0,watchTime=0,composing=false;
 const set=(node,name,value)=>{if(node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));};
 const paint=(name,value)=>{if(menu.style.getPropertyValue(name)!==value)menu.style.setProperty(name,value);};
 function eligible(select){
  return select instanceof HTMLSelectElement&&select.size<=1&&!select.matches(EXCLUDED)&&!select.closest('.color-picker,[data-snote-custom-select]');
 }
 function nativeViewport(view){const visual=view.visualViewport;return {left:visual?.offsetLeft||0,top:visual?.offsetTop||0,width:visual?.width||view.innerWidth,height:visual?.height||view.innerHeight};}
 function viewport(){
  const native=nativeViewport(window);
  // An auto-height workbook iframe can be much taller than the browser. Bound
  // its menu by the portion actually visible through every same-origin frame.
  try{
   let view=window,left=native.left,top=native.top,right=left+native.width,bottom=top+native.height;
   let scaleX=1,scaleY=1,offsetX=0,offsetY=0;
   for(let depth=0;depth<20&&view.parent!==view;depth++){
    const frame=view.frameElement,parent=view.parent;if(!frame)return native;
    // Reading the parent's document proves this step is same-origin.
    void parent.document.documentElement;
    const rect=frame.getBoundingClientRect(),style=parent.getComputedStyle(frame);
    if(!frame.getClientRects().length||rect.width<=0||rect.height<=0||frame.closest('[hidden],[inert],[aria-hidden="true"]')||style.visibility==='hidden'||style.visibility==='collapse')return {...native,width:0,height:0};
    const paddingLeft=parseFloat(style.paddingLeft)||0,paddingTop=parseFloat(style.paddingTop)||0;
    const contentWidth=frame.clientWidth-paddingLeft-(parseFloat(style.paddingRight)||0);
    const contentHeight=frame.clientHeight-paddingTop-(parseFloat(style.paddingBottom)||0);
    const boxScaleX=rect.width/(frame.offsetWidth||rect.width||1),boxScaleY=rect.height/(frame.offsetHeight||rect.height||1);
    const stepX=boxScaleX*contentWidth/(view.innerWidth||contentWidth||1),stepY=boxScaleY*contentHeight/(view.innerHeight||contentHeight||1);
    if(!(stepX>0&&stepY>0))return native;
    const originX=rect.left+(frame.clientLeft+paddingLeft)*boxScaleX,originY=rect.top+(frame.clientTop+paddingTop)*boxScaleY;
    left=originX+left*stepX;right=originX+right*stepX;top=originY+top*stepY;bottom=originY+bottom*stepY;
    offsetX=originX+offsetX*stepX;offsetY=originY+offsetY*stepY;scaleX*=stepX;scaleY*=stepY;
    const bounds=nativeViewport(parent);
    left=Math.max(left,bounds.left);right=Math.min(right,bounds.left+bounds.width);top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.top+bounds.height);
    for(let node=frame.parentElement;node;node=node.parentElement){
     const clipStyle=parent.getComputedStyle(node),clipX=/(auto|scroll|hidden|clip)/.test(clipStyle.overflowX),clipY=/(auto|scroll|hidden|clip)/.test(clipStyle.overflowY);
     if(!clipX&&!clipY)continue;
     const clip=node.getBoundingClientRect(),nodeScaleX=clip.width/(node.offsetWidth||clip.width||1),nodeScaleY=clip.height/(node.offsetHeight||clip.height||1);
     if(clipX){const start=clip.left+node.clientLeft*nodeScaleX;left=Math.max(left,start);right=Math.min(right,start+node.clientWidth*nodeScaleX);}
     if(clipY){const start=clip.top+node.clientTop*nodeScaleY;top=Math.max(top,start);bottom=Math.min(bottom,start+node.clientHeight*nodeScaleY);}
    }
    view=parent;
   }
   return {left:(left-offsetX)/scaleX,top:(top-offsetY)/scaleY,width:Math.max(0,right-left)/scaleX,height:Math.max(0,bottom-top)/scaleY};
  }catch{return native;}
 }
 function visible(select){
  if(!select.isConnected||select.closest('[hidden],[inert],[aria-hidden="true"]')||!select.getClientRects().length)return false;
  const rect=select.getBoundingClientRect(),view=viewport();if(!(view.width>0&&view.height>0))return false;
  if(rect.right<=view.left||rect.left>=view.left+view.width||rect.bottom<=view.top||rect.top>=view.top+view.height)return false;
  for(let node=select;node;node=node.parentElement){
   const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
   if(node!==select&&/(auto|scroll|hidden|clip)/.test(style.overflowX+' '+style.overflowY)){
    const clip=node.getBoundingClientRect();
    if(/(auto|scroll|hidden|clip)/.test(style.overflowX)&&(rect.right<=clip.left||rect.left>=clip.right))return false;
    if(/(auto|scroll|hidden|clip)/.test(style.overflowY)&&(rect.bottom<=clip.top||rect.top>=clip.bottom))return false;
   }
  }
  return true;
 }
 function usable(select){return eligible(select)&&!select.matches(':disabled')&&visible(select);}
 function name(select){return select.getAttribute('aria-label')||select.labels?.[0]?.textContent.trim()||select.title||'항목 선택';}
 function snapshot(select){return JSON.stringify([...select.children].map(child=>child instanceof HTMLOptGroupElement?[child.label,child.disabled,child.hidden,[...child.children].map(option=>[option.value,option.label,option.disabled,option.hidden])]:[child.value,child.label,child.disabled,child.hidden]));}
 function close({restore=false}={}){
  const previous=active;if(!previous)return;
  active=null;cancelAnimationFrame(watcher);watcher=0;
  if(menu){try{if(canPopover&&menu.matches(':popover-open'))menu.hidePopover();}catch{}menu.hidden=true;}
  if(restore&&usable(previous.select))previous.select.focus({preventScroll:true});
  window.SnoteMobilePopupHistory?.refresh();
 }
 function build(){
  if(menu)return;
  menu=document.createElement('div');menu.id='snote-dropdown-menu';menu.className='snote-dropdown-menu';menu.hidden=true;
  menu.setAttribute('role','dialog');menu.setAttribute('aria-label','항목 선택');if(canPopover)menu.setAttribute('popover','manual');
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.tabIndex=-1;dismiss.className='snote-dropdown-dismiss';dismiss.setAttribute('aria-label','선택 메뉴 닫기');dismiss.textContent='닫기';dismiss.addEventListener('click',()=>close({restore:true}));
  list=document.createElement('div');list.id='snote-dropdown-list';list.className='snote-dropdown-list';list.tabIndex=-1;list.setAttribute('role','listbox');
  menu.append(dismiss,list);menu.addEventListener('click',event=>event.stopPropagation());
  list.addEventListener('compositionstart',nativeFallback);
 }
 function highlight(index){
  if(!active||index<0||active.items[index]?.disabled)return;
  active.index=index;
  active.items.forEach((item,i)=>item.node.classList.toggle('is-active',i===index));
  set(list,'aria-activedescendant',active.items[index].node.id);active.items[index].node.scrollIntoView({block:'nearest'});
 }
 function place(){
  if(!active)return;
  const {select}=active;if(!usable(select)){close();return;}
  const rect=select.getBoundingClientRect(),view=viewport(),edge=10,gap=6;
  const width=Math.max(0,Math.min(Math.max(rect.width,184),Math.min(420,view.width-edge*2)));
  const below=view.top+view.height-rect.bottom-gap-edge,above=rect.top-view.top-gap-edge;
  const height=Math.max(48,Math.min(360,Math.max(below,above)));
  paint('--snote-dropdown-width',width+'px');paint('--snote-dropdown-height',height+'px');
  const measured=menu.getBoundingClientRect().height||height,down=below>=measured||below>=above;
  const top=Math.max(view.top+edge,Math.min(down?rect.bottom+gap:rect.top-measured-gap,view.top+view.height-measured-edge));
  const left=Math.max(view.left+edge,Math.min(rect.left,view.left+view.width-width-edge));
  paint('--snote-dropdown-left',left+'px');paint('--snote-dropdown-top',top+'px');
 }
 function watch(now){
  if(!active)return;
  if(now-watchTime>=100){
   watchTime=now;
   if(active.selectedIndex!==active.select.selectedIndex){close();return;}
   place();
  }
  if(active)watcher=requestAnimationFrame(watch);
 }
 function open(select,key){
  if(!usable(select))return false;
  if(active?.select===select){if(key==='Home')highlight(active.items.findIndex(item=>!item.disabled));else if(key==='End')highlight(lastEnabled(active));return true;}
  close();window.SnoteStatusMenu?.close();select.focus({preventScroll:true});if(!usable(select))return false;build();list.replaceChildren();
  const items=[],appendOption=(option,parent)=>{
   if(!(option instanceof HTMLOptionElement)||option.hidden||option.parentElement?.hidden||getComputedStyle(option).display==='none')return;
   const node=document.createElement('div'),text=document.createElement('span'),check=document.createElement('span');
   node.className='snote-dropdown-option';node.id='snote-dropdown-option-'+(++serial);node.setAttribute('role','option');
   const disabled=option.matches(':disabled'),selected=option.index===select.selectedIndex;
   set(node,'aria-selected',selected);set(node,'aria-disabled',disabled);
   if(selected)node.classList.add('is-selected');if(disabled)node.classList.add('is-disabled');
   text.textContent=option.label;check.className='snote-dropdown-check';check.setAttribute('aria-hidden','true');node.append(text,check);
   const index=items.length;
   node.addEventListener('pointerdown',event=>event.preventDefault());node.addEventListener('pointermove',()=>highlight(index));
   node.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();choose(index);});
   parent.append(node);items.push({node,option,disabled});
  };
  for(const child of select.children){
   if(child instanceof HTMLOptGroupElement){
    if(child.hidden||getComputedStyle(child).display==='none')continue;
    const group=document.createElement('div'),heading=document.createElement('div');group.className='snote-dropdown-group';group.setAttribute('role','group');set(group,'aria-label',child.label);
    heading.className='snote-dropdown-group-label';heading.setAttribute('aria-hidden','true');heading.textContent=child.label;group.append(heading);
    for(const option of child.children)appendOption(option,group);
    if(group.children.length>1)list.append(group);
   }else appendOption(child,list);
  }
  if(!items.length)return false;
  const host=select.closest('dialog[open]')||document.body;if(menu.parentElement!==host)host.append(menu);
  active={select,items,index:-1,selectedIndex:select.selectedIndex,snapshot:snapshot(select),buffer:'',typedAt:0};
  set(menu,'aria-label',name(select));set(list,'aria-label',name(select));menu.hidden=false;
  if(canPopover){menu.setAttribute('popover','manual');try{menu.showPopover({source:select});}catch{menu.removeAttribute('popover');}}
  place();if(!active)return false;
  const first=items.findIndex(item=>!item.disabled),selected=items.findIndex(item=>item.option.index===select.selectedIndex&&!item.disabled);
  highlight(key==='End'?lastEnabled(active):key==='Home'?first:selected>=0?selected:first);
  list.focus({preventScroll:true});watchTime=0;watcher=requestAnimationFrame(watch);window.SnoteMobilePopupHistory?.refresh();return true;
 }
 function lastEnabled(state){for(let index=state.items.length-1;index>=0;index--)if(!state.items[index].disabled)return index;return -1;}
 function choose(index){
  const state=active,item=state?.items[index];if(!state||!item||item.disabled)return;
  const {select}=state;
  if(!usable(select)||snapshot(select)!==state.snapshot||!Array.from(select.options).includes(item.option)||item.option.matches(':disabled')){close();return;}
  const changed=select.selectedIndex!==item.option.index;
  close({restore:true});
  if(changed){select.selectedIndex=item.option.index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
 }
 function typeahead(key){
  if(!active)return;
  const now=performance.now(),state=active,text=key.toLocaleLowerCase();
  state.buffer=now-state.typedAt>700?text:state.buffer+text;state.typedAt=now;
  const repeated=[...state.buffer].every(char=>char===text),prefix=repeated?text:state.buffer;
  const start=repeated?state.index+1:Math.max(0,state.index);
  for(let offset=0;offset<state.items.length;offset++){
   const index=(start+offset)%state.items.length,item=state.items[index];
   if(!item.disabled&&item.option.label.trim().toLocaleLowerCase().startsWith(prefix)){highlight(index);break;}
  }
 }
 function nativeFallback(){
  const select=active?.select;if(!select)return;
  close({restore:true});try{select.showPicker?.();}catch{}
 }
 function scan(){
  queued=false;
  for(const select of document.querySelectorAll('select')){
   const decorate=eligible(select);if(select.classList.contains('snote-dropdown-select')!==decorate)select.classList.toggle('snote-dropdown-select',decorate);
  }
  if(active){if(!usable(active.select)||snapshot(active.select)!==active.snapshot)close();else place();}
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(scan);}
 function sourceFor(event){const node=event.target;return node instanceof HTMLSelectElement&&usable(node)?node:null;}
 function pointer(event){
  if(event.button!==0)return;
  const select=sourceFor(event);
  if(select){event.preventDefault();if(active?.select!==select)open(select);return;}
  if(active&&!menu.contains(event.target))close();
 }
 document.addEventListener('pointerdown',pointer,true);
 // mousedown also covers browsers whose select picker opens after pointerdown.
 document.addEventListener('mousedown',event=>{const select=sourceFor(event);if(select&&event.button===0){event.preventDefault();if(active?.select!==select)open(select);}},true);
 document.addEventListener('click',event=>{
  const select=sourceFor(event);
  if(select){event.preventDefault();if(active?.select!==select)open(select);}
  else if(active&&!menu.contains(event.target))close();
 },true);
 window.addEventListener('keydown',event=>{
  const inside=active&&(menu.contains(event.target)||event.target===active.select),select=sourceFor(event);
  if(inside){
   if(event.isComposing||event.key==='Process'||event.keyCode===229){nativeFallback();return;}
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close({restore:true});return;}
   if(event.key==='Tab'){close({restore:true});return;}
   if(event.altKey&&event.key==='ArrowUp'){event.preventDefault();event.stopImmediatePropagation();close({restore:true});return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();event.stopPropagation();const enabled=active.items.map((item,index)=>item.disabled?-1:index).filter(index=>index>=0);if(!enabled.length)return;
    const current=enabled.indexOf(active.index),next=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[(current+(event.key==='ArrowUp'?-1:1)+enabled.length)%enabled.length];highlight(next);return;
   }
   if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();choose(active.index);return;}
   if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopPropagation();typeahead(event.key);}
   return;
  }
  if(!select||event.isComposing||event.key==='Process'||event.keyCode===229||composing)return;
  if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
   event.preventDefault();event.stopPropagation();open(select,event.key);return;
  }
  if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&/^[\x20-\x7e]$/.test(event.key)){
   event.preventDefault();event.stopPropagation();if(open(select))typeahead(event.key);
  }
 },true);
 document.addEventListener('compositionstart',()=>{composing=true;},true);document.addEventListener('compositionend',()=>{composing=false;},true);
 document.addEventListener('focusin',event=>{if(active&&event.target!==active.select&&!menu.contains(event.target))close();},true);
 document.addEventListener('change',event=>{if(active?.select===event.target)close();},true);
 addEventListener('scroll',()=>{if(active)place();},true);addEventListener('resize',()=>{if(active)place();});
 window.visualViewport?.addEventListener('resize',()=>{if(active)place();});window.visualViewport?.addEventListener('scroll',()=>{if(active)place();});
 for(const event of ['snote:auth-reset','snote:route-changed','pagehide','beforeprint'])addEventListener(event,()=>close());
 const observer=new MutationObserver(records=>{if(records.some(record=>!menu?.contains(record.target)))schedule();});
 observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','disabled','selected','label','value','size','multiple','aria-hidden','inert']});
 window.SnoteDropdownMenu=Object.freeze({close:()=>close(),refresh:schedule,get current(){return active?.select||null;}});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
})();
