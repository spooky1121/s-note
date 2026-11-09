/* Profile notifications and recipient-confirmed vehicle invitations. */
(()=>{'use strict';
 const bridge=()=>window.snoteVehicleShareBridge,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 let scope=null,unread=0,working=false,pollAgain=false,opened=null,badgeEpoch=0,viewVersion=0,listVersion=0,readVersion=0;
 const dialog=document.createElement('dialog');dialog.id='snote-notifications-dialog';dialog.setAttribute('aria-labelledby','snote-notifications-title');dialog.innerHTML='<button type="button" aria-label="알림 닫기">×</button><h2 id="snote-notifications-title">알림</h2><p class="notification-status" role="status"></p><div class="notification-list"></div>';document.body.append(dialog);
 const status=dialog.querySelector('[role=status]'),list=dialog.querySelector('.notification-list');
 const field={model:'차명',plate:'차량번호',make:'제조사',year:'연식',vin:'차대번호',mileage:'주행거리',color:'색상',purchaseAt:'매입일',buy:'매입가',sell:'판매예정가',status:'차량 상태',inventoryLoan:'재고대출금',inventoryLender:'재고금융사',vehicleMemo:'차량 메모',sharePermission:'공유 권한','costs.performanceInspection':'성능점검비'};
 const permissions=Object.freeze({read:{label:'읽기',description:'수락하면 차량 정보와 사진·서류를 조회할 수 있습니다.'},edit:{label:'수정',description:'수락하면 차량 정보를 조회·수정하고 사진·서류를 볼 수 있습니다.'},delete:{label:'삭제',description:'수락하면 차량 정보를 조회하고 차량을 휴지통으로 이동할 수 있습니다.'},all:{label:'모든 권한',description:'수락하면 차량 정보를 조회·수정하고 차량을 휴지통으로 이동할 수 있습니다.'}});
 const permission=value=>typeof value==='string'&&Object.hasOwn(permissions,value)?permissions[value]:null;
 const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text??'';if(cls)e.className=cls;return e;};
 const current=c=>!!c&&bridge()?.current(c);
 const visible=(c,version)=>opened===c&&dialog.open&&viewVersion===version&&current(c);
 function badge(count){
  unread=Number.isSafeInteger(Number(count))?Math.max(0,Number(count)):0;
  const profile=document.getElementById('snote-profile-trigger'),menu=document.getElementById('snote-profile-notifications');
  for(const el of [profile,menu])if(el){el.classList.toggle('snote-has-notifications',unread>0);el.dataset.unreadCount=String(unread);}
  if(menu){menu.setAttribute('aria-label',unread?'알림, 새 알림 '+unread+'개':'알림');menu.setAttribute('aria-haspopup','dialog');menu.setAttribute('aria-controls',dialog.id);}
 }
 function close(){++viewVersion;++listVersion;opened=null;dialog.close();list.replaceChildren();status.textContent='';}
 dialog.querySelector('button').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 async function rpc(c,action,ids=[]){
  if(!current(c))throw Error('CONTEXT_CHANGED');
  const result=await bridge().notification(c,{p_action:action,p_ids:ids});
  if(!current(c))throw Error('CONTEXT_CHANGED');return result;
 }
 async function poll(){
  const c=bridge()?.context();
  if(!c){scope=null;++badgeEpoch;badge(0);if(dialog.open)close();return;}
  if(scope!==c.key){scope=c.key;++badgeEpoch;badge(0);if(dialog.open)close();}
  if(working){pollAgain=true;return;}working=true;const epoch=badgeEpoch;
  try{const data=await rpc(c,'summary');if(current(c)&&epoch===badgeEpoch)badge(data.unread);}catch{}
  finally{working=false;if(pollAgain){pollAgain=false;void poll();}}
 }
 function value(v,key,unit){if(key==='sharePermission')return permission(v)?.label||'권한 확인 필요';if(v==null||v==='')return '미입력';if(['buy','sell','inventoryLoan','costs.performanceInspection'].includes(key)){const won=unit==='KRW'?Number(v):window.SnoteMoney.toWon(v);return Number(won).toLocaleString('ko-KR')+'원';}if(key==='mileage')return Number(v).toLocaleString('ko-KR')+'km';return String(v);}
 function invitation(value){
  return value&&UUID.test(value.id||'')&&Number.isSafeInteger(value.version)&&value.version>0&&['pending','accepted','rejected'].includes(value.state)?value:null;
 }
 function sharingChanged(c){if(!current(c))return;window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));window.dispatchEvent(new Event('snote-vehicle-changed'));}
 function replyMessage(error){return /CONFLICT|40001/.test(String(error?.message)+' '+error?.code)?'이미 처리되었거나 변경된 초대입니다. 최신 상태를 확인해 주세요.':/FORBIDDEN|42501/.test(String(error?.message)+' '+error?.code)?'이 초대에 응답할 권한이 없거나 초대가 취소되었습니다.':'응답을 저장했는지 확인하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.';}
 function renderInvitation(row,item,c,version){
  const invite=invitation(item.invitation),message=node('p',null,'notification-invitation-status');
  if(!invite){message.textContent='초대 상태를 확인하지 못했습니다. 알림을 다시 열어주세요.';row.append(message);return;}
  const access=permission(invite.permission);row.dataset.invitationId=invite.id;row.dataset.invitationState=invite.state;row.dataset.sharePermission=access?invite.permission:'unknown';
  row.append(node('p',access?'공유 권한: '+access.label:'공유 권한 확인 필요','notification-sharing-permission'));
  message.textContent=invite.state==='accepted'?'초대를 수락했습니다. 공유받은 차량 목록에서 권한을 확인할 수 있습니다.':invite.state==='rejected'?'이 공유 초대를 거부했습니다.':access?access.description:'공유 권한을 확인하지 못했습니다. 알림을 다시 열어 확인해 주세요.';
  row.append(message);if(invite.state!=='pending')return;
  const actions=node('div',null,'notification-invitation-actions'),accept=node('button','수락'),reject=node('button','거부');
  for(const[button,choice]of [[accept,true],[reject,false]]){
   button.type='button';button.dataset.reply=choice?'accept':'reject';if(choice&&!access)button.disabled=true;
   button.setAttribute('aria-label','차량 공유 초대 '+(choice?'수락':'거부'));
   button.onclick=async()=>{
    if(!visible(c,version)||row.dataset.replyPending==='true'||choice&&!access)return;
    row.dataset.replyPending='true';accept.disabled=true;reject.disabled=true;message.classList.remove('is-error');message.textContent='응답을 저장하고 있습니다…';
    try{
     if(typeof bridge()?.reply!=='function')throw Error('SETUP_REQUIRED');
     const result=await bridge().reply(c,{p_invitation:invite.id,p_expected:invite.version,p_accept:choice});
     if(!current(c))return;
     if(result?.ok!==true||result.invitationId!==invite.id||result.state!==(choice?'accepted':'rejected')||!Number.isSafeInteger(result.version)||result.version<=invite.version||typeof result.alreadyProcessed!=='boolean')throw Error('INVALID_RESPONSE');
     sharingChanged(c);
     if(visible(c,version))await load(c,version);
    }catch(error){
     if(!current(c))return;
     if(visible(c,version)){
      const text=replyMessage(error);
      // A lost reply or stale version cannot grant access optimistically.
      // Only a fresh list from the server may show the resulting decision.
      try{
       const data=await load(c,version);
       if(data&&visible(c,version)){status.textContent=text;const latest=data.items?.find(entry=>entry.invitation?.id===invite.id)?.invitation;if(invitation(latest)&&latest.state!=='pending')sharingChanged(c);}
      }catch{if(visible(c,version)){message.textContent=text;message.classList.add('is-error');accept.disabled=!access;reject.disabled=false;}}
     }
    }finally{row.dataset.replyPending='false';}
   };
  }
  actions.append(accept,reject);row.append(actions);
 }
 async function load(c,version){
  const requestVersion=++listVersion,data=await rpc(c,'list');if(!visible(c,version)||requestVersion!==listVersion)return null;
  if(!Array.isArray(data?.items))throw Error('INVALID_RESPONSE');
  list.replaceChildren();++badgeEpoch;badge(data.unread);status.textContent=data.items.length?'최근 알림과 차량 공유 초대를 확인해 주세요.':'새로운 알림이 없습니다.';
  for(const item of data.items){
   const invited=item.eventType==='share_invitation',shared=item.eventType==='shared',row=node('article',null,'notification-item');row.dataset.eventType=invited?'share_invitation':shared?'shared':'changed';
   row.append(node('p',invited?'차량 공유 초대':shared?'신규 공유':'차량 정보 변경','notification-event'),node('strong',item.car),node('p',item.actor+' · '+new Date(item.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}),'notification-meta'));
   if(!item.readAt)row.append(node('span','신규','notification-tag'));
   if(invited)renderInvitation(row,item,c,version);
   else if(shared)row.append(node('p','새 공유 매물이 등록되었습니다.','notification-message'));
   else{const changes=node('dl');for(const change of Array.isArray(item.changes)?item.changes:[]){const line=node('div');line.append(node('dt',field[change.field]||change.field),node('dd',value(change.before,change.field,item.moneyUnit)+' → '+value(change.after,change.field,item.moneyUnit)));changes.append(line);}row.append(changes);}
   list.append(row);
  }
  const ids=data.items.filter(item=>!item.readAt).map(item=>item.id);
  if(ids.length){const read=++readVersion,updated=await rpc(c,'read',ids);if(current(c)&&read===readVersion){++badgeEpoch;badge(updated.unread);}}
  return data;
 }
 window.snoteOpenNotifications=async()=>{
  const c=bridge()?.context();if(!c)return;if(scope!==c.key){scope=c.key;++badgeEpoch;badge(0);}const version=++viewVersion;opened=c;list.replaceChildren();status.textContent='알림을 불러오는 중…';if(!dialog.open)dialog.showModal();
  try{await load(c,version);}catch{if(visible(c,version))status.textContent='알림을 불러오지 못했습니다. 잠시 후 다시 열어주세요.';}
 };
 badge(0);setInterval(()=>{const key=bridge()?.context()?.key||null;if(key!==scope){scope=null;badge(0);if(dialog.open)close();void poll();}},1000);setInterval(poll,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});window.addEventListener('snote-vehicle-changed',poll);setTimeout(poll,1500);window.addEventListener('pagehide',close);
})();
