'use strict';
// The transfer certificate deliberately omits both footer logos. Other document footers
// retain their own coverage. Actual app/private loader/A4 PDF; all accounts and images synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const{setup,setKind,qa}=require('./contract-office.browser.cjs');
const OUT=process.env.DOCUMENT_FOOTER_OFFICE_ARTIFACT_DIR||'/workspace/work/transfer-stamps-v2192/office-footer';fs.mkdirSync(OUT,{recursive:true});
const reports=[];
async function makeLogo(p){await p.evaluate(async()=>{
 const m=__contractMock,canvas=document.createElement('canvas');canvas.width=240;canvas.height=96;const ctx=canvas.getContext('2d');ctx.fillStyle='#226bd5';ctx.fillRect(0,0,240,96);ctx.fillStyle='#fff';ctx.font='bold 28px sans-serif';ctx.fillText('SYNTHETIC',16,60);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const filePath=m.C+'/'+m.actor+'/branding/qa-logo.png';m.assetRows.push({id:'qa-company-logo',company_id:m.C,owner_id:m.actor,group_name:'companyLogo',file_path:filePath,filename:'qa-logo.png',mime_type:'image/png',file_size:blob.size,created_at:new Date().toISOString()});m.assetObjects.set(filePath,blob);snoteInvalidateCompanyAssets('companyLogo');await snoteLoadDocumentLogo();
});assert.equal(await p.evaluate(()=>snoteCompanyAssetState('companyLogo').status),'ready','A registered logo is available while the transfer certificate intentionally omits it');}
async function metrics(p){return p.locator('#contract-office-page-front').evaluate(paper=>{
 const bounds=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},image=paper.querySelector(':scope>img'),overlay=paper.querySelector(':scope>.co-overlay');
 return{paper:bounds(paper),image:bounds(image),overlay:bounds(overlay),transform:getComputedStyle(overlay).transform,footerCount:paper.querySelectorAll('.co-document-footer,.snote-document-brand,.snote-document-logo,.snote95-footer-company').length,logoCount:paper.querySelectorAll('[data-snote-company-asset="companyLogo"],img[src*="snote-logo"]').length,overflow:document.documentElement.scrollWidth>innerWidth};
});}
function geometry(m,{print=false}={}){
 assert.equal(m.footerCount,0,'The transfer certificate creates no footer container, app brand or company label');assert.equal(m.logoCount,0,'No logo image consumer remains in the transfer paper');if(!print)assert.equal(m.overflow,false);
 for(const k of['x','y','width','height'])assert(Math.abs(m.image[k]-m.overlay[k])<.5,'The form artwork and typed fields share one uniform transform');
 assert(Math.abs(m.image.width/m.image.height-595/841)<.001,'The established reference aspect ratio is preserved');assert(Math.abs(Number(m.transform.match(/^matrix\(([^,]+)/)?.[1])-.93)<.0001,'Removing logos preserves the .93 source form scale');
}
async function run(width,kind){setKind(kind);const f=await fixture(width),p=f.page;try{
 await setup(p);await makeLogo(p);await qa.enterDocument(p);await qa.fill(p);await qa.preview(p);
 const screen=await metrics(p);geometry(screen);await qa.assertSealSlots(p,qa.companySlots());await p.locator('#contract-office-page-front').screenshot({path:path.join(OUT,kind+'-'+width+'.png')});
 await p.evaluate(()=>{window.__officeFooterPrints=0;window.print=()=>__officeFooterPrints++;});await p.locator('#contract-office-print').click();await p.waitForFunction(()=>__officeFooterPrints===1);
 await p.emulateMedia({media:'print'});const print=await metrics(p);geometry(print,{print:true});const file=path.join(OUT,kind+'-'+width+'.pdf');await p.pdf({path:file,format:'A4',preferCSSPageSize:true,printBackground:true});const pdf=await qa.auditPdf(file,p);qa.assertPdfSeals(pdf,qa.companySlots());for(const[w,h]of pdf.sizes)assert(Math.abs(w-595.28)<1&&Math.abs(h-841.89)<1);
 const text=pdf.texts.join('').replace(/\s+/g,'');for(const word of['제1조','제10조','유의사항','서울특별시자동차매매사업조합'])assert(text.includes(word),'A4 output retains the complete reference text: '+word);fs.writeFileSync(file+'.json',JSON.stringify(pdf,null,2));await p.emulateMedia({media:'screen'});
 await p.evaluate(async()=>{const m=__contractMock;m.assetRows=m.assetRows.filter(r=>r.group_name!=='companyLogo');snoteInvalidateCompanyAssets('companyLogo');await snote95UpdateDocumentCompany();});geometry(await metrics(p));
 assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>__contractMock.saves.length),0,'Preview and logo invalidation cannot save a draft');assert.deepEqual(await p.evaluate(()=>__contractMock.privateReads),[]);
 reports.push({width,kind,screen,print,footerDom:0,footerLogoImages:0,onePageA4:true,fullReferenceText:true,noWrites:true});console.log('PASS office footer removal '+kind+' '+width+': no app/company footer DOM or logo images, unchanged .93 aligned reference, single A4 PDF with blank footer raster, no writes');
 }finally{await finish(f);}}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of[1440,390])for(const kind of['purchase','sale'])await run(width,kind);fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,productionReads:0,productionWrites:0,reports},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
