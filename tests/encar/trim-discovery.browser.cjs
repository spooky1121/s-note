'use strict';
// Browser -> actual lookup Function + HTML parser -> actual index/CAS bridge.
// Every account, vehicle, upstream HTTP response and database response is synthetic.
// Run: node tests/encar/trim-discovery.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_TRIM_ARTIFACT_DIR||'/tmp/snote-encar-trim-catalog';
const FILES=['index.html','assets/release-info.js','assets/snote-encar-link.js','functions/api/encar.js','functions/_shared/encar-catalog.mjs','tests/encar/browser-smoke.cjs','tests/encar/trim-discovery.browser.cjs'];
const hashes=()=>Object.fromEntries(FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const ACTOR='11111111-1111-4111-8111-111111111111',ALIAS='cld_'+ACTOR.replaceAll('-','').slice(0,18);
const PLATE='12가3456',OTHER='34나5678',ID='43000001',CAR='encar-car-1',SELLER='https://fem.encar.com/cars/detail/'+ID;
const CATALOG='https://encar.spb.ru',MODEL='/catalog/tesla/model-y/',GENERATION=MODEL+'model-y/',TRIM=GENERATION+'long-range-awd/';
const DISCOVERY={make:'테슬라',model:'모델 Y',grade:'롱레인지'};
const ENV={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic_public_key',TAVILY_API_KEY:'synthetic_search_key'};
const ICON='.snote-list-encar[data-encar-car-id="'+CAR+'"]';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const html=body=>new Response('<!doctype html><html><body>'+body+'</body></html>',{headers:{'Content-Type':'text/html;charset=utf-8'}});
function card(id,plate){return '<div class="catalog-card"><div class="card-header"><h2><a href="/auto/'+id+'/">Tesla Model Y Long Range AWD</a></h2></div><div class="card-body"><p>Номер автомобиля '+plate+'</p><p>Лот: '+id+'</p><p>В продаже</p></div></div>';}
function catalogue(pathname,branches){
 if(pathname==='/')return '<nav><a href="/catalog/">Каталог</a></nav><form method="post"><input name="brand"><button>Показать</button></form>';
 if(pathname==='/catalog/')return '<h1>Каталог</h1><a href="/catalog/tesla/">Tesla <span class="count">400</span></a><form method="post"><input name="brand"><button>Показать</button></form>';
 if(pathname==='/catalog/tesla/')return '<h1>Tesla</h1><a href="'+MODEL+'">Model Y <span class="count">200</span></a><a href="/catalog/tesla/model-3/">Model 3</a>';
 if(pathname===MODEL)return '<h1>Tesla Model Y</h1>'+(branches?'<nav aria-label="Поколение"><a href="'+GENERATION+'">Model Y <span class="count">120</span></a></nav>':'')+card('43000002',OTHER);
 if(pathname===GENERATION)return '<h1>Tesla Model Y</h1><nav aria-label="Комплектация"><a href="'+TRIM+'">Long Range AWD <span class="count">40</span></a></nav>'+card('43000003',OTHER);
 if(pathname===TRIM)return '<h1>Tesla Model Y Long Range AWD</h1>'+card('43000004',OTHER)+card(ID,PLATE);
 throw Error('The fixture has no observed public catalogue page '+pathname);
}
function official(id){return '<!doctype html><script>window.__PRELOADED_STATE__ = '+JSON.stringify({cars:{base:{vehicleId:Number(id),queryCarId:Number(id),vehicleNo:OTHER,advertisement:{status:'ADVERTISE'},manage:{dummy:false,dummyVehicleId:null},category:{manufacturerName:'테슬라',modelName:'합성 모델 Y'},spec:{mileage:12345}}}})+';</script>';}
function cars(){return[
 {id:CAR,ownerId:ALIAS,model:'가상 검증 차량 1',plate:PLATE,year:2026,km:'10,000',buy:1000,sell:1200,status:'판매중',make:DISCOVERY.make,group:DISCOVERY.model,generation:'모델 Y',grade:DISCOVERY.grade},
 {id:'encar-car-2',ownerId:ALIAS,model:'가상 검증 차량 2',plate:OTHER,year:2026,km:'20,000',buy:1500,sell:1700,status:'판매중'}
];}
function createService(onRequest,{branches=true,searchConfigured=true}={}){
 const env={...ENV,TAVILY_API_KEY:searchConfigured?ENV.TAVILY_API_KEY:''},calls=[],replies=[],logs=[];let tail=Promise.resolve();
 const service={branches,calls,replies,logs,handle(request){const next=tail.then(()=>run(request));tail=next.catch(()=>{});return next;}};
 async function run(request){
  const previousFetch=globalThis.fetch,previousInfo=console.info,pending=[];let search=0;
  console.info=(...values)=>logs.push(values.join(' '));
  globalThis.fetch=async(value,options={})=>{
   const url=new URL(value),headers=new Headers(options.headers||{});calls.push({url:url.href,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
   if(url.origin===ENV.SUPABASE_URL&&url.pathname==='/auth/v1/user')return json({id:ACTOR});
   if(url.origin===ENV.SUPABASE_URL&&url.pathname==='/rest/v1/zc_members')return json([{user_id:ACTOR}]);
   if(url.origin===CATALOG){
    assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);assert.equal(headers.get('apikey'),null);
    assert.equal(url.search,'','Only actual observed branch URLs are followed');return html(catalogue(url.pathname,service.branches));
   }
   if(url.href==='https://api.tavily.com/search'){
    const body=JSON.parse(options.body);assert.equal(body.exact_match,true);assert(body.query.includes('"'+PLATE+'"'));
    const batches=[['43000002','43000003','43000004','43000005'],['43000005','43000006','43000007']];assert(search<batches.length);
    return json({results:batches[search++].map(id=>({url:'https://fem.encar.com/cars/detail/'+id,title:'다른 합성 차량',content:OTHER,raw_content:'다른 합성 차량 '+OTHER}))});
   }
   if(url.origin==='https://fem.encar.com'&&/^\/cars\/detail\/4300000[1-7]$/.test(url.pathname)){
    assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);const id=url.pathname.split('/').at(-1);
    if(id===ID)return new Response('<h1>서비스 이용 제한됨</h1>',{status:403});
    return new Response(official(id),{headers:{'Content-Type':'text/html'}});
   }
   throw Error('Unexpected synthetic upstream '+url.href);
  };
  try{
   const response=await onRequest({request,env,waitUntil(promise){pending.push(promise);}});await Promise.all(pending);
   const body=await response.json();replies.push({status:response.status,body});return{response,body};
  }finally{globalThis.fetch=previousFetch;console.info=previousInfo;}
 }
 return service;
}
async function connect(f,service){await f.context.route('**/api/encar',async route=>{
 const request=route.request(),body=JSON.parse(request.postData()||'{}');f.requests.push(body);assert.equal(request.method(),'POST');assert.match(request.headers().authorization,/^Bearer [A-Za-z0-9._-]{30,}$/);
 const result=await service.handle(new Request(request.url(),{method:'POST',headers:{Authorization:request.headers().authorization,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return route.fulfill({status:result.response.status,contentType:'application/json',body:JSON.stringify(result.body)});
});}
async function prepare(f){
 const p=f.page;
 await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});if(navigate('buy')!==true)throw Error('The actual purchase route is required');});
 await p.locator('#list-query').fill('검증');if(p.viewportSize().width!==1440)await p.locator('#snote-vehicle-view-switch').click();
 const host=p.viewportSize().width===1440?'#list-table':'#list-mobile';assert.equal(await p.locator(ICON).count(),0);
 await p.locator(host+' [data-registration-car-id="'+CAR+'"]').click();await p.locator('#vehicle-encar-check:not([disabled])').waitFor();
 await p.locator('#detail-memo').fill('등급 탐색 중 보존할 미저장 메모');await p.locator('#detail-extra').fill('별도로 저장할 차량 비고');
 return p.evaluate(()=>({query:document.getElementById('list-query').value,mode:document.getElementById('list-screen').dataset.vehicleView,peer:normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]}));
}
async function baselineFailure(f,service){
 const p=f.page,opening=f.context.waitForEvent('page');await p.locator('#vehicle-encar-check').click();const popup=await opening;if(!popup.isClosed())await popup.waitForEvent('close');
 await p.locator('#vehicle-encar-check:not([disabled])').waitFor();await p.locator('.snote-encar-copy').waitFor({state:'visible'});
 const result=service.replies.at(-1).body;assert.equal(result.listings.length,0);assert.equal(result.diagnostics.resolverRelease,'2.126');assert.equal(result.diagnostics.discoveryProvided,true);
 assert.equal(result.diagnostics.searchCount,2);assert.equal(result.diagnostics.resultCount,7);assert.equal(result.diagnostics.rejected.plateMismatch,6);
 assert(!service.calls.some(call=>call.url===CATALOG+GENERATION||call.url===CATALOG+TRIM),'The parent-only fixture cannot invent missing child routes');
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__trimCopiedDiagnostics=value;}}}));
 await p.locator('.snote-encar-copy').click();await p.waitForFunction(()=>typeof window.__trimCopiedDiagnostics==='string');const diagnostic=await p.evaluate(()=>JSON.parse(window.__trimCopiedDiagnostics));
 assert.equal(diagnostic.clientRelease,'2.126');assert.equal(diagnostic.resolverRelease,'2.126');assert.equal(diagnostic.discoveryProvided,true);
 assert.equal(await p.locator(ICON).count(),0);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);
 service.branches=true;return diagnostic;
}
async function verifySaved(f,before){
 const p=f.page;await p.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();
 // Assert behind the still-open drawer first. Closing would itself repaint and
 // conceal a regression of the real-time list refresh added in v2.125.
 await p.waitForFunction(id=>['list-table','list-mobile'].every(host=>document.querySelectorAll('#'+host+' .snote-list-encar[data-encar-car-id="'+id+'"]').length===1),CAR);
 assert.equal(await p.locator(ICON).count(),2);assert.equal(await p.locator('.snote-list-encar:not([data-encar-car-id="'+CAR+'"])').count(),0);
 assert.equal(await p.evaluate(()=>activeCarId),CAR);assert.equal(await p.locator('#vehicle-overlay').getAttribute('aria-hidden'),'false');
 await p.locator('.snote-encar-external-status').waitFor({state:'visible'});
 const record=await p.evaluate(()=>structuredClone(window.__encarFixtureCars[0].encarLinks));
 assert.equal(record.plate,PLATE);assert.equal(record.listings.length,1);assert.equal(record.listings[0].id,ID);assert.equal(record.listings[0].sellerUrl,SELLER);
 assert.equal(record.listings[0].externalVerification.sourceUrl,CATALOG+TRIM);assert(!['verified','review'].includes(record.listings[0].priceStatus));
 assert.equal(await p.locator('.snote-encar-price-apply').count(),0);assert.equal(await p.locator('#snote-encar-price-confirm').isVisible(),false);assert.equal(f.autoPriceRequests.length,0);
 assert.equal(await p.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);
 assert.equal(await p.locator('#detail-memo').inputValue(),'등급 탐색 중 보존할 미저장 메모');assert.equal(await p.locator('#detail-extra').inputValue(),'별도로 저장할 차량 비고');
 assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].vehicleMemo),undefined);assert.equal(await p.evaluate(()=>window.__encarFixtureCars[0].extra),undefined);
 assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),before.peer);
 assert.equal(await p.locator('#list-query').inputValue(),before.query);assert.equal(await p.locator('#list-screen').getAttribute('data-vehicle-view'),before.mode);return record;
}

