/* Application calculations use integer KRW. Legacy datasets retain their wire format. */
(function(root){'use strict';if(root.SnoteMoney)return;
 const fields=['buy','sell','soldPrice','inventoryLoan'];
 const costs=['bodywork','polish','repair','advertising','purchaseFee','purchaseOther','acquisitionTax','incomeTax','inventoryInterest'];
 function toWon(value){
  if(value==null||value===''||!['number','string'].includes(typeof value))return value;
  const match=/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
  if(!match||!(match[2]||match[3])||!Number.isFinite(Number(value)))return value;
  const exponent=4+Number(match[4]||0)-(match[3]||'').length;if(Math.abs(exponent)>100)return value;
  let n=BigInt((match[2]||'0')+(match[3]||''));if(exponent>=0)n*=10n**BigInt(exponent);else{const d=10n**BigInt(-exponent);n=(n+d/2n)/d;}
  const result=Number(match[1]==='-'?-n:n);return Number.isSafeInteger(result)?result:value;
 }
 const legacy=value=>value==null||value===''?value:Number((Number(value)/10000).toFixed(4));
 function mapped(value,keys,convert){const result={...value};for(const key of keys)if(Object.hasOwn(result,key))result[key]=convert(result[key]);return result;}
 function car(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.moneyUnit==='KRW')return value;
  const result=mapped(value,fields,toWon);result.moneyUnit='KRW';
  if(value.costs&&typeof value.costs==='object')result.costs=mapped(value.costs,costs,toWon);
  if(Array.isArray(value.repairItems))result.repairItems=value.repairItems.map(item=>item&&typeof item==='object'?mapped(item,['amount'],toWon):item);
  if(Array.isArray(result.repairItems)&&result.repairItems.length&&value.repairItems.every(item=>item&&item.amount!=null&&item.amount!==''&&Number.isFinite(Number(item.amount)))){
   const exactTotal=toWon(value.repairItems.reduce((sum,item)=>sum+Number(item.amount),0)),roundedTotal=result.repairItems.reduce((sum,item)=>sum+Number(item.amount),0);
   if(Number.isSafeInteger(exactTotal)&&exactTotal!==roundedTotal)result.repairItems[result.repairItems.length-1].amount+=exactTotal-roundedTotal;
  }
  return result;
 }
 function storeCar(value){
  if(!value||value.moneyUnit!=='KRW')return value;
  const result=mapped(value,fields,legacy);delete result.moneyUnit;
  if(value.costs&&typeof value.costs==='object')result.costs=mapped(value.costs,costs,legacy);
  if(Array.isArray(value.repairItems))result.repairItems=value.repairItems.map(item=>item&&typeof item==='object'?mapped(item,['amount'],legacy):item);
  if(value.inventoryInterestSnapshot?.principalWon!=null){result.inventoryInterestSnapshot={...value.inventoryInterestSnapshot,principalManwon:legacy(value.inventoryInterestSnapshot.principalWon)};delete result.inventoryInterestSnapshot.principalWon;}
  return result;
 }
 const finance=row=>row?.moneyUnit==='KRW'?row:{...row,loan:toWon(row.loan),moneyUnit:'KRW'};
 function storeFinance(row){if(row?.moneyUnit!=='KRW')return row;const result={...row,loan:legacy(row.loan)};delete result.moneyUnit;return result;}
 root.SnoteMoney=Object.freeze({toWon,legacy,car,storeCar,finance,storeFinance});
})(globalThis);
