'use strict';
// Real dashboard and scheduler; all accounts, events and HTTP responses are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {backend,boot,constants}=require('./dealer-scheduler.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_TODAY_SCHEDULE_DIR||'/workspace/work/today-schedule-v2215/browser';
const HOST='#snote-dealer-scheduler',TODAY=HOST+' [data-agenda=today]',UPCOMING=HOST+' [data-agenda=upcoming]',DIALOG='#snote-dealer-scheduler-dialog';
const CLOCK='2027-03-14T15:30:00.000Z',DAY='2027-03-15';
fs.mkdirSync(OUT,{recursive:true});
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function ready(p){await p.locator(HOST+'[data-state=ready]').waitFor();await p.waitForFunction(()=>!window.SnoteRouteTransition?.pending());await frames(p);}
async function begin(browser,state,width,label,clock=CLOCK){state.now=clock;const f=await boot(browser,state,width,label,'dealer@example.invalid',clock);await ready(f.page);return f;}
function record(s){return JSON.stringify([...s.events]);}
async function panel(p,selector=TODAY){return p.locator(selector).evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{classes:[...e.classList],animation:s.animationName,duration:s.animationDuration,iterations:s.animationIterationCount,border:s.borderTopColor,borderWidth:s.borderTopWidth,opacity:s.opacity,transform:s.transform,rect:{x:r.x,y:r.y,width:r.width,height:r.height},count:e.querySelector('.snote-scheduler-agenda-count')?.textContent};});}
async function until(p,id,days,root=UPCOMING){
 const button=p.locator(root+' [data-event-id="'+id+'"]');await button.waitFor();
 const badge=button.getByText(days+'일 후',{exact:true});assert.equal(await badge.count(),1,'Upcoming entries show a single exact calendar-day label');
 const geometry=await button.evaluate((e,text)=>{const b=[...e.querySelectorAll('*')].find(n=>n.textContent===text&&n.children.length===0),r=e.getBoundingClientRect(),c=b.getBoundingClientRect(),cx=c.x+c.width/2,cy=c.y+c.height/2;return{button:{x:r.x,right:r.right,y:r.y,bottom:r.bottom},badge:{x:c.x,right:c.right,y:c.y,bottom:c.bottom},occluded:cx>=0&&cx<innerWidth&&cy>=0&&cy<innerHeight?document.elementFromPoint(cx,cy)?.closest('[data-event-id]')!==e:null,text:e.textContent,aria:e.getAttribute('aria-label')};},days+'일 후');
 assert(geometry.badge.x>=geometry.button.x-.5&&geometry.badge.right<=geometry.button.right+.5,'Day label fits its clickable schedule');
 assert(geometry.badge.y>=geometry.button.y-.5&&geometry.badge.bottom<=geometry.button.bottom+.5,'Day label is visible within the schedule row');
 assert.notEqual(geometry.occluded,true,'An onscreen remaining-day label stays clear of floating controls');
 return geometry;
}
function noDayLabels(text){assert.doesNotMatch(text,/\d+일 후/);}
async function layout(p,width){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const r=await p.locator(TODAY).boundingBox();assert(r.x>=0&&r.x+r.width<=width+1);return r;}
async function display(browser){
 const s=backend(),a=s.seed(constants.A,{title:'오늘의 합성 방문',eventDate:DAY}),one=s.seed(constants.A,{title:'내일 합성 출고',eventDate:'2027-03-16'}),three=s.seed(constants.A,{title:'사흘 뒤 합성 이전',eventDate:'2027-03-18'}),seven=s.seed(constants.A,{title:'다음 주 합성 서류',eventDate:'2027-03-22'});
 s.seed(constants.A,{title:'완료한 미래 합성 일정',eventDate:'2027-03-17',completed:true});s.seed(constants.B,{title:'다른 딜러 합성 일정',eventDate:DAY});
 const before=record(s),f=await begin(browser,s,1440,'today-agenda-display'),p=f.page,results=[];
 try{
  for(const width of [1440,390]){
   await p.setViewportSize({width,height:950});await ready(p);const card=await panel(p);assert(card.classes.includes('has-today-events'));assert.equal(card.count,'1');assert.notEqual(card.animation,'none');assert(parseFloat(card.duration)>=3,'Reminder blinks slowly');assert.equal(card.iterations,'infinite');assert.equal(card.opacity,'1');assert.equal(card.transform,'none');
   assert.equal((await panel(p,UPCOMING)).animation,'none','Upcoming card itself does not pulse');
   const tomorrow=await until(p,one.id,1),later=await until(p,three.id,3);
   noDayLabels(await p.locator(TODAY).textContent());noDayLabels(await p.locator(HOST+' .snote-scheduler-grid').textContent());
   assert.equal(await p.locator(UPCOMING+' [data-event-id="'+seven.id+'"]').count(),0);
   const geometry=await layout(p,width);results.push({width,card,tomorrow,later,geometry});
   await p.screenshot({path:path.join(OUT,'today-upcoming-'+width+'.png'),fullPage:width<760});
  }
  const samples=[await panel(p)];for(let i=0;i<2;i++){await p.waitForTimeout(700);samples.push(await panel(p));}
  assert(new Set(samples.map(x=>x.border)).size>1,'Border color actually changes while text remains visible');
  for(const v of samples){assert.equal(v.opacity,'1');assert.equal(v.transform,'none');assert.equal(v.borderWidth,samples[0].borderWidth);for(const k of ['x','y','width','height'])assert(Math.abs(v.rect[k]-samples[0].rect[k])<.1,'Pulse cannot move the card');}
  await p.emulateMedia({reducedMotion:'reduce'});await frames(p);const reduced=await panel(p);assert.equal(reduced.animation,'none');assert.notEqual(reduced.border,'rgb(231, 236, 241)','Motion reduction retains a colored reminder');assert.equal(reduced.opacity,'1');
  await p.locator(UPCOMING+' .snote-scheduler-agenda-more').click();await p.locator(DIALOG+'[open]').waitFor();await until(p,seven.id,7,DIALOG);await p.locator(DIALOG+' .snote-popup-close').click();await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});
  assert.equal(record(s),before,'Presentation does not alter stored event values');assert.equal(s.writes.length,0);
  return{results,pulseSamples:samples,reducedMotion:reduced,fullUpcomingList:true,syntheticWrites:0};
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-display.png'),fullPage:true}).catch(()=>{});throw error;}finally{await f.finish();}
}
async function lifecycle(browser){
 const s=backend(),future=s.seed(constants.A,{title:'미래만 있는 합성 일정',eventDate:'2027-03-16'}),f=await begin(browser,s,390,'today-agenda-lifecycle'),p=f.page;
 try{
  const empty=await panel(p);assert.equal(empty.count,'0');assert(!empty.classes.includes('has-today-events'));assert.equal(empty.animation,'none');await until(p,future.id,1);
  await p.locator(HOST+' [data-date="'+DAY+'"] .snote-scheduler-date').click();await p.locator(DIALOG+'[open]').waitFor();await p.locator(DIALOG+' [name=title]').fill('오늘 추가된 합성 일정');await p.locator(DIALOG+' .snote-scheduler-save').click();await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});await ready(p);
  const added=[...s.events.values()].find(x=>x.title==='오늘 추가된 합성 일정');assert(added);assert.equal(added.eventDate,DAY);assert.equal(added.completed,false);assert((await panel(p)).classes.includes('has-today-events'));
  await p.locator(TODAY+' [data-event-id="'+added.id+'"]').click();await p.locator(DIALOG+'[open]').waitFor();await p.locator(DIALOG+' [name=completed]').setChecked(true);await p.locator(DIALOG+' .snote-scheduler-save').click();await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});await ready(p);assert.equal(s.events.get(added.id).completed,true);assert((await panel(p)).classes.includes('has-today-events'),'Existing today agenda includes completed schedules');
  await p.locator(TODAY+' [data-event-id="'+added.id+'"]').click();await p.locator(DIALOG+' .snote-scheduler-delete').click();const confirm=p.locator('#snote-message-dialog[open][data-message-kind=confirm]');await confirm.waitFor();await confirm.locator('[data-message-accept]').click();await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});await ready(p);
  const removed=await panel(p);assert(!removed.classes.includes('has-today-events'));assert.equal(removed.animation,'none');assert.equal(removed.count,'0');assert.equal(s.events.get(added.id).deleted,true);assert.equal(s.writes.length,3);await until(p,future.id,1);await p.screenshot({path:path.join(OUT,'today-empty-390.png'),fullPage:true});
  return{empty,afterDelete:removed,syntheticWrites:s.writes.length,completedTodayKeepsExistingMeaning:true};
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-lifecycle.png'),fullPage:true}).catch(()=>{});throw error;}finally{await f.finish();}
}
async function yearMidnight(browser){
 const clock='2027-12-31T14:59:40.000Z',s=backend();s.now=clock;const old=s.seed(constants.A,{title:'연말 오늘 합성 일정',eventDate:'2027-12-31'}),one=s.seed(constants.A,{title:'새해 첫날 합성 일정',eventDate:'2028-01-01'}),three=s.seed(constants.A,{title:'새해 사흘 합성 일정',eventDate:'2028-01-03'}),before=record(s),f=await begin(browser,s,1440,'today-year-midnight',clock),p=f.page;
 try{
  const initial=[await until(p,one.id,1),await until(p,three.id,3)];assert((await panel(p)).classes.includes('has-today-events'));
  s.now='2027-12-31T15:00:01.000Z';await p.clock.setSystemTime(new Date(s.now));await p.clock.runFor(1100);await ready(p);await p.waitForFunction(()=>document.querySelector('#snote-dealer-scheduler [data-agenda=today]')?.textContent.includes('새해 첫날 합성 일정'));
  const after=await until(p,three.id,2);assert.equal(await p.locator(UPCOMING+' [data-event-id="'+one.id+'"]').count(),0);noDayLabels(await p.locator(TODAY).textContent());assert.doesNotMatch(await p.locator(TODAY).textContent(),/연말 오늘/);assert((await panel(p)).classes.includes('has-today-events'));assert.equal(record(s),before);assert.equal(s.writes.length,0);
  return{initial,after,KSTMidnight:true,yearBoundary:true,priorEvent:old.id,syntheticWrites:0};
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-midnight.png'),fullPage:true}).catch(()=>{});throw error;}finally{await f.finish();}
}
async function leap(browser){
 const clock='2028-02-27T15:30:00.000Z',s=backend();s.now=clock;const one=s.seed(constants.A,{title:'윤일 합성 일정',eventDate:'2028-02-29'}),two=s.seed(constants.A,{title:'삼월 합성 일정',eventDate:'2028-03-01'}),before=record(s),f=await begin(browser,s,390,'today-leap',clock),p=f.page;
 try{const days=[await until(p,one.id,1),await until(p,two.id,2)];assert(!(await panel(p)).classes.includes('has-today-events'));assert.equal((await panel(p)).animation,'none');await layout(p,390);assert.equal(record(s),before);assert.equal(s.writes.length,0);return{days,leapMonthBoundary:true,syntheticWrites:0};}finally{await f.finish();}
}
async function fonts(browser){
 // Measured against the unchanged v2.214 calendar before this feature's 2px increase.
 const original={1440:{week:12,date:13},390:{week:10,date:10}},s=backend(),f=await begin(browser,s,1440,'calendar-readable-fonts'),p=f.page,results=[];
 try{
  for(const width of[1440,390]){
   await p.setViewportSize({width,height:950});await ready(p);
   const result=await p.locator(HOST).evaluate((host,width)=>{
    const value=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect();return{text:e.textContent,fontSize:parseFloat(s.fontSize),fontWeight:parseFloat(s.fontWeight),box:{x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height},textBox:{x:t.x,right:t.right,y:t.y,bottom:t.bottom}};};
    return{width,week:[...host.querySelectorAll('.snote-scheduler-week span')].map(value),dates:{ordinary:value(host.querySelector('[data-date="2027-03-16"] .snote-scheduler-date')),sunday:value(host.querySelector('[data-date="2027-03-21"] .snote-scheduler-date')),today:value(host.querySelector('[data-date="2027-03-15"] .snote-scheduler-date')),outside:value(host.querySelector('[data-date="2027-04-01"] .snote-scheduler-date'))}};
   },width);
   fs.writeFileSync(path.join(OUT,'font-measure-'+width+'.json'),JSON.stringify(result,null,2));
   for(const day of result.week){assert.equal(day.fontSize-original[width].week,2,'Every weekday grows exactly 2px');assert(day.fontWeight>400&&day.fontWeight<700,'Weekdays become slightly heavier');}
   for(const[kind,day]of Object.entries(result.dates)){assert.equal(day.fontSize-original[width].date,2,'All dates grow exactly 2px');assert.equal(day.box.width,width===1440?26:20);assert.equal(day.box.height,width===1440?26:20);if(kind==='today')assert.equal(day.fontWeight,700);else assert(day.fontWeight>400&&day.fontWeight<700,'Ordinary dates become slightly heavier');}
   for(const day of [...result.week,...Object.values(result.dates)]){assert(day.textBox.x>=day.box.x-.5&&day.textBox.right<=day.box.right+.5,'Calendar text fits horizontally');assert(day.textBox.y>=day.box.y-.5&&day.textBox.bottom<=day.box.bottom+.5,'Calendar text fits vertically');}
   await layout(p,width);results.push(result);await p.screenshot({path:path.join(OUT,'calendar-fonts-'+width+'.png'),fullPage:width<760});
  }
  assert.equal(s.writes.length,0);return{baseline:original,results,syntheticWrites:0};
 }finally{await f.finish();}
}
module.exports={display,lifecycle,yearMidnight,leap,fonts};
if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  for(const[name,run]of[['display',display],['lifecycle',lifecycle],['midnight',yearMidnight],['leap',leap],['fonts',fonts]].filter(([name])=>!process.env.SNOTE_TODAY_SCHEDULE_CASE||process.env.SNOTE_TODAY_SCHEDULE_CASE.split(',').includes(name))){results.push({name,...await run(browser)});console.log('PASS today-schedule '+name);}
  const files=['index.html','assets/dealer-scheduler.js','assets/dealer-scheduler.css','tests/today-schedule-v2215.browser.cjs'];fs.writeFileSync(path.join(OUT,'results'+(process.env.SNOTE_TODAY_SCHEDULE_CASE?'-'+process.env.SNOTE_TODAY_SCHEDULE_CASE:'')+'.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingRequests:0,operatingWrites:0,results,sourceHashes:Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,name))).digest('hex')]))},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
