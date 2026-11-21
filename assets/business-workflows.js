/* Non-financial vehicle work. These projections never complete or modify source records. */
(function(root,factory){
 'use strict';
 const resolveFinance=()=>root?.SnoteBusinessFinance?.appraisal?root.SnoteBusinessFinance:null;
 const model=factory(resolveFinance);
 if(typeof module==='object'&&module.exports)module.exports=model;
 else root.SnoteBusinessWorkflows=model;
})(typeof globalThis!=='undefined'?globalThis:this,function(resolveFinance){
 'use strict';
 const MAX_WON=1000000000000,DAY=86400000;
 const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
 const messages={INVALID_WORKFLOW_DATE:'실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.',INVALID_WORKFLOW_AMOUNT:'금액은 0~1조 원 범위의 원 단위 정수로 입력해 주세요.',INVALID_WORKFLOW_URLS:'http 또는 https 주소를 확인해 주세요. 비교 주소는 최대 20개까지 입력할 수 있습니다.',INVALID_WORKFLOW_PRICE_HISTORY:'가격 변경 이력의 날짜와 원 단위 금액을 확인해 주세요.',INVALID_WORKFLOW_FORM:'업무 입력 항목을 다시 확인해 주세요.',INVALID_WORKFLOW_BOOLEAN:'선택 항목을 다시 확인해 주세요.',INVALID_WORKFLOW_NUMBER:'예상 보유기간 또는 주행거리의 입력 범위를 확인해 주세요.',INVALID_WORKFLOW_OPTION:'업무 종류를 다시 선택해 주세요.',INVALID_WORKFLOW_TEXT:'입력 내용의 길이와 문자를 확인해 주세요.',INVALID_WORKFLOW_ID:'연결 기록 또는 담당자 ID를 확인해 주세요.',WORKFLOW_TITLE_REQUIRED:'할 일을 입력해 주세요.',INVALID_WORKFLOW_APPRAISAL:'매입 검토 입력 내용을 확인해 주세요.',INVALID_WORKFLOW_WORKSPACE:'차량 업무 연결 정보를 확인하지 못했습니다. 차량을 다시 열어 주세요.'};
 const error=code=>{throw Object.assign(Error(messages[code]||'업무 입력 내용을 확인해 주세요.'),{code});};
 const string=(value,max=2000)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)?value.trim():'';
 const id=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\u0000-\u001f\u007f]/.test(value)?value:null;
 function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
 function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const [year,month,day]=value.split('-').map(Number);if(year<1||month<1||month>12||day<1||day>31)return null;
  const result=new Date(0);result.setUTCFullYear(year,month-1,day);result.setUTCHours(0,0,0,0);
  return result.getUTCFullYear()===year&&result.getUTCMonth()===month-1&&result.getUTCDate()===day?value:null;
 }
 function today(value=new Date()){
  if(typeof value==='string'){const valid=date(value);if(!valid)error('INVALID_WORKFLOW_DATE');return valid;}
  if(!(value instanceof Date)||!Number.isFinite(value.getTime()))error('INVALID_WORKFLOW_DATE');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const result=['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');if(!date(result))error('INVALID_WORKFLOW_DATE');return result;
 }
 function ordinal(value){const valid=date(value);if(!valid)return null;const [year,month,day]=valid.split('-').map(Number),result=new Date(0);result.setUTCFullYear(year,month-1,day);result.setUTCHours(0,0,0,0);return result.getTime()/DAY;}
 function addDays(value,amount){const base=ordinal(value);if(base===null||!Number.isSafeInteger(amount))return null;const result=new Date((base+amount)*DAY);if(!Number.isFinite(result.getTime())||result.getUTCFullYear()<1||result.getUTCFullYear()>9999)return null;return result.toISOString().slice(0,10);}
 const defaults=freeze({noInquiryDays:7,priceReviewDays:30,strategyReviewDays:60,maturityDays:7,dueSoonDays:7});
 function preferences(value={}){const result={...defaults};if(!plain(value))return result;for(const key of Object.keys(defaults)){const minimum=['maturityDays','dueSoonDays'].includes(key)?0:1,maximum=['maturityDays','dueSoonDays'].includes(key)?365:3650;if(Number.isSafeInteger(value[key])&&value[key]>=minimum&&value[key]<=maximum)result[key]=value[key];}return result;}
 const options=items=>items.map(([value,label])=>({value,label}));
 const field=(key,label,type='text',extra={})=>({key,label,type,required:false,...extra});
 const evidence=[field('details.assigneeId','담당자 ID'),field('details.evidenceMediaId','연결 첨부 ID'),field('details.evidenceUrl','확인 근거 주소','text',{placeholder:'https://…'}),field('details.notes','메모·보완 내용','textarea')];
 const categoryOptions=options([['contact','고객 연락'],['visit','방문'],['contract','계약'],['delivery','출고'],['preparation','상품화'],['price_review','가격 검토'],['aftercare','사후 처리'],['verification','차량 검증'],['other','기타']]);
 const forms=freeze([
  {kind:'document',title:'서류·확인 기록',statuses:options([['missing','미접수'],['received','접수'],['verified','확인'],['needs_action','보완 필요'],['done','완료']]),fields:[field('details.documentType','서류·확인 종류','select',{options:options([['registration','자동차등록증'],['inspection','성능·상태점검기록부'],['contract','계약서'],['receipt','인수증'],['title','원부·압류·저당'],['insurance_history','보험사고 이력'],['physical_inspection','실차 점검'],['other','기타']])}),field('details.label','표시 이름'),field('effectiveDate','접수·확인일','date'),field('dueDate','예정일','date'),...evidence]},
  {kind:'transfer',title:'명의이전',statuses:options([['not_sent','전달 전'],['sent','전달'],['received','접수'],['needs_action','보완 필요'],['done','완료']]),fields:[field('details.agency','이전대행사'),field('effectiveDate','대행사 전달일','date'),field('details.receivedDate','접수일','date'),field('dueDate','완료 예정일','date'),field('details.completedDate','완료일','date'),...evidence]},
  {kind:'task',title:'다음 업무·약속',statuses:options([['todo','할 일'],['doing','진행 중'],['blocked','확인 필요'],['done','완료'],['cancelled','취소']]),fields:[field('details.title','할 일','text',{required:true}),field('details.category','업무 종류','select',{options:categoryOptions}),field('details.assigneeId','담당자 ID'),field('effectiveDate','업무 시작일','date'),field('dueDate','예정일','date'),field('details.leadId','연결 상담 ID'),field('details.costId','연결 비용 ID','text',{placeholder:'발생 비용은 비용 내역에 별도 등록'}),field('details.mileage','출고 주행거리 (km)','number'),field('details.handoverItems','전달 물품·약속한 조치','textarea'),field('details.notes','업무 내용·보류 사유','textarea')]},
  {kind:'lead',title:'차량 상담',statuses:options([['inquiry','문의'],['visit_booked','방문 예약'],['visited','방문 완료'],['contract','계약'],['delivered','출고'],['on_hold','보류'],['lost','계약 실패']]),fields:[field('details.name','고객명'),field('details.phone','전화번호'),field('details.source','유입 경로'),field('details.budgetWon','예산 (원)','money'),field('details.requirements','필요 조건·구입 예정 시기·요청 자료','textarea'),field('details.tradeIn','대차 있음','checkbox'),field('effectiveDate','문의일','date'),field('details.nextAction','다음 행동'),field('dueDate','다음 행동 예정일','date'),field('details.assigneeId','담당자 ID'),field('details.lostReason','보류·계약 실패 사유','textarea'),field('details.existingCustomerKey','기존 판매 고객 연결 키','text',{placeholder:'기존 고객정보를 복제하거나 덮어쓰지 않습니다.'})]},
  {kind:'appraisal',title:'비교·매입 검토',statuses:options([['draft','검토 작성'],['reviewed','검토 완료'],['bid','제시·입찰'],['won','매입 성사'],['lost','미성사'],['cancelled','취소']]),fields:[field('details.saleEstimateWon','보수적 예상 판매금액 (원)','money'),field('details.estimatedCostsWon','예상 총비용 (원)','money'),field('details.targetProfitWon','목표 차량이익 (원)','money'),field('details.reserveWon','추가 비용 여유금 (원)','money'),field('details.holdingDays','예상 보유기간 (일)','number'),field('details.comparisonUrls','비교매물·자료 주소','urls',{placeholder:'http 또는 https 주소를 한 줄에 하나씩 입력'}),field('details.checkedDate','자료 확인일','date'),field('details.conditionNotes','차량 조건·확인한 상태','textarea'),field('amountWon','실제 제시·입찰금액 (원)','money'),field('dueDate','검토 예정일','date'),field('details.resultNotes','결과·검토 근거','textarea'),field('details.evidenceMediaId','연결 첨부 ID')]},
  {kind:'advertising',title:'광고·재고 점검',statuses:options([['draft','광고 준비'],['live','광고 중'],['ended','종료 확인'],['end_unconfirmed','종료 확인 필요']]),fields:[field('details.channel','광고 채널'),field('details.url','게시 주소','text',{placeholder:'https://…'}),field('amountWon','게시 가격 (원)','money'),field('effectiveDate','광고 시작일','date'),field('details.receivedDate','입고일','date'),field('details.trackingSince','문의 추적 시작일','date'),field('dueDate','다음 검토일','date'),field('details.assigneeId','담당자 ID'),field('details.priceChangedDate','최근 가격 변경일','date'),field('details.priceHistory','가격 변경 이력 · 날짜와 금액을 한 줄씩','textarea',{placeholder:'2026-11-21 30,000,000\n2026-11-25 29,500,000'}),field('details.notes','광고·상품화 메모','textarea')]}
 ]);
 const definitions=new Map(forms.map(form=>[form.kind,form]));
 const statuses=new Map(forms.map(form=>[form.kind,new Set(form.statuses.map(item=>item.value))]));
 function formsFor(capabilities={},options={}){if(options.write&&capabilities.canWrite!==true)return [];return forms.filter(form=>form.kind!=='lead'||(options.write?capabilities.customerWrite===true:capabilities.customerRead===true));}
 function amount(value){if(value===null||value===undefined||value==='')return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>MAX_WON)error('INVALID_WORKFLOW_AMOUNT');return value;}
 function httpUrl(value){if(typeof value!=='string'||value.length>2048)return null;const raw=value.trim();try{const parsed=new URL(raw);return ['http:','https:'].includes(parsed.protocol)&&parsed.hostname&&!parsed.username&&!parsed.password?raw:null;}catch{return null;}}
 function urls(value){if(value===null||value===undefined||value==='')return [];const values=Array.isArray(value)?value:typeof value==='string'?value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean):null;if(!values||values.length>20)error('INVALID_WORKFLOW_URLS');const result=[];for(const value of values){const valid=httpUrl(value);if(!valid)error('INVALID_WORKFLOW_URLS');if(!result.includes(valid))result.push(valid);}return result;}
 function priceHistory(value){if(value===null||value===undefined||value==='')return [];let rows=value;if(typeof rows==='string'){if(rows.trim().startsWith('[')){try{rows=JSON.parse(rows);}catch{error('INVALID_WORKFLOW_PRICE_HISTORY');}}else rows=rows.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const match=/^(\d{4}-\d{2}-\d{2})\s+(\d{1,3}(?:,\d{3})*|\d+)$/.exec(line);if(!match)error('INVALID_WORKFLOW_PRICE_HISTORY');return{date:match[1],amountWon:Number(match[2].replaceAll(',',''))};});}if(!Array.isArray(rows)||rows.length>100)error('INVALID_WORKFLOW_PRICE_HISTORY');return rows.map(row=>{if(!plain(row)||Object.keys(row).some(key=>!['date','amountWon'].includes(key))||!date(row.date)||row.date<'1900-01-01'||amount(row.amountWon)===null)error('INVALID_WORKFLOW_PRICE_HISTORY');return {date:row.date,amountWon:row.amountWon};});}
 function inputValue(values,key){if(own(values,key))return values[key];return key.split('.').reduce((value,part)=>plain(value)&&own(value,part)?value[part]:undefined,values);}
 function normalizeForm(kind,values){
  const form=definitions.get(kind);if(!form||!plain(values))error('INVALID_WORKFLOW_FORM');const result={details:{}};
  for(const spec of form.fields){const raw=inputValue(values,spec.key);let value;
   if(spec.key==='details.priceHistory')value=priceHistory(raw);
   else if(spec.type==='urls')value=urls(raw);
   else if(spec.type==='checkbox'){if(raw===true||raw==='on'||raw==='true')value=true;else if(raw===false||raw===undefined||raw===null||raw===''||raw==='false')value=false;else error('INVALID_WORKFLOW_BOOLEAN');}
   else if(spec.type==='money'||spec.type==='number'){
    let parsed=raw;if(typeof parsed==='string'){parsed=parsed.trim();if(parsed==='')parsed=null;else{if(!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(parsed))error('INVALID_WORKFLOW_AMOUNT');parsed=Number(parsed.replaceAll(',',''));}}
    value=amount(parsed);if(spec.type==='number'&&value!==null&&value>(spec.key==='details.holdingDays'?36500:MAX_WON))error('INVALID_WORKFLOW_NUMBER');
   }else if(spec.type==='date'){if(raw===null||raw===undefined||raw==='')value=null;else{value=date(raw);if(!value||value<'1900-01-01')error('INVALID_WORKFLOW_DATE');}}
   else if(spec.type==='select'){value=raw==null||raw===''?'other':raw;if(!spec.options.some(option=>option.value===value))error('INVALID_WORKFLOW_OPTION');}
   else{if(raw!==undefined&&raw!==null&&typeof raw!=='string')error('INVALID_WORKFLOW_TEXT');value=raw==null?'':raw.trim();const maximum=['details.notes','details.requirements','details.conditionNotes','details.resultNotes','details.handoverItems'].includes(spec.key)?2000:spec.key.endsWith('Url')||spec.key==='details.url'?2048:spec.key==='details.phone'?30:200;if(value.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))error('INVALID_WORKFLOW_TEXT');if(spec.key.endsWith('Id')||spec.key==='details.existingCustomerKey'){value=value||null;if(value!==null&&!id(value))error('INVALID_WORKFLOW_ID');}if(['details.evidenceUrl','details.url'].includes(spec.key)){value=value||null;if(value!==null&&!httpUrl(value))error('INVALID_WORKFLOW_URLS');}}
   if(spec.required&&!value)error('WORKFLOW_TITLE_REQUIRED');
   if(spec.key.startsWith('details.'))result.details[spec.key.slice(8)]=value;else result[spec.key]=value;
  }
  return result;
 }
 function formatForm(kind,values){
  const form=definitions.get(kind);if(!form||!plain(values))error('INVALID_WORKFLOW_FORM');const result={};
  for(const spec of form.fields){const raw=inputValue(values,spec.key);result[spec.key]=spec.type==='checkbox'?raw===true:spec.key==='details.priceHistory'?priceHistory(raw).map(row=>row.date+' '+row.amountWon.toLocaleString('ko-KR')).join('\n'):spec.type==='urls'?urls(raw).join('\n'):(spec.type==='money'||spec.type==='number')&&raw!==null&&raw!==undefined&&raw!==''?amount(raw).toLocaleString('ko-KR'):raw??'';}
  return result;
 }
 function appraisal(value){
  const input=plain(value?.details)?value.details:value;if(!plain(input))error('INVALID_WORKFLOW_APPRAISAL');
  const sale=own(input,'saleEstimateWon')?input.saleEstimateWon:input.expectedSaleWon;
  const numbers={expectedSaleWon:amount(sale),estimatedCostsWon:amount(input.estimatedCostsWon),targetProfitWon:amount(input.targetProfitWon),reserveWon:amount(input.reserveWon)};
  const finance=resolveFinance();if(finance?.appraisal)return finance.appraisal(numbers);
  const missing=Object.keys(numbers).filter(key=>numbers[key]===null);if(missing.length)return{maxPurchaseWon:null,complete:false,missing,warnings:[]};
  const maxPurchaseWon=numbers.expectedSaleWon-numbers.estimatedCostsWon-numbers.targetProfitWon-numbers.reserveWon;
  return{maxPurchaseWon,complete:true,missing:[],warnings:maxPurchaseWon<0?['NEGATIVE_PURCHASE_LIMIT']:[]};
 }
 function canonical(value){if(Array.isArray(value))return value.map(canonical);if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
 function uniqueEntries(entries){const rows=new Map();for(const row of entries){if(!plain(row)||!id(row.id)||!id(row.cycleId))continue;const key=row.cycleId+'\u0000'+row.id,prior=rows.get(key);if(prior===null)continue;if(prior&&JSON.stringify(canonical(prior))!==JSON.stringify(canonical(row)))rows.set(key,null);else if(!prior)rows.set(key,row);}return [...rows.values()].filter(Boolean);}
 function scopedCar(workspace,car){if(!plain(car))return null;if(car.id!=null&&String(car.id)!==workspace.carId||car.carId!=null&&String(car.carId)!==workspace.carId||car.companyId!=null&&car.companyId!==workspace.companyId)return null;if(car.ownerId!=null&&car.ownerId!==workspace.ownerId&&car.ownerId!=='cld_'+workspace.ownerId.replaceAll('-','').slice(0,18))return null;return car;}
 function tasks(workspace,carSnapshot,settings={},options={}){
  if(!plain(workspace)||!id(workspace.companyId)||!id(workspace.ownerId)||!id(workspace.carId)||!Number.isSafeInteger(workspace.revision)||workspace.revision<0||!Array.isArray(workspace.cycles)||workspace.cycles.length>250||!Array.isArray(workspace.entries)||workspace.entries.length>5000||!plain(workspace.capabilities))error('INVALID_WORKFLOW_WORKSPACE');
  const asOf=today(options.today),now=ordinal(asOf),policy=preferences(settings),horizon=options.includeAllDates===true?Infinity:now+policy.dueSoonDays,customer=workspace.capabilities.customerRead===true,car=scopedCar(workspace,carSnapshot),result=new Map();
  const cycleMap=new Map();for(const cycle of workspace.cycles){if(!plain(cycle)||!id(cycle.id)||!['open','closed','cancelled'].includes(cycle.status))continue;if(cycleMap.has(cycle.id))cycleMap.set(cycle.id,null);else cycleMap.set(cycle.id,cycle);}
  const cycles=[...cycleMap.values()].filter(cycle=>cycle&&cycle.status!=='cancelled'),allowed=new Set(cycles.map(cycle=>cycle.id));
  // Do not inspect, serialize or count a denied lead payload, including during deduplication.
  const readable=workspace.entries.filter(row=>plain(row)&&(row.kind!=='lead'||customer));
  const rows=uniqueEntries(readable).filter(row=>allowed.has(row.cycleId)&&definitions.has(row.kind));
  const registeredLeadCycles=new Set(customer?readable.filter(row=>row.kind==='lead'&&allowed.has(row.cycleId)).map(row=>row.cycleId):[]);
  const validDue=entry=>date(entry.dueDate);
  function emit(entry,reason,category,titleValue,description,extra={}){
   const dueDate=extra.dueDate===undefined?validDue(entry):date(extra.dueDate),due=ordinal(dueDate);if(due!==null&&due>horizon)return;
   const overdue=due!==null&&due<now,taskId=['business',workspace.companyId,workspace.ownerId,workspace.carId,entry.cycleId,entry.id,reason].map(encodeURIComponent).join(':');
   let detail=description;if(entry.dueDate!=null&&entry.dueDate!==''&&!date(entry.dueDate))detail+=' · 예정일 확인 필요';else if(dueDate===null)detail+=' · 예정일 미입력';
   result.set(taskId,{id:taskId,kind:entry.kind,category,title:titleValue,dueDate,overdue,status:entry.status,sourceId:entry.id,cycleId:entry.cycleId,carId:workspace.carId,ownerId:workspace.ownerId,companyId:workspace.companyId,priority:overdue?100:due===now?80:due!==null?50:30,description:detail,...extra,dueDate,overdue});
  }
  const tasksForLead=rows.filter(row=>row.kind==='task'&&statuses.get('task').has(row.status)&&plain(row.details)&&id(row.details.leadId));
  for(const row of rows){const details=row.details;
   if(!statuses.get(row.kind).has(row.status)||!plain(details)){
    emit(row,'workflow-state-unknown','verification','업무 상태 확인 필요','저장된 업무 상태를 확인하지 못했습니다. 완료로 처리하지 않았습니다.');
   }else if(row.kind==='document'&&!['verified','done'].includes(row.status)){
    const form=definitions.get('document'),type=form.fields[0].options.find(option=>option.value===details.documentType)?.label||'서류',label=string(details.label,300)||type;
    const action=row.status==='missing'?'접수 필요':row.status==='received'?'내용 확인 필요':'보완 필요';emit(row,'document-review','verification',label+' · '+action,'첨부 여부와 내용 확인은 별도입니다.');
   }else if(row.kind==='transfer'&&row.status!=='done'){
    const action={not_sent:'대행사 전달 필요',sent:'접수 확인 필요',received:'완료 확인 필요',needs_action:'보완 필요'}[row.status];emit(row,'transfer-pending','verification','명의이전 · '+action,'판매 완료와 명의이전 완료는 별도입니다.');
   }else if(row.kind==='task'&&!['done','cancelled'].includes(row.status)){
    const selectedCategory=string(details.category,100),knownCategory=categoryOptions.some(option=>option.value===selectedCategory),category=knownCategory?selectedCategory:'other',hasLeadLink=details.leadId!==undefined&&details.leadId!==null&&details.leadId!=='';if(!customer&&(!knownCategory||hasLeadLink||['contact','visit','contract','delivery'].includes(category)))continue;
    const title=string(details.title,300);if(!title)continue;emit(row,'task-pending',category,title,row.status==='blocked'?'확인이 필요한 업무입니다.':category==='aftercare'&&id(details.costId)?'발생 비용은 연결된 비용 기록에서 계산합니다.':'저장된 다음 업무입니다.');
   }else if(row.kind==='lead'&&customer&&!['lost','delivered'].includes(row.status)){
    const action=string(details.nextAction,300);if(!action)continue;
    // An explicit linked task with the same action/date owns its completion state.
    if(tasksForLead.some(task=>task.cycleId===row.cycleId&&task.details.leadId===row.id&&string(task.details.title,300)===action&&validDue(task)===validDue(row)))continue;
    const name=string(details.name,300);emit(row,'lead-next-action',row.status==='visit_booked'?'visit':'contact',name?name+' · '+action:action,'저장된 상담의 다음 행동입니다.');
   }else if(row.kind==='appraisal'&&['draft','reviewed','bid'].includes(row.status)&&validDue(row)){
    emit(row,'appraisal-review','other','매입 검토 · '+(row.status==='bid'?'입찰 결과 확인':'자료 확인'),'비교 자료와 직접 입력한 금액을 확인합니다.');
   }else if(row.kind==='advertising'){
    const sold=car?.status==='판매완료',channel=string(details.channel,100),prefix=channel?channel+' 광고':'광고';
    if(row.status==='end_unconfirmed'||row.status==='live'&&sold)emit(row,'advertising-end','other',prefix+' · 종료 확인 필요','판매 완료만으로 광고 종료를 확인하지 않습니다.',{dueDate:null});
    else if(row.status==='live'){
     if(validDue(row))emit(row,'advertising-review','price_review',prefix+' · 검토 예정','자동 가격 변경 없이 광고 내용과 판단 자료를 확인합니다.');
     const start=date(row.effectiveDate),tracking=date(details.trackingSince);
     if(start&&tracking&&customer&&!registeredLeadCycles.has(row.cycleId)){const since=Math.max(ordinal(start),ordinal(tracking)),due=addDays(ordinal(start)>=ordinal(tracking)?start:tracking,policy.noInquiryDays);if(now-since>=policy.noInquiryDays&&due)emit(row,'advertising-no-registered-inquiries','price_review',prefix+' · 등록된 문의 없음','명시된 광고·문의 추적 시작일 기준 '+policy.noInquiryDays+'일 이상입니다. 실제 문의 유무는 추가 확인하세요.',{dueDate:due});}
    }
   }
  }
  const open=cycles.filter(cycle=>cycle.status==='open').sort((a,b)=>(Number.isSafeInteger(b.sequence)?b.sequence:0)-(Number.isSafeInteger(a.sequence)?a.sequence:0)||a.id.localeCompare(b.id))[0];
  if(open&&car&&['매입진행','판매중','계약중','수리중'].includes(car.status)){
   const ads=rows.filter(row=>row.kind==='advertising'&&row.cycleId===open.id&&plain(row.details)),received=date(car.receivedDate)||date(car.receivedAt)||[...new Set(ads.map(row=>date(row.details.receivedDate)).filter(Boolean))].filter((value,index,all)=>all.length===1)[0]||null;
   const purchased=date(car.purchaseAt),basis=received||purchased,age=basis?now-ordinal(basis):null;
   if(age!==null&&age>=0){const strategy=age>=policy.strategyReviewDays,threshold=strategy?policy.strategyReviewDays:policy.priceReviewDays;
    if(age>=threshold){const entry={id:workspace.carId,cycleId:open.id,kind:'inventory',status:car.status,dueDate:null};emit(entry,strategy?'inventory-strategy-review':'inventory-price-review','price_review',strategy?'장기 재고 · 판매 전략 검토':'재고 · 가격 검토',(received?'입고일':'매입일')+' 기준 '+age+'일입니다. 기간은 사용자 설정 기준입니다.',{dueDate:addDays(basis,threshold)});}
   }
  }
  return [...result.values()].sort((a,b)=>b.priority-a.priority||(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')||a.id.localeCompare(b.id));
 }
 return freeze({forms,formsFor,normalizeForm,formatForm,tasks,appraisal,preferences,defaultPreferences:defaults,date,today,addDays,maxAmountWon:MAX_WON});
});
