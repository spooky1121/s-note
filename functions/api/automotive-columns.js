/* Fixed Naver News search. Provider credentials stay in server bindings. */
const ENDPOINT='https://openapi.naver.com/v1/search/news.json';
const SOURCE='네이버 뉴스 검색';
const SOURCE_URL='https://search.naver.com/search.naver?where=news&query=%EC%9E%90%EB%8F%99%EC%B0%A8%20%EC%B9%BC%EB%9F%BC';
const QUERIES=Object.freeze(['자동차 칼럼','자동차 기고']);
const TTL=900000,DEADLINE=6000,MAX_BYTES=1048576,MAX_ITEMS=5;
const cacheEntries=new Map(),inflight=new Map();
const CODES=Object.freeze({
 NEWS_NOT_CONFIGURED:[503,'자동차 칼럼을 준비하고 있습니다.'],
 NEWS_AUTH_FAILED:[503,'뉴스 제공 설정을 확인하고 있습니다.'],
 NEWS_RATE_LIMITED:[429,'뉴스 요청이 많습니다. 잠시 후 다시 확인해 주세요.'],
 NEWS_UPSTREAM_UNAVAILABLE:[502,'자동차 칼럼을 불러오지 못했습니다. 다시 시도해 주세요.'],
 NEWS_INVALID_RESPONSE:[502,'자동차 칼럼의 응답을 확인하지 못했습니다. 다시 시도해 주세요.'],
 NEWS_TIMEOUT:[504,'자동차 칼럼을 불러오는 시간이 지연되고 있습니다. 다시 시도해 주세요.'],
 NEWS_INVALID_REQUEST:[400,'허용되지 않은 뉴스 요청입니다.'],
 NEWS_METHOD_NOT_ALLOWED:[405,'허용되지 않은 요청 방식입니다.']
});
const issue=code=>Object.assign(new Error(code),{code});
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function credential(value){return typeof value==='string'&&/^[\x21-\x7e]{1,512}$/.test(value.trim())?value.trim():null;}
function config(env){const id=credential(env?.NAVER_NEWS_CLIENT_ID),secret=credential(env?.NAVER_NEWS_CLIENT_SECRET);return id&&secret?{id,secret}:null;}
function entities(value){return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|middot|ndash|mdash|hellip);/gi,(all,key)=>{
 const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',middot:'·',ndash:'–',mdash:'—',hellip:'…'},lower=key.toLowerCase();
 if(Object.hasOwn(names,lower))return names[lower];
 const cp=lower.startsWith('#x')?Number.parseInt(lower.slice(2),16):Number.parseInt(lower.slice(1),10);
 return Number.isInteger(cp)&&cp>0&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):'';
 });}
