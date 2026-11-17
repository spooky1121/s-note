'use strict';
// Actual browser/index/CAS + actual lookup Function and HTMLRewriter parser.
// All vehicles, accounts, search results, original pages and database replies are synthetic.
// Run: node tests/encar/plate-first.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright'),{fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_PLATE_FIRST_ARTIFACT_DIR||'/tmp/snote-encar-plate-first';
const FILES=['index.html','assets/snote-encar-link.js','functions/api/encar.js','functions/_shared/encar-catalog.mjs','tests/encar/browser-smoke.cjs','tests/encar/plate-first.browser.cjs'];
const hashes=()=>Object.fromEntries(FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const ACTOR='11111111-1111-4111-8111-111111111111',ALIAS='cld_'+ACTOR.replaceAll('-','').slice(0,18);
const CAR='encar-car-1',PLATE='12가3456',OTHER='34나5678',ID='43000001',SELLER='https://fem.encar.com/cars/detail/'+ID;
const SOURCE='https://nnov.trust-encar.ru/auto/'+ID+'/',ICON='.snote-list-encar[data-encar-car-id="'+CAR+'"]';
const ENV={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic_public_key',TAVILY_API_KEY:'synthetic_search_key'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const html=value=>new Response('<!doctype html><html><body>'+value+'</body></html>',{headers:{'Content-Type':'text/html;charset=utf-8'}});
const SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2h20v20H2z"/><circle cx="12" cy="12" r="4"/></svg>';
const RAW='## Hyundai Synthetic\n\n[Details]('+SOURCE+')\n\n현대 Synthetic\n\n'+PLATE+'\n\nЛот: '+ID;
const readable=()=>SVG+'<select><option>All<option>Hyundai</select><ul class="car-info"><li>Лот: '+ID+'<li>Номер автомобиля '+PLATE+'</ul>';
const unreadable=()=>'<main>'+SVG+'<p>Загрузка объявления</p><div id="app"></div></main>';
function cars(wrongModel=false){return[
 {id:CAR,ownerId:ALIAS,model:'가상 검증 차량 1',plate:PLATE,year:2026,km:'10,000',buy:1000,sell:1200,status:'판매중',make:'현대',...(wrongModel?{group:'잘못된 합성 모델',grade:'잘못된 합성 등급'}:{})},
 {id:'encar-car-2',ownerId:ALIAS,model:'가상 검증 차량 2',plate:OTHER,year:2026,km:'20,000',buy:1500,sell:1700,status:'판매중'}
];}
function createService(onRequest,{originalReadable=false}={}){
 const calls=[],replies=[],logs=[];let tail=Promise.resolve();
 async function run(request){
  const previousFetch=globalThis.fetch,previousInfo=console.info,pending=[];
  console.info=(...values)=>logs.push(values.join(' '));
  globalThis.fetch=async(value,options={})=>{
   const url=new URL(value),headers=new Headers(options.headers||{});calls.push({url:url.href,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
   if(url.origin===ENV.SUPABASE_URL&&url.pathname==='/auth/v1/user')return json({id:ACTOR});
   if(url.origin===ENV.SUPABASE_URL&&url.pathname==='/rest/v1/zc_members')return json([{user_id:ACTOR}]);
   if(url.href==='https://api.tavily.com/search'){
    const body=JSON.parse(options.body);assert.equal(body.exact_match,true);assert(body.query.includes('"'+PLATE+'"'),'The complete exact plate leads search discovery');
    return json({results:[{url:SOURCE,title:'Hyundai Synthetic',content:'현대 Synthetic '+PLATE,raw_content:RAW}]});
   }
   if(url.href===SELLER){assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);return new Response('<h1>서비스 이용 제한됨</h1>',{status:403});}
   if(url.href===SOURCE){assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);assert.equal(headers.get('apikey'),null);return html(originalReadable?readable():unreadable());}
   if(url.origin==='https://encar.spb.ru'){
    assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);
    if(url.pathname==='/')return html('<nav><a href="/catalog/">Каталог</a></nav><form method="post"><input name="brand"></form>');
    if(url.pathname==='/catalog/')return html('<h1>Каталог</h1><form method="post"><input name="brand"></form>');
   }
   throw Error('Unexpected synthetic upstream '+url.href);
  };
  try{
   const response=await onRequest({request,env:ENV,waitUntil(promise){pending.push(promise);}});await Promise.all(pending);
   const body=await response.json();replies.push({status:response.status,body});return{response,body};
  }finally{globalThis.fetch=previousFetch;console.info=previousInfo;}
 }
 return{calls,replies,logs,handle(request){const next=tail.then(()=>run(request));tail=next.catch(()=>{});return next;}};
}
function request(discovery){return new Request('https://encar-smoke.example/api/encar',{method:'POST',headers:{Authorization:'Bearer synthetic_plate_first_token_more_than_thirty_characters','Content-Type':'application/json'},body:JSON.stringify({plate:PLATE,candidateIds:[],discovery})});}
async function connect(f,service){await f.context.route('**/api/encar',async route=>{
 const req=route.request(),body=JSON.parse(req.postData()||'{}');f.requests.push(body);assert.equal(req.method(),'POST');assert.match(req.headers().authorization,/^Bearer [A-Za-z0-9._-]{30,}$/);
 const result=await service.handle(new Request(req.url(),{method:'POST',headers:{Authorization:req.headers().authorization,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return route.fulfill({status:result.response.status,contentType:'application/json',body:JSON.stringify(result.body)});
});}
async function prepare(f){
 const p=f.page;await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});if(navigate('buy')!==true)throw Error('Actual purchase route is required');});
 await p.locator('#list-query').fill('검증');if(p.viewportSize().width!==1440)await p.locator('#snote-vehicle-view-switch').click();
 const host=p.viewportSize().width===1440?'#list-table':'#list-mobile';assert.equal(await p.locator(ICON).count(),0);
 await p.locator(host+' [data-registration-car-id="'+CAR+'"]').click();await p.locator('#vehicle-encar-check:not([disabled])').waitFor();
 await p.locator('#detail-memo').fill('검색 자료 확인 중 보존할 메모');await p.locator('#detail-extra').fill('서버에 저장하지 않을 비고');
 return p.evaluate(()=>({query:document.getElementById('list-query').value,mode:document.getElementById('list-screen').dataset.vehicleView,
  peer:normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]}));
}
async function verifySearchIndex(f,{persisted=true}={}){
 const p=f.page,badge=p.locator('.snote-encar-external-status');await badge.waitFor({state:'visible'});
 assert.equal(await badge.textContent(),'검색 결과 확인');const tooltip=await badge.getAttribute('data-tooltip');
 assert.match(tooltip,/검색/);assert.match(tooltip,/차량번호/);assert.match(tooltip,/제조사/);assert.match(tooltip,/원문/);assert.match(tooltip,/현재 광고/);assert.match(tooltip,/미확인|확인하지 못/);assert(tooltip.includes(SOURCE));
 assert.equal(await p.locator('.snote-encar-price-apply').count(),0);assert.equal(await p.locator('.snote-encar-price-value').count(),0);assert.equal(await p.locator('#snote-encar-price-confirm').isVisible(),false);
 assert.equal(f.autoPriceRequests.length,0);assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);
 assert.deepEqual(await p.locator('.snote-encar-results a').evaluateAll(elements=>elements.map(element=>({href:element.href,target:element.target,rel:element.rel}))),[{href:SELLER,target:'_blank',rel:'noopener noreferrer'}]);
 if(!persisted)return;
 const record=await p.evaluate(()=>structuredClone(window.__encarFixtureCars[0].encarLinks)),item=record.listings[0];
 assert.equal(record.plate,PLATE);assert.equal(record.listings.length,1);assert.equal(item.id,ID);assert.equal(item.sellerUrl,SELLER);assert.equal(item.externalVerification.sourceUrl,SOURCE);
 assert.equal(item.externalVerification.method,'search-index');assert.equal(item.externalVerification.advertisedAt,null);assert.equal(item.externalVerification.modifiedAt,null);
 assert.equal(item.priceStatus,'unavailable');assert.equal(item.priceWon,null);return record;
}

