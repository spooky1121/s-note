/* First-party KMA observations. No customer data, GPS permission or browser API key. */
const FEED='https://www.kma.go.kr/XML/weather/sfc_web_map.xml';
// Representative ASOS stations; select an available station near the connection region.
const STATIONS=[
 [90,38.2509,128.5647],[95,38.1479,127.3042],[98,37.9019,127.0607],[99,37.8859,126.7665],
 [100,37.6771,128.7183],[101,37.9026,127.7357],[105,37.7515,128.891],[106,37.5071,129.1243],
 [108,37.5714,126.9658],[112,37.4777,126.6249],[114,37.3375,127.9466],[115,37.4813,130.8986],
 [119,37.2722,126.9853],[121,37.1813,128.4574],[127,36.9705,127.9525],[129,36.7766,126.4939],
 [130,36.9918,129.4128],[131,36.6392,127.4407],[133,36.372,127.372],[135,36.2202,127.9946],
 [136,36.5729,128.7073],[137,36.4084,128.1574],[138,36.032,129.38],[140,36.0053,126.7614],
 [143,35.878,128.653],[146,35.8409,127.1172],[152,35.5824,129.3347],[155,35.1702,128.572],
 [156,35.1729,126.8916],[159,35.1047,129.032],[162,34.8455,128.4356],[165,34.8173,126.3815],
 [168,34.7393,127.7406],[169,34.6872,125.4511],[170,34.3959,126.7019],[172,35.3482,126.599],
 [174,35.0204,127.3694],[184,33.5141,126.5297],[185,33.2938,126.1631],[188,33.3868,126.8803],
 [189,33.2462,126.5653],[192,35.1638,128.04]
];
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x]));
function attrs(value){const out={};for(const match of value.matchAll(/([a-z_]+)\s*=\s*(["'])(.*?)\2/gi))out[match[1]]=decode(match[3]);return out;}
function codeFor(text){text=String(text).replace(/\s/g,'');return /뇌|천둥/.test(text)?95:/눈|진눈깨비/.test(text)?71:/비|소나기|이슬비/.test(text)?61:/안개|박무|연무/.test(text)?45:/구름많/.test(text)?2:/구름조금/.test(text)?1:/흐림/.test(text)?3:/맑음/.test(text)?0:100;}
export function parseKmaObservations(xml,now=Date.now()){
 if(typeof xml!=='string'||xml.length>262144||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('INVALID_KMA_DATA');
 const root=xml.match(/<weather\b([^>]*)>/i);if(!root||!/<\/weather\s*>/i.test(xml))throw Error('INVALID_KMA_DATA');
 const a=attrs(root[1]),parts=['year','month','day','hour'].map(k=>Number(a[k]));
 if(parts.some(n=>!Number.isInteger(n))||parts[0]<2020||parts[1]<1||parts[1]>12||parts[2]<1||parts[2]>31||parts[3]<0||parts[3]>23)throw Error('INVALID_KMA_TIME');
 const observed=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3]-9),age=now-observed;
 if(age< -1200000||age>10800000)throw Error('STALE_KMA_DATA');
 const rows=[];
 for(const local of xml.matchAll(/<local\b([^>]*)>([^<]*)<\/local\s*>/gi)){
  const item=attrs(local[1]),station=Number(item.stn_id),raw=String(item.ta??'').trim(),region=decode(local[2]).trim();
  if(!/^\d{2,3}$/.test(String(item.stn_id))||!/^[-+]?\d+(?:\.\d+)?$/.test(raw)||!region||region.length>40)continue;
  const temperature=Number(raw);if(!Number.isFinite(temperature)||temperature< -80||temperature>60)continue;
  const summary=String(item.desc||'').trim();rows.push({station,region,temperature,summary:summary&&summary!=='-'?summary:'관측값',code:codeFor(summary)});
 }
 if(!rows.length)throw Error('NO_KMA_OBSERVATIONS');
 return {observedAt:new Date(observed).toISOString(),rows};
}
function coordinates(cf,env){const fixed=env.WEATHER_LATITUDE!==undefined||env.WEATHER_LONGITUDE!==undefined;
 const rawLat=fixed?env.WEATHER_LATITUDE:cf.latitude,rawLon=fixed?env.WEATHER_LONGITUDE:cf.longitude;
 if(rawLat==null||rawLon==null||String(rawLat).trim()===''||String(rawLon).trim()==='')return null;
 const lat=Number(rawLat),lon=Number(rawLon);return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=32&&lat<=39.5&&lon>=124&&lon<=132?{lat,lon}:null;
}
async function readFeed(signal){
 const response=await fetch(FEED,{signal,redirect:'error',headers:{Accept:'application/xml,text/xml','User-Agent':'S-NOTE/2.54 (+https://s-note.pages.dev)'}});
 if(!response.ok)throw Error('KMA_UNAVAILABLE');const reader=response.body?.getReader();if(!reader)throw Error('KMA_UNAVAILABLE');
 let length=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>262144){await reader.cancel();throw Error('KMA_TOO_LARGE');}chunks.push(value);}
 const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 return parseKmaObservations(new TextDecoder().decode(data));
}
export async function onRequest({request,env={}}){
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return reply({ok:false},405);
 const stationParam=new URL(request.url).searchParams.get('station'),requested=stationParam&&STATIONS.find(([id])=>String(id)===stationParam);
 if(stationParam&&!requested)return reply({ok:false,reason:'INVALID_STATION'},400);
 const point=requested?{lat:requested[1],lon:requested[2]}:coordinates(request.cf||{},env);if(!point)return reply({ok:false,reason:'LOCATION_UNAVAILABLE'},503);
 const cache=globalThis.caches?.default,key=new Request(new URL('/api/weather-cache/kma-observations-v1',request.url));
 let feed=null;
 try{const saved=await cache?.match(key);if(saved){const cached=await saved.json();const age=Date.now()-Date.parse(cached.observedAt);if(age>=-1200000&&age<=10800000&&Array.isArray(cached.rows)&&cached.rows.length)feed=cached;}}catch{}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
 try{
  if(!feed){feed=await readFeed(controller.signal);if(cache)try{await cache.put(key,new Response(JSON.stringify(feed),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=600'}}));}catch{}}
  const stations=STATIONS.map(([id,lat,lon])=>{const item=feed.rows.find(row=>row.station===id);return item?{item,distance:Math.hypot((lat-point.lat)*111,(lon-point.lon)*111*Math.cos(point.lat*Math.PI/180))}:null;}).filter(Boolean).sort((a,b)=>a.distance-b.distance);
  const nearest=stations[0];if(!nearest||nearest.distance>120||(requested&&nearest.item.station!==requested[0]))throw Error('NO_NEARBY_STATION');
  return reply({ok:true,...nearest.item,source:'기상청',sourceUrl:FEED,observedAt:feed.observedAt,timezone:'Asia/Seoul',locationBasis:requested?'선택한 관측소':'접속 지역 인근 관측소',fetchedAt:new Date().toISOString()});
 }catch{return reply({ok:false,reason:'WEATHER_UNAVAILABLE'},503);}finally{clearTimeout(timer);}
}
