import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './encar/html-rewriter-setup.mjs';
import { onRequest } from '../functions/api/encar-auto-price.js';
import { onRequest as resolveAdvertisement } from '../functions/api/encar.js';

const ORIGIN='https://auto-price.example',ID='43000001',OTHER='43000002',PLATE='12가3456';
const TOKEN='synthetic_auto_price_access_token_12345';
const ACCOUNT='1234567890abcdef1234567890abcdef',BROWSER='synthetic_private_browser_token',VISION='synthetic_private_vision_key';
const ENV={SUPABASE_URL:'https://auto-price-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic_public_key',CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_BROWSER_TOKEN:BROWSER,GOOGLE_VISION_API_KEY:VISION,TAVILY_API_KEY:'MUST_NOT_USE_SEARCH_KEY',ENCAR_API_KEY:'MUST_NOT_USE_PRICE_KEY'};
function json(value,status=200){return Response.json(value,{status});}
function png(width=1440,height=1200){const image=new Uint8Array(28);image.set([137,80,78,71,13,10,26,10]);image.set([73,72,68,82],12);const view=new DataView(image.buffer);view.setUint32(16,width);view.setUint32(20,height);return image;}
function page(overrides={},visible=''){
 const value={vehicleNo:PLATE,vehicleId:Number(ID),queryCarId:Number(ID),advertisement:{status:'ADVERTISE'},manage:{dummy:false,dummyVehicleId:null},category:{manufacturerName:'합성',modelName:'자동 가격 차량'},spec:{mileage:10000},...overrides};
 return '<!doctype html><html><body>'+visible+'<script>window.__PRELOADED_STATE__='+JSON.stringify({cars:{base:value,seller:{name:'PRIVATE_SELLER',phone:'PRIVATE_PHONE'}}})+';</script></body></html>';
}
function request(body={plate:PLATE,id:ID},extra={}){return new Request(ORIGIN+'/api/encar-auto-price',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+TOKEN,'Content-Type':'application/json',...extra.headers},body:typeof body==='string'||body instanceof ReadableStream?body:JSON.stringify(body),duplex:'half',...extra,...(extra.headers?{headers:{Origin:ORIGIN,Authorization:'Bearer '+TOKEN,'Content-Type':'application/json',...extra.headers}}:{})});}
async function run(t,options={}){
 const original=globalThis.fetch,info=console.info,calls=[],logs=[];
 globalThis.fetch=async(urlValue,init={})=>{
  const url=new URL(urlValue);calls.push({url:url.href,init});await options.onCall?.(url,init);
  if(url.origin===ENV.SUPABASE_URL){
   assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer '+TOKEN);
   if(url.pathname==='/auth/v1/user')return options.authResponse??json({id:'11111111-1111-4111-8111-111111111111'},options.authStatus??200);
   if(url.pathname==='/rest/v1/zc_members')return options.memberResponse??json(options.members??[{user_id:'11111111-1111-4111-8111-111111111111'}]);
  }
  if(url.origin==='https://fem.encar.com')return options.detail?.(url,init)??options.detailResponse??new Response(page(options.vehicle,options.visible||''),{headers:{'Content-Type':'text/html'}});
  if(url.origin==='https://encar.spb.ru')return new Response('<div class="no-results">Ничего не найдено</div>',{headers:{'Content-Type':'text/html'}});
  if(url.origin==='https://nnov.trust-encar.ru')return options.externalResponse?.clone()??new Response('Not found',{status:404});
  if(url.origin==='https://api.cloudflare.com')return options.capture?.(url,init)??options.captureResponse??new Response(png(),{headers:{'Content-Type':'image/png'}});
  if(url.origin==='https://vision.googleapis.com')return options.vision?.(url,init)??options.visionResponse??json({responses:[{fullTextAnnotation:{text:options.text??('차량번호 '+PLATE+'\n판매가격 5,490만원\n월 납입금 29만원\nPRIVATE_OCR_ACCOUNT')}}]});
  assert.fail('Unexpected outbound destination '+url.origin);
 };
 console.info=(...args)=>logs.push(args.join(' '));
 try{const res=await (options.handler??onRequest)({request:options.request??request(),env:{...ENV,...options.env}});return {res,status:res.status,body:await res.json(),calls,logs};}
 finally{globalThis.fetch=original;console.info=info;}
}
const captures=result=>result.calls.filter(call=>call.url.startsWith('https://api.cloudflare.com/'));
const visions=result=>result.calls.filter(call=>call.url.startsWith('https://vision.googleapis.com/'));
const noPaid=result=>{assert.equal(captures(result).length,0);assert.equal(visions(result).length,0);};

