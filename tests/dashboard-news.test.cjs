'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../assets/dashboard-news.js');
const STAMP='2026-11-26T04:00:00.000Z',CLOCK=Date.parse(STAMP),copy=value=>structuredClone(value);
function payload(patch={}){return {ok:true,configured:true,source:'네이버 뉴스 검색',sourceUrl:M.sourceUrl,fetchedAt:STAMP,partial:false,stale:false,items:[{title:'[칼럼] 자동차 정비와 안전을 다시 생각하다',url:'https://press.example.com/columns/1',publishedAt:STAMP,publisher:'press.example.com'}],...patch};}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error?.code===code&&error.message===code);

test('only canonical public Naver responses become immutable title/date links',()=>{
 const input=payload(),before=JSON.stringify(input),value=M.response(input);
 assert.equal(value.sourceUrl,M.sourceUrl);assert.equal(value.items[0].publisher,'press.example.com');
 assert(Object.isFrozen(value)&&Object.isFrozen(value.items)&&Object.isFrozen(value.items[0]));
 assert.equal(JSON.stringify(input),before);assert.equal(value.items[0].title,input.items[0].title);
 assert.equal(M.response(payload({items:[]})).items.length,0);
});

test('schema, attribution, date, bounded counts and duplicated article replies fail closed',()=>{
 const variants=[null,[],payload({source:'다른 뉴스'}),payload({sourceUrl:'https://evil.example/'}),payload({stale:true}),payload({partial:'false'}),payload({fetchedAt:'2026-02-30T04:00:00.000Z'}),payload({items:Array(6).fill(payload().items[0])}),payload({items:[...payload().items,...payload().items]})];
 for(const input of variants)assert.throws(()=>M.response(input),{code:'NEWS_INVALID_RESPONSE'});
 for(const patch of [{publisher:'wrong.example.com'},{publishedAt:'not-a-date'},{title:''},{title:'x'.repeat(181)},{title:'a\u0000b'},{title:'\ud800'}])assert.throws(()=>M.response(payload({items:[{...payload().items[0],...patch}]})),{code:'NEWS_INVALID_RESPONSE'});
});

test('unsafe article URLs cannot become links',()=>{
 for(const url of ['javascript:alert(1)','http://press.example.com/a','https://user:pass@press.example.com/a','https://press.example.com:444/a','https://127.0.0.1/a','https://[::1]/a','https://localhost/a','https://press.local/a','https://press.internal/a','https://press.example.com/a b','https://press.example.com\\@evil.example/a'])assert.throws(()=>M.response(payload({items:[{...payload().items[0],url}]})),{code:'NEWS_INVALID_RESPONSE'},url);
});

test('provider setup failure is distinct from a successful empty result or upstream failures',()=>{
 assert.deepEqual(M.response({ok:false,configured:false,code:'NEWS_NOT_CONFIGURED',items:[],error:'private provider details ignored'}),{configured:false,items:[]});
 assert.equal(M.response(payload({items:[]})).configured,true);
 for(const code of ['NEWS_AUTH_FAILED','NEWS_RATE_LIMITED','NEWS_UPSTREAM_UNAVAILABLE','NEWS_INVALID_RESPONSE','NEWS_TIMEOUT'])assert.throws(()=>M.response({ok:false,configured:true,code,items:[],error:'secret-looking upstream text'}),{code});
 for(const input of [{ok:false,configured:true,code:'NEWS_NOT_CONFIGURED',items:[]},{ok:false,configured:false,code:'NEWS_AUTH_FAILED',items:[]},{ok:false,configured:true,code:'UNRECOGNIZED',items:[]}])assert.throws(()=>M.response(input),{code:'NEWS_INVALID_RESPONSE'});
});

