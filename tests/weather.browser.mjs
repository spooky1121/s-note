// Actual header/module/Pages handler; all KMA and first-party responses are synthetic.
// A paused browser clock verifies recovery without waiting hours or contacting production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {onRequest} from '../functions/api/weather.js';
const require=createRequire(import.meta.url),{chromium}=require('./encar/node_modules/playwright');
const source=fs.readFileSync(new URL('../assets/workspace-refine.js',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../assets/workspace-refine.css',import.meta.url),'utf8');
const actualIndex=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const badgeMarkup=actualIndex.match(/<(button|a) id="snote-weather"[^>]*>[\s\S]*?<\/\1>/)?.[0];
assert(badgeMarkup,'Use the real header weather control');
const output=process.env.WEATHER_TEST_ARTIFACT_DIR||'/tmp/snote-weather';fs.mkdirSync(output,{recursive:true});
const now=new Date();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(page,predicate,message){
 for(let i=0;i<200;i++){if(await page.evaluate(predicate))return;await delay(10);}
 assert.fail(message||'Browser condition did not settle');
}
async function settled(page,state){await until(page,()=>!document.querySelector('#snote-weather').hasAttribute('aria-busy'),'Weather request did not settle');assert.equal(await page.locator('#snote-weather').getAttribute('data-state'),state);}
async function advance(page,ms){await page.clock.fastForward(ms);await delay(15);}
const xml=(temperature,description)=>{const d=new Date(Date.now()+32400000);return `<?xml version="1.0" encoding="UTF-8"?><weather year="${d.getUTCFullYear()}" month="${d.getUTCMonth()+1}" day="${d.getUTCDate()}" hour="${d.getUTCHours()}"><local stn_id="108" desc="${description}" ta="${temperature}">서울</local></weather>`;};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
try{for(const width of[1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:760}}),page=await context.newPage(),errors=[],external=[],urls=[];
 let hits=0,mode='hold',invalid=null,releaseInitial=null,temperature=0,description='맑음';
 page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install({time:now});await page.clock.pauseAt(now);
 await page.addInitScript(()=>{
  window.__weatherRequests=[];window.__weatherVisible=true;window.__weatherOnline=true;
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__weatherVisible?'visible':'hidden'});
  Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__weatherOnline});
  const native=window.fetch;
  window.fetch=(input,options)=>{
   window.__weatherRequests.push({url:String(input),at:Date.now(),cache:options?.cache,credentials:options?.credentials});
   return native(input,options).then(response=>{
    if(!window.__deferWeatherResponse)return response;
    window.__deferWeatherResponse=false;
    return new Promise(resolve=>{window.__releaseWeatherResponse=()=>resolve(response);});
   });
  };
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.href==='https://weather-check.example/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><style>'+styles+'</style></head><body>'+badgeMarkup+'<script>'+source+'</script></body></html>'});
  if(url.origin!=='https://weather-check.example'||url.pathname!=='/api/weather'){external.push(url.href);return route.abort();}
  hits++;urls.push(url.search);
  if(mode==='hold')await new Promise(resolve=>{releaseInitial=resolve;});
  if(mode==='fail')return route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"reason":"KMA_HTTP_UNAVAILABLE"}'});
  if(mode==='invalid')return route.fulfill({contentType:'application/json',body:JSON.stringify(invalid)});
  if(mode==='current'||mode==='stale'){
   const browserNow=await page.evaluate(()=>Date.now());
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,source:'기상청',region:'서울',temperature,code:0,summary:'맑음',observedAt:new Date(browserNow).toISOString(),stale:mode==='stale',...(mode==='stale'?{reason:'KMA_TIMEOUT'}:{})})});
  }
  // Exercise the real Pages parser/response contract for the initial success and colors.
  const previous=global.fetch;
  try{global.fetch=async()=>new Response(xml(temperature,description));const response=await onRequest({request:new Request(route.request().url())});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});}
  finally{global.fetch=previous;}
 });
 await page.goto('https://weather-check.example/',{waitUntil:'domcontentloaded'});
 const badge=page.locator('#snote-weather'),temp=badge.locator('[data-weather-temp]'),live=page.locator('.snote-weather-live');
 const click=()=>badge.evaluate(e=>e.click());
 await until(page,()=>document.querySelector('#snote-weather').dataset.state==='loading');assert.equal(hits,1);assert.equal(urls[0],'?refresh=1');assert.equal(await badge.getAttribute('aria-busy'),'true');assert.match(await live.textContent(),/새로 확인/);
 await badge.evaluate(e=>{e.click();e.click();e.click();});assert.equal(hits,1,'Single-flight initial request');
 mode='fail';releaseInitial();await settled(page,'unavailable');assert.equal(await temp.textContent(),'—°');assert.match(await badge.getAttribute('aria-label'),/눌러서 다시 확인/);assert.equal(await badge.getAttribute('href'),null);assert.equal(await badge.getAttribute('target'),null);
 // Automatic retries grow to a bounded five minutes and use the server cache path.
 for(const wait of[30000,60000,120000,240000,300000,300000]){
  const before=hits;await advance(page,wait-1);assert.equal(hits,before,'No early retry');await advance(page,1);await settled(page,'unavailable');assert.equal(hits,before+1);assert.equal(urls.at(-1),'');
 }
 // Manual refresh bypasses backoff, while rapid activation remains debounced.
 await advance(page,800);mode='ok';await click();await settled(page,'ready');assert.equal(urls.at(-1),'?refresh=1');assert.equal(await temp.textContent(),'0°');
 const title=await badge.getAttribute('aria-label');assert.match(title,/서울 기준 \(접속 위치 확인 불가\)/);assert.match(title,/기상청 \d{4}-\d\d-\d\d \d\d:\d\d 관측/);assert.match(title,/\d{4}-\d\d-\d\d \d\d:\d\d 확인/);assert(!title.includes('undefined'));assert.equal(await live.getAttribute('aria-live'),'polite');assert.equal(await badge.locator('[data-weather-icon]').evaluate(e=>getComputedStyle(e).color),'rgb(233, 179, 41)');await badge.screenshot({path:output+'/sun-'+width+'.png'});
 const beforeRapid=hits;await click();await advance(page,749);await click();assert.equal(hits,beforeRapid,'750ms completed-request debounce');
 for(const [summary,value,condition,color]of[['구름많음',7.2,'cloud','rgb(121, 185, 227)'],['비',5,'rain','rgb(36, 43, 53)']]){
  description=summary;temperature=value;await advance(page,800);await click();await settled(page,'ready');assert.equal(await badge.getAttribute('data-condition'),condition);assert.equal(await badge.locator('[data-weather-icon]').evaluate(e=>getComputedStyle(e).color),color);assert.equal(await temp.textContent(),Math.round(value)+'°');await badge.screenshot({path:output+'/'+condition+'-'+width+'.png'});
 }
 assert.equal(page.url(),'https://weather-check.example/');assert.equal(context.pages().length,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // A successful observation refreshes automatically exactly five minutes later.
 const beforePoll=hits;await advance(page,299999);assert.equal(hits,beforePoll);await advance(page,1);await settled(page,'ready');assert.equal(hits,beforePoll+1);assert.equal(urls.at(-1),'');
 const retainedObservation=(await badge.getAttribute('aria-label')).match(/기상청 .*? 관측/)[0],retainedCheck=(await badge.getAttribute('aria-label')).match(/\d{4}-\d\d-\d\d \d\d:\d\d 확인/)[0];
 mode='invalid';for(const data of[{ok:true,temperature:'0',code:0,region:'서울',source:'기상청',observedAt:now.toISOString()},{ok:true,temperature:0,code:0,region:'',source:'기상청',observedAt:now.toISOString()},{ok:true,temperature:0,code:0,region:'서울',source:'기상청',observedAt:new Date(now.getTime()-14400000).toISOString()}]){
  invalid=data;await advance(page,800);await click();await settled(page,'stale');assert.equal(await temp.textContent(),'5°');const text=await badge.getAttribute('aria-label');assert(text.includes(retainedObservation));assert(text.includes(retainedCheck));assert.match(text,/새로고침 실패, 이전 관측값/);
 }
 // A server's valid outage fallback must remain stale and trigger another retry.
 mode='stale';temperature=6;await advance(page,800);await click();await settled(page,'stale');assert.equal(await temp.textContent(),'6°');mode='current';temperature=-2.4;const beforeStaleRetry=hits;await advance(page,240000);await settled(page,'ready');assert.equal(hits,beforeStaleRetry+1);assert.equal(await temp.textContent(),'-2°');assert.equal(urls.at(-1),'');
 // Hidden pages stop all polling; a stale/failed page recovers once on return.
 await page.evaluate(()=>{window.__weatherVisible=false;document.dispatchEvent(new Event('visibilitychange'));});const beforeHidden=hits;await advance(page,600000);assert.equal(hits,beforeHidden);
 await page.evaluate(()=>{window.__weatherVisible=true;document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('online'));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await settled(page,'ready');assert.equal(hits,beforeHidden+1,'Return events coalesce');
 // A fresh BFCache round trip waits for the original next poll rather than adding a timer.
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));const beforeFreshReturn=hits;await advance(page,120000);await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));assert.equal(hits,beforeFreshReturn);await advance(page,179999);assert.equal(hits,beforeFreshReturn);await advance(page,1);await settled(page,'ready');assert.equal(hits,beforeFreshReturn+1);
 // BFCache can suspend after HTTP resolves; a late old response never replaces the new one.
 await advance(page,800);await page.evaluate(()=>{window.__deferWeatherResponse=true;});temperature=8;await click();await until(page,()=>typeof window.__releaseWeatherResponse==='function');const beforeReturn=hits;temperature=11;
 await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await settled(page,'ready');assert.equal(hits,beforeReturn+1);assert.equal(await temp.textContent(),'11°');await page.evaluate(()=>{window.__releaseWeatherResponse();delete window.__releaseWeatherResponse;});await delay(20);assert.equal(await temp.textContent(),'11°');
 // Offline mode stops requests, but a visible expired observation is removed at three hours.
 await page.evaluate(()=>{window.__weatherOnline=false;dispatchEvent(new Event('offline'));});const beforeOffline=hits;await advance(page,10800001);assert.equal(hits,beforeOffline);assert.equal(await badge.getAttribute('data-state'),'unavailable');assert.equal(await temp.textContent(),'—°');await click();assert.equal(hits,beforeOffline);
 temperature=0;await page.evaluate(()=>{window.__weatherOnline=true;dispatchEvent(new Event('online'));});await settled(page,'ready');assert.equal(hits,beforeOffline+1);assert.equal(await temp.textContent(),'0°');
 // The complete response/body deadline is twelve seconds, followed by the first retry delay.
 await advance(page,800);await page.evaluate(()=>{window.__deferWeatherResponse=true;});await click();await until(page,()=>typeof window.__releaseWeatherResponse==='function');const beforeTimeout=hits;await advance(page,11999);assert.equal(await badge.getAttribute('aria-busy'),'true');await advance(page,1);await settled(page,'stale');await advance(page,29999);assert.equal(hits,beforeTimeout);temperature=4;await advance(page,1);await settled(page,'ready');assert.equal(hits,beforeTimeout+1);assert.equal(await temp.textContent(),'4°');await page.evaluate(()=>{window.__releaseWeatherResponse();delete window.__releaseWeatherResponse;});await delay(15);assert.equal(await temp.textContent(),'4°');
 // A failed visible page retries immediately when its visibility is restored, before its backoff.
 mode='fail';await advance(page,800);await click();await settled(page,'stale');const beforeFailedReturn=hits;await page.evaluate(()=>{window.__weatherVisible=false;document.dispatchEvent(new Event('visibilitychange'));});await advance(page,800);mode='current';temperature=3;await page.evaluate(()=>{window.__weatherVisible=true;document.dispatchEvent(new Event('visibilitychange'));});await settled(page,'ready');assert.equal(hits,beforeFailedReturn+1);
 // An older successful edge response cannot reset the latest observation's check time.
 const beforeRegressedLabel=await badge.getAttribute('aria-label');mode='invalid';invalid={ok:true,source:'기상청',region:'서울',temperature:17,code:0,observedAt:new Date(await page.evaluate(()=>Date.now())-60000).toISOString(),stale:false};await advance(page,800);await click();await settled(page,'stale');assert.equal(await temp.textContent(),'3°');assert((await badge.getAttribute('aria-label')).includes(beforeRegressedLabel.match(/\d{4}-\d\d-\d\d \d\d:\d\d 확인/)[0]));
 // The initial server fallback also stays stale, and a reload creates only one new initial request.
 mode='stale';temperature=0;await page.reload({waitUntil:'domcontentloaded'});await settled(page,'stale');assert.equal(await temp.textContent(),'0°');const afterReload=hits;const requests=await page.evaluate(()=>window.__weatherRequests);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/weather?refresh=1');assert.equal(requests[0].cache,'no-store');assert.equal(requests[0].credentials,'omit');mode='current';await advance(page,30000);await settled(page,'ready');assert.equal(hits,afterReload+1);assert.equal(urls.at(-1),'');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await context.close();console.log('PASS',width,'actual weather module + synthetic Pages/KMA: bounded recovery, manual/scheduled cache paths, 5min polling, pause/resume/online/BFCache, twelve-second deadline, stale/expiry, zero/color, single-flight/debounce, no external requests');
}}finally{await browser.close();}
