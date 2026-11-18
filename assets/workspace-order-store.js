/* Personal layout IDs only. Auth metadata never grants a page or role permission. */
(function(global){
 'use strict';
 if(global.SnoteWorkspaceOrderStore)return;
 const ROLES=new Set(['admin','dealer','accountant','operator']);
 const SECTIONS=new Set(['sidebar','operator-sidebar','document-types','form-types']);
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const ID=/^[A-Za-z0-9_-]{1,64}$/,DEADLINE=15000;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const issue=code=>Object.assign(new Error(code==='ORDER_CONTEXT_CHANGED'?'로그인 또는 상사가 변경되었습니다.':code==='ORDER_INVALID'?'메뉴 순서 값을 확인해 주세요.':code==='ORDER_TIMEOUT'?'순서 저장 연결을 다시 확인해 주세요.':'메뉴 순서의 서버 저장을 확인하지 못했습니다.'),{code});
 function snapshot(value){
  if(!object(value)||value.ready!==true||typeof value.key!=='string'||!value.key||value.key.length>1024||/[\u0000-\u001f\u007f]/.test(value.key)||typeof value.actorId!=='string'||!UUID.test(value.actorId)||!ROLES.has(value.role))return null;
  if(value.role==='operator'?value.companyId!==null:typeof value.companyId!=='string'||!UUID.test(value.companyId))return null;
  return Object.freeze({ready:true,key:value.key,actorId:value.actorId,companyId:value.companyId,role:value.role});
 }
 function ids(value){
  if(!Array.isArray(value)||value.length>32||value.some(id=>typeof id!=='string'||!ID.test(id))||new Set(value).size!==value.length)throw issue('ORDER_INVALID');
  return [...value];
 }
 function section(context,value){
  if(!SECTIONS.has(value)||(context.role==='operator')!==(value==='operator-sidebar'))throw issue('ORDER_INVALID');
  return value;
 }
 function key(context,name){return 'snote_order_v1_'+(context.companyId||'platform')+'_'+context.role+'_'+section(context,name);}
 function value(user,context,name){
  if(!object(user)||user.id!==context.actorId)throw issue('ORDER_AUTH');
  const metadata=user.user_metadata;if(metadata===null||metadata===undefined)return null;
  if(!object(metadata))throw issue('ORDER_INVALID');
  const storage=key(context,name);if(!Object.hasOwn(metadata,storage))return null;
  const entry=metadata[storage];if(!object(entry)||Object.keys(entry).length!==2||!Object.hasOwn(entry,'version')||!Object.hasOwn(entry,'ids')||entry.version!==1)throw issue('ORDER_INVALID');
  return ids(entry.ids);
 }
 const equal=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((id,index)=>id===b[index]);
 function create(options){
  if(!options||typeof options.context!=='function'||typeof options.pin!=='function')throw issue('ORDER_INVALID');
  let writes=Promise.resolve();const reads=new Map();
  function context(){try{return snapshot(options.context());}catch(_){return null;}}
  function current(expected){
   const now=context();return !!now&&!!expected&&['ready','key','actorId','companyId','role'].every(field=>now[field]===expected[field]);
  }
  function assert(expected,pinned){
   let valid=current(expected);if(valid&&pinned)try{valid=pinned.current()===true;}catch(_){valid=false;}
   if(!valid)throw issue('ORDER_CONTEXT_CHANGED');
  }
  function timed(operation,abort){
   let timer;const timeout=new Promise((_,reject)=>{timer=global.setTimeout(()=>{try{abort?.abort();}catch(_){}reject(issue('ORDER_TIMEOUT'));},DEADLINE);});
   return Promise.race([Promise.resolve(operation),timeout]).finally(()=>global.clearTimeout(timer));
  }
  async function pin(expected){
   assert(expected);const pinned=await timed(options.pin(expected));assert(expected);
   if(!object(pinned)||typeof pinned.current!=='function'||typeof pinned.readUser!=='function'||typeof pinned.accessToken!=='string'||!pinned.accessToken||pinned.accessToken.length>32768||/[\s\u0000-\u001f\u007f]/.test(pinned.accessToken)||typeof pinned.anonKey!=='string'||!/^(sb_publishable_|eyJ)/.test(pinned.anonKey)||pinned.anonKey.length>32768||/[\s\u0000-\u001f\u007f]/.test(pinned.anonKey))throw issue('ORDER_AUTH');
   let url;try{url=new URL(pinned.url);}catch(_){throw issue('ORDER_AUTH');}
   if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw issue('ORDER_AUTH');
   assert(expected,pinned);return {...pinned,url:url.origin};
  }
  async function readUser(expected,pinned){
   assert(expected,pinned);const user=await timed(pinned.readUser());assert(expected,pinned);
   if(!object(user)||user.id!==expected.actorId)throw issue('ORDER_AUTH');return user;
  }
  function confirmed(expected,pinned,user){
   assert(expected,pinned);try{options.onConfirmedUser?.(user,expected);}catch(_){}assert(expected,pinned);
  }
  function read(expected,name){
   try{assert(expected);section(expected,name);}catch(error){return Promise.reject(error);}
   const request=JSON.stringify([expected.key,expected.actorId,expected.companyId,expected.role,name]);if(reads.has(request))return reads.get(request).then(result=>result===null?null:[...result]);
   const job=(async()=>{const pinned=await pin(expected),user=await readUser(expected,pinned),result=value(user,expected,name);confirmed(expected,pinned,user);return result;})();
   reads.set(request,job);job.then(()=>{if(reads.get(request)===job)reads.delete(request);},()=>{if(reads.get(request)===job)reads.delete(request);});return job.then(result=>result===null?null:[...result]);
  }
  function save(expected,name,order){
   let desired;try{assert(expected);section(expected,name);desired=ids(order);}catch(error){return Promise.reject(error);}
   const job=writes.then(async()=>{
    const pinned=await pin(expected);await readUser(expected,pinned);assert(expected,pinned);
    const fetcher=pinned.fetch||global.fetch;if(typeof fetcher!=='function')throw issue('ORDER_UNAVAILABLE');
    const controller=new global.AbortController(),entry={version:1,ids:desired};
    const response=await timed(fetcher.call(global,pinned.url+'/auth/v1/user',{method:'PUT',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{apikey:pinned.anonKey,Authorization:'Bearer '+pinned.accessToken,'Content-Type':'application/json'},body:JSON.stringify({data:{[key(expected,name)]:entry}}),signal:controller.signal}),controller);assert(expected,pinned);
    if(!response||response.ok!==true)throw issue(response&&[401,403].includes(response.status)?'ORDER_AUTH':'ORDER_UNAVAILABLE');
    let user;try{user=await timed(response.json());}catch(error){if(error?.code==='ORDER_TIMEOUT')throw error;throw issue('ORDER_ACK_MISMATCH');}assert(expected,pinned);
    if(!equal(value(user,expected,name),desired))throw issue('ORDER_ACK_MISMATCH');
    const verified=await readUser(expected,pinned);if(!equal(value(verified,expected,name),desired))throw issue('ORDER_ACK_MISMATCH');
    confirmed(expected,pinned,verified);return {ids:[...desired]};
   });
   writes=job.then(()=>undefined,()=>undefined);return job;
  }
  return Object.freeze({context,current,read,save});
 }
 global.SnoteWorkspaceOrderStore=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
