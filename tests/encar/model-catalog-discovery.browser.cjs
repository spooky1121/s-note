'use strict';
// Real browser -> real lookup Function + HTML parser -> actual app CAS bridge.
// Every upstream, account, vehicle and database response is synthetic.
// Run: node tests/encar/model-catalog-discovery.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {fixture,setBrowser,finish}=require('./browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'../..'),ART=process.env.ENCAR_MODEL_ARTIFACT_DIR||'/tmp/snote-encar-model-catalog';
const FILES=['index.html','assets/snote-encar-link.js','functions/api/encar.js','functions/_shared/encar-catalog.mjs','tests/encar/browser-smoke.cjs','tests/encar/model-catalog-discovery.browser.cjs'];
const sourceHashes=()=>Object.fromEntries(FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
const ACTOR='11111111-1111-4111-8111-111111111111',ALIAS='cld_'+ACTOR.replaceAll('-','').slice(0,18);
const PLATE='12가3456',OTHER='34나5678',ID='43000001',SELLER='https://fem.encar.com/cars/detail/'+ID;
const CATALOG='https://encar.spb.ru',SOURCE='https://tula.trust-encar.ru/auto/'+ID+'/';
const MODEL=CATALOG+'/catalog/toyota/rav4/';
const ENV={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic_public_key',TAVILY_API_KEY:'synthetic_search_key'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const html=body=>new Response('<!doctype html><html><body>'+body+'</body></html>',{headers:{'Content-Type':'text/html;charset=utf-8'}});
const evidence={
 '/':'<nav><a href="/catalog/">Каталог</a></nav><form method="post"><select name="brand"><option>Toyota</option></select><button>Показать</button></form>',
 '/catalog/':'<h1>Каталог</h1><div class="brands"><a href="/catalog/toyota/">Toyota <span class="count">809</span></a><a href="/catalog/tesla/">Tesla 1200</a></div><form method="post"><input name="unrelated" placeholder="Марка"><button>Поиск</button></form>',
 '/catalog/toyota/':'<h1>Toyota</h1><a href="/catalog/toyota/rav4/">RAV4 <span class="count">147</span></a><a href="/catalog/toyota/camry/">Camry 180</a>',
 '/catalog/toyota/rav4/':'<h1>Toyota RAV4</h1><div class="catalog-card"><div class="card-header"><h2><a href="/auto/43000002/">Toyota RAV4</a></h2></div><div class="card-body"><p>'+OTHER+'</p><p>Лот: 43000002</p></div></div><div class="catalog-card"><div class="card-header"><h2><a href="/auto/'+ID+'/">Toyota RAV4</a></h2></div><div class="card-body"><p>'+PLATE+'</p><p>Лот: '+ID+'</p><p>В продаже</p></div></div>'
};
function official(id,plate){return '<!doctype html><script>window.__PRELOADED_STATE__ = '+JSON.stringify({cars:{base:{vehicleId:Number(id),queryCarId:Number(id),vehicleNo:plate,advertisement:{status:'ADVERTISE'},manage:{dummy:false,dummyVehicleId:null},category:{manufacturerName:'토요타',modelName:'합성 RAV4'},spec:{mileage:12345}}}})+';</script>';}
function sourcePage(plate=PLATE){return '<h1>Toyota RAV4</h1><p>Дата добавления объявления 13.11.2026</p><p>Дата модификации объявления 16.11.2026</p><ul class="car-info"><li>Лот: '+ID+'</li><li>Номер автомобиля '+plate+'</li></ul><a href="https://www.encar.com/dc/dc_cardetailview.do?carid='+ID+'">Авто на Encar</a><h2>Похожие автомобили</h2><article><h3><a href="/auto/43000003/">Toyota RAV4</a></h3><p>'+OTHER+'</p></article>';}
function cars(withDiscovery=true){return[
 {id:'encar-car-1',ownerId:ALIAS,model:'가상 검증 차량 1',plate:PLATE,year:2026,km:'10,000',buy:1000,sell:1200,status:'판매중',...(withDiscovery?{make:'토요타',group:'RAV4',generation:'RAV4 5세대'}:{})},
 {id:'encar-car-2',ownerId:ALIAS,model:'가상 검증 차량 2',plate:OTHER,year:2026,km:'20,000',buy:1500,sell:1700,status:'판매중'}
];}
function createService(onRequest,{sourcePlate=PLATE,officialPlate=null,searchConfigured=true}={}){
 const env={...ENV,TAVILY_API_KEY:searchConfigured?ENV.TAVILY_API_KEY:''};
 const calls=[],replies=[],logs=[];let tail=Promise.resolve();
 async function run(request){
  const priorFetch=globalThis.fetch,priorInfo=console.info,pending=[];let search=0;
  console.info=(...values)=>logs.push(values.join(' '));
  globalThis.fetch=async(value,options={})=>{
   const url=new URL(value),headers=new Headers(options.headers||{});calls.push({url:url.href,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
   if(url.origin===ENV.SUPABASE_URL&&url.pathname==='/auth/v1/user')return json({id:ACTOR});
   if(url.origin===ENV.SUPABASE_URL&&url.pathname==='/rest/v1/zc_members')return json([{user_id:ACTOR}]);
   if(url.origin===CATALOG){
    assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);assert.equal(headers.get('apikey'),null);
    assert(Object.hasOwn(evidence,url.pathname),'Only observed catalogue directory/make/model routes are fetched');return html(evidence[url.pathname]);
   }
   if(url.href===SOURCE){assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),null);assert.equal(headers.get('apikey'),null);return html(sourcePage(sourcePlate));}
   if(url.href==='https://api.tavily.com/search'){
    const body=JSON.parse(options.body);assert.equal(body.exact_match,true);assert(body.query.includes('"'+PLATE+'"'),'Both search attempts must retain the complete quoted plate');
    const batches=[['43000002','43000003','43000004','43000005'],['43000005','43000006','43000007']];assert(search<batches.length,'The existing two-search bound is retained');
    return json({results:batches[search++].map(id=>({url:'https://fem.encar.com/cars/detail/'+id,title:'다른 합성 차량',content:OTHER,raw_content:'다른 합성 차량 '+OTHER}))});
   }
   if(url.origin==='https://fem.encar.com'&&/^\/cars\/detail\/4300000[1-7]$/.test(url.pathname)){
    assert.equal(options.redirect,'manual');const id=url.pathname.split('/').at(-1);
    if(id===ID&&!officialPlate)return new Response('<h1>서비스 이용 제한됨</h1>',{status:403});
    return new Response(official(id,id===ID?officialPlate:OTHER),{headers:{'Content-Type':'text/html'}});
   }
   throw Error('Unexpected synthetic service request '+url.href);
  };
  try{
   const response=await onRequest({request,env,waitUntil(promise){pending.push(promise);}});await Promise.all(pending);
   const body=await response.json();replies.push({status:response.status,body});return {response,body};
  }finally{globalThis.fetch=priorFetch;console.info=priorInfo;}
 }
 return{calls,replies,logs,handle(request){const next=tail.then(()=>run(request));tail=next.catch(()=>{});return next;}};
}
async function connect(f,service){
 await f.context.route('**/api/encar',async route=>{
  const request=route.request(),body=JSON.parse(request.postData()||'{}');f.requests.push(body);
  assert.equal(request.method(),'POST');assert.match(request.headers().authorization,/^Bearer [A-Za-z0-9._-]{30,}$/);
  const result=await service.handle(new Request(request.url(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:request.headers().authorization},body:JSON.stringify(body)}));
  return route.fulfill({status:result.response.status,contentType:'application/json',body:JSON.stringify(result.body)});
 });
}
async function persisted(p){await p.locator('.snote-encar-save-status').getByText('광고 링크를 서버에 저장했습니다.',{exact:true}).waitFor();}
async function openFound(f,trigger){const opening=f.context.waitForEvent('page');await trigger();const popup=await opening;await popup.waitForURL(SELLER);await popup.close();await persisted(f.page);}
async function checkExternal(f,source){
 await f.page.locator('.snote-encar-external-status').waitFor({state:'visible'});
 const saved=await f.page.evaluate(()=>structuredClone(window.__encarFixtureCars[0].encarLinks));
 assert.equal(saved.plate,PLATE);assert.equal(saved.listings.length,1);assert.equal(saved.listings[0].id,ID);assert.equal(saved.listings[0].sellerUrl,SELLER);assert.equal(saved.listings[0].externalVerification.sourceUrl,source);
 assert(!['verified','review'].includes(saved.listings[0].priceStatus));assert.equal(f.autoPriceRequests.length,0);assert.equal(await f.page.locator('.snote-encar-price-apply').count(),0);
 assert.equal(await f.page.evaluate(()=>SnoteMoney.car(window.__encarFixtureCars[0]).sell),12000000);return saved;
}

