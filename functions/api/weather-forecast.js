/* Fixed-station MET Norway samples, reduced to seven complete KST days. */
import {STATIONS} from './weather.js';
const PROVIDER='https://api.met.no/weatherapi/locationforecast/2.0/compact';
const SOURCE='MET Norway',SOURCE_URL='https://www.met.no/',TIMEZONE='Asia/Seoul';
const USER_AGENT='S-NOTE/2.176 (+https://s-note.pages.dev)';
const DAY=86400000,KST=32400000,HOUR=3600000,MIN_INTERVAL=3*HOUR,RETAIN=6*HOUR,MAX_RETENTION=7*DAY,MAX_BYTES=262144,TIMEOUT=4000;
const FAILURES=new Set(['FORECAST_TIMEOUT','FORECAST_NETWORK_UNAVAILABLE','FORECAST_HTTP_UNAVAILABLE','FORECAST_REDIRECT_UNAVAILABLE','FORECAST_TOO_LARGE','INVALID_FORECAST_DATA','FORECAST_INCOMPLETE','INVALID_FORECAST_CACHE_HEADERS']);
const validTemperature=value=>typeof value==='number'&&Number.isFinite(value)&&value>=-80&&value<=60;
const iso=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return null;const at=Date.parse(value);return Number.isFinite(at)&&new Date(at).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z')?at:null;};
const symbolCodes={clearsky:0,fair:1,partlycloudy:2,cloudy:3,fog:45,lightrain:61,rain:63,heavyrain:65,lightrainshowers:80,rainshowers:81,heavyrainshowers:82,lightsleet:71,sleet:73,heavysleet:75,lightsleetshowers:85,sleetshowers:85,heavysleetshowers:86,lightsnow:71,snow:73,heavysnow:75,lightsnowshowers:85,snowshowers:85,heavysnowshowers:86};
const severity={0:0,1:1,2:2,3:3,45:4,61:5,80:5,63:6,81:6,65:7,82:7,71:8,85:8,73:9,75:10,86:10,95:11};
function symbolCode(value){if(typeof value!=='string')return null;const base=value.replace(/_(day|night|polartwilight)$/,'');if(Object.hasOwn(symbolCodes,base))return symbolCodes[base];return /^(?:(?:light|heavy)?(?:rain|sleet|snow)(?:showers)?andthunder|lightssleetshowersandthunder|lightssnowshowersandthunder)$/.test(base)?95:null;}
function validateFeed(feed){
 if(!feed||iso(feed.modelUpdatedAt)===null||!Array.isArray(feed.samples)||feed.samples.length<2||feed.samples.length>512)throw Error('INVALID_FORECAST_DATA');
 let previous=-Infinity;for(const sample of feed.samples){if(!sample||!Number.isSafeInteger(sample.at)||sample.at<=previous||!validTemperature(sample.temperature)||sample.code!==null&&!Object.hasOwn(severity,sample.code))throw Error('INVALID_FORECAST_DATA');previous=sample.at;}return feed;
}
export function parseMetForecast(value,now=Date.now()){
 const meta=value?.properties?.meta,rows=value?.properties?.timeseries,updated=iso(meta?.updated_at);
 if(value?.type!=='Feature'||meta?.units?.air_temperature!=='celsius'||updated===null||updated>now+HOUR||now-updated>DAY||!Array.isArray(rows)||rows.length<2||rows.length>512)throw Error('INVALID_FORECAST_DATA');
 const samples=rows.map(row=>{const at=iso(row?.time),data=row?.data,temperature=data?.instant?.details?.air_temperature,symbol=data?.next_1_hours?.summary?.symbol_code??data?.next_6_hours?.summary?.symbol_code??data?.next_12_hours?.summary?.symbol_code,code=symbolCode(symbol);if(at===null||symbol!==undefined&&code===null)throw Error('INVALID_FORECAST_DATA');return {at,temperature,code};});
 return validateFeed({modelUpdatedAt:new Date(updated).toISOString(),samples});
}
export function normalizeMetDays(feed,now=Date.now()){
 validateFeed(feed);const tomorrow=(Math.floor((now+KST)/DAY)+1)*DAY-KST;
 return Array.from({length:7},(_,index)=>{const start=tomorrow+index*DAY,end=start+DAY,rows=feed.samples,after=rows.findIndex(row=>row.at>=end);let before=-1;for(let i=0;i<rows.length&&rows[i].at<=start;i++)before=i;
  if(before<0||after<0)throw Error('FORECAST_INCOMPLETE');for(let i=before;i<after;i++)if(rows[i+1].at-rows[i].at>6*HOUR)throw Error('FORECAST_INCOMPLETE');
  const inside=rows.slice(before,after+1).filter(row=>row.at>=start&&row.at<end);if(inside.length<4||inside.some(row=>row.code===null))throw Error('FORECAST_INCOMPLETE');
  return {date:new Date(start+KST).toISOString().slice(0,10),code:inside.reduce((chosen,row)=>severity[row.code]>severity[chosen]?row.code:chosen,inside[0].code),min:Math.min(...inside.map(row=>row.temperature)),max:Math.max(...inside.map(row=>row.temperature))};
 });
}
function httpTime(value){if(typeof value!=='string')return null;const at=Date.parse(value);return Number.isFinite(at)&&new Date(at).toUTCString()===value?at:null;}
function expiry(headers,now){const value=headers.get('Expires'),at=value===null?now:httpTime(value);if(at===null||at>now+MAX_RETENTION||at<now-DAY)throw Error('INVALID_FORECAST_CACHE_HEADERS');return new Date(Math.max(now+MIN_INTERVAL,at)).toISOString();}
function cachedRecord(value,station,now){
 const base=entry=>{const fetched=iso(entry?.fetchedAt),expires=iso(entry?.expiresAt);return entry?.version===2&&entry.station===station&&fetched!==null&&expires!==null&&fetched<=now+60000&&now-fetched<=MAX_RETENTION&&expires>=fetched+MIN_INTERVAL&&expires<=fetched+MAX_RETENTION;};
 const forecast=entry=>{if(entry?.kind!=='forecast'||!base(entry))return null;const modified=httpTime(entry.lastModified);if(modified===null||modified>iso(entry.fetchedAt)+60000)return null;try{validateFeed(entry.feed);return {version:2,kind:'forecast',station,fetchedAt:entry.fetchedAt,expiresAt:entry.expiresAt,lastModified:entry.lastModified,feed:entry.feed};}catch{return null;}};
 if(value?.kind==='forecast')return forecast(value);
 if(value?.kind!=='error'||!base(value)||!FAILURES.has(value.reason))return null;
 const previous=value.previous===undefined?null:forecast(value.previous);if(value.previous!==undefined&&!previous)return null;
 return {version:2,kind:'error',station,fetchedAt:value.fetchedAt,expiresAt:value.expiresAt,reason:value.reason,...(previous?{previous}:{})};
}
async function readBounded(response,signal,setReader){const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES)){void response.body?.cancel().catch(()=>{});throw Error('FORECAST_TOO_LARGE');}const reader=response.body?.getReader();if(!reader)throw Error('INVALID_FORECAST_DATA');setReader(reader);let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(signal.aborted)throw Error('FORECAST_TIMEOUT');if(done)break;size+=value.byteLength;if(size>MAX_BYTES){void reader.cancel().catch(()=>{});throw Error('FORECAST_TOO_LARGE');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('INVALID_FORECAST_DATA');}}
async function fetchRecord(station,previous){const controller=new AbortController();let reader,timer;const work=async()=>{const target=new URL(PROVIDER);target.search=new URLSearchParams({lat:String(station[1]),lon:String(station[2])}).toString();const headers={Accept:'application/json','User-Agent':USER_AGENT};if(previous?.kind==='forecast')headers['If-Modified-Since']=previous.lastModified;const response=await fetch(target.href,{method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal,headers});
  if(response.status===304){if(previous?.kind!=='forecast')throw Error('FORECAST_HTTP_UNAVAILABLE');const now=Date.now();return {...previous,fetchedAt:new Date(now).toISOString(),expiresAt:expiry(response.headers,now)};}
  if(response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>{});throw Error('FORECAST_REDIRECT_UNAVAILABLE');}if(response.status!==200){void response.body?.cancel().catch(()=>{});throw Error('FORECAST_HTTP_UNAVAILABLE');}
  const raw=await readBounded(response,controller.signal,current=>{reader=current;}),now=Date.now(),lastModified=response.headers.get('Last-Modified'),modified=httpTime(lastModified);if(modified===null||modified>now+60000)throw Error('INVALID_FORECAST_CACHE_HEADERS');return {version:2,kind:'forecast',station:station[0],fetchedAt:new Date(now).toISOString(),expiresAt:expiry(response.headers,now),lastModified,feed:parseMetForecast(raw,now)};
 };const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(Error('FORECAST_TIMEOUT'));},TIMEOUT);});try{return await Promise.race([work(),deadline]);}catch(error){throw Error(controller.signal.aborted?'FORECAST_TIMEOUT':FAILURES.has(error?.message)?error.message:'FORECAST_NETWORK_UNAVAILABLE');}finally{clearTimeout(timer);}}
