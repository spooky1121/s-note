'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../assets/business-workflows.js');
const TODAY='2026-11-21';
const code=value=>error=>error?.code===value;
function workspace(entries=[],cycles=[{id:'cycle-1',status:'open',sequence:1,details:{}}],capabilities={canWrite:true,customerRead:true,customerWrite:true}){return{companyId:'company-1',ownerId:'owner-1',carId:'car-1',revision:1,cycles,entries,capabilities};}
function entry(kind,status,details={},extra={}){return{id:'entry-1',cycleId:'cycle-1',kind,status,amountWon:null,effectiveDate:null,dueDate:null,details,...extra};}
function project(entries,car={},settings={},options={today:TODAY}){return M.tasks(workspace(entries),{id:'car-1',ownerId:'owner-1',status:'판매중',...car},settings,options);}
const clone=value=>JSON.parse(JSON.stringify(value));
function deepFreeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}

test('pure UMD browser export and CommonJS expose immutable form definitions for all non-financial kinds',()=>{
 assert.deepEqual(M.forms.map(form=>form.kind),['document','transfer','task','lead','appraisal','advertising']);
 const context={URL,Intl,Date,console};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/business-workflows.js'),'utf8'),context);assert.equal(typeof context.SnoteBusinessWorkflows.tasks,'function');
 assert(Object.isFrozen(M.forms));for(const form of M.forms){assert(Object.isFrozen(form));assert(form.statuses.length>0);assert(form.fields.every(field=>['text','textarea','date','money','number','select','checkbox','urls'].includes(field.type)));for(const field of form.fields)if(field.required)assert.equal(field.key,'details.title');}
 assert.equal(M.formsFor({customerRead:false}).some(form=>form.kind==='lead'),false);assert.equal(M.formsFor({canWrite:true,customerRead:true,customerWrite:false},{write:true}).some(form=>form.kind==='lead'),false);assert.deepEqual(M.formsFor({canWrite:false},{write:true}),[]);
});

test('Korean due dates and day arithmetic are independent of the host timezone',()=>{
 const original=process.env.TZ;
 try{for(const zone of ['UTC','America/Los_Angeles','Asia/Seoul']){process.env.TZ=zone;assert.equal(M.today(new Date('2026-11-20T14:59:59Z')),'2026-11-20');assert.equal(M.today(new Date('2026-11-20T15:00:00Z')),TODAY);const rows=project([entry('task','todo',{title:'오늘 확인',category:'other'},{dueDate:TODAY})],{}, {},{today:new Date('2026-11-20T15:00:00Z')});assert.equal(rows[0].overdue,false);assert.equal(rows[0].priority,80);}}
 finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
 assert.equal(M.date('2024-02-29'),'2024-02-29');for(const value of ['2023-02-29','2026-02-30','0000-01-01','2026-1-1','2026-11-21T00:00:00Z',null,42])assert.equal(M.date(value),null);
 assert.equal(M.addDays('2024-02-28',2),'2024-03-01');assert.equal(M.addDays('9999-12-31',1),null);assert.equal(M.addDays('0001-01-01',-1),null);assert.throws(()=>M.today('not-a-date'),code('INVALID_WORKFLOW_DATE'));
});

test('preferences are optional user criteria with bounded safe integers and preserve an explicit zero-day horizon',()=>{
 assert.deepEqual(M.preferences(),{noInquiryDays:7,priceReviewDays:30,strategyReviewDays:60,maturityDays:7,dueSoonDays:7});
 assert.deepEqual(M.preferences({noInquiryDays:0,priceReviewDays:'40',strategyReviewDays:Infinity,maturityDays:-1,dueSoonDays:0,unknown:99}),{noInquiryDays:7,priceReviewDays:30,strategyReviewDays:60,maturityDays:7,dueSoonDays:0});
 assert.equal(M.preferences({noInquiryDays:3650}).noInquiryDays,3650);assert.equal(M.preferences({noInquiryDays:3651}).noInquiryDays,7);assert.equal(M.preferences({dueSoonDays:366}).dueSoonDays,7);
});

