'use strict';
// Receipt prose must stay inside its table cells on the preview and real A4.
// Every identity, response and signature in this fixture is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.RECEIPT_PRIVACY_ARTIFACT_DIR||'/workspace/work/ui-v2162/receipt';fs.mkdirSync(OUT,{recursive:true});
const widths=(process.env.RECEIPT_PRIVACY_WIDTHS||'1440,390,320').split(',').map(Number),results=[];
const expected=['자동차소유권이전 완료시까지 이용','자동차소유권이전 완료후 1년간 보관','자동차양도증명서 및 이전등록신청서 작성에 이용','인허가증보험증권 사본 수령 확인서 작성에 이용'];
const compact=text=>String(text).replace(/\s/gu,'');
async function metrics(page){return page.locator('#zc76-receipt-paper').evaluate(paper=>{
 const pr=paper.getBoundingClientRect(),table=paper.querySelector('.zc76-privacy'),violations=[],cells=[...table.querySelectorAll('th,td')];
 for(const cell of cells){const box=cell.getBoundingClientRect(),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);let text;
  while(text=walker.nextNode()){if(!text.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(text);for(const ink of range.getClientRects())if(ink.width&&ink.height&&(ink.left<box.left-1||ink.right>box.right+1||ink.top<box.top-1||ink.bottom>box.bottom+1))violations.push({text:text.textContent,cell:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},ink:{left:ink.left,right:ink.right,top:ink.top,bottom:ink.bottom}});}
 }
 const footer=paper.querySelector('.snote202-receipt-brand').getBoundingClientRect(),sign=paper.querySelector('.zc76-sign').getBoundingClientRect();
 return{width:pr.width,height:pr.height,tableWidth:table.getBoundingClientRect().width,periodWidth:cells[5].getBoundingClientRect().width,periodFont:parseFloat(getComputedStyle(cells[5]).fontSize),whiteSpace:getComputedStyle(cells[5]).whiteSpace,tableHeight:table.getBoundingClientRect().height,signatureGap:footer.top-sign.bottom,violations};
});}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{for(const width of widths){const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;try{
  await p.route('**/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[]})}));
  await p.evaluate(async()=>{window.snoteLoadDocumentLogo=async()=>null;await zc76OpenReceipt({ownerId:currentUser.username,carId:cars[0].id,name:'합성 인수 고객',phone:'01012345678',address:'서울특별시 강서구 양천로 390 합성빌딩 12층',mailing:'서울특별시 강서구 양천로 390 합성빌딩 12층',refundBank:'합성은행',refundAccount:'0001234567890',refundHolder:'합성 인수 고객',customerSignature:{version:1,strokes:[[[.08,.7],[.18,.2],[.35,.72],[.58,.22],[.85,.65]],[[.15,.85],[.9,.8]]]},customerSignatureSignedAt:'2026-11-17T00:00:00.000Z'},cars[0]);await snote95DocumentLogoReady;});
  await p.waitForFunction(()=>{const image=document.getElementById('snote215-receipt-signature-image');return !image.hidden&&image.complete&&image.naturalWidth>0;});await p.evaluate(()=>document.fonts.ready);
  for(const value of expected)assert(compact(await p.locator('.zc76-privacy').textContent()).includes(compact(value)),value+' must remain in the form');
  const preview=await metrics(p);assert.deepEqual(preview.violations,[],'Preview prose must wrap entirely within its own cell');assert.equal(preview.whiteSpace,'normal');
  // A larger installed font must wrap too; the former global nowrap rule clipped
  // this realistic retention-column variation even when Linux's narrow font fit.
  await p.addStyleTag({content:'#zc76-receipt-paper .zc76-privacy tbody td:last-child{font-size:9pt!important}'});
  await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);const print=await metrics(p);assert.deepEqual(print.violations,[],'Native A4 text must remain visible with the wider period text');assert(print.periodWidth/print.tableWidth>=.32);assert(print.periodFont>=12-.1);assert(print.signatureGap>=7.4,'The original signature must clear the shared footer');assert(Math.abs(print.width-210*96/25.4)<1);assert(Math.abs(print.height-297*96/25.4)<1);
  const pdf=path.join(OUT,'receipt-'+width+'.pdf');await p.pdf({path:pdf,format:'A4',printBackground:true,preferCSSPageSize:true});const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'});assert.match(info,/Pages:\s+1\b/);const text=compact(execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'}));for(const value of expected)assert(text.includes(compact(value)),value+' must survive real PDF output');assert(text.includes('합성인수고객'));
  await p.screenshot({path:path.join(OUT,'receipt-'+width+'-print.png'),fullPage:true});await p.emulateMedia({media:'screen'});await p.screenshot({path:path.join(OUT,'receipt-'+width+'-screen.png'),fullPage:true});results.push({width,passed:true,preview,print,pages:1});console.log('PASS receipt privacy retention and purpose text, original signature and A4 footer',width);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
