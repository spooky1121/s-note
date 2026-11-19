import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {gloarPageAction,searchGloarLinks,GLOAR_CATALOG} from '../functions/_shared/gloar-search.mjs';
const require=createRequire(new URL('./encar/package.json',import.meta.url));
const {JSDOM}=require('jsdom');
const plate='28오6877';
const url='https://gloar-data.com/en/lot/tesla-model-y-fixture-target';
const other='https://gloar-data.com/en/lot/tesla-model-y-fixture-other';
const initial='https://gloar-data.com/en/lot/catalog-initial-fixture';
const input='<header><input placeholder="Enter 17-digit VIN, Lot #, or Plate..."></header>';
// Controlled fixtures: labels/path shapes were observed on GLOAR. These tests
// prove our input/result handling, not a live submission contract or live match.
function page(markup,href=GLOAR_CATALOG) {
 const dom=new JSDOM(markup,{url:href,runScripts:'outside-only'});
 Object.defineProperty(dom.window.document,'readyState',{value:'complete',configurable:true});
 dom.window.Element.prototype.getClientRects=function(){return [{x:0,y:0,width:10,height:10}];};
 return dom;
}
function action(dom,args={}) {return dom.window.eval('('+gloarPageAction.toString()+')('+JSON.stringify({plate,...args})+')');}
function fixture({results=[url],initialLinks=[initial],detail={},empty=false,delay=0,prepareMissing=false,enterError,contextLoss=0}={}) {
 let dom=page((prepareMissing?'':input)+`<main>${initialLinks.map(href=>`<a href="${href}">Initial result</a>`).join('')}</main>`),closed=0,entered=0,read=0;
 const visits=[],expressions=[];let afterEnter=false,loss=contextLoss;
 return {
  browser:{async newPage(){return {
   async goto(href) {
    visits.push(href);
    if(href===GLOAR_CATALOG)return;
    assert(results.includes(href),'No guessed/foreign detail navigation');
    dom.window.close();
    dom=page(detail[href]??`<main><h1>Tesla Model Y</h1><p>${plate}</p></main>`,href);
   },
   async evaluate(expression) {
    expressions.push(expression);
    if(afterEnter && expression.includes('"operation":"read"')) {
      if(loss-->0)throw Object.assign(new Error('context destroyed'),{code:'PAGE_CONTEXT_UNAVAILABLE'});
      if(++read===delay+1 && dom.window.location.href===GLOAR_CATALOG) {
       dom.window.document.querySelector('main').innerHTML=empty?'<p>No results found</p>':results.map(href=>`<a href="${href}">Found vehicle</a>`).join('');
      }
    }
    return dom.window.eval(expression);
   },
   async keypress(key){assert.equal(key,'Enter');entered++;afterEnter=true;if(enterError)throw enterError;},
   async close(){closed++;dom.window.close();}
  };}},
  get state(){return {visits,expressions,closed,entered};}
 };
}
test('uses the actual labeled input and native input/change events without a guessed query URL',()=>{
 const dom=page(input+`<a href="${initial}">Initial</a>`),events=[];
 const field=dom.window.document.querySelector('input');
 for(const type of ['input','change'])field.addEventListener(type,event=>events.push([event.type,event.target.value]));
 const result=action(dom,{operation:'prepare'});
 assert.equal(result.prepared,true);assert.equal(field.value,plate);
 assert.deepEqual(events,[['input',plate],['change',plate]]);assert.equal(result.baseline,initial);dom.window.close();
});
test('real browser controller fills, presses Enter, opens one result and verifies the exact plate',async()=>{
 const f=fixture();const result=await searchGloarLinks({plate,browser:f.browser,pollMs:0});
 assert.equal(result.status,'found');assert.equal(result.plate,plate);assert.equal(result.links[0].url,url);
 assert.deepEqual(f.state.visits,[GLOAR_CATALOG,url]);assert.equal(f.state.entered,1);assert.equal(f.state.closed,1);
 assert(!JSON.stringify(result).includes('id'));assert(!f.state.visits.some(href=>href.includes('?')));
});
test('a header autocomplete result is collected even though it belongs to the search region',()=>{
 const dom=page(input+`<div role="search"><a href="${url}">Search result</a></div>`);
 assert.deepEqual([...action(dom).links],[url]);dom.window.close();
});
test('plate in the input, navigation or recommendation cannot prove a detail match',()=>{
 for(const markup of [input+`<main><h1>Other car</h1><p>12가3456</p><h2>Related vehicles</h2><p>${plate}</p></main>`,
  `<header>${plate}</header><main><h1>Other car</h1><p>12가3456</p></main>`,
  `<main><h1>Car</h1><div hidden>${plate}</div></main>`]){
  const dom=page(markup,url);assert.equal(action(dom).exact,false);dom.window.close();
 }
});
test('exact plate verification handles styled digits and refuses suffix/ambiguous plates',()=>{
 const dom=page('<main><h1>Car</h1><p><span>28</span><span>오</span><span>6877</span></p></main>',url);
 assert.equal(action(dom).exact,true);dom.window.close();
 for(const value of [plate+'8','1'+plate,plate+' 12가3456']){
  const d=page(`<main><h1>Car</h1><p>${value}</p></main>`,url);assert.equal(action(d).exact,false);d.window.close();
 }
});
test('only same-host HTTPS lot links can become candidates; tracking is removed',()=>{
 const bad=['https://foreign.invalid/en/lot/x','https://gloar-data.com.evil.invalid/en/lot/x','http://gloar-data.com/en/lot/x','https://u:p@gloar-data.com/en/lot/x','https://gloar-data.com/en/catalog','javascript:alert(1)'];
 const dom=page(input+bad.map(href=>`<a href="${href}">Bad</a>`).join('')+`<a href="${url}?utm_source=test#photos">Correct</a>`);
 assert.deepEqual([...action(dom).links],[url]);dom.window.close();
});
test('waits for deferred results and recovers read-only navigation context loss',async()=>{
 const f=fixture({delay:8,contextLoss:2});
 const result=await searchGloarLinks({plate,browser:f.browser,pollMs:0});assert.equal(result.status,'found');assert.equal(f.state.entered,1);assert.equal(f.state.closed,1);
});
test('skips a different plate and stops on the first verified detail link',async()=>{
 const f=fixture({results:[other,url],detail:{[other]:'<main><h1>Other car</h1><p>12가3456</p></main>'}});
 const result=await searchGloarLinks({plate,browser:f.browser,pollMs:0});assert.equal(result.status,'found');assert.equal(result.links[0].url,url);assert.deepEqual(f.state.visits,[GLOAR_CATALOG,other,url]);
});
test('new global-search links after an unchanged catalog grid are inspected before old cards',async()=>{
 const old=Array.from({length:24},(_,i)=>'https://gloar-data.com/en/lot/initial-fixture-'+i);
 const f=fixture({initialLinks:old,results:[...old,url]});
 const result=await searchGloarLinks({plate,browser:f.browser,pollMs:0});
 assert.equal(result.status,'found');assert.equal(result.links[0].url,url);
 assert.deepEqual(f.state.visits,[GLOAR_CATALOG,url]);
});
test('a confirmed empty search is different from an unsupported/unconfirmed search',async()=>{
 const f=fixture({results:[],empty:true});assert.equal((await searchGloarLinks({plate,browser:f.browser,pollMs:0})).status,'not_found');
 const g=fixture({prepareMissing:true});assert.deepEqual(await searchGloarLinks({plate,browser:g.browser,pollMs:0}),{status:'error',code:'GLOAR_SEARCH_UNSUPPORTED'});assert.equal(g.state.entered,0);assert.equal(g.state.closed,1);
});
test('an unchanged catalog or incomplete detail never yields a fabricated match',async()=>{
 const f=fixture({delay:100});assert.equal((await searchGloarLinks({plate,browser:f.browser,pollMs:0})).code,'GLOAR_RESULTS_UNCONFIRMED');assert.deepEqual(f.state.visits,[GLOAR_CATALOG]);
 const g=fixture({detail:{[url]:'<main><h1>Loading</h1></main>'}});assert.equal((await searchGloarLinks({plate,browser:g.browser,pollMs:0})).code,'GLOAR_RESULTS_UNCONFIRMED');
});
test('access challenge is reported without a bypass attempt or an invented no-match',()=>{
 const dom=page(input);dom.window.document.title='Just a moment...';assert.equal(action(dom).error,'GLOAR_ACCESS_BLOCKED');dom.window.close();
});
test('cancellation releases the page and invalid input creates no browser page',async()=>{
 const f=fixture();const controller=new AbortController();controller.abort();await assert.rejects(searchGloarLinks({plate,browser:f.browser,signal:controller.signal}),{name:'AbortError'});assert.deepEqual(f.state.visits,[]);
 assert.equal((await searchGloarLinks({plate:'not a plate',browser:f.browser})).status,'error');assert.deepEqual(f.state.visits,[]);
 const g=fixture({enterError:new Error('private detail')});const result=await searchGloarLinks({plate,browser:g.browser,pollMs:0});assert.equal(result.code,'GLOAR_UNAVAILABLE');assert.equal(g.state.closed,1);assert(!JSON.stringify(result).includes('private'));
});