test('form normalization preserves missing amounts and dates, explicit zero, all workflow fields and original optional policy',()=>{
 const lead=M.normalizeForm('lead',{'details.name':'','details.budgetWon':'','details.tradeIn':false,'details.requirements':'다음 달 구입 검토'});assert.equal(lead.details.name,'');assert.equal(lead.details.budgetWon,null);assert.equal(lead.effectiveDate,null);assert.equal(lead.dueDate,null);assert.equal(lead.details.tradeIn,false);
 const appraisal=M.normalizeForm('appraisal',{details:{saleEstimateWon:'33,500,000',estimatedCostsWon:'1,300,000',targetProfitWon:'2,000,000',reserveWon:'500,000',holdingDays:'30',comparisonUrls:'https://example.com/a\nhttp://example.com/b\nhttps://example.com/a'},amountWon:'0'});assert.deepEqual(appraisal.details.comparisonUrls,['https://example.com/a','http://example.com/b']);assert.equal(appraisal.amountWon,0);assert.equal(appraisal.details.holdingDays,30);
 const ad=M.normalizeForm('advertising',{'details.priceHistory':'[{"date":"2026-11-20","amountWon":30000000}]','details.url':'https://example.com/ad','details.receivedDate':'2026-10-01','details.trackingSince':'2026-11-01'});assert.deepEqual(ad.details.priceHistory,[{date:'2026-11-20',amountWon:30000000}]);assert.equal(ad.details.receivedDate,'2026-10-01');
 const readable=M.normalizeForm('advertising',{'details.priceHistory':'2026-11-20 30,000,000\n2026-11-21 29500000'});assert.equal(readable.details.priceHistory[1].amountWon,29500000);assert.equal(M.formatForm('advertising',readable)['details.priceHistory'],'2026-11-20 30,000,000\n2026-11-21 29,500,000');assert.deepEqual(M.normalizeForm('advertising',M.formatForm('advertising',ad)),ad);
 const task=M.normalizeForm('task',{'details.title':' 인도 확인 ','details.category':'delivery','details.mileage':'47,123','details.handoverItems':'키 2개','details.costId':'cost-1'});assert.equal(task.details.title,'인도 확인');assert.equal(task.details.mileage,47123);assert.equal(task.details.handoverItems,'키 2개');assert.equal(task.details.costId,'cost-1');
 const transfer=M.normalizeForm('transfer',{details:{agency:'대행사',receivedDate:'2026-11-21',completedDate:''}});assert.equal(transfer.details.receivedDate,TODAY);assert.equal(transfer.details.completedDate,null);
 for(const form of M.forms){const blank=Object.fromEntries(form.fields.filter(spec=>spec.key.endsWith('Id')||['details.evidenceUrl','details.url','details.existingCustomerKey'].includes(spec.key)).map(spec=>[spec.key,'  ']));const normalized=M.normalizeForm(form.kind,{'details.title':'명시한 할 일',...blank});for(const key of Object.keys(blank))assert.equal(normalized.details[key.slice(8)],null,form.kind+' '+key+' blank normalizes to JSON null');}
});

test('form boundaries reject invalid money, dates, numbers, URL protocols, history and unknown schema choices',()=>{
 for(const value of [-1,1.5,'1.5','1,00','-1','1e3',Number.MAX_SAFE_INTEGER])assert.throws(()=>M.normalizeForm('appraisal',{'details.saleEstimateWon':value}),code('INVALID_WORKFLOW_AMOUNT'));
 assert.throws(()=>M.normalizeForm('task',{'details.title':''}),code('WORKFLOW_TITLE_REQUIRED'));assert.throws(()=>M.normalizeForm('task',{'details.title':'할 일','details.category':'unrecognized'}),code('INVALID_WORKFLOW_OPTION'));assert.throws(()=>M.normalizeForm('unknown',{}),code('INVALID_WORKFLOW_FORM'));
 assert.equal(M.normalizeForm('appraisal',{'details.holdingDays':36500}).details.holdingDays,36500);assert.throws(()=>M.normalizeForm('appraisal',{'details.holdingDays':36501}),code('INVALID_WORKFLOW_NUMBER'));assert.throws(()=>M.normalizeForm('transfer',{'details.receivedDate':'2026-02-30'}),code('INVALID_WORKFLOW_DATE'));assert.throws(()=>M.normalizeForm('transfer',{'details.receivedDate':'1899-12-31'}),code('INVALID_WORKFLOW_DATE'));
 for(const value of ['javascript:alert(1)','data:text/plain,no','https://user:password@example.com'])assert.throws(()=>M.normalizeForm('document',{'details.evidenceUrl':value}),code('INVALID_WORKFLOW_URLS'));
 assert.throws(()=>M.normalizeForm('advertising',{'details.priceHistory':'[{"date":"2026-11-21"}]'}),code('INVALID_WORKFLOW_PRICE_HISTORY'));assert.throws(()=>M.normalizeForm('advertising',{'details.priceHistory':'not-json'}),code('INVALID_WORKFLOW_PRICE_HISTORY'));
 assert.throws(()=>M.normalizeForm('appraisal',{'details.comparisonUrls':Array.from({length:21},(_,n)=>'https://example.com/'+n)}),code('INVALID_WORKFLOW_URLS'));
 assert.throws(()=>M.normalizeForm('task',{'details.title':'확인','details.leadId':'x'.repeat(201)}),code('INVALID_WORKFLOW_TEXT'));
 for(const[kind,key,length]of[['task','details.title',201],['task','details.notes',2001],['lead','details.phone',31],['lead','details.lostReason',201]])assert.throws(()=>M.normalizeForm(kind,{'details.title':'확인',[key]:'가'.repeat(length)}),code('INVALID_WORKFLOW_TEXT'));
 assert.throws(()=>M.normalizeForm('advertising',{'details.priceHistory':Array.from({length:101},()=>({date:TODAY,amountWon:0}))}),code('INVALID_WORKFLOW_PRICE_HISTORY'));
});

