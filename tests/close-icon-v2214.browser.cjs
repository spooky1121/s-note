'use strict';
// Real close assets and actual app dialogs; all requests, accounts and data are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_CLOSE_ICON_ARTIFACT_DIR||'/workspace/work/close-icon-v2214/qa',ORIGIN='https://close-icon.example';
const selected=(process.env.SNOTE_CLOSE_ICON_CASE||'minimal,app').split(',');fs.mkdirSync(OUT,{recursive:true});
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const hashes=()=>Object.fromEntries(['index.html','assets/close-controls.js','assets/close-controls.css','tests/close-icon-v2214.browser.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
async function minimal(browser,{baseline=false,csp=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:600}}),p=await context.newPage(),requests=[],errors=[];
 const source=baseline?(process.env.SNOTE_CLOSE_ICON_BASELINE_DIR||path.join(OUT,'baseline')):path.join(ROOT,'assets');
 p.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());requests.push(u.pathname);assert.equal(u.origin,ORIGIN);
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',headers:csp?{'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'none'"}:{},body:'<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/close-controls.css"><style>body{font:16px sans-serif;background:#fff}#box{position:relative;width:320px;height:140px;border:1px solid #eee}#close{position:absolute;top:4px;right:4px}</style><script src="/close-controls.js" defer></script></head><body><section id="box"><input id="draft" value="keep"><button id="close" type="button" class="snote-popup-close" aria-label="창 닫기">×</button></section><script>window.clicks=0;document.getElementById("close").onclick=()=>{window.clicks++;document.getElementById("box").hidden=true}</script></body></html>'});
  if(u.pathname==='/close-controls.js'||u.pathname==='/close-controls.css')return route.fulfill({contentType:u.pathname.endsWith('.js')?'application/javascript':'text/css',body:fs.readFileSync(path.join(source,u.pathname.slice(1)))});
  if(u.pathname.endsWith('close-circle.svg'))return route.fulfill({status:503,contentType:'image/svg+xml',body:''});
  return route.abort();
 });
 try{
  await p.goto(ORIGIN,{waitUntil:'networkidle'});await p.waitForFunction(()=>!!SnoteCloseControls);
  const close=p.locator('#close');
  if(baseline){
   await p.waitForFunction(()=>document.querySelector('#close img')?.complete);
   const before=await close.evaluate(e=>({complete:e.firstElementChild.complete,naturalWidth:e.firstElementChild.naturalWidth,source:e.firstElementChild.src}));assert.equal(before.complete,true);assert.equal(before.naturalWidth,0);
   await p.evaluate(()=>SnoteCloseControls.refresh());await frames(p);
   const after=await close.evaluate(e=>({complete:e.firstElementChild.complete,naturalWidth:e.firstElementChild.naturalWidth}));assert.equal(after.naturalWidth,0,'Original refresh keeps the broken shared image');
   assert.equal(requests.filter(x=>x.endsWith('close-circle.svg')).length,1);await p.screenshot({path:path.join(OUT,'baseline-broken-390.png')});await close.click();assert.equal(await p.evaluate(()=>clicks),1);assert.deepEqual(errors,[]);
   return{name:'baseline external SVG 503 persists after refresh',before,after,assetRequests:1,syntheticOnly:true};
  }
  if(csp)await close.locator('span.snote-close-fallback').waitFor();else await image(p,'#close');
  const shape=await glyph(p,'#close');assert.equal(shape.fallback,csp);assert.equal(requests.filter(x=>x.endsWith('close-circle.svg')).length,0);
  if(csp){
   assert.equal(shape.background,'rgb(246, 55, 74)');assert.equal(shape.pseudoBefore.background,'rgb(255, 255, 255)');assert.equal(shape.pseudoAfter.background,'rgb(255, 255, 255)');assert.notEqual(shape.pseudoBefore.transform,shape.pseudoAfter.transform);
   const initial=await close.locator('span.snote-close-fallback').elementHandle();await p.evaluate(()=>{for(let n=0;n<8;n++)SnoteCloseControls.refresh()});await frames(p);assert.equal(await initial.evaluate(e=>e===document.querySelector('#close').firstElementChild),true,'CSP fallback must remain stable without image retry loops');
  }
  assert.equal(await p.locator('#draft').inputValue(),'keep');await p.screenshot({path:path.join(OUT,(csp?'csp-fallback':'embedded')+'-390.png')});await close.click();assert.equal(await p.evaluate(()=>clicks),1);assert.equal(await p.locator('#box').isVisible(),false);assert.deepEqual(errors,[]);
  return{name:csp?'CSP denies all images; CSS fallback closes normally':'Embedded image ignores unavailable external asset',shape,externalIconRequests:0};
 }finally{await context.close();}
}
async function image(p,selector){await p.waitForFunction(selector=>{const e=document.querySelector(selector)?.firstElementChild;return e?.matches('img.snote-close-image')&&e.complete&&e.naturalWidth===32&&e.getAttribute('src').startsWith('data:image/svg+xml');},selector);}
async function glyph(p,selector){
 return p.locator(selector).evaluate(button=>{const e=button.firstElementChild,r=button.getBoundingClientRect(),g=e.getBoundingClientRect(),style=getComputedStyle(e),before=getComputedStyle(e,'::before'),after=getComputedStyle(e,'::after');return{tag:e.tagName,fallback:e.classList.contains('snote-close-fallback'),label:button.getAttribute('aria-label'),hidden:button.hidden,children:button.childNodes.length,width:r.width,height:r.height,glyphWidth:g.width,glyphHeight:g.height,x:r.x,y:r.y,background:style.backgroundColor,color:style.color,source:e.getAttribute('src'),naturalWidth:e.naturalWidth||0,ariaHidden:e.getAttribute('aria-hidden'),pointerEvents:style.pointerEvents,pseudoBefore:{background:before.backgroundColor,transform:before.transform,width:before.width},pseudoAfter:{background:after.backgroundColor,transform:after.transform,width:after.width}};});
}
async function stable(p,selector){
 await image(p,selector);await p.locator(selector).evaluate(async e=>{const frame=e.closest('dialog,.vehicle-detail-frame,.snote-popup-frame,.snote-profile-panel');if(frame)await Promise.all(frame.getAnimations({subtree:true}).filter(a=>{const timing=a.effect?.getComputedTiming();return timing&&Number.isFinite(timing.endTime)&&timing.endTime<=2000;}).map(a=>a.finished.catch(()=>{})));});await frames(p);const s=await glyph(p,selector);assert.equal(s.children,1);assert.equal(s.width,30);assert.equal(s.height,30);assert.equal(s.glyphWidth,24);assert.equal(s.glyphHeight,24);assert.equal(s.ariaHidden,'true');assert.equal(s.pointerEvents,'none');assert(s.label?.length);return s;
}
async function openApp(browser,width){
 const requests=[];setBrowser({async newContext(options){const c=await browser.newContext(options),register=c.route.bind(c);let intercepted=false;c.route=async(pattern,handler,opts)=>{await register(pattern,handler,opts);if(pattern==='**/*'&&!intercepted){intercepted=true;await register('**/assets/close-circle.svg*',route=>{requests.push(route.request().url());return route.abort();});}};return c;}});
 const f=await fixture(width,null,{paymentAccountsRegistered:true,manualMessages:true});f.manualMessages=true;await f.context.route('**/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[]})}));return{...f,iconRequests:requests};
}
async function app(browser,width){
 const f=await openApp(browser,width),p=f.page,close='#vehicle-overlay .detail-close';
 try{
  const first=await stable(p,close);
  // Damaged src, replaced content, inherited cloned nodes and detached error listeners.
  await p.locator(close).evaluate(e=>e.querySelector('img').src='/assets/close-circle.svg?corrupt=1');await stable(p,close);
  await p.locator(close).evaluate(e=>e.textContent='×');await stable(p,close);
  await p.locator(close).evaluate(e=>{e.replaceChildren(e.firstElementChild.cloneNode(true));SnoteCloseControls.refresh();e.firstElementChild.dispatchEvent(new Event('error'));});
  await p.locator(close+' span.snote-close-fallback').waitFor();let fallback=await glyph(p,close);assert.equal(fallback.width,30);assert.equal(fallback.glyphWidth,24);assert.equal(fallback.background,'rgb(246, 55, 74)');
  await p.evaluate(()=>SnoteCloseControls.refresh());await frames(p);assert.equal(await p.locator(close+' span.snote-close-fallback').count(),1);
  await p.locator(close).click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>activeCarId),null);
  await p.evaluate(()=>{navigate('sell');navigate('buy');openVehicle('encar-car-1');});await p.locator('#vehicle-overlay.open').waitFor();
  await p.locator(close).evaluate(e=>e.textContent='×');await stable(p,close);
  for(let i=0;i<4;i++){await p.locator(close).click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});await p.evaluate(()=>openVehicle('encar-car-1'));await stable(p,close);}
  // Late dialogs keep identity, a native click handler and user-entered content.
  await p.evaluate(()=>{const d=document.createElement('dialog');d.id='close-v2214-dynamic';const b=document.createElement('button');b.type='button';b.className='snote-popup-close';b.setAttribute('aria-label','검증 창 닫기');b.textContent='×';window.__closeIdentity=b;window.__closeCount=0;b.onclick=()=>{__closeCount++;d.close();};d.innerHTML='<input value="retained" aria-label="검증 입력">';d.append(b);document.body.append(d);d.showModal();});
  const dynamic='#close-v2214-dynamic button.snote-popup-close';await stable(p,dynamic);assert.equal(await p.locator(dynamic).evaluate(e=>e===__closeIdentity),true);await p.locator('#close-v2214-dynamic input').fill('retained edit');
  await p.locator(dynamic).evaluate(e=>e.firstElementChild.dispatchEvent(new Event('error')));await p.locator(dynamic+' .snote-close-fallback').waitFor();await p.locator(dynamic).click();assert.equal(await p.evaluate(()=>__closeCount),1);assert.equal(await p.locator('#close-v2214-dynamic input').inputValue(),'retained edit');
  // A one-button notice must omit its close control after decoration and redraw.
  await p.evaluate(()=>{window.__closeNotice=SnoteMessages.alert('닫기 검증 안내');});await p.locator('#snote-message-dialog[open]').waitFor();
  await p.evaluate(()=>SnoteCloseControls.refresh());const notice=await p.locator('#snote-message-dialog [data-message-close]').evaluate(e=>({hidden:e.hidden,display:getComputedStyle(e).display,rects:e.getClientRects().length}));assert.equal(notice.hidden,true);assert.equal(notice.display,'none');assert.equal(notice.rects,0);
  await p.locator('#snote-message-dialog [data-message-accept]').click();await p.evaluate(()=>__closeNotice);
  await p.evaluate(()=>{window.__closeDecision=SnoteMessages.confirm('닫기 검증 확인');});await p.locator('#snote-message-dialog[open]').waitFor();await stable(p,'#snote-message-dialog [data-message-close]');await p.locator('#snote-message-dialog [data-message-close]').click();assert.equal(await p.evaluate(()=>__closeDecision),false);
  // Print and multiplication controls keep their original drawings.
  assert.equal(await p.locator('#snote-calculator-panel [data-calculator-key="*"] .snote-close-image').count(),0);
  assert.equal(await p.locator('[data-document-print] .snote-close-image').count(),0);
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(f.iconRequests.length<=1,true,'Only the deliberate corrupted src may request an external close asset');
  await p.screenshot({path:path.join(OUT,'actual-app-'+width+'.png')});await finish(f);return{name:'actual app '+width+' repeated/dynamic/error/hidden rules',width,first,fallback,notice,deliberateBlockedRequests:f.iconRequests.length,operatingWrites:0};
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-app-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  if(selected.includes('baseline'))results.push(await minimal(browser,{baseline:true}));
  if(selected.includes('minimal')){results.push(await minimal(browser));results.push(await minimal(browser,{csp:true}));}
  if(selected.includes('app'))for(const width of[1440,390])results.push(await app(browser,width));
  fs.writeFileSync(path.join(OUT,'results-'+selected.join('-')+'.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingRequests:0,operatingWrites:0,results,sourceHashes:hashes()},null,2));console.log('PASS close-icon-v2214 '+results.map(x=>x.name).join('; '));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