(async()=>{
 fs.mkdirSync(ART,{recursive:true});const testedHashes=hashes(),results=[];
 await import(pathToFileURL(path.join(__dirname,'html-rewriter-setup.mjs')).href);
 const {onRequest}=await import(pathToFileURL(path.join(ROOT,'functions/api/encar.js')).href);
 const {parseExternalAdvertisement}=await import(pathToFileURL(path.join(ROOT,'functions/_shared/encar-catalog.mjs')).href);
 // Exercise the repaired native HTMLRewriter tree too: SVG self-closing nodes,
 // omitted li/option endings and a main detail info list without a heading.
 const parsed=await parseExternalAdvertisement('<html><body>'+readable()+'</body></html>',SOURCE,PLATE);
 assert.equal(parsed.matches.length,1);assert.equal(parsed.matches[0].id,ID);
 const repaired=createService(onRequest,{originalReadable:true}),native=await repaired.handle(request({make:'현대'}));
 assert.equal(native.body.status,'found');assert.equal(native.body.listings[0].externalVerification.method,undefined,'A directly parsed original retains its stronger original-page provenance');
 results.push({nativeSvgOptionalLiAndOptionFixed:true,actualApiParsedOriginal:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390,320]){
   const f=await fixture(width,cars(width===390)),p=f.page,service=createService(onRequest);let savedCars;
   try{
    const before=await prepare(f);await connect(f,service);await p.evaluate(()=>window.__encarFixtureWriteMode='hold');
    const opening=f.context.waitForEvent('page');await p.locator('#vehicle-encar-check').click();const popup=await opening;await popup.waitForURL(SELLER);await popup.close();
    await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);await verifySearchIndex(f,{persisted:false});
    assert.deepEqual(f.requests[0].discovery,width===390?{make:'현대',model:'잘못된 합성 모델',grade:'잘못된 합성 등급'}:{make:'현대'});
    assert.deepEqual(f.requests[0].candidateIds,[]);assert.equal(service.replies[0].body.status,'found');
    assert.equal(service.calls.filter(call=>call.url==='https://api.tavily.com/search').length,1);assert(service.calls.some(call=>call.url===SOURCE));assert(service.calls.some(call=>call.url===SELLER));
    assert(!service.calls.some(call=>new URL(call.url).origin==='https://encar.spb.ru'),'An exact plate/manufacturer index result needs no model catalogue walk');
    assert.equal(await p.locator(ICON).count(),0);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);
    await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});
    await p.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();
    // Verify while the original detail is still open, before any close/navigate
    // that could hide a stale list by triggering its own repaint.
    await p.waitForFunction(id=>['list-table','list-mobile'].every(host=>document.querySelectorAll('#'+host+' .snote-list-encar[data-encar-car-id="'+id+'"]').length===1),CAR);
    const record=await verifySearchIndex(f);assert.equal(await p.evaluate(()=>activeCarId),CAR);assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');
    assert.equal(await p.locator('.snote-list-encar:not([data-encar-car-id="'+CAR+'"])').count(),0);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
    assert.equal(await p.locator('#detail-memo').inputValue(),'검색 자료 확인 중 보존할 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'서버에 저장하지 않을 비고');
    assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].vehicleMemo),undefined);assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),undefined);
    assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),before.peer);
    assert.equal(await p.locator('#list-query').inputValue(),before.query);assert.equal(await p.locator('#list-screen').getAttribute('data-vehicle-view'),before.mode);
    const denied=await p.evaluate(async({record,id})=>{const bridge=window.snoteEncarLinksBridge,context=bridge.context('encar-car-1'),errors={};for(const kind of['autoPrice','applyPrice','changePrice'])try{
     if(kind==='autoPrice')await bridge.autoPrice(context,record,{listingId:id});else if(kind==='changePrice')await bridge.changePrice(context,record,id,{expectedSellWon:12000000});else await bridge.applyPrice(context,record,id);errors[kind]=null;
    }catch(error){errors[kind]=error.code||error.message;}return errors;},{record,id:ID});
    assert(Object.values(denied).every(Boolean),'Search-index provenance cannot enter any price acquisition or mutation bridge');assert.equal(f.autoPriceRequests.length,0);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
    savedCars=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));await p.screenshot({path:path.join(ART,'plate-first-'+width+'.png')});await finish(f);
   }catch(error){await f.context.close();throw error;}
   const restored=await fixture(width,savedCars);
   try{await verifySearchIndex(restored);assert.equal(restored.requests.length,0);assert.equal(await restored.page.evaluate(()=>window.__encarFixtureWrites.length),0);await finish(restored);}catch(error){await restored.context.close();throw error;}
   results.push({width,actualApiParserIndexAndCas:true,makeOnly:width!==390,wrongModelAndGradeIgnored:width===390,exactSameBlockPlateMakerAndId:true,
    unreadableOriginalClearlyLabelled:true,noOcrOrPriceMutation:true,liveIconAfterAck:true,provenanceRestored:true,peerAndDraftsPreserved:true});
   console.log('PASS '+width+'px plate/manufacturer-first search evidence, truthful unreadable-original label, scoped ACK/live icons and restored provenance with no price actions');
  }
 }finally{await browser.close();}
 assert.deepEqual(hashes(),testedHashes,'Application, resolver, parser and fixture must remain unchanged throughout the integration run');
 fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),syntheticOnly:true,actualApiAndParser:true,sourceHashes:testedHashes,results},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
