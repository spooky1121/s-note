'use strict';
// Actual quotation, shared document controls and A4 output with synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.QUOTE_VIEWPORT_ARTIFACT_DIR||'/workspace/work/quote-v2199/viewport';fs.mkdirSync(OUT,{recursive:true});
const SIZES=(process.env.QUOTE_VIEWPORT_SIZES||'1440x900,1366x768,360x780,390x844,430x932,320x640').split(',').map(s=>s.split('x').map(Number)),results=[];
async function frames(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));}
async function metrics(p){return p.evaluate(()=>{
 const root=document.getElementById('quote-overlay'),paper=document.getElementById('quote-paper'),card=root.querySelector('.snote-popup-card'),holder=root.querySelector('.snote-popup-frame'),rail=root.querySelector('.snote-document-controls'),viewport=window.visualViewport;
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const railRect=rail.getBoundingClientRect(),overlaps=[],walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);let node;
 while(node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height&&r.right>railRect.left+1&&r.left<railRect.right-1&&r.bottom>railRect.top+1&&r.top<railRect.bottom-1)overlaps.push(node.textContent.trim().slice(0,50));}
 return{viewport:{width:Math.min(innerWidth,viewport?.width||innerWidth),height:Math.min(innerHeight,viewport?.height||innerHeight),top:viewport?.offsetTop||0},paper:rect(paper),bank:rect(paper.querySelector('.q8-bank-section')),footer:rect(paper.querySelector('.q8-bottom')),holder:rect(holder),rail:rect(rail),buttons:[...rail.querySelectorAll('button')].map(e=>({clickable:(()=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e;})(),...rect(e)})),rootScroll:root.scrollHeight-root.clientHeight,cardScroll:card.scrollHeight-card.clientHeight,horizontal:document.documentElement.scrollWidth-innerWidth,overlaps,scale:Number(getComputedStyle(root).getPropertyValue('--snote-document-scale'))};
 });}
