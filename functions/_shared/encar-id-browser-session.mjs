// Server-owned Browser Run session metadata only. No socket, stream, token,
// vehicle or customer record is stored. Cache API is local/best effort; it is
// deliberately not treated as a distributed lock.
export const BROWSER_KEEP_ALIVE_MS = 30000;
const METADATA_TTL_MS = 25000;
const CACHE_NAME = 'snote:encar-browser-session:v1';
const POLICY_VERSION = 'external-id-browser-guardrails-v2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultState = { known: new Map(), creating: new Map() };
const states = new WeakMap();

function fail(code='BROWSER_UNAVAILABLE',extras={}){return Object.assign(new Error(code),{code,...extras});}
function aborted(){return Object.assign(fail('ABORTED'),{name:'AbortError'});}
export function browserRetryAfter(response){
 const value=response.headers?.get('Retry-After')||'';
 if(/^[0-9]{1,10}$/.test(value))return Math.max(1,Math.min(3600,Number(value)));
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(1,Math.min(3600,Math.ceil((date-Date.now())/1000))):20;
}
function stateFor(storage){if(!storage||(typeof storage!=='object'&&typeof storage!=='function'))return defaultState;let state=states.get(storage);if(!state){state={known:new Map(),creating:new Map()};states.set(storage,state);}return state;}
async function bounded(operation,milliseconds=250){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail()),milliseconds);})]);}finally{clearTimeout(timer);}}
async function interruptible(operation,signal){if(signal?.aborted)throw aborted();let stop;const interrupted=new Promise((_,reject)=>{if(signal){stop=()=>reject(aborted());signal.addEventListener('abort',stop,{once:true});}});try{return await Promise.race([operation,interrupted]);}finally{if(stop)signal.removeEventListener('abort',stop);}}
function valid(record,now){return record&&typeof record==='object'&&UUID.test(record.sessionId||'')&&Number.isSafeInteger(record.expiresAt)&&record.expiresAt>now&&record.expiresAt<=now+BROWSER_KEEP_ALIVE_MS;}
async function bodyJson(response,signal){
 if(!/application\/json/i.test(response.headers.get('Content-Type')||''))throw fail();
 const reader=response.body?.getReader();if(!reader)throw fail();let size=0;const chunks=[];
 const cancel=()=>{try{void reader.cancel().catch(()=>{});}catch{}};signal?.addEventListener('abort',cancel,{once:true});
 try{for(;;){if(signal?.aborted)throw fail();const part=await bounded(reader.read(),3000);if(part.done)break;size+=part.value.byteLength;if(size>8192)throw fail();chunks.push(part.value);}}
 catch(error){try{void reader.cancel().catch(()=>{});}catch{}throw error;}
 finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
}

/** Reuse only IDs this feature created; never list or borrow account sessions. */
export async function acquireKnownSession({account,token,guardrails,fetchImpl,signal,cacheStorage=globalThis.caches,waitUntil}={}){
 // Session guardrails are immutable. A restricted GLOAR lookup must never
 // reconnect a broader legacy-provider session created with the same token.
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(POLICY_VERSION+'\n'+account+'\n'+token+'\n'+JSON.stringify(guardrails)))),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(signal?.aborted)throw aborted();
 const state=stateFor(cacheStorage),key='https://snote-browser-session.invalid/'+fingerprint;
 let cache=null;try{if(typeof cacheStorage?.open==='function')cache=await bounded(cacheStorage.open(CACHE_NAME));}catch{}
 async function remember(record){
  state.known.set(fingerprint,{...record});
  if(cache)try{await bounded(cache.put(key,new Response(JSON.stringify(record),{headers:{'Content-Type':'application/json','Cache-Control':'max-age=25'}})));}catch{}
 }
 async function read(){
  const inMemory=state.known.get(fingerprint);if(valid(inMemory,Date.now()))return{...inMemory};state.known.delete(fingerprint);
  if(cache)try{const response=await bounded(cache.match(key));if(response){const text=await bounded(response.text());if(text.length<=1024){const record=JSON.parse(text);if(valid(record,Date.now())){state.known.set(fingerprint,{...record});return record;}}}}catch{}
  return null;
 }
 async function invalidate(sessionId){
  const current=state.known.get(fingerprint);if(current?.sessionId===sessionId)state.known.delete(fingerprint);
  // Avoid deleting an already observed replacement. Cache API has no CAS;
  // this remains best effort across isolates, not an atomic lease.
  if(cache)try{const response=await bounded(cache.match(key));if(response){const text=await bounded(response.text());if(text.length<=1024&&JSON.parse(text)?.sessionId===sessionId)await bounded(cache.delete(key));}}catch{}
 }
 async function touch(sessionId){
  const current=state.known.get(fingerprint);if(current&&current.sessionId!==sessionId&&valid(current,Date.now()))return;
  await remember({sessionId,expiresAt:Date.now()+METADATA_TTL_MS});
 }
 let record=await read(),reused=!!record;
 if(!record){
  let creating=state.creating.get(fingerprint);
  if(!creating){
   creating=(async()=>{
    // Recheck after the asynchronous cache read before one local cold launch.
    const existing=await read();if(existing)return existing;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
     // Bound the complete create operation, including a trickling JSON body.
     // A cancelled caller can stop waiting without sharing any request I/O.
     return await bounded((async()=>{
      const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-run/devtools/browser?keep_alive=${BROWSER_KEEP_ALIVE_MS}`,{method:'POST',redirect:'manual',cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({guardrails})});
      if(controller.signal.aborted){try{void response.body?.cancel().catch(()=>{});}catch{}throw fail();}
      if(response.status===429){try{void response.body?.cancel().catch(()=>{});}catch{}throw fail('UPSTREAM_RATE_LIMITED',{retryAfter:browserRetryAfter(response)});}
      if(response.status===401||response.status===403){try{void response.body?.cancel().catch(()=>{});}catch{}throw fail('BROWSER_AUTH_FAILED');}
      if(!response.ok){try{void response.body?.cancel().catch(()=>{});}catch{}throw fail();}
      const data=await bodyJson(response,controller.signal);if(controller.signal.aborted||!UUID.test(data?.sessionId||''))throw fail();
      const created={sessionId:data.sessionId,expiresAt:Date.now()+METADATA_TTL_MS};await remember(created);return created;
     })(),8000);
    }catch(error){if(error?.code==='UPSTREAM_RATE_LIMITED'||error?.code==='BROWSER_AUTH_FAILED')throw error;throw fail();}
    finally{clearTimeout(timer);controller.abort();}
   })();
   state.creating.set(fingerprint,creating);
   // Retain only the bounded metadata creation after its originating caller
   // cancels. A WebSocket is always created in, and owned by, its own request.
   if(typeof waitUntil==='function')try{waitUntil(creating.catch(()=>{}));}catch{}
   void creating.finally(()=>{if(state.creating.get(fingerprint)===creating)state.creating.delete(fingerprint);}).catch(()=>{});
  }
  record=await interruptible(creating,signal);
 }
 if(signal?.aborted)throw aborted();
 return Object.freeze({sessionId:record.sessionId,reused,invalidate:()=>invalidate(record.sessionId),touch:()=>touch(record.sessionId)});
}