test('GET returns only a boolean setup status and never calls external services',async t=>{
 const r=await run(t,{request:new Request(ORIGIN+'/api/encar-auto-price')});assert.deepEqual(r.body,{ok:true,configured:true});assert.equal(r.calls.length,0);
 const missing=await run(t,{request:new Request(ORIGIN+'/api/encar-auto-price'),env:{CLOUDFLARE_BROWSER_TOKEN:''}});assert.deepEqual(missing.body,{ok:true,configured:false});assert.equal(missing.calls.length,0);
});
test('cross-site top-level document navigation can read only the public configuration boolean',async t=>{
 for(const site of['cross-site','same-site']){
  const req=new Request(ORIGIN+'/api/encar-auto-price',{headers:{'Sec-Fetch-Site':site,'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document',Referer:'https://chat.example/'}});
  const r=await run(t,{request:req});assert.equal(r.status,200);assert.deepEqual(r.body,{ok:true,configured:true});assert.equal(r.calls.length,0);
 }
});
test('cross-origin frames, programmatic GET and explicit foreign origins cannot use the navigation exception',async t=>{
 const headers=[
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'iframe'},
  {'Sec-Fetch-Site':'same-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'iframe'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors','Sec-Fetch-Dest':'empty'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Dest':'document'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'document'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document',Origin:'https://foreign.example'},
  {'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document',Origin:'null'},
  {Origin:'https://foreign.example'},
 ];
 for(const value of headers){const r=await run(t,{request:new Request(ORIGIN+'/api/encar-auto-price',{headers:value})});assert.equal(r.status,403);assert.equal(r.body.code,'FORBIDDEN');assert.equal(r.calls.length,0);}
});
test('every cross-origin POST remains forbidden before authentication, capture or OCR despite navigation headers',async t=>{
 for(const site of['cross-site','same-site'])for(const mode of['navigate','cors','no-cors'])for(const origin of[null,'https://foreign.example']){
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+TOKEN,'Sec-Fetch-Site':site,'Sec-Fetch-Mode':mode,'Sec-Fetch-Dest':'document'};
  if(origin!==null)headers.Origin=origin;
  const req=new Request(ORIGIN+'/api/encar-auto-price',{method:'POST',headers,body:JSON.stringify({plate:PLATE,id:ID})});
  const r=await run(t,{request:req});assert.equal(r.status,403);assert.equal(r.body.code,'FORBIDDEN');assert.equal(r.calls.length,0);noPaid(r);
 }
});
test('verified current canonical vehicle is rendered once and OCR produces a reviewed KRW proposal only',async t=>{
 const start=Date.now(),r=await run(t);assert.equal(r.status,200);assert.equal(r.body.plate,PLATE);assert(Number.isFinite(Date.parse(r.body.verifiedAt)));
 assert.deepEqual({...r.body.listing,priceCheckedAt:'time'},{id:ID,priceWon:54900000,priceCheckedAt:'time',priceSource:'encar.com-ocr',priceStatus:'review'});
 assert(Date.parse(r.body.listing.priceCheckedAt)>=start&&Date.parse(r.body.listing.priceCheckedAt)<=Date.now());
 assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);
 assert.doesNotMatch(JSON.stringify(r.body)+r.logs.join(''),/PRIVATE_|synthetic_private|MUST_NOT_USE_|base64|fullTextAnnotation/);
 const capture=captures(r)[0];assert.equal(capture.url,'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/browser-rendering/screenshot');
 assert.deepEqual(capture.init.headers,{Authorization:'Bearer '+BROWSER,'Content-Type':'application/json',Accept:'image/jpeg, image/png'});
 const payload=JSON.parse(capture.init.body);assert.equal(payload.url,'https://fem.encar.com/cars/detail/'+ID);assert.deepEqual(Object.keys(payload).sort(),['gotoOptions','screenshotOptions','url','viewport']);assert.deepEqual(payload.screenshotOptions,{type:'jpeg',quality:98,fullPage:false,captureBeyondViewport:false});assert.equal(payload.gotoOptions.waitUntil,'networkidle2');assert(payload.gotoOptions.timeout<=15000);
 assert.deepEqual(payload.viewport,{width:1440,height:1200,deviceScaleFactor:1});assert.equal(payload.screenshotOptions.fullPage,false);
 const vision=visions(r)[0];const visionURL=new URL(vision.url);assert.equal(visionURL.origin+visionURL.pathname,'https://vision.googleapis.com/v1/images:annotate');assert.equal(visionURL.searchParams.get('fields'),'responses(error,fullTextAnnotation(text),textAnnotations(description))');assert.deepEqual([...visionURL.searchParams.keys()],['fields']);assert.equal(vision.init.headers['x-goog-api-key'],VISION);assert.equal(vision.init.headers.Authorization,undefined);
 const body=JSON.parse(vision.init.body);assert.equal(body.requests.length,1);assert.equal(body.requests[0].features[0].type,'DOCUMENT_TEXT_DETECTION');assert.equal(Buffer.from(body.requests[0].image.content,'base64').byteLength,png().byteLength);
 for(const c of[capture,vision]){assert.equal(c.init.redirect,'manual');assert.equal(c.init.credentials,'omit');assert.equal(c.init.cache,'no-store');assert.equal(c.init.referrerPolicy,'no-referrer');assert(c.init.signal instanceof AbortSignal);}
 assert(r.calls.every(c=>!c.url.startsWith('https://api.tavily.com')&&!c.url.startsWith('https://api.encar-api.com')));
 assert.match(r.res.headers.get('Cache-Control'),/no-store/);assert.equal(r.res.headers.get('X-Content-Type-Options'),'nosniff');
});
test('cross-origin, malformed requests and arbitrary URL/script/cookie fields fail before paid services',async t=>{
 const values=[request({plate:PLATE,id:ID,url:'https://private.example/'}),request({plate:PLATE,id:ID,selector:'body'}),request({plate:PLATE,id:ID,cookies:[]}),request({plate:PLATE,id:ID,html:'secret'}),request({plate:PLATE,id:'https://evil.example'}),request({plate:'bad',id:ID}),request({plate:PLATE,id:ID},{headers:{Origin:'https://evil.example'}}),request({plate:PLATE,id:ID},{headers:{Authorization:''}}),request({plate:PLATE,id:ID},{headers:{'Content-Type':'text/plain'}}),request('not-json'),request({plate:PLATE,id:ID},{method:'PUT'})];
 for(const req of values){const r=await run(t,{request:req});assert(r.status>=400);noPaid(r);assert.equal(r.calls.length,0);}
});
test('request body is limited to 2 KiB even without a declared size',async t=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(2049)));},cancel(){cancelled=true;}});
 const r=await run(t,{request:request(stream)});assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(r.calls.length,0);
});
test('authentication, active membership, canonical ID and advertisement validation precede capture billing',async t=>{
 for(const options of[{authStatus:401},{members:[]},{vehicle:{vehicleNo:'34나5678'}},{vehicle:{advertisement:{status:'SOLD'}}},{vehicle:{vehicleId:Number(OTHER),queryCarId:Number(OTHER)}}]){
  const r=await run(t,options);assert(r.status>=400);noPaid(r);
 }
});
test('an authenticated direct price request rejects the real resolver external-only match before screenshot or Vision',async t=>{
 const options=()=>({
  detailResponse:new Response('<h1>서비스 이용 제한됨</h1>',{status:403}),
  externalResponse:new Response('<h1>Synthetic vehicle</h1><p>Дата добавления объявления 13.11.2026</p><ul><li>Лот '+ID+'</li><li>Номер автомобиля '+PLATE+'</li></ul><p>54,900,000원</p><a href="https://www.encar.com/dc/dc_cardetailview.do?carid='+ID+'">Авто на Encar</a>',{headers:{'Content-Type':'text/html'}})
 });
 const resolved=await run(t,{...options(),handler:resolveAdvertisement,
  request:new Request(ORIGIN+'/api/encar',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({plate:PLATE,candidateIds:[ID]})}),
  env:{TAVILY_API_KEY:'',ENCAR_API_KEY:''}});
 assert.equal(resolved.status,200);assert.equal(resolved.body.status,'found');
 assert.equal(resolved.body.listings[0].externalVerification.sourceUrl,'https://nnov.trust-encar.ru/auto/'+ID+'/');
 assert.equal(resolved.body.listings[0].priceStatus,'unavailable');noPaid(resolved);
 const result=await run(t,options());
 assert.equal(result.status,409);assert.equal(result.body.code,'VEHICLE_UNVERIFIED');assert.equal(result.body.listing,undefined);
 assert.equal(result.calls.filter(call=>call.url==='https://nnov.trust-encar.ru/auto/'+ID+'/').length,1);
 noPaid(result);
});
test('even a resolver external marker with a forged verified price cannot take the price reuse fast path',async t=>{
 const original=await readFile(new URL('../functions/api/encar-auto-price.js',import.meta.url),'utf8');
 const checkedAt=new Date().toISOString();
 for(const evidence of[{source:'trust-encar'},null,false]){
  const resolved={status:'found',plate:PLATE,verifiedAt:checkedAt,listings:[{id:ID,sellerUrl:'https://fem.encar.com/cars/detail/'+ID,
   externalVerification:evidence,priceWon:54900000,priceCheckedAt:checkedAt,priceSource:'encar.com',priceStatus:'verified'}]};
  const code=original
   .replace("import { onRequest as resolveAdvertisement } from './encar.js';",'const resolveAdvertisement=async()=>Response.json('+JSON.stringify(resolved)+');')
   .replace("'../_shared/encar-price-ocr.mjs'",JSON.stringify(new URL('../functions/_shared/encar-price-ocr.mjs',import.meta.url).href))
   .replace("'../_shared/api-security.js'",JSON.stringify(new URL('../functions/_shared/api-security.js',import.meta.url).href));
  const {onRequest:handler}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const result=await run(t,{handler});
  assert.equal(result.status,409);assert.equal(result.body.code,'VEHICLE_UNVERIFIED');assert.equal(result.body.listing,undefined);
  noPaid(result);assert.equal(result.calls.length,0);
 }
});
test('missing or malformed capture credentials have a fixed setup error without exposing any configured values',async t=>{
 for(const env of[{CLOUDFLARE_ACCOUNT_ID:''},{CLOUDFLARE_ACCOUNT_ID:'https://evil.example/'},{CLOUDFLARE_BROWSER_TOKEN:''},{CLOUDFLARE_BROWSER_TOKEN:'bad\nvalue'},{GOOGLE_VISION_API_KEY:''}]){
  const r=await run(t,{env});assert.equal(r.status,503);assert.equal(r.body.code,'SETUP_REQUIRED');noPaid(r);assert.doesNotMatch(JSON.stringify(r.body),/synthetic_private|https:\/\//);
 }
});
test('capture HTTP errors, redirects, non-PNG bodies and invalid PNG dimensions stop before Vision',async t=>{
 for(const status of[301,302,401,403,429,500]){const r=await run(t,{captureResponse:new Response('PRIVATE_SERVICE_ERROR',{status,headers:{Location:'https://evil.example'}})});assert(r.status>=400);assert.equal(captures(r).length,1);assert.equal(visions(r).length,0);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_/);}
 for(const response of[new Response('{}',{headers:{'Content-Type':'application/json'}}),new Response('not PNG',{headers:{'Content-Type':'image/png'}}),new Response(png(100000,100000),{headers:{'Content-Type':'image/png'}}),new Response(png(),{headers:{'Content-Type':'image/png','Content-Length':'6291457'}}),new Response(new Uint8Array(6291457),{headers:{'Content-Type':'image/png'}})]){
  const r=await run(t,{captureResponse:response});assert.equal(r.body.code,'CAPTURE_INVALID');assert.equal(visions(r).length,0);
 }
});
test('Vision errors and oversized/invalid JSON never return provider data or an amount',async t=>{
 for(const status of[301,400,401,403,429,500]){const r=await run(t,{visionResponse:new Response('PRIVATE_VISION_ERROR',{status,headers:{Location:'https://evil.example'}})});assert(r.status>=400);assert.equal(visions(r).length,1);assert.equal(r.body.listing,undefined);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_/);}
 for(const response of[json({responses:[{error:{message:'PRIVATE_RESPONSE'}}]}),new Response('{}',{headers:{'Content-Type':'text/html'}}),new Response('x',{headers:{'Content-Type':'application/json'}}),new Response('x'.repeat(4194305),{headers:{'Content-Type':'application/json'}})]){const r=await run(t,{visionResponse:response});assert(r.status>=400);assert.equal(r.body.listing,undefined);}
});
test('captcha, inactive-page text, mismatched plates and ambiguous prices are not automatically proposed',async t=>{
 for(const [text,code]of[['captcha '+PLATE+' 5,490만원','CAPTURE_BLOCKED'],['판매완료 '+PLATE+' 5,490만원','CAPTURE_BLOCKED'],['34나5678 5,490만원','PLATE_MISMATCH'],['112가3456 5,490만원','PLATE_MISMATCH'],[PLATE+'\n판매가격 상담','PRICE_NOT_FOUND'],[PLATE+'\n5,490만원\n4,500만원','PRICE_AMBIGUOUS'],[PLATE+'\n월 납입금 29만원','PRICE_NOT_FOUND']]){const r=await run(t,{text});assert.equal(r.body.code,code);assert.equal(r.body.listing,undefined);}
});
test('oversized OCR text is rejected in full rather than hiding later prices or blocked-page markers',async t=>{
 const prefix=PLATE+'\n판매가격 5,490만원\n',boundary=prefix+'x'.repeat(200000-prefix.length);
 const accepted=await run(t,{text:boundary});assert.equal(accepted.status,200);assert.equal(accepted.body.listing.priceWon,54900000);
 for(const suffix of['\n4,500만원','\nCAPTCHA']){
  for(const fallback of[false,true]){
   const text=boundary+suffix,options=fallback?{visionResponse:json({responses:[{textAnnotations:[{description:text}]}]})}:{text};
   const r=await run(t,options);assert.equal(r.body.code,'OCR_INVALID');assert.equal(r.body.listing,undefined);assert.doesNotMatch(JSON.stringify(r.body),/CAPTCHA|4,500/);
  }
 }
 const missing=await run(t,{visionResponse:json({responses:[{fullTextAnnotation:{pages:[]}}]})});assert.equal(missing.body.code,'OCR_INVALID');
});
test('more than 1000 normalized amount markers reject the whole OCR result before parser truncation',async t=>{
 const prefix=PLATE+'\n판매가격 5,490만원\n',boundary=prefix+'5,490만원\n'.repeat(999);
 const accepted=await run(t,{text:boundary});assert.equal(accepted.status,200);assert.equal(accepted.body.listing.priceWon,54900000);
 for(const tail of['4,500만원','CAPTCHA\n4,500만원']){
  const r=await run(t,{text:boundary+tail});assert.equal(r.body.code,'OCR_INVALID');assert.equal(r.body.listing,undefined);
 }
 const decomposed=await run(t,{text:prefix+'5,490만원\n'.repeat(999)+'4,500만원'});assert.equal(decomposed.body.code,'OCR_INVALID');
});
test('a verified current HTML amount can be reused without capture or Vision configuration',async t=>{
 const r=await run(t,{visible:'<main><p>차량 판매가격 5,490만원</p></main>',env:{CLOUDFLARE_BROWSER_TOKEN:'',GOOGLE_VISION_API_KEY:''}});
 assert.equal(r.status,200);assert.equal(r.body.listing.priceWon,54900000);assert.equal(r.body.listing.priceStatus,'review');assert.equal(r.body.listing.priceSource,'encar.com');noPaid(r);
});
test('a hanging capture obeys the shared 20-second capture budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered;const ready=new Promise(r=>entered=r);
 const pending=run(t,{capture:()=>{entered();return new Promise(()=>{});}});await ready;t.mock.timers.tick(20001);const r=await pending;assert.equal(r.body.code,'CAPTURE_TIMEOUT');assert.equal(visions(r).length,0);
});
test('a hanging screenshot body is cancelled at the same capture deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered,cancelled=false;const ready=new Promise(r=>entered=r);
 const pending=run(t,{capture:()=>new Response(new ReadableStream({pull(){entered();return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'Content-Type':'image/png'}})});
 await ready;await new Promise(setImmediate);t.mock.timers.tick(20001);const r=await pending;assert.equal(r.body.code,'CAPTURE_TIMEOUT');assert.equal(cancelled,true);assert.equal(visions(r).length,0);
});
test('a hanging Vision request is bounded without a second capture or OCR attempt',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered;const ready=new Promise(r=>entered=r);
 const pending=run(t,{vision:()=>{entered();return new Promise(()=>{});}});await ready;t.mock.timers.tick(10001);const r=await pending;assert.equal(r.body.code,'OCR_TIMEOUT');assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);
});
test('a hanging Vision body is cancelled and never exposes partial OCR text',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered,cancelled=false;const ready=new Promise(r=>entered=r);
 const pending=run(t,{vision:()=>new Response(new ReadableStream({pull(){entered();return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}})});
 await ready;await new Promise(setImmediate);t.mock.timers.tick(10001);const r=await pending;assert.equal(r.body.code,'OCR_TIMEOUT');assert.equal(cancelled,true);assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);assert.equal(r.body.listing,undefined);
});
test('the overall deadline stays bounded when little time remains for recognition',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});let entered;const ready=new Promise(r=>entered=r);
 const pending=run(t,{capture:()=>{t.mock.timers.setTime(154000);return new Response(png(),{headers:{'Content-Type':'image/png'}});},vision:()=>{entered();return new Promise(()=>{});}});
 await ready;t.mock.timers.tick(6001);const r=await pending;assert.equal(r.body.code,'REQUEST_TIMEOUT');assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);
});
test('cancelling before the request never reaches a paid endpoint',async t=>{
 const controller=new AbortController();controller.abort();const r=await run(t,{request:request({plate:PLATE,id:ID},{signal:controller.signal})});assert.equal(r.body.code,'REQUEST_ABORTED');noPaid(r);
});

