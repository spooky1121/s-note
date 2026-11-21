/* Personal lender rates are resolved by the vehicle owner, never the viewer. */
(function(global){'use strict';
 if(global.SnoteDealerFinanceRates)return;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,MAX=100,TIMEOUT=15000;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';
 const alias=id=>'cld_'+id.replace(/-/g,'').slice(0,18);
 const fail=()=>{throw Error('금융사 이율을 확인해 주세요.');};
 function lenderName(value){if(typeof value!=='string'||value!==value.trim()||!value||Array.from(value).length>45||/[\u0000-\u001f\u007f]/.test(value))fail();return value;}
 function rate(value,{text=false}={}){
  if(text&&typeof value==='string'){if(!/^(?:\d+)(?:\.\d{1,4})?$/.test(value.trim()))fail();value=Number(value.trim());}
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100||Number(value.toFixed(4))!==value)fail();return value===0?0:value;
 }
 function rates(value){if(!object(value)||Object.keys(value).length>MAX)fail();return Object.fromEntries(Object.entries(value).map(([name,value])=>[lenderName(name),rate(value)]));}
 function names(value){if(!Array.isArray(value)||value.length>MAX)fail();const result=value.map(lenderName);if(new Set(result).size!==result.length)fail();return result;}
 const equal=(left,right)=>{const a=rates(left),b=rates(right);return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&a[key]===b[key]);};
 function profiles(result,ctx){
  if(!object(result)||result.companyId!==ctx.companyId||result.userId!==ctx.userId||!Array.isArray(result.profiles)||result.profiles.length>2000)throw Error('이율 조회 응답을 확인하지 못했습니다.');
  const seen=new Set(),rows=result.profiles.map(item=>{
   if(!object(item)||!UUID.test(item.ownerId)||!UUID.test(item.companyId)||!Number.isSafeInteger(item.revision)||item.revision<0||item.sharedOnly!==undefined&&typeof item.sharedOnly!=='boolean')throw Error('이율 조회 응답을 확인하지 못했습니다.');
   const key=item.companyId+':'+item.ownerId;if(seen.has(key))throw Error('이율 조회 응답이 중복되었습니다.');seen.add(key);
   return {ownerId:item.ownerId,companyId:item.companyId,rates:rates(item.rates),fallbackRates:rates(item.fallbackRates),lenderNames:names(item.lenderNames),revision:item.revision,sharedOnly:item.sharedOnly===true};
  });
  if(rows.filter(row=>row.ownerId===ctx.userId&&row.companyId===ctx.companyId).length!==1)throw Error('본인 계정의 이율을 확인하지 못했습니다.');return rows;
 }
 function rowsFor(car,companyLenders,rows,ctx,{confirmed=true,companyId}={}){
  const original=Array.isArray(companyLenders)?companyLenders.filter(Array.isArray).map(row=>[...row]):[];
  if(!ctx)return original;
  const owner=String(car?.ownerId||ctx.ownerAlias||alias(ctx.userId)),source=companyId||car?.inventoryRateCompanyId||'';
  const matches=confirmed?rows.filter(row=>alias(row.ownerId)===owner&&(!source||row.companyId===source)):[];
  const profile=matches.length===1?matches[0]:null;
  const catalog=profile?[...profile.lenderNames,...Object.keys(profile.fallbackRates),...Object.keys(profile.rates)]:original.map(row=>row[0]);
  if(typeof car?.inventoryLender==='string'&&car.inventoryLender)catalog.push(car.inventoryLender);
  return [...new Set(catalog)].map(name=>{
   const prior=original.find(row=>row[0]===name),value=profile?(Object.hasOwn(profile.rates,name)?profile.rates[name]:Object.hasOwn(profile.fallbackRates,name)?profile.fallbackRates[name]:null):null;
   return [name,prior?.[1]??0,value];
  });
 }
 global.SnoteDealerFinanceRatesModel=Object.freeze({rates,rate,names,profiles,rowsFor,equal,alias,maxRates:MAX});
 const doc=global.document,bridge=()=>global.snoteDealerRatesBridge;
 let state=null,epoch=0;
 function context(){try{const ctx=bridge()?.context?.();return ctx&&typeof ctx.key==='string'&&ctx.key&&UUID.test(ctx.companyId)&&UUID.test(ctx.userId)&&ctx.ownerAlias===alias(ctx.userId)?ctx:null;}catch{return null;}}
 function sameContext(ctx){const now=context();if(!ctx||!now||!['key','companyId','userId','ownerAlias','actor','client','canWrite'].every(key=>now[key]===ctx[key]))return false;try{return bridge()?.current?.(ctx)===true;}catch{return false;}}
 function current(s){return !!s&&state===s&&s.epoch===epoch&&sameContext(s.context)&&bridge()===s.bridge;}
 function ensure(){const ctx=context();if(!ctx)return {ctx:null,s:null};if(!state||!current(state)){state={epoch:++epoch,key:ctx.key,context:ctx,bridge:bridge(),loaded:false,status:'idle',profiles:[],own:null,raw:{},touched:new Set(),pending:null,operation:0,message:'',needsReload:false};}return {ctx,s:state};}
 function ready(){return !!state&&current(state)&&state.loaded;}
 function cloudLike(){try{return !!global.zc86Cloud?.ready||typeof currentUser!=='undefined'&&String(currentUser?.username||'').startsWith('cld_');}catch{return !!global.zc86Cloud?.ready;}}
 function lendersFor(car,companyLenders,options={}){
  const {ctx,s}=ensure();if(s?.status==='idle'&&!s.pending)void refresh();
  const scope=ctx||((state||cloudLike())?{userId:'',ownerAlias:''}:null);
  return rowsFor(car,companyLenders,ready()?state.profiles:[],scope,{...options,confirmed:ready()});
 }
 function ownProfile(s){return s.profiles.find(row=>row.ownerId===s.context.userId&&row.companyId===s.context.companyId);}
 function busy(s){return s?.status==='loading'||s?.status==='saving';}
 function draft(s){const result=new Map(Object.entries(s.own?.rates||{}));for(const name of s.touched){const value=String(s.raw[name]??'').trim();if(!value)result.delete(name);else result.set(lenderName(name),rate(value,{text:true}));}return rates(Object.fromEntries(result));}
 function dirty(s){if(!s?.own)return false;try{return !equal(draft(s),s.own.rates);}catch{return true;}}
 function notify(source){if(doc?.dispatchEvent&&typeof global.CustomEvent==='function')doc.dispatchEvent(new global.CustomEvent('snote:dealer-finance-rates-changed',{detail:{source,contextKey:state?.key||null,ready:ready()}}));}
 function popupFeedback(s,tone,operation=s.operation){if(typeof global.snoteNotify!=='function'||!current(s)||s.operation!==operation||!s.message)return;s.popupMessage=s.message;global.snoteNotify(s.message,{tone,key:'dealer-finance-rates:'+tone,isCurrent:()=>current(s)&&s.operation===operation,returnFocus:false});}
 function timeout(promise){let timer;const expired=new Promise((_,reject)=>{timer=global.setTimeout(()=>reject(Error('RATE_TIMEOUT')),TIMEOUT);});return Promise.race([Promise.resolve(promise),expired]).finally(()=>global.clearTimeout(timer));}
 const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7M13 5v2"/></svg>';
 function markup(){const ctx=context();if(!ctx?.canWrite)return '';return '<section class="snote90-panel snote-dealer-rate-panel" id="snote-dealer-finance-rates" aria-labelledby="snote-dealer-rates-title"><header><div><h3 id="snote-dealer-rates-title">내 재고금융 이율</h3><p>비워두면 상사 기본 이율을 사용합니다.</p></div><button id="snote-dealer-rates-save" type="button" aria-label="내 재고금융 이율 저장" data-tooltip="이율 저장" disabled>'+icon+'</button></header><div id="snote-dealer-rates-list"></div><div class="snote-dealer-rates-feedback"><p id="snote-dealer-rates-status" role="status" aria-live="polite"></p><button id="snote-dealer-rates-retry" type="button" hidden>다시 불러오기</button></div></section>';}
 function paint(){
  const host=doc?.getElementById?.('snote-dealer-finance-rates');if(!host)return;
  const ctx=context(),s=state;host.hidden=!ctx?.canWrite;if(host.hidden)return;
  host.dataset.state=current(s)?s.status:'idle';host.setAttribute('aria-busy',String(current(s)&&busy(s)));
  const list=host.querySelector('#snote-dealer-rates-list'),status=host.querySelector('#snote-dealer-rates-status'),saveButton=host.querySelector('#snote-dealer-rates-save'),retry=host.querySelector('#snote-dealer-rates-retry');
  const valid=current(s),catalog=valid&&s.own?s.own.lenderNames:[],signature=JSON.stringify([ctx.key,catalog]);
  if(list&&list.dataset.signature!==signature){list.replaceChildren();list.dataset.signature=signature;for(const name of catalog){
   const label=doc.createElement('label');label.className='snote-dealer-rate-row';const caption=doc.createElement('span');caption.textContent=name;const control=doc.createElement('span');control.className='snote-dealer-rate-control';const input=doc.createElement('input');input.type='number';input.inputMode='decimal';input.min='0';input.max='100';input.step='0.0001';input.autocomplete='off';input.dataset.dealerRate=name;input.setAttribute('aria-label',name+' 내 연이율');const unit=doc.createElement('span');unit.textContent='%';control.append(input,unit);label.append(caption,control);list.append(label);
  }}
  for(const input of list?.querySelectorAll('input[data-dealer-rate]')||[]){const name=input.dataset.dealerRate,raw=s?.touched.has(name)?s.raw[name]:valid&&Object.hasOwn(s.own?.rates||{},name)?String(s.own.rates[name]):'';if(input.value!==raw)input.value=raw;const fallback=valid&&Object.hasOwn(s.own?.fallbackRates||{},name)?s.own.fallbackRates[name]:null;input.placeholder=fallback==null?'미설정':String(fallback);input.disabled=!valid||!s.loaded||busy(s)||!ctx.canWrite;}
  if(saveButton)saveButton.disabled=!valid||!s.loaded||busy(s)||s.needsReload||!ctx.canWrite;
  const text=!valid?'설정을 불러오는 중…':s.status==='loading'?'이율을 불러오는 중…':s.status==='saving'?'이율을 저장하는 중…':s.message||(!catalog.length&&s.loaded?'등록된 재고금융사가 없습니다.':'');
  if(status){status.textContent=text;status.hidden=!text||typeof global.snoteNotify==='function'&&s?.popupMessage===text;status.dataset.error=String(valid&&['load-error','save-error'].includes(s.status));}
  if(retry){retry.hidden=!valid||!['load-error','save-error'].includes(s.status);retry.disabled=valid&&busy(s);}
 }
 function apply(s,result){
  const rows=profiles(result,s.context),own=rows.find(row=>row.ownerId===s.context.userId&&row.companyId===s.context.companyId);
  if(s.own&&own.revision<s.own.revision)throw Error('이율 설정 버전이 변경되었습니다. 다시 불러와 주세요.');
  s.profiles=rows;s.own=own;s.loaded=true;s.status='ready';s.message='';s.needsReload=false;
 }
 function refresh({force=false}={}){
  const {s}=ensure();if(!s){reset();return Promise.resolve(false);}if(s.pending)return s.pending;if(s.loaded&&!force){paint();return Promise.resolve(true);}
  const operation=++s.operation;s.status='loading';s.message='';paint();
  const job=Promise.resolve().then(async()=>{
   try{if(typeof s.bridge?.load!=='function')throw Error('RATE_SETUP');const result=await timeout(s.bridge.load(s.context));if(!current(s)||s.operation!==operation)return false;apply(s,result);paint();notify('load');return true;}
   catch(error){if(!current(s)||s.operation!==operation)return false;s.loaded=false;s.status='load-error';s.message='이율을 불러오지 못했습니다. 다시 시도해 주세요.';popupFeedback(s,'error',operation);paint();notify('load-error');return false;}
   finally{if(s.operation===operation)s.pending=null;}
  });s.pending=job;return job;
 }
 function save(values){
  const {ctx,s}=ensure();if(!ctx?.canWrite||!s?.loaded||busy(s)||s.pending||s.needsReload||!current(s))return Promise.resolve(false);
  let submitted;try{submitted=values===undefined?draft(s):rates(values);}catch(error){s.message=error.message;popupFeedback(s,'error');paint();return Promise.resolve(false);}
  if(equal(submitted,s.own.rates)){s.message='저장 되었습니다.';popupFeedback(s,'success');paint();return Promise.resolve(true);}
  const expected=s.own.revision,operation=++s.operation;s.status='saving';s.message='';paint();
  const job=Promise.resolve().then(async()=>{
   try{
    if(typeof s.bridge?.save!=='function')throw Error('RATE_SETUP');const result=await timeout(s.bridge.save(s.context,clone(submitted),expected));
    if(!current(s)||s.operation!==operation)return false;
    if(!object(result)||result.companyId!==ctx.companyId||result.userId!==ctx.userId||!Number.isSafeInteger(result.revision)||result.revision<=expected||!equal(rates(result.rates),submitted))throw Error('RATE_ACK');
    s.own={...s.own,rates:clone(submitted),revision:result.revision};s.profiles=s.profiles.map(row=>row.ownerId===ctx.userId&&row.companyId===ctx.companyId?s.own:row);s.raw={};s.touched.clear();s.status='ready';s.message='저장 되었습니다.';s.needsReload=false;popupFeedback(s,'success',operation);paint();notify('save');return true;
   }catch(error){if(!current(s)||s.operation!==operation)return false;s.status='save-error';s.needsReload=true;s.message=error?.code==='CONFLICT'||error?.code==='40001'?'다른 화면에서 이율이 변경되었습니다. 다시 불러온 뒤 저장해 주세요.':'이율 저장을 확인하지 못했습니다. 입력을 유지하고 다시 불러와 주세요.';popupFeedback(s,'error',operation);paint();return false;}
   finally{if(s.operation===operation)s.pending=null;}
  });s.pending=job;return job;
 }
 function reset(){epoch++;state=null;const host=doc?.getElementById?.('snote-dealer-finance-rates');if(host){host.hidden=true;host.querySelector('#snote-dealer-rates-list')?.replaceChildren();}notify('reset');}
 function mount(){const {s}=ensure();paint();return s&&!s.loaded&&!s.pending?refresh():Promise.resolve(ready());}
 function config(){return ready()?{rates:clone(state.own.rates),revision:state.own.revision,lenderNames:[...state.own.lenderNames],fallbackRates:clone(state.own.fallbackRates)}:null;}
 doc?.addEventListener?.('input',event=>{const input=event.target?.closest?.('#snote-dealer-rates-list input[data-dealer-rate]');if(!input)return;const {s}=ensure();if(!s||!current(s)||!s.loaded||busy(s))return;Object.defineProperty(s.raw,input.dataset.dealerRate,{value:input.value,enumerable:true,writable:true,configurable:true});s.touched.add(input.dataset.dealerRate);if(!s.needsReload)s.message='';paint();});
 doc?.addEventListener?.('click',event=>{if(event.target?.closest?.('#snote-dealer-rates-save'))void save();else if(event.target?.closest?.('#snote-dealer-rates-retry'))void refresh({force:true});});
 global.SnoteDealerFinanceRates=Object.freeze({markup,mount,refresh,reset,lendersFor,ready,save,config,dirty:()=>!!state&&current(state)&&dirty(state)});
})(typeof window!=='undefined'?window:globalThis);
