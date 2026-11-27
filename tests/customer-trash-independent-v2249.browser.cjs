'use strict';
// Real customer-list buttons and pinned recycle RPCs; generated records only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {setup,clickConfirm,confirm,clearNotices,state,finish,setTestBrowser}=require('./customer-trash.browser.cjs');
const OUT=process.env.CUSTOMER_DELETE_V2249_ARTIFACT_DIR||'/workspace/work/customer-scanner-v2249/customer-delete';
const BASELINE=process.env.CUSTOMER_DELETE_V2249_BASELINE==='1',results=[];
fs.mkdirSync(OUT,{recursive:true});
async function done(p){await p.waitForFunction(()=>snoteCustomerDeleteRequests.size===0);}
async function snapshot(p){return p.evaluate(()=>({cars:JSON.stringify(cars),media:JSON.stringify(mediaByCar),datasets:JSON.stringify([...__encarFixtureState.queue]),conflict:__encarFixtureState.conflict,revisions:JSON.stringify([...__encarFixtureState.revisions]),storage:JSON.stringify(Object.entries(localStorage))}));}
async function preserve(p,before){assert.deepEqual(await snapshot(p),before,'Deleting only a customer must not change, flush or discard unrelated vehicle/finance state');}
async function isolated(width,mode){
 const f=await setup(width),p=f.page;
 try{
  await p.evaluate(mode=>{const S=__encarFixtureState;window.__datasetWrites=0;const rpc=S.client.rpc.bind(S.client);S.client.rpc=async function(name,args){if(name==='zc_write_dataset'){__datasetWrites++;return{data:null,error:{code:'40001',message:'SYNTHETIC_UNRELATED_DATASET_CONFLICT'}};}return rpc(name,args);};if(mode==='conflict')S.conflict=true;else{S.queue.add('monthly:'+S.user.id);}},mode);
  const before=await snapshot(p);await clickConfirm(f);await confirm(p);await done(p);
  const actual=await state(p);
  if(BASELINE){assert.equal(actual.mutations,0);assert.equal(actual.count,1);assert.equal(actual.entries,0);results.push({width,mode,baselineBlocked:true});}
  else{assert.equal(actual.mutations,1);assert.equal(actual.count,0);assert.equal(actual.entries,1);assert.equal(await p.locator('[data-customer-delete]').count(),0);assert.equal(await p.locator('#snote-customer-count').textContent(),'0명');assert.equal(await p.evaluate(()=>__datasetWrites),0);await preserve(p,before);results.push({width,mode,passed:true});}
  await clearNotices(p);await p.screenshot({path:path.join(OUT,(BASELINE?'baseline-':'')+mode+'-'+width+'.png')});
  // Synthetic unresolved unrelated datasets must not leak into fixture teardown.
  await p.evaluate(()=>{__encarFixtureState.queue.clear();__encarFixtureState.conflict=false;});await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+mode+'-'+width+'.png')}).catch(()=>{});await f.context.close();throw error;}
}
async function queues(width,target,changeActor=false){
 const f=await setup(width,{count:target?1:2}),p=f.page;let arrived,release;const started=new Promise(resolve=>arrived=resolve),held=new Promise(resolve=>release=resolve);
 try{
  await f.context.route('https://recycle-fixture.supabase.co/rest/v1/rpc/snote_customer_save',async route=>{const request=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type'};if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});const args=request.postDataJSON();arrived();await held;const result=await p.evaluate(args=>__encarFixtureState.client.rpc('snote_customer_save',args),args);if(!result.error)await p.evaluate(({args,data})=>{const row=__recycle.rows.get(args.p_car_id);row.payload=structuredClone(args.p_payload);row.updated_at=data.updatedAt;row.restore_generation=data.restoreGeneration;},{args,data:result.data});return route.fulfill({status:result.error?400:200,headers,contentType:'application/json',body:JSON.stringify(result.error||result.data)});});
  await p.evaluate(async target=>{const record=await zc72ReadCar(currentUser.username,target?'encar-car-1':'trash-customer-1');record.name+=' 저장중';window.__heldCustomerSave=zc72Write(record).catch(error=>({error:error.message}));},target);await started;
  await clickConfirm(f);await confirm(p);
  if(target){
   await p.waitForTimeout(150);assert.equal((await state(p)).mutations,0,'The exact target customer save must finish before trash');
   await p.evaluate(changeActor=>{window.__previousActor=currentUser;if(changeActor)currentUser={...currentUser};},changeActor);release();
  }
  await done(p);const actual=await state(p);assert.equal(actual.mutations,changeActor?0:1);assert.equal(actual.count,1);assert.equal(actual.entries,target?0:1);
  release();await p.evaluate(async()=>{await __heldCustomerSave;if(window.__previousActor)currentUser=__previousActor;});
  if(target&&!changeActor){await clearNotices(p);assert.match(await p.locator('#snote-customer-rows').textContent(),/저장중/);await clickConfirm(f);await confirm(p);await done(p);assert.equal((await state(p)).count,0);assert.equal((await state(p)).entries,1);}
  await clearNotices(p);await finish(f);results.push({width,mode:target?changeActor?'target save plus stale actor':'target save serializes':'unrelated customer save remains pending',passed:true});
 }catch(error){release();await f.context.close();throw error;}
}
async function offline(width){
 const f=await setup(width),p=f.page;
 try{await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));await clickConfirm(f);await confirm(p);await done(p);const actual=await state(p);assert.equal(actual.mutations,0);assert.equal(actual.count,1);assert.equal(actual.entries,0);await p.evaluate(()=>delete navigator.onLine);await clearNotices(p);await finish(f);results.push({width,mode:'offline refuses trash and preserves row',passed:true});}catch(error){await f.context.close();throw error;}
}
async function pendingContract(width){
 const f=await setup(width),p=f.page;
 try{
  await p.evaluate(()=>{zc75WriteQueue=new Promise(resolve=>window.__finishContractSave=()=>{const row=__recycle.rows.get('encar-car-1');row.updated_at='2026-11-26T01:02:03.654321Z';row.payload={...row.payload,contractSavedAt:Date.now()};__recycle.customer=structuredClone(row);resolve();});window.__reloadDuringSave=buildCustomerManagement();});
  if(BASELINE)await p.locator('[data-customer-delete="encar-car-1"]').waitFor();else assert.equal(await p.locator('[data-customer-delete="encar-car-1"]').count(),0,'Do not expose stale customer versions before our contract save finishes');
  await p.evaluate(async()=>{__finishContractSave();await __reloadDuringSave;});await p.waitForFunction(()=>!document.querySelector('#snote-customer-count')?.textContent.includes('확인 중'));
  await clickConfirm(f);await confirm(p);await done(p);const actual=await state(p);
  assert.equal(actual.mutations,1);assert.equal(actual.count,BASELINE?1:0);assert.equal(actual.entries,BASELINE?0:1);
  const request=f.rpcRequests.find(x=>x.name==='snote_recycle_trash_customer');assert(request);if(!BASELINE)assert.equal(request.args.p_expected_updated_at,'2026-11-26T01:02:03.654321Z');
  await clearNotices(p);await finish(f);results.push({width,mode:'list opened during own contract save',baselineConflict:BASELINE,passed:true});
 }catch(error){await p.evaluate(()=>window.__finishContractSave?.()).catch(()=>{});await f.context.close();throw error;}
}
async function conflictRefresh(width){
 const f=await setup(width,{count:21}),p=f.page;
 try{
  // Preserve the actual current view without assuming its default sort order.
  await p.locator('[data-customer-view-choice="cards"]').click();await p.locator('#snote-customer-search').fill('합성 고객');await p.locator('#snote-customer-search').press('Escape');await p.locator('#customer-pagination [aria-label="2페이지"]').click();
  const id=await p.locator('[data-customer-delete]').first().getAttribute('data-customer-delete');
  await p.evaluate(()=>{window.__customerSearchNode=document.getElementById('snote-customer-search');window.__customerViewEpoch=snote214CustomerView;});
  await clickConfirm(f,id);await p.evaluate(id=>{const row=__recycle.rows.get(id);row.updated_at='2026-11-26T01:02:03.654321Z';row.restore_generation='33333333-3333-4333-8333-333333333333';row.payload={...row.payload,name:'합성 고객 최신 정보'};},id);await confirm(p);await done(p);
  assert.equal((await state(p)).mutations,1);assert.equal((await state(p)).entries,0);assert.equal((await state(p)).count,21);assert.match(await p.locator('#snote-message-dialog[open] #snote-message-copy').textContent(),/최신.*확인|변경.*다시/);
  assert.equal(await p.locator('#snote-customer-search').inputValue(),'합성 고객');assert.equal(await p.locator('#snote-customer-view').getAttribute('data-customer-view'),'cards');assert.equal(await p.locator('#customer-pagination [aria-current="page"]').textContent(),'2');assert.equal(await p.evaluate(()=>document.getElementById('snote-customer-search')===__customerSearchNode&&snote214CustomerView===__customerViewEpoch),true);
  const button=p.locator('[data-customer-delete="'+id+'"]');assert.equal(await button.getAttribute('data-customer-updated-at'),'2026-11-26T01:02:03.654321Z');assert.equal(await button.getAttribute('data-customer-generation'),'33333333-3333-4333-8333-333333333333');assert.match(await p.locator('#snote-customer-rows').textContent(),/최신 정보/);
  await clearNotices(p);assert.equal((await state(p)).mutations,1,'Refreshing a conflicted row must never retry deletion automatically');await clickConfirm(f,id);await confirm(p);await done(p);assert.equal((await state(p)).mutations,2);assert.equal((await state(p)).entries,1);assert.equal((await state(p)).count,20);assert.equal(await button.count(),0);
  await clearNotices(p);await finish(f);results.push({width,mode:'conflict refresh retains query/view/page and requires fresh explicit confirmation',passed:true});
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-refresh-'+width+'.png')}).catch(()=>{});await f.context.close();throw error;}
}
async function restoredInlineAck(width){
 const f=await setup(width,{count:2}),p=f.page;let arrived,release;const started=new Promise(resolve=>arrived=resolve),held=new Promise(resolve=>release=resolve);
 try{
  await f.context.route('https://recycle-fixture.supabase.co/rest/v1/rpc/snote_recycle_trash_customer',async route=>{const request=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type'};if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});const args=request.postDataJSON();f.rpcRequests.push({name:'snote_recycle_trash_customer',args});const result=await p.evaluate(args=>__encarFixtureState.client.rpc('snote_recycle_trash_customer',args),args);if(args.p_car_id==='encar-car-1'){arrived();await held;}return route.fulfill({status:result.error?400:200,headers,contentType:'application/json',body:JSON.stringify(result.error||result.data)});});
  await p.evaluate(()=>{window.__beforeInlineRestore=structuredClone(__recycle.rows.get('encar-car-1'));window.__inlineCustomerView=snote214CustomerView;});await clickConfirm(f);await confirm(p);await started;
  await p.evaluate(()=>{const row=structuredClone(__beforeInlineRestore);row.updated_at='2026-11-26T01:02:03.654321Z';row.restore_generation='33333333-3333-4333-8333-333333333333';row.payload={...row.payload,name:'인라인 갱신 전 복원 고객'};__recycle.rows.set('encar-car-1',row);__recycle.entries=[];__recycle.rows.get('trash-customer-1').updated_at='2026-11-26T01:02:04.654321Z';});
  await clickConfirm(f,'trash-customer-1');await confirm(p);await p.waitForFunction(()=>!snoteCustomerDeleteRequests.has(JSON.stringify([currentUser.username,'trash-customer-1'])));
  assert.equal(await p.evaluate(()=>snote214CustomerView===__inlineCustomerView),true);assert.match(await p.locator('#snote-customer-rows').textContent(),/인라인 갱신 전 복원 고객/);await clearNotices(p);release();await done(p);
  assert.equal((await state(p)).count,2);assert.equal((await state(p)).entries,0);assert.equal((await state(p)).mutations,2);assert.equal(await p.locator('[data-customer-delete="encar-car-1"]').count(),1);assert.equal(await p.locator('[data-customer-delete="encar-car-1"]').getAttribute('data-customer-generation'),'33333333-3333-4333-8333-333333333333');assert.match(await p.locator('#snote-customer-rows').textContent(),/인라인 갱신 전 복원 고객/);
  await clearNotices(p);await finish(f);results.push({width,mode:'old delete ACK cannot hide a restored customer after another customer conflict refresh',passed:true});
 }catch(error){release();await p.screenshot({path:path.join(OUT,'failure-inline-ack-'+width+'.png')}).catch(()=>{});await f.context.close();throw error;}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setTestBrowser(browser);try{for(const width of [1440,390]){for(const mode of ['conflict','queued-dataset'])await isolated(width,mode);await pendingContract(width);if(!BASELINE){await queues(width,false);await queues(width,true);await queues(width,true,true);await offline(width);await conflictRefresh(width);await restoredInlineAck(width);}}fs.writeFileSync(path.join(OUT,BASELINE?'baseline.json':'results.json'),JSON.stringify({ok:true,syntheticOnly:true,productionRequests:0,productionWrites:0,baseline:BASELINE,results},null,2)+'\n');console.log('PASS customer-only trash '+(BASELINE?'baseline blockage reproduced':'independent from unrelated datasets; exact customer queue and scope/offline protection retained'));}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
