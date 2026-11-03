/* Approximate connection-region weather. No browser location or customer data is sent. */
export async function onRequest({request}){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return reply({ok:false},405);
 const cf=request.cf||{},lat=Number(cf.latitude),lon=Number(cf.longitude);
 if(cf.latitude==null||cf.longitude==null||String(cf.latitude).trim()===''||String(cf.longitude).trim()===''||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return reply({ok:false,reason:'LOCATION_UNAVAILABLE'},503);
 const latitude=Math.round(lat*10)/10,longitude=Math.round(lon*10)/10,url=new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');url.search=new URLSearchParams({lat:String(latitude),lon:String(longitude)}).toString();
 const key=new Request(new URL('/api/weather-cache/'+latitude+'/'+longitude,request.url)),cache=globalThis.caches?.default;
 try{const saved=await cache?.match(key);if(saved){const data=await saved.json();return reply({...data,region:String(cf.city||'접속 지역').slice(0,80)});}}catch{}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{const r=await fetch(url,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'S-NOTE/2.47 (+https://s-note.pages.dev)'}});if(!r.ok)throw Error();const reader=r.body?.getReader();if(!reader)throw Error();let size=0,parts=[];while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288){await reader.cancel();throw Error();}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}const data=JSON.parse(new TextDecoder().decode(bytes)),series=data.properties?.timeseries;
 if(!Array.isArray(series)||!series.length||data.properties?.meta?.units?.air_temperature!=='celsius')throw Error();const current=series.filter(x=>Number.isFinite(Date.parse(x.time))).sort((a,b)=>Math.abs(Date.parse(a.time)-Date.now())-Math.abs(Date.parse(b.time)-Date.now()))[0],temperature=current?.data?.instant?.details?.air_temperature,symbol=current?.data?.next_1_hours?.summary?.symbol_code||current?.data?.next_6_hours?.summary?.symbol_code||'';
 if(typeof temperature!=='number'||!Number.isFinite(temperature)||temperature< -100||temperature>70||Math.abs(Date.parse(current.time)-Date.now())>10800000)throw Error();
 const code=/thunder/.test(symbol)?95:/snow|sleet/.test(symbol)?71:/rain/.test(symbol)?61:/fog/.test(symbol)?45:/partlycloudy/.test(symbol)?2:/cloudy/.test(symbol)?3:/fair/.test(symbol)?1:/clearsky/.test(symbol)?0:null;if(code==null)throw Error();
 const body={ok:true,temperature,code,observedAt:current.time,timezone:'UTC',source:'MET Norway',fetchedAt:new Date().toISOString()};if(cache)try{await cache.put(key,new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=600'}}));}catch{}return reply({...body,region:String(cf.city||'접속 지역').slice(0,80)});
 }catch{return reply({ok:false,reason:'WEATHER_UNAVAILABLE'},503);}finally{clearTimeout(timer);}
}
