'use strict';
// Uses an already installed Miniflare/Workerd. No package is installed and every
// outbound Worker fetch is intercepted locally: KMA/production are never called.
// Optional: SNOTE_MINIFLARE_MODULE=/path/to/miniflare node tests/weather-runtime.cjs
// Optional: SNOTE_WEATHER_RUNTIME_ARTIFACTS=/path/to/artifacts
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const ROOT=path.join(__dirname,'..'),FEED='https://www.kma.go.kr/XML/weather/sfc_web_map.xml';
function miniflareModule(){
 if(process.env.SNOTE_MINIFLARE_MODULE)return require(process.env.SNOTE_MINIFLARE_MODULE);
 try{return require('miniflare');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
 // Managed cloud tests may share Wrangler's preinstalled dependencies.
 const caches=process.env.SNOTE_NPM_CACHE||'/workspace/work/npm-cache/_npx';
 if(fs.existsSync(caches))for(const entry of fs.readdirSync(caches).sort().reverse()){
  const candidate=path.join(caches,entry,'node_modules/miniflare');if(fs.existsSync(path.join(candidate,'package.json')))return require(candidate);
 }
 return null;
}
function fixture(encoding){
 const d=new Date(Date.now()+32400000),xml='<?xml version="1.0" encoding="'+encoding+'"?><weather year="'+d.getUTCFullYear()+'" month="'+(d.getUTCMonth()+1)+'" day="'+d.getUTCDate()+'" hour="'+d.getUTCHours()+'"><local stn_id="108" desc="-" ta="12.3">SEOUL</local></weather>',i=xml.indexOf('SEOUL');
 return Buffer.concat([Buffer.from(xml.slice(0,i)),encoding==='EUC-KR'?Buffer.from([0xbc,0xad,0xbf,0xef]):Buffer.from('서울'),Buffer.from(xml.slice(i+5))]);
}
const worker=`import {onRequest,decodeKmaFeed} from './weather-runtime-source.mjs';
export default {async fetch(request,env){
 if(new URL(request.url).pathname!=='/codec')return onRequest({request,env});
 const result={};
 for(const label of ['euc-kr','ks_c_5601-1987','windows-949'])result[label]=new TextDecoder(label,{fatal:true}).decode(new Uint8Array([0xbc,0xad,0xbf,0xef]));
 for(const label of ['EUC-KR','CP949','KS_C_5601-1987']){
  const xml='<?xml version="1.0" encoding="'+label+'"?><weather>SEOUL</weather>',i=xml.indexOf('SEOUL'),a=new TextEncoder().encode(xml.slice(0,i)),b=new TextEncoder().encode(xml.slice(i+5)),bytes=new Uint8Array(a.length+4+b.length);bytes.set(a);bytes.set([0xbc,0xad,0xbf,0xef],a.length);bytes.set(b,a.length+4);result['feed:'+label]=decodeKmaFeed(bytes,'application/xml; charset='+label);
 }
 return Response.json(result);
}};`;
(async()=>{
 const lib=miniflareModule();if(!lib){console.log('SKIP weather Workerd runtime regression: set SNOTE_MINIFLARE_MODULE to an installed Miniflare package');return;}
 const source=fs.readFileSync(path.join(ROOT,'functions/api/weather.js'),'utf8'),report={sourceSha256:createHash('sha256').update(source).digest('hex'),externalNetworkRequests:0,runs:[]};
 for(const compatibilityDate of ['2024-11-01','2026-10-19']){
  let encoding='EUC-KR';const outbound=[];
  const legacy={rootPath:__dirname,workers:[{name:'weather-runtime-regression',rootPath:__dirname,modulesRoot:__dirname,modules:[{type:'ESModule',path:path.join(__dirname,'weather-runtime-worker.mjs'),contents:worker},{type:'ESModule',path:path.join(__dirname,'weather-runtime-source.mjs'),contents:source}],compatibilityDate,cacheAPI:false,outboundService:async request=>{
   assert.equal(request.url,FEED,'All synthetic Worker traffic must stay scoped to the fixed KMA feed');outbound.push({url:request.url,synthetic:true});return new Response(fixture(encoding),{headers:{'Content-Type':'application/xml; charset='+encoding}});
  }}]};
  const mf=new lib.Miniflare(lib.convertV4MiniflareOptions?lib.convertV4MiniflareOptions(legacy):legacy);
  try{
   const codec=await(await mf.dispatchFetch('http://weather-runtime.test/codec')).json();for(const label of ['euc-kr','ks_c_5601-1987','windows-949'])assert.equal(codec[label],'서울');for(const label of ['EUC-KR','CP949','KS_C_5601-1987'])assert(codec['feed:'+label].includes('<weather>서울</weather>'));
   const endpoints=[];
   for(const charset of ['EUC-KR','UTF-8']){encoding=charset;for(const fresh of [false,true]){
    const before=outbound.length,response=await mf.dispatchFetch('http://weather-runtime.test/api/weather?station=108'+(fresh?'&refresh=1':'')),body=await response.json();
    assert.equal(response.status,200,JSON.stringify({compatibilityDate,charset,fresh,body}));assert.equal(body.ok,true);assert.equal(body.region,'서울');assert.equal(body.temperature,12.3);assert.equal(body.station,108);assert.equal(body.stale,false);assert.equal(outbound.length,before+1,'A successful Worker fetch must actually reach the synthetic upstream');endpoints.push({charset,fresh,status:response.status,body});
   }}
   report.runs.push({compatibilityDate,codec,endpoints,syntheticOutbound:outbound});console.log('PASS Workerd '+compatibilityDate+': EUC-KR decoding plus plain/refresh UTF-8 and EUC-KR endpoint requests');
  }finally{await mf.dispose();}
 }
 if(process.env.SNOTE_WEATHER_RUNTIME_ARTIFACTS){fs.mkdirSync(process.env.SNOTE_WEATHER_RUNTIME_ARTIFACTS,{recursive:true});fs.writeFileSync(path.join(process.env.SNOTE_WEATHER_RUNTIME_ARTIFACTS,'current-handler-report.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({passed:report.runs.length,externalNetworkRequests:report.externalNetworkRequests,sourceSha256:report.sourceSha256}));
})().catch(error=>{console.error(error);process.exitCode=1;});