function jpeg(width=1440,height=1200,marker=0xc0){return new Uint8Array([255,216,255,marker,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0,255,217]);}
async function snapshot(response){return {status:response.status,headers:Object.fromEntries(response.headers),body:await response.json()};}

test('JPEG screenshot request retains bounded PNG compatibility and checks baseline/progressive SOF dimensions',async t=>{
 for(const image of[jpeg(),jpeg(320,200,0xc2),png()]){const r=await run(t,{captureResponse:new Response(image,{headers:{'Content-Type':image[0]===255?'image/jpeg':'image/png'}})});assert.equal(r.status,200);assert.equal(visions(r).length,1);}
 const bad=jpeg();bad[5]=0;
 for(const image of[jpeg(319,1200),jpeg(1440,199),jpeg(2880,3000),jpeg(3000,1200),jpeg(1440,1200,0xc1),jpeg().subarray(0,21),bad,new Uint8Array([255,216,255,218,0,2,255,217])]){const r=await run(t,{captureResponse:new Response(image,{headers:{'Content-Type':'image/jpeg'}})});assert.equal(r.body.code,'CAPTURE_INVALID');assert.equal(visions(r).length,0);}
 const mismatch=await run(t,{captureResponse:new Response(png(),{headers:{'Content-Type':'image/jpeg'}})});assert.equal(mismatch.body.code,'CAPTURE_INVALID');
});

