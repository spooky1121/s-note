/* Company information editor. The host owns authentication; business records never enter browser storage. */
(()=>{'use strict';
 if(window.SnoteAccountantInformation)return;
 const TABS=Object.freeze({accounts:'계좌',contacts:'전화번호',staff:'직원'}),PAGE_SIZE=30;
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const svg=name=>{const e=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(e.namespaceURI,'path');e.setAttribute('viewBox','0 0 24 24');e.setAttribute('aria-hidden','true');e.setAttribute('fill','none');e.setAttribute('stroke','currentColor');e.setAttribute('stroke-width','1.7');e.setAttribute('stroke-linecap','round');e.setAttribute('stroke-linejoin','round');p.setAttribute('d',({plus:'M12 5v14M5 12h14',edit:'m4 16-1 5 5-1L20 8l-4-4L4 16m10-10 4 4',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',refresh:'M20 4v6h-6M4 20v-6h6M5 9a7 7 0 0 1 12-4l3 4M4 15l3 4a7 7 0 0 0 12-4',group:'M3 7V4h7l2 3h9v13H3z',search:'m16 16 5 5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0'})[name]);e.append(p);return e;};
 function button(text,cls='snote-info-button'){const e=node('button',cls,text);e.type='button';return e;}
 function iconButton(name,label,attr,id){const e=button('', 'snote-info-icon-button');e.append(svg(name));e.setAttribute('aria-label',label);e.title=label;if(attr)e.dataset[attr]=id;return e;}
 function field(form,name,label,{type='text',max=100,required=false,multiline=false}={}){const wrap=node('label','snote-info-field'),caption=node('span','',label),input=node(multiline?'textarea':'input');input.name=name;input.id=form.id+'-'+name;input.maxLength=max;input.required=required;if(multiline)input.rows=3;else input.type=type;input.autocomplete='off';wrap.append(caption,input);return {wrap,input};}
 const normalizeTab=tab=>Object.hasOwn(TABS,tab)?tab:'accounts';
 let session=null,sequence=0;
 function current(s){if(session!==s||!s.live||!s.host.isConnected||!s.host.contains(s.root))return false;try{const now=s.options.context();return !!now&&now.ready===true&&now.key===s.context.key&&s.options.current(s.context)===true;}catch{return false;}}
 function payload(editor){if(!editor)return null;const out={};for(const key of editor.fields)out[key]=editor.form.elements.namedItem(key).value;return out;}
 const changed=editor=>!!editor&&JSON.stringify(payload(editor))!==editor.baseline;
 function dirty(s=session){return !!s&&current(s)&&(changed(s.editor)||changed(s.groupEditor));}
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
 function reset(){const s=session;if(!s)return;session=null;s.live=false;clearInterval(s.timer);s.store?.destroy?.();s.root.replaceChildren();s.root.remove();s.editor=s.groupEditor=null;}
 function beforeLeave(){const s=session;if(!s||!current(s))return true;if(isBusy(s)){message(s,'저장 또는 삭제가 끝난 뒤 이동해 주세요.');return false;}if(!dirty(s))return true;return confirm(s,'작성 중인 내용을 저장하지 않고 이동할까요?');}
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
 function updateDisabled(s){const busy=isBusy(s),state=snapshot(s);for(const e of s.root.querySelectorAll('button,input,select,textarea'))e.disabled=busy||e.dataset.infoDisabled==='true';for(const e of s.tabs.children)e.disabled=busy;for(const e of s.root.querySelectorAll('[data-info-action-ready]'))if(state.loaded!==true)e.disabled=true;s.root.setAttribute('aria-busy',busy||state.status==='loading'?'true':'false');}
 function groupOptions(s,select,value=''){const groups=snapshot(s).groups||[];select.replaceChildren(new Option('미지정',''));for(const row of groups)select.append(new Option(row.name,row.id));if(value&&!groups.some(row=>row.id===value))select.append(new Option('그룹 확인 필요',value));select.value=value;}
 function editorActions(s,form,kind){const actions=node('div','snote-info-form-actions'),save=button('저장','snote-info-button snote-info-primary'),cancel=button('취소');save.type='submit';save.id=kind==='groups'?'snote-info-group-save':'snote-info-record-save';cancel.id=kind==='groups'?'snote-info-group-cancel':'snote-info-record-cancel';actions.append(cancel,save);form.append(actions);cancel.onclick=async()=>{if(!current(s)||isBusy(s))return;const editor=kind==='groups'?s.groupEditor:s.editor;if(changed(editor)&&!await confirm(s,'입력한 내용을 취소할까요?'))return;if(!current(s))return;closeEditor(s,kind);};}
 function closeEditor(s,kind){if(kind==='groups'){s.groupEditor=null;s.groupEditorHost?.replaceChildren();}else{s.editor=null;s.editorHost.replaceChildren();}message(s,'');}
 function buildEditor(s,kind,row=null){
  if(!current(s)||isBusy(s))return false;
  const primary=kind!=='groups',existing=primary?s.editor:s.groupEditor;
  const open=()=>{
   if(!current(s)||isBusy(s))return false;
   let data;try{data=row?{...row}:s.store.newRecord(kind);}catch(error){message(s,errorText(error),'error');return false;}const form=node('form','snote-info-form'),head=node('div','snote-info-editor-heading',kind==='accounts'?(row?'계좌 수정':'계좌 등록'):kind==='contacts'?(row?'전화번호 수정':'전화번호 등록'):(row?'그룹 수정':'그룹 등록'));
   form.id=primary?'snote-info-record-form':'snote-info-group-form';form.autocomplete='off';form.noValidate=false;form.append(head);
   const grid=node('div','snote-info-form-grid'),fields=[];
   const add=(name,label,options)=>{const item=field(form,name,label,options);grid.append(item.wrap);fields.push(name);return item.input;};
   if(kind==='accounts'){
    add('bankName','은행명',{max:60,required:true});const number=add('accountNumber','계좌번호',{max:64,required:true});number.inputMode='numeric';number.pattern='[0-9 -]+';number.placeholder='계좌번호 입력';
   }else if(kind==='contacts'){
    add('name','이름',{max:100,required:true});const phone=add('phone','전화번호',{type:'tel',max:40,required:true});phone.inputMode='tel';phone.addEventListener('input',()=>formatPhone(phone));
    const wrap=node('label','snote-info-field'),select=node('select');select.name='groupId';select.id=form.id+'-groupId';wrap.append(node('span','','그룹'),select);groupOptions(s,select,data.groupId||'');grid.append(wrap);fields.push('groupId');
   }else add('name','그룹명',{max:60,required:true});
   if(kind!=='groups'){const memo=field(form,'memo','메모',{max:2000,multiline:true});memo.wrap.classList.add('snote-info-field-wide');grid.append(memo.wrap);fields.push('memo');}
   form.append(grid);editorActions(s,form,kind);for(const key of fields)form.elements.namedItem(key).value=data[key]??'';
   const editor={kind,data,form,fields,baseline:null};editor.baseline=JSON.stringify(payload(editor));if(primary){s.editor=editor;s.editorHost.replaceChildren(form);}else{s.groupEditor=editor;s.groupEditorHost.replaceChildren(form);}
   form.addEventListener('submit',event=>{event.preventDefault();void saveEditor(s,editor);});message(s,'');updateDisabled(s);requestAnimationFrame(()=>{if(current(s)&&form.isConnected)form.querySelector('input')?.focus({preventScroll:true});});return true;
  };
  if(changed(existing))return confirm(s,'작성 중인 내용을 저장하지 않고 다른 항목을 열까요?').then(ok=>ok&&open());return open();
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
  const text=kind==='groups'?'이 그룹을 삭제할까요?':kind==='contacts'?'이 전화번호를 삭제할까요?':'이 계좌정보를 삭제할까요?';
  if(!await confirm(s,text)||!current(s)||isBusy(s))return;s.localBusy=true;updateDisabled(s);message(s,'삭제 중입니다.');let result;
  try{result=await s.store.remove(kind,{id:row.id,revision:row.revision});}catch(error){result={ok:false,error};}
  if(!current(s))return;s.localBusy=false;if(result?.ok){if(kind==='groups'&&s.groupEditor?.data.id===row.id)closeEditor(s,'groups');if(kind!=='groups'&&s.editor?.data.id===row.id)closeEditor(s,kind);renderLists(s);message(s,'삭제했습니다.','success');}else message(s,errorText(result),'error');updateDisabled(s);
 }
 function rowActions(s,kind,row){const wrap=node('div','snote-info-row-actions'),edit=iconButton('edit','수정','infoEdit',row.id),remove=iconButton('trash','삭제','infoDelete',row.id);edit.onclick=()=>void buildEditor(s,kind,row);remove.onclick=()=>void removeRecord(s,kind,row);wrap.append(edit,remove);return wrap;}
 function contactProjection(manual,staff){
  if(staff?.ready!==true||!Array.isArray(staff.members))return {ready:false,rows:[]};
  const employees=staff.members.filter(row=>row&&typeof row.name==='string'&&['admin','dealer','accountant'].includes(row.role)).map((row,index)=>({id:'staff:'+index,name:row.name.trim().slice(0,120)||'이름 미등록',phone:typeof row.phone==='string'?row.phone.trim().slice(0,40):'',groupId:null,groupName:'직원',memo:'',source:'staff',readonly:true}));
  // Shared office numbers and manually saved notes may intentionally overlap.
  // Preserve both identities and mark employee rows read-only instead of merging.
  return {ready:true,rows:[...employees,...(Array.isArray(manual)?manual:[]).map(row=>({...row,source:'manual',readonly:false}))]};
 }
 function staffSnapshot(s){try{return typeof s.options.staff==='function'?s.options.staff():{ready:false,members:[]};}catch{return {ready:false,members:[]};}}
 function makeTable(s,headers,rows,kind){
  const scroll=node('div','snote-info-table-scroll'),table=node('table','snote-info-table'),head=node('thead'),tr=node('tr'),body=node('tbody');
  table.id='snote-info-'+kind+'-table';for(const label of headers){const th=node('th','',label);th.scope='col';tr.append(th);}head.append(tr);
  for(const row of rows){const tr=node('tr');tr.dataset.infoRecordId=row.id;tr.dataset.infoRecordKind=kind;tr.dataset.infoSource=row.source==='staff'?'staff':'manual';const group=row.source==='staff'?'직원':(snapshot(s).groups||[]).find(g=>g.id===row.groupId)?.name||'미지정',values=kind==='accounts'?[row.bankName,row.accountNumber,row.memo]:[row.name,row.phone||'미등록',group,row.memo];
   for(let i=0;i<values.length;i++){const td=node('td',i===0?'snote-info-name':i===values.length-1?'snote-info-memo':'',values[i]||'—');td.dataset.label=headers[i];tr.append(td);}const action=node('td','snote-info-actions');action.dataset.label='관리';if(row.source==='staff'){const badge=node('span','snote-info-readonly','자동 표시');badge.setAttribute('aria-label','직원 연락처 · 읽기 전용');action.append(badge);}else action.append(rowActions(s,kind,row));tr.append(action);body.append(tr);
  }table.append(head,body);scroll.append(table);return scroll;
 }
 function renderStaff(s){const data=typeof s.options.staff==='function'?s.options.staff():{ready:false,members:[]};s.listHost.replaceChildren();if(data?.ready!==true){s.listHost.append(node('p','snote-info-empty','직원 정보를 확인하고 있습니다.'));return;}const rows=Array.isArray(data.members)?data.members:[];if(!rows.length){s.listHost.append(node('p','snote-info-empty','등록된 직원 정보가 없습니다.'));return;}const wrap=node('div','snote-info-table-scroll'),table=node('table','snote-info-table snote-info-staff-table'),head=node('thead'),tr=node('tr'),body=node('tbody');table.id='snote-info-staff-table';for(const label of ['직원명','직책','전화번호']){const th=node('th','',label);th.scope='col';tr.append(th);}head.append(tr);for(const row of rows){const tr=node('tr'),values=[String(row.name||'이름 미등록').slice(0,120),({admin:'대표·관리자',dealer:'딜러',accountant:'경리'})[row.role]||'직원',String(row.phone||'미등록').slice(0,40)];for(let i=0;i<values.length;i++){const td=node('td',i===0?'snote-info-name':'',values[i]);td.dataset.label=['직원명','직책','전화번호'][i];tr.append(td);}body.append(tr);}table.append(head,body);wrap.append(table);s.listHost.append(wrap);}
 function renderGroups(s){
  if(!s.groupRows)return;const state=snapshot(s),groups=state.groups||[],counts=new Map();for(const c of state.contacts||[])if(c.groupId)counts.set(c.groupId,(counts.get(c.groupId)||0)+1);s.groupRows.replaceChildren();for(const row of groups){const line=node('div','snote-info-group-row');line.dataset.infoGroupId=row.id;const name=node('span','',row.name),count=node('small','',String(counts.get(row.id)||0)),actions=node('div','snote-info-row-actions'),edit=iconButton('edit','그룹 수정','infoGroupEdit',row.id),remove=iconButton('trash','그룹 삭제','infoGroupDelete',row.id);edit.onclick=()=>void buildEditor(s,'groups',row);remove.onclick=()=>void removeRecord(s,'groups',row);actions.append(edit,remove);line.append(name,count,actions);s.groupRows.append(line);}if(!groups.length)s.groupRows.append(node('p','snote-info-group-empty','등록된 그룹이 없습니다.'));
  const filterValue=s.groupFilter?.value||'all';if(s.groupFilter){s.groupFilter.replaceChildren(new Option('전체 그룹','all'),new Option('직원 연락처','staff'),new Option('미지정','none'));for(const g of groups)s.groupFilter.append(new Option(g.name,g.id));s.groupFilter.value=['all','staff','none',...groups.map(g=>g.id)].includes(filterValue)?filterValue:'all';}
  if(s.editor?.kind==='contacts'){const select=s.editor.form.elements.namedItem('groupId'),value=select.value;groupOptions(s,select,value);}
 }
 function renderLists(s){
  if(!current(s))return;const state=snapshot(s);s.root.dataset.infoState=state.status||'idle';if(s.tab==='staff'){renderStaff(s);return;}
  renderGroups(s);s.listHost.replaceChildren();let raw=Array.isArray(state[s.tab])?state[s.tab]:[];
  if(s.tab==='contacts'){const merged=contactProjection(raw,staffSnapshot(s));if(!merged.ready){s.listHost.append(node('p','snote-info-empty','직원 연락처를 확인하고 있습니다.'));updateDisabled(s);return;}if(state.loaded===true)raw=merged.rows;}
  if(['idle','loading','unavailable'].includes(state.status)&&!raw.length){s.listHost.append(node('p','snote-info-empty',state.status==='unavailable'?'로그인과 상사 정보를 확인해 주세요.':'정보를 불러오고 있습니다.'));updateDisabled(s);return;}
  const query=(s.query?.value||'').trim().toLocaleLowerCase(),group=s.groupFilter?.value||'all',groups=state.groups||[],groupNames=new Map(groups.map(g=>[g.id,g.name]));
  const rows=raw.filter(row=>{if(s.tab==='contacts'&&group!=='all'){if(row.source==='staff'){if(group!=='staff')return false;}else if(group==='staff'||(group==='none'?!!row.groupId:row.groupId!==group))return false;}const values=s.tab==='accounts'?[row.bankName,row.accountNumber,row.memo]:[row.name,row.phone,row.memo,row.source==='staff'?'직원':groupNames.get(row.groupId)];return !query||values.some(v=>String(v||'').toLocaleLowerCase().includes(query));});
  const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));s.page=Math.max(1,Math.min(s.page,pages));const visible=rows.slice((s.page-1)*PAGE_SIZE,s.page*PAGE_SIZE);
  if(!visible.length)s.listHost.append(node('p','snote-info-empty',state.status==='error'?'목록을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.':query||group!=='all'?'검색 결과가 없습니다.':s.tab==='accounts'?'등록된 계좌정보가 없습니다.':'등록된 전화번호가 없습니다.'));
  else s.listHost.append(makeTable(s,s.tab==='accounts'?['은행명','계좌번호','메모','관리']:['이름','전화번호','그룹','메모','관리'],visible,s.tab));
  if(pages>1){const pager=node('nav','snote-info-pagination'),prev=button('이전'),next=button('다음');pager.setAttribute('aria-label','정보 목록 페이지');prev.dataset.infoDisabled=String(s.page===1);next.dataset.infoDisabled=String(s.page===pages);prev.disabled=s.page===1;next.disabled=s.page===pages;prev.onclick=()=>{if(current(s)&&!isBusy(s)&&s.page>1){s.page--;renderLists(s);}};next.onclick=()=>{if(current(s)&&!isBusy(s)&&s.page<pages){s.page++;renderLists(s);}};pager.append(prev,node('span','',s.page+' / '+pages),next);s.listHost.append(pager);}
  updateDisabled(s);
 }
 async function refresh(s,{force=false}={}){if(!current(s)||isBusy(s)||s.tab==='staff')return;message(s,'');let result;try{result=await s.store.refresh({force});}catch(error){result={ok:false,error};}if(!current(s))return;renderLists(s);if(result?.ok===false)message(s,errorText(result),'error');updateDisabled(s);}
 function renderPane(s){
  s.pane.replaceChildren();s.editor=s.groupEditor=null;s.page=1;s.query=s.groupFilter=s.groupRows=s.groupEditorHost=null;
  for(const e of s.tabs.children){const active=e.dataset.infoTab===s.tab;e.classList.toggle('active',active);e.setAttribute('aria-selected',String(active));e.tabIndex=active?0:-1;}s.root.dataset.infoTab=s.tab;s.pane.setAttribute('aria-labelledby','snote-info-tab-'+s.tab);
  const tools=node('div','snote-info-toolbar');
  if(s.tab!=='staff'){
   const search=node('label','search snote-info-search'),input=node('input');input.id='snote-info-query';input.type='search';input.placeholder=s.tab==='accounts'?'은행명·계좌번호·메모 검색':'이름·전화번호·메모 검색';input.setAttribute('aria-label',input.placeholder);input.maxLength=120;input.addEventListener('input',()=>{s.page=1;renderLists(s);});search.append(svg('search'),input);tools.append(search);s.query=input;
   if(s.tab==='contacts'){const select=node('select','snote-info-group-filter');select.id='snote-info-group-filter';select.setAttribute('aria-label','전화번호 그룹');select.addEventListener('change',()=>{s.page=1;renderLists(s);});tools.append(select);s.groupFilter=select;}
   const add=button(s.tab==='accounts'?'계좌 등록':'전화번호 등록','snote-info-button snote-info-primary');add.id='snote-info-new';add.dataset.infoActionReady='true';add.prepend(svg('plus'));add.onclick=()=>void buildEditor(s,s.tab);const reload=iconButton('refresh','다시 불러오기');reload.id='snote-info-refresh';reload.onclick=()=>void refresh(s,{force:true});tools.append(reload,add);
  }
  s.pane.append(tools);
  if(s.tab==='contacts'){
   const details=node('details','snote-info-group-manager'),summary=node('summary','','그룹 관리'),groupBody=node('div','snote-info-group-body'),groupRows=node('div','snote-info-group-rows'),add=button('새 그룹','snote-info-button');details.id='snote-info-group-manager';summary.id='snote-info-groups-toggle';add.id='snote-info-group-new';add.dataset.infoActionReady='true';add.prepend(svg('plus'));add.onclick=()=>void buildEditor(s,'groups');s.groupEditorHost=node('div','snote-info-group-editor-host');s.groupRows=groupRows;groupBody.append(groupRows,add,s.groupEditorHost);details.append(summary,groupBody);s.pane.append(details);
  }
  s.editorHost=node('div','snote-info-editor-host');s.listHost=node('div','snote-info-list');s.pane.append(s.editorHost,s.listHost);renderLists(s);message(s,'');if(s.tab!=='staff'&&snapshot(s).status==='idle')void refresh(s);
 }
 async function switchTab(s,tab){
  tab=normalizeTab(tab);if(!current(s)||s.tab===tab||isBusy(s))return false;
  if(dirty(s)&&!await confirm(s,'작성 중인 내용을 저장하지 않고 탭을 바꿀까요?'))return false;
  if(!current(s)||isBusy(s))return false;s.tab=tab;renderPane(s);try{s.options.onTab?.(tab);}catch{}return true;
 }
 function mount(host,options={}){
  if(!(host instanceof Element)||typeof options.context!=='function'||typeof options.current!=='function'||typeof options.createStore!=='function')return false;
  let context;try{context=options.context();}catch{return false;}
  if(!context?.ready||options.current(context)!==true){reset();return false;}
  const tab=normalizeTab(options.tab);
  if(session&&session.host===host&&current(session)&&session.context.key===context.key){session.options=options;if(session.tab==='staff')renderStaff(session);else if(session.tab==='contacts')renderLists(session);if(options.tab&&tab!==session.tab){if(options.prepared===true){session.tab=tab;renderPane(session);}else void switchTab(session,tab);}return true;}
  reset();const root=node('section','snote-accountant-information'),tabs=node('div','snote-info-tabs'),pane=node('div','snote-info-pane'),status=node('p','snote-info-status');root.id='snote-accountant-information';root.dataset.accountantPage='acctInfo';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','정보');pane.id='snote-info-pane-'+(++sequence);pane.setAttribute('role','tabpanel');status.id='snote-info-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const s={host,root,tabs,pane,message:status,options,context,tab,live:true,localBusy:false,switching:false,store:null,editor:null,groupEditor:null,page:1};session=s;host.replaceChildren(root);root.append(tabs,status,pane);
  for(const[key,label]of Object.entries(TABS)){const e=button(label,'snote-info-tab');e.id='snote-info-tab-'+key;e.dataset.infoTab=key;e.setAttribute('role','tab');e.setAttribute('aria-controls',pane.id);e.onclick=()=>void switchTab(s,key);e.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const keys=Object.keys(TABS),i=keys.indexOf(s.tab),next=event.key==='Home'?0:event.key==='End'?keys.length-1:(i+(event.key==='ArrowLeft'?-1:1)+keys.length)%keys.length;void switchTab(s,keys[next]).then(ok=>{if(ok&&current(s))s.tabs.children[next].focus({preventScroll:true});});});tabs.append(e);}
  try{s.store=options.createStore(()=>{if(current(s)){renderLists(s);updateDisabled(s);}});}catch{reset();host.replaceChildren(node('p','snote-info-empty','정보 화면을 준비하지 못했습니다. 메뉴를 다시 열어 주세요.'));return false;}
  renderPane(s);s.timer=setInterval(()=>{if(!current(s))reset();},250);return true;
 }
 for(const name of ['snote:auth-reset','pagehide'])window.addEventListener(name,reset);
 window.addEventListener('snote:route-changed',event=>{if(event.detail?.page!=='acctInfo')reset();});
 window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
 window.SnoteAccountantInformation=Object.freeze({mount,reset,isDirty:()=>dirty(),beforeLeave,tab:()=>session?.tab||null});
 window.dispatchEvent(new Event('snote:accountant-information-ready'));
})();
