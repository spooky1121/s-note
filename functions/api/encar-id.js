import { inspectAPIRequest, hardenAPIResponse, readBoundedBytes } from '../_shared/api-security.js';
import { resolveEncarId } from '../_shared/encar-id-resolver.mjs';

// Read-only endpoint. A verified provider transport must be connected before
// release. No guessed search parameters or the retired resolver are used.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATE=/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/;
const MESSAGES={AUTH_REQUIRED:'로그인이 필요합니다.',AUTH_FAILED:'로그인을 다시 확인해 주세요.',STAFF_REQUIRED:'현재 계정의 사용 권한을 확인해 주세요.',AUTH_UNAVAILABLE:'로그인 정보를 확인하지 못했습니다.',INVALID_REQUEST:'차량번호를 확인해 주세요.',LOOKUP_NOT_CONFIGURED:'광고 ID 검색 연결을 준비하고 있습니다.',NOT_FOUND:'광고 ID를 찾지 못했습니다.',PROVIDERS_UNAVAILABLE:'외부 사이트의 검색 응답을 확인하지 못했습니다.',REQUEST_TIMEOUT:'광고 ID 검색 시간이 초과됐습니다.',REQUEST_ABORTED:'광고 ID 검색을 취소했습니다.'};
const STATUS={AUTH_REQUIRED:401,AUTH_FAILED:401,STAFF_REQUIRED:403,AUTH_UNAVAILABLE:502,INVALID_REQUEST:400,LOOKUP_NOT_CONFIGURED:503,NOT_FOUND:200,PROVIDERS_UNAVAILABLE:502,REQUEST_TIMEOUT:504,REQUEST_ABORTED:408};
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
function json(value,status=200){return hardenAPIResponse(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','X-Snote-Release':'2.145'}}));}
function error(code,status=502){return json({ok:false,status:code==='NOT_FOUND'?'not_found':'error',code,error:MESSAGES[code]||MESSAGES.PROVIDERS_UNAVAILABLE},status);}
function abortScope(parent,milliseconds){const controller=new AbortController(),abort=()=>controller.abort(parent?.reason);parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();const timer=setTimeout(()=>controller.abort(fail('REQUEST_TIMEOUT',504)),milliseconds);return{signal:controller.signal,dispose(){clearTimeout(timer);parent?.removeEventListener('abort',abort);}};}
async function boundedJson(url,headers,signal){const scope=abortScope(signal,5000);try{const response=await fetch(url,{method:'GET',headers,signal:scope.signal,redirect:'error',cache:'no-store'});if(!response.ok)throw fail(response.status===401? 'AUTH_FAILED':'AUTH_UNAVAILABLE',response.status===401?401:502);const bytes=await readBoundedBytes(response,65536,{timeoutMs:5000});return JSON.parse(new TextDecoder().decode(bytes));}finally{scope.dispose();}}
async function authorize(request,env,signal){
 const origin=typeof env.SUPABASE_URL==='string'?env.SUPABASE_URL.trim().replace(/\/$/,''):'',key=typeof env.SUPABASE_PUBLISHABLE_KEY==='string'?env.SUPABASE_PUBLISHABLE_KEY.trim():'';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(origin)||!key||key.length>8192)throw fail('AUTH_UNAVAILABLE',503);
 const authorization=request.headers.get('Authorization')||'';if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization))throw fail('AUTH_REQUIRED',401);
 const headers={apikey:key,Authorization:authorization},user=await boundedJson(origin+'/auth/v1/user',headers,signal);
 if(!UUID.test(user?.id||'')||user.is_anonymous===true)throw fail('AUTH_FAILED',401);
 const url=new URL(origin+'/rest/v1/zc_members');url.searchParams.set('select','user_id,company_id,role,active');url.searchParams.set('user_id','eq.'+user.id);url.searchParams.set('active','eq.true');url.searchParams.set('limit','1');
 const rows=await boundedJson(url.href,headers,signal);if(!Array.isArray(rows)||!rows.some(row=>row.user_id===user.id&&UUID.test(row.company_id||'')&&row.active===true&&['admin','dealer','accountant'].includes(row.role)))throw fail('STAFF_REQUIRED',403);
}
export function createEncarIdHandler({search=null}={}){
 return async function onRequest({request,env={}}){
  const checked=inspectAPIRequest(request);if(checked.response)return checked.response;
  const scope=abortScope(request.signal,45000);
  try{
   const bytes=await readBoundedBytes(request,1024,{timeoutMs:5000});let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('INVALID_REQUEST',400);}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof body.plate!=='string'||body.plate.length>40)throw fail('INVALID_REQUEST',400);
   const plate=body.plate.normalize('NFKC').replace(/[\s-]+/g,'');if(!PLATE.test(plate))throw fail('INVALID_REQUEST',400);
   await authorize(request,env,scope.signal);
   if(typeof search!=='function')throw fail('LOOKUP_NOT_CONFIGURED',503);
   const result=await resolveEncarId({plate,search,signal:scope.signal});
   if(result.status==='found')return json({ok:true,status:'found',plate,id:result.id,provider:result.provider});
   return error(result.code==='NOT_FOUND'?'NOT_FOUND':'PROVIDERS_UNAVAILABLE',result.status==='not_found'?200:502);
  }catch(e){if(scope.signal.aborted)return error(request.signal.aborted?'REQUEST_ABORTED':'REQUEST_TIMEOUT',request.signal.aborted?408:504);if(e?.code==='PAYLOAD_TOO_LARGE')return error('INVALID_REQUEST',413);return error(MESSAGES[e?.code]?e.code:'PROVIDERS_UNAVAILABLE',Number.isInteger(e?.status)&&e.status>=400&&e.status<=599?e.status:STATUS[e?.code]||502);}finally{scope.dispose();}
 };
}
// Intentionally fails closed until the actual site search contract is verified.
export const onRequest=createEncarIdHandler();
