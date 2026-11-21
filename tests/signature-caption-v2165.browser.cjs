'use strict';
// Real document DOM/PDFs; all users, signatures, logos and HTTP replies are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.SIGNATURE_CAPTION_ARTIFACT_DIR||'/workspace/work/documents-v2165/signature';fs.mkdirSync(OUT,{recursive:true});
const WIDTHS=(process.env.SIGNATURE_CAPTION_WIDTHS||'1440,390').split(',').map(Number),results=[];
const compact=value=>String(value).replace(/\s/gu,'');
async function setup(width){
 const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;
 await f.context.route('https://encar-smoke.example/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:'{"ok":true,"requests":[]}'}));
 await p.evaluate(async()=>{
  window.__signatureCaption={prints:0};window.print=()=>__signatureCaption.prints++;
  const logo=document.createElement('canvas');logo.width=192;logo.height=64;const ctx=logo.getContext('2d');ctx.fillStyle='#226bd5';ctx.fillRect(0,0,192,64);
  __signatureCaption.logo=URL.createObjectURL(await new Promise(resolve=>logo.toBlob(resolve,'image/png')));window.snoteLoadDocumentLogo=async()=>__signatureCaption.logo;window.snoteLoadDocumentStamp=async()=>null;
  const car=cars[0];window.__signatureCaption.person={ownerId:currentUser.username,carId:car.id,name:'합성 서명 고객',phone:'01012345678',address:'경기도 고양시 합성로 123',customerSignature:{version:1,strokes:[[[.1,.7],[.2,.2],[.4,.7],[.6,.2],[.9,.7]]]},customerSignatureSignedAt:'2026-11-20T23:42:17-05:00'};
 });return f;
}
async function show(p,kind,change={}){
 await p.evaluate(async({kind,change})=>{
  if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});
  if(!document.getElementById('zc76-receipt-overlay').hidden)await zc76CloseReceipt({discard:true});
  openVehicle(cars[0].id);const person={...__signatureCaption.person,...change};
  if(kind==='receipt'){await zc76OpenReceipt(person,cars[0]);await snote252ReceiptSignatureTask;await snote250ReceiptSignature.ready();return;}
  openContractPreview({loadCustomer:false});document.getElementById('ct-buyer-name').value=person.name;document.getElementById('ct-buyer-phone').value=person.phone;document.getElementById('ct-buyer-address').value=person.address;document.getElementById('ct-special').value='합성 출력 검증용 특약사항';fitContractSpecial();snote222ContractSignature.set(person);await snote222ContractSignature.ready();
 },{kind,change});await p.evaluate(()=>document.fonts.ready);
}
async function captionBounds(p,kind,expected){
 const selector=kind==='contract'?'#contract-paper [data-customer-contract-signature-caption]':'#zc76-receipt-paper #snote215-receipt-signature-caption';
 assert.equal(await p.locator(selector).textContent(),expected);
 const b=await p.locator(selector).evaluate(e=>{const paper=e.closest('.contract-paper,#zc76-receipt-paper'),image=kindImage(e),r=e.getBoundingClientRect(),im=image.getBoundingClientRect(),pr=paper.getBoundingClientRect();function kindImage(e){return e.parentElement.querySelector('[data-customer-contract-signature-image],#snote215-receipt-signature-image')||e.parentElement.querySelector('img');}return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,imageBottom:im.bottom,paperLeft:pr.left,paperRight:pr.right,font:parseFloat(getComputedStyle(e).fontSize),visible:!e.hidden&&getComputedStyle(e).display!=='none'};});
 assert(b.visible);assert(b.top>=b.imageBottom-.6,'Timestamp must appear below the actual signature ink slot');assert(b.left>=b.paperLeft-.6&&b.right<=b.paperRight+.6,'Caption must remain inside paper');assert(b.font>0&&b.font<=9,'Timestamp should remain a small caption');return b;
}
async function pdf(p,kind,width,expected){
 if(kind==='contract')await p.evaluate(()=>buildContractPrintPages());await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);
 const selector=kind==='contract'?'#contract-print-pages .contract-print-copy':'#zc76-receipt-paper',copies=p.locator(selector),count=kind==='contract'?2:1;assert.equal(await copies.count(),count);
 const metrics=await copies.evaluateAll(papers=>papers.map(p=>{const r=p.getBoundingClientRect(),footer=p.querySelector('.ct-footer,.snote202-receipt-brand').getBoundingClientRect(),caption=p.querySelector('[data-customer-contract-signature-caption],#snote215-receipt-signature-caption'),c=caption.getBoundingClientRect(),image=p.querySelector('[data-customer-contract-signature-image="buyer"],#snote215-receipt-signature-image').getBoundingClientRect();return{width:r.width,height:r.height,caption:c.toJSON(),image:image.toJSON(),footer:footer.toJSON(),paper:r.toJSON(),text:caption.textContent};}));
 for(const m of metrics){assert.equal(m.text,expected);assert(Math.abs(m.width-210*96/25.4)<1&&Math.abs(m.height-297*96/25.4)<1);assert(m.caption.top>=m.image.bottom-.6);assert(m.caption.bottom<=m.footer.top-6,'Signature caption must retain footer clearance');assert(m.caption.left>=m.paper.left-.6&&m.caption.right<=m.paper.right+.6);}
 const file=path.join(OUT,kind+'-'+width+'.pdf'),bytes=await p.pdf({path:file,format:'A4',printBackground:true,preferCSSPageSize:true});assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,count);
 const text=compact(execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}));assert.equal(text.split(compact(expected)).length-1,count,'Every native A4 copy must contain its actual timestamp');assert(!text.includes('고객원제출서명'));await p.screenshot({path:path.join(OUT,kind+'-'+width+'-print.png'),fullPage:true});await p.emulateMedia({media:'screen'});return metrics;
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of WIDTHS){const f=await setup(width),p=f.page;try{
  for(const kind of ['contract','receipt']){await show(p,kind);const expected='고객 서명; 2026.11.21 13:42:17';const screen=await captionBounds(p,kind,expected);assert(!(await p.locator(kind==='contract'?'#contract-overlay':'#zc76-receipt-overlay').innerText()).includes('고객 원제출 서명'));const printed=await pdf(p,kind,width,expected);
   await show(p,kind,{customerSignatureSignedAt:'2026-12-31T15:00:00Z'});await captionBounds(p,kind,'고객 서명; 2027.01.01 00:00:00');await show(p,kind,{customerSignatureSignedAt:null});await captionBounds(p,kind,'고객 서명;');
   await show(p,kind,{customerSignature:null});const caption=p.locator(kind==='contract'?'#contract-paper [data-customer-contract-signature-caption]':'#snote215-receipt-signature-caption');assert.equal(await caption.isVisible(),false);assert.equal(await caption.textContent(),'');results.push({kind,width,screen,printed,passed:true});console.log('PASS signature caption '+kind+' '+width);
  }
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,productionWrites:0,results},null,2)+'\n');}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
