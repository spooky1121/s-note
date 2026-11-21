'use strict';
// Real isolated PostgreSQL functions/RLS/CAS. Synthetic records only; no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createPermissionFixture,COMPANY,FOREIGN,OWNER,RECIPIENT,UPLOADER,ADMIN,ID}=require('./vehicle-share-permissions-db.cjs');
const {ACCOUNTANT,INACTIVE}=require('./recycle-bin-db.cjs');
const FILE='20261121171218_vehicle_business_workspace.sql',SQL=()=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',FILE),'utf8');
const CUSTOM='custom-12345678-1234-4123-8123-123456789abc';
const cycleDetails=()=>({tradeType:'direct',purchaseSource:'합성 매입처',purchaseAmountWon:30000000,purchaseDate:'2026-11-01',expectedSaleWon:33500000,saleAmountWon:null,saleDate:null,legacyCosts:{bodywork:100000,[CUSTOM]:1234},legacyCostsWon:101234,legacyInterestWon:null,sourceSignature:'bf1:synthetic',costsConfirmed:true,settlementStatus:'pending'});
async function createBusinessFixture(){
 const f=await createPermissionFixture();await f.db.exec('reset role');await f.db.exec('alter table storage.objects add column if not exists metadata jsonb');
 await f.db.query("update public.zc_datasets set payload=jsonb_set(jsonb_set(payload,'{0,customCosts}',$3::jsonb),'{0,customCostLabels}',$4::jsonb)where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER,JSON.stringify({[CUSTOM]:1234}),JSON.stringify({[CUSTOM]:'사용자 실제항목'})]);await f.db.exec(SQL());
 const read=(extra={})=>f.scalar('select public.snote_business_vehicle_read($1,$2,$3)as value',[extra.company??COMPANY,extra.owner??OWNER,extra.car??ID]);
 const write=(command,extra={})=>f.scalar('select public.snote_business_vehicle_write($1,$2,$3,$4,$5,$6)as value',[extra.company??COMPANY,extra.owner??OWNER,extra.car??ID,extra.revision??0,extra.request??randomUUID(),JSON.stringify(command)]);
 const list=(extra={})=>f.scalar('select public.snote_business_worklist($1,$2,$3,$4,$5)as value',[extra.company??COMPANY,extra.scope??'mine',extra.page??1,extra.size??30,extra.query??'']);
 const prefs=(action='read',payload=null,revision=null,request=null,company=COMPANY)=>f.scalar('select public.snote_business_preferences($1,$2,$3,$4,$5)as value',[company,action,revision,request,payload===null?null:JSON.stringify(payload)]);
 const evidence=(action,id,entryId,meta=null,extra={})=>f.scalar('select public.snote_business_evidence($1,$2,$3,$4,$5,$6,$7)as value',[extra.company??COMPANY,extra.owner??OWNER,extra.car??ID,action,id,entryId,meta===null?null:JSON.stringify(meta)]);
 const send=async(command,extra={})=>write(command,{revision:(await read(extra)).revision,...extra});
 return{...f,read,write,list,prefs,evidence,send};
}
async function run(){
 const f=await createBusinessFixture(),{db,scalar,actor,read,write,send,list,prefs,evidence}=f;let passed=0,failed=0,cycle,loan,cost,lead,evidenceDoc,lease;
 const group=async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name,{message:e.message,code:e.code,where:e.where,stack:e.stack?.split('\n').slice(0,3).join('\n')});}};
 const deny=(fn,codes=['42501'])=>assert.rejects(fn,e=>codes.includes(e.code));
 const privileged=async(sql,args=[])=>{await db.exec('reset role');return db.query(sql,args);};
 const counts=async()=>{await db.exec('reset role');return scalar("select jsonb_build_object('vehicles',(select count(*)from snote_business_private.vehicles),'entries',(select count(*)from snote_business_private.entries),'audit',(select count(*)from snote_business_private.audit),'requests',(select count(*)from snote_business_private.requests))as value");};
 const entry=(kind,status,details,extra={})=>({id:randomUUID(),cycleId:cycle,kind,status,amountWon:null,effectiveDate:null,dueDate:null,details,...extra});
 const save=async(value,extra={})=>send({action:'save_entry',entry:value},extra);
 const start=async(details=cycleDetails(),extra={})=>{const id=randomUUID();const result=await send({action:'start_cycle',cycle:{id,status:'open',details}},extra);return{id,result};};
 try{
  const original=await f.state();
  await group('read and paginated empty lists are sparse, nonmutating and redact every legacy private field',async()=>{
   await actor(OWNER);let r=await read();assert.equal(r.revision,0);assert.deepEqual(r.cycles,[]);assert.deepEqual(r.entries,[]);assert.equal(r.capabilities.customerRead,true);assert.equal(r.wireCar.moneyUnit,'KRW');assert.equal(r.wireCar.buy,12000000);assert.equal(r.wireCar.customCosts[CUSTOM],1234);assert.equal(r.wireCar.customCostLabels[CUSTOM],'사용자 실제항목');assert(!JSON.stringify(r).includes('DO_NOT_EXPOSE_CUSTOMER'));assert(!Object.hasOwn(r.wireCar,'vehicleMemo'));assert.deepEqual((await list()).items,[]);assert.deepEqual(await counts(),{vehicles:0,entries:0,audit:0,requests:0});
  });
  await group('owner/admin/accountant access is server-authoritative; peers, other companies and shares remain denied',async()=>{
   for(const who of[OWNER,ADMIN,ACCOUNTANT]){await actor(who);const r=await read();assert.equal(r.capabilities.canWrite,true);assert.equal(r.capabilities.customerRead,who===OWNER);}
   for(const who of[UPLOADER,RECIPIENT,INACTIVE]){await actor(who);await deny(()=>read());}
   await actor(OWNER);await deny(()=>read({company:FOREIGN}));await deny(()=>read({owner:UPLOADER}),['42501']);await deny(()=>read({car:'missing'}),['22023']);
   const grant=await f.call('grant',{permission:'all',email:RECIPIENT+'@example.invalid'});await actor(RECIPIENT);await f.reply(grant.invitationId,grant.version);assert.equal((await f.call('read')).canEdit,true);await deny(()=>read());await deny(()=>write({action:'start_cycle',cycle:{id:randomUUID(),status:'open',details:cycleDetails()}}));
  });
  await group('first cycle writes once, has separate identity and exact request retry survives a lost ACK',async()=>{
   await actor(OWNER);const id=randomUUID(),request=randomUUID(),command={action:'start_cycle',cycle:{id,status:'open',details:cycleDetails()}};
   const r=await write(command,{request});cycle=id;assert.equal(r.revision,1);assert.equal(r.currentCycleId,id);assert(r.vehicleEntityId);assert.equal(r.cycles[0].sequence,1);assert.deepEqual(await write(command,{request}),r);
   await deny(()=>write({...command,cycle:{...command.cycle,details:{...cycleDetails(),notes:'different'}}},{request}),['22023']);await deny(()=>write({action:'cancel_cycle',id,reason:'stale',date:'2026-11-01'},{revision:0}),['40001']);assert.equal((await read()).revision,1);
  });
  await group('blank/zero remain different and unsafe money/date/key coercions roll back every row and request',async()=>{
   await actor(OWNER);const blank=entry('cash','planned',{direction:'in',purpose:'sale'});await save(blank);assert.equal((await read()).entries.find(e=>e.id===blank.id).amountWon,null);
   const zero=entry('cash','confirmed',{direction:'in',purpose:'sale'},{amountWon:0,effectiveDate:'2026-11-01'});await save(zero);assert.equal((await read()).entries.find(e=>e.id===zero.id).amountWon,0);
   for(const bad of[{amountWon:'1'},{amountWon:1.25},{amountWon:-1},{amountWon:9000000000000001},{effectiveDate:'2026-02-30'},{effectiveDate:'2026-1-01'},{details:{direction:'in',purpose:'sale',rrn:'forbidden'}},{status:'reversed'},{extra:true}]){const before=await counts();await actor(OWNER);await deny(()=>save({...entry('cash','planned',{direction:'in',purpose:'sale'}),...bad}),['22023']);assert.deepEqual(await counts(),before);}
   await actor(OWNER);await deny(()=>save(entry('cash','confirmed',{direction:'in',purpose:'sale'},{amountWon:100})),['22023']);
  });
  await group('accrued unpaid costs and legacy replacements preserve separate cash and enforce one known source',async()=>{
   await actor(OWNER);cost=entry('cost','incurred',{category:'repair',label:'미지급 정비비'},{amountWon:1300000});await save(cost);const r=await read();assert(r.entries.some(e=>e.id===cost.id));assert(!r.entries.some(e=>e.kind==='cash'&&e.details.purpose==='cost'));
   await save(entry('cost','incurred',{category:'bodywork',label:'기존 판금 대체',sourceCostKey:'bodywork'},{amountWon:110000}));
   await save(entry('cost','incurred',{category:'custom',label:'사용자 추가항목 대체',sourceCostKey:CUSTOM},{amountWon:1500}));await save(entry('cost','incurred',{category:'refund',label:'사용자 기존항목 환급',refundOf:'legacy:'+CUSTOM},{amountWon:-100}));
   await deny(()=>save(entry('cost','incurred',{category:'bodywork',label:'중복',sourceCostKey:'bodywork'},{amountWon:110001})),['22023']);await deny(()=>save(entry('cost','incurred',{category:'repair',label:'없는 원본',sourceCostKey:'notKnown'},{amountWon:1})),['22023']);
  });
  await group('partial confirmed cash does not complete delivery, title transfer or finance repayment',async()=>{
   await actor(OWNER);await save(entry('cash','confirmed',{direction:'in',purpose:'sale'},{amountWon:1000000,effectiveDate:'2026-11-02'}));await save(entry('cash','planned',{direction:'in',purpose:'sale'},{amountWon:32500000,dueDate:'2026-11-10'}));
   await save(entry('transfer','not_sent',{agency:'합성 이전대행'}));await save(entry('document','received',{documentType:'registration',label:'접수했지만 내용 미확인'}));const r=await read();assert.equal(r.entries.find(e=>e.kind==='transfer').status,'not_sent');assert.equal(r.entries.find(e=>e.kind==='document').status,'received');
  });
  await group('loan execution, partial repayment and rate events use same-cycle references and prevent overpayment',async()=>{
   await actor(OWNER);loan=entry('loan','active',{lender:'합성 금융사',annualRate:10,startDate:'2026-11-01',maturityDate:'2026-12-01'},{amountWon:20000000});await save(loan);
   await deny(()=>save(entry('loan','active',{lender:'정밀도 초과',annualRate:8.123456},{amountWon:1})),['22023']);await deny(()=>send({action:'update_cycle',id:cycle,status:'open',details:{...cycleDetails(),ownershipPercent:50.123456}}),['22023']);
   await save(entry('loan','unconfirmed',{lender:'소수4자리 경계',annualRate:8.1234}));await send({action:'update_cycle',id:cycle,status:'open',details:{...cycleDetails(),ownershipPercent:50.1234}});
   await save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'repay'},{amountWon:5000000,effectiveDate:'2026-11-05'}));await save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'rate',annualRate:8},{effectiveDate:'2026-11-06'}));
   const before=await read();await deny(()=>save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'repay'},{amountWon:15000001,effectiveDate:'2026-11-06'})),['22023']);assert.equal((await read()).revision,before.revision);
   await deny(()=>save(entry('loan_event','confirmed',{loanId:randomUUID(),eventType:'repay'},{amountWon:1,effectiveDate:'2026-11-06'})),['22023']);await deny(()=>save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'rate',annualRate:101},{effectiveDate:'2026-11-06'})),['22023']);await deny(()=>save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'repay'},{amountWon:1,effectiveDate:'2026-10-31'})),['22023']);
   await save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'interest_invoice',periodStart:'2026-11-01',periodEnd:'2026-11-06'},{amountWon:27397,effectiveDate:'2026-11-06'}));
   await deny(()=>save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'interest_invoice',periodStart:'2026-11-06',periodEnd:'2026-11-01'},{amountWon:1,effectiveDate:'2026-11-06'})),['22023']);
  });
  await group('confirmed facts are immutable; explicit reversals retain original value/date with append-only provenance',async()=>{
   await actor(OWNER);const fact=entry('cash','confirmed',{direction:'in',purpose:'sale'},{amountWon:123,effectiveDate:'2026-11-02'});await save(fact);await deny(()=>save({...fact,amountWon:124}),['22023']);await deny(()=>save({...cost,amountWon:1300001}),['22023']);
   await send({action:'reverse_entry',id:fact.id,reason:'합성 중복입금 확인',date:'2026-11-03'});const e=(await read()).entries.find(e=>e.id===fact.id);assert.equal(e.amountWon,123);assert.equal(e.effectiveDate,'2026-11-02');assert.equal(e.status,'reversed');assert.equal(e.details.reversedBy,OWNER);assert.equal(e.details.reversalDate,'2026-11-03');await deny(()=>save(fact),['22023']);
   await deny(()=>send({action:'reverse_entry',id:loan.id,reason:'참조있음',date:'2026-11-06'}),['22023']);
  });
  await group('cost credits require real same-cycle sources, bound totals and stay independent of bank refund cash',async()=>{
   await actor(OWNER);await save(entry('cost','incurred',{category:'refund',label:'정비 환급',refundOf:cost.id},{amountWon:-100000}));await save(entry('cost','incurred',{category:'refund',label:'기존 판금 환급',refundOf:'legacy:bodywork'},{amountWon:-20000}));
   for(const details of[{refundOf:randomUUID()},{refundOf:'legacy:missing'},{}])await deny(()=>save(entry('cost','incurred',{category:'refund',label:'잘못된 환급',...details},{amountWon:-1})),['22023']);
   await deny(()=>save(entry('cost','incurred',{category:'refund',label:'초과환급',refundOf:cost.id},{amountWon:-1200001})),['22023']);await save(entry('cash','confirmed',{direction:'in',purpose:'cost_refund'},{amountWon:100000,effectiveDate:'2026-11-07'}));
   await deny(()=>save(entry('cost','incurred',{category:'refund',label:'원가대체중복',refundOf:cost.id,sourceCostKey:'bodywork'},{amountWon:-1})),['22023']);await deny(()=>save(entry('cost','incurred',{category:'refund',label:'환급부호오류',refundOf:cost.id},{amountWon:1})),['22023']);await deny(()=>save(entry('cash','planned',{direction:'out',purpose:'cost',referenceId:loan.id})),['22023']);
  });
  await group('owner CRM stays private in direct read, company worklists and audit; nonowners cannot reclassify it',async()=>{
   await actor(OWNER);lead=entry('lead','inquiry',{name:'PRIVATE_LEAD_SENTINEL',phone:'01000000000',tradeIn:false,nextAction:'전화'});await save(lead);const contact=entry('task','todo',{category:'contact',title:'PRIVATE_CONTACT_SENTINEL',leadId:lead.id},{dueDate:'2026-11-08'});await save(contact);await save(entry('task','todo',{category:'delivery',title:'PRIVATE_DELIVERY_SENTINEL',handoverItems:'고객 약속'}));assert.equal((await list({query:'PRIVATE_LEAD_SENTINEL'})).items.length,1);
   for(const who of[ADMIN,ACCOUNTANT]){await actor(who);const r=await read();assert.equal(r.capabilities.customerWrite,false);assert(!JSON.stringify(r).includes('PRIVATE_LEAD_SENTINEL'));assert(!JSON.stringify(r).includes('PRIVATE_CONTACT_SENTINEL'));assert(!JSON.stringify(r).includes('PRIVATE_DELIVERY_SENTINEL'));assert(!JSON.stringify(await list({scope:'company'})).includes('PRIVATE_LEAD_SENTINEL'));assert.equal((await list({scope:'company',query:'PRIVATE_LEAD_SENTINEL'})).items.length,0);await deny(()=>save({...contact,details:{category:'other',title:'attempt reclassification'}}));await deny(()=>save(entry('task','todo',{category:'other',title:'guess lead ref',leadId:lead.id})));
    await save(entry('task','todo',{category:'verification',title:'권한 있는 서류 확인'}));}
   await actor(OWNER);assert(JSON.stringify(await read()).includes('PRIVATE_LEAD_SENTINEL'));
  });
  await group('closing/cancelling and resale create distinct cycles without settling old money or erasing facts',async()=>{
   await actor(OWNER);await send({action:'update_cycle',id:cycle,status:'closed',details:{...cycleDetails(),saleAmountWon:33500000,saleDate:'2026-11-07',settlementStatus:'provisional'}});let r=await read();assert.equal(r.currentCycleId,null);assert(r.entries.some(e=>e.kind==='loan'&&e.status==='active'));assert(r.entries.some(e=>e.kind==='transfer'&&e.status==='not_sent'));
   const oldCycle=cycle,newCycle=await start();cycle=newCycle.id;assert.equal(newCycle.result.cycles.at(-1).sequence,2);assert(newCycle.result.entries.some(e=>e.cycleId===oldCycle));await deny(()=>save(entry('loan_event','confirmed',{loanId:loan.id,eventType:'repay'},{amountWon:1,effectiveDate:'2026-11-08'})),['22023']);
   await send({action:'cancel_cycle',id:cycle,reason:'합성 매입취소',date:'2026-11-08'});r=await read();assert.equal(r.cycles.at(-1).status,'cancelled');assert(r.entries.some(e=>e.id===loan.id));cycle=(await start()).id;
  });
  await group('document/link/assignee/completion rules validate metadata without creating fake confirmations',async()=>{
   await actor(OWNER);await deny(()=>save(entry('document','done',{documentType:'registration',label:'날짜없음'})),['22023']);await deny(()=>save(entry('task','todo',{category:'other',title:'외부담당',assigneeId:RECIPIENT})),['22023']);await deny(()=>save(entry('document','received',{documentType:'registration',label:'없는 첨부',evidenceMediaId:'not-real'})),['22023']);await deny(()=>save(entry('appraisal','draft',{comparisonUrls:['javascript:alert(1)']})),['22023']);
   await save(entry('document','done',{documentType:'registration',label:'확인 완료'},{effectiveDate:'2026-11-08'}));await save(entry('appraisal','reviewed',{saleEstimateWon:33500000,estimatedCostsWon:1300000,targetProfitWon:2000000,reserveWon:500000,comparisonUrls:['https://example.invalid/car'],checkedDate:'2026-11-08'}));
  });
  await group('preferences have per-actor CAS, idempotency, strict thresholds and no default read writes',async()=>{
   await actor(OWNER);const initial=await prefs();assert.equal(initial.revision,0);assert.equal(initial.payload.noInquiryDays,7);const payload={...initial.payload,noInquiryDays:10},request=randomUUID();const ack=await prefs('save',payload,0,request);assert.deepEqual(await prefs('save',payload,0,request),ack);await deny(()=>prefs('save',payload,0,randomUUID()),['40001']);await deny(()=>prefs('save',{...payload,noInquiryDays:0},1,randomUUID()),['22023']);await deny(()=>prefs('save',{...payload,hidden:true},1,randomUUID()),['22023']);await actor(ACCOUNTANT);assert.equal((await prefs()).revision,0);assert.equal((await prefs()).payload.noInquiryDays,7);
  });
  await group('worklist paginates only persisted authorized cars, uses plate text only for search and exposes no shared records',async()=>{
   await actor(OWNER);const first=await list({size:1});assert.equal(first.items.length,1);assert.equal(first.page,1);assert.equal((await list({query:'no-match'})).items.length,0);assert.equal((await list({query:'12가'})).items[0].carId,ID);assert.equal((await list({page:2,size:1})).items.length,0);await deny(()=>list({scope:'company'}));await deny(()=>list({size:51}),['22023']);await actor(ACCOUNTANT);assert((await list({scope:'company'})).items.length>0);await actor(RECIPIENT);await deny(()=>list({company:COMPANY}));
  });
  await group('same ID cannot be reassigned, plate changes retain all history and duplicate vehicle references fail closed',async()=>{
   await privileged("update public.zc_datasets set payload=jsonb_set(payload,'{0,plate}','\"99나9999\"')where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER]);await actor(OWNER);assert.equal((await read()).wireCar.plate,'99나9999');assert((await read()).cycles.length>=3);
   await deny(()=>privileged("insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision)values($1,$2,'cars',$3,1)",[COMPANY,UPLOADER,JSON.stringify([{id:ID,model:'ambiguous'}])]),['22023']);await actor(OWNER);assert.equal((await read()).wireCar.plate,'99나9999');
  });
  await group('sparse company worklists have a real 30-row boundary and never materialize untouched cars',async()=>{
   const many=Array.from({length:32},(_,i)=>({id:'biz-page-'+i,model:'분리 보관 차량 '+i,plate:'BIZ-PAGE-'+i,moneyUnit:'KRW',buy:null,status:'판매중'}));
   await privileged("update public.zc_datasets set payload=payload||$3::jsonb where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER,JSON.stringify(many)]);await actor(OWNER);assert.equal((await list({query:'BIZ-PAGE-'})).items.length,0);
   for(const car of many)await start(cycleDetails(),{car:car.id});
   const first=await list({query:'BIZ-PAGE-'}),second=await list({query:'BIZ-PAGE-',page:2});assert.equal(first.items.length,30);assert.equal(first.hasMore,true);assert.equal(second.items.length,2);assert.equal(second.hasMore,false);assert.equal(new Set([...first.items,...second.items].map(r=>r.carId)).size,32);
  });
  await group('evidence reserves safe immutable paths without a bucket and retries only the same actor/entry/file',async()=>{
   await actor(OWNER);evidenceDoc=entry('document','received',{documentType:'registration',label:'별도 첨부 문서'});await save(evidenceDoc);const id=randomUUID(),meta={name:'합성 등록증.png',mime:'image/png',size:123};lease=await evidence('reserve',id,evidenceDoc.id,meta);
   assert.equal(lease.state,'pending');assert.equal(lease.bucket,'snote-business-private');assert(lease.path.startsWith(COMPANY+'/'+OWNER+'/'));assert(lease.path.endsWith('/'+id+'.png'));assert(!lease.path.includes(ID));assert(!lease.path.includes('합성'));assert.deepEqual(await evidence('reserve',id,evidenceDoc.id,meta),lease);assert.equal((await evidence('read',id,evidenceDoc.id)).id,id);assert.deepEqual((await evidence('read',null,evidenceDoc.id)).items,[]);
   await deny(()=>evidence('reserve',id,evidenceDoc.id,{...meta,size:124}),['22023']);await deny(()=>evidence('reserve',randomUUID(),evidenceDoc.id,{...meta,mime:'text/html'}),['22023']);await deny(()=>evidence('reserve',randomUUID(),evidenceDoc.id,{...meta,size:10485761}),['22023']);await deny(()=>evidence('reserve',randomUUID(),randomUUID(),meta),['22023']);
  });
  await group('storage upload RLS is bound to one pending actor lease; path guessing, metadata-only completion and overwrite fail',async()=>{
   await actor(OWNER);await deny(()=>evidence('complete',lease.id,evidenceDoc.id),['22023']);
   for(const who of[UPLOADER,RECIPIENT,ACCOUNTANT]){await actor(who);await deny(()=>db.query('insert into storage.objects(bucket_id,name,metadata)values($1,$2,$3)',['snote-business-private',lease.path,{size:123,mimetype:'image/png'}]));}
   await actor(OWNER);await deny(()=>db.query('insert into storage.objects(bucket_id,name,metadata)values($1,$2,$3)',['snote-business-private',lease.path.replace(lease.id,randomUUID()),{size:123,mimetype:'image/png'}]));
   await db.query('insert into storage.objects(bucket_id,name,metadata)values($1,$2,$3)',['snote-business-private',lease.path,{size:122,mimetype:'image/png'}]);await deny(()=>evidence('complete',lease.id,evidenceDoc.id),['22023']);
   await privileged('update storage.objects set metadata=$3 where bucket_id=$1 and name=$2',['snote-business-private',lease.path,{size:123,mimetype:'image/jpeg'}]);await actor(OWNER);await deny(()=>evidence('complete',lease.id,evidenceDoc.id),['22023']);await privileged('update storage.objects set metadata=$3 where bucket_id=$1 and name=$2',['snote-business-private',lease.path,{size:123,mimetype:'image/png'}]);
   await actor(OWNER);assert.equal((await db.query('update storage.objects set metadata=$3 where bucket_id=$1 and name=$2 returning name',['snote-business-private',lease.path,{size:9,mimetype:'image/png'}])).rows.length,0);await deny(()=>db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',['snote-business-private',lease.path]));
  });
  await group('verified completion is idempotent, audited and usable as a real scoped attachment reference',async()=>{
   await actor(OWNER);const completed=await evidence('complete',lease.id,evidenceDoc.id);assert.equal(completed.state,'ready');assert(completed.completedAt);assert.deepEqual(await evidence('complete',lease.id,evidenceDoc.id),completed);assert.equal((await evidence('read',null,evidenceDoc.id)).items.length,1);await save({...evidenceDoc,details:{...evidenceDoc.details,evidenceMediaId:lease.id}});
   for(const who of[OWNER,ADMIN,ACCOUNTANT]){await actor(who);assert.equal((await evidence('read',lease.id,evidenceDoc.id)).id,lease.id);assert.equal((await db.query('select name from storage.objects where bucket_id=$1 and name=$2',['snote-business-private',lease.path])).rows.length,1);}
   await actor(RECIPIENT);await deny(()=>evidence('read',lease.id,evidenceDoc.id));assert.equal((await db.query('select name from storage.objects where bucket_id=$1 and name=$2',['snote-business-private',lease.path])).rows.length,0);
   await actor(OWNER);assert.equal((await read()).audit.filter(a=>a.operation==='evidence_complete'&&a.entityId===evidenceDoc.id).length,1);
  });
  await group('CRM files remain owner-only in APIs, storage SELECT and references even for a same-company administrator',async()=>{
   await actor(OWNER);const meta={name:'비공개 상담.pdf',mime:'application/pdf',size:456};const privateLease=await evidence('reserve',randomUUID(),lead.id,meta);await db.query('insert into storage.objects(bucket_id,name,metadata)values($1,$2,$3)',['snote-business-private',privateLease.path,{size:456,mimetype:'application/pdf'}]);await evidence('complete',privateLease.id,lead.id);
   for(const who of[ADMIN,ACCOUNTANT]){await actor(who);await deny(()=>evidence('read',privateLease.id,lead.id));await deny(()=>evidence('reserve',randomUUID(),lead.id,meta));assert.equal((await db.query('select name from storage.objects where bucket_id=$1 and name=$2',['snote-business-private',privateLease.path])).rows.length,0);await deny(()=>save({...evidenceDoc,details:{...evidenceDoc.details,evidenceMediaId:privateLease.id}}),['22023']);assert(!JSON.stringify(await read()).includes('비공개 상담.pdf'));}
  });
  await group('pending expiry and membership revocation invalidate file capabilities without deleting any original object',async()=>{
   await actor(OWNER);const pending=await evidence('reserve',randomUUID(),evidenceDoc.id,{name:'기간만료.jpg',mime:'image/jpeg',size:10});await privileged("update snote_business_private.evidence set created_at=now()-interval'2hours'where id=$1",[pending.id]);await actor(OWNER);await deny(()=>evidence('reserve',pending.id,evidenceDoc.id,{name:'기간만료.jpg',mime:'image/jpeg',size:10}),['22023']);await deny(()=>db.query('insert into storage.objects(bucket_id,name,metadata)values($1,$2,$3)',['snote-business-private',pending.path,{size:10,mimetype:'image/jpeg'}]));
   await privileged('update public.zc_members set active=false where user_id=$1',[OWNER]);await actor(OWNER);assert.equal((await db.query('select name from storage.objects where bucket_id=$1 and name=$2',['snote-business-private',lease.path])).rows.length,0);await deny(()=>evidence('read',lease.id,evidenceDoc.id));await privileged('update public.zc_members set active=true where user_id=$1',[OWNER]);
  });
  await group('membership and role are rechecked after lock waiting; unconfirmed/banned/anonymous actors never read',async()=>{
   const orig=(await privileged("select pg_get_functiondef('snote_private.recycle_lock(uuid)'::regprocedure)as body")).rows[0].body;
   await privileged(`create or replace function snote_private.recycle_lock(p_company uuid)returns void language plpgsql set search_path=''as $$begin if auth.uid()='${ADMIN}'::uuid then update public.zc_members set active=false where user_id=auth.uid();end if;end$$`);
   try{await actor(ADMIN);await deny(()=>read());}finally{await privileged(orig);await privileged('update public.zc_members set active=true where user_id=$1',[ADMIN]);}
   await privileged("update auth.users set banned_until=now()+interval'1day'where id=$1",[OWNER]);await actor(OWNER);await deny(()=>read());await privileged('update auth.users set banned_until=null where id=$1',[OWNER]);await actor(OWNER,'authenticated',true);await deny(()=>read());for(const role of['anon','service_role']){await actor(OWNER,role);await deny(()=>read());}
  });
  await group('all private tables stay closed under accidental SELECT grants; wrappers/ACLs and audit immutability are enforced',async()=>{
   await privileged('grant select on all tables in schema snote_business_private to authenticated');await actor(OWNER);for(const table of['vehicles','cycles','entries','audit','requests','preferences','evidence'])assert.equal((await db.query('select * from snote_business_private.'+table)).rows.length,0);assert((await read()).revision>0);await privileged('revoke select on all tables in schema snote_business_private from authenticated');
   await assert.rejects(()=>db.exec("update snote_business_private.audit set operation='tamper'"),e=>e.code==='42501');await assert.rejects(()=>db.exec('delete from snote_business_private.requests'),e=>e.code==='42501');
   const defs=(await privileged("select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_business_private'or(n.nspname='public'and p.proname like'snote_business_%')")).rows;for(const d of defs){assert(d.proconfig.includes('search_path=""'));if(d.nspname==='public')assert.equal(d.prosecdef,false);assert(!d.acl?.includes('anon=X'));assert(!d.acl?.startsWith('{=X'));}
  });
  await group('reapplying additive migration preserves new records and every untouched legacy financial/customer field',async()=>{
   await actor(OWNER);const before=await read();await db.exec('reset role');const snap=(await db.query('select * from snote_business_private.requests order by actor_id,request_id')).rows;await db.exec(SQL());await actor(OWNER);assert.deepEqual(await read(),before);await privileged('select 1');assert.deepEqual((await db.query('select * from snote_business_private.requests order by actor_id,request_id')).rows,snap);const legacy=await f.state();assert.deepEqual(legacy.payload[0].costs,original.payload[0].costs);assert.deepEqual(legacy.payload[0].incomeSettlement,original.payload[0].incomeSettlement);assert.deepEqual(legacy.payload[1],original.payload[1]);
  });
  console.log(JSON.stringify({passed,failed}));assert.equal(failed,0);
 }finally{await db.close();}
}
if(require.main===module)run().catch(e=>{console.error(e.message,e.code,e.where);process.exitCode=1;});
module.exports={createBusinessFixture,cycleDetails,FILE,SQL,COMPANY,FOREIGN,OWNER,RECIPIENT,UPLOADER,ADMIN,ACCOUNTANT,ID};
