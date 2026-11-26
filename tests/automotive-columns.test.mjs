import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source=fs.readFileSync(new URL('../functions/api/automotive-columns.js',import.meta.url),'utf8');
let serial=0;
const load=()=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')+'#'+serial++);
const env={NAVER_NEWS_CLIENT_ID:'synthetic-news-id',NAVER_NEWS_CLIENT_SECRET:'synthetic-news-secret'};
const request=(suffix='',method='GET')=>new Request('https://s-note.kr/api/automotive-columns'+suffix,{method});
const article=(n,patch={})=>({title:'[자동차 칼럼] 전기차와 자동차의 변화 '+n,originallink:'https://motor.publicnews.kr/article/'+n,link:'https://n.news.naver.com/article/001/'+n,description:'자동차 산업의 변화',pubDate:new Date(Date.now()-n*60000).toUTCString().replace('GMT','+0000'),...patch});
const feed=items=>({total:items.length,start:1,display:items.length,items});
async function scoped(run){const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;try{delete globalThis.caches;await run();}finally{globalThis.fetch=oldFetch;if(oldCaches===undefined)delete globalThis.caches;else globalThis.caches=oldCaches;}}

test('plain text, public HTTPS links and editorial automotive headlines are conservatively filtered',async()=>{
 const m=await load();assert.equal(m.newsText(' &lt;b&gt;전기차&lt;/b&gt; &amp; &#xAC00; <img src=x onerror=alert(1)>'),'전기차 & 가');
 for(const url of ['javascript:alert(1)','data:text/html,x','http://motor.publicnews.kr/a','https://user:pass@motor.publicnews.kr/a','https://127.0.0.1/a','https://localhost/a','https://internal.local/a','https://motor.publicnews.kr:123/a','https://motor.publicnews.kr/\nraw'])assert.equal(m.newsURL(url),null,url);
 const chosen=m.selectAutomotiveColumns([feed([article(1),article(2,{title:'자동차 신차 출시 소식'}),article(3,{title:'[칼럼] 정치 개혁',description:'자동차 언급'}),article(4,{title:'[자동차 칼럼공모전] 수상자 발표'}),article(5,{title:'자동차 칼럼: 안전한 전기차'}),article(6,{title:'[기고] 중고차 점검'}),article(7,{title:'[칼럼] 전기차',originallink:'javascript:evil',link:'data:text/html,x'})])]);
 assert.deepEqual(chosen.map(x=>x.title),['[자동차 칼럼] 전기차와 자동차의 변화 1','자동차 칼럼: 안전한 전기차','[기고] 중고차 점검']);
 assert(chosen.every(x=>Object.keys(x).sort().join(',')==='publishedAt,publisher,title,url'));
});
test('safe Naver HTTPS link can replace an unsafe original, without fetching either article',async()=>{
 const m=await load();const rows=m.selectAutomotiveColumns([feed([article(1,{originallink:'http://old.publicnews.kr/a',link:'https://n.news.naver.com/article/001/1'})])]);assert.equal(rows[0].url,'https://n.news.naver.com/article/001/1');assert.equal(rows[0].publisher,'n.news.naver.com');
});
test('duplicates, invalid dates, obsolete/future articles and malformed provider bodies never become valid rows',async()=>{
 const m=await load();const items=[article(1),article(2,{originallink:article(1).originallink}),article(3,{title:article(1).title}),article(4,{pubDate:'Wed, 31 Feb 2026 12:00:00 +0900'}),article(5,{pubDate:'garbage'}),article(6,{pubDate:new Date(Date.now()-181*86400000).toISOString()}),article(7,{pubDate:new Date(Date.now()+2*86400000).toISOString()})];assert.equal(m.selectAutomotiveColumns([feed(items)]).length,1);
 assert.throws(()=>m.selectAutomotiveColumns([{items:[],total:'0'}]),/NEWS_INVALID_RESPONSE/);assert.throws(()=>m.selectAutomotiveColumns([{items:[article(1)],total:0}]),/NEWS_INVALID_RESPONSE/);
 assert.equal(m.selectAutomotiveColumns([feed(Array.from({length:10},(_,i)=>article(i+1)))]).length,5);
});
test('missing or malformed bindings, unsupported methods and arbitrary query strings do not call providers',async()=>scoped(async()=>{
 const m=await load();let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
 for(const bindings of [{},{NAVER_NEWS_CLIENT_ID:'only-id'},{...env,NAVER_NEWS_CLIENT_SECRET:'bad\nheader'}]){const r=await m.onRequest({request:request(),env:bindings}),b=await r.json();assert.equal(r.status,503);assert.equal(b.configured,false);assert.equal(b.code,'NEWS_NOT_CONFIGURED');}
 assert.equal((await m.onRequest({request:request('?query=anything'),env})).status,400);assert.equal((await m.onRequest({request:request('','POST'),env})).status,405);assert.equal(calls,0);
}));
test('fixed authenticated Naver requests return only five plain headlines and never expose credentials or descriptions',async()=>scoped(async()=>{
 const m=await load(),calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.equal(new URL(url).origin,'https://openapi.naver.com');assert.equal(new URL(url).pathname,'/v1/search/news.json');assert.equal(new URL(url).searchParams.get('display'),'100');assert.equal(new URL(url).searchParams.get('start'),'1');assert.equal(new URL(url).searchParams.get('sort'),'date');assert.equal(options.redirect,'manual');assert.equal(options.headers['X-Naver-Client-Id'],env.NAVER_NEWS_CLIENT_ID);assert.equal(options.headers['X-Naver-Client-Secret'],env.NAVER_NEWS_CLIENT_SECRET);return Response.json(feed(Array.from({length:7},(_,i)=>article(i+1))));};
 const r=await m.onRequest({request:request(),env}),body=await r.json();assert.equal(r.status,200);assert.equal(body.ok,true);assert.equal(body.configured,true);assert.equal(body.items.length,5);assert.equal(body.stale,false);assert.equal(body.partial,false);assert.equal(new Date(body.fetchedAt).toISOString(),body.fetchedAt);assert.equal(calls.length,2);assert.deepEqual(calls.map(x=>new URL(x.url).searchParams.get('query')).sort(),['자동차 기고','자동차 칼럼']);const raw=JSON.stringify(body);assert(!raw.includes(env.NAVER_NEWS_CLIENT_SECRET));assert(!raw.includes('description'));assert.equal(r.headers.get('cache-control'),'no-store');
}));
test('simultaneous requests share one provider job and subsequent requests reuse the valid fifteen-minute feed',async()=>scoped(async()=>{
 const m=await load();let release,calls=0;const held=new Promise(resolve=>release=resolve);globalThis.fetch=async()=>{calls++;await held;return Response.json(feed([article(1)]));};const a=m.onRequest({request:request(),env}),b=m.onRequest({request:request(),env});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,2);release();assert.equal((await(await a).json()).items.length,1);assert.equal((await(await b).json()).items.length,1);assert.equal((await(await m.onRequest({request:request(),env})).json()).items.length,1);assert.equal(calls,2);
}));
test('a genuine empty response is cached as empty and remains distinct from provider failure',async()=>scoped(async()=>{
 const m=await load();let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(feed([article(1,{title:'전기차 판매 일반 뉴스'})]));};const first=await m.onRequest({request:request(),env});assert.equal(first.status,200);assert.deepEqual((await first.json()).items,[]);assert.equal((await m.onRequest({request:request(),env})).status,200);assert.equal(calls,2);
}));
test('provider auth, rate, redirects, HTTP and malformed payload failures stay typed and can retry without leaking upstream text',async()=>scoped(async()=>{
 for(const[status,code]of [[401,'NEWS_AUTH_FAILED'],[403,'NEWS_AUTH_FAILED'],[429,'NEWS_RATE_LIMITED'],[302,'NEWS_UPSTREAM_UNAVAILABLE'],[503,'NEWS_UPSTREAM_UNAVAILABLE']]){const m=await load();globalThis.fetch=async()=>new Response(env.NAVER_NEWS_CLIENT_SECRET,{status,headers:{Location:'https://attacker.publicnews.kr/'}});const r=await m.onRequest({request:request(),env}),b=await r.json();assert.equal(b.code,code);assert.equal(b.configured,true);assert.deepEqual(b.items,[]);assert(!JSON.stringify(b).includes(env.NAVER_NEWS_CLIENT_SECRET));assert(r.status>=400);globalThis.fetch=async()=>Response.json(feed([article(1)]));assert.equal((await m.onRequest({request:request(),env})).status,200);}
 for(const body of ['{',JSON.stringify({items:'bad'}),'x'.repeat(1048577)]){const m=await load();globalThis.fetch=async()=>new Response(body);const r=await m.onRequest({request:request(),env});assert.equal((await r.json()).code,'NEWS_INVALID_RESPONSE');}
}));
test('a successful query with valid columns may be marked partial; failed queries cannot be called empty',async()=>scoped(async()=>{
 let calls=0;const m=await load();globalThis.fetch=async()=>++calls===1?Response.json(feed([article(1)])):new Response('unavailable',{status:503});const r=await m.onRequest({request:request(),env});assert.equal(r.status,200);assert.equal((await r.json()).partial,true);
 const other=await load();calls=0;globalThis.fetch=async()=>++calls===1?Response.json(feed([])):new Response('unavailable',{status:503});assert.equal((await other.onRequest({request:request(),env})).status,502);
}));
test('edge cache is credential scoped, bounded, and rejects malformed/old content without publishing it',async()=>scoped(async()=>{
 const entries=new Map(),keys=[];globalThis.caches={default:{async match(key){keys.push(key.url);return entries.get(key.url)?.clone();},async put(key,r){assert.equal(r.headers.get('cache-control'),'public, max-age=900');entries.set(key.url,r.clone());}}};let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(feed([article(1)]));};const a=await load();assert.equal((await a.onRequest({request:request(),env})).status,200);assert.equal(calls,2);const b=await load();assert.equal((await b.onRequest({request:request(),env})).status,200);assert.equal(calls,2);assert(keys.every(k=>!k.includes(env.NAVER_NEWS_CLIENT_ID)&&!k.includes(env.NAVER_NEWS_CLIENT_SECRET)));
 const c=await load();await c.onRequest({request:request(),env:{...env,NAVER_NEWS_CLIENT_ID:'other-synthetic-id'}});assert.equal(calls,4);const oldKey=keys[0],old=await entries.get(oldKey).clone().json();old.fetchedAt=new Date(Date.now()-900001).toISOString();entries.set(oldKey,Response.json(old));const d=await load();await d.onRequest({request:request(),env});assert.equal(calls,6);entries.set(oldKey,Response.json({...old,fetchedAt:new Date().toISOString(),items:[{title:'malicious',url:'javascript:evil',publishedAt:new Date().toISOString(),publisher:'bad'}]}));const e=await load();await e.onRequest({request:request(),env});assert.equal(calls,8);
}));
test('unresponsive cache operations cannot prevent a fresh public feed',async()=>scoped(async()=>{
 globalThis.caches={default:{match:()=>new Promise(()=>{}),put:()=>new Promise(()=>{})}};globalThis.fetch=async()=>Response.json(feed([article(1)]));const m=await load(),started=Date.now();const r=await m.onRequest({request:request(),env});assert.equal(r.status,200);assert(Date.now()-started<1600);
}));
test('unresponsive provider has a bounded deadline and never returns successful empty news',async()=>scoped(async()=>{
 const m=await load();globalThis.fetch=async()=>new Promise(()=>{});const start=Date.now(),r=await m.onRequest({request:request(),env});assert.equal(r.status,504);assert.equal((await r.json()).code,'NEWS_TIMEOUT');assert(Date.now()-start<7500);
}));
