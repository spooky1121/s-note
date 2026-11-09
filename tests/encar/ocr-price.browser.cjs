'use strict';
// Current app/real OCR bridge + synthetic auth, PNG upload and OCR responses.
// This does not send the user's inline image to Google or assert live OCR success.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_OCR_ARTIFACT_DIR||'/tmp/snote-encar-price-ocr';
const TOKEN='synthetic-local-ocr-session-token-12345',WON=54900000;
const candidate=(id='price-1',display='5,490만원',priceWon=WON)=>({id,display,priceWon});
const response=(candidates=[candidate()])=>({ok:true,purpose:'encar-price',engine:'google-vision',requiresConfirmation:true,candidates});
fs.mkdirSync(ART,{recursive:true});
async function setup(width){
 const f=await fixture(width),p=f.page,state={requests:[],responses:[],hold:null};
 await p.evaluate(token=>{
  window.__encarFixtureState.client.auth.getSession=async()=>({data:{session:{access_token:token,user:window.__encarFixtureState.user}},error:null});
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__ocrFixtureURLs={created:[],revoked:[]};
  URL.createObjectURL=blob=>{const url=create(blob);window.__ocrFixtureURLs.created.push(url);return url;};
  URL.revokeObjectURL=url=>{window.__ocrFixtureURLs.revoked.push(url);return revoke(url);};
 },TOKEN);
 await f.context.route('**/api/ocr?purpose=encar-price',async route=>{
  const req=route.request(),headers=req.headers(),bytes=req.postDataBuffer();
  assert.equal(req.method(),'POST');assert.equal(headers.authorization,'Bearer '+TOKEN);assert.equal(headers['content-type'],'image/png');
  assert(bytes&&bytes.length>32,'The test must upload real PNG bytes');assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  state.requests.push({bytes:bytes.length});const next=state.responses.shift();assert(next,'Every OCR request requires an explicit synthetic response');
  if(state.hold){const gate=state.hold;state.hold=null;gate.entered();await gate.promise;}
  try{await route.fulfill({status:next.status||200,contentType:'application/json',body:JSON.stringify(next.body)});}catch(error){if(!/closed|disposed|aborted|handled/i.test(error.message))throw error;}
 });
 const png=Buffer.from(await p.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=180;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,600,180);x.fillStyle='#111';x.font='48px sans-serif';x.fillText('5,490만원',30,105);return c.toDataURL('image/png').split(',')[1];}),'base64');
 const image={name:'synthetic-advertised-price.png',mimeType:'image/png',buffer:png};
 const dialog=p.locator('#snote-encar-price-ocr'),file=dialog.locator('#encar-price-ocr-file'),read=dialog.getByRole('button',{name:'캡처에서 금액 찾기',exact:true}),apply=dialog.getByRole('button',{name:'금액 확인 후 입력',exact:true});
 return{...f,state,image,dialog,file,read,apply,reply(body=response(),status=200){state.responses.push({body,status});},async open(){await p.locator('#vehicle-encar-price-ocr').click();await dialog.waitFor({state:'visible'});},async upload(name=image.name){const link=dialog.locator('.encar-price-ocr-original'),prior=await link.getAttribute('href');await file.setInputFiles({...image,name});await dialog.locator('img').waitFor({state:'visible'});const href=await link.getAttribute('href');assert.match(href,/^blob:/);assert.equal(href,await dialog.locator('img').getAttribute('src'));assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');if(prior){assert.notEqual(href,prior);assert((await p.evaluate(()=>window.__ocrFixtureURLs.revoked)).includes(prior),'Replacing a capture revokes its previous original link');}},async close(){await dialog.locator('.snote-popup-close').click();await dialog.waitFor({state:'hidden'});assert.equal(await dialog.locator('.encar-price-ocr-original').getAttribute('href'),null,'Closing clears the original capture link');},hold(){let release,entered;const promise=new Promise(r=>release=r),ready=new Promise(r=>entered=r);state.hold={promise,entered};return{release,ready};}};
}
async function done(f){assert.equal(f.state.responses.length,0,'All queued OCR responses are used');await finish(f);}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{
  for(const width of[1440,390,320]){
   const f=await setup(width),p=f.page;
   try{
    await p.locator('#detail-memo').fill('OCR 전 작성한 메모');await p.locator('#detail-extra').fill('OCR 전 기타 비고');
    const before=await p.evaluate(()=>({sell:cars[0].sell,peer:normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0],writes:window.__encarFixtureWrites.length}));
    await f.open();await p.keyboard.press('Escape');await f.dialog.waitFor({state:'hidden'});assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false','Escape closes only the OCR dialog');
    await f.open();assert.equal(await f.read.isDisabled(),true);assert.equal(await f.apply.isDisabled(),true);
    await f.upload();f.reply();await f.read.click();await f.dialog.getByRole('radio').waitFor();
    assert.equal(await f.dialog.getByRole('radio').count(),1);assert.equal(await f.dialog.getByRole('radio').isChecked(),false,'Even one OCR amount requires explicit user review');assert.equal(await f.apply.isDisabled(),true);
    assert.match(await f.dialog.textContent(),/5,490만원/);assert.match(await f.dialog.textContent(),/54,900,000원/);assert.match(await f.dialog.textContent(),/OCR/);
    await f.dialog.getByRole('radio').check();assert.equal(await f.apply.isEnabled(),true);
    const geometry=await f.dialog.evaluate(el=>({overflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:el.scrollWidth>el.clientWidth}));assert.equal(geometry.overflow,false);assert.equal(geometry.dialogOverflow,false);
    await p.screenshot({path:path.join(ART,'ocr-price-candidate-'+width+'.png')});
    await f.apply.click();await f.dialog.getByText(/판매예정가에 입력했습니다/).waitFor();
    assert.equal(await p.locator('#detail-sell').inputValue(),'54,900,000');assert.equal(await p.locator('#detail-memo').inputValue(),'OCR 전 작성한 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'OCR 전 기타 비고');
    assert.equal(await p.evaluate(()=>cars[0].sell),before.sell);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),before.writes,'Applying OCR must fill only a draft');
    await f.close();assert.equal(await f.dialog.locator('img').evaluateAll(es=>es.every(el=>!el.getAttribute('src'))),true);const urls=await p.evaluate(()=>window.__ocrFixtureURLs);assert(urls.created.every(url=>urls.revoked.includes(url)),'Closing releases preview URLs');
    await p.locator('#vehicle-header-save').click();await p.waitForFunction(won=>SnoteMoney.car(window.__encarFixtureCars[0]).sell===won,WON);
    const stored=await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]));assert.equal(stored.sell,WON);assert.equal(stored.vehicleMemo,'OCR 전 작성한 메모');assert.equal(stored.extra,'OCR 전 기타 비고');assert(!JSON.stringify(stored).includes('synthetic-advertised-price.png'));assert(!Object.hasOwn(stored,'ocrImage'));
    assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),before.peer);
    await done(f);results.push({width,explicitReview:true,wonConversion:true,draftOnly:true,normalSave:true,otherDraftsAndPeerPreserved:true,previewReleased:true,geometry});console.log('PASS '+width+'px OCR PNG upload, explicit candidate review, KRW draft application, normal save and preview cleanup');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;
   try{
    await f.open();await f.upload();f.reply();await f.read.click();await f.dialog.getByRole('radio').check();assert.equal(await f.apply.isEnabled(),true);
    await p.evaluate(()=>cars[0].status='판매완료');await p.waitForFunction(()=>document.querySelector('#snote-encar-price-ocr .encar-price-ocr-apply').disabled);assert.equal(await p.locator('#detail-sell').inputValue(),'12,000,000');
    await p.evaluate(()=>cars[0].status='판매중');await p.waitForFunction(()=>!document.querySelector('#snote-encar-price-ocr .encar-price-ocr-apply').disabled);await f.close();
    // This isolates the read-only UI presentation; server membership enforcement
    // is exercised by the actual bridge's independent role tests.
    await p.evaluate(()=>{window.__ocrOriginalBridge=window.snoteEncarPriceOcrBridge;window.snoteEncarPriceOcrBridge={...window.__ocrOriginalBridge,context(){const c=window.__ocrOriginalBridge.context();return c?{...c,canWrite:false}:null;}};});
    await f.open();await f.upload();f.reply();await f.read.click();await f.dialog.getByRole('radio').check();assert.equal(await f.apply.isDisabled(),true);await f.apply.evaluate(el=>el.click());assert.equal(await p.locator('#detail-sell').inputValue(),'12,000,000');
    await f.close();await done(f);results.push({width:390,soldApplyDisabled:true,readOnlyUiDisabled:true});console.log('PASS OCR sold-state and read-only view cannot apply a selected candidate');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;
   try{
    await f.open();await f.upload();f.reply();await f.read.click();await f.dialog.getByRole('radio').check();
    await p.evaluate(()=>{window.__ocrOriginalBridge=window.snoteEncarPriceOcrBridge;window.snoteEncarPriceOcrBridge={...window.__ocrOriginalBridge,async apply(...args){window.__ocrApplyWaiting=true;await new Promise(resolve=>window.__ocrReleaseApply=resolve);return window.__ocrOriginalBridge.apply(...args);}};});
    await f.apply.click();await p.waitForFunction(()=>window.__ocrApplyWaiting);await f.close();await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-2');window.__ocrOtherSell=document.getElementById('detail-sell').value;window.__ocrReleaseApply();});await p.waitForTimeout(200);assert.equal(await p.locator('#detail-sell').inputValue(),await p.evaluate(()=>window.__ocrOtherSell));assert.equal(await f.dialog.getByRole('radio').count(),0);
    await p.evaluate(()=>window.snoteEncarPriceOcrBridge=window.__ocrOriginalBridge);await f.open();await f.upload();const held=f.hold();f.reply();await f.read.click();await held.ready;const before=await p.locator('#detail-sell').inputValue();
    await p.evaluate(()=>currentUser={...currentUser});held.release();await f.dialog.waitFor({state:'hidden'});await p.waitForTimeout(150);assert.equal(await p.locator('#detail-sell').inputValue(),before);assert.equal(await f.dialog.getByRole('radio').count(),0);
    await done(f);results.push({width:390,lateApplyCannotAffectNextVehicle:true,actorResetLateReadIgnored:true});console.log('PASS OCR late apply and changed actor cannot write or annotate the next scope');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;
   try{
    await f.open();await f.upload();f.reply(response([candidate(),candidate('price-2','850만원',8500000)]));await f.read.click();await p.waitForFunction(()=>document.querySelectorAll('#snote-encar-price-ocr input[type=radio]').length===2);
    assert.equal(await f.dialog.getByRole('radio',{checked:true}).count(),0);assert.equal(await f.apply.isDisabled(),true);await f.dialog.getByRole('radio').nth(1).check();assert.equal(await f.apply.isEnabled(),true);
    await f.upload('second-synthetic.png');assert.equal(await f.dialog.getByRole('radio').count(),0);assert.equal(await f.apply.isDisabled(),true);
    const calls=f.state.requests.length;await f.file.setInputFiles({name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')});assert.equal(await f.read.isDisabled(),true);assert.equal(f.state.requests.length,calls);
    await f.file.setInputFiles({name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(6*1024*1024+1)});assert.equal(await f.read.isDisabled(),true);assert.equal(f.state.requests.length,calls);
    await f.upload();f.reply(response([]));await f.read.click();await f.dialog.getByText(/만원|금액/).first().waitFor();await p.waitForFunction(()=>!document.querySelector('#snote-encar-price-ocr [aria-busy=true]'));assert.equal(await f.dialog.getByRole('radio').count(),0);assert.equal(await f.apply.isDisabled(),true);
    await f.upload('mismatch.png');f.reply(response([candidate('price-1','5,490만원',5490000)]));await f.read.click();await p.waitForFunction(()=>!document.querySelector('#snote-encar-price-ocr [aria-busy=true]'));assert.equal(await f.dialog.getByRole('radio').count(),0);assert.equal(await f.apply.isDisabled(),true);
    assert(!String(await f.dialog.textContent()).includes('<img'));await f.close();await done(f);results.push({width:390,multipleReview:true,fileChangeResets:true,invalidFilesNoRequest:true,noCandidateAndMalformedFailClosed:true});console.log('PASS OCR multiple candidates, file reset, MIME/size guards and malformed/no-price responses');
   }catch(error){await f.context.close();throw error;}
  }
  {
   const f=await setup(390),p=f.page;
   try{
    await f.open();await f.upload();const held=f.hold();f.reply();await f.read.click();await held.ready;
    await f.close();held.release();await p.waitForTimeout(150);assert.equal(await f.dialog.getByRole('radio').count(),0);
    await f.open();await f.upload();const changed=f.hold();f.reply();await f.read.click();await changed.ready;await f.upload('replacement.png');changed.release();await p.waitForTimeout(150);assert.equal(await f.dialog.getByRole('radio').count(),0);assert.equal(await f.apply.isDisabled(),true);
    const moved=f.hold();f.reply();await f.read.click();await moved.ready;
    await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});openVehicle('encar-car-2');});moved.release();await f.dialog.waitFor({state:'hidden'});const other=await p.locator('#detail-sell').inputValue();await p.waitForTimeout(200);assert.equal(await p.locator('#detail-sell').inputValue(),other);assert.equal(await f.dialog.getByRole('radio').count(),0);
    await done(f);results.push({width:390,closeAborts:true,fileChangeAborts:true,vehicleSwitchLateReadIgnored:true});console.log('PASS OCR close/file change/vehicle switch abort and ignore late OCR responses');
   }catch(error){await f.context.close();throw error;}
  }
 }finally{await browser.close();}
 const files=['index.html','assets/encar-price-ocr.js','assets/encar-price-ocr.css','tests/encar/ocr-price.browser.cjs'];fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')])),results,syntheticOnly:true,liveGoogleOrUserInlineImageTested:false},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
