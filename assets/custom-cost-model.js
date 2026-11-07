/* Custom amounts are always integer KRW, including legacy vehicle wire records. */
(function(root){'use strict';
 if(root.SnoteCustomCosts)return;
 const id=/^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.prototype.toString.call(v)==='[object Object]';
 const invalid=()=>{throw Error('추가 비용의 항목과 원 단위 금액을 확인해 주세요.');};
 function normalize(value,{strict=false}={}){
  if(value==null)return {};
  if(!object(value)){if(strict)invalid();return {};}
  const entries=Object.entries(value);if(strict&&entries.length>128)invalid();
  const result={};
  for(const[key,amount]of entries){if(!id.test(key)||!Number.isSafeInteger(amount)||amount<0||amount>1000000000000){if(strict)invalid();continue;}result[key]=amount;}
  return result;
 }
 function sum(value){const total=Object.values(normalize(value)).reduce((s,n)=>s+n,0);if(!Number.isSafeInteger(total))invalid();return total;}
 function labels(value){
  if(!object(value))return {};
  const result={};for(const[key,label]of Object.entries(value)){if(!id.test(key)||typeof label!=='string'||/[\u0000-\u001f\u007f]/.test(label))continue;const text=label.normalize('NFC').trim().replace(/\s+/g,' ');if(text&&Array.from(text).length<=24)result[key]=text;}return result;
 }
 root.SnoteCustomCosts=Object.freeze({normalize,sum,labels});
})(globalThis);
