/* Reorder existing controls only. Authentication and persistence belong to the scoped bridge. */
(()=>{'use strict';
 if(window.SnoteWorkspaceReorder)return;
 const controllers=new Set(),mounted=new WeakMap(),models=new Map(),automatic=new Map();
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,ID=/^[a-z][a-z0-9-]{0,63}$/i;
 const SECTIONS=new Set(['sidebar','operator-sidebar','document-types','form-types']);
 const ROUTES=new Set(['dashboard','buy','sell','finance','users','companyBuy','prestock','inventoryFinance','monthly','settings','contractOffice','contractArchive']);
 let active=null,sequence=0,scanQueued=false,noticeTimer=null;
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
 function notice(text){let e=document.getElementById('snote-reorder-notice');if(!e){e=node('div','snote-reorder-notice');e.id='snote-reorder-notice';e.setAttribute('role','status');document.body.append(e);}e.textContent=text;e.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{e.hidden=true;},4500);}
 function cleanIds(value){if(!Array.isArray(value)||value.length>32||value.some(id=>typeof id!=='string'||!ID.test(id)))throw Error('ORDER_FORMAT_INVALID');return [...new Set(value)];}
 function context(options){
  try{
   const bridge=window.snoteWorkspaceOrderBridge,raw=typeof options.context==='function'?options.context():bridge?.context?.()||window.snoteOperatorWorkspaceOrderContext?.();
   const actorId=raw?.actorId||raw?.userId,companyId=raw?.companyId??null,role=raw?.role;
   if(raw?.ready!==true||!UUID.test(actorId||'')||!['admin','dealer','accountant','operator'].includes(role)||role==='operator'&&companyId!==null||role!=='operator'&&!UUID.test(companyId||'')||(role==='operator')!==(options.section==='operator-sidebar'))return null;
   if(typeof options.current==='function'&&options.current()!==true||bridge?.current&&bridge.current(raw)!==true)return null;
   const scope=[actorId,companyId||'platform',role].join(':');
   return{raw,bridge,scope,key:typeof raw.key==='string'?raw.key:scope};
  }catch{return null;}
 }
 function same(options,snapshot){const now=context(options);return !!now&&now.scope===snapshot?.scope&&now.key===snapshot.key&&now.bridge===snapshot.bridge;}
 function localKey(ctx,section){return'snote-workspace-order-v1:'+ctx.scope+':'+section;}
 function modelFor(ctx,section){const key=ctx.scope+':'+section;let m=models.get(key);if(!m){m={key,section,order:null,loaded:false,loading:null,version:0,pending:null,saving:false};models.set(key,m);}return m;}
 function updateModel(m,except){for(const c of controllers)if(c!==except&&c.model===m)c.apply();}
 function load(m,ctx,options){
  if(m.loaded||m.loading)return;const version=m.version;
  m.loading=(async()=>{
   try{
    let value;if(ctx.bridge?.read)value=await ctx.bridge.read(ctx.raw,m.section);else{try{value=JSON.parse(localStorage.getItem(localKey(ctx,m.section))||'null');}catch{value=null;}}
    if(!same(options,ctx)||version!==m.version)return;
    m.order=value==null?[]:cleanIds(Array.isArray(value)?value:value.ids);m.loaded=true;updateModel(m);
   }catch{if(same(options,ctx)&&version===m.version){m.loaded=true;notice('메뉴 순서를 불러오지 못했습니다. 다시 접속해 주세요.');}}
   finally{m.loading=null;if(!m.loaded)for(const c of controllers)if(c.model===m)queueMicrotask(c.refresh);}
  })();
 }
 async function save(m,ctx,options,ids){
  m.pending={ctx,options,ids:[...ids]};if(m.saving)return;m.saving=true;
  try{while(m.pending){const task=m.pending;m.pending=null;if(!same(task.options,task.ctx))continue;
   try{if(task.ctx.bridge?.save)await task.ctx.bridge.save(task.ctx.raw,m.section,task.ids);else localStorage.setItem(localKey(task.ctx,m.section),JSON.stringify(task.ids));}
   catch{if(same(task.options,task.ctx))notice('순서를 저장하지 못했습니다. 다시 이동해 저장해 주세요.');}
  }}finally{m.saving=false;}
 }
 function mount(options){
  const container=options?.container;if(!(container instanceof Element)||!SECTIONS.has(options.section)||typeof options.id!=='function')throw Error('REORDER_CONFIG_INVALID');
  if(mounted.has(container))return mounted.get(container);
  const tiles=options.mode==='tiles',selector=options.itemSelector||':scope > button',uid='snote-reorder-'+(++sequence),original=new Map();
  let destroyed=false,ctx=null,model=null,editing=false,selected=null,gesture=null,suppressUntil=0,observerQueued=false;
  const motion=new Map(),instructions=node('span','snote-reorder-instructions','길게 눌러 자리를 바꿀 수 있습니다. F2 또는 Alt와 위아래 방향키로 이동하고 Esc 키나 바깥 영역을 눌러 마칩니다.'),status=node('span','snote-reorder-instructions');instructions.id=uid;status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  container.before(instructions,status);container.classList.add('snote-reorder-container');container.dataset.reorderMode=tiles?'tiles':'sidebar';
  function items(){
   let found;try{found=[...container.querySelectorAll(selector)].filter(e=>e.parentElement===container);}catch{return[];}
   const ids=new Set(),duplicates=new Set(),rows=[];
   for(const element of found){let id;try{id=options.id(element);}catch{continue;}if(typeof id!=='string'||!ID.test(id))continue;if(ids.has(id)){duplicates.add(id);continue;}ids.add(id);rows.push({id,element});}
   return rows.filter(row=>!duplicates.has(row.id));
  }
  function getOrder(){return items().map(row=>row.id);}
  function available(){return !destroyed&&container.isConnected&&!!ctx&&same(options,ctx);}
  function paint(){for(const row of items()){row.element.classList.toggle('snote-reorder-selected',editing&&row.id===selected);row.element.classList.toggle('snote-reorder-source',!!gesture?.dragging&&row.id===gesture.id);}}
  function stopMotion(){for(const animation of motion.values())animation.cancel();motion.clear();}
  function applyIds(order,animate=false){
   const rows=items(),map=new Map(rows.map(row=>[row.id,row.element])),ids=[...order.filter(id=>map.has(id)),...rows.map(row=>row.id).filter(id=>!order.includes(id))];
   if(ids.join('|')===rows.map(row=>row.id).join('|'))return;
   const moving=animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches,before=new Map();
   if(moving)for(const row of rows)for(const child of row.element.children)before.set(child,child.getBoundingClientRect());
   stopMotion();
   const focus=document.activeElement,managed=new Set(map.values()),children=[...container.childNodes];let i=0;
   container.replaceChildren(...children.map(child=>managed.has(child)?map.get(ids[i++]):child));
   if(moving)for(const row of rows){if(gesture?.dragging&&row.id===gesture.id)continue;for(const child of row.element.children){const start=before.get(child),end=child.getBoundingClientRect(),dx=start.x-end.x,dy=start.y-end.y;if(Math.abs(dx)+Math.abs(dy)<1||typeof child.animate!=='function')continue;const animation=child.animate([{translate:dx+'px '+dy+'px'},{translate:'0px 0px'}],{duration:220,easing:'cubic-bezier(.2,.8,.25,1)',fill:'both'});animation.id='snote-reorder-shift';motion.set(child,animation);const clear=()=>{if(motion.get(child)===animation)motion.delete(child);};animation.oncancel=clear;animation.onfinish=()=>{clear();animation.cancel();};}}
   if(focus instanceof HTMLElement&&container.contains(focus))focus.focus({preventScroll:true});paint();
  }
  function apply(){if(!available()||editing||gesture)return;if(model?.order)applyIds(model.order);}
  function refresh(){
   if(destroyed)return;if(gesture&&!container.contains(gesture.element))exit(true);const next=context(options);
   if(!next||ctx&&(!same(options,ctx)||ctx.scope!==next.scope)){exit(true);ctx=null;model=null;}
   if(!next){container.classList.remove('snote-reorder-enabled');return;}
   ctx=next;model=modelFor(ctx,options.section);controller.model=model;container.classList.add('snote-reorder-enabled');
   for(const row of items()){
    const e=row.element;if(!original.has(e))original.set(e,{described:e.getAttribute('aria-describedby'),keys:e.getAttribute('aria-keyshortcuts')});
    e.classList.add('snote-reorder-item');e.dataset.reorderItem=row.id;e.setAttribute('aria-describedby',[original.get(e).described,uid].filter(Boolean).join(' '));e.setAttribute('aria-keyshortcuts','F2 Alt+ArrowUp Alt+ArrowDown');
   }
   apply();paint();load(model,ctx,options);
  }
  function enter(id){
   refresh();if(!available()||items().length<2)return false;if(active&&active!==controller)active.exit();active=controller;editing=true;selected=items().some(row=>row.id===id)?id:getOrder()[0];container.classList.add('snote-reorder-edit');status.textContent='자리 편집 중입니다. 방향키로 바꾸고 Esc 키나 바깥 영역을 눌러 마칩니다.';paint();return true;
  }
  function finishGesture(cancel=false,event){
   const g=gesture;if(!g)return;gesture=null;clearTimeout(g.timer);cancelAnimationFrame(g.raf);g.ghost?.remove();
   try{if(container.hasPointerCapture?.(g.pointerId))container.releasePointerCapture(g.pointerId);}catch{}
   if(g.dragging){suppressUntil=performance.now()+650;const originalContext=same(options,g.context)&&container.contains(g.element);if(cancel){if(originalContext)applyIds(g.start,true);}else if(g.moved&&originalContext)commit();}
   paint();if(event&&g.dragging)event.preventDefault();
  }
  function exit(cancel=false){finishGesture(cancel);if(editing)status.textContent='자리 편집을 마쳤습니다.';editing=false;container.classList.remove('snote-reorder-edit');if(active===controller)active=null;paint();apply();}
  function commit(){if(!available())return;const order=getOrder();model.version++;model.loaded=true;model.order=order;updateModel(model,controller);try{options.onReorder?.([...order]);}catch{}void save(model,ctx,options,order);}
  function move(id,delta){refresh();if(!available()||!Number.isInteger(delta))return false;const order=getOrder(),from=order.indexOf(id),to=Math.max(0,Math.min(order.length-1,from+delta));if(from<0||from===to)return false;if(!editing&&!enter(id))return false;selected=id;[order[from],order[to]]=[order[to],order[from]];applyIds(order,true);commit();status.textContent='선택한 항목을 '+(to+1)+'번째 자리로 옮겼습니다.';items().find(row=>row.id===id)?.element.focus({preventScroll:true});paint();return true;}
  function target(event){if(!(event.target instanceof Element))return null;return items().find(row=>row.element===event.target||row.element.contains(event.target))||null;}
  function ghostFor(element){const ghost=node('div','snote-reorder-ghost'),graphic=tiles?(element.querySelector('[data-reorder-graphic],.co-document-shape')||element.querySelector('svg,img')):null,original=graphic||element,copy=original.cloneNode(true),source=[original,...original.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
   for(let i=0;i<clones.length;i++){const e=clones[i],s=getComputedStyle(source[i]);for(const name of[...e.attributes].map(a=>a.name))if(name==='id'||name.startsWith('on')||name==='tabindex')e.removeAttribute(name);
    for(const property of['font','color','display','width','height','min-width','min-height','gap','flex-direction','align-items','justify-content','padding','border-radius','box-sizing','transform'])e.style.setProperty(property,s.getPropertyValue(property),'important');
    if(e instanceof HTMLButtonElement)e.disabled=true;
   }
   const r=element.getBoundingClientRect();if(graphic){const box=graphic.getBoundingClientRect();copy.style.setProperty('position','absolute','important');copy.style.setProperty('left',box.left-r.left+'px','important');copy.style.setProperty('top',box.top-r.top+'px','important');if(graphic.matches('.co-document-shape,[data-reorder-graphic]'))copy.style.setProperty('transform','none','important');}else copy.querySelectorAll('.zc81-dash-lock,.support-unread-badge,.count').forEach(e=>e.remove());
   copy.style.setProperty('margin','0','important');ghost.dataset.reorderGhost=tiles?'graphic':'menu';ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.append(copy);ghost.style.width=r.width+'px';ghost.style.height=r.height+'px';document.body.append(ghost);return ghost;
  }
  function scrollParent(){let e=container.parentElement;while(e&&e!==document.body){const s=getComputedStyle(e);if(/auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+1)return e;e=e.parentElement;}return document.scrollingElement;}
  function dragAt(x,y){
   const g=gesture;if(!g?.dragging||!available())return;g.x=x;g.y=y;g.ghost.style.left=x-g.offsetX+'px';g.ghost.style.top=y-g.offsetY+'px';
   const bounds=container.getBoundingClientRect(),scrollX=container.scrollLeft-g.scrollLeft,scrollY=container.scrollTop-g.scrollTop,position=[x,y,bounds.left,bounds.top,scrollX,scrollY];
   if(g.lastPosition&&position.every((value,index)=>Math.abs(value-g.lastPosition[index])<.5))return;g.lastPosition=position;
   if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return;
   const to=g.slots.findIndex(slot=>{const inset=Math.min(3,slot.width/10,slot.height/10),left=bounds.left+slot.left-scrollX,top=bounds.top+slot.top-scrollY;return x>=left+inset&&x<=left+slot.width-inset&&y>=top+inset&&y<=top+slot.height-inset;});if(to<0||to===g.lastSlot)return;
   g.lastSlot=to;const order=[...g.start];[order[g.from],order[to]]=[order[to],order[g.from]];applyIds(order,true);g.moved=to!==g.from;
  }
  function autoScroll(){const g=gesture;if(!g?.dragging)return;const e=g.scroll,b=e===document.scrollingElement?{top:0,bottom:innerHeight}:e.getBoundingClientRect(),distance=g.y<b.top+28?-9:g.y>b.bottom-28?9:0;if(distance){e.scrollTop+=distance;dragAt(g.x,g.y);}g.raf=requestAnimationFrame(autoScroll);}
  function beginDrag(){
   const g=gesture;if(!g||!available()||!enter(g.id))return;g.dragging=true;g.start=getOrder();g.from=g.start.indexOf(g.id);g.lastSlot=g.from;g.lastPosition=null;const bounds=container.getBoundingClientRect();g.slots=items().map(row=>{const r=row.element.getBoundingClientRect();return{left:r.left-bounds.left,top:r.top-bounds.top,width:r.width,height:r.height};});g.scrollLeft=container.scrollLeft;g.scrollTop=container.scrollTop;const r=g.element.getBoundingClientRect();g.offsetX=Math.min(r.width,Math.max(0,g.x-r.left));g.offsetY=Math.min(r.height,Math.max(0,g.y-r.top));g.ghost=ghostFor(g.element);g.scroll=scrollParent();
   try{container.setPointerCapture(g.pointerId);}catch{}paint();dragAt(g.x,g.y);autoScroll();
  }
  function pointerDown(event){
   if(event.button!==0||!event.isPrimary||gesture)return;const row=target(event);if(!row)return;refresh();if(!available()||items().length<2)return;
   gesture={id:row.id,element:row.element,context:ctx,pointerId:event.pointerId,type:event.pointerType,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,dragging:false,moved:false,timer:null,raf:null,ghost:null};
   if(editing)beginDrag();else if(!tiles||event.pointerType==='touch')gesture.timer=setTimeout(beginDrag,450);
  }
  function pointerMove(event){const g=gesture;if(!g||g.pointerId!==event.pointerId)return;if(!available()){finishGesture(true);return;}g.x=event.clientX;g.y=event.clientY;const distance=Math.hypot(g.x-g.startX,g.y-g.startY);
   if(!g.dragging){if(tiles&&g.type!=='touch'&&distance>=4)beginDrag();else if(distance>=8){finishGesture(true);return;}}
   if(g.dragging){if(event.cancelable)event.preventDefault();dragAt(event.clientX,event.clientY);}
  }
  function pointerUp(event){const g=gesture;if(!g||g.pointerId!==event.pointerId)return;const r=container.getBoundingClientRect(),outside=event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;finishGesture(outside,event);}
  function pointerCancel(event){if(!gesture||gesture.pointerId!==event.pointerId)return;if(gesture.type==='touch'&&gesture.dragging)return;finishGesture(true);}
  function touchMove(event){const g=gesture;if(!g||g.type!=='touch')return;const t=event.touches[0];if(!t)return;if(g.dragging){if(event.cancelable)event.preventDefault();dragAt(t.clientX,t.clientY);}else if(Math.hypot(t.clientX-g.startX,t.clientY-g.startY)>=8)finishGesture(true);}
  function touchEnd(event){if(gesture?.type!=='touch')return;const t=event.changedTouches[0];if(t)pointerUp({pointerId:gesture.pointerId,clientX:t.clientX,clientY:t.clientY,preventDefault(){if(event.cancelable)event.preventDefault();}});}
  function touchCancel(){finishGesture(true);}
  function click(event){const row=target(event);if(!row)return;if(editing||performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();selected=row.id;paint();}}
  function keydown(event){const row=target(event);if(!row)return;if(event.key==='F2'){event.preventDefault();event.stopPropagation();enter(row.id);return;}if((editing||event.altKey)&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();move(row.id,event.key==='ArrowUp'?-1:1);}}
  function contextMenu(event){if(editing||gesture?.type==='touch')event.preventDefault();}
  const observer=new MutationObserver(()=>{if(observerQueued)return;observerQueued=true;queueMicrotask(()=>{observerQueued=false;refresh();});});observer.observe(container,{childList:true});
  container.addEventListener('pointerdown',pointerDown,true);container.addEventListener('click',click,true);container.addEventListener('keydown',keydown,true);container.addEventListener('contextmenu',contextMenu);
  document.addEventListener('pointermove',pointerMove,{capture:true,passive:false});document.addEventListener('pointerup',pointerUp,true);document.addEventListener('pointercancel',pointerCancel,true);document.addEventListener('touchmove',touchMove,{capture:true,passive:false});document.addEventListener('touchend',touchEnd,{capture:true,passive:false});document.addEventListener('touchcancel',touchCancel,true);
  function resized(){if(editing||gesture)exit(true);}window.addEventListener('resize',resized);
  function destroy(){if(destroyed)return;exit(true);stopMotion();destroyed=true;observer.disconnect();controllers.delete(controller);mounted.delete(container);instructions.remove();status.remove();container.classList.remove('snote-reorder-container','snote-reorder-enabled');delete container.dataset.reorderMode;
   for(const[e,attrs]of original){e.classList.remove('snote-reorder-item','snote-reorder-selected','snote-reorder-source');delete e.dataset.reorderItem;for(const[name,value]of[['aria-describedby',attrs.described],['aria-keyshortcuts',attrs.keys]])if(value==null)e.removeAttribute(name);else e.setAttribute(name,value);}
   container.removeEventListener('pointerdown',pointerDown,true);container.removeEventListener('click',click,true);container.removeEventListener('keydown',keydown,true);container.removeEventListener('contextmenu',contextMenu);document.removeEventListener('pointermove',pointerMove,true);document.removeEventListener('pointerup',pointerUp,true);document.removeEventListener('pointercancel',pointerCancel,true);document.removeEventListener('touchmove',touchMove,true);document.removeEventListener('touchend',touchEnd,true);document.removeEventListener('touchcancel',touchCancel,true);
   window.removeEventListener('resize',resized);
  }
  const controller={refresh,destroy,enter,exit,getOrder,move,apply,get model(){return model;},set model(value){model=value;},contains:element=>container.contains(element)};
  mounted.set(container,controller);controllers.add(controller);refresh();return controller;
 }
 function menuId(element){const attr=element.dataset.page||element.dataset.workspaceId||element.dataset.reorderId,match=element.getAttribute('onclick')?.match(/^navigate\('([a-zA-Z]+)'\)$/);const id=attr||match?.[1];return ROUTES.has(id)?id:null;}
 function scan(){scanQueued=false;for(const[id,section,getId]of[['desktop-nav','sidebar',menuId],['mobile-drawer-nav','sidebar',menuId],['operator-navigation','operator-sidebar',e=>['vehicles','accounts','access','support'].includes(e.dataset.view)?e.dataset.view:null]]){
  const element=document.getElementById(id),prior=automatic.get(id);if(prior&&(!element||prior.element!==element)){prior.controller.destroy();automatic.delete(id);}if(!element)continue;
  if(!automatic.has(id)){const controller=mount({container:element,itemSelector:':scope > button',id:getId,section,mode:'sidebar'});automatic.set(id,{element,controller});}else automatic.get(id).controller.refresh();
 }}
 function schedule(){if(scanQueued)return;scanQueued=true;requestAnimationFrame(scan);}
 document.addEventListener('pointerdown',event=>{if(active&&!active.contains(event.target))active.exit();},true);
 window.addEventListener('keydown',event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();active.exit(true);}},true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.exit(true);});window.addEventListener('pagehide',()=>{active?.exit(true);for(const c of controllers)c.destroy();automatic.clear();});
 for(const name of['snote:workspace-order-context','snote:route-changed','snote:company-cars-ready','pageshow'])window.addEventListener(name,schedule);
 new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
 window.SnoteWorkspaceReorder=Object.freeze({mount,refresh:schedule,exit:()=>active?.exit()});
 schedule();window.dispatchEvent(new Event('snote:workspace-reorder-ready'));
})();
