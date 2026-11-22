/* A recipient's private contract workspace references a shared car, never its inventory/customer rows. */
(()=>{'use strict';if(window.SnoteContractWork)return;
 const SC=/^sc:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,UUID=/^[a-f0-9-]{36}$/i;
 let binding=null,pending=null,serial=0;
 const bridge=()=>window.snoteSharedContractBridge,actor=()=>typeof currentUser==='undefined'?null:currentUser;
 const sameAccess=(a,b)=>!!a&&!!b&&a.invitationId===b.invitationId&&a.version===b.version;
 function valid(b){try{return !!b&&binding===b&&actor()===b.actor&&actor()?.role===b.role&&[b.context.carId,b.context.viewId].includes(String(activeCarId))&&route===b.route&&bridge()?.current(b.authority)===true&&(!b.drawer||window.SnoteSharedVehicleDetail?.contractCurrent(b.drawer)===true);}catch{return false;}}
 function reset(){const b=binding;binding=null;pending=null;++serial;if(b)window.snoteContractWorkExpired?.(b.context.carId,b.context.viewId);}
 function context(id){const b=binding;if(!valid(b))return null;return id==null||[b.context.carId,b.context.viewId].includes(String(id))?b.context:null;}
 function car(id){return context(id)?.car||null;}
 function current(c){return !!c&&context(c.carId)===c;}
 function activeId(){const c=context(typeof activeCarId==='undefined'?null:activeCarId);return c?.carId??null;}
 function result(value,authority,who,viewId,drawer=null){
  if(value?.ok!==true||!SC.test(value.carId||'')||value.companyId!==authority.companyId||value.ownerId!==authority.userId||!UUID.test(value.source?.companyId||'')||!UUID.test(value.source?.ownerId||'')||typeof value.source?.carId!=='string'||!value.source.carId||!UUID.test(value.access?.invitationId||'')||!Number.isSafeInteger(value.access?.version)||value.access.version<1||value.car?.id!==value.carId||value.car?.status==='판매완료'||typeof value.car?.model!=='string'||!value.car.model.trim()||value.sourceCompany?.id!==value.source.companyId)throw Error('SHARED_CONTRACT_INVALID_RESPONSE');
  if(drawer&&(['companyId','ownerId','carId'].some(k=>value.source[k]!==drawer.item[k])||!sameAccess(value.access,drawer.access)))throw Error('SHARE_ACCESS_CHANGED');
  const normalized=window.SnoteMoney.car(value.car),workCar=Object.freeze({...normalized,id:value.carId,ownerId:who.username,km:normalized.km??normalized.mileage??''});
  return Object.freeze({key:authority.key+':'+value.carId+':'+value.access.invitationId+':'+value.access.version,carId:value.carId,viewId,actor:who,ownerId:who.username,companyId:value.companyId,userId:value.ownerId,source:Object.freeze({...value.source}),access:Object.freeze({...value.access}),sourceCompany:Object.freeze({...value.sourceCompany}),crossCompany:value.source.companyId!==value.companyId,car:workCar});
 }
 async function ensure(id=activeCarId){
  const existing=context(id);if(existing)return existing.car;
  if(SC.test(String(id)))return reopen(String(id));
  const who=actor(),page=route,source=window.SnoteSharedVehicleDetail?.contractSource();if(!source||source.viewId!==String(id))return null;
  if(pending)return pending;
  const operation=++serial;
  const task=(async()=>{const drawer=await window.SnoteSharedVehicleDetail.prepareContract();if(!drawer||actor()!==who||route!==page||operation!==serial)return null;
   const authority=bridge()?.context();if(!authority)throw Error('AUTH_REQUIRED');
   const response=await bridge().bind(authority,{p_company:drawer.item.companyId,p_owner:drawer.item.ownerId,p_car:drawer.item.carId,p_access:drawer.access});
   if(actor()!==who||route!==page||operation!==serial||window.SnoteSharedVehicleDetail.contractCurrent(drawer)!==true||!bridge().current(authority))return null;
   const resolved=result(response,authority,who,drawer.viewId,drawer);if(window.SnoteSharedVehicleDetail.attachContract(drawer,resolved.carId)!==true)return null;binding={actor:who,role:who.role,route:page,authority,drawer,context:resolved};return resolved.car;
  })();pending=task;try{return await task;}finally{if(pending===task)pending=null;}
 }
 async function reopen(id){
  const existing=context(id);if(existing)return existing.car;
  if(!SC.test(id))return null;
  reset();const operation=serial,who=actor(),page=route,authority=bridge()?.context();if(!who||!authority)return null;
  const response=await bridge().access(authority,id);
  if(operation!==serial||actor()!==who||route!==page||!bridge().current(authority))return null;
  const resolved=result(response,authority,who,id);activeCarId=id;binding={actor:who,role:who.role,route:page,authority,drawer:null,context:resolved};return resolved.car;
 }
 async function verify(){const b=binding;if(!valid(b)){if(b)reset();return false;}try{const response=await bridge().access(b.authority,b.context.carId);if(!valid(b))return false;const next=result(response,b.authority,b.actor,b.context.viewId,b.drawer);if(next.carId!==b.context.carId||!sameAccess(next.access,b.context.access))throw Error('SHARE_ACCESS_CHANGED');return true;}catch{if(binding===b)reset();return false;}}
 function afterClose(){const b=binding;if(b&&!b.drawer&&!document.querySelector('#contract-overlay.open')&&document.getElementById('zc72-sale-modal')?.hidden!==false&&document.getElementById('zc76-receipt-overlay')?.hidden!==false)reset();}
 function clearView(id){if(binding?.context.viewId===id)reset();}
 async function openDetail(id){const c=await reopen(id);if(!c)return false;const source=context(id)?.source,who=actor();if(!source)return false;reset();await navigate('buy');if(actor()!==who||route!=='buy')return false;await window.SnoteReceivedVehicleList?.refresh();const projection='snote-shared:'+source.companyId+':'+source.ownerId+':'+encodeURIComponent(source.carId).replaceAll("'",'%27');return window.SnoteReceivedVehicleList?.open(projection)===true;}
 setInterval(()=>{if(binding&&!valid(binding))reset();},250);
 setInterval(()=>{if(binding)void verify();},15000);
 window.addEventListener('snote-vehicle-sharing-updated',()=>{if(binding)void verify();});
 window.addEventListener('snote:route-changed',()=>{if(binding&&!valid(binding))reset();});window.addEventListener('pagehide',reset);
 window.SnoteContractWork=Object.freeze({context,current,car,activeId,ensure,reopen,verify,reset,clearView,afterClose,openDetail,isShared:id=>SC.test(String(id||''))});
})();
