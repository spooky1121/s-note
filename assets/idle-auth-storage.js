/* Session-scoped persistence guard. No credentials are copied to idle markers. */
(function(root){
 'use strict';
 function identity(raw){try{const x=JSON.parse(raw),token=x?.access_token;if(typeof token!=='string')return null;const body=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return typeof body.sub==='string'&&typeof body.session_id==='string'?{userId:body.sub,sessionId:body.session_id}:null;}catch(_){return null;}}
 function expired(project,id,local){if(!id)return false;try{const key='snote-idle:v1:'+encodeURIComponent(project)+':'+encodeURIComponent(id.userId)+':expired:'+encodeURIComponent(id.sessionId),m=JSON.parse(local.getItem(key));return m?.version===1&&m.project===project&&m.userId===id.userId&&m.sessionId===id.sessionId&&Number.isFinite(m.at)&&m.at>0&&m.at<=Date.now()+1000;}catch(_){return false;}}
 function create({project,base,local,session}){
  let revoked=false,expiryRead=null;const keys=new Set(),authKey='sb-'+new URL(project).hostname.split('.')[0]+'-auth-token';
  const allowed=k=>k===authKey||k===authKey+'-code-verifier'||k===authKey+'-user';
  return {
   getItem(key){if(allowed(key))keys.add(key);if(revoked)return null;const value=base.getItem(key);if(key===authKey){const id=identity(value),permitted=expiryRead&&id?.userId===expiryRead.userId&&id?.sessionId===expiryRead.sessionId;if(expired(project,id,local)&&!permitted)return null;}return value;},
   setItem(key,value){if(revoked)return;if(allowed(key))keys.add(key);if(key===authKey&&expired(project,identity(value),local))return;base.setItem(key,value);},
   removeItem(key){if(!revoked)base.removeItem(key);},
   hasDifferentSession(expected){try{return [local,session].some(store=>{const id=identity(store.getItem(authKey));return id&&(id.userId!==expected.userId||id.sessionId!==expected.sessionId);});}catch(_){return true;}},
   beginExpiry(expected){if(!revoked)expiryRead={userId:expected.userId,sessionId:expected.sessionId};},
   revoke(expected,{preserve=false}={}){revoked=true;expiryRead=null;if(preserve)return;for(const store of [local,session]){let raw;try{raw=store.getItem(authKey);}catch(_){continue;}const id=identity(raw);if(raw&&(!id||id.userId!==expected.userId||id.sessionId!==expected.sessionId))continue;for(const key of [authKey,authKey+'-code-verifier',authKey+'-user',...keys])if(allowed(key))try{store.removeItem(key);}catch(_){}}},
   identity,authKey
  };
 }
 root.SnoteIdleAuthStorage={create,identity,expired};
 if(typeof module==='object')module.exports=root.SnoteIdleAuthStorage;
})(typeof window!=='undefined'?window:globalThis);