test('native toBase64 fast path and legacy fallback send exactly the original bounded image bytes',async t=>{
 const original=Object.getOwnPropertyDescriptor(Uint8Array.prototype,'toBase64');let nativeCalls=0;
 try{Object.defineProperty(Uint8Array.prototype,'toBase64',{configurable:true,value:function(){nativeCalls++;return Buffer.from(this).toString('base64');}});const r=await run(t);assert.equal(r.status,200);assert.equal(nativeCalls,1);const payload=JSON.parse(visions(r)[0].init.body);assert.deepEqual(Buffer.from(payload.requests[0].image.content,'base64'),Buffer.from(png()));}
 finally{if(original)Object.defineProperty(Uint8Array.prototype,'toBase64',original);else delete Uint8Array.prototype.toBase64;}
 const r=await run(t);assert.equal(r.status,200);assert.deepEqual(Buffer.from(JSON.parse(visions(r)[0].init.body).requests[0].image.content,'base64'),Buffer.from(png()));
});

test('settled OCR cache rechecks Auth/member/current advertisement on every request and preserves source price time',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});let first,second;
 const r=await run(t,{handler:async context=>{first=await snapshot(await onRequest(context));t.mock.timers.setTime(105000);second=await snapshot(await onRequest({...context,request:request()}));return new Response(JSON.stringify(second.body),{status:second.status});}});
 assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(first.body.diagnostics.priceCacheHit,false);assert.equal(second.body.diagnostics.priceCacheHit,true);
 assert.equal(first.body.listing.priceCheckedAt,second.body.listing.priceCheckedAt);assert.notEqual(first.body.verifiedAt,second.body.verifiedAt);
 assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);assert.equal(r.calls.filter(call=>call.url.includes('/auth/v1/user')).length,2);assert.equal(r.calls.filter(call=>call.url.includes('/rest/v1/zc_members')).length,2);assert.equal(r.calls.filter(call=>call.url.startsWith('https://fem.encar.com/')).length,2);
 assert.doesNotMatch(JSON.stringify([first,second])+r.logs.join(''),/PRIVATE_|synthetic_private|base64|fullTextAnnotation/);
});

