import test from 'node:test';
import assert from 'node:assert/strict';
import './encar/html-rewriter-setup.mjs';
import { onRequest } from '../functions/api/encar-auto-price.js';

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
  if(url.origin==='https://fem.encar.com')return options.detailResponse??new Response(page(options.vehicle,options.visible||''),{headers:{'Content-Type':'text/html'}});
  if(url.origin==='https://encar.spb.ru')return new Response('<div class="no-results">Ничего не найдено</div>',{headers:{'Content-Type':'text/html'}});
  if(url.origin==='https://api.cloudflare.com')return options.capture?.(url,init)??options.captureResponse??new Response(png(),{headers:{'Content-Type':'image/png'}});
  if(url.origin==='https://vision.googleapis.com')return options.vision?.(url,init)??options.visionResponse??json({responses:[{fullTextAnnotation:{text:options.text??('차량번호 '+PLATE+'\n판매가격 5,490만원\n월 납입금 29만원\nPRIVATE_OCR_ACCOUNT')}}]});
  assert.fail('Unexpected outbound destination '+url.origin);
 };
 console.info=(...args)=>logs.push(args.join(' '));
 try{const res=await onRequest({request:options.request??request(),env:{...ENV,...options.env}});return {res,status:res.status,body:await res.json(),calls,logs};}
 finally{globalThis.fetch=original;console.info=info;}
}
const captures=result=>result.calls.filter(call=>call.url.startsWith('https://api.cloudflare.com/'));
const visions=result=>result.calls.filter(call=>call.url.startsWith('https://vision.googleapis.com/'));
const noPaid=result=>{assert.equal(captures(result).length,0);assert.equal(visions(result).length,0);};

test('GET returns only a boolean setup status and never calls external services',async t=>{
 const r=await run(t,{request:new Request(ORIGIN+'/api/encar-auto-price')});assert.deepEqual(r.body,{ok:true,configured:true});assert.equal(r.calls.length,0);
 const missing=await run(t,{request:new Request(ORIGIN+'/api/encar-auto-price'),env:{CLOUDFLARE_BROWSER_TOKEN:''}});assert.deepEqual(missing.body,{ok:true,configured:false});assert.equal(missing.calls.length,0);
});
test('verified current canonical vehicle is rendered once and OCR produces a reviewed KRW proposal only',async t=>{
 const start=Date.now(),r=await run(t);assert.equal(r.status,200);assert.equal(r.body.plate,PLATE);assert(Number.isFinite(Date.parse(r.body.verifiedAt)));
 assert.deepEqual({...r.body.listing,priceCheckedAt:'time'},{id:ID,priceWon:54900000,priceCheckedAt:'time',priceSource:'encar.com-ocr',priceStatus:'review'});
 assert(Date.parse(r.body.listing.priceCheckedAt)>=start&&Date.parse(r.body.listing.priceCheckedAt)<=Date.now());
 assert.equal(captures(r).length,1);assert.equal(visions(r).length,1);
 assert.doesNotMatch(JSON.stringify(r.body)+r.logs.join(''),/PRIVATE_|synthetic_private|MUST_NOT_USE_|base64|fullTextAnnotation/);
 const capture=captures(r)[0];assert.equal(capture.url,'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/browser-rendering/screenshot');
 assert.deepEqual(capture.init.headers,{Authorization:'Bearer '+BROWSER,'Content-Type':'application/json',Accept:'image/png'});
 const payload=JSON.parse(capture.init.body);assert.equal(payload.url,'https://fem.encar.com/cars/detail/'+ID);assert.deepEqual(Object.keys(payload).sort(),['gotoOptions','screenshotOptions','url','viewport']);assert.equal(payload.gotoOptions.waitUntil,'networkidle2');assert(payload.gotoOptions.timeout<=15000);
 assert.deepEqual(payload.viewport,{width:1440,height:1200,deviceScaleFactor:1});assert.equal(payload.screenshotOptions.fullPage,false);
 const vision=visions(r)[0];assert.equal(vision.url,'https://vision.googleapis.com/v1/images:annotate');assert.equal(vision.init.headers['x-goog-api-key'],VISION);assert.equal(vision.init.headers.Authorization,undefined);
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
