'use strict';
// Actual editable documents and native A4 output; all auth, data and media are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.DOCUMENT_VIEWPORT_ARTIFACT_DIR||'/workspace/work/documents-v2165/viewport';fs.mkdirSync(OUT,{recursive:true});
const SIZES=(process.env.DOCUMENT_VIEWPORT_SIZES||'1440x900,1366x768,1280x720,390x844,320x640').split(',').map(s=>s.split('x').map(Number)),results=[];
const SIGN={version:1,strokes:[[[.08,.7],[.18,.2],[.35,.72],[.58,.22],[.85,.65]],[[.15,.85],[.9,.8]]]};
async function frames(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));}
async function setup(width,height){
 const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;await p.setViewportSize({width,height});
 await f.context.route('**/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:'{"ok":true,"requests":[]}'}));
 await p.evaluate(async()=>{
  window.__docViewport={prints:0,schedules:0};window.print=()=>{__docViewport.prints++;};zc75ScheduleContractSave=()=>{__docViewport.schedules++;};
  const canvas=document.createElement('canvas');canvas.width=192;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#287abb';ctx.fillRect(0,0,192,64);ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.fillText('SYNTHETIC',8,40);const logo=URL.createObjectURL(await new Promise(r=>canvas.toBlob(r,'image/png')));
  const seal=document.createElement('canvas');seal.width=96;seal.height=96;const ink=seal.getContext('2d');ink.strokeStyle='#ce2334';ink.lineWidth=5;ink.strokeRect(7,7,82,82);const stamp=URL.createObjectURL(await new Promise(r=>seal.toBlob(r,'image/png')));
  window.snoteLoadDocumentLogo=async()=>logo;window.snoteLoadDocumentStamp=async()=>stamp;
  const S=__encarFixtureState;S.company={...S.company,name:'합성 자동차 매매상사',business_address:'서울특별시 강남구 합성대로 123-45',business_number:'1234567890',business_phone:'0212345678'};currentUser.company=S.company.name;
  cars[0].model='화면 높이 및 인쇄 검증 차량';cars[0].plate='12가3456';cars[0].vin='KMHXX00XXNU000001';cars[0].color='검정색';
 });return f;
}
async function open(p,kind){
 await p.evaluate(async({kind,signature})=>{
  if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});
  if(!document.getElementById('zc76-receipt-overlay').hidden)await zc76CloseReceipt({discard:true});
  openVehicle(cars[0].id);const car=cars[0],person={ownerId:currentUser.username,carId:car.id,name:'합성 서명 고객',phone:'01012345678',address:'경기도 고양시 일산동구 합성로 123 합성아파트 101동 1001호',mailing:'서울특별시 강남구 합성대로 123-45',refundBank:'합성은행',refundAccount:'0001234567890123',refundHolder:'합성 고객',customerSignature:signature,customerSignatureSignedAt:'2026-11-20T23:24:56Z'};
  if(kind==='contract'){await openContractPreview({loadCustomer:false});document.getElementById('ct-buyer-name').value=person.name;document.getElementById('ct-buyer-phone').value=person.phone;document.getElementById('ct-buyer-address').value=person.address;document.getElementById('ct-special').value='차량 상태와 성능점검 기록을 확인하고 인도합니다.\n이전등록 비용을 정산한 뒤 차액을 환급합니다.';fitContractSpecial();snote222ContractSignature.set(person);}
  else await zc76OpenReceipt(person,car);
  SnoteDocumentViewport.refresh();
 },{kind,signature:SIGN});if((await p.viewportSize()).width<=760)await p.locator('#'+(kind==='contract'?'contract-overlay':'zc76-receipt-overlay')+'[data-mobile-document-editor=true]').waitFor();await frames(p);await p.evaluate(()=>document.fonts.ready);await frames(p);
}
async function bounds(p,kind){if(p.viewportSize().width<=760)await p.locator('#'+(kind==='contract'?'contract-overlay':'zc76-receipt-overlay')+'[data-mobile-document-editor=true]').waitFor();return p.evaluate(kind=>{
 const root=document.getElementById(kind==='contract'?'contract-overlay':'zc76-receipt-overlay'),paper=document.getElementById(kind==='contract'?'contract-paper':'zc76-receipt-paper'),holder=root.querySelector('.snote-popup-frame'),card=root.querySelector('.snote-popup-card'),controls=root.querySelector('.snote-document-controls'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const editor=root.querySelector('.snote-mobile-doc-editor');return{mobile:root.dataset.mobileDocumentEditor==='true',editor:editor?rect(editor):null,fieldFonts:editor?[...editor.querySelectorAll('input:not([type=radio]):not([type=checkbox]),textarea,select')].map(e=>parseFloat(getComputedStyle(e).fontSize)):[],width:innerWidth,height:innerHeight,paper:rect(paper),holder:rect(holder),controls:rect(controls),buttons:[...controls.querySelectorAll('button')].map(e=>({disabled:e.disabled,...rect(e)})),rootScroll:root.scrollHeight-root.clientHeight,cardScroll:card.scrollHeight-card.clientHeight,docOverflow:document.documentElement.scrollWidth-innerWidth,scale:Number(getComputedStyle(root).getPropertyValue('--snote-document-scale'))};
 },kind);}
function contained(m){
 if(m.mobile){for(const [name,b]of [['editor',m.editor],['controls',m.controls],...m.buttons.map((b,i)=>['button'+i,b])])assert(b.x>=-.6&&b.y>=-.6&&b.right<=m.width+.6&&b.bottom<=m.height+.6,name+' must stay within mobile viewport '+JSON.stringify(m));assert.equal(m.docOverflow,0);assert(m.fieldFonts.every(size=>size>=16));assert.equal(m.buttons.length,2);assert(m.buttons[0].bottom+4<=m.buttons[1].y);return;}
 for(const [name,b]of [['paper',m.paper],['controls',m.controls],...m.buttons.map((b,i)=>['button'+i,b])])assert(b.x>=-.6&&b.y>=-.6&&b.right<=m.width+.6&&b.bottom<=m.height+.6,name+' must stay within viewport '+JSON.stringify(m));
 assert.equal(m.docOverflow,0);assert(m.rootScroll<=1,'Overlay must not need vertical scrolling');assert(m.cardScroll<=1,'Editable sheet must not need card scrolling '+JSON.stringify(m));assert(m.controls.x>=m.paper.x-.6&&m.controls.right<=m.paper.right+1.1,'Actions stay inside the paper corner '+JSON.stringify(m));assert(Math.abs(m.controls.y-m.paper.y-2)<1);assert.equal(m.buttons.length,2);assert(m.buttons[0].bottom+4<=m.buttons[1].y,'Close appears above print '+JSON.stringify(m));assert(Math.abs(m.buttons[0].x+m.buttons[0].width/2-m.buttons[1].x-m.buttons[1].width/2)<1);assert(m.scale>0&&m.scale<=1);
}
async function nativePrint(f,kind,width,height){
 const p=f.page,root=kind==='contract'?'#contract-overlay':'#zc76-receipt-overlay',before=await p.evaluate(()=>__docViewport.prints);
 await p.locator(root+' .snote-document-controls [data-document-print]').click();await p.waitForFunction(n=>__docViewport.prints===n+1,before);
 await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);await frames(p);
 const selector=kind==='contract'?'#contract-print-pages .contract-print-copy':'#zc76-receipt-paper';
 const papers=await p.locator(selector).evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),footer=e.querySelector('.ct-footer,.snote202-receipt-brand'),f=footer.getBoundingClientRect();return{width:r.width,height:r.height,zoom:getComputedStyle(e).zoom,footerBottom:f.bottom-r.top,overflow:e.scrollHeight-e.clientHeight};}));
 assert.equal(papers.length,kind==='contract'?2:1);for(const paper of papers){assert(Math.abs(paper.width-210*96/25.4)<1);assert(Math.abs(paper.height-297*96/25.4)<1);assert.equal(paper.zoom,'1');assert(paper.footerBottom<paper.height-20);}
 const file=path.join(OUT,kind+'-'+width+'x'+height+'.pdf'),pdf=await p.pdf({path:file,format:'A4',preferCSSPageSize:true,printBackground:true}),pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;assert.equal(pages,kind==='contract'?2:1);
 const plain=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}).replace(/\s/g,'');assert(plain.includes('합성자동차매매상사'));if(kind==='contract'){assert.equal((plain.match(/제11조/g)||[]).length,2);assert.equal((plain.match(/KMHXX00XXNU000001/g)||[]).length,2,'Full synthetic VIN must survive both native contract copies');assert.equal((plain.match(/검정색/g)||[]).length,2,'Color must survive both native contract copies');}else assert(plain.includes('자동차소유권이전완료후1년간보관'));
 await p.screenshot({path:path.join(OUT,kind+'-print-'+width+'.png'),fullPage:true});await p.emulateMedia({media:'screen'});await p.evaluate(()=>SnoteDocumentViewport.refresh());await frames(p);contained(await bounds(p,kind));return{pages,papers};
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const[width,height]of SIZES){const f=await setup(width,height),p=f.page;try{
 for(const kind of['contract','receipt']){await open(p,kind);const initial=await bounds(p,kind);contained(initial);await p.screenshot({path:path.join(OUT,kind+'-'+width+'x'+height+'.png')});
  await p.setViewportSize({width:height,height:width});await frames(p);contained(await bounds(p,kind));await p.setViewportSize({width,height});await frames(p);contained(await bounds(p,kind));
  const sourceId=kind==='contract'?'ct-buyer-name':'zc76-sign-name',mobile=await p.locator('[data-mobile-document-source="'+sourceId+'"]').count(),field=p.locator(mobile?'[data-mobile-document-source="'+sourceId+'"]':'#'+sourceId);await field.focus();await field.fill('수정 고객');assert.equal(await field.inputValue(),'수정 고객');contained(await bounds(p,kind));
  const print=await nativePrint(f,kind,width,height);results.push({width,height,kind,initial,print,passed:true});console.log('PASS viewport and native A4 '+kind+' '+width+'x'+height);
 }
 assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}}finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
