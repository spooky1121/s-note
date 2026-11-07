(()=>{'use strict';if(window.snote247Refine)return;window.snote247Refine=true;
for(const mark of document.querySelectorAll('.snote-brand-home .snote-wordmark')){const image=mark.querySelector('img');if(!image)continue;mark.classList.add('snote-spaced-logo');const first=document.createElement('span'),rest=document.createElement('span');first.className='snote-logo-s';rest.className='snote-logo-note';const copy=image.cloneNode();copy.alt='';copy.setAttribute('aria-hidden','true');first.append(image);rest.append(copy);mark.replaceChildren(first,rest);}
const weather=document.getElementById('snote-weather');if(!weather)return;
const maximumAge=10800000;
let inflight=false,latest=null,checkedAt=null,controller=null,away=false,lastStartedAt=-Infinity,resumePending=false;
const shapes={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',cloud:'<path d="M6.5 18a4.5 4.5 0 1 1 .8-8.9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 18.2 18Z"/>',rain:'<path d="M6.5 14.5a4 4 0 1 1 .8-7.9 5.4 5.4 0 0 1 10.3 1.3 3.4 3.4 0 0 1 .6 6.6M8 18l-1 3m6-3-1 3m6-3-1 3"/>',snow:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M3.6 10.5l4.1-1.1-1.1-4.1m10.8 13.4-1.1-4.1 4.1-1.1M3.6 13.5l4.1 1.1-1.1 4.1M17.4 5.3l-1.1 4.1 4.1 1.1"/>',fog:'<path d="M4 8h16M2 12h20M4 16h16M7 20h10"/>',storm:'<path d="M6.5 14.5a4 4 0 1 1 .8-7.9 5.4 5.4 0 0 1 10.3 1.3 3.4 3.4 0 0 1 .6 6.6M13 12l-4 6h4l-2 5 6-8h-4l2-3"/>',unknown:'<circle cx="12" cy="12" r="8" stroke-dasharray="2 4"/>'};
const categories=code=>code===100?['관측값','unknown']:code===0?['맑음','sun']:code<=3?['구름','cloud']:code<=48?['안개','fog']:code>=95?['뇌우','storm']:code>=71&&code<=77||code===85||code===86?['눈','snow']:['비','rain'];
weather.removeAttribute('href');weather.removeAttribute('target');weather.removeAttribute('rel');weather.removeAttribute('role');
if(weather.tagName==='A'){weather.setAttribute('role','button');weather.tabIndex=0;}
const status=document.createElement('span');status.className='snote-weather-live';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');weather.insertAdjacentElement('afterend',status);
function valid(data){const time=Date.parse(data?.observedAt),age=Date.now()-time;return data?.ok===true&&data.source==='기상청'&&Number.isFinite(data.temperature)&&data.temperature>=-80&&data.temperature<=60&&Number.isInteger(data.code)&&data.code>=0&&data.code<=100&&typeof data.region==='string'&&data.region.trim()!==''&&data.region.length<=40&&Number.isFinite(time)&&age>=-1200000&&age<=maximumAge;}
function label(text){weather.title=text;weather.dataset.tooltip=text;weather.setAttribute('aria-label',text);}
function icon(kind){weather.dataset.condition=kind;weather.querySelector('[data-weather-icon]').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+shapes[kind]+'</svg>';}
function time(value){return new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function render(data,stale=false){const[summary,kind]=categories(data.code);icon(kind);weather.querySelector('[data-weather-temp]').textContent=Math.round(data.temperature)+'°';weather.dataset.state=stale?'stale':'ready';weather.dataset.region=data.region;const text=`${data.region} · ${data.summary||summary} · 실외 ${data.temperature}°C · 기상청 ${time(data.observedAt)} 관측 (${data.locationBasis||'접속 지역 인근 관측소'}) · ${time(checkedAt)} 확인${stale?' · 새로고침 실패, 이전 관측값':''} · 눌러서 새로고침`;label(text);status.textContent=stale?'날씨를 새로고침하지 못했습니다. '+text:'날씨를 새로 확인했습니다. '+text;}
function unavailable(){delete weather.dataset.region;icon('unknown');weather.querySelector('[data-weather-temp]').textContent='—°';weather.dataset.state='unavailable';const text='기상청 날씨를 불러오지 못했습니다. 눌러서 다시 확인하세요.';label(text);status.textContent=text;}
async function refresh(manual=false){
 if(inflight||away)return;
 const now=Date.now();if(manual&&now-lastStartedAt<750)return;lastStartedAt=now;
 inflight=true;weather.setAttribute('aria-busy','true');weather.setAttribute('aria-disabled','true');weather.dataset.state=latest?'refreshing':'loading';status.textContent='기상청 날씨를 새로 확인하고 있습니다.';label('기상청 날씨를 새로 확인하고 있습니다.');
 controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),8000);
 try{const response=await fetch('/api/weather?refresh=1',{cache:'no-store',credentials:'omit',signal:active.signal,headers:{Accept:'application/json'}}),data=await response.json();if(!response.ok||!valid(data))throw Error('WEATHER_UNAVAILABLE');if(away)return;latest=data;checkedAt=Date.now();render(data);}
 catch{if(away)return;if(latest)render(latest,true);else unavailable();}
 finally{clearTimeout(timeout);inflight=false;weather.removeAttribute('aria-busy');weather.removeAttribute('aria-disabled');if(controller===active)controller=null;if(resumePending&&!away){resumePending=false;refresh();}}
}
weather.addEventListener('click',event=>{event.preventDefault();refresh(true);});
if(weather.tagName==='A')weather.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();refresh(true);}});
icon('unknown');refresh();addEventListener('pagehide',()=>{away=true;resumePending=false;controller?.abort();});addEventListener('pageshow',event=>{if(event.persisted){away=false;if(inflight)resumePending=true;else refresh();}});
})();