export function newsText(value,maximum=180){
 if(typeof value!=='string'||value.length>10000)return '';
 // Decode a second time for nested entities, then remove markup before exposing plain text.
 const text=entities(entities(value)).replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 return Array.from(text).slice(0,maximum).join('');
}
export function newsURL(value){
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value))return null;
 try{const u=new URL(value),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||host.endsWith('.')||/^\d+(?:\.\d+){3}$/.test(host)||host.includes(':')||/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host)||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))return null;
  u.hash='';return u.href;
 }catch{return null;}
}
function date(value){
 if(typeof value!=='string'||value.length>100)return null;
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)){const d=new Date(value);return Number.isFinite(d.getTime())&&d.toISOString()===value?value:null;}
 const m=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s(\d{2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{4})\s(\d{2}):(\d{2}):(\d{2})\s([+-])(\d{2})(\d{2})$/.exec(value);
 if(!m)return null;const day=Number(m[1]),month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2]),year=Number(m[3]),hour=Number(m[4]),minute=Number(m[5]),second=Number(m[6]),oh=Number(m[8]),om=Number(m[9]);
 if(year<2000||hour>23||minute>59||second>59||oh>23||om>59)return null;
 const local=new Date(Date.UTC(year,month,day,hour,minute,second));if(local.getUTCFullYear()!==year||local.getUTCMonth()!==month||local.getUTCDate()!==day)return null;
 return new Date(local.getTime()-(m[7]==='-'?-1:1)*(oh*60+om)*60000).toISOString();
}
const AUTOMOTIVE=/(?:자동차|중고차|신차|전기차|수소차|차량|완성차|모빌리티|자율주행|내연기관|하이브리드|전동화|오토모티브)/u;
// Naver has no column/category parameter. Require an explicit editorial title label;
// ordinary news mentioning a column in its summary is not accepted as a column.
const EDITORIAL=/(?:^|\[|【|〈|〔|「|『|\(|\||｜)[^\[\]【】〈〉〔〕「」『』()|｜:：]{0,24}(?:칼럼|컬럼|기고|시론|기자수첩)\s*(?:\]|】|〉|〕|」|』|\)|[:：]|\||｜)|^(?:칼럼|컬럼|기고|시론|기자수첩)\s*[-–—]/u;
export function selectAutomotiveColumns(results,now=Date.now()){
 const rows=[],seenURLs=new Set(),seenTitles=new Set();
 for(const body of results){
  if(!object(body)||!Array.isArray(body.items)||body.items.length>100||!Number.isSafeInteger(body.total)||body.total<body.items.length)throw issue('NEWS_INVALID_RESPONSE');
  for(const row of body.items){
   if(!object(row))continue;const title=newsText(row.title);
   if(!title||!EDITORIAL.test(title)||!AUTOMOTIVE.test(title))continue;
   const url=newsURL(row.originallink)||newsURL(row.link),publishedAt=date(row.pubDate);if(!url||!publishedAt)continue;
   const age=now-Date.parse(publishedAt);if(age< -86400000||age>180*86400000)continue;
   const normalized=title.toLocaleLowerCase('ko-KR').replace(/[\s\p{P}\p{S}]/gu,'');
   if(seenURLs.has(url)||seenTitles.has(normalized))continue;seenURLs.add(url);seenTitles.add(normalized);
   rows.push({title,url,publishedAt,publisher:new URL(url).hostname.replace(/^www\./,'')});
  }
 }
 return rows.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.title.localeCompare(b.title,'ko')).slice(0,MAX_ITEMS);
}
function validPayload(payload,now){
 return object(payload)&&Object.keys(payload).length===8&&payload.ok===true&&payload.configured===true&&payload.source===SOURCE&&payload.sourceUrl===SOURCE_URL&&payload.stale===false&&typeof payload.partial==='boolean'&&typeof payload.fetchedAt==='string'&&date(payload.fetchedAt)===payload.fetchedAt&&now-Date.parse(payload.fetchedAt)>=-60000&&now-Date.parse(payload.fetchedAt)<TTL&&Array.isArray(payload.items)&&payload.items.length<=MAX_ITEMS&&payload.items.every(row=>object(row)&&Object.keys(row).length===4&&newsText(row.title)===row.title&&!!row.title&&EDITORIAL.test(row.title)&&AUTOMOTIVE.test(row.title)&&newsURL(row.url)===row.url&&date(row.publishedAt)===row.publishedAt&&now-Date.parse(row.publishedAt)>=-86400000&&now-Date.parse(row.publishedAt)<=180*86400000&&row.publisher===new URL(row.url).hostname.replace(/^www\./,''));
}
async function boundedJSON(response,maximum=MAX_BYTES){
 const reader=response.body?.getReader();if(!reader)throw issue('NEWS_INVALID_RESPONSE');const chunks=[];let total=0;
 try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maximum)throw issue('NEWS_INVALID_RESPONSE');chunks.push(part.value);}
 const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw issue('NEWS_INVALID_RESPONSE');}
 }finally{try{await reader.cancel();}catch{}}
}
async function upstream(conf,query,signal){
 const url=new URL(ENDPOINT);url.searchParams.set('query',query);url.searchParams.set('display','100');url.searchParams.set('start','1');url.searchParams.set('sort','date');
 let response;try{response=await fetch(url.href,{method:'GET',redirect:'manual',signal,headers:{Accept:'application/json','X-Naver-Client-Id':conf.id,'X-Naver-Client-Secret':conf.secret}});}catch{throw issue('NEWS_UPSTREAM_UNAVAILABLE');}
 if(!response.ok){try{await response.body?.cancel();}catch{}throw issue(response.status===401||response.status===403?'NEWS_AUTH_FAILED':response.status===429?'NEWS_RATE_LIMITED':'NEWS_UPSTREAM_UNAVAILABLE');}
 return boundedJSON(response);
}
async function fetchColumns(conf){
 const controller=new AbortController();let timer;
 try{
  const queries=Promise.allSettled(QUERIES.map(query=>upstream(conf,query,controller.signal)));
  const results=await Promise.race([queries,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(issue('NEWS_TIMEOUT'));},DEADLINE);})]);
  const failed=results.filter(r=>r.status==='rejected'),passed=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  const auth=failed.find(r=>r.reason?.code==='NEWS_AUTH_FAILED');if(auth)throw auth.reason;
  const items=selectAutomotiveColumns(passed);
  if(failed.length&&!items.length)throw failed[0].reason;
  return {ok:true,configured:true,source:SOURCE,sourceUrl:SOURCE_URL,fetchedAt:new Date().toISOString(),stale:false,partial:failed.length>0,items};
 }finally{clearTimeout(timer);controller.abort();}
}
async function fingerprint(conf){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(conf.id+'\u0000'+conf.secret));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
async function cacheOperation(operation){
 let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),250);})]);}catch{return null;}finally{clearTimeout(timer);}
}
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status>=500||status===429?{'Retry-After':status===429?'900':'60'}:{}),...(status===405?{Allow:'GET'}:{})}});}
function failure(code,configured=true){const known=Object.hasOwn(CODES,code)?code:'NEWS_UPSTREAM_UNAVAILABLE';return reply({ok:false,configured,code:known,error:CODES[known][1],items:[]},CODES[known][0]);}
export async function onRequest({request,env={}}){
 if(request.method!=='GET')return failure('NEWS_METHOD_NOT_ALLOWED');
 const requestURL=new URL(request.url);if(requestURL.search)return failure('NEWS_INVALID_REQUEST');
 const conf=config(env);if(!conf)return failure('NEWS_NOT_CONFIGURED',false);
 const hash=await fingerprint(conf),key=requestURL.origin+':'+hash,now=Date.now(),cached=cacheEntries.get(key);
 if(cached&&validPayload(cached,now))return reply(cached);
 if(cached)cacheEntries.delete(key);
 if(inflight.has(key))try{return reply(await inflight.get(key));}catch(error){return failure(error?.code);}
 const task=(async()=>{
  const cache=globalThis.caches?.default,cacheKey=new Request(new URL('/api/_automotive-columns-cache/v1/'+hash,requestURL.origin));
  const saved=cache?await cacheOperation(async()=>{const response=await cache.match(cacheKey);return response?boundedJSON(response,32768):null;}):null;
  if(validPayload(saved,Date.now())){cacheEntries.set(key,saved);return saved;}
  const payload=await fetchColumns(conf);if(cacheEntries.size>=8)cacheEntries.delete(cacheEntries.keys().next().value);cacheEntries.set(key,payload);
  if(cache)await cacheOperation(()=>cache.put(cacheKey,new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=900'}})));
  return payload;
 })();
 inflight.set(key,task);
 try{return reply(await task);}catch(error){return failure(error?.code);}finally{if(inflight.get(key)===task)inflight.delete(key);}
}
