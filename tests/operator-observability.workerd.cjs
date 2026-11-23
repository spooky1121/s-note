'use strict';
// Real Pages router/workerd, synthetic Auth/DB/SOLAPI/Vision/Storage only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const ORIGIN='https://s-note.example',USER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222',COMPANY='33333333-3333-4333-8333-333333333333',FILE='44444444-4444-4444-8444-444444444444';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const ENV={SUPABASE_URL:'https://operator-runtime.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-only',GOOGLE_VISION_API_KEY:'synthetic-vision',SOLAPI_API_KEY:'synthetic_key',SOLAPI_API_SECRET:'synthetic_solapi_secret'};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,1,2]);
(async()=>{
 const events=[],providerPaths=[];let operatorAllowed=true;
 const options={modules:true,script:fs.readFileSync(process.argv[2],'utf8'),compatibilityDate:process.env.SNOTE_TEST_COMPAT_DATE||'2026-11-01',bindings:ENV,cf:false,
 serviceBindings:{ASSETS:()=>new WorkerResponse('synthetic static')},
 outboundService:async request=>{
  const url=new URL(request.url);
  if(url.origin===ENV.SUPABASE_URL){
   if(url.pathname==='/auth/v1/user')return WorkerResponse.json({id:USER});
   if(url.pathname==='/rest/v1/zc_members')return WorkerResponse.json([{user_id:USER}]);
   if(url.pathname.endsWith('/snote_operator_context'))return WorkerResponse.json({allowed:operatorAllowed,actorId:USER,sessionId:SESSION});
   if(url.pathname.endsWith('/snote_service_event')){assert.equal(request.headers.get('Authorization'),'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);events.push((await request.json()).p_event);return WorkerResponse.json({ok:true});}
   if(url.pathname.endsWith('/snote_operator_services'))return WorkerResponse.json({service:'sms',items:[{displayName:'합성 딜러',model:'합성 차량',destination:'01000000000',customerSubmittedAt:null}],metrics:[{key:'requests',value:0,label:'관측 요청',unit:'건'}],notes:[],page:1,pageSize:20,total:1});
   if(url.pathname.endsWith('/snote_operator_account_avatar'))return WorkerResponse.json({userId:USER,bucket:'snote-profile-photos',path:`${COMPANY}/${USER}/${FILE}.png`});
   if(url.pathname===`/storage/v1/object/authenticated/snote-profile-photos/${COMPANY}/${USER}/${FILE}.png`){assert.equal(request.headers.get('Authorization'),'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);return new WorkerResponse(png,{headers:{'Content-Type':'image/png'}});}
  }
  if(url.origin==='https://vision.googleapis.com')return WorkerResponse.json({responses:[{fullTextAnnotation:{text:'HIDDEN_OCR_CONTENT'}}]});
  if(url.origin==='https://api.solapi.com'){
   assert.equal(request.method,'GET');assert.match(request.headers.get('Authorization'),/^HMAC-SHA256 /);providerPaths.push(url.pathname);
   if(url.pathname==='/cash/v1/balance')return WorkerResponse.json({balance:12345,point:0});
   if(url.pathname==='/pricing/v1/messaging')return WorkerResponse.json({countryId:'82',serviceMethod:'MT',sms:10,lms:30,mms:100,ata:7});
   if(url.pathname==='/messages/v4/list')return WorkerResponse.json({messageList:{SYNTHETIC_MESSAGE:{messageId:'SYNTHETIC_MESSAGE',dateCreated:'2026-11-23T00:00:00Z',to:'01000000000',type:'SMS',status:'COMPLETE',statusCode:'4000',text:'HIDDEN_SMS_OTP',customFields:{private:'HIDDEN_CUSTOM'}}}});
  }
  throw Error('Unexpected external request '+url.origin+url.pathname);
 }};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 const waitFor=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Background observation did not finish');};
 const operator=body=>runtime.dispatchFetch(ORIGIN+'/api/operator',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+JWT,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const ocr=await runtime.dispatchFetch(ORIGIN+'/api/ocr',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+JWT,'Content-Type':'image/png','Content-Length':String(png.length)},body:png});
  assert.equal(ocr.status,200);const raw=await ocr.text();assert.equal(JSON.parse(raw).ok,true);
  await waitFor(()=>events.some(e=>e.service==='vision')&&events.some(e=>e.service==='http'&&e.endpoint==='/api/ocr'));
  assert.equal(events.find(e=>e.service==='vision').userId,USER);assert.equal(events.find(e=>e.service==='vision').ok,true);assert.equal(events.find(e=>e.service==='http').responseBytes,new TextEncoder().encode(raw).byteLength);
  assert(!JSON.stringify(events).includes('HIDDEN_OCR'));assert(!JSON.stringify(events).includes(ENV.GOOGLE_VISION_API_KEY));
  console.log('PASS compiled workerd OCR: real response stream preserved, verified OCR event and exact observed response byte count');
  const r=await operator({action:'services',service:'sms',query:{page:1}});assert.equal(r.status,200);const sms=await r.json();assert.equal(sms.metrics.find(m=>m.key==='balance').value,12345);assert.equal(sms.metrics.find(m=>m.key==='lmsUnitPrice').value,30);assert.equal(sms.providerItems.length,1);assert.equal(providerPaths.length,3);assert.equal(sms.items[0].model,'합성 차량');assert(!JSON.stringify(sms).includes('HIDDEN_'));assert(!JSON.stringify(sms).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
  console.log('PASS compiled workerd operator SMS: actual read-only provider transports + DB metadata, no OTP/body/credential disclosure');
  const avatar=await operator({action:'account-avatar',userId:USER});assert.equal(avatar.status,200);assert.equal((await avatar.json()).image,'data:image/png;base64,'+Buffer.from(png).toString('base64'));
  operatorAllowed=false;const denied=await operator({action:'services',service:'server'});assert.equal(denied.status,403);assert.equal((await denied.json()).ok,false);
  await waitFor(()=>events.filter(e=>e.service==='http'&&e.endpoint==='/api/operator').length>=3);
  console.log('PASS compiled workerd bounded private avatar and live operator revocation deny, anonymous API counters contain no payloads');
  console.log(JSON.stringify({passed:3,compatibilityDate:options.compatibilityDate,syntheticOnly:true,events:events.length,providerReads:providerPaths.length,realProviderOrDatabaseCalls:0}));
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
