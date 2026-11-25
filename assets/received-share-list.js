/* Accepted shared cars are list-only projections, never this dealer's persisted cars. */
(()=>{'use strict';if(window.SnoteReceivedVehicleList)return;
 const bridge=()=>window.snoteVehicleShareBridge,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const permissions={read:{label:'읽기',edit:false,delete:false},edit:{label:'수정',edit:true,delete:false},delete:{label:'삭제',edit:false,delete:true},all:{label:'모든 권한',edit:true,delete:true}};
 let account=null,accountActor=null,accountRole='',epoch=0,job=null,last=0,initialized=false,renderFrame=0,searchJob=null,searchOpening=null,presentationReady=false;const entries=new Map(),visible=new Set(),pendingReads=new Map(),photoCandidates=new Map(),leftGrants=new Map(),presentationNodes=new Map();
 const actor=()=>typeof currentUser==='undefined'?null:currentUser,eligible=()=>['dealer','admin'].includes(actor()?.role);
 const listRoute=()=>typeof route==='string'&&route==='buy'&&eligible();
 const context=()=>bridge()?.context?.(),valid=c=>!!c&&bridge()?.current?.(c)===true;
 const sameAccount=c=>valid(c)&&c.key===account&&actor()===accountActor&&actor()?.role===accountRole;
 const live=()=>listRoute()&&sameAccount(context());
 const escaped=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const idFor=item=>'snote-shared:'+item.companyId+':'+item.ownerId+':'+encodeURIComponent(item.carId).replaceAll("'",'%27');
 function access(value){const p=permissions[value?.permission],native=value?.nativeAccess===true&&value.permission==='all'&&value.invitationId===null&&value.version===null;
  if(value?.apiVersion!==2||value.canRead!==true||!p||value.canEdit!==p.edit||value.canDelete!==p.delete||!native&&!(value.nativeAccess===false&&UUID.test(value.invitationId||'')&&Number.isSafeInteger(value.version)&&value.version>0))return null;
  return{permission:value.permission,label:p.label,grant:native?null:{invitationId:value.invitationId,version:value.version}};
 }
 function itemAllowed(item){return item?.state==='accepted'&&item.nativeAccess===false&&UUID.test(item.companyId||'')&&UUID.test(item.ownerId||'')&&typeof item.carId==='string'&&item.carId.length>0&&item.carId.length<=200&&!!access(item)&&!(leftGrants.get(item.invitationId)>=item.version);}
 function revoke(entry){if(entry?.url)URL.revokeObjectURL(entry.url);if(entry){entry.url=null;for(const[url,source]of photoCandidates)if(source.car.id===entry.car.id){URL.revokeObjectURL(url);photoCandidates.delete(url);}}}
 function clearEntries(){for(const entry of entries.values())revoke(entry);for(const url of photoCandidates.keys())URL.revokeObjectURL(url);photoCandidates.clear();entries.clear();visible.clear();repaint();}
 function repaint(){if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;if(listRoute()&&typeof renderCars==='function')renderCars();});}
 // Reads still run concurrently and authorization changes take effect immediately.
 // Only their presentation waits: never show the own-only list and then insert
 // each received car above it as its independent read finishes.
 function prepare(){const screen=document.getElementById('list-screen');if(!screen)return;const c=scope(),pending=!!c&&listRoute()&&!presentationReady;
  let status=screen.querySelector('.snote-received-list-loading');
  if(pending&&!screen.classList.contains('snote-received-list-pending')){
   const host=[document.getElementById('list-mobile'),document.getElementById('list-table')].find(node=>node&&getComputedStyle(node).display!=='none'),box=host?.getBoundingClientRect(),parent=screen.getBoundingClientRect();
   screen.style.setProperty('--snote-received-list-height',Math.max(180,box?.height||0)+'px');screen.style.setProperty('--snote-received-list-top',Math.max(0,(box?.top||parent.top)-parent.top)+24+'px');screen.style.setProperty('--snote-received-count-width',(document.getElementById('snote-vehicle-count')?.getBoundingClientRect().width||20)+'px');
   screen.classList.remove('snote-received-list-enter');screen.classList.add('snote-received-list-pending');screen.setAttribute('aria-busy','true');
   for(const id of['list-table','list-mobile','list-pagination','snote-vehicle-count']){const node=document.getElementById(id);if(!node)continue;presentationNodes.set(node,{inert:node.getAttribute('inert'),hidden:node.getAttribute('aria-hidden'),live:node.getAttribute('aria-live')});node.inert=true;node.setAttribute('aria-hidden','true');if(id==='snote-vehicle-count')node.setAttribute('aria-live','off');}
   if(!status){status=document.createElement('div');status.className='snote-received-list-loading';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='차량 목록을 불러오는 중…';screen.append(status);}
  }else if(!pending&&screen.classList.contains('snote-received-list-pending')){
   screen.classList.remove('snote-received-list-pending');screen.removeAttribute('aria-busy');screen.style.removeProperty('--snote-received-list-height');screen.style.removeProperty('--snote-received-list-top');screen.style.removeProperty('--snote-received-count-width');if(listRoute())screen.classList.add('snote-received-list-enter');
   for(const[node,attributes]of presentationNodes)for(const[name,value]of[['inert',attributes.inert],['aria-hidden',attributes.hidden],['aria-live',attributes.live]])if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);presentationNodes.clear();
  }
  if(status)status.hidden=!pending;
 }
 function reset(next,who=actor()){account=next;accountActor=who;accountRole=who?.role||'';epoch++;job=null;searchJob=null;searchOpening=null;presentationReady=false;pendingReads.clear();leftGrants.clear();clearEntries();last=0;initialized=false;}
 function scope(){const c=context();if(!eligible()||!valid(c)){if(account!==null||entries.size||job)reset(null,null);return null;}if(c.key!==account||actor()!==accountActor||actor()?.role!==accountRole)reset(c.key,actor());return c;}
 const has=car=>live()&&!!car&&visible.has(String(car.id))&&entries.get(String(car.id))?.car===car;
 function rows(){return live()?[...entries].filter(([id])=>visible.has(id)).map(([,entry])=>entry.car):[];}
 const sameGrant=(a,b)=>['companyId','ownerId','carId','state','invitationId','version','permission','canRead','canEdit','canDelete','nativeAccess','apiVersion'].every(key=>a?.[key]===b?.[key]);
 const currentRun=(c,run)=>run.epoch===epoch&&job===run&&sameAccount(c);
 function args(entry,action){return{p_action:action,p_company:entry.item.companyId,p_owner:entry.item.ownerId,p_car:entry.item.carId,...(action==='media'&&entry.access.grant?{p_access:entry.access.grant}:{})};}
 async function read(c,item,run){
  const key=JSON.stringify([c.key,item.companyId,item.ownerId,item.carId,item.invitationId,item.version,item.permission]);let ticket=!run.fresh&&pendingReads.get(key);
  if(ticket?.expired)return null;
  if(!ticket){ticket={promise:bridge().rpc(c,{p_action:'read',p_company:item.companyId,p_owner:item.ownerId,p_car:item.carId})};pendingReads.set(key,ticket);const settled=()=>{if(pendingReads.get(key)===ticket)pendingReads.delete(key);};ticket.promise.then(settled,settled);}
  const value=await ticket.promise;if(!currentRun(c,run))return null;
  const cap=access(value),raw=value?.car;
  if(!cap||!raw||typeof raw!=='object'||String(raw.id)!==item.carId||typeof raw.model!=='string'||!raw.model.trim()||typeof raw.status!=='string'||raw.status==='판매완료')return null;
  if(cap.grant&&(cap.grant.invitationId!==item.invitationId||cap.grant.version!==item.version||cap.permission!==item.permission))return null;
  const converted=window.SnoteMoney?.car(raw);if(!converted||typeof converted!=='object')return null;
  const id=idFor(item),previous=entries.get(id);const clean={...converted};delete clean.car;delete clean.entry;delete clean.carId;
  const car=Object.freeze({...clean,id,ownerId:'cld_'+item.ownerId.replaceAll('-','').slice(0,18),km:clean.km??clean.mileage??'',model:raw.model.slice(0,200),plate:typeof raw.plate==='string'?raw.plate.slice(0,30):''});
  return{item:{...item},car,access:cap,url:previous?.url||null,photoAt:previous?.photoAt||0,readAt:Date.now(),photoJob:null,documentGroups:null};
 }
 function incomingItems(result){
  if(!Array.isArray(result)||result.length>1000)throw Error('INVALID_RESPONSE');
  const counts=new Map();for(const item of result.filter(itemAllowed)){const id=idFor(item);counts.set(id,(counts.get(id)||0)+1);}
  return result.filter(item=>itemAllowed(item)&&counts.get(idFor(item))===1);
 }
 function accept(items,run){
  const accepted=new Map(items.map(item=>[idFor(item),item]));let changed=false;run.accepted=accepted;
  if(presentationReady&&items.some(item=>!sameGrant(entries.get(idFor(item))?.item,item))){presentationReady=false;prepare();}
  for(const[id,entry]of entries)if(!accepted.has(id)||!sameGrant(entry.item,accepted.get(id))){revoke(entry);entries.delete(id);visible.delete(id);changed=true;}
  // This incoming ACK verified the same grant. Keep its row while refreshing the data snapshot.
  for(const item of items){const id=idFor(item),old=entries.get(id);if(old){if(old.item.ownerName!==item.ownerName||!visible.has(id))changed=true;old.item={...item};visible.add(id);}else if(visible.delete(id))changed=true;}if(changed)repaint();
 }
 // A route visit always verifies incoming grants; only a recently read grant can reuse its snapshot.
 function refresh(force=false,{urgent=false,warm=false}={}){const c=scope();if(!c||!listRoute()&&!warm)return Promise.resolve();
  // Coalesce repeated invalidations: hide immediately, finish current transports, then validate once more.
  if(job&&force&&!urgent){job.recheck=true;job.blocked=true;presentationReady=false;prepare();pendingReads.clear();clearEntries();return job.completion||job.promise;}
  if(job&&!force&&!urgent){job.revalidate?.();return job.completion||job.promise;}if(!force&&!urgent&&Date.now()-last<15000)return Promise.resolve();
  if(job){epoch++;job=null;}if(force){presentationReady=false;prepare();clearEntries();}
  const run={epoch,key:c.key,fresh:force,promise:null};job=run;initialized=true;
  let progress;const timeout=()=>Object.assign(Error('SHARE_REFRESH_TIMEOUT'),{code:'SHARE_REFRESH_TIMEOUT'});
  const deadline=new Promise((_,reject)=>{run.fail=error=>{run.blocked=true;reject(error);};progress=()=>{clearTimeout(run.timer);run.timer=setTimeout(()=>run.fail(timeout()),12000);};progress();});
  const fetchRows=async()=>{
   const result=await bridge().rpc(c,{p_action:'incoming'});if(!currentRun(c,run)||run.blocked)return;progress();
   const items=incomingItems(result);accept(items,run);let cursor=0;
   // Authorization polling remains independent of a large or slowly progressing snapshot queue.
   run.revalidate=()=>{if(run.revalidation||!currentRun(c,run)||run.blocked)return;let timer;
    run.revalidation=(async()=>{try{
     const reply=await Promise.race([bridge().rpc(c,{p_action:'incoming'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout()),12000);})]);
     if(!currentRun(c,run)||run.blocked)return;const next=incomingItems(reply),prior=run.accepted;accept(next,run);
     items.splice(cursor,0,...next.filter(item=>!sameGrant(item,prior.get(idFor(item)))));
    }catch(error){if(currentRun(c,run)&&!run.blocked)run.fail(error);}finally{clearTimeout(timer);run.revalidation=null;}})();
   };
   const worker=async()=>{while(cursor<items.length){if(!currentRun(c,run)||run.blocked)return;const item=items[cursor++],id=idFor(item),old=entries.get(id);if(!sameGrant(item,run.accepted.get(id)))continue;if(old&&!force&&visible.has(id)&&Date.now()-old.readAt<30000)continue;
    let entry=null;try{entry=await read(c,item,run);}catch{}
    if(!currentRun(c,run)||run.blocked)return;progress();if(!sameGrant(item,run.accepted.get(id)))continue;
    if(entry)entry.item={...run.accepted.get(id)};
    let changed=false;
    if(entry){const previous=entries.get(id),sameCar=previous&&JSON.stringify(previous.car)===JSON.stringify(entry.car);changed=!previous||!sameCar||!sameGrant(previous.item,entry.item)||previous.item.ownerName!==entry.item.ownerName||!visible.has(id);if(presentationReady&&(!previous||!sameCar)){presentationReady=false;prepare();}if(previous&&sameGrant(previous.item,entry.item)){const photoState={url:previous.url,photoAt:previous.photoAt,photoJob:previous.photoJob,documentGroups:previous.documentGroups,car:sameCar?previous.car:entry.car};Object.assign(previous,entry,photoState);entry=previous;}entries.set(id,entry);visible.add(id);}else{changed=entries.has(id)||visible.has(id);revoke(entries.get(id));entries.delete(id);visible.delete(id);}if(changed)repaint();
   }};
   do{await Promise.all(Array.from({length:Math.min(6,items.length-cursor)},worker));if(run.revalidation)await run.revalidation;}while(currentRun(c,run)&&!run.blocked&&cursor<items.length);
   if(currentRun(c,run)&&!run.blocked){run.verified=true;last=Date.now();const reveal=!presentationReady;presentationReady=true;if(reveal)repaint();if(listRoute())scan();}
  };
  run.promise=(async()=>{try{await Promise.race([fetchRows(),deadline]);}
  catch(error){if(currentRun(c,run)){run.blocked=true;if(error?.code==='SHARE_REFRESH_TIMEOUT')for(const ticket of pendingReads.values())ticket.expired=true;for(const entry of entries.values())revoke(entry);entries.clear();visible.clear();last=error?.code==='SHARE_REFRESH_TIMEOUT'?0:Date.now();presentationReady=true;repaint();}}
  finally{clearTimeout(run.timer);if(job===run){job=null;if(run.recheck&&sameAccount(c))run.next=refresh(true,{warm:true});}}})();run.completion=run.promise.then(()=>run.next);return run.completion;
 }
 function ready(){const c=scope();if(c&&!initialized)void refresh(false,{urgent:true,warm:true});}
 // Search may run from another menu, but only after the ordinary incoming/read
 // pipeline has freshly verified this actor's grants. Never expose cached raw
 // vehicle payloads or relax the route guard of rows()/has()/open().
 const searchCurrent=(c,who,role)=>actor()===who&&who?.role===role&&sameAccount(c);
 const searchText=(value,max)=>typeof value==='string'?value.slice(0,max):'';
 function searchRows(){
  const c=scope(),who=actor(),role=who?.role;
  if(!c||!searchCurrent(c,who,role))return Promise.resolve([]);
  if(searchJob?.context.key===c.key&&searchJob.actor===who&&searchJob.role===role)return searchJob.promise;
  const pending={context:c,actor:who,role,promise:null};
  searchJob=pending;
  pending.promise=(async()=>{try{
   // Join a current canonical verification instead of duplicating its incoming
   // request. Otherwise start a fresh ACK without clearing unchanged list rows.
   let run=job,verification;
   if(run&&run.epoch===epoch&&!run.blocked&&!run.recheck)verification=run.completion||run.promise;
   else{verification=refresh(false,{urgent:true,warm:true});run=job;}
   await verification;
   if(!searchCurrent(c,who,role)||!run?.verified||run.blocked||run.epoch!==epoch)return [];
   return Object.freeze([...entries].filter(([id,entry])=>visible.has(id)&&sameGrant(entry.item,run.accepted?.get(id))).map(([id,entry])=>Object.freeze({
    id,model:searchText(entry.car.model,200),plate:searchText(entry.car.plate,30),vin:searchText(entry.car.vin,50),brand:searchText(entry.car.brand||entry.car.make,100),
    year:typeof entry.car.year==='number'&&Number.isSafeInteger(entry.car.year)?entry.car.year:searchText(entry.car.year,10),color:searchText(entry.car.color,80),memo:searchText(entry.car.vehicleMemo,2000),
    ownerLabel:searchText(entry.item.ownerName,120)||'공유 딜러',status:searchText(entry.car.status,30),shared:true
   })));
  }catch{return [];}finally{if(searchJob===pending)searchJob=null;}})();
  return pending.promise;
 }
 function searchOpen(id){
  const c=scope(),who=actor(),role=who?.role,target=typeof id==='string'?id:'';
  if(!c||!searchCurrent(c,who,role)||!entries.has(target))return Promise.resolve(false);
  if(searchOpening?.id===target&&searchOpening.context.key===c.key&&searchOpening.actor===who&&searchOpening.role===role)return searchOpening.promise;
  const pending={id:target,context:c,actor:who,role,promise:null};
  searchOpening=pending;
  pending.promise=(async()=>{try{
   if(typeof navigate!=='function'||await navigate('buy')!==true||!searchCurrent(c,who,role)||!listRoute())return false;
   const verified=await searchRows();
   if(!searchCurrent(c,who,role)||!listRoute()||!verified.some(row=>row.id===target))return false;
   return open(target);
  }catch{return false;}finally{if(searchOpening===pending)searchOpening=null;}})();
  return pending.promise;
 }
 function paintPhoto(entry){const src=entry.url||(typeof fallbackImage==='function'?fallbackImage(entry.car).src:'');for(const image of document.querySelectorAll('img[data-received-share-photo]'))if(image.dataset.receivedSharePhoto===entry.car.id)image.src=src;}
 async function photo(entry){const now=Date.now();if(!live()||!visible.has(entry.car.id)||entries.get(entry.car.id)!==entry||entry.photoJob||now-entry.photoAt<(entry.url?30000:15000))return;const c=context(),version=epoch;entry.photoAt=now;
  const current=()=>version===epoch&&sameAccount(c)&&live()&&visible.has(entry.car.id)&&entries.get(entry.car.id)===entry;
  let candidate=null;entry.photoJob=(async()=>{try{const result=await bridge().rpc(c,args(entry,'media'));if(!current()||!Array.isArray(result))return;
   const groups=['registration','inspection1','inspection2'].filter(group=>result.some(row=>row?.group===group));if(JSON.stringify(entry.documentGroups)!==JSON.stringify(groups)){entry.documentGroups=groups;repaint();}
   const first=result.find(row=>row?.group==='photos'&&typeof row.path==='string');if(!first){revoke(entry);entry.photoAt=Date.now();paintPhoto(entry);return;}
   const blob=await bridge().file(c,first.path);if(!current()||!(blob instanceof Blob)||!/^image\/(jpeg|png|webp)$/.test(blob.type))return;
   candidate=URL.createObjectURL(blob);photoCandidates.set(candidate,entry);const preview=new Image();preview.src=candidate;await preview.decode();if(!current()||!photoCandidates.has(candidate)||!preview.naturalWidth)return;
   const previous=entry.url;entry.url=candidate;entry.photoAt=Date.now();photoCandidates.delete(candidate);candidate=null;paintPhoto(entry);if(previous)URL.revokeObjectURL(previous);
  }catch(error){if(current()&&/FORBIDDEN|SHARE_ACCESS|CAR_NOT_FOUND|42501/.test(String(error?.message)+' '+error?.code)){revoke(entry);entries.delete(entry.car.id);visible.delete(entry.car.id);repaint();}}
  finally{if(candidate){URL.revokeObjectURL(candidate);photoCandidates.delete(candidate);}if(!current()&&entries.get(entry.car.id)===entry)entry.photoAt=0;entry.photoJob=null;}})();
 }
 const observer=new IntersectionObserver(records=>{for(const record of records)if(record.isIntersecting){const entry=entries.get(record.target.dataset.receivedSharePhoto);if(entry)void photo(entry);observer.unobserve(record.target);}},{rootMargin:'100px'});
 function scan(){if(!live())return;const now=Date.now();for(const image of document.querySelectorAll('img[data-received-share-photo]')){const entry=entries.get(image.dataset.receivedSharePhoto);if(entry&&visible.has(entry.car.id)&&!entry.photoJob&&now-entry.photoAt>=(entry.url?30000:15000))observer.observe(image);}}
 function thumbnail(car){if(!has(car))return null;const entry=entries.get(car.id),fallback=typeof fallbackImage==='function'?fallbackImage(car).src:'';return'<img src="'+escaped(entry.url||fallback)+'" alt="'+escaped(car.model)+' 공유 차량 사진" data-received-share-photo="'+escaped(car.id)+'" />';}
 function open(id,event){const entry=entries.get(String(id));if(!entry||!visible.has(String(id))||!live())return false;event?.preventDefault();event?.stopPropagation();
  if(window.SnoteSharedVehicleDetail?.open)void window.SnoteSharedVehicleDetail.open(entry.item);else if(typeof toast==='function')toast('공유 차량 화면을 불러오지 못했습니다. 새로고침해 주세요.');return true;
 }
 function forget(c,item,grant){if(!sameAccount(c)||!UUID.test(grant?.invitationId||'')||!Number.isSafeInteger(grant.version))return false;const id=idFor(item),matches=row=>row?.invitationId===grant.invitationId&&row?.version===grant.version;
  leftGrants.set(grant.invitationId,Math.max(grant.version,leftGrants.get(grant.invitationId)||0));if(matches(job?.accepted?.get(id)))job.accepted.delete(id);
  const entry=entries.get(id);if(!matches(entry?.item))return false;revoke(entry);entries.delete(id);visible.delete(id);repaint();return true;
 }
 window.SnoteReceivedVehicleList=Object.freeze({prepare,rows,has,car:id=>live()&&visible.has(String(id))?entries.get(String(id))?.car||null:null,ownerLabel:car=>has(car)?String(entries.get(car.id).item.ownerName||'공유 딜러'):'',permission:car=>has(car)?entries.get(car.id).access.label:'',documentGroups:car=>has(car)?entries.get(car.id).documentGroups?.slice()??null:null,documentCount:car=>has(car)?entries.get(car.id).documentGroups?.length??null:null,thumbnail,open,forget,searchRows,searchOpen,refresh:()=>refresh(true)});
 new MutationObserver(scan).observe(document.getElementById('list-screen')||document.body,{subtree:true,childList:true});
 window.addEventListener('snote:route-changed',()=>{visible.clear();presentationReady=false;prepare();repaint();if(listRoute())void refresh(false,{urgent:true});else ready();});
 window.addEventListener('snote:sales-data-changed',ready);
 window.addEventListener('snote-vehicle-sharing-updated',()=>void refresh(true,{warm:true}));window.addEventListener('snote-vehicle-changed',()=>void refresh(true,{warm:true}));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(true,{warm:true});});
 // Also recover a ready transition when it happened before this deferred bundle was installed.
 setInterval(()=>{ready();if(!document.hidden&&listRoute())scan();},500);setInterval(()=>{if(!document.hidden&&listRoute())void refresh();},15000);
 window.addEventListener('pagehide',()=>{reset(null,null);observer.disconnect();});prepare();ready();
})();
