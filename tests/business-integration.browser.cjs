'use strict';
// Actual index, business bridge/store/models/UI and actual isolated PostgreSQL RPCs.
// Browser authentication, legacy cars transport and every record are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const {createBusinessFixture,COMPANY,OWNER,ID}=require('./vehicle-business-workspace.sql.cjs');
const ARTIFACTS='/workspace/work/business-integration-browser',alias='cld_'+OWNER.replaceAll('-','').slice(0,18);
const SOURCES=['index.html','assets/money.js','assets/business-store.js','assets/business-finance.js','assets/business-workflows.js','assets/vehicle-business.js','supabase/migrations/20261121171218_vehicle_business_workspace.sql'];
const sourceHashes=()=>Object.fromEntries(SOURCES.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
const functions={snote_business_vehicle_read:['p_company','p_owner','p_car_id'],snote_business_vehicle_write:['p_company','p_owner','p_car_id','p_expected_revision','p_request_id','p_command'],snote_business_worklist:['p_company','p_scope','p_page','p_page_size','p_query'],snote_business_preferences:['p_company','p_action','p_expected_revision','p_request_id','p_payload'],snote_business_evidence:['p_company','p_owner','p_car_id','p_action','p_id','p_entry_id','p_meta']};
const car={id:ID,ownerId:alias,model:'합성 통합 업무 차량',plate:'12가3456',year:2026,km:'10,000',moneyUnit:'KRW',buy:30000000,sell:33500000,purchaseAt:'2026-11-01',status:'판매중',costs:{bodywork:1300000,inventoryInterest:0},repairItems:[],customCosts:{},customCostLabels:{},inventoryLoan:0};
async function run(){
 fs.mkdirSync(ARTIFACTS,{recursive:true});const hashes=sourceHashes(),dbf=await createBusinessFixture(),db=dbf.db,calls=[];let queue=Promise.resolve(),browser,f;
 const serialized=fn=>{const task=queue.then(fn,fn);queue=task.catch(()=>{});return task;};
 const rpc=(name,args)=>serialized(async()=>{
  const keys=functions[name];assert(keys,'Only business RPCs may reach isolated PostgreSQL');assert.deepEqual(Object.keys(args).sort(),[...keys].sort());
  calls.push({name,args:structuredClone(args)});await dbf.actor(OWNER);
  try{const values=keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);const value=await dbf.scalar('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as value',values);return{data:value,error:null};}
  catch(error){console.error('Isolated business RPC rejected',{name,code:error.code,message:error.message,where:error.where});return{data:null,error:{code:error.code||'SYNTHETIC_SQL_ERROR',message:error.message}};}
 });
 try{
  await db.exec('reset role');await db.query("update public.zc_datasets set payload=$3::jsonb where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER,JSON.stringify([car])]);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});setBrowser(browser);
  // The general smoke harness initially opens its historical named scaffold.
  // The tested vehicle is the actual SQL fixture ID and is opened immediately below.
  f=await fixture(1440,[car,{...car,id:'encar-car-1',model:'합성 기존 화면 scaffold',plate:'34나5678'}]);const p=f.page;p.setDefaultTimeout(12000);
  await p.exposeFunction('__businessPostgresRPC',rpc);
  await p.evaluate(id=>{
   const S=window.__encarFixtureState,previous=S.client.rpc.bind(S.client);S.client.rpc=(name,args)=>name.startsWith('snote_business_')?window.__businessPostgresRPC(name,args):previous(name,args);
   window.__businessSourceEvents=[];addEventListener('snote:business-changed',event=>{if(event.detail?.source)window.__businessSourceEvents.push(event.detail);});
   SnoteBusinessStore.reset();SnoteVehicleBusiness.reset();openVehicle(id);SnoteVehicleBusiness.refresh();
  },ID);
  await p.waitForFunction(()=>SnoteVehicleBusiness.inspect()?.loaded===true);
  assert.equal(await p.evaluate(()=>snoteBusinessBridge.vehicle().carId),ID);
  await p.getByRole('button',{name:'통합 업무 펼치기',exact:true}).click();
  const field=name=>p.locator('#business-entry-form [name="'+name+'"]');
  const fill=async(values)=>{for(const[name,value]of Object.entries(values)){const input=field(name),tag=await input.evaluate(e=>e.tagName);if(typeof value==='boolean')await input.setChecked(value);else if(tag==='SELECT')await input.selectOption(String(value));else await input.fill(String(value));}};
  const save=async(revision)=>{await p.locator('#business-entry-save').click();await p.waitForFunction(rev=>SnoteVehicleBusiness.inspect()?.revision===rev&&!SnoteVehicleBusiness.inspect()?.busy,revision);assert.equal(await p.locator('#business-entry-form').count(),0);assert.equal(await p.locator('#business-message').textContent(),'서버 저장을 확인했습니다.');};
  const add=async(tab,kind,values,revision)=>{await p.locator('[data-business-tab="'+tab+'"]').click();await p.locator('[data-business-add="'+kind+'"]').click();await fill(values);await save(revision);};
  const state=()=>p.evaluate(async()=>{const ref=SnoteBusinessStore.vehicle(),workspace=await SnoteBusinessStore.read(ref,{force:true});return{workspace,summary:SnoteBusinessFinance.summarize(workspace,workspace.carSnapshot,{asOf:'2026-11-21'}),tasks:SnoteBusinessWorkflows.tasks(workspace,workspace.carSnapshot,{}, {includeAllDates:true})};});

  await p.locator('[data-business-start]').click();
  assert.equal((await field('details.purchaseAmountWon').inputValue()).replaceAll(',',''),'30000000');
  assert.equal((await field('details.expectedSaleWon').inputValue()).replaceAll(',',''),'33500000');
  assert.match(await p.locator('.business-legacy').textContent(),/1,300,000원/);
  await fill({'details.costsConfirmed':true});await save(1);
  let result=await state();assert.equal(result.workspace.cycles[0].details.legacyCostsWon,1300000);assert.equal(result.summary.estimatedProfitWon,2200000);assert.equal(result.summary.managementProfitWon,null);
  console.log('PASS native start form imports exact KRW purchase/base costs and the actual SQL ACK yields estimated profit 2,200,000원');

  await add('cash','cash',{'status':'confirmed','details.direction':'in','details.purpose':'sale','amountWon':'1000000','effectiveDate':'2026-11-02','details.notes':'합성 계약금 입금'},2);
  await add('finance','loan',{'status':'active','details.lender':'합성 금융사','amountWon':'20000000','details.annualRate':'0','effectiveDate':'2026-11-01','details.maturityDate':'2026-12-01'},3);
  result=await state();const loan=result.workspace.entries.find(e=>e.kind==='loan');assert(loan);
  await add('finance','loan_event',{'status':'confirmed','details.loanId':loan.id,'details.eventType':'repay','amountWon':'5000000','effectiveDate':'2026-11-05'},4);
  await add('documents','transfer',{'status':'not_sent','details.agency':'합성 이전대행'},5);
  await p.locator('[data-business-tab="trade"]').click();await p.getByRole('button',{name:'거래 내용 수정',exact:true}).click();
  await fill({'status':'closed','details.saleAmountWon':'33500000','details.saleDate':'2026-11-07','details.settlementStatus':'provisional'});await save(6);
  result=await state();assert.equal(result.workspace.cycles[0].status,'closed');assert.equal(result.workspace.currentCycleId,null);assert.equal(result.summary.managementProfitWon,2200000);assert.equal(result.summary.sale.receivedWon,1000000);assert.equal(result.summary.sale.receivableWon,32500000);assert.equal(result.summary.loanTotals.principalOutstandingWon,15000000);assert.equal(result.workspace.entries.find(e=>e.kind==='transfer').status,'not_sent');
  const metrics=await p.locator('.business-summary').textContent();assert.match(metrics,/2,200,000원/);assert.match(metrics,/32,500,000원/);assert.match(metrics,/15,000,000원/);
  console.log('PASS sold/closed trade retains partial cash, 32,500,000원 receivable, 15,000,000원 loan and unfinished transfer independently');

  const list=await p.evaluate(()=>SnoteBusinessStore.list({scope:'mine',force:true}));assert.equal(list.items.length,1);assert.equal(list.items[0].carId,ID);assert.equal(list.items[0].revision,6);assert(calls.some(c=>c.name==='snote_business_worklist'));
  await p.evaluate(()=>SnoteBusinessStore.reset());
  await p.locator('.business-toolbar').getByRole('button',{name:'새로고침',exact:true}).click();await p.waitForFunction(()=>SnoteVehicleBusiness.inspect()?.revision===6&&!SnoteVehicleBusiness.inspect()?.busy);
  result=await state();assert.equal(result.workspace.revision,6);assert.equal(result.workspace.entries.length,4);assert.equal(result.summary.managementProfitWon,2200000);
  console.log('PASS actual bridge worklist and forced reload return canonical persisted SQL records after memory reset');

  // Old vehicle save animation must not close newer, independently unsaved business input.
  assert.equal(await p.evaluate(()=>SnoteBusinessStore.cached(SnoteBusinessStore.vehicle())?.revision),6);
  await p.locator('#detail-extra').fill('합성 기존 차량 저장');await p.evaluate(()=>window.__encarFixtureWriteMode='hold');await p.locator('#vehicle-header-save').click();
  await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);
  await p.locator('[data-business-tab="cash"]').click();await p.locator('[data-business-add="cost"]').click();
  const draftLabel='기존 저장 ACK 뒤 보존한 비용 <원문>',draftNotes='기존 저장 ACK 뒤에도 보존할 업무 입력';
  await fill({'status':'estimated','details.category':'preparation','details.label':draftLabel,'amountWon':'42000','effectiveDate':'2026-11-21','details.notes':draftNotes});
  await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await p.waitForFunction(()=>!window.__encarFixtureState.saving);
  await p.waitForTimeout(1350);assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');assert.equal(await field('details.notes').inputValue(),'기존 저장 ACK 뒤에도 보존할 업무 입력');assert.equal(await p.evaluate(()=>SnoteVehicleBusiness.isDirty()),true);
  assert((await p.evaluate(()=>window.__businessSourceEvents.length))>=1,'Legacy canonical ACK invalidates memory business sources');
  assert.equal(await p.evaluate(()=>SnoteBusinessStore.cached(SnoteBusinessStore.vehicle())),null,'Legacy ACK invalidates the exact owner cache even while a dirty form remains');
  assert.equal(await field('details.label').inputValue(),draftLabel);assert.equal(await p.locator('#business-entry-save').isDisabled(),true,'A stale draft requires explicit comparison, not a silent save');
  assert.equal((await serialized(async()=>{await dbf.actor(OWNER);return dbf.read();})).revision,6,'An unsaved editor cannot manufacture a DB write');
  const readsBefore=calls.filter(c=>c.name==='snote_business_vehicle_read').length;
  await p.locator('.business-rebase').getByRole('button',{name:'최신 자료 확인',exact:true}).click();
  const resave=p.locator('.business-rebase').getByRole('button',{name:'입력 내용으로 다시 저장',exact:true});await resave.waitFor();
  assert(calls.filter(c=>c.name==='snote_business_vehicle_read').length>readsBefore,'The explicit refresh must fetch through the actual SQL RPC');assert.equal(await field('details.label').inputValue(),draftLabel);assert.equal(await field('details.notes').inputValue(),draftNotes);
  await resave.click();await p.waitForFunction(()=>SnoteVehicleBusiness.inspect()?.revision===7&&!SnoteVehicleBusiness.inspect()?.busy);assert.equal(await p.locator('#business-entry-form').count(),0);
  result=await state();const savedCost=result.workspace.entries.find(e=>e.kind==='cost'&&e.details.label===draftLabel);assert(savedCost);assert.equal(savedCost.status,'estimated');assert.equal(savedCost.amountWon,42000);assert.equal(savedCost.details.notes,draftNotes);
  assert.equal(result.workspace.revision,7);assert.equal(result.summary.managementProfitWon,2200000);assert.equal(result.summary.sale.receivableWon,32500000);assert.equal(result.summary.loanTotals.principalOutstandingWon,15000000);assert.equal(await p.evaluate(()=>SnoteVehicleBusiness.isDirty()),false);
  console.log('PASS legacy ACK preserves the dirty cost form; explicit refresh/rebase then actually saves the original label and amount to PostgreSQL');

  // Exercise every non-financial form with optional URLs/IDs/numbers/dates left blank.
  // Together with the four financial forms above this is the real ten-kind UI/SQL contract.
  await add('documents','document',{'status':'missing','details.documentType':'registration','details.label':'합성 등록증 확인'},8);
  await add('customers','task',{'status':'todo','details.title':'합성 다음 업무','details.category':'other'},9);
  await add('customers','lead',{'status':'inquiry','details.name':'합성 상담','details.tradeIn':false},10);
  await add('appraisal','appraisal',{'status':'draft'},11);
  await add('advertising','advertising',{'status':'draft','details.channel':'합성 광고 채널'},12);
  result=await state();const kinds=[...new Set(result.workspace.entries.map(entry=>entry.kind))].sort();
  assert.deepEqual(kinds,['advertising','appraisal','cash','cost','document','lead','loan','loan_event','task','transfer']);assert.equal(result.workspace.entries.length,10);assert.equal(result.workspace.revision,12);
  const sqlCost=result.workspace.entries.find(entry=>entry.kind==='cost');assert.equal(sqlCost.details.evidenceUrl,null);assert.equal(sqlCost.details.evidenceMediaId,null);assert.equal(sqlCost.details.sourceCostKey,null);assert.equal(sqlCost.details.refundOf,null);
  assert.equal(result.workspace.entries.find(entry=>entry.kind==='advertising').details.url,null);assert.equal(result.workspace.entries.find(entry=>entry.kind==='document').details.evidenceUrl,null);
  assert.equal(result.workspace.entries.find(entry=>entry.kind==='task').details.assigneeId,null);assert.equal(result.workspace.entries.find(entry=>entry.kind==='appraisal').details.saleEstimateWon,null);
  console.log('PASS all ten actual UI entry kinds save through PostgreSQL, including blank optional URLs/IDs/dates/money');
  await p.screenshot({path:path.join(ARTIFACTS,'business-actual-sql-1440.png')});
  const writeCalls=calls.filter(c=>c.name==='snote_business_vehicle_write');assert.equal(writeCalls.length,12);assert.equal(new Set(writeCalls.map(c=>c.args.p_request_id)).size,12);assert.deepEqual(sourceHashes(),hashes,'Product files must remain frozen throughout the integrated run');
  fs.writeFileSync(path.join(ARTIFACTS,'receipt.json'),JSON.stringify({syntheticOnly:true,actualLayers:['index','native bridge','business store','finance/workflow models','business UI','PGlite migrations/RPCs'],sourceHashes:hashes,vehicleId:ID,companyId:COMPANY,revision:12,writes:writeCalls.length,kinds,rpcCounts:Object.fromEntries(Object.keys(functions).map(name=>[name,calls.filter(c=>c.name===name).length])),managementProfitWon:2200000,receivableWon:32500000,loanBalanceWon:15000000,unfinishedTransfer:true,dirtyCostRebasedAndSaved:true,costLabel:draftLabel,costAmountWon:42000},null,2)+'\n');
  await finish(f);f=null;fs.rmSync(path.join(ARTIFACTS,'failure.png'),{force:true});console.log('5 actual UI + PostgreSQL integration groups passed');
 }catch(error){if(f){await f.page.screenshot({path:path.join(ARTIFACTS,'failure.png')}).catch(()=>{});console.error('UI state',await f.page.evaluate(()=>({business:window.SnoteVehicleBusiness?.inspect(),message:document.getElementById('business-message')?.textContent,form:document.querySelector('.business-form-error')?.textContent,view:window.snoteBusinessBridge?.vehicle()?.carId})).catch(()=>null));}throw error;}
 finally{if(f)await f.context.close().catch(()=>{});if(browser)await browser.close();await queue;await db.close();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
