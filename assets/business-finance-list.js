/* Separate loan ledger projection. Never merged into legacy inventory-finance totals. */
(()=>{
 'use strict';if(window.SnoteBusinessFinanceList)return;
 const doc=document,store=()=>window.SnoteBusinessStore,node=(tag,label,cls)=>{const el=doc.createElement(tag);if(label!=null)el.textContent=label;if(cls)el.className=cls;return el;},button=label=>{const el=node('button',label);el.type='button';return el;};
 const currency=value=>typeof value==='number'&&Number.isSafeInteger(value)?value.toLocaleString('ko-KR')+'원':'미확인';
 const today=()=>window.SnoteBusinessFinance?.today?.()||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 let session=null,queued=false,lastSignal='';
 function routeName(){try{return typeof route==='string'?route:'';}catch{return '';}}
 function context(){try{const ctx=store()?.context?.();return ctx&&ctx.ready!==false&&['admin','accountant'].includes(ctx.role)&&ctx.canCompany===true&&store()?.current?.(ctx)===true?ctx:null;}catch{return null;}}
 function target(){return routeName()==='inventoryFinance'?doc.getElementById('alt-content'):null;}
 function live(s){const ctx=context();return !doc.hidden&&session===s&&s.host.isConnected&&target()===s.host.parentNode&&ctx?.key===s.context.key&&ctx.companyId===s.context.companyId&&ctx.actorId===s.context.actorId&&ctx.role===s.context.role;}
 function stop(s){if(!s)return;s.request++;if(s.idle!=null){if(s.idleType==='idle')window.cancelIdleCallback?.(s.idle);else clearTimeout(s.idle);s.idle=null;}}
 function clear(){if(session){stop(session);session.host.remove();session=null;}}
 function status(s,message,kind){s.host.replaceChildren();s.host.dataset.state=kind;s.host.setAttribute('aria-busy',String(kind==='loading'));s.host.append(node('h2','업무 원장의 미상환 금융'),node('p',message,'snote-business-finance-state'));}
 function projection(workspaces,asOf){
  const rows=[];for(const workspace of workspaces){if(!workspace.carSnapshot)throw Error('MISSING_FINANCE_CAR');const summary=window.SnoteBusinessFinance.summarize(workspace,workspace.carSnapshot,{asOf});for(const loan of summary.loans){if(loan.principalOutstandingWon===0)continue;const cycle=workspace.cycles.find(item=>item.id===loan.cycleId),sold=cycle?.status!=='cancelled'&&(typeof cycle?.details?.saleDate==='string'&&cycle.details.saleDate<=asOf||workspace.currentCycleId===loan.cycleId&&workspace.carSnapshot.status==='판매완료');rows.push({workspace,loan,sold});}}
  return rows.sort((a,b)=>(a.loan.maturityDate||'9999-12-31').localeCompare(b.loan.maturityDate||'9999-12-31')||a.workspace.carId.localeCompare(b.workspace.carId)||a.loan.id.localeCompare(b.loan.id));
 }
 function render(s){
  if(!live(s))return;s.host.replaceChildren();s.host.dataset.state=s.error&&!s.page?'error':'ready';s.host.setAttribute('aria-busy',String(s.loading));
  const head=node('header',null,'snote-business-finance-head'),label=node('div');label.append(node('h2','업무 원장의 미상환 금융'),node('p',(s.scope==='company'?'상사 전체':'내 원장')+' · 불러온 차량 '+s.workspaces.size+'대 기준','snote-business-finance-caption'));const reload=button('새로고침');reload.disabled=s.loading;reload.onclick=()=>{if(live(s))void load(s,false);};head.append(label,reload);s.host.append(head,node('p','신규 업무 원장에 등록된 대출 중 잔액이 남았거나 잔액 확인이 필요한 내역입니다. 기존 재고금융 합계와 별도로 표시합니다.','snote-business-finance-caption'));
  if(s.context.role==='admin'){const scopes=node('div',null,'snote-business-finance-scopes');scopes.setAttribute('role','group');scopes.setAttribute('aria-label','업무 금융 조회 범위');for(const[key,title]of [['mine','내 원장'],['company','상사 전체']]){const choose=button(title);choose.dataset.scope=key;choose.setAttribute('aria-pressed',String(s.scope===key));choose.onclick=()=>{if(live(s)&&s.scope!==key){s.scope=key;void load(s,false);}};scopes.append(choose);}s.host.append(scopes);}
  const form=node('form',null,'snote-business-finance-search'),search=node('input'),submit=button('검색');search.type='search';search.maxLength=120;search.placeholder='차량번호·차명';search.setAttribute('aria-label','업무 금융 차량번호 또는 차명 검색');search.value=s.draftQuery??s.query;search.oninput=()=>{s.draftQuery=search.value;};submit.type='submit';form.append(search,submit);form.onsubmit=event=>{event.preventDefault();if(live(s)){s.query=search.value.trim();s.draftQuery=s.query;void load(s,false);}};s.host.append(form);
  const feedback=node('p',s.error||(s.loading?'업무 원장의 대출을 확인하는 중…':s.hasMore?'더 불러올 차량이 있습니다.':'불러온 원장을 모두 확인했습니다.'),'snote-business-finance-feedback');feedback.setAttribute('role','status');if(s.error)feedback.dataset.error='true';s.host.append(feedback);
  const list=node('div',null,'snote-business-finance-rows');
  const limit=s.rowLimit||50;
  for(const{workspace,loan,sold}of s.rows.slice(0,limit)){
   const row=button(null);row.className='snote-business-finance-row';row.dataset.loanId=loan.id;row.dataset.carId=workspace.carId;row.setAttribute('aria-label',(workspace.carSnapshot.model||'차량')+' · '+(loan.lender||'금융사 미입력')+' · 원본 대출 열기');
   const name=node('span',null,'snote-business-finance-name');name.append(node('strong',workspace.carSnapshot.model||'차량 정보 없음'),node('span',workspace.carSnapshot.plate||'차량번호 미입력'),node('small',loan.lender||'금융사 미입력'));if(sold)name.append(node('small','판매 후 상환 확인','snote-business-finance-sold'));
   const value=node('span',null,'snote-business-finance-value');value.append(node('small','남은 대출 원금'),node('strong',currency(loan.principalOutstandingWon)),node('span',loan.maturityDate?'만기 '+loan.maturityDate:'만기 미입력'));
   const interest=node('span',null,'snote-business-finance-interest');interest.append(node('span','추정 이자 '+currency(loan.estimatedInterestWon)),node('span','등록된 확정 청구 이자 '+currency(loan.actualInterestWon)),node('span','관리 이자 '+currency(loan.managementInterestWon)),node('small','원본 대출 열기'));
   row.append(name,value,interest);if(loan.warnings?.length){const warning=node('span',loan.warnings.join(' '),'snote-business-finance-warning');row.append(warning);}
   row.onclick=async()=>{if(!live(s)||s.opening)return;s.opening=true;row.disabled=true;const source=store(),ctx=s.context;try{const opened=await source.openVehicle(workspace);if(opened===true&&store()===source&&source.current(ctx)===true)await window.SnoteVehicleBusiness?.focus?.(loan.id);else if(live(s)){s.error='원본 대출을 열지 못했습니다. 차량 연결과 권한을 다시 확인해 주세요.';render(s);}}catch{if(live(s)){s.error='원본 대출을 열지 못했습니다. 잠시 후 다시 시도해 주세요.';render(s);}}finally{s.opening=false;if(row.isConnected)row.disabled=false;}};list.append(row);
  }
  if(!s.rows.length&&!s.loading&&!s.error)list.append(node('p',s.workspaces.size?'불러온 원장에 미상환 또는 잔액 미확인 대출이 없습니다.':'조회된 업무 원장이 없습니다. 기존 재고금융 내역은 위 목록에서 확인해 주세요.','snote-business-finance-empty'));s.host.append(list);
  if(s.rows.length>limit){const moreRows=button('대출 50건 더 보기');moreRows.className='snote-business-finance-more-rows';moreRows.onclick=()=>{if(live(s)){s.rowLimit=limit+50;render(s);}};s.host.append(node('p','불러온 대출 '+s.rows.length+'건 중 '+limit+'건 표시','snote-business-finance-feedback'),moreRows);}
  if(s.hasMore||s.error){const more=button(s.error?'다시 확인':'차량 더 불러오기');more.className='snote-business-finance-more';more.disabled=s.loading;more.onclick=()=>{if(live(s))void load(s,!!s.page);};s.host.append(more);}
 }
 async function load(s,append){
  if(!live(s)||typeof store()?.list!=='function'||!window.SnoteBusinessFinance?.summarize)return;const request=++s.request,source=store(),page=append?s.page+1:1;
  if(!append){s.workspaces.clear();s.rows=[];s.rowLimit=50;s.page=0;s.hasMore=false;}s.loading=true;s.error='';render(s);
  try{const result=await source.list({scope:s.scope,page,pageSize:25,query:s.query,force:true});if(!live(s)||request!==s.request||source!==store())return;if(!result||result.page!==page||!Array.isArray(result.items)||result.items.length>25||typeof result.hasMore!=='boolean'||result.items.some(workspace=>workspace.companyId!==s.context.companyId||s.scope==='mine'&&workspace.ownerId!==s.context.actorId))throw Error('INVALID_FINANCE_SCOPE');
   const next=new Map(s.workspaces);for(const workspace of result.items)next.set([workspace.companyId,workspace.ownerId,workspace.carId].join(':'),workspace);const rows=projection([...next.values()],s.today);if(!live(s)||request!==s.request)return;s.workspaces=next;s.rows=rows;s.page=page;s.hasMore=result.hasMore;
  }catch(error){if(live(s)&&request===s.request)s.error=['PGRST202','42883','SETUP_REQUIRED','BUSINESS_SETUP_REQUIRED'].includes(error?.code)?'업무 원장 설정이 아직 준비되지 않았습니다. 기존 재고금융 내역을 이용해 주세요.':'업무 원장의 금융 내역을 불러오지 못했습니다. 다시 확인해 주세요.';}
  finally{if(live(s)&&request===s.request){s.loading=false;render(s);}}
 }
 function lazy(s){if(s.idle!=null||s.page||s.loading||s.error)return;const run=()=>{s.idle=null;if(live(s))void load(s,false);};if(typeof requestIdleCallback==='function'){s.idleType='idle';s.idle=requestIdleCallback(run,{timeout:1200});}else{s.idleType='timer';s.idle=setTimeout(run,0);}}
 function refresh(){
  queued=false;const ctx=context(),parent=target();if(!ctx||!parent){clear();lastSignal=signal();return;}const identity=[ctx.key,ctx.companyId,ctx.actorId,ctx.role].join('|');
  if(!session||session.identity!==identity){clear();const host=node('section',null,'snote-business-finance');host.id='snote-business-finance-list';host.setAttribute('aria-label','업무 원장의 미상환 금융');session={host,context:ctx,identity,scope:'company',today:today(),workspaces:new Map(),rows:[],page:0,hasMore:false,request:0,idle:null,loading:false,error:'',query:''};}
  const s=session;if(s.host.parentNode!==parent)parent.append(s.host);
  if(!window.SnoteBusinessFinance?.summarize||typeof store()?.list!=='function'){status(s,'업무 금융 시스템을 준비하고 있습니다.','waiting');lastSignal=signal();return;}
  if(s.today!==today()){s.today=today();s.page=0;s.workspaces.clear();s.rows=[];s.error='';}
  if(!s.page&&!s.loading&&!s.error){status(s,'업무 원장의 대출을 확인할 준비가 되었습니다.','waiting');lazy(s);}else if(!s.host.children.length)render(s);lastSignal=signal();
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 function signal(){const ctx=context();return [routeName(),ctx?.key||'',ctx?.role||'',!!window.SnoteBusinessFinance?.summarize,!!store()?.list,today()].join('|');}
 window.addEventListener('snote:route-changed',schedule);window.addEventListener('snote:business-ready',schedule);
 window.addEventListener('snote:business-changed',event=>{const s=session,scope=typeof event.detail?.scope==='object'?event.detail.scope:event.detail||{};if(!s||scope.companyId&&scope.companyId!==s.context.companyId||s.scope==='mine'&&scope.ownerId&&scope.ownerId!==s.context.actorId)return;if(doc.hidden){s.dirty=true;return;}if(live(s))void load(s,false);});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden){if(session){stop(session);session.loading=false;}}else{if(session?.dirty&&live(session)){session.dirty=false;void load(session,false);}else if(session?.page&&live(session))render(session);schedule();}});
 new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('#snote-business-finance-list')))schedule();}).observe(doc.body,{childList:true,subtree:true});
 setInterval(()=>{if(doc.hidden)return;const next=signal();if(lastSignal!==next||session&&!session.host.isConnected)schedule();},1000);
 window.SnoteBusinessFinanceList=Object.freeze({refresh:schedule,inspect:()=>session?{scope:session.scope,page:session.page,loading:session.loading,workspaces:session.workspaces.size,loans:session.rows.length,state:session.host.dataset.state}:null});schedule();
})();
