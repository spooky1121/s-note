/* Login-local scan references only. Private bytes and credentials never enter storage. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else if(!root.SnoteScannerSession)root.SnoteScannerSession=api;})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const PREFIX='snote:scanner-session:v1:',LIMIT=200,MAX_JSON=16384,MAX_INPUT=4096,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,NIL='00000000-0000-0000-0000-000000000000';
 const validKey=value=>typeof value==='string'&&value.startsWith(PREFIX)&&/^[a-f0-9]{64}$/.test(value.slice(PREFIX.length));
 function references(value){
  if(!Array.isArray(value)||value.length>MAX_INPUT)return[];
  const result=[],seen=new Set();
  for(const item of value){if(typeof item!=='string'||!UUID.test(item))continue;const id=item.toLowerCase();if(id===NIL||seen.has(id))continue;seen.add(id);result.push(id);if(result.length===LIMIT)break;}
  return result;
 }
 async function keyFor(raw){
  if(typeof raw!=='string'||!raw.trim()||raw.length>8192||/[\u0000-\u001f\u007f]/.test(raw))throw Error('SCANNER_SESSION_INVALID_SCOPE');
  if(typeof root.crypto?.subtle?.digest!=='function'||typeof root.TextEncoder!=='function')throw Error('SCANNER_SESSION_CRYPTO_UNAVAILABLE');
  const bytes=new Uint8Array(await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(raw)));
  if(bytes.length!==32)throw Error('SCANNER_SESSION_CRYPTO_UNAVAILABLE');
  return PREFIX+Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 }
 function read(storage,key){
  try{if(!validKey(key)||typeof storage?.getItem!=='function')return[];const raw=storage.getItem(key);if(typeof raw!=='string'||raw.length>MAX_JSON)return[];return references(JSON.parse(raw));}catch{return[];}
 }
 function write(storage,key,value){
  if(!validKey(key))return[];
  const ids=references(value);try{if(typeof storage?.setItem==='function')storage.setItem(key,JSON.stringify(ids));}catch{/* The caller can keep the returned references in memory. */}
  return ids;
 }
 function clear(storage){
  let removed=0;try{if(typeof storage?.key!=='function'||typeof storage?.removeItem!=='function'||!Number.isSafeInteger(storage.length)||storage.length<0)return removed;const names=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(typeof key==='string'&&key.startsWith(PREFIX))names.push(key);}for(const key of names)try{storage.removeItem(key);removed++;}catch{/* Continue clearing other owned references. */}}catch{/* Storage may be unavailable in this browser. */}return removed;
 }
 return Object.freeze({keyFor,read,write,clear,LIMIT});
});
