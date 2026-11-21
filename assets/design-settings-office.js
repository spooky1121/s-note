/* Presentation only: existing settings nodes, handlers and account boundaries stay intact. */
(()=>{'use strict';
 if(window.SnoteDesignSettingsOffice)return;
 const GROUPS=[['account','내 계정'],['payments','입금계좌'],['company','상사·직원'],['finance','재고금융'],['security','보안']];
 let state=null,queued=false,scrollQueued=false;
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
 function settingsRoute(){try{return typeof route==='string'&&route==='settings'&&typeof currentUser==='object'&&currentUser&&['admin','dealer'].includes(currentUser.role);}catch{return false;}}
 function scope(){try{const s=window.snoteCompanyAssetScope?.();return{actor:currentUser,companyId:s?.companyId||null,userId:s?.userId||currentUser?.username||null,role:currentUser?.role};}catch{return null;}}
 const same=(a,b)=>!!a&&!!b&&['actor','companyId','userId','role'].every(key=>a[key]===b[key]);
 const live=s=>!!s&&state===s&&s.host.isConnected&&settingsRoute()&&same(s.scope,scope());
 function category(card){
  if(card.matches('#snote-settings-profile,#snote-dashboard-margin-setting'))return'account';
  if(card.matches('#snote-settings-payment'))return'payments';
  if(card.matches('#snote-finance-lock-setting,#snote-idle-session-setting,.snote-settings-recycle-link'))return'security';
  if(card.matches('#snote-dealer-finance-rates,.snote203-bank-card')||card.querySelector('#snote90-lenders,#snote203-bank-total'))return'finance';
  return'company';
 }
 function cardStyle(card){
  if(card.querySelector('#snote90-company-form'))card.classList.add('snote-settings-company');
  if(card.querySelector('#snote90-members'))card.classList.add('snote-settings-staff');
  if(card.querySelector('#snote90-invite-mount'))card.classList.add('snote-settings-invite');
  if(card.querySelector('#snote90-lenders'))card.classList.add('snote-settings-lenders');
  const wide=!card.matches('.snote-settings-staff,.snote-settings-invite,.snote-settings-lenders,.snote203-bank-card,#snote-finance-lock-setting,#snote-idle-session-setting');
  card.classList.toggle('snote-design-settings-wide',wide);
 }
 function activeGroup(s,key){if(!live(s))return;for(const item of s.groups){const current=item.key===key;if(current)item.button.setAttribute('aria-current','location');else item.button.removeAttribute('aria-current');}s.active=key;}
 function jump(s,item){if(!live(s)||item.region.hidden)return;activeGroup(s,item.key);item.region.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});item.title.focus({preventScroll:true});}
 function create(host){
  const s={host,scope:scope(),groups:[],active:null},nav=node('nav','snote-design-settings-nav');state=s;
  nav.id='snote-settings-group-navigation';nav.setAttribute('aria-label','설정 그룹 바로가기');
  host.classList.add('snote-design-settings');host.prepend(nav);s.nav=nav;
  for(const [key,label]of GROUPS){
   const button=node('button','',label),region=node('div','snote-design-settings-group'),title=node('h2','snote-design-settings-title',label),grid=node('div','snote-design-settings-grid');
   button.type='button';button.id='snote-settings-jump-'+key;button.setAttribute('aria-controls','snote-settings-group-'+key);button.hidden=true;
   region.id='snote-settings-group-'+key;region.dataset.settingsGroup=key;region.setAttribute('role','region');title.id=region.id+'-title';title.tabIndex=-1;region.setAttribute('aria-labelledby',title.id);region.hidden=true;region.append(title,grid);nav.append(button);host.append(region);
   const item={key,button,region,title,grid};s.groups.push(item);button.addEventListener('click',()=>jump(s,item));
  }
  nav.addEventListener('keydown',event=>{if(!live(s)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=s.groups.filter(item=>!item.button.hidden).map(item=>item.button),at=buttons.indexOf(event.target);if(at<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();});
  return s;
 }
 function refreshSettings(){
  if(!settingsRoute()){state=null;return;}
  const host=document.querySelector('#alt-content>.snote90-settings,#alt-content>.snote-settings-home');if(!host)return;
  const nextScope=scope();if(state?.host===host&&!same(state.scope,nextScope)){if(['companyId','userId','role'].every(key=>state.scope?.[key]===nextScope?.[key]))state.scope=nextScope;else return;}
  const s=state?.host===host?state:create(host),focus=document.activeElement;
  let selection;try{if(host.contains(focus)&&typeof focus.selectionStart==='number')selection=[focus.selectionStart,focus.selectionEnd];}catch{}
  for(const card of [...host.children]){if(card===s.nav||card.classList.contains('snote-design-settings-group'))continue;cardStyle(card);s.groups.find(item=>item.key===category(card)).grid.append(card);}
  for(const item of s.groups){const available=[...item.grid.children].some(card=>!card.hidden&&getComputedStyle(card).display!=='none');if(item.region.hidden===available)item.region.hidden=!available;if(item.button.hidden===available)item.button.hidden=!available;}
  if(!s.groups.some(item=>item.key===s.active&&!item.region.hidden))activeGroup(s,s.groups.find(item=>!item.region.hidden)?.key);
  if(focus instanceof HTMLElement&&host.contains(focus)&&document.activeElement!==focus){focus.focus({preventScroll:true});if(selection)try{focus.setSelectionRange(...selection);}catch{}}
 }
 function loginCopy(){
  const register=document.getElementById('zc86-register');if(register&&register.textContent!=='상사 개설'){register.textContent='상사 개설';register.setAttribute('aria-label','새 상사 개설 및 관리자 가입');}
  const invite=document.getElementById('snote-invite-open');if(invite&&invite.textContent!=='초대코드로 가입')invite.textContent='초대코드로 가입';
  const intro=invite?.parentElement?.querySelector('span');if(intro&&intro.textContent!=='초대받은 직원은')intro.textContent='초대받은 직원은';
  const hint=document.querySelector('#zc-cloud-gate .snote-login-shared-hint');if(hint&&hint.textContent!=='공용 PC는 해제해 주세요')hint.textContent='공용 PC는 해제해 주세요';
  const footer=document.querySelector('#zc-cloud-gate .snote-login-footer');if(footer){const text=[...footer.childNodes].find(child=>child.nodeType===Node.TEXT_NODE&&/©/.test(child.textContent));if(text){const match=text.textContent.match(/©\s*\d{4}\s*S-NOTE/i),value=match?.[0]||'© S-NOTE';if(text.textContent!==value+' ')text.textContent=value+' ';}}
 }
 function refresh(){queued=false;loginCopy();refreshSettings();}
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 function trackScroll(){if(scrollQueued)return;scrollQueued=true;requestAnimationFrame(()=>{scrollQueued=false;const s=state;if(!live(s))return;const edge=s.nav.getBoundingClientRect().bottom+24,visible=s.groups.filter(item=>!item.region.hidden);let active=visible[0];for(const item of visible)if(item.region.getBoundingClientRect().top<=edge)active=item;activeGroup(s,active?.key);});}
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
 for(const event of ['snote:route-changed','snote:company-cars-ready','snote:company-assets-changed'])window.addEventListener(event,schedule);
 window.addEventListener('scroll',trackScroll,{passive:true});window.addEventListener('resize',schedule);
 window.SnoteDesignSettingsOffice=Object.freeze({refresh:schedule});schedule();
})();
