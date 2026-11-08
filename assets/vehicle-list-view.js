/* Switch the existing paginated vehicle views without reloading or copying data. */
(() => {
 'use strict';
 const screen=document.getElementById('list-screen'),table=document.getElementById('list-table');
 if(!screen||!table||document.getElementById('snote-vehicle-view-toolbar'))return;
 const key='snote:vehicle-list-view:v1',choices=['list','cards'];
 const toolbar=document.createElement('div');toolbar.id='snote-vehicle-view-toolbar';toolbar.className='snote-vehicle-view-toolbar';
 const group=document.createElement('div');group.className='snote-vehicle-view-toggle';group.setAttribute('role','group');group.setAttribute('aria-label','차량 보기 방식');
 const icons={list:'<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',cards:'<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.2"/>'};
 const buttons=choices.map(mode=>{
  const button=document.createElement('button'),label=mode==='cards'?'카드 보기':'목록 보기';
  button.type='button';button.className='snote-list-action snote-vehicle-view-button';button.dataset.vehicleViewChoice=mode;button.dataset.tooltip=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed','false');
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[mode]+'</svg>';
  button.addEventListener('click',()=>apply(mode,true));group.append(button);return button;
 });
 toolbar.append(group);
 const actions=screen.querySelector('.zc-list-actions');
 if(actions){
  const headingActions=document.createElement('div');headingActions.className='snote-vehicle-heading-actions';
  actions.before(headingActions);const count=document.getElementById('snote-vehicle-count');if(count)headingActions.append(count);headingActions.append(actions,toolbar);actions.classList.add('snote-vehicle-actions');
  const add=actions.querySelector('#snote92-buy-manual');
  if(add){const slot=document.createElement('span');slot.className='snote-vehicle-add-slot';add.before(slot);slot.append(add);}
 }else table.before(toolbar);
 function apply(mode,persist=false){
  if(!choices.includes(mode))mode='list';
  screen.dataset.vehicleView=mode;
  buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.vehicleViewChoice===mode)));
  if(persist)try{localStorage.setItem(key,mode);}catch{}
 }
 group.addEventListener('keydown',event=>{
  const index=buttons.indexOf(event.target);if(index<0)return;
  let target;
  if(event.key==='ArrowLeft')target=(index+choices.length-1)%choices.length;
  else if(event.key==='ArrowRight')target=(index+1)%choices.length;
  else if(event.key==='Home')target=0;
  else if(event.key==='End')target=choices.length-1;
  else return;
  event.preventDefault();apply(choices[target],true);buttons[target].focus({preventScroll:true});
 });
 let saved='list';try{saved=localStorage.getItem(key);}catch{}
 apply(saved);
})();
