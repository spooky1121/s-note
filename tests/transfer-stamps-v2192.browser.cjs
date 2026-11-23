'use strict';
// Actual transfer preview and private asset bridge; every image and account is synthetic.
// The shared fixture intercepts every request and forbids public network or database writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const {setup,setKind,qa}=require('./contract-office.browser.cjs');
const OUT=process.env.TRANSFER_STAMPS_ARTIFACT_DIR||'/workspace/work/transfer-fill-v2193/qa-trader';
const widths=(process.env.TRANSFER_STAMPS_TEST_WIDTHS||'1440,390').split(',').map(Number),results=[];
fs.mkdirSync(OUT,{recursive:true});
const input=(p,key)=>p.locator('#contract-office-'+key),image=(p,slot)=>p.locator('#contract-office-page-front [data-seal-slot="'+slot+'"]');
async function close(p){await p.locator('#contract-office-preview-close').click();}
async function matching(p,first,second){await input(p,'dealer1Company').fill(first);await input(p,'dealer2Company').fill(second);}
async function failPreview(p){await p.locator('#contract-office-preview').click();await p.locator('#contract-office-dialog[open]').waitFor();await p.waitForFunction(()=>!document.getElementById('contract-office-preview-status').textContent.includes('준비하고'));assert.equal(await p.locator('#contract-office-print').isDisabled(),true,'An unverified configured private stamp blocks the entire print');assert.equal(await p.evaluate(()=>__transferStampPrints),0);}
async function holdOffice(p){await p.evaluate(()=>{const m=__contractMock;m.officeHoldNext=true;});await p.locator('#contract-office-preview').click();await p.waitForFunction(()=>__contractMock.officeWaiting===true);}
async function releaseOffice(p){await p.evaluate(async()=>{const m=__contractMock;m.releaseOffice();await m.officeFinished;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});}
async function readyAssets(p){await p.evaluate(async()=>{const m=__contractMock;m.officeStampMode='ready';await m.makeStamp(m.C,1);await m.makeOfficeStamp();snoteInvalidateCompanyAssets('companyStamp');snoteInvalidateCompanyAssets('companyOfficeStamp');});}
async function noStaleImage(p,source){assert.equal(await p.locator('#contract-office-dialog [data-seal-slot]').evaluateAll((images,source)=>images.some(img=>img.getAttribute('src')&&(!source||img.dataset.snoteCompanySource===source)),source),false,'A stale private source cannot remain on any transfer image');}
async function registeredInkSupport(p,slot){
 const support=await image(p,slot).evaluate(async target=>{
  const source=new Image();source.src=target.dataset.snoteCompanySource;await source.decode();
  const canvas=()=>{const c=document.createElement('canvas');c.width=target.naturalWidth;c.height=target.naturalHeight;return c;},original=canvas(),rendered=canvas(),before=original.getContext('2d',{willReadFrequently:true}),after=rendered.getContext('2d',{willReadFrequently:true});
  before.imageSmoothingEnabled=true;before.imageSmoothingQuality='high';before.drawImage(source,0,0,original.width,original.height);after.drawImage(target,0,0);
  const a=before.getImageData(0,0,original.width,original.height).data,b=after.getImageData(0,0,rendered.width,rendered.height).data;let invented=0,lostStrongInk=0,strongSourceInk=0;
  for(let i=0;i<a.length;i+=4){if(b[i+3]>0&&a[i+3]===0)invented++;if(a[i+3]>128&&Math.min(a[i],a[i+1],a[i+2])<215){strongSourceInk++;if(b[i+3]===0)lostStrongInk++;}}
  return{width:original.width,height:original.height,invented,lostStrongInk,strongSourceInk};
 });
 assert(support.strongSourceInk>100,'The registered synthetic source contains substantial original strokes');assert.equal(support.invented,0,'Upscaling cannot create ink outside the registered image support');assert.equal(support.lostStrongInk,0,'The rendition retains every strong original source stroke');assert(Math.max(support.width,support.height)>=2048&&Math.max(support.width,support.height)<=4096&&support.width*support.height<=8000000,'The print rendition is high resolution and bounded');return support;
}
async function run(width,kind){
 setKind(kind);const f=await fixture(width),p=f.page;
 try{
  await setup(p);await qa.enterDocument(p);await qa.fill(p);
  await p.evaluate(()=>{
   const m=__contractMock,bridge=window.snoteContractOfficeBridge;
   m.officeCalls=0;m.officeHoldNext=false;m.officeWaiting=false;
   window.snoteContractOfficeBridge=Object.freeze({...bridge,async officeStamp(context){m.officeCalls++;const value=await bridge.officeStamp(context);if(m.officeHoldNext){m.officeHoldNext=false;m.officeWaiting=true;m.officeFinished=new Promise(resolve=>m.finishOffice=resolve);await new Promise(resolve=>m.releaseOffice=resolve);m.officeWaiting=false;m.finishOffice();}return value;}});
   window.__transferStampPrints=0;window.print=()=>window.__transferStampPrints++;
  });
  const company=await p.evaluate(()=>__encarFixtureState.company.name),base=qa.companySlots();
  await readyAssets(p);await matching(p,company,'다른 가상 상사');await qa.preview(p);
  const firstSlots=[...base,'dealer1-office','dealer1-corporate'];await qa.assertSealSlots(p,firstSlots);qa.assertInkFits(await qa.actualTextBounds(p));
  const sources=await p.evaluate(()=>({company:snoteCompanyAssetState('companyStamp').url,office:snoteCompanyAssetState('companyOfficeStamp').url}));
  assert(sources.company&&sources.office&&sources.company!==sources.office);
  assert.equal(await image(p,'dealer1-office').getAttribute('data-snote-company-asset'),'companyOfficeStamp','The rectangular impression consumes only the registered private office-stamp asset');
  assert.equal(await image(p,'dealer1-office').getAttribute('data-snote-company-source'),sources.office);
  assert.equal(await image(p,'dealer1-corporate').getAttribute('data-snote-company-source'),sources.company);
  assert.equal(await image(p,'dealer1-corporate').getAttribute('src'),await image(p,base[0]).getAttribute('src'),'The adjoining round impression uses the same verified company image as the party stamps');
  assert.notEqual(await image(p,'dealer1-office').getAttribute('src'),await image(p,'dealer1-corporate').getAttribute('src'),'The separate office stamp cannot reuse a round company graphic');
  for(const slot of ['dealer1-office','dealer1-corporate']){const pixels=await qa.sealPixels(p,'[data-seal-slot="'+slot+'"]');assert(pixels.warm/pixels.visible>.99,'Both private trader stamps render in #dc3722 warm vermilion');assert(pixels.transparent>100&&pixels.red>100);assert(Math.max(pixels.width,pixels.height)>=2048);}
  const registeredInk={office:await registeredInkSupport(p,'dealer1-office'),corporate:await registeredInkSupport(p,'dealer1-corporate')};
  const dimensions=await p.evaluate(()=>({company:SnoteTransferDocumentLayout.seals.company.sellerTop,generated:SnoteTransferDocumentLayout.seals.generated.buyerTop,office:SnoteTransferDocumentLayout.seals.traderOffice,corporate:SnoteTransferDocumentLayout.seals.traderCorporate}));
  assert.equal(dimensions.company[3],62.7);assert.equal(dimensions.generated[3],50.16);for(const box of Object.values(dimensions.office))assert.deepEqual(box.slice(2),[qa.OFFICE_PHYSICAL_PT,qa.OFFICE_PHYSICAL_PT]);for(const box of Object.values(dimensions.corporate))assert.deepEqual(box.slice(2),[44,44]);
  await p.locator('#contract-office-page-front').screenshot({path:path.join(OUT,'trader-stamps-'+kind+'-'+width+'.png')});
  if(width===1440){await p.emulateMedia({media:'print'});const file=path.join(OUT,'trader-stamps-'+kind+'.pdf');await p.pdf({path:file,format:'A4',preferCSSPageSize:true,printBackground:true});const audit=await qa.auditPdf(file,p);qa.assertPdfSeals(audit,firstSlots);assert.equal(audit.pages,1);assert(Math.abs(audit.sizes[0][0]-595.28)<1&&Math.abs(audit.sizes[0][1]-841.89)<1);fs.writeFileSync(file+'.json',JSON.stringify(audit,null,2));await p.emulateMedia({media:'screen'});}
  await p.evaluate(()=>snoteInvalidateCompanyAssets('companyOfficeStamp'));assert.equal(await p.evaluate(()=>document.getElementById('contract-office-dialog').__coOfficeStampArtwork),null,'Office invalidation releases the preview-local private rendition cache');assert.equal(await image(p,'dealer1-office').getAttribute('src'),null,'Office invalidation immediately removes its displayed private pixels');assert.equal(await image(p,'dealer1-corporate').getAttribute('data-snote-company-source'),sources.company,'Invalidating the separate office image preserves the verified round seal source');
  await close(p);

  await matching(p,company,company);await qa.preview(p);await qa.assertSealSlots(p,firstSlots);assert.equal(await p.locator('[data-seal-slot$="-office"]').count(),1,'Two matching trader names still produce one office stamp in the first column');await close(p);
  await matching(p,'(주) '+company+' (상품용)','다른 가상 상사');await qa.preview(p);await qa.assertSealSlots(p,firstSlots);await close(p);
  await matching(p,'다른 가상 상사',company);await qa.preview(p);await qa.assertSealSlots(p,[...base,'dealer2-office','dealer2-corporate']);await close(p);
  await matching(p,'다른 가상 상사','또 다른 가상 상사');await qa.preview(p);await qa.assertSealSlots(p,base);assert.equal(await p.locator('[data-seal-slot^="dealer"]').count(),0,'No current-company trader match leaves both trader stamp fields blank');await close(p);

  await matching(p,company,'다른 가상 상사');await p.evaluate(()=>{const m=__contractMock;m.assetRows=m.assetRows.filter(r=>r.group_name!=='companyOfficeStamp');snoteInvalidateCompanyAssets('companyOfficeStamp');});await qa.preview(p);await qa.assertSealSlots(p,[...base,'dealer1-corporate']);assert.equal(await image(p,'dealer1-office').count(),0,'A missing office stamp has no generated or reused fallback');const missing=await p.evaluate(async()=>{const bridge=snoteContractOfficeBridge,context=bridge.context(),stamp=await bridge.officeStamp(context);return{stamp,current:bridge.officeStampCurrent(context,stamp)};});assert.deepEqual(missing,{stamp:{status:'missing',url:null},current:true});await close(p);
  await p.evaluate(async()=>{const m=__contractMock;await m.makeOfficeStamp();m.assetRows=m.assetRows.filter(r=>r.group_name!=='companyStamp');snoteInvalidateCompanyAssets('companyStamp');snoteInvalidateCompanyAssets('companyOfficeStamp');});await qa.preview(p);await qa.assertSealSlots(p,['dealer1-office']);assert.equal(await p.locator('.co-print-company-seal').count(),0,'An office image cannot substitute for an absent round company seal');await close(p);

  await readyAssets(p);await p.evaluate(()=>{__contractMock.officeStampMode='error';snoteInvalidateCompanyAssets('companyOfficeStamp');});await failPreview(p);await noStaleImage(p);await close(p);
  await readyAssets(p);await p.evaluate(async()=>{const m=__contractMock;await m.makeStamp(m.C,2);snoteInvalidateCompanyAssets('companyStamp');});await qa.preview(p);await qa.assertSealSlots(p,firstSlots);await close(p);
  await p.evaluate(async()=>{const m=__contractMock;await m.makeStamp(m.C,2.01);snoteInvalidateCompanyAssets('companyStamp');});await failPreview(p);await noStaleImage(p);await close(p);

  await readyAssets(p);await holdOffice(p);const staleSource=await p.evaluate(()=>snoteCompanyAssetState('companyOfficeStamp').url);await p.evaluate(async()=>{const m=__contractMock;await m.makeOfficeStamp(m.C,1.25);snoteInvalidateCompanyAssets('companyOfficeStamp');});await releaseOffice(p);await noStaleImage(p,staleSource);assert(!await p.locator('#contract-office-dialog[open]').count()||await p.locator('#contract-office-print').isDisabled(),'Replacing an office source during preparation invalidates the pending print');assert.equal(await p.evaluate(()=>__transferStampPrints),0);if(await p.locator('#contract-office-dialog[open]').count())await close(p);
  await qa.preview(p);await qa.assertSealSlots(p,firstSlots);const refreshed=await image(p,'dealer1-office').getAttribute('data-snote-company-source');assert.notEqual(refreshed,staleSource);await close(p);

  const {reads,companyId}=await p.evaluate(()=>({reads:__contractMock.assetReads,companyId:__contractMock.C}));assert(reads.some(r=>r.group_name==='companyOfficeStamp'));assert(reads.filter(r=>r.group_name==='companyOfficeStamp').every(r=>r.company_id===companyId));
  assert.deepEqual(await p.evaluate(()=>__contractMock.saves),[],'Previewing trader stamps never saves customer or private asset data');assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.deepEqual(await p.evaluate(()=>__contractMock.privateReads),[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await holdOffice(p);f.answerConfirm(true,/^온라인 계정에서 로그아웃할까요\?$/);await p.evaluate(()=>window.zc86Cloud.signOut());await releaseOffice(p);assert.equal(await p.locator('#contract-office-dialog[open]').count(),0,'Logout cancels a pending office-stamp preparation');await noStaleImage(p);assert.equal(await p.evaluate(()=>__transferStampPrints),0);assert.equal(await p.evaluate(()=>currentUser),null);
  results.push({kind,width,passed:true,syntheticOnly:true,registeredInk});console.log('PASS transfer stamps v2.193',kind,width,'first matching trader only,private office69.564pt/physical1.7x+round44pt,missing/error/source/logout guards,full-size signatures/about5mm bottom space,warm vermilion,black unchanged-weight1A4,no footer/no writes');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+kind+'-'+width+'.png'),fullPage:true}).catch(()=>{});throw error;}finally{await finish(f);}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of widths)for(const kind of ['purchase','sale'])await run(width,kind);}finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,results},null,2)+'\n');}}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
