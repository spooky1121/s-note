/* Dealer receiving accounts. Never fall back to another account or a sample account. */
(() => {
 'use strict';
 const dialog=document.getElementById('snote-profile-dialog');
 const kinds=['vehicle','transfer'],labels={vehicle:'차대금',transfer:'이전비'};
 const empty=()=>({vehicle:null,transfer:null});
 const bridge=()=>window.snotePaymentAccountsBridge;
 const eligible=context=>!!context&&['dealer','admin'].includes(context.role);
 const contextNow=()=>{try{const context=bridge()?.context();return eligible(context)?context:null;}catch{return null;}};
 const isCurrent=context=>{try{return eligible(context)&&bridge()?.current(context)===true;}catch{return false;}};
 const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const fixedKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 const inputError=message=>Object.assign(Error(message),{code:'PAYMENT_INPUT'});
 const cleanText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;
 function account(value,kind){
  if(value===null)return null;
  if(!fixedKeys(value,['bank','number','holder']))throw inputError(labels[kind]+' 계좌의 은행명·계좌번호·예금주를 확인해 주세요.');
  const bank=cleanText(value.bank,35),holder=cleanText(value.holder,60),raw=cleanText(value.number,64);
  const number=raw===null?null:raw.replace(/\s/g,'');
  if(bank===''&&holder===''&&number==='')return null;
  if(!bank||!holder||!number)throw inputError(labels[kind]+' 계좌의 은행명·계좌번호·예금주를 모두 입력해 주세요.');
  if(!/^[0-9-]{6,32}$/.test(number)||number.replace(/-/g,'').length<6)throw inputError(labels[kind]+' 계좌번호를 숫자와 하이픈으로 입력해 주세요.');
  return {bank,number,holder};
 }
 function accounts(value){
  if(!fixedKeys(value,kinds))throw inputError('입금계좌 정보를 다시 확인해 주세요.');
  return Object.fromEntries(kinds.map(kind=>[kind,account(value[kind],kind)]));
 }
 function receipt(context,value){
  if(!plain(value)||value.user_id!==context.userId||value.company_id!==context.companyId||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('PAYMENT_RESPONSE');
  return {user_id:value.user_id,company_id:value.company_id,revision:value.revision,accounts:accounts(value.accounts)};
 }
 function changed(){window.dispatchEvent(new CustomEvent('snote:payment-accounts-changed'));}
 function paint(value){
  for(const kind of kinds){
   const item=value[kind];
   for(const host of document.querySelectorAll('[data-snote-payment-account="'+kind+'"]')){
    host.replaceChildren();
    if(item){
     const bank=document.createElement('strong'),number=document.createElement('span'),holder=document.createElement('span');
     bank.textContent=item.bank;number.className='snote-payment-document-number';number.textContent=' '+item.number;
     holder.className='snote-payment-document-holder';holder.textContent='예금주 · '+item.holder;
     host.append(bank,number,document.createElement('br'),holder);
    }
   }
   for(const row of document.querySelectorAll('[data-snote-payment-row="'+kind+'"]'))row.hidden=!item;
  }
  for(const section of document.querySelectorAll('[data-snote-payment-section]'))section.hidden=!kinds.some(kind=>value[kind]);
  changed();
 }
 let documentVersion=0,documentReady=false,documentContext=null;
 function documentState(){return {version:documentVersion,ready:documentReady&&(documentContext?isCurrent(documentContext):contextNow()===null)};}
 function clearDocument(){++documentVersion;documentReady=false;documentContext=null;paint(empty());}
 async function loadDocument(current=()=>true){
  // Establishing the first authenticated profile scope may reset document state.
  const context=contextNow();clearDocument();const version=documentVersion;
  if(!context){documentReady=true;return true;}
  const live=()=>{try{return version===documentVersion&&isCurrent(context)&&current()===true;}catch{return false;}};
  if(!live())return false;
  try{
   const result=receipt(context,await bridge().read(context));
   if(!live())return false;
   documentContext=context;documentReady=true;paint(result.accounts);return true;
  }catch{if(live())paint(empty());return false;}
 }

 let section,form,saveButton,reloadButton,message,profileContext=null,baseline=null,profileVersion=0,loading=false,saving=false;
 let presentation=null,settingsHost=null,readTask=null,editVersion=0;
 const fields={};
 function mount(){
  if(section)return true;
  const body=dialog?.querySelector('.snote-profile-body');if(!body)return false;
  section=document.createElement('section');section.id='snote-payment-profile';section.className='snote-profile-section snote-payment-profile';section.hidden=true;
  const heading=document.createElement('div');heading.className='snote-payment-profile-heading';
  const title=document.createElement('h3');title.textContent='내 입금계좌';heading.append(title);
  saveButton=document.createElement('button');saveButton.id='snote-payment-save';saveButton.type='submit';saveButton.setAttribute('form','snote-payment-form');saveButton.className='snote-payment-save';saveButton.setAttribute('aria-label','입금계좌 저장');saveButton.dataset.tooltip='입금계좌 저장';
  saveButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7M13 5v2"/></svg>';
  heading.append(saveButton);section.append(heading);
  form=document.createElement('form');form.id='snote-payment-form';form.autocomplete='off';form.noValidate=true;
  const grid=document.createElement('div');grid.className='snote-payment-fields';
  for(const kind of kinds){
   const fieldset=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=labels[kind]+' 계좌';fieldset.append(legend);fields[kind]={};
   for(const [key,label,max] of [['bank','은행명',35],['number','계좌번호',32],['holder','예금주',60]]){
    const host=document.createElement('label'),input=document.createElement('input');input.id='snote-payment-'+kind+'-'+key;input.name=kind+'-'+key;input.type='text';input.maxLength=max;input.autocomplete='off';input.spellcheck=false;input.placeholder=label;
    if(key==='number'){input.inputMode='text';input.setAttribute('aria-label',labels[kind]+' 계좌번호');}
    else input.setAttribute('aria-label',labels[kind]+' '+label);
    host.textContent=label;host.append(input);fieldset.append(host);fields[kind][key]=input;
   }
   grid.append(fieldset);
  }
  form.append(grid);section.append(form);
  const help=document.createElement('p');help.className='snote-payment-help';help.textContent='저장한 계좌만 견적서·계약서에 표시됩니다. 비워서 저장하면 표시하지 않습니다.';section.append(help);
  message=document.createElement('p');message.id='snote-payment-message';message.className='snote-profile-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');section.append(message);
  reloadButton=document.createElement('button');reloadButton.id='snote-payment-reload';reloadButton.type='button';reloadButton.className='snote-profile-text-button';reloadButton.textContent='다시 불러오기';reloadButton.hidden=true;section.append(reloadButton);
  const first=body.querySelector(':scope > .snote-profile-section');if(first)first.after(section);else body.append(section);
  form.addEventListener('submit',saveProfile);form.addEventListener('input',()=>{++editVersion;controls();});reloadButton.addEventListener('click',()=>void startRead(true));
  controls();return true;
 }
 function status(text,tone='info'){
  if(!message)return;message.textContent=text;message.dataset.tone=tone;message.hidden=!!text&&['error','success'].includes(tone);
  if(text&&['error','success'].includes(tone)){const version=profileVersion,context=profileContext;window.snoteNotify(text,{tone,key:'payment-accounts',isCurrent:()=>profileContext===context&&profileLive(version)});}
 }
 const rawFields=()=>Object.fromEntries(kinds.map(kind=>[kind,Object.fromEntries(['bank','number','holder'].map(key=>[key,fields[kind]?.[key]?.value||'']))]));
 function fieldSignature(value){return JSON.stringify(value);}
 function baselineFields(){return Object.fromEntries(kinds.map(kind=>[kind,baseline?.accounts[kind]||{bank:'',number:'',holder:''}]));}
 function editorDirty(){return !!baseline&&fieldSignature(rawFields())!==fieldSignature(baselineFields());}
 function profileDirty(){return presentation==='profile'&&editorDirty();}
 function profileBusy(){return presentation==='profile'&&saving;}
 function settingsRoute(){try{return typeof route==='string'&&route==='settings';}catch{return false;}}
 const settingsElement=()=>settingsRoute()?document.getElementById('snote-settings-payment-body'):null;
 const sameEditor=context=>!!context&&!!profileContext&&profileContext.key===context.key&&profileContext.client===context.client&&profileContext.role===context.role;
 const profileLive=version=>version===profileVersion&&!!profileContext&&isCurrent(profileContext)&&!!section&&section.isConnected&&!section.hidden&&
  (presentation==='profile'?dialog?.hidden===false&&dialog.contains(section):presentation==='settings'&&settingsRoute()&&settingsHost?.isConnected&&section.parentElement===settingsHost);
 function discardScope(){
  // Recheck the exact editor and draft after an asynchronous discard decision.
  const version=profileVersion,context=profileContext,snapshot=baseline,edit=editVersion,draft=fieldSignature(rawFields());
  return ()=>profileContext===context&&baseline===snapshot&&editVersion===edit&&profileLive(version)&&!loading&&!saving&&editorDirty()&&fieldSignature(rawFields())===draft;
 }
 function controls(){
  if(!section)return;const ready=!!baseline&&profileLive(profileVersion)&&!loading&&!saving;
  for(const input of section.querySelectorAll('input'))input.disabled=!ready;
  saveButton.disabled=!ready||!editorDirty();reloadButton.disabled=loading||saving;
  section.setAttribute('aria-busy',String(loading||saving));
 }
 function fill(value){baseline=value;for(const kind of kinds)for(const key of ['bank','number','holder'])fields[kind][key].value=value.accounts[kind]?.[key]||'';controls();}
 function errorMessage(error,fallback){
  if(error?.code==='PAYMENT_INPUT')return error.message;
  if(['40001','PAYMENT_ACCOUNTS_CONFLICT','PROFILE_CONFLICT','CONFLICT'].includes(error?.code))return '다른 화면에서 입금계좌가 변경되었습니다. 다시 불러온 후 저장해 주세요.';
  if(['42501','FORBIDDEN','UNAUTHORIZED','SNOTE_PROFILE_CONTEXT'].includes(error?.code))return '현재 계정의 입금계좌 권한을 확인해 주세요. 다시 로그인해야 할 수 있습니다.';
  return fallback;
 }
 async function readProfile(confirmDirty=false){
  if(!profileContext||!profileLive(profileVersion)||loading||saving)return false;
  if(confirmDirty&&editorDirty()){const live=discardScope();if(!await window.snoteConfirm('입력한 입금계좌를 버리고 다시 불러올까요?',{isCurrent:live})||!live())return false;}
  const context=profileContext;
  const version=++profileVersion;loading=true;baseline=null;for(const kind of kinds)for(const input of Object.values(fields[kind]))input.value='';controls();status('입금계좌를 불러오는 중…');reloadButton.hidden=true;
  try{
   const result=receipt(context,await bridge().read(context));
   if(!profileLive(version))return false;
   fill(result);status('');return true;
  }catch(error){
   if(profileLive(version)){clearDocument();status(errorMessage(error,'입금계좌를 불러오지 못했습니다. 다시 시도해 주세요.'),'error');reloadButton.hidden=false;}
   return false;
  }finally{if(version===profileVersion){loading=false;controls();}}
 }
 function startRead(confirmDirty=false){readTask=readProfile(confirmDirty);return readTask;}
 function clearEditor(){
  ++profileVersion;profileContext=null;baseline=null;loading=false;saving=false;readTask=null;presentation=null;
  if(section){for(const kind of kinds)for(const input of Object.values(fields[kind]))input.value='';section.hidden=true;status('');reloadButton.hidden=true;controls();}
 }
 function placeProfile(){
  const body=dialog?.querySelector('.snote-profile-body');if(!body)return false;
  const first=body.querySelector(':scope > .snote-profile-section');
  if(first&&first!==section)first.after(section);else body.append(section);
  presentation='profile';section.hidden=false;return true;
 }
 function mountSettings(host){
  if(!(host instanceof Element)||!host.isConnected||!settingsRoute()||!mount())return false;
  settingsHost=host;
  // The same editor may be in a visible profile drawer. Keep its draft there.
  if(presentation==='profile'&&dialog?.hidden===false)return false;
  const context=contextNow();if(!context){clearEditor();return false;}
  const preserve=sameEditor(context)&&(!!baseline||loading||saving);
  if(!preserve)clearEditor();
  profileContext=context;presentation='settings';host.append(section);section.hidden=false;controls();
  return preserve?(loading?(readTask||Promise.resolve(false)):Promise.resolve(!!baseline)):startRead();
 }
 async function openProfile({inline=false}={}){
  if(inline){const host=settingsElement();return host?mountSettings(host):false;}
  const context=contextNow();if(!context||!mount())return false;
  const preserve=sameEditor(context)&&(!!baseline||loading||saving);
  if(!preserve)clearEditor();
  profileContext=context;if(!placeProfile()){clearEditor();return false;}controls();
  return preserve?(loading?(readTask||false):!!baseline):startRead();
 }
 function closeProfile(){
  if(presentation!=='profile')return;
  clearEditor();const host=settingsElement();if(host)void mountSettings(host);
 }
 function prepareRouteChange(){
  if(presentation!=='settings')return true;
  if(!profileContext||!isCurrent(profileContext))return true;
  if(saving){status('입금계좌 저장이 끝난 후 이동해 주세요.');return false;}
  if(!editorDirty())return true;
  const live=discardScope();return window.snoteConfirm('저장하지 않은 입금계좌 변경사항을 버리고 이동할까요?',{isCurrent:live}).then(confirmed=>confirmed===true&&live());
 }
 async function focusSettings(){
  const host=settingsElement();if(!host)return false;
  const mounted=mountSettings(host);if(mounted===false)return false;
  if(!await mounted||!profileLive(profileVersion)||presentation!=='settings')return false;
  const kind=kinds.find(value=>!baseline.accounts[value])||'vehicle';
  section.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  fields[kind].bank.focus({preventScroll:true});return true;
 }
 async function ensureQuoteAccounts(current=()=>true){
  const context=contextNow();if(!context)return 'unavailable';
  const live=()=>{try{return isCurrent(context)&&current()===true;}catch{return false;}};
  if(!live())return 'stale';
  try{const result=receipt(context,await bridge().read(context));if(!live())return 'stale';return kinds.some(kind=>result.accounts[kind])?'registered':'missing';}
  catch{return live()?'unavailable':'stale';}
 }
 async function saveProfile(event){
  event?.preventDefault();const context=profileContext,version=profileVersion;
  if(!baseline||!profileLive(version)||loading||saving)return false;
  let value;
  try{value=accounts(rawFields());}catch(error){status(errorMessage(error,'입금계좌 내용을 확인해 주세요.'),'error');return false;}
  saving=true;controls();status('저장 중…');
  try{
   const result=receipt(context,await bridge().save(context,baseline.revision,value));
   if(!profileLive(version))return false;
   fill(result);++documentVersion;documentContext=context;documentReady=true;paint(result.accounts);status('저장되었습니다.','success');reloadButton.hidden=true;return true;
  }catch(error){if(profileLive(version)){status(errorMessage(error,'입금계좌를 저장하지 못했습니다. 입력 내용은 유지됩니다.'),'error');reloadButton.hidden=false;}return false;
  }finally{if(version===profileVersion){saving=false;controls();}}
 }
 function reset(){clearEditor();clearDocument();}
 mount();
 window.SnotePaymentAccounts=Object.freeze({openProfile,closeProfile,profileDirty,profileBusy,mountSettings,focusSettings,prepareRouteChange,ensureQuoteAccounts,clearDocument,loadDocument,documentState,reset});
 window.addEventListener('snote:route-changed',event=>{
  if(event.detail?.page==='settings'){const host=settingsElement();if(host)void mountSettings(host);}
  else if(presentation==='settings')clearEditor();
 });
 new MutationObserver(()=>{
  const host=settingsElement();
  if(host&&host!==settingsHost)void mountSettings(host);
  else if(presentation==='settings'&&(!host||section?.parentElement!==host)){clearEditor();settingsHost=null;}
 }).observe(document.body,{childList:true,subtree:true});
 const initialHost=settingsElement();if(initialHost)void mountSettings(initialHost);
})();