test('one shared Promise serves concurrent and reentrant reads without sending actor credentials',async()=>{
 const held=deferred();let calls=0,second,client;
 client=M.createClient({now:()=>CLOCK,fetch:(url,options)=>{calls++;assert.equal(url,'/api/automotive-columns');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.deepEqual(options.headers,{Accept:'application/json'});second=client.read({force:true});return held.promise;}});
 const first=client.read(),parallel=client.read();assert.equal(first,parallel);await Promise.resolve();assert.equal(first,second);assert.equal(calls,1);held.resolve(json(payload()));const values=await Promise.all([first,parallel,second]);assert.equal(values[0],values[1]);assert.equal(values[1],values[2]);
});

test('public successful cache expires by provider freshness and force makes one new request',async()=>{
 let now=CLOCK+14*60000,calls=0;const client=M.createClient({now:()=>now,fetch:async()=>{calls++;return json(payload());}});
 const first=await client.read();assert.equal(await client.read(),first);assert.equal(calls,1);
 now=CLOCK+M.ttlMs+1;await client.read();assert.equal(calls,2,'Provider fetchedAt must cap the local cache lifetime');
 await client.read({force:true});assert.equal(calls,3);
});

test('a clock rollback cannot retain a cached article indefinitely',async()=>{
 let now=CLOCK,calls=0;const client=M.createClient({now:()=>now,fetch:async()=>{calls++;return json(payload());}});
 await client.read();now-=1000;await client.read();assert.equal(calls,2);
});

test('failed and unconfigured reads retry without poisoning the shared Promise',async()=>{
 let calls=0;const client=M.createClient({now:()=>CLOCK,fetch:async()=>{calls++;if(calls===1)throw Error('raw secret provider URL');if(calls===2)return json({ok:false,configured:false,code:'NEWS_NOT_CONFIGURED',items:[]},503);return json(payload());}});
 await rejectsCode(client.read(),'NEWS_UPSTREAM_UNAVAILABLE');assert.equal((await client.read()).configured,false);assert.equal((await client.read()).configured,true);assert.equal(calls,3);
});

test('malformed JSON, wrong MIME, contradictory HTTP status and oversized responses are rejected',async()=>{
 const variants=[()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>new Response(JSON.stringify(payload()),{headers:{'content-type':'text/html'}}),()=>json(payload(),503),()=>json({ok:false,configured:false,code:'NEWS_NOT_CONFIGURED',items:[]}),()=>new Response(' '.repeat(M.maxBytes+1),{headers:{'content-type':'application/json'}})];
 for(const make of variants){const client=M.createClient({fetch:async()=>make(),now:()=>CLOCK});await rejectsCode(client.read(),'NEWS_INVALID_RESPONSE');}
});

test('timeout aborts the request and a late result cannot populate the cache',async()=>{
 const held=deferred();let calls=0,signal;const client=M.createClient({now:()=>CLOCK,timeoutMs:10,fetch:async(_url,options)=>{calls++;signal=options.signal;return calls===1?held.promise:json(payload());}});
 await rejectsCode(client.read(),'NEWS_TIMEOUT');assert.equal(signal.aborted,true);held.resolve(json(payload({items:[]})));await new Promise(resolve=>setTimeout(resolve,5));const next=await client.read();assert.equal(calls,2);assert.equal(next.items.length,1);
});

test('partial provider success remains genuine content rather than a fabricated error fallback',async()=>{
 const client=M.createClient({fetch:async()=>json(payload({partial:true})),now:()=>CLOCK});const value=await client.read();assert.equal(value.partial,true);assert.equal(value.items.length,1);assert.equal(value.stale,false);
});

test('client construction rejects missing fetch and unsupported deadlines',()=>{
 for(const timeoutMs of [0,-1,30001,1.5])assert.throws(()=>M.createClient({fetch:async()=>json(payload()),timeoutMs}),{code:'NEWS_UNAVAILABLE'});
 assert.throws(()=>M.createClient({fetch:null}),{code:'NEWS_UNAVAILABLE'});
});
