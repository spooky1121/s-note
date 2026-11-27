'use strict';
// Real print handlers; generated company assets and fully intercepted requests.
// Never connects to production, modifies a saved vehicle or uses a customer file.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {setBrowser,finish}=require('./encar/browser-smoke.cjs');
const brand=require('./document-service-brand-v2231.browser.cjs');
const company=require('./company-document-assets.browser.cjs');
const OUT=process.env.DOCUMENT_LOGO_PRINT_ARTIFACT_DIR||'/tmp/snote-document-logo-print-v2248';fs.mkdirSync(OUT,{recursive:true});
const ARTWORK=fs.readFileSync(path.join(__dirname,'../assets/snote-brand.png'));
const KINDS=['quote','contract','receipt'];
const PAPER={quote:'#quote-paper',contract:'#contract-print-pages .contract-print-copy',receipt:'#zc76-receipt-paper'};
const BUTTON={quote:'#quote-overlay [data-document-print]',contract:'#contract-overlay [data-document-print]',receipt:'#zc76-receipt-overlay [data-document-print]'};
const sourceHash=()=>{const hash=crypto.createHash('sha256');for(const file of ['index.html','assets/document-print.css'])hash.update(file).update(fs.readFileSync(path.join(__dirname,'..',file)));return hash.digest('hex');};
const initialHash=sourceHash(),results=[];
async function setup(width){
 const f=await company.setup(width);
 await f.context.route('https://encar-smoke.example/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:'{"ok":true,"requests":[]}'}));
 await f.page.evaluate(()=>{zc75ScheduleContractSave=()=>{};window.print=()=>{window.dispatchEvent(new Event('beforeprint'));__companyAssetTest.prints++;};});
 return f;
}
async function form(p,kind){return p.evaluate(kind=>{const root=document.querySelector(kind==='quote'?'#quote-paper':kind==='contract'?'#contract-paper':'#zc76-receipt-paper');return{fields:[...root.querySelectorAll('input,textarea,select')].map(e=>({id:e.id,value:e.value,checked:e.checked})),cars:JSON.stringify(cars)};},kind);}
async function layout(p,kind){
 await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);
 const value=await p.locator(PAPER[kind]).evaluateAll(papers=>papers.map(paper=>{const r=paper.getBoundingClientRect(),rect=e=>{const q=e.getBoundingClientRect();return{x:q.x-r.x,y:q.y-r.y,width:q.width,height:q.height};};return{width:r.width,height:r.height,brand:rect(paper.querySelector('.snote-document-brand')),critical:[...paper.querySelectorAll('.ct-stamp-image,[data-customer-contract-signature-image],#snote215-receipt-signature-image')].map(rect)};}));
 await p.emulateMedia({media:'screen'});return value;
}
async function printed(f,kind,label){
 const p=f.page,before=await p.evaluate(()=>__companyAssetTest.prints),snapshot=await form(p,kind),started=Date.now();
 await p.locator(BUTTON[kind]).click();
 await p.waitForFunction(n=>__companyAssetTest.prints===n,before+1,{timeout:8000});
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await p.evaluate(()=>__companyAssetTest.prints),before+1,label+' prints exactly once');
 assert.deepEqual(await form(p,kind),snapshot,label+' preserves every input and saved vehicle');
 assert(!f.notifications.some(n=>/문서 로고.*다시/u.test(n.message)),label+' has no blocking logo popup');
 await p.emulateMedia({media:'print'});
 const bad=await p.locator(PAPER[kind]+' img').evaluateAll(images=>images.filter(img=>{for(let e=img;e&&e.tagName!=='BODY';e=e.parentElement){const s=getComputedStyle(e);if(e.hidden||s.display==='none'||s.visibility==='hidden')return false;}return !!img.getAttribute('src')&&(!img.complete||!img.naturalWidth);}));
 assert.equal(bad.length,0,label+' leaves no visible broken print image');await p.emulateMedia({media:'screen'});
 results.push({label,kind,elapsedMs:Date.now()-started,passed:true});
}
async function optionalCases(width){
 const f=await setup(width),p=f.page;let mode='ok',held=[],probe=0;
 await f.context.route('https://encar-smoke.example/assets/snote-brand.png?*',route=>{if(mode==='404')return route.fulfill({status:404,body:'synthetic missing logo'});if(mode==='hold'){held.push(route);return;}return route.fulfill({contentType:'image/png',body:ARTWORK});});
 const refresh=async(wait=true)=>p.evaluate(async({probe,wait})=>{for(const img of document.querySelectorAll('#quote-paper .snote-document-brand img,#contract-paper .snote-document-brand img,#zc76-receipt-paper .snote-document-brand img')){img.style.visibility='hidden';img.src='assets/snote-brand.png?v=2.231&probe='+probe;}window.__optionalLogoRefresh=snote95UpdateDocumentCompany();if(wait)await __optionalLogoRefresh;},{probe:++probe,wait});
 try{
  for(const kind of KINDS){
   mode='ok';await brand.open(p,kind);await printed(f,kind,'normal '+width);const baseline=await layout(p,kind);
   await p.evaluate(()=>{const t=__companyAssetTest;t.errorDownload=null;t.rows=t.rows.filter(r=>r.group_name!=='companyLogo'||r.company_id!==snoteCompanyAssetScope().companyId);snoteInvalidateCompanyAssets('companyLogo');});
   await printed(f,kind,'no company logo '+width);
   if(width===1440){
    await p.evaluate(async kind=>{const row=await __companyAssetTest.picture('companyLogo','#226bd5',undefined,undefined,'failed-'+kind);__companyAssetTest.errorDownload=row.file_path;snoteInvalidateCompanyAssets('companyLogo');},kind);
    await printed(f,kind,'company logo download failure '+width);
    assert.equal(await p.evaluate(()=>snoteCompanyAssetState('companyLogo').status),'error');
   }
   mode='404';await refresh();await printed(f,kind,'official logo HTTP 404 '+width);
   assert.deepEqual(await layout(p,kind),baseline,kind+' failed optional artwork preserves A4, fixed footer, seal and signature positions');
   await p.emulateMedia({media:'print'});const pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:path.join(OUT,kind+'-logo-missing-'+width+'.pdf')});
   assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,kind==='contract'?2:1,kind+' original printed page count');
   await p.screenshot({path:path.join(OUT,kind+'-logo-missing-'+width+'.png')});await p.emulateMedia({media:'screen'});
   if(width===1440){
    mode='hold';await refresh(false);await printed(f,kind,'official logo network never completes '+width);
    mode='ok';await Promise.allSettled(held.splice(0).map(route=>route.fulfill({contentType:'image/png',body:ARTWORK})));
   }
   mode='ok';await refresh();await printed(f,kind,'logo recovers without reopening '+width);
  }
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function criticalCases(){
 const f=await setup(1440),p=f.page;
 async function blocked(kind,label,mutate,restore){
  await brand.open(p,kind);const before=await p.evaluate(()=>__companyAssetTest.prints),snapshot=await form(p,kind);
  await p.evaluate(mutate);await brand.print(p,kind);
  assert.equal(await p.evaluate(()=>__companyAssetTest.prints),before,label+' remains blocked');assert.deepEqual(await form(p,kind),snapshot,label+' retains entered content');
  if(restore)await p.evaluate(restore);results.push({label,kind,passed:true});
 }
 try{
  for(const kind of ['quote','contract'])await blocked(kind,'payment account read failure',()=>{window.__savedPayment=SnotePaymentAccounts;window.SnotePaymentAccounts={...SnotePaymentAccounts,loadDocument:async()=>false};if(snote170ContractPrintResources)snote170ContractPrintResources.accounts=null;},()=>{window.SnotePaymentAccounts=__savedPayment;});
  await blocked('contract','registered stamp download failure',()=>{const t=__companyAssetTest;t.errorDownload=t.rows.find(r=>r.group_name==='companyStamp'&&r.company_id===snoteCompanyAssetScope().companyId).file_path;snoteInvalidateCompanyAssets('companyStamp');},()=>{__companyAssetTest.errorDownload=null;snoteInvalidateCompanyAssets('companyStamp');});
  await blocked('contract','customer contract signature readiness failure',()=>{window.__savedSignature=snote222ContractSignature.ready;snote222ContractSignature.ready=async()=>false;},()=>{snote222ContractSignature.ready=__savedSignature;});
  await blocked('receipt','customer receipt signature readiness failure',()=>{window.__savedReceiptSignature=snote250ReceiptSignature.ready;snote250ReceiptSignature.ready=async()=>false;},()=>{snote250ReceiptSignature.ready=__savedReceiptSignature;});
  await brand.open(p,'contract');
  await p.evaluate(()=>{window.__nativeLogoDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(this.closest('.contract-print-copy')&&this.matches('.snote-document-brand img,.snote-document-logo img'))return Promise.reject(Error('SYNTHETIC_CLONE_LOGO_DECODE'));return __nativeLogoDecode.call(this);};});
  await printed(f,'contract','optional clone-only logo decode failure');
  await p.emulateMedia({media:'print'});const cloneLogos=await p.locator('#contract-print-pages .snote-document-brand img,#contract-print-pages .snote-document-logo img').evaluateAll(images=>images.map(img=>({marked:img.hasAttribute('data-snote-print-logo-unavailable'),visibility:getComputedStyle(img).visibility})));assert(cloneLogos.length>=2&&cloneLogos.every(img=>img.marked&&img.visibility==='hidden'),'Native beforeprint retains exact optional clone failure markers');await p.emulateMedia({media:'screen'});await p.evaluate(()=>{HTMLImageElement.prototype.decode=__nativeLogoDecode;});
  await brand.open(p,'contract');
  const before=await p.evaluate(()=>__companyAssetTest.prints);
  await p.evaluate(()=>{HTMLImageElement.prototype.decode=function(){if(this.closest('.contract-print-copy')&&this.matches('.ct-stamp-image'))return Promise.reject(Error('SYNTHETIC_CLONE_STAMP_DECODE'));return __nativeLogoDecode.call(this);};});
  await brand.print(p,'contract');assert.equal(await p.evaluate(()=>__companyAssetTest.prints),before,'Critical cloned stamp decoding remains strict');await p.evaluate(()=>{HTMLImageElement.prototype.decode=__nativeLogoDecode;});results.push({label:'critical cloned stamp decoding remains strict',passed:true});
  for(const kind of KINDS){
   await brand.open(p,kind);const before=await p.evaluate(()=>__companyAssetTest.prints);
   await p.evaluate(kind=>{window.__savedLogoLoader=snoteLoadDocumentLogo;window.__heldLogoWaiting=false;window.snoteLoadDocumentLogo=async()=>{__heldLogoWaiting=true;return new Promise(resolve=>window.__releaseHeldLogo=()=>resolve(null));};if(kind==='contract'&&snote170ContractPrintResources)snote170ContractPrintResources.logo=null;window.__pendingStalePrint=kind==='quote'?printQuote():kind==='contract'?printContract():zc76PrintReceipt();},kind);
   await p.waitForFunction(()=>__heldLogoWaiting);await p.evaluate(async()=>{const actor=currentUser;currentUser={...actor};__releaseHeldLogo();await __pendingStalePrint;currentUser=actor;window.snoteLoadDocumentLogo=__savedLogoLoader;});
   assert.equal(await p.evaluate(()=>__companyAssetTest.prints),before,kind+' stale actor/context cannot print');results.push({label:kind+' stale actor/context cannot print',passed:true});
  }
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-critical.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function run(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{if(!process.env.DOCUMENT_LOGO_SKIP_BASELINE){for(const width of [1440,390])await brand.normalAndPDF(width);await brand.networkFailures();}for(const width of [1440,390])await optionalCases(width);await criticalCases();assert.equal(sourceHash(),initialHash,'Product source must stay frozen throughout browser QA');fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,productionRequests:0,vehicleWrites:0,productSha256:initialHash,results},null,2)+'\n');console.log('PASS v2.248 optional logos print; required seals/signatures/accounts and stale context remain blocked; immutable fields, A4 and page counts preserved');}
 finally{await browser.close();}
}
if(require.main===module)run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
module.exports={run};
