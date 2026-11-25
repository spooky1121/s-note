'use strict';
// Real preview/print paths with virtual accounts, images and network failures only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.DOCUMENT_BRAND_ARTIFACT_DIR||'/workspace/work/document-brand-v2231';fs.mkdirSync(OUT,{recursive:true});
const ARTWORK=fs.readFileSync(path.join(__dirname,'../assets/snote-brand.png'));
const ORIGINALS='#quote-paper .snote-document-brand img,#contract-paper .snote-document-brand img,#zc76-receipt-paper .snote-document-brand img';
const SIGNATURE={version:1,strokes:[[[.08,.7],[.18,.2],[.35,.72],[.58,.22],[.85,.65]],[[.15,.85],[.9,.8]]]};
const results=[];
async function setup(width){
 const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;
 await f.context.route('https://encar-smoke.example/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:'{"ok":true,"requests":[]}'}));
 await p.evaluate(async()=>{
  window.__documentBrandTest={prints:0};window.print=()=>__documentBrandTest.prints++;
  const image=async(color,width,height)=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return URL.createObjectURL(await new Promise(resolve=>c.toBlob(resolve,'image/png')));};
  __documentBrandTest.logo=await image('#226bd5',192,64);__documentBrandTest.stamp=await image('#ce2334',96,96);
  window.snoteLoadDocumentLogo=async()=>__documentBrandTest.logo;window.snoteLoadDocumentStamp=async()=>__documentBrandTest.stamp;
  const S=__encarFixtureState;S.company={...S.company,name:'합성 문서 검증 상사',business_address:'서울특별시 합성구 합성로 123',business_number:'1234567890',business_phone:'021234567'};currentUser.company=S.company.name;
  openVehicle(cars[0].id);
 });return f;
}
async function open(p,kind){await p.evaluate(async({kind,signature})=>{
 if(document.getElementById('quote-overlay').classList.contains('open'))closeQuotePreview();
 if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});
 if(!document.getElementById('zc76-receipt-overlay').hidden)await zc76CloseReceipt({discard:true});
 openVehicle(cars[0].id);const car=cars[0],person={ownerId:currentUser.username,carId:car.id,name:'합성 문서 고객',phone:'01012345678',address:'서울특별시 합성구 합성로 123',customerSignature:signature,customerSignatureSignedAt:'2026-11-17T00:00:00Z',receiptDetails:{children:'none',business:'cash',privacyConsent:true,insuranceConfirmed:true,delegationConfirmed:true,cashConfirmed:true,consentVersion:'receipt-v1'}};
 if(kind==='quote')await openQuotePreview();else if(kind==='receipt')await zc76OpenReceipt(person,car);else{await openContractPreview({loadCustomer:false});document.getElementById('ct-buyer-name').value=person.name;document.getElementById('ct-buyer-phone').value=person.phone;document.getElementById('ct-buyer-address').value=person.address;snote222ContractSignature.set(person);}
 await snote95DocumentLogoReady;
 },{kind,signature:SIGNATURE});}
