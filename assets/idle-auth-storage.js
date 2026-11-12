/* Session-scoped persistence guard. No credentials are copied to idle markers. */
(function(root){
 'use strict';
 function identity(raw){try{const x=JSON.parse(raw),token=x?.access_token;if(typeof token!=='string')return null;const body=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return typeof body.sub==='string'&&typeof body.session_id==='string'?{userId:body.sub,sessionId:body.session_id}:null;}catch(_){return null;}}
 function expired(project,id,local){if(!id)return false;try{const key='snote-idle:v1:'+encodeURIComponent(project)+':'+encodeURIComponent(id.userId)+':expired:'+encodeURIComponent(id.sessionId),m=JSON.parse(local.getItem(key));return m?.version===1&&m.project===project&&m.userId===id.userId&&m.sessionId===id.sessionId&&Number.isFinite(m.at)&&m.at>0&&m.at<=Date.now()+1000;}catch(_){return false;}}
 function create({project,base,local,session,authKey:customAuthKey,locks:storageLocks=root.navigator?.locks}){
  let revoked=false,expiryRead=null,pin=null,pinnedRaw=null,publish=false,promotion=0,generation=null;
  const keys=new Set(),privateValues=new Map(),authKey=customAuthKey||'sb-'+new URL(project).hostname.split('.')[0]+'-auth-token';
  const ownerKey='snote-auth-owner:v1:'+encodeURIComponent(project)+':'+encodeURIComponent(authKey);
  const allowed=k=>k===authKey||k===authKey+'-code-verifier'||k===authKey+'-user';
  const same=(a,b)=>!!a&&!!b&&a.userId===b.userId&&a.sessionId===b.sessionId;
  const canonical=()=>base.getItem(authKey);
  const owner=()=>{try{const value=JSON.parse(local.getItem(ownerKey));return value?.version===1&&value.project===project&&value.authKey===authKey&&typeof value.userId==='string'&&typeof value.sessionId==='string'&&Number.isSafeInteger(value.generation)&&value.generation>0?value:null;}catch(_){return null;}};
  const canWrite=()=>{const latest=owner();return (!latest||same(latest,pin))&&[local,session].every(store=>{const raw=store.getItem(authKey);return raw===null||raw===undefined||same(identity(raw),pin);});};
  const mutate=work=>typeof storageLocks?.request==='function'?storageLocks.request('snote-auth-storage:'+project+':'+authKey,{mode:'exclusive'},work):work();
  return {
   getItem(key){
    if(allowed(key))keys.add(key);if(revoked)return null;
    let value=base.getItem(key);
    if(key===authKey){
     const stored=identity(value);
     if(!pin&&stored)pin={...stored};
     if(pin){if(same(stored,pin))pinnedRaw=value;else value=pinnedRaw;}
     const id=identity(value),permitted=same(expiryRead,id);
     if(expired(project,id,local)&&!permitted)return null;
    }else if(allowed(key)&&pin){
     if(!same(identity(canonical()),pin))return privateValues.get(key)??null;
     if(value!==null&&value!==undefined)privateValues.set(key,value);
    }
    return value;
   },
   setItem(key,value){const scheduledPromotion=promotion;return mutate(()=>{
    if(revoked||allowed(key)&&scheduledPromotion!==promotion)return;if(allowed(key))keys.add(key);
    if(key===authKey){
     const id=identity(value);if(expired(project,id,local)||pin&&!same(id,pin))return;
     if(!pin&&id)pin={...id};
     if(pin){
      pinnedRaw=value;
      if(!publish&&!canWrite())return;
      const promoting=publish,latest=promoting?owner():null;
      // A successful claim may finish setSession after a newer confirmed tab.
      // Compare the server generations while holding the same storage lock.
      if(promoting&&generation!==null&&latest?.userId===pin.userId&&(latest.generation>generation||latest.generation===generation&&!same(latest,pin))){publish=false;return;}
      if(promoting&&generation!==null)local.setItem(ownerKey,JSON.stringify({version:1,project,authKey,...pin,generation}));
      base.setItem(key,value);publish=false;
      if(promoting){
       for(const related of [authKey+'-code-verifier',authKey+'-user'])if(!privateValues.has(related))base.removeItem(related);
       for(const [related,raw]of privateValues)base.setItem(related,raw);
      }
      return;
     }
    }else if(allowed(key)&&pin){
     privateValues.set(key,value);if(publish||!canWrite())return;
    }
    base.setItem(key,value);
   });},
   removeItem(key){return mutate(()=>{
    if(revoked)return;
    // SDK refresh cleanup has no expected UID/SID. It may arrive from an old
    // attempt after promotion; only the app's identity-bound revoke may erase
    // Auth persistence or the private pin.
    if(allowed(key))return;
    base.removeItem(key);
   });},
   // Only a candidate whose authoritative claim succeeded may switch this
   // client's pin. A foreign tab's SDK event never calls this method.
   authorizeSession(expected){
    if(revoked||!expected||typeof expected.userId!=='string'||!expected.userId||typeof expected.sessionId!=='string'||!expected.sessionId)throw Error('AUTH_STORAGE_SESSION_REQUIRED');
    promotion++;pin={userId:expected.userId,sessionId:expected.sessionId};generation=Number.isSafeInteger(expected.generation)&&expected.generation>0?expected.generation:null;pinnedRaw=null;privateValues.clear();expiryRead=null;publish=true;
   },
   hasDifferentSession(expected){try{return [local,session].some(store=>{const id=identity(store.getItem(authKey));return id&&(id.userId!==expected.userId||id.sessionId!==expected.sessionId);});}catch(_){return true;}},
   beginExpiry(expected){if(!revoked)expiryRead={userId:expected.userId,sessionId:expected.sessionId};},
   revoke(expected,{preserve=false}={}){revoked=true;expiryRead=null;pinnedRaw=null;privateValues.clear();publish=false;if(preserve)return;const cleanup=mutate(()=>{for(const store of [local,session]){let raw;try{raw=store.getItem(authKey);}catch(_){continue;}const id=identity(raw);if(raw&&(!id||id.userId!==expected.userId||id.sessionId!==expected.sessionId))continue;for(const key of [authKey,authKey+'-code-verifier',authKey+'-user',...keys])if(allowed(key))try{store.removeItem(key);}catch(_){}}});cleanup?.catch?.(()=>{});return cleanup;},
   identity,authKey
  };
 }
 root.SnoteIdleAuthStorage={create,identity,expired};
 if(typeof module==='object')module.exports=root.SnoteIdleAuthStorage;
})(typeof window!=='undefined'?window:globalThis);