(async()=>{
 fs.mkdirSync(ART,{recursive:true});const testedHashes=hashes(),results=[];
 await import(pathToFileURL(path.join(__dirname,'html-rewriter-setup.mjs')).href);
 const {onRequest}=await import(pathToFileURL(path.join(ROOT,'functions/api/encar.js')).href);
 const {parseExternalAdvertisement}=await import(pathToFileURL(path.join(ROOT,'functions/_shared/encar-catalog.mjs')).href);
 for(const path of[MODEL,GENERATION])assert.equal((await parseExternalAdvertisement('<html><body>'+catalogue(path,true)+'</body></html>',CATALOG+path,PLATE)).matches.length,0,'The actual parent model/generation pages cannot establish this plate identity');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390,320]){
   const f=await fixture(width,cars()),p=f.page,service=createService(onRequest,{branches:width!==1440,searchConfigured:width!==320});let savedCars;
   try{
    const before=await prepare(f);await connect(f,service);
    if(width===1440){const diagnostic=await baselineFailure(f,service);results.push({parentListingOnlyMissReproduced:true,searchCount:2,resultCount:7,wrongPlateCount:6,diagnosticClientRelease:diagnostic.clientRelease,diagnosticResolverRelease:diagnostic.resolverRelease});}
    const start=service.calls.length;await p.evaluate(()=>window.__encarFixtureWriteMode='hold');
    const opening=f.context.waitForEvent('page');await p.locator('#vehicle-encar-check').click();const popup=await opening;await popup.waitForURL(SELLER);await popup.close();
    await p.waitForFunction(()=>window.__encarFixtureWriteWaiting);assert.equal(await p.locator(ICON).count(),0,'A found leaf is not advertised in the list before the server ACK');assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),0);
    assert.deepEqual(f.requests.at(-1).discovery,DISCOVERY);assert.deepEqual(f.requests.at(-1).candidateIds,[]);
    const calls=service.calls.slice(start);assert.equal(calls.filter(call=>call.url==='https://api.tavily.com/search').length,0,'Observed generation/grade navigation succeeds without generic search');
    assert.deepEqual(calls.filter(call=>new URL(call.url).origin===CATALOG).map(call=>new URL(call.url).pathname),['/','/catalog/','/catalog/tesla/',MODEL,GENERATION,TRIM]);
    assert.equal(service.replies.at(-1).body.status,'found');
    await p.evaluate(()=>{window.__encarFixtureWriteMode='ok';window.__encarFixtureReleaseWrite();});await verifySaved(f,before);
    savedCars=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));await p.screenshot({path:path.join(ART,'trim-discovery-'+width+'.png')});await finish(f);
   }catch(error){await f.context.close();throw error;}
   const restored=await fixture(width,savedCars);
   try{
    await restored.page.locator('.snote-encar-external-status').waitFor({state:'visible'});assert.equal(restored.requests.length,0);assert.equal(await restored.page.evaluate(()=>window.__encarFixtureWrites.length),0);
    assert.equal(await restored.page.evaluate(()=>window.__encarFixtureCars[0].encarLinks.listings[0].externalVerification.sourceUrl),CATALOG+TRIM);assert.equal(restored.autoPriceRequests.length,0);
    await finish(restored);
   }catch(error){await restored.context.close();throw error;}
   results.push({width,actualApiParserIndexAndCas:true,observedGenerationAndTrimTraversal:true,gradeForwarded:true,noSearchKey:width===320,noGenericSearch:true,
    exactPlateLeafOnly:true,liveListAfterAck:true,provenanceRestored:true,peerAndDraftsPreserved:true,noOcrOrPriceMutation:true});
   console.log('PASS '+width+'px real API/parser finds the exact plate only through observed generation/trim links, saves and refreshes the open-detail list after ACK');
  }
 }finally{await browser.close();}
 assert.deepEqual(hashes(),testedHashes,'The integration test must use one unchanged source snapshot');
 fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),syntheticOnly:true,actualApiAndParser:true,sourceHashes:testedHashes,results},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
