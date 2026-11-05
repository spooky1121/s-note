/* Vehicle-scoped sharing marks; no foreign vehicle records are copied into local storage. */
(()=>{'use strict';if(window.snoteSharedVehicleBadges)return;window.snoteSharedVehicleBadges=true;
 const bridge=()=>window.snoteVehicleShareBridge;
 const context=()=>{const b=bridge();return b?.badgeContext?b.badgeContext():b?.context?.();};
 const current=c=>{const b=bridge();return !!c&&(b?.badgeCurrent?b.badgeCurrent(c):b?.current?.(c));};
 const shape='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7" cy="9" r="2.6"/><circle cx="25" cy="9" r="2.6"/><circle cx="16" cy="23" r="2.6"/><path d="M2.8 17a4.2 4.2 0 0 1 8.4 0M20.8 17a4.2 4.2 0 0 1 8.4 0M11.5 30a4.5 4.5 0 0 1 9 0M12 4.4a11.6 11.6 0 0 1 10.6.8M21 1.5l1.9 4.4-4.7.8M29.4 20a13 13 0 0 1-5.8 7M27.8 27.5l-4.7-.4.6-4.6M8.1 26.8a12 12 0 0 1-5.5-7M1.4 23.6l.8-4.8 4.5 1.5M12 16l3 3 5-5"/></svg>';
 let account=null,epoch=0,shared=new Set(),job=null,queued=false,last=0,scheduled=false;
 const key=(owner,id)=>owner+'\n'+id;
 function mark(target,on){if(!target)return;let badge=target.querySelector(':scope > .snote-shared-vehicle-badge');if(!on){badge?.remove();return;}if(badge)return;badge=document.createElement('span');badge.className='snote-shared-vehicle-badge';badge.setAttribute('role','img');badge.setAttribute('aria-label','공유 차량');badge.dataset.tooltip='공유 차량';badge.innerHTML=shape;const color=target.querySelector(':scope > .snote222-vehicle-color');if(color)target.insertBefore(badge,color);else target.append(badge);}
 function carFor(id){if(typeof cars==='undefined'||!id)return null;const matches=cars.filter(car=>String(car.id)===id);return matches.length===1?matches[0]:null;}
 function isShared(car){if(!car)return false;const owner=bridge()?.owner?.(car);return !!owner&&shared.has(key(owner,String(car.id)));}
 function rowId(row){const value=(row.getAttribute('onclick')||'').trim();const match=/^openVehicle\((['"])([^'"\\]+)\1\);?$/.exec(value);return match?.[2]||null;}
 function render(){scheduled=false;const c=context(),valid=current(c)&&account===c?.key;for(const row of document.querySelectorAll('#list-table tr.vehicle-clickable,#list-mobile .vehicle-card,#list-mobile .acct-mobile-card')){const target=row.querySelector('.car-name,.acct-car-cell>strong,.vehicle-title,.acct-mobile-heading .snote222-model-line');mark(target,valid&&isShared(carFor(rowId(row))));}
 const title=document.getElementById('vehicle-title');mark(title,valid&&isShared(carFor(typeof activeCarId==='undefined'?null:String(activeCarId))));
 for(const entry of document.querySelectorAll('#snote-vehicle-sharing .vehicle-sharing-car'))mark(entry.querySelector(':scope > strong'),valid);
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(render);}}
 function reset(next){account=next;epoch++;shared.clear();last=0;schedule();}
 async function refresh(force=false){const c=context(),next=c?.key||null;if(next!==account)reset(next);if(!c||!current(c)||typeof bridge()?.badges!=='function'){shared.clear();schedule();return;}
 if(force){epoch++;shared.clear();schedule();}
 if(job){if(force||job.key!==next)queued=true;return;}if(!force&&Date.now()-last<30000)return;
 const run={epoch,key:next};job=run;try{const rows=await bridge().badges(c);if(run.epoch!==epoch||account!==next||!current(c))return;shared=new Set((Array.isArray(rows)?rows:[]).filter(r=>typeof r?.ownerId==='string'&&typeof r?.carId==='string').map(r=>key(r.ownerId,r.carId)));last=Date.now();schedule();}catch{if(run.epoch===epoch&&account===next){shared.clear();last=Date.now();schedule();}}finally{if(job===run)job=null;if(queued){queued=false;refresh(true);}}
 }
 new MutationObserver(records=>{if(records.some(record=>record.target.id==='vehicle-title'||!record.target.closest?.('.snote-shared-vehicle-badge')&&[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.classList?.contains('snote-shared-vehicle-badge'))))schedule();}).observe(document.body,{subtree:true,childList:true});
 window.addEventListener('snote-vehicle-sharing-updated',()=>refresh(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});setInterval(()=>{const next=context()?.key||null;if(next!==account){reset(next);refresh();}},1000);setInterval(()=>refresh(),30000);window.addEventListener('pagehide',()=>{reset(null);});window.snoteRefreshSharedVehicleBadges=()=>refresh(true);refresh();render();
})();
