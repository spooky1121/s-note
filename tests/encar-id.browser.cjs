'use strict';
// Actual application and Chromium. All identity, data and ID lookups are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.ENCAR_ID_ARTIFACT_DIR||'/workspace/work/encar-id-v2145/qa';fs.mkdirSync(OUT,{recursive:true});
const PLATE='12가3456',SECOND='34나5678',CAR='encar-car-1',ENDPOINT='/api/encar-id';
const dialog=p=>p.locator('#snote-encar-id-dialog');
const idText=p=>p.locator('#snote-encar-id-dialog [data-encar-ad-id]').evaluateAll(nodes=>nodes.map(e=>e.textContent||'').join('').trim());
const found=(id='43123456',provider='carnect',plate=PLATE)=>({ok:true,status:'found',plate,id,provider});
async function install(f){
 const p=f.page,state={requests:[],legacy:[],replies:[],held:[],popups:[],windowOpens:[],before:null};
 f.context.on('page',page=>state.popups.push(page));
 await p.route('**/api/encar*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname!==ENDPOINT){state.legacy.push(url.pathname);return route.fulfill({status:410,contentType:'application/json',body:'{"ok":false,"code":"RETIRED"}'});}
  assert.equal(req.method(),'POST');assert.match(req.headers()['content-type'],/^application\/json/);assert.equal(req.headers().authorization,'Bearer '+await p.evaluate(()=>__encarFixtureSession.access_token));
  const body=req.postDataJSON();assert.deepEqual(Object.keys(body),['plate'],'The new lookup must not send old IDs, customer data, price or arbitrary URLs');assert.equal(body.plate,PLATE);state.requests.push(body);
  const reply=state.replies.shift();assert(reply,'Every ID request must have an explicit synthetic response');
  if(reply.hold)await new Promise(resolve=>state.held.push(resolve));
  try{await route.fulfill({status:reply.status||200,contentType:'application/json',body:JSON.stringify(reply.body)});}catch(error){if(!reply.hold)throw error;}
 });
 await p.evaluate(()=>{window.__encarIdOpens=[];window.open=(...args)=>{__encarIdOpens.push(args);return null;};});
 await p.waitForFunction(()=>!!window.SnoteEncarId);await p.locator('#vehicle-encar-check:not([disabled])').waitFor();
 state.before=await p.evaluate(()=>JSON.stringify(cars));return state;
}
async function clean(f,state){
 const p=f.page;assert.deepEqual(state.legacy,[],'The old lookup, auto-price and OCR endpoints must never be reached');assert.equal(state.popups.length,0,'Looking up an ID must never open another browser page');assert.deepEqual(await p.evaluate(()=>__encarIdOpens),[],'ID lookup must never call window.open');assert.deepEqual(f.navigations,[]);assert.deepEqual(f.autoPriceRequests,[]);assert.deepEqual(f.requests,[]);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'No vehicle dataset may be written by an ID lookup');assert.equal(await p.evaluate(()=>JSON.stringify(cars)),state.before,'Even an existing Encar record and all vehicle values must stay unchanged');
}
async function confirm(p){await dialog(p).getByRole('button',{name:'확인',exact:true}).click();await dialog(p).waitFor({state:'hidden'});}
async function assertID(p,id){
 await dialog(p).waitFor({state:'visible'});await p.locator('#snote-encar-id-dialog [data-encar-ad-id]').filter({hasText:id}).waitFor();
 assert.equal((await p.locator('#snote-encar-id-dialog [data-encar-ad-id]').innerText()).trim(),id);
 assert.equal(await dialog(p).locator('a,iframe,input[type="number"]').count(),0,'The popup must contain no advertisement navigation or price controls');
 const text=await dialog(p).innerText();assert(!/만원|판매예정가|판매가 변경|https?:\/\//.test(text),'Only the ID and confirmation may be displayed');assert.equal(await dialog(p).getByRole('button',{name:'확인',exact:true}).count(),1);
}
async function buy(p){await p.evaluate(async()=>{await closeVehicle({discard:true});navigate('buy');});await p.locator('#list-screen').waitFor({state:'visible'});}
function listButton(p){return p.locator('#list-screen button.snote-list-encar[data-encar-id-car="'+CAR+'"]:visible').first();}
async function run(width){const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;let state;const report={width};
 try{
  state=await install(f);
  // Old saved advertisement hints must neither skip the new lookup nor cause a save.
  await p.evaluate(()=>{cars[0].encarLinks={version:1,plate:'12가3456',verifiedAt:'2026-01-01T00:00:00.000Z',listings:[{id:'42000000',sellerUrl:'https://fem.encar.com/cars/detail/42000000'}]};renderVehicle();});state.before=await p.evaluate(()=>JSON.stringify(cars));
  state.replies.push({body:found()});await p.locator('#vehicle-encar-check').click();await assertID(p,'43123456');await p.screenshot({path:path.join(OUT,'detail-id-'+width+'.png')});await confirm(p);await clean(f,state);report.detailIDOnly=true;
  await buy(p);assert.equal(await p.locator('#list-table th').filter({hasText:/엔카/}).count(),1,'The restored purchase table must have an Encar column, including its existing sort indicator');
  assert.equal(await p.locator('#list-screen button.snote-list-encar[data-encar-id-car="encar-car-2"]:visible').count(),1,'A vehicle without an old saved advertisement must also have an Encar button');
  state.replies.push({body:found('43123457','gloar')});await listButton(p).click();await assertID(p,'43123457');assert.equal(await p.locator('#vehicle-overlay.open').count(),0,'A list lookup must not open or reset a vehicle detail draft');await confirm(p);await clean(f,state);await p.screenshot({path:path.join(OUT,'list-id-'+width+'.png')});report.listRestored=true;
  await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(()=>document.getElementById('list-screen').dataset.vehicleView==='cards');state.replies.push({body:found('43123458','trust')});await listButton(p).click();await assertID(p,'43123458');await confirm(p);await clean(f,state);await p.screenshot({path:path.join(OUT,'cards-id-'+width+'.png')});report.cardsIDOnly=true;
  state.replies.push({body:{ok:false,status:'not_found',code:'NOT_FOUND',error:'광고 ID를 찾지 못했습니다.'}});await listButton(p).click();await dialog(p).waitFor({state:'visible'});await dialog(p).getByRole('button',{name:'확인',exact:true}).waitFor();assert.equal(await idText(p),'');await confirm(p);await clean(f,state);report.notFoundNoSideEffect=true;
  for(const body of[found('<img src=x onerror=alert(1)>'),found('43123459','carnect',SECOND)]){
   state.replies.push({body});await listButton(p).click();await dialog(p).waitFor({state:'visible'});await p.waitForTimeout(100);assert.equal(await idText(p),'','A malformed or wrong-plate response must not display an accepted ID');assert.equal(await dialog(p).locator('img[src="x"]').count(),0);await confirm(p);await clean(f,state);
  }report.responseValidation=true;
  // A second click while busy must not start another upstream sequence.
  const before=state.requests.length;state.replies.push({body:found('43123460'),hold:true});await listButton(p).click();for(let attempt=0;!state.held.length&&attempt<150;attempt++)await p.waitForTimeout(10);assert(state.held.length,'The explicit held ID request must reach the new endpoint');await listButton(p).evaluate(e=>{e.click();e.click();});assert.equal(state.requests.length,before+1,'A pending lookup must not fan out duplicate sequences');
  await p.evaluate(()=>{__encarFixtureState.user={id:'99999999-9999-4999-8999-999999999999'};currentUser={...currentUser,username:'other-synthetic-account'};});state.held.shift()();await p.waitForTimeout(350);assert.equal(await idText(p),'','A response after an account change must not display the former account vehicle result');report.staleAccountBlocked=true;
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(state.popups.length,0);assert.deepEqual(state.legacy,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.requests=state.requests.length;report.pass=true;
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});throw error;}finally{state?.held.splice(0).forEach(resolve=>resolve());await finish(f);}
 console.log('PASS ID-only Encar detail/list/cards',width,'new endpoint only, modal confirm, no navigation/price/save, response and stale-account guards');return report;
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{const reports=[];for(const width of[1440,390])reports.push(await run(width));fs.writeFileSync(path.join(OUT,'browser-results.json'),JSON.stringify({syntheticOnly:true,liveProviderVerified:false,productionReads:0,productionWrites:0,reports},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
