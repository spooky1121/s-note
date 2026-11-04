'use strict';
// Actual index + local sample account/IndexedDB only, with synthetic mobile-submission records.
// Every browser request is intercepted: this fixture never reaches Supabase, SMS or a CDN.
// Requires Playwright installed outside this static Pages checkout.
// Run: NODE_PATH=/opt/codex/cua_node/lib/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/customer-contract-signature.browser.cjs
// CONTRACT_SIGNATURE_TEST_ARTIFACT_DIR optionally chooses the local PDF/screenshot directory.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://contract-signature.example';
const ARTIFACTS=process.env.CONTRACT_SIGNATURE_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-customer-contract-signature');
const executablePath=process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const SIGNATURE={version:1,strokes:[[[.08,.70],[.18,.26],[.24,.68],[.40,.30],[.55,.65],[.75,.20],[.92,.56]],[[.14,.85],[.82,.77]]]};
const SECOND_SIGNATURE={version:1,strokes:[[[.05,.18],[.35,.80],[.60,.16],[.90,.78]],[[.18,.52],[.81,.40]]]};
const IMAGE_SELECTOR='[data-customer-contract-signature-image]';
let browser;
fs.mkdirSync(ARTIFACTS,{recursive:true});

async function fixture(width=1440){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),external=[],blocked=[],errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==ORIGIN){external.push(url.href);return route.abort();}
  if(url.pathname==='/api/weather')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,temperature:18.4,code:0,region:'합성 지역',source:'MET Norway'})});
  if(url.pathname==='/'){
   const source=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
   assert(source.includes('\ninitializeAuth();'),'Expose only the real local sample-account initialization promise');
   return route.fulfill({contentType:'text/html;charset=utf-8',body:source.replace('\ninitializeAuth();','\nwindow.__signatureFixtureAuth=initializeAuth();')});
  }
  const relative=url.pathname.slice(1),file=path.resolve(ROOT,relative);
  if((url.pathname.startsWith('/assets/')||url.pathname==='/monthly.html')&&file.startsWith(ROOT+path.sep)&&fs.existsSync(file)){
   const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
   return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  }
  blocked.push(url.pathname);return route.abort();
 });
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__signatureFixtureAuth);await page.evaluate(()=>window.__signatureFixtureAuth);
 await page.waitForFunction(()=>!!window.snote222ContractSignature&&typeof window.snoteCustomerSignatureImage==='function');
 await page.evaluate(async signatures=>{
  const sample=await getAccount('dealer2');if(!sample)throw Error('Existing local sample account is required');await enterWorkspace(sample);
  document.getElementById('zc-cloud-gate').hidden=true;
  cars=[1,2,3].map(number=>({id:'signature-car-'+number,ownerId:currentUser.username,model:'서명 검증 차량 '+number,plate:'000가'+String(number).padStart(4,'0'),year:2026,km:'10,000',color:'흰색',buy:1000,sell:1200,status:'판매중'}));
  localStorage.setItem(carsStoreKey(currentUser.username),JSON.stringify(cars));
  for(const [index,car] of cars.entries()){
   const record={id:currentUser.username+':'+car.id,ownerId:currentUser.username,carId:car.id,name:['모바일 서명 고객','서명 없는 고객','다른 서명 고객'][index],phone:'010-1234-5678',address:'서울시 검증로 1',addressBase:'서울시 검증로 1',mailing:'서울시 검증로 1',carModel:car.model,plate:car.plate,createdAt:Date.now(),updatedAt:Date.now(),intakeSource:{requestId:'synthetic-mobile-'+index,submittedAt:'2026-11-01T00:00:00.000Z'}};
   if(index!==1){record.customerSignature=signatures[index===0?0:1];record.customerSignatureSignedAt='2026-11-01T00:00:00.000Z';}
   await zc72Write(record);
  }
  window.print=()=>{window.__signatureFixturePrints=(window.__signatureFixturePrints||0)+1;};
 },[SIGNATURE,SECOND_SIGNATURE]);
 return {context,page,external,blocked,errors};
}
async function saleContract(page,id='signature-car-1'){
 await page.evaluate(async id=>{openVehicle(id);await openSaleProgress();},id);
 await page.locator('#zc72-sale-modal').waitFor({state:'visible'});
 await page.locator('#zc72-print-button').click();await page.locator('#contract-overlay.open').waitFor();
 await page.evaluate(()=>zc75WriteQueue);
}
async function savedContract(page,id='signature-car-1'){
 await page.evaluate(async id=>{if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});closeSaleProgress();closeVehicle();navigate('users');await zc75OpenSavedContract(id);},id);
 await page.locator('#contract-overlay.open').waitFor();
}
async function images(page,scope='#contract-paper'){
 return page.locator(scope+' '+IMAGE_SELECTOR).evaluateAll(elements=>elements.map(image=>({side:image.dataset.customerContractSignatureImage,src:image.getAttribute('src')||'',active:!image.closest('[hidden]')&&getComputedStyle(image).display!=='none'&&getComputedStyle(image).visibility!=='hidden',width:image.naturalWidth,height:image.naturalHeight})));
}
async function expected(page,signature=SIGNATURE){return page.evaluate(signature=>window.snoteCustomerSignatureImage(signature),signature);}
async function assertShown(page,signature=SIGNATURE){
 const source=await expected(page,signature);
 await page.waitForFunction(({selector,source})=>Array.from(document.querySelectorAll('#contract-paper '+selector)).some(image=>image.getAttribute('src')===source&&!image.closest('[hidden]')&&getComputedStyle(image).display!=='none'&&image.complete&&image.naturalWidth===640),{selector:IMAGE_SELECTOR,source});
 const active=(await images(page)).filter(image=>image.active&&image.src);assert.equal(active.length,1);assert.equal(active[0].side,'buyer');assert.equal(active[0].src,source);assert.equal(active[0].height,240);
 assert.equal(await page.locator('#ct-seller-stamp').evaluate(image=>getComputedStyle(image).display),'block','Company stamp stays on the seller side');
 return source;
}
async function assertHidden(page,{erased=false}={}){
 const snapshot=await images(page);assert.equal(snapshot.filter(image=>image.active&&image.src).length,0,'A stale signature must not remain visible');
 if(erased)assert.equal(snapshot.filter(image=>image.src).length,0,'Closing/resetting must remove signature image bytes from the document');
}
async function finish(f){assert.deepEqual(f.external,[],'No external network may be attempted');assert.deepEqual(f.blocked,[],'No API or unexpected request may be attempted');assert.deepEqual(f.errors,[],'Actual index must produce no uncaught JavaScript errors');await f.context.close();}

