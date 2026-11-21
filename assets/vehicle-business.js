/* A scoped, explicit business workspace inside the existing vehicle drawer. */
(()=>{
 'use strict';
 const root=globalThis,doc=root.document;if(!doc||root.SnoteVehicleBusiness)return;
 const overlay=doc.getElementById('vehicle-overlay');if(!overlay)return;
 const store=()=>root.SnoteBusinessStore,workflow=()=>root.SnoteBusinessWorkflows,finance=()=>root.SnoteBusinessFinance;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,MAX=1000000000000;
 const tabs=[['trade','거래'],['cash','입출금'],['finance','금융'],['documents','서류·이전'],['customers','고객·업무'],['advertising','광고·상품화'],['appraisal','매입 검토'],['history','이력']];
 const labels={bodywork:'판금·도색',polish:'광택',performanceInspection:'성능점검',advertising:'광고비',purchaseFee:'매입수수료',purchaseOther:'매입비',acquisitionTax:'취득세',incomeTax:'소득세',inventoryInterest:'재고이자',repair:'수리비'};
 const entryNames={cash:'입출금',cost:'차량 비용',loan:'대출 실행',loan_event:'금융 내역',document:'서류·확인',transfer:'명의이전',task:'다음 업무',lead:'고객 상담',appraisal:'매입 검토',advertising:'광고'};
 const cycleNames={open:'진행 중',closed:'마감',cancelled:'취소'};
 const opts=items=>items.map(([value,label])=>({value,label})),field=(key,label,type='text',extra={})=>({key,label,type,required:false,...extra});
 const purposes=opts([['sale','차대금 입금'],['purchase','매입대금 지급'],['cost','발생 비용 지급'],['loan_draw','대출금 입금'],['loan_repayment','대출원금 상환'],['loan_interest','이자 지급'],['transfer_deposit','이전비 보관'],['transfer_refund','이전비 환급'],['sale_refund','판매대금 환불'],['cost_refund','비용 환급'],['purchase_refund','매입대금 반환'],['other','기타']]);
 const financialForms=[
  {kind:'cash',title:'입출금 기록',statuses:opts([['planned','예정'],['confirmed','확인'],['reversed','오입력 취소']]),fields:[field('details.direction','입출금','select',{options:opts([['in','입금'],['out','출금']])}),field('details.purpose','용도','select',{options:purposes}),field('amountWon','금액 (원)','money'),field('effectiveDate','실제 확인일','date'),field('dueDate','예정일','date'),field('details.referenceId','연결 원본','reference'),field('details.notes','확인 내용','textarea')]},
  {kind:'cost',title:'차량 비용',statuses:opts([['estimated','예상'],['incurred','발생'],['unconfirmed','미확정'],['reversed','오입력 취소']]),fields:[field('details.category','비용 종류','select',{options:opts([['preparation','상품화'],['transport','탁송'],['inspection','점검'],['advertising','광고'],['commission','수수료'],['finance','금융 비용'],['aftercare','사후 처리'],['other','기타']])}),field('details.label','비용명','text',{required:true}),field('amountWon','발생·예상 금액 (원)','money',{signed:true}),field('effectiveDate','발생일','date'),field('dueDate','지급 예정일','date'),field('details.sourceCostKey','기존 비용 대체','legacy'),field('details.refundOf','환급 원본','refund'),field('details.evidenceMediaId','확인 근거 첨부','media'),field('details.evidenceUrl','확인 근거 주소'),field('details.notes','메모','textarea')]},
  {kind:'loan',title:'대출 실행',statuses:opts([['unconfirmed','실행 확인 전'],['active','실행 확인'],['reversed','오입력 취소']]),fields:[field('details.lender','금융사','text',{required:true}),field('amountWon','최초 실행원금 (원)','money'),field('details.annualRate','연이율 (%)','number',{decimal:true}),field('effectiveDate','실제 실행일','date'),field('details.maturityDate','만기일','date'),field('details.notes','금융 조건·확인 내용','textarea')]},
  {kind:'loan_event',title:'금융 내역',statuses:opts([['planned','예정'],['confirmed','확인'],['reversed','오입력 취소']]),fields:[field('details.loanId','연결 대출','loan',{required:true}),field('details.eventType','내역 종류','select',{options:opts([['repay','원금 상환'],['draw','추가 실행'],['rate','금리 변경'],['interest_invoice','실제 이자 청구'],['fee','금융 수수료']])}),field('amountWon','금액 (원)','money'),field('effectiveDate','실제 적용일','date'),field('dueDate','예정일','date'),field('details.annualRate','변경 연이율 (%)','number',{decimal:true}),field('details.periodStart','청구 이자 시작일','date'),field('details.periodEnd','청구 이자 종료일 · 당일 제외','date'),field('details.notes','확인 내용','textarea')]}
 ];
 const cycleFields=[field('details.tradeType','거래 유형','select',{options:opts([['direct','직접 매입'],['joint','공동 매입'],['consignment','위탁'],['brokerage','알선']])}),field('details.purchaseSource','매입처'),field('details.purchaseAmountWon','매입금액 (원)','money'),field('details.purchaseDate','매입일','date'),field('details.expectedSaleWon','예상 판매금액 (원)','money'),field('details.saleAmountWon','실제 판매금액 (원)','money'),field('details.saleDate','실제 판매일','date'),field('details.contractDate','계약일','date'),field('details.deliveryDate','실제 인도일','date'),field('details.ownershipPercent','내 지분 (%)','number',{decimal:true}),field('details.commissionWon','위탁·알선 수수료 수익 (원)','money'),field('details.counterpartySettlementWon','상대방 정산금 (원)','money'),field('details.settlementStatus','정산 상태','select',{options:opts([['pending','미확정'],['provisional','잠정'],['final','확정 검토']])}),field('details.costsConfirmed','발생 비용과 미확정 비용을 확인했습니다','checkbox'),field('details.notes','거래 메모','textarea')];
 let session=null,queued=false,serial=0;
 const node=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(label,handler,cls='')=>{const e=node('button',label,cls);e.type='button';e.addEventListener('click',handler);return e;};
 const won=value=>typeof value==='number'&&Number.isSafeInteger(value)?value.toLocaleString('ko-KR')+'원':'확인 필요';
 const signedWon=value=>typeof value==='number'&&Number.isSafeInteger(value)?value===0?'0원':(value>0?'+':'')+value.toLocaleString('ko-KR')+'원':'확인 필요';
 const dateText=value=>typeof value==='string'&&workflow()?.date(value)?value:'날짜 미입력';
 const refKey=value=>value?[value.companyId,value.ownerId,value.carId,value.viewKey||''].join('|'):'';
 const contextKey=()=>store()?.context?.()?.key||'';
 const current=s=>!!s&&session===s&&s.root.isConnected&&overlay.classList.contains('open')&&store()?.current?.(s.context)===true&&refKey(store().vehicle())===s.viewKey&&contextKey()===s.context.key;
 const car=s=>{const view=store()?.vehicle?.();return(refKey(view)===s.viewKey?view.carSnapshot||view.car:null)||s.workspace?.carSnapshot||s.ref.carSnapshot||s.ref.car||{};};
 const source=s=>s.workspace?.cycles.find(c=>c.id===s.cycleId)||null;
 const schema=kind=>financialForms.find(form=>form.kind===kind)||workflow()?.forms.find(form=>form.kind===kind);
 const safeMessage=error=>typeof error?.message==='string'&&/[가-힣]/.test(error.message)&&!/^BUSINESS_/.test(error.message)?error.message:error?.code==='CONFLICT'?'다른 화면에서 업무가 변경되었습니다. 입력을 유지했으니 최신 자료와 비교해 주세요.':/SETUP|UNAVAILABLE|NOT_READY/.test(error?.code||'')?'통합 업무 저장 연결을 준비하고 있습니다. 기존 차량 기능은 계속 사용할 수 있습니다.':'저장 결과를 확인하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.';
 function status(s,text,tone=''){if(!current(s))return;s.message.textContent=text;s.message.dataset.tone=tone;}
 function entries(s){return(s.workspace?.entries||[]).filter(entry=>entry.cycleId===s.cycleId&&(entry.kind!=='lead'||s.workspace.capabilities.customerRead));}
 function titleFor(entry){const d=entry.details||{};return d.title||d.label||d.channel||d.lender||d.agency||d.name||(entry.kind==='loan_event'?({repay:'원금 상환',draw:'추가 실행',rate:'금리 변경',interest_invoice:'실제 이자 청구',fee:'금융 수수료'}[d.eventType]):null)||entryNames[entry.kind]||'업무 기록';}
 function optionLabel(entry){return[entryNames[entry.kind],titleFor(entry),entry.amountWon==null?'':won(entry.amountWon),entry.effectiveDate||entry.dueDate||''].filter(Boolean).join(' · ');}
 function isFact(entry){return!!entry&&(['cash','loan_event'].includes(entry.kind)&&entry.status==='confirmed'||entry.kind==='cost'&&entry.status==='incurred'||entry.kind==='loan'&&entry.status==='active'||entry.status==='reversed');}
 function formState(editor){return JSON.stringify([...editor.form.elements].filter(e=>e.name&&e.type!=='file').map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));}
 const dirty=s=>!!s&&(s.busy||!!s.editor&&(!!s.editor.upload||formState(s.editor)!==s.editor.baseline));
 function reset(){serial++;const s=session;session=null;if(s){++s.readGeneration;s.loading=null;s.root.remove();s.workspace=null;s.editor=null;s.members=[];s.media=[];s.customer=null;s.history=[];}}
 async function beforeLeave(){const s=session;if(!s||!dirty(s))return true;if(!current(s)){reset();return true;}if(s.busy){status(s,'저장 결과를 확인하고 있습니다. 잠시 기다려 주세요.');return false;}const snapshot=formState(s.editor),valid=()=>current(s)&&!s.busy&&s.editor&&formState(s.editor)===snapshot;const accepted=typeof root.snoteConfirm==='function'?await root.snoteConfirm('작성 중인 업무가 있습니다. 저장하지 않고 닫을까요?',{isCurrent:valid,danger:true}):false;if(accepted!==true||!valid())return false;closeEditorNow(s);return true;}
 function closeEditorNow(s){if(s.editor)s.editor.box.remove();s.editor=null;s.draftHost.replaceChildren();}
 async function leaveEditor(s){if(!current(s))return false;if(!dirty(s)){closeEditorNow(s);return true;}return beforeLeave();}
 function create(ref,context){
  const host=node('section',null,'business-vehicle');host.id='business-vehicle';host.setAttribute('aria-label','차량 통합 업무');
  const summary=node('div',null,'business-summary'),head=node('div',null,'business-heading'),copy=node('div');copy.append(node('strong','차량 통합 업무'),node('span','돈·서류·다음 업무를 한곳에서 확인합니다.'));
  const toggle=button('통합 업무 펼치기',()=>{if(!current(s))return;s.open=!s.open;applyOpen(s);},'business-toggle');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','business-workspace');head.append(copy,toggle);
  const panel=node('div',null,'business-workspace');panel.id='business-workspace';panel.hidden=true;
  const bar=node('div',null,'business-toolbar'),cycle=node('select');cycle.id='business-cycle';cycle.setAttribute('aria-label','거래 선택');
  const refresh=button('새로고침',()=>void reload(s,true),'business-secondary');bar.append(cycle,refresh);
  const nav=node('div',null,'business-tabs');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','통합 업무 종류');
  for(const[key,label]of tabs){const tab=button(label,()=>void selectTab(s,key),'business-tab');tab.id='business-tab-'+key;tab.dataset.businessTab=key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','business-content');nav.append(tab);}
  nav.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const visible=[...nav.children].filter(e=>!e.hidden),index=visible.indexOf(event.target);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?visible.length-1:(index+(event.key==='ArrowRight'?1:-1)+visible.length)%visible.length;visible[next].focus();void selectTab(s,visible[next].dataset.businessTab);});
  const message=node('p','','business-message');message.id='business-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const content=node('div',null,'business-content');content.id='business-content';content.setAttribute('role','tabpanel');const list=node('div',null,'business-list'),draftHost=node('div',null,'business-draft-host');content.append(list,draftHost);panel.append(bar,nav,message,content);host.append(head,summary,panel);
  const modal=overlay.querySelector('.vehicle-modal'),header=modal?.querySelector('.vehicle-header');if(!modal||!header)return null;header.after(host);
  const s={root:host,summary,panel,bar,cycle,refresh,nav,message,content,list,draftHost,toggle,ref:{companyId:ref.companyId,ownerId:ref.ownerId,carId:ref.carId,carSnapshot:ref.carSnapshot||ref.car},viewKey:refKey(ref),context,token:++serial,workspace:null,cycleId:null,tab:'trade',open:false,busy:false,editor:null,members:[],media:[],customer:null,history:[],loading:null,readGeneration:0,auxReady:false,external:false};
  cycle.addEventListener('change',async()=>{const target=cycle.value;if(!await leaveEditor(s)){cycle.value=s.cycleId||'';return;}if(current(s)){s.cycleId=target;render(s);}});return s;
 }
 function applyOpen(s){s.panel.hidden=!s.open;s.toggle.textContent=s.open?'통합 업무 접기':'통합 업무 펼치기';s.toggle.setAttribute('aria-expanded',String(s.open));}
 async function selectTab(s,key){if(!current(s)||!tabs.some(([id])=>id===key)||!await leaveEditor(s))return;s.tab=key;s.open=true;applyOpen(s);renderContent(s);}
 async function auxiliary(s){
  if(s.auxReady||!current(s))return;if(s.auxTask)return s.auxTask;
  s.auxTask=(async()=>{const jobs=[['members',()=>store().members?.()||[]],['media',()=>store().media?.(s.ref)||[]],['history',()=>store().history?.()||[]]];
   if(s.workspace?.capabilities.customerRead)jobs.push(['customer',()=>store().customer?.(s.ref)||null]);
   await Promise.all(jobs.map(async([key,read])=>{try{const value=await read();if(current(s))s[key]=key==='customer'?value:Array.isArray(value)?value:[];}catch{if(current(s))s[key]=key==='customer'?null:[];}}));
   if(current(s)){s.auxReady=true;if(!s.editor)renderContent(s);}
  })();return s.auxTask;
 }
 async function reload(s,force=false){
  if(!current(s)||s.busy)return;if(s.loading&&!force)return s.loading;
  const run=++s.readGeneration,hasDraft=dirty(s);status(s,'업무 자료를 확인하고 있습니다.');s.refresh.disabled=true;
  const task=(async()=>{try{const value=await store().read(s.ref,{force});if(!current(s)||run!==s.readGeneration)return;accept(s,value);status(s,hasDraft?'최신 자료를 확인했습니다. 작성 중인 입력은 유지했습니다.':'');if(s.editor&&hasDraft){s.editor.rebase=value.revision;showRebase(s);}else render(s);void auxiliary(s);}
   catch(error){if(!current(s)||run!==s.readGeneration)return;status(s,safeMessage(error),'error');if(!s.workspace){renderSummary(s);s.list.replaceChildren(node('p','통합 업무를 불러오지 못했습니다. 새로고침으로 다시 확인할 수 있습니다.','business-empty'));}}
   finally{if(current(s)&&run===s.readGeneration){s.refresh.disabled=s.busy;if(s.loading===task)s.loading=null;}}})();s.loading=task;return task;
 }
 function accept(s,value){if(!value||value.companyId!==s.ref.companyId||value.ownerId!==s.ref.ownerId||value.carId!==s.ref.carId||!Array.isArray(value.cycles)||!Array.isArray(value.entries))throw Error('업무 자료의 연결을 확인하지 못했습니다.');s.workspace=value;if(!value.cycles.some(c=>c.id===s.cycleId))s.cycleId=value.cycles.find(c=>c.status==='open')?.id||value.cycles.slice().sort((a,b)=>b.sequence-a.sequence)[0]?.id||null;}
 function renderSummary(s){
  s.summary.replaceChildren();let summary=null,pending=null;
  if(s.workspace?.cycles.length){try{summary=finance().summarize(s.workspace,car(s));pending=workflow().tasks(s.workspace,car(s),{},{includeAllDates:true});}catch{}}
  const loanRecords=s.workspace?.entries.some(e=>e.kind==='loan'&&e.status!=='reversed'),documentRecords=s.workspace?.entries.some(e=>['document','transfer'].includes(e.kind)),followRecords=s.workspace?.entries.some(e=>['lead','task'].includes(e.kind)),count=predicate=>pending===null?'확인 전':pending.filter(predicate).length.toLocaleString('ko-KR')+'건';
  const values=[['관리손익',summary?won(summary.managementProfitWon):'확인 전','trade'],['등록 기준 미수',summary?won(summary.sale?.receivableWon):'확인 전','cash'],['금융잔액',summary&&loanRecords?won(summary.loanTotals.principalOutstandingWon):'실행 확인 전','finance'],['서류·이전',documentRecords?count(t=>['document','transfer'].includes(t.kind)||t.category==='verification'):'확인 전','documents'],['후속 업무',followRecords?count(t=>['lead','task'].includes(t.kind)&&t.category!=='verification'):'확인 전','customers']];
  for(const[label,value,tab]of values){const item=button('',()=>void selectTab(s,tab),'business-metric');item.append(node('span',label),node('strong',value));s.summary.append(item);}
  if(summary){const detail=node('p',(summary.estimatedProfitWon===null?'공통경비·세금 조정 전 관리금액입니다. 미확정 항목을 확인해 주세요.':'예상 관리손익 '+won(summary.estimatedProfitWon)+' · 공통경비·세금 조정 전')+' · 미수는 등록된 확인 입출금 기준','business-summary-note');s.summary.append(detail);}
 }
 function render(s){
  if(!current(s))return;renderSummary(s);s.cycle.replaceChildren();for(const c of s.workspace?.cycles||[]){const option=node('option','거래 '+c.sequence+' · '+cycleNames[c.status]);option.value=c.id;s.cycle.append(option);}if(!s.cycle.children.length)s.cycle.append(node('option','거래 시작 전'));s.cycle.value=s.cycleId||'';s.cycle.disabled=!s.cycleId||s.busy;
  for(const tab of s.nav.children){const selected=tab.dataset.businessTab===s.tab;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}renderContent(s);
 }
 function matchesTab(entry,tab){if(tab==='cash')return['cash','cost'].includes(entry.kind);if(tab==='finance')return['loan','loan_event'].includes(entry.kind);if(tab==='documents')return['document','transfer'].includes(entry.kind);if(tab==='customers')return entry.kind==='lead'||entry.kind==='task'&&!['preparation','price_review'].includes(entry.details?.category);if(tab==='advertising')return entry.kind==='advertising'||entry.kind==='task'&&['preparation','price_review'].includes(entry.details?.category);return entry.kind==='appraisal'&&tab==='appraisal';}
 function canEntry(s,kind){return s.workspace?.capabilities.canWrite===true&&(kind!=='lead'||s.workspace.capabilities.customerWrite===true);}
 function renderContent(s){
  if(!current(s)||!s.workspace)return;for(const tab of s.nav.children){const selected=tab.dataset.businessTab===s.tab;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}s.content.setAttribute('aria-labelledby','business-tab-'+s.tab);s.list.replaceChildren();
  if(s.tab==='trade'){renderTrade(s);return;}if(s.tab==='history'){renderHistory(s);return;}
  if(!s.cycleId){s.list.append(node('p','거래를 시작하면 이 차량의 입출금과 업무를 기록할 수 있습니다.','business-empty'));return;}
  const kinds={cash:['cash','cost'],finance:['loan','loan_event'],documents:['document','transfer'],customers:s.workspace.capabilities.customerWrite?['lead','task']:['task'],advertising:['advertising','task'],appraisal:['appraisal']}[s.tab]||[];
  const tools=node('div',null,'business-add-actions');for(const kind of kinds)if(canEntry(s,kind)){const add=button(entryNames[kind]+' 추가',()=>void edit(s,kind,null,s.tab==='advertising'&&kind==='task'?{details:{category:'preparation'}}:{}),'business-secondary');add.dataset.businessAdd=kind;tools.append(add);}s.list.append(tools);
  if(s.tab==='customers'){
   if(!s.workspace.capabilities.customerRead)s.list.append(node('p','고객 상담은 본인 담당 차량에서만 조회합니다. 상품화·서류 등 허용된 업무는 계속 관리할 수 있습니다.','business-note'));
   else if(s.customer){const linked=node('div',null,'business-linked-customer');linked.append(node('strong','기존 판매 고객'),node('span',[s.customer.name||'성명 미입력',s.customer.phone||'연락처 미입력'].join(' · ')));const open=button('판매 진행 열기',()=>{if(!current(s)||!s.workspace.capabilities.customerRead)return;if(typeof root.openSaleProgress==='function')void root.openSaleProgress();},'business-link');linked.append(open);s.list.append(linked);}
  }
  if(s.tab==='finance'){
   const c=car(s);let personalRate=null;try{if(root.SnoteDealerFinanceRates?.ready())personalRate=root.SnoteDealerFinanceRates.lendersFor(c,[]).find(row=>row[0]===c.inventoryLender)?.[2]??null;}catch{}
   s.list.append(node('p','기존 금융 등록값 · '+(c.inventoryLender||'금융사 미입력')+' · 재고대출금 '+won(c.inventoryLoan)+' · 시작일 '+dateText(c.inventoryStartedAt)+' · 개인 설정 연이율 '+(personalRate===null?'확인 필요':personalRate+'%')+'\n참고값입니다. 아래 새 원장의 실제 실행·상환 기록과 구분하며 자동 등록하지 않습니다.','business-note'));
  }
  if(s.tab==='cash'){try{renderFunding(s,finance().cycleSummary(s.workspace,s.cycleId,car(s)));}catch{s.list.append(node('p','등록 자금 흐름을 확인하지 못했습니다. 입출금 내역을 확인해 주세요.','business-note'));}}
  const rows=entries(s).filter(e=>matchesTab(e,s.tab));if(!rows.length)s.list.append(node('p','아직 등록된 내역이 없습니다. 미입력은 완료나 0원을 의미하지 않습니다.','business-empty'));
  for(const entry of rows)renderEntry(s,entry);
  if(s.tab==='appraisal')renderHistoryReferences(s);
 }
 function renderTrade(s){
  const cycle=source(s),canWrite=s.workspace.capabilities.canWrite,open=s.workspace.cycles.some(c=>c.status==='open'),tools=node('div',null,'business-add-actions');
  if(canWrite&&!open){const start=button(s.workspace.cycles.length?'새 거래 시작':'거래 시작',()=>void editCycle(s,true),'business-primary');start.dataset.businessStart='';tools.append(start);}if(cycle&&canWrite&&cycle.status!=='cancelled'){tools.append(button('거래 내용 수정',()=>void editCycle(s,false),'business-secondary'));tools.append(button('거래 취소',()=>void cancellation(s,cycle),'business-danger'));}s.list.append(tools);
  if(!cycle){s.list.append(node('p','거래 시작을 누르면 현재 차량에 저장된 금액·날짜·비용을 시작값으로 가져옵니다. 실제 입출금이나 대출 실행을 자동으로 확인하지 않습니다.','business-empty'));return;}
  const d=cycle.details,card=node('div',null,'business-trade-card');card.append(node('h3','거래 '+cycle.sequence+' · '+cycleNames[cycle.status]));const grid=node('dl',null,'business-facts');for(const[label,value]of[['거래 유형',{direct:'직접 매입',joint:'공동 매입',consignment:'위탁',brokerage:'알선'}[d.tradeType]||'확인 필요'],['매입금액',won(d.purchaseAmountWon)],['매입일',dateText(d.purchaseDate)],['예상 판매금액',won(d.expectedSaleWon)],['실제 판매금액',won(d.saleAmountWon)],['실제 판매일',dateText(d.saleDate)],['인도일',dateText(d.deliveryDate)],['정산',{pending:'미확정',provisional:'잠정',final:'확정 검토'}[d.settlementStatus]||'미확정']]){grid.append(node('dt',label),node('dd',value));}card.append(grid);s.list.append(card);
  try{const data=finance().cycleSummary(s.workspace,cycle.id,car(s));renderFunding(s,data);if(data.warnings.length){const list=node('ul',null,'business-warnings');for(const warning of data.warnings)list.append(node('li',warning));s.list.append(list);}}catch{s.list.append(node('p','거래 금액을 확인하지 못했습니다. 원본 입력을 확인해 주세요.','business-note'));}
  if(cycle.status==='cancelled')s.list.append(node('p','취소 전 원본 기록을 보존합니다. 실제 환불·상환은 별도 입출금과 금융 내역으로 기록하세요.','business-note'));
 }
 function renderFunding(s,data){
  const funding=data.cash?.ownerFunding,section=node('section',null,'business-funding');section.setAttribute('aria-label','등록 자금 흐름');
  for(const[label,key]of[['등록 자금 투입액(판매 회수 전)','beforeSaleWon'],['등록 자금 잔액(판매 회수 반영)','afterSaleWon']]){const item=node('div',null,'business-note');item.append(node('span',label),node('strong',funding?.basis==='registered_confirmed_records'?signedWon(funding[key]):'확인 필요'));section.append(item);}
  const basis=funding?.basis==='unrecorded'?'확인 입출금이 등록되지 않았습니다. ':funding?.basis==='unknown'?'등록 내역에 확인이 필요한 항목이 있습니다. ':'';section.append(node('p',basis+'등록된 확인 입출금만 반영한 참고금액으로 미등록 이력은 포함하지 않습니다. +는 미회수 투입액, -는 판매 회수·차입 초과분입니다. 이전비 보관금은 따로 관리합니다.','business-note business-wide'));s.list.append(section);
 }
 function renderEntry(s,entry){
  const article=node('article',null,'business-entry');article.dataset.businessEntry=entry.id;const head=node('div',null,'business-entry-head'),text=node('div');text.append(node('small',entryNames[entry.kind]||'업무'),node('strong',titleFor(entry)));const definition=schema(entry.kind),statusLabel=definition?.statuses.find(item=>item.value===entry.status)?.label||'상태 확인 필요';head.append(text,node('span',statusLabel,'business-state'));article.append(head);
  const lines=[entry.amountWon==null?'':won(entry.amountWon),entry.effectiveDate?'적용 '+entry.effectiveDate:'',entry.dueDate?'예정 '+entry.dueDate:'',entry.details?.assigneeId?('담당 '+(s.members.find(m=>m.id===entry.details.assigneeId)?.name||'확인 필요')):''].filter(Boolean);if(lines.length)article.append(node('p',lines.join(' · '),'business-entry-meta'));
  if(entry.kind==='appraisal'){try{const a=workflow().appraisal(entry);article.append(node('p','매입 상한가 '+(a.complete?won(a.maxPurchaseWon):'입력 확인 필요'),'business-appraisal-result'));}catch{article.append(node('p','매입 상한가 입력 확인 필요','business-note'));}}
  if(entry.kind==='loan'){try{const a=finance().loanSummary(s.workspace,entry.id);article.append(node('p','남은 원금 '+won(a.principalOutstandingWon)+' · 추정 이자 '+won(a.estimatedInterestWon),'business-entry-meta'));}catch{}}
  if(entry.details?.notes)article.append(node('p',entry.details.notes,'business-entry-notes'));
  if(entry.status==='reversed')article.append(node('p',[entry.details?.reversalReason,entry.details?.reversalDate].filter(Boolean).join(' · ')||'원본을 보존한 오입력 취소 기록입니다.','business-note'));
  const actions=node('div',null,'business-row-actions');const editButton=button(!canEntry(s,entry.kind)||entry.status==='reversed'?'기록 확인':'내용 확인·수정',()=>void edit(s,entry.kind,entry),'business-link');editButton.dataset.businessEdit=entry.id;actions.append(editButton);if(canEntry(s,entry.kind)&&['cash','cost','loan','loan_event'].includes(entry.kind)&&entry.status!=='reversed')actions.append(button('오입력 취소',()=>void reversal(s,entry),'business-link business-danger'));
  article.append(actions);s.list.append(article);
 }
 function renderHistory(s){
  const rows=s.workspace.audit||[];if(!rows.length){s.list.append(node('p','서버에 기록된 변경 이력이 없습니다.','business-empty'));return;}
  const names={start_cycle:'거래 시작',update_cycle:'거래 내용 변경',cancel_cycle:'거래 취소',save_entry:'업무 내역 저장',reverse_entry:'오입력 취소'};
  for(const item of rows){const row=node('article',null,'business-audit');row.append(node('strong',names[item.operation]||'업무 변경'),node('span',s.members.find(m=>m.id===item.actorId)?.name||'담당자 확인 필요'),node('time',item.createdAt?new Date(item.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'기록 시각 확인 필요'));const changes=item.changes?.after,reason=changes?.reason||changes?.details?.reversalReason;if(reason)row.append(node('p',reason));s.list.append(row);}
 }
 function renderHistoryReferences(s){
  const rows=(s.history||[]).filter(row=>row.id!==s.ref.carId).sort((a,b)=>Number(b.model===car(s).model)-Number(a.model===car(s).model)).slice(0,5);if(!rows.length)return;const details=node('details',null,'business-references');details.append(node('summary','저장된 과거 매입·판매 기록 참고'));
  for(const row of rows){const c=row.carSnapshot||{},line=node('p');line.append(node('strong',row.model||c.model||'차량'),node('span',' · '+[row.plate||c.plate,'매입 '+won(c.buy),'실판매 '+won(c.soldPrice)].filter(Boolean).join(' · ')));
   const result=node('span'),read=button('원가·수익·보유기간 확인',async()=>{if(!current(s))return;read.disabled=true;try{const ref={companyId:s.ref.companyId,ownerId:row.ownerId,carId:row.id},w=await store().read(ref);if(!current(s)||!line.isConnected)return;const summary=finance().summarize(w,w.carSnapshot||c),cycle=summary.cycles.find(c=>c.status!=='cancelled'),start=cycle?.purchase.date,end=cycle?.sale.date,days=start&&end&&end>=start?Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000):null;result.textContent=cycle?' · 발생 원가 '+won(cycle.costs.managementWon)+' · 관리손익 '+won(cycle.managementProfitWon)+' · 보유 '+(days===null?'확인 필요':days+'일')+(cycle.complete?'':' · 잠정'):' · 확인한 거래 원장이 없습니다.';}catch(error){if(current(s))result.textContent=' · '+safeMessage(error);}finally{if(current(s))read.disabled=false;}},'business-link');line.append(read,result);details.append(line);}
  details.append(node('p','저장된 거래 참고 자료입니다. 현재 시세나 확정 판매가격을 의미하지 않습니다.','business-note'));s.list.append(details);
 }
 function readPath(value,key){return key.split('.').reduce((v,k)=>v?.[k],value);}
 function setPath(value,key,item){const parts=key.split('.');if(parts.length===1)value[key]=item;else{value.details=value.details||{};value.details[parts[1]]=item;}}
 function choices(s,spec){
  const key=spec.key,rows=entries(s);if(key==='details.assigneeId')return[{value:'',label:'담당자 미지정'},...s.members.map(m=>({value:m.id,label:m.name||'담당 직원'}))];
  if(key==='details.evidenceMediaId')return[{value:'',label:'첨부 선택 안 함'},...s.media.map(m=>({value:m.id,label:m.name||m.filename||'차량 첨부'}))];
  if(key==='details.leadId')return[{value:'',label:'상담 연결 안 함'},...rows.filter(e=>e.kind==='lead'&&s.workspace.capabilities.customerRead).map(e=>({value:e.id,label:e.details.name||'성명 미입력 상담'}))];
  if(key==='details.existingCustomerKey')return[{value:'',label:'기존 고객 연결 안 함'},...(s.customer?.key?[{value:s.customer.key,label:s.customer.name||'기존 판매 고객'}]:[])];
  if(key==='details.loanId')return[{value:'',label:'대출 선택'},...rows.filter(e=>e.kind==='loan'&&e.status!=='reversed').map(e=>({value:e.id,label:optionLabel(e)}))];
  if(key==='details.costId')return[{value:'',label:'비용 연결 안 함'},...rows.filter(e=>e.kind==='cost'&&e.status!=='reversed').map(e=>({value:e.id,label:optionLabel(e)}))];
  if(key==='details.referenceId')return[{value:'',label:'원본 연결 안 함'},...rows.filter(e=>['cost','loan','loan_event','cash'].includes(e.kind)&&e.status!=='reversed').map(e=>({value:e.id,label:optionLabel(e)}))];
  if(key==='details.sourceCostKey')return[{value:'',label:'새 비용 · 기존 항목과 별도'},...Object.keys(source(s)?.details.legacyCosts||{}).map(key=>({value:key,label:car(s).customCostLabels?.[key]||labels[key]||'직접 추가한 비용'}))];
  if(key==='details.refundOf')return[{value:'',label:'환급 아님'},...rows.filter(e=>e.kind==='cost'&&e.status==='incurred'&&!e.details.refundOf).map(e=>({value:e.id,label:optionLabel(e)})),...Object.keys(source(s)?.details.legacyCosts||{}).map(key=>({value:'legacy:'+key,label:'기존 '+(car(s).customCostLabels?.[key]||labels[key]||'추가 비용')}))];
  let values=spec.options||[];if(key==='details.category'&&!s.workspace.capabilities.customerWrite)values=values.filter(option=>!['contact','visit','contract','delivery'].includes(option.value));return values;
 }
 function fieldLabel(spec){return({'details.assigneeId':'담당자','details.evidenceMediaId':'확인 근거 첨부','details.leadId':'연결 상담','details.costId':'연결 비용','details.existingCustomerKey':'기존 판매 고객'})[spec.key]||spec.label;}
 function addField(s,editor,spec,value,locked=false){
  const label=node('label',null,'business-field'+(['textarea','urls'].includes(spec.type)?' business-wide':'')),caption=node('span',fieldLabel(spec));let input;
  const selection=['select','reference','legacy','refund','loan','media'].includes(spec.type)||['details.assigneeId','details.evidenceMediaId','details.leadId','details.costId','details.existingCustomerKey'].includes(spec.key);
  if(selection){input=node('select');const available=choices(s,spec);for(const option of available){const o=node('option',option.label);o.value=option.value;input.append(o);}if(value!==null&&value!==undefined&&value!==''&&!available.some(option=>option.value===String(value))){const o=node('option','연결 자료 확인 필요');o.value=String(value);input.append(o);}}
  else if(spec.type==='textarea'||spec.type==='urls'){input=node('textarea');input.rows=3;input.maxLength=spec.key==='details.lostReason'?200:spec.type==='urls'?32000:spec.key==='details.priceHistory'?3200:2000;}
  else{input=node('input');input.type=spec.type==='checkbox'?'checkbox':spec.type==='date'?'date':'text';if(spec.type==='date'){input.min='1900-01-01';input.max='9999-12-31';}if(spec.type==='money'||spec.type==='number')input.inputMode=spec.decimal?'decimal':'numeric';input.maxLength=spec.key==='details.phone'?30:['details.url','details.evidenceUrl'].includes(spec.key)?2048:200;}
  input.id='business-field-'+editor.instance+'-'+spec.key.replaceAll('.','-');input.name=spec.key;input.dataset.businessType=spec.type;if(spec.placeholder)input.placeholder=spec.placeholder;if(spec.required)input.required=true;
  if(spec.type==='checkbox'){input.checked=value===true;label.classList.add('business-checkbox');}else input.value=value===null||value===undefined?'':Array.isArray(value)?value.join('\n'):typeof value==='number'&&spec.type==='money'?value.toLocaleString('ko-KR'):String(value);
  input.disabled=locked;label.append(caption,input);editor.grid.append(label);editor.fields.push({spec,input});return input;
 }
 function makeEditor(s,title,mode,entry){
  const box=node('section',null,'business-editor'),head=node('div',null,'business-editor-head');head.append(node('h3',title),button('입력 닫기',()=>void leaveEditor(s),'business-link'));
  const form=node('form');form.noValidate=true;form.id='business-entry-form';const grid=node('div',null,'business-form-grid'),error=node('p','','business-form-error');error.setAttribute('role','alert');const footer=node('div',null,'business-form-actions'),save=button('저장',()=>form.requestSubmit(),'business-primary');save.id='business-entry-save';footer.append(save);form.append(grid,error,footer);box.append(head,form);s.draftHost.replaceChildren(box);
  const editor={box,form,grid,error,footer,save,mode,entry,fields:[],instance:++serial,baseRevision:s.workspace.revision,baseline:'',request:null,rebase:null,conflict:false,upload:null};s.editor=editor;form.addEventListener('input',()=>{if(editor.conflict)editor.error.textContent='현재 입력을 유지했습니다. 최신 자료를 확인한 뒤 다시 저장해 주세요.';if(editor.kind==='appraisal')previewAppraisal(s,editor);});return editor;
 }
 async function edit(s,kind,entry,prefill={}){
  if(!current(s)||!entry&&!canEntry(s,kind)||kind==='lead'&&!s.workspace.capabilities.customerRead||!await leaveEditor(s))return;await auxiliary(s);if(!current(s))return;const definition=schema(kind);if(!definition)return;const readOnly=!canEntry(s,kind);
  const editor=makeEditor(s,definition.title,'entry',entry);editor.kind=kind;editor.id=entry?.id||crypto.randomUUID();const initial=entry||{id:editor.id,cycleId:s.cycleId,kind,status:definition.statuses.find(v=>v.value!=='reversed').value,amountWon:null,effectiveDate:null,dueDate:null,details:{...prefill.details}};
  const formatted=financialForms.some(v=>v.kind===kind)?{}:workflow().formatForm(kind,initial);editor.initial=structuredClone(initial);const fixed=isFact(entry);
  addField(s,editor,{key:'status',label:'상태',type:'select',options:definition.statuses.filter(option=>option.value!=='reversed'||entry?.status==='reversed')},initial.status,fixed||readOnly);
  for(const spec of definition.fields){let value=ownValue(formatted,spec.key)?formatted[spec.key]:readPath(initial,spec.key);if(value===undefined&&spec.type==='select')value=choices(s,spec)[0]?.value||'';
   const locked=readOnly||fixed&&!['details.notes','details.label','details.evidenceMediaId','details.evidenceUrl'].includes(spec.key)||entry?.status==='reversed';addField(s,editor,spec,value,locked);
  }
  if(fixed)editor.grid.prepend(node('p','확인된 금액·적용일은 보존합니다. 오입력은 취소 기록을 남기고 새 내역을 입력하세요.','business-note business-wide'));
  if(entry?.status==='reversed'||readOnly)editor.save.hidden=true;
  if(kind==='loan')editor.grid.prepend(node('p','실행일·금리는 확인한 값만 입력합니다. 판매일 이후에도 실제 상환 전까지 이자를 계산합니다.','business-note business-wide'));
  if(kind==='cost')editor.grid.prepend(node('p','발생 비용은 지급 여부와 별도로 손익에 반영합니다. 환급은 원본 비용과 연결한 음수 금액으로 기록하세요.','business-note business-wide'));
  if(kind==='loan_event')editor.grid.prepend(node('p','대출원금 상환은 차량 비용이 아닙니다. 실제 청구 이자는 산정 시작·종료일을 함께 확인해 주세요.','business-note business-wide'));
  if(kind==='appraisal'){editor.preview=node('p','','business-appraisal-result business-wide');editor.grid.append(editor.preview);previewAppraisal(s,editor);}
  addEvidence(s,editor,entry);editor.form.addEventListener('submit',event=>{event.preventDefault();void submitEntry(s,editor);});editor.baseline=formState(editor);editor.box.scrollIntoView({block:'nearest'});
 }
 const ownValue=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
 function values(editor){return Object.fromEntries(editor.fields.map(({spec,input})=>[spec.key,spec.type==='checkbox'?input.checked:input.value]));}
 function parseNumber(value,{decimal=false,signed=false,label='비율'}={}){if(value===''||value===null||value===undefined)return null;const raw=String(value).trim(),pattern=decimal?/^\d+(?:\.\d{1,4})?$/:signed?/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/:/^(?:\d+|\d{1,3}(?:,\d{3})+)$/,decimalMessage=label.replace(/\s*\(%\)$/,'')+'은 0~100% 범위에서 소수 넷째 자리까지 입력해 주세요.';if(!pattern.test(raw))throw Error(decimal?decimalMessage:'원 단위 정수를 입력해 주세요.');const n=Number(raw.replaceAll(',',''));if(!Number.isFinite(n)||!decimal&&!Number.isSafeInteger(n)||Math.abs(n)>MAX||!signed&&n<0||decimal&&(n<0||n>100||Math.abs(n*10000-Math.round(n*10000))>1e-7))throw Error(decimal?decimalMessage:'입력 금액의 범위를 확인해 주세요.');return n;}
 function parseFields(editor){const raw=values(editor),result={details:{}},nullable=new Set(['details.evidenceUrl','details.url','details.assigneeId','details.evidenceMediaId','details.sourceCostKey','details.refundOf','details.loanId','details.leadId','details.costId','details.referenceId','details.reversalOf','details.existingCustomerKey']);for(const{spec}of editor.fields){const value=raw[spec.key];let parsed=value;if(spec.type==='checkbox')parsed=value===true;else if(spec.type==='money'||spec.type==='number')parsed=parseNumber(value,spec);else if(spec.type==='date'){parsed=value||null;if(parsed&&(!workflow().date(parsed)||parsed<'1900-01-01'))throw Error('실제 날짜를 확인해 주세요.');}else if(typeof parsed==='string')parsed=parsed.trim();if(nullable.has(spec.key)||['reference','legacy','refund','loan','media'].includes(spec.type))parsed=parsed||null;if(spec.required&&!parsed)throw Error(fieldLabel(spec)+'을 입력해 주세요.');if(['details.evidenceUrl','details.url'].includes(spec.key)&&parsed){let url;try{url=new URL(parsed);}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('http 또는 https 확인 근거 주소를 입력해 주세요.');}setPath(result,spec.key,parsed);}return result;}
 function previewAppraisal(s,editor){if(!current(s)||!editor.preview)return;try{const data=workflow().normalizeForm('appraisal',values(editor)),result=workflow().appraisal(data);editor.preview.textContent='매입 상한가 '+(result.complete?won(result.maxPurchaseWon):'계산에 필요한 금액을 입력해 주세요.');}catch{editor.preview.textContent='매입 상한가 · 입력 확인 필요';}}
 function entryData(editor){
  const raw=values(editor),base=financialForms.some(v=>v.kind===editor.kind)?parseFields(editor):workflow().normalizeForm(editor.kind,raw),entry={id:editor.id,cycleId:editor.initial.cycleId,kind:editor.kind,status:raw.status,amountWon:base.amountWon??null,effectiveDate:base.effectiveDate??null,dueDate:base.dueDate??null,details:{...editor.initial.details,...base.details}};
  if(entry.kind==='document'&&!entry.details.label)entry.details.label=workflow().forms.find(form=>form.kind==='document').fields[0].options.find(option=>option.value===entry.details.documentType)?.label||'서류';
  if(entry.kind==='advertising'&&!entry.details.channel)throw Error('광고 채널을 입력해 주세요.');
  if(['cash','loan_event'].includes(entry.kind)&&entry.status==='confirmed'&&(!entry.effectiveDate||entry.amountWon===null&&!(entry.kind==='loan_event'&&entry.details.eventType==='rate')))throw Error('확인된 금액과 실제 적용일을 입력해 주세요.');
  if(entry.kind==='loan_event'&&entry.details.eventType==='rate')entry.amountWon=null;
  if(entry.kind==='cost'&&entry.status==='incurred'&&entry.amountWon===null||entry.kind==='loan'&&entry.status==='active'&&entry.amountWon===null)throw Error('확인한 금액을 입력해 주세요.');
  if((['task','document'].includes(entry.kind)&&entry.status==='done'||entry.kind==='lead'&&entry.status==='delivered')&&!entry.effectiveDate)throw Error('완료·출고를 확인한 날짜를 입력해 주세요.');
  if(entry.kind==='transfer'&&entry.status==='done'&&!entry.effectiveDate&&!entry.details.completedDate)throw Error('이전 완료일을 입력해 주세요.');
  return entry;
 }
 async function submitEntry(s,editor){if(!current(s)||s.editor!==editor||!canEntry(s,editor.kind)||s.busy||editor.conflict)return;try{const entry=entryData(editor);await write(s,editor,{action:'save_entry',entry});}catch(error){if(current(s)&&s.editor===editor)editor.error.textContent=safeMessage(error);}}
 async function editCycle(s,start){
  if(!current(s)||!s.workspace.capabilities.canWrite||!await leaveEditor(s))return;const existing=start?null:source(s);if(existing?.status==='cancelled')return;
  const editor=makeEditor(s,start?'거래 시작 · 저장값 확인':'거래 내용 수정','cycle',null);editor.id=existing?.id||crypto.randomUUID();
  const snapshot=start?finance().snapshot(car(s)):null;editor.initial=existing?structuredClone(existing):{id:editor.id,status:'open',details:{...snapshot,tradeType:'direct',costsConfirmed:false,settlementStatus:'pending',ownershipPercent:null,commissionWon:null,counterpartySettlementWon:null,contractDate:null,deliveryDate:null,notes:''}};
  addField(s,editor,{key:'status',label:'거래 상태',type:'select',options:opts(start?[['open','진행 중']]:[['open','진행 중'],['closed','마감']])},editor.initial.status);
  for(const spec of cycleFields)addField(s,editor,spec,readPath(editor.initial,spec.key));
  const legacy=node('div',null,'business-legacy business-wide');const paintLegacy=()=>{legacy.replaceChildren(node('strong','확인할 기존 비용'));for(const[key,value]of Object.entries(editor.initial.details.legacyCosts||{}))legacy.append(node('p',(car(s).customCostLabels?.[key]||labels[key]||'직접 추가한 비용')+' · '+won(value)));if(!editor.initial.details.legacyCosts)legacy.append(node('p','기존 비용 항목이 확인되지 않았습니다. 미확정을 0원으로 바꾸지 않습니다.'));};paintLegacy();
  if(!start)editor.grid.append(button('기존 차량값 다시 확인',async()=>{if(!current(s)||s.editor!==editor||s.busy)return;const accepted=typeof root.snoteConfirm==='function'?await root.snoteConfirm('현재 차량에 저장된 금액·날짜·비용을 다시 가져올까요? 이 입력을 저장하기 전에는 기존 거래가 변경되지 않습니다.',{isCurrent:()=>current(s)&&s.editor===editor}):false;if(accepted!==true||!current(s)||s.editor!==editor)return;const fresh=finance().snapshot(store().vehicle()?.carSnapshot||car(s));Object.assign(editor.initial.details,fresh,{costsConfirmed:false});for(const{spec,input}of editor.fields)if(ownValue(fresh,spec.key.replace('details.','')))input.value=fresh[spec.key.replace('details.','')]??'';const confirmed=editor.fields.find(f=>f.spec.key==='details.costsConfirmed');if(confirmed)confirmed.input.checked=false;paintLegacy();editor.error.textContent='현재 차량값을 다시 가져왔습니다. 금액·비용을 확인한 뒤 저장해 주세요.';},'business-secondary business-wide'));
  editor.grid.append(legacy,node('p','이 원장의 저장은 기존 차량 금액을 자동으로 변경하지 않습니다. 정산 마감도 입금·상환·이전 완료를 의미하지 않습니다.','business-note business-wide'));
  editor.form.addEventListener('submit',event=>{event.preventDefault();if(!current(s)||s.busy||editor.conflict)return;try{const parsed=parseFields(editor),details={...editor.initial.details,...parsed.details};void write(s,editor,start?{action:'start_cycle',cycle:{id:editor.id,status:'open',details}}:{action:'update_cycle',id:editor.id,status:parsed.status,details});}catch(error){editor.error.textContent=safeMessage(error);}});editor.baseline=formState(editor);editor.box.scrollIntoView({block:'nearest'});
 }
 async function cancellation(s,cycle){if(!current(s)||!await leaveEditor(s))return;const editor=makeEditor(s,'거래 취소 · 원본 보존','cancel',null);editor.id=cycle.id;addField(s,editor,field('reason','취소 사유','textarea',{required:true}),'');addField(s,editor,field('date','취소 적용일','date',{required:true}),null);editor.grid.append(node('p','원래 거래와 금융 기록을 보존합니다. 실제 환불은 별도 입출금으로 기록하세요.','business-note business-wide'));editor.form.addEventListener('submit',event=>{event.preventDefault();try{const data=parseFields(editor);void write(s,editor,{action:'cancel_cycle',id:cycle.id,reason:data.reason,date:data.date});}catch(error){editor.error.textContent=safeMessage(error);}});editor.baseline=formState(editor);}
 async function reversal(s,entry){if(!current(s)||!await leaveEditor(s))return;const editor=makeEditor(s,'오입력 취소 · 원본 보존','reverse',entry);editor.id=entry.id;addField(s,editor,field('reason','취소 사유','textarea',{required:true}),'');addField(s,editor,field('date','취소 적용일','date',{required:true}),null);editor.grid.append(node('p','실제 자금 반환은 이 취소와 별도로 입출금에 등록하세요. 원래 금액·적용일과 취소 이력은 보존합니다.','business-note business-wide'));editor.form.addEventListener('submit',event=>{event.preventDefault();try{const data=parseFields(editor);void write(s,editor,{action:'reverse_entry',id:entry.id,reason:data.reason,date:data.date});}catch(error){editor.error.textContent=safeMessage(error);}});editor.baseline=formState(editor);}
 function busy(s,value){s.busy=value;s.refresh.disabled=value;s.cycle.disabled=value||!s.cycleId;if(s.editor){const editor=s.editor;if(value){editor.busyFields=new Map([...editor.form.elements].map(e=>[e,e.disabled]));for(const e of editor.busyFields.keys())e.disabled=true;}else{for(const[e,wasDisabled]of editor.busyFields||[])if(e.isConnected)e.disabled=wasDisabled;editor.busyFields=null;}editor.save.disabled=value||editor.conflict;}s.root.setAttribute('aria-busy',String(value));}
 async function write(s,editor,command){
  if(!current(s)||s.busy||s.editor!==editor)return;const body=JSON.stringify(command);if(!editor.request||editor.request.body!==body||editor.request.revision!==editor.baseRevision)editor.request={id:crypto.randomUUID(),body,revision:editor.baseRevision};const request=editor.request;busy(s,true);editor.error.textContent='저장 결과를 확인하고 있습니다.';
  try{const value=await store().command(s.ref,command,{expectedRevision:request.revision,requestId:request.id});if(!current(s)||s.editor!==editor)return;if(!value||value.revision<=request.revision)throw Error('서버의 저장 결과를 확인하지 못했습니다. 입력을 유지합니다.');++s.readGeneration;s.loading=null;accept(s,value);if(command.action==='start_cycle')s.cycleId=command.cycle.id;closeEditorNow(s);render(s);status(s,'서버 저장을 확인했습니다.','success');}
  catch(error){if(!current(s)||s.editor!==editor)return;editor.error.textContent=safeMessage(error);if(['CONFLICT','40001','READ_REQUIRED','SOURCE_CHANGED'].includes(error.code)||/CONFLICT/.test(error.message)){editor.conflict=true;editor.rebase=null;showRebase(s);}}
  finally{if(current(s))busy(s,false);}
 }
 function showRebase(s){const editor=s.editor;if(!editor)return;editor.conflict=true;editor.save.disabled=true;let box=editor.box.querySelector('.business-rebase');if(box)box.remove();box=node('div',null,'business-rebase');box.append(node('p','입력은 유지했습니다. 최신 저장 내용을 확인한 뒤 명시적으로 다시 저장할 수 있습니다.'));box.append(button('최신 자료 확인',()=>void reload(s,true),'business-secondary'));
  if(Number.isSafeInteger(editor.rebase)){const newest=editor.mode==='entry'?s.workspace.entries.find(e=>e.id===editor.id):s.workspace.cycles.find(c=>c.id===editor.id);box.append(node('p',newest?[titleFor(newest),newest.amountWon==null?'':won(newest.amountWon),newest.effectiveDate||'',newest.status].filter(Boolean).join(' · '):'이 버전에 저장된 동일 기록이 없습니다.','business-latest'));box.append(button('입력 내용으로 다시 저장',()=>{if(!current(s)||s.editor!==editor)return;editor.baseRevision=s.workspace.revision;editor.request=null;editor.conflict=false;editor.save.disabled=false;box.remove();editor.form.requestSubmit();},'business-secondary'));}editor.box.append(box);}
 function addEvidence(s,editor,entry){
  if(!['cost','document','transfer','task','appraisal','advertising'].includes(editor.kind))return;
  const section=node('div',null,'business-evidence'),title=node('strong','증빙 파일'),input=node('input');input.type='file';input.id='business-evidence-file';input.accept='image/jpeg,image/png,image/webp,application/pdf';input.setAttribute('aria-label','증빙 파일 선택');input.disabled=!entry||!canEntry(s,editor.kind)||typeof store().uploadEvidence!=='function';
  const hint=node('p',!entry?'기록을 먼저 저장한 뒤 증빙 파일을 첨부할 수 있습니다.':typeof store().uploadEvidence!=='function'?'증빙 업로드 연결을 준비하고 있습니다. 기존 차량 첨부나 확인 근거 주소를 사용할 수 있습니다.':'JPG·PNG·WEBP·PDF, 최대 10MB. 첨부만으로 확인 완료가 되지 않습니다.','business-note'),files=node('div',null,'business-evidence-files');
  const retry=button('같은 파일 다시 시도',()=>{if(editor.upload?.file)void upload(editor.upload.file);},'business-secondary');retry.id='business-evidence-retry';retry.hidden=true;section.append(title,input,hint,files,retry);editor.form.append(section);
  if(entry&&typeof store().evidence==='function')void store().evidence(s.ref,entry.id).then(value=>{if(current(s)&&s.editor===editor)for(const item of value.items||[])files.append(button(item.name||'증빙 파일',()=>void downloadEvidence(s,entry.id,item.id),'business-link'));}).catch(error=>{if(current(s)&&s.editor===editor)hint.textContent=safeMessage(error);});
  async function upload(file){
   if(!file||!current(s)||s.editor!==editor||!canEntry(s,editor.kind)||s.busy)return;
   if(file.size<1||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){hint.textContent='10MB 이하 JPG·PNG·WEBP·PDF 파일을 선택해 주세요.';return;}
   busy(s,true);input.disabled=true;retry.hidden=true;
   try{
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());if(!current(s)||s.editor!==editor)return;
    const signature=[file.name,file.size,file.type,[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')].join('|');
    if(!editor.upload||editor.upload.signature!==signature)editor.upload={signature,id:crypto.randomUUID(),file};
    const result=await store().uploadEvidence(s.ref,entry.id,file,{requestId:editor.upload.id});if(!current(s)||s.editor!==editor)return;
    if(!result?.id||result.entryId!==entry.id||result.state&&result.state!=='ready')throw Error('증빙 저장 결과를 확인하지 못했습니다. 같은 파일로 다시 확인해 주세요.');
    files.append(button(result.name||file.name,()=>void downloadEvidence(s,entry.id,result.id),'business-link'));hint.textContent='증빙 파일 저장을 확인했습니다. 업무 확인 상태는 그대로 유지됩니다.';editor.upload=null;input.value='';
   }catch(error){if(current(s)&&s.editor===editor){hint.textContent=safeMessage(error);retry.hidden=!editor.upload;}}
   finally{if(current(s)&&s.editor===editor){busy(s,false);input.disabled=false;}}
  }
  input.addEventListener('change',()=>void upload(input.files?.[0]));
 }

 async function downloadEvidence(s,entryId,id){if(!current(s)||typeof store().downloadEvidence!=='function')return;try{const value=await store().downloadEvidence(s.ref,id,entryId);if(!current(s)||!value?.blob)return;const url=URL.createObjectURL(value.blob),anchor=node('a');anchor.href=url;anchor.download=value.name||'증빙 파일';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);}catch(error){status(s,safeMessage(error),'error');}}
 async function focus(sourceId){await refresh();const s=session;if(!s)return false;if(s.loading)await s.loading;if(!current(s)||!s.workspace)return false;const entry=s.workspace.entries.find(e=>e.id===String(sourceId||''));if(!await leaveEditor(s))return false;s.open=true;applyOpen(s);if(entry){s.cycleId=entry.cycleId;s.tab=tabs.find(([key])=>matchesTab(entry,key))?.[0]||'trade';render(s);const card=[...s.list.querySelectorAll('[data-business-entry]')].find(e=>e.dataset.businessEntry===entry.id);if(card){card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'nearest'});}}else{s.tab='trade';render(s);}return true;}
 async function refresh(){
  queued=false;const context=store()?.context?.(),ref=store()?.vehicle?.(),shared=root.SnoteSharedVehicleDetail?.active?.()===true||overlay.dataset.snoteSharedDetail==='true';
  if(!overlay.classList.contains('open')||!context?.ready||!ref||shared||!finance()||!workflow()||!store()?.current(context)){if(session)reset();return;}
  if(session&&session.context.key===context.key&&session.viewKey===refKey(ref)){const signature=finance().snapshot(car(session)).sourceSignature;if(session.carSignature!==signature){session.carSignature=signature;if(!session.editor&&!session.busy&&session.workspace)render(session);}return session.loading;}
  if(session)reset();const s=create(ref,context);if(!s)return;session=s;renderSummary(s);await reload(s);
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(()=>void refresh());}}
 new MutationObserver(schedule).observe(overlay,{attributes:true,attributeFilter:['class','aria-hidden']});
 for(const event of ['snote:business-ready','snote:route-changed','snote:company-cars-ready'])root.addEventListener(event,schedule);
 root.addEventListener('snote:business-changed',event=>{const s=session,d=event.detail;if(!current(s)||!d||d.carId!=null&&d.carId!==s.ref.carId||d.ownerId!==s.ref.ownerId||d.companyId!==s.ref.companyId)return;if(s.busy)return;if(dirty(s)){s.external=true;if(s.editor){s.editor.conflict=true;s.editor.rebase=null;showRebase(s);}status(s,'다른 업무 변경이 있습니다. 현재 입력은 유지됩니다. 최신 자료를 확인한 뒤 다시 저장하세요.');}else void reload(s,true);});
 root.addEventListener('snote:auth-reset',reset);root.addEventListener('pagehide',reset);root.addEventListener('beforeunload',event=>{if(dirty(session)){event.preventDefault();event.returnValue='';}});
 setInterval(()=>{if(session&&!current(session))reset();else if(session)schedule();},500);
 root.SnoteVehicleBusiness=Object.freeze({refresh:schedule,focus,beforeLeave,isDirty:()=>dirty(session),reset,inspect:()=>session?{loaded:!!session.workspace,revision:session.workspace?.revision,tab:session.tab,open:session.open,busy:session.busy,dirty:dirty(session),editor:session.editor?.kind||session.editor?.mode||null}:null});schedule();
})();
