/* Native vehicle status selects remain the source of truth and keep every existing change guard. */
(()=>{
 'use strict';
 if(window.SnoteStatusMenu)return;
 const selector='select.status-select,select#list-filter',records=new Map();
 let menu=null,list=null,active=null,serial=0,queued=false,observer=null,resizeObserver=null;
 const tones={'판매중':'onsale','계약중':'contract','판매완료':'done','수리중':'pending'};
 const set=(node,name,value)=>{if(node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));};
 const tone=value=>tones[value]||'neutral';
 function available(select,forDisplay=false){
  // A loading/fade gate reserves the final control geometry while still
  // blocking every interaction through the ordinary, strict check below.
  const reserve=forDisplay&&!!select.closest('#list-screen.snote-received-list-pending,main.content[data-route-transition]');
  if(!select.isConnected||select.hidden||select.closest('[hidden]')||!reserve&&select.closest('[inert]'))return false;
  for(let node=select;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||!reserve&&(style.visibility==='hidden'||style.visibility==='collapse'))return false;}
  return true;
 }
 function focusTrigger(record){if(record?.button.isConnected&&!record.button.hidden&&!record.button.disabled)record.button.focus({preventScroll:true});}
 function close(options={}){
  const previous=active;if(!previous)return;
  active=null;set(previous.record.button,'aria-expanded','false');
  if(menu){try{if(menu.matches(':popover-open'))menu.hidePopover();}catch{}menu.hidden=true;}
  resizeObserver?.disconnect();
  if(options.restore)focusTrigger(previous.record);
  window.SnoteMobilePopupHistory?.refresh();
 }
 function sync(record){
  const {select,button,label}=record;
  if(!select.isConnected){if(active?.record===record)close();button.remove();records.delete(select);return;}
  const selected=select.options[select.selectedIndex],text=selected?.label||selected?.textContent||'';
  if(label.textContent!==text)label.textContent=text;
  set(button,'data-snote-status-tone',tone(select.value));
  const classes=[...select.classList].filter(name=>name!=='snote-status-native');
  const nextClass=[...classes,'snote-status-trigger'].join(' ');
  if(button.className!==nextClass)button.className=nextClass;
  const column=select.getAttribute('data-purchase-column');
  if(column!==null)set(button,'data-purchase-column',column);else if(button.hasAttribute('data-purchase-column'))button.removeAttribute('data-purchase-column');
  const name=select.getAttribute('aria-label')||[...select.labels||[]].map(node=>node.textContent.trim()).join(' ')||'차량 상태';
  set(button,'aria-label',name+' · '+text);set(button,'title',select.title||name);
  if(button.disabled!==select.disabled)button.disabled=select.disabled;
  const hidden=!available(select,true);if(button.hidden!==hidden)button.hidden=hidden;
  if(active?.record===record&&(!available(select)||select.disabled||record.signature!==signature(select)))close();
 }
 function signature(select){return JSON.stringify([...select.options].map(option=>[option.value,option.label,option.disabled,option.hidden,option.parentElement?.disabled]));}
 function enhance(select){
  if(records.has(select))return;
  if(select.multiple||select.size>1||![...select.options].some(option=>Object.hasOwn(tones,option.value)))return;
  const button=document.createElement('button'),label=document.createElement('span'),chevron=document.createElement('span');
  button.type='button';label.className='snote-status-label';chevron.className='snote-status-chevron';chevron.setAttribute('aria-hidden','true');
  button.append(label,chevron);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const record={select,button,label,signature:signature(select),tabindex:select.getAttribute('tabindex'),ariaHidden:select.getAttribute('aria-hidden')};
  records.set(select,record);select.classList.add('snote-status-native');select.setAttribute('tabindex','-1');select.setAttribute('aria-hidden','true');
  select.after(button);sync(record);
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(active?.record===record)close({restore:true});else open(record);});
  button.addEventListener('keydown',event=>{
   event.stopPropagation();
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(record,event.key);}
   else if(event.key==='Escape'&&active?.record===record){event.preventDefault();close({restore:true});}
  });
  button.addEventListener('focus',()=>sync(record));
 }
 function createMenu(){
  if(menu)return;
  menu=document.createElement('div');menu.id='snote-status-menu';menu.className='snote-status-menu';menu.hidden=true;
  menu.setAttribute('role','dialog');menu.setAttribute('aria-label','차량 상태 선택');
  if(typeof menu.showPopover==='function')menu.setAttribute('popover','manual');
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.tabIndex=-1;dismiss.className='snote-status-dismiss';dismiss.setAttribute('aria-label','상태 선택 닫기');dismiss.textContent='닫기';dismiss.addEventListener('click',()=>close({restore:true}));
  list=document.createElement('div');list.className='snote-status-list';list.setAttribute('role','listbox');list.tabIndex=-1;
  menu.append(dismiss,list);document.body.append(menu);
  menu.addEventListener('click',event=>event.stopPropagation());
  list.addEventListener('keydown',event=>{
   if(!active)return;
   const keys=['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape','Tab'];if(!keys.includes(event.key))return;
   event.stopPropagation();
   if(event.key==='Tab'){close({restore:true});return;}
   event.preventDefault();
   if(event.key==='Escape'){close({restore:true});return;}
   if(event.key==='Enter'||event.key===' '){choose(active.index);return;}
   const enabled=active.items.map((item,index)=>item.disabled?-1:index).filter(index=>index>=0);if(!enabled.length)return;
   const current=enabled.indexOf(active.index),next=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[(current+(event.key==='ArrowUp'?-1:1)+enabled.length)%enabled.length];
   highlight(next);
  });
 }
 function highlight(index){
  if(!active||index<0||active.items[index]?.disabled)return;
  active.index=index;
  active.items.forEach((item,i)=>item.node.classList.toggle('is-active',i===index));
  set(list,'aria-activedescendant',active.items[index].node.id);active.items[index].node.scrollIntoView({block:'nearest'});
 }
 function position(){
  if(!active)return;
  const {record}=active;if(!available(record.select)||!record.button.getClientRects().length){close();return;}
  const rect=record.button.getBoundingClientRect(),viewport=window.visualViewport;
  const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
  const edge=10,gap=6,spaceBelow=top+height-rect.bottom-gap-edge,spaceAbove=rect.top-top-gap-edge;
  const maxHeight=Math.min(340,Math.max(spaceBelow,spaceAbove,80)),menuWidth=Math.min(Math.max(rect.width,184),width-edge*2);
  menu.style.setProperty('--snote-status-width',menuWidth+'px');menu.style.setProperty('--snote-status-max-height',maxHeight+'px');
  const measured=menu.getBoundingClientRect().height||Math.min(active.items.length*42+16,maxHeight),below=spaceBelow>=measured||spaceBelow>=spaceAbove;
  const y=Math.max(top+edge,Math.min(below?rect.bottom+gap:rect.top-gap-measured,top+height-measured-edge));
  const x=Math.max(left+edge,Math.min(rect.right-menuWidth,left+width-menuWidth-edge));
  menu.style.setProperty('--snote-status-left',x+'px');menu.style.setProperty('--snote-status-top',y+'px');
 }
 function open(record,key){
  sync(record);if(record.button.disabled||record.button.hidden||!available(record.select))return;
  if(active?.record===record){if(key==='Home')highlight(active.items.findIndex(item=>!item.disabled));else if(key==='End')highlight(active.items.findLastIndex(item=>!item.disabled));return;}
  close();createMenu();list.replaceChildren();
  record.signature=signature(record.select);const items=[];
  for(const option of record.select.options){
   if(option.hidden||option.parentElement?.hidden)continue;
   const node=document.createElement('div'),text=document.createElement('span'),check=document.createElement('span');
   node.id='snote-status-option-'+(++serial);node.className='snote-status-option';node.setAttribute('role','option');
   const selected=option.selected,disabled=option.disabled||!!option.parentElement?.disabled;
   node.setAttribute('aria-selected',String(selected));node.setAttribute('aria-disabled',String(disabled));node.dataset.snoteStatusTone=tone(option.value);
   if(selected)node.classList.add('is-selected');if(disabled)node.classList.add('is-disabled');
   if(/취소/.test(option.value))node.classList.add('is-cancel');
   text.textContent=option.label;check.className='snote-status-check';check.setAttribute('aria-hidden','true');node.append(text,check);
   const index=items.length;node.addEventListener('pointerdown',event=>event.preventDefault());node.addEventListener('pointermove',()=>highlight(index));node.addEventListener('click',event=>{event.preventDefault();choose(index);});
   list.append(node);items.push({node,option,disabled});
  }
  if(!items.length)return;
  active={record,items,index:-1};set(record.button,'aria-expanded','true');set(record.button,'aria-controls','snote-status-list');list.id='snote-status-list';
  set(list,'aria-label',record.select.getAttribute('aria-label')||'차량 상태');menu.hidden=false;
  try{if(menu.hasAttribute('popover'))menu.showPopover();}catch{menu.removeAttribute('popover');}
  position();
  if(!active)return;
  const selected=items.findIndex(item=>item.option.selected&&!item.disabled),first=items.findIndex(item=>!item.disabled);
  highlight(key==='End'?items.findLastIndex(item=>!item.disabled):key==='Home'?first:selected>=0?selected:first);
  list.focus({preventScroll:true});
  if(typeof ResizeObserver==='function'){resizeObserver??=new ResizeObserver(position);resizeObserver.observe(record.button);}
  window.SnoteMobilePopupHistory?.refresh();
 }
 function choose(index){
  const job=active,item=job?.items[index];if(!job||!item||item.disabled)return;
  const {record}=job,{select}=record;
  if(select.disabled||!available(select)||signature(select)!==record.signature||!Array.from(select.options).includes(item.option)){close();return;}
  const next=item.option.value,changed=select.value!==next;
  close({restore:true});
  if(changed){select.value=next;select.dispatchEvent(new Event('change',{bubbles:true}));}
  // The existing confirmation handler immediately restores the original value.
  // Never display an optimistic state before that handler confirms and saves it.
  sync(record);queueMicrotask(()=>{if(select.isConnected)sync(record);});
 }
 function refresh(){
  queued=false;if(!document.body)return;
  for(const select of document.querySelectorAll(selector))enhance(select);
  for(const record of records.values())sync(record);
  if(active)position();
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(refresh);}
 function init(){
  if(observer)return;refresh();
  observer=new MutationObserver(records=>{if(records.some(record=>!menu?.contains(record.target)))schedule();});
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','disabled','selected','aria-label','data-purchase-column','inert']});
  document.addEventListener('change',event=>{const record=records.get(event.target);if(record)queueMicrotask(()=>sync(record));},true);
  document.addEventListener('pointerdown',event=>{if(active&&!menu.contains(event.target)&&!active.record.button.contains(event.target))close();},true);
  document.addEventListener('focusin',event=>{if(active&&!menu.contains(event.target)&&event.target!==active.record.button)close();},true);
  // Capture Escape before the page's vehicle-popup handler receives it.
  window.addEventListener('keydown',event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close({restore:true});}},true);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',()=>{if(active)position();},true);
  window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',()=>{if(active)position();});
  for(const event of ['snote:auth-reset','snote:route-changed','pagehide'])window.addEventListener(event,()=>close());
  window.addEventListener('beforeprint',()=>{close();refresh();});
 }
 window.SnoteStatusMenu=Object.freeze({refresh:schedule,close:()=>close()});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
