/* Private account details and independent verified-phone/photo actions. */
(()=>{
 'use strict';
 const root=document.getElementById('snote-profile-dialog');if(!root)return;
 document.body.append(root);
 const byId=id=>root.querySelector('#snote-profile-'+id),panel=root.querySelector('.snote-profile-panel'),drawerHead=root.querySelector('.snote-profile-head');
 const disk='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7M13 5v2"/></svg>';
 byId('save').innerHTML=disk;for(const symbol of root.querySelectorAll('.snote-profile-disk'))symbol.innerHTML=disk;
 let context=null,baseline=null,request=0,closing=false,saveBusy=false,passwordBusy=false,phoneBusy=false,avatarBusy=false,returnFocus=null,previousOverflow='',closeTimer=null,sessionTimer=null;
 let challenge=null,resendAt=0,sendRequestId=null,avatar=null,avatarURL='',previewURL=null,committedPreviewURL=null;
 let presentation='drawer',bodyLocked=false,settingsHost=null,settingsDetails=null,settingsSummary=null,settingsClick=null,settingsToggle=null;
 const bridge=()=>window.snoteProfileBridge,phoneValue=()=>byId('phone').value.replace(/\D/g,''),busy=()=>saveBusy||passwordBusy||phoneBusy||avatarBusy;
 const current=(version=request)=>root.isConnected&&!root.hidden&&!closing&&version===request&&context&&bridge()?.current(context)&&(presentation!=='settings'||settingsHost?.isConnected&&root.parentElement===settingsHost);
 function status(id,text,tone='info'){const el=byId(id);el.textContent=text;el.dataset.tone=tone;}
 function values(){return {display_name:byId('name').value.trim(),company_name:byId('company').value.trim(),phone:String(baseline?.phone||''),address:String(baseline?.address||'')};}
 function personalDirty(){return !!baseline&&(byId('name').value.trim()!==String(baseline.display_name||'')||byId('company').value.trim()!==String(baseline.company_name||''));}
 function passwordDirty(){return ['password-current','password-new','password-confirm'].some(id=>byId(id).value.length>0);}
 function dirty(){return personalDirty()||passwordDirty()||!!baseline&&phoneValue()!==String(baseline.phone||'');}
 function clearPasswords(){for(const id of ['password-current','password-new','password-confirm'])byId(id).value='';}
 function expected(withPhone=false){const value={user_id:baseline.user_id,company_id:baseline.company_id,display_name:baseline.display_name,company_name:baseline.company_name,revision:baseline.revision};if(withPhone)value.phone=String(baseline.phone||'');return value;}
 function resetChallenge(){challenge=null;byId('phone-code').value='';byId('phone-code-row').hidden=true;byId('phone-countdown').textContent='';}
 function controls(){
  const ready=!!baseline&&current(),working=busy(),now=Date.now();
  for(const input of root.querySelectorAll('input,textarea'))input.disabled=!ready||working;
  byId('company').readOnly=baseline?.role!=='admin';byId('address').readOnly=true;
  byId('save').disabled=!ready||working||!personalDirty();byId('password-save').disabled=!ready||working;byId('avatar-pick').disabled=!ready||working||!avatar;
  const wait=Math.max(0,Math.ceil((resendAt-now)/1000));byId('phone-send').disabled=!ready||working||wait>0||phoneValue()===String(baseline?.phone||'');byId('phone-send').textContent=wait?`재요청 ${wait>=60?Math.ceil(wait/60)+'분':wait+'초'}`:challenge?'다시 받기':'인증번호 받기';
  byId('phone-confirm').disabled=!ready||working||!challenge||phoneValue()!==challenge.phone||!/^\d{6}$/.test(byId('phone-code').value);
  byId('reload').disabled=working;root.setAttribute('aria-busy',String(working||(!baseline&&!root.hidden)));
  if(challenge){const remaining=Math.max(0,Math.ceil((challenge.expiresAt-now)/1000));byId('phone-countdown').textContent=`남은 시간 ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;if(!remaining&&!phoneBusy){resetChallenge();status('phone-message','인증 시간이 만료되었습니다. 인증번호를 다시 요청해 주세요.','error');}}
 }
 function showAuth(user){byId('current-email').textContent=user?.email||'확인할 수 없음';}
 function image(img,url){const safe=typeof url==='string'&&url.length<10000&&(/^(https:|blob:)/.test(url));if(safe){img.src=url;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}}
 function showAvatar(url){image(byId('avatar'),url);byId('avatar-placeholder').hidden=!byId('avatar').hidden;}
 function clearPreview(){if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}}
 function clearCommittedPreview(){if(committedPreviewURL){if(avatarURL===committedPreviewURL)avatarURL='';URL.revokeObjectURL(committedPreviewURL);committedPreviewURL=null;}}
 function sameAvatar(a,b){return !!a&&!!b&&['user_id','company_id','avatar_path','avatar_revision'].every(key=>a[key]===b[key]);}
 function visuals(result){
  if(Object.hasOwn(result,'companyLogoURL'))image(byId('company-logo'),result.companyLogoURL);
  const nextAvatar=Object.hasOwn(result,'avatar')?result.avatar:avatar;
  if(Object.hasOwn(result,'avatarURL')){const keepLocal=!result.avatarURL&&committedPreviewURL&&sameAvatar(avatar,nextAvatar);avatarURL=result.avatarURL||(keepLocal?committedPreviewURL:'');if(avatarURL!==committedPreviewURL)clearCommittedPreview();showAvatar(avatarURL);}
  avatar=nextAvatar;
  if(Object.hasOwn(result,'avatar')||Object.hasOwn(result,'avatarError')){status('avatar-message',result.avatarError||'',result.avatarError?'error':'info');if(result.avatarError)byId('reload').hidden=false;}
 }
 function fill(result,{preservePersonal=false,preservePhone=false}={}){
  const profile=result.profile,draft={name:byId('name').value,company:byId('company').value,phone:byId('phone').value},oldPhone=String(baseline?.phone||'');
  baseline={...profile};byId('name').value=preservePersonal?draft.name:String(profile.display_name||'');byId('company').value=preservePersonal?draft.company:String(profile.company_name||'');
  byId('address').value=String(profile.company_address??profile.address??'');byId('phone').value=preservePhone?draft.phone:String(profile.phone||'');
  byId('current-phone').textContent=profile.phone?'현재 연락처 · '+profile.phone:'등록된 개인 연락처가 없습니다.';
  if(oldPhone!==String(profile.phone||''))resetChallenge();
  byId('company-note').hidden=profile.role==='admin';byId('role-label').textContent=profile.role==='admin'?'관리자 · 내 계정':profile.role==='accountant'?'경리 · 내 계정':'딜러 · 내 계정';if(result.user)showAuth(result.user);visuals(result);controls();
 }
 async function load(){
  if(!current()||busy())return;if(dirty()&&!window.confirm('입력한 내용을 버리고 프로필을 다시 불러올까요?'))return;
  baseline=null;clearPasswords();resetChallenge();resendAt=0;sendRequestId=null;controls();const version=++request;status('message','프로필을 불러오는 중…');byId('reload').hidden=true;
  try{const result=await bridge().read(context);if(!current(version))return;fill(result);status('message','');}
  catch(error){if(!current(version))return;status('message',message(error,'프로필을 불러오지 못했습니다. 다시 시도해 주세요.'),'error');byId('reload').hidden=false;controls();}
 }
 function message(error,fallback){
  if(error?.code==='40001'||error?.code==='PROFILE_CONFLICT'||error?.code==='CONFLICT')return '다른 화면에서 프로필이 변경되었습니다. 다시 불러온 후 시도해 주세요.';
  if(['42501','FORBIDDEN','UNAUTHORIZED'].includes(error?.code))return '현재 계정의 수정 권한을 확인해 주세요. 다시 로그인해야 할 수 있습니다.';
  if(['PGRST202','42883','42P01'].includes(error?.code))return '프로필 저장 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.';
  if(error?.code==='SNOTE_PROFILE_INPUT')return error.message;
  if(error?.code==='SNOTE_PROFILE_RELOAD')return '사진 저장 결과를 확인하지 못했습니다. 다시 불러온 후 확인해 주세요.';
  if(['INVALID_CODE','OTP_INVALID','CODE_MISMATCH','PHONE_CODE_INVALID'].includes(error?.code))return '인증번호가 올바르지 않습니다. 다시 확인해 주세요.';
  if(['CODE_EXPIRED','OTP_EXPIRED','CHALLENGE_EXPIRED','EXPIRED'].includes(error?.code))return '인증 시간이 만료되었습니다. 인증번호를 다시 요청해 주세요.';
  if(['LOCKED','TOO_MANY_ATTEMPTS','OTP_ATTEMPTS_EXCEEDED','ATTEMPTS_EXCEEDED'].includes(error?.code))return '인증 시도 횟수를 초과했습니다. 잠시 후 다시 요청해 주세요.';
  if(['RATE_LIMITED','OTP_RATE_LIMITED','SEND_COOLDOWN','COOLDOWN'].includes(error?.code))return '인증번호를 이미 요청했습니다. 잠시 후 다시 시도해 주세요.';
  if(error?.code==='REQUEST_REUSED')return '인증 요청을 새로 시작해 주세요. 인증번호를 다시 받을 수 있습니다.';
  if(error?.code==='CONSUMED')return '이미 처리된 인증 요청입니다. 프로필을 다시 불러와 확인해 주세요.';
  if(error?.code==='SMS_SEND_UNKNOWN')return '문자 발송 결과를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.';
  if(error?.code==='SETUP_REQUIRED')return '현재 문자 인증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  if(error?.code==='invalid_credentials')return '현재 비밀번호가 올바르지 않습니다.';
  if(error?.code==='same_password')return '기존 비밀번호와 다른 새 비밀번호를 입력해 주세요.';
  if(error?.code==='weak_password')return '더 안전한 새 비밀번호를 입력해 주세요.';
  if(error?.code==='over_request_rate_limit')return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if(error?.code==='reauthentication_needed'||error?.code==='reauthentication_not_valid')return '다시 로그인한 뒤 비밀번호를 변경해 주세요.';
  return fallback;
 }
 function invalid(text){return Object.assign(Error(text),{code:'SNOTE_PROFILE_INPUT'});}
 async function save(event){
  event.preventDefault();if(!current()||!baseline||busy())return;const profile=values(),version=request;
  try{
   if(!profile.display_name||profile.display_name.length>40)throw invalid('이름은 1~40자로 입력해 주세요.');if(profile.company_name.length<2||profile.company_name.length>100)throw invalid('상사명은 2~100자로 입력해 주세요.');
   saveBusy=true;controls();status('message','저장 중…');const result=await bridge().save(context,expected(),profile);if(!current(version))return;
   const hadChallenge=!!challenge;fill(result,{preservePhone:true});if(hadChallenge){resetChallenge();status('phone-message','기본 정보가 변경되어 인증번호를 다시 요청해 주세요.');}status('message','프로필을 저장했습니다.','success');byId('reload').hidden=true;
  }catch(error){if(current(version)){status('message',message(error,'프로필을 저장하지 못했습니다. 입력 내용은 유지됩니다.'),'error');byId('reload').hidden=!['40001','PROFILE_CONFLICT','CONFLICT'].includes(error?.code);}}
  finally{if(request===version){saveBusy=false;if(current())controls();}}
 }
 async function phoneSend(){
  if(!current()||!baseline||busy()||Date.now()<resendAt)return;const phone=phoneValue(),version=request;
  try{
   if(!/^(010\d{8}|01[16789]\d{7,8})$/.test(phone))throw invalid('새 휴대전화 번호를 확인해 주세요.');if(phone===String(baseline.phone||''))throw invalid('변경할 새 휴대전화 번호를 입력해 주세요.');
   phoneBusy=true;controls();status('phone-message','인증번호를 보내는 중…');sendRequestId ||= crypto.randomUUID();
   const result=await bridge().phoneSend(context,{phone,expected:expected(true),requestId:sendRequestId});if(!current(version))return;
   const expiresAt=Date.parse(result.expiresAt);if(typeof result.challengeId!=='string'||!result.challengeId||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw invalid('인증 요청을 확인하지 못했습니다. 다시 시도해 주세요.');
   challenge={id:result.challengeId,phone,expiresAt};resendAt=Date.now()+Math.max(0,Number(result.retryAfterSeconds??result.retryAfter??60)||0)*1000;sendRequestId=null;byId('phone-code').value='';byId('phone-code-row').hidden=false;status('phone-message','인증번호를 보냈습니다. 문자로 받은 6자리 숫자를 입력해 주세요.','success');
  }catch(error){if(current(version)){const seconds=Number(error?.retryAfterSeconds??error?.retryAfter);if(Number.isFinite(seconds)&&seconds>0)resendAt=Date.now()+seconds*1000;if(error?.code==='REQUEST_REUSED')sendRequestId=null;status('phone-message',message(error,'인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'),'error');}}
  finally{if(request===version){phoneBusy=false;if(current()){controls();if(challenge)byId('phone-code').focus({preventScroll:true});}}}
 }
 async function phoneConfirm(event){
  event.preventDefault();if(!current()||!baseline||busy()||!challenge)return;const version=request,pending={...challenge},code=byId('phone-code').value;
  if(phoneValue()!==pending.phone||!/^\d{6}$/.test(code)){status('phone-message','전화번호와 인증번호를 다시 확인해 주세요.','error');return;}
  phoneBusy=true;controls();status('phone-message','인증을 확인하는 중…');
  try{const result=await bridge().phoneConfirm(context,{challengeId:pending.id,phone:pending.phone,code});if(!current(version))return;fill(result,{preservePersonal:true});resetChallenge();sendRequestId=null;status('phone-message','인증을 완료하고 연락처를 변경했습니다.','success');}
  catch(error){if(current(version)){status('phone-message',message(error,'인증을 완료하지 못했습니다. 번호와 인증번호를 확인해 주세요.'),'error');if(['40001','PROFILE_CONFLICT','CONFLICT','CONSUMED'].includes(error?.code)){resetChallenge();byId('reload').hidden=false;}if(['LOCKED','EXPIRED','REQUEST_REUSED'].includes(error?.code))resetChallenge();}}
  finally{if(request===version){phoneBusy=false;if(current())controls();}}
 }
 async function avatarChange(){
  const input=byId('avatar-file'),file=input.files?.[0];input.value='';if(!file||!current()||!baseline||busy())return;const version=request;let attemptPreview=false;
  try{
   if(!avatar){byId('reload').hidden=false;throw invalid('사진 정보를 다시 불러온 후 등록해 주세요.');}
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>5*1024*1024)throw invalid('JPG·PNG·WebP 사진을 5MB 이하로 선택해 주세요.');
   avatarBusy=true;controls();clearPreview();previewURL=URL.createObjectURL(file);attemptPreview=true;showAvatar(previewURL);status('avatar-message','사진을 저장하는 중…');
   const result=await bridge().avatarSave(context,file,avatar);if(!current(version))return;
   avatar=result.avatar||avatar;const nextURL=result.avatarURL||previewURL;
   if(nextURL===previewURL&&previewURL){const committed=previewURL;previewURL=null;clearCommittedPreview();committedPreviewURL=committed;avatarURL=committed;}
   else{avatarURL=nextURL;clearPreview();clearCommittedPreview();}
   showAvatar(avatarURL);status('avatar-message',result.avatarError||'프로필 사진을 저장했습니다.',result.avatarError?'error':'success');if(result.avatarError)byId('reload').hidden=false;
  }catch(error){if(current(version)){if(attemptPreview)clearPreview();showAvatar(avatarURL);status('avatar-message',message(error,'사진을 저장하지 못했습니다. 다시 시도해 주세요.'),'error');if(error?.code==='SNOTE_PROFILE_RELOAD')byId('reload').hidden=false;}}
  finally{if(request===version){avatarBusy=false;if(current())controls();}}
 }
 async function passwordSave(event){
  event.preventDefault();if(!current()||!baseline||busy())return;const version=request;
  if(byId('password-new').value!==byId('password-confirm').value){status('password-message','새 비밀번호가 서로 일치하지 않습니다.','error');return;}
  if(byId('password-new').value.length<8||!byId('password-current').value){status('password-message','현재 비밀번호와 8자 이상의 새 비밀번호를 입력해 주세요.','error');return;}
  passwordBusy=true;controls();status('password-message','비밀번호를 변경하는 중…');
  try{await bridge().changePassword(context,byId('password-current').value,byId('password-new').value);if(!current(version))return;status('password-message','비밀번호를 변경했습니다.','success');}
  catch(error){if(current(version))status('password-message',message(error,'비밀번호를 변경하지 못했습니다. 현재 비밀번호를 확인해 주세요.'),'error');}
  finally{if(request===version){clearPasswords();passwordBusy=false;if(current())controls();}}
 }
 function settingsOpen(value){
  if(!settingsDetails)return;settingsDetails.open=value;settingsSummary?.setAttribute('aria-expanded',String(value));
  const label=settingsSummary?.querySelector('[data-profile-settings-action]');if(label)label.textContent=value?'숨기기':'펼치기';
 }
 function drawerPresentation(){
  presentation='drawer';root.classList.remove('is-inline');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
  if(byId('save').parentElement!==drawerHead)drawerHead.append(byId('save'));
  if(root.parentElement!==document.body)document.body.append(root);
 }
 function releaseBody(){if(bodyLocked){document.body.style.overflow=previousOverflow;bodyLocked=false;}}
 function finishClose(){
  root.hidden=true;root.classList.remove('is-open');closing=false;baseline=null;context=null;clearPasswords();resetChallenge();clearPreview();clearCommittedPreview();avatar=null;avatarURL='';resendAt=0;sendRequestId=null;
  for(const id of ['name','company','phone','address'])byId(id).value='';byId('current-email').textContent='';byId('current-phone').textContent='';image(byId('company-logo'),'');showAvatar('');
  for(const id of ['message','password-message','phone-message','avatar-message'])status(id,'');
  releaseBody();clearTimeout(closeTimer);clearInterval(sessionTimer);sessionTimer=null;
  if(presentation==='settings')settingsOpen(false);drawerPresentation();
  if(returnFocus?.isConnected&&bridge()?.context())returnFocus.focus({preventScroll:true});returnFocus=null;
 }
 function close({force=false,immediate=false}={}){
  if(root.hidden||closing)return true;if(!force&&busy()){status('message','진행 중인 저장이 끝난 후 닫아 주세요.');return false;}
  if(!force&&dirty()&&!window.confirm('저장하지 않은 변경사항을 버리고 닫을까요?'))return false;
  ++request;closing=true;clearPasswords();root.classList.remove('is-open');if(force)returnFocus=null;
  if(immediate||presentation==='settings'){finishClose();return true;}
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;closeTimer=setTimeout(finishClose,reduced?0:290);return true;
 }
 function showPresentation(mode,host){
  if(mode==='settings'){
   releaseBody();presentation='settings';root.classList.add('is-inline','is-open');root.setAttribute('role','region');root.removeAttribute('aria-modal');const heading=root.querySelector('.snote-profile-section-heading');if(byId('save').parentElement!==heading)heading.append(byId('save'));host.append(root);settingsOpen(true);returnFocus=settingsSummary;
  }else{
   const wasInline=presentation==='settings';root.classList.remove('is-open');drawerPresentation();if(wasInline)settingsOpen(false);
   returnFocus=document.activeElement;previousOverflow=document.body.style.overflow;bodyLocked=true;document.body.style.overflow='hidden';
  }
 }
 async function begin(mode,host=null){
  if(closing)return false;
  if(!root.hidden){
   if(mode!==presentation||mode==='settings'&&root.parentElement!==host){showPresentation(mode,host);if(mode==='drawer'){void panel.offsetWidth;requestAnimationFrame(()=>{if(!root.hidden&&!closing){root.classList.add('is-open');panel.focus({preventScroll:true});}});}}
   return true;
  }
  context=bridge()?.context();if(!context){window.alert('온라인 계정에 로그인한 뒤 프로필을 설정해 주세요.');if(mode==='settings')settingsOpen(false);return false;}
  baseline=null;saveBusy=false;passwordBusy=false;phoneBusy=false;avatarBusy=false;showPresentation(mode,host);root.hidden=false;clearPasswords();
  for(const id of ['message','password-message','phone-message','avatar-message'])status(id,'');root.querySelector('details').open=false;
  if(mode==='drawer')requestAnimationFrame(()=>{if(!root.hidden&&!closing){root.classList.add('is-open');panel.focus({preventScroll:true});}});
  sessionTimer=setInterval(()=>{if(!closing&&!root.hidden&&!bridge()?.current(context))close({force:true});else if(current())controls();},200);await load();return true;
 }
 async function open(){return begin('drawer');}
 function prepareRouteChange(){return root.hidden||close({immediate:true});}
 function mountSettings(host){
  if(!(host instanceof Element)||!host.isConnected)return false;const details=host.closest('details'),summary=details?.querySelector(':scope > summary');if(!details||!summary)return false;
  if(settingsHost===host){if(details.open&&root.hidden)void begin('settings',host);return true;}
  const authorized=!!context&&bridge()?.current(context)===true,carryInline=presentation==='settings'&&!root.hidden&&!closing&&!settingsHost?.isConnected&&authorized;
  if(presentation==='settings'&&!root.hidden&&!carryInline&&!close({force:!authorized,immediate:true}))return false;
  if(settingsSummary&&settingsClick)settingsSummary.removeEventListener('click',settingsClick);if(settingsDetails&&settingsToggle)settingsDetails.removeEventListener('toggle',settingsToggle);
  settingsHost=host;settingsDetails=details;settingsSummary=summary;details.classList.add('snote-profile-settings-disclosure');
  if(!summary.querySelector('[data-profile-settings-action]')){const action=document.createElement('span');action.dataset.profileSettingsAction='';action.textContent=details.open?'숨기기':'펼치기';summary.append(action);}
  settingsClick=event=>{event.preventDefault();if(details.open){if(presentation!=='settings'||root.hidden||close({immediate:true}))settingsOpen(false);}else void begin('settings',host);};
  settingsToggle=()=>{summary.setAttribute('aria-expanded',String(details.open));const action=summary.querySelector('[data-profile-settings-action]');if(action)action.textContent=details.open?'숨기기':'펼치기';if(details.open){if(presentation!=='settings'||root.parentElement!==host||root.hidden)void begin('settings',host);}else if(presentation==='settings'&&!root.hidden&&root.parentElement===host&&!close({immediate:true}))settingsOpen(true);};
  summary.addEventListener('click',settingsClick);details.addEventListener('toggle',settingsToggle);summary.setAttribute('aria-expanded',String(details.open));if(carryInline)showPresentation('settings',host);else if(details.open)void begin('settings',host);return true;
 }
 window.addEventListener('snote:route-changed',event=>{if(event.detail?.page!=='settings'&&presentation==='settings'&&!root.hidden)close({force:true,immediate:true});});
 new MutationObserver(()=>{let settings=false;try{settings=typeof route==='string'&&route==='settings';}catch{}const host=settings?document.getElementById('snote-settings-profile-body'):null;if(host&&host!==settingsHost)mountSettings(host);if(presentation==='settings'&&!root.hidden&&(!settingsHost?.isConnected||!settingsDetails?.isConnected||root.parentElement!==settingsHost))close({force:true,immediate:true});}).observe(document.body,{childList:true,subtree:true});
 const initialHost=document.getElementById('snote-settings-profile-body');if(initialHost)mountSettings(initialHost);
 root.addEventListener('input',event=>{if(event.target===byId('phone')){if(challenge&&phoneValue()!==challenge.phone)resetChallenge();sendRequestId=null;}if(event.target===byId('phone-code'))byId('phone-code').value=byId('phone-code').value.replace(/\D/g,'').slice(0,6);controls();});
 byId('form').addEventListener('submit',save);byId('phone-form').addEventListener('submit',phoneConfirm);byId('phone-send').addEventListener('click',phoneSend);byId('password-form').addEventListener('submit',passwordSave);
 byId('avatar-pick').addEventListener('click',()=>byId('avatar-file').click());byId('avatar-file').addEventListener('change',avatarChange);byId('avatar').addEventListener('error',()=>{byId('avatar').hidden=true;byId('avatar-placeholder').hidden=false;});byId('company-logo').addEventListener('error',()=>{byId('company-logo').hidden=true;});
 byId('close').addEventListener('click',()=>close());byId('reload').addEventListener('click',load);
 document.addEventListener('keydown',event=>{
  if(root.hidden||closing||presentation==='settings')return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();return;}
  if(event.key==='Tab'){const elements=[...root.querySelectorAll('button,input,textarea,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length),first=elements[0],last=elements[elements.length-1];if(!first)return;if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();first.focus();}}
 },true);
 window.addEventListener('beforeunload',event=>{if(!root.hidden&&dirty()){event.preventDefault();event.returnValue='';}});window.snoteProfileEditor=Object.freeze({open,close,mountSettings,prepareRouteChange});
})();