test('OCR cache expires at ten seconds and failed OCR is never cached',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});let first,expired;
 const r=await run(t,{handler:async context=>{first=await snapshot(await onRequest(context));t.mock.timers.setTime(110000);expired=await snapshot(await onRequest({...context,request:request()}));return new Response(JSON.stringify(expired.body));}});
 assert.equal(captures(r).length,2);assert.equal(visions(r).length,2);assert.equal(expired.body.diagnostics.priceCacheHit,false);assert.notEqual(first.body.listing.priceCheckedAt,expired.body.listing.priceCheckedAt);
 let attempt=0,failed;
 const retry=await run(t,{vision:()=>json({responses:[{fullTextAnnotation:{text:PLATE+(++attempt===1?'\n5,490만원\n4,500만원':'\n5,490만원')}}]}),handler:async context=>{failed=await snapshot(await onRequest(context));return onRequest({...context,request:request()});}});
 assert.equal(failed.body.code,'PRICE_AMBIGUOUS');assert.equal(retry.status,200);assert.equal(captures(retry).length,2);assert.equal(visions(retry).length,2);
});

test('warm OCR cache cannot bypass missing configuration, revoked Auth or a changed plate/advertisement',async t=>{
 for(const mode of['config','auth','sold','plate'])await t.test(mode,async()=>{let warmed=false,second;const options={detail:()=>new Response(page(warmed&&mode==='sold'?{advertisement:{status:'SOLD'}}:warmed&&mode==='plate'?{vehicleNo:'34나5678'}:{})),handler:async context=>{assert.equal((await snapshot(await onRequest(context))).status,200);warmed=true;if(mode==='auth')options.authStatus=401;second=await snapshot(await onRequest({...context,request:request(),env:mode==='config'?{...context.env,CLOUDFLARE_BROWSER_TOKEN:''}:context.env}));return new Response(JSON.stringify(second.body),{status:second.status});}};const r=await run(t,options);assert.notEqual(r.status,200);if(mode==='config')assert.equal(r.body.code,'SETUP_REQUIRED');if(mode==='auth')assert.equal(r.body.code,'AUTH_REQUIRED');assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);assert.equal(r.body.listing,undefined);});
});