function contained(m){
 for(const[name,r]of[['paper',m.paper],['rail',m.rail],...m.buttons.map((r,i)=>['button '+i,r])])assert(r.x>=-.6&&r.right<=m.viewport.width+.6&&r.y>=m.viewport.top-.6&&r.bottom<=m.viewport.top+m.viewport.height+.6,name+' must fit the visual viewport '+JSON.stringify(m));
 assert(m.bank.bottom<=m.footer.y+1,'Bank details must stay above the footer '+JSON.stringify(m));
 assert(m.rootScroll<=1,'No quotation overlay scrolling '+JSON.stringify(m));assert(m.cardScroll<=1,'No quotation card scrolling '+JSON.stringify(m));assert.equal(m.horizontal,0);assert.deepEqual(m.overlaps,[],'The close/print rail cannot obscure document text');
 assert.equal(m.buttons.length,2);assert(Math.abs(m.buttons[0].width-30)<.01);assert(Math.abs(m.buttons[0].height-30)<.01);assert(Math.abs(m.buttons[1].width-36)<.01);assert(Math.abs(m.buttons[1].height-36)<.01);assert(m.buttons.every(b=>b.clickable));
 assert(Math.abs(m.rail.y-m.paper.y-2)<1);assert(Math.abs(m.paper.right-m.rail.right-2)<1);assert(Math.abs(m.buttons[0].x+m.buttons[0].width/2-m.buttons[1].x-m.buttons[1].width/2)<1);assert(Math.abs(m.buttons[1].y-m.buttons[0].bottom-8)<1,JSON.stringify(m));assert(m.scale>0&&m.scale<=1);
}
async function keyboard(p,height,offsetTop){
 await p.evaluate(({height,offsetTop})=>{const v=window.visualViewport;Object.defineProperty(v,'height',{configurable:true,get:()=>height});Object.defineProperty(v,'offsetTop',{configurable:true,get:()=>offsetTop});v.dispatchEvent(new Event('resize'));v.dispatchEvent(new Event('scroll'));},{height,offsetTop});await frames(p);contained(await metrics(p));
}
async function screenPaperMarkup(p){return p.locator('#quote-paper').evaluate(paper=>{
 // v2.248 marks optional logos only while preparing/printing. Native afterprint
 // clears that diagnostic attribute; all content, visibility and geometry remain checked.
 const copy=paper.cloneNode(true);for(const image of copy.querySelectorAll('.snote-document-brand img[data-snote-print-logo-unavailable],.snote-document-logo img[data-snote-print-logo-unavailable]'))image.removeAttribute('data-snote-print-logo-unavailable');return copy.innerHTML;
});}
async function nativePrint(p,width,height){
 const previous=await p.evaluate(()=>__quoteViewportPrints);await p.locator('#quote-overlay [data-document-print]').click();await p.waitForFunction(n=>__quoteViewportPrints===n+1,previous);await p.mouse.move(0,0);
 const body=await screenPaperMarkup(p);await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);await frames(p);
 const print=await p.locator('#quote-paper').evaluate(e=>{const r=e.getBoundingClientRect(),f=e.querySelector('.q8-bottom').getBoundingClientRect();return{width:r.width,height:r.height,zoom:getComputedStyle(e).zoom,footerBottom:f.bottom-r.top,bankBottom:e.querySelector('.q8-bank-section').getBoundingClientRect().bottom-r.top,footerTop:f.top-r.top,controls:getComputedStyle(document.querySelector('#quote-overlay .snote-document-controls')).display};});
 assert(Math.abs(print.width-210*96/25.4)<1);assert(Math.abs(print.height-297*96/25.4)<1);assert.equal(print.zoom,'1');assert.equal(print.controls,'none');assert(print.footerBottom<print.height);assert(print.bankBottom<=print.footerTop+1);
 const file=path.join(OUT,'quote-'+width+'x'+height+'.pdf'),pdf=await p.pdf({path:file,format:'A4',preferCSSPageSize:true,printBackground:true}),pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;assert.equal(pages,1,'The quotation remains one native A4 page');
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}).replace(/\s/g,'');for(const expected of['차량구매견적서','차량정보','항목별비용','최종견적금액','입금안내','합성견적차량','12가3456'])assert(text.includes(expected),'Printed quote must retain '+expected);
 await p.emulateMedia({media:'screen'});await p.evaluate(()=>SnoteDocumentViewport.refresh());await frames(p);assert.equal(await screenPaperMarkup(p),body);contained(await metrics(p));return{pages,...print};
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const[width,height]of SIZES){const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;try{
  await f.context.route('https://synthetic.supabase.co/rest/v1/rpc/snote_payment_accounts_read',async route=>{const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,cache-control,pragma'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});const scope=await p.evaluate(()=>({user_id:__encarFixtureState.user.id,company_id:__encarFixtureState.company.id}));return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({...scope,revision:2,accounts:{vehicle:{bank:'가상 자동차 금융은행',number:'000000000000000000000001',holder:'합성 견적 예금주'},transfer:{bank:'가상 이전 금융은행',number:'000000000000000000000002',holder:'합성 이전 예금주'}}})});});
  await p.setViewportSize({width,height});await p.evaluate(async()=>{window.__quoteViewportPrints=0;window.print=()=>__quoteViewportPrints++;cars[0].model='합성 견적 차량';cars[0].plate='12가3456';openVehicle(cars[0].id);await openQuotePreview();document.getElementById('quote-car-name').value='합성 견적 차량';});
  await p.locator('#quote-overlay.open').waitFor();await p.waitForFunction(()=>!document.querySelector('#quote-overlay [data-snote-payment-row="transfer"]').hidden);await p.evaluate(()=>document.fonts.ready);await frames(p);
  const initial=await metrics(p);contained(initial);await p.screenshot({path:path.join(OUT,'quote-'+width+'x'+height+'.png')});
  const stable=[];for(let i=0;i<3;i++){await frames(p);stable.push((await metrics(p)).paper);}for(const r of stable){assert(Math.abs(r.x-initial.paper.x)<1);assert(Math.abs(r.y-initial.paper.y)<1);assert(Math.abs(r.height-initial.paper.height)<1,'Repeated layout must not drift');}
  await p.setViewportSize({width:height,height:width});await frames(p);contained(await metrics(p));await p.setViewportSize({width,height});await frames(p);contained(await metrics(p));
  await p.locator('#quote-customer').fill('합성 견적 고객');await p.locator('#quote-insurance').fill('12,345');await p.locator('#quote-insurance').dispatchEvent('input');await frames(p);assert.equal(await p.locator('#quote-insurance').inputValue(),'12,345');contained(await metrics(p));
  if(width<=430){await keyboard(p,Math.min(340,height-200),0);await keyboard(p,Math.min(340,height-200),120);await p.screenshot({path:path.join(OUT,'quote-keyboard-'+width+'.png')});await p.evaluate(()=>{delete window.visualViewport.height;delete window.visualViewport.offsetTop;window.visualViewport.dispatchEvent(new Event('resize'));});await frames(p);contained(await metrics(p));}
  const print=await nativePrint(p,width,height);await p.locator('#quote-overlay .snote-popup-close').click();await p.locator('#quote-overlay').waitFor({state:'hidden'});assert(await p.locator('#vehicle-overlay.open').isVisible());assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await finish(f);
  results.push({width,height,initial,print,syntheticKeyboard:width<=430,passed:true});console.log('PASS quote whole-sheet preview, controls, resize, keyboard simulation and native A4 '+width+'x'+height);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,realKeyboardDevicesTested:0,results},null,2)+'\n');}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
