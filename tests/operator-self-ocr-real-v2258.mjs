// Explicit opt-in integration: real local CPU OCR + actual Pages handler,
// with only the external operator Auth/RPC responses replaced by a fixture.
// Never uses real account credentials, Google, Storage, or an operating DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { onRequest } from '../functions/api/operator-ocr.js';

const [configFile,manifestFile,outputFile]=process.argv.slice(2);
if(!configFile||!manifestFile)throw Error('Usage: node tests/operator-self-ocr-real-v2258.mjs PRIVATE_LOCAL_ENV SYNTHETIC_MANIFEST [REPORT_JSON]');
const values=Object.fromEntries(fs.readFileSync(configFile,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const at=x.indexOf('=');return[x.slice(0,at),x.slice(at+1).replace(/^(['"])(.*)\1$/,'$2')];}));
assert.match(values.SNOTE_OCR_SERVICE_TOKEN||'',/^[A-Za-z0-9_-]{32,256}$/);
const ACTOR='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222',JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c3ludGhldGlj';
const env={SUPABASE_URL:'https://operator-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SNOTE_OPERATOR_OCR_PROVIDER:'self',SNOTE_SELF_OCR_URL:values.SNOTE_SELF_OCR_URL||'http://127.0.0.1:8765/ocr/vehicle-registration',SNOTE_OCR_ALLOW_LOCALHOST:'1',SNOTE_OCR_SERVICE_TOKEN:values.SNOTE_OCR_SERVICE_TOKEN};
const target=new URL(env.SNOTE_SELF_OCR_URL);assert(['127.0.0.1','localhost','[::1]'].includes(target.hostname));assert.equal(target.protocol,'http:');
const original=globalThis.fetch;let authChecks=0,modelRequests=0;
globalThis.fetch=async(input,options={})=>{const u=new URL(input);if(u.origin===env.SUPABASE_URL){assert.equal(options.headers.Authorization,'Bearer '+JWT);if(u.pathname==='/auth/v1/user')return Response.json({id:ACTOR,is_anonymous:false});assert.equal(u.pathname,'/rest/v1/rpc/snote_operator_context');authChecks++;return Response.json({allowed:true,actorId:ACTOR,sessionId:SESSION});}assert.equal(u.href,target.href,'Only the selected loopback CPU server can receive an image');modelRequests++;return original(input,options);};
const manifest=fs.readFileSync(manifestFile,'utf8').trim().split(/\r?\n/).map(x=>JSON.parse(x));
const cases=[];
try{for(const [index,item]of manifest.entries()){
 const imagePath=path.resolve(path.dirname(manifestFile),item.image),bytes=fs.readFileSync(imagePath),form=new FormData();form.append('file',new Blob([bytes],{type:imagePath.toLowerCase().endsWith('.png')?'image/png':'image/jpeg'}),'synthetic-registration.jpg');
 const response=await onRequest({request:new Request('http://127.0.0.1:3000/api/operator-ocr',{method:'POST',headers:{Origin:'http://127.0.0.1:3000',Authorization:'Bearer '+JWT},body:form}),env});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify({caseIndex:index+1,code:result.code}));assert.deepEqual(Object.keys(result.fields),['plate','vin','model','modelYear']);
 const truth=item.truth||item.expected||item.fields,exact=[],manual=[];assert(truth);
 for(const key of ['plate','vin','model','modelYear']){const f=result.fields[key];if(f.autoFill){assert.equal(f.needsReview,false);assert.equal(f.value,String(truth[key]),'Wrong automatic field '+key+' in synthetic case '+(index+1));exact.push(key);}else manual.push(key);}
 if(index<2)assert.equal(exact.length,4,'Normal and different-years fixtures must fill all four correctly');
 if(truth.modelYear===null){assert.equal(result.fields.modelYear.autoFill,false);assert.equal(result.fields.modelYear.value,null);}
 cases.push({caseIndex:index+1,exactAutomaticFields:exact,manualReviewFields:manual,elapsedMs:result.elapsedMs,originalImageSha256:createHash('sha256').update(bytes).digest('hex')});
 }}finally{globalThis.fetch=original;}
const report={ok:true,mode:'real-local-CPU-model-and-Pages-handler',operatorAuth:'synthetic-auth-and-live-session-RPC-fixture',modelRequests,authChecks,syntheticOnly:true,googleRequests:0,operatingDatabaseReads:0,operatingDatabaseWrites:0,cases,sourceHashes:Object.fromEntries(['functions/api/operator-ocr.js','functions/api/operator.js','services/registration-ocr/snote_ocr/app.py','services/registration-ocr/snote_ocr/engine.py','services/registration-ocr/snote_ocr/extraction.py'].map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
if(outputFile)fs.writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,cases:cases.length,modelRequests,authChecks,wrongAutomaticFields:0}));
