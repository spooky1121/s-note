/* Business amounts are integer KRW. This model neither writes records nor changes the tax document. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root&&!root.SnoteBusinessFinance)root.SnoteBusinessFinance=api;})(typeof globalThis==='object'?globalThis:this,function(){'use strict';
 const DAY=86400000,DENOM=365000000n;
 const COST_KEYS=['bodywork','polish','performanceInspection','repair','advertising','purchaseFee','purchaseOther','acquisitionTax','incomeTax','inventoryInterest'];
 const TYPES=['direct','joint','consignment','brokerage'];
 const CASH_PURPOSES=['sale','purchase','cost','loan_draw','loan_repayment','loan_interest','transfer_deposit','transfer_refund','sale_refund','cost_refund','purchase_refund','other'];
 const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),own=(v,k)=>Object.prototype.hasOwnProperty.call(v||{},k);
 function fail(message,code='INVALID_DATA'){throw Object.assign(Error(message),{code});}
 function amount(value,{signed=false}={}){if(value==null)return null;if(!Number.isSafeInteger(value)||!signed&&value<0)fail('금액은 안전한 범위의 원 단위 정수로 확인해 주세요.');return Object.is(value,-0)?0:value;}
 function safe(value){const n=typeof value==='bigint'?value:BigInt(value);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))fail('금액 합계가 안전한 계산 범위를 초과합니다.');return Number(n);}
 function sum(values){return values.some(v=>v===null)?null:safe(values.reduce((n,v)=>n+BigInt(v),0n));}
 function minus(a,b){return a===null||b===null?null:safe(BigInt(a)-BigInt(b));}
 function date(value){if(value==null)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('날짜는 YYYY-MM-DD 형식으로 확인해 주세요.');const time=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)fail('실제 날짜를 확인해 주세요.');return value;}
 const time=value=>Date.parse(value+'T00:00:00Z'),iso=value=>new Date(value).toISOString().slice(0,10);
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 function rate(value){if(value==null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100||Math.abs(value*10000-Math.round(value*10000))>1e-7)fail('연이율은 0~100% 범위에서 소수 넷째 자리까지 확인해 주세요.');return Math.round(value*10000);}
 function round(n,d=DENOM){const sign=n<0n?-1n:1n;return safe(sign*((n*sign+d/2n)/d));}
 function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
 // Informational change detection only. This fingerprint never grants access or approves a write.
 function signature(v){let n=14695981039346656037n;for(const c of stable(v)){n^=BigInt(c.codePointAt(0));n=BigInt.asUintN(64,n*1099511628211n);}return 'bf1:'+n.toString(16).padStart(16,'0');}
 function unique(rows,label){if(!Array.isArray(rows))fail(label+' 형식을 확인해 주세요.');const map=new Map();for(const row of rows){if(!plain(row)||typeof row.id!=='string'||!row.id)fail(label+' 식별자를 확인해 주세요.');if(map.has(row.id)){if(stable(map.get(row.id))!==stable(row))fail('같은 식별자의 서로 다른 기록이 있습니다.','DUPLICATE_ID');continue;}map.set(row.id,row);}return [...map.values()];}
 function context(workspace,car,options={}){
  if(!plain(workspace)||workspace.apiVersion!==1)fail('차량 업무 자료 버전을 확인해 주세요.');
  if(['companyId','ownerId','carId'].some(key=>typeof workspace[key]!=='string'||!workspace[key]))fail('차량 업무 자료의 소속을 확인해 주세요.');
  if(car?.id!=null&&String(car.id)!==workspace.carId||car?.companyId&&car.companyId!==workspace.companyId)fail('차량과 업무 원장의 연결이 다릅니다.','SCOPE_MISMATCH');
  const cycles=unique(workspace.cycles,'거래'),entries=unique(workspace.entries,'거래 내역'),cycleIds=new Set(cycles.map(c=>c.id));
  for(const c of cycles)if(!['open','cancelled','closed'].includes(c.status)||!plain(c.details))fail('거래 상태를 확인해 주세요.');
  for(const e of entries){if(!cycleIds.has(e.cycleId)||typeof e.kind!=='string'||!plain(e.details))fail('거래 내역의 연결 정보를 확인해 주세요.');amount(e.amountWon,{signed:e.kind==='cost'});date(e.effectiveDate);date(e.dueDate);}
  return {workspace,cycles,entries,car:plain(car)?car:{},asOf:date(options.asOf??today())};
 }
 const notes=()=>{const warnings=[];return {warnings,warn(text){if(!warnings.includes(text))warnings.push(text);}};};
 function effectiveEntries(entries,warn){
  const byId=new Map(entries.map(e=>[e.id,e])),suppressed=new Set();
  for(const e of entries){const target=e.details?.reversalOf;if(!target||!['confirmed','incurred'].includes(e.status))continue;const original=byId.get(target);if(!original||original.kind!==e.kind||original.cycleId!==e.cycleId){warn('취소 기록의 원본 연결을 확인해 주세요.');suppressed.add(e.id);continue;}suppressed.add(original.id);suppressed.add(e.id);}
  return entries.filter(e=>!suppressed.has(e.id)&&!['reversed','void'].includes(e.status));
 }
 function snapshot(car={}){
  const read=value=>{try{return amount(value);}catch{return null;}},readDate=value=>{try{return date(value);}catch{return null;}};
  const map={},raw=plain(car.costs)?car.costs:null;let found=false;
  if(raw)for(const key of COST_KEYS)if(own(raw,key)){map[key]=read(raw[key]);found=true;}
  if(Array.isArray(car.repairItems)){map.repair=sum(car.repairItems.map(item=>read(item?.amount)));found=true;}
  if(plain(car.customCosts))for(const[key,value]of Object.entries(car.customCosts)){map[key]=read(value);found=true;}
  // Returned-to-stock cars may retain an older soldPrice; it is not a new sale fact.
  const sold=car.status==='판매완료';
  const result={purchaseAmountWon:read(car.buy),expectedSaleWon:read(car.sell),saleAmountWon:sold?read(car.soldPrice):null,purchaseDate:readDate(car.purchaseAt),saleDate:sold?readDate(car.soldAt):null,legacyCosts:found?map:null,legacyCostsWon:found?sum(Object.values(map)):null,legacyInterestWon:found&&own(map,'inventoryInterest')?map.inventoryInterest:null};
  return {...result,sourceSignature:signature(result)};
 }
 function appraisal(input={}){
  if(own(input,'expectedSaleWon')&&own(input,'saleEstimateWon')&&input.expectedSaleWon!==input.saleEstimateWon)fail('매입 검토의 예상 판매금액이 서로 다릅니다.');
  const keys=['expectedSaleWon','estimatedCostsWon','targetProfitWon','reserveWon'],values=keys.map(k=>amount(k==='expectedSaleWon'?input.expectedSaleWon??input.saleEstimateWon:input[k])),missing=keys.filter((_,i)=>values[i]===null);
  return {maxPurchaseWon:missing.length?null:safe(BigInt(values[0])-BigInt(values[1])-BigInt(values[2])-BigInt(values[3])),complete:!missing.length,missing,warnings:missing.length?['매입 상한가 계산에 필요한 금액을 입력해 주세요.']:[]};
 }
 function loanResult(ctx,loan,all){
  const n=notes(),d=loan.details,events=effectiveEntries(all.filter(e=>e.kind==='loan_event'&&e.details.loanId===loan.id),n.warn),start=date(loan.effectiveDate??d.startDate),end=ctx.asOf,principal=amount(loan.amountWon),initialRate=rate(d.annualRate),maturityDate=date(d.maturityDate);
  let balance=principal,valid=loan.status==='active'&&principal!==null&&start!==null,interestKnown=valid,activeRate=initialRate,numerator=0n;
  const segments=[],futureEvents=[],groups=new Map(),invoices=[],fees=[];
  if(loan.status!=='active')n.warn('대출 실행 여부를 확인해 주세요.');if(principal===null)n.warn('대출 실행원금이 미확인입니다.');if(!start)n.warn('실제 대출 실행일이 미확인입니다.');
  if(start&&d.startDate&&date(d.startDate)!==start){valid=false;interestKnown=false;n.warn('대출 실행일이 서로 다릅니다.');}
  for(const e of events){if(e.status==='planned'){futureEvents.push(e);continue;}if(e.status!=='confirmed'){n.warn('미확정 대출 내역이 있습니다.');continue;}
   const when=date(e.effectiveDate);if(!when){valid=false;interestKnown=false;n.warn('확정 대출 내역의 적용일이 미확인입니다.');continue;}if(when>end){futureEvents.push(e);continue;}
   if(start&&when<start){valid=false;interestKnown=false;n.warn('대출 실행 전 금융 내역이 있습니다.');continue;}
   const type=e.details.eventType;if(type==='interest_invoice'){invoices.push(e);continue;}if(type==='fee'){fees.push(e);continue;}
   if(!['draw','repay','rate'].includes(type))fail('대출 내역 종류를 확인해 주세요.');const group=groups.get(when)||[];group.push(e);groups.set(when,group);
  }
  if(start&&start>end){futureEvents.unshift(loan);valid=false;interestKnown=false;n.warn('아직 대출 실행일이 되지 않았습니다.');}
  let cursor=start;
  function accrue(until){if(!cursor||until<=cursor)return;if(balance===null||activeRate===null){if(balance!==0)interestKnown=false;}else{const days=(time(until)-time(cursor))/DAY;segments.push({start:cursor,end:until,days,principalWon:balance,annualRate:activeRate/10000});numerator+=BigInt(balance)*BigInt(activeRate)*BigInt(days);}cursor=until;}
  // Accrue [cursor, event date), then net same-day principal movements before the next day.
  // Rate conflicts have no defensible UUID ordering and therefore remain unknown.
  if(valid)for(const[when,group]of [...groups].sort(([a],[b])=>a.localeCompare(b))){accrue(when);const rates=group.filter(e=>e.details.eventType==='rate').map(e=>rate(e.details.annualRate)),uniqueRates=[...new Set(rates)];
   if(uniqueRates.length>1||rates.some(v=>v===null)){activeRate=null;interestKnown=false;n.warn('같은 날의 금리 변경 또는 미입력 금리를 확인해 주세요.');}else if(rates.length)activeRate=rates[0];
   const movements=group.filter(e=>e.details.eventType!=='rate');if(movements.some(e=>e.amountWon==null)){balance=null;valid=false;interestKnown=false;n.warn('원금 변동액이 미확인입니다.');}
   else if(balance!==null){balance=safe(movements.reduce((v,e)=>v+BigInt(e.amountWon)*(e.details.eventType==='repay'?-1n:1n),BigInt(balance)));if(balance<0){balance=null;valid=false;interestKnown=false;n.warn('상환원금이 대출잔액을 초과합니다.');}}
  }
  if(cursor&&start<=end)accrue(end);if(initialRate===null&&segments.some(s=>s.principalWon>0)&&!groups.has(start)){interestKnown=false;n.warn('대출 연이율이 미확인입니다.');}
  if(!valid)interestKnown=false;if(!interestKnown&&activeRate===null)n.warn('대출 연이율이 미확인입니다.');const estimatedInterestWon=interestKnown?round(numerator):null;
  const actualInterestWon=sum(invoices.map(e=>amount(e.amountWon))),feesWon=sum(fees.map(e=>amount(e.amountWon)));
  let coverageKnown=true,unbilledEstimatedInterestWon=estimatedInterestWon,managementInterestWon=estimatedInterestWon;
  if(invoices.length){const ranges=[];for(const e of invoices){const a=date(e.details.periodStart),b=date(e.details.periodEnd);if(!a||!b||!start||a<start||a>=b||b>end){coverageKnown=false;continue;}ranges.push([a,b]);}
   ranges.sort(([a],[b])=>a.localeCompare(b));if(ranges.some((r,i)=>i>0&&r[0]<ranges[i-1][1]))coverageKnown=false;
   // Remove billed time ranges from the unrounded numerator, rather than subtracting rounded periods.
   if(coverageKnown&&estimatedInterestWon!==null){let covered=0n;for(const s of segments)for(const[a,b]of ranges){const from=Math.max(time(a),time(s.start)),to=Math.min(time(b),time(s.end));if(to>from)covered+=BigInt(s.principalWon)*BigInt(Math.round(s.annualRate*10000))*BigInt((to-from)/DAY);}unbilledEstimatedInterestWon=round(numerator-covered);managementInterestWon=sum([actualInterestWon,unbilledEstimatedInterestWon]);}
   else{unbilledEstimatedInterestWon=null;managementInterestWon=actualInterestWon;n.warn('실제 청구 이자의 산정기간을 확인해 주세요. 미청구 추정 이자와 합산하지 않았습니다.');}
  }
  if(actualInterestWon===null||feesWon===null)n.warn('확정 이자 또는 수수료 금액이 미확인입니다.');
  return {id:loan.id,cycleId:loan.cycleId,lender:String(d.lender||''),startDate:start,maturityDate,asOf:end,originalPrincipalWon:principal,principalOutstandingWon:valid?balance:null,estimatedInterestWon,actualInterestWon,unbilledEstimatedInterestWon,managementInterestWon,feesWon,coverageKnown,complete:valid&&interestKnown&&coverageKnown&&actualInterestWon!==null&&feesWon!==null&&!n.warnings.length,warnings:n.warnings,segments,futureEvents};
 }
 function loanSummary(workspace,loanId,options={}){const ctx=context(workspace,{},options),loan=ctx.entries.find(e=>e.kind==='loan'&&e.id===(plain(loanId)?loanId.id:loanId));if(!loan)fail('대출 원본을 확인해 주세요.');return loanResult(ctx,loan,ctx.entries.filter(e=>e.cycleId===loan.cycleId));}
 function cashResult(entries,asOf){
  const n=notes(),confirmed=[],planned=[],purposeCounts=Object.fromEntries(CASH_PURPOSES.map(p=>[p,0]));let unknown=false;
  for(const e of effectiveEntries(entries.filter(e=>e.kind==='cash'),n.warn)){
   const d=e.details;if(!['in','out'].includes(d.direction)||!CASH_PURPOSES.includes(d.purpose))fail('입출금 방향과 용도를 확인해 주세요.');
   const item={id:e.id,purpose:d.purpose,direction:d.direction,amountWon:amount(e.amountWon),effectiveDate:date(e.effectiveDate),dueDate:date(e.dueDate),referenceId:d.referenceId??null};
   if(e.status==='planned'){planned.push(item);continue;}if(e.status!=='confirmed')continue;
   if(item.effectiveDate&&item.effectiveDate>asOf)continue;purposeCounts[item.purpose]++;
   if(!item.effectiveDate||item.amountWon===null){unknown=true;n.warn('확정 입출금의 금액 또는 적용일이 미확인입니다.');continue;}confirmed.push(item);
  }
  const total=(rows,direction,purposes)=>sum(rows.filter(e=>(!direction||e.direction===direction)&&(!purposes||purposes.includes(e.purpose))).map(e=>e.amountWon));
  const net=purposes=>sum(confirmed.filter(e=>purposes.includes(e.purpose)).map(e=>e.amountWon*(e.direction==='in'?1:-1)));
  const confirmedInWon=unknown?null:total(confirmed,'in'),confirmedOutWon=unknown?null:total(confirmed,'out');
  // Empty sums describe the registered ledger only; they never establish that
  // historical payments, receipts or the owner's actual capital were zero.
  const confirmedCount=Object.values(purposeCounts).reduce((a,b)=>a+b,0),cash={confirmedInWon,confirmedOutWon,netWon:minus(confirmedInWon,confirmedOutWon),plannedInWon:total(planned,'in'),plannedOutWon:total(planned,'out'),saleReceivedWon:unknown?null:net(['sale','sale_refund']),purchasePaidWon:unknown?null:-net(['purchase','purchase_refund']),costPaidWon:unknown?null:-net(['cost','cost_refund']),loanInterestPaidWon:unknown?null:-net(['loan_interest']),transferDepositBalanceWon:unknown?null:net(['transfer_deposit','transfer_refund']),confirmed,planned,basis:'registered_confirmed_records',basisLabel:'등록된 확정 입출금 내역 기준',history:{confirmedCount,hasConfirmedRecords:confirmedCount>0,purposeCounts},complete:!unknown&&!n.warnings.length,warnings:n.warnings};
  const basis=cashBasis(cash,['purchase','purchase_refund','cost','cost_refund','loan_interest','loan_draw','loan_repayment','sale','sale_refund']);
  const beforeSaleWon=basis==='registered_confirmed_records'?sum([cash.purchasePaidWon,cash.costPaidWon,cash.loanInterestPaidWon,-net(['loan_draw','loan_repayment'])]):null;
  cash.ownerFunding={beforeSaleWon,afterSaleWon:minus(beforeSaleWon,cash.saleReceivedWon),basis,complete:false,labels:{beforeSale:'등록 자금 투입액(판매 회수 전)',afterSale:'등록 자금 잔액(판매 회수 반영)'}};
  return cash;
 }
 function cashBasis(cash,purposes){return !cash.complete?'unknown':purposes.some(p=>cash.history.purposeCounts[p]>0)?'registered_confirmed_records':'unrecorded';}
 function basisLabel(basis){return basis==='registered_confirmed_records'?'등록된 확정 입출금 내역 기준':basis==='unknown'?'입출금 내역 확인 필요':'입출금 내역 미등록';}
 function costResult(ctx,cycle,entries,loans,cash){
  const n=notes(),d=cycle.details,map=plain(d.legacyCosts)?d.legacyCosts:null;
  let base=amount(d.legacyCostsWon),legacyInterest=amount(d.legacyInterestWon),confirmed=d.costsConfirmed===true;
  if(map)for(const value of Object.values(map))amount(value);
  if(base===null)n.warn('기존 원가 합계가 미확인입니다.');
  if(legacyInterest===null&&map&&own(map,'inventoryInterest'))legacyInterest=amount(map.inventoryInterest);
  if(legacyInterest===null&&map&&!own(map,'inventoryInterest')&&sum(Object.values(map))===base)legacyInterest=0;
  if(base===0&&legacyInterest===null)legacyInterest=0;
  if(map&&base!==null&&sum(Object.values(map))!==base)n.warn('기존 원가 항목과 합계가 다릅니다.');
  if(loans.length){if(legacyInterest===null){base=null;n.warn('새 대출 이자와 기존 이자의 중복 여부를 확인해 주세요.');}else base=minus(base,legacyInterest);}
  const costs=effectiveEntries(entries.filter(e=>e.kind==='cost'),n.warn).filter(e=>e.status!=='incurred'||!e.effectiveDate||e.effectiveDate<=ctx.asOf),byId=new Map(costs.map(e=>[e.id,e]));
  for(const e of costs){if(e.amountWon!==null&&e.amountWon<0){const ref=e.details.refundOf,original=typeof ref==='string'&&ref.startsWith('legacy:')?map?.[ref.slice(7)]:byId.get(ref)?.amountWon;if(!ref||original==null||original<0)fail('비용 환급의 원래 비용을 확인해 주세요.');}else if(e.details.refundOf&&e.amountWon>0)fail('비용 환급은 원래 비용과 연결된 음수 금액으로 입력해 주세요.');}
  const credits=new Map();for(const e of costs.filter(e=>e.status==='incurred'&&e.details.refundOf&&e.amountWon!==null))credits.set(e.details.refundOf,(credits.get(e.details.refundOf)||0n)-BigInt(e.amountWon));
  let excessiveCredit=false;for(const[ref,value]of credits){const original=ref.startsWith('legacy:')?map?.[ref.slice(7)]:byId.get(ref)?.amountWon;if(original!==null&&original!==undefined&&value>BigInt(original)){excessiveCredit=true;n.warn('비용 환급 합계가 원래 비용보다 큽니다.');}}
  function total(estimated){
   let value=base;const rows=costs.filter(e=>e.status==='incurred'||estimated&&['estimated','unconfirmed'].includes(e.status));
   const groups=new Map();for(const e of rows){if(!e.effectiveDate&&e.status==='incurred')n.warn('발생 비용의 적용일이 미확인입니다.');const key=e.details.refundOf?null:e.details.sourceCostKey;if(!key){value=sum([value,amount(e.amountWon,{signed:true})]);continue;}const group=groups.get(key)||[];group.push(e);groups.set(key,group);}
   for(const[key,group]of groups){const actual=group.filter(e=>e.status==='incurred'),selected=actual.length?actual:group;if(selected.length!==1){value=null;n.warn('같은 기존 비용을 대체하는 기록이 여러 개입니다.');continue;}if(!map||!own(map,key)||map[key]===null){value=null;n.warn('기존 비용 대체 항목의 원금액이 미확인입니다.');continue;}if(key==='inventoryInterest'&&loans.length){value=null;n.warn('대출 원장의 이자를 기존 비용으로 다시 대체할 수 없습니다.');continue;}value=sum([value,-map[key],amount(selected[0].amountWon,{signed:true})]);}
   return excessiveCredit?null:value;
  }
  const baseIncurredWon=total(false),estimatedBaseWon=total(true),actualInterestWon=sum(loans.map(l=>l.actualInterestWon)),managementInterestWon=sum(loans.map(l=>l.managementInterestWon)),feesWon=sum(loans.map(l=>l.feesWon));
  const incurredWon=sum([baseIncurredWon,actualInterestWon,feesWon]),managementWon=sum([baseIncurredWon,managementInterestWon,feesWon]),estimatedWon=sum([estimatedBaseWon,managementInterestWon,feesWon]);
  if(!confirmed)n.warn('발생하지 않았거나 미확정인 추가 비용이 없는지 확인해 주세요.');
  const currentSnapshot=snapshot(ctx.car),stale=typeof d.sourceSignature==='string'&&d.sourceSignature!==currentSnapshot.sourceSignature;if(stale)n.warn('기존 차량 금액 또는 날짜가 변경되었습니다. 확인한 원가를 다시 검토해 주세요.');
  const payables=costs.filter(e=>e.status==='incurred'&&!e.details.refundOf).map(e=>{const rows=cash.confirmed.filter(c=>(c.referenceId===e.id||byId.get(c.referenceId)?.details.refundOf===e.id)&&['cost','cost_refund'].includes(c.purpose)),paid=sum(rows.map(c=>c.amountWon*(c.direction==='out'?1:-1))),credit=credits.has(e.id)?safe(credits.get(e.id)):0,netAmountWon=minus(e.amountWon,credit),basis=!cash.complete?'unknown':rows.length?'registered_confirmed_records':'unrecorded';return {entryId:e.id,label:String(e.details.label||''),amountWon:e.amountWon,creditWon:credit,netAmountWon,paidWon:basis==='registered_confirmed_records'?paid:null,remainingWon:basis==='registered_confirmed_records'&&!excessiveCredit?minus(netAmountWon,paid):null,dueDate:e.dueDate??null,basis,basisLabel:basisLabel(basis)};});
  const basis=cashBasis(cash,['cost','cost_refund','loan_interest']);
  return {baseIncurredWon,incurredWon,managementWon,estimatedWon,legacySnapshotWon:amount(d.legacyCostsWon),legacyInterestWon:legacyInterest,loanInterestWon:managementInterestWon,actualLoanInterestWon:actualInterestWon,loanFeesWon:feesWon,paidWon:cash.costPaidWon,payableWon:basis==='registered_confirmed_records'?minus(incurredWon,sum([cash.costPaidWon,cash.loanInterestPaidWon])):null,basis,basisLabel:basisLabel(basis),confirmed,stale,unknownCount:costs.filter(e=>e.amountWon===null||e.status==='unconfirmed').length,payables,complete:confirmed&&!stale&&managementWon!==null&&!n.warnings.length&&loans.every(l=>l.complete),warnings:n.warnings};
 }
 function splitProfit(gross,d,warn){
  if(d.tradeType==='joint'){const share=rate(d.ownershipPercent);if(share===null){warn('공동매입 지분이 미확인입니다.');return null;}if(d.counterpartySettlementWon==null)warn('공동매입 상대방 정산금이 미확인입니다.');return gross===null?null:round(BigInt(gross)*BigInt(share),1000000n);}
  return gross;
 }
 function cycleResult(ctx,cycle){
  const n=notes(),d=cycle.details;if(!TYPES.includes(d.tradeType))fail('거래 유형을 확인해 주세요.');
  const entries=ctx.entries.filter(e=>e.cycleId===cycle.id),effective=effectiveEntries(entries,n.warn),loans=effective.filter(e=>e.kind==='loan').map(loan=>loanResult(ctx,loan,effective));
  const cash=cashResult(effective,ctx.asOf),costs=costResult(ctx,cycle,effective,loans,cash);
  const purchaseAmount=amount(d.purchaseAmountWon),saleAmount=amount(d.saleAmountWon),expectedSale=amount(d.expectedSaleWon),commission=amount(d.commissionWon);
  const purchaseBasis=cashBasis(cash,['purchase','purchase_refund']),saleBasis=cashBasis(cash,['sale','sale_refund']);
  const purchase={amountWon:purchaseAmount,date:date(d.purchaseDate),paidWon:cash.purchasePaidWon,payableWon:purchaseBasis==='registered_confirmed_records'?minus(purchaseAmount,cash.purchasePaidWon):null,basis:purchaseBasis,basisLabel:basisLabel(purchaseBasis),complete:purchaseAmount!==null&&purchaseBasis==='registered_confirmed_records'};
  const sale={amountWon:saleAmount,expectedAmountWon:expectedSale,date:date(d.saleDate),receivedWon:cash.saleReceivedWon,receivableWon:saleBasis==='registered_confirmed_records'?minus(saleAmount,cash.saleReceivedWon):null,basis:saleBasis,basisLabel:basisLabel(saleBasis),complete:saleAmount!==null&&saleBasis==='registered_confirmed_records'};
  if(purchaseAmount!==null&&purchaseBasis==='unrecorded')n.warn('매입 지급 내역이 등록되지 않아 미지급 잔액은 미확인입니다.');if(saleAmount!==null&&saleBasis==='unrecorded')n.warn('판매 입금 내역이 등록되지 않아 미수 잔액은 미확인입니다.');
  if(purchaseAmount!==null&&!purchase.date&&['direct','joint'].includes(d.tradeType)){purchase.complete=false;n.warn('매입일이 미확인입니다.');}if(saleAmount!==null&&!sale.date){sale.complete=false;n.warn('실제 판매일이 미확인입니다.');}
  let grossProfitWon,estimatedGrossProfitWon;
  if(['consignment','brokerage'].includes(d.tradeType)){grossProfitWon=minus(commission,costs.managementWon);estimatedGrossProfitWon=minus(commission,costs.estimatedWon);if(commission===null)n.warn('위탁·알선 수수료가 미확인입니다.');if(d.counterpartySettlementWon==null)n.warn('차주 또는 상대방 정산금이 미확인입니다.');}
  else{grossProfitWon=minus(minus(saleAmount,purchaseAmount),costs.managementWon);estimatedGrossProfitWon=minus(minus(expectedSale,purchaseAmount),costs.estimatedWon);if(purchaseAmount===null)n.warn('매입금액이 미확인입니다.');if(saleAmount===null)n.warn('실제 판매금액이 미확인입니다.');}
  const managementProfitWon=splitProfit(grossProfitWon,d,n.warn),estimatedProfitWon=splitProfit(estimatedGrossProfitWon,d,n.warn);
  if(cycle.status==='cancelled'){sale.possibleRefundWon=saleBasis==='registered_confirmed_records'?Math.max(0,cash.saleReceivedWon):null;sale.receivableWon=null;sale.complete=false;n.warn('취소된 거래의 실제 환불과 남은 지급 의무를 확인해 주세요. 원래 금융 기록은 유지됩니다.');}
  const warnings=[...new Set([...n.warnings,...costs.warnings,...cash.warnings,...loans.flatMap(l=>l.warnings)])],complete=managementProfitWon!==null&&costs.complete&&cash.complete&&loans.every(l=>l.complete)&&!warnings.length;
  const currentSnapshot=snapshot(ctx.car),estimatedLegacyProfitWon=minus(minus(currentSnapshot.expectedSaleWon,currentSnapshot.purchaseAmountWon),currentSnapshot.legacyCostsWon);
  return {id:cycle.id,sequence:cycle.sequence,status:cycle.status,tradeType:d.tradeType,managementProfitWon,estimatedProfitWon,grossProfitWon,estimatedGrossProfitWon,estimatedLegacyProfitWon,counterpartySettlementWon:amount(d.counterpartySettlementWon),settlementStatus:d.settlementStatus==='final'&&complete?'final':d.settlementStatus==='pending'?'pending':'provisional',costs,cash,sale,purchase,loans,warnings,complete};
 }
 function cycleSummary(workspace,cycleId,car={},options={}){const ctx=context(workspace,car,options),cycle=ctx.cycles.find(c=>c.id===(plain(cycleId)?cycleId.id:cycleId));if(!cycle)fail('거래 원본을 확인해 주세요.');return cycleResult(ctx,cycle);}
 function summarize(workspace,car={},options={}){
  const ctx=context(workspace,car,options),cycles=ctx.cycles.map(c=>cycleResult(ctx,c)).sort((a,b)=>(b.sequence||0)-(a.sequence||0)),open=cycles.filter(c=>c.status==='open'),current=open[0]||cycles[0]||null;
  const loans=cycles.flatMap(c=>c.loans),loanTotals={principalOutstandingWon:sum(loans.map(l=>l.principalOutstandingWon)),estimatedInterestWon:sum(loans.map(l=>l.estimatedInterestWon)),actualInterestWon:sum(loans.map(l=>l.actualInterestWon)),managementInterestWon:sum(loans.map(l=>l.managementInterestWon)),feesWon:sum(loans.map(l=>l.feesWon)),complete:loans.every(l=>l.complete)};
  const warnings=[...new Set(cycles.flatMap(c=>c.warnings))];if(open.length>1)warnings.push('진행 중인 거래가 여러 개입니다. 현재 거래를 확인해 주세요.');if(!current)warnings.push('확인한 매입·판매 거래가 없습니다.');
  return {asOf:ctx.asOf,activeCycleId:current?.id??null,managementProfitWon:current?.managementProfitWon??null,estimatedProfitWon:current?.estimatedProfitWon??null,costs:current?.costs??null,cash:current?.cash??null,sale:current?.sale??null,purchase:current?.purchase??null,loans,loanTotals,vehicleCash:cashResult(ctx.entries,ctx.asOf),cycles,warnings,complete:!!current&&current.complete&&open.length<=1&&loans.every(l=>l.complete)};
 }
 return Object.freeze({summarize,cycleSummary,loanSummary,appraisal,snapshot,today,sourceFields:Object.freeze(['buy','sell','soldPrice','purchaseAt','soldAt','costs','repairItems','customCosts']),costKeys:Object.freeze([...COST_KEYS])});
});
