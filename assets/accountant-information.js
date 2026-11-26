/* Company information editor. The host owns authentication; business records never enter browser storage. */
(()=>{'use strict';
 if(window.SnoteAccountantInformation)return;
 const TABS=Object.freeze({accounts:'계좌',contacts:'전화번호',staff:'직원'}),PAGE_SIZE=30;
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const svg=name=>{const e=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(e.namespaceURI,'path');e.setAttribute('viewBox','0 0 24 24');e.setAttribute('aria-hidden','true');e.setAttribute('fill','none');e.setAttribute('stroke','currentColor');e.setAttribute('stroke-width','1.7');e.setAttribute('stroke-linecap','round');e.setAttribute('stroke-linejoin','round');p.setAttribute('d',({plus:'M12 5v14M5 12h14',edit:'m4 16-1 5 5-1L20 8l-4-4L4 16m10-10 4 4',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',refresh:'M20 4v6h-6M4 20v-6h6M5 9a7 7 0 0 1 12-4l3 4M4 15l3 4a7 7 0 0 0 12-4',group:'M3 7V4h7l2 3h9v13H3z',search:'m16 16 5 5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0'})[name]);e.append(p);return e;};
 function button(text,cls='snote-info-button'){const e=node('button',cls,text);e.type='button';return e;}
 function iconButton(name,label,attr,id){const e=button('', 'snote-info-icon-button');e.append(svg(name));e.setAttribute('aria-label',label);e.title=label;if(attr)e.dataset[attr]=id;return e;}
 function field(form,name,label,{type='text',max=100,required=false,multiline=false}={}){const wrap=node('label','snote-info-field'),caption=node('span','',label),input=node(multiline?'textarea':'input');input.name=name;input.id=form.id+'-'+name;input.maxLength=max;input.required=required;if(multiline)input.rows=3;else input.type=type;input.autocomplete='off';wrap.append(caption,input);return {wrap,input};}
 const CELL_FIELDS=Object.freeze({accounts:['bankName','accountNumber','memo'],contacts:['name','phone','groupId','memo'],staffContacts:['name','phone','memo']});
 const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 function inlineController(options){
  const rows=new Map(),queue=[],queued=new Set(),delay=options.delay??700;let alive=true,pumping=null;
  const clone=value=>JSON.parse(JSON.stringify(value)),live=()=>alive&&options.current()===true;
  const fields=entry=>CELL_FIELDS[entry.kind]||[],changed=entry=>fields(entry).some(key=>entry.draft[key]!==entry.base[key]);
  const blank=entry=>entry.kind!=='staffContacts'&&entry.base.revision===0&&fields(entry).every(key=>entry.draft[key]===null||String(entry.draft[key]??'').trim()==='');
  function emit(entry){if(live())options.onChange?.(entry);}
  function clearTimer(entry){clearTimeout(entry.timer);entry.timer=null;}
  function ensure(kind,row){const key=kind+':'+row.id;if(rows.has(key))return rows.get(key);const entry={key,kind,base:clone(row),draft:clone(row),status:'saved',error:null,remote:null,timer:null,flight:null,attempt:null,composing:new Set()};rows.set(key,entry);return entry;}
  function rekey(entry,id){const next=entry.kind+':'+id;if(next===entry.key)return;const previous=entry.key,wasQueued=queued.delete(previous);rows.delete(previous);entry.previousKey=previous;entry.key=next;rows.set(next,entry);for(let i=0;i<queue.length;i++)if(queue[i]===previous)queue[i]=next;if(wasQueued)queued.add(next);}
  function checked(entry){try{const value={id:entry.draft.id,revision:entry.base.revision};if(entry.kind==='staffContacts')value.memberId=entry.draft.memberId;for(const field of fields(entry))value[field]=entry.draft[field];return options.validate(entry.kind,value);}catch{return null;}}
  function schedule(entry){clearTimer(entry);if(!live()||entry.composing.size||entry.attempt||entry.status==='conflict')return;entry.timer=setTimeout(()=>{entry.timer=null;submit(entry);},delay);}
  function edit(entry,field,value){if(!live()||!rows.has(entry.key)||!fields(entry).includes(field))return;entry.draft[field]=value;if(entry.status!=='conflict'&&!entry.attempt){entry.status=changed(entry)?'pending':'saved';entry.error=null;}schedule(entry);emit(entry);}
  function compose(entry,field,value){if(value){entry.composing.add(field);clearTimer(entry);}else{entry.composing.delete(field);schedule(entry);}}
  function latest(entry){const records=options.snapshot()?.[entry.kind]||[];return records.find(row=>row.id===entry.base.id)||(entry.kind==='staffContacts'?records.find(row=>row.memberId===entry.base.memberId):null)||null;}
  function reconcile(snapshot){
   if(!live())return;const byKind=new Map(Object.keys(CELL_FIELDS).map(kind=>[kind,new Map((snapshot?.[kind]||[]).map(row=>[row.id,row]))])),byMember=new Map((snapshot?.staffContacts||[]).map(row=>[row.memberId,row]));for(const entry of [...rows.values()]){
    if(entry.flight)continue;const remote=byKind.get(entry.kind)?.get(entry.base.id)||(entry.kind==='staffContacts'?byMember.get(entry.base.memberId):null)||null;
    if(!remote){if(entry.base.revision>0&&snapshot?.loaded&&!entry.attempt){entry.remote=null;entry.status='conflict';entry.error={code:'INFORMATION_RECORD_UNAVAILABLE'};clearTimer(entry);}continue;}
    if(!changed(entry)&&!entry.attempt){entry.base=clone(remote);entry.draft=clone(remote);rekey(entry,remote.id);entry.remote=null;entry.status='saved';entry.error=null;}
    else if((remote.id!==entry.base.id||remote.revision!==entry.base.revision)&&!entry.attempt){entry.remote=clone(remote);entry.status='conflict';entry.error={code:'INFORMATION_CONFLICT'};clearTimer(entry);}
   }
  }
  function submit(entry,{report=false,retry=false}={}){
   clearTimer(entry);if(!live()||!rows.has(entry.key)||entry.composing.size)return false;
   if(entry.flight){if(!queued.has(entry.key)){queued.add(entry.key);queue.push(entry.key);}return true;}
   if(!changed(entry)&&!entry.attempt){entry.status='saved';emit(entry);return true;}
   if(blank(entry))return true;
   if(entry.status==='conflict'||entry.status==='error'&&!retry)return false;
   const desired=entry.attempt?.payload||checked(entry);if(!desired){if(report){entry.status='invalid';entry.error={code:'INFORMATION_INVALID_RECORD'};emit(entry);}return false;}
   entry.status='pending';if(!queued.has(entry.key)){queued.add(entry.key);queue.push(entry.key);}emit(entry);void pump();return true;
  }
  function pump(){
   if(pumping)return pumping;pumping=Promise.resolve().then(async()=>{
    while(live()&&queue.length){const key=queue.shift();queued.delete(key);const entry=rows.get(key);if(!entry||entry.composing.size||entry.status==='conflict')continue;
     if(!changed(entry)&&!entry.attempt){entry.status='saved';emit(entry);continue;}
     const payload=entry.attempt?.payload||checked(entry);if(!payload||blank(entry))continue;
     const flight=entry.attempt||{payload:clone(payload),raw:clone(entry.draft),expected:entry.base.revision};entry.flight=flight;entry.status='saving';emit(entry);
     let result;try{result=await options.save(entry.kind,flight.payload,flight.expected);}catch(error){result={ok:false,error};}
     if(!live())return;entry.flight=null;
     if(result?.ok===true){
      const saved=latest(entry)||result.record;if(!saved){entry.status='error';entry.error={code:'INFORMATION_ACK_INVALID'};entry.attempt=flight;emit(entry);continue;}
      for(const field of fields(entry))if(entry.draft[field]===flight.raw[field])entry.draft[field]=saved[field];entry.base=clone(saved);entry.draft.id=saved.id;entry.draft.revision=saved.revision;rekey(entry,saved.id);if(entry.created){entry.created=false;entry.pinUntilBlur=true;}entry.attempt=null;entry.remote=null;entry.error=null;entry.status=changed(entry)?'pending':'saved';
      if(changed(entry)&&!queued.has(entry.key))schedule(entry);
     }else{
      clearTimer(entry);entry.error=result?.error||{code:'INFORMATION_NETWORK'};entry.remote=latest(entry);entry.attempt=result?.uncertain===true?flight:null;entry.status=/CONFLICT|RECORD_UNAVAILABLE/.test(entry.error.code)?'conflict':'error';queued.delete(entry.key);for(let i=queue.length-1;i>=0;i--)if(queue[i]===entry.key)queue.splice(i,1);
     }
     emit(entry);
    }
   }).finally(()=>{pumping=null;if(live()&&queue.length)void pump();});return pumping;
  }
  async function flush(){
   if(!live())return false;for(const entry of rows.values())if(changed(entry)&&!blank(entry))submit(entry,{report:true});
   if(pumping)await pumping;if(!live())return false;
   // Include valid edits typed while the preceding acknowledged write was in flight.
   for(const entry of rows.values())if(changed(entry)&&!blank(entry)&&entry.status==='pending')submit(entry,{report:true});
   if(pumping)await pumping;return live()&&![...rows.values()].some(entry=>changed(entry)&&!blank(entry)||entry.flight||entry.attempt);
  }
  function drop(entry){if(entry.flight||entry.attempt)return false;clearTimer(entry);rows.delete(entry.key);queued.delete(entry.key);for(let i=queue.length-1;i>=0;i--)if(queue[i]===entry.key)queue.splice(i,1);return true;}
  function discard(entry){if(entry.flight||entry.attempt)return false;clearTimer(entry);if(entry.base.revision===0)return drop(entry);const remote=latest(entry);if(!remote)return drop(entry);entry.base=clone(remote);entry.draft=clone(remote);rekey(entry,remote.id);entry.status='saved';entry.error=null;entry.remote=null;emit(entry);return true;}
  function retry(entry){if(!live())return false;if(entry.status==='conflict')return false;entry.status='pending';return submit(entry,{report:true,retry:true});}
  function rebase(entry){if(!live()||entry.flight||entry.attempt||!entry.remote)return false;const local=Object.fromEntries(fields(entry).filter(field=>entry.draft[field]!==entry.base[field]).map(field=>[field,entry.draft[field]]));entry.base=clone(entry.remote);entry.draft={...clone(entry.remote),...local};rekey(entry,entry.base.id);entry.status='pending';entry.error=null;entry.remote=null;return submit(entry,{report:true,retry:true});}
  return Object.freeze({ensure,edit,compose,submit,reconcile,flush,drop,discard,retry,rebase,changed,blank,entries:()=>[...rows.values()],busy:()=>!!pumping,dirty:()=>[...rows.values()].some(entry=>changed(entry)&&!blank(entry)||entry.flight||entry.attempt),disposeBlanks:()=>{for(const entry of rows.values())if(blank(entry))drop(entry);},destroy(){alive=false;for(const entry of rows.values())clearTimer(entry);rows.clear();queue.length=0;queued.clear();}});
 }
 const normalizeTab=tab=>Object.hasOwn(TABS,tab)?tab:'accounts';
 let session=null,sequence=0;
 function current(s){if(session!==s||!s.live||!s.host.isConnected||!s.host.contains(s.root))return false;try{const now=s.options.context();return !!now&&now.ready===true&&now.key===s.context.key&&s.options.current(s.context)===true;}catch{return false;}}
 function payload(editor){if(!editor)return null;const out={};for(const key of editor.fields)out[key]=editor.form.elements.namedItem(key).value;return out;}
 const changed=editor=>!!editor&&JSON.stringify(payload(editor))!==editor.baseline;
 function dirty(s=session){return !!s&&current(s)&&(changed(s.editor)||changed(s.groupEditor)||s.inline?.dirty());}
 function snapshot(s){try{return s.store?.snapshot?.()||{status:'idle',groups:[],contacts:[],accounts:[],busy:false};}catch{return {status:'error',groups:[],contacts:[],accounts:[],busy:false,error:{code:'INFORMATION_UNAVAILABLE'}};}}
 function isBusy(s){return !!(s.localBusy||s.switching||s.confirming||snapshot(s).busy||snapshot(s).status==='saving');}
 function message(s,text,tone=''){if(!current(s))return;s.message.textContent=text;s.message.dataset.tone=tone;}
 function errorText(result){const code=result?.error?.code||result?.code||'INFORMATION_NETWORK';return ({
  INFORMATION_CONFLICT:'다른 화면에서 수정된 자료입니다. 입력 내용은 유지했습니다. 새로고침 후 확인해 주세요.',
  INFORMATION_GROUP_IN_USE:'이 그룹에 등록된 전화번호가 있습니다. 다른 그룹으로 옮긴 뒤 삭제해 주세요.',
  INFORMATION_GROUP_EXISTS:'같은 이름의 그룹이 있습니다.',INFORMATION_GROUP_INVALID:'선택한 그룹을 확인해 주세요.',INFORMATION_GROUP_UNAVAILABLE:'선택한 그룹을 확인해 주세요.',
  INFORMATION_NOT_FOUND:'자료를 찾을 수 없습니다. 새로고침 후 확인해 주세요.',INFORMATION_RECORD_UNAVAILABLE:'자료를 찾을 수 없습니다. 새로고침 후 확인해 주세요.',
  INFORMATION_INVALID_RECORD:'입력 내용을 확인해 주세요.',INFORMATION_INVALID_REVISION:'자료 상태를 다시 확인해 주세요.',
  INFORMATION_CONTEXT_CHANGED:'로그인과 상사 정보를 다시 확인해 주세요.',INFORMATION_STALE:'화면이 변경되어 처리를 중단했습니다.',
  INFORMATION_UNAVAILABLE:'정보를 불러올 수 없습니다. 다시 불러오기를 눌러 주세요.',INFORMATION_BUSY:'진행 중인 처리가 끝난 뒤 다시 시도해 주세요.',
  INFORMATION_LIMIT_REACHED:'등록 가능한 수를 초과했습니다.',INFORMATION_LIMIT:'등록 가능한 수를 초과했습니다.',INFORMATION_TIMEOUT:'응답이 지연되고 있습니다. 입력 내용은 유지했습니다.',
  INFORMATION_ACK_INVALID:'저장 결과를 확인하지 못했습니다. 입력 내용은 유지했습니다.',
  INFORMATION_UNCERTAIN_EDIT:'이전 저장 결과를 먼저 확인해 주세요. 입력 내용은 유지했습니다.'
 })[code]||'처리하지 못했습니다. 입력 내용을 유지했으니 다시 시도해 주세요.';}
 async function confirm(s,text){if(!current(s)||s.confirming)return false;s.confirming=true;updateDisabled(s);try{return typeof s.options.confirm==='function'&&await s.options.confirm(text)===true&&current(s);}catch{return false;}finally{s.confirming=false;if(current(s))updateDisabled(s);}}
 function reset(){const s=session;if(!s)return;session=null;s.live=false;clearInterval(s.timer);s.inline?.destroy();s.store?.destroy?.();s.root.replaceChildren();s.root.remove();s.editor=s.groupEditor=null;}
 async function prepareLeave(s,text){
  if(!current(s))return true;if(s.localBusy||s.confirming){message(s,'저장 또는 삭제가 끝난 뒤 이동해 주세요.');return false;}
  s.inline.disposeBlanks();await s.inline.flush();if(!current(s))return false;
  if(s.inline.entries().some(entry=>entry.flight||entry.attempt)){message(s,'저장 결과를 확인한 뒤 다시 이동해 주세요.','error');return false;}
  if(!dirty(s))return true;const approved=await confirm(s,text);if(approved&&current(s)){for(const entry of s.inline.entries())s.inline.discard(entry);return true;}return false;
 }
 function beforeLeave(){const s=session;return !s||!current(s)?true:prepareLeave(s,'저장하지 못한 입력을 취소하고 이동할까요?');}

 function formatPhone(input){
  const raw=input.value;if(raw.trim().startsWith('+'))return;
  const before=raw.slice(0,input.selectionStart??raw.length).replace(/\D/g,'').length,digits=raw.replace(/\D/g,'');let value=digits;
  if(digits.startsWith('02')){if(digits.length>5&&digits.length<=9)value=digits.slice(0,2)+'-'+digits.slice(2,5)+'-'+digits.slice(5);else if(digits.length>9&&digits.length<=10)value=digits.slice(0,2)+'-'+digits.slice(2,6)+'-'+digits.slice(6);else if(digits.length>2&&digits.length<=5)value=digits.slice(0,2)+'-'+digits.slice(2);}
  else if(/^(?:15|16|18)/.test(digits)&&digits.length<=8){if(digits.length>4)value=digits.slice(0,4)+'-'+digits.slice(4);}
  else if(digits.length>7&&digits.length<=10)value=digits.slice(0,3)+'-'+digits.slice(3,6)+'-'+digits.slice(6);
  else if(digits.length>10&&digits.length<=11)value=digits.slice(0,3)+'-'+digits.slice(3,7)+'-'+digits.slice(7);
  else if(digits.length>3&&digits.length<=7)value=digits.slice(0,3)+'-'+digits.slice(3);
  input.value=value;let position=0,passed=0;while(position<value.length&&passed<before){if(/\d/.test(value[position]))passed++;position++;}try{input.setSelectionRange(position,position);}catch{}
 }
 function updateDisabled(s){const hard=!!(s.localBusy||s.confirming||s.switching),state=snapshot(s);for(const e of s.root.querySelectorAll('button,input,select,textarea')){const inline=!!e.closest('[data-info-cell]');e.disabled=hard||e.dataset.infoDisabled==='true'||!inline&&e.hasAttribute('data-info-write-action')&&state.busy===true;}for(const e of s.root.querySelectorAll('[data-info-action-ready]'))if(state.loaded!==true)e.disabled=true;for(const entry of s.inline?.entries()||[])paintEntry(s,entry);s.root.setAttribute('aria-busy',hard||state.status==='loading'?'true':'false');}

 function groupOptions(s,select,value=''){const groups=snapshot(s).groups||[];select.replaceChildren(new Option('미지정',''));for(const row of groups)select.append(new Option(row.name,row.id));if(value&&!groups.some(row=>row.id===value))select.append(new Option('그룹 확인 필요',value));select.value=value;}
 function editorActions(s,form,kind){const actions=node('div','snote-info-form-actions'),save=button('저장','snote-info-button snote-info-primary'),cancel=button('취소');save.type='submit';save.dataset.infoWriteAction='';save.id=kind==='groups'?'snote-info-group-save':'snote-info-record-save';cancel.id=kind==='groups'?'snote-info-group-cancel':'snote-info-record-cancel';actions.append(cancel,save);form.append(actions);cancel.onclick=async()=>{if(!current(s)||isBusy(s))return;const editor=kind==='groups'?s.groupEditor:s.editor;if(changed(editor)&&!await confirm(s,'입력한 내용을 취소할까요?'))return;if(!current(s))return;closeEditor(s,kind);};}
 function closeEditor(s,kind){if(kind==='groups'){s.groupEditor=null;s.groupEditorHost?.replaceChildren();}else{s.editor=null;s.editorHost.replaceChildren();}message(s,'');}
 function buildEditor(s,kind,row=null){
  if(kind!=='groups')return false;if(!current(s)||isBusy(s))return false;const existing=s.groupEditor;
  const open=()=>{if(!current(s)||isBusy(s))return false;let data;try{data=row?{...row}:s.store.newRecord('groups');}catch(error){message(s,errorText(error),'error');return false;}
   const form=node('form','snote-info-form'),head=node('div','snote-info-editor-heading',row?'그룹 수정':'그룹 등록');form.id='snote-info-group-form';form.autocomplete='off';form.append(head);const item=field(form,'name','그룹명',{max:60,required:true});form.append(item.wrap);editorActions(s,form,'groups');item.input.value=data.name;const editor={kind,data,form,fields:['name'],baseline:null};editor.baseline=JSON.stringify(payload(editor));s.groupEditor=editor;s.groupEditorHost.replaceChildren(form);form.addEventListener('submit',event=>{event.preventDefault();void saveEditor(s,editor);});message(s,'');updateDisabled(s);item.input.focus({preventScroll:true});return true;};
  return changed(existing)?confirm(s,'작성 중인 그룹을 저장하지 않고 다른 항목을 열까요?').then(ok=>ok&&open()):open();
 }

 async function saveEditor(s,editor){
  if(!current(s)||isBusy(s)||!editor.form.reportValidity())return;
  const input={...editor.data,...payload(editor)};if(editor.kind==='contacts')input.groupId=input.groupId||null;
  s.localBusy=true;updateDisabled(s);message(s,'저장 중입니다.');let result;
  try{result=await s.store.save(editor.kind,input,editor.data.revision);}catch(error){result={ok:false,error};}
  if(!current(s))return;s.localBusy=false;
  if(result?.ok){const primary=editor.kind!=='groups';if(primary&&s.editor===editor||!primary&&s.groupEditor===editor)closeEditor(s,editor.kind);renderLists(s);if(!primary&&s.editor?.kind==='contacts'){const select=s.editor.form.elements.namedItem('groupId'),value=editor.data.revision===0?(result.record?.id||input.id):select.value;groupOptions(s,select,value);}message(s,result.refreshError?'저장했습니다. 최신 목록은 다시 불러와 주세요.':'저장했습니다.','success');}
  else message(s,errorText(result),'error');updateDisabled(s);
 }
 async function removeRecord(s,kind,row){
  if(!current(s)||isBusy(s))return;
  const text=kind==='groups'?'이 그룹을 삭제할까요?':kind==='contacts'?'이 전화번호를 삭제할까요?':kind==='staffContacts'?'업무 연락처를 삭제하고 등록 정보로 되돌릴까요?':'이 계좌정보를 삭제할까요?';
  if(!await confirm(s,text)||!current(s)||isBusy(s))return;s.localBusy=true;updateDisabled(s);message(s,'삭제 중입니다.');let result;
  try{result=await s.store.remove(kind,{id:row.id,revision:row.revision});}catch(error){result={ok:false,error};}
  if(!current(s))return;s.localBusy=false;if(result?.ok){for(const entry of s.inline.entries())if(entry.kind===kind&&entry.base.id===row.id)s.inline.drop(entry);if(kind==='staffContacts')s.staffDrafts.delete(row.memberId);if(kind==='groups'&&s.groupEditor?.data.id===row.id)closeEditor(s,'groups');if(kind!=='groups'&&s.editor?.data.id===row.id)closeEditor(s,kind);renderLists(s);message(s,'삭제했습니다.','success');}else message(s,errorText(result),'error');updateDisabled(s);
 }
 function contactProjection(manual,staff,overrides=[]){
  if(staff?.ready!==true||!Array.isArray(staff.members))return {ready:false,rows:[]};const saved=new Map(overrides.map(row=>[row.memberId,row]));
  const employees=staff.members.filter(row=>row&&typeof row.name==='string'&&['admin','dealer','accountant'].includes(row.role)).map((row,index)=>{const memberId=typeof row.memberId==='string'&&UUID.test(row.memberId)?row.memberId.toLowerCase():null,override=memberId?saved.get(memberId):null;return{id:memberId?'staff:'+memberId:'staff:'+index,name:override?.name??(row.name.trim().slice(0,120)||'이름 미등록'),phone:override?.phone??(typeof row.phone==='string'?row.phone.trim().slice(0,40):''),groupId:null,groupName:'직원',memo:override?.memo||'',source:'staff',readonly:!memberId,...(memberId?{memberId,role:row.role,officialPhone:typeof row.phone==='string'?row.phone.trim().slice(0,40):'',override:override||null}:{})};});
  return {ready:true,rows:[...employees,...(Array.isArray(manual)?manual:[]).map(row=>({...row,source:'manual',readonly:false}))]};
 }
 function staffSnapshot(s){try{return typeof s.options.staff==='function'?s.options.staff():{ready:false,members:[]};}catch{return {ready:false,members:[]};}}
 function rowKey(row,kind){return row.source==='staff'?'member:'+row.memberId:kind+':'+row.id;}
 function rowEntry(s,row,kind){
  if(row.source==='staff'){
   if(row.readonly||s.store.version!==2)return null;const prior=s.inline.entries().find(entry=>entry.kind==='staffContacts'&&entry.base.memberId===row.memberId);if(prior)return prior;let value=row.override||s.staffDrafts.get(row.memberId);if(!value){value=s.store.newRecord('staffContacts',{memberId:row.memberId,name:row.name,phone:row.phone,memo:''});s.staffDrafts.set(row.memberId,value);}return s.inline.ensure('staffContacts',value);
  }
  return s.inline.ensure(kind,row);
 }
 function createTable(s,headers,kind){const scroll=node('div','snote-info-table-scroll'),table=node('table','snote-info-table'),head=node('thead'),tr=node('tr'),body=node('tbody');table.id='snote-info-'+kind+'-table';for(const label of headers){const th=node('th','',label);th.scope='col';tr.append(th);}head.append(tr);table.append(head,body);scroll.append(table);s.table={kind,scroll,body,rows:new Map()};s.listHost.replaceChildren(scroll);return s.table;}
 function cellInput(s,entry,field,label){
  const wrap=node('div','snote-info-cell'),input=node(field==='memo'?'textarea':field==='groupId'?'select':'input');wrap.dataset.infoCell=field;input.dataset.infoField=field;input.name=field;input.setAttribute('aria-label',label);input.autocomplete='off';input.spellcheck=field==='memo';
  if(field==='groupId')groupOptions(s,input,entry.draft.groupId||'');else{if(field==='memo'){input.rows=1;input.maxLength=2000;}else{input.type=field==='phone'?'tel':'text';input.maxLength=field==='name'?(entry.kind==='staffContacts'?120:100):field==='bankName'?60:field==='accountNumber'?64:40;input.required=field!=='phone'||entry.kind!=='staffContacts';if(field==='accountNumber')input.inputMode='numeric';if(field==='phone')input.inputMode='tel';}input.value=entry.draft[field]??'';}
  let composing=false;
  const changed=()=>{if(field==='phone'&&!composing)formatPhone(input);s.inline.edit(entry,field,field==='groupId'?input.value||null:input.value);};
  input.addEventListener('compositionstart',()=>{composing=true;s.inline.compose(entry,field,true);});input.addEventListener('compositionend',()=>{composing=false;s.inline.compose(entry,field,false);changed();});input.addEventListener(field==='groupId'?'change':'input',()=>{changed();if(field==='groupId')s.inline.submit(entry,{report:true});});
  input.addEventListener('blur',()=>{if(!composing)s.inline.submit(entry,{report:true});requestAnimationFrame(()=>{if(!current(s))return;const row=s.root.querySelector('[data-info-inline-key="'+entry.key+'"]');if(!row?.contains(document.activeElement)){entry.pinUntilBlur=false;renderLists(s);}});});
  input.addEventListener('keydown',event=>{if(event.isComposing||composing||event.keyCode===229)return;if(event.key==='Enter'&&(field!=='memo'||event.ctrlKey||event.metaKey)){event.preventDefault();s.inline.submit(entry,{report:true});}else if(event.key==='Escape'&&!entry.flight&&!entry.attempt){event.preventDefault();input.value=entry.base[field]??'';s.inline.edit(entry,field,entry.base[field]);}});wrap.append(input);return wrap;
 }
 function paintEntry(s,entry){
  if(!current(s))return;for(const tr of s.root.querySelectorAll('[data-info-inline-key]'))if(tr.dataset.infoInlineKey===entry.key||tr.dataset.infoInlineKey===entry.previousKey){tr.dataset.infoInlineKey=entry.key;tr.dataset.infoSaveState=entry.status;if(entry.base.revision>0)delete tr.dataset.infoNewRow;const status=tr.querySelector('[data-info-row-status]');if(status){status.textContent=({saving:'저장 중…',pending:'입력 중',saved:entry.base.revision?'저장됨':'',invalid:'입력 확인',error:'저장 실패',conflict:'다른 화면 변경'})[entry.status]||'';status.title=entry.error?errorText(entry.error):'';}const retry=tr.querySelector('[data-info-retry]');if(retry){retry.hidden=!['error','conflict','invalid'].includes(entry.status);retry.disabled=!!entry.flight||s.localBusy;retry.textContent=entry.status==='conflict'?'확인':'재시도';}const remove=tr.querySelector('[data-info-delete]');if(remove)remove.hidden=entry.base.revision===0;const cancel=tr.querySelector('[data-info-cancel]');if(cancel){cancel.hidden=!(entry.base.revision===0&&entry.kind!=='staffContacts'||s.inline.changed(entry));cancel.disabled=!!entry.flight||!!entry.attempt;}for(const input of tr.querySelectorAll('[data-info-field]')){const value=entry.draft[input.dataset.infoField]??'';if(input.dataset.infoField==='groupId'){const signature=JSON.stringify(snapshot(s).groups||[]);if(input.dataset.infoOptions!==signature){groupOptions(s,input,value);input.dataset.infoOptions=signature;}}if(input!==document.activeElement&&!entry.composing.size&&input.value!==value)input.value=value;input.setAttribute('aria-invalid',String(entry.status==='invalid'));}}
 }
 function makeRow(s,row,kind,headers){
  const tr=node('tr'),entry=rowEntry(s,row,kind);tr.dataset.infoRecordId=row.id;tr.dataset.infoRecordKind=kind;tr.dataset.infoSource=row.source==='staff'?'staff':'manual';if(entry)tr.dataset.infoInlineKey=entry.key;if(row.memberId)tr.dataset.infoMemberId=row.memberId;if(entry?.created)tr.dataset.infoNewRow='true';
  const fields=kind==='accounts'?['bankName','accountNumber','memo']:kind==='staff'?['name','role','phone','officialPhone','memo']:['name','phone','groupId','memo'];
  for(let i=0;i<fields.length;i++){const field=fields[i],td=node('td',i===0?'snote-info-name':field==='memo'?'snote-info-memo':'');td.dataset.label=headers[i];if(field==='officialPhone')td.dataset.infoOfficialPhone='';if(entry&&CELL_FIELDS[entry.kind].includes(field))td.append(cellInput(s,entry,field,headers[i]));else td.textContent=field==='role'?({admin:'대표·관리자',dealer:'딜러',accountant:'경리'})[row.role]||'직원':field==='groupId'?'직원':row[field]||'미등록';tr.append(td);}
  const action=node('td','snote-info-actions');action.dataset.label='관리';if(entry){const status=node('span','snote-info-row-status'),retry=button('재시도','snote-info-inline-retry'),cancel=button('×','snote-info-inline-cancel'),remove=iconButton('trash',row.source==='staff'?'업무 연락처 원래대로':'삭제','infoDelete',entry.base.id);status.dataset.infoRowStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');retry.dataset.infoRetry=entry.base.id;cancel.dataset.infoCancel=entry.base.id;cancel.setAttribute('aria-label','입력 취소');retry.onclick=async()=>{if(!current(s)||entry.flight)return;if(entry.status==='conflict'){const labels={bankName:'은행명',accountNumber:'계좌번호',name:'이름',phone:'전화번호',groupId:'그룹',memo:'메모'},latest=entry.remote?CELL_FIELDS[entry.kind].map(field=>labels[field]+': '+String(entry.remote[field]??'미지정').slice(0,160)).join('\n'):'삭제된 자료입니다.';if(await confirm(s,'최신 저장 내용입니다.\n'+latest+'\n\n입력한 항목만 다시 적용할까요?'))s.inline.rebase(entry);}else s.inline.retry(entry);};cancel.onclick=()=>{if(s.inline.discard(entry)){s.rowNodes.delete(rowKey(row,kind));renderLists(s);}};remove.onclick=async()=>{if(entry.base.revision===0){if(s.inline.drop(entry)){s.rowNodes.delete(rowKey(row,kind));renderLists(s);}return;}if(s.inline.changed(entry)&&!await confirm(s,'작성 중인 입력을 취소하고 삭제할까요?'))return;await removeRecord(s,entry.kind,entry.base);};remove.dataset.infoWriteAction='';action.append(status,retry,cancel,remove);}else action.append(node('span','snote-info-readonly','자동 표시'));tr.append(action);return tr;
 }
 function addRow(s){
  if(!current(s)||snapshot(s).loaded!==true||s.localBusy)return;let entry=s.inline.entries().find(row=>row.kind===s.tab&&s.inline.blank(row));if(!entry){entry=s.inline.ensure(s.tab,s.store.newRecord(s.tab));entry.created=true;}s.page=1;renderLists(s);const input=s.root.querySelector('[data-info-inline-key="'+entry.key+'"] [data-info-field]');input?.focus({preventScroll:true});
 }

 function renderGroups(s){
  if(!s.groupRows)return;const state=snapshot(s),groups=state.groups||[],counts=new Map();for(const c of state.contacts||[])if(c.groupId)counts.set(c.groupId,(counts.get(c.groupId)||0)+1);s.groupRows.replaceChildren();for(const row of groups){const line=node('div','snote-info-group-row');line.dataset.infoGroupId=row.id;const name=node('span','',row.name),count=node('small','',String(counts.get(row.id)||0)),actions=node('div','snote-info-row-actions'),edit=iconButton('edit','그룹 수정','infoGroupEdit',row.id),remove=iconButton('trash','그룹 삭제','infoGroupDelete',row.id);edit.onclick=()=>void buildEditor(s,'groups',row);remove.onclick=()=>void removeRecord(s,'groups',row);actions.append(edit,remove);line.append(name,count,actions);s.groupRows.append(line);}if(!groups.length)s.groupRows.append(node('p','snote-info-group-empty','등록된 그룹이 없습니다.'));
  const filterValue=s.groupFilter?.value||'all';if(s.groupFilter){s.groupFilter.replaceChildren(new Option('전체 그룹','all'),new Option('직원 연락처','staff'),new Option('미지정','none'));for(const g of groups)s.groupFilter.append(new Option(g.name,g.id));s.groupFilter.value=['all','staff','none',...groups.map(g=>g.id)].includes(filterValue)?filterValue:'all';}
  if(s.editor?.kind==='contacts'){const select=s.editor.form.elements.namedItem('groupId'),value=select.value;groupOptions(s,select,value);}
 }
 function renderLists(s){
  if(!current(s))return;const state=snapshot(s);s.root.dataset.infoState=state.status||'idle';s.inline.reconcile(state);renderGroups(s);
  const staff=staffSnapshot(s),merged=contactProjection(state.contacts||[],staff,state.staffContacts||[]);let raw=s.tab==='accounts'?(state.accounts||[]):s.tab==='staff'?merged.rows.filter(row=>row.source==='staff'):merged.rows;
  if(s.tab!=='accounts'&&!merged.ready){if(!s.table){s.listHost.replaceChildren(node('p','snote-info-empty','직원 연락처를 확인하고 있습니다.'));}updateDisabled(s);return;}
  if(!state.loaded&&!raw.length){if(!s.table)s.listHost.replaceChildren(node('p','snote-info-empty',state.status==='error'?'정보를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.':'정보를 불러오고 있습니다.'));updateDisabled(s);return;}
  const query=(s.query?.value||'').trim().toLocaleLowerCase(),group=s.groupFilter?.value||'all',groups=state.groups||[],groupNames=new Map(groups.map(row=>[row.id,row.name])),pinned=[];
  for(const entry of s.inline.entries())if(entry.kind===s.tab&&(entry.created||entry.pinUntilBlur))pinned.push({...entry.draft,source:'manual'});
  const pinnedIds=new Set(pinned.map(row=>row.id));raw=[...pinned,...raw.filter(row=>!pinnedIds.has(row.id))];
  const rows=raw.filter(row=>{const entry=rowEntry(s,row,s.tab);if(entry&&(entry.created||entry.pinUntilBlur||s.inline.changed(entry)||s.root.querySelector('[data-info-inline-key="'+entry.key+'"]')?.contains(document.activeElement)))return true;if(s.tab==='contacts'&&group!=='all'){if(row.source==='staff'){if(group!=='staff')return false;}else if(group==='staff'||(group==='none'?!!row.groupId:row.groupId!==group))return false;}const values=s.tab==='accounts'?[row.bankName,row.accountNumber,row.memo]:[row.name,row.phone,row.memo,row.source==='staff'?'직원':groupNames.get(row.groupId)];return !query||values.some(value=>String(value||'').toLocaleLowerCase().includes(query));});
  const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));s.page=Math.max(1,Math.min(s.page,pages));let visible=rows.slice((s.page-1)*PAGE_SIZE,s.page*PAGE_SIZE);for(const row of pinned)if(!visible.some(value=>value.id===row.id))visible.unshift(row);
  const headers=s.tab==='accounts'?['은행명','계좌번호','메모','관리']:s.tab==='staff'?['업무 이름','직책','업무 전화번호','등록 전화번호','메모','관리']:['이름','전화번호','그룹','메모','관리'];
  const table=s.table?.kind===s.tab?s.table:createTable(s,headers,s.tab),visibleKeys=new Set();
  for(const [index,row]of visible.entries()){const key=rowKey(row,s.tab);visibleKeys.add(key);let tr=table.rows.get(key);if(!tr){tr=makeRow(s,row,s.tab,headers);table.rows.set(key,tr);}const entry=rowEntry(s,row,s.tab);if(entry&&tr.dataset.infoInlineKey!==entry.key){tr.remove();tr=makeRow(s,row,s.tab,headers);table.rows.set(key,tr);}if(entry)s.rowNodes.set(key,tr);const official=tr.querySelector('[data-info-official-phone]');if(official)official.textContent=row.officialPhone||'미등록';if(table.body.children[index]!==tr)table.body.insertBefore(tr,table.body.children[index]||null);}
  for(const [key,tr]of table.rows)if(!visibleKeys.has(key)){tr.remove();table.rows.delete(key);}
  s.empty?.remove();if(!visible.length){s.empty=node('p','snote-info-empty',query||group!=='all'?'검색 결과가 없습니다.':s.tab==='accounts'?'등록된 계좌정보가 없습니다.':'등록된 연락처가 없습니다.');s.listHost.append(s.empty);}
  s.pager?.remove();if(pages>1){const pager=node('nav','snote-info-pagination'),prev=button('이전'),next=button('다음');pager.setAttribute('aria-label','정보 목록 페이지');prev.disabled=s.page===1;next.disabled=s.page===pages;prev.dataset.infoDisabled=String(prev.disabled);next.dataset.infoDisabled=String(next.disabled);prev.onclick=()=>{if(current(s)&&s.page>1){s.page--;renderLists(s);}};next.onclick=()=>{if(current(s)&&s.page<pages){s.page++;renderLists(s);}};pager.append(prev,node('span','',s.page+' / '+pages),next);s.listHost.append(pager);s.pager=pager;}updateDisabled(s);
 }

 async function refresh(s,{force=false}={}){if(!current(s)||isBusy(s) )return;message(s,'');let result;try{result=await s.store.refresh({force});}catch(error){result={ok:false,error};}if(!current(s))return;renderLists(s);if(result?.ok===false)message(s,errorText(result),'error');updateDisabled(s);}
 function renderPane(s){
  s.pane.replaceChildren();s.table=null;s.rowNodes.clear();s.empty=s.pager=null;s.editor=s.groupEditor=null;s.page=1;s.query=s.groupFilter=s.groupRows=s.groupEditorHost=null;
  for(const e of s.tabs.children){const active=e.dataset.infoTab===s.tab;e.classList.toggle('active',active);e.setAttribute('aria-selected',String(active));e.tabIndex=active?0:-1;}s.root.dataset.infoTab=s.tab;s.pane.setAttribute('aria-labelledby','snote-info-tab-'+s.tab);
  const tools=node('div','snote-info-toolbar');
  {
   const search=node('label','search snote-info-search'),input=node('input');input.id='snote-info-query';input.type='search';input.placeholder=s.tab==='accounts'?'은행명·계좌번호·메모 검색':'이름·전화번호·메모 검색';input.setAttribute('aria-label',input.placeholder);input.maxLength=120;input.addEventListener('input',()=>{s.page=1;renderLists(s);});search.append(svg('search'),input);tools.append(search);s.query=input;
   if(s.tab==='contacts'){const select=node('select','snote-info-group-filter');select.id='snote-info-group-filter';select.setAttribute('aria-label','전화번호 그룹');select.addEventListener('change',()=>{s.page=1;renderLists(s);});tools.append(select);s.groupFilter=select;}
   const add=button(s.tab==='accounts'?'계좌 등록':'전화번호 등록','snote-info-button snote-info-primary');add.id='snote-info-new';add.dataset.infoActionReady='true';add.prepend(svg('plus'));add.onclick=()=>addRow(s);const reload=iconButton('refresh','다시 불러오기');reload.id='snote-info-refresh';reload.onclick=()=>void refresh(s,{force:true});tools.append(reload);if(s.tab!=='staff')tools.append(add);
  }
  s.pane.append(tools);if(s.tab==='staff')s.pane.append(node('p','snote-info-work-note','업무 연락처 수정은 로그인·휴대폰 인증 정보를 변경하지 않습니다.'));
  if(s.tab==='contacts'){
   const details=node('details','snote-info-group-manager'),summary=node('summary','','그룹 관리'),groupBody=node('div','snote-info-group-body'),groupRows=node('div','snote-info-group-rows'),add=button('새 그룹','snote-info-button');details.id='snote-info-group-manager';summary.id='snote-info-groups-toggle';add.id='snote-info-group-new';add.dataset.infoActionReady='true';add.prepend(svg('plus'));add.onclick=()=>void buildEditor(s,'groups');s.groupEditorHost=node('div','snote-info-group-editor-host');s.groupRows=groupRows;groupBody.append(groupRows,add,s.groupEditorHost);details.append(summary,groupBody);s.pane.append(details);
  }
  s.editorHost=node('div','snote-info-editor-host');s.listHost=node('div','snote-info-list');s.pane.append(s.editorHost,s.listHost);renderLists(s);message(s,'');if(snapshot(s).status==='idle')void refresh(s);
 }
 async function switchTab(s,tab){
  tab=normalizeTab(tab);if(!current(s)||s.tab===tab||s.localBusy||s.switching)return false;s.switching=true;updateDisabled(s);
  try{if(!await prepareLeave(s,'저장하지 못한 입력을 취소하고 탭을 바꿀까요?')||!current(s))return false;s.tab=tab;renderPane(s);try{s.options.onTab?.(tab);}catch{}return true;}finally{s.switching=false;if(current(s))updateDisabled(s);}
 }

 function mount(host,options={}){
  if(!(host instanceof Element)||typeof options.context!=='function'||typeof options.current!=='function'||typeof options.createStore!=='function')return false;
  let context;try{context=options.context();}catch{return false;}
  if(!context?.ready||options.current(context)!==true){reset();return false;}
  const tab=normalizeTab(options.tab);
  if(session&&session.host===host&&current(session)&&session.context.key===context.key){session.options=options;renderLists(session);if(options.tab&&tab!==session.tab){if(options.prepared===true){session.tab=tab;renderPane(session);}else void switchTab(session,tab);}return true;}
  reset();const root=node('section','snote-accountant-information'),tabs=node('div','snote-info-tabs'),pane=node('div','snote-info-pane'),status=node('p','snote-info-status');root.id='snote-accountant-information';root.dataset.accountantPage='acctInfo';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','정보');pane.id='snote-info-pane-'+(++sequence);pane.setAttribute('role','tabpanel');status.id='snote-info-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const s={host,root,tabs,pane,message:status,options,context,tab,live:true,localBusy:false,switching:false,store:null,editor:null,groupEditor:null,page:1,staffDrafts:new Map(),rowNodes:new Map(),table:null,inline:null};session=s;host.replaceChildren(root);root.append(tabs,status,pane);
  for(const[key,label]of Object.entries(TABS)){const e=button(label,'snote-info-tab');e.id='snote-info-tab-'+key;e.dataset.infoTab=key;e.setAttribute('role','tab');e.setAttribute('aria-controls',pane.id);e.onclick=()=>void switchTab(s,key);e.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(TABS),i=keys.indexOf(s.tab),next=event.key==='Home'?0:event.key==='End'?keys.length-1:(i+(event.key==='ArrowLeft'?-1:1)+keys.length)%keys.length;void switchTab(s,keys[next]).then(ok=>{if(ok&&current(s))s.tabs.children[next].focus({preventScroll:true});});});tabs.append(e);}
  s.inline=inlineController({current:()=>current(s),snapshot:()=>snapshot(s),validate:(kind,value)=>window.SnoteAccountantInformationData.model.record(kind,value),save:(kind,value,expected)=>s.store.save(kind,value,expected),onChange:entry=>paintEntry(s,entry)});
  try{s.store=options.createStore(()=>{if(current(s)){renderLists(s);updateDisabled(s);}});}catch{reset();host.replaceChildren(node('p','snote-info-empty','정보 화면을 준비하지 못했습니다. 메뉴를 다시 열어 주세요.'));return false;}
  renderPane(s);s.timer=setInterval(()=>{if(!current(s))reset();},250);return true;
 }
 for(const name of ['snote:auth-reset','pagehide'])window.addEventListener(name,reset);
 window.addEventListener('snote:route-changed',event=>{if(event.detail?.page!=='acctInfo')reset();});
 window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
 window.SnoteAccountantInformation=Object.freeze({mount,reset,isDirty:()=>dirty(),beforeLeave,tab:()=>session?.tab||null,model:Object.freeze({inlineController,contactProjection})});
 window.dispatchEvent(new Event('snote:accountant-information-ready'));
})();
