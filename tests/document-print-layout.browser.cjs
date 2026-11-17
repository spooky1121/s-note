'use strict';
// Physical A4 layout with generated branding/signatures and synthetic accounts.
// Every request is intercepted by the existing fixture. No real DB or printer is used.
// Requires Chromium/Playwright and pdftotext (Poppler) for actual PDF content checks.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.DOCUMENT_PRINT_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-document-print-layout');fs.mkdirSync(OUT,{recursive:true});
const widths=process.env.DOCUMENT_PRINT_TEST_WIDTHS?process.env.DOCUMENT_PRINT_TEST_WIDTHS.split(',').map(Number):[1440,390,320];assert(widths.length&&widths.every(width=>[1440,1024,390,320].includes(width)));
const SIGNATURE={version:1,strokes:[[[.08,.7],[.18,.2],[.35,.72],[.58,.22],[.85,.65]],[[.15,.85],[.9,.8]]]},MM=96/25.4,results=[],validation=[];
const compact=text=>text.replace(/\s/g,'');
async function setup(width){
 const f=await fixture(width),p=f.page;
 await p.evaluate(async()=>{
  window.__printLayout={prints:0};window.print=()=>{__printLayout.prints++;};
  const stamp=document.createElement('canvas');stamp.width=96;stamp.height=96;const red=stamp.getContext('2d');red.strokeStyle='#ce2334';red.lineWidth=6;red.strokeRect(8,8,80,80);red.fillStyle='#ce2334';red.font='bold 23px sans-serif';red.fillText('TEST',16,55);
  const logo=document.createElement('canvas');logo.width=192;logo.height=64;const blue=logo.getContext('2d');blue.fillStyle='#226bd5';blue.fillRect(0,0,192,64);blue.fillStyle='white';blue.font='bold 24px sans-serif';blue.fillText('SYNTHETIC',12,41);
  const image=async(canvas,mime)=>URL.createObjectURL(await new Promise(resolve=>canvas.toBlob(resolve,mime)));
  __printLayout.stamp=await image(stamp,'image/png');__printLayout.logo=await image(logo,'image/png');window.snoteLoadDocumentStamp=async()=>__printLayout.stamp;window.snoteLoadDocumentLogo=async()=>__printLayout.logo;
  const S=__encarFixtureState;S.company={...S.company,name:'합성 자동차 매매상사',business_address:'경기도 고양시 일산동구 합성로 123번길 45',business_address_detail:'합성빌딩 3층',business_number:'1234567890',business_phone:'0311234567'};currentUser.company=S.company.name;
 });return f;
}
async function open(p,kind,long){
 return p.evaluate(async({kind,long,signature})=>{
  const car=cars.find(c=>c.id===activeCarId)||cars[0],medium='경기도 고양시 일산동구 합성로 123번길 45 합성아파트 101동 1001호';
  const longAddress=(medium+' 별관 2층 고객지원센터 방문 전 연락 부탁드립니다. '+medium).slice(0,120);
  const person={ownerId:currentUser.username,carId:car.id,name:'합성 인쇄 고객',phone:'01012345678',address:kind==='contract'&&long?longAddress:medium,mailing:'서울특별시 강남구 합성대로 123-45 합성빌딩 12층',refundBank:'합성은행',refundAccount:'123-4567-890123',refundHolder:'합성 고객',customerSignature:signature,customerSignatureSignedAt:'2026-11-17T00:00:00Z'};
  const special=long?['차량 상태와 성능점검 기록을 확인하고 인도합니다.','잔금은 약정한 날짜에 지정 계좌로 입금합니다.','이전등록 비용을 정산한 뒤 차액을 환급합니다.','인도 전 발생한 과태료는 매도인이 부담합니다.','인수 후 보험 가입 상태를 확인하고 출고합니다.','추가 합의는 쌍방 서명한 별도 문서로 확인합니다.'].join('\n'):'차량 상태를 확인한 후 인도합니다.';
  const before=__printLayout.prints;
  if(kind==='receipt'){
   await zc76OpenReceipt(person,car);snote250ReceiptSignature.set(person);document.getElementById('zc76-car').value=long?'현대 더 뉴 그랜저 IG 하이브리드':'합성 차량';
   for(const id of ['zc76-confirm-insurance','zc76-delegation','zc76-cash-confirm'])document.getElementById(id).checked=true;
   await zc76PrintReceipt();
  }else{
   await zc76CloseReceipt({discard:true});openVehicle(car.id);openContractPreview({loadCustomer:false});
   document.getElementById('ct-buyer-name').value=person.name;document.getElementById('ct-buyer-phone').value=person.phone;document.getElementById('ct-buyer-address').value=person.address;document.getElementById('ct-special').value=special;
   const specialFits=fitContractSpecial();if(!specialFits)throw Error('The synthetic special-agreement fixture must fit the existing editor');
   snote222ContractSignature.set(person);await printContract();
  }
  if(__printLayout.prints!==before+1){const dimensions=id=>{const e=document.getElementById(id),s=getComputedStyle(e);return{id,value:e.value,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,font:s.font,fontSize:s.fontSize};};throw Error('Actual document print entry point did not pass validation: '+JSON.stringify({kind,long,toast:document.getElementById('toast')?.textContent,stampStatus:typeof snote128StampState==='undefined'?null:snote128StampState.status,fonts:document.fonts.status,contractView:snote214ContractView,fields:['ct-seller-name','ct-seller-address','ct-special'].map(dimensions)}));}
  return {address:person.address,special,docDate:document.getElementById('zc76-doc-date').value,terms:document.querySelector('#contract-paper .ct-terms').textContent,sourceInputs:kind==='contract'?[...document.querySelectorAll('#contract-paper input')].map(el=>el.value):[],signature:window.snoteCustomerSignatureImage(signature)};
 },{kind,long,signature:SIGNATURE});
}
async function measure(p,selector){
 return p.locator(selector).evaluateAll(papers=>papers.map(paper=>{
  const page=paper.getBoundingClientRect(),style=getComputedStyle(paper),footer=paper.querySelector('.snote202-receipt-brand,.ct-footer'),foot=footer.getBoundingClientRect(),round=n=>Math.round(n*100)/100;
  const isFooter=el=>!!el.closest('.snote202-receipt-brand,.ct-footer'),visible=el=>{for(let parent=el;parent&&parent!==paper.parentElement;parent=parent.parentElement){const s=getComputedStyle(parent);if(s.display==='none'||s.visibility==='hidden')return false;}const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
  const boxes=[];const walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){if(!node.textContent.trim()||!visible(node.parentElement))continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())if(rect.width&&rect.height)boxes.push({kind:'text',label:node.textContent.trim().slice(0,70),left:rect.left-page.left,right:rect.right-page.left,top:rect.top-page.top,bottom:rect.bottom-page.top,footer:isFooter(node.parentElement)});}
  for(const el of paper.querySelectorAll('input,textarea,img')){if(!visible(el))continue;const r=el.getBoundingClientRect();boxes.push({kind:el.tagName.toLowerCase(),label:el.value||el.alt||el.id||el.className,left:r.left-page.left,right:r.right-page.left,top:r.top-page.top,bottom:r.bottom-page.top,footer:isFooter(el)});}
  const body=boxes.filter(box=>!box.footer),flow=[...paper.children].filter(el=>visible(el)&&el!==footer&&!el.classList.contains('ct-copy-label')&&getComputedStyle(el).position!=='absolute');
  const flowBottom=Math.max(...flow.map(el=>el.getBoundingClientRect().bottom)),bodyBottom=Math.max(...body.map(box=>box.bottom));
  const escaping=boxes.filter(b=>b.left<-.6||b.right>page.width+.6||b.top<-.6||b.bottom>page.height+.6);
  const footerOverlap=body.filter(box=>box.bottom>foot.top-page.top-8+.6);
  return {width:round(page.width),height:round(page.height),zoom:style.zoom,overflow:style.overflow,flowFooterGap:round(foot.top-flowBottom),bodyFooterGap:round(foot.top-page.top-bodyBottom),bottomInkMargin:round(page.height-Math.max(...boxes.map(box=>box.bottom))),footerBottomMargin:round(page.bottom-foot.bottom),escaping,footerOverlap,boxCount:boxes.length,termsColumns:paper.querySelector('.ct-terms')?getComputedStyle(paper.querySelector('.ct-terms')).columnCount:null,termsHeight:paper.querySelector('.ct-terms')?round(paper.querySelector('.ct-terms').getBoundingClientRect().height):null,footerText:footer.textContent.trim(),lastBodyText:body.slice(-6).map(b=>b.label)};
 }));
}
function assertLayout(metric,label){
 assert(Math.abs(metric.width-210*MM)<1,label+' must retain A4 width');assert(Math.abs(metric.height-297*MM)<1,label+' must retain A4 height');assert.equal(metric.zoom,'1');
 assert.deepEqual(metric.escaping,[],label+' must retain every visible text line, field and image inside the physical paper');
 assert.deepEqual(metric.footerOverlap,[],label+' body text/fields/images must clear the footer by at least 8px');
 assert(metric.flowFooterGap>=7.4,label+' whole body sections must clear the footer: '+metric.flowFooterGap);
 assert(metric.bottomInkMargin>=8*MM-.6,label+' printable ink must keep at least 8mm bottom margin: '+metric.bottomInkMargin);
 assert(metric.footerBottomMargin>=8*MM-.6,label+' footer must remain above the physical bottom margin');
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of widths){const f=await setup(width),p=f.page;try{
  for(const long of [false,true])for(const kind of ['receipt','contract']){
   await p.emulateMedia({media:'screen'});const expected=await open(p,kind,long),suffix=kind+'-'+width+(long?'-long':'-short');
   const selector=kind==='receipt'?'#zc76-receipt-paper':'#contract-print-pages .contract-print-copy';
   await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);
   const metrics=await measure(p,selector);assert.equal(metrics.length,kind==='receipt'?1:2);for(const [index,metric]of metrics.entries())assertLayout(metric,suffix+' page '+index);
   if(kind==='contract'){
    for(const copy of await p.locator(selector).all()){
     assert.equal(compact(await copy.locator('.ct-terms').textContent()),compact(expected.terms),'Every legal clause must remain unchanged');assert.equal(await copy.locator('.ct-term').count(),11);assert.match(await copy.locator('.ct-term').last().textContent(),/제11조/);
     assert.equal(await copy.locator('.ct-special-print-text').textContent(),expected.special);assert.equal(await copy.locator('.ct-address-print-text').last().textContent(),expected.address);
     assert.deepEqual(await copy.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value)),expected.sourceInputs);assert.equal(metrics[0].termsColumns,'2');
    }
    assert.equal(await p.locator('#contract-print-pages [id]').count(),0);
   }else{
    assert.equal(await p.locator('#snote215-receipt-signature-image').getAttribute('src'),expected.signature);assert.equal(await p.locator('#zc76-doc-date').inputValue(),expected.docDate,'Print layout must preserve the entered receipt date');
    assert.equal(await p.locator('#zc76-confirm-insurance').isChecked(),true);assert.equal(await p.locator('#zc76-delegation').isChecked(),true);assert.equal(await p.locator('#zc76-cash-confirm').isChecked(),true);
   }
   const pdfPath=path.join(OUT,suffix+'.pdf'),pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:pdfPath}),pageCount=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
   assert.equal(pageCount,kind==='receipt'?1:2,'Actual PDF must have the intended complete A4 copies');
   const text=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'}),plain=compact(text);fs.writeFileSync(path.join(OUT,suffix+'.txt'),text);
   if(kind==='receipt'){for(const phrase of ['현금영수증발급동의및확인서','위내용을설명듣고확인하였음.','합성인쇄고객','제로카'])assert(plain.includes(phrase),'Receipt PDF must include its final consent/signature/footer content: '+phrase);}
   else{assert.equal((plain.match(/제11조/g)||[]).length,2);assert.equal((plain.match(/본계약내용을확인하고이에동의합니다/g)||[]).length,2);assert(plain.includes(compact(expected.address)),'Actual PDF must contain the complete customer address');assert(plain.includes(compact(expected.special)),'Actual PDF must contain the complete special agreement');assert.match(pdf.toString('latin1'),/\/Width 96\s*\/Height 96/,'Corporate seal bitmap must remain embedded');}
   assert.match(pdf.toString('latin1'),/\/Width 640\s*\/Height 240/,'Customer signature bitmap must remain embedded');
   await p.screenshot({path:path.join(OUT,suffix+'.png'),fullPage:true});results.push({kind,width,long,pageCount,metrics});
   await p.emulateMedia({media:'screen'});if(kind==='contract')await p.evaluate(()=>closeContractPreview({discard:true}));else await p.evaluate(()=>zc76CloseReceipt({discard:true}));
  }
  if(width===320){
   const oversized=await p.evaluate(async()=>{openVehicle(cars[0].id);openContractPreview({loadCustomer:false});const input=document.getElementById('ct-seller-address'),value='가'.repeat(401);input.value=value;const before=__printLayout.prints;await printContract();return{blocked:__printLayout.prints===before,retained:input.value===value,open:document.getElementById('contract-overlay').classList.contains('open'),toast:document.getElementById('toast').textContent};});
   assert.equal(oversized.blocked,true,'An address exceeding the physical A4 capacity must still block printing');assert.equal(oversized.retained,true,'Rejected oversized input must remain available for correction');assert.equal(oversized.open,true);assert.match(oversized.toast,/주소/);validation.push({width,...oversized});await p.evaluate(()=>closeContractPreview({discard:true}));
  }
  await finish(f);console.log('PASS '+width+' A4 receipt/contract: standard and long content, no body/footer clipping, actual PDF text/signatures and margins');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(OUT,'partial-metrics.json'),JSON.stringify(results,null,2)+'\n');await f.context.close().catch(()=>{});throw error;}}
 fs.writeFileSync(path.join(OUT,'metrics.json'),JSON.stringify(results,null,2)+'\n');fs.writeFileSync(path.join(OUT,'validation.json'),JSON.stringify(validation,null,2)+'\n');
}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
