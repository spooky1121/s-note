'use strict';
// Full application UI, synthetic accounts/cars and intercepted storage only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.QUOTE_INSURANCE_ARTIFACT_DIR||'/workspace/work/quote-insurance-v2199/qa-fees';fs.mkdirSync(OUT,{recursive:true});
const WIDTHS=(process.env.QUOTE_INSURANCE_WIDTHS||'1440,390').split(',').map(Number),results=[];
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'index.html'))).digest('hex');
const value=(p,id)=>p.locator('#'+id).inputValue();
async function input(p,id,text){if(id.startsWith('detail-')&&!await p.locator('#'+id).isVisible())await p.locator('#design-vehicle-tab-money').click();await p.locator('#'+id).fill(text);await p.locator('#'+id).dispatchEvent('input');}
async function closeQuote(p){if(await p.locator('#quote-overlay.open').count())await p.evaluate(()=>closeQuotePreview());}
async function seed(p,{unit='KRW',cost=123456,price=12000000}={}){
 await closeQuote(p);await p.evaluate(async({unit,cost,price})=>{
  await closeVehicle({discard:true});const base=cars[0],second=cars[1],raw={...base,moneyUnit:'KRW',sell:price,costs:{...base.costs}};
  if(cost===null)delete raw.costs.performanceInspection;else raw.costs.performanceInspection=cost;
  if(unit==='legacy'){delete raw.moneyUnit;raw.buy=1000;raw.sell=price/10000;}
  cars=normalizedCars([raw,{...second,moneyUnit:'KRW',costs:{...second.costs,performanceInspection:76543}}],currentUser.username);
  window.__encarFixtureCars=cars.map(SnoteMoney.storeCar);openVehicle(cars[0].id);
 },{unit,cost,price});
 await p.locator('#vehicle-overlay.open').waitFor();await p.locator('#detail-performanceInspection').waitFor({state:'attached'});
}
async function quote(p){await p.evaluate(()=>openQuotePreview());await p.locator('#quote-overlay.open').waitFor();await p.waitForFunction(()=>document.querySelector('#quote-overlay [data-snote-payment-row="transfer"]')?.hidden===false);}
async function snapshot(p){return p.evaluate(()=>JSON.stringify({cars,stored:__encarFixtureCars,writes:__encarFixtureWrites}));}
async function totals(p){return p.evaluate(()=>Object.fromEntries(['quote-car-price','quote-acquisition','quote-bond','quote-transfer-subtotal','quote-grand-total','quote-bank-car','quote-bank-transfer'].map(id=>[id,document.getElementById(id).textContent])));}
async function run(width){
 const f=await fixture(width,null,{lookupUnavailable:true,paymentAccountsRegistered:true}),p=f.page;
 try{
  await f.context.route('https://synthetic.supabase.co/rest/v1/rpc/snote_payment_accounts_read',async route=>{
   const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,cache-control,pragma'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   const scope=await p.evaluate(()=>({user_id:__encarFixtureState.user.id,company_id:__encarFixtureState.company.id}));
   return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({...scope,revision:1,accounts:{vehicle:{bank:'합성차대금은행',number:'0000001234567',holder:'합성 담당자'},transfer:{bank:'합성이전비은행',number:'0000007654321',holder:'합성 담당자'}}})});
  });
  for(const item of[{unit:'legacy',cost:12.3456,expected:'123,456'},{unit:'KRW',cost:123456,expected:'123,456'},{unit:'legacy',cost:.0001,expected:'1'},{unit:'KRW',cost:0,expected:'0'},{unit:'KRW',cost:null,expected:'0'}]){
   await seed(p,item);const before=await snapshot(p);await quote(p);assert.equal(await value(p,'quote-insurance'),item.expected);assert.equal(await p.locator('#quote-insurance').getAttribute('aria-label'),'성능보증보험료');assert.equal(await p.locator('#quote-insurance').locator('xpath=ancestor::tr/td[1]').textContent(),'성능보증보험료');assert.equal(await snapshot(p),before,'Opening a quotation never changes vehicle costs or storage');
   results.push({width,case:'insurance auto-fill and unchanged source',unit:item.unit,cost:item.cost,expected:item.expected,passed:true});
  }
  await seed(p);const savedBefore=await snapshot(p);await input(p,'detail-performanceInspection','246810');await quote(p);assert.equal(await value(p,'quote-insurance'),'246,810','Unsaved visible detail cost takes precedence');assert.equal(await snapshot(p),savedBefore);
  await closeQuote(p);await input(p,'detail-performanceInspection','');await quote(p);assert.equal(await value(p,'quote-insurance'),'0','A cleared detail value does not fall back to the saved nonzero cost');
  await closeQuote(p);await input(p,'detail-performanceInspection','0');await quote(p);assert.equal(await value(p,'quote-insurance'),'0');
  results.push({width,case:'unsaved detail, empty and explicit zero take precedence',passed:true});
  await seed(p);const untouched=await snapshot(p);await quote(p);await input(p,'quote-insurance','200000');await input(p,'quote-stamp','10000');await input(p,'quote-platefee','-30000');assert.equal(await value(p,'quote-insurance'),'200,000','Recalculating another fee preserves manual quote insurance');assert.equal(await value(p,'quote-platefee'),'-30,000');
  const amount=12000000,transfer=amount*.07+(amount+700000)/1.1*.12*.10+200000+10000-30000+440000,round=n=>Math.round(n).toLocaleString('ko-KR'),actual=await totals(p);
  assert.equal(actual['quote-transfer-subtotal'],round(transfer));assert.equal(actual['quote-grand-total'],round(amount+transfer));assert.equal(actual['quote-bank-transfer'],round(transfer));assert.equal(actual['quote-bank-car'],round(amount));
  await p.evaluate(()=>{for(let i=0;i<5;i++)updateQuoteTotals();});assert.deepEqual(await totals(p),actual);assert.equal(await snapshot(p),untouched,'Quote-specific edits never change saved car costs');
  await input(p,'quote-platefee','-0');await p.locator('#quote-platefee').press('End');await p.locator('#quote-platefee').pressSequentially('5');assert.equal(await value(p,'quote-platefee'),'-5','Typing through negative zero retains the negative sign');
  await input(p,'quote-platefee','-');assert.equal(await value(p,'quote-platefee'),'-');await input(p,'quote-platefee','−1234');assert.equal(await value(p,'quote-platefee'),'-1,234');
  await input(p,'quote-insurance','123456');await input(p,'quote-stamp','0');await input(p,'quote-platefee','-30000');await p.screenshot({path:path.join(OUT,'quote-adjustment-'+width+'.png')});
  results.push({width,case:'manual quote override, signed input and all three total readouts',passed:true});
  await closeQuote(p);await p.evaluate(async()=>{await closeVehicle({discard:true});openVehicle('encar-car-2');});await quote(p);assert.equal(await value(p,'quote-insurance'),'76,543','Switching vehicles uses that vehicle’s insurance');
  await closeQuote(p);await p.evaluate(async()=>{await closeVehicle({discard:true});openVehicle('encar-car-1');});await quote(p);assert.equal(await value(p,'quote-insurance'),'123,456','A fresh quote resets from the current vehicle rather than the prior manual override');
  results.push({width,case:'vehicle switch and fresh opening do not leak manual fees',passed:true});
  await seed(p);await input(p,'detail-performanceInspection','234567');const beforeWrites=await p.evaluate(()=>__encarFixtureWrites.length);assert.equal(await p.evaluate(()=>saveVehicleCosts({closeAfterSave:false})),true);await p.evaluate(()=>hideVehicleSaveSuccess());
  await p.waitForFunction(()=>__encarFixtureCars.find(c=>c.id==='encar-car-1')?.costs?.performanceInspection===23.4567);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),beforeWrites+1);await quote(p);assert.equal(await value(p,'quote-insurance'),'234,567');
  await closeQuote(p);await p.evaluate(async()=>{await closeVehicle({discard:true});openVehicle('encar-car-1');});assert.equal(await value(p,'detail-performanceInspection'),'234,567');await quote(p);assert.equal(await value(p,'quote-insurance'),'234,567');
  results.push({width,case:'actual saved detail cost retains won precision after reopening',passed:true});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await closeQuote(p);await p.evaluate(()=>closeVehicle({discard:true}));await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function main(){const before=hash(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of WIDTHS)await run(width);assert.equal(hash(),before,'Product source is unchanged during verification');fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({passed:true,syntheticOnly:true,productionRequests:0,operationalDatabaseWrites:0,sourceHash:before,results},null,2)+'\n');for(const r of results)console.log('PASS quote fees '+r.width+' '+r.case);}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
