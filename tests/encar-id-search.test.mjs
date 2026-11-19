import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { searchExternalAdvertisements } from '../functions/_shared/encar-id-search.mjs';
import { PROVIDERS, resolveEncarId } from '../functions/_shared/encar-id-resolver.mjs';

// Every HTTP response is synthetic. The 66너7230 example reconstructs only the
// primary fields publicly observed at Trust; it is not a live Tavily capture.
const KEY='synthetic-search-key',PLATE='66너7230',OTHER='12가3456';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const detail=(provider=PROVIDERS[2],id='43138217')=>provider.id==='trust'?'https://encar.spb.ru/auto/'+id+'/':provider.id==='carnect'?'https://carnect.biz/car/'+id:'https://gloar-data.com/en/lot/synthetic-vehicle-'+id+'-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const raw=(plate=PLATE,id='43138217',provider=PROVIDERS[2])=>'# Synthetic vehicle\n\n'+(provider.id==='trust'?'* Лот\n\n'+id+'\n\n* Номер автомобиля\n\n'+plate:'License plate: '+plate+'\n\nEncar ID: '+id)+'\n';
const result=(provider=PROVIDERS[2],plate=PLATE,id='43138217')=>({url:detail(provider,id),title:'Synthetic vehicle',content:'Plate '+plate,raw_content:raw(plate,id,provider),id:'OPAQUE_SEARCH_DOCUMENT_NOT_ADVERTISEMENT_ID'});
function fixture(replies){
 const calls=[];return{calls,async fetchImpl(url,options){assert(['https://api.tavily.com/search','https://api.tavily.com/extract'].includes(url),'Only the fixed search service may receive requests');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer '+KEY);assert.equal(options.headers.Accept,'application/json');assert.equal(options.headers['Content-Type'],'application/json');const body=JSON.parse(options.body);calls.push({url,body,options});assert(replies.length,'Unexpected request or retry');const reply=replies.shift();return typeof reply==='function'?reply(url,options):reply;}};
}
const run=(f,provider=PROVIDERS[2],options={})=>searchExternalAdvertisements(provider,{plate:PLATE,apiKey:KEY,fetchImpl:f.fetchImpl,...options});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function flush(){await setImmediate();}

test('an exact-plate Trust raw result returns the public primary lot without a browser or extraction',async()=>{
 const f=fixture([json({results:[result()]})]),value=await run(f);assert.deepEqual(value,{status:'found',plate:PLATE,id:'43138217',sourceUrl:detail()});assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0].body,{query:'"66너7230" site:encar.spb.ru',exact_match:true,include_domains:['encar.spb.ru'],include_domains_mode:'restrict',search_depth:'basic',max_results:6,auto_parameters:false,include_answer:false,include_raw_content:'markdown'});
 assert(!JSON.stringify(value).includes('OPAQUE'));
});
test('the transport is generic across provider and plate, and stops the ordered resolver at the first result',async()=>{
 const f=fixture([json({results:[result(PROVIDERS[0],OTHER,'43123456')]})]);
 const value=await resolveEncarId({plate:OTHER,search:(provider,options)=>searchExternalAdvertisements(provider,{...options,apiKey:KEY,fetchImpl:f.fetchImpl})});
 assert.equal(value.status,'found');assert.equal(value.id,'43123456');assert.equal(value.provider,'carnect');assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body.include_domains,['carnect.biz']);assert.equal(f.calls[0].body.query,'"12가3456" site:carnect.biz');
});
test('empty indexed results advance providers in order and stop at Trust',async()=>{
 const f=fixture([json({results:[]}),json({results:[]}),json({results:[result()]})]);
 const value=await resolveEncarId({plate:PLATE,search:(provider,options)=>searchExternalAdvertisements(provider,{...options,apiKey:KEY,fetchImpl:f.fetchImpl})});
 assert.equal(value.status,'found');assert.equal(value.provider,'trust');assert.deepEqual(f.calls.map(call=>call.body.include_domains[0]),['carnect.biz','gloar-data.com','encar.spb.ru']);
});
test('invalid configuration or provider input never causes network traffic',async()=>{
 let calls=0;const fetchImpl=()=>{calls++;throw Error('unexpected');};
 for(const apiKey of['','   ','a\nprivate','x'.repeat(4097)])await assert.rejects(searchExternalAdvertisements(PROVIDERS[2],{plate:PLATE,apiKey,fetchImpl}),error=>error.code==='SEARCH_NOT_CONFIGURED');
 for(const [provider,plate]of[[{...PROVIDERS[2],host:'evil.invalid'},PLATE],[{...PROVIDERS[2],url:'https://foreign.invalid/'},PLATE],[PROVIDERS[2],'bad-plate']])assert.equal((await searchExternalAdvertisements(provider,{plate,apiKey:KEY,fetchImpl})).status,'error');
 assert.equal(calls,0);
});
test('search authentication errors are redacted and never retried',async()=>{
 for(const status of[401,403]){const f=fixture([json({detail:'PRIVATE_KEY '+KEY},status)]);await assert.rejects(run(f),error=>error.code==='SEARCH_AUTH_FAILED'&&!error.message.includes(KEY)&&!error.message.includes('PRIVATE'));assert.equal(f.calls.length,1);}
});
test('upstream quota and request limits carry a safe Retry-After without retries',async()=>{
 for(const status of[429,432,433,434]){const f=fixture([json({detail:'PRIVATE_LIMIT'},status,{'Retry-After':'28'})]);await assert.rejects(run(f),error=>error.code==='SEARCH_RATE_LIMITED'&&error.retryAfter===28&&!error.message.includes('PRIVATE'));assert.equal(f.calls.length,1);}
 for(const retry of['0','9999999999','invalid']){const f=fixture([json({},429,{'Retry-After':retry})]);await assert.rejects(run(f),error=>error.retryAfter===(retry==='0'?1:retry==='invalid'?60:3600));}
});
test('malformed, redirected and oversized responses cannot turn into a guessed ID',async()=>{
 for(const response of[new Response(null,{status:302,headers:{Location:'https://foreign.invalid'}}),new Response('{broken',{headers:{'Content-Type':'application/json'}}),json({notResults:[]}),new Response('{}',{headers:{'Content-Type':'text/html'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(512*1024+1)}}),json({results:[],padding:'x'.repeat(512*1024)})]){
  const f=fixture([response]);await assert.rejects(run(f),error=>error.code==='SEARCH_UNAVAILABLE'&&!error.message.includes('foreign'));assert.equal(f.calls.length,1);
 }
});
test('a different primary plate cannot borrow the requested plate from recommendations',async()=>{
 const wrong={...result(),raw_content:raw(OTHER)+'\n## Похожие автомобили\n'+raw(PLATE,'43999999')};
 const f=fixture([json({results:[wrong]})]),value=await run(f);assert.equal(value.status,'not_found');assert.equal(f.calls.length,1);
});
test('complete primary field pairs in content can confirm an ID without an extraction',async()=>{
 const item={...result(),raw_content:null,content:raw()};const f=fixture([json({results:[item]})]),value=await run(f);assert.equal(value.status,'found');assert.equal(value.id,'43138217');assert.equal(f.calls.length,1);
});
test('one extraction obtains missing primary content from only observed detail URLs',async()=>{
 const item={...result(),raw_content:null,content:'Plate '+PLATE};const f=fixture([json({results:[item]}),json({results:[{url:detail(),raw_content:raw()}],failed_results:[]})]);
 const value=await run(f);assert.equal(value.status,'found');assert.equal(value.id,'43138217');assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].body,{urls:[detail()],extract_depth:'basic',format:'markdown',include_images:false});
});
test('a title year stays separate from a plate hint and permits a verified extraction',async()=>{
 for(const title of['Tesla Model S 2023 66너7230','Tesla Model S 2023 ６６-너 ７２３０']){
  const item={...result(),title,raw_content:null,content:'Vehicle details'};
  const f=fixture([json({results:[item]}),json({results:[{url:detail(),raw_content:raw()}],failed_results:[]})]);
  const value=await run(f);assert.equal(value.status,'found');assert.equal(value.id,'43138217');assert.equal(f.calls.length,2);
 }
});
test('a longer number or another Korean letter cannot become the requested extraction hint',async()=>{
 for(const title of['Tesla 2023 166너7230','Tesla 2023 66너72301','Tesla 2023 66더7230']){
  const item={...result(),title,raw_content:null,content:'Vehicle details'},f=fixture([json({results:[item]})]);
  const value=await run(f);assert.notEqual(value.status,'found');assert.equal(f.calls.length,1);
 }
});
test('catalogs, foreign URLs and Korean advertisements are never extracted or inferred from a URL',async()=>{
 const items=['https://encar.spb.ru/catalog/tesla/','https://foreign.invalid/auto/43138217/','https://fem.encar.com/cars/detail/43138217'].map(url=>({...result(),url,raw_content:null,content:'Plate '+PLATE}));
 const f=fixture([json({results:items})]),value=await run(f);assert.notEqual(value.status,'found');assert.equal(f.calls.length,1);
});
test('an extraction result cannot substitute an unrequested URL even when its plate matches',async()=>{
 const item={...result(),raw_content:null,content:'Plate '+PLATE};const f=fixture([json({results:[item]}),json({results:[{url:detail(PROVIDERS[2],'43999999'),raw_content:raw(PLATE,'43999999')}],failed_results:[]})]);const value=await run(f);assert.equal(value.status,'error');assert.equal(value.code,'AD_ID_UNVERIFIED');assert.equal(f.calls.length,2);
});
test('extraction is batched once with at most three validated candidates',async()=>{
 const items=Array.from({length:6},(_,i)=>({...result(PROVIDERS[2],PLATE,String(43138217+i)),raw_content:null,content:'Plate '+PLATE}));
 const f=fixture([json({results:items}),json({results:[],failed_results:items.map(item=>({url:item.url,error:'Synthetic unavailable'}))})]);const value=await run(f);assert.equal(value.status,'error');assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.urls.length,3);assert.deepEqual(f.calls[1].body.urls,items.slice(0,3).map(item=>item.url));
});
test('partial extraction failures stay unverified instead of reporting an absent advertisement',async()=>{
 const item={...result(),raw_content:null,content:'Plate '+PLATE};const f=fixture([json({results:[item]}),json({results:[],failed_results:[{url:detail(),error:'PRIVATE_FAILURE'}]})]);const value=await run(f);assert.equal(value.status,'error');assert.equal(value.code,'AD_ID_UNVERIFIED');assert(!JSON.stringify(value).includes('PRIVATE'));
});
test('arbitrary network exceptions expose no token, provider body or URL',async()=>{
 const f=fixture([()=>{throw new TypeError('PRIVATE '+KEY+' https://foreign.invalid');}]);await assert.rejects(run(f),error=>error.code==='SEARCH_UNAVAILABLE'&&error.message==='SEARCH_UNAVAILABLE');assert.equal(f.calls.length,1);
});
test('caller cancellation settles even an uncooperative fetch and ignores a late result',async()=>{
 const pending=deferred(),controller=new AbortController(),f=fixture([()=>pending.promise]),operation=run(f,PROVIDERS[2],{signal:controller.signal});await flush();controller.abort();await assert.rejects(operation,error=>error.name==='AbortError');pending.resolve(json({results:[result()]}));await flush();assert.equal(f.calls.length,1);
});
test('a body read aborted synchronously cannot leave its rejected read promise unhandled',async()=>{
 const controller=new AbortController();let released=0;
 const response={ok:true,status:200,headers:new Headers({'Content-Type':'application/json'}),body:{getReader(){return{read(){controller.abort();return Promise.reject(new Error('PRIVATE_CANCELLED_READ'));},cancel:async()=>{},releaseLock(){released++;}};}}};
 const f=fixture([response]);await assert.rejects(run(f,PROVIDERS[2],{signal:controller.signal}),error=>error.name==='AbortError');await flush();assert.equal(released,1);assert.equal(f.calls.length,1);
});
test('the eight-second whole-operation limit also cancels an uncooperative body reader',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=deferred();let cancelled=0,released=0;
 const response={ok:true,status:200,headers:new Headers({'Content-Type':'application/json'}),body:{getReader(){return{read:()=>pending.promise,cancel:async()=>{cancelled++;},releaseLock(){released++;}};}}};
 const f=fixture([response]),operation=run(f);await flush();t.mock.timers.tick(8000);await assert.rejects(operation,error=>error.code==='SEARCH_UNAVAILABLE');assert(cancelled>=1);assert.equal(released,1);assert.equal(f.calls.length,1);pending.resolve({done:true});
});