test('appraisal computes 29.7m from explicit amounts, never fabricates a missing value and validates bounds',()=>{
 const input={saleEstimateWon:33500000,estimatedCostsWon:1300000,targetProfitWon:2000000,reserveWon:500000};assert.equal(M.appraisal(input).maxPurchaseWon,29700000);assert.equal(M.appraisal({details:input}).complete,true);
 const missing=M.appraisal({...input,reserveWon:null});assert.equal(missing.maxPurchaseWon,null);assert.equal(missing.complete,false);assert(missing.missing.includes('reserveWon'));
 assert.equal(M.appraisal({saleEstimateWon:0,estimatedCostsWon:0,targetProfitWon:0,reserveWon:0}).maxPurchaseWon,0);
 for(const value of [-1,0.1,'33500000',Number.MAX_SAFE_INTEGER,Infinity])assert.throws(()=>M.appraisal({...input,saleEstimateWon:value}));assert.equal(M.appraisal({...input,saleEstimateWon:0}).maxPurchaseWon,-3800000);
});

test('browser appraisal reuses an available finance model with the canonical finance input',()=>{
 let called=null;const context={URL,Intl,Date,SnoteBusinessFinance:{appraisal(value){called=value;return{maxPurchaseWon:123,complete:true,missing:[],warnings:[]};}}};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/business-workflows.js'),'utf8'),context);
 const result=context.SnoteBusinessWorkflows.appraisal({saleEstimateWon:4,estimatedCostsWon:1,targetProfitWon:1,reserveWon:1});assert.equal(result.maxPurchaseWon,123);assert.deepEqual(JSON.parse(JSON.stringify(called)),{expectedSaleWon:4,estimatedCostsWon:1,targetProfitWon:1,reserveWon:1});
});

test('attachments and contract dates never verify a document or complete title transfer',()=>{
 const rows=project([entry('document','missing',{documentType:'registration',evidenceMediaId:'file-1'},{id:'doc-1',effectiveDate:TODAY}),entry('document','received',{documentType:'insurance_history',evidenceUrl:'https://example.com/proof'},{id:'doc-2'}),entry('transfer','received',{agency:'대행사',completedDate:TODAY,evidenceMediaId:'file-1'},{id:'transfer-1'})],{status:'판매완료',soldAt:TODAY});
 assert.equal(rows.length,3);assert(rows.find(row=>row.sourceId==='doc-1').title.includes('접수 필요'));assert(rows.find(row=>row.sourceId==='doc-2').title.includes('내용 확인'));assert(rows.find(row=>row.sourceId==='transfer-1').title.includes('완료 확인'));
 assert.equal(project([entry('document','verified',{documentType:'registration'}),entry('transfer','done',{}, {id:'transfer-1'})]).length,0);
});

test('only known unfinished source entries generate tasks; duplicate and conflicting IDs cannot resurrect work',()=>{
 const pending=entry('task','todo',{title:'수리 확인',category:'preparation'},{dueDate:TODAY});const before=JSON.stringify(pending);
 assert.equal(project([pending,clone(pending)]).length,1);assert.equal(JSON.stringify(pending),before);
 assert.equal(project([pending,{...pending,status:'done'}]).length,0);
 const unknown=project([entry('task','done',{title:'완료'}),entry('task','cancelled',{title:'취소'},{id:'task-2'}),entry('document','unknown',{}, {id:'doc-3'}),entry('unknown','todo',{}, {id:'unknown-1'})]);assert.equal(unknown.length,1);assert.equal(unknown[0].title,'업무 상태 확인 필요');assert.equal(unknown[0].sourceId,'doc-3');
 const changed=project([{...pending,dueDate:'2026-11-20'}])[0];assert.equal(changed.overdue,true);assert.equal(changed.priority,100);assert.equal(changed.id,project([pending])[0].id);
});

