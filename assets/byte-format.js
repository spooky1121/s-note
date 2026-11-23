/* Display byte measurements without converting unknowns or unrelated counts. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SnoteByteFormat=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
 const UNITS=Object.freeze(['B','KB','MB','GB','TB']);
 const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 function format(value){
  if(!known(value))return '—';
  let scaled=value===0?0:value,unit=0;while(scaled>=1024&&unit<UNITS.length-1){scaled/=1024;unit++;}
  return scaled.toLocaleString('ko-KR',{maximumFractionDigits:2,minimumFractionDigits:0})+' '+UNITS[unit];
 }
 function exact(value){return known(value)?(value===0?0:value).toLocaleString('ko-KR',{maximumFractionDigits:20})+' B':null;}
 function isByteUnit(value){return typeof value==='string'&&(value.trim()==='B'||/^(?:bytes?|바이트)$/i.test(value.trim()));}
 return Object.freeze({format,exact,isByteUnit});
});
