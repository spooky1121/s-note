'use strict';
// Build with Wrangler's real Pages router before running. Every outbound call
// is intercepted locally; no Naver, Supabase or production traffic is sent.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://s-note.example',OUT=process.env.SNOTE_NEWS_RUNTIME_DIR||'/workspace/work/dashboard-news-v2241/news-api-runtime';
const bundle=process.argv[2];if(!bundle)throw Error('Pass the compiled Pages Worker index.js path');fs.mkdirSync(OUT,{recursive:true});
const bindings={NAVER_NEWS_CLIENT_ID:'synthetic-news-client',NAVER_NEWS_CLIENT_SECRET:'synthetic-news-secret',SUPABASE_URL:'https://news-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-telemetry-key'};
const headline={title:'[자동차 칼럼] 전기차를 보는 새로운 기준',originallink:'https://motor.publicnews.kr/column/1',link:'https://n.news.naver.com/article/001/1',description:'자동차 칼럼 합성 테스트',pubDate:new Date().toUTCString().replace('GMT','+0000')};
const report={compatibilityDate:'2026-10-19',syntheticOnly:true,externalNetworkRequests:0,runs:[],sourceHashes:Object.fromEntries(['functions/api/automotive-columns.js','functions/_shared/api-security.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')]))};
async function scenario(mode){let calls=0;const outbound=[];
 const options={modules:true,script:fs.readFileSync(bundle,'utf8'),compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],bindings:mode==='missing'?{SUPABASE_URL:bindings.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:bindings.SUPABASE_SERVICE_ROLE_KEY}:bindings,cf:false,serviceBindings:{ASSETS:()=>new WorkerResponse('static-asset')},outboundService:async request=>{
  calls++;const u=new URL(request.url);assert.equal(u.origin,'https://openapi.naver.com','No other origin, article fetch or Supabase telemetry is permitted');assert.equal(u.pathname,'/v1/search/news.json');assert.equal(request.headers.get('x-naver-client-id'),bindings.NAVER_NEWS_CLIENT_ID);assert.equal(request.headers.get('x-naver-client-secret'),bindings.NAVER_NEWS_CLIENT_SECRET);assert(['자동차 칼럼','자동차 기고'].includes(u.searchParams.get('query')));outbound.push({origin:u.origin,path:u.pathname,query:u.searchParams.get('query')});
  if(mode==='failure')return new WorkerResponse('synthetic secret must not escape',{status:503});
  const items=mode==='empty'?[{...headline,title:'전기차 일반 뉴스'}]:[headline];return WorkerResponse.json({total:items.length,start:1,display:items.length,items});
 }};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 try{
  const fetch=(suffix='',extra={})=>runtime.dispatchFetch(ORIGIN+'/api/automotive-columns'+suffix,extra);
  const response=await fetch(),body=await response.json();assert.notEqual(body.code,'NOT_FOUND','The real Pages middleware must recognize the new endpoint');
  assert.equal(response.headers.get('x-frame-options'),'DENY');assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);assert.match(response.headers.get('cache-control'),/no-store/);assert(!JSON.stringify(body).includes(bindings.NAVER_NEWS_CLIENT_SECRET));assert.equal(response.headers.get('access-control-allow-origin'),null);
  if(mode==='missing'){assert.equal(response.status,503);assert.equal(body.code,'NEWS_NOT_CONFIGURED');assert.equal(body.configured,false);assert.equal(calls,0);}
  else if(mode==='failure'){assert.equal(response.status,502);assert.equal(body.code,'NEWS_UPSTREAM_UNAVAILABLE');assert.equal(body.configured,true);assert.deepEqual(body.items,[]);assert.equal(calls,2);}
  else{assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.items.length,mode==='empty'?0:1);assert.equal(calls,2);if(mode==='valid'){assert.equal(body.items[0].title,headline.title);assert.equal(body.items[0].url,headline.originallink);}const next=await fetch();assert.equal(next.status,200);assert.equal(calls,2,'Warm news uses its shared internal cache');}
  const before=calls;assert.equal((await fetch('?query=arbitrary')).status,400);assert.equal((await fetch('',{method:'HEAD'})).status,405);assert.equal((await fetch('',{headers:{Origin:'https://attacker.example','Sec-Fetch-Site':'cross-site'}})).status,403);assert.equal(calls,before);
  if(mode==='valid'){const staticResponse=await runtime.dispatchFetch(ORIGIN+'/assets/money.js');assert.equal(await staticResponse.text(),'static-asset');const unknown=await runtime.dispatchFetch(ORIGIN+'/api/unknown-news');assert.equal(unknown.status,404);assert.equal((await unknown.json()).code,'NOT_FOUND');}
  const result={mode,status:response.status,configured:body.configured,items:body.items.length,code:body.code||null,outbound,calls};report.runs.push(result);console.log('PASS actual Pages router '+mode+': status '+response.status+', fixed Naver calls '+calls+', security/telemetry boundary');
 }finally{await runtime.dispose();}
}
(async()=>{for(const mode of ['missing','valid','empty','failure'])await scenario(mode);fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS real Pages route, middleware, cache and missing/failure/empty states; zero operating network requests');})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
