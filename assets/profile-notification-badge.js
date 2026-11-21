/* Reuse the two authenticated unread streams; do not add another server poll. */
(()=>{'use strict';
 if(window.SnoteProfileNotificationBadge)return;
 const sources=new Map(),names=new Set(['notifications','support']);
 const byId=id=>document.getElementById(id);
 const bridge=source=>source==='notifications'?window.snoteVehicleShareBridge:window.snoteSupportChatBridge;
 function current(source,context){try{return !!context&&bridge(source)?.current(context)===true;}catch{return false;}}
 function attribute(element,name,value){if(element.getAttribute(name)!==value)element.setAttribute(name,value);}
 function render(){
  const profile=byId('snote-profile-trigger');if(!profile)return;
  for(const[source,value]of sources)if(!current(source,value.context))sources.delete(source);
  const notifications=sources.get('notifications')?.count||0,support=sources.get('support')?.count||0;
  const total=Math.min(Number.MAX_SAFE_INTEGER,notifications+support);
  let badge=byId('snote-profile-unread-badge');
  if(!badge){badge=document.createElement('span');badge.id='snote-profile-unread-badge';badge.className='snote-profile-unread-badge';badge.setAttribute('aria-hidden','true');badge.hidden=true;profile.append(badge);}
  const label=total>99?'99+':String(total);if(badge.textContent!==label)badge.textContent=label;
  if(badge.hidden!==(total===0))badge.hidden=total===0;
  attribute(badge,'data-overflow',String(total>99));
  profile.classList.toggle('snote-has-notifications',total>0);
  attribute(profile,'data-unread-count',String(total));
  attribute(profile,'data-notification-count',String(notifications));
  attribute(profile,'data-support-count',String(support));
  const account=byId('profile-name')?.textContent.trim()||'프로필';
  attribute(profile,'aria-label',account+(total?', 새 알림 '+notifications+'개, 새 상담 메시지 '+support+'개':''));
 }
 function update(source,count,context){
  if(!names.has(source)||!Number.isSafeInteger(count)||count<0)return;
  if(current(source,context))sources.set(source,{context,count});
  else if(!current(source,sources.get(source)?.context))sources.delete(source);
  render();
 }
 window.SnoteProfileNotificationBadge=Object.freeze({update,refresh:render});
 const name=byId('profile-name');if(name)new MutationObserver(render).observe(name,{childList:true,subtree:true,characterData:true});
 setInterval(render,250);
 window.addEventListener('pagehide',()=>{sources.clear();render();});
 document.addEventListener('visibilitychange',render);
 render();
})();
