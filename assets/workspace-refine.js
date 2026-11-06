(()=>{'use strict';if(window.snote247Refine)return;window.snote247Refine=true;
for(const mark of document.querySelectorAll('.snote-brand-home .snote-wordmark')){const image=mark.querySelector('img');if(!image)continue;mark.classList.add('snote-spaced-logo');const first=document.createElement('span'),rest=document.createElement('span');first.className='snote-logo-s';rest.className='snote-logo-note';const copy=image.cloneNode();copy.alt='';copy.setAttribute('aria-hidden','true');first.append(image);rest.append(copy);mark.replaceChildren(first,rest);}
const weather=document.getElementById('snote-weather');if(!weather)return;
const maximumAge=10800000,successInterval=600000;
let inflight=false,lastSuccess=0,retryAt=0,failures=0,latest=null,timer=null,controller=null,away=false;
const categories=code=>code===100?['관측값','◌']:code===0?['맑음','☀']:code<=3?['구름','☁']:code<=48?['안개','≋']:code>=95?['뇌우','ϟ']:code>=71&&code<=77||code===85||code===86?['눈','❄']:['비','☂'];
function valid(data){const time=Date.parse(data?.observedAt),age=Date.now()-time;return data?.ok===true&&data.source==='기상청'&&Number.isFinite(data.temperature)&&data.temperature>=-80&&data.temperature<=60&&Number.isInteger(data.code)&&data.code>=0&&data.code<=100&&typeof data.region==='string'&&data.region.trim()!==''&&data.region.length<=40&&Number.isFinite(time)&&age>=-1200000&&age<=maximumAge;}
function label(text){weather.title=text;weather.dataset.tooltip=text;weather.setAttribute('aria-label',text);}
function render(data,stale=false){const[summary,icon]=categories(data.code);weather.querySelector('[data-weather-icon]').textContent=icon;weather.querySelector('[data-weather-temp]').textContent=Math.round(data.temperature)+'°';weather.dataset.state=stale?'stale':'ready';weather.dataset.region=data.region;const time=new Date(data.observedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});label(`${data.region} · ${data.summary||summary} · 실외 ${data.temperature}°C · 기상청 ${time} 관측 (${data.locationBasis||'접속 지역 인근 관측소'})${stale?' · 갱신 대기':''}`);}
function unavailable(){delete weather.dataset.region;weather.querySelector('[data-weather-icon]').textContent='☁';weather.querySelector('[data-weather-temp]').textContent='—°';weather.dataset.state='unavailable';label('기상청 날씨를 불러오지 못했습니다. 잠시 후 다시 확인합니다.');}
function schedule(delay){clearTimeout(timer);if(!away)timer=setTimeout(()=>refresh(),Math.max(0,delay));}
async function refresh(force=false){
 if(inflight||away)return;
 if(document.hidden){schedule(30000);return;}
 const now=Date.now(),next=failures?retryAt:lastSuccess+successInterval;
 if(!force&&now<next){schedule(next-now);return;}
 inflight=true;controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),8000);
 try{const response=await fetch('/api/weather',{cache:'no-store',credentials:'omit',signal:active.signal,headers:{Accept:'application/json'}}),data=await response.json();if(!response.ok||!valid(data))throw Error('WEATHER_UNAVAILABLE');if(away)return;latest=data;lastSuccess=Date.now();failures=0;retryAt=0;render(data);schedule(successInterval);}
 catch{if(away)return;failures++;const delay=Math.min(300000,30000*2**Math.min(4,failures-1));retryAt=Date.now()+delay;if(latest&&valid(latest))render(latest,true);else{latest=null;unavailable();}schedule(delay);}
 finally{clearTimeout(timeout);inflight=false;if(controller===active)controller=null;}
}
refresh();document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});addEventListener('online',()=>refresh(true));addEventListener('pagehide',()=>{away=true;clearTimeout(timer);controller?.abort();});addEventListener('pageshow',event=>{if(event.persisted){away=false;refresh(true);}});
})();
