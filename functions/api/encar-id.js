import { inspectAPIRequest, hardenAPIResponse, readBoundedBytes } from '../_shared/api-security.js';
import { findGloarAdvertisement } from '../_shared/encar-id-gloar.mjs';

// Search GLOAR's actual header field in a server-owned browser. Only a plate
// enters this route; only a verified original Encar ID leaves it.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATE=/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/;
const MESSAGES={AUTH_REQUIRED:'로그인이 필요합니다.',AUTH_FAILED:'로그인을 다시 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 사용 권한을 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다.',INVALID_REQUEST:'차량번호를 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 ID 검색 서버 설정을 확인해 주세요.',BROWSER_UNAVAILABLE:'광고 검색 서버에 연결하지 못했습니다.',BROWSER_BUSY:'다른 광고 검색이 진행 중입니다. 잠시 후 다시 확인해 주세요.',UPSTREAM_RATE_LIMITED:'광고 검색 서버의 요청 한도입니다. 잠시 후 다시 확인해 주세요.',NOT_FOUND:'광고 ID를 찾지 못했습니다.',PROVIDERS_UNAVAILABLE:'외부 사이트의 검색 응답을 확인하지 못했습니다.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다.',REQUEST_ABORTED:'광고 ID 검색을 취소했습니다.'};
Object.assign(MESSAGES,{
 BROWSER_AUTH_FAILED:'GLOAR 검색용 Browser Run 인증 설정을 확인해 주세요.',
 GLOAR_ACCESS_BLOCKED:'GLOAR에서 자동 검색을 제한하고 있습니다. 잠시 후 다시 확인해 주세요.',
 GLOAR_INPUT_MISSING:'GLOAR 차량번호 검색창을 찾지 못했습니다.',
 GLOAR_INPUT_UNAVAILABLE:'GLOAR 차량번호 검색창이 아직 준비되지 않았습니다.',
 GLOAR_INPUT_UNCONFIRMED:'GLOAR 검색창에 차량번호가 입력되지 않았습니다.',
 GLOAR_FOCUS_FAILED:'GLOAR 차량번호 검색창을 선택하지 못했습니다.',
 GLOAR_ENTER_FAILED:'GLOAR에 차량번호 검색을 요청하지 못했습니다.',
 GLOAR_NAVIGATION_BLOCKED:'GLOAR 검색 결과의 주소를 확인하지 못했습니다.',
 GLOAR_SEARCH_UNCONFIRMED:'GLOAR의 차량번호 검색 결과를 확인하지 못했습니다.',
 GLOAR_ID_UNVERIFIED:'차량은 찾았지만 원본 엔카 광고 ID를 확인하지 못했습니다.',
 GLOAR_AMBIGUOUS:'동일 차량번호의 광고가 여러 개여서 광고 ID를 확정하지 못했습니다.',
 GLOAR_UNAVAILABLE:'GLOAR 검색 응답을 확인하지 못했습니다.'
});
const STATUS={AUTH_REQUIRED:401,AUTH_FAILED:401,STAFF_REQUIRED:403,AUTH_UNAVAILABLE:502,INVALID_REQUEST:400,LOOKUP_NOT_CONFIGURED:503,BROWSER_UNAVAILABLE:502,BROWSER_AUTH_FAILED:502,BROWSER_BUSY:503,UPSTREAM_RATE_LIMITED:429,NOT_FOUND:200,PROVIDERS_UNAVAILABLE:502,REQUEST_TIMEOUT:504,REQUEST_ABORTED:408,GLOAR_ACCESS_BLOCKED:502};
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
function json(value,status=200){return hardenAPIResponse(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','X-Snote-Release':'2.148'}}));}
function error(code,status=502,retryAfter){const response=json({ok:false,status:code==='NOT_FOUND'?'not_found':'error',code,error:MESSAGES[code]||MESSAGES.PROVIDERS_UNAVAILABLE},status);if(code==='UPSTREAM_RATE_LIMITED'||code==='BROWSER_BUSY')response.headers.set('Retry-After',String(Number.isInteger(retryAfter)?Math.max(1,Math.min(3600,retryAfter)):20));return response;}
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
function browserConfigured(env){const account=typeof env.CLOUDFLARE_ACCOUNT_ID==='string'?env.CLOUDFLARE_ACCOUNT_ID.trim():'',token=typeof env.CLOUDFLARE_BROWSER_TOKEN==='string'?env.CLOUDFLARE_BROWSER_TOKEN.trim():'';return /^[a-f0-9]{32}$/i.test(account)&&!!token&&token.length<=4096&&!/[^\x21-\x7e]/u.test(token);}
function verifiedResult(result,plate){
 if(result?.status!=='found'||result.plate!==plate||result.provider!=='gloar'||typeof result.id!=='string'||!/^[1-9][0-9]{5,11}$/.test(result.id)||typeof result.sourceUrl!=='string')return false;
 try{const url=new URL(result.sourceUrl);return url.protocol==='https:'&&url.hostname==='gloar-data.com'&&!url.username&&!url.password&&!url.port&&!url.hash&&/^\/[a-z]{2}\/lot\/[^/?#]+\/?$/.test(url.pathname);}catch{return false;}
}
export function createEncarIdHandler({lookup=findGloarAdvertisement}={}){
 return async function onRequest(context){
  const {request,env={}}=context;
  const checked=inspectAPIRequest(request);if(checked.response)return checked.response;
  // Presence only: no secret values, Auth traffic, browser launch or vehicle data.
  if(request.method==='GET')return json({ok:true,configured:browserConfigured(env),provider:'gloar',release:'2.148'});
  const scope=abortScope(request.signal,45000);
  try{
   const bytes=await readBoundedBytes(request,1024,{timeoutMs:5000});let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('INVALID_REQUEST',400);}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof body.plate!=='string'||body.plate.length>40)throw fail('INVALID_REQUEST',400);
   const plate=body.plate.normalize('NFKC').replace(/[\s-]+/g,'');if(!PLATE.test(plate))throw fail('INVALID_REQUEST',400);
   await authorize(request,env,scope.signal);
   const result=await lookup({plate,env,signal:scope.signal,waitUntil:typeof context.waitUntil==='function'?promise=>context.waitUntil(promise):undefined});
   if(scope.signal.aborted)throw fail('REQUEST_ABORTED',408);
   if(verifiedResult(result,plate))return json({ok:true,status:'found',plate,id:result.id,provider:'gloar'});
   if(result?.status==='not_found'&&result.plate===plate&&result.code==='NOT_FOUND')return error('NOT_FOUND',200);
   return error('GLOAR_ID_UNVERIFIED',502);
  }catch(e){if(scope.signal.aborted)return error(request.signal.aborted?'REQUEST_ABORTED':'REQUEST_TIMEOUT',request.signal.aborted?408:504);if(e?.code==='PAYLOAD_TOO_LARGE')return error('INVALID_REQUEST',413);return error(MESSAGES[e?.code]?e.code:'PROVIDERS_UNAVAILABLE',e?.code==='AUTH_UNAVAILABLE'&&e?.status===503?503:STATUS[e?.code]||502,e?.retryAfter);}finally{scope.dispose();}
 };
}
export const onRequest=createEncarIdHandler();