test('future work respects the configured horizon; missing and invalid due dates remain explicit backlog',()=>{
 const rows=project([entry('task','todo',{title:'오늘',category:'other'},{id:'today',dueDate:TODAY}),entry('task','todo',{title:'7일 후',category:'other'},{id:'soon',dueDate:'2026-11-28'}),entry('task','todo',{title:'8일 후',category:'other'},{id:'later',dueDate:'2026-11-29'}),entry('task','todo',{title:'기한 미정',category:'other'},{id:'unknown'}),entry('task','todo',{title:'날짜 오류',category:'other'},{id:'invalid',dueDate:'2026-02-30'})]);
 assert.deepEqual(rows.map(row=>row.sourceId),['today','soon','invalid','unknown']);assert.equal(rows.find(row=>row.sourceId==='unknown').dueDate,null);assert.equal(rows.find(row=>row.sourceId==='invalid').overdue,false);assert(rows.find(row=>row.sourceId==='invalid').description.includes('확인 필요'));
 assert.equal(project([entry('task','todo',{title:'내일',category:'other'},{dueDate:'2026-11-22'})],{},{dueSoonDays:0}).length,0);
});

test('cancelled cycles are excluded, closed cycles do not complete aftercare, and source keys distinguish transactions',()=>{
 const cycles=[{id:'cycle-1',status:'cancelled',sequence:1},{id:'cycle-2',status:'closed',sequence:2},{id:'cycle-3',status:'open',sequence:3}],rows=[1,2,3].map(n=>entry('task','todo',{title:'사후 조치',category:'aftercare',costId:'cost-'+n},{cycleId:'cycle-'+n}));
 const tasks=M.tasks(workspace(rows,cycles),{}, {},{today:TODAY});assert.equal(tasks.length,2);assert(tasks.some(row=>row.cycleId==='cycle-2'));assert.equal(new Set(tasks.map(row=>row.id)).size,2);assert(tasks.every(row=>row.description.includes('연결된 비용 기록')));assert(tasks.every(row=>!Object.hasOwn(row,'amountWon')));
});

test('customer denial does not inspect private lead data, leak linked task titles or infer zero inquiries',()=>{
 const secret=entry('lead','inquiry',{});Object.defineProperty(secret,'details',{get(){throw Error('PRIVATE_LEAD_READ');}});
 const rows=[secret,entry('task','todo',{title:'비공개 고객 연락',category:'contact'},{id:'contact'}),entry('task','todo',{title:'비공개 고객 출고',category:'delivery'},{id:'delivery'}),entry('task','todo',{title:'비공개 고객 사후 처리',category:'aftercare',leadId:'entry-1'},{id:'linked'}),entry('task','todo',{title:'공개 상품화',category:'preparation'},{id:'safe'}),entry('advertising','live',{trackingSince:'2026-11-01'},{id:'ad',effectiveDate:'2026-11-01'})];
 const tasks=M.tasks(workspace(rows,undefined,{canWrite:false,customerRead:false,customerWrite:false}),{}, {},{today:TODAY});assert.deepEqual(tasks.map(row=>row.title),['공개 상품화']);assert(!JSON.stringify(tasks).includes('비공개'));
 const malformedLinks=[entry('task','todo',{title:'숨길 고객 정보',category:'aftercare',leadId:'x'.repeat(201)}),entry('task','todo',{title:'숨길 분류 불명',category:'unknown'},{id:'unknown-task'})];assert.equal(M.tasks(workspace(malformedLinks,undefined,{customerRead:false}),{},{},{today:TODAY}).length,0);
});

test('lead followups use the original next action and a matching explicit task owns completion',()=>{
 const lead=entry('lead','inquiry',{name:'합성 고객',phone:'000',nextAction:'전화 상담'},{id:'lead-1',dueDate:TODAY});const task=entry('task','todo',{title:'전화 상담',category:'contact',leadId:'lead-1'},{id:'task-1',dueDate:TODAY});
 assert.equal(project([lead])[0].title,'합성 고객 · 전화 상담');assert.deepEqual(project([lead,task]).map(row=>row.sourceId),['task-1']);assert.equal(project([lead,{...task,status:'done'}]).length,0);assert.equal(project([{...lead,status:'lost'}]).length,0);
 assert.equal(project([{...lead,details:{...lead.details,nextAction:'새 연락'}},{...task,status:'done'}]).length,1);
});

