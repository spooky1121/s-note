import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {gloarAdvertisementPageAction,searchGloarAdvertisement,findGloarAdvertisement,GLOAR_HOME} from '../functions/_shared/encar-id-gloar.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require('./encar/node_modules/jsdom');
const PLATE='28오6877',OTHER='12가3456',ID='43123456';
const DETAIL='https://gloar-data.com/en/lot/tesla-model-y-opaque-fixture-uuid';
const INITIAL='https://gloar-data.com/en/lot/initial-fixture';
const FIELD='<header><input id="headerSearchInput" placeholder="Enter 17-digit VIN, Lot #, or Plate..."></header>';
const source=(id=ID)=>'<a href="https://fem.encar.com/cars/detail/'+id+'">Source</a>';
// Synthetic page shapes, not fetched provider HTML or proof of a live search.
function dom(html,url=DETAIL){const page=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});Object.defineProperty(page.window.document,'readyState',{get:()=> 'complete'});page.window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:1,height:1}];};return page;}
function inspect(page,args={}){return page.window.eval('('+gloarAdvertisementPageAction.toString()+')('+JSON.stringify({plate:PLATE,...args})+')');}
function plain(value){return JSON.parse(JSON.stringify(value));}
function fixture({results=[DETAIL],primary={},append=false,clearInput=false,redirect=false,empty=false,noChange=false,contextLoss=false,challenge=false}={}){
 let page=dom(FIELD+'<main><a href="'+INITIAL+'">Initial</a></main>',GLOAR_HOME),entered=false,changed=false,lost=false;
 const state={visits:[],keys:[],prepares:0,pageCloses:0,browserCloses:0,options:null};
 const browser={async close(){state.browserCloses++;},async newPage(){return {
  async goto(url){state.visits.push(url);if(url===GLOAR_HOME)return;assert(results.includes(url),'Must visit an observed GLOAR result, never Encar');page.window.close();page=dom(primary[url]??'<main><h1>Any manufacturer/model</h1><p>'+PLATE+'</p>'+source()+'</main>',url);},
  async keypress(key){assert.equal(key,'Enter');state.keys.push(key);entered=true;},
  async evaluate(expression){
   assert(expression.includes('const __name=fn=>fn'));
   if(expression.includes('"operation":"prepare"'))state.prepares++;
   if(entered&&expression.includes('"operation":"read"')&&page.window.location.href===GLOAR_HOME&&!changed){
    if(contextLoss&&!lost){lost=true;throw Object.assign(new Error('context lost'),{code:'PAGE_CONTEXT_UNAVAILABLE'});}
    if(!noChange){changed=true;if(redirect){page.window.close();page=dom(primary[DETAIL]??'<main><header><button>'+PLATE+'</button>'+source()+'</header></main>',DETAIL);}else{const main=page.window.document.querySelector('main');if(!append)main.replaceChildren();if(empty)main.innerHTML='<p>No results found</p>';else main.insertAdjacentHTML('beforeend',results.map(url=>'<a href="'+url+'">Result</a>').join(''));if(clearInput)page.window.document.getElementById('headerSearchInput').value='';}}
   }
   if(challenge)page.window.document.title='Just a moment...';
   return page.window.eval(expression);
  },async close(){state.pageCloses++;page.window.close();}
 };}};
 return {browser,state,createBrowser:async(env,options)=>{state.options=options;return browser;}};
}
test('full primary plate and explicit Encar link yield original ID, never a GLOAR UUID/path number',()=>{
 const page=dom('<main><h1>Vehicle</h1><p>'+PLATE+'</p>'+source()+'</main>','https://gloar-data.com/en/lot/car-99999999-opaque-uuid');
 const result=inspect(page);assert.equal(result.exact,true);assert.deepEqual(plain(result.ids),[ID]);assert.equal(result.sourceUrl,'https://gloar-data.com/en/lot/car-99999999-opaque-uuid');page.window.close();
 const other=dom('<main><p>'+PLATE+'</p><p>99999999</p></main>');assert.deepEqual(plain(inspect(other).ids),[]);other.window.close();
});
test('lot header and display copy buttons count while the global search header remains excluded',()=>{
 const page=dom(FIELD+'<main><header><h1>Vehicle</h1><button>'+PLATE+'</button>'+source()+'</header></main>');assert.equal(inspect(page).exact,true);assert.deepEqual(plain(inspect(page).ids),[ID]);page.window.close();
 const global=dom('<header><input id="headerSearchInput" value="'+PLATE+'"><span>'+PLATE+'</span>'+source()+'</header><main><p>'+OTHER+'</p></main>');assert.equal(inspect(global).exact,false);assert.deepEqual(plain(inspect(global).ids),[]);global.window.close();
});
test('legacy Encar query URLs and explicit Encar ID labels are supported without opening them',()=>{
 for(const markup of ['<a href="http://www.encar.com/dc/dc_cardetailview.do?carid='+ID+'">Encar</a>','<p>Original Encar ID: '+ID+'</p>']){const page=dom('<main><p>'+PLATE+'</p>'+markup+'</main>');assert.deepEqual(plain(inspect(page).ids),[ID]);page.window.close();}
});
test('recommendations and adjacent records cannot provide a source ID for the primary plate',()=>{
 for(const extra of ['<h2>Similar vehicles</h2><article><p>'+PLATE+'</p>'+source()+'</article>','<div class="related-cars"><p>'+PLATE+'</p>'+source()+'</div>','<article>'+source()+'<p>Encar ID: '+ID+'</p></article>']){
  const page=dom('<main><article><p>'+PLATE+'</p></article>'+extra+'</main>');assert.deepEqual(plain(inspect(page).ids),[]);page.window.close();
 }
});
test('conflicting original IDs remain ambiguous and another full plate never matches by suffix',()=>{
 const page=dom('<main><p>'+PLATE+'</p>'+source()+source('43999999')+'</main>');assert.equal(inspect(page).ambiguous,true);page.window.close();
 for(const value of [OTHER,'128오6877','28오68778']){const p=dom('<main><p>'+value+'</p>'+source()+'</main>');assert.equal(inspect(p).exact,false);assert.deepEqual(plain(inspect(p).ids),[]);p.window.close();}
});
test('styled inline plate fragments work but separate values cannot assemble a plate',()=>{
 const page=dom('<main><p><span>28</span><b>오</b><span>6877</span></p>'+source()+'</main>');assert.equal(inspect(page).exact,true);page.window.close();
 const split=dom('<main><p>28</p><p>오6877</p>'+source()+'</main>');assert.equal(inspect(split).exact,false);split.window.close();
});
test('exact header input receives native setter/input/change and is focused before Enter',()=>{
 const page=dom(FIELD,GLOAR_HOME),events=[],input=page.window.document.getElementById('headerSearchInput');for(const name of ['input','change'])input.addEventListener(name,event=>events.push([event.type,event.target.value]));
 assert.equal(inspect(page,{operation:'prepare'}).prepared,true);assert.equal(inspect(page,{operation:'focus'}).focused,true);assert.equal(page.window.document.activeElement,input);assert.deepEqual(events,[['input',PLATE],['change',PLATE]]);page.window.close();
});
test('controller follows real same-page dropdown results, verifies plate and returns only source ID evidence',async()=>{
 const f=fixture(),result=await searchGloarAdvertisement({plate:PLATE,browser:f.browser,pollMs:0});assert.deepEqual(result,{status:'found',plate:PLATE,id:ID,provider:'gloar',sourceUrl:DETAIL});assert.deepEqual(f.state.visits,[GLOAR_HOME,DETAIL]);assert.deepEqual(f.state.keys,['Enter']);assert.equal(f.state.prepares,1);assert.equal(f.state.pageCloses,1);
});
test('newly appended links outrank unchanged catalog cards even when the search input clears',async()=>{
 const f=fixture({append:true,clearInput:true}),result=await searchGloarAdvertisement({plate:PLATE,browser:f.browser,pollMs:0});assert.equal(result.id,ID);assert.deepEqual(f.state.visits,[GLOAR_HOME,DETAIL]);
});
test('an actual direct detail redirect is read after Enter and requires no extra detail navigation',async()=>{
 const f=fixture({redirect:true}),result=await searchGloarAdvertisement({plate:PLATE,browser:f.browser,pollMs:0});assert.equal(result.id,ID);assert.deepEqual(f.state.visits,[GLOAR_HOME]);assert.equal(f.state.keys.length,1);
});
test('read-only navigation context loss does not submit or type twice',async()=>{
 const f=fixture({contextLoss:true}),result=await searchGloarAdvertisement({plate:PLATE,browser:f.browser,pollMs:0});assert.equal(result.id,ID);assert.equal(f.state.prepares,1);assert.equal(f.state.keys.length,1);
});
test('confirmed empty results differ from unchanged catalogs and missing original-ID proof',async()=>{
 const f=fixture({empty:true});assert.equal((await searchGloarAdvertisement({plate:PLATE,browser:f.browser,pollMs:0})).status,'not_found');
 const g=fixture({noChange:true});await assert.rejects(searchGloarAdvertisement({plate:PLATE,browser:g.browser,pollMs:0}),{code:'GLOAR_SEARCH_UNCONFIRMED'});
 const h=fixture({primary:{[DETAIL]:'<main><p>'+PLATE+'</p><p>Opaque internal number 43111111</p></main>'}});await assert.rejects(searchGloarAdvertisement({plate:PLATE,browser:h.browser,pollMs:0}),{code:'GLOAR_ID_UNVERIFIED'});
});
test('wrong plate is not accepted and access challenges are reported without retries or bypasses',async()=>{
 const f=fixture({primary:{[DETAIL]:'<main><p>'+OTHER+'</p>'+source()+'</main>'}});assert.equal((await searchGloarAdvertisement({plate:PLATE,browser:f.browser,pollMs:0})).status,'not_found');
 const g=fixture({challenge:true});await assert.rejects(searchGloarAdvertisement({plate:PLATE,browser:g.browser,pollMs:0}),{code:'GLOAR_ACCESS_BLOCKED'});assert.equal(g.state.keys.length,0);assert.equal(g.state.pageCloses,1);
});
test('wrapper requests a GLOAR-only browser and releases page/browser, preserving quota errors',async()=>{
 const f=fixture();const result=await findGloarAdvertisement({plate:PLATE,env:{},createBrowser:f.createBrowser,pollMs:0});assert.equal(result.id,ID);assert.equal(f.state.options.gloarOnly,true);assert.equal(f.state.pageCloses,1);assert.equal(f.state.browserCloses,1);
 await assert.rejects(findGloarAdvertisement({plate:PLATE,createBrowser:()=>{throw Object.assign(new Error('private-token'),{code:'UPSTREAM_RATE_LIMITED',retryAfter:31});}}),error=>error.code==='UPSTREAM_RATE_LIMITED'&&error.retryAfter===31);
});
test('cancelled or invalid requests never create a browser',async()=>{
 let creates=0;const createBrowser=()=>{creates++;};await assert.rejects(findGloarAdvertisement({plate:'not a plate',createBrowser}),{code:'INVALID_PLATE'});const controller=new AbortController();controller.abort();await assert.rejects(findGloarAdvertisement({plate:PLATE,signal:controller.signal,createBrowser}),{code:'ABORTED'});assert.equal(creates,0);
});
