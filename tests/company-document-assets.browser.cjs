'use strict';
// Actual app, synthetic company metadata and generated private PNG/JPEG files.
// Every HTTP request is intercepted; no production data, customer image or DB write.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ACTOR='11111111-1111-4111-8111-111111111111',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACTOR='22222222-2222-4222-8222-222222222222',OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGIN='https://synthetic.supabase.co',OUT=process.env.COMPANY_ASSET_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-company-document-assets');
const widths=process.env.COMPANY_ASSET_TEST_WIDTHS?process.env.COMPANY_ASSET_TEST_WIDTHS.split(',').map(Number):[1440,390];
assert(widths.length&&widths.every(w=>[1440,1024,390,320].includes(w)));fs.mkdirSync(OUT,{recursive:true});

async function setup(width){
 const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page,sessionToken=await p.evaluate(()=>__encarFixtureSession.access_token);
 await f.context.route('**/api/vehicle-taxonomy-probe**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'SETUP_REQUIRED'})}));
 // Profile RPCs use the real account bridge but receive only local synthetic replies.
 await f.context.route(ORIGIN+'/rest/v1/rpc/**',async route=>{
  const req=route.request(),name=new URL(req.url()).pathname.split('/').pop(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'POST,OPTIONS'};
  if(name==='snote_payment_accounts_read')return route.fallback();
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(req.method(),'POST');assert.equal(req.headers().authorization,'Bearer '+sessionToken);
  const profile={user_id:ACTOR,company_id:COMPANY,role:'admin',display_name:'합성 이미지 관리자',company_name:'합성 이미지 상사',phone:'01012345678',address:'서울 합성로 1',company_address:'서울 합성로 1',revision:0};
  const value=name==='snote_profile_read'?profile:name==='snote_profile_avatar_read'?{user_id:ACTOR,company_id:COMPANY,avatar_path:null,avatar_revision:0}:null;
  assert(value,'No profile mutation or unrelated RPC is permitted: '+name);
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(value)});
 });
 await p.evaluate(async({actor,company,otherActor,otherCompany})=>{
  const S=window.__encarFixtureState,originalFrom=S.client.from.bind(S.client),nativeRevoke=URL.revokeObjectURL.bind(URL),nativeDecode=HTMLImageElement.prototype.decode;
  const t=window.__companyAssetTest={rows:[],objects:new Map(),reads:[],downloads:[],revoked:[],revokedLive:[],holdDecode:false,decodeWaiting:false,holdDownload:null,downloadWaiting:false,errorDownload:null,prints:0};
  URL.revokeObjectURL=url=>{const refs=[...document.images].filter(img=>img.isConnected&&img.getAttribute('src')===url).map(img=>img.id||img.className);if(refs.length)t.revokedLive.push({url,refs});t.revoked.push(url);return nativeRevoke(url);};
  HTMLImageElement.prototype.decode=async function(){if(t.holdDecode&&!this.isConnected&&this.src.startsWith('blob:')){t.holdDecode=false;t.decodeWaiting=true;await new Promise(resolve=>t.releaseDecode=resolve);t.decodeWaiting=false;}return nativeDecode.call(this);};
  async function picture(kind,color,companyId=company,owner=actor,suffix='a',broken=false){
   const canvas=document.createElement('canvas');canvas.width=kind==='companyStamp'?128:192;canvas.height=kind==='companyStamp'?128:72;const ctx=canvas.getContext('2d');
   if(kind==='companyStamp'){ctx.strokeStyle=color;ctx.lineWidth=8;ctx.strokeRect(10,10,108,108);ctx.fillStyle=color;ctx.font='bold 24px sans-serif';ctx.fillText('TEST',23,72);}
   else{ctx.fillStyle=color;ctx.fillRect(0,0,192,72);ctx.fillStyle='#fff';ctx.font='bold 25px sans-serif';ctx.fillText('SYNTHETIC',13,46);}
   const mime=kind==='companyStamp'?'image/png':'image/jpeg',blob=broken?new Blob(['not an image'],{type:mime}):await new Promise(resolve=>canvas.toBlob(resolve,mime,.9));
   const filePath=companyId+'/'+owner+'/branding/'+kind+'-'+suffix+(mime==='image/png'?'.png':'.jpg');
   const row={id:kind+'-'+suffix,company_id:companyId,owner_id:owner,group_name:kind,file_path:filePath,filename:'synthetic-branding',mime_type:mime,file_size:blob.size,created_at:new Date().toISOString()};
   t.rows=t.rows.filter(r=>r.company_id!==companyId||r.group_name!==kind);t.rows.push(row);t.objects.set(filePath,blob);return row;
  }
  t.picture=picture;await picture('companyStamp','#ce2334');await picture('companyLogo','#226bd5');await picture('companyStamp','#169344',otherCompany,otherActor,'b');await picture('companyLogo','#169344',otherCompany,otherActor,'b');
  S.client.from=table=>{
   if(!['zc_media','zc_companies','zc_members'].includes(table))return originalFrom(table);
   const filters={};let single=false;
   const chain={select(){return chain;},eq(k,v){filters[k]=v;return chain;},in(){return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){single=true;return chain;},single(){single=true;return chain;},then(resolve,reject){
    let rows;
    if(table==='zc_media'){t.reads.push({...filters});rows=t.rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));}
    else if(table==='zc_companies')rows=[S.company];else rows=S.members;
    return Promise.resolve({data:single?(rows[0]||null):structuredClone(rows),error:null}).then(resolve,reject);
   }};return chain;
  };
  S.client.storage={from(bucket){if(bucket!=='zc-vehicle-private')throw Error('Unexpected private bucket');return{async download(filePath){t.downloads.push(filePath);if(t.holdDownload===filePath){t.downloadWaiting=true;await new Promise(resolve=>t.releaseDownload=resolve);t.downloadWaiting=false;}if(t.errorDownload===filePath)return{data:null,error:{code:'SYNTHETIC_DOWNLOAD_FAILED'}};const blob=t.objects.get(filePath);return blob?{data:blob,error:null}:{data:null,error:{code:'404'}};}};}};
  currentUser.role='admin';currentUser.name='합성 이미지 관리자';currentUser.company='합성 이미지 상사';S.members[0].role='admin';S.members[0].display_name=currentUser.name;S.members[0].phone='01012345678';S.company={...S.company,name:currentUser.company,business_number:'1234567890',business_address:'서울 합성로 1',business_address_detail:'',business_phone:'0311234567',representative_name:'합성 대표'};
  window.print=()=>{t.prints++;};snoteInvalidateCompanyAssets('companyStamp');snoteInvalidateCompanyAssets('companyLogo');
 },{actor:ACTOR,company:COMPANY,otherActor:OTHER_ACTOR,otherCompany:OTHER_COMPANY});
 return f;
}
async function imageReady(p,selector){
 await p.waitForFunction(selector=>{const img=document.querySelector(selector);return img&&!img.hidden&&getComputedStyle(img).display!=='none'&&img.complete&&img.naturalWidth>0;},selector);
 const img=p.locator(selector);await img.evaluate(e=>e.decode());return img.getAttribute('src');
}
async function sealInk(p,selector){
 return p.locator(selector).evaluate(img=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let colored=0,transparent=0;for(let i=0;i<data.length;i+=4){if(data[i+3]===0)transparent++;if(data[i+3]>200&&Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>70)colored++;}return{width:canvas.width,height:canvas.height,colored,transparent};});
}
async function contract(p){await p.evaluate(()=>{openVehicle('encar-car-1');openContractPreview({loadCustomer:false});});await p.locator('#contract-overlay.open').waitFor();await imageReady(p,'#ct-seller-stamp');}
async function receipt(p){await p.evaluate(async()=>{if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});closeQuotePreview();openVehicle('encar-car-1');const car=cars.find(car=>car.id==='encar-car-1');await zc76OpenReceipt({ownerId:currentUser.username,carId:car.id,name:'합성 인수 고객',phone:'01012345678',address:'서울 합성로 1',customerSignature:{version:1,strokes:[[[.08,.7],[.18,.2],[.35,.72],[.58,.22],[.85,.65]],[[.15,.85],[.9,.8]]]},customerSignatureSignedAt:'2026-11-17T00:00:00Z'},car);});await p.locator('#zc76-receipt-overlay').waitFor({state:'visible'});}
async function receiptFallback(p){
 await p.evaluate(()=>snote95UpdateDocumentCompany());
 const url=await imageReady(p,'#zc76-receipt-paper .snote-document-brand img');assert.match(new URL(url,p.url()).pathname,/\/assets\/snote-logo\.png$/,'The independent left S-NOTE brand must remain decoded and visible');
 const company=p.locator('#zc76-receipt-paper .zc-footer-emblem');assert.equal(await company.getAttribute('src'),null,'A missing company logo must not reuse the independent S-NOTE brand');assert.equal(await company.evaluate(image=>image.hidden&&getComputedStyle(image).display==='none'),true);
 const frame=p.locator('#zc76-receipt-paper .snote-document-logo');assert.equal(await frame.evaluate(element=>element.classList.contains('is-company-logo')),false);assert.equal(await frame.isVisible(),false,'An unavailable company asset slot must remain hidden');
 assert.equal(await p.locator('#zc76-receipt-paper img').evaluateAll(images=>images.some(img=>!img.hidden&&getComputedStyle(img).display!=='none'&&img.complete&&img.naturalWidth===0)),false,'Receipt fallback must not retain a broken visible image');return url;
}
async function clean(f){assert.deepEqual(await f.page.evaluate(()=>__companyAssetTest.revokedLive),[],'Object URLs must be removed from every connected consumer before revocation');assert.equal(await f.page.evaluate(()=>__encarFixtureWrites.length),0,'Branding refresh and printing must not write vehicle data');await finish(f);}

