import { inspectAPIRequest, hardenAPIResponse, readBoundedBytes } from '../_shared/api-security.js';
import { findAdvertisementId } from '../_shared/encar-id-lookup.mjs';
import { searchExternalAdvertisements } from '../_shared/encar-id-search.mjs';

// Read-only web search. No browser session, filter clicking or Korean Encar
// request is part of the production path. The only user input is a full plate.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATE=/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/;
const MESSAGES={AUTH_REQUIRED:'로그인이 필요합니다.',AUTH_FAILED:'로그인을 다시 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 사용 권한을 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다.',INVALID_REQUEST:'차량번호를 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 ID 검색 서버 설정을 확인해 주세요.',BROWSER_UNAVAILABLE:'광고 검색 서버에 연결하지 못했습니다.',BROWSER_BUSY:'다른 광고 검색이 진행 중입니다. 잠시 후 다시 확인해 주세요.',UPSTREAM_RATE_LIMITED:'광고 검색 서버의 요청 한도입니다. 잠시 후 다시 확인해 주세요.',NOT_FOUND:'광고 ID를 찾지 못했습니다.',PROVIDERS_UNAVAILABLE:'외부 사이트의 검색 응답을 확인하지 못했습니다.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다.',REQUEST_ABORTED:'광고 ID 검색을 취소했습니다.'};
const SEARCH_MESSAGES={SEARCH_NOT_CONFIGURED:'검색 서비스 설정을 확인해 주세요.',SEARCH_AUTH_FAILED:'검색 서비스의 인증 설정을 확인해 주세요.',SEARCH_RATE_LIMITED:'검색 서비스가 요청을 제한했습니다. 잠시 후 다시 확인해 주세요.',SEARCH_UNAVAILABLE:'검색 서비스에 연결하지 못했습니다.',SEARCH_INVALID_RESPONSE:'검색 서비스의 응답을 확인하지 못했습니다.',SEARCH_TIMEOUT:'광고 검색 시간이 초과됐습니다.'};
Object.assign(MESSAGES,SEARCH_MESSAGES);
const STATUS={AUTH_REQUIRED:401,AUTH_FAILED:401,STAFF_REQUIRED:403,AUTH_UNAVAILABLE:502,INVALID_REQUEST:400,LOOKUP_NOT_CONFIGURED:503,BROWSER_UNAVAILABLE:502,BROWSER_BUSY:503,UPSTREAM_RATE_LIMITED:429,NOT_FOUND:200,PROVIDERS_UNAVAILABLE:502,REQUEST_TIMEOUT:504,REQUEST_ABORTED:408,SEARCH_NOT_CONFIGURED:503,SEARCH_AUTH_FAILED:502,SEARCH_RATE_LIMITED:429,SEARCH_UNAVAILABLE:502,SEARCH_INVALID_RESPONSE:502,SEARCH_TIMEOUT:504};
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
function json(value,status=200){return hardenAPIResponse(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','X-Snote-Release':'2.147'}}));}
function error(code,status=502,retryAfter){const response=json({ok:false,status:code==='NOT_FOUND'?'not_found':'error',code,error:MESSAGES[code]||MESSAGES.PROVIDERS_UNAVAILABLE},status);if(code==='UPSTREAM_RATE_LIMITED'||code==='BROWSER_BUSY'||code==='SEARCH_RATE_LIMITED')response.headers.set('Retry-After',String(Number.isInteger(retryAfter)?Math.max(1,Math.min(3600,retryAfter)):20));return response;}
function abortScope(parent,milliseconds){const controller=new AbortController(),abort=()=>controller.abort(parent?.reason);parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();const timer=setTimeout(()=>controller.abort(fail('REQUEST_TIMEOUT',504)),milliseconds);return{signal:controller.signal,dispose(){clearTimeout(timer);parent?.removeEventListener('abort',abort);}};}
async function boundedJson(url,headers,signal){
 const scope=abortScope(signal,5000);
 try{const response=await fetch(url,{method:'GET',headers,signal:scope.signal,redirect:'manual',cache:'no-store'});if(!response.ok)throw fail(response.status===401?'AUTH_FAILED':'AUTH_UNAVAILABLE',response.status===401?401:502);const bytes=await readBoundedBytes(response,65536,{timeoutMs:5000});return JSON.parse(new TextDecoder().decode(bytes));}
 catch(e){if(signal.aborted||e?.code==='AUTH_FAILED'||e?.code==='AUTH_UNAVAILABLE')throw e;throw fail('AUTH_UNAVAILABLE',502);}
 finally{scope.dispose();}
}
async function authorize(request,env,signal){
 const origin=typeof env.SUPABASE_URL==='string'?env.SUPABASE_URL.trim().replace(/\/$/,''):'',key=typeof env.SUPABASE_PUBLISHABLE_KEY==='string'?env.SUPABASE_PUBLISHABLE_KEY.trim():'';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(origin)||!key||key.length>8192)throw fail('AUTH_UNAVAILABLE',503);
 const authorization=request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization))throw fail('AUTH_REQUIRED',401);
 const headers={apikey:key,Authorization:authorization},user=await boundedJson(origin+'/auth/v1/user',headers,signal);
 if(!UUID.test(user?.id||'')||user.is_anonymous===true)throw fail('AUTH_FAILED',401);
 const url=new URL(origin+'/rest/v1/zc_members');url.searchParams.set('select','user_id,company_id,role,active');url.searchParams.set('user_id','eq.'+user.id);url.searchParams.set('active','eq.true');url.searchParams.set('limit','1');
 const rows=await boundedJson(url.href,headers,signal);if(!Array.isArray(rows)||!rows.some(row=>row.user_id===user.id&&UUID.test(row.company_id||'')&&row.active===true&&['admin','dealer','accountant'].includes(row.role)))throw fail('STAFF_REQUIRED',403);
}
async function closeTransport(transport){if(typeof transport?.close!=='function')return;let timer;try{await Promise.race([Promise.resolve().then(()=>transport.close()),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}catch{}finally{clearTimeout(timer);}}
function searchKey(env){const key=typeof env.TAVILY_API_KEY==='string'?env.TAVILY_API_KEY.trim():'';return key&&key.length<=4096&&!/[^\x21-\x7e]/u.test(key)?key:'';}
async function productionTransport({env}){const apiKey=searchKey(env);if(!apiKey)throw fail('SEARCH_NOT_CONFIGURED',503);return{search:(provider,options)=>searchExternalAdvertisements(provider,{...options,apiKey})};}
export function createEncarIdHandler({search=null,createSearch=null}={}){
 return async function onRequest(context){
  const {request,env={}}=context;
  const checked=inspectAPIRequest(request);if(checked.response)return checked.response;
  // Presence only: no secret values, Auth traffic, paid search or vehicle data.
  if(request.method==='GET')return json({ok:true,configured:!!searchKey(env),provider:'tavily',release:'2.147'});
  const scope=abortScope(request.signal,45000);let transport;
  try{
   const bytes=await readBoundedBytes(request,1024,{timeoutMs:5000});let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('INVALID_REQUEST',400);}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof body.plate!=='string'||body.plate.length>40)throw fail('INVALID_REQUEST',400);
   const plate=body.plate.normalize('NFKC').replace(/[\s-]+/g,'');if(!PLATE.test(plate))throw fail('INVALID_REQUEST',400);
   await authorize(request,env,scope.signal);
   if(typeof search==='function')transport={search};else if(typeof createSearch==='function')transport=await createSearch({env,signal:scope.signal,waitUntil:typeof context.waitUntil==='function'?promise=>context.waitUntil(promise):undefined});
   if(typeof transport?.search!=='function')throw fail('LOOKUP_NOT_CONFIGURED',503);
   const result=await findAdvertisementId({plate,search:transport.search,signal:scope.signal});
   if(result.status==='found')return json({ok:true,status:'found',plate,id:result.id,provider:result.provider});
   return error(result.code==='NOT_FOUND'?'NOT_FOUND':'PROVIDERS_UNAVAILABLE',result.status==='not_found'?200:502);
  }catch(e){if(scope.signal.aborted)return error(request.signal.aborted?'REQUEST_ABORTED':'REQUEST_TIMEOUT',request.signal.aborted?408:504);if(e?.code==='PAYLOAD_TOO_LARGE')return error('INVALID_REQUEST',413);return error(MESSAGES[e?.code]?e.code:'PROVIDERS_UNAVAILABLE',Number.isInteger(e?.status)&&e.status>=400&&e.status<=599?e.status:STATUS[e?.code]||502,e?.retryAfter);}finally{await closeTransport(transport);scope.dispose();}
 };
}
export const onRequest=createEncarIdHandler({createSearch:productionTransport});
