/* One confirmed workspace owner per account. JWT fields are comparison hints;
 * only the database claim/status RPC decides ownership. Replacement needs
 * explicit consent tied to the server's observed generation. */
(function(global){'use strict';
 if(global.SnoteSessionOwnership){if(typeof module!=='undefined'&&module.exports)module.exports=global.SnoteSessionOwnership;return;}
 const DEADLINE=8000,POLL=5000,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 let sequence=0;
 const uuid=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():null;
 function identity(session){
  try{
   const token=session?.access_token,userId=uuid(session?.user?.id);
   if(!userId||typeof token!=='string'||token.length>32768)return null;
   const parts=token.split('.');if(parts.length!==3||!parts.every(Boolean)||!/^[A-Za-z0-9_-]+$/.test(parts[1]))return null;
   const encoded=parts[1].replace(/-/g,'+').replace(/_/g,'/'),body=JSON.parse(global.atob(encoded+'='.repeat((4-encoded.length%4)%4)));
   const subject=uuid(body?.sub),sessionId=uuid(body?.session_id);
   return subject===userId&&sessionId?{userId,sessionId,token}:null;
  }catch(_){return null;}
 }
 const same=(a,b)=>!!a&&!!b&&a.userId===b.userId&&a.sessionId===b.sessionId;
 const cleanReason=value=>typeof value==='string'&&value.length<=100?value:'check';
 function create({client,onSuspend,onResume,onRevoked}={}){
  if(!client||typeof client.rpc!=='function'||typeof client.auth?.getSession!=='function')throw TypeError('SESSION_OWNERSHIP_CLIENT_REQUIRED');
  const doc=global.document,number=++sequence,listeners=[];
  let pin=null,epoch=0,version=0,pending=null,allowed=false,revoked=false,stopped=false,state='unbound',reason='initial',generation=null,verifiedAt=null,channel=null,channelEpoch=0,realtimeToken=null,poll=null;
  const online=()=>global.navigator?.onLine!==false;
  const visible=()=>!doc||doc.visibilityState!=='hidden';
  const details=value=>Object.freeze({reason:cleanReason(value),userId:pin?.userId||null,sessionId:pin?.sessionId||null,generation});
  function notify(callback,value){try{const result=callback?.(details(value));if(result&&typeof result.catch==='function')result.catch(()=>{});}catch(_){} }
  function suspend(value){if(stopped||revoked)return;const changed=allowed||state!=='suspended';allowed=false;state='suspended';reason=cleanReason(value);if(changed)notify(onSuspend,reason);}
  function removeChannel(){
   const previous=channel;channel=null;channelEpoch++;realtimeToken=null;
   if(!previous)return;
   try{const removed=typeof client.removeChannel==='function'?client.removeChannel(previous):previous.unsubscribe?.();if(removed?.catch)removed.catch(()=>{});}catch(_){}
  }
  function settle(job,value){
   if(job.done)return;job.done=true;global.clearTimeout(job.timeout);global.clearTimeout(job.start);
   if(pending===job)pending=null;job.resolve(value);
  }
  function armDeadline(job){job.deadline=Date.now()+job.remaining;job.timeout=global.setTimeout(()=>{if(current(job)){suspend('verification-timeout');settle(job,false);}},job.remaining);}
  function pauseDeadline(job){global.clearTimeout(job.timeout);job.timeout=null;job.remaining=Math.max(0,job.deadline-Date.now());}
  function cancel(){if(pending)settle(pending,false);}
  function bind(next,job=null){
   if(same(pin,next))return;
   if(pending&&pending!==job)cancel();epoch++;version++;removeChannel();
   pin={userId:next.userId,sessionId:next.sessionId};generation=null;verifiedAt=null;revoked=false;allowed=false;state='unbound';
   if(job){job.epoch=epoch;job.pin={...pin};}
   suspend('session-bound');
  }
  function current(job){return !stopped&&!revoked&&!job.done&&pending===job&&job.epoch===epoch&&(!job.pin&&!pin||same(job.pin,pin));}
  function revoke(value){
   if(stopped||revoked)return;const boundEpoch=epoch;suspend(value);if(stopped||revoked||epoch!==boundEpoch)return;
   revoked=true;allowed=false;state='revoked';reason=cleanReason(value);removeChannel();notify(onRevoked,reason);
  }
  function resume(ack){
   const changed=!allowed||state!=='active';allowed=true;state='active';reason=cleanReason(ack.reason);generation=ack.generation;verifiedAt=Date.now();if(changed)notify(onResume,reason);
  }
  function updateRealtime(token){
   if(token===realtimeToken)return;realtimeToken=token;
   const boundEpoch=epoch,failed=()=>{if(epoch===boundEpoch&&realtimeToken===token)realtimeToken=null;};
   try{const changed=client.realtime?.setAuth?.(token);if(changed?.catch)changed.catch(failed);}catch(_){failed();}
  }
  function deferCheck(value){
   if(stopped||revoked||!pin)return;
   // No Supabase auth call runs inside an auth/Realtime callback stack.
   version++;suspend(value);void request('status',undefined,value,true);
  }
  function ensureChannel(){
   if(channel||!pin||typeof client.channel!=='function'||stopped||revoked)return;
   const boundEpoch=epoch,boundPin={...pin},subscription=++channelEpoch;
   const valid=()=>!stopped&&!revoked&&epoch===boundEpoch&&subscription===channelEpoch&&same(boundPin,pin);
   try{
    const next=client.channel('snote-session-owner:'+pin.userId+':'+number+':'+subscription);
    channel=next;
    next.on('postgres_changes',{event:'*',schema:'public',table:'snote_session_signals',filter:'user_id=eq.'+pin.userId},payload=>{
     if(!valid())return;
     const row=payload?.new&&Object.keys(payload.new).length?payload.new:payload?.old,uid=row?.user_id;
     if(uid!==undefined&&uuid(uid)!==pin.userId)return;
     if(!Number.isSafeInteger(row?.generation)||row.generation<0)return;
     // A generation says that something changed, never which session won.
     deferCheck('realtime-hint');
    }).subscribe(status=>{
     if(!valid())return;
     if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
      if(status==='CLOSED')removeChannel();
      deferCheck(status==='SUBSCRIBED'?'realtime-ready':'realtime-unavailable');
     }
    });
   }catch(_){removeChannel();}
  }
  async function fresh(job){
   if(!current(job)||!online())throw Error('SESSION_OWNERSHIP_UNAVAILABLE');
   const result=await client.auth.getSession();if(!current(job))throw Error('SESSION_OWNERSHIP_STALE');
   if(result?.error)throw Error('SESSION_OWNERSHIP_AUTH_UNAVAILABLE');
   const found=identity(result?.data?.session);if(!found)throw Error('SESSION_OWNERSHIP_INVALID_SESSION');
   if(!pin){bind(found,job);if(!current(job))throw Error('SESSION_OWNERSHIP_STALE');}
   if(!same(found,pin)||!same(found,job.pin))throw Error('SESSION_OWNERSHIP_CONTEXT_CHANGED');
   updateRealtime(found.token);ensureChannel();return found;
  }
  function acknowledgement(result,mode){
   const ack=result?.data;
   if(result?.error||!ack||typeof ack!=='object'||Array.isArray(ack)||ack.ok!==true||typeof ack.active!=='boolean'||
    uuid(ack.userId)!==pin?.userId||uuid(ack.sessionId)!==pin?.sessionId||!Number.isSafeInteger(ack.generation)||ack.generation<0||
    typeof ack.reason!=='string'||!ack.reason||ack.reason.length>100)throw Error('SESSION_OWNERSHIP_UNCONFIRMED');
   const confirmation=mode==='claim'&&!ack.active&&ack.reason==='CONFIRMATION_REQUIRED'&&ack.requiresConfirmation===true;
   const valid=confirmation||ack.requiresConfirmation!==true&&(ack.active?(ack.reason==='ACTIVE'&&ack.generation>0||mode==='status'&&ack.reason==='LEGACY'&&ack.generation===0):
    ack.reason==='REPLACED'&&ack.generation>0||ack.reason==='SESSION_MISSING');
   if(!valid)throw Error('SESSION_OWNERSHIP_UNCONFIRMED');
   if(ack.active&&generation!==null&&ack.generation<generation)throw Error('SESSION_OWNERSHIP_STALE_GENERATION');
   return ack;
  }
  async function execute(job){
   try{
    let mode=job.mode,confirmArgs=null;
    while(current(job)){
     await fresh(job);if(!current(job))return;
     const revision=version;
     const name=mode==='claim'?'snote_session_claim':'snote_session_status';
     const result=confirmArgs?await client.rpc(name,confirmArgs):await client.rpc(name);
     if(!current(job))return;const ack=acknowledgement(result,mode);
     await fresh(job);if(!current(job)||!online())throw Error('SESSION_OWNERSHIP_UNAVAILABLE');
     if(ack.reason==='CONFIRMATION_REQUIRED'){
      generation=ack.generation;allowed=false;state='confirmation-required';reason='confirmation-required';
      if(typeof job.confirmReplacement!=='function'){settle(job,false);return;}
      // Human decision time is separate from the bounded network budget.
      // Polls and foreground hints join this job and cannot revoke it.
      job.waitingConfirmation=true;pauseDeadline(job);
      const accepted=await job.confirmReplacement(details(reason));
      if(!current(job))return;
      job.waitingConfirmation=false;
      if(accepted!==true){suspend('confirmation-cancelled');settle(job,false);return;}
      armDeadline(job);await fresh(job);if(!current(job))return;
      confirmArgs={p_confirm_replace:true,p_expected_generation:ack.generation};
      continue;
     }
     if(!ack.active){generation=ack.generation;revoke(ack.reason);settle(job,false);return;}
     // A hint arriving after this RPC began makes its active snapshot old.
     // Recheck with the same overall deadline, without another claim.
     if(revision!==version){mode='status';confirmArgs=null;continue;}
     resume(ack);settle(job,true);return;
    }
   }catch(_){if(current(job)){suspend(online()?'verification-unavailable':'offline');settle(job,false);}}
  }
  function request(mode,session,value,immediate=false,options={}){
   if(stopped)return Promise.resolve(false);
   if(mode!=='claim'&&pending?.mode==='claim')return pending.promise;
   const next=session==null?null:identity(session);
   if(session!=null&&!next||mode==='claim'&&!next){cancel();epoch++;version++;removeChannel();suspend('invalid-session');return Promise.resolve(false);}
   if(next)bind(next);
   if(stopped||revoked||next&&!same(next,pin))return Promise.resolve(false);
   const label=cleanReason(value||'check');
   if(immediate||mode==='claim'||!allowed)suspend(label);
   if(stopped||revoked)return Promise.resolve(false);
   if(pending){
    if(mode==='claim'&&pending.mode!=='claim'){cancel();version++;}else return pending.promise;
   }
   let resolve;const promise=new Promise(done=>resolve=done),job={mode,epoch,pin:pin?{...pin}:null,promise,resolve,done:false,start:null,timeout:null,remaining:DEADLINE,deadline:null,waitingConfirmation:false,confirmReplacement:options.confirmReplacement};pending=job;
   armDeadline(job);
   job.start=global.setTimeout(()=>{if(current(job))void execute(job);},0);
   return promise;
  }
  function check(session,value='check'){const label=cleanReason(value);const immediate=!['poll','check','action','require'].includes(label);if(immediate)version++;return request('status',session,label,immediate);}
  function requireOwnership(value='action'){return request('status',undefined,cleanReason(value),false);}
  function listen(target,event,handler){if(typeof target?.addEventListener!=='function')return;target.addEventListener(event,handler);listeners.push(()=>target.removeEventListener?.(event,handler));}
  const foreground=value=>{if(visible()&&online())deferCheck(value);};
  listen(global,'focus',()=>foreground('focus'));listen(global,'pageshow',()=>foreground('pageshow'));listen(global,'online',()=>foreground('online'));
  listen(global,'offline',()=>{if(!stopped&&!revoked&&pin){version++;suspend('offline');}});
  listen(doc,'visibilitychange',()=>{if(visible())foreground('visibility');});
  poll=global.setInterval(()=>{if(!stopped&&!revoked&&pin&&visible()&&online())void request('status',undefined,'poll',false);},POLL);
  function stop(){if(stopped)return;stopped=true;epoch++;version++;allowed=false;state='stopped';reason='stopped';cancel();global.clearInterval(poll);poll=null;removeChannel();for(const remove of listeners.splice(0))try{remove();}catch(_){} }
  const api=Object.freeze({
   claim:(session,options={})=>request('claim',session,'claim',true,options),check,require:requireOwnership,
   authorized:()=>!stopped&&!revoked&&allowed,
   stop,
   inspect:()=>Object.freeze({state,authorized:!stopped&&!revoked&&allowed,userId:pin?.userId||null,sessionId:pin?.sessionId||null,generation,reason,pending:!!pending,waitingConfirmation:pending?.waitingConfirmation===true,stopped,revoked,verifiedAt})
  });
  return api;
 }
 function confirmReplacementDialog({operator=false,current=()=>true}={}){
  if(!global.document?.createElement||!current())return Promise.resolve(false);
  return new Promise(resolve=>{
   const doc=global.document,focus=doc.activeElement,overlay=doc.createElement('div'),panel=doc.createElement('section'),title=doc.createElement('h2'),copy=doc.createElement('p'),actions=doc.createElement('div'),cancel=doc.createElement('button'),accept=doc.createElement('button');
   overlay.id='session-replacement-modal';overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','session-replacement-title');overlay.setAttribute('aria-describedby','session-replacement-copy');
   Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',display:'grid',placeItems:'center',padding:'20px',background:'#27375065'});
   panel.className=operator?'confirm-panel':'modal status-confirm-card';Object.assign(panel.style,{width:'min(420px,100%)',background:'#fff',borderRadius:'17px',padding:'26px',color:'#263954'});
   title.id='session-replacement-title';title.textContent='로그인 확인';copy.id='session-replacement-copy';copy.className=operator?'':'confirm-copy';copy.textContent='다른 곳에서 로그인 중입니다. 기존 접속을 해제하고 로그인하시겠습니까?';Object.assign(copy.style,{fontSize:'13px',lineHeight:'1.8',margin:'16px 0 24px',color:'#64748b'});
   Object.assign(actions.style,{display:'flex',justifyContent:'flex-end',gap:'8px'});cancel.id='session-replacement-cancel';cancel.type='button';cancel.className=operator?'secondary':'btn-ghost';cancel.textContent='취소';accept.id='session-replacement-confirm';accept.type='button';accept.className=operator?'primary':'btn-primary';accept.textContent='로그인';actions.append(cancel,accept);panel.append(title,copy,actions);overlay.append(panel);
   let done=false,timer;
   function finish(value){if(done)return;done=true;global.clearInterval(timer);doc.removeEventListener('keydown',keydown,true);overlay.remove();if(focus?.isConnected&&!focus.closest?.('[inert]'))try{focus.focus({preventScroll:true});}catch(_){}resolve(value===true&&current());}
   function keydown(event){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(false);}else if(event.key==='Tab'){event.preventDefault();event.stopImmediatePropagation();(doc.activeElement===cancel?accept:cancel).focus();}}
   cancel.addEventListener('click',()=>finish(false));accept.addEventListener('click',()=>finish(true));doc.addEventListener('keydown',keydown,true);doc.body.append(overlay);cancel.focus({preventScroll:true});timer=global.setInterval(()=>{if(!current())finish(false);},100);
  });
 }
 const api=Object.freeze({create,confirmReplacementDialog});global.SnoteSessionOwnership=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