async function surfaces(width){
 const f=await setup(width),p=f.page;
 try{
  // The real settings preview, profile bridge, quotation and contract share files.
  await p.evaluate(async()=>{await closeVehicle({discard:true});navigate('settings');});
  const settingsStamp=await imageReady(p,'#snote203-stamp-preview img'),settingsLogo=await imageReady(p,'#snote203-logo-preview img');
  assert.match(settingsStamp,/^blob:/);assert.match(settingsLogo,/^blob:/);
  const ink=await sealInk(p,'#snote203-stamp-preview img');assert.equal(ink.width,128);assert.equal(ink.height,128);assert(ink.colored>2000&&ink.transparent>2000,'The generated seal must contain visible colored ink and transparent background');
  await p.locator('#snote203-stamp-preview').evaluate(el=>{const parents=[];for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')parents.push(node);for(const parent of parents.reverse())if(!parent.open)parent.querySelector(':scope > summary').click();});
  await p.locator('.snote203-assets').screenshot({path:path.join(OUT,'settings-'+width+'.png')});
  await p.evaluate(async()=>{await snoteProfileEditor.open();});
  const profileLogo=await imageReady(p,'#snote-profile-company-logo');assert.equal(profileLogo,settingsLogo,'Profile must share the decoded company logo');
  await p.evaluate(()=>snoteProfileEditor.close({force:true,immediate:true}));
  await p.evaluate(()=>{openVehicle('encar-car-1');openQuotePreview();});await p.locator('#quote-overlay.open').waitFor();
  assert.equal(await imageReady(p,'#quote-paper .zc-footer-emblem'),settingsLogo);
  await p.evaluate(()=>closeQuotePreview());await contract(p);
  assert.equal(await imageReady(p,'#contract-paper .zc-footer-emblem'),settingsLogo);assert.equal(await p.locator('#ct-seller-stamp').getAttribute('src'),settingsStamp);
  assert.equal(await p.locator('#ct-buyer-stamp').isVisible(),false);
  assert.equal(await p.locator('#contract-paper [data-customer-contract-signature-image]:not([hidden])').count(),0,'A new blank customer must not receive a signature');
  assert.equal(await p.locator('#ct-buyer-name').inputValue(),'');
  await p.evaluate(()=>setContractMode('purchase'));assert.equal(await imageReady(p,'#ct-buyer-stamp'),settingsStamp);assert.equal(await p.locator('#ct-seller-stamp').isVisible(),false);
  await p.evaluate(()=>setContractMode('sale'));await imageReady(p,'#ct-seller-stamp');
  await p.evaluate(()=>printContract());assert.equal(await p.evaluate(()=>__companyAssetTest.prints),1);
  assert.equal(await p.locator('#contract-print-pages .contract-print-copy').count(),2);assert.equal(await p.locator('#contract-print-pages [id]').count(),0);
  const copies=await p.locator('#contract-print-pages .ct-stamp-image').evaluateAll(images=>images.map(img=>({src:img.getAttribute('src'),active:!img.hidden&&getComputedStyle(img).display!=='none',loaded:img.complete&&img.naturalWidth>0,width:img.naturalWidth,height:img.naturalHeight})));
  assert.equal(copies.filter(img=>img.active&&img.loaded&&img.src===settingsStamp).length,2,'Both A4 copies must contain the registered seal');
  assert(copies.filter(img=>img.active).every(img=>img.width===128&&img.height===128));assert.deepEqual(await sealInk(p,'#ct-seller-stamp'),ink,'The contract must render the registered seal pixels');
  const pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:path.join(OUT,'contract-'+width+'.pdf')}),pdfText=pdf.toString('latin1');assert.equal((pdfText.match(/\/Type\s*\/Page\b/g)||[]).length,2);
  assert.match(pdfText,/\/SMask/,'The generated seal transparency must survive PDF printing');
  assert.match(pdfText,/\/Width 128\s*\/Height 128/,'Both-copy printing must embed the registered seal bitmap');
  await p.screenshot({path:path.join(OUT,'contract-'+width+'.png')});
  await p.locator('#contract-paper .ct-parties').screenshot({path:path.join(OUT,'contract-parties-'+width+'.png')});
  await receipt(p);assert.equal(await imageReady(p,'#zc76-receipt-paper .zc-footer-emblem'),settingsLogo,'Receipt must reuse the same private decoded company logo as settings/profile/quotation/contract');assert.equal(await p.locator('#zc76-receipt-paper .snote95-footer-company').textContent(),'합성 이미지 상사');assert.equal(await p.locator('#zc76-receipt-paper .zc-footer-emblem').getAttribute('data-snote-company-asset'),'companyLogo');
  await p.evaluate(()=>zc76PrintReceipt());assert.equal(await p.evaluate(()=>__companyAssetTest.prints),2);const receiptPDF=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:path.join(OUT,'receipt-'+width+'.pdf')});assert.equal((receiptPDF.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);assert.match(receiptPDF.toString('latin1'),/\/Width 192\s*\/Height 72/,'The receipt PDF must embed the registered private company logo bitmap');await p.screenshot({path:path.join(OUT,'receipt-'+width+'.png')});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await clean(f);console.log('PASS '+width+' shared settings/profile/quote/contract/receipt logo; registered seal; complete A4 PDFs; blank customer remains unsigned');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-surfaces-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function readinessAndReplacement(){
 const f=await setup(1440),p=f.page;
 try{
  await contract(p);const old=await p.locator('#ct-seller-stamp').getAttribute('src');
  await p.evaluate(async()=>{const t=__companyAssetTest;await t.picture('companyStamp','#169344',undefined,undefined,'replacement');t.holdDecode=true;snoteInvalidateCompanyAssets('companyStamp');window.__pendingSealPrint=printContract();});
  await p.waitForFunction(()=>__companyAssetTest.decodeWaiting);
  assert.equal(await p.evaluate(()=>__companyAssetTest.prints),0,'Print must wait for private seal decode');assert.equal(await p.locator('#ct-seller-stamp').isVisible(),false,'The old seal must disappear during replacement');
  assert.equal(await p.locator('img').evaluateAll((images,src)=>images.some(img=>img.getAttribute('src')===src),old),false);
  await p.evaluate(async()=>{__companyAssetTest.releaseDecode();await window.__pendingSealPrint;});
  const replaced=await imageReady(p,'#ct-seller-stamp');assert.notEqual(replaced,old);assert.equal(await p.evaluate(()=>__companyAssetTest.prints),1);
  assert.equal(await p.locator('#contract-print-pages .ct-stamp-image').evaluateAll((images,url)=>images.filter(img=>!img.hidden&&getComputedStyle(img).display!=='none'&&img.src===url).length,replaced),2);
  // A different consumer may discover deletion before the document refreshes.
  await p.evaluate(async()=>{const t=__companyAssetTest;t.rows=t.rows.filter(row=>row.group_name!=='companyStamp'||row.company_id!==snoteCompanyAssetScope().companyId);await snoteLoadDocumentStamp();setContractMode('purchase');setContractMode('sale');});
  assert.equal(await p.locator('#ct-seller-stamp').isVisible(),false);assert.equal(await p.locator('#ct-seller-stamp').getAttribute('src'),null);assert.equal(await p.locator('#ct-buyer-stamp').getAttribute('src'),null,'Changing contract mode must not rebind an already revoked seal');
  await p.evaluate(async()=>{const t=__companyAssetTest;await t.picture('companyStamp','#169344',undefined,undefined,'corrupt',true);snoteInvalidateCompanyAssets('companyStamp');});
  await p.waitForFunction(()=>snoteCompanyAssetState('companyStamp').status==='error');assert.equal(await p.locator('#ct-seller-stamp').isVisible(),false);assert.equal(await p.locator('#ct-seller-stamp').getAttribute('src'),null,'Corrupt content must not leave a broken image');
  await p.evaluate(()=>{const t=__companyAssetTest;t.rows=t.rows.filter(row=>row.group_name!=='companyStamp'||row.company_id!==snoteCompanyAssetScope().companyId);snoteInvalidateCompanyAssets('companyStamp');});
  await p.waitForFunction(()=>snoteCompanyAssetState('companyStamp').status==='missing');assert.equal(await p.locator('#ct-seller-stamp').isVisible(),false);assert.equal(await p.locator('#ct-seller-stamp').getAttribute('src'),null);assert.equal(await p.locator('#ct-seller-name').evaluate(e=>getComputedStyle(e.closest('.ct-stamp-line').querySelector('.stamp-mark')).visibility),'visible');
  await clean(f);console.log('PASS private seal decode gates printing; replacement clears consumers before URL revocation; corrupt/missing assets leave the signature placeholder');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-readiness.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function staleCompany(){
 const f=await setup(1440),p=f.page;
 try{
  const before=await p.evaluate(async()=>{const t=__companyAssetTest,row=t.rows.find(row=>row.group_name==='companyStamp'&&row.company_id===snoteCompanyAssetScope().companyId);t.holdDownload=row.file_path;window.__oldSeal=snoteLoadDocumentStamp();return row.file_path;});
  await p.waitForFunction(()=>__companyAssetTest.downloadWaiting);
  await p.evaluate(({actor,company})=>{const S=__encarFixtureState;S.user={id:actor,email:'other-synthetic@example.invalid'};S.company={id:company,name:'다른 합성 상사'};S.members=[{user_id:actor,company_id:company,active:true,role:'admin',display_name:'다른 합성 관리자'}];currentUser={...currentUser,username:'cld_'+actor.replaceAll('-','').slice(0,18),name:'다른 합성 관리자',company:S.company.name};},{actor:OTHER_ACTOR,company:OTHER_COMPANY});
  const next=await p.evaluate(()=>snoteLoadDocumentStamp());assert.match(next,/^blob:/);
  const late=await p.evaluate(async()=>{__companyAssetTest.releaseDownload();return await window.__oldSeal;});assert.equal(late,null,'Old-company download must be discarded after account change');
  const state=await p.evaluate(()=>snoteCompanyAssetState('companyStamp'));assert.equal(state.companyId,OTHER_COMPANY);assert.equal(state.userId,OTHER_ACTOR);assert.equal(state.url,next);assert.notEqual(state.path,before);
  await clean(f);console.log('PASS account/company switch rejects a late old-company private image while the new company loads normally');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function receiptReadinessAndReplacement(){
 const f=await setup(1440),p=f.page;
 try{
  await receipt(p);const old=await imageReady(p,'#zc76-receipt-paper .zc-footer-emblem');
  await p.evaluate(async()=>{const t=__companyAssetTest;await t.picture('companyLogo','#169344',undefined,undefined,'receipt-replacement');t.holdDecode=true;snoteInvalidateCompanyAssets('companyLogo');window.__pendingReceiptLogoPrint=zc76PrintReceipt();});
  await p.waitForFunction(()=>__companyAssetTest.decodeWaiting);assert.equal(await p.evaluate(()=>__companyAssetTest.prints),0,'Receipt print must await replacement private-logo decode');assert.equal(await p.locator('img').evaluateAll((images,url)=>images.some(img=>img.getAttribute('src')===url),old),false,'Old logo must leave every consumer before URL revocation');
  await p.evaluate(async()=>{__companyAssetTest.releaseDecode();await __pendingReceiptLogoPrint;});const replacement=await imageReady(p,'#zc76-receipt-paper .zc-footer-emblem');assert.notEqual(replacement,old);assert.equal(await p.evaluate(()=>__companyAssetTest.prints),1);
  await p.evaluate(async()=>{const t=__companyAssetTest;t.rows=t.rows.filter(row=>row.group_name!=='companyLogo'||row.company_id!==snoteCompanyAssetScope().companyId);await snoteLoadDocumentLogo();});await receiptFallback(p);assert.equal(await p.locator('#zc76-receipt-paper .snote95-footer-company').textContent(),'합성 이미지 상사');
  await p.evaluate(async()=>{await __companyAssetTest.picture('companyLogo','#226bd5',undefined,undefined,'receipt-corrupt',true);snoteInvalidateCompanyAssets('companyLogo');await snote95UpdateDocumentCompany();});await p.waitForFunction(()=>snoteCompanyAssetState('companyLogo').status==='error');await receiptFallback(p);
  await p.evaluate(async()=>{const row=await __companyAssetTest.picture('companyLogo','#226bd5',undefined,undefined,'receipt-download-failure');__companyAssetTest.errorDownload=row.file_path;snoteInvalidateCompanyAssets('companyLogo');await snote95UpdateDocumentCompany();});await p.waitForFunction(()=>snoteCompanyAssetState('companyLogo').status==='error');await receiptFallback(p);
  await p.screenshot({path:path.join(OUT,'receipt-fallback.png')});await clean(f);console.log('PASS receipt logo decode gates print; replacement/deletion/corrupt/download failure use clean shared fallback without revoking live references');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-receipt-readiness.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function staleReceiptLogo(){
 const f=await setup(1440),p=f.page;
 try{
  await p.evaluate(async()=>{const t=__companyAssetTest,row=await t.picture('companyLogo','#226bd5',undefined,undefined,'receipt-stale');t.holdDownload=row.file_path;snoteInvalidateCompanyAssets('companyLogo');});await receipt(p);await p.waitForFunction(()=>__companyAssetTest.downloadWaiting);await p.evaluate(()=>{window.__staleReceiptPrint=zc76PrintReceipt();});
  await p.evaluate(({actor,company})=>{const S=__encarFixtureState;S.user={id:actor,email:'other-synthetic@example.invalid'};S.company={id:company,name:'다른 합성 상사'};S.members=[{user_id:actor,company_id:company,active:true,role:'admin',display_name:'다른 합성 관리자'}];currentUser={...currentUser,username:'cld_'+actor.replaceAll('-','').slice(0,18),name:'다른 합성 관리자',company:S.company.name};},{actor:OTHER_ACTOR,company:OTHER_COMPANY});await p.evaluate(()=>snote95UpdateDocumentCompany());const current=await imageReady(p,'#zc76-receipt-paper .zc-footer-emblem');assert.match(current,/^blob:/);assert.equal(await p.locator('#zc76-receipt-paper .snote95-footer-company').textContent(),'다른 합성 상사');
  await p.evaluate(async()=>{__companyAssetTest.releaseDownload();await __staleReceiptPrint;});assert.equal(await p.evaluate(()=>__companyAssetTest.prints),0,'An old-company pending receipt must not print after company/account change');assert.equal(await p.locator('#zc76-receipt-paper .zc-footer-emblem').getAttribute('src'),current,'Late old-company logo must not replace the current-company receipt logo');const state=await p.evaluate(()=>snoteCompanyAssetState('companyLogo'));assert.equal(state.companyId,OTHER_COMPANY);assert.equal(state.userId,OTHER_ACTOR);await clean(f);console.log('PASS receipt rejects late old-company logo and aborts printing across company/account changes');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of widths)await surfaces(width);await readinessAndReplacement();await staleCompany();await receiptReadinessAndReplacement();await staleReceiptLogo();}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
