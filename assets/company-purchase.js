/* Company inventory reuses the vehicle list after a scoped canonical server read. */
(()=>{'use strict';if(window.snoteEnsureCompanyPurchase)return;
 let state=null,epoch=0,lastScope='';const bridge=()=>window.snoteCompanyPurchaseBridge;
 const active=()=>typeof route==='string'&&route==='companyBuy';
 const context=()=>{try{return bridge()?.context?.()||null;}catch{return null;}};
 function message(code){return code==='FORBIDDEN'?'상사 매입은 관리자 계정으로 확인할 수 있습니다.':code==='DIRTY_VEHICLE'?'차량 변경사항을 저장하거나 닫은 뒤 다시 불러와 주세요.':code==='CONFLICT'?'저장 상태가 변경되었습니다. 변경사항을 확인한 뒤 다시 불러와 주세요.':code==='SETUP_REQUIRED'?'상사 매입을 사용할 준비가 되지 않았습니다. 잠시 후 다시 시도해 주세요.':'상사 매물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';}
 function reset(){epoch++;state=null;}
 async function load(s,c){const run=++epoch;s.loading=true;s.error='';try{await bridge().load(c);if(state!==s||epoch!==run||bridge()?.current?.(c)!==true)return;s.ready=true;}catch(error){if(state===s&&epoch===run&&bridge()?.current?.(c)===true){s.ready=false;s.error=message(error?.code);}}finally{if(state===s&&epoch===run){s.loading=false;if(active())renderCars();}}}
 window.snoteEnsureCompanyPurchase=()=>{const c=context();lastScope=(c?.key||'')+':'+String(c?.ready);if(!c?.canCompany){state={key:c?.key||'',ready:false,loading:false,error:message('FORBIDDEN')};return false;}if(!state||state.key!==c.key){reset();state={key:c.key,ready:false,loading:false,error:''};}if(!c.ready)return false;if(state.ready)return true;if(!state.loading&&!state.error)void load(state,c);return false;};
 window.snoteCompanyPurchaseMessage=()=>state?.error||'상사 매물을 불러오는 중…';
 window.snoteRefreshCompanyPurchase=()=>{if(!active()||state?.loading)return;reset();renderCars();};window.snoteResetCompanyPurchase=reset;
 setInterval(()=>{const c=context(),signature=(c?.key||'')+':'+String(c?.ready);if(signature!==lastScope){lastScope=signature;if(active())reset();if(typeof isPurchaseListRoute==='function'&&isPurchaseListRoute())renderCars();}if(!active()&&state)reset();},300);
 window.addEventListener('pagehide',reset);if(active())renderCars();
})();
