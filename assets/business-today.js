/* Lazy, source-derived work list. Authentication, writes and vehicle access stay in the scoped store. */
(function(root){
 'use strict';
 const DAY=86400000,PAGE_SIZE=25,TERMINAL=new Set(['done','completed','cancelled','reversed']);
 const GROUPS=[['all','전체'],['contact','오늘 연락'],['schedule','방문·계약·출고'],['cash','입출금'],['loan','재고금융'],['documents','서류·이전'],['preparation','상품화'],['pricing','가격 검토'],['aftercare','사후 처리'],['other','기타']];
 const PREFS=[['noInquiryDays','광고 문의 점검'],['priceReviewDays','재고 가격 검토'],['strategyReviewDays','판매 전략 검토'],['maturityDays','대출 만기 알림'],['dueSoonDays','예정 업무 알림']];
 const text=value=>typeof value==='string'?value:'',safeWon=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
 const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const at=Date.parse(value+'T00:00:00Z');return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value?value:null;};
 const dayNumber=value=>day(value)?Date.parse(value+'T00:00:00Z')/DAY:null;
 function currentDay(now=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');}
 const workspaceKey=workspace=>[workspace.companyId,workspace.ownerId,workspace.carId].join(':');
 function preferences(value){
  const record=value?.payload?value:{payload:value,revision:null};
  if(!record.payload||PREFS.some(([key])=>!Number.isInteger(record.payload[key])||record.payload[key]<1||record.payload[key]>3650))throw Error('INVALID_WORK_PREFERENCES');
  return {payload:Object.fromEntries(PREFS.map(([key])=>[key,record.payload[key]])),revision:Number.isSafeInteger(record.revision)&&record.revision>=0?record.revision:null};
 }
 function group(task){
  if(task.group)return task.group;
  if(['document','transfer'].includes(task.kind)||task.category==='verification')return 'documents';
  if(task.category==='contact')return 'contact';
  if(['visit','contract','delivery'].includes(task.category))return 'schedule';
  return ({preparation:'preparation',price_review:'pricing',aftercare:'aftercare'})[task.category]||'other';
 }
 function financialTasks(workspace,summary,prefs,today){
  const result=[],at=dayNumber(today),horizon=at+prefs.dueSoonDays,key=workspaceKey(workspace);
  const push=(entry,extra)=>result.push({id:key+':'+extra.group+':'+entry.id,sourceId:entry.id,kind:extra.group==='loan'?'loan':'cash',companyId:workspace.companyId,ownerId:workspace.ownerId,carId:workspace.carId,cycleId:entry.cycleId||null,status:'open',priority:extra.group==='loan'?180:160,...extra,overdue:!!day(extra.dueDate)&&extra.dueDate<today});
  const cash=summary.vehicleCash||summary.cash,plannedRows=cash?.planned||[];
  for(const planned of plannedRows){
   if(!planned?.id||!['in','out'].includes(planned.direction))continue;
   const due=day(planned.dueDate),n=dayNumber(due);if(n!==null&&n>horizon)continue;
   push({...planned,cycleId:(workspace.entries||[]).find(entry=>entry.id===planned.id)?.cycleId},{group:'cash',title:planned.direction==='in'?'입금 예정 확인':'지급 예정 확인',description:!due?'예정일을 입력해 주세요.':'확인된 입출금과 구분된 예정 내역입니다.',dueDate:due,amountWon:safeWon(planned.amountWon)?planned.amountWon:null});
  }
  for(const cycle of summary.cycles||[])for(const payable of cycle.costs?.payables||[]){
   if(!payable?.entryId||!safeWon(payable.remainingWon)||payable.remainingWon===0||plannedRows.some(entry=>entry.direction==='out'&&entry.purpose==='cost'&&entry.referenceId===payable.entryId))continue;
   const due=day(payable.dueDate),n=dayNumber(due);if(n!==null&&n>horizon)continue;
   push({id:'cost:'+payable.entryId,cycleId:cycle.id},{sourceId:payable.entryId,kind:'cost',group:'cash',title:'발생 비용 미지급',description:text(payable.label)||'지급 확인이 남은 발생 비용입니다.',dueDate:due,amountWon:payable.remainingWon});
  }
  for(const loan of summary.loans||[]){
   if(!loan?.id||!safeWon(loan.principalOutstandingWon)||loan.principalOutstandingWon===0)continue;
   const cycle=(workspace.cycles||[]).find(item=>item.id===loan.cycleId);
   const due=day(loan.maturityDate),n=dayNumber(due),soldDate=day(cycle?.details?.saleDate);
   const sold=cycle?.status!=='cancelled'&&(!!soldDate&&soldDate<=today||workspace.currentCycleId===loan.cycleId&&workspace.carSnapshot?.status==='판매완료');
   if(!sold&&(n===null||n>at+prefs.maturityDays))continue;
   push(loan,{group:'loan',title:sold?'판매 후 재고금융 미상환':'재고금융 만기 확인',description:text(loan.lender)||'금융사 확인 필요',dueDate:due,amountWon:loan.principalOutstandingWon});
  }
  return result;
 }
 function derive(workspaces,prefs,today,workflow,finance){
  const unique=new Map(),warnings=new Set(),summaries=[];
  for(const workspace of workspaces){
   const source=workspace.carSnapshot;if(!source||typeof source!=='object')throw Error('MISSING_WORK_CAR');
   const tasks=workflow.tasks(workspace,source,prefs,{today}),summary=finance.summarize(workspace,source,{asOf:today});
   summaries.push(summary);
   if(!Array.isArray(tasks))throw Error('INVALID_WORK_TASKS');
   if(summary.complete===false)warnings.add('일부 금액·기한이 미확정입니다. 원본 업무에서 확인해 주세요.');
   for(const item of [...tasks,...financialTasks(workspace,summary,prefs,today)]){
    if(!item||!text(item.id)||TERMINAL.has(item.status))continue;
    if(['companyId','ownerId','carId'].some(key=>item[key]!=null&&String(item[key])!==String(workspace[key])))throw Error('INVALID_WORK_TASK_SCOPE');
    if(workspace.capabilities?.customerRead!==true&&(item.kind==='lead'||['contact','visit','contract','delivery'].includes(item.category)))continue;
    const task={...item,group:group(item),dueDate:day(item.dueDate),workspace,carLabel:text(source.model)||'차량 정보 없음',plate:text(source.plate)};
    task.overdue=!!task.dueDate&&task.dueDate<today;unique.set(workspaceKey(workspace)+':'+item.id,task);
   }
  }
  const sumKnown=values=>{if(!values.length||values.some(value=>typeof value!=='number'||!Number.isSafeInteger(value)))return null;const total=values.reduce((sum,value)=>sum+BigInt(value),0n);return total>BigInt(Number.MAX_SAFE_INTEGER)||total<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(total);};
  const cash=key=>sumKnown(summaries.map(summary=>(summary.vehicleCash||summary.cash)?.[key])),cycles=summaries.flatMap(summary=>summary.cycles||[]);
  const totals={confirmedNetWon:cash('netWon'),transferDepositWon:cash('transferDepositBalanceWon'),plannedInWon:cash('plannedInWon'),plannedOutWon:cash('plannedOutWon'),receivableWon:sumKnown(cycles.map(cycle=>cycle.sale?.receivableWon)),purchasePayableWon:sumKnown(cycles.map(cycle=>cycle.purchase?.payableWon)),costPayableWon:sumKnown(cycles.map(cycle=>cycle.costs?.payableWon))};
  return {tasks:[...unique.values()].sort((a,b)=>Number(b.overdue)-Number(a.overdue)||(b.priority||0)-(a.priority||0)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.id.localeCompare(b.id)),totals,warnings:[...warnings]};
 }
 function filterTasks(tasks,category,dateFilter,today){return tasks.filter(task=>(category==='all'||task.group===category)&&(dateFilter==='all'||dateFilter==='today'&&task.dueDate===today||dateFilter==='overdue'&&task.overdue||dateFilter==='undated'&&!task.dueDate||dateFilter==='actionable'&&(!task.dueDate||task.dueDate<=today)));}
 const model=Object.freeze({currentDay,preferences,financialTasks,derive,filterTasks});
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document||root.SnoteBusinessToday)return;
 const doc=root.document,store=()=>root.SnoteBusinessStore;
 let session=null,waitingHost=null,scheduled=false,signalValue='',serial=0;
 const node=(tag,label,cls)=>{const element=doc.createElement(tag);if(label!=null)element.textContent=label;if(cls)element.className=cls;return element;};
 const button=(label,cls)=>{const element=node('button',label,cls);element.type='button';return element;};
 const amount=value=>value.toLocaleString('ko-KR')+'원';
 function routeName(){try{return typeof route==='string'?route:'';}catch{return '';}}
 function context(){try{const ctx=store()?.context?.();return ctx&&ctx.ready!==false&&text(ctx.key)&&text(ctx.companyId)&&text(ctx.actorId)&&['admin','dealer','accountant'].includes(ctx.role)&&store()?.current?.(ctx)===true?ctx:null;}catch{return null;}}
 function locationFor(ctx){
  const page=routeName();
  if(page==='dashboard'&&['admin','dealer'].includes(ctx?.role)){const home=doc.getElementById('snote-dashboard-home');return home?{parent:home.parentNode,before:home,home,page}:null;}
  if(page==='contractOffice'&&ctx?.role==='accountant'){const landing=doc.getElementById('contract-office-landing'),fallback=doc.getElementById('alt-content');return landing?{parent:landing.parentNode,before:landing,landing,page}:fallback?{parent:fallback,before:fallback.firstChild,page}:null;}
  return null;
 }
 function gate(ctx,location){
  if(!ctx||!location)return 'unavailable';
  if(location.home){try{const snapshot=root.snoteHomeDashboardBridge?.snapshot?.();if(!snapshot||snapshot.loading)return 'waiting';if(snapshot.locked)return 'locked';if(root.snoteHomeDashboardBridge?.current?.(snapshot.key)!==true)return 'waiting';}catch{return 'waiting';}}
  if(location.landing?.hidden)return 'inactive';
  if(!root.SnoteBusinessWorkflows?.tasks||!root.SnoteBusinessFinance?.summarize||typeof store()?.list!=='function')return 'waiting';
  return 'ready';
 }
 function live(s){const ctx=context();return !doc.hidden&&session===s&&s.host.isConnected&&ctx?.key===s.context.key&&ctx.companyId===s.context.companyId&&ctx.actorId===s.context.actorId&&ctx.role===s.context.role&&gate(ctx,locationFor(ctx))==='ready';}
 function closePreferences(s){if(s?.dialog){try{s.dialog.close();}catch{}s.dialog.remove();s.dialog=null;}}
 function cancel(s){if(!s)return;s.request++;if(s.idle!=null){if(s.idleType==='idle')root.cancelIdleCallback?.(s.idle);else root.clearTimeout(s.idle);s.idle=null;}closePreferences(s);}
 function clear(keepWaiting=false){if(session){cancel(session);session.host.remove();session=null;}if(!keepWaiting&&waitingHost){waitingHost.remove();waitingHost=null;}}
 function state(s,message,kind='waiting'){
  s.host.replaceChildren();s.host.dataset.state=kind;s.host.setAttribute('aria-busy',String(kind==='loading'));
  s.host.append(node('h2','오늘 처리할 업무'),node('p',message,'snote-business-today-state'));
 }
 function status(s){
  if(s.error)return s.error;
  if(s.loading)return s.page?'다음 차량의 업무를 확인하는 중…':'원본 업무를 확인하는 중…';
  const tail=s.hasMore?' · 더 불러올 차량이 있습니다.':'';return '불러온 차량 '+s.workspaces.size+'대 기준'+tail;
 }
 function render(s){
  if(!live(s))return;
  s.host.replaceChildren();s.host.dataset.state=s.error&&!s.page?'error':'ready';s.host.setAttribute('aria-busy',String(s.loading));
  const head=node('header',null,'snote-business-today-head'),title=node('div');title.append(node('h2','오늘 처리할 업무'),node('p',s.today+' · '+(s.scope==='company'?'상사 전체 업무':'내 업무'),'snote-business-today-subtitle'));
  const actions=node('div',null,'snote-business-today-actions'),reload=button('새로고침'),settings=button('운영 기준');reload.disabled=s.loading;reload.onclick=()=>{if(live(s))load(s,false);};settings.disabled=s.loading||!s.preferences;settings.onclick=()=>openPreferences(s);actions.append(reload,settings);head.append(title,actions);s.host.append(head);
  if(s.context.role==='admin'&&s.context.canCompany===true){const scopes=node('div',null,'snote-business-today-scopes');scopes.setAttribute('role','group');scopes.setAttribute('aria-label','업무 조회 범위');for(const[key,label]of [['mine','내 업무'],['company','상사 전체']]){const choose=button(label);choose.dataset.scope=key;choose.setAttribute('aria-pressed',String(s.scope===key));choose.onclick=()=>{if(!live(s)||s.scope===key)return;s.scope=key;s.category='all';load(s,false);};scopes.append(choose);}s.host.append(scopes);}
  const search=node('form',null,'snote-business-today-toolbar'),searchLabel=node('label','차량 검색'),input=node('input'),searchButton=button('검색');input.type='search';input.maxLength=120;input.value=s.draftQuery??s.query;input.oninput=()=>{s.draftQuery=input.value;};input.placeholder='차량번호·차명';input.setAttribute('aria-label','차량번호 또는 차명 검색');searchLabel.append(input);searchButton.type='submit';search.append(searchLabel,searchButton);
  const dateLabel=node('label','기한'),select=node('select');select.setAttribute('aria-label','업무 기한 필터');for(const[value,label]of [['actionable','오늘·기한 지남·예정일 미입력'],['today','오늘'],['overdue','기한 지남'],['undated','예정일 미입력'],['all','예정 업무 포함']]){const option=node('option',label);option.value=value;select.append(option);}select.value=s.dateFilter;select.onchange=()=>{if(live(s)){s.dateFilter=select.value;render(s);}};dateLabel.append(select);search.append(dateLabel);
  search.onsubmit=event=>{event.preventDefault();if(!live(s))return;s.query=input.value.trim();s.draftQuery=s.query;load(s,false);};s.host.append(search);
  const categories=node('div',null,'snote-business-today-categories');categories.setAttribute('role','group');categories.setAttribute('aria-label','업무 종류');
  for(const[key,label]of GROUPS){if(key==='other'&&!s.tasks.some(task=>task.group==='other'))continue;const choose=button(label);choose.dataset.category=key;choose.setAttribute('aria-pressed',String(s.category===key));choose.onclick=()=>{if(live(s)){s.category=key;render(s);}};categories.append(choose);}s.host.append(categories);
  const feedback=node('p',status(s),'snote-business-today-feedback');feedback.setAttribute('role','status');if(s.error)feedback.dataset.error='true';s.host.append(feedback);
  for(const warning of s.warnings)s.host.append(node('p',warning,'snote-business-today-warning'));
  if(s.totals&&s.workspaces.size){
   const disclosure=node('details',null,'snote-business-today-totals');disclosure.open=!!s.showTotals;disclosure.addEventListener('toggle',()=>{s.showTotals=disclosure.open;});disclosure.append(node('summary','불러온 원장 금액 요약'),node('p','불러온 차량의 등록 원장 기준 · 예정 금액은 예정일 전체 기준','snote-business-today-feedback'));
   const values=node('dl');for(const[key,label]of [['confirmedNetWon','확인 입출금 순액'],['transferDepositWon','고객 이전비 보관금'],['plannedInWon','예정 입금'],['plannedOutWon','예정 출금'],['receivableWon','등록 기준 판매 미수금'],['purchasePayableWon','등록 기준 매입 미지급금'],['costPayableWon','등록 기준 비용 미지급금']]){const item=node('div'),value=s.totals[key],dd=node('dd',value==null?'미확인':amount(value));dd.dataset.total=key;if(value<0)dd.className='is-negative';item.append(node('dt',label),dd);values.append(item);}disclosure.append(values,node('p','확인 입출금 순액은 은행 계좌 잔액을 나타내지 않습니다.','snote-business-today-feedback'));s.host.append(disclosure);
  }
  const tasks=filterTasks(s.tasks,s.category,s.dateFilter,s.today),list=node('div',null,'snote-business-today-list'),limit=s.taskLimit||50;list.setAttribute('role','list');
  for(const task of tasks.slice(0,limit)){
   const row=button(null,'snote-business-today-task');row.dataset.taskId=task.id;row.dataset.sourceId=String(task.sourceId||'');row.dataset.kind=task.kind;
   const info=node('span',null,'snote-business-today-task-info');info.append(node('strong',task.title||'업무 확인'),node('span',[task.carLabel,task.plate].filter(Boolean).join(' · ')),node('small',task.description||'차량 상세에서 원본 업무를 확인합니다.'));
   const detail=node('span',null,'snote-business-today-task-meta'),dateText=task.dueDate?(task.overdue?'기한 지남 · ':task.dueDate===s.today?'오늘 · ':'예정 · ')+task.dueDate:'예정일 미입력';detail.append(node('span',dateText,task.overdue?'is-overdue':''));if(safeWon(task.amountWon))detail.append(node('strong',amount(task.amountWon)));detail.append(node('small','원본 업무 열기'));
   row.append(info,detail);row.onclick=async()=>{if(!live(s)||s.opening)return;s.opening=true;row.disabled=true;const source=store(),ctx=s.context;try{const ok=await source.openVehicle(task.workspace);if(ok===true&&source===store()&&source.current(ctx)===true)await root.SnoteVehicleBusiness?.focus?.(task.sourceId);else if(live(s)&&ok!==true){s.error='차량을 열지 못했습니다. 권한과 원본 자료를 다시 확인해 주세요.';render(s);}}catch{if(live(s)){s.error='차량을 열지 못했습니다. 잠시 후 다시 시도해 주세요.';render(s);}}finally{s.opening=false;if(row.isConnected)row.disabled=false;}};const item=node('div',null,'snote-business-today-item');item.setAttribute('role','listitem');item.append(row);list.append(item);
  }
  if(!tasks.length&&!s.loading&&!s.error){const message=!s.workspaces.size?'등록된 업무 원본이 없습니다. 차량 상세에서 업무를 등록해 주세요.':s.tasks.length?'선택한 조건에 맞는 업무가 없습니다.':'불러온 차량에서 처리할 업무가 없습니다.';list.append(node('p',message,'snote-business-today-empty'));}
  s.host.append(list);
  if(tasks.length>limit){const moreTasks=button('업무 50건 더 보기','snote-business-today-more-tasks');moreTasks.onclick=()=>{if(live(s)){s.taskLimit=limit+50;render(s);}};s.host.append(node('p','불러온 업무 '+tasks.length+'건 중 '+limit+'건 표시','snote-business-today-feedback'),moreTasks);}
  if(s.hasMore||s.error){const more=button(s.error?'다시 확인':'차량 더 불러오기','snote-business-today-more');more.disabled=s.loading;more.onclick=()=>{if(live(s))load(s,!!s.page);};s.host.append(more);}
 }
 async function load(s,append){
  if(!live(s))return;const request=++s.request,page=append?s.page+1:1,ctx=s.context,source=store();
  if(!append){s.workspaces.clear();s.tasks=[];s.warnings=[];s.totals=null;s.taskLimit=50;s.page=0;s.hasMore=false;}s.loading=true;s.error='';render(s);
  try{
   const result=await source.list({scope:s.scope,page,pageSize:PAGE_SIZE,query:s.query,force:true});
   if(!live(s)||s.request!==request||store()!==source||source.current(ctx)!==true)return;
   if(!result||result.page!==page||typeof result.hasMore!=='boolean'||!Array.isArray(result.items)||result.items.length>PAGE_SIZE)throw Error('INVALID_WORK_LIST');
   if(result.items.some(workspace=>workspace?.companyId!==ctx.companyId||s.scope==='mine'&&workspace?.ownerId!==ctx.actorId))throw Error('INVALID_WORK_LIST_SCOPE');
   let pref=result.preferences;if(!pref)pref=await source.preferences();if(!live(s)||s.request!==request||store()!==source)return;
   const confirmed=preferences(pref),next=new Map(s.workspaces);for(const workspace of result.items)next.set(workspaceKey(workspace),workspace);
   const projected=derive([...next.values()],confirmed.payload,s.today,root.SnoteBusinessWorkflows,root.SnoteBusinessFinance);
   if(!live(s)||s.request!==request)return;s.workspaces=next;s.preferences=confirmed;s.tasks=projected.tasks;s.totals=projected.totals;s.warnings=projected.warnings;s.page=page;s.hasMore=result.hasMore;
  }catch(error){if(live(s)&&s.request===request)s.error=['SETUP_REQUIRED','BUSINESS_SETUP_REQUIRED','PGRST202','42883'].includes(error?.code)?'업무 시스템 설정이 아직 준비되지 않았습니다.':'원본 업무를 불러오지 못했습니다. 다시 확인해 주세요.';}
  finally{if(live(s)&&s.request===request){s.loading=false;render(s);}}
 }
 function lazy(s){
  if(s.idle!=null||s.page||s.loading)return;
  const run=()=>{s.idle=null;if(live(s))void load(s,false);};
  if(typeof root.requestIdleCallback==='function'){s.idleType='idle';s.idle=root.requestIdleCallback(run,{timeout:1200});}else{s.idleType='timer';s.idle=root.setTimeout(run,0);}
 }
 async function openPreferences(s){
  if(!live(s)||s.dialog||!s.preferences)return;
  const dialog=node('dialog',null,'snote-business-today-dialog');dialog.id='snote-business-today-preferences';s.dialog=dialog;dialog.setAttribute('aria-labelledby','snote-business-today-preferences-title');
  const form=node('form'),title=node('h2','업무 운영 기준');title.id='snote-business-today-preferences-title';form.append(title,node('p','사용자 운영 기준입니다. 업계 공통 기준이나 법적 기준이 아닙니다.'));
  const controls=new Map();for(const[key,label]of PREFS){const row=node('label',label+' (일)'),input=node('input');input.type='number';input.min='1';input.max='3650';input.step='1';input.required=true;input.value=String(s.preferences.payload[key]);input.dataset.preference=key;row.append(input);form.append(row);controls.set(key,input);}
  const feedback=node('p',null,'snote-business-today-feedback');feedback.setAttribute('role','status');const actions=node('div',null,'snote-business-today-actions'),close=button('닫기'),save=button('기준 저장');save.type='submit';close.onclick=()=>closePreferences(s);actions.append(close,save);form.append(feedback,actions);dialog.append(form);doc.body.append(dialog);dialog.addEventListener('cancel',()=>{s.dialog=null;dialog.remove();});
  try{dialog.showModal();}catch{dialog.setAttribute('open','');}
  form.onsubmit=async event=>{
   event.preventDefault();if(!live(s)||save.disabled)return;let payload;try{payload=preferences(Object.fromEntries([...controls].map(([key,input])=>[key,Number(input.value)]))).payload;}catch{feedback.textContent='각 기준에 1~3650일의 정수를 입력해 주세요.';return;}
   if(s.preferences.revision==null){feedback.textContent='저장 버전을 확인하지 못했습니다. 업무 목록을 새로고침해 주세요.';return;}
   save.disabled=true;close.disabled=true;s.savingPreferences=true;const source=store(),expected=s.preferences.revision;
   try{const result=await source.savePreferences(payload,expected);if(!live(s)||s.dialog!==dialog||store()!==source)return;const confirmed=preferences(result);if(confirmed.revision!==expected+1||JSON.stringify(confirmed.payload)!==JSON.stringify(payload))throw Error('INVALID_WORK_PREFERENCE_ACK');s.preferences=confirmed;closePreferences(s);await load(s,false);}
   catch{if(live(s)&&s.dialog===dialog)feedback.textContent='저장을 확인하지 못했습니다. 입력을 유지했습니다. 새로 불러온 뒤 다시 저장해 주세요.';}
   finally{s.savingPreferences=false;if(dialog.isConnected){save.disabled=false;close.disabled=false;}}
  };
 }
 function refresh(){
  scheduled=false;const ctx=context(),location=locationFor(ctx);
  if(!ctx){
   clear(true);const page=routeName(),pending=locationFor({role:page==='contractOffice'?'accountant':'dealer'});
   if(!pending){clear();signalValue=signal();return;}
   if(!waitingHost){waitingHost=node('section',null,'snote-business-today');waitingHost.id='snote-business-today';waitingHost.dataset.state='waiting';waitingHost.append(node('h2','오늘 처리할 업무'),node('p','업무 시스템을 준비하고 있습니다. 계정과 상사 연결을 확인합니다.','snote-business-today-state'));}
   if(waitingHost.parentNode!==pending.parent||waitingHost.nextSibling!==pending.before)pending.parent.insertBefore(waitingHost,pending.before);
   signalValue=signal();return;
  }
  if(!location){clear();signalValue=signal();return;}
  const identity=[ctx.key,ctx.companyId,ctx.actorId,ctx.role,location.page].join('|');
  if(!session||session.identity!==identity){clear();const host=node('section',null,'snote-business-today');host.id='snote-business-today';host.setAttribute('aria-label','오늘 처리할 업무');session={host,identity,context:ctx,scope:ctx.role==='accountant'?'company':'mine',today:currentDay(),page:0,query:'',category:'all',dateFilter:'actionable',workspaces:new Map(),tasks:[],warnings:[],preferences:null,request:0,idle:null,loading:false,error:'',serial:++serial};}
  const s=session;if(s.host.parentNode!==location.parent||s.host.nextSibling!==location.before)location.parent.insertBefore(s.host,location.before);
  const access=gate(ctx,location);s.host.hidden=access==='inactive';
  if(access!=='ready'){cancel(s);s.workspaces.clear();s.tasks=[];s.warnings=[];s.preferences=null;s.page=0;s.hasMore=false;s.loading=false;s.error='';if(access!=='inactive')state(s,access==='locked'?'잠금 해제 후 오늘 업무를 확인할 수 있습니다.':'업무 시스템을 준비하고 있습니다.',access==='locked'?'locked':'waiting');signalValue=signal();return;}
  if(s.today!==currentDay()){s.today=currentDay();s.page=0;s.workspaces.clear();s.tasks=[];}
  if(!s.page&&!s.loading&&!s.error){state(s,'원본 업무를 확인할 준비가 되었습니다.','waiting');lazy(s);}else if(!s.host.children.length)render(s);
  signalValue=signal();
 }
 function schedule(){if(!scheduled){scheduled=true;root.requestAnimationFrame(refresh);}}
 function signal(){const ctx=context();return [routeName(),ctx?.key||'',ctx?.role||'',doc.getElementById('snote-dashboard-home')?.dataset.state||'',!!store()?.list,!!root.SnoteBusinessWorkflows?.tasks,!!root.SnoteBusinessFinance?.summarize,currentDay()].join('|');}
 root.addEventListener('snote:route-changed',schedule);
 root.addEventListener('snote:business-ready',schedule);
 root.addEventListener('snote:business-changed',event=>{const s=session;if(!s||s.savingPreferences)return;const supplied=event.detail?.scope&&typeof event.detail.scope==='object'?event.detail.scope:event.detail||{};if(supplied.companyId&&supplied.companyId!==s.context.companyId||supplied.actorId&&supplied.actorId!==s.context.actorId||s.scope==='mine'&&supplied.ownerId&&supplied.ownerId!==s.context.actorId)return;if(doc.hidden){s.dirty=true;return;}if(live(s))void load(s,false);});
 doc.addEventListener('snote:finance-lock-changed',refresh);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden){if(session){cancel(session);session.loading=false;}}else{if(session?.dirty&&live(session)){session.dirty=false;void load(session,false);}else if(session&&session.page&&live(session))render(session);schedule();}});
 new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('#snote-business-today,#snote-business-today-preferences')))schedule();}).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-state']});
 root.setInterval(()=>{if(doc.hidden)return;const next=signal();if(next!==signalValue||session&&!session.host.isConnected)schedule();},1000);
 root.SnoteBusinessToday=Object.freeze({refresh:schedule,inspect:()=>session?{scope:session.scope,state:session.host.dataset.state,page:session.page,loading:session.loading,workspaces:session.workspaces.size,tasks:session.tasks.length}:null});
 root.SnoteBusinessTodayModel=model;schedule();
})(typeof window==='object'?window:globalThis);
