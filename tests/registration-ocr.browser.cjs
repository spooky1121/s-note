'use strict';
// Actual index + synthetic registration image + intercepted OCR responses only.
// No original registration, Google OCR, production API, or database writes.
// Requires Playwright via NODE_PATH/local installation; Chromium may be configured.
// Run: NODE_PATH="$(npm root -g)" CHROMIUM_PATH=/usr/bin/chromium node tests/registration-ocr.browser.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://registration-ocr.example';
const executablePath=process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const CASES=[
 ['그랜저 ⑤ 형식 IG','그랜저'],
 ['그랜저⑤형 식 IG','그랜저'],
 ['쏘나타 ⑤ 형식 LF','쏘나타'],
 ['K5⑤형식 DL3','K5'],
 ['BMW X5 ⑤ 형식 G05','BMW X5'],
 ['SM5 ⑤ 형식 L43','SM5'],
 ['아이오닉5 ⑤ 형식 NE','아이오닉5'],
 ['모델 2025 ⑤ 형식 AB','모델 2025'],
 ['그랜저 (5) 형식 IG','그랜저'],
 ['BMW X5 [5] 형식 G05','BMW X5'],
 ['K5','K5'],['BMW X5','BMW X5'],['SM5','SM5'],
 ['아이오닉5','아이오닉5'],['아이오닉 5','아이오닉 5'],
 ['모델 2025','모델 2025'],['BMW X5 (2025)','BMW X5 (2025)'],
 // A bare ASCII 5 has lost its provenance and must not be trimmed by suffix alone.
 ['그랜저 5','그랜저 5']
];
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out '+label);}
(async()=>{
 const {parseDocument}=await import(pathToFileURL(path.join(ROOT,'functions/api/ocr.js')).href);
 const browser=await chromium.launch({executablePath,headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),external=[],errors=[],unexpected=[],calls=[];
 let model='',gate=null,annotation=null;
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==ORIGIN){external.push(url.href);return route.abort();}
  if(url.pathname==='/'){
   const source=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
   assert(source.includes('\ninitializeAuth();'));
   return route.fulfill({contentType:'text/html;charset=utf-8',body:source.replace('\ninitializeAuth();','\nwindow.__registrationFixtureAuth=initializeAuth();')});
  }
  if(url.pathname==='/api/ocr'){
   assert.equal(req.method(),'POST');assert.equal(req.headers().authorization,'Bearer fixture-only-ocr-session');assert.match(req.headers()['content-type'],/^image\//);
   const value=model,held=gate,synthetic=annotation;calls.push({model:value});if(held)await held.promise;
   const fields=synthetic?parseDocument(synthetic):{plate:'000가0000',model:value,year:'2025',vin:''};
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,engine:'google-vision',fields})});
  }
  const relative=url.pathname.slice(1);
  if(relative==='monthly.html'||relative.startsWith('assets/')){if(!fs.existsSync(path.join(ROOT,relative))){unexpected.push(url.pathname);return route.abort();}const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};return route.fulfill({contentType:types[path.extname(relative)]||'application/octet-stream',body:fs.readFileSync(path.join(ROOT,relative))});}
  unexpected.push(url.pathname);return route.abort();
 });
 try{
  await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__registrationFixtureAuth);await page.evaluate(()=>window.__registrationFixtureAuth);
  await page.evaluate(async()=>{const account=await getAccount('demo');if(!account)throw Error('Expected local sample dealer');await enterWorkspace(account);document.getElementById('zc-cloud-gate').hidden=true;
   // Fixture-only login surface: the actual OCR handler still processes the file,
   // reads a bearer token, validates the response, and updates the actual fields.
   window.zc86Cloud={ready:true,getAccessToken:async()=>'fixture-only-ocr-session'};
  });
  const helpers=await page.evaluate(cases=>cases.map(([raw])=>zc77Model(raw)),CASES);assert.deepEqual(helpers,CASES.map(([,expected])=>expected));
  assert.deepEqual(await page.evaluate(()=>['K5','BMW X5','SM5','아이오닉5','모델 2025'].map(snote201Canon)),['K5','BMWX5','SM5','아이오닉5','모델2025']);
  console.log('PASS raw marker boundaries before NFKC, real model digits/year and bare ASCII 5 preserved');

  // Exercise both text-only and geometry-backed local fallback candidate routes.
  const fallback=await page.evaluate(cases=>cases.map(([raw])=>{
   zc77ResetFieldState();let result={};zc77ReadGroup(result,{text:'차명 '+raw},1);zc77ApplyCandidates(result);const textOnly=document.getElementById('zc-auto-reg-model').value;
   zc77ResetFieldState();const words=[{text:'차명 '+raw,bbox:{x0:20,y0:30,x1:440,y1:54},confidence:99}],data={text:'차명 '+raw,blocks:[{paragraphs:[{lines:[{text:'차명 '+raw,words,bbox:{x0:20,y0:30,x1:440,y1:54}}]}]}]};result={};zc77ReadGroup(result,data,1);zc77ApplyCandidates(result);return [textOnly,document.getElementById('zc-auto-reg-model').value];
  }),CASES);assert.deepEqual(fallback,CASES.map(([,expected])=>[expected,expected]));
  console.log('PASS local text and positional fallback candidates retain original circled boundaries');

  async function begin(){await page.evaluate(async()=>{openAutoRegistration();const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,160,90);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const file=new File([blob],'synthetic-registration.png',{type:'image/png'});zcAutoRegFile=file;window.__registrationFixturePending=zc77RunAutoRegistrationOCR(file);});}
  for(const [raw,expected]of CASES){model=raw;await begin();await page.evaluate(()=>window.__registrationFixturePending);assert.equal(await page.locator('#zc-auto-reg-model').inputValue(),expected);assert.equal(await page.locator('#zc-auto-reg-model').getAttribute('data-ocr'),'review');}
  assert.equal(calls.length,CASES.length);console.log('PASS actual Google-response UI path sanitizes metadata and preserves K5/X5/SM5/아이오닉5/2025');

  gate=deferred();model='그랜저 ⑤ 형식 IG';const count=calls.length;await begin();await until(()=>calls.length===count+1,'synthetic OCR request');const manual='BMW X5 2025';await page.locator('#zc-auto-reg-model').fill(manual);gate.resolve();await page.evaluate(()=>window.__registrationFixturePending);gate=null;assert.equal(await page.locator('#zc-auto-reg-model').inputValue(),manual);
  await page.evaluate(()=>{const candidates={};zc77ReadGroup(candidates,{text:'차명 그랜저 ⑤ 형식 IG'},1);zc77ApplyCandidates(candidates);});assert.equal(await page.locator('#zc-auto-reg-model').inputValue(),manual);
  console.log('PASS user-edited model survives in-flight Google response and later fallback candidates');

  annotation={text:'차명 그랜저 ⑤ 형식 IG\n자동차등록번호 000가0000\n최초등록일 2025-01-01'};assert.equal(parseDocument(annotation).model,'그랜저');await begin();await page.evaluate(()=>window.__registrationFixturePending);assert.equal(await page.locator('#zc-auto-reg-model').inputValue(),'그랜저');const match=await page.evaluate(()=>snote201BestCatalog('그랜저'));assert(match,'Known sample catalogue must contain the original 그랜저 model');await page.evaluate(()=>continueAutoRegistration());assert.equal(await page.locator('#overlay').evaluate(el=>el.classList.contains('open')),true);assert.equal(await page.locator('#new-group').inputValue(),match.group);const hint=await page.locator('#snote201-model-match-hint').textContent();assert(hint.includes('등록증 인식 차명: 그랜저 ·'));assert(!hint.includes('그랜저 5'));
  console.log('PASS actual backend parser annotation → synthetic HTTP → actual OCR field → existing catalogue dropdown without fabricated trailing 5');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('ALL SYNTHETIC REGISTRATION OCR BROWSER CHECKS PASSED');
 }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
