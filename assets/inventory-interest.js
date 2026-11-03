/* Shared browser/server simple interest, actual calendar days / 365, rounded once to won. */
(function(root){
 'use strict';
 if(root.SnoteInventoryInterest)return;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function day(value){const m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value||''));if(!m)return null;const y=+m[1],mo=+m[2],d=+m[3];if(y<1900||y>9999)return null;const n=Date.UTC(y,mo-1,d),dt=new Date(n);return dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d?n:null;}
 function calculate(car,lenders=[],options={}){
  const loan=Number(car?.inventoryLoan||0),lender=String(car?.inventoryLender||'').trim();
  const fail=reason=>({ready:false,reason,manwon:null,amountWon:null});
  if(!Number.isFinite(loan)||loan<0||loan>100000000)return fail('대출금을 확인해 주세요.');
  if(loan===0)return{ready:true,manwon:0,amountWon:0,annualRate:0,days:0,lender,start:car?.purchaseAt||'',end:car?.status==='판매완료'?car.soldAt:options.today||today()};
  const start=car?.purchaseAt||'',end=car?.status==='판매완료'?car.soldAt:options.today||today(),a=day(start),b=day(end);
  if(a===null||b===null||b<a)return fail('매입일·판매일을 확인해 주세요.');
  const prior=car?.inventoryInterestSnapshot;
  const frozen=car?.status==='판매완료'&&prior?.version===1&&prior.lender===lender&&prior.principalManwon===loan&&prior.start===start&&prior.end===end;
  const row=Array.isArray(lenders)?lenders.find(row=>Array.isArray(row)&&row[0]===lender):null;
  const raw=frozen?prior.annualRate:row?.[2],rate=Number(raw);
  if(!lender||raw==null||String(raw).trim()===''||!Number.isFinite(rate)||rate<0||rate>100)return fail('금융사의 연이율을 설정해 주세요.');
  const days=(b-a)/86400000,denom=365000000n;
  const amount=Number((BigInt(Math.round(loan*10000))*BigInt(Math.round(rate*10000))*BigInt(days)+denom/2n)/denom);
  if(!Number.isSafeInteger(amount)||amount<0||amount>100000000*10000)return fail('계산된 재고 이자를 확인해 주세요.');
  return {ready:true,amountWon:amount,manwon:amount/10000,annualRate:rate,days,lender,start,end};
 }
 function snapshot(car,lenders,options){const value=calculate(car,lenders,options);return value.ready?{version:1,lender:value.lender,annualRate:value.annualRate,principalManwon:Number(car.inventoryLoan||0),start:value.start,end:value.end,days:value.days,amountWon:value.amountWon}:null;}
 root.SnoteInventoryInterest=Object.freeze({calculate,snapshot,today});
})(globalThis);