test('429 capture Retry-After is preserved beyond 30 seconds and cooldown still revalidates each request',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});let captureCalls=0,first,held;
 const r=await run(t,{capture:()=>++captureCalls===1?new Response('PRIVATE',{status:429,headers:{'Retry-After':'120'}}):new Response(png(),{headers:{'Content-Type':'image/png'}}),handler:async context=>{first=await snapshot(await onRequest(context));t.mock.timers.setTime(105000);held=await snapshot(await onRequest({...context,request:request()}));t.mock.timers.setTime(220001);return onRequest({...context,request:request()});}});
 assert.equal(first.status,429);assert.equal(first.body.retryAfterSeconds,120);assert.equal(first.headers['retry-after'],'120');assert.equal(held.status,429);assert.equal(held.body.retryAfterSeconds,115);assert.equal(held.body.diagnostics.stage,'capture');assert.equal(held.body.diagnostics.upstreamStatus,429);assert.equal(r.status,200);assert.equal(captures(r).length,2);assert.equal(visions(r).length,1);assert.equal(r.calls.filter(call=>call.url.includes('/auth/v1/user')).length,3);
});

test('Vision cooldown stops another billed screenshot and recovers after the server delay',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});let visionCalls=0,first,held;
 const r=await run(t,{vision:()=>++visionCalls===1?new Response('PRIVATE',{status:429,headers:{'Retry-After':'60'}}):json({responses:[{fullTextAnnotation:{text:PLATE+'\n5,490만원'}}]}),handler:async context=>{first=await snapshot(await onRequest(context));held=await snapshot(await onRequest({...context,request:request()}));t.mock.timers.setTime(160001);return onRequest({...context,request:request()});}});
 assert.equal(first.body.code,'OCR_RATE_LIMITED');assert.equal(first.body.retryAfterSeconds,60);assert.equal(held.body.diagnostics.stage,'vision');assert.equal(r.status,200);assert.equal(captures(r).length,2);assert.equal(visions(r).length,2);
});