export function createWeatherForecastHandler(){const pending=new Map(),memory=new Map();return async function handle({request}){
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'GET'}:{}),...(status===503?{'Retry-After':'60'}:{})}});
 if(request.method!=='GET')return reply({ok:false,reason:'METHOD_NOT_ALLOWED'},405);const params=new URL(request.url).searchParams;if([...params.keys()].some(key=>key!=='station')||params.getAll('station').length!==1)return reply({ok:false,reason:'INVALID_REQUEST'},400);const station=STATIONS.find(([id])=>String(id)===params.get('station'));if(!station)return reply({ok:false,reason:'INVALID_STATION'},400);
 const cache=globalThis.caches?.default,key=new Request(new URL('/api/weather-forecast-cache/met-v2/'+station[0],request.url));let saved=cachedRecord(memory.get(station[0]),station[0],Date.now());if(!saved)try{const response=await cache?.match(key);if(response?.ok)saved=cachedRecord(await response.json(),station[0],Date.now());}catch{}
 const present=record=>{if(record.kind==='error')throw Error(record.reason);return {ok:true,station:station[0],source:SOURCE,sourceUrl:SOURCE_URL,timezone:TIMEZONE,fetchedAt:record.fetchedAt,expiresAt:record.expiresAt,modelUpdatedAt:record.feed.modelUpdatedAt,days:normalizeMetDays(record.feed,Date.now())};};
 if(saved&&Date.now()<Date.parse(saved.expiresAt)){memory.set(station[0],saved);try{return reply(present(saved));}catch(error){return reply({ok:false,reason:FAILURES.has(error.message)?error.message:'INVALID_FORECAST_DATA'},503);}}
 let task=pending.get(station[0]);if(!task){task=(async()=>{let record;try{record=await fetchRecord(station,saved?.kind==='forecast'?saved:saved?.previous);}catch(error){const now=Date.now();record={version:2,kind:'error',station:station[0],fetchedAt:new Date(now).toISOString(),expiresAt:new Date(now+MIN_INTERVAL).toISOString(),reason:FAILURES.has(error.message)?error.message:'FORECAST_NETWORK_UNAVAILABLE',...((saved?.kind==='forecast'?saved:saved?.previous)?{previous:saved.kind==='forecast'?saved:saved.previous}:{})};}memory.set(station[0],record);if(cache)try{const now=Date.now(),seconds=Math.max(1,Math.ceil((Math.max(Date.parse(record.expiresAt),Date.parse(record.fetchedAt)+RETAIN)-now)/1000));await cache.put(key,new Response(JSON.stringify(record),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+seconds}}));}catch{}return record;})();pending.set(station[0],task);task.finally(()=>{if(pending.get(station[0])===task)pending.delete(station[0]);}).catch(()=>{});}
 try{return reply(present(await task));}catch(error){return reply({ok:false,reason:FAILURES.has(error.message)?error.message:'INVALID_FORECAST_DATA'},503);}
 };}
const handler=createWeatherForecastHandler();
export const onRequest=context=>handler(context);
