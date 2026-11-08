/* Personal inactivity timer. Authentication and pending-change recovery belong to the bridge. */
(function(global){'use strict';
 if(global.SnoteIdleSession)return;
 const doc=global.document,MINUTES=[5,10,15,30,60],DEFAULT=30,PREFIX='snote-idle:v1:',REQUEST_TIMEOUT=15000,ACTIVITY_INTERVAL=1000;
 let state=null,epoch=0;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const validMinutes=value=>typeof value==='number'&&MINUTES.includes(value);
 const identifier=value=>typeof value==='string'&&!!value&&value.length<=512;
 const clock=()=>Date.now();
 const timestamp=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now+1000;
 function storageKeys(project,userId,sessionId){const base=PREFIX+encodeURIComponent(project)+':'+encodeURIComponent(userId);return {activity:base+':activity',session:base+':session:'+encodeURIComponent(sessionId),expired:base+':expired:'+encodeURIComponent(sessionId)};}
 function readJSON(key){try{return JSON.parse(global.localStorage?.getItem(key)||'null');}catch{return null;}}
 function writeJSON(key,value){try{global.localStorage?.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
 function validRecord(value,project,userId,sessionId,now=clock()){return !!value&&value.version===1&&value.project===project&&value.userId===userId&&value.sessionId===sessionId&&timestamp(value.at,now);}
 function wasExpired(project,userId,sessionId){return validRecord(readJSON(storageKeys(project,userId,sessionId).expired),project,userId,sessionId);}
 const bridge=()=>global.snoteIdleSessionBridge;
 function context(api=bridge()){try{return api?.context?.()||null;}catch{return null;}}
 const cloud=(account,ctx)=>!!ctx||!!global.zc86Cloud?.ready||String(account?.username||'').startsWith('cld_');
 function accountCurrent(s){try{return typeof currentUser==='undefined'||!!currentUser&&currentUser.username===s.account.username&&(currentUser.role||'dealer')===s.account.role;}catch{return false;}}
 function current(s){
  if(!s||state!==s||s.epoch!==epoch||!accountCurrent(s))return false;
  if(s.mode==='local')return !cloud(s.account,context());
  const api=bridge(),ctx=context(api);if(api!==s.bridge||!s.context||typeof api?.current!=='function')return false;
  try{return api.current(s.context)===true&&ctx?.key===s.key&&['project','userId','companyId','username','role','client'].every(name=>ctx[name]===s.context[name]);}catch{return false;}
 }
 function ready(s){
  if(!current(s)||!s.sessionId||s.expired)return false;
  if(s.mode==='cloud'&&context(s.bridge)?.ready!==true)return false;
  const app=doc?.getElementById?.('snote-app');
  if(!doc?.body||!app||app.hidden||app.style?.display==='none')return false;
  try{if(typeof global.getComputedStyle==='function'&&global.getComputedStyle(app).display==='none')return false;}catch{return false;}
  return true;
 }
 function notify(source){if(doc?.dispatchEvent&&typeof global.CustomEvent==='function')doc.dispatchEvent(new global.CustomEvent('snote:idle-preference-changed',{detail:{minutes:state?.minutes||DEFAULT,contextKey:state?.key||null,source}}));}
 const busy=s=>s?.status==='loading'||s?.status==='saving';
 const retrying=s=>s?.status==='load-error'||s?.status==='save-error';
 const canChange=s=>!!s&&current(s)&&s.confirmed&&!s.expired&&!busy(s)&&['dealer','admin'].includes(s.account.role);
 function feedback(s){return s?.status==='loading'?'설정을 불러오는 중…':s?.status==='saving'?'저장 중…':s?.message||'';}
 function render(){
  const host=doc?.getElementById?.('snote-idle-session-setting');if(!host)return state?.minutes||DEFAULT;
  const s=state;host.hidden=!s||!['dealer','admin'].includes(s.account.role);if(!s)return DEFAULT;
  host.dataset.state=s.status;host.setAttribute('aria-busy',String(busy(s)));
  const input=host.querySelector('#snote-idle-minutes'),status=host.querySelector('#snote-idle-status'),retry=host.querySelector('#snote-idle-retry'),row=host.querySelector('.snote-idle-feedback');
  if(input){input.value=String(s.minutes);input.disabled=!canChange(s);}
  if(status){status.textContent=feedback(s);status.hidden=!feedback(s);status.dataset.error=String(retrying(s));}
  if(retry){retry.hidden=!retrying(s);retry.disabled=busy(s)||!accountCurrent(s);}
  if(row)row.hidden=!feedback(s)&&!retrying(s);return s.minutes;
 }
 function markup(){
  const s=state;if(!s||!['dealer','admin'].includes(s.account.role))return '';
  const text=feedback(s),retry=retrying(s);
  return '<section id="snote-idle-session-setting" aria-labelledby="snote-idle-title" data-state="'+s.status+'" aria-busy="'+busy(s)+'"><div class="snote-idle-copy"><strong id="snote-idle-title">자동 로그아웃</strong><span id="snote-idle-description">선택한 시간 동안 사용하지 않으면 로그아웃합니다.</span></div><select id="snote-idle-minutes" aria-label="자동 로그아웃 대기 시간" aria-describedby="snote-idle-description"'+(canChange(s)?'':' disabled')+'>'+MINUTES.map(value=>'<option value="'+value+'"'+(s.minutes===value?' selected':'')+'>'+value+'분</option>').join('')+'</select><div class="snote-idle-feedback"'+(!text&&!retry?' hidden':'')+'><p id="snote-idle-status" role="status" aria-live="polite" data-error="'+retry+'"'+(!text?' hidden':'')+'>'+escape(text)+'</p><button id="snote-idle-retry" type="button"'+(!retry?' hidden':'')+'>다시 시도</button></div></section>';
 }
 function timeout(promise){let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=global.setTimeout(()=>reject(Error('IDLE_SESSION_TIMEOUT')),REQUEST_TIMEOUT);})]).finally(()=>global.clearTimeout(timer));}
 function validActivity(value,s,now){
  if(!value||value.version!==1||value.project!==s.project||value.userId!==s.userId||!timestamp(value.at,now)||!value.since)return false;
  return MINUTES.every(minutes=>timestamp(value.since[minutes],now)&&value.since[minutes]<=value.at);
 }
 function readActivity(s,now){const value=readJSON(s.keys.activity);return validActivity(value,s,now)?value:null;}
 function adopt(s,value,now){
  if(!validActivity(value,s,now))return;
  if(!s.activity||value.at>s.activity.at)s.activity=value;
  if(value.at>s.lastActivity&&value.since[s.minutes]<=s.lastActivity+s.minutes*60000)s.lastActivity=Math.min(value.at,now);
 }
 function sessionRecord(s){return {version:1,project:s.project,userId:s.userId,sessionId:s.sessionId,at:s.startedAt,lastActivity:s.lastActivity};}
 function publish(s){
  if(!current(s)||!s.armed||s.expired)return;
  const now=clock(),previous=readActivity(s,now);if(previous&&(!s.activity||previous.at>s.activity.at))s.activity=previous;
  if(s.activity)writeJSON(s.keys.activity,s.activity);writeJSON(s.keys.session,sessionRecord(s));s.publishedAt=now;
  try{if(s.activity)s.channel?.postMessage({type:'activity',value:s.activity});}catch{}
 }
 function schedulePublish(s,now){
  if(now-s.publishedAt>=ACTIVITY_INTERVAL){publish(s);return;}
  if(!s.publishTimer)s.publishTimer=global.setTimeout(()=>{s.publishTimer=null;publish(s);},ACTIVITY_INTERVAL-(now-s.publishedAt));
 }
 function closeWarning(s){
  const dialog=s?.dialog;if(!dialog)return;s.dialog=null;
  try{if(dialog.open)dialog.close();}catch{}dialog.remove?.();
 }
 function warning(s,remaining){
  if(!doc?.body)return;
  let dialog=s.dialog;
  if(!dialog){
   dialog=doc.createElement('dialog');dialog.id='snote-idle-warning';dialog.className='snote-idle-warning';dialog.setAttribute('aria-labelledby','snote-idle-warning-title');dialog.setAttribute('aria-describedby','snote-idle-warning-description');
   dialog.innerHTML='<div class="snote-idle-warning-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></div><h2 id="snote-idle-warning-title">자동 로그아웃 예정</h2><p id="snote-idle-warning-description">잠시 후 개인정보 보호를 위해 로그아웃합니다.</p><p class="snote-idle-countdown" role="timer" aria-live="off"></p><button id="snote-idle-continue" type="button">계속 사용</button>';
   dialog.addEventListener('cancel',event=>event.preventDefault());
   dialog.querySelector('#snote-idle-continue')?.addEventListener('click',event=>{if(event.isTrusted===true)activity(event,s);});
   doc.body.appendChild(dialog);s.dialog=dialog;
   try{dialog.showModal();}catch{dialog.setAttribute('open','');}
   dialog.querySelector('#snote-idle-continue')?.focus?.();
  }
  const seconds=Math.max(0,Math.ceil(remaining/1000)),label=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  const counter=dialog.querySelector('.snote-idle-countdown');if(counter)counter.textContent=label;
 }
 function expire(s,reason){
  if(!current(s)||s.expired||!s.armed)return false;
  s.expired=true;const record={version:1,project:s.project,userId:s.userId,sessionId:s.sessionId,at:clock()};
  writeJSON(s.keys.expired,record);closeWarning(s);if(s.publishTimer){global.clearTimeout(s.publishTimer);s.publishTimer=null;}
  if(s.interval){global.clearInterval(s.interval);s.interval=null;}
  try{s.channel?.postMessage({type:'expired',value:record});}catch{}
  render();
  // The bridge must conceal private UI immediately, before its first asynchronous operation.
  try{if(current(s)&&s.mode==='cloud'&&typeof s.bridge?.expire==='function')Promise.resolve(s.bridge.expire(s.context,{sessionId:s.sessionId,reason})).catch(()=>{});
   else if(doc?.dispatchEvent&&typeof global.CustomEvent==='function')doc.dispatchEvent(new global.CustomEvent('snote:idle-expired',{detail:{sessionId:s.sessionId,reason,contextKey:s.key}}));
  }catch{}
  return true;
 }
 function connect(s){
  try{if(typeof global.BroadcastChannel==='function'){s.channel=new global.BroadcastChannel('snote-idle:v1:'+encodeURIComponent(s.project)+':'+encodeURIComponent(s.userId));s.channel.onmessage=event=>receive(s,event.data);}}catch{}
 }
 function arm(s,now){
  if(s.armed||!ready(s))return false;
  s.keys=storageKeys(s.project,s.userId,s.sessionId);const stored=readJSON(s.keys.session);
  if(validRecord(stored,s.project,s.userId,s.sessionId,now)){
   s.startedAt=Math.min(stored.at,now);s.lastActivity=timestamp(stored.lastActivity,now)&&stored.lastActivity>=stored.at?Math.min(stored.lastActivity,now):s.startedAt;
  }else{s.startedAt=now;s.lastActivity=now;}
  s.armed=true;s.publishedAt=0;connect(s);
  if(wasExpired(s.project,s.userId,s.sessionId)){expire(s,'remote');return true;}
  const shared=readActivity(s,now);if(shared)adopt(s,shared,now);
  writeJSON(s.keys.session,sessionRecord(s));return true;
 }
 function tick(){
  const s=state;if(!s||!current(s)||s.expired)return false;
  const now=clock();if(!s.armed&&!arm(s,now))return false;
  if(wasExpired(s.project,s.userId,s.sessionId)){expire(s,'remote');return false;}
  const shared=readActivity(s,now);if(shared)adopt(s,shared,now);
  const remaining=s.lastActivity+s.minutes*60000-now;
  if(remaining<=0){expire(s,'idle');return false;}
  if(remaining<=60000)warning(s,remaining);else closeWarning(s);
  bindFrames(s);return true;
 }
 function activity(event,expected=state){
  const s=state;if(!s||s!==expected||event?.isTrusted!==true||!tick()||!s.armed||s.expired)return false;
  const now=clock(),previous=s.activity||readActivity(s,now),since={};
  for(const minutes of MINUTES)since[minutes]=previous&&now-previous.at<minutes*60000?previous.since[minutes]:now;
  s.lastActivity=now;s.activity={version:1,project:s.project,userId:s.userId,at:now,since};closeWarning(s);schedulePublish(s,now);return true;
 }
 function receive(s,message){
  if(!current(s)||!s.armed||s.expired||!message)return;
  if(message.type==='expired'&&validRecord(message.value,s.project,s.userId,s.sessionId)){expire(s,'remote');return;}
  if(message.type==='activity'){adopt(s,message.value,clock());tick();}
 }
 const INPUT_EVENTS=['pointerdown','keydown','wheel','touchstart','touchmove'];
 function bindDocument(target,s){
  if(!target||s.documents.has(target))return;s.documents.add(target);
  for(const type of INPUT_EVENTS){const handler=event=>activity(event,s);target.addEventListener(type,handler,{capture:true,passive:true});s.cleanups.push(()=>target.removeEventListener(type,handler,{capture:true}));}
 }
 function bindFrames(s){
  if(!current(s))return;
  for(const frame of doc?.querySelectorAll?.('iframe')||[]){
   if(!s.frames.has(frame)){s.frames.add(frame);const handler=()=>{try{bindDocument(frame.contentDocument,s);}catch{}};frame.addEventListener('load',handler);s.cleanups.push(()=>frame.removeEventListener('load',handler));}
   try{bindDocument(frame.contentDocument,s);}catch{}
  }
 }
 function start(s){
  if(!current(s)||s.interval)return;bindDocument(doc,s);bindFrames(s);s.interval=global.setInterval(tick,1000);tick();
 }
 function localKey(s){return PREFIX+'preference:'+encodeURIComponent(s.account.username);}
 function localRead(s){const stored=readJSON(localKey(s));if(stored===null)return DEFAULT;if(stored.version!==1||!validMinutes(stored.minutes))throw Error('INVALID_IDLE_LOCAL');return stored.minutes;}
 function localSession(s){
  const key=PREFIX+'local-session:'+encodeURIComponent(s.account.username);let value;try{value=global.sessionStorage?.getItem(key);if(!identifier(value)){value='local-'+clock()+'-'+Math.random().toString(36).slice(2);global.sessionStorage?.setItem(key,value);}}catch{}
  return identifier(value)?value:'local-'+clock()+'-'+Math.random().toString(36).slice(2);
 }
 const operationCurrent=(s,operation)=>current(s)&&s.operation===operation;
 function read(s){
  if(!current(s))return Promise.resolve(false);if(s.pending)return s.pending;
  const operation=++s.operation;s.status='loading';s.message='';render();
  const job=Promise.resolve().then(async()=>{
   try{
    const result=s.mode==='local'?{minutes:localRead(s),sessionId:localSession(s)}:await timeout(s.bridge.load(s.context));
    if(!operationCurrent(s,operation))return false;
    if(!validMinutes(result?.minutes)||!identifier(result?.sessionId))throw Error('INVALID_IDLE_ACK');
    if(s.armed&&s.sessionId!==result.sessionId)throw Error('IDLE_SESSION_CHANGED');
    s.minutes=result.minutes;s.sessionId=result.sessionId;s.confirmed=true;s.status=result.fallback===true?'load-error':'ready';s.message=result.fallback===true?'설정을 불러오지 못해 30분을 적용합니다. 다시 시도해 주세요.':'';start(s);tick();render();notify(result.fallback===true?'load-error':'load');return result.fallback!==true;
   }catch{
    if(!operationCurrent(s,operation))return false;
    if(!s.confirmed){s.minutes=DEFAULT;const sid=s.mode==='local'?localSession(s):s.context?.sessionId;if(identifier(sid)){s.sessionId=sid;s.confirmed=true;start(s);}}
    s.status='load-error';s.message='설정을 불러오지 못해 '+s.minutes+'분을 적용합니다. 다시 시도해 주세요.';render();notify('load-error');return false;
   }finally{if(s.operation===operation){s.pending=null;if(state===s)render();}}
  });s.pending=job;return job;
 }
 function load(account){
  if(!account||!identifier(account.username)){reset();return Promise.resolve(false);}
  const api=bridge(),ctx=context(api),isCloud=cloud(account,ctx),snapshot={username:account.username,role:account.role||'dealer'},key=isCloud?ctx?.key:'local:'+snapshot.username;
  if(state&&state.account.username===snapshot.username&&state.account.role===snapshot.role&&state.key===key&&current(state)){if(state.pending)return state.pending;if(state.confirmed){tick();render();return Promise.resolve(true);}}
  reset();state={epoch:++epoch,account:snapshot,key,mode:isCloud?'cloud':'local',bridge:api,context:ctx,project:isCloud?ctx?.project:'local',userId:isCloud?ctx?.userId:snapshot.username,sessionId:null,minutes:DEFAULT,confirmed:false,status:'loading',message:'',operation:0,pending:null,armed:false,expired:false,lastActivity:0,startedAt:0,publishedAt:0,activity:null,dialog:null,interval:null,publishTimer:null,channel:null,documents:new WeakSet(),frames:new WeakSet(),cleanups:[]};
  const s=state;
  if(isCloud&&(!identifier(ctx?.key)||!identifier(ctx?.project)||!identifier(ctx?.userId)||!identifier(ctx?.companyId)||ctx.username!==snapshot.username||ctx.role!==snapshot.role||typeof api?.load!=='function'||typeof api?.current!=='function')){s.status='load-error';s.message='로그인 상태를 확인한 뒤 다시 시도해 주세요.';render();return Promise.resolve(false);}
  return read(s);
 }
 function save(minutes){
  const s=state;if(!canChange(s)||s.pending||!validMinutes(minutes)){render();return Promise.resolve(false);}if(minutes===s.minutes){render();return Promise.resolve(true);}
  const operation=++s.operation;s.status='saving';s.message='';render();
  const job=Promise.resolve().then(async()=>{
   try{
    if(!current(s)||s.expired)throw Error('IDLE_SESSION_CHANGED');
    let result;if(s.mode==='local'){writeJSON(localKey(s),{version:1,minutes});result={minutes:localRead(s)};}else result=await timeout(s.bridge.save(s.context,minutes));
    if(!operationCurrent(s,operation)||s.expired)return false;
    if(!validMinutes(result?.minutes)||result.minutes!==minutes)throw Error('INVALID_IDLE_SAVE_ACK');
    s.minutes=minutes;s.status='ready';s.message='저장 완료';tick();render();notify('save');return true;
   }catch{if(!operationCurrent(s,operation)||s.expired)return false;s.status='save-error';s.message='설정을 저장하지 못했습니다. 기존 시간을 유지합니다.';render();return false;}
   finally{if(s.operation===operation){s.pending=null;if(state===s)render();}}
  });s.pending=job;return job;
 }
 function reset(){
  const s=state;epoch++;state=null;if(s){closeWarning(s);if(s.interval)global.clearInterval(s.interval);if(s.publishTimer)global.clearTimeout(s.publishTimer);try{s.channel?.close();}catch{}for(const cleanup of s.cleanups)try{cleanup();}catch{}}
  render();
 }
 doc?.addEventListener?.('change',event=>{if(event.target?.id!=='snote-idle-minutes')return;const desired=Number(event.target.value);render();void save(desired);});
 doc?.addEventListener?.('click',event=>{if(event.target?.closest?.('#snote-idle-retry')&&state){const s=state;void(current(s)?read(s):load(s.account));}});
 doc?.addEventListener?.('visibilitychange',tick);
 for(const name of ['focus','pageshow','afterprint'])global.addEventListener?.(name,tick);
 global.addEventListener?.('storage',event=>{const s=state;if(!s||!s.keys||!current(s))return;if(event.key===s.keys.expired||event.key===s.keys.activity)tick();});
 global.SnoteIdleSession=Object.freeze({load,reset,markup,render,tick,save,storageKeys,wasExpired,inspect:()=>state?{minutes:state.minutes,status:state.status,armed:state.armed,expired:state.expired,sessionId:state.sessionId,lastActivity:state.lastActivity,deadline:state.lastActivity+state.minutes*60000,warning:!!state.dialog,contextKey:state.key}:null});
})(typeof window!=='undefined'?window:globalThis);
