'use strict';
// Actual accountant form, private-asset loader and native A4 PDF; all data/services synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const{setup,setKind,KEYS,VALUES}=require('./contract-office.browser.cjs');
const OUT=process.env.DOCUMENT_FOOTER_OFFICE_ARTIFACT_DIR||'/workspace/work/docs-v2160/office-footer';fs.mkdirSync(OUT,{recursive:true});
const reports=[];
async function makeLogo(p){await p.evaluate(async()=>{
 const m=__contractMock,S=__encarFixtureState,canvas=document.createElement('canvas');canvas.width=240;canvas.height=96;const ctx=canvas.getContext('2d');ctx.fillStyle='#226bd5';ctx.fillRect(0,0,240,96);ctx.fillStyle='#fff';ctx.font='bold 28px sans-serif';ctx.fillText('SYNTHETIC',16,60);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const filePath=m.C+'/'+m.actor+'/branding/qa-logo.png';m.assetRows.push({id:'qa-company-logo',company_id:m.C,owner_id:m.actor,group_name:'companyLogo',file_path:filePath,filename:'qa-logo.png',mime_type:'image/png',file_size:blob.size,created_at:new Date().toISOString()});m.assetObjects.set(filePath,blob);snoteInvalidateCompanyAssets('companyLogo');
});}
async function metrics(p){return p.locator('#contract-office-page-front').evaluate(paper=>{
 const bounds=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},image=paper.querySelector(':scope>img'),overlay=paper.querySelector(':scope>.co-overlay'),footer=paper.querySelector('.co-document-footer'),brand=footer.querySelector('.snote-document-brand'),logo=footer.querySelector('.zc-footer-emblem');
 return{paper:bounds(paper),image:bounds(image),overlay:bounds(overlay),footer:bounds(footer),brand:bounds(brand),logo:bounds(logo),name:footer.querySelector('.snote95-footer-company').textContent,brandLoaded:brand.querySelector('img').complete&&brand.querySelector('img').naturalWidth>0,companyLoaded:logo.complete&&logo.naturalWidth>0,companySource:logo.getAttribute('src'),transform:getComputedStyle(overlay).transform,footerCount:paper.querySelectorAll('.co-document-footer').length,overflow:document.documentElement.scrollWidth>innerWidth};
});}
function geometry(m,{print=false}={}){
 assert.equal(m.footerCount,1);assert(m.brandLoaded&&m.companyLoaded);assert.match(m.companySource,/^blob:/);assert.equal(m.name,'가상 계약상사');if(!print)assert.equal(m.overflow,false);
 for(const k of['x','y','width','height'])assert(Math.abs(m.image[k]-m.overlay[k])<.5,'The form artwork and typed fields must share one uniform transform');
 assert(Math.abs(m.image.width/m.image.height-595/841)<.001,'The original reference aspect ratio is preserved');
 assert(m.image.bottom<=m.footer.y-1,'The entire reference, legal text and association footer must stay above the new logo row');
 assert(m.footer.x>=m.paper.x&&m.footer.right<=m.paper.right+.5&&m.footer.bottom<=m.paper.bottom+.5);assert(m.brand.x<m.logo.x&&m.brand.right<=m.logo.x,'The independent brand stays left of the current company logo');
}
function pdfAudit(file){return JSON.parse(execFileSync('python',['-c',String.raw`import fitz,json,sys
p=fitz.open(sys.argv[1]);out={'pages':len(p),'sizes':[[x.rect.width,x.rect.height] for x in p],'text':[x.get_text() for x in p]};p[0].get_pixmap(matrix=fitz.Matrix(1.2,1.2),alpha=False).save(sys.argv[1]+'.png');print(json.dumps(out,ensure_ascii=False))`,file],{encoding:'utf8'}));}
async function run(width,kind){setKind(kind);const f=await fixture(width),p=f.page;try{
 await setup(p);await makeLogo(p);await p.locator('#contract-office-landing [data-document-kind="'+kind+'"]').click();await p.locator('#contract-office-form').waitFor({state:'visible'});
 for(const key of KEYS)await p.locator('#contract-office-'+key).fill(String(VALUES[key]??''));
 await p.locator('#contract-office-preview').click();await p.locator('#contract-office-print:not([disabled])').waitFor();
 geometry(await metrics(p));await p.locator('#contract-office-page-front').screenshot({path:path.join(OUT,kind+'-'+width+'.png')});
 await p.evaluate(()=>{window.__officeFooterPrints=0;window.print=()=>__officeFooterPrints++;});await p.locator('#contract-office-print').click();await p.waitForFunction(()=>__officeFooterPrints===1);
 await p.emulateMedia({media:'print'});const print=await metrics(p);geometry(print,{print:true});const file=path.join(OUT,kind+'-'+width+'.pdf');await p.pdf({path:file,format:'A4',preferCSSPageSize:true,printBackground:true});const pdf=pdfAudit(file);assert.equal(pdf.pages,1,'The legal form and both footer logos must remain on one A4 page');for(const[w,h]of pdf.sizes){assert(Math.abs(w-595.28)<1&&Math.abs(h-841.89)<1);}
 const text=pdf.text.join('').replace(/\s+/g,'');for(const word of[VALUES.plate,VALUES.model,'제1조','제10조','유의사항','서울특별시자동차매매사업조합','가상계약상사'])assert(text.includes(word.replace(/\s+/g,'')),'A4 output must retain the reference and typed text: '+word);
 await p.emulateMedia({media:'screen'});
 // A missing corporate asset clears only that image; it never duplicates/replaces the app brand.
 await p.evaluate(async()=>{const m=__contractMock;m.assetRows=m.assetRows.filter(r=>r.group_name!=='companyLogo');snoteInvalidateCompanyAssets('companyLogo');await snote95UpdateDocumentCompany();});assert.equal(await p.locator('.co-document-footer .zc-footer-emblem').isVisible(),false);assert.equal(await p.locator('.co-document-footer .snote-document-brand').isVisible(),true);assert.equal(await p.locator('.co-document-footer .snote-document-brand img').getAttribute('data-snote-company-asset'),null);
 assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>__contractMock.saves.length),0,'Preview and footer refresh cannot save a draft');assert.deepEqual(await p.evaluate(()=>__contractMock.privateReads),[]);
 reports.push({width,kind,screen:print,onePageA4:true,fullReferenceText:true,noWrites:true});console.log('PASS office footer '+kind+' '+width+': left SNOTE, decoded scoped company logo/name, complete uniformly aligned reference, single A4 PDF, missing company fallback and no writes');
 }finally{await finish(f);}}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of[1440,390])for(const kind of['purchase','sale'])await run(width,kind);fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,productionReads:0,productionWrites:0,reports},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
