/* Compact mobile presentation only: existing search, sort and vehicle actions stay intact. */
(()=>{'use strict';
 if(window.SnoteDesignPurchase)return;
 const host=document.getElementById('snote-purchase-overview'),screen=document.getElementById('list-screen');
 if(!host||!screen)return;
 const mobile=matchMedia('(max-width:760px)');let expanded=false,queued=false,identity=null;
 const active=()=>typeof route==='string'&&route==='buy';
 const set=(node,name,value)=>{if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
 function refresh(){
  queued=false;set(screen,'data-design-purchase',String(active()));
  let key=null;try{const context=window.snotePurchaseOverviewBridge?.snapshot?.();key=context?.key||null;}catch{}
  if(identity!==key){identity=key;expanded=false;}
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
 addEventListener('snote:route-changed',()=>{expanded=false;refresh();});addEventListener('snote:auth-reset',()=>{identity=null;expanded=false;refresh();});mobile.addEventListener('change',refresh);
 window.SnoteDesignPurchase=Object.freeze({refresh});refresh();
})();
