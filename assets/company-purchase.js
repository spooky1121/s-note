/* Company inventory reuses the vehicle list after a scoped canonical server read. */
(()=>{'use strict';if(window.snoteEnsureCompanyPurchase)return;
 let state=null,epoch=0,lastScope='';const bridge=()=>window.snoteCompanyPurchaseBridge;
 const active=()=>typeof route==='string'&&(route==='companyBuy'||typeof isAccountant==='function'&&isAccountant());
 const context=()=>{try{return bridge()?.context?.()||null;}catch{return null;}};
 function message(code){return code==='FORBIDDEN'?'소속 상사의 차량을 조회할 권한을 확인해 주세요.':code==='DIRTY_VEHICLE'?'차량 변경사항을 저장하거나 닫은 뒤 다시 불러와 주세요.':code==='CONFLICT'?'저장 상태가 변경되었습니다. 변경사항을 확인한 뒤 다시 불러와 주세요.':code==='SETUP_REQUIRED'?'상사 차량 조회를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.':'상사 매물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';}
 function reset(){epoch++;state=null;}
 async function load(s,c){const run=++epoch;s.loading=true;s.error='';try{await bridge().load(c);if(state!==s||epoch!==run||bridge()?.current?.(c)!==true)return false;s.ready=true;return true;}catch(error){if(state===s&&epoch===run&&bridge()?.current?.(c)===true){s.ready=false;s.code=error?.code||'NETWORK';s.error=message(s.code);}return false;}finally{if(state===s&&epoch===run){s.loading=false;if(active()){renderCars();if(route==='inventoryFinance')buildAlt();if(s.ready)window.dispatchEvent(new CustomEvent('snote:company-cars-ready',{detail:{key:c.key}}));}}}}
 window.snoteEnsureCompanyPurchase=()=>{const c=context();lastScope=(c?.key||'')+':'+String(c?.ready);if(!c?.canRead){state={key:c?.key||'',ready:false,loading:false,code:'FORBIDDEN',error:message('FORBIDDEN')};return false;}if(!state||state.key!==c.key){if(typeof isAccountant==='function'&&isAccountant()){const filter=document.getElementById('accountant-dealer-filter');if(filter)filter.value='all';}reset();state={key:c.key,ready:false,loading:false,error:''};}if(!c.ready)return false;if(state.ready)return true;if(!state.loading&&!state.error)state.task=load(state,c);return false;};
 window.snoteWaitCompanyPurchase=async()=>{if(window.snoteEnsureCompanyPurchase())return true;const s=state,c=context();if(s?.task)await s.task;if(state===s&&s?.ready&&bridge()?.current?.(c)===true)return true;throw Object.assign(Error(s?.error||message('NETWORK')),{code:s?.code||'NOT_READY'});};
 window.snoteCompanyPurchaseMessage=()=>state?.error||'상사 매물을 불러오는 중…';
 window.snoteCompanyPurchaseIsReady=()=>{const c=context();return !!c?.ready&&state?.key===c.key&&state.ready===true;};
 window.snoteRefreshCompanyPurchase=()=>{if(!active()||state?.loading)return;reset();renderCars();if(route==='inventoryFinance')buildAlt();};window.snoteResetCompanyPurchase=reset;
 setInterval(()=>{const c=context(),signature=(c?.key||'')+':'+String(c?.ready);if(signature!==lastScope){lastScope=signature;if(active())reset();if(typeof isPurchaseListRoute==='function'&&isPurchaseListRoute()||typeof isAccountant==='function'&&isAccountant())renderCars();}if(active()&&c?.ready)window.snoteEnsureCompanyPurchase();if(!active()&&state)reset();},300);
 window.addEventListener('pagehide',reset);if(active())renderCars();
})();
