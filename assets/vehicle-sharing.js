/* Vehicle-scoped sharing. Foreign datasets are never copied into this dealer's caches. */
(()=>{'use strict';if(window.snoteVehicleSharing)return;window.snoteVehicleSharing=true;
 const bridge=()=>window.snoteVehicleShareBridge,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const accepted=item=>item?.state==='accepted',states={pending:'응답 대기',accepted:'수락 완료',rejected:'거부 완료'};
 const permissions=Object.freeze({read:{label:'읽기',edit:false,delete:false,description:'차량 정보와 사진·서류 조회'},edit:{label:'수정',edit:true,delete:false,description:'조회 및 차량 정보 수정'},delete:{label:'삭제',edit:false,delete:true,description:'조회 및 차량을 휴지통으로 이동'},all:{label:'모든 권한',edit:true,delete:true,description:'조회·차량 정보 수정·휴지통 이동'}});
 const preset=value=>typeof value==='string'&&Object.hasOwn(permissions,value)?permissions[value]:null;
 const routePage=()=>typeof route==='string'?route:'',inSales=()=>routePage()==='sell';
 const symbol='<svg class="snote-share-action-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
 const disk='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7M13 5v2"/></svg>';
 const trash='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
 const dialog=document.createElement('dialog');dialog.id='snote-vehicle-sharing';dialog.setAttribute('aria-labelledby','vehicle-sharing-title');dialog.innerHTML='<div class="vehicle-sharing-frame"><button type="button" class="snote-popup-close" aria-label="차량 공유 닫기">×</button><header><h2 id="vehicle-sharing-title">차량 공유</h2><p id="vehicle-sharing-subtitle"></p></header><p id="vehicle-sharing-status" role="status"></p><main id="vehicle-sharing-body"></main></div>';document.body.append(dialog);
 const body=dialog.querySelector('main'),status=dialog.querySelector('[role=status]'),title=dialog.querySelector('h2'),subtitle=dialog.querySelector('header p');let session=null,sequence=0,urls=[];
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
 const current=s=>session===s&&dialog.open&&!inSales()&&bridge()?.current(s.context);
 const grant=value=>UUID.test(value?.invitationId||'')&&Number.isSafeInteger(value?.version)&&value.version>0?{invitationId:value.invitationId,version:value.version}:null;
 const sameGrant=(a,b)=>a===null&&b===null||!!a&&!!b&&a.invitationId===b.invitationId&&a.version===b.version;
 function capability(value){const p=preset(value?.permission),access=grant(value),native=value?.nativeAccess===true&&value.permission==='all'&&value.invitationId===null&&value.version===null;
  const valid=value?.apiVersion===2&&value.canRead===true&&!!p&&value.canEdit===p.edit&&value.canDelete===p.delete&&(native||value.nativeAccess===false&&!!access);
  return {permission:valid?value.permission:null,canEdit:valid&&p.edit,canDelete:valid&&p.delete,access:native?null:access,valid};}
 function release(){urls.forEach(URL.revokeObjectURL);urls=[];}
 function close(){++sequence;if(session?.timer)clearInterval(session.timer);if(session?.permissionTimer)clearInterval(session.permissionTimer);session=null;release();dialog.close();body.replaceChildren();status.textContent='';}
 dialog.querySelector('.snote-popup-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 function error(e){const message=String(e?.message||'');return /INVALID_VEHICLE_MEMO/.test(message)?'차량 메모는 제어문자 없이 2,000자 이내로 입력해 주세요.':/SHARE_ACCESS_CHANGED/.test(message)?'공유 권한이 변경되었습니다. 최신 권한을 확인해 주세요.':/CAR_NOT_FOUND/.test(message)?'차량이 삭제되었거나 더 이상 공유되지 않습니다.':/CONFLICT/.test(message)?'다른 딜러가 먼저 수정했습니다. 다시 불러온 뒤 변경해 주세요.':/DEALER_NOT_FOUND/.test(message)?'이메일이 일치하는 활성 딜러 계정을 찾을 수 없습니다.':/SELF_SHARE/.test(message)?'본인 차량은 본인에게 공유할 수 없습니다.':/SHARE_LIMIT/.test(message)?'차량당 최대 30명까지 공유할 수 있습니다.':/FORBIDDEN|SHARE_ACCESS_REQUIRED|42501/.test(message+' '+e?.code)?'차량 공유 권한이 없거나 공유가 해제되었습니다.':/PGRST202|42P01/.test(e?.code||'')?'차량 공유 DB 연결을 확인해 주세요.':'서버 응답을 확인하지 못했습니다. 입력은 유지되며 다시 시도할 수 있습니다.';}
 function note(message,bad=false){status.textContent=message;status.classList.toggle('is-error',bad);}
 const scope=(s,action,extra={})=>({p_action:action,p_company:s.companyId,p_owner:s.ownerId,p_car:s.carId,...extra});
 async function request(s,action,extra={}){const view=s.view;if(!current(s))throw Error('CONTEXT_CHANGED');const value=await bridge().rpc(s.context,scope(s,action,extra));if(!current(s)||s.view!==view)throw Error('CONTEXT_CHANGED');return value;}
 function changed(){window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));window.dispatchEvent(new Event('snote-vehicle-changed'));}
 function permissionSelect(value,label){const select=node('select');select.setAttribute('aria-label',label);for(const[key,p]of Object.entries(permissions)){const option=node('option',p.label);option.value=key;select.append(option);}select.value=preset(value)?value:'read';return select;}
 function begin(label){if(inSales())return null;close();const context=bridge()?.context();title.textContent=label;subtitle.textContent='';dialog.showModal();if(!context){note('온라인 딜러 계정으로 로그인한 뒤 이용해 주세요.',true);return null;}const s={context,id:++sequence,permissionDrafts:new Map()};session=s;note('불러오는 중…');s.timer=setInterval(()=>{if(session!==s){clearInterval(s.timer);return;}if(!bridge()?.current(context)||inSales())close();},250);return s;}
 async function outgoing(s){
  const revision=s.outgoingVersion=(s.outgoingVersion||0)+1,entries=await request(s,'outgoing');if(!current(s)||s.outgoingVersion!==revision)return;if(!Array.isArray(entries))throw Error('INVALID_RESPONSE');
  const list=body.querySelector('.vehicle-sharing-recipients');if(!list)return;list.replaceChildren();if(!entries.length)list.append(node('p','아직 초대한 딜러가 없습니다.','vehicle-sharing-empty'));
  for(const item of entries){const row=node('div',null,'vehicle-sharing-recipient'),info=node('div'),actions=node('div',null,'vehicle-sharing-recipient-actions');row.dataset.shareState=states[item.state]?item.state:'unknown';
   const access=grant(item),known=!!preset(item.permission)&&!!access,editable=known&&item.state!=='rejected',draft=s.permissionDrafts.get(item.invitationId);
   info.append(node('strong',item.name||'딜러'),node('small',item.email),node('span',(states[item.state]||'상태 확인 필요')+' · '+(preset(item.permission)?.label||'권한 확인 필요'),'vehicle-sharing-state'));
   const select=permissionSelect(item.permission,(item.email||'딜러')+' 공유 권한');if(!known){const unknown=node('option','권한 확인 필요');unknown.value='';select.prepend(unknown);select.value='';}
   if(draft&&draft.version===item.version&&preset(draft.permission))select.value=draft.permission;
   const save=node('button',null,'vehicle-sharing-permission-save');save.type='button';save.innerHTML=disk;save.setAttribute('aria-label',(item.email||'딜러')+' 공유 권한 저장');save.dataset.tooltip='공유 권한 저장';select.disabled=!editable;save.disabled=!editable||select.value===item.permission;
   select.onchange=()=>{if(!editable)return;s.permissionDrafts.set(item.invitationId,{permission:select.value,version:item.version});save.disabled=select.value===item.permission;};
   const text=accepted(item)?'공유 해제':item.state==='pending'?'초대 취소':'초대 기록 삭제',remove=node('button',text);remove.type='button';
   save.onclick=async()=>{if(!current(s)||!editable||!preset(select.value)||select.value===item.permission||row.dataset.busy==='true')return;const desired=select.value;row.dataset.busy='true';select.disabled=true;save.disabled=true;remove.disabled=true;
    try{const result=await request(s,'permissions',{p_target:item.id,p_permission:desired,p_access:access});
     if(result?.ok!==true||result.apiVersion!==2||result.recipientId!==item.id||result.invitationId!==access.invitationId||!Number.isSafeInteger(result.version)||result.version<=access.version||result.permission!==desired||!states[result.state])throw Error('INVALID_RESPONSE');
     if(current(s)){s.permissionDrafts.delete(item.invitationId);await outgoing(s);note('공유 권한을 저장했습니다.');changed();}
    }catch(e){if(current(s)){note(error(e),true);select.value=item.permission;s.permissionDrafts.delete(item.invitationId);try{await outgoing(s);}catch(_){}}}
    finally{row.dataset.busy='false';if(current(s)&&row.isConnected){select.disabled=!editable;save.disabled=select.value===item.permission;remove.disabled=false;}}
   };
   remove.onclick=async()=>{if(!current(s)||row.dataset.busy==='true'||!confirm((item.email||'딜러')+'님의 '+(accepted(item)?'차량 공유를 해제할까요?':item.state==='pending'?'차량 공유 초대를 취소할까요?':'초대 기록을 삭제할까요?')))return;row.dataset.busy='true';remove.disabled=true;select.disabled=true;save.disabled=true;
    try{const result=await request(s,'revoke',{p_target:item.id});if(result?.ok!==true||result.apiVersion!==2)throw Error('INVALID_RESPONSE');if(current(s)){s.permissionDrafts.delete(item.invitationId);await outgoing(s);note(accepted(item)?'공유를 해제했습니다.':'초대 기록을 삭제했습니다.');changed();}}
    catch(e){if(current(s)){note(error(e),true);row.dataset.busy='false';remove.disabled=false;select.disabled=!editable;save.disabled=!editable||select.value===item.permission;}}
   };
   actions.append(select,save,remove);row.append(info,actions);list.append(row);
  }
 }
 async function ownerOpen(){
  if(inSales())return;const car=typeof cars!=='undefined'?cars.find(c=>c.id===activeCarId):null,s=begin('차량 공유 초대');if(!s)return;s.mode='owner';s.companyId=s.context.companyId;s.ownerId=bridge().owner(car);s.carId=car?.id;
  if(!s.ownerId||!s.carId){note('차량 소유자를 확인하지 못했습니다.',true);return;}subtitle.textContent=[car.model,car.plate].filter(Boolean).join(' · ');
  const form=node('form',null,'vehicle-sharing-invite'),label=node('label','공유할 딜러 이메일'),input=node('input');input.type='email';input.required=true;input.maxLength=254;input.autocomplete='off';input.placeholder='dealer@example.com';input.setAttribute('aria-label','공유할 딜러 이메일');label.append(input);
  const rights=node('label','권한'),select=permissionSelect('read','새 공유 권한');rights.className='vehicle-sharing-invite-permission';rights.append(select);
  const add=node('button','초대 전송');add.type='submit';form.append(label,rights,add);
  body.append(form,node('p','상대 딜러가 프로필 알림에서 수락한 뒤 선택한 권한으로 공유됩니다. 읽기·수정·삭제·모든 권한 중 선택할 수 있으며, 고객 개인정보와 재공유 권한은 포함하지 않습니다. 사진·서류는 조회할 수 있습니다.','vehicle-sharing-help'),node('section',null,'vehicle-sharing-recipients'));
  form.onsubmit=async event=>{event.preventDefault();if(!form.reportValidity()||s.sending||!preset(select.value))return;const email=input.value.trim(),permission=select.value;s.sending=true;add.disabled=true;
   try{await bridge().flush(s.context);const result=await request(s,'grant',{p_email:email,p_permission:permission});
    if(result?.ok!==true||result.apiVersion!==2||!states[result.state]||!UUID.test(result.invitationId||'')||!Number.isSafeInteger(result.version)||result.version<1||!preset(result.permission))throw Error('INVALID_RESPONSE');
    if(current(s)){await outgoing(s);if(input.value.trim()===email)input.value='';note(result.state==='pending'?'차량 공유 초대를 보냈습니다. 상대가 수락하면 공유됩니다.':result.state==='accepted'?'이미 초대를 수락한 딜러입니다.':'이미 거부한 초대입니다. 초대 기록을 삭제한 뒤 다시 보낼 수 있습니다.');changed();}
   }catch(e){if(current(s))note(error(e),true);}finally{s.sending=false;if(current(s))add.disabled=false;}
  };
  try{await bridge().flush(s.context);await outgoing(s);if(current(s)){note('등록된 딜러 이메일과 공유 권한을 선택하세요.');input.focus();}}catch(e){if(current(s))note(error(e),true);}
 }
 async function inbox(){const s=begin('공유받은 차량');if(!s)return;s.mode='inbox';try{const response=await bridge().rpc(s.context,{p_action:'incoming'});if(!current(s))return;if(!Array.isArray(response))throw Error('INVALID_RESPONSE');const items=response.filter(accepted);note('수락한 차량만 표시합니다. 공유 초대는 프로필의 알림에서 확인해 주세요.');const list=node('div',null,'vehicle-sharing-cars');body.append(list);if(!items.length)list.append(node('p','수락한 공유 차량이 없습니다.','vehicle-sharing-empty'));
   for(const item of items){const button=node('button',null,'vehicle-sharing-car');button.type='button';button.append(node('strong',item.model||'차량'),node('span',[item.plate,item.ownerName,preset(item.permission)?.label||'권한 확인 필요'].filter(Boolean).join(' · ')));button.onclick=()=>edit(s,item);list.append(button);}
  }catch(e){if(current(s))note(error(e),true);}}
 const fields=[['model','차명'],['plate','차량번호'],['make','제조사'],['year','연식'],['vin','차대번호'],['mileage','주행거리'],['color','색상'],['purchaseAt','매입일'],['buy','매입가'],['sell','판매예정가'],['vehicleMemo','차량 메모']];
 function normalizeVehicleMemo(value){const text=value.replace(/\r\n?/g,'\n');if(text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw Error('INVALID_VEHICLE_MEMO');return text;}
 function setCapabilities(s,value){s.capabilities=capability(value);const p=preset(s.capabilities.permission);if(s.permissionLabel)s.permissionLabel.textContent=p?'공유 권한 · '+p.label+' — '+p.description:'공유 권한을 확인하지 못해 읽기 전용으로 표시합니다.';
  if(s.form)for(const[key]of fields){const input=s.form.elements.namedItem(key);if(input)input.readOnly=!s.capabilities.canEdit;}
  if(s.save){s.save.hidden=!s.capabilities.canEdit;s.save.disabled=s.saving===true||!s.capabilities.canEdit;}
  if(s.remove){s.remove.hidden=!s.capabilities.canDelete;s.remove.disabled=s.deleting===true||!s.capabilities.canDelete;}
  return s.capabilities;
 }
 function denyEditor(s,e){if(!current(s))return;setCapabilities(s,{});if(/FORBIDDEN|CAR_NOT_FOUND|42501/.test(String(e?.message)+' '+e?.code)){s.view++;release();body.replaceChildren(node('p','차량이 삭제되었거나 공유가 해제되었습니다. 공유 목록을 다시 확인해 주세요.','vehicle-sharing-empty'));const back=node('button','공유 목록');back.type='button';back.onclick=inbox;body.append(back);s.mode='unavailable';}note(error(e),true);}
 async function checkAccess(s){if(!current(s)||s.mode!=='editor'||s.checking)return false;const view=s.view;s.checking=true;try{const value=await request(s,'read');if(!current(s)||s.view!==view)return false;setCapabilities(s,value);return s.capabilities.valid;}catch(e){if(current(s)&&s.view===view)denyEditor(s,e);return false;}finally{s.checking=false;}}
 async function edit(s,item){
  s.view=(s.view||0)+1;s.mode='editor';Object.assign(s,{companyId:item.companyId,ownerId:item.ownerId,carId:item.carId,saving:false,deleting:false,deleteRequest:null});s.form=null;s.save=null;s.remove=null;body.replaceChildren();release();note('차량 정보를 불러오는 중…');
  try{const result=await request(s,'read');if(!current(s)||!result?.car||!Number.isSafeInteger(result.revision)||result.revision<0)throw Error('INVALID_RESPONSE');
   const raw=result.car,car=window.SnoteMoney.car(raw);subtitle.textContent=[item.ownerName,car.plate].filter(Boolean).join(' · ');const form=node('form',null,'vehicle-sharing-editor'),grid=node('div',null,'vehicle-sharing-fields');
   s.permissionLabel=node('p',null,'vehicle-sharing-permission-label');body.append(s.permissionLabel);
   for(const[key,labelText]of fields){const label=node('label',labelText),input=node(key==='vehicleMemo'?'textarea':'input');input.name=key;input.maxLength=key==='vehicleMemo'?2000:200;input.setAttribute('aria-label',labelText);
    if(key==='vehicleMemo'){input.rows=4;input.className='vehicle-sharing-memo-input';label.classList.add('vehicle-sharing-memo-field');}
    input.value=key==='vehicleMemo'?(typeof car[key]==='string'?car[key]:''):car[key]??'';
    if(['buy','sell','mileage'].includes(key)){input.inputMode='numeric';input.value=Number(car[key]||0).toLocaleString('ko-KR');input.oninput=()=>{const value=input.value.replace(/\D/g,'');input.value=value?Number(value).toLocaleString('ko-KR'):'';};}else if(key==='purchaseAt')input.type='date';
    if(['model','plate'].includes(key))input.required=true;label.append(input);grid.append(label);
   }
   const save=node('button',null,'vehicle-sharing-save');save.type='submit';save.setAttribute('aria-label','공유 차량 저장');save.dataset.tooltip='공유 차량 저장';save.innerHTML=disk;
   const remove=node('button',null,'vehicle-sharing-delete');remove.type='button';remove.setAttribute('aria-label','공유 차량 삭제');remove.dataset.tooltip='공유 차량 삭제';remove.innerHTML=trash;
   const back=node('button','공유 목록');back.type='button';back.onclick=()=>{if(!s.capabilities?.canEdit||confirm('입력한 내용을 닫고 공유 목록으로 돌아갈까요?'))inbox();};
   const actions=node('div',null,'vehicle-sharing-editor-actions');actions.append(back,save,remove);form.append(grid,actions);body.append(form);Object.assign(s,{form,save,remove,revision:result.revision});setCapabilities(s,result);note(s.capabilities.valid?'서버에서 불러온 최신 차량입니다.':'공유 권한을 확인하지 못해 읽기 전용으로 표시합니다.',!s.capabilities.valid);
   form.onsubmit=async event=>{event.preventDefault();if(!current(s)||!s.capabilities?.canEdit||!form.reportValidity()||s.saving||s.deleting)return;
    s.saving=true;save.disabled=true;const view=s.view,submitted=JSON.stringify([...new FormData(form)]),patch={};
    try{for(const[key]of fields){const value=form.elements.namedItem(key).value;patch[key]=key==='vehicleMemo'?normalizeVehicleMemo(value):['buy','sell','mileage'].includes(key)?Number(value.replace(/,/g,'')):value.trim();}
     if(raw.moneyUnit!=='KRW'){patch.buy=SnoteMoney.legacy(patch.buy);patch.sell=SnoteMoney.legacy(patch.sell);}
     const access=s.capabilities.access,saved=await request(s,'update',{p_expected:s.revision,p_patch:patch,p_access:access});
     if(saved?.apiVersion!==2||!Number.isSafeInteger(saved.revision)||saved.revision<=s.revision)throw Error('INVALID_RESPONSE');
     if(current(s)&&s.view===view&&s.capabilities.canEdit&&sameGrant(s.capabilities.access,access)){s.revision=saved.revision;note(submitted===JSON.stringify([...new FormData(form)])?'공유 차량을 서버에 저장했습니다.':'저장 중 추가로 수정한 내용이 있습니다. 다시 저장해 주세요.');}
    }catch(e){if(current(s)&&s.view===view){note(error(e),true);if(/FORBIDDEN|SHARE_ACCESS|42501/.test(String(e?.message)+' '+e?.code))await checkAccess(s);}}
    finally{s.saving=false;if(current(s)&&s.view===view)save.disabled=!s.capabilities?.canEdit;}
   };
   remove.onclick=async()=>{if(!current(s)||!s.capabilities?.canDelete||s.saving||s.deleting||!confirm('이 공유 차량을 휴지통으로 이동할까요? 차량 소유자가 휴지통에서 복원할 수 있습니다.'))return;
    const view=s.view,op=s.deleteRequest||(s.deleteRequest={requestId:crypto.randomUUID(),expected:s.revision,access:s.capabilities.access});s.deleting=true;remove.disabled=true;save.disabled=true;
    try{const result=await request(s,'delete',{p_expected:op.expected,p_patch:{requestId:op.requestId},p_access:op.access});
     if(result?.ok!==true||result.carId!==s.carId||result.requestId!==op.requestId||result.deleted!==true||typeof result.alreadyProcessed!=='boolean')throw Error('INVALID_RESPONSE');
     if(current(s)&&s.view===view){s.view++;s.mode='deleted';release();body.replaceChildren(node('p','차량을 휴지통으로 이동했습니다. 차량 소유자가 복원할 수 있습니다.','vehicle-sharing-empty'));const back=node('button','공유 목록');back.type='button';back.onclick=inbox;body.append(back);note('공유 차량을 삭제했습니다.');changed();}
    }catch(e){if(current(s)&&s.view===view){note(error(e),true);if(/FORBIDDEN|SHARE_ACCESS|CONFLICT|42501|40001/.test(String(e?.message)+' '+e?.code))s.deleteRequest=null;if(/FORBIDDEN|SHARE_ACCESS|42501/.test(String(e?.message)+' '+e?.code))await checkAccess(s);}}
    finally{s.deleting=false;if(current(s)&&s.view===view){remove.disabled=!s.capabilities?.canDelete;save.disabled=!s.capabilities?.canEdit;}}
   };
   const refresh=node('button','최신 정보 다시 불러오기','vehicle-sharing-refresh');refresh.type='button';refresh.onclick=()=>{if(!s.capabilities?.canEdit||confirm('현재 입력 대신 서버의 최신 정보를 불러올까요?'))edit(s,item);};body.append(refresh);await files(s);
   if(!s.permissionTimer)s.permissionTimer=setInterval(()=>void checkAccess(s),15000);
  }catch(e){if(current(s))note(error(e),true);}
 }
 async function files(s){const view=s.view;try{const items=await request(s,'media',{p_access:s.capabilities?.access});if(!current(s)||s.view!==view||!Array.isArray(items)||!items.length)return;const gallery=node('section',null,'vehicle-sharing-files');gallery.append(node('h3','사진 · 서류'));body.append(gallery);
  for(const item of items){const button=node('button',item.group==='photos'?'차량 사진':item.group==='registration'?'자동차등록증':'성능기록부');button.type='button';button.onclick=async()=>{button.disabled=true;try{const blob=await bridge().file(s.context,item.path);if(!current(s)||s.view!==view)return;const url=URL.createObjectURL(blob);urls.push(url);const image=node('img');image.src=url;image.alt=item.name||button.textContent;button.replaceWith(image);}catch(e){if(current(s)){note(error(e),true);button.disabled=false;}}};gallery.append(button);}
 }catch(e){if(current(s))note('사진·서류를 불러오지 못했습니다. 공유 상태를 다시 확인해 주세요.',true);}}
 function mount(){const save=document.getElementById('vehicle-header-save');if(save&&!document.getElementById('vehicle-header-share')){const button=node('button',null,'vehicle-header-action');button.id='vehicle-header-share';button.type='button';button.setAttribute('aria-label','딜러와 차량 공유');button.dataset.tooltip='딜러와 차량 공유';button.innerHTML=symbol;button.onclick=ownerOpen;save.after(button);}const group=document.querySelector('#list-screen .zc-list-actions');if(group&&!document.getElementById('vehicle-shared-inbox')){const button=node('button',null,'vehicle-header-action');button.id='vehicle-shared-inbox';button.type='button';button.setAttribute('aria-label','공유받은 차량');button.dataset.tooltip='공유받은 차량';button.innerHTML=symbol;button.onclick=inbox;group.append(button);}}
 function routeVisibility(){const hidden=inSales();for(const id of ['vehicle-header-share','vehicle-shared-inbox']){const button=document.getElementById(id);if(button)button.hidden=hidden;}if(hidden&&dialog.open)close();}
 mount();routeVisibility();window.addEventListener('snote:route-changed',routeVisibility);window.addEventListener('snote-vehicle-sharing-updated',()=>{if(session?.mode==='editor')void checkAccess(session);});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session?.mode==='editor')void checkAccess(session);});
 new MutationObserver(routeVisibility).observe(document.getElementById('list-screen')||document.body,{subtree:true,childList:true});
 window.addEventListener('pagehide',close);
})();
