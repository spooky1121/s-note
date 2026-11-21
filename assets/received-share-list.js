/* Accepted shared cars are list-only projections, never this dealer's persisted cars. */
(()=>{'use strict';if(window.SnoteReceivedVehicleList)return;
 const bridge=()=>window.snoteVehicleShareBridge,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const permissions={read:{label:'읽기',edit:false,delete:false},edit:{label:'수정',edit:true,delete:false},delete:{label:'삭제',edit:false,delete:true},all:{label:'모든 권한',edit:true,delete:true}};
 let account=null,epoch=0,job=null,last=0,queued=false,renderFrame=0;const entries=new Map();
 const listRoute=()=>typeof route==='string'&&route==='buy'&&typeof currentUser!=='undefined'&&['dealer','admin'].includes(currentUser?.role);
 const context=()=>bridge()?.context?.(),valid=c=>!!c&&bridge()?.current?.(c)===true;
 const live=()=>{const c=context();return listRoute()&&valid(c)&&c.key===account;};
 const escaped=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const idFor=item=>'snote-shared:'+item.companyId+':'+item.ownerId+':'+encodeURIComponent(item.carId).replaceAll("'",'%27');
 function access(value){const p=permissions[value?.permission],native=value?.nativeAccess===true&&value.permission==='all'&&value.invitationId===null&&value.version===null;
  if(value?.apiVersion!==2||value.canRead!==true||!p||value.canEdit!==p.edit||value.canDelete!==p.delete||!native&&!(value.nativeAccess===false&&UUID.test(value.invitationId||'')&&Number.isSafeInteger(value.version)&&value.version>0))return null;
  return{label:p.label,grant:native?null:{invitationId:value.invitationId,version:value.version}};
 }
 function itemAllowed(item){return item?.state==='accepted'&&item.nativeAccess===false&&UUID.test(item.companyId||'')&&UUID.test(item.ownerId||'')&&typeof item.carId==='string'&&item.carId.length>0&&item.carId.length<=200&&!!access(item);}
 function revoke(entry){if(entry?.url)URL.revokeObjectURL(entry.url);if(entry)entry.url=null;}
 function repaint(){if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;if(listRoute()&&typeof renderCars==='function')renderCars();});}
 function reset(next){account=next;epoch++;for(const entry of entries.values())revoke(entry);entries.clear();last=0;repaint();}
 const has=car=>live()&&!!car&&entries.get(String(car.id))?.car===car;
 function rows(){return live()?[...entries.values()].map(entry=>entry.car):[];}
 function args(entry,action){return{p_action:action,p_company:entry.item.companyId,p_owner:entry.item.ownerId,p_car:entry.item.carId,...(action==='media'&&entry.access.grant?{p_access:entry.access.grant}:{})};}
 async function read(c,item,run){
  const value=await bridge().rpc(c,{p_action:'read',p_company:item.companyId,p_owner:item.ownerId,p_car:item.carId});
  if(run.epoch!==epoch||!valid(c)||account!==c.key)return null;
  const cap=access(value),raw=value?.car;
  if(!cap||!raw||typeof raw!=='object'||String(raw.id)!==item.carId||typeof raw.model!=='string'||!raw.model.trim()||typeof raw.status!=='string'||raw.status==='판매완료')return null;
  if(cap.grant&&(cap.grant.invitationId!==item.invitationId||cap.grant.version!==item.version))return null;
  const converted=window.SnoteMoney?.car(raw);if(!converted||typeof converted!=='object')return null;
  const id=idFor(item),previous=entries.get(id);const clean={...converted};delete clean.car;delete clean.entry;delete clean.carId;
  const car=Object.freeze({...clean,id,ownerId:'cld_'+item.ownerId.replaceAll('-','').slice(0,18),km:clean.km??clean.mileage??'',model:raw.model.slice(0,200),plate:typeof raw.plate==='string'?raw.plate.slice(0,30):''});
  return{item:{...item},car,access:cap,url:previous?.url||null,photoAt:previous?.photoAt||0,readAt:Date.now(),photoJob:null};
 }
 async function refresh(force=false){const c=context(),next=c?.key||null;if(next!==account)reset(next);
  if(!listRoute()||!valid(c)){if(entries.size)reset(next);return;}
  if(job){if(force)queued=true;return;}if(!force&&Date.now()-last<15000)return;
  if(force){epoch++;for(const entry of entries.values())revoke(entry);entries.clear();repaint();}
  const run={epoch,key:next};job=run;
  try{
   const result=await bridge().rpc(c,{p_action:'incoming'});if(run.epoch!==epoch||!valid(c)||account!==next)return;
   if(!Array.isArray(result)||result.length>1000)throw Error('INVALID_RESPONSE');
   const counts=new Map();for(const item of result.filter(itemAllowed)){const id=idFor(item);counts.set(id,(counts.get(id)||0)+1);}
   const items=result.filter(item=>itemAllowed(item)&&counts.get(idFor(item))===1),keys=new Set(items.map(idFor));
   for(const[id,entry]of entries)if(!keys.has(id)){revoke(entry);entries.delete(id);}repaint();
   let cursor=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++],id=idFor(item),old=entries.get(id);if(old&&old.item.version===item.version&&Date.now()-old.readAt<30000)continue;
    let entry=null;try{entry=await read(c,item,run);}catch{}
    if(run.epoch!==epoch||!valid(c)||account!==next)return;
    if(entry)entries.set(id,entry);else{revoke(entries.get(id));entries.delete(id);}repaint();
   }}));
   if(run.epoch===epoch&&valid(c)&&account===next){last=Date.now();scan();}
  }catch{if(run.epoch===epoch&&account===next){for(const entry of entries.values())revoke(entry);entries.clear();last=Date.now();repaint();}}
  finally{if(job===run)job=null;if(queued){queued=false;void refresh(true);}}
 }
 async function photo(entry){if(!live()||entries.get(entry.car.id)!==entry||entry.url||entry.photoJob||Date.now()-entry.photoAt<15000)return;const c=context(),version=epoch;entry.photoAt=Date.now();
  const current=()=>version===epoch&&valid(c)&&live()&&entries.get(entry.car.id)===entry;
  entry.photoJob=(async()=>{try{const result=await bridge().rpc(c,args(entry,'media'));if(!current()||!Array.isArray(result))return;const first=result.find(row=>row?.group==='photos'&&typeof row.path==='string');if(!first)return;
   const blob=await bridge().file(c,first.path);if(!current()||!(blob instanceof Blob)||!/^image\/(jpeg|png|webp)$/.test(blob.type))return;
   const url=URL.createObjectURL(blob);if(!current()){URL.revokeObjectURL(url);return;}revoke(entry);entry.url=url;
   for(const image of document.querySelectorAll('img[data-received-share-photo]'))if(image.dataset.receivedSharePhoto===entry.car.id)image.src=url;
  }catch(error){if(current()&&/FORBIDDEN|SHARE_ACCESS|CAR_NOT_FOUND|42501/.test(String(error?.message)+' '+error?.code)){revoke(entry);entries.delete(entry.car.id);repaint();}}
  finally{entry.photoJob=null;}})();
 }
 const observer=new IntersectionObserver(records=>{for(const record of records)if(record.isIntersecting){const entry=entries.get(record.target.dataset.receivedSharePhoto);if(entry)void photo(entry);observer.unobserve(record.target);}},{rootMargin:'100px'});
 function scan(){for(const image of document.querySelectorAll('img[data-received-share-photo]'))observer.observe(image);}
 function thumbnail(car){if(!has(car))return null;const entry=entries.get(car.id),fallback=typeof fallbackImage==='function'?fallbackImage(car).src:'';return'<img src="'+escaped(entry.url||fallback)+'" alt="'+escaped(car.model)+' 공유 차량 사진" data-received-share-photo="'+escaped(car.id)+'" />';}
 function open(id,event){const entry=entries.get(String(id));if(!entry||!live())return false;event?.preventDefault();event?.stopPropagation();
  if(window.SnoteSharedVehicleDetail?.open)void window.SnoteSharedVehicleDetail.open(entry.item);else if(typeof toast==='function')toast('공유 차량 화면을 불러오지 못했습니다. 새로고침해 주세요.');return true;
 }
 window.SnoteReceivedVehicleList=Object.freeze({rows,has,car:id=>live()?entries.get(String(id))?.car||null:null,ownerLabel:car=>has(car)?String(entries.get(car.id).item.ownerName||'공유 딜러'):'',permission:car=>has(car)?entries.get(car.id).access.label:'',thumbnail,open,refresh:()=>refresh(true)});
 new MutationObserver(scan).observe(document.getElementById('list-screen')||document.body,{subtree:true,childList:true});
 window.addEventListener('snote:route-changed',()=>{if(!listRoute())reset(context()?.key||null);else void refresh(true);});
 window.addEventListener('snote-vehicle-sharing-updated',()=>void refresh(true));window.addEventListener('snote-vehicle-changed',()=>void refresh(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(true);});
 setInterval(()=>{const next=context()?.key||null;if(next!==account||entries.size&&!valid(context())){reset(next);void refresh();}},500);
 setInterval(()=>{if(!document.hidden&&listRoute())void refresh();},15000);
 window.addEventListener('pagehide',()=>{reset(null);observer.disconnect();});void refresh();
})();
