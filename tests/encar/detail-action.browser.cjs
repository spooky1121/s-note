'use strict';
// Current page, permanent header button and scoped persistence; all HTTP/auth/data
// are synthetic. No real Encar, Supabase, customer or SMS requests are made.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_DETAIL_ACTION_ARTIFACT_DIR||'/tmp/snote-encar-detail-action';
const id='43000001',sellerUrl='https://fem.encar.com/cars/detail/'+id,trustedUrl='https://fem.encar.com/cars/detail/43000002';
const response={status:'found',plate:'12가3456',verifiedAt:new Date().toISOString(),listings:[{id,model:'합성 광고 차량',sellerUrl,trustedId:'43000002',trustedUrl}]};
fs.mkdirSync(ART,{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const results=[];
 try{for(const width of[1440,390,320]){
  const f=await fixture(width),p=f.page,button=p.locator('#vehicle-encar-check');
  try{
   assert.match(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),/id="vehicle-encar-check"[^>]*disabled>/,'The header action exists before any script initializes');
   assert.equal(await p.locator('.snote-encar-button').count(),1);assert.equal(await button.isVisible(),true);assert.equal(await button.isEnabled(),true);
   const geometry=await button.evaluate(el=>{const r=el.getBoundingClientRect(),img=el.querySelector('img');return{width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el,logo:img.complete&&img.naturalWidth>0,inHeader:el.parentElement.id==='vehicle-header-actions',overflow:document.documentElement.scrollWidth>innerWidth};});
   assert(geometry.width>=40&&geometry.height>=40&&geometry.hit&&geometry.logo&&geometry.inHeader);assert.equal(geometry.overflow,false);
   f.reply(response);const opening=f.context.waitForEvent('page');await button.click();const popup=await opening;await popup.waitForURL(sellerUrl);await popup.close();
   await p.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();
   const saved=await p.evaluate(()=>window.__encarFixtureCars[0].encarLinks);assert.equal(saved.listings[0].sellerUrl,sellerUrl);assert.equal(saved.listings[0].trustedUrl,trustedUrl);
   assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
   await p.evaluate(()=>{closeVehicle({discard:true});openVehicle('encar-car-1');});
   await p.locator('.snote-encar-results a').first().waitFor();assert.equal(f.requests.length,1,'Saved URLs must reopen without another lookup');assert.equal(await button.isVisible(),true);
   assert.deepEqual(await p.locator('.snote-encar-results a').evaluateAll(es=>es.map(e=>e.href)),[sellerUrl,trustedUrl]);
   await p.evaluate(()=>{closeVehicle({discard:true});cars[0].status='판매완료';openVehicle('encar-car-1');});await button.waitFor({state:'hidden'});
   assert.equal(await p.locator('.snote-encar-results a').count(),2,'Previously verified links remain accessible in sold details');
   await p.evaluate(()=>{closeVehicle({discard:true});cars[0].status='판매중';openVehicle('encar-car-1');});await button.waitFor({state:'visible'});assert.equal(await button.isEnabled(),true);
   f.reply({status:'error',diagnostics:{code:'DETAIL_BLOCKED'}},502);const failing=f.context.waitForEvent('page');await button.click();const failedPopup=await failing;
   if(!failedPopup.isClosed())await failedPopup.waitForEvent('close');await p.locator('#vehicle-encar-check:not([disabled])').waitFor();
   assert.match(await p.locator('.snote-encar-note').textContent(),/제한/);assert.equal(await p.locator('.snote-encar-results a').count(),2);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
   assert.equal(await p.locator('.snote-encar-button').count(),1);await p.screenshot({path:path.join(ART,'encar-restored-'+width+'.png')});
   results.push({width,permanentButton:true,geometry,lookup:true,scopedDatabaseSave:true,savedLinksReopen:true,soldHiddenAndInventoryRestored:true,failedRecheckPreservesLinks:true});
   await finish(f);console.log('PASS '+width+'px permanent Encar action, lookup, database save, reopen, sold/inventory transition and failed recheck');
  }catch(error){await f.context.close();throw error;}
 }}finally{await browser.close();}
 const files=['index.html','assets/snote-encar-link.js','tests/encar/detail-action.browser.cjs'];fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),sourceHashes:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')])),results,syntheticOnly:true},null,2)+'\n');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
