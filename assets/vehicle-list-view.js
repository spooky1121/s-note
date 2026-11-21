/* Switch the existing paginated vehicle views without reloading or copying data. */
(() => {
 'use strict';
 const screen=document.getElementById('list-screen'),table=document.getElementById('list-table');
 if(!screen||!table||document.getElementById('snote-vehicle-view-toolbar'))return;
 const key='snote:vehicle-list-view:v1',mobileKey='snote:vehicle-list-view:v2:mobile',choices=['list','cards'],mobile=window.matchMedia('(max-width:760px)');
 const preferenceKey=()=>mobile.matches?mobileKey:key;
 const defaultMode=()=>mobile.matches?'cards':'list';
 function preferred(){try{const saved=localStorage.getItem(preferenceKey());return choices.includes(saved)?saved:defaultMode();}catch{return defaultMode();}}
 const toolbar=document.createElement('div');toolbar.id='snote-vehicle-view-toolbar';toolbar.className='snote-vehicle-view-toolbar';
 const group=document.createElement('div');group.className='snote-vehicle-view-toggle';
 const icons={list:'<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',cards:'<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.2"/>'};
 const button=document.createElement('button');button.id='snote-vehicle-view-switch';button.type='button';button.className='snote-list-action snote-vehicle-view-button';button.setAttribute('aria-controls','list-table list-mobile');
 button.addEventListener('click',()=>apply(screen.dataset.vehicleView==='cards'?'list':'cards',true));group.append(button);
 toolbar.append(group);
 const actions=screen.querySelector('.zc-list-actions');
 if(actions){
  const headingActions=document.createElement('div');headingActions.className='snote-vehicle-heading-actions';
  actions.before(headingActions);headingActions.append(actions,toolbar);actions.classList.add('snote-vehicle-actions');
  const title=document.getElementById('list-title'),count=document.getElementById('snote-vehicle-count');
  if(title&&count){const titleLine=document.createElement('div');titleLine.className='snote-vehicle-title-with-count';title.before(titleLine);titleLine.append(title,count);}
  const add=actions.querySelector('#snote92-buy-manual');
  if(add){const slot=document.createElement('span');slot.className='snote-vehicle-add-slot';add.before(slot);slot.append(add);}
 }else table.before(toolbar);
 function apply(mode,persist=false){
  if(!choices.includes(mode))mode=defaultMode();
  screen.dataset.vehicleView=mode;
  const current=mode==='cards'?'카드형':'목록형',next=mode==='cards'?'목록형':'카드형',label='현재 '+current+' · '+next+'으로 전환';
  button.dataset.vehicleView=mode;button.dataset.tooltip=label;button.setAttribute('aria-label',label);
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[mode]+'</svg>';
  if(persist)try{localStorage.setItem(preferenceKey(),mode);}catch{}
 }
 apply(preferred());
 mobile.addEventListener('change',()=>apply(preferred()));
})();