test('provider Retry-After HTTP dates and bounded day values survive 5xx without a hidden 503 response',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-18T12:00:00Z')});
 for(const [header,expected]of[['Wed, 18 Nov 2026 12:02:00 GMT',120],['3600',3600],['172800',86400],['-1',3],['PRIVATE invalid value',3],['Wed, 31 Feb 2027 00:00:00 GMT',3],['Mon, 18 Nov 2026 12:02:00 GMT',3]]){
  const r=await run(t,{captureResponse:new Response('PRIVATE',{status:503,headers:{'Retry-After':header}})});assert.equal(r.status,502);assert.equal(r.body.code,'CAPTURE_UNAVAILABLE');assert.equal(r.body.retryAfterSeconds,expected);assert.equal(r.res.headers.get('Retry-After'),String(expected));assert.equal(r.body.diagnostics.upstreamStatus,503);assert.equal(captures(r).length,1);assert.equal(visions(r).length,0);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE/);
 }
});

test('429/5xx never retry inside one request, while transient cooldown is distinct from successful price cache',async t=>{
 for(const status of[429,502,503,504]){let first,held;const r=await run(t,{captureResponse:new Response('PRIVATE',{status}),handler:async context=>{first=await snapshot(await onRequest(context));held=await snapshot(await onRequest({...context,request:request()}));return new Response(JSON.stringify(held.body),{status:held.status});}});assert.equal(first.body.diagnostics.priceCacheHit,false);assert.equal(held.body.diagnostics.priceCacheHit,false);assert.equal(captures(r).length,1);assert.equal(visions(r).length,0);assert.equal(first.status,status===429?429:502);}
});

test('runtime caches are isolated by the real fetch function used by each independent fixture',async t=>{
 const first=await run(t),second=await run(t);assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(captures(first).length,1);assert.equal(captures(second).length,1);assert.equal(second.body.diagnostics.priceCacheHit,false);
});

test('cache evicts beyond 32 identities without replacing verification or leaking data between plates',async t=>{
 let capturedFirst,hitLast;
 const r=await run(t,{detail:url=>new Response(page({vehicleId:Number(url.pathname.split('/').pop()),queryCarId:Number(url.pathname.split('/').pop())})),handler:async context=>{for(let i=0;i<33;i++){const result=await snapshot(await onRequest({...context,request:request({plate:PLATE,id:String(Number(ID)+i)})}));assert.equal(result.status,200);assert.equal(result.body.diagnostics.priceCacheHit,false);}capturedFirst=await snapshot(await onRequest({...context,request:request()}));hitLast=await snapshot(await onRequest({...context,request:request({plate:PLATE,id:String(Number(ID)+32)})}));return new Response(JSON.stringify(hitLast.body));}});
 assert.equal(capturedFirst.body.diagnostics.priceCacheHit,false);assert.equal(hitLast.body.diagnostics.priceCacheHit,true);assert.equal(captures(r).length,34);assert.equal(visions(r).length,34);assert.equal(r.calls.filter(call=>call.url.includes('/auth/v1/user')).length,35);
});

test('request/release headers and stage diagnostics expose fixed safe fields only',async t=>{
 const r=await run(t,{captureResponse:new Response('PRIVATE',{status:502,headers:{'Retry-After':'120'}})}),d=r.body.diagnostics;
 assert.match(r.res.headers.get('X-Request-ID'),/^[0-9a-f-]{36}$/);assert.equal(d.requestId,r.res.headers.get('X-Request-ID'));assert.equal(r.res.headers.get('X-Encar-Resolver-Release'),'2.137');assert.equal(d.endpoint,'encar-auto-price');assert.equal(d.stage,'capture');assert.equal(d.upstreamStatus,502);assert.equal(d.retryAfterSeconds,120);assert.equal(d.priceCacheHit,false);
 assert.deepEqual(Object.keys(d).sort(),['endpoint','priceCacheHit','requestId','resolverRelease','retryAfterSeconds','stage','upstreamStatus']);assert.doesNotMatch(JSON.stringify(d),/PRIVATE|https:|Bearer|token|base64|fullTextAnnotation/);
});

