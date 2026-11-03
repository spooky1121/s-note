/* Paginate view copies only; source datasets and aggregate totals remain untouched. */
(function(){
 'use strict';
 const states=new Map(),size=20;
 window.snote236Paginate=function(rows,key,signature,hostId,render){
  window.SnoteListSort?.bind(key,render);rows=window.SnoteListSort?.apply(rows,key)||rows;signature+=':sort'+(window.SnoteListSort?.revision(key)||0);
  let state=states.get(key);
  if(!state||state.signature!==signature){state={signature,page:1};states.set(key,state);}
  const pages=Math.max(1,Math.ceil(rows.length/size));state.page=Math.min(state.page,pages);
  const host=document.getElementById(hostId);
  if(host){
   host.replaceChildren();host.hidden=pages<=1;
   if(pages>1){
    const add=(label,page,{current=false,disabled=false,aria=label}={})=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;button.setAttribute('aria-label',aria);if(current)button.setAttribute('aria-current','page');button.addEventListener('click',()=>{state.page=page;render();document.getElementById(hostId)?.scrollIntoView({block:'nearest'});document.getElementById(hostId)?.querySelector('[aria-current=page]')?.focus({preventScroll:true});});host.append(button);};
    const info=document.createElement('span');info.className='snote-page-count';info.textContent=`총 ${rows.length}대 · ${state.page} / ${pages}페이지`;info.setAttribute('role','status');host.append(info);
    add('이전',state.page-1,{disabled:state.page===1});
    const numbers=[...new Set([1,...Array.from({length:5},(_,i)=>state.page+i-2).filter(n=>n>1&&n<pages),pages])].sort((a,b)=>a-b);
    let previous=0;for(const number of numbers){if(number>previous+1){const gap=document.createElement('span');gap.textContent='…';gap.setAttribute('aria-hidden','true');host.append(gap);}add(String(number),number,{current:number===state.page,aria:`${number}페이지`});previous=number;}
    add('다음',state.page+1,{disabled:state.page===pages});
   }
  }
  return rows.slice((state.page-1)*size,state.page*size);
 };
 window.snote236ResetPagination=()=>{states.clear();window.SnoteListSort?.reset();};
})();