test('advertising requires actual tracking dates before claiming registered inquiries are absent',()=>{
 const ad=entry('advertising','live',{channel:'직접 채널',trackingSince:'2026-11-01'},{id:'ad',effectiveDate:'2026-11-01'});
 const empty=project([ad]);assert.equal(empty.length,1);assert(empty[0].title.includes('등록된 문의 없음'));assert.equal(empty[0].dueDate,'2026-11-08');
 assert.equal(project([{...ad,details:{channel:'직접 채널'}}]).length,0);assert.equal(project([{...ad,details:{...ad.details,trackingSince:TODAY}}]).length,0);assert.equal(project([{...ad,effectiveDate:null}]).length,0);
 assert.equal(project([ad,entry('lead','lost',{nextAction:''},{id:'registered-inquiry'})]).length,0);
 const unknown=project([ad,entry('lead','unknown',{}, {id:'unknown-inquiry'})]);assert.equal(unknown.length,1);assert.equal(unknown[0].title,'업무 상태 확인 필요');
 const conflicting=entry('lead','inquiry',{}, {id:'conflicting-inquiry'});assert.equal(project([ad,conflicting,{...conflicting,status:'lost'}]).length,0);
 assert.equal(project([ad],{},{noInquiryDays:30}).length,0);
});

test('sold status never ends an advertisement or completes title transfer; explicit end confirmation removes its alert',()=>{
 const ad=entry('advertising','live',{channel:'엔카',trackingSince:'2026-11-01'},{effectiveDate:'2026-11-01'});
 const sold=project([ad],{status:'판매완료',soldAt:TODAY});assert.equal(sold.length,1);assert(sold[0].title.includes('종료 확인 필요'));assert.equal(sold[0].status,'live');assert.equal(project([{...ad,status:'ended'}],{status:'판매완료'}).length,0);
 assert.equal(project([{...ad,status:'end_unconfirmed'}],{status:'판매중'}).length,1);
});

test('receipt and advertising clocks stay separate; inventory thresholds are configurable and do not duplicate 30/60 reviews',()=>{
 const ad=entry('advertising','draft',{receivedDate:'2026-10-01',trackingSince:null},{effectiveDate:'2026-11-20'});
 const rows=project([ad],{purchaseAt:'2026-09-01'});assert.equal(rows.length,1);assert.equal(rows[0].title,'재고 · 가격 검토');assert(rows[0].description.includes('입고일 기준 51일'));assert.equal(rows[0].dueDate,'2026-10-31');
 const strategy=project([],{purchaseAt:'2026-09-01'});assert.equal(strategy.length,1);assert(strategy[0].title.includes('판매 전략'));assert(strategy[0].description.includes('매입일 기준'));assert.equal(project([],{purchaseAt:'2026-09-01',status:'판매완료'}).length,0);
 assert.equal(project([],{purchaseAt:'2026-09-01'},{priceReviewDays:90,strategyReviewDays:180}).length,0);assert.equal(project([],{purchaseAt:'2026-02-30'}).length,0);assert.equal(project([],{purchaseAt:'2026-12-01'}).length,0);
 const mismatch=M.tasks(workspace([]),{id:'another-car',status:'판매중',purchaseAt:'2026-01-01'},{},{today:TODAY});assert.equal(mismatch.length,0);
});

test('workspace and source data remain unchanged; invalid workspace bounds are unavailable rather than zero tasks',()=>{
 const state=deepFreeze(workspace([entry('document','missing',{documentType:'registration',evidenceMediaId:'file'})])),car=deepFreeze({id:'car-1',ownerId:'owner-1',status:'판매中',purchaseAt:null}),before=JSON.stringify(state);M.tasks(state,car,{}, {today:TODAY});assert.equal(JSON.stringify(state),before);
 for(const value of [null,{},workspace([]).entries,{...workspace([]),revision:-1},{...workspace([]),entries:Array(5001).fill(null)}])assert.throws(()=>M.tasks(value,{}, {},{today:TODAY}),code('INVALID_WORKFLOW_WORKSPACE'));
 assert.throws(()=>M.tasks(workspace([]),{}, {},{today:'2026-02-30'}),code('INVALID_WORKFLOW_DATE'));
});
