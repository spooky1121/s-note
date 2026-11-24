'use strict';
// Real app/operator DOM, event handlers and styles; every HTTP reply and record is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {setup,seedMetrics}=require('./purchase-columns-v2177.browser.cjs');
const {finish}=require('./encar/browser-smoke.cjs');
const {boot:operatorBoot}=require('./operator-console.browser.cjs');
const {setup:officeSetup}=require('./contract-office.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_SEARCH_STATUS_DIR||'/workspace/work/search-status-style-v2224/qa';
fs.mkdirSync(OUT,{recursive:true});
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const menu=p=>p.locator('#snote-status-menu:popover-open');
async function ready(p){await p.waitForFunction(()=>{const host=document.querySelector('#snote-app main.content');return !!window.SnoteSearchFocus&&(!host||!!window.SnoteStatusMenu&&!host.inert&&!host.dataset.routeTransition&&Number(getComputedStyle(host).opacity)===1);});await frames(p);}
async function closed(p){await p.waitForFunction(()=>!window.SnoteSearchFocus.current);await frames(p);if(p.viewportSize().width<=760)await p.waitForFunction(()=>!history.state?.snoteMobilePopup);}
async function unchanged(p,before){assert.deepEqual(await p.evaluate(()=>({cars:JSON.stringify(cars),writes:__encarFixtureWrites.length})),before);}
async function noOverflow(p){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Search/status chrome stays within the viewport');}
async function geometry(p,selector){return p.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});}
function sameGeometry(a,b,label){for(const k of ['x','y','width','height'])assert(Math.abs(a[k]-b[k])<1.25,label+' '+k+': '+JSON.stringify({a,b}));}
async function keepInput(p,selector){await p.locator(selector).evaluate(input=>{window.__searchOriginal={input,parent:input.parentElement,form:input.form,id:input.id,handler:input.oninput};});}
async function originalInput(p,selector){assert.equal(await p.locator(selector).evaluate(input=>{const o=window.__searchOriginal;return input===o.input&&input.parentElement===o.parent&&input.form===o.form&&input.id===o.id&&input.oninput===o.handler;}),true,'The original input, id, parent, form and handler survive focus/close');}
async function focused(p,selector){
 await p.locator(selector).click();await p.waitForFunction(()=>window.SnoteSearchFocus.current?.matches(':popover-open'));await frames(p);
 assert.equal(await p.locator(selector).evaluate(e=>document.activeElement===e),true);
 const chrome=await p.evaluate(()=>{const frame=SnoteSearchFocus.current,s=getComputedStyle(frame,'::backdrop'),r=frame.getBoundingClientRect();return{placeholders:document.querySelectorAll('.snote-search-placeholder').length,backdrop:s.backdropFilter,role:frame.getAttribute('role'),x:r.x,right:r.right,width:r.width};});
 assert.equal(chrome.placeholders,1);assert.equal(chrome.role,'dialog');assert.match(chrome.backdrop,/blur\(4px\)/);assert(chrome.x>=0&&chrome.right<=p.viewportSize().width+.5);await originalInput(p,selector);return chrome;
}
async function dismissSearch(p,method){
 if(method==='close')await p.locator('.snote-search-dismiss').click();
 else if(method==='escape')await p.keyboard.press('Escape');
 else if(method==='outside')await p.mouse.click(3,3);
 else if(method==='blur')await p.evaluate(()=>document.querySelector('#page-title, #operator-signout')?.focus());
 else if(method==='back'){await p.waitForFunction(()=>history.state?.snoteMobilePopup?.depth===1);await p.goBack();}
 await closed(p);
}
async function purchase(browser,width){
 const f=await setup(browser,width),p=f.page;try{
  await seedMetrics(p);await ready(p);await p.evaluate(()=>{document.getElementById('list-query').value='재무 검증';renderCars();SnotePurchaseColumns.refresh();});await frames(p);
  const selector='#list-query';await keepInput(p,selector);const before=await p.evaluate(()=>({cars:JSON.stringify(cars),writes:__encarFixtureWrites.length})),routeBefore=await p.evaluate(()=>route),url=p.url();
  const body=width<=760?'#list-mobile':'#list-table',base=await geometry(p,body);const chrome=await focused(p,selector);sameGeometry(await geometry(p,body),base,'Placeholder preserves actual list geometry');
  await p.screenshot({path:path.join(OUT,'purchase-search-'+width+'.png')});
  const allIds=await p.evaluate(()=>getFiltered('list').map(c=>c.id));
  for(const [query,ids] of [['손실',['metric-a']],['22나2222',['metric-b']],['없는 합성 검색',[]],['재무 검증',allIds]]){
   await p.locator(selector).fill(query);assert.deepEqual(await p.evaluate(()=>getFiltered('list').map(c=>c.id)),ids,'Original list model/plate search remains authoritative');
   assert.equal(await p.locator(body+(width<=760?' [data-registration-car-id]':' tbody tr[data-registration-car-id]')).count(),ids.length);
  }
  await dismissSearch(p,'escape');await originalInput(p,selector);sameGeometry(await geometry(p,body),base,'Close restores list geometry');
  for(const method of ['close','outside',...(width<=760?['back']:[])]){
   await focused(p,selector);await dismissSearch(p,method);await originalInput(p,selector);assert.equal(await p.evaluate(()=>route),routeBefore);assert.equal(p.url(),url);sameGeometry(await geometry(p,body),base,'Reopen/'+method+' leaves list in place');
  }
  await focused(p,selector);await p.evaluate(()=>document.querySelector(innerWidth<=760?'#mobile-menu-trigger':'#snote-purchase-columns-trigger').focus());await closed(p);await originalInput(p,selector);
  await focused(p,selector);await p.keyboard.press('Tab');await closed(p);
  await unchanged(p,before);await noOverflow(p);return{width,chrome,originalDomPreserved:true,liveFilter:true,placeholderGeometry:true,escapeCloseOutsideBlurTab:true,mobileBack:width<=760,syntheticWrites:0};
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-purchase-'+width+'.png'),fullPage:true}).catch(()=>{});throw e;}finally{await finish(f);}
}
async function activeTrigger(p,native){
 const trigger=native.locator('xpath=following-sibling::button[contains(@class,"snote-status-trigger")][1]');await trigger.waitFor({state:'visible'});return trigger;
}
async function pick(p,trigger,name){await trigger.click();await menu(p).waitFor();await menu(p).getByRole('option',{name,exact:true}).click();await frames(p);}
async function stateControls(browser,width){
 const f=await setup(browser,width),p=f.page;try{
  await seedMetrics(p);await p.evaluate(()=>{for(const car of cars)car.customCosts={};renderCars();SnoteStatusMenu.refresh();});await ready(p);
  // Mobile cards intentionally suppress work controls; a hidden select must never grow a visible proxy.
  const hidden=await p.locator('#list-screen select.status-select').evaluateAll(nodes=>nodes.filter(s=>{let n=s;while(n){if(getComputedStyle(n).display==='none'||getComputedStyle(n).visibility==='hidden')return true;n=n.parentElement;}return false;}).map(s=>({hidden:s.nextElementSibling?.hidden,display:s.nextElementSibling&&getComputedStyle(s.nextElementSibling).display})));
  assert(hidden.every(s=>s.hidden&&s.display==='none'),'Hidden card/table status controls keep their proxies hidden');
  let native=p.locator('#list-table [data-registration-car-id="metric-a"] select.status-select');
  if(width<=760){await p.evaluate(()=>openVehicle('metric-a'));native=p.locator('#vehicle-overview select.status-select');}
  const trigger=await activeTrigger(p,native);await native.evaluate(select=>{window.__nativeStatus=select;window.__statusEvents=[];select.addEventListener('change',()=>__statusEvents.push(select.value),true);});
  const before=await p.evaluate(()=>({cars:JSON.stringify(cars),writes:__encarFixtureWrites.length})),old=await native.inputValue();assert.equal(old,'판매중');
  await trigger.click();await menu(p).waitFor();const menuRect=await geometry(p,'#snote-status-menu');assert(menuRect.x>=0&&menuRect.x+menuRect.width<=width+.5);await noOverflow(p);await p.screenshot({path:path.join(OUT,'status-menu-'+width+'.png')});
  await menu(p).getByRole('option',{name:'계약중',exact:true}).click();await p.locator('#status-overlay.open').waitFor();assert.deepEqual(await p.evaluate(()=>__statusEvents),['계약중']);assert.equal(await native.inputValue(),old,'Existing confirmation resets the source value immediately');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await menu(p).count(),0);assert.equal(await p.evaluate(()=>pendingStatusChange.next),'계약중');
  await p.locator('#status-confirm-no').click();await p.locator('#status-overlay.open').waitFor({state:'hidden'});await unchanged(p,before);assert.equal(await native.inputValue(),old);assert.match(await trigger.textContent(),/판매중/);
  // Selecting the unchanged option dispatches nothing. Escape/outside/Back also dispatch nothing.
  await pick(p,trigger,'판매중');assert.deepEqual(await p.evaluate(()=>__statusEvents),['계약중']);assert.equal(await p.locator('#status-overlay.open').count(),0);
  await trigger.focus();await p.keyboard.press('ArrowDown');await menu(p).waitFor();await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');await p.locator('#status-overlay.open').waitFor();assert.deepEqual(await p.evaluate(()=>__statusEvents),['계약중','계약중']);await p.locator('#status-confirm-no').click();
  await pick(p,trigger,'판매완료');await p.locator('#status-overlay.open').waitFor();assert.equal(await p.locator('#confirm-sold-price').inputValue(),'');assert.equal(await native.inputValue(),old);await p.locator('#status-confirm-submit').click();assert.equal(await p.locator('#status-overlay.open').count(),1);await unchanged(p,before);
  await p.locator('#confirm-sold-price').fill('1200000');await p.locator('#confirm-sold-date').fill('2000-01-01');await p.locator('#status-confirm-submit').click();assert.equal(await p.locator('#status-overlay.open').count(),1);await unchanged(p,before);await p.locator('#status-confirm-no').click();
  const eventCount=await p.evaluate(()=>__statusEvents.length);
  for(const method of ['escape','outside',...(width<=760?['back']:[])]){
   await trigger.click();await menu(p).waitFor();const routeBefore=await p.evaluate(()=>route),url=p.url();
   if(method==='escape')await p.keyboard.press('Escape');else if(method==='outside')await p.mouse.click(3,3);else{await p.waitForFunction(()=>history.state?.snoteMobilePopup?.depth===2);await p.goBack();}
   await menu(p).waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>route),routeBefore);assert.equal(p.url(),url);assert.equal(await p.evaluate(()=>__statusEvents.length),eventCount);
   if(width<=760)assert.equal(await p.locator('#vehicle-overlay.open').count(),1,'Closing a status popover never closes its parent detail');
  }
  // Disabled and readonly displays cannot acquire an enabled replacement control.
  await native.evaluate(s=>s.disabled=true);await p.waitForFunction(()=>__nativeStatus.nextElementSibling.disabled);assert.equal(await trigger.isDisabled(),true);await native.evaluate(s=>s.disabled=false);await p.waitForFunction(()=>!__nativeStatus.nextElementSibling.disabled);
  if(width<=760)await p.evaluate(()=>closeVehicle({discard:true}));
  await p.evaluate(()=>{currentUser={...currentUser,role:'accountant'};renderCars();SnoteStatusMenu.refresh();});await frames(p);assert.equal(await p.locator('#list-screen select.status-select').count(),0);assert.equal(await p.locator('#list-screen .snote-status-trigger:not([hidden])').count(),0,'Accountant readonly status remains text only');
  await unchanged(p,before);await noOverflow(p);return{width,contractDispatchExactlyOne:true,cancelPreservesValue:true,unchangedSelectionNoEvent:true,keyboard:true,soldPriceAndDateValidation:true,dismissNoMutation:true,disabledReadonlyAndHidden:true,syntheticWrites:0};
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-status-'+width+'.png'),fullPage:true}).catch(()=>{});throw e;}finally{await finish(f);}
}
async function dynamic(browser,width){
 const f=await setup(browser,width),p=f.page;try{
  await p.evaluate(()=>{
   cars=[{id:'search-customer-a',ownerId:currentUser.username,model:'합성 검색 차량',plate:'11가1111',status:'판매중',buy:100,sell:200},{id:'search-customer-b',ownerId:currentUser.username,model:'다른 합성 차량',plate:'22나2222',status:'판매중',buy:100,sell:200}];
   window.__searchRecords=cars.map((c,i)=>({id:currentUser.username+':'+c.id,ownerId:currentUser.username,carId:c.id,name:i?'다른 가상고객':'검색 가상고객',phone:i?'01000000002':'01000000001',carModel:c.model,plate:c.plate,updatedAt:10-i}));zc72ReadOwner=async()=>structuredClone(__searchRecords);navigate('users');
  });await p.locator('#snote-customer-search').waitFor();await ready(p);await keepInput(p,'#snote-customer-search');await focused(p,'#snote-customer-search');await p.locator('#snote-customer-search').fill('11가1111');assert.equal(await p.locator('#snote-customer-rows tr').count(),1);assert.match(await p.locator('#snote-customer-rows').textContent(),/검색 가상고객/);await p.screenshot({path:path.join(OUT,'dynamic-customers-'+width+'.png')});await dismissSearch(p,'escape');
  const old=await p.locator('#snote-customer-search').elementHandle();
  await p.evaluate(()=>{
   window.__searchTrash={queries:[],restores:0};const records=[{id:'trash-a',kind:'vehicle',label:'검색 휴지통 항목',description:'11가1111',deletedAt:'2026-11-01T00:00:00Z'},{id:'trash-b',kind:'customer',label:'다른 휴지통 항목',description:'22나2222',deletedAt:'2026-11-01T00:00:00Z'}];
   window.snoteRecycleBinBridge={context:()=>({key:'search-scope',kinds:['vehicle','customer','media']}),current:c=>c.key==='search-scope',async list(c,q){__searchTrash.queries.push(structuredClone(q));const rows=records.filter(r=>!q.query||JSON.stringify(r).includes(q.query));return{items:structuredClone(rows),total:rows.length};},async restore(){__searchTrash.restores++;throw Error('Search cannot restore data');}};navigate('recycle');
  });await p.locator('#snote-recycle-bin [type=search]').waitFor();await p.waitForFunction(()=>document.querySelector('#snote-recycle-bin').getAttribute('aria-busy')==='false');await ready(p);assert.equal(await old.evaluate(e=>e.isConnected),false,'Dynamically replaced search does not retain an active detached input');
  const trash='#snote-recycle-bin input[type=search]';await keepInput(p,trash);await focused(p,trash);await p.locator(trash).fill('11가1111');await p.waitForFunction(()=>__searchTrash.queries.at(-1).query==='11가1111'&&document.querySelector('#snote-recycle-bin').getAttribute('aria-busy')==='false');assert.equal(await p.locator('#snote-recycle-bin .recycle-row').count(),1);await p.screenshot({path:path.join(OUT,'dynamic-trash-'+width+'.png')});await dismissSearch(p,width<=760?'back':'close');assert.equal(await p.evaluate(()=>__searchTrash.restores),0);
  await officeSetup(p);await p.evaluate(()=>{const m=__contractMock;const base=m.records[m.C][0];m.records[m.C]=[{...base,id:'77777777-7777-4777-8777-777777777771',payload:{...base.payload,plate:'11가1111',model:'서류함 검색 합성차량'}},{...base,id:'77777777-7777-4777-8777-777777777772',payload:{...base.payload,plate:'22나2222',model:'서류함 다른 합성차량'}}];navigate('contractArchive');});
  const archive='#contract-office-archive-search';await p.locator(archive).waitFor({state:'visible'});await p.waitForFunction(()=>document.querySelector('.co-archive-count')?.textContent==='2건');await ready(p);await keepInput(p,archive);const base=await geometry(p,'#contract-office-archive-table');await focused(p,archive);sameGeometry(await geometry(p,'#contract-office-archive-table'),base,'Standalone archive input placeholder preserves table geometry');await p.locator(archive).fill('11가1111');assert.equal(await p.locator('#contract-office-archive-rows [data-archive-record-id]').count(),1);assert.match(await p.locator('#contract-office-archive-rows').textContent(),/서류함 검색 합성차량/);await p.screenshot({path:path.join(OUT,'dynamic-archive-'+width+'.png')});await dismissSearch(p,'outside');await originalInput(p,archive);assert.equal(await p.evaluate(()=>__contractMock.saves.length),0);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await noOverflow(p);
  return{width,dynamicCustomerTrashArchive:true,liveFilter:true,detachedSearchClosed:true,archiveGeometry:true,syntheticWrites:0};
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-dynamic-'+width+'.png'),fullPage:true}).catch(()=>{});throw e;}finally{await finish(f);}
}
async function operator(browser,width){
 const f=await operatorBoot(browser,width),p=f.page;try{
  assert.equal(await p.locator('.snote-search-active').count(),0);await f.login();await f.ready();await ready(p);const form='#operator-search-form',selector='#operator-search';await keepInput(p,selector);
  const auth=await p.evaluate(()=>({signins:__operatorAuthMock.signins,signouts:__operatorAuthMock.signouts})),base=await geometry(p,'#operator-table-wrap');await focused(p,selector);sameGeometry(await geometry(p,'#operator-table-wrap'),base,'Operator form placeholder preserves table geometry');
  await p.locator(selector).fill('12가3001');await p.locator(selector).press('Enter');await p.waitForFunction(()=>!SnoteSearchFocus.current&&document.querySelector('#operator-table-wrap').getAttribute('aria-busy')==='false');assert.equal(f.requests.filter(r=>r.action==='vehicles').at(-1).query.query,'12가3001');assert.equal(await p.locator('#operator-table tbody tr').count(),1);assert.match(await p.locator('#operator-table tbody').textContent(),/12가3001/);await originalInput(p,selector);assert.equal(await p.locator(selector).evaluate(e=>e.form===document.querySelector('#operator-search-form')),true);assert.equal(await p.locator(form).count(),1);assert.equal(f.state.mutations.length,0);assert.deepEqual(await p.evaluate(()=>({signins:__operatorAuthMock.signins,signouts:__operatorAuthMock.signouts})),auth);
  await focused(p,selector);await p.screenshot({path:path.join(OUT,'operator-search-'+width+'.png')});await dismissSearch(p,'escape');await noOverflow(p);return{width,originalFormSubmit:true,filteredRows:1,authUntouched:true,mutations:0};
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-operator-'+width+'.png'),fullPage:true}).catch(()=>{});throw e;}finally{await f.finish();}
}
async function statusScreenshot(browser,width){
 const f=await setup(browser,width),p=f.page;try{await seedMetrics(p);await p.evaluate(()=>{for(const car of cars)car.customCosts={};renderCars();SnoteStatusMenu.refresh();});await ready(p);let native=p.locator('#list-table [data-registration-car-id="metric-a"] select.status-select');if(width<=760){await p.evaluate(()=>openVehicle('metric-a'));native=p.locator('#vehicle-overview select.status-select');}await(await activeTrigger(p,native)).click();await menu(p).waitFor();await menu(p).evaluate(async e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));const paint=await menu(p).evaluate(e=>({opacity:getComputedStyle(e).opacity,background:getComputedStyle(e).backgroundColor}));assert.deepEqual(paint,{opacity:'1',background:'rgb(255, 255, 255)'});await p.screenshot({path:path.join(OUT,'status-menu-'+width+'.png')});return{width,...paint};}finally{await finish(f);}
}
module.exports={purchase,stateControls,dynamic,operator,statusScreenshot};
if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  const groups=[['purchase',purchase,[1440,390,360]],['status',stateControls,[1440,390,360]],['dynamic',dynamic,[1440,390]],['operator',operator,[1440,390]]];
  for(const[name,run,widths]of groups.filter(([name])=>!process.env.SNOTE_SEARCH_STATUS_CASE||process.env.SNOTE_SEARCH_STATUS_CASE.split(',').includes(name))){for(const width of process.env.SNOTE_SEARCH_STATUS_WIDTHS?process.env.SNOTE_SEARCH_STATUS_WIDTHS.split(',').map(Number).filter(width=>widths.includes(width)):widths){results.push({name,...await run(browser,width)});console.log('PASS search-status '+name+' '+width);}}
  const files=['index.html','operator.html','assets/mobile-popup-history.js','assets/search-focus.js','assets/search-focus.css','assets/status-menu.js','assets/status-menu.css','tests/search-status-style-v2224.browser.cjs'];
  fs.writeFileSync(path.join(OUT,'results'+(process.env.SNOTE_SEARCH_STATUS_CASE?'-'+process.env.SNOTE_SEARCH_STATUS_CASE:'')+'.json'),JSON.stringify({ok:true,syntheticOnly:true,productionRequests:0,operatingWrites:0,results,sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]))},null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