(async()=>{
 fs.mkdirSync(ART,{recursive:true});const testedHashes=sourceHashes();await import(pathToFileURL(path.join(__dirname,'html-rewriter-setup.mjs')).href);
 const {onRequest}=await import(pathToFileURL(path.join(ROOT,'functions/api/encar.js')).href),results=[];
 // Reproduce the production failure class with actual lookup code: seven
 // indexed results, six distinct wrong plates and no usable native GET form.
 const baseline=createService(onRequest);
 const missed=await baseline.handle(new Request('https://encar-smoke.example/api/encar',{method:'POST',headers:{Authorization:'Bearer synthetic_browser_baseline_token_more_than_thirty_characters','Content-Type':'application/json'},body:JSON.stringify({plate:PLATE,candidateIds:[]})}));
 assert.equal(missed.body.listings.length,0);assert.equal(missed.body.diagnostics.searchCount,2);assert.equal(missed.body.diagnostics.resultCount,7);assert.equal(missed.body.diagnostics.resultPlateMatchCount,0);assert.equal(missed.body.diagnostics.rejected.plateMismatch,6);
 results.push({baselineIrrelevantSearchReproduced:true,searchCount:2,resultCount:7,wrongPlateCount:6});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of[1440,390,320]){
   const searchConfigured=width!==320,f=await fixture(width,cars()),p=f.page,service=createService(onRequest,{searchConfigured});let savedCars;
   try{
    assert.equal(f.release,'2.124');await connect(f,service);const peer=await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]);
    await p.locator('#detail-memo').fill('검색 중 보존할 미저장 메모');await openFound(f,()=>p.locator('#vehicle-encar-check').click());
    assert.deepEqual(f.requests[0].discovery,{make:'토요타',model:'RAV4'});assert.deepEqual(f.requests[0].candidateIds,[]);
    await checkExternal(f,MODEL);assert.equal(service.replies[0].body.status,'found');assert.equal(service.calls.filter(call=>call.url==='https://api.tavily.com/search').length,0,'Observed model traversal finds the exact plate before unrelated generic search');
    assert.deepEqual(service.calls.filter(call=>new URL(call.url).origin===CATALOG).map(call=>new URL(call.url).pathname),['/','/catalog/','/catalog/toyota/','/catalog/toyota/rav4/'],'Unsupported native forms fall back to observed directory, make and model anchors without repeating requests');
    assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);assert.equal(await p.locator('#detail-memo').inputValue(),'검색 중 보존할 미저장 메모');assert.deepEqual(await p.evaluate(()=>normalizedCars([window.__encarFixtureCars[1]],currentUser.username)[0]),peer);
    savedCars=await p.evaluate(()=>structuredClone(window.__encarFixtureCars));await p.screenshot({path:path.join(ART,'model-discovery-'+width+'.png')});await finish(f);
   }catch(error){await f.context.close();throw error;}
   const restored=await fixture(width,savedCars);
   try{
    await checkExternal(restored,MODEL);assert.equal(restored.requests.length,0);assert.equal(await restored.page.evaluate(()=>window.__encarFixtureWrites.length),0);
    if(width===1440){await restored.page.evaluate(async()=>{await closeVehicle({discard:true,animate:false});navigate('buy');});const opening=restored.context.waitForEvent('page');await restored.page.locator('.snote-list-encar[data-encar-car-id="encar-car-1"]').first().click();const popup=await opening;await popup.waitForURL(SELLER);await popup.close();assert.equal(restored.requests.length,0);}
    await finish(restored);
   }catch(error){await restored.context.close();throw error;}
   results.push({width,actualApiAndParser:true,searchConfigured,modelDiscoveryBeforeGenericSearch:true,plateOnlyIdentity:true,scopedCasSaved:true,sourceRestored:true,dirtyDraftAndPeerPreserved:true,noCaptureOrPriceMutation:true});
   console.log('PASS '+width+'px browser -> actual catalogue navigation/parser -> exact-plate external evidence -> scoped CAS save and restoration');
  }
  const f=await fixture(390,cars(false)),p=f.page,service=createService(onRequest);
  try{
   await connect(f,service);const opening=f.context.waitForEvent('page');await p.locator('#vehicle-encar-check').click();const waiting=await opening;if(!waiting.isClosed())await waiting.waitForEvent('close');
   const manual=p.locator('.snote-encar-manual');await manual.waitFor({state:'visible'});await manual.evaluate(element=>{element.open=true;});
   const before=f.requests.length;await p.locator('#snote-encar-manual-url').fill('https://tula.trust-encar.ru.evil.example/auto/'+ID+'/');await manual.locator('button').click();
   await p.locator('.snote-encar-manual-error').waitFor({state:'visible'});assert.equal(f.requests.length,before,'A lookalike manual URL never reaches the service');
   await p.locator('#snote-encar-manual-url').fill(SOURCE);await openFound(f,()=>manual.locator('button').click());await checkExternal(f,SOURCE);
   assert.deepEqual(f.requests.at(-1).sourceUrls,[SOURCE]);assert.deepEqual(f.requests.at(-1).candidateIds,[ID]);assert.equal(f.requests.at(-1).discovery,undefined);
   assert(service.calls.some(call=>call.url===SOURCE));assert.equal(await p.evaluate(()=>window.__encarFixtureWrites.length),1);await p.screenshot({path:path.join(ART,'manual-external-source-390.png')});await finish(f);
   results.push({manualTrustSourceActualApi:true,lookalikeRejectedBeforeRequest:true,canonicalOfficialPopupOnly:true,exactMainPlateChecked:true});console.log('PASS manual observed Trust URL uses the real source/plate validator and persists only the canonical official link');
  }catch(error){await f.context.close();throw error;}
 }finally{await browser.close();}
 assert.deepEqual(sourceHashes(),testedHashes,'Application, API, parser and fixture must stay unchanged throughout the integration run');
 fs.writeFileSync(path.join(ART,'receipt.json'),JSON.stringify({ok:true,at:new Date().toISOString(),syntheticUpstreamsOnly:true,actualApiAndParser:true,sourceHashes:testedHashes,results},null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