(async()=>{
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
  {
   const f=await fixture(),p=f.page;
   await saleContract(p);const first=await assertShown(p);
   assert.equal(await p.locator('#ct-buyer-name').inputValue(),'모바일 서명 고객');
   assert.match(await p.locator('[data-customer-contract-signature-caption]').textContent(),/원제출/);
   await p.evaluate(()=>buildContractPrintPages());
   const copies=await images(p,'#contract-print-pages');assert.equal(copies.filter(image=>image.active&&image.src===first).length,2,'Both customer and dealer print copies must retain the same signature');
   assert.equal(await p.locator('#contract-print-pages [id]').count(),0,'Print copies must not retain duplicate IDs');
   await p.evaluate(()=>printContract());assert.equal(await p.evaluate(()=>window.__signatureFixturePrints),1,'Actual print entry point must reach printing after validation');
   const pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:path.join(ARTIFACTS,'customer-contract-signature.pdf')});
   const pdfText=pdf.toString('latin1');assert.match(pdfText,/^%PDF-/);assert.equal((pdfText.match(/\/Type\s*\/Page\b/g)||[]).length,2,'The original contract print layout must produce exactly two A4 copies');
   assert.match(pdfText,/\/SMask/,'Transparent signature alpha must survive PDF printing');
   assert.match(pdfText,/\/Width 640\s*\/Height 240/,'Printed PDF must embed the trusted canvas signature bitmap');
   await p.screenshot({path:path.join(ARTIFACTS,'customer-contract-signature-desktop.png')});
   console.log('PASS mobile-submission canonical record → actual sales contract buyer signature; unchanged company stamp; both clean-ID print copies and real two-page PDF include signature');

   await p.evaluate(()=>setContractMode('purchase'));await assertHidden(p);assert.equal(await p.locator('#ct-buyer-stamp').evaluate(image=>getComputedStyle(image).display),'block');
   await p.evaluate(()=>setContractMode('sale'));await assertShown(p);
   await p.locator('#ct-buyer-name').fill('다른 고객 이름');await assertHidden(p);await p.evaluate(()=>buildContractPrintPages());assert.equal((await images(p,'#contract-print-pages')).filter(image=>image.active&&image.src).length,0);
   await p.locator('#ct-buyer-name').fill('모바일 서명 고객');await assertShown(p);
   await p.evaluate(()=>closeContractPreview({discard:true}));await assertHidden(p,{erased:true});assert.equal(await p.locator('#contract-print-pages').textContent(),'');
   console.log('PASS purchase mode and edited customer name hide the original signature; return to matching sale customer restores it; close erases preview and print copies');

   await savedContract(p);await assertShown(p);await savedContract(p,'signature-car-2');await assertHidden(p,{erased:true});assert.equal(await p.locator('#ct-buyer-name').inputValue(),'서명 없는 고객');
   await savedContract(p,'signature-car-3');const second=await assertShown(p,SECOND_SIGNATURE);assert.notEqual(first,second);
   await p.evaluate(()=>{openVehicle('signature-car-2');openContractPreview();});await assertHidden(p,{erased:true});assert.equal(await p.locator('#ct-buyer-name').inputValue(),'');
   console.log('PASS customer-management saved contract restores its own signature; switching to unsigned/different customers or a direct empty vehicle contract cannot reuse the previous image');

   await p.evaluate(async()=>{
    await closeContractPreview({discard:true});closeVehicle();navigate('users');await zc75WriteQueue;
    window.__signatureOriginalRead=zc72ReadCar;
    zc72ReadCar=async(...args)=>{const record=await window.__signatureOriginalRead(...args);if(args[1]==='signature-car-1'&&!window.__signatureHeldRead){window.__signatureHeldRead=true;await new Promise(resolve=>window.__signatureReleaseRead=resolve);}return record;};
    window.__signatureOldOpen=zc75OpenSavedContract('signature-car-1');
   });
   await p.waitForFunction(()=>typeof window.__signatureReleaseRead==='function');
   await p.evaluate(()=>zc75OpenSavedContract('signature-car-3'));await assertShown(p,SECOND_SIGNATURE);
   await p.evaluate(async()=>{window.__signatureReleaseRead();await window.__signatureOldOpen;zc72ReadCar=window.__signatureOriginalRead;});await assertShown(p,SECOND_SIGNATURE);
   assert.equal(await p.locator('#ct-buyer-name').inputValue(),'다른 서명 고객');
   console.log('PASS delayed saved-customer response cannot replace a newer customer contract signature');

   await p.evaluate(async()=>{await closeContractPreview({discard:true});openVehicle('signature-car-1');await openSaleProgress();snote196ResetSaleForm();});
   assert.equal(await p.locator('#zc72-name').inputValue(),'');
   await p.locator('#zc72-name').fill('초기화 후 새 고객');await p.locator('#zc72-phone').fill('01099998888');await p.locator('#zc72-address').fill('서울시 새로운 검증로 2');
   await p.locator('#zc72-print-button').click();await p.locator('#contract-overlay.open').waitFor();await assertHidden(p,{erased:true});
   await savedContract(p,'signature-car-1');await assertHidden(p,{erased:true});assert.equal(await p.locator('#ct-buyer-name').inputValue(),'초기화 후 새 고객');
   console.log('PASS manual sales reset followed by a different customer cannot attach the prior mobile customer signature');

   await savedContract(p,'signature-car-3');await assertShown(p,SECOND_SIGNATURE);
   await p.evaluate(async()=>{const sample=await getAccount('demo');await enterWorkspace(sample);});await assertHidden(p,{erased:true});
   assert.equal(await p.locator('#contract-print-pages').textContent(),'');
   await p.evaluate(async()=>{const sample=await getAccount('dealer2');await enterWorkspace(sample);});await savedContract(p,'signature-car-3');await assertShown(p,SECOND_SIGNATURE);
   await p.evaluate(()=>logout());await assertHidden(p,{erased:true});assert.equal(await p.locator('#contract-print-pages').textContent(),'');
   await finish(f);console.log('PASS account-context reset clears signature image data and leaves no external/API requests or JavaScript errors');
  }
  {
   const f=await fixture(390),p=f.page;await saleContract(p);await assertShown(p);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px actual index must not overflow horizontally');
   const image=await p.locator('#contract-paper '+IMAGE_SELECTOR).filter({visible:true}).boundingBox();assert(image&&image.width>0&&image.height>0,'Scaled mobile contract must show the signature');
   await p.screenshot({path:path.join(ARTIFACTS,'customer-contract-signature-390.png')});
   await p.evaluate(()=>closeContractPreview({discard:true}));await assertHidden(p,{erased:true});await finish(f);
   console.log('PASS 390px actual sales contract displays its received signature without horizontal overflow and clears it on close');
  }
  for(const width of[1440,390,320]){
   const f=await fixture(width),p=f.page;
   await p.evaluate(async()=>{openVehicle('signature-car-1');await openSaleProgress();});
   await p.getByRole('button',{name:'인수증 출력',exact:true}).click();await p.locator('#zc76-receipt-overlay').waitFor({state:'visible'});
   const image=p.locator('#snote215-receipt-signature-image');await image.evaluate(image=>image.decode());await p.waitForTimeout(350);
   const alpha=await image.evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,ink=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent++;else ink++;}return{transparent,ink,total:pixels.length/4,corner:pixels[3]};});
   assert.equal(alpha.corner,0);assert(alpha.transparent>alpha.total*.8);assert(alpha.ink>0);
   assert.equal(await image.getAttribute('src'),await expected(p));
   const sign=p.locator('#zc76-receipt-paper .zc76-sign-slot'),slot=await sign.boundingBox(),name=await p.locator('#zc76-sign-name').boundingBox(),box=await image.boundingBox();
   assert(slot&&name&&box);assert(slot.x>=name.x+name.width-1&&slot.x-name.x-name.width<16);assert(Math.abs(box.x-slot.x)<1&&Math.abs(box.y-slot.y)<1,JSON.stringify({width,box,slot,name}));
   assert.equal(await sign.locator('.zc76-sign-placeholder').evaluate(e=>getComputedStyle(e).visibility),'hidden');
   assert.equal(await p.locator('#zc76-receipt-paper #snote215-receipt-signature-caption').count(),0);
   const before=await p.evaluate(()=>window.__signatureFixturePrints||0);await p.evaluate(()=>zc76PrintReceipt());assert.equal(await p.evaluate(()=>window.__signatureFixturePrints),before+1);
   const pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:path.join(ARTIFACTS,'customer-receipt-signature-'+width+'.pdf')});const pdfText=pdf.toString('latin1');assert.equal((pdfText.match(/\/Type\s*\/Page\b/g)||[]).length,1);assert.match(pdfText,/\/SMask/);
   await p.screenshot({path:path.join(ARTIFACTS,'customer-receipt-signature-'+width+'.png')});
   await p.locator('#zc76-sign-name').fill('다른 고객');assert.equal(await image.getAttribute('src'),null);await p.locator('#zc76-sign-name').fill('모바일 서명 고객');await image.evaluate(image=>image.decode());assert.match(await image.getAttribute('src'),/^data:image\/png/);
   await p.locator('#zc76-name').fill('다른 고객');assert.equal(await image.getAttribute('src'),null);await p.locator('#zc76-name').fill('모바일 서명 고객');await image.evaluate(image=>image.decode());
   await p.evaluate(()=>{const image=document.getElementById('snote215-receipt-signature-image');image.decode=()=>new Promise(resolve=>window.__signatureReleaseDecode=resolve);window.__signaturePendingPrint=zc76PrintReceipt();});await p.waitForFunction(()=>typeof window.__signatureReleaseDecode==='function');await p.evaluate(async()=>{await zc76CloseReceipt({discard:true});window.__signatureReleaseDecode();await window.__signaturePendingPrint;});assert.equal(await p.evaluate(()=>window.__signatureFixturePrints),before+1);assert.equal(await image.getAttribute('src'),null);
   await p.evaluate(async()=>{const person=await zc72ReadCar(currentUser.username,'signature-car-2');await zc76OpenReceipt(person,cars.find(c=>c.id==='signature-car-2'));});assert.equal(await image.getAttribute('src'),null);assert.equal(await p.locator('#snote215-receipt-signature').isVisible(),false);
   await finish(f);console.log('PASS '+width+' mobile-origin receipt signature is transparent, inside the name-adjacent slot, retained in a one-page PDF; name edits/unsigned customer clear it and close during decode blocks late print');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
