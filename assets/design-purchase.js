/* Compact mobile presentation only: existing search, sort and vehicle actions stay intact. */
(()=>{'use strict';
 if(window.SnoteDesignPurchase)return;
 const host=document.getElementById('snote-purchase-overview'),screen=document.getElementById('list-screen');
 if(!host||!screen)return;
 const mobile=matchMedia('(max-width:760px)');let expanded=false,queued=false,identity=null,toolsOpen=false;
 const origins=new Map();let primaryRow=null,tools=null,toolsRow=null,toolsToggle=null,primaryLabel=null,primaryAttributes=null;
 const active=()=>typeof route==='string'&&route==='buy';
 const set=(node,name,value)=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
 const hide=(node,value)=>{if(node.hidden!==value)node.hidden=value;};
 const popupOpen=()=>[...document.querySelectorAll('dialog[open],.snote-popup-overlay')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
 function closeTools(restoreFocus=false){
  toolsOpen=false;if(tools)hide(tools,true);if(toolsToggle)set(toolsToggle,'aria-expanded','false');
  if(screen.hasAttribute('data-mobile-purchase-tools'))set(screen,'data-mobile-purchase-tools','false');
  if(restoreFocus&&toolsToggle?.isConnected&&!toolsToggle.hidden&&mobile.matches&&active())toolsToggle.focus({preventScroll:true});
 }
 function move(node,parent){
  if(!node||node.parentElement===parent)return;
  if(!origins.has(node)){const marker=document.createComment('purchase toolbar position');node.before(marker);origins.set(node,marker);}
  parent.append(node);
 }
 function restoreTools(){
  closeTools();
  for(const[node,marker]of origins){if(marker.isConnected)marker.replaceWith(node);}
  origins.clear();primaryLabel?.remove();primaryLabel=null;
  const add=document.getElementById('snote92-buy-manual');
  if(add&&primaryAttributes){for(const[name,value]of primaryAttributes){if(value===null)add.removeAttribute(name);else set(add,name,value);}primaryAttributes=null;}
  if(primaryRow)hide(primaryRow,true);if(tools)hide(tools,true);
  screen.removeAttribute('data-mobile-purchase-tools');
 }
 function toolbar(ready=false){
  const panel=screen.querySelector(':scope>.panel');if(!panel)return;
  if(!mobile.matches||!active()||!ready){restoreTools();return;}
  const actions=screen.querySelector('.zc-list-actions.snote-vehicle-actions'),add=document.getElementById('snote92-buy-manual'),slot=add?.closest('.snote-vehicle-add-slot'),view=document.getElementById('snote-vehicle-view-toolbar');
  if(!actions||!slot||!view)return;
  if(!primaryRow){
   primaryRow=document.createElement('div');primaryRow.className='snote-purchase-primary-row';
   toolsToggle=document.createElement('button');toolsToggle.id='snote-purchase-tools-toggle';toolsToggle.type='button';toolsToggle.className='snote-purchase-tools-toggle';toolsToggle.setAttribute('aria-controls','snote-purchase-tools');toolsToggle.setAttribute('aria-label','매입 목록 도구');toolsToggle.dataset.tooltip='등록증·보기·정렬';
   toolsToggle.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
   toolsToggle.addEventListener('click',()=>{toolsOpen=!toolsOpen;refresh();});primaryRow.append(toolsToggle);
   tools=document.createElement('div');tools.id='snote-purchase-tools';tools.className='snote-purchase-tools';tools.setAttribute('role','group');tools.setAttribute('aria-label','매입 목록 보조 도구');
   toolsRow=document.createElement('div');toolsRow.className='snote-purchase-tools-row';tools.append(toolsRow);
  }
  const search=panel.querySelector('#buy-search-host'),list=panel.querySelector('#list-table'),direct=node=>node?.parentElement===panel?node:null;
  if(primaryRow.parentElement!==panel)panel.insertBefore(primaryRow,direct(search)||direct(list));
  if(tools.parentElement!==panel){if(direct(search))search.after(tools);else panel.insertBefore(tools,direct(list));}
  if(!primaryAttributes)primaryAttributes=['aria-label','data-tooltip'].map(name=>[name,add.getAttribute(name)]);
  if(!primaryLabel){primaryLabel=document.createElement('span');primaryLabel.className='snote-purchase-primary-label';primaryLabel.textContent='차량 등록';add.append(primaryLabel);}
  set(add,'aria-label','+ 차량 등록');set(add,'data-tooltip','+ 차량 등록');
  move(slot,primaryRow);if(primaryRow.lastElementChild!==toolsToggle)primaryRow.append(toolsToggle);
  move(actions,toolsRow);move(view,toolsRow);
  // Sort redraws reuse this same control even while it is nested in the disclosure.
  const sort=[...panel.querySelectorAll('.snote-mobile-sort')].find(node=>node.dataset.sortTable==='vehicles:buy');
  if(sort)move(sort,tools);
  hide(primaryRow,false);hide(tools,!toolsOpen);set(toolsToggle,'aria-expanded',String(toolsOpen));
  set(screen,'data-mobile-purchase-tools',String(toolsOpen));
 }
 function refresh(){
  queued=false;set(screen,'data-design-purchase',String(active()));
  let key=null,ready=false;try{const context=window.snotePurchaseOverviewBridge?.snapshot?.();key=context?.key||null;ready=!!context&&context.loading===false;}catch{}
  if(identity!==key){identity=key;expanded=false;closeTools();}
  toolbar(ready);
  const heading=host.querySelector('.sales-overview-head'),body=host.querySelector('.sales-overview-body');
  if(!active()||host.dataset.state!=='ready'||!heading||!body)return;
  let summary=heading.querySelector('.snote-purchase-brief'),toggle=heading.querySelector('.snote-purchase-overview-toggle');
  if(!summary){summary=document.createElement('span');summary.className='snote-purchase-brief';heading.append(summary);}
  if(!toggle){
   toggle=document.createElement('button');toggle.type='button';toggle.className='snote-purchase-overview-toggle';toggle.id='snote-purchase-overview-toggle';
   toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
   toggle.addEventListener('click',()=>{expanded=!expanded;refresh();});heading.append(toggle);
  }
  const values=host.querySelectorAll('.sales-overview-metric dd'),text='이번 달 '+(values[0]?.textContent||'0대')+' · 전월 '+(values[1]?.textContent||'0대');
  if(summary.textContent!==text)summary.textContent=text;
  set(body,'id','snote-purchase-overview-details');set(toggle,'aria-controls',body.id);
  set(toggle,'aria-expanded',String(!mobile.matches||expanded));set(toggle,'aria-label',expanded?'매입 현황 접기':'매입 현황 펼치기');
  set(host,'data-design-purchase-expanded',String(expanded));
 }
 function schedule(){if(!queued){queued=true;queueMicrotask(refresh);}}
 new MutationObserver(schedule).observe(host,{childList:true,subtree:true,characterData:true});
 const panel=screen.querySelector(':scope>.panel');if(panel)new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.tagName==='TABLE'||node.tagName==='TH'||node.matches?.('.snote-mobile-sort')||node.querySelector?.('table,.snote-mobile-sort')))))schedule();}).observe(panel,{childList:true,subtree:true});
 document.addEventListener('keydown',event=>{if(!event.defaultPrevented&&event.key==='Escape'&&toolsOpen&&!popupOpen()){event.preventDefault();closeTools(true);}});
 document.addEventListener('pointerdown',event=>{if(toolsOpen&&!popupOpen()&&!tools?.contains(event.target)&&!toolsToggle?.contains(event.target))closeTools();});
 addEventListener('snote:route-changed',()=>{expanded=false;closeTools();refresh();});addEventListener('snote:auth-reset',()=>{identity=null;expanded=false;closeTools();refresh();});mobile.addEventListener('change',()=>{closeTools();refresh();});
 window.SnoteDesignPurchase=Object.freeze({refresh});refresh();
})();
