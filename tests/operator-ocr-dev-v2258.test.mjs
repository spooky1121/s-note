import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDevelopmentServer } from '../scripts/operator-ocr-dev.mjs';
import { writeFile } from 'node:fs/promises';

const ACTOR='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj';
const env={SUPABASE_URL:'https://operator-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',SNOTE_OPERATOR_OCR_PROVIDER:'self',SNOTE_SELF_OCR_URL:'http://127.0.0.1:8765/ocr/vehicle-registration',SNOTE_OCR_ALLOW_LOCALHOST:'1',SNOTE_OCR_SERVICE_TOKEN:'synthetic_service_token_1234567890123456'};
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const result={ok:true,engine:'paddleocr-self-hosted',fields:Object.fromEntries(Object.entries({plate:'123가4567',vin:'KMHD641EERU123456',model:'가상 자동차',modelYear:'2024'}).map(([k,value])=>[k,{value,needsReview:false,autoFill:true,confidence:.99,reasons:[],polygon:null}])),image:{width:1,height:1,rotation:0},elapsedMs:15,fullText:'sensitive-original-text-must-be-dropped'};
const nativeFetch=globalThis.fetch,calls=[];let allowed=true,providerFail=false;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(input);calls.push(url.origin+url.pathname);const headers=new Headers(init.headers);
 if(url.origin===env.SUPABASE_URL){assert.equal(headers.get('apikey'),env.SUPABASE_PUBLISHABLE_KEY);assert.equal(headers.get('Authorization'),'Bearer '+JWT);
  if(url.pathname==='/auth/v1/user')return Response.json({id:ACTOR,is_anonymous:false});
  assert.equal(url.pathname,'/rest/v1/rpc/snote_operator_context');return Response.json({allowed,actorId:ACTOR,sessionId:SESSION,email:'synthetic@example.invalid'});
 }
 assert.equal(url.href,env.SNOTE_SELF_OCR_URL);assert.equal(headers.get('Authorization'),'Bearer '+env.SNOTE_OCR_SERVICE_TOKEN);assert.equal(init.body.get('file').name,'registration.png');assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()),PNG);
 if(providerFail)return Response.json({error:'private OCR contents and resident address'}, {status:503});
 return Response.json(result);
};
const server=createDevelopmentServer({env}),checks=[];
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const get=async(path,options={})=>nativeFetch(origin+path,{redirect:'manual',...options});
 const post=async(path,body,options={})=>get(path,{method:'POST',headers:{Authorization:'Bearer '+JWT,Origin:origin,'Content-Type':'application/json',...options.headers},body:JSON.stringify(body)});
 const sendImage=()=>{const f=new FormData();f.append('file',new Blob([PNG],{type:'image/png'}),'sensitive-filename.png');return get('/api/operator-ocr',{method:'POST',headers:{Authorization:'Bearer '+JWT,Origin:origin},body:f});};
 let r=await get('/');assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'/operator.html#ocr-lab');checks.push('root redirects to the existing operator lab entry');
 r=await get('/operator.html');assert.equal(r.status,200);assert.match(await r.text(),/operator-login/);assert.match(r.headers.get('Cache-Control'),/no-store/);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');r=await get('/operator.html',{method:'HEAD'});assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,0);checks.push('operator HTML and HEAD are served with no-store and nosniff');
 r=await get('/assets/snote-brand.png?v=synthetic');assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/png');checks.push('public asset version queries retain MIME type');
 for(const p of['/.env','/services/registration-ocr/snote_ocr/app.py','/tests/ocr-security.test.mjs','/scripts/operator-ocr-dev.mjs','/assets/.env','/assets/forms/reference.pdf','/assets/%2e%2e%2f%2e%2e%2f.env','/api/ocr'])assert.equal((await get(p)).status,404,p);checks.push('private, traversal, PDF and unrelated API paths cannot be served');
 r=await get('/api/operator',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"context"}'});assert.equal(r.status,401);r=await post('/api/operator',{action:'context'},{headers:{Origin:'https://foreign.invalid'}});assert.equal(r.status,403);assert.equal(calls.length,0);checks.push('missing bearer and foreign origins fail before authentication or OCR');
 r=await post('/api/operator',{action:'context'});assert.equal(r.status,200);const context=await r.json();assert.deepEqual(Object.keys(context).sort(),['actorId','allowed','email','ok','sessionId']);assert.equal(context.actorId,ACTOR);assert.equal(context.allowed,true);assert(!JSON.stringify(context).includes('recheck'));checks.push('real operator helper validates a mocked remote Auth identity and live session without service-role or Google key');
 const count=calls.length;r=await post('/api/operator',{action:'vehicles'});assert.equal(r.status,503);assert.equal(calls.length,count);checks.push('local context API cannot dispatch production list or write actions');
 r=await get('/api/operator',{method:'POST',headers:{Authorization:'Bearer '+JWT,Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(4097)});assert.equal(r.status,413);checks.push('request byte limits reject oversized context payloads');
 r=await sendImage();assert.equal(r.status,200);const data=await r.json();assert.equal(data.fields.modelYear.value,'2024');assert.equal(data.engine,'paddleocr-self-hosted');assert(!JSON.stringify(data).includes('sensitive-original'));assert(calls.filter(x=>x.endsWith('/snote_operator_context')).length>=3);checks.push('native local multipart reaches authenticated gateway, strips filename/raw text and rechecks session');
 allowed=false;r=await sendImage();assert.equal(r.status,403);r=await post('/api/operator',{action:'context'});assert.equal(r.status,403);checks.push('revoked operator scope fails on both OCR and context');
 allowed=true;providerFail=true;r=await sendImage();assert.equal(r.status,503);assert(!(await r.text()).includes('resident address'));assert(calls.every(x=>x.startsWith(env.SUPABASE_URL)||x.startsWith('http://127.0.0.1:8765/')));checks.push('provider failure stays sanitized with no Google fallback');
 const proof={ok:true,checks,syntheticOnly:true,realGoogleCalls:0,operatingDatabaseReads:0,operatingDatabaseWrites:0,realModelInThisRunnerTest:false};
 if(process.env.SNOTE_OCR_DEV_TEST_OUT)await writeFile(process.env.SNOTE_OCR_DEV_TEST_OUT,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({ok:true,checks:checks.length}));
}finally{globalThis.fetch=nativeFetch;await new Promise(resolve=>server.close(resolve));}