test('cancelling one concurrent capture cannot cancel another request or its settled result',async t=>{
 const controller=new AbortController();let entered,firstCapture=true,aborted,success;
 const started=new Promise(resolve=>entered=resolve);
 const r=await run(t,{capture:(_url,init)=>{if(firstCapture){firstCapture=false;entered();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}return new Response(png(),{headers:{'Content-Type':'image/png'}});},handler:async context=>{const first=onRequest({...context,request:request({plate:PLATE,id:ID},{signal:controller.signal})});await started;const second=onRequest({...context,request:request()});controller.abort();aborted=await snapshot(await first);success=await snapshot(await second);return onRequest({...context,request:request()});}});
 assert.equal(aborted.body.code,'REQUEST_ABORTED');assert.equal(success.status,200);assert.equal(r.status,200);assert.equal(r.body.diagnostics.priceCacheHit,true);assert.equal(r.body.listing.priceCheckedAt,success.body.listing.priceCheckedAt);assert.equal(captures(r).length,2);assert.equal(visions(r).length,1);assert.equal(r.calls.filter(call=>call.url.includes('/auth/v1/user')).length,3);
});

test('the same advertisement ID with a newly verified plate cannot inherit the old plate price',async t=>{
 let currentPlate=PLATE;
 const options={detail:()=>new Response(page({vehicleNo:currentPlate})),vision:()=>json({responses:[{fullTextAnnotation:{text:currentPlate+'\n판매가격 '+(currentPlate===PLATE?'5,490':'4,500')+'만원'}}]}),handler:async context=>{const first=await snapshot(await onRequest(context));assert.equal(first.body.listing.priceWon,54900000);currentPlate='34나5678';return onRequest({...context,request:request({plate:currentPlate,id:ID})});}};
 const r=await run(t,options);assert.equal(r.status,200);assert.equal(r.body.plate,currentPlate);assert.equal(r.body.listing.priceWon,45000000);assert.equal(r.body.diagnostics.priceCacheHit,false);assert.equal(captures(r).length,2);assert.equal(visions(r).length,2);
});

async function resolverFixture(status,body,headers={}){
 const original=await readFile(new URL('../functions/api/encar-auto-price.js',import.meta.url),'utf8');
 const code=original.replace("import { onRequest as resolveAdvertisement } from './encar.js';",'const resolveAdvertisement=async()=>new Response('+JSON.stringify(typeof body==='string'?body:JSON.stringify(body))+','+JSON.stringify({status,headers:{'Content-Type':typeof body==='string'?'text/html':'application/json',...headers}})+');')
  .replace("'../_shared/encar-price-ocr.mjs'",JSON.stringify(new URL('../functions/_shared/encar-price-ocr.mjs',import.meta.url).href))
  .replace("'../_shared/api-security.js'",JSON.stringify(new URL('../functions/_shared/api-security.js',import.meta.url).href));
 return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).onRequest;
}

test('resolver 502/429 preserve temporary verification failure and full Retry-After before any paid endpoint',async t=>{
 for(const [status,retry]of[[502,120],[429,60]]){
  const handler=await resolverFixture(status,{status:'error',diagnostics:{code:'SEARCH_UNAVAILABLE'}},{'Retry-After':String(retry)}),r=await run(t,{handler});
  assert.equal(r.status,502);assert.equal(r.body.code,'VERIFY_UNAVAILABLE');assert.equal(r.body.retryAfterSeconds,retry);assert.equal(r.res.headers.get('Retry-After'),String(retry));assert.equal(r.body.diagnostics.stage,'verify');assert.equal(r.body.diagnostics.upstreamStatus,status);noPaid(r);
 }
 const html=await run(t,{handler:await resolverFixture(503,'<h1>PRIVATE temporary error</h1>',{'Retry-After':'120'})});assert.equal(html.status,502);assert.equal(html.body.code,'VERIFY_UNAVAILABLE');assert.equal(html.body.retryAfterSeconds,120);noPaid(html);assert.doesNotMatch(JSON.stringify(html.body),/PRIVATE/);
 const absent=await run(t,{handler:await resolverFixture(504,{status:'error'})});assert.equal(absent.body.retryAfterSeconds,3);noPaid(absent);
});

test('resolver deterministic Auth/setup failures and genuine unverified vehicles keep their guards',async t=>{
 for(const [status,body,expectedStatus,expectedCode]of[
  [401,{status:'error'},401,'AUTH_REQUIRED'],[403,{status:'error'},403,'FORBIDDEN'],
  [503,{status:'error',diagnostics:{code:'SUPABASE_NOT_CONFIGURED'}},503,'SETUP_REQUIRED'],
  [200,{status:'unverified',plate:PLATE,listings:[]},409,'VEHICLE_UNVERIFIED']]){
  const r=await run(t,{handler:await resolverFixture(status,body,{'Retry-After':'120'})});assert.equal(r.status,expectedStatus);assert.equal(r.body.code,expectedCode);assert.equal(r.body.retryAfterSeconds,undefined);assert.equal(r.res.headers.get('Retry-After'),null);noPaid(r);
 }
});
