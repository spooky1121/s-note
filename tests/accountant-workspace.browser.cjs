'use strict';
// Real workspace + canonical company-purchase fixture; every reply is synthetic.
// No production request or real database/customer write is permitted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const {setup:setupCompany}=require('./company-purchase.browser.cjs');
const OUT=process.env.ACCOUNTANT_WORKSPACE_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-accountant-workspace');fs.mkdirSync(OUT,{recursive:true});
const widths=process.env.ACCOUNTANT_WORKSPACE_TEST_WIDTHS?process.env.ACCOUNTANT_WORKSPACE_TEST_WIDTHS.split(',').map(Number):[1440,390,320],includeOffice=process.env.ACCOUNTANT_WORKSPACE_TEST_OFFICE!=='0',results=[],officeGeometry=[];
assert(widths.length&&widths.every(w=>[1440,1024,390,320].includes(w)));
async function setup(p,{hold=false,error=null}={}){
 await setupCompany(p);
 await p.evaluate(({hold,error})=>{
  const S=__encarFixtureState,m=__companyMock,alias=id=>'cld_'+id.replaceAll('-','').slice(0,18),foreign='66666666-6666-4666-8666-666666666666';
  m.completed=[];m.officeCalls=[];m.officeWriteAttempts=[];m.carWriteAttempts=[];m.foreign=foreign;m.aliasF=alias(foreign);S.company={...S.company,name:'가상 업무 상사',representative_name:'가상 대표',business_phone:'02-000-0000',business_address:'예시시 업무로 10',business_address_detail:'가상동 101'};const rpc=S.client.rpc.bind(S.client);
  S.client.rpc=async(name,args)=>{
   if(['snote_transfer_document_list','snote_transfer_document_read'].includes(name)){m.officeCalls.push({name,args:structuredClone(args)});if(args.p_expected_company_id!==S.company.id||!['purchase','sale'].includes(args.p_document_kind))throw Error('Unexpected office company or document kind');return{data:name.endsWith('_list')?[]:null,error:null};}
   if(['snote_transfer_document_save','snote_transfer_contract_save'].includes(name)){m.officeWriteAttempts.push({name,args:structuredClone(args)});throw Error('Workspace browsing must not save a transfer document');}
   if(/^snote_transfer_contract_/.test(name)){m.officeCalls.push({name,args:structuredClone(args)});throw Error('The legacy contract endpoint must not be used for document-kind browsing');}
   if(name==='zc_write_dataset')m.carWriteAttempts.push(structuredClone(args));
   const result=await rpc(name,args);if(name==='snote_company_purchase_rows')m.completed.push(structuredClone(args));return result;
  };
  for(const row of m.data.datasets.filter(row=>row.dataset==='cars'))for(const car of row.payload){car.moneyUnit='KRW';car.buy=10000000;car.sell=12000000;car.costs={performanceInspection:12345};car.purchaseAt=todayLocal();car.inventoryLoan=0;car.inventoryLender='';if(car.status==='판매완료'){car.soldAt=todayLocal();car.soldPrice=11900000;}}
  const row=owner=>m.data.datasets.find(row=>row.dataset==='cars'&&row.ownerId===owner),sold=(id,plate,date)=>({id,model:'완료 '+id,plate,status:'판매완료',year:2026,km:'20,000',buy:10000000,sell:12000000,soldPrice:11900000,soldAt:date,purchaseAt:previous,moneyUnit:'KRW',ownerId:'UNTRUSTED_PAYLOAD_OWNER'});
  const priorMonth=new Date();priorMonth.setDate(1);priorMonth.setMonth(priorMonth.getMonth()-1);const previous=priorMonth.getFullYear()+'-'+String(priorMonth.getMonth()+1).padStart(2,'0')+'-12';
  row(m.I).payload.push(sold('company-sold-inactive','44가4445',todayLocal()));row(m.M).payload.push(sold('company-sold-former','55가5556',previous));
  for(const [owner,id,amount]of[[m.actor,'company-own-1',2000000],[m.D,'company-dealer-0',3000000],[m.I,'company-inactive',4000000],[m.M,'company-moved',5000000]]){const car=row(owner).payload.find(car=>car.id===id);car.inventoryLoan=amount;car.inventoryLender='KB캐피탈';}
  const unknown=row(m.K).payload[0];unknown.inventoryLoan=1000000;unknown.inventoryLender='미등록 금융사';const unassigned=row(m.D).payload.find(car=>car.id==='company-dealer-1');unassigned.inventoryLoan=500000;unassigned.inventoryLender='';
  const duplicate={id:'ledger-matched',dealerId:m.aliasD,model:'동일 차량 장부 중복',plate:'22가2200',loan:3000000,lender:'KB캐피탈',moneyUnit:'KRW'},standalone={id:'ledger-standalone',dealerId:m.aliasM,model:'이전 직원 별도 금융',plate:'77가7777',loan:6000000,lender:'KB캐피탈',moneyUnit:'KRW'};
  S.loading=true;
  for(const data of m.data.datasets.filter(row=>S.members.some(member=>member.user_id===row.ownerId))){localStorage.setItem((data.dataset==='cars'?'s-note-office-v12-cars-':'s-note-office-v12-covers-')+alias(data.ownerId),JSON.stringify(data.payload));S.revisions.set(data.dataset+':'+data.ownerId,data.revision);}
  localStorage.setItem(ZC182_FINANCE_KEY,JSON.stringify([duplicate,standalone].map(SnoteMoney.storeFinance)));
  localStorage.setItem('s-note-office-v12-cars-'+m.aliasF,JSON.stringify([{id:'other-company-cache',ownerId:m.aliasF,model:'다른 상사 캐시 차량',plate:'99가9999',status:'판매중',buy:1,sell:2,moneyUnit:'KRW'}]));
  S.loading=false;S.queue.clear();S.conflict=false;S.members[0].role='accountant';currentUser={...currentUser,role:'accountant'};
  S.members.push({user_id:foreign,company_id:m.F,active:true,role:'dealer',display_name:'타상사 딜러'});dealerAccounts=S.members.map(member=>({username:alias(member.user_id),name:member.display_name,role:member.role}));
  m.hold=hold;m.error=error;loadCarsForUser();snoteResetCompanyPurchase();buildMenus();navigate('buy');
 },{hold,error});
}
async function ready(p){await p.waitForFunction(()=>snoteEnsureCompanyPurchase()===true&&snoteCompanyPurchaseBridge.context()?.canRead===true);}
async function scope(p){return p.evaluate(()=>({context:snoteCompanyPurchaseBridge.context(),ids:getFiltered('list').map(car=>car.id),owners:[...new Set(getFiltered('list').map(car=>car.ownerId))],calls:__companyMock.calls.length}));}
async function documentDefaults(p,kind,width){
 const own=kind==='purchase'?'seller':'buyer',other=kind==='purchase'?'buyer':'seller',value=key=>p.locator('#contract-office-'+key).inputValue();
 for(const [suffix,expected]of[['Name','가상 업무 상사'],['Phone','02-000-0000'],['Address','예시시 업무로 10 가상동 101']])assert.equal(await value(own+suffix),expected,kind+' keeps the company on the correct party');
 assert.equal(await value('cert'+(own==='seller'?'Seller':'Buyer')+'Name'),'가상 업무 상사');
 for(const suffix of ['Name','Phone','Address'])assert.equal(await value(other+suffix),'',kind+' starts the counterparty blank');
 const cert='cert'+(other==='seller'?'Seller':'Buyer')+'Name';assert.equal(await value(cert),'');
 const today=await p.evaluate(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()));for(const key of ['contractDate','copyDate','transferDate','deliveryDate'])assert.equal(await value(key),today);
 assert.equal(await p.locator('#snote-contract-office').getAttribute('data-document-kind'),kind);
 const name=p.locator('#contract-office-'+other+'Name'),toggle=p.locator('#contract-office-buyer-seal-toggle');assert.equal(await toggle.isChecked(),false);assert.equal(await toggle.isDisabled(),true);
 await name.fill('가상 '+(other==='seller'?'양도인':'양수인'));assert.equal(await value(cert),await name.inputValue(),'The top party name must synchronize with its bottom certification name');assert.equal(await toggle.isEnabled(),true);
 await p.locator('.co-name-seal-control .co-buyer-seal-option span').click();assert.equal(await toggle.isChecked(),true);await p.waitForFunction(()=>{const image=document.getElementById('contract-office-buyer-seal-preview');return !image.hidden&&image.complete&&image.naturalWidth===192;});
 const geometry=await name.evaluate(input=>{const field=input.closest('.co-party-name'),row=field.querySelector('.co-name-label-row'),name=row.querySelector('.co-name-label'),control=row.querySelector('.co-name-seal-control'),label=control?.querySelector('.co-buyer-seal-option'),box=label?.querySelector('input'),text=label?.querySelector('span'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,cy:r.y+r.height/2};};return{counterparty:input.name,name:rect(name),control:rect(control),checkbox:rect(box),text:rect(text),nestedLabels:field.querySelectorAll('label label').length,overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.equal(geometry.nestedLabels,0);assert.equal(geometry.overflow,false);assert(geometry.control.x>=geometry.name.right-1,'The seal checkbox stays to the right of the counterparty name label');assert(Math.abs(geometry.name.cy-geometry.control.cy)<=2,'Name label and seal checkbox stay on the same row');assert(geometry.control.x>=0&&geometry.control.right<=width+.5,'The complete name/seal control fits the mobile viewport');assert(geometry.checkbox.width>=12&&geometry.checkbox.width<=16&&geometry.checkbox.height>=12&&geometry.checkbox.height<=16,'The name-seal checkbox keeps its compact native dimensions');assert(geometry.text.width>0&&geometry.text.right<=geometry.control.right+.5);officeGeometry.push({width,kind,...geometry});await name.locator('..').screenshot({path:path.join(OUT,'office-name-seal-row-'+kind+'-'+width+'.png')});await p.screenshot({path:path.join(OUT,'office-name-seal-'+kind+'-'+width+'.png')});
 await p.locator('.co-name-seal-control .co-buyer-seal-option span').click();assert.equal(await toggle.isChecked(),false);await name.fill('');assert.equal(await value(cert),'','Clearing the top party name clears its synchronized bottom name');assert.equal(await toggle.isDisabled(),true);
 await p.locator('#contract-office-history').click();await p.waitForFunction(kind=>__companyMock.officeCalls.some(call=>call.name==='snote_transfer_document_list'&&call.args.p_document_kind===kind),kind);await p.locator('#contract-office-history-close').click();
 assert.equal(await p.evaluate(()=>__companyMock.officeWriteAttempts.length),0);
}
async function office(p,width){
 await p.evaluate(()=>navigate('contractOffice'));await ready(p);await p.locator('#snote-contract-office').waitFor({state:'visible'});assert.equal(await p.locator('#screen-title').textContent(),'업무');
 const landing=p.locator('#contract-office-landing'),tiles=landing.locator('button[data-document-kind]');await landing.waitFor({state:'visible'});
 assert.deepEqual(await tiles.evaluateAll(buttons=>buttons.map(button=>button.dataset.documentKind)),['purchase','sale','presentation','contract']);
 for(const label of ['매입서류','매도서류','제시표','계약서'])assert.equal(await landing.getByRole('button',{name:label,exact:true}).isVisible(),true);
 assert.equal(await p.locator('#contract-office-form').isVisible(),false,'Initial document-work landing must show the four choices before the form');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(await p.evaluate(()=>__companyMock.officeWriteAttempts.length),0);await p.screenshot({path:path.join(OUT,'office-tiles-'+width+'.png')});
 await landing.locator('[data-document-kind="purchase"]').click();await p.locator('#contract-office-workspace-pane').waitFor({state:'visible'});await p.locator('#contract-office-form').waitFor({state:'visible'});
 assert.equal(await landing.isVisible(),false);assert.equal(await p.locator('#contract-office-form [name]').count(),39,'The first tile opens the complete existing purchase-document form');await documentDefaults(p,'purchase',width);
 await p.waitForFunction(()=>[...document.querySelectorAll('#contract-office-vehicle option')].some(option=>option.textContent.includes('이전 직원 매물')));
 const options=await p.locator('#contract-office-vehicle option').allTextContents();for(const text of['내 매물 1','딜러 매물 0','비활성 담당 매물','이전 직원 매물'])assert(options.some(option=>option.includes(text)),'Office vehicle choices must include canonical same-company owner '+text);
 assert(options.every(option=>!option.includes('타회사')&&!option.includes('다른 상사')));assert.equal(await p.evaluate(()=>__companyMock.officeWriteAttempts.length),0);await p.screenshot({path:path.join(OUT,'office-form-'+width+'.png')});
 await p.locator('#contract-office-back').click();await landing.waitFor({state:'visible'});await landing.locator('[data-document-kind="sale"]').click();await p.locator('#contract-office-form').waitFor({state:'visible'});
 assert.equal(await p.locator('.co-form-heading h3').textContent(),'매도서류');assert.equal(await p.locator('#contract-office-form [name]').count(),39);await documentDefaults(p,'sale',width);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert((await p.evaluate(()=>__companyMock.officeCalls)).every(call=>call.name.startsWith('snote_transfer_document_')),'Document browsing must use kind-specific endpoints without falling back to legacy contract APIs');
 await p.screenshot({path:path.join(OUT,'office-sale-'+width+'.png')});
}
async function layoutAndData(width){
 const f=await fixture(width),p=f.page;
 try{
  await setup(p,{hold:true});await p.waitForFunction(()=>__companyMock.held.length===1);
  assert.equal(await p.evaluate(()=>getFiltered('list').length),0);assert.equal(await p.evaluate(()=>financeCarRows().length),0);
  assert.equal(await p.locator('#list-table tbody tr').count(),0,'Cached owner snapshots must remain hidden until the canonical company read succeeds');assert.equal(await p.locator('#list-mobile .acct-mobile-card').count(),0);await p.evaluate(()=>{__companyMock.hold=false;__companyMock.held.shift()();});await ready(p);
  const initial=await scope(p);assert.equal(initial.ids.length,26);assert.equal(initial.context.canCompany,false);assert.equal(initial.context.canRead,true);assert.equal(await p.locator('#accountant-dealer-filter').inputValue(),'all','Entering the accountant scope must discard a stale dealer filter');
  assert(initial.ids.includes('company-inactive')&&initial.ids.includes('company-moved')&&initial.ids.includes('company-own-1'));assert(!initial.ids.includes('other-company-cache'));
  assert.equal(await p.locator('#list-table tbody tr').count(),20);assert.equal(await p.locator('#accountant-bar').isVisible(),true);
  await p.waitForFunction(()=>document.querySelector('#snote-purchase-overview .sales-overview-metric dd')?.textContent==='27대');assert.equal(await p.evaluate(()=>snotePurchaseOverviewBridge.snapshot().cars.length),29,'Purchase history includes every canonical company vehicle, including sold ones');
  const nav=await p.locator('#desktop-nav button').allTextContents();assert.equal(nav[0].trim(),'대시보드');assert.match(await p.locator('#desktop-nav button').first().getAttribute('onclick'),/dashboard/);assert(nav.some(text=>text.trim()==='업무'));assert(nav.every(text=>!text.includes('상사 매입')&&!text.includes('계약서 업무')&&!text.includes('차량 검수 도우미')));
  assert.equal(await p.evaluate(()=>snotePageAllowed('companyBuy')),false);assert.equal(await p.evaluate(()=>snotePageAllowed('dashboard')),true);
  await p.locator('#accountant-dealer-filter').selectOption(await p.evaluate(()=>__companyMock.aliasD));await p.evaluate(()=>handleAccountantDealerFilter());assert.equal(await p.evaluate(()=>getFiltered('list').length),21);
  await p.locator('#list-query').fill('딜러 매물 0');assert.equal(await p.evaluate(()=>getFiltered('list').length),1);await p.locator('#list-query').fill('');await p.locator('#accountant-dealer-filter').selectOption('all');await p.evaluate(()=>handleAccountantDealerFilter());
  const rows=await p.locator('#list-table thead').textContent();assert.match(rows,/담당/);assert.equal(await p.locator('#snote92-buy-manual').isVisible(),false);assert.equal(await p.locator('#list-table .status-select').count(),0);
  await p.evaluate(()=>openVehicle('company-dealer-0'));await p.locator('#vehicle-overlay.open').waitFor();assert.equal(await p.locator('#acct-readonly-panel').isVisible(),true);assert.equal(await p.locator('#vehicle-header-delete').isVisible(),false);
  await p.evaluate(()=>{openAdd();changeVehicleStatus({stopPropagation(){},target:{value:'판매완료'}},'company-dealer-0');snote237DeleteVehicle();});assert.equal(await p.locator('#overlay.open').count(),0);assert.equal(await p.evaluate(()=>pendingStatusChange),null);assert.equal(await p.evaluate(()=>__companyMock.writes.length),0);
  await p.evaluate(()=>closeVehicle({discard:true}));await p.locator('#toast').waitFor({state:'hidden'});
  const foreign=await p.evaluate(()=>{const m=__companyMock;cars.push({id:'foreign-shared-runtime',ownerId:m.aliasM,companyId:m.F,model:'타회사 공유 차량',plate:'88가8888',status:'판매중',inventoryLoan:90000000,inventoryLender:'KB캐피탈',buy:1,sell:2,moneyUnit:'KRW'});renderCars();const car=cars.find(car=>car.id==='foreign-shared-runtime');return{ownerAllowed:snoteCompanyPurchaseBridge.ownerAllowed(car.ownerId),carAllowed:snoteCompanyPurchaseBridge.carAllowed(car),visible:getFiltered('list').some(car=>car.id==='foreign-shared-runtime')};});assert.deepEqual(foreign,{ownerAllowed:true,carAllowed:false,visible:false});
  await p.evaluate(()=>openVehicle('foreign-shared-runtime'));assert.equal(await p.evaluate(()=>activeCarId),null);
  await p.screenshot({path:path.join(OUT,'buy-'+width+'.png')});
  await p.evaluate(()=>{navigate('sell');snote226SetSalesMonth('all');});await ready(p);assert.equal(await p.evaluate(()=>getFiltered('list').length),3);const soldOwners=await p.evaluate(()=>[...new Set(getFiltered('list').map(car=>car.ownerId))]);assert.equal(soldOwners.length,3);
  await p.evaluate(()=>snote226SetSalesMonth(todayLocal().slice(0,7)));assert.equal(await p.evaluate(()=>getFiltered('list').length),2);await p.screenshot({path:path.join(OUT,'sell-'+width+'.png')});
  await p.evaluate(()=>navigate('inventoryFinance'));await ready(p);await p.locator('#inventory-finance-search').waitFor({state:'visible'});
  const finance=await p.evaluate(()=>({ids:financeCarRows().filter(car=>inventoryLoanOf(car)>0).map(car=>car.id),standalone:zc182ActiveStandalone().map(row=>row.id),used:zc182Usage().used('KB캐피탈'),count:zc182Usage().count('KB캐피탈')}));
  assert.deepEqual(finance.ids.sort(),['company-own-1','company-dealer-0','company-dealer-1','company-accountant','company-inactive','company-moved'].sort());assert.deepEqual(finance.standalone,['ledger-standalone']);assert.equal(finance.used,20000000);assert.equal(finance.count,5);
  assert.equal(await p.locator('#inventory-finance-tbody tr').count(),7);assert(!(await p.locator('#inventory-finance-tbody').textContent()).includes('타회사'));assert.match(await p.locator('.fin-total .fin-kpi').nth(1).textContent(),/21,500,000/);
  assert.equal(await p.locator('#inventory-lender-filter option[value="none"]').count(),1);await p.locator('#inventory-lender-filter').selectOption('none');assert.equal(await p.locator('#inventory-finance-tbody tr').count(),2,'Unregistered and blank finance lenders remain visible');await p.locator('#inventory-lender-filter').selectOption('all');
  const search=await p.locator('#inventory-finance-search').evaluate(input=>{const search=input.closest('.search'),r=search.getBoundingClientRect(),parent=search.parentElement.getBoundingClientRect();return{width:r.width,parent:parent.width,height:input.getBoundingClientRect().height};});if(width>760)assert(search.width<=301,'Accountant desktop finance search must be compact');else assert(search.width>=search.parent-2,'Mobile finance search must use the available width');
  await p.locator('#inventory-finance-search').fill('이전 직원');assert.equal(await p.locator('#inventory-finance-tbody tr').count(),2);await p.locator('#inventory-finance-search').fill('');await p.screenshot({path:path.join(OUT,'finance-'+width+'.png')});
  if(includeOffice){await office(p,width);await p.screenshot({path:path.join(OUT,'office-'+width+'.png')});}
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.evaluate(()=>__companyMock.writes.length),0);assert.equal(await p.evaluate(()=>__companyMock.carWriteAttempts.length),0);assert.equal(await p.evaluate(()=>__companyMock.officeWriteAttempts.length),0);
  results.push({width,companyBuyCount:26,companyPurchaseHistory:29,currentMonthPurchases:27,soldCount:3,currentMonthSold:2,loanTotal:21500000,loanRows:7,knownLenderUsage:20000000,unknownOrBlankLenderRows:2,compactSearch:search,office:includeOffice,unrelatedCompanyExcluded:true,noCarWrites:true});
  await finish(f);console.log('PASS '+width+' accountant canonical company lists, filters/paging, finance reconciliation, read-only car actions and '+(includeOffice?'office navigation':'office pending'));
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function failuresAndRoles(){
 const f=await fixture(1440),p=f.page;
 try{
  await setup(p,{error:'42501'});await p.waitForFunction(()=>snoteCompanyPurchaseMessage().includes('관리자')||snoteCompanyPurchaseMessage().includes('권한'));
  assert.equal(await p.evaluate(()=>getFiltered('list').length),0);assert.equal(await p.evaluate(()=>financeCarRows().length),0);await p.evaluate(()=>openVehicle('company-dealer-0'));assert.equal(await p.evaluate(()=>activeCarId),null,'A denied company read must not expose cached car details');
  assert.equal(await p.locator('#list-table tbody tr').count(),0);assert.equal(await p.locator('#list-mobile .acct-mobile-card').count(),0);await p.evaluate(()=>snoteRefreshCompanyPurchase());await ready(p);assert.equal(await p.evaluate(()=>getFiltered('list').length),26);
  for(const role of ['dealer','admin']){
   const result=await p.evaluate(role=>{const S=__encarFixtureState,m=__companyMock;currentUser={...currentUser,role};S.members.find(member=>member.user_id===S.user.id).role=role;loadCarsForUser();buildMenus();navigate('buy');return{ids:getFiltered('list').map(car=>car.id),canRead:snoteCompanyPurchaseBridge.context()?.canRead,canCompany:snoteCompanyPurchaseBridge.context()?.canCompany,office:snotePageAllowed('contractOffice'),company:snotePageAllowed('companyBuy')};},role);
   assert.deepEqual(result.ids,['company-own-1','company-own-2'],'Company cache must not expand the '+role+' personal purchase list');assert.equal(result.canCompany,role==='admin');assert.equal(result.canRead,role==='admin');assert.equal(result.office,false);assert.equal(result.company,role==='admin');
  }
  await p.evaluate(()=>{const S=__encarFixtureState;currentUser={...currentUser,role:'accountant'};S.members.find(member=>member.user_id===S.user.id).role='accountant';loadCarsForUser();buildMenus();navigate('buy');});await ready(p);
  await p.evaluate(()=>{__companyMock.hold=true;snoteRefreshCompanyPurchase();window.__accountantHeldRead=snoteWaitCompanyPurchase().then(()=>({ok:true}),error=>({ok:false,code:error.code}));});await p.waitForFunction(()=>__companyMock.held.length===1);
  const before=await p.evaluate(()=>localStorage.getItem('s-note-office-v12-cars-'+__companyMock.aliasA)),completed=await p.evaluate(()=>__companyMock.completed.length);
  await p.evaluate(()=>{const S=__encarFixtureState,m=__companyMock;S.ready=false;S.company={id:m.F,name:'전환한 다른 상사'};S.members=[{user_id:m.actor,company_id:m.F,active:true,role:'accountant',display_name:'전환한 경리'}];m.hold=false;m.held.shift()();});
  await p.waitForFunction(n=>__companyMock.completed.length>n,completed);assert.equal((await p.evaluate(()=>window.__accountantHeldRead)).ok,false,'A stale company task must finish without publishing success');await p.waitForFunction(()=>getFiltered('list').length===0);assert.equal(await p.locator('#list-table tbody tr').count(),0);const after=await p.evaluate(()=>localStorage.getItem('s-note-office-v12-cars-'+__companyMock.aliasA));assert(after===before||after===null,'A delayed old-company response must not overwrite the new scope cache');
  assert.equal(await p.evaluate(()=>__companyMock.writes.length),0);assert.equal(await p.evaluate(()=>__companyMock.carWriteAttempts.length),0);assert.equal(await p.evaluate(()=>__companyMock.officeWriteAttempts.length),0);await finish(f);console.log('PASS denied canonical read fails closed, dealer/admin own inventory stays isolated, stale accountant/company response cannot publish or write');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-scope.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of widths)await layoutAndData(width);await failuresAndRoles();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,includeOffice,at:new Date().toISOString(),results,officeGeometry},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
