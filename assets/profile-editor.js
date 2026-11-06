/* Personal details remain on the server. Passwords live only in their form/request. */
(()=>{
 'use strict';
 const root=document.getElementById('snote-profile-dialog');if(!root)return;
 document.body.append(root);
 const byId=id=>document.getElementById('snote-profile-'+id),panel=root.querySelector('.snote-profile-panel');
 const disk='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7M13 5v2"/></svg>';
 byId('save').innerHTML=disk;for(const symbol of root.querySelectorAll('.snote-profile-disk'))symbol.innerHTML=disk;
 let context=null,baseline=null,request=0,closing=false,saveBusy=false,emailBusy=false,passwordBusy=false,returnFocus=null,previousOverflow='',closeTimer=null,sessionTimer=null;
 const bridge=()=>window.snoteProfileBridge;
 const current=(version=request)=>!root.hidden&&!closing&&version===request&&context&&bridge()?.current(context);
 function status(id,text,tone='info'){const el=byId(id);el.textContent=text;el.dataset.tone=tone;}
 function values(){return {display_name:byId('name').value.trim(),company_name:byId('company').value.trim(),phone:byId('phone').value.replace(/\D/g,''),address:byId('address').value.trim()};}
 function personalDirty(){if(!baseline)return false;const entered=values();return Object.keys(entered).some(key=>entered[key]!==String(baseline[key]||''));}
 function passwordDirty(){return ['password-current','password-new','password-confirm'].some(id=>byId(id).value.length>0);}
 function dirty(){return personalDirty()||!!byId('email').value.trim()||passwordDirty();}
 function clearPasswords(){for(const id of ['password-current','password-new','password-confirm'])byId(id).value='';}
 function controls(){
  const ready=!!baseline&&current(),busy=saveBusy||emailBusy||passwordBusy;
  for(const input of root.querySelectorAll('input,textarea'))input.disabled=!ready||busy;
  byId('company').readOnly=baseline?.role!=='admin';
  byId('save').disabled=!ready||busy||!personalDirty();byId('email-save').disabled=!ready||busy;byId('password-save').disabled=!ready||busy;
  byId('reload').disabled=busy;root.setAttribute('aria-busy',String(busy||(!baseline&&!root.hidden)));
 }
 function showAuth(user){
  byId('current-email').textContent=user?.email||'확인할 수 없음';
  const pending=String(user?.new_email||'').trim(),el=byId('email-pending');el.hidden=!pending;el.textContent=pending?'변경 대기 · '+pending:'';
 }
 function fill(profile,user){
  baseline={...profile};for(const key of ['name','company','phone','address'])byId(key).value=String(profile[{name:'display_name',company:'company_name',phone:'phone',address:'address'}[key]]||'');
  byId('company-note').hidden=profile.role==='admin';byId('role-label').textContent=profile.role==='admin'?'관리자 · 내 계정':profile.role==='accountant'?'경리 · 내 계정':'딜러 · 내 계정';showAuth(user);controls();
 }
 async function load(){
  if(!current()||saveBusy||emailBusy||passwordBusy)return;
  if(dirty()&&!window.confirm('입력한 내용을 버리고 프로필을 다시 불러올까요?'))return;
  baseline=null;clearPasswords();byId('email').value='';controls();const version=++request;
  status('message','프로필을 불러오는 중…');byId('reload').hidden=true;
  try{const result=await bridge().read(context);if(!current(version))return;fill(result.profile,result.user);status('message','');}
  catch(error){if(!current(version))return;status('message',message(error,'프로필을 불러오지 못했습니다. 다시 시도해 주세요.'),'error');byId('reload').hidden=false;controls();}
 }
 function message(error,fallback){
  if(error?.code==='40001')return '다른 화면에서 프로필이 변경되었습니다. 다시 불러온 후 저장해 주세요.';
  if(error?.code==='42501')return '현재 계정의 수정 권한을 확인해 주세요. 다시 로그인해야 할 수 있습니다.';
  if(['PGRST202','42883','42P01'].includes(error?.code))return '프로필 저장 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.';
  if(error?.code==='SNOTE_PROFILE_INPUT')return error.message;
  if(error?.code==='invalid_credentials')return '현재 비밀번호가 올바르지 않습니다.';
  if(error?.code==='same_password')return '기존 비밀번호와 다른 새 비밀번호를 입력해 주세요.';
  if(error?.code==='weak_password')return '더 안전한 새 비밀번호를 입력해 주세요.';
  if(error?.code==='email_exists'||error?.code==='user_already_exists')return '사용할 수 없는 이메일입니다. 다른 주소를 입력해 주세요.';
  if(error?.code==='over_email_send_rate_limit'||error?.code==='over_request_rate_limit')return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if(error?.code==='reauthentication_needed'||error?.code==='reauthentication_not_valid')return '다시 로그인한 뒤 비밀번호를 변경해 주세요.';
  return fallback;
 }
 function invalid(text){return Object.assign(Error(text),{code:'SNOTE_PROFILE_INPUT'});}
 async function save(event){
  event.preventDefault();if(!current()||!baseline||saveBusy||emailBusy||passwordBusy)return;
  const profile=values(),version=request;
  try{
   if(!profile.display_name||profile.display_name.length>40)throw invalid('이름은 1~40자로 입력해 주세요.');
   if(profile.company_name.length<2||profile.company_name.length>100)throw invalid('상사명은 2~100자로 입력해 주세요.');
   if(!/^(010\d{8}|01[16789]\d{7,8})$/.test(profile.phone))throw invalid('휴대전화 번호를 확인해 주세요.');
   if(profile.address.length>300)throw invalid('주소는 300자 이내로 입력해 주세요.');
   saveBusy=true;controls();status('message','저장 중…');
   const result=await bridge().save(context,{user_id:baseline.user_id,company_id:baseline.company_id,display_name:baseline.display_name,company_name:baseline.company_name,revision:baseline.revision},profile);
   if(!current(version))return;fill(result.profile,result.user);status('message','프로필을 저장했습니다.','success');byId('reload').hidden=true;
  }catch(error){if(current()){status('message',message(error,'프로필을 저장하지 못했습니다. 입력 내용은 유지됩니다.'),'error');byId('reload').hidden=error?.code!=='40001';}}
  finally{if(request===version){saveBusy=false;if(current())controls();}}
 }
 async function emailSave(event){
  event.preventDefault();if(!current()||!baseline||saveBusy||emailBusy||passwordBusy)return;const version=request,email=byId('email').value.trim();
  if(!email||email===byId('current-email').textContent){status('email-message','변경할 새 이메일 주소를 입력해 주세요.','error');return;}
  emailBusy=true;controls();status('email-message','확인 메일을 요청하는 중…');
  try{const user=await bridge().changeEmail(context,email);if(!current(version))return;showAuth(user);byId('email').value='';status('email-message',user?.new_email?'확인 메일을 보냈습니다. 메일의 링크를 확인해 주세요.':'이메일 정보를 업데이트했습니다.','success');}
  catch(error){if(current(version))status('email-message',message(error,'변경 메일을 보내지 못했습니다. 새 주소를 확인하고 다시 시도해 주세요.'),'error');}
  finally{if(request===version){emailBusy=false;if(current())controls();}}
 }
 async function passwordSave(event){
  event.preventDefault();if(!current()||!baseline||saveBusy||emailBusy||passwordBusy)return;
  const version=request;
  if(byId('password-new').value!==byId('password-confirm').value){status('password-message','새 비밀번호가 서로 일치하지 않습니다.','error');return;}
  if(byId('password-new').value.length<8||!byId('password-current').value){status('password-message','현재 비밀번호와 8자 이상의 새 비밀번호를 입력해 주세요.','error');return;}
  passwordBusy=true;controls();status('password-message','비밀번호를 변경하는 중…');
  try{await bridge().changePassword(context,byId('password-current').value,byId('password-new').value);if(!current(version))return;status('password-message','비밀번호를 변경했습니다.','success');}
  catch(error){if(current(version))status('password-message',message(error,'비밀번호를 변경하지 못했습니다. 현재 비밀번호를 확인하고 다시 시도해 주세요.'),'error');}
  finally{if(request===version){clearPasswords();passwordBusy=false;if(current())controls();}}
 }
 function finishClose(){
  root.hidden=true;root.classList.remove('is-open');closing=false;baseline=null;context=null;clearPasswords();
  for(const id of ['name','company','phone','address','email'])byId(id).value='';byId('current-email').textContent='';byId('email-pending').textContent='';
  document.body.style.overflow=previousOverflow;clearTimeout(closeTimer);clearInterval(sessionTimer);sessionTimer=null;
  if(returnFocus?.isConnected&&bridge()?.context())returnFocus.focus({preventScroll:true});returnFocus=null;
 }
 function close({force=false}={}){
  if(root.hidden||closing)return true;
  if(!force&&(saveBusy||emailBusy||passwordBusy)){status('message','진행 중인 저장이 끝난 후 닫아 주세요.');return false;}
  if(!force&&dirty()&&!window.confirm('저장하지 않은 변경사항을 버리고 닫을까요?'))return false;
  ++request;closing=true;clearPasswords();root.classList.remove('is-open');
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  closeTimer=setTimeout(finishClose,reduced?0:290);return true;
 }
 async function open(){
  if(!root.hidden||closing)return;
  context=bridge()?.context();if(!context){window.alert('온라인 계정에 로그인한 뒤 프로필을 설정해 주세요.');return;}
  returnFocus=document.activeElement;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  baseline=null;saveBusy=false;emailBusy=false;passwordBusy=false;root.hidden=false;byId('email').value='';clearPasswords();
  for(const id of ['message','email-message','password-message'])status(id,'');root.querySelector('details').open=false;
  requestAnimationFrame(()=>{if(!root.hidden&&!closing){root.classList.add('is-open');panel.focus({preventScroll:true});}});
  sessionTimer=setInterval(()=>{if(!closing&&!root.hidden&&!bridge()?.current(context))close({force:true});},200);
  await load();
 }
 root.addEventListener('input',controls);byId('form').addEventListener('submit',save);byId('email-form').addEventListener('submit',emailSave);byId('password-form').addEventListener('submit',passwordSave);
 byId('close').addEventListener('click',()=>close());byId('reload').addEventListener('click',load);root.addEventListener('click',event=>{if(event.target===root)close();});
 document.addEventListener('keydown',event=>{
  if(root.hidden||closing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
  if(event.key==='Tab'){
   const controls=[...root.querySelectorAll('button,input,textarea,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
   const first=controls[0],last=controls[controls.length-1];if(!first)return;
   if(event.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!root.contains(document.activeElement))){event.preventDefault();first.focus();}
  }
 },true);
 window.addEventListener('beforeunload',event=>{if(!root.hidden&&dirty()){event.preventDefault();event.returnValue='';}});
 window.snoteProfileEditor=Object.freeze({open,close});
})();
