// Actual weather module + Pages function, synthetic KMA upstream and browser clock.
import assert from 'node:assert/strict';import fs from 'node:fs';import{createRequire}from'node:module';import{onRequest}from'../functions/api/weather.js';
const require=createRequire(import.meta.url),{chromium}=require('./encar/node_modules/playwright');
const source=fs.readFileSync(new URL('../assets/workspace-refine.js',import.meta.url),'utf8'),styles=fs.readFileSync(new URL('../assets/workspace-refine.css',import.meta.url),'utf8');
const actualIndex=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),badgeMarkup=actualIndex.match(/<(button|a) id="snote-weather"[^>]*>[\s\S]*?<\/\1>/)?.[0];assert(badgeMarkup,'Use the real header weather control');
const output=process.env.WEATHER_TEST_ARTIFACT_DIR||'/tmp/snote-weather';fs.mkdirSync(output,{recursive:true});
const now=new Date();
function xml(temperature,description){const d=new Date(Date.now()+32400000);return `<?xml version="1.0" encoding="UTF-8"?><weather year="${d.getUTCFullYear()}" month="${d.getUTCMonth()+1}" day="${d.getUTCDate()}" hour="${d.getUTCHours()}"><local stn_id="108" desc="${description}" ta="${temperature}">서울</local></weather>`;}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
try{for(const width of[1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:760}}),page=await context.newPage(),errors=[],external=[];let hits=0,mode='hold',invalid=null,release=null,temperature=0,description='맑음';
 page.on('pageerror',error=>errors.push(error.message));await page.clock.install({time:now});
 await page.addInitScript(()=>{window.__weatherRequests=[];const native=window.fetch;window.fetch=(input,options)=>{window.__weatherRequests.push({url:String(input),cache:options?.cache,credentials:options?.credentials});return native(input,options).then(response=>{if(!window.__deferWeatherResponse)return response;window.__deferWeatherResponse=false;return new Promise(resolve=>{window.__releaseWeatherResponse=()=>resolve(response);});});};});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.href==='https://weather-check.example/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><style>'+styles+'</style></head><body>'+badgeMarkup+'<script>'+source+'</script></body></html>'});
  if(url.origin!=='https://weather-check.example'||url.pathname!=='/api/weather'){external.push(url.href);return route.abort();}
  hits++;assert.equal(url.searchParams.get('refresh'),'1');
  if(mode==='hold')await new Promise(resolve=>{release=resolve;});
  if(mode==='fail')return route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"reason":"KMA_HTTP_UNAVAILABLE"}'});
  if(mode==='invalid')return route.fulfill({contentType:'application/json',body:JSON.stringify(invalid)});
  const previous=global.fetch;try{global.fetch=async(_url,options)=>{assert.equal(options.cache,'no-store');return new Response(xml(temperature,description));};const response=await onRequest({request:new Request(route.request().url())});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});}finally{global.fetch=previous;}
 });
 await page.goto('https://weather-check.example/',{waitUntil:'domcontentloaded'});const badge=page.locator('#snote-weather'),live=page.locator('.snote-weather-live');
 await page.waitForFunction(()=>document.querySelector('#snote-weather').dataset.state==='loading');assert.equal(hits,1);assert.equal(await badge.getAttribute('aria-busy'),'true');assert.match(await live.textContent(),/새로 확인/);
 // Repeated activation while a request is pending shares that request and never navigates.
 await badge.evaluate(e=>{e.click();e.click();e.click();});await page.waitForTimeout(20);assert.equal(hits,1);mode='fail';release();await page.waitForFunction(()=>document.querySelector('#snote-weather').dataset.state==='unavailable');assert.equal(await badge.locator('[data-weather-temp]').textContent(),'—°');assert.match(await badge.getAttribute('aria-label'),/눌러서 다시 확인/);assert.equal(await badge.getAttribute('href'),null);assert.equal(await badge.getAttribute('target'),null);
 // No retry, interval, online or visibility polling. A click explicitly requests new data.
 await page.clock.fastForward(1800000);await page.evaluate(()=>{dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});assert.equal(hits,1);
 mode='ok';await badge.click();await page.waitForFunction(()=>document.querySelector('#snote-weather').dataset.state==='ready');assert.equal(hits,2);assert.equal(await badge.locator('[data-weather-temp]').textContent(),'0°');const title=await badge.getAttribute('aria-label');assert.match(title,/서울 기준 \(접속 위치 확인 불가\)/);assert.match(title,/기상청 \d{4}-\d\d-\d\d \d\d:\d\d 관측/);assert.match(title,/\d{4}-\d\d-\d\d \d\d:\d\d 확인/);assert(!title.includes('undefined'));assert.equal(await live.getAttribute('aria-live'),'polite');assert.equal(await badge.locator('[data-weather-icon]').evaluate(e=>getComputedStyle(e).color),'rgb(233, 179, 41)');await badge.screenshot({path:output+'/sun-'+width+'.png'});
 await badge.evaluate(e=>{e.click();e.click();});assert.equal(hits,2,'Rapid repeated clicks are debounced after completion');
 for(const [summary,value,condition,color]of[['구름많음',7.2,'cloud','rgb(121, 185, 227)'],['비',5,'rain','rgb(36, 43, 53)']]){
  description=summary;temperature=value;await page.clock.fastForward(800);await badge.click();await page.waitForFunction(condition=>document.querySelector('#snote-weather').dataset.state==='ready'&&document.querySelector('#snote-weather').dataset.condition===condition,condition);assert.equal(await badge.locator('[data-weather-icon]').evaluate(e=>getComputedStyle(e).color),color);assert.equal(await badge.locator('[data-weather-temp]').textContent(),Math.round(value)+'°');await badge.screenshot({path:output+'/'+condition+'-'+width+'.png'});
 }
 assert.equal(hits,4);assert.equal(page.url(),'https://weather-check.example/');assert.equal(context.pages().length,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const retainedObservation=(await badge.getAttribute('aria-label')).match(/기상청 .*? 관측/)[0],retainedCheck=(await badge.getAttribute('aria-label')).match(/\d{4}-\d\d-\d\d \d\d:\d\d 확인/)[0];
 mode='invalid';for(const data of[{ok:true,temperature:'0',code:0,region:'서울',source:'기상청',observedAt:now.toISOString()},{ok:true,temperature:0,code:0,region:'',source:'기상청',observedAt:now.toISOString()},{ok:true,temperature:0,code:0,region:'서울',source:'기상청',observedAt:new Date(now.getTime()-14400000).toISOString()}]){
  invalid=data;await page.clock.fastForward(800);await badge.click();await page.waitForFunction(()=>document.querySelector('#snote-weather').dataset.state==='stale');assert.equal(await badge.locator('[data-weather-temp]').textContent(),'5°');const text=await badge.getAttribute('aria-label');assert(text.includes(retainedObservation));assert(text.includes(retainedCheck));assert.match(text,/새로고침 실패, 이전 관측값/);
 }
 const beforeIdle=hits;await page.clock.fastForward(14400000);await page.evaluate(()=>dispatchEvent(new Event('online')));assert.equal(hits,beforeIdle);assert.equal(await badge.locator('[data-weather-temp]').textContent(),'5°');
 // A real page reload issues a new first-party request and does not reuse the last displayed value.
 await page.clock.setSystemTime(now);mode='ok';temperature=-2.4;description='맑음';await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#snote-weather').dataset.state==='ready');assert.equal(hits,beforeIdle+1);assert.equal(await badge.locator('[data-weather-temp]').textContent(),'-2°');assert.equal(await badge.getAttribute('aria-busy'),null);
 const requests=await page.evaluate(()=>window.__weatherRequests);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/weather?refresh=1');assert.equal(requests[0].cache,'no-store');assert.equal(requests[0].credentials,'omit');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 // Returning from the browser page cache while the previous request is settling still refreshes once.
 await page.clock.fastForward(800);await page.evaluate(()=>{window.__deferWeatherResponse=true;});await badge.click();await page.waitForFunction(()=>typeof window.__releaseWeatherResponse==='function');const beforeReturn=hits;
 await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.__releaseWeatherResponse();});await page.waitForFunction(()=>window.__weatherRequests.length===3&&document.querySelector('#snote-weather').dataset.state==='ready');assert.equal(hits,beforeReturn+1);assert.deepEqual(errors,[]);
 await context.close();console.log('PASS',width,'real header control + Pages KMA API: fresh load/reload/click, no polling/navigation, single-flight/debounce, zero temperature, dated KST tooltip, state colors, retained valid observation after failures, invalid data rejected');
}}finally{await browser.close();}
