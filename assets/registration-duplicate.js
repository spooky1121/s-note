/* Reuse a registration scan on one existing own purchase vehicle, after an explicit choice. */
(()=>{'use strict';if(window.SnoteRegistrationDuplicate)return;
const bridge=()=>window.snoteRegistrationDuplicateBridge;
let state=null,last=null,timer=null;
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text)e.textContent=text;return e;}
function close(choice=false,invalidated=false){const s=state;if(!s||s.busy&&!invalidated)return;if(invalidated)s.snapshot.invalidated=true;state=null;clearInterval(s.poll);s.root.remove();s.resolve(true);if(choice){last=s.snapshot;bridge()?.notify('중복 차량의 신규 등록은 취소했습니다. 이미지와 입력 내용은 유지됩니다.');}if(s.focus?.isConnected)s.focus.focus({preventScroll:true});}
function show(snapshot){
 let resolve;const promise=new Promise(r=>resolve=r),root=node('div','snote-registration-duplicate');root.id='snote-registration-duplicate';
 const panel=node('section','snote-registration-duplicate-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','snote-registration-duplicate-message');
 const message=node('p','','중복된 차량번호의 매입재고에 자동차 등록증을 등록하시겠습니까?');message.id='snote-registration-duplicate-message';
 const status=node('p','snote-registration-duplicate-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const actions=node('div','snote-registration-duplicate-actions'),no=node('button','btn-ghost','아니오'),yes=node('button','btn-primary','예');no.type=yes.type='button';
 const s={snapshot,root,panel,status,no,yes,resolve,promise,busy:false,messageVersion:0,focus:document.activeElement};state=s;
 no.onclick=()=>close(true);yes.onclick=async()=>{
  if(state!==s||s.busy||!bridge()?.current(snapshot))return;
  const version=++s.messageVersion;s.busy=true;yes.disabled=no.disabled=true;panel.setAttribute('aria-busy','true');status.hidden=false;status.dataset.tone='info';status.textContent='자동차 등록증을 저장하고 있습니다.';
  try{
   const result=await bridge().attach(snapshot);if(state!==s)return;
   s.busy=false;
   if(result?.current&&bridge()?.current(snapshot)){close();bridge().complete(snapshot);}
   else close();
  }catch(error){
   if(state!==s)return;s.busy=false;
   if(!bridge()?.current(snapshot)){close();return;}
   yes.disabled=no.disabled=false;panel.setAttribute('aria-busy','false');
   status.textContent=error?.userMessage||'자동차 등록증을 저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';status.dataset.tone='error';status.hidden=true;
   window.snoteNotify(status.textContent,{tone:'error',key:'registration-duplicate',isCurrent:()=>state===s&&s.messageVersion===version&&root.isConnected&&bridge()?.current(snapshot)===true,returnFocus:yes});
  }
 };
 actions.append(no,yes);panel.append(message,status,actions);root.append(panel);document.body.append(root);
 // Detach an obsolete UI even while a transport is waiting; the guarded
 // transaction still owns its cleanup/receipt and must not claim cancellation.
 s.poll=setInterval(()=>{if(state===s&&!bridge()?.current(snapshot))close(false,true);},150);
 queueMicrotask(()=>{if(state===s)yes.focus();});return promise;
}
async function check({repeat=false}={}){
 const snapshot=bridge()?.snapshot();if(!snapshot?.count)return false;
 if(state){if(bridge()?.current(state.snapshot))return state.promise;if(state.busy)return true;close();}
 if(snapshot.count!==1){bridge()?.notify('같은 차량번호의 본인 매입재고가 여러 대입니다. 기존 차량 목록에서 등록증을 첨부해 주세요.');last=snapshot;return true;}
 if(!repeat&&last&&bridge()?.current(last))return true;
 return show(snapshot);
}
document.addEventListener('keydown',event=>{
 if(!state||window.SnoteMessages?.active())return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!state.busy)close(true);return;}
 if(event.key==='Tab'){const buttons=[state.no,state.yes].filter(e=>!e.disabled);if(!buttons.length){event.preventDefault();return;}const index=buttons.indexOf(document.activeElement);if(event.shiftKey&&index<=0){event.preventDefault();buttons.at(-1).focus();}else if(!event.shiftKey&&(index<0||index===buttons.length-1)){event.preventDefault();buttons[0].focus();}}
},true);
document.getElementById('zc-auto-reg-plate')?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>void check(),250);});
const run=zc77RunAutoRegistrationOCR;
zc77RunAutoRegistrationOCR=async function(file){await run(file);if(zcAutoRegFile===file&&!zc77Busy)await check();};
window.SnoteRegistrationDuplicate=Object.freeze({check});
})();
