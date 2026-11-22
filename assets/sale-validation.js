/* Validate only newly completed or edited sales; historical records are never rewritten. */
(function(root){'use strict';
 function date(value){
  if(typeof value!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
 }
 function validate(car){
  if(!date(car?.soldAt))throw Error('올바른 판매 완료 날짜를 입력해주세요.');
  if(date(car.purchaseAt)&&car.soldAt<car.purchaseAt)throw Error('판매 완료 날짜는 매입일보다 빠를 수 없습니다.');
  if(!Number.isSafeInteger(car.soldPrice)||car.soldPrice<=0||car.soldPrice>1000000000000)throw Error('실제 판매 금액을 직접 입력하고 확인해주세요.');
  return true;
 }
 function changed(before,after){return after?.status==='판매완료'&&(!before||before.status!=='판매완료'||before.soldAt!==after.soldAt||before.soldPrice!==after.soldPrice||before.purchaseAt!==after.purchaseAt);}
 function changes(before,after){for(const car of after){const previous=before.find(row=>String(row.id)===String(car.id));if(changed(previous,car))validate(car);}return true;}
 const api=Object.freeze({date,validate,changed,changes});root.SnoteSaleValidation=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
