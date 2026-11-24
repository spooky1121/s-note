/* Optional sale income stays in integer KRW, including legacy vehicle wire records. */
(function(root){'use strict';
 if(root.SnoteSaleRegistrationModel){if(typeof module==='object'&&module.exports)module.exports=root.SnoteSaleRegistrationModel;return;}
 if(!root.SnoteMoney&&typeof module==='object'&&module.exports)require('./money.js');
 const FIELD='saleRegistrationIncome',SOLD='판매완료',MAX_AMOUNT=1000000000000;
 const FIXED=Object.freeze({commission:'수수료',insurance:'보험',finance:'할부금융'});
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';
 const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
 const keys=(value,allowed)=>object(value)&&Object.keys(value).length===allowed.length&&allowed.every(key=>own(value,key));
 const invalid=()=>{throw Error('수입 항목과 원 단위 금액을 확인해 주세요.');};
 function text(value,max){return typeof value==='string'&&value.trim().length>0&&Array.from(value).length<=max&&!/[\u0000-\u001f\u007f]/.test(value);}
 function date(value){
  if(typeof value!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const instant=new Date(value+'T00:00:00Z');return Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,10)===value;
 }
 function clone(value){
  if(Array.isArray(value))return value.map(clone);
  if(object(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
  return value;
 }
 function items(value){
  if(!Array.isArray(value)||value.length<3||value.length>53)invalid();
  const seen=new Set();let total=0;
  const result=value.map(item=>{
   if(!keys(item,['id','label','amountWon'])||!text(item.id,100)||!text(item.label,60)||seen.has(item.id)||!Number.isSafeInteger(item.amountWon)||item.amountWon<0||item.amountWon>MAX_AMOUNT)invalid();
   if(own(FIXED,item.id)&&item.label!==FIXED[item.id])invalid();
   seen.add(item.id);total+=item.amountWon;if(!Number.isSafeInteger(total))invalid();
   return {id:item.id,label:item.label,amountWon:item.amountWon};
  });
  if(!Object.keys(FIXED).every(id=>seen.has(id)))invalid();
  return {items:result,total};
 }
 function basis(car){
  if(!object(car)||car.status!==SOLD||car.id==null||!text(String(car.id),200)||!date(car.soldAt)||!['number','string'].includes(typeof car.soldPrice)||car.soldPrice==='')return null;
  const amount=car.moneyUnit==='KRW'?car.soldPrice:root.SnoteMoney?.toWon(car.soldPrice);
  if(!Number.isSafeInteger(amount)||amount<=0||amount>MAX_AMOUNT)return null;
  return {carId:String(car.id),soldAt:car.soldAt,soldPriceWon:amount};
 }
 function record(value){
  if(!keys(value,['version','moneyUnit','carId','soldAt','soldPriceWon','items'])||value.version!==1||value.moneyUnit!=='KRW'||!text(value.carId,200)||!date(value.soldAt)||!Number.isSafeInteger(value.soldPriceWon)||value.soldPriceWon<=0||value.soldPriceWon>MAX_AMOUNT)return null;
  try{const checked=items(value.items);return {value:{version:1,moneyUnit:'KRW',carId:value.carId,soldAt:value.soldAt,soldPriceWon:value.soldPriceWon,items:checked.items},total:checked.total};}catch{return null;}
 }
 function bound(car){
  const sale=basis(car),saved=record(car?.[FIELD]);
  return sale&&saved&&saved.value.carId===sale.carId&&saved.value.soldAt===sale.soldAt&&saved.value.soldPriceWon===sale.soldPriceWon?saved:null;
 }
 function create(car,value){
  const sale=basis(car);if(!sale)invalid();
  return {version:1,moneyUnit:'KRW',...sale,items:items(value).items};
 }
 function incomeWon(car){try{return bound(car)?.total??0;}catch{return 0;}}
 function prepare(before,after){
  const next=clone(after);if(!object(next))return next;
  if(before?.status===SOLD&&next.status!==SOLD){delete next[FIELD];return next;}
  const previous=bound(before),sale=basis(next),saved=record(next[FIELD]);
  // Rebind only the same valid record on the same completed sale. New records,
  // copied cars and malformed historical metadata never acquire a fresh binding.
  if(previous&&sale&&saved&&sale.carId===previous.value.carId&&JSON.stringify(previous.value)===JSON.stringify(saved.value))next[FIELD]={...saved.value,...sale};
  return next;
 }
 const api=Object.freeze({create,incomeWon,prepare});root.SnoteSaleRegistrationModel=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
