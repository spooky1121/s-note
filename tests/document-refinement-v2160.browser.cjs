'use strict';
// Actual app and physical A4 output with synthetic accounts, logos and intake responses.
// No live account, customer, SMS, external page or database is accessed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://encar-smoke.example';
const OUT=process.env.DOCUMENT_REFINEMENT_ARTIFACT_DIR||'/workspace/work/docs-v2160/browser';fs.mkdirSync(OUT,{recursive:true});
const widths=(process.env.DOCUMENT_REFINEMENT_WIDTHS||'1440,390,320').split(',').map(Number),FOCUS=process.env.DOCUMENT_REFINEMENT_FOCUS||'all';
const MM=96/25.4,results=[],compact=text=>String(text).replace(/\s/gu,'');
const SIGNATURE={version:1,strokes:[[[.08,.7],[.18,.2],[.35,.72],[.58,.22],[.85,.65]],[[.15,.85],[.9,.8]]]};
const DETAIL={children:'two',business:'invoice',privacyConsent:true,insuranceConfirmed:true,delegationConfirmed:true,cashConfirmed:true,consentVersion:'receipt-v1'};
const CLEAR={children:'none',business:'cash',privacyConsent:false,insuranceConfirmed:false,delegationConfirmed:false,cashConfirmed:false,consentVersion:'receipt-v1'};
const BANK={bank:'가'.repeat(35),number:'0'+'1234567890'.repeat(3)+'1',holder:'나'.repeat(60)};
async function setup(width){
 const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;
 await f.context.route('https://synthetic.supabase.co/rest/v1/rpc/snote_payment_accounts_read',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,cache-control,pragma'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const scope=await p.evaluate(()=>({user_id:__encarFixtureState.user.id,company_id:__encarFixtureState.company.id}));
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({...scope,revision:1,accounts:{vehicle:BANK,transfer:BANK}})});
 });
 await f.context.route(ORIGIN+'/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[]})}));
 await p.evaluate(async()=>{
  window.__docRefinement={prints:0};window.print=()=>{__docRefinement.prints++;};
  const logo=document.createElement('canvas');logo.width=192;logo.height=64;const blue=logo.getContext('2d');blue.fillStyle='#226bd5';blue.fillRect(0,0,192,64);blue.fillStyle='white';blue.font='bold 24px sans-serif';blue.fillText('SYNTHETIC',12,41);
  const stamp=document.createElement('canvas');stamp.width=96;stamp.height=96;const red=stamp.getContext('2d');red.strokeStyle='#ce2334';red.lineWidth=6;red.strokeRect(8,8,80,80);red.fillStyle='#ce2334';red.font='bold 23px sans-serif';red.fillText('TEST',16,55);
  const url=async canvas=>URL.createObjectURL(await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));
  __docRefinement.logo=await url(logo);__docRefinement.stamp=await url(stamp);window.snoteLoadDocumentLogo=async()=>__docRefinement.logo;window.snoteLoadDocumentStamp=async()=>__docRefinement.stamp;
  const S=__encarFixtureState;S.company={...S.company,name:'합성 자동차 매매상사',business_address:'경기도 고양시 일산동구 합성로 123번길 45',business_number:'1234567890',business_phone:'0311234567'};currentUser.company=S.company.name;
  cars[0].model='Tesla Model Y';cars[0].extra='견적서 표시 검증';openVehicle(cars[0].id);
 });return f;
}
async function nextFrame(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function quoteContent(f,width){
 const p=f.page;await p.evaluate(()=>openQuotePreview());await p.locator('#quote-overlay.open').waitFor();await p.waitForFunction(()=>!document.querySelector('[data-snote-payment-row="transfer"]').hidden);
 assert.equal(await p.locator('#quote-insurance').inputValue(),'0');assert.equal(await p.locator('#quote-customer').inputValue(),'VIP');assert.equal(await p.locator('#quote-customer').evaluate(e=>getComputedStyle(e).textAlign),'center');
 assert.equal(await p.locator('#quote-dealer').textContent(),'담당자: 가상 검증 딜러');assert.match(await p.locator('#quote-car-name').inputValue(),/Tesla/,'Legitimate English vehicle names must be preserved');
 const text=await p.locator('#quote-paper').innerText();assert(!/PURCHASE QUOTATION|VEHICLE PURCHASE|VEHICLE DETAILS|PRICE BREAKDOWN|PAYMENT INFORMATION|VEHICLE PAYMENT|TRANSFER & REGISTRATION|담당자 안내용 견적서|차량 정보와 비용을|취득세·공채·이전 관련 비용/u.test(text));
 assert.equal(await p.locator('#quote-paper .q8-topline,#quote-paper .q8-en,#quote-paper .q8-bank-en,#quote-paper .q8-info-note').count(),0);
 const cards=await p.locator('#quote-paper > .q8-section').evaluateAll(es=>es.filter(e=>!e.hidden).map(e=>({title:e.querySelector('h2')?.textContent,radius:parseFloat(getComputedStyle(e).borderRadius),border:parseFloat(getComputedStyle(e).borderTopWidth),padding:parseFloat(getComputedStyle(e).paddingLeft),top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})));
 assert.deepEqual(cards.map(c=>c.title),['차량 정보','항목별 비용','입금 안내']);assert(cards.every(c=>c.radius>=6&&c.border>=.5&&c.padding>0),'The three semantic sections must have distinct complete card surfaces');
 for(let i=1;i<cards.length;i++)assert(cards[i].top>cards[i-1].bottom,'Cards must remain visually separated');
 const banks=await p.locator('.q8-bank-card:not([hidden])').evaluateAll(es=>es.map(e=>({info:e.querySelector('.q8-bank-line').getBoundingClientRect().bottom,money:e.querySelector('.q8-bank-money').getBoundingClientRect().top,inside:e.querySelector('.q8-bank-money').getBoundingClientRect().bottom<=e.getBoundingClientRect().bottom+.6})));
 assert.equal(banks.length,2);assert(banks.every(b=>b.money>=b.info&&b.inside),'Account information must appear above its amount in each payment card');
 await p.locator('#quote-insurance').fill('123,456');await p.locator('#quote-insurance').dispatchEvent('input');assert.equal(await p.locator('#quote-insurance').inputValue(),'123,456');
 await p.evaluate(()=>{closeQuotePreview();openVehicle(cars[0].id);});await p.evaluate(()=>openQuotePreview());await p.locator('#quote-overlay.open').waitFor();assert.equal(await p.locator('#quote-insurance').inputValue(),'0','Every fresh quotation must reset insurance to zero');
 await p.screenshot({path:path.join(OUT,'quote-screen-'+width+'.png')});results.push({kind:'quotation content and cards',width,passed:true});return '#quote-paper';
}
async function openDocument(p,kind){
 return p.evaluate(async({kind,signature,detail})=>{
  if(document.getElementById('quote-overlay').classList.contains('open'))closeQuotePreview();
  if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});
  if(!document.getElementById('zc76-receipt-overlay').hidden)await zc76CloseReceipt({discard:true});
  openVehicle(cars[0].id);const car=cars[0];const person={ownerId:currentUser.username,carId:car.id,name:'합성 인쇄 고객',phone:'01012345678',address:'경기도 고양시 일산동구 합성로 123번길 45 합성아파트 101동 1001호',mailing:'서울특별시 강남구 합성대로 123-45 합성빌딩 12층',refundBank:'합성은행',refundAccount:'0001234567890',refundHolder:'합성 고객',customerSignature:signature,customerSignatureSignedAt:'2026-11-17T00:00:00Z',receiptDetails:detail};
  if(kind==='quote'){await openQuotePreview();return;}
  if(kind==='receipt'){await zc76OpenReceipt(person,car);return;}
  openContractPreview({loadCustomer:false});document.getElementById('ct-buyer-name').value=person.name;document.getElementById('ct-buyer-phone').value=person.phone;document.getElementById('ct-buyer-address').value=person.address;document.getElementById('ct-special').value='차량 상태와 성능점검 기록을 확인하고 인도합니다.\n이전등록 비용을 정산한 뒤 차액을 환급합니다.';fitContractSpecial();snote222ContractSignature.set(person);
 },{kind,signature:SIGNATURE,detail:DETAIL});
}
async function paperMetrics(p,selector){
 return p.locator(selector).evaluateAll(papers=>papers.map(paper=>{
  const rect=paper.getBoundingClientRect(),footer=paper.querySelector('.q8-bottom,.ct-footer,.snote202-receipt-brand'),foot=footer?.getBoundingClientRect(),brand=footer?.querySelector('.snote-document-brand'),company=footer?.querySelector('.snote-document-logo'),round=n=>Math.round(n*100)/100;
  const shown=e=>{for(let n=e;n&&n!==paper.parentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return false;}const r=e.getBoundingClientRect();return r.width>0&&r.height>0;},boxes=[];
  const inFooter=e=>!!e.closest('.q8-bottom,.ct-footer,.snote202-receipt-brand');const walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){if(!node.textContent.trim()||!shown(node.parentElement))continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height)boxes.push({label:node.textContent.trim().slice(0,80),left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top,footer:inFooter(node.parentElement)});}
  for(const e of paper.querySelectorAll('input,textarea,img')){if(!shown(e))continue;const r=(e.closest('.snote-document-brand')||e).getBoundingClientRect();boxes.push({label:e.value||e.alt||e.id,left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top,footer:inFooter(e)});}
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{left:round(r.left-rect.left),right:round(r.right-rect.left),top:round(r.top-rect.top),bottom:round(r.bottom-rect.top),width:round(r.width),height:round(r.height)};};
  return{width:round(rect.width),height:round(rect.height),zoom:getComputedStyle(paper).zoom,escaping:boxes.filter(b=>b.left<-.6||b.right>rect.width+.6||b.top<-.6||b.bottom>rect.height+.6),footerOverlap:boxes.filter(b=>!b.footer&&b.bottom>foot.top-rect.top-8+.6),footer:box(footer),brand:box(brand),company:box(company),images:[...footer.querySelectorAll('img')].filter(shown).map(img=>({class:img.className,src:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth,height:img.naturalHeight})),bodyBottom:round(Math.max(...boxes.filter(b=>!b.footer).map(b=>b.bottom))),bottomInkMargin:round(rect.height-Math.max(...boxes.map(b=>b.bottom)))};
 }));
}
async function printDocument(f,kind,width){
 const p=f.page;if(kind!=='quote')await openDocument(p,kind);
 const before=await p.evaluate(()=>__docRefinement.prints);await p.evaluate(async kind=>{if(kind==='quote')await printQuote();else if(kind==='contract')await printContract();else await zc76PrintReceipt();},kind);
 assert.equal(await p.evaluate(()=>__docRefinement.prints),before+1,'The real '+kind+' print entry must pass validation');
 await p.emulateMedia({media:'print'});await p.evaluate(()=>document.fonts.ready);await nextFrame(p);
 const selector=kind==='quote'?'#quote-paper':kind==='contract'?'#contract-print-pages .contract-print-copy':'#zc76-receipt-paper',metrics=await paperMetrics(p,selector);
 assert.equal(metrics.length,kind==='contract'?2:1);const logo=await p.evaluate(()=>__docRefinement.logo);
 for(const m of metrics){assert(Math.abs(m.width-210*MM)<1&&Math.abs(m.height-297*MM)<1,kind+' physical A4 size');assert.equal(m.zoom,'1');assert.deepEqual(m.escaping,[],kind+' must keep text, fields and imagery within paper');assert.deepEqual(m.footerOverlap,[],kind+' body must clear footer');assert(m.brand&&m.brand.width>0,'Static SNOTE brand must be visible at left');assert(m.company&&m.company.width>0,'Company logo must be visible');assert(m.brand.right<m.company.left,'SNOTE must sit to the left of the company logo');assert(m.brand.left<=m.footer.left+1,'SNOTE brand must align to the left edge of the common footer');assert(m.images.some(i=>i.src===logo&&i.complete&&i.width===192),'Corporate logo must be the decoded current company asset');assert(m.images.some(i=>/(?:^|\/)assets\/snote-logo\.png$/.test(i.src)&&i.complete&&i.width>0),'SNOTE static logo must survive print');assert(m.bottomInkMargin>=6*MM-.6,'Common branding must retain a practical physical bottom margin');}
 const filename=kind+'-'+width,pdfFile=path.join(OUT,filename+'.pdf'),pdf=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:pdfFile}),pages=(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
 assert.equal(pages,kind==='contract'?2:1,'Actual '+kind+' PDF page count');const text=execFileSync('pdftotext',['-layout',pdfFile,'-'],{encoding:'utf8'}),plain=compact(text);fs.writeFileSync(path.join(OUT,filename+'.txt'),text);
 assert(plain.includes('합성자동차매매상사'),'Printed footer must retain the current company name');
 if(kind==='quote'){assert(plain.includes('차량구매견적서')&&plain.includes('입금안내'));assert(!/VEHICLE|QUOTATION|PRICE BREAKDOWN|담당자안내용/.test(text));assert(plain.includes(BANK.bank)&&plain.includes(BANK.number)&&plain.includes(BANK.holder),'Maximum saved bank fields must survive actual quote PDF');}
 if(kind==='contract'){assert.equal((plain.match(/제11조/g)||[]).length,2);assert(plain.includes(BANK.number)&&plain.includes(BANK.holder),'Maximum receiving fields must survive both contract PDFs');}
 if(kind==='receipt'){assert(plain.includes('현금영수증발급동의및확인서'));assert(!/CUSTOMER DOCUMENT|고객원제출서명이있으면/.test(plain));assert(plain.includes(compact(await p.locator('#zc76-delivery-at').inputValue())),'The complete default handover time must survive actual PDF output');}
 await p.screenshot({path:path.join(OUT,filename+'-print.png'),fullPage:true});results.push({kind:kind+' A4 output',width,pages,metrics,passed:true});await p.emulateMedia({media:'screen'});
}
async function receiptDefaults(f,width){
 const p=f.page;await openDocument(p,'receipt');const value=await p.locator('#zc76-delivery-at').inputValue();
 const expected=await p.evaluate(()=>{const x=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return x.year+'년 '+x.month+'월 '+x.day+'일 '+x.hour+'시 '+x.minute+'분';});assert.equal(value,expected,'Receipt handover date/time must start at the current Korean time');
 const before=await p.locator('#zc76-receipt-paper').evaluate(e=>getComputedStyle(e,'::before').content);assert(!/S-NOTE|CUSTOMER/.test(before));assert.equal(await p.locator('#zc76-receipt-paper .zc76-hint').count(),0);
 assert.equal(await p.locator('[name="zc76-children"]:checked').inputValue(),'two');assert.equal(await p.locator('[name="zc76-biz"]:checked').inputValue(),'invoice');
 assert.equal(await p.locator('#zc76-delivery-at').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'The default full handover date/time must fit its field');
 for(const id of ['zc76-confirm-insurance','zc76-delegation','zc76-cash-confirm'])assert.equal(await p.locator('#'+id).isChecked(),true);
 results.push({kind:'receipt fields/current Korean time',width,passed:true});
}
async function saleLayout(f,width){
 const p=f.page;await p.evaluate(async()=>{if(!document.getElementById('zc76-receipt-overlay').hidden)await zc76CloseReceipt({discard:true});if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});closeQuotePreview();openVehicle(cars[0].id);await openSaleProgress();});await p.locator('#zc72-sale-modal').waitFor({state:'visible'});
 await p.locator('#zc72-address').fill('경기도 고양시 일산동구 합성로 123번길 45 합성아파트 101동 1001호');await p.locator('#zc72-mailing').fill('서울특별시 강남구 합성대로 123-45 합성빌딩 12층');await nextFrame(p);
 const geometry=await p.evaluate(()=>{const ids=['zc72-name','zc72-rrn','zc72-phone','zc72-address','zc72-mailing','zc74-refund-bank','zc74-refund-account','zc74-refund-holder'];return{overflow:document.documentElement.scrollWidth>innerWidth,fields:Object.fromEntries(ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return[id,{x:r.x,right:r.right,width:r.width,height:r.height,tag:e.tagName,overflow:e.scrollWidth>e.clientWidth+.6}];}))};});
 assert.equal(geometry.overflow,false);for(const [id,r]of Object.entries(geometry.fields)){assert(r.x>=0&&r.right<=width+.6,id+' must fit sale dialog');assert(r.height>=32,id+' must retain a usable input height');}
 assert.equal(geometry.fields['zc72-address'].tag,'TEXTAREA');assert(geometry.fields['zc72-address'].height>=48);assert(width<360?geometry.fields['zc72-address'].width*geometry.fields['zc72-address'].height>geometry.fields['zc72-name'].width*geometry.fields['zc72-name'].height:geometry.fields['zc72-address'].width>geometry.fields['zc72-name'].width,'Address must have greater readable capacity than the compact name');
 for(const id of ['zc72-address','zc72-mailing'])assert.deepEqual(await p.locator('#'+id).evaluate(e=>({clipped:e.scrollHeight>e.clientHeight+1,top:e.scrollTop})),{clipped:false,top:0},'A normal full address must show its first and last lines: '+id);
 await p.evaluate(()=>zc74LoadCustomer({name:'주소 자동 배치 검증',phone:'01012345678',addressBase:'경기도 고양시 일산동구 합성로 123번길 45 합성아파트 101동 1001호 고객지원센터',mailingBase:'서울특별시 강남구 합성대로 123-45 합성빌딩 12층 고객지원센터',sameAddress:false}));await nextFrame(p);
 const fitMetric=e=>({clipped:e.scrollHeight>e.clientHeight+1,height:e.getBoundingClientRect().height,max:parseFloat(getComputedStyle(e).maxHeight),overflow:getComputedStyle(e).overflowY,top:e.scrollTop});
 const assertFit=(m,label)=>{assert.equal(m.top,0,label+' must start at its first line');if(m.clipped){assert(m.height>=m.max-1,label+' must grow to its intended maximum before scrolling');assert.equal(m.overflow,'auto',label+' must retain access to capped longer text');}else assert.equal(m.overflow,'hidden',label+' must show normal addresses without internal scrolling');};
 for(const id of ['zc72-address','zc72-mailing'])assertFit(await p.locator('#'+id).evaluate(fitMetric),'Programmatic '+id);
 assert.equal(await p.locator('#zc72-address').inputValue(),'경기도 고양시 일산동구 합성로 123번길 45 합성아파트 101동 1001호 고객지원센터','Autosizing must not truncate any address data');
 await p.locator('#zc74-same-address').check();await nextFrame(p);assert.equal(await p.locator('#zc72-mailing').inputValue(),await p.locator('#zc72-address').inputValue());assertFit(await p.locator('#zc72-mailing').evaluate(fitMetric),'Same-address mailing copy');
 if(width<650){await p.setViewportSize({width:width===390?320:390,height:950});await nextFrame(p);for(const id of ['zc72-address','zc72-mailing'])assertFit(await p.locator('#'+id).evaluate(fitMetric),'Resized '+id);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.setViewportSize({width,height:950});await nextFrame(p);}
 await p.screenshot({path:path.join(OUT,'sale-'+width+'.png')});results.push({kind:'sale field layout',width,geometry,passed:true});await p.evaluate(()=>closeSaleProgress());
}
async function loginLayout(f,width){
 const p=await f.context.newPage();await p.goto(ORIGIN,{waitUntil:'networkidle'});await p.locator('#zc-cloud-submit').waitFor({state:'visible'});const metric=await p.locator('#zc-cloud-submit').evaluate(e=>{const r=e.getBoundingClientRect(),text=[...e.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()),range=document.createRange();range.selectNodeContents(text);const b=range.getBoundingClientRect();return{style:getComputedStyle(e).textAlign,centerDelta:Math.abs((b.left+b.right)-(r.left+r.right))/2,button:r.width,text:b.width};});assert(metric.centerDelta<1.5,'Login text must be physically centered independently of the right arrow');await p.screenshot({path:path.join(OUT,'login-'+width+'.png')});results.push({kind:'login label centering',width,metric,passed:true});await p.close();
}
async function publicIntake(browser,width,{all=true}={}){
 const context=await browser.newContext({viewport:{width,height:950}}),p=await context.newPage(),requests=[],unexpected=[],errors=[];p.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.origin!==ORIGIN){unexpected.push(u.href);return route.abort();}
  if(u.pathname==='/api/customer-intake'){
   const body=JSON.parse(request.postData());requests.push(body);assert.equal(request.method(),'POST');assert.equal(body.flowVersion,'wizard-v1');
   const response=body.action==='info'?{ok:true,status:'pending',flowVersion:'wizard-v1',rrnEnabled:true,companyName:'합성 자동차 매매상사',phoneMasked:'010-****-5678',expiresAt:'2027-01-01T00:00:00Z',car:{model:'합성 문자 입력 차량',plate:'12가3456',year:2026,km:10000,sellWon:12000000}}:
    body.action==='send-code'?{ok:true,challengeId:'11111111-1111-4111-8111-111111111111',expiresAt:new Date(Date.now()+300000).toISOString(),retryAfter:1}:
    body.action==='verify'?{ok:true,session:'b'.repeat(64),phone:'01012345678'}:body.action==='submit'?{ok:true,submittedAt:new Date().toISOString()}:null;
   assert(response,'No real SMS or unexpected customer action: '+body.action);return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
  }
  const file=path.resolve(ROOT,u.pathname.slice(1));if((u.pathname==='/customer.html'||u.pathname.startsWith('/assets/'))&&file.startsWith(ROOT+path.sep)&&fs.existsSync(file)){const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});}
  unexpected.push(u.pathname);return route.abort();
 });
 try{
  await p.goto(ORIGIN+'/customer.html#'+'a'.repeat(64),{waitUntil:'networkidle'});await p.locator('#stage-car').waitFor({state:'visible'});await p.locator('#vehicle-confirmed').check();await p.locator('#vehicle-next').click();await p.locator('#customer-name').fill('합성 문자 고객');await p.locator('#wizard-next').click();await p.locator('#rrn-front').fill('900101');await p.locator('#rrn-back').fill('1234567');await p.locator('#wizard-next').click();await p.locator('#address-base').fill('서울특별시 강남구 합성대로 123-45');await p.locator('#address-detail').fill('합성빌딩 12층');await p.locator('#wizard-next').click();await p.locator('#customer-phone').fill('01012345678');await p.locator('#request-code').click();await p.locator('#verification-code:not([disabled])').waitFor();await p.locator('#verification-code').fill('123456');await p.locator('#verify-button').click();await p.locator('[data-wizard-step="refund"]').waitFor({state:'visible'});
  assert.equal(await p.locator('[name="receipt-children"]:checked').count(),0,'An unspecified child count must not be inferred');assert.equal(await p.locator('[name="receipt-business"]:checked').count(),0,'Business status must be an explicit customer choice');
  await p.locator('[name="receipt-children"][value="'+(all?'two':'none')+'"]').check();await p.locator('[name="receipt-business"][value="'+(all?'invoice':'cash')+'"]').check();await p.locator('#refund-bank').fill('합성은행');await p.locator('#refund-account').fill('0001234567890');await p.locator('#refund-holder').fill('합성 문자 고객');await p.locator('#wizard-next').click();await p.locator('[data-wizard-step="consent"]').waitFor({state:'visible'});
  const ids=['required-consent','refund-consent','receipt-insurance-confirmed','receipt-delegation-confirmed','receipt-cash-confirmed'];for(const id of ['receipt-privacy-consent',...ids])assert.equal(await p.locator('#'+id).isChecked(),false,'New consent must initially be unchecked: '+id);
  await p.locator('#receipt-privacy-consent').check();for(const id of ids)assert.equal(await p.locator('#'+id).isChecked(),true,'Explicit all-consent must check its lower items: '+id);
  await p.locator('#receipt-privacy-consent').uncheck();for(const id of ids)assert.equal(await p.locator('#'+id).isChecked(),false,'Revoking the master choice must clear its lower items: '+id);
  if(all)await p.locator('#receipt-privacy-consent').check();else{await p.locator('#required-consent').check();await p.locator('#refund-consent').check();}
  const canvas=p.locator('#signature-canvas');await canvas.scrollIntoViewIfNeeded();const r=await canvas.boundingBox();await p.mouse.move(r.x+r.width*.15,r.y+r.height*.7);await p.mouse.down();await p.mouse.move(r.x+r.width*.35,r.y+r.height*.2,{steps:8});await p.mouse.move(r.x+r.width*.65,r.y+r.height*.7,{steps:8});await p.mouse.up();assert.match(await p.locator('#signature-status').textContent(),/입력되었습니다/);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(OUT,'customer-consent-'+width+'-'+all+'.png'),fullPage:true});await p.locator('#submit-customer').click();await p.locator('#stage-success').waitFor({state:'visible'});
  const submission=requests.find(r=>r.action==='submit');assert(submission);assert.deepEqual(submission.customer.receiptDetails,all?DETAIL:CLEAR);assert.equal(submission.customer.refundAccount,'0001234567890');assert.equal(submission.consent,true);assert.equal(submission.refundConsent,true);assert(submission.signature.strokes.length>0);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);results.push({kind:'public customer explicit receipt fields and consent snapshot',width,all,passed:true});console.log('PASS public customer '+width+' explicit receipt fields all='+all);return submission;
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-public-'+width+'-'+all+'.png'),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
}
async function importedReceipt(){
 const f=await setup(1440),p=f.page,phone='01012345678';
 await p.evaluate(()=>{
  const S=__encarFixtureState,original=S.client.from.bind(S.client),state=window.__docCustomer={row:null,writes:[],holdRead:false,readWaiting:false};
  S.client.from=table=>{if(table!=='zc_customers')return original(table);const filters={};const chain={select(){return chain;},eq(key,value){filters[key]=value;return chain;},limit(){return chain;},maybeSingle(){return chain;},single(){return chain;},then(resolve,reject){return(async()=>{
   if(state.holdRead){state.holdRead=false;state.readWaiting=true;await new Promise(resolve=>state.releaseRead=resolve);state.readWaiting=false;}
   const row=state.row&&Object.entries(filters).every(([key,value])=>state.row[key]===value)?structuredClone(state.row):null;return{data:row,error:null};
  })().then(resolve,reject);}};return chain;};
 });
 await f.context.route('https://synthetic.supabase.co/rest/v1/rpc/snote_customer_save',async route=>{
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,cache-control,pragma'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const args=JSON.parse(route.request().postData());assert.equal(route.request().method(),'POST');assert.match(route.request().headers().authorization,/^Bearer /);assert.equal(args.p_company,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(args.p_owner,'11111111-1111-4111-8111-111111111111');assert.equal(args.p_car_id,'encar-car-1');
  const saved=await p.evaluate(args=>{const state=__docCustomer,updatedAt=new Date(Date.now()+state.writes.length).toISOString();if(args.p_expected_updated_at!==(state.row?.updated_at??null))throw Error('Synthetic customer CAS mismatch');state.writes.push(structuredClone(args));state.row={company_id:args.p_company,owner_id:args.p_owner,car_id:args.p_car_id,payload:structuredClone(args.p_payload),has_rrn:args.p_has_rrn,updated_at:updatedAt,restore_generation:args.p_expected_generation};return{ok:true,updatedAt,restoreGeneration:args.p_expected_generation};},args);
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(saved)});
 });
 const saveSelected=()=>p.evaluate(async()=>{
  const record={ownerId:currentUser.username,carId:activeCarId,name:document.getElementById('zc72-name').value,phone:document.getElementById('zc72-phone').value,address:document.getElementById('zc72-address').value};Object.assign(record,window.snoteIntakeSignatureForSave(record));await zc72Write(record);return structuredClone(__docCustomer.row);
 });
 const submission=detail=>({name:'합성 문자 고객',phone,addressBase:'서울특별시 강남구 합성대로 123-45',addressDetail:'합성빌딩 12층',sameAddress:true,mailingBase:'서울특별시 강남구 합성대로 123-45',mailingDetail:'합성빌딩 12층',refundBank:'합성은행',refundAccount:'0001234567890',refundHolder:'합성 문자 고객',receiptDetails:detail,signature:SIGNATURE,signedAt:'2026-11-18T00:00:00.000Z'});
 let items=[{id:'11111111-2222-4333-8444-555555555555',status:'submitted',submittedAt:'2026-11-18T00:00:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',hasRrn:false,canonicalApplied:false,phone,submission:submission(DETAIL)}],holdRead=false,readPending=false,releaseRead;
 await f.context.route(ORIGIN+'/api/customer-intake',async route=>{
  const body=JSON.parse(route.request().postData());if(body.action==='list')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:items})});
  assert.equal(body.action,'read-rrn');if(holdRead){readPending=true;await new Promise(resolve=>releaseRead=resolve);readPending=false;}try{await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,rrn:'9001011234567'})});}catch{}
 });
 try{
  const malformed=await p.evaluate(detail=>[undefined,{consent:true},{...detail,privacyConsent:'true'},{...detail,unknown:true},{...detail,consentVersion:'old'}].map(value=>window.snote160ReceiptDetails(value)),DETAIL);assert.deepEqual(malformed,[null,null,null,null,null]);
  await p.evaluate(async()=>{openVehicle(cars[0].id);await openSaleProgress();});await p.waitForFunction(()=>document.getElementById('zc72-name').value==='합성 문자 고객');await p.locator('#snote-sale-receipt-details').waitFor({state:'visible'});
  const selected=()=>p.evaluate(()=>window.snoteIntakeSignatureForSave({ownerId:currentUser.username,carId:activeCarId,name:document.getElementById('zc72-name').value,phone:document.getElementById('zc72-phone').value}));
  let metadata=await selected();assert.deepEqual(metadata.receiptDetails,DETAIL);assert.deepEqual(metadata.customerSignature,SIGNATURE);let canonical=await saveSelected();assert.deepEqual(canonical.payload.receiptDetails,DETAIL);assert.deepEqual(canonical.payload.intakeSource,metadata.intakeSource);assert.deepEqual(canonical.payload.customerSignature,metadata.customerSignature);
  await p.evaluate(async metadata=>{await zc76OpenReceipt({...metadata,ownerId:currentUser.username,carId:activeCarId,name:'합성 문자 고객',phone:'01012345678'},cars[0]);},metadata);assert.equal(await p.locator('[name="zc76-children"]:checked').inputValue(),'two');assert.equal(await p.locator('[name="zc76-biz"]:checked').inputValue(),'invoice');assert.equal(await p.locator('[name="zc76-privacy-consent"]:checked').inputValue(),'yes');
  for(const id of ['zc76-confirm-insurance','zc76-delegation','zc76-cash-confirm'])assert.equal(await p.locator('#'+id).isChecked(),true);
  await p.evaluate(async()=>{await zc76CloseReceipt({discard:true});closeSaleProgress();});items=[{...items[0],id:'22222222-3333-4444-8555-666666666666',submittedAt:'2026-11-19T00:00:00.000Z',submission:submission(CLEAR)}];
  await p.evaluate(()=>openSaleProgress());await p.locator('#snote-sale-receipt-details').waitFor({state:'visible'});await p.waitForFunction(()=>document.getElementById('snote-sale-receipt-details').textContent.includes('없음'));
  metadata=await selected();assert.deepEqual(metadata.receiptDetails,CLEAR,'A newer explicitly unchecked submission must override older checked consent metadata');canonical=await saveSelected();assert.deepEqual(canonical.payload.receiptDetails,CLEAR);assert.deepEqual(canonical.payload.intakeSource,metadata.intakeSource,'The unchecked receipt must remain attached to its own immutable submitted original');
  await p.evaluate(async metadata=>{await zc76OpenReceipt({...metadata,ownerId:currentUser.username,carId:activeCarId,name:'합성 문자 고객',phone:'01012345678'},cars[0]);},metadata);assert.equal(await p.locator('[name="zc76-children"]:checked').inputValue(),'none');assert.equal(await p.locator('[name="zc76-biz"]:checked').inputValue(),'cash');assert.equal(await p.locator('[name="zc76-privacy-consent"]:checked').count(),0);for(const id of ['zc76-confirm-insurance','zc76-delegation','zc76-cash-confirm'])assert.equal(await p.locator('#'+id).isChecked(),false);
  await p.evaluate(async()=>{await zc76CloseReceipt({discard:true});closeSaleProgress();});items=[{...items[0],id:'44444444-5555-4666-8777-888888888888',submittedAt:'2026-11-20T00:00:00.000Z',submission:submission(DETAIL)}];await p.evaluate(()=>openSaleProgress());await p.waitForFunction(()=>document.getElementById('snote-sale-receipt-details').textContent.includes('2자녀'));metadata=await selected();assert.deepEqual(metadata.receiptDetails,DETAIL);
  await p.evaluate(()=>{const record={ownerId:currentUser.username,carId:activeCarId,name:document.getElementById('zc72-name').value,phone:document.getElementById('zc72-phone').value};Object.assign(record,window.snoteIntakeSignatureForSave(record));__docCustomer.holdRead=true;window.__docCustomerHeldSave=zc72Write(record).then(()=>({saved:true}),error=>({saved:false,message:error.message}));});await p.waitForFunction(()=>__docCustomer.readWaiting);await p.evaluate(()=>{closeSaleProgress();__docCustomer.releaseRead();});const rejected=await p.evaluate(()=>window.__docCustomerHeldSave);assert.equal(rejected.saved,false,'Closing the imported selection while the latest customer read is pending must reject saving its receipt');assert.match(rejected.message,/선택한 고객 접수 정보가 변경/);assert.equal(await p.evaluate(()=>__docCustomer.writes.length),2,'A stale selected original must be rejected before issuing the customer-save RPC');assert.deepEqual(await p.evaluate(()=>__docCustomer.row.payload.receiptDetails),CLEAR,'The canonical unchecked receipt and original bundle must remain unchanged after rejection');
  await p.evaluate(async()=>{await zc76OpenReceipt({ownerId:currentUser.username,carId:activeCarId,name:'기존 동의 없는 고객',phone:'01012345678',customerSignature:{version:1,strokes:[[[.1,.2],[.7,.8]]]}},cars[0]);});assert.equal(await p.locator('#zc76-receipt-paper input[type="checkbox"]:checked,#zc76-receipt-paper input[type="radio"]:checked').count(),0,'Old generic signatures must not imply any newly added consent');
  await p.evaluate(async()=>{await zc76CloseReceipt({discard:true});closeSaleProgress();});items=[{...items[0],id:'33333333-4444-4555-8666-777777777777',hasRrn:true,submission:submission(DETAIL)}];holdRead=true;await p.evaluate(()=>openSaleProgress());await p.waitForFunction(()=>document.getElementById('snote-intake-panel').textContent.includes('불러오는 중'));
  for(let i=0;!readPending&&i<100;i++)await p.waitForTimeout(10);assert(readPending);await p.evaluate(()=>{closeSaleProgress();openVehicle(cars[1].id);});items=[];await p.evaluate(()=>openSaleProgress());releaseRead();await p.waitForTimeout(100);assert.equal(await p.locator('#zc72-name').inputValue(),'');assert.equal(await p.locator('#snote-sale-receipt-details').isVisible(),false,'Late prior-car receipt choices must not attach to the new car');assert.equal(await selected(),null);await p.evaluate(()=>closeSaleProgress());
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Importing submitted metadata and previewing receipts must not write vehicles');results.push({kind:'authenticated selected receipt snapshot/unchecked clearing/legacy/stale car',passed:true});await finish(f);console.log('PASS authenticated imported receipt metadata: checked/unchecked/legacy and stale-car isolation');
 }catch(error){releaseRead?.();await p.screenshot({path:path.join(OUT,'failure-import.png'),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of ['intake','import'].includes(FOCUS)?[]:widths){const f=await setup(width);try{
  if(['all','quote-content','quote-print'].includes(FOCUS)){await quoteContent(f,width);if(FOCUS==='all'||FOCUS==='quote-print')await printDocument(f,'quote',width);if(FOCUS==='all'){await printDocument(f,'contract',width);await receiptDefaults(f,width);await printDocument(f,'receipt',width);await saleLayout(f,width);}if(FOCUS!=='quote-print')await loginLayout(f,width);}
  if(FOCUS==='sale')await saleLayout(f,width);
  await finish(f);console.log('PASS document refinement '+width+' '+FOCUS);
 }catch(error){await f.page.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
 if(FOCUS==='all'||FOCUS==='intake'){await publicIntake(browser,390,{all:true});await publicIntake(browser,320,{all:false});}if(['all','intake','import'].includes(FOCUS))await importedReceipt();
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,FOCUS==='all'?'results.json':'results-'+FOCUS+'.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,results},null,2)+'\n');}}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
