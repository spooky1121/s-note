/* Shared vehicle identity stays server-scoped; markers never change vehicle data. */
(()=>{'use strict';if(window.snoteSharedVehicleMarkers)return;window.snoteSharedVehicleMarkers=true;
 const bridge=()=>window.snoteVehicleShareBridge;
 const context=()=>{const b=bridge();return b?.badgeContext?b.badgeContext():b?.context?.();};
 const current=c=>{const b=bridge();return !!c&&(b?.badgeCurrent?b.badgeCurrent(c):b?.current?.(c));};
 const inSales=()=>typeof route==='string'&&route==='sell';
 const symbol='<svg class="snote-shared-vehicle-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
 let account=null,epoch=0,shared=new Set(),job=null,queued=false,last=0,scheduled=false;
 const key=(owner,id)=>owner+'\n'+id;
 function mark(target,on,kind){if(!target)return;let marker=target.querySelector(':scope > .snote-shared-vehicle-marker');if(!on){marker?.remove();return;}if(marker)return;marker=document.createElement('span');marker.className='snote-shared-vehicle-marker snote-shared-vehicle-marker--'+kind;marker.setAttribute('role','img');marker.setAttribute('aria-label','공유 차량');marker.dataset.tooltip='공유 차량';marker.innerHTML=symbol;target.append(marker);}
 function carFor(id){if(typeof cars==='undefined'||!id)return null;const matches=cars.filter(car=>String(car.id)===id);return matches.length===1?matches[0]:null;}
 function isShared(car){if(!car)return false;const owner=bridge()?.owner?.(car);return !!owner&&shared.has(key(owner,String(car.id)));}
 function rowId(row){const value=(row.getAttribute('onclick')||'').trim();const match=/^openVehicle\((['"])([^'"\\]+)\1\);?$/.exec(value);return match?.[2]||null;}
 function render(){scheduled=false;const c=context(),valid=current(c)&&account===c?.key,showIcons=!inSales();for(const row of document.querySelectorAll('#list-table tr.vehicle-clickable,#list-mobile .vehicle-card,#list-mobile .acct-mobile-card')){const on=valid&&isShared(carFor(rowId(row)));row.classList.toggle('is-shared-vehicle',on);mark(row.querySelector('.car-thumb'),showIcons&&on,'photo');}
 mark(document.getElementById('vehicle-title'),showIcons&&valid&&isShared(carFor(typeof activeCarId==='undefined'?null:String(activeCarId))),'title');
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(render);}}
 function reset(next){account=next;epoch++;shared.clear();last=0;schedule();}
 async function refresh(force=false){const c=context(),next=c?.key||null;if(next!==account)reset(next);if(!c||!current(c)||typeof bridge()?.badges!=='function'){shared.clear();schedule();return;}
 if(force){epoch++;shared.clear();schedule();}
 if(job){if(force||job.key!==next)queued=true;return;}if(!force&&Date.now()-last<30000)return;
 const run={epoch,key:next};job=run;try{const rows=await bridge().badges(c);if(run.epoch!==epoch||account!==next||!current(c))return;shared=new Set((Array.isArray(rows)?rows:[]).filter(r=>r?.state==='accepted'&&typeof r.ownerId==='string'&&typeof r.carId==='string').map(r=>key(r.ownerId,r.carId)));last=Date.now();schedule();}catch{if(run.epoch===epoch&&account===next){shared.clear();last=Date.now();schedule();}}finally{if(job===run)job=null;if(queued){queued=false;refresh(true);}}
 }
 new MutationObserver(records=>{if(records.some(record=>record.target.id==='vehicle-title'||!record.target.closest?.('.snote-shared-vehicle-marker')&&[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.classList?.contains('snote-shared-vehicle-marker'))))schedule();}).observe(document.body,{subtree:true,childList:true});
 window.addEventListener('snote:route-changed',schedule);window.addEventListener('snote-vehicle-sharing-updated',()=>refresh(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});setInterval(()=>{const next=context()?.key||null;if(next!==account){reset(next);refresh();}},1000);setInterval(()=>refresh(),30000);window.addEventListener('pagehide',()=>{reset(null);});window.snoteRefreshSharedVehicleMarkers=()=>refresh(true);refresh();render();
})();
