/* Load the personal gate policy before entering the workspace; only confirmed values unlock it. */
(function(global){'use strict';
 if(global.SnoteFinanceLock)return;
 const doc=global.document,TIMEOUT=15000,STORAGE_PREFIX='snote-finance-lock:v1:';
 let state=null,epoch=0;
 const supported=role=>role==='dealer'||role==='admin';
 const defaultValue=role=>role!=='admin';
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const bridge=()=>global.snoteFinanceLockBridge;
 function readContext(api=bridge()){try{return api?.context?.()||null;}catch{return null;}}
 function actualCloud(account,ctx){return !!ctx||!!global.zc86Cloud?.ready||String(account?.username||'').startsWith('cld_');}
 function accountCurrent(s){try{return typeof currentUser==='undefined'||!!currentUser&&currentUser.username===s.account.username&&currentUser.role===s.account.role;}catch{return false;}}
 function current(s){
  if(!s||state!==s||s.epoch!==epoch||!accountCurrent(s))return false;
  if(s.mode==='unsupported')return true;
  if(s.mode==='local')return !actualCloud(s.account,readContext());
  const api=bridge();if(api!==s.bridge||!s.context||typeof api?.current!=='function')return false;
  try{const now=readContext(api);return api.current(s.context)===true&&now?.key===s.key&&['companyId','userId','role','username'].every(field=>now[field]===s.context[field]);}catch{return false;}
 }
 function policy(){if(state?.account.role==='accountant')return false;return !state||!current(state)?true:state.enabled;}
 function busy(s){return s?.status==='loading'||s?.status==='saving';}
 function canChange(s){return !!s&&supported(s.account.role)&&current(s)&&s.status==='ready'&&Number.isSafeInteger(s.revision);}
 function feedback(s){if(!s)return '';if(s.status==='loading')return '설정을 불러오는 중…';if(s.status==='saving')return '저장 중…';return s.message||'';}
 function hasRetry(s){return !!s&&['load-error','save-error'].includes(s.status);}
 function paint(){
  const host=doc?.getElementById?.('snote-finance-lock-setting');if(!host)return policy();
  if(!state||!supported(state.account.role)){host.hidden=true;return policy();}
  host.hidden=false;host.dataset.state=state.status;host.setAttribute('aria-busy',String(busy(state)));
  const input=host.querySelector('#snote-finance-lock-toggle'),status=host.querySelector('#snote-finance-lock-status'),retry=host.querySelector('#snote-finance-lock-retry');
  if(input){input.checked=policy();input.disabled=!canChange(state);input.setAttribute('aria-checked',String(input.checked));}
  if(status){status.textContent=feedback(state);status.hidden=!status.textContent;status.dataset.error=String(hasRetry(state));}
  if(retry){retry.hidden=!hasRetry(state);retry.disabled=busy(state)||!accountCurrent(state);}
  const row=host.querySelector('.snote-finance-lock-feedback');if(row)row.hidden=!feedback(state)&&!hasRetry(state);
  return policy();
 }
 function publish(s,value,source){const previous=s.enabled;s.enabled=value;paint();if(previous!==value&&doc?.dispatchEvent)doc.dispatchEvent(new CustomEvent('snote:finance-lock-changed',{detail:{enabled:value,contextKey:s.key,source}}));}
 function validate(result){if(!result||typeof result.enabled!=='boolean'||!Number.isSafeInteger(result.revision)||result.revision<0)throw Error('INVALID_FINANCE_LOCK_ACK');return {enabled:result.enabled,revision:result.revision};}
 function timeout(promise){let timer;const expired=new Promise((_,reject)=>{timer=global.setTimeout(()=>reject(Error('FINANCE_LOCK_TIMEOUT')),TIMEOUT);});return Promise.race([Promise.resolve(promise),expired]).finally(()=>global.clearTimeout(timer));}
 function localKey(s){return STORAGE_PREFIX+encodeURIComponent(s.account.username);}
 function localRead(s){const raw=global.localStorage.getItem(localKey(s));if(raw===null)return {enabled:defaultValue(s.account.role),revision:0};const stored=JSON.parse(raw);if(stored?.schemaVersion!==1)throw Error('INVALID_LOCAL_FINANCE_LOCK');return validate(stored);}
 function localSave(s,desired,expected){const stored=localRead(s);if(stored.revision!==expected){if(stored.enabled===desired)return stored;throw Error('FINANCE_LOCK_CONFLICT');}const saved={schemaVersion:1,enabled:desired,revision:expected+1};global.localStorage.setItem(localKey(s),JSON.stringify(saved));const ack=localRead(s);if(ack.enabled!==desired||ack.revision!==saved.revision)throw Error('LOCAL_FINANCE_LOCK_UNCONFIRMED');return ack;}
 function requestCurrent(s,operation){return current(s)&&s.operation===operation;}
 async function read(s){
  if(!s||state!==s)return null;if(s.pending)return s.pending;
  const operation=++s.operation;s.status='loading';s.message='';paint();
  const job=Promise.resolve().then(async()=>{
   try{
    if(!current(s)||!s.account.username)throw Error('FINANCE_LOCK_SESSION_UNAVAILABLE');
    const result=s.mode==='local'?localRead(s):await timeout(s.bridge.load(s.context)),saved=validate(result);
    if(!requestCurrent(s,operation))return null;s.revision=saved.revision;s.status='ready';s.message='';publish(s,saved.enabled,'load');return s.enabled;
   }catch(_){
    if(state!==s||s.epoch!==epoch||s.operation!==operation)return null;s.revision=null;s.status='load-error';s.message='잠금 설정을 불러오지 못했습니다. 다시 시도해 주세요.';publish(s,true,'load-error');return true;
   }finally{if(s.operation===operation){s.pending=null;if(state===s)paint();}}
  });s.pending=job;return job;
 }
 function load(account){
  if(!account||typeof account.username!=='string'){reset();return Promise.resolve(true);}
  const api=bridge(),ctx=readContext(api),cloud=actualCloud(account,ctx),snapshot={username:account.username,role:account.role||'dealer'};
  if(state?.pending&&state.account.username===snapshot.username&&state.account.role===snapshot.role&&state.key===(cloud?ctx?.key:'local:'+snapshot.username)&&current(state))return state.pending;
  const s={epoch:++epoch,account:snapshot,key:cloud?ctx?.key||'cloud-unavailable:'+snapshot.username:'local:'+snapshot.username,mode:cloud?'cloud':'local',context:ctx,bridge:api,enabled:true,revision:null,status:'loading',message:'',operation:0,pending:null};state=s;
  if(!supported(snapshot.role)){s.mode='unsupported';s.status='ready';s.enabled=snapshot.role==='accountant'?false:true;paint();return Promise.resolve(s.enabled);}
  if(cloud&&(!ctx||typeof ctx.key!=='string'||!ctx.key||ctx.username!==snapshot.username||ctx.role!==snapshot.role||typeof ctx.companyId!=='string'||!ctx.companyId||typeof ctx.userId!=='string'||!ctx.userId||typeof api?.load!=='function'||typeof api?.current!=='function')){s.status='load-error';s.message='잠금 설정을 불러오지 못했습니다. 로그인 상태를 다시 확인해 주세요.';paint();return Promise.resolve(true);}
  paint();return read(s);
 }
 async function save(desired){
  const s=state;if(!canChange(s)||s.pending||typeof desired!=='boolean'){paint();return false;}if(desired===s.enabled){paint();return true;}
  const expected=s.revision,operation=++s.operation;s.status='saving';s.message='';paint();
  const job=Promise.resolve().then(async()=>{
   try{
    const result=s.mode==='local'?localSave(s,desired,expected):await timeout(s.bridge.save(s.context,desired,expected)),saved=validate(result);
    if(!requestCurrent(s,operation))return false;if(saved.enabled!==desired||saved.revision<expected)throw Error('FINANCE_LOCK_UNCONFIRMED');s.revision=saved.revision;s.status='ready';s.message='저장 완료';publish(s,saved.enabled,'save');return true;
   }catch(error){
    if(state!==s||s.epoch!==epoch||s.operation!==operation)return false;s.status='save-error';s.message=/40001|CONFLICT|revision|다른 화면/i.test(String(error?.code||'')+' '+String(error?.message||''))?'다른 화면에서 잠금 설정이 변경되었습니다. 다시 확인해 주세요.':'잠금 설정을 저장하지 못했습니다. 기존 설정을 유지합니다.';paint();return false;
   }finally{if(s.operation===operation){s.pending=null;if(state===s)paint();}}
  });s.pending=job;return job;
 }
 function reset(){epoch++;state=null;const host=doc?.getElementById?.('snote-finance-lock-setting');if(host){host.hidden=true;const input=host.querySelector('#snote-finance-lock-toggle');if(input){input.checked=true;input.disabled=true;input.setAttribute('aria-checked','true');}const status=host.querySelector('#snote-finance-lock-status');if(status){status.textContent='';status.hidden=true;}const retry=host.querySelector('#snote-finance-lock-retry');if(retry)retry.hidden=true;}}
 function markup(){
  const s=state;if(!s||!supported(s.account.role))return '';const text=feedback(s),retry=hasRetry(s);
  return '<section id="snote-finance-lock-setting" class="snote-finance-lock-setting" aria-labelledby="snote-finance-lock-title" data-state="'+s.status+'" aria-busy="'+busy(s)+'"><div class="snote-finance-lock-copy"><strong id="snote-finance-lock-title">수익·정산 잠금</strong><span id="snote-finance-lock-description">진입 시 비밀번호 확인</span></div><label class="snote-finance-lock-switch"><input id="snote-finance-lock-toggle" type="checkbox" role="switch" aria-label="수익·정산 잠금" aria-describedby="snote-finance-lock-description" aria-checked="'+policy()+'"'+(policy()?' checked':'')+(canChange(s)?'':' disabled')+'></label><div class="snote-finance-lock-feedback"'+(!text&&!retry?' hidden':'')+'><p id="snote-finance-lock-status" role="status" aria-live="polite" data-error="'+retry+'"'+(!text?' hidden':'')+'>'+escape(text)+'</p><button id="snote-finance-lock-retry" type="button"'+(!retry?' hidden':'')+(!accountCurrent(s)?' disabled':'')+'>다시 시도</button></div></section>';
 }
 function refresh(options){if(options?.reload){if(!state)return Promise.resolve(true);if(!current(state))return load(state.account);return read(state);}return paint();}
 doc?.addEventListener?.('change',event=>{if(event.target?.id!=='snote-finance-lock-toggle')return;const desired=event.target.checked;paint();void save(desired);});
 doc?.addEventListener?.('click',event=>{if(event.target?.closest?.('#snote-finance-lock-retry'))void refresh({reload:true});});
 global.SnoteFinanceLock=Object.freeze({load,reset,enabled:policy,markup,refresh});
})(typeof window!=='undefined'?window:globalThis);
