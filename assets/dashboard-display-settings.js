/* A personal display preference only; it never changes finance access or accounting data. */
(function(global){'use strict';
 if(global.SnoteDashboardDisplay)return;
 const doc=global.document,TIMEOUT=15000,PREFIX='snote-dashboard-display:v1:';
 let state=null,epoch=0;
 const supported=role=>role==='dealer'||role==='admin';
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const bridge=()=>global.snoteDashboardDisplayBridge;
 function context(api=bridge()){try{return api?.context?.()||null;}catch{return null;}}
 const cloud=(account,ctx)=>!!ctx||!!global.zc86Cloud?.ready||String(account?.username||'').startsWith('cld_');
 function accountCurrent(s){try{return typeof currentUser==='undefined'||!!currentUser&&currentUser.username===s.account.username&&(currentUser.role||'dealer')===s.account.role;}catch{return false;}}
 function current(s){
  if(!s||state!==s||s.epoch!==epoch||!accountCurrent(s))return false;
  if(s.mode==='unsupported')return true;
  if(s.mode==='local')return !cloud(s.account,context());
  const api=bridge(),now=context(api);if(api!==s.bridge||!s.context||typeof api?.current!=='function')return false;
  try{return api.current(s.context)===true&&now?.key===s.key&&['companyId','userId','username','role','client'].every(field=>now[field]===s.context[field]);}catch{return false;}
 }
 const hidden=()=>!state||!current(state)||!state.confirmed?true:state.hidden;
 const busy=s=>s?.status==='loading'||s?.status==='saving';
 const canChange=s=>!!s&&supported(s.account.role)&&s.confirmed&&current(s)&&s.status==='ready';
 const retrying=s=>!!s&&['load-error','save-error'].includes(s.status);
 function feedback(s){return s?.status==='loading'?'설정을 불러오는 중…':s?.status==='saving'?'저장 중…':s?.message||'';}
 function paint(){
  const host=doc?.getElementById?.('snote-dashboard-margin-setting');if(!host)return hidden();
  if(!state||!supported(state.account.role)){host.hidden=true;return hidden();}
  host.hidden=false;host.dataset.state=state.status;host.setAttribute('aria-busy',String(busy(state)));
  const input=host.querySelector('#snote-dashboard-margin-toggle'),status=host.querySelector('#snote-dashboard-margin-status'),retry=host.querySelector('#snote-dashboard-margin-retry');
  if(input){input.checked=hidden();input.disabled=!canChange(state);input.setAttribute('aria-checked',String(input.checked));}
  if(status){status.textContent=feedback(state);status.hidden=!status.textContent;status.dataset.error=String(retrying(state));}
  if(retry){retry.hidden=!retrying(state);retry.disabled=busy(state)||!accountCurrent(state);}
  const row=host.querySelector('.snote-dashboard-margin-feedback');if(row)row.hidden=!feedback(state)&&!retrying(state);
  return hidden();
 }
 function notify(source){if(doc?.dispatchEvent&&typeof global.CustomEvent==='function')doc.dispatchEvent(new global.CustomEvent('snote:dashboard-display-changed',{detail:{hidden:hidden(),contextKey:state?.key||null,source}}));}
 function validate(result){if(!result||typeof result.hidden!=='boolean')throw Error('INVALID_DASHBOARD_DISPLAY_ACK');return result.hidden;}
 function timeout(promise){let timer;const expired=new Promise((_,reject)=>{timer=global.setTimeout(()=>reject(Error('DASHBOARD_DISPLAY_TIMEOUT')),TIMEOUT);});return Promise.race([Promise.resolve(promise),expired]).finally(()=>global.clearTimeout(timer));}
 const key=s=>PREFIX+encodeURIComponent(s.account.username);
 function localRead(s){const raw=global.localStorage.getItem(key(s));if(raw===null)return false;const stored=JSON.parse(raw);if(stored?.schemaVersion!==1)throw Error('INVALID_DASHBOARD_DISPLAY_LOCAL');return validate(stored);}
 function localSave(s,desired){global.localStorage.setItem(key(s),JSON.stringify({schemaVersion:1,hidden:desired}));return {hidden:localRead(s)};}
 const operationCurrent=(s,operation)=>current(s)&&s.operation===operation;
 function read(s){
  if(!s||state!==s)return Promise.resolve(true);if(s.pending)return s.pending;
  const operation=++s.operation;s.status='loading';s.message='';paint();notify('loading');
  const job=Promise.resolve().then(async()=>{
   try{
    if(!current(s)||!s.account.username)throw Error('DASHBOARD_DISPLAY_SESSION');
    const value=s.mode==='local'?localRead(s):validate(await timeout(s.bridge.load(s.context)));
    if(!operationCurrent(s,operation))return true;s.hidden=value;s.confirmed=true;s.status='ready';s.message='';paint();notify('load');return value;
   }catch(_){
    if(state!==s||s.epoch!==epoch||s.operation!==operation)return true;s.status='load-error';s.message='표시 설정을 불러오지 못했습니다. 다시 시도해 주세요.';paint();notify('load-error');return hidden();
   }finally{if(s.operation===operation){s.pending=null;if(state===s)paint();}}
  });s.pending=job;return job;
 }
 function load(account){
  if(!account||typeof account.username!=='string'){reset();return Promise.resolve(true);}
  const api=bridge(),ctx=context(api),isCloud=cloud(account,ctx),snapshot={username:account.username,role:account.role||'dealer'};
  if(state?.pending&&state.account.username===snapshot.username&&state.account.role===snapshot.role&&state.key===(isCloud?ctx?.key:'local:'+snapshot.username)&&current(state))return state.pending;
  state={epoch:++epoch,account:snapshot,key:isCloud?ctx?.key||'cloud-unavailable:'+snapshot.username:'local:'+snapshot.username,mode:isCloud?'cloud':'local',bridge:api,context:ctx,hidden:true,confirmed:false,status:'loading',message:'',operation:0,pending:null};
  const s=state;
  if(!supported(snapshot.role)){s.mode='unsupported';s.status='ready';paint();notify('unsupported');return Promise.resolve(true);}
  if(isCloud&&(!ctx||typeof ctx.key!=='string'||!ctx.key||ctx.username!==snapshot.username||ctx.role!==snapshot.role||typeof ctx.companyId!=='string'||!ctx.companyId||typeof ctx.userId!=='string'||!ctx.userId||typeof api?.load!=='function'||typeof api?.current!=='function')){s.status='load-error';s.message='표시 설정을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.';paint();notify('load-error');return Promise.resolve(true);}
  return read(s);
 }
 function save(desired){
  const s=state;if(!canChange(s)||s.pending||typeof desired!=='boolean'){paint();return Promise.resolve(false);}if(desired===s.hidden){paint();return Promise.resolve(true);}
  const operation=++s.operation;s.status='saving';s.message='';paint();
  const job=Promise.resolve().then(async()=>{
   try{
    const saved=validate(s.mode==='local'?localSave(s,desired):await timeout(s.bridge.save(s.context,desired)));
    if(!operationCurrent(s,operation))return false;if(saved!==desired)throw Error('DASHBOARD_DISPLAY_UNCONFIRMED');s.hidden=saved;s.confirmed=true;s.status='ready';s.message='저장 완료';paint();notify('save');return true;
   }catch(_){
    if(state!==s||s.epoch!==epoch||s.operation!==operation)return false;s.status='save-error';s.message='표시 설정을 저장하지 못했습니다. 기존 설정을 유지합니다.';paint();notify('save-error');return false;
   }finally{if(s.operation===operation){s.pending=null;if(state===s)paint();}}
  });s.pending=job;return job;
 }
 function reset(){epoch++;state=null;const host=doc?.getElementById?.('snote-dashboard-margin-setting');if(host){host.hidden=true;const input=host.querySelector('#snote-dashboard-margin-toggle');if(input){input.checked=true;input.disabled=true;input.setAttribute('aria-checked','true');}const status=host.querySelector('#snote-dashboard-margin-status');if(status){status.textContent='';status.hidden=true;}}notify('reset');}
 function markup(){
  const s=state;if(!s||!supported(s.account.role))return '';const text=feedback(s),retry=retrying(s);
  return '<section id="snote-dashboard-margin-setting" aria-labelledby="snote-dashboard-margin-title" data-state="'+s.status+'" aria-busy="'+busy(s)+'"><div class="snote-dashboard-margin-copy"><strong id="snote-dashboard-margin-title">대시보드 마진 숨기기</strong><span id="snote-dashboard-margin-description">이번 달·올해 마진을 -로 표시합니다.</span></div><label class="snote-dashboard-margin-switch"><input id="snote-dashboard-margin-toggle" type="checkbox" role="switch" aria-label="대시보드 마진 숨기기" aria-describedby="snote-dashboard-margin-description" aria-checked="'+hidden()+'"'+(hidden()?' checked':'')+(canChange(s)?'':' disabled')+'></label><div class="snote-dashboard-margin-feedback"'+(!text&&!retry?' hidden':'')+'><p id="snote-dashboard-margin-status" role="status" aria-live="polite" data-error="'+retry+'"'+(!text?' hidden':'')+'>'+escape(text)+'</p><button id="snote-dashboard-margin-retry" type="button"'+(!retry?' hidden':'')+(!accountCurrent(s)?' disabled':'')+'>다시 시도</button></div></section>';
 }
 doc?.addEventListener?.('change',event=>{if(event.target?.id!=='snote-dashboard-margin-toggle')return;const desired=event.target.checked;paint();void save(desired);});
 doc?.addEventListener?.('click',event=>{if(event.target?.closest?.('#snote-dashboard-margin-retry')&&state){const s=state;void(current(s)?read(s):load(s.account));}});
 global.SnoteDashboardDisplay=Object.freeze({load,reset,hidden,markup,render:paint});
})(typeof window!=='undefined'?window:globalThis);