async function print(p,kind){return p.evaluate(async kind=>{if(kind==='quote')await printQuote();else if(kind==='contract')await printContract();else await zc76PrintReceipt();},kind);}
async function images(p,selector=ORIGINALS){return p.locator(selector).evaluateAll(es=>es.map(e=>({src:e.getAttribute('src'),width:e.naturalWidth,height:e.naturalHeight,complete:e.complete,visibility:getComputedStyle(e).visibility,objectFit:getComputedStyle(e).objectFit})));}
async function normalAndPDF(width){
 const f=await setup(width),p=f.page;try{
  for(const kind of ['quote','contract','receipt']){
   await open(p,kind);const before=await p.evaluate(()=>__documentBrandTest.prints);await print(p,kind);assert.equal(await p.evaluate(()=>__documentBrandTest.prints),before+1,kind+' actual print entry succeeds');
   await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const selector=kind==='quote'?'#quote-paper':kind==='contract'?'#contract-print-pages .contract-print-copy':'#zc76-receipt-paper';
   const metrics=await p.locator(selector).evaluateAll(es=>es.map(paper=>{const r=paper.getBoundingClientRect(),brand=paper.querySelector('.snote-document-brand').getBoundingClientRect();return{paper:{width:r.width,height:r.height},brand:{x:brand.x-r.x,y:brand.y-r.y,width:brand.width,height:brand.height}};}));
   const copies=await images(p,selector+' .snote-document-brand img');assert.equal(copies.length,kind==='contract'?2:1);
   for(const copy of copies){assert(copy.complete&&copy.width===1149&&copy.height===301);assert.equal(copy.visibility,'visible');assert.equal(copy.objectFit,'contain');assert.equal(new URL(copy.src,'https://encar-smoke.example').searchParams.get('v'),'2.231');}
   for(const m of metrics){assert(Math.abs(m.paper.width-210*96/25.4)<1);assert(Math.abs(m.paper.height-297*96/25.4)<1);assert(Math.abs(m.brand.width-18*96/25.4)<.3);assert(Math.abs(m.brand.height-5*96/25.4)<.3);}
   const stem=path.join(OUT,kind+'-'+width),pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:stem+'.pdf'});assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,kind==='contract'?2:1);
   await p.screenshot({path:stem+'-print.png',fullPage:true});
   execFileSync('pdftoppm',['-f','1','-singlefile','-r','150','-png',stem+'.pdf',stem+'-raster'],{stdio:['ignore','ignore','ignore']});
   const ink=JSON.parse(execFileSync('python',['-c',"import json,sys;from PIL import Image;i=Image.open(sys.argv[1]).convert('RGB');m=json.loads(sys.argv[2]);r=i.width/m['paper']['width'];b=m['brand'];c=i.crop((round(b['x']*r),round(b['y']*r),round((b['x']+b['width'])*r),round((b['y']+b['height'])*r)));p=list(c.getdata());print(json.dumps({'blue':sum(a<100 and g>80 and z>140 for a,g,z in p),'dark':sum(a<90 and g<110 and z<135 for a,g,z in p)}))",stem+'-raster.png',JSON.stringify(metrics[0])],{encoding:'utf8'}));
   assert(ink.blue>50&&ink.dark>50,kind+' actual PDF paints the official blue symbol and complete dark wordmark');
   await p.emulateMedia({media:'screen'});results.push({kind,width,pages:copies.length,ink,passed:true});
  }
  await finish(f);console.log('PASS '+width+' actual document previews, decoded print copies, unchanged 18×5mm/A4 and rasterized PDF ink');
 }catch(e){await f.context.close();throw e;}
}
async function networkFailures(){
 const f=await setup(1440),p=f.page;let mode='ok',requests=[];
 await f.context.route('https://encar-smoke.example/assets/snote-brand.png?*',route=>{const u=new URL(route.request().url());requests.push(u.search);if(mode==='fail'||mode==='first'&&!u.searchParams.has('retry'))return route.fulfill({status:503,body:'synthetic unavailable'});return route.fulfill({contentType:'image/png',body:ARTWORK});});
 const invalidate=label=>p.evaluate(({selector,label})=>{for(const image of document.querySelectorAll(selector)){image.style.visibility='hidden';image.src='/assets/snote-brand.png?v=2.231&probe='+label;}}, {selector:ORIGINALS,label});
 try{
  await open(p,'quote');mode='first';requests=[];await invalidate('transient');assert.equal(await p.evaluate(()=>snote95UpdateDocumentCompany()),true);assert(requests.some(q=>q.includes('retry=')),'A failed initial fetch has one cache-bypassing retry');assert((await images(p)).every(i=>i.visibility==='visible'&&i.width===1149));
  results.push({kind:'transient fetch failure recovers',passed:true});
  for(const kind of ['quote','contract','receipt']){
   mode='ok';await open(p,kind);mode='fail';await invalidate(kind);assert.equal(await p.evaluate(()=>snote95UpdateDocumentCompany()),false);
   const before=await p.evaluate(()=>__documentBrandTest.prints);await print(p,kind);assert.equal(await p.evaluate(()=>__documentBrandTest.prints),before,kind+' permanent logo failure blocks native print');
   assert((await images(p)).every(i=>i.visibility==='hidden'),'Broken image icons remain hidden in fixed slots');assert(f.notifications.some(n=>/문서 로고.*다시/u.test(n.message)),kind+' shows retry guidance through the existing popup');
   mode='ok';await print(p,kind);assert.equal(await p.evaluate(()=>__documentBrandTest.prints),before+1,kind+' next print retries and recovers without reopening');
   assert((await images(p)).every(i=>i.visibility==='visible'&&i.complete&&i.width===1149));
   if(kind==='contract')assert((await images(p,'#contract-print-pages .snote-document-brand img')).every(i=>i.visibility==='visible'&&i.width===1149),'Both print clones inherit the recovered ready image');
   results.push({kind:kind+' permanent failure blocks and retry recovers',passed:true});
  }
  // Superseded decodes must neither hide a newer image nor change private artwork.
  const race=await p.evaluate(async()=>{
   const image=document.querySelector('#quote-paper .snote-document-brand img'),company=document.querySelector('#quote-paper .zc-footer-emblem'),companySource=company.src,native=image.decode.bind(image);let version=1,release;
   image.decode=()=>new Promise(r=>release=r);const old=snote231PrepareDocumentBrand(image,()=>version===1,'stale');
   version=2;image.decode=native;image.src='assets/snote-brand.png?v=2.231&probe=newer';const latest=await snote231PrepareDocumentBrand(image,()=>version===2,'newer');release();const stale=await old;
   return{latest,stale,visibility:getComputedStyle(image).visibility,companyUntouched:company.src===companySource};
  });assert.deepEqual(race,{latest:true,stale:false,visibility:'visible',companyUntouched:true});results.push({kind:'late decode cannot overwrite a newer ready image or company asset',passed:true});
  await finish(f);console.log('PASS transient retry, permanent failure blocks all print paths, later recovery, contract clones and stale decode guard');
 }catch(e){await p.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});await f.context.close();throw e;}
}
if(require.main===module)(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of [1440,390])await normalAndPDF(width);await networkFailures();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,productionWrites:0,results},null,2)+'\n');}finally{await browser.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
