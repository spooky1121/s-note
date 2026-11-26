'use strict';
// Actual Pages router/middleware + native Worker image/FormData/crypto; no real outbound service.
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID,createHash}=require('node:crypto');
const{Miniflare,Response:WR,convertV4MiniflareOptions}=require('miniflare');
const ORIGIN='https://scanner-worker.example',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ACTOR='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222',JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c3ludGhldGlj';
const ENV={SUPABASE_URL:'https://scanner-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-only'};
// Tiny, fully formed synthetic PNG independent of actual customer scans.
const IMAGE=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
(async()=>{const calls=[],records=new Map(),ops=new Map(),objects=new Map();let lost=true;
 const options={modules:true,script:fs.readFileSync(process.argv[2],'utf8'),compatibilityDate:process.env.SNOTE_TEST_COMPAT_DATE||'2026-10-24',cf:false,bindings:ENV,serviceBindings:{ASSETS:()=>new WR('synthetic-static')},outboundService:async req=>{
  const url=new URL(req.url);assert.equal(url.origin,ENV.SUPABASE_URL);calls.push(url.pathname);const reply=(v,status=200)=>WR.json(v,{status}),ok=v=>reply({ok:true,companyId:COMPANY,...v});
  if(url.pathname.startsWith('/rest/v1/rpc/')){const b=await req.json();if(url.pathname.endsWith('/snote_office_context')){assert.equal(req.headers.get('apikey'),ENV.SUPABASE_PUBLISHABLE_KEY);assert.equal(req.headers.get('Authorization'),'Bearer '+JWT);assert.equal(b.p_company,COMPANY);return ok({actorId:ACTOR,sessionId:SESSION});}
   assert(url.pathname.endsWith('/snote_scanner_action'));assert.equal(req.headers.get('Authorization'),'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);assert.equal(b.p_actor,ACTOR);assert.equal(b.p_session,SESSION);assert.equal(b.p_company,COMPANY);const p=b.p_payload;
   if(b.p_action==='list')return ok({items:[...records.values()],nextCursor:null});if(b.p_action==='cleanup_claim')return ok({files:[]});
   if(b.p_action==='prepare'){assert.equal(p.size,IMAGE.length);assert.equal(p.mimeType,'image/png');assert.equal(p.sha256,createHash('sha256').update(IMAGE).digest('hex'));let op=ops.get(p.requestId);if(op?.result)return ok({...op.result,duplicate:true});if(!op){const id=randomUUID();op={...p,id,path:COMPANY+'/inbox/'+id+'.png',stage:'pending'};ops.set(p.requestId,op);}return ok({requestId:p.requestId,id:op.id,path:op.path,stage:op.stage});}
   if(b.p_action==='verify'){const op=ops.get(p.requestId);assert(objects.has(op.path));op.stage='verified';return ok({requestId:p.requestId,id:op.id,path:op.path,stage:op.stage});}
   if(b.p_action==='publish'){const op=ops.get(p.requestId);assert.equal(op.stage,'verified');const item={id:op.id,revision:1,filename:op.filename,mimeType:op.mimeType,size:op.size,createdAt:'2026-11-26T00:00:00.000123Z',updatedAt:'2026-11-26T00:00:00.000123Z'};records.set(op.id,item);op.result={item,duplicate:false};if(lost){lost=false;throw Error('Synthetic lost publish ACK');}return ok(op.result);}
   if(b.p_action==='status')return ok({...ops.get(p.requestId).result,duplicate:true});
   if(b.p_action==='read'){const item=records.get(p.id);if(!item||item.revision!==p.revision)return reply({code:'40001'},409);const op=[...ops.values()].find(x=>x.id===p.id);return ok({item,path:op.path,sha256:op.sha256});}
   if(b.p_action==='delete'){const item=records.get(p.id);if(!item||item.revision!==p.expectedRevision)return reply({code:'40001'},409);records.delete(p.id);return ok({deleted:true,id:p.id,revision:2,duplicate:false});}throw Error('Unexpected action');
  }
  assert(url.pathname.startsWith('/storage/v1/object/snote-scanner-inbox/'));assert.equal(req.headers.get('Authorization'),'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);const path=decodeURIComponent(url.pathname.split('/snote-scanner-inbox/')[1]);
  if(req.method==='POST'){assert.equal(req.headers.get('x-upsert'),'false');const bytes=Buffer.from(await req.arrayBuffer());assert.deepEqual(bytes,IMAGE);objects.set(path,bytes);return reply({Key:'synthetic-private-object'});}assert.equal(req.method,'GET');return new WR(objects.get(path),{headers:{'Content-Type':'image/png'}});
 }};
 const mf=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 const send=async(body,{headers={},method='POST'}={})=>{const req=new Request(ORIGIN+'/api/scanner',{method,headers:{Origin:ORIGIN,Authorization:'Bearer '+JWT,...(!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},...(method==='POST'?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});return mf.dispatchFetch(req.url,{method:req.method,headers:req.headers,...(method==='POST'?{body:await req.arrayBuffer()}:{})});};
 const form=()=>{const f=new FormData();for(const[k,v]of Object.entries({action:'upload',companyId:COMPANY,requestId:randomUUID()}))f.append(k,v);f.append('file',new Blob([IMAGE],{type:'image/png'}),'synthetic.png');return f;};
 try{assert.equal((await send({}, {headers:{Authorization:''}})).status,401);assert.equal((await send({}, {headers:{Origin:'https://foreign.invalid'}})).status,403);assert.equal((await send(undefined,{method:'GET'})).status,405);assert.equal(calls.length,0);
  const list=await send({action:'list',companyId:COMPANY,cursor:null});assert.equal(list.status,200);assert.deepEqual((await list.json()).items,[]);
  const uploaded=await send(form()),saved=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(saved));assert.equal(saved.item.revision,1);assert.equal(saved.duplicate,true);assert.equal(saved.item.createdAt,'2026-11-26T00:00:00.000123Z');assert.match(uploaded.headers.get('Cache-Control'),/no-store/);assert(!JSON.stringify(saved).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));assert(!JSON.stringify(saved).includes('snote-scanner-inbox'));
  const image=await send({action:'read',companyId:COMPANY,id:saved.item.id,revision:1});assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),IMAGE);
  const deleted=await send({action:'delete',companyId:COMPANY,id:saved.item.id,expectedRevision:1,requestId:randomUUID()});assert.equal(deleted.status,200);assert.equal((await deleted.json()).deleted,true);assert.equal((await(await send({action:'list',companyId:COMPANY,cursor:null})).json()).items.length,0);assert(!calls.some(p=>/observations|telemetry/.test(p)));
  console.log('PASS actual Pages/workerd scanner route, bearer/origin/method checks, native multipart+PNG+SHA256, microsecond metadata, lost publish ACK, private binary read and CAS delete; no real outbound requests.');
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
